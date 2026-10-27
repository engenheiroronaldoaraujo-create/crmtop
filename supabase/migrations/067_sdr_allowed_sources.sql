-- 067_sdr_allowed_sources.sql
-- Permite ao usuário escolher em quais origens de mensagem o SDR pode responder
-- (organic | ad | campaign | manual). NULL = todas (compatibilidade).

alter table public.sdr_settings
  add column if not exists allowed_sources text[] not null default array['organic', 'ad', 'campaign', 'manual'];

comment on column public.sdr_settings.allowed_sources is
  'Origens de conversa em que o SDR pode responder: organic | ad | campaign | manual. Vazio = nenhuma.';
