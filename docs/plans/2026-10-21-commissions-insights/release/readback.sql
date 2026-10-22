-- Commissions insights, Gate 2 (database only): READ-ONLY read-back after 20261021180000 is applied and recorded.
-- Every row must read ok = t. Then compare release/catalog.sql and the six-table fingerprints with the preflight's,
-- column by column: no existing object, permission or commission row changes.
WITH fns(fn, vol, src_md5) AS (VALUES
    ('public.get_my_commission_breakdown(text,date,date)', 's', 'c47ba352555d103c5ce6cce2cfb8a47c'),
    ('public.get_my_commission_policy_list(text,text,boolean,text,text,date,date,integer,integer)', 's', 'b5fb076cb29d12107819fc3a6a26d3e7'),
    ('public.get_my_commission_receipt_list(text,date,date,boolean,text,boolean,integer,integer)', 's', '2fad2aa39805df0a462e7bb7795f7fb5'),
    ('public.get_my_commission_goal(date)', 's', '0c90104f73c35df69e005eba30dcf979'),
    ('public.set_my_commission_goal(date,bigint)', 'v', '199d45d2597e9f8cd7f1f533259e93ba'),
    ('public.clear_my_commission_goal(date)', 'v', '9f3ac61962eae18b2d049fa28639f0f1'),
    ('policy_commission_insights.carrier_key(text)', 'i', 'cac2b2c42312ebd5b8f84eb97a2a4465'),
    ('policy_commission_insights.category(text)', 'i', '73bdc6ba4c50ab81516eda1eb298f566'),
    ('policy_commission_insights.policy_category(policy_commission_reporting.policy_fact)', 'i', 'ad07c622bce37a18bb44db21b71d9e4a'),
    ('policy_commission_insights.policy_carrier(policy_commission_reporting.policy_fact)', 'i', 'b4658d011aa09d3c4dc4c68dd02d261f'),
    ('policy_commission_insights.comparison(date,date,date)', 'i', '5df3d1e4bdb05e91db7c0c7197fb357c'),
    ('policy_commission_insights.goal_month(date)', 'i', '6aaa1b69b775d291dbdc8c34a9edcfba')),
goal AS (SELECT to_regclass('public.policy_commission_goals') AS rel),
-- Grants to anyone but the owner, as (grantee, privilege) text.
table_grants AS (
  SELECT string_agg(e, ',' ORDER BY e) AS g FROM (
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type AS e
      FROM pg_class c, goal, aclexplode(c.relacl) a WHERE c.oid = goal.rel AND a.grantee <> c.relowner) t),
column_grants AS (
  SELECT string_agg(e, ',' ORDER BY e) AS g FROM (
    SELECT t.attname || '=' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type AS e
      FROM pg_attribute t, goal, aclexplode(t.attacl) a WHERE t.attrelid = goal.rel AND t.attnum > 0) t),
