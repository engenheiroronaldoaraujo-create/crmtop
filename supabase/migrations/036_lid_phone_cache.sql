-- Cache de resolução LID → telefone.
-- Quando o webhook recebe mensagem com remoteJid @lid sem senderPn/remoteJidAlt,
-- o resolver consulta a Evolution API uma vez e guarda o resultado aqui:
-- phone preenchido = resolvido; phone nulo = tentativa sem sucesso (negative
-- cache, evita re-consultar a API em toda mensagem).
-- Acesso somente via service role (RLS ativa, sem policies).

create table if not exists public.lid_phone_cache (
  lid             text primary key,
  phone           text,
  resolved_at     timestamptz,
  attempts        integer not null default 0,
  last_attempt_at timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.lid_phone_cache enable row level security;
