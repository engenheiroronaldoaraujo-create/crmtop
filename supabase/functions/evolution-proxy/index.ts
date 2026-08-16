import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";

const STORAGE_BUCKET = "whatsapp-media";
const WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_SET",
  "CONTACTS_SET",
  "CONTACTS_UPSERT",
  "CONNECTION_UPDATE",
];

// Evolution validates the webhook/set payload against a JSON schema that
// requires a nested `webhook` object (v1-style schema, used by this server).
function webhookPayload(url: string): Record<string, unknown> {
  return {
    webhook: {
      enabled: true,
      url,
      events: WEBHOOK_EVENTS,
    },
  };
}

// This Evolution server validates /settings/set against a JSON schema that
// requires the settings fields directly at the root of the body (no wrapper)
// and requires ALL of them (v1-style). Sending only syncFullHistory would 400.
function syncSettingsPayload(): Record<string, unknown> {
  return {
    rejectCall: false,
    msgCall: "",
    groupsIgnore: false,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: true,
    wavoipToken: "",
  };
}

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type Supabase = ReturnType<typeof serviceClient>;

// Validates the caller JWT (any authenticated user) and resolves the profile.
async function requireUser(
  req: Request,
  supabase: Supabase,
): Promise<{ id: string; role: string }> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw jsonResponse(401, { error: "missing token" });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw jsonResponse(401, { error: "invalid token" });

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) throw jsonResponse(403, { error: "profile not found" });
  return profile;
}

async function requireAdmin(profile: { role: string }): Promise<void> {
  if (profile.role !== "admin") {
    throw jsonResponse(403, { error: "forbidden: admin role required" });
  }
}

async function getInstanceName(supabase: Supabase, instanceId: string): Promise<string> {
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("instance_name, phone_number")
    .eq("id", instanceId)
    .maybeSingle();
  if (!data) throw jsonResponse(404, { error: "instance not found" });
  return data.instance_name;
}

