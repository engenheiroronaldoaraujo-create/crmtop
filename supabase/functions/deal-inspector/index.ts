import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOpenRouterKey } from "../_shared/secrets.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const INSPECTOR_SYSTEM_PROMPT = `Voce e um analista de vendas especializado em CRM. Analise a conversa abaixo
e classifique o estado da oportunidade. Responda APENAS com JSON valido,
sem markdown, sem explicacoes fora do JSON.

Retorne exatamente este formato:
{
  "status": "stalled|at_risk|no_opportunity|ok",
  "stall_reason": "meeting_no_feedback|proposal_no_response|interest_no_next_step|unhandled_objection|ghost|no_human_followup|unknown",
  "priority": "high|medium|low",
  "days_stalled": numero,
  "ai_summary": "resumo em 1-2 frases do que aconteceu na conversa em portugues",
  "ai_suggestion": "acao recomendada em 1 frase em portugues",
  "suggested_message": "mensagem natural em portugues pra enviar ao lead agora (max 3 linhas, tom WhatsApp)"
}

Regras:
- priority "high": lead quente (disse sim, pediu proposta) parado ha 2+ dias
- priority "high": objecao nao tratada + vendedor sumiu
- priority "medium": interesse moderado, parada 3-7 dias
- priority "low": lead frio ou parada recente (<3 dias)
- status "ok": vendedor respondeu nas ultimas 24h — nao precisa de acao
- suggested_message: personalizada com o contexto (mencionar o servico, a dor,
  algo que o cliente disse) — NUNCA generica tipo "Oi, tudo bem?"
