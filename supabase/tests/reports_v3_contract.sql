-- =====================================================================================================
-- Reports v3 contract suite (plan §2.2–§2.6; binding condition BC4). Disposable synthetic database only,
-- through scripts/run_reports_v3_tests.sh. Every expected value below is written by hand from the plan;
-- none is read back from the function under test.
-- =====================================================================================================

-- Shorthand: coverage objects and the 30-day maturity block, built only in this test.
CREATE FUNCTION rt.cov(p_eligible int, p_assessable int, p_unassessable int, p_reasons jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('eligible', p_eligible, 'assessable', p_assessable,
                            'unassessable', p_unassessable, 'reasons', p_reasons);
$$;
CREATE FUNCTION rt.mat(p_members int, p_pending int, p_successes int, p_mature_members int, p_mature_successes int,
                       p_fully_mature_on text DEFAULT '2026-11-30')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('window_days', 30,
    'state', CASE WHEN p_pending > 0 THEN 'in_progress' ELSE 'complete' END,
    'members', p_members, 'pending', p_pending, 'successes_to_date', p_successes,
    'mature_members', p_mature_members, 'mature_successes', p_mature_successes, 'fully_mature_on', p_fully_mature_on);
$$;
-- Status, reason and value of one envelope, as one comparable text.
CREATE FUNCTION rt.svr(p jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', p ->> 'status', coalesce(p ->> 'reason', '-'), coalesce(p ->> 'value', 'null'));
$$;

-- -----------------------------------------------------------------------------------------------------
-- 1. Closed reason registry (§2.3): 29 codes in precedence order, with their kinds.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('reason registry', private.report_v3_reason_codes(), ARRAY[
  'evidence_not_captured', 'sale_call_link_not_captured', 'classification_not_configured',
  'outcome_capture_not_started', 'journey_scope_restricted',
  'no_policies_sold', 'no_calls_made', 'no_lead_calls', 'no_first_time_buyers', 'no_first_contacts',
  'no_due_sales_appointments', 'no_held_sales_appointments', 'no_attributed_policies', 'premium_not_entered',
  'capture_gap', 'outcome_capture_partial_period', 'appointment_type_unclassified', 'outcomes_unresolved',
  'attribution_unresolved', 'legacy_booking_basis', 'attempt_unverified', 'unlinked_contacted_calls',
  'unlinked_calls_excluded', 'history_incomplete', 'lead_receipt_unknown', 'sale_call_link_missing',
  'premium_invalid', 'premium_missing', 'panel_not_loaded']::text[]);
SELECT rt.eq('reason kinds',
  (SELECT string_agg(private.report_v3_reason_kind(c), ',' ORDER BY o)
     FROM unnest(private.report_v3_reason_codes()) WITH ORDINALITY u(c, o)),
  repeat('config,', 5) || repeat('zero,', 9) || repeat('coverage,', 14) || 'export');
SELECT rt.eq('unknown reason has no kind', private.report_v3_reason_kind('window_in_progress'), NULL::text);

-- -----------------------------------------------------------------------------------------------------
-- 2. Metric and unit registry (§2.4): exactly 23 rows, frozen field by field.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('metric registry', private.report_v3_metric_registry(), $registry$[
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
]$registry$::jsonb);

-- Per-KPI applicable codes (§2.2 truth table): config, zero and coverage codes; every code in registry order.
SELECT rt.eq('KPI 9 codes', private.report_v3_kpi_codes() -> '9',
  '{"config":[],"zero":["no_policies_sold"],"coverage":{"attempt_unverified":"N"}}'::jsonb);
SELECT rt.eq('KPI 12 codes', private.report_v3_kpi_codes() -> '12',
  '{"config":["evidence_not_captured","classification_not_configured","outcome_capture_not_started","journey_scope_restricted"],
    "zero":["no_held_sales_appointments","no_attributed_policies"],
    "coverage":{"capture_gap":"ND","outcome_capture_partial_period":"W","appointment_type_unclassified":"ND","attribution_unresolved":"D"}}'::jsonb);
SELECT rt.eq('KPI 38 codes (no receipt code, D3)', private.report_v3_kpi_codes() -> '38',
  '{"config":["sale_call_link_not_captured","journey_scope_restricted"],"zero":["no_first_time_buyers"],
    "coverage":{"history_incomplete":"D","sale_call_link_missing":"D"}}'::jsonb);
SELECT rt.eq('every applicable code is registered with the right kind',
  (SELECT count(*) FROM jsonb_each(private.report_v3_kpi_codes()) k(id, v),
          LATERAL (SELECT 'config' kind, c, o FROM jsonb_array_elements_text(v -> 'config') WITH ORDINALITY a(c, o)
                   UNION ALL SELECT 'zero', c, o FROM jsonb_array_elements_text(v -> 'zero') WITH ORDINALITY a(c, o)
                   UNION ALL SELECT 'coverage', c, o FROM jsonb_object_keys(v -> 'coverage') WITH ORDINALITY a(c, o)) x
    WHERE private.report_v3_reason_kind(x.c) IS DISTINCT FROM x.kind), 0::bigint);
SELECT rt.eq('config and zero codes are listed in registry order',
  (SELECT count(*) FROM jsonb_each(private.report_v3_kpi_codes()) k(id, v), unnest(ARRAY['config', 'zero']) kind
    WHERE (SELECT array_agg(c ORDER BY o) FROM jsonb_array_elements_text(v -> kind) WITH ORDINALITY a(c, o))
          IS DISTINCT FROM
          (SELECT array_agg(c ORDER BY array_position(private.report_v3_reason_codes(), c)) FROM jsonb_array_elements_text(v -> kind) a(c))),
  0::bigint);
SELECT rt.eq('codes exist for exactly the 23 KPIs',
  (SELECT array_agg(id::int ORDER BY id::int) FROM jsonb_object_keys(private.report_v3_kpi_codes()) id),
  ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,14,15,16,17,18,19,21,24,25,34,38]);

-- Percentages are exactly 8, 17, 18, 19 and 38; the 30-day groups are exactly 12, 18 and 19.
SELECT rt.eq('percent KPIs',
  (SELECT array_agg((m ->> 'id')::int ORDER BY (m ->> 'id')::int) FROM jsonb_array_elements(private.report_v3_metric_registry()) m
    WHERE m ->> 'unit' = 'percent'), ARRAY[8,17,18,19,38]);
SELECT rt.eq('30-day group KPIs',
  (SELECT array_agg((m ->> 'id')::int ORDER BY (m ->> 'id')::int) FROM jsonb_array_elements(private.report_v3_metric_registry()) m
    WHERE (m ->> 'cohort_30d')::boolean), ARRAY[12,18,19]);

-- Readers and their KPI ids (§2.1): every registered KPI belongs to exactly one reader.
SELECT rt.eq('summary ids', private.report_v3_kpi_ids('summary'), ARRAY[1,2,3,4,5,6,7,8,9,10,11,24,25,34]);
SELECT rt.eq('journey ids', private.report_v3_kpi_ids('journey'), ARRAY[14,19,21,38]);
SELECT rt.eq('sales appointment ids', private.report_v3_kpi_ids('sales_appointments'), ARRAY[12,15,16,17,18]);
SELECT rt.eq('readers without metrics',
  (SELECT bool_and(cardinality(private.report_v3_kpi_ids(r)) = 0)
     FROM unnest(ARRAY['scope','state_breakdown','call_volume','disposition_breakdown','campaign_calls','lead_source_calls']) r), true);
SELECT rt.eq('reader ids partition the registry',
  (SELECT array_agg(i ORDER BY i) FROM unnest(private.report_v3_kpi_ids('summary') || private.report_v3_kpi_ids('journey')
                                              || private.report_v3_kpi_ids('sales_appointments')) i),
  (SELECT array_agg((m ->> 'id')::int ORDER BY (m ->> 'id')::int) FROM jsonb_array_elements(private.report_v3_metric_registry()) m));
SELECT rt.eq('registry reader column agrees',
  (SELECT count(*) FROM jsonb_array_elements(private.report_v3_metric_registry()) m
    WHERE NOT (m ->> 'id')::int = ANY (private.report_v3_kpi_ids(m ->> 'reader'))), 0::bigint);
SELECT rt.expect_sql_failure($$SELECT private.report_v3_kpi_ids('conversion')$$, 'reports v3: unknown reader');

-- PKG-A stub basis flags (§2.6).
SELECT rt.eq('basis flags', private.report_v3_basis_flags(),
  '{"contract_version":"3.0.0","corrections":"not_installed","sale_call_links":"not_installed","appointment_evidence":"not_installed"}'::jsonb);

-- Sold window: half-open (start, least(end, agency today) + 1); a future Sold Date counts once its date arrives.
SELECT rt.eq('sold window, open period',
  (SELECT format('%s..%s', sold_from, sold_until) FROM private.report_v3_sold_window('2026-10-01', '2026-10-31', '2026-10-15')),
  '2026-10-01..2026-10-16');
SELECT rt.eq('sold window, closed period',
  (SELECT format('%s..%s', sold_from, sold_until) FROM private.report_v3_sold_window('2026-09-01', '2026-09-30', '2026-10-15')),
  '2026-09-01..2026-10-01');
SELECT rt.expect_sql_failure($$SELECT * FROM private.report_v3_sold_window('2026-10-01', '2026-10-31', NULL)$$,
  'reports v3: the sold window needs all three dates');
SELECT rt.eq('sold window, future period is empty',
  (SELECT sold_until <= sold_from FROM private.report_v3_sold_window('2026-11-01', '2026-11-30', '2026-10-15')), true);

-- -----------------------------------------------------------------------------------------------------
-- 3. Payload meta (§2.1, D1 §3.2): report_meta verbatim plus v3 markers and basis flags.
-- -----------------------------------------------------------------------------------------------------
CREATE TEMP TABLE v3_env AS
SELECT private.report_v3_envelope('summary', 'organization', 'agency', NULL, 'America/Los_Angeles', 'agency_settings',
                                  '2026-10-01', '2099-10-31', '2026-10-01 07:00:00+00', '2099-11-01 07:00:00+00') e;
SELECT rt.eq('meta keys', (SELECT array_agg(k ORDER BY k COLLATE "C") FROM v3_env, jsonb_object_keys(e) k), ARRAY[
  'agency_today', 'as_of', 'basis', 'basis_version', 'contract_version', 'filter_agent_id', 'period_open', 'policy_basis',
  'reader', 'requested_scope', 'scope', 'window']);
SELECT rt.eq('meta markers', (SELECT jsonb_build_object('basis_version', e -> 'basis_version', 'contract_version', e -> 'contract_version',
    'reader', e -> 'reader', 'scope', e -> 'scope', 'requested_scope', e -> 'requested_scope', 'filter_agent_id', e -> 'filter_agent_id',
    'period_open', e -> 'period_open', 'basis', e -> 'basis', 'policy_basis', e -> 'policy_basis') FROM v3_env),
  '{"basis_version":"reports_v3","contract_version":"3.0.0","reader":"summary","scope":"organization","requested_scope":"agency",
    "filter_agent_id":null,"period_open":true,
    "basis":{"corrections":"not_installed","sale_call_links":"not_installed","appointment_evidence":"not_installed"},
    "policy_basis":{"source":"original_policy_sales","credit":"original_seller","date":"sold_date","premium":"effective_sale_monthly_x12"}}'::jsonb);
SELECT rt.eq('window is report_meta verbatim', (SELECT e -> 'window' FROM v3_env),
  private.report_meta('organization', NULL, 'America/Los_Angeles', 'agency_settings', '2026-10-01', '2099-10-31',
                      '2026-10-01 07:00:00+00', '2099-11-01 07:00:00+00') -> 'window');
SELECT rt.eq('agency today in the agency zone', (SELECT e ->> 'agency_today' FROM v3_env),
  to_char((now() AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM-DD'));
SELECT rt.eq('as_of is UTC now', (SELECT e ->> 'as_of' FROM v3_env), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
SELECT rt.eq('closed period',
  private.report_v3_envelope('journey', 'own', 'personal', '11000000-0000-0000-0000-000000000001', 'America/New_York', 'agency_settings',
                             '2026-09-01', '2026-09-30', '2026-09-01 04:00:00+00', '2026-10-01 04:00:00+00') -> 'period_open', 'false'::jsonb);
SELECT rt.eq('filter agent carried',
  private.report_v3_envelope('journey', 'own', 'personal', '11000000-0000-0000-0000-000000000001', 'America/New_York', 'agency_settings',
                             '2026-09-01', '2026-09-30', '2026-09-01 04:00:00+00', '2026-10-01 04:00:00+00') ->> 'filter_agent_id',
  '11000000-0000-0000-0000-000000000001');
SELECT rt.eq('policy basis only on summary, journey and state readers',
  (SELECT array_agg(r ORDER BY r COLLATE "C") FROM unnest(ARRAY['summary','journey','sales_appointments','state_breakdown','call_volume',
       'disposition_breakdown','campaign_calls','lead_source_calls']) r
    WHERE private.report_v3_envelope(r, 'team', 'team', NULL, 'UTC', 'agency_settings', '2026-10-01', '2026-10-01',
                                     '2026-10-01 00:00:00+00', '2026-10-02 00:00:00+00') ? 'policy_basis'),
  ARRAY['journey','state_breakdown','summary']);
SELECT rt.eq('scope reader has no window', (SELECT array_agg(k ORDER BY k COLLATE "C")
    FROM jsonb_object_keys(private.report_v3_envelope('scope', 'organization', 'agency', NULL, NULL, NULL, NULL, NULL, NULL, NULL)) k),
  ARRAY['as_of', 'basis', 'basis_version', 'contract_version', 'filter_agent_id', 'reader', 'requested_scope', 'scope']);
SELECT rt.expect_sql_failure($$SELECT private.report_v3_envelope('conversion','organization','agency',NULL,'UTC','agency_settings',
  '2026-10-01','2026-10-01','2026-10-01','2026-10-02')$$, 'reports v3 envelope: unknown reader');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_envelope('summary','agency','agency',NULL,'UTC','agency_settings',
  '2026-10-01','2026-10-01','2026-10-01','2026-10-02')$$, 'reports v3 envelope: invalid scope');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_envelope('summary','organization','organization',NULL,'UTC','agency_settings',
  '2026-10-01','2026-10-01','2026-10-01','2026-10-02')$$, 'reports v3 envelope: invalid requested scope');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_envelope('summary','organization','agency',NULL,NULL,NULL,
  NULL,NULL,NULL,NULL)$$, 'reports v3 envelope: a windowed reader needs its window');

-- -----------------------------------------------------------------------------------------------------
-- 4. Envelope rules enforced by private.report_v3_metric (§2.2 rules 1–11). Valid envelopes first.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('valid partial envelope',
  private.report_v3_metric(9, 'partial', 2.5, 5, 2, rt.cov(8, 5, 3, '{"attempt_unverified":3}'), NULL, 'attempt_unverified', NULL),
  '{"id":9,"value":2.5,"status":"partial","reason":"attempt_unverified","numerator":5,"denominator":2,
    "coverage":{"eligible":8,"assessable":5,"unassessable":3,"reasons":{"attempt_unverified":3}},"maturity":null,"detail":null}'::jsonb);
SELECT rt.eq('partial and in progress at once (rule 1)', rt.svr(
  private.report_v3_metric(19, 'partial', 25, 2, 8, rt.cov(10, 8, 2, '{"history_incomplete":2}'), rt.mat(10, 3, 2, 7, 1),
                           'history_incomplete', NULL)), 'partial|history_incomplete|25');

-- Each invalid envelope fails only that panel, closed (P0001).
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(13,'available',1,NULL,NULL,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 13: unknown KPI');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'unknown',1,NULL,NULL,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 5: invalid status');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'unavailable',0,NULL,NULL,
  jsonb_build_object('eligible',3,'assessable',0,'unassessable',3,'reasons',jsonb_build_object('attempt_unverified',3)),NULL,'attempt_unverified',NULL)$$,
  'reports v3 metric 5: unavailable requires a null value');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'unavailable',NULL,NULL,NULL,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 5: unavailable requires a reason');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'available',3,NULL,NULL,NULL,NULL,'attempt_unverified',NULL)$$,
  'reports v3 metric 5: available requires a null reason');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'available',NULL,NULL,NULL,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 5: available and partial require a value');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'available',3,NULL,NULL,
  jsonb_build_object('eligible',4,'assessable',3,'unassessable',1,'reasons',jsonb_build_object('attempt_unverified',1)),NULL,NULL,NULL)$$,
  'reports v3 metric 5: available requires complete coverage');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(15,'available',6,NULL,NULL,
  jsonb_build_object('eligible',6,'assessable',6,'unassessable',0,'reasons',jsonb_build_object('legacy_booking_basis',6)),NULL,NULL,NULL)$$,
  'reports v3 metric 15: available requires complete coverage');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'partial',3,NULL,NULL,NULL,NULL,'attempt_unverified',NULL)$$,
  'reports v3 metric 5: partial requires unassessable items or a window-level condition');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'partial',2.5,5,2,
  jsonb_build_object('eligible',8,'assessable',5,'unassessable',3,'reasons',jsonb_build_object('attempt_unverified',3)),NULL,'no_policies_sold',NULL)$$,
  'reports v3 metric 9: partial requires a coverage reason');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'unavailable',NULL,NULL,NULL,NULL,NULL,'no_policies_sold',NULL)$$,
  'reports v3 metric 5: reason no_policies_sold does not apply');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'unavailable',NULL,NULL,NULL,NULL,NULL,'panel_not_loaded',NULL)$$,
  'reports v3 metric 5: reason panel_not_loaded does not apply');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'unavailable',NULL,5,0,
  jsonb_build_object('eligible',8,'assessable',5,'unassessable',3,'reasons',jsonb_build_object('attempt_unverified',3)),NULL,'attempt_unverified',NULL)$$,
  'reports v3 metric 9: a coverage reason makes the value unavailable only when nothing on the deciding side is known');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(8,'unavailable',NULL,0,0,
  jsonb_build_object('eligible',3,'assessable',0,'unassessable',3,'reasons',jsonb_build_object('attempt_unverified',3)),NULL,'no_calls_made',NULL)$$,
  'reports v3 metric 8: a zero code requires nothing unassessable');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'unavailable',NULL,5,2,NULL,NULL,'no_policies_sold',NULL)$$,
  'reports v3 metric 9: a zero code requires an empty denominator');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(17,'partial',0,0,5,
  jsonb_build_object('eligible',8,'assessable',5,'unassessable',3,'reasons',jsonb_build_object('capture_gap',1,'outcomes_unresolved',2)),NULL,'outcomes_unresolved',NULL)$$,
  'reports v3 metric 17: reason must be the first applicable code (capture_gap)');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'partial',2.5,5,2,
  jsonb_build_object('eligible',8,'assessable',5,'unassessable',2,'reasons',jsonb_build_object('attempt_unverified',3)),NULL,'attempt_unverified',NULL)$$,
  'reports v3 metric 9: coverage must satisfy assessable + unassessable = eligible');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'available',2.5,5,2,
  jsonb_build_object('eligible',5,'assessable',5,'unassessable',0,'reasons',jsonb_build_object(),'extra',1),NULL,NULL,NULL)$$,
  'reports v3 metric 9: coverage keys');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'partial',2.5,5,2,
  jsonb_build_object('eligible',8,'assessable',5,'unassessable',3,'reasons',jsonb_build_object('lead_receipt_unknown',3)),NULL,'lead_receipt_unknown',NULL)$$,
  'reports v3 metric 9: coverage reason lead_receipt_unknown does not apply');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'partial',2.5,5,2,
  jsonb_build_object('eligible',8,'assessable',5,'unassessable',3,'reasons',jsonb_build_object('attempt_unverified',-3)),NULL,'attempt_unverified',NULL)$$,
  'reports v3 metric 9: coverage counts must be non-negative integers');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'available',2.4,5,2,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 9: value must equal numerator / denominator');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(8,'available',0.5,1,2,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 8: value must equal 100 * numerator / denominator');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'available',0.3333333,1,3,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 9: value scale exceeds 6');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'available',NULL,1,0,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 9: available and partial require a value');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'available',1,1,NULL,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 9: a ratio needs an exact numerator and a positive denominator');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'available',3,3,NULL,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 5: a count or sum carries no numerator or denominator');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'available',2.5,NULL,NULL,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 5: a count must be a non-negative integer');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(1,'available',10.005,NULL,NULL,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 1: currency must be exact cents');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(14,'available',4,2,1,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 14: a median carries its member count as the denominator only');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'available',3,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb)$$,
  'reports v3 metric 5: detail must be an object or null');
