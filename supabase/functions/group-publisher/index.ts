// group-publisher — publica posts programados em grupos WhatsApp (@g.us).
//
// Agendado por pg_cron a cada 5 min (060_group_posts.sql), autorizado por
// `group_posts_internal_token` em app_secrets (mesmo padrão do noreply-runner).
//
// Claim atômico via public.claim_group_posts (FOR UPDATE SKIP LOCKED): duas
// execuções sobrepostas nunca publicam o mesmo post 2x.
//
// Envio: texto via /message/sendText, ou mídia+legenda via /message/sendMedia
// (mesma instância do post). Falha de envio NÃO perde o post: volta para
// `scheduled` (+5min) até 3 tentativas, depois `failed` com last_error.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/contacts.ts";
import { timingSafeEqual } from "../_shared/timing.ts";

const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const STORAGE_BUCKET = "whatsapp-media";

const supabase = serviceClient();

interface GroupPost {
  id: string;
  instance_id: string;
  group_jid: string;
  group_name: string | null;
  content: string;
  media_url: string | null;
  media_type: string | null;
  publish_attempts: number;
  instance?: { instance_name: string } | null;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function authorize(req: Request, bodyToken: string | undefined): Promise<boolean> {
  const url = new URL(req.url);
  const token = (bodyToken ?? "").trim() || (url.searchParams.get("token") ?? "").trim();
  if (!token) return false;
  const { data: secret } = await supabase
    .from("app_secrets")
    .select("value")
    .eq("key", "group_posts_internal_token")
    .maybeSingle();
  const expected = String(secret?.value ?? "");
  if (!expected) return false;
  return timingSafeEqual(token, expected);
}

// ---------------------------------------------------------------------------
// Evolution
// ---------------------------------------------------------------------------

async function callEvolution(
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; data: any; text: string }> {
  const res = await fetch(`${EVOLUTION_API_URL}${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: {
      apikey: EVOLUTION_API_KEY,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, data, text };
}

const instanceStateCache = new Map<string, { connected: boolean; at: number }>();

async function instanceConnected(instanceName: string): Promise<boolean> {
  const cached = instanceStateCache.get(instanceName);
  if (cached && Date.now() - cached.at < 60_000) return cached.connected;
  let connected = false;
  if (EVOLUTION_API_URL && EVOLUTION_API_KEY) {
    const st = await callEvolution(`/instance/connectionState/${instanceName}`);
    connected = String(st.data?.instance?.state ?? "").toLowerCase() === "open";
  }
  instanceStateCache.set(instanceName, { connected, at: Date.now() });
  return connected;
}

// ---------------------------------------------------------------------------
// Publicação
// ---------------------------------------------------------------------------

function extFromMime(mimetype: string, fallback: string): string {
  const base = mimetype.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3", "application/pdf": "pdf",
  };
  return map[base] ?? fallback;
}

async function publishPost(post: GroupPost): Promise<{ messageId: string | null; error: string | null }> {
  const { data: inst } = await supabase
    .from("whatsapp_instances")
    .select("instance_name")
    .eq("id", post.instance_id)
    .maybeSingle();
  const instanceName = inst?.instance_name as string | undefined;
  if (!instanceName) return { messageId: null, error: "instância não encontrada" };
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return { messageId: null, error: "Evolution API não configurada" };
  }
  if (!(await instanceConnected(instanceName))) {
    return { messageId: null, error: `instância ${instanceName} desconectada` };
  }

  if (!post.media_url) {
    if (!post.content.trim()) return { messageId: null, error: "post sem texto nem mídia" };
    const { ok, data, text } = await callEvolution(
      `/message/sendText/${instanceName}`,
      { number: post.group_jid, text: post.content },
    );
    if (!ok) return { messageId: null, error: `sendText falhou: ${text.slice(0, 300)}` };
    return { messageId: data?.key?.id ?? null, error: null };
  }

  const { data: blob, error: dlErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(post.media_url);
  if (dlErr || !blob) {
    return { messageId: null, error: `mídia não encontrada no storage: ${dlErr?.message ?? ""}` };
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  const mediatype = post.media_type === "image" || post.media_type === "video" ||
      post.media_type === "audio"
    ? post.media_type
    : "document";
  const fileName = post.media_url.split("/").pop() || `post.${extFromMime(blob.type, "bin")}`;
  const { ok, data, text } = await callEvolution(
    `/message/sendMedia/${instanceName}`,
    {
      number: post.group_jid,
      mediatype,
      media: btoa(bin),
      isBase64: true,
      fileName,
      ...(post.content.trim() ? { caption: post.content } : {}),
    },
  );
  if (!ok) return { messageId: null, error: `sendMedia falhou: ${text.slice(0, 300)}` };
  return { messageId: data?.key?.id ?? null, error: null };
}

async function markPublished(post: GroupPost, messageId: string | null): Promise<void> {
  const now = new Date().toISOString();
  await supabase.from("group_posts").update({
    status: "published",
    published_message_id: messageId,
    published_at: now,
    last_error: null,
  }).eq("id", post.id);
  await supabase.from("activity_log").insert({
    entity_type: "group_post",
    entity_id: post.id,
    action: `GROUP_POST: publicado no grupo ${post.group_name ?? post.group_jid}`,
    new_data: { message_id: messageId },
  });
}

async function markFailed(post: GroupPost, error: string): Promise<void> {
  const attempts = post.publish_attempts + 1;
  if (attempts >= 3) {
    await supabase.from("group_posts").update({
      status: "failed",
      publish_attempts: attempts,
      last_error: error.slice(0, 500),
    }).eq("id", post.id);
    await supabase.from("activity_log").insert({
      entity_type: "group_post",
      entity_id: post.id,
      action: `GROUP_POST: falha definitiva após ${attempts} tentativas — ${error.slice(0, 200)}`,
      new_data: { error: error.slice(0, 500) },
    });
  } else {
    // Reagenda para a próxima passada (+5min): falha transitória não perde o post.
    await supabase.from("group_posts").update({
      status: "scheduled",
      scheduled_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      publish_attempts: attempts,
      last_error: error.slice(0, 500),
    }).eq("id", post.id);
  }
}

async function expireOld(): Promise<number> {
  // Publicados cuja janela já fechou: expired (webhook para de casar, UI mostra).
  // `.order("published_at")` garante que os mais antigos sejam avaliados
  // primeiro — sem ORDER BY o Postgres devolve linhas em qualquer ordem e o
  // limite de 100 podia deixar posts antigos para sempre "published".
  const { data } = await supabase
    .from("group_posts")
    .select("id, published_at, window_hours")
    .eq("status", "published")
    .not("published_at", "is", null)
    .order("published_at", { ascending: true })
    .limit(100);
  let expired = 0;
  const now = Date.now();
  for (const p of data ?? []) {
    const pub = new Date(p.published_at as string).getTime();
    if (now > pub + (p.window_hours as number) * 3600_000) {
      await supabase.from("group_posts").update({ status: "expired" }).eq("id", p.id);
      expired++;
    }
  }
  return expired;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const payload = await req.json().catch(() => ({}));
    if (!(await authorize(req, payload?.internal_token as string | undefined))) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    const { data: claimed } = await supabase.rpc("claim_group_posts", { p_limit: 5 });

    // Reaper: posts presos em 'publishing' (runner morreu entre o claim e o
    // update) voltam para 'scheduled'. Sem isso o post ficava travado para
    // sempre — nunca publicado e sem aviso para ninguém.
    const { data: reaped } = await supabase.rpc("reap_stuck_group_posts");
    if (reaped) console.info("GROUP_POSTS_REAPED", reaped);

    let published = 0;
    let failed = 0;
    for (const post of (claimed ?? []) as GroupPost[]) {
      try {
        const { messageId, error } = await publishPost(post);
        if (error) {
          failed++;
          await markFailed(post, error);
        } else {
          published++;
          await markPublished(post, messageId);
        }
      } catch (err) {
        failed++;
        await markFailed(post, String(err).slice(0, 500));
      }
    }
    const expired = await expireOld();
    return jsonResponse(200, { ok: true, published, failed, expired });
  } catch (err) {
    console.error("GROUP_PUBLISHER_ERROR", err);
    return jsonResponse(500, { error: "internal error" });
  }
});
