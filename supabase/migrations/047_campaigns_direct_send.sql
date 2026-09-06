-- 047_campaigns_direct_send.sql
-- Envio "direto" por destinatário (POST /v1/inbox/conversations da Zernio).
-- Necessário para templates com variáveis NOMEADAS ({{nome}}), criados no
-- WhatsApp Manager: o engine de broadcast da Meta só resolve numeradas
-- ({{1}}), mas o envio direto aceita os valores "em ordem de aparição"
-- também para slots nomeados. O app resolve os valores por destinatário.

alter table public.campaigns
  add column if not exists send_mode text not null default 'broadcast'
    check (send_mode in ('broadcast', 'direct'));

-- Snapshot do e-mail p/ resolver variáveis (field: email) no envio direto.
alter table public.campaign_recipients
  add column if not exists email text;
