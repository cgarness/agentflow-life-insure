-- =====================================================================================================
-- Onboarding email series — enable enrollment and sending. NOT RUN. Activation checklist §11 step 8;
-- needs Chris's explicit approval for the exact scope, run as a NEW migration.
--
-- Before running, edit the two marked values below. The guard refuses the placeholders, an empty or
-- unknown pilot list, and mixing 'all' with a pilot list.
--   v_scope = 'pilot' with v_pilot = ARRAY['<organization uuid>', ...]::uuid[]  (recommended first)
--   v_scope = 'all'   with v_pilot = NULL                                       (later widening)
--
-- Effects: enabled = true; enrollment_starts_at = now() only if it was NULL (re-enabling keeps the
-- original watermark, so no historical user ever becomes eligible); pilot list set or cleared.
-- Independent requirements that this script does NOT satisfy (see §11): the Edge flag
-- ONBOARDING_EMAILS_SEND_ENABLED=true, the secrets, the schedule, and D12 (a confirmed mailing address).
-- =====================================================================================================
DO $enable$
DECLARE
  v_scope text   := '__SET_SCOPE__';  -- EDIT: 'pilot' or 'all'
  v_pilot uuid[] := NULL;             -- EDIT: required for 'pilot'; must stay NULL for 'all'
BEGIN
  IF to_regclass('public.onboarding_email_program') IS NULL THEN
    RAISE EXCEPTION 'onboarding email foundation is not applied';
  END IF;
  IF v_scope NOT IN ('pilot', 'all') THEN
    RAISE EXCEPTION 'set v_scope to pilot or all before running';
  END IF;
  IF v_scope = 'pilot' AND (v_pilot IS NULL OR cardinality(v_pilot) = 0) THEN
    RAISE EXCEPTION 'a pilot needs at least one organization id';
  END IF;
  IF v_scope = 'all' AND v_pilot IS NOT NULL THEN
    RAISE EXCEPTION 'scope all must not carry a pilot list';
  END IF;
  IF v_scope = 'pilot' AND EXISTS (SELECT 1 FROM unnest(v_pilot) AS x(org_id)
                                    WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = x.org_id)) THEN
    RAISE EXCEPTION 'every pilot organization id must exist';
  END IF;

  UPDATE public.onboarding_email_program
     SET enabled = true,
         enrollment_starts_at = coalesce(enrollment_starts_at, now()),
         pilot_organization_ids = CASE WHEN v_scope = 'pilot' THEN v_pilot ELSE NULL END,
         updated_at = now()
   WHERE id = 1;
END $enable$;
