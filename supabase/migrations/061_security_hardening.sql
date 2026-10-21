-- 061_security_hardening.sql
--
-- Fecha buracos de autorização e de integridade que a auditoria encontrou:
--
--  1. 14 funções SECURITY DEFINER sem `revoke execute ... from public`.
--     O Supabase aplica `grant all on functions to postgres, anon,
--     authenticated, service_role` como default privilege: omitir um GRANT
--     NÃO restringe acesso, só o REVOKE restringe. Sem isso, um cliente sem
--     sessão (a anon key é pública no bundle do front) podia chamar
--     `claim_group_posts`, `bump_conversation`, `update_message_status`,
--     `noreply_mark_replied`, `increment_sdr_count` etc.
--
--  2. Policies de SELECT com `using (true)` expunham o prompt da IA
--     (`sdr_settings`), a base de telefones das campanhas
--     (`campaign_recipients`), os dados da conta Meta (`zernio_connections`)
--     e o histórico de IA (`sdr_logs`) para qualquer usuário autenticado.
--     Os guards de rota do frontend são cosméticos; a proteção real é a RLS.
--
--  3. `contacts.phone` e `contacts.lid` não tinham CHECK de formato: foi o
--     que gerou 13 migrations de reparo (013, 016..024, 040, 042). A regra
--     de identidade do contato precisa estar no banco, não só no app.
--
--  4. FKs sem ON DELETE deixavam as policies de DELETE como letra morta
--     ("Excluir contato" falhava por violação de FK).
--
--  5. Índices faltando para as queries quentes (seq scan em `contacts` na
--     busca com ILIKE, seq scan em `opportunities` no join da régua noreply).
--
-- Idempotente: pode ser re-executada sem efeito colateral.

-- ---------------------------------------------------------------------------
-- 1. REVOKE EXECUTE das funções privileged
-- ---------------------------------------------------------------------------

