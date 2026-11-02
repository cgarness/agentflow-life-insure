-- =====================================================================================================
-- Reports v3 reader negative controls (plan D1 §11; D5 §8 negative list). Disposable synthetic databases only,
-- through scripts/run_reports_v3_tests.sh. Each control rewrites one reader or helper inside a rolled-back
-- subtransaction (rt.reject_mutation) and requires the named probe to fail with its own message, so an
-- expected refusal is always distinguishable from an unexpected error (any other error fails the control).
-- =====================================================================================================
CREATE TEMP TABLE neg_before AS SELECT rt.v3_all('A1') AS personal;
CREATE FUNCTION rt.callonly_keys(p jsonb) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM jsonb_path_query(p, 'strict $.**') v
   WHERE jsonb_typeof(v) = 'object'
     AND EXISTS (SELECT 1 FROM jsonb_object_keys(v) k WHERE k ~ '(polic|premium|attribution_unavailable|leads_dialed|contacted_leads|converted)');
$$;

-- Removed narrowing: the summary counts every agent's calls for a personal viewer.
SELECT rt.reject_mutation('public.get_report_summary_v3(date,date,uuid,text)',
  '$q$ INTO v_calls USING a.org_id, w.start_at, w.end_at, a.agent_ids;',
  '$q$ INTO v_calls USING a.org_id, w.start_at, w.end_at, NULL::uuid[];',
  $probe$SELECT rt.eq('mutated summary narrowing', rt.kpi(rt.v3r('A1', 'summary'), 5), '5')$probe$,
  'mutated summary narrowing FAIL');
