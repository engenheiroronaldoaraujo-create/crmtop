import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, type Supabase } from "../_shared/contacts.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// ---------------------------------------------------------------------------
// System prompt (protected - never modified by user)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Você é o SDR IA do ATENDATOP, uma plataforma para prestadores de serviço.

SEU PAPEL:
- Primeiro atendimento inteligente
- Entender o negócio do lead
- Identificar necessidades relevantes
- Apresentar funcionalidades do AtendaTop
- Conduzir para demonstração
- Agendar demonstração ou retorno humano

REGRAS ABSOLUTAS:
- NUNCA informar preços, planos, mensalidades ou descontos
- NUNCA inventar funcionalidades
- NUNCA inventar horários
- NUNCA enviar mensagem se estiver desligado
- NUNCA responder depois que humano assumir
- Uma pergunta por vez
- Ser conciso e profissional

CONTEXTO IMPORTANTE:
- Você está em uma CONVERSA CONTÍNUA com o lead
- NÃO repita perguntas que já foram feitas
- NÃO recomece a conversa do zero
- LEMBRE o que o lead já compartilhou
- Se o lead já respondeu sobre sua equipe, NÃO pergunte novamente
- Continue a conversa de onde parou

SE O LEAD PERGUNTAR PREÇO:
"Consigo te orientar sobre o sistema e te mostrar como ele funciona. Posso deixar uma demonstração agendada?"

SE O LEAD PEDIR HUMANO:
Concordar e transferir/agendar retorno.

SE FOR FORA DO HORÁRIO:
Informar que o atendimento humano encerrou e oferecer agendamento de retorno.

FUNCIONALIDADES DO ATENDATOP (use somente quando relevante):
- Cadastro e gestão de clientes
- Orçamentos digitais
- Ordens de Serviço digitais
- Assinatura do cliente na tela
- Fotos e evidências do serviço
- Checklists
- Agendamento de serviços
- Distribuição de OS para técnicos
- Acompanhamento de técnicos por GPS
- Mapa de técnicos
- Portal do técnico
- Portal do cliente
- Cadastro de equipamentos/ativos
- Histórico de serviços
- Manutenção preventiva e PMOC
- Contratos recorrentes
- Financeiro (contas a receber e pagar)
- Estoque e compras
- Relatórios

APRESENTAR SOMENTE funcionalidades relevantes para a necessidade do lead.

RESPONDA EM JSON:
{
  "response": "sua resposta em texto",
  "intent": "qualification|question|support|complaint|pricing|human_request|other",
  "temperature": "cold|warm|hot",
  "suggested_action": "continue|schedule_demo|transfer_human|schedule_callback",
  "confidence": 0.0-1.0,
  "extracted_info": {
    "service_type": "tipo de serviço ou null",
    "team_size": "número de técnicos ou null",
    "current_tool": "ferramenta atual ou null",
    "main_need": "necessidade principal ou null"
  }
}

