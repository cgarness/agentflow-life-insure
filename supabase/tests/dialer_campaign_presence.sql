-- =====================================================================================================
-- Dialer campaign-selection presence RPC — SQL integration tests
-- =====================================================================================================
-- STATUS: see WORK_LOG for the execution record. Run ONLY against a LOCAL disposable stack or an
-- APPROVED Supabase dev BRANCH — NEVER production. Requires migration
--   20260820213208_get_dialer_campaign_presence_rpc
-- to be applied (T0 aborts loudly if it is not — that is the fail-first proof pre-apply).
-- Runs in ONE transaction and ROLLBACKs — persists nothing even if misdirected.
--
--   psql "$LOCAL_OR_BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/dialer_campaign_presence.sql
--
-- Pure SQL (no psql \set). Auth is simulated via request.jwt.claims (auth.uid()) + seeded profiles;
-- RPC calls run under SET LOCAL ROLE authenticated. Harness follows import_campaign_attachment.sql
-- (_sim/_sys/_assert/_as/_expect_error; T0 existence guard; T0a fixture-collision preflight).
--
-- Fixture ids (synthetic, obviously fake):
--   ORG_A da000000-0000-0000-0000-00000000000a   ORG_B db000000-0000-0000-0000-00000000000b
--   ADMIN da…00ad (org A Admin)                  TL    da…00d1 (org A Team Leader)
--   SUPER da…005a (org A 'Super Admin' role)     SUPF  da…005f (org A Agent + is_super_admin flag)
--   AG1…AG8 da…00a1…a8 (org A Agents)            AGE   da…00ae (org A Agent, EMPTY name)
--   INACT da…00f1 (org A Agent, status Inactive) NOORG da…00e0 (Agent with NULL organization_id)
--   AGB   db…00b1 (org B Agent)
--   Campaigns da000000-2222-…: CO 0001 (Open Pool) · CT 0002 (Team: AG1+TL) · CP1 0003 (Personal AG1)
--             · CP2 0004 (Personal AG2) · CB db000000-2222-…-0001 (org B Open Pool)
--   Sessions  da000000-3333-… / db000000-3333-…
--
-- Session fixture matrix (org A unless noted; UNIQUE(org,agent) WHERE active is respected):
--   AG1 active  CO  hb = now()          → FRESH        AG2 active CO hb = now()-60s  → FRESH
--   AGE active  CO  hb = now()          → FRESH (name-less identity; hb tie with AG1)
--   AG7 active  CO  hb = now()-3min     → FRESH (exact boundary, >= complement of stale <)
--   AG8 active  CO  hb = now()-3min-1s  → STALE (excluded)
--   AG3 active  CT  hb = now()-10min    → STALE (excluded)
--   TL  active  CT  hb = now()          → FRESH
--   AG4 active  NULL campaign hb=now()  → excluded everywhere
--   AG5 ended   CO  hb = now()          → excluded (fresh heartbeat but ended)
--   AG6 abandoned CO hb = now()         → excluded
--   AG1 ended   CO (second, historical) → excluded; pins per-AGENT distinctness vs per-session
--   AGB active  CB (org B) hb = now()   → cross-org isolation
-- Expected fresh counts: CO = 4 (AG1, AGE, AG2, AG7) · CT = 1 (TL) · CP1 = 0 · CP2 = 0 · CB = 1.
-- Expected CO identity order (hb DESC, agent_id): AG1, AGE, AG2, AG7.
-- =====================================================================================================

BEGIN;

-- -----------------------------------------------------------------------------------------------------
-- T0. Guard: every object under test must exist (fail-first pre-apply proof).
-- -----------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.get_dialer_campaign_presence(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: public.get_dialer_campaign_presence(uuid[]) is not applied';
  END IF;
  IF to_regprocedure('public.can_dial_campaign(uuid)') IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: public.can_dial_campaign(uuid) is missing (canonical authorization)';
  END IF;
  IF to_regprocedure('private.campaign_actor()') IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: private.campaign_actor() is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public'
                    AND indexname = 'idx_dialer_sessions_org_status_heartbeat') THEN
    RAISE EXCEPTION 'T0 FAIL: idx_dialer_sessions_org_status_heartbeat is missing';
  END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- T0a. Fixture-collision preflight (ON CONFLICT/NOT EXISTS would silently mask a collision).
