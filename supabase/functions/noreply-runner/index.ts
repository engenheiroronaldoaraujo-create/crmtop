// noreply-runner — régua de follow-up para leads sem resposta.
//
// Agendado por pg_cron a cada 10 min (057_noreply_followup.sql), autorizado
// por `noreply_internal_token` em app_secrets (mesmo padrão do cadence-runner).
//
// O que faz a cada passada:
//   1. detectNew — matrícula: conversas onde nós falamos por último
//      (last_message_inbound = false), contato sem opt-out, oportunidade open
//      em pipeline habilitado, sem estado ativo e sem SDR IA no comando
//      (SQL centralizado em noreply_detect_candidates) → cria estado com a
//      1ª checagem em last_message_at + delay(tentativa 1).
//   2. executeDues — estados vencidos: envia a mensagem da tentativa via
//      Evolution (respeitando horário comercial/fim de semana), incrementa
//      attempts_made e agenda a próxima; falha de envio NÃO conta como
//      tentativa (reagenda +6h; 3 falhas seguidas cancelam a régua).
//   3. exhaust — tentativas esgotadas: move a oportunidade para o estágio de
//      destino (noreply_pipeline_configs), marca o estado como exhausted,
//      cria tarefa de follow_up para o responsável e registra no activity_log.
//
// Resposta do lead encerra a régua no webhook (noreply_mark_replied); toda
// mensagem nossa reinicia o relógio (noreply_touch) sem zerar as tentativas.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/contacts.ts";
import { resolveSendTarget } from "../_shared/evolution-identity.ts";
import { timingSafeEqual } from "../_shared/timing.ts";
import {
  isWeekend,
  localParts,
  skipToBusinessDay,
  substituteVariables,
  timeToMinutes,
} from "../_shared/noreply-schedule.ts";

const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NoreplySettings {
  is_active: boolean;
  business_hours_only: boolean;
  skip_weekends: boolean;
  restart_after_reply: boolean;
  exhaust_grace_hours: number;
  task_on_exhaust: boolean;
}

interface NoreplyAttempt {
  id: string;
  attempt_number: number;
  delay_hours: number;
  template_id: string | null;
  message_text: string | null;
  is_active: boolean;
}

interface NoreplyState {
  id: string;
  conversation_id: string;
  contact_id: string;
  opportunity_id: string | null;
  attempts_made: number;
  status: "active" | "replied" | "exhausted" | "cancelled";
  next_check_at: string | null;
  next_delay_hours: number | null;
  last_outbound_at: string | null;
  started_at: string;
}

interface ConversationRow {
  id: string;
  contact_id: string;
  instance_id: string;
  status: "open" | "closed";
  last_message_inbound: boolean | null;
  last_message_at: string | null;
  instance?: { instance_name: string } | null;
}

interface Contact {
  id: string;
  name: string | null;
  push_name: string | null;
  phone: string | null;
  lid: string | null;
  jid: string | null;
  opted_out: boolean;
}

