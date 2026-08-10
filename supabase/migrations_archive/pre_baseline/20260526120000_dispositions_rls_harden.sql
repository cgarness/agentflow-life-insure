-- =============================================================
-- Migration: dispositions — RLS / schema hardening (Build 2)
-- Date: 2026-05-26
-- Audit (pre-apply, project jncvvsvckxhqgqvkppmj):
--   total rows = 6 (all in home org a0000000-0000-0000-0000-000000000001)
--   null organization_id = 0  -> SET NOT NULL is safe
--   duplicate lower(name) per organization_id = 0 groups -> unique index safe
--   updated_at trigger: MISSING
--   composite (organization_id, sort_order) index: MISSING
--   existing policies: 4 legacy (use get_user_org_id(); INSERT/UPDATE lack Admin
--     gate; UPDATE lacks WITH CHECK; no Super Admin bypass)
-- Purpose:
--   - dispositions.organization_id NOT NULL
--   - (organization_id, sort_order) composite index
--   - unique (organization_id, lower(name)) index
--   - canonical updated_at trigger via public.update_updated_at()
--   - replace RLS with Admin-own-org or Super Admin policies using
--     public.get_org_id(), public.get_user_role(), public.is_super_admin()
-- Preserves Build 1 invariant:
--   - campaign_action and dnc_auto_add remain canonical (untouched).
--   - remove_from_queue and auto_add_to_dnc remain DEPRECATED but NOT dropped.
-- Depends on: public.get_org_id(), public.get_user_role(),
--             public.is_super_admin(), public.update_updated_at()
-- =============================================================

-- ---------------------------------------------------------------
-- 1. organization_id NOT NULL — guard then alter
-- ---------------------------------------------------------------
DO $$
DECLARE
  null_org_count integer;
BEGIN
  SELECT count(*) INTO null_org_count
  FROM public.dispositions
  WHERE organization_id IS NULL;

  IF null_org_count > 0 THEN
    RAISE EXCEPTION
      'Cannot SET NOT NULL on dispositions.organization_id: % row(s) have NULL organization_id. Backfill first.',
      null_org_count;
  END IF;
END$$;

ALTER TABLE public.dispositions
  ALTER COLUMN organization_id SET NOT NULL;

-- ---------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------
-- (organization_id) index already exists as idx_dispositions_org — leave alone.
CREATE INDEX IF NOT EXISTS idx_dispositions_org_sort_order
  ON public.dispositions (organization_id, sort_order);

-- Refuse to add the unique case-insensitive name index if duplicates appeared
-- between plan-time audit and apply-time.
DO $$
DECLARE
  dup_groups integer;
BEGIN
  SELECT count(*) INTO dup_groups
  FROM (
    SELECT 1
    FROM public.dispositions
    GROUP BY organization_id, lower(name)
    HAVING count(*) > 1
  ) s;

  IF dup_groups > 0 THEN
    RAISE EXCEPTION
      'Cannot add unique (organization_id, lower(name)) index: % duplicate group(s) detected. Resolve duplicates first.',
      dup_groups;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS dispositions_org_lower_name_unique
  ON public.dispositions (organization_id, lower(name));

-- ---------------------------------------------------------------
-- 3. updated_at trigger (canonical helper)
-- ---------------------------------------------------------------
DROP TRIGGER IF EXISTS dispositions_updated_at ON public.dispositions;
CREATE TRIGGER dispositions_updated_at
  BEFORE UPDATE ON public.dispositions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------
-- 4. RLS — drop legacy + any future-named variants, then recreate
-- ---------------------------------------------------------------
ALTER TABLE public.dispositions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispositions_select ON public.dispositions;
DROP POLICY IF EXISTS dispositions_insert ON public.dispositions;
DROP POLICY IF EXISTS dispositions_update ON public.dispositions;
DROP POLICY IF EXISTS dispositions_delete ON public.dispositions;
-- defensive drops for older/legacy names
DROP POLICY IF EXISTS dispositions_select_policy ON public.dispositions;
DROP POLICY IF EXISTS dispositions_insert_policy ON public.dispositions;
DROP POLICY IF EXISTS dispositions_update_policy ON public.dispositions;
DROP POLICY IF EXISTS dispositions_delete_policy ON public.dispositions;
DROP POLICY IF EXISTS "Users can view their org dispositions" ON public.dispositions;
DROP POLICY IF EXISTS "Users can manage their org dispositions" ON public.dispositions;

-- SELECT: own org OR Super Admin
CREATE POLICY dispositions_select ON public.dispositions
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
);

-- INSERT: org_id required; Admin-own-org OR Super Admin
CREATE POLICY dispositions_insert ON public.dispositions
FOR INSERT TO authenticated
WITH CHECK (
  organization_id IS NOT NULL
  AND (
    public.is_super_admin()
    OR (
      organization_id = public.get_org_id()
      AND public.get_user_role() = 'Admin'
    )
  )
);

-- UPDATE: USING + WITH CHECK both gated (prevents cross-org reassignment)
CREATE POLICY dispositions_update ON public.dispositions
FOR UPDATE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = 'Admin'
  )
)
WITH CHECK (
  organization_id IS NOT NULL
  AND (
    public.is_super_admin()
    OR (
      organization_id = public.get_org_id()
      AND public.get_user_role() = 'Admin'
    )
  )
);

-- DELETE: Admin-own-org OR Super Admin
CREATE POLICY dispositions_delete ON public.dispositions
FOR DELETE TO authenticated
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND public.get_user_role() = 'Admin'
  )
);

NOTIFY pgrst, 'reload schema';
