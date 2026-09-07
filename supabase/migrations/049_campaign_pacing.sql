-- 049_campaign_pacing.sql
-- Ritmo de envio (anti rate-limit #80008 da Meta): a campanha em modo direto
-- envia `pacing_batch_size` mensagens por leva e pausa
-- `pacing_interval_seconds` antes da próxima. A pausa NÃO dorme dentro da
-- Edge Function: a leva grava `next_hop_at = now() + intervalo` e o watchdog
-- (pg_cron, agora a cada 1 min) re-invoca o lote quando a hora chega.
--
-- Durante o cooldown de 80008 (zernio_meta_cooldown_until em app_secrets) a
-- leva retorna sem chamar o gateway, então o watchdog também serve de
-- retomada automática quando o bloqueio da Meta expira.
--
-- Defaults: 5 mensagens a cada 2 minutos (~150/h — muito abaixo do limite
-- por minuto do WABA que dispara o 80008). Configurável por campanha na
-- criação (pacing_batch_size 1–100, pacing_interval_seconds 0–3600; 0 =
-- retoma na próxima passada do cron, ~1 min).

alter table public.campaigns
  add column if not exists pacing_batch_size integer not null default 5,
  add column if not exists pacing_interval_seconds integer not null default 120,
  add column if not exists next_hop_at timestamptz;

create index if not exists campaigns_next_hop_idx
  on public.campaigns (next_hop_at)
  where next_hop_at is not null;

-- Watchdog v2 (substitui o job da 048): aciona campanhas com hora marcada
-- (next_hop_at <= now) OU correntes mortas (updated_at antigo). O "claim"
-- zera next_hop_at e atualiza updated_at no mesmo UPDATE, para a leva não
-- ser disparada duas vezes e para correntes vivas nunca parecerem paradas.
select cron.unschedule(jobid)
from cron.job
where jobname = 'campaign-direct-watchdog';

select cron.schedule(
  'campaign-direct-watchdog',
  '* * * * *',
  $$
    with claimed as (
      update public.campaigns c
      set next_hop_at = null,
          updated_at = now()
      where c.id in (
        select c2.id
        from public.campaigns c2
        where c2.send_mode = 'direct'
          and c2.status = 'sending'
          and (
            (c2.next_hop_at is not null and c2.next_hop_at <= now())
            or (c2.next_hop_at is null and c2.updated_at < now() - interval '2 minutes')
          )
          and exists (
            select 1 from public.campaign_recipients cr
            where cr.campaign_id = c2.id and cr.status = 'pending'
          )
        order by c2.updated_at
        limit 3
      )
      returning c.id as campaign_id
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
        'internal_token', (
          select s.value from public.app_secrets s
          where s.key = 'zernio_internal_token'
          limit 1
        )
      )
    )
    from claimed;
  $$
);
