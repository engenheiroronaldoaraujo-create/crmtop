-- 004_conversations.sql
-- Conversations: one row per contact per instance. Inbox is shared by the team.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id),
  instance_id uuid not null references public.whatsapp_instances (id),
  assigned_to uuid references public.profiles (id),
  status text not null default 'open'
    check (status in ('open', 'closed')),
  last_message_at timestamptz,
  last_message_preview text,
  unread_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (contact_id, instance_id)
);

create index if not exists conversations_last_message_at_idx
  on public.conversations (last_message_at desc);
create index if not exists conversations_assigned_to_idx
  on public.conversations (assigned_to);
create index if not exists conversations_status_idx
  on public.conversations (status);

alter table public.conversations enable row level security;

-- Any authenticated user reads the shared inbox.
drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select to authenticated
  using (true);

-- Authenticated users assign / close / mark-read conversations.
drop policy if exists "conversations_update" on public.conversations;
create policy "conversations_update" on public.conversations
  for update to authenticated
  using (true)
  with check (true);

-- No insert/delete policies: conversations are upserted by the webhook via
-- service role only.

-- Zeroing unread_count should only ever reset to 0 (no arbitrary inflation).
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversations
  set unread_count = 0
  where id = p_conversation_id;
$$;

grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Called by the webhook (service role) for every message. Only moves
-- last_message_* forward (handles out-of-order history batches) and increments
-- unread_count only for inbound messages.
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
    unread_count = unread_count + case when p_inbound then 1 else 0 end
  where id = p_id;
end;
$$;
