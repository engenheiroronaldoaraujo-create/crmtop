-- 059_noreply_backfill.sql
-- Recuperação de leads antigos pela régua de follow-up sem resposta.
--
-- O runner normal só matricula silêncios dentro do horizonte (~soma dos
-- delays + tolerância, ~14 dias no padrão) para evitar rajada retroativa ao
-- ativar o recurso. Esta RPC dá ao admin um botão controlado para matricular
-- um lote antigo: conversas com silêncio de até N dias (janela editável),
-- pulando o horizonte — mantendo TODOS os guardrails do detector (opt-out,
-- SDR IA no comando, oportunidade open em pipeline habilitado, card fora do
-- estágio de destino, anti-loop pós-esgotamento, unique de estado ativo).
--
-- Sem rajada: a 1ª tentativa é agendada a partir de AGORA (now + delay da
-- tentativa 1) e não do passado — um lote de 200 leads entra no ritmo normal
-- do runner (50 envios/execução, horário comercial, fim de semana).
--
-- Idempotente (ON CONFLICT DO NOTHING no unique parcial de estado ativo) e
-- auditável (evento 'started' com source=backfill em cada matrícula).

create or replace function public.noreply_backfill(
  p_days int default 30,
  p_limit int default 200
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_delay int;
  v_limit int;
  v_count int := 0;
  v_state_id uuid;
  v_next_check timestamptz;
  c record;
begin
  -- Só admin (a UI da régua também é admin-only; fail closed).
  if not public.is_admin() then
    raise exception 'forbidden: apenas administradores podem executar o backfill';
  end if;

  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'janela inválida: informe de 1 a 365 dias';
  end if;

  -- A régua precisa estar ligada: senão os estados criados nunca executam.
  if not exists (select 1 from public.noreply_settings where is_active) then
    raise exception 'régua desligada: ative em Configurações → Follow-up sem resposta';
  end if;

  select a.delay_hours into v_first_delay
  from public.noreply_attempts a
  where a.is_active
  order by a.attempt_number
  limit 1;
  if v_first_delay is null then
    raise exception 'nenhuma tentativa ativa configurada';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_next_check := now() + make_interval(hours => v_first_delay);

  for c in
    select
      d.r_conversation_id,
      d.r_contact_id,
      d.r_opportunity_id,
      d.r_last_message_at
    from public.noreply_detect_candidates(2000) d
    where d.r_last_message_at >= now() - make_interval(days => p_days)
    order by d.r_last_message_at desc
    limit v_limit
  loop
    insert into public.noreply_states (
      conversation_id, contact_id, opportunity_id,
      attempts_made, status, next_check_at, next_delay_hours
    ) values (
      c.r_conversation_id, c.r_contact_id, c.r_opportunity_id,
      0, 'active',
      v_next_check,
      v_first_delay
    )
    on conflict do nothing
    returning id into v_state_id;

    if found then
      v_count := v_count + 1;
      insert into public.noreply_events (state_id, event_type, attempt, details)
      values (v_state_id, 'started', 0, jsonb_build_object(
        'source', 'backfill',
        'window_days', p_days,
        'last_message_at', c.r_last_message_at,
        'next_check_at', v_next_check
      ));
    end if;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.noreply_backfill(integer, integer) to authenticated;
revoke execute on function public.noreply_backfill(integer, integer) from anon;
