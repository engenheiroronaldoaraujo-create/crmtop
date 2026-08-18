-- 026_commercial_foundation.sql
-- Commercial module foundation: pipelines, stages, opportunities, tasks, meetings.
-- Follows existing schema conventions (snake_case, uuid PKs, timestamptz, CHECK enums,
-- is_admin() for admin RLS, set_updated_at() trigger).

-- ===========================================================================
-- 1. PIPELINES
-- ===========================================================================

create table if not exists public.pipelines (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  is_default  boolean not null default false,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.pipelines enable row level security;

create policy "pipelines_select" on public.pipelines
  for select to authenticated using (true);

create policy "pipelines_insert_admin" on public.pipelines
  for insert to authenticated with check (public.is_admin());

create policy "pipelines_update_admin" on public.pipelines
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "pipelines_delete_admin" on public.pipelines
  for delete to authenticated using (public.is_admin());

create trigger pipelines_set_updated_at
  before update on public.pipelines
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. PIPELINE STAGES
-- ===========================================================================

create table if not exists public.pipeline_stages (
  id           uuid primary key default gen_random_uuid(),
  pipeline_id  uuid not null references public.pipelines(id),
  name         text not null,
  description  text,
  position     int not null default 0,
  color        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.pipeline_stages enable row level security;

create policy "pipeline_stages_select" on public.pipeline_stages
  for select to authenticated using (true);

create policy "pipeline_stages_insert_admin" on public.pipeline_stages
  for insert to authenticated with check (public.is_admin());

create policy "pipeline_stages_update_admin" on public.pipeline_stages
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "pipeline_stages_delete_admin" on public.pipeline_stages
  for delete to authenticated using (public.is_admin());

create trigger pipeline_stages_set_updated_at
  before update on public.pipeline_stages
  for each row execute function public.set_updated_at();

create index pipeline_stages_pipeline_id_idx on public.pipeline_stages (pipeline_id);
create index pipeline_stages_position_idx on public.pipeline_stages (position);

-- ===========================================================================
-- 3. OPPORTUNITIES
-- ===========================================================================

create table if not exists public.opportunities (
  id                   uuid primary key default gen_random_uuid(),
  contact_id           uuid not null references public.contacts(id),
  pipeline_id          uuid not null references public.pipelines(id),
  stage_id             uuid not null references public.pipeline_stages(id),
  assigned_to          uuid references public.profiles(id),
  conversation_id      uuid references public.conversations(id),
  title                text not null,
  description          text,
  value                numeric(12,2),
  currency             text not null default 'BRL',
  probability          int not null default 0 check (probability >= 0 and probability <= 100),
  expected_close_date  date,
  status               text not null default 'open' check (status in ('open', 'won', 'lost')),
  lost_reason          text,
  created_by           uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  closed_at            timestamptz
);

alter table public.opportunities enable row level security;

create policy "opportunities_select" on public.opportunities
  for select to authenticated using (true);

create policy "opportunities_insert" on public.opportunities
  for insert to authenticated with check (true);

create policy "opportunities_update" on public.opportunities
  for update to authenticated
  using (true)
  with check (true);

create policy "opportunities_delete_admin" on public.opportunities
  for delete to authenticated using (public.is_admin());

create trigger opportunities_set_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();

create index opportunities_contact_id_idx on public.opportunities (contact_id);
create index opportunities_pipeline_id_idx on public.opportunities (pipeline_id);
create index opportunities_stage_id_idx on public.opportunities (stage_id);
create index opportunities_assigned_to_idx on public.opportunities (assigned_to);
create index opportunities_status_idx on public.opportunities (status);
create index opportunities_created_at_idx on public.opportunities (created_at desc);

-- ===========================================================================
-- 4. OPPORTUNITY TASKS (tarefas e follow-ups)
-- ===========================================================================

create table if not exists public.opportunity_tasks (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.opportunities(id),
  contact_id      uuid references public.contacts(id),
  assigned_to     uuid references public.profiles(id),
  title           text not null,
  description     text,
  task_type       text not null default 'task' check (task_type in ('task', 'follow_up')),
  due_at          timestamptz,
  status          text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  priority        text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  completed_at    timestamptz,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.opportunity_tasks enable row level security;

create policy "opportunity_tasks_select" on public.opportunity_tasks
  for select to authenticated using (true);

create policy "opportunity_tasks_insert" on public.opportunity_tasks
  for insert to authenticated with check (true);

create policy "opportunity_tasks_update" on public.opportunity_tasks
  for update to authenticated
  using (true)
  with check (true);

create policy "opportunity_tasks_delete_admin" on public.opportunity_tasks
  for delete to authenticated using (public.is_admin());

create trigger opportunity_tasks_set_updated_at
  before update on public.opportunity_tasks
  for each row execute function public.set_updated_at();

create index opportunity_tasks_opportunity_id_idx on public.opportunity_tasks (opportunity_id);
create index opportunity_tasks_assigned_to_idx on public.opportunity_tasks (assigned_to);
create index opportunity_tasks_due_at_idx on public.opportunity_tasks (due_at);
create index opportunity_tasks_status_idx on public.opportunity_tasks (status);

-- ===========================================================================
-- 5. MEETINGS
-- ===========================================================================

create table if not exists public.meetings (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid references public.opportunities(id),
  contact_id      uuid references public.contacts(id),
  assigned_to     uuid references public.profiles(id),
  title           text not null,
  description     text,
  start_at        timestamptz not null,
  end_at          timestamptz,
  location        text,
  meeting_url     text,
  status          text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.meetings enable row level security;

create policy "meetings_select" on public.meetings
  for select to authenticated using (true);

create policy "meetings_insert" on public.meetings
  for insert to authenticated with check (true);

create policy "meetings_update" on public.meetings
  for update to authenticated
  using (true)
  with check (true);

create policy "meetings_delete_admin" on public.meetings
  for delete to authenticated using (public.is_admin());

create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function public.set_updated_at();

create index meetings_opportunity_id_idx on public.meetings (opportunity_id);
create index meetings_assigned_to_idx on public.meetings (assigned_to);
create index meetings_start_at_idx on public.meetings (start_at);
create index meetings_status_idx on public.meetings (status);

-- ===========================================================================
-- 6. OPPORTUNITY STAGE HISTORY
-- ===========================================================================

create table if not exists public.opportunity_stage_history (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.opportunities(id),
  old_stage_id    uuid references public.pipeline_stages(id),
  new_stage_id    uuid not null references public.pipeline_stages(id),
  changed_by      uuid references public.profiles(id),
  changed_at      timestamptz not null default now()
);

alter table public.opportunity_stage_history enable row level security;

create policy "opportunity_stage_history_select" on public.opportunity_stage_history
  for select to authenticated using (true);

create policy "opportunity_stage_history_insert" on public.opportunity_stage_history
  for insert to authenticated with check (true);

create index opportunity_stage_history_opportunity_id_idx on public.opportunity_stage_history (opportunity_id);
create index opportunity_stage_history_changed_at_idx on public.opportunity_stage_history (changed_at desc);

-- ===========================================================================
-- 7. ACTIVITY LOG (audit trail)
-- ===========================================================================

create table if not exists public.activity_log (
  id              uuid primary key default gen_random_uuid(),
  entity_type     text not null,
  entity_id       uuid not null,
  action          text not null,
  actor_id        uuid references public.profiles(id),
  old_data        jsonb,
  new_data        jsonb,
  created_at      timestamptz not null default now()
);

alter table public.activity_log enable row level security;

create policy "activity_log_select" on public.activity_log
  for select to authenticated using (true);

create policy "activity_log_insert" on public.activity_log
  for insert to authenticated with check (true);

create index activity_log_entity_idx on public.activity_log (entity_type, entity_id);
create index activity_log_created_at_idx on public.activity_log (created_at desc);

-- ===========================================================================
-- 8. RPC: move_opportunity_stage
-- ===========================================================================

create or replace function public.move_opportunity_stage(
  p_opportunity_id uuid,
  p_new_stage_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_stage_id uuid;
begin
  select stage_id into v_old_stage_id
  from public.opportunities
  where id = p_opportunity_id;

  if v_old_stage_id is null then
    raise exception 'opportunity not found';
  end if;

  update public.opportunities
  set stage_id = p_new_stage_id,
      updated_at = now()
  where id = p_opportunity_id;

  insert into public.opportunity_stage_history (
    opportunity_id, old_stage_id, new_stage_id, changed_by
  ) values (
    p_opportunity_id, v_old_stage_id, p_new_stage_id, auth.uid()
  );
end;
$$;

grant execute on function public.move_opportunity_stage(uuid, uuid) to authenticated;

-- ===========================================================================
-- 9. RPC: complete_task
-- ===========================================================================

create or replace function public.complete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.opportunity_tasks
  set status = 'completed',
      completed_at = now(),
      updated_at = now()
  where id = p_task_id and status = 'pending';
end;
$$;

grant execute on function public.complete_task(uuid) to authenticated;

-- ===========================================================================
-- 10. SEED: default pipeline + stages
-- ===========================================================================

insert into public.pipelines (id, name, description, is_default, created_by)
values (
  'a0000000-0000-0000-0000-000000000001',
  'Vendas',
  'Pipeline padrão de vendas',
  true,
  null
) on conflict (id) do nothing;

-- Stages for the default pipeline
insert into public.pipeline_stages (id, pipeline_id, name, position, color) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Novo',              1, '#94a3b8'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Qualificação',      2, '#60a5fa'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Contato Realizado', 3, '#34d399'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Reunião',           4, '#a78bfa'),
  ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Proposta',          5, '#fbbf24'),
  ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Negociação',        6, '#fb923c'),
  ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'Ganho',             7, '#22c55e'),
  ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'Perdido',           8, '#ef4444')
on conflict (id) do nothing;
