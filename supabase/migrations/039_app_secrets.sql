-- 039_app_secrets.sql
-- Segredos saem do activity_log (visível a qualquer autenticado) para uma
-- tabela própria, legível somente por service role (Edge Functions).
-- Inclui correção: activity_log.entity_id era NOT NULL mas as funções gravam
-- logs com entity_id null (auditoria nunca funcionou).

create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;
-- Sem policies: nenhuma leitura/escrita direta de cliente; só service role.

-- Auditoria volta a funcionar (inserts com entity_id null).
alter table public.activity_log alter column entity_id drop not null;

-- activity_log passa a ser leitura/escrita apenas de admin (usa service role
-- nas funções; o frontend não consome a tabela).
drop policy if exists "activity_log_select" on public.activity_log;
create policy "activity_log_select" on public.activity_log
  for select to authenticated using (public.is_admin());

drop policy if exists "activity_log_insert" on public.activity_log;
create policy "activity_log_insert" on public.activity_log
  for insert to authenticated with check (public.is_admin());

-- Migra qualquer key legada que tenha entrado antes da restrição.
insert into public.app_secrets (key, value)
select 'openrouter_api_key', (new_data->>'key')
from public.activity_log
where entity_type = 'ai_key' and (new_data->>'key') is not null
order by created_at desc
limit 1
on conflict (key) do update
  set value = excluded.value, updated_at = now();

delete from public.activity_log where entity_type = 'ai_key';
