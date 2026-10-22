-- Phase 2A policy commission tracking: roles, privileges, RLS and the permission matrix.
-- Runs on a disposable database after the harness and the migration. psql variable :defaults holds
-- supabase/tests/fixtures/policy_commission/permission_defaults.json.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

-- ── Writer role: restricted, owns no table, only postgres is a member ─────────────────────────────────────
SELECT test_assert((SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit
                      AND NOT rolreplication AND NOT rolbypassrls
                    FROM pg_roles WHERE rolname = 'agentflow_policy_commission_writer'), 'writer role attributes');
SELECT test_assert((SELECT array_agg(m.rolname::text ORDER BY m.rolname) FROM pg_auth_members a
                    JOIN pg_roles r ON r.oid = a.roleid JOIN pg_roles m ON m.oid = a.member
                    WHERE r.rolname = 'agentflow_policy_commission_writer') = ARRAY['postgres'], 'only postgres is a member');
SELECT test_assert(NOT EXISTS (SELECT 1 FROM pg_auth_members a JOIN pg_roles m ON m.oid = a.roleid
                    JOIN pg_roles r ON r.oid = a.member WHERE r.rolname = 'agentflow_policy_commission_writer'),
                   'writer is a member of no role');
SELECT test_assert(NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner = 'agentflow_policy_commission_writer'::regrole),
                   'writer owns no relation');
SELECT test_assert((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
                    WHERE p.proowner = 'agentflow_policy_commission_writer'::regrole) = ARRAY[
  'confirm_policy_commission_capture', 'dismiss_policy_commission_capture', 'policy_commission_capture_presented',
  'policy_commission_estimate_state', 'policy_commission_handoff', 'policy_commission_insert_estimate',
  'policy_commission_insert_receipt', 'policy_commission_lock_estimate', 'policy_commission_record_event',
  'policy_commission_replay', 'policy_commission_slot_states', 'record_policy_commission_estimate_later',
  'record_policy_commission_receipt', 'set_policy_commission_hold', 'set_policy_commission_installment_timing',
  'set_policy_commission_schedule_basis', 'void_policy_commission_receipt'], 'writer owns exactly the tracking functions');
SELECT test_assert(NOT has_schema_privilege('agentflow_policy_commission_writer', 'public', 'CREATE')
                   AND NOT has_schema_privilege('agentflow_policy_commission_writer', 'private', 'CREATE'),
                   'temporary CREATE was revoked');
SELECT test_assert(NOT has_schema_privilege('agentflow_policy_commission_writer', 'auth', 'USAGE'), 'writer has no auth usage');
-- No privilege on any pre-existing table or function.
SELECT test_assert(NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('r', 'v', 'm', 'S')
     AND c.relname NOT LIKE 'policy\_commission\_%'
     AND (has_table_privilege('agentflow_policy_commission_writer', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
          OR has_any_column_privilege('agentflow_policy_commission_writer', c.oid, 'SELECT,INSERT,UPDATE'))),
  'writer has no privilege on existing relations');

-- ── Tables: RLS on (not forced), client roles read-only through policies ────────────────────────────────
SELECT test_assert((SELECT count(*) = 6 AND bool_and(c.relrowsecurity AND NOT c.relforcerowsecurity)
                    AND bool_and(c.relowner = 'postgres'::regrole)
                    FROM pg_class c WHERE c.oid IN ('public.policy_commission_handoffs'::regclass,
                      'public.policy_commission_captures'::regclass, 'public.policy_commission_estimates'::regclass,
                      'public.policy_commission_installments'::regclass, 'public.policy_commission_receipts'::regclass,
                      'public.policy_commission_events'::regclass)), 'six postgres-owned RLS tables');
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['policy_commission_handoffs', 'policy_commission_captures', 'policy_commission_estimates',
                           'policy_commission_installments', 'policy_commission_receipts', 'policy_commission_events'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'service_role', 'public'] LOOP
      IF has_table_privilege(CASE r WHEN 'public' THEN 'authenticated' ELSE r END, 'public.' || t, 'INSERT,UPDATE,DELETE,TRUNCATE')
         OR (r <> 'public' AND has_table_privilege(r, 'public.' || t, 'SELECT')) THEN
        RAISE EXCEPTION 'FAIL: % has privileges on %', r, t;
      END IF;
    END LOOP;
    IF NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN RAISE EXCEPTION 'FAIL: authenticated read %', t; END IF;
    IF has_table_privilege('agentflow_policy_commission_writer', 'public.' || t, 'DELETE,TRUNCATE')
       OR has_table_privilege('agentflow_policy_commission_writer', 'public.' || t, 'UPDATE') THEN
      RAISE EXCEPTION 'FAIL: writer has table-wide UPDATE/DELETE on %', t;
    END IF;
  END LOOP;
