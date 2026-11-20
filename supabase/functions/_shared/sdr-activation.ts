// sdr-activation.ts — decisão de ativação automática do SDR para leads de
// anúncio/landing.
//
// O guard do sdr-engine continua exigindo `sdr_conversations.status='active'`.
// A única mudança é QUEM cria essa linha: antes só o humano (botão "SDR Ativo"
// no chat), agora também o webhook — mas somente para conversas de anúncio e
// somente se o humano ainda não tiver tomado uma decisão.

import type { Supabase } from "./contacts.ts";

export type ActivationDecision = "activate" | "preserve" | "skip";

export interface ActivationArgs {
  source: string | null;
  enabled: boolean;
  testMode: boolean;
  allowedSources: string[] | null;
  existingStatus: string | null;
}

/** Decisão pura, sem I/O — testável. */
export function shouldAutoActivateSdr(args: ActivationArgs): ActivationDecision {
  if (!args.enabled || args.testMode) return "skip";
  if (!args.source || !["ad", "landing"].includes(args.source)) return "skip";
  if (args.allowedSources && !args.allowedSources.includes(args.source)) return "skip";
  // Linha existente = humano (ou o próprio SDR) já decidiu. Nunca reativar
  // uma conversa pausada/transferida.
  if (args.existingStatus) return "preserve";
  return "activate";
}

/**
 * Aplica a decisão. A inserção é feita pela RPC `sdr_auto_activate` (migration
 * 073) com `ON CONFLICT DO NOTHING` para ser atômica mesmo com webhooks
 * concorrentes/reentregas.
 */
export async function maybeAutoActivateSdr(
  supabase: Supabase,
  conversationId: string,
  settings: {
    enabled?: boolean;
    test_mode?: boolean;
    allowed_sources?: string[] | null;
  } | null,
): Promise<ActivationDecision> {
  const [
    { data: conv },
    { data: existing },
  ] = await Promise.all([
    supabase.from("conversations").select("source").eq("id", conversationId).maybeSingle(),
    supabase.from("sdr_conversations").select("status").eq("conversation_id", conversationId).maybeSingle(),
  ]);

  const decision = shouldAutoActivateSdr({
    source: (conv as { source?: string | null } | null)?.source ?? null,
    enabled: Boolean(settings?.enabled),
    testMode: Boolean(settings?.test_mode),
    allowedSources: Array.isArray(settings?.allowed_sources)
      ? settings!.allowed_sources as string[]
      : null,
    existingStatus: (existing as { status?: string | null } | null)?.status ?? null,
  });

  if (decision !== "activate") return decision;

  const { error } = await supabase.rpc("sdr_auto_activate", { p_conversation_id: conversationId });
  if (error) {
    console.warn("SDR_AUTO_ACTIVATE_FAILED", String(error));
    return "skip";
  }
  console.info("SDR_AUTO_ACTIVATED", conversationId);
  return "activate";
}
