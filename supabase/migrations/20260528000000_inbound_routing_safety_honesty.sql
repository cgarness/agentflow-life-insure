-- =============================================================================
-- Phone System — Inbound Routing data safety + validation + UI honesty
-- =============================================================================
-- Scope: inbound_routing_settings + business_hours
--   1. Backfill legacy null-org row to Chris home org and sanitize routing_mode
--   2. NOT NULL organization_id (after backfill)
--   3. Partial unique index: one routing row per org
--   4. routing_mode CHECK (assigned | all-ring | round_robin)
--   5. Rewrite RLS for both tables to helper-based, org-scoped, WITH CHECK
--   6. business_hours(organization_id, day_of_week) lookup index
--   7. PostgREST schema reload
--
-- Untouched: phone_numbers, phone_settings, calls, outbound dialer code.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Preflight — require helper functions
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.get_org_id()') IS NULL THEN
    RAISE EXCEPTION 'Missing helper: public.get_org_id()';
  END IF;
  IF to_regprocedure('public.get_user_role()') IS NULL THEN
    RAISE EXCEPTION 'Missing helper: public.get_user_role()';
  END IF;
  IF to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'Missing helper: public.is_super_admin()';
  END IF;
  IF to_regprocedure('public.super_admin_own_org(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing helper: public.super_admin_own_org(uuid)';
  END IF;
  IF to_regprocedure('public.update_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'Missing helper: public.update_updated_at()';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Backfill the legacy null-org inbound_routing_settings row
--    + sanitize routing_mode (legacy value 'first_available' is not in the UI)
-- ---------------------------------------------------------------------------
UPDATE public.inbound_routing_settings
SET
  organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid,
  routing_mode = CASE
    WHEN routing_mode IN ('assigned', 'all-ring', 'round_robin') THEN routing_mode
    ELSE 'assigned'
  END,
  updated_at = now()
WHERE organization_id IS NULL
  AND id = '00000000-0000-0000-0000-000000000000'::uuid;

-- Also normalize any other rows (defensive) without overwriting org-owned data.
UPDATE public.inbound_routing_settings
SET
  routing_mode = 'assigned',
  updated_at = now()
WHERE routing_mode NOT IN ('assigned', 'all-ring', 'round_robin');

-- Gate further phases on zero null-org rows.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT COUNT(*) INTO n FROM public.inbound_routing_settings WHERE organization_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'inbound_routing_settings still has % null-org rows; aborting', n;
  END IF;

  SELECT COUNT(*) INTO n FROM public.business_hours WHERE organization_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'business_hours has % null-org rows; aborting', n;
  END IF;

  -- One-per-org pre-check (no duplicates may exist before partial-unique index is added).
  SELECT COUNT(*) INTO n FROM (
    SELECT organization_id FROM public.inbound_routing_settings
    WHERE organization_id IS NOT NULL
    GROUP BY organization_id
    HAVING COUNT(*) > 1
  ) dups;
  IF n > 0 THEN
    RAISE EXCEPTION 'inbound_routing_settings has % organization_id with >1 row; aborting', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. NOT NULL organization_id on both tables (safe after preflight gates)
-- ---------------------------------------------------------------------------
ALTER TABLE public.inbound_routing_settings
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.business_hours
  ALTER COLUMN organization_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Partial unique index — one routing row per org (covers lookups by org)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS inbound_routing_settings_org_unique_idx
  ON public.inbound_routing_settings (organization_id);

-- ---------------------------------------------------------------------------
-- 4. routing_mode CHECK (matches the UI's allowed values)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inbound_routing_settings_routing_mode_check'
      AND conrelid = 'public.inbound_routing_settings'::regclass
  ) THEN
    ALTER TABLE public.inbound_routing_settings
      ADD CONSTRAINT inbound_routing_settings_routing_mode_check
      CHECK (routing_mode IN ('assigned', 'all-ring', 'round_robin'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5a. inbound_routing_settings RLS rewrite (helper-based, org-scoped, WITH CHECK)
-- ---------------------------------------------------------------------------
ALTER TABLE public.inbound_routing_settings ENABLE ROW LEVEL SECURITY;

-- Legacy / broken policies created by 20260511153600_inbound_routing_v2 and earlier
DROP POLICY IF EXISTS "Users can view their organization's routing settings" ON public.inbound_routing_settings;
DROP POLICY IF EXISTS "Admins can insert routing settings for their org" ON public.inbound_routing_settings;
DROP POLICY IF EXISTS "Admins can update routing settings for their org" ON public.inbound_routing_settings;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.inbound_routing_settings;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.inbound_routing_settings;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.inbound_routing_settings;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.inbound_routing_settings;
DROP POLICY IF EXISTS inbound_routing_settings_select ON public.inbound_routing_settings;
DROP POLICY IF EXISTS inbound_routing_settings_insert ON public.inbound_routing_settings;
DROP POLICY IF EXISTS inbound_routing_settings_update ON public.inbound_routing_settings;

CREATE POLICY inbound_routing_settings_select
  ON public.inbound_routing_settings
  FOR SELECT
  USING (
    organization_id = public.get_org_id()
    OR public.super_admin_own_org(organization_id)
  );

CREATE POLICY inbound_routing_settings_insert
  ON public.inbound_routing_settings
  FOR INSERT
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR public.is_super_admin()
    )
  );

CREATE POLICY inbound_routing_settings_update
  ON public.inbound_routing_settings
  FOR UPDATE
  USING (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR public.is_super_admin()
    )
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR public.is_super_admin()
    )
  );

-- No DELETE policy: routing settings are per-org permanent.

-- ---------------------------------------------------------------------------
-- 5b. business_hours RLS rewrite (helper-based, org-scoped, WITH CHECK)
-- ---------------------------------------------------------------------------
ALTER TABLE public.business_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read business hours" ON public.business_hours;
DROP POLICY IF EXISTS "Admins can modify business hours" ON public.business_hours;
DROP POLICY IF EXISTS business_hours_select ON public.business_hours;
DROP POLICY IF EXISTS business_hours_insert ON public.business_hours;
DROP POLICY IF EXISTS business_hours_update ON public.business_hours;
DROP POLICY IF EXISTS business_hours_delete ON public.business_hours;

CREATE POLICY business_hours_select
  ON public.business_hours
  FOR SELECT
  USING (
    organization_id = public.get_org_id()
    OR public.super_admin_own_org(organization_id)
  );

CREATE POLICY business_hours_insert
  ON public.business_hours
  FOR INSERT
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR public.is_super_admin()
    )
  );

CREATE POLICY business_hours_update
  ON public.business_hours
  FOR UPDATE
  USING (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR public.is_super_admin()
    )
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR public.is_super_admin()
    )
  );

CREATE POLICY business_hours_delete
  ON public.business_hours
  FOR DELETE
  USING (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'
      OR public.is_super_admin()
    )
  );

-- ---------------------------------------------------------------------------
-- 6. business_hours lookup index (matches webhook's checkBusinessHours query)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS business_hours_org_day_idx
  ON public.business_hours (organization_id, day_of_week);

-- ---------------------------------------------------------------------------
-- 7. PostgREST schema reload
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
