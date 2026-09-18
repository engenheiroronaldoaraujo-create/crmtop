-- 054_sdr_code_prompt.sql
-- Prompt principal editável do SDR (base da Sofia). Semântica no engine:
--   sistema = [code_prompt em branco ? SYSTEM_PROMPT do código : code_prompt]
--           + [system_prompt se preenchido]  (adicional, separado)

alter table public.sdr_settings
  add column if not exists code_prompt text;
