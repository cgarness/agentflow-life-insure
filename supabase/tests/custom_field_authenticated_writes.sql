-- =====================================================================================================
-- Custom-field WRITE PATH as the CLIENT roles — SQL integration tests (Custom-field creation outage,
-- 2026-09-22). STATUS: run ONLY on a disposable LOCAL PostgreSQL database (AGENT_RULES invariant #28).
-- Requires, in order: supabase/tests/custom_fields_harness.sql, supabase/tests/custom_fields_rls_harness.sql,
--   supabase/migrations/20260919052941_custom_field_logical_name_guard.sql,
--   supabase/migrations/20260922222659_custom_field_norm_execute_grant.sql.
-- =====================================================================================================
-- Every write below runs AS `authenticated` (or `service_role`) with production-shaped JWT claims, RLS
-- ENABLED with the four production policies, and `RETURNING to_jsonb(...)` exactly as PostgREST's
-- return=representation does. This is the path the superuser-only guard suite could not see.
-- Each scenario is an independent DO block; an uncaught RAISE names the failing scenario.
--
-- Org A = 'aaaaaaaa-…000a' (Admin …ad, Agents …a1/…a2, Team Leader …c1, Super Admin …e1, and the three
-- legacy "Gender" rows); Org B = 'bbbbbbbb-…000b'.

-- ---- S20a: ADMIN creates a PERSONAL field — the CSV-import create, as Chris hit it. -----------------
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000ad', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Admin'),
    $q$INSERT INTO public.custom_fields
         (name, type, applies_to, organization_id, created_by, active, required, default_value, dropdown_options)
       VALUES ('S20a Admin Personal', 'Text', '["Leads"]'::jsonb,
               'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000ad',
               true, false, '', '[]'::jsonb)
       RETURNING to_jsonb(custom_fields.*)$q$);
  PERFORM cf_test.expect_written('S20a (Admin personal)', r.out_state, r.out_message, r.out_row,
    'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000ad');
END$$;

-- ---- S20b: SUPER ADMIN in the home org (role 'Admin' + is_super_admin) — personal AND agency-wide. ---
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Admin', true),
    $q$INSERT INTO public.custom_fields
         (name, type, applies_to, organization_id, created_by, active, required, default_value, dropdown_options)
       VALUES ('S20b Super Admin Personal', 'Text', '["Leads"]'::jsonb,
               'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000e1',
               true, false, '', '[]'::jsonb)
       RETURNING to_jsonb(custom_fields.*)$q$);
  PERFORM cf_test.expect_written('S20b (Super Admin personal)', r.out_state, r.out_message, r.out_row,
    'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000e1');

  -- Agency-wide: created_by NULL — Admin / Super Admin only (AGENT_RULES §5 ownership invariant).
  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Admin', true),
    $q$INSERT INTO public.custom_fields
         (name, type, applies_to, organization_id, created_by, active, required, default_value, dropdown_options)
       VALUES ('S20b Super Admin Agency', 'Text', '["Leads"]'::jsonb,
               'aaaaaaaa-0000-0000-0000-00000000000a', NULL, true, false, '', '[]'::jsonb)
       RETURNING to_jsonb(custom_fields.*)$q$);
  PERFORM cf_test.expect_written('S20b (Super Admin agency-wide)', r.out_state, r.out_message, r.out_row,
    'aaaaaaaa-0000-0000-0000-00000000000a', NULL);
END$$;

-- ---- S20c: AGENT creates a PERSONAL field. ---------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Agent'),
    $q$INSERT INTO public.custom_fields
         (name, type, applies_to, organization_id, created_by, active, required, default_value, dropdown_options)
       VALUES ('S20c Agent Personal', 'Text', '["Leads"]'::jsonb,
               'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a1',
               true, false, '', '[]'::jsonb)
       RETURNING to_jsonb(custom_fields.*)$q$);
  PERFORM cf_test.expect_written('S20c (Agent personal)', r.out_state, r.out_message, r.out_row,
    'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a1');
END$$;