-- -----------------------------------------------------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM auth.users
   WHERE id::text LIKE 'da000000-0000-%' OR id::text LIKE 'db000000-0000-%'
      OR email LIKE 'dp.%@dptest.invalid';
  IF n <> 0 THEN RAISE EXCEPTION 'T0a FAIL: % fixture auth.users id/email(s) already occupied', n; END IF;

  SELECT count(*) INTO n FROM public.organizations
   WHERE id IN ('da000000-0000-0000-0000-00000000000a', 'db000000-0000-0000-0000-00000000000b');
  IF n <> 0 THEN RAISE EXCEPTION 'T0a FAIL: % fixture organization id(s) already occupied', n; END IF;

  SELECT (SELECT count(*) FROM public.campaigns       WHERE id::text LIKE 'da000000-2222-%' OR id::text LIKE 'db000000-2222-%')
       + (SELECT count(*) FROM public.dialer_sessions WHERE id::text LIKE 'da000000-3333-%' OR id::text LIKE 'db000000-3333-%')
    INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'T0a FAIL: % fixture data-table id(s) already occupied', n; END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------------------------------
INSERT INTO public.organizations (id, name) VALUES
  ('da000000-0000-0000-0000-00000000000a', 'DP Test Org A'),
  ('db000000-0000-0000-0000-00000000000b', 'DP Test Org B');

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('da000000-0000-0000-0000-0000000000ad', 'dp.admin@dptest.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-0000000000d1', 'dp.tl@dptest.invalid',     '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-00000000005a', 'dp.super@dptest.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-00000000005f', 'dp.supf@dptest.invalid',   '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-0000000000a1', 'dp.ag1@dptest.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-0000000000a2', 'dp.ag2@dptest.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-0000000000a3', 'dp.ag3@dptest.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-0000000000a4', 'dp.ag4@dptest.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-0000000000a5', 'dp.ag5@dptest.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-0000000000a6', 'dp.ag6@dptest.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-0000000000a7', 'dp.ag7@dptest.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-0000000000a8', 'dp.ag8@dptest.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-0000000000ae', 'dp.age@dptest.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-0000000000f1', 'dp.inact@dptest.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('da000000-0000-0000-0000-0000000000e0', 'dp.noorg@dptest.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('db000000-0000-0000-0000-0000000000b1', 'dp.agb@dptest.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

-- Tolerates a live on_auth_user_created trigger having already created the rows (real stack)
-- while also working on a stub without it.
INSERT INTO public.profiles (id, email, first_name, last_name, role, status)
SELECT u.id, u.email, 'DP', 'Fixture', 'Agent', 'Active'
FROM auth.users u
WHERE u.email LIKE 'dp.%@dptest.invalid'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

UPDATE public.profiles SET organization_id='da000000-0000-0000-0000-00000000000a', role='Admin',       status='Active',   is_super_admin=false WHERE id='da000000-0000-0000-0000-0000000000ad';
UPDATE public.profiles SET organization_id='da000000-0000-0000-0000-00000000000a', role='Team Leader', status='Active',   is_super_admin=false WHERE id='da000000-0000-0000-0000-0000000000d1';
UPDATE public.profiles SET organization_id='da000000-0000-0000-0000-00000000000a', role='Super Admin', status='Active',   is_super_admin=true  WHERE id='da000000-0000-0000-0000-00000000005a';
UPDATE public.profiles SET organization_id='da000000-0000-0000-0000-00000000000a', role='Agent',       status='Active',   is_super_admin=true  WHERE id='da000000-0000-0000-0000-00000000005f';
UPDATE public.profiles SET organization_id='da000000-0000-0000-0000-00000000000a', role='Agent',       status='Active',   is_super_admin=false
 WHERE id IN ('da000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-0000000000a2',
              'da000000-0000-0000-0000-0000000000a3','da000000-0000-0000-0000-0000000000a4',
              'da000000-0000-0000-0000-0000000000a5','da000000-0000-0000-0000-0000000000a6',
              'da000000-0000-0000-0000-0000000000a7','da000000-0000-0000-0000-0000000000a8',
              'da000000-0000-0000-0000-0000000000ae');
UPDATE public.profiles SET organization_id='da000000-0000-0000-0000-00000000000a', role='Agent',       status='Inactive', is_super_admin=false WHERE id='da000000-0000-0000-0000-0000000000f1';
UPDATE public.profiles SET organization_id=NULL,                                    role='Agent',       status='Active',   is_super_admin=false WHERE id='da000000-0000-0000-0000-0000000000e0';
UPDATE public.profiles SET organization_id='db000000-0000-0000-0000-00000000000b', role='Agent',       status='Active',   is_super_admin=false WHERE id='db000000-0000-0000-0000-0000000000b1';

-- Named identities for the leadership payload checks; AGE stays name-less (display_name NULL);
-- AG1 carries an avatar_url; everyone else keeps the '' default (must surface as NULL, not '').
UPDATE public.profiles SET first_name='Alice', last_name='One',  avatar_url='https://cdn.dptest.invalid/a1.png' WHERE id='da000000-0000-0000-0000-0000000000a1';
UPDATE public.profiles SET first_name='Bob',   last_name='Two'   WHERE id='da000000-0000-0000-0000-0000000000a2';
UPDATE public.profiles SET first_name='Gina',  last_name='Seven' WHERE id='da000000-0000-0000-0000-0000000000a7';
UPDATE public.profiles SET first_name='',      last_name=''      WHERE id='da000000-0000-0000-0000-0000000000ae';

INSERT INTO public.campaigns (id, organization_id, name, type, status, user_id, assigned_agent_ids) VALUES
  ('da000000-2222-0000-0000-000000000001','da000000-0000-0000-0000-00000000000a','DP Open Pool','Open Pool','Active','da000000-0000-0000-0000-0000000000ad','[]'::jsonb),
  ('da000000-2222-0000-0000-000000000002','da000000-0000-0000-0000-00000000000a','DP Team',     'Team',     'Active','da000000-0000-0000-0000-0000000000ad',
     '["da000000-0000-0000-0000-0000000000a1","da000000-0000-0000-0000-0000000000d1"]'::jsonb),
  ('da000000-2222-0000-0000-000000000003','da000000-0000-0000-0000-00000000000a','DP Personal 1','Personal','Active','da000000-0000-0000-0000-0000000000a1','[]'::jsonb),
  ('da000000-2222-0000-0000-000000000004','da000000-0000-0000-0000-00000000000a','DP Personal 2','Personal','Active','da000000-0000-0000-0000-0000000000a2','[]'::jsonb),
  ('db000000-2222-0000-0000-000000000001','db000000-0000-0000-0000-00000000000b','DP Org B Pool','Open Pool','Active','db000000-0000-0000-0000-0000000000b1','[]'::jsonb);

-- Sessions. now() is transaction-stable, so AG1 and AGE share an IDENTICAL heartbeat — the
-- deterministic-order tie the agent_id tie-break must resolve (amendment 3).
INSERT INTO public.dialer_sessions
  (id, organization_id, agent_id, campaign_id, started_at, last_heartbeat_at, ended_at, status) VALUES
  ('da000000-3333-0000-0000-000000000001','da000000-0000-0000-0000-00000000000a','da000000-0000-0000-0000-0000000000a1','da000000-2222-0000-0000-000000000001', now()-interval '30 minutes', now(),                                        NULL, 'active'),
  ('da000000-3333-0000-0000-000000000002','da000000-0000-0000-0000-00000000000a','da000000-0000-0000-0000-0000000000a2','da000000-2222-0000-0000-000000000001', now()-interval '20 minutes', now()-interval '60 seconds',                  NULL, 'active'),
  ('da000000-3333-0000-0000-00000000000e','da000000-0000-0000-0000-00000000000a','da000000-0000-0000-0000-0000000000ae','da000000-2222-0000-0000-000000000001', now()-interval '10 minutes', now(),                                        NULL, 'active'),
  ('da000000-3333-0000-0000-000000000007','da000000-0000-0000-0000-00000000000a','da000000-0000-0000-0000-0000000000a7','da000000-2222-0000-0000-000000000001', now()-interval '40 minutes', now()-interval '3 minutes',                   NULL, 'active'),
  ('da000000-3333-0000-0000-000000000008','da000000-0000-0000-0000-00000000000a','da000000-0000-0000-0000-0000000000a8','da000000-2222-0000-0000-000000000001', now()-interval '40 minutes', now()-interval '3 minutes 1 second',          NULL, 'active'),
  ('da000000-3333-0000-0000-000000000003','da000000-0000-0000-0000-00000000000a','da000000-0000-0000-0000-0000000000a3','da000000-2222-0000-0000-000000000002', now()-interval '2 hours',    now()-interval '10 minutes',                  NULL, 'active'),
  ('da000000-3333-0000-0000-0000000000d1','da000000-0000-0000-0000-00000000000a','da000000-0000-0000-0000-0000000000d1','da000000-2222-0000-0000-000000000002', now()-interval '5 minutes',  now(),                                        NULL, 'active'),
  ('da000000-3333-0000-0000-000000000004','da000000-0000-0000-0000-00000000000a','da000000-0000-0000-0000-0000000000a4', NULL,                                  now()-interval '5 minutes',  now(),                                        NULL, 'active'),
  ('da000000-3333-0000-0000-000000000005','da000000-0000-0000-0000-00000000000a','da000000-0000-0000-0000-0000000000a5','da000000-2222-0000-0000-000000000001', now()-interval '3 hours',    now(),                                        now(), 'ended'),
  ('da000000-3333-0000-0000-000000000006','da000000-0000-0000-0000-00000000000a','da000000-0000-0000-0000-0000000000a6','da000000-2222-0000-0000-000000000001', now()-interval '3 hours',    now(),                                        now(), 'abandoned'),
  ('da000000-3333-0000-0000-000000000009','da000000-0000-0000-0000-00000000000a','da000000-0000-0000-0000-0000000000a1','da000000-2222-0000-0000-000000000001', now()-interval '2 days',     now()-interval '2 days',   now()-interval '2 days', 'ended'),
  ('db000000-3333-0000-0000-000000000001','db000000-0000-0000-0000-00000000000b','db000000-0000-0000-0000-0000000000b1','db000000-2222-0000-0000-000000000001', now()-interval '5 minutes',  now(),                                        NULL, 'active');

-- -----------------------------------------------------------------------------------------------------
-- Harness helpers (import_campaign_attachment.sql conventions)
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp._sim(p_uid uuid, p_org uuid, p_role text, p_super boolean DEFAULT false)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_super_admin', p_super,
      'app_metadata', json_build_object('organization_id', p_org, 'role', p_role))::text, true);
