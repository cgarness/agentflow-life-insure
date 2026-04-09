-- Migration: Hierarchical RLS for calls (recordings & call history)
-- Date: 2026-04-09
-- Description: Replaces "Strict Owner Calls" (agent_id = auth.uid() only) with the same
--   org + ltree model as leads: Agents see their own calls; Admins see all calls in the org;
--   Team Leaders (and legacy "Team Lead" JWT role) see calls for themselves and their downline.
--   Super Admin retains global access.
--   Ensures conversation history and Recording Library respect hierarchy when viewing downline leads.

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'calls' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.calls', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Calls Hierarchical Access" ON public.calls
FOR ALL
TO authenticated
USING (
  agent_id = auth.uid()
  OR
  public.is_super_admin()
  OR
  (public.get_user_role() = 'Admin' AND organization_id = public.get_org_id())
  OR
  (
    public.get_user_role() IN ('Team Leader', 'Team Lead')
    AND organization_id = public.get_org_id()
    AND agent_id IS NOT NULL
    AND public.is_ancestor_of(auth.uid(), agent_id)
  )
)
WITH CHECK (
  agent_id = auth.uid()
  OR
  public.is_super_admin()
  OR
  (public.get_user_role() = 'Admin' AND organization_id = public.get_org_id())
  OR
  (
    public.get_user_role() IN ('Team Leader', 'Team Lead')
    AND organization_id = public.get_org_id()
    AND agent_id IS NOT NULL
    AND public.is_ancestor_of(auth.uid(), agent_id)
  )
);

-- Backfill activity rows created before organization_id / activity_type were set on webhook inserts
UPDATE public.contact_activities ca
SET organization_id = l.organization_id
FROM public.leads l
WHERE ca.contact_id = l.id::text
  AND ca.organization_id IS NULL
  AND l.organization_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
