-- 037_audio_transcription.sql
-- Transcrição de áudios recebidos: o webhook (melhor esforço) transcreve o
-- áudio via OpenRouter e grava o texto aqui. O SDR IA e as demais rotinas de
-- IA usam `transcription` quando `content` é nulo (mensagem de áudio).
-- Escrita: somente service role (Edge Functions), como o resto da tabela.

alter table public.messages
  add column if not exists transcription text;

comment on column public.messages.transcription is
  'Transcrição do áudio (PT-BR) gravada pela ingestão do webhook; nunca contém segredos.';
