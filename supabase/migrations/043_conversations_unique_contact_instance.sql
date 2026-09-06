-- 043_conversations_unique_contact_instance.sql
-- Corrida de upsertConversation (select-then-insert sem constraint) criava
-- conversas duplicadas para o mesmo contato/instância. O índice único fecha a
-- corrida: a segunda inserção falha e o fluxo relê a linha existente.
-- Linhas com instance_id nulo (legado) não conflitam (NULLs distintos).

create unique index if not exists conversations_contact_instance_unique
  on public.conversations (contact_id, instance_id);
