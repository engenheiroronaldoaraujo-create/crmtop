-- 074_remove_unused_features.sql
-- Produto enxuto: SDR de campanhas Google/Meta → WhatsApp.
-- Remove os módulos que ficaram de fora do escopo: grupos, cadências,
-- régua "sem resposta", automações, campanhas/broadcast Zernio, deal
-- inspector, APK e o fluxo de convites de workspace (nunca foi ligado).
--
-- ATENÇÃO: migrations destrutiva. Só executar depois do backup e com as Edge
-- Functions correspondentes já removidas do deploy (o código novo não chama
-- mais nenhum destes objetos). Migrations antigas NÃO foram editadas.

-- ---------------------------------------------------------------------------
-- 1. Jobs do pg_cron
-- ---------------------------------------------------------------------------

select cron.unschedule(jobid) from cron.job
where jobname in (
  'campaign-direct-watchdog',
  'cadence-runner',
  'noreply-runner',
  'idle-watchdog',
  'group-publisher',
  'group-dm-runner'
);

-- ---------------------------------------------------------------------------
-- 2. Funções auxiliares (caem antes das tabelas para evitar dependências)
-- ---------------------------------------------------------------------------

drop function if exists public.recalc_campaign_stats(uuid);
drop function if exists public.idle_watchdog_candidates();
drop function if exists public.noreply_detect_candidates();
drop function if exists public.noreply_mark_replied(uuid, uuid);
drop function if exists public.noreply_touch(uuid, timestamptz);
drop function if exists public.noreply_backfill();
drop function if exists public.claim_cadence_enrollments(int);
drop function if exists public.claim_noreply_states(int);
drop function if exists public.claim_group_posts(int);
drop function if exists public.claim_group_dms(int);
drop function if exists public.reap_stuck_group_posts();
drop function if exists public.reap_stuck_group_dms();
drop function if exists public.recalc_group_post_stats(uuid);

-- ---------------------------------------------------------------------------
-- 3. Tabelas
-- ---------------------------------------------------------------------------

drop table if exists public.group_post_engagements cascade;
drop table if exists public.group_posts cascade;
drop table if exists public.cadence_executions cascade;
drop table if exists public.cadence_enrollments cascade;
drop table if exists public.cadence_steps cascade;
drop table if exists public.cadences cascade;
drop table if exists public.noreply_events cascade;
drop table if exists public.noreply_attempts cascade;
drop table if exists public.noreply_states cascade;
drop table if exists public.noreply_pipeline_configs cascade;
drop table if exists public.noreply_settings cascade;
drop table if exists public.automation_executions cascade;
drop table if exists public.automation_rules cascade;
drop table if exists public.business_hours cascade;
drop table if exists public.idle_watchdog_settings cascade;
drop table if exists public.campaign_recipients cascade;
drop table if exists public.campaigns cascade;
drop table if exists public.zernio_webhook_events cascade;
drop table if exists public.zernio_templates cascade;
drop table if exists public.zernio_connections cascade;
drop table if exists public.deal_insights cascade;
drop table if exists public.workspace_invites cascade;

-- ---------------------------------------------------------------------------
-- 4. Storage do APK (o app é PWA; o download de APK sai da tela de login)
-- ---------------------------------------------------------------------------
-- O Supabase bloqueia DELETE direto em storage.objects/storage.buckets
-- (storage.protect_delete). O bucket vazio `apk-releases` foi removido via
-- Storage API (DELETE /storage/v1/bucket/apk-releases) com a chave de serviço.
-- Não repetir aqui: a migration falharia com SQLSTATE 42501.
