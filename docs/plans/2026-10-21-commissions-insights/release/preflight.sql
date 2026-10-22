-- Commissions insights, Gate 2 (database only): READ-ONLY preflight for 20261021180000_policy_commission_center_insights.sql.
-- Run as postgres against production immediately before the apply, after Chris's Gate 2 approval. It reads catalog
-- state and row counts; it never writes. Every row in the first result must read ok = t; stop if any does not.
WITH checks(n, check_name, value, ok) AS (
  SELECT 1, 'server_version', current_setting('server_version'), current_setting('server_version_num')::int >= 160000
  UNION ALL
  SELECT 2, 'prerequisites_recorded', '20261019170000, 20261020040000, 20261020212000',
         (SELECT count(*) FROM supabase_migrations.schema_migrations
           WHERE version IN ('20261019170000', '20261020040000', '20261020212000')) = 3
  UNION ALL
  -- The HOSTED history decides, not source filenames: nothing may be recorded at or after this version.
  SELECT 3, 'version_free_and_sorts_last', (SELECT max(version) FROM supabase_migrations.schema_migrations),
         NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version >= '20261021180000')
  UNION ALL
  SELECT 4, 'applied_20261019170000_unchanged', NULL,
         (SELECT encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') FROM supabase_migrations.schema_migrations
           WHERE version = '20261019170000') = 'b3e4d53fcced800be3c8b09567ef66c2faebb21937634e3f17aa2d6228011f1f'
  UNION ALL
  SELECT 5, 'applied_20261020040000_unchanged', NULL,
         (SELECT encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') FROM supabase_migrations.schema_migrations
           WHERE version = '20261020040000') = '10897ad6123dc052e5cbe5340a821e3ce8595f99f1448e74832e18fb2d0a5ea8'
  UNION ALL
  SELECT 6, 'applied_20261020212000_unchanged', NULL,
         (SELECT encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') FROM supabase_migrations.schema_migrations
           WHERE version = '20261020212000') = '5bc2eb14b52bf72c2516d6d134c0dac52bea052504aff8bb9e723d08fdbd3e08'
  UNION ALL
  SELECT 7, 'prerequisite_objects', 'reporting schema, policy_fact, overview read, organizations',
         to_regnamespace('policy_commission_reporting') IS NOT NULL
         AND to_regtype('policy_commission_reporting.policy_fact') IS NOT NULL
         AND to_regprocedure('public.get_my_commission_overview(text,date,date)') IS NOT NULL
         AND to_regclass('public.organizations') IS NOT NULL
  UNION ALL
  SELECT 8, 'insights_schema_and_goal_table_absent', NULL,
         to_regnamespace('policy_commission_insights') IS NULL AND to_regclass('public.policy_commission_goals') IS NULL
  UNION ALL
  SELECT 9, 'new_functions_absent', NULL,
         NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
           ('get_my_commission_breakdown', 'get_my_commission_policy_list', 'get_my_commission_receipt_list',
            'get_my_commission_goal', 'set_my_commission_goal', 'clear_my_commission_goal'))
  UNION ALL
  -- The eight released definitions the migration reuses; its own guard refuses on any other digest. value = live md5.
  SELECT 10 + row_number() OVER (), 'preimage ' || fn,
         CASE WHEN to_regprocedure(fn) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(fn))) END,
         to_regprocedure(fn) IS NOT NULL AND md5(pg_get_functiondef(to_regprocedure(fn))) = digest
    FROM (VALUES ('policy_commission_authz.actor_org()', '29be135fe6edfb5082838eeb22d48790'),
                 ('policy_commission_authz.access(uuid)', 'a6da4418b7010c609d5be650615ae643'),
                 ('policy_commission_reporting.viewer()', 'b6cfc70bebf0a007f303d486e81748bf'),
                 ('policy_commission_reporting.period(text,date,date,date,integer)', 'bc9273191bc4ea2b519306cfa069c9d3'),
                 ('policy_commission_reporting.installments(uuid,uuid,date,uuid[])', 'b661f4fd5fc186849c0834c47f446605'),
                 ('policy_commission_reporting.policies(uuid,uuid,uuid)', '58e2a95cb1975631d9e1daaafd1599c5'),
                 ('policy_commission_reporting.contact_json(policy_commission_reporting.policy_fact)', 'd7121baae9f0d8ace15829cd0ad32eab'),
                 ('policy_commission_reporting.iso_or_null(text)', '4425715c96469e3fc43ff3bdde081045')) v(fn, digest)
  UNION ALL
  SELECT 20, 'rls_on_commission_tables', NULL,
         (SELECT bool_and(relrowsecurity) AND count(*) = 6 FROM pg_class WHERE oid IN (
            to_regclass('public.policy_commission_estimates'), to_regclass('public.policy_commission_installments'),
            to_regclass('public.policy_commission_receipts'), to_regclass('public.policy_commission_captures'),
            to_regclass('public.policy_commission_events'), to_regclass('public.policy_commission_handoffs')))
  UNION ALL
  SELECT 21, 'no_publication_for_all_tables', NULL, NOT EXISTS (SELECT 1 FROM pg_publication WHERE puballtables)
  UNION ALL
  -- The goal table's foreign key briefly locks organizations against writes; the apply waits at most 1 s.
  SELECT 22, 'no_lock_waits', NULL,
         NOT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                      WHERE NOT l.granted AND (c.relname LIKE 'policy_commission_%' OR c.oid = 'public.organizations'::regclass))
)
SELECT check_name, value, ok FROM checks ORDER BY n;

-- Data fingerprints for all six commission tables: row count, a digest of every row's full text, and the cumulative
-- write counters. Run it in the preflight and again in the read-back, from sessions with the same TimeZone (shown; the
-- hosted SQL endpoint uses UTC), and compare every column: the migration contains no INSERT, UPDATE or DELETE on them.
WITH d(t, n, digest) AS (
  SELECT 'policy_commission_handoffs', count(*), md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM public.policy_commission_handoffs x
  UNION ALL
  SELECT 'policy_commission_captures', count(*), md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM public.policy_commission_captures x
  UNION ALL
  SELECT 'policy_commission_estimates', count(*), md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM public.policy_commission_estimates x
  UNION ALL
  SELECT 'policy_commission_installments', count(*), md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM public.policy_commission_installments x
  UNION ALL
  SELECT 'policy_commission_receipts', count(*), md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM public.policy_commission_receipts x
  UNION ALL
  SELECT 'policy_commission_events', count(*), md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM public.policy_commission_events x)
SELECT d.t AS table_name, d.n AS row_count, d.digest AS content_md5, s.n_tup_ins, s.n_tup_upd, s.n_tup_del,
       current_setting('TimeZone') AS session_time_zone
  FROM d LEFT JOIN pg_stat_user_tables s ON s.schemaname = 'public' AND s.relname = d.t
 ORDER BY d.t;
