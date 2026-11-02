SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
-- =====================================================================================================
-- Reports v3 reader security (plan §2.8, §2.9; D1 §3.7, §11 S1–S15; BC1). Disposable synthetic databases only,
-- through scripts/run_reports_v3_tests.sh. One REPEATABLE READ transaction (one snapshot, one now()).
-- PKG-A Batch 5 has only the created state: the readers are sealed, and no enable script exists yet, so S15
-- covers that state; the enabled, v3-disabled, all-disabled and rolled-back states come with the ops scripts.
-- Positive calls use rt.v3_call, whose EXECUTE grant to authenticated never outlives one call.
-- ★1 and ★4 are pending: S14b checks the proposed linked-history effects only; it accepts no disclosure.
-- =====================================================================================================

INSERT INTO rt.v3_ids VALUES ('O2ADM', 'c3a00000-0000-0000-0000-0000000000a2'), ('O3ADM', 'c3a00000-0000-0000-0000-0000000000a3');
INSERT INTO public.profiles (id, organization_id, first_name, last_name, email, role, status) VALUES
  (rt.v3('O2ADM'), rt.v3('O2'), 'Vee', 'Eastern Admin', 'o2adm@v3.invalid', 'Admin', 'Active'),
  (rt.v3('O3ADM'), rt.v3('O3'), 'Vee', 'Unconfigured Admin', 'o3adm@v3.invalid', 'Admin', 'Active');
CREATE FUNCTION rt.windowed_readers() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['summary', 'journey', 'sales_appointments', 'state_breakdown', 'call_volume', 'disposition_breakdown',
               'campaign_calls', 'lead_source_calls'];
$$;
-- Every payload a persona sees, keyed by reader (the scope gate included).
CREATE FUNCTION rt.v3_all(p_who text, p_scope text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_object_agg(r, rt.v3r(p_who, r, p_scope)) FROM unnest(ARRAY['scope'] || rt.windowed_readers()) r;
$$;

-- -----------------------------------------------------------------------------------------------------
-- S1–S3, S15 (created state): sealed for every client role, directly and through inheritance.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('S15 no role can execute any v3 reader in the created state',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
          unnest(ARRAY['anon', 'authenticated', 'service_role', 'reports_v3_public_only', 'reports_v3_inherits_authenticated']) r
    WHERE n.nspname = 'public' AND p.proname = ANY (rt.v3_readers()) AND has_function_privilege(r, p.oid, 'EXECUTE')),
  0::bigint);
SELECT rt.eq('S1–S3 direct execution is refused for every client role (permission denied, 42501)',
  (SELECT string_agg(DISTINCT split_part(rt.err(r, rt.v3('ADM1'), rt.v3('O1'),
            format('SELECT public.get_report_summary_v3(%L, %L)', '2026-10-01', '2026-10-31')), ':', 1), ',')
     FROM unnest(ARRAY['anon', 'authenticated', 'service_role', 'reports_v3_public_only', 'reports_v3_inherits_authenticated']) r),
  '42501');
SELECT rt.eq('S1 the authenticated refusal names the sealed reader',
  rt.err('authenticated', rt.v3('ADM1'), rt.v3('O1'), 'SELECT public.get_report_scope_v3()'),
  '42501:permission denied for function get_report_scope_v3');
SELECT rt.eq('S10 private helpers and legacy rpc_report_* stay sealed; v2 readers keep their grants',
  (SELECT rt.assert_sealed(true)::text || rt.assert_sealed_v3(true, false)::text), '');

-- -----------------------------------------------------------------------------------------------------
-- S4–S5: owner, security, volatility, search_path; no organization, time zone or as_of argument.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('S4–S5 reader metadata',
  (SELECT string_agg(DISTINCT concat_ws('|', pg_get_userbyid(p.proowner), p.prosecdef::text, p.provolatile, l.lanname,
                                         array_to_string(p.proconfig, ';')), ' ')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND p.proname = ANY (rt.v3_readers())),
  'postgres|true|s|plpgsql|search_path=pg_catalog, pg_temp');
SELECT rt.eq('S5 arguments: the scope gate takes a scope; every windowed reader the same four',
  (SELECT string_agg(DISTINCT pg_get_function_identity_arguments(p.oid), ' / ')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY (rt.v3_readers())),
  'p_requested_scope text / p_start_date date, p_end_date date, p_agent_id uuid, p_requested_scope text');

