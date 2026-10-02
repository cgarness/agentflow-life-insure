-- =====================================================================================================
-- Inbound Calling v2 — recent-outbound callback routing (implementation_plan.md §A, consolidated rev 4 with
-- the 2026-09-27 clarifications; APPROVED FOR LOCAL IMPLEMENTATION ONLY — production apply needs its own
-- exact approval, AGENT_RULES #28)
-- =====================================================================================================
-- An UNKNOWN caller (resolve_inbound_contact = not_found; no contact on the call) who calls an agency number
-- that is not a direct line, with no owner supplied by the handler, is routed to the Active agent who most
-- recently dialed that person FROM THAT SAME NUMBER within 168 h — through the unchanged owner flow. Proof of
-- the dial comes only from Twilio (signed <Dial action> + provider call records), captured by
-- twilio-voice-status into a postgres-only table. Ships DARK: no configuration row ⇒ behaviour is M6's.
--
-- D3 (clarification 5): dialed_context is an eligibility check made WHEN THE EVIDENCE IS CAPTURED (seconds
-- after the dial ended) — it is NOT proof of CRM or campaign state when dialing began.
-- Clarification 4: unanswered dials are CAPTURED but never routed until unanswered_eligible is set by a
-- separately approved ops script. Clarification 3: a callback that arrives before its evidence is captured
-- is group-routed and keeps that committed decision (replays return the persisted attempt).
--
-- FUTURE-FACING ONLY: no UPDATE/backfill of any existing row. The only live table locked is
-- public.inbound_route_attempts (never calls, profiles, settings or CRM tables).
--
-- Objects:
--   private.outbound_dial_evidence              provider-verified dial evidence (postgres-only, no FK)
--   private.recent_outbound_routing_orgs        per-organization switch (postgres-only; ops scripts only)
--   inbound_route_attempts.owner_source         CHECK widened with 'recent_outbound'
--   inbound_route_attempts.owner_evidence_*     the evidence an owner decision was made on (NULL-safe CHECK)
--   private.recent_outbound_route_candidate()   read-only resolver: ≤1 eligible evidence row (D1/D4, #18)
--   public.record_outbound_dial_evidence()      service-role writer; never raises for bad input
--   public.plan_inbound_route()                 REPLACED: M6 body + the recent-outbound tier (contained faults)
--   private.intended_recipients_for_call()      REPLACED: M6 body + the recent-outbound recovery tier
--
-- ⚠ Rollback: supabase/migrations/rollback/20260927052736_inbound_recent_outbound_routing.rollback.sql.
--   The M6 rollback must NEVER run while this migration is present (run this migration's rollback first).

-- ── 0. Session bounds and the ONE live-table lock ────────────────────────────────────────────────────
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
LOCK TABLE public.inbound_route_attempts IN ACCESS EXCLUSIVE MODE;

-- ── 1. Preconditions ─────────────────────────────────────────────────────────────────────────────────
-- Expected CHECK texts are deparsed by THIS server from the same expressions (version-agnostic).
CREATE TEMP TABLE ro_expected_checks (
  dial_call_sid text, account_sid text, parent_call_sid text, outcome text, dialed_to_digits text,
  caller_id_digits text, dialed_context text, owner_source text, owner_evidence_dial_call_sid text,
  owner_evidence_provider_started_at timestamptz, owner_evidence_outcome text,
  CONSTRAINT outbound_dial_evidence_dial_call_sid_check CHECK (dial_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
  CONSTRAINT outbound_dial_evidence_account_sid_check CHECK (account_sid ~ '^AC[0-9a-fA-F]{32}$'),
  CONSTRAINT outbound_dial_evidence_parent_call_sid_check CHECK (parent_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
  CONSTRAINT outbound_dial_evidence_outcome_check CHECK (outcome IN ('answered','unanswered')),
  CONSTRAINT outbound_dial_evidence_dialed_to_digits_check CHECK (dialed_to_digits ~ '^[0-9]{10,15}$'),
  CONSTRAINT outbound_dial_evidence_caller_id_digits_check CHECK (caller_id_digits ~ '^[0-9]{10,15}$'),
  CONSTRAINT outbound_dial_evidence_dialed_context_check
    CHECK (dialed_context IN ('unsaved','contact','ambiguous','campaign','browser_marked')),
  CONSTRAINT m6_owner_source_check CHECK (owner_source IN ('contact','direct_line')),
  CONSTRAINT inbound_route_attempts_owner_source_check CHECK (owner_source IN ('contact','direct_line','recent_outbound')),
  CONSTRAINT inbound_route_attempts_owner_evidence_check CHECK (CASE WHEN owner_source = 'recent_outbound'
    THEN owner_evidence_dial_call_sid IS NOT NULL AND owner_evidence_provider_started_at IS NOT NULL
         AND owner_evidence_outcome IS NOT NULL AND owner_evidence_outcome IN ('answered','unanswered')
    ELSE owner_evidence_dial_call_sid IS NULL AND owner_evidence_provider_started_at IS NULL
         AND owner_evidence_outcome IS NULL END)
) ON COMMIT DROP;

-- Grantee set of an ACL ('PUBLIC' for grantee 0), NULL ACL read as the built-in default.
CREATE FUNCTION pg_temp.ro_acl(p_acl aclitem[], p_owner oid, p_kind "char") RETURNS text[]
LANGUAGE sql STABLE AS $f$
  SELECT coalesce(array_agg(s.g ORDER BY s.g COLLATE "C"), '{}'::text[])
    FROM (SELECT DISTINCT (CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END) || ':' || x.privilege_type AS g
            FROM pg_catalog.aclexplode(coalesce(p_acl, pg_catalog.acldefault(p_kind, p_owner))) x) s
$f$;

CREATE FUNCTION pg_temp.ro_check_def(p_rel regclass, p_con text) RETURNS text
LANGUAGE sql STABLE AS $f$
  SELECT pg_catalog.pg_get_constraintdef(k.oid) FROM pg_catalog.pg_constraint k
   WHERE k.conrelid = p_rel AND k.conname = p_con
$f$;

-- The objects this migration creates and its rollback deliberately KEEPS: 'absent' (none of them),
-- 'exact' (all of them, exactly as created here) or a description of the partial/drifted state.
CREATE FUNCTION pg_temp.ro_retained_state() RETURNS text
LANGUAGE plpgsql STABLE AS $f$
DECLARE
  v_ev regclass := to_regclass('private.outbound_dial_evidence');
  v_cfg regclass := to_regclass('private.recent_outbound_routing_orgs');
  v_exp regclass := to_regclass('pg_temp.ro_expected_checks');
  v_cols integer; v_ck integer; v_problems text[] := '{}'; v_rel regclass;
BEGIN
  SELECT count(*) INTO v_cols FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.inbound_route_attempts'::regclass AND NOT attisdropped
     AND attname IN ('owner_evidence_dial_call_sid','owner_evidence_provider_started_at','owner_evidence_outcome');
  SELECT count(*) INTO v_ck FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.inbound_route_attempts'::regclass AND conname = 'inbound_route_attempts_owner_evidence_check';
  IF v_ev IS NULL AND v_cfg IS NULL AND v_cols = 0 AND v_ck = 0 THEN RETURN 'absent'; END IF;
  IF v_ev IS NULL OR v_cfg IS NULL OR v_cols <> 3 OR v_ck <> 1 THEN
    RETURN format('partial: evidence=%s config=%s columns=%s check=%s', v_ev IS NOT NULL, v_cfg IS NOT NULL, v_cols, v_ck);
  END IF;

  -- columns (name, type, NOT NULL, default) in order
  IF (SELECT array_agg(a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NN' ELSE '' END
                       || coalesce(' DEFAULT ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid), '') ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = v_ev AND a.attnum > 0 AND NOT a.attisdropped)
     IS DISTINCT FROM ARRAY['dial_call_sid text NN','call_id uuid NN','organization_id uuid NN','agent_id uuid NN',
       'account_sid text NN','parent_call_sid text NN','outcome text NN','dial_call_status text NN','provider_call_status text NN',
       'dialed_to_digits text NN','caller_id_digits text NN','provider_started_at timestamp with time zone NN',
       'dialed_context text NN','context_checked_at timestamp with time zone NN','recorded_at timestamp with time zone NN DEFAULT now()'] THEN
    v_problems := v_problems || 'outbound_dial_evidence columns';
  END IF;
  IF (SELECT array_agg(a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NN' ELSE '' END
                       || coalesce(' DEFAULT ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid), '') ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = v_cfg AND a.attnum > 0 AND NOT a.attisdropped)
     IS DISTINCT FROM ARRAY['organization_id uuid NN','enabled boolean NN DEFAULT false','unanswered_eligible boolean NN DEFAULT false',
       'did_allowlist text[]','updated_at timestamp with time zone NN DEFAULT now()'] THEN
    v_problems := v_problems || 'recent_outbound_routing_orgs columns';
  END IF;
  IF (SELECT array_agg(a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NN' ELSE '' END
                       || coalesce(' DEFAULT ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid), '') ORDER BY a.attname)
        FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = 'public.inbound_route_attempts'::regclass AND NOT a.attisdropped
         AND a.attname IN ('owner_evidence_dial_call_sid','owner_evidence_provider_started_at','owner_evidence_outcome'))
     IS DISTINCT FROM ARRAY['owner_evidence_dial_call_sid text','owner_evidence_outcome text',
       'owner_evidence_provider_started_at timestamp with time zone'] THEN
    v_problems := v_problems || 'inbound_route_attempts evidence columns';
  END IF;

  -- constraints: exact name set; key definitions; CHECK texts equal this server's deparse of the expected expressions
  IF (SELECT array_agg(k.conname || ' ' || k.contype::text || ' ' ||
                       CASE WHEN k.contype = 'c' THEN (pg_temp.ro_check_def(v_exp, k.conname) IS NOT DISTINCT FROM pg_catalog.pg_get_constraintdef(k.oid))::text
                            ELSE pg_catalog.pg_get_constraintdef(k.oid) END ORDER BY k.conname)
        FROM pg_catalog.pg_constraint k WHERE k.conrelid = v_ev)
     IS DISTINCT FROM ARRAY['outbound_dial_evidence_account_sid_check c true','outbound_dial_evidence_call_id_key u UNIQUE (call_id)',
       'outbound_dial_evidence_caller_id_digits_check c true','outbound_dial_evidence_dial_call_sid_check c true',
       'outbound_dial_evidence_dialed_context_check c true','outbound_dial_evidence_dialed_to_digits_check c true',
       'outbound_dial_evidence_outcome_check c true','outbound_dial_evidence_parent_call_sid_check c true',
       'outbound_dial_evidence_pkey p PRIMARY KEY (dial_call_sid)'] THEN
    v_problems := v_problems || 'outbound_dial_evidence constraints';
  END IF;
  IF (SELECT array_agg(k.conname || ' ' || k.contype::text || ' ' || pg_catalog.pg_get_constraintdef(k.oid) ORDER BY k.conname)
        FROM pg_catalog.pg_constraint k WHERE k.conrelid = v_cfg)
     IS DISTINCT FROM ARRAY['recent_outbound_routing_orgs_pkey p PRIMARY KEY (organization_id)'] THEN
    v_problems := v_problems || 'recent_outbound_routing_orgs constraints';
  END IF;
  IF pg_temp.ro_check_def('public.inbound_route_attempts'::regclass, 'inbound_route_attempts_owner_evidence_check')
     IS DISTINCT FROM pg_temp.ro_check_def(v_exp, 'inbound_route_attempts_owner_evidence_check') THEN
    v_problems := v_problems || 'inbound_route_attempts_owner_evidence_check text';
  END IF;

  -- indexes, owner, grants, RLS (never enabled or forced), persistence (permanent), triggers, policies, publications
  IF (SELECT array_agg(pg_catalog.pg_get_indexdef(i.indexrelid) ORDER BY pg_catalog.pg_get_indexdef(i.indexrelid) COLLATE "C") FROM pg_catalog.pg_index i WHERE i.indrelid = v_ev)
     IS DISTINCT FROM ARRAY[
       'CREATE INDEX outbound_dial_evidence_match_idx ON private.outbound_dial_evidence USING btree (organization_id, dialed_to_digits, caller_id_digits, provider_started_at DESC)',
       'CREATE UNIQUE INDEX outbound_dial_evidence_call_id_key ON private.outbound_dial_evidence USING btree (call_id)',
       'CREATE UNIQUE INDEX outbound_dial_evidence_pkey ON private.outbound_dial_evidence USING btree (dial_call_sid)'] THEN
    v_problems := v_problems || 'outbound_dial_evidence indexes';
  END IF;
  IF (SELECT array_agg(pg_catalog.pg_get_indexdef(i.indexrelid) ORDER BY pg_catalog.pg_get_indexdef(i.indexrelid) COLLATE "C") FROM pg_catalog.pg_index i WHERE i.indrelid = v_cfg)
     IS DISTINCT FROM ARRAY['CREATE UNIQUE INDEX recent_outbound_routing_orgs_pkey ON private.recent_outbound_routing_orgs USING btree (organization_id)'] THEN
    v_problems := v_problems || 'recent_outbound_routing_orgs indexes';
  END IF;
  FOREACH v_rel IN ARRAY ARRAY[v_ev, v_cfg] LOOP
    IF (SELECT c.relkind <> 'r' OR c.relowner <> 'postgres'::regrole
               OR c.relrowsecurity OR c.relforcerowsecurity OR c.relpersistence <> 'p'
               OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) x
                           WHERE x.grantee <> c.relowner)
          FROM pg_catalog.pg_class c WHERE c.oid = v_rel)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = v_rel AND NOT t.tgisinternal)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy pol WHERE pol.polrelid = v_rel)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables pt
                   WHERE pt.schemaname = 'private' AND pt.tablename = (SELECT c.relname FROM pg_catalog.pg_class c WHERE c.oid = v_rel)) THEN
      v_problems := v_problems || (v_rel::text || ' owner/grants/RLS/persistence/triggers/policies/publication');
    END IF;
  END LOOP;

  IF cardinality(v_problems) = 0 THEN RETURN 'exact'; END IF;
  RETURN 'drift: ' || array_to_string(v_problems, '; ');
END;
$f$;

CREATE TEMP TABLE ro_fn_snapshot (fn regprocedure PRIMARY KEY, meta jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE ro_config_before (n integer NOT NULL) ON COMMIT DROP;

DO $pre$
DECLARE
  v_plan regprocedure := to_regprocedure('public.plan_inbound_route(uuid,uuid,uuid,text,uuid[],integer)');
  v_irc regprocedure := to_regprocedure('private.intended_recipients_for_call(uuid,uuid)');
  v_state text; v_check text; v_flagged integer := 0; v_rows integer := 0;
BEGIN
  IF v_plan IS NULL OR v_irc IS NULL THEN
    RAISE EXCEPTION 'recent_outbound: M6 functions missing; refusing';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = v_plan) <> 'a3f59ba5a8d35ed98300d6f1dab38295'
     OR (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = v_irc) <> '7104284f7aa79c8d1ef270eb0fe82de2' THEN
    RAISE EXCEPTION 'recent_outbound: plan_inbound_route / intended_recipients_for_call are not the M6 bodies; refusing';
  END IF;
  IF to_regprocedure('private.phone_digits_e164ish(text)') IS NULL OR to_regprocedure('public.resolve_inbound_contact(uuid,text)') IS NULL
     OR to_regprocedure('public.phone_last10(text)') IS NULL OR to_regclass('public.campaign_leads') IS NULL THEN
    RAISE EXCEPTION 'recent_outbound: a dependency is missing; refusing';
  END IF;
  -- metadata snapshot (everything except the body) for the postconditions. proargdefaults is left out: it
  -- stores parse locations, which differ when this file is sent as ONE query string (psql -c, a single
  -- simple-query apply); the defaults themselves are compared through pg_get_function_arguments.
  INSERT INTO pg_temp.ro_fn_snapshot (fn, meta)
  SELECT p.oid::regprocedure,
         (to_jsonb(p) - 'prosrc' - 'prosqlbody' - 'proargdefaults') || jsonb_build_object(
           'args', pg_catalog.pg_get_function_arguments(p.oid), 'result', pg_catalog.pg_get_function_result(p.oid),
           'grantees', pg_temp.ro_acl(p.proacl, p.proowner, 'f'))
    FROM pg_catalog.pg_proc p WHERE p.oid IN (v_plan, v_irc);

  v_check := pg_temp.ro_check_def('public.inbound_route_attempts'::regclass, 'inbound_route_attempts_owner_source_check');
  IF v_check IS NULL OR (v_check IS DISTINCT FROM pg_temp.ro_check_def('pg_temp.ro_expected_checks'::regclass, 'm6_owner_source_check')
                         AND v_check IS DISTINCT FROM pg_temp.ro_check_def('pg_temp.ro_expected_checks'::regclass, 'inbound_route_attempts_owner_source_check')) THEN
    RAISE EXCEPTION 'recent_outbound: unexpected owner_source CHECK (%); refusing', v_check;
  END IF;

  v_state := pg_temp.ro_retained_state();
  IF v_state NOT IN ('absent', 'exact') THEN
    RAISE EXCEPTION 'recent_outbound: retained objects are neither absent nor the exact rollback residue (%); refusing', v_state;
  END IF;
  IF v_state = 'exact' THEN
    EXECUTE 'SELECT count(*)::integer, (count(*) FILTER (WHERE enabled OR unanswered_eligible))::integer FROM private.recent_outbound_routing_orgs'
      INTO v_rows, v_flagged;
    IF v_flagged > 0 THEN
      RAISE EXCEPTION 'recent_outbound: % configuration row(s) enabled; run supabase/ops/recent_outbound_disable.sql first; refusing', v_flagged;
    END IF;
  END IF;
  INSERT INTO pg_temp.ro_config_before (n) VALUES (v_rows);
END;
$pre$;

-- ── 2. Private evidence + configuration (postgres-only; no RLS; no API grants) ──────────────────────
CREATE TABLE IF NOT EXISTS private.outbound_dial_evidence (
  dial_call_sid text CONSTRAINT outbound_dial_evidence_pkey PRIMARY KEY
    CONSTRAINT outbound_dial_evidence_dial_call_sid_check CHECK (dial_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
  call_id uuid NOT NULL CONSTRAINT outbound_dial_evidence_call_id_key UNIQUE,   -- the outbound calls row (no FK: calls is never locked)
  organization_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  account_sid text NOT NULL CONSTRAINT outbound_dial_evidence_account_sid_check CHECK (account_sid ~ '^AC[0-9a-fA-F]{32}$'),
  parent_call_sid text NOT NULL CONSTRAINT outbound_dial_evidence_parent_call_sid_check CHECK (parent_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
  outcome text NOT NULL CONSTRAINT outbound_dial_evidence_outcome_check CHECK (outcome IN ('answered','unanswered')),
  dial_call_status text NOT NULL,
  provider_call_status text NOT NULL,
  dialed_to_digits text NOT NULL CONSTRAINT outbound_dial_evidence_dialed_to_digits_check CHECK (dialed_to_digits ~ '^[0-9]{10,15}$'),
  caller_id_digits text NOT NULL CONSTRAINT outbound_dial_evidence_caller_id_digits_check CHECK (caller_id_digits ~ '^[0-9]{10,15}$'),
  provider_started_at timestamptz NOT NULL,
  dialed_context text NOT NULL CONSTRAINT outbound_dial_evidence_dialed_context_check
    CHECK (dialed_context IN ('unsaved','contact','ambiguous','campaign','browser_marked')),
  context_checked_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbound_dial_evidence_match_idx
  ON private.outbound_dial_evidence (organization_id, dialed_to_digits, caller_id_digits, provider_started_at DESC);
COMMENT ON TABLE private.outbound_dial_evidence IS
  'Recent-outbound routing: one row per Twilio-verified outbound <Dial> child leg (signed Dial action + provider parent/child '
  'records), written only by record_outbound_dial_evidence. First write wins. dialed_context is checked WHEN CAPTURED, not '
  'when dialing began. Postgres-only.';

CREATE TABLE IF NOT EXISTS private.recent_outbound_routing_orgs (
  organization_id uuid CONSTRAINT recent_outbound_routing_orgs_pkey PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  unanswered_eligible boolean NOT NULL DEFAULT false,
  did_allowlist text[],                        -- NULL = every organization number; '{}' = none; canonical-digit compare
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE private.recent_outbound_routing_orgs IS
  'Recent-outbound routing switch per organization (default off). Changed only by the approved supabase/ops scripts. '
  'unanswered_eligible stays false until the unanswered status pair is proven (clarification 4). Postgres-only.';

REVOKE ALL ON TABLE private.outbound_dial_evidence FROM PUBLIC;
REVOKE ALL ON TABLE private.outbound_dial_evidence FROM anon;
REVOKE ALL ON TABLE private.outbound_dial_evidence FROM authenticated;
REVOKE ALL ON TABLE private.outbound_dial_evidence FROM service_role;
REVOKE ALL ON TABLE private.recent_outbound_routing_orgs FROM PUBLIC;
REVOKE ALL ON TABLE private.recent_outbound_routing_orgs FROM anon;
REVOKE ALL ON TABLE private.recent_outbound_routing_orgs FROM authenticated;
REVOKE ALL ON TABLE private.recent_outbound_routing_orgs FROM service_role;

-- ── 3. Attempt schema: owner_source widened; the evidence an owner decision was made on ─────────────
ALTER TABLE public.inbound_route_attempts
  DROP CONSTRAINT inbound_route_attempts_owner_source_check,
  ADD CONSTRAINT inbound_route_attempts_owner_source_check CHECK (owner_source IN ('contact','direct_line','recent_outbound'));
ALTER TABLE public.inbound_route_attempts
  ADD COLUMN IF NOT EXISTS owner_evidence_dial_call_sid text,
  ADD COLUMN IF NOT EXISTS owner_evidence_provider_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_evidence_outcome text;
-- NULL-safe: all three are set exactly when owner_source = 'recent_outbound' (a NULL outcome never passes).
ALTER TABLE public.inbound_route_attempts
  DROP CONSTRAINT IF EXISTS inbound_route_attempts_owner_evidence_check,
  ADD CONSTRAINT inbound_route_attempts_owner_evidence_check CHECK (CASE WHEN owner_source = 'recent_outbound'
    THEN owner_evidence_dial_call_sid IS NOT NULL AND owner_evidence_provider_started_at IS NOT NULL
         AND owner_evidence_outcome IS NOT NULL AND owner_evidence_outcome IN ('answered','unanswered')
    ELSE owner_evidence_dial_call_sid IS NULL AND owner_evidence_provider_started_at IS NULL
         AND owner_evidence_outcome IS NULL END);
COMMENT ON COLUMN public.inbound_route_attempts.owner_evidence_dial_call_sid IS
  'Recent-outbound routing: the verified outbound DialCallSid this owner decision was made on (set only for owner_source recent_outbound).';

-- ── 4. Resolver — read-only, at most one eligible evidence row (D1, D4, #18 re-checked now) ─────────
CREATE OR REPLACE FUNCTION private.recent_outbound_route_candidate(p_org_id uuid, p_call_row_id uuid, p_include_unanswered boolean)
RETURNS TABLE(o_agent_id uuid, o_dial_call_sid text, o_outcome text, o_provider_started_at timestamptz)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_caller text; v_did text; v_created timestamptz;
BEGIN
  SELECT private.phone_digits_e164ish(c.contact_phone), private.phone_digits_e164ish(c.caller_id_used), c.created_at
    INTO v_caller, v_did, v_created
    FROM public.calls c
   WHERE c.id = p_call_row_id AND c.organization_id = p_org_id AND c.direction = 'inbound';
  -- anonymous / short ANI or DID: no candidate (phone_digits_e164ish is NOT NULL for short input)
  IF NOT FOUND OR v_created IS NULL OR v_caller IS NULL OR v_did IS NULL OR length(v_caller) < 10 OR length(v_did) < 10 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT e.agent_id, e.dial_call_sid, e.outcome, e.provider_started_at
    FROM private.outbound_dial_evidence e
   WHERE e.organization_id = p_org_id
     AND e.dialed_to_digits = v_caller
     AND e.caller_id_digits = v_did
     AND e.provider_started_at < v_created                          -- D1: strictly before the inbound call …
     AND e.provider_started_at >= v_created - interval '168 hours'  -- … and at most 7 × 24 h before it
     AND e.dialed_context = 'unsaved'                               -- D3, checked when the evidence was captured
     AND (e.outcome = 'answered' OR coalesce(p_include_unanswered, false))
     AND EXISTS (SELECT 1 FROM public.profiles p                    -- D4: an agent no longer Active is skipped …
                  WHERE p.id = e.agent_id AND p.organization_id = p_org_id AND p.status = 'Active')
     AND EXISTS (SELECT 1 FROM public.phone_numbers pn              -- … as is one no longer permitted this number (#18)
                  WHERE pn.organization_id = p_org_id
                    AND lower(coalesce(pn.status, 'active')) = 'active'
                    AND private.phone_digits_e164ish(pn.phone_number) = v_did
                    AND (pn.assignment_type = 'agency' OR (pn.assignment_type = 'personal' AND pn.assigned_to = e.agent_id)))
   ORDER BY e.provider_started_at DESC, e.dial_call_sid DESC
   LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION private.recent_outbound_route_candidate(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.recent_outbound_route_candidate(uuid, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION private.recent_outbound_route_candidate(uuid, uuid, boolean) FROM authenticated;
REVOKE ALL ON FUNCTION private.recent_outbound_route_candidate(uuid, uuid, boolean) FROM service_role;

-- ── 5. Evidence writer (service role; the Edge caller validated the signature and read Twilio's records) ─
-- Re-checks every comparison among the supplied values and every database predicate; it cannot re-verify
-- the HMAC or the REST reads. Never raises for bad input; never writes public.calls or any CRM table.
-- Required = the signed request values and the credential account; provider values are compared, never assumed.
CREATE OR REPLACE FUNCTION public.record_outbound_dial_evidence(
  p_signed_account_sid text, p_credential_account_sid text,
  p_parent_call_sid text, p_dial_call_sid text, p_dial_call_status text,
  p_signed_from text, p_signed_to text,
  p_parent_account_sid text, p_parent_from text,
  p_child_account_sid text, p_child_parent_call_sid text,
  p_child_to text, p_child_from text, p_child_status text, p_child_start_time timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_signed_status text := lower(btrim(coalesce(p_dial_call_status, '')));
  v_child_status text := lower(btrim(coalesce(p_child_status, '')));
  v_identity text := substr(coalesce(p_signed_from, ''), 8);
  v_outcome text; v_to text; v_from text; v_signed_to text;
  v_n integer; v_agent uuid; v_org uuid; v_call_id uuid; v_caller_id_used text; v_marked boolean;
  v_res text; v_context text; v_checked_at timestamptz; v_rows integer := 0;
BEGIN
  -- 1. signed inputs present and well-formed
  IF coalesce(p_signed_account_sid, '') !~ '^AC[0-9a-fA-F]{32}$' OR coalesce(p_credential_account_sid, '') !~ '^AC[0-9a-fA-F]{32}$'
     OR coalesce(p_parent_call_sid, '') !~ '^CA[0-9a-fA-F]{32}$' OR coalesce(p_dial_call_sid, '') !~ '^CA[0-9a-fA-F]{32}$'
     OR v_signed_status = '' OR btrim(coalesce(p_signed_to, '')) = ''
     OR coalesce(p_signed_from, '') NOT LIKE 'client:%' OR btrim(v_identity) = '' THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'invalid_input', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  -- 2. only answered / no-answer Dial actions qualify (busy, failed, canceled are expected exclusions)
  IF v_signed_status NOT IN ('completed','answered','no-answer') THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'excluded', 'reason', 'status_not_qualifying', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  -- 3. account binding: signed = credential = parent record = child record
  IF p_credential_account_sid <> p_signed_account_sid
     OR p_parent_account_sid IS DISTINCT FROM p_signed_account_sid OR p_child_account_sid IS DISTINCT FROM p_signed_account_sid THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'account_mismatch', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  -- 4. the parent record was placed by the signed client identity
  IF p_parent_from IS DISTINCT FROM p_signed_from THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'parent_from_mismatch', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  -- 5. the child record belongs to this parent
  IF p_child_parent_call_sid IS DISTINCT FROM p_parent_call_sid THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'child_parent_mismatch', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  -- 6. the provider start is the D1 clock; without it there is no evidence
  IF p_child_start_time IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'missing', 'reason', 'child_start_missing', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  -- 7. accepted status pairs only
  IF v_signed_status IN ('completed','answered') AND v_child_status = 'completed' THEN
    v_outcome := 'answered';
  ELSIF v_signed_status = 'no-answer' AND v_child_status IN ('no-answer','canceled') THEN
    v_outcome := 'unanswered';
  ELSE
    RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'status_pair_unaccepted', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  -- 8. destination and caller ID come from the CHILD record; its destination must be the signed To
  v_to := private.phone_digits_e164ish(p_child_to);
  v_from := private.phone_digits_e164ish(p_child_from);
  v_signed_to := private.phone_digits_e164ish(p_signed_to);
  IF v_to IS NULL OR v_from IS NULL OR v_signed_to IS NULL
     OR length(v_to) NOT BETWEEN 10 AND 15 OR length(v_from) NOT BETWEEN 10 AND 15 OR length(v_signed_to) NOT BETWEEN 10 AND 15 THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'destination_invalid', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  IF v_to <> v_signed_to THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'child_to_mismatch', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  -- 9. exactly one profile carries the signed client identity, in an organization
  SELECT count(*)::integer, (array_agg(p.id))[1], (array_agg(p.organization_id))[1]
    INTO v_n, v_agent, v_org
    FROM public.profiles p WHERE p.twilio_client_identity = v_identity;
  IF v_n <> 1 OR v_org IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'identity_not_unique', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  -- 10. exactly one outbound calls row for this parent, agent and organization
  SELECT count(*)::integer, (array_agg(c.id))[1], (array_agg(c.caller_id_used))[1],
         bool_or(c.contact_id IS NOT NULL OR c.campaign_id IS NOT NULL OR c.campaign_lead_id IS NOT NULL)
    INTO v_n, v_call_id, v_caller_id_used, v_marked
    FROM public.calls c
   WHERE c.twilio_call_sid = p_parent_call_sid AND c.direction = 'outbound' AND c.agent_id = v_agent AND c.organization_id = v_org;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'call_row_not_found', 'outcome', NULL, 'dialed_context', NULL);
  ELSIF v_n > 1 THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'call_row_not_unique', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  -- 11. consistency only: the browser-written caller ID agrees with the provider's (browser fields prove nothing)
  IF private.phone_digits_e164ish(v_caller_id_used) IS DISTINCT FROM v_from THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'caller_id_mismatch', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  -- 12. #18: an active organization number this agent may use (agency, or their own personal number)
  IF NOT EXISTS (SELECT 1 FROM public.phone_numbers pn
                  WHERE pn.organization_id = v_org AND lower(coalesce(pn.status, 'active')) = 'active'
                    AND private.phone_digits_e164ish(pn.phone_number) = v_from
                    AND (pn.assignment_type = 'agency' OR (pn.assignment_type = 'personal' AND pn.assigned_to = v_agent))) THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'number_not_permitted', 'outcome', NULL, 'dialed_context', NULL);
  END IF;
  -- 13. D3 (clarification 5): context checked NOW, at capture — not proof of the state when dialing began.
  --     Contact and campaign matching use last-10 on purpose (a broader exclusion is the safe direction).
  v_checked_at := clock_timestamp();
  v_res := public.resolve_inbound_contact(v_org, p_child_to)->>'resolution';
  IF v_res = 'unique' THEN
    v_context := 'contact';
  ELSIF v_res = 'ambiguous' THEN
    v_context := 'ambiguous';
  ELSIF EXISTS (SELECT 1 FROM public.campaign_leads cl
                 WHERE cl.organization_id = v_org AND public.phone_last10(cl.phone) = public.phone_last10(p_child_to)) THEN
    v_context := 'campaign';
  ELSIF v_marked THEN
    v_context := 'browser_marked';
  ELSE
    v_context := 'unsaved';
  END IF;
  -- 14. first write wins (either unique key); stored values are never changed by a later delivery
  INSERT INTO private.outbound_dial_evidence
    (dial_call_sid, call_id, organization_id, agent_id, account_sid, parent_call_sid, outcome, dial_call_status,
     provider_call_status, dialed_to_digits, caller_id_digits, provider_started_at, dialed_context, context_checked_at)
  VALUES
    (p_dial_call_sid, v_call_id, v_org, v_agent, p_signed_account_sid, p_parent_call_sid, v_outcome, v_signed_status,
     v_child_status, v_to, v_from, p_child_start_time, v_context, v_checked_at)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN jsonb_build_object('recorded', true, 'category', 'persisted', 'reason', 'recorded', 'outcome', v_outcome, 'dialed_context', v_context);
  END IF;
  SELECT e.outcome, e.dialed_context INTO v_outcome, v_context FROM private.outbound_dial_evidence e WHERE e.dial_call_sid = p_dial_call_sid;
  IF FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'category', 'persisted', 'reason', 'duplicate', 'outcome', v_outcome, 'dialed_context', v_context);
  END IF;
  RETURN jsonb_build_object('recorded', false, 'category', 'unverified', 'reason', 'call_already_evidenced', 'outcome', NULL, 'dialed_context', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.record_outbound_dial_evidence(text, text, text, text, text, text, text, text, text, text, text, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_outbound_dial_evidence(text, text, text, text, text, text, text, text, text, text, text, text, text, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.record_outbound_dial_evidence(text, text, text, text, text, text, text, text, text, text, text, text, text, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_outbound_dial_evidence(text, text, text, text, text, text, text, text, text, text, text, text, text, text, timestamptz) TO service_role;
COMMENT ON FUNCTION public.record_outbound_dial_evidence(text, text, text, text, text, text, text, text, text, text, text, text, text, text, timestamptz) IS
  'Recent-outbound routing: records one provider-verified outbound Dial as evidence (first write wins). Returns '
  '{recorded, category persisted|excluded|unverified|missing, reason, outcome, dialed_context}. Never raises for bad '
  'input; never writes calls or CRM rows. Service-role only (twilio-voice-status).';

-- ── 6. plan_inbound_route + intended_recipients_for_call — the M6 bodies plus ONE tier each ─────────
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
  v_source text; v_ro_failed boolean := false; v_ro_enabled boolean := false; v_ro_unanswered boolean := false;
  v_res text; v_is_direct boolean; v_ro_agent uuid; v_ev_sid text; v_ev_outcome text; v_ev_started timestamptz;
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

  -- ── Recent-outbound tier (20260927052736) — only when the handler supplied NO owner (no direct line, no
  -- contact owner) and the call carries no contact. (1) The optional configuration read is CONTAINED: a fault
  -- logs a WARNING and routes the group with a recent_outbound_unavailable reason. (2) The identity/ownership
  -- re-check is NOT contained: a CRM or direct-line fault propagates (fail closed). (3) The optional evidence
  -- lookup is CONTAINED like (1). A match enters the unchanged owner mode below as owner_source recent_outbound.
  IF p_owner_agent_id IS NULL AND c.contact_id IS NULL THEN
    BEGIN
      SELECT (cfg.enabled AND (cfg.did_allowlist IS NULL OR EXISTS (
                SELECT 1 FROM unnest(cfg.did_allowlist) d(x)
                 WHERE private.phone_digits_e164ish(d.x) = private.phone_digits_e164ish(c.caller_id_used)
                   AND length(private.phone_digits_e164ish(d.x)) >= 10))),
             cfg.unanswered_eligible
        INTO v_ro_enabled, v_ro_unanswered
        FROM private.recent_outbound_routing_orgs cfg
       WHERE cfg.organization_id = p_org_id;
      v_ro_enabled := coalesce(v_ro_enabled, false);
      v_ro_unanswered := coalesce(v_ro_unanswered, false);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'plan_inbound_route: recent_outbound config unavailable (%): %', SQLSTATE, SQLERRM;
      v_ro_failed := true; v_ro_enabled := false;
    END;
    IF v_ro_enabled THEN
      v_res := public.resolve_inbound_contact(p_org_id, c.contact_phone)->>'resolution';
      v_is_direct := EXISTS (SELECT 1 FROM public.phone_numbers pn
                              WHERE pn.organization_id = p_org_id AND pn.is_direct_line
                                AND private.phone_digits_e164ish(pn.phone_number) = private.phone_digits_e164ish(c.caller_id_used));
      IF v_res = 'not_found' AND NOT v_is_direct THEN
        BEGIN
          SELECT cand.o_agent_id, cand.o_dial_call_sid, cand.o_outcome, cand.o_provider_started_at
            INTO v_ro_agent, v_ev_sid, v_ev_outcome, v_ev_started
            FROM private.recent_outbound_route_candidate(p_org_id, p_call_row_id, v_ro_unanswered) cand;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'plan_inbound_route: recent_outbound evidence unavailable (%): %', SQLSTATE, SQLERRM;
          v_ro_failed := true;
          v_ro_agent := NULL; v_ev_sid := NULL; v_ev_outcome := NULL; v_ev_started := NULL;
        END;
        IF v_ro_agent IS NOT NULL THEN
          p_owner_agent_id := v_ro_agent; v_source := 'recent_outbound';
        END IF;
      END IF;
    END IF;
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
       reserved_agent_ids, browser_ring_timeout_sent, voicemail_kind, voicemail_agent_id,
       owner_evidence_dial_call_sid, owner_evidence_provider_started_at, owner_evidence_outcome)
    VALUES
      (p_call_row_id, p_org_id, 'owner', p_owner_agent_id,
       CASE WHEN v_source = 'recent_outbound' THEN 'recent_outbound'
            WHEN p_owner_source IN ('contact','direct_line') THEN p_owner_source ELSE 'contact' END,
       v_reason, v_stage,
       CASE WHEN v_stage = 'owner_browser' THEN ARRAY[p_owner_agent_id] ELSE '{}'::uuid[] END,
       CASE WHEN v_stage = 'owner_browser' THEN v_ring END,
       CASE WHEN v_stage = 'owner_voicemail' THEN 'agent' END,
       CASE WHEN v_stage = 'owner_voicemail' THEN p_owner_agent_id END,
       CASE WHEN v_source = 'recent_outbound' THEN v_ev_sid END,
       CASE WHEN v_source = 'recent_outbound' THEN v_ev_started END,
       CASE WHEN v_source = 'recent_outbound' THEN v_ev_outcome END)
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
    v_reason := CASE WHEN v_ro_failed THEN 'recent_outbound_unavailable->group_empty'
                     WHEN p_owner_agent_id IS NOT NULL THEN 'owner_ineligible->group_empty'
                     WHEN cardinality(v_group) = 0 THEN 'group_unconfigured' ELSE 'group_none_eligible' END;
  ELSE
    v_stage := 'group_browser';
    v_reason := CASE WHEN v_ro_failed THEN 'recent_outbound_unavailable->group'
                     WHEN p_owner_agent_id IS NOT NULL THEN 'owner_ineligible->group' ELSE 'no_owner->group' END;
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
  -- Recent-outbound (20260927052736): an unknown caller whose COMMITTED attempt was routed to the verified
  -- recent dialer belongs to that dialer while they are an Active member of this organization. Reads only
  -- the committed attempt — never the resolver or the evidence.
  IF c.contact_id IS NULL THEN
    SELECT a.owner_agent_id INTO v_owner FROM public.inbound_route_attempts a
     WHERE a.call_id = c.id AND a.organization_id = p_org_id AND a.owner_source = 'recent_outbound';
    IF v_owner IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_owner AND p.organization_id = p_org_id AND p.status = 'Active') THEN
      RETURN ARRAY[v_owner];
    END IF;
  END IF;
  -- D5: the caller is unknown or established unassigned ⇒ the configured inbound group
  SELECT NULLIF(irs.inbound_group_agent_ids, '{}'::uuid[]) INTO v_group
    FROM public.inbound_routing_settings irs WHERE irs.organization_id = p_org_id;
  RETURN v_group;
END;
$$;
REVOKE ALL ON FUNCTION private.intended_recipients_for_call(uuid, uuid) FROM PUBLIC;

-- ── 7. Postconditions ─────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_rpc regprocedure := to_regprocedure('public.record_outbound_dial_evidence(text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz)');
  v_res regprocedure := to_regprocedure('private.recent_outbound_route_candidate(uuid,uuid,boolean)');
  v_state text; v_bad text; v_rows integer; v_flagged integer;
BEGIN
  -- replaced functions: metadata unchanged (defaults via pg_get_function_arguments), body changed
  SELECT string_agg(s.fn::text, ', ') INTO v_bad
    FROM pg_temp.ro_fn_snapshot s JOIN pg_catalog.pg_proc p ON p.oid = s.fn
   WHERE (to_jsonb(p) - 'prosrc' - 'prosqlbody' - 'proargdefaults') || jsonb_build_object(
           'args', pg_catalog.pg_get_function_arguments(p.oid), 'result', pg_catalog.pg_get_function_result(p.oid),
           'grantees', pg_temp.ro_acl(p.proacl, p.proowner, 'f')) IS DISTINCT FROM s.meta;
  IF v_bad IS NOT NULL OR (SELECT count(*) FROM pg_temp.ro_fn_snapshot) <> 2 THEN
    RAISE EXCEPTION 'recent_outbound postcondition: replaced function metadata changed (%)', v_bad;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = 'public.plan_inbound_route(uuid,uuid,uuid,text,uuid[],integer)'::regprocedure) = 'a3f59ba5a8d35ed98300d6f1dab38295'
     OR (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = 'private.intended_recipients_for_call(uuid,uuid)'::regprocedure) = '7104284f7aa79c8d1ef270eb0fe82de2' THEN
    RAISE EXCEPTION 'recent_outbound postcondition: a replaced function still has its M6 body';
  END IF;
  -- new functions: security, volatility, search_path, owner, grantee set
  IF v_rpc IS NULL OR (SELECT NOT p.prosecdef OR p.provolatile <> 'v' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
                              OR p.proowner <> 'postgres'::regrole
                              OR pg_temp.ro_acl(p.proacl, p.proowner, 'f') IS DISTINCT FROM ARRAY['postgres:EXECUTE','service_role:EXECUTE']
                         FROM pg_catalog.pg_proc p WHERE p.oid = v_rpc) THEN
    RAISE EXCEPTION 'recent_outbound postcondition: record_outbound_dial_evidence attributes or grantees wrong';
  END IF;
  IF v_res IS NULL OR (SELECT p.prosecdef OR p.provolatile <> 's' OR NOT p.proretset
                              OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
                              OR p.proowner <> 'postgres'::regrole
                              OR pg_temp.ro_acl(p.proacl, p.proowner, 'f') IS DISTINCT FROM ARRAY['postgres:EXECUTE']
                         FROM pg_catalog.pg_proc p WHERE p.oid = v_res) THEN
    RAISE EXCEPTION 'recent_outbound postcondition: recent_outbound_route_candidate attributes or grantees wrong';
  END IF;
  -- exactly one function per new/replaced name (no overloads)
  SELECT string_agg(x.n, ', ') INTO v_bad
    FROM (VALUES ('public','plan_inbound_route'), ('private','intended_recipients_for_call'),
                 ('private','recent_outbound_route_candidate'), ('public','record_outbound_dial_evidence')) x(s, n)
   WHERE (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
           WHERE ns.nspname = x.s AND p.proname = x.n) <> 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'recent_outbound postcondition: overloads or missing functions (%)', v_bad;
  END IF;
  -- the API roles never reach the private schema
  IF has_schema_privilege('anon', 'private', 'USAGE') OR has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_schema_privilege('service_role', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'recent_outbound postcondition: an API role holds USAGE on schema private';
  END IF;
  -- retained objects exactly as created (tables, index, columns, evidence CHECK, owner, no grants, no publication)
  v_state := pg_temp.ro_retained_state();
  IF v_state <> 'exact' THEN
    RAISE EXCEPTION 'recent_outbound postcondition: created objects differ from the specification (%)', v_state;
  END IF;
  IF pg_temp.ro_check_def('public.inbound_route_attempts'::regclass, 'inbound_route_attempts_owner_source_check')
     IS DISTINCT FROM pg_temp.ro_check_def('pg_temp.ro_expected_checks'::regclass, 'inbound_route_attempts_owner_source_check') THEN
    RAISE EXCEPTION 'recent_outbound postcondition: owner_source CHECK text wrong';
  END IF;
  -- configuration rows unchanged: same count, every flag false
  SELECT count(*)::integer, (count(*) FILTER (WHERE enabled OR unanswered_eligible))::integer INTO v_rows, v_flagged
    FROM private.recent_outbound_routing_orgs;
  IF v_rows <> (SELECT n FROM pg_temp.ro_config_before) OR v_flagged <> 0 THEN
    RAISE EXCEPTION 'recent_outbound postcondition: configuration rows changed (% rows, % flagged)', v_rows, v_flagged;
  END IF;
END;
$post$;
-- ── end of postconditions ──

DROP FUNCTION pg_temp.ro_retained_state();
DROP FUNCTION pg_temp.ro_check_def(regclass, text);
DROP FUNCTION pg_temp.ro_acl(aclitem[], oid, "char");
