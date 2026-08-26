-- =====================================================================================================
-- Import campaign ownership / attachment / retry / dial-scope — SQL integration tests
-- =====================================================================================================
-- STATUS: see WORK_LOG for the execution record. Run ONLY against a LOCAL Supabase stack or an
-- APPROVED Supabase dev BRANCH — NEVER production. Requires migrations
--   20260811200920_campaign_leads_membership_uniqueness_and_attachment_core
--   20260811201250_import_campaign_creation_and_retry
--   20260811201401_dialer_session_campaign_access
-- to be applied (T0 aborts loudly if they are not — that is the fail-first proof pre-apply).
-- Runs in ONE transaction and ROLLBACKs — persists nothing even if misdirected.
--
--   psql "$LOCAL_OR_BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/import_campaign_attachment.sql
--
-- Pure SQL (no psql \set), so the same file is MCP-executable on a dev branch. Auth is simulated via
-- request.jwt.claims (auth.uid()) + seeded profiles; RPC calls run under SET LOCAL ROLE authenticated.
-- Assertions RAISE EXCEPTION on failure. Fixture pattern follows leaderboard_aggregate_rpc.sql /
-- p0_profile_authorization.sql: auth.users is seeded first (profiles_id_fkey), the live
-- on_auth_user_created -> handle_new_user() trigger creates each profiles row, then explicit UPDATEs
-- force org/role/status.
--
-- Fixture ids (synthetic, obviously fake):
--   ORG_A  ca000000-0000-0000-0000-00000000000a     ORG_B  cb000000-0000-0000-0000-00000000000b
--   ADMIN  ca000000-0000-0000-0000-0000000000ad     (org A Admin)
--   AG1    ca000000-0000-0000-0000-0000000000a1     (org A Agent — the "selected agent")
--   AG2    ca000000-0000-0000-0000-0000000000a2     (org A Agent — a different agent)
--   TL     ca000000-0000-0000-0000-0000000000t1     -> ca000000-0000-0000-0000-00000000001d (Team Leader)
--   AGB    cb000000-0000-0000-0000-0000000000b1     (org B Agent — cross-org guard)
--   Leads  ca000000-1111-…  (org A)                 cb000000-1111-…  (org B)
-- =====================================================================================================

BEGIN;

-- -----------------------------------------------------------------------------------------------------
-- T0. Guard: every object under test must exist.
-- -----------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.create_import_campaign(text,text,text,uuid,uuid[],text)') IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: public.create_import_campaign is not applied';
  END IF;
  IF to_regprocedure('public.retry_import_campaign_attachment(uuid)') IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: public.retry_import_campaign_attachment is not applied';
  END IF;
  IF to_regprocedure('public.can_dial_campaign(uuid)') IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: public.can_dial_campaign is not applied';
  END IF;
  IF to_regprocedure('private.attach_leads_to_campaign_core(uuid,uuid[],uuid)') IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: private.attach_leads_to_campaign_core is not applied';
  END IF;
  IF to_regprocedure('private.assert_import_set_campaign_compatible(uuid,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: private.assert_import_set_campaign_compatible is not applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'campaign_leads_campaign_lead_unique') THEN
    RAISE EXCEPTION 'T0 FAIL: campaign_leads_campaign_lead_unique index is missing';
  END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- T0a. Fixture-collision preflight.
-- -----------------------------------------------------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM auth.users
   WHERE id::text LIKE 'ca000000-0000-%' OR id::text LIKE 'cb000000-0000-%'
      OR email LIKE 'ic.%@ictest.invalid';
  IF n <> 0 THEN RAISE EXCEPTION 'T0a FAIL: % fixture auth.users id/email(s) already occupied', n; END IF;

  SELECT count(*) INTO n FROM public.organizations
   WHERE id IN ('ca000000-0000-0000-0000-00000000000a', 'cb000000-0000-0000-0000-00000000000b');
  IF n <> 0 THEN RAISE EXCEPTION 'T0a FAIL: % fixture organization id(s) already occupied', n; END IF;

  SELECT (SELECT count(*) FROM public.leads          WHERE id::text LIKE 'ca000000-1111-%' OR id::text LIKE 'cb000000-1111-%')
       + (SELECT count(*) FROM public.campaigns      WHERE id::text LIKE 'ca000000-2222-%' OR id::text LIKE 'cb000000-2222-%')
       + (SELECT count(*) FROM public.import_history WHERE id::text LIKE 'ca000000-3333-%')
    INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'T0a FAIL: % fixture data-table id(s) already occupied', n; END IF;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------------------------------
INSERT INTO public.organizations (id, name) VALUES
  ('ca000000-0000-0000-0000-00000000000a', 'IC Test Org A'),
  ('cb000000-0000-0000-0000-00000000000b', 'IC Test Org B');

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('ca000000-0000-0000-0000-0000000000ad', 'ic.admin@ictest.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('ca000000-0000-0000-0000-0000000000a1', 'ic.agent1@ictest.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('ca000000-0000-0000-0000-0000000000a2', 'ic.agent2@ictest.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('ca000000-0000-0000-0000-00000000001d', 'ic.lead@ictest.invalid',   '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('cb000000-0000-0000-0000-0000000000b1', 'ic.agentb@ictest.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.profiles (id, email, first_name, last_name, role, status)
SELECT u.id, u.email, 'IC', 'Fixture', 'Agent', 'Active'
FROM auth.users u
WHERE u.email LIKE 'ic.%@ictest.invalid'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

UPDATE public.profiles SET organization_id='ca000000-0000-0000-0000-00000000000a', role='Admin',       status='Active', is_super_admin=false WHERE id='ca000000-0000-0000-0000-0000000000ad';
UPDATE public.profiles SET organization_id='ca000000-0000-0000-0000-00000000000a', role='Agent',       status='Active', is_super_admin=false WHERE id='ca000000-0000-0000-0000-0000000000a1';
UPDATE public.profiles SET organization_id='ca000000-0000-0000-0000-00000000000a', role='Agent',       status='Active', is_super_admin=false WHERE id='ca000000-0000-0000-0000-0000000000a2';
UPDATE public.profiles SET organization_id='ca000000-0000-0000-0000-00000000000a', role='Team Leader', status='Active', is_super_admin=false WHERE id='ca000000-0000-0000-0000-00000000001d';
UPDATE public.profiles SET organization_id='cb000000-0000-0000-0000-00000000000b', role='Agent',       status='Active', is_super_admin=false WHERE id='cb000000-0000-0000-0000-0000000000b1';

-- Leads. L1..L3 belong to AG1; L4 to AG2; L5 unassigned; LB is org B.
-- tr_sync_leads_user_id mirrors assigned_agent_id into user_id.
INSERT INTO public.leads (id, organization_id, first_name, last_name, phone, email, state, assigned_agent_id, status) VALUES
  ('ca000000-1111-0000-0000-000000000001','ca000000-0000-0000-0000-00000000000a','L','One',  '5550000001','l1@ictest.invalid','TX','ca000000-0000-0000-0000-0000000000a1','New'),
  ('ca000000-1111-0000-0000-000000000002','ca000000-0000-0000-0000-00000000000a','L','Two',  '5550000002','l2@ictest.invalid','TX','ca000000-0000-0000-0000-0000000000a1','New'),
  ('ca000000-1111-0000-0000-000000000003','ca000000-0000-0000-0000-00000000000a','L','Three','5550000003','l3@ictest.invalid','TX','ca000000-0000-0000-0000-0000000000a1','New'),
  ('ca000000-1111-0000-0000-000000000004','ca000000-0000-0000-0000-00000000000a','L','Four', '5550000004','l4@ictest.invalid','TX','ca000000-0000-0000-0000-0000000000a2','New'),
  ('ca000000-1111-0000-0000-000000000005','ca000000-0000-0000-0000-00000000000a','L','Five', '5550000005','l5@ictest.invalid','TX',NULL,'New'),
  ('cb000000-1111-0000-0000-000000000001','cb000000-0000-0000-0000-00000000000b','L','Bee',  '5550000009','lb@ictest.invalid','TX','cb000000-0000-0000-0000-0000000000b1','New');

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
  -- '{}' (not NULL): set_config(..., NULL, ...) sets the GUC to '', and ''::json inside
  -- claim readers (e.g. get_user_role) raises "invalid input syntax for type json" before the
  -- authorization check can fire. An empty JSON object keeps auth.uid() NULL — a faithful
  -- unauthenticated fixture — while remaining parseable.
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

-- =====================================================================================================
-- SECTION 1 — create_import_campaign: ownership + authorization
-- =====================================================================================================

-- T1. Authorized Admin creates a Personal campaign OWNED BY the agent, created_by = the Admin.
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Personal A1','Personal','',
              'ca000000-0000-0000-0000-0000000000a1',
              ARRAY['ca000000-0000-0000-0000-0000000000a1']::uuid[], 'specific_agent') $q$);
  PERFORM pg_temp._assert((r->>'user_id')::uuid = 'ca000000-0000-0000-0000-0000000000a1', 'T1 owner is the selected agent');
  PERFORM pg_temp._assert((r->>'created_by')::uuid = 'ca000000-0000-0000-0000-0000000000ad', 'T1 created_by is the importer');
  PERFORM pg_temp._assert((r->>'organization_id')::uuid = 'ca000000-0000-0000-0000-00000000000a', 'T1 org is DB-authoritative');
  PERFORM pg_temp._assert(r->'assigned_agent_ids' = '["ca000000-0000-0000-0000-0000000000a1"]'::jsonb, 'T1 participants');
  UPDATE public.campaigns SET id = 'ca000000-2222-0000-0000-000000000001' WHERE id = (r->>'id')::uuid;
END $$;

-- T2. An Agent may create ONLY their own Personal campaign.
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-00000000000a','Agent',
        $q$ SELECT public.create_import_campaign('IC Self','Personal','', NULL, NULL, 'myself') $q$);
  PERFORM pg_temp._assert((r->>'user_id')::uuid = 'ca000000-0000-0000-0000-0000000000a1', 'T2 agent owns own campaign');
  DELETE FROM public.campaigns WHERE id = (r->>'id')::uuid;
END $$;

-- T3. An Agent may NOT create a Personal campaign owned by a different agent.
DO $$
BEGIN
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-00000000000a','Agent',
    $q$ SELECT public.create_import_campaign('IC Steal','Personal','',
          'ca000000-0000-0000-0000-0000000000a2', NULL, 'specific_agent') $q$,
    'not authorized to create a campaign for user', 'T3 agent cannot create for another agent');
