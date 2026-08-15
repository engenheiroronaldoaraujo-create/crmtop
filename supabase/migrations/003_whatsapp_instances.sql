-- 003_whatsapp_instances.sql
-- WhatsApp instances. F1 manages a single row; the schema already supports N.

create table if not exists public.whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  instance_name text not null unique,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connecting', 'connected')),
  phone_number text,
  created_at timestamptz not null default now()
);

alter table public.whatsapp_instances enable row level security;

-- Any authenticated user can read instance state (chat page needs it).
drop policy if exists "whatsapp_instances_select" on public.whatsapp_instances;
create policy "whatsapp_instances_select" on public.whatsapp_instances
  for select to authenticated
  using (true);

-- Only admins can create instances (QR + connection flow).
drop policy if exists "whatsapp_instances_insert_admin" on public.whatsapp_instances;
create policy "whatsapp_instances_insert_admin" on public.whatsapp_instances
  for insert to authenticated
  with check (public.is_admin());

-- Only admins can edit instance rows.
drop policy if exists "whatsapp_instances_update_admin" on public.whatsapp_instances;
create policy "whatsapp_instances_update_admin" on public.whatsapp_instances
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Only admins can delete instance rows.
drop policy if exists "whatsapp_instances_delete_admin" on public.whatsapp_instances;
create policy "whatsapp_instances_delete_admin" on public.whatsapp_instances
  for delete to authenticated
  using (public.is_admin());

