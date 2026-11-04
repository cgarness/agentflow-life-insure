-- Reports V2 PKG-D (D4 §3.5): explicit, post-commit closing-appointment attributions. Privilege class W: its only
-- GRANTs are EXECUTE on get_policy_appointment_links(uuid), link_policy_appointment(uuid,uuid,uuid,timestamptz,text,
-- text) and correct_policy_appointment_link(uuid,uuid,uuid,uuid,timestamptz,text) TO authenticated. Never part of a
-- sale and never fails one. No RLS change; no FK to wins.
SET LOCAL lock_timeout = '2s';

DO $guard$
BEGIN
  IF to_regclass('private.appointment_occurrences') IS NULL OR to_regclass('private.appointment_outcome_events') IS NULL THEN
    RAISE EXCEPTION 'Policy appointment attributions: the appointment evidence (…41) must be applied first' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('private.policy_appointment_attributions') IS NOT NULL
     OR to_regprocedure('public.link_policy_appointment(uuid,uuid,uuid,timestamptz,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Policy appointment attributions: refusing replay' USING ERRCODE = 'P0001';
  END IF;
  -- (A) replicates appointments_select exactly; any change to that policy must be re-reviewed here first.
  IF (SELECT md5(qual) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'appointments' AND policyname = 'appointments_select')
     IS DISTINCT FROM '37d5fe183d0ab58b51809bb3e44be3b2' THEN
    RAISE EXCEPTION 'Policy appointment attributions: appointments_select drift' USING ERRCODE = 'P0001';
  END IF;
END $guard$;

CREATE TABLE private.policy_appointment_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  win_id uuid NOT NULL,
  buyer_id uuid,
  declaration text NOT NULL CHECK (declaration IN ('appointment', 'none')),
  appointment_id uuid,
  occurrence_id uuid REFERENCES private.appointment_occurrences (id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('sale_entry', 'outcome_entry', 'policy_entry', 'admin_correction')),
  request_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  attributed_by uuid NOT NULL,
  attributed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  supersedes_attribution_id uuid UNIQUE REFERENCES private.policy_appointment_attributions (id) ON DELETE RESTRICT,
  CHECK ((declaration = 'appointment') = (appointment_id IS NOT NULL AND occurrence_id IS NOT NULL)),
  CONSTRAINT paa_request UNIQUE (organization_id, request_id, win_id)
);
CREATE UNIQUE INDEX paa_one_root ON private.policy_appointment_attributions (organization_id, policy_id)
  WHERE supersedes_attribution_id IS NULL;
CREATE INDEX paa_occurrence ON private.policy_appointment_attributions (occurrence_id);
ALTER TABLE private.policy_appointment_attributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.policy_appointment_attributions FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER paa_append_only BEFORE UPDATE OR DELETE ON private.policy_appointment_attributions
  FOR EACH ROW EXECUTE FUNCTION private.guard_appointment_evidence_append_only();
CREATE TRIGGER paa_no_truncate BEFORE TRUNCATE ON private.policy_appointment_attributions
  FOR EACH STATEMENT EXECUTE FUNCTION private.guard_appointment_evidence_append_only();
INSERT INTO private.appointment_evidence_capture_windows (capture_kind) VALUES ('policy_appointment_attribution');

-- (A): an exact replica of the appointments_select policy, evaluated with the caller's JWT functions.
CREATE FUNCTION private.appointment_visible_to_caller(p_org uuid, p_appointment_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.appointments a
                  WHERE a.id = p_appointment_id AND a.organization_id = p_org
                    AND a.organization_id = public.get_org_id()
                    AND (a.user_id = auth.uid() OR a.created_by = auth.uid() OR public.get_user_role() = 'Admin' OR public.is_super_admin()
                         OR EXISTS (SELECT 1 FROM public.profiles p
                                     WHERE p.id = auth.uid() AND p.role = 'Team Leader' AND p.team_id IS NOT NULL
                                       AND a.user_id IN (SELECT profiles.id FROM public.profiles WHERE profiles.team_id = p.team_id))))
