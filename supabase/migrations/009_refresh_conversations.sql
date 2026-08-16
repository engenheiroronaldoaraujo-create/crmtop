-- 009_refresh_conversations.sql
-- Recomputes last_message_* for every conversation of an instance from the
-- actual messages table. Used by the bulk history sync (sync-messages) so the
-- inbox list reflects the real latest message after a large import.

create or replace function public.refresh_conversation_previews(p_instance_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversations c
  set last_message_at = sub.sent_at,
      last_message_preview = sub.preview
  from (
    select distinct on (conversation_id) conversation_id, sent_at,
           coalesce(content, '[' || type || ']') as preview
    from public.messages
    where conversation_id in (
      select id from public.conversations where instance_id = p_instance_id
    )
    order by conversation_id, sent_at desc
  ) sub
  where c.id = sub.conversation_id;
$$;
