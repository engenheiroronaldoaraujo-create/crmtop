-- 033_pipeline_seed.sql
-- Align default pipeline stages with Sofia → Vendedor handoff flow.
-- Idempotent: uses DO $$ + UPDATE by position, safe to re-run.

do $$
declare
  v_pipeline_id uuid;
begin
  -- Find the default pipeline
  select id into v_pipeline_id
  from public.pipelines
  where is_default = true
  limit 1;

  if v_pipeline_id is null then
    raise notice 'No default pipeline found, skipping stage rename';
    return;
  end if;

  -- pos 1: Novo → Novo Lead (Sofia cold handoff target)
  update public.pipeline_stages
  set name = 'Novo Lead', color = '#94a3b8'
  where pipeline_id = v_pipeline_id and position = 1 and name = 'Novo';

  -- pos 2: Qualificação → Qualificado (Sofia warm/hot handoff target)
  update public.pipeline_stages
  set name = 'Qualificado', color = '#3b82f6'
  where pipeline_id = v_pipeline_id and position = 2 and name = 'Qualificação';

  -- pos 3: Contato Realizado → Contato Feito
  update public.pipeline_stages
  set name = 'Contato Feito', color = '#8b5cf6'
  where pipeline_id = v_pipeline_id and position = 3 and name = 'Contato Realizado';

  -- pos 4: Reunião → Demo
  update public.pipeline_stages
  set name = 'Demo', color = '#f59e0b'
  where pipeline_id = v_pipeline_id and position = 4 and name = 'Reunião';

  -- pos 5: Proposta (unchanged name, update color)
  update public.pipeline_stages
  set color = '#f97316'
  where pipeline_id = v_pipeline_id and position = 5 and name = 'Proposta';

  -- pos 6: Negociação (unchanged name, update color)
  update public.pipeline_stages
  set color = '#06b6d4'
  where pipeline_id = v_pipeline_id and position = 6 and name = 'Negociação';

  -- pos 7: Ganho (unchanged)
  -- pos 8: Perdido (unchanged)

  raise notice 'Pipeline stages aligned with SDR handoff flow';
end $$;
