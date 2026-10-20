-- Commissions center, Gate 2 (database only): READ-ONLY preflight for 20261020180000_policy_commission_center_reads.sql.
-- Run as postgres against production only after Chris approves Gate 2. It reads catalog state and row counts; it never
-- writes. Every row in the first result must read ok = t; stop if any does not.
WITH checks(n, check_name, value, ok) AS (
  SELECT 1, 'server_version', current_setting('server_version'), current_setting('server_version_num')::int >= 160000
  UNION ALL
  SELECT 2, 'prerequisites_recorded', '20261019170000, 20261020040000',
         (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20261019170000', '20261020040000')) = 2
  UNION ALL
  -- Later unrelated releases may be recorded (for example 20261020171244, UV personal branding); none may sort at or
  -- after this version.
  SELECT 3, 'version_free_and_sorts_last', (SELECT max(version) FROM supabase_migrations.schema_migrations),
         NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version >= '20261020180000')
  UNION ALL
  SELECT 4, 'applied_20261019170000_unchanged', NULL,
         (SELECT encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') FROM supabase_migrations.schema_migrations
           WHERE version = '20261019170000') = 'b3e4d53fcced800be3c8b09567ef66c2faebb21937634e3f17aa2d6228011f1f'
  UNION ALL
  SELECT 5, 'applied_20261020040000_unchanged', NULL,
         (SELECT encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') FROM supabase_migrations.schema_migrations
           WHERE version = '20261020040000') = '10897ad6123dc052e5cbe5340a821e3ce8595f99f1448e74832e18fb2d0a5ea8'
  UNION ALL
  SELECT 6, 'prerequisite_columns', 'expected_until, schedule_assumed',
         EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.policy_commission_installments')
                   AND attname = 'expected_until' AND NOT attisdropped)
         AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.policy_commission_estimates')
                       AND attname = 'schedule_assumed' AND NOT attisdropped)
  UNION ALL
  SELECT 7, 'reporting_schema_absent', 'policy_commission_reporting', to_regnamespace('policy_commission_reporting') IS NULL
  UNION ALL
  SELECT 8, 'read_functions_absent', NULL,
         NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
           ('get_my_commission_overview', 'get_my_commission_installments', 'get_my_commission_receipts',
            'get_my_commission_policies', 'get_my_policy_commission'))
  UNION ALL
  SELECT 9, 'indexes_absent', NULL,
         to_regclass('public.policy_commission_receipts_agent_received') IS NULL
         AND to_regclass('public.policy_commission_captures_agent_open') IS NULL
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
  UNION ALL
  SELECT 21, 'no_lock_waits_on_commission_tables', NULL,
         NOT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                      WHERE NOT l.granted AND c.relname LIKE 'policy_commission_%')
)
SELECT check_name, value, ok FROM checks ORDER BY n;

-- Informational (saved for the read-back): commission row counts, and organizations whose agency time zone is unset or
-- invalid (their Commissions page shows "Agency time zone needed"; the reads fail closed with 55000).
SELECT 'estimates' AS t, count(*) FROM public.policy_commission_estimates
UNION ALL SELECT 'installments', count(*) FROM public.policy_commission_installments
UNION ALL SELECT 'receipts', count(*) FROM public.policy_commission_receipts
UNION ALL SELECT 'captures', count(*) FROM public.policy_commission_captures
UNION ALL SELECT 'events', count(*) FROM public.policy_commission_events;

SELECT e.organization_id, cs.timezone
  FROM (SELECT DISTINCT organization_id FROM public.policy_commission_estimates) e
  LEFT JOIN public.company_settings cs ON cs.organization_id = e.organization_id
 WHERE cs.timezone IS NULL OR cs.timezone IN ('factory', 'localtime', 'posixrules')
    OR NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = cs.timezone);
