-- =====================================================================================================
-- Reports V2, PKG-A file 5 of 8: regional state helpers (plan §2.6, §2.7, §2.9 E4; D5 §3.1–§3.3, §3.8).
--
-- PLACEHOLDER VERSION. Renumbered above the then-current production head, order kept, in a
-- filename-only commit before the PKG-A backend merge. Branch work only: not applied to production.
--
-- Privilege class C (plan §2.8): three private helpers, each created sealed, and one private index built
-- transactionally (allowed only for private tables, §2.7). No privilege is added, no RLS setting or policy
-- changes and no data is written. public.normalize_us_state is used unchanged and is never altered,
-- replaced or re-granted. Runs after …10 to …13.
--
--   report_v3_state_classify     raw text -> one of the 51 supported jurisdictions (50 states and DC), or a
--                                reason: missing_state, unsupported_geography or invalid_state
--   report_v3_identity_states_by_id  each D3 identity's recorded state, by its lead or client id: its same-org
--                                lead/client records first, then (only when those are all blank) a campaign-membership
--                                copy; two or more distinct codes are an explicit source_conflict. PL/pgSQL running one
--                                constant statement (EXECUTE ... USING) planned for the ids given; it relies on
--                                uq_clients_lead_id (checked by the preflight) for one converted client per lead
--   report_v3_identity_states    the same for D3 keys ('lead:<root lead>', 'client:<id>'): parses them, then reads
--                                report_v3_identity_states_by_id (Batch 7: the state reader passes typed ids)
--   report_v3_lineage_original_lead  private.dialer_conversion_lineage (organization_id, original_lead_id)
--
-- Every lookup is same-org; identities are never resolved from phone numbers; results are internal to the
-- definer reader (…15), which returns only per-state aggregates. Privacy effect E4 (a recorded state set by
-- anyone, including a membership copy reached through any same-org call) still needs the §2.9 review.
-- =====================================================================================================
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE c text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'private' AND p.proname IN ('report_v3_state_classify', 'report_v3_identity_states',
                                                            'report_v3_identity_states_by_id')) THEN
    RAISE EXCEPTION 'Reports v3 state helpers: refusing replay; state helpers already exist';
  END IF;
  IF to_regprocedure('private.report_v3_client_identity_key(uuid,uuid)') IS NULL
     OR to_regprocedure('private.report_v3_contact_identity(uuid,uuid[],uuid[])') IS NULL
     OR to_regprocedure('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 state helpers: the call and journey helpers (…12) and the appointment stub (…13) must be applied first';
  END IF;
  -- report_v3_identity_states reads at most one converted client per lead: clients.lead_id must stay unique.
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indexrelid = to_regclass('public.uq_clients_lead_id') AND i.indrelid = 'public.clients'::regclass
                    AND i.indisunique AND i.indisvalid AND i.indnkeyatts = 1
                    AND i.indkey[0] = (SELECT a.attnum FROM pg_attribute a
                                        WHERE a.attrelid = 'public.clients'::regclass AND a.attname = 'lead_id')
                    AND (i.indpred IS NULL OR pg_get_expr(i.indpred, i.indrelid) = '(lead_id IS NOT NULL)')) THEN
    RAISE EXCEPTION 'Reports v3 state helpers: public.clients.lead_id must be unique (uq_clients_lead_id)';
  END IF;
  -- The unchanged production normalizer (baseline:4378-4470), by the same method as the enable pins.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.normalize_us_state(text)')
                   AND md5(prosrc) = 'c80ff9ad87445693d84d0276c872ba83' AND provolatile = 'i' AND NOT prosecdef
                   AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
    RAISE EXCEPTION 'Reports v3 state helpers: normalize_us_state drift';
  END IF;
  FOR c IN SELECT * FROM unnest(ARRAY[
      'public.leads.state', 'public.clients.state', 'public.clients.lead_id', 'public.campaign_leads.state',
      'public.campaign_leads.lead_id', 'public.calls.contact_id', 'public.calls.campaign_lead_id',
      'private.dialer_conversion_lineage.campaign_lead_id', 'private.dialer_conversion_lineage.original_lead_id',
      'public.contact_history_events.contact_id', 'public.contact_history_events.contact_type',
      'public.contact_history_events.changed_fields', 'public.contact_history_events.recorded_at']) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = split_part(c, '.', 1) AND table_name = split_part(c, '.', 2)
                      AND column_name = split_part(c, '.', 3)) THEN
      RAISE EXCEPTION 'Reports v3 state helpers: dependency column missing: %', c;
    END IF;
  END LOOP;
  PERFORM set_config('reports_v3.normalizer_acl',
                     (SELECT coalesce(proacl::text, '') || '|' || pg_get_userbyid(proowner) FROM pg_proc
                       WHERE oid = 'public.normalize_us_state(text)'::regprocedure), true);
