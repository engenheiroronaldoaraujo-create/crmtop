-- 002_contacts.sql
-- Contacts: central entity. Conversations reference contacts, never the reverse.

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  push_name text,
  email text,
  notes text,
  opted_out boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keeps updated_at fresh.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

alter table public.contacts enable row level security;

-- Any authenticated user can read contacts.
drop policy if exists "contacts_select" on public.contacts;
create policy "contacts_select" on public.contacts
  for select to authenticated
  using (true);

-- Authenticated users can create contacts.
drop policy if exists "contacts_insert" on public.contacts;
create policy "contacts_insert" on public.contacts
  for insert to authenticated
  with check (true);

-- Authenticated users can edit contacts.
drop policy if exists "contacts_update" on public.contacts;
create policy "contacts_update" on public.contacts
  for update to authenticated
  using (true)
  with check (true);

-- Only admins can delete contacts.
drop policy if exists "contacts_delete_admin" on public.contacts;
create policy "contacts_delete_admin" on public.contacts
  for delete to authenticated
  using (public.is_admin());
