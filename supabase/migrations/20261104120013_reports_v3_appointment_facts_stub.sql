-- =====================================================================================================
-- Reports V2, PKG-A file 4 of 8: the Sales Appointments facts stub (plan §2.6, §2.7; D4 §3.1).
--
-- PLACEHOLDER VERSION. Renumbered above the then-current production head, order kept, in a
-- filename-only commit before the PKG-A backend merge. Branch work only: not applied to production.
--
-- Privilege class C (plan §2.8): one private helper, created sealed. No privilege is added, no table is
-- created or read and no data is written. Runs after …10, …11 and …12.
--
--   report_v3_appointment_facts   the final X1 signature. Until PKG-D captures appointment evidence, KPIs 12,
--                                 15, 16, 17 and 18 are unavailable/evidence_not_captured with null numbers,
--                                 coverage and maturity (never a misleading 0), in report_v3_kpi_ids(
--                                 'sales_appointments') order, plus one by_agent row per roster id.
--
-- PKG-D's …43 replaces only this body, under an md5(pg_get_functiondef) preimage guard, inside a v3-only
-- window, and moves report_v3_basis_flags().appointment_evidence to 'installed' (D4 §3.6). No appointment
-- evidence table, trigger, outcome write or capture exists in PKG-A.
-- =====================================================================================================
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'private' AND p.proname = 'report_v3_appointment_facts') THEN
    RAISE EXCEPTION 'Reports v3 appointment stub: refusing replay; the appointment facts helper already exists';
  END IF;
  IF to_regprocedure('private.report_v3_total(integer,numeric,jsonb,text,jsonb)') IS NULL
     OR to_regprocedure('private.report_v3_ratio(integer,numeric,numeric,jsonb,jsonb,text,jsonb)') IS NULL
     OR to_regprocedure('private.report_v3_rate(integer,numeric,numeric,jsonb,jsonb,text,jsonb)') IS NULL
     OR to_regprocedure('private.report_v3_journey_kpis(jsonb)') IS NULL
     OR to_regprocedure('private.report_v3_call_kpis(jsonb,numeric)') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 appointment stub: the foundation (…10) and the call and journey helpers (…12) must be applied first';
  END IF;
  -- The stub is valid only while no appointment evidence is installed and the registry still lists the five
  -- KPIs in this order, with these kinds and evidence_not_captured as a config code for each.
  IF private.report_v3_kpi_ids('sales_appointments') IS DISTINCT FROM ARRAY[12, 15, 16, 17, 18]
     OR private.report_v3_basis_flags() ->> 'appointment_evidence' IS DISTINCT FROM 'not_installed'
     OR (SELECT string_agg((r ->> 'id') || ':' || (r ->> 'kind'), ' ' ORDER BY (r ->> 'id')::int)
           FROM jsonb_array_elements(private.report_v3_metric_registry()) r
          WHERE (r ->> 'id')::int IN (12, 15, 16, 17, 18)) IS DISTINCT FROM '12:ratio 15:count 16:count 17:rate 18:rate'
     OR EXISTS (SELECT 1 FROM unnest(ARRAY[12, 15, 16, 17, 18]) k
                 WHERE NOT coalesce((private.report_v3_kpi_codes() -> k::text -> 'config') ? 'evidence_not_captured', false)) THEN
    RAISE EXCEPTION 'Reports v3 appointment stub: contract drift (registry order, kinds, config codes or basis flags)';
  END IF;
END $preflight$;

-- -----------------------------------------------------------------------------------------------------
-- The stub (D4 §3.1). It reads no table. Arguments:
--   p_agents        report_access_v2 agent ids (NULL = agency; only narrows)
--   p_roster        D1's roster: one by_agent row per distinct non-null id, in first-occurrence order
--   p_reader_as_of  the reader's as_of, now() (X1)
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_appointment_facts(p_org uuid, p_agents uuid[], p_roster uuid[],
                                                    p_start_at timestamptz, p_end_at timestamptz, p_time_zone text,
                                                    p_reader_as_of timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH stub AS (
    SELECT jsonb_build_array(
             private.report_v3_ratio(12, 0, 0, NULL, NULL, 'evidence_not_captured'),
             private.report_v3_total(15, 0, NULL, 'evidence_not_captured'),
             private.report_v3_total(16, 0, NULL, 'evidence_not_captured'),
             private.report_v3_rate(17, 0, 0, NULL, NULL, 'evidence_not_captured'),
             private.report_v3_rate(18, 0, 0, NULL, NULL, 'evidence_not_captured')) AS metrics
  ), roster AS (
    SELECT r.agent_id, min(r.ord) AS ord
      FROM unnest(p_roster) WITH ORDINALITY AS r(agent_id, ord)
     WHERE r.agent_id IS NOT NULL
     GROUP BY r.agent_id
  )
  SELECT jsonb_build_object(
           'metrics', s.metrics,
           'by_agent', coalesce((SELECT jsonb_agg(jsonb_build_object('agent_id', r.agent_id, 'metrics', s.metrics) ORDER BY r.ord)
                                   FROM roster r), '[]'::jsonb))
    FROM stub s;
$$;

REVOKE ALL ON FUNCTION private.report_v3_appointment_facts(uuid, uuid[], uuid[], timestamptz, timestamptz, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

DO $postcondition$
DECLARE f record; r text; n int := 0; v_out jsonb;
BEGIN
  FOR f IN SELECT p.oid, p.prosecdef, p.proconfig, p.proowner, p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname = 'report_v3_appointment_facts' LOOP
    n := n + 1;
    IF f.oid IS DISTINCT FROM to_regprocedure('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)')
       OR f.prosecdef OR f.provolatile <> 's' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
       OR f.proowner <> 'postgres'::regrole THEN
      RAISE EXCEPTION 'Reports v3 appointment stub: helper metadata mismatch: %', f.oid::regprocedure;
    END IF;
    FOREACH r IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(r, f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Reports v3 appointment stub: % can execute %', r, f.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Reports v3 appointment stub: expected 1 helper, found %', n;
  END IF;
  v_out := private.report_v3_appointment_facts(NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  IF (SELECT array_agg((e ->> 'id')::int ORDER BY o) FROM jsonb_array_elements(v_out -> 'metrics') WITH ORDINALITY x(e, o))
       IS DISTINCT FROM ARRAY[12, 15, 16, 17, 18]
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'metrics') e
                 WHERE e ->> 'status' <> 'unavailable' OR e ->> 'reason' <> 'evidence_not_captured' OR e -> 'value' <> 'null'::jsonb)
     OR v_out -> 'by_agent' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Reports v3 appointment stub: unexpected stub payload';
  END IF;
END $postcondition$;
