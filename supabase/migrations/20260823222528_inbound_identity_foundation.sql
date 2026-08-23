-- =====================================================================================================
-- Inbound Call Flow Rebuild — M1: canonical identity foundation (plan rev 5 @ 19d2abd, R1–R23 + C1–C3)
-- =====================================================================================================
-- FUTURE-FACING ONLY: this migration creates functions and indexes. It contains NO UPDATE/DELETE/INSERT
-- of user data — no backfill, no cleanup, no mutation of any historical row. Indexing existing rows
-- reads them and alters nothing (R6).
--
-- Objects:
--   phone_last10(text)                       — IMMUTABLE normalization helper (expression indexes)
--   idx_{leads,clients,recruits}_org_phone_last10, idx_calls_org_outbound_contact_phone_last10
--   uq_calls_inbound_twilio_call_sid         — unbounded partial unique ingest arbiter (R6)
--   resolve_inbound_contact(uuid, text)      — THE canonical resolver (unique|ambiguous|not_found; R8)
--   ingest_inbound_call(text,uuid,text,text,boolean)
--                                            — idempotent zero-mutation-retry ingest (R6/R9/R16/R21/R22)
--   find_last_agent_for_inbound(uuid,uuid,text)
--                                            — two-stage last-agent lookup (R10/R18)
-- ACLs follow the explicit R23/C2 matrix; EXECUTE-matrix is proven by supabase/tests/inbound_claim.sql K9.