-- -----------------------------------------------------------------------------------------------------
-- S6: the server resolves organization, role, hierarchy and allowed agents; an agent only narrows and NULL
-- never widens. S7/S8: access is checked before the window (42501, then 22023, then 55000).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('S6 NULL never widens: each persona gets its narrowest default',
  concat_ws(' ', rt.v3r('A1', 'summary') ->> 'scope', rt.v3r('TL1', 'summary') ->> 'scope', rt.v3r('ADM1', 'summary') ->> 'scope'),
  'own team organization');
SELECT rt.eq('S6 an Agent cannot request team or agency scope on any windowed reader',
  (SELECT string_agg(DISTINCT rt.v3_err(rt.v3('A1'), rt.v3('O1'), format('SELECT public.get_report_%s_v3(%L, %L, NULL, %L)', r, '2026-10-01', '2026-10-31', s)), ' | ')
     FROM unnest(rt.windowed_readers()) r, unnest(ARRAY['team', 'agency']) s),
  '42501:reports: requested scope is not authorized');
SELECT rt.eq('S6 an agent filter outside the scope is refused (A1 on A2, TL1 on A3, ADM1 on another organization)',
  concat_ws(' | ',
    rt.v3_err(rt.v3('A1'), rt.v3('O1'), format('SELECT public.get_report_summary_v3(%L, %L, %L)', '2026-10-01', '2026-10-31', rt.v3('A2'))),
    rt.v3_err(rt.v3('TL1'), rt.v3('O1'), format('SELECT public.get_report_call_volume_v3(%L, %L, %L, %L)', '2026-10-01', '2026-10-31', rt.v3('A3'), 'team')),
    rt.v3_err(rt.v3('ADM1'), rt.v3('O1'), format('SELECT public.get_report_state_breakdown_v3(%L, %L, %L)', '2026-10-01', '2026-10-31', rt.v3('B1')))),
  '42501:reports: agent is outside your requested scope | 42501:reports: agent is outside your requested scope | '
  || '42501:reports: agent is outside your requested scope');
SELECT rt.eq('S6 a Team Leader cannot request agency scope', rt.v3_err(rt.v3('TL1'), rt.v3('O1'),
  format('SELECT public.get_report_journey_v3(%L, %L, NULL, %L)', '2026-10-01', '2026-10-31', 'agency')),
  '42501:reports: requested scope is not authorized');
SELECT rt.eq('S6 an agent filter narrows: TL1 on A1 equals A1''s own team-filtered rows',
  rt.v3r('TL1', 'summary', 'team', 'A1') -> 'by_agent' = rt.v3r('ADM1', 'summary', NULL, 'A1') -> 'by_agent', true);
SELECT rt.eq('S7 access before the window: an unauthorized scope with a reversed range is 42501',
  rt.v3_err(rt.v3('A1'), rt.v3('O1'), format('SELECT public.get_report_summary_v3(%L, %L, NULL, %L)', '2026-10-31', '2026-10-01', 'agency')),
  '42501:reports: requested scope is not authorized');
SELECT rt.eq('S8 22023 for a reversed range, a 367-day range and a missing date',
  concat_ws(' | ',
    split_part(rt.v3_err(rt.v3('ADM1'), rt.v3('O1'), format('SELECT public.get_report_summary_v3(%L, %L)', '2026-10-31', '2026-10-01')), ':', 1),
    split_part(rt.v3_err(rt.v3('ADM1'), rt.v3('O1'), format('SELECT public.get_report_campaign_calls_v3(%L, %L)', '2025-10-01', '2026-10-02')), ':', 1),
    split_part(rt.v3_err(rt.v3('ADM1'), rt.v3('O1'), 'SELECT public.get_report_lead_source_calls_v3(NULL, ''2026-10-31'')'), ':', 1)),
  '22023 | 22023 | 22023');
