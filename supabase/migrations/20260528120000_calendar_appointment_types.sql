-- Calendar Pass 2 — Appointment Type source of truth
--
-- Adds public.appointment_types as the org-scoped, persisted source of truth
-- for calendar appointment types. Seeds the six default locked types for every
-- existing organization and installs an AFTER INSERT trigger on
-- public.organizations so that new orgs get the same defaults regardless of
-- which creation path is used (self-serve create-organization Edge Function,
-- Super Admin "Provision new agency" wizard, or any future caller).
--
-- Hardening notes:
-- 1. Locked defaults are protected from hard DELETE at the DB/RLS level
--    (DELETE policy requires is_locked = false). Full locked-row immutability
--    (preventing Admin UPDATE to rename, unlock, or deactivate locked rows)
--    is intentionally deferred to a later pass — UI must hide those actions
--    for locked defaults.
-- 2. Seeding uses INSERT ... SELECT ... WHERE NOT EXISTS, NOT ON CONFLICT —
--    the unique active-name index is partial (WHERE is_active = true) so
--    ON CONFLICT would not catch the intended uniqueness target.
-- 3. New-org seeding lives in a DB trigger to cover the Super Admin direct
--    insert path that bypasses create-organization. Mirrors the pattern set
--    by on_organization_created_provision_twilio.

CREATE TABLE IF NOT EXISTS public.appointment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_types_name_length_chk
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  CONSTRAINT appointment_types_color_hex_chk
    CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT appointment_types_duration_range_chk
    CHECK (duration_minutes BETWEEN 5 AND 240)
);

CREATE UNIQUE INDEX IF NOT EXISTS appointment_types_org_lower_name_active_unique
  ON public.appointment_types (organization_id, lower(name))
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS appointment_types_org_sort_idx
  ON public.appointment_types (organization_id, sort_order);

CREATE INDEX IF NOT EXISTS appointment_types_org_active_idx
  ON public.appointment_types (organization_id, is_active);

-- updated_at trigger
DROP TRIGGER IF EXISTS appointment_types_updated_at ON public.appointment_types;
CREATE TRIGGER appointment_types_updated_at
  BEFORE UPDATE ON public.appointment_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE public.appointment_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_types_select ON public.appointment_types;
CREATE POLICY appointment_types_select
  ON public.appointment_types
  FOR SELECT
  USING (organization_id = public.get_org_id());

DROP POLICY IF EXISTS appointment_types_insert ON public.appointment_types;
CREATE POLICY appointment_types_insert
  ON public.appointment_types
  FOR INSERT
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  );

DROP POLICY IF EXISTS appointment_types_update ON public.appointment_types;
CREATE POLICY appointment_types_update
  ON public.appointment_types
  FOR UPDATE
  USING (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
  );

-- DELETE policy intentionally requires is_locked = false so locked defaults
-- cannot be hard-deleted through normal RLS even by Admin / Super Admin.
DROP POLICY IF EXISTS appointment_types_delete ON public.appointment_types;
CREATE POLICY appointment_types_delete
  ON public.appointment_types
  FOR DELETE
  USING (
    organization_id = public.get_org_id()
    AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
    AND is_locked = false
  );

-- Seed function — idempotent insertion of the six default locked types.
-- SECURITY DEFINER + REVOKE from PUBLIC: only the AFTER INSERT trigger and
-- the migration backfill invoke this. The frontend never calls it.
CREATE OR REPLACE FUNCTION public.seed_default_appointment_types(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sales Call
  INSERT INTO public.appointment_types
    (organization_id, name, color, duration_minutes, sort_order, is_default, is_locked, is_active)
  SELECT p_organization_id, 'Sales Call', '#3B82F6', 30, 10, true, true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.appointment_types
    WHERE organization_id = p_organization_id
      AND lower(name) = lower('Sales Call')
      AND is_active = true
  );

  -- Follow Up
  INSERT INTO public.appointment_types
    (organization_id, name, color, duration_minutes, sort_order, is_default, is_locked, is_active)
  SELECT p_organization_id, 'Follow Up', '#F97316', 20, 20, true, true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.appointment_types
    WHERE organization_id = p_organization_id
      AND lower(name) = lower('Follow Up')
      AND is_active = true
  );

  -- Recruit Interview
  INSERT INTO public.appointment_types
    (organization_id, name, color, duration_minutes, sort_order, is_default, is_locked, is_active)
  SELECT p_organization_id, 'Recruit Interview', '#A855F7', 45, 30, true, true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.appointment_types
    WHERE organization_id = p_organization_id
      AND lower(name) = lower('Recruit Interview')
      AND is_active = true
  );

  -- Policy Review
  INSERT INTO public.appointment_types
    (organization_id, name, color, duration_minutes, sort_order, is_default, is_locked, is_active)
  SELECT p_organization_id, 'Policy Review', '#22C55E', 60, 40, true, true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.appointment_types
    WHERE organization_id = p_organization_id
      AND lower(name) = lower('Policy Review')
      AND is_active = true
  );

  -- Policy Anniversary
  INSERT INTO public.appointment_types
    (organization_id, name, color, duration_minutes, sort_order, is_default, is_locked, is_active)
  SELECT p_organization_id, 'Policy Anniversary', '#EC4899', 60, 50, true, true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.appointment_types
    WHERE organization_id = p_organization_id
      AND lower(name) = lower('Policy Anniversary')
      AND is_active = true
  );

  -- Other
  INSERT INTO public.appointment_types
    (organization_id, name, color, duration_minutes, sort_order, is_default, is_locked, is_active)
  SELECT p_organization_id, 'Other', '#64748B', 30, 60, true, true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.appointment_types
    WHERE organization_id = p_organization_id
      AND lower(name) = lower('Other')
      AND is_active = true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_default_appointment_types(uuid) FROM PUBLIC;

-- AFTER INSERT trigger on organizations — never blocks the insert.
CREATE OR REPLACE FUNCTION public.handle_new_organization_seed_appointment_types()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.seed_default_appointment_types(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'seed_default_appointment_types failed for organization %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_organization_created_seed_appointment_types ON public.organizations;
CREATE TRIGGER on_organization_created_seed_appointment_types
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_organization_seed_appointment_types();

-- Backfill: seed defaults for every existing organization. Idempotent via
-- the NOT EXISTS guard inside the seed function.
DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_appointment_types(org_record.id);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
