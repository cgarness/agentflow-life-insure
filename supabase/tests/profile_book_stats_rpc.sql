-- =====================================================================================================
-- Agent Profile / Team Profile aggregate RPCs — SQL behaviour suite.
-- STATUS: run ONLY on a disposable LOCAL PostgreSQL database (AGENT_RULES invariant #28).
-- Driver: scripts/run_profile_rpc_tests.sh. Requires supabase/tests/profile_stats_harness.sql, then
-- supabase/migrations/20260919210000_profile_book_and_team_stats_rpcs.sql, applied in that order.
-- =====================================================================================================
-- Every fixture below is SYNTHETIC. No production row is read, copied or referenced.
--
-- FIXTURE MAP (ORG_A unless stated)
--   LEADER        Team Leader, root of the hierarchy, owns the four book-of-business clients
--   CHILD1        Agent,  upline LEADER          owns 1 client (premium 10)
--   GRAND1        Agent,  upline CHILD1          owns 1 client (premium 20)
--   DELETED_MID   Agent,  upline LEADER, status='Deleted'   (traversed THROUGH, excluded FROM scope)
--   BELOW_DEL     Agent,  upline DELETED_MID     owns 1 client (premium 40)  <- must survive
--   PEER          Agent,  upline ADMIN           owns 1 client (premium 80)  <- must NOT appear
--   ADMIN         Admin,  upline NULL
--   CYC_A <-> CYC_B   mutual upline pair, unreachable from LEADER   (cycle termination)
--   SELFLOOP      upline_id = its own id                            (self-edge termination)
--   ORG_B/FOREIGN Agent in ORG_B whose upline_id points at LEADER   (cross-org edge)
--   ORG_B/FOR_CLI client owned by FOREIGN                           (must never be counted)
-- =====================================================================================================

\set ON_ERROR_STOP on
\set QUIET 1

-- ── Fixture ids ────────────────────────────────────────────────────────────────────────────────
\set ORG_A      '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set ORG_B      '''bbbbbbbb-0000-0000-0000-00000000000b'''
\set LEADER     '''aaaaaaaa-0000-0000-0000-0000000000f1'''
\set CHILD1     '''aaaaaaaa-0000-0000-0000-0000000000c1'''
\set GRAND1     '''aaaaaaaa-0000-0000-0000-0000000000ab'''
\set DELMID     '''aaaaaaaa-0000-0000-0000-0000000000d1'''
\set BELOWDEL   '''aaaaaaaa-0000-0000-0000-0000000000b1'''
\set PEER       '''aaaaaaaa-0000-0000-0000-0000000000e1'''
\set ADMINID    '''aaaaaaaa-0000-0000-0000-0000000000a9'''
\set CYCA       '''aaaaaaaa-0000-0000-0000-0000000000c7'''
\set CYCB       '''aaaaaaaa-0000-0000-0000-0000000000c8'''
\set SELFLOOP   '''aaaaaaaa-0000-0000-0000-00000000501f'''
\set FOREIGNID  '''bbbbbbbb-0000-0000-0000-0000000000f9'''

BEGIN;

INSERT INTO public.organizations (id, name) VALUES
  (:ORG_A, 'Synthetic Agency A'),
  (:ORG_B, 'Synthetic Agency B');

INSERT INTO public.profiles (id, organization_id, first_name, last_name, role, status, upline_id, npn, resident_state, carriers) VALUES
  (:LEADER,   :ORG_A, 'Lea','Der',    'Team Leader','Active', NULL,      '111111','California', '[{"carrier":"Mutual of Omaha","writingNumber":"W1"}]'::jsonb),
  (:CHILD1,   :ORG_A, 'Chi','Ld',     'Agent',      'Active', :LEADER,   '222222','Texas',      '[]'::jsonb),
  (:GRAND1,   :ORG_A, 'Gra','Nd',     'Agent',      'Active', :CHILD1,   NULL,    'TX',         '[]'::jsonb),
  (:DELMID,   :ORG_A, 'Del','Mid',    'Agent',      'Deleted',:LEADER,   '333333','Ohio',       '[]'::jsonb),
  (:BELOWDEL, :ORG_A, 'Bel','Ow',     'Agent',      'Active', :DELMID,   '444444','Florida',    '[]'::jsonb),
  (:PEER,     :ORG_A, 'Pee','R',      'Agent',      'Active', :ADMINID,  '555555','Nevada',     '[]'::jsonb),
  (:ADMINID,  :ORG_A, 'Ad','Min',     'Admin',      'Active', NULL,      '666666','California', '[]'::jsonb),
  (:CYCA,     :ORG_A, 'Cyc','A',      'Agent',      'Active', :CYCB,     NULL,    NULL,         '[]'::jsonb),
  (:CYCB,     :ORG_A, 'Cyc','B',      'Agent',      'Active', :CYCA,     NULL,    NULL,         '[]'::jsonb),
  (:SELFLOOP, :ORG_A, 'Sel','Floop',  'Agent',      'Active', :SELFLOOP, NULL,    NULL,         '[]'::jsonb),
  (:FOREIGNID,:ORG_B, 'For','Eign',   'Agent',      'Active', :LEADER,   '777777','Texas',      '[]'::jsonb);

-- LEADER's book of business. Four clients exercising every normalization rule at once.
INSERT INTO public.clients
  (id, organization_id, assigned_agent_id, policy_type, carrier, policy_number, premium, premium_amount, face_amount, sold_date, custom_fields)
VALUES
  -- C1 — full primary + THREE additional entries: one complete, one blank-amount with the LEGACY
  --      issueDate key, and one that is a bare string (a malformed ELEMENT).
  ('11111111-0000-0000-0000-000000000001', :ORG_A, :LEADER, 'Final Expense', 'Mutual of Omaha', 'P1',
   100.50, 99999, 250000, DATE '2026-01-15',
   jsonb_build_object(
     'Gender', 'M',
     'additional_policies', jsonb_build_array(
        jsonb_build_object('policyType','Whole Life','carrier','Americo','policyNumber','P1b',
                           'faceAmount','$50,000','premiumAmount','$25.25/mo',
                           'soldDate','2026-01-15','effectiveDate',NULL),
        jsonb_build_object('policyType','Term','carrier','','policyNumber','',
                           'faceAmount','','premiumAmount','',
                           'issueDate','2025-12-01'),
        '"corrupted-element"'::jsonb
     ))),
  -- C2 — the CSV-import shape: every policy column on its DDL default. Contributes NO primary
  --      policy under D-3b, but IS still a client.
  ('11111111-0000-0000-0000-000000000002', :ORG_A, :LEADER, 'Term', '', '', 0, 99999, 0, NULL, NULL),
  -- C3 — real primary, but additional_policies is a STRING: the FullScreenContactView corruption.
  ('11111111-0000-0000-0000-000000000003', :ORG_A, :LEADER, 'IUL', 'Foresters', 'P3',
   50, 99999, 0, NULL,
   jsonb_build_object('additional_policies', '"[object Object],[object Object]"'::jsonb)),
  -- C4 — primary with a premium but NO carrier (blank, not null).
  ('11111111-0000-0000-0000-000000000004', :ORG_A, :LEADER, 'Final Expense', '', 'P4',
   200, 99999, 0, DATE '2026-02-10', NULL);

-- Downline books, one client each, deliberately distinct premiums so the team total is unambiguous.
INSERT INTO public.clients (id, organization_id, assigned_agent_id, policy_type, carrier, policy_number, premium, face_amount, sold_date) VALUES
  ('22222222-0000-0000-0000-000000000001', :ORG_A, :CHILD1,   'Term',          'Americo',   'D1', 10, 1000, DATE '2026-03-01'),
  ('22222222-0000-0000-0000-000000000002', :ORG_A, :GRAND1,   'Term',          'Americo',   'D2', 20, 2000, DATE '2026-03-02'),
  ('22222222-0000-0000-0000-000000000003', :ORG_A, :BELOWDEL, 'Whole Life',    'Foresters', 'D3', 40, 4000, DATE '2026-03-03'),
  ('22222222-0000-0000-0000-000000000004', :ORG_A, :PEER,     'Final Expense', 'Americo',   'D4', 80, 8000, DATE '2026-03-04'),
  -- Cross-organization client owned by the ORG_B profile whose upline_id points INTO ORG_A.
  ('33333333-0000-0000-0000-000000000001', :ORG_B, :FOREIGNID,'Term',          'Americo',   'X1', 160, 16000, DATE '2026-03-05');

-- Mixed-format licences. "CA" and "California" are two RAW rows for ONE agent — legal under the
-- (agent_id, state) unique index, and the reason every state measure normalizes.
INSERT INTO public.agent_state_licenses (agent_id, organization_id, state, license_number, expiration_date) VALUES
  (:LEADER,   :ORG_A, 'CA',         'L-CA', NULL),
  (:LEADER,   :ORG_A, 'California', 'L-CA2', DATE '2030-01-01'),
  (:LEADER,   :ORG_A, 'TX',         'L-TX', NULL),
  (:CHILD1,   :ORG_A, 'Texas',      'L-TX2', CURRENT_DATE - 1),   -- expired
  (:GRAND1,   :ORG_A, 'TX',         'L-TX3', CURRENT_DATE + 10),  -- expiring soon
  (:BELOWDEL, :ORG_A, 'FL',         'L-FL', NULL),
  (:PEER,     :ORG_A, 'NV',         'L-NV', NULL),
  (:FOREIGNID,:ORG_B, 'TX',         'L-XX', NULL);

-- Outbound dials for the Most-Dials-in-a-Day achievement. 2026-01-15 has 3 in America/Los_Angeles;
-- the 2026-01-16T03:00Z row lands on 2026-01-15 LOCAL, which is the whole point of the time zone.
INSERT INTO public.calls (organization_id, agent_id, direction, created_at) VALUES
  (:ORG_A, :LEADER, 'outbound', TIMESTAMPTZ '2026-01-15 18:00:00+00'),
  (:ORG_A, :LEADER, 'outbound', TIMESTAMPTZ '2026-01-15 19:00:00+00'),
  (:ORG_A, :LEADER, 'outbound', TIMESTAMPTZ '2026-01-16 03:00:00+00'),
  (:ORG_A, :LEADER, 'inbound',  TIMESTAMPTZ '2026-01-15 20:00:00+00'),   -- inbound: never counted
  (:ORG_A, :LEADER, 'outbound', TIMESTAMPTZ '2026-02-20 18:00:00+00'),
  (:ORG_A, :CHILD1, 'outbound', TIMESTAMPTZ '2026-01-15 18:00:00+00');   -- another agent

-- Contradictory wins. Every metric must ignore them entirely.
INSERT INTO public.wins (agent_id, contact_id, organization_id, policy_type, premium_amount, sold_date) VALUES
  (:LEADER, '11111111-0000-0000-0000-000000000001', :ORG_A, 'Annuity', 9999, DATE '2020-01-01'),
  (:LEADER, NULL, :ORG_A, 'Annuity', 9999, DATE '2020-01-01'),
  (:LEADER, NULL, :ORG_A, 'Annuity', 9999, DATE '2020-01-01');

COMMIT;

-- =====================================================================================================
-- T0 — the migration is actually applied, with the security attributes it claims
-- =====================================================================================================
DO $$
DECLARE r RECORD;
BEGIN
  IF to_regprocedure('public.get_profile_book_stats(text,text)') IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: get_profile_book_stats is not installed';
  END IF;
  IF to_regprocedure('public.get_profile_team_readiness()') IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: get_profile_team_readiness is not installed';
  END IF;
  IF to_regprocedure('private.resolve_downline_ids(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: private.resolve_downline_ids is not installed';
  END IF;

  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.prosecdef, p.provolatile, p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname, p.proname) IN (('public','get_profile_book_stats'),
                                     ('public','get_profile_team_readiness'),
                                     ('private','resolve_downline_ids'))
  LOOP
    IF NOT r.prosecdef THEN
      RAISE EXCEPTION 'T0 FAIL: % is not SECURITY DEFINER', r.sig;
    END IF;
    IF r.provolatile <> 's' THEN
      RAISE EXCEPTION 'T0 FAIL: % is not STABLE (volatility %)', r.sig, r.provolatile;
    END IF;
    IF r.proconfig IS NULL
       OR NOT ('search_path=pg_catalog, pg_temp' = ANY (r.proconfig)) THEN
      RAISE EXCEPTION 'T0 FAIL: % does not pin search_path to pg_catalog, pg_temp (got %)', r.sig, r.proconfig;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE schemaname='public' AND tablename='clients'
                   AND indexname='idx_clients_assigned_agent_id') THEN
    RAISE EXCEPTION 'T0 FAIL: idx_clients_assigned_agent_id is missing';
  END IF;

  -- EVERY function this migration creates pins search_path, the two pure private parsers included.
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname, p.proname) IN (('private','profile_parse_currency'),
                                     ('private','profile_parse_iso_date'))
  LOOP
    IF r.proconfig IS NULL OR NOT ('search_path=pg_catalog, pg_temp' = ANY (r.proconfig)) THEN
      RAISE EXCEPTION 'T0 FAIL: % does not pin search_path (got %)', r.sig, r.proconfig;
    END IF;
  END LOOP;

  RAISE NOTICE 'T0  OK  installed, SECURITY DEFINER, STABLE, search_path pinned, index present';
END $$;

-- =====================================================================================================
-- T1 — EXECUTE privileges: anon and PUBLIC hold none; the private helpers are unreachable
-- =====================================================================================================
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_profile_book_stats(text,text)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.get_profile_team_readiness()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T1 FAIL: anon can execute a profile RPC';
  END IF;
  IF has_function_privilege('anon', 'private.resolve_downline_ids(uuid,uuid)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'private.resolve_downline_ids(uuid,uuid)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'private.profile_parse_currency(text)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'private.profile_parse_iso_date(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T1 FAIL: a private helper is reachable by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_profile_book_stats(text,text)', 'EXECUTE')
  OR NOT has_function_privilege('authenticated', 'public.get_profile_team_readiness()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T1 FAIL: authenticated cannot execute the profile RPCs';
  END IF;
  RAISE NOTICE 'T1  OK  anon/PUBLIC hold no EXECUTE; private helpers revoked; authenticated granted';
END $$;

-- =====================================================================================================
-- T2 — self scope: every normalization rule at once
-- =====================================================================================================
DO $$
DECLARE b RECORD;
BEGIN
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-00000000000a');
  SELECT * INTO b FROM public.get_profile_book_stats('self', NULL);

  IF b.scope_agent_count <> 1 THEN RAISE EXCEPTION 'T2 FAIL scope_agent_count=% expected 1', b.scope_agent_count; END IF;
  IF b.total_clients <> 4 THEN RAISE EXCEPTION 'T2 FAIL total_clients=% expected 4', b.total_clients; END IF;
  -- C2 is a client with no policy signal at all (D-3b).
  IF b.clients_without_policy_detail <> 1 THEN RAISE EXCEPTION 'T2 FAIL clients_without_policy_detail=% expected 1', b.clients_without_policy_detail; END IF;
  -- 3 primaries (C1, C3, C4) + 2 valid additional entries on C1.
  IF b.total_policies <> 5 THEN RAISE EXCEPTION 'T2 FAIL total_policies=% expected 5', b.total_policies; END IF;
  IF b.additional_policy_count <> 2 THEN RAISE EXCEPTION 'T2 FAIL additional_policy_count=% expected 2', b.additional_policy_count; END IF;
  -- One corrupted container (C3, a string) + one non-object element (C1's third entry).
  IF b.malformed_additional_policies <> 2 THEN RAISE EXCEPTION 'T2 FAIL malformed=% expected 2', b.malformed_additional_policies; END IF;
  -- 100.50 + 25.25 ("$25.25/mo" parsed) + 50 + 200. The blank-amount entry contributes NOTHING.
  IF b.total_premium_monthly <> 375.75 THEN RAISE EXCEPTION 'T2 FAIL total_premium_monthly=% expected 375.75', b.total_premium_monthly; END IF;
  IF b.policies_missing_premium <> 1 THEN RAISE EXCEPTION 'T2 FAIL policies_missing_premium=% expected 1', b.policies_missing_premium; END IF;
  -- Only C3's primary has no usable sale date.
  IF b.undated_policies <> 1 THEN RAISE EXCEPTION 'T2 FAIL undated_policies=% expected 1', b.undated_policies; END IF;
  -- Mutual of Omaha, Americo, Foresters. Blank carriers are NOT a carrier.
  IF b.distinct_carriers <> 3 THEN RAISE EXCEPTION 'T2 FAIL distinct_carriers=% expected 3', b.distinct_carriers; END IF;
  -- "CA" + "California" collapse; TX is the second.
  IF b.distinct_licensed_states <> 2 THEN RAISE EXCEPTION 'T2 FAIL distinct_licensed_states=% expected 2 (CA+California must collapse)', b.distinct_licensed_states; END IF;
  RAISE NOTICE 'T2  OK  self scope: 4 clients / 5 policies / $375.75 monthly / 3 carriers / 2 states';
END $$;

-- =====================================================================================================
-- T2b — a corrupted additional_policies container can never RAISE, whatever plan is chosen
-- =====================================================================================================
-- jsonb_array_elements() errors on a non-array. The FullScreenContactView text-input defect writes
-- exactly that. The migration substitutes an empty array INSIDE the LATERAL argument rather than
-- relying on a WHERE clause being pushed below the join, so this holds under any plan. The two
-- enable_* settings force a different join strategy to make the point rather than assume it.
DO $$
DECLARE b RECORD;
BEGIN
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-00000000000a');

  -- Every client's container corrupted at once: scalar string, number, boolean and object.
  UPDATE public.clients SET custom_fields = jsonb_build_object('additional_policies', '"wrecked"'::jsonb)
   WHERE id = '11111111-0000-0000-0000-000000000002';
  UPDATE public.clients SET custom_fields = jsonb_build_object('additional_policies', '42'::jsonb)
   WHERE id = '11111111-0000-0000-0000-000000000004';

  SET LOCAL enable_hashjoin = off;
  SET LOCAL enable_mergejoin = off;

  SELECT * INTO b FROM public.get_profile_book_stats('self', NULL);

  -- 3 corrupted containers now (C2, C3, C4) + C1's one non-object element.
  IF b.malformed_additional_policies <> 4 THEN
    RAISE EXCEPTION 'T2b FAIL malformed=% expected 4', b.malformed_additional_policies;
  END IF;
  -- The policy count is UNCHANGED at 5. Corrupting a container destroys only the additional
  -- policies that container held, and C2/C4 held none: C2 has no policy evidence at all, C4 has a
  -- primary policy that lives in columns. C1's own container is untouched, so its two additional
  -- policies survive. A corrupted container must never take a PRIMARY policy down with it.
  IF b.total_policies <> 5 THEN
    RAISE EXCEPTION 'T2b FAIL total_policies=% expected 5', b.total_policies;
  END IF;
  RAISE NOTICE 'T2b OK  corrupted containers counted, never raised, under a forced join strategy';
END $$;

-- Restore the fixture the remaining tests expect.
UPDATE public.clients SET custom_fields = NULL
 WHERE id IN ('11111111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000004');
UPDATE public.clients
   SET custom_fields = jsonb_build_object('additional_policies', '"[object Object],[object Object]"'::jsonb)
 WHERE id = '11111111-0000-0000-0000-000000000003';

-- =====================================================================================================
-- T3 — premium is MONTHLY, is never annualized, and clients.premium_amount is never read
-- =====================================================================================================
DO $$
DECLARE b RECORD; v_before numeric;
BEGIN
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-00000000000a');
  SELECT total_premium_monthly INTO v_before FROM public.get_profile_book_stats('self', NULL);

  IF v_before = 375.75 * 12 THEN RAISE EXCEPTION 'T3 FAIL: the total was annualized'; END IF;

  -- Every fixture row carries premium_amount = 99999. If it were read, the total would explode.
  IF v_before >= 99999 THEN RAISE EXCEPTION 'T3 FAIL: clients.premium_amount leaked into the total'; END IF;

  UPDATE public.clients SET premium_amount = 555555 WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  SELECT * INTO b FROM public.get_profile_book_stats('self', NULL);
  IF b.total_premium_monthly <> v_before THEN
    RAISE EXCEPTION 'T3 FAIL: mutating clients.premium_amount moved the total (% -> %)', v_before, b.total_premium_monthly;
  END IF;
  RAISE NOTICE 'T3  OK  monthly, never x12, and premium_amount is provably never read';
END $$;

-- =====================================================================================================
-- T4 — public.wins is never read
-- =====================================================================================================
DO $$
DECLARE b1 RECORD; b2 RECORD;
BEGIN
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-00000000000a');
  SELECT * INTO b1 FROM public.get_profile_book_stats('self', NULL);

  INSERT INTO public.wins (agent_id, organization_id, policy_type, premium_amount, sold_date)
  SELECT 'aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-00000000000a',
         'Annuity', 12345, DATE '2026-01-15'
  FROM generate_series(1, 25);

  SELECT * INTO b2 FROM public.get_profile_book_stats('self', NULL);
  IF b1.total_policies <> b2.total_policies
  OR b1.total_premium_monthly <> b2.total_premium_monthly
  OR b1.policy_type_mix::text <> b2.policy_type_mix::text
  OR b1.achievements::text <> b2.achievements::text THEN
    RAISE EXCEPTION 'T4 FAIL: adding 25 wins changed a book-of-business metric';
  END IF;
  RAISE NOTICE 'T4  OK  25 contradictory wins moved nothing';
END $$;

-- =====================================================================================================
-- T5 — carrier breakdown and policy-type mix include additional policies
-- =====================================================================================================
DO $$
DECLARE b RECORD; v jsonb;
BEGIN
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-00000000000a');
  SELECT * INTO b FROM public.get_profile_book_stats('self', NULL);

  -- Americo appears ONLY as an additional policy on C1. If it is present, additional policies are in.
  SELECT e INTO v FROM jsonb_array_elements(b.carrier_breakdown) e WHERE e ->> 'carrier' = 'Americo';
  IF v IS NULL THEN RAISE EXCEPTION 'T5 FAIL: Americo (an additional-policy carrier) missing from carrier_breakdown'; END IF;
  IF (v ->> 'policies')::bigint <> 1 THEN RAISE EXCEPTION 'T5 FAIL: Americo policies=% expected 1', v ->> 'policies'; END IF;
  IF (v ->> 'premium_monthly')::numeric <> 25.25 THEN RAISE EXCEPTION 'T5 FAIL: Americo premium=% expected 25.25', v ->> 'premium_monthly'; END IF;

  -- The no-carrier bucket is a real row with a NULL carrier, never dropped: C1's blank-carrier
  -- additional entry plus C4's blank-carrier primary.
  SELECT e INTO v FROM jsonb_array_elements(b.carrier_breakdown) e WHERE e ->> 'carrier' IS NULL;
  IF v IS NULL THEN RAISE EXCEPTION 'T5 FAIL: the no-carrier bucket was dropped'; END IF;
  IF (v ->> 'policies')::bigint <> 2 THEN RAISE EXCEPTION 'T5 FAIL: no-carrier bucket policies=% expected 2', v ->> 'policies'; END IF;

  -- Whole Life exists ONLY as an additional policy.
  SELECT e INTO v FROM jsonb_array_elements(b.policy_type_mix) e WHERE e ->> 'policy_type' = 'Whole Life';
  IF v IS NULL THEN RAISE EXCEPTION 'T5 FAIL: Whole Life (additional-only) missing from policy_type_mix'; END IF;

  -- The mix must total the policy count exactly.
  IF (SELECT sum((e ->> 'policies')::bigint) FROM jsonb_array_elements(b.policy_type_mix) e) <> b.total_policies THEN
    RAISE EXCEPTION 'T5 FAIL: policy_type_mix does not sum to total_policies';
  END IF;
  IF (SELECT sum((e ->> 'policies')::bigint) FROM jsonb_array_elements(b.carrier_breakdown) e) <> b.total_policies THEN
    RAISE EXCEPTION 'T5 FAIL: carrier_breakdown does not sum to total_policies';
  END IF;
  RAISE NOTICE 'T5  OK  both breakdowns include additional policies and sum to total_policies';
END $$;

-- =====================================================================================================
-- T6 — achievements use the documented sources and semantics
-- =====================================================================================================
DO $$
DECLARE b RECORD; a jsonb;
BEGIN
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-00000000000a');
  SELECT * INTO b FROM public.get_profile_book_stats('self', 'America/Los_Angeles');
  a := b.achievements;

  IF (a -> 'largest_face' ->> 'face_amount')::numeric <> 250000 THEN
    RAISE EXCEPTION 'T6 FAIL largest_face=% expected 250000', a -> 'largest_face' ->> 'face_amount'; END IF;
  IF (a -> 'largest_premium' ->> 'premium_monthly')::numeric <> 200 THEN
    RAISE EXCEPTION 'T6 FAIL largest_premium=% expected 200', a -> 'largest_premium' ->> 'premium_monthly'; END IF;

  -- 2026-02 = 200 beats 2026-01 = 125.75 (100.50 primary + 25.25 additional).
  IF a -> 'best_premium_month' ->> 'month' <> '2026-02' THEN
    RAISE EXCEPTION 'T6 FAIL best_premium_month=% expected 2026-02', a -> 'best_premium_month' ->> 'month'; END IF;
  -- 2026-01 holds two policies; the legacy issueDate entry buckets into 2025-12, proving the
  -- legacy key is honoured rather than dropped.
  IF a -> 'most_policies_month' ->> 'month' <> '2026-01' THEN
    RAISE EXCEPTION 'T6 FAIL most_policies_month=% expected 2026-01', a -> 'most_policies_month' ->> 'month'; END IF;
  IF (a -> 'most_policies_month' ->> 'policies')::bigint <> 2 THEN
    RAISE EXCEPTION 'T6 FAIL most_policies_month policies=% expected 2', a -> 'most_policies_month' ->> 'policies'; END IF;

  -- Local-day bucketing: 2026-01-16T03:00Z is 2026-01-15 in America/Los_Angeles, so that day has 3
  -- outbound dials. The inbound row is excluded, and CHILD1's dial belongs to another agent.
  IF a -> 'most_dials_day' ->> 'day' <> '2026-01-15' THEN
    RAISE EXCEPTION 'T6 FAIL most_dials_day=% expected 2026-01-15', a -> 'most_dials_day' ->> 'day'; END IF;
  IF (a -> 'most_dials_day' ->> 'dials')::bigint <> 3 THEN
    RAISE EXCEPTION 'T6 FAIL most_dials_day dials=% expected 3 (inbound and other agents excluded)', a -> 'most_dials_day' ->> 'dials'; END IF;
  IF a -> 'most_dials_day' ->> 'time_zone' <> 'America/Los_Angeles' THEN
    RAISE EXCEPTION 'T6 FAIL most_dials_day does not carry its time zone'; END IF;

  -- In UTC the same rows split 2/1, so the bucket really is timezone-driven rather than incidental.
  SELECT * INTO b FROM public.get_profile_book_stats('self', 'UTC');
  IF (b.achievements -> 'most_dials_day' ->> 'dials')::bigint <> 2 THEN
    RAISE EXCEPTION 'T6 FAIL: UTC bucketing produced % dials, expected 2', b.achievements -> 'most_dials_day' ->> 'dials'; END IF;

  -- Without a time zone the achievement is absent, never guessed in UTC.
  SELECT * INTO b FROM public.get_profile_book_stats('self', NULL);
  IF b.achievements -> 'most_dials_day' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'T6 FAIL: most_dials_day was computed without a time zone'; END IF;

  RAISE NOTICE 'T6  OK  achievements correct; local-day bucketing proven; absent without a time zone';
END $$;

-- =====================================================================================================
-- T7 — team scope: downline included, deleted intermediate survives, peers and other orgs excluded
-- =====================================================================================================
DO $$
DECLARE b RECORD;
BEGIN
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-00000000000a');
  SELECT * INTO b FROM public.get_profile_book_stats('team', NULL);

  -- LEADER + CHILD1 + GRAND1 + BELOW_DEL. DELETED_MID is traversed through but excluded.
  IF b.scope_agent_count <> 4 THEN RAISE EXCEPTION 'T7 FAIL scope_agent_count=% expected 4', b.scope_agent_count; END IF;
  -- 4 LEADER clients + 1 each for CHILD1, GRAND1, BELOW_DEL.
  IF b.total_clients <> 7 THEN RAISE EXCEPTION 'T7 FAIL total_clients=% expected 7', b.total_clients; END IF;
  -- 375.75 + 10 + 20 + 40. PEER's 80 and the ORG_B 160 must be absent.
  IF b.total_premium_monthly <> 445.75 THEN
    RAISE EXCEPTION 'T7 FAIL total_premium_monthly=% expected 445.75 (peer 80 / cross-org 160 must be excluded)', b.total_premium_monthly; END IF;
  RAISE NOTICE 'T7  OK  team scope includes the branch beneath a Deleted manager and excludes peers + other orgs';
END $$;

-- =====================================================================================================
-- T8 — resolve_downline_ids: exact membership, cycles, self-edges, cross-org edges
-- =====================================================================================================
DO $$
DECLARE ids uuid[];
BEGIN
  SELECT array_agg(agent_id ORDER BY agent_id) INTO ids
  FROM private.resolve_downline_ids('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-00000000000a');

  IF 'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid = ANY (ids) THEN
    RAISE EXCEPTION 'T8 FAIL: the Deleted intermediate is IN the scope'; END IF;
  IF NOT ('aaaaaaaa-0000-0000-0000-0000000000b1'::uuid = ANY (ids)) THEN
    RAISE EXCEPTION 'T8 FAIL: the branch BELOW the Deleted intermediate was severed'; END IF;
  IF 'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid = ANY (ids) THEN
    RAISE EXCEPTION 'T8 FAIL: a peer (upline = Admin) is in the scope'; END IF;
  IF 'bbbbbbbb-0000-0000-0000-0000000000f9'::uuid = ANY (ids) THEN
    RAISE EXCEPTION 'T8 FAIL: a cross-organization upline_id edge pulled a foreign profile into scope'; END IF;
  IF 'aaaaaaaa-0000-0000-0000-0000000000c7'::uuid = ANY (ids) THEN
    RAISE EXCEPTION 'T8 FAIL: an unreachable cycle member is in the scope'; END IF;
  IF array_length(ids, 1) <> 4 THEN
    RAISE EXCEPTION 'T8 FAIL: scope size % expected 4 (%)', array_length(ids, 1), ids; END IF;

  -- A root that is itself inside a 2-cycle must TERMINATE and return exactly the cycle members.
  SELECT array_agg(agent_id ORDER BY agent_id) INTO ids
  FROM private.resolve_downline_ids('aaaaaaaa-0000-0000-0000-0000000000c7', 'aaaaaaaa-0000-0000-0000-00000000000a');
  IF array_length(ids, 1) <> 2 THEN RAISE EXCEPTION 'T8 FAIL: cycle root resolved % ids, expected 2', array_length(ids, 1); END IF;

  -- A self-edge must terminate and return only the root.
  SELECT array_agg(agent_id) INTO ids
  FROM private.resolve_downline_ids('aaaaaaaa-0000-0000-0000-00000000501f', 'aaaaaaaa-0000-0000-0000-00000000000a');
  IF array_length(ids, 1) <> 1 THEN RAISE EXCEPTION 'T8 FAIL: self-edge root resolved % ids, expected 1', array_length(ids, 1); END IF;

  -- An unknown root, or the right root in the wrong organization, resolves to NOTHING. Fail closed.
  IF EXISTS (SELECT 1 FROM private.resolve_downline_ids('aaaaaaaa-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-00000000000b')) THEN
    RAISE EXCEPTION 'T8 FAIL: a root resolved against the WRONG organization returned rows'; END IF;
  IF EXISTS (SELECT 1 FROM private.resolve_downline_ids('00000000-0000-0000-0000-0000000000ff', 'aaaaaaaa-0000-0000-0000-00000000000a')) THEN
    RAISE EXCEPTION 'T8 FAIL: an unknown root returned rows'; END IF;

  RAISE NOTICE 'T8  OK  membership exact; cycles and self-edges terminate; cross-org and unknown roots fail closed';
END $$;

-- =====================================================================================================
-- T9 — an Agent with no downline resolves to exactly self (D-2), and sees only their own book
-- =====================================================================================================
DO $$
DECLARE b RECORD;
BEGIN
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000ab', 'aaaaaaaa-0000-0000-0000-00000000000a');
  SELECT * INTO b FROM public.get_profile_book_stats('team', NULL);
  IF b.scope_agent_count <> 1 THEN RAISE EXCEPTION 'T9 FAIL scope_agent_count=% expected 1', b.scope_agent_count; END IF;
  IF b.total_clients <> 1 THEN RAISE EXCEPTION 'T9 FAIL total_clients=% expected 1', b.total_clients; END IF;
  IF b.total_premium_monthly <> 20 THEN RAISE EXCEPTION 'T9 FAIL total_premium_monthly=% expected 20', b.total_premium_monthly; END IF;

  -- An Agent WITH a downline gets it (D-2: the edges gate the traversal, not the role).
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-00000000000a');
  SELECT * INTO b FROM public.get_profile_book_stats('team', NULL);
  IF b.scope_agent_count <> 2 THEN RAISE EXCEPTION 'T9 FAIL: an Agent with a downline resolved % ids, expected 2', b.scope_agent_count; END IF;
  IF b.total_premium_monthly <> 30 THEN RAISE EXCEPTION 'T9 FAIL: CHILD1 team premium=% expected 30', b.total_premium_monthly; END IF;
  RAISE NOTICE 'T9  OK  Agent scope follows upline_id edges, not the role string';
END $$;

-- =====================================================================================================
-- T10 — Admin gets the established agency-wide contract, bounded by the organization
-- =====================================================================================================
DO $$
DECLARE b RECORD;
BEGIN
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-00000000000a');
  SELECT * INTO b FROM public.get_profile_book_stats('team', NULL);

  -- Every Active ORG_A profile: LEADER, CHILD1, GRAND1, BELOW_DEL, PEER, ADMIN, CYC_A, CYC_B, SELFLOOP.
  IF b.scope_agent_count <> 9 THEN RAISE EXCEPTION 'T10 FAIL scope_agent_count=% expected 9', b.scope_agent_count; END IF;
  -- The peer's client is now in scope; the ORG_B client still is not.
  IF b.total_clients <> 8 THEN RAISE EXCEPTION 'T10 FAIL total_clients=% expected 8', b.total_clients; END IF;
  IF b.total_premium_monthly <> 525.75 THEN
    RAISE EXCEPTION 'T10 FAIL total_premium_monthly=% expected 525.75 (cross-org 160 must still be excluded)', b.total_premium_monthly; END IF;

  -- Admin's SELF scope is still only themselves. Org-wide never leaks into the Agent Profile tab.
  SELECT * INTO b FROM public.get_profile_book_stats('self', NULL);
  IF b.scope_agent_count <> 1 OR b.total_clients <> 0 THEN
    RAISE EXCEPTION 'T10 FAIL: Admin self scope leaked (agents=%, clients=%)', b.scope_agent_count, b.total_clients; END IF;
  RAISE NOTICE 'T10 OK  Admin team = whole organization; Admin self = self only';
END $$;

-- =====================================================================================================
-- T11 — team readiness aggregate
-- =====================================================================================================
DO $$
DECLARE t RECORD; v jsonb;
BEGIN
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-00000000000a');
  SELECT * INTO t FROM public.get_profile_team_readiness();

  IF t.scope_agent_count <> 4 THEN RAISE EXCEPTION 'T11 FAIL scope_agent_count=% expected 4', t.scope_agent_count; END IF;
  -- Direct reports exclude the Deleted intermediate.
  IF t.direct_reports <> 1 THEN RAISE EXCEPTION 'T11 FAIL direct_reports=% expected 1', t.direct_reports; END IF;
  -- Total downline EXCLUDES self.
  IF t.total_downline <> 3 THEN RAISE EXCEPTION 'T11 FAIL total_downline=% expected 3 (self excluded)', t.total_downline; END IF;
  -- LEADER -> DELETED_MID -> BELOW_DEL is three levels deep even though the middle is Deleted.
  IF t.max_depth <> 3 THEN RAISE EXCEPTION 'T11 FAIL max_depth=% expected 3', t.max_depth; END IF;
  -- GRAND1 has no NPN.
  IF t.needs_npn <> 1 THEN RAISE EXCEPTION 'T11 FAIL needs_npn=% expected 1', t.needs_npn; END IF;
  -- Only LEADER has a carrier appointment recorded.
  IF t.needs_carrier <> 3 THEN RAISE EXCEPTION 'T11 FAIL needs_carrier=% expected 3', t.needs_carrier; END IF;
  -- CHILD1's Texas licence expired yesterday.
  IF t.expired_licenses <> 1 THEN RAISE EXCEPTION 'T11 FAIL expired_licenses=% expected 1', t.expired_licenses; END IF;
  -- GRAND1's expires in 10 days.
  IF t.expiring_licenses_30d <> 1 THEN RAISE EXCEPTION 'T11 FAIL expiring_licenses_30d=% expected 1', t.expiring_licenses_30d; END IF;
  -- LEADER's CA + TX and BELOW_DEL's FL carry no expiration date; that is "none", not "Active".
  IF t.licenses_without_expiration <> 3 THEN RAISE EXCEPTION 'T11 FAIL licenses_without_expiration=% expected 3', t.licenses_without_expiration; END IF;
  -- CA (from CA + California), TX, FL. The peer's NV and the ORG_B TX are out of scope.
  IF t.states_covered <> 3 THEN RAISE EXCEPTION 'T11 FAIL states_covered=% expected 3', t.states_covered; END IF;

  SELECT e INTO v FROM jsonb_array_elements(t.top_states) e WHERE e ->> 'state' = 'TX';
  IF v IS NULL OR (v ->> 'agents')::bigint <> 3 THEN
    RAISE EXCEPTION 'T11 FAIL: TX should cover 3 agents (LEADER, CHILD1 "Texas", GRAND1 "TX"), got %', v; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(t.top_states) e WHERE e ->> 'state' = 'NV') THEN
    RAISE EXCEPTION 'T11 FAIL: a peer state leaked into top_states'; END IF;

  RAISE NOTICE 'T11 OK  readiness counts, depth through a Deleted node, normalized state coverage';
END $$;

-- =====================================================================================================
-- T12 — authorization and input validation all fail closed
-- =====================================================================================================
DO $$
DECLARE ok boolean;
BEGIN
  -- Unauthenticated: the anon claims document PostgREST sends when a request carries no user JWT.
  PERFORM public.test_clear_caller();
  BEGIN
    PERFORM * FROM public.get_profile_book_stats('self', NULL);
    RAISE EXCEPTION 'T12 FAIL: an unauthenticated caller succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Organization mismatch: a real user, claiming an organization that is not theirs.
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-00000000000b');
  BEGIN
    PERFORM * FROM public.get_profile_book_stats('self', NULL);
    RAISE EXCEPTION 'T12 FAIL: an organization mismatch succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- A non-Active profile is refused outright.
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-00000000000a');
  BEGIN
    PERFORM * FROM public.get_profile_book_stats('self', NULL);
    RAISE EXCEPTION 'T12 FAIL: a Deleted profile was served';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-00000000000a');

  -- An unknown scope raises instead of defaulting to something convenient.
  BEGIN
    PERFORM * FROM public.get_profile_book_stats('everyone', NULL);
    RAISE EXCEPTION 'T12 FAIL: p_scope=everyone was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.get_profile_book_stats(NULL, NULL);
    RAISE EXCEPTION 'T12 FAIL: a NULL p_scope was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- An unknown time zone raises rather than silently bucketing in UTC.
  BEGIN
    PERFORM * FROM public.get_profile_book_stats('self', 'Mars/Olympus_Mons');
    RAISE EXCEPTION 'T12 FAIL: an unknown IANA zone was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  -- A Rails/ActiveSupport label is NOT an IANA name, and must be refused rather than guessed.
  BEGIN
    PERFORM * FROM public.get_profile_book_stats('self', 'Eastern Time (US & Canada)');
    RAISE EXCEPTION 'T12 FAIL: a Rails timezone label was accepted as IANA';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  RAISE NOTICE 'T12 OK  unauthenticated / org mismatch / inactive / bad scope / bad timezone all refused';
END $$;

-- =====================================================================================================
-- T13 — no caller-supplied agent list exists to abuse
-- =====================================================================================================
DO $$
DECLARE v_args text;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid) INTO v_args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_profile_book_stats';
  IF v_args <> 'p_scope text, p_time_zone text' THEN
    RAISE EXCEPTION 'T13 FAIL: get_profile_book_stats signature is (%), expected (p_scope text, p_time_zone text)', v_args; END IF;

  SELECT pg_get_function_identity_arguments(p.oid) INTO v_args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_profile_team_readiness';
  IF v_args <> '' THEN
    RAISE EXCEPTION 'T13 FAIL: get_profile_team_readiness takes arguments (%)', v_args; END IF;

  -- No uuid / uuid[] parameter anywhere in either signature: the scope cannot be steered.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_profile_book_stats','get_profile_team_readiness')
      AND (p.proargtypes::oid[] && ARRAY['uuid'::regtype::oid, 'uuid[]'::regtype::oid])
  ) THEN
    RAISE EXCEPTION 'T13 FAIL: a profile RPC accepts a uuid parameter'; END IF;

  RAISE NOTICE 'T13 OK  neither RPC accepts an agent id, an organization id or a role';
END $$;

-- =====================================================================================================
-- T14 — currency and date parsers mirror their TypeScript counterparts
-- =====================================================================================================
DO $$
BEGIN
  IF private.profile_parse_currency('$150/mo')  <> 150     THEN RAISE EXCEPTION 'T14 FAIL "$150/mo"'; END IF;
  IF private.profile_parse_currency('$1,500.00')<> 1500.00 THEN RAISE EXCEPTION 'T14 FAIL "$1,500.00"'; END IF;
  IF private.profile_parse_currency('.5')       <> 0.5     THEN RAISE EXCEPTION 'T14 FAIL ".5"'; END IF;
  IF private.profile_parse_currency('-5.5')     <> -5.5    THEN RAISE EXCEPTION 'T14 FAIL "-5.5"'; END IF;
  -- parseFloat semantics: a leading number, trailing junk ignored.
  IF private.profile_parse_currency('1-2')      <> 1       THEN RAISE EXCEPTION 'T14 FAIL "1-2"'; END IF;
  IF private.profile_parse_currency('1.2.3')    <> 1.2     THEN RAISE EXCEPTION 'T14 FAIL "1.2.3"'; END IF;
  -- Blank-ish inputs are NULL, never 0 — the OrNull semantics, not the 0-coercing parser.
  IF private.profile_parse_currency('')    IS NOT NULL THEN RAISE EXCEPTION 'T14 FAIL "" should be NULL'; END IF;
  IF private.profile_parse_currency('-')   IS NOT NULL THEN RAISE EXCEPTION 'T14 FAIL "-" should be NULL'; END IF;
  IF private.profile_parse_currency('.')   IS NOT NULL THEN RAISE EXCEPTION 'T14 FAIL "." should be NULL'; END IF;
  IF private.profile_parse_currency('abc') IS NOT NULL THEN RAISE EXCEPTION 'T14 FAIL "abc" should be NULL'; END IF;
  IF private.profile_parse_currency(NULL)  IS NOT NULL THEN RAISE EXCEPTION 'T14 FAIL NULL'; END IF;

  IF private.profile_parse_iso_date('2026-01-15') <> DATE '2026-01-15' THEN RAISE EXCEPTION 'T14 FAIL iso date'; END IF;
  IF private.profile_parse_iso_date(' 2026-01-15 ') <> DATE '2026-01-15' THEN RAISE EXCEPTION 'T14 FAIL padded iso date'; END IF;
  -- An impossible date is NULL, never to_date's silent roll-forward to 2026-03-03.
  IF private.profile_parse_iso_date('2026-02-31') IS NOT NULL THEN RAISE EXCEPTION 'T14 FAIL 2026-02-31 should be NULL'; END IF;
  IF private.profile_parse_iso_date('01/15/2026') IS NOT NULL THEN RAISE EXCEPTION 'T14 FAIL US format should be NULL'; END IF;
  IF private.profile_parse_iso_date('') IS NOT NULL THEN RAISE EXCEPTION 'T14 FAIL empty date'; END IF;

  RAISE NOTICE 'T14 OK  parsers match parseCurrencyToNumberOrNull and strict YYYY-MM-DD';
END $$;

-- =====================================================================================================
-- T15 — an empty book is a truthful zero, distinguishable from a failure by the caller
-- =====================================================================================================
DO $$
DECLARE b RECORD; n integer;
BEGIN
  PERFORM public.test_set_caller('aaaaaaaa-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-00000000000a');
  SELECT count(*) INTO n FROM public.get_profile_book_stats('self', NULL);
  IF n <> 1 THEN RAISE EXCEPTION 'T15 FAIL: an empty book returned % rows, expected exactly 1', n; END IF;

  SELECT * INTO b FROM public.get_profile_book_stats('self', NULL);
  IF b.total_clients <> 0 OR b.total_policies <> 0 THEN RAISE EXCEPTION 'T15 FAIL: expected zeros'; END IF;
  IF b.total_premium_monthly <> 0 THEN RAISE EXCEPTION 'T15 FAIL: premium should be 0, got %', b.total_premium_monthly; END IF;
  IF b.carrier_breakdown <> '[]'::jsonb OR b.policy_type_mix <> '[]'::jsonb THEN
    RAISE EXCEPTION 'T15 FAIL: empty breakdowns must be [], not NULL'; END IF;
  IF b.achievements -> 'largest_face' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'T15 FAIL: an unearned achievement must be null, not fabricated'; END IF;
  RAISE NOTICE 'T15 OK  an empty book returns exactly one honest row';
END $$;

DO $$ BEGIN RAISE NOTICE '';
RAISE NOTICE '================ ALL PROFILE RPC PROOFS PASSED (T0-T15) ================';
END $$;
