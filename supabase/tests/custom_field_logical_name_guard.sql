-- =====================================================================================================
-- Custom-Field Canonicalization — SQL integration tests for the forward-only logical-name guard.
-- STATUS: run ONLY on a disposable LOCAL PostgreSQL database (AGENT_RULES invariant #28).
-- Requires: supabase/tests/custom_fields_harness.sql, then
--           supabase/migrations/20260919052941_custom_field_logical_name_guard.sql.
-- =====================================================================================================
-- Each scenario is an independent DO block; an uncaught RAISE names the failing scenario. No
-- assertion is weakened. Org A = 'aaaaaaaa-…000a' (holds the 3 seeded legacy "Gender" rows),
-- Org B = 'bbbbbbbb-…000b'. Concurrency (S13), the negative control (S14) and the rollback proof
-- (S15) live in scripts/run_custom_field_guard_tests.sh because they need more than one session or a
-- separate database.

-- ---- S1: LEGACY COEXISTENCE. The migration applied over 3 violating rows; all 3 survive untouched.
DO $$
DECLARE v_n int; v_active int; v_names int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE active), count(DISTINCT name)
    INTO v_n, v_active, v_names
    FROM public.custom_fields
   WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a' AND name = 'Gender';
  IF v_n <> 3 OR v_active <> 3 OR v_names <> 1 THEN
    RAISE EXCEPTION 'S1 FAILED: legacy duplicates not intact (rows=%, active=%, names=%)', v_n, v_active, v_names;
  END IF;
  -- And the guard really is installed.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.custom_fields'::regclass
                    AND tgname = 'trg_custom_fields_logical_name_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'S1 FAILED: guard trigger is not installed';
  END IF;
END$$;

-- ---- S2: FORWARD INSERT REJECTED. A fourth "Gender", by a user who owns none, must fail 23505.
DO $$
DECLARE v_sqlstate text := NULL;
BEGIN
  BEGIN
    INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
    VALUES ('Gender','Text','["Leads"]'::jsonb,
            'aaaaaaaa-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-0000000000b1');
  EXCEPTION WHEN unique_violation THEN v_sqlstate := SQLSTATE;
  END;
  IF v_sqlstate IS DISTINCT FROM '23505' THEN
    RAISE EXCEPTION 'S2 FAILED: expected 23505, got %', coalesce(v_sqlstate,'NO ERROR — the insert succeeded');
  END IF;
END$$;

-- ---- S3: CROSS-USER PERSONAL COLLISION on a brand-new name. First wins, second is rejected —
--          this is the case the two pre-existing indexes allow and the guard must not.
DO $$
DECLARE v_sqlstate text := NULL;
BEGIN
  INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
  VALUES ('Beneficiary','Text','["Leads"]'::jsonb,
          'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000a1');
  BEGIN
    INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
    VALUES ('Beneficiary','Text','["Leads"]'::jsonb,
            'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000a2');
  EXCEPTION WHEN unique_violation THEN v_sqlstate := SQLSTATE;
  END;
  IF v_sqlstate IS DISTINCT FROM '23505' THEN
    RAISE EXCEPTION 'S3 FAILED: a second user created the same personal name (%)', coalesce(v_sqlstate,'NO ERROR');
  END IF;
END$$;

-- ---- S4: AGENCY <-> PERSONAL COLLISION, both directions.
DO $$
DECLARE v_a text := NULL; v_b text := NULL;
BEGIN
  -- agency first, then personal
  INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
  VALUES ('Coverage Type','Text','["Leads"]'::jsonb,'aaaaaaaa-0000-0000-0000-00000000000a', NULL);
  BEGIN
    INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
    VALUES ('coverage  type','Text','["Leads"]'::jsonb,
            'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000a1');
  EXCEPTION WHEN unique_violation THEN v_a := SQLSTATE;
  END;
  IF v_a IS DISTINCT FROM '23505' THEN
    RAISE EXCEPTION 'S4 FAILED (agency->personal): expected 23505, got %', coalesce(v_a,'NO ERROR');
  END IF;

  -- personal first, then agency
  INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
  VALUES ('Military','Text','["Leads"]'::jsonb,
          'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000a2');
  BEGIN
    INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
    VALUES ('MILITARY','Text','["Leads"]'::jsonb,'aaaaaaaa-0000-0000-0000-00000000000a', NULL);
  EXCEPTION WHEN unique_violation THEN v_b := SQLSTATE;
  END;
  IF v_b IS DISTINCT FROM '23505' THEN
    RAISE EXCEPTION 'S4 FAILED (personal->agency): expected 23505, got %', coalesce(v_b,'NO ERROR');
  END IF;
