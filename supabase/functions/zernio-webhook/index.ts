// zernio-webhook — recebe eventos da Zernio (Meta Cloud API).
// Segurança dupla: query ?token= (comparada com app_secrets) e/ou assinatura
// HMAC X-Zernio-Signature (app_secrets). Idempotência via insert do event_id.
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, type Supabase } from "../_shared/contacts.ts";
import { getSecret } from "../_shared/secrets.ts";
import {
  ZERNIO_WEBHOOK_SECRET_NAME,
  ZERNIO_WEBHOOK_TOKEN_NAME,
} from "../_shared/zernio.ts";

interface WebhookPayload {
  id?: string;
  event?: string;
  timestamp?: string;
  statusAt?: string;
  template?: {
    name?: string;
    language?: string;
    status?: string;
    reason?: string;
  };
  account?: { accountId?: string; id?: string; profileId?: string; platform?: string };
  message?: { id?: string; _id?: string; direction?: string; platformMessageId?: string };
  error?: { code?: number; title?: string; message?: string } | null;
  conversation?: {
    participantId?: string;
    contactId?: string;
    platform?: string;
  };
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(raw: string, secret: string, header: string): Promise<boolean> {
  if (!secret || !header) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const expected = header.replace(/^sha256=/i, "").toLowerCase();
  return hex(sig) === expected;
}

function phoneDigits(...values: Array<string | undefined | null>): string | null {
  for (const v of values) {
    if (!v) continue;
    const digits = String(v).replace(/[^\d]/g, "");
    if (digits.length >= 10 && digits.length <= 15) return digits;
  }
  return null;
}

async function touchCampaign(supabase: Supabase, campaignId: string): Promise<void> {
  await supabase.rpc("recalc_campaign_stats", { p_campaign_id: campaignId }).then(
    () => {},
    (err: unknown) => console.error("recalc_campaign_stats falhou", err),
  );
}

// message.sent/delivered/read/failed → atualiza o espelho da campanha.
async function handleMessageStatus(
  supabase: Supabase,
  event: string,
  payload: WebhookPayload,
): Promise<void> {
  const msgId = String(payload.message?._id ?? payload.message?.id ?? "");
  const phone = phoneDigits(payload.conversation?.participantId);
  if (!msgId && !phone) return;

  const newStatus = event === "message.failed"
    ? "failed"
    : event === "message.delivered"
    ? "delivered"
    : event === "message.read"
    ? "read"
    : "sent"; // message.sent
  if (event === "message.received") return;

  const statusAt = payload.statusAt ?? payload.timestamp ?? new Date().toISOString();

  let rows: Array<{ id: string; campaign_id: string }> = [];
  if (msgId) {
    const { data } = await supabase
      .from("campaign_recipients")
      .select("id, campaign_id")
      .eq("zernio_message_id", msgId);
    rows = data ?? [];
  }
  if (rows.length === 0 && phone) {
    // Fallback por telefone: só enquanto o destinatário ainda não evoluiu
    // (evita reabrir status lida com um evento atrasado/duplicado).
    const { data } = await supabase
      .from("campaign_recipients")
      .select("id, campaign_id")
      .eq("phone", phone)
      .in("status", ["pending", "sent", "delivered"]);
    rows = (data ?? []).filter((r) => Boolean(r.id));
  }
  if (rows.length === 0) return;

  const rank: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };
  const patch: Record<string, unknown> = { status: newStatus };
  if (newStatus === "sent") patch.sent_at = statusAt;
  if (newStatus === "delivered") patch.delivered_at = statusAt;
  if (newStatus === "read") patch.read_at = statusAt;
  if (newStatus === "failed") {
    const e = payload.error;
    patch.error = e ? [e.title, e.message].filter(Boolean).join(": ") || "falha" : "falha";
    patch.error_code = e?.code ?? null;
  } else {
    patch.error = null;
    patch.error_code = null;
  }
  if (msgId) patch.zernio_message_id = msgId;