- Se o lead disse explicitamente que nao tem interesse: status "ok",
  stall_reason "unknown", suggested_message null`;

// ---------------------------------------------------------------------------
// AI helpers
// ---------------------------------------------------------------------------

async function getApiKey(supabase: any): Promise<string> {
  return await getOpenRouterKey(supabase);
}

async function getModel(supabase: any): Promise<string> {
  const { data } = await supabase
    .from("sdr_settings")
    .select("primary_model")
    .limit(1)
    .single();
  return data?.primary_model ?? "google/gemini-2.5-flash";
}

async function callAI(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://crm-top.vercel.app",
      "X-Title": "CRM_TOP_INSPECTOR",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: 600,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseAIResponse(text: string): Record<string, unknown> | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Find candidates — unified search
// ---------------------------------------------------------------------------

async function findCandidates(supabase: any, params: any, userId: string) {
  const candidates: Array<{
    type: "opportunity" | "orphan";
    opportunity_id: string | null;
    conversation_id: string;
    contact_id: string;
    contact_name: string;
    contact_phone: string | null;
    opp_title: string | null;
    stage_name: string | null;
    metadata: Record<string, unknown> | null;
    days_stalled: number;
    assigned_to: string | null;
  }> = [];

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - params.stalled_days);
  const cutoff = cutoffDate.toISOString();

  // 1. Get ALL stalled conversations with at least 1 inbound message
  const { data: convs } = await supabase
    .from("conversations")
    .select(`
      id, contact_id, last_message_at,
      contact:contacts(name, phone)
    `)
    .lt("last_message_at", cutoff)
    .not("contact_id", "is", null);

  if (!convs || convs.length === 0) return candidates;

  // 2. For each conversation, find linked opportunity and check inbound count
  for (const conv of convs) {
    // Check inbound message count
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conv.id)
      .eq("direction", "inbound");

    if ((count ?? 0) < 1) continue;

    // Find opportunity: by conversation_id first, then by contact_id
    let opp: any = null;

    // Direct link
    const { data: directOpp } = await supabase
      .from("opportunities")
      .select(`
        id, title, contact_id, conversation_id, metadata, assigned_to, status,
        stage_id, stage:pipeline_stages(name)
      `)
      .eq("conversation_id", conv.id)
      .limit(1)
      .maybeSingle();

    if (directOpp) {
      opp = directOpp;
    } else {
      // Indirect link: same contact_id, open status
      const { data: contactOpp } = await supabase
        .from("opportunities")
        .select(`
          id, title, contact_id, conversation_id, metadata, assigned_to, status,
          stage_id, stage:pipeline_stages(name)
        `)
        .eq("contact_id", conv.contact_id)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();

      if (contactOpp) opp = contactOpp;
    }

    // Skip closed opportunities unless include_closed
    if (opp && (opp.status === "won" || opp.status === "lost") && !params.include_closed) {
      continue;
    }

    // Filter by stage_ids if provided
    if (opp && params.stage_ids && params.stage_ids.length > 0) {
      if (!params.stage_ids.includes(opp.stage_id)) continue;
    }

    const days = Math.floor(
      (Date.now() - new Date(conv.last_message_at).getTime()) / 86400000
    );

    candidates.push({
      type: opp ? "opportunity" : "orphan",
      opportunity_id: opp?.id ?? null,
      conversation_id: conv.id,
      contact_id: conv.contact_id,
      contact_name: conv.contact?.name ?? "Sem nome",
      contact_phone: conv.contact?.phone ?? null,
      opp_title: opp?.title ?? null,
      stage_name: opp?.stage?.name ?? null,
      metadata: opp?.metadata ?? null,
      days_stalled: days,
      assigned_to: opp?.assigned_to ?? null,
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Analyze single candidate
// ---------------------------------------------------------------------------

async function analyzeCandidate(
  supabase: any,
  apiKey: string,
  model: string,
  candidate: any,
  historyDays: number,
): Promise<Record<string, unknown>> {
  // Get messages
  const { data: msgs } = await supabase
    .from("messages")
    .select("direction, content, type, sent_at, transcription")
    .eq("conversation_id", candidate.conversation_id)
    .order("sent_at", { ascending: false })
    .limit(30);

  const history = (msgs ?? []).reverse().map((m: any) => {
    const time = new Date(m.sent_at).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const dir = m.direction === "inbound" ? "cliente" : "vendedor";
    let content: string;
    if (m.type === "text") content = m.content ?? "[midia]";
    else if (m.type === "audio" && m.transcription) content = `[audio do cliente: ${m.transcription}]`;
    else content = `[${m.type}]`;
    return `[${time} ${dir}] ${content}`;
  }).join("\n");

  const userMsg = candidate.opp_title
    ? `Oportunidade: ${candidate.opp_title}
Estagio atual: ${candidate.stage_name ?? "N/A"}
Dias sem atividade do cliente: ${candidate.days_stalled}
Informacoes coletadas pelo SDR: ${JSON.stringify(candidate.metadata ?? {})}

Historico da conversa (mais recente primeiro):
${history || "(sem mensagens)"}`
    : `CONVERSA SEM OPORTUNIDADE/CARD VINCULADO
Dias sem atividade do cliente: ${candidate.days_stalled}

Historico da conversa (mais recente primeiro):
${history || "(sem mensagens)"}

