import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, upsertConversation } from "../_shared/contacts.ts";
import { resolveSendTarget } from "../_shared/evolution-identity.ts";

const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const TIMEZONE = "America/Sao_Paulo";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CadenceStep {
  id: string;
  cadence_id: string;
  step_order: number;
  stage_id: string;
  delay_days: number;
  send_message: boolean;
  template_id: string | null;
  message_text: string | null;
}

interface Cadence {
  id: string;
  name: string;
  pipeline_id: string;
  trigger_stage_id: string;
  skip_weekends: boolean;
  is_active: boolean;
  steps: CadenceStep[];
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

interface Enrollment {
  id: string;
  cadence_id: string;
  opportunity_id: string;
  current_step: number;
  status: "active" | "paused" | "completed" | "cancelled";
  next_run_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  assigned_to: string | null;
}

interface Contact {
  id: string;
  name: string | null;
  push_name: string | null;
  phone: string | null;
  lid: string | null;
  jid: string | null;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const supabase = serviceClient();

async function authorize(req: Request, internalToken: string | undefined): Promise<boolean> {
  if (internalToken) return true;
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) return false;
  const { data: secret } = await supabase
    .from("app_secrets")
    .select("value")
    .eq("key", "cadence_internal_token")
    .maybeSingle();
  return token === secret?.value;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function substituteVariables(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
    const parts = path.split(".");
    let val: unknown = data;
    for (const p of parts) {
      if (val && typeof val === "object") val = (val as Record<string, unknown>)[p];
      else return match;
    }
    return val != null ? String(val) : match;
  });
}

/** Ajusta a data para pular fim de semana (skip_weekends). */
function skipToBusinessDay(date: Date, skipWeekends: boolean): Date {
  if (!skipWeekends) return date;
  while (true) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) return date;
    date = new Date(date.getTime() + 86400000);
  }
}

