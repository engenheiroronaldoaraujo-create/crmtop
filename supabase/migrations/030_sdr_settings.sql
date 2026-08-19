-- 030_sdr_settings.sql
-- SDR IA settings, conversation tracking, and logs.

-- ===========================================================================
-- 1. SDR SETTINGS (global configuration)
-- ===========================================================================

create table if not exists public.sdr_settings (
  id                          uuid primary key default gen_random_uuid(),
  enabled                     boolean not null default false,
  test_mode                   boolean not null default true,
  timezone                    text not null default 'America/Sao_Paulo',
  instance_id                 uuid references public.whatsapp_instances(id),
  -- Schedule
  schedule_monday             boolean not null default true,
  schedule_tuesday            boolean not null default true,
  schedule_wednesday          boolean not null default true,
  schedule_thursday           boolean not null default true,
  schedule_friday             boolean not null default true,
  schedule_saturday           boolean not null default false,
  schedule_sunday             boolean not null default false,
  schedule_start_time         time not null default '08:00',
  schedule_end_time           time not null default '18:00',
  -- Behavior
  after_hours_enabled         boolean not null default true,
  callback_enabled            boolean not null default true,
  silence_start               time,
  silence_end                 time,
  -- Meeting
  meeting_duration_minutes    int not null default 30,
  meeting_minimum_notice_min  int not null default 30,
  meeting_interval_min        int not null default 0,
  -- Limits
  max_messages_per_conversation int not null default 10,
  cooldown_seconds            int not null default 30,
  -- AI
  tone                        text not null default 'profissional_cordial',
  system_prompt               text,
  -- Models
  primary_model               text,
  fallback_model              text,
  -- Version
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

alter table public.sdr_settings enable row level security;

create policy "sdr_settings_select" on public.sdr_settings
  for select to authenticated using (true);

create policy "sdr_settings_insert_admin" on public.sdr_settings
  for insert to authenticated with check (public.is_admin());

create policy "sdr_settings_update_admin" on public.sdr_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create trigger sdr_settings_set_updated_at
  before update on public.sdr_settings
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. SDR CONVERSATIONS (per-conversation SDR state)
-- ===========================================================================

create table if not exists public.sdr_conversations (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.conversations(id) unique,
  contact_id          uuid references public.contacts(id),
  opportunity_id      uuid references public.opportunities(id),
  status              text not null default 'active' check (status in (
    'active', 'paused_human', 'paused_limit', 'paused_schedule',
    'completed', 'transferred', 'error'
  )),
  auto_messages_count int not null default 0,
  last_auto_reply_at  timestamptz,
  handoff_reason      text,
  metadata            jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.sdr_conversations enable row level security;

create policy "sdr_conversations_select" on public.sdr_conversations
  for select to authenticated using (true);

create policy "sdr_conversations_insert" on public.sdr_conversations
  for insert to authenticated with check (true);

create policy "sdr_conversations_update" on public.sdr_conversations
  for update to authenticated
  using (true)
  with check (true);

create index sdr_conversations_conversation_id_idx on public.sdr_conversations (conversation_id);
create index sdr_conversations_status_idx on public.sdr_conversations (status);

create trigger sdr_conversations_set_updated_at
  before update on public.sdr_conversations
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 3. SDR EXECUTION LOG
-- ===========================================================================

create table if not exists public.sdr_logs (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid,
  contact_id          uuid,
  opportunity_id      uuid,
  message_id          text,
  model               text,
  status              text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'skipped')),
  action              text,
  latency_ms          int,
  tokens_used         int,
  error               text,
  metadata            jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

alter table public.sdr_logs enable row level security;

create policy "sdr_logs_select" on public.sdr_logs
  for select to authenticated using (true);

create policy "sdr_logs_insert" on public.sdr_logs
  for insert to authenticated with check (true);

create index sdr_logs_conversation_id_idx on public.sdr_logs (conversation_id);
create index sdr_logs_status_idx on public.sdr_logs (status);
create index sdr_logs_created_at_idx on public.sdr_logs (created_at desc);

-- ===========================================================================
-- 4. SEED: default SDR settings
-- ===========================================================================

insert into public.sdr_settings (enabled, test_mode) values (false, true);
