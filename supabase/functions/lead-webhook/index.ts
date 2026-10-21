// lead-webhook — intake de leads da landing page → estágio 1 do funil + chat.
//
// POST https://<ref>.supabase.co/functions/v1/lead-webhook?token=<LEAD_WEBHOOK_SECRET>
// Content-Type: application/json (ou form-data de builders como Elementor/Tally)
//
// Body:
//   { name*, phone*, email?, notes?, pipeline_id?, stage_id?,
//     utm_source?, utm_medium?, utm_campaign?, landing_url?,
//     create_chat? (default true), instance_name? }
//
// Fluxo:
//   1. valida token (?token= == LEAD_WEBHOOK_SECRET, fail-closed)
//   2. normaliza/valida phone (BR, canônico 55+DDD — mesmo padrão do CRM)
//   3. upsert contacts por phone (variantes do nono dígito, sem duplicar)
//   4. resolve pipeline (body.pipeline_id ou is_default) + stage posição 1
//   5. idempotência: se já existe opportunity open p/ contato+pipeline, retorna ela
//   6. senão insert opportunities no estágio 1 + audit em activity_log
//   7. cria conversa no chat (instância padrão) + mensagem-sistema inbound,
//      com bump p/ aparecer no topo do inbox com não-lida
//
// GET sem body = healthcheck (exige token também).

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, upsertContact } from "../_shared/contacts.ts";
import { normalizePhoneStrict } from "../_shared/evolution-identity.ts";
import { timingSafeEqual } from "../_shared/timing.ts";

const LEAD_SECRET = Deno.env.get("LEAD_WEBHOOK_SECRET") ??
  Deno.env.get("WEBHOOK_SECRET") ?? "";

function unauthorized() {
  return jsonResponse(401, { error: "unauthorized" });
}