END $$;

-- T4. Team Leader: self is allowed; downline authority uses is_ancestor_of and FAILS CLOSED while
--     profiles.hierarchy_path is unrepaired (D-2). This test pins the CURRENT behaviour deliberately.
DO $$
DECLARE r jsonb; v_anc boolean;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-00000000001d','ca000000-0000-0000-0000-00000000000a','Team Leader',
        $q$ SELECT public.create_import_campaign('IC TL Self','Personal','', NULL, NULL, 'myself') $q$);
  PERFORM pg_temp._assert((r->>'user_id')::uuid = 'ca000000-0000-0000-0000-00000000001d', 'T4a TL self allowed');
  DELETE FROM public.campaigns WHERE id = (r->>'id')::uuid;

  SELECT public.is_ancestor_of('ca000000-0000-0000-0000-00000000001d','ca000000-0000-0000-0000-0000000000a1')
    INTO v_anc;
  IF v_anc THEN
    r := pg_temp._as('ca000000-0000-0000-0000-00000000001d','ca000000-0000-0000-0000-00000000000a','Team Leader',
          $q$ SELECT public.create_import_campaign('IC TL Down','Personal','',
                'ca000000-0000-0000-0000-0000000000a1', NULL, 'specific_agent') $q$);
    PERFORM pg_temp._assert((r->>'user_id')::uuid = 'ca000000-0000-0000-0000-0000000000a1', 'T4b TL downline allowed');
    DELETE FROM public.campaigns WHERE id = (r->>'id')::uuid;
  ELSE
    PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-00000000001d','ca000000-0000-0000-0000-00000000000a','Team Leader',
      $q$ SELECT public.create_import_campaign('IC TL Down','Personal','',
            'ca000000-0000-0000-0000-0000000000a1', NULL, 'specific_agent') $q$,
      'not authorized to create a campaign for user', 'T4b TL downline fails closed (hierarchy_path unrepaired)');
  END IF;
END $$;

-- T5. Cross-organization owner and participant are rejected.
DO $$
BEGIN
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.create_import_campaign('IC XOrg','Personal','',
          'cb000000-0000-0000-0000-0000000000b1', NULL, 'specific_agent') $q$,
    'outside your organization', 'T5a cross-org owner rejected');

  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.create_import_campaign('IC XOrgTeam','Team','', NULL,
          ARRAY['cb000000-0000-0000-0000-0000000000b1']::uuid[], 'specific_agent') $q$,
    'outside your organization', 'T5b cross-org participant rejected');
END $$;

-- T6. Round Robin and Unassigned may NOT use a Personal campaign (server-side, stale-client proof).
DO $$
BEGIN
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.create_import_campaign('IC RR','Personal','', NULL,
          ARRAY['ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000a2']::uuid[],
          'round_robin') $q$,
    'round robin imports cannot use a Personal campaign', 'T6a round robin + Personal rejected');

  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.create_import_campaign('IC UN','Personal','', NULL, NULL, 'unassigned') $q$,
    'unassigned imports cannot use a Personal campaign', 'T6b unassigned + Personal rejected');
END $$;

-- T7. Team participant propagation, and Team never left with an empty participant list.
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Team RR','Team','', NULL,
              ARRAY['ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000a2',
                    'ca000000-0000-0000-0000-0000000000a1']::uuid[], 'round_robin') $q$);
  PERFORM pg_temp._assert(jsonb_array_length(r->'assigned_agent_ids') = 2, 'T7a unique participants');
  PERFORM pg_temp._assert((r->>'user_id')::uuid = 'ca000000-0000-0000-0000-0000000000ad', 'T7b Team owner is creator');
  UPDATE public.campaigns SET id = 'ca000000-2222-0000-0000-000000000002' WHERE id = (r->>'id')::uuid;

  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Team UN','Team','', NULL, NULL, 'unassigned') $q$);
  PERFORM pg_temp._assert(r->'assigned_agent_ids' = '["ca000000-0000-0000-0000-0000000000ad"]'::jsonb,
                          'T7c unassigned Team falls back to the caller (D-3)');
  DELETE FROM public.campaigns WHERE id = (r->>'id')::uuid;
END $$;

-- T8. Unauthenticated / inactive callers are refused.
DO $$
BEGIN
  PERFORM pg_temp._expect_error(NULL, NULL, NULL,
    $q$ SELECT public.create_import_campaign('IC Anon','Personal','', NULL, NULL, 'myself') $q$,
    'not authenticated', 'T8 unauthenticated rejected');
END $$;

-- =====================================================================================================
-- SECTION 2 — add_leads_to_campaign: eligibility + explicit ownership
-- =====================================================================================================

-- T9. THE 106-LEAD REGRESSION. An Admin attaches AG1's leads to AG1's Personal campaign.
--     Pre-fix this returned {added:0, skipped:N}; and campaign_leads.user_id must be AG1, NOT the Admin.
DO $$
DECLARE r jsonb; n bigint;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.add_leads_to_campaign('ca000000-2222-0000-0000-000000000001',
              ARRAY['ca000000-1111-0000-0000-000000000001',
                    'ca000000-1111-0000-0000-000000000002']::uuid[]) $q$);
  PERFORM pg_temp._assert((r->>'added')::int = 2, 'T9a admin attaches to an agent-owned Personal campaign');
  PERFORM pg_temp._assert((r->>'skipped')::int = 0, 'T9b nothing skipped');

  SELECT count(*) INTO n FROM public.campaign_leads
   WHERE campaign_id = 'ca000000-2222-0000-0000-000000000001'
     AND user_id = 'ca000000-0000-0000-0000-0000000000a1';
  PERFORM pg_temp._assert(n = 2, 'T9c campaign_leads.user_id is the lead/campaign owner');

  SELECT count(*) INTO n FROM public.campaign_leads
   WHERE campaign_id = 'ca000000-2222-0000-0000-000000000001'
     AND user_id = 'ca000000-0000-0000-0000-0000000000ad';
  PERFORM pg_temp._assert(n = 0, 'T9d the Admin uuid is NEVER stamped on campaign_leads');
END $$;

-- T10. Personal eligibility: another agent's lead and an unassigned lead are both ineligible.
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.add_leads_to_campaign('ca000000-2222-0000-0000-000000000001',
              ARRAY['ca000000-1111-0000-0000-000000000004',
                    'ca000000-1111-0000-0000-000000000005']::uuid[]) $q$);
  PERFORM pg_temp._assert((r->>'added')::int = 0, 'T10a Personal rejects foreign/unassigned leads');
  PERFORM pg_temp._assert((r->>'skipped_ineligible')::int = 2, 'T10b both counted ineligible');
END $$;

-- T11. Team eligibility is driven by assigned_agent_ids; unassigned leads are eligible and STAY unassigned.
DO $$
DECLARE r jsonb; n bigint;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.add_leads_to_campaign('ca000000-2222-0000-0000-000000000002',
              ARRAY['ca000000-1111-0000-0000-000000000001',
                    'ca000000-1111-0000-0000-000000000004',
                    'ca000000-1111-0000-0000-000000000005']::uuid[]) $q$);
  PERFORM pg_temp._assert((r->>'added')::int = 3, 'T11a participants + unassigned all eligible');

  SELECT count(*) INTO n FROM public.campaign_leads
   WHERE campaign_id = 'ca000000-2222-0000-0000-000000000002'
     AND lead_id = 'ca000000-1111-0000-0000-000000000005' AND user_id IS NULL;
  PERFORM pg_temp._assert(n = 1, 'T11b unassigned lead keeps a NULL campaign_leads.user_id');

  SELECT count(*) INTO n FROM public.leads
   WHERE id = 'ca000000-1111-0000-0000-000000000005' AND assigned_agent_id IS NULL;
  PERFORM pg_temp._assert(n = 1, 'T11c unassigned lead is never prematurely assigned');
