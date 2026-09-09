-- Fix: deletar etapa do funil falhava com FK violation em opportunity_stage_history
-- (qualquer oportunidade que ja passou pela etapa deixa historico com old/new_stage_id,
-- mesmo que a etapa esteja vazia hoje). Tambem sdr_conversations.opportunity_id
-- bloqueava deletar oportunidade com conversa SDR vinculada.

-- 1) historico: permitir SET NULL nas duas referencias de etapa
ALTER TABLE public.opportunity_stage_history
  ALTER COLUMN new_stage_id DROP NOT NULL;

ALTER TABLE public.opportunity_stage_history
  DROP CONSTRAINT IF EXISTS opportunity_stage_history_old_stage_id_fkey;

ALTER TABLE public.opportunity_stage_history
  ADD CONSTRAINT opportunity_stage_history_old_stage_id_fkey
  FOREIGN KEY (old_stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;

ALTER TABLE public.opportunity_stage_history
  DROP CONSTRAINT IF EXISTS opportunity_stage_history_new_stage_id_fkey;

ALTER TABLE public.opportunity_stage_history
  ADD CONSTRAINT opportunity_stage_history_new_stage_id_fkey
  FOREIGN KEY (new_stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;

-- 2) sdr_conversations: soltar a referencia quando a oportunidade for excluida
ALTER TABLE public.sdr_conversations
  DROP CONSTRAINT IF EXISTS sdr_conversations_opportunity_id_fkey;

ALTER TABLE public.sdr_conversations
  ADD CONSTRAINT sdr_conversations_opportunity_id_fkey
  FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;
