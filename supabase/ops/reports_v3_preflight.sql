-- =====================================================================================================
-- Reports V2 (v3) PKG-A preflight (plan §9.1 A1). Privilege class R: read-only, no privilege statement.
-- One READ ONLY transaction that rolls back. It writes nothing and returns aggregates only (no row of CRM data).
--
-- Refuses (raises) unless the database is in the reviewed pre-PKG-A state:
--   * no v3 object exists (no private.report_v3_% or public.get_report_%_v3 function, no v3 index);
--   * the 15 v2 tuples and the 12 closure-helper tuples equal the reviewed pins (the same list …10 guards on);
--   * exactly the six v2 readers are executable, by authenticated and service_role only; no report function has a
--     PUBLIC or anon entry; anon and authenticated have no USAGE on schema private;
-- Then reports, as name/value rows: the migration history count and head, the default function ACL in public, the
-- later-package preimage pins (true/false; each package re-checks its own at release), time-zone coverage (an
-- organization without a valid agency time zone sees the configuration-required state) and aggregate baselines.
-- =====================================================================================================
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE f record; v_role text; v_expected boolean; v_v2 text[] := ARRAY[
    'public.get_report_scope_v2(text)', 'public.get_report_call_summary_v2(date,date,uuid,text)',
    'public.get_report_call_volume_v2(date,date,uuid,text)', 'public.get_report_disposition_breakdown_v2(date,date,uuid,text)',
    'public.get_report_campaign_performance_v2(date,date,uuid,text)', 'public.get_report_lead_source_performance_v2(date,date,uuid,text)'];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE (n.nspname = 'private' AND p.proname LIKE 'report\_v3\_%')
                 OR (n.nspname = 'public' AND p.proname LIKE 'get\_report\_%\_v3'))
     OR to_regclass('public.report_v3_calls_org_campaign_lead') IS NOT NULL THEN
    RAISE EXCEPTION 'Reports v3 preflight: a v3 object already exists';
  END IF;
  FOR f IN SELECT * FROM (VALUES
    -- The 15 v2 pins (supabase/ops/reports_integrity_enable.sql).
    ('private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])', '245c7ce4f7bf47f6347595822f70a947', false, 's'),
    ('private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[])', '3d33b720751a1913c81ad284ae6ffd43', true, 's'),
    ('private.report_call_facts(uuid,timestamptz,timestamptz,uuid[])', 'bacbfd0629221957cae28ba28728c8bd', true, 's'),
    ('public.get_report_call_summary(date,date,uuid)', '34cdfab92f6acaa5a383c743088c1720', true, 's'),
    ('private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])', 'c1355d551fba0cc2217150f5531d1b31', false, 's'),
    ('private.report_access_v2(text,uuid)', 'a221335ae305cee01097bc796d5e7cdd', true, 's'),
    ('private.report_monthly_amount(text)', '405647c4982f4b9475f834efa6f2beee', false, 'i'),
    ('private.report_policy_value_facts(uuid,uuid[])', 'f543eeb4ee5aa7906e3225527d873935', false, 's'),
    ('private.report_premium_totals(bigint,bigint,numeric,bigint,bigint,bigint)', '31dcd20548aea901f074a5fd9526518c', false, 'i'),
    ('public.get_report_scope_v2(text)', '26a2d64831975668a492dfda2e369aac', true, 's'),
    ('public.get_report_call_summary_v2(date,date,uuid,text)', '23c21fa14b07edaeaa3901e76b243d66', true, 's'),
    ('public.get_report_call_volume_v2(date,date,uuid,text)', 'a4a5e82f36e124fa8ee9d581229ef455', true, 's'),
    ('public.get_report_disposition_breakdown_v2(date,date,uuid,text)', 'ae4611201b9add696bfd92f4576fdd7b', true, 's'),
    ('public.get_report_campaign_performance_v2(date,date,uuid,text)', '8d8bee228b2bed67076e2547f506264d', true, 's'),
    ('public.get_report_lead_source_performance_v2(date,date,uuid,text)', '8d85fff93300966502964b500eb46166', true, 's'),
    -- The 12 closure helpers v3 reuses (plan D1 §5).
    ('private.report_window(uuid,date,date)', '1107da185bfc1a3089b27e125c74646d', true, 's'),
    ('private.report_meta(text,uuid,text,text,date,date,timestamptz,timestamptz)', '6faa38495ac0bbd2d837c4c959cada25', false, 's'),
    ('private.report_agent_name(text,text)', '23d45e5c19d951d0d663c629ed85c945', false, 's'),
    ('private.report_visible_campaigns(uuid)', '1e37cb4b2b2a0696e129523b096a400f', false, 's'),
    ('private.report_policy_quality(uuid,uuid[])', 'cb7596ab38f91c765f869cccebf8a4ee', false, 's'),
    ('private.report_policy_facts(uuid,uuid[])', 'c902d5d2906d42dd85adb34dd524b9a7', false, 's'),
    ('private.report_policy_campaign_lineage(uuid,uuid[])', 'b99cd74ed7ab519a2ec180160e8cdfd5', false, 's'),
    ('private.report_agency_time_zone(uuid)', '27feaed00c03895fce8bfd6b2cd24207', true, 's'),
    ('private.report_permission_flags(uuid,text)', 'ba6abec7565525217b61f1a342123b65', true, 's'),
    ('private.campaign_actor()', '16cca1989b7648593f90244786d60958', true, 's'),
    ('private.resolve_downline_ids(uuid,uuid)', '4f760d7bc7bef6231176b3624ffd00b8', true, 's'),
    ('private.profile_parse_iso_date(text)', 'be24ed08bb42a71b29e3c44abebfd0c9', false, 'i')
  ) AS expected(signature, body_md5, is_definer, volatility) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(f.signature)
                     AND md5(prosrc) = f.body_md5 AND proowner = 'postgres'::regrole AND prosecdef = f.is_definer
                     AND provolatile::text = f.volatility AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION 'Reports v3 preflight: v2 or closure preimage drift: %', f.signature;
    END IF;
  END LOOP;
  FOR f IN SELECT p.oid, p.proacl, p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'private' AND p.proname LIKE 'report\_%')
               OR (n.nspname = 'public' AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'rpc\_report\_%')) LOOP
    IF EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'Reports v3 preflight: PUBLIC can execute %', f.oid::regprocedure;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      v_expected := v_role <> 'anon' AND f.oid = ANY (SELECT to_regprocedure(r)::oid FROM unnest(v_v2) r);
      IF has_function_privilege(v_role, f.oid, 'EXECUTE') IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'Reports v3 preflight: privilege matrix mismatch for % on %', v_role, f.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
  IF has_schema_privilege('anon', 'private', 'USAGE') OR has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'Reports v3 preflight: a client role has USAGE on schema private';
  END IF;