async function callEvolution(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ res: Response; data: any; text: string }> {
  const res = await fetch(`${EVOLUTION_API_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: EVOLUTION_API_KEY,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { res, data, text };
}

async function upsertContact(
  supabase: Supabase,
  phone: string | null,
  lid: string | null,
  pushName: string | null,
  jid: string | null = null,
): Promise<string> {
  let existing: { id: string; phone: string | null; lid: string | null; push_name: string | null; jid: string | null } | null = null;

  if (lid) {
    const { data } = await supabase
      .from("contacts")
      .select("id, phone, lid, push_name, jid")
      .eq("lid", lid)
      .maybeSingle();
    if (data) existing = data;
  }

  if (!existing && phone) {
    const { data } = await supabase
      .from("contacts")
      .select("id, phone, lid, push_name, jid")
      .eq("phone", phone)
      .maybeSingle();
    if (data) existing = data;
  }

  if (!existing && lid) {
    // Legacy: pre-LID data stored the LID inside `phone` as `lid:<digits>`.
    const { data } = await supabase
      .from("contacts")
      .select("id, phone, lid, push_name, jid")
      .eq("phone", `lid:${lid.replace(/^lid:/, "")}`)
      .maybeSingle();
    if (data) existing = data;
  }

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (pushName && existing.push_name !== pushName) patch.push_name = pushName;
    if (jid && existing.jid !== jid) patch.jid = jid;
    if (phone && !existing.phone) patch.phone = phone;
    if (lid && existing.lid !== lid) patch.lid = lid;
    if (Object.keys(patch).length > 0) {
      await supabase.from("contacts").update(patch).eq("id", existing.id);
    }
    return existing.id;
  }
  const { data, error } = await supabase
    .from("contacts")
    .insert({ phone, lid, push_name: pushName ?? null, name: pushName ?? null, jid })
    .select("id")
    .single();
  if (error) {
    const filter = lid ? { field: "lid", value: lid } : phone ? { field: "phone", value: phone } : null;
    if (filter) {
      const { data: again } = await supabase.from("contacts").select("id").eq(filter.field, filter.value).maybeSingle();
      if (again) return again.id;
    }
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

function sanitizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

// Records an outbound message. Uses upsert on (conversation_id,
// evolution_message_id) so that if the webhook echo won the race first, we
// still attach the correct sender_profile_id.
async function recordOutboundMessage(
  supabase: Supabase,
  instanceId: string,
  phone: string | null,
  lid: string | null,
  userId: string,
  msg: {
    evolutionId: string | null;
    type: string;
    content: string | null;
    mediaUrl: string | null;
    sentAt: string;
  },
): Promise<{ conversationId: string }> {
  const contactId = await upsertContact(supabase, phone, lid, null);
  const conversationId = await upsertConversation(supabase, contactId, instanceId);

  await supabase.from("messages").upsert(
    {
      conversation_id: conversationId,
      evolution_message_id: msg.evolutionId,
      direction: "outbound",
      sender_profile_id: userId,
      type: msg.type,
      content: msg.content,
      media_url: msg.mediaUrl,
      sent_at: msg.sentAt,
    },
    { onConflict: "conversation_id, evolution_message_id" },
  );

  await supabase.rpc("bump_conversation", {
    p_id: conversationId,
    p_sent_at: msg.sentAt,
    p_preview: (msg.content ?? `[${msg.type}]`).slice(0, 140),
    p_inbound: false,
  });

  return { conversationId };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function actionCreateInstance(
  supabase: Supabase,
  body: { instance_name?: string; phone_number?: string },
): Promise<Response> {
  const instance_name = (body.instance_name ?? "").trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(instance_name)) {
    return jsonResponse(400, { error: "instance_name must be alphanumeric (letters, numbers, - and _)" });
  }

  const { data: existing } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("instance_name", instance_name)
    .maybeSingle();
  if (existing) return jsonResponse(400, { error: "instance_name already in use" });

  // Persist first so the webhook can always find the row.
  const { data: row, error: insertError } = await supabase
    .from("whatsapp_instances")
    .insert({ instance_name, status: "connecting", phone_number: body.phone_number ?? null })
    .select("id")
    .single();
  if (insertError) return jsonResponse(400, { error: insertError.message });

  try {
    const { res, data } = await callEvolution("/instance/create", {
      method: "POST",
      body: {
        instanceName: instance_name,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        number: body.phone_number ?? undefined,
      },
    });
    if (!res.ok) {
      await supabase.from("whatsapp_instances").update({ status: "disconnected" }).eq("id", row.id);
      return jsonResponse(res.status, { error: `evolution create failed: ${JSON.stringify(data?.error ?? data)}` });
    }

    // syncFullHistory gives the ~60 day history pull (coverage is decided by WhatsApp).
    await callEvolution(`/settings/set/${instance_name}`, {
      method: "POST",
      body: syncSettingsPayload(),
    });

    // Point Evolution at our webhook.
    const webhookUrl = `${SUPABASE_URL}/functions/v1/evolution-webhook?token=${WEBHOOK_SECRET}`;
    const wh = await callEvolution(`/webhook/set/${instance_name}`, {
      method: "POST",
      body: webhookPayload(webhookUrl),
    });

    return jsonResponse(200, {
      instance: { id: row.id, instance_name },
      qrcode: data?.qrcode ?? null,
      webhook: wh.res.ok ? { ok: true, url: webhookUrl } : { ok: false, error: JSON.stringify(wh.data?.error ?? wh.data) },
    });
  } catch (err) {
    console.error("create-instance error", err);
    await supabase.from("whatsapp_instances").update({ status: "disconnected" }).eq("id", row.id);
    return jsonResponse(500, { error: "failed to create instance on Evolution" });
  }
}

async function actionGetQr(
  supabase: Supabase,
  body: { instance_id?: string },
): Promise<Response> {
  const instance_name = await getInstanceName(supabase, body.instance_id ?? "");
  const { res, data } = await callEvolution(`/instance/connect/${instance_name}`, {
    method: "GET",
  });
  if (!res.ok) {
    return jsonResponse(res.status, { error: `evolution connect failed: ${JSON.stringify(data?.error ?? data)}` });
  }
  return jsonResponse(200, {
    qrcode: { base64: data?.base64 ?? null, code: data?.code ?? null, pairingCode: data?.pairingCode ?? null },
  });
}

async function actionGetStatus(
  supabase: Supabase,
  body: { instance_id?: string },
): Promise<Response> {
  const instance_name = await getInstanceName(supabase, body.instance_id ?? "");
  const { res, data } = await callEvolution(`/instance/connectionState/${instance_name}`, {
    method: "GET",
  });
  const state = String(data?.instance?.state ?? "").toLowerCase();
  let status = "disconnected";
  if (state === "open") status = "connected";
  else if (state === "connecting" || state === "pairing") status = "connecting";

  await supabase
    .from("whatsapp_instances")
    .update({ status })
    .eq("id", body.instance_id);

  return jsonResponse(200, { status, raw: state });
}

async function actionSendText(
  supabase: Supabase,
  user: { id: string },
  body: { instance_id?: string; phone?: string; text?: string },
): Promise<Response> {
  const text = (body.text ?? "").trim();
  if (!text) return jsonResponse(400, { error: "text is required" });
  if (!body.phone) return jsonResponse(400, { error: "phone is required" });

  const instance_name = await getInstanceName(supabase, body.instance_id ?? "");

  // Resolve the contact to decide the send target: real phone when available,
  // otherwise the LID (Evolution recent versions accept `lid:<digits>`).
  const phoneDigits = sanitizePhone(body.phone ?? "");
  let sendTarget: string | null = null;
  let contactPhone: string | null = null;
  let contactLid: string | null = null;

  const { data: contact } = await supabase
    .from("contacts")
    .select("phone, lid")
    .or(`phone.eq.${phoneDigits},lid.eq.lid:${phoneDigits}`)
    .maybeSingle();

  if (contact) {
    contactPhone = contact.phone ?? null;
    contactLid = contact.lid ?? null;
  } else {
    // No existing contact row: the provided number is a plain phone.
    contactPhone = phoneDigits;
  }

  if (contactPhone) sendTarget = contactPhone;
  else if (contactLid) sendTarget = `lid:${contactLid.replace(/^lid:/, "")}`;

  if (!sendTarget) return jsonResponse(400, { error: "no phone or LID for this contact" });

  const { res, data, text: respText } = await callEvolution(`/message/sendText/${instance_name}`, {
    method: "POST",
    body: { number: sendTarget, text },
  });
  if (!res.ok) {
    return jsonResponse(res.status, { error: `evolution sendText failed: ${respText}` });
  }

  const evolutionId = data?.key?.id ?? null;
  const sentAt = new Date().toISOString();
  const { conversationId } = await recordOutboundMessage(supabase, body.instance_id!, contactPhone, contactLid, user.id, {
    evolutionId,
    type: "text",
    content: text,
    mediaUrl: null,
    sentAt,
  });

  return jsonResponse(200, {
    ok: true,
    message: { conversation_id: conversationId, evolution_message_id: evolutionId, sent_at: sentAt },
  });
}

async function actionSendMedia(
  supabase: Supabase,
  user: { id: string },
  formData: FormData,
): Promise<Response> {
  const instance_id = String(formData.get("instance_id") ?? "");
  const caption = String(formData.get("caption") ?? "");
  const file = formData.get("file") as Blob | null;
  if (!instance_id) return jsonResponse(400, { error: "instance_id is required" });
  if (!formData.get("phone")) return jsonResponse(400, { error: "phone is required" });
  if (!file || file.size === 0) return jsonResponse(400, { error: "file is required" });

  const instance_name = await getInstanceName(supabase, instance_id);
  const phoneDigits = sanitizePhone(String(formData.get("phone") ?? ""));

  // Resolve contact target: real phone when available, otherwise LID.
  let sendTarget: string | null = null;
  let contactPhone: string | null = null;
  let contactLid: string | null = null;
  const { data: contact } = await supabase
    .from("contacts")
    .select("phone, lid")
    .or(`phone.eq.${phoneDigits},lid.eq.lid:${phoneDigits}`)
    .maybeSingle();
  if (contact) {
    contactPhone = contact.phone ?? null;
    contactLid = contact.lid ?? null;
  } else {
    contactPhone = phoneDigits;
  }
  if (contactPhone) sendTarget = contactPhone;
  else if (contactLid) sendTarget = `lid:${contactLid.replace(/^lid:/, "")}`;
  if (!sendTarget) return jsonResponse(400, { error: "no phone or LID for this contact" });

  const fileType = file.type ?? "";
  let mediatype = "document";
  if (fileType.startsWith("image/")) mediatype = "image";
  else if (fileType.startsWith("video/")) mediatype = "video";
  else if (fileType.startsWith("audio/")) mediatype = "audio";
  const fileName = String(formData.get("fileName") ?? "file");

  const form = new FormData();
  form.append("number", sendTarget);
  form.append("mediatype", mediatype);
  form.append("media", file, fileName);
  if (caption) form.append("caption", caption);
  if (fileName) form.append("fileName", fileName);

  const res = await fetch(`${EVOLUTION_API_URL}/message/sendMedia/${instance_name}`, {
    method: "POST",
    headers: { apikey: EVOLUTION_API_KEY },
    body: form,
  });
  const resText = await res.text();
  let data: any = null;
  try {
    data = resText ? JSON.parse(resText) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    return jsonResponse(res.status, { error: `evolution sendMedia failed: ${resText}` });
  }

  const evolutionId = data?.key?.id ?? null;
  const sentAt = new Date().toISOString();

  let mediaUrl: string | null = null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = (fileName.split(".").pop() ?? "bin").toLowerCase().slice(0, 8);
    const objectPath = `messages/${evolutionId ?? crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(objectPath, bytes, { contentType: fileType || "application/octet-stream", upsert: true });
    if (!uploadError) mediaUrl = objectPath;
    else console.error("sendMedia storage upload failed", uploadError.message);
  } catch (err) {
    console.error("sendMedia storage error", err);
  }

  const typeMap: Record<string, string> = { image: "image", video: "video", audio: "audio", document: "document" };
  const { conversationId } = await recordOutboundMessage(supabase, instance_id, contactPhone, contactLid, user.id, {
    evolutionId,
    type: typeMap[mediatype] ?? "document",
    content: caption || null,
    mediaUrl,
    sentAt,
  });

  return jsonResponse(200, {
    ok: true,
    message: { conversation_id: conversationId, evolution_message_id: evolutionId, media_url: mediaUrl, sent_at: sentAt },
  });
}

// (Re)configures the Evolution webhook for an existing instance. Needed when an
// instance was created outside the app flow or the webhook was lost.
async function actionSetWebhook(
  supabase: Supabase,
  body: { instance_id?: string },
): Promise<Response> {
  const instance_name = await getInstanceName(supabase, body.instance_id ?? "");
  const webhookUrl = `${SUPABASE_URL}/functions/v1/evolution-webhook?token=${WEBHOOK_SECRET}`;
  const { res, text } = await callEvolution(`/webhook/set/${instance_name}`, {
    method: "POST",
    body: webhookPayload(webhookUrl),
  });
  if (!res.ok) {
    return jsonResponse(res.status, { error: `webhook config failed: ${text}` });
  }
  return jsonResponse(200, { ok: true, url: webhookUrl, events: WEBHOOK_EVENTS });
}

// Enables syncFullHistory on an existing instance so the ~60 day history is
// pulled on the next connection (coverage decided by WhatsApp). Best effort.
async function actionSyncHistory(
  supabase: Supabase,
  body: { instance_id?: string },
): Promise<Response> {
  const instance_name = await getInstanceName(supabase, body.instance_id ?? "");
  const { res, text } = await callEvolution(`/settings/set/${instance_name}`, {
    method: "POST",
    body: syncSettingsPayload(),
  });
  if (!res.ok) {
    return jsonResponse(res.status, { error: `syncFullHistory failed: ${text}` });
  }
  return jsonResponse(200, { ok: true, message: "syncFullHistory habilitado â€” reconecte a instÃ¢ncia para puxar o histÃ³rico" });
}

// Pulls the full WhatsApp address book from Evolution and imports it as
// contacts. Tries the v2 endpoint first, falls back to v1. The contact objects
// on this server carry the phone in `remoteJid` (not `number`).
async function actionSyncContacts(
  supabase: Supabase,
  body: { instance_id?: string },
): Promise<Response> {
  const instance_name = await getInstanceName(supabase, body.instance_id ?? "");

  let contacts: Array<{ id?: string; number?: string; remoteJid?: string; pushName?: string; isGroup?: boolean }> = [];
  const attempts: Array<() => Promise<{ res: Response; data: any; text: string }>> = [
    () => callEvolution(`/chat/findContacts/${instance_name}`, { method: "POST", body: {} }),
    () => callEvolution(`/contact/findContacts/${instance_name}`, { method: "GET" }),
  ];
  for (const attempt of attempts) {
    const { res, data, text } = await attempt();
    if (res.ok) {
      const list = Array.isArray(data) ? data : (data?.contacts ?? data?.data);
      if (Array.isArray(list)) {
        contacts = list;
        break;
      }
    } else {
      console.error("syncContacts attempt failed", text.slice(0, 300));
    }
  }

  if (contacts.length === 0) {
    return jsonResponse(400, { error: "falha ao buscar a lista de contatos da Evolution" });
  }

  // Bulk upsert (idempotent, fast). Phone-based rows key on `phone`; LID rows
  // key on `lid` — never store the LID in the phone column.
  const phoneRowsMap = new Map<string, { phone: string; push_name?: string | null; jid?: string | null }>();
  const lidRowsMap = new Map<string, { lid: string; phone?: string | null; push_name?: string | null; jid?: string | null }>();
  let withPhone = 0;
  let withLid = 0;
  for (const c of contacts) {
    const jid = c.remoteJid ?? "";
    const key = historyPhone(jid);
    if (!key) continue;
    if (!key.startsWith("lid:")) {
      withPhone += 1;
      if (!phoneRowsMap.has(key)) {
        phoneRowsMap.set(key, {
          phone: key,
          ...(c.pushName ? { push_name: c.pushName } : {}),
          jid: jid || null,
        });
      }
    } else {
      withLid += 1;
      // `number` (when present) may carry the real phone for LID contacts.
      // MUST normalize via normalizePhoneStrict — raw digits can be a LID
      // (14+ digits) which must NEVER be stored in the phone column.
      const phone = normalizePhoneStrict(c.number);
      if (!lidRowsMap.has(key)) {
        lidRowsMap.set(key, {
          lid: key,
          ...(phone ? { phone } : {}),
          ...(c.pushName ? { push_name: c.pushName } : {}),
          jid: jid || null,
        });
      }
    }
  }

  const CHUNK = 500;
  let imported = 0;
  const phoneRows = [...phoneRowsMap.values()];
  for (let i = 0; i < phoneRows.length; i += CHUNK) {
    const chunk = phoneRows.slice(i, i + CHUNK);
    const { error } = await supabase.from("contacts").upsert(chunk, { onConflict: "phone" });
    if (error) {
      console.error("syncContacts phone upsert failed", error.message);
      return jsonResponse(500, { error: `falha ao gravar contatos: ${error.message}` });
    }
    imported += chunk.length;
  }
  const lidRows = [...lidRowsMap.values()];
  for (let i = 0; i < lidRows.length; i += CHUNK) {
    const chunk = lidRows.slice(i, i + CHUNK);
    const { error } = await supabase.from("contacts").upsert(chunk, { onConflict: "lid" });
    if (error) {
      console.error("syncContacts lid upsert failed", error.message);
      return jsonResponse(500, { error: `falha ao gravar contatos: ${error.message}` });
    }
    imported += chunk.length;
  }

  // Backfill display names AND phones from the chat list. The findChats response
  // carries both pushName and lastMessage.key.remoteJidAlt (the real phone).
  // Falls back to the chat-level pushName for LID contacts with no lastMessage
  // — so a name is captured even when we never resolved a phone.
  //
  // Key fix: when a LID chat also exposes the real phone (via remoteJidAlt), we
  // upsert ON CONFLICT (lid) — attaching the phone to the SAME LID contact that
  // owns the conversation. The old code upserted ON CONFLICT (phone), which
  // created a separate phone contact and left the LID contact (and its
  // conversation) unidentified.
  let named = 0;
  try {
    const { res, data } = await callEvolution(`/chat/findChats/${instance_name}`, { method: "POST", body: {} });
    if (res.ok && Array.isArray(data)) {
      const namePhoneRows: Array<{ phone: string; push_name: string; jid: string }> = [];
      const lidRows: Array<{ lid: string; push_name: string | null; phone: string | null }> = [];
      for (const chat of data) {
        if (chat.isGroup) continue;
        const jid = chat.remoteJid ?? "";
        const isLid = jid.endsWith("@lid");
        const lidDigits = isLid ? jid.split("@")[0].replace(/[^\d]/g, "") : "";
        const pushName = (chat.pushName ?? chat.lastMessage?.pushName ?? "").trim();
        const pushLower = pushName.toLowerCase();
        if (pushLower === "você" || pushLower === "voce") continue;

        // Skip names that are just the contact's own LID digits (not a real name).
        if (lidDigits && pushName === lidDigits) continue;

        // Extract the real phone from the last message's remoteJidAlt.
        const lastMsgAlt = chat.lastMessage?.key?.remoteJidAlt ?? null;
        let phone: string | null = null;
        if (lastMsgAlt) {
          const clean = lastMsgAlt.endsWith("@s.whatsapp.net")
            ? lastMsgAlt.split("@")[0]
            : lastMsgAlt;
          phone = normalizePhoneStrict(clean);
        }

        if (isLid) {
          // Always enrich the LID contact (name and/or phone) on conflict lid.
          lidRows.push({
            lid: `lid:${lidDigits}`,
            push_name: pushName || null,
            phone,
          });
        } else if (phone) {
          namePhoneRows.push({ phone, push_name: pushName, jid });
        }
        // A chat with neither phone nor LID (e.g. @g.us already filtered) is skipped.
      }
      for (let i = 0; i < namePhoneRows.length; i += 200) {
        const chunk = namePhoneRows.slice(i, i + 200);
        const { error } = await supabase.from("contacts").upsert(chunk, { onConflict: "phone" });
        if (!error) named += chunk.length;
      }
      for (let i = 0; i < lidRows.length; i += 200) {
        const chunk = lidRows.slice(i, i + 200);
        // On conflict lid: set push_name AND backfill the phone when present.
        const { error } = await supabase
          .from("contacts")
          .upsert(chunk, { onConflict: "lid" });
        if (!error) named += chunk.length;
      }
    }
  } catch (err) {
    console.error("syncContacts name/phone backfill error", err);
  }

  return jsonResponse(200, { ok: true, total: contacts.length, withPhone, withLid, imported, named });
}

// Maps an Evolution message record to { type, content }. Mirrors the webhook's
// mapping (media is stored without the file during bulk sync).
function mapMessageRecord(rec: any): { type: string; content: string } {
  const msg = rec.message ?? {};
  const unwrap = (m: any): any => {
    if (m?.ephemeralMessage?.message) return unwrap(m.ephemeralMessage.message);
    if (m?.viewOnceMessage?.message) return unwrap(m.viewOnceMessage.message);
    if (m?.documentWithCaptionMessage?.message) return unwrap(m.documentWithCaptionMessage.message);
    return m;
  };
  const m = unwrap(msg);
  if (m?.conversation !== undefined) return { type: "text", content: String(m.conversation ?? "") };
  if (m?.extendedTextMessage) return { type: "text", content: String(m.extendedTextMessage.text ?? "") };
  const mediaTypes: Record<string, string> = {
    imageMessage: "image", audioMessage: "audio", videoMessage: "video",
    documentMessage: "document", stickerMessage: "sticker",
  };
  for (const [key, type] of Object.entries(mediaTypes)) {
    if (m?.[key]) {
      const md = m[key];
      const content = type === "document"
        ? String(md.fileName ?? md.caption ?? "")
        : String(md.caption ?? "");
      return { type, content };
    }
  }
  return { type: "unknown", content: "" };
}

// Merges a LID-only contact into an existing phone-based contact (the same
// person): moves conversations/messages, transfers the LID, deletes the dup.
async function mergeLidIntoPhone(
  supabase: Supabase,
  lidKey: string,
  phoneContactId: string,
): Promise<void> {
  const { data: lidContact } = await supabase
    .from("contacts")
    .select("id, push_name")
    .eq("lid", lidKey)
    .maybeSingle();
  if (!lidContact) return;
  const lidId = lidContact.id;

  const { data: phoneConvs } = await supabase
    .from("conversations")
    .select("id, instance_id")
    .eq("contact_id", phoneContactId);
  const phoneConvByInstance = new Map<string, string>(
    (phoneConvs ?? []).map((c: any) => [c.instance_id, c.id]),
  );
  const { data: lidConvs } = await supabase
    .from("conversations")
    .select("id, instance_id")
    .eq("contact_id", lidId);

  for (const lc of lidConvs ?? []) {
    const pc = phoneConvByInstance.get(lc.instance_id);
    if (pc) {
      // Move only messages not already present in the target conversation.
      const { data: msgs } = await supabase
        .from("messages")
        .select("id, evolution_message_id")
        .eq("conversation_id", lc.id);
      for (const m of msgs ?? []) {
        if (!m.evolution_message_id) {
          await supabase.from("messages").update({ conversation_id: pc }).eq("id", m.id);
          continue;
        }
        const { data: dup } = await supabase
          .from("messages")
          .select("id")
          .eq("conversation_id", pc)
          .eq("evolution_message_id", m.evolution_message_id)
          .maybeSingle();
        if (!dup) {
          await supabase.from("messages").update({ conversation_id: pc }).eq("id", m.id);
        }
      }
      await supabase.from("conversations").delete().eq("id", lc.id);
    } else {
      await supabase.from("conversations").update({ contact_id: phoneContactId }).eq("id", lc.id);
    }
  }

  const patch: Record<string, unknown> = {};
  if (lidContact.push_name) patch.push_name = lidContact.push_name;
  if (Object.keys(patch).length > 0) {
    await supabase.from("contacts").update(patch).eq("id", phoneContactId);
  }
  // Transfer the LID (best effort — a unique violation means another contact
  // already holds it; the webhook resolves it on the next message anyway).
  try {
    await supabase.from("contacts").update({ lid: lidKey }).eq("id", phoneContactId).is("lid", null);
  } catch (err) {
    console.error("lid transfer skipped", err instanceof Error ? err.message : err);
  }
  await supabase.from("contacts").delete().eq("id", lidId);
}

// CANONICAL phone rule (single source of truth). LIDs have 14–16 digits and
// must NEVER be treated as phones.
function normalizePhoneStrict(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d]/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length === 12 || digits.length === 13) return digits;
  return null;
}