-- Recebem apenas chamadas internas (webhook / runners / edge functions),
-- que rodam com service role.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      -- triggers nunca são chamados via SQL por clients
      and not exists (
        select 1 from pg_trigger t
        where t.tgfoid = p.oid and not t.tgisinternal
      )
  loop
    execute format('revoke execute on function %s from public', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end $$;

-- As funções que o frontend chama direto via supabase-js (RPC) precisam
-- continuar acessíveis a `authenticated`, mas não a `anon`.
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.move_opportunity_stage(uuid, uuid) to authenticated;
grant execute on function public.complete_task(uuid) to authenticated;
grant execute on function public.noreply_backfill(integer, integer) to authenticated;

revoke execute on function public.mark_conversation_read(uuid) from anon;
revoke execute on function public.move_opportunity_stage(uuid, uuid) from anon;
revoke execute on function public.complete_task(uuid) from anon;
revoke execute on function public.noreply_backfill(integer, integer) from anon;

-- `is_admin()` também é privileged: anon não precisa chamá-la.
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

-- `is_valid_br_phone` foi criada sem qualificar o schema (022) — depende do
-- search_path da sessão. Recria em public e remove a órfã se existir.
create or replace function public.is_valid_br_phone(p text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
DECLARE
  digits  text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  ddd     int;
  body    text;
  valid_ddds int[] := ARRAY[
    11,12,13,14,15,16,17,18,19,
    21,22,24,27,28,
    31,32,33,34,35,37,38,
    41,42,43,44,45,46,47,48,49,
    51,53,54,55,
    61,62,63,64,65,66,67,68,69,
    71,73,74,75,77,79,
    81,82,83,84,85,86,87,88,89,
    91,92,93,94,95,96,97,98,99
  ];
begin
  if digits is null or digits = '' then
    return false;
  end if;
  -- 12 ou 13 dígitos com o DDI 55 na frente.
  if length(digits) >= 12 and substring(digits from 1 for 2) = '55' then
    digits := substring(digits from 3);
  end if;
  if length(digits) < 10 or length(digits) > 11 then
    return false;
  end if;
  ddd := substring(digits from 1 for 2)::int;
  body := substring(digits from 3);
  if not (ddd = any (valid_ddds)) then
    return false;
  end if;
  -- Assinante sempre começa com 2-9.
  if substring(body from 1 for 1)::int < 2 or substring(body from 1 for 1)::int > 9 then
    return false;
  end if;
  -- Nove dígitos: o primeiro depois do DDD precisa ser 9.
  if length(body) = 9 and substring(body from 1 for 1) <> '9' then
    return false;
  end if;
  return true;
end $$;

revoke execute on function public.is_valid_br_phone(text) from public;
grant execute on function public.is_valid_br_phone(text) to service_role;

do $$
begin
  if to_regprocedure('is_valid_br_phone(text)') is not null then
    drop function if exists is_valid_br_phone(text);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Policies de SELECT — só admin vê config sensível e PII de campanha
-- ---------------------------------------------------------------------------

drop policy if exists "sdr_settings_select" on public.sdr_settings;
create policy "sdr_settings_select" on public.sdr_settings
  for select to authenticated using (public.is_admin());

drop policy if exists "sdr_logs_select" on public.sdr_logs;
create policy "sdr_logs_select" on public.sdr_logs
  for select to authenticated using (public.is_admin());

drop policy if exists "campaigns_select" on public.campaigns;
create policy "campaigns_select" on public.campaigns
  for select to authenticated using (public.is_admin());

drop policy if exists "campaign_recipients_select" on public.campaign_recipients;
create policy "campaign_recipients_select" on public.campaign_recipients
  for select to authenticated using (public.is_admin());

drop policy if exists "zernio_connections_select" on public.zernio_connections;
create policy "zernio_connections_select" on public.zernio_connections
  for select to authenticated using (public.is_admin());

-- `sdr_conversations` é lido pelo Chat (badge de pausa da IA) por qualquer
-- usuário, mas escrita é restrita: só service role muda estado da IA.
drop policy if exists "sdr_conversations_update" on public.sdr_conversations;
create policy "sdr_conversations_update" on public.sdr_conversations
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- `noreply_states`: o Chat mostra o badge "tentativa N/total" para qualquer
-- usuário, mas o estado da régua é controlado pelo runner (service role).
drop policy if exists "noreply_states_update" on public.noreply_states;
create policy "noreply_states_update" on public.noreply_states
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- `conversations.update` com `with check (true)` permitia inflar
-- `unread_count` arbitrariamente e reescrever o preview. O preview e o
-- contador são mantidos pelo webhook (service role); o cliente só precisa
-- zerar o unread via RPC.
drop policy if exists "conversations_update" on public.conversations;
create policy "conversations_update" on public.conversations
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. CHECK de formato em contacts (identidade canônica no banco)
-- ---------------------------------------------------------------------------

do $$
declare
  bad_count int;
begin
  -- Telefone vazio não pode existir (o UNIQUE permitiria só um).
  select count(*) into bad_count
  from public.contacts
  where phone = '' or (phone is not null and phone !~ '^[0-9]{10,13}$');
  if bad_count > 0 then
    raise exception
      'contacts com telefone inválido: %. Rode a limpeza antes (migrations 013/022/040/042).',
      bad_count;
  end if;
end $$;

alter table public.contacts
  drop constraint if exists contacts_phone_format;
alter table public.contacts
  add constraint contacts_phone_format
  check (phone is null or phone ~ '^[0-9]{10,13}$');

alter table public.contacts
  drop constraint if exists contacts_lid_format;
alter table public.contacts
  add constraint contacts_lid_format
  check (lid is null or lid like 'lid:%');

-- ---------------------------------------------------------------------------
-- 4. FKs com ON DELETE coerente (as policies de DELETE passam a funcionar)
-- ---------------------------------------------------------------------------
--
-- As FKs existentes são NO ACTION, o que já impede órfãos: nenhum DELETE
-- recursivo é necessário aqui.

alter table public.conversations
  drop constraint if exists conversations_contact_id_fkey;
alter table public.conversations
  add constraint conversations_contact_id_fkey
  foreign key (contact_id) references public.contacts(id) on delete cascade;

alter table public.conversations
  drop constraint if exists conversations_instance_id_fkey;
alter table public.conversations
  add constraint conversations_instance_id_fkey
  foreign key (instance_id) references public.whatsapp_instances(id) on delete cascade;

alter table public.messages
  drop constraint if exists messages_conversation_id_fkey;
alter table public.messages
  add constraint messages_conversation_id_fkey
  foreign key (conversation_id) references public.conversations(id) on delete cascade;

alter table public.opportunities
  drop constraint if exists opportunities_contact_id_fkey;
alter table public.opportunities
  add constraint opportunities_contact_id_fkey
  foreign key (contact_id) references public.contacts(id) on delete cascade;

alter table public.opportunities
  drop constraint if exists opportunities_pipeline_id_fkey;
alter table public.opportunities
  add constraint opportunities_pipeline_id_fkey
  foreign key (pipeline_id) references public.pipelines(id) on delete cascade;

alter table public.opportunities
  drop constraint if exists opportunities_stage_id_fkey;
alter table public.opportunities
  add constraint opportunities_stage_id_fkey
  foreign key (stage_id) references public.pipeline_stages(id) on delete cascade;

alter table public.pipeline_stages
  drop constraint if exists pipeline_stages_pipeline_id_fkey;
alter table public.pipeline_stages
  add constraint pipeline_stages_pipeline_id_fkey
  foreign key (pipeline_id) references public.pipelines(id) on delete cascade;

alter table public.opportunity_tasks
  drop constraint if exists opportunity_tasks_contact_id_fkey;
alter table public.opportunity_tasks
  add constraint opportunity_tasks_contact_id_fkey
  foreign key (contact_id) references public.contacts(id) on delete cascade;

alter table public.meetings
  drop constraint if exists meetings_contact_id_fkey;
alter table public.meetings
  add constraint meetings_contact_id_fkey
  foreign key (contact_id) references public.contacts(id) on delete cascade;

alter table public.opportunity_stage_history
  drop constraint if exists opportunity_stage_history_opportunity_id_fkey;
alter table public.opportunity_stage_history
  add constraint opportunity_stage_history_opportunity_id_fkey
  foreign key (opportunity_id) references public.opportunities(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 5. Índices que faltavam
-- ---------------------------------------------------------------------------

-- Busca global/contatos usa `ilike '%termo%'`: sem trigram é seq scan.
create extension if not exists pg_trgm;

create index if not exists contacts_name_trgm_idx
  on public.contacts using gin (name gin_trgm_ops);
create index if not exists contacts_push_name_trgm_idx
  on public.contacts using gin (push_name gin_trgm_ops);
create index if not exists contacts_email_trgm_idx
  on public.contacts using gin (email gin_trgm_ops);

-- A régua noreply faz join `opportunities.conversation_id = conversations.id`.
create index if not exists opportunities_conversation_id_idx
  on public.opportunities (conversation_id)
  where conversation_id is not null;

-- Anti-spam do idle-watchdog consulta por (entity_id) filtrando trigger.
create index if not exists automation_executions_entity_trigger_idx
  on public.automation_executions (entity_id, trigger_event)
  where trigger_event = 'OPPORTUNITY_IDLE';

-- Kanban: filtro por pipeline + ordenação por data de criação.
create index if not exists opportunities_pipeline_created_idx
  on public.opportunities (pipeline_id, created_at desc);

-- Inbox "minhas conversas": filtro por responsável + status + recência.
create index if not exists conversations_assignee_status_recent_idx
  on public.conversations (assigned_to, status, last_message_at desc);

-- FKs sem índice (Postgres não cria índice para FK).
create index if not exists deal_insights_conversation_id_idx
  on public.deal_insights (conversation_id);
create index if not exists deal_insights_contact_id_idx
  on public.deal_insights (contact_id);
create index if not exists sdr_conversations_contact_id_idx
  on public.sdr_conversations (contact_id);
create index if not exists campaign_recipients_contact_id_idx
  on public.campaign_recipients (contact_id);
create index if not exists group_post_engagements_contact_id_idx
  on public.group_post_engagements (contact_id);
create index if not exists noreply_states_contact_id_idx
  on public.noreply_states (contact_id);

-- 5 índices redundantes (duplicam constraints UNIQUE já existentes).
drop index if exists public.conversations_contact_instance_unique;
drop index if exists public.contacts_lid_idx;
drop index if exists public.tags_name_idx;
drop index if exists public.sdr_conversations_conversation_id_idx;
drop index if exists public.cadence_steps_cadence_id_idx;

-- ---------------------------------------------------------------------------
-- 6. Seeds idempotentes (replay de migration não pode duplicar)
-- ---------------------------------------------------------------------------

insert into public.automation_rules (name, description, is_active, trigger_type, conditions, condition_logic, actions)
select
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
where not exists (
  select 1 from public.automation_rules where name = 'Novo Lead - Criar Oportunidade'
);

insert into public.automation_rules (name, description, is_active, trigger_type, conditions, condition_logic, actions)
select
  'Fora do Horário - Resposta Automática',
  'Enviar mensagem automática quando mensagem recebida fora do horário comercial.',
  false,
  'MESSAGE_RECEIVED',
  '[{"field":"outside_business_hours","operator":"equals","value":true},{"field":"message_direction","operator":"equals","value":"inbound"}]'::jsonb,
  'all',
  '[
    {"type":"SEND_WHATSAPP_MESSAGE","params":{"message":"Olá! Recebemos sua mensagem. Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. Retornaremos assim que possível.","cooldown_hours":24}}
  ]'::jsonb
where not exists (
  select 1 from public.automation_rules where name = 'Fora do Horário - Resposta Automática'
);

insert into public.automation_rules (name, description, is_active, trigger_type, conditions, condition_logic, actions)
select
  'Proposta → Follow-up',
  'Quando oportunidade muda para estágio Proposta, criar follow-up para 2 dias.',
  false,
  'OPPORTUNITY_STAGE_CHANGED',
  '[{"field":"new_stage","operator":"equals","value":"Proposta"}]'::jsonb,
  'all',
  '[
    {"type":"CREATE_TASK","params":{"title":"Follow-up da proposta","days":2}}
  ]'::jsonb
where not exists (
  select 1 from public.automation_rules where name = 'Proposta → Follow-up'
);

insert into public.presentation_slots (day_of_week, start_time, end_time)
select v.day_of_week, v.start_time, v.end_time
from (values
  (1, '09:00'::time, '12:00'::time), (1, '14:00'::time, '18:00'::time),
  (2, '09:00'::time, '12:00'::time), (2, '14:00'::time, '18:00'::time),
  (3, '09:00'::time, '12:00'::time), (3, '14:00'::time, '18:00'::time),
  (4, '09:00'::time, '12:00'::time), (4, '14:00'::time, '18:00'::time),
  (5, '09:00'::time, '12:00'::time), (5, '14:00'::time, '18:00'::time)
) as v(day_of_week, start_time, end_time)
where not exists (
  select 1 from public.presentation_slots s
  where s.day_of_week = v.day_of_week
    and s.start_time = v.start_time
    and s.end_time = v.end_time
);

insert into public.sdr_schedule (day_of_week, start_time, end_time, is_active)
select v.day_of_week, v.start_time, v.end_time, true
from (values
  (1, '08:00'::time, '18:00'::time),
  (2, '08:00'::time, '18:00'::time),
  (3, '08:00'::time, '18:00'::time),
  (4, '08:00'::time, '18:00'::time),
  (5, '08:00'::time, '18:00'::time)
) as v(day_of_week, start_time, end_time)
where not exists (
  select 1 from public.sdr_schedule s
  where s.day_of_week = v.day_of_week
    and s.start_time = v.start_time
    and s.end_time = v.end_time
);

-- `sdr_settings` é singleton. Se o seed foi re-executado, sobraram linhas
-- extras e o app lia uma linha arbitrária (`.limit(1).single()`): mantém a
-- mais recentemente atualizada e descarta as duplicatas.
delete from public.sdr_settings s
where s.id <> (
  select id from public.sdr_settings order by updated_at desc nulls last, id limit 1
);

create unique index if not exists sdr_settings_single_row_idx
  on public.sdr_settings ((true));
