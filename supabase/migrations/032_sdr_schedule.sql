-- 032_sdr_schedule.sql
-- Replace single schedule with flexible time windows per day.

-- ===========================================================================
-- 1. SDR SCHEDULE (flexible time windows)
-- ===========================================================================

create table if not exists public.sdr_schedule (
  id          uuid primary key default gen_random_uuid(),
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (start_time != end_time)
);

alter table public.sdr_schedule enable row level security;

create policy "sdr_schedule_select" on public.sdr_schedule
  for select to authenticated using (true);

create policy "sdr_schedule_insert_admin" on public.sdr_schedule
  for insert to authenticated with check (public.is_admin());

create policy "sdr_schedule_update_admin" on public.sdr_schedule
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "sdr_schedule_delete_admin" on public.sdr_schedule
  for delete to authenticated using (public.is_admin());

create trigger sdr_schedule_set_updated_at
  before update on public.sdr_schedule
  for each row execute function public.set_updated_at();

create index sdr_schedule_day_idx on public.sdr_schedule (day_of_week);
create index sdr_schedule_active_idx on public.sdr_schedule (is_active);

-- ===========================================================================
-- 2. Migrate existing settings to new schedule
-- ===========================================================================

-- Monday-Friday 08:00-18:00 (default from sdr_settings)
insert into public.sdr_schedule (day_of_week, start_time, end_time, is_active) values
  (1, '08:00', '18:00', true),
  (2, '08:00', '18:00', true),
  (3, '08:00', '18:00', true),
  (4, '08:00', '18:00', true),
  (5, '08:00', '18:00', true);
