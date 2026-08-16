-- 008_contacts_60d.sql
-- Contacts follow the same 60-day window as messages: auto-imported contacts
-- (from WhatsApp) only survive if they have a conversation with recent
-- activity. Manually-created contacts are tagged `source = 'manual'` and are
-- never auto-removed.

alter table public.contacts
  add column if not exists source text not null default 'whatsapp';

delete from public.contacts c
where c.source = 'whatsapp'
  and not exists (
    select 1 from public.conversations cv
    where cv.contact_id = c.id
  );
