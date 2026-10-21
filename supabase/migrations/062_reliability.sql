-- 062_reliability.sql
--
-- Correções de concorrência e de estado que a auditoria encontrou.
--
--  1. `pg_cron` agenda as Edge Functions via `net.http_post`, que é
--     assíncrono: o job termina em milissegundos, mas a Edge Function pode
--     rodar minutos. Duas execuções do mesmo job podem estar vivas ao mesmo
--     tempo. `cadence-runner` e `noreply-runner` selecionavam as matrículas
--     vencidas e só atualizavam o estado DEPOIS de enviar → as duas
--     execuções mandavam a mesma mensagem duas vezes.
--     O padrão correto já existia em `060_group_posts.sql`
--     (`FOR UPDATE SKIP LOCKED`); aqui ele é aplicado aos dois runners.
--
--  2. `group_posts.status='publishing'` e
--     `group_post_engagements.dm_status='sending'` são estados terminais na
--     prática: se o runner morre entre o claim e o update, a linha fica
--     travada para sempre (post nunca publicado, DM nunca enviada, sem
--     aviso). Este migration adiciona o reaper.
--
--  3. `noreply_mark_replied` pegava o estado mais recente, que podia ser
--     'exhausted' — o 'active' anterior continuava ativo e reenviava.
--
--  4. `move_opportunity_stage` não validava que o estágio pertence ao
--     pipeline da oportunidade (integridade quebrada, sem FK composta).
--
--  5. O contador `sdr_conversations.auto_messages_count` era atualizado com
--     read-modify-write em JS: duas mensagens inbound simultâneas liam o
--     mesmo valor e o limite de mensagens da IA era furado.
--
-- Idempotente: pode ser re-executada sem efeito colateral.

-- ---------------------------------------------------------------------------
-- 1. Colunas de lock + claims atômicos
-- ---------------------------------------------------------------------------

alter table public.cadence_enrollments
  add column if not exists locked_until timestamptz;
alter table public.noreply_states
  add column if not exists locked_until timestamptz;

-- `sync_page` era compartilhado entre os dois syncs (mensagens e nomes):
-- o painel chamava `sync-names` com `reset:true` e ZERAVA o progresso do
-- sync de mensagens — as duas rotinas se sobrescreviam. Agora cada uma tem
-- seu próprio cursor.
alter table public.whatsapp_instances
  add column if not exists sync_page_names int;

create index if not exists cadence_enrollments_locked_idx
  on public.cadence_enrollments (locked_until)
  where status = 'active';
create index if not exists noreply_states_locked_idx
  on public.noreply_states (locked_until)
  where status = 'active';

-- Claim de matrículas de cadência vencidas.
-- Reserva a linha para uma única execução: as demais enxergam
-- `locked_until` no futuro e pulam. O lock expira em 15 min para que uma
-- execução morta não trave a cadência para sempre.
create or replace function public.claim_cadence_enrollments(p_limit int default 50)
returns setof public.cadence_enrollments
language sql
security definer
set search_path = public
as $$
  with due as (
    select e.id
    from public.cadence_enrollments e
    where e.status = 'active'
      and e.next_run_at is not null
      and e.next_run_at <= now()
      and (e.locked_until is null or e.locked_until < now())
    order by e.next_run_at
    limit greatest(coalesce(p_limit, 50), 1)
    for update skip locked
  )
  update public.cadence_enrollments e
     set locked_until = now() + interval '15 minutes'
    from due
   where e.id = due.id
  returning e.*;
$$;

-- Claim de réguas de follow-up vencidas. Mesmo padrão do claim de cadência.
create or replace function public.claim_noreply_states(p_limit int default 50)
returns setof public.noreply_states
language sql
security definer
set search_path = public
as $$
  with due as (
    select s.id
    from public.noreply_states s
    where s.status = 'active'
      and s.next_check_at is not null
      and s.next_check_at <= now()
      and (s.locked_until is null or s.locked_until < now())
    order by s.next_check_at
    limit greatest(coalesce(p_limit, 50), 1)
    for update skip locked
  )
  update public.noreply_states s
     set locked_until = now() + interval '15 minutes'
    from due
   where s.id = due.id
  returning s.*;
$$;

-- ---------------------------------------------------------------------------
-- 2. Reaper dos estados órfãos (publishing/sending travados)
-- ---------------------------------------------------------------------------

