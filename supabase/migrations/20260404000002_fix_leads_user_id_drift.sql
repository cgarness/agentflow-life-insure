-- Migration: Fix leads user_id drift and prevent future divergence
-- Date: 2026-04-04
-- Description: Re-syncs any leads rows where user_id has drifted from assigned_agent_id
--   (caused by update/reassign operations that changed assigned_agent_id without updating
--   user_id). Also adds a trigger to keep the two columns in sync automatically so that
--   the RLS policy (user_id = auth.uid()) never sees stale data.

---------------------------------------
-- 1. Re-sync drifted rows
--    Covers two cases:
--      a) user_id IS NULL  (backfill missed them or new inserts without user_id)
--      b) user_id != assigned_agent_id  (drift from buggy update/reassign logic)
---------------------------------------
UPDATE public.leads
SET user_id = assigned_agent_id
WHERE assigned_agent_id IS NOT NULL
  AND (user_id IS NULL OR user_id != assigned_agent_id);

---------------------------------------
-- 2. Trigger: keep user_id in sync whenever assigned_agent_id changes
---------------------------------------
CREATE OR REPLACE FUNCTION public.sync_leads_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- On INSERT or UPDATE, mirror assigned_agent_id into user_id
  -- Only override user_id if it is NULL or diverged from assigned_agent_id
  IF NEW.assigned_agent_id IS NOT NULL AND (NEW.user_id IS NULL OR NEW.user_id != NEW.assigned_agent_id) THEN
    NEW.user_id := NEW.assigned_agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_leads_user_id ON public.leads;

CREATE TRIGGER trg_sync_leads_user_id
BEFORE INSERT OR UPDATE OF assigned_agent_id ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.sync_leads_user_id();

-- Notify PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';