Se houver potencial de venda, classifique como "no_opportunity".`;

  const content = await callAI(apiKey, model, [
    { role: "system", content: INSPECTOR_SYSTEM_PROMPT },
    { role: "user", content: userMsg },
  ]);

  const parsed = parseAIResponse(content);
  if (!parsed) {
    return {
      status: "stalled",
      stall_reason: "unknown",
      priority: "medium",
      days_stalled: candidate.days_stalled,
      ai_summary: "Analise indisponivel — resposta da IA invalida.",
      ai_suggestion: "Verificar a conversa manualmente.",
      suggested_message: null,
    };
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Edge Function entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth inline (pattern from ai-service)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return jsonResponse(401, { error: "missing token" });

    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return jsonResponse(401, { error: "invalid token" });

    const params = await req.json();

    // Validate required params
    if (typeof params.stalled_days !== "number" || params.stalled_days < 1) {
      return jsonResponse(400, { error: "stalled_days required (min 1)" });
    }

    const apiKey = await getApiKey(supabase);
    if (!apiKey) {
      return jsonResponse(400, { error: "API Key nao configurada. Configure em Configuracoes → IA." });
    }

    const model = await getModel(supabase);

    // Find candidates
    const candidates = await findCandidates(supabase, params, user.id);

    if (candidates.length === 0) {
      return jsonResponse(200, {
        ok: true,
        insights: [],
        summary: { total: 0, analyzed: 0, errors: 0 },
      });
    }

    // Analyze each candidate (concurrency 3)
    const insights: any[] = [];
    let errors = 0;

    for (let i = 0; i < candidates.length; i += 3) {
      const batch = candidates.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map(async (candidate) => {
          try {
            const analysis = await analyzeCandidate(
              supabase, apiKey, model, candidate, params.history_days ?? 30,
            );

            // Filter by stall_reasons if provided
            if (
              params.stall_reasons &&
              params.stall_reasons.length > 0 &&
              !params.stall_reasons.includes(analysis.stall_reason) &&
              analysis.status !== "ok"
            ) {
              return null;
            }

            // Skip "ok" status
            if (analysis.status === "ok") return null;

            // Insert insight
            const { data: insight, error: insertErr } = await supabase
              .from("deal_insights")
              .insert({
                opportunity_id: candidate.opportunity_id,
                conversation_id: candidate.conversation_id,
                contact_id: candidate.contact_id,
                status: analysis.status,
                stall_reason: analysis.stall_reason,
                days_stalled: analysis.days_stalled ?? candidate.days_stalled,
                priority: analysis.priority,
                ai_summary: analysis.ai_summary,
                ai_suggestion: analysis.ai_suggestion,
                suggested_message: analysis.suggested_message ?? null,
                search_params: params,
              })
              .select("id")
              .single();

            if (insertErr) {
              console.error("DEAL_INSIGHT_INSERT_ERROR", insertErr);
              errors++;
              return null;
            }

            // Create task if requested
            if (params.action_mode === "create_task" && insight) {
              const dueAt = new Date();
              dueAt.setHours(dueAt.getHours() + 24);
              await supabase.from("opportunity_tasks").insert({
                opportunity_id: candidate.opportunity_id,
                contact_id: candidate.contact_id,
                assigned_to: candidate.assigned_to ?? user.id,
                title: analysis.ai_suggestion ?? "Follow-up recomendado pelo Deal Inspector",
                task_type: "follow_up",
                due_at: dueAt.toISOString(),
                priority: analysis.priority === "high" ? "high" : "normal",
                created_by: user.id,
              }).then(() => {}, () => {});
            }

            return {
              insight_id: insight?.id,
              opportunity_id: candidate.opportunity_id,
              conversation_id: candidate.conversation_id,
              contact_id: candidate.contact_id,
              contact_name: candidate.contact_name,
              contact_phone: candidate.contact_phone,
              opp_title: candidate.opp_title,
              stage_name: candidate.stage_name,
              type: candidate.type,
              assigned_to: candidate.assigned_to,
              ...analysis,
            };
          } catch (e) {
            console.error("DEAL_INSPECT_CANDIDATE_ERROR", e);
            errors++;
            return null;
          }
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          insights.push(r.value);
        }
      }
    }

    // Sort: high → medium → low, then days_stalled desc
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    insights.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 1;
      const pb = priorityOrder[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return (b.days_stalled ?? 0) - (a.days_stalled ?? 0);
    });

    return jsonResponse(200, {
      ok: true,
      insights,
      summary: {
        total: candidates.length,
        analyzed: insights.length,
        errors,
      },
    });
  } catch (err) {
    console.error("DEAL_INSPECTOR_ERROR", err);
    return jsonResponse(500, { error: "internal error" });
  }
});
