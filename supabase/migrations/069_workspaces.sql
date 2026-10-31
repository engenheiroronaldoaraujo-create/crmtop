-- 069_workspaces.sql
-- Fundação multi-clientes: workspaces + membros + invites + uso diário.
-- Evolution e IA seguem centralizados no dono (sem workspace_secrets).
-- Transcrição: ligada para todos (default google/gemini-2.5-flash-lite).

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'base' check (plan in ('base', 'pro', 'scale')),
  status text not null default 'active' check (status in ('active', 'suspended', 'cancelled')),
  max_users int not null default 5,
  max_instances int not null default 1,
  msg_mensal int not null default 5000,
  ai_credits_mensal int not null default 10000,
  feat_sdr boolean not null default true,
  feat_transcription boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'vendedor' check (role in ('owner', 'admin', 'vendedor')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'vendedor' check (role in ('admin', 'vendedor')),
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_usage_daily (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dia date not null,
  msgs_in int not null default 0,
  msgs_out int not null default 0,
  transcricoes int not null default 0,
  ai_tokens int not null default 0,
  created_at timestamptz not null default now(),
  primary key (workspace_id, dia)
);

-- Workspace default: recebe todos os dados legados no backfill (070).
insert into public.workspaces (id, name, slug, plan, status)
values ('00000000-0000-0000-0000-000000000001', 'Cliente inicial', 'default', 'pro', 'active')
on conflict (id) do nothing;

-- Membros atuais viram owner do workspace default (idempotente).
insert into public.workspace_members (workspace_id, user_id, role)
select '00000000-0000-0000-0000-000000000001', p.id, 'owner'
from public.profiles p
on conflict (workspace_id, user_id) do nothing;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.workspace_usage_daily enable row level security;

-- Helpers SECURITY DEFINER (evitam recursão de RLS, padrão do is_admin).
create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and is_platform_admin = true
  );
$$;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

revoke execute on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated, service_role;
revoke execute on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
revoke execute on function public.is_workspace_admin(uuid) from public;
grant execute on function public.is_workspace_admin(uuid) to authenticated, service_role;

-- Policies: membro vê seus workspaces; platform admin vê tudo.
drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member" on public.workspaces
  for select to authenticated
  using (public.is_platform_admin() or public.is_workspace_member(id));

drop policy if exists "workspaces_insert_platform" on public.workspaces;
create policy "workspaces_insert_platform" on public.workspaces
  for insert to authenticated with check (public.is_platform_admin());

drop policy if exists "workspaces_update_admin" on public.workspaces;
create policy "workspaces_update_admin" on public.workspaces
  for update to authenticated
  using (public.is_platform_admin() or public.is_workspace_admin(id))
  with check (public.is_platform_admin() or public.is_workspace_admin(id));

drop policy if exists "members_select_own" on public.workspace_members;
create policy "members_select_own" on public.workspace_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin() or public.is_workspace_admin(workspace_id));

drop policy if exists "members_write_admin" on public.workspace_members;
create policy "members_write_admin" on public.workspace_members
  for insert to authenticated with check (public.is_platform_admin() or public.is_workspace_admin(workspace_id));

drop policy if exists "members_update_admin" on public.workspace_members;
create policy "members_update_admin" on public.workspace_members
  for update to authenticated
  using (public.is_platform_admin() or public.is_workspace_admin(workspace_id))
  with check (public.is_platform_admin() or public.is_workspace_admin(workspace_id));

drop policy if exists "members_delete_admin" on public.workspace_members;
create policy "members_delete_admin" on public.workspace_members
  for delete to authenticated
  using (public.is_platform_admin() or public.is_workspace_admin(workspace_id));

drop policy if exists "invites_select_admin" on public.workspace_invites;
create policy "invites_select_admin" on public.workspace_invites
  for select to authenticated
  using (public.is_platform_admin() or public.is_workspace_admin(workspace_id));

drop policy if exists "invites_write_admin" on public.workspace_invites;
create policy "invites_write_admin" on public.workspace_invites
  for insert to authenticated with check (public.is_platform_admin() or public.is_workspace_admin(workspace_id));

drop policy if exists "invites_delete_admin" on public.workspace_invites;
create policy "invites_delete_admin" on public.workspace_invites
  for delete to authenticated
  using (public.is_platform_admin() or public.is_workspace_admin(workspace_id));

drop policy if exists "usage_select" on public.workspace_usage_daily;
create policy "usage_select" on public.workspace_usage_daily
  for select to authenticated
  using (public.is_platform_admin() or public.is_workspace_member(workspace_id));
