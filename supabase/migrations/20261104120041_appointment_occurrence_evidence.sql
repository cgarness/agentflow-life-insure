-- Reports V2 PKG-D (D4 §3.4): append-only appointment occurrence evidence. Privilege class W: its only GRANT is
-- EXECUTE on public.record_appointment_outcome(uuid, uuid, timestamptz, text) TO authenticated. Every other object is
-- revoked from PUBLIC, anon, authenticated and service_role. No RLS change; no FK to wins or telephony tables.
--
-- Capture never blocks an appointment write (D-O2, §2.12): every error except QUERY_CANCELED and ASSERT_FAILURE rolls
-- the capture back to its savepoint and leaves a gap row where possible; the appointment write commits. A cancel or an
-- assertion failure aborts the whole write. Only record_appointment_outcome fails closed.
SET LOCAL lock_timeout = '2s';

DO $guard$
BEGIN
  IF to_regclass('private.appointment_type_category_events') IS NULL
     OR to_regprocedure('private.appointment_type_state_at(uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Appointment evidence: the appointment type categories (…40) must be applied first' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('private.appointment_occurrences') IS NOT NULL
     OR to_regprocedure('public.record_appointment_outcome(uuid,uuid,timestamptz,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Appointment evidence: refusing replay' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.appointments'::regclass AND tgname = 'appointments_updated_at'
                  AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Appointment evidence: the server-maintained appointments_updated_at trigger is missing' USING ERRCODE = 'P0001';
  END IF;
END $guard$;

CREATE TABLE private.appointment_evidence_capture_windows (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  capture_kind text NOT NULL CHECK (capture_kind IN ('appointment_outcomes', 'policy_appointment_attribution')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  ended_reason text,
  CHECK ((ended_at IS NULL) = (ended_reason IS NULL))
);
CREATE UNIQUE INDEX appointment_evidence_capture_windows_open ON private.appointment_evidence_capture_windows (capture_kind)
  WHERE ended_at IS NULL;

CREATE TABLE private.appointment_evidence_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  op text NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  prev jsonb,
  next jsonb,
  type_id uuid,
  category text,
  actor_id uuid,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((op = 'INSERT') = (prev IS NULL) AND (op = 'DELETE') = (next IS NULL))
);
CREATE INDEX appointment_evidence_observations_appt ON private.appointment_evidence_observations (organization_id, appointment_id, id);

CREATE TABLE private.appointment_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq >= 1),
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz,
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  opened_by uuid,
  opened_source text NOT NULL CHECK (opened_source IN ('booking', 'reschedule', 'external_sync', 'pre_capture')),
  booking_kind text,
  booking_created_at timestamptz,
  setter_id uuid,
  contact_id uuid,
  assignee_at_open uuid,
  type_name text,
  type_id uuid,
  category text NOT NULL,
  category_basis text NOT NULL,
  closed_at timestamptz,
  closed_by uuid,
  close_reason text CHECK (close_reason IN ('rescheduled_before_start', 'rescheduled_after_start', 'slot_corrected', 'deleted', 'capture_gap')),
  CHECK ((closed_at IS NULL) = (close_reason IS NULL)),
  UNIQUE (appointment_id, seq)
);
CREATE UNIQUE INDEX appointment_occurrences_one_open ON private.appointment_occurrences (appointment_id) WHERE closed_at IS NULL;
CREATE INDEX appointment_occurrences_org_start ON private.appointment_occurrences (organization_id, scheduled_start);

CREATE TABLE private.appointment_assignment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  occurrence_id uuid NOT NULL,
  assignee_before uuid,
  assignee_after uuid,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_by uuid,
  actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'system'))
);
CREATE INDEX appointment_assignment_events_appt ON private.appointment_assignment_events (appointment_id, changed_at);