interface Opportunity {
  id: string;
  contact_id: string;
  pipeline_id: string;
  stage_id: string;
  assigned_to: string | null;
  conversation_id: string | null;
  status: "open" | "won" | "lost";
  title: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const supabase = serviceClient();

async function authorize(req: Request, internalToken: string | undefined): Promise<boolean> {
  const url = new URL(req.url);
  const token = (internalToken ?? "").trim() || (url.searchParams.get("token") ?? "").trim();
  if (!token) return false;

  const { data: secret, error } = await supabase
    .from("app_secrets")
    .select("value")
    .eq("key", "noreply_internal_token")
    .maybeSingle();
  if (error) {
    console.error("NOREPLY_TOKEN_LOOKUP_FAILED", error.message);
    return false;
  }
  // Fail closed: sem segredo cadastrado, ninguém passa.
  if (!secret?.value) return false;

  return timingSafeEqual(token, secret.value);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withinBusinessHours(): Promise<boolean> {
  const { dayOfWeek, minutes } = localParts(new Date());
  const { data: hours } = await supabase
    .from("business_hours")
    .select("is_active, start_time, end_time")
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();
  if (!hours || !hours.is_active) return false;
  return minutes >= timeToMinutes(hours.start_time) && minutes <= timeToMinutes(hours.end_time);
}

async function callEvolution(
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; data: any; text: string }> {
  const res = await fetch(`${EVOLUTION_API_URL}${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: {
      apikey: EVOLUTION_API_KEY,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, data, text };
}

// Cache de conectividade por instância com TTL curto: evita N chamadas à
// Evolution no mesmo run, mas NÃO mascara reconexões ao longo da vida do
// isolate (per_worker mantém o módulo quente entre requests).
const instanceStateCache = new Map<string, { connected: boolean; at: number }>();
const INSTANCE_CACHE_TTL_MS = 60_000;

async function instanceConnected(instanceName: string): Promise<boolean> {
  const cached = instanceStateCache.get(instanceName);
  if (cached && Date.now() - cached.at < INSTANCE_CACHE_TTL_MS) return cached.connected;
  let connected = false;
  if (EVOLUTION_API_URL && EVOLUTION_API_KEY) {
    const st = await callEvolution(`/instance/connectionState/${instanceName}`);
    const state = String(st.data?.instance?.state ?? "").toLowerCase();
    connected = state === "open";
  }
  instanceStateCache.set(instanceName, { connected, at: Date.now() });
  return connected;
}

async function logEvent(
  stateId: string,
  eventType: string,
  attempt: number | null,
  messageId: string | null = null,
  details: Record<string, unknown> | null = null,
): Promise<void> {
  const { error } = await supabase.from("noreply_events").insert({
    state_id: stateId,
    event_type: eventType,
    attempt,
    message_id: messageId,
    details,
  });
  if (error) console.error("NOREPLY_EVENT_INSERT_FAILED", stateId, eventType, error.message);
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

async function loadSettings(): Promise<NoreplySettings | null> {
  const { data, error } = await supabase
    .from("noreply_settings")
    .select(
      "is_active, business_hours_only, skip_weekends, restart_after_reply, exhaust_grace_hours, task_on_exhaust",
    )
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("NOREPLY_SETTINGS_LOAD_FAILED", error.message);
    return null;
  }
  return (data as NoreplySettings) ?? null;
}

async function loadAttempts(): Promise<NoreplyAttempt[]> {
  const { data, error } = await supabase
    .from("noreply_attempts")
    .select("id, attempt_number, delay_hours, template_id, message_text, is_active")
    .eq("is_active", true)
    .order("attempt_number");
  if (error) {
    console.error("NOREPLY_ATTEMPTS_LOAD_FAILED", error.message);
    return [];
  }
  return (data as NoreplyAttempt[]) ?? [];
}

async function loadConversation(conversationId: string): Promise<ConversationRow | null> {
  const { data } = await supabase
    .from("conversations")
    .select("id, contact_id, instance_id, status, last_message_inbound, last_message_at, instance:whatsapp_instances(instance_name)")
    .eq("id", conversationId)
    .maybeSingle();
  // join aninhado com maybeSingle chega como objeto, mas o tipo genérico do
  // supabase-js o infere como array — cast via unknown (padrão do cadence-runner).
  return (data as unknown as ConversationRow) ?? null;
}

async function loadContact(contactId: string): Promise<Contact | null> {
  const { data } = await supabase
    .from("contacts")
    .select("id, name, push_name, phone, lid, jid, opted_out")
    .eq("id", contactId)
    .maybeSingle();
  return (data as Contact) ?? null;
}

async function loadOpportunity(oppId: string): Promise<Opportunity | null> {
  const { data } = await supabase
    .from("opportunities")
    .select("id, contact_id, pipeline_id, stage_id, assigned_to, conversation_id, status, title")
    .eq("id", oppId)
    .maybeSingle();
  return (data as Opportunity) ?? null;
}

/** SDR IA ativo no comando da conversa? (active/paused_limit/paused_schedule) */
async function sdrOwnsConversation(conversationId: string): Promise<boolean> {
  const { data } = await supabase
    .from("sdr_conversations")
    .select("status")
    .eq("conversation_id", conversationId)
    .in("status", ["active", "paused_limit", "paused_schedule"])
    .maybeSingle();
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Cancel / replied helpers (estado → terminal + evento)
// ---------------------------------------------------------------------------

async function cancelState(state: NoreplyState, reason: string): Promise<void> {
  const { error } = await supabase
    .from("noreply_states")
    .update({ status: "cancelled", ended_at: new Date().toISOString(), next_check_at: null })
    .eq("id", state.id)
    .eq("status", "active");
  if (error) console.error("NOREPLY_CANCEL_FAILED", state.id, error.message);
  else await logEvent(state.id, "cancelled", state.attempts_made, null, { reason });
}

async function markReplied(state: NoreplyState): Promise<void> {
  const { error } = await supabase
    .from("noreply_states")
    .update({ status: "replied", ended_at: new Date().toISOString(), next_check_at: null })
    .eq("id", state.id)
    .eq("status", "active");
  if (error) console.error("NOREPLY_REPLIED_FAILED", state.id, error.message);
  else await logEvent(state.id, "reply_detected", state.attempts_made, null, { reason: "runner_recheck" });
}

async function rescheduleState(state: NoreplyState, nextCheckAt: Date, reason: string): Promise<void> {
  const { error } = await supabase
    .from("noreply_states")
    .update({ next_check_at: nextCheckAt.toISOString() })
    .eq("id", state.id)
    .eq("status", "active");
  if (error) console.error("NOREPLY_RESCHEDULE_FAILED", state.id, error.message);
  else await logEvent(state.id, "rescheduled", state.attempts_made, null, { reason });
}

// ---------------------------------------------------------------------------
// 1) MATRÍCULA — conversas em silêncio ganham a régua
// ---------------------------------------------------------------------------

async function detectNew(
  settings: NoreplySettings,
  attempts: NoreplyAttempt[],
): Promise<{ enrolled: number; skipped: number }> {
  let enrolled = 0;
  let skipped = 0;
  if (attempts.length === 0) return { enrolled, skipped };

  // Horizonte da régua (soma dos delays + tolerância final): conversas mais
  // antigas que isso não são matriculadas — evita rajada retroativa quando o
  // admin liga o recurso (ou quando o runner volta de uma queda longa).
  const horizonMs =
    (attempts.reduce((acc, a) => acc + a.delay_hours, 0) + settings.exhaust_grace_hours) * 3600_000;

  const { data: candidates, error } = await supabase.rpc("noreply_detect_candidates", {
    p_limit: 100,
  });
  if (error) {
    console.error("NOREPLY_DETECT_FAILED", error.message);
    return { enrolled, skipped };
  }

  const firstDelay = attempts[0].delay_hours;
  for (const c of (candidates ?? []) as {
    r_conversation_id: string;
    r_contact_id: string;
    r_opportunity_id: string;
    r_last_message_at: string;
  }[]) {
    const lastAt = new Date(c.r_last_message_at).getTime();
    if (Date.now() - lastAt > horizonMs) {
      skipped++;
      continue;
    }

    // 1ª checagem: silêncio de delay(tentativa 1) contado desde a última
    // mensagem da conversa (a nossa). Fim de semana empurra para dia útil.
    const nextCheck = skipToBusinessDay(
      new Date(lastAt + firstDelay * 3600_000),
      settings.skip_weekends,
    );

    const { error: insertError, data: created } = await supabase
      .from("noreply_states")
      .insert({
        conversation_id: c.r_conversation_id,
        contact_id: c.r_contact_id,
        opportunity_id: c.r_opportunity_id,
        attempts_made: 0,
        status: "active",
        next_check_at: nextCheck.toISOString(),
        // Delay da 1ª tentativa — fonte única usada também pelo noreply_touch.
        next_delay_hours: attempts[0].delay_hours,
      })
      .select("id")
      .maybeSingle();
    if (insertError) {
      // 23505: corrida com outra passada/unique parcial de estado ativo.
      if (insertError.code !== "23505") {
        console.error("NOREPLY_ENROLL_FAILED", c.r_conversation_id, insertError.message);
      }
      continue;
    }
    if (created) {
      await logEvent(created.id, "started", 0, null, {
        last_message_at: c.r_last_message_at,
        next_check_at: nextCheck.toISOString(),
      });
    }
    enrolled++;
  }

  return { enrolled, skipped };
}

// ---------------------------------------------------------------------------
// Envio da mensagem da tentativa
// ---------------------------------------------------------------------------

/**
 * Envia a mensagem da tentativa pela instância da própria conversa (é o canal
 * natural do lead). Semântica de persistência: sucesso grava a message row
 * (status 'sent') + bump; FALHA não grava bolha no chat (o lead não recebeu
 * nada, a bolha vermelha confundiria o SDR) — o erro vai para noreply_events.
 */
async function sendAttemptMessage(
  attempt: NoreplyAttempt,
  conversation: ConversationRow,
  contact: Contact,
): Promise<{ messageId: string | null; error: string | null }> {
  const vars = {
    contact: { name: contact.name ?? contact.push_name ?? "Cliente", phone: contact.phone },
    contact_name: contact.name ?? contact.push_name ?? "Cliente",
  };
  let text = "";
  if (attempt.message_text) {
    text = substituteVariables(attempt.message_text, vars);
  } else if (attempt.template_id) {
    const { data: tpl } = await supabase
      .from("message_templates")
      .select("body")
      .eq("id", attempt.template_id)
      .maybeSingle();
    text = substituteVariables(String(tpl?.body ?? ""), vars);
  }

  if (!text.trim()) return { messageId: null, error: "tentativa sem template/texto configurado" };
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return { messageId: null, error: "Evolution API não configurada" };
  }

  const instanceName = conversation.instance?.instance_name;
  if (!instanceName) return { messageId: null, error: "conversa sem instância associada" };
  if (!(await instanceConnected(instanceName))) {
    return { messageId: null, error: `instância ${instanceName} desconectada` };
  }

  const sendTarget = resolveSendTarget(contact).target;
  if (!sendTarget) return { messageId: null, error: "contato sem identificador confiável para envio" };

  const sentAt = new Date().toISOString();
  const { ok, data, text: respText } = await callEvolution(
    `/message/sendText/${instanceName}`,
    { number: sendTarget, text },
  );

  if (!ok) return { messageId: null, error: `evolution sendText failed: ${respText.slice(0, 300)}` };

  const { data: msgRow } = await supabase
    .from("messages")
    .upsert(
      {
        conversation_id: conversation.id,
        evolution_message_id: data?.key?.id ?? null,
        direction: "outbound",
        sender_profile_id: null,
        type: "text",
        content: text,
        media_url: null,
        sent_at: sentAt,
        status: "sent",
        send_error: null,
      },
      { onConflict: "conversation_id, evolution_message_id" },
    )
    .select("id")
    .maybeSingle();

  void (async () => {
    const { error } = await supabase.rpc("bump_conversation", {
      p_id: conversation.id,
      p_sent_at: sentAt,
      p_preview: text.slice(0, 140),
      p_inbound: false,
    });
    if (error) console.error("BUMP_CONVERSATION_FAILED", error.message);
  })();

  return { messageId: msgRow?.id ?? null, error: null };
}

// ---------------------------------------------------------------------------
// 2) EXECUÇÃO — estados vencidos
// ---------------------------------------------------------------------------

async function executeDues(
  settings: NoreplySettings,
  attempts: NoreplyAttempt[],
): Promise<{ sent: number; exhausted: number; failed: number; skipped: number }> {
  let sent = 0;
  let exhausted = 0;
  let failed = 0;
  let skipped = 0;

  const { data: dues } = await supabase
    .from("noreply_states")
    .select("*")
    .eq("status", "active")
    .lte("next_check_at", new Date().toISOString())
    .order("next_check_at")
    .limit(50);
  if (!dues || dues.length === 0) return { sent, exhausted, failed, skipped };

  for (const state of dues as NoreplyState[]) {
    try {
      const conversation = await loadConversation(state.conversation_id);

      // Conversa sumiu (cascade) ou foi encerrada → régua não tem mais sentido.
      if (!conversation || conversation.status !== "open") {
        await cancelState(state, "conversation_closed");
        continue;
      }

      // Lead respondeu entre o agendamento e agora (corrida com o webhook).
      if (conversation.last_message_inbound === true) {
        await markReplied(state);
        continue;
      }

      const contact = await loadContact(state.contact_id);
      if (!contact) {
        await cancelState(state, "contact_missing");
        continue;
      }
      if (contact.opted_out) {
        await cancelState(state, "opted_out");
        continue;
      }

      // SDR IA reassumiu a conversa → régua sai de cena (a IA tem a própria
      // lógica de cooldown; duas respostas automáticas não podem competir).
      if (await sdrOwnsConversation(state.conversation_id)) {
        await cancelState(state, "sdr_active");
        continue;
      }

      // Oportunidade: pode ter sido ganha/perdida no meio do ciclo — ou
      // deletada (FK on delete set null → opportunity_id null). Em todos os
      // casos a régua não tem mais card para mover: encerra.
      if (state.opportunity_id) {
        const opp = await loadOpportunity(state.opportunity_id);
        if (!opp || opp.status !== "open") {
          await cancelState(state, "opportunity_closed");
          continue;
        }
      } else {
        await cancelState(state, "opportunity_deleted");
        continue;
      }

      const attemptIndex = state.attempts_made; // próxima tentativa = attempts_made + 1
      if (attemptIndex >= attempts.length) {
        // Todas as tentativas enviadas e o prazo final passou → esgotar.
        const done = await exhaustState(state, settings);
        if (done) exhausted++;
        else failed++;
        continue;
      }

      const attempt = attempts[attemptIndex];

      // Janelas de envio: horário comercial e fim de semana.
      const now = new Date();
      if (settings.skip_weekends && isWeekend(now)) {
        skipped++;
        continue; // mantém next_check_at vencido; o próximo run em dia útil envia
      }
      if (settings.business_hours_only && !(await withinBusinessHours())) {
        skipped++;
        continue;
      }

      const result = await sendAttemptMessage(attempt, conversation, contact);
      if (result.error) {
        failed++;
        await logEvent(state.id, "send_failed", state.attempts_made + 1, null, {
          error: result.error,
        });
        // Falha não conta como tentativa. 3 falhas seguidas desistem da régua.
        const sinceIso = state.last_outbound_at ?? state.started_at;
        const { count: failCount } = await supabase
          .from("noreply_events")
          .select("id", { count: "exact", head: true })
          .eq("state_id", state.id)
          .eq("event_type", "send_failed")
          .gt("created_at", sinceIso);
        if ((failCount ?? 0) >= 3) {
          await cancelState(state, "send_failures");
        } else {
          await rescheduleState(
            state,
            new Date(Date.now() + 6 * 3600_000),
            `send_failed: ${result.error.slice(0, 120)}`,
          );
        }
        continue;
      }

      // Sucesso: conta a tentativa e agenda a próxima (ou o prazo final).
      const nextAttempt = attempts[attemptIndex + 1];
      const nextCheck = skipToBusinessDay(
        new Date(
          Date.now() +
            (nextAttempt ? nextAttempt.delay_hours : settings.exhaust_grace_hours) * 3600_000,
        ),
        settings.skip_weekends,
      );
      const { error: updErr } = await supabase
        .from("noreply_states")
        .update({
          attempts_made: state.attempts_made + 1,
          next_check_at: nextCheck.toISOString(),
          // Delay da próxima tentativa — o noreply_touch usa este valor.
          next_delay_hours: nextAttempt ? nextAttempt.delay_hours : null,
          last_outbound_at: new Date().toISOString(),
        })
        .eq("id", state.id)
        .eq("status", "active");
      if (updErr) {
        console.error("NOREPLY_ADVANCE_FAILED", state.id, updErr.message);
        failed++;
        continue;
      }

      await logEvent(state.id, "attempt_sent", state.attempts_made + 1, result.messageId, {
        attempt_number: attempt.attempt_number,
        next_check_at: nextCheck.toISOString(),
      });
      sent++;
    } catch (e) {
      failed++;
      console.error("NOREPLY_EXECUTION_ERROR", state.id, e);
    }
  }

  return { sent, exhausted, failed, skipped };
}

// ---------------------------------------------------------------------------
// 3) ESGOTAMENTO — move o card para revisão humana
// ---------------------------------------------------------------------------

/**
 * Move a oportunidade para o estágio de destino do pipeline (padrão
 * "Sem Resposta"), encerra o estado e cria tarefa de revisão.
 * Retorna false quando o esgotamento deve ser tentado de novo no próximo run
 * (falha de move, ex.) — o estado continua ativo e vencido.
 */
async function exhaustState(state: NoreplyState, settings: NoreplySettings): Promise<boolean> {
  const opp = state.opportunity_id ? await loadOpportunity(state.opportunity_id) : null;
  if (!opp || opp.status !== "open") {
    await cancelState(state, "opportunity_closed");
    return true; // terminal: não é falha, apenas não há o que mover
  }

  // Config do pipeline: estágio de destino (pode ter sido desabilitada no
  // meio do ciclo — nesse caso apenas encerra, sem mover).
  const { data: config } = await supabase
    .from("noreply_pipeline_configs")
    .select("target_stage_id, is_enabled")
    .eq("pipeline_id", opp.pipeline_id)
    .maybeSingle();

  let movedToStage: string | null = null;
  if (config?.is_enabled && config.target_stage_id) {
    if (opp.stage_id !== config.target_stage_id) {
      const { error: moveErr } = await supabase.rpc("move_opportunity_stage", {
        p_opportunity_id: opp.id,
        p_new_stage_id: config.target_stage_id,
      });
      if (moveErr) {
        console.error("NOREPLY_MOVE_STAGE_FAILED", opp.id, moveErr.message);
        await rescheduleState(state, new Date(Date.now() + 3600_000), "move_stage_failed");
        return false;
      }
    }
    movedToStage = config.target_stage_id;
  }

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("noreply_states")
    .update({ status: "exhausted", ended_at: nowIso, next_check_at: null })
    .eq("id", state.id)
    .eq("status", "active");
  if (error) {
    console.error("NOREPLY_EXHAUST_UPDATE_FAILED", state.id, error.message);
    return false;
  }

  await logEvent(state.id, "exhausted", state.attempts_made, null, { attempts_made: state.attempts_made });
  if (movedToStage) {
    await logEvent(state.id, "moved_to_stage", state.attempts_made, null, { stage_id: movedToStage });
  }

  // Trilha de auditoria + tarefa para o humano analisar/excluir o card.
  // Sequencial (sem fire-and-forget): função chamada por cron — o isolate pode
  // congelar logo após a resposta HTTP, e perder a tarefa de revisão aqui
  // deixaria o card movido sem ninguém notificado.
  await supabase.from("activity_log").insert({
    entity_type: "opportunity",
    entity_id: opp.id,
    action: movedToStage
      ? `NOREPLY: movida para o estágio "Sem Resposta" (lead não respondeu após ${state.attempts_made} tentativa(s))`
      : `NOREPLY: régua esgotada após ${state.attempts_made} tentativa(s) — sem estágio de destino configurado`,
    new_data: { attempts_made: state.attempts_made, stage_id: movedToStage },
  });

  if (settings.task_on_exhaust) {
    await supabase.from("opportunity_tasks").insert({
      opportunity_id: opp.id,
      contact_id: opp.contact_id,
      assigned_to: opp.assigned_to,
      title: "Lead sem resposta — revisar no funil",
      description:
        "A régua de follow-up automático esgotou as tentativas e o lead continua sem responder. Analise o card: exclua (perdido) ou retome o contato manualmente.",
      task_type: "follow_up",
      due_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      status: "pending",
      priority: "normal",
    });
  }

  return true;
}

// ---------------------------------------------------------------------------
// Edge Function entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    if (!(await authorize(req, payload?.internal_token as string | undefined))) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    const settings = await loadSettings();
    if (!settings || !settings.is_active) {
      return jsonResponse(200, { ok: true, active: false });
    }

    const attempts = await loadAttempts();
    if (attempts.length === 0) {
      return jsonResponse(200, { ok: true, active: true, attempts: 0 });
    }

    const detected = await detectNew(settings, attempts);
    const executed = await executeDues(settings, attempts);

    return jsonResponse(200, {
      ok: true,
      active: true,
      attempts: attempts.length,
      enrolled: detected.enrolled,
      out_of_horizon: detected.skipped,
      sent: executed.sent,
      exhausted: executed.exhausted,
      failed: executed.failed,
      skipped_window: executed.skipped,
    });
  } catch (err) {
    console.error("NOREPLY_RUNNER_ERROR", err);
    return jsonResponse(500, { error: "internal error" });
  }
});
