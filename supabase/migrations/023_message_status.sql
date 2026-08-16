-- 023_message_status.sql
-- Status da mensagem: pending → sent → delivered → read (ou failed).
-- A Evolution reporta via eventos `messages.update` com códigos Baileys:
--   0 ERROR         -> failed
--   1 PENDING       -> pending
--   2 SERVER_ACK    -> sent
--   3 DELIVERY_ACK  -> delivered
--   4 READ          -> read
--   5 PLAYED        -> read (melhor esforço)
--
-- Linhas já existentes viram 'sent' (estado assumido pela F1 atual). Novas
-- mensagens nascem 'pending' e só são marcadas 'sent' após confirmação do envio
-- (regra: nunca registrar como enviada antes da confirmação da API).

alter table public.messages
  add column if not exists status text not null default 'sent'
    check (status in ('pending', 'sent', 'delivered', 'read', 'failed'));

alter table public.messages
  alter column status set default 'pending';

-- RPC usada pelo webhook (service role) para atualizar o status de uma
-- mensagem outbound a partir do id da Evolution. Restringe a `direction =
-- 'outbound'` para nunca rebaixar/alterar mensagens recebidas.
create or replace function public.update_message_status(
  p_conversation_id uuid,
  p_evolution_message_id text,
  p_status text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.messages
  set status = p_status
  where conversation_id = p_conversation_id
    and evolution_message_id = p_evolution_message_id
    and direction = 'outbound';
$$;

-- Sem grant a authenticated: somente o webhook (service role) atualiza status.