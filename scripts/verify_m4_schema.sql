-- =====================================================================================================
-- M4 SCHEMA CONTRACT VERIFIER — READ ONLY, MACHINE CHECKED, plain SQL (no psql meta-commands).
-- =====================================================================================================
-- Runs unchanged through `psql -f`, through the Supabase MCP `execute_sql`, or through the SQL editor.
-- It ASSERTS: any missing object or any contract mismatch raises and the statement FAILS. Success is a
-- single row `M4_SCHEMA_CONTRACT_VERIFIED`; there is no path that prints success without the assertions
-- having passed. History is verified separately (verify_m4_history.sql) because recovery may need to
-- reconcile the history alone, after the schema is already correct.
--
-- Covered: object existence · RLS enabled and not forced · EXACT effective table privileges for
-- authenticated / anon / service_role over SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
-- and MAINTAIN (PostgreSQL 17+) · every policy's COMPLETE definition (table, command, roles including
-- PUBLIC, permissiveness, and USING / WITH CHECK compared SEPARATELY against M4's reviewed text), and
-- that no seventh policy exists · function identity,
-- security attribute, volatility and EXECUTE permissions · that no pre-existing table's policy set moved.
DO $verify$
DECLARE
  fail text[] := '{}';
  v_has_maintain boolean := current_setting('server_version_num')::int >= 170000;
  r record; n int; b boolean; t text;
  -- table, role, privilege, expected
  privs constant text[][] := ARRAY[
    ARRAY['agent_inbound_settings','authenticated','SELECT','t'],
    ARRAY['agent_inbound_settings','authenticated','INSERT','t'],
    ARRAY['agent_inbound_settings','authenticated','UPDATE','t'],
    ARRAY['agent_inbound_settings','authenticated','DELETE','f'],
    ARRAY['agent_inbound_settings','authenticated','TRUNCATE','f'],
    ARRAY['agent_inbound_settings','authenticated','REFERENCES','f'],
    ARRAY['agent_inbound_settings','authenticated','TRIGGER','f'],
    ARRAY['agent_inbound_settings','authenticated','MAINTAIN','f'],
    ARRAY['agent_inbound_settings','anon','SELECT','f'],
    ARRAY['agent_inbound_settings','anon','INSERT','f'],
    ARRAY['agent_inbound_settings','anon','UPDATE','f'],
    ARRAY['agent_inbound_settings','anon','DELETE','f'],
    ARRAY['agent_inbound_settings','anon','TRUNCATE','f'],
    ARRAY['agent_inbound_settings','anon','REFERENCES','f'],
    ARRAY['agent_inbound_settings','anon','TRIGGER','f'],
    ARRAY['agent_inbound_settings','anon','MAINTAIN','f'],
    ARRAY['agent_inbound_settings','service_role','SELECT','t'],
    ARRAY['agent_inbound_settings','service_role','INSERT','t'],
    ARRAY['agent_inbound_settings','service_role','UPDATE','t'],
    ARRAY['agent_inbound_settings','service_role','DELETE','t'],
    ARRAY['agent_inbound_settings','service_role','TRUNCATE','t'],
    ARRAY['agent_phone_registrations','authenticated','SELECT','t'],
    ARRAY['agent_phone_registrations','authenticated','INSERT','f'],
    ARRAY['agent_phone_registrations','authenticated','UPDATE','f'],
    ARRAY['agent_phone_registrations','authenticated','DELETE','f'],
    ARRAY['agent_phone_registrations','authenticated','TRUNCATE','f'],
    ARRAY['agent_phone_registrations','authenticated','REFERENCES','f'],
    ARRAY['agent_phone_registrations','authenticated','TRIGGER','f'],
    ARRAY['agent_phone_registrations','authenticated','MAINTAIN','f'],
    ARRAY['agent_phone_registrations','anon','SELECT','f'],
    ARRAY['agent_phone_registrations','anon','INSERT','f'],
    ARRAY['agent_phone_registrations','anon','UPDATE','f'],
    ARRAY['agent_phone_registrations','anon','DELETE','f'],
    ARRAY['agent_phone_registrations','anon','TRUNCATE','f'],
    ARRAY['agent_phone_registrations','anon','REFERENCES','f'],
    ARRAY['agent_phone_registrations','anon','TRIGGER','f'],
    ARRAY['agent_phone_registrations','anon','MAINTAIN','f'],
    ARRAY['agent_phone_registrations','service_role','SELECT','t'],
    ARRAY['agent_phone_registrations','service_role','INSERT','t'],
    ARRAY['agent_phone_registrations','service_role','UPDATE','t'],
    ARRAY['agent_phone_registrations','service_role','DELETE','t'],
    ARRAY['agent_phone_registrations','service_role','TRUNCATE','t']
  ];
  e record;
  i int;