-- BC4: unknown numerator evidence never becomes 0, whatever status a caller claims.
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'partial',0,0,2,
  jsonb_build_object('eligible',3,'assessable',0,'unassessable',3,'reasons',jsonb_build_object('attempt_unverified',3)),NULL,'attempt_unverified',NULL)$$,
  'reports v3 metric 9: unknown numerator evidence never becomes 0');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'partial',0,NULL,NULL,
  jsonb_build_object('eligible',3,'assessable',0,'unassessable',3,'reasons',jsonb_build_object('attempt_unverified',3)),NULL,'attempt_unverified',NULL)$$,
  'reports v3 metric 5: unknown numerator evidence never becomes 0');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(16,'partial',0,NULL,NULL,
  jsonb_build_object('eligible',7,'assessable',5,'unassessable',2,'reasons',jsonb_build_object('outcomes_unresolved',2)),NULL,'outcomes_unresolved',NULL)$$,
  'reports v3 metric 16: unknown numerator evidence never becomes 0');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(4,'unavailable',NULL,0,0,
  jsonb_build_object('eligible',2,'assessable',0,'unassessable',2,'reasons',jsonb_build_object('premium_invalid',1,'premium_missing',1)),NULL,'premium_not_entered',NULL)$$,
  'reports v3 metric 4: premium_not_entered requires every unusable premium to be missing');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(12,'unavailable',NULL,0,0,NULL,NULL,'no_attributed_policies',NULL)$$,
  'reports v3 metric 12: no_attributed_policies requires members');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(12,'unavailable',NULL,3,0,NULL,
  jsonb_build_object('window_days',30,'state','complete','members',3,'pending',0,'successes_to_date',0,'mature_members',3,'mature_successes',0,'fully_mature_on','2026-11-30'),'no_held_sales_appointments',NULL)$$,
  'reports v3 metric 12: no_held_sales_appointments requires no members');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(12,'unavailable',NULL,NULL,NULL,
  jsonb_build_object('eligible',4,'assessable',0,'unassessable',4,'reasons',jsonb_build_object('attribution_unresolved',4)),NULL,'outcome_capture_not_started',NULL)$$,
  'reports v3 metric 12: a config reason carries no numbers or coverage');

