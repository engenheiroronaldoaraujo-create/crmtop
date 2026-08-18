-- 029_automation_engine.sql
-- Generic automation engine: rules, executions, business hours.

-- ===========================================================================
-- 1. AUTOMATION RULES
-- ===========================================================================

create table if not exists public.automation_rules (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  is_active     boolean not null default false,
  trigger_type  text not null check (trigger_type in (
    'NEW_CONTACT', 'FIRST_MESSAGE_RECEIVED',
    'MESSAGE_RECEIVED', 'MESSAGE_SENT',
    'OPPORTUNITY_CREATED', 'OPPORTUNITY_STAGE_CHANGED',
    'OPPORTUNITY_ASSIGNED', 'OPPORTUNITY_WON', 'OPPORTUNITY_LOST',
    'TASK_CREATED', 'TASK_COMPLETED', 'TASK_OVERDUE',
    'MEETING_CREATED', 'MEETING_COMPLETED', 'MEETING_CANCELLED',
    'TAG_ADDED_TO_CONTACT', 'TAG_ADDED_TO_OPPORTUNITY',
    'OPPORTUNITY_IDLE', 'TASK_DUE', 'FOLLOWUP_DUE'
  )),
  conditions    jsonb not null default '[]'::jsonb,
  condition_logic text not null default 'all' check (condition_logic in ('all', 'any')),
  actions       jsonb not null default '[]'::jsonb,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.automation_rules enable row level security;

create policy "automation_rules_select" on public.automation_rules
  for select to authenticated using (true);

create policy "automation_rules_insert_admin" on public.automation_rules
  for insert to authenticated with check (public.is_admin());

create policy "automation_rules_update_admin" on public.automation_rules
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "automation_rules_delete_admin" on public.automation_rules
  for delete to authenticated using (public.is_admin());

create trigger automation_rules_set_updated_at
  before update on public.automation_rules
  for each row execute function public.set_updated_at();

create index automation_rules_trigger_type_idx on public.automation_rules (trigger_type);
create index automation_rules_is_active_idx on public.automation_rules (is_active);

-- ===========================================================================
-- 2. AUTOMATION EXECUTIONS (log)
-- ===========================================================================

create table if not exists public.automation_executions (
  id                uuid primary key default gen_random_uuid(),
  automation_id     uuid not null references public.automation_rules(id) on delete cascade,
  trigger_event     text not null,
  entity_type       text,
  entity_id         uuid,
  entity_data       jsonb,
  status            text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'skipped')),
  actions_log       jsonb not null default '[]'::jsonb,
  error             text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  created_at        timestamptz not null default now()
);

alter table public.automation_executions enable row level security;

create policy "automation_executions_select" on public.automation_executions
  for select to authenticated using (true);

create policy "automation_executions_insert" on public.automation_executions
  for insert to authenticated with check (true);

create policy "automation_executions_update" on public.automation_executions
  for update to authenticated
  using (true)
  with check (true);

create index automation_executions_automation_id_idx on public.automation_executions (automation_id);
create index automation_executions_status_idx on public.automation_executions (status);
create index automation_executions_entity_idx on public.automation_executions (entity_type, entity_id);
create index automation_executions_created_at_idx on public.automation_executions (created_at desc);

-- ===========================================================================
-- 3. BUSINESS HOURS
-- ===========================================================================

create table if not exists public.business_hours (
  id          uuid primary key default gen_random_uuid(),
  day_of_week int not null check (day_of_week between 0 and 6),
  is_active   boolean not null default true,
  start_time  time not null default '08:00',
  end_time    time not null default '18:00',
  timezone    text not null default 'America/Sao_Paulo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (day_of_week)
);

alter table public.business_hours enable row level security;

create policy "business_hours_select" on public.business_hours
  for select to authenticated using (true);

create policy "business_hours_insert_admin" on public.business_hours
  for insert to authenticated with check (public.is_admin());

create policy "business_hours_update_admin" on public.business_hours
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create trigger business_hours_set_updated_at
  before update on public.business_hours
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 4. SEED: default business hours (Mon-Fri 8-18)
-- ===========================================================================

