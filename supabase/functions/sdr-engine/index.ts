import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, type Supabase } from "../_shared/contacts.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// ---------------------------------------------------------------------------
// System prompt (protected - never modified by user)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Voce e a Sofia, do ATENDATOP. Sistema para prestadores de servico.

Seu papel:
- Receber o lead com cordialidade
- Entender rapidamente o servico que ele presta
- Descobrir como ele controla sua operacao hoje
- Identificar uma ou duas necessidades relevantes
- Apresentar SOMENTE funcionalidades que facam sentido
- Informar que um especialista ira entrar em contato

Regras:
- Uma pergunta por vez, sempre
- Nao repita perguntas ja feitas
- Seja breve e natural como WhatsApp
- Nao fale precos, planos ou descontos
- Nao invente funcionalidades
- Nao invente horarios

Fluxo:
1. Cumprimentar e entender o servico
2. Perguntar como controla a operacao
3. Identificar necessidade
4. Mencionar funcionalidade relevante do AtendaTop
5. Quando perceber interesse suficiente, informe:
   "Obrigada pelas informacoes! Um dos nossos especialistas vai entrar em contato para te mostrar como o AtendaTop pode ajudar na sua operacao. Pode aguardar!"

Se perguntarem preco: "Um especialista vai te orientar melhor sobre isso."
Se pedirem humano: "Certo, um especialista ira retornar em breve!"

Responda em JSON:
{"response":"texto","intent":"qualification|pricing|human_request|other","temperature":"cold|warm|hot","suggested_action":"continue|transfer_human|schedule_callback","confidence":0.9,"extracted_info":{"service_type":null,"team_size":null,"current_tool":null,"main_need":null}}

