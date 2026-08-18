import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, type Supabase } from "../_shared/contacts.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

async function getApiKey(supabase: Supabase): Promise<string> {
  // Try env var first
  if (OPENROUTER_API_KEY) return OPENROUTER_API_KEY;
  // Fallback: read from activity_log
  try {
    const { data, error } = await supabase
      .from("activity_log")
      .select("new_data")
      .eq("entity_type", "ai_key")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return "";
    return (data.new_data as any)?.key ?? "";
  } catch {
    return "";
  }
}

async function getModel(supabase: Supabase): Promise<string> {
  const { data } = await supabase
    .from("activity_log")
    .select("new_data")
    .eq("entity_type", "ai_config")
    .eq("action", "MODEL_UPDATED")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return (data?.new_data as any)?.model ?? OPENROUTER_MODEL;
}

// ---------------------------------------------------------------------------
// OpenRouter call
// ---------------------------------------------------------------------------

async function callOpenRouter(
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; max_tokens?: number; response_format?: any } = {},
  supabase?: Supabase,
): Promise<{ content: string; usage?: any }> {
  // Get API key from env or database
  let apiKey = OPENROUTER_API_KEY;
  if (!apiKey && supabase) {
    try {
      const { data } = await supabase
        .from("activity_log")
        .select("new_data")
        .eq("entity_type", "ai_key")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      apiKey = (data?.new_data as any)?.key ?? "";
    } catch {
      // ignore
    }
  }
  if (!apiKey) throw new Error("API Key não configurada. Configure em Configurações → IA.");

  const model = supabase ? await getModel(supabase) : OPENROUTER_MODEL;

  const body = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 1024,
    ...(options.response_format ? { response_format: options.response_format } : {}),
  };

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://crm-top.vercel.app",
      "X-Title": "CRM_TOP",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return { content, usage: data.usage };
}

// ---------------------------------------------------------------------------
// Validate JSON response
// ---------------------------------------------------------------------------

function parseStructuredResponse<T>(text: string): T | null {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim()
    return JSON.parse(jsonStr) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

interface ConversationSummary {
  summary: string
  client_want: string
  needs: string
  objections: string
  mentioned_value: string
  next_step: string
}

interface LeadAnalysis {
  intent: string
  temperature: "cold" | "warm" | "hot"
  temperature_reason: string
  confidence: number
  suggested_stage: string
  suggested_tags: string[]
  next_action: string
}

interface SuggestedReply {
  reply: string
  tone: string
  confidence: number
}

// ---------------------------------------------------------------------------
// Build context helpers
// ---------------------------------------------------------------------------

async function getConversationContext(supabase: Supabase, conversationId: string): Promise<string> {
  const { data: msgs } = await supabase
    .from("messages")
    .select("direction, content, type, sent_at")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true })
    .limit(50)

  if (!msgs || msgs.length === 0) return "Nenhuma mensagem na conversa."

  return msgs.map((m) => {
    const dir = m.direction === "inbound" ? "CLIENTE" : "VENDEDOR"
    const content = m.type === "text" ? (m.content ?? "[mídia]") : `[${m.type}]`
    return `${dir}: ${content}`
  }).join("\n")
}

async function getContactContext(supabase: Supabase, contactId: string): Promise<Record<string, unknown>> {
  const { data: contact } = await supabase
    .from("contacts")
    .select("name, phone, email, notes")
    .eq("id", contactId)
    .single()

  const { data: tags } = await supabase
    .from("contact_tags")
    .select("tag:tags(name)")
    .eq("contact_id", contactId)

  const { data: opps } = await supabase
    .from("opportunities")
    .select("title, status, stage:pipeline_stages(name), value")
    .eq("contact_id", contactId)

  return {
    contact: contact ?? {},
    tags: tags?.map((t: any) => t.tag?.name).filter(Boolean) ?? [],
    opportunities: opps ?? [],
  }
}

async function getOpportunityContext(supabase: Supabase, oppId: string): Promise<Record<string, unknown>> {
  const { data: opp } = await supabase
    .from("opportunities")
    .select("*, contact:contacts(name, phone), stage:pipeline_stages(name), assignee:profiles(full_name)")
    .eq("id", oppId)
    .single()

  const { data: tasks } = await supabase
    .from("opportunity_tasks")
    .select("title, status, due_at, task_type")
    .eq("opportunity_id", oppId)
    .order("created_at", { ascending: false })
    .limit(10)

  const { data: tags } = await supabase
    .from("opportunity_tags")
    .select("tag:tags(name)")
    .eq("opportunity_id", oppId)

  const { data: history } = await supabase
    .from("opportunity_stage_history")
    .select("old_stage_id, new_stage_id, changed_at")
    .eq("opportunity_id", oppId)
    .order("changed_at", { ascending: false })
    .limit(5)

  return {
    opportunity: opp ?? {},
    tasks: tasks ?? [],
    tags: tags?.map((t: any) => t.tag?.name).filter(Boolean) ?? [],
    stage_history: history ?? [],
  }
}

