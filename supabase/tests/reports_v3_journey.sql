-- =====================================================================================================
-- Reports v3 journeys: first sales, members, metric-specific history gates and KPIs 14, 19, 21, 38 (plan §2.11;
-- D3 §3.2–§3.3; BC1, BC2, BC4). PROPOSED DESIGN (★1 and ★4 pending), tested in isolation. Disposable synthetic
-- database only. Expected values are computed by hand from reports_v3_journey_fixtures.sql: October 2026 in
-- Los Angeles, as_of 2026-12-15 unless stated.
-- =====================================================================================================

-- The suite's windows: October 2026 in America/Los_Angeles, and the as_of instants.
CREATE FUNCTION rt.jfacts(p_agents uuid[], p_as_of timestamptz DEFAULT '2026-12-15 00:00+00') RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT private.report_v3_journey_facts(rt.v3('J'), p_agents, 'America/Los_Angeles', '2026-10-01 07:00+00', '2026-11-01 07:00+00',
                                         '2026-10-01', '2026-11-01', p_as_of);
$$;
CREATE FUNCTION rt.jkpis(p_agents uuid[], p_as_of timestamptz DEFAULT '2026-12-15 00:00+00') RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT private.report_v3_journey_kpis(rt.jfacts(p_agents, p_as_of));
$$;
CREATE FUNCTION rt.jmember(p_kpi int, p_key text, p_agents uuid[] DEFAULT NULL) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|', coalesce(m.gate, '-'), coalesce(m.coverage_code, '-'), m.assessable::text, coalesce(m.metric_value::text, '-'),
                   coalesce(m.success::text, '-'), coalesce(m.classification, '-'))
    FROM private.report_v3_journey_members(rt.v3('J'), p_agents, 'America/Los_Angeles', '2026-10-01 07:00+00',
                                           '2026-11-01 07:00+00', '2026-10-01', '2026-11-01', '2026-12-15 00:00+00') m
   WHERE m.kpi = p_kpi AND m.identity_key = p_key;