Apenas o JSON.`;

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
    max_tokens: options.max_tokens ?? 1024,
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
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) {
    console.error("SDR_AI_EMPTY_CONTENT", { model, responseData: JSON.stringify(data).slice(0, 500) })
  }
  return {
    content,
    usage: data.usage,
  };
}

// ---------------------------------------------------------------------------
// Parse structured response
// ---------------------------------------------------------------------------

function parseResponse<T>(text: string): T | null {
  try {
    if (!text || !text.trim()) return null

    // Strip thinking/reasoning tags
    let cleaned = text
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/\[REASONING\][\s\S]*?\[\/REASONING\]/gi, "")
      .trim()

    // Try markdown code blocks first
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim()
    }

    // Find JSON using brace counting (handles nested braces in strings)
    const jsonStr = extractJson(cleaned)
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr) as T
      if (parsed && typeof parsed === "object" && "response" in parsed) {
        return parsed
      }
    }

    return null
  } catch {
    return null
  }
}

function extractJson(text: string): string | null {
  const start = text.indexOf("{")
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (ch === "\\" && inString) {
      escape = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Create opportunity if not exists (reusable for transfer_human + schedule_callback)
// ---------------------------------------------------------------------------

async function createOpportunityIfNotExists(
  supabase: Supabase,
  contactId: string,
  conversationId: string,
  temperature: string,
  extractedInfo: Record<string, string | null>,
  pushName: string | null,
  phone: string | null,
): Promise<string | null> {
  try {
    // Check for existing open opportunity
    const { data: existingOpp } = await supabase
      .from("opportunities")
      .select("id")
      .eq("contact_id", contactId)
      .eq("status", "open")
      .limit(1)

    if (existingOpp && existingOpp.length > 0) {
      return existingOpp[0].id
    }

    // Get default pipeline
    const { data: pipeline } = await supabase
      .from("pipelines")
      .select("id")
      .eq("is_default", true)
      .limit(1)
      .single()

    if (!pipeline) return null

    // Get stage based on temperature
    const stageName = temperature === "cold" ? "Novo Lead" : "Qualificado"
    const { data: stage } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipeline.id)
      .eq("name", stageName)
      .limit(1)
      .single()

    // Fallback to first stage if name not found
    let stageId = stage?.id
    if (!stageId) {
      const { data: fallbackStage } = await supabase
        .from("pipeline_stages")
        .select("id")
        .eq("pipeline_id", pipeline.id)
        .order("position", { ascending: true })
        .limit(1)
        .single()
      stageId = fallbackStage?.id
    }

    if (!stageId) return null

    // Build title from extracted_info or contact data
    const title = extractedInfo.service_type
      ?? pushName
      ?? phone
      ?? "Novo Lead"

    // Insert opportunity
    const { data: newOpp, error } = await supabase
      .from("opportunities")
      .insert({
        contact_id: contactId,
        pipeline_id: pipeline.id,
        stage_id: stageId,
        title,
        created_by: null,
        conversation_id: conversationId,
        description: extractedInfo.main_need ?? null,
        metadata: extractedInfo,
      })
      .select("id")
      .single()

    if (error) {
      console.error("SDR_OPP_CREATE_ERROR", error)
      return null
    }

    return newOpp?.id ?? null
  } catch (err) {
    console.error("SDR_OPP_CREATE_ERROR", err)
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
  const localTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })

  // Check new schedule table first
  const { data: schedule } = await supabase
    .from("sdr_schedule")
    .select("start_time, end_time")
    .eq("day_of_week", dayOfWeek)
    .eq("is_active", true)

  if (schedule && schedule.length > 0) {
    // Check each time window
    for (const slot of schedule) {
      const start = slot.start_time.slice(0, 5) // HH:MM
      const end = slot.end_time.slice(0, 5)
      if (start > end) {
        // Overnight: e.g., 18:00 -> 08:30
        if (localTime >= start || localTime <= end) return true
      } else {
        if (localTime >= start && localTime <= end) return true
      }
    }
    return false
  }

  // Fallback to old settings
  const dayMap = [settings.schedule_sunday, settings.schedule_monday, settings.schedule_tuesday,
    settings.schedule_wednesday, settings.schedule_thursday, settings.schedule_friday, settings.schedule_saturday]

  if (!dayMap[dayOfWeek]) return false

  const start = settings.schedule_start_time
  const end = settings.schedule_end_time

  if (start > end) {
    return localTime >= start || localTime <= end
  }
  return localTime >= start && localTime <= end
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

  // 9. Get available presentation slots
  const now = new Date()
  const tz = settings.timezone ?? "America/Sao_Paulo"
  const dayOfWeek = now.getDay()
  const { data: slots } = await supabase
    .from("presentation_slots")
    .select("day_of_week, start_time, end_time")
    .eq("is_active", true)
    .order("day_of_week")

  const DAY_MAP = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"]
  const availableSlots = (slots ?? []).map((s: any) => `${DAY_MAP[s.day_of_week]} ${s.start_time}-${s.end_time}`).join(", ")

  // 10. Get RECENT messages for context (last 15 messages)
  const { data: recentMsgs } = await supabase
    .from("messages")
    .select("direction, content, type")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: false })
    .limit(15)

  // Reverse to chronological order - include all messages (even without content)
  const conversationContext = (recentMsgs ?? [])
    .reverse()
    .map((m: any) => {
      const label = m.direction === "inbound" ? "CLIENTE" : "SOFIA"
      if (m.content) return `${label}: ${m.content}`
      if (m.type === "audio") return `${label}: [audio]`
      if (m.type === "image") return `${label}: [imagem]`
      if (m.type === "video") return `${label}: [video]`
      if (m.type === "document") return `${label}: [documento]`
      return `${label}: [mensagem]`
    })
    .join("\n")

  // 11. Build prompt - use custom system_prompt if provided, fallback to default
  const systemMsg = settings.system_prompt?.trim()
    ? settings.system_prompt
    : SYSTEM_PROMPT

  // Use the conversation as the user message (includes the new message naturally)
  const userMsg = `Conversa até agora:
${conversationContext || "(primeiro contato)"}

Contato: ${contact?.name ?? contact?.push_name ?? "Desconhecido"}

HORÁRIOS_DISPONIVEIS: ${availableSlots || "Nenhum horário configurado"}

