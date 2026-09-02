import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, upsertContact, upsertConversation, type Supabase } from "../_shared/contacts.ts";
import {
  isRelevantJid,
  normalizePhoneStrict,
  normalizeWhatsAppIdentity,
} from "../_shared/evolution-identity.ts";
import { createLidCacheStore, resolveLidPhone } from "../_shared/lid-phone-resolver.ts";

const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";

const STORAGE_BUCKET = "whatsapp-media";

interface EvolutionMedia {
  url?: string;
  mimetype?: string;
  fileName?: string;
  caption?: string;
  base64?: string;
}

interface RawMessage {
  key?: {
    remoteJid?: string;
    fromMe?: boolean;
    id?: string;
    senderPn?: string;
    remoteJidAlt?: string;
  };
  // Alguns servidores Evolution/versões colocam esses campos no nível raiz do
  // item, fora do `key` — lemos dos dois lugares.
  senderPn?: string;
  remoteJidAlt?: string;
  pushName?: string;
  message?: Record<string, unknown>;
  messageType?: string;
  messageTimestamp?: number | string;
}

interface StatusUpdate {
  key?: {
    remoteJid?: string;
    fromMe?: boolean;
    id?: string;
    senderPn?: string;
    remoteJidAlt?: string;
  };
  status?: number;
}

// Códigos de status Baileys/Evolution → status interno do CRM.
const STATUS_MAP: Record<number, string> = {
  0: "failed", // ERROR
  1: "pending", // PENDING
  2: "sent", // SERVER_ACK
  3: "delivered", // DELIVERY_ACK
  4: "read", // READ
  5: "read", // PLAYED
};

