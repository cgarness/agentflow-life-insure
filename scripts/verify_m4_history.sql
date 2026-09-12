-- =====================================================================================================
-- M4 HISTORY VERIFIER — READ ONLY, MACHINE CHECKED, plain SQL (no psql meta-commands).
-- =====================================================================================================
-- Separate from the schema verifier on purpose: recovery from a failed history repair leaves a CORRECT
-- schema with a MISSING history row, and that state must be diagnosable and fixable on its own.
--
-- EXPECTED VERSION. The direct procedure records the authored version, so the built-in default is right
-- and nothing needs changing. The MCP procedure lets the service assign the version, so read what was
-- actually recorded (verify_m4_state.sql reports `history_head` / `newest_three`) and pass it in — no
-- file edit required, in either runner:
--     psql "$URL" -c "SET m4.expected_version = '20260912...'" -f scripts/verify_m4_history.sql
--     execute_sql:  SET m4.expected_version = '20260912...';   <paste this whole file after it>
DO $verify$
DECLARE
  expected_version constant text :=
    coalesce(nullif(current_setting('m4.expected_version', true), ''), '20260911000100');
  fail text[] := '{}';
  n int; v_name text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'M4 HISTORY CONTRACT FAILED: supabase_migrations.schema_migrations does not exist';
  END IF;
  SELECT count(*) INTO n FROM supabase_migrations.schema_migrations WHERE version = expected_version;
  IF n <> 1 THEN
    fail := array_append(fail, format('expected exactly ONE history row for version %s, found %s', expected_version, n));
  ELSE
    SELECT name INTO v_name FROM supabase_migrations.schema_migrations WHERE version = expected_version;
    IF v_name IS NOT NULL AND v_name NOT LIKE '%inbound_agent_settings_and_registrations%' THEN
      fail := array_append(fail, format('history row %s carries an unexpected name: %s', expected_version, v_name));
    END IF;
  END IF;
  -- the history row must describe a schema that is actually there
  IF to_regclass('public.agent_inbound_settings') IS NULL OR to_regclass('public.agent_phone_registrations') IS NULL THEN
    fail := array_append(fail, 'history claims M4 is applied but its tables are absent');
  END IF;
  -- exactly ONE inbound-v2 migration may be recorded, and it must be the expected one: M5-M7 are not in
  -- this approval, and a second M4-shaped row would mean the apply ran twice under two versions.
  SELECT count(*) INTO n FROM supabase_migrations.schema_migrations
   WHERE version IN ('20260911000200','20260911000300','20260911000400');
  IF n <> 0 THEN fail := array_append(fail, format('%s of M5-M7 are recorded as applied (this approval covers M4 only)', n)); END IF;
  SELECT count(*) INTO n FROM supabase_migrations.schema_migrations
   WHERE name LIKE '%inbound_agent_settings_and_registrations%' AND version <> expected_version;
  IF n <> 0 THEN fail := array_append(fail, format('%s ADDITIONAL M4-named history row(s) under other versions', n)); END IF;
  IF cardinality(fail) > 0 THEN
    RAISE EXCEPTION 'M4 HISTORY CONTRACT FAILED (% problem(s)): %', cardinality(fail), array_to_string(fail, ' || ');
  END IF;
END
$verify$;
SELECT 'M4_HISTORY_VERIFIED' AS verdict, version, name
  FROM supabase_migrations.schema_migrations
 WHERE version = coalesce(nullif(current_setting('m4.expected_version', true), ''), '20260911000100');