-- Maturity (rule 7): only 12, 18 and 19; present whenever members > 0, null under config codes.
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(5,'available',3,NULL,NULL,NULL,
  jsonb_build_object('window_days',30,'state','complete','members',1,'pending',0,'successes_to_date',0,'mature_members',1,'mature_successes',0,'fully_mature_on','2026-11-30'),NULL,NULL)$$,
  'reports v3 metric 5: maturity applies only to 12, 18 and 19');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(19,'available',0,0,10,NULL,NULL,NULL,NULL)$$,
  'reports v3 metric 19: a cohort with members needs its maturity block');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(12,'unavailable',NULL,4,0,
  jsonb_build_object('eligible',4,'assessable',0,'unassessable',4,'reasons',jsonb_build_object('attribution_unresolved',4)),NULL,'attribution_unresolved',NULL)$$,
  'reports v3 metric 12: a cohort with members needs its maturity block');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(19,'unavailable',NULL,0,0,NULL,
  jsonb_build_object('window_days',30,'state','complete','members',1,'pending',0,'successes_to_date',0,'mature_members',1,'mature_successes',0,'fully_mature_on','2026-11-30'),'no_first_contacts',NULL)$$,
  'reports v3 metric 19: no maturity block without members');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(19,'unavailable',NULL,NULL,NULL,NULL,
  jsonb_build_object('window_days',30,'state','complete','members',1,'pending',0,'successes_to_date',0,'mature_members',1,'mature_successes',0,'fully_mature_on','2026-11-30'),'journey_scope_restricted',NULL)$$,
  'reports v3 metric 19: no maturity block under a config reason');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(19,'available',0,0,10,NULL,
  jsonb_build_object('window_days',30,'state','complete','members',10,'pending',2,'successes_to_date',0,'mature_members',8,'mature_successes',0,'fully_mature_on','2026-11-30'),NULL,NULL)$$,
  'reports v3 metric 19: maturity state must be in_progress exactly when members are pending');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(19,'available',0,0,10,NULL,
  jsonb_build_object('window_days',30,'state','in_progress','members',10,'pending',2,'successes_to_date',0,'mature_members',7,'mature_successes',0,'fully_mature_on','2026-11-30'),NULL,NULL)$$,
  'reports v3 metric 19: maturity requires mature_members + pending = members');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(19,'available',20,2,10,NULL,
  jsonb_build_object('window_days',30,'state','complete','members',10,'pending',0,'successes_to_date',2,'mature_members',10,'mature_successes',3,'fully_mature_on','2026-11-30'),NULL,NULL)$$,
  'reports v3 metric 19: maturity requires mature_successes <= successes_to_date');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(18,'available',100,12,12,NULL,
  jsonb_build_object('window_days',30,'state','complete','members',10,'pending',0,'successes_to_date',12,'mature_members',10,'mature_successes',11,'fully_mature_on','2026-11-30'),NULL,NULL)$$,
  'reports v3 metric 18: maturity successes cannot exceed members');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(19,'available',0,0,10,NULL,
  jsonb_build_object('window_days',31,'state','complete','members',10,'pending',0,'successes_to_date',0,'mature_members',10,'mature_successes',0,'fully_mature_on','2026-11-30'),NULL,NULL)$$,
  'reports v3 metric 19: maturity block shape');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(19,'available',0,0,10,NULL,
  jsonb_build_object('window_days',30,'state','complete','members',10,'pending',0,'successes_to_date',0,'mature_members',10,'mature_successes',0,'fully_mature_on','30/11/2026'),NULL,NULL)$$,
  'reports v3 metric 19: maturity block shape');
