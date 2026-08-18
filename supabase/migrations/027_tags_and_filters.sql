-- 027_tags_and_filters.sql
-- Tags system for contacts and opportunities, plus global search support.

-- ===========================================================================
-- 1. TAGS
-- ===========================================================================

create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  color       text not null default '#6b7280',
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.tags enable row level security;

create policy "tags_select" on public.tags
  for select to authenticated using (true);

create policy "tags_insert_admin" on public.tags
  for insert to authenticated with check (public.is_admin());

create policy "tags_update_admin" on public.tags
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "tags_delete_admin" on public.tags
  for delete to authenticated using (public.is_admin());

create trigger tags_set_updated_at
  before update on public.tags
  for each row execute function public.set_updated_at();

create index tags_name_idx on public.tags (name);
create index tags_is_active_idx on public.tags (is_active);

-- ===========================================================================
-- 2. CONTACT TAGS (N:N)
-- ===========================================================================

create table if not exists public.contact_tags (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag_id     uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (contact_id, tag_id)
);

alter table public.contact_tags enable row level security;

create policy "contact_tags_select" on public.contact_tags
  for select to authenticated using (true);

create policy "contact_tags_insert" on public.contact_tags
  for insert to authenticated with check (true);

create policy "contact_tags_delete" on public.contact_tags
  for delete to authenticated using (true);

create index contact_tags_contact_id_idx on public.contact_tags (contact_id);
create index contact_tags_tag_id_idx on public.contact_tags (tag_id);

-- ===========================================================================
-- 3. OPPORTUNITY TAGS (N:N)
-- ===========================================================================

create table if not exists public.opportunity_tags (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.opportunities(id) on delete cascade,
  tag_id          uuid not null references public.tags(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (opportunity_id, tag_id)
);

alter table public.opportunity_tags enable row level security;

create policy "opportunity_tags_select" on public.opportunity_tags
  for select to authenticated using (true);

create policy "opportunity_tags_insert" on public.opportunity_tags
  for insert to authenticated with check (true);

create policy "opportunity_tags_delete" on public.opportunity_tags
  for delete to authenticated using (true);

create index opportunity_tags_opportunity_id_idx on public.opportunity_tags (opportunity_id);
create index opportunity_tags_tag_id_idx on public.opportunity_tags (tag_id);

-- ===========================================================================
-- 4. SEED: initial tags
-- ===========================================================================

insert into public.tags (name, color, is_active) values
  ('Quente',      '#ef4444', true),
  ('VIP',         '#eab308', true),
  ('Alto potencial', '#f97316', true),
  ('Proposta enviada', '#3b82f6', true),
  ('Aguardando resposta', '#8b5cf6', true),
  ('Ligação solicitada', '#06b6d4', true),
  ('Urgente',     '#dc2626', true),
  ('Interessado', '#22c55e', true),
  ('Sem interesse', '#6b7280', true)
on conflict (name) do nothing;