CREATE TABLE private.appointment_outcome_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  occurrence_id uuid NOT NULL REFERENCES private.appointment_occurrences (id) ON DELETE RESTRICT,
  outcome text NOT NULL CHECK (outcome IN ('held', 'no_show', 'cancelled', 'retracted')),
  event_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_by uuid,
  actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'system')),
  source text NOT NULL CHECK (source IN ('outcome_action', 'status_edit', 'booking_entry', 'external_sync', 'reclassified')),
  request_id uuid,
  contact_id uuid,
  category text NOT NULL,
  supersedes_event_id uuid UNIQUE REFERENCES private.appointment_outcome_events (id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX appointment_outcome_events_request ON private.appointment_outcome_events (organization_id, request_id)
  WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX appointment_outcome_events_one_root ON private.appointment_outcome_events (occurrence_id)
  WHERE supersedes_event_id IS NULL;

CREATE TABLE private.appointment_evidence_capture_gaps (
  gap_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sqlstate text NOT NULL,
  operation text NOT NULL
);

DO $seal$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointment_evidence_capture_windows', 'appointment_evidence_observations', 'appointment_occurrences',
                           'appointment_assignment_events', 'appointment_outcome_events', 'appointment_evidence_capture_gaps'] LOOP
    EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $seal$;

-- Append-only: no DELETE or TRUNCATE; UPDATE only sets the close fields of an occurrence or a capture window, once.
CREATE FUNCTION private.guard_appointment_evidence_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE o jsonb; n jsonb; v_close text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_close := CASE TG_TABLE_NAME WHEN 'appointment_occurrences' THEN ARRAY['closed_at', 'closed_by', 'close_reason']
                                  WHEN 'appointment_evidence_capture_windows' THEN ARRAY['ended_at', 'ended_reason'] END;
    IF v_close IS NOT NULL THEN
      o := to_jsonb(OLD); n := to_jsonb(NEW);
      IF o ->> v_close[1] IS NULL AND n ->> v_close[1] IS NOT NULL AND (o - v_close) = (n - v_close) THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Appointment evidence is append-only' USING ERRCODE = '23514';
END $$;
REVOKE ALL ON FUNCTION private.guard_appointment_evidence_append_only() FROM PUBLIC, anon, authenticated, service_role;
DO $triggers$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointment_evidence_capture_windows', 'appointment_evidence_observations', 'appointment_occurrences',
                           'appointment_assignment_events', 'appointment_outcome_events', 'appointment_evidence_capture_gaps'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.guard_appointment_evidence_append_only()',
                   t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON private.%I FOR EACH STATEMENT EXECUTE FUNCTION private.guard_appointment_evidence_append_only()',
                   t || '_no_truncate', t);
  END LOOP;
END $triggers$;