SELECT rt.eq('violations raise P0001', rt.err('postgres', NULL, NULL,
  $$SELECT private.report_v3_metric(5,'unavailable',0,NULL,NULL,NULL,NULL,'attempt_unverified',NULL)$$),
  'P0001:reports v3 metric 5: unavailable requires a null value');
SELECT rt.eq('an impossible calendar date fails closed with P0001',
  rt.err('postgres', NULL, NULL, $$SELECT private.report_v3_metric(19,'available',0,0,10,NULL,
    jsonb_build_object('window_days',30,'state','complete','members',10,'pending',0,'successes_to_date',0,'mature_members',10,'mature_successes',0,'fully_mature_on','2026-02-30'),NULL,NULL)$$),
  'P0001:reports v3 metric 19: maturity block shape');
-- The block describes the same cohort as the value.
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(12,'available',1,4,4,NULL,
  jsonb_build_object('window_days',30,'state','complete','members',3,'pending',0,'successes_to_date',4,'mature_members',3,'mature_successes',4,'fully_mature_on','2026-11-30'),NULL,NULL)$$,
  'reports v3 metric 12: maturity must describe the same members and attributed policies');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(19,'available',20,2,10,NULL,
  jsonb_build_object('window_days',30,'state','complete','members',9,'pending',0,'successes_to_date',2,'mature_members',9,'mature_successes',2,'fully_mature_on','2026-11-30'),NULL,NULL)$$,
  'reports v3 metric 19: maturity must describe the same successes and members');
