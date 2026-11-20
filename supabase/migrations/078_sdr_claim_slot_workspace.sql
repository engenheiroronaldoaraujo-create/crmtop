-- 078_sdr_claim_slot_workspace.sql
-- Corrige três problemas do `sdr_try_claim_slot` (062):
--  1. `max(max_messages_per_conversation)` global: com vários workspaces, o
--     limite de um valia para todos. Agora resolve o limite do workspace da
--     conversa (override explícito continua possível via p_max_override);
--  2. cooldown não era atômico: duas mensagens simultâneas passavam no
--     check-then-act e geravam resposta dupla. O claim agora também barra
--     dentro do cooldown (retorno 'cooldown'), com a mesma transação;
--  3. retorno boolean não distinguia limite de cooldown — e cooldown NÃO pode
--     pausar a conversa (paused_limit), só pular a resposta.
--
-- Retorno: 'ok' | 'limit' | 'cooldown'. Chamador decide: 'limit' → pausa a
-- conversa; 'cooldown' → apenas pula esta mensagem.

create or replace function public.sdr_try_claim_slot(
  p_conversation_id uuid,
  p_cooldown_seconds int default null,
  p_max_override int default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max   int;
  v_cool  int;
  v_count int;
  v_last  timestamptz;
begin
  -- Limite do workspace da conversa; legado sem workspace cai no global.
  select s.max_messages_per_conversation, s.cooldown_seconds
    into v_max, v_cool
    from public.sdr_settings s
    join public.conversations c on c.workspace_id = s.workspace_id
   where c.id = p_conversation_id
   order by s.created_at desc
   limit 1;

  if v_max is null then
    select coalesce(max(max_messages_per_conversation), 10)
      into v_max
      from public.sdr_settings;
  end if;
  if v_cool is null then
    select coalesce(max(cooldown_seconds), 5)
      into v_cool
      from public.sdr_settings;
  end if;

  v_max := coalesce(p_max_override, v_max, 10);
  v_cool := coalesce(p_cooldown_seconds, v_cool, 5);

  select auto_messages_count, last_auto_reply_at
    into v_count, v_last
    from public.sdr_conversations
   where conversation_id = p_conversation_id
   for update;

  if v_count is null then
    insert into public.sdr_conversations (conversation_id, auto_messages_count, last_auto_reply_at)
    values (p_conversation_id, 1, now())
    on conflict (conversation_id) do nothing;
    return 'ok';
  end if;

  if v_count >= v_max then
    return 'limit';
  end if;

  if v_last is not null and extract(epoch from (now() - v_last)) < v_cool then
    return 'cooldown';
  end if;

  update public.sdr_conversations
     set auto_messages_count = v_count + 1,
         last_auto_reply_at = now()
   where conversation_id = p_conversation_id;

  return 'ok';
end $$;

revoke execute on function public.sdr_try_claim_slot(uuid, int, int) from public;
grant execute on function public.sdr_try_claim_slot(uuid, int, int) to service_role;