SELECT rt.eq('S7 an organization with no time zone: 55000 after authorization, 22023 for bad dates first, 55000 on the scope gate',
  concat_ws(' | ',
    split_part(rt.v3_err(rt.v3('O3ADM'), rt.v3('O3'), format('SELECT public.get_report_summary_v3(%L, %L)', '2026-10-01', '2026-10-31')), ':', 1),
    split_part(rt.v3_err(rt.v3('O3ADM'), rt.v3('O3'), format('SELECT public.get_report_summary_v3(%L, %L)', '2026-10-31', '2026-10-01')), ':', 1),
    split_part(rt.v3_err(rt.v3('O3ADM'), rt.v3('O3'), 'SELECT public.get_report_scope_v3()'), ':', 1)),
  '55000 | 22023 | 55000');

-- -----------------------------------------------------------------------------------------------------
-- S9: cross-organization isolation. O2's own admin sees only O2; changing O2 leaves every O1 payload equal.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('S9 O2 sees only its own call, policy and session',
  concat_ws(' ', rt.kpi(rt.v3_call(rt.v3('O2ADM'), rt.v3('O2'), $q$SELECT public.get_report_summary_v3('2026-10-01', '2026-10-31')$q$), 5),
            rt.kpi(rt.v3_call(rt.v3('O2ADM'), rt.v3('O2'), $q$SELECT public.get_report_summary_v3('2026-10-01', '2026-10-31')$q$), 2),
            rt.kpi(rt.v3_call(rt.v3('O2ADM'), rt.v3('O2'), $q$SELECT public.get_report_summary_v3('2026-10-01', '2026-10-31')$q$), 1),
            rt.kpi(rt.v3_call(rt.v3('O2ADM'), rt.v3('O2'), $q$SELECT public.get_report_summary_v3('2026-10-01', '2026-10-31')$q$), 25)),
  '1 1 6000 14400');
CREATE TEMP TABLE sec_o1_before AS SELECT rt.v3_all('ADM1') AS agency, rt.v3_all('TL1') AS team, rt.v3_all('A1') AS personal;
SAVEPOINT s9;
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_id, contact_type, campaign_id, created_at, duration, status)
SELECT gen_random_uuid(), rt.v3('O2'), rt.v3('B1'), 'outbound', rt.v3('RL1'), 'lead', rt.v3('KP1'), '2026-10-05 16:30+00', 200, 'completed'
  FROM generate_series(1, 3);
INSERT INTO public.wins (id, organization_id, agent_id, contact_id, premium_snapshot, premium_amount, sold_date, created_at, recorded_at)
VALUES (gen_random_uuid(), rt.v3('O2'), rt.v3('B1'), rt.v3('C1'), true, 999, '2026-10-05', '2026-10-05 18:00+00', '2026-10-05 18:00+00');
INSERT INTO public.dialer_sessions (id, agent_id, started_at, ended_at, last_heartbeat_at, status, organization_id)
VALUES (gen_random_uuid(), rt.v3('B1'), '2026-10-06 15:00+00', '2026-10-06 20:00+00', '2026-10-06 19:59+00', 'ended', rt.v3('O2'));
UPDATE public.leads SET state = 'Oregon', lead_source = 'Moved' WHERE organization_id = rt.v3('O2');
SELECT rt.eq('S9 O2 activity, even pointing at O1 ids, leaves O1 payloads byte-identical at every scope',
  (SELECT agency = rt.v3_all('ADM1') AND team = rt.v3_all('TL1') AND personal = rt.v3_all('A1') FROM sec_o1_before), true);
ROLLBACK TO SAVEPOINT s9;

-- -----------------------------------------------------------------------------------------------------
-- S11: markers on all nine readers.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('S11 v3 markers on every reader',
  (SELECT string_agg(DISTINCT concat_ws('|', e.value ->> 'basis_version', e.value ->> 'contract_version', e.value ->> 'requested_scope',
                                        (e.value ->> 'reader' = e.key OR (e.key = 'scope' AND e.value ->> 'reader' = 'scope'))::text), ' ')
     FROM jsonb_each(rt.v3_all('A1')) e),
  'reports_v3|3.0.0|personal|true');

