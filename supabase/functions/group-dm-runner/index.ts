// group-dm-runner — DM com delay para quem comentou post em grupo.
//
// Agendado por pg_cron a cada 5 min (060_group_posts.sql), autorizado por
// `group_posts_internal_token` em app_secrets (mesmo padrão do noreply-runner).
//
// Claim atômico via public.claim_group_dms (FOR UPDATE SKIP LOCKED): duas
// execuções sobrepostas nunca enviam a mesma DM 2x.
//
// A DM NUNCA fura SDR IA nem régua noreply: se qualquer um estiver ativo na
// conversa 1:1, o engajamento volta para `waiting` com dm_due_at +15min e é
// rechecando no próximo run. Horário comercial/fim de semana também adiam.
// Falha de envio não perde a DM: retry +30min até 3 tentativas, depois `failed`.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, upsertConversation } from "../_shared/contacts.ts";
import { isWeekend, localParts, substituteVariables, timeToMinutes } from "../_shared/noreply-schedule.ts";
import { renderGroupDm } from "../_shared/group-posts.ts";
import { resolveSendTarget } from "../_shared/evolution-identity.ts";
import { timingSafeEqual } from "../_shared/timing.ts";

const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";

const supabase = serviceClient();

interface GroupDm {
  id: string;
  post_id: string;
  contact_id: string | null;
  dm_attempts: number;
}

interface GroupPost {
  id: string;
  instance_id: string;
  status: string;
  dm_template: string;
  pacing_seconds: number;
  business_hours_only?: boolean | null;
  skip_weekends?: boolean | null;
  instance?: { instance_name: string } | null;
}

interface Contact {
  id: string;
  name: string | null;
  push_name: string | null;
  phone: string | null;
  lid: string | null;
  jid: string | null;
  opted_out: boolean;
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
// Guardrails
// ---------------------------------------------------------------------------

async function inBusinessHours(now: Date): Promise<boolean> {
  const { dayOfWeek, minutes } = localParts(now);
  const { data: hours } = await supabase
    .from("business_hours")
    .select("is_active, start_time, end_time")
    .eq("day_of_week", dayOfWeek)
    .single();
  if (!hours || !hours.is_active) return false;
  return minutes >= timeToMinutes(hours.start_time) && minutes <= timeToMinutes(hours.end_time);
}

/** SDR IA ativo no comando da conversa? */
async function sdrOwnsConversation(conversationId: string): Promise<boolean> {
  const { data } = await supabase
    .from("sdr_conversations")
    .select("id")
    .eq("conversation_id", conversationId)
    .in("status", ["active", "paused_limit", "paused_schedule"])
    .maybeSingle();
  return Boolean(data);
}

/** Régua noreply ativa na conversa? */
async function noreplyActive(conversationId: string): Promise<boolean> {
  const { data } = await supabase
    .from("noreply_states")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data);
}

async function defer(id: string, reason: string, minutes: number): Promise<void> {
  await supabase.from("group_post_engagements").update({
    dm_status: "waiting",
    dm_due_at: new Date(Date.now() + minutes * 60_000).toISOString(),
    dm_error: reason,
  }).eq("id", id);
}