Retorne APENAS o JSON.`;

// ---------------------------------------------------------------------------
// OpenRouter call
// ---------------------------------------------------------------------------

async function callAI(
  supabase: Supabase,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; max_tokens?: number } = {},
): Promise<{ content: string; usage?: any }> {
  // Get API key
  let apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  if (!apiKey) {
    const { data } = await supabase
      .from("activity_log")
      .select("new_data")
      .eq("entity_type", "ai_key")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    apiKey = (data?.new_data as any)?.key ?? "";
  }
  if (!apiKey) throw new Error("API Key não configurada");

  // Get model from settings
  const { data: sdrConfig } = await supabase
    .from("sdr_settings")
    .select("primary_model")
    .limit(1)
    .single();
  const model = sdrConfig?.primary_model ?? "openrouter/free";

  const body = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 500,
  };

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://crm-top.vercel.app",
      "X-Title": "CRM_TOP_SDR",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    usage: data.usage,
  };
}

// ---------------------------------------------------------------------------
// Parse structured response
// ---------------------------------------------------------------------------

function parseResponse<T>(text: string): T | null {
  try {
    // Try to find JSON in the response (may have thinking text before it)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as T
    }
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Business hours check
// ---------------------------------------------------------------------------

async function isBusinessHours(supabase: Supabase, settings: any): Promise<boolean> {
  const now = new Date()
  const tz = settings.timezone ?? "America/Sao_Paulo"
  const dayOfWeek = now.getDay()

  const dayMap = [settings.schedule_sunday, settings.schedule_monday, settings.schedule_tuesday,
    settings.schedule_wednesday, settings.schedule_thursday, settings.schedule_friday, settings.schedule_saturday]

  if (!dayMap[dayOfWeek]) return false

  const localTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })
  return localTime >= settings.schedule_start_time && localTime <= settings.schedule_end_time
}

// ---------------------------------------------------------------------------
// Process incoming message
// ---------------------------------------------------------------------------

async function processMessage(
  supabase: Supabase,
  conversationId: string,
  contactId: string,
  messageContent: string,
  instanceName: string,
  messageId: string,
): Promise<{ action: string; response?: string }> {
  // 1. Check SDR settings
  const { data: settings } = await supabase
    .from("sdr_settings")
    .select("*")
    .limit(1)
    .single()

  if (!settings || !settings.enabled) {
    return { action: "skip", response: "SDR desativado" }
  }

  // 2. Check test mode
  if (settings.test_mode) {
    return { action: "skip", response: "Modo teste ativo" }
  }

  // 3. Check instance
  if (settings.instance_id) {
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_name")
      .eq("id", settings.instance_id)
      .single()
    if (inst?.instance_name !== instanceName) {
      return { action: "skip", response: "Instância não configurada para SDR" }
    }
  }

  // 4. Check conversation SDR state
  const { data: sdrConv } = await supabase
    .from("sdr_conversations")
    .select("*")
    .eq("conversation_id", conversationId)
    .single()

  // If conversation is paused or completed, skip
  if (sdrConv && (sdrConv.status === "paused_human" || sdrConv.status === "completed" || sdrConv.status === "transferred")) {
    return { action: "skip", response: `SDR ${sdrConv.status}` }
  }

  // 5. Check message limit
  if (sdrConv && sdrConv.auto_messages_count >= settings.max_messages_per_conversation) {
    // Pause and notify
    await supabase
      .from("sdr_conversations")
      .update({ status: "paused_limit" })
      .eq("conversation_id", conversationId)
    return { action: "pause_limit", response: "Limite de mensagens atingido" }
  }

  // 6. Check cooldown
  if (sdrConv?.last_auto_reply_at) {
    const lastReply = new Date(sdrConv.last_auto_reply_at).getTime()
    const now = Date.now()
    if (now - lastReply < settings.cooldown_seconds * 1000) {
      return { action: "skip", response: "Cooldown ativo" }
    }
  }

  // 7. Check business hours
  const inHours = await isBusinessHours(supabase, settings)
  if (!inHours && !settings.after_hours_enabled) {
    return { action: "skip", response: "Fora do horário" }
  }

  // 8. Get contact context
  const { data: contact } = await supabase
    .from("contacts")
    .select("name, phone, push_name")
    .eq("id", contactId)
    .single()

  // 9. Get recent messages for context
  const { data: recentMsgs } = await supabase
    .from("messages")
    .select("direction, content, type, sent_at")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true })
    .limit(20)

  const conversationContext = (recentMsgs ?? [])
    .map((m: any) => `${m.direction === "inbound" ? "CLIENTE" : "ATENDATOP"}: ${m.content ?? "[mídia]"}`)
    .join("\n")

  // 10. Build prompt
  const systemMsg = SYSTEM_PROMPT + (settings.system_prompt ? `\n\nInstruções adicionais: ${settings.system_prompt}` : "")

  const userMsg = `Contato: ${contact?.name ?? "Desconhecido"}

CONVERSA ATUAL:
${conversationContext}

NOVA MENSAGEM DO CLIENTE:
${messageContent}

