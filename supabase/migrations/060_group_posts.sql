-- 060_group_posts.sql
-- Posts programados em grupos de WhatsApp (Evolution, @g.us) + DM com delay
-- para os membros que comentarem a publicação.
--
-- Fluxo:
--   group_posts (scheduled) --group-publisher (pg_cron 5min)--> published no grupo
--   evolution-webhook: inbound de grupo dentro da janela (reply OU qualquer msg)
--     --> group_post_engagements (1 por post+contato, dm_due_at = comentário + jitter)
--   group-dm-runner (pg_cron 5min) --> DM 1:1 via mesma instância Evolution
--
-- Toda escrita passa pelas Edge Functions (service role); o frontend apenas lê
-- (mesmo padrão de campaigns/046). DM nunca fura SDR IA nem régua noreply:
-- o runner adia (waiting) em vez de enviar junto.

-- ===========================================================================
-- 1. Tabela de posts
-- ===========================================================================

create table if not exists public.group_posts (
  id                  uuid primary key default gen_random_uuid(),
  instance_id         uuid not null references public.whatsapp_instances(id) on delete cascade,
  group_jid           text not null, -- ex.: 5511999999999-1234567890@g.us
  group_name          text,
  content             text not null default '',
  media_url           text, -- path no bucket whatsapp-media (group-posts/...)
  media_type          text check (media_type in ('image', 'video', 'audio', 'document')),
  scheduled_at        timestamptz not null,
  window_hours        integer not null default 72 check (window_hours between 1 and 720),
  dm_delay_min_s      integer not null default 300 check (dm_delay_min_s >= 0),
  dm_delay_max_s      integer not null default 900 check (dm_delay_max_s >= dm_delay_min_s),
  dm_template         text not null default 'Oi {{contact.name}}! Vi que você comentou no grupo e quis te chamar aqui no privado. Como posso te ajudar?',
  pacing_seconds      integer not null default 20 check (pacing_seconds between 0 and 300),
  status              text not null default 'scheduled'
    check (status in ('scheduled', 'publishing', 'published', 'expired', 'cancelled', 'failed')),
  published_message_id text,
  published_at        timestamptz,
  publish_attempts    integer not null default 0,
  last_error          text,
  -- contadores (recalc_group_post_stats)
  engaged_count       integer not null default 0,
  dm_sent_count       integer not null default 0,
  dm_failed_count     integer not null default 0,
  dm_pending_count    integer not null default 0,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists group_posts_set_updated_at on public.group_posts;
create trigger group_posts_set_updated_at
  before update on public.group_posts
  for each row execute function public.set_updated_at();

alter table public.group_posts enable row level security;

drop policy if exists "group_posts_select" on public.group_posts;
create policy "group_posts_select" on public.group_posts
  for select to authenticated using (true);

create index if not exists group_posts_schedule_idx
  on public.group_posts (status, scheduled_at);
create index if not exists group_posts_group_idx
  on public.group_posts (instance_id, group_jid, status);

-- ===========================================================================
-- 2. Tabela de engajamentos (quem comentou -> DM)
-- ===========================================================================

create table if not exists public.group_post_engagements (
  id                  uuid primary key default gen_random_uuid(),
  post_id             uuid not null references public.group_posts(id) on delete cascade,
  contact_id          uuid references public.contacts(id) on delete set null,
  commented_at        timestamptz not null,
  comment_message_id  text,
  via                 text not null default 'window' check (via in ('reply', 'window')),
  dm_status           text not null default 'pending'
    check (dm_status in ('pending', 'sending', 'waiting', 'sent', 'failed',
                         'skipped_optout', 'skipped_no_phone', 'cancelled')),
  dm_due_at           timestamptz not null,
  dm_sent_at          timestamptz,
  dm_attempts         integer not null default 0,
  dm_error            text,
  dm_message_id       uuid references public.messages(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (post_id, contact_id)
);

alter table public.group_post_engagements enable row level security;

drop policy if exists "group_post_engagements_select" on public.group_post_engagements;
create policy "group_post_engagements_select" on public.group_post_engagements
  for select to authenticated using (true);

create index if not exists group_post_engagements_due_idx
  on public.group_post_engagements (dm_status, dm_due_at);
create index if not exists group_post_engagements_post_idx
  on public.group_post_engagements (post_id, dm_status);

-- ===========================================================================
-- 3. Claim atômico do publisher (FOR UPDATE SKIP LOCKED — sem double-post)
-- ===========================================================================

create or replace function public.claim_group_posts(p_limit integer)
returns setof public.group_posts
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select gp.id
    from public.group_posts gp
    where gp.status = 'scheduled'
      and gp.scheduled_at <= now()
    order by gp.scheduled_at
    limit greatest(p_limit, 1)
    for update skip locked
  )
  update public.group_posts gp
  set status = 'publishing', updated_at = now()
  from due
  where gp.id = due.id
  returning gp.*;
end;
$$;

-- ===========================================================================
-- 4. Claim atômico do DM runner (pending + waiting vencidos)
-- ===========================================================================

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
  set dm_status = 'sending'
  from due
  where e.id = due.id
  returning e.*;
end;
$$;

-- ===========================================================================
-- 5. Recalcula contadores do post (idempotente)
-- ===========================================================================

create or replace function public.recalc_group_post_stats(p_post_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.group_posts gp
  set engaged_count    = s.total,
      dm_sent_count    = s.sent,
      dm_failed_count  = s.failed,
      dm_pending_count = s.pending,
      updated_at       = now()
  from (
    select
      count(*)::int                                                          as total,
      count(*) filter (where dm_status = 'sent')::int                        as sent,
      count(*) filter (where dm_status in ('failed'))::int                    as failed,
      count(*) filter (where dm_status in ('pending', 'sending', 'waiting'))::int as pending
    from public.group_post_engagements
    where post_id = p_post_id
  ) s
  where gp.id = p_post_id;
$$;

-- ===========================================================================
-- 6. Auth para os runners (pg_cron)
-- ===========================================================================

insert into public.app_secrets (key, value)
values ('group_posts_internal_token', gen_random_uuid()::text)
on conflict (key) do nothing;

-- ===========================================================================
-- 7. Cron: group-publisher + group-dm-runner a cada 5 minutos
-- ===========================================================================

select cron.unschedule(jobid)
from cron.job
where jobname in ('group-publisher', 'group-dm-runner');

select cron.schedule(
  'group-publisher',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://gboyodouyrkljqbrxohz.supabase.co/functions/v1/group-publisher',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdib3lvZG91eXJrbGpxYnJ4b2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTY4ODgsImV4cCI6MjEwMjkzMjg4OH0.OSZNTnjJbRlP0epjzmvyGlijAtLkwjCtqMGph2esBbg'
      ),
      body := jsonb_build_object(
        'internal_token', (
          select s.value from public.app_secrets s
          where s.key = 'group_posts_internal_token'
          limit 1
        )
      )
    );
  $$
);

select cron.schedule(
  'group-dm-runner',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://gboyodouyrkljqbrxohz.supabase.co/functions/v1/group-dm-runner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdib3lvZG91eXJrbGpxYnJ4b2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTY4ODgsImV4cCI6MjEwMjkzMjg4OH0.OSZNTnjJbRlP0epjzmvyGlijAtLkwjCtqMGph2esBbg'
      ),
      body := jsonb_build_object(
        'internal_token', (
          select s.value from public.app_secrets s
          where s.key = 'group_posts_internal_token'
          limit 1
        )
      )
    );
  $$
);
