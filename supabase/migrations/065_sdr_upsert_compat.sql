-- 065_sdr_upsert_compat.sql
--
-- Compatibilidade do bundle antigo do frontend com o hardening de colunas.
--
-- A migration 061 deu a `authenticated` apenas UPDATE/INSERT **por coluna**
-- em `sdr_conversations`, para o vendedor não conseguir mexer em
-- `auto_messages_count` (o limite de mensagens da IA).
--
-- Mas o `ON CONFLICT DO UPDATE` do `upsert` do Chat (que é o que a versão
-- anterior do frontend usava para pausar/retomar o SDR) exige privilégio de
-- UPDATE nas colunas que o PostgREST inclui no `DO UPDATE SET` — que são
-- exatamente as colunas do INSERT: conversation_id, contact_id e status.
--
-- Com o grant correto (só essas 3 colunas), o bundle antigo volta a
-- funcionar E o `auto_messages_count` continua fora do alcance do
-- vendedor. O bundle novo usa o RPC `set_sdr_pause` (migration 064), que
-- funciona nos dois casos.
--
-- Não há risco de o `ON CONFLICT DO UPDATE` em si permitir mexer em outras
-- colunas: o `DO UPDATE SET` só lista as colunas do INSERT.

revoke insert on public.sdr_conversations from authenticated;
revoke update on public.sdr_conversations from authenticated;

grant insert (conversation_id, contact_id, status) on public.sdr_conversations to authenticated;
grant update (conversation_id, contact_id, status) on public.sdr_conversations to authenticated;

-- `auto_messages_count` (limite da IA), `last_auto_reply_at` e
-- `handoff_reason` continuam fora do alcance do vendedor.
