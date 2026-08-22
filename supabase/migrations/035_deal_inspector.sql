-- 035_deal_inspector.sql
-- Deal Inspector: table for AI-powered opportunity analysis results.

create table if not exists public.deal_insights (
  id               uuid primary key default gen_random_uuid(),
  opportunity_id   uuid references public.opportunities(id) on delete cascade,
  conversation_id  uuid references public.conversations(id) on delete cascade,
  contact_id       uuid references public.contacts(id) on delete cascade,
  -- Analysis result
  status           text not null check (status in (
                     'stalled',
                     'at_risk',
                     'no_opportunity',
                     'ok'
                   )),
  stall_reason     text not null check (stall_reason in (
                     'meeting_no_feedback',
                     'proposal_no_response',
                     'interest_no_next_step',
                     'unhandled_objection',
                     'ghost',
                     'no_human_followup',
                     'unknown'
                   )),
  days_stalled     int not null default 0,
  priority         text not null default 'medium'
                     check (priority in ('high', 'medium', 'low')),
  ai_summary       text not null,
  ai_suggestion    text not null,
  suggested_message text,
  -- Search metadata
  search_params    jsonb,
  -- Vendor action
  action_taken     text check (action_taken in ('task_created','message_sent','dismissed','snoozed')),
  actioned_at      timestamptz,
  actioned_by      uuid references public.profiles(id),
  -- Control
  created_at       timestamptz not null default now()
);

alter table public.deal_insights enable row level security;

drop policy if exists "deal_insights_select" on public.deal_insights;
create policy "deal_insights_select" on public.deal_insights
  for select using (auth.role() = 'authenticated');

drop policy if exists "deal_insights_insert" on public.deal_insights;
create policy "deal_insights_insert" on public.deal_insights
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "deal_insights_update" on public.deal_insights;
create policy "deal_insights_update" on public.deal_insights
  for update using (auth.role() = 'authenticated');

create index deal_insights_opportunity_id_idx on public.deal_insights (opportunity_id);
create index deal_insights_created_at_idx on public.deal_insights (created_at desc);
create index deal_insights_status_idx on public.deal_insights (status, priority);