-- KPI 12 counts policies, which may exceed members (no successes <= members check for 12).
SELECT rt.eq('KPI 12 policies may exceed members', rt.svr(private.report_v3_metric(12, 'available', 0.666667, 2, 3, NULL,
  rt.mat(2, 0, 3, 2, 3), NULL, NULL)), 'available|-|0.666667');

-- -----------------------------------------------------------------------------------------------------
-- 5. BC4 status truth table through the shared builders (§2.2 "Required truth-table cases"). The same
--    eleven cases are asserted by the Zod, tile and CSV tests (reportsV3Fixtures.ts, PKG-F).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('BC4-1 KPI 9: 0 confirmed calls, 0 unverified, 2 policies',
  rt.svr(private.report_v3_ratio(9, 0, 2, rt.cov(0, 0, 0))), 'available|-|0');
SELECT rt.eq('BC4-2 KPI 10: 0 contacted calls, 2 policies', rt.svr(private.report_v3_ratio(10, 0, 2)), 'available|-|0');
SELECT rt.eq('BC4-3 KPI 11: 0 reached, complete identity coverage, 2 policies',
  rt.svr(private.report_v3_ratio(11, 0, 2, rt.cov(0, 0, 0))), 'available|-|0');
SELECT rt.eq('BC4-4 KPI 9: positive calls, 0 policies',
  rt.svr(private.report_v3_ratio(9, 5, 0, rt.cov(5, 5, 0))), 'unavailable|no_policies_sold|null');
SELECT rt.eq('BC4-4b KPI 9: positive and unverified calls, 0 policies',
  rt.svr(private.report_v3_ratio(9, 5, 0, rt.cov(8, 5, 3, '{"attempt_unverified":3}'))), 'unavailable|no_policies_sold|null');
SELECT rt.eq('BC4-5 KPI 9: 0 confirmed, 3 unverified, 2 policies',
  rt.svr(private.report_v3_ratio(9, 0, 2, rt.cov(3, 0, 3, '{"attempt_unverified":3}'))), 'unavailable|attempt_unverified|null');
SELECT rt.eq('BC4-5 KPI 5: 0 confirmed, 3 unverified (never an exact 0)',
  rt.svr(private.report_v3_total(5, 0, rt.cov(3, 0, 3, '{"attempt_unverified":3}'))), 'unavailable|attempt_unverified|null');
SELECT rt.eq('BC4-6 KPI 9: 5 confirmed, 3 unverified, 2 policies',
  rt.svr(private.report_v3_ratio(9, 5, 2, rt.cov(8, 5, 3, '{"attempt_unverified":3}'))), 'partial|attempt_unverified|2.5');
SELECT rt.eq('BC4-7 KPI 8: 0 attempts, 0 unverified',
  rt.svr(private.report_v3_rate(8, 0, 0, rt.cov(0, 0, 0))), 'unavailable|no_calls_made|null');
SELECT rt.eq('BC4-7 KPI 5: 0 attempts, 0 unverified', rt.svr(private.report_v3_total(5, 0, rt.cov(0, 0, 0))), 'available|-|0');
SELECT rt.eq('BC4-8 KPI 19: none bought, all mature',
  private.report_v3_rate(19, 0, 10, NULL, rt.mat(10, 0, 0, 10, 0)) - 'detail' - 'coverage' - 'reason' - 'id',
  jsonb_build_object('value', 0, 'status', 'available', 'numerator', 0, 'denominator', 10, 'maturity', rt.mat(10, 0, 0, 10, 0)));