END $$;

-- T12. Team REJECTS an assigned lead outside its participant list.
DO $$
DECLARE r jsonb; c uuid;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Team Narrow','Team','', NULL,
              ARRAY['ca000000-0000-0000-0000-0000000000a2']::uuid[], 'specific_agent') $q$);
  c := (r->>'id')::uuid;
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        format($q$ SELECT public.add_leads_to_campaign(%L, ARRAY['ca000000-1111-0000-0000-000000000001']::uuid[]) $q$, c));
  PERFORM pg_temp._assert((r->>'added')::int = 0, 'T12a non-participant lead rejected');
  PERFORM pg_temp._assert((r->>'skipped_ineligible')::int = 1, 'T12b counted ineligible');
  DELETE FROM public.campaigns WHERE id = c;
END $$;

-- T13. Open Pool accepts eligible same-organization leads; cross-org leads are never found.
DO $$
DECLARE r jsonb; c uuid;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Pool','Open Pool','', NULL, NULL, 'myself') $q$);
  c := (r->>'id')::uuid;
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        format($q$ SELECT public.add_leads_to_campaign(%L,
                ARRAY['ca000000-1111-0000-0000-000000000001','ca000000-1111-0000-0000-000000000005',
                      'cb000000-1111-0000-0000-000000000001']::uuid[]) $q$, c));
  PERFORM pg_temp._assert((r->>'added')::int = 2, 'T13a Open Pool accepts same-org leads');
  PERFORM pg_temp._assert((r->>'skipped_not_found')::int = 1, 'T13b cross-org lead is not found');
  DELETE FROM public.campaigns WHERE id = c;
END $$;

-- T14. Atomic conflict-safe duplicate handling — calling twice adds nothing the second time.
DO $$
DECLARE r jsonb; n bigint;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.add_leads_to_campaign('ca000000-2222-0000-0000-000000000001',
              ARRAY['ca000000-1111-0000-0000-000000000001']::uuid[]) $q$);
  PERFORM pg_temp._assert((r->>'added')::int = 0, 'T14a duplicate add is a no-op');
  PERFORM pg_temp._assert((r->>'skipped_already_present')::int = 1, 'T14b reported as already present');

  SELECT count(*) INTO n FROM public.campaign_leads
   WHERE campaign_id = 'ca000000-2222-0000-0000-000000000001'
     AND lead_id = 'ca000000-1111-0000-0000-000000000001';
  PERFORM pg_temp._assert(n = 1, 'T14c exactly one membership row');
END $$;

-- T15. The unique index physically prevents a duplicate membership row.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.campaign_leads (campaign_id, lead_id, organization_id, status)
    VALUES ('ca000000-2222-0000-0000-000000000001','ca000000-1111-0000-0000-000000000001',
            'ca000000-0000-0000-0000-00000000000a','Queued');
    RAISE EXCEPTION 'T15 FAIL: duplicate (campaign_id, lead_id) was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

-- T16. Cross-organization campaign is rejected.
DO $$
DECLARE c uuid;
BEGIN
  INSERT INTO public.campaigns (id, name, type, status, organization_id, user_id, created_by, assigned_agent_ids)
  VALUES ('cb000000-2222-0000-0000-000000000001','IC B Pool','Open Pool','Active',
          'cb000000-0000-0000-0000-00000000000b','cb000000-0000-0000-0000-0000000000b1',
          'cb000000-0000-0000-0000-0000000000b1','[]'::jsonb);
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.add_leads_to_campaign('cb000000-2222-0000-0000-000000000001',
          ARRAY['ca000000-1111-0000-0000-000000000001']::uuid[]) $q$,
    'Campaign not found', 'T16 cross-org campaign rejected');
END $$;

-- T17. A non-owner Agent may not attach into someone else's Personal campaign.
DO $$
BEGIN
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000a2','ca000000-0000-0000-0000-00000000000a','Agent',
    $q$ SELECT public.add_leads_to_campaign('ca000000-2222-0000-0000-000000000001',
          ARRAY['ca000000-1111-0000-0000-000000000004']::uuid[]) $q$,
    'not authorized for campaign', 'T17 non-owner agent rejected');
END $$;

-- =====================================================================================================
-- SECTION 3 — provenance, finalize, retry
-- =====================================================================================================

-- Fixture import: 3 AG1 leads targeted at a NEW empty Personal campaign owned by AG1.
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Retry Target','Personal','',
              'ca000000-0000-0000-0000-0000000000a1',
              ARRAY['ca000000-0000-0000-0000-0000000000a1']::uuid[], 'specific_agent') $q$);
  UPDATE public.campaigns SET id = 'ca000000-2222-0000-0000-000000000003' WHERE id = (r->>'id')::uuid;
END $$;

INSERT INTO public.import_history
  (id, file_name, total_records, imported, duplicates, errors, agent_id, organization_id,
   campaign_id, imported_lead_ids, import_completion_status)
VALUES
  ('ca000000-3333-0000-0000-000000000001','ic-retry.csv',3,3,0,0,
   'ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a',
   'ca000000-2222-0000-0000-000000000003',
   '["ca000000-1111-0000-0000-000000000001","ca000000-1111-0000-0000-000000000002","ca000000-1111-0000-0000-000000000003"]'::jsonb,
   'pending_campaign');

-- T18. finalize with ZERO attached must be campaign_failed — NOT the old false completed_with_skips.
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.finalize_contact_import('ca000000-3333-0000-0000-000000000001') $q$);
  PERFORM pg_temp._assert(r->>'status' = 'campaign_failed', 'T18a 0/N finalizes as campaign_failed');
  PERFORM pg_temp._assert((r->>'attached_count')::int = 0, 'T18b attached_count truthful');
  PERFORM pg_temp._assert((r->>'remaining_count')::int = 3, 'T18c remaining_count truthful');
END $$;

-- T19. Retry after TOTAL failure attaches everything and recomputes completion from actual rows.
DO $$
DECLARE r jsonb; n bigint;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.retry_import_campaign_attachment('ca000000-3333-0000-0000-000000000001') $q$);
  PERFORM pg_temp._assert((r->>'ok')::boolean, 'T19a retry succeeded');
  PERFORM pg_temp._assert((r->>'newly_attached')::int = 3, 'T19b all three newly attached');
  PERFORM pg_temp._assert(r->>'status' = 'completed', 'T19c status recomputed to completed');

  SELECT count(*) INTO n FROM public.campaign_leads
   WHERE campaign_id = 'ca000000-2222-0000-0000-000000000003'
     AND import_history_id = 'ca000000-3333-0000-0000-000000000001';
  PERFORM pg_temp._assert(n = 3, 'T19d provenance preserved on the retried rows');

  SELECT count(*) INTO n FROM public.campaign_leads
   WHERE campaign_id = 'ca000000-2222-0000-0000-000000000003'
     AND user_id = 'ca000000-0000-0000-0000-0000000000a1';
  PERFORM pg_temp._assert(n = 3, 'T19e retry writes the OWNER uuid, not the Admin');

  SELECT count(*) INTO n FROM public.leads WHERE id::text LIKE 'ca000000-1111-%';
  PERFORM pg_temp._assert(n = 5, 'T19f retry never re-creates leads');
END $$;

-- T20. Double-click / concurrent idempotency — a second retry adds nothing and stays completed.
DO $$
DECLARE r jsonb; n bigint;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.retry_import_campaign_attachment('ca000000-3333-0000-0000-000000000001') $q$);
  PERFORM pg_temp._assert((r->>'newly_attached')::int = 0, 'T20a second retry is a no-op');
  PERFORM pg_temp._assert(r->>'status' = 'completed', 'T20b still completed');

  SELECT count(*) INTO n FROM public.campaign_leads
   WHERE campaign_id = 'ca000000-2222-0000-0000-000000000003';
  PERFORM pg_temp._assert(n = 3, 'T20c no duplicate campaign_leads rows');
END $$;

-- T21. Retry after PARTIAL completion attaches only the remainder.
DO $$
DECLARE r jsonb;
BEGIN
  DELETE FROM public.campaign_leads
   WHERE campaign_id = 'ca000000-2222-0000-0000-000000000003'
     AND lead_id = 'ca000000-1111-0000-0000-000000000003';
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.retry_import_campaign_attachment('ca000000-3333-0000-0000-000000000001') $q$);
  PERFORM pg_temp._assert((r->>'newly_attached')::int = 1, 'T21a only the missing lead re-attached');
  PERFORM pg_temp._assert((r->>'attached_count')::int = 3, 'T21b attached_count back to 3');
  PERFORM pg_temp._assert(r->>'status' = 'completed', 'T21c completed');
END $$;