END $$;
SELECT test_assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename LIKE 'policy\_commission\_%'
                     AND (roles @> ARRAY['public']::name[] OR roles @> ARRAY['anon']::name[] OR roles @> ARRAY['service_role']::name[])),
                   'no policy for PUBLIC, anon or service_role');
SELECT test_assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename LIKE 'policy\_commission\_%'
                     AND roles @> ARRAY['authenticated']::name[] AND cmd <> 'SELECT'), 'authenticated policies are read-only');
SELECT test_assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename LIKE 'policy\_commission\_%'
                     AND (qual LIKE '%peer%' OR qual LIKE '%auth.uid%' OR with_check LIKE '%auth.uid%')),
                   'no Agency Group peer access; policies never call auth.uid()');
SELECT test_assert(NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid::regclass::text LIKE 'policy\_commission\_%'
                     AND condeferrable), 'commission constraints are not deferrable');
SELECT test_assert(NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid::regclass::text LIKE 'policy\_commission\_%'
                     AND tgdeferrable), 'commission triggers are not deferrable');
SELECT test_assert((SELECT count(*) FROM pg_constraint WHERE confrelid = 'public.wins'::regclass
                     AND conrelid::regclass::text LIKE 'policy\_commission\_%' AND confdeltype IN ('a', 'r')) = 2,
                   'estimates and captures restrict win deletion');

-- ── Functions: every new function revokes PUBLIC/anon/service_role; EXECUTE matches the plan ─────────────
CREATE TEMP TABLE expected_exec(fn regprocedure, grantees text[]);
INSERT INTO expected_exec VALUES
  ('public.record_client_policy_handoff(uuid,uuid,jsonb,boolean,jsonb)', '{authenticated}'),
  ('public.create_client_with_sale_handoff(uuid,uuid,jsonb,boolean,jsonb)', '{authenticated}'),
  ('public.convert_lead_to_client_with_sales_handoff(uuid,uuid,uuid,jsonb,uuid,jsonb)', '{authenticated}'),
  ('public.update_client_with_policy_sale_handoff(uuid,uuid,jsonb,jsonb)', '{authenticated}'),
  ('public.confirm_policy_commission_capture(uuid,uuid)', '{authenticated}'),
  ('public.dismiss_policy_commission_capture(uuid,uuid,text)', '{authenticated}'),
  ('public.record_policy_commission_estimate_later(uuid,uuid,jsonb,uuid,bigint,text)', '{authenticated}'),
  ('public.set_policy_commission_schedule_basis(uuid,uuid,bigint,date,text)', '{authenticated}'),
  ('public.set_policy_commission_installment_timing(uuid,uuid,bigint,text,date)', '{authenticated}'),
  ('public.set_policy_commission_hold(uuid,uuid,bigint,boolean,text)', '{authenticated}'),
  ('public.record_policy_commission_receipt(uuid,uuid,bigint,date,text)', '{authenticated}'),
  ('public.void_policy_commission_receipt(uuid,uuid,bigint,text,jsonb)', '{authenticated}'),
  ('public.get_client_policy_commissions(uuid)', '{authenticated}'),
  ('public.get_policy_sale_operation_status(text,uuid,uuid,jsonb)', '{authenticated}'),
  ('policy_commission_authz.actor_uid()', '{agentflow_policy_commission_writer}'),
  ('policy_commission_authz.actor_org()', '{agentflow_policy_commission_writer,authenticated}'),
  ('policy_commission_authz.access(uuid)', '{agentflow_policy_commission_writer,authenticated}'),
  ('private.policy_commission_handoff(text,text,text,uuid,text,uuid,uuid[],jsonb)', '{postgres}'),
  ('private.policy_commission_operation_facts(text,text,uuid,text,uuid[])', '{agentflow_policy_commission_writer}'),
  ('private.policy_commission_policy_facts(uuid[])', '{agentflow_policy_commission_writer}'),
  ('private.policy_commission_grid_facts(uuid,jsonb)', '{agentflow_policy_commission_writer}'),
  ('private.policy_commission_toggle(uuid,text,boolean,text)', '{}'),
  ('private.policy_sale_commission_step(text,text,uuid,text,jsonb,boolean,jsonb)', '{}');
