-- Reports V2 PKG-D (D4 §3.6): the Sales Appointments helper body (KPIs 12, 15, 16, 17, 18). Privilege class C: no
-- GRANT; every function created here is revoked from PUBLIC, anon, authenticated and service_role. Runs only in the
-- v3-only window (Reports v3 disabled). It replaces exactly the …13 stub and report_v3_basis_flags, behind their
-- md5(pg_get_functiondef) preimages: the stub as shipped by PKG-A, and the flags as left by PKG-B (3.1.0).
-- REBASE NOTE: whichever of PKG-C and PKG-D lands second regenerates the flags preimage and the contract_version.
--
-- Sales Appointment = category 'sales' only (Follow Up, callback, recruiting, review, service and other never count).
-- Credit: 15 → setter (the creator, else the assignee at booking); 12, 16, 17, 18 → assigned_agent_at_start. No
-- trustworthy assignee at start → no individual credit (agency totals only, detail.unattributed). recorded_by never
-- moves credit. Privacy option (a) (★1 pending): 12 and 18 read sale facts with p_agents => NULL (effect E3).
SET LOCAL lock_timeout = '2s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'get\_report\_%\_v3'
                AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Reports v3 appointment facts: Reports v3 must be disabled first' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('private.appointment_occurrences') IS NULL OR to_regclass('private.policy_appointment_attributions') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 appointment facts: the appointment evidence (…41) and attributions (…42) must be applied first'
      USING ERRCODE = 'P0001';
  END IF;
  IF private.report_v3_basis_flags() ->> 'appointment_evidence' = 'installed' THEN
    RAISE EXCEPTION 'Reports v3 appointment facts: refusing replay' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)'::regprocedure))
       <> '22b1c13bfc5c20dbd9bbe2fe61d2e31e'
     OR md5(pg_get_functiondef('private.report_v3_basis_flags()'::regprocedure)) <> '67c6a60a1004b4596a4a61487a41d17b' THEN
    RAISE EXCEPTION 'Reports v3 appointment facts: stub or basis flags preimage drift' USING ERRCODE = 'P0001';
  END IF;
END $guard$;

