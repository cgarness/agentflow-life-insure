-- =====================================================================================================
-- Reports v3 appointment facts: the PKG-A stub suite (plan §2.6; D4 §3.1, §7). Disposable synthetic
-- databases only, through scripts/run_reports_v3_tests.sh. PKG-D replaces this suite's body cases with the
-- full truth table when it installs evidence (…43); the shape asserted here is the final one.
--
-- The stub reports KPIs 12, 15, 16, 17 and 18 as unavailable/evidence_not_captured, with null numbers,
-- coverage and maturity: no appointment evidence is captured yet, so a zero would be misleading (BC4).
-- =====================================================================================================

CREATE FUNCTION rt.appt(p_roster uuid[]) RETURNS jsonb LANGUAGE sql AS $$
  SELECT private.report_v3_appointment_facts(rt.v3('J'), NULL, p_roster, '2026-10-01 07:00+00', '2026-11-01 07:00+00',
                                             'America/Los_Angeles', now());
$$;
CREATE FUNCTION rt.appt_ids(p jsonb) RETURNS int[] LANGUAGE sql AS $$
  SELECT array_agg((e ->> 'id')::int ORDER BY o) FROM jsonb_array_elements(p -> 'metrics') WITH ORDINALITY AS x(e, o);
$$;
CREATE FUNCTION rt.appt_roster(p jsonb) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg((e ->> 'agent_id')::uuid ORDER BY o), '{}') FROM jsonb_array_elements(p -> 'by_agent') WITH ORDINALITY AS x(e, o);
$$;
CREATE TEMP TABLE appt_expected AS
SELECT jsonb_agg(jsonb_build_object('id', k.id, 'value', NULL, 'status', 'unavailable', 'reason', 'evidence_not_captured',
                                    'numerator', NULL, 'denominator', NULL, 'coverage', NULL, 'maturity', NULL, 'detail', NULL)
                 ORDER BY k.o) AS metrics
  FROM unnest(ARRAY[12, 15, 16, 17, 18]) WITH ORDINALITY AS k(id, o);

-- -----------------------------------------------------------------------------------------------------
-- 1. The final signature and the seal (class C: created sealed, never granted).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('final X1 signature',
  (SELECT pg_get_function_identity_arguments(p.oid) || ' -> ' || format_type(p.prorettype, NULL)
     FROM pg_proc p WHERE p.oid = to_regprocedure('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)')),
  'p_org uuid, p_agents uuid[], p_roster uuid[], p_start_at timestamp with time zone, p_end_at timestamp with time zone, '
  || 'p_time_zone text, p_reader_as_of timestamp with time zone -> jsonb');
SELECT rt.eq('one appointment facts helper, of any signature',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'report_v3_appointment_facts'), 1::bigint);
SELECT rt.eq('sql, stable, invoker, pinned search_path, owned by postgres, not a set',
  (SELECT concat_ws('|', l.lanname, p.provolatile, p.prosecdef::text, array_to_string(p.proconfig, ';'),
                    pg_get_userbyid(p.proowner), p.proretset::text)
     FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = 'private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)'::regprocedure),
  'sql|s|false|search_path=pg_catalog, pg_temp|postgres|false');
SELECT rt.eq('no client role can execute the stub',
  (SELECT array_agg(has_function_privilege(r, 'private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)', 'EXECUTE') ORDER BY r)
     FROM unnest(ARRAY['anon', 'authenticated', 'reports_v3_inherits_authenticated', 'reports_v3_public_only', 'service_role']) r),
  ARRAY[false, false, false, false, false]);

-- -----------------------------------------------------------------------------------------------------
-- 2. Five envelopes in registry order, each unavailable/evidence_not_captured with nothing invented.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('top-level keys', (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(rt.appt(ARRAY[rt.v3('JA1')])) k),
             ARRAY['by_agent', 'metrics']);
