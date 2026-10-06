-- 057_noreply_followup.sql
-- Régua de follow-up para leads sem resposta ("cobrança automática").
--
-- Fluxo: SDR responde ao lead e a conversa fica em silêncio → o runner
-- (pg_cron, 10 min) detecta (conversations.last_message_inbound = false),
-- envia mensagens de re-engajamento configuradas por tentativa (X vezes,
-- intervalos crescentes) e, se o lead continuar sem responder, move a
-- oportunidade para um estágio de destino (padrão: "Sem Resposta") para
-- revisão humana, criando uma tarefa de follow_up.
--
-- Resposta do lead a qualquer momento encerra a régua (webhook chama
-- noreply_mark_replied). Toda mensagem nossa (manual ou da própria régua)
-- reinicia o relógio (noreply_touch) sem zerar as tentativas — evita loop
-- infinito humano + bot.
--
-- Interage com o SDR IA: a régua NÃO roda enquanto a IA está no comando da
-- conversa (sdr_conversations.status em active/paused_limit/paused_schedule).
-- Nos estados paused_human/transferred/completed (humano assumiu e sumiu) a
-- régua engajará normalmente.

-- ===========================================================================
-- 1. NOREPLY SETTINGS (singleton, admin)
-- ===========================================================================

create table if not exists public.noreply_settings (
  id                   uuid primary key default gen_random_uuid(),
  is_active            boolean not null default false,
  -- Só enviar dentro do horário comercial (business_hours, 029).
  business_hours_only  boolean not null default true,
  -- Pular envios em fim de semana.
  skip_weekends        boolean not null default true,
  -- true: novo ciclo de silêncio após uma resposta inicia régua nova;
  -- false: conversa com ciclo encerrado (replied/exhausted) nunca reentra.
  restart_after_reply  boolean not null default true,
  -- Após a última tentativa, esperar N horas antes de mover o card.
  exhaust_grace_hours int not null default 72 check (exhaust_grace_hours >= 0),
  -- Criar tarefa de follow_up para o responsável ao esgotar.
  task_on_exhaust      boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.noreply_settings enable row level security;

create policy "noreply_settings_select" on public.noreply_settings
  for select to authenticated using (true);

create policy "noreply_settings_update_admin" on public.noreply_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create trigger noreply_settings_set_updated_at
  before update on public.noreply_settings
  for each row execute function public.set_updated_at();

-- Linha única de configuração (id fixo para o seed ser idempotente).
-- Nasce DESLIGADA: o admin ativa na UI depois de revisar as mensagens.
insert into public.noreply_settings (id, is_active)
values ('e0000000-0000-0000-0000-000000000001', false)
on conflict (id) do nothing;

-- ===========================================================================
-- 2. NOREPLY ATTEMPTS (mensagens por tentativa, admin)
-- ===========================================================================

create table if not exists public.noreply_attempts (
  id             uuid primary key default gen_random_uuid(),
  attempt_number int not null unique check (attempt_number >= 1),
  -- Horas de silêncio (desde a última mensagem nossa) antes desta tentativa.
  delay_hours    int not null default 24 check (delay_hours >= 1),
  template_id    uuid references public.message_templates(id) on delete set null,
  message_text   text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.noreply_attempts enable row level security;

create policy "noreply_attempts_select" on public.noreply_attempts
  for select to authenticated using (true);

create policy "noreply_attempts_insert_admin" on public.noreply_attempts
  for insert to authenticated with check (public.is_admin());

create policy "noreply_attempts_update_admin" on public.noreply_attempts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "noreply_attempts_delete_admin" on public.noreply_attempts
  for delete to authenticated using (public.is_admin());

create trigger noreply_attempts_set_updated_at
  before update on public.noreply_attempts
  for each row execute function public.set_updated_at();

-- Seed: 3 tentativas com ritmo crescente (1 dia, 3 dias, 7 dias).
insert into public.noreply_attempts (attempt_number, delay_hours, message_text) values
  (1, 24,
   'Oi {{contact.name}}! Conseguiu ver minha última mensagem? Fico à disposição para tirar qualquer dúvida 😊'),
  (2, 72,
   '{{contact.name}}, só passando para saber se ainda faz sentido conversarmos. Qualquer dúvida respondo por aqui!'),
  (3, 168,
   'Última tentativa por aqui, {{contact.name}}! Se não for o momento, sem problemas — é só me avisar quando quiser retomar 🙂')
on conflict (attempt_number) do nothing;

-- ===========================================================================
-- 3. NOREPLY PIPELINE CONFIGS (estágio de destino por funil, admin)
-- ===========================================================================

create table if not exists public.noreply_pipeline_configs (
  id              uuid primary key default gen_random_uuid(),
  pipeline_id     uuid not null unique references public.pipelines(id) on delete cascade,
  target_stage_id uuid references public.pipeline_stages(id) on delete set null,
  is_enabled      boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.noreply_pipeline_configs enable row level security;

create policy "noreply_pipeline_configs_select" on public.noreply_pipeline_configs
  for select to authenticated using (true);

create policy "noreply_pipeline_configs_insert_admin" on public.noreply_pipeline_configs
  for insert to authenticated with check (public.is_admin());

create policy "noreply_pipeline_configs_update_admin" on public.noreply_pipeline_configs
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "noreply_pipeline_configs_delete_admin" on public.noreply_pipeline_configs
  for delete to authenticated using (public.is_admin());

create trigger noreply_pipeline_configs_set_updated_at
  before update on public.noreply_pipeline_configs
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 4. Seed do estágio "Sem Resposta" + configs padrão por pipeline
-- ===========================================================================

do $$
declare
  p record;
  v_pos int;
  v_stage_id uuid;
begin
  for p in select id from public.pipelines loop
    select coalesce(max(position), 0) + 1 into v_pos
    from public.pipeline_stages
    where pipeline_id = p.id;

    if not exists (
      select 1 from public.pipeline_stages
      where pipeline_id = p.id and name = 'Sem Resposta'
    ) then
      insert into public.pipeline_stages (pipeline_id, name, description, position, color, is_active)
      values (p.id, 'Sem Resposta',
              'Leads que não responderam à régua de follow-up automático — revisar e excluir/ganhar manualmente',
              v_pos, '#9ca3af', true);
    end if;

    select id into v_stage_id
    from public.pipeline_stages
    where pipeline_id = p.id and name = 'Sem Resposta'
    order by position desc
    limit 1;

    insert into public.noreply_pipeline_configs (pipeline_id, target_stage_id, is_enabled)
    values (p.id, v_stage_id, true)
    on conflict (pipeline_id) do nothing;
  end loop;
end;
$$;

-- ===========================================================================
-- 5. NOREPLY STATES (a régua, por conversa)
-- ===========================================================================

create table if not exists public.noreply_states (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  contact_id       uuid not null references public.contacts(id) on delete cascade,
  opportunity_id   uuid references public.opportunities(id) on delete set null,
  attempts_made    int not null default 0 check (attempts_made >= 0),
  status           text not null default 'active'
                   check (status in ('active', 'replied', 'exhausted', 'cancelled')),
  next_check_at    timestamptz,
  -- Delay (horas) agendado para a PRÓXIMA tentativa — fonte única de verdade
  -- compartilhada entre runner e noreply_touch (funciona mesmo com números de
  -- tentativa não-contíguos). Null = todas enviadas; touch usa a tolerância.
  next_delay_hours int,
  last_outbound_at timestamptz,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.noreply_states enable row level security;

create policy "noreply_states_select" on public.noreply_states
  for select to authenticated using (true);

create policy "noreply_states_update" on public.noreply_states
  for update to authenticated
  using (true)
  with check (true);

create trigger noreply_states_set_updated_at
  before update on public.noreply_states
  for each row execute function public.set_updated_at();

-- Uma régua ATIVA por conversa (histórico de ciclos anteriores é preservado).
create unique index if not exists noreply_states_active_conversation_idx
  on public.noreply_states (conversation_id)
  where status = 'active';

create index if not exists noreply_states_due_idx
  on public.noreply_states (next_check_at)
  where status = 'active';

create index if not exists noreply_states_conversation_id_idx
  on public.noreply_states (conversation_id);

create index if not exists noreply_states_status_idx
  on public.noreply_states (status);

-- ===========================================================================
-- 6. NOREPLY EVENTS (auditoria)
-- ===========================================================================

create table if not exists public.noreply_events (
  id         uuid primary key default gen_random_uuid(),
  state_id   uuid not null references public.noreply_states(id) on delete cascade,
  event_type text not null check (event_type in (
    'started', 'attempt_sent', 'send_failed', 'reply_detected',
    'reply_after_exhausted', 'exhausted', 'moved_to_stage',
    'cancelled', 'rescheduled'
  )),
  attempt    int,
  message_id uuid references public.messages(id) on delete set null,
  details    jsonb,
  created_at timestamptz not null default now()
);

alter table public.noreply_events enable row level security;

create policy "noreply_events_select" on public.noreply_events
  for select to authenticated using (true);

create policy "noreply_events_insert" on public.noreply_events
  for insert to authenticated with check (true);

create index if not exists noreply_events_state_id_idx
  on public.noreply_events (state_id);

create index if not exists noreply_events_created_at_idx
  on public.noreply_events (created_at desc);

-- ===========================================================================
-- 7. Índice de scan: conversas aguardando resposta do lead
-- ===========================================================================

create index if not exists conversations_awaiting_reply_idx
  on public.conversations (last_message_at)
  where last_message_inbound = false and status = 'open';

-- ===========================================================================
-- 8. RPC: noreply_touch — reinicia o relógio a cada mensagem nossa
-- ===========================================================================
-- Chamado pelo evolution-proxy (mensagem manual do SDR) e pelo webhook (eco
-- outbound de mensagem enviada fora do CRM). Agenda a próxima checagem para
-- sent_at + delay da PRÓXIMA tentativa (ou do período de tolerância, se todas
-- já foram enviadas). NÃO zera attempts_made: mensagem manual reinicia o
-- relógio, mas o lead não ganha um ciclo novo por causa disso.

create or replace function public.noreply_touch(
  p_conversation_id uuid,
  p_sent_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.noreply_states%rowtype;
  v_grace int;
begin
  select * into s
  from public.noreply_states
  where conversation_id = p_conversation_id and status = 'active';
  if s.id is null then return; end if;

  select coalesce(max(exhaust_grace_hours), 72) into v_grace
  from public.noreply_settings;

  update public.noreply_states
  set next_check_at = coalesce(p_sent_at, now())
        + (coalesce(s.next_delay_hours, v_grace) || ' hours')::interval,
      last_outbound_at = coalesce(p_sent_at, now())
  where id = s.id;

  insert into public.noreply_events (state_id, event_type, attempt, details)
  values (s.id, 'rescheduled', s.attempts_made,
          jsonb_build_object('reason', 'outbound_message',
                             'next_delay_hours', coalesce(s.next_delay_hours, v_grace)));
end;
$$;

-- ===========================================================================
-- 9. RPC: noreply_mark_replied — o lead respondeu, encerra a régua
-- ===========================================================================
-- Chamado pelo webhook (mensagem inbound persistida, service role).
-- - estado ativo → 'replied' (régua encerrada; novo silêncio abre ciclo novo
--   se restart_after_reply = true);
-- - estado esgotado → registra o evento + activity_log para o humano revisar
--   o card (o card PERMANECE no estágio "Sem Resposta" — sem auto-retorno).

create or replace function public.noreply_mark_replied(
  p_conversation_id uuid,
  p_message_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.noreply_states%rowtype;
begin
  select * into s
  from public.noreply_states
  where conversation_id = p_conversation_id
  order by created_at desc
  limit 1;
  if s.id is null then return 'none'; end if;

  if s.status = 'active' then
    update public.noreply_states
    set status = 'replied',
        ended_at = now(),
        next_check_at = null
    where id = s.id;

    insert into public.noreply_events (state_id, event_type, attempt, message_id, details)
    values (s.id, 'reply_detected', s.attempts_made, p_message_id,
            jsonb_build_object('attempts_made', s.attempts_made));
    return 'replied';

  elsif s.status = 'exhausted' then
    insert into public.noreply_events (state_id, event_type, attempt, message_id)
    values (s.id, 'reply_after_exhausted', s.attempts_made, p_message_id);

    if s.opportunity_id is not null then
      insert into public.activity_log (entity_type, entity_id, action, new_data)
      values ('opportunity', s.opportunity_id,
              'NOREPLY: lead respondeu após régua esgotada — revisar card no funil',
              jsonb_build_object('attempts_made', s.attempts_made));
    end if;
    return 'reply_after_exhausted';
  end if;

  return 'none';
end;
$$;

-- ===========================================================================
-- 10. RPC: noreply_detect_candidates — scan de conversas para matricular
-- ===========================================================================
-- Critérios (toda a lógica de detecção vive aqui, o runner só consome):
--   - conversa aberta com last_message_inbound = false (nós falhamos por
--     último) e last_message_at preenchido;
--   - contato sem opt-out;
--   - oportunidade OPEN vinculada (por conversation_id ou por contato) em
--     pipeline com config habilitada — pega a mais recente por conversa;
--   - o estágio atual NÃO é o estágio de destino da régua: evita o loop
--     infinito "esgota → move p/ Sem Resposta → re-matricula → esgota...";
--     o humano precisa mover o card para outro estágio para reativar o lead;
--   - sem estado ativo (unique parcial) e, quando restart_after_reply =
--     false, sem ciclo encerrado antes;
--   - SDR IA não está no comando da conversa.

create or replace function public.noreply_detect_candidates(
  p_limit int default 100
)
returns table (
  r_conversation_id uuid,
  r_contact_id uuid,
  r_opportunity_id uuid,
  r_last_message_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_restart boolean;
begin
  select coalesce(max(restart_after_reply), true) into v_restart
  from public.noreply_settings;

  return query
  select * from (
    select distinct on (c.id)
      c.id,
      c.contact_id,
      o.id,
      c.last_message_at
    from public.conversations c
    join public.contacts ct on ct.id = c.contact_id
    join public.opportunities o
      on o.status = 'open'
     and (o.conversation_id = c.id
          or (o.conversation_id is null and o.contact_id = c.contact_id))
     and o.pipeline_id in (
          select pc.pipeline_id
          from public.noreply_pipeline_configs pc
          where pc.is_enabled
        )
     -- Card já no estágio de destino não reentra (quebra o loop de re-matrícula).
     and not exists (
          select 1 from public.noreply_pipeline_configs pc
          where pc.pipeline_id = o.pipeline_id
            and pc.target_stage_id = o.stage_id
        )
    where c.status = 'open'
      and c.last_message_inbound = false
      and c.last_message_at is not null
      and ct.opted_out = false
      and not exists (
        select 1 from public.noreply_states s
        where s.conversation_id = c.id and s.status = 'active'
      )
      and (
        v_restart
        or not exists (
          select 1 from public.noreply_states s
          where s.conversation_id = c.id and s.status in ('replied', 'exhausted')
        )
      )
      -- Anti-loop pós-esgotamento: só re-matricula se houve mensagem DEPOIS
      -- do fim do ciclo anterior (o SDR tocou a conversa de novo). Sem isso,
      -- régua sem estágio de destino esgotaria e re-matricularia para sempre.
      and not exists (
        select 1 from public.noreply_states s
        where s.conversation_id = c.id
          and s.status = 'exhausted'
          and s.ended_at is not null
          and s.ended_at >= c.last_message_at
      )
      and not exists (
        select 1 from public.sdr_conversations sc
        where sc.conversation_id = c.id
          and sc.status in ('active', 'paused_limit', 'paused_schedule')
      )
    order by c.id, o.created_at desc
  ) t
  order by t.last_message_at asc
  limit greatest(p_limit, 1);
end;
$$;

-- ===========================================================================
-- 11. Auth para o noreply-runner (pg_cron)
-- ===========================================================================

insert into public.app_secrets (key, value)
values ('noreply_internal_token', gen_random_uuid()::text)
on conflict (key) do nothing;

-- ===========================================================================
-- 12. Cron: noreply-runner a cada 10 minutos
-- ===========================================================================

select cron.unschedule(jobid)
from cron.job
where jobname = 'noreply-runner';

select cron.schedule(
  'noreply-runner',
  '*/10 * * * *',
  $$
    select net.http_post(
      url := 'https://gboyodouyrkljqbrxohz.supabase.co/functions/v1/noreply-runner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdib3lvZG91eXJrbGpxYnJ4b2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTY4ODgsImV4cCI6MjEwMjkzMjg4OH0.OSZNTnjJbRlP0epjzmvyGlijAtLkwjCtqMGph2esBbg'
      ),
      body := jsonb_build_object(
        'internal_token', (
          select s.value from public.app_secrets s
          where s.key = 'noreply_internal_token'
          limit 1
        )
      )
    );
  $$
);
