-- Lead → Client conversion preservation, Gate 2 (database only): READ-ONLY read-back after applying
-- 20261021200000_lead_client_conversion_preservation.sql. Run as postgres immediately after the apply. It never writes
-- and never returns a business row. Every row of the first result must read ok = t. The second result must equal the
-- preflight's fingerprints exactly (clients_rows excludes the five new columns, which must all be NULL).
WITH fn AS (
  SELECT p.oid, p.oid::regprocedure::text AS name, md5(pg_get_functiondef(p.oid)) AS digest, pg_get_userbyid(p.proowner) AS owner,
         p.prosecdef, p.proconfig, p.proacl::text AS acl
  FROM pg_proc p
  WHERE p.oid IN ('public.convert_lead_to_client_atomic(uuid,jsonb)'::regprocedure,
                  'public.update_client_with_policy_sale(uuid,jsonb)'::regprocedure,
                  'public.convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid)'::regprocedure,
                  'private.insert_policy_sale(uuid,jsonb,text,uuid)'::regprocedure,
                  'private.guard_client_lead_conversion()'::regprocedure)
), checks(n, check_name, value, ok) AS (
  SELECT 1, 'history_row', (SELECT version || ' / ' || name FROM supabase_migrations.schema_migrations WHERE version = '20261021200000'),
         (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261021200000'
            AND name = 'lead_client_conversion_preservation') = 1
  UNION ALL
  SELECT 2, 'history_text_is_reviewed_file', NULL,
         (SELECT encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') FROM supabase_migrations.schema_migrations
           WHERE version = '20261021200000') = 'ce189016d2ca39af780c9f61909f74dd65c13b867a6238d8498cb9ce23729ae5'
  UNION ALL
  SELECT 3, 'converter_postimage', (SELECT digest FROM fn WHERE name = 'convert_lead_to_client_atomic(uuid,jsonb)'),
         (SELECT digest FROM fn WHERE name = 'convert_lead_to_client_atomic(uuid,jsonb)') = '7109fdab661eac16ab6ff4f8d8343c20'
  UNION ALL
  SELECT 4, 'update_writer_postimage', (SELECT digest FROM fn WHERE name = 'update_client_with_policy_sale(uuid,jsonb)'),
         (SELECT digest FROM fn WHERE name = 'update_client_with_policy_sale(uuid,jsonb)') = '6313ca0c1fc374a613bfcb7e9e587d4c'
  UNION ALL
  SELECT 5, 'wrapper_and_sale_helper_unchanged', NULL,
         (SELECT digest FROM fn WHERE name = 'convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid)') = '3d974a5c893753d5f10cacd9605c565f'
         AND (SELECT digest FROM fn WHERE name = 'private.insert_policy_sale(uuid,jsonb,text,uuid)') = '3f600b757802c0fa8cc1e17fa5c25575'
  UNION ALL
  SELECT 6, 'writer_metadata_unchanged', NULL,
         (SELECT bool_and(owner = 'postgres' AND prosecdef AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']
                          AND acl = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
                          AND NOT has_function_privilege('anon', oid, 'EXECUTE'))
            FROM fn WHERE name IN ('convert_lead_to_client_atomic(uuid,jsonb)', 'update_client_with_policy_sale(uuid,jsonb)'))
  UNION ALL
  SELECT 7, 'guard_function', (SELECT digest FROM fn WHERE name = 'private.guard_client_lead_conversion()'),
         (SELECT digest = 'f2558ce56aae6f7db84df1b17f085aa0' AND owner = 'postgres' AND NOT prosecdef AND acl = '{postgres=X/postgres}'
            FROM fn WHERE name = 'private.guard_client_lead_conversion()')
  UNION ALL
  SELECT 8, 'guard_trigger', NULL,
         (SELECT tgenabled = 'O' AND pg_get_triggerdef(oid) = 'CREATE TRIGGER clients_lead_conversion_guard BEFORE INSERT OR UPDATE OF '
            || 'lead_conversion ON public.clients FOR EACH ROW EXECUTE FUNCTION private.guard_client_lead_conversion()'
            FROM pg_trigger WHERE tgrelid = 'public.clients'::regclass AND tgname = 'clients_lead_conversion_guard')
  UNION ALL
  SELECT 9, 'columns_exact', (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attname)
                                FROM pg_attribute WHERE attrelid = 'public.clients'::regclass AND NOT attisdropped
                                  AND attname IN ('date_of_birth', 'age', 'best_time_to_call', 'spouse_info', 'lead_conversion')),
         (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.clients'::regclass AND NOT attisdropped AND NOT attnotnull
            AND NOT atthasdef AND attacl IS NULL AND (attname, format_type(atttypid, atttypmod)) IN
              (('date_of_birth', 'text'), ('age', 'integer'), ('best_time_to_call', 'text'), ('spouse_info', 'jsonb'), ('lead_conversion', 'jsonb'))) = 5
  UNION ALL
  -- Immediately after the apply, before any new conversion: no existing client gained a value.
  SELECT 10, 'existing_clients_untouched', NULL,
         NOT EXISTS (SELECT 1 FROM public.clients WHERE date_of_birth IS NOT NULL OR age IS NOT NULL OR best_time_to_call IS NOT NULL
                       OR spouse_info IS NOT NULL OR lead_conversion IS NOT NULL)
  UNION ALL
  SELECT 11, 'clients_triggers', (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.clients'::regclass AND NOT tgisinternal),
         (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.clients'::regclass AND NOT tgisinternal)
           = 'clients_lead_conversion_guard,clients_policy_identity,clients_policy_sale_complete,contact_history_capture,workflow_client_insert_trigger'
)
SELECT n, check_name, value, ok FROM checks ORDER BY n;

-- Must equal the preflight fingerprints exactly.
SELECT 'clients_rows' AS fingerprint, count(*)::text AS count,
       md5(coalesce(string_agg((to_jsonb(c) - ARRAY['date_of_birth', 'age', 'best_time_to_call', 'spouse_info', 'lead_conversion'])::text,
           E'\n' ORDER BY c.id), '')) AS digest FROM public.clients c
UNION ALL
SELECT 'clients_policies', count(*)::text, md5(coalesce(string_agg(polname || ':' || polcmd::text || ':' || coalesce(pg_get_expr(polqual, polrelid), '')
         || ':' || coalesce(pg_get_expr(polwithcheck, polrelid), ''), E'\n' ORDER BY polname), ''))
FROM pg_policy WHERE polrelid = 'public.clients'::regclass
UNION ALL
SELECT 'clients_acl', NULL, md5(coalesce((SELECT relacl::text FROM pg_class WHERE oid = 'public.clients'::regclass), ''))
UNION ALL
SELECT 'wins_rows', count(*)::text, md5(coalesce(string_agg(to_jsonb(w)::text, E'\n' ORDER BY w.id), '')) FROM public.wins w;