END $preflight$;

-- -----------------------------------------------------------------------------------------------------
-- The classifier (D5 §3.2). Pre-trim space, tab, LF, VT, FF and CR (never E'\v', which PostgreSQL reads as
-- the letter v), then the unchanged normalize_us_state, which returns unrecognized input as is. A
-- non-breaking space is not trimmed, so such a value is invalid. Raw input is never echoed.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_state_classify(p_raw text, OUT state_code text, OUT reason text)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN n.code = ANY (j.supported) THEN n.code END,
         CASE WHEN n.trimmed = '' THEN 'missing_state'
              WHEN n.code = ANY (j.supported) THEN NULL
              WHEN upper(n.trimmed) = ANY (j.unsupported_codes) OR lower(n.trimmed) = ANY (j.unsupported_names)
                THEN 'unsupported_geography'
              ELSE 'invalid_state' END
    FROM (SELECT t.trimmed, CASE WHEN t.trimmed <> '' THEN public.normalize_us_state(t.trimmed) END AS code
            FROM (SELECT btrim(coalesce(p_raw, ''), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)) AS trimmed) t) n,
         (SELECT ARRAY['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
                       'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
                       'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
                       'VA', 'WA', 'WV', 'WI', 'WY', 'DC'] AS supported,
                 ARRAY['PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'FM', 'MH', 'PW', 'AA', 'AE', 'AP'] AS unsupported_codes,
                 ARRAY['puerto rico', 'guam', 'virgin islands', 'u.s. virgin islands', 'us virgin islands',
                       'united states virgin islands', 'american samoa', 'northern mariana islands',
                       'united states minor outlying islands', 'u.s. minor outlying islands', 'federated states of micronesia',
                       'micronesia', 'marshall islands', 'palau', 'armed forces americas', 'armed forces europe',
                       'armed forces africa', 'armed forces canada', 'armed forces middle east',
                       'armed forces pacific'] AS unsupported_names) j;
$$;

-- -----------------------------------------------------------------------------------------------------
-- Identity states (D5 §3.3). Keys are D3's 'lead:<root lead>' and 'client:<id>'; anything else is dropped,
-- and each distinct key gets one row. Every lookup is pinned to p_org, and the result is all-time: it never
-- depends on a window or scope. Outcomes, in order:
--   no same-org record                         unresolved_identity (no fallback)
--   records: one distinct supported code       that code, basis current_record
--   records: two or more distinct codes        source_conflict
--   records: no code, a recorded value         unsupported_geography, else invalid_state
--   records all blank: the same rules over the identity's distinct same-org memberships, reached through
--     campaign_leads.lead_id, the conversion lineage, or a same-org call on the identity by any agent,
--     with basis campaign_copy; nothing recorded anywhere is missing_state (basis NULL)
-- last_state_change_at is the latest same-org 'state' change of the identity's own records or root lead.
-- It feeds only the reader's changed-after-event counters.
-- report_v3_identity_states_by_id takes the identities as lead and client ids (Batch 7: the state reader's typed
-- inputs; no text key is built or parsed) and is PARALLEL RESTRICTED (read-only, no subtransaction). The key form,
-- report_v3_identity_states, parses D3 keys and reads it, so both give the same states.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_identity_states_by_id(p_org uuid, p_lead_ids uuid[], p_client_ids uuid[])
RETURNS TABLE (identity_kind text, identity_id uuid, state_code text, reason text, basis text, last_state_change_at timestamptz)
LANGUAGE plpgsql
STABLE
PARALLEL RESTRICTED
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_leads uuid[];
  v_clients uuid[];
BEGIN
  IF p_org IS NULL THEN
    RETURN;
  END IF;
  -- Each distinct lead id is the identity 'lead:<id>' and each distinct client id 'client:<id>'; a NULL id is dropped.
  -- Deduplicated here, so the statement below is planned for the real number of identities.
  v_leads := ARRAY(SELECT DISTINCT u.id FROM unnest(p_lead_ids) AS u(id) WHERE u.id IS NOT NULL);
  v_clients := ARRAY(SELECT DISTINCT u.id FROM unnest(p_client_ids) AS u(id) WHERE u.id IS NOT NULL);
  -- One statement with constant text, planned for the actual identities (EXECUTE ... USING), with the rules and their
  -- order unchanged. A key has at most two records, its own (the lead row of a lead key, the client row of a client key)
  -- and, for a lead key, the client converted from it (clients.lead_id is unique: uq_clients_lead_id), so each key's
  -- current-record votes sit on one row. Recorded values are classified once (the classifier is immutable); only keys
  -- whose records are all blank read campaign copies. Keys are (kind, id) throughout; no text key is built.
  RETURN QUERY EXECUTE $q$
    WITH k AS MATERIALIZED (
      SELECT 'lead'::text AS kind, x.id, x.id AS lead_id, NULL::uuid AS client_id FROM unnest($2) AS x(id)
      UNION ALL
      SELECT 'client', x.id, NULL::uuid, x.id FROM unnest($3) AS x(id)
    ), w AS MATERIALIZED (
      SELECT k.kind, k.id, k.lead_id,
             coalesce(l.id, c2.id) AS a_id, CASE WHEN k.lead_id IS NOT NULL THEN l.state ELSE c2.state END AS a_raw,
             c1.id AS b_id, c1.state AS b_raw
        FROM k
        LEFT JOIN public.leads l ON l.id = k.lead_id AND l.organization_id = $1
        LEFT JOIN public.clients c1 ON c1.lead_id = k.lead_id AND c1.organization_id = $1
        LEFT JOIN public.clients c2 ON c2.id = k.client_id AND c2.organization_id = $1
    ), null_class AS (
      SELECT s.state_code, s.reason FROM private.report_v3_state_classify(NULL) s
    ), record_class AS (
      SELECT v.raw, s.state_code, s.reason
        FROM (SELECT DISTINCT u.raw
                FROM (SELECT w.a_raw AS raw FROM w UNION ALL SELECT w.b_raw FROM w WHERE w.b_id IS NOT NULL) u
               WHERE u.raw IS NOT NULL) v
       CROSS JOIN LATERAL private.report_v3_state_classify(v.raw) s
    ), rv AS MATERIALIZED (
      SELECT x.*,
             (x.a_id IS NOT NULL AND x.a_reason IS DISTINCT FROM 'missing_state')
               OR (x.b_id IS NOT NULL AND x.b_reason IS DISTINCT FROM 'missing_state') AS rec_recorded
        FROM (SELECT w.kind, w.id, w.lead_id, w.b_id, (w.a_id IS NOT NULL OR w.b_id IS NOT NULL) AS has_records,
                     w.a_id,
                     CASE WHEN w.a_id IS NULL THEN NULL WHEN w.a_raw IS NULL THEN n.state_code ELSE ra.state_code END AS a_code,
                     CASE WHEN w.a_id IS NULL THEN NULL WHEN w.a_raw IS NULL THEN n.reason ELSE ra.reason END AS a_reason,
                     CASE WHEN w.b_id IS NULL THEN NULL WHEN w.b_raw IS NULL THEN n.state_code ELSE rb.state_code END AS b_code,
                     CASE WHEN w.b_id IS NULL THEN NULL WHEN w.b_raw IS NULL THEN n.reason ELSE rb.reason END AS b_reason
                FROM w CROSS JOIN null_class n
                LEFT JOIN record_class ra ON ra.raw = w.a_raw
                LEFT JOIN record_class rb ON rb.raw = w.b_raw) x
    ), copies AS MATERIALIZED (
      -- Keys with records, all blank: the same three membership routes as before.
      SELECT b.kind, b.id, cl.id AS campaign_lead_id, cl.state AS raw_state
        FROM rv b JOIN public.campaign_leads cl ON cl.lead_id = b.lead_id AND cl.organization_id = $1
       WHERE b.has_records AND NOT b.rec_recorded
      UNION
      SELECT b.kind, b.id, cl.id, cl.state
        FROM rv b
        JOIN private.dialer_conversion_lineage lin ON lin.original_lead_id = b.lead_id AND lin.organization_id = $1
        JOIN public.campaign_leads cl ON cl.id = lin.campaign_lead_id AND cl.organization_id = $1
       WHERE b.has_records AND NOT b.rec_recorded
      UNION
      SELECT b.kind, b.id, cl.id, cl.state
        FROM rv b
        JOIN public.calls ca ON ca.contact_id IN (b.id, b.b_id) AND ca.organization_id = $1
        JOIN public.campaign_leads cl ON cl.id = ca.campaign_lead_id AND cl.organization_id = $1
       WHERE b.has_records AND NOT b.rec_recorded
    ), copy_class AS (
      SELECT v.raw, s.state_code, s.reason
        FROM (SELECT DISTINCT c.raw_state AS raw FROM copies c WHERE c.raw_state IS NOT NULL) v
       CROSS JOIN LATERAL private.report_v3_state_classify(v.raw) s
    ), cv AS (
      SELECT y.kind, y.id, bool_or(y.reason IS DISTINCT FROM 'missing_state') AS copy_recorded, min(y.state_code) AS copy_min,
             max(y.state_code) AS copy_max, bool_or(y.reason = 'unsupported_geography') AS copy_unsupported
        FROM (SELECT c.kind, c.id, CASE WHEN c.raw_state IS NULL THEN n.state_code ELSE x.state_code END AS state_code,
                     CASE WHEN c.raw_state IS NULL THEN n.reason ELSE x.reason END AS reason
                FROM copies c CROSS JOIN null_class n LEFT JOIN copy_class x ON x.raw = c.raw_state) y
       GROUP BY y.kind, y.id
    ), hist AS (
      -- The key's own contact and its records' contacts; the converted client is the only one that differs from it.
      SELECT h.kind, h.id, max(e.recorded_at) AS last_at
        FROM (SELECT w.kind, w.id, w.kind AS contact_type, w.id AS contact_id FROM w
              UNION ALL
              SELECT w.kind, w.id, 'client', w.b_id FROM w WHERE w.b_id IS NOT NULL) h
        JOIN public.contact_history_events e
          ON e.contact_id = h.contact_id AND e.contact_type = h.contact_type AND e.organization_id = $1
         AND 'state' = ANY (e.changed_fields)
       GROUP BY h.kind, h.id
    ), o AS (
      -- The decided basis is the current record when any record carries a value, else the campaign copy when any copy
      -- does. All of the decided basis's votes give its codes (none, exactly one distinct code, or more than one), the
      -- code and the unsupported flag.
      SELECT r.kind, r.id, r.has_records, h.last_at,
             CASE WHEN r.rec_recorded THEN 'current_record' WHEN c.copy_recorded THEN 'campaign_copy' END AS decided,
             CASE WHEN r.rec_recorded THEN least(r.a_code, r.b_code) ELSE c.copy_min END AS code,
             CASE WHEN r.rec_recorded THEN greatest(r.a_code, r.b_code) ELSE c.copy_max END AS code_max,
             CASE WHEN r.rec_recorded THEN coalesce(r.a_reason = 'unsupported_geography', false)
                                             OR coalesce(r.b_reason = 'unsupported_geography', false)
                  ELSE c.copy_unsupported END AS unsupported
        FROM rv r
        LEFT JOIN cv c ON c.kind = r.kind AND c.id = r.id
        LEFT JOIN hist h ON h.kind = r.kind AND h.id = r.id
    )
    SELECT o.kind, o.id,
           CASE WHEN o.decided IS NOT NULL AND o.code = o.code_max THEN o.code END,
           CASE WHEN NOT o.has_records THEN 'unresolved_identity'
                WHEN o.decided IS NULL THEN 'missing_state'
                WHEN o.code = o.code_max THEN NULL
                WHEN o.code IS NOT NULL THEN 'source_conflict'
                WHEN o.unsupported THEN 'unsupported_geography'
                ELSE 'invalid_state' END,
           o.decided,
           o.last_at
      FROM o
  $q$ USING p_org, v_leads, v_clients;
END
$$;

CREATE FUNCTION private.report_v3_identity_states(p_org uuid, p_identity_keys text[])
RETURNS TABLE (identity_key text, state_code text, reason text, basis text, last_state_change_at timestamptz)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_leads uuid[];
  v_clients uuid[];
BEGIN
  IF p_org IS NULL THEN
    RETURN;
  END IF;
  -- The distinct lead and client identities among the keys. A key is one exactly when it matches
  -- '^(lead|client):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$': LIKE fixes the prefix, the length and
  -- the four dash positions, uuid input accepts the other 32 characters only as hex digits, and the round trip through
  -- uuid's canonical lowercase text rejects upper case. Any other key yields no row.
  EXECUTE $q$
    SELECT array_agg(v.id) FILTER (WHERE v.kind = 'lead'), array_agg(v.id) FILTER (WHERE v.kind = 'client')
      FROM (SELECT DISTINCT d.kind, CASE WHEN pg_input_is_valid(d.part, 'uuid') AND d.part::uuid::text = d.part
                                          THEN d.part::uuid END AS id
              FROM (SELECT CASE WHEN u.key LIKE 'lead:________-____-____-____-____________' THEN 'lead'
                                WHEN u.key LIKE 'client:________-____-____-____-____________' THEN 'client' END AS kind,
                           CASE WHEN u.key LIKE 'lead:%' THEN substr(u.key, 6) ELSE substr(u.key, 8) END AS part
                      FROM unnest($1) AS u(key)) d
             WHERE d.kind IS NOT NULL) v
     WHERE v.id IS NOT NULL
  $q$ INTO v_leads, v_clients USING p_identity_keys;
  -- Each identity's state by id; its key is rebuilt in the canonical form it was given in.
  RETURN QUERY
    SELECT s.identity_kind || ':' || s.identity_id::text, s.state_code, s.reason, s.basis, s.last_state_change_at
      FROM private.report_v3_identity_states_by_id(p_org, v_leads, v_clients) s;
END
$$;

-- The private lineage index (D5 §3.8): S3's lineage lookups, and D3's, read by (organization, original lead).
CREATE INDEX IF NOT EXISTS report_v3_lineage_original_lead ON private.dialer_conversion_lineage (organization_id, original_lead_id);

REVOKE ALL ON FUNCTION private.report_v3_state_classify(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_identity_states_by_id(uuid, uuid[], uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_identity_states(uuid, text[]) FROM PUBLIC, anon, authenticated, service_role;

DO $postcondition$
DECLARE f record; r text; n int := 0;
BEGIN
  FOR f IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig, p.proowner, p.provolatile, p.proparallel, l.lanname
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
            WHERE n.nspname = 'private'
              AND p.proname IN ('report_v3_state_classify', 'report_v3_identity_states', 'report_v3_identity_states_by_id') LOOP
    n := n + 1;
    IF f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'] OR f.proowner <> 'postgres'::regrole
       OR f.lanname <> (CASE f.proname WHEN 'report_v3_state_classify' THEN 'sql' ELSE 'plpgsql' END)
       OR (f.proname = 'report_v3_state_classify' AND (f.provolatile <> 'i' OR f.proparallel <> 's'
           OR f.oid IS DISTINCT FROM to_regprocedure('private.report_v3_state_classify(text)')))
       OR (f.proname = 'report_v3_identity_states' AND (f.provolatile <> 's'
           OR f.oid IS DISTINCT FROM to_regprocedure('private.report_v3_identity_states(uuid,text[])')))
       OR (f.proname = 'report_v3_identity_states_by_id' AND (f.provolatile <> 's' OR f.proparallel <> 'r'
           OR f.oid IS DISTINCT FROM to_regprocedure('private.report_v3_identity_states_by_id(uuid,uuid[],uuid[])'))) THEN
      RAISE EXCEPTION 'Reports v3 state helpers: helper metadata mismatch: %', f.oid::regprocedure;
    END IF;
    FOREACH r IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(r, f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Reports v3 state helpers: % can execute %', r, f.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
  IF n <> 3 THEN
    RAISE EXCEPTION 'Reports v3 state helpers: expected 3 helpers, found %', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('private.report_v3_lineage_original_lead')
                   AND i.indisvalid AND i.indisready AND pg_get_indexdef(i.indexrelid)
                     = 'CREATE INDEX report_v3_lineage_original_lead ON private.dialer_conversion_lineage USING btree (organization_id, original_lead_id)') THEN
    RAISE EXCEPTION 'Reports v3 state helpers: lineage index mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.normalize_us_state(text)'::regprocedure
                   AND md5(prosrc) = 'c80ff9ad87445693d84d0276c872ba83' AND provolatile = 'i' AND NOT prosecdef
                   AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']
                   AND coalesce(proacl::text, '') || '|' || pg_get_userbyid(proowner) = current_setting('reports_v3.normalizer_acl')) THEN
    RAISE EXCEPTION 'Reports v3 state helpers: normalize_us_state changed';
  END IF;
  IF (SELECT bool_and(c.relrowsecurity) FROM pg_class c
       WHERE c.oid IN ('private.dialer_conversion_lineage'::regclass, 'public.contact_history_events'::regclass)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Reports v3 state helpers: RLS must stay on for the lineage and history tables';
  END IF;
END $postcondition$;