SELECT rt.eq('BC4-9 KPI 19: none bought, some pending',
  private.report_v3_rate(19, 0, 10, NULL, rt.mat(10, 4, 0, 6, 0)) #>> '{maturity,state}', 'in_progress');
SELECT rt.eq('BC4-9 KPI 19 value', rt.svr(private.report_v3_rate(19, 0, 10, NULL, rt.mat(10, 4, 0, 6, 0))), 'available|-|0');
SELECT rt.eq('BC4-10 KPI 12: every member unresolved',
  rt.svr(private.report_v3_ratio(12, 4, 0, rt.cov(4, 0, 4, '{"attribution_unresolved":4}'), rt.mat(4, 1, 0, 3, 0))),
  'unavailable|attribution_unresolved|null');
SELECT rt.eq('BC4-10 KPI 12: maturity block kept',
  private.report_v3_ratio(12, 4, 0, rt.cov(4, 0, 4, '{"attribution_unresolved":4}'), rt.mat(4, 1, 0, 3, 0)) -> 'maturity',
  rt.mat(4, 1, 0, 3, 0));
SELECT rt.eq('BC4-11 KPI 12: resolved members, no attributed policy, none unresolved',
  rt.svr(private.report_v3_ratio(12, 4, 0, rt.cov(4, 4, 0), rt.mat(4, 0, 0, 4, 0))), 'unavailable|no_attributed_policies|null');
SELECT rt.eq('BC4-11 KPI 12: maturity block kept',
  private.report_v3_ratio(12, 4, 0, rt.cov(4, 4, 0), rt.mat(4, 0, 0, 4, 0)) -> 'maturity', rt.mat(4, 0, 0, 4, 0));

-- More truth-table rows (X3 fixtures, zero versus coverage codes, overrides, window-level conditions).
SELECT rt.eq('KPI 12: no members, no candidates', rt.svr(private.report_v3_ratio(12, 0, 0)), 'unavailable|no_held_sales_appointments|null');
SELECT rt.eq('KPI 12: no members but unclassified candidates (no zero code)',
  rt.svr(private.report_v3_ratio(12, 0, 0, rt.cov(2, 0, 2, '{"appointment_type_unclassified":2}'))),
  'unavailable|appointment_type_unclassified|null');
SELECT rt.eq('KPI 12: members, a capture gap and unresolved members, no policies',
  rt.svr(private.report_v3_ratio(12, 4, 0, rt.cov(5, 2, 3, '{"capture_gap":1,"attribution_unresolved":2}'), rt.mat(4, 0, 0, 4, 0))),
  'unavailable|capture_gap|null');
SELECT rt.eq('KPI 12: partial ratio', rt.svr(private.report_v3_ratio(12, 4, 3, rt.cov(4, 3, 1, '{"attribution_unresolved":1}'),
  rt.mat(4, 0, 3, 4, 3))), 'partial|attribution_unresolved|1.333333');
SELECT rt.eq('KPI 17: no resolved outcome (X3)', rt.svr(private.report_v3_rate(17, 0, 0, rt.cov(2, 0, 2, '{"outcomes_unresolved":2}'))),
  'unavailable|outcomes_unresolved|null');
SELECT rt.eq('KPI 17: nothing held over resolved outcomes, some unresolved',
  rt.svr(private.report_v3_rate(17, 0, 5, rt.cov(7, 5, 2, '{"outcomes_unresolved":2}'))), 'partial|outcomes_unresolved|0');
SELECT rt.eq('KPI 17: nothing due', rt.svr(private.report_v3_rate(17, 0, 0, rt.cov(0, 0, 0))), 'unavailable|no_due_sales_appointments|null');
SELECT rt.eq('KPI 16: nothing held while outcomes are missing (never 0)',
  rt.svr(private.report_v3_total(16, 0, rt.cov(7, 5, 2, '{"outcomes_unresolved":2}'))), 'unavailable|outcomes_unresolved|null');
SELECT rt.eq('KPI 16: every due outcome resolved', rt.svr(private.report_v3_total(16, 0, rt.cov(5, 5, 0))), 'available|-|0');
SELECT rt.eq('KPI 18: candidates only', rt.svr(private.report_v3_rate(18, 0, 0, rt.cov(1, 0, 1, '{"capture_gap":1}'))),
  'unavailable|capture_gap|null');
SELECT rt.eq('KPI 18: no held sales appointments', rt.svr(private.report_v3_rate(18, 0, 0)), 'unavailable|no_held_sales_appointments|null');
SELECT rt.eq('KPI 15: legacy-only window is counted and partial',
  rt.svr(private.report_v3_total(15, 6, rt.cov(6, 6, 0, '{"legacy_booking_basis":6}'))), 'partial|legacy_booking_basis|6');
SELECT rt.eq('KPI 15: unclassified only', rt.svr(private.report_v3_total(15, 0, rt.cov(3, 0, 3, '{"appointment_type_unclassified":3}'))),
  'unavailable|appointment_type_unclassified|null');
SELECT rt.eq('KPI 15 before PKG-D', rt.svr(private.report_v3_total(15, 0, NULL, 'evidence_not_captured')),
  'unavailable|evidence_not_captured|null');
SELECT rt.eq('KPI 1: no policies is $0.00', rt.svr(private.report_v3_total(1, 0)), 'available|-|0');
SELECT rt.eq('KPI 1: every premium missing', rt.svr(private.report_v3_total(1, 0, rt.cov(3, 0, 3, '{"premium_missing":3}'))),
  'unavailable|premium_not_entered|null');
SELECT rt.eq('KPI 1: every premium unusable, one invalid (X3)',
  rt.svr(private.report_v3_total(1, 0, rt.cov(3, 0, 3, '{"premium_invalid":1,"premium_missing":2}'))), 'unavailable|premium_invalid|null');
SELECT rt.eq('KPI 1: partial sum', rt.svr(private.report_v3_total(1, 1200.50, rt.cov(3, 2, 1, '{"premium_missing":1}'))),
  'partial|premium_missing|1200.5');
SELECT rt.eq('KPI 1: a known $0 premium is a valid 0', rt.svr(private.report_v3_total(1, 0, rt.cov(1, 1, 0))), 'available|-|0');
SELECT rt.eq('KPI 4: no policies', rt.svr(private.report_v3_ratio(4, 0, 0)), 'unavailable|no_policies_sold|null');
SELECT rt.eq('KPI 4: every premium missing', rt.svr(private.report_v3_ratio(4, 0, 0, rt.cov(2, 0, 2, '{"premium_missing":2}'))),
  'unavailable|premium_not_entered|null');
SELECT rt.eq('KPI 4: partial', rt.svr(private.report_v3_ratio(4, 2400.00, 2, rt.cov(3, 2, 1, '{"premium_invalid":1}'))),
  'partial|premium_invalid|1200');
SELECT rt.eq('KPI 8: unverified rows only', rt.svr(private.report_v3_rate(8, 0, 0, rt.cov(3, 0, 3, '{"attempt_unverified":3}'))),
  'unavailable|attempt_unverified|null');
SELECT rt.eq('KPI 7: no tracked identity among contacted calls',
  rt.svr(private.report_v3_total(7, 0, rt.cov(2, 0, 2, '{"unlinked_contacted_calls":2}'))), 'unavailable|unlinked_contacted_calls|null');
SELECT rt.eq('KPI 34: no lead calls', rt.svr(private.report_v3_ratio(34, 0, 0)), 'unavailable|no_lead_calls|null');
SELECT rt.eq('KPI 34: only calls not linked to a lead',
  rt.svr(private.report_v3_ratio(34, 0, 0, rt.cov(0, 0, 0, '{"unlinked_calls_excluded":5}'))), 'unavailable|unlinked_calls_excluded|null');
SELECT rt.eq('KPI 34: partial', rt.svr(private.report_v3_ratio(34, 6, 4, rt.cov(7, 6, 1, '{"attempt_unverified":1,"unlinked_calls_excluded":2}'))),
  'partial|attempt_unverified|1.5');
SELECT rt.eq('KPI 14: one buyer, 4 days', rt.svr(private.report_v3_median(14, 4, 1)), 'available|-|4');
SELECT rt.eq('KPI 14: no first-time buyers', rt.svr(private.report_v3_median(14, NULL, 0)), 'unavailable|no_first_time_buyers|null');
SELECT rt.eq('KPI 14: receipts unknown', rt.svr(private.report_v3_median(14, NULL, 0, rt.cov(2, 0, 2, '{"lead_receipt_unknown":2}'))),
  'unavailable|lead_receipt_unknown|null');
SELECT rt.eq('KPI 21: partial median', rt.svr(private.report_v3_median(21, 2.5, 4, rt.cov(5, 4, 1, '{"attempt_unverified":1}'))),
  'partial|attempt_unverified|2.5');
SELECT rt.eq('KPI 19: window-level numberless calls at agency scope',
  rt.svr(private.report_v3_rate(19, 2, 10, rt.cov(10, 10, 0, '{"history_incomplete":1}'), rt.mat(10, 0, 2, 10, 2))),
  'partial|history_incomplete|20');
SELECT rt.eq('KPI 38: every buyer unclassified', rt.svr(private.report_v3_rate(38, 0, 0, rt.cov(3, 0, 3, '{"sale_call_link_missing":3}'))),
  'unavailable|sale_call_link_missing|null');
SELECT rt.eq('KPI 38 before PKG-C', rt.svr(private.report_v3_rate(38, 0, 0, NULL, NULL, 'sale_call_link_not_captured')),
  'unavailable|sale_call_link_not_captured|null');
SELECT rt.eq('KPI 38: Yes over Yes + No', rt.svr(private.report_v3_rate(38, 1, 3, rt.cov(4, 3, 1, '{"sale_call_link_missing":1}'))),
  'partial|sale_call_link_missing|33.333333');
SELECT rt.eq('journey scope restriction', rt.svr(private.report_v3_rate(19, 0, 0, NULL, NULL, 'journey_scope_restricted')),
  'unavailable|journey_scope_restricted|null');
SELECT rt.eq('a config code wins over everything else',
  rt.svr(private.report_v3_ratio(12, 4, 3, rt.cov(5, 4, 1, '{"attribution_unresolved":1}'), NULL, 'outcome_capture_not_started')),
  'unavailable|outcome_capture_not_started|null');
SELECT rt.eq('config result carries no numbers',
  private.report_v3_ratio(12, 4, 3, rt.cov(5, 4, 1, '{"attribution_unresolved":1}'), NULL, 'outcome_capture_not_started')
    - 'id' - 'status' - 'reason',
  '{"value":null,"numerator":null,"denominator":null,"coverage":null,"maturity":null,"detail":null}'::jsonb);

-- Precision (§2.5): exact numerator and denominator, value at full precision transported to 6 dp.
SELECT rt.eq('value at 6 dp', private.report_v3_ratio(9, 1, 3) -> 'value', '0.333333'::jsonb);
SELECT rt.eq('(1249, 1000) is never pre-rounded', private.report_v3_ratio(9, 1249, 1000) -> 'value', '1.249'::jsonb);
SELECT rt.eq('percent of 1/3', private.report_v3_rate(8, 1, 3, rt.cov(3, 3, 0)) -> 'value', '33.333333'::jsonb);
SELECT rt.eq('exact numerator and denominator', private.report_v3_ratio(9, 115, 100) - 'id' - 'status' - 'reason' - 'coverage' - 'maturity' - 'detail',
  '{"value":1.15,"numerator":115,"denominator":100}'::jsonb);

-- The builders refuse the wrong unit and any non-config reason (status is never chosen by a caller).
SELECT rt.expect_sql_failure($$SELECT private.report_v3_rate(9,1,2)$$, 'reports v3 metric 9: report_v3_rate builds percentages only');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_ratio(8,1,2)$$, 'reports v3 metric 8: report_v3_ratio builds ratios only');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_total(9,1)$$, 'reports v3 metric 9: report_v3_total builds counts and sums only');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_median(5,1,1)$$, 'reports v3 metric 5: report_v3_median builds medians only');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_ratio(9,5,0,NULL,NULL,'no_policies_sold')$$,
  'reports v3 metric 9: only a config code may be passed as the reason');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_total(5,1,NULL,'journey_scope_restricted')$$,
  'reports v3 metric 5: reason journey_scope_restricted does not apply');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_ratio(9,-1,2)$$, 'reports v3 metric 9: known parts must be non-negative');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_median(14,4,0)$$, 'reports v3 metric 14: a median with no members has no value');

