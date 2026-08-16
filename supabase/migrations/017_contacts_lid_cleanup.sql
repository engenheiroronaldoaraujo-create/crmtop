-- 017_contacts_lid_cleanup.sql
-- Final LID model: a contact may have a real phone, a LID, or both. `phone`
-- becomes nullable (keeps UNIQUE, multiple NULLs allowed). At least one of the
-- two identifiers must be present.
--
-- Also migrates the legacy data where the LID was stored in the `phone` column
-- as `lid:<digits>` into the proper `lid` column.

alter table public.contacts
  alter column phone drop not null;

alter table public.contacts
  drop constraint if exists contacts_has_identifier;

alter table public.contacts
  add constraint contacts_has_identifier
  check (phone is not null or lid is not null);

-- Move legacy `lid:<digits>` values out of phone into lid.
update public.contacts
set lid = phone, phone = null
where phone like 'lid:%';