SELECT rt.eq('KPI ids in the sales appointments registry order', rt.appt_ids(rt.appt(NULL)),
             private.report_v3_kpi_ids('sales_appointments'));
SELECT rt.eq('registry order is 12, 15, 16, 17, 18', private.report_v3_kpi_ids('sales_appointments'), ARRAY[12, 15, 16, 17, 18]);
SELECT rt.eq('every envelope is unavailable/evidence_not_captured with null numbers, coverage, maturity and detail',
             rt.appt(NULL) -> 'metrics', (SELECT metrics FROM appt_expected));
SELECT rt.eq('built only through the foundation builders (ratio 12, totals 15 and 16, rates 17 and 18)',
             rt.appt(NULL) -> 'metrics',
             jsonb_build_array(private.report_v3_ratio(12, 0, 0, NULL, NULL, 'evidence_not_captured'),
                               private.report_v3_total(15, 0, NULL, 'evidence_not_captured'),
                               private.report_v3_total(16, 0, NULL, 'evidence_not_captured'),
                               private.report_v3_rate(17, 0, 0, NULL, NULL, 'evidence_not_captured'),
                               private.report_v3_rate(18, 0, 0, NULL, NULL, 'evidence_not_captured')));
SELECT rt.eq('the counts 15 and 16 are null, never a misleading 0',
             (SELECT array_agg(jsonb_typeof(e -> 'value') ORDER BY o) FROM jsonb_array_elements(rt.appt(NULL) -> 'metrics')
                     WITH ORDINALITY x(e, o) WHERE (e ->> 'id')::int IN (15, 16)),
             ARRAY['null', 'null']);
SELECT rt.eq('no number anywhere in the payload, by_agent rows included',
             (SELECT count(*) FROM jsonb_path_query(rt.appt(ARRAY[rt.v3('JA1'), rt.v3('JA2')]), 'strict $.**') v
               WHERE jsonb_typeof(v) = 'number' AND v NOT IN (SELECT to_jsonb(i) FROM unnest(ARRAY[12, 15, 16, 17, 18]) i)),
             0::bigint);
SELECT rt.eq('the 30-day groups 12 and 18 carry no maturity block under a config reason (rule 7)',
             (SELECT array_agg(jsonb_typeof(e -> 'maturity') ORDER BY o) FROM jsonb_array_elements(rt.appt(NULL) -> 'metrics')
                     WITH ORDINALITY x(e, o) WHERE (e ->> 'id')::int IN (12, 18)),
             ARRAY['null', 'null']);
SELECT rt.eq('evidence_not_captured is a config code for each of the five KPIs',
             (SELECT array_agg((private.report_v3_kpi_codes() -> k::text -> 'config') ? 'evidence_not_captured' ORDER BY k)
                FROM unnest(ARRAY[12, 15, 16, 17, 18]) k),
             ARRAY[true, true, true, true, true]);

-- -----------------------------------------------------------------------------------------------------
-- 3. Roster behavior: one by_agent row per roster id, in roster order, each with the same five envelopes.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('by_agent = roster, in roster order', rt.appt_roster(rt.appt(ARRAY[rt.v3('JA2'), rt.v3('JA1'), rt.v3('JA3')])),
             ARRAY[rt.v3('JA2'), rt.v3('JA1'), rt.v3('JA3')]);
SELECT rt.eq('a repeated id gives one row at its first position; a NULL id gives none',
             rt.appt_roster(rt.appt(ARRAY[rt.v3('JA1'), NULL, rt.v3('JA2'), rt.v3('JA1')])), ARRAY[rt.v3('JA1'), rt.v3('JA2')]);
