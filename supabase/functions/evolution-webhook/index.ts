import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";

const STORAGE_BUCKET = "whatsapp-media";

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type Supabase = ReturnType<typeof serviceClient>;

interface EvolutionMedia {
  url?: string;
  mimetype?: string;
  fileName?: string;
  caption?: string;
  base64?: string;
}

interface RawMessage {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  pushName?: string;
  message?: Record<string, unknown>;
  messageType?: string;
  messageTimestamp?: number | string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripNumberSuffix(jid: string): string {
  return (jid.split("@")[0] ?? "").replace(/[^\d]/g, "");
}

// Groups, status, broadcast lists and channels are out of scope for F1.
function isRelevantJid(jid: string): boolean {
  if (!jid) return false;
  if (jid.endsWith("@g.us")) return false;
  if (jid.endsWith("@broadcast")) return false;
  if (jid.endsWith("@newsletter")) return false;
  if (!jid.endsWith("@s.whatsapp.net")) return false;
  return stripNumberSuffix(jid).length >= 10;
}

function mapMessageType(raw: RawMessage): {
  type: string;
  content: string;
  mediaMessage: EvolutionMedia | null;
} {
  let message = (raw.message ?? {}) as Record<string, any>;
  const unwrap = (m: Record<string, any>): Record<string, any> => {
    if (m.ephemeralMessage?.message) return unwrap(m.ephemeralMessage.message);
    if (m.viewOnceMessage?.message) return unwrap(m.viewOnceMessage.message);
    if (m.viewOnceMessageV2?.message) return unwrap(m.viewOnceMessageV2.message);
    if (m.documentWithCaptionMessage?.message) return unwrap(m.documentWithCaptionMessage.message);
    return m;
  };
  message = unwrap(message);

  if (message.conversation !== undefined) {
    return { type: "text", content: String(message.conversation ?? ""), mediaMessage: null };
  }
  if (message.extendedTextMessage) {
    return {
      type: "text",
      content: String(message.extendedTextMessage.text ?? ""),
      mediaMessage: null,
    };
  }
  const mediaTypes: Record<string, string> = {
    imageMessage: "image",
    audioMessage: "audio",
    videoMessage: "video",
    documentMessage: "document",
    stickerMessage: "sticker",
  };
  for (const [key, type] of Object.entries(mediaTypes)) {
    if (message[key]) {
      const m = message[key] as EvolutionMedia;
      const content =
        type === "document"
          ? String(m.fileName ?? m.caption ?? "")
          : String(m.caption ?? "");
      return { type, content, mediaMessage: m };
    }
  }
  return { type: "unknown", content: "", mediaMessage: null };
}

function extFromMimetype(mimetype: string, fallback: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/opus": "opus",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
  };
  return map[mimetype] ?? fallback;
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.includes(",") ? base64.split(",")[1] : base64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function downloadMediaBase64(
  instanceName: string,
  messageObj: Record<string, unknown>,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${instanceName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EVOLUTION_API_KEY,
        },
        body: JSON.stringify({ message: messageObj }),
      },
    );
    if (!res.ok) {
      console.error("getBase64FromMediaMessage failed", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return typeof data?.base64 === "string" ? data.base64 : null;
  } catch (err) {
    console.error("getBase64FromMediaMessage error", err);
    return null;
  }
}

async function uploadMedia(
  supabase: Supabase,
  objectPath: string,
  base64: string,
  contentType: string,
): Promise<boolean> {
  const bytes = base64ToBytes(base64);
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, bytes, { contentType, upsert: true });
  if (error) {
    console.error("storage upload failed", objectPath, error.message);
    return false;
  }
  return true;
}

async function upsertContact(
  supabase: Supabase,
  phone: string,
  pushName: string | null,
): Promise<string> {
  const { data: existing } = await supabase
    .from("contacts")
    .select("id, name, push_name")
    .eq("phone", phone)
    .maybeSingle();
  if (existing) {
    if (pushName && existing.push_name !== pushName) {
      await supabase.from("contacts").update({ push_name: pushName }).eq("id", existing.id);
    }
    return existing.id;
  }
  const { data, error } = await supabase
    .from("contacts")
    .insert({ phone, push_name: pushName ?? null, name: pushName ?? null })
    .select("id")
    .single();
  if (error) {
    // Race: another webhook call created it meanwhile.
    const { data: again } = await supabase
      .from("contacts")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    if (again) return again.id;
    throw error;
  }
  return data.id;
}

async function upsertConversation(
  supabase: Supabase,
  contactId: string,
  instanceId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)
    .eq("instance_id", instanceId)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await supabase
    .from("conversations")
    .insert({ contact_id: contactId, instance_id: instanceId })
    .select("id")
    .single();
  if (error) {
    const { data: again } = await supabase
      .from("conversations")
      .select("id")
      .eq("contact_id", contactId)
      .eq("instance_id", instanceId)
      .maybeSingle();
    if (again) return again.id;
    throw error;
  }
  return data.id;
}

// ---------------------------------------------------------------------------
// Message processing
// ---------------------------------------------------------------------------