END$$;

-- ---- S5: NORMALIZATION CONTRACT. Pins private.custom_field_norm against the TS normalizer, and
--          records the accepted ASCII-only behaviour (decision D-3).
DO $$
DECLARE v_bad text;
BEGIN
  -- trim, collapse repeated internal whitespace, lowercase, punctuation preserved
  IF private.custom_field_norm('  Gender ')          <> 'gender'      THEN RAISE EXCEPTION 'S5 FAILED: trim'; END IF;
  IF private.custom_field_norm('GENDER')             <> 'gender'      THEN RAISE EXCEPTION 'S5 FAILED: lowercase'; END IF;
  IF private.custom_field_norm('Amt   Requested')    <> 'amt requested' THEN RAISE EXCEPTION 'S5 FAILED: collapse'; END IF;
  IF private.custom_field_norm('Date/Time')          <> 'date/time'   THEN RAISE EXCEPTION 'S5 FAILED: punctuation'; END IF;
  IF private.custom_field_norm('Date/Time')           = private.custom_field_norm('Date Time')
    THEN RAISE EXCEPTION 'S5 FAILED: Date/Time must NOT equal Date Time'; END IF;
  IF private.custom_field_norm(E'Gender\tName')      <> 'gender name' THEN RAISE EXCEPTION 'S5 FAILED: tab'; END IF;
  IF private.custom_field_norm(E'Gender\n  Name')    <> 'gender name' THEN RAISE EXCEPTION 'S5 FAILED: newline'; END IF;
  IF private.custom_field_norm(NULL)                 <> ''            THEN RAISE EXCEPTION 'S5 FAILED: null'; END IF;

  -- DOCUMENTED DIVERGENCE (D-3, accepted, not fixed in this build): U+00A0 NBSP is Unicode
  -- whitespace to JavaScript's \s but not to PostgreSQL's. Asserting the CURRENT behaviour so the
  -- contract is pinned and any future change is deliberate rather than accidental.
  v_bad := private.custom_field_norm(E'Gender Name');
  IF v_bad = 'gender name' THEN
    RAISE EXCEPTION 'S5 FAILED: NBSP now collapses in SQL — the D-3 divergence changed; revisit the TS mirror';
  END IF;
END$$;

-- ---- S6: PUNCTUATION IS MEANINGFUL. Date/Time and Date Time are different fields and both insert.
DO $$
DECLARE v_n int;
BEGIN
  INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by) VALUES
    ('Date/Time','Text','["Leads"]'::jsonb,'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000ad'),
    ('Date Time','Text','["Leads"]'::jsonb,'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000ad');
  SELECT count(*) INTO v_n FROM public.custom_fields
   WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a' AND name IN ('Date/Time','Date Time');
  IF v_n <> 2 THEN RAISE EXCEPTION 'S6 FAILED: expected both rows, found %', v_n; END IF;
END$$;

-- ---- S7: TENANT ISOLATION. Org A's field must never block Org B. (Test-plan case 16.)
DO $$
DECLARE v_n int;
BEGIN
  INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
  VALUES ('Gender','Text','["Leads"]'::jsonb,
          'bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-0000000000b1');
  SELECT count(*) INTO v_n FROM public.custom_fields
   WHERE organization_id = 'bbbbbbbb-0000-0000-0000-00000000000b' AND name = 'Gender';
  IF v_n <> 1 THEN RAISE EXCEPTION 'S7 FAILED: org B could not create its own Gender (rows=%)', v_n; END IF;
  -- and org A is unchanged
  SELECT count(*) INTO v_n FROM public.custom_fields
   WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a' AND name = 'Gender';
  IF v_n <> 3 THEN RAISE EXCEPTION 'S7 FAILED: org A row count changed to %', v_n; END IF;
