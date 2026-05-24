-- Calendar Pass 1a — Appointment Tenant Hardening.
-- Goal: make public.appointments tenant-safe at the DB/RLS layer.
--   1. Guard helper functions exist.
--   2. Guard backfill safety, then backfill appointments.organization_id from
--      user_id -> profiles.organization_id (preferred) or created_by -> profile.
--   3. SET NOT NULL on organization_id.
--   4. Canonical updated_at trigger via public.update_updated_at().
--   5. Useful indexes: composite (organization_id, start_time) and
--      (user_id, start_time); drop duplicate idx_appointments_org.
--   6. Replace the legacy "Hierarchical Appointments Access" FOR ALL policy
--      with four helper-based per-command policies. Super Admin stays
--      org-scoped in normal Calendar RLS. Team Leader SELECT/UPDATE behavior
--      preserved verbatim. DELETE narrowed to owner/created_by/Admin/Super
--      per Chris's explicit redline on 2026-05-24 (was: Team Leader same-team
--      could also delete via the legacy FOR ALL policy).

-- 1. Helper functions must exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_org_id') THEN
    RAISE EXCEPTION 'Missing helper function public.get_org_id()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_user_role') THEN
    RAISE EXCEPTION 'Missing helper function public.get_user_role()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'is_super_admin') THEN
    RAISE EXCEPTION 'Missing helper function public.is_super_admin()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'update_updated_at') THEN
    RAISE EXCEPTION 'Missing helper function public.update_updated_at()';
  END IF;
END $$;

-- 2a. Refuse to apply if any null-org row cannot be mapped from user_id or created_by.
DO $$
DECLARE
  v_unmappable int;
BEGIN
  SELECT count(*) INTO v_unmappable
  FROM public.appointments a
  WHERE a.organization_id IS NULL
    AND COALESCE(
      (SELECT p.organization_id FROM public.profiles p WHERE p.id = a.user_id),
      (SELECT p.organization_id FROM public.profiles p WHERE p.id = a.created_by)
    ) IS NULL;

  IF v_unmappable > 0 THEN
    RAISE EXCEPTION
      'Aborting: % appointment row(s) have NULL organization_id and cannot be mapped from user_id or created_by to a profile organization_id',
      v_unmappable;
  END IF;
END $$;

-- 2b. Refuse to apply if user_id and created_by map to different non-null orgs.
DO $$
DECLARE
  v_conflicts int;
BEGIN
  SELECT count(*) INTO v_conflicts
  FROM public.appointments a
  WHERE a.user_id IS NOT NULL
    AND a.created_by IS NOT NULL
    AND (SELECT p.organization_id FROM public.profiles p WHERE p.id = a.user_id) IS NOT NULL
    AND (SELECT p.organization_id FROM public.profiles p WHERE p.id = a.created_by) IS NOT NULL
    AND (SELECT p.organization_id FROM public.profiles p WHERE p.id = a.user_id)
      <> (SELECT p.organization_id FROM public.profiles p WHERE p.id = a.created_by);

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION
      'Aborting: % appointment row(s) have user_id and created_by mapping to different organization_ids',
      v_conflicts;
  END IF;
END $$;

-- 2c. Refuse to apply if existing non-null organization_id conflicts with the user_id profile organization_id.
DO $$
DECLARE
  v_conflicts int;
BEGIN
  SELECT count(*) INTO v_conflicts
  FROM public.appointments a
  WHERE a.organization_id IS NOT NULL
    AND a.user_id IS NOT NULL
    AND (SELECT p.organization_id FROM public.profiles p WHERE p.id = a.user_id) IS NOT NULL
    AND (SELECT p.organization_id FROM public.profiles p WHERE p.id = a.user_id) <> a.organization_id;

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION
      'Aborting: % appointment row(s) have organization_id conflicting with the user_id profile organization_id',
      v_conflicts;
  END IF;
END $$;