async function processMessage(
  supabase: Supabase,
  instanceId: string,
  instanceName: string,
  raw: RawMessage,
): Promise<void> {
  const jid = raw.key?.remoteJid ?? "";
  if (!isRelevantJid(jid)) return;
  const phone = stripNumberSuffix(jid);
  const fromMe = Boolean(raw.key?.fromMe);
  const evolutionId = raw.key?.id ?? null;
  const { type, content, mediaMessage } = mapMessageType(raw);
  const ts = raw.messageTimestamp ? Number(raw.messageTimestamp) : null;
  const sentAt = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString();

  // Business rule: keep only the last 60 days of history. WhatsApp's sync sends
  // whatever it has (often arbitrary dates) — we filter it out here so the inbox
  // stays a clean 60-day window.
  const HISTORY_CUTOFF_MS = 60 * 24 * 60 * 60 * 1000;
  if (ts && ts * 1000 < Date.now() - HISTORY_CUTOFF_MS) {
    return;
  }

  const preview = type === "text"
    ? content.slice(0, 140)
    : content.slice(0, 140) || `[${type}]`;

  const contactId = await upsertContact(supabase, phone, raw.pushName ?? null);
  const conversationId = await upsertConversation(supabase, contactId, instanceId);

  let mediaUrl: string | null = null;
  if (mediaMessage) {
    const base64 = await downloadMediaBase64(instanceName, raw.message ?? {});
    if (base64) {
      const ext = extFromMimetype(mediaMessage.mimetype ?? "", type);
      const objectPath = `messages/${evolutionId ?? crypto.randomUUID()}.${ext}`;
      const uploaded = await uploadMedia(
        supabase,
        objectPath,
        base64,
        mediaMessage.mimetype ?? "application/octet-stream",
      );
      if (uploaded) mediaUrl = objectPath;
    }
  }

  const { error } = await supabase.from("messages").upsert(
    {
      conversation_id: conversationId,
      evolution_message_id: evolutionId,
      direction: fromMe ? "outbound" : "inbound",
      sender_profile_id: null,
      type,
      content: content || null,
      media_url: mediaUrl,
      sent_at: sentAt,
    },
    { onConflict: "conversation_id, evolution_message_id", ignoreDuplicates: true },
  );

  if (error) {
    // evolution_message_id can be NULL for some events; that's fine, the
    // insert is not deduplicated in that case. Log anything else.
    console.error("message insert failed", error.message, { conversationId, evolutionId });
  }

  await supabase.rpc("bump_conversation", {
    p_id: conversationId,
    p_sent_at: sentAt,
    p_preview: preview,
    p_inbound: !fromMe,
  });
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleConnectionUpdate(
  supabase: Supabase,
  instanceName: string,
  data: { state?: string } | null,
): Promise<Response> {
  const state = (data?.state ?? "").toLowerCase();
  let status = "disconnected";
  if (state === "open") status = "connected";
  else if (state === "connecting" || state === "pairing") status = "connecting";

  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("instance_name", instanceName)
    .maybeSingle();
  if (instance) {
    const { error } = await supabase
      .from("whatsapp_instances")
      .update({ status })
      .eq("id", instance.id);
    if (error) console.error("instance status update failed", error.message);
  }
  return jsonResponse(200, { ok: true, status });
}

async function handleMessages(
  supabase: Supabase,
  instanceName: string,
  data: RawMessage[] | RawMessage | null,
): Promise<Response> {
  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("instance_name", instanceName)
    .maybeSingle();
  if (!instance) {
    // Unknown instance — nothing to do.
    return jsonResponse(200, { ok: true, skipped: "unknown instance" });
  }

  const list: RawMessage[] = Array.isArray(data)
    ? data
    : data
    ? [data]
    : [];

  // Limited concurrency: history batches (`messages.set`) can be large, but
  // media downloads are network-bound, so a little parallelism helps.
  const BATCH = 10;
  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    await Promise.allSettled(
      chunk.map((raw) => processMessage(supabase, instance.id, instanceName, raw)),
    );
  }
  return jsonResponse(200, { ok: true, processed: list.length });
}

// Ingest the contact list (`contacts.set` on connect, `contacts.upsert` on
// updates). The full WhatsApp address book is imported as CRM contacts; the
// 60-day window applies only to messages, not to contacts. The contact objects
// on this server carry the phone in `remoteJid`.
async function handleContacts(
  supabase: Supabase,
  data: Array<{ id?: string; pushName?: string; number?: string; remoteJid?: string }> | { id?: string; pushName?: string; number?: string; remoteJid?: string } | null,
): Promise<Response> {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  let processed = 0;
  for (const contact of list) {
    const jid = contact.remoteJid ?? "";
    if (!jid.endsWith("@s.whatsapp.net")) continue;
    const phone = jid.split("@")[0].replace(/[^\d]/g, "");
    if (phone.length < 10) continue;
    try {
      await upsertContact(supabase, phone, contact.pushName ?? null);
      processed += 1;
    } catch (err) {
      console.error("handleContacts upsert failed", err);
    }
  }
  return jsonResponse(200, { ok: true, processed });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    if (url.searchParams.get("token") !== WEBHOOK_SECRET) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    const payload = await req.json();
    const event = String(payload.event ?? "");
    const instanceName = String(payload.instance ?? "");
    const supabase = serviceClient();

    switch (event) {
      case "connection.update":
        return await handleConnectionUpdate(supabase, instanceName, payload.data);
      case "messages.upsert":
      case "messages.set":
        return await handleMessages(supabase, instanceName, payload.data);
      case "contacts.set":
      case "contacts.upsert":
        return await handleContacts(supabase, payload.data);
      default:
        return jsonResponse(200, { ok: true, ignored: event });
    }
  } catch (err) {
    console.error("evolution-webhook error", err);
    return jsonResponse(500, { error: "internal error" });
  }
});