// Returns the contact key for a JID: a strict phone (10–13 digits) or
// "lid:<digits>" (14+ digits). LIDs are never returned as phones.
function historyPhone(jid: string): string | null {
  if (jid.endsWith("@s.whatsapp.net")) {
    const d = jid.split("@")[0].replace(/[^\d]/g, "");
    const phone = normalizePhoneStrict(d);
    if (phone) return phone;
    if (d.length >= 14) return `lid:${d}`;
    return null;
  }
  if (jid.endsWith("@lid")) {
    const d = jid.split("@")[0].replace(/[^\d]/g, "");
    return d.length >= 8 ? `lid:${d}` : null;
  }
  return null;
}

// Resolve { phone, lid } from a message key. LID JIDs carry the real phone in
// `remoteJidAlt` / `senderPn`. LIDs (14+ digits) are never accepted as phones.
function resolveKeyIdentity(key: {
  remoteJid?: string;
  senderPn?: string;
  remoteJidAlt?: string;
}): { phone: string | null; lid: string | null } {
  const jid = key?.remoteJid ?? "";
  if (jid.endsWith("@s.whatsapp.net")) {
    const d = jid.split("@")[0].replace(/[^\d]/g, "");
    const phone = normalizePhoneStrict(d);
    if (phone) return { phone, lid: null };
    if (d.length >= 14) return { phone: null, lid: `lid:${d}` };
    return { phone: null, lid: null };
  }
  if (jid.endsWith("@lid")) {
    const lid = `lid:${jid.split("@")[0].replace(/[^\d]/g, "")}`;
    let phone: string | null = null;
    for (const candidate of [key?.senderPn, key?.remoteJidAlt]) {
      if (!candidate) continue;
      // A candidate that is itself a LID is never a phone.
      if (candidate.endsWith("@lid")) continue;
      const clean = candidate.endsWith("@s.whatsapp.net")
        ? candidate.split("@")[0]
        : candidate;
      const normalized = normalizePhoneStrict(clean);
      if (normalized) {
        phone = normalized;
        break;
      }
    }
    return { phone, lid };
  }
  return { phone: null, lid: null };
}

