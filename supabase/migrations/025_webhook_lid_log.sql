-- 025_webhook_lid_log.sql
-- Diagnóstico temporário: registra o `key` bruto das mensagens LID recebidas
-- (webhook) e dos registros LID do sync de histórico, marcando se o telefone
-- foi resolvido. Serve para ver onde a Evolution 2.3.7 realmente envia o
-- telefone alternativo (remoteJidAlt / senderPn). Leitura liberada para
-- autenticados; escrita somente via service role.
--
-- Após diagnosticar, a tabela e esta migration podem ser removidas.

create table if not exists public.webhook_lid_log (
  id uuid primary key default gen_random_uuid(),
  instance_name text not null,
  message_id text,
  key jsonb,
  push_name text,
  resolved_phone boolean not null default false,
  created_at timestamptz not null default now()
);

-- Único (instance_name, message_id) permite múltiplos NULLs em message_id e
-- viabiliza ON CONFLICT simples no upsert.
alter table public.webhook_lid_log
  add constraint webhook_lid_log_uniq unique (instance_name, message_id);

alter table public.webhook_lid_log enable row level security;

drop policy if exists "webhook_lid_log_select" on public.webhook_lid_log;
create policy "webhook_lid_log_select" on public.webhook_lid_log
  for select to authenticated
  using (true);