async function markTerminal(
  id: string,
  postId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabase.from("group_post_engagements").update(patch).eq("id", id);
  void supabase.rpc("recalc_group_post_stats", { p_post_id: postId }).then(() => {}, () => {});
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

async function sendDm(
  dm: GroupDm,
  post: GroupPost,
  contact: Contact,
  instanceName: string,
  conversationId: string,
): Promise<{ messageId: string | null; error: string | null }> {
  const text = renderGroupDm(post.dm_template, contact.name ?? contact.push_name);
  if (!text.trim()) return { messageId: null, error: "template vazio" };
  const sendTarget = resolveSendTarget(contact).target;
  if (!sendTarget) return { messageId: null, error: "NO_PHONE" };

  const sentAt = new Date().toISOString();
  const { ok, data, text: respText } = await callEvolution(
    `/message/sendText/${instanceName}`,
    { number: sendTarget, text },
  );
  if (!ok) return { messageId: null, error: `evolution sendText failed: ${respText.slice(0, 300)}` };

  const { data: msgRow } = await supabase.from("messages").upsert(
    {
      conversation_id: conversationId,
      evolution_message_id: data?.key?.id ?? `group-dm-${crypto.randomUUID()}`,
      direction: "outbound",
      sender_profile_id: null,
      type: "text",
      content: text,
      media_url: null,
      sent_at: sentAt,
      status: "sent",
      send_error: null,
    },
    { onConflict: "conversation_id, evolution_message_id" },
  ).select("id").maybeSingle();

  void (async () => {
    const { error } = await supabase.rpc("bump_conversation", {
      p_id: conversationId,
      p_sent_at: sentAt,
      p_preview: text.slice(0, 140),
      p_inbound: false,
    });
    if (error) console.error("GROUP_DM_BUMP_FAILED", error.message);
  })();

  return { messageId: msgRow?.id ?? null, error: null };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const payload = await req.json().catch(() => ({}));
    if (!(await authorize(req, payload?.internal_token as string | undefined))) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      return jsonResponse(200, { ok: true, skipped: "evolution não configurada" });
    }

    const { data: dues } = await supabase.rpc("claim_group_dms", { p_limit: 50 });
    let sent = 0;
    let deferred = 0;
    let failed = 0;
    let skipped = 0;

    for (const dm of (dues ?? []) as GroupDm[]) {
      try {
        const { data: post } = await supabase
          .from("group_posts")
          .select("id, instance_id, status, dm_template, pacing_seconds")
          .eq("id", dm.post_id)
          .maybeSingle();
        if (!post || (post as GroupPost).status !== "published") {
          await markTerminal(dm.id, dm.post_id, { dm_status: "cancelled", dm_error: "post cancelado/expirado" });
          skipped++;
          continue;
        }
        const p = post as unknown as GroupPost;

        if (!dm.contact_id) {
          await markTerminal(dm.id, dm.post_id, { dm_status: "skipped_no_phone", dm_error: "sem contato" });
          skipped++;
          continue;
        }
        const { data: contact } = await supabase
          .from("contacts")
          .select("id, name, push_name, phone, lid, jid, opted_out")
          .eq("id", dm.contact_id)
          .maybeSingle();
        if (!contact) {
          await markTerminal(dm.id, dm.post_id, { dm_status: "skipped_no_phone", dm_error: "contato removido" });
          skipped++;
          continue;
        }
        const c = contact as unknown as Contact;
        if (c.opted_out) {
          await markTerminal(dm.id, dm.post_id, { dm_status: "skipped_optout" });
          skipped++;
          continue;
        }
        if (!resolveSendTarget(c).target) {
          await markTerminal(dm.id, dm.post_id, {
            dm_status: "skipped_no_phone",
            dm_error: "contato sem telefone/LID resolvível",
          });
          skipped++;
          continue;
        }

        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("instance_name")
          .eq("id", p.instance_id)
          .maybeSingle();
        const instanceName = inst?.instance_name as string | undefined;
        if (!instanceName || !(await instanceConnected(instanceName))) {
          await defer(dm.id, "instância desconectada", 15);
          deferred++;
          continue;
        }

        // Conversa 1:1 da DM (criada se não existir) — base dos guardrails e da auditoria.
        const conversationId = await upsertConversation(supabase, c.id, p.instance_id);

        const now = new Date();
        if (isWeekend(now)) {
          await defer(dm.id, "fim de semana", 60);
          deferred++;
          continue;
        }
        if (!(await inBusinessHours(now))) {
          await defer(dm.id, "fora do horário comercial", 30);
          deferred++;
          continue;
        }
        if (await sdrOwnsConversation(conversationId)) {
          await defer(dm.id, "SDR IA no comando", 15);
          deferred++;
          continue;
        }
        if (await noreplyActive(conversationId)) {
          await defer(dm.id, "régua noreply ativa", 15);
          deferred++;
          continue;
        }

        const { messageId, error } = await sendDm(dm, p, c, instanceName, conversationId);
        if (error) {
          const attempts = dm.dm_attempts + 1;
          if (attempts >= 3) {
            await markTerminal(dm.id, dm.post_id, {
              dm_status: "failed",
              dm_attempts: attempts,
              dm_error: error.slice(0, 500),
            });
            failed++;
          } else {
            // Falha de envio não conta como tentativa válida: retry +30min.
            await supabase.from("group_post_engagements").update({
              dm_status: "pending",
              dm_attempts: attempts,
              dm_due_at: new Date(Date.now() + 30 * 60_000).toISOString(),
              dm_error: error.slice(0, 500),
            }).eq("id", dm.id);
            failed++;
          }
          continue;
        }
        await markTerminal(dm.id, dm.post_id, {
          dm_status: "sent",
          dm_sent_at: new Date().toISOString(),
          dm_message_id: messageId,
          dm_error: null,
        });
        sent++;

        const pacingMs = Math.min(300, Math.max(0, p.pacing_seconds ?? 20)) * 1000;
        if (pacingMs > 0) await sleep(pacingMs);
      } catch (err) {
        console.error("GROUP_DM_RUNNER_ITEM_ERROR", dm.id, err);
        await supabase.from("group_post_engagements").update({
          dm_status: "pending",
          dm_attempts: dm.dm_attempts + 1,
          dm_due_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          dm_error: String(err).slice(0, 500),
        }).eq("id", dm.id);
        failed++;
      }
    }

    return jsonResponse(200, { ok: true, sent, deferred, failed, skipped });
  } catch (err) {
    console.error("GROUP_DM_RUNNER_ERROR", err);
    return jsonResponse(500, { error: "internal error" });
  }
});