SELECT rt.eq('an empty roster gives no rows', rt.appt('{}') -> 'by_agent', '[]'::jsonb);
SELECT rt.eq('a NULL roster gives no rows', rt.appt(NULL) -> 'by_agent', '[]'::jsonb);
SELECT rt.eq('by_agent rows carry exactly agent_id and metrics',
             (SELECT array_agg(DISTINCT k ORDER BY k) FROM jsonb_array_elements(rt.appt(ARRAY[rt.v3('JA1'), rt.v3('JA2')]) -> 'by_agent') e,
                     jsonb_object_keys(e) k),
             ARRAY['agent_id', 'metrics']);
SELECT rt.eq('every by_agent row has the same five envelopes as the total',
             (SELECT bool_and(e -> 'metrics' = (SELECT metrics FROM appt_expected))
                FROM jsonb_array_elements(rt.appt(ARRAY[rt.v3('JA1'), rt.v3('JA2'), rt.v3('JA3')]) -> 'by_agent') e),
             true);

-- -----------------------------------------------------------------------------------------------------
-- 4. Reads no table, so no organization's data can reach it; only the roster changes the result.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('the result ignores organization, agents, window, time zone and as_of',
  (SELECT count(DISTINCT x) FROM (VALUES
     (rt.appt(ARRAY[rt.v3('JA1')])),
     (private.report_v3_appointment_facts(rt.v3('JX'), ARRAY[rt.v3('JXA')], ARRAY[rt.v3('JA1')], '2026-09-01 04:00+00',
                                          '2026-09-02 04:00+00', 'America/New_York', '2026-01-01 00:00+00')),
     (private.report_v3_appointment_facts(NULL, '{}', ARRAY[rt.v3('JA1')], NULL, NULL, NULL, NULL))) v(x)),
  1::bigint);
SAVEPOINT appt_no_tables;
ALTER TABLE public.appointments RENAME TO appointments_hidden;
ALTER TABLE public.wins RENAME TO wins_hidden;
ALTER TABLE public.calls RENAME TO calls_hidden;
ALTER TABLE public.profiles RENAME TO profiles_hidden;
ALTER TABLE public.clients RENAME TO clients_hidden;
SELECT rt.eq('the stub reads no table', rt.appt(ARRAY[rt.v3('JA1')]),
             jsonb_build_object('metrics', (SELECT metrics FROM appt_expected),
                                'by_agent', jsonb_build_array(jsonb_build_object('agent_id', rt.v3('JA1'),
                                                                                 'metrics', (SELECT metrics FROM appt_expected)))));
ROLLBACK TO SAVEPOINT appt_no_tables;

-- -----------------------------------------------------------------------------------------------------
-- 5. Contract metadata is unchanged: appointment evidence stays not_installed at contract 3.0.0 until …43.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('basis flags unchanged by the stub', private.report_v3_basis_flags(),
  '{"contract_version":"3.0.0","corrections":"not_installed","sale_call_links":"not_installed","appointment_evidence":"not_installed"}'::jsonb);
SELECT rt.eq('the five registry rows keep their kinds and credit',
  (SELECT string_agg(concat_ws(':', r ->> 'id', r ->> 'kind', r ->> 'credit', r ->> 'cohort_30d'), ' ' ORDER BY (r ->> 'id')::int)
     FROM jsonb_array_elements(private.report_v3_metric_registry()) r WHERE (r ->> 'id')::int IN (12, 15, 16, 17, 18)),
  '12:ratio:assigned_agent_at_start:true 15:count:setter:false 16:count:assigned_agent_at_start:false '
  || '17:rate:assigned_agent_at_start:false 18:rate:assigned_agent_at_start:true');
SELECT rt.assert_v3_helper_shape();
SELECT rt.assert_sealed_v3(true, false);

-- -----------------------------------------------------------------------------------------------------
-- 6. Mutation controls: the suite must reject a misleading zero, a lost roster and a broken registry order.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.reject_mutation('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)',
  'private.report_v3_total(15, 0, NULL, ''evidence_not_captured'')', 'private.report_v3_total(15, 0, NULL, NULL)',
  $probe$SELECT rt.eq('mutated misleading zero', rt.appt(NULL) -> 'metrics', (SELECT metrics FROM appt_expected))$probe$,
  'mutated misleading zero FAIL');
