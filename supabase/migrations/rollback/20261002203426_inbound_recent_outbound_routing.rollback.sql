-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260927052736_inbound_recent_outbound_routing.sql (recent-outbound callback routing)
--
-- ⚠ DELIBERATELY PARTIAL. This rollback turns the feature OFF and restores the exact M6 routing code:
--   • disables EVERY configuration row (enabled = false, unanswered_eligible = false);
--   • restores the VERBATIM M6 bodies of public.plan_inbound_route and private.intended_recipients_for_call
--     (asserts md5(prosrc) = the M6 values and that no other function attribute or ACL changed);
--   • drops private.recent_outbound_route_candidate and public.record_outbound_dial_evidence.
-- It deliberately KEEPS:
--   • the widened inbound_route_attempts_owner_source_check — attempt rows already routed with
--     owner_source 'recent_outbound' would violate a re-narrowed CHECK;
--   • the three inbound_route_attempts.owner_evidence_* columns and their CHECK (they describe those rows);
--   • private.outbound_dial_evidence and private.recent_outbound_routing_orgs with their rows — deleting
--     evidence is a data deletion that needs its own approval (AGENT_RULES #28).
-- After this rollback the forward migration re-applies cleanly and inert (its preconditions accept exactly
-- this residue and refuse while any configuration row is enabled).
-- After this rollback, notification recovery for an already-committed recent_outbound call with an EMPTY
-- snapshot resolves to the inbound group (M6 precedence: there is no recent-outbound tier), while
-- abandon_inbound_routing's reserved/owner snapshot still picks the dialer.
--
-- ⚠ ORDER: the M6 rollback must NEVER run while the forward migration is present — run THIS rollback first
--   (M6's rollback drops private.phone_digits_e164ish and the attempt table this feature depends on).
-- ⚠ NOT EXECUTED REMOTELY. One transaction; refuses unless both functions carry the forward or M6 bodies.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
LOCK TABLE public.inbound_route_attempts IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE ro_rb_snapshot (fn regprocedure PRIMARY KEY, meta jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE ro_rb_config (n integer NOT NULL) ON COMMIT DROP;

DO $pre$
DECLARE
  v_plan regprocedure := to_regprocedure('public.plan_inbound_route(uuid,uuid,uuid,text,uuid[],integer)');
  v_irc regprocedure := to_regprocedure('private.intended_recipients_for_call(uuid,uuid)');
BEGIN
  IF v_plan IS NULL OR v_irc IS NULL THEN
    RAISE EXCEPTION 'recent_outbound rollback: plan_inbound_route / intended_recipients_for_call missing; refusing';
  END IF;
  -- only the forward bodies (4af4a584ff92cf902c16afef865594e9 / d74672de7b57e65c5fca97015732977a) or the M6 bodies (a re-run) are accepted
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = v_plan) NOT IN ('4af4a584ff92cf902c16afef865594e9', 'a3f59ba5a8d35ed98300d6f1dab38295')
     OR (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = v_irc) NOT IN ('d74672de7b57e65c5fca97015732977a', '7104284f7aa79c8d1ef270eb0fe82de2') THEN
    RAISE EXCEPTION 'recent_outbound rollback: unexpected function bodies (neither this migration''s nor M6''s); refusing';
  END IF;
  IF to_regclass('private.recent_outbound_routing_orgs') IS NULL OR to_regclass('private.outbound_dial_evidence') IS NULL THEN
    RAISE EXCEPTION 'recent_outbound rollback: the forward migration was never applied here; refusing';
  END IF;
  -- metadata snapshot (everything except the body). proargdefaults is left out: it stores parse locations, which
  -- differ when this file is sent as ONE query string; the defaults are compared through pg_get_function_arguments.
  INSERT INTO pg_temp.ro_rb_snapshot (fn, meta)
  SELECT p.oid::regprocedure,
         (to_jsonb(p) - 'prosrc' - 'prosqlbody' - 'proargdefaults') || jsonb_build_object(
           'args', pg_catalog.pg_get_function_arguments(p.oid), 'result', pg_catalog.pg_get_function_result(p.oid))
    FROM pg_catalog.pg_proc p WHERE p.oid IN (v_plan, v_irc);
  INSERT INTO pg_temp.ro_rb_config (n) SELECT count(*)::integer FROM private.recent_outbound_routing_orgs;
END;
$pre$;

-- ── 1. Off first: no organization routes on recent-outbound evidence from here on ─────────────────
UPDATE private.recent_outbound_routing_orgs
   SET enabled = false, unanswered_eligible = false, updated_at = now()
 WHERE enabled OR unanswered_eligible;

-- ── 2. The VERBATIM M6 bodies (20260915035141 §6 and §12c) with M6's ACL re-assertions ───────────
CREATE OR REPLACE FUNCTION public.plan_inbound_route(
  p_call_row_id uuid,
  p_org_id uuid,
  p_owner_agent_id uuid,
  p_owner_source text,
  p_candidate_group_ids uuid[],
  p_browser_ring_seconds integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a public.inbound_route_attempts%ROWTYPE;
  c public.calls%ROWTYPE;
  v_owner_ok boolean := false;
  v_avail text; v_identity text;
  v_connected boolean; v_busy boolean; v_mobile text;
  v_stage text; v_reason text; v_missed_reason text;
  v_group uuid[]; v_eligible uuid[] := '{}'; v_id uuid;
  v_ring integer := greatest(5, least(120, coalesce(p_browser_ring_seconds, 20)));
  r jsonb;
BEGIN
  IF p_call_row_id IS NULL OR p_org_id IS NULL THEN
    RAISE EXCEPTION 'plan_inbound_route: call and organization required' USING ERRCODE = '22023';
  END IF;

  -- Idempotent: a duplicate initial webhook returns the persisted attempt and writes nothing.
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = p_call_row_id;
  IF FOUND THEN
    RETURN jsonb_build_object('created', false, 'attempt', to_jsonb(a), 'stage', a.stage,
                              'targets', to_jsonb(a.reserved_agent_ids));
  END IF;

  -- LOCK ORDER (corrective pass 4): the parent `calls` row is locked FIRST (FOR UPDATE), then any agent
  -- advisory lock. Every writer that touches both (plan, advance_to_owner_mobile, commit_owner_mobile)
  -- takes them in this order; finalize / abandon / claim take only the row lock. The terminal check and
  -- the attempt insert are therefore one atomic decision: a finalize that lands while this planner waits
  -- for an agent lock either ran BEFORE (the row reads terminal here and nothing is created) or waits for
  -- this transaction and then closes the attempt it created (finalize closes open ringing stages).
  SELECT * INTO c FROM public.calls WHERE id = p_call_row_id AND organization_id = p_org_id AND direction = 'inbound' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('created', false, 'reason', 'call_not_found');
  END IF;
  -- A call already finalized (the webhook's infrastructure-failure path answered it, or it ended) is never
  -- planned: planning work that outlives the request deadline must not start a ring on a dead call.
  IF c.ended_at IS NOT NULL OR c.status IN ('completed','failed','no-answer') THEN
    RETURN jsonb_build_object('created', false, 'reason', 'call_terminal');
  END IF;
  -- Routing and recovery agree on ONE persisted decision: a call is planned by v2 only when the handler
  -- recorded 'v2' for it (record_inbound_engine_decision) — never on the organization's current flag.
  IF c.routing_engine IS DISTINCT FROM 'v2' THEN
    RETURN jsonb_build_object('created', false, 'reason', 'engine_mismatch', 'engine', c.routing_engine);
  END IF;

  -- ── Owner mode ──
  IF p_owner_agent_id IS NOT NULL THEN
    SELECT p.availability_status, p.twilio_client_identity INTO v_avail, v_identity
      FROM public.profiles p
     WHERE p.id = p_owner_agent_id AND p.organization_id = p_org_id AND p.status = 'Active';
    v_owner_ok := FOUND;
  END IF;

  IF v_owner_ok THEN
    PERFORM pg_advisory_xact_lock(hashtext('inbound_agent:' || p_owner_agent_id::text));
    v_connected := public.is_phone_connected(p_owner_agent_id)
                   AND btrim(coalesce(v_identity, '')) <> ''
                   AND coalesce(v_avail, 'Available') <> 'Offline';
    v_busy := public.is_agent_busy(p_org_id, p_owner_agent_id, p_call_row_id);
    SELECT s.mobile_forward_number INTO v_mobile
      FROM public.agent_inbound_settings s
     WHERE s.agent_id = p_owner_agent_id AND s.organization_id = p_org_id AND s.mobile_forward_enabled;

    IF v_avail IN ('On Break','Do Not Disturb') THEN
      v_stage := 'owner_voicemail'; v_reason := 'owner_dnd'; v_missed_reason := 'dnd';
    ELSIF v_busy THEN
      v_stage := 'owner_voicemail'; v_reason := 'owner_busy'; v_missed_reason := 'busy';
    ELSIF NOT v_connected THEN
      IF v_mobile IS NOT NULL THEN
        v_stage := 'owner_mobile'; v_reason := 'owner_offline_mobile';
      ELSE
        v_stage := 'owner_voicemail'; v_reason := 'owner_offline_no_mobile'; v_missed_reason := 'offline_no_mobile';
      END IF;
    ELSE
      v_stage := 'owner_browser'; v_reason := 'owner_available_connected';
    END IF;

    INSERT INTO public.inbound_route_attempts
      (call_id, organization_id, mode, owner_agent_id, owner_source, eligibility_reason, stage,
       reserved_agent_ids, browser_ring_timeout_sent, voicemail_kind, voicemail_agent_id)
    VALUES
      (p_call_row_id, p_org_id, 'owner', p_owner_agent_id,
       CASE WHEN p_owner_source IN ('contact','direct_line') THEN p_owner_source ELSE 'contact' END,
       v_reason, v_stage,
       CASE WHEN v_stage = 'owner_browser' THEN ARRAY[p_owner_agent_id] ELSE '{}'::uuid[] END,
       CASE WHEN v_stage = 'owner_browser' THEN v_ring END,
       CASE WHEN v_stage = 'owner_voicemail' THEN 'agent' END,
       CASE WHEN v_stage = 'owner_voicemail' THEN p_owner_agent_id END)
    ON CONFLICT (call_id) DO NOTHING
    RETURNING * INTO a;
    IF NOT FOUND THEN
      SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = p_call_row_id;
      RETURN jsonb_build_object('created', false, 'attempt', to_jsonb(a), 'stage', a.stage,
                                'targets', to_jsonb(a.reserved_agent_ids));
    END IF;

    IF v_stage = 'owner_mobile' THEN
      -- Immediate offline forwarding: the D13 mark, destination snapshot and reservation commit HERE.
      r := private.commit_owner_mobile(a.id, p_call_row_id, p_org_id, p_owner_agent_id, v_mobile, NULL);
      IF (r->>'forward')::boolean IS DISTINCT FROM true THEN
        v_missed_reason := CASE r->>'reason' WHEN 'dnd' THEN 'dnd' WHEN 'busy' THEN 'busy' ELSE 'offline_no_mobile' END;
        UPDATE public.inbound_route_attempts
           SET stage = 'owner_voicemail', stage_started_at = now(), reserved_agent_ids = '{}',
               voicemail_kind = 'agent', voicemail_agent_id = p_owner_agent_id,
               eligibility_reason = v_reason || '->' || coalesce(r->>'reason', 'refused'), updated_at = now()
         WHERE id = a.id;
        PERFORM public.mark_inbound_missed(p_call_row_id, p_org_id, v_missed_reason, ARRAY[p_owner_agent_id], p_owner_agent_id);
      END IF;
    ELSIF v_stage = 'owner_voicemail' THEN
      PERFORM public.mark_inbound_missed(p_call_row_id, p_org_id, v_missed_reason, ARRAY[p_owner_agent_id], p_owner_agent_id);
    END IF;

    SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
    RETURN jsonb_build_object('created', true, 'attempt', to_jsonb(a), 'stage', a.stage,
                              'targets', to_jsonb(a.reserved_agent_ids), 'mobile', a.mobile_number_dialed);
  END IF;

  -- ── Group mode (no eligible owner) ──
  SELECT coalesce(array_agg(p.id ORDER BY p.id), '{}'::uuid[]) INTO v_group
    FROM public.profiles p
   WHERE p.id = ANY (coalesce(p_candidate_group_ids, '{}'::uuid[]))
     AND p.organization_id = p_org_id AND p.status = 'Active'
     AND btrim(coalesce(p.twilio_client_identity, '')) <> '';

  FOREACH v_id IN ARRAY v_group LOOP
    PERFORM pg_advisory_xact_lock(hashtext('inbound_agent:' || v_id::text));
  END LOOP;

  SELECT coalesce(array_agg(p.id ORDER BY p.id), '{}'::uuid[]) INTO v_eligible
    FROM public.profiles p
   WHERE p.id = ANY (v_group)
     AND coalesce(p.availability_status, 'Available') = 'Available'
     AND public.is_phone_connected(p.id)
     AND NOT public.is_agent_busy(p_org_id, p.id, p_call_row_id);

  IF cardinality(v_eligible) = 0 THEN
    v_stage := 'group_voicemail';
    v_reason := CASE WHEN p_owner_agent_id IS NOT NULL THEN 'owner_ineligible->group_empty'
                     WHEN cardinality(v_group) = 0 THEN 'group_unconfigured' ELSE 'group_none_eligible' END;
  ELSE
    v_stage := 'group_browser';
    v_reason := CASE WHEN p_owner_agent_id IS NOT NULL THEN 'owner_ineligible->group' ELSE 'no_owner->group' END;
  END IF;

  INSERT INTO public.inbound_route_attempts
    (call_id, organization_id, mode, owner_agent_id, owner_source, eligibility_reason, stage,
     reserved_agent_ids, browser_ring_timeout_sent, voicemail_kind, voicemail_group_ids)
  VALUES
    (p_call_row_id, p_org_id, 'group', NULL, NULL, v_reason, v_stage,
     CASE WHEN v_stage = 'group_browser' THEN v_eligible ELSE '{}'::uuid[] END,
     CASE WHEN v_stage = 'group_browser' THEN v_ring END,
     CASE WHEN v_stage = 'group_voicemail' THEN 'group' END,
     CASE WHEN v_stage = 'group_voicemail' THEN v_group END)
  ON CONFLICT (call_id) DO NOTHING
  RETURNING * INTO a;
  IF NOT FOUND THEN
    SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = p_call_row_id;
    RETURN jsonb_build_object('created', false, 'attempt', to_jsonb(a), 'stage', a.stage,
                              'targets', to_jsonb(a.reserved_agent_ids));
  END IF;

  IF v_stage = 'group_voicemail' THEN
    PERFORM public.mark_inbound_missed(p_call_row_id, p_org_id, 'group_empty', v_group, NULL);
  END IF;

  RETURN jsonb_build_object('created', true, 'attempt', to_jsonb(a), 'stage', a.stage,
                            'targets', to_jsonb(a.reserved_agent_ids), 'group', to_jsonb(v_group));
END;
$$;
REVOKE ALL ON FUNCTION public.plan_inbound_route(uuid, uuid, uuid, text, uuid[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.plan_inbound_route(uuid, uuid, uuid, text, uuid[], integer) FROM anon;
REVOKE ALL ON FUNCTION public.plan_inbound_route(uuid, uuid, uuid, text, uuid[], integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.plan_inbound_route(uuid, uuid, uuid, text, uuid[], integer) TO service_role;

CREATE OR REPLACE FUNCTION private.intended_recipients_for_call(p_call_row_id uuid, p_org_id uuid) RETURNS uuid[]
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE c public.calls%ROWTYPE; v_owner uuid; v_group uuid[]; v_found boolean := false;
BEGIN
  SELECT * INTO c FROM public.calls WHERE id = p_call_row_id AND organization_id = p_org_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- P1: the dialed number is a direct line with an owner
  SELECT pn.assigned_to INTO v_owner FROM public.phone_numbers pn
   WHERE pn.organization_id = p_org_id AND pn.is_direct_line AND pn.assigned_to IS NOT NULL
     AND pn.phone_number = c.caller_id_used LIMIT 1;
  IF v_owner IS NOT NULL THEN RETURN ARRAY[v_owner]; END IF;
  -- D2: the identified contact's assigned agent (an Active member of this organization)
  IF c.contact_id IS NOT NULL THEN
    IF c.contact_type = 'client' THEN
      SELECT x.assigned_agent_id INTO v_owner FROM public.clients x WHERE x.id = c.contact_id AND x.organization_id = p_org_id;
    ELSIF c.contact_type = 'recruit' THEN
      SELECT x.assigned_agent_id INTO v_owner FROM public.recruits x WHERE x.id = c.contact_id AND x.organization_id = p_org_id;
    ELSE
      SELECT x.assigned_agent_id INTO v_owner FROM public.leads x WHERE x.id = c.contact_id AND x.organization_id = p_org_id;
    END IF;
    v_found := FOUND;
    IF v_owner IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_owner AND p.organization_id = p_org_id AND p.status = 'Active') THEN
      RETURN ARRAY[v_owner];
    END IF;
    IF NOT v_found THEN RETURN NULL; END IF;   -- the contact row is gone: nothing is established
  END IF;
  -- D5: the caller is unknown or established unassigned ⇒ the configured inbound group
  SELECT NULLIF(irs.inbound_group_agent_ids, '{}'::uuid[]) INTO v_group
    FROM public.inbound_routing_settings irs WHERE irs.organization_id = p_org_id;
  RETURN v_group;
END;
$$;
REVOKE ALL ON FUNCTION private.intended_recipients_for_call(uuid, uuid) FROM PUBLIC;

-- ── 3. Drop the feature's functions (the retained tables, columns and CHECKs stay — see the header) ─
DROP FUNCTION IF EXISTS private.recent_outbound_route_candidate(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.record_outbound_dial_evidence(text, text, text, text, text, text, text, text, text, text, text, text, text, text, timestamptz);

-- ── 4. Postconditions ────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_bad text; v_rows integer; v_flagged integer;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = 'public.plan_inbound_route(uuid,uuid,uuid,text,uuid[],integer)'::regprocedure) <> 'a3f59ba5a8d35ed98300d6f1dab38295'
     OR (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = 'private.intended_recipients_for_call(uuid,uuid)'::regprocedure) <> '7104284f7aa79c8d1ef270eb0fe82de2' THEN
    RAISE EXCEPTION 'recent_outbound rollback postcondition: M6 bodies not restored';
  END IF;
  SELECT string_agg(s.fn::text, ', ') INTO v_bad
    FROM pg_temp.ro_rb_snapshot s JOIN pg_catalog.pg_proc p ON p.oid = s.fn
   WHERE (to_jsonb(p) - 'prosrc' - 'prosqlbody' - 'proargdefaults') || jsonb_build_object(
           'args', pg_catalog.pg_get_function_arguments(p.oid), 'result', pg_catalog.pg_get_function_result(p.oid)) IS DISTINCT FROM s.meta;
  IF v_bad IS NOT NULL OR (SELECT count(*) FROM pg_temp.ro_rb_snapshot) <> 2 THEN
    RAISE EXCEPTION 'recent_outbound rollback postcondition: function metadata or ACL changed (%)', v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
              WHERE (ns.nspname, p.proname) IN (('private','recent_outbound_route_candidate'), ('public','record_outbound_dial_evidence'))) THEN
    RAISE EXCEPTION 'recent_outbound rollback postcondition: resolver or record RPC still present';
  END IF;
  IF to_regclass('private.outbound_dial_evidence') IS NULL OR to_regclass('private.recent_outbound_routing_orgs') IS NULL
     OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid = 'public.inbound_route_attempts'::regclass AND NOT attisdropped
           AND attname IN ('owner_evidence_dial_call_sid','owner_evidence_provider_started_at','owner_evidence_outcome')) <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.inbound_route_attempts'::regclass
                     AND conname = 'inbound_route_attempts_owner_evidence_check')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.inbound_route_attempts'::regclass
                     AND conname = 'inbound_route_attempts_owner_source_check'
                     AND pg_catalog.pg_get_constraintdef(oid) LIKE '%recent_outbound%') THEN
    RAISE EXCEPTION 'recent_outbound rollback postcondition: a deliberately retained object is missing';
  END IF;
  SELECT count(*)::integer, (count(*) FILTER (WHERE enabled OR unanswered_eligible))::integer INTO v_rows, v_flagged
    FROM private.recent_outbound_routing_orgs;
  IF v_rows <> (SELECT n FROM pg_temp.ro_rb_config) OR v_flagged <> 0 THEN
    RAISE EXCEPTION 'recent_outbound rollback postcondition: configuration rows not all disabled (% rows, % flagged)', v_rows, v_flagged;
  END IF;
END;
$post$;
COMMIT;
