-- =====================================================================================================
-- Reports V2, PKG-A file 5 of 8: regional state helpers (plan §2.6, §2.7, §2.9 E4; D5 §3.1–§3.3, §3.8).
--
-- PLACEHOLDER VERSION. Renumbered above the then-current production head, order kept, in a
-- filename-only commit before the PKG-A backend merge. Branch work only: not applied to production.
--
-- Privilege class C (plan §2.8): two private helpers, each created sealed, and one private index built
-- transactionally (allowed only for private tables, §2.7). No privilege is added, no RLS setting or policy
-- changes and no data is written. public.normalize_us_state is used unchanged and is never altered,
-- replaced or re-granted. Runs after …10 to …13.
--
--   report_v3_state_classify     raw text -> one of the 51 supported jurisdictions (50 states and DC), or a
--                                reason: missing_state, unsupported_geography or invalid_state
--   report_v3_identity_states    each D3 identity's recorded state: its same-org lead/client records first,
--                                then (only when those are all blank) a campaign-membership copy; two or more
--                                distinct codes are an explicit source_conflict
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
              WHERE n.nspname = 'private' AND p.proname IN ('report_v3_state_classify', 'report_v3_identity_states')) THEN
    RAISE EXCEPTION 'Reports v3 state helpers: refusing replay; state helpers already exist';
  END IF;
  IF to_regprocedure('private.report_v3_client_identity_key(uuid,uuid)') IS NULL
     OR to_regprocedure('private.report_v3_contact_identity(uuid,uuid[],uuid[])') IS NULL
     OR to_regprocedure('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 state helpers: the call and journey helpers (…12) and the appointment stub (…13) must be applied first';
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
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_identity_states(p_org uuid, p_identity_keys text[])
RETURNS TABLE (identity_key text, state_code text, reason text, basis text, last_state_change_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH keys AS (
    SELECT DISTINCT k.key, split_part(k.key, ':', 1) AS kind,
           CASE WHEN k.key ~ '^(lead|client):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN split_part(k.key, ':', 2)::uuid END AS id
      FROM unnest(p_identity_keys) AS k(key)
     WHERE p_org IS NOT NULL
       AND k.key ~ '^(lead|client):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), records AS (
    SELECT k.key, 'lead'::text AS contact_type, l.id AS contact_id, l.state AS raw_state
      FROM keys k JOIN public.leads l ON l.id = k.id AND l.organization_id = p_org
     WHERE k.kind = 'lead'
    UNION ALL
    SELECT k.key, 'client', c.id, c.state
      FROM keys k JOIN public.clients c ON c.lead_id = k.id AND c.organization_id = p_org
     WHERE k.kind = 'lead'
    UNION ALL
    SELECT k.key, 'client', c.id, c.state
      FROM keys k JOIN public.clients c ON c.id = k.id AND c.organization_id = p_org
     WHERE k.kind = 'client'
  ), record_votes AS (
    SELECT r.key, 'current_record'::text AS basis, s.state_code, s.reason,
           (s.reason IS DISTINCT FROM 'missing_state') AS recorded
      FROM records r CROSS JOIN LATERAL private.report_v3_state_classify(r.raw_state) s
  ), blank AS (
    SELECT k.key, k.kind, k.id FROM keys k
     WHERE EXISTS (SELECT 1 FROM record_votes v WHERE v.key = k.key)
       AND NOT EXISTS (SELECT 1 FROM record_votes v WHERE v.key = k.key AND v.recorded)
  ), copies AS (
    SELECT b.key, cl.id AS campaign_lead_id, cl.state AS raw_state
      FROM blank b JOIN public.campaign_leads cl ON cl.lead_id = b.id AND cl.organization_id = p_org
     WHERE b.kind = 'lead'
    UNION
    SELECT b.key, cl.id, cl.state
      FROM blank b
      JOIN private.dialer_conversion_lineage lin ON lin.original_lead_id = b.id AND lin.organization_id = p_org
      JOIN public.campaign_leads cl ON cl.id = lin.campaign_lead_id AND cl.organization_id = p_org
     WHERE b.kind = 'lead'
    UNION
    SELECT b.key, cl.id, cl.state
      FROM blank b
      JOIN records r ON r.key = b.key
      JOIN public.calls ca ON ca.contact_id IN (r.contact_id, b.id) AND ca.organization_id = p_org
      JOIN public.campaign_leads cl ON cl.id = ca.campaign_lead_id AND cl.organization_id = p_org
  ), votes AS (
    SELECT v.key, v.basis, v.state_code, v.reason, v.recorded FROM record_votes v
    UNION ALL
    SELECT c.key, 'campaign_copy', s.state_code, s.reason, (s.reason IS DISTINCT FROM 'missing_state')
      FROM copies c CROSS JOIN LATERAL private.report_v3_state_classify(c.raw_state) s
  ), decided AS (
    SELECT DISTINCT ON (v.key) v.key, v.basis
      FROM votes v WHERE v.recorded
     ORDER BY v.key, v.basis = 'campaign_copy'
  ), outcome AS (
    SELECT d.key, d.basis, count(DISTINCT v.state_code) AS valid_codes, min(v.state_code) AS code,
           bool_or(v.reason = 'unsupported_geography') AS unsupported
      FROM decided d JOIN votes v ON v.key = d.key AND v.basis = d.basis
     GROUP BY d.key, d.basis
  ), history AS (
    SELECT h.key, max(e.recorded_at) AS last_state_change_at
      FROM (SELECT k.key, k.kind AS contact_type, k.id AS contact_id FROM keys k
            UNION
            SELECT r.key, r.contact_type, r.contact_id FROM records r) h
      JOIN public.contact_history_events e
        ON e.contact_id = h.contact_id AND e.contact_type = h.contact_type AND e.organization_id = p_org
       AND 'state' = ANY (e.changed_fields)
     GROUP BY h.key
  )
  SELECT k.key,
         CASE WHEN o.valid_codes = 1 THEN o.code END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM records r WHERE r.key = k.key) THEN 'unresolved_identity'
              WHEN o.key IS NULL THEN 'missing_state'
              WHEN o.valid_codes = 1 THEN NULL
              WHEN o.valid_codes > 1 THEN 'source_conflict'
              WHEN o.unsupported THEN 'unsupported_geography'
              ELSE 'invalid_state' END,
         o.basis,
         h.last_state_change_at
    FROM keys k
    LEFT JOIN outcome o ON o.key = k.key
    LEFT JOIN history h ON h.key = k.key;
$$;

-- The private lineage index (D5 §3.8): S3's lineage lookups, and D3's, read by (organization, original lead).
CREATE INDEX IF NOT EXISTS report_v3_lineage_original_lead ON private.dialer_conversion_lineage (organization_id, original_lead_id);

REVOKE ALL ON FUNCTION private.report_v3_state_classify(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_identity_states(uuid, text[]) FROM PUBLIC, anon, authenticated, service_role;

DO $postcondition$
DECLARE f record; r text; n int := 0;
BEGIN
  FOR f IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig, p.proowner, p.provolatile, p.proparallel, l.lanname
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
            WHERE n.nspname = 'private' AND p.proname IN ('report_v3_state_classify', 'report_v3_identity_states') LOOP
    n := n + 1;
    IF f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'] OR f.proowner <> 'postgres'::regrole
       OR f.lanname <> 'sql'
       OR (f.proname = 'report_v3_state_classify' AND (f.provolatile <> 'i' OR f.proparallel <> 's'
           OR f.oid IS DISTINCT FROM to_regprocedure('private.report_v3_state_classify(text)')))
       OR (f.proname = 'report_v3_identity_states' AND (f.provolatile <> 's'
           OR f.oid IS DISTINCT FROM to_regprocedure('private.report_v3_identity_states(uuid,text[])'))) THEN
      RAISE EXCEPTION 'Reports v3 state helpers: helper metadata mismatch: %', f.oid::regprocedure;
    END IF;
    FOREACH r IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(r, f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Reports v3 state helpers: % can execute %', r, f.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
  IF n <> 2 THEN
    RAISE EXCEPTION 'Reports v3 state helpers: expected 2 helpers, found %', n;
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
