-- 045_zernio_connection.sql
-- Conexão WhatsApp oficial (Meta Cloud API) via Zernio.
-- A API key e o segredo do webhook vivem em app_secrets (service role only).
-- Escritas: somente Edge Functions (service role); o frontend apenas lê.

-- Linha única (singleton): o CRM opera com uma conta WhatsApp oficial.
create table if not exists public.zernio_connections (
  id           text primary key default 'default' check (id = 'default'),
  profile_id   text,
  account_id   text,
  account_name text,
  phone_number text,
  status       text not null default 'disconnected'
    check (status in ('disconnected', 'connected')),
  webhook_id   text,
  webhook_url  text,
  connected_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger zernio_connections_set_updated_at
  before update on public.zernio_connections
  for each row execute function public.set_updated_at();

alter table public.zernio_connections enable row level security;

drop policy if exists "zernio_connections_select" on public.zernio_connections;
create policy "zernio_connections_select" on public.zernio_connections
  for select to authenticated using (true);

-- Cache local dos templates da WABA (fonte da verdade é a Meta; sincronizado
-- via zernio-proxy e atualizado pelo webhook whatsapp.template.status_updated).
create table if not exists public.zernio_templates (
  id               uuid primary key default gen_random_uuid(),
  account_id       text not null,
  meta_template_id text,
  name             text not null,
  language         text not null,
  category         text,
  status           text,
  reason           text,
  components       jsonb,
  synced_at        timestamptz not null default now(),
  unique (account_id, name, language)
);

alter table public.zernio_templates enable row level security;

drop policy if exists "zernio_templates_select" on public.zernio_templates;
create policy "zernio_templates_select" on public.zernio_templates
  for select to authenticated using (true);

create index if not exists zernio_templates_status_idx
  on public.zernio_templates (status);

-- Deduplicação de webhooks (at-least-once): insert do event_id é a trava.
create table if not exists public.zernio_webhook_events (
  event_id    text primary key,
  event_type  text not null,
  payload     jsonb,
  error       text,
  received_at timestamptz not null default now()
);

alter table public.zernio_webhook_events enable row level security;

drop policy if exists "zernio_webhook_events_select_admin" on public.zernio_webhook_events;
create policy "zernio_webhook_events_select_admin" on public.zernio_webhook_events
  for select to authenticated using (public.is_admin());
