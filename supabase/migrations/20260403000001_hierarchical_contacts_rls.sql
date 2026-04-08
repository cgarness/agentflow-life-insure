-- Migration: Hierarchical RLS for Contact Tables (Leads, Clients, Recruits)
-- Date: 2026-04-03
-- Description: Replaces strict owner-only policies on leads, clients, and recruits
--   with hierarchical access. Agents see their own records. Uplines (Team Leaders,
--   Admins) can also see records assigned to any of their downline agents, using
--   the is_ancestor_of() function from the ltree hierarchy system.
--
-- Prerequisites:
--   - 20260331200200_ltree_hierarchy.sql (ltree extension, hierarchy_path, is_ancestor_of)
--   - 20260401000100_profiles_hierarchical_rls.sql (profiles hierarchy RLS)
--   - 20260402000002_lockdown_rls.sql (get_user_role, get_org_id helpers)
--
-- Security Model:
--   Super Admin  -> All records globally
--   Admin        -> All records in their organization
--   Team Leader  -> Own records + records where assigned_agent_id is a descendant
--   Agent        -> Own records only (assigned_agent_id = auth.uid())

---------------------------------------
-- 1. Leads Table - Hierarchical RLS
---------------------------------------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Drop existing strict policy
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'leads' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.leads', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "Leads Hierarchical Access" ON public.leads
FOR ALL
TO authenticated
USING (
  -- Owner: agent sees their own assigned records
  assigned_agent_id = auth.uid()
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
    AND public.is_ancestor_of(auth.uid(), assigned_agent_id)
  )
)
WITH CHECK (
  assigned_agent_id = auth.uid()
  OR
  public.is_super_admin()
  OR
  (public.get_user_role() = 'Admin' AND organization_id = public.get_org_id())
  OR
  (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), assigned_agent_id)
  )
);

---------------------------------------
-- 2. Clients Table - Hierarchical RLS
---------------------------------------
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'clients' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.clients', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "Clients Hierarchical Access" ON public.clients
FOR ALL
TO authenticated
USING (
  assigned_agent_id = auth.uid()
  OR
  public.is_super_admin()
  OR
  (public.get_user_role() = 'Admin' AND organization_id = public.get_org_id())
  OR
  (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), assigned_agent_id)
  )
)
WITH CHECK (
  assigned_agent_id = auth.uid()
  OR
  public.is_super_admin()
  OR
  (public.get_user_role() = 'Admin' AND organization_id = public.get_org_id())
  OR
  (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), assigned_agent_id)
  )
);

---------------------------------------
-- 3. Recruits Table - Hierarchical RLS
---------------------------------------
ALTER TABLE public.recruits ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'recruits' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.recruits', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "Recruits Hierarchical Access" ON public.recruits
FOR ALL
TO authenticated
USING (
  assigned_agent_id = auth.uid()
  OR
  public.is_super_admin()
  OR
  (public.get_user_role() = 'Admin' AND organization_id = public.get_org_id())
  OR
  (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), assigned_agent_id)
  )
)
WITH CHECK (
  assigned_agent_id = auth.uid()
  OR
  public.is_super_admin()
  OR
  (public.get_user_role() = 'Admin' AND organization_id = public.get_org_id())
  OR
  (
    public.get_user_role() = 'Team Leader'
    AND organization_id = public.get_org_id()
    AND public.is_ancestor_of(auth.uid(), assigned_agent_id)
  )
);

-- Notify PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';
