-- =====================================================================================================
-- Reports V2, PKG-A file 1 of 8: the v3 contract foundation (plan §2.2–§2.6; binding condition BC4).
--
-- PLACEHOLDER VERSION. Renumbered above the then-current production head, order kept, in a
-- filename-only commit before the PKG-A backend merge. Branch work only: not applied to production.
--
-- Privilege class C (plan §2.8): creates private helpers only, each created sealed (REVOKE ALL from
-- PUBLIC, anon, authenticated and service_role). No privilege is added. No data is read or written.
--
-- Contents:
--   registries      report_v3_reason_codes, report_v3_reason_kind, report_v3_metric_registry,
--                   report_v3_kpi_codes, report_v3_kpi_ids, report_v3_basis_flags (3.0.0 stub)
--   window          report_v3_sold_window
--   payload meta    report_v3_envelope (report_meta verbatim plus v3 markers and basis flags)
--   KPI envelopes   report_v3_metric (validator; P0001 on any rule violation)
--                   report_v3_evaluate (the BC4 status truth table, evaluated in one place)
--                   report_v3_ratio, report_v3_rate, report_v3_total, report_v3_median (the builders
--                   readers use; status and reason always come from report_v3_evaluate)
-- =====================================================================================================
SET LOCAL lock_timeout = '2s';

-- Preflight: refuse replay, and require the exact v2 readers and closure helpers this contract builds on.
DO $preflight$
DECLARE f record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'private' AND p.proname LIKE 'report\_v3\_%') THEN
    RAISE EXCEPTION 'Reports v3 foundation: refusing replay; v3 helpers already exist';
  END IF;
  FOR f IN SELECT * FROM (VALUES
    -- The 15 v2 pins (supabase/ops/reports_integrity_enable.sql).
    ('private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])', '245c7ce4f7bf47f6347595822f70a947', false, 's'),
    ('private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[])', '3d33b720751a1913c81ad284ae6ffd43', true, 's'),
    ('private.report_call_facts(uuid,timestamptz,timestamptz,uuid[])', 'bacbfd0629221957cae28ba28728c8bd', true, 's'),
    ('public.get_report_call_summary(date,date,uuid)', '34cdfab92f6acaa5a383c743088c1720', true, 's'),
    ('private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])', 'c1355d551fba0cc2217150f5531d1b31', false, 's'),
    ('private.report_access_v2(text,uuid)', 'a221335ae305cee01097bc796d5e7cdd', true, 's'),
    ('private.report_monthly_amount(text)', '405647c4982f4b9475f834efa6f2beee', false, 'i'),
    ('private.report_policy_value_facts(uuid,uuid[])', 'f543eeb4ee5aa7906e3225527d873935', false, 's'),
    ('private.report_premium_totals(bigint,bigint,numeric,bigint,bigint,bigint)', '31dcd20548aea901f074a5fd9526518c', false, 'i'),
    ('public.get_report_scope_v2(text)', '26a2d64831975668a492dfda2e369aac', true, 's'),
    ('public.get_report_call_summary_v2(date,date,uuid,text)', '23c21fa14b07edaeaa3901e76b243d66', true, 's'),
    ('public.get_report_call_volume_v2(date,date,uuid,text)', 'a4a5e82f36e124fa8ee9d581229ef455', true, 's'),
    ('public.get_report_disposition_breakdown_v2(date,date,uuid,text)', 'ae4611201b9add696bfd92f4576fdd7b', true, 's'),
    ('public.get_report_campaign_performance_v2(date,date,uuid,text)', '8d8bee228b2bed67076e2547f506264d', true, 's'),
    ('public.get_report_lead_source_performance_v2(date,date,uuid,text)', '8d85fff93300966502964b500eb46166', true, 's'),
    -- The 12 closure helpers v3 reuses (plan D1 §5).
    ('private.report_window(uuid,date,date)', '1107da185bfc1a3089b27e125c74646d', true, 's'),
    ('private.report_meta(text,uuid,text,text,date,date,timestamptz,timestamptz)', '6faa38495ac0bbd2d837c4c959cada25', false, 's'),
    ('private.report_agent_name(text,text)', '23d45e5c19d951d0d663c629ed85c945', false, 's'),
    ('private.report_visible_campaigns(uuid)', '1e37cb4b2b2a0696e129523b096a400f', false, 's'),
    ('private.report_policy_quality(uuid,uuid[])', 'cb7596ab38f91c765f869cccebf8a4ee', false, 's'),
    ('private.report_policy_facts(uuid,uuid[])', 'c902d5d2906d42dd85adb34dd524b9a7', false, 's'),
    ('private.report_policy_campaign_lineage(uuid,uuid[])', 'b99cd74ed7ab519a2ec180160e8cdfd5', false, 's'),
    ('private.report_agency_time_zone(uuid)', '27feaed00c03895fce8bfd6b2cd24207', true, 's'),
    ('private.report_permission_flags(uuid,text)', 'ba6abec7565525217b61f1a342123b65', true, 's'),
    ('private.campaign_actor()', '16cca1989b7648593f90244786d60958', true, 's'),
    ('private.resolve_downline_ids(uuid,uuid)', '4f760d7bc7bef6231176b3624ffd00b8', true, 's'),
    ('private.profile_parse_iso_date(text)', 'be24ed08bb42a71b29e3c44abebfd0c9', false, 'i')
  ) AS expected(signature, body_md5, is_definer, volatility) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(f.signature)
                     AND md5(prosrc) = f.body_md5 AND proowner = 'postgres'::regrole AND prosecdef = f.is_definer
                     AND provolatile::text = f.volatility AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION 'Reports v3 foundation: v2 or closure preimage drift: %', f.signature;
    END IF;
  END LOOP;
END $preflight$;

-- -----------------------------------------------------------------------------------------------------
-- Registries
-- -----------------------------------------------------------------------------------------------------

-- The closed reason registry (plan §2.3). Array order is the precedence order: 5 config codes, 9 zero
-- codes, 14 coverage codes, then the export-only CSV row status.
CREATE FUNCTION private.report_v3_reason_codes()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT ARRAY[
    'evidence_not_captured', 'sale_call_link_not_captured', 'classification_not_configured',
    'outcome_capture_not_started', 'journey_scope_restricted',
    'no_policies_sold', 'no_calls_made', 'no_lead_calls', 'no_first_time_buyers', 'no_first_contacts',
    'no_due_sales_appointments', 'no_held_sales_appointments', 'no_attributed_policies', 'premium_not_entered',
    'capture_gap', 'outcome_capture_partial_period', 'appointment_type_unclassified', 'outcomes_unresolved',
    'attribution_unresolved', 'legacy_booking_basis', 'attempt_unverified', 'unlinked_contacted_calls',
    'unlinked_calls_excluded', 'history_incomplete', 'lead_receipt_unknown', 'sale_call_link_missing',
    'premium_invalid', 'premium_missing',
    'panel_not_loaded']::text[];