SELECT rt.reject_mutation('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)',
  'unnest(p_roster)', 'unnest(''{}''::uuid[])',
  $probe$SELECT rt.eq('mutated roster', rt.appt_roster(rt.appt(ARRAY[rt.v3('JA1')])), ARRAY[rt.v3('JA1')])$probe$,
  'mutated roster FAIL');
SELECT rt.reject_mutation('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)',
  'private.report_v3_rate(17, 0, 0, NULL, NULL, ''evidence_not_captured''),', '',
  $probe$SELECT rt.eq('mutated registry order', rt.appt_ids(rt.appt(NULL)), private.report_v3_kpi_ids('sales_appointments'))$probe$,
  'mutated registry order FAIL');

-- -----------------------------------------------------------------------------------------------------
-- 7. The sales appointments reader (…15) over the stub: truthful unavailable/evidence_not_captured envelopes,
--    by_agent = the server-resolved roster with names, statuses and the per-KPI credit map. No appointment
--    evidence, category or outcome is read or written (PKG-D).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('reader metrics are the stub''s five envelopes', rt.v3r('ADM1', 'sales_appointments') -> 'metrics', (SELECT metrics FROM appt_expected));
SELECT rt.eq('agency roster: the Active profiles, by name, each with the credit map and the same five envelopes',
  (SELECT string_agg(concat_ws(':', e ->> 'name', e ->> 'status', (e -> 'metrics' = (SELECT metrics FROM appt_expected))::text), ', ' ORDER BY o)
     FROM jsonb_array_elements(rt.v3r('ADM1', 'sales_appointments') -> 'by_agent') WITH ORDINALITY x(e, o)),
  'Vee Admin:Active:true, Vee Agent One:Active:true, Vee Agent Three:Active:true, Vee Agent Two:Active:true, Vee Leader:Active:true');
SELECT rt.eq('the credit map: 12, 16, 17, 18 assigned agent at the appointment time; 15 setter',
  (SELECT DISTINCT e -> 'credit' FROM jsonb_array_elements(rt.v3r('ADM1', 'sales_appointments') -> 'by_agent') e),
  '{"12": "assigned_agent_at_start", "15": "setter", "16": "assigned_agent_at_start", "17": "assigned_agent_at_start", "18": "assigned_agent_at_start"}'::jsonb);
SELECT rt.eq('the roster follows the resolved scope: personal, team, agency filter',
  concat_ws(' | ',
    (SELECT string_agg(e ->> 'name', ',') FROM jsonb_array_elements(rt.v3r('A1', 'sales_appointments') -> 'by_agent') e),
    (SELECT string_agg(e ->> 'name', ',' ORDER BY e ->> 'name' COLLATE "C") FROM jsonb_array_elements(rt.v3r('TL1', 'sales_appointments') -> 'by_agent') e),
    (SELECT string_agg(e ->> 'name', ',') FROM jsonb_array_elements(rt.v3r('ADM1', 'sales_appointments', NULL, 'A3') -> 'by_agent') e)),
  'Vee Agent One | Vee Agent One,Vee Agent Two,Vee Leader | Vee Agent Three');
