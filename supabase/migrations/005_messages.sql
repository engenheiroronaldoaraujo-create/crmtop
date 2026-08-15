-- 005_messages.sql
-- Messages: chat history. Deduplicated by design via evolution_message_id.

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id),
  evolution_message_id text,
  direction text not null
    check (direction in ('inbound', 'outbound')),
  sender_profile_id uuid references public.profiles (id),
  type text not null default 'text'
    check (type in ('text', 'image', 'audio', 'video', 'document', 'sticker', 'unknown')),
  content text,
  media_url text,
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, evolution_message_id)
);

create index if not exists messages_conversation_sent_at_idx
  on public.messages (conversation_id, sent_at);

alter table public.messages enable row level security;

-- Any authenticated user reads the shared history.
drop policy if exists "messages_select" on public.messages;
create policy "messages_select" on public.messages
  for select to authenticated
  using (true);

-- No insert/update/delete policies: writes happen only through Edge Functions
-- using the service role (dedup + sender attribution handled server-side).

-- Realtime: stream messages and conversation changes to the UI.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