-- No builder raises on an empty window (rule 11): every KPI evaluates to available 0 or its zero code.
SELECT rt.eq('empty window, every KPI',
  (SELECT string_agg(format('%s:%s', id, rt.svr(CASE
       WHEN m ->> 'kind' IN ('count', 'distinct_count', 'sum') THEN private.report_v3_total(id, 0)
       WHEN m ->> 'kind' = 'median' THEN private.report_v3_median(id, NULL, 0)
       WHEN m ->> 'unit' = 'percent' THEN private.report_v3_rate(id, 0, 0)
       ELSE private.report_v3_ratio(id, 0, 0) END)), ' ' ORDER BY id)
     FROM jsonb_array_elements(private.report_v3_metric_registry()) m, LATERAL (SELECT (m ->> 'id')::int id) i),
  '1:available|-|0 2:available|-|0 3:available|-|0 4:unavailable|no_policies_sold|null 5:available|-|0 6:available|-|0 '
  || '7:available|-|0 8:unavailable|no_calls_made|null 9:unavailable|no_policies_sold|null 10:unavailable|no_policies_sold|null '
  || '11:unavailable|no_policies_sold|null 12:unavailable|no_held_sales_appointments|null 14:unavailable|no_first_time_buyers|null '
  || '15:available|-|0 16:available|-|0 17:unavailable|no_due_sales_appointments|null 18:unavailable|no_held_sales_appointments|null '
  || '19:unavailable|no_first_contacts|null 21:unavailable|no_first_contacts|null 24:available|-|0 25:available|-|0 '
  || '34:unavailable|no_lead_calls|null 38:unavailable|no_first_time_buyers|null');