  for (const row of rows) {
    // Não rebaixa status (ex.: delivered tardio depois de read).
    const { data: current } = await supabase
      .from("campaign_recipients")
      .select("status")
      .eq("id", row.id)
      .maybeSingle();
    const curRank = rank[current?.status ?? "pending"] ?? 0;
    const nextRank = newStatus === "failed" ? -1 : (rank[newStatus] ?? 0);
    if (newStatus !== "failed" && curRank > nextRank) continue;
    await supabase.from("campaign_recipients").update(patch).eq("id", row.id);
    await touchCampaign(supabase, row.campaign_id);
  }
}

async function handleTemplateStatus(
  supabase: Supabase,
  payload: WebhookPayload,
): Promise<void> {
  const accountId = String(payload.account?.accountId ?? payload.account?.id ?? "");
  const t = payload.template ?? {};
  if (!accountId || !t.name || !t.language) return;
  await supabase.from("zernio_templates").upsert(
    {
      account_id: accountId,
      name: String(t.name),
      language: String(t.language),
      status: t.status ? String(t.status) : null,
      reason: t.reason ? String(t.reason) : null,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "account_id,name,language" },
  );
}

async function handleAccountEvent(
  supabase: Supabase,
  event: string,
  payload: WebhookPayload,
): Promise<void> {
  const accountId = String(payload.account?.accountId ?? payload.account?.id ?? "");
  if (!accountId) return;
  const { data: conn } = await supabase
    .from("zernio_connections")
    .select("account_id, status")
    .eq("id", "default")
    .maybeSingle();
  if (!conn) return;

  if (event === "account.disconnected" && conn.account_id === accountId) {
    await supabase.from("zernio_connections").update({ status: "disconnected" }).eq("id", "default");
  }
  if (event === "account.connected" && conn.account_id === accountId) {
    await supabase
      .from("zernio_connections")
      .update({ status: "connected", connected_at: new Date().toISOString() })
      .eq("id", "default");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = serviceClient();

    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? "";
    const expectedToken = await getSecret(supabase, ZERNIO_WEBHOOK_TOKEN_NAME);
    const webhookSecret = await getSecret(supabase, ZERNIO_WEBHOOK_SECRET_NAME);
    const signatureHeader =
      req.headers.get("X-Zernio-Signature") ?? req.headers.get("X-Late-Signature") ?? "";

    const raw = await req.text();
    const signatureOk = await verifySignature(raw, webhookSecret, signatureHeader);
    const tokenOk = Boolean(expectedToken) && token === expectedToken;
    if (!signatureOk && !tokenOk) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return jsonResponse(400, { error: "invalid json" });
    }

    const eventId = String(payload.id ?? "");
    const event = String(payload.event ?? "unknown");
    if (eventId) {
      const { error } = await supabase.from("zernio_webhook_events").insert({
        event_id: eventId,
        event_type: event,
        payload: payload as unknown as Record<string, unknown>,
      });
      // 23505 = duplicate: entrega at-least-once, já processada.
      if (error && error.code !== "23505") console.error("webhook_events insert", error.message);
      if (error?.code === "23505") return jsonResponse(200, { ok: true, duplicate: true });
    }

    try {
      if (event === "whatsapp.template.status_updated") {
        await handleTemplateStatus(supabase, payload);
      } else if (
        event === "message.sent" ||
        event === "message.delivered" ||
        event === "message.read" ||
        event === "message.failed"
      ) {
        await handleMessageStatus(supabase, event, payload);
      } else if (event === "account.connected" || event === "account.disconnected") {
        await handleAccountEvent(supabase, event, payload);
      }
      // message.received e demais eventos: aceitos e registrados; espelhar
      // conversas da Zernio no chat é fase seguinte do plano.
    } catch (err) {
      console.error("zernio-webhook handler error", err);
      if (eventId) {
        await supabase
          .from("zernio_webhook_events")
          .update({ error: String(err) })
          .eq("event_id", eventId);
      }
    }

    return jsonResponse(200, { ok: true });
  } catch (err) {
    console.error("zernio-webhook fatal", err);
    return jsonResponse(500, { error: "internal error" });
  }
});