$$;
CREATE FUNCTION rt.jkey(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'lead:' || rt.v3(p) $$;
CREATE FUNCTION rt.jsvr(p_agents uuid[], p_as_of timestamptz DEFAULT '2026-12-15 00:00+00') RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(format('%s:%s', e ->> 'id', rt.svr(e)), ' ' ORDER BY o)
    FROM jsonb_array_elements(rt.jkpis(p_agents, p_as_of)) WITH ORDINALITY x(e, o);
$$;
CREATE FUNCTION rt.jenv(p_agents uuid[], p_id int, p_as_of timestamptz DEFAULT '2026-12-15 00:00+00') RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT e FROM jsonb_array_elements(rt.jkpis(p_agents, p_as_of)) e WHERE (e ->> 'id')::int = p_id;
$$;
CREATE TEMP TABLE v3_personal AS SELECT rt.jkpis(ARRAY[rt.v3('JA1')]) AS k, rt.jkpis(ARRAY[rt.v3('JA1'), rt.v3('JA2')]) AS t;

-- -----------------------------------------------------------------------------------------------------
-- 1. First sales (keyed by identity, recorded <= as_of).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('first sales of organization J',
  (SELECT string_agg(format('%s:%s:%s', i.name, f.first_sold_date, f.assessable::text), ' ' ORDER BY i.name COLLATE "C")
     FROM private.report_v3_first_sales(rt.v3('J'), '2026-12-15 00:00+00') f JOIN rt.v3_ids i ON i.id = f.first_win_id),
  'JW01:2026-10-05:true JW03:2026-10-04:true JW11:2026-10-12:true JW12:2026-10-13:true JW13:2026-10-02:true');
SELECT rt.eq('first-sale identity keys', (SELECT string_agg(f.identity_kind, ',' ORDER BY f.first_sold_date)
  FROM private.report_v3_first_sales(rt.v3('J'), '2026-12-15 00:00+00') f), 'lead,lead,lead,client,lead');
SELECT rt.eq('a sale recorded after as_of is not a first sale yet',
  (SELECT count(*) FROM private.report_v3_first_sales(rt.v3('J'), '2026-10-04 00:00+00')), 1::bigint);

-- -----------------------------------------------------------------------------------------------------
-- 2. Member rows: gate | coverage | assessable | value | success | classification.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('19 S2 non-buyer is a member (BC2)', rt.jmember(19, rt.jkey('JL2')), '-|-|true|-|false|-');
SELECT rt.eq('19 S3 success', rt.jmember(19, rt.jkey('JL3')), '-|-|true|-|true|-');
SELECT rt.eq('19 S4 a number-matched No Answer call could not have been a contact', rt.jmember(19, rt.jkey('JL4')), '-|-|true|-|false|-');
SELECT rt.eq('19 S5 a number-matched could-qualify call', rt.jmember(19, rt.jkey('JL5')),
  'possibly_related_unlinked_call|history_incomplete|false|-|false|-');
SELECT rt.eq('19 S6 own phone change', rt.jmember(19, rt.jkey('JL6')), 'phone_changed|history_incomplete|false|-|false|-');
SELECT rt.eq('19 S7 an unverified call is not a 19 gate', rt.jmember(19, rt.jkey('JL7')), '-|-|true|-|false|-');
SELECT rt.eq('19 S9 inbound first contact', rt.jmember(19, rt.jkey('JL9')), '-|-|true|-|false|-');
SELECT rt.eq('19 S13 prior buyer is not a member (E1)', rt.jmember(19, rt.jkey('JL13')), NULL::text);
SELECT rt.eq('19 S10 voicemail only: no first contact', rt.jmember(19, rt.jkey('JL10')), NULL::text);
SELECT rt.eq('first contact is the linked call, never the number-matched one',
  (SELECT m.anchor_at FROM private.report_v3_journey_members(rt.v3('J'), NULL, 'America/Los_Angeles', '2026-10-01 07:00+00',
     '2026-11-01 07:00+00', '2026-10-01', '2026-11-01', '2026-12-15 00:00+00') m WHERE m.kpi = 19 AND m.identity_key = rt.jkey('JL4')),
  '2026-10-06 18:00+00'::timestamptz);
SELECT rt.eq('21 S2 one attempt', rt.jmember(21, rt.jkey('JL2')), '-|-|true|1|-|-');
SELECT rt.eq('21 S3 a confirmed No Answer attempt counts', rt.jmember(21, rt.jkey('JL3')), '-|-|true|2|-|-');
SELECT rt.eq('21 S4 any possibly related call', rt.jmember(21, rt.jkey('JL4')),
  'possibly_related_unlinked_call|history_incomplete|false|-|-|-');
SELECT rt.eq('21 S6 own phone change', rt.jmember(21, rt.jkey('JL6')), 'phone_changed|history_incomplete|false|-|-|-');
SELECT rt.eq('21 S7 unverified linked call before the first contact', rt.jmember(21, rt.jkey('JL7')), '-|attempt_unverified|false|-|-|-');
SELECT rt.eq('21 S8 a refused admission is not an attempt', rt.jmember(21, rt.jkey('JL8')), '-|-|true|1|-|-');
SELECT rt.eq('21 S9 inbound-first contact has 0 attempts', rt.jmember(21, rt.jkey('JL9')), '-|-|true|0|-|-');
SELECT rt.eq('14 S1 receipt Oct 1, first sale Oct 5, no call: 4 days (BC2)', rt.jmember(14, rt.jkey('JL1')), '-|-|true|4|-|-');
SELECT rt.eq('14 S3', rt.jmember(14, rt.jkey('JL3')), '-|-|true|3|-|-');
SELECT rt.eq('14 S11 hand-entered client', rt.jmember(14, 'client:' || rt.v3('JK11')),
  'hand_entered_client|lead_receipt_unknown|false|-|-|-');
SELECT rt.eq('14 S12 receipt unknown', rt.jmember(14, rt.jkey('JL12')), 'lead_receipt_unknown|lead_receipt_unknown|false|-|-|-');
SELECT rt.eq('14 S13 call history after the sale is not a gate', rt.jmember(14, rt.jkey('JL13')), '-|-|true|1|-|-');
SELECT rt.eq('38 missing producing-call evidence is Unclassified, never No (BC2)', rt.jmember(38, rt.jkey('JL3')),
  '-|sale_call_link_missing|false|-|-|unclassified');
SELECT rt.eq('38 S1 no call at all is Unclassified', rt.jmember(38, rt.jkey('JL1')), '-|sale_call_link_missing|false|-|-|unclassified');

-- -----------------------------------------------------------------------------------------------------
-- 3. KPI envelopes per scope, through the BC4 builders.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('personal journey KPIs (JA1)', rt.jsvr(ARRAY[rt.v3('JA1')]),
  '14:partial|lead_receipt_unknown|2 19:partial|history_incomplete|20 21:partial|attempt_unverified|1 '
  || '38:unavailable|sale_call_link_not_captured|null');
SELECT rt.eq('JA4: receipt Oct 1 and first sale Oct 5 give 4 days without any call (BC2)', rt.jsvr(ARRAY[rt.v3('JA4')]),
  '14:available|-|4 19:unavailable|no_first_contacts|null 21:unavailable|no_first_contacts|null '
  || '38:unavailable|sale_call_link_not_captured|null');
SELECT rt.eq('JA2: a first-contact prospect with no purchase is 0.0 % available (BC4)', rt.jsvr(ARRAY[rt.v3('JA2')]),
  '14:unavailable|no_first_time_buyers|null 19:available|-|0 21:available|-|1 38:unavailable|sale_call_link_not_captured|null');
SELECT rt.eq('JA2: maturity kept with the complete zero', rt.jenv(ARRAY[rt.v3('JA2')], 19) -> 'maturity',
  '{"window_days":30,"state":"complete","members":1,"pending":0,"successes_to_date":0,"mature_members":1,"mature_successes":0,
    "fully_mature_on":"2026-11-10"}'::jsonb);
SELECT rt.eq('team journey KPIs (JA1, JA2)', rt.jsvr(ARRAY[rt.v3('JA1'), rt.v3('JA2')]),
  '14:partial|lead_receipt_unknown|2 19:partial|history_incomplete|16.666667 21:partial|attempt_unverified|1 '
  || '38:unavailable|sale_call_link_not_captured|null');
SELECT rt.eq('agency journey KPIs', rt.jsvr(NULL),
  '14:partial|lead_receipt_unknown|3 19:partial|history_incomplete|14.285714 21:partial|attempt_unverified|1 '
  || '38:unavailable|sale_call_link_not_captured|null');
SELECT rt.eq('personal 19 coverage and exact parts', rt.jenv(ARRAY[rt.v3('JA1')], 19) - 'id' - 'status' - 'reason' - 'detail' - 'maturity' - 'value',
  '{"numerator":1,"denominator":5,"coverage":{"eligible":7,"assessable":5,"unassessable":2,"reasons":{"history_incomplete":2}}}'::jsonb);
SELECT rt.eq('personal 19 maturity: evidence status and maturity are separate', rt.jenv(ARRAY[rt.v3('JA1')], 19) -> 'maturity',
  '{"window_days":30,"state":"complete","members":7,"pending":0,"successes_to_date":1,"mature_members":7,"mature_successes":1,
    "fully_mature_on":"2026-11-11"}'::jsonb);
SELECT rt.eq('in progress at an earlier as_of: same partial value, open cohort', format('%s|%s', rt.svr(rt.jenv(ARRAY[rt.v3('JA1')], 19,
  '2026-11-05 00:00+00')), rt.jenv(ARRAY[rt.v3('JA1')], 19, '2026-11-05 00:00+00') -> 'maturity'),
  'partial|history_incomplete|20|{"state": "in_progress", "members": 7, "pending": 5, "window_days": 30, "mature_members": 2, '
  || '"fully_mature_on": "2026-11-11", "mature_successes": 1, "successes_to_date": 1}');
SELECT rt.eq('personal 19 history detail (only its own gates)', rt.jenv(ARRAY[rt.v3('JA1')], 19) #> '{detail,history}',
  '{"assessable":5,"unassessable_by":{"lead_receipt_unknown":0,"receipt_contradicted":0,"possibly_related_unlinked_call":1,
    "phone_changed":1,"sold_before_receipt":0,"imported_already_sold":0,"hand_entered_client":0},"numberless_unresolved_calls":null}'::jsonb);
