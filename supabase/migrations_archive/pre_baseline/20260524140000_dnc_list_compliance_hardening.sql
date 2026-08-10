-- =============================================================
-- Migration: DNC List compliance hardening
-- Purpose:
--   1. Require organization_id (NOT NULL) so every row is org-owned.
--   2. Replace global UNIQUE(phone_number) with composite
--      UNIQUE(organization_id, phone_number) — different agencies
--      can independently maintain the same number.
--   3. Drop ALL existing RLS policies (multiple overlapping sets
--      from prior migrations) and recreate a single canonical set:
--        - SELECT: own org OR platform Super Admin
--        - INSERT/UPDATE/DELETE: own org Admin OR platform Super Admin
--      (No NULL-organization_id branches anywhere.)
-- Safety: production audit pre-apply confirmed 0 rows, 0 NULL org_id.
-- =============================================================

-- 1. Safety guard: refuse to proceed if any rows have NULL organization_id.
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT count(*) INTO null_count FROM public.dnc_list WHERE organization_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'dnc_list has % rows with NULL organization_id; backfill before applying this migration', null_count;
  END IF;
END $$;

-- 2. Tighten organization_id to NOT NULL.
ALTER TABLE public.dnc_list
  ALTER COLUMN organization_id SET NOT NULL;

-- 3. Replace global phone_number unique with org-scoped composite unique.
ALTER TABLE public.dnc_list
  DROP CONSTRAINT IF EXISTS dnc_list_phone_number_key;

ALTER TABLE public.dnc_list
  ADD CONSTRAINT dnc_list_org_phone_unique UNIQUE (organization_id, phone_number);

-- 4. Wipe ALL existing policies on dnc_list to clear the overlapping sets
--    left behind by prior migrations.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dnc_list'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.dnc_list', pol.policyname);
  END LOOP;
END $$;

-- 5. Canonical RLS policies.
-- SELECT: anyone in the owning org, or a platform Super Admin.
CREATE POLICY "dnc_list_select"
  ON public.dnc_list
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    OR public.is_super_admin()
  );

-- INSERT: Admin of the owning org, or a platform Super Admin.
CREATE POLICY "dnc_list_insert"
  ON public.dnc_list
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      organization_id = public.get_user_org_id()
      AND public.get_user_role() = 'Admin'
    )
  );

-- UPDATE: Admin of the owning org, or a platform Super Admin.
CREATE POLICY "dnc_list_update"
  ON public.dnc_list
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      organization_id = public.get_user_org_id()
      AND public.get_user_role() = 'Admin'
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      organization_id = public.get_user_org_id()
      AND public.get_user_role() = 'Admin'
    )
  );

-- DELETE: Admin of the owning org, or a platform Super Admin.
CREATE POLICY "dnc_list_delete"
  ON public.dnc_list
  FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      organization_id = public.get_user_org_id()
      AND public.get_user_role() = 'Admin'
    )
  );

-- 6. Refresh PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