$$;

CREATE FUNCTION private.report_v3_reason_kind(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN u.o <= 5 THEN 'config' WHEN u.o <= 14 THEN 'zero' WHEN u.o <= 28 THEN 'coverage' ELSE 'export' END
    FROM unnest(private.report_v3_reason_codes()) WITH ORDINALITY AS u(c, o)
   WHERE u.c = p_code;
$$;

-- The metric and unit registry (plan §2.4): exactly 23 KPIs. src/lib/reports-kpi-registry.ts (PKG-F)
-- must equal this, field for field (reportsV3MetricRegistry.test.ts).
--   unit     currency | count | calls | people | percent | ratio | days | bookings | appointments | attempts | duration
--   kind     sum | count | distinct_count | ratio | rate | median
--   display  premium (formatPremium) | integer | 1dp | 1dp_drop_zero | elapsed (formatElapsed)
--   csv      2dp | integer | 1dp | integer_seconds
CREATE FUNCTION private.report_v3_metric_registry()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT $registry$[
 {"id":1,"label":"Annual premium (AP)","reader":"summary","unit":"currency","kind":"sum","eligible_population":"policies_sold","cohort_30d":false,"credit":"original_seller","date_basis":"sold_date","display":"premium","csv":"2dp"},
 {"id":2,"label":"Policies sold","reader":"summary","unit":"count","kind":"count","eligible_population":null,"cohort_30d":false,"credit":"original_seller","date_basis":"sold_date","display":"integer","csv":"integer"},
 {"id":3,"label":"Clients who purchased","reader":"summary","unit":"count","kind":"distinct_count","eligible_population":null,"cohort_30d":false,"credit":"original_seller","date_basis":"sold_date","display":"integer","csv":"integer"},
 {"id":4,"label":"Average AP per policy","reader":"summary","unit":"currency","kind":"ratio","eligible_population":"policies_sold","cohort_30d":false,"credit":"original_seller","date_basis":"sold_date","display":"premium","csv":"2dp"},
 {"id":5,"label":"Calls made","reader":"summary","unit":"calls","kind":"count","eligible_population":"attempt_and_unverified_rows","cohort_30d":false,"credit":"placing_agent","date_basis":"call_created_at","display":"integer","csv":"integer"},
 {"id":6,"label":"Contacted calls","reader":"summary","unit":"calls","kind":"count","eligible_population":null,"cohort_30d":false,"credit":"placing_agent","date_basis":"call_created_at","display":"integer","csv":"integer"},
 {"id":7,"label":"Unique prospects reached","reader":"summary","unit":"people","kind":"distinct_count","eligible_population":"contacted_calls_excluding_recruits","cohort_30d":false,"credit":"placing_agent","date_basis":"call_created_at","display":"integer","csv":"integer"},
 {"id":8,"label":"Call contact rate","reader":"summary","unit":"percent","kind":"rate","eligible_population":"attempt_and_unverified_rows","cohort_30d":false,"credit":"placing_agent","date_basis":"call_created_at","display":"1dp","csv":"1dp"},
 {"id":9,"label":"Calls per policy","reader":"summary","unit":"ratio","kind":"ratio","eligible_population":"attempt_and_unverified_rows","cohort_30d":false,"credit":"placing_agent_and_original_seller","date_basis":"call_created_at_and_sold_date","display":"1dp","csv":"2dp"},
 {"id":10,"label":"Contacted calls per policy","reader":"summary","unit":"ratio","kind":"ratio","eligible_population":null,"cohort_30d":false,"credit":"placing_agent_and_original_seller","date_basis":"call_created_at_and_sold_date","display":"1dp","csv":"2dp"},
 {"id":11,"label":"Prospects reached per policy","reader":"summary","unit":"ratio","kind":"ratio","eligible_population":"contacted_calls_excluding_recruits","cohort_30d":false,"credit":"placing_agent_and_original_seller","date_basis":"call_created_at_and_sold_date","display":"1dp","csv":"2dp"},
 {"id":12,"label":"Sales appointments per policy","reader":"sales_appointments","unit":"ratio","kind":"ratio","eligible_population":"held_group_members","cohort_30d":true,"credit":"assigned_agent_at_start","date_basis":"occurrence_date","display":"1dp","csv":"2dp"},
 {"id":14,"label":"Days to first sale","reader":"journey","unit":"days","kind":"median","eligible_population":"first_time_buyers_in_period","cohort_30d":false,"credit":"original_seller","date_basis":"first_sale_date","display":"1dp_drop_zero","csv":"1dp"},
 {"id":15,"label":"Sales appointments booked","reader":"sales_appointments","unit":"bookings","kind":"count","eligible_population":"bookings_in_period","cohort_30d":false,"credit":"setter","date_basis":"booking_created_at","display":"integer","csv":"integer"},
 {"id":16,"label":"Sales appointments completed","reader":"sales_appointments","unit":"appointments","kind":"count","eligible_population":"due_occurrences","cohort_30d":false,"credit":"assigned_agent_at_start","date_basis":"occurrence_date","display":"integer","csv":"integer"},
 {"id":17,"label":"Appointment show rate","reader":"sales_appointments","unit":"percent","kind":"rate","eligible_population":"due_occurrences","cohort_30d":false,"credit":"assigned_agent_at_start","date_basis":"occurrence_date","display":"1dp","csv":"1dp"},
 {"id":18,"label":"Appointment close rate","reader":"sales_appointments","unit":"percent","kind":"rate","eligible_population":"held_group_members","cohort_30d":true,"credit":"assigned_agent_at_start","date_basis":"occurrence_date","display":"1dp","csv":"1dp"},
 {"id":19,"label":"Contact-to-sale rate","reader":"journey","unit":"percent","kind":"rate","eligible_population":"first_contacts_in_period","cohort_30d":true,"credit":"first_contact_agent","date_basis":"first_contact_date","display":"1dp","csv":"1dp"},
 {"id":21,"label":"Calls to first contact","reader":"journey","unit":"attempts","kind":"median","eligible_population":"first_contacts_in_period","cohort_30d":false,"credit":"first_contact_agent","date_basis":"first_contact_date","display":"1dp_drop_zero","csv":"1dp"},
 {"id":24,"label":"Total talk time","reader":"summary","unit":"duration","kind":"sum","eligible_population":null,"cohort_30d":false,"credit":"placing_agent","date_basis":"call_created_at","display":"elapsed","csv":"integer_seconds"},
 {"id":25,"label":"Time in dialer","reader":"summary","unit":"duration","kind":"sum","eligible_population":null,"cohort_30d":false,"credit":"session_agent","date_basis":"session_interval","display":"elapsed","csv":"integer_seconds"},
 {"id":34,"label":"Calls per lead","reader":"summary","unit":"ratio","kind":"ratio","eligible_population":"lead_stage_attempt_and_unverified_rows","cohort_30d":false,"credit":"placing_agent","date_basis":"call_created_at","display":"1dp","csv":"2dp"},
 {"id":38,"label":"1 Call Close","reader":"journey","unit":"percent","kind":"rate","eligible_population":"first_time_buyers_in_period","cohort_30d":false,"credit":"original_seller","date_basis":"first_sale_date","display":"1dp","csv":"1dp"}
]$registry$::jsonb;
$$;

-- Applicable codes per KPI (plan §2.2 status truth table). Coverage codes carry the side their unknown
-- items sit on: N (numerator, count or sum), D (denominator), ND (both: candidates that could add to the
-- population and its outcome), W (window-level condition: counted in coverage.reasons, never in
-- coverage.unassessable). Config and zero codes are listed in registry order.
CREATE FUNCTION private.report_v3_kpi_codes()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT $codes${
 "1":{"config":[],"zero":["premium_not_entered"],"coverage":{"premium_invalid":"N","premium_missing":"N"}},
 "2":{"config":[],"zero":[],"coverage":{}},
 "3":{"config":[],"zero":[],"coverage":{}},
 "4":{"config":[],"zero":["no_policies_sold","premium_not_entered"],"coverage":{"premium_invalid":"D","premium_missing":"D"}},
 "5":{"config":[],"zero":[],"coverage":{"attempt_unverified":"N"}},
 "6":{"config":[],"zero":[],"coverage":{}},
 "7":{"config":[],"zero":[],"coverage":{"unlinked_contacted_calls":"N"}},
 "8":{"config":[],"zero":["no_calls_made"],"coverage":{"attempt_unverified":"D"}},
 "9":{"config":[],"zero":["no_policies_sold"],"coverage":{"attempt_unverified":"N"}},
 "10":{"config":[],"zero":["no_policies_sold"],"coverage":{}},
 "11":{"config":[],"zero":["no_policies_sold"],"coverage":{"unlinked_contacted_calls":"N"}},
 "12":{"config":["evidence_not_captured","classification_not_configured","outcome_capture_not_started","journey_scope_restricted"],
       "zero":["no_held_sales_appointments","no_attributed_policies"],
       "coverage":{"capture_gap":"ND","outcome_capture_partial_period":"W","appointment_type_unclassified":"ND","attribution_unresolved":"D"}},
 "14":{"config":["journey_scope_restricted"],"zero":["no_first_time_buyers"],"coverage":{"history_incomplete":"D","lead_receipt_unknown":"D"}},
 "15":{"config":["evidence_not_captured","classification_not_configured"],"zero":[],
       "coverage":{"capture_gap":"W","appointment_type_unclassified":"N","legacy_booking_basis":"W"}},
 "16":{"config":["evidence_not_captured","classification_not_configured","outcome_capture_not_started"],"zero":[],
       "coverage":{"capture_gap":"N","outcome_capture_partial_period":"W","appointment_type_unclassified":"N","outcomes_unresolved":"N"}},
 "17":{"config":["evidence_not_captured","classification_not_configured","outcome_capture_not_started"],"zero":["no_due_sales_appointments"],
       "coverage":{"capture_gap":"D","outcome_capture_partial_period":"W","appointment_type_unclassified":"D","outcomes_unresolved":"D"}},
 "18":{"config":["evidence_not_captured","classification_not_configured","outcome_capture_not_started","journey_scope_restricted"],
       "zero":["no_held_sales_appointments"],
       "coverage":{"capture_gap":"D","outcome_capture_partial_period":"W","appointment_type_unclassified":"D","attribution_unresolved":"D"}},
 "19":{"config":["journey_scope_restricted"],"zero":["no_first_contacts"],"coverage":{"history_incomplete":"D","lead_receipt_unknown":"D"}},
 "21":{"config":["journey_scope_restricted"],"zero":["no_first_contacts"],
       "coverage":{"attempt_unverified":"D","history_incomplete":"D","lead_receipt_unknown":"D"}},
 "24":{"config":[],"zero":[],"coverage":{}},
 "25":{"config":[],"zero":[],"coverage":{}},
 "34":{"config":[],"zero":["no_lead_calls"],"coverage":{"attempt_unverified":"ND","unlinked_calls_excluded":"D"}},
 "38":{"config":["sale_call_link_not_captured","journey_scope_restricted"],"zero":["no_first_time_buyers"],
       "coverage":{"history_incomplete":"D","sale_call_link_missing":"D"}}
}$codes$::jsonb;
$$;

-- KPI ids per reader, in payload order (plan §2.1). Empty for the scope, state and four call readers.
CREATE FUNCTION private.report_v3_kpi_ids(p_reader text)
RETURNS int[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  CASE p_reader
    WHEN 'summary' THEN RETURN ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 24, 25, 34];
    WHEN 'journey' THEN RETURN ARRAY[14, 19, 21, 38];
    WHEN 'sales_appointments' THEN RETURN ARRAY[12, 15, 16, 17, 18];
    WHEN 'scope', 'state_breakdown', 'call_volume', 'disposition_breakdown', 'campaign_calls', 'lead_source_calls' THEN
      RETURN '{}'::int[];
    ELSE
      RAISE EXCEPTION 'reports v3: unknown reader %', coalesce(p_reader, 'NULL') USING ERRCODE = 'P0001';
  END CASE;
END $$;

-- PKG-A stub. Each later package replaces it under its own preimage guard (3.1.0, then 3.2.0 and 3.3.0).
CREATE FUNCTION private.report_v3_basis_flags()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT '{"contract_version":"3.0.0","corrections":"not_installed","sale_call_links":"not_installed","appointment_evidence":"not_installed"}'::jsonb;
$$;

-- -----------------------------------------------------------------------------------------------------
-- Window
-- -----------------------------------------------------------------------------------------------------

-- Half-open Sold Date window (p_start, least(p_end, agency today) + 1): a future Sold Date counts once its
-- date arrives. Summary, journey and state readers use it.
CREATE FUNCTION private.report_v3_sold_window(p_start date, p_end date, p_agency_today date)
RETURNS TABLE (sold_from date, sold_until date)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_agency_today IS NULL THEN
    RAISE EXCEPTION 'reports v3: the sold window needs all three dates' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT p_start, least(p_end, p_agency_today) + 1;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- Payload meta (plan §2.1; D1 §3.2)
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_envelope(p_reader text, p_scope text, p_requested_scope text, p_filter_agent uuid,
                                           p_time_zone text, p_time_zone_source text, p_start_date date, p_end_date date,
                                           p_start_at timestamptz, p_end_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_flags jsonb := private.report_v3_basis_flags();
  v_today date;
  v_out jsonb;
BEGIN
  IF p_reader IS NULL OR NOT p_reader = ANY (ARRAY['scope', 'summary', 'journey', 'sales_appointments', 'state_breakdown',
                                                   'call_volume', 'disposition_breakdown', 'campaign_calls', 'lead_source_calls']) THEN
    RAISE EXCEPTION 'reports v3 envelope: unknown reader %', coalesce(p_reader, 'NULL') USING ERRCODE = 'P0001';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('own', 'team', 'organization') THEN
    RAISE EXCEPTION 'reports v3 envelope: invalid scope %', coalesce(p_scope, 'NULL') USING ERRCODE = 'P0001';
  END IF;
  IF p_requested_scope IS NULL OR p_requested_scope NOT IN ('personal', 'team', 'agency') THEN
    RAISE EXCEPTION 'reports v3 envelope: invalid requested scope %', coalesce(p_requested_scope, 'NULL') USING ERRCODE = 'P0001';
  END IF;

  v_out := jsonb_build_object(
    'basis_version', 'reports_v3',
    'contract_version', v_flags -> 'contract_version',
    'reader', p_reader,
    'scope', p_scope,
    'requested_scope', p_requested_scope,
    'filter_agent_id', p_filter_agent,
    'as_of', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'basis', jsonb_build_object('corrections', v_flags -> 'corrections',
                                'sale_call_links', v_flags -> 'sale_call_links',
                                'appointment_evidence', v_flags -> 'appointment_evidence'));
  IF p_reader = 'scope' THEN
    RETURN v_out;  -- the scope gate has no window and no metrics
  END IF;

  IF p_time_zone IS NULL OR p_time_zone_source IS NULL OR p_start_date IS NULL OR p_end_date IS NULL
     OR p_start_at IS NULL OR p_end_at IS NULL THEN
    RAISE EXCEPTION 'reports v3 envelope: a windowed reader needs its window' USING ERRCODE = 'P0001';
  END IF;
  v_today := (now() AT TIME ZONE p_time_zone)::date;
  v_out := v_out || jsonb_build_object(
    'window', private.report_meta(p_scope, p_filter_agent, p_time_zone, p_time_zone_source,
                                  p_start_date, p_end_date, p_start_at, p_end_at) -> 'window',
    'agency_today', to_char(v_today, 'YYYY-MM-DD'),
    'period_open', p_end_date >= v_today);
  IF p_reader IN ('summary', 'journey', 'state_breakdown') THEN
    v_out := v_out || jsonb_build_object('policy_basis', jsonb_build_object(
      'source', 'original_policy_sales', 'credit', 'original_seller', 'date', 'sold_date',
      'premium', 'effective_sale_monthly_x12'));
  END IF;
  RETURN v_out;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- KPI envelope validator (plan §2.2 rules 1–11 and the BC4 truth table). Every envelope a reader returns
-- passes through here; any violation raises P0001 and fails only that panel, closed. Readers do not call
-- it directly: they use the builders below, so status and reason always come from report_v3_evaluate.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_metric(p_id int, p_status text, p_value numeric, p_numerator numeric,
                                         p_denominator numeric, p_coverage jsonb, p_maturity jsonb, p_reason text,
                                         p_detail jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reg jsonb;
  v_codes jsonb;
  v_kind text;
  v_unit text;
  v_has_den boolean;
  v_cohort boolean;
  v_rkind text;
  v_first text;
  v_n_unknown numeric := 0;
  v_d_unknown numeric := 0;
  v_any_count boolean := false;
  v_n_known numeric;
  v_key text;
  v_val jsonb;
  v_side text;
  v_members numeric;
  v_pending numeric;
  v_successes numeric;
  v_mature_members numeric;
  v_mature_successes numeric;
  v_needs_maturity boolean := false;
  v_forbids_maturity boolean := false;
  -- an exact non-negative integer held in a jsonb number
  c_int constant text := '^[0-9]+$';
BEGIN
  SELECT r INTO v_reg FROM jsonb_array_elements(private.report_v3_metric_registry()) r WHERE (r ->> 'id')::int = p_id;
  v_codes := private.report_v3_kpi_codes() -> p_id::text;
  IF v_reg IS NULL OR v_codes IS NULL THEN
    RAISE EXCEPTION 'reports v3 metric %: unknown KPI', p_id USING ERRCODE = 'P0001';
  END IF;
  v_kind := v_reg ->> 'kind';
  v_unit := v_reg ->> 'unit';
  v_has_den := v_kind IN ('ratio', 'rate', 'median');
  v_cohort := (v_reg ->> 'cohort_30d')::boolean;

  IF p_status IS NULL OR p_status NOT IN ('available', 'partial', 'unavailable') THEN
    RAISE EXCEPTION 'reports v3 metric %: invalid status %', p_id, coalesce(p_status, 'NULL') USING ERRCODE = 'P0001';
  END IF;
  IF p_detail IS NOT NULL AND jsonb_typeof(p_detail) <> 'object' THEN
    RAISE EXCEPTION 'reports v3 metric %: detail must be an object or null', p_id USING ERRCODE = 'P0001';
  END IF;

  -- Coverage shape (rule 9): exact keys, exact non-negative integers, applicable reasons only.
  IF p_coverage IS NOT NULL THEN
    IF jsonb_typeof(p_coverage) <> 'object'
       OR (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(p_coverage) k)
          IS DISTINCT FROM ARRAY['assessable', 'eligible', 'reasons', 'unassessable']
       OR jsonb_typeof(p_coverage -> 'reasons') <> 'object' THEN
      RAISE EXCEPTION 'reports v3 metric %: coverage keys must be eligible, assessable, unassessable and reasons', p_id
        USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_typeof(p_coverage -> 'eligible') <> 'number' OR (p_coverage ->> 'eligible') !~ c_int
       OR jsonb_typeof(p_coverage -> 'assessable') <> 'number' OR (p_coverage ->> 'assessable') !~ c_int
       OR jsonb_typeof(p_coverage -> 'unassessable') <> 'number' OR (p_coverage ->> 'unassessable') !~ c_int THEN
      RAISE EXCEPTION 'reports v3 metric %: coverage counts must be non-negative integers', p_id USING ERRCODE = 'P0001';
    END IF;
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_coverage -> 'reasons') LOOP
      v_side := v_codes -> 'coverage' ->> v_key;
      IF v_side IS NULL THEN
        RAISE EXCEPTION 'reports v3 metric %: coverage reason % does not apply', p_id, v_key USING ERRCODE = 'P0001';
      END IF;
      IF jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}') !~ c_int THEN
        RAISE EXCEPTION 'reports v3 metric %: coverage counts must be non-negative integers', p_id USING ERRCODE = 'P0001';
      END IF;
      IF (v_val #>> '{}')::numeric > 0 THEN
        v_any_count := true;
        IF v_side IN ('N', 'ND') THEN v_n_unknown := v_n_unknown + (v_val #>> '{}')::numeric; END IF;
        IF v_side IN ('D', 'ND') THEN v_d_unknown := v_d_unknown + (v_val #>> '{}')::numeric; END IF;
      END IF;
    END LOOP;
    IF (p_coverage ->> 'assessable')::numeric + (p_coverage ->> 'unassessable')::numeric <> (p_coverage ->> 'eligible')::numeric THEN
      RAISE EXCEPTION 'reports v3 metric %: coverage must satisfy assessable + unassessable = eligible', p_id USING ERRCODE = 'P0001';
    END IF;
    SELECT u.c INTO v_first FROM unnest(private.report_v3_reason_codes()) WITH ORDINALITY AS u(c, o)
     WHERE coalesce((p_coverage -> 'reasons' ->> u.c)::numeric, 0) > 0 ORDER BY u.o LIMIT 1;
  END IF;

  -- The reason must be registered, applicable to this KPI and of a kind this KPI can use (rule 8).
  IF p_reason IS NOT NULL THEN
    v_rkind := private.report_v3_reason_kind(p_reason);
    IF v_rkind IS NULL OR v_rkind = 'export'
       OR (v_rkind = 'config' AND NOT (v_codes -> 'config') ? p_reason)
       OR (v_rkind = 'zero' AND NOT (v_codes -> 'zero') ? p_reason)
       OR (v_rkind = 'coverage' AND NOT (v_codes -> 'coverage') ? p_reason) THEN
      RAISE EXCEPTION 'reports v3 metric %: reason % does not apply', p_id, p_reason USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Status rules 2–4.
  IF p_status = 'unavailable' THEN
    IF p_value IS NOT NULL THEN
      RAISE EXCEPTION 'reports v3 metric %: unavailable requires a null value', p_id USING ERRCODE = 'P0001';
    END IF;
    IF p_reason IS NULL THEN
      RAISE EXCEPTION 'reports v3 metric %: unavailable requires a reason', p_id USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF p_value IS NULL THEN
      RAISE EXCEPTION 'reports v3 metric %: available and partial require a value', p_id USING ERRCODE = 'P0001';
    END IF;
    IF p_status = 'available' THEN
      IF p_reason IS NOT NULL THEN
        RAISE EXCEPTION 'reports v3 metric %: available requires a null reason', p_id USING ERRCODE = 'P0001';
      END IF;
      IF p_coverage IS NOT NULL AND ((p_coverage ->> 'unassessable')::numeric > 0 OR v_any_count) THEN
        RAISE EXCEPTION 'reports v3 metric %: available requires complete coverage', p_id USING ERRCODE = 'P0001';
      END IF;
    ELSE
      IF v_rkind IS DISTINCT FROM 'coverage' THEN
        RAISE EXCEPTION 'reports v3 metric %: partial requires a coverage reason', p_id USING ERRCODE = 'P0001';
      END IF;
      IF p_coverage IS NULL OR NOT ((p_coverage ->> 'unassessable')::numeric > 0 OR v_any_count) THEN
        RAISE EXCEPTION 'reports v3 metric %: partial requires unassessable items or a window-level condition', p_id
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- Rule 8: a coverage reason is the first applicable code in registry order.
  IF v_rkind = 'coverage' AND p_reason IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'reports v3 metric %: reason must be the first applicable code (%)', p_id, coalesce(v_first, 'none')
      USING ERRCODE = 'P0001';
  END IF;

  -- Unavailable: config, zero and coverage branches of the truth table.
  IF p_status = 'unavailable' THEN
    IF v_rkind = 'config' THEN
      IF p_maturity IS NOT NULL THEN
        RAISE EXCEPTION 'reports v3 metric %: no maturity block under a config reason', p_id USING ERRCODE = 'P0001';
      END IF;
      IF p_numerator IS NOT NULL OR p_denominator IS NOT NULL OR p_coverage IS NOT NULL THEN
        RAISE EXCEPTION 'reports v3 metric %: a config reason carries no numbers or coverage', p_id USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_rkind = 'zero' THEN
      IF p_reason = 'premium_not_entered' THEN
        IF p_coverage IS NULL OR (p_coverage ->> 'assessable')::numeric <> 0
           OR coalesce((p_coverage -> 'reasons' ->> 'premium_missing')::numeric, 0) = 0
           OR coalesce((p_coverage -> 'reasons' ->> 'premium_invalid')::numeric, 0) > 0
           OR coalesce(p_denominator, 0) <> 0 THEN
          RAISE EXCEPTION 'reports v3 metric %: premium_not_entered requires every unusable premium to be missing', p_id
            USING ERRCODE = 'P0001';
        END IF;
      ELSE
        IF v_has_den AND coalesce(p_denominator, 0) <> 0 THEN
          RAISE EXCEPTION 'reports v3 metric %: a zero code requires an empty denominator', p_id USING ERRCODE = 'P0001';
        END IF;
        IF v_d_unknown > 0 THEN
          RAISE EXCEPTION 'reports v3 metric %: a zero code requires nothing unassessable on the deciding side', p_id
            USING ERRCODE = 'P0001';
        END IF;
        IF p_reason = 'no_attributed_policies' AND coalesce(p_numerator, 0) = 0 THEN
          RAISE EXCEPTION 'reports v3 metric %: no_attributed_policies requires members', p_id USING ERRCODE = 'P0001';
        END IF;
        IF p_id = 12 AND p_reason = 'no_held_sales_appointments' AND coalesce(p_numerator, 0) <> 0 THEN
          RAISE EXCEPTION 'reports v3 metric %: no_held_sales_appointments requires no members', p_id USING ERRCODE = 'P0001';
        END IF;
      END IF;
    ELSE  -- coverage: the side that decides the value has no known items but has unknown ones (rule 2)
      IF NOT (
           (v_has_den AND coalesce(p_denominator, 0) = 0 AND v_d_unknown > 0)
        OR (v_kind IN ('ratio', 'rate') AND coalesce(p_denominator, 0) > 0 AND coalesce(p_numerator, 0) = 0 AND v_n_unknown > 0)
        OR (NOT v_has_den AND v_n_unknown > 0
            AND (p_id <> 1 OR (p_coverage ->> 'assessable')::numeric = 0))) THEN
        RAISE EXCEPTION 'reports v3 metric %: a coverage reason makes the value unavailable only when nothing on the deciding side is known', p_id
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  ELSE
    -- Available and partial values: exact transport (rule 10, §2.5).
    IF min_scale(p_value) > 6 THEN
      RAISE EXCEPTION 'reports v3 metric %: value scale exceeds 6', p_id USING ERRCODE = 'P0001';
    END IF;
    IF p_value < 0 THEN
      RAISE EXCEPTION 'reports v3 metric %: known parts must be non-negative', p_id USING ERRCODE = 'P0001';
    END IF;
    IF v_kind IN ('ratio', 'rate') THEN
      IF p_numerator IS NULL OR p_numerator < 0 OR p_denominator IS NULL OR p_denominator <= 0 THEN
        RAISE EXCEPTION 'reports v3 metric %: a ratio needs an exact numerator and a positive denominator', p_id USING ERRCODE = 'P0001';
      END IF;
      IF min_scale(p_denominator) > 0 OR min_scale(p_numerator) > (CASE WHEN v_unit = 'currency' THEN 2 ELSE 0 END) THEN
        RAISE EXCEPTION 'reports v3 metric %: numerator and denominator must be exact', p_id USING ERRCODE = 'P0001';
      END IF;
      IF v_kind = 'rate' AND p_value <> round(100 * p_numerator / p_denominator, 6) THEN
        RAISE EXCEPTION 'reports v3 metric %: value must equal 100 * numerator / denominator', p_id USING ERRCODE = 'P0001';
      END IF;
      IF v_kind = 'ratio' AND p_value <> round(p_numerator / p_denominator, 6) THEN
        RAISE EXCEPTION 'reports v3 metric %: value must equal numerator / denominator', p_id USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_kind = 'median' THEN
      IF p_numerator IS NOT NULL OR p_denominator IS NULL OR p_denominator <= 0 OR min_scale(p_denominator) > 0 THEN
        RAISE EXCEPTION 'reports v3 metric %: a median carries its member count as the denominator only', p_id USING ERRCODE = 'P0001';
      END IF;
    ELSE
      IF p_numerator IS NOT NULL OR p_denominator IS NOT NULL THEN
        RAISE EXCEPTION 'reports v3 metric %: a count or sum carries no numerator or denominator', p_id USING ERRCODE = 'P0001';
      END IF;
      IF v_unit = 'currency' AND min_scale(p_value) > 2 THEN
        RAISE EXCEPTION 'reports v3 metric %: currency must be exact cents', p_id USING ERRCODE = 'P0001';
      END IF;
      IF v_unit <> 'currency' AND min_scale(p_value) > 0 THEN
        RAISE EXCEPTION 'reports v3 metric %: a count must be a non-negative integer', p_id USING ERRCODE = 'P0001';
      END IF;
    END IF;
    -- BC4: unknown numerator evidence never becomes 0.
    v_n_known := CASE WHEN v_kind IN ('ratio', 'rate') THEN p_numerator
                      WHEN p_id = 1 AND p_coverage IS NOT NULL THEN (p_coverage ->> 'assessable')::numeric
                      WHEN v_kind = 'median' THEN NULL
                      ELSE p_value END;
    IF v_n_known = 0 AND v_n_unknown > 0 THEN
      RAISE EXCEPTION 'reports v3 metric %: unknown numerator evidence never becomes 0', p_id USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Maturity (rule 7): only 12, 18 and 19; present whenever the cohort has members; null under config codes.
  IF p_maturity IS NOT NULL AND NOT v_cohort THEN
    RAISE EXCEPTION 'reports v3 metric %: maturity applies only to 12, 18 and 19', p_id USING ERRCODE = 'P0001';
  END IF;
  IF v_cohort THEN
    v_needs_maturity := p_value IS NOT NULL OR p_reason = 'no_attributed_policies'
                        OR (p_id = 12 AND v_rkind IS DISTINCT FROM 'config' AND coalesce(p_numerator, 0) > 0);
    v_forbids_maturity := p_reason IN ('no_held_sales_appointments', 'no_first_contacts');
    IF v_needs_maturity AND p_maturity IS NULL THEN
      RAISE EXCEPTION 'reports v3 metric %: a cohort with members needs its maturity block', p_id USING ERRCODE = 'P0001';
    END IF;
    IF v_forbids_maturity AND p_maturity IS NOT NULL THEN
      RAISE EXCEPTION 'reports v3 metric %: no maturity block without members', p_id USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF p_maturity IS NOT NULL THEN
    IF jsonb_typeof(p_maturity) <> 'object'
       OR (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(p_maturity) k)
          IS DISTINCT FROM ARRAY['fully_mature_on', 'mature_members', 'mature_successes', 'members', 'pending', 'state',
                                 'successes_to_date', 'window_days']
       OR p_maturity -> 'window_days' IS DISTINCT FROM '30'::jsonb
       OR NOT (p_maturity ->> 'state') IN ('complete', 'in_progress')
       OR jsonb_typeof(p_maturity -> 'fully_mature_on') IS DISTINCT FROM 'string'
       OR (p_maturity ->> 'fully_mature_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['members', 'pending', 'successes_to_date', 'mature_members', 'mature_successes']) f
                   WHERE jsonb_typeof(p_maturity -> f) IS DISTINCT FROM 'number' OR (p_maturity ->> f) !~ c_int) THEN
      RAISE EXCEPTION 'reports v3 metric %: maturity block shape', p_id USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      PERFORM (p_maturity ->> 'fully_mature_on')::date;  -- a real calendar date
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'reports v3 metric %: maturity block shape', p_id USING ERRCODE = 'P0001';
    END;
    v_members := (p_maturity ->> 'members')::numeric;
    v_pending := (p_maturity ->> 'pending')::numeric;
    v_successes := (p_maturity ->> 'successes_to_date')::numeric;
    v_mature_members := (p_maturity ->> 'mature_members')::numeric;
    v_mature_successes := (p_maturity ->> 'mature_successes')::numeric;
    IF v_members = 0 THEN
      RAISE EXCEPTION 'reports v3 metric %: no maturity block without members', p_id USING ERRCODE = 'P0001';
    END IF;
    IF ((p_maturity ->> 'state') = 'in_progress') IS DISTINCT FROM (v_pending > 0) THEN
      RAISE EXCEPTION 'reports v3 metric %: maturity state must be in_progress exactly when members are pending', p_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_mature_members + v_pending <> v_members THEN
      RAISE EXCEPTION 'reports v3 metric %: maturity requires mature_members + pending = members', p_id USING ERRCODE = 'P0001';
    END IF;
    IF v_mature_successes > v_successes THEN
      RAISE EXCEPTION 'reports v3 metric %: maturity requires mature_successes <= successes_to_date', p_id USING ERRCODE = 'P0001';
    END IF;
    IF p_id IN (18, 19) AND (v_successes > v_members OR v_mature_successes > v_mature_members) THEN
      RAISE EXCEPTION 'reports v3 metric %: maturity successes cannot exceed members', p_id USING ERRCODE = 'P0001';
    END IF;
    -- The block describes the same cohort as the value: 12 counts members over attributed policies;
    -- 18 and 19 count verified successes over assessable members (whole-group members may be more).
    IF p_id = 12 AND ((p_numerator IS NOT NULL AND v_members <> p_numerator)
                      OR (p_denominator IS NOT NULL AND v_successes <> p_denominator)) THEN
      RAISE EXCEPTION 'reports v3 metric %: maturity must describe the same members and attributed policies', p_id
        USING ERRCODE = 'P0001';
    END IF;
    IF p_id IN (18, 19) AND ((p_numerator IS NOT NULL AND v_successes <> p_numerator)
                             OR (p_denominator IS NOT NULL AND v_members < p_denominator)) THEN
      RAISE EXCEPTION 'reports v3 metric %: maturity must describe the same successes and members', p_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', p_id,
    'value', trim_scale(p_value),
    'status', p_status,
    'reason', p_reason,
    'numerator', trim_scale(p_numerator),
    'denominator', trim_scale(p_denominator),
    'coverage', p_coverage,
    'maturity', p_maturity,
    'detail', p_detail);
END $$;

-- -----------------------------------------------------------------------------------------------------
-- The BC4 status truth table (plan §2.2), evaluated in one place:
--   1. a config code                                   -> unavailable (config)
--   2. ratios, percentages, medians with D known = 0:  D unknown = 0 -> the zero code
--                                                       D unknown > 0 -> the first applicable coverage code
--   3. N known = 0 and N unknown > 0                   -> unavailable (first applicable coverage code)
--   4. any unknown part or window-level condition      -> partial (first applicable coverage code)
--   5. otherwise                                       -> available (a complete 0 is a valid value)
-- KPI 12 uses no_attributed_policies when members exist. KPIs 1 and 4 report premium_not_entered instead of
-- premium_missing when no premium is usable and none is invalid.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_evaluate(p_id int, p_config text, p_n_known numeric, p_d_known numeric, p_coverage jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_codes jsonb := private.report_v3_kpi_codes() -> p_id::text;
  v_kind text;
  v_n_unknown numeric := 0;
  v_d_unknown numeric := 0;
  v_first text;
BEGIN
  SELECT r ->> 'kind' INTO v_kind FROM jsonb_array_elements(private.report_v3_metric_registry()) r WHERE (r ->> 'id')::int = p_id;
  IF v_codes IS NULL OR v_kind IS NULL THEN
    RAISE EXCEPTION 'reports v3 metric %: unknown KPI', p_id USING ERRCODE = 'P0001';
  END IF;

  IF p_config IS NOT NULL THEN
    IF private.report_v3_reason_kind(p_config) IS DISTINCT FROM 'config' THEN
      RAISE EXCEPTION 'reports v3 metric %: only a config code may be passed as the reason', p_id USING ERRCODE = 'P0001';
    END IF;
    IF NOT (v_codes -> 'config') ? p_config THEN
      RAISE EXCEPTION 'reports v3 metric %: reason % does not apply', p_id, p_config USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('status', 'unavailable', 'reason', p_config);
  END IF;

  SELECT coalesce(sum(c.n) FILTER (WHERE s.side IN ('N', 'ND')), 0), coalesce(sum(c.n) FILTER (WHERE s.side IN ('D', 'ND')), 0)
    INTO v_n_unknown, v_d_unknown
    FROM jsonb_each_text(v_codes -> 'coverage') AS s(code, side)
    CROSS JOIN LATERAL (SELECT coalesce((p_coverage -> 'reasons' ->> s.code)::numeric, 0) AS n) c;
  SELECT u.c INTO v_first FROM unnest(private.report_v3_reason_codes()) WITH ORDINALITY AS u(c, o)
   WHERE coalesce((p_coverage -> 'reasons' ->> u.c)::numeric, 0) > 0 ORDER BY u.o LIMIT 1;

  IF v_kind IN ('ratio', 'rate', 'median') AND coalesce(p_d_known, 0) = 0 THEN
    IF v_d_unknown = 0 THEN
      RETURN jsonb_build_object('status', 'unavailable', 'reason',
        CASE WHEN p_id = 12 AND coalesce(p_n_known, 0) > 0 THEN 'no_attributed_policies' ELSE v_codes -> 'zero' ->> 0 END);
    END IF;
    RETURN jsonb_build_object('status', 'unavailable', 'reason',
      CASE WHEN v_first = 'premium_missing' THEN 'premium_not_entered' ELSE v_first END);
  END IF;
  IF coalesce(p_n_known, 0) = 0 AND v_n_unknown > 0 THEN
    RETURN jsonb_build_object('status', 'unavailable', 'reason',
      CASE WHEN v_first = 'premium_missing' THEN 'premium_not_entered' ELSE v_first END);
  END IF;
  IF v_first IS NOT NULL OR coalesce((p_coverage ->> 'unassessable')::numeric, 0) > 0 THEN
    IF v_first IS NULL THEN
      RAISE EXCEPTION 'reports v3 metric %: unassessable items need a coverage reason', p_id USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('status', 'partial', 'reason', v_first);
  END IF;
  RETURN jsonb_build_object('status', 'available', 'reason', NULL);
END $$;

-- -----------------------------------------------------------------------------------------------------
-- Builders. A reader passes known parts, coverage (unknown parts by reason), the maturity block for the
-- 30-day groups and, only when one applies, a config code. Status and reason come from report_v3_evaluate;
-- report_v3_metric validates the result.
-- -----------------------------------------------------------------------------------------------------

-- Ratios (KPIs 4, 9, 10, 11, 12, 34): value = numerator / denominator.
CREATE FUNCTION private.report_v3_ratio(p_id int, p_num numeric, p_den numeric, p_coverage jsonb DEFAULT NULL,
                                        p_maturity jsonb DEFAULT NULL, p_reason text DEFAULT NULL, p_detail jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_eval jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(private.report_v3_metric_registry()) r
                  WHERE (r ->> 'id')::int = p_id AND r ->> 'kind' = 'ratio') THEN
    RAISE EXCEPTION 'reports v3 metric %: report_v3_ratio builds ratios only', p_id USING ERRCODE = 'P0001';
  END IF;
  IF p_num IS NULL OR p_den IS NULL OR p_num < 0 OR p_den < 0 THEN
    RAISE EXCEPTION 'reports v3 metric %: known parts must be non-negative', p_id USING ERRCODE = 'P0001';
  END IF;
  v_eval := private.report_v3_evaluate(p_id, p_reason, p_num, p_den, p_coverage);
  IF v_eval ->> 'status' = 'unavailable' AND private.report_v3_reason_kind(v_eval ->> 'reason') = 'config' THEN
    RETURN private.report_v3_metric(p_id, 'unavailable', NULL, NULL, NULL, NULL, NULL, v_eval ->> 'reason', p_detail);
  ELSIF v_eval ->> 'status' = 'unavailable' THEN
    RETURN private.report_v3_metric(p_id, 'unavailable', NULL, p_num, p_den, p_coverage, p_maturity, v_eval ->> 'reason', p_detail);
  END IF;
  RETURN private.report_v3_metric(p_id, v_eval ->> 'status', round(p_num / p_den, 6), p_num, p_den, p_coverage, p_maturity,
                                  v_eval ->> 'reason', p_detail);
END $$;

-- Percentages (KPIs 8, 17, 18, 19, 38): value = 100 × numerator / denominator.
CREATE FUNCTION private.report_v3_rate(p_id int, p_num numeric, p_den numeric, p_coverage jsonb DEFAULT NULL,
                                       p_maturity jsonb DEFAULT NULL, p_reason text DEFAULT NULL, p_detail jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_eval jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(private.report_v3_metric_registry()) r
                  WHERE (r ->> 'id')::int = p_id AND r ->> 'kind' = 'rate') THEN
    RAISE EXCEPTION 'reports v3 metric %: report_v3_rate builds percentages only', p_id USING ERRCODE = 'P0001';
  END IF;
  IF p_num IS NULL OR p_den IS NULL OR p_num < 0 OR p_den < 0 THEN
    RAISE EXCEPTION 'reports v3 metric %: known parts must be non-negative', p_id USING ERRCODE = 'P0001';
  END IF;
  v_eval := private.report_v3_evaluate(p_id, p_reason, p_num, p_den, p_coverage);
  IF v_eval ->> 'status' = 'unavailable' AND private.report_v3_reason_kind(v_eval ->> 'reason') = 'config' THEN
    RETURN private.report_v3_metric(p_id, 'unavailable', NULL, NULL, NULL, NULL, NULL, v_eval ->> 'reason', p_detail);
  ELSIF v_eval ->> 'status' = 'unavailable' THEN
    RETURN private.report_v3_metric(p_id, 'unavailable', NULL, p_num, p_den, p_coverage, p_maturity, v_eval ->> 'reason', p_detail);
  END IF;
  RETURN private.report_v3_metric(p_id, v_eval ->> 'status', round(100 * p_num / p_den, 6), p_num, p_den, p_coverage, p_maturity,
                                  v_eval ->> 'reason', p_detail);
END $$;

-- Counts and sums (KPIs 1, 2, 3, 5, 6, 7, 15, 16, 24, 25). KPI 1's known part is its usable-premium count.
CREATE FUNCTION private.report_v3_total(p_id int, p_value numeric, p_coverage jsonb DEFAULT NULL, p_reason text DEFAULT NULL,
                                        p_detail jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_eval jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(private.report_v3_metric_registry()) r
                  WHERE (r ->> 'id')::int = p_id AND r ->> 'kind' IN ('count', 'distinct_count', 'sum')) THEN
    RAISE EXCEPTION 'reports v3 metric %: report_v3_total builds counts and sums only', p_id USING ERRCODE = 'P0001';
  END IF;
  IF p_value IS NULL OR p_value < 0 THEN
    RAISE EXCEPTION 'reports v3 metric %: known parts must be non-negative', p_id USING ERRCODE = 'P0001';
  END IF;
  v_eval := private.report_v3_evaluate(p_id, p_reason,
              CASE WHEN p_id = 1 AND p_coverage IS NOT NULL THEN (p_coverage ->> 'assessable')::numeric ELSE p_value END,
              NULL, p_coverage);
  IF v_eval ->> 'status' = 'unavailable' AND private.report_v3_reason_kind(v_eval ->> 'reason') = 'config' THEN
    RETURN private.report_v3_metric(p_id, 'unavailable', NULL, NULL, NULL, NULL, NULL, v_eval ->> 'reason', p_detail);
  ELSIF v_eval ->> 'status' = 'unavailable' THEN
    RETURN private.report_v3_metric(p_id, 'unavailable', NULL, NULL, NULL, p_coverage, NULL, v_eval ->> 'reason', p_detail);
  END IF;
  RETURN private.report_v3_metric(p_id, v_eval ->> 'status', p_value, NULL, NULL, p_coverage, NULL, v_eval ->> 'reason', p_detail);
END $$;

-- Medians (KPIs 14, 21): the exact percentile over p_members assessable members.
CREATE FUNCTION private.report_v3_median(p_id int, p_value numeric, p_members numeric, p_coverage jsonb DEFAULT NULL,
                                         p_reason text DEFAULT NULL, p_detail jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_eval jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(private.report_v3_metric_registry()) r
                  WHERE (r ->> 'id')::int = p_id AND r ->> 'kind' = 'median') THEN
    RAISE EXCEPTION 'reports v3 metric %: report_v3_median builds medians only', p_id USING ERRCODE = 'P0001';
  END IF;
  IF p_members IS NULL OR p_members < 0 OR p_value < 0 THEN
    RAISE EXCEPTION 'reports v3 metric %: known parts must be non-negative', p_id USING ERRCODE = 'P0001';
  END IF;
  IF p_members = 0 AND p_value IS NOT NULL THEN
    RAISE EXCEPTION 'reports v3 metric %: a median with no members has no value', p_id USING ERRCODE = 'P0001';
  END IF;
  IF p_members > 0 AND p_value IS NULL AND p_reason IS NULL THEN
    RAISE EXCEPTION 'reports v3 metric %: a median with members needs its value', p_id USING ERRCODE = 'P0001';
  END IF;
  v_eval := private.report_v3_evaluate(p_id, p_reason, NULL, p_members, p_coverage);
  IF v_eval ->> 'status' = 'unavailable' AND private.report_v3_reason_kind(v_eval ->> 'reason') = 'config' THEN
    RETURN private.report_v3_metric(p_id, 'unavailable', NULL, NULL, NULL, NULL, NULL, v_eval ->> 'reason', p_detail);
  ELSIF v_eval ->> 'status' = 'unavailable' THEN
    RETURN private.report_v3_metric(p_id, 'unavailable', NULL, NULL, p_members, p_coverage, NULL, v_eval ->> 'reason', p_detail);
  END IF;
  RETURN private.report_v3_metric(p_id, v_eval ->> 'status', round(p_value, 6), NULL, p_members, p_coverage, NULL,
                                  v_eval ->> 'reason', p_detail);
END $$;

-- -----------------------------------------------------------------------------------------------------
-- Created sealed (class C): no client role may execute any helper.
-- -----------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION private.report_v3_reason_codes() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_reason_kind(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_metric_registry() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_kpi_codes() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_kpi_ids(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_basis_flags() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_sold_window(date, date, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_envelope(text, text, text, uuid, text, text, date, date, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_metric(int, text, numeric, numeric, numeric, jsonb, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_evaluate(int, text, numeric, numeric, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_ratio(int, numeric, numeric, jsonb, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_rate(int, numeric, numeric, jsonb, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_total(int, numeric, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_median(int, numeric, numeric, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Postconditions: exactly these 14 helpers, invoker rights, pinned search_path, owned by postgres, and
-- not executable by any client role or by PUBLIC.
DO $postcondition$
DECLARE f record; r text; n int := 0;
BEGIN
  FOR f IN SELECT p.oid, p.prosecdef, p.proconfig, p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname LIKE 'report\_v3\_%' LOOP
    n := n + 1;
    IF f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'] OR f.proowner <> 'postgres'::regrole THEN
      RAISE EXCEPTION 'Reports v3 foundation: helper metadata mismatch: %', f.oid::regprocedure;
    END IF;
    FOREACH r IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(r, f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Reports v3 foundation: % can execute %', r, f.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
  IF n <> 14 THEN
    RAISE EXCEPTION 'Reports v3 foundation: expected 14 helpers, found %', n;
  END IF;
END $postcondition$;
