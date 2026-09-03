-- 041_send_error.sql
-- Motivo da falha ao enviar (resposta da Evolution/Baileys truncada).
-- Antes a falha era registrada sem explicação, e o usuário via apenas
-- "não conseguiu enviar".

alter table public.messages
  add column if not exists send_error text;

comment on column public.messages.send_error is
  'Erro retornado pela Evolution quando status = failed (truncado a ~300 chars).';