-- 2d. Backfill organization_id from profile mapping. user_id preferred, created_by fallback.
UPDATE public.appointments a
SET organization_id = COALESCE(
  (SELECT p.organization_id FROM public.profiles p WHERE p.id = a.user_id),
  (SELECT p.organization_id FROM public.profiles p WHERE p.id = a.created_by)
)
WHERE a.organization_id IS NULL;

-- 3. NOT NULL.
ALTER TABLE public.appointments ALTER COLUMN organization_id SET NOT NULL;

-- 4. Canonical updated_at trigger (idempotent).
DROP TRIGGER IF EXISTS appointments_updated_at ON public.appointments;
CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- 5. Indexes.
-- Drop duplicate org index (idx_appointments_organization_id covers it; both are btree on organization_id alone).
DROP INDEX IF EXISTS public.idx_appointments_org;

-- Add composite indexes. Existing indexes (idx_appointments_organization_id,
-- idx_appointments_user_id, idx_appointments_google_external_event) are preserved.
CREATE INDEX IF NOT EXISTS appointments_org_start_time_idx
  ON public.appointments (organization_id, start_time);

CREATE INDEX IF NOT EXISTS appointments_user_start_time_idx
  ON public.appointments (user_id, start_time);

-- 6. RLS — replace the legacy broad FOR ALL policy with four per-command policies.

-- Drop the legacy policy (exact name from live pg_policy).
DROP POLICY IF EXISTS "Hierarchical Appointments Access" ON public.appointments;

-- Drop the new policy names if they already exist (idempotent re-apply).
DROP POLICY IF EXISTS appointments_select ON public.appointments;
DROP POLICY IF EXISTS appointments_insert ON public.appointments;
DROP POLICY IF EXISTS appointments_update ON public.appointments;
DROP POLICY IF EXISTS appointments_delete ON public.appointments;

-- SELECT: org-scoped; owner/created-by; Admin; Super Admin; Team Leader same-team (verbatim).
CREATE POLICY appointments_select ON public.appointments
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND (
      user_id = auth.uid()
      OR created_by = auth.uid()
      OR public.get_user_role() = 'Admin'
      OR public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'Team Leader'
          AND p.team_id IS NOT NULL
          AND appointments.user_id IN (
            SELECT id FROM public.profiles WHERE team_id = p.team_id
          )
      )
    )
  );

-- INSERT (WITH CHECK only): every writer must target their own org; owner OR
-- created_by OR Admin/Team Leader OR Super Admin. Super Admin stays org-scoped.
CREATE POLICY appointments_insert ON public.appointments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      user_id = auth.uid()
      OR created_by = auth.uid()
      OR public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

-- UPDATE: USING mirrors SELECT (preserves Team Leader same-team visibility).
-- WITH CHECK rejects cross-org reassignment (forces same org for everyone, including Super Admin).
CREATE POLICY appointments_update ON public.appointments
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND (
      user_id = auth.uid()
      OR created_by = auth.uid()
      OR public.get_user_role() = 'Admin'
      OR public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'Team Leader'
          AND p.team_id IS NOT NULL
          AND appointments.user_id IN (
            SELECT id FROM public.profiles WHERE team_id = p.team_id
          )
      )
    )
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      user_id = auth.uid()
      OR created_by = auth.uid()
      OR public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

-- DELETE: narrowed per Chris's redline on 2026-05-24 — owner / created_by /
-- Admin / Super Admin only. Team Leader same-team is no longer a DELETE branch
-- (was allowed via the legacy FOR ALL policy USING clause). Team Leader can
-- still SELECT and UPDATE same-team appointments.
CREATE POLICY appointments_delete ON public.appointments
  FOR DELETE
  TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND (
      user_id = auth.uid()
      OR created_by = auth.uid()
      OR public.get_user_role() = 'Admin'
      OR public.is_super_admin()
    )
  );

NOTIFY pgrst, 'reload schema';
