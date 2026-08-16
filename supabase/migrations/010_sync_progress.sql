-- 010_sync_progress.sql
-- Tracks how far the bulk message-history sync has progressed per instance, so
-- large imports can be resumed across multiple Edge Function invocations
-- (each invocation is capped by the platform's ~150s idle timeout).

alter table public.whatsapp_instances
  add column if not exists sync_page int not null default 0;
