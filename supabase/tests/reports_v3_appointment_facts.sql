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
