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
  phone: string,
  pushName: string | null,
): Promise<string> {
  const { data: existing } = await supabase
    .from("contacts")
    .select("id, push_name")
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
    const { data: again } = await supabase.from("contacts").select("id").eq("phone", phone).maybeSingle();
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

function sanitizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

// Records an outbound message. Uses upsert on (conversation_id,
// evolution_message_id) so that if the webhook echo won the race first, we
// still attach the correct sender_profile_id.
async function recordOutboundMessage(
  supabase: Supabase,
  instanceId: string,
  phone: string,
  userId: string,
  msg: {
    evolutionId: string | null;
    type: string;
    content: string | null;
    mediaUrl: string | null;
    sentAt: string;
  },
): Promise<{ conversationId: string }> {
  const contactId = await upsertContact(supabase, phone, null);
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
  const phone = sanitizePhone(body.phone ?? "");
  const text = (body.text ?? "").trim();
  if (!phone) return jsonResponse(400, { error: "phone is required" });
  if (!text) return jsonResponse(400, { error: "text is required" });

  const instance_name = await getInstanceName(supabase, body.instance_id ?? "");
  // This Evolution server uses the v1 schema: `{ number, text }`.
  const { res, data, text: respText } = await callEvolution(`/message/sendText/${instance_name}`, {
    method: "POST",
    body: { number: phone, text },
  });
  if (!res.ok) {
    return jsonResponse(res.status, { error: `evolution sendText failed: ${respText}` });
  }

  const evolutionId = data?.key?.id ?? null;
  const sentAt = new Date().toISOString();
  const { conversationId } = await recordOutboundMessage(supabase, body.instance_id!, phone, user.id, {
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
  const phone = sanitizePhone(String(formData.get("phone") ?? ""));
  const caption = String(formData.get("caption") ?? "");
  const file = formData.get("file") as Blob | null;
  if (!instance_id) return jsonResponse(400, { error: "instance_id is required" });
  if (!phone) return jsonResponse(400, { error: "phone is required" });
  if (!file || file.size === 0) return jsonResponse(400, { error: "file is required" });

  const instance_name = await getInstanceName(supabase, instance_id);
  const fileType = file.type ?? "";
  let mediatype = "document";
  if (fileType.startsWith("image/")) mediatype = "image";
  else if (fileType.startsWith("video/")) mediatype = "video";
  else if (fileType.startsWith("audio/")) mediatype = "audio";
  const fileName = String(formData.get("fileName") ?? "file");

  const form = new FormData();
  form.append("number", phone);
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
  const { conversationId } = await recordOutboundMessage(supabase, instance_id, phone, user.id, {
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
  return jsonResponse(200, { ok: true, message: "syncFullHistory habilitado — reconecte a instância para puxar o histórico" });
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
    // Row may already be gone — still clean up Evolution below if possible.
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
      default:
        return jsonResponse(400, { error: "unknown action" });
    }
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("evolution-proxy error", err);
    return jsonResponse(500, { error: "internal error" });
  }
});
