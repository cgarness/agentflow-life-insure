-- Lead → Client conversion preservation, Gate 2 (database only): READ-ONLY preflight for
-- 20261021200000_lead_client_conversion_preservation.sql. Run as postgres against production immediately before the
-- apply, and only after Chris's Gate 2 approval. It reads catalog state and computes aggregate hashes; it never writes
-- and never returns a business row. Every row of the first result must read ok = t; stop if any does not. Keep the
-- second result (fingerprints): the read-back must reproduce it exactly.
WITH writer AS (
  SELECT p.oid, p.oid::regprocedure::text AS fn, md5(pg_get_functiondef(p.oid)) AS digest, pg_get_userbyid(p.proowner) AS owner,
         p.prosecdef, p.proconfig, p.proacl::text AS acl
  FROM pg_proc p
  WHERE p.oid IN ('public.convert_lead_to_client_atomic(uuid,jsonb)'::regprocedure,
                  'public.update_client_with_policy_sale(uuid,jsonb)'::regprocedure,
                  'public.convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid)'::regprocedure,
                  'private.insert_policy_sale(uuid,jsonb,text,uuid)'::regprocedure,
                  'public.normalize_us_state(text)'::regprocedure)
), checks(n, check_name, value, ok) AS (
  SELECT 1, 'server_version', current_setting('server_version'), current_setting('server_version_num')::int >= 160000
  UNION ALL
  -- The HOSTED history decides, not source filenames: nothing may be recorded at or after this version.
  SELECT 2, 'version_free_and_sorts_last', (SELECT max(version) FROM supabase_migrations.schema_migrations),
         NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version >= '20261021200000')
  UNION ALL
  SELECT 3, 'converter_preimage', (SELECT digest FROM writer WHERE fn = 'convert_lead_to_client_atomic(uuid,jsonb)'),
         (SELECT digest FROM writer WHERE fn = 'convert_lead_to_client_atomic(uuid,jsonb)') = '641ba66c96ca4a76f80c9c85eb9caa42'
  UNION ALL
  SELECT 4, 'update_writer_preimage', (SELECT digest FROM writer WHERE fn = 'update_client_with_policy_sale(uuid,jsonb)'),
         (SELECT digest FROM writer WHERE fn = 'update_client_with_policy_sale(uuid,jsonb)') = '96e8f6e7ecc85d0d5385bf8640a144a6'
  UNION ALL
  SELECT 5, 'wrapper_unchanged', (SELECT digest FROM writer WHERE fn = 'convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid)'),
         (SELECT digest FROM writer WHERE fn = 'convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid)') = '3d974a5c893753d5f10cacd9605c565f'
  UNION ALL
  SELECT 6, 'insert_policy_sale_unchanged', (SELECT digest FROM writer WHERE fn = 'private.insert_policy_sale(uuid,jsonb,text,uuid)'),
         (SELECT digest FROM writer WHERE fn = 'private.insert_policy_sale(uuid,jsonb,text,uuid)') = '3f600b757802c0fa8cc1e17fa5c25575'
  UNION ALL
  SELECT 7, 'normalize_us_state_present', (SELECT digest FROM writer WHERE fn = 'normalize_us_state(text)'),
         (SELECT digest FROM writer WHERE fn = 'normalize_us_state(text)') = 'c8905751f7543ef1f6be8e7325d9c666'
  UNION ALL
  SELECT 8, 'writer_metadata', NULL,
         (SELECT bool_and(owner = 'postgres' AND prosecdef AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']
                          AND acl = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
                          AND NOT has_function_privilege('anon', oid, 'EXECUTE'))
            FROM writer WHERE fn IN ('convert_lead_to_client_atomic(uuid,jsonb)', 'update_client_with_policy_sale(uuid,jsonb)'))
  UNION ALL
  SELECT 9, 'new_columns_absent', NULL,
         NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.clients'::regclass AND NOT attisdropped
                       AND attname IN ('date_of_birth', 'age', 'best_time_to_call', 'spouse_info', 'lead_conversion'))
  UNION ALL
  SELECT 10, 'guard_absent', NULL,
         to_regprocedure('private.guard_client_lead_conversion()') IS NULL
         AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.clients'::regclass AND tgname = 'clients_lead_conversion_guard')
  UNION ALL
  SELECT 11, 'clients_triggers', (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.clients'::regclass AND NOT tgisinternal),
         (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.clients'::regclass AND NOT tgisinternal)
           = 'clients_policy_identity,clients_policy_sale_complete,contact_history_capture,workflow_client_insert_trigger'
  UNION ALL
  SELECT 12, 'no_waiting_lock_on_clients', NULL,
         NOT EXISTS (SELECT 1 FROM pg_locks WHERE relation = 'public.clients'::regclass AND NOT granted)
)
SELECT n, check_name, value, ok FROM checks ORDER BY n;

-- Fingerprints (aggregate hashes only). The read-back must reproduce these exactly: the migration changes no existing
-- client value, no RLS policy and no table grant.
SELECT 'clients_rows' AS fingerprint, count(*)::text AS count,
       md5(coalesce(string_agg(to_jsonb(c)::text, E'\n' ORDER BY c.id), '')) AS digest FROM public.clients c
UNION ALL
SELECT 'clients_policies', count(*)::text, md5(coalesce(string_agg(polname || ':' || polcmd::text || ':' || coalesce(pg_get_expr(polqual, polrelid), '')
         || ':' || coalesce(pg_get_expr(polwithcheck, polrelid), ''), E'\n' ORDER BY polname), ''))
FROM pg_policy WHERE polrelid = 'public.clients'::regclass
UNION ALL
SELECT 'clients_acl', NULL, md5(coalesce((SELECT relacl::text FROM pg_class WHERE oid = 'public.clients'::regclass), ''))
UNION ALL
SELECT 'wins_rows', count(*)::text, md5(coalesce(string_agg(to_jsonb(w)::text, E'\n' ORDER BY w.id), '')) FROM public.wins w;