// ---------------------------------------------------------------------------
// Mídia
// ---------------------------------------------------------------------------

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
      console.error("EVOLUTION_MEDIA_DOWNLOAD_FAILED", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return typeof data?.base64 === "string" ? data.base64 : null;
  } catch (err) {
    console.error("EVOLUTION_MEDIA_DOWNLOAD_ERROR", err);
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
    console.error("EVOLUTION_MEDIA_UPLOAD_FAILED", objectPath, error.message);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Tipo/conteúdo da mensagem
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Processamento de mensagem
// ---------------------------------------------------------------------------

async function processMessage(
  supabase: Supabase,
  instanceId: string,
  instanceName: string,
  raw: RawMessage,
): Promise<void> {
  const jid = raw.key?.remoteJid ?? "";
  if (!isRelevantJid(jid)) {
    // Nunca descartar em silêncio: quedas de entrega só são diagnosticáveis
    // se o drop aparecer nos logs.
    console.warn("EVOLUTION_MESSAGE_SKIPPED_IRRELEVANT_JID", jid, raw.key?.id ?? "");
    return;
  }

  // EVOLUTION_IDENTITY_RESOLVED — a camada central decide phone/LID.
  // Lê remoteJidAlt/senderPn tanto no `key` quanto no nível raiz do item.
  const identity = normalizeWhatsAppIdentity({
    remoteJid: jid,
    remoteJidAlt: raw.key?.remoteJidAlt ?? raw.remoteJidAlt,
    senderPn: raw.key?.senderPn ?? raw.senderPn,
  });
  const { phone: identityPhone, lid } = identity;
  if (!identityPhone && !lid) {
    console.warn("EVOLUTION_IDENTITY_UNRESOLVED", jid);
    return;
  }
  let phone = identityPhone;

  // LID sem telefone: tenta resolver UMA vez via Evolution (cache 24h/30d).
  // Sem isso o contato nasce sem número e a conversa vira "Contato sem número".
  if (!phone && lid) {
    try {
      const resolved = await resolveLidPhone({
        store: createLidCacheStore(supabase),
        baseUrl: EVOLUTION_API_URL,
        apiKey: EVOLUTION_API_KEY,
        instanceName,
        lidDigits: lid.replace(/^lid:/, ""),
      });
      if (resolved) {
        phone = resolved;
        console.info("EVOLUTION_LID_PHONE_RESOLVED", lid, resolved);
      }
    } catch (err) {
      console.warn("EVOLUTION_LID_PHONE_RESOLVE_FAILED", String(err));
    }
  }
  if (identity.isLid) console.info("EVOLUTION_LID_DETECTED", identity.lid, phone ? `phone=${phone}` : "sem phone");

  // Diagnóstico temporário: guarda o key bruto dos LIDs para conferir onde a
  // Evolution envia o telefone alternativo. Best effort (nunca quebra o fluxo).
  if (identity.isLid) {
    await supabase
      .from("webhook_lid_log")
      .upsert(
        {
          instance_name: instanceName,
          message_id: raw.key?.id ?? null,
          key: raw.key ?? null,
          push_name: raw.pushName ?? null,
          resolved_phone: Boolean(phone),
        },
        { onConflict: "instance_name,message_id", ignoreDuplicates: true },
      )
      .then(() => {}, () => {});
  }

  const fromMe = Boolean(raw.key?.fromMe);
  const evolutionId = raw.key?.id ?? null;
  const { type, content, mediaMessage } = mapMessageType(raw);
  const ts = raw.messageTimestamp ? Number(raw.messageTimestamp) : null;
  const sentAt = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString();

  // Regra de negócio: manter apenas os últimos 60 dias de histórico.
  const HISTORY_CUTOFF_MS = 60 * 24 * 60 * 60 * 1000;
  if (ts && ts * 1000 < Date.now() - HISTORY_CUTOFF_MS) {
    return;
  }

  const preview = type === "text"
    ? content.slice(0, 140)
    : content.slice(0, 140) || `[${type}]`;

  // Ecos outbound carregam o pushName da própria empresa ("Você") — somente
  // mensagens inbound carregam o nome real do contato.
  // Names that are just digits are LID identifiers, not real names.
  const rawPushName = !fromMe ? raw.pushName ?? null : null;
  const pushName = rawPushName && !/^\d{8,}$/.test(rawPushName) ? rawPushName : null;

  const contactId = await upsertContact(supabase, phone, lid, pushName, jid);
  console.info(fromMe ? "EVOLUTION_MESSAGE_RECEIVED_OUTBOUND" : "EVOLUTION_MESSAGE_RECEIVED_INBOUND", evolutionId);
  const conversationId = await upsertConversation(supabase, contactId, instanceId);

  let mediaUrl: string | null = null;
  if (mediaMessage) {
    const base64 = await downloadMediaBase64(instanceName, raw);
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
      status: "sent",
    },
    { onConflict: "conversation_id, evolution_message_id", ignoreDuplicates: true },
  );

  if (error) {
    console.error("EVOLUTION_MESSAGE_INSERT_FAILED", error.message, { conversationId, evolutionId });
  } else {
    console.info("EVOLUTION_MESSAGE_CREATED", evolutionId);
  }

  await supabase.rpc("bump_conversation", {
    p_id: conversationId,
    p_sent_at: sentAt,
    p_preview: preview,
    p_inbound: !fromMe,
  });

  // SDR IA: process inbound messages if enabled
  if (!fromMe && phone) {
    try {
      const { data: sdrSettings } = await supabase
        .from("sdr_settings")
        .select("enabled, test_mode, cooldown_seconds")
        .limit(1)
        .single()

      if (sdrSettings?.enabled && !sdrSettings?.test_mode) {
        const { data: sdrConv } = await supabase
          .from("sdr_conversations")
          .select("status, last_auto_reply_at")
          .eq("conversation_id", conversationId)
          .maybeSingle()

        const isPaused = sdrConv && ["paused_human", "completed", "transferred"].includes(sdrConv.status)
        const inCooldown = sdrConv?.last_auto_reply_at && 
          (Date.now() - new Date(sdrConv.last_auto_reply_at).getTime() < (sdrSettings.cooldown_seconds ?? 5) * 1000)

        if (!isPaused && !inCooldown) {
          await callSDREngine(supabase, conversationId, contactId, content, instanceName, evolutionId)
        }
      }
    } catch (e) {
      console.error("SDR_INTEGRATION_ERROR", String(e), e?.stack)
    }
  }
}

// ---------------------------------------------------------------------------
// SDR Engine helper
// ---------------------------------------------------------------------------

