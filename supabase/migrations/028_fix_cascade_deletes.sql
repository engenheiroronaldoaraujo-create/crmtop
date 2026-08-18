-- Fix: add CASCADE to opportunity_stage_history FK
ALTER TABLE public.opportunity_stage_history
  DROP CONSTRAINT IF EXISTS opportunity_stage_history_opportunity_id_fkey;

ALTER TABLE public.opportunity_stage_history
  ADD CONSTRAINT opportunity_stage_history_opportunity_id_fkey
  FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;

-- Fix: add CASCADE to opportunity_tags FK
ALTER TABLE public.opportunity_tags
  DROP CONSTRAINT IF EXISTS opportunity_tags_opportunity_id_fkey;

ALTER TABLE public.opportunity_tags
  ADD CONSTRAINT opportunity_tags_opportunity_id_fkey
  FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;

-- Fix: add CASCADE to opportunity_tasks FK
ALTER TABLE public.opportunity_tasks
  DROP CONSTRAINT IF EXISTS opportunity_tasks_opportunity_id_fkey;

ALTER TABLE public.opportunity_tasks
  ADD CONSTRAINT opportunity_tasks_opportunity_id_fkey
  FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;

-- Fix: add CASCADE to meetings FK
ALTER TABLE public.meetings
  DROP CONSTRAINT IF EXISTS meetings_opportunity_id_fkey;

ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_opportunity_id_fkey
  FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;
