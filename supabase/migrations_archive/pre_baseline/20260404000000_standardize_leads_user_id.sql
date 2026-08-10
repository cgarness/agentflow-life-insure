-- Migration: Standardize Leads user_id and RLS
-- Date: 2026-04-04
-- Description: Adds a 'user_id' column to the 'leads' table to match project standards
--   and updates RLS policies to use this new column for filtering and access control.

---------------------------------------
-- 1. Add user_id column
---------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'leads'
    AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill user_id from assigned_agent_id if user_id is null
UPDATE public.leads
SET user_id = assigned_agent_id
WHERE user_id IS NULL AND assigned_agent_id IS NOT NULL;

---------------------------------------
-- 2. Update RLS Policy
---------------------------------------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Drop existing hierarchical policy
DROP POLICY IF EXISTS "Leads Hierarchical Access" ON public.leads;

-- Create updated policy using user_id
CREATE POLICY "Leads Hierarchical Access" ON public.leads
FOR ALL
TO authenticated
USING (
  -- Owner: agent sees their own assigned records via user_id
  user_id = auth.uid()
  OR
  -- Super Admin: global access
  public.is_super_admin()
  OR
  -- Admin: org-scoped access
  (public.get_user_role() = 'Admin' AND organization_id = public.get_org_id())
  OR
  -- Team Leader: can see records assigned to their downline agents
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

-- Notify PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';