// Bulk-imports message history for an instance via POST /chat/findMessages
// (50/page, newest first). Idempotent (dedup by evolution_message_id); only the
// last 60 days are kept. Resumable: progress is stored in
// whatsapp_instances.sync_page so repeated invocations continue instead of
// restarting (each invocation is capped by the platform's ~150s timeout).
async function actionSyncMessages(
  supabase: Supabase,
  body: { instance_id?: string; max_pages?: number },
): Promise<Response> {
  const instance_name = await getInstanceName(supabase, body.instance_id ?? "");
  const instance_id = body.instance_id ?? "";
  const CUTOFF = Date.now() - 60 * 24 * 60 * 60 * 1000;

  const { data: inst } = await supabase
    .from("whatsapp_instances")
    .select("sync_page")
    .eq("id", instance_id)
    .single();
  let page = (inst?.sync_page ?? 0) + 1;
  const BUDGET = Math.min(body.max_pages ?? 500, 40); // keep each run under the timeout
  const pageCap = page + BUDGET;

  let importedMessages = 0;
  let newConversations = 0;
  let done = false;
  let pages = 0;


  while (!done && page < pageCap) {
    const { res, data, text } = await callEvolution(`/chat/findMessages/${instance_name}`, {
      method: "POST",
      body: { page },
    });
    if (!res.ok) {
      return jsonResponse(res.status, { error: `findMessages falhou (página ${page}): ${text.slice(0, 300)}` });
    }
    pages = data?.messages?.pages ?? 0;
    const records = data?.messages?.records;
    if (!Array.isArray(records) || records.length === 0) {
      done = true;
      break;
    }

    // Per-page bulk import: contacts, conversations, messages.
    const phoneContactMap = new Map<string, { phone: string; push_name?: string | null; jid?: string | null }>();
    const lidContactMap = new Map<string, { lid: string; phone?: string | null; push_name?: string | null; jid?: string | null }>();
    const pageRecords: any[] = [];

    let pageAllOld = true;
    for (const rec of records) {
      const jid = rec?.key?.remoteJid ?? "";
      const { phone, lid } = resolveKeyIdentity(rec.key ?? {});
      const key = phone ?? lid;
      if (!key) continue;
      const ts = rec.messageTimestamp ? Number(rec.messageTimestamp) : null;
      if (ts && ts * 1000 < CUTOFF) continue; // keep only last 60 days
      pageAllOld = false;
      const pushName = rec.pushName && !rec?.key?.fromMe ? String(rec.pushName) : undefined;
      if (lid) {
        // LID row (with the resolved phone when available) — so the existing
        // lid contact gets the phone backfilled instead of a new contact.
        if (!lidContactMap.has(lid)) {
          lidContactMap.set(lid, {
            lid,
            ...(phone ? { phone } : {}),
            ...(pushName ? { push_name: pushName } : {}),
            jid: jid || null,
          });
        }
      } else if (phone) {
        if (!phoneContactMap.has(phone)) {
          phoneContactMap.set(phone, { phone, ...(pushName ? { push_name: pushName } : {}), jid: jid || null });
        }
      }
      pageRecords.push(rec);
    }
    const phoneContactRows = [...phoneContactMap.values()];
    const lidContactRows = [...lidContactMap.values()];

    if (pageAllOld) {
      done = true;
      break;
    }

    // Contacts: bulk merge (creates new + backfills phone/lid on existing).
    for (let i = 0; i < phoneContactRows.length; i += 500) {
      const chunk = phoneContactRows.slice(i, i + 500);
      const { error } = await supabase
        .from("contacts")
        .upsert(chunk, { onConflict: "phone" });
      if (error) return jsonResponse(500, { error: `contacts upsert: ${error.message}` });
    }
    for (let i = 0; i < lidContactRows.length; i += 500) {
      const chunk = lidContactRows.slice(i, i + 500);
      // If a lid row's phone already belongs to a DIFFERENT contact (the same
      // person as a phone-based address book entry), MERGE the lid contact into
      // the phone contact instead of creating a duplicate.
      const safeChunk: Array<Record<string, unknown>> = [];
      for (const r of chunk) {
        if (r.phone) {
          const { data: existing } = await supabase
            .from("contacts")
            .select("id, lid")
            .eq("phone", r.phone)
            .maybeSingle();
          if (existing && existing.lid !== r.lid) {
            await mergeLidIntoPhone(supabase, String(r.lid), existing.id);
            continue;
          }
        }
        safeChunk.push(r);
      }
      if (safeChunk.length > 0) {
        const { error } = await supabase
          .from("contacts")
          .upsert(safeChunk, { onConflict: "lid" });
        if (error) return jsonResponse(500, { error: `contacts upsert: ${error.message}` });
      }
    }

    // Load contact ids by key (phone or lid) for the page.
    const contactIds = new Map<string, string>();
    if (phoneContactRows.length > 0) {
      const { data: existing } = await supabase
        .from("contacts")
        .select("phone,id")
        .in("phone", phoneContactRows.map((c) => c.phone));
      for (const c of existing ?? []) contactIds.set(c.phone, c.id);
    }
    if (lidContactRows.length > 0) {
      const { data: existing } = await supabase
        .from("contacts")
        .select("lid,id")
        .in("lid", lidContactRows.map((c) => c.lid));
      for (const c of existing ?? []) contactIds.set(c.lid, c.id);
    }

    // Conversations: bulk create-or-ignore returning contact_id -> id.
    const convRows = [...contactIds.entries()].map(([, contactId]) => ({ contact_id: contactId, instance_id }));
    const convByKey = new Map<string, string>();
    for (let i = 0; i < convRows.length; i += 200) {
      const chunk = convRows.slice(i, i + 200);
      const { data: convData, error } = await supabase
        .from("conversations")
        .upsert(chunk, { onConflict: "contact_id,instance_id", ignoreDuplicates: true })
        .select("id,contact_id");
      if (error) return jsonResponse(500, { error: `conversations upsert: ${error.message}` });
      const idByContact = new Map<string, string>();
      for (const [key, contactId] of contactIds) idByContact.set(contactId, key);
      for (const row of convData ?? []) {
        newConversations += 1;
        const key = idByContact.get(row.contact_id);
        if (key) convByKey.set(key, row.id);
      }
    }

    // Messages: build rows with conversation ids and bulk insert (dedup).
    const finalRows: any[] = [];
    for (const rec of pageRecords) {
      const { phone, lid } = resolveKeyIdentity(rec.key ?? {});
      const key = lid ?? phone;
      const convId = key ? convByKey.get(key) : undefined;
      if (!convId) continue;
      const ts = rec.messageTimestamp ? Number(rec.messageTimestamp) : null;
      const { type, content } = mapMessageRecord(rec);
      finalRows.push({
        conversation_id: convId,
        evolution_message_id: rec?.key?.id ?? null,
        direction: rec?.key?.fromMe ? "outbound" : "inbound",
        type,
        content: content || null,
        media_url: null,
        sent_at: ts ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
      });
    }
    for (let i = 0; i < finalRows.length; i += 200) {
      const chunk = finalRows.slice(i, i + 200);
      const { error } = await supabase.from("messages").upsert(chunk, {
        onConflict: "conversation_id,evolution_message_id",
        ignoreDuplicates: true,
      });
      if (error) return jsonResponse(500, { error: `messages upsert: ${error.message}` });
      importedMessages += chunk.length;
    }

    // Persist progress so a later invocation resumes here.
    await supabase.from("whatsapp_instances").update({ sync_page: page }).eq("id", instance_id);
    page += 1;
  }

  if (done) {
    await supabase.from("whatsapp_instances").update({ sync_page: Math.max(page, pages) }).eq("id", instance_id);
  }

  // Refresh every conversation's last_message_* from the real latest message.
  await supabase.rpc("refresh_conversation_previews", { p_instance_id: instance_id });

  return jsonResponse(200, {
    ok: true,
    done,
    page,
    totalPages: pages,
    newConversations,
    importedMessages,
  });
}