END $preflight$;

SELECT name, value FROM (
  SELECT 0 AS n, 'history count|head' AS name,
         CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'no history table'
              ELSE (xpath('/row/v/text()', query_to_xml(
                'SELECT count(*) || ''|'' || max(version) AS v FROM supabase_migrations.schema_migrations', false, true, '')))[1]::text END AS value
  UNION ALL SELECT 1, 'default function ACL in public', coalesce((SELECT string_agg(defaclacl::text, ' ')
         FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace AND defaclobjtype = 'f'), 'none')
  UNION ALL SELECT 2, 'PKG-B preimage performance_sale_monthly deb0d333 (…20 re-checks its definition)',
         (SELECT (md5(prosrc) = 'deb0d3330a432cd4324ea422856d67a0')::text
            FROM pg_proc WHERE oid = to_regprocedure('private.performance_sale_monthly(public.wins,numeric)'))
  UNION ALL SELECT 3, 'PKG-B preimage performance_monthly 7e706331',
         (SELECT (md5(prosrc) = '7e7063317a34f37d90faf14914b98827')::text FROM pg_proc WHERE oid = to_regprocedure('private.performance_monthly(boolean,numeric,numeric)'))
  UNION ALL SELECT 4, 'PKG-C preimages record_client_policy_handoff d39e03a7 / convert_lead_to_client_with_sales_handoff 4d6803ff',
         (SELECT (count(*) = 2)::text FROM pg_proc WHERE (oid = to_regprocedure('public.record_client_policy_handoff(uuid,uuid,jsonb,boolean,jsonb)')
             AND md5(prosrc) = 'd39e03a7dd2cf122a68dc0fefcbfb44a') OR (oid = to_regprocedure('public.convert_lead_to_client_with_sales_handoff(uuid,uuid,uuid,jsonb,uuid,jsonb)')
             AND md5(prosrc) = '4d6803ff7d94b7735e3f1b3baf18456c'))
  UNION ALL SELECT 5, 'PKG-D baseline appointment types (locked defaults | custom)',
         CASE WHEN to_regclass('public.appointment_types') IS NULL THEN 'no appointment_types table'
              ELSE (xpath('/row/v/text()', query_to_xml('SELECT count(*) FILTER (WHERE is_locked) || ''|'' || count(*) FILTER (WHERE NOT is_locked) AS v
                FROM public.appointment_types', false, true, '')))[1]::text END
  UNION ALL SELECT 6, 'organizations with active users | without a valid agency time zone',
         (SELECT count(*) || '|' || count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.company_settings cs
                  JOIN pg_timezone_names z ON z.name = cs.timezone
                 WHERE cs.organization_id = o.organization_id AND lower(cs.timezone) NOT IN ('factory', 'localtime', 'posixrules')))
            FROM (SELECT DISTINCT organization_id FROM public.profiles WHERE status = 'Active' AND organization_id IS NOT NULL) o)
  UNION ALL SELECT 7, 'organizations | active profiles', (SELECT count(*) FROM public.organizations) || '|'
         || (SELECT count(*) FROM public.profiles WHERE status = 'Active')
  UNION ALL SELECT 8, 'calls last 31 days (all | outbound | inbound)',
         (SELECT count(*) || '|' || count(*) FILTER (WHERE lower(direction) = 'outbound') || '|' || count(*) FILTER (WHERE lower(direction) = 'inbound')
            FROM public.calls WHERE created_at >= now() - interval '31 days')
  UNION ALL SELECT 9, 'calls last 31 days that require dialer admission (all | not admitted)',
         CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.calls'::regclass AND attname = 'dialer_provider_admitted' AND NOT attisdropped)
              THEN (SELECT count(*) || '|' || count(*) FILTER (WHERE NOT (c.dialer_provider_admitted IS TRUE))
                      FROM (SELECT (to_jsonb(k) ->> 'dialer_admission_required')::boolean AS required,
                                   (to_jsonb(k) ->> 'dialer_provider_admitted')::boolean AS dialer_provider_admitted
                              FROM public.calls k WHERE k.created_at >= now() - interval '31 days') c WHERE c.required)
              ELSE 'no admission projection column' END
  UNION ALL SELECT 10, 'sales with a policy (all | last 31 days by Sold Date)',
         (SELECT count(*) || '|' || count(*) FILTER (WHERE sold_date >= current_date - 31) FROM public.wins WHERE policy_id IS NOT NULL)
  UNION ALL SELECT 11, 'clients | appointments', (SELECT count(*) FROM public.clients) || '|' || (SELECT count(*) FROM public.appointments)
) x ORDER BY n;
ROLLBACK;
