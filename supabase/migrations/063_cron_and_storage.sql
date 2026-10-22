-- 063_cron_and_storage.sql
--
-- Três correções de infraestrutura:
--
--  1. Os jobs do pg_cron tinham a URL e a anon key de PRODUÇÃO hardcoded
--     (6 migrations, 9 ocorrências). Efeitos:
--       - `supabase db reset` em dev criava jobs que faziam POST na
--         produção;
--       - a URL fixava o project ref em todo o repo;
--       - trocar de projeto exigia editar 6 arquivos de migration.
--     Agora URL e chave vêm de `app_secrets` (que já é lido pelos jobs para
--     o `internal_token`) e o job **falha fechado** se não estiverem
--     configurados.
--
--  2. As policies do bucket `whatsapp-media` estavam em
--     `supabase/storage_policies.sql`, FORA de `migrations/` — o
--     `supabase db push` nunca as aplicava. Agora são uma migration.
--
--  3. `messages`, `automation_executions` e `sdr_logs` crescem sem limite:
--     a "regra dos 60 dias" só filtrava no ingest, não havia job de purga.
--
-- Como os jobs são re-agendados aqui (unschedule + schedule), esta migration
-- é idempotente e pode ser re-executada.

-- ---------------------------------------------------------------------------
-- 1. Cron: URL e chave vindas de app_secrets
-- ---------------------------------------------------------------------------

-- Guarda a URL base e a anon key usadas pelos jobs do cron.
-- Setup (uma vez, pelo admin — o painel usa a ação `set-secret` do
-- `admin-users`, ou SQL direto):
--
--   insert into public.app_secrets (key, value) values
--     ('cron_base_url', 'https://<project-ref>.supabase.co'),
--     ('cron_anon_key', '<SUPABASE_ANON_KEY>')
--   on conflict (key) do update set value = excluded.value;
--
-- Sem esses dois, os jobs não fazem nada (fail closed) — é preferível a
-- um job apontando para a URL errada.

create table if not exists public.cron_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.cron_config enable row level security;

drop policy if exists "cron_config_select_admin" on public.cron_config;
create policy "cron_config_select_admin" on public.cron_config
  for select to authenticated using (public.is_admin());

drop policy if exists "cron_config_write_admin" on public.cron_config;
create policy "cron_config_write_admin" on public.cron_config
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "cron_config_insert_admin" on public.cron_config;
create policy "cron_config_insert_admin" on public.cron_config
  for insert to authenticated with check (public.is_admin());

-- Helper: devolve o par (url base, headers) ou NULL se não configurado.
-- Usado dentro do corpo dos jobs (que roda como postgres e ignora RLS).
create or replace function public.cron_http_target(p_function text)
returns table (
  url     text,
  headers jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rtrim(cfg_base.value, '/') || '/functions/v1/' || p_function,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', cfg_key.value,
      'Authorization', 'Bearer ' || cfg_key.value
    )
  from public.cron_config cfg_base
  join public.cron_config cfg_key on cfg_key.key = 'cron_anon_key'
  where cfg_base.key = 'cron_base_url'
    and cfg_base.value <> ''
    and cfg_key.value <> '';
$$;

revoke execute on function public.cron_http_target(text) from public;
grant execute on function public.cron_http_target(text) to service_role;

-- ---------------------------------------------------------------------------
-- 1.1 Re-agenda os jobs com a configuração externa
-- ---------------------------------------------------------------------------

-- campaign-direct-watchdog (a cada minuto)
select cron.unschedule(jobid) from cron.job
where jobname = 'campaign-direct-watchdog';

select cron.schedule(
  'campaign-direct-watchdog',
  '* * * * *',
  $$
    with cfg as (
      select t.url, t.headers from public.cron_http_target('zernio-proxy') t
    ),
    stalled as (
      select c.id as campaign_id, s.value as internal_token
      from public.campaigns c
      join public.app_secrets s on s.key = 'zernio_internal_token'
      where c.send_mode = 'direct'
        and c.status = 'sending'
        and c.updated_at < now() - interval '2 minutes'
        and exists (
          select 1 from public.campaign_recipients cr
          where cr.campaign_id = c.id and cr.status = 'pending'
        )
      order by c.updated_at
      limit 3
    )
    select net.http_post(
      url := cfg.url,
      headers := cfg.headers,
      body := jsonb_build_object(
        'action', 'campaign-send-batch',
        'campaign_id', stalled.campaign_id,
        'internal_token', stalled.internal_token
      )
    )
    from stalled, cfg;
  $$
);

