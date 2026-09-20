-- 055_sdr_knowledge_base.sql
-- Base de conhecimento em texto anexada pelo admin na Config SDR IA.
-- Conteudo incluido no system message do engine (apos system_prompt).

alter table public.sdr_settings
  add column if not exists knowledge_base text;