-- T22. Retry rejects: cross-org caller, unauthorized caller, undone import, and a missing campaign.
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._as('cb000000-0000-0000-0000-0000000000b1','cb000000-0000-0000-0000-00000000000b','Agent',
        $q$ SELECT public.retry_import_campaign_attachment('ca000000-3333-0000-0000-000000000001') $q$);
  PERFORM pg_temp._assert(r->>'reason' = 'cross_org', 'T22a cross-org import rejected');

  r := pg_temp._as('ca000000-0000-0000-0000-0000000000a2','ca000000-0000-0000-0000-00000000000a','Agent',
        $q$ SELECT public.retry_import_campaign_attachment('ca000000-3333-0000-0000-000000000001') $q$);
  PERFORM pg_temp._assert(r->>'reason' = 'not_authorized', 'T22b unrelated agent rejected');

  UPDATE public.import_history SET undo_status = 'undone' WHERE id = 'ca000000-3333-0000-0000-000000000001';
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.retry_import_campaign_attachment('ca000000-3333-0000-0000-000000000001') $q$);
  PERFORM pg_temp._assert(r->>'reason' = 'already_undone', 'T22c undone import rejected');
  UPDATE public.import_history SET undo_status = NULL WHERE id = 'ca000000-3333-0000-0000-000000000001';

  UPDATE public.import_history SET campaign_id = NULL WHERE id = 'ca000000-3333-0000-0000-000000000001';
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.retry_import_campaign_attachment('ca000000-3333-0000-0000-000000000001') $q$);
  PERFORM pg_temp._assert(r->>'reason' = 'no_campaign', 'T22d import without a campaign rejected');
  UPDATE public.import_history SET campaign_id = 'ca000000-2222-0000-0000-000000000003'
   WHERE id = 'ca000000-3333-0000-0000-000000000001';
END $$;

-- T23. Forged / outside-provenance lead ids can never be attached: the retry set is server-derived.
DO $$
DECLARE n_before bigint; n_after bigint; r jsonb;
BEGIN
  SELECT count(*) INTO n_before FROM public.campaign_leads
   WHERE campaign_id = 'ca000000-2222-0000-0000-000000000003';
  -- L4 belongs to AG2 and is NOT in imported_lead_ids. No argument exists to smuggle it in.
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.retry_import_campaign_attachment('ca000000-3333-0000-0000-000000000001') $q$);
  SELECT count(*) INTO n_after FROM public.campaign_leads
   WHERE campaign_id = 'ca000000-2222-0000-0000-000000000003';
  PERFORM pg_temp._assert(n_before = n_after, 'T23a retry cannot add leads outside the import set');
  PERFORM pg_temp._assert(NOT EXISTS (
    SELECT 1 FROM public.campaign_leads
     WHERE campaign_id = 'ca000000-2222-0000-0000-000000000003'
       AND lead_id = 'ca000000-1111-0000-0000-000000000004'), 'T23b foreign lead never attached');
END $$;

-- T24. add_leads_to_campaign still refuses a lead id outside the import's provenance set.
DO $$
BEGIN
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.add_leads_to_campaign('ca000000-2222-0000-0000-000000000003',
          ARRAY['ca000000-1111-0000-0000-000000000004']::uuid[],
          'ca000000-3333-0000-0000-000000000001') $q$,
    'already finalized', 'T24 finalized import blocks the legacy tag-at-insert path');
END $$;

-- =====================================================================================================
-- SECTION 4 — Dialer scope
-- =====================================================================================================

-- T25. can_dial_campaign: Personal is OWNER-ONLY; Admin and Team Leader are refused.
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp._as('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-00000000000a','Agent',
        $q$ SELECT to_jsonb(public.can_dial_campaign('ca000000-2222-0000-0000-000000000001')) $q$);
  PERFORM pg_temp._assert(v = 'true'::jsonb, 'T25a owner may dial their Personal campaign');

  v := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT to_jsonb(public.can_dial_campaign('ca000000-2222-0000-0000-000000000001')) $q$);
  PERFORM pg_temp._assert(v = 'false'::jsonb, 'T25b Admin may NOT dial another agent Personal campaign');

  v := pg_temp._as('ca000000-0000-0000-0000-00000000001d','ca000000-0000-0000-0000-00000000000a','Team Leader',
        $q$ SELECT to_jsonb(public.can_dial_campaign('ca000000-2222-0000-0000-000000000001')) $q$);
  PERFORM pg_temp._assert(v = 'false'::jsonb, 'T25c Team Leader may NOT dial it either');

  v := pg_temp._as('ca000000-0000-0000-0000-0000000000a2','ca000000-0000-0000-0000-00000000000a','Agent',
        $q$ SELECT to_jsonb(public.can_dial_campaign('ca000000-2222-0000-0000-000000000001')) $q$);
  PERFORM pg_temp._assert(v = 'false'::jsonb, 'T25d another Agent may NOT dial it');
END $$;

-- T26. Team and Open Pool dial behaviour is unchanged.
DO $$
DECLARE v jsonb; c uuid; r jsonb;
BEGIN
  v := pg_temp._as('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-00000000000a','Agent',
        $q$ SELECT to_jsonb(public.can_dial_campaign('ca000000-2222-0000-0000-000000000002')) $q$);
  PERFORM pg_temp._assert(v = 'true'::jsonb, 'T26a Team participant may dial');

  v := pg_temp._as('ca000000-0000-0000-0000-00000000001d','ca000000-0000-0000-0000-00000000000a','Team Leader',
        $q$ SELECT to_jsonb(public.can_dial_campaign('ca000000-2222-0000-0000-000000000002')) $q$);
  PERFORM pg_temp._assert(v = 'false'::jsonb, 'T26b Team NON-participant may not dial');

  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Pool Dial','Open Pool','', NULL, NULL, 'myself') $q$);
  c := (r->>'id')::uuid;
  v := pg_temp._as('ca000000-0000-0000-0000-0000000000a2','ca000000-0000-0000-0000-00000000000a','Agent',
        format($q$ SELECT to_jsonb(public.can_dial_campaign(%L)) $q$, c));
  PERFORM pg_temp._assert(v = 'true'::jsonb, 'T26c Open Pool is org-wide');

  v := pg_temp._as('cb000000-0000-0000-0000-0000000000b1','cb000000-0000-0000-0000-00000000000b','Agent',
        format($q$ SELECT to_jsonb(public.can_dial_campaign(%L)) $q$, c));
  PERFORM pg_temp._assert(v = 'false'::jsonb, 'T26d cross-org caller refused');
  DELETE FROM public.campaigns WHERE id = c;
END $$;

-- T27. can_dial_campaign fails CLOSED for an unauthenticated caller and an unknown campaign.
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp._sys();
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT to_jsonb(public.can_dial_campaign('ca000000-2222-0000-0000-000000000001')) INTO v;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp._assert(v = 'false'::jsonb, 'T27a unauthenticated fails closed');

  v := pg_temp._as('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-00000000000a','Agent',
        $q$ SELECT to_jsonb(public.can_dial_campaign('00000000-0000-0000-0000-0000000000ff')) $q$);
  PERFORM pg_temp._assert(v = 'false'::jsonb, 'T27b unknown campaign fails closed');
END $$;

-- T28. start_dialer_session independently refuses an unauthorized Personal campaign session,
--      and still starts one for the owner.
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.start_dialer_session('ca000000-2222-0000-0000-000000000001') $q$,
    'not authorized to dial campaign', 'T28a non-owner session refused server-side');

  r := pg_temp._as('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-00000000000a','Agent',
        $q$ SELECT public.start_dialer_session('ca000000-2222-0000-0000-000000000001') $q$);
  PERFORM pg_temp._assert((r->>'campaign_id')::uuid = 'ca000000-2222-0000-0000-000000000001',
                          'T28b owner session starts normally');
END $$;

-- =====================================================================================================
-- SECTION 5 — RLS characterization + grants
-- =====================================================================================================

