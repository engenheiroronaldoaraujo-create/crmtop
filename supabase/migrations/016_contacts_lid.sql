-- 016_contacts_lid.sql
-- Add LID column to contacts table for WhatsApp Linked Identity (LID) support.
-- WhatsApp is migrating to LIDs (Linked Identities) for privacy. Messages from
-- LID-based chats carry an opaque `@lid` identifier and the real phone number
-- (when available) in `key.senderPn` / `key.remoteJidAlt`.
--
-- The model becomes: a contact can have a real phone, a LID, or both. `phone`
-- stays NOT NULL UNIQUE for backwards compatibility with the existing data;
-- the LID column is UNIQUE when present.

alter table public.contacts
  add column if not exists lid text;

create unique index if not exists contacts_lid_unique
  on public.contacts (lid) where lid is not null;

create index if not exists contacts_lid_idx
  on public.contacts (lid) where lid is not null;

comment on column public.contacts.lid is
  'WhatsApp Linked Identity (LID) - opaque identifier used when phone is not available';
