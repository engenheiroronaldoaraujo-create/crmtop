import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, type Supabase } from "../_shared/contacts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";

const MAX_EXECUTION_DEPTH = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AutomationRule {
  id: string;
  name: string;
  is_active: boolean;
  trigger_type: string;
  conditions: Condition[];
  condition_logic: "all" | "any";
  actions: Action[];
}

interface Condition {
  field: string;
  operator: string;
  value: unknown;
}

interface Action {
  type: string;
  params: Record<string, unknown>;
}

interface TriggerEvent {
  event_type: string;
  entity_type: string;
  entity_id: string;
  entity_data: Record<string, unknown>;
  source_event_id?: string;
}

// ---------------------------------------------------------------------------
// Variable substitution
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

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function evaluateCondition(condition: Condition, context: Record<string, unknown>): boolean {
  const fieldValue = getNestedValue(context, condition.field);
  const { operator, value } = condition;

  switch (operator) {
    case "equals": return fieldValue === value;
    case "not_equals": return fieldValue !== value;
    case "contains": return String(fieldValue).includes(String(value));
    case "not_contains": return !String(fieldValue).includes(String(value));
    case "in": return Array.isArray(value) && value.includes(fieldValue);
    case "not_in": return Array.isArray(value) && !value.includes(fieldValue);
    case "greater_than": return Number(fieldValue) > Number(value);
    case "less_than": return Number(fieldValue) < Number(value);
    case "greater_or_equal": return Number(fieldValue) >= Number(value);
    case "less_or_equal": return Number(fieldValue) <= Number(value);
    case "exists": return fieldValue != null && fieldValue !== undefined;
    case "not_exists": return fieldValue == null || fieldValue === undefined;
    default: return false;
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let val: unknown = obj;
  for (const p of parts) {
    if (val && typeof val === "object") val = (val as Record<string, unknown>)[p];
    else return undefined;
  }
  return val;
}

function evaluateConditions(conditions: Condition[], logic: string, context: Record<string, unknown>): boolean {
  if (conditions.length === 0) return true;
  if (logic === "all") return conditions.every((c) => evaluateCondition(c, context));
  return conditions.some((c) => evaluateCondition(c, context));
}

// ---------------------------------------------------------------------------
// Business hours check
// ---------------------------------------------------------------------------

async function isBusinessHours(supabase: Supabase, timezone: string = "America/Sao_Paulo"): Promise<boolean> {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const { data: hours } = await supabase
    .from("business_hours")
    .select("is_active, start_time, end_time")
    .eq("day_of_week", dayOfWeek)
    .single();

  if (!hours || !hours.is_active) return false;

  const localTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  return localTime >= hours.start_time && localTime <= hours.end_time;
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

async function executeAction(
  supabase: Supabase,
  action: Action,
  context: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    switch (action.type) {
      case "CREATE_OPPORTUNITY":
        return await actionCreateOpportunity(supabase, action.params, context);
      case "ASSIGN_OPPORTUNITY":
        return await actionAssignOpportunity(supabase, action.params, context);
      case "MOVE_OPPORTUNITY_STAGE":
        return await actionMoveStage(supabase, action.params, context);
      case "ADD_CONTACT_TAG":
        return await actionAddTag(supabase, action.params, context, "contact");
      case "REMOVE_CONTACT_TAG":
        return await actionRemoveTag(supabase, action.params, context, "contact");
      case "ADD_OPPORTUNITY_TAG":
        return await actionAddTag(supabase, action.params, context, "opportunity");
      case "REMOVE_OPPORTUNITY_TAG":
        return await actionRemoveTag(supabase, action.params, context, "opportunity");
      case "CREATE_TASK":
        return await actionCreateTask(supabase, action.params, context);
      case "CREATE_FOLLOWUP":
        return await actionCreateFollowup(supabase, action.params, context);
      case "CREATE_MEETING":
        return await actionCreateMeeting(supabase, action.params, context);
      case "UPDATE_OPPORTUNITY":
        return await actionUpdateOpportunity(supabase, action.params, context);
      case "CREATE_ACTIVITY_LOG":
        return await actionCreateActivityLog(supabase, action.params, context);
      case "NOTIFY_USER":
        return await actionNotifyUser(supabase, action.params, context);
      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function actionCreateOpportunity(
  supabase: Supabase,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const contact = context.contact as Record<string, unknown> | undefined;
  if (!contact?.id) return { success: false, error: "No contact" };

  // Check if contact already has open opportunity
  const { data: existing } = await supabase
    .from("opportunities")
    .select("id")
    .eq("contact_id", contact.id)
    .eq("status", "open")
    .limit(1);
  if (existing && existing.length > 0) return { success: false, error: "Contact already has open opportunity" };

  // Resolve pipeline
  const pipelineName = substituteVariables(String(params.pipeline ?? "Vendas"), context);
  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("id")
    .eq("name", pipelineName)
    .eq("is_active", true)
    .single();
  if (!pipeline) return { success: false, error: `Pipeline "${pipelineName}" not found` };

  // Resolve stage
  const stageName = substituteVariables(String(params.stage ?? "Novo"), context);
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipeline.id)
    .eq("name", stageName)
    .eq("is_active", true)
    .single();
  if (!stage) return { success: false, error: `Stage "${stageName}" not found` };

  const title = substituteVariables(String(params.title ?? "Oportunidade"), context);

  const { data: opp, error } = await supabase
    .from("opportunities")
    .insert({
      contact_id: contact.id,
      pipeline_id: pipeline.id,
      stage_id: stage.id,
      title,
      assigned_to: params.assigned_to ?? null,
      created_by: params.created_by ?? null,
      conversation_id: context.conversation_id ?? null,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, result: opp };
}

async function actionAssignOpportunity(
  supabase: Supabase,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const opp = context.opportunity as Record<string, unknown> | undefined;
  if (!opp?.id) return { success: false, error: "No opportunity" };

  const strategy = params.strategy as string;
  let assigneeId: string | null = null;

  if (strategy === "round_robin") {
    // Get all vendedores
    const { data: sellers } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "vendedor");
    if (!sellers || sellers.length === 0) return { success: false, error: "No sellers" };

    // Get last assigned seller
    const { data: lastAssigned } = await supabase
      .from("opportunities")
      .select("assigned_to")
      .not("assigned_to", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1);
    const lastId = lastAssigned?.[0]?.assigned_to;

    // Round robin
    const lastIdx = sellers.findIndex((s) => s.id === lastId);
    const nextIdx = (lastIdx + 1) % sellers.length;
    assigneeId = sellers[nextIdx].id;
  } else if (strategy === "specific" && params.user_id) {
    assigneeId = params.user_id as string;
  } else if (strategy === "current_user" && context.user_id) {
    assigneeId = context.user_id as string;
  }

  if (!assigneeId) return { success: false, error: "Could not determine assignee" };

  const { error } = await supabase
    .from("opportunities")
    .update({ assigned_to: assigneeId })
    .eq("id", opp.id);

  if (error) return { success: false, error: error.message };
  return { success: true, result: { assigned_to: assigneeId } };
}

async function actionMoveStage(
  supabase: Supabase,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const opp = context.opportunity as Record<string, unknown> | undefined;
  if (!opp?.id) return { success: false, error: "No opportunity" };

  const stageName = substituteVariables(String(params.stage ?? ""), context);
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", opp.pipeline_id)
    .eq("name", stageName)
    .eq("is_active", true)
    .single();
  if (!stage) return { success: false, error: `Stage "${stageName}" not found` };

  const { error } = await supabase
    .from("opportunities")
    .update({ stage_id: stage.id })
    .eq("id", opp.id);

  if (error) return { success: false, error: error.message };
  return { success: true, result: { stage_id: stage.id } };
}

async function actionAddTag(
  supabase: Supabase,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
  entityType: "contact" | "opportunity",
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const entity = context[entityType] as Record<string, unknown> | undefined;
  if (!entity?.id) return { success: false, error: `No ${entityType}` };

  const tagName = substituteVariables(String(params.tag ?? ""), context);
  const { data: tag } = await supabase
    .from("tags")
    .select("id")
    .eq("name", tagName)
    .single();
  if (!tag) return { success: false, error: `Tag "${tagName}" not found` };

  const table = entityType === "contact" ? "contact_tags" : "opportunity_tags";
  const idField = entityType === "contact" ? "contact_id" : "opportunity_id";

  const { error } = await supabase
    .from(table)
    .insert({ [idField]: entity.id, tag_id: tag.id });

  if (error && error.code !== "23505") return { success: false, error: error.message };
  return { success: true };
}

async function actionRemoveTag(
  supabase: Supabase,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
  entityType: "contact" | "opportunity",
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const entity = context[entityType] as Record<string, unknown> | undefined;
  if (!entity?.id) return { success: false, error: `No ${entityType}` };

  const tagName = substituteVariables(String(params.tag ?? ""), context);
  const { data: tag } = await supabase
    .from("tags")
    .select("id")
    .eq("name", tagName)
    .single();
  if (!tag) return { success: false, error: `Tag "${tagName}" not found` };

  const table = entityType === "contact" ? "contact_tags" : "opportunity_tags";
  const idField = entityType === "contact" ? "contact_id" : "opportunity_id";

  const { error } = await supabase
    .from(table)
    .delete()
    .eq(idField, entity.id)
    .eq("tag_id", tag.id);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

async function actionCreateTask(
  supabase: Supabase,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const opp = context.opportunity as Record<string, unknown> | undefined;
  const contact = context.contact as Record<string, unknown> | undefined;

  const title = substituteVariables(String(params.title ?? "Tarefa automática"), context);
  const delayDays = Number(params.delay_days ?? 0);
  const dueAt = delayDays > 0
    ? new Date(Date.now() + delayDays * 86400000).toISOString()
    : null;

  const { data, error } = await supabase
    .from("opportunity_tasks")
    .insert({
      opportunity_id: opp?.id ?? null,
      contact_id: contact?.id ?? null,
      assigned_to: params.assigned_to ?? opp?.assigned_to ?? null,
      title,
      description: params.description ? substituteVariables(String(params.description), context) : null,
      task_type: "task",
      due_at: dueAt,
      priority: params.priority ?? "normal",
      created_by: params.created_by ?? null,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, result: data };
}

async function actionCreateFollowup(
  supabase: Supabase,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const opp = context.opportunity as Record<string, unknown> | undefined;
  const contact = context.contact as Record<string, unknown> | undefined;

  const title = substituteVariables(String(params.title ?? "Follow-up"), context);
  const delayDays = Number(params.delay_days ?? 0);
  const dueAt = delayDays > 0
    ? new Date(Date.now() + delayDays * 86400000).toISOString()
    : null;

  const { data, error } = await supabase
    .from("opportunity_tasks")
    .insert({
      opportunity_id: opp?.id ?? null,
      contact_id: contact?.id ?? null,
      assigned_to: params.assigned_to ?? opp?.assigned_to ?? null,
      title,
      description: params.description ? substituteVariables(String(params.description), context) : null,
      task_type: "follow_up",
      due_at: dueAt,
      priority: params.priority ?? "normal",
      created_by: params.created_by ?? null,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, result: data };
}

async function actionCreateMeeting(
  supabase: Supabase,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const opp = context.opportunity as Record<string, unknown> | undefined;
  const contact = context.contact as Record<string, unknown> | undefined;

  const title = substituteVariables(String(params.title ?? "Reunião"), context);
  const delayDays = Number(params.delay_days ?? 1);
  const startAt = new Date(Date.now() + delayDays * 86400000);
  startAt.setHours(10, 0, 0, 0);
  const endAt = new Date(startAt.getTime() + 30 * 60000);

  const { data, error } = await supabase
    .from("meetings")
    .insert({
      opportunity_id: opp?.id ?? null,
      contact_id: contact?.id ?? null,
      assigned_to: params.assigned_to ?? opp?.assigned_to ?? null,
      title,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      created_by: params.created_by ?? null,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, result: data };
}

async function actionUpdateOpportunity(
  supabase: Supabase,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const opp = context.opportunity as Record<string, unknown> | undefined;
  if (!opp?.id) return { success: false, error: "No opportunity" };

  const updates: Record<string, unknown> = {};
  if (params.title) updates.title = substituteVariables(String(params.title), context);
  if (params.value) updates.value = Number(params.value);
  if (params.description) updates.description = substituteVariables(String(params.description), context);

  if (Object.keys(updates).length === 0) return { success: false, error: "No fields to update" };

  const { error } = await supabase
    .from("opportunities")
    .update(updates)
    .eq("id", opp.id);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

async function actionCreateActivityLog(
  supabase: Supabase,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const opp = context.opportunity as Record<string, unknown> | undefined;

  const { error } = await supabase
    .from("activity_log")
    .insert({
      entity_type: params.entity_type ?? "opportunity",
      entity_id: opp?.id ?? context.entity_id ?? null,
      action: substituteVariables(String(params.action ?? "AUTOMATION"), context),
      actor_id: params.actor_id ?? null,
      new_data: params.data ?? null,
    });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

async function actionNotifyUser(
  supabase: Supabase,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  // Store notification in activity_log for now
  const opp = context.opportunity as Record<string, unknown> | undefined;
  const message = substituteVariables(String(params.message ?? "Notificação"), context);

  const { error } = await supabase
    .from("activity_log")
    .insert({
      entity_type: "notification",
      entity_id: opp?.id ?? null,
      action: `NOTIFY: ${message}`,
      actor_id: params.user_id ?? null,
    });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export async function processTrigger(
  supabase: Supabase,
  event: TriggerEvent,
  userId?: string,
): Promise<void> {
  // Load active rules for this trigger
  const { data: rules } = await supabase
    .from("automation_rules")
    .select("*")
    .eq("is_active", true)
    .eq("trigger_type", event.event_type);

  if (!rules || rules.length === 0) return;

  for (const rule of rules) {
    await processRule(supabase, rule as AutomationRule, event, userId);
  }
}

async function processRule(
  supabase: Supabase,
  rule: AutomationRule,
  event: TriggerEvent,
  userId?: string,
  depth: number = 0,
): Promise<void> {
  if (depth >= MAX_EXECUTION_DEPTH) {
    console.error("AUTOMATION_MAX_DEPTH", rule.id);
    return;
  }

  // Create execution log
  const { data: execution } = await supabase
    .from("automation_executions")
    .insert({
      automation_id: rule.id,
      trigger_event: event.event_type,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      entity_data: event.entity_data,
      status: "running",
    })
    .select()
    .single();

  if (!execution) return;

  const actionsLog: Array<{ type: string; status: string; error?: string }> = [];

  try {
    // Build context
    const context: Record<string, unknown> = {
      ...event.entity_data,
      user_id: userId,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
    };

    // Load related entities
    if (event.entity_type === "contact" && event.entity_id) {
      const { data: contact } = await supabase.from("contacts").select("*").eq("id", event.entity_id).single();
      if (contact) {
        context.contact = contact;
        // Check has_open_opportunity
        const { data: opps } = await supabase
          .from("opportunities")
          .select("id")
          .eq("contact_id", contact.id)
          .eq("status", "open");
        context.has_open_opportunity = opps && opps.length > 0;
      }
    }

    if (event.entity_type === "opportunity" && event.entity_id) {
      const { data: opp } = await supabase.from("opportunities").select("*").eq("id", event.entity_id).single();
      if (opp) {
        context.opportunity = opp;
        // Load contact
        const { data: contact } = await supabase.from("contacts").select("*").eq("id", opp.contact_id).single();
        if (contact) context.contact = contact;
      }
    }

    if (event.entity_type === "conversation" && event.entity_id) {
      const { data: conv } = await supabase.from("conversations").select("*").eq("id", event.entity_id).single();
      if (conv) {
        context.conversation = conv;
        context.conversation_id = conv.id;
        const { data: contact } = await supabase.from("contacts").select("*").eq("id", conv.contact_id).single();
        if (contact) context.contact = contact;
      }
    }

    // Check business hours for MESSAGE_RECEIVED
    if (event.event_type === "MESSAGE_RECEIVED" || event.event_type === "FIRST_MESSAGE_RECEIVED") {
      context.outside_business_hours = !(await isBusinessHours(supabase));
    }

    // Evaluate conditions
    const conditionsMet = evaluateConditions(rule.conditions, rule.condition_logic, context);
    if (!conditionsMet) {
      await supabase
        .from("automation_executions")
        .update({ status: "skipped", finished_at: new Date().toISOString() })
        .eq("id", execution.id);
      return;
    }

    // Execute actions
    for (const action of rule.actions) {
      const result = await executeAction(supabase, action, context);
      actionsLog.push({ type: action.type, status: result.success ? "completed" : "failed", error: result.error });

      if (!result.success) {
        console.error("AUTOMATION_ACTION_FAILED", rule.id, action.type, result.error);
      }
    }

    // Update execution
    await supabase
      .from("automation_executions")
      .update({
        status: "completed",
        actions_log: actionsLog,
        finished_at: new Date().toISOString(),
      })
      .eq("id", execution.id);

  } catch (e) {
    await supabase
      .from("automation_executions")
      .update({
        status: "failed",
        error: String(e),
        actions_log: actionsLog,
        finished_at: new Date().toISOString(),
      })
      .eq("id", execution.id);
  }
}

// ---------------------------------------------------------------------------
// Edge Function entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!WEBHOOK_SECRET) {
    return jsonResponse(500, { error: "webhook secret not configured" });
  }

  try {
    const url = new URL(req.url);
    if (url.searchParams.get("token") !== WEBHOOK_SECRET) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    const payload = await req.json();
    const event = payload.event as string;
    const data = payload.data as Record<string, unknown>;
    const instanceName = payload.instance as string;

    const supabase = serviceClient();

    // Chamado pelo evolution-webhook com payload estruturado (a mensagem já
    // foi persistida quando a função é invocada).
    const conversationId = String(data?.conversation_id ?? "");
    if (!conversationId) {
      return jsonResponse(200, { ok: true, skipped: "no conversation in payload", event });
    }

    let contactId = (data?.contact_id as string) ?? null;
    if (!contactId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("contact_id")
        .eq("id", conversationId)
        .maybeSingle();
      contactId = conv?.contact_id ?? null;
    }

    // FIRST_MESSAGE_RECEIVED quando é o 1º inbound da conversa (esta já conta).
    let eventType = "MESSAGE_RECEIVED";
    const { count: inboundCount } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound");
    if ((inboundCount ?? 0) <= 1) eventType = "FIRST_MESSAGE_RECEIVED";

    const triggerEvent: TriggerEvent = {
      event_type: eventType,
      entity_type: "conversation",
      entity_id: conversationId,
      entity_data: {
        instance_name: instanceName,
        conversation_id: conversationId,
        contact_id: contactId,
        text: data?.text ?? "",
        media_type: data?.media_type ?? "text",
      },
    };

    await processTrigger(supabase, triggerEvent);

    return jsonResponse(200, { ok: true, event });
  } catch (err) {
    console.error("AUTOMATION_ENGINE_ERROR", err);
    return jsonResponse(500, { error: "internal error" });
  }
});