-- T29. CHARACTERIZATION (current behaviour, deliberately pinned, NOT changed by this work):
--      existing RLS lets a same-org Admin SELECT an agent-owned Personal campaign and its leads,
--      while a non-owner Agent sees neither. Team Leaders currently share the Admin role branch —
--      that residual DB-level read is pre-existing and is tracked as a separate security task.
DO $$
DECLARE n jsonb;
BEGIN
  n := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT to_jsonb(count(*)) FROM public.campaigns WHERE id='ca000000-2222-0000-0000-000000000001' $q$);
  PERFORM pg_temp._assert(n = '1'::jsonb, 'T29a Admin MANAGEMENT read of an agent Personal campaign');

  n := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT to_jsonb(count(*)) FROM public.campaign_leads WHERE campaign_id='ca000000-2222-0000-0000-000000000001' $q$);
  PERFORM pg_temp._assert((n#>>'{}')::int > 0, 'T29b Admin can read its campaign_leads');

  n := pg_temp._as('ca000000-0000-0000-0000-0000000000a2','ca000000-0000-0000-0000-00000000000a','Agent',
        $q$ SELECT to_jsonb(count(*)) FROM public.campaigns WHERE id='ca000000-2222-0000-0000-000000000001' $q$);
  PERFORM pg_temp._assert(n = '0'::jsonb, 'T29c non-owner Agent cannot read it');

  n := pg_temp._as('ca000000-0000-0000-0000-0000000000a2','ca000000-0000-0000-0000-00000000000a','Agent',
        $q$ SELECT to_jsonb(count(*)) FROM public.campaign_leads WHERE campaign_id='ca000000-2222-0000-0000-000000000001' $q$);
  PERFORM pg_temp._assert(n = '0'::jsonb, 'T29d non-owner Agent cannot read its campaign_leads');

  n := pg_temp._as('cb000000-0000-0000-0000-0000000000b1','cb000000-0000-0000-0000-00000000000b','Agent',
        $q$ SELECT to_jsonb(count(*)) FROM public.campaigns WHERE id='ca000000-2222-0000-0000-000000000001' $q$);
  PERFORM pg_temp._assert(n = '0'::jsonb, 'T29e cross-org read blocked');
END $$;

-- T30. Grants: PUBLIC/anon cannot execute the privileged functions; the private core is not
--      executable by authenticated at all.
DO $$
BEGIN
  PERFORM pg_temp._assert(NOT has_function_privilege('anon','public.create_import_campaign(text,text,text,uuid,uuid[],text)','EXECUTE'),           'T30a anon !create_import_campaign');
  PERFORM pg_temp._assert(NOT has_function_privilege('anon','public.retry_import_campaign_attachment(uuid)','EXECUTE'),                            'T30b anon !retry');
  PERFORM pg_temp._assert(NOT has_function_privilege('anon','public.add_leads_to_campaign(uuid,uuid[],uuid)','EXECUTE'),                           'T30c anon !add_leads');
  PERFORM pg_temp._assert(NOT has_function_privilege('anon','public.can_dial_campaign(uuid)','EXECUTE'),                                           'T30d anon !can_dial');
  PERFORM pg_temp._assert(NOT has_function_privilege('anon','public.finalize_contact_import(uuid)','EXECUTE'),                                     'T30e anon !finalize');

  PERFORM pg_temp._assert(NOT has_function_privilege('authenticated','private.attach_leads_to_campaign_core(uuid,uuid[],uuid)','EXECUTE'),         'T30f authenticated !core');
  PERFORM pg_temp._assert(NOT has_function_privilege('anon','private.attach_leads_to_campaign_core(uuid,uuid[],uuid)','EXECUTE'),                  'T30g anon !core');
  PERFORM pg_temp._assert(NOT has_function_privilege('authenticated','private.campaign_actor()','EXECUTE'),                                        'T30h authenticated !campaign_actor');
  PERFORM pg_temp._assert(NOT has_function_privilege('authenticated','private.can_administer_campaign(uuid)','EXECUTE'),                           'T30i authenticated !can_administer');
  PERFORM pg_temp._assert(NOT has_function_privilege('authenticated','private.import_attachment_status(uuid,uuid,uuid[])','EXECUTE'),              'T30j authenticated !attachment_status');
  PERFORM pg_temp._assert(NOT has_function_privilege('authenticated','private.assert_may_assign_to(uuid,text,boolean,uuid,uuid)','EXECUTE'),       'T30k authenticated !assert_may_assign_to');
  PERFORM pg_temp._assert(NOT has_function_privilege('authenticated','private.assert_import_set_campaign_compatible(uuid,uuid[])','EXECUTE'),        'T30k2 authenticated !assert_import_set');
  PERFORM pg_temp._assert(NOT has_function_privilege('anon','private.assert_import_set_campaign_compatible(uuid,uuid[])','EXECUTE'),                 'T30k3 anon !assert_import_set');

  PERFORM pg_temp._assert(has_function_privilege('authenticated','public.create_import_campaign(text,text,text,uuid,uuid[],text)','EXECUTE'),      'T30l authenticated CAN create_import_campaign');
  PERFORM pg_temp._assert(has_function_privilege('authenticated','public.retry_import_campaign_attachment(uuid)','EXECUTE'),                       'T30m authenticated CAN retry');
  PERFORM pg_temp._assert(has_function_privilege('authenticated','public.can_dial_campaign(uuid)','EXECUTE'),                                      'T30n authenticated CAN can_dial');

  -- start_dialer_session had PUBLIC + anon EXECUTE before this change set (CREATE OR REPLACE
  -- does NOT reset an ACL, so M3 revokes them explicitly).
  PERFORM pg_temp._assert(NOT has_function_privilege('anon','public.start_dialer_session(uuid)','EXECUTE'),                                        'T30o anon !start_dialer_session');
  PERFORM pg_temp._assert(has_function_privilege('authenticated','public.start_dialer_session(uuid)','EXECUTE'),                                   'T30p authenticated CAN start_dialer_session');
END $$;

-- T30q. No privileged function may retain a PUBLIC grant. Checked against pg_proc.proacl
-- directly (a NULL acl means the built-in default, which for functions INCLUDES PUBLIC),
-- and across EVERY overload of each name so a stray signature cannot keep default grants.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text || ' [' || COALESCE(array_to_string(p.proacl, ' '), 'NULL-acl=PUBLIC-default') || ']', ', ')
    INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname, p.proname) IN (
          ('public','create_import_campaign'), ('public','retry_import_campaign_attachment'),
          ('public','can_dial_campaign'), ('public','add_leads_to_campaign'),
          ('public','finalize_contact_import'), ('public','start_dialer_session'),
          ('private','attach_leads_to_campaign_core'), ('private','campaign_actor'),
          ('private','can_administer_campaign'), ('private','import_attachment_status'),
          ('private','assert_may_assign_to'), ('private','assert_import_set_campaign_compatible'))
    AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=%'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'T30q FAIL: PUBLIC still holds EXECUTE on: %', bad;
  END IF;
END $$;

-- T30r. Every private helper has EXACTLY the expected number of overloads, so no unintended
-- signature can survive with default grants.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
   WHERE nsp.nspname='private' AND p.proname='attach_leads_to_campaign_core';
  PERFORM pg_temp._assert(n = 1, 'T30r single attach core overload');

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
   WHERE nsp.nspname='public' AND p.proname='add_leads_to_campaign';
  PERFORM pg_temp._assert(n = 1, 'T30s single add_leads_to_campaign overload');

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
   WHERE nsp.nspname='public' AND p.proname='create_import_campaign';
  PERFORM pg_temp._assert(n = 1, 'T30t single create_import_campaign overload');
END $$;

-- T31. Every new/changed function is SECURITY DEFINER with the RESTRICTIVE pinned search_path
--      `pg_catalog, pg_temp`. No writable application schema (public/private) may appear in a
--      privileged function's search path — every referenced object is schema-qualified instead.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text || ' [' ||
                    COALESCE(array_to_string(p.proconfig, ' '), 'NO-proconfig') || ']', ', ')
    INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname, p.proname) IN (
          ('public','create_import_campaign'), ('public','retry_import_campaign_attachment'),
          ('public','can_dial_campaign'), ('public','add_leads_to_campaign'),
          ('public','finalize_contact_import'), ('public','start_dialer_session'),
          ('private','attach_leads_to_campaign_core'), ('private','campaign_actor'),
          ('private','can_administer_campaign'), ('private','import_attachment_status'),
          ('private','assert_may_assign_to'), ('private','assert_import_set_campaign_compatible'))
    AND (p.prosecdef IS NOT TRUE
         OR p.proconfig IS NULL
         OR NOT EXISTS (
              SELECT 1 FROM unnest(p.proconfig) c
               WHERE c = 'search_path=pg_catalog, pg_temp'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'T31 FAIL: not SECURITY DEFINER with search_path=pg_catalog, pg_temp: %', bad;
  END IF;
END $$;

-- T32. Backward compatibility: the generic two-argument call keeps its contract and response keys.
DO $$
DECLARE r jsonb; c uuid;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Compat','Open Pool','', NULL, NULL, 'myself') $q$);
  c := (r->>'id')::uuid;
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        format($q$ SELECT public.add_leads_to_campaign(%L, ARRAY['ca000000-1111-0000-0000-000000000004']::uuid[]) $q$, c));
  PERFORM pg_temp._assert(r ? 'added',       'T32a response keeps "added"');
  PERFORM pg_temp._assert(r ? 'skipped',     'T32b response keeps "skipped"');
  PERFORM pg_temp._assert(r ? 'skipped_ids', 'T32c response keeps "skipped_ids"');
  PERFORM pg_temp._assert(jsonb_typeof(r->'skipped_ids') = 'array', 'T32d skipped_ids is an array');
  PERFORM pg_temp._assert((r->>'added')::int = 1, 'T32e two-arg call still attaches');
  DELETE FROM public.campaigns WHERE id = c;
END $$;

-- =====================================================================================================
-- SECTION 6 — PR #352 corrective pass
-- =====================================================================================================

-- T33. SAVED/RESUMED SESSION AUTHORIZATION (review item 1).
--      AG1 owns Personal campaign ca000000-2222-…0001 and has an active session for it.
--      The Admin must not be able to resume it, with or without naming a campaign.
DO $$
DECLARE r jsonb; v_sid uuid; v_pool uuid;
BEGIN
  -- AG1 legitimately starts a session for their own Personal campaign.
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-00000000000a','Agent',
        $q$ SELECT public.start_dialer_session('ca000000-2222-0000-0000-000000000001') $q$);
  v_sid := (r->>'id')::uuid;
  PERFORM pg_temp._assert(v_sid IS NOT NULL, 'T33a owner session created');

  -- Re-point that active session at the Admin so the Admin has an active session for a campaign
  -- they may NOT dial (this is the shape a stale/saved session takes).
  UPDATE public.dialer_sessions SET agent_id = 'ca000000-0000-0000-0000-0000000000ad' WHERE id = v_sid;

  -- (1) start_dialer_session(NULL) must NOT resume an unauthorized Personal session.
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.start_dialer_session(NULL) $q$,
    'not authorized to resume dialer session', 'T33b NULL request cannot resume an unauthorized session');

  -- (2) An AUTHORIZED requested campaign must not be satisfied by an unauthorized active session.
  -- Fixture correction (2026-08-10): Team campaign ca000000-2222-…0002's participants are AG1/AG2,
  -- so the Admin was never authorized to dial it and the front dial-gate fired before the resume
  -- branch (T26b itself asserts Team non-participants may not dial). Create a bounded same-org
  -- Open Pool campaign through the REAL RPC as the Admin — genuinely Admin-dialable (Open Pool =
  -- same-organization) — request THAT, and clean it up in-transaction. The T33c requirement is
  -- unchanged: the stale unauthorized Personal session must not satisfy an authorized request.
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Pool T33c','Open Pool','', NULL, NULL, 'myself') $q$);
  v_pool := (r->>'id')::uuid;
  PERFORM pg_temp._assert(v_pool IS NOT NULL, 'T33c fixture: Admin-dialable Open Pool campaign created');
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    format($q$ SELECT public.start_dialer_session(%L) $q$, v_pool),
    'not authorized to resume dialer session', 'T33c authorized request cannot resume an unauthorized session');
  DELETE FROM public.campaigns WHERE id = v_pool;

  DELETE FROM public.dialer_sessions WHERE id = v_sid;
