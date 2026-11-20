// sdr-activation.ts — decisão de ativação automática do SDR para leads de
// anúncio/landing.
//
// O guard do sdr-engine continua exigindo `sdr_conversations.status='active'`.
// A única mudança é QUEM cria essa linha: antes só o humano (botão "SDR Ativo"
// no chat), agora também o webhook — desde que a origem esteja habilitada em
// allowed_sources e o humano ainda não tenha tomado uma decisão na conversa.

import type { Supabase } from "./contacts.ts";

export type ActivationDecision = "activate" | "preserve" | "skip";

export interface ActivationArgs {
  source: string | null;
  /** Rede do anúncio em source_meta (google | meta); null = legado sem rede. */
  network: string | null;
  enabled: boolean;
  testMode: boolean;
  allowedSources: string[] | null;
  allowedNetworks: string[] | null;
  existingStatus: string | null;
}

/** Decisão pura, sem I/O — testável. */
export function shouldAutoActivateSdr(args: ActivationArgs): ActivationDecision {
  if (!args.enabled || args.testMode) return "skip";
  // Autoativa em QUALQUER origem habilitada em allowed_sources. O opt-in
  // humano continua valendo para pausar: basta o humano digitar/assumir.
  if (!args.source) return "skip";
  if (args.allowedSources && !args.allowedSources.includes(args.source)) return "skip";
  if (args.source === "ad" && args.allowedNetworks) {
    // Conversa antiga sem `network` veio de Meta CTWA (único suporte na época).
    const network = args.network ?? "meta";
    if (!args.allowedNetworks.includes(network)) return "skip";
  }
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
    allowed_networks?: string[] | null;
  } | null,
): Promise<ActivationDecision> {
  const [
    { data: conv },
    { data: existing },
  ] = await Promise.all([
    supabase.from("conversations").select("source, source_meta").eq("id", conversationId).maybeSingle(),
    supabase.from("sdr_conversations").select("status").eq("conversation_id", conversationId).maybeSingle(),
  ]);
  const meta = ((conv as { source_meta?: unknown } | null)?.source_meta ?? {}) as Record<string, unknown>;

  const decision = shouldAutoActivateSdr({
    source: (conv as { source?: string | null } | null)?.source ?? null,
    network: (meta.network as string | null) ?? null,
    enabled: Boolean(settings?.enabled),
    testMode: Boolean(settings?.test_mode),
    allowedSources: Array.isArray(settings?.allowed_sources)
      ? settings!.allowed_sources as string[]
      : null,
    allowedNetworks: Array.isArray(settings?.allowed_networks)
      ? settings!.allowed_networks as string[]
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