DO $$
DECLARE e record; v_acl text[];
BEGIN
  FOR e IN SELECT * FROM expected_exec LOOP
    SELECT coalesce(array_agg(DISTINCT g.rolname::text ORDER BY g.rolname::text), '{}') INTO v_acl
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a JOIN pg_roles g ON g.oid = a.grantee
     WHERE p.oid = e.fn AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner;
    IF v_acl IS DISTINCT FROM e.grantees THEN RAISE EXCEPTION 'FAIL: % EXECUTE % expected %', e.fn, v_acl, e.grantees; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE (n.nspname = 'policy_commission_authz' OR p.proname LIKE '%policy\_commission%' OR p.proname LIKE '%\_handoff'
                     OR p.proname = 'policy_sale_commission_step' OR p.proname = 'get_policy_sale_operation_status')
                AND (p.proacl IS NULL OR has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR has_function_privilege('service_role', p.oid, 'EXECUTE')
                     OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))) THEN
    RAISE EXCEPTION 'FAIL: a new function is executable by PUBLIC, anon or service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE (n.nspname = 'policy_commission_authz' OR p.proname LIKE '%policy\_commission%' OR p.proname LIKE '%\_handoff'
                     OR p.proname = 'policy_sale_commission_step')
                AND p.prosecdef AND NOT (p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'])) THEN
    RAISE EXCEPTION 'FAIL: a definer function lacks the pinned search_path';
  END IF;
END $$;
SELECT test_assert((SELECT bool_and(proowner = 'postgres'::regrole AND prosecdef) FROM pg_proc WHERE oid IN (
  'public.record_client_policy_handoff(uuid,uuid,jsonb,boolean,jsonb)'::regprocedure,
  'public.create_client_with_sale_handoff(uuid,uuid,jsonb,boolean,jsonb)'::regprocedure,
  'public.convert_lead_to_client_with_sales_handoff(uuid,uuid,uuid,jsonb,uuid,jsonb)'::regprocedure,
  'public.update_client_with_policy_sale_handoff(uuid,uuid,jsonb,jsonb)'::regprocedure,
  'private.policy_sale_commission_step(text,text,uuid,text,jsonb,boolean,jsonb)'::regprocedure)), 'companions are postgres definers');
SELECT test_assert((SELECT NOT prosecdef FROM pg_proc WHERE oid = 'public.get_client_policy_commissions(uuid)'::regprocedure),
                   'contact read is SECURITY INVOKER');

-- ── Client roles cannot touch the tables or private helpers directly ────────────────────────────────────
SELECT pc_login(13);
SET ROLE authenticated;
SELECT pc_reject($q$INSERT INTO policy_commission_handoffs(organization_id, actor_id, sale_kind, sale_operation_key, request_id,
  sale_payload_hash, commission_digest, client_id) VALUES (test_id(1), test_id(13), 'record', 'policy:x', test_id(1),
  repeat('a', 64), repeat('a', 64), test_id(1))$q$, '42501');
SELECT pc_reject($q$UPDATE policy_commission_estimates SET status = 'on_hold'$q$, '42501');
SELECT pc_reject($q$DELETE FROM policy_commission_receipts$q$, '42501');
SELECT pc_reject($q$SELECT private.policy_commission_handoff('replay', 'record', 'x', test_id(1), 'x', NULL, '{}', NULL)$q$, '42501');
SELECT pc_reject($q$SELECT private.policy_commission_grid_facts(test_id(11), '[]')$q$, '42501');
SELECT pc_reject($q$SELECT private.policy_commission_operation_facts('record', 'x', test_id(1), 'x', '{}')$q$, '42501');
SELECT pc_reject($q$SELECT private.policy_sale_commission_step('record', 'x', test_id(1), 'x', '{}', true, NULL)$q$, '42501');
SELECT pc_reject($q$SELECT policy_commission_authz.actor_uid()$q$, '42501');
SELECT pc_reject($q$SELECT * FROM private.policy_sale_receipts$q$, '42501');
RESET ROLE;
SET ROLE anon;
SELECT pc_reject($q$SELECT * FROM policy_commission_estimates$q$, '42501');
SELECT pc_reject($q$SELECT get_client_policy_commissions(test_id(1))$q$, '42501');
SELECT pc_reject($q$SELECT record_client_policy_handoff(test_id(1), test_id(1), '{}', false, NULL)$q$, '42501');
RESET ROLE;
SET ROLE service_role;
SELECT pc_reject($q$SELECT * FROM policy_commission_estimates$q$, '42501');
SELECT pc_reject($q$SELECT record_policy_commission_receipt(test_id(1), test_id(1), 100, current_date, NULL)$q$, '42501');
RESET ROLE;

-- Even postgres cannot write, delete or truncate outside the commission functions.
SELECT pc_reject($q$INSERT INTO policy_commission_handoffs(organization_id, actor_id, sale_kind, sale_operation_key, request_id,
  sale_payload_hash, commission_digest, client_id) VALUES (test_id(1), test_id(13), 'record', 'policy:x', test_id(1),
  repeat('a', 64), repeat('a', 64), test_id(1))$q$, '42501');
SELECT pc_reject($q$DELETE FROM policy_commission_events$q$, '23514');
SELECT pc_reject($q$TRUNCATE policy_commission_events$q$, '23514');

-- The writer role is itself subject to RLS: it cannot record evidence for another actor or agency.
SELECT pc_login(11);
SET ROLE agentflow_policy_commission_writer;
SELECT pc_reject($q$INSERT INTO policy_commission_handoffs(organization_id, actor_id, sale_kind, sale_operation_key, request_id,
  sale_payload_hash, commission_digest, client_id) VALUES (test_id(1), test_id(12), 'record', 'policy:x', test_id(1),
  repeat('a', 64), repeat('a', 64), test_id(1))$q$, '42501');
SELECT pc_reject($q$INSERT INTO policy_commission_handoffs(organization_id, actor_id, sale_kind, sale_operation_key, request_id,
  sale_payload_hash, commission_digest, client_id) VALUES (test_id(2), test_id(11), 'record', 'policy:x', test_id(1),
  repeat('a', 64), repeat('a', 64), test_id(1))$q$, '42501');
SELECT pc_reject($q$SELECT * FROM public.clients$q$, '42501');
SELECT pc_reject($q$SELECT auth.uid()$q$, '42501');
RESET ROLE;

-- ── Permission matrix (mirrors usePermissions) ────────────────────────────────────────────────────────────
CREATE TEMP TABLE pc_matrix(viewer integer, seller integer, expected text);
CREATE FUNCTION pg_temp.pc_access(p_viewer integer, p_seller integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM pc_login(p_viewer);
  SET LOCAL ROLE authenticated;
  v := policy_commission_authz.access(test_id(p_seller));
  RESET ROLE;
  RETURN v;
END $$;
-- Defaults (no role_permissions rows): Own on for agents and team leaders; Others off.
SELECT set_config('pc.defaults', :'defaults', false);
DO $$
DECLARE d jsonb := current_setting('pc.defaults')::jsonb; r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('Agent', 'agent'), ('Team Leader', 'teamLeader')) v(role, key) LOOP
    IF private.policy_commission_toggle(test_id(1), r.role, false, 'View Own Commission Percentage')
         IS DISTINCT FROM (d->'View Own Commission Percentage'->>r.key)::boolean
       OR private.policy_commission_toggle(test_id(1), r.role, false, 'View Others'' Commission Percentage')
         IS DISTINCT FROM (d->'View Others'' Commission Percentage'->>r.key)::boolean THEN
      RAISE EXCEPTION 'FAIL: SQL defaults differ from the pinned defaults for %', r.role;
    END IF;
  END LOOP;
END $$;
SELECT test_assert(pg_temp.pc_access(11, 11) = 'write', 'seller with default Own toggle writes');
SELECT test_assert(pg_temp.pc_access(11, 12) IS NULL, 'agent cannot see another agent');
SELECT test_assert(pg_temp.pc_access(13, 11) = 'write', 'admin writes for same-agency seller');
SELECT test_assert(pg_temp.pc_access(15, 12) = 'write', 'is_super_admin writes');
SELECT test_assert(pg_temp.pc_access(14, 11) IS NULL, 'team leader needs the Others toggle');
SELECT test_assert(pg_temp.pc_access(14, 14) = 'write', 'team leader own commission');
SELECT test_assert(pg_temp.pc_access(16, 16) IS NULL, 'inactive profile has no access');
SELECT test_assert(pg_temp.pc_access(21, 11) IS NULL, 'other agency admin has no access');
SELECT test_assert(pg_temp.pc_access(31, 11) IS NULL, 'agency group peer admin has no access');
SELECT test_assert(pg_temp.pc_access(13, 21) IS NULL, 'admin cannot reach another agency seller');
SELECT test_assert(pg_temp.pc_access(13, 999) IS NULL, 'unknown seller');

INSERT INTO role_permissions(organization_id, role, permissions) VALUES
  (test_id(1), 'Team Leader', '{"c":[{"name":"View Own Commission Percentage","agent":true,"teamLeader":true},
                                     {"name":"View Others'' Commission Percentage","agent":false,"teamLeader":true}]}'),
  (test_id(1), 'Agent', '{"c":[{"name":"View Own Commission Percentage","agent":false,"teamLeader":true}]}');
