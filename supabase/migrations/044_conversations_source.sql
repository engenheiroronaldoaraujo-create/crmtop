-- 044_conversations_source.sql
-- Origem da conversa: permite filtrar o chat por canal de entrada
-- (anúncio click-to-WhatsApp da Meta, campanha interna, manual, orgânico).
-- A origem é definida na CRIAÇÃO da conversa (primeira mensagem) e nunca
-- é sobrescrita depois.

alter table public.conversations
  add column if not exists source text not null default 'organic'
    check (source in ('organic', 'ad', 'campaign', 'manual'));

alter table public.conversations
  add column if not exists source_meta jsonb;

comment on column public.conversations.source is
  'Origem da conversa: organic | ad (anúncio Meta) | campaign | manual.';
comment on column public.conversations.source_meta is
  'Metadados da origem (ex.: ad_id, source do advertiser da Meta).';

-- Backfill: conversas de contatos criados manualmente nascem 'manual'.
update public.conversations c
set source = 'manual'
from public.contacts ct
where ct.id = c.contact_id
  and ct.source = 'manual'
  and c.source = 'organic';

create index if not exists conversations_source_idx
  on public.conversations (source, last_message_at desc nulls last);
