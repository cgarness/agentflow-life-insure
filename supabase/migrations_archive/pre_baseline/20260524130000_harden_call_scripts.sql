-- =============================================================
-- Migration: call_scripts — schema/RLS hardening + platform Super Admin
-- Date: 2026-05-23
-- Purpose:
--   - organization_id NOT NULL (audit: 0 rows, 0 null_org confirmed)
--   - FK to organizations(id) already exists (no-op guard)
--   - Canonical updated_at trigger (public.update_updated_at)
--   - RLS rewritten:
--       SELECT  → own org OR is_super_admin()
--       INSERT/UPDATE/DELETE → Admin own org OR is_super_admin()
--       WITH CHECK on INSERT/UPDATE requires organization_id IS NOT NULL
-- Depends on: get_org_id(), get_user_role(), is_super_admin(), update_updated_at()
-- Does NOT use: super_admin_own_org() (platform Super Admin needs cross-org reach)
-- =============================================================

-- organization_id NOT NULL (safe: 0 rows in production at audit time)
ALTER TABLE public.call_scripts
  ALTER COLUMN organization_id SET NOT NULL;

-- FK to organizations(id) — idempotent guard (already present in prod, missing in some envs)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.call_scripts'::regclass
      AND contype = 'f'
      AND conname = 'call_scripts_organization_id_fkey'
  ) THEN
    ALTER TABLE public.call_scripts
      ADD CONSTRAINT call_scripts_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
  END IF;
END$$;

-- Canonical updated_at trigger (matches pipeline_stages, custom_fields, lead_sources, etc.)
DROP TRIGGER IF EXISTS call_scripts_updated_at ON public.call_scripts;
CREATE TRIGGER call_scripts_updated_at
  BEFORE UPDATE ON public.call_scripts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Reaffirm RLS
ALTER TABLE public.call_scripts ENABLE ROW LEVEL SECURITY;

-- Drop legacy permissive policies (initial migration)
DROP POLICY IF EXISTS "Allow authenticated users to view call scripts"   ON public.call_scripts;
DROP POLICY IF EXISTS "Allow authenticated users to manage call scripts" ON public.call_scripts;

-- Drop current org-scoped policies (will be replaced with helpers + Super Admin path)
DROP POLICY IF EXISTS call_scripts_select ON public.call_scripts;
DROP POLICY IF EXISTS call_scripts_insert ON public.call_scripts;
DROP POLICY IF EXISTS call_scripts_update ON public.call_scripts;
DROP POLICY IF EXISTS call_scripts_delete ON public.call_scripts;

-- SELECT — own org members, or platform Super Admin (all orgs)
CREATE POLICY call_scripts_select ON public.call_scripts
FOR SELECT TO authenticated
USING (
  organization_id = public.get_org_id()
  OR public.is_super_admin()
);

-- INSERT — Admin (own org) or platform Super Admin (any org); org_id required
CREATE POLICY call_scripts_insert ON public.call_scripts
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
CREATE POLICY call_scripts_update ON public.call_scripts
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
CREATE POLICY call_scripts_delete ON public.call_scripts
FOR DELETE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = 'Admin'::text
  )
);

NOTIFY pgrst, 'reload schema';
