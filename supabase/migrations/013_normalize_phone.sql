-- 013_normalize_phone.sql
-- Normalizes WhatsApp-derived phone numbers to Brazilian E.164: numbers stored
-- without the country code (10/11 digits) get the +55 prefix. Keeps ingestion
-- and stored data consistent (the webhook/sync normalize the same way).

update public.contacts
set phone = '55' || phone
where source = 'whatsapp'
  and phone ~ '^[0-9]{10,11}$';
