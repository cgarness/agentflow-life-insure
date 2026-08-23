-- =====================================================================================================
-- Inbound Call Flow Rebuild — M2: claim, identity read, terminal finalization (plan rev 5 @ 19d2abd)
-- =====================================================================================================
-- FUTURE-FACING ONLY: function DDL + ACLs. NO UPDATE/DELETE/INSERT of user data — no backfill, no
-- cleanup, no mutation of any historical row.
--
-- Objects:
--   claim_inbound_call(uuid,uuid,text,text)     — C1 first-write CAS + read-only classification;
--                                                 R2 first-writer SID; R3 fail-closed routing;
--                                                 R16 strict SIDs; R19 terminal late-enrichment.
--                                                 Service-role ONLY (R1/R13 — invoked by the
--                                                 Twilio-signed inbound-call-claim webhook).
--   get_inbound_call_identity(uuid)             — R4-tightened authenticated identity read.
--   finalize_inbound_call_terminal(uuid,uuid,text,boolean,boolean)
--                                               — R17 discriminated, idempotent, duration-free.
--   peek_inbound_call_identity(text,text)       — REPLACED: exact-only (newest-ringing fallback DELETED).
--   resolve_inbound_caller_display_name(text)   — REPLACED: deprecated unique-only compat wrapper (R5);
--                                                 NOT dropped this release (stale bundles still call it).
-- ACLs follow the explicit R23 matrix (incl. removing the compat wrapper''s legacy anon grant).

-- ── Twilio-authoritative claim: ONE first-write CAS + read-only duplicate classification (C1) ────────
CREATE OR REPLACE FUNCTION public.claim_inbound_call(
  p_user_id uuid,
  p_call_row_id uuid,
  p_child_call_sid text,
  p_parent_call_sid text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_child text := btrim(coalesce(p_child_call_sid, ''));
  v_parent text := btrim(coalesce(p_parent_call_sid, ''));
  v_org uuid;
  v_profile_status text;
  v_identity text;
  r public.calls%ROWTYPE;
  v_row public.calls%ROWTYPE;
BEGIN
  -- R16: strict SID validation before the CAS; blank/malformed rejected.
  IF p_user_id IS NULL OR p_call_row_id IS NULL
     OR v_child !~ '^CA[0-9a-fA-F]{32}$' OR v_parent !~ '^CA[0-9a-fA-F]{32}$' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_sid');
  END IF;

  -- R1: database-authoritative profile checks against the wrapper-verified p_user_id.
  SELECT p.organization_id, p.status, p.twilio_client_identity
    INTO v_org, v_profile_status, v_identity
    FROM public.profiles p
   WHERE p.id = p_user_id;
  IF NOT FOUND OR v_org IS NULL OR v_profile_status IS DISTINCT FROM 'Active'
     OR v_identity IS NULL OR btrim(v_identity) = '' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'inactive_profile');
  END IF;

  -- C1 FIRST-WRITE CAS — the only write this path ever issues. agent_id IS NULL makes it fire at most
  -- once per row: updated_at bumps exactly once, update triggers fire exactly once. NO live-state
  -- predicate (R19): a delayed authentic callback ENRICHES an already-terminal row; the status CASE
  -- leaves terminal states untouched, and ended_at/duration/terminal metadata are never written.
  UPDATE public.calls SET
    agent_id            = p_user_id,
    provider_session_id = COALESCE(provider_session_id, v_child),   -- first-writer-wins (R2)
    status              = CASE WHEN status = 'ringing' THEN 'connected' ELSE status END,
    updated_at          = now()
  WHERE id = p_call_row_id
    AND organization_id = v_org                    -- exact org match; organization_id is NEVER updated
    AND twilio_call_sid = v_parent                 -- row↔ParentCallSid cross-check (R13/R16)
    AND direction = 'inbound'
    AND agent_id IS NULL                           -- FIRST WRITE ONLY (C1)
    AND (provider_session_id IS NULL
         OR provider_session_id = v_child)         -- same child leg only (R2)
    AND routed_agent_ids IS NOT NULL
    AND p_user_id = ANY (routed_agent_ids)         -- durably persisted routing REQUIRED (R3/R14)
  RETURNING * INTO r;

  IF FOUND THEN
    IF r.provider_session_id IS NULL THEN
      -- structurally unreachable (v_child validated non-blank); assert the R16 invariant anyway
      RAISE EXCEPTION 'claim_inbound_call: provider_session_id NULL after successful claim';
    END IF;
    RETURN jsonb_build_object(
      'claimed', true, 'idempotent', false,
      'enriched_terminal', r.status IN ('completed','failed','no-answer'),
      'call_row_id', r.id, 'agent_id', r.agent_id, 'provider_session_id', r.provider_session_id,
      'status', r.status, 'contact_id', r.contact_id, 'contact_type', r.contact_type,
      'contact_name', r.contact_name, 'contact_phone', r.contact_phone,
      'caller_id_used', r.caller_id_used);
  END IF;

  -- C1 READ-ONLY classification (no UPDATE, no updated_at bump, no trigger, no column change),
  -- in the exact plan §4.2 order.
  SELECT * INTO v_row FROM public.calls WHERE id = p_call_row_id;
  IF NOT FOUND OR v_row.organization_id IS DISTINCT FROM v_org OR v_row.direction <> 'inbound' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'cross_org_or_not_found');
  END IF;
  IF v_row.twilio_call_sid IS DISTINCT FROM v_parent THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'parent_sid_mismatch');
  END IF;
  IF v_row.routed_agent_ids IS NULL OR cardinality(v_row.routed_agent_ids) = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'no_routed_agents');
  END IF;
  IF NOT (p_user_id = ANY (v_row.routed_agent_ids)) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_routed');
  END IF;
  IF v_row.agent_id = p_user_id AND v_row.provider_session_id = v_child THEN
    -- exact duplicate: same row, parent SID, org, direction, agent, child SID, routed membership —
    -- idempotent success FROM THE READ ALONE; the row (updated_at included) stays byte-identical.
    RETURN jsonb_build_object(
      'claimed', true, 'idempotent', true,
      'enriched_terminal', v_row.status IN ('completed','failed','no-answer'),
      'call_row_id', v_row.id, 'agent_id', v_row.agent_id,
      'provider_session_id', v_row.provider_session_id, 'status', v_row.status,
      'contact_id', v_row.contact_id, 'contact_type', v_row.contact_type,
      'contact_name', v_row.contact_name, 'contact_phone', v_row.contact_phone,
      'caller_id_used', v_row.caller_id_used);
  END IF;
  IF v_row.agent_id = p_user_id THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'sid_conflict');
  END IF;
  IF v_row.agent_id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_claimed');
  END IF;
  -- agent_id NULL but the CAS did not fire: the only remaining cause is a foreign provider_session_id.
  RETURN jsonb_build_object('claimed', false, 'reason', 'sid_conflict');