// Backfills contact display names from INBOUND message pushNames. WhatsApp
// often omits names from the contact/chat lists for unsaved users, but every
// inbound message carries the sender's name. Resumable via whatsapp_instances.sync_page.
async function actionSyncNames(
  supabase: Supabase,
  body: { instance_id?: string; max_pages?: number; reset?: boolean },
): Promise<Response> {
  const instance_name = await getInstanceName(supabase, body.instance_id ?? "");
  const instance_id = body.instance_id ?? "";

  const { data: inst } = await supabase
    .from("whatsapp_instances")
    .select("sync_page")
    .eq("id", instance_id)
    .single();
  let page = body.reset ? 1 : (inst?.sync_page ?? 0) + 1;
  const BUDGET = Math.min(body.max_pages ?? 500, 60);
  const pageCap = page + BUDGET;

  let named = 0;
  let done = false;
  let pages = 0;
  let lastError: string | null = null;

  while (!done && page < pageCap) {
    const { res, data, text } = await callEvolution(`/chat/findMessages/${instance_name}`, {
      method: "POST",
      body: { page },
    });
    if (!res.ok) {
      return jsonResponse(res.status, { error: `findMessages falhou (página ${page}): ${text.slice(0, 300)}` });
    }
    pages = data?.messages?.pages ?? 0;
    const records = data?.messages?.records;
    if (!Array.isArray(records) || records.length === 0) {
      done = true;
      break;
    }

    // Dedupe by key (phone or lid): the same contact appears multiple times per
    // page and ON CONFLICT DO UPDATE can't affect the same row twice in one
    // statement. Also capture the real phone (from remoteJidAlt/senderPn) for LID
    // contacts so they become identifiable.
    const nameMap = new Map<string, { push_name: string; lid?: boolean; phone?: string | null }>();
    for (const rec of records) {
      if (rec?.key?.fromMe) continue; // outbound echoes carry the business's own name
      const key = historyPhone(rec?.key?.remoteJid ?? "");
      const name = String(rec.pushName ?? "").trim();
      const lower = name.toLowerCase();
      if (!key || !name || lower === "você" || lower === "voce") continue;
      // Skip names that are just the contact's own identifier digits.
      if (name === key.replace(/^lid:/, "")) continue;
      if (!nameMap.has(key)) {
        const { phone } = resolveKeyIdentity(rec.key ?? {});
        nameMap.set(key, {
          push_name: name,
          lid: key.startsWith("lid:"),
          phone: key.startsWith("lid:") ? phone : undefined,
        });
      }
    }
    const namePhoneRows: Array<{ phone: string; push_name: string }> = [];
    const nameLidRows: Array<{ lid: string; push_name: string }> = [];
    for (const [key, v] of nameMap) {
      if (v.lid) nameLidRows.push({ lid: key, push_name: v.push_name });
      else namePhoneRows.push({ phone: key, push_name: v.push_name });
    }
    for (let i = 0; i < namePhoneRows.length; i += 200) {
      const chunk = namePhoneRows.slice(i, i + 200);
      const { error } = await supabase
        .from("contacts")
        .upsert(chunk, { onConflict: "phone" });
      if (error) {
        console.error("syncNames upsert failed", error.message);
        lastError = `${error.message} (page ${page})`;
      } else {
        named += chunk.length;
      }
    }
    for (let i = 0; i < nameLidRows.length; i += 200) {
      const chunk = nameLidRows.slice(i, i + 200);
      // On conflict lid: set push_name only. Do NOT re-write `phone` here — the
      // real phone for a LID (when available) is already merged in during
      // sync-messages; re-setting it here would collide with the separate
      // phone-based contact that owns that number (contacts_phone_key).
      const { error } = await supabase
        .from("contacts")
        .upsert(chunk, { onConflict: "lid" });
      if (error) {
        console.error("syncNames upsert failed", error.message);
        lastError = `${error.message} (page ${page})`;
      } else {
        named += chunk.length;
      }
    }

    await supabase.from("whatsapp_instances").update({ sync_page: page }).eq("id", instance_id);
    page += 1;
  }

  if (done) {
    await supabase.from("whatsapp_instances").update({ sync_page: Math.max(page, pages) }).eq("id", instance_id);
  }

  return jsonResponse(200, { ok: true, done, page, totalPages: pages, named, lastError });
}