function badRequest(msg: string, details?: unknown) {
  return jsonResponse(400, { error: msg, details });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) return (await req.json()) as Record<string, unknown>;
    if (ct.includes("form-urlencoded") || ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const obj: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) obj[k] = String(v);
      return obj;
    }
    // Fallback: tenta JSON mesmo sem content-type (alguns builders não mandam).
    const text = await req.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      // query string style "name=..&phone=.."
      const obj: Record<string, unknown> = {};
      for (const [k, v] of new URLSearchParams(text).entries()) obj[k] = v;
      return obj;
    }
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Fail-closed: sem segredo configurado, rejeita tudo.
  if (!LEAD_SECRET) {
    return jsonResponse(500, { error: "lead webhook secret not configured" });
  }
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim() ||
    (req.headers.get("x-webhook-token") ?? "").trim();
  if (!timingSafeEqual(token, LEAD_SECRET)) return unauthorized();

  // Healthcheck / ajuda.
  if (req.method === "GET") {
    return jsonResponse(200, {
      ok: true,
      usage:
        "POST { name, phone*, email?, notes?, pipeline_id?, utm_source?, create_chat? }",
    });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method not allowed, use POST" });
  }

  const body = await parseBody(req);
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

  const name = str(body.name ?? body.nome ?? body.full_name);
  const rawPhone = str(body.phone ?? body.telefone ?? body.whatsapp ?? body.tel);
  const email = str(body.email ?? body.e_mail);
  const notes = str(body.notes ?? body.message ?? body.mensagem ?? body.obs);
  const pipelineIdInput = str(body.pipeline_id ?? body.pipelineId);
  const stageIdInput = str(body.stage_id ?? body.stageId);
  const instanceNameInput = str(body.instance_name ?? body.instanceName);
  // create_chat default true; aceita false/"false"/0/"no"/"off" para desligar.
  const rawCreateChat = body.create_chat ?? body.createChat ?? body.chat;
  const wantChat = rawCreateChat === undefined || rawCreateChat === null
    ? true
    : !["false", "0", "no", "off", "n"].includes(String(rawCreateChat).trim().toLowerCase());

  if (!rawPhone) return badRequest("phone é obrigatório");
  const phone = normalizePhoneStrict(rawPhone);
  if (!phone) {
    return badRequest(
      "phone inválido — envie DDD+numero com 10/11 dígitos (ex.: 11987654321)",
    );
  }
  if (email && !isValidEmail(email)) return badRequest("email inválido");

  const supabase = serviceClient();

  const utm: Record<string, unknown> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "landing_url", "form_id", "page_url"]) {
    const v = str((body as Record<string, unknown>)[k]);
    if (v) utm[k] = v;
  }

  // --- 1. Upsert contato (merge-aware, sem duplicar por variante do 9º dígito) ---
  //
  // Usa o `upsertContact` compartilhado: ele resolve a identidade por LID e
  // por telefone (com as variantes do nono dígito) e faz merge. A versão
  // anterior só buscava por telefone — um lead que já existia no CRM só
  // como LID (sem phone) ganhava um contato DUPLICADO, que é exatamente o
  // que o `upsertContact` foi escrito para evitar.
  let contactId: string | null = null;
  let contactIsNew = false;
  try {
    const existing = await upsertContact(supabase, phone, null, null);

    const { data: current } = await supabase
      .from("contacts")
      .select("id, name, email, notes, source")
      .eq("id", existing)
      .maybeSingle();

    contactId = existing;
    if (!current) {
      contactIsNew = true;
    } else {
      const patch: Record<string, unknown> = {};
      if (name && !current.name) patch.name = name;
      if (email && !current.email) patch.email = email;
      if (notes && !current.notes) patch.notes = notes;
      // Lead de landing tem origem mais valiosa que 'whatsapp' orgânico;
      // contato 'manual' do CRM é preservado.
      if (current.source === "whatsapp") patch.source = "landing";
      if (Object.keys(patch).length > 0) {
        await supabase.from("contacts").update(patch).eq("id", existing);
      }
    }
  } catch (e) {
    console.error("LEAD_CONTACT_UPSERT_FAILED", String(e));
    return jsonResponse(500, { error: "falha ao salvar contato" });
  }

  // --- 2. Resolve pipeline + estágio 1 + oportunidade (idempotente) ---
  let pipelineId: string | null = null;
  let stageId: string | null = null;
  let stageName: string | null = null;
  let opportunityId: string | null = null;
  let deduplicated = false;
  try {
    if (pipelineIdInput) {
      const { data: p } = await supabase
        .from("pipelines")
        .select("id")
        .eq("id", pipelineIdInput)
        .eq("is_active", true)
        .maybeSingle();
      if (!p) return badRequest("pipeline_id não encontrado ou inativo");
      pipelineId = pipelineIdInput;
    } else {
      const { data: def } = await supabase
        .from("pipelines")
        .select("id")
        .eq("is_default", true)
        .eq("is_active", true)
        .maybeSingle();
      if (def) {
        pipelineId = def.id;
      } else {
        const { data: first } = await supabase
          .from("pipelines")
          .select("id")
          .eq("is_active", true)
          .order("created_at")
          .limit(1)
          .maybeSingle();
        pipelineId = first?.id ?? null;
      }
    }
    if (!pipelineId) return jsonResponse(500, { error: "nenhum pipeline ativo" });

    if (stageIdInput) {
      const { data: st } = await supabase
        .from("pipeline_stages")
        .select("id, name, pipeline_id")
        .eq("id", stageIdInput)
        .maybeSingle();
      if (!st || st.pipeline_id !== pipelineId) {
        return badRequest("stage_id não pertence ao pipeline");
      }
      stageId = st.id;
      stageName = st.name;
    } else {
      const { data: first } = await supabase
        .from("pipeline_stages")
        .select("id, name")
        .eq("pipeline_id", pipelineId)
        .eq("is_active", true)
        .order("position")
        .limit(1)
        .maybeSingle();
      if (!first) return jsonResponse(500, { error: "pipeline sem estágios ativos" });
      stageId = first.id;
      stageName = first.name;
    }

    // Idempotência atômica: `lead_ensure_opportunity` trava o contato e faz
    // "get-or-create" numa transação. Antes o código fazia SELECT e depois
    // INSERT — dois POSTs simultâneos criavam DOIS cards para o mesmo lead.
    const title = name ? `${name}` : phone;
    const { data: result, error: oppErr } = await supabase.rpc("lead_ensure_opportunity", {
      p_contact_id: contactId,
      p_pipeline_id: pipelineId,
      p_stage_id: stageId,
      p_title: title,
      p_description: notes || null,
      p_metadata: { source: "landing", created_via: "lead-webhook", ...utm },
    });
    if (oppErr || !result) throw new Error(oppErr?.message ?? "opportunity upsert failed");
    const payload = result as { id: string; created: boolean };
    opportunityId = payload.id;
    deduplicated = !payload.created;

    // Auditoria (best-effort).
    await supabase.from("activity_log").insert({
      entity_type: "opportunity",
      entity_id: opportunityId,
      action: payload.created ? "LEAD_WEBHOOK_CREATED" : "LEAD_WEBHOOK_DEDUPLICATED",
      new_data: { contact_id: contactId, pipeline_id: pipelineId, stage_id: stageId, ...utm },
    }).then(() => {}, () => {});
  } catch (e) {
    console.error("LEAD_OPPORTUNITY_FAILED", String(e));
    return jsonResponse(500, { error: "falha ao criar oportunidade" });
  }

  // --- 3. Chat: conversa + mensagem-sistema (best-effort, nunca derruba o lead) ---
  let conversationId: string | null = null;
  let chatCreated = false;
  let chatSkipped: string | null = wantChat ? null : "disabled by create_chat=false";
  if (wantChat) {
    try {
      // Instância: a informada, senão a conectada, senão a primeira.
      let instanceId: string | null = null;
      if (instanceNameInput) {
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("id")
          .eq("instance_name", instanceNameInput)
          .maybeSingle();
        instanceId = inst?.id ?? null;
        if (!instanceId) chatSkipped = `instance '${instanceNameInput}' não encontrada`;
      } else {
        const { data: connected } = await supabase
          .from("whatsapp_instances")
          .select("id")
          .eq("status", "connected")
          .order("created_at")
          .limit(1)
          .maybeSingle();
        instanceId = connected?.id ?? null;
        if (!instanceId) {
          const { data: first } = await supabase
            .from("whatsapp_instances")
            .select("id")
            .order("created_at")
            .limit(1)
            .maybeSingle();
          instanceId = first?.id ?? null;
        }
      }

      if (instanceId && contactId) {
        const { data: conv } = await supabase
          .from("conversations")
          .select("id")
          .eq("contact_id", contactId)
          .eq("instance_id", instanceId)
          .maybeSingle();
        if (conv) {
          conversationId = conv.id;
        } else {
          const { data: created, error: convErr } = await supabase
            .from("conversations")
            .insert({
              contact_id: contactId,
              instance_id: instanceId,
              source: "campaign",
              source_meta: { origin: "landing", created_via: "lead-webhook", ...utm },
            })
            .select("id")
            .single();
          if (convErr || !created) throw new Error(convErr?.message ?? "conversation insert failed");
          conversationId = created.id;
          chatCreated = true;
        }

        // Mensagem-sistema só na conversa recém-criada (re-POST não duplica).
        if (chatCreated && conversationId) {
          const lines = [
            "🌐 Novo lead da landing page",
            `Nome: ${name || "—"}`,
            `Telefone: ${phone}`,
            `Email: ${email || "—"}`,
          ];
          if (notes) lines.push(`Mensagem: ${notes}`);
          const origin = str(utm.utm_source ?? utm.landing_url ?? utm.page_url);
          if (origin) lines.push(`Origem: ${origin}`);
          const content = lines.join("\n");
          const sentAt = new Date().toISOString();
          const { data: msg } = await supabase
            .from("messages")
            .insert({
              conversation_id: conversationId,
              direction: "inbound",
              type: "text",
              content,
              sent_at: sentAt,
            })
            .select("id")
            .single();
          void msg;
          await supabase.rpc("bump_conversation", {
            p_id: conversationId,
            p_sent_at: sentAt,
            p_preview: `🌐 Novo lead: ${name || phone}`.slice(0, 140),
            p_inbound: true,
          }).then(() => {}, (e: unknown) => console.error("LEAD_BUMP_FAILED", String(e)));
        }

        // Amarra a oportunidade à conversa (se ainda sem vínculo).
        if (opportunityId && conversationId) {
          await supabase
            .from("opportunities")
            .update({ conversation_id: conversationId })
            .eq("id", opportunityId)
            .is("conversation_id", null)
            .then(() => {}, () => {});
        }
      } else if (!chatSkipped) {
        chatSkipped = "no whatsapp instance";
      }
    } catch (e) {
      console.error("LEAD_CHAT_FAILED", String(e));
      chatSkipped = "chat error (lead salvo no funil)";
    }
  }

  console.info("LEAD_CREATED", contactId, opportunityId, stageName, conversationId ?? "no-chat");
  return jsonResponse(deduplicated ? 200 : 201, {
    ok: true,
    deduplicated,
    contact_id: contactId,
    contact_is_new: contactIsNew,
    opportunity_id: opportunityId,
    pipeline_id: pipelineId,
    stage_id: stageId,
    stage_name: stageName,
    conversation_id: conversationId,
    chat_created: chatCreated,
    ...(chatSkipped ? { chat_skipped: chatSkipped } : {}),
  });
});
