-- 018_contacts_lid_unique.sql
-- Replace the partial unique index on `lid` with a plain UNIQUE constraint.
-- Postgres does not allow ON CONFLICT (lid) on a partial unique index; a plain
-- unique constraint on a nullable column still allows multiple NULLs.

drop index if exists public.contacts_lid_unique;

alter table public.contacts
  drop constraint if exists contacts_lid_unique;

alter table public.contacts
  add constraint contacts_lid_unique unique (lid);
