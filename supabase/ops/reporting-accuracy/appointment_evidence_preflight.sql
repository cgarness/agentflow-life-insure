-- Appointment evidence preflight and read-back (D4 §6; class R: read-only aggregates, no ids or names).
-- Run only inside: BEGIN TRANSACTION READ ONLY; <this statement>; ROLLBACK;   $1 uuid = the organization.
-- Before …40 it reports the live type and appointment counts D4 §1 relies on; after …41 it adds the evidence state.
SELECT jsonb_build_object(
  'organization_id', $1::uuid,
  'appointment_types', (SELECT jsonb_build_object('total', count(*), 'locked_defaults', count(*) FILTER (WHERE t.is_locked AND t.is_default),
                                                  'custom', count(*) FILTER (WHERE NOT t.is_locked))
                          FROM public.appointment_types t WHERE t.organization_id = $1::uuid),
  'appointments', (SELECT jsonb_build_object('total', count(*), 'by_type', (SELECT coalesce(jsonb_object_agg(type, n), '{}'::jsonb)
                                FROM (SELECT a2.type, count(*) AS n FROM public.appointments a2 WHERE a2.organization_id = $1::uuid GROUP BY a2.type) x),
                     'past_start', count(*) FILTER (WHERE a.start_time < now()), 'null_booking_kind', count(*) FILTER (WHERE a.booking_kind IS NULL),
                     'null_created_by', count(*) FILTER (WHERE a.created_by IS NULL))
                     FROM public.appointments a WHERE a.organization_id = $1::uuid),
  'evidence', CASE WHEN to_regclass('private.appointment_occurrences') IS NULL THEN NULL ELSE (
    SELECT jsonb_build_object('occurrences', (SELECT count(*) FROM private.appointment_occurrences o WHERE o.organization_id = $1::uuid),
                              'outcome_events', (SELECT count(*) FROM private.appointment_outcome_events e WHERE e.organization_id = $1::uuid),
                              'capture_gaps', (SELECT count(*) FROM private.appointment_evidence_capture_gaps g WHERE g.organization_id = $1::uuid),
                              'open_capture_windows', (SELECT count(*) FROM private.appointment_evidence_capture_windows w WHERE w.ended_at IS NULL))) END)