checks(n, check_name, value, ok) AS (
  SELECT 1, 'history_row', '20261021180000 / policy_commission_center_insights',
         EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261021180000'
                   AND name = 'policy_commission_center_insights' AND cardinality(statements) = 1
                   AND md5(statements[1]) = '428020c9b8264e85dc9fcff992c426de'
                   AND encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') = 'd390cc8e267a86fdc829da3a514d184b74f6d270d4199af1d57f2c9e465b3345'
                   AND octet_length(statements[1]) = 34179)
         AND (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261021180000') = 1
  UNION ALL
  SELECT 2, 'recorded_last', (SELECT max(version) FROM supabase_migrations.schema_migrations),
         (SELECT max(version) FROM supabase_migrations.schema_migrations) = '20261021180000'
  UNION ALL
  SELECT 3, 'prerequisites_unchanged', NULL,
         (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE
            (version, encode(sha256(convert_to(statements[1], 'UTF8')), 'hex')) IN (
              ('20261019170000', 'b3e4d53fcced800be3c8b09567ef66c2faebb21937634e3f17aa2d6228011f1f'),
              ('20261020040000', '10897ad6123dc052e5cbe5340a821e3ce8595f99f1448e74832e18fb2d0a5ea8'),
              ('20261020212000', '5bc2eb14b52bf72c2516d6d134c0dac52bea052504aff8bb9e723d08fdbd3e08'))) = 3
  UNION ALL
  SELECT 4, 'goal_table', 'owner postgres; RLS on, not forced',
         (SELECT c.relkind = 'r' AND c.relowner = 'postgres'::regrole AND c.relrowsecurity AND NOT c.relforcerowsecurity
            FROM pg_class c, goal WHERE c.oid = goal.rel)
  UNION ALL
  SELECT 5, 'goal_columns', NULL,
         (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
                            || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''), ', ' ORDER BY a.attnum)
            FROM pg_attribute a JOIN goal ON a.attrelid = goal.rel LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
           WHERE a.attnum > 0 AND NOT a.attisdropped)
         = 'organization_id uuid not null, owner_id uuid not null, month date not null, target_cents bigint not null, '
           'created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now()'
  UNION ALL
  SELECT 6, 'goal_constraints', NULL,
         (SELECT string_agg(k.conname || ': ' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname)
            FROM pg_constraint k JOIN goal ON k.conrelid = goal.rel)
         = 'policy_commission_goals_month_check: CHECK (((EXTRACT(day FROM month) = (1)::numeric) AND ((month >= ''2000-01-01''::date) AND (month <= ''2100-12-01''::date))))'
           ' | policy_commission_goals_organization_id_fkey: FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE'
           ' | policy_commission_goals_pkey: PRIMARY KEY (organization_id, owner_id, month)'
           ' | policy_commission_goals_target_cents_check: CHECK (((target_cents >= 1) AND (target_cents <= 100000000)))'
  UNION ALL
  SELECT 7, 'goal_owner_policy_only', NULL,
         (SELECT count(*) = 1 AND bool_and(p.polname = 'policy_commission_goals_owner' AND p.polpermissive AND p.polcmd = '*'
                   AND p.polroles = ARRAY['authenticated'::regrole::oid]
                   AND pg_get_expr(p.polqual, p.polrelid) = '((owner_id = ( SELECT auth.uid() AS uid)) AND (organization_id = ( SELECT policy_commission_authz.actor_org() AS actor_org)) AND (policy_commission_authz.access(( SELECT auth.uid() AS uid)) = ''write''::text))'
                   AND pg_get_expr(p.polwithcheck, p.polrelid) = pg_get_expr(p.polqual, p.polrelid))
            FROM pg_policy p JOIN goal ON p.polrelid = goal.rel)
  UNION ALL
  SELECT 8, 'goal_table_grants', (SELECT g FROM table_grants),
         (SELECT g FROM table_grants) = 'authenticated:DELETE,authenticated:INSERT,authenticated:SELECT'
  UNION ALL
  SELECT 9, 'goal_column_grants', (SELECT g FROM column_grants),
         (SELECT g FROM column_grants) = 'target_cents=authenticated:UPDATE,updated_at=authenticated:UPDATE'
  UNION ALL
  SELECT 10, 'no_goal_rows', NULL, (SELECT count(*) FROM public.policy_commission_goals) = 0
  UNION ALL
  SELECT 11, 'insights_schema', 'owner postgres; USAGE authenticated only',
         (SELECT nspowner = 'postgres'::regrole FROM pg_namespace WHERE nspname = 'policy_commission_insights')
         AND (SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type, ',')
                FROM pg_namespace s, aclexplode(s.nspacl) a WHERE s.nspname = 'policy_commission_insights' AND a.grantee <> s.nspowner)
             = 'authenticated:USAGE'
  UNION ALL
  SELECT 12, 'twelve_functions_exact_bodies', NULL,
         (SELECT count(*) = 12 AND bool_and(md5(p.prosrc) = fns.src_md5) FROM fns JOIN pg_proc p ON p.oid = to_regprocedure(fns.fn))
         AND (SELECT count(*) FROM pg_proc WHERE pronamespace = to_regnamespace('policy_commission_insights')) = 6
  UNION ALL
  SELECT 13, 'invoker_owner_search_path_volatility', NULL,
         (SELECT bool_and(NOT p.prosecdef AND p.proowner = 'postgres'::regrole AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
                          AND p.provolatile = fns.vol::"char")
            FROM fns JOIN pg_proc p ON p.oid = to_regprocedure(fns.fn))
  UNION ALL
  SELECT 14, 'execute_authenticated_only', NULL,
         (SELECT bool_and((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type, ',')
                             FROM aclexplode(p.proacl) a WHERE a.grantee <> p.proowner) = 'authenticated:EXECUTE')
            FROM fns JOIN pg_proc p ON p.oid = to_regprocedure(fns.fn))
  UNION ALL
  SELECT 20 + row_number() OVER (), 'preimage ' || fn, digest,
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
  SELECT 30, 'rls_on_commission_tables', NULL,
         (SELECT bool_and(relrowsecurity) AND count(*) = 6 FROM pg_class WHERE oid IN (
            to_regclass('public.policy_commission_estimates'), to_regclass('public.policy_commission_installments'),
            to_regclass('public.policy_commission_receipts'), to_regclass('public.policy_commission_captures'),
            to_regclass('public.policy_commission_events'), to_regclass('public.policy_commission_handoffs')))
  UNION ALL
  SELECT 31, 'goal_table_not_published', NULL,
         NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'policy_commission_goals')
)
SELECT check_name, value, ok FROM checks ORDER BY n;

-- Informational: full definition digests of the 12 new functions (header + body as the server prints them).
SELECT p.oid::regprocedure::text AS function, md5(pg_get_functiondef(p.oid)) AS definition_md5
  FROM pg_proc p
 WHERE p.pronamespace = to_regnamespace('policy_commission_insights')
    OR (p.pronamespace = 'public'::regnamespace AND p.proname IN ('get_my_commission_breakdown', 'get_my_commission_policy_list',
        'get_my_commission_receipt_list', 'get_my_commission_goal', 'set_my_commission_goal', 'clear_my_commission_goal'))
 ORDER BY 1;

-- Data fingerprints for all six commission tables (same query as the preflight; compare every column).
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
