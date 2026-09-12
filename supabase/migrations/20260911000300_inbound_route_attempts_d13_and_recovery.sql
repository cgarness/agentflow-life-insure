-- =====================================================================================================
-- Inbound Calling v2 — M6: route attempts, atomic owner-mobile commitment, D13 missed-in-AgentFlow,
-- bridge/acceptance evidence, busy predicate, and the finalize replacement that no longer retracts
-- is_missed (implementation_plan.md rev 3 §7.3 + safeguards 1/5; approved development-only 2026-09-10)
-- =====================================================================================================
-- FUTURE-FACING ONLY: new table, additive calls columns, functions and ACLs. NO data UPDATE/backfill —
-- historical calls are never re-classified. Authored 20260911000300; renamed at apply time.
--
-- Objects:
--   public.inbound_route_attempts                     one row per v2 inbound call; stage machine (CAS);
--                                                     RLS enabled with ZERO client policies (service-role only)
--   calls.answered_by_agent_id / missed_reason / missed_for_agent_id / missed_recipient_ids /
--   calls.missed_notified_at / missed_notify_attempts / missed_notify_next_at / missed_notify_error
--   public.is_agent_busy(uuid, uuid, uuid)             derived occupancy (never stored), stage ceilings (P8)
--   private.commit_owner_mobile(...)                   ONE subtransaction: guarded calls D13 mark + attempt CAS
--   public.plan_inbound_route(...)                     eligibility + reservation + attempt creation, per-agent
--                                                     advisory locks; immediate offline forwarding INSIDE it
--   public.advance_to_owner_mobile(...)                owner_browser → owner_mobile with atomic re-check
--   public.mark_inbound_missed(...)                    the other missed writer (voicemail stages), monotonic
--   public.advance_inbound_route_stage(...)            generic CAS transition
--   public.append_inbound_provider_outcome(...)        bounded telemetry append
--   public.record_inbound_mobile_accept(...)           Press-1 acceptance (never touches calls)
--   public.record_inbound_mobile_bridge(...)           DialBridged evidence → attribution (never is_missed)
--   public.record_inbound_mobile_leg_end(...)          child leg end → busy reservation released
--   public.finalize_inbound_call_terminal(...)         REPLACED: external-answer branch keeps is_missed (D13)

CREATE SCHEMA IF NOT EXISTS private;

