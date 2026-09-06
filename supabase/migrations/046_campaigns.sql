-- 046_campaigns.sql
-- Campanhas de WhatsApp via broadcast da Zernio (templates aprovados pela Meta).
-- Toda escrita passa pelas Edge Functions (zernio-proxy / zernio-webhook);
-- o frontend apenas lê.

create table if not exists public.campaigns (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  zernio_broadcast_id text unique,
  template_name       text not null,
  template_language   text not null,
  -- {"1":{"field":"name"},"2":{"field":"custom","customValue":"VIP"}}
  variable_mapping    jsonb not null default '{}'::jsonb,
  status              text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'completed', 'failed', 'cancelled')),
  scheduled_at        timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  recipient_count     integer not null default 0,
  sent_count          integer not null default 0,
  delivered_count     integer not null default 0,
  read_count          integer not null default 0,
  failed_count        integer not null default 0,
  last_error          text,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

alter table public.campaigns enable row level security;

drop policy if exists "campaigns_select" on public.campaigns;
create policy "campaigns_select" on public.campaigns
  for select to authenticated using (true);

create table if not exists public.campaign_recipients (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references public.campaigns(id) on delete cascade,
  contact_id          uuid references public.contacts(id) on delete set null,
  phone               text not null, -- dígitos E.164 sem "+" (padrão dos contatos)
  name                text,
  zernio_recipient_id text,
  zernio_message_id   text,
  status              text not null default 'pending'
    check (status in ('pending', 'sent', 'delivered', 'read', 'failed')),
  error               text,
  error_code          integer,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (campaign_id, phone)
);

alter table public.campaign_recipients enable row level security;

drop policy if exists "campaign_recipients_select" on public.campaign_recipients;
create policy "campaign_recipients_select" on public.campaign_recipients
  for select to authenticated using (true);

create index if not exists campaign_recipients_campaign_status_idx
  on public.campaign_recipients (campaign_id, status);

create index if not exists campaign_recipients_message_id_idx
  on public.campaign_recipients (zernio_message_id)
  where zernio_message_id is not null;

create index if not exists campaigns_status_idx on public.campaigns (status);

-- Recalcula os contadores da campanha a partir dos destinatários.
-- Idempotente: chamado pelo webhook e pelo sync periódico.
create or replace function public.recalc_campaign_stats(p_campaign_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.campaigns c
  set recipient_count = s.total,
      sent_count      = s.sent,
      delivered_count = s.delivered,
      read_count      = s.read,
      failed_count    = s.failed
  from (
    select
      count(*)::int                                                        as total,
      count(*) filter (where status in ('sent', 'delivered', 'read'))::int as sent,
      count(*) filter (where status in ('delivered', 'read'))::int         as delivered,
      count(*) filter (where status = 'read')::int                         as read,
      count(*) filter (where status = 'failed')::int                       as failed
    from public.campaign_recipients
    where campaign_id = p_campaign_id
  ) s
  where c.id = p_campaign_id;
$$;
