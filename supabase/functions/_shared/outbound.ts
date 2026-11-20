// _shared/outbound.ts
//
// Caminho ÚNICO de escrita de mensagem outbound.
//
// Antes havia 6 implementações e cada uma decidia sozinha se chamava
// `bump_conversation` e como tratava `evolution_message_id` NULL (cada retry
// de envio criava uma bolha duplicada). Tudo que envia mensagem passa por aqui.

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
export function normalizeEvolutionMessageId(
  id: string | null | undefined,
): string {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return `failed-${crypto.randomUUID()}`;
  return trimmed;
}

/**
 * Grava a mensagem outbound e atualiza o preview da conversa.
 */
export async function recordOutboundMessage(
  supabase: Supabase,
  input: OutboundInput,
  status: MessageStatus = "sent",
): Promise<OutboundResult> {
  const evolutionMessageId = normalizeEvolutionMessageId(
    input.evolutionMessageId,
  );

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

  await sideEffects(supabase, input, status);

  return { messageId: msgRow?.id ?? null, error: null };
}

/**
 * Efeito colateral de um envio: preview da conversa. Isolado para que falhas
 * não derrubem o envio (o eco do webhook refaz o bump se o isolate congelar).
 */
export async function sideEffects(
  supabase: Supabase,
  input: Pick<OutboundInput, "conversationId" | "content" | "type" | "sentAt">,
  _status: MessageStatus,
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
}
