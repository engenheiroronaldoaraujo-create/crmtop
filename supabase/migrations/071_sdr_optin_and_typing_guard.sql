-- 071_sdr_optin_and_typing_guard.sql
--
-- Regra: SDR IA nunca entra sozinho na conversa.
-- Só responde quando o humano ATIVOU explicitamente (sdr_conversations.status = 'active').
--
-- 1. `set_sdr_pause(p_paused=false)` fazia só UPDATE: se a conversa nunca
--    teve linha em `sdr_conversations` (caso padrão agora), ativar não criava
--    nada e o SDR continuava desligado. Vira UPSERT para 'active'.
-- 2. `set_sdr_pause(p_paused=true)` mantém o UPSERT para 'paused_human'.

create or replace function public.set_sdr_pause(p_conversation_id uuid, p_paused boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact_id uuid;
begin
  select c.contact_id into v_contact_id
    from public.conversations c
   where c.id = p_conversation_id;

  if v_contact_id is null then
    raise exception 'conversation % not found', p_conversation_id;
  end if;

  if p_paused then
    insert into public.sdr_conversations (conversation_id, contact_id, status)
    values (p_conversation_id, v_contact_id, 'paused_human')
    on conflict (conversation_id) do update
      set status = 'paused_human';
  else
    insert into public.sdr_conversations (conversation_id, contact_id, status)
    values (p_conversation_id, v_contact_id, 'active')
    on conflict (conversation_id) do update
      set status = 'active';
  end if;
end $$;

revoke execute on function public.set_sdr_pause(uuid, boolean) from public;
grant execute on function public.set_sdr_pause(uuid, boolean) to authenticated, service_role;