Responda ao cliente. Retorne JSON conforme instruído.`

  // 11. Call AI
  const startTime = Date.now()
  let aiResponse: string
  try {
    const result = await callAI(supabase, [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg },
    ], { temperature: 0.7, max_tokens: 500 })
    aiResponse = result.content
  } catch (e) {
    // Log error
    await supabase.from("sdr_logs").insert({
      conversation_id: conversationId,
      contact_id: contactId,
      message_id: messageId,
      status: "failed",
      error: String(e),
      model: settings.primary_model,
    }).then(() => {}, () => {})
    return { action: "error", response: String(e) }
  }

  const latency = Date.now() - startTime

  // 12. Parse response
  const parsed = parseResponse<{
    response: string
    intent: string
    temperature: string
    suggested_action: string
    confidence: number
    extracted_info: Record<string, string>
  }>(aiResponse)

  if (!parsed || !parsed.response) {
    await supabase.from("sdr_logs").insert({
      conversation_id: conversationId,
      contact_id: contactId,
      message_id: messageId,
      status: "failed",
      error: "Invalid AI response",
      latency_ms: latency,
    }).then(() => {}, () => {})
    return { action: "error", response: "Resposta inválida da IA" }
  }

  // 13. Handle actions based on suggested_action
  if (parsed.suggested_action === "transfer_human") {
    await supabase
      .from("sdr_conversations")
      .update({ status: "transferred", handoff_reason: "customer_requested" })
      .eq("conversation_id", conversationId)
      .then(() => {}, () => {})

    await supabase.from("sdr_logs").insert({
      conversation_id: conversationId,
      contact_id: contactId,
      message_id: messageId,
      status: "completed",
      action: "transfer_human",
      latency_ms: latency,
      model: settings.primary_model,
    }).then(() => {}, () => {})

    return { action: "transfer_human", response: parsed.response }
  }

  if (parsed.suggested_action === "schedule_demo" || parsed.suggested_action === "schedule_callback") {
    // Create opportunity if not exists
    const { data: existingOpp } = await supabase
      .from("opportunities")
      .select("id")
      .eq("contact_id", contactId)
      .eq("status", "open")
      .limit(1)

    let oppId = existingOpp?.[0]?.id
    if (!oppId) {
      const { data: newOpp } = await supabase
        .from("opportunities")
        .insert({
          contact_id: contactId,
          pipeline_id: (await supabase.from("pipelines").select("id").eq("is_default", true).single())?.data?.id,
          stage_id: (await supabase.from("pipeline_stages").select("id").eq("name", "Novo").single())?.data?.id,
          title: `Lead - ${contact?.name ?? "Novo contato"}`,
          created_by: null,
          conversation_id: conversationId,
        })
        .select()
        .single()
      oppId = newOpp?.id
    }

    // Update SDR conversation
    await supabase
      .from("sdr_conversations")
      .update({ opportunity_id: oppId, status: "active" })
      .eq("conversation_id", conversationId)
      .then(() => {}, () => {})
    if (!sdrConv) {
      await supabase
        .from("sdr_conversations")
        .insert({ conversation_id: conversationId, contact_id: contactId, opportunity_id: oppId })
        .then(() => {}, () => {})
    }
  }

  // 14. Update conversation state
  await supabase
    .from("sdr_conversations")
    .update({
      auto_messages_count: (sdrConv?.auto_messages_count ?? 0) + 1,
      last_auto_reply_at: new Date().toISOString(),
    })
    .eq("conversation_id", conversationId)
    .then(() => {}, () => {})

  // 15. Log
  await supabase.from("sdr_logs").insert({
    conversation_id: conversationId,
    contact_id: contactId,
    message_id: messageId,
    status: "completed",
    action: parsed.suggested_action,
    latency_ms: latency,
    model: settings.primary_model,
    metadata: parsed.extracted_info,
  }).then(() => {}, () => {})

  return { action: parsed.suggested_action, response: parsed.response }
}

// ---------------------------------------------------------------------------
// Send message via Evolution API
// ---------------------------------------------------------------------------

async function sendWhatsAppMessage(
  instanceName: string,
  phone: string,
  message: string,
): Promise<boolean> {
  const apiKey = Deno.env.get("EVOLUTION_API_KEY") ?? ""
  const apiUrl = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/+$/, "")

  try {
    const res = await fetch(`${apiUrl}/message/sendText/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": apiKey },
      body: JSON.stringify({ number: phone, text: message }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Edge Function entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = serviceClient()
    const body = await req.json()
    const { action, data } = body as { action: string; data: Record<string, unknown> }

    switch (action) {
      case "process_message": {
        const { conversation_id, contact_id, message_content, instance_name, message_id } = data as any
        const result = await processMessage(supabase, conversation_id, contact_id, message_content, instance_name, message_id)

        // Send response via WhatsApp if not in test mode and action is not skip/error
        if (result.action !== "skip" && result.action !== "error" && result.response) {
          const { data: conv } = await supabase
            .from("conversations")
            .select("contact:contacts(phone)")
            .eq("id", conversation_id)
            .single()
          const phone = (conv?.contact as any)?.phone
          if (phone) {
            await sendWhatsAppMessage(instance_name, phone, result.response)
          }
        }

        return jsonResponse(200, { ok: true, ...result })
      }

      case "get_settings": {
        const { data } = await supabase.from("sdr_settings").select("*").limit(1).single()
        return jsonResponse(200, { ok: true, settings: data })
      }

      case "update_settings": {
        const updates = data as Record<string, unknown>
        const { error } = await supabase
          .from("sdr_settings")
          .update(updates)
          .eq("id", (await supabase.from("sdr_settings").select("id").limit(1).single())?.data?.id)
        if (error) return jsonResponse(400, { error: error.message })
        return jsonResponse(200, { ok: true })
      }

      case "get_metrics": {
        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

        const [leads, qualified, demos, callbacks, transfers] = await Promise.all([
          supabase.from("sdr_logs").select("id", { count: "exact", head: true }).gte("created_at", todayStart),
          supabase.from("sdr_logs").select("id", { count: "exact", head: true }).gte("created_at", todayStart).eq("action", "qualification"),
          supabase.from("sdr_logs").select("id", { count: "exact", head: true }).gte("created_at", todayStart).eq("action", "schedule_demo"),
          supabase.from("sdr_logs").select("id", { count: "exact", head: true }).gte("created_at", todayStart).eq("action", "schedule_callback"),
          supabase.from("sdr_conversations").select("id", { count: "exact", head: true }).eq("status", "transferred").gte("created_at", todayStart),
        ])

        return jsonResponse(200, {
          ok: true,
          metrics: {
            leads_today: leads.count ?? 0,
            qualified: qualified.count ?? 0,
            demos_scheduled: demos.count ?? 0,
            callbacks_scheduled: callbacks.count ?? 0,
            transfers: transfers.count ?? 0,
          },
        })
      }

      case "test_sdr": {
        const { message, conversation_id } = data as any

        // Temporarily enable SDR and disable test_mode for testing
        const { data: settings } = await supabase.from("sdr_settings").select("*").limit(1).single()
        const wasEnabled = settings?.enabled
        const wasTestMode = settings?.test_mode
        await supabase.from("sdr_settings").update({ enabled: true, test_mode: false }).eq("id", settings?.id)

        const result = await processMessage(
          supabase,
          conversation_id ?? "00000000-0000-0000-0000-000000000000",
          "00000000-0000-0000-0000-000000000000",
          message,
          "test",
          "test-" + Date.now(),
        )

        // Restore original state
        await supabase.from("sdr_settings").update({ enabled: wasEnabled, test_mode: wasTestMode }).eq("id", settings?.id)

        return jsonResponse(200, { ok: true, ...result })
      }

      default:
        return jsonResponse(400, { error: `Unknown action: ${action}` })
    }
  } catch (err) {
    console.error("SDR_ENGINE_ERROR", err)
    return jsonResponse(500, { error: "internal error" })
  }
});
