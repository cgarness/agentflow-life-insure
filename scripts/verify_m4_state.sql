-- =====================================================================================================
-- M4 STATE CLASSIFIER — READ ONLY, plain SQL. Answers "what actually happened?" after ANY uncertain
-- outcome (a psql invocation that failed or was cut off, a history repair whose response was lost).
-- It NEVER writes and never recommends a write by itself; the procedure decides from `state`.
-- =====================================================================================================
--   NEITHER      · no M4 object, no history row      → the apply did not land; re-running the apply is safe
--   SCHEMA_ONLY  · both tables present, history absent → apply landed, history missing; reconcile HISTORY ONLY
--   BOTH         · tables present and history present  → complete; verify and stop
--   PARTIAL      · anything else                       → investigate by hand; do NOT write
WITH o AS (
  SELECT (to_regclass('public.agent_inbound_settings')    IS NOT NULL) AS settings_tbl,
         (to_regclass('public.agent_phone_registrations') IS NOT NULL) AS registrations_tbl,
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('is_phone_connected','heartbeat_phone_registration')) AS m4_functions,
         (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260911000100') AS history_rows,
         (SELECT max(version) FROM supabase_migrations.schema_migrations) AS history_head,
         (SELECT string_agg(version || '/' || coalesce(name,''), ' , ' ORDER BY version DESC)
            FROM (SELECT version, name FROM supabase_migrations.schema_migrations
                   ORDER BY version DESC LIMIT 3) t) AS newest_three,
         (SELECT count(*) FROM supabase_migrations.schema_migrations
           WHERE version IN ('20260911000200','20260911000300','20260911000400')) AS m5_m7_rows
)
SELECT CASE
         WHEN NOT settings_tbl AND NOT registrations_tbl AND m4_functions = 0 AND history_rows = 0 THEN 'NEITHER'
         WHEN settings_tbl AND registrations_tbl AND m4_functions = 2 AND history_rows = 0 THEN 'SCHEMA_ONLY'
         WHEN settings_tbl AND registrations_tbl AND m4_functions = 2 AND history_rows = 1 THEN 'BOTH'
         ELSE 'PARTIAL'
       END AS state,
       settings_tbl, registrations_tbl, m4_functions, history_rows, m5_m7_rows, history_head, newest_three
  FROM o;
