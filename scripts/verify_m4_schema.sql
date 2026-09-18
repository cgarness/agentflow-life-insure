-- =====================================================================================================
-- M4 SCHEMA CONTRACT VERIFIER — READ ONLY, MACHINE CHECKED, plain SQL (no psql meta-commands).
-- =====================================================================================================
-- Runs unchanged through `psql -f`, through the Supabase MCP `execute_sql`, or through the SQL editor.
-- It ASSERTS: any missing object or any contract mismatch raises and the statement FAILS. Success is a
-- single row `M4_SCHEMA_CONTRACT_VERIFIED`; there is no path that prints success without the assertions
-- having passed. History is verified separately (verify_m4_history.sql) because recovery may need to
-- reconcile the history alone, after the schema is already correct.
--
-- Covered: object existence with EXACTLY ONE function per name · RLS enabled and not forced · EXACT
-- effective table privileges for authenticated / anon / service_role over SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN (PostgreSQL 17+) · every policy's COMPLETE
-- definition (table, command, roles including PUBLIC, permissiveness, and USING / WITH CHECK compared
-- SEPARATELY against M4's reviewed text) and that no seventh policy exists · each function's exact
-- signature, security attribute, volatility, `SET search_path` pin, BODY DIGEST and EXECUTE permissions ·
-- the guard trigger's enabled flag, timing/event mask and the function it fires · and that no policy was
-- added to a pre-existing table.
DO $verify$
DECLARE
  fail text[] := '{}';
  v_has_maintain boolean := current_setting('server_version_num')::int >= 170000;
  r record; e record; n int; b boolean; t text;
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
  i int;
BEGIN
  -- ── 0. PIN THE SEARCH PATH ────────────────────────────────────────────────────────────────────────
  --   `pg_get_expr` and `pg_get_functiondef` qualify a name only when the bare name does NOT resolve to
  --   that object under the SESSION's search_path. Whether `public.` appears is therefore a property of
  --   the caller, not of the policy. An earlier revision normalised that away by deleting every
  --   `public.` prefix, which collapsed "the function in public" and "whatever the session resolves the
  --   bare name to" into one string: with `SET search_path = evil, public`, a policy rewritten to call
  --   `evil.get_org_id()` deparsed as `get_org_id()` and VERIFIED CLEAN. Pinning the path to pg_catalog
  --   makes every non-pg_catalog name fully qualified, so the expected strings below are exact and the
  --   caller's environment cannot change the answer. `true` = transaction-local, so this reverts on its
  --   own under psql, under execute_sql and in the SQL editor alike.
  PERFORM set_config('search_path', 'pg_catalog', true);

  -- ── 1. objects exist, EXACTLY ONE function per name ───────────────────────────────────────────────
  --   Counting `proname IN (a, b)` would accept two overloads of one name and none of the other, because
  --   pg_proc rows are per-overload. Each name is therefore required in its own right.
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
  IF n <> 1 THEN fail := array_append(fail, format('EXPECTED EXACTLY ONE private.agent_inbound_settings_guard, found %s', n)); END IF;

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
  --   The expected strings are PostgreSQL's own deparse of M4's policies under the pinned pg_catalog
  --   search_path, so every non-pg_catalog name is fully qualified. The only normalisation applied to
  --   either side is collapsing runs of whitespace. Confirmed against the target project's PostgreSQL
  --   17.6, whose pre-existing inbound_routing_settings_update policy deparses to exactly the shape used
  --   by agent_inbound_settings_admin_select below.
  FOR e IN
    SELECT * FROM (VALUES
      ('agent_inbound_settings','agent_inbound_settings_self_select','SELECT','authenticated',true,
       '((agent_id = auth.uid()) AND (organization_id = public.get_org_id()))',
       '<NONE>'),
      ('agent_inbound_settings','agent_inbound_settings_self_insert','INSERT','authenticated',true,
       '<NONE>',
       '((agent_id = auth.uid()) AND (organization_id = public.get_org_id()))'),
      ('agent_inbound_settings','agent_inbound_settings_self_update','UPDATE','authenticated',true,
       '((agent_id = auth.uid()) AND (organization_id = public.get_org_id()))',
       '((agent_id = auth.uid()) AND (organization_id = public.get_org_id()))'),
      ('agent_inbound_settings','agent_inbound_settings_admin_select','SELECT','authenticated',true,
       '((organization_id = public.get_org_id()) AND ((public.get_user_role() = ''Admin''::text) OR public.is_super_admin()))',
       '<NONE>'),
      ('agent_phone_registrations','agent_phone_registrations_self_select','SELECT','authenticated',true,
       '((agent_id = auth.uid()) AND (organization_id = public.get_org_id()))',
       '<NONE>'),
      ('agent_phone_registrations','agent_phone_registrations_org_select','SELECT','authenticated',true,
       '(organization_id = public.get_org_id())',
       '<NONE>')
    ) AS v(tbl, polname, cmd, roles, permissive, using_c, check_c)
  LOOP
    SELECT CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                         WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' ELSE p.polcmd::text END AS cmd,
           p.polpermissive AS permissive,
           coalesce((SELECT string_agg(CASE WHEN pr.oid = 0 THEN 'PUBLIC' ELSE ro.rolname END, ',' ORDER BY 1)
                       FROM unnest(p.polroles) pr(oid) LEFT JOIN pg_roles ro ON ro.oid = pr.oid), '(none)') AS roles,
           btrim(regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), '<NONE>'), '\s+', ' ', 'g')) AS using_c,
           btrim(regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '<NONE>'), '\s+', ' ', 'g')) AS check_c
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

  -- ── 5. functions: signature, security, volatility, search_path pin and BODY DIGEST ────────────────
  --   Existence and a security flag are not identity. A guard whose body is replaced by `RETURN NEW`
  --   keeps its name, signature, SECURITY DEFINER flag and revoked EXECUTE while silently dropping the
  --   loop check M4 exists to enforce; a definer function with its `SET search_path` pin removed resolves
  --   through the caller's path. `prosrc` is stored verbatim, so its md5 pins the reviewed body exactly.
  --   These digests are of M4 at sha256 fe846c43…32fe8e29 — they change only if that file changes.
  FOR e IN
    SELECT * FROM (VALUES
      ('public.is_phone_connected(uuid)',                                           false, 's',
       'search_path=pg_catalog, pg_temp', 'bd1b618036c9b59569eeb86f053526ec'),
      ('public.heartbeat_phone_registration(uuid,bigint,boolean,text,text)',        true,  'v',
       'search_path=pg_catalog, pg_temp', '893f3226121f6909e0f19b1887520760'),
      ('private.agent_inbound_settings_guard()',                                    true,  'v',
       'search_path=pg_catalog, pg_temp', 'd918d4c93b50c5375b4ae99ad8fab277')
    ) AS v(sig, secdef, vol, cfg, body_md5)
  LOOP
    IF to_regprocedure(e.sig) IS NULL THEN
      fail := array_append(fail, format('MISSING FUNCTION %s (exact signature)', e.sig));
      CONTINUE;
    END IF;
    SELECT p.prosecdef, p.provolatile, p.proacl IS NULL AS acl_default,
           coalesce(array_to_string(p.proconfig, ', '), '<none>') AS cfg,
           md5(p.prosrc) AS body_md5
      INTO r FROM pg_proc p WHERE p.oid = to_regprocedure(e.sig);
    IF r.prosecdef IS DISTINCT FROM e.secdef THEN
      fail := array_append(fail, format('%s: SECURITY %s, expected %s', e.sig,
               CASE WHEN r.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END,
               CASE WHEN e.secdef    THEN 'DEFINER' ELSE 'INVOKER' END)); END IF;
    IF r.provolatile IS DISTINCT FROM e.vol THEN
      fail := array_append(fail, format('%s: volatility %s, expected %s', e.sig, r.provolatile, e.vol)); END IF;
    IF r.cfg IS DISTINCT FROM e.cfg THEN
      fail := array_append(fail, format('%s: search_path pin is %s, expected %s', e.sig, r.cfg, e.cfg)); END IF;
    IF r.body_md5 IS DISTINCT FROM e.body_md5 THEN
      fail := array_append(fail, format('%s: BODY DIGEST %s, expected %s (the function was replaced)',
               e.sig, r.body_md5, e.body_md5)); END IF;
    IF r.acl_default THEN
      fail := array_append(fail, format('%s: proacl is NULL, so PUBLIC still holds EXECUTE', e.sig)); END IF;
  END LOOP;
  -- EXECUTE permissions, only where the function exists (has_function_privilege raises otherwise)
  IF to_regprocedure('public.is_phone_connected(uuid)') IS NOT NULL THEN
    IF NOT has_function_privilege('authenticated', 'public.is_phone_connected(uuid)', 'EXECUTE') THEN
      fail := array_append(fail, 'is_phone_connected: authenticated cannot EXECUTE'); END IF;
    IF NOT has_function_privilege('service_role', 'public.is_phone_connected(uuid)', 'EXECUTE') THEN
      fail := array_append(fail, 'is_phone_connected: service_role cannot EXECUTE'); END IF;
    IF has_function_privilege('anon', 'public.is_phone_connected(uuid)', 'EXECUTE') THEN
      fail := array_append(fail, 'is_phone_connected: anon CAN EXECUTE (must not)'); END IF;
  END IF;
  IF to_regprocedure('public.heartbeat_phone_registration(uuid,bigint,boolean,text,text)') IS NOT NULL THEN
    IF NOT has_function_privilege('authenticated', 'public.heartbeat_phone_registration(uuid,bigint,boolean,text,text)', 'EXECUTE') THEN
      fail := array_append(fail, 'heartbeat_phone_registration: authenticated cannot EXECUTE'); END IF;
    IF has_function_privilege('anon', 'public.heartbeat_phone_registration(uuid,bigint,boolean,text,text)', 'EXECUTE') THEN
      fail := array_append(fail, 'heartbeat_phone_registration: anon CAN EXECUTE (must not)'); END IF;
  END IF;
  IF to_regprocedure('private.agent_inbound_settings_guard()') IS NOT NULL THEN
    IF has_function_privilege('authenticated', 'private.agent_inbound_settings_guard()', 'EXECUTE') THEN
      fail := array_append(fail, 'private.agent_inbound_settings_guard: authenticated CAN EXECUTE (must not)'); END IF;
  END IF;

  -- ── 6. the guard TRIGGER: enabled, timing/event mask, and the function it fires ────────────────────
  --   A name is not a contract. `ALTER TABLE … DISABLE TRIGGER` leaves the pg_trigger row in place, and
  --   re-creating it as BEFORE INSERT only drops the UPDATE half — either releases the loop guard while
  --   a name-only check still reports it present. tgtype 23 = ROW(1) | BEFORE(2) | INSERT(4) | UPDATE(16).
  SELECT t2.tgenabled, t2.tgtype, t2.tgfoid::regprocedure::text AS fn
    INTO r FROM pg_trigger t2
   WHERE t2.tgrelid = 'public.agent_inbound_settings'::regclass
     AND t2.tgname = 'trg_agent_inbound_settings_guard' AND NOT t2.tgisinternal;
  IF NOT FOUND THEN
    fail := array_append(fail, 'MISSING TRIGGER trg_agent_inbound_settings_guard on public.agent_inbound_settings');
  ELSE
    IF r.tgenabled <> 'O' THEN
      fail := array_append(fail, format('trg_agent_inbound_settings_guard: tgenabled=%s, expected O (enabled)', r.tgenabled)); END IF;
    IF r.tgtype <> 23 THEN
      fail := array_append(fail, format('trg_agent_inbound_settings_guard: tgtype=%s, expected 23 (BEFORE INSERT OR UPDATE FOR EACH ROW)', r.tgtype)); END IF;
    IF r.fn <> 'private.agent_inbound_settings_guard()' THEN
      fail := array_append(fail, format('trg_agent_inbound_settings_guard: fires %s, expected private.agent_inbound_settings_guard()', r.fn)); END IF;
  END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.agent_inbound_settings'::regclass AND NOT tgisinternal;
  IF n <> 1 THEN fail := array_append(fail, format('agent_inbound_settings carries %s user triggers, expected exactly 1', n)); END IF;

  -- ── 7. M4 added nothing to any pre-existing table ─────────────────────────────────────────────────
  --     Environment-independent invariant: M4 must not create a policy on calls / profiles /
  --     inbound_routing_settings. The EXACT policy definitions are compared before vs. after the apply
  --     by verify_m4_untouched.sql, which the procedure runs on both sides; hard-coding production's
  --     counts here would make this verifier unusable on any other database.
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
