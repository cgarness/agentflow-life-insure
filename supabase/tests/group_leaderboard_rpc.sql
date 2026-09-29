-- =====================================================================================================
-- Group leaderboard repair — behaviour, access, shape and metadata suite.
-- STATUS: disposable LOCAL PostgreSQL only, via scripts/run_group_leaderboard_tests.sh (AGENT_RULES #28).
-- Runs AFTER supabase/migrations/20260929170000_group_leaderboard_repair_membership_setter_credit.sql, under
-- production's plpgsql.variable_conflict = error with NO workaround. Negative controls (runner step 2): on the
-- pre-repair function this suite fails with 42702; on a copy with only the 42702 fix it fails at T1.
--
-- Canon (AGENT_RULES #23 / #38): Appointments Set credits COALESCE(created_by, user_id) on appointments.created_at,
-- with no status filter. Membership, access, roster, other metrics, security and shape are asserted unchanged.
-- =====================================================================================================
\set ON_ERROR_STOP 1
SET plpgsql.variable_conflict = error;

-- One transaction for the data and the main read, so now() — and therefore the period start — is one instant.
BEGIN;
\ir group_leaderboard_seed.sql

-- The read, as an authenticated Org One member (A), exactly as PostgREST sets the claims.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000001"}}', true) \gset
CREATE TEMP TABLE board AS
  SELECT row_number() OVER () AS pos, b.* FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month') b;
RESET ROLE;

DO $t$
DECLARE r record;
BEGIN
  -- T0: the RPC executes under variable_conflict = error (the pre-repair function raised 42702 here).
  PERFORM gt.eq('T0 executes under variable_conflict=error', current_setting('plpgsql.variable_conflict'), 'error');

  -- Roster: active Agent/TL/Admin profiles of ACTIVE member organizations of THIS group only.
  PERFORM gt.eq('roster', (SELECT string_agg(agent_first_name, ',' ORDER BY pos) FROM board), 'Avery,Blake,Casey');

  SELECT * INTO r FROM board WHERE agent_id = 'a0000000-0000-4000-8000-00000000000a';
  -- T1 delegated, T3 self once, T4 outcomes kept, T5 booking window: b1, b3, b4, b5, b6, b7, b9
  -- (not b8: booked before the period; not b10: set by I, who is off the roster).
  PERFORM gt.eq('T1/T3/T4/T5 setter A appointments_set', r.appointments_set, 7::bigint);
  PERFORM gt.eq('A calls_made (unchanged)', r.calls_made, 2::bigint);
  PERFORM gt.eq('A talk_time_seconds (unchanged)', r.talk_time_seconds, 90::bigint);
  PERFORM gt.eq('A policies_sold (unchanged)', r.policies_sold, 1::bigint);
  PERFORM gt.eq('A organization (unchanged)', r.organization_name, 'Org One');

  SELECT * INTO r FROM board WHERE agent_id = 'a0000000-0000-4000-8000-00000000000b';
  -- T1: B is NOT credited for A's delegated b1 or b5; T2: B IS credited for the legacy b2.
  PERFORM gt.eq('T1/T2 assignee B appointments_set', r.appointments_set, 1::bigint);
  PERFORM gt.eq('B calls_made (unchanged)', r.calls_made, 1::bigint);
  PERFORM gt.eq('B talk_time_seconds (unchanged)', r.talk_time_seconds, 10::bigint);
  PERFORM gt.eq('B policies_sold (unchanged)', r.policies_sold, 0::bigint);

  SELECT * INTO r FROM board WHERE agent_id = 'a0000000-0000-4000-8000-00000000000c';
  PERFORM gt.eq('T7 other member org C appointments_set', r.appointments_set, 1::bigint);
  PERFORM gt.eq('C calls/policies (unchanged)', r.calls_made + r.policies_sold + r.talk_time_seconds, 0::bigint);

  -- Exactly one credit per row: the board total equals the rows whose setter is on the roster.
  PERFORM gt.eq('one credit per appointment', (SELECT sum(appointments_set) FROM board), 9::numeric);
  -- Ordering unchanged: policies_sold DESC, calls_made DESC.
  PERFORM gt.eq('ordering (unchanged)', (SELECT string_agg(agent_first_name, ',' ORDER BY pos) FROM board), 'Avery,Blake,Casey');
  RAISE NOTICE 'T0-T7 OK  runs under variable_conflict=error; setter credit, legacy fallback, self once, outcomes kept, booking window, roster, other metrics';
END $t$;
COMMIT;

-- T8 access: ACTIVE membership of THIS group still gates the board; nothing is widened.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000001"}}', false) \gset
SELECT gt.eq('T8a another active-member caller (B)', gt.roster(), 'Avery,Blake,Casey') \gset
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000002"}}', false) \gset
SELECT gt.eq('T8b second active member organization (C)', gt.roster(), 'Avery,Blake,Casey') \gset
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000d","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000003"}}', false) \gset
SELECT gt.expect_denied('T8c invited (not active) organization') \gset
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000010","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000004"}}', false) \gset
SELECT gt.expect_denied('T8d active in ANOTHER group') \gset
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000011","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000005"}}', false) \gset
SELECT gt.expect_denied('T8e status spelled Active (the check stays exactly status = active)') \gset
-- No organization claim: get_org_id() falls back to the caller's profile (Org One) — unchanged resolution.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', false) \gset
SELECT gt.eq('T8f organization from the profile fallback', gt.roster(), 'Avery,Blake,Casey') \gset
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false) \gset
SELECT gt.expect_denied('T8g anon (no organization)') \gset
RESET ROLE;

