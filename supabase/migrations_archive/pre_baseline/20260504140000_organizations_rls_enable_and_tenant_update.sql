-- =============================================================
-- Organizations: Enable RLS + tenant-scoped SELECT / UPDATE
-- =============================================================
-- Root cause: ENABLE ROW LEVEL SECURITY was never applied to
-- public.organizations. Without it every authenticated client
-- request has unrestricted read/write on ALL org rows. The
-- application-level .eq('id', orgId) filter in onboarding and
-- settings is the only barrier — any regression or direct API
-- call would silently overwrite every agency name in the system.
--
-- Existing super-admin policies already created by earlier
-- migrations are preserved and continue to work via RLS OR logic:
--   * organizations_select_super_admin_all  (20260424180000)
--   * organizations_update_super_admin      (20260430203000)
--
-- New policies added here:
--   * organizations_select_own_org — authenticated users read
--       their JWT org row only (id = get_org_id())
--   * organizations_update_own_org — Admin role may UPDATE their
--       own org row only (used by onboarding wizard + Settings →
--       Company Branding). WITH CHECK enforces the same scope so
--       no cross-tenant move is possible even via crafted payload.
-- =============================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- ── SELECT: each tenant user sees only their own org ─────────────────────────
DROP POLICY IF EXISTS organizations_select_own_org ON public.organizations;

CREATE POLICY organizations_select_own_org
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (id = public.get_org_id());

-- ── UPDATE: Admins may update their own org row (name, branding, etc.) ───────
-- get_user_role() reads from the JWT app_metadata.role claim.
-- The onboarding hook calls refreshSessionUntilClaimsReady() before
-- this update runs, so the JWT always carries a valid role by this point.
DROP POLICY IF EXISTS organizations_update_own_org ON public.organizations;

CREATE POLICY organizations_update_own_org
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (
    id = public.get_org_id()
    AND public.get_user_role() = 'Admin'
  )
  WITH CHECK (
    id = public.get_org_id()
  );

NOTIFY pgrst, 'reload schema';