// ---------------------------------------------------------------------------
// Feature implementations
// ---------------------------------------------------------------------------

async function summarizeConversation(supabase: Supabase, conversationId: string): Promise<ConversationSummary> {
  const conversationText = await getConversationContext(supabase, conversationId)
  const { data: conv } = await supabase.from("conversations").select("contact_id").eq("id", conversationId).single()
  const contactCtx = conv?.contact_id ? await getContactContext(supabase, conv.contact_id) : {}

  const systemPrompt = `Você é um assistente comercial inteligente. Analise a conversa abaixo e retorne um JSON com:
{
  "summary": "resumo da conversa em 2-3 frases",
  "client_want": "o que o cliente deseja",
  "needs": "necessidade identificada",
  "objections": "objeções encontradas ou 'Nenhuma'",
  "mentioned_value": "valor mencionado ou 'Não mencionado'",
  "next_step": "próximo passo recomendado"
}

Contato: ${JSON.stringify(contactCtx)}

CONVERSA:
${conversationText}

Retorne APENAS o JSON, sem texto adicional.`

  const { content } = await callOpenRouter(
    [{ role: "system", content: systemPrompt }],
    { temperature: 0.3, max_tokens: 500 }
  )

  return parseStructuredResponse<ConversationSummary>(content) ?? {
    summary: "Não foi possível gerar resumo.",
    client_want: "", needs: "", objections: "", mentioned_value: "", next_step: ""
  }
}

async function analyzeLead(supabase: Supabase, conversationId: string): Promise<LeadAnalysis> {
  const conversationText = await getConversationContext(supabase, conversationId)
  const { data: conv } = await supabase.from("conversations").select("contact_id").eq("id", conversationId).single()
  const contactCtx = conv?.contact_id ? await getContactContext(supabase, conv.contact_id) : {}

  const { data: tags } = await supabase.from("tags").select("name").eq("is_active", true)
  const tagNames = tags?.map((t) => t.name) ?? []

  const systemPrompt = `Você é um analista de vendas. Analise a conversa e retorne um JSON:
{
  "intent": "purchase|question|support|complaint|information|follow_up|other",
  "temperature": "cold|warm|hot",
  "temperature_reason": "motivo da classificação",
  "confidence": 0.0 a 1.0,
  "suggested_stage": "nome do estágio mais adequado",
  "suggested_tags": ["tag1", "tag2"],
  "next_action": "próxima ação recomendada"
}

Tags disponíveis: ${JSON.stringify(tagNames)}

Contato: ${JSON.stringify(contactCtx)}

CONVERSA:
${conversationText}

Retorne APENAS o JSON.`

  const { content } = await callOpenRouter(
    [{ role: "system", content: systemPrompt }],
    { temperature: 0.3, max_tokens: 500 }
  )

  return parseStructuredResponse<LeadAnalysis>(content) ?? {
    intent: "other", temperature: "cold", temperature_reason: "Análise não disponível",
    confidence: 0, suggested_stage: "", suggested_tags: [], next_action: ""
  }
}

async function suggestReply(supabase: Supabase, conversationId: string, tone: string = "profissional_cordial"): Promise<SuggestedReply> {
  const conversationText = await getConversationContext(supabase, conversationId)
  const { data: conv } = await supabase.from("conversations").select("contact_id").eq("id", conversationId).single()
  const contactCtx = conv?.contact_id ? await getContactContext(supabase, conv.contact_id) : {}

  const systemPrompt = `Você é um assistente de vendas. Sugira uma resposta para o vendedor baseada na conversa.

Tom: ${tone}

Regras:
- Não inventar preços, prazos ou informações técnicas
- Se a informação não estiver na conversa, sugerir perguntar ao cliente
- Ser cordial e profissional
- Mensagem curta e direta

Contato: ${JSON.stringify(contactCtx)}

CONVERSA:
${conversationText}

Retorne um JSON:
{
  "reply": "sugestão de resposta",
  "tone": "tom utilizado",
  "confidence": 0.0 a 1.0
}

Retorne APENAS o JSON.`

  const { content } = await callOpenRouter(
    [{ role: "system", content: systemPrompt }],
    { temperature: 0.7, max_tokens: 300 }
  )

  return parseStructuredResponse<SuggestedReply>(content) ?? {
    reply: "Olá! Obrigado pelo contato. Como posso ajudar?",
    tone: "profissional", confidence: 0.5
  }
}

