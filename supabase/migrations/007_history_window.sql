-- 007_history_window.sql
-- Business rule: keep only the last 60 days of messages. WhatsApp's history
-- sync sends arbitrary dates; this enforces the 60-day window retroactively.
-- (The webhook also filters incoming history to the same window.)

delete from public.messages
where sent_at < now() - interval '60 days';

-- Drop conversations that ended up without any message.
delete from public.conversations c
where not exists (
  select 1 from public.messages m where m.conversation_id = c.id
);
