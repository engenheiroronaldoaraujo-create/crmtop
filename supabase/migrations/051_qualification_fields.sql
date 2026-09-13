-- 051_qualification_fields.sql
-- Structured qualification fields filled by the SDR (Sofia):
--   business_type  = ramo de atividade
--   team_size      = quantidade de tecnicos/equipes
--   extra_info     = informacoes adicionais passadas pelo contato

alter table public.contacts
  add column if not exists business_type text,
  add column if not exists team_size integer,
  add column if not exists extra_info text;

-- Temperature + qualification marker on opportunities
alter table public.opportunities
  add column if not exists temperature text,
  add column if not exists qualified_at timestamptz;

create index if not exists opportunities_temperature_idx
  on public.opportunities (temperature) where temperature is not null;

-- Separate LLM model for batch extraction (requalifier)
alter table public.sdr_settings
  add column if not exists extraction_model text;

-- RPC referenced by evolution-webhook (was missing)
create or replace function public.increment_sdr_count(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sdr_conversations
     set auto_messages_count = coalesce(auto_messages_count, 0) + 1
   where conversation_id = p_conversation_id;
$$;
