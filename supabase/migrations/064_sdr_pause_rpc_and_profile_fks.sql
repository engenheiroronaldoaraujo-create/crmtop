-- 064_sdr_pause_rpc_and_profile_fks.sql
--
-- 1. RPC `set_sdr_pause`.
--
--    O Chat pausa/retoma o SDR na conversa com um `upsert` em
--    `sdr_conversations`. Depois da migration 061, `authenticated` só tem
--    UPDATE/INSERT **por coluna** — e o `ON CONFLICT DO UPDATE` do upsert
--    exige privilégio de UPDATE **de tabela**, não por coluna. O botão
--    "Pausar SDR" passou a responder 403.
--
--    A solução é um RPC SECURITY DEFINER: ele roda como dono (postgres),
--    ignora RLS e os grants por coluna, e ainda restringe o que o cliente
--    pode pedir (só pausar/retomar — nada de mexer no contador da IA).
--
--  2. FKs para `profiles` com ON DELETE SET NULL.
--
--    `profiles.id` referencia `auth.users(id)` com ON DELETE CASCADE: apagar
--    o usuário no Auth cascateia para o profile e falhava com violação de FK
--    se o vendedor estivesse responsável por alguma conversa/card. Isso
--    travava a exclusão de usuários no painel de admin.
--
--    O nome automático da constraint é `<tabela>_<coluna>_fkey`, mas o
--    `drop constraint if exists` abaixo não depende do nome: o bloco DO
--    remove TODA a FK da coluna que referencia profiles e recria a única
--    com a semântica desejada (sem FK duplicada).

-- ---------------------------------------------------------------------------
-- 1. set_sdr_pause
-- ---------------------------------------------------------------------------

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
    update public.sdr_conversations
       set status = 'active'
     where conversation_id = p_conversation_id;
  end if;
end $$;

revoke execute on function public.set_sdr_pause(uuid, boolean) from public;
grant execute on function public.set_sdr_pause(uuid, boolean) to authenticated, service_role;

-- Com o RPC em place, o cliente não precisa mais escrever direto em
-- `sdr_conversations`: o INSERT por coluna é retirado (o `ON CONFLICT DO
-- UPDATE` exigia UPDATE de tabela) e o UPDATE fica só na coluna `status`,
-- que é o que o Chat precisa. `auto_messages_count` (o limite da IA) fica
-- fora do alcance do vendedor.
revoke insert on public.sdr_conversations from authenticated;
revoke update on public.sdr_conversations from authenticated;
grant update (status) on public.sdr_conversations to authenticated;

-- ---------------------------------------------------------------------------
-- 2. FKs de profiles com ON DELETE SET NULL
-- ---------------------------------------------------------------------------

-- Helper: recria a FK de uma coluna para profiles com ON DELETE SET NULL,
-- removendo qualquer FK anterior da MESMA coluna (não depende do nome).
create or replace function public._relax_profile_fk(p_table text, p_column text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_attnum smallint;
begin
  -- Guarda: coluna (ou tabela) inexistente = nada a fazer (não falha a
  -- migration).
  select att.attnum into v_attnum
    from pg_attribute att
    join pg_class rel on rel.oid = att.attrelid
    join pg_namespace n on n.oid = rel.relnamespace
   where n.nspname = 'public'
     and rel.relname = p_table
     and att.attname = p_column
     and not att.attisdropped;

  if v_attnum is null then
    return;
  end if;

  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname = p_table
      and con.contype = 'f'
      and con.confrelid = 'public.profiles'::regclass
      and con.conkey = ARRAY[v_attnum]::smallint[]
  loop
    execute format('alter table public.%I drop constraint %I', p_table, r.conname);
  end loop;

  execute format(
    'alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) on delete set null',
    p_table, p_table || '_' || p_column || '_fkey', p_column
  );
end $$;

select public._relax_profile_fk('conversations', 'assigned_to');
select public._relax_profile_fk('opportunities', 'assigned_to');
select public._relax_profile_fk('opportunities', 'created_by');
select public._relax_profile_fk('opportunity_tasks', 'assigned_to');
select public._relax_profile_fk('opportunity_tasks', 'created_by');
select public._relax_profile_fk('meetings', 'assigned_to');
select public._relax_profile_fk('meetings', 'created_by');
select public._relax_profile_fk('cadence_enrollments', 'assigned_to');
select public._relax_profile_fk('activity_log', 'actor_id');
select public._relax_profile_fk('opportunity_stage_history', 'changed_by');
select public._relax_profile_fk('automation_rules', 'created_by');
select public._relax_profile_fk('message_templates', 'created_by');
select public._relax_profile_fk('cadences', 'created_by');
select public._relax_profile_fk('tags', 'created_by');
select public._relax_profile_fk('group_posts', 'created_by');

drop function if exists public._relax_profile_fk(text, text);