-- -----------------------------------------------------------------------------------------------------
-- S12–S13: privacy scans. A personal payload carries no other agent, no hidden campaign, no prospect or row
-- identity, no phone number, no row timestamp and no unattributed bucket; a team payload names only the team.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('S12 A1''s payloads: no out-of-scope agent, hidden campaign, row id, recruit or phone number',
  (SELECT count(*) FROM jsonb_each(rt.v3_all('A1')) e
    WHERE e.value::text ~ concat_ws('|', rt.v3('A2'), rt.v3('A3'), rt.v3('TL1'), rt.v3('ADM1'), rt.v3('KT3'), rt.v3('KH3'),
                                    'Agent Two', 'Agent Three', 'Vee Leader', 'Vee Admin', 'V3 Team Three', 'V3 A3 Personal',
                                    rt.v3('RL1'), rt.v3('RL4'), rt.v3('RR1'), rt.v3('RC1'), rt.v3('C1'), '555-01', 'c3a75000', 'c3a73000')),
  0::bigint);
SELECT rt.eq('S12 TL1''s team payloads name only TL1, A1 and A2',
  (SELECT count(*) FROM jsonb_each(rt.v3_all('TL1')) e
    WHERE e.value::text ~ concat_ws('|', rt.v3('A3'), rt.v3('ADM1'), 'Agent Three', 'Vee Admin', '555-01', 'c3a75000', 'c3a73000')),
  0::bigint);
