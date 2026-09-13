-- =====================================================================================================
-- M4 STATE CLASSIFIER — READ ONLY, plain SQL. /* M4_STATE_CLASSIFIER */
-- =====================================================================================================
-- Answers "what is actually there?" — before the apply, and after ANY uncertain outcome (a call that
-- errored, timed out, or whose response was lost). It NEVER writes and never recommends a write on its
-- own; `next_action` states the procedure's rule for the reading it just took.
--
-- MODE — set it; the default is the conservative one.
--     SET m4.mode = 'preflight';   -- a first look, before anything has been submitted
--     SET m4.mode = 'recovery';    -- after an uncertain outcome   (DEFAULT when unset)
--
--   psql:        psql "$URL" -c "SET m4.mode = 'preflight'" -f scripts/verify_m4_state.sql
--   execute_sql: SET m4.mode = 'preflight';   <paste this whole file after it>
--
-- ── WHY `NEITHER` IS NOT THE SAME ANSWER IN BOTH MODES ───────────────────────────────────────────────
-- This is a snapshot of COMMITTED state. Under PostgreSQL's default READ COMMITTED isolation a statement
-- sees only rows and catalog entries committed before it began, so an apply that is STILL RUNNING in
-- another session is completely invisible here and commits afterwards
-- (https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED).
--
--   • In `preflight`, nothing has been submitted, so `NEITHER` means the target is clean.
--   • In `recovery`, `NEITHER` means ONLY: *no committed M4 state was observed at this read.* It does
--     NOT mean the original operation failed, and it does NOT authorize another apply. Replay is
--     permitted only once the ORIGINAL operation is authoritatively known to have ended WITHOUT
--     committing — for example the server returned a definitive SQLSTATE for that statement, or the
--     backend that ran it is provably gone and no prepared transaction holds it. **Elapsed time,
--     "it looks finished", and repeated empty reads establish nothing.** If it cannot be established,
--     stop and report the outcome as UNRESOLVED.
--
-- The `other_open_transactions`, `backends_naming_m4_objects` and `prepared_xacts` columns exist to make
-- an in-flight operation VISIBLE. They settle nothing on their own, in either direction:
--   • zero proves nothing — a pooled connection, a backend between statements, or a snapshot taken at
--     the wrong instant all read as quiet;
--   • non-zero does not identify the apply — on a busy database `other_open_transactions` is normally
--     non-zero from ordinary traffic. `backends_naming_m4_objects` is the specific one, and even it only
--     sees a backend's CURRENT statement, so an apply parked between statements is not counted.
-- Only `backends_naming_m4_objects > 0` is positive evidence, and only that something touching these
-- objects is running right now.
--
-- ── STATES ───────────────────────────────────────────────────────────────────────────────────────────
--   NEITHER      · no M4 object, no M4 history row
--   SCHEMA_ONLY  · every M4 object present, no M4 history row  → reconcile HISTORY ONLY, never the SQL
--   BOTH         · every M4 object present and exactly one unambiguous M4 history row
--   PARTIAL      · anything else — SOME objects, DUPLICATE history rows, or CONFLICTING identities
--
-- ── HOW M4 IS RECOGNISED IN THE HISTORY ──────────────────────────────────────────────────────────────
-- Not by the authored version alone. MCP `apply_migration` records a SERVICE-ASSIGNED version under the
-- submitted NAME, so matching on `version = '20260911000100'` would miss a perfectly good MCP apply and
-- wrongly report SCHEMA_ONLY. A row is M4 if its `name` is exactly the submitted migration name, OR its
-- `version` is the authored version (which is what `migration repair` records under the direct
-- procedure). Every match is returned in `m4_history_versions` so the identity can be read, not guessed.
--
-- (`supabase_migrations.schema_migrations` is assumed to exist: every Supabase project has it, and a
-- static SELECT cannot guard a missing relation. If it is absent this errors rather than classifying,
-- which is itself the right answer — the target is not the project this procedure was written for.)
WITH ident AS (
  SELECT 'inbound_agent_settings_and_registrations'::text AS m4_name,
         '20260911000100'::text                           AS authored_version,
         -- anything that is not exactly 'preflight' falls back to the conservative reading, and says so
         CASE lower(coalesce(nullif(current_setting('m4.mode', true), ''), 'recovery'))
           WHEN 'preflight' THEN 'preflight'
           WHEN 'recovery'  THEN 'recovery'
           ELSE 'recovery (unrecognised m4.mode: '
                || lower(nullif(current_setting('m4.mode', true), '')) || ')'
         END AS mode
), h AS (
  SELECT sm.version, sm.name,
         (sm.name = i.m4_name)            AS by_name,
         (sm.version = i.authored_version) AS by_version
    FROM supabase_migrations.schema_migrations sm, ident i
   WHERE sm.name = i.m4_name OR sm.version = i.authored_version
), o AS (
  SELECT
    (to_regclass('public.agent_inbound_settings')    IS NOT NULL) AS settings_tbl,
    (to_regclass('public.agent_phone_registrations') IS NOT NULL) AS registrations_tbl,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('is_phone_connected','heartbeat_phone_registration')) AS m4_functions,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname = 'agent_inbound_settings_guard') AS guard_function,
    (SELECT count(*) FROM pg_trigger t
      WHERE t.tgrelid = to_regclass('public.agent_inbound_settings')
        AND t.tgname = 'trg_agent_inbound_settings_guard' AND NOT t.tgisinternal) AS guard_trigger,
    (SELECT count(*) FROM h)                                       AS m4_history_rows,
    (SELECT count(*) FROM h WHERE by_name)                         AS m4_rows_by_name,
    (SELECT count(*) FROM h WHERE by_version)                      AS m4_rows_by_version,
    (SELECT count(*) FROM h WHERE by_version AND NOT by_name AND name IS NOT NULL) AS m4_version_name_conflicts,
    (SELECT string_agg(version || '/' || coalesce(name, '<null-name>'), ' , ' ORDER BY version) FROM h) AS m4_history_versions,
    (SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE version IN ('20260911000200','20260911000300','20260911000400')
         OR name IN ('inbound_routing_v2_settings','inbound_route_attempts_d13_and_recovery','inbound_voicemails')) AS m5_m7_rows,
    (SELECT max(version) FROM supabase_migrations.schema_migrations) AS history_head,
    (SELECT string_agg(version || '/' || coalesce(name,''), ' , ' ORDER BY version DESC)
       FROM (SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3) t) AS newest_three,
    -- in-flight evidence: can only ever prove that something IS running, never that nothing is
    (SELECT count(*) FROM pg_stat_activity a
      WHERE a.pid <> pg_backend_pid() AND a.datname = current_database()
        AND a.xact_start IS NOT NULL)                              AS other_open_transactions,
    (SELECT count(*) FROM pg_stat_activity a
      WHERE a.pid <> pg_backend_pid() AND a.datname = current_database()
        AND a.query ~ '(agent_inbound_settings|agent_phone_registrations|heartbeat_phone_registration)'
        AND a.query NOT LIKE '%M4\_STATE\_CLASSIFIER%')            AS backends_naming_m4_objects,
    (SELECT count(*) FROM pg_prepared_xacts WHERE database = current_database()) AS prepared_xacts
), s AS (
  SELECT o.*, i.mode,
         (o.settings_tbl::int + o.registrations_tbl::int + o.m4_functions + o.guard_function + o.guard_trigger) AS m4_objects,
         -- each component is required in its own right. A bare sum could reach 6 through a compensating
         -- error (an extra function overload standing in for the missing guard trigger, say) and report
         -- a complete apply that is not one.
         (o.settings_tbl AND o.registrations_tbl AND o.m4_functions = 2
            AND o.guard_function = 1 AND o.guard_trigger = 1)                       AS m4_objects_complete,
         (NOT o.settings_tbl AND NOT o.registrations_tbl AND o.m4_functions = 0
            AND o.guard_function = 0 AND o.guard_trigger = 0)                       AS m4_objects_absent,
         (o.m4_history_rows > 1 OR o.m4_version_name_conflicts > 0) AS ambiguous_history
    FROM o, ident i
), c AS (
  SELECT s.*, CASE
      WHEN m4_objects_absent   AND m4_history_rows = 0                          THEN 'NEITHER'
      WHEN m4_objects_complete AND m4_history_rows = 0                          THEN 'SCHEMA_ONLY'
      WHEN m4_objects_complete AND m4_history_rows = 1 AND NOT ambiguous_history THEN 'BOTH'
      ELSE 'PARTIAL'
    END AS state
    FROM s
)
SELECT state,
       mode,
       CASE
         WHEN mode = 'preflight' AND state = 'NEITHER'      THEN 'PROCEED_WITH_APPLY'
         WHEN mode = 'preflight'                            THEN 'STOP_UNEXPECTED_PRESTATE'
         -- every branch below is the conservative (recovery) reading
         WHEN state = 'NEITHER'     THEN 'OUTCOME_UNRESOLVED_DO_NOT_REPLAY'
         WHEN state = 'SCHEMA_ONLY' THEN 'RECONCILE_HISTORY_ONLY'
         WHEN state = 'BOTH'        THEN 'COMPLETE_VERIFY_AND_STOP'
         ELSE                            'INVESTIGATE_WRITE_NOTHING'
       END AS next_action,
       CASE
         WHEN mode = 'preflight' AND state = 'NEITHER' THEN 'clean target; the single apply may be submitted'
         WHEN mode = 'preflight'  THEN 'the target is not clean — do not submit the apply'
         WHEN state = 'NEITHER'   THEN 'NO COMMITTED M4 STATE OBSERVED AT THIS READ. This does not mean the operation failed: under READ COMMITTED an apply still running elsewhere is invisible here. Replay ONLY if the original operation is authoritatively known to have ended without committing; otherwise report UNRESOLVED.'
         WHEN state = 'SCHEMA_ONLY' THEN 'the SQL committed; reconcile the HISTORY ROW ALONE, and first confirm no history repair is itself still in flight'
         WHEN state = 'BOTH'      THEN 'the write landed; verify the contracts and stop'
         ELSE 'unexpected: partial objects, duplicate history rows, or conflicting identities — investigate read-only and write nothing'
       END AS reading,
       settings_tbl, registrations_tbl, m4_functions, guard_function, guard_trigger,
       m4_objects, m4_objects_complete, m4_objects_absent,
       m4_history_rows, m4_rows_by_name, m4_rows_by_version, m4_version_name_conflicts, ambiguous_history,
       m4_history_versions, m5_m7_rows, history_head, newest_three,
       other_open_transactions, backends_naming_m4_objects, prepared_xacts
  FROM c;