END $$;

-- T34. Mismatched active/requested campaign is not silently reused; a matching one still is.
DO $$
DECLARE r jsonb; v_sid uuid;
BEGIN
  -- AG1 participates in the Team campaign and owns the Personal one — both dialable by AG1.
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-00000000000a','Agent',
        $q$ SELECT public.start_dialer_session('ca000000-2222-0000-0000-000000000001') $q$);
  v_sid := (r->>'id')::uuid;

  -- (3) Requesting a DIFFERENT (still authorized) campaign must not return the existing session.
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-00000000000a','Agent',
    $q$ SELECT public.start_dialer_session('ca000000-2222-0000-0000-000000000002') $q$,
    'active dialer session belongs to campaign', 'T34a mismatched campaign is not silently reused');

  -- (4) The MATCHING authorized active session is still reusable, and is the same row.
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-00000000000a','Agent',
        $q$ SELECT public.start_dialer_session('ca000000-2222-0000-0000-000000000001') $q$);
  PERFORM pg_temp._assert((r->>'id')::uuid = v_sid, 'T34b matching authorized session reused');

  -- The session was never ended or rewritten by the refusals above.
  PERFORM pg_temp._assert(
    (SELECT status FROM public.dialer_sessions WHERE id = v_sid) = 'active',
    'T34c refusals do not end or mutate the session');

  DELETE FROM public.dialer_sessions WHERE id = v_sid;
END $$;

-- T35. TEAM MANAGEMENT AUTHORIZATION (review item 2 / item 4).
--      The REQUIRED case: a same-org, NON-PARTICIPANT AGENT may not mutate an unrelated Team
--      campaign — including with an unassigned lead (eligible by campaign rules, irrelevant to
--      authorization). A same-org LISTED participant Agent remains authorized.
DO $$
DECLARE c uuid; r jsonb;
BEGIN
  -- A Team campaign whose ONLY participant is AG1. AG2 is a same-org Agent but NOT a participant.
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Team AG1-only','Team','', NULL,
              ARRAY['ca000000-0000-0000-0000-0000000000a1']::uuid[], 'specific_agent') $q$);
  c := (r->>'id')::uuid;

  -- (1) Same-org non-participant AGENT — the exact case the old T35 did NOT cover.
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000a2','ca000000-0000-0000-0000-00000000000a','Agent',
    format($q$ SELECT public.add_leads_to_campaign(%L, ARRAY['ca000000-1111-0000-0000-000000000005']::uuid[]) $q$, c),
    'not authorized for campaign', 'T35a same-org non-participant Agent cannot attach an unassigned lead');

  -- (2) The same lead, same campaign, but as the LISTED participant AG1 — authorized.
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-00000000000a','Agent',
        format($q$ SELECT public.add_leads_to_campaign(%L, ARRAY['ca000000-1111-0000-0000-000000000005']::uuid[]) $q$, c));
  PERFORM pg_temp._assert((r->>'added')::int = 1, 'T35b listed participant Agent may attach');

  -- A non-participant Team Leader is likewise rejected (fail-closed hierarchy), and cross-org too.
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-00000000001d','ca000000-0000-0000-0000-00000000000a','Team Leader',
    format($q$ SELECT public.add_leads_to_campaign(%L, ARRAY['ca000000-1111-0000-0000-000000000003']::uuid[]) $q$, c),
    'not authorized for campaign', 'T35c non-participant TL rejected');
  PERFORM pg_temp._expect_error('cb000000-0000-0000-0000-0000000000b1','cb000000-0000-0000-0000-00000000000b','Agent',
    format($q$ SELECT public.add_leads_to_campaign(%L, ARRAY['ca000000-1111-0000-0000-000000000005']::uuid[]) $q$, c),
    'Campaign not found', 'T35d cross-org agent rejected');

  DELETE FROM public.campaigns WHERE id = c;
END $$;

-- T36. A LISTED PARTICIPANT may still manage the Team campaign they participate in.
DO $$
DECLARE r jsonb; c uuid;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Team Participant','Team','', NULL,
              ARRAY['ca000000-0000-0000-0000-0000000000a1']::uuid[], 'specific_agent') $q$);
  c := (r->>'id')::uuid;
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-00000000000a','Agent',
        format($q$ SELECT public.add_leads_to_campaign(%L, ARRAY['ca000000-1111-0000-0000-000000000005']::uuid[]) $q$, c));
  PERFORM pg_temp._assert((r->>'added')::int = 1, 'T36 listed participant may attach');
  DELETE FROM public.campaigns WHERE id = c;
END $$;

-- T37. STRICT STRATEGY CONTRACT (review item 3).
DO $$
BEGIN
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.create_import_campaign('IC S1','Personal','',
          'ca000000-0000-0000-0000-0000000000a1', NULL, 'myself') $q$,
    'cannot create a Personal campaign owned by another user', 'T37a myself + another owner rejected');

  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.create_import_campaign('IC S2','Team','', NULL,
          ARRAY['ca000000-0000-0000-0000-0000000000a1']::uuid[], 'myself') $q$,
    'cannot name other Team participants', 'T37b myself Team with other participants rejected');

  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.create_import_campaign('IC S3','Team','', NULL,
          ARRAY['ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000a2']::uuid[],
          'specific_agent') $q$,
    'requires exactly one Team participant', 'T37c specific_agent Team with 2 participants rejected');

  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.create_import_campaign('IC S4','Team','', NULL,
          ARRAY['ca000000-0000-0000-0000-0000000000a1']::uuid[], 'unassigned') $q$,
    'cannot name Team participants', 'T37d unassigned Team with an arbitrary participant rejected');

  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.create_import_campaign('IC S5','Open Pool','', NULL,
          ARRAY['ca000000-0000-0000-0000-0000000000a1']::uuid[], 'myself') $q$,
    'does not take a participant list', 'T37e Open Pool with participants rejected');

  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.create_import_campaign('IC S6','Team','', NULL, NULL, 'round_robin') $q$,
    'requires at least one Team participant', 'T37f round_robin Team with no participants rejected');
END $$;

-- T38. IMPORT-SET ROUTING PRECHECK (review item 3) — nothing is inserted when the campaign is
--      structurally incompatible with the imported routing set.
DO $$
DECLARE c uuid; r jsonb; n_before bigint; n_after bigint;
BEGIN
  -- A Personal campaign owned by AG1, and an import whose set mixes AG1 + AG2 leads.
  INSERT INTO public.import_history
    (id, file_name, total_records, imported, duplicates, errors, agent_id, organization_id,
     campaign_id, imported_lead_ids, import_completion_status)
  VALUES
    ('ca000000-3333-0000-0000-000000000002','ic-mixed.csv',2,2,0,0,
     'ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a',
     'ca000000-2222-0000-0000-000000000001',
     '["ca000000-1111-0000-0000-000000000001","ca000000-1111-0000-0000-000000000004"]'::jsonb,
     'pending_campaign');

  SELECT count(*) INTO n_before FROM public.campaign_leads
   WHERE campaign_id = 'ca000000-2222-0000-0000-000000000001';

  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    $q$ SELECT public.add_leads_to_campaign('ca000000-2222-0000-0000-000000000001',
          ARRAY['ca000000-1111-0000-0000-000000000001','ca000000-1111-0000-0000-000000000004']::uuid[],
          'ca000000-3333-0000-0000-000000000002') $q$,
    'owned by 2 different agents', 'T38a Personal rejects a multi-owner imported set');

  SELECT count(*) INTO n_after FROM public.campaign_leads
   WHERE campaign_id = 'ca000000-2222-0000-0000-000000000001';
  PERFORM pg_temp._assert(n_before = n_after, 'T38b nothing was inserted before the refusal');

  DELETE FROM public.import_history WHERE id = 'ca000000-3333-0000-0000-000000000002';