-- ── phone_last10: the ONE stored-phone normalization rule ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.phone_last10(p text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT CASE WHEN pg_catalog.length(d.digits) >= 10 THEN pg_catalog.right(d.digits, 10) END
    FROM (SELECT pg_catalog.regexp_replace(p, '[^0-9]', '', 'g') AS digits) AS d
$$;

COMMENT ON FUNCTION public.phone_last10(text) IS
  'Canonical inbound-identity phone normalization: trailing 10 digits of the digit-stripped value, '
  'NULL when fewer than 10 digits. IMMUTABLE — used by the org+phone expression indexes. '
  'NEVER a DID/organization identity comparison (R22 requires exact E.164 for DIDs).';

-- C2 ACL: every role that legitimately writes the indexed tables must EXECUTE it during expression-index
-- maintenance (PostgreSQL evaluates index expressions with the DML executor''s privileges). anon never
-- passes those tables'' TO-authenticated write policies, so it holds no grant.
REVOKE ALL ON FUNCTION public.phone_last10(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phone_last10(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.phone_last10(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phone_last10(text) TO service_role;

-- ── Expression indexes (read existing rows; mutate nothing) ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_org_phone_last10
  ON public.leads (organization_id, public.phone_last10(phone));
CREATE INDEX IF NOT EXISTS idx_clients_org_phone_last10
  ON public.clients (organization_id, public.phone_last10(phone));
CREATE INDEX IF NOT EXISTS idx_recruits_org_phone_last10
  ON public.recruits (organization_id, public.phone_last10(phone));
-- R10/R18 tier-2 support: normalized customer-phone lookup over outbound history
CREATE INDEX IF NOT EXISTS idx_calls_org_outbound_contact_phone_last10
  ON public.calls (organization_id, public.phone_last10(contact_phone))
  WHERE direction = 'outbound';

-- ── R6 ingest arbiter: unbounded partial unique — no timestamp predicate ─────────────────────────────
-- Preflight (runbook, read-only): production holds ZERO duplicate inbound twilio_call_sid values
-- (verified 2026-08-22), so this builds cleanly. Even a late retry of an old SID can never create a
-- second inbound row once this exists.
CREATE UNIQUE INDEX IF NOT EXISTS uq_calls_inbound_twilio_call_sid
  ON public.calls (twilio_call_sid)
  WHERE direction = 'inbound' AND twilio_call_sid IS NOT NULL;

COMMENT ON INDEX public.uq_calls_inbound_twilio_call_sid IS
  'Ingest idempotency arbiter (plan rev5 R6): one inbound calls row per Twilio parent CallSid, ever. '
  'ON CONFLICT target of public.ingest_inbound_call.';

-- ── THE canonical inbound contact resolver (change set A; R8: leads/clients/recruits ONLY) ───────────
CREATE OR REPLACE FUNCTION public.resolve_inbound_contact(p_org_id uuid, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_l10 text;
  v_count integer := 0;
  v_id uuid;
  v_type text;
  v_name text;
BEGIN
  IF p_org_id IS NULL THEN
    RETURN jsonb_build_object('resolution','not_found','contact_id',NULL,'contact_type',NULL,
                              'contact_name',NULL,'match_count',0);
  END IF;

  v_l10 := public.phone_last10(p_phone);
  IF v_l10 IS NULL THEN
    -- anonymous/unknown/short/non-dialable ANI: never an error, never a guess (R21 resolution level)
    RETURN jsonb_build_object('resolution','not_found','contact_id',NULL,'contact_type',NULL,
                              'contact_name',NULL,'match_count',0);
  END IF;

  -- Candidate set = DISTINCT (type, id) over the three authoritative contact tables.
  -- campaign_leads are EXCLUDED (R8): snapshot phones go stale, and a campaign_lead id must never
  -- become calls.contact_id. clients.beneficiary_phone is a different person — excluded.
  SELECT count(*), max(t), max(cid::text)::uuid, max(nm)
    INTO v_count, v_type, v_id, v_name
    FROM (
      SELECT 'lead' AS t, l.id AS cid,
             nullif(btrim(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')), '') AS nm
        FROM public.leads l
       WHERE l.organization_id = p_org_id AND public.phone_last10(l.phone) = v_l10
      UNION ALL
      SELECT 'client', c.id,
             nullif(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '')
        FROM public.clients c
       WHERE c.organization_id = p_org_id AND public.phone_last10(c.phone) = v_l10
      UNION ALL
      SELECT 'recruit', r.id,
             nullif(btrim(coalesce(r.first_name,'') || ' ' || coalesce(r.last_name,'')), '')
        FROM public.recruits r
       WHERE r.organization_id = p_org_id AND public.phone_last10(r.phone) = v_l10
    ) cand;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('resolution','not_found','contact_id',NULL,'contact_type',NULL,
                              'contact_name',NULL,'match_count',0);
  END IF;

  IF v_count > 1 THEN
    -- ≥2 distinct candidates, within or across types ⇒ ambiguous, NULL identity. NEVER newest/first (D1).
    RETURN jsonb_build_object('resolution','ambiguous','contact_id',NULL,'contact_type',NULL,
                              'contact_name',NULL,'match_count',v_count);
  END IF;

  -- exactly one candidate: sanitize the snapshot name (2026-08-11 contact-name canon)
  IF v_name IS NOT NULL AND lower(v_name) IN ('undefined','undefined undefined','null','null null') THEN
    v_name := NULL;
  END IF;

  RETURN jsonb_build_object('resolution','unique','contact_id',v_id,'contact_type',v_type,
                            'contact_name',v_name,'match_count',1);
END;
$$;

COMMENT ON FUNCTION public.resolve_inbound_contact(uuid, text) IS
  'THE canonical org-scoped inbound caller resolver (plan rev5 §3.1): leads ∪ clients ∪ recruits by '
  'phone_last10 equality; unique ⇔ exactly one distinct (type,id); ambiguous stays unlinked; '
  'campaign_leads excluded (R8). Service-role only — the browser never resolves independently.';

REVOKE ALL ON FUNCTION public.resolve_inbound_contact(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_inbound_contact(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_inbound_contact(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_inbound_contact(uuid, text) TO service_role;

-- ── Idempotent, replay-safe inbound ingest (change set D §6.1; R6/R9/R16/R21/R22) ────────────────────
CREATE OR REPLACE FUNCTION public.ingest_inbound_call(
  p_twilio_call_sid text,
  p_org_id uuid,
  p_from_number text,
  p_to_number text,
  p_auto_create boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_sid text := btrim(coalesce(p_twilio_call_sid, ''));
  v_did text := btrim(coalesce(p_to_number, ''));
  v_id uuid;
  v_row public.calls%ROWTYPE;
  v_res jsonb;
  v_l10 text;
  v_digits text;
  v_e164 text;
  v_lead uuid;
BEGIN
  -- R16: strict parent-SID validation before anything else
  IF p_org_id IS NULL OR v_sid !~ '^CA[0-9a-fA-F]{32}$' THEN
    RETURN jsonb_build_object('error', 'invalid_sid');
  END IF;
  IF v_did = '' THEN
    RETURN jsonb_build_object('error', 'invalid_did');
  END IF;

  -- R6: DO NOTHING against the partial unique arbiter; a retry inserts nothing and mutates nothing.
  INSERT INTO public.calls (
    twilio_call_sid, direction, status,
    contact_phone, caller_id_used, organization_id,
    agent_id, contact_id, contact_type, contact_name,
    started_at, created_at
  ) VALUES (
    v_sid, 'inbound', 'ringing',
    coalesce(p_from_number, ''),        -- raw Twilio ANI, preserved verbatim — NEVER the CRM stored phone
    v_did, p_org_id,
    NULL, NULL, NULL, NULL,             -- unowned; contact_type EXPLICIT NULL (defeats the ''lead'' default)
    now(), now()
  )
  ON CONFLICT (twilio_call_sid) WHERE direction = 'inbound' AND twilio_call_sid IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Conflict: exact org-scoped lookup (R16) + exact trimmed-E.164 DID identity check (R22 — NEVER
    -- last-10 here; two DIDs sharing trailing digits under different country codes must not compare equal).
    SELECT * INTO v_row
      FROM public.calls
     WHERE twilio_call_sid = v_sid AND direction = 'inbound' AND organization_id = p_org_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'sid_cross_org_replay');
    END IF;
    IF btrim(coalesce(v_row.caller_id_used, '')) IS DISTINCT FROM v_did THEN
      RETURN jsonb_build_object('error', 'sid_did_mismatch');
    END IF;
    -- Genuine Twilio retry: ZERO row mutation — no updated_at bump, no trigger fire, no re-resolution,
    -- no auto-create. Return the existing row''s state.
    RETURN jsonb_build_object(
      'call_row_id', v_row.id, 'inserted', false, 'resolution', 'existing',
      'contact_id', v_row.contact_id, 'contact_type', v_row.contact_type,
      'contact_name', v_row.contact_name);
  END IF;

  -- Fresh row: canonical resolution (best-effort identity, guaranteed routing).
  v_res := public.resolve_inbound_contact(p_org_id, p_from_number);

  IF v_res->>'resolution' = 'unique' THEN
    UPDATE public.calls
       SET contact_id = (v_res->>'contact_id')::uuid,
           contact_type = v_res->>'contact_type',
           contact_name = v_res->>'contact_name',
           updated_at = now()
     WHERE id = v_id AND contact_id IS NULL;   -- guarded: converging, once

  ELSIF v_res->>'resolution' = 'not_found' AND coalesce(p_auto_create, false) THEN
    -- R21: auto-create additionally requires a non-null valid normalized ANI. anonymous/unknown/
    -- restricted/short callers: no advisory lock, no lead — raw value stays on the row, call routes.
    v_l10 := public.phone_last10(p_from_number);
    IF v_l10 IS NOT NULL THEN
      -- R9: serialize the resolve+create decision per (org, normalized phone), re-resolve in-lock.
      PERFORM pg_advisory_xact_lock(
        hashtextextended('af_inbound_autocreate:' || p_org_id::text || ':' || v_l10, 0));
      v_res := public.resolve_inbound_contact(p_org_id, p_from_number);
      IF v_res->>'resolution' = 'unique' THEN
        UPDATE public.calls
           SET contact_id = (v_res->>'contact_id')::uuid,
               contact_type = v_res->>'contact_type',
               contact_name = v_res->>'contact_name',
               updated_at = now()
         WHERE id = v_id AND contact_id IS NULL;
      ELSIF v_res->>'resolution' = 'not_found' THEN
        v_digits := regexp_replace(coalesce(p_from_number, ''), '[^0-9]', '', 'g');
        v_e164 := CASE
                    WHEN btrim(coalesce(p_from_number,'')) LIKE '+%' THEN btrim(p_from_number)
                    WHEN length(v_digits) = 11 AND v_digits LIKE '1%' THEN '+' || v_digits
                    WHEN length(v_digits) = 10 THEN '+1' || v_digits
                    ELSE '+' || v_digits
                  END;
        INSERT INTO public.leads (organization_id, phone, first_name, last_name,
                                  lead_source, status, assigned_agent_id)
        VALUES (p_org_id, v_e164, 'Inbound', 'Caller', 'Inbound Call', 'New', NULL)
        RETURNING id INTO v_lead;                -- assigned_agent_id NULL: answering agent can claim (D2)
        UPDATE public.calls
           SET contact_id = v_lead, contact_type = 'lead', contact_name = 'Inbound Caller',
               updated_at = now()
         WHERE id = v_id AND contact_id IS NULL;
      END IF;
      -- in-lock 'ambiguous': no link, no auto-create, ever.
    END IF;
  END IF;
  -- 'ambiguous' (and resolver-error surfaces as a raised exception → caller sees an error): no link.

  SELECT * INTO v_row FROM public.calls WHERE id = v_id;
  RETURN jsonb_build_object(
    'call_row_id', v_id, 'inserted', true, 'resolution', v_res->>'resolution',
    'contact_id', v_row.contact_id, 'contact_type', v_row.contact_type,
    'contact_name', v_row.contact_name);
END;
$$;

COMMENT ON FUNCTION public.ingest_inbound_call(text, uuid, text, text, boolean) IS
  'Atomic idempotent inbound ingest (plan rev5 §3.1.4/§6.1): strict CA-SID validation (R16); '
  'ON CONFLICT DO NOTHING against uq_calls_inbound_twilio_call_sid — a Twilio retry mutates ZERO rows '
  '(R6); conflict lookups are SID+direction+org with an exact trimmed-E.164 DID identity check — '
  'cross-org/different-DID replays fail closed (R16/R22); canonical resolution links only unique '
  'matches; auto-create requires not_found AND a valid normalized ANI (R21), serialized per '
  '(org,last10) with an in-lock re-resolve (R9). ANI is preserved verbatim in contact_phone; '
  'contact_type is EXPLICIT NULL for unresolved calls. Service-role only.';

REVOKE ALL ON FUNCTION public.ingest_inbound_call(text, uuid, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingest_inbound_call(text, uuid, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.ingest_inbound_call(text, uuid, text, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_inbound_call(text, uuid, text, text, boolean) TO service_role;

-- ── Two-stage last-agent lookup for the last_agent routing tier (R10/R18) ────────────────────────────
CREATE OR REPLACE FUNCTION public.find_last_agent_for_inbound(
  p_org_id uuid,
  p_contact_id uuid,
  p_last10 text
) RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v uuid;
BEGIN
  IF p_org_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Tier 1: authoritative contact-id match (when the inbound call resolved one).
  IF p_contact_id IS NOT NULL THEN
    SELECT c.agent_id INTO v
      FROM public.calls c
     WHERE c.organization_id = p_org_id
       AND c.direction = 'outbound'
       AND c.agent_id IS NOT NULL
       AND c.contact_id = p_contact_id
     ORDER BY c.created_at DESC
     LIMIT 1;
    IF v IS NOT NULL THEN
      RETURN v;
    END IF;
    -- R18: tier 1 finding NO row falls through — historical outbound rows may lack contact_id.
  END IF;

  -- Tier 2: normalized customer contact_phone within the same organization. NEVER caller_id_used —
  -- that column is the agency DID, not the customer (R10).
  IF p_last10 IS NULL OR length(p_last10) <> 10 THEN
    RETURN NULL;
  END IF;
  SELECT c.agent_id INTO v
    FROM public.calls c
   WHERE c.organization_id = p_org_id
     AND c.direction = 'outbound'
     AND c.agent_id IS NOT NULL
     AND public.phone_last10(c.contact_phone) = p_last10
   ORDER BY c.created_at DESC
   LIMIT 1;
  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.find_last_agent_for_inbound(uuid, uuid, text) IS
  'last_agent routing tier (plan rev5 §3.1.5/§5.5, R10/R18): tier 1 = newest same-org outbound call by '
  'contact_id; tier 2 (only when tier 1 finds no row, including when a contact id was supplied) = '
  'newest same-org outbound call by phone_last10(contact_phone). caller_id_used is never consulted. '
  'Service-role only.';

REVOKE ALL ON FUNCTION public.find_last_agent_for_inbound(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_last_agent_for_inbound(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.find_last_agent_for_inbound(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_last_agent_for_inbound(uuid, uuid, text) TO service_role;