$$;

CREATE OR REPLACE FUNCTION pg_temp._sys()
RETURNS void LANGUAGE sql AS $$
  -- '{}' (not NULL): set_config(..., NULL, ...) sets the GUC to '', and ''::json inside claim
  -- readers raises before the authorization check can fire. '{}' keeps auth.uid() NULL.
  SELECT set_config('request.jwt.claims', '{}', true);
$$;

CREATE OR REPLACE FUNCTION pg_temp._assert(p_cond boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION '% FAIL', p_label; END IF;
END;
$fn$;

/* Run arbitrary SQL as a simulated authenticated caller, returning a jsonb scalar. */
CREATE OR REPLACE FUNCTION pg_temp._as(p_uid uuid, p_org uuid, p_role text, p_sql text)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp._sim(p_uid, p_org, p_role);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE p_sql INTO v;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp._sys();
  RETURN v;
END;
$fn$;

/* Expect p_sql to fail with an error containing p_frag. */
CREATE OR REPLACE FUNCTION pg_temp._expect_error(p_uid uuid, p_org uuid, p_role text, p_sql text,
                                                 p_frag text, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    IF p_uid IS NULL THEN PERFORM pg_temp._sys(); ELSE PERFORM pg_temp._sim(p_uid, p_org, p_role); END IF;
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE p_sql;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    IF position(p_frag IN SQLERRM) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION '% FAIL: unexpected error [%] (wanted fragment [%])', p_label, SQLERRM, p_frag;
  END;
  RAISE EXCEPTION '% FAIL: expected error containing [%] but the call succeeded', p_label, p_frag;
END;
$fn$;

/* Presence result for a caller as a jsonb array of row objects, ordered by campaign_id. */
CREATE OR REPLACE FUNCTION pg_temp._presence(p_uid uuid, p_org uuid, p_role text, p_ids text)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN pg_temp._as(p_uid, p_org, p_role,
    'SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.campaign_id), ''[]''::jsonb) '
    || 'FROM public.get_dialer_campaign_presence(' || p_ids || ') t');
END;
$fn$;

/* The row object for one campaign inside a _presence() result, or NULL when absent. */
CREATE OR REPLACE FUNCTION pg_temp._row_for(p_rows jsonb, p_campaign uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(p_rows) e
  WHERE e->>'campaign_id' = p_campaign::text;
$$;

-- =====================================================================================================
-- SECTION 1 — aggregate correctness for an Agent caller
-- =====================================================================================================

-- T1. Agent AG1 requests every fixture campaign: rows come back ONLY for the dialable set
--     (CO, CT, CP1); counts are the fresh-distinct-agent truth; identities are ALWAYS '[]'.
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._presence('da000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-00000000000a','Agent',
        $q$ARRAY['da000000-2222-0000-0000-000000000001','da000000-2222-0000-0000-000000000002',
                 'da000000-2222-0000-0000-000000000003','da000000-2222-0000-0000-000000000004',
                 'db000000-2222-0000-0000-000000000001']::uuid[]$q$);
  PERFORM pg_temp._assert(jsonb_array_length(r) = 3, 'T1 exactly the 3 dialable campaigns return rows');
  PERFORM pg_temp._assert((pg_temp._row_for(r,'da000000-2222-0000-0000-000000000001')->>'active_agent_count')::int = 4,
    'T1 Open Pool fresh distinct count = 4 (AG1, AGE, AG2, boundary AG7)');
  PERFORM pg_temp._assert((pg_temp._row_for(r,'da000000-2222-0000-0000-000000000002')->>'active_agent_count')::int = 1,
    'T1 Team fresh count = 1 (TL only; stale AG3 excluded)');
  PERFORM pg_temp._assert(pg_temp._row_for(r,'da000000-2222-0000-0000-000000000004') IS NULL,
    'T1 another agent''s Personal campaign returns NO row');
  PERFORM pg_temp._assert(pg_temp._row_for(r,'db000000-2222-0000-0000-000000000001') IS NULL,
    'T1 cross-org campaign returns NO row');
  PERFORM pg_temp._assert(
    (SELECT bool_and(e->'active_agents' = '[]'::jsonb) FROM jsonb_array_elements(r) e),
    'T1 Agent caller receives counts ONLY — every active_agents is []');
END $$;

-- T2. Authoritative zero: AG1's own idle Personal campaign returns a row with count 0 (never a
--     missing row — the frontend distinguishes authoritative zero from unavailable).
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._presence('da000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-00000000000a','Agent',
        $q$ARRAY['da000000-2222-0000-0000-000000000003']::uuid[]$q$);
  PERFORM pg_temp._assert(jsonb_array_length(r) = 1, 'T2 idle authorized campaign still returns a row');
  PERFORM pg_temp._assert((r->0->>'active_agent_count')::int = 0, 'T2 authoritative zero');
  PERFORM pg_temp._assert(r->0->'active_agents' = '[]'::jsonb, 'T2 zero row carries empty identities');
END $$;

-- T3. Three-minute boundary: heartbeat at exactly now()-3min COUNTS (>=, the exact complement of
--     close_stale_dialer_sessions' `<` predicate); one second past does not. Proven by the CO
--     count (4 includes AG7, excludes AG8) and pinned again on identities in T7.

-- T4. Ended and abandoned rows are excluded even with fresh heartbeats (AG5 ended / AG6 abandoned
--     both have hb = now() yet CO counts 4) — and a second historical row for a counted agent
--     (AG1's old ended CO session) cannot double-count them. Covered by T1's exact count.

-- T5. NULL-campaign sessions are excluded everywhere: AG4 is active+fresh with campaign NULL and
--     appears in no row; total fresh agents across all org-A rows = 5.
DO $$
DECLARE r jsonb; total int;
BEGIN
  r := pg_temp._presence('da000000-0000-0000-0000-0000000000ad','da000000-0000-0000-0000-00000000000a','Admin',
        $q$ARRAY['da000000-2222-0000-0000-000000000001','da000000-2222-0000-0000-000000000002',
                 'da000000-2222-0000-0000-000000000003','da000000-2222-0000-0000-000000000004']::uuid[]$q$);
  SELECT COALESCE(sum((e->>'active_agent_count')::int), 0) INTO total FROM jsonb_array_elements(r) e;
  PERFORM pg_temp._assert(total = 4, 'T5 Admin-visible fresh total = 4 (CO only; Admin cannot dial the Team campaign)');
  PERFORM pg_temp._assert(
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e,
                              jsonb_array_elements(e->'active_agents') a
                 WHERE a->>'agent_id' = 'da000000-0000-0000-0000-0000000000a4'),
    'T5 the NULL-campaign session''s agent appears in no identity list');
END $$;

-- T6. Cross-org isolation, both directions: org-B's agent sees only org-B; org-A ids get them nothing.
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._presence('db000000-0000-0000-0000-0000000000b1','db000000-0000-0000-0000-00000000000b','Agent',
        $q$ARRAY['da000000-2222-0000-0000-000000000001','db000000-2222-0000-0000-000000000001']::uuid[]$q$);
  PERFORM pg_temp._assert(jsonb_array_length(r) = 1, 'T6 org-B caller gets exactly the org-B campaign');
  PERFORM pg_temp._assert((pg_temp._row_for(r,'db000000-2222-0000-0000-000000000001')->>'active_agent_count')::int = 1,
    'T6 org-B fresh count = 1 (its own agent)');
END $$;

-- =====================================================================================================
-- SECTION 2 — leadership identity payload
-- =====================================================================================================

-- T7. Team Leader: identities present, minimal-field shape, deterministic order
--     (last_heartbeat_at DESC, agent_id — AG1/AGE share an identical heartbeat), boundary row
--     included, stale row absent, name-less profile surfaces display_name NULL, '' avatar → NULL.
DO $$
DECLARE r jsonb; co jsonb; agents jsonb;
BEGIN
  r := pg_temp._presence('da000000-0000-0000-0000-0000000000d1','da000000-0000-0000-0000-00000000000a','Team Leader',
        $q$ARRAY['da000000-2222-0000-0000-000000000001','da000000-2222-0000-0000-000000000002']::uuid[]$q$);
  co := pg_temp._row_for(r, 'da000000-2222-0000-0000-000000000001');
  agents := co->'active_agents';
  PERFORM pg_temp._assert(jsonb_array_length(agents) = 4, 'T7 leadership identity list length = count');
  PERFORM pg_temp._assert(
    (SELECT array_agg(a->>'agent_id') FROM jsonb_array_elements(agents) WITH ORDINALITY AS t(a, ord))
      = ARRAY['da000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-0000000000ae',
              'da000000-0000-0000-0000-0000000000a2','da000000-0000-0000-0000-0000000000a7'],
    'T7 deterministic order: heartbeat DESC then agent_id (AG1 before AGE on identical heartbeat)');
  PERFORM pg_temp._assert(
    (SELECT bool_and(keys.ks = ARRAY['agent_id','avatar_url','display_name','last_heartbeat_at'])
       FROM jsonb_array_elements(agents) a,
            LATERAL (SELECT array_agg(k ORDER BY k) AS ks FROM jsonb_object_keys(a) k) keys),
    'T7 every identity entry carries EXACTLY the four approved keys — no email/phone/role');
  PERFORM pg_temp._assert(
    (SELECT a->'display_name' = 'null'::jsonb FROM jsonb_array_elements(agents) a
      WHERE a->>'agent_id' = 'da000000-0000-0000-0000-0000000000ae'),
    'T7 empty-name profile surfaces display_name NULL, not ''''');
  PERFORM pg_temp._assert(
    (SELECT a->>'display_name' = 'Alice One'
        AND a->>'avatar_url' = 'https://cdn.dptest.invalid/a1.png'
       FROM jsonb_array_elements(agents) a
      WHERE a->>'agent_id' = 'da000000-0000-0000-0000-0000000000a1'),
    'T7 display name + avatar_url pass through for a named profile');
  PERFORM pg_temp._assert(
    (SELECT bool_and(a->'avatar_url' = 'null'::jsonb) FROM jsonb_array_elements(agents) a
      WHERE a->>'agent_id' IN ('da000000-0000-0000-0000-0000000000a2','da000000-0000-0000-0000-0000000000a7')),
    'T7 default '''' avatar_url surfaces as NULL');
  PERFORM pg_temp._assert(
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(agents) a
                 WHERE a->>'agent_id' = 'da000000-0000-0000-0000-0000000000a8'),
    'T7 just-past-boundary agent (3min 1s) absent from identities');
  PERFORM pg_temp._assert(
    (pg_temp._row_for(r,'da000000-2222-0000-0000-000000000002')->'active_agents'->0->>'agent_id')
      = 'da000000-0000-0000-0000-0000000000d1',
    'T7 Team campaign identity = the TL''s own fresh session; stale AG3 absent');
END $$;

-- T8. Admin receives identities (on campaigns the Admin can DIAL — here the Open Pool).
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._presence('da000000-0000-0000-0000-0000000000ad','da000000-0000-0000-0000-00000000000a','Admin',
        $q$ARRAY['da000000-2222-0000-0000-000000000001']::uuid[]$q$);
  PERFORM pg_temp._assert(jsonb_array_length(r->0->'active_agents') = 4, 'T8 Admin gets identity payload');
END $$;

-- T9. 'Super Admin' role and the is_super_admin flag (role Agent) both receive identities —
--     still only inside their own org's dialable scope.
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._presence('da000000-0000-0000-0000-00000000005a','da000000-0000-0000-0000-00000000000a','Super Admin',
        $q$ARRAY['da000000-2222-0000-0000-000000000001','da000000-2222-0000-0000-000000000004']::uuid[]$q$);
  PERFORM pg_temp._assert(jsonb_array_length(r) = 1, 'T9 Super Admin gains no other agent''s Personal campaign');
  PERFORM pg_temp._assert(jsonb_array_length(r->0->'active_agents') = 4, 'T9 Super Admin role gets identities');
  r := pg_temp._presence('da000000-0000-0000-0000-00000000005f','da000000-0000-0000-0000-00000000000a','Agent',
        $q$ARRAY['da000000-2222-0000-0000-000000000001']::uuid[]$q$);
  PERFORM pg_temp._assert(jsonb_array_length(r->0->'active_agents') = 4, 'T9 is_super_admin flag gets identities');
END $$;

-- =====================================================================================================
-- SECTION 3 — authorization failures
-- =====================================================================================================

-- T10. Inactive profile → 42501 (campaign_actor's Active gate).
DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    PERFORM pg_temp._sim('da000000-0000-0000-0000-0000000000f1','da000000-0000-0000-0000-00000000000a','Agent');
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE $q$SELECT count(*) FROM public.get_dialer_campaign_presence(
      ARRAY['da000000-2222-0000-0000-000000000001']::uuid[])$q$;
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'T10 FAIL: inactive caller succeeded';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    IF v_code <> '42501' THEN RAISE EXCEPTION 'T10 FAIL: wanted 42501, got % (%)', v_code, SQLERRM; END IF;
  END;
  PERFORM pg_temp._sys();
END $$;

-- T11. Unauthenticated (auth.uid() NULL) → 42501.
DO $$
BEGIN
  PERFORM pg_temp._expect_error(NULL, NULL, NULL,
    $q$SELECT count(*) FROM public.get_dialer_campaign_presence(
        ARRAY['da000000-2222-0000-0000-000000000001']::uuid[])$q$,
    'not authenticated', 'T11 unauthenticated caller');
END $$;

-- T12. No organization context (claim org NULL, profile org NULL) → 42501.
DO $$
BEGIN
  PERFORM pg_temp._expect_error('da000000-0000-0000-0000-0000000000e0', NULL, 'Agent',
    $q$SELECT count(*) FROM public.get_dialer_campaign_presence(
        ARRAY['da000000-2222-0000-0000-000000000001']::uuid[])$q$,
    'no organization context', 'T12 org-less caller');
END $$;

-- =====================================================================================================
-- SECTION 4 — input safety (Chris amendment 2: TOTAL cardinality)
-- =====================================================================================================

-- T13. Empty and NULL input → empty result, no error.
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._presence('da000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-00000000000a','Agent',
        $q$'{}'::uuid[]$q$);
  PERFORM pg_temp._assert(r = '[]'::jsonb, 'T13 empty array → empty result');
  r := pg_temp._presence('da000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-00000000000a','Agent',
        $q$NULL::uuid[]$q$);
  PERFORM pg_temp._assert(r = '[]'::jsonb, 'T13 NULL → empty result');
END $$;

-- T14. Duplicate ids collapse to one row per campaign.
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._presence('da000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-00000000000a','Agent',
        $q$ARRAY['da000000-2222-0000-0000-000000000001','da000000-2222-0000-0000-000000000001',
                 'da000000-2222-0000-0000-000000000001']::uuid[]$q$);
  PERFORM pg_temp._assert(jsonb_array_length(r) = 1, 'T14 duplicates dedupe to one row');
  PERFORM pg_temp._assert((r->0->>'active_agent_count')::int = 4, 'T14 deduped row keeps the true count');
END $$;

-- T15. Cap applies to TOTAL cardinality. A 201-element 1-D array fails; a 2x101 multidimensional
--      array (array_length dim-1 = 2, cardinality = 202) must ALSO fail — proving the check counts
--      total elements, not the first dimension; a 2x100 (cardinality 200) passes the cap.
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp._expect_error('da000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-00000000000a','Agent',
    $q$SELECT count(*) FROM public.get_dialer_campaign_presence(
        array_fill('00000000-0000-0000-0000-000000000000'::uuid, ARRAY[201]))$q$,
    'too many campaign ids', 'T15 201-element 1-D input rejected');
  PERFORM pg_temp._expect_error('da000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-00000000000a','Agent',
    $q$SELECT count(*) FROM public.get_dialer_campaign_presence(
        array_fill('00000000-0000-0000-0000-000000000000'::uuid, ARRAY[2,101]))$q$,
    'too many campaign ids', 'T15 multidim 2x101 (total 202) rejected despite first dimension = 2');
  r := pg_temp._presence('da000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-00000000000a','Agent',
        $q$array_fill('00000000-0000-0000-0000-000000000000'::uuid, ARRAY[2,100])$q$);
  PERFORM pg_temp._assert(r = '[]'::jsonb, 'T15 total-200 multidim passes the cap (unknown ids → no rows)');
END $$;

-- T16. Error SQLSTATE for the cap is 22023 (invalid_parameter_value).
DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    PERFORM pg_temp._sim('da000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-00000000000a','Agent');
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE $q$SELECT count(*) FROM public.get_dialer_campaign_presence(
        array_fill('00000000-0000-0000-0000-000000000000'::uuid, ARRAY[201]))$q$;
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'T16 FAIL: oversized input succeeded';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    IF v_code <> '22023' THEN RAISE EXCEPTION 'T16 FAIL: wanted 22023, got % (%)', v_code, SQLERRM; END IF;
  END;
  PERFORM pg_temp._sys();
END $$;

-- =====================================================================================================
-- SECTION 5 — canonical-authorization agreement (amendment 1: delegation, not a mirror)
-- =====================================================================================================

-- T17. For every (caller, campaign) pair over the org-A fixtures, a presence row exists IFF the
--      canonical public.can_dial_campaign() says the caller may dial it. Pins: Admin gains neither
--      an unassigned Team campaign nor any Personal campaign; management scope never leaks in.
DO $$
DECLARE
  callers uuid[] := ARRAY['da000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-0000000000a2',
                          'da000000-0000-0000-0000-0000000000d1','da000000-0000-0000-0000-0000000000ad'];
  roles   text[] := ARRAY['Agent','Agent','Team Leader','Admin'];
  camps uuid[] := ARRAY['da000000-2222-0000-0000-000000000001','da000000-2222-0000-0000-000000000002',
                        'da000000-2222-0000-0000-000000000003','da000000-2222-0000-0000-000000000004'];
  i int; j int; r jsonb; canonical boolean; present boolean;
BEGIN
  FOR i IN 1..array_length(callers, 1) LOOP
    r := pg_temp._presence(callers[i], 'da000000-0000-0000-0000-00000000000a', roles[i],
      $q$ARRAY['da000000-2222-0000-0000-000000000001','da000000-2222-0000-0000-000000000002',
               'da000000-2222-0000-0000-000000000003','da000000-2222-0000-0000-000000000004']::uuid[]$q$);
    FOR j IN 1..array_length(camps, 1) LOOP
      canonical := (pg_temp._as(callers[i], 'da000000-0000-0000-0000-00000000000a', roles[i],
        'SELECT to_jsonb(public.can_dial_campaign(''' || camps[j]::text || '''::uuid))'))::text::boolean;
      present := pg_temp._row_for(r, camps[j]) IS NOT NULL;
      IF canonical IS DISTINCT FROM present THEN
        RAISE EXCEPTION 'T17 FAIL: caller % campaign %: can_dial_campaign=% but presence row present=%',
          callers[i], camps[j], canonical, present;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- =====================================================================================================
-- SECTION 6 — function privileges & definition hardening
-- =====================================================================================================

-- T18. Role privileges: authenticated may EXECUTE; anon may not.
DO $$
BEGIN
  PERFORM pg_temp._assert(
    has_function_privilege('authenticated', 'public.get_dialer_campaign_presence(uuid[])', 'EXECUTE'),
    'T18 authenticated EXECUTE granted');
  PERFORM pg_temp._assert(
    NOT has_function_privilege('anon', 'public.get_dialer_campaign_presence(uuid[])', 'EXECUTE'),
    'T18 anon EXECUTE revoked');
  PERFORM pg_temp._assert(
    has_function_privilege('service_role', 'public.get_dialer_campaign_presence(uuid[])', 'EXECUTE'),
    'T18 service_role EXECUTE granted');
END $$;

-- T19. proacl scan across ALL overloads: no PUBLIC ('=X') entry, no anon entry, ACL non-NULL
--      (a NULL acl means default privileges, which include PUBLIC EXECUTE — a failure).
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_dialer_campaign_presence'
    AND (p.proacl IS NULL
         OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                     WHERE a.grantee = 0
                        OR a.grantee = 'anon'::regrole::oid));
  IF bad <> 0 THEN RAISE EXCEPTION 'T19 FAIL: % overload(s) grant PUBLIC/anon or carry a NULL acl', bad; END IF;
END $$;

-- T20. SECURITY DEFINER + pinned hardened search_path (exact literal).
DO $$
DECLARE ok boolean;
BEGIN
  SELECT p.prosecdef AND p.proconfig::text[] @> ARRAY['search_path=pg_catalog, pg_temp'] INTO ok
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_dialer_campaign_presence';
  PERFORM pg_temp._assert(ok, 'T20 SECURITY DEFINER with search_path=pg_catalog, pg_temp');
END $$;

-- =====================================================================================================
-- SECTION 7 — read-only proof
-- =====================================================================================================

-- T21. The presence read never mutates sessions: every fixture row — including the stale actives —
--      is byte-stable after all the calls above (stale cleanup stays owned by start/heartbeat).
DO $$
BEGIN
  PERFORM pg_temp._assert(
    (SELECT count(*) FROM public.dialer_sessions
      WHERE id::text LIKE 'da000000-3333-%' OR id::text LIKE 'db000000-3333-%') = 12,
    'T21 all 12 fixture sessions still present');
  PERFORM pg_temp._assert(
    (SELECT status = 'active' AND ended_at IS NULL
        AND last_heartbeat_at < now() - interval '9 minutes'
       FROM public.dialer_sessions WHERE id = 'da000000-3333-0000-0000-000000000003'),
    'T21 stale active row untouched (not abandoned, heartbeat unchanged)');
  PERFORM pg_temp._assert(
    (SELECT status = 'active' AND ended_at IS NULL
       FROM public.dialer_sessions WHERE id = 'da000000-3333-0000-0000-000000000008'),
    'T21 boundary-stale row untouched');
END $$;

DO $$ BEGIN RAISE NOTICE 'dialer_campaign_presence.sql: ALL ASSERTIONS PASSED'; END $$;

ROLLBACK;