-- Um post marcado como 'publishing' há mais de 15 min significa que o
-- runner morreu no meio: devolve para 'scheduled' (ou 'failed', se a
-- janela já passou) para que possa ser reprocessado.
create or replace function public.reap_stuck_group_posts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.group_posts
     set status = case
                    when scheduled_at > now() then 'scheduled'::text
                    else 'failed'::text
                  end,
         updated_at = now()
   where status = 'publishing'
     and updated_at < now() - interval '15 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

-- Mesma lógica para as DMs de quem comentou.
create or replace function public.reap_stuck_group_dms()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.group_post_engagements
     set dm_status = 'pending',
         dm_error = 'reaped: runner nao concluiu o envio',
         updated_at = now()
   where dm_status = 'sending'
     and updated_at < now() - interval '15 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. noreply_mark_replied — só encerra a régua ATIVA
-- ---------------------------------------------------------------------------

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
  v_state public.noreply_states%rowtype;
begin
  -- Prioridade: a régua ATIVA é a que precisa ser encerrada. A versão
  -- anterior pegava a linha mais recente (order by created_at desc) e, se
  -- ela não fosse a ativa, a régua ativa continuava rodando e reenviava.
  select * into v_state
    from public.noreply_states
   where conversation_id = p_conversation_id
     and status = 'active'
   order by created_at desc
   limit 1;

  if v_state.id is not null then
    update public.noreply_states
       set status = 'replied',
           ended_at = now(),
           next_check_at = null,
           locked_until = null
     where id = v_state.id;

    insert into public.noreply_events (state_id, event_type, attempt, message_id, details)
    values (v_state.id, 'reply_detected', v_state.attempts_made, p_message_id,
            jsonb_build_object('attempts_made', v_state.attempts_made));
    return 'replied';
  end if;

  -- Sem régua ativa: o lead respondeu depois da régua ter esgotado.
  select * into v_state
    from public.noreply_states
   where conversation_id = p_conversation_id
     and status = 'exhausted'
   order by created_at desc
   limit 1;

  if v_state.id is not null then
    insert into public.noreply_events (state_id, event_type, attempt, message_id)
    values (v_state.id, 'reply_after_exhausted', v_state.attempts_made, p_message_id);

    if v_state.opportunity_id is not null then
      insert into public.activity_log (entity_type, entity_id, action, new_data)
      values ('opportunity', v_state.opportunity_id,
              'NOREPLY: lead respondeu após régua esgotada — revisar card no funil',
              jsonb_build_object('attempts_made', v_state.attempts_made));
    end if;
    return 'reply_after_exhausted';
  end if;

  return 'none';
end $$;

-- ---------------------------------------------------------------------------
-- 4. move_opportunity_stage — o estágio precisa ser do mesmo pipeline
-- ---------------------------------------------------------------------------

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
  v_pipeline_id  uuid;
  v_stage_pipeline uuid;
begin
  select o.stage_id, o.pipeline_id
    into v_old_stage_id, v_pipeline_id
    from public.opportunities o
   where o.id = p_opportunity_id
   for update;

  if not found then
    raise exception 'opportunity % not found', p_opportunity_id;
  end if;

  select s.pipeline_id into v_stage_pipeline
    from public.pipeline_stages s
   where s.id = p_new_stage_id;

  if v_stage_pipeline is null then
    raise exception 'stage % not found', p_new_stage_id;
  end if;

  if v_stage_pipeline <> v_pipeline_id then
    raise exception 'stage % does not belong to pipeline %', p_new_stage_id, v_pipeline_id;
  end if;

  if v_old_stage_id = p_new_stage_id then
    update public.opportunities
       set updated_at = now()
     where id = p_opportunity_id;
    return;
  end if;

  update public.opportunities
     set stage_id = p_new_stage_id,
         updated_at = now()
   where id = p_opportunity_id;

  insert into public.opportunity_stage_history (opportunity_id, old_stage_id, new_stage_id, changed_by, changed_at)
  values (p_opportunity_id, v_old_stage_id, p_new_stage_id, auth.uid(), now());
end $$;

-- ---------------------------------------------------------------------------
-- 5. Contador atômico de mensagens da IA
-- ---------------------------------------------------------------------------