-- Reconciliation (D4 §3.6, BC5): an appointment is a capture_gap when a durable source disagrees with the evidence.
CREATE FUNCTION private.report_v3_appointment_gap(p_org uuid, p_appointment_id uuid, p_cap_start timestamptz, p_as_of timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH cur AS (SELECT a.* FROM public.appointments a WHERE a.id = p_appointment_id AND a.organization_id = p_org),
  obs AS (SELECT b.id, b.op, b.prev, b.next, lag(b.next) OVER (ORDER BY b.id) AS prior_next, row_number() OVER (ORDER BY b.id) AS n
            FROM private.appointment_evidence_observations b
           WHERE b.organization_id = p_org AND b.appointment_id = p_appointment_id AND b.observed_at <= p_as_of)
  SELECT EXISTS (SELECT 1 FROM private.appointment_evidence_capture_gaps g
                  WHERE g.organization_id = p_org AND g.appointment_id = p_appointment_id AND g.occurred_at <= p_as_of)
      OR EXISTS (SELECT 1 FROM obs WHERE obs.n > 1 AND obs.prev IS DISTINCT FROM obs.prior_next)
      OR EXISTS (SELECT 1 FROM cur, LATERAL (SELECT o.next FROM obs o ORDER BY o.id DESC LIMIT 1) l
                  WHERE l.next IS DISTINCT FROM private.appointment_evidence_row(cur))
      OR EXISTS (SELECT 1 FROM cur WHERE cur.created_at >= p_cap_start AND NOT EXISTS (SELECT 1 FROM obs WHERE obs.op = 'INSERT'))
      OR EXISTS (SELECT 1 FROM cur WHERE cur.created_at < p_cap_start AND cur.updated_at > p_cap_start AND NOT EXISTS (SELECT 1 FROM obs))
      OR EXISTS (SELECT 1 FROM obs WHERE obs.n = 1 AND obs.op <> 'INSERT' AND (obs.prev ->> 'updated_at')::timestamptz > p_cap_start)
      OR (NOT EXISTS (SELECT 1 FROM cur)
          AND (EXISTS (SELECT 1 FROM obs) OR EXISTS (SELECT 1 FROM private.booking_receipts r WHERE r.organization_id = p_org
                                                       AND r.appointment_id = p_appointment_id AND r.recorded_at <= p_as_of))
          AND NOT EXISTS (SELECT 1 FROM obs WHERE obs.op = 'DELETE'))
$$;
REVOKE ALL ON FUNCTION private.report_v3_appointment_gap(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- The five envelopes for one counts object (totals or one by_agent row).
CREATE FUNCTION private.report_v3_appointment_kpis(c jsonb, p_config text, p_occ_config text, p_window jsonb, p_agency boolean)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  n jsonb := c -> 'n';
  v_partial int := CASE WHEN (p_window ->> 'partial_period')::boolean THEN 1 ELSE 0 END;
  v_disabled int := CASE WHEN (p_window ->> 'disabled_interval')::boolean THEN 1 ELSE 0 END;
  v_unattr jsonb := CASE WHEN p_agency THEN jsonb_build_object('unattributed', c -> 'unattributed') ELSE '{}'::jsonb END;
  v_capture jsonb := jsonb_build_object('capture', jsonb_build_object('outcomes_started_at', p_window -> 'cap_start',
                                                                     'outcomes_started_on', p_window -> 'cap_start_on'));
  cov15 jsonb; cov16 jsonb; cov17 jsonb; cov18 jsonb; cov12 jsonb; mat18 jsonb; mat12 jsonb;
  k15 int; u15 int; due_known int; held int; resolved int; occ_unknown int; m_known int; m_unknown int; succ int; pol int;
  e12 jsonb; e15 jsonb; e16 jsonb; e17 jsonb; e18 jsonb;
  reasons jsonb;
BEGIN
  k15 := (n ->> 'bookings_counted')::int;
  u15 := (n ->> 'bookings_unclassified')::int;
  cov15 := jsonb_build_object('eligible', k15 + u15, 'assessable', k15, 'unassessable', u15, 'reasons',
             jsonb_strip_nulls(jsonb_build_object(
               'capture_gap', CASE WHEN (n ->> 'bookings_gap')::int + v_disabled > 0 THEN (n ->> 'bookings_gap')::int + v_disabled END,
               'legacy_booking_basis', CASE WHEN (n ->> 'bookings_legacy')::int > 0 THEN (n ->> 'bookings_legacy')::int END,
               'appointment_type_unclassified', CASE WHEN u15 > 0 THEN u15 END)));

  held := (n ->> 'held')::int;
  resolved := (n ->> 'resolved')::int;
  due_known := resolved + (n ->> 'unresolved')::int;
  occ_unknown := (n ->> 'unresolved')::int + (n ->> 'occ_gap')::int + (n ->> 'occ_unclassified')::int;
  reasons := jsonb_strip_nulls(jsonb_build_object(
    'capture_gap', CASE WHEN (n ->> 'occ_gap')::int + v_disabled > 0 THEN (n ->> 'occ_gap')::int + v_disabled END,
    'outcome_capture_partial_period', CASE WHEN v_partial > 0 THEN 1 END,
    'appointment_type_unclassified', CASE WHEN (n ->> 'occ_unclassified')::int > 0 THEN (n ->> 'occ_unclassified')::int END,
    'outcomes_unresolved', CASE WHEN (n ->> 'unresolved')::int > 0 THEN (n ->> 'unresolved')::int END));
  cov16 := jsonb_build_object('eligible', resolved + occ_unknown, 'assessable', resolved, 'unassessable', occ_unknown, 'reasons', reasons);
  cov17 := cov16;

  m_known := (n ->> 'members_resolved')::int;
  m_unknown := (n ->> 'members_unresolved')::int + (n ->> 'members_gap')::int + (n ->> 'members_unclassified')::int;
  succ := (n ->> 'successes')::int;
  pol := (n ->> 'attributed_policies')::int;
  reasons := jsonb_strip_nulls(jsonb_build_object(
    'capture_gap', CASE WHEN (n ->> 'members_gap')::int + v_disabled > 0 THEN (n ->> 'members_gap')::int + v_disabled END,
    'outcome_capture_partial_period', CASE WHEN v_partial > 0 THEN 1 END,
    'appointment_type_unclassified', CASE WHEN (n ->> 'members_unclassified')::int > 0 THEN (n ->> 'members_unclassified')::int END,
    'attribution_unresolved', CASE WHEN (n ->> 'members_unresolved')::int > 0 THEN (n ->> 'members_unresolved')::int END));
  cov18 := jsonb_build_object('eligible', m_known + m_unknown, 'assessable', m_known, 'unassessable', m_unknown, 'reasons', reasons);
  cov12 := cov18;
  IF (n ->> 'members')::int > 0 THEN
    mat18 := jsonb_build_object('window_days', 30, 'state', CASE WHEN (n ->> 'members_pending')::int > 0 THEN 'in_progress' ELSE 'complete' END,
      'members', (n ->> 'members')::int, 'pending', (n ->> 'members_pending')::int, 'successes_to_date', succ,
      'mature_members', (n ->> 'members')::int - (n ->> 'members_pending')::int, 'mature_successes', (n ->> 'mature_successes')::int,
      'fully_mature_on', n -> 'fully_mature_on');
  END IF;
  IF m_known > 0 THEN
    mat12 := jsonb_build_object('window_days', 30, 'state', CASE WHEN (n ->> 'resolved_pending')::int > 0 THEN 'in_progress' ELSE 'complete' END,
      'members', m_known, 'pending', (n ->> 'resolved_pending')::int, 'successes_to_date', pol,
      'mature_members', m_known - (n ->> 'resolved_pending')::int, 'mature_successes', (n ->> 'mature_policies')::int,
      'fully_mature_on', n -> 'fully_mature_on');
  END IF;

  e15 := CASE WHEN p_config IS NOT NULL THEN private.report_v3_total(15, 0, NULL, p_config)
              ELSE private.report_v3_total(15, k15, cov15, NULL,
                     jsonb_build_object('disclosures', c -> 'disclosures', 'basis_counts', c -> 'basis_counts') || v_capture || v_unattr) END;
  e16 := CASE WHEN coalesce(p_config, p_occ_config) IS NOT NULL THEN private.report_v3_total(16, 0, NULL, coalesce(p_config, p_occ_config))
              ELSE private.report_v3_total(16, held, cov16, NULL,
                     jsonb_build_object('due_outcomes', jsonb_build_object('due', due_known + (n ->> 'occ_gap')::int + (n ->> 'occ_unclassified')::int,
                                        'resolved', resolved, 'unresolved', (n ->> 'unresolved')::int)) || v_capture || v_unattr) END;
  e17 := CASE WHEN coalesce(p_config, p_occ_config) IS NOT NULL THEN private.report_v3_rate(17, 0, 0, NULL, NULL, coalesce(p_config, p_occ_config))
              ELSE private.report_v3_rate(17, held, resolved, cov17, NULL, NULL,
                     jsonb_build_object('due_outcomes', jsonb_build_object('due', due_known + (n ->> 'occ_gap')::int + (n ->> 'occ_unclassified')::int,
                                        'resolved', resolved, 'unresolved', (n ->> 'unresolved')::int),
                                        'classes', c -> 'classes') || v_capture || v_unattr) END;
  e18 := CASE WHEN coalesce(p_config, p_occ_config) IS NOT NULL THEN private.report_v3_rate(18, 0, 0, NULL, NULL, coalesce(p_config, p_occ_config))
              ELSE private.report_v3_rate(18, succ, m_known, cov18, mat18, NULL,
                     jsonb_build_object('attribution', jsonb_build_object('members', (n ->> 'members')::int, 'resolved', m_known,
                                        'unresolved', (n ->> 'members_unresolved')::int),
                                        'unresolved_breakdown', c -> 'unresolved_breakdown') || v_capture || v_unattr) END;
  e12 := CASE WHEN coalesce(p_config, p_occ_config) IS NOT NULL THEN private.report_v3_ratio(12, 0, 0, NULL, NULL, coalesce(p_config, p_occ_config))
              ELSE private.report_v3_ratio(12, m_known, pol, cov12, mat12, NULL,
                     jsonb_build_object('attribution', jsonb_build_object('members', (n ->> 'members')::int, 'resolved', m_known,
                                        'unresolved', (n ->> 'members_unresolved')::int),
                                        'unresolved_breakdown', c -> 'unresolved_breakdown',
                                        'policies', jsonb_build_object('attributed', pol, 'unattributed_eligible', (n ->> 'unattributed_eligible')::int))
                     || v_capture || v_unattr) END;
  RETURN jsonb_build_array(e12, e15, e16, e17, e18);
END $$;
REVOKE ALL ON FUNCTION private.report_v3_appointment_kpis(jsonb, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- Counts for one scope: every item when p_agent is NULL (scope totals), else the items credited to p_agent.
-- Totals are computed, never summed from by_agent. KPI 12 and 18 share one member resolution (an eligible policy with
-- no effective attribution leaves a member unresolved unless another eligible policy is attributed to it).
CREATE FUNCTION private.report_v3_appointment_counts(p_items jsonb, p_agent uuid, p_agency boolean) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH i AS (SELECT x AS j, x ->> 't' AS t, (x ->> 'credit')::uuid AS credit, x ->> 'category' AS category,
                    coalesce((x ->> 'gap')::boolean, false) AS gap, x ->> 'class' AS class
               FROM jsonb_array_elements(p_items) x
              WHERE p_agent IS NULL OR (x ->> 'credit')::uuid = p_agent),
  b AS (SELECT * FROM i WHERE t = 'b' AND NOT (j ->> 'callback')::boolean),
  o AS (SELECT * FROM i WHERE t = 'o'),
  m AS (SELECT i.*, (j ->> 'pending')::boolean AS pending, (j ->> 'no_identity')::boolean AS no_identity,
               (j ->> 'attributed')::int AS attributed, (j ->> 'unattributed')::int AS unattributed, (j ->> 'anchor')::date AS anchor,
               ((j ->> 'no_identity')::boolean OR ((j ->> 'attributed')::int = 0 AND (j ->> 'unattributed')::int > 0)) AS unresolved
          FROM i WHERE t = 'm'),
  ms AS (SELECT * FROM m WHERE category = 'sales' AND NOT gap)
  SELECT jsonb_build_object(
    'n', jsonb_build_object(
      'bookings_counted', (SELECT count(*) FROM b WHERE category = 'sales'),
      'bookings_unclassified', (SELECT count(*) FROM b WHERE category = 'unclassified' AND NOT gap),
      'bookings_gap', (SELECT count(*) FROM b WHERE category = 'sales' AND gap),
      'bookings_legacy', (SELECT count(*) FROM b WHERE category = 'sales' AND j ->> 'basis' = 'legacy'),
      'held', (SELECT count(*) FROM o WHERE category = 'sales' AND NOT gap AND class = 'held'),
      'resolved', (SELECT count(*) FROM o WHERE category = 'sales' AND NOT gap AND class IN ('held', 'no_show', 'cancelled_at_or_after_start')),
      'unresolved', (SELECT count(*) FROM o WHERE category = 'sales' AND NOT gap AND class = 'unresolved'),
      'occ_gap', (SELECT count(*) FROM o WHERE gap AND class NOT IN ('not_due', 'excluded')),
      'occ_unclassified', (SELECT count(*) FROM o WHERE category = 'unclassified' AND NOT gap AND class NOT IN ('not_due', 'excluded')),
      'members', (SELECT count(*) FROM ms),
      'members_pending', (SELECT count(*) FROM ms WHERE pending),
      'members_resolved', (SELECT count(*) FROM ms WHERE NOT unresolved),
      'members_unresolved', (SELECT count(*) FROM ms WHERE unresolved),
      'members_gap', (SELECT count(*) FROM m WHERE gap),
      'members_unclassified', (SELECT count(*) FROM m WHERE category = 'unclassified' AND NOT gap),
      'successes', (SELECT count(*) FROM ms WHERE NOT unresolved AND attributed > 0),
      'mature_successes', (SELECT count(*) FROM ms WHERE NOT unresolved AND attributed > 0 AND NOT pending),
      'attributed_policies', (SELECT coalesce(sum(attributed), 0) FROM ms WHERE NOT unresolved),
      'resolved_pending', (SELECT count(*) FROM ms WHERE NOT unresolved AND pending),
      'mature_policies', (SELECT coalesce(sum(attributed), 0) FROM ms WHERE NOT unresolved AND NOT pending),
      'unattributed_eligible', (SELECT coalesce(sum(unattributed), 0) FROM ms WHERE NOT unresolved),
      'fully_mature_on', (SELECT to_char(max(anchor) + 31, 'YYYY-MM-DD') FROM ms)),
    'disclosures', jsonb_build_object(
      'setter_from_assignee', (SELECT count(*) FROM b WHERE category = 'sales' AND (j ->> 'setter_from_assignee')::boolean),
      'writer_default_type', 0,
      'deleted_bookings_counted', (SELECT count(*) FROM b WHERE category = 'sales' AND j ->> 'src' <> 'live'),
      'legacy_callback_title_excluded', (SELECT count(*) FROM i WHERE t = 'b' AND (j ->> 'callback')::boolean AND j ->> 'booking_kind' IS NULL),
      'callback_signature_excluded', (SELECT count(*) FROM i WHERE t = 'b' AND (j ->> 'callback')::boolean AND j ->> 'booking_kind' = 'callback'),
      'non_sales_excluded', (SELECT count(*) FROM b WHERE category NOT IN ('sales', 'unclassified')),
      'unclassified_excluded', (SELECT count(*) FROM b WHERE category = 'unclassified' AND NOT gap),
      'duplicates_excluded', 0,
      'retyped_after_booking', 0),
    'basis_counts', jsonb_build_object(
      'receipt', (SELECT count(*) FROM b WHERE category = 'sales' AND j ->> 'basis' = 'receipt'),
      'capture', (SELECT count(*) FROM b WHERE category = 'sales' AND j ->> 'basis' = 'capture'),
      'legacy', (SELECT count(*) FROM b WHERE category = 'sales' AND j ->> 'basis' = 'legacy')),
    'classes', jsonb_build_object(
      'held', (SELECT count(*) FROM o WHERE category = 'sales' AND NOT gap AND class = 'held'),
      'no_show', (SELECT count(*) FROM o WHERE category = 'sales' AND NOT gap AND class = 'no_show'),
      'cancelled_at_or_after_start', (SELECT count(*) FROM o WHERE category = 'sales' AND NOT gap AND class = 'cancelled_at_or_after_start'),
      'unresolved', (SELECT count(*) FROM o WHERE category = 'sales' AND NOT gap AND class = 'unresolved')),
    'unresolved_breakdown', jsonb_build_object(
      'unlinked_purchase', (SELECT count(*) FROM ms WHERE unresolved AND NOT no_identity),
      'identity_unresolved', (SELECT count(*) FROM ms WHERE no_identity)),
    'unattributed', CASE WHEN p_agency THEN jsonb_build_object(
      'bookings', (SELECT count(*) FROM b WHERE credit IS NULL AND category = 'sales'),
      'occurrences', (SELECT count(*) FROM o WHERE credit IS NULL AND category = 'sales'),
      'members', (SELECT count(*) FROM ms WHERE credit IS NULL)) END)
$$;
REVOKE ALL ON FUNCTION private.report_v3_appointment_counts(jsonb, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.report_v3_appointment_facts(p_org uuid, p_agents uuid[], p_roster uuid[],
                                                    p_start_at timestamptz, p_end_at timestamptz, p_time_zone text,
                                                    p_reader_as_of timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_as_of timestamptz := p_reader_as_of;
  v_cap timestamptz;
  v_window jsonb;
  v_config text;
  v_occ_config text;
  v_items jsonb;
  v_totals jsonb;
  v_rows jsonb;
BEGIN
  SELECT min(w.started_at) INTO v_cap FROM private.appointment_evidence_capture_windows w
   WHERE w.capture_kind = 'appointment_outcomes' AND w.started_at <= v_as_of;
  v_window := jsonb_build_object(
    'cap_start', v_cap, 'cap_start_on', to_char((v_cap AT TIME ZONE p_time_zone)::date, 'YYYY-MM-DD'),
    'partial_period', coalesce(p_start_at < v_cap AND v_cap < p_end_at, false),
    'disabled_interval', EXISTS (
      SELECT 1 FROM private.appointment_evidence_capture_windows w
       WHERE w.capture_kind = 'appointment_outcomes' AND w.ended_at IS NOT NULL AND w.ended_at <= v_as_of
         AND w.ended_at < p_end_at
         AND coalesce((SELECT min(x.started_at) FROM private.appointment_evidence_capture_windows x
                        WHERE x.capture_kind = 'appointment_outcomes' AND x.started_at > w.started_at AND x.started_at <= v_as_of), v_as_of)
             > greatest(w.ended_at, p_start_at)));  -- a real gap between windows that overlaps the report window
  v_occ_config := CASE WHEN v_cap IS NULL OR p_end_at <= v_cap THEN 'outcome_capture_not_started' END;

  WITH
  -- KPI 15: bookings created in the window (live rows, receipt-only and capture-only deletions); status ignored.
  booking_src AS (
    SELECT a.id, a.created_at, a.type, a.booking_kind, a.created_by, a.user_id, a.title, a.booking_request_id,
           'live'::text AS src FROM public.appointments a
     WHERE a.organization_id = p_org AND a.created_at >= p_start_at AND a.created_at < p_end_at AND a.created_at <= v_as_of
    UNION ALL
    SELECT r.appointment_id, (r.result ->> 'created_at')::timestamptz, r.result ->> 'type', r.kind, r.actor_id,
           (r.result ->> 'user_id')::uuid, r.result ->> 'title', r.request_id, 'receipt_deleted'
      FROM private.booking_receipts r
     WHERE r.organization_id = p_org AND r.recorded_at <= v_as_of
       AND (r.result ->> 'created_at')::timestamptz >= p_start_at AND (r.result ->> 'created_at')::timestamptz < p_end_at
       AND NOT EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = r.appointment_id)
    UNION ALL
    SELECT o.appointment_id, o.booking_created_at, o.type_name, o.booking_kind, o.setter_id, o.assignee_at_open, NULL, NULL, 'capture_deleted'
      FROM private.appointment_occurrences o
     WHERE o.organization_id = p_org AND o.seq = 1 AND o.opened_source = 'booking' AND o.opened_at <= v_as_of
       AND o.booking_created_at >= p_start_at AND o.booking_created_at < p_end_at
       AND NOT EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = o.appointment_id)
       AND NOT EXISTS (SELECT 1 FROM private.booking_receipts r WHERE r.organization_id = p_org AND r.appointment_id = o.appointment_id)
  ),
  bookings AS (
    SELECT b.*, coalesce(b.created_by, b.user_id) AS credit, b.created_by IS NULL AND b.user_id IS NOT NULL AS setter_from_assignee,
           cap.category AS cap_category,
           EXISTS (SELECT 1 FROM private.booking_receipts r WHERE r.organization_id = p_org AND r.appointment_id = b.id) AS has_receipt,
           private.report_v3_appointment_gap(p_org, b.id, coalesce(v_cap, 'infinity'), v_as_of) AS gap,
           (b.booking_kind = 'callback' OR (b.booking_kind IS NULL AND lower(btrim(coalesce(b.title, ''))) LIKE 'callback%')) AS callback
      FROM booking_src b
      LEFT JOIN LATERAL (SELECT o.category FROM private.appointment_occurrences o
                          WHERE o.appointment_id = b.id AND o.seq = 1 AND o.opened_source = 'booking') cap ON true
  ),
  booking_items AS (
    SELECT b.credit, b.setter_from_assignee, b.gap, b.callback, b.booking_kind, b.src,
           CASE WHEN b.gap THEN 'gap' WHEN b.cap_category IS NOT NULL THEN 'capture' WHEN b.has_receipt THEN 'receipt' ELSE 'legacy' END AS basis,
           CASE WHEN b.callback THEN 'callback'
                WHEN b.cap_category IS NOT NULL AND NOT b.gap AND b.cap_category <> 'unclassified' THEN b.cap_category
                ELSE private.appointment_evidence_classify(p_org, b.type, b.booking_kind, b.created_at, v_as_of) END AS category
      FROM bookings b
  ),
  -- KPIs 16 and 17: occurrences due in [greatest(start, cap_start), end), plus untouched pre-capture rows.
  occ_src AS (
    SELECT o.id AS occurrence_id, o.appointment_id, o.scheduled_start, o.contact_id, o.closed_at, o.close_reason,
           private.appointment_assignee_at_start(o.id) AS credit, st.outcome, st.category,
           (SELECT e.event_at FROM private.appointment_outcome_events e WHERE e.occurrence_id = o.id AND e.recorded_at <= v_as_of
             ORDER BY e.recorded_at DESC LIMIT 1) AS outcome_at
      FROM private.appointment_occurrences o
     CROSS JOIN LATERAL private.appointment_occurrence_state(o.id, v_as_of) st
     WHERE o.organization_id = p_org AND o.opened_at <= v_as_of AND o.close_reason IS DISTINCT FROM 'slot_corrected'
       AND o.scheduled_start >= greatest(p_start_at, coalesce(v_cap, 'infinity')) AND o.scheduled_start < p_end_at
    UNION ALL
    SELECT NULL, a.id, a.start_time, a.contact_id, NULL, NULL, a.user_id,
           CASE private.appointment_status_key(a.status) WHEN 'open' THEN NULL ELSE private.appointment_status_key(a.status) END,
           private.appointment_evidence_classify(p_org, a.type, a.booking_kind, a.created_at, v_as_of), a.updated_at
      FROM public.appointments a
     WHERE a.organization_id = p_org AND a.start_time >= greatest(p_start_at, coalesce(v_cap, 'infinity')) AND a.start_time < p_end_at
       AND NOT EXISTS (SELECT 1 FROM private.appointment_occurrences o WHERE o.appointment_id = a.id)
  ),
  occ_items AS (
    SELECT s.*, private.report_v3_appointment_gap(p_org, s.appointment_id, coalesce(v_cap, 'infinity'), v_as_of) AS gap,
           CASE WHEN s.scheduled_start > v_as_of THEN 'not_due'
                WHEN s.outcome = 'held' THEN 'held'
                WHEN s.outcome = 'no_show' THEN 'no_show'
                WHEN s.outcome = 'cancelled' AND s.outcome_at >= s.scheduled_start THEN 'cancelled_at_or_after_start'
                WHEN s.outcome = 'cancelled' THEN 'excluded'
                WHEN s.close_reason IN ('rescheduled_before_start', 'deleted') AND s.closed_at < s.scheduled_start THEN 'excluded'
                ELSE 'unresolved' END AS class
      FROM occ_src s WHERE s.category IN ('sales', 'unclassified')
  ),
  -- KPIs 12 and 18: held occurrences and same-identity policies sold within 30 days of the agency date.
  members AS (
    SELECT i.*, (i.scheduled_start AT TIME ZONE p_time_zone)::date AS anchor,
           (SELECT ci.identity_key FROM private.report_v3_contact_identity(p_org, ARRAY[i.contact_id], NULL) ci LIMIT 1) AS identity_key
      FROM occ_items i WHERE i.class = 'held'
  ),
  member_sales AS (
    SELECT m.occurrence_id, m.appointment_id, f.policy_id, f.win_id,
           h.declaration, h.occurrence_id AS linked_occurrence
      FROM members m
      JOIN private.report_v3_sale_facts(p_org, NULL, (SELECT min(anchor) FROM members), (SELECT max(anchor) + 31 FROM members)) f
        ON f.recorded_at <= v_as_of AND f.sold_date - m.anchor BETWEEN 0 AND 30
       AND private.report_v3_client_identity_key(p_org, f.buyer_id) = m.identity_key
      LEFT JOIN LATERAL (SELECT a.declaration, a.occurrence_id FROM private.policy_appointment_attributions a
                          WHERE a.organization_id = p_org AND a.policy_id = f.policy_id AND a.attributed_at <= v_as_of
                            AND NOT EXISTS (SELECT 1 FROM private.policy_appointment_attributions n
                                             WHERE n.supersedes_attribution_id = a.id AND n.attributed_at <= v_as_of)) h ON true
  ),
  member_items AS (
    SELECT m.credit, m.gap, m.category, m.anchor,
           v_as_of < private.report_v3_local_day_start(m.anchor + 31, p_time_zone) AS pending,
           m.identity_key IS NULL AS no_identity,
           coalesce((SELECT count(*) FROM member_sales s WHERE s.occurrence_id = m.occurrence_id AND s.linked_occurrence = m.occurrence_id), 0) AS attributed,
           coalesce((SELECT count(*) FROM member_sales s WHERE s.occurrence_id = m.occurrence_id AND s.declaration IS NULL), 0) AS unattributed
      FROM members m
  ),
  scoped AS (
    SELECT 'b' AS t, credit, to_jsonb(x) AS j FROM booking_items x
    UNION ALL SELECT 'o', credit, to_jsonb(x) FROM occ_items x
    UNION ALL SELECT 'm', credit, to_jsonb(x) FROM member_items x
  )
  SELECT jsonb_agg(jsonb_build_object('t', t, 'credit', credit) || j) INTO v_items
    FROM scoped WHERE p_agents IS NULL OR credit = ANY (p_agents);

  -- Config: no trustworthy category in the population and no classified type in the organization.
  IF NOT EXISTS (SELECT 1 FROM public.appointment_types t WHERE t.organization_id = p_org AND t.business_category <> 'unclassified')
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_items, '[]')) i WHERE i ->> 'category' NOT IN ('unclassified', 'callback')) THEN
    v_config := 'classification_not_configured';
  END IF;

  v_totals := private.report_v3_appointment_counts(coalesce(v_items, '[]'), NULL, p_agents IS NULL);
  SELECT coalesce(jsonb_agg(jsonb_build_object('agent_id', r.agent_id,
           'metrics', private.report_v3_appointment_kpis(private.report_v3_appointment_counts(coalesce(v_items, '[]'), r.agent_id, false),
                                                         v_config, v_occ_config, v_window, false)) ORDER BY r.ord), '[]'::jsonb)
    INTO v_rows
    FROM (SELECT u.agent_id, min(u.ord) AS ord FROM unnest(p_roster) WITH ORDINALITY u(agent_id, ord) WHERE u.agent_id IS NOT NULL
           GROUP BY u.agent_id) r;
  RETURN jsonb_build_object('metrics', private.report_v3_appointment_kpis(v_totals, v_config, v_occ_config, v_window, p_agents IS NULL),
                            'by_agent', v_rows);