END$$;

-- ---- S8: SYSTEM TEMPLATES are exempt. organization_id IS NULL is outside every tenant namespace.
DO $$
DECLARE v_n int;
BEGIN
  INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
  VALUES ('Gender','Text','["Leads"]'::jsonb, NULL, NULL);
  SELECT count(*) INTO v_n FROM public.custom_fields WHERE organization_id IS NULL AND name = 'Gender';
  IF v_n <> 2 THEN RAISE EXCEPTION 'S8 FAILED: system templates are not exempt (rows=%)', v_n; END IF;
END$$;

-- ---- S9: INACTIVE ROWS ARE EXEMT, matching the two pre-existing partial indexes.
DO $$
DECLARE v_n int;
BEGIN
  -- an inactive row may be created even though an active one holds the name
  INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by, active)
  VALUES ('Gender','Text','["Leads"]'::jsonb,
          'aaaaaaaa-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-0000000000b1', false);
  SELECT count(*) INTO v_n FROM public.custom_fields
   WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a' AND name = 'Gender' AND NOT active;
  IF v_n <> 1 THEN RAISE EXCEPTION 'S9 FAILED: inactive row was blocked (rows=%)', v_n; END IF;

  -- a retired name does not hold the namespace hostage
  INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by, active)
  VALUES ('Retired Field','Text','["Leads"]'::jsonb,
          'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000a1', false);
  INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
  VALUES ('Retired Field','Text','["Leads"]'::jsonb,
          'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000a2');
END$$;

-- ---- S10: GRANDFATHER CLAUSE — a legacy duplicate stays EDITABLE.
DO $$
DECLARE v_type text; v_req boolean;
BEGIN
  UPDATE public.custom_fields
     SET type = 'Number', required = true, dropdown_options = '["a","b"]'::jsonb
   WHERE id = '11111111-1111-1111-1111-111111111102';
  SELECT type, required INTO v_type, v_req
    FROM public.custom_fields WHERE id = '11111111-1111-1111-1111-111111111102';
  IF v_type <> 'Number' OR v_req IS NOT TRUE THEN
    RAISE EXCEPTION 'S10 FAILED: legacy duplicate could not be edited (type=%, required=%)', v_type, v_req;
  END IF;

  -- a no-op re-save of the same name must also pass
  UPDATE public.custom_fields SET name = 'Gender' WHERE id = '11111111-1111-1111-1111-111111111102';
  -- and so must a whitespace/case variant that normalizes identically
  UPDATE public.custom_fields SET name = '  GENDER ' WHERE id = '11111111-1111-1111-1111-111111111102';
  UPDATE public.custom_fields SET name = 'Gender'    WHERE id = '11111111-1111-1111-1111-111111111102';
END$$;

-- ---- S11: GRANDFATHER CLAUSE — a legacy duplicate stays RE-ACTIVATABLE (decision D-2, LENIENT).
DO $$
DECLARE v_active boolean;
BEGIN
  UPDATE public.custom_fields SET active = false WHERE id = '11111111-1111-1111-1111-111111111103';
  UPDATE public.custom_fields SET active = true  WHERE id = '11111111-1111-1111-1111-111111111103';
  SELECT active INTO v_active FROM public.custom_fields WHERE id = '11111111-1111-1111-1111-111111111103';
  IF v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'S11 FAILED: a legacy duplicate became one-way deactivatable';
  END IF;
END$$;

