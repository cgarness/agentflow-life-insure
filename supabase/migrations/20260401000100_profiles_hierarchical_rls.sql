-- =============================================================
-- Migration: 3-Tier Hierarchical Access Control (Profiles)
-- Purpose: Implement a strict 3-tier management chain for the
--          public.profiles table using org-scoped ltree lookups.
-- =============================================================

-- 1. Ensure RLS is enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. Drop the old experimental policies
DROP POLICY IF EXISTS "profiles_select_global" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_super_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_super_admin" ON public.profiles;

-- 3. HIERARCHICAL SELECT:
--    Super Admin: Bypasses everything (Global).
--    Admin: Sees all profiles in their organization_id.
--    Team Leader (Manager): Sees themselves OR their downline (ltree) in their organization_id.
--    Agent: Sees ONLY themselves (id = auth.uid()) in their organization_id.
CREATE POLICY "profiles_select_hierarchical" ON public.profiles
FOR SELECT TO authenticated
USING (
  public.is_super_admin() -- 1. Super Admin Bypass
  OR (
    organization_id = public.get_org_id() -- 2. Organization Isolation
    AND (
      public.get_user_role() = 'Admin' -- Admin sees everyone in the org
      OR (
        public.get_user_role() = 'Team Leader' 
        AND (id = auth.uid() OR public.is_ancestor_of(auth.uid(), id)) -- Manager sees self + downline
      )
      OR (
        public.get_user_role() = 'Agent' 
        AND (id = auth.uid()) -- Agent sees only themselves
      )
    )
  )
);

-- 4. HIERARCHICAL UPDATE:
--    Matches the SELECT rules for consistent data management.
CREATE POLICY "profiles_update_hierarchical" ON public.profiles
FOR UPDATE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR (
        public.get_user_role() = 'Team Leader' 
        AND (id = auth.uid() OR public.is_ancestor_of(auth.uid(), id))
      )
      OR (
        public.get_user_role() = 'Agent' 
        AND (id = auth.uid())
      )
    )
  )
)
WITH CHECK (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR (
        public.get_user_role() = 'Team Leader' 
        AND (id = auth.uid() OR public.is_ancestor_of(auth.uid(), id))
      )
      OR (
        public.get_user_role() = 'Agent' 
        AND (id = auth.uid())
      )
    )
  )
);

-- 5. HIERARCHICAL INSERT:
--    Only Super Admin or Org Admins can create new profiles.
CREATE POLICY "profiles_insert_privileged" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = 'Admin'
  )
);

-- 6. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
