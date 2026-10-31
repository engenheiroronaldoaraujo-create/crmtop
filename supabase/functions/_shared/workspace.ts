// _shared/workspace.ts — helpers multi-tenant para Edge Functions/runners.
// Evolution e IA seguem centralizados no dono; aqui só isolamento + quotas.

import type { Supabase } from "./contacts.ts";

export interface WorkspaceQuota {
  id: string;
  plan: string;
  status: string;
  max_instances: number;
  msg_mensal: number;
  ai_credits_mensal: number;
}

export async function listActiveWorkspaces(supabase: Supabase): Promise<WorkspaceQuota[]> {
  const { data } = await supabase
    .from("workspaces")
    .select("id, plan, status, max_instances, msg_mensal, ai_credits_mensal")
    .eq("status", "active");
  return (data ?? []) as WorkspaceQuota[];
}

function monthStart(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function monthlyUsage(
  supabase: Supabase,
  workspaceId: string,
): Promise<{ msgs: number; transcriptions: number; tokens: number }> {
  const { data } = await supabase
    .from("workspace_usage_daily")
    .select("msgs_in, msgs_out, transcricoes, ai_tokens")
    .eq("workspace_id", workspaceId)
    .gte("dia", monthStart());
  let msgs = 0;
  let transcriptions = 0;
  let tokens = 0;
  for (const r of (data ?? []) as Array<{ msgs_in: number; msgs_out: number; transcricoes: number; ai_tokens: number }>) {
    msgs += (r.msgs_in ?? 0) + (r.msgs_out ?? 0);
    transcriptions += r.transcricoes ?? 0;
    tokens += r.ai_tokens ?? 0;
  }
  return { msgs, transcriptions, tokens };
}

/** true quando o workspace estourou a quota mensal de mensagens. */
export async function isMsgQuotaExceeded(supabase: Supabase, workspaceId: string): Promise<boolean> {
  const { data: ws } = await supabase
    .from("workspaces")
    .select("msg_mensal, status")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!ws) return true;
  if ((ws as { status: string }).status !== "active") return true;
  const usage = await monthlyUsage(supabase, workspaceId);
  return usage.msgs >= ((ws as { msg_mensal: number }).msg_mensal ?? 5000);
}

/** true quando o workspace estourou os créditos de IA do mês. */
export async function isAiQuotaExceeded(supabase: Supabase, workspaceId: string): Promise<boolean> {
  const { data: ws } = await supabase
    .from("workspaces")
    .select("ai_credits_mensal, status")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!ws) return true;
  if ((ws as { status: string }).status !== "active") return true;
  const usage = await monthlyUsage(supabase, workspaceId);
  return usage.tokens >= ((ws as { ai_credits_mensal: number }).ai_credits_mensal ?? 10000);
}

export function bumpUsage(
  supabase: Supabase,
  workspaceId: string | null | undefined,
  patch: { p_in?: number; p_out?: number; p_transcricoes?: number; p_tokens?: number },
): void {
  if (!workspaceId) return;
  const dia = new Date().toISOString().slice(0, 10);
  supabase.rpc("bump_workspace_usage", {
    p_workspace_id: workspaceId,
    p_dia: dia,
    p_in: patch.p_in ?? 0,
    p_out: patch.p_out ?? 0,
    p_transcricoes: patch.p_transcricoes ?? 0,
    p_tokens: patch.p_tokens ?? 0,
  }).then(() => {}, () => {});
}