-- ── 1. inbound_route_attempts ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inbound_route_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL UNIQUE REFERENCES public.calls(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  mode text NOT NULL CONSTRAINT inbound_route_attempts_mode_check CHECK (mode IN ('owner','group')),
  owner_agent_id uuid,
  owner_source text CONSTRAINT inbound_route_attempts_owner_source_check CHECK (owner_source IN ('contact','direct_line')),
  eligibility_reason text NOT NULL,
  stage text NOT NULL CONSTRAINT inbound_route_attempts_stage_check
    CHECK (stage IN ('owner_browser','owner_mobile','owner_voicemail','group_browser','group_voicemail','done')),
  stage_started_at timestamptz NOT NULL DEFAULT now(),
  reserved_agent_ids uuid[] NOT NULL DEFAULT '{}',
  browser_ring_timeout_sent integer,
  mobile_number_dialed text,
  mobile_child_call_sid text,
  mobile_accepted_at timestamptz,
  mobile_accept_result text CONSTRAINT inbound_route_attempts_accept_check
    CHECK (mobile_accept_result IN ('accepted','accepted_after_hangup','no_digit','wrong_digit')),
  mobile_bridged_at timestamptz,
  mobile_bridge_evidence text CONSTRAINT inbound_route_attempts_bridge_check
    CHECK (mobile_bridge_evidence IN ('dial_bridged','not_bridged','unconfirmed')),
  mobile_leg_ended_at timestamptz,
  voicemail_kind text CONSTRAINT inbound_route_attempts_vm_kind_check CHECK (voicemail_kind IN ('agent','group')),
  voicemail_agent_id uuid,
  voicemail_group_ids uuid[],
  missed_marked_at timestamptz,
  provider_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
  final_outcome text,
  terminal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inbound_route_attempts_reserved_active
  ON public.inbound_route_attempts USING gin (reserved_agent_ids) WHERE NOT terminal;
CREATE INDEX IF NOT EXISTS idx_inbound_route_attempts_org_open
  ON public.inbound_route_attempts (organization_id, terminal, created_at);

COMMENT ON TABLE public.inbound_route_attempts IS
  'Inbound Calling v2: the persisted routing decision for one inbound call (created BEFORE any TwiML by '
  'plan_inbound_route). Every stage transition is a compare-and-swap; duplicate Twilio deliveries are read-only. '
  'reserved_agent_ids holds the agents this attempt is occupying (busy derivation). Service-role only.';

ALTER TABLE public.inbound_route_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inbound_route_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.inbound_route_attempts FROM anon;
REVOKE ALL ON TABLE public.inbound_route_attempts FROM authenticated;
GRANT ALL ON TABLE public.inbound_route_attempts TO service_role;
-- Zero client policies by design (§7.7).

-- ── 2. calls: attribution + D13 classification + notification recovery state ─────────────────────────
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS answered_by_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS missed_reason text,
  ADD COLUMN IF NOT EXISTS missed_for_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS missed_recipient_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS missed_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS missed_notify_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missed_notify_next_at timestamptz,
  ADD COLUMN IF NOT EXISTS missed_notify_error text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calls_missed_reason_check') THEN
    ALTER TABLE public.calls ADD CONSTRAINT calls_missed_reason_check
      CHECK (missed_reason IS NULL OR missed_reason IN
             ('no_answer','busy','dnd','offline_no_mobile','forwarded_to_mobile','group_empty'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_calls_missed_for_agent ON public.calls (missed_for_agent_id, created_at DESC) WHERE is_missed;
CREATE INDEX IF NOT EXISTS idx_calls_missed_recipients ON public.calls USING gin (missed_recipient_ids) WHERE is_missed;
CREATE INDEX IF NOT EXISTS idx_calls_missed_notify_owed ON public.calls (missed_notify_next_at)
  WHERE is_missed AND missed_notified_at IS NULL;

COMMENT ON COLUMN public.calls.answered_by_agent_id IS
  'Inbound Calling v2 (P12): the agent whose MOBILE conversation was proven bridged (record_inbound_mobile_bridge, '
  'DialBridged=true). Attribution only — agent_id stays the <Client> claim proof and is never set by the mobile path.';
COMMENT ON COLUMN public.calls.missed_reason IS
  'INB-D13: why the call is "Missed in AgentFlow". forwarded_to_mobile is written at the forward commit and is '
  'never cleared by a later mobile answer.';
COMMENT ON COLUMN public.calls.missed_recipient_ids IS
  'INB-D13 durable notification recipients snapshot (tier 0). When non-empty, notification recipients are resolved '
  'ONLY from this array (validated Active, same org; org Admins when none is Active) — never from routed/number-owner/'
  'contact-owner tiers, so a later reassignment cannot notify a different person.';

-- ── 3. Busy predicate (derived, never stored) ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_agent_busy(p_org_id uuid, p_agent_id uuid, p_exclude_call_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.calls c
     WHERE c.organization_id = p_org_id
       AND (c.agent_id = p_agent_id OR c.answered_by_agent_id = p_agent_id)
       AND c.status IN ('ringing','connected')
       AND c.ended_at IS NULL
       AND c.created_at > now() - interval '4 hours'
       AND (p_exclude_call_id IS NULL OR c.id <> p_exclude_call_id)
  ) OR EXISTS (
    SELECT 1 FROM public.inbound_route_attempts a
      JOIN public.calls pc ON pc.id = a.call_id
     WHERE a.organization_id = p_org_id
       AND NOT a.terminal
       AND (p_exclude_call_id IS NULL OR a.call_id <> p_exclude_call_id)
       AND p_agent_id = ANY (a.reserved_agent_ids)
       AND (
         -- Browser waves: the reservation follows the AUTHORITATIVE browser claim (claim_inbound_call
         -- writes calls.agent_id). Until someone claims, EVERY reserved member is busy (simultaneous-
         -- call protection). The moment calls.agent_id is set, only the claimant stays busy — through
         -- the calls branch above — and the losing members are released immediately, not five minutes
         -- later when the parent <Dial action> returns after the conversation ends. A parent that has
         -- already ended releases everyone too.
         (a.stage IN ('owner_browser','group_browser') AND pc.agent_id IS NULL AND pc.ended_at IS NULL
            AND a.stage_started_at > now() - interval '5 minutes')
         -- Mobile leg ringing / whisper in progress (no genuine acceptance yet — a wrong or missing digit
         -- keeps the whisper open): reserved for the stage window while the parent and the leg are live.
         OR (a.stage = 'owner_mobile' AND a.mobile_accept_result IS DISTINCT FROM 'accepted'
            AND a.mobile_leg_ended_at IS NULL AND pc.ended_at IS NULL
            AND a.stage_started_at > now() - interval '5 minutes')
         -- GENUINELY accepted mobile leg (approved design, A5b): busy until the child leg's own end callback
         -- arrives — the parent's completion may be reported first — bounded by the 4-hour ceiling. The
         -- other results (accepted_after_hangup / wrong_digit / no_digit) also stamp mobile_accepted_at but
         -- never earn this ceiling: they stay in the whisper branch above and its 5-minute window.
         OR (a.stage = 'owner_mobile' AND a.mobile_accept_result = 'accepted'
             AND a.mobile_leg_ended_at IS NULL
             AND a.mobile_accepted_at > now() - interval '4 hours')
       )
  );
$$;
REVOKE ALL ON FUNCTION public.is_agent_busy(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_agent_busy(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_agent_busy(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_agent_busy(uuid, uuid, uuid) TO service_role;

-- ── 4. mark_inbound_missed — monotonic missed writer for voicemail stages ────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_inbound_missed(
  p_call_row_id uuid, p_org_id uuid, p_reason text, p_recipient_ids uuid[], p_for_agent_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_rows integer := 0;
BEGIN
  IF p_call_row_id IS NULL OR p_org_id IS NULL THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'invalid_args');
  END IF;
  UPDATE public.calls SET
    is_missed            = true,
    missed_reason        = coalesce(missed_reason, p_reason),
    missed_for_agent_id  = coalesce(missed_for_agent_id, p_for_agent_id),
    missed_recipient_ids = CASE WHEN cardinality(missed_recipient_ids) = 0
                                THEN coalesce(p_recipient_ids, '{}'::uuid[]) ELSE missed_recipient_ids END,
    updated_at           = now()
  WHERE id = p_call_row_id
    AND organization_id = p_org_id
    AND direction = 'inbound'
    AND agent_id IS NULL
    AND outcome IS DISTINCT FROM 'forwarded_answered';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_rows > 0);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_inbound_missed(uuid, uuid, text, uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_inbound_missed(uuid, uuid, text, uuid[], uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mark_inbound_missed(uuid, uuid, text, uuid[], uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_inbound_missed(uuid, uuid, text, uuid[], uuid) TO service_role;

-- ── 5. private.commit_owner_mobile — the ONE atomic mobile commitment (safeguard 1) ──────────────────
-- Caller holds pg_advisory_xact_lock for p_owner. Re-evaluates DND/busy, then performs BOTH writes
-- (guarded parent-call D13 mark, then the attempt CAS) inside one subtransaction: if either updates
-- zero rows the whole block rolls back and a refusal is returned — an apparently committed mobile
-- stage can never exist without its D13 mark, and vice versa.
CREATE OR REPLACE FUNCTION private.commit_owner_mobile(
  p_attempt_id uuid, p_call_row_id uuid, p_org_id uuid, p_owner uuid, p_mobile text, p_from_stage text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_avail text; v_rows integer;
BEGIN
  SELECT p.availability_status INTO v_avail
    FROM public.profiles p
   WHERE p.id = p_owner AND p.organization_id = p_org_id AND p.status = 'Active';
  IF NOT FOUND THEN RETURN jsonb_build_object('forward', false, 'reason', 'owner_ineligible'); END IF;
  IF v_avail IN ('On Break','Do Not Disturb') THEN RETURN jsonb_build_object('forward', false, 'reason', 'dnd'); END IF;
  IF public.is_agent_busy(p_org_id, p_owner, p_call_row_id) THEN RETURN jsonb_build_object('forward', false, 'reason', 'busy'); END IF;
  IF p_mobile IS NULL OR btrim(p_mobile) = '' THEN RETURN jsonb_build_object('forward', false, 'reason', 'no_mobile'); END IF;

  BEGIN
    UPDATE public.calls SET
      is_missed            = true,
      missed_reason        = coalesce(missed_reason, 'forwarded_to_mobile'),
      missed_for_agent_id  = coalesce(missed_for_agent_id, p_owner),
      missed_recipient_ids = CASE WHEN cardinality(missed_recipient_ids) = 0 THEN ARRAY[p_owner] ELSE missed_recipient_ids END,
      updated_at           = now()
    WHERE id = p_call_row_id
      AND organization_id = p_org_id
      AND direction = 'inbound'
      AND agent_id IS NULL                                      -- an intervening browser claim refuses the forward
      AND outcome IS DISTINCT FROM 'forwarded_answered'
      AND status NOT IN ('completed','failed','no-answer');      -- a dead parent is never forwarded
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'AF_COMMIT_MOBILE:call_not_forwardable' USING ERRCODE = 'P0001'; END IF;

    UPDATE public.inbound_route_attempts SET
      stage               = 'owner_mobile',
      stage_started_at    = now(),
      reserved_agent_ids  = ARRAY[p_owner],
      mobile_number_dialed = p_mobile,
      missed_marked_at    = now(),
      updated_at          = now()
    WHERE id = p_attempt_id
      AND organization_id = p_org_id
      AND call_id = p_call_row_id
      AND NOT terminal
      AND ((p_from_stage IS NOT NULL AND stage = p_from_stage)
           OR (p_from_stage IS NULL AND stage = 'owner_mobile' AND missed_marked_at IS NULL));
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'AF_COMMIT_MOBILE:stage_conflict' USING ERRCODE = 'P0001'; END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'AF_COMMIT_MOBILE:%' THEN
      RETURN jsonb_build_object('forward', false, 'reason', split_part(SQLERRM, ':', 2));
    END IF;
    RAISE;
  END;

  RETURN jsonb_build_object('forward', true, 'mobile', p_mobile, 'owner', p_owner);
END;
$$;
REVOKE ALL ON FUNCTION private.commit_owner_mobile(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC;

-- ── 6. plan_inbound_route — eligibility + reservation + attempt, one transaction ─────────────────────
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

-- ── 7. advance_to_owner_mobile — browser fallback with atomic re-check ───────────────────────────────
CREATE OR REPLACE FUNCTION public.advance_to_owner_mobile(p_attempt_id uuid, p_org_id uuid, p_call_row_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE a public.inbound_route_attempts%ROWTYPE; v_mobile text; r jsonb; v_missed text;
BEGIN
  SELECT * INTO a FROM public.inbound_route_attempts
   WHERE id = p_attempt_id AND organization_id = p_org_id AND call_id = p_call_row_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('updated', false, 'reason', 'attempt_not_found'); END IF;
  IF a.mode <> 'owner' OR a.owner_agent_id IS NULL THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_owner_mode', 'stage', a.stage, 'terminal', a.terminal);
  END IF;
  -- LOCK ORDER: parent row first (the terminal check is atomic with the writes below), then the agent lock.
  -- A parent that already ended or was finalized (the webhook's failure path answered it) is never advanced
  -- into a mobile dial OR the owner's voicemail: work that outlives the request deadline changes nothing.
  PERFORM 1 FROM public.calls pc WHERE pc.id = p_call_row_id AND pc.organization_id = p_org_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.calls pc WHERE pc.id = p_call_row_id AND pc.organization_id = p_org_id
              AND (pc.ended_at IS NOT NULL OR pc.status IN ('completed','failed','no-answer'))) THEN
    RETURN jsonb_build_object('updated', false, 'forward', false, 'reason', 'call_terminal', 'stage', a.stage, 'terminal', a.terminal);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('inbound_agent:' || a.owner_agent_id::text));
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = p_attempt_id;   -- re-read under the lock
  IF a.terminal OR a.stage <> 'owner_browser' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'stage_mismatch', 'stage', a.stage, 'terminal', a.terminal,
                              'mobile', a.mobile_number_dialed);
  END IF;

  SELECT s.mobile_forward_number INTO v_mobile
    FROM public.agent_inbound_settings s
   WHERE s.agent_id = a.owner_agent_id AND s.organization_id = p_org_id AND s.mobile_forward_enabled;

  r := private.commit_owner_mobile(a.id, p_call_row_id, p_org_id, a.owner_agent_id, v_mobile, 'owner_browser');
  IF (r->>'forward')::boolean IS TRUE THEN
    RETURN jsonb_build_object('updated', true, 'forward', true, 'stage', 'owner_mobile', 'mobile', r->>'mobile',
                              'owner', a.owner_agent_id);
  END IF;

  IF r->>'reason' IN ('call_not_forwardable','stage_conflict') THEN
    SELECT * INTO a FROM public.inbound_route_attempts WHERE id = p_attempt_id;
    RETURN jsonb_build_object('updated', false, 'forward', false, 'reason', r->>'reason', 'stage', a.stage,
                              'terminal', a.terminal);
  END IF;

  -- dnd / busy / no_mobile / owner_ineligible ⇒ voicemail for the owner's mailbox (INB-D6/D7/D11)
  v_missed := CASE r->>'reason' WHEN 'dnd' THEN 'dnd' WHEN 'busy' THEN 'busy'
                                WHEN 'no_mobile' THEN 'no_answer' ELSE 'no_answer' END;
  UPDATE public.inbound_route_attempts
     SET stage = 'owner_voicemail', stage_started_at = now(), reserved_agent_ids = '{}',
         voicemail_kind = 'agent', voicemail_agent_id = a.owner_agent_id,
         eligibility_reason = a.eligibility_reason || '->' || (r->>'reason'), updated_at = now()
   WHERE id = a.id AND stage = 'owner_browser' AND NOT terminal;
  PERFORM public.mark_inbound_missed(p_call_row_id, p_org_id, v_missed, ARRAY[a.owner_agent_id], a.owner_agent_id);
  RETURN jsonb_build_object('updated', true, 'forward', false, 'reason', r->>'reason', 'stage', 'owner_voicemail',
                            'owner', a.owner_agent_id);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_to_owner_mobile(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_to_owner_mobile(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.advance_to_owner_mobile(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.advance_to_owner_mobile(uuid, uuid, uuid) TO service_role;

-- ── 8. Generic CAS transition + bounded telemetry ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.bounded_outcomes(p_existing jsonb, p_entry jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(jsonb_agg(e), '[]'::jsonb)
    FROM (SELECT e FROM jsonb_array_elements(coalesce(p_existing, '[]'::jsonb) || jsonb_build_array(p_entry)) WITH ORDINALITY t(e, n)
           ORDER BY n DESC LIMIT 20) s;
$$;
REVOKE ALL ON FUNCTION private.bounded_outcomes(jsonb, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.advance_inbound_route_stage(
  p_attempt_id uuid, p_org_id uuid, p_from_stage text, p_to_stage text, p_patch jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE a public.inbound_route_attempts%ROWTYPE; v_rows integer := 0; v_parent_terminal boolean := false;
BEGIN
  IF p_to_stage IS NULL OR p_to_stage NOT IN ('owner_browser','owner_mobile','owner_voicemail','group_browser','group_voicemail','done') THEN
    RAISE EXCEPTION 'advance_inbound_route_stage: invalid stage %', p_to_stage USING ERRCODE = '22023';
  END IF;
  -- A stage that rings, dials or records is never entered on a call that already ended or was finalized:
  -- a transition that outlives the webhook's deadline (answered on the failure path meanwhile) is refused.
  -- Closing the attempt ('done') is always allowed — the voicemail-done and leg-end callbacks legitimately
  -- arrive after the parent has ended.
  -- LOCK ORDER: for a transition that rings, dials or records, the parent row is locked (FOR UPDATE) so a
  -- finalize in flight either commits before this check (refused below) or waits for this transaction.
  IF p_to_stage <> 'done' THEN
    SELECT (pc.ended_at IS NOT NULL OR pc.status IN ('completed','failed','no-answer')) INTO v_parent_terminal
      FROM public.calls pc
     WHERE pc.id = (SELECT x.call_id FROM public.inbound_route_attempts x WHERE x.id = p_attempt_id AND x.organization_id = p_org_id)
       FOR UPDATE;
  END IF;
  IF p_to_stage <> 'done' AND coalesce(v_parent_terminal, false) THEN
    SELECT * INTO a FROM public.inbound_route_attempts WHERE id = p_attempt_id AND organization_id = p_org_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('updated', false, 'reason', 'attempt_not_found'); END IF;
    RETURN jsonb_build_object('updated', false, 'stage', a.stage, 'terminal', a.terminal, 'reason', 'call_terminal');
  END IF;
  IF p_to_stage = 'owner_mobile' THEN
    RAISE EXCEPTION 'advance_inbound_route_stage: owner_mobile is committed only through advance_to_owner_mobile'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.inbound_route_attempts SET
    stage              = p_to_stage,
    stage_started_at   = now(),
    terminal           = (p_to_stage = 'done'),
    reserved_agent_ids = CASE WHEN p_to_stage IN ('owner_voicemail','group_voicemail','done') THEN '{}'::uuid[] ELSE reserved_agent_ids END,
    final_outcome      = coalesce(p_patch->>'final_outcome', final_outcome),
    voicemail_kind     = coalesce(p_patch->>'voicemail_kind', voicemail_kind),
    voicemail_agent_id = coalesce((p_patch->>'voicemail_agent_id')::uuid, voicemail_agent_id),
    voicemail_group_ids = CASE WHEN p_patch ? 'voicemail_group_ids'
                               THEN (SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(p_patch->'voicemail_group_ids') x)
                               ELSE voicemail_group_ids END,
    provider_outcomes  = CASE WHEN p_patch ? 'outcome'
                              THEN private.bounded_outcomes(provider_outcomes, (p_patch->'outcome') || jsonb_build_object('at', now(), 'from', p_from_stage, 'to', p_to_stage))
                              ELSE provider_outcomes END,
    updated_at         = now()
  WHERE id = p_attempt_id AND organization_id = p_org_id AND stage = p_from_stage AND NOT terminal;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = p_attempt_id AND organization_id = p_org_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('updated', false, 'reason', 'attempt_not_found'); END IF;
  RETURN jsonb_build_object('updated', v_rows > 0, 'stage', a.stage, 'terminal', a.terminal,
                            'reason', CASE WHEN v_rows > 0 THEN 'ok' ELSE 'stage_mismatch' END);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_inbound_route_stage(uuid, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_inbound_route_stage(uuid, uuid, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.advance_inbound_route_stage(uuid, uuid, text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.advance_inbound_route_stage(uuid, uuid, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.append_inbound_provider_outcome(p_attempt_id uuid, p_org_id uuid, p_entry jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_rows integer := 0;
BEGIN
  UPDATE public.inbound_route_attempts
     SET provider_outcomes = private.bounded_outcomes(provider_outcomes, coalesce(p_entry, '{}'::jsonb) || jsonb_build_object('at', now())),
         updated_at = now()
   WHERE id = p_attempt_id AND organization_id = p_org_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_rows > 0);
END;
$$;
REVOKE ALL ON FUNCTION public.append_inbound_provider_outcome(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_inbound_provider_outcome(uuid, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.append_inbound_provider_outcome(uuid, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.append_inbound_provider_outcome(uuid, uuid, jsonb) TO service_role;

-- ── 9. Mobile acceptance (Press 1) — never touches calls ────────────────────────────────────────────
-- Destination comparison helper (defect 5): digits only; a bare 10-digit US number gets its country code
-- so "(555) 999-0001", "555-999-0001", "15559990001" and "+15559990001" all compare equal.
CREATE OR REPLACE FUNCTION private.phone_digits_e164ish(p text) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  -- A bare 10-digit national number gets the NANP country code; an E.164 input ('+…') is taken as-is,
  -- so a 10-digit non-NANP E.164 number never collides with a +1 number.
  SELECT CASE
    WHEN d = '' THEN NULL
    WHEN length(d) = 10 AND btrim(coalesce(p, '')) NOT LIKE '+%' THEN '1' || d
    ELSE d END
  FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') AS d) x;
$$;
REVOKE ALL ON FUNCTION private.phone_digits_e164ish(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.record_inbound_mobile_accept(
  p_attempt_id uuid, p_org_id uuid, p_call_row_id uuid, p_agent_id uuid, p_child_call_sid text, p_digits text,
  p_parent_call_sid text DEFAULT NULL, p_to_number text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE a public.inbound_route_attempts%ROWTYPE; c public.calls%ROWTYPE; v_child text := btrim(coalesce(p_child_call_sid, ''));
        v_parent text := NULLIF(btrim(coalesce(p_parent_call_sid, '')), '');
        v_to text := private.phone_digits_e164ish(p_to_number);
        v_result text; v_caller_present boolean;
BEGIN
  IF v_child !~ '^CA[0-9a-fA-F]{32}$' THEN RETURN jsonb_build_object('accept', false, 'reason', 'invalid_sid'); END IF;
  SELECT * INTO a FROM public.inbound_route_attempts
   WHERE id = p_attempt_id AND organization_id = p_org_id AND call_id = p_call_row_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('accept', false, 'reason', 'attempt_not_found'); END IF;
  IF a.owner_agent_id IS DISTINCT FROM p_agent_id THEN RETURN jsonb_build_object('accept', false, 'reason', 'agent_mismatch'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('inbound_agent:' || a.owner_agent_id::text));
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = p_attempt_id;
  SELECT * INTO c FROM public.calls WHERE id = p_call_row_id AND organization_id = p_org_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('accept', false, 'reason', 'call_not_found'); END IF;
  -- Identity binding (corrective pass, defect 5): the whisper request's ParentCallSid must be the stored
  -- parent and its To must be the destination snapshot this attempt dialed — never a different call, a
  -- different attempt or a different number.
  IF v_parent IS NOT NULL AND c.twilio_call_sid IS DISTINCT FROM v_parent THEN
    RETURN jsonb_build_object('accept', false, 'reason', 'parent_sid_mismatch');
  END IF;
  IF v_to IS NOT NULL AND private.phone_digits_e164ish(a.mobile_number_dialed) IS DISTINCT FROM v_to THEN
    RETURN jsonb_build_object('accept', false, 'reason', 'destination_mismatch');
  END IF;
  IF a.stage <> 'owner_mobile' OR a.terminal THEN
    RETURN jsonb_build_object('accept', false, 'reason', 'stage_mismatch', 'stage', a.stage);
  END IF;
  IF a.mobile_child_call_sid IS NOT NULL AND a.mobile_child_call_sid <> v_child THEN
    RETURN jsonb_build_object('accept', false, 'reason', 'child_sid_mismatch');
  END IF;
  v_caller_present := c.ended_at IS NULL AND c.status NOT IN ('completed','failed','no-answer');
  IF a.mobile_accepted_at IS NOT NULL THEN
    -- Replay of a recorded acceptance: the ORIGINAL acceptance fact is preserved untouched, but
    -- bridge permission is granted only while the caller is still present.
    RETURN jsonb_build_object('accept', a.mobile_accept_result = 'accepted' AND v_caller_present,
                              'idempotent', true, 'result', a.mobile_accept_result, 'caller_present', v_caller_present);
  END IF;

  IF btrim(coalesce(p_digits, '')) = '' THEN v_result := 'no_digit';
  ELSIF btrim(p_digits) <> '1' THEN v_result := 'wrong_digit';
  ELSIF NOT v_caller_present THEN v_result := 'accepted_after_hangup';
  ELSE v_result := 'accepted';
  END IF;

  UPDATE public.inbound_route_attempts
     SET mobile_child_call_sid = coalesce(mobile_child_call_sid, v_child),
         mobile_accepted_at = now(), mobile_accept_result = v_result,
         provider_outcomes = private.bounded_outcomes(provider_outcomes,
           jsonb_build_object('event', 'mobile_accept', 'result', v_result, 'digits', left(coalesce(p_digits,''), 4), 'at', now())),
         updated_at = now()
   WHERE id = a.id;
  RETURN jsonb_build_object('accept', v_result = 'accepted', 'result', v_result, 'caller_present', v_caller_present);
END;
$$;
REVOKE ALL ON FUNCTION public.record_inbound_mobile_accept(uuid, uuid, uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_inbound_mobile_accept(uuid, uuid, uuid, uuid, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.record_inbound_mobile_accept(uuid, uuid, uuid, uuid, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_inbound_mobile_accept(uuid, uuid, uuid, uuid, text, text, text, text) TO service_role;

-- ── 10. Bridge evidence (parent <Dial action> DialBridged) → attribution; NEVER is_missed/duration ───
CREATE OR REPLACE FUNCTION public.record_inbound_mobile_bridge(
  p_attempt_id uuid, p_org_id uuid, p_call_row_id uuid, p_agent_id uuid,
  p_dial_bridged boolean, p_dial_call_status text, p_dial_call_sid text, p_dial_call_duration integer,
  p_parent_call_sid text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE a public.inbound_route_attempts%ROWTYPE; v_evidence text; v_rows integer := 0;
        v_parent text := NULLIF(btrim(coalesce(p_parent_call_sid, '')), '');
        v_dial_sid text := NULLIF(btrim(coalesce(p_dial_call_sid, '')), '');
BEGIN
  SELECT * INTO a FROM public.inbound_route_attempts
   WHERE id = p_attempt_id AND organization_id = p_org_id AND call_id = p_call_row_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('bridged', false, 'evidence', 'unconfirmed', 'reason', 'attempt_not_found'); END IF;
  IF a.owner_agent_id IS DISTINCT FROM p_agent_id THEN
    RETURN jsonb_build_object('bridged', false, 'evidence', 'unconfirmed', 'reason', 'agent_mismatch');
  END IF;
  -- Identity binding (corrective pass, defect 5): the <Dial action> request's CallSid must be the stored
  -- parent, and its DialCallSid must be the child leg whose acceptance was recorded. Anything else is
  -- logged as provider telemetry and attributes NOTHING; the evidence stays unrecorded so the genuine
  -- delivery can still land.
  IF v_parent IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.id = p_call_row_id AND c.twilio_call_sid = v_parent) THEN
    RETURN jsonb_build_object('bridged', false, 'evidence', 'unconfirmed', 'reason', 'parent_sid_mismatch');
  END IF;
  -- An ABSENT DialCallSid is not a match either: once a child is bound, only that child attributes.
  IF a.mobile_child_call_sid IS NOT NULL AND (v_dial_sid IS NULL OR v_dial_sid <> a.mobile_child_call_sid) THEN
    UPDATE public.inbound_route_attempts
       SET provider_outcomes = private.bounded_outcomes(provider_outcomes,
             jsonb_build_object('event', 'dial_action_rejected', 'reason', 'child_sid_mismatch', 'dial_call_sid', v_dial_sid, 'at', now())),
           updated_at = now()
     WHERE id = a.id;
    RETURN jsonb_build_object('bridged', false, 'evidence', 'unconfirmed', 'reason', 'child_sid_mismatch');
  END IF;
  IF a.mobile_bridge_evidence IS NOT NULL THEN
    RETURN jsonb_build_object('bridged', a.mobile_bridge_evidence = 'dial_bridged', 'evidence', a.mobile_bridge_evidence, 'idempotent', true);
  END IF;
  IF a.mobile_accept_result IS DISTINCT FROM 'accepted' THEN
    v_evidence := 'not_bridged';                 -- no human acceptance ⇒ nothing to attribute
  ELSIF p_dial_bridged IS TRUE THEN
    v_evidence := 'dial_bridged';
  ELSIF p_dial_bridged IS FALSE THEN
    v_evidence := 'not_bridged';
  ELSE
    v_evidence := 'unconfirmed';                 -- field absent: never guess (safeguard 5)
  END IF;

  UPDATE public.inbound_route_attempts
     SET mobile_bridge_evidence = v_evidence,
         mobile_bridged_at = CASE WHEN v_evidence = 'dial_bridged' THEN now() END,
         provider_outcomes = private.bounded_outcomes(provider_outcomes,
           jsonb_build_object('event', 'dial_action', 'dial_call_status', p_dial_call_status, 'dial_bridged', p_dial_bridged,
                              'dial_call_sid', p_dial_call_sid, 'dial_call_duration', p_dial_call_duration, 'at', now())),
         updated_at = now()
   WHERE id = a.id;

  IF v_evidence = 'dial_bridged' THEN
    UPDATE public.calls SET
      outcome              = 'forwarded_answered',
      answered_by_agent_id = coalesce(answered_by_agent_id, p_agent_id),
      provider_session_id  = coalesce(provider_session_id, NULLIF(btrim(coalesce(p_dial_call_sid, '')), '')),
      status               = CASE WHEN status = 'ringing' THEN 'connected' ELSE status END,
      updated_at           = now()
    WHERE id = p_call_row_id AND organization_id = p_org_id AND direction = 'inbound'
      AND agent_id IS NULL
      AND (answered_by_agent_id IS NULL OR answered_by_agent_id = p_agent_id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('bridged', v_evidence = 'dial_bridged', 'evidence', v_evidence, 'attributed', v_rows > 0);
END;
$$;
REVOKE ALL ON FUNCTION public.record_inbound_mobile_bridge(uuid, uuid, uuid, uuid, boolean, text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_inbound_mobile_bridge(uuid, uuid, uuid, uuid, boolean, text, text, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.record_inbound_mobile_bridge(uuid, uuid, uuid, uuid, boolean, text, text, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_inbound_mobile_bridge(uuid, uuid, uuid, uuid, boolean, text, text, integer, text) TO service_role;

-- ── 11. Child leg end → reservation released ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_inbound_mobile_leg_end(
  p_attempt_id uuid, p_org_id uuid, p_child_call_sid text, p_call_status text, p_call_duration integer,
  p_parent_call_sid text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_rows integer := 0; v_child text := btrim(coalesce(p_child_call_sid, ''));
        v_parent text := NULLIF(btrim(coalesce(p_parent_call_sid, '')), '');
BEGIN
  -- Identity binding (defect 5): the child statusCallback's ParentCallSid must be this attempt's parent.
  IF v_parent IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.inbound_route_attempts a JOIN public.calls c ON c.id = a.call_id
        WHERE a.id = p_attempt_id AND a.organization_id = p_org_id AND c.twilio_call_sid = v_parent) THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'parent_sid_mismatch');
  END IF;
  UPDATE public.inbound_route_attempts
     SET mobile_child_call_sid = coalesce(mobile_child_call_sid, NULLIF(v_child, '')),
         mobile_leg_ended_at = coalesce(mobile_leg_ended_at, now()),
         provider_outcomes = private.bounded_outcomes(provider_outcomes,
           jsonb_build_object('event', 'mobile_leg_end', 'call_status', p_call_status, 'call_duration', p_call_duration,
                              'child_sid', v_child, 'at', now())),
         updated_at = now()
   WHERE id = p_attempt_id AND organization_id = p_org_id
     AND (mobile_child_call_sid IS NULL OR mobile_child_call_sid = v_child);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_rows > 0);
END;
$$;
REVOKE ALL ON FUNCTION public.record_inbound_mobile_leg_end(uuid, uuid, text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_inbound_mobile_leg_end(uuid, uuid, text, text, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.record_inbound_mobile_leg_end(uuid, uuid, text, text, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_inbound_mobile_leg_end(uuid, uuid, text, text, integer, text) TO service_role;

-- ── 12. finalize_inbound_call_terminal — REPLACED (D13): the external-answer branch no longer retracts ─
-- Everything else is verbatim from 20260823222805 (R17/C7/C12). The ONLY change is the removal of the
-- `is_missed = false` assignment in the p_external_answer branch: a mobile forward marks the call
-- "Missed in AgentFlow" at the forward commit and that classification is monotonic.
CREATE OR REPLACE FUNCTION public.finalize_inbound_call_terminal(
  p_call_row_id uuid,
  p_org_id uuid,
  p_status text,
  p_mark_missed boolean,
  p_external_answer boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('completed', 'no-answer', 'failed') THEN
    RAISE EXCEPTION 'finalize_inbound_call_terminal: invalid terminal status %', p_status;
  END IF;
  IF p_call_row_id IS NULL OR p_org_id IS NULL THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found_or_mismatch');
  END IF;

  IF coalesce(p_external_answer, false) THEN
    UPDATE public.calls SET
      outcome    = 'forwarded_answered',
      status     = CASE WHEN status IN ('completed', 'failed', 'no-answer') THEN status ELSE p_status END,
      ended_at   = COALESCE(ended_at, now()),
      -- D13: is_missed is NOT retracted here (was `is_missed = false` before M6).
      updated_at = now()
    WHERE id = p_call_row_id
      AND organization_id = p_org_id
      AND direction = 'inbound'
      AND agent_id IS NULL
      AND outcome IS DISTINCT FROM 'forwarded_answered';
    IF FOUND THEN
      RETURN jsonb_build_object('updated', true, 'external_answer_recorded', true);
    END IF;
    IF EXISTS (SELECT 1 FROM public.calls
                WHERE id = p_call_row_id AND organization_id = p_org_id AND direction = 'inbound'
                  AND outcome = 'forwarded_answered') THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'external_answer_already_recorded');
    END IF;
    IF EXISTS (SELECT 1 FROM public.calls
                WHERE id = p_call_row_id AND organization_id = p_org_id AND direction = 'inbound'
                  AND agent_id IS NOT NULL) THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'claimed_active');
    END IF;
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found_or_mismatch');
  END IF;

  UPDATE public.calls SET
    status = p_status,
    ended_at = COALESCE(ended_at, now()),
    is_missed = COALESCE(is_missed, false)
                OR (coalesce(p_mark_missed, false)
                    AND agent_id IS NULL
                    AND outcome IS DISTINCT FROM 'forwarded_answered'),
    updated_at = now()
  WHERE id = p_call_row_id
    AND organization_id = p_org_id
    AND direction = 'inbound'
    AND status NOT IN ('completed', 'failed', 'no-answer')
    AND (p_status = 'completed'
         OR (agent_id IS NULL AND outcome IS DISTINCT FROM 'forwarded_answered'));
  IF FOUND THEN
    -- Corrective pass 4: the terminal write and the closure of every open RINGING stage of this call are one
    -- transaction (the row lock above is held), so routing work that outlives a webhook deadline can never
    -- leave an actionable attempt behind. Only browser ring stages and an UNACCEPTED mobile dial are closed;
    -- an accepted mobile leg, the voicemail stages and every closing/telemetry callback are untouched.
    -- Dynamic + guarded: the M6 rollback drops the table but keeps this body (safeguard 4).
    IF to_regclass('public.inbound_route_attempts') IS NOT NULL THEN
      -- Corrective pass 5: (a) "unaccepted" means the acceptance RESULT is not 'accepted' — wrong_digit /
      -- no_digit / accepted_after_hangup also stamp mobile_accepted_at and must converge; a GENUINE
      -- acceptance is never closed by the parent's finalize (its Dial action or the sweep closes it);
      -- (b) the intended recipients are preserved on the call (D13 snapshot, only when still empty) BEFORE
      -- this clears their last copy, so the missed-call notification names the right agents even when this
      -- finalize wins the race against the abandon routine or the Dial-action return.
      EXECUTE $q$WITH open_attempt AS (
                   SELECT a.id, a.reserved_agent_ids, a.owner_agent_id, a.voicemail_group_ids
                     FROM public.inbound_route_attempts a
                    WHERE a.call_id = $1 AND a.organization_id = $2 AND NOT a.terminal
                      AND (a.stage IN ('owner_browser','group_browser')
                           OR (a.stage = 'owner_mobile' AND coalesce(a.mobile_accept_result, '') <> 'accepted'))
                 ), snap AS (
                   UPDATE public.calls c
                      SET missed_recipient_ids = CASE WHEN cardinality(c.missed_recipient_ids) = 0
                            THEN coalesce(NULLIF(o.reserved_agent_ids, '{}'::uuid[]),
                                          CASE WHEN o.owner_agent_id IS NOT NULL THEN ARRAY[o.owner_agent_id] END,
                                          NULLIF(o.voicemail_group_ids, '{}'::uuid[]),
                                          c.missed_recipient_ids)
                            ELSE c.missed_recipient_ids END,
                          missed_for_agent_id = coalesce(c.missed_for_agent_id, o.owner_agent_id)
                     FROM open_attempt o WHERE c.id = $1
                 )
                 UPDATE public.inbound_route_attempts x
                    SET terminal = true, final_outcome = coalesce(x.final_outcome, $3),
                        reserved_agent_ids = '{}'::uuid[], updated_at = now()
                   FROM open_attempt o WHERE x.id = o.id$q$
        USING p_call_row_id, p_org_id, 'parent_' || p_status;
    END IF;
    RETURN jsonb_build_object('updated', true);
  END IF;

  IF (p_status <> 'completed' OR coalesce(p_mark_missed, false))
     AND EXISTS (SELECT 1 FROM public.calls
                  WHERE id = p_call_row_id AND organization_id = p_org_id AND direction = 'inbound'
                    AND outcome = 'forwarded_answered') THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'externally_answered');
  END IF;
  IF (p_status <> 'completed' OR coalesce(p_mark_missed, false))
     AND EXISTS (SELECT 1 FROM public.calls
                  WHERE id = p_call_row_id AND organization_id = p_org_id AND direction = 'inbound'
                    AND agent_id IS NOT NULL) THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'claimed_active');
  END IF;
  IF EXISTS (SELECT 1 FROM public.calls
              WHERE id = p_call_row_id AND organization_id = p_org_id AND direction = 'inbound'
                AND status IN ('completed', 'failed', 'no-answer')) THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'already_terminal');
  END IF;
  IF EXISTS (SELECT 1 FROM public.calls
              WHERE id = p_call_row_id AND organization_id = p_org_id AND direction = 'inbound'
                AND agent_id IS NOT NULL) THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'claimed_active');
  END IF;
  RETURN jsonb_build_object('updated', false, 'reason', 'not_found_or_mismatch');
END;
$$;

COMMENT ON FUNCTION public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean) IS
  'Dial-action terminal safety net (plan rev5 §6.2, R17; rev6 C7; rev7 C12; Inbound v2 M6 INB-D13): org-scoped, '
  'inbound-only, monotonic — never regresses/overwrites a terminal status, never writes duration (invariant #8), '
  'ended_at only when NULL. Answer proofs outrank stale actions. p_external_answer records the external proof '
  'idempotently and, since M6, NEVER retracts is_missed: a call forwarded to mobile stays "Missed in AgentFlow". '
  'Discriminated result unchanged. Service-role only.';

REVOKE ALL ON FUNCTION public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean) TO service_role;

-- ── 13. abandon_inbound_routing — the webhook's ONE atomic failure decision (corrective pass 4) ──────────
-- When the handler cannot complete routing inside Twilio's webhook ceiling (a read or RPC outlived the
-- request deadline), it answers the caller with the sorry greeting and records THIS decision durably in a
-- single transaction, lock order = calls row first: the call is finalized 'no-answer' (finalize closes the
-- open ringing stages), the D13 classification is recorded (monotonic: coalesce semantics of
-- mark_inbound_missed), and the notification is left to the durable sweep (converge_inbound_notifications
-- via sweep_inbound_notifications) — no notification work ever blocks or follows the decision in-request.
-- A claimed or externally answered call is never marked (D13 monotonic), and a late planner/advance that
-- was waiting for a lock finds the call terminal.
CREATE OR REPLACE FUNCTION public.abandon_inbound_routing(
  p_call_row_id uuid, p_org_id uuid, p_reason text, p_recipient_ids uuid[] DEFAULT '{}'::uuid[], p_for_agent_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE c public.calls%ROWTYPE; a public.inbound_route_attempts%ROWTYPE; r jsonb; v_closed integer := 0;
        v_recipients uuid[]; v_accepted boolean := false; v_group uuid[];
BEGIN
  IF p_call_row_id IS NULL OR p_org_id IS NULL THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'invalid_args');
  END IF;
  SELECT * INTO c FROM public.calls WHERE id = p_call_row_id AND organization_id = p_org_id AND direction = 'inbound' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('updated', false, 'reason', 'not_found'); END IF;
  IF c.agent_id IS NOT NULL OR c.outcome = 'forwarded_answered' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'answered');
  END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = p_call_row_id AND organization_id = p_org_id;
  -- A GENUINE live mobile acceptance (result 'accepted', child leg not ended, inside the approved A5b
  -- ceiling) is an ongoing conversation whose parent may still read 'ringing' with no claim and no bridge
  -- attribution yet (the Dial action arrives later): it is never abandoned. Nothing is fabricated to say so.
  IF FOUND AND NOT a.terminal AND a.stage = 'owner_mobile' AND a.mobile_accept_result = 'accepted'
     AND a.mobile_leg_ended_at IS NULL AND a.mobile_accepted_at > now() - interval '4 hours' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'mobile_accepted_live', 'attempt_id', a.id);
  END IF;
  v_accepted := FOUND AND a.mobile_accept_result = 'accepted';
  -- Intended recipients, resolved BEFORE any finalizer clears the reservation (deliberate fallbacks, an
  -- empty array never wins): the caller's list → what the attempt reserved → its owner → its voicemail
  -- group → the legacy routed set → the organization's configured inbound group for a v2-owned call →
  -- whatever snapshot the call already carries (mark_inbound_missed keeps an existing non-empty snapshot).
  SELECT NULLIF(irs.inbound_group_agent_ids, '{}'::uuid[]) INTO v_group
    FROM public.inbound_routing_settings irs WHERE irs.organization_id = p_org_id;
  v_recipients := coalesce(
    NULLIF(coalesce(p_recipient_ids, '{}'::uuid[]), '{}'::uuid[]),
    NULLIF(coalesce(a.reserved_agent_ids, '{}'::uuid[]), '{}'::uuid[]),
    CASE WHEN a.owner_agent_id IS NOT NULL THEN ARRAY[a.owner_agent_id] END,
    NULLIF(coalesce(a.voicemail_group_ids, '{}'::uuid[]), '{}'::uuid[]),
    NULLIF(coalesce(c.routed_agent_ids, '{}'::uuid[]), '{}'::uuid[]),
    CASE WHEN a.id IS NOT NULL OR private.inbound_engine_at(p_org_id, c.created_at) = 'v2' THEN v_group END,
    NULLIF(coalesce(c.missed_recipient_ids, '{}'::uuid[]), '{}'::uuid[]),
    '{}'::uuid[]);
  IF v_accepted THEN
    -- The mobile conversation happened (accepted, and it is no longer live): the parent completes; the D13
    -- classification ("Missed in AgentFlow — forwarded to mobile", written at the forward commit) stands.
    r := public.finalize_inbound_call_terminal(p_call_row_id, p_org_id, 'completed', false);
  ELSE
    r := public.finalize_inbound_call_terminal(p_call_row_id, p_org_id, 'no-answer', true);
    -- D13 classification value stays within the approved vocabulary (calls_missed_reason_check): an abandoned
    -- ring IS a no-answer for the recipients; the abandonment detail lives on the attempt (final_outcome).
    PERFORM public.mark_inbound_missed(p_call_row_id, p_org_id, 'no_answer', v_recipients, coalesce(p_for_agent_id, a.owner_agent_id));
  END IF;
  UPDATE public.inbound_route_attempts
     SET terminal = true, final_outcome = coalesce(final_outcome, 'abandoned:' || coalesce(p_reason, 'deadline')),
         reserved_agent_ids = '{}'::uuid[],
         provider_outcomes = private.bounded_outcomes(provider_outcomes, jsonb_build_object('event', 'abandoned', 'reason', p_reason, 'at', now())),
         updated_at = now()
   WHERE call_id = p_call_row_id AND organization_id = p_org_id AND NOT terminal
     AND stage IN ('owner_browser','group_browser','owner_mobile');
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN jsonb_build_object('updated', true, 'finalize', r, 'attempts_closed', v_closed, 'recipients', to_jsonb(v_recipients),
                            'accepted', v_accepted);
END;
$$;
REVOKE ALL ON FUNCTION public.abandon_inbound_routing(uuid, uuid, text, uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.abandon_inbound_routing(uuid, uuid, text, uuid[], uuid) FROM anon;
REVOKE ALL ON FUNCTION public.abandon_inbound_routing(uuid, uuid, text, uuid[], uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_inbound_routing(uuid, uuid, text, uuid[], uuid) TO service_role;

-- ── 14. sweep_inbound_route_attempts — DURABLE recovery for work no callback will finish ─────────────────
-- (a) an open ringing stage whose parent is already terminal (a planner that committed after a
--     status-callback finalize on an older definition, or an abandon that never reached the database) is
--     closed after a grace period that lets legitimate late callbacks land first;
-- (b) an inbound call still non-terminal long after it started, with no claim, is abandoned (finalized
--     'no-answer' + D13 + closure) — the case where neither the failure path nor Twilio's status callback
--     ever ran. Scheduled by M7 next to the notification sweep (pg_cron); idempotent and bounded.
CREATE OR REPLACE FUNCTION public.sweep_inbound_route_attempts(
  p_grace interval DEFAULT interval '2 minutes',
  p_stale_ringing interval DEFAULT interval '30 minutes',
  p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_closed integer := 0; v_abandoned integer := 0; v_completed integer := 0; v_skipped_live integer := 0; v_call record; r jsonb;
BEGIN
  -- (a) attempts left open on a TERMINAL parent, after the grace period that lets late callbacks land first:
  --     ring stages; a mobile stage whose acceptance RESULT is not 'accepted' (wrong/no digit, after hangup);
  --     a genuinely accepted mobile stage whose child leg has ended or that passed the approved 4-hour
  --     ceiling. The reserved members are preserved on the call (D13 snapshot, only when still empty)
  --     before the reservation is cleared. Voicemail stages converge through their own callbacks.
  WITH due AS (
    SELECT a.id, a.reserved_agent_ids, a.owner_agent_id, a.voicemail_group_ids, a.call_id, a.organization_id
      FROM public.inbound_route_attempts a
      JOIN public.calls pc ON pc.id = a.call_id
     WHERE NOT a.terminal
       AND (a.stage IN ('owner_browser','group_browser')
            OR (a.stage = 'owner_mobile'
                AND (coalesce(a.mobile_accept_result, '') <> 'accepted'
                     OR a.mobile_leg_ended_at IS NOT NULL
                     OR a.mobile_accepted_at < now() - interval '4 hours')))
       AND (pc.ended_at IS NOT NULL OR pc.status IN ('completed','failed','no-answer'))
       AND a.updated_at < now() - p_grace
     ORDER BY a.updated_at ASC LIMIT least(greatest(coalesce(p_limit, 100), 1), 500)
  ), snap AS (
    UPDATE public.calls c
       SET missed_recipient_ids = CASE WHEN cardinality(c.missed_recipient_ids) = 0
             THEN coalesce(NULLIF(d.reserved_agent_ids, '{}'::uuid[]),
                           CASE WHEN d.owner_agent_id IS NOT NULL THEN ARRAY[d.owner_agent_id] END,
                           NULLIF(d.voicemail_group_ids, '{}'::uuid[]),
                           c.missed_recipient_ids)
             ELSE c.missed_recipient_ids END,
           missed_for_agent_id = coalesce(c.missed_for_agent_id, d.owner_agent_id)
      FROM due d WHERE c.id = d.call_id
  )
  UPDATE public.inbound_route_attempts x
     SET terminal = true, final_outcome = coalesce(x.final_outcome, 'swept:parent_terminal'),
         reserved_agent_ids = '{}'::uuid[], updated_at = now()
    FROM due WHERE x.id = due.id;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  -- (b) inbound calls still non-terminal long after they started, with no claim and no answer proof —
  --     ONLY calls the v2 engine owned (a route attempt exists, or the organization's engine was 'v2'
  --     when the call was created — durable history, so a rollback to legacy keeps v2 work recoverable
  --     and a failure before planning is covered; calls created under legacy are never touched). A
  --     GENUINE live mobile acceptance is skipped: its parent legitimately reads 'ringing' until the
  --     Dial action returns. abandon_inbound_routing completes an accepted conversation that is no
  --     longer live and abandons everything else (finalize 'no-answer' + D13 + closure).
  FOR v_call IN
    SELECT c.id, c.organization_id FROM public.calls c
     WHERE c.direction = 'inbound' AND c.ended_at IS NULL
       AND c.status NOT IN ('completed','failed','no-answer','connected')
       AND c.agent_id IS NULL AND c.outcome IS DISTINCT FROM 'forwarded_answered'
       AND c.created_at < now() - p_stale_ringing
       AND (EXISTS (SELECT 1 FROM public.inbound_route_attempts a WHERE a.call_id = c.id)
            OR private.inbound_engine_at(c.organization_id, c.created_at) = 'v2')
       AND NOT EXISTS (SELECT 1 FROM public.inbound_route_attempts a
                        WHERE a.call_id = c.id AND NOT a.terminal AND a.stage = 'owner_mobile'
                          AND a.mobile_accept_result = 'accepted' AND a.mobile_leg_ended_at IS NULL
                          AND a.mobile_accepted_at > now() - interval '4 hours')
     ORDER BY c.created_at ASC LIMIT least(greatest(coalesce(p_limit, 100), 1), 500)
  LOOP
    r := public.abandon_inbound_routing(v_call.id, v_call.organization_id, 'stale_ringing');
    IF (r->>'updated')::boolean IS TRUE AND (r->>'accepted')::boolean IS TRUE THEN v_completed := v_completed + 1;
    ELSIF (r->>'updated')::boolean IS TRUE THEN v_abandoned := v_abandoned + 1;
    ELSIF r->>'reason' = 'mobile_accepted_live' THEN v_skipped_live := v_skipped_live + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('attempts_closed', v_closed, 'calls_abandoned', v_abandoned,
                            'calls_completed', v_completed, 'skipped_live_mobile', v_skipped_live);
END;
$$;
REVOKE ALL ON FUNCTION public.sweep_inbound_route_attempts(interval, interval, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sweep_inbound_route_attempts(interval, interval, integer) FROM anon;
REVOKE ALL ON FUNCTION public.sweep_inbound_route_attempts(interval, interval, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_inbound_route_attempts(interval, interval, integer) TO service_role;