END $$;

-- T39. NON-OVERLAPPING PARTITION (review item 4) — identity holds and provenance separates
--      "attached by this import" from "already present".
DO $$
DECLARE r jsonb; v_imp uuid := 'ca000000-3333-0000-0000-000000000003'; c uuid;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Partition','Open Pool','', NULL, NULL, 'myself') $q$);
  c := (r->>'id')::uuid;

  -- One lead is already a member via a NON-import path (import_history_id IS NULL).
  INSERT INTO public.campaign_leads (campaign_id, lead_id, organization_id, status, user_id)
  VALUES (c, 'ca000000-1111-0000-0000-000000000002','ca000000-0000-0000-0000-00000000000a','Queued',
          'ca000000-0000-0000-0000-0000000000a1');

  INSERT INTO public.import_history
    (id, file_name, total_records, imported, duplicates, errors, agent_id, organization_id,
     campaign_id, imported_lead_ids, import_completion_status)
  VALUES
    (v_imp,'ic-partition.csv',3,3,0,0,
     'ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a', c,
     '["ca000000-1111-0000-0000-000000000001","ca000000-1111-0000-0000-000000000002","ca000000-1111-0000-0000-000000000003"]'::jsonb,
     'pending_campaign');

  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        format($q$ SELECT public.retry_import_campaign_attachment(%L) $q$, v_imp));

  PERFORM pg_temp._assert((r->>'ok')::boolean, 'T39a retry ok');
  PERFORM pg_temp._assert((r->>'attached_count')::int = 2, 'T39b two attached BY THIS IMPORT');
  PERFORM pg_temp._assert((r->>'already_present')::int = 1, 'T39c one already present (non-import row)');
  PERFORM pg_temp._assert((r->>'ineligible_count')::int = 0, 'T39d none ineligible');
  PERFORM pg_temp._assert((r->>'remaining_count')::int = 0, 'T39e none remaining');
  -- PARTITION IDENTITY: imported = attached + already_present + ineligible + remaining
  PERFORM pg_temp._assert(
    (r->>'imported_count')::int
      = (r->>'attached_count')::int + (r->>'already_present')::int
      + (r->>'ineligible_count')::int + (r->>'remaining_count')::int,
    'T39f partition identity holds');
  PERFORM pg_temp._assert(r->>'status' = 'completed', 'T39g status completed');

  DELETE FROM public.import_history WHERE id = v_imp;
  DELETE FROM public.campaigns WHERE id = c;
END $$;

-- T40. An import with NO campaign has NO attachment dimension at all.
DO $$
DECLARE r jsonb; v_imp uuid := 'ca000000-3333-0000-0000-000000000004';
BEGIN
  INSERT INTO public.import_history
    (id, file_name, total_records, imported, duplicates, errors, agent_id, organization_id,
     campaign_id, imported_lead_ids, import_completion_status)
  VALUES
    (v_imp,'ic-nocampaign.csv',1,1,0,0,
     'ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a', NULL,
     '["ca000000-1111-0000-0000-000000000001"]'::jsonb, 'pending_campaign');

  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        format($q$ SELECT public.finalize_contact_import(%L) $q$, v_imp));

  PERFORM pg_temp._assert(r->>'status' = 'completed', 'T40a no-campaign import is completed');
  PERFORM pg_temp._assert((r->>'has_campaign')::boolean IS FALSE, 'T40b has_campaign false');
  PERFORM pg_temp._assert(jsonb_typeof(r->'attached_count') = 'null', 'T40c attached_count is NULL');
  PERFORM pg_temp._assert(jsonb_typeof(r->'already_present') = 'null', 'T40d already_present is NULL');
  PERFORM pg_temp._assert(jsonb_typeof(r->'remaining_count') = 'null', 'T40e remaining_count is NULL');

  DELETE FROM public.import_history WHERE id = v_imp;
END $$;

-- =====================================================================================================
-- SECTION 7 — PR #352 corrective pass #3 (full-immutable-set validation + envelope completeness)
-- =====================================================================================================

-- T41. FULL-SET validation, not the current batch (review item 2). The provenance set mixes AG1
--      and AG2, but the call passes ONLY the compatible AG1 subset as p_lead_ids (the "first
--      batch"). Before the fix this attached the AG1 lead; now it is refused, nothing inserted.
DO $$
DECLARE r jsonb; c uuid; v_imp uuid := 'ca000000-3333-0000-0000-000000000005'; n_before bigint; n_after bigint;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC FullSet','Personal','',
              'ca000000-0000-0000-0000-0000000000a1',
              ARRAY['ca000000-0000-0000-0000-0000000000a1']::uuid[], 'specific_agent') $q$);
  c := (r->>'id')::uuid;

  INSERT INTO public.import_history
    (id, file_name, total_records, imported, duplicates, errors, agent_id, organization_id,
     campaign_id, imported_lead_ids, import_completion_status)
  VALUES
    (v_imp,'ic-fullset.csv',2,2,0,0,
     'ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a', c,
     -- FULL immutable set: AG1 lead + AG2 lead (incompatible for AG1's Personal campaign).
     '["ca000000-1111-0000-0000-000000000001","ca000000-1111-0000-0000-000000000004"]'::jsonb,
     'pending_campaign');

  SELECT count(*) INTO n_before FROM public.campaign_leads WHERE campaign_id = c;

  -- p_lead_ids is ONLY the compatible AG1 subset — the "first batch". Must still be refused.
  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    format($q$ SELECT public.add_leads_to_campaign(%L,
             ARRAY['ca000000-1111-0000-0000-000000000001']::uuid[], %L) $q$, c, v_imp),
    'owned by 2 different agents', 'T41a compatible first batch of an incompatible full set is refused');

  SELECT count(*) INTO n_after FROM public.campaign_leads WHERE campaign_id = c;
  PERFORM pg_temp._assert(n_before = n_after, 'T41b nothing inserted (no partial attach)');

  DELETE FROM public.import_history WHERE id = v_imp;
  DELETE FROM public.campaigns WHERE id = c;
END $$;

-- T42. A simulated import EXCEEDING the 500-row client batch cannot partially attach its first
--      compatible batch. Provenance = 501 AG1 leads + 1 AG2 lead (502); p_lead_ids = the first 500
--      AG1 leads (a fully compatible batch). Full-set validation still refuses; 0 rows inserted.
DO $$
DECLARE
  r jsonb; c uuid; v_imp uuid := 'ca000000-3333-0000-0000-000000000006';
  v_ids uuid[] := ARRAY[]::uuid[]; v_ag2 uuid; v_batch uuid[]; n_after bigint; i int;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC Batch500','Personal','',
              'ca000000-0000-0000-0000-0000000000a1',
              ARRAY['ca000000-0000-0000-0000-0000000000a1']::uuid[], 'specific_agent') $q$);
  c := (r->>'id')::uuid;

  -- 501 AG1-owned leads.
  FOR i IN 1..501 LOOP
    INSERT INTO public.leads (organization_id, first_name, last_name, phone, email, state,
                              assigned_agent_id, status)
    VALUES ('ca000000-0000-0000-0000-00000000000a','Batch', i::text, '555'||lpad(i::text,7,'0'),
            'b'||i||'@ictest.invalid','TX','ca000000-0000-0000-0000-0000000000a1','New')
    RETURNING id INTO v_ag2;   -- reuse v_ag2 as scratch
    v_ids := array_append(v_ids, v_ag2);
  END LOOP;
  -- 1 AG2-owned lead makes the FULL set incompatible with AG1's Personal campaign.
  INSERT INTO public.leads (organization_id, first_name, last_name, phone, email, state,
                            assigned_agent_id, status)
  VALUES ('ca000000-0000-0000-0000-00000000000a','Batch','AG2','5559999999',
          'bag2@ictest.invalid','TX','ca000000-0000-0000-0000-0000000000a2','New')
  RETURNING id INTO v_ag2;
  v_ids := array_append(v_ids, v_ag2);

  INSERT INTO public.import_history
    (id, file_name, total_records, imported, duplicates, errors, agent_id, organization_id,
     campaign_id, imported_lead_ids, import_completion_status)
  VALUES
    (v_imp,'ic-batch500.csv',502,502,0,0,
     'ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a', c,
     to_jsonb(v_ids), 'pending_campaign');

  v_batch := v_ids[1:500];   -- the first 500, all AG1, a fully compatible batch

  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    format($q$ SELECT public.add_leads_to_campaign(%L, %L::uuid[], %L) $q$, c, v_batch, v_imp),
    'owned by 2 different agents', 'T42a first 500-row compatible batch of a 502-row incompatible import is refused');

  SELECT count(*) INTO n_after FROM public.campaign_leads WHERE campaign_id = c;
  PERFORM pg_temp._assert(n_after = 0, 'T42b zero rows inserted despite a compatible first batch');

  DELETE FROM public.import_history WHERE id = v_imp;
  DELETE FROM public.campaign_leads WHERE lead_id = ANY (v_ids);
  DELETE FROM public.leads WHERE id = ANY (v_ids);
  DELETE FROM public.campaigns WHERE id = c;
