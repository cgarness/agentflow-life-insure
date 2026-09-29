-- =====================================================================================================
-- Group leaderboard "Appointments Set" = setter credit — behaviour, access and metadata suite.
-- STATUS: disposable LOCAL PostgreSQL only, via scripts/run_group_leaderboard_tests.sh (AGENT_RULES #28).
-- Runs AFTER supabase/migrations/20260929160000_group_leaderboard_appointment_setter_credit.sql. On the
-- pre-migration function the T1 assertions MUST fail (the runner proves it as a negative control).
--
-- Canon (AGENT_RULES #23 / #38): Appointments Set credits COALESCE(created_by, user_id) on appointments.created_at,
-- with no status filter. Everything else the function does is asserted unchanged.
-- =====================================================================================================
\set ON_ERROR_STOP 1

-- PRE-EXISTING DEFECT, NOT CHANGED BY THE MIGRATION (proved separately by the runner, step 6): the function's
-- membership check reads an unqualified `organization_id`, which collides with its own RETURNS TABLE column, so
-- under production's plpgsql.variable_conflict = 'error' EVERY call raises 42702 "column reference ... is
-- ambiguous" (production: 0 agency groups on 2026-09-29, so it is latent). To exercise the attribution the
-- migration DOES change, this session resolves the name the way the query evidently intends (the table column).
-- The runner's step 6b re-runs T1-T8 with conflict_mode=error against a copy whose ONLY extra change qualifies that
-- one reference, proving the migrated attribution query itself has no name clash under the production setting.
\if :{?conflict_mode}
\else
\set conflict_mode use_column
\endif
SET plpgsql.variable_conflict = :conflict_mode;

-- One transaction for the data and the main read, so now() — and therefore the period start — is one instant.
BEGIN;

INSERT INTO public.organizations (id, name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Org One'),
  ('10000000-0000-4000-8000-000000000002', 'Org Two'),
  ('10000000-0000-4000-8000-000000000003', 'Org Three (not in the group)');

INSERT INTO public.company_settings (organization_id, timezone) VALUES
  ('10000000-0000-4000-8000-000000000001', 'America/Los_Angeles'),
  ('10000000-0000-4000-8000-000000000002', 'UTC'),
  ('10000000-0000-4000-8000-000000000003', 'UTC');

INSERT INTO public.agency_group_members (agency_group_id, organization_id, status) VALUES
  ('99999999-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'active'),
  ('99999999-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'active'),
  ('99999999-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'invited');

-- A, B: agents in Org One. C: admin in Org Two. I: inactive in Org One. X: agent in Org Three.
INSERT INTO public.profiles (id, organization_id, first_name, last_name, role, status) VALUES
  ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'Avery',  'Setter',   'Agent', 'Active'),
  ('a0000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'Blake',  'Assignee', 'Agent', 'Active'),
  ('a0000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-000000000002', 'Casey',  'Admin',    'Admin', 'Active'),
  ('a0000000-0000-4000-8000-00000000000e', '10000000-0000-4000-8000-000000000001', 'Indy',   'Inactive', 'Agent', 'Inactive'),
  ('a0000000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-000000000003', 'Xan',    'Outsider', 'Agent', 'Active');

CREATE TEMP TABLE period AS
  SELECT date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles' AS ps;

INSERT INTO public.appointments (id, organization_id, created_by, user_id, status, start_time, created_at)
SELECT v.id::uuid, v.org::uuid, v.created_by::uuid, v.user_id::uuid, v.status, v.start_time, v.created_at
FROM period, LATERAL (VALUES
  -- T1 delegated booking: A set it for B → A +1, B 0.
  ('b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000b', 'Scheduled',   now() + interval '2 days',  now()),
  -- T2 legacy writer gap: created_by NULL, user_id B → B +1 via the approved fallback.
  ('b0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', NULL,                                   'a0000000-0000-4000-8000-00000000000b', 'Scheduled',   now() + interval '2 days',  now()),
  -- T3 self-booked: A for A → A +1 exactly once.
  ('b0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Scheduled',   now() + interval '3 days',  now()),
  -- T4 later outcomes never remove booking credit.
  ('b0000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Cancelled',   now() + interval '4 days',  now()),
  ('b0000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000b', 'No Show',     now() - interval '1 hour',  now()),
  ('b0000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Completed',   now() - interval '2 hours', now()),
  ('b0000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Rescheduled', now() + interval '5 days',  now()),
  -- T5 booking time, not occurrence: booked before the period (not counted) / occurring far ahead (counted).
  ('b0000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Scheduled',   now() + interval '1 day',   ps - interval '1 second'),
  ('b0000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'Scheduled',   now() + interval '60 days', now()),
  -- T6 set by someone off the roster (inactive I) for A: credits I, so A gets nothing from it.
  ('b0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000e', 'a0000000-0000-4000-8000-00000000000a', 'Scheduled',   now() + interval '1 day',   now()),
  -- T7 another member organization: C for C.
  ('b0000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-00000000000c', 'Scheduled',   now() + interval '1 day',   now())
) AS v(id, org, created_by, user_id, status, start_time, created_at);

-- Unchanged metrics: calls (no direction filter), talk time, clients-based policies_sold.
INSERT INTO public.calls (agent_id, created_at, duration) SELECT v.agent_id::uuid, v.created_at, v.duration FROM period, LATERAL (VALUES
  ('a0000000-0000-4000-8000-00000000000a', now(), 30),
  ('a0000000-0000-4000-8000-00000000000a', now(), 60),
  ('a0000000-0000-4000-8000-00000000000a', ps - interval '1 second', 999),
  ('a0000000-0000-4000-8000-00000000000b', now(), 10)
) AS v(agent_id, created_at, duration);
INSERT INTO public.clients (assigned_agent_id, created_at) VALUES ('a0000000-0000-4000-8000-00000000000a', now());

-- The read, as an authenticated Org One member (A), exactly as PostgREST sets the claims.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000001"}}', true);
CREATE TEMP TABLE board AS
  SELECT row_number() OVER () AS pos, b.* FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month') b;
RESET ROLE;

DO $t$
DECLARE r record;
BEGIN
  -- Roster: active Agent/TL/Admin profiles of ACTIVE member organizations only (I inactive, X invited org).
  PERFORM gt.eq('roster', (SELECT string_agg(agent_first_name, ',' ORDER BY pos) FROM board), 'Avery,Blake,Casey');

  SELECT * INTO r FROM board WHERE agent_id = 'a0000000-0000-4000-8000-00000000000a';
  -- T1 + T3 + T4 + T5: b1, b3, b4, b5, b6, b7, b9 (not b8: booked before the period; not b10: set by I).
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
  RAISE NOTICE 'T1-T7 OK  setter credit, legacy fallback, self once, outcomes kept, booking window, roster, other metrics';
END $t$;
COMMIT;

-- T8 access is unchanged: a caller whose organization is not an ACTIVE member is refused.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-00000000000d","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000003"}}', false);
DO $t$
BEGIN
  PERFORM * FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month');
  RAISE EXCEPTION 'ASSERT FAILED [T8 non-member]: a non-member organization read the group board';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'Access denied%' THEN RAISE; END IF;
END $t$;
RESET ROLE;

-- T8 anon (PostgREST's anon claims: no sub, no organization) resolves no organization and is refused.
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
DO $t$
BEGIN
  PERFORM * FROM public.get_agency_group_leaderboard('99999999-0000-4000-8000-000000000001', 'month');
  RAISE EXCEPTION 'ASSERT FAILED [T8 anon]: anon read the group board';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'Access denied%' THEN RAISE; END IF;
END $t$;
RESET ROLE;

-- T9 security metadata, grants and the one-predicate body delta (skipped only by step 6b, whose copy carries the
-- extra qualification on purpose).
\if :{?skip_body_pin}
\echo 'T9 skipped (step 6b copy)'
\else
DO $t$
DECLARE
  f oid := 'public.get_agency_group_leaderboard(uuid,text)'::regprocedure;
  d text := pg_get_functiondef('public.get_agency_group_leaderboard(uuid,text)'::regprocedure);
BEGIN
  PERFORM gt.eq('SECURITY DEFINER', (SELECT prosecdef FROM pg_proc WHERE oid = f), true);
  PERFORM gt.eq('volatility', (SELECT provolatile FROM pg_proc WHERE oid = f), 'v'::"char");
  PERFORM gt.eq('search_path', (SELECT proconfig FROM pg_proc WHERE oid = f), ARRAY['search_path=public']);
  PERFORM gt.eq('owner', (SELECT proowner::regrole::text FROM pg_proc WHERE oid = f), 'postgres');
  PERFORM gt.eq('acl', (SELECT proacl::text FROM pg_proc WHERE oid = f),
    '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}');
  PERFORM gt.eq('arguments', pg_get_function_arguments(f), 'p_group_id uuid, p_period text DEFAULT ''month''::text');
  PERFORM gt.eq('post-image md5', md5(d), 'e69bbcf6a9f47457a44c887cb4418aef');
  PERFORM gt.eq('setter predicate present once',
    (length(d) - length(replace(d, 'WHERE COALESCE(ap.created_by, ap.user_id) = p.id', ''))) / length('WHERE COALESCE(ap.created_by, ap.user_id) = p.id'), 1);
  PERFORM gt.eq('assignee-only predicate gone', position('WHERE ap.user_id = p.id' IN d), 0);
  PERFORM gt.eq('only that predicate changed',
    md5(replace(d, 'WHERE COALESCE(ap.created_by, ap.user_id) = p.id', 'WHERE ap.user_id = p.id')), 'e1283b5b05d295c1d25888485cc08346');
  RAISE NOTICE 'T8-T9 OK  membership check, anon refusal, SECURITY DEFINER, search_path, owner, grants, one-line delta';
END $t$;
\endif
