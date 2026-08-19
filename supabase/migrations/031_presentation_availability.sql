-- 031_presentation_availability.sql
-- Presentation/demo availability slots for SDR scheduling.

create table if not exists public.presentation_slots (
  id          uuid primary key default gen_random_uuid(),
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  is_active   boolean not null default true,
  timezone    text not null default 'America/Sao_Paulo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.presentation_slots enable row level security;

create policy "presentation_slots_select" on public.presentation_slots
  for select to authenticated using (true);

create policy "presentation_slots_insert_admin" on public.presentation_slots
  for insert to authenticated with check (public.is_admin());

create policy "presentation_slots_update_admin" on public.presentation_slots
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "presentation_slots_delete_admin" on public.presentation_slots
  for delete to authenticated using (public.is_admin());

create trigger presentation_slots_set_updated_at
  before update on public.presentation_slots
  for each row execute function public.set_updated_at();

-- Default slots: Mon-Fri 9:00-12:00 and 14:00-18:00
insert into public.presentation_slots (day_of_week, start_time, end_time) values
  (1, '09:00', '12:00'), (1, '14:00', '18:00'),
  (2, '09:00', '12:00'), (2, '14:00', '18:00'),
  (3, '09:00', '12:00'), (3, '14:00', '18:00'),
  (4, '09:00', '12:00'), (4, '14:00', '18:00'),
  (5, '09:00', '12:00'), (5, '14:00', '18:00');