// Links a conversation to a phone number the operator knows. If a contact with
// that phone exists, the LID contact is merged into it (conversations, messages
// and the LID move over). Otherwise the phone is set directly on the contact.
async function actionLinkConversationPhone(
  supabase: Supabase,
  body: { conversation_id?: string; phone?: string },
): Promise<Response> {
  const conversation_id = body.conversation_id ?? "";
  const phone = normalizePhoneStrict(body.phone);
  if (!conversation_id) return jsonResponse(400, { error: "conversation_id is required" });
  if (!phone) return jsonResponse(400, { error: "telefone inválido (use 10-13 dígitos)" });

  const { data: conv } = await supabase
    .from("conversations")
    .select("contact_id")
    .eq("id", conversation_id)
    .maybeSingle();
  if (!conv) return jsonResponse(404, { error: "conversa não encontrada" });

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, lid, phone")
    .eq("id", conv.contact_id)
    .maybeSingle();
  if (!contact) return jsonResponse(404, { error: "contato não encontrado" });

  const { data: phoneContact } = await supabase
    .from("contacts")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (phoneContact && phoneContact.id !== contact.id) {
    if (contact.lid) {
      await mergeLidIntoPhone(supabase, contact.lid, phoneContact.id);
    } else {
      const { data: phoneConvs } = await supabase
        .from("conversations")
        .select("id, instance_id")
        .eq("contact_id", phoneContact.id);
      const byInstance = new Map<string, string>((phoneConvs ?? []).map((c: any) => [c.instance_id, c.id]));
      const { data: convs } = await supabase
        .from("conversations")
        .select("id, instance_id")
        .eq("contact_id", contact.id);
      for (const c of convs ?? []) {
        const target = byInstance.get(c.instance_id);
        if (target) {
          await supabase.from("conversations").delete().eq("id", c.id);
        } else {
          await supabase.from("conversations").update({ contact_id: phoneContact.id }).eq("id", c.id);
        }
      }
      await supabase.from("contacts").delete().eq("id", contact.id);
    }
    return jsonResponse(200, { ok: true, merged: true, phone, contact_id: phoneContact.id });
  }

  await supabase.from("contacts").update({ phone }).eq("id", contact.id);
  return jsonResponse(200, { ok: true, merged: false, phone, contact_id: contact.id });
}

