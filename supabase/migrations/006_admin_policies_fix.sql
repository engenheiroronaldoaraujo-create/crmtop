-- 006_admin_policies_fix.sql
-- Fix for Postgres 17 "infinite recursion detected in policy for relation
-- 'profiles'". Inline `EXISTS (SELECT 1 FROM profiles ...)` inside policies on
-- the profiles table recurses (verified: SELECT/UPDATE/DELETE return 42P17/500).
-- All admin checks now route through a SECURITY DEFINER helper that bypasses RLS
-- internally, eliminating the recursion.

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

-- profiles
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select to authenticated
  using (public.is_admin());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- contacts
drop policy if exists "contacts_delete_admin" on public.contacts;
create policy "contacts_delete_admin" on public.contacts
  for delete to authenticated
  using (public.is_admin());

-- whatsapp_instances
drop policy if exists "whatsapp_instances_insert_admin" on public.whatsapp_instances;
create policy "whatsapp_instances_insert_admin" on public.whatsapp_instances
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "whatsapp_instances_update_admin" on public.whatsapp_instances;
create policy "whatsapp_instances_update_admin" on public.whatsapp_instances
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "whatsapp_instances_delete_admin" on public.whatsapp_instances;
create policy "whatsapp_instances_delete_admin" on public.whatsapp_instances
  for delete to authenticated
  using (public.is_admin());