insert into public.business_hours (day_of_week, is_active, start_time, end_time) values
  (0, false, '08:00', '18:00'),  -- Sunday
  (1, true, '08:00', '18:00'),   -- Monday
  (2, true, '08:00', '18:00'),   -- Tuesday
  (3, true, '08:00', '18:00'),   -- Wednesday
  (4, true, '08:00', '18:00'),   -- Thursday
  (5, true, '08:00', '18:00'),   -- Friday
  (6, false, '08:00', '18:00')   -- Saturday
on conflict (day_of_week) do nothing;

-- ===========================================================================
-- 5. SEED: initial automations (all disabled)
-- ===========================================================================

-- Automation 1: Novo Lead
insert into public.automation_rules (name, description, is_active, trigger_type, conditions, condition_logic, actions) values (
  'Novo Lead - Criar Oportunidade',
  'Quando um contato envia a primeira mensagem e não possui oportunidade aberta, criar uma oportunidade automaticamente.',
  false,
  'FIRST_MESSAGE_RECEIVED',
  '[{"field":"has_open_opportunity","operator":"equals","value":false}]'::jsonb,
  'all',
  '[
    {"type":"CREATE_OPPORTUNITY","params":{"pipeline":"Vendas","stage":"Novo","title":"Oportunidade - {{contact.name}}"}},
    {"type":"ADD_CONTACT_TAG","params":{"tag":"Novo Lead"}}
  ]'::jsonb
);

-- Automation 2: Fora do horário
insert into public.automation_rules (name, description, is_active, trigger_type, conditions, condition_logic, actions) values (
  'Fora do Horário - Resposta Automática',
  'Enviar mensagem automática quando mensagem recebida fora do horário comercial.',
  false,
  'MESSAGE_RECEIVED',
  '[{"field":"outside_business_hours","operator":"equals","value":true},{"field":"message_direction","operator":"equals","value":"inbound"}]'::jsonb,
  'all',
  '[
    {"type":"SEND_WHATSAPP_MESSAGE","params":{"message":"Olá! Recebemos sua mensagem. Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. Retornaremos assim que possível.","cooldown_hours":24}}
  ]'::jsonb
);

-- Automation 3: Proposta → Follow-up
insert into public.automation_rules (name, description, is_active, trigger_type, conditions, condition_logic, actions) values (
  'Proposta → Follow-up',
  'Quando oportunidade muda para estágio Proposta, criar follow-up para 2 dias.',
  false,
  'OPPORTUNITY_STAGE_CHANGED',
  '[{"field":"new_stage","operator":"equals","value":"Proposta"}]'::jsonb,
  'all',
  '[
    {"type":"CREATE_FOLLOWUP","params":{"title":"Fazer follow-up da proposta","delay_days":2}}
  ]'::jsonb
);

-- Automation 4: Oportunidade parada
insert into public.automation_rules (name, description, is_active, trigger_type, conditions, condition_logic, actions) values (
  'Oportunidade Parada - Follow-up',
  'Quando oportunidade fica sem atividade por 3+ dias, criar follow-up.',
  false,
  'OPPORTUNITY_IDLE',
  '[{"field":"idle_days","operator":"greater_or_equal","value":3},{"field":"status","operator":"equals","value":"open"}]'::jsonb,
  'all',
  '[
    {"type":"CREATE_FOLLOWUP","params":{"title":"Retomar contato com cliente","delay_days":0}}
  ]'::jsonb
);

-- Automation 5: Reunião concluída
insert into public.automation_rules (name, description, is_active, trigger_type, conditions, condition_logic, actions) values (
  'Reunião Concluída - Follow-up',
  'Após concluir reunião, criar follow-up para 1 dia.',
  false,
  'MEETING_COMPLETED',
  '[]'::jsonb,
  'all',
  '[
    {"type":"CREATE_FOLLOWUP","params":{"title":"Fazer retorno da reunião","delay_days":1}}
  ]'::jsonb
);

-- Automation 6: Round Robin
insert into public.automation_rules (name, description, is_active, trigger_type, conditions, condition_logic, actions) values (
  'Novo Lead - Round Robin',
  'Distribuir leads automaticamente entre vendedores.',
  false,
  'FIRST_MESSAGE_RECEIVED',
  '[{"field":"has_open_opportunity","operator":"equals","value":false}]'::jsonb,
  'all',
  '[
    {"type":"ASSIGN_OPPORTUNITY","params":{"strategy":"round_robin"}}
  ]'::jsonb
);