-- cadence-runner (a cada 5 min)
select cron.unschedule(jobid) from cron.job where jobname = 'cadence-runner';

select cron.schedule(
  'cadence-runner',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := t.url,
      headers := t.headers,
      body := jsonb_build_object(
        'internal_token', (
          select s.value from public.app_secrets s
          where s.key = 'cadence_internal_token'
          limit 1
        )
      )
    )
    from public.cron_http_target('cadence-runner') t;
  $$
);

-- noreply-runner (a cada 10 min)
select cron.unschedule(jobid) from cron.job where jobname = 'noreply-runner';

select cron.schedule(
  'noreply-runner',
  '*/10 * * * *',
  $$
    select net.http_post(
      url := t.url,
      headers := t.headers,
      body := jsonb_build_object(
        'internal_token', (
          select s.value from public.app_secrets s
          where s.key = 'noreply_internal_token'
          limit 1
        )
      )
    )
    from public.cron_http_target('noreply-runner') t;
  $$
);

-- idle-watchdog (a cada hora)
select cron.unschedule(jobid) from cron.job where jobname = 'idle-watchdog';

select cron.schedule(
  'idle-watchdog',
  '0 * * * *',
  $$
    select net.http_post(
      url := t.url,
      headers := t.headers,
      body := jsonb_build_object(
        'event', 'WATCHDOG_IDLE',
        'internal_token', (
          select s.value from public.app_secrets s
          where s.key = 'automation_internal_token'
          limit 1
        )
      )
    )
    from public.cron_http_target('automation-engine') t;
  $$
);

-- group-publisher + group-dm-runner (a cada 5 min)
select cron.unschedule(jobid) from cron.job
where jobname in ('group-publisher', 'group-dm-runner');

select cron.schedule(
  'group-publisher',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := t.url,
      headers := t.headers,
      body := jsonb_build_object(
        'internal_token', (
          select s.value from public.app_secrets s
          where s.key = 'group_posts_internal_token'
          limit 1
        )
      )
    )
    from public.cron_http_target('group-publisher') t;
  $$
);

select cron.schedule(
  'group-dm-runner',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := t.url,
      headers := t.headers,
      body := jsonb_build_object(
        'internal_token', (
          select s.value from public.app_secrets s
          where s.key = 'group_posts_internal_token'
          limit 1
        )
      )
    )
    from public.cron_http_target('group-dm-runner') t;
  $$
);

-- ---------------------------------------------------------------------------
-- 2. Policies do bucket de mídia (eram um .sql fora de migrations/)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;

drop policy if exists "whatsapp_media_select_auth" on storage.objects;
create policy "whatsapp_media_select_auth"
on storage.objects for select to authenticated
using (bucket_id = 'whatsapp-media');

drop policy if exists "whatsapp_media_insert_service" on storage.objects;
create policy "whatsapp_media_insert_service"
on storage.objects for insert to service_role
with check (bucket_id = 'whatsapp-media');

drop policy if exists "whatsapp_media_delete_auth" on storage.objects;
create policy "whatsapp_media_delete_auth"
on storage.objects for delete to authenticated
using (bucket_id = 'whatsapp-media');

-- ---------------------------------------------------------------------------
-- 3. Purga de dados antigos
-- ---------------------------------------------------------------------------

create index if not exists messages_sent_at_idx on public.messages (sent_at);
create index if not exists sdr_logs_created_at_idx_exists
  on public.sdr_logs (created_at desc);

-- Job de purga: roda 1x por dia. Mantém 60 dias de mensagens (a regra que o
-- app já aplicava no ingest, mas que nunca tinha um job para limpar o que já
-- estava no banco).
select cron.unschedule(jobid) from cron.job where jobname = 'purge-old-data';

select cron.schedule(
  'purge-old-data',
  '17 4 * * *',
  $$
    delete from public.messages
     where sent_at < now() - interval '60 days';

    delete from public.automation_executions
     where created_at < now() - interval '90 days';

    delete from public.sdr_logs
     where created_at < now() - interval '180 days';

    delete from public.noreply_events
     where created_at < now() - interval '180 days';
  $$
);