SELECT rt.eq('personal 21 coverage', rt.jenv(ARRAY[rt.v3('JA1')], 21) -> 'coverage',
  '{"eligible":7,"assessable":3,"unassessable":4,"reasons":{"history_incomplete":3,"attempt_unverified":1}}'::jsonb);
SELECT rt.eq('personal 14 coverage', rt.jenv(ARRAY[rt.v3('JA1')], 14) -> 'coverage',
  '{"eligible":4,"assessable":2,"unassessable":2,"reasons":{"lead_receipt_unknown":2}}'::jsonb);
SELECT rt.eq('KPI 14 never shows numberless calls', rt.jenv(NULL, 14) #> '{detail,history,numberless_unresolved_calls}', 'null'::jsonb);
SELECT rt.eq('unresolved activity: personal (only calls credited in scope)', rt.jenv(ARRAY[rt.v3('JA1')], 19) #> '{detail,unresolved_activity}',
  '{"outbound_attempts":0,"contacted_calls":0,"answered_inbound":0}'::jsonb);
SELECT rt.eq('unresolved activity: team', rt.jenv(ARRAY[rt.v3('JA1'), rt.v3('JA2')], 19) #> '{detail,unresolved_activity}',
  '{"outbound_attempts":3,"contacted_calls":0,"answered_inbound":0}'::jsonb);
SELECT rt.eq('unresolved activity: agency', rt.jenv(NULL, 19) #> '{detail,unresolved_activity}',
  '{"outbound_attempts":6,"contacted_calls":2,"answered_inbound":0}'::jsonb);
SELECT rt.eq('organization-wide uncertainty only at agency scope: numberless calls',
  format('%s|%s|%s', rt.jfacts(NULL) -> 'numberless_unresolved_calls', rt.jfacts(ARRAY[rt.v3('JA1')]) -> 'numberless_unresolved_calls',
         rt.jfacts(ARRAY[rt.v3('JA1'), rt.v3('JA2')]) -> 'numberless_unresolved_calls'), '1|null|null');
SELECT rt.eq('no matching call is not proof of complete history: agency 19 stays partial with the numberless count',
  rt.jenv(NULL, 19) #> '{coverage,reasons}', '{"history_incomplete":3}'::jsonb);
SELECT rt.eq('agency 21 coverage', rt.jenv(NULL, 21) #> '{coverage,reasons}', '{"history_incomplete":4,"attempt_unverified":1}'::jsonb);
SELECT rt.eq('journey facts carry no keys, numbers or ids', rt.jfacts(NULL)::text ~ '(lead:|client:|c3f|310)', false);
SELECT rt.expect_sql_failure($$SELECT * FROM private.report_v3_journey_members(rt.v3('J'), NULL, NULL, now(), now(), current_date, current_date, now())$$,
  'reports v3 journey: the organization, time zone, windows and as_of are required');

-- -----------------------------------------------------------------------------------------------------
-- 4. BC1: unrelated out-of-scope activity never changes personal or team values, statuses or coverage.
-- -----------------------------------------------------------------------------------------------------
SAVEPOINT bc1;
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_phone, created_at, duration, disposition_id, disposition_name,
                          dialer_admission_required) VALUES
  ('c3f6ffff-0000-0000-0000-000000000001', rt.v3('J'), rt.v3('JA3'), 'outbound', NULL, '2026-10-05 19:00+00', 60, rt.v3('JDINT'), 'Interested', false),
  ('c3f6ffff-0000-0000-0000-000000000002', rt.v3('J'), rt.v3('JA3'), 'outbound', '415-555-0000', '2026-10-06 19:00+00', 90, rt.v3('JDINT'), 'Interested', false);
INSERT INTO public.contact_history_events (organization_id, contact_id, contact_type, source_table, source_id, action, actor_kind,
                                           changed_fields, recorded_at)
VALUES (rt.v3('J'), rt.v3('JL14'), 'lead', 'leads', rt.v3('JL14'), 'updated', 'agent', '{phone}', '2026-10-04 18:00+00');
SELECT rt.eq('BC1 personal envelopes unchanged (numberless call, unrelated number, out-of-scope phone change)',
  rt.jkpis(ARRAY[rt.v3('JA1')]), (SELECT k FROM v3_personal));
SELECT rt.eq('BC1 team envelopes unchanged', rt.jkpis(ARRAY[rt.v3('JA1'), rt.v3('JA2')]), (SELECT t FROM v3_personal));
SELECT rt.eq('BC1 agency diagnostics may change', format('%s|%s', rt.jfacts(NULL) -> 'numberless_unresolved_calls', rt.svr(rt.jenv(NULL, 19))),
  '2|partial|history_incomplete|16.666667');
ROLLBACK TO SAVEPOINT bc1;
SELECT rt.eq('BC1 rollback restores the agency result', rt.svr(rt.jenv(NULL, 19)), 'partial|history_incomplete|14.285714');

-- -----------------------------------------------------------------------------------------------------
-- 5. BC2: 1 Call Close with captured links (the PKG-C shape, swapped in only inside this savepoint).
-- -----------------------------------------------------------------------------------------------------
SAVEPOINT bc2;
INSERT INTO public.clients (id, organization_id, lead_id, phone, premium, created_at)
VALUES ('c3f20200-0000-0000-0000-000000000000', rt.v3('J'), rt.v3('JL2'), '310-555-0102', 0, '2026-10-17 22:00+00');
INSERT INTO private.policy_identities (policy_id, organization_id, client_id, source, legacy)
VALUES ('c3f30200-0000-0000-0000-000000000000', rt.v3('J'), 'c3f20200-0000-0000-0000-000000000000', 'primary', false);
INSERT INTO public.wins (id, organization_id, agent_id, contact_id, policy_id, premium_snapshot, premium_amount, idempotency_key,
                         sold_date, created_at, recorded_at)
VALUES ('c3f40200-0000-0000-0000-000000000000', rt.v3('J'), rt.v3('JA1'), 'c3f20200-0000-0000-0000-000000000000',
        'c3f30200-0000-0000-0000-000000000000', true, 40.00, 'v3j:w2', '2026-10-17', '2026-10-17 22:00+00', '2026-10-17 22:00+00');
CREATE OR REPLACE FUNCTION private.report_v3_sale_call_links(p_org uuid, p_as_of timestamptz)
RETURNS TABLE (win_id uuid, call_id uuid, call_direction text, link_source text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT w, c, 'outbound', 'test' FROM (VALUES
    ('c3f40300-0000-0000-0000-000000000000'::uuid, 'c3f50000-0000-0000-0000-000000000003'::uuid),
    ('c3f41200-0000-0000-0000-000000000000'::uuid, 'c3f50000-0000-0000-0000-000000000031'::uuid),
    ('c3f40200-0000-0000-0000-000000000000'::uuid, 'c3f50000-0000-0000-0000-000000000022'::uuid)) AS l(w, c);
$$;
SELECT rt.eq('a confirmed earlier unanswered attempt does not invalidate a verified 1 Call Close', rt.jmember(38, rt.jkey('JL3')),
  '-|-|true|-|-|yes');
SELECT rt.eq('a link to a call that was not a qualifying contact stays Unclassified, never No', rt.jmember(38, rt.jkey('JL12')),
  '-|sale_call_link_missing|false|-|-|unclassified');
SELECT rt.eq('an earlier confirmed contact makes it No', rt.jmember(38, rt.jkey('JL2')), '-|-|true|-|-|no');
ROLLBACK TO SAVEPOINT bc2;
SELECT rt.eq('BC2 rollback restores the stub', (SELECT count(*) FROM private.report_v3_sale_call_links(rt.v3('J'), now())), 0::bigint);

-- -----------------------------------------------------------------------------------------------------
-- 6. Created sealed, and negative controls (each guard, edited away, fails a suite assertion).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.assert_v3_helper_shape();
SELECT rt.assert_sealed_v3(true, false);
-- Batch 7: every helper the journey statement calls is PARALLEL RESTRICTED (read-only, no subtransaction, run by the
-- leader), so its history pass may use a parallel plan; one PARALLEL UNSAFE call would make the whole statement serial.
SELECT rt.eq('the journey statement''s helpers are parallel restricted',
  (SELECT string_agg(p.proname || ':' || p.proparallel::text, ' ' ORDER BY p.proname) FROM pg_proc p
    WHERE p.pronamespace = 'private'::regnamespace
      AND p.proname IN ('report_v3_first_sales', 'report_v3_identity_numbers', 'report_v3_identity_receipts',
                        'report_v3_local_day_start', 'report_v3_sale_call_links')),
  'report_v3_first_sales:r report_v3_identity_numbers:r report_v3_identity_receipts:r report_v3_local_day_start:r '
  || 'report_v3_sale_call_links:r');
SELECT rt.reject_mutation('private.report_v3_journey_rows(uuid,uuid[],text,timestamp with time zone,timestamp with time zone,date,date,timestamp with time zone)',
  'min(c.created_at) FILTER (WHERE c.could_qualify) AS qual_at',
  'min(c.created_at) AS qual_at',
  $probe$SELECT rt.eq('mutated could-qualify gate', rt.jmember(19, rt.jkey('JL4')), '-|-|true|-|false|-')$probe$,
  'mutated could-qualify gate FAIL');
SELECT rt.reject_mutation('private.report_v3_journey_rows(uuid,uuid[],text,timestamp with time zone,timestamp with time zone,date,date,timestamp with time zone)',
  'AND (s.first_sold_date IS NULL OR s.first_sold_date >= (f.created_at AT TIME ZONE $6)::date)', '',
  $probe$SELECT rt.eq('mutated prior-buyer rule', rt.jmember(19, rt.jkey('JL13')), NULL::text)$probe$,
  'mutated prior-buyer rule FAIL');
SELECT rt.reject_mutation('private.report_v3_journey_facts_by(uuid,uuid[],boolean,text,timestamp with time zone,timestamp with time zone,date,date,timestamp with time zone)',
  'CASE WHEN g.g_kind = ''scope'' AND p_agents IS NULL THEN coalesce(a.numberless, 0) END AS numberless',
  'CASE WHEN g.g_kind = ''scope'' THEN coalesce(a.numberless, 0) END AS numberless',
  $probe$SELECT rt.eq('mutated numberless scope', rt.jkpis(ARRAY[rt.v3('JA1')]), (SELECT k FROM v3_personal))$probe$,
  'mutated numberless scope FAIL');
