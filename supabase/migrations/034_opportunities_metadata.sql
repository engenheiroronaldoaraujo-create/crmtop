-- 034_opportunities_metadata.sql
-- Add metadata jsonb column to opportunities for SDR extracted_info storage.

alter table public.opportunities
  add column if not exists metadata jsonb;