-- ---- S12: RENAME INTO A COLLISION IS REJECTED; rename to a free name is allowed.
DO $$
DECLARE v_sqlstate text := NULL; v_name text;
BEGIN
  INSERT INTO public.custom_fields (id, name, type, applies_to, organization_id, created_by)
  VALUES ('22222222-2222-2222-2222-222222222201','Hobby','Text','["Leads"]'::jsonb,
          'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000a1');
  BEGIN
    UPDATE public.custom_fields SET name = 'gender' WHERE id = '22222222-2222-2222-2222-222222222201';
  EXCEPTION WHEN unique_violation THEN v_sqlstate := SQLSTATE;
  END;
  IF v_sqlstate IS DISTINCT FROM '23505' THEN
    RAISE EXCEPTION 'S12 FAILED: rename into a collision was allowed (%)', coalesce(v_sqlstate,'NO ERROR');
  END IF;

  UPDATE public.custom_fields SET name = 'Favourite Hobby' WHERE id = '22222222-2222-2222-2222-222222222201';
  SELECT name INTO v_name FROM public.custom_fields WHERE id = '22222222-2222-2222-2222-222222222201';
  IF v_name <> 'Favourite Hobby' THEN
    RAISE EXCEPTION 'S12 FAILED: rename to a free name was blocked (name=%)', v_name;
  END IF;
END$$;

-- ---- S16: ERROR CONTRACT. The raised SQLSTATE must be exactly 23505 AND the message must carry the
--           phrase src/lib/supabase-settings.ts matches on, or the UI degrades to a raw DB error.
DO $$
DECLARE v_state text := NULL; v_msg text := NULL;
BEGIN
  BEGIN
    INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by)
    VALUES ('Gender','Text','["Leads"]'::jsonb,
            'aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-0000000000a1');
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23505' THEN
    RAISE EXCEPTION 'S16 FAILED: SQLSTATE was % (expected 23505)', coalesce(v_state,'NO ERROR');
  END IF;
  IF v_msg !~* 'already exists in this organization' THEN
    RAISE EXCEPTION 'S16 FAILED: message does not match the client predicate: %', v_msg;
  END IF;
END$$;

-- ---- S17: PRIVILEGE HARDENING (decision D-1) took effect.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) INTO v_bad
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'custom_fields'
     AND grantee = 'authenticated' AND privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'S17 FAILED: authenticated still holds % on custom_fields', v_bad;
  END IF;

  SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) INTO v_bad
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'custom_fields' AND grantee = 'anon';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'S17 FAILED: anon still holds % on custom_fields', v_bad;
  END IF;

  -- and the four verbs the app actually uses survive
  SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) INTO v_bad
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'custom_fields'
     AND grantee = 'authenticated' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');
  IF v_bad IS DISTINCT FROM 'DELETE, INSERT, SELECT, UPDATE' THEN
    RAISE EXCEPTION 'S17 FAILED: authenticated lost required privileges (has: %)', coalesce(v_bad,'none');
  END IF;
END$$;

-- ---- S18: THE GUARD FUNCTION IS NOT A PUBLIC API.
DO $$
BEGIN
  IF has_function_privilege('anon', 'private.custom_fields_logical_name_guard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.custom_fields_logical_name_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'S18 FAILED: the guard function is EXECUTE-able by a client role';
  END IF;
  IF has_schema_privilege('anon', 'private', 'USAGE')
     OR has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'S18 FAILED: a client role holds USAGE on schema private';
  END IF;
END$$;

-- ---- S19: NOTHING WAS MUTATED BY THE MIGRATION ITSELF. The three seeded legacy rows still carry
--           their original ids, names, owners and created_at. (S10/S11 deliberately edited …102 and
--           …103, so identity is asserted on all three and content on the untouched …101.)
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.custom_fields
   WHERE id IN ('11111111-1111-1111-1111-111111111101',
                '11111111-1111-1111-1111-111111111102',
                '11111111-1111-1111-1111-111111111103')
     AND name = 'Gender' AND organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  IF v_n <> 3 THEN RAISE EXCEPTION 'S19 FAILED: legacy row identity changed (matched %)', v_n; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.custom_fields
     WHERE id = '11111111-1111-1111-1111-111111111101'
       AND name = 'Gender' AND type = 'Text' AND active
       AND created_by = 'aaaaaaaa-0000-0000-0000-0000000000ad'
       AND created_at = '2026-08-04 18:31:30+00'::timestamptz
  ) THEN
    RAISE EXCEPTION 'S19 FAILED: the untouched legacy row was modified';
  END IF;
END$$;

SELECT 'custom_field_logical_name_guard: ALL SCENARIOS PASSED' AS result;
