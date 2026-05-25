-- Contact Flow Build 4 — Custom fields hardening + classify null-org rows as system templates.
--
-- Locked ownership model (see AGENT_RULES.md §5):
--   * System templates  = organization_id IS NULL AND created_by IS NULL  (read-only forever)
--   * Agency-wide       = organization_id set,    created_by IS NULL      (Admin / Super Admin)
--   * Personal          = organization_id set,    created_by set          (creator only)
--
-- This migration does NOT delete, migrate, or convert the 72 existing system-template
-- rows. It also does NOT set custom_fields.organization_id NOT NULL.

-- 1) Pre-flight helpers
DO $$
BEGIN
  IF to_regprocedure('public.get_org_id()') IS NULL THEN
    RAISE EXCEPTION 'Missing helper public.get_org_id()';
  END IF;
  IF to_regprocedure('public.get_user_role()') IS NULL THEN
    RAISE EXCEPTION 'Missing helper public.get_user_role()';
  END IF;
  IF to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'Missing helper public.is_super_admin()';
  END IF;
  IF to_regprocedure('public.update_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'Missing helper public.update_updated_at()';
  END IF;
  IF to_regprocedure('public.super_admin_own_org(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing helper public.super_admin_own_org(uuid)';
  END IF;
END $$;

-- 2) Tighten safe nullable columns. Live audit pre-migration showed 0 NULLs.
UPDATE public.custom_fields SET active   = TRUE  WHERE active   IS NULL;
UPDATE public.custom_fields SET required = FALSE WHERE required IS NULL;
ALTER TABLE public.custom_fields ALTER COLUMN active   SET NOT NULL;
ALTER TABLE public.custom_fields ALTER COLUMN required SET NOT NULL;
-- organization_id and created_by intentionally remain nullable (system templates).

-- 3) Indexes. The existing (organization_id, created_by) btree is kept.
CREATE INDEX IF NOT EXISTS custom_fields_org_idx
  ON public.custom_fields (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS custom_fields_created_by_idx
  ON public.custom_fields (created_by)
  WHERE created_by IS NOT NULL;

-- Agency-wide names are unique per org, case-insensitive, active rows only.
CREATE UNIQUE INDEX IF NOT EXISTS custom_fields_agency_lower_name_unique
  ON public.custom_fields (organization_id, lower(btrim(name)))
  WHERE organization_id IS NOT NULL AND created_by IS NULL AND active IS TRUE;

-- Personal names are unique per (org, creator), case-insensitive, active rows only.
CREATE UNIQUE INDEX IF NOT EXISTS custom_fields_personal_lower_name_unique
  ON public.custom_fields (organization_id, created_by, lower(btrim(name)))
  WHERE organization_id IS NOT NULL AND created_by IS NOT NULL AND active IS TRUE;

-- 4) updated_at trigger
DROP TRIGGER IF EXISTS custom_fields_updated_at ON public.custom_fields;
CREATE TRIGGER custom_fields_updated_at
  BEFORE UPDATE ON public.custom_fields
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- 5) RLS — drop and recreate the four policies under the locked ownership model.
ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_fields_select ON public.custom_fields;
DROP POLICY IF EXISTS custom_fields_insert ON public.custom_fields;
DROP POLICY IF EXISTS custom_fields_update ON public.custom_fields;
DROP POLICY IF EXISTS custom_fields_delete ON public.custom_fields;

-- SELECT: super admin (own org), system templates (read-only), agency-wide in org,
-- own personal, and Admin / Super Admin can see other users' personal in their org.
CREATE POLICY custom_fields_select
  ON public.custom_fields
  FOR SELECT
  TO authenticated
  USING (
    public.super_admin_own_org(organization_id)
    OR (organization_id IS NULL AND created_by IS NULL)
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.get_org_id()
      AND (
        created_by IS NULL
        OR created_by = auth.uid()
        OR public.get_user_role() = 'Admin'
        OR public.is_super_admin()
      )
    )
  );

-- INSERT: personal field for self, OR agency-wide for Admin / Super Admin.
-- Team Leader and Agent can only INSERT personal rows. System templates can never
-- be inserted from the app (organization_id IS NULL fails the org check).
CREATE POLICY custom_fields_insert
  ON public.custom_fields
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = public.get_org_id()
    AND (
      created_by = auth.uid()
      OR (
        created_by IS NULL
        AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
      )
    )
  );

-- UPDATE: own personal field, OR agency-wide for Admin / Super Admin. Personal
-- fields belonging to other users are NOT updatable by Admin in this build.
-- WITH CHECK mirrors USING so organization_id cannot be reassigned and created_by
-- cannot escalate (a personal owner cannot null out created_by; an admin cannot
-- adopt someone else's personal row).
CREATE POLICY custom_fields_update
  ON public.custom_fields
  FOR UPDATE
  TO authenticated
  USING (
    public.super_admin_own_org(organization_id)
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.get_org_id()
      AND (
        (created_by IS NOT NULL AND created_by = auth.uid())
        OR (created_by IS NULL AND (public.get_user_role() = 'Admin' OR public.is_super_admin()))
      )
    )
  )
  WITH CHECK (
    public.super_admin_own_org(organization_id)
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.get_org_id()
      AND (
        (created_by IS NOT NULL AND created_by = auth.uid())
        OR (created_by IS NULL AND (public.get_user_role() = 'Admin' OR public.is_super_admin()))
      )
    )
  );

-- DELETE: same gate as UPDATE USING.
CREATE POLICY custom_fields_delete
  ON public.custom_fields
  FOR DELETE
  TO authenticated
  USING (
    public.super_admin_own_org(organization_id)
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.get_org_id()
      AND (
        (created_by IS NOT NULL AND created_by = auth.uid())
        OR (created_by IS NULL AND (public.get_user_role() = 'Admin' OR public.is_super_admin()))
      )
    )
  );