/** Próxima execução: agora + delay_days da etapa, pulando fim de semana se configurado. */
function nextRunAt(cadence: Cadence, step: CadenceStep | null): string | null {
  if (!step) return null;
  const d = new Date(Date.now() + Math.max(0, step.delay_days) * 86400000);
  return skipToBusinessDay(d, cadence.skip_weekends).toISOString();
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

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

async function loadCadences(): Promise<Cadence[]> {
  const { data: rows } = await supabase
    .from("cadences")
    .select("*")
    .eq("is_active", true)
    .order("created_at");
  if (!rows || rows.length === 0) return [];

  const { data: steps } = await supabase
    .from("cadence_steps")
    .select("*")
    .in("cadence_id", rows.map((r: any) => r.id))
    .order("step_order");

  const byCadence = new Map<string, CadenceStep[]>();
  for (const s of (steps ?? []) as CadenceStep[]) {
    const list = byCadence.get(s.cadence_id) ?? [];
    list.push(s);
    byCadence.set(s.cadence_id, list);
  }
  return (rows as any[]).map((r) => ({ ...r, steps: byCadence.get(r.id) ?? [] }));
}

async function loadOpportunity(oppId: string): Promise<Opportunity | null> {
  const { data } = await supabase
    .from("opportunities")
    .select("id, contact_id, pipeline_id, stage_id, assigned_to, conversation_id, status, title")
    .eq("id", oppId)
    .maybeSingle();
  return (data as Opportunity) ?? null;
}

async function loadContact(contactId: string): Promise<Contact | null> {
  const { data } = await supabase
    .from("contacts")
    .select("id, name, push_name, phone, lid, jid")
    .eq("id", contactId)
    .maybeSingle();
  return (data as Contact) ?? null;
}

// ---------------------------------------------------------------------------
// Envio WhatsApp
// ---------------------------------------------------------------------------

/**
 * Escolhe a instância para envio: conversa da oportunidade (preferida pelo
 * operador) → qualquer conversa do contato → primeira instância conectada.
 * Retorna { instanceId, instanceName } ou null.
 */
async function resolveInstance(
  opp: Opportunity,
  contact: Contact,
): Promise<{ instance_id: string; instance_name: string } | null> {
  const candidates: { instance_id: string; instance_name: string }[] = [];

  if (opp.conversation_id) {
    const { data } = await supabase
      .from("conversations")
      .select("instance_id, instance:whatsapp_instances(instance_name)")
      .eq("id", opp.conversation_id)
      .maybeSingle();
    if (data?.instance_id && (data as any).instance?.instance_name) {
      candidates.push({ instance_id: data.instance_id, instance_name: (data as any).instance.instance_name });
    }
  }

  const { data: convs } = await supabase
    .from("conversations")
    .select("instance_id, instance:whatsapp_instances(instance_name)")
    .eq("contact_id", contact.id);
  for (const c of convs ?? []) {
    const name = (c as any).instance?.instance_name;
    if (c.instance_id && name) candidates.push({ instance_id: c.instance_id, instance_name: name });
  }

  if (candidates.length === 0) {
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name")
      .eq("status", "connected")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (inst) candidates.push({ instance_id: inst.id, instance_name: inst.instance_name });
  }

  if (candidates.length === 0) return null;

  // Prefere a primeira candidata conectada (verifica na Evolution).
  for (const c of candidates) {
    const st = await callEvolution(`/instance/connectionState/${c.instance_name}`);
    const state = String(st.data?.instance?.state ?? "").toLowerCase();
    if (state === "open") return c;
  }
  return null;
}

/**
 * Envia a mensagem da etapa via Evolution API e registra a message row
 * (status sent/failed) — mesma semântica do evolution-proxy.
 */
async function sendStepMessage(
  cadence: Cadence,
  step: CadenceStep,
  opp: Opportunity,
  contact: Contact,
): Promise<{ messageId: string | null; error: string | null }> {
  // Variáveis de interpolação: nome do contato e telefone.
  const vars = {
    contact: { name: contact.name ?? contact.push_name ?? "Cliente", phone: contact.phone },
    contact_name: contact.name ?? contact.push_name ?? "Cliente",
  };
  let text = "";
  if (step.message_text) {
    text = substituteVariables(step.message_text, vars);
  } else if (step.template_id) {
    const { data: tpl } = await supabase
      .from("message_templates")
      .select("body")
      .eq("id", step.template_id)
      .maybeSingle();
    text = substituteVariables(String(tpl?.body ?? ""), vars);
  }

  if (!text.trim()) return { messageId: null, error: "etapa sem template/texto configurado" };
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) return { messageId: null, error: "Evolution API não configurada" };

  const owner = await resolveInstance(opp, contact);
  if (!owner) return { messageId: null, error: "nenhuma instância WhatsApp conectada" };

  const sendTarget = resolveSendTarget(contact).target;
  if (!sendTarget) return { messageId: null, error: "contato sem identificador confiável para envio" };

  const sentAt = new Date().toISOString();
  const { ok, data, text: respText } = await callEvolution(`/message/sendText/${owner.instance_name}`, {
    number: sendTarget,
    text,
  });

  // Persiste a mensagem (upsert por evolution_message_id; falha registrada).
  const conversationId = await upsertConversation(supabase, contact.id, owner.instance_id);
  const { data: msgRow } = await supabase
    .from("messages")
    .upsert(
      {
        conversation_id: conversationId,
        evolution_message_id: data?.key?.id ?? null,
        direction: "outbound",
        sender_profile_id: null,
        type: "text",
        content: text,
        media_url: null,
        sent_at: sentAt,
        status: ok ? "sent" : "failed",
        send_error: ok ? null : respText.slice(0, 300),
      },
      { onConflict: "conversation_id, evolution_message_id" },
    )
    .select("id")
    .maybeSingle();

  void (async () => {
    const { error } = await supabase.rpc("bump_conversation", {
      p_id: conversationId,
      p_sent_at: sentAt,
      p_preview: text.slice(0, 140),
      p_inbound: false,
    });
    if (error) console.error("BUMP_CONVERSATION_FAILED", error.message);
  })();

  return { messageId: msgRow?.id ?? null, error: ok ? null : `evolution sendText failed: ${respText}` };
}

// ---------------------------------------------------------------------------
// 1) MATRÍCULA — oportunidade open no estágio gatilho
// ---------------------------------------------------------------------------

