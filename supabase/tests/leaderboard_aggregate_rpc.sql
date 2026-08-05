-- =====================================================================================================
-- Organization leaderboard aggregate RPC — SQL integration tests (Leaderboard accuracy bugfix)
-- =====================================================================================================
-- STATUS: PENDING-EXECUTION. Run ONLY against a LOCAL Supabase stack or an APPROVED Supabase dev
-- BRANCH — never production. Requires migration 20260805090000_get_org_leaderboard_stats_rpc applied
-- (T0 aborts loudly if it is not) plus prod-typed profiles/organizations/calls/appointments/wins/
-- clients and the live RLS policies on those tables. Runs in ONE transaction and ROLLBACKs —
-- persists nothing even if misdirected.
--
--   psql "$DEV_BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/leaderboard_aggregate_rpc.sql
--
-- Pure SQL (no psql \set client constructs), so the same file is MCP-executable on a dev branch.
-- Auth is simulated via request.jwt.claims (auth.uid()) + seeded profiles; RLS and RPC calls run
-- under `SET LOCAL ROLE authenticated`. Assertions RAISE EXCEPTION on failure. Fixture windows are
-- fixed July-2026 timestamps (safely in the past); the recent_wins_7d fixtures are now()-relative
-- so they never intersect the fixed windows.
--
-- Fixture users follow the p0_profile_authorization.sql pattern: `profiles.id` carries
-- `profiles_id_fkey → auth.users(id)`, so auth.users is seeded FIRST. The live
-- `on_auth_user_created → handle_new_user()` trigger then auto-creates each profiles row from
-- `raw_user_meta_data` — with the `'{}'` metadata used here that means a NULL organization_id —
-- so every fixture profile is subsequently forced to its intended org/role/status/name via
-- explicit UPDATEs (session-role writes; auth.uid() IS NULL ⇒ the profile field-authorization
-- guard's system path). A belt-and-braces direct insert covers databases without the trigger,
-- and a preflight aborts if any fixture id/email is already occupied by foreign data.
--
-- Fixture ids (synthetic, obviously fake):
--   ORG_A aaaa0000-0000-0000-0000-00000000000a   ORG_B bbbb0000-0000-0000-0000-00000000000b
--   ADMIN aaaa0000-0000-0000-0000-0000000000ad   (org A Admin)
--   AG1   aaaa0000-0000-0000-0000-0000000000a1   (org A Agent, heavy activity)
--   AG2   aaaa0000-0000-0000-0000-0000000000a2   (org A Agent)
--   AG0   aaaa0000-0000-0000-0000-0000000000a0   (org A Agent, zero activity)
--   DELP  aaaa0000-0000-0000-0000-0000000000de   (org A profile, status Deleted)
--   AGB   bbbb0000-0000-0000-0000-0000000000b1   (org B Agent)
--   CL1   aaaa0000-2222-0000-0000-000000000001   (org A client, premium 80)
--   CLB   bbbb0000-2222-0000-0000-000000000001   (org B client, premium 500 — cross-org guard)
--   Window W1 = [2026-07-01T00:00Z, 2026-07-02T00:00Z)   W2 = [2026-07-02T00:00Z, 2026-07-03T00:00Z)
-- =====================================================================================================

BEGIN;

-- -----------------------------------------------------------------------------------------------------
-- T0. Guard: the migration must be applied (this is the fail-first proof when run pre-apply).
-- -----------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.get_org_leaderboard_stats(timestamptz,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: public.get_org_leaderboard_stats(timestamptz,timestamptz) is not applied';
  END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- T0a. Fixture-collision preflight: every fixed id/email below must be unoccupied, else abort —
--      colliding with foreign rows would corrupt assertions (and DO NOTHING would mask it).
-- -----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM auth.users
  WHERE id IN ('aaaa0000-0000-0000-0000-0000000000ad', 'aaaa0000-0000-0000-0000-0000000000a1',
               'aaaa0000-0000-0000-0000-0000000000a2', 'aaaa0000-0000-0000-0000-0000000000a0',
               'aaaa0000-0000-0000-0000-0000000000de', 'bbbb0000-0000-0000-0000-0000000000b1')
     OR email LIKE 'lb.%@lbtest.invalid';
  IF n <> 0 THEN RAISE EXCEPTION 'T0a FAIL: % fixture auth.users id/email(s) already occupied', n; END IF;

  SELECT count(*) INTO n FROM public.profiles
  WHERE id IN ('aaaa0000-0000-0000-0000-0000000000ad', 'aaaa0000-0000-0000-0000-0000000000a1',
               'aaaa0000-0000-0000-0000-0000000000a2', 'aaaa0000-0000-0000-0000-0000000000a0',
               'aaaa0000-0000-0000-0000-0000000000de', 'bbbb0000-0000-0000-0000-0000000000b1');
  IF n <> 0 THEN RAISE EXCEPTION 'T0a FAIL: % fixture profile id(s) already occupied', n; END IF;

  SELECT count(*) INTO n FROM public.organizations
  WHERE id IN ('aaaa0000-0000-0000-0000-00000000000a', 'bbbb0000-0000-0000-0000-00000000000b');
  IF n <> 0 THEN RAISE EXCEPTION 'T0a FAIL: % fixture organization id(s) already occupied', n; END IF;

  SELECT (SELECT count(*) FROM public.clients      WHERE id::text LIKE 'aaaa0000-2222-%' OR id::text LIKE 'bbbb0000-2222-%')
       + (SELECT count(*) FROM public.calls        WHERE id::text LIKE 'aaaa0000-3333-%' OR id::text LIKE 'bbbb0000-3333-%')
       + (SELECT count(*) FROM public.appointments WHERE id::text LIKE 'aaaa0000-4444-%')
       + (SELECT count(*) FROM public.wins         WHERE id::text LIKE 'aaaa0000-5555-%')
    INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'T0a FAIL: % fixture data-table id(s) already occupied', n; END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- Fixtures (seeded as the connection role, claims unset — the service seeding path)
-- -----------------------------------------------------------------------------------------------------
INSERT INTO public.organizations (id, name) VALUES
  ('aaaa0000-0000-0000-0000-00000000000a', 'LB Test Org A'),
  ('bbbb0000-0000-0000-0000-00000000000b', 'LB Test Org B');

-- auth.users first: profiles_id_fkey requires it, and the AFTER INSERT trigger
-- on_auth_user_created -> handle_new_user() creates each matching public.profiles row
-- exactly as a real signup does ('{}' user metadata ⇒ NULL organization_id at this point).
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('aaaa0000-0000-0000-0000-0000000000ad', 'lb.admin.a@lbtest.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaa0000-0000-0000-0000-0000000000a1', 'lb.agent1.a@lbtest.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaa0000-0000-0000-0000-0000000000a2', 'lb.agent2.a@lbtest.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaa0000-0000-0000-0000-0000000000a0', 'lb.zero.a@lbtest.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaa0000-0000-0000-0000-0000000000de', 'lb.deleted.a@lbtest.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('bbbb0000-0000-0000-0000-0000000000b1', 'lb.agent.b@lbtest.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

-- Belt and braces for databases without on_auth_user_created: create the rows directly. The
-- NOT EXISTS predicate skips only the rows handle_new_user just made (T0a proved the ids free).
INSERT INTO public.profiles (id, email, first_name, last_name, role, status)
SELECT u.id, u.email, 'LB', 'Fixture', 'Agent', 'Active'
FROM auth.users u
WHERE u.email LIKE 'lb.%@lbtest.invalid'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- Force every auto-created profile to its intended org/role/status/name: the trigger-created rows
-- carry NULL organization_id, which would otherwise silently break org-scoped assertions.
UPDATE public.profiles SET organization_id = 'aaaa0000-0000-0000-0000-00000000000a', role = 'Admin', status = 'Active',  first_name = 'Ada',  last_name = 'Admin',   is_super_admin = false WHERE id = 'aaaa0000-0000-0000-0000-0000000000ad';
UPDATE public.profiles SET organization_id = 'aaaa0000-0000-0000-0000-00000000000a', role = 'Agent', status = 'Active',  first_name = 'Aria', last_name = 'Alpha',   is_super_admin = false WHERE id = 'aaaa0000-0000-0000-0000-0000000000a1';
UPDATE public.profiles SET organization_id = 'aaaa0000-0000-0000-0000-00000000000a', role = 'Agent', status = 'Active',  first_name = 'Beau', last_name = 'Bravo',   is_super_admin = false WHERE id = 'aaaa0000-0000-0000-0000-0000000000a2';
UPDATE public.profiles SET organization_id = 'aaaa0000-0000-0000-0000-00000000000a', role = 'Agent', status = 'Active',  first_name = 'Zed',  last_name = 'Zero',    is_super_admin = false WHERE id = 'aaaa0000-0000-0000-0000-0000000000a0';
UPDATE public.profiles SET organization_id = 'aaaa0000-0000-0000-0000-00000000000a', role = 'Agent', status = 'Deleted', first_name = 'Del',  last_name = 'Deleted', is_super_admin = false WHERE id = 'aaaa0000-0000-0000-0000-0000000000de';
UPDATE public.profiles SET organization_id = 'bbbb0000-0000-0000-0000-00000000000b', role = 'Agent', status = 'Active',  first_name = 'Bee',  last_name = 'Borg',    is_super_admin = false WHERE id = 'bbbb0000-0000-0000-0000-0000000000b1';

-- Guard: no fixture profile may retain NULL/incorrect organization data past this point.
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.profiles
  WHERE email LIKE 'lb.%@lbtest.invalid'
    AND (organization_id IS NULL
         OR organization_id NOT IN ('aaaa0000-0000-0000-0000-00000000000a', 'bbbb0000-0000-0000-0000-00000000000b'));
  IF n <> 0 THEN RAISE EXCEPTION 'FIXTURE FAIL: % profile(s) kept NULL/foreign organization_id after seeding', n; END IF;
  SELECT count(*) INTO n FROM public.profiles WHERE email LIKE 'lb.%@lbtest.invalid';
  IF n <> 6 THEN RAISE EXCEPTION 'FIXTURE FAIL: expected 6 fixture profiles, found %', n; END IF;
END $$;

INSERT INTO public.clients (id, organization_id, assigned_agent_id, first_name, last_name, premium) VALUES
  ('aaaa0000-2222-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', 'Cli', 'One', 80),
  ('bbbb0000-2222-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-00000000000b', 'bbbb0000-0000-0000-0000-0000000000b1', 'Cli', 'OrgB', 500);

-- T7 control: a client created inside W1 with NO win must not move policies_sold.
INSERT INTO public.clients (id, organization_id, assigned_agent_id, first_name, last_name, premium, created_at) VALUES
  ('aaaa0000-2222-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a2', 'Cli', 'NoWin', 42, '2026-07-01T15:00:00Z');

-- Calls (org A unless noted). AG1 W1 expectation: calls_made 5, talk 100+50+25+0+5 = 180.
INSERT INTO public.calls (id, organization_id, agent_id, direction, status, duration, created_at) VALUES
  ('aaaa0000-3333-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', 'outbound', 'completed', 100,  '2026-07-01T10:00:00Z'),
  ('aaaa0000-3333-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', 'OUTBOUND', 'completed', 50,   '2026-07-01T11:00:00Z'), -- cased
  ('aaaa0000-3333-0000-0000-000000000003', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', 'outgoing', 'completed', 25,   '2026-07-01T12:00:00Z'), -- legacy outbound
  ('aaaa0000-3333-0000-0000-000000000004', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', 'inbound',  'completed', 500,  '2026-07-01T13:00:00Z'), -- excluded
  ('aaaa0000-3333-0000-0000-000000000005', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', 'outbound', 'no-answer', NULL, '2026-07-01T14:00:00Z'), -- counts, talk +0
  ('aaaa0000-3333-0000-0000-000000000006', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', 'outbound', 'completed', 5,    '2026-07-01T00:00:00Z'), -- exactly W1 start: IN W1
  ('aaaa0000-3333-0000-0000-000000000007', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', 'outbound', 'completed', 77,   '2026-07-02T00:00:00Z'), -- exactly W1 end: IN W2 only
  ('aaaa0000-3333-0000-0000-000000000008', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a2', 'outbound', 'completed', 60,   '2026-07-01T09:00:00Z'),
  ('aaaa0000-3333-0000-0000-000000000009', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000de', 'outbound', 'completed', 40,   '2026-07-01T09:30:00Z'), -- Deleted profile: no roster row
  ('bbbb0000-3333-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-00000000000b', 'bbbb0000-0000-0000-0000-0000000000b1', 'outbound', 'completed', 999,  '2026-07-01T10:00:00Z')  -- org B;

-- Appointments (org A). Window rows: ap1..ap3, ap5. Expectation: AG1 = 2 (ap1, ap3), AG2 = 2 (ap2, ap5).
INSERT INTO public.appointments (id, organization_id, title, type, status, start_time, created_by, user_id, created_at) VALUES
  ('aaaa0000-4444-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-00000000000a', 'ap1 both-set',    'Sales Call', 'Scheduled', '2026-07-05T17:00:00Z', 'aaaa0000-0000-0000-0000-0000000000a1', 'aaaa0000-0000-0000-0000-0000000000a2', '2026-07-01T10:00:00Z'), -- created_by wins; never double-counted
  ('aaaa0000-4444-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-00000000000a', 'ap2 legacy',      'Sales Call', 'Scheduled', '2026-07-05T18:00:00Z', NULL,                                   'aaaa0000-0000-0000-0000-0000000000a2', '2026-07-01T10:30:00Z'), -- user_id fallback
  ('aaaa0000-4444-0000-0000-000000000003', 'aaaa0000-0000-0000-0000-00000000000a', 'ap3 cancelled',   'Sales Call', 'Cancelled', '2026-07-05T19:00:00Z', 'aaaa0000-0000-0000-0000-0000000000a1', NULL,                                   '2026-07-01T11:00:00Z'), -- credit survives cancellation
  ('aaaa0000-4444-0000-0000-000000000004', 'aaaa0000-0000-0000-0000-00000000000a', 'ap4 pre-window',  'Sales Call', 'Scheduled', '2026-07-05T20:00:00Z', 'aaaa0000-0000-0000-0000-0000000000a1', NULL,                                   '2026-06-30T23:59:59Z'), -- outside W1
  ('aaaa0000-4444-0000-0000-000000000005', 'aaaa0000-0000-0000-0000-00000000000a', 'ap5 reschedule',  'Sales Call', 'Scheduled', '2026-07-06T17:00:00Z', 'aaaa0000-0000-0000-0000-0000000000a2', NULL,                                   '2026-07-01T12:00:00Z');

-- The reschedule: booking time (created_at) is untouched, so credit must survive.
UPDATE public.appointments
SET start_time = '2026-08-20T17:00:00Z'
WHERE id = 'aaaa0000-4444-0000-0000-000000000005';

-- Wins (org A) in W1. AG1: 4 policies, premium 12*(100) + 12*(80) + 12*(80) + 0 = 3120
-- (w2 premium NULL → client fallback; w3 premium 0 → client fallback; w5 → cross-org client NEVER read).
-- AG2: 1 policy, 12*55.5 = 666.
INSERT INTO public.wins (id, organization_id, agent_id, contact_id, premium_amount, created_at) VALUES
  ('aaaa0000-5555-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', 'aaaa0000-2222-0000-0000-000000000001', 100,  '2026-07-01T10:00:00Z'),
  ('aaaa0000-5555-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', 'aaaa0000-2222-0000-0000-000000000001', NULL, '2026-07-01T11:00:00Z'),
  ('aaaa0000-5555-0000-0000-000000000003', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', 'aaaa0000-2222-0000-0000-000000000001', 0,    '2026-07-01T12:00:00Z'),
  ('aaaa0000-5555-0000-0000-000000000004', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a2', NULL,                                   55.5, '2026-07-01T09:00:00Z'),
  ('aaaa0000-5555-0000-0000-000000000005', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', 'bbbb0000-2222-0000-0000-000000000001', NULL, '2026-07-01T13:00:00Z');

-- recent_wins_7d fixtures (now()-relative; outside the fixed July windows). AG1: 1, AG2: 1.
INSERT INTO public.wins (id, organization_id, agent_id, contact_id, premium_amount, created_at) VALUES
  ('aaaa0000-5555-0000-0000-000000000006', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', NULL, 10, now() - interval '1 day'),
  ('aaaa0000-5555-0000-0000-000000000007', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a1', NULL, 10, now() - interval '8 days'), -- outside 7d
  ('aaaa0000-5555-0000-0000-000000000008', 'aaaa0000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-0000000000a2', NULL, 10, now() - interval '2 days');

-- -----------------------------------------------------------------------------------------------------
-- Harness helpers
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp._sim(p_uid uuid, p_org uuid, p_role text, p_super boolean DEFAULT false)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_super_admin', p_super,
      'app_metadata', json_build_object('organization_id', p_org, 'role', p_role))::text, true);
$$;

CREATE OR REPLACE FUNCTION pg_temp._sys()
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', NULL, true);
$$;

-- Call the RPC as a simulated authenticated user; rows as jsonb ordered by agent_id.
CREATE OR REPLACE FUNCTION pg_temp._board(p_uid uuid, p_org uuid, p_role text, p_start timestamptz, p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v jsonb;
BEGIN
  PERFORM pg_temp._sim(p_uid, p_org, p_role);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.agent_id), '[]'::jsonb) INTO v
  FROM public.get_org_leaderboard_stats(p_start, p_end) t;
  EXECUTE 'RESET ROLE';
  RETURN v;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp._metric(p_board jsonb, p_agent uuid, p_key text)
RETURNS numeric LANGUAGE sql AS $$
  SELECT (e ->> p_key)::numeric FROM jsonb_array_elements(p_board) e
  WHERE (e ->> 'agent_id')::uuid = p_agent;
$$;

-- Expect p_sql to fail with an error containing p_frag (runs as a simulated authenticated caller).
CREATE OR REPLACE FUNCTION pg_temp._expect_rpc_error(p_uid uuid, p_org uuid, p_sql text, p_frag text, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    IF p_uid IS NULL THEN
      PERFORM pg_temp._sys();
    ELSE
      PERFORM pg_temp._sim(p_uid, p_org, 'Agent');
    END IF;
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE p_sql;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    IF position(p_frag IN SQLERRM) > 0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION '% FAIL: got unexpected error [%] (wanted fragment [%])', p_label, SQLERRM, p_frag;
  END;
  RAISE EXCEPTION '% FAIL: expected error containing [%] but the call succeeded', p_label, p_frag;
END;
$fn$;

-- -----------------------------------------------------------------------------------------------------
-- T1. Agent and Admin in the same org receive IDENTICAL standings for the same fixed range.
-- -----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  agent_board jsonb;
  admin_board jsonb;
BEGIN
  agent_board := pg_temp._board('aaaa0000-0000-0000-0000-0000000000a1', 'aaaa0000-0000-0000-0000-00000000000a', 'Agent',
                                '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  admin_board := pg_temp._board('aaaa0000-0000-0000-0000-0000000000ad', 'aaaa0000-0000-0000-0000-00000000000a', 'Admin',
                                '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  IF agent_board IS DISTINCT FROM admin_board THEN
    RAISE EXCEPTION 'T1 FAIL: Agent and Admin standings differ. agent=% admin=%', agent_board, admin_board;
  END IF;
  IF jsonb_array_length(agent_board) <> 4 THEN
    RAISE EXCEPTION 'T1 FAIL: expected 4 roster rows (ADMIN, AG1, AG2, AG0), got %', agent_board;
  END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- T2. Raw-table RLS is unchanged: an Agent still cannot SELECT another agent's rows.
-- -----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  n bigint;
BEGIN
  PERFORM pg_temp._sim('aaaa0000-0000-0000-0000-0000000000a1', 'aaaa0000-0000-0000-0000-00000000000a', 'Agent');
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO n FROM public.calls WHERE agent_id = 'aaaa0000-0000-0000-0000-0000000000a2';
  IF n <> 0 THEN RAISE EXCEPTION 'T2 FAIL: Agent can read peer calls (%)', n; END IF;

  SELECT count(*) INTO n FROM public.appointments
  WHERE created_by = 'aaaa0000-0000-0000-0000-0000000000a2'
     OR (created_by IS NULL AND user_id = 'aaaa0000-0000-0000-0000-0000000000a2');
  IF n <> 0 THEN RAISE EXCEPTION 'T2 FAIL: Agent can read peer appointments (%)', n; END IF;

  SELECT count(*) INTO n FROM public.clients WHERE assigned_agent_id = 'aaaa0000-0000-0000-0000-0000000000a2';
  IF n <> 0 THEN RAISE EXCEPTION 'T2 FAIL: Agent can read peer clients (%)', n; END IF;

  -- Positive control: the same session DOES see its own calls (the sim itself works).
  SELECT count(*) INTO n FROM public.calls WHERE agent_id = 'aaaa0000-0000-0000-0000-0000000000a1';
  IF n = 0 THEN RAISE EXCEPTION 'T2 FAIL: control broken — Agent cannot read own calls'; END IF;

  RESET ROLE;

  -- Positive control: the Admin session sees the peer rows the Agent could not.
  PERFORM pg_temp._sim('aaaa0000-0000-0000-0000-0000000000ad', 'aaaa0000-0000-0000-0000-00000000000a', 'Admin');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.calls WHERE agent_id = 'aaaa0000-0000-0000-0000-0000000000a2';
  IF n = 0 THEN RAISE EXCEPTION 'T2 FAIL: control broken — Admin cannot read org calls'; END IF;
  RESET ROLE;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- T3. Org isolation: no parameter requests another org; a forged JWT org claim is ignored because the
--     org comes from the DATABASE profiles row; org B data never appears for an org A caller.
-- -----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  board jsonb;
BEGIN
  -- Forged claim: AG1 (org A profile) presents an org-B claim. The profiles row must win.
  board := pg_temp._board('aaaa0000-0000-0000-0000-0000000000a1', 'bbbb0000-0000-0000-0000-00000000000b', 'Agent',
                          '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  IF pg_temp._metric(board, 'bbbb0000-0000-0000-0000-0000000000b1', 'calls_made') IS NOT NULL THEN
    RAISE EXCEPTION 'T3 FAIL: org B agent leaked into an org A board: %', board;
  END IF;
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a2', 'calls_made') IS NULL THEN
    RAISE EXCEPTION 'T3 FAIL: forged org claim changed the roster (expected org A standings): %', board;
  END IF;

  -- Org B caller sees only org B.
  board := pg_temp._board('bbbb0000-0000-0000-0000-0000000000b1', 'bbbb0000-0000-0000-0000-00000000000b', 'Agent',
                          '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  IF jsonb_array_length(board) <> 1
     OR pg_temp._metric(board, 'bbbb0000-0000-0000-0000-0000000000b1', 'calls_made') <> 1 THEN
    RAISE EXCEPTION 'T3 FAIL: org B board wrong: %', board;
  END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- T4+T5. Outbound/outgoing (any case) count; inbound never counts; talk time = SUM(calls.duration)
--        over those same outbound rows; NULL duration counts the call but adds 0 talk.
-- -----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  board jsonb;
BEGIN
  board := pg_temp._board('aaaa0000-0000-0000-0000-0000000000a1', 'aaaa0000-0000-0000-0000-00000000000a', 'Agent',
                          '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a1', 'calls_made') <> 5 THEN
    RAISE EXCEPTION 'T4 FAIL: AG1 calls_made expected 5 (outbound+OUTBOUND+outgoing+null-dur+start-boundary), got %',
      pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a1', 'calls_made');
  END IF;
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a1', 'talk_time_seconds') <> 180 THEN
    RAISE EXCEPTION 'T5 FAIL: AG1 talk_time expected 180 (100+50+25+0+5; inbound 500 excluded), got %',
      pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a1', 'talk_time_seconds');
  END IF;
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a2', 'calls_made') <> 1
     OR pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a2', 'talk_time_seconds') <> 60 THEN
    RAISE EXCEPTION 'T4/T5 FAIL: AG2 expected 1 call / 60s talk: %', board;
  END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- T6. Appointments: booking-time (created_at) counting; created_by primary with user_id fallback only
--     when created_by IS NULL; exactly one attribution per row; credit survives cancellation and
--     reschedule; pre-window rows excluded.
-- -----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  board jsonb;
  total numeric;
BEGIN
  board := pg_temp._board('aaaa0000-0000-0000-0000-0000000000ad', 'aaaa0000-0000-0000-0000-00000000000a', 'Admin',
                          '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a1', 'appointments_set') <> 2 THEN
    RAISE EXCEPTION 'T6 FAIL: AG1 appointments expected 2 (ap1 both-set → created_by; ap3 cancelled), got %',
      pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a1', 'appointments_set');
  END IF;
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a2', 'appointments_set') <> 2 THEN
    RAISE EXCEPTION 'T6 FAIL: AG2 appointments expected 2 (ap2 legacy user_id; ap5 rescheduled), got %',
      pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a2', 'appointments_set');
  END IF;
  -- No double count: attributions across the whole roster equal the window's row count (4).
  SELECT SUM((e ->> 'appointments_set')::numeric) INTO total FROM jsonb_array_elements(board) e;
  IF total <> 4 THEN
    RAISE EXCEPTION 'T6 FAIL: total attributed appointments expected 4, got % (double-count or drop)', total;
  END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- T7+T8. Wins (not clients) drive policies_sold; premium annualizes exactly once with the canonical
--        clients.premium fallback only when the win lacks premium; cross-org client rows are never read.
-- -----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  board jsonb;
BEGIN
  board := pg_temp._board('aaaa0000-0000-0000-0000-0000000000a1', 'aaaa0000-0000-0000-0000-00000000000a', 'Agent',
                          '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a1', 'policies_sold') <> 4 THEN
    RAISE EXCEPTION 'T7 FAIL: AG1 policies expected 4 wins, got %',
      pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a1', 'policies_sold');
  END IF;
  -- A client created in-window with no win adds nothing: AG2 stays at its single win.
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a2', 'policies_sold') <> 1 THEN
    RAISE EXCEPTION 'T7 FAIL: AG2 policies expected 1 (client rows must not count), got %',
      pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a2', 'policies_sold');
  END IF;
  -- 12*100 + 12*80 (NULL→fallback) + 12*80 (0→fallback) + 0 (cross-org client NEVER read) = 3120.
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a1', 'annualized_premium') <> 3120 THEN
    RAISE EXCEPTION 'T8 FAIL: AG1 annualized premium expected 3120, got %',
      pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a1', 'annualized_premium');
  END IF;
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a2', 'annualized_premium') <> 666 THEN
    RAISE EXCEPTION 'T8 FAIL: AG2 annualized premium expected 666 (12 × 55.5), got %',
      pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a2', 'annualized_premium');
  END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- T9. Half-open boundaries: a row stamped exactly at the window end belongs to exactly one (the next)
--     window; a row at the window start is included.
-- -----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  w1 jsonb;
  w2 jsonb;
BEGIN
  w1 := pg_temp._board('aaaa0000-0000-0000-0000-0000000000ad', 'aaaa0000-0000-0000-0000-00000000000a', 'Admin',
                       '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  w2 := pg_temp._board('aaaa0000-0000-0000-0000-0000000000ad', 'aaaa0000-0000-0000-0000-00000000000a', 'Admin',
                       '2026-07-02T00:00:00Z', '2026-07-03T00:00:00Z');
  -- W1 already asserted = 5 calls incl. the start-boundary row and excl. the end-boundary row (T4).
  IF pg_temp._metric(w2, 'aaaa0000-0000-0000-0000-0000000000a1', 'calls_made') <> 1
     OR pg_temp._metric(w2, 'aaaa0000-0000-0000-0000-0000000000a1', 'talk_time_seconds') <> 77 THEN
    RAISE EXCEPTION 'T9 FAIL: end-boundary call must appear exactly once, in W2 (expected 1 call / 77s): %',
      w2;
  END IF;
  IF (pg_temp._metric(w1, 'aaaa0000-0000-0000-0000-0000000000a1', 'calls_made')
      + pg_temp._metric(w2, 'aaaa0000-0000-0000-0000-0000000000a1', 'calls_made')) <> 6 THEN
    RAISE EXCEPTION 'T9 FAIL: adjacent windows must partition the rows exactly once';
  END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- T10. Guards: unauthenticated, NULL/reversed bounds, oversized window, and the anon grant lockdown.
-- -----------------------------------------------------------------------------------------------------
SELECT pg_temp._expect_rpc_error(NULL, NULL,
  'SELECT count(*) FROM public.get_org_leaderboard_stats(''2026-07-01T00:00:00Z'', ''2026-07-02T00:00:00Z'')',
  'not authenticated', 'T10a');

SELECT pg_temp._expect_rpc_error('aaaa0000-0000-0000-0000-0000000000a1', 'aaaa0000-0000-0000-0000-00000000000a',
  'SELECT count(*) FROM public.get_org_leaderboard_stats(NULL, ''2026-07-02T00:00:00Z'')',
  'invalid date bounds', 'T10b');

SELECT pg_temp._expect_rpc_error('aaaa0000-0000-0000-0000-0000000000a1', 'aaaa0000-0000-0000-0000-00000000000a',
  'SELECT count(*) FROM public.get_org_leaderboard_stats(''2026-07-02T00:00:00Z'', ''2026-07-01T00:00:00Z'')',
  'invalid date bounds', 'T10c');

SELECT pg_temp._expect_rpc_error('aaaa0000-0000-0000-0000-0000000000a1', 'aaaa0000-0000-0000-0000-00000000000a',
  'SELECT count(*) FROM public.get_org_leaderboard_stats(''2026-06-01T00:00:00Z'', ''2026-07-07T00:00:00Z'')',
  'unreasonable date window', 'T10d');

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_org_leaderboard_stats(timestamptz,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T10e FAIL: anon can execute the leaderboard RPC';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_org_leaderboard_stats(timestamptz,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T10f FAIL: authenticated cannot execute the leaderboard RPC';
  END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- T11. Roster: Deleted profiles are excluded (their activity vanishes with them); zero-activity Active
--      agents still return an all-zero row; recent_wins_7d is the rolling now()-7d count.
-- -----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  board jsonb;
BEGIN
  board := pg_temp._board('aaaa0000-0000-0000-0000-0000000000a1', 'aaaa0000-0000-0000-0000-00000000000a', 'Agent',
                          '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000de', 'calls_made') IS NOT NULL THEN
    RAISE EXCEPTION 'T11 FAIL: Deleted profile appears on the board: %', board;
  END IF;
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a0', 'calls_made') <> 0
     OR pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a0', 'policies_sold') <> 0
     OR pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a0', 'annualized_premium') <> 0 THEN
    RAISE EXCEPTION 'T11 FAIL: zero-activity agent must be an all-zero row: %', board;
  END IF;
  IF pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a1', 'recent_wins_7d') <> 1
     OR pg_temp._metric(board, 'aaaa0000-0000-0000-0000-0000000000a2', 'recent_wins_7d') <> 1 THEN
    RAISE EXCEPTION 'T11 FAIL: recent_wins_7d expected AG1=1 (8-day-old win excluded) and AG2=1: %', board;
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'leaderboard_aggregate_rpc.sql: ALL TESTS PASSED (T0–T11)'; END $$;

ROLLBACK;