async function callSDREngine(
  supabase: Supabase,
  conversationId: string,
  contactId: string | null,
  messageContent: string,
  instanceName: string,
  messageId: string | null,
): Promise<void> {
  console.info("SDR_ENGINE_CALL_START", { conversationId, instanceName, messageId })
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sdr-engine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        action: "process_message",
        data: {
          conversation_id: conversationId,
          contact_id: contactId,
          message_content: messageContent,
          instance_name: instanceName,
          message_id: messageId,
        },
      }),
    })

    if (res.ok) {
      const result = await res.json()
      console.info("SDR_ENGINE_RESULT", { action: result.action, hasResponse: !!result.response })
      if (result.response && result.action !== "skip" && result.action !== "error") {
        // Save SDR response to messages table FIRST (so context is available)
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          direction: "outbound",
          type: "text",
          content: result.response,
          sent_at: new Date().toISOString(),
          status: "sent",
        }).then(() => {}, () => {})

        // Send via Evolution API
        const apiKey = Deno.env.get("EVOLUTION_API_KEY") ?? ""
        const apiUrl = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/+$/, "")
        const phone = await getContactPhone(supabase, contactId)
        if (phone) {
          await fetch(`${apiUrl}/message/sendText/${instanceName}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "apikey": apiKey },
            body: JSON.stringify({ number: phone, text: result.response }),
          })
        }

        // Update SDR conversation state
        await supabase
          .from("sdr_conversations")
          .upsert({
            conversation_id: conversationId,
            contact_id: contactId,
            status: "active",
            last_auto_reply_at: new Date().toISOString(),
          }, { onConflict: "conversation_id" })
          .then(() => {}, () => {})

        // Increment message count
        await supabase.rpc("increment_sdr_count", { p_conv_id: conversationId }).then(() => {}, () => {})
      }
    }
  } catch (e) {
    console.error("SDR_ENGINE_ERROR", e)
  }
}

async function getContactPhone(supabase: Supabase, contactId: string | null): Promise<string | null> {
  if (!contactId) return null
  const { data } = await supabase
    .from("contacts")
    .select("phone")
    .eq("id", contactId)
    .single()
  return data?.phone ?? null
}

// ---------------------------------------------------------------------------
// Atualização de status (messages.update) — confirmação de entrega/leitura
// ---------------------------------------------------------------------------

async function handleMessageUpdate(
  supabase: Supabase,
  instanceName: string,
  data: StatusUpdate[] | StatusUpdate | null,
): Promise<Response> {
  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("instance_name", instanceName)
    .maybeSingle();
  if (!instance) {
    return jsonResponse(200, { ok: true, skipped: "unknown instance" });
  }

  const list: StatusUpdate[] = Array.isArray(data) ? data : data ? [data] : [];
  let updated = 0;
  for (const upd of list) {
    const status = STATUS_MAP[Number(upd.status)];
    if (!status) continue;
    const evolutionId = upd.key?.id ?? null;
    if (!evolutionId) continue;

    // Aplica apenas a mensagens que enviamos (receipts de entrega/leitura).
    if (upd.key?.fromMe === false) continue;

    const identity = normalizeWhatsAppIdentity({
      remoteJid: upd.key?.remoteJid,
      remoteJidAlt: upd.key?.remoteJidAlt,
      senderPn: upd.key?.senderPn,
    });
    const { phone, lid } = identity;
    if (!phone && !lid) continue;

    // Localiza o contato (somente leitura — um status nunca cria contato).
    let contactId: string | null = null;
    if (lid) {
      const { data: c } = await supabase
        .from("contacts")
        .select("id")
        .eq("lid", lid)
        .maybeSingle();
      if (c) contactId = c.id;
    }
    if (!contactId && phone) {
      const { data: c } = await supabase
        .from("contacts")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();
      if (c) contactId = c.id;
    }
    if (!contactId) continue;

    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("contact_id", contactId)
      .eq("instance_id", instance.id)
      .maybeSingle();
    if (!conv) continue;

    const { error } = await supabase.rpc("update_message_status", {
      p_conversation_id: conv.id,
      p_evolution_message_id: evolutionId,
      p_status: status,
    });
    if (error) {
      console.error("EVOLUTION_STATUS_UPDATE_FAILED", error.message);
    } else {
      updated += 1;
    }
  }
  return jsonResponse(200, { ok: true, updated });
}

// ---------------------------------------------------------------------------
// Conexão
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

  console.info("EVOLUTION_CONNECTION_UPDATE", instanceName, `state=${state}`, `status=${status}`);

  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("id, status")
    .eq("instance_name", instanceName)
    .maybeSingle();
  if (instance) {
    if (instance.status !== status) {
      const { error } = await supabase
        .from("whatsapp_instances")
        .update({ status })
        .eq("id", instance.id);
      if (error) console.error("EVOLUTION_INSTANCE_STATUS_FAILED", error.message);
    }
    // Reconexão (não-open → open): sinais de queda de entrega. Reconcilia o
    // histórico recente em background — o dedup por evolution_message_id
    // descarta o que já foi importado.
    if (status === "connected" && instance.status !== "connected") {
      try {
        const job = reconcileInstanceMessages(supabase, instanceName, instance.id);
        const g = globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } };
        if (g.EdgeRuntime?.waitUntil) {
          g.EdgeRuntime.waitUntil(job);
        } else {
          job.catch(() => {});
        }
      } catch (err) {
        console.warn("EVOLUTION_RECONCILE_KICK_FAILED", String(err));
      }
    }
  }
  return jsonResponse(200, { ok: true, status });
}

// ---------------------------------------------------------------------------
// Reconciliação pós-reconexão
// ---------------------------------------------------------------------------

// Quedas de entrega (Evolution↔WhatsApp ou Evolution→webhook) fazem mensagens
// chegarem ao WhatsApp sem nunca invocar este webhook — buraco silencioso que
// já perdeu mensagens reais de clientes. Ao reconectar, reimportamos as
// últimas mensagens das conversas movimentadas na janela. Best-effort.
//
// A fonte da verdade é a store da EVOLUTION (`findChats`), não o banco do CRM:
// leads novos (primeira mensagem de anúncio) não têm conversa no Postgres e
// eram justamente os que sumiam. O dedup por evolution_message_id torna o
// reprocesso idempotente.
const RECONCILE_WINDOW_DAYS = 3;
const RECONCILE_MAX_CONVERSATIONS = 60;
const RECONCILE_FETCH_LIMIT = 30;
const RECONCILE_FETCH_TIMEOUT_MS = 8000;
const RECONCILE_FINDCHATS_TIMEOUT_MS = 15000;

/** Normaliza as formas de resposta do fetchMessages para uma lista de linhas. */
function extractMessageRows(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return Array.isArray(payload) ? [] : [];
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === "object");
  const obj = payload as Record<string, unknown>;
  const container = (obj.message ?? obj.messages ?? obj.data ?? obj.response) as unknown;
  if (Array.isArray(container)) return container.filter((x) => x && typeof x === "object");
  if (container && typeof container === "object" && Array.isArray((container as Record<string, unknown>).records)) {
    return ((container as Record<string, unknown>).records as unknown[]).filter(
      (x) => x && typeof x === "object",
    ) as Record<string, unknown>[];
  }
  return [];
}

/**
 * JID remoto da conversa conforme a store da Evolution: preferimos o jid
 * confirmado do contato; fallback é montar do telefone canônico.
 */
function conversationRemoteJid(contact: { jid?: string | null; phone?: string | null; lid?: string | null }): string | null {
  if (contact.jid) {
    const type = contact.jid.split("@")[1] ?? "";
    if (type === "s.whatsapp.net" || type === "lid") return contact.jid;
  }
  if (contact.phone) return `${contact.phone}@s.whatsapp.net`;
  if (contact.lid) return `${contact.lid.replace(/^lid:/, "")}@lid`;
  return null;
}

async function reconcileInstanceMessages(
  supabase: Supabase,
  instanceName: string,
  instanceId: string,
): Promise<void> {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) return;
  const started = Date.now();
  const sinceSec = Math.floor((started - RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000);

  // 1) Fonte primária: a store da Evolution (inclui conversas que o CRM nunca viu).
  const remoteJids: string[] = [];
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/chat/findChats/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
      body: "{}",
      signal: AbortSignal.timeout(RECONCILE_FINDCHATS_TIMEOUT_MS),
    });
    if (res.ok) {
      const json = await res.json().catch(() => null);
      const chats: any[] = Array.isArray(json) ? json : (json?.chats ?? json?.response ?? []);
      const scored = chats
        .filter((c) => c && !c.isGroup)
        .map((c) => ({
          jid: String(c.remoteJid ?? c.id ?? ""),
          ts: Number(c.conversationTimestamp ?? c.lastMessage?.messageTimestamp ?? c.lastMsgTimestamp ?? 0),
        }))
        .filter(({ jid, ts }) => /@(s\.whatsapp\.net|lid)$/.test(jid) && ts >= sinceSec)
        .sort((a, b) => b.ts - a.ts);
      for (const { jid } of scored) {
        if (remoteJids.length >= RECONCILE_MAX_CONVERSATIONS) break;
        remoteJids.push(jid);
      }
    }
  } catch (err) {
    console.warn("EVOLUTION_RECONCILE_FINDCHATS_FAILED", String(err));
  }

  // 2) Fallback: se a store não respondeu, usa as conversas do banco (comportamento antigo).
  if (remoteJids.length === 0) {
    const since = new Date(started - RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, last_message_at, contact:contacts(jid, phone, lid)")
      .eq("instance_id", instanceId)
      .gte("last_message_at", since)
      .order("last_message_at", { ascending: false })
      .limit(RECONCILE_MAX_CONVERSATIONS);
    for (const conv of (convs ?? []) as unknown as Array<{
      id: string;
      contact?: { jid?: string | null; phone?: string | null; lid?: string | null } | null;
    }>) {
      const jid = conversationRemoteJid(conv.contact ?? {});
      if (jid) remoteJids.push(jid);
    }
  }

  if (remoteJids.length === 0) return;

  console.info("EVOLUTION_RECONCILE_STARTED", instanceName, `chats=${remoteJids.length}`);
  let fetched = 0;
  let processed = 0;

  for (const remoteJid of remoteJids) {
    let res: Response;
    try {
      res = await fetch(`${EVOLUTION_API_URL}/chat/findMessages/${instanceName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
        body: JSON.stringify({ page: 1, limit: RECONCILE_FETCH_LIMIT, remoteJid }),
        signal: AbortSignal.timeout(RECONCILE_FETCH_TIMEOUT_MS),
      });
    } catch {
      continue; // instância indisponível / timeout — próxima conversa
    }
    if (!res.ok) continue;

    const items = extractMessageRows(await res.json().catch(() => null));
    fetched += items.length;
    for (const item of items) {
      // Linha da store Baileys tem a mesma forma de um item MESSAGES_UPSERT.
      await processMessage(supabase, instanceId, instanceName, item as unknown as RawMessage);
      processed += 1;
    }
  }

  console.info(
    "EVOLUTION_RECONCILE_DONE",
    instanceName,
    `fetched=${fetched}`,
    `processed=${processed}`,
    `ms=${Date.now() - started}`,
  );
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

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
    return jsonResponse(200, { ok: true, skipped: "unknown instance" });
  }

  const list: RawMessage[] = Array.isArray(data)
    ? data
    : data
    ? [data]
    : [];

  // Concorrência limitada para lotes grandes de histórico.
  const BATCH = 10;
  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    await Promise.allSettled(
      chunk.map((raw) => processMessage(supabase, instance.id, instanceName, raw)),
    );
  }
  return jsonResponse(200, { ok: true, processed: list.length });
}

