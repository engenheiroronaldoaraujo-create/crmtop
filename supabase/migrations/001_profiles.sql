-- 001_profiles.sql
-- Profiles: extends auth.users with CRM-specific fields.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'vendedor'
    check (role in ('admin', 'vendedor')),
  is_platform_admin boolean not null default false,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Creates the profile row on signup. Admin-created users carry their intended
-- role in user_metadata (set by the admin-users Edge Function). Public signup is
-- disabled, so only server-side created users ever hit this trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), ''),
    case
      when new.raw_user_meta_data ->> 'role' in ('admin', 'vendedor')
        then new.raw_user_meta_data ->> 'role'
      else 'vendedor'
    end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admin check helper. SECURITY DEFINER (owner = postgres) so it bypasses RLS
-- internally and NEVER recurses. NOTE: an inline
-- `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')`
-- inside a policy on `profiles` triggers Postgres
-- "infinite recursion detected in policy" (verified on PG 17), so all admin
-- policies must route the check through this function.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;

-- Users read their own profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

-- Users edit their own profile, but can never self-promote to admin and can
-- never flag themselves as platform admin (role stays 'vendedor').
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = 'vendedor'
    and is_platform_admin = false
  );

-- Admins read all profiles (drives the users management page).
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select to authenticated
  using (public.is_admin());

-- Shared inbox: every team member can read the team (names are needed to
-- assign conversations and to display assignees). UPDATE stays locked to
-- self/admin — reading names does not allow changing roles or data.
drop policy if exists "profiles_select_team" on public.profiles;
create policy "profiles_select_team" on public.profiles
  for select to authenticated
  using (true);

-- Admins update any profile (role changes, etc.).
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No insert/delete policies: profiles are created by the trigger and never
-- deleted (preserves message history and assignment references).
