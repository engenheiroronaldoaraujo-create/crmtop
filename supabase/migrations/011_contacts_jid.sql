-- 011_contacts_jid.sql
-- Stores the real WhatsApp JID on contacts. Contacts with only a LID (new
-- WhatsApp user id, no phone) keep `phone = lid:<digits>` as a unique key but
-- the actual JID lives here and is never displayed as a phone number.

alter table public.contacts
  add column if not exists jid text;

update public.contacts
set jid = case
  when phone like 'lid:%' then substr(phone, 5) || '@lid'
  else phone || '@s.whatsapp.net'
end
where jid is null and source = 'whatsapp';