Responda a última mensagem do CLIENTE.`

  // 11. Call AI
  const startTime = Date.now()
  let aiResponse: string
  try {
    const result = await callAI(supabase, [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg },
    ], { temperature: 0.7, max_tokens: 800 })
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
    console.error("SDR_PARSE_FAIL", { aiResponse: aiResponse.slice(0, 500) })
    await supabase.from("sdr_logs").insert({
      conversation_id: conversationId,
      contact_id: contactId,
      message_id: messageId,
      status: "failed",
      error: `Invalid AI response: ${aiResponse.slice(0, 200)}`,
      latency_ms: latency,
    }).then(() => {}, () => {})
    return { action: "error", response: "Resposta inválida da IA" }
  }

  // 13. Handle actions based on suggested_action
  if (parsed.suggested_action === "transfer_human") {
    // Create opportunity before transferring
    const oppId = await createOpportunityIfNotExists(
      supabase,
      contactId,
      conversationId,
      parsed.temperature,
      parsed.extracted_info,
      contact?.push_name ?? null,
      contact?.phone ?? null,
    )

    await supabase
      .from("sdr_conversations")
      .update({
        status: "transferred",
        handoff_reason: "customer_requested",
        opportunity_id: oppId,
        metadata: { extracted_info: parsed.extracted_info, temperature: parsed.temperature },
      })
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
      metadata: parsed.extracted_info,
    }).then(() => {}, () => {})

    return { action: "transfer_human", response: parsed.response }
  }

  if (parsed.suggested_action === "schedule_demo" || parsed.suggested_action === "schedule_callback") {
    // Create opportunity using shared function
    const oppId = await createOpportunityIfNotExists(
      supabase,
      contactId,
      conversationId,
      parsed.temperature,
      parsed.extracted_info,
      contact?.push_name ?? null,
      contact?.phone ?? null,
    )

    // Update SDR conversation
    const sdrUpdate: Record<string, unknown> = {
      status: "active",
      metadata: { extracted_info: parsed.extracted_info, temperature: parsed.temperature },
    }
    if (oppId) sdrUpdate.opportunity_id = oppId

    await supabase
      .from("sdr_conversations")
      .update(sdrUpdate)
      .eq("conversation_id", conversationId)
      .then(() => {}, () => {})

    if (!sdrConv) {
      await supabase
        .from("sdr_conversations")
        .insert({
          conversation_id: conversationId,
          contact_id: contactId,
          opportunity_id: oppId,
          metadata: { extracted_info: parsed.extracted_info, temperature: parsed.temperature },
        })
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
        // NOTE: message sending is handled by the webhook (callSDREngine)
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

        // Reuse or create test conversation using FIXED ids so history persists across test calls
        const TEST_CONTACT_ID = "2ff00aff-2ce4-4609-8ed7-e10ee91c4d04"
        const TEST_CONVERSATION_ID = "763783f6-5466-40a9-95ef-2859a8c9f771"
        let testConvId = conversation_id
        let testContactId = TEST_CONTACT_ID
        if (!testConvId) {
          // Find or create the test contact (by phone, since phone is unique)
          const { data: existingContact } = await supabase
            .from("contacts")
            .select("id")
            .eq("phone", "5500000000000")
            .maybeSingle()
          if (existingContact) {
            testContactId = existingContact.id
          } else {
            await supabase
              .from("contacts")
              .insert({ id: TEST_CONTACT_ID, phone: "5500000000000", name: "Teste SDR IA", source: "manual" })
              .then(() => {}, () => {})
          }

          // Use a real instance for the conversation FK
          const { data: inst } = await supabase
            .from("whatsapp_instances")
            .select("id")
            .limit(1)
            .maybeSingle()
          const instId = inst?.id ?? "d94c3f65-7969-474e-91bc-45dfa3da5f02"

          // Upsert test conversation
          await supabase
            .from("conversations")
            .upsert(
              {
                id: TEST_CONVERSATION_ID,
                contact_id: testContactId,
                instance_id: instId,
                status: "open",
              },
              { onConflict: "id" }
            )
            .then(() => {}, () => {})

          // Ensure SDR conversation is active
          await supabase
            .from("sdr_conversations")
            .upsert(
              {
                conversation_id: TEST_CONVERSATION_ID,
                contact_id: testContactId,
                status: "active",
                metadata: { type: "test" },
              },
              { onConflict: "conversation_id" }
            )
            .then(() => {}, () => {})
          testConvId = TEST_CONVERSATION_ID
        }

        // Store the test message as inbound
        if (testConvId) {
          await supabase.from("messages").insert({
            conversation_id: testConvId,
            direction: "inbound",
            type: "text",
            content: message,
            sent_at: new Date().toISOString(),
            status: "sent",
          }).then(() => {}, () => {})
        }

        const result = await processMessage(
          supabase,
          testConvId ?? TEST_CONVERSATION_ID,
          testContactId,
          message,
          "test",
          "test-" + Date.now(),
        )

        // Store the SDR response as outbound
        if (testConvId && result.response) {
          await supabase.from("messages").insert({
            conversation_id: testConvId,
            direction: "outbound",
            type: "text",
            content: result.response,
            sent_at: new Date().toISOString(),
            status: "sent",
          }).then(() => {}, () => {})
        }

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