-- ---- S20d: TEAM LEADER creates a PERSONAL field. ---------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Team Leader'),
    $q$INSERT INTO public.custom_fields
         (name, type, applies_to, organization_id, created_by, active, required, default_value, dropdown_options)
       VALUES ('S20d Team Leader Personal', 'Text', '["Leads"]'::jsonb,
               'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000c1',
               true, false, '', '[]'::jsonb)
       RETURNING to_jsonb(custom_fields.*)$q$);
  PERFORM cf_test.expect_written('S20d (Team Leader personal)', r.out_state, r.out_message, r.out_row,
    'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000c1');
END$$;

-- ---- S21: DUPLICATE HANDLING UNCHANGED. A Team Leader cannot SEE the legacy "Gender" rows (another
--           user's personal scope), yet the organization-wide guard still refuses the collision with the
--           exact 23505 message the client matches on — raised BEFORE index maintenance.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Team Leader'),
    -- Org A's rows only: the harness also seeds an organization-less SYSTEM "Gender" template, which
    -- custom_fields_select exposes to everyone and which the guard exempts.
    $q$SELECT to_jsonb(count(*)) FROM public.custom_fields
        WHERE lower(name) = 'gender' AND organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$q$);
  IF r.out_state <> '00000' OR r.out_row <> '0'::jsonb THEN
    RAISE EXCEPTION 'S21 FAILED: the Team Leader should see 0 of org A''s legacy Gender rows, got % (% "%")',
      r.out_row, r.out_state, r.out_message;
  END IF;

  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Team Leader'),
    $q$INSERT INTO public.custom_fields
         (name, type, applies_to, organization_id, created_by, active, required, default_value, dropdown_options)
       VALUES ('  gender ', 'Text', '["Leads"]'::jsonb,
               'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000c1',
               true, false, '', '[]'::jsonb)
       RETURNING to_jsonb(custom_fields.*)$q$);
  PERFORM cf_test.expect_refused('S21 (duplicate of a hidden logical name)', r.out_state, r.out_message,
    '23505', 'A custom field named "gender" already exists in this organization.');
END$$;

-- ---- S22: THE GRANT ADDS NO CALLABLE SURFACE. Without USAGE on `private`, a client still cannot call
--           the normalizer BY NAME — only an index resolving it by OID can.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Agent'),
    $q$SELECT to_jsonb(private.custom_field_norm('  Some   Name '))$q$);
  PERFORM cf_test.expect_refused('S22 (name-call of the normalizer)', r.out_state, r.out_message,
    '42501', 'permission denied for schema private');
END$$;

-- ---- S23: ORGANIZATION / SESSION MISMATCH STILL FAILS CLOSED IN THE DATABASE. An Agent whose JWT
--           resolves org A sends organization_id = org B: RLS refuses. This is the exact text the client
--           translator classifies as an RLS refusal (never as a platform defect).
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Agent'),
    $q$INSERT INTO public.custom_fields
         (name, type, applies_to, organization_id, created_by, active, required, default_value, dropdown_options)
       VALUES ('S23 Wrong Org', 'Text', '["Leads"]'::jsonb,
               'bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-0000000000a1',
               true, false, '', '[]'::jsonb)
       RETURNING to_jsonb(custom_fields.*)$q$);
  PERFORM cf_test.expect_refused('S23 (org/session mismatch)', r.out_state, r.out_message,
    '42501', 'new row violates row-level security policy for table "custom_fields"');
END$$;

-- ---- S24: OWNERSHIP INVARIANT. An Agent may not create an agency-wide field (created_by NULL). -------
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Agent'),
    $q$INSERT INTO public.custom_fields
         (name, type, applies_to, organization_id, created_by, active, required, default_value, dropdown_options)
       VALUES ('S24 Agent Agency Attempt', 'Text', '["Leads"]'::jsonb,
               'aaaaaaaa-0000-0000-0000-00000000000a', NULL, true, false, '', '[]'::jsonb)
       RETURNING to_jsonb(custom_fields.*)$q$);
  PERFORM cf_test.expect_refused('S24 (Agent agency-wide attempt)', r.out_state, r.out_message,
    '42501', 'new row violates row-level security policy for table "custom_fields"');
END$$;