-- -----------------------------------------------------------------------------------------------------
-- 6. Created sealed (§2.8 class C): helper shape, volatility, and no client privilege.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.assert_v3_helper_shape();
SELECT rt.assert_sealed_v3(true, false);
SELECT rt.eq('foundation helpers and volatility',
  (SELECT string_agg(format('%s:%s', p.oid::regprocedure, p.provolatile), ' ' ORDER BY p.oid::regprocedure::text COLLATE "C")
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private' AND p.proname LIKE 'report\_v3\_%'),
  'private.report_v3_basis_flags():i private.report_v3_envelope(text,text,text,uuid,text,text,date,date,timestamp with time zone,timestamp with time zone):s '
  || 'private.report_v3_evaluate(integer,text,numeric,numeric,jsonb):i private.report_v3_kpi_codes():i '
  || 'private.report_v3_kpi_ids(text):i private.report_v3_median(integer,numeric,numeric,jsonb,text,jsonb):i '
  || 'private.report_v3_metric(integer,text,numeric,numeric,numeric,jsonb,jsonb,text,jsonb):i private.report_v3_metric_registry():i '
  || 'private.report_v3_rate(integer,numeric,numeric,jsonb,jsonb,text,jsonb):i private.report_v3_ratio(integer,numeric,numeric,jsonb,jsonb,text,jsonb):i '
  || 'private.report_v3_reason_codes():i private.report_v3_reason_kind(text):i '
  || 'private.report_v3_sold_window(date,date,date):i private.report_v3_total(integer,numeric,jsonb,text,jsonb):i');
SELECT rt.eq('no v3 public reader exists before …15', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'get\_report\_%\_v3'), 0::bigint);

-- -----------------------------------------------------------------------------------------------------
-- 7. Negative controls: each BC4 guard, edited away, makes a suite assertion fail (then is rolled back).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.reject_mutation('private.report_v3_evaluate(integer,text,numeric,numeric,jsonb)',
  'IF coalesce(p_n_known, 0) = 0 AND v_n_unknown > 0 THEN', 'IF false THEN',
  $probe$SELECT rt.eq('mutated step 3', rt.svr(private.report_v3_ratio(9, 0, 2, rt.cov(3, 0, 3, '{"attempt_unverified":3}'))),
    'unavailable|attempt_unverified|null')$probe$,
  'reports v3 metric 9: unknown numerator evidence never becomes 0');
SELECT rt.reject_mutation('private.report_v3_metric(integer,text,numeric,numeric,numeric,jsonb,jsonb,text,jsonb)',
  'IF v_n_known = 0 AND v_n_unknown > 0 THEN', 'IF false THEN',
  $probe$SELECT rt.expect_sql_failure($$SELECT private.report_v3_metric(9,'partial',0,0,2,
    jsonb_build_object('eligible',3,'assessable',0,'unassessable',3,'reasons',jsonb_build_object('attempt_unverified',3)),NULL,'attempt_unverified',NULL)$$,
    'reports v3 metric 9: unknown numerator evidence never becomes 0')$probe$,
  'Negative control did not fail');
SELECT rt.reject_mutation('private.report_v3_evaluate(integer,text,numeric,numeric,jsonb)',
  'IF v_d_unknown = 0 THEN', 'IF true THEN',
  $probe$SELECT rt.eq('mutated step 2', rt.svr(private.report_v3_rate(8, 0, 0, rt.cov(3, 0, 3, '{"attempt_unverified":3}'))),
    'unavailable|attempt_unverified|null')$probe$,
  'reports v3 metric 8: a zero code requires nothing unassessable on the deciding side');
SELECT rt.reject_mutation('private.report_v3_ratio(integer,numeric,numeric,jsonb,jsonb,text,jsonb)',
  'p_num, p_den, p_coverage, p_maturity, v_eval ->> ''reason'', p_detail);
  END IF;', 'p_num, p_den, p_coverage, NULL, v_eval ->> ''reason'', p_detail);
  END IF;',
  $probe$SELECT rt.eq('mutated maturity', private.report_v3_ratio(12, 4, 0, rt.cov(4, 0, 4, '{"attribution_unresolved":4}'),
    rt.mat(4, 1, 0, 3, 0)) -> 'maturity', rt.mat(4, 1, 0, 3, 0))$probe$,
  'reports v3 metric 12: a cohort with members needs its maturity block');