$$;
REVOKE ALL ON FUNCTION private.appointment_visible_to_caller(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The assignee in effect at an occurrence's scheduled start (D-O4): the latest assignment event at or before it,
-- else the opening snapshot.
CREATE FUNCTION private.appointment_assignee_at_start(p_occurrence_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    (SELECT e.assignee_after FROM private.appointment_assignment_events e
      WHERE e.appointment_id = o.appointment_id AND e.changed_at <= o.scheduled_start ORDER BY e.changed_at DESC, e.id DESC LIMIT 1),
    CASE WHEN EXISTS (SELECT 1 FROM private.appointment_assignment_events e
                       WHERE e.appointment_id = o.appointment_id AND e.changed_at <= o.scheduled_start) THEN NULL
         ELSE o.assignee_at_open END)
    FROM private.appointment_occurrences o WHERE o.id = p_occurrence_id
$$;
REVOKE ALL ON FUNCTION private.appointment_assignee_at_start(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The head (unsuperseded) outcome and the category of an occurrence (latest human snapshot, else the opening one).
CREATE FUNCTION private.appointment_occurrence_state(p_occurrence_id uuid, p_as_of timestamptz)
RETURNS TABLE (outcome text, category text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (SELECT e.outcome FROM private.appointment_outcome_events e
           WHERE e.occurrence_id = o.id AND e.recorded_at <= p_as_of
             AND NOT EXISTS (SELECT 1 FROM private.appointment_outcome_events n
                              WHERE n.supersedes_event_id = e.id AND n.recorded_at <= p_as_of)
           ORDER BY e.recorded_at DESC LIMIT 1),
         coalesce((SELECT b.category FROM private.appointment_evidence_observations b
                    WHERE b.appointment_id = o.appointment_id AND b.category IS NOT NULL AND b.actor_id IS NOT NULL
                      AND b.op = 'UPDATE' AND b.observed_at <= p_as_of AND b.observed_at >= o.opened_at
                    ORDER BY b.id DESC LIMIT 1), o.category)
    FROM private.appointment_occurrences o WHERE o.id = p_occurrence_id
$$;
REVOKE ALL ON FUNCTION private.appointment_occurrence_state(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Resolves a link target: the held sales occurrence of a visible appointment at p_occurrence_start (else its latest
-- held occurrence), with contact ∈ {buyer, client.lead_id} and a Sold Date on or after its agency date.
CREATE FUNCTION private.policy_appointment_target(p_org uuid, p_win public.wins, p_lead_id uuid, p_appointment_id uuid,
                                                  p_occurrence_start timestamptz)
RETURNS TABLE (occurrence_id uuid, reason text)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE o private.appointment_occurrences; s record; v_tz text;
BEGIN
  IF NOT private.appointment_visible_to_caller(p_org, p_appointment_id) THEN
    RETURN QUERY SELECT NULL::uuid, 'appointment_not_found'::text; RETURN;
  END IF;
  SELECT x.* INTO o FROM private.appointment_occurrences x
   WHERE x.appointment_id = p_appointment_id AND x.organization_id = p_org AND x.close_reason IS DISTINCT FROM 'slot_corrected'
     AND (p_occurrence_start IS NULL OR x.scheduled_start = p_occurrence_start)
     AND (p_occurrence_start IS NOT NULL OR (SELECT st.outcome FROM private.appointment_occurrence_state(x.id, clock_timestamp()) st) = 'held')
   ORDER BY x.seq DESC LIMIT 1;
  IF o.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, CASE WHEN p_occurrence_start IS NULL THEN 'not_held' ELSE 'occurrence_not_found' END; RETURN;
  END IF;
  SELECT * INTO s FROM private.appointment_occurrence_state(o.id, clock_timestamp());
  IF s.outcome IS DISTINCT FROM 'held' THEN RETURN QUERY SELECT NULL::uuid, 'not_held'::text; RETURN; END IF;
  IF s.category IS DISTINCT FROM 'sales' THEN RETURN QUERY SELECT NULL::uuid, 'not_a_sales_appointment'::text; RETURN; END IF;
  IF o.contact_id IS NULL OR o.contact_id NOT IN (p_win.contact_id, coalesce(p_lead_id, p_win.contact_id)) THEN
    RETURN QUERY SELECT NULL::uuid, 'different_contact'::text; RETURN;
  END IF;
  v_tz := (SELECT z.time_zone FROM private.report_agency_time_zone(p_org) z);
  IF p_win.sold_date IS NULL OR p_win.sold_date < (o.scheduled_start AT TIME ZONE coalesce(v_tz, 'UTC'))::date THEN
    RETURN QUERY SELECT NULL::uuid, 'sale_before_appointment'::text; RETURN;
  END IF;
  RETURN QUERY SELECT o.id, NULL::text;
END $$;
REVOKE ALL ON FUNCTION private.policy_appointment_target(uuid, public.wins, uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- (P): the record_client_policy predicate on the win's client (20261005161611:264-266), or the original seller.
CREATE FUNCTION private.policy_appointment_authority(p_uid uuid, p_role text, p_super boolean, p_seller uuid, p_client_agent uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p_seller = p_uid OR p_client_agent = p_uid OR p_role = 'Admin' OR p_super
                  OR (p_role IN ('Team Leader', 'Team Lead') AND public.is_ancestor_of(p_uid, p_client_agent)), false)
$$;
REVOKE ALL ON FUNCTION private.policy_appointment_authority(uuid, text, boolean, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.policy_appointment_head(p_org uuid, p_policy uuid) RETURNS private.policy_appointment_attributions
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT a.* FROM private.policy_appointment_attributions a
   WHERE a.organization_id = p_org AND a.policy_id = p_policy
     AND NOT EXISTS (SELECT 1 FROM private.policy_appointment_attributions n WHERE n.supersedes_attribution_id = a.id)
$$;
REVOKE ALL ON FUNCTION private.policy_appointment_head(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Shared write path of link_policy_appointment and correct_policy_appointment_link.
CREATE FUNCTION private.policy_appointment_write(p_request_id uuid, p_win_id uuid, p_appointment_id uuid, p_occurrence_start timestamptz,
  p_declaration text, p_source text, p_expected_attribution_id uuid, p_correction boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; w public.wins; v_client_agent uuid; v_lead uuid; v_hash text; v_prior private.policy_appointment_attributions;
  v_head private.policy_appointment_attributions; t record; v_id uuid;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF p_request_id IS NULL OR p_win_id IS NULL OR p_declaration IS NULL OR p_declaration NOT IN ('appointment', 'none')
     OR (p_declaration = 'none') <> (p_appointment_id IS NULL)
     OR p_source NOT IN ('sale_entry', 'outcome_entry', 'policy_entry', 'admin_correction')
     OR (p_correction <> (p_source = 'admin_correction')) THEN
    RAISE EXCEPTION 'Invalid closing appointment link' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO w FROM public.wins x WHERE x.id = p_win_id AND x.organization_id = a.org_id AND x.policy_id IS NOT NULL;
  SELECT c.assigned_agent_id, c.lead_id INTO v_client_agent, v_lead FROM public.clients c
   WHERE c.id = w.contact_id AND c.organization_id = a.org_id;
  IF w.id IS NULL OR NOT private.policy_appointment_authority(a.uid, a.actor_role, a.is_super, w.agent_id, v_client_agent)
     OR (p_correction AND NOT coalesce(a.actor_role IN ('Admin', 'Super Admin') OR a.is_super, false)) THEN
    RAISE EXCEPTION 'Policy not available' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_win_id, p_appointment_id, p_occurrence_start, p_declaration, p_source,
                                                       p_expected_attribution_id)::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(a.org_id::text || ':policy-appointment:' || w.policy_id::text, 0));
  SELECT * INTO v_prior FROM private.policy_appointment_attributions x
   WHERE x.organization_id = a.org_id AND x.request_id = p_request_id AND x.win_id = p_win_id;
  IF FOUND THEN
    IF v_prior.payload_hash <> v_hash OR v_prior.attributed_by <> a.uid THEN
      RAISE EXCEPTION 'This link request was already used for a different link' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('status', 'unchanged', 'reason', NULL, 'attribution_id', v_prior.id);
  END IF;
  SELECT NULL::uuid AS occurrence_id, NULL::text AS reason INTO t;
  v_head := private.policy_appointment_head(a.org_id, w.policy_id);
  IF p_correction AND v_head.id IS DISTINCT FROM p_expected_attribution_id THEN
    RAISE EXCEPTION 'The closing appointment link changed; reload and try again' USING ERRCODE = 'PT409';
  END IF;
  IF p_declaration = 'appointment' THEN
    SELECT * INTO t FROM private.policy_appointment_target(a.org_id, w, v_lead, p_appointment_id, p_occurrence_start);
    IF t.reason IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'rejected', 'reason', t.reason, 'attribution_id', NULL);
    END IF;
  END IF;
  IF NOT p_correction AND v_head.id IS NOT NULL THEN
    -- A root 'none' may be superseded once, by the assignee at start or the original seller (outcome/policy entry).
    IF NOT (v_head.declaration = 'none' AND v_head.supersedes_attribution_id IS NULL AND p_declaration = 'appointment'
            AND p_source IN ('outcome_entry', 'policy_entry')
            AND a.uid IN (w.agent_id, private.appointment_assignee_at_start(t.occurrence_id))) THEN
      RETURN jsonb_build_object('status', 'rejected', 'reason', 'already_linked', 'attribution_id', v_head.id);
    END IF;
  END IF;
  INSERT INTO private.policy_appointment_attributions (organization_id, policy_id, win_id, buyer_id, declaration, appointment_id,
    occurrence_id, source, request_id, payload_hash, attributed_by, supersedes_attribution_id)
  VALUES (a.org_id, w.policy_id, w.id, w.contact_id, p_declaration, p_appointment_id, t.occurrence_id, p_source, p_request_id, v_hash,
          a.uid, v_head.id)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('status', CASE WHEN p_declaration = 'none' THEN 'declared_none' ELSE 'linked' END, 'reason', NULL,
                            'attribution_id', v_id);
END $$;
REVOKE ALL ON FUNCTION private.policy_appointment_write(uuid, uuid, uuid, timestamptz, text, text, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.link_policy_appointment(p_request_id uuid, p_win_id uuid, p_appointment_id uuid,
  p_occurrence_start timestamptz DEFAULT NULL, p_declaration text DEFAULT 'appointment', p_source text DEFAULT 'sale_entry')
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT private.policy_appointment_write(p_request_id, p_win_id, p_appointment_id, p_occurrence_start, p_declaration,
                                          coalesce(p_source, 'sale_entry'), NULL, false)
$$;
REVOKE ALL ON FUNCTION public.link_policy_appointment(uuid, uuid, uuid, timestamptz, text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.correct_policy_appointment_link(p_request_id uuid, p_win_id uuid, p_expected_attribution_id uuid,
  p_appointment_id uuid, p_occurrence_start timestamptz DEFAULT NULL, p_declaration text DEFAULT 'appointment')
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT private.policy_appointment_write(p_request_id, p_win_id, p_appointment_id, p_occurrence_start, p_declaration,
                                          'admin_correction', p_expected_attribution_id, true)
$$;
REVOKE ALL ON FUNCTION public.correct_policy_appointment_link(uuid, uuid, uuid, uuid, timestamptz, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_policy_appointment_links(p_client_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; c public.clients;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  SELECT * INTO c FROM public.clients x WHERE x.id = p_client_id AND x.organization_id = a.org_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Policy not available' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('policies', coalesce((
    SELECT jsonb_agg(jsonb_build_object('win_id', w.id, 'policy_id', w.policy_id, 'sold_date', w.sold_date,
             'carrier', c.carrier, 'policy_type', c.policy_type,
             'link', CASE WHEN h.id IS NULL THEN NULL ELSE jsonb_build_object('attribution_id', h.id, 'declaration', h.declaration)
                       || CASE WHEN h.appointment_id IS NOT NULL AND private.appointment_visible_to_caller(a.org_id, h.appointment_id)
                               THEN jsonb_build_object('appointment_id', h.appointment_id,
                                      'occurrence_start', (SELECT o.scheduled_start FROM private.appointment_occurrences o WHERE o.id = h.occurrence_id))
                               ELSE '{}'::jsonb END END)
             ORDER BY w.sold_date, w.id)
      FROM public.wins w
      LEFT JOIN LATERAL (SELECT (private.policy_appointment_head(a.org_id, w.policy_id)).*) h ON true
     WHERE w.organization_id = a.org_id AND w.contact_id = c.id AND w.policy_id IS NOT NULL
       AND private.policy_appointment_authority(a.uid, a.actor_role, a.is_super, w.agent_id, c.assigned_agent_id)), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_policy_appointment_links(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_policy_appointment_links(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_policy_appointment(uuid, uuid, uuid, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_policy_appointment_link(uuid, uuid, uuid, uuid, timestamptz, text) TO authenticated;

DO $acl$
DECLARE f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.get_policy_appointment_links(uuid)'::regprocedure,
                           'public.link_policy_appointment(uuid,uuid,uuid,timestamptz,text,text)'::regprocedure,
                           'public.correct_policy_appointment_link(uuid,uuid,uuid,uuid,timestamptz,text)'::regprocedure] LOOP
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('service_role', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = f AND x.grantee <> p.proowner
                   AND x.grantee <> 'authenticated'::regrole) THEN
      RAISE EXCEPTION 'Policy appointment attributions: % ACL is not authenticated-only', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $acl$;