async function enroll(cadences: Cadence[]): Promise<{ enrolled: number }> {
  let enrolled = 0;

  for (const cadence of cadences) {
    if (cadence.steps.length === 0) continue;

    // Oportunidades no estágio gatilho, sem enrollment nesta cadência.
    const { data: candidates } = await supabase
      .from("opportunities")
      .select("id, assigned_to")
      .eq("pipeline_id", cadence.pipeline_id)
      .eq("stage_id", cadence.trigger_stage_id)
      .eq("status", "open");
    if (!candidates || candidates.length === 0) continue;

    for (const opp of candidates as Pick<Opportunity, "id" | "assigned_to">[]) {
      // Idempotência: uma oportunidade tem no máximo uma cadência ativa.
      const { count: anyEnrollment } = await supabase
        .from("cadence_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("opportunity_id", opp.id)
        .in("status", ["active", "paused"]);
      if ((anyEnrollment ?? 0) > 0) continue;

      const { error } = await supabase.from("cadence_enrollments").insert({
        cadence_id: cadence.id,
        opportunity_id: opp.id,
        assigned_to: opp.assigned_to,
        current_step: 0,
        status: "active",
        next_run_at: nextRunAt(cadence, cadence.steps[0]),
      });
      if (error) {
        if (error.code !== "23505") console.error("CADENCE_ENROLL_FAILED", opp.id, error.message);
        continue;
      }
      enrolled++;
    }
  }
  return { enrolled };
}

// ---------------------------------------------------------------------------
// 2) EXECUÇÃO — etapas vencidas (next_run_at <= now)
// ---------------------------------------------------------------------------

async function executeDues(cadences: Cadence[]): Promise<{ executed: number; failed: number }> {
  let executed = 0;
  let failed = 0;

  const cadenceById = new Map(cadences.map((c) => [c.id, c]));

  const { data: dues } = await supabase
    .from("cadence_enrollments")
    .select("*")
    .eq("status", "active")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at")
    .limit(50);
  if (!dues || dues.length === 0) return { executed, failed };

  for (const enr of dues as Enrollment[]) {
    try {
      const cadence = cadenceById.get(enr.cadence_id);
      // Cadência desativada/deletada: pausa (não cancela, admin pode reativar).
      if (!cadence || cadence.steps.length === 0) continue;

      const opp = await loadOpportunity(enr.opportunity_id);
      if (!opp || opp.status !== "open") {
        await supabase
          .from("cadence_enrollments")
          .update({ status: "cancelled", cancelled_at: new Date().toISOString(), next_run_at: null })
          .eq("id", enr.id);
        continue;
      }

      const step = cadence.steps[enr.current_step];
      if (!step) {
        // Sem etapa: completa e encerra.
        await supabase
          .from("cadence_enrollments")
          .update({ status: "completed", completed_at: new Date().toISOString(), next_run_at: null })
          .eq("id", enr.id);
        continue;
      }

      // Move a oportunidade para o estágio da etapa (grava histórico).
      let moveErr: { message: string } | null = null;
      if (opp.stage_id !== step.stage_id) {
        const res = await supabase.rpc("move_opportunity_stage", {
          p_opportunity_id: opp.id,
          p_new_stage_id: step.stage_id,
        });
        moveErr = res.error;
        if (moveErr) {
          failed++;
          await supabase.from("cadence_executions").insert({
            enrollment_id: enr.id, step_id: step.id, step_order: step.step_order,
            status: "failed", error: `move stage: ${moveErr.message}`,
          });
          continue;
        }
      }

      // Dispara mensagem da etapa (se configurada).
      let messageId: string | null = null;
      let sendError: string | null = null;
      if (step.send_message) {
        const contact = opp.contact_id ? await loadContact(opp.contact_id) : null;
        if (contact) {
          const sent = await sendStepMessage(cadence, step, opp, contact);
          messageId = sent.messageId;
          sendError = sent.error;
        } else {
          sendError = "contato não encontrado";
        }
      }

      // Avança: próxima etapa (delay dela) ou completa.
      const nextStep = cadence.steps[enr.current_step + 1];
      const updates: Partial<Enrollment> = { current_step: enr.current_step + 1 };
      if (nextStep) {
        updates.next_run_at = nextRunAt(cadence, nextStep);
      } else {
        updates.status = "completed";
        updates.completed_at = new Date().toISOString();
        updates.next_run_at = null;
      }
      const { error: updErr } = await supabase
        .from("cadence_enrollments")
        .update(updates)
        .eq("id", enr.id);

      await supabase.from("cadence_executions").insert({
        enrollment_id: enr.id,
        step_id: step.id,
        step_order: step.step_order,
        status: sendError ? (updErr || moveErr ? "failed" : "completed") : "completed",
        message_id: messageId,
        error: sendError ?? updErr?.message ?? null,
        details: { stageMoved: opp.stage_id !== step.stage_id, cadence: cadence.name },
      });

      if (sendError || updErr) failed++;
      else executed++;
    } catch (e) {
      failed++;
      console.error("CADENCE_EXECUTION_ERROR", enr.id, e);
    }
  }

  return { executed, failed };
}

// ---------------------------------------------------------------------------
// 3) SINCRONIZAÇÃO — movimentação manual encerrou a entrada expira ou cancelou
// ---------------------------------------------------------------------------

async function reconcile(cadences: Cadence[]): Promise<{ synced: number; cancelled: number }> {
  let synced = 0;
  let cancelled = 0;

  const cadenceById = new Map(cadences.map((c) => [c.id, c]));

  const { data: actives } = await supabase
    .from("cadence_enrollments")
    .select("*")
    .in("status", ["active", "paused"])
    .limit(500);
  if (!actives || actives.length === 0) return { synced, cancelled };

  for (const enr of actives as Enrollment[]) {
    try {
      const cadence = cadenceById.get(enr.cadence_id);
      if (!cadence) continue;

      const opp = await loadOpportunity(enr.opportunity_id);
      if (!opp || opp.status !== "open") {
        const { error } = await supabase
          .from("cadence_enrollments")
          .update({ status: "cancelled", cancelled_at: new Date().toISOString(), next_run_at: null })
          .eq("id", enr.id);
        if (!error) cancelled++;
        continue;
      }

      // Sincroniza etapa: card movido manualmente para o estágio de uma etapa
      // j > current_step → pula até j (sem re-envio das anteriores), entendo
      // que a movimentação manual já executou essa etapa.
      const stepIndexByStage = new Map(cadence.steps.map((s) => [s.stage_id, s.step_order]));
      const manualIndex = stepIndexByStage.get(opp.stage_id);
      if (manualIndex !== undefined && manualIndex > enr.current_step) {
        const nextStep = cadence.steps[manualIndex + 1];
        const { error } = await supabase
          .from("cadence_enrollments")
          .update({
            current_step: manualIndex + 1, // estágio já alcançado manualmente
            next_run_at: nextStep ? nextRunAt(cadence, nextStep) : null,
            ...(nextStep ? {} : { status: "completed", completed_at: new Date().toISOString() }),
          })
          .eq("id", enr.id);
        if (!error) {
          synced++;
          await supabase.from("cadence_executions").insert({
            enrollment_id: enr.id, step_order: manualIndex, status: "skipped",
            details: { reason: "manual_stage_move", stage: opp.stage_id },
          });
        }
      } else if (manualIndex === undefined && enr.current_step > 0) {
        // Movido manualmente para fora da sequência de estágios da cadência →
        // cancela (o vendedor assumiu o controle). A etapa 0 (estágio gatilho)
        // ainda não executou nada, então não cancela nesse caso.
        const { error } = await supabase
          .from("cadence_enrollments")
          .update({ status: "cancelled", cancelled_at: new Date().toISOString(), next_run_at: null })
          .eq("id", enr.id);
        if (!error) {
          cancelled++;
          await supabase.from("cadence_executions").insert({
            enrollment_id: enr.id, status: "skipped",
            details: { reason: "manual move out of cadence sequence" },
          });
        }
      }
    } catch (e) {
      console.error("CADENCE_RECONCILE_ERROR", enr.id, e);
    }
  }

  return { synced, cancelled };
}

// ---------------------------------------------------------------------------
// Fallback de matrícula via estágio gatilho (agendamento inicial)
// ---------------------------------------------------------------------------

async function firstSchedules(cadences: Cadence[]): Promise<{ scheduled: number }> {
  // Garante que enrollments ativos SEM next_run_at tenham a 1ª execução
  // agendada (recuperação de dados/manutenção).
  let scheduled = 0;
  const cadenceById = new Map(cadences.map((c) => [c.id, c]));

  const { data: orphans } = await supabase
    .from("cadence_enrollments")
    .select("id, cadence_id, current_step")
    .eq("status", "active")
    .is("next_run_at", null)
    .order("created_at")
    .limit(200);
  if (!orphans || orphans.length === 0) return { scheduled };

  for (const enr of orphans as Enrollment[]) {
    const cadence = cadenceById.get(enr.cadence_id);
    if (!cadence) continue;
    const step = cadence.steps[enr.current_step];
    if (!step) {
      await supabase
        .from("cadence_enrollments")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", enr.id);
      continue;
    }
    const { error } = await supabase
      .from("cadence_enrollments")
      .update({ next_run_at: nextRunAt(cadence, step) })
      .eq("id", enr.id);
    if (!error) scheduled++;
  }

  return { scheduled };
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

    const cadences = await loadCadences();
    if (cadences.length === 0) {
      return jsonResponse(200, { ok: true, cadences: 0 });
    }

    const enrolled = await enroll(cadences);
    const syncedRes = await reconcile(cadences);
    const scheduled = await firstSchedules(cadences);
    const executed = await executeDues(cadences);

    return jsonResponse(200, {
      ok: true,
      cadences: cadences.length,
      enrolled: enrolled.enrolled,
      synced: syncedRes.synced,
      cancelled: syncedRes.cancelled,
      scheduled: scheduled.scheduled,
      executed: executed.executed,
      failed: executed.failed,
    });
  } catch (err) {
    console.error("CADENCE_RUNNER_ERROR", err);
    return jsonResponse(500, { error: "internal error" });
  }
});