// TEMP: dump findChats structure to inspect lastMessage fields.
async function actionDebugChats(
  supabase: Supabase,
  body: { instance_id?: string; limit?: number },
): Promise<Response> {
  const instance_name = await getInstanceName(supabase, body.instance_id ?? "");
  const { res, data } = await callEvolution(`/chat/findChats/${instance_name}`, { method: "POST", body: {} });
  if (!res.ok) return jsonResponse(500, { error: "findChats failed" });
  const list = Array.isArray(data) ? data : [];
  const sample = list.slice(0, body.limit ?? 5).map((c: any) => ({
    remoteJid: c.remoteJid,
    pushName: c.pushName,
    lastMessageKeys: Object.keys(c.lastMessage ?? {}),
    lastMessageRemoteJidAlt: c.lastMessage?.key?.remoteJidAlt ?? null,
    lastMessageRemoteJid: c.lastMessage?.key?.remoteJid ?? null,
  }));
  return jsonResponse(200, { total: list.length, sample });
}

async function actionLogoutInstance(
  supabase: Supabase,
  body: { instance_id?: string },
): Promise<Response> {
  const instance_name = await getInstanceName(supabase, body.instance_id ?? "");
  const { res, data } = await callEvolution(`/instance/logout/${instance_name}`, {
    method: "DELETE",
  });
  await supabase.from("whatsapp_instances").update({ status: "disconnected" }).eq("id", body.instance_id);
  if (!res.ok) {
    return jsonResponse(res.status, { error: `evolution logout failed: ${JSON.stringify(data?.error ?? data)}` });
  }
  return jsonResponse(200, { ok: true });
}

