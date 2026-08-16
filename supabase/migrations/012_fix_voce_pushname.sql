-- 012_fix_voce_pushname.sql
-- Removes the "Você" placeholder push_name. WhatsApp's sync reports the
-- business's own profile name ("Você" / "You") as pushName on OUTBOUND
-- messages, which polluted the contact names. Real names come from the address
-- book (sync-contacts) or inbound messages.

update public.contacts
set push_name = null
where source = 'whatsapp'
  and push_name is not null
  and lower(push_name) ~ '^voc';
