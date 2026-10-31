-- 068_conversation_source_landing.sql
-- Separa "landing page" (lead-webhook) de "campaign" (disparos Zernio).
-- Antes os leads do formulário caíam em source='campaign', o que impedia
-- filtrar o chat por Landing e configurar o SDR só para landing.
--
-- 1. Amplia o CHECK de conversations.source com 'landing'.
-- 2. Backfill: as 8 conversas campaign vindas do lead-webhook viram landing.
-- 3. Default de sdr_settings.allowed_sources passa a incluir landing.

alter table public.conversations
  drop constraint if exists conversations_source_check;

alter table public.conversations
  add constraint conversations_source_check
  check (source in ('organic', 'ad', 'campaign', 'landing', 'manual'));

comment on column public.conversations.source is
  'Origem da conversa: organic | ad (anúncio Meta) | campaign (disparo Zernio) | landing (formulário lead-webhook) | manual.';

-- Backfill: tudo que nasceu do lead-webhook era campaign por falta da opção.
update public.conversations
set source = 'landing'
where source = 'campaign'
  and (
    source_meta->>'origin' = 'landing'
    or source_meta->>'created_via' = 'lead-webhook'
  );

-- Novos projetos / reset local já nascem com landing no default.
alter table public.sdr_settings
  alter column allowed_sources set default array['organic', 'ad', 'campaign', 'landing', 'manual'];

comment on column public.sdr_settings.allowed_sources is
  'Origens de conversa em que o SDR pode responder: organic | ad | campaign | landing | manual. Vazio = nenhuma.';