END $$;

CREATE OR REPLACE FUNCTION private.report_v3_basis_flags()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT '{"contract_version":"3.2.0","corrections":"audited_ledger","sale_call_links":"not_installed","appointment_evidence":"installed"}'::jsonb;
$$;

REVOKE ALL ON FUNCTION private.report_v3_appointment_facts(uuid, uuid[], uuid[], timestamptz, timestamptz, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_basis_flags() FROM PUBLIC, anon, authenticated, service_role;

DO $post$
DECLARE f regprocedure;
BEGIN
  IF private.report_v3_basis_flags() IS DISTINCT FROM
     '{"contract_version":"3.2.0","corrections":"audited_ledger","sale_call_links":"not_installed","appointment_evidence":"installed"}'::jsonb THEN
    RAISE EXCEPTION 'Reports v3 appointment facts: basis flags not installed' USING ERRCODE = 'P0001';
  END IF;
  FOREACH f IN ARRAY ARRAY['private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)'::regprocedure,
                           'private.report_v3_appointment_kpis(jsonb,text,text,jsonb,boolean)'::regprocedure,
                           'private.report_v3_appointment_counts(jsonb,uuid,boolean)'::regprocedure,
                           'private.report_v3_appointment_gap(uuid,uuid,timestamptz,timestamptz)'::regprocedure] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('service_role', f, 'EXECUTE')
       OR (SELECT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'] FROM pg_proc WHERE oid = f) THEN
      RAISE EXCEPTION 'Reports v3 appointment facts: % is not sealed invoker-rights', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $post$;
