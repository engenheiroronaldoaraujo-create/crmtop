-- 056_audio_outbound.sql
-- Gravação e envio de áudio (bolha de voz) pelo vendedor.
--
-- Este arquivo é ADITIVO e pode ser revertido com:
--   drop table if exists public.audio_recordings;
-- Ele não altera nenhuma migration já aplicada.

-- ---------------------------------------------------------------------------
-- 1. Bucket: liberar os containers que o MediaRecorder produz
-- ---------------------------------------------------------------------------
-- config.toml:124 restringe o bucket `whatsapp-media` a uma allowlist de MIME
-- types que NÃO inclui audio/webm — o container padrão do MediaRecorder no
-- Chrome. Sem isto o upload falha em silêncio (o catch em
-- evolution-proxy/index.ts só faz console.error, depois de uma resposta 200).
--
-- NOTA: o config.toml vale para a stack local. No projeto linkado é preciso
-- aplicar o ALTER abaixo via SQL Editor ou Management API:
--
--   update storage.buckets
--      set allowed_mime_types = array[
--        'image/png','image/jpeg','image/webp','image/gif',
--        'audio/ogg','audio/mpeg','audio/mp4','audio/aac','audio/webm',
--        'video/mp4','application/pdf','application/octet-stream'
--      ]
--    where id = 'whatsapp-media';

update storage.buckets
   set allowed_mime_types = array[
         'image/png', 'image/jpeg', 'image/webp', 'image/gif',
         'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/webm',
         'video/mp4', 'application/pdf', 'application/octet-stream'
       ]
 where id = 'whatsapp-media';

-- ---------------------------------------------------------------------------
-- 2. Tabela de auditoria/dedup das gravações
-- ---------------------------------------------------------------------------
-- O Evolution não devolve a duração do áudio, então o cliente a informa e o
-- servidor valida o teto. Guardar o registro permite auditoria de consumo de
-- Storage e detecta reenvio da mesma gravação.

create table if not exists public.audio_recordings (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  storage_path text,
  mime text not null,
  size_bytes bigint not null,
  duration_ms integer not null,
  created_at timestamptz not null default now()
);

comment on table public.audio_recordings is
  'Gravações de áudio enviadas pelo vendedor (bolha de voz). Escrita apenas via service role nas Edge Functions.';

create index if not exists audio_recordings_conversation_created_idx
  on public.audio_recordings (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
-- Leitura para autenticados; escrita restrita a service_role. Mesmo padrão de
-- app_secrets (sem policy para authenticated = sem acesso de escrita).

alter table public.audio_recordings enable row level security;

drop policy if exists "audio_recordings_select_auth" on public.audio_recordings;
create policy "audio_recordings_select_auth"
  on public.audio_recordings for select to authenticated
  using (true);

-- Nenhuma policy de INSERT/UPDATE/DELETE para authenticated: as Edge
-- Functions usam service_role, que bypassa RLS.

-- ---------------------------------------------------------------------------
-- 4. Recording alvo das URLs assinadas de playback
-- ---------------------------------------------------------------------------
-- messages.transcription já existe (migration 037). A gravação usa
-- messages.type = 'audio' — sem coluna nova, o player do Chat já renderiza
-- (Chat.tsx:271-272).