SELECT rt.eq('reader meta: no policy basis, appointment evidence not installed, contract 3.0.0',
  concat_ws(' ', rt.v3r('A1', 'sales_appointments') ->> 'reader', (rt.v3r('A1', 'sales_appointments') ? 'policy_basis')::text,
            rt.v3r('A1', 'sales_appointments') #>> '{basis,appointment_evidence}', rt.v3r('A1', 'sales_appointments') ->> 'contract_version'),
  'sales_appointments false not_installed 3.0.0');
CREATE TEMP TABLE appt_reader_before AS SELECT rt.v3r('ADM1', 'sales_appointments') AS agency, rt.v3r('A1', 'sales_appointments') AS personal;
SAVEPOINT appt_reader;
INSERT INTO public.appointments (id, title, type, status, created_by, user_id, created_at, organization_id)
VALUES (gen_random_uuid(), 'Sales review', 'Sales Call', 'Completed', rt.v3('A1'), rt.v3('A1'), '2026-10-12 18:00+00', rt.v3('O1')),
       (gen_random_uuid(), 'Sales review', 'Sales Call', 'Scheduled', rt.v3('A3'), rt.v3('A3'), '2026-10-13 18:00+00', rt.v3('O1'));
SELECT rt.eq('appointments in the window move no KPI before PKG-D: the payloads are byte-identical',
  (SELECT agency = rt.v3r('ADM1', 'sales_appointments') AND personal = rt.v3r('A1', 'sales_appointments') FROM appt_reader_before), true);
ROLLBACK TO SAVEPOINT appt_reader;
SELECT rt.assert_sealed_v3(true, false);

-- @@pkg-d@@
-- PKG-D Sales Appointments on captured evidence (D4 §3.6, §7), after …43, on the v3 fixture organization O1
-- (America/Los_Angeles), October 2026. Everything is written inside a savepoint that is rolled back. The capture is
-- installed "today", so a closed capture window from 2026-09-01 to the install is added first (continuous capture).
-- Synthetic appointments (contact, assignee at start, type, start, final status):
--   AP1 C1 A1 Sales Call  Oct 5  Completed  → W17 (A2 → C1, Oct 12, within 30 days) linked to AP1: success
--   AP2 C3 A2 Sales Call  Oct 2  Completed  → W3 (C3, Oct 3) eligible, unlinked: unresolved
--   AP3 C5 A1 Sales Call  Oct 6  No Show    (reassigned to A2 after its start: credit stays A1)
--   AP4 C6 A3 Sales Call  Oct 7  Scheduled  → due without an outcome: unresolved
--   AP5 C1 A1 Follow Up   Oct 8  Completed  → never a Sales Appointment
--   AP6 C2 A1 Sales Call  +2 days Scheduled → booked in October, not due
--   AP7 C9 —  Sales Call  Oct 9  Completed  → no assignee at start: agency totals only; W9 (Oct 7) is before it
CREATE FUNCTION rt.pd_kpi(p jsonb, p_id int) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws('|', e ->> 'status', coalesce(e ->> 'reason', '-'), coalesce(e ->> 'value', '-'), coalesce(e ->> 'numerator', '-'),
                   coalesce(e ->> 'denominator', '-'))
    FROM jsonb_array_elements(p -> 'metrics') e WHERE (e ->> 'id')::int = p_id $$;
-- The helper as the reader calls it, with the as-of at the current instant: this suite writes its evidence in the same
-- transaction, after now(), so the reader's now() would (correctly) not see it yet. October = the agency month.
CREATE FUNCTION rt.pd_facts(p_agents text[] DEFAULT NULL, p_start timestamptz DEFAULT '2026-10-01 07:00+00',
                            p_end timestamptz DEFAULT '2026-11-01 07:00+00') RETURNS jsonb LANGUAGE sql AS $$
  SELECT private.report_v3_appointment_facts(rt.v3('O1'), (SELECT array_agg(rt.v3(a)) FROM unnest(p_agents) a),
    ARRAY[rt.v3('A1'), rt.v3('A2'), rt.v3('A3')], p_start, p_end, 'America/Los_Angeles', clock_timestamp()) $$;
CREATE FUNCTION rt.pd_agent(p jsonb, p_agent text, p_id int) RETURNS text LANGUAGE sql AS $$
  SELECT rt.pd_kpi(r, p_id) FROM jsonb_array_elements(p -> 'by_agent') r WHERE (r ->> 'agent_id')::uuid = rt.v3(p_agent) $$;

SAVEPOINT pd_facts;
-- Test-only, rolled back with the savepoint: the synthetic id lookup is readable while a call runs as authenticated.
GRANT USAGE ON SCHEMA rt TO authenticated; GRANT SELECT ON rt.v3_ids TO authenticated;
INSERT INTO private.appointment_evidence_capture_windows (capture_kind, started_at, ended_at, ended_reason)
SELECT 'appointment_outcomes', '2026-09-01 00:00+00', w.started_at, 'synthetic_history' FROM private.appointment_evidence_capture_windows w
 WHERE w.capture_kind = 'appointment_outcomes' AND w.ended_at IS NULL;
CREATE TEMP TABLE pd2 AS SELECT
  rt.pd_appt('ap1', 'C1', 'A1', 'Sales Call', '2026-10-05 17:00+00', '2026-10-02 17:00+00', 'Completed', 'A1') AS ap1,
  rt.pd_appt('ap2', 'C3', 'A2', 'Sales Call', '2026-10-02 17:00+00', '2026-10-01 17:00+00', 'Completed', 'A2') AS ap2,
  rt.pd_appt('ap3', 'C5', 'A1', 'Sales Call', '2026-10-06 17:00+00', '2026-10-02 17:00+00', 'No Show', 'A1') AS ap3,
  rt.pd_appt('ap4', 'C6', 'A3', 'Sales Call', '2026-10-07 17:00+00', '2026-10-02 17:00+00', 'Scheduled', 'A3') AS ap4,
  rt.pd_appt('ap5', 'C1', 'A1', 'Follow Up', '2026-10-08 17:00+00', '2026-10-02 17:00+00', 'Completed', 'A1') AS ap5,
  rt.pd_appt('ap6', 'C2', 'A1', 'Sales Call', now() + interval '2 days', '2026-10-03 17:00+00', 'Scheduled', 'A1') AS ap6,
  rt.pd_appt('ap7', 'C9', NULL, 'Sales Call', '2026-10-09 17:00+00', '2026-10-03 17:00+00', 'Completed', 'ADM1') AS ap7;
SELECT rt.pd_as('ADM1');
UPDATE public.appointments SET user_id = rt.v3('A2') WHERE id = (SELECT ap3 FROM pd2);
SELECT rt.eq('W17 linked to AP1', rt.pd_link('ADM1', 'f1', 'W17', (SELECT ap1 FROM pd2)) ->> 'status', 'linked');

CREATE TEMP TABLE pdr AS SELECT rt.pd_facts() AS p;
SELECT rt.eq('payload meta: 3.3.0, all three bases installed (release order B, C, D)',
  (SELECT p ->> 'contract_version' || '/' || (p #>> '{basis,appointment_evidence}') || '/' || (p #>> '{basis,corrections}')
          || '/' || (p #>> '{basis,sale_call_links}')
     FROM (SELECT rt.v3r('ADM1', 'sales_appointments') AS p) x),
  '3.3.0/installed/audited_ledger/installed');
SELECT rt.eq('KPI 15: six sales bookings in October (Follow Up excluded); complete', (SELECT rt.pd_kpi(p, 15) FROM pdr), 'available|-|6|-|-');
SELECT rt.eq('KPI 15 disclosures and basis', (SELECT e -> 'detail' -> 'disclosures' ->> 'non_sales_excluded' || '/'
    || (e -> 'detail' -> 'basis_counts' ->> 'capture') || '/' || (e -> 'detail' -> 'unattributed' ->> 'bookings')
  FROM pdr, jsonb_array_elements(p -> 'metrics') e WHERE (e ->> 'id')::int = 15), '1/6/1');
SELECT rt.eq('KPI 16: 3 held; AP4 is due without an outcome', (SELECT rt.pd_kpi(p, 16) FROM pdr), 'partial|outcomes_unresolved|3|-|-');
SELECT rt.eq('KPI 17: 3 held of 4 resolved', (SELECT rt.pd_kpi(p, 17) FROM pdr), 'partial|outcomes_unresolved|75|3|4');
SELECT rt.eq('KPI 17 classes', (SELECT e -> 'detail' -> 'classes' FROM pdr, jsonb_array_elements(p -> 'metrics') e WHERE (e ->> 'id')::int = 17),
  '{"held": 3, "no_show": 1, "unresolved": 1, "cancelled_at_or_after_start": 0}'::jsonb);
SELECT rt.eq('KPI 18: AP1 succeeded; AP7 resolved without a sale; AP2 unresolved', (SELECT rt.pd_kpi(p, 18) FROM pdr), 'partial|attribution_unresolved|50|1|2');
SELECT rt.eq('KPI 12: 2 resolved members ÷ 1 attributed policy', (SELECT rt.pd_kpi(p, 12) FROM pdr), 'partial|attribution_unresolved|2|2|1');
SELECT rt.eq('KPI 18 maturity (pending computed from the as_of)',
  (SELECT e -> 'maturity' FROM pdr, jsonb_array_elements(p -> 'metrics') e WHERE (e ->> 'id')::int = 18),
  (SELECT jsonb_build_object('window_days', 30, 'state', CASE WHEN count(*) FILTER (WHERE clock_timestamp() < private.report_v3_local_day_start(d + 31, 'America/Los_Angeles')) > 0
            THEN 'in_progress' ELSE 'complete' END, 'members', 3,
          'pending', count(*) FILTER (WHERE clock_timestamp() < private.report_v3_local_day_start(d + 31, 'America/Los_Angeles')),
          'successes_to_date', 1, 'mature_members', 3 - count(*) FILTER (WHERE clock_timestamp() < private.report_v3_local_day_start(d + 31, 'America/Los_Angeles')),
          'mature_successes', CASE WHEN clock_timestamp() < private.report_v3_local_day_start('2026-10-05'::date + 31, 'America/Los_Angeles') THEN 0 ELSE 1 END,
          'fully_mature_on', '2026-11-09')
     FROM unnest(ARRAY['2026-10-05', '2026-10-02', '2026-10-09']::date[]) d));
-- Credit: assigned agent at the start (AP3 stays A1's after its reassignment); AP7 credits no one.
SELECT rt.eq('by_agent 16 and 17', (SELECT concat_ws(' ; ', rt.pd_agent(p, 'A1', 16), rt.pd_agent(p, 'A1', 17), rt.pd_agent(p, 'A2', 16),
    rt.pd_agent(p, 'A3', 16), rt.pd_agent(p, 'A1', 18), rt.pd_agent(p, 'A1', 15)) FROM pdr),
  'available|-|1|-|- ; available|-|50|1|2 ; available|-|1|-|- ; unavailable|outcomes_unresolved|-|-|- ; available|-|100|1|1 ; available|-|3|-|-');
SELECT rt.eq('the agency unattributed counts', (SELECT e -> 'detail' -> 'unattributed' FROM pdr, jsonb_array_elements(p -> 'metrics') e
  WHERE (e ->> 'id')::int = 16), '{"bookings": 1, "members": 1, "occurrences": 1}'::jsonb);
SELECT rt.eq('personal scope (A1) carries no unattributed detail', (SELECT e -> 'detail' ? 'unattributed'
  FROM jsonb_array_elements(rt.pd_facts(ARRAY['A1']) -> 'metrics') e WHERE (e ->> 'id')::int = 16), false);

-- S14a / S14b (D4 §3.7, privacy option a, ★1 pending): A1's personal payload.
CREATE TEMP TABLE pd_s14 AS SELECT rt.pd_facts(ARRAY['A1']) -> 'metrics' AS m;
SAVEPOINT pd_s14a;
-- S14a: A2's held appointment on an unrelated identity (C15) and its sale change nothing for A1.
SELECT rt.pd_appt('s14a', 'C15', 'A2', 'Sales Call', '2026-10-11 17:00+00', '2026-10-03 17:00+00', 'Completed', 'A2');
SELECT rt.eq('S14a: out-of-scope activity on an unrelated identity leaves A1''s payload byte-identical',
  rt.pd_facts(ARRAY['A1']) -> 'metrics', (SELECT m FROM pd_s14));
ROLLBACK TO SAVEPOINT pd_s14a;
SAVEPOINT pd_s14b;
-- S14b (E3): A1 held a sales appointment with C14 on Oct 20; A2 sold C14 on Oct 31 (W14, within 30 days).
SELECT rt.pd_appt('s14b', 'C14', 'A1', 'Sales Call', '2026-10-20 17:00+00', '2026-10-03 17:00+00', 'Completed', 'A1');
SELECT rt.eq('S14b unlinked: the out-of-scope purchase leaves A1''s member unresolved',
  rt.pd_kpi(rt.pd_facts(ARRAY['A1']), 18), 'partial|attribution_unresolved|100|1|1');
-- Linked to another appointment (A2's, same buyer): A1's member is resolved as no sale.
SELECT rt.pd_appt('s14b2', 'C14', 'A2', 'Sales Call', '2026-10-21 17:00+00', '2026-10-03 17:00+00', 'Completed', 'A2');
SELECT rt.eq('the link to A2''s appointment', rt.pd_link('ADM1', 's14b', 'W14', md5('pkgd:s14b2')::uuid) ->> 'status', 'linked');
SELECT rt.eq('S14b linked elsewhere: A1''s member resolves as no sale',
  rt.pd_kpi(rt.pd_facts(ARRAY['A1']), 18), 'available|-|50|1|2');
SELECT rt.eq('S14b exposes no other agent''s or buyer''s id in A1''s metrics',
  (rt.pd_facts(ARRAY['A1']) -> 'metrics')::text ~ ('(' || rt.v3('A2') || '|' || rt.v3('C14') || ')'), false);
ROLLBACK TO SAVEPOINT pd_s14b;
SELECT rt.eq('removing the S14 activity restores A1''s payload byte-identically', rt.pd_facts(ARRAY['A1']) -> 'metrics', (SELECT m FROM pd_s14));

-- Reconciliation: AP1's status changes while capture is off → a capture_gap, unassessable for 16-18.
ALTER TABLE public.appointments DISABLE TRIGGER appointments_v3_evidence_capture;
UPDATE public.appointments SET status = 'No Show' WHERE id = (SELECT ap1 FROM pd2);
ALTER TABLE public.appointments ENABLE TRIGGER appointments_v3_evidence_capture;
SELECT rt.eq('a state change without evidence is a capture_gap',
  (SELECT rt.pd_kpi(p, 16) || ' ' || (e -> 'coverage' -> 'reasons' ->> 'capture_gap')
     FROM (SELECT rt.pd_facts() AS p) x, jsonb_array_elements(x.p -> 'metrics') e WHERE (e ->> 'id')::int = 16),
  'partial|capture_gap|2|-|- 1');

-- Capture start: a window ending before the first capture window has no outcome evidence.
SELECT rt.eq('outcome_capture_not_started before the capture start',
  (SELECT rt.pd_kpi(x.p, 16) || ' ' || rt.pd_kpi(x.p, 12) FROM (SELECT rt.pd_facts(NULL, '2026-08-01 07:00+00', '2026-09-01 00:00+00') AS p) x),
  'unavailable|outcome_capture_not_started|-|-|- unavailable|outcome_capture_not_started|-|-|-');
SELECT rt.eq('every reason is a registered code', (SELECT bool_and(e ->> 'reason' IS NULL OR e ->> 'reason' = ANY (private.report_v3_reason_codes()))
  FROM pdr, jsonb_array_elements(p -> 'metrics') e), true);
ROLLBACK TO SAVEPOINT pd_facts;