SELECT test_assert(pg_temp.pc_access(14, 11) = 'read', 'team leader reads downline with Others on');
SELECT test_assert(pg_temp.pc_access(14, 12) IS NULL, 'team leader cannot read outside the downline');
SELECT test_assert(pg_temp.pc_access(14, 13) IS NULL, 'team leader cannot read the admin');
SELECT test_assert(pg_temp.pc_access(11, 11) IS NULL, 'Own toggle off hides the seller''s own commission');
SELECT test_assert(pg_temp.pc_access(13, 11) = 'write', 'admin ignores toggles');
-- First matching item decides; only JSON true grants; a missing item or a JSON null element denies.
UPDATE role_permissions SET permissions = '{"c":[{"name":"View Own Commission Percentage","agent":true},
                                                  {"name":"View Own Commission Percentage","agent":false}]}' WHERE role = 'Agent';
SELECT test_assert(pg_temp.pc_access(11, 11) = 'write', 'first matching item decides');
UPDATE role_permissions SET permissions = '{"c":[{"name":"View Own Commission Percentage","agent":"true"}]}' WHERE role = 'Agent';
SELECT test_assert(pg_temp.pc_access(11, 11) IS NULL, 'string "true" does not grant');
UPDATE role_permissions SET permissions = '{"c":[]}' WHERE role = 'Agent';
SELECT test_assert(pg_temp.pc_access(11, 11) IS NULL, 'missing item denies');
UPDATE role_permissions SET permissions = '{"c":[null,{"name":"View Own Commission Percentage","agent":true}]}' WHERE role = 'Agent';
SELECT test_assert(pg_temp.pc_access(11, 11) IS NULL, 'JSON null element fails closed');
UPDATE role_permissions SET permissions = '{"c":{"not":"an array"}}' WHERE role = 'Agent';
SELECT test_assert(pg_temp.pc_access(11, 11) = 'write', 'non-array c falls back to defaults');
UPDATE role_permissions SET permissions = '[]' WHERE role = 'Agent';
SELECT test_assert(pg_temp.pc_access(11, 11) = 'write', 'non-object permissions fall back to defaults');
DELETE FROM role_permissions;

SELECT 'PASS policy commission security' AS result;