BEGIN
  -- ── 1. objects exist ──────────────────────────────────────────────────────────────────────────────
  FOREACH t IN ARRAY ARRAY['agent_inbound_settings','agent_phone_registrations'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN fail := array_append(fail, format('MISSING TABLE public.%s', t)); END IF;
  END LOOP;
  IF cardinality(fail) > 0 THEN
    RAISE EXCEPTION 'M4 SCHEMA CONTRACT FAILED (% problem(s)): %', cardinality(fail), array_to_string(fail, ' || ');
  END IF;
  FOREACH t IN ARRAY ARRAY['is_phone_connected','heartbeat_phone_registration'] LOOP
    SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = t;
    IF n <> 1 THEN fail := array_append(fail, format('EXPECTED EXACTLY ONE public.%s, found %s', t, n)); END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'private' AND p.proname = 'agent_inbound_settings_guard';
  IF n <> 1 THEN fail := array_append(fail, format('EXPECTED private.agent_inbound_settings_guard, found %s', n)); END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.agent_inbound_settings'::regclass AND tgname = 'trg_agent_inbound_settings_guard' AND NOT tgisinternal;
  IF n <> 1 THEN fail := array_append(fail, format('EXPECTED the settings guard trigger, found %s', n)); END IF;

  -- ── 2. RLS enabled, not forced, owner consistent with the pre-existing tables ──────────────────────
  FOR r IN SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
             FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relname IN ('agent_inbound_settings','agent_phone_registrations')
  LOOP
    IF NOT r.relrowsecurity THEN fail := array_append(fail, format('%s: RLS IS DISABLED', r.relname)); END IF;
    IF r.relforcerowsecurity THEN fail := array_append(fail, format('%s: FORCE RLS is set (unexpected)', r.relname)); END IF;
    IF r.owner IS DISTINCT FROM (SELECT pg_get_userbyid(c2.relowner) FROM pg_class c2 WHERE c2.oid = 'public.profiles'::regclass) THEN
      fail := array_append(fail, format('%s: owner %s differs from public.profiles owner', r.relname, r.owner));
    END IF;
  END LOOP;

  -- ── 3. EXACT effective table privileges (MAINTAIN only where the server has it) ────────────────────
  FOR i IN 1 .. array_length(privs, 1) LOOP
    CONTINUE WHEN privs[i][3] = 'MAINTAIN' AND NOT v_has_maintain;
    b := has_table_privilege(privs[i][2], 'public.' || privs[i][1], privs[i][3]);
    IF (CASE WHEN b THEN 't' ELSE 'f' END) <> privs[i][4] THEN
      fail := array_append(fail, format('%s: %s %s = %s, expected %s', privs[i][1], privs[i][2], privs[i][3],
                             CASE WHEN b THEN 'GRANTED' ELSE 'denied' END,
                             CASE WHEN privs[i][4] = 't' THEN 'GRANTED' ELSE 'denied' END));
    END IF;
  END LOOP;
  IF NOT v_has_maintain THEN
    RAISE NOTICE 'server_version_num % < 170000: MAINTAIN not checked (privilege does not exist here)',
      current_setting('server_version_num');
  END IF;

  -- ── 4. policies: the COMPLETE definition of each, field by field ──────────────────────────────────
  --   Not a substring search. An expression that merely CONTAINS get_org_id() can still be wide open:
  --   dropping `agent_id = auth.uid()` from the settings self-insert policy would leave the fragment
  --   intact while letting an agent create another agent's row. USING and WITH CHECK are compared
  --   SEPARATELY for the same reason — concatenating them lets one correct clause conceal a wrong one.
  --   Target table, command, roles (PUBLIC included) and permissiveness are compared too.
  --
  --   Both sides are canonicalised identically: whitespace collapsed, and the optional `public.`
  --   qualification that pg_get_expr adds or omits depending on search_path removed. NOTHING else is
  --   stripped, so a function in any OTHER schema, a changed literal or a changed operator still fails
  --   — a policy rewritten to call evil.get_org_id() deparses qualified and does not match. (The two
  --   normalisations also apply inside string literals; M4's only literal is 'Admin', which contains
  --   neither a run of whitespace nor the text `public.`, so nothing is masked here.)
  --   The expected strings are PostgreSQL's own deparse of M4's policies, confirmed against the target
  --   project's PostgreSQL 17.6, whose pre-existing inbound_routing_settings_update policy deparses to
  --   exactly the shape used by agent_inbound_settings_admin_select below.
  FOR e IN
    SELECT * FROM (VALUES
      ('agent_inbound_settings','agent_inbound_settings_self_select','SELECT','authenticated',true,
       '((agent_id = auth.uid()) AND (organization_id = get_org_id()))',
       '<NONE>'),
      ('agent_inbound_settings','agent_inbound_settings_self_insert','INSERT','authenticated',true,
       '<NONE>',
       '((agent_id = auth.uid()) AND (organization_id = get_org_id()))'),
      ('agent_inbound_settings','agent_inbound_settings_self_update','UPDATE','authenticated',true,
       '((agent_id = auth.uid()) AND (organization_id = get_org_id()))',
       '((agent_id = auth.uid()) AND (organization_id = get_org_id()))'),
      ('agent_inbound_settings','agent_inbound_settings_admin_select','SELECT','authenticated',true,
       '((organization_id = get_org_id()) AND ((get_user_role() = ''Admin''::text) OR is_super_admin()))',
       '<NONE>'),
      ('agent_phone_registrations','agent_phone_registrations_self_select','SELECT','authenticated',true,
       '((agent_id = auth.uid()) AND (organization_id = get_org_id()))',
       '<NONE>'),
      ('agent_phone_registrations','agent_phone_registrations_org_select','SELECT','authenticated',true,
       '(organization_id = get_org_id())',
       '<NONE>')
    ) AS v(tbl, polname, cmd, roles, permissive, using_c, check_c)
  LOOP
    SELECT CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                         WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' ELSE p.polcmd::text END AS cmd,
           p.polpermissive AS permissive,
           coalesce((SELECT string_agg(CASE WHEN pr.oid = 0 THEN 'PUBLIC' ELSE ro.rolname END, ',' ORDER BY 1)
                       FROM unnest(p.polroles) pr(oid) LEFT JOIN pg_roles ro ON ro.oid = pr.oid), '(none)') AS roles,
           btrim(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), '<NONE>'),
                                '\mpublic\.', '', 'g'), '\s+', ' ', 'g')) AS using_c,
           btrim(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '<NONE>'),
                                '\mpublic\.', '', 'g'), '\s+', ' ', 'g')) AS check_c
      INTO r
      FROM pg_policy p
     WHERE p.polrelid = ('public.' || e.tbl)::regclass AND p.polname = e.polname;
    IF NOT FOUND THEN
      fail := array_append(fail, format('MISSING POLICY %s on public.%s', e.polname, e.tbl));
    ELSE
      IF r.cmd <> e.cmd THEN
        fail := array_append(fail, format('%s: command %s, expected %s', e.polname, r.cmd, e.cmd)); END IF;
      IF r.roles IS DISTINCT FROM e.roles THEN
        fail := array_append(fail, format('%s: roles %s, expected %s', e.polname, r.roles, e.roles)); END IF;
      IF r.permissive IS DISTINCT FROM e.permissive THEN
        fail := array_append(fail, format('%s: permissive=%s, expected %s', e.polname, r.permissive, e.permissive)); END IF;
      IF r.using_c IS DISTINCT FROM e.using_c THEN
        fail := array_append(fail, format('%s: USING is%s%s, expected%s%s', e.polname,
                 chr(10) || '        ', r.using_c, chr(10) || '        ', e.using_c)); END IF;
      IF r.check_c IS DISTINCT FROM e.check_c THEN
        fail := array_append(fail, format('%s: WITH CHECK is%s%s, expected%s%s', e.polname,
                 chr(10) || '        ', r.check_c, chr(10) || '        ', e.check_c)); END IF;
    END IF;
  END LOOP;
  -- the policy SET must be exactly those six: an EXTRA policy widens access just as effectively
  FOR r IN
    SELECT c.relname AS tbl, p.polname
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE p.polrelid IN ('public.agent_inbound_settings'::regclass, 'public.agent_phone_registrations'::regclass)
       AND p.polname NOT IN ('agent_inbound_settings_self_select','agent_inbound_settings_self_insert',
                             'agent_inbound_settings_self_update','agent_inbound_settings_admin_select',
                             'agent_phone_registrations_self_select','agent_phone_registrations_org_select')
  LOOP
    fail := array_append(fail, format('UNEXPECTED POLICY %s on public.%s (M4 defines exactly six)', r.polname, r.tbl));
  END LOOP;
  SELECT count(*) INTO n FROM pg_policy WHERE polrelid = 'public.agent_inbound_settings'::regclass;
  IF n <> 4 THEN fail := array_append(fail, format('agent_inbound_settings: expected 4 policies, found %s', n)); END IF;
  SELECT count(*) INTO n FROM pg_policy WHERE polrelid = 'public.agent_phone_registrations'::regclass;
  IF n <> 2 THEN fail := array_append(fail, format('agent_phone_registrations: expected 2 policies, found %s', n)); END IF;
  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid = 'public.agent_phone_registrations'::regclass AND polcmd <> 'r';
  IF n <> 0 THEN fail := array_append(fail, format('agent_phone_registrations: %s WRITE policy/policies present (expected none)', n)); END IF;

  -- ── 5. function identity, security attribute, volatility and EXECUTE permissions ──────────────────
  SELECT p.prosecdef AS secdef, p.provolatile AS vol, p.proacl IS NULL AS acl_default
    INTO r FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'is_phone_connected';
  IF r.secdef THEN fail := array_append(fail, 'is_phone_connected: SECURITY DEFINER (must be INVOKER)'); END IF;
  IF r.vol <> 's' THEN fail := array_append(fail, format('is_phone_connected: volatility %s, expected STABLE', r.vol)); END IF;
  IF r.acl_default THEN fail := array_append(fail, 'is_phone_connected: proacl is NULL, so PUBLIC still holds EXECUTE'); END IF;
  IF NOT has_function_privilege('authenticated', 'public.is_phone_connected(uuid)', 'EXECUTE') THEN
    fail := array_append(fail, 'is_phone_connected: authenticated cannot EXECUTE'); END IF;
  IF NOT has_function_privilege('service_role', 'public.is_phone_connected(uuid)', 'EXECUTE') THEN
    fail := array_append(fail, 'is_phone_connected: service_role cannot EXECUTE'); END IF;
  IF has_function_privilege('anon', 'public.is_phone_connected(uuid)', 'EXECUTE') THEN
    fail := array_append(fail, 'is_phone_connected: anon CAN EXECUTE (must not)'); END IF;

  SELECT p.prosecdef AS secdef, p.proacl IS NULL AS acl_default
    INTO r FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'heartbeat_phone_registration';
  IF NOT r.secdef THEN fail := array_append(fail, 'heartbeat_phone_registration: must be SECURITY DEFINER'); END IF;
  IF r.acl_default THEN fail := array_append(fail, 'heartbeat_phone_registration: proacl is NULL, so PUBLIC still holds EXECUTE'); END IF;
  IF NOT has_function_privilege('authenticated', 'public.heartbeat_phone_registration(uuid,bigint,boolean,text,text)', 'EXECUTE') THEN
    fail := array_append(fail, 'heartbeat_phone_registration: authenticated cannot EXECUTE'); END IF;
  IF has_function_privilege('anon', 'public.heartbeat_phone_registration(uuid,bigint,boolean,text,text)', 'EXECUTE') THEN
    fail := array_append(fail, 'heartbeat_phone_registration: anon CAN EXECUTE (must not)'); END IF;
  IF has_function_privilege('authenticated', 'private.agent_inbound_settings_guard()', 'EXECUTE') THEN
    fail := array_append(fail, 'private.agent_inbound_settings_guard: authenticated CAN EXECUTE (must not)'); END IF;

  -- ── 6. M4 added nothing to any pre-existing table ─────────────────────────────────────────────────
  --     Environment-independent invariant: M4 must not create a policy on calls / profiles /
  --     inbound_routing_settings. The EXACT policy counts are compared before vs. after the apply by
  --     verify_m4_untouched.sql, which the procedure runs on both sides; hard-coding production's counts
  --     here would make this verifier unusable on any other database.
  SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname IN ('calls','profiles','inbound_routing_settings')
     AND (p.polname LIKE 'agent_inbound%' OR p.polname LIKE 'agent_phone%');
  IF n <> 0 THEN fail := array_append(fail, format('M4 added %s policy/policies to a pre-existing table', n)); END IF;

  IF cardinality(fail) > 0 THEN
    RAISE EXCEPTION 'M4 SCHEMA CONTRACT FAILED (% problem(s)): %', cardinality(fail), array_to_string(fail, ' || ');
  END IF;
END
$verify$;
SELECT 'M4_SCHEMA_CONTRACT_VERIFIED' AS verdict,
       current_setting('server_version') AS server_version,
       (current_setting('server_version_num')::int >= 170000) AS maintain_checked;