-- ---- S25: THE UPDATE PATHS THROUGH THE EXPRESSION INDEX. The Agent renames their own S20c field, then
--           deactivates and RE-ACTIVATES it (re-entering the partial index). All three must succeed.
DO $$
DECLARE r record; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.custom_fields WHERE name = 'S20c Agent Personal';
  IF v_id IS NULL THEN RAISE EXCEPTION 'S25 SETUP FAILED: the S20c row is missing'; END IF;

  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Agent'),
    format($q$UPDATE public.custom_fields SET name = 'S25 Agent Renamed' WHERE id = %L
              RETURNING to_jsonb(custom_fields.*)$q$, v_id));
  PERFORM cf_test.expect_written('S25 (rename own active field)', r.out_state, r.out_message, r.out_row,
    'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a1');
  IF r.out_row->>'name' <> 'S25 Agent Renamed' THEN
    RAISE EXCEPTION 'S25 FAILED: rename did not persist (%)', r.out_row->>'name';
  END IF;

  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Agent'),
    format($q$UPDATE public.custom_fields SET active = false WHERE id = %L
              RETURNING to_jsonb(custom_fields.*)$q$, v_id));
  PERFORM cf_test.expect_written('S25 (deactivate own field)', r.out_state, r.out_message, r.out_row,
    'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a1');

  SELECT * INTO r FROM cf_test.run_as('authenticated',
    cf_test.claims('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Agent'),
    format($q$UPDATE public.custom_fields SET active = true WHERE id = %L
              RETURNING to_jsonb(custom_fields.*)$q$, v_id));
  PERFORM cf_test.expect_written('S25 (re-activate own field)', r.out_state, r.out_message, r.out_row,
    'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a1');
  IF (r.out_row->>'active')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'S25 FAILED: re-activation did not persist';
  END IF;
END$$;

-- ---- S26: service_role (BYPASSRLS, not superuser) can write an active field. -----------------------
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM cf_test.run_as('service_role', '{}'::jsonb,
    $q$INSERT INTO public.custom_fields
         (name, type, applies_to, organization_id, created_by, active, required, default_value, dropdown_options)
       VALUES ('S26 Service Role Agency', 'Text', '["Leads"]'::jsonb,
               'aaaaaaaa-0000-0000-0000-00000000000a', NULL, true, false, '', '[]'::jsonb)
       RETURNING to_jsonb(custom_fields.*)$q$);
  PERFORM cf_test.expect_written('S26 (service_role write)', r.out_state, r.out_message, r.out_row,
    'aaaaaaaa-0000-0000-0000-00000000000a', NULL);
END$$;

-- ---- S27: THE PRIVILEGE MATRIX AFTER THE GRANT — exactly one ACL entry changed, nothing else widened.
DO $$
DECLARE v_acl text; v_bad text;
BEGIN
  SELECT proacl::text INTO v_acl FROM pg_proc WHERE oid = 'private.custom_field_norm(text)'::regprocedure;
  IF v_acl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'S27 FAILED: unexpected normalizer ACL %', v_acl;
  END IF;
  IF NOT has_function_privilege('authenticated', 'private.custom_field_norm(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'private.custom_field_norm(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'S27 FAILED: a writing role cannot EXECUTE the normalizer';
  END IF;
  IF has_function_privilege('anon', 'private.custom_field_norm(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'S27 FAILED: anon can EXECUTE the normalizer';
  END IF;
  IF has_function_privilege('anon', 'private.custom_fields_logical_name_guard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.custom_fields_logical_name_guard()', 'EXECUTE')
     OR has_function_privilege('service_role', 'private.custom_fields_logical_name_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'S27 FAILED: the guard function became EXECUTE-able by a client role';
  END IF;
  IF has_schema_privilege('anon', 'private', 'USAGE')
     OR has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_schema_privilege('service_role', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'S27 FAILED: a client role holds USAGE on schema private';
  END IF;

  SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) INTO v_bad
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'custom_fields' AND grantee = 'authenticated';
  IF v_bad IS DISTINCT FROM 'DELETE,INSERT,SELECT,UPDATE' THEN
    RAISE EXCEPTION 'S27 FAILED: authenticated table privileges changed (%)', coalesce(v_bad, 'none');
  END IF;
  SELECT string_agg(privilege_type, ',') INTO v_bad
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'custom_fields' AND grantee = 'anon';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'S27 FAILED: anon holds % on custom_fields', v_bad;
  END IF;
END$$;

SELECT 'custom_field_authenticated_writes: ALL CLIENT-ROLE SCENARIOS PASSED' AS result;