async function summarizeClient(supabase: Supabase, contactId: string): Promise<string> {
  const ctx = await getContactContext(supabase, contactId)

  // Get recent conversations
  const { data: convs } = await supabase
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)

  let conversationSummaries = ""
  if (convs && convs.length > 0) {
    for (const conv of convs.slice(0, 3)) {
      const text = await getConversationContext(supabase, conv.id)
      conversationSummaries += `\n---\nConversa:\n${text}\n`
    }
  }

  const systemPrompt = `Você é um analista comercial. Crie um resumo completo do cliente.

Dados do cliente: ${JSON.stringify(ctx)}

Histórico de conversas:${conversationSummaries}

Retorne um JSON:
{
  "who_is": "quem é o cliente",
  "what_wants": "o que deseja",
  "history": "histórico resumido",
  "objections": "objeções conhecidas",
  "last_interaction": "última interação",
  "recommended_next_action": "próxima ação recomendada"
}

Retorne APENAS o JSON.`

  const { content } = await callOpenRouter(
    [{ role: "system", content: systemPrompt }],
    { temperature: 0.3, max_tokens: 800 }
  )

  return content
}

async function analyzeOpportunity(supabase: Supabase, oppId: string): Promise<string> {
  const ctx = await getOpportunityContext(supabase, oppId)

  const systemPrompt = `Você é um analista comercial. Analise esta oportunidade e retorne insights.

Dados: ${JSON.stringify(ctx)}

Retorne um JSON:
{
  "temperature": "cold|warm|hot",
  "risk": "baixo|médio|alto",
  "risk_reason": "motivo do risco",
  "positive_points": ["ponto1", "ponto2"],
  "objections": ["objeção1"],
  "next_action": "próxima ação recomendada",
  "summary": "resumo executivo"
}

Retorne APENAS o JSON.`

  const { content } = await callOpenRouter(
    [{ role: "system", content: systemPrompt }],
    { temperature: 0.3, max_tokens: 600 }
  )

  return content
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

    // Validate JWT
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
    if (!token) return jsonResponse(401, { error: "missing token" })
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return jsonResponse(401, { error: "invalid token" })

    const body = await req.json()
    const { action, data } = body as { action: string; data: Record<string, unknown> }

    const startTime = Date.now()
    let result: unknown = null
    let error: string | null = null

    try {
      switch (action) {
        case "store_api_key": {
          // Store API key securely in a separate table
          const key = (data as any)?.key;
          if (!key) return jsonResponse(400, { error: "key required" });
          const { error } = await supabase.from("activity_log").insert({
            entity_type: "ai_key",
            entity_id: null,
            action: "API_KEY_STORED",
            actor_id: user.id,
            new_data: { key },
          });
          if (error) return jsonResponse(400, { error: error.message });
          return jsonResponse(200, { ok: true });
        }
        case "test_connection":
          try {
            await callOpenRouter([{ role: "user", content: "Hello" }], { max_tokens: 5 }, supabase)
            result = { ok: true }
          } catch (e: any) {
            return jsonResponse(200, { ok: false, error: e.message ?? String(e) })
          }
          break
        case "summarize_conversation":
          result = await summarizeConversation(supabase, data.conversation_id as string)
          break
        case "analyze_lead":
          result = await analyzeLead(supabase, data.conversation_id as string)
          break
        case "suggest_reply":
          result = await suggestReply(supabase, data.conversation_id as string, data.tone as string)
          break
        case "summarize_client":
          result = await summarizeClient(supabase, data.contact_id as string)
          break
        case "analyze_opportunity":
          result = await analyzeOpportunity(supabase, data.opportunity_id as string)
          break
        default:
          return jsonResponse(400, { error: `Unknown action: ${action}` })
      }
    } catch (e) {
      error = String(e)
    }

    // Log the request
    const latency = Date.now() - startTime
    await supabase.from("activity_log").insert({
      entity_type: "ai_request",
      entity_id: null,
      action: `${action}: ${error ? "failed" : "completed"}`,
      actor_id: user.id,
      new_data: { action, latency_ms: latency, error },
    }).then(() => {}, () => {})

    if (error) {
      return jsonResponse(500, { error: "Análise da IA falhou. Tente novamente." })
    }

    return jsonResponse(200, { ok: true, result })
  } catch (err) {
    console.error("AI_SERVICE_ERROR", err)
    return jsonResponse(500, { error: "internal error" })
  }
});