-- Removed narrowing: the state reader maps every agent's calls.
SELECT rt.reject_mutation('public.get_report_state_breakdown_v3(date,date,uuid,text)',
  E'     WHERE $4::uuid[] IS NULL OR cg.placing_agent_id = ANY ($4)\n     GROUP BY 1, 2, 3, 4, 5, 6', '     GROUP BY 1, 2, 3, 4, 5, 6',
  $probe$SELECT rt.eq('mutated state narrowing', rt.v3r('A1', 'state_breakdown') #> '{totals,calls_made}', '5'::jsonb)$probe$,
  'mutated state narrowing FAIL');
-- Removed narrowing: the journey totals become agency totals.
SELECT rt.reject_mutation('public.get_report_journey_v3(date,date,uuid,text)',
  'a.org_id, a.agent_ids, w.time_zone, w.start_at, w.end_at, sw.sold_from, sw.sold_until, v_as_of)),',
  'a.org_id, NULL, w.time_zone, w.start_at, w.end_at, sw.sold_from, sw.sold_until, v_as_of)),',
  $probe$SELECT rt.eq('mutated journey narrowing', rt.v3r('A1', 'journey') -> 'metrics', (SELECT personal #> '{journey,metrics}' FROM neg_before))$probe$,
  'mutated journey narrowing FAIL');
-- Other-agent rows: the roster ignores the resolved agents.
SELECT rt.reject_mutation('private.report_v3_roster(uuid,uuid[],uuid,uuid[])',
  '(p_agent_ids IS NULL AND p.status = ''Active'' AND p_filter_agent IS NULL)', '(p.status = ''Active'')',
  $probe$SELECT rt.eq('mutated roster scope', (SELECT string_agg(e ->> 'name', ',') FROM jsonb_array_elements(rt.v3r('A1', 'summary') -> 'by_agent') e), 'Vee Agent One')$probe$,
  'mutated roster scope FAIL');
-- Unknown evidence emitted as a confident zero: a state group with policies but no usable premium.
SELECT rt.reject_mutation('public.get_report_state_breakdown_v3(date,date,uuid,text)',
  'WHEN pg.known_count = 0 THEN NULL', 'WHEN pg.known_count = 0 THEN 0',
  $probe$SELECT rt.eq('mutated unknown premium', (SELECT j #> '{premium,annual_premium}' FROM jsonb_array_elements(rt.v3r('ADM1', 'state_breakdown') -> 'jurisdictions') j
                                                   WHERE j ->> 'state' = 'AZ'), 'null'::jsonb)$probe$,
  'mutated unknown premium FAIL');
-- Unavailable emitted as 0 through the reader: the appointment stub stops reporting evidence_not_captured.
SELECT rt.reject_mutation('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)',
  'private.report_v3_total(15, 0, NULL, ''evidence_not_captured'')', 'private.report_v3_total(15, 0, NULL, NULL)',
  $probe$SELECT rt.eq('mutated appointment zero', rt.kpi(rt.v3r('A1', 'sales_appointments'), 15, 'status') || rt.kpi(rt.v3r('A1', 'sales_appointments'), 15), '"unavailable"null')$probe$,
  'mutated appointment zero FAIL');
-- A v2 policy field leaks into a call reader.
SELECT rt.reject_mutation('public.get_report_campaign_calls_v3(date,date,uuid,text)',
  '''other_campaigns'', (SELECT', '''policies_in_period'', 0, ''other_campaigns'', (SELECT',
  $probe$SELECT rt.eq('mutated call-only payload', rt.callonly_keys(rt.v3r('ADM1', 'campaign_calls')), 0::bigint)$probe$,
  'mutated call-only payload FAIL');
-- Non-attempts and unverified rows counted as Calls made.
SELECT rt.reject_mutation('public.get_report_campaign_calls_v3(date,date,uuid,text)',
  '      FROM kg WHERE kg.attempt_class = ''attempt''',
  '      FROM kg WHERE kg.attempt_class IS NOT NULL',
  $probe$SELECT rt.eq('mutated attempt population', rt.v3_recon('ADM1'), 'calls|10|10|10|10|10|10|10|10|10|10|contacted|5|5|5|5|5|5|population|1')$probe$,
  'mutated attempt population FAIL');
-- A duplicate-producing join: every campaign membership of a lead multiplies its calls.
SELECT rt.reject_mutation('public.get_report_lead_source_calls_v3(date,date,uuid,text)',
  E'      FROM cg\n     WHERE $4::uuid[] IS NULL OR cg.placing_agent_id = ANY ($4)\n     GROUP BY 1, 2, 3',
  E'      FROM cg LEFT JOIN public.campaign_leads cm ON cm.lead_id = cg.lead_id AND cm.organization_id = $1\n     WHERE $4::uuid[] IS NULL OR cg.placing_agent_id = ANY ($4)\n     GROUP BY 1, 2, 3',
  $probe$SELECT rt.eq('mutated membership join', rt.v3_recon('ADM1'), 'calls|10|10|10|10|10|10|10|10|10|10|contacted|5|5|5|5|5|5|population|1')$probe$,
  'mutated membership join FAIL');
-- A hidden campaign's name and id leak into an agent's campaign rows.
SELECT rt.reject_mutation('public.get_report_campaign_calls_v3(date,date,uuid,text)',
  'WHERE f.campaign_class = ''visible''', 'WHERE f.campaign_class IN (''visible'', ''hidden'')',
  $probe$SELECT rt.eq('mutated hidden campaign', rt.v3r('A1', 'campaign_calls')::text ~ ('V3 Team Three|' || rt.v3('KT3')), false)$probe$,
  'mutated hidden campaign FAIL');
-- Pre-rounding: the state AP no longer reconciles with KPI 1 to the cent.
SELECT rt.reject_mutation('public.get_report_state_breakdown_v3(date,date,uuid,text)',
  'ELSE sum(p.monthly_premium * 12) FILTER (WHERE p.premium_state = ''known'') END',
  'ELSE round(sum(p.monthly_premium * 12) FILTER (WHERE p.premium_state = ''known'')) END',
  $probe$SELECT rt.eq('mutated AP rounding', rt.v3r('ADM1', 'state_breakdown') #> '{totals,premium,annual_premium}', rt.kpi(rt.v3r('ADM1', 'summary'), 1)::jsonb)$probe$,
  'mutated AP rounding FAIL');
-- A grant to anon breaks the seal.
SELECT rt.expect_sql_failure('GRANT EXECUTE ON FUNCTION public.get_report_summary_v3(date,date,uuid,text) TO anon; SELECT rt.assert_sealed_v3(true, false);',
  'v3 seal mismatch');
SELECT rt.eq('every mutation was rolled back: A1''s payloads are unchanged', (SELECT personal = rt.v3_all('A1') FROM neg_before), true);
SELECT rt.assert_sealed_v3(true, false);