END;
$$;

COMMENT ON FUNCTION public.claim_inbound_call(uuid, uuid, text, text) IS
  'Twilio-authoritative inbound answer claim (plan rev5 §4.2, R13/C1): first-write CAS (ownership + '
  'child SID + ringing→connected or R19 terminal enrichment in ONE statement, at most once per row) '
  'plus a read-only duplicate classification returning {claimed:true,idempotent:true} with zero row '
  'mutation. Fail-closed on routing (R3), strict CA-SIDs (R16), first-writer child SID (R2). '
  'EXECUTE service_role ONLY — invoked exclusively by the Twilio-signature-validated '
  'inbound-call-claim webhook with the server-issued agent id (never auth.uid(), never the browser).';

REVOKE ALL ON FUNCTION public.claim_inbound_call(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_inbound_call(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.claim_inbound_call(uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_inbound_call(uuid, uuid, text, text) TO service_role;

-- ── R4-tightened authenticated identity read (browser-facing; intentionally authenticated, reviewed) ─
CREATE OR REPLACE FUNCTION public.get_inbound_call_identity(p_call_row_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_org uuid;
  v_profile_status text;
  c public.calls%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_call_row_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT p.organization_id, p.status INTO v_org, v_profile_status
    FROM public.profiles p WHERE p.id = v_uid;
  IF NOT FOUND OR v_org IS NULL OR v_profile_status IS DISTINCT FROM 'Active' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO c FROM public.calls
   WHERE id = p_call_row_id AND organization_id = v_org AND direction = 'inbound';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- R4 authorization: already the assigned agent, OR a routed agent on a LIVE, RECENT ring.
  -- Fail-closed on empty routed_agent_ids (R3-consistent). Mere possession of a row UUID by an
  -- org member retrieves nothing. IS NOT TRUE: agent_id = v_uid is NULL (not false) on unassigned
  -- rows — a plain NOT(...) would fall through on three-valued logic.
  IF (
       c.agent_id = v_uid
       OR (c.agent_id IS NULL
           AND c.status = 'ringing'
           AND c.created_at > now() - interval '15 minutes'
           AND c.routed_agent_ids IS NOT NULL
           AND v_uid = ANY (c.routed_agent_ids))
     ) IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'calls_row_id', c.id, 'contact_phone', c.contact_phone, 'caller_id_used', c.caller_id_used,
    'contact_name', c.contact_name, 'contact_id', c.contact_id, 'contact_type', c.contact_type,
    'status', c.status, 'agent_id', c.agent_id);
END;
$$;

COMMENT ON FUNCTION public.get_inbound_call_identity(uuid) IS
  'Exact-row inbound identity read for the ringing/owning browser (plan rev5 §3.3, R4). '
  'INTENTIONALLY authenticated SECURITY DEFINER — reviewed (R23): the in-body authorization is '
  'auth.uid() + Active profile + same-org + exact inbound row + (owner OR routed-on-live-recent-ring). '
  'No fallback of any kind; NULL otherwise.';

REVOKE ALL ON FUNCTION public.get_inbound_call_identity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_inbound_call_identity(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inbound_call_identity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inbound_call_identity(uuid) TO service_role;

-- ── R17 terminal finalization: discriminated, idempotent, never writes duration ──────────────────────
CREATE OR REPLACE FUNCTION public.finalize_inbound_call_terminal(
  p_call_row_id uuid,
  p_org_id uuid,
  p_status text,
  p_mark_missed boolean,
  p_external_answer boolean DEFAULT false   -- C12 (rev 7): external <Number> forward answered
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

  -- C12 (rev 7) PROOF PATH: an external <Number> forwarding leg answered. agent_id proves a
  -- <Client> leg answered, but an external forward completes with agent_id still NULL, so the
  -- answer is recorded durably on `outcome` and wins monotonically over any later missed action.
  -- A CLAIMED row is never touched here (the client claim is the stronger, earlier proof), and an
  -- already-terminal status is left frozen — only the proof (and the is_missed retraction it
  -- implies for an unclaimed call) is written.
  IF coalesce(p_external_answer, false) THEN
    UPDATE public.calls SET
      outcome    = 'forwarded_answered',
      status     = CASE WHEN status IN ('completed', 'failed', 'no-answer') THEN status ELSE p_status END,
      ended_at   = COALESCE(ended_at, now()),
      is_missed  = false,          -- the call WAS answered (externally); it is not a missed call
      updated_at = now()
    WHERE id = p_call_row_id
      AND organization_id = p_org_id
      AND direction = 'inbound'
      AND agent_id IS NULL                                    -- a client claim outranks the forward
      AND outcome IS DISTINCT FROM 'forwarded_answered';      -- idempotent: only the first proof writes
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

  -- C7 (rev 6) + C12 (rev 7): a non-completed terminal (no-answer/failed) may land ONLY on a row
  -- with NO answer proof, and mark-missed never applies to one — a stale earlier-wave fallback
  -- action arriving after an agent answered (agent_id) or after an external forward answered
  -- (outcome) must not mark or regress that call. The answered path's 'completed' finalize is
  -- unaffected.
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
    AND status NOT IN ('completed', 'failed', 'no-answer')    -- never regress/overwrite a terminal state
    AND (p_status = 'completed'
         OR (agent_id IS NULL AND outcome IS DISTINCT FROM 'forwarded_answered'));
  IF FOUND THEN
    RETURN jsonb_build_object('updated', true);
  END IF;

  -- Discriminated result (R17/C7/C12): externally-answered, already-terminal and claimed-active are
  -- expected idempotent skips; anything else is an observable error the caller retries and logs —
  -- never a silent acknowledgement. The answer proofs are reported FIRST so a refused stale action
  -- names the reason it was refused.
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
  'Dial-action terminal safety net (plan rev5 §6.2, R17; rev6 C7; rev7 C12): org-scoped, '
  'inbound-only, monotonic — never regresses/overwrites a terminal status, never writes duration '
  '(invariant #8), ended_at only when NULL. Answer proofs outrank stale actions: a non-completed '
  'finalize and mark-missed are refused when agent_id is set (Client leg claimed) or outcome is '
  '''forwarded_answered'' (external <Number> forward answered). p_external_answer records that '
  'external proof idempotently and retracts is_missed on an unclaimed call. Discriminated result: '
  'updated:true | external_answer_already_recorded | externally_answered | claimed_active | '
  'already_terminal (idempotent skips) | not_found_or_mismatch (observable error). Service-role only.';

REVOKE ALL ON FUNCTION public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean) TO service_role;

-- ── peek_inbound_call_identity: exact-only replacement — the newest-ringing fallback is DELETED ──────
CREATE OR REPLACE FUNCTION public.peek_inbound_call_identity(
  p_provider_session_id text DEFAULT NULL,
  p_twilio_call_sid text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org uuid;
  sid text := nullif(btrim(coalesce(p_provider_session_id, '')), '');
  cc text := nullif(btrim(coalesce(p_twilio_call_sid, '')), '');
  cc_norm text;
  r record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  IF sid IS NULL AND cc IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT p.organization_id INTO v_org FROM public.profiles p WHERE p.id = auth.uid();
  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;

  cc_norm := regexp_replace(cc, '^v[0-9]+:', '');

  -- EXACT match only (plan rev5 §4.3). The 6-minute newest-ringing org-wide fallback is REMOVED:
  -- under simultaneous inbound calls it could show another caller''s identity. Never guess by recency.
  SELECT c.id, c.caller_id_used, c.contact_phone, c.contact_name, c.contact_id, c.contact_type
    INTO r
    FROM public.calls c
   WHERE c.organization_id = v_org
     AND c.direction IN ('inbound', 'incoming')
     AND (
       (sid IS NOT NULL AND c.provider_session_id = sid)
       OR (cc IS NOT NULL AND c.twilio_call_sid IS NOT NULL
           AND (c.twilio_call_sid = cc
                OR regexp_replace(c.twilio_call_sid, '^v[0-9]+:', '') = cc_norm))
     )
   ORDER BY c.created_at DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'calls_row_id', r.id, 'caller_id_used', r.caller_id_used, 'contact_phone', r.contact_phone,
    'contact_name', r.contact_name, 'contact_id', r.contact_id, 'contact_type', r.contact_type);
END;
$$;

COMMENT ON FUNCTION public.peek_inbound_call_identity(text, text) IS
  'EXACT-ONLY inbound identity peek (plan rev5 §4.3): matches provider_session_id or twilio_call_sid '
  '(vN: prefix-tolerant) within the caller''s org. The legacy latest-ringing-in-6-minutes fallback is '
  'deleted — it could cross-match concurrent inbound calls. Kept for stale-bundle compatibility; new '
  'code uses get_inbound_call_identity(p_call_row_id).';

REVOKE ALL ON FUNCTION public.peek_inbound_call_identity(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.peek_inbound_call_identity(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.peek_inbound_call_identity(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.peek_inbound_call_identity(text, text) TO service_role;

-- ── resolve_inbound_caller_display_name: deprecated unique-only compat wrapper (R5 — NOT dropped) ────
CREATE OR REPLACE FUNCTION public.resolve_inbound_caller_display_name(p_caller_phone text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org uuid;
  r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  v_org := public.get_org_id();
  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;
  -- Delegates to THE canonical resolver; a name is returned ONLY on a unique canonical match —
  -- the legacy ORDER BY updated_at LIMIT 1 newest-pick is gone. NULL on ambiguous/not_found.
  r := public.resolve_inbound_contact(v_org, p_caller_phone);
  IF r->>'resolution' = 'unique' THEN
    RETURN r->>'contact_name';
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.resolve_inbound_caller_display_name(text) IS
  'DEPRECATED compatibility wrapper (plan rev5 R5): retained one release for stale browser bundles; '
  'returns a display name only on a UNIQUE canonical match via resolve_inbound_contact (never a '
  'newest-record guess). New code consumes the call-row identity. Scheduled for DROP in a later '
  'cleanup release after bundle rollover.';

-- R23: the live production ACL includes anon — that legacy grant is removed here.
REVOKE ALL ON FUNCTION public.resolve_inbound_caller_display_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_inbound_caller_display_name(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_inbound_caller_display_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_inbound_caller_display_name(text) TO service_role;
