-- =============================================================
-- Migration: custom_menu_links — org-scoped RLS + platform Super Admin
-- Date: 2026-05-24
-- Purpose:
--   SELECT  → own org OR is_super_admin() (cross-org read)
--   INSERT/UPDATE/DELETE → Admin own org OR is_super_admin() (cross-org write)
--   WITH CHECK on INSERT/UPDATE requires organization_id IS NOT NULL
--   Team Leader write deferred to Permissions tab.
-- Depends on: get_org_id(), get_user_role(), is_super_admin()
-- Does NOT use: super_admin_own_org()
-- =============================================================

ALTER TABLE public.custom_menu_links ENABLE ROW LEVEL SECURITY;

-- Drop legacy permissive policies
DROP POLICY IF EXISTS "Enable read access for authenticated users"  ON public.custom_menu_links;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.custom_menu_links;
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON public.custom_menu_links;
DROP POLICY IF EXISTS "Enable delete access for authenticated users" ON public.custom_menu_links;

-- Idempotent: drop if a partial run already created these
DROP POLICY IF EXISTS custom_menu_links_select ON public.custom_menu_links;
DROP POLICY IF EXISTS custom_menu_links_insert ON public.custom_menu_links;
DROP POLICY IF EXISTS custom_menu_links_update ON public.custom_menu_links;
DROP POLICY IF EXISTS custom_menu_links_delete ON public.custom_menu_links;

-- SELECT — own org members, or platform Super Admin (all orgs)
CREATE POLICY custom_menu_links_select ON public.custom_menu_links
FOR SELECT TO authenticated
USING (
  organization_id = public.get_org_id()
  OR public.is_super_admin()
);

-- INSERT — Admin (own org) or platform Super Admin (any org); org_id required
CREATE POLICY custom_menu_links_insert ON public.custom_menu_links
FOR INSERT TO authenticated
WITH CHECK (
  organization_id IS NOT NULL
  AND (
    public.is_super_admin()
    OR (
      organization_id = public.get_org_id()
      AND public.get_user_role() = 'Admin'::text
    )
  )
);

-- UPDATE
CREATE POLICY custom_menu_links_update ON public.custom_menu_links
FOR UPDATE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = 'Admin'::text
  )
)
WITH CHECK (
  organization_id IS NOT NULL
  AND (
    public.is_super_admin()
    OR (
      organization_id = public.get_org_id()
      AND public.get_user_role() = 'Admin'::text
    )
  )
);

-- DELETE
CREATE POLICY custom_menu_links_delete ON public.custom_menu_links
FOR DELETE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = 'Admin'::text
  )
);

NOTIFY pgrst, 'reload schema';