-- Booking-time category (D-C1, D-C2): callback kind → callback; otherwise the type that carried that name at p_at,
-- by its audited history, and its category then. An 'unclassified' category resolves to that type's first audited
-- classification at or before p_as_of, skipping one an ops_revert withdrew. Several types → one shared category, else
-- unclassified.
CREATE FUNCTION private.appointment_evidence_classify(p_org uuid, p_type_name text, p_booking_kind text, p_at timestamptz,
                                                      p_as_of timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH candidates AS (
    SELECT t.id, s.category
      FROM public.appointment_types t
     CROSS JOIN LATERAL private.appointment_type_state_at(t.id, p_at) s
     WHERE t.organization_id = p_org AND lower(btrim(s.name)) = lower(btrim(p_type_name))
    UNION
    SELECT e.type_id, s.category
      FROM (SELECT DISTINCT type_id FROM private.appointment_type_category_events
             WHERE organization_id = p_org AND NOT EXISTS (SELECT 1 FROM public.appointment_types t WHERE t.id = type_id)) e
     CROSS JOIN LATERAL private.appointment_type_state_at(e.type_id, p_at) s
     WHERE lower(btrim(s.name)) = lower(btrim(p_type_name))
  ), resolved AS (
    SELECT CASE WHEN c.category <> 'unclassified' THEN c.category ELSE (
             SELECT e.category_after FROM private.appointment_type_category_events e
              WHERE e.type_id = c.id AND e.changed_at <= p_as_of AND e.category_after <> 'unclassified'
                AND e.source <> 'ops_revert'
                AND NOT EXISTS (SELECT 1 FROM private.appointment_type_category_events r
                                 WHERE r.type_id = e.type_id AND r.source = 'ops_revert' AND r.changed_at <= p_as_of
                                   AND (r.changed_at, r.id) > (e.changed_at, e.id) AND r.category_before = e.category_after)
              ORDER BY e.changed_at, e.id LIMIT 1) END AS category
      FROM candidates c
  )
  SELECT CASE WHEN p_booking_kind = 'callback' THEN 'callback'
              WHEN (SELECT count(DISTINCT coalesce(category, 'unclassified')) FROM resolved) = 1
                THEN (SELECT coalesce(min(category), 'unclassified') FROM resolved)
              ELSE 'unclassified' END
$$;
REVOKE ALL ON FUNCTION private.appointment_evidence_classify(uuid, text, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- Status keys: completed → held; no-show variants → no_show; cancelled/canceled → cancelled; scheduled/confirmed →
-- open; anything else is ignored (NULL).
CREATE FUNCTION private.appointment_status_key(p_status text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE regexp_replace(lower(btrim(coalesce(p_status, ''))), '[\s_-]+', '', 'g')
    WHEN 'completed' THEN 'held' WHEN 'noshow' THEN 'no_show' WHEN 'cancelled' THEN 'cancelled' WHEN 'canceled' THEN 'cancelled'
    WHEN 'scheduled' THEN 'open' WHEN 'confirmed' THEN 'open' END
$$;
REVOKE ALL ON FUNCTION private.appointment_status_key(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.appointment_evidence_row(r public.appointments) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('start_time', r.start_time, 'status', r.status, 'type', r.type,
    'user_id', r.user_id, 'updated_at', r.updated_at) END
$$;
REVOKE ALL ON FUNCTION private.appointment_evidence_row(public.appointments) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.appointment_type_id_now(p_org uuid, p_name text) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN count(*) = 1 THEN min(t.id::text)::uuid END FROM public.appointment_types t
   WHERE t.organization_id = p_org AND lower(btrim(t.name)) = lower(btrim(p_name))
$$;
REVOKE ALL ON FUNCTION private.appointment_type_id_now(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- Opens an occurrence from a row state.
CREATE FUNCTION private.appointment_open_occurrence(r public.appointments, p_seq integer, p_source text, p_actor uuid,
                                                    p_category text, p_type_id uuid) RETURNS private.appointment_occurrences
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO private.appointment_occurrences (organization_id, appointment_id, seq, scheduled_start, scheduled_end, opened_by,
    opened_source, booking_kind, booking_created_at, setter_id, contact_id, assignee_at_open, type_name, type_id, category, category_basis)
  VALUES (r.organization_id, r.id, p_seq, r.start_time, r.end_time, p_actor, p_source, r.booking_kind, r.created_at,
    coalesce(r.created_by, r.user_id), r.contact_id, r.user_id, r.type, p_type_id, p_category,
    CASE WHEN p_source = 'pre_capture' THEN 'type_history' ELSE 'snapshot' END)
  RETURNING *
$$;
REVOKE ALL ON FUNCTION private.appointment_open_occurrence(public.appointments, integer, text, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Writes one outcome event on an occurrence, superseding its chain head.
CREATE FUNCTION private.appointment_record_outcome_event(p_occ private.appointment_occurrences, p_outcome text, p_source text,
  p_actor uuid, p_request uuid, p_contact uuid, p_category text) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO private.appointment_outcome_events (organization_id, occurrence_id, outcome, recorded_by, actor_kind, source,
    request_id, contact_id, category, supersedes_event_id)
  SELECT p_occ.organization_id, p_occ.id, p_outcome, p_actor, CASE WHEN p_actor IS NULL THEN 'system' ELSE 'human' END,
    p_source, p_request, p_contact, p_category,
    (SELECT h.id FROM private.appointment_outcome_events h WHERE h.occurrence_id = p_occ.id
        AND NOT EXISTS (SELECT 1 FROM private.appointment_outcome_events n WHERE n.supersedes_event_id = h.id))
$$;
REVOKE ALL ON FUNCTION private.appointment_record_outcome_event(private.appointment_occurrences, text, text, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- The capture itself (D4 §3.4 transitions). DEFINER; a per-appointment advisory lock bounded by the trigger's 200 ms
-- lock_timeout; primary-key or unique lookups and single-row writes only.
CREATE FUNCTION private.appointment_evidence_apply(p_op text, p_old public.appointments, p_new public.appointments) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r public.appointments := CASE WHEN p_op = 'DELETE' THEN p_old ELSE p_new END;
  v_actor uuid := auth.uid();
  v_human boolean := auth.uid() IS NOT NULL;
  v_request uuid := nullif(current_setting('agentflow.appointment_outcome_request', true), '')::uuid;
  v_occ private.appointment_occurrences;
  v_category text;
  v_type_id uuid;
  v_old_key text;
  v_new_key text;
  v_head private.appointment_outcome_events;
  v_seq integer;
  v_done boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(r.organization_id::text || ':appointment-evidence:' || r.id::text, 0));
  IF v_request IS NOT NULL THEN
    SELECT * INTO v_head FROM private.appointment_outcome_events e WHERE e.organization_id = r.organization_id AND e.request_id = v_request;
    IF FOUND THEN
      -- An outcome replay records nothing new; the same request with another outcome or appointment fails closed.
      IF v_head.outcome IS DISTINCT FROM private.appointment_status_key(p_new.status)
         OR NOT EXISTS (SELECT 1 FROM private.appointment_occurrences o WHERE o.id = v_head.occurrence_id AND o.appointment_id = r.id) THEN
        RAISE EXCEPTION 'This outcome request was already used for a different outcome' USING ERRCODE = '22023';
      END IF;
      RETURN;
    END IF;
    v_head := NULL;
  END IF;

  IF p_op = 'INSERT' OR (p_op = 'UPDATE' AND v_human AND p_new.type IS DISTINCT FROM p_old.type) THEN
    v_category := private.appointment_evidence_classify(r.organization_id, r.type, r.booking_kind, clock_timestamp(), clock_timestamp());
    v_type_id := private.appointment_type_id_now(r.organization_id, r.type);
  END IF;
  INSERT INTO private.appointment_evidence_observations (organization_id, appointment_id, op, prev, next, type_id, category, actor_id)
  VALUES (r.organization_id, r.id, p_op, CASE WHEN p_op <> 'INSERT' THEN private.appointment_evidence_row(p_old) END,
          CASE WHEN p_op <> 'DELETE' THEN private.appointment_evidence_row(p_new) END, v_type_id, v_category, v_actor);

  IF p_op = 'INSERT' THEN
    v_occ := private.appointment_open_occurrence(p_new, 1, CASE WHEN v_human OR p_new.sync_source = 'internal' THEN 'booking' ELSE 'external_sync' END,
                                                 v_actor, v_category, v_type_id);
    v_new_key := private.appointment_status_key(p_new.status);
    IF v_new_key IN ('held', 'no_show', 'cancelled') AND (v_human OR v_new_key = 'cancelled') THEN
      PERFORM private.appointment_record_outcome_event(v_occ, v_new_key, CASE WHEN v_human THEN 'booking_entry' ELSE 'external_sync' END,
                                                       v_actor, NULL, p_new.contact_id, v_category);
    END IF;
    RETURN;
  END IF;

  SELECT * INTO v_occ FROM private.appointment_occurrences o WHERE o.appointment_id = r.id AND o.closed_at IS NULL;
  IF NOT FOUND OR v_occ.scheduled_start IS DISTINCT FROM p_old.start_time THEN
    IF FOUND THEN  -- drift: the open slot is not the row's previous slot
      UPDATE private.appointment_occurrences SET closed_at = clock_timestamp(), closed_by = v_actor, close_reason = 'capture_gap'
       WHERE id = v_occ.id;
    END IF;
    SELECT coalesce(max(o.seq), 0) + 1 INTO v_seq FROM private.appointment_occurrences o WHERE o.appointment_id = r.id;
    v_occ := private.appointment_open_occurrence(p_old, v_seq, 'pre_capture', NULL,
               private.appointment_evidence_classify(r.organization_id, p_old.type, p_old.booking_kind, coalesce(p_old.created_at, clock_timestamp()), clock_timestamp()),
               private.appointment_type_id_now(r.organization_id, p_old.type));
  END IF;

  IF p_op = 'DELETE' THEN
    UPDATE private.appointment_occurrences SET closed_at = clock_timestamp(), closed_by = v_actor, close_reason = 'deleted' WHERE id = v_occ.id;
    RETURN;
  END IF;

  IF p_new.user_id IS DISTINCT FROM p_old.user_id THEN
    INSERT INTO private.appointment_assignment_events (organization_id, appointment_id, occurrence_id, assignee_before, assignee_after,
      changed_by, actor_kind)
    VALUES (r.organization_id, r.id, v_occ.id, p_old.user_id, p_new.user_id, v_actor, CASE WHEN v_human THEN 'human' ELSE 'system' END);
  END IF;

  v_old_key := private.appointment_status_key(p_old.status);
  v_new_key := private.appointment_status_key(p_new.status);
  v_category := coalesce(v_category, (SELECT o.category FROM private.appointment_evidence_observations o
                                       WHERE o.appointment_id = r.id AND o.category IS NOT NULL AND o.actor_id IS NOT NULL
                                       ORDER BY o.id DESC LIMIT 1), v_occ.category);

  IF p_new.start_time IS DISTINCT FROM p_old.start_time THEN
    SELECT coalesce(max(o.seq), 0) + 1 INTO v_seq FROM private.appointment_occurrences o WHERE o.appointment_id = r.id;
    IF v_old_key = 'open' AND v_new_key IN ('held', 'no_show', 'cancelled') THEN
      UPDATE private.appointment_occurrences SET closed_at = clock_timestamp(), closed_by = v_actor, close_reason = 'slot_corrected'
       WHERE id = v_occ.id;
      v_occ := private.appointment_open_occurrence(p_new, v_seq, CASE WHEN v_human THEN 'reschedule' ELSE 'external_sync' END, v_actor,
                 CASE WHEN v_human THEN v_category ELSE v_occ.category END, coalesce(v_type_id, v_occ.type_id));
      IF v_human OR v_new_key = 'cancelled' THEN
        PERFORM private.appointment_record_outcome_event(v_occ, v_new_key,
          CASE WHEN v_request IS NOT NULL THEN 'outcome_action' WHEN v_human THEN 'status_edit' ELSE 'external_sync' END,
          v_actor, v_request, p_new.contact_id, v_category);
      END IF;
      v_done := true;
    ELSE
      UPDATE private.appointment_occurrences SET closed_at = clock_timestamp(), closed_by = v_actor,
             close_reason = CASE WHEN clock_timestamp() < p_old.start_time THEN 'rescheduled_before_start' ELSE 'rescheduled_after_start' END
       WHERE id = v_occ.id;
      v_occ := private.appointment_open_occurrence(p_new, v_seq, CASE WHEN v_human THEN 'reschedule' ELSE 'external_sync' END, v_actor,
                 CASE WHEN v_human THEN v_category ELSE v_occ.category END, coalesce(v_type_id, v_occ.type_id));
    END IF;
  END IF;

  IF NOT v_done AND v_new_key IS DISTINCT FROM v_old_key AND v_new_key IS NOT NULL THEN
    SELECT * INTO v_head FROM private.appointment_outcome_events h WHERE h.occurrence_id = v_occ.id
       AND NOT EXISTS (SELECT 1 FROM private.appointment_outcome_events n WHERE n.supersedes_event_id = h.id);
    IF v_new_key IN ('held', 'no_show', 'cancelled') AND (v_human OR v_new_key = 'cancelled') THEN
      PERFORM private.appointment_record_outcome_event(v_occ, v_new_key,
        CASE WHEN v_request IS NOT NULL THEN 'outcome_action' WHEN v_human THEN 'status_edit' ELSE 'external_sync' END,
        v_actor, v_request, p_new.contact_id, v_category);
    ELSIF v_new_key = 'open' AND v_human AND v_head.id IS NOT NULL AND v_head.outcome <> 'retracted' THEN
      PERFORM private.appointment_record_outcome_event(v_occ, 'retracted', 'status_edit', v_actor, NULL, p_new.contact_id, v_category);
    END IF;
  ELSIF NOT v_done AND v_human AND p_new.type IS DISTINCT FROM p_old.type THEN
    -- A human retype of an occurrence with an outcome restates the head under the new category.
    SELECT * INTO v_head FROM private.appointment_outcome_events h WHERE h.occurrence_id = v_occ.id
       AND NOT EXISTS (SELECT 1 FROM private.appointment_outcome_events n WHERE n.supersedes_event_id = h.id);
    IF v_head.id IS NOT NULL AND v_head.outcome <> 'retracted' THEN
      PERFORM private.appointment_record_outcome_event(v_occ, v_head.outcome, 'reclassified', v_actor, NULL, p_new.contact_id, v_category);
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.appointment_evidence_apply(text, public.appointments, public.appointments)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.appointment_evidence_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '200ms'                 -- function-level: applies only while this function runs
AS $$
DECLARE r public.appointments := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  IF nullif(current_setting('agentflow.appointment_outcome_request', true), '') IS NOT NULL THEN
    PERFORM private.appointment_evidence_apply(TG_OP, OLD, NEW); RETURN NULL;   -- outcome RPC: evidence-first, fails closed
  END IF;
  BEGIN
    PERFORM private.appointment_evidence_apply(TG_OP, OLD, NEW);
  EXCEPTION WHEN OTHERS THEN               -- every error except QUERY_CANCELED and ASSERT_FAILURE
    BEGIN INSERT INTO private.appointment_evidence_capture_gaps(organization_id, appointment_id, sqlstate, operation)
          VALUES (r.organization_id, r.id, SQLSTATE, TG_OP);
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'appointment evidence gap not recorded (%)', SQLSTATE;
    END;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.appointment_evidence_capture() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER appointments_v3_evidence_capture AFTER INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION private.appointment_evidence_capture();

-- The Held / No show action (D4 §3.4). INVOKER: the status write runs under the appointments_update RLS (#22).
CREATE FUNCTION public.record_appointment_outcome(p_request_id uuid, p_appointment_id uuid, p_expected_start timestamptz,
                                                  p_outcome text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.appointments;
BEGIN
  IF p_request_id IS NULL OR p_appointment_id IS NULL OR p_expected_start IS NULL OR p_outcome IS NULL
     OR p_outcome NOT IN ('held', 'no_show') THEN
    RAISE EXCEPTION 'Invalid appointment outcome' USING ERRCODE = '22023';
  END IF;
  IF now() < p_expected_start THEN
    RAISE EXCEPTION 'An outcome can be recorded only once the appointment has started' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('agentflow.appointment_outcome_request', p_request_id::text, true);
  UPDATE public.appointments a SET status = CASE p_outcome WHEN 'held' THEN 'Completed' ELSE 'No Show' END
   WHERE a.id = p_appointment_id AND a.organization_id = public.get_org_id() AND a.start_time = p_expected_start
  RETURNING * INTO v_row;
  PERFORM set_config('agentflow.appointment_outcome_request', '', true);
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Appointment changed or is not available. Refresh and try again.' USING ERRCODE = 'PT409';
  END IF;
  RETURN jsonb_build_object('appointment_id', v_row.id, 'request_id', p_request_id, 'outcome', p_outcome,
                            'status', v_row.status, 'start_time', v_row.start_time);
END $$;
REVOKE ALL ON FUNCTION public.record_appointment_outcome(uuid, uuid, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_appointment_outcome(uuid, uuid, timestamptz, text) TO authenticated;

-- The outcome capture window opens with the install; its start is cap_start (D4 §3.4).
INSERT INTO private.appointment_evidence_capture_windows (capture_kind) VALUES ('appointment_outcomes');

DO $acl$
DECLARE f regprocedure := 'public.record_appointment_outcome(uuid,uuid,timestamptz,text)'::regprocedure;
BEGIN
  IF NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
     OR has_function_privilege('service_role', f, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = f AND x.grantee <> p.proowner
                 AND x.grantee <> 'authenticated'::regrole) THEN
    RAISE EXCEPTION 'Appointment evidence: record_appointment_outcome ACL is not authenticated-only' USING ERRCODE = 'P0001';
  END IF;
END $acl$;
