-- =============================================================
-- Phone System Foundation: RLS hardening for phone_settings + phone_numbers
-- Drops all wide-open legacy policies and replaces with org-scoped
-- helper-based policies using get_org_id(), super_admin_own_org(),
-- get_user_role(), is_super_admin().
--
-- Also: NOT NULL on organization_id (gated), partial unique index
-- for one-default-per-org (gated), singleton_check removal.
-- =============================================================

-- ── Phase A: phone_settings — drop legacy wide-open policies ────────────

DROP POLICY IF EXISTS "Allow authenticated users to read phone settings" ON public.phone_settings;
DROP POLICY IF EXISTS "Allow authenticated users to update phone settings" ON public.phone_settings;
DROP POLICY IF EXISTS "Allow authenticated users to insert phone settings" ON public.phone_settings;
-- Also drop the 4th policy (from 20260326170000) in case the 20260512 hotfix didn't run
DROP POLICY IF EXISTS "Authenticated users can manage phone settings" ON public.phone_settings;

-- Drop existing helper policies to prevent duplicate errors
DROP POLICY IF EXISTS phone_settings_select ON public.phone_settings;
DROP POLICY IF EXISTS phone_settings_insert ON public.phone_settings;
DROP POLICY IF EXISTS phone_settings_update ON public.phone_settings;

-- Drop singleton constraint — no longer valid for per-org settings
ALTER TABLE public.phone_settings DROP CONSTRAINT IF EXISTS singleton_check;

-- Org-scoped replacements (house pattern)
CREATE POLICY phone_settings_select ON public.phone_settings
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    OR public.super_admin_own_org(organization_id)
  );

CREATE POLICY phone_settings_insert ON public.phone_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  );

CREATE POLICY phone_settings_update ON public.phone_settings
  FOR UPDATE TO authenticated
  USING (
    (organization_id = public.get_org_id() AND (public.get_user_role() = 'Admin' OR public.is_super_admin()))
    OR public.super_admin_own_org(organization_id)
  )
  WITH CHECK (
    (organization_id = public.get_org_id() AND (public.get_user_role() = 'Admin' OR public.is_super_admin()))
    OR public.super_admin_own_org(organization_id)
  );

-- No DELETE policy — phone_settings rows are per-org permanent records.


-- ── Phase B: phone_numbers — drop legacy policies, replace org-scoped ───

DROP POLICY IF EXISTS "Users can view their organization's phone numbers" ON public.phone_numbers;
DROP POLICY IF EXISTS "Users can manage their organization's phone numbers" ON public.phone_numbers;
-- Also drop originals in case they somehow survived
DROP POLICY IF EXISTS "Allow authenticated users to view phone numbers" ON public.phone_numbers;
DROP POLICY IF EXISTS "Allow authenticated users to manage phone numbers" ON public.phone_numbers;

-- Drop existing helper policies to prevent duplicate errors
DROP POLICY IF EXISTS phone_numbers_select ON public.phone_numbers;
DROP POLICY IF EXISTS phone_numbers_insert ON public.phone_numbers;
DROP POLICY IF EXISTS phone_numbers_update ON public.phone_numbers;
DROP POLICY IF EXISTS phone_numbers_delete ON public.phone_numbers;

CREATE POLICY phone_numbers_select ON public.phone_numbers
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    OR public.super_admin_own_org(organization_id)
  );

CREATE POLICY phone_numbers_insert ON public.phone_numbers
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  );

CREATE POLICY phone_numbers_update ON public.phone_numbers
  FOR UPDATE TO authenticated
  USING (
    (organization_id = public.get_org_id() AND (public.get_user_role() = 'Admin' OR public.is_super_admin()))
    OR public.super_admin_own_org(organization_id)
  )
  WITH CHECK (
    (organization_id = public.get_org_id() AND (public.get_user_role() = 'Admin' OR public.is_super_admin()))
    OR public.super_admin_own_org(organization_id)
  );

CREATE POLICY phone_numbers_delete ON public.phone_numbers
  FOR DELETE TO authenticated
  USING (
    (organization_id = public.get_org_id() AND (public.get_user_role() = 'Admin' OR public.is_super_admin()))
    OR public.super_admin_own_org(organization_id)
  );


-- ── Phase C: NOT NULL on organization_id (gated on live precheck) ───────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.phone_settings WHERE organization_id IS NULL) THEN
    ALTER TABLE public.phone_settings ALTER COLUMN organization_id SET NOT NULL;
    RAISE NOTICE 'phone_settings.organization_id set to NOT NULL';
  ELSE
    RAISE NOTICE 'SKIPPED: phone_settings has NULL organization_id rows — manual cleanup required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.phone_numbers WHERE organization_id IS NULL) THEN
    ALTER TABLE public.phone_numbers ALTER COLUMN organization_id SET NOT NULL;
    RAISE NOTICE 'phone_numbers.organization_id set to NOT NULL';
  ELSE
    RAISE NOTICE 'SKIPPED: phone_numbers has NULL organization_id rows — manual cleanup required';
  END IF;
END $$;


-- ── Phase D: Partial unique index — one active default number per org ────

DO $$
DECLARE
  violation_count int;
BEGIN
  SELECT count(*) INTO violation_count
  FROM (
    SELECT organization_id
    FROM public.phone_numbers
    WHERE is_default = true AND status = 'active'
    GROUP BY organization_id
    HAVING count(*) > 1
  ) dups;

  IF violation_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_numbers_one_default_per_org
      ON public.phone_numbers (organization_id)
      WHERE is_default = true AND status = 'active';
    RAISE NOTICE 'Unique default-per-org index created';
  ELSE
    RAISE NOTICE 'SKIPPED: % org(s) have multiple active default numbers — manual cleanup required', violation_count;
  END IF;
END $$;


-- ── Phase E: Refresh schema cache ──────────────────────────────────────

NOTIFY pgrst, 'reload schema';
