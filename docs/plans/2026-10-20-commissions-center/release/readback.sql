-- Commissions center, Gate 2 (database only): READ-ONLY read-back after 20261020180000 is applied and recorded.
-- Every row must read ok = t. Compare the row counts with the preflight's: the migration writes no commission row.
WITH fns(fn) AS (VALUES
    ('public.get_my_commission_overview(text,date,date)'),
    ('public.get_my_commission_installments(text,date,date,text,text,text,text,integer,integer)'),
    ('public.get_my_commission_receipts(text,date,date,boolean,integer,integer)'),
    ('public.get_my_commission_policies(text,text,integer,integer)'),
    ('public.get_my_policy_commission(uuid)'),
    ('policy_commission_reporting.viewer()'),
    ('policy_commission_reporting.period(text,date,date,date,integer)'),
    ('policy_commission_reporting.installments(uuid,uuid,date,uuid[])'),
    ('policy_commission_reporting.policies(uuid,uuid,uuid)'),
    ('policy_commission_reporting.contact_json(policy_commission_reporting.policy_fact)'),
    ('policy_commission_reporting.iso_or_null(text)'),
    ('policy_commission_reporting.installment_json(policy_commission_reporting.installment_fact,policy_commission_reporting.policy_fact)')),
checks(n, check_name, value, ok) AS (
  SELECT 1, 'history_row', '20261020180000 / policy_commission_center_reads',
         EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261020180000'
                   AND name = 'policy_commission_center_reads' AND cardinality(statements) = 1
                   AND encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') = '5bc2eb14b52bf72c2516d6d134c0dac52bea052504aff8bb9e723d08fdbd3e08'
                   AND octet_length(statements[1]) = 40850)
  UNION ALL
  SELECT 2, 'reporting_schema', 'owner postgres; USAGE authenticated only',
         (SELECT nspowner = 'postgres'::regrole FROM pg_namespace WHERE nspname = 'policy_commission_reporting')
         AND has_schema_privilege('authenticated', 'policy_commission_reporting', 'USAGE')
         AND NOT has_schema_privilege('anon', 'policy_commission_reporting', 'USAGE')
         AND NOT has_schema_privilege('service_role', 'policy_commission_reporting', 'USAGE')
  UNION ALL
  SELECT 3, 'twelve_functions', NULL, (SELECT count(*) FROM fns WHERE to_regprocedure(fn) IS NOT NULL) = 12
  UNION ALL
  SELECT 4, 'invoker_owner_search_path', NULL,
         (SELECT bool_and(NOT p.prosecdef AND p.proowner = 'postgres'::regrole AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp'])
            FROM fns JOIN pg_proc p ON p.oid = to_regprocedure(fns.fn))
  UNION ALL
  SELECT 5, 'execute_authenticated_only', NULL,
         (SELECT bool_and(has_function_privilege('authenticated', to_regprocedure(fn), 'EXECUTE')
                          AND NOT has_function_privilege('anon', to_regprocedure(fn), 'EXECUTE')
                          AND NOT has_function_privilege('service_role', to_regprocedure(fn), 'EXECUTE')) FROM fns)
  UNION ALL
  SELECT 6, 'no_public_execute', NULL,
         (SELECT bool_and(NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
            FROM fns JOIN pg_proc p ON p.oid = to_regprocedure(fns.fn))
  UNION ALL
  SELECT 7, 'indexes_valid', NULL,
         (SELECT count(*) = 2 AND bool_and(i.indisvalid) FROM pg_index i WHERE i.indexrelid IN (
            to_regclass('public.policy_commission_receipts_agent_received'), to_regclass('public.policy_commission_captures_agent_open')))
  UNION ALL
  SELECT 10 + row_number() OVER (), 'preimage ' || fn, digest,
         to_regprocedure(fn) IS NOT NULL AND md5(pg_get_functiondef(to_regprocedure(fn))) = digest
    FROM (VALUES ('private.campaign_actor()', 'f582e43731a968fb2e0961e80939ff7e'),
                 ('policy_commission_authz.actor_org()', '29be135fe6edfb5082838eeb22d48790'),
                 ('policy_commission_authz.access(uuid)', 'a6da4418b7010c609d5be650615ae643'),
                 ('public.get_client_policy_commissions(uuid)', '5765e4dad8ec9c8b4bbb85fb32651c94')) v(fn, digest)
  UNION ALL
  SELECT 20, 'rls_on_commission_tables', NULL,
         (SELECT bool_and(relrowsecurity) AND count(*) = 6 FROM pg_class WHERE oid IN (
            to_regclass('public.policy_commission_estimates'), to_regclass('public.policy_commission_installments'),
            to_regclass('public.policy_commission_receipts'), to_regclass('public.policy_commission_captures'),
            to_regclass('public.policy_commission_events'), to_regclass('public.policy_commission_handoffs')))
)
SELECT check_name, value, ok FROM checks ORDER BY n;

SELECT 'estimates' AS t, count(*) FROM public.policy_commission_estimates
UNION ALL SELECT 'installments', count(*) FROM public.policy_commission_installments
UNION ALL SELECT 'receipts', count(*) FROM public.policy_commission_receipts
UNION ALL SELECT 'captures', count(*) FROM public.policy_commission_captures
UNION ALL SELECT 'events', count(*) FROM public.policy_commission_events;