-- T8h revoking a membership takes effect immediately; restoring it restores access.
UPDATE public.agency_group_members SET status = 'removed'
 WHERE agency_group_id = '99999999-0000-4000-8000-000000000001' AND organization_id = '10000000-0000-4000-8000-000000000002';
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000002"}}', false) \gset
SELECT gt.expect_denied('T8h revoked organization') \gset
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000001"}}', false) \gset
SELECT gt.eq('T8h revoked organization leaves the roster', gt.roster(), 'Avery,Blake') \gset
RESET ROLE;
UPDATE public.agency_group_members SET status = 'active'
 WHERE agency_group_id = '99999999-0000-4000-8000-000000000001' AND organization_id = '10000000-0000-4000-8000-000000000002';
\echo 'T8 OK  active membership gates access; invited / other-group / mis-cased / anon / revoked denied; profile fallback kept'

-- T9 security metadata, signature, return shape, grants and the exact two-line body delta.
DO $t$
DECLARE
  f oid := 'public.get_agency_group_leaderboard(uuid,text)'::regprocedure;
  d text := pg_get_functiondef('public.get_agency_group_leaderboard(uuid,text)'::regprocedure);
  back text;
BEGIN
  PERFORM gt.eq('SECURITY DEFINER', (SELECT prosecdef FROM pg_proc WHERE oid = f), true);
  PERFORM gt.eq('volatility', (SELECT provolatile FROM pg_proc WHERE oid = f), 'v'::"char");
  PERFORM gt.eq('language', (SELECT l.lanname::text FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = f), 'plpgsql');
  PERFORM gt.eq('search_path', (SELECT proconfig FROM pg_proc WHERE oid = f), ARRAY['search_path=public']);
  PERFORM gt.eq('owner', (SELECT proowner::regrole::text FROM pg_proc WHERE oid = f), 'postgres');
  PERFORM gt.eq('acl', (SELECT proacl::text FROM pg_proc WHERE oid = f),
    '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}');
  PERFORM gt.eq('signature', pg_get_function_identity_arguments(f), 'p_group_id uuid, p_period text');
  PERFORM gt.eq('arguments (with default)', pg_get_function_arguments(f), 'p_group_id uuid, p_period text DEFAULT ''month''::text');
  PERFORM gt.eq('return shape', pg_get_function_result(f),
    'TABLE(organization_id uuid, organization_name text, agent_id uuid, agent_first_name text, agent_last_name text, agent_avatar_url text, calls_made bigint, appointments_set bigint, policies_sold bigint, talk_time_seconds bigint)');
  PERFORM gt.eq('returns a set', (SELECT proretset FROM pg_proc WHERE oid = f), true);
  PERFORM gt.eq('post-image md5', md5(d), '8bd49ee01e0b92abd3e66548569f36bb');
  PERFORM gt.eq('membership reference qualified once',
    (length(d) - length(replace(d, 'AND agency_group_members.organization_id = v_caller_org', ''))) / length('AND agency_group_members.organization_id = v_caller_org'), 1);
  PERFORM gt.eq('setter predicate present once',
    (length(d) - length(replace(d, 'WHERE COALESCE(ap.created_by, ap.user_id) = p.id', ''))) / length('WHERE COALESCE(ap.created_by, ap.user_id) = p.id'), 1);
  PERFORM gt.eq('assignee-only predicate gone', position('WHERE ap.user_id = p.id' IN d), 0);
  back := replace(replace(d, 'AND agency_group_members.organization_id = v_caller_org', 'AND organization_id = v_caller_org'),
                  'WHERE COALESCE(ap.created_by, ap.user_id) = p.id', 'WHERE ap.user_id = p.id');
  PERFORM gt.eq('only those two lines changed', md5(back), 'e1283b5b05d295c1d25888485cc08346');
  RAISE NOTICE 'T9 OK  SECURITY DEFINER, plpgsql, volatility, search_path, owner, ACL, signature, return shape, two-line delta';
END $t$;

-- T10 the setter index exists exactly as specified.
DO $t$
BEGIN
  PERFORM gt.eq('setter index definition', pg_get_indexdef('public.appointments_setter_created_at_idx'::regclass),
    'CREATE INDEX appointments_setter_created_at_idx ON public.appointments USING btree (COALESCE(created_by, user_id), created_at)');
  PERFORM gt.eq('setter index valid', (SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.appointments_setter_created_at_idx'::regclass), true);
  RAISE NOTICE 'T10 OK  appointments_setter_created_at_idx (COALESCE(created_by, user_id), created_at)';
END $t$;
