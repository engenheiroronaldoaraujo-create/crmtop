-- 052_last_message_inbound.sql
-- Persist the direction of the last message on each conversation so the chat
-- list can highlight conversations where the last move was ours vs. the
-- contact's (awaiting our reply).

alter table public.conversations
  add column if not exists last_message_inbound boolean;

-- Re-create bump_conversation keeping last_message_inbound in sync with the
-- same monotonic rule used for last_message_at / last_message_preview.
create or replace function public.bump_conversation(
  p_id uuid,
  p_sent_at timestamptz,
  p_preview text,
  p_inbound boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set
    last_message_at = case
      when last_message_at is null or p_sent_at >= last_message_at then p_sent_at
      else last_message_at
    end,
    last_message_preview = case
      when last_message_at is null or p_sent_at >= last_message_at then p_preview
      else last_message_preview
    end,
    last_message_inbound = case
      when last_message_at is null or p_sent_at >= last_message_at then p_inbound
      else last_message_inbound
    end,
    unread_count = unread_count + case when p_inbound then 1 else 0 end
  where id = p_id;
end;
$$;

-- Backfill from the messages table (last message per conversation).
create or replace function public.backfill_last_message_inbound()
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversations c
  set last_message_inbound = (
    select m.direction = 'inbound'
    from public.messages m
    where m.conversation_id = c.id
    order by m.sent_at desc nulls last
    limit 1
  )
  where c.last_message_at is not null
    and (
      select m.sent_at
      from public.messages m
      where m.conversation_id = c.id
      order by m.sent_at desc nulls last
      limit 1
    ) = c.last_message_at;
$$;

select public.backfill_last_message_inbound();

comment on column public.conversations.last_message_inbound is
  'Direction of the last message. true = inbound (contact spoke last, waiting our reply).';
