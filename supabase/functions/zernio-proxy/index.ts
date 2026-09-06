// zernio-proxy — WhatsApp oficial (Meta Cloud API) via Zernio.
// Ações de admin (conexão, templates) e de campanhas. A API key NUNCA sai
// do servidor: fica em app_secrets e toda chamada passa por _shared/zernio.ts.
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, type Supabase } from "../_shared/contacts.ts";
import {
  getSecret,
  setSecret,
} from "../_shared/secrets.ts";
import {
  buildBroadcastTemplate,
  chunk,
  countTemplatePlaceholders,
  ensureZernioProfile,
  getZernioConnection,
  getZernioKey,
  normalizeE164,
  requireConnected,
  zernioRequest,
  ZERNIO_API_KEY_NAME,
  ZERNIO_WEBHOOK_SECRET_NAME,
  ZERNIO_WEBHOOK_TOKEN_NAME,
} from "../_shared/zernio.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

const WEBHOOK_EVENTS = [
  "account.connected",
  "account.disconnected",
  "whatsapp.template.status_updated",
  "message.received",
  "message.sent",
  "message.delivered",
  "message.read",
  "message.failed",
];

const RECIPIENTS_BATCH = 300;
const CONTACTS_BULK_BATCH = 1000;

// ---------------------------------------------------------------------------
// Auth (mesmo padrão do evolution-proxy)
// ---------------------------------------------------------------------------

async function requireUser(
  req: Request,
  supabase: Supabase,
  needRole: boolean,
): Promise<{ id: string; role?: string }> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw jsonResponse(401, { error: "missing token" });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw jsonResponse(401, { error: "invalid token" });
  if (!needRole) return { id: user.id };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) throw jsonResponse(403, { error: "profile not found" });
  return profile;
}

