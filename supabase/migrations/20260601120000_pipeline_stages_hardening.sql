-- Contact Flow Build 2 — Pipeline stages hardening
--
-- Makes public.pipeline_stages a safe, org-scoped, seeded source of truth for
-- Lead and Recruit lifecycle stages.
--
-- 1. Pre-flight: assert required helpers exist (get_org_id, get_user_role,
--    is_super_admin, update_updated_at).
-- 2. Tighten the schema: organization_id NOT NULL (live audit confirms 0 NULL
--    rows pre-migration).
-- 3. Idempotent seed function public.seed_default_pipeline_stages(uuid).
--    SECURITY DEFINER, search_path pinned, REVOKEd from PUBLIC. Uses
--    INSERT ... SELECT ... WHERE NOT EXISTS keyed on lower(btrim(name)) per
--    (org, pipeline_type) — robust against existing whitespace-quirky rows
--    like "New " (trailing space).
-- 4. AFTER INSERT trigger on public.organizations to auto-seed new orgs.
--    Wrapped in EXCEPTION block so seeding failures never block org creation.
-- 5. One-shot backfill: seed every existing organization. Idempotent.
-- 6. Replace legacy pipeline_stages RLS with helper-based policies:
--    - SELECT: organization_id = get_org_id()
--    - INSERT / UPDATE: Admin or Super Admin within org
--    - DELETE: Admin or Super Admin within org AND is_default = false
-- 7. Indexes:
--    - org/type/sort + org/type lookup
--    - unique (org, pipeline_type, lower(btrim(name)))
--    - partial unique: at most one convert_to_client lead per org
-- 8. updated_at trigger uses public.update_updated_at().
--
-- Out of scope for this build (intentional): is_locked / active column adds,
-- lead source / custom field / field layout work, calendar / twilio changes.

-- ---------------------------------------------------------------------------
-- 1. Pre-flight: helpers must exist.
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_org_id'
  ) THEN missing := missing || 'public.get_org_id()'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_user_role'
  ) THEN missing := missing || 'public.get_user_role()'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_super_admin'
  ) THEN missing := missing || 'public.is_super_admin()'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at'
  ) THEN missing := missing || 'public.update_updated_at()'; END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'pipeline_stages_hardening: required helper(s) missing: %', missing;
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 2. Tighten schema: organization_id NOT NULL.
--    Live audit at plan time: 0 NULL organization_id rows.
-- ---------------------------------------------------------------------------
DO $tighten$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.pipeline_stages WHERE organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'pipeline_stages_hardening: cannot set organization_id NOT NULL — % NULL row(s) found',
      (SELECT count(*) FROM public.pipeline_stages WHERE organization_id IS NULL);
  END IF;
END
$tighten$;

ALTER TABLE public.pipeline_stages
  ALTER COLUMN organization_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Seed function — idempotent insertion of canonical default stages.
--    SECURITY DEFINER + REVOKE from PUBLIC. Only the AFTER INSERT trigger
--    and the migration backfill invoke this; the frontend never calls it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_pipeline_stages(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $seed$
BEGIN
  -- ===== Lead stages =====

  -- New (default + entry stage)
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, name, color, sort_order, is_default, is_positive, convert_to_client)
  SELECT p_organization_id, 'lead', 'New', '#3B82F6', 0, true, false, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = p_organization_id
      AND pipeline_type = 'lead'
      AND lower(btrim(name)) = lower(btrim('New'))
  );

  -- Attempting Contact
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, name, color, sort_order, is_default, is_positive, convert_to_client)
  SELECT p_organization_id, 'lead', 'Attempting Contact', '#6366F1', 1, false, false, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = p_organization_id
      AND pipeline_type = 'lead'
      AND lower(btrim(name)) = lower(btrim('Attempting Contact'))
  );

  -- Appointment Set
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, name, color, sort_order, is_default, is_positive, convert_to_client)
  SELECT p_organization_id, 'lead', 'Appointment Set', '#10B981', 2, false, false, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = p_organization_id
      AND pipeline_type = 'lead'
      AND lower(btrim(name)) = lower(btrim('Appointment Set'))
  );

  -- Quoted
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, name, color, sort_order, is_default, is_positive, convert_to_client)
  SELECT p_organization_id, 'lead', 'Quoted', '#F59E0B', 3, false, false, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = p_organization_id
      AND pipeline_type = 'lead'
      AND lower(btrim(name)) = lower(btrim('Quoted'))
  );

  -- Sold (positive + conversion). Only insert if neither name match nor
  -- any other convert_to_client lead row already exists for this org —
  -- the partial unique index allows only one conversion stage.
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, name, color, sort_order, is_default, is_positive, convert_to_client)
  SELECT p_organization_id, 'lead', 'Sold', '#059669', 4, false, true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = p_organization_id
      AND pipeline_type = 'lead'
      AND lower(btrim(name)) = lower(btrim('Sold'))
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = p_organization_id
      AND pipeline_type = 'lead'
      AND convert_to_client = true
  );

  -- Lost (NOT Dead — canonical default seed for terminal-lost outcomes)
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, name, color, sort_order, is_default, is_positive, convert_to_client)
  SELECT p_organization_id, 'lead', 'Lost', '#EF4444', 5, false, false, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = p_organization_id
      AND pipeline_type = 'lead'
      AND lower(btrim(name)) = lower(btrim('Lost'))
  );

  -- ===== Recruit stages =====

  -- New (default + entry stage)
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, name, color, sort_order, is_default, is_positive, convert_to_client)
  SELECT p_organization_id, 'recruit', 'New', '#3B82F6', 0, true, false, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = p_organization_id
      AND pipeline_type = 'recruit'
      AND lower(btrim(name)) = lower(btrim('New'))
  );

  -- Interview Scheduled
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, name, color, sort_order, is_default, is_positive, convert_to_client)
  SELECT p_organization_id, 'recruit', 'Interview Scheduled', '#6366F1', 1, false, false, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = p_organization_id
      AND pipeline_type = 'recruit'
      AND lower(btrim(name)) = lower(btrim('Interview Scheduled'))
  );

  -- Offer Made
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, name, color, sort_order, is_default, is_positive, convert_to_client)
  SELECT p_organization_id, 'recruit', 'Offer Made', '#F59E0B', 2, false, false, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = p_organization_id
      AND pipeline_type = 'recruit'
      AND lower(btrim(name)) = lower(btrim('Offer Made'))
  );

  -- Hired (positive)
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, name, color, sort_order, is_default, is_positive, convert_to_client)
  SELECT p_organization_id, 'recruit', 'Hired', '#10B981', 3, false, true, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = p_organization_id
      AND pipeline_type = 'recruit'
      AND lower(btrim(name)) = lower(btrim('Hired'))
  );

  -- Not a Fit
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, name, color, sort_order, is_default, is_positive, convert_to_client)
  SELECT p_organization_id, 'recruit', 'Not a Fit', '#EF4444', 4, false, false, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = p_organization_id
      AND pipeline_type = 'recruit'
      AND lower(btrim(name)) = lower(btrim('Not a Fit'))
  );