// Removes the connection entirely: deletes the instance in Evolution, then
// deletes its conversations (and their messages) and the instance row. Contacts
// are kept (central entity, shared across instances).
async function actionDeleteInstance(
  supabase: Supabase,
  body: { instance_id?: string },
): Promise<Response> {
  const instance_id = body.instance_id ?? "";
  if (!instance_id) return jsonResponse(400, { error: "instance_id is required" });

  let instance_name: string | null = null;
  try {
    instance_name = await getInstanceName(supabase, instance_id);
  } catch {
    // Row may already be gone â€” still clean up Evolution below if possible.
  }

  if (instance_name) {
    try {
      await callEvolution(`/instance/delete/${instance_name}`, { method: "DELETE" });
    } catch (err) {
      console.error("evolution instance delete failed", err);
    }
  }

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id")
    .eq("instance_id", instance_id);
  const conversationIds = (conversations ?? []).map((c) => c.id);
  if (conversationIds.length > 0) {
    await supabase.from("messages").delete().in("conversation_id", conversationIds);
    await supabase.from("conversations").delete().in("id", conversationIds);
  }
  await supabase.from("whatsapp_instances").delete().eq("id", instance_id);

  return jsonResponse(200, { ok: true });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);

    const contentType = req.headers.get("content-type") ?? "";
    let body: any = {};
    let formData: FormData | null = null;
    if (contentType.includes("multipart/form-data")) {
      formData = await req.formData();
      const action = String(formData.get("action") ?? "");
      body = { action };
    } else {
      body = await req.json();
    }

    const { action } = body as { action: string };

    switch (action) {
      case "create-instance": {
        await requireAdmin(user);
        return await actionCreateInstance(supabase, body);
      }
      case "get-qr": {
        await requireAdmin(user);
        return await actionGetQr(supabase, body);
      }
      case "get-status": {
        return await actionGetStatus(supabase, body);
      }
      case "send-text": {
        return await actionSendText(supabase, user, body);
      }
      case "send-media": {
        if (!formData) return jsonResponse(400, { error: "send-media requires multipart/form-data" });
        return await actionSendMedia(supabase, user, formData);
      }
      case "logout-instance": {
        await requireAdmin(user);
        return await actionLogoutInstance(supabase, body);
      }
      case "delete-instance": {
        await requireAdmin(user);
        return await actionDeleteInstance(supabase, body);
      }
      case "set-webhook": {
        await requireAdmin(user);
        return await actionSetWebhook(supabase, body);
      }
      case "sync-history": {
        await requireAdmin(user);
        return await actionSyncHistory(supabase, body);
      }
      case "sync-contacts": {
        await requireAdmin(user);
        return await actionSyncContacts(supabase, body);
      }
      case "sync-messages": {
        await requireAdmin(user);
        return await actionSyncMessages(supabase, body);
      }
      case "sync-names": {
        await requireAdmin(user);
        return await actionSyncNames(supabase, body);
      }
      case "link-conversation-phone": {
        await requireAdmin(user);
        return await actionLinkConversationPhone(supabase, body);
      }
      case "debug-chats": {
        await requireAdmin(user);
        return await actionDebugChats(supabase, body);
      }
      default:
        return jsonResponse(400, { error: "unknown action" });
    }
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("evolution-proxy error", err);
    return jsonResponse(500, { error: err instanceof Error ? err.message : "internal error" });
  }
});
