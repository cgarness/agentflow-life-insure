-- =====================================================================================================
-- Group leaderboard INDEX PROOF (runner step 7) on group_leaderboard_perf_data.sql (600k appointments).
-- Run with -v phase=before on the PRE-repair database, then apply the repair migration + VACUUM ANALYZE, then run
-- with -v phase=after. EXPLAIN (ANALYZE, BUFFERS) of the function's exact appointment lookup for the 120-profile
-- roster, and of the whole RPC. Assertions (phase=after): the setter lookup is served by
-- appointments_setter_created_at_idx with NO sequential scan of appointments, and it touches at most 5% of the
-- buffers and takes at most 10% of the time the same lookup needed without the index.
-- Disposable LOCAL PostgreSQL only (AGENT_RULES #28).
-- =====================================================================================================
\set ON_ERROR_STOP 1
SET max_parallel_workers_per_gather = 0;

SET client_min_messages = warning;
CREATE TABLE IF NOT EXISTS gt.perf (
  label                text PRIMARY KEY,
  exec_ms              numeric,
  buffers              bigint,
  uses_setter_index    boolean,
  seq_on_appointments  boolean,
  appointments_access  text
);

RESET client_min_messages;
CREATE OR REPLACE FUNCTION gt.lookup_plan(pred text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j jsonb;
BEGIN
  EXECUTE format($q$
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT p.id, a.appointments_set
    FROM public.profiles p
    JOIN public.organizations o ON o.id = p.organization_id
    JOIN public.agency_group_members agm
      ON agm.organization_id = p.organization_id
     AND agm.agency_group_id = '99999999-0000-4000-8000-000000000001' AND agm.status = 'active'
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::bigint AS appointments_set
      FROM public.appointments ap
      WHERE %s
        AND ap.created_at >= (date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles')
    ) a ON TRUE
    WHERE p.role IN ('Agent', 'Team Leader', 'Team Lead', 'Admin') AND p.status = 'Active'$q$, pred) INTO j;
  RETURN j;
END $$;

-- The whole RPC, as a member of Perf Org 1 (claims set by the caller of this function).
CREATE OR REPLACE FUNCTION gt.rpc_plan() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j jsonb;
BEGIN
  EXECUTE $q$EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT * FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month')$q$ INTO j;
  RETURN j;
END $$;

CREATE OR REPLACE FUNCTION gt.record(p_label text, j jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO gt.perf (label, exec_ms, buffers, uses_setter_index, seq_on_appointments, appointments_access)
  SELECT p_label,
         round((j -> 0 ->> 'Execution Time')::numeric, 3),
         coalesce((j -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint, 0) + coalesce((j -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint, 0),
         jsonb_path_exists(j, '$.** ? (@."Index Name" == "appointments_setter_created_at_idx")'),
         jsonb_path_exists(j, '$.** ? (@."Relation Name" == "appointments" && @."Node Type" == "Seq Scan")'),
         (SELECT string_agg(DISTINCT (n ->> 'Node Type') || coalesce(' using ' || (n ->> 'Index Name'), ''), '; ')
            FROM jsonb_path_query(j, '$.** ? (@."Relation Name" == "appointments")') n)
  ON CONFLICT (label) DO UPDATE SET exec_ms = EXCLUDED.exec_ms, buffers = EXCLUDED.buffers,
    uses_setter_index = EXCLUDED.uses_setter_index, seq_on_appointments = EXCLUDED.seq_on_appointments,
    appointments_access = EXCLUDED.appointments_access;
$$;

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-0000000003e9","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000001"}}', false) AS claims \gset

\if :{?phase}
\else
\echo 'set -v phase=before|after'
\quit
\endif

SELECT :'phase' = 'before' AS is_before \gset
\if :is_before
-- Warm once, then measure. The pre-repair function needs use_column (it raises 42702 otherwise).
SELECT gt.lookup_plan('ap.user_id = p.id') IS NOT NULL AS warm \gset
SELECT gt.record('1 lookup, pre-repair predicate ap.user_id = p.id', gt.lookup_plan('ap.user_id = p.id')) AS recorded \gset
SELECT gt.lookup_plan('COALESCE(ap.created_by, ap.user_id) = p.id') IS NOT NULL AS warm \gset
SELECT gt.record('2 lookup, setter predicate WITHOUT the index', gt.lookup_plan('COALESCE(ap.created_by, ap.user_id) = p.id')) AS recorded \gset
SET plpgsql.variable_conflict = use_column;
SELECT gt.rpc_plan() IS NOT NULL AS warm \gset
SELECT gt.record('4 RPC, pre-repair (needs use_column; production raises 42702)', gt.rpc_plan()) AS recorded \gset
\else
SET plpgsql.variable_conflict = error;
SELECT gt.lookup_plan('COALESCE(ap.created_by, ap.user_id) = p.id') IS NOT NULL AS warm \gset
SELECT gt.record('3 lookup, setter predicate WITH the index', gt.lookup_plan('COALESCE(ap.created_by, ap.user_id) = p.id')) AS recorded \gset
SELECT gt.rpc_plan() IS NOT NULL AS warm \gset
SELECT gt.record('5 RPC, repaired (variable_conflict=error)', gt.rpc_plan()) AS recorded \gset
-- The repaired RPC with the index removed inside a rolled-back subtransaction: the regression the index prevents.
DO $t$
DECLARE j jsonb;
BEGIN
  BEGIN
    EXECUTE 'DROP INDEX public.appointments_setter_created_at_idx';
    j := gt.rpc_plan();
    RAISE EXCEPTION 'undo the drop';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  PERFORM gt.record('6 RPC, repaired but WITHOUT the index', j);
END $t$;

DO $t$
DECLARE with_idx gt.perf; without_idx gt.perf;
BEGIN
  SELECT * INTO with_idx    FROM gt.perf WHERE label LIKE '3 %';
  SELECT * INTO without_idx FROM gt.perf WHERE label LIKE '2 %';
  PERFORM gt.eq('index selected for the setter lookup', with_idx.uses_setter_index, true);
  PERFORM gt.eq('no sequential scan of appointments', with_idx.seq_on_appointments, false);
  PERFORM gt.eq('without the index the lookup seq-scans (the regression is real)', without_idx.seq_on_appointments, true);
  PERFORM gt.eq('buffers with the index <= 5% of without', with_idx.buffers * 20 <= without_idx.buffers, true);
  PERFORM gt.eq('time with the index <= 10% of without', with_idx.exec_ms * 10 <= without_idx.exec_ms, true);
  PERFORM gt.eq('repaired RPC faster with the index',
    (SELECT exec_ms FROM gt.perf WHERE label LIKE '5 %') * 10 <= (SELECT exec_ms FROM gt.perf WHERE label LIKE '6 %'), true);
  RAISE NOTICE 'INDEX PROOF OK';
END $t$;
SELECT label, exec_ms, buffers, uses_setter_index AS setter_idx, seq_on_appointments AS seq_scan, appointments_access
  FROM gt.perf ORDER BY label;
\endif
