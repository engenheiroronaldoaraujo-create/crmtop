-- 066_group_dm_updated_at.sql
--
-- `group_post_engagements` não tinha `updated_at` — só `created_at` e
-- `commented_at`. Duas consequências:
--
--   1. O reaper de DMs presas em 'sending' (migration 062) referenciava uma
--      coluna inexistente: a função era criada sem erro (PL/pgSQL valida o
--      corpo só em runtime) e EXPLODIA na primeira execução com
--      "42703: Perhaps you meant to reference the column
--      group_post_engagements.created_at".
--
--   2. Sem timestamp de claim, não havia como saber há quanto tempo a linha
--      está em 'sending' — o reaper não teria como decidir o que é órfão.
--
-- A correção: coluna `updated_at` com trigger (padrão do resto do schema) e
-- o `claim_group_dms` passando a marcar o momento do claim. Aí o reaper
-- recupera a linha que ficou presa.

alter table public.group_post_engagements
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists group_post_engagements_set_updated_at
  on public.group_post_engagements;
create trigger group_post_engagements_set_updated_at
  before update on public.group_post_engagements
  for each row execute function public.set_updated_at();

create index if not exists group_post_engagements_status_updated_idx
  on public.group_post_engagements (dm_status, updated_at);

-- Claim atômico: marca o momento do claim para o reaper saber o que está
-- preso. (A versão anterior só mudava o status.)
create or replace function public.claim_group_dms(p_limit integer)
returns setof public.group_post_engagements
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select e.id
    from public.group_post_engagements e
    where e.dm_status in ('pending', 'waiting')
      and e.dm_due_at <= now()
    order by e.dm_due_at
    limit greatest(p_limit, 1)
    for update skip locked
  )
  update public.group_post_engagements e
  set dm_status = 'sending',
      updated_at = now()
  from due
  where e.id = due.id
  returning e.*;
end;
$$;

-- Reaper: agora a coluna existe e o claim marca o timestamp.
create or replace function public.reap_stuck_group_dms()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.group_post_engagements
     set dm_status = 'pending',
         dm_error = 'reaped: runner nao concluiu o envio',
         updated_at = now()
   where dm_status = 'sending'
     and updated_at < now() - interval '15 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.reap_stuck_group_dms() from public;
grant execute on function public.reap_stuck_group_dms() to service_role;