END;
$seed$;

REVOKE ALL ON FUNCTION public.seed_default_pipeline_stages(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. AFTER INSERT trigger on organizations — never blocks the insert.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_organization_seed_pipeline_stages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $trg$
BEGIN
  BEGIN
    PERFORM public.seed_default_pipeline_stages(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'seed_default_pipeline_stages failed for organization %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$trg$;

DROP TRIGGER IF EXISTS on_organization_created_seed_pipeline_stages ON public.organizations;
CREATE TRIGGER on_organization_created_seed_pipeline_stages
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_organization_seed_pipeline_stages();

-- ---------------------------------------------------------------------------
-- 5. Backfill — idempotent across reruns.
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_pipeline_stages(org_record.id);
  END LOOP;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- 6. RLS hardening — drop legacy policies, install helper-based + default guard.
-- ---------------------------------------------------------------------------
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipeline_stages_select ON public.pipeline_stages;
DROP POLICY IF EXISTS pipeline_stages_insert ON public.pipeline_stages;
DROP POLICY IF EXISTS pipeline_stages_update ON public.pipeline_stages;
DROP POLICY IF EXISTS pipeline_stages_delete ON public.pipeline_stages;

CREATE POLICY pipeline_stages_select
  ON public.pipeline_stages
  FOR SELECT
  USING (organization_id = public.get_org_id());

CREATE POLICY pipeline_stages_insert
  ON public.pipeline_stages
  FOR INSERT
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  );

CREATE POLICY pipeline_stages_update
  ON public.pipeline_stages
  FOR UPDATE
  USING (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  );

-- DELETE: Admin / Super Admin within org, and only on non-default rows.
-- DB-level default-stage protection (mirrors appointment_types pattern).
CREATE POLICY pipeline_stages_delete
  ON public.pipeline_stages
  FOR DELETE
  USING (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
    AND is_default = false
  );

-- ---------------------------------------------------------------------------
-- 7. Indexes.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS pipeline_stages_org_type_sort_idx
  ON public.pipeline_stages (organization_id, pipeline_type, sort_order);

CREATE INDEX IF NOT EXISTS pipeline_stages_org_type_idx
  ON public.pipeline_stages (organization_id, pipeline_type);

-- Case-insensitive, whitespace-trimmed uniqueness per (org, pipeline_type).
-- Live audit at plan time: 0 dup groups under lower(btrim(name)).
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_org_type_lower_name_unique
  ON public.pipeline_stages (organization_id, pipeline_type, lower(btrim(name)));

-- One lead conversion stage per organization.
-- Live audit at plan time: every org has 0 or 1 such row.
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_one_lead_conversion_per_org_unique
  ON public.pipeline_stages (organization_id)
  WHERE pipeline_type = 'lead' AND convert_to_client = true;

-- ---------------------------------------------------------------------------
-- 8. updated_at trigger.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS pipeline_stages_updated_at ON public.pipeline_stages;
CREATE TRIGGER pipeline_stages_updated_at
  BEFORE UPDATE ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

NOTIFY pgrst, 'reload schema';