-- Reserva um slot de mensagem da IA. A checagem do limite e o incremento
-- acontecem na mesma transação e sob lock de linha: duas mensagens inbound
-- simultâneas não furam mais o teto de `max_messages_per_conversation`.
--
-- Retorna true quando o slot foi reservado (a IA pode responder) e false
-- quando o limite já foi atingido.
create or replace function public.sdr_try_claim_slot(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max   int;
  v_count int;
begin
  select coalesce(max(max_messages_per_conversation), 10)
    into v_max
    from public.sdr_settings;

  select auto_messages_count into v_count
    from public.sdr_conversations
   where conversation_id = p_conversation_id
   for update;

  if v_count is null then
    -- Conversa SDR ainda não existe: o insert cria com count 0 e a
    -- próxima chamada incrementa.
    insert into public.sdr_conversations (conversation_id, auto_messages_count, last_auto_reply_at)
    values (p_conversation_id, 1, now())
    on conflict (conversation_id) do nothing;
    return true;
  end if;

  if v_count >= v_max then
    return false;
  end if;

  update public.sdr_conversations
     set auto_messages_count = v_count + 1,
         last_auto_reply_at = now()
   where conversation_id = p_conversation_id;

  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 6. lead_ensure_opportunity — criação atômica de oportunidade
-- ---------------------------------------------------------------------------

-- O `lead-webhook` fazia "SELECT da oportunidade aberta → INSERT se não
-- achou". Dois POSTs simultâneos (retry do builder, duplo clique) viam
-- ambos "sem oportunidade" e criavam DOIS cards para o mesmo lead no funil.
--
-- Aqui o contato é travado (FOR UPDATE) — serializa requisições do mesmo
-- lead — e a criação é atômica.
create or replace function public.lead_ensure_opportunity(
  p_contact_id uuid,
  p_pipeline_id uuid,
  p_stage_id uuid,
  p_title text,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Lock do contato: serializa requisições concorrentes do mesmo lead.
  perform 1 from public.contacts where id = p_contact_id for update;

  select id into v_id
    from public.opportunities
   where contact_id = p_contact_id
     and pipeline_id = p_pipeline_id
     and status = 'open'
   order by created_at desc
   limit 1;

  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', false);
  end if;

  insert into public.opportunities
    (contact_id, pipeline_id, stage_id, title, description, status, metadata)
  values
    (p_contact_id, p_pipeline_id, p_stage_id, p_title, p_description, 'open', p_metadata)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'created', true);
end $$;

-- ---------------------------------------------------------------------------
-- 7. FIRST_MESSAGE_RECEIVED determinístico
-- ---------------------------------------------------------------------------

-- O gatilho era decidido por CONTAGEM (`count(inbound) <= 1`):
--   - duas mensagens chegando em paralelo viam ambas count=2 e a regra
--     "primeira mensagem" NUNCA disparava;
--   - depois de um sync de histórico, o count já era >1 e a regra nunca mais
--     disparava para aquela conversa.
--
-- Com um flag no banco, o primeiro inbound reserva o gatilho de forma
-- atômica (UPDATE condicional) e só ele dispara.
alter table public.conversations
  add column if not exists first_inbound_seen boolean not null default false;

create or replace function public.claim_first_message(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.conversations
     set first_inbound_seen = true
   where id = p_conversation_id
     and first_inbound_seen = false
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Permissões das novas funções
-- ---------------------------------------------------------------------------

revoke execute on function public.claim_cadence_enrollments(int) from public;
revoke execute on function public.claim_noreply_states(int) from public;
revoke execute on function public.reap_stuck_group_posts() from public;
revoke execute on function public.reap_stuck_group_dms() from public;
revoke execute on function public.sdr_try_claim_slot(uuid) from public;
revoke execute on function public.lead_ensure_opportunity(uuid, uuid, uuid, text, text, jsonb) from public;
revoke execute on function public.claim_first_message(uuid) from public;

grant execute on function public.claim_cadence_enrollments(int) to service_role;
grant execute on function public.claim_noreply_states(int) to service_role;
grant execute on function public.reap_stuck_group_posts() to service_role;
grant execute on function public.reap_stuck_group_dms() to service_role;
grant execute on function public.sdr_try_claim_slot(uuid) to service_role;
grant execute on function public.lead_ensure_opportunity(uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.claim_first_message(uuid) to service_role;

grant execute on function public.move_opportunity_stage(uuid, uuid) to authenticated;
revoke execute on function public.move_opportunity_stage(uuid, uuid) from anon;
