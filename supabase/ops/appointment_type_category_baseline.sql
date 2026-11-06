-- Appointment type category baseline (D4 §3.3, C2-16, #28; class R: a data write with no privilege statement).
-- Runs between …40 and …41, as postgres, only after Chris approves these exact counts. It classifies the seeded locked
-- defaults by name and writes one ops_baseline event per row (through the …40 audit trigger). Any other count
-- (a new organization, a renamed or custom type) refuses and needs a re-approved count. Recovery:
-- appointment_type_category_baseline_revert.sql.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL agentflow.appointment_category_source = 'ops_baseline';
DO $baseline$
DECLARE v_counts jsonb; v_custom bigint;
BEGIN
  SELECT jsonb_object_agg(name, n ORDER BY name) INTO v_counts FROM (
    SELECT t.name, count(*) AS n FROM public.appointment_types t
     WHERE t.is_locked AND t.is_default AND t.business_category = 'unclassified' GROUP BY t.name) s;
  SELECT count(*) INTO v_custom FROM public.appointment_types t WHERE NOT t.is_locked;
  IF v_counts IS DISTINCT FROM '{"Follow Up": 6, "Other": 6, "Policy Anniversary": 6, "Policy Review": 6, "Recruit Interview": 6, "Sales Call": 6}'::jsonb
     OR v_custom <> 0 THEN
    RAISE EXCEPTION 'Appointment category baseline: counts differ from the approved 36 locked defaults and 0 custom types (got % and % custom)',
      v_counts, v_custom USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.appointment_types t SET business_category = private.appointment_type_seed_category(t.name)
   WHERE t.is_locked AND t.is_default AND t.business_category = 'unclassified';
  IF (SELECT count(*) FROM private.appointment_type_category_events WHERE source = 'ops_baseline') <> 36
     OR (SELECT jsonb_object_agg(c, n ORDER BY c) FROM (SELECT business_category AS c, count(*) AS n FROM public.appointment_types
          WHERE is_locked AND is_default GROUP BY 1) s)
        IS DISTINCT FROM '{"follow_up": 6, "other": 6, "recruiting": 6, "review": 12, "sales": 6}'::jsonb THEN
    RAISE EXCEPTION 'Appointment category baseline: postcondition failed' USING ERRCODE = 'P0001';
  END IF;
END $baseline$;
COMMIT;
