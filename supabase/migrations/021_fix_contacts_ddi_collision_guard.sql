-- 021_fix_contacts_ddi_collision_guard.sql
-- Re-applies Step B of 020 (prepend +55 to whatsapp-sourced 10/11-digit
-- phones) but with a collision guard: if the resulting '+55' phone already
-- exists, leave the row untouched (merging is a manual operation). This makes
-- the statement safe to run even when colliding contacts are present, so it
-- never fails on a unique_violation of the phone index.

UPDATE public.contacts
SET phone = '55' || phone
WHERE source = 'whatsapp'
  AND phone ~ '^[0-9]{10,11}$'
  AND NOT EXISTS (
    SELECT 1
    FROM public.contacts c2
    WHERE c2.phone = '55' || contacts.phone
  );
