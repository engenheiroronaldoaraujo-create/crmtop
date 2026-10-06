-- 058_idle_watchdog.sql
-- Emissor de "oportunidade parada" (OPPORTUNITY_IDLE) — fecha a lacuna de
-- emissor conhecida desde a 029: a regra semeada "Oportunidade Parada -
-- Follow-up" existia, mas nada a disparava (nenhum cron varre oportunidades
-- sem atividade; o README listava isso como dívida conhecida).
--
-- Como funciona: o pg_cron (de hora em hora) chama a automation-engine com
-- event = WATCHDOG_IDLE; a engine roda idle_watchdog_candidates() e dispara
-- processTrigger(OPPORTUNITY_IDLE) para cada oportunidade OPEN parada há
-- >= idle_days_min — dentro do PERÍODO opcional (data início/fim) escolhido
-- pelo admin para escolher quais leads entram.
--
-- Dedup por episódio: uma emissão por período de paralisia. A existência de
-- automation_executions (OPPORTUNITY_IDLE) criada APÓS a última atividade
-- bloqueia re-emissão; quando a oportunidade ganha atividade (mensagem/card),
-- idle_since avança e a próxima paralisia volta a emitir.
--
-- A regra semeada (idle_days >= 3, status open) é ativada aqui — o próprio
-- watchdog nasce DESLIGADO (admin escolhe período e ativa).

-- ===========================================================================
-- 1. IDLE WATCHDOG SETTINGS (singleton, admin)
-- ===========================================================================

create table if not exists public.idle_watchdog_settings (
  id            uuid primary key default gen_random_uuid(),
  is_active     boolean not null default false,
  -- Piso mínimo de dias parado (a regra semeada exige idle_days >= 3,
  -- então o check garante coerência entre emissor e regra).
  idle_days_min int not null default 3 check (idle_days_min >= 3),
  -- Período opcional de escolha dos leads: só emite para oportunidades cuja
  -- última atividade (última mensagem do contato OU última movimentação do
  -- card) está ENTRE as datas (início e fim inclusos). null = todos.
  period_start  date,
  period_end    date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (period_start is null or period_end is null or period_end >= period_start)
);

alter table public.idle_watchdog_settings enable row level security;

create policy "idle_watchdog_settings_select" on public.idle_watchdog_settings
  for select to authenticated using (true);

create policy "idle_watchdog_settings_update_admin" on public.idle_watchdog_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create trigger idle_watchdog_settings_set_updated_at
  before update on public.idle_watchdog_settings
  for each row execute function public.set_updated_at();

-- Linha única de configuração (id fixo para o seed ser idempotente).
-- Nasce DESLIGADA e sem período: o admin escolhe as datas e ativa.
insert into public.idle_watchdog_settings (id, is_active)
values ('f0000000-0000-0000-0000-000000000001', false)
on conflict (id) do nothing;

-- ===========================================================================
-- 2. Ativa a regra semeadada de oportunidade parada (029)
-- ===========================================================================
-- Só esta regra: as demais semeadas (fora do horário, round robin) continuam
-- como estão — ações delas não são o objeto deste watchdog.

update public.automation_rules
set is_active = true,
    updated_at = now()
where trigger_type = 'OPPORTUNITY_IDLE'
  and name = 'Oportunidade Parada - Follow-up'
  and is_active = false;

-- ===========================================================================
-- 3. RPC: idle_watchdog_candidates — scan de oportunidades paradas
-- ===========================================================================
-- idle_since = greatest(
--   opportunities.updated_at,          -- última movimentação do card
--   max(conversations.last_message_at) -- última mensagem do contato
-- )
-- Filtros: status open, idle >= idle_days_min, período opcional, e anti-spam
-- por episódio (sem emissão nova enquanto existir execução criada depois da
-- última atividade).

create or replace function public.idle_watchdog_candidates(
  p_limit int default 100
)
returns table (
  r_opportunity_id uuid,
  r_contact_id uuid,
  r_idle_days int,
  r_idle_since timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_active boolean;
  v_min_days int;
  v_start date;
  v_end date;
begin
  select s.is_active, s.idle_days_min, s.period_start, s.period_end
  into v_active, v_min_days, v_start, v_end
  from public.idle_watchdog_settings s
  order by s.created_at
  limit 1;

  if not coalesce(v_active, false) then
    return; -- watchdog desligado (ou sem linha de settings)
  end if;

  return query
  select
    t.o_id,
    t.o_contact_id,
    greatest(floor(extract(epoch from (now() - t.idle_since)) / 86400)::int, 0),
    t.idle_since
  from (
    select
      o.id as o_id,
      o.contact_id as o_contact_id,
      greatest(o.updated_at, coalesce(cm.last_msg, o.created_at)) as idle_since
    from public.opportunities o
    left join lateral (
      select max(cv.last_message_at) as last_msg
      from public.conversations cv
      where cv.contact_id = o.contact_id
    ) cm on true
    where o.status = 'open'
  ) t
  where t.idle_since <= now() - make_interval(days => greatest(coalesce(v_min_days, 3), 3))
    -- Período de escolha dos leads (fim incluso: < dia seguinte 00:00).
    and (v_start is null or t.idle_since >= v_start::timestamptz)
    and (v_end is null or t.idle_since < (v_end + 1)::timestamptz)
    -- Anti-spam por episódio: já emitiu DEPOIS desta última atividade?
    and not exists (
      select 1
      from public.automation_executions e
      where e.trigger_event = 'OPPORTUNITY_IDLE'
        and e.entity_id = t.o_id
        and e.created_at >= t.idle_since
    )
  order by t.idle_since asc
  limit greatest(p_limit, 1);
end;
$$;

-- ===========================================================================
-- 4. Auth para o watchdog (pg_cron → automation-engine)
-- ===========================================================================
-- A automation-engine valida o WEBHOOK_SECRET (?token=) para o caminho de
-- mensagens; o cron não tem esse segredo de env, então recebe o próprio token
-- no body — a engine só o aceita para event = WATCHDOG_IDLE (fail closed).

insert into public.app_secrets (key, value)
values ('automation_internal_token', gen_random_uuid()::text)
on conflict (key) do nothing;

-- ===========================================================================
-- 5. Cron: watchdog a cada hora
-- ===========================================================================

select cron.unschedule(jobid)
from cron.job
where jobname = 'idle-watchdog';

select cron.schedule(
  'idle-watchdog',
  '0 * * * *',
  $$
    select net.http_post(
      url := 'https://gboyodouyrkljqbrxohz.supabase.co/functions/v1/automation-engine',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdib3lvZG91eXJrbGpxYnJ4b2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTY4ODgsImV4cCI6MjEwMjkzMjg4OH0.OSZNTnjJbRlP0epjzmvyGlijAtLkwjCtqMGph2esBbg'
      ),
      body := jsonb_build_object(
        'event', 'WATCHDOG_IDLE',
        'internal_token', (
          select s.value from public.app_secrets s
          where s.key = 'automation_internal_token'
          limit 1
        )
      )
    );
  $$
);