// ---------------------------------------------------------------------------
// Contatos (address book)
// ---------------------------------------------------------------------------

// Ingest da lista de contatos (`contacts.set`/`contacts.upsert`). A agenda é
// importada como contatos do CRM; entradas LID mantêm o LID e o telefone real
// quando o servidor fornece (`number` ou um remoteJid baseado em telefone).
async function handleContacts(
  supabase: Supabase,
  data:
    | Array<{ id?: string; pushName?: string; number?: string; remoteJid?: string }>
    | { id?: string; pushName?: string; number?: string; remoteJid?: string }
    | null,
): Promise<Response> {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  let processed = 0;
  for (const contact of list) {
    const jid = contact.remoteJid ?? "";

    let phone: string | null = null;
    let lid: string | null = null;

    const identity = normalizeWhatsAppIdentity({ remoteJid: jid });
    if (identity.phone) {
      phone = identity.phone;
    } else if (identity.lid) {
      lid = identity.lid;
      // Para LID, o telefone real (quando disponível) vem em `number`.
      phone = normalizePhoneStrict(contact.number);
    } else {
      // Sem remoteJid utilizável — cai no `number`.
      phone = normalizePhoneStrict(contact.number);
    }

    if (!phone && !lid) continue;
    try {
      await upsertContact(supabase, phone, lid, contact.pushName ?? null, jid || null);
      processed += 1;
    } catch (err) {
      console.error("EVOLUTION_CONTACT_IMPORT_FAILED", err);
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

  // Fail-closed: sem WEBHOOK_SECRET configurado, rejeita tudo. Sem isso um
  // deploy mal configurado aceitaria payloads não autenticados.
  if (!WEBHOOK_SECRET) {
    return jsonResponse(500, { error: "webhook secret not configured" });
  }

  try {
    const url = new URL(req.url);
    if (url.searchParams.get("token") !== WEBHOOK_SECRET) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    const payload = await req.json();
    const event = String(payload.event ?? "");
    const instanceName = String(payload.instance ?? "");
    // Rastro de ingestão: sem isso, quedas de entrega ficam invisíveis
    // (foi exatamente o bug do chat "perdido" das 21:07).
    console.info("EVOLUTION_EVENT_RECEIVED", event, instanceName);
    const supabase = serviceClient();

    switch (event) {
      case "connection.update":
        return await handleConnectionUpdate(supabase, instanceName, payload.data);
      case "messages.upsert":
      case "messages.set":
        return await handleMessages(supabase, instanceName, payload.data);
      case "messages.update":
        return await handleMessageUpdate(supabase, instanceName, payload.data);
      case "contacts.set":
      case "contacts.upsert":
        return await handleContacts(supabase, payload.data);
      default:
        return jsonResponse(200, { ok: true, ignored: event });
    }
  } catch (err) {
    console.error("EVOLUTION_WEBHOOK_ERROR", err);
    return jsonResponse(500, { error: "internal error" });
  }
});