-- 053_cadences.sql
-- Cadência de vendas: sequência automática de etapas que move oportunidades
-- no Pipeline (kanban) e dispara mensagens WhatsApp (Evolution API).
--
-- Arquitetura runner-only: o Edge Function `cadence-runner` (pg_cron, 5 min)
-- faz tudo — matrícula, sincronização com movimentação manual, execução de
-- etapa e envio. Sem triggers de banco: toda a lógica vive em um só lugar,
-- idempotente por passada.
--
-- Regras:
--   - Matrícula: oportunidade open entra no estágio gatilho de uma cadência
--     ativa → cria enrollment (assigned_to = responsável da oportunidade).
--     Uma oportunidade tem no máximo UMA cadência ativa.
--   - Sincronização: card movido manualmente para o estágio de uma etapa j
--     (j > current_step) → current_step = j (etapas anteriores são puladas,
--     sem re-envio) e próxima etapa é agendada.
--   - Encerramento: status won/lost → cancelled; última etapa → completed.
--   - Pausa manual pela UI (status 'paused'): ignorada pelo runner.

-- ===========================================================================
-- 1. CADENCES (modelos, admin)
-- ===========================================================================

create table if not exists public.cadences (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  pipeline_id      uuid not null references public.pipelines(id) on delete cascade,
  trigger_stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  skip_weekends    boolean not null default true,
  is_active        boolean not null default true,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.cadences enable row level security;

create policy "cadences_select" on public.cadences
  for select to authenticated using (true);

create policy "cadences_insert_admin" on public.cadences
  for insert to authenticated with check (public.is_admin());

create policy "cadences_update_admin" on public.cadences
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "cadences_delete_admin" on public.cadences
  for delete to authenticated using (public.is_admin());

create trigger cadences_set_updated_at
  before update on public.cadences
  for each row execute function public.set_updated_at();

create index cadences_pipeline_id_idx on public.cadences (pipeline_id);
create index cadences_trigger_stage_idx on public.cadences (trigger_stage_id);
create index cadences_active_idx on public.cadences (is_active)
  where is_active is true;

-- ===========================================================================
-- 2. CADENCE STEPS
-- ===========================================================================

create table if not exists public.cadence_steps (
  id           uuid primary key default gen_random_uuid(),
  cadence_id   uuid not null references public.cadences(id) on delete cascade,
  step_order   int not null,
  stage_id     uuid not null references public.pipeline_stages(id) on delete cascade,
  delay_days   int not null default 1 check (delay_days >= 0),
  send_message boolean not null default false,
  template_id  uuid references public.message_templates(id) on delete set null,
  message_text text,
  created_at   timestamptz not null default now(),
  unique (cadence_id, step_order)
);

alter table public.cadence_steps enable row level security;

create policy "cadence_steps_select" on public.cadence_steps
  for select to authenticated using (true);

create policy "cadence_steps_insert_admin" on public.cadence_steps
  for insert to authenticated with check (public.is_admin());

create policy "cadence_steps_update_admin" on public.cadence_steps
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "cadence_steps_delete_admin" on public.cadence_steps
  for delete to authenticated using (public.is_admin());

create index cadence_steps_cadence_id_idx on public.cadence_steps (cadence_id, step_order);

-- ===========================================================================
-- 3. CADENCE ENROLLMENTS
-- ===========================================================================

create table if not exists public.cadence_enrollments (
  id             uuid primary key default gen_random_uuid(),
  cadence_id     uuid not null references public.cadences(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  current_step   int not null default 0,
  status         text not null default 'active'
                 check (status in ('active', 'paused', 'completed', 'cancelled')),
  next_run_at    timestamptz,
  completed_at   timestamptz,
  cancelled_at   timestamptz,
  started_at     timestamptz not null default now(),
  assigned_to    uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (cadence_id, opportunity_id)
);

alter table public.cadence_enrollments enable row level security;

create policy "cadence_enrollments_select" on public.cadence_enrollments
  for select to authenticated using (true);

create policy "cadence_enrollments_insert" on public.cadence_enrollments
  for insert to authenticated with check (true);

create policy "cadence_enrollments_update" on public.cadence_enrollments
  for update to authenticated
  using (true)
  with check (true);

create policy "cadence_enrollments_delete" on public.cadence_enrollments
  for delete to authenticated using (true);

create trigger cadence_enrollments_set_updated_at
  before update on public.cadence_enrollments
  for each row execute function public.set_updated_at();

create index cadence_enrollments_opportunity_id_idx on public.cadence_enrollments (opportunity_id);
create index cadence_enrollments_due_idx on public.cadence_enrollments (next_run_at)
  where status = 'active';
create index cadence_enrollments_active_idx on public.cadence_enrollments (status);

-- ===========================================================================
-- 4. CADENCE EXECUTIONS (histórico/auditoria)
-- ===========================================================================

create table if not exists public.cadence_executions (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references public.cadence_enrollments(id) on delete cascade,
  step_id        uuid references public.cadence_steps(id) on delete set null,
  step_order     int,
  status         text not null default 'completed'
                 check (status in ('completed', 'failed', 'skipped')),
  message_id     uuid references public.messages(id) on delete set null,
  error          text,
  details        jsonb,
  executed_at    timestamptz not null default now()
);

alter table public.cadence_executions enable row level security;

create policy "cadence_executions_select" on public.cadence_executions
  for select to authenticated using (true);

create policy "cadence_executions_insert" on public.cadence_executions
  for insert to authenticated with check (true);

create index cadence_executions_enrollment_id_idx on public.cadence_executions (enrollment_id);
create index cadence_executions_executed_at_idx on public.cadence_executions (executed_at desc);

-- ===========================================================================
-- 5. Auth para o cadence-runner (pg_cron)
-- ===========================================================================
-- Token interno gerado aqui e lido pelo Edge Function com service role
-- (mesmo padrão do zernio_internal_token / zernio-proxy).

insert into public.app_secrets (key, value)
values ('cadence_internal_token', gen_random_uuid()::text)
on conflict (key) do nothing;

-- ===========================================================================
-- 6. Cron: cadence-runner a cada 5 minutos
-- ===========================================================================

select cron.unschedule(jobid)
from cron.job
where jobname = 'cadence-runner';

select cron.schedule(
  'cadence-runner',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://gboyodouyrkljqbrxohz.supabase.co/functions/v1/cadence-runner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdib3lvZG91eXJrbGpxYnJ4b2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTY4ODgsImV4cCI6MjEwMjkzMjg4OH0.OSZNTnjJbRlP0epjzmvyGlijAtLkwjCtqMGph2esBbg'
      ),
      body := jsonb_build_object(
        'internal_token', (
          select s.value from public.app_secrets s
          where s.key = 'cadence_internal_token'
          limit 1
        )
      )
    );
  $$
);
