-- 077_sdr_auto_activate_any_source.sql
-- A decisao de quais origens autoativam vive no codigo
-- (_shared/sdr-activation.ts, via allowed_sources/allowed_networks).
-- A RPC 073 travava 'ad'/'landing' no banco, bloqueando organica/manual
-- mesmo quando habilitadas no painel. Remove a restricao de origem:
-- a RPC apenas cria a linha 'active' se ainda nao existir decisao humana.

create or replace function public.sdr_auto_activate(p_conversation_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact_id uuid;
  v_rows int;
begin
  select c.contact_id
    into v_contact_id
    from public.conversations c
   where c.id = p_conversation_id;

  if v_contact_id is null then
    return 'no_conversation';
  end if;

  insert into public.sdr_conversations (conversation_id, contact_id, status)
  values (p_conversation_id, v_contact_id, 'active')
  on conflict (conversation_id) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    return 'activated';
  end if;
  return 'existing_preserved';
end $$;

revoke execute on function public.sdr_auto_activate(uuid) from public;
grant execute on function public.sdr_auto_activate(uuid) to service_role;
