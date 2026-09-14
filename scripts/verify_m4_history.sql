-- =====================================================================================================
-- M4 HISTORY VERIFIER — READ ONLY, MACHINE CHECKED, plain SQL (no psql meta-commands).
-- =====================================================================================================
-- Separate from the schema verifier on purpose: recovery from a failed history repair leaves a CORRECT
-- schema with a MISSING history row, and that state must be diagnosable and fixable on its own.
--
-- ── IDENTITY: THE EXACT SUBMITTED NAME, NOT A SUBSTRING AND NOT A NULL ───────────────────────────────
-- M4 is recognised by `name = 'inbound_agent_settings_and_registrations'` — the exact name submitted to
-- MCP `apply_migration`, and (verified against the pinned CLI 2.84.5 on a disposable database) also
-- exactly what `supabase migration repair --status applied 20260914000530` writes, because it takes the
-- name from the migration filename. An earlier revision accepted a NULL name and a LIKE match; both are
-- rejected now — a NULL name identifies nothing, and a substring match would accept a different
-- migration whose name merely contains this one.
--
-- ── THE RECORDED VERSION IS DERIVED FROM THAT EVIDENCE, NOT FROM "NEWEST" ────────────────────────────
-- MCP assigns the version, so it is READ from the row bearing the exact name rather than assumed. Set
-- `m4.expected_version` only when you want to pin a specific value (for example the version the apply
-- response reported); with it unset the verifier resolves and reports whatever was actually recorded.
--     psql "$URL" -c "SET m4.expected_version = '20260913…'" -f scripts/verify_m4_history.sql
--     execute_sql:  SET m4.expected_version = '20260913…';   <paste this whole file after it>
DO $verify$
DECLARE
  m4_name          constant text := 'inbound_agent_settings_and_registrations';
  repo_version     constant text := '20260914000530';   -- the version in the repository filename
  pinned_version   constant text := nullif(current_setting('m4.expected_version', true), '');
  fail text[] := '{}';
  n int; resolved_version text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'M4 HISTORY CONTRACT FAILED: supabase_migrations.schema_migrations does not exist';
  END IF;

  -- 1. exactly ONE row carries the exact submitted name
  SELECT count(*) INTO n FROM supabase_migrations.schema_migrations WHERE name = m4_name;
  IF n = 0 THEN
    fail := array_append(fail, format('no history row carries the exact migration name %L', m4_name));
  ELSIF n > 1 THEN
    fail := array_append(fail, format('%s history rows carry the name %L (versions: %s) — duplicate apply', n, m4_name,
              (SELECT string_agg(version, ', ' ORDER BY version) FROM supabase_migrations.schema_migrations WHERE name = m4_name)));
  ELSE
    -- 2. the recorded version comes FROM the matching row, never from max(version)
    SELECT version INTO resolved_version FROM supabase_migrations.schema_migrations WHERE name = m4_name;
    IF pinned_version IS NOT NULL AND resolved_version <> pinned_version THEN
      fail := array_append(fail, format('M4 is recorded under version %s, but m4.expected_version pins %s',
                                        resolved_version, pinned_version));
    END IF;
  END IF;

  -- 3. a near-miss name is a different migration, not this one
  SELECT count(*) INTO n FROM supabase_migrations.schema_migrations
   WHERE name LIKE '%' || m4_name || '%' AND name <> m4_name;
  IF n <> 0 THEN
    fail := array_append(fail, format('%s history row(s) carry a name CONTAINING but not equal to %L: %s', n, m4_name,
              (SELECT string_agg(version || '/' || name, ', ' ORDER BY version) FROM supabase_migrations.schema_migrations
                WHERE name LIKE '%' || m4_name || '%' AND name <> m4_name)));
  END IF;

  -- 4. the repository's own version must not have been claimed by a different migration
  SELECT count(*) INTO n FROM supabase_migrations.schema_migrations
   WHERE version = repo_version AND (name IS NULL OR name <> m4_name);
  IF n <> 0 THEN
    fail := array_append(fail, format('the repository version %s is recorded under a different or absent name: %s',
              repo_version,
              (SELECT string_agg(coalesce(name,'<null-name>'), ', ') FROM supabase_migrations.schema_migrations
                WHERE version = repo_version AND (name IS NULL OR name <> m4_name))));
  END IF;

  -- 5. the history row must describe a schema that is actually there
  IF to_regclass('public.agent_inbound_settings') IS NULL OR to_regclass('public.agent_phone_registrations') IS NULL THEN
    fail := array_append(fail, 'history claims M4 is applied but its tables are absent');
  END IF;

  -- 6. M5-M7 are not in this approval — matched by version OR by their submitted names
  SELECT count(*) INTO n FROM supabase_migrations.schema_migrations
   WHERE version IN ('20260914000531','20260914000532','20260914000533')
      OR name    IN ('inbound_routing_v2_settings','inbound_route_attempts_d13_and_recovery','inbound_voicemails');
  IF n <> 0 THEN
    fail := array_append(fail, format('%s of M5-M7 are recorded as applied (this approval covers M4 only)', n));
  END IF;

  IF cardinality(fail) > 0 THEN
    RAISE EXCEPTION 'M4 HISTORY CONTRACT FAILED (% problem(s)): %', cardinality(fail), array_to_string(fail, ' || ');
  END IF;
END
$verify$;
SELECT 'M4_HISTORY_VERIFIED' AS verdict, version AS recorded_version, name
  FROM supabase_migrations.schema_migrations
 WHERE name = 'inbound_agent_settings_and_registrations';
