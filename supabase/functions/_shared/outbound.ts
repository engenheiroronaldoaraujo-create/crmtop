// _shared/outbound.ts
//
// Caminho ÚNICO de escrita de mensagem outbound.
//
// Antes havia 6 implementações (evolution-proxy, evolution-webhook no SDR,
// cadence-runner, noreply-runner, group-dm-runner e o proxy de mídia), e cada
// uma decidia sozinha:
//   - se chamava `bump_conversation` (só o proxy e o SDR não);
//   - se chamava `noreply_touch` (só o proxy chamava) → a cadência e a DM de
//     grupo falavam com o lead e a régua de follow-up não reposicionava,
//     disparando um follow-up automático logo depois;
//   - como tratava `evolution_message_id` NULL (só o proxy normalizava) →
//     cada retry de envio criava uma bolha duplicada.
//
// Tudo que envia mensagem passa por aqui agora.

import type { Supabase } from "./contacts.ts";

export type MessageStatus = "sent" | "failed";

export interface OutboundInput {
  conversationId: string;
  evolutionMessageId: string | null;
  type: string;
  content: string | null;
  mediaUrl?: string | null;
  senderProfileId?: string | null;
  sentAt: string;
  sendError?: string | null;
}

export interface OutboundResult {
  messageId: string | null;
  error: string | null;
}

/**
 * Normaliza o id da Evolution para um valor nunca-NULL.
 *
 * Postgres trata NULL como distinto (NULL != NULL): um upsert por
 * (conversation_id, evolution_message_id) com NULL nunca faz dedup e cada
 * retry de envio cria uma linha duplicada no chat. Falhas usam um id único
 * por tentativa (`failed-<uuid>`) — assim o retry é rastreável e não colide.
 */
export function normalizeEvolutionMessageId(id: string | null | undefined): string {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return `failed-${crypto.randomUUID()}`;
  return trimmed;
}

/**
 * Grava a mensagem outbound, atualiza o preview da conversa e reposiciona a
 * régua de follow-up sem resposta.
 *
 * `touchNoreply` só vale para mensagens que realmente chegaram ao lead
 * (status "sent"): falha de envio não toca a régua.
 */
export async function recordOutboundMessage(
  supabase: Supabase,
  input: OutboundInput,
  status: MessageStatus = "sent",
  opts: { touchNoreply?: boolean } = {},
): Promise<OutboundResult> {
  const evolutionMessageId = normalizeEvolutionMessageId(input.evolutionMessageId);

  const { data: msgRow, error } = await supabase
    .from("messages")
    .upsert(
      {
        conversation_id: input.conversationId,
        evolution_message_id: evolutionMessageId,
        direction: "outbound",
        sender_profile_id: input.senderProfileId ?? null,
        type: input.type,
        content: input.content,
        media_url: input.mediaUrl ?? null,
        sent_at: input.sentAt,
        status,
        send_error: input.sendError ?? null,
      },
      { onConflict: "conversation_id, evolution_message_id" },
    )
    .select("id")
    .maybeSingle();

  if (error) return { messageId: null, error: error.message };

  await sideEffects(supabase, input, status, opts.touchNoreply ?? true);

  return { messageId: msgRow?.id ?? null, error: null };
}

/**
 * Efeitos colaterais de um envio: preview da conversa + relógio da régua de
 * follow-up. Isolados para que falhas não derrubem o envio (o eco do webhook
 * refaz o bump se o isolate congelar).
 */
export async function sideEffects(
  supabase: Supabase,
  input: Pick<OutboundInput, "conversationId" | "content" | "type" | "sentAt">,
  status: MessageStatus,
  touchNoreply: boolean,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("bump_conversation", {
      p_id: input.conversationId,
      p_sent_at: input.sentAt,
      p_preview: (input.content ?? `[${input.type}]`).slice(0, 140),
      p_inbound: false,
    });
    if (error) console.error("BUMP_CONVERSATION_FAILED", error.message);
  } catch (e) {
    console.error("BUMP_CONVERSATION_FAILED", String(e));
  }

  if (!touchNoreply || status !== "sent") return;

  try {
    const { error } = await supabase.rpc("noreply_touch", {
      p_conversation_id: input.conversationId,
      p_sent_at: input.sentAt,
    });
    if (error) console.error("NOREPLY_TOUCH_FAILED", error.message);
  } catch (e) {
    console.error("NOREPLY_TOUCH_FAILED", String(e));
  }
}