END $$;

-- T43. Retry refuses an incompatible immutable set before inserting anything (review item 2).
DO $$
DECLARE r jsonb; c uuid; v_imp uuid := 'ca000000-3333-0000-0000-000000000007'; n_after bigint;
BEGIN
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC RetryFullSet','Personal','',
              'ca000000-0000-0000-0000-0000000000a1',
              ARRAY['ca000000-0000-0000-0000-0000000000a1']::uuid[], 'specific_agent') $q$);
  c := (r->>'id')::uuid;

  INSERT INTO public.import_history
    (id, file_name, total_records, imported, duplicates, errors, agent_id, organization_id,
     campaign_id, imported_lead_ids, import_completion_status)
  VALUES
    (v_imp,'ic-retry-fullset.csv',2,2,0,0,
     'ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a', c,
     '["ca000000-1111-0000-0000-000000000001","ca000000-1111-0000-0000-000000000004"]'::jsonb,
     'campaign_failed');

  PERFORM pg_temp._expect_error('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    format($q$ SELECT public.retry_import_campaign_attachment(%L) $q$, v_imp),
    'owned by 2 different agents', 'T43a retry refuses an incompatible full set');

  SELECT count(*) INTO n_after FROM public.campaign_leads WHERE campaign_id = c;
  PERFORM pg_temp._assert(n_after = 0, 'T43b retry inserted nothing');

  DELETE FROM public.import_history WHERE id = v_imp;
  DELETE FROM public.campaigns WHERE id = c;
END $$;

-- T44. IDEMPOTENT finalize returns the COMPLETE partition (review item 3), same as a fresh finalize.
DO $$
DECLARE r1 jsonb; r2 jsonb; c uuid; v_imp uuid := 'ca000000-3333-0000-0000-000000000008';
BEGIN
  r1 := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC IdemFinal','Open Pool','', NULL, NULL, 'myself') $q$);
  c := (r1->>'id')::uuid;

  INSERT INTO public.import_history
    (id, file_name, total_records, imported, duplicates, errors, agent_id, organization_id,
     campaign_id, imported_lead_ids, import_completion_status)
  VALUES
    (v_imp,'ic-idem.csv',2,2,0,0,
     'ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a', c,
     '["ca000000-1111-0000-0000-000000000001","ca000000-1111-0000-0000-000000000002"]'::jsonb,
     'pending_campaign');

  -- Attach both via the RPC, then finalize (fresh), then finalize again (idempotent).
  PERFORM pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    format($q$ SELECT public.add_leads_to_campaign(%L,
             ARRAY['ca000000-1111-0000-0000-000000000001','ca000000-1111-0000-0000-000000000002']::uuid[], %L) $q$, c, v_imp));

  r1 := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        format($q$ SELECT public.finalize_contact_import(%L) $q$, v_imp));
  r2 := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        format($q$ SELECT public.finalize_contact_import(%L) $q$, v_imp));

  PERFORM pg_temp._assert((r2->>'idempotent')::boolean, 'T44a second finalize is idempotent');
  -- Complete partition present on the idempotent call.
  PERFORM pg_temp._assert((r2 ? 'has_campaign') AND (r2 ? 'imported_count')
                          AND (r2 ? 'attached_count') AND (r2 ? 'already_present')
                          AND (r2 ? 'ineligible_count') AND (r2 ? 'remaining_count')
                          AND (r2 ? 'tagged_count'), 'T44b idempotent finalize returns the full partition');
  PERFORM pg_temp._assert((r2->>'attached_count')::int = (r1->>'attached_count')::int
                          AND (r2->>'imported_count')::int = (r1->>'imported_count')::int,
                          'T44c idempotent partition equals the fresh one');
  PERFORM pg_temp._assert(
    (r2->>'imported_count')::int = (r2->>'attached_count')::int + (r2->>'already_present')::int
      + (r2->>'ineligible_count')::int + (r2->>'remaining_count')::int,
    'T44d idempotent partition identity holds');

  DELETE FROM public.import_history WHERE id = v_imp;
  DELETE FROM public.campaign_leads WHERE campaign_id = c;
  DELETE FROM public.campaigns WHERE id = c;
END $$;

-- T45. ONE fixture exercising ALL FOUR categories together, proving the partition identity.
--      Imported set of 4 into a Team campaign:
--        L1 (AG1) attached BY this import · L2 (AG1) already present via a non-import row ·
--        L3 (AG1) eligible & not attached -> remaining · L4 (AG2) -> ineligible.
--
--      The full-set compatibility guard rejects an AG2 lead against an AG1-only Team campaign, so
--      the fixture attaches L1 while AG2 is STILL a valid participant, then narrows the campaign's
--      participants to {AG1} before finalize — a transactional fixture mutation that never weakens
--      the production guard. `assigned_agent_ids` is not one of the columns the campaign-settings
--      edit trigger guards, so the direct UPDATE is permitted.
DO $$
DECLARE r jsonb; c uuid; v_imp uuid := 'ca000000-3333-0000-0000-000000000009';
BEGIN
  -- (1) Team campaign with BOTH AG1 and AG2 as valid participants (round_robin allows a set).
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        $q$ SELECT public.create_import_campaign('IC FourCats','Team','', NULL,
              ARRAY['ca000000-0000-0000-0000-0000000000a1','ca000000-0000-0000-0000-0000000000a2']::uuid[],
              'round_robin') $q$);
  c := (r->>'id')::uuid;

  -- (2) Import-history fixture with L1-L4 (L4 is AG2-owned; valid while AG2 is a participant).
  INSERT INTO public.import_history
    (id, file_name, total_records, imported, duplicates, errors, agent_id, organization_id,
     campaign_id, imported_lead_ids, import_completion_status)
  VALUES
    (v_imp,'ic-fourcats.csv',4,4,0,0,
     'ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a', c,
     '["ca000000-1111-0000-0000-000000000001","ca000000-1111-0000-0000-000000000002","ca000000-1111-0000-0000-000000000003","ca000000-1111-0000-0000-000000000004"]'::jsonb,
     'pending_campaign');

  -- (3) attached-by-import: L1 (AG1) through the real import-tagged RPC. The full-set guard passes
  --     because AG2 is still a participant at this point.
  PERFORM pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
    format($q$ SELECT public.add_leads_to_campaign(%L, ARRAY['ca000000-1111-0000-0000-000000000001']::uuid[], %L) $q$, c, v_imp));

  -- (4) already-present (non-import row): L2, import_history_id NULL.
  INSERT INTO public.campaign_leads (campaign_id, lead_id, organization_id, status, user_id)
  VALUES (c, 'ca000000-1111-0000-0000-000000000002','ca000000-0000-0000-0000-00000000000a','Queued',
          'ca000000-0000-0000-0000-0000000000a1');

  -- (5) Narrow participants to {AG1} so L4 (AG2) becomes ineligible. Fixture-only mutation; the
  --     production compatibility guard is untouched. Done as the seeding role (no jwt claims).
  PERFORM pg_temp._sys();
  UPDATE public.campaigns SET assigned_agent_ids = '["ca000000-0000-0000-0000-0000000000a1"]'::jsonb
   WHERE id = c;

  -- (6) L3 (AG1) left unattached -> remaining. L4 (AG2) no longer a participant -> ineligible.
  r := pg_temp._as('ca000000-0000-0000-0000-0000000000ad','ca000000-0000-0000-0000-00000000000a','Admin',
        format($q$ SELECT public.finalize_contact_import(%L) $q$, v_imp));

  PERFORM pg_temp._assert((r->>'attached_count')::int = 1, 'T45a attached=1');
  PERFORM pg_temp._assert((r->>'already_present')::int = 1, 'T45b already_present=1');
  PERFORM pg_temp._assert((r->>'remaining_count')::int = 1, 'T45c remaining=1');
  PERFORM pg_temp._assert((r->>'ineligible_count')::int = 1, 'T45d ineligible=1');
  PERFORM pg_temp._assert(
    (r->>'imported_count')::int = (r->>'attached_count')::int + (r->>'already_present')::int
      + (r->>'ineligible_count')::int + (r->>'remaining_count')::int,
    'T45e four-category partition identity holds (4 = 1+1+1+1)');
  PERFORM pg_temp._assert(r->>'status' = 'campaign_partial', 'T45f status is campaign_partial');

  DELETE FROM public.import_history WHERE id = v_imp;
  DELETE FROM public.campaign_leads WHERE campaign_id = c;
  DELETE FROM public.campaigns WHERE id = c;
END $$;

DO $$ BEGIN RAISE NOTICE 'import_campaign_attachment.sql — ALL ASSERTIONS PASSED'; END $$;

ROLLBACK;
