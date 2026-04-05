-- Migration: Definitive Leads RLS and user_id Sync Fix
-- Date: 2026-04-05
-- Description: Resolves leads loading failure caused by:
--   1. Duplicate migration timestamps (20260402000005, 20260404000001) that previously
--      left execution order ambiguous, potentially leaving the strict owner-only policy
--      ("Strict Owner Leads") active instead of the intended hierarchical policy.
--   2. Leads rows where user_id is NULL (backfill may not have reached all rows).
--   3. Duplicate sync triggers (trg_sync_leads_user_id + tr_sync_leads_user_id) that
--      both run on INSERT/UPDATE — consolidated to a single trigger here.
--
-- This migration is idempotent and safe to re-run.

---------------------------------------
-- 1. Wipe ALL existing leads policies
--    (handles any residual strict-owner policy regardless of what ran before)
---------------------------------------
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'leads' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.leads', pol.policyname);
  END LOOP;
END $$;

---------------------------------------
-- 2. Ensure RLS is enabled
---------------------------------------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

---------------------------------------
-- 3. Create the single definitive hierarchical policy
---------------------------------------
CREATE POLICY "Leads Hierarchical Access" ON public.leads
FOR ALL
TO authenticated
USING (
  -- Agent: sees their own leads via user_id
  user_id = auth.uid()
  OR
  -- Super Admin: global access
  public.is_super_admin()
  OR
  -- Admin: org-scoped access
  (public.get_user_role() = 'Admin' AND organization_id = public.get_org_id())
  OR
  -- Team Leader: sees downline agents' leads via ltree hierarchy
  (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), user_id)
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR
  public.is_super_admin()
  OR
  (public.get_user_role() = 'Admin' AND organization_id = public.get_org_id())
  OR
  (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), user_id)
  )
);

---------------------------------------
-- 4. Backfill user_id for any remaining NULL rows
--    (covers leads created before the user_id column existed or where backfill missed)
---------------------------------------
UPDATE public.leads
SET user_id = assigned_agent_id
WHERE assigned_agent_id IS NOT NULL
  AND (user_id IS NULL OR user_id != assigned_agent_id);

---------------------------------------
-- 5. Consolidate sync triggers
--    Drop both the old trigger (trg_sync_leads_user_id from 20260404000002)
--    and the new trigger (tr_sync_leads_user_id from 20260405000000),
--    then recreate a single canonical trigger.
---------------------------------------
DROP TRIGGER IF EXISTS trg_sync_leads_user_id ON public.leads;
DROP TRIGGER IF EXISTS tr_sync_leads_user_id   ON public.leads;

CREATE OR REPLACE FUNCTION public.sync_leads_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Keep user_id in sync with assigned_agent_id so RLS (user_id = auth.uid()) is
  -- never stale after a reassignment.
  IF NEW.assigned_agent_id IS NOT NULL THEN
    NEW.user_id := NEW.assigned_agent_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_sync_leads_user_id
BEFORE INSERT OR UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.sync_leads_user_id();

---------------------------------------
-- 6. Performance indexes
---------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_user_id          ON public.leads(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_agent_id ON public.leads(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_leads_organization_id   ON public.leads(organization_id);

-- Notify PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';