SELECT rt.eq('S13 the only timestamps are as_of and the window boundaries',
  (SELECT count(*) FROM jsonb_each(rt.v3_all('A1')) e, jsonb_path_query(e.value, 'strict $.**') v
    WHERE jsonb_typeof(v) = 'string' AND v #>> '{}' ~ '^\d{4}-\d\d-\d\d[T ]\d\d:\d\d'
      AND v NOT IN (e.value -> 'as_of', coalesce(e.value #> '{window,start_at}', 'null'), coalesce(e.value #> '{window,end_at}', 'null'))),
  0::bigint);
SELECT rt.eq('S13 no unattributed bucket below agency scope',
  concat_ws(' ', rt.v3r('A1', 'disposition_breakdown') #>> '{deep_dive,unattributed}',
            rt.kpi(rt.v3r('A1', 'summary'), 1, 'detail')::jsonb #>> '{unattributed_annual_premium}',
            rt.kpi(rt.v3r('TL1', 'summary'), 2, 'detail')::jsonb #>> '{stored_without_sale}'), '');
SELECT rt.eq('S13 by_agent stays within scope for every reader that has rows',
  (SELECT string_agg(r || '=' || (SELECT string_agg(x ->> 'name', ',' ORDER BY x ->> 'name') FROM jsonb_array_elements(rt.v3r('TL1', r) -> 'by_agent') x), ' ' ORDER BY r)
     FROM unnest(ARRAY['journey', 'sales_appointments', 'summary']) r),
  'journey=Vee Agent One,Vee Agent Two,Vee Leader sales_appointments=Vee Agent One,Vee Agent Two,Vee Leader '
  || 'summary=Vee Agent One,Vee Agent Two,Vee Leader');

-- -----------------------------------------------------------------------------------------------------
-- S14a with the BC1 additions: activity on unrelated identities by an out-of-scope agent (A3) leaves every
-- personal and team payload byte-identical: calls of every class, a contacted call, an inbound call, a
-- numberless unresolved call, a sale, an appointment, a membership and a state change, plus O2 activity.
-- -----------------------------------------------------------------------------------------------------
CREATE TEMP TABLE sec_scoped_before AS SELECT rt.v3_all('TL1') AS team, rt.v3_all('A1') AS personal;
SAVEPOINT s14a;
INSERT INTO rt.v3_ids VALUES ('RL9', 'c3a73000-0000-0000-0000-000000000019'), ('C19', 'c3c00000-0000-0000-0000-000000000019'),
  ('P19', 'c3d00000-0000-0000-0000-000000000019'), ('RC90', 'c3a75000-0000-0000-0000-000000000090'),
  ('RC91', 'c3a75000-0000-0000-0000-000000000091'), ('RC92', 'c3a75000-0000-0000-0000-000000000092');
INSERT INTO public.leads (id, phone, lead_source, assigned_agent_id, created_at, state, organization_id)
VALUES (rt.v3('RL9'), '702-555-0199', 'Facebook', rt.v3('A3'), '2026-10-11 17:00+00', 'WA', rt.v3('O1'));
INSERT INTO public.campaign_leads (id, campaign_id, lead_id, phone, state, organization_id)
VALUES (gen_random_uuid(), rt.v3('KH3'), rt.v3('RL9'), '702-555-0199', 'ID', rt.v3('O1'));
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_id, contact_type, contact_phone, campaign_id, created_at,
                          duration, disposition_id, disposition_name, status, dialer_admission_required, answered_by_agent_id)
VALUES (rt.v3('RC90'), rt.v3('O1'), rt.v3('A3'), 'outbound', rt.v3('RL9'), 'lead', '702-555-0199', rt.v3('KH3'), '2026-10-11 18:00+00', 95, rt.v3('RD_INT'), 'Interested', 'completed', false, NULL),
       (rt.v3('RC91'), rt.v3('O1'), rt.v3('A3'), 'outbound', rt.v3('RL9'), 'lead', '702-555-0199', rt.v3('KH3'), '2026-10-11 18:10+00', 0, NULL, NULL, 'busy', true, NULL),
       (rt.v3('RC92'), rt.v3('O1'), rt.v3('A3'), 'outbound', rt.v3('RL9'), 'lead', '702-555-0199', rt.v3('KH3'), '2026-10-11 18:20+00', 0, NULL, NULL, 'initiated', true, NULL),
       (gen_random_uuid(), rt.v3('O1'), rt.v3('A3'), 'inbound', rt.v3('RL9'), 'lead', '702-555-0199', NULL, '2026-10-11 19:00+00', 60, NULL, NULL, 'completed', false, rt.v3('A3')),
       (gen_random_uuid(), rt.v3('O1'), rt.v3('A3'), 'outbound', NULL, NULL, NULL, NULL, '2026-10-02 18:00+00', 0, NULL, NULL, 'failed', false, NULL);
INSERT INTO private.dialer_outbound_admissions (organization_id, call_id, parent_sid, destination, admitted, reason)
VALUES (rt.v3('O1'), rt.v3('RC91'), 'CAv3reader000000000000000000000091', '+17025550199', false, 'lock_lost');
INSERT INTO public.clients (id, organization_id, premium, assigned_agent_id, state) VALUES (rt.v3('C19'), rt.v3('O1'), 0, rt.v3('A3'), 'UT');
INSERT INTO private.policy_identities (policy_id, organization_id, client_id, source, legacy) VALUES (rt.v3('P19'), rt.v3('O1'), rt.v3('C19'), 'primary', false);
INSERT INTO public.wins (id, organization_id, agent_id, contact_id, policy_id, premium_snapshot, premium_amount, idempotency_key, sold_date, created_at, recorded_at)
VALUES (gen_random_uuid(), rt.v3('O1'), rt.v3('A3'), rt.v3('C19'), rt.v3('P19'), true, 33.00, 'v3:sec:s14a', '2026-10-15', '2026-10-15 18:00+00', '2026-10-15 18:00+00');
INSERT INTO public.appointments (id, title, type, status, created_by, user_id, created_at, organization_id)
VALUES (gen_random_uuid(), 'Review', 'Sales Call', 'Scheduled', rt.v3('A3'), rt.v3('A3'), '2026-10-12 18:00+00', rt.v3('O1'));
INSERT INTO public.contact_history_events (organization_id, contact_id, contact_type, source_table, source_id, action, actor_kind,
                                           actor_id, changed_fields, recorded_at)
VALUES (rt.v3('O1'), rt.v3('RL9'), 'lead', 'leads', rt.v3('RL9'), 'updated', 'agent', rt.v3('A3'), '{state}', '2026-10-13 18:00+00');
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_id, contact_type, created_at, duration, status)
VALUES (gen_random_uuid(), rt.v3('O2'), rt.v3('B1'), 'outbound', rt.v3('RXL1'), 'lead', '2026-10-11 18:00+00', 120, 'completed');
SELECT rt.eq('S14a unrelated activity (A3 and O2) leaves every personal and team payload byte-identical',
  (SELECT team = rt.v3_all('TL1') AND personal = rt.v3_all('A1') FROM sec_scoped_before), true);
-- W16 (recorded 2026-11-20) joins KPI 2 once its recorded time has passed.
SELECT rt.eq('S14a the same activity does reach the agency payload (the fixture is live)',
  rt.kpi(rt.v3r('ADM1', 'summary'), 5) || ' ' || (rt.kpi(rt.v3r('ADM1', 'summary'), 2)::int - (now() >= '2026-11-20 00:00+00')::int), '12 14');
ROLLBACK TO SAVEPOINT s14a;

-- -----------------------------------------------------------------------------------------------------
-- S14b (proposed design): out-of-scope activity on an in-scope identity changes a scoped payload only
-- through the listed effects. E4: a recorded-state change by anyone regroups A1's calls; E6: a lead
-- reassignment changes New leads. Both restore byte-identically. Negative: an out-of-scope call on RL1 after
-- its first contact changes nothing.
-- -----------------------------------------------------------------------------------------------------
SAVEPOINT s14b;
UPDATE public.leads SET state = 'TX' WHERE id = rt.v3('RL1');
INSERT INTO public.contact_history_events (organization_id, contact_id, contact_type, source_table, source_id, action, actor_kind,
                                           actor_id, changed_fields, recorded_at)
VALUES (rt.v3('O1'), rt.v3('RL1'), 'lead', 'leads', rt.v3('RL1'), 'updated', 'agent', rt.v3('A3'), '{state}', '2026-10-20 18:00+00');
SELECT rt.eq('S14b E4: A1''s three RL1 calls move from CA to TX, flagged as changed after the call',
  (SELECT string_agg(concat_ws(':', j ->> 'state', j ->> 'calls_made', j #>> '{basis,calls_changed_after_event}'), ' ' ORDER BY j ->> 'state')
     FROM jsonb_array_elements(rt.v3r('A1', 'state_breakdown') -> 'jurisdictions') j WHERE (j ->> 'calls_made')::int > 0),
  'OR:1:0 TX:3:3');
SELECT rt.eq('S14b E4 changes nothing else in A1''s state payload, and no other reader',
  (SELECT (rt.v3r('A1', 'state_breakdown') - 'jurisdictions') = ((personal -> 'state_breakdown') - 'jurisdictions')
          AND (rt.v3_all('A1') - 'state_breakdown') = (personal - 'state_breakdown') FROM sec_scoped_before), true);
ROLLBACK TO SAVEPOINT s14b;
SAVEPOINT s14b_e6;
UPDATE public.leads SET assigned_agent_id = rt.v3('A3') WHERE id = rt.v3('RL2');
SELECT rt.eq('S14b E6: reassigning RL2 away from A1 lowers A1''s Facebook New leads from 2 to 1 and nothing else',
  (SELECT (e ->> 'new_leads') || ' ' || ((rt.v3r('A1', 'lead_source_calls') - 'sources') = ((personal -> 'lead_source_calls') - 'sources'))::text
          || ' ' || ((rt.v3_all('A1') - 'lead_source_calls') = (personal - 'lead_source_calls'))::text
     FROM jsonb_array_elements(rt.v3r('A1', 'lead_source_calls') -> 'sources') e, sec_scoped_before WHERE e ->> 'lead_source' = 'Facebook'),
  '1 true true');
ROLLBACK TO SAVEPOINT s14b_e6;
SAVEPOINT s14b_negative;
INSERT INTO public.calls (id, organization_id, agent_id, direction, contact_id, contact_type, contact_phone, campaign_id, created_at,
                          duration, disposition_id, disposition_name, status)
VALUES (gen_random_uuid(), rt.v3('O1'), rt.v3('A3'), 'outbound', rt.v3('RL1'), 'lead', '702-555-0101', rt.v3('KO'), '2026-10-20 18:00+00',
        120, rt.v3('RD_INT'), 'Interested', 'completed');
SELECT rt.eq('S14b negative: an out-of-scope call on RL1 after its first contact leaves A1''s and TL1''s payloads byte-identical',
  (SELECT personal = rt.v3_all('A1') AND team = rt.v3_all('TL1') FROM sec_scoped_before), true);
ROLLBACK TO SAVEPOINT s14b_negative;
SELECT rt.eq('S14 every rollback restored the scoped payloads byte-identically',
  (SELECT team = rt.v3_all('TL1') AND personal = rt.v3_all('A1') FROM sec_scoped_before), true);
SELECT rt.assert_sealed_v3(true, false);
