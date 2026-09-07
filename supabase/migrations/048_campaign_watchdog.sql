-- 048_campaign_watchdog.sql
-- Watchdog de campanhas em modo direto (envio por conversa).
-- A corrente de envio é auto-invocada pela própria Edge Function; se um
-- isolate morrer no meio, nada agenda o próximo lote. Este job (pg_cron +
-- pg_net) roda a cada 2 min e re-aciona a leva de qualquer campanha
-- send_mode='direct' 'sending' cujo último lote completou há mais de 2 min
-- (cada lote atualiza campaigns.updated_at via recalc_campaign_stats,
-- portanto uma corrente viva NUNCA parece parada).
--
-- Segurança: a ação campaign-send-batch exige o token interno guardado em
-- app_secrets (service-role only); sem ele responde 401. As apikeys no job
-- são a ANON (pública), suficiente porque verify_jwt está desligado e a
-- autenticação real é o token interno. Sem campanhas travadas, nada é postado.
--
-- Nota: no Supabase, pg_cron/pg_net instalam suas funções nos schemas cron.*
-- e net.* independentemente do schema da extensão; criar "with schema X"
-- conflita com objetos já existentes, então usamos a instalação padrão.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension pg_cron;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension pg_net;
  end if;
end $$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'campaign-direct-watchdog';

select cron.schedule(
  'campaign-direct-watchdog',
  '*/2 * * * *',
  $$
    with stalled as (
      select c.id as campaign_id, s.value as internal_token
      from public.campaigns c
      join public.app_secrets s on s.key = 'zernio_internal_token'
      where c.send_mode = 'direct'
        and c.status = 'sending'
        and c.updated_at < now() - interval '2 minutes'
        and exists (
          select 1 from public.campaign_recipients cr
          where cr.campaign_id = c.id and cr.status = 'pending'
        )
      order by c.updated_at
      limit 3
    )
    select net.http_post(
      url := 'https://gboyodouyrkljqbrxohz.supabase.co/functions/v1/zernio-proxy',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdib3lvZG91eXJrbGpxYnJ4b2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTY4ODgsImV4cCI6MjEwMjkzMjg4OH0.OSZNTnjJbRlP0epjzmvyGlijAtLkwjCtqMGph2esBbg',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdib3lvZG91eXJrbGpxYnJ4b2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTY4ODgsImV4cCI6MjEwMjkzMjg4OH0.OSZNTnjJbRlP0epjzmvyGlijAtLkwjCtqMGph2esBbg'
      ),
      body := jsonb_build_object(
        'action', 'campaign-send-batch',
        'campaign_id', campaign_id,
        'internal_token', internal_token
      )
    )
    from stalled;
  $$
);