async function requireAdmin(profile: { role?: string }): Promise<void> {
  if (profile.role !== "admin") {
    throw jsonResponse(403, { error: "forbidden: admin role required" });
  }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Config / conexão
// ---------------------------------------------------------------------------

async function actionSetApiKey(
  supabase: Supabase,
  user: { id: string },
  body: { api_key?: string },
): Promise<Response> {
  const key = String(body.api_key ?? "").trim();
  if (!key) return jsonResponse(400, { error: "api_key é obrigatória" });
  await setSecret(supabase, ZERNIO_API_KEY_NAME, key, user.id);

  // Valida imediatamente (erro vira aviso, a key fica salva).
  try {
    await zernioRequest(supabase, "/profiles");
    return jsonResponse(200, { ok: true, verified: true });
  } catch (err) {
    return jsonResponse(200, {
      ok: true,
      verified: false,
      warning: err instanceof Error ? err.message : "chave salva mas não validada",
    });
  }
}

async function actionGetConfig(supabase: Supabase): Promise<Response> {
  const key = await getZernioKey(supabase);
  const conn = await getZernioConnection(supabase);
  return jsonResponse(200, {
    has_api_key: Boolean(key),
    connection: conn
      ? {
          profile_id: conn.profile_id,
          account_id: conn.account_id,
          account_name: conn.account_name,
          phone_number: conn.phone_number,
          status: conn.status,
          webhook_configured: Boolean(conn.webhook_id),
          connected_at: (conn as { connected_at?: string }).connected_at,
        }
      : null,
  });
}

async function actionConnectStart(
  supabase: Supabase,
  body: { redirect_url?: string },
): Promise<Response> {
  const redirectUrl = String(body.redirect_url ?? "").trim();
  if (!/^https?:\/\//.test(redirectUrl)) {
    return jsonResponse(400, { error: "redirect_url deve ser absoluta (https://...)" });
  }
  const profileId = await ensureZernioProfile(supabase);
  const res = await zernioRequest(supabase, "/connect/whatsapp", {
    query: { profileId, redirect_url: redirectUrl },
  });
  if (!res?.authUrl) return jsonResponse(502, { error: "Zernio não retornou authUrl" });
  return jsonResponse(200, { auth_url: res.authUrl });
}

async function finalizeConnection(
  supabase: Supabase,
  account: any,
  fallbackProfileId: string,
): Promise<void> {
  const accountProfileId =
    account.profileId && typeof account.profileId === "object"
      ? String(account.profileId._id ?? account.profileId.id ?? "")
      : String(account.profileId ?? "");
  const now = new Date().toISOString();
  const { error } = await supabase.from("zernio_connections").upsert(
    {
      id: "default",
      profile_id: accountProfileId || fallbackProfileId,
      account_id: String(account._id ?? account.id),
      account_name: account.displayName ?? account.username ?? null,
      phone_number: String(account.username ?? "").replace(/[^\d]/g, "") || null,
      status: "connected",
      connected_at: now,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);

  // Webhook e templates: best-effort — a conexão já valeu.
  try {
    await setupWebhook(supabase, accountProfileId || fallbackProfileId);
  } catch (err) {
    console.error("finalize-connection: setup-webhook falhou", err);
  }
  try {
    await syncTemplates(supabase, String(account._id ?? account.id));
  } catch (err) {
    console.error("finalize-connection: sync-templates falhou", err);
  }
}

async function actionConnectComplete(
  supabase: Supabase,
  body: { account_id?: string; profile_id?: string; username?: string },
): Promise<Response> {
  const accountId = String(body.account_id ?? "").trim();
  if (!accountId) return jsonResponse(400, { error: "account_id é obrigatório" });
  const profileId = await ensureZernioProfile(supabase);

  // Confirma na Zernio que a conta existe e pertence ao profile.
  const list = await zernioRequest(supabase, "/accounts", {
    query: { profileId },
  });
  const account = (list?.accounts ?? []).find(
    (a: any) => String(a._id ?? a.id) === accountId,
  );
  if (!account) {
    return jsonResponse(400, { error: "conta não encontrada no Zernio (reconecte)" });
  }
  await finalizeConnection(supabase, account, profileId);
  return jsonResponse(200, { ok: true });
}

// Adota a conta WhatsApp já conectada no workspace Zernio (mesmo em outro
// profile — ex.: conexão feita pelo dashboard da Zernio no "Default").
async function actionConnectResync(supabase: Supabase): Promise<Response> {
  const profileId = await ensureZernioProfile(supabase);
  const list = await zernioRequest(supabase, "/accounts", {
    query: { platform: "whatsapp" },
  });
  const accounts = (list?.accounts ?? []).filter(
    (a: any) => a.platform === "whatsapp" && a.isActive !== false && a.needsReconnection !== true,
  );
  if (accounts.length === 0) {
    return jsonResponse(404, {
      error: "nenhuma conta WhatsApp ativa neste workspace da Zernio",
    });
  }
  // Preferência: conta que já está no profile do CRM.
  const own = accounts.find((a: any) => {
    const pid = typeof a.profileId === "object" ? String(a.profileId?._id ?? "") : String(a.profileId ?? "");
    return pid === profileId;
  });
  await finalizeConnection(supabase, own ?? accounts[0], profileId);
  return jsonResponse(200, {
    ok: true,
    account_id: String((own ?? accounts[0])._id ?? (own ?? accounts[0]).id),
  });
}

async function actionDisconnect(supabase: Supabase): Promise<Response> {
  const { error } = await supabase
    .from("zernio_connections")
    .update({ status: "disconnected" })
    .eq("id", "default");
  if (error) throw new Error(error.message);
  return jsonResponse(200, { ok: true });
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

async function setupWebhook(
  supabase: Supabase,
  profileId: string,
): Promise<{ webhook_id: string; url: string }> {
  void profileId; // assinatura mantida p/ clareza; webhook é por workspace.
  let token = await getSecret(supabase, ZERNIO_WEBHOOK_TOKEN_NAME);
  if (!token) {
    token = randomToken();
    await setSecret(supabase, ZERNIO_WEBHOOK_TOKEN_NAME, token);
  }
  let secret = await getSecret(supabase, ZERNIO_WEBHOOK_SECRET_NAME);
  if (!secret) {
    secret = randomToken();
    await setSecret(supabase, ZERNIO_WEBHOOK_SECRET_NAME, secret);
  }

  const url = `${SUPABASE_URL}/functions/v1/zernio-webhook?token=${token}`;

  const existing = await zernioRequest(supabase, "/webhooks/settings").catch(() => null);
  const same = (existing?.webhooks ?? []).find(
    (w: any) => String(w.url ?? "").split("?")[0] === url.split("?")[0],
  );

  let webhookId: string;
  if (same) {
    const updated = await zernioRequest(supabase, "/webhooks/settings", {
      method: "PUT",
      body: { _id: same._id ?? same.id, url, secret, events: WEBHOOK_EVENTS, isActive: true },
    });
    webhookId = String(updated?.webhook?._id ?? updated?.webhook?.id ?? same._id);
  } else {
    const created = await zernioRequest(supabase, "/webhooks/settings", {
      method: "POST",
      body: {
        name: "CRM TOP",
        url,
        secret,
        events: WEBHOOK_EVENTS,
        isActive: true,
      },
    });
    webhookId = String(created?.webhook?._id ?? created?.webhook?.id ?? "");
  }
  if (!webhookId) throw new Error("Zernio não retornou id do webhook");

  await supabase
    .from("zernio_connections")
    .update({ webhook_id: webhookId, webhook_url: url.split("?")[0] })
    .eq("id", "default");

  return { webhook_id: webhookId, url };
}

async function actionSetupWebhook(supabase: Supabase): Promise<Response> {
  const conn = await requireConnected(supabase);
  const result = await setupWebhook(supabase, conn.profile_id!);
  return jsonResponse(200, { ok: true, url: result.url });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

async function syncTemplates(supabase: Supabase, accountId: string): Promise<number> {
  const res = await zernioRequest(supabase, "/whatsapp/templates", {
    query: { accountId },
  });
  const templates = res?.templates ?? [];

  // Reinsere tudo: apaga o cache do account e reabastece (tamanho pequeno).
  await supabase.from("zernio_templates").delete().eq("account_id", accountId);
  const now = new Date().toISOString();
  const rows = templates.map((t: any) => ({
    account_id: accountId,
    meta_template_id: t.id ? String(t.id) : null,
    name: String(t.name ?? ""),
    language: String(t.language ?? ""),
    category: t.category ?? null,
    status: t.status ?? null,
    reason: t.reason ?? null,
    components: t.components ?? null,
    synced_at: now,
  })).filter((r: { name: string }) => r.name);

  if (rows.length > 0) {
    const { error } = await supabase.from("zernio_templates").upsert(rows, {
      onConflict: "account_id,name,language",
    });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

async function actionSyncTemplates(supabase: Supabase): Promise<Response> {
  const conn = await requireConnected(supabase);
  const count = await syncTemplates(supabase, conn.account_id!);
  return jsonResponse(200, { ok: true, count });
}

async function actionCreateTemplate(
  supabase: Supabase,
  body: {
    name?: string;
    category?: string;
    language?: string;
    body_text?: string;
    footer_text?: string;
  },
): Promise<Response> {
  const conn = await requireConnected(supabase);
  const name = String(body.name ?? "").trim();
  if (!/^[a-z][a-z0-9_]{1,49}$/.test(name)) {
    return jsonResponse(400, {
      error: "nome inválido: use minúsculas, comece com letra (letras, números e _)",
    });
  }
  const bodyText = String(body.body_text ?? "").trim();
  if (!bodyText) return jsonResponse(400, { error: "corpo da mensagem é obrigatório" });
  const category = ["MARKETING", "UTILITY", "AUTHENTICATION"].includes(String(body.category))
    ? String(body.category)
    : "MARKETING";
  const language = String(body.language ?? "pt_BR").trim() || "pt_BR";

  const components: Record<string, unknown>[] = [{ type: "BODY", text: bodyText }];
  if (String(body.footer_text ?? "").trim()) {
    components.push({ type: "FOOTER", text: String(body.footer_text).trim() });
  }

  const res = await zernioRequest(supabase, "/whatsapp/templates", {
    method: "POST",
    body: { accountId: conn.account_id, name, category, language, components },
  });
  await syncTemplates(supabase, conn.account_id!).catch((err) =>
    console.error("sync-templates pós-criação falhou", err)
  );
  return jsonResponse(200, { ok: true, template: res?.template ?? null });
}

// Importa um template pré-aprovado do catálogo da Meta (sem fila de review).
async function actionImportLibraryTemplate(
  supabase: Supabase,
  body: { name?: string; language?: string; button_url?: string; button_phone?: string },
): Promise<Response> {
  const conn = await requireConnected(supabase);
  const name = String(body.name ?? "").trim();
  if (!name) return jsonResponse(400, { error: "informe o nome do template da biblioteca" });
  const language = String(body.language ?? "pt_BR").trim() || "pt_BR";

  const lookup = await zernioRequest(supabase, "/whatsapp/template-library", {
    query: { accountId: conn.account_id!, name, language },
  });
  const lib = lookup?.template;
  if (!lib) {
    return jsonResponse(404, {
      error: `"${name}" não existe na biblioteca da Meta para ${language}`,
    });
  }

  // Botões URL/PHONE_NUMBER da biblioteca exigem input correspondente.
  const buttonInputs: Record<string, unknown>[] = [];
  for (const btn of (lib.buttons ?? []) as Array<Record<string, unknown>>) {
    const type = String(btn.type ?? "");
    if (type === "URL") {
      const url = String(body.button_url ?? "").trim();
      if (!url) {
        return jsonResponse(400, {
          error: "este template tem botão de LINK — informe a URL do botão",
        });
      }
      buttonInputs.push({ type: "URL", url: { base_url: url, url_suffix_example: url } });
    } else if (type === "PHONE_NUMBER") {
      const phone = String(body.button_phone ?? "").replace(/[^\d]/g, "");
      if (!phone) {
        return jsonResponse(400, {
          error: "este template tem botão de TELEFONE — informe o número do botão",
        });
      }
      buttonInputs.push({ type: "PHONE_NUMBER", phone_number: phone });
    }
  }

  const res = await zernioRequest(supabase, "/whatsapp/templates", {
    method: "POST",
    body: {
      accountId: conn.account_id,
      name: String(lib.name ?? name),
      category: String(lib.category ?? "UTILITY"),
      language: String(lib.language ?? language),
      library_template_name: String(lib.name ?? name),
      ...(buttonInputs.length > 0 ? { library_template_button_inputs: buttonInputs } : {}),
    },
  });
  await syncTemplates(supabase, conn.account_id!).catch((err) =>
    console.error("sync-templates pós-import falhou", err)
  );
  return jsonResponse(200, { ok: true, template: res?.template ?? null });
}

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------

interface CampaignRecipientInput {
  contact_id?: string | null;
  phone?: string;
  name?: string | null;
  email?: string | null;
}

async function actionCampaignCreate(
  supabase: Supabase,
  user: { id: string },
  body: {
    name?: string;
    description?: string;
    template_name?: string;
    template_language?: string;
    variable_mapping?: Record<string, unknown>;
    scheduled_at?: string | null;
    recipients?: CampaignRecipientInput[];
  },
): Promise<Response> {
  const conn = await requireConnected(supabase);
  const name = String(body.name ?? "").trim();
  const templateName = String(body.template_name ?? "").trim();
  const templateLanguage = String(body.template_language ?? "").trim();
  if (!name) return jsonResponse(400, { error: "nome da campanha é obrigatório" });
  if (!templateName || !templateLanguage) {
    return jsonResponse(400, { error: "selecione um template aprovado" });
  }

  // Valida o template contra o cache local (fonte: Meta via sync).
  const { data: tpl } = await supabase
    .from("zernio_templates")
    .select("status, components")
    .eq("account_id", conn.account_id!)
    .eq("name", templateName)
    .eq("language", templateLanguage)
    .maybeSingle();
  if (!tpl) return jsonResponse(400, { error: "template não encontrado — sincronize os templates" });
  if (tpl.status !== "APPROVED") {
    return jsonResponse(400, { error: `template ${tpl.status ?? "?"}: só templates aprovados podem enviar` });
  }

  // Nº de variáveis vem do template cacheado (fonte: Meta), não do cliente —
  // mismatch de parâmetros é rejeitado pela Meta (código 132000).
  const placeholderCount = countTemplatePlaceholders(tpl.components);
  const variableMapping = body.variable_mapping && typeof body.variable_mapping === "object"
    ? body.variable_mapping
    : {};
  if (placeholderCount > 0) {
    const mapped = Object.keys(variableMapping).length;
    if (mapped !== placeholderCount) {
      return jsonResponse(400, {
        error: `mapeie as ${placeholderCount} variáveis do template (recebi ${mapped})`,
      });
    }
  }

  // Monta audiência: dedupe por dígitos, ignora quem não tem E.164 válido.
  const seen = new Map<string, CampaignRecipientInput>();
  for (const r of body.recipients ?? []) {
    const e164 = normalizeE164(r.phone ?? null);
    if (!e164) continue;
    const digits = e164.slice(1);
    if (!seen.has(digits)) seen.set(digits, { ...r, phone: digits });
  }
  const recipients = [...seen.values()];
  if (recipients.length === 0) {
    return jsonResponse(400, { error: "nenhum contato com telefone válido na audiência" });
  }

  // 1) Registro local (draft) — fica auditável mesmo se a Zernio falhar.
  const { data: campaign, error: insErr } = await supabase
    .from("campaigns")
    .insert({
      name,
      description: String(body.description ?? "").trim() || null,
      template_name: templateName,
      template_language: templateLanguage,
      variable_mapping: variableMapping,
      status: "draft",
      created_by: user.id,
    })
    .select("*")
    .single();
  if (insErr || !campaign) throw new Error(insErr?.message ?? "falha ao criar campanha");

  const { error: recErr } = await supabase.from("campaign_recipients").insert(
    recipients.map((r) => ({
      campaign_id: campaign.id,
      contact_id: r.contact_id ?? null,
      phone: r.phone,
      name: r.name ?? null,
    })),
  );
  if (recErr) {
    await supabase.from("campaigns").delete().eq("id", campaign.id);
    throw new Error(recErr.message);
  }

  try {
    // 2) Importa os contatos na Zernio (name/email ficam disponíveis p/ {{n}}).
    for (const batch of chunk(recipients, CONTACTS_BULK_BATCH)) {
      await zernioRequest(supabase, "/contacts/bulk", {
        method: "POST",
        body: {
          profileId: conn.profile_id,
          accountId: conn.account_id,
          platform: "whatsapp",
          contacts: batch.map((r) => ({
            name: String(r.name ?? "").trim() || "Contato",
            ...(r.email ? { email: String(r.email) } : {}),
            platformIdentifier: `+${r.phone}`,
          })),
        },
      });
    }

    // 3) Broadcast draft na Zernio.
    const broadcast = await zernioRequest(supabase, "/broadcasts", {
      method: "POST",
      body: {
        profileId: conn.profile_id,
        accountId: conn.account_id,
        platform: "whatsapp",
        name,
        ...(body.description ? { description: String(body.description) } : {}),
        template: buildBroadcastTemplate(
          templateName,
          templateLanguage,
          placeholderCount,
          variableMapping,
        ),
      },
    });
    const broadcastId = String(broadcast?.broadcast?.id ?? "");
    if (!broadcastId) throw new Error("Zernio não retornou id do broadcast");

    const { error: updErr } = await supabase
      .from("campaigns")
      .update({ zernio_broadcast_id: broadcastId, recipient_count: recipients.length })
      .eq("id", campaign.id);
    if (updErr) throw new Error(updErr.message);

    // 4) Destinatários em lotes.
    for (const batch of chunk(recipients, RECIPIENTS_BATCH)) {
      await zernioRequest(supabase, `/broadcasts/${broadcastId}/recipients`, {
        method: "POST",
        body: { phones: batch.map((r) => `+${r.phone}`) },
      });
    }

    // 5) Agendamento opcional (envio imediato é ação separada do usuário).
    if (body.scheduled_at) {
      await scheduleBroadcast(supabase, String(campaign.id), broadcastId, String(body.scheduled_at));
    }

    const { data: fresh } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaign.id)
      .single();
    return jsonResponse(200, { ok: true, campaign: fresh });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro na Zernio";
    await supabase
      .from("campaigns")
      .update({ status: "failed", last_error: msg })
      .eq("id", campaign.id);
    throw err instanceof Response ? err : new Error(msg);
  }
}

async function getCampaignOr404(supabase: Supabase, campaignId: string) {
  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (!data) throw jsonResponse(404, { error: "campanha não encontrada" });
  return data as {
    id: string;
    status: string;
    zernio_broadcast_id: string | null;
    name: string;
  };
}

async function scheduleBroadcast(
  supabase: Supabase,
  campaignId: string,
  broadcastId: string,
  scheduledAt: string,
): Promise<void> {
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) throw new Error("data de agendamento inválida");
  if (when.getTime() < Date.now() + 60_000) {
    throw new Error("agende para pelo menos 1 minuto no futuro");
  }
  await zernioRequest(supabase, `/broadcasts/${broadcastId}/schedule`, {
    method: "POST",
    body: { scheduledAt: when.toISOString() },
  });
  const { error } = await supabase
    .from("campaigns")
    .update({ status: "scheduled", scheduled_at: when.toISOString() })
    .eq("id", campaignId);
  if (error) throw new Error(error.message);
}

async function actionCampaignSchedule(
  supabase: Supabase,
  body: { campaign_id?: string; scheduled_at?: string },
): Promise<Response> {
  const campaign = await getCampaignOr404(supabase, String(body.campaign_id));
  if (campaign.status !== "draft") {
    return jsonResponse(400, { error: `campanha ${campaign.status}: só drafts agendam` });
  }
  if (!campaign.zernio_broadcast_id) {
    return jsonResponse(400, { error: "campanha sem broadcast na Zernio" });
  }
  await scheduleBroadcast(
    supabase,
    campaign.id,
    campaign.zernio_broadcast_id,
    String(body.scheduled_at),
  );
  return jsonResponse(200, { ok: true });
}

async function actionCampaignSend(
  supabase: Supabase,
  body: { campaign_id?: string },
): Promise<Response> {
  const campaign = await getCampaignOr404(supabase, String(body.campaign_id));
  if (!["draft", "scheduled"].includes(campaign.status)) {
    return jsonResponse(400, { error: `campanha ${campaign.status}: só drafts/agendadas enviam` });
  }
  if (!campaign.zernio_broadcast_id) {
    return jsonResponse(400, { error: "campanha sem broadcast na Zernio" });
  }
  const res = await zernioRequest(
    supabase,
    `/broadcasts/${campaign.zernio_broadcast_id}/send`,
    { method: "POST" },
  );
  const status = String(res?.status ?? "sending");
  const { error } = await supabase
    .from("campaigns")
    .update({
      status: status === "failed" ? "failed" : "sending",
      started_at: new Date().toISOString(),
    })
    .eq("id", campaign.id);
  if (error) throw new Error(error.message);
  return jsonResponse(200, { ok: true, sent: res?.sent, failed: res?.failed });
}

async function actionCampaignCancel(
  supabase: Supabase,
  body: { campaign_id?: string },
): Promise<Response> {
  const campaign = await getCampaignOr404(supabase, String(body.campaign_id));
  if (!["draft", "scheduled"].includes(campaign.status)) {
    return jsonResponse(400, { error: `campanha ${campaign.status}: só drafts/agendadas cancelam` });
  }
  if (campaign.zernio_broadcast_id) {
    await zernioRequest(
      supabase,
      `/broadcasts/${campaign.zernio_broadcast_id}/cancel`,
      { method: "POST" },
    ).catch((err) => console.error("cancel broadcast falhou", err));
  }
  const { error } = await supabase
    .from("campaigns")
    .update({ status: "cancelled" })
    .eq("id", campaign.id);
  if (error) throw new Error(error.message);
  return jsonResponse(200, { ok: true });
}

async function actionCampaignSync(
  supabase: Supabase,
  body: { campaign_id?: string },
): Promise<Response> {
  const campaign = await getCampaignOr404(supabase, String(body.campaign_id));
  if (!campaign.zernio_broadcast_id) {
    return jsonResponse(400, { error: "campanha sem broadcast na Zernio" });
  }
  const broadcastId = campaign.zernio_broadcast_id;

  const bRes = await zernioRequest(supabase, `/broadcasts/${broadcastId}`);
  const b = bRes?.broadcast ?? {};

  // Página a página dos recipients, atualizando o espelho local.
  let skip = 0;
  let pages = 0;
  let lastSeenAt: string | null = null;
  while (pages < 40) {
    const rRes = await zernioRequest(supabase, `/broadcasts/${broadcastId}/recipients`, {
      query: { limit: 500, skip },
    });
    const list = rRes?.recipients ?? [];
    if (list.length === 0) break;

    for (const r of list) {
      const digits = String(r.platformIdentifier ?? "").replace(/[^\d]/g, "");
      if (!digits) continue;
      const status = ["pending", "sent", "delivered", "read", "failed"].includes(r.status)
        ? r.status
        : "pending";
      const patch: Record<string, unknown> = {
        status,
        zernio_recipient_id: String(r.id ?? ""),
        zernio_message_id: r.messageId ? String(r.messageId) : null,
        error: r.error ? String(r.error) : null,
        error_code: r.errorCode ?? null,
        sent_at: r.sentAt ?? null,
        delivered_at: r.deliveredAt ?? null,
        read_at: r.readAt ?? null,
      };
      const { data: updated } = await supabase
        .from("campaign_recipients")
        .update(patch)
        .eq("campaign_id", campaign.id)
        .eq("phone", digits)
        .select("id");
      if (!updated || updated.length === 0) {
        await supabase.from("campaign_recipients").insert({
          campaign_id: campaign.id,
          phone: digits,
          name: r.contactName ?? null,
          ...patch,
        });
      }
    }
    skip += list.length;
    pages += 1;
    lastSeenAt = rRes?.summary ? new Date().toISOString() : lastSeenAt;
    if (!rRes?.pagination?.hasMore) break;
  }
  void lastSeenAt;

  const patch: Record<string, unknown> = {};
  if (["draft", "scheduled", "sending", "completed", "failed", "cancelled"].includes(String(b.status))) {
    patch.status = b.status;
  }
  if (b.scheduledAt) patch.scheduled_at = b.scheduledAt;
  if (b.startedAt) patch.started_at = b.startedAt;
  if (b.completedAt) patch.completed_at = b.completedAt;
  if (Object.keys(patch).length > 0) {
    await supabase.from("campaigns").update(patch).eq("id", campaign.id);
  }
  await supabase.rpc("recalc_campaign_stats", { p_campaign_id: campaign.id });

  const { data: fresh } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaign.id)
    .single();
  return jsonResponse(200, { ok: true, campaign: fresh });
}

// Envio de teste para um único número (broadcast descartável, não vira campanha).
async function actionCampaignTest(
  supabase: Supabase,
  body: { campaign_id?: string; phone?: string },
): Promise<Response> {
  const conn = await requireConnected(supabase);
  const campaign = await getCampaignOr404(supabase, String(body.campaign_id));
  const e164 = normalizeE164(String(body.phone ?? ""));
  if (!e164) return jsonResponse(400, { error: "telefone de teste inválido" });

  // Reusa o template e o mapeamento da campanha (variáveis resolvem do
  // contato Zernio criado no create; no teste, caem no fallback "there").
  const full = campaign as unknown as {
    name: string;
    template_name: string;
    template_language: string;
    variable_mapping?: Record<string, unknown>;
  };
  const mapping = full.variable_mapping ?? {};
  const placeholders = Object.keys(mapping).length;

  const bRes = await zernioRequest(supabase, "/broadcasts", {
    method: "POST",
    body: {
      profileId: conn.profile_id,
      accountId: conn.account_id,
      platform: "whatsapp",
      name: `TESTE ${(campaign as unknown as { name: string }).name}`.slice(0, 60),
      template: buildBroadcastTemplate(
        (campaign as unknown as { template_name: string }).template_name,
        (campaign as unknown as { template_language: string }).template_language,
        placeholders,
        mapping,
      ),
    },
  });
  const broadcastId = String(bRes?.broadcast?.id ?? "");
  if (!broadcastId) throw new Error("Zernio não retornou id do broadcast de teste");
  await zernioRequest(supabase, `/broadcasts/${broadcastId}/recipients`, {
    method: "POST",
    body: { phones: [e164] },
  });
  const sent = await zernioRequest(supabase, `/broadcasts/${broadcastId}/send`, {
    method: "POST",
  });
  return jsonResponse(200, { ok: true, broadcast_id: broadcastId, sent: sent?.status });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const ADMIN_ACTIONS = new Set([
  "set-api-key",
  "get-config",
  "connect-start",
  "connect-complete",
  "connect-resync",
  "disconnect",
  "setup-webhook",
  "sync-templates",
  "create-template",
  "import-library-template",
  "campaign-create",
  "campaign-send",
  "campaign-schedule",
  "campaign-cancel",
  "campaign-test",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = serviceClient();
    const body = await req.json().catch(() => ({}));
    const { action } = body as { action: string };

    const user = await requireUser(req, supabase, ADMIN_ACTIONS.has(String(action)));

    switch (action) {
      case "set-api-key": {
        await requireAdmin(user);
        return await actionSetApiKey(supabase, user, body);
      }
      case "get-config": {
        await requireAdmin(user);
        return await actionGetConfig(supabase);
      }
      case "connect-start": {
        await requireAdmin(user);
        return await actionConnectStart(supabase, body);
      }
      case "connect-complete": {
        await requireAdmin(user);
        return await actionConnectComplete(supabase, body);
      }
      case "connect-resync": {
        await requireAdmin(user);
        return await actionConnectResync(supabase);
      }
      case "disconnect": {
        await requireAdmin(user);
        return await actionDisconnect(supabase);
      }
      case "setup-webhook": {
        await requireAdmin(user);
        return await actionSetupWebhook(supabase);
      }
      case "sync-templates": {
        await requireAdmin(user);
        return await actionSyncTemplates(supabase);
      }
      case "create-template": {
        await requireAdmin(user);
        return await actionCreateTemplate(supabase, body);
      }
      case "import-library-template": {
        await requireAdmin(user);
        return await actionImportLibraryTemplate(supabase, body);
      }
      case "campaign-create": {
        await requireAdmin(user);
        return await actionCampaignCreate(supabase, user, body);
      }
      case "campaign-send": {
        await requireAdmin(user);
        return await actionCampaignSend(supabase, body);
      }
      case "campaign-schedule": {
        await requireAdmin(user);
        return await actionCampaignSchedule(supabase, body);
      }
      case "campaign-cancel": {
        await requireAdmin(user);
        return await actionCampaignCancel(supabase, body);
      }
      case "campaign-sync": {
        return await actionCampaignSync(supabase, body);
      }
      case "campaign-test": {
        await requireAdmin(user);
        return await actionCampaignTest(supabase, body);
      }
      default:
        return jsonResponse(400, { error: "unknown action" });
    }
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("zernio-proxy error", err);
    const status = err instanceof Error && /Zernio 4\d\d/.test(err.message) ? 400 : 500;
    return jsonResponse(status, { error: err instanceof Error ? err.message : "internal error" });
  }
});
