-- =============================================================
-- Organizations: super-admin can SELECT all rows (Agencies list)
-- =============================================================
-- Problem: Super admins saw platform-wide users/leads counts but only
-- their JWT org in organizations — tenant-scoped SELECT without bypass.
-- Fix: additive SELECT policy OR'd with existing tenant policies.
-- Do not ENABLE ROW LEVEL SECURITY here — if RLS were off, enabling without
-- tenant policies would block normal users. Assumes organizations RLS is already on.

DROP POLICY IF EXISTS "organizations_select_super_admin_all" ON public.organizations;

CREATE POLICY "organizations_select_super_admin_all"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

NOTIFY pgrst, 'reload schema';
