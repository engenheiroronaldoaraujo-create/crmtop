-- 014_clean_digits_as_name.sql
-- Removes "names" that are just the contact's own identifier digits (WhatsApp
-- uses the LID/phone digits as pushName when the contact has no saved name).

update public.contacts
set push_name = null
where push_name is not null
  and (push_name = replace(phone, 'lid:', '') or push_name = phone);
