-- =====================================================================================================
-- Reports POLICIES SOLD regression suite — supabase/migrations/20260930120000_reports_policies_sold_
-- normalized_source.sql (implementation_plan.md §20 rev 2).
-- Run ONLY through scripts/run_reports_rpc_tests.sh on a disposable LOCAL database (AGENT_RULES #28),
-- AFTER supabase/tests/reports_rpc.sql on the same database: it reuses that suite's rt.* helpers,
-- tenants, users, campaigns and zone settings. Synthetic data only.
--
-- Every expected number is computed BY HAND from the fixture table below; none is read back from the
-- function under test. Window S = 2026-09-01 .. 2026-09-29 (agency zone America/Los_Angeles). Sale dates
-- are DATES, so no zone arithmetic applies to them.
--
--   client  agent  lineage (wins)                             policies (sale date)                 S?
--   PA      A1     conversion:LA -> C1                         primary 09-03                         1   A
--   PB      A1     none (manual, lead_id NULL), no win         primary 09-05                         1   B
--   PC      A2     conversion:LC -> C1 (ONE win)               primary 09-10 + add 09-11 + add 09-12 3   C
--   PD      A1     none                                        import defaults: NO evidence          0   D
--   PD2     A1     none                                        whitespace carrier, zeros: none       0   D
--   PE      A2     none                                        no primary; add issueDate 09-15       1   E
--   PE2     A2     none                                        add {soldDate '', issueDate 09-16},
--                                                             add {soldDate 2026-02-31, issueDate}  0   E (2 undated: server canon)
--   PF1     A3     none                                        primary 09-20; container = a STRING   1   F (+1 malformed)
--   PF2     A3     none                                        container = JSON null, no primary     0   F (+1 malformed)
--   PF3     A3     none                                        [valid 09-21, "str", 42, null, [1]]   1   F (+4 malformed)
--   PF4     A3     none                                        {"other": "x"} — no key               0   F (not malformed)
--   PG      A1     none                                        primary 08-31                         0   G
--   PG2     A1     none                                        primary 09-30                         0   G
--   PH      A2     none                                        add 10-01 + add with NO date          0   H (1 undated)
--   PU      —      none (unassigned)                           primary 09-08                         1   I (unattributed)
--   PK1     A1     conversion:LK1 -> C2 + 2 more C2 wins       primary 09-04 + add 09-04             2   K duplicate candidates
--   PK2     A1     conversion:LK2 -> C1, another win -> C2     primary 09-06                         1   K conflicting
--   PK3     A1     conversion:LK3 -> CB (O2's campaign)        primary 09-07                         1   K foreign campaign
--   PK4     A1     O2 win naming this O1 client (key LK4, CB)  primary 09-09                         1   K foreign win
--   PK5     A1     conversion:LK5, campaign NULL               primary 09-13                         1   K no campaign
--   PK6     A1     non-keyed win -> C1, lead_id NULL (manual)  primary 09-14                         1   K manual, never inferred
--   PR      A1     none                                        primary 09-25 (reassigned in R)       1   R
--   PX      B1     none                                        O2 client, primary 09-06              —   I (other tenant)
--
--   S totals: organization 17 = A1 10 (PA, PB, PK1 x2, PK2..PK6, PR) + A2 4 (PC x3, PE) + A3 2 (PF1, PF3)
--             + unattributed 1 (PU). Wins in S: 9 (never the answer).
--   Campaign-attributed in S: C1 4 (PA 1 + PC 3), C2 2 (PK1). Without campaign: 17 - 6 = 11.
--   Scope-wide, all-time quality (organization): undated 3 (PE2 x2, PH x1); malformed 6 (PF1 1 + PF2 1
--   + PF3 4). A1 own: 0 / 0. TL team (TL, A1, A2, A1B, INACT, DEL): undated 3, malformed 0.
--   J (organization O4, production shape): 4 stored policies sold 09-01..29, 2 wins -> 4.
-- =====================================================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;
SET TIME ZONE 'UTC';

INSERT INTO rt.ids VALUES
  ('PA',  '44000000-0000-0000-0000-0000000000a1'), ('PB',  '44000000-0000-0000-0000-0000000000a2'),
  ('PC',  '44000000-0000-0000-0000-0000000000a3'), ('PD',  '44000000-0000-0000-0000-0000000000a4'),
  ('PD2', '44000000-0000-0000-0000-0000000000a5'), ('PE',  '44000000-0000-0000-0000-0000000000a6'),
  ('PE2', '44000000-0000-0000-0000-0000000000a7'), ('PF1', '44000000-0000-0000-0000-0000000000a8'),
  ('PF2', '44000000-0000-0000-0000-0000000000a9'), ('PF3', '44000000-0000-0000-0000-0000000000aa'),
  ('PF4', '44000000-0000-0000-0000-0000000000ab'), ('PG',  '44000000-0000-0000-0000-0000000000ac'),
  ('PG2', '44000000-0000-0000-0000-0000000000ad'), ('PH',  '44000000-0000-0000-0000-0000000000ae'),
  ('PU',  '44000000-0000-0000-0000-0000000000af'), ('PK1', '44000000-0000-0000-0000-0000000000b1'),
  ('PK2', '44000000-0000-0000-0000-0000000000b2'), ('PK3', '44000000-0000-0000-0000-0000000000b3'),
  ('PK4', '44000000-0000-0000-0000-0000000000b4'), ('PK5', '44000000-0000-0000-0000-0000000000b5'),
  ('PK6', '44000000-0000-0000-0000-0000000000b6'), ('PR',  '44000000-0000-0000-0000-0000000000b7'),
  ('PX',  '44000000-0000-0000-0000-0000000000b8'),
  ('LA',  '44000000-0000-0000-0000-0000000001a1'), ('LC',  '44000000-0000-0000-0000-0000000001a3'),
  ('LK1', '44000000-0000-0000-0000-0000000001b1'), ('LK2', '44000000-0000-0000-0000-0000000001b2'),
  ('LK3', '44000000-0000-0000-0000-0000000001b3'), ('LK4', '44000000-0000-0000-0000-0000000001b4'),
  ('LK5', '44000000-0000-0000-0000-0000000001b5'),
  ('O4',      '40000000-0000-0000-0000-000000000004'),
  ('J_ADMIN', '44000000-0000-0000-0000-0000000004a1'), ('J_A1', '44000000-0000-0000-0000-0000000004c1'),
  ('J_A2',    '44000000-0000-0000-0000-0000000004c2'),
  ('J1', '44000000-0000-0000-0000-0000000004d1'), ('J2', '44000000-0000-0000-0000-0000000004d2'),
  ('J3', '44000000-0000-0000-0000-0000000004d3'), ('J4', '44000000-0000-0000-0000-0000000004d4'),
  ('JL1', '44000000-0000-0000-0000-0000000004e1'), ('JL2', '44000000-0000-0000-0000-0000000004e2')
ON CONFLICT (name) DO NOTHING;

-- Client fixture: carrier / number / premium / face / sold_date / custom_fields / lead / agent / org.
CREATE OR REPLACE FUNCTION rt.client(p_name text, p_agent text, p_sold date, p_custom jsonb DEFAULT NULL,
                                     p_lead text DEFAULT NULL, p_carrier text DEFAULT 'Mutual',
                                     p_number text DEFAULT '', p_premium numeric DEFAULT 0,
                                     p_face numeric DEFAULT 0, p_org text DEFAULT 'O1')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.clients (id, first_name, last_name, carrier, policy_number, premium, face_amount, sold_date,
                              custom_fields, lead_id, assigned_agent_id, created_at, organization_id)
  VALUES (rt.id(p_name), 'Policy', p_name, p_carrier, p_number, p_premium, p_face, p_sold, p_custom,
          rt.id(p_lead), rt.id(p_agent), '2026-01-05T18:00:00Z', rt.id(p_org));
$$;

-- A win (event row) on its client's sale day (18:00Z = 11:00 PDT); key 'conversion:<lead>' when p_lead is given.
CREATE OR REPLACE FUNCTION rt.win(p_n int, p_agent text, p_client text, p_campaign text, p_lead text,
                                  p_org text DEFAULT 'O1', p_at timestamptz DEFAULT '2026-09-02T18:00:00Z')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.wins (id, agent_id, contact_id, campaign_id, created_at, organization_id, idempotency_key)
  VALUES (('44000000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid, rt.id(p_agent), rt.id(p_client),
          rt.id(p_campaign), p_at, rt.id(p_org),
          CASE WHEN p_lead IS NULL THEN NULL ELSE 'conversion:' || rt.id(p_lead)::text END);
$$;

CREATE OR REPLACE FUNCTION rt.day_policies(p_payload jsonb, p_date text) RETURNS int LANGUAGE sql AS $$
  SELECT (e ->> 'policies_sold')::int FROM jsonb_array_elements(p_payload -> 'by_date') e WHERE e ->> 'date' = p_date;
$$;

CREATE OR REPLACE FUNCTION rt.campaign_row(p_payload jsonb, p_campaign text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(p_payload -> 'campaigns') e WHERE (e ->> 'campaign_id')::uuid = rt.id(p_campaign);
$$;

-- The suite may run twice on one database: remove only its own rows first.
DELETE FROM public.wins    WHERE id::text LIKE '44000000-%';
DELETE FROM public.clients WHERE id::text LIKE '44000000-%';
DELETE FROM public.calls   WHERE id::text LIKE '44000000-%';
DELETE FROM public.profiles WHERE organization_id = rt.id('O4');
DELETE FROM public.company_settings WHERE organization_id = rt.id('O4');
DELETE FROM public.organizations WHERE id = rt.id('O4');

\o /dev/null
--                  name   agent  sold          custom_fields                                                          lead
SELECT rt.client('PA',  'A1', '2026-09-03', NULL,                                                                  'LA', 'Mutual', 'PA-1', 40);
SELECT rt.client('PB',  'A1', '2026-09-05', NULL,                                                                  NULL, '',       'PB-1', 55);
SELECT rt.client('PC',  'A2', '2026-09-10',
  '{"additional_policies": [{"policyType": "Whole Life", "carrier": "Americo", "premiumAmount": "$30/mo", "soldDate": "2026-09-11"},
                            {"policyType": "Term", "carrier": "Aetna", "faceAmount": "10000", "soldDate": "2026-09-12"}]}', 'LC');
-- D: CSV-import defaults — policy_type 'Term', premium 0, face 0, blank carrier/number, no sale date.
SELECT rt.client('PD',  'A1', NULL, NULL, NULL, '', '', 0, 0);
SELECT rt.client('PD2', 'A1', NULL, '{"Gender": "F"}', NULL, '   ', '  ', 0, 0);
-- E: legacy issueDate is used only when soldDate is ABSENT (server canon; TypeScript differs — follow-up).
SELECT rt.client('PE',  'A2', NULL, '{"additional_policies": [{"policyType": "Term", "issueDate": "2026-09-15"}]}', NULL, '', '', 0, 0);
SELECT rt.client('PE2', 'A2', NULL,
  '{"additional_policies": [{"policyType": "Term", "soldDate": "", "issueDate": "2026-09-16"},
                            {"policyType": "Term", "soldDate": "2026-02-31", "issueDate": "2026-09-17"}]}', NULL, '', '', 0, 0);
-- F: malformed containers / elements.
SELECT rt.client('PF1', 'A3', '2026-09-20', '{"additional_policies": "[object Object]"}');
SELECT rt.client('PF2', 'A3', NULL,         '{"additional_policies": null}', NULL, '', '', 0, 0);
SELECT rt.client('PF3', 'A3', NULL,
  '{"additional_policies": [{"policyType": "Final Expense", "soldDate": "2026-09-21"}, "str", 42, null, [1]]}', NULL, '', '', 0, 0);
SELECT rt.client('PF4', 'A3', NULL, '{"other": "x"}', NULL, '', '', 0, 0);
-- G / H: outside S, and undated.
SELECT rt.client('PG',  'A1', '2026-08-31');
SELECT rt.client('PG2', 'A1', '2026-09-30');
SELECT rt.client('PH',  'A2', NULL,
  '{"additional_policies": [{"policyType": "Term", "soldDate": "2026-10-01"}, {"policyType": "Term", "carrier": "Aetna"}]}', NULL, '', '', 0, 0);
-- I: unassigned, and another tenant's client.
SELECT rt.client('PU',  NULL, '2026-09-08');
SELECT rt.client('PX',  'B1', '2026-09-06', NULL, NULL, 'Mutual', '', 0, 0, 'O2');
-- K: campaign lineage.
SELECT rt.client('PK1', 'A1', '2026-09-04', '{"additional_policies": [{"policyType": "Term", "soldDate": "2026-09-04"}]}', 'LK1');
SELECT rt.client('PK2', 'A1', '2026-09-06', NULL, 'LK2');
SELECT rt.client('PK3', 'A1', '2026-09-07', NULL, 'LK3');
SELECT rt.client('PK4', 'A1', '2026-09-09', NULL, 'LK4');
SELECT rt.client('PK5', 'A1', '2026-09-13', NULL, 'LK5');
SELECT rt.client('PK6', 'A1', '2026-09-14');
-- R: reassignment.
SELECT rt.client('PR',  'A1', '2026-09-25');

--             n  agent client  campaign lead
SELECT rt.win( 1, 'A1', 'PA',  'C1', 'LA',  'O1', '2026-09-03T18:00:00Z');
SELECT rt.win( 2, 'A2', 'PC',  'C1', 'LC',  'O1', '2026-09-10T18:00:00Z');
SELECT rt.win( 3, 'A1', 'PK1', 'C2', 'LK1', 'O1', '2026-09-04T18:00:00Z');
SELECT rt.win( 4, 'A1', 'PK1', 'C2', NULL,  'O1', '2026-09-04T18:01:00Z');  -- duplicate join candidate, same campaign
SELECT rt.win( 5, 'A1', 'PK1', 'C2', NULL,  'O1', '2026-09-04T18:02:00Z');  -- duplicate join candidate, same campaign
SELECT rt.win( 6, 'A1', 'PK2', 'C1', 'LK2', 'O1', '2026-09-06T18:00:00Z');
SELECT rt.win( 7, 'A1', 'PK2', 'C2', NULL,  'O1', '2026-09-06T18:01:00Z');  -- conflicting campaign evidence
SELECT rt.win( 8, 'A1', 'PK3', 'CB', 'LK3', 'O1', '2026-09-07T18:00:00Z');  -- O1 win naming O2's campaign
SELECT rt.win( 9, 'B1', 'PK4', 'CB', 'LK4', 'O2', '2026-09-09T18:00:00Z');  -- O2 win naming an O1 client: ignored
SELECT rt.win(10, 'A1', 'PK5', NULL, 'LK5', 'O1', '2026-09-13T18:00:00Z');  -- conversion with no campaign
SELECT rt.win(11, 'A1', 'PK6', 'C1', NULL,  'O1', '2026-09-14T18:00:00Z');  -- manual client + stray campaign win: never inferred

-- R: one call by A1 on the reassigned client's sale day (calls stay with the caller).
SELECT rt.call_row(4401, 'A1', 'outbound', '2026-09-25T18:00:00Z', 60, 'D_INT', NULL, NULL, NULL, rt.id('PR'), 'client');
\o
UPDATE public.calls SET id = '44000000-0000-0000-0000-000000004401'
 WHERE id = '11000000-0000-0000-0000-000000004401';

-- J: a production-shaped organization — 4 stored policies sold 09-01..29, only 2 of them with a win.
INSERT INTO public.organizations VALUES (rt.id('O4'), 'Juliet Agency');
INSERT INTO public.profiles (id, organization_id, first_name, last_name, email, role, status, upline_id, is_super_admin) VALUES
  (rt.id('J_ADMIN'), rt.id('O4'), 'Jo', 'Admin', 'jo@example.test',  'Admin', 'Active', NULL,             false),
  (rt.id('J_A1'),    rt.id('O4'), 'Jay','One',   'jay@example.test', 'Agent', 'Active', rt.id('J_ADMIN'), false),
  (rt.id('J_A2'),    rt.id('O4'), 'Jen','Two',   'jen@example.test', 'Agent', 'Active', rt.id('J_ADMIN'), false);
INSERT INTO public.company_settings (organization_id, timezone) VALUES (rt.id('O4'), 'America/Los_Angeles');
\o /dev/null
SELECT rt.client('J1', 'J_A1', '2026-09-08', NULL, 'JL1', 'Mutual', 'J-1', 45, 0, 'O4');  -- converted, has a win
SELECT rt.client('J2', 'J_A2', '2026-09-12', NULL, 'JL2', 'Aetna',  'J-2', 60, 0, 'O4');  -- converted, has a win
SELECT rt.client('J3', 'J_A1', '2026-09-17', NULL, NULL,  'Aetna',  'J-3', 35, 0, 'O4');  -- manual, NO win
SELECT rt.client('J4', 'J_A1', '2026-09-24', NULL, NULL,  'Mutual', 'J-4', 50, 0, 'O4');  -- manual, NO win
SELECT rt.win(21, 'J_A1', 'J1', NULL, 'JL1', 'O4', '2026-09-08T19:00:00Z');
SELECT rt.win(22, 'J_A2', 'J2', NULL, 'JL2', 'O4', '2026-09-12T19:00:00Z');
\o
\echo '== policy fixtures loaded =='

-- =====================================================================================================
-- P0 installation: helpers private and unreachable; replaced RPCs keep their security contract.
-- =====================================================================================================
DO $$
DECLARE v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY['private.report_policy_facts(uuid,uuid[])', 'private.report_policy_quality(uuid,uuid[])',
                               'private.report_policy_campaign_lineage(uuid,uuid[])'] LOOP
    IF has_function_privilege('authenticated', v_sig, 'EXECUTE') OR has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'P0 FAIL: % executable by a client role', v_sig;
    END IF;
  END LOOP;
  PERFORM rt.eq('P0 helper not callable by an authenticated caller',
    split_part(rt.err('authenticated', rt.id('ADMIN'), rt.id('O1'),
      format('SELECT count(*) FROM private.report_policy_facts(%L::uuid, NULL)', rt.id('O1'))), ':', 1), '42501');
  FOREACH v_sig IN ARRAY ARRAY['public.get_report_call_summary(date,date,uuid)', 'public.get_report_call_volume(date,date,uuid)',
                               'public.get_report_campaign_performance(date,date,uuid)'] LOOP
    PERFORM rt.eq('P0 ' || v_sig || ' SECURITY DEFINER STABLE pinned path',
      (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
         FROM pg_proc p WHERE p.oid = v_sig::regprocedure), true);
    -- The grantee SET (element order changes after a disable/enable cycle; the privileges do not).
    PERFORM rt.eq('P0 ' || v_sig || ' EXECUTE grantees',
      (SELECT array_agg(g ORDER BY g) FROM (
         SELECT coalesce(r.rolname, 'PUBLIC') || ':' || a.privilege_type AS g
           FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
          WHERE p.oid = v_sig::regprocedure) x),
      ARRAY['authenticated:EXECUTE', 'postgres:EXECUTE', 'service_role:EXECUTE']);
  END LOOP;
  RAISE NOTICE 'P0 OK  helpers private; replaced RPCs keep SECURITY DEFINER / STABLE / search_path / exact ACL';
END $$;

-- =====================================================================================================
-- A / B / C — converted, manual and multi-policy clients (single-day windows isolate each client)
-- =====================================================================================================
DO $$
DECLARE j jsonb;
BEGIN
  j := rt.summary('ADMIN', '2026-09-03', '2026-09-03');
  PERFORM rt.eq('A converted client: 1 primary + 1 win = 1 policy', (j -> 'totals' ->> 'policies_sold')::int, 1);
  PERFORM rt.eq('A payload declares the policy source', j ->> 'policy_source', 'normalized_policies');
  PERFORM rt.eq('A agent attribution basis', j -> 'policy_basis' ->> 'agent_attribution', 'current_assignment');
  PERFORM rt.eq('A sale date basis', j -> 'policy_basis' ->> 'sale_date', 'policy_sold_date');

  j := rt.summary('ADMIN', '2026-09-05', '2026-09-05');
  PERFORM rt.eq('B manual client: valid primary, NO win = 1 policy', (j -> 'totals' ->> 'policies_sold')::int, 1);
  PERFORM rt.eq('B credited to A1 (current assignment)', (rt.agent_row(j, 'A1') ->> 'policies_sold')::int, 1);
  j := rt.rpc('get_report_call_volume', 'ADMIN', '2026-09-01', '2026-09-29');
  PERFORM rt.eq('B manual client on the policies chart (09-05)', rt.day_policies(j, '2026-09-05'), 1);
  PERFORM rt.eq('A converted client on the policies chart (09-03)', rt.day_policies(j, '2026-09-03'), 1);

  j := rt.summary('ADMIN', '2026-09-10', '2026-09-12');
  PERFORM rt.eq('C one client: 1 primary + 2 additional, ONE win = 3 policies', (j -> 'totals' ->> 'policies_sold')::int, 3);
  PERFORM rt.eq('C all three credited to A2', (rt.agent_row(j, 'A2') ->> 'policies_sold')::int, 3);
  j := rt.rpc('get_report_call_volume', 'ADMIN', '2026-09-10', '2026-09-12');
  PERFORM rt.eq('C chart day 09-10 (primary)',    rt.day_policies(j, '2026-09-10'), 1);
  PERFORM rt.eq('C chart day 09-11 (additional)', rt.day_policies(j, '2026-09-11'), 1);
  PERFORM rt.eq('C chart day 09-12 (additional)', rt.day_policies(j, '2026-09-12'), 1);
  RAISE NOTICE 'A/B/C OK  converted = 1, manual (no win) = 1, one client with three policies and one win = 3';
END $$;

-- =====================================================================================================
-- D — no policy evidence contributes no policy; E — legacy issueDate; F — malformed data
-- =====================================================================================================
DO $$
DECLARE j jsonb;
BEGIN
  PERFORM rt.eq('D import-default client -> 0 policies',
    (SELECT count(*) FROM private.report_policy_facts(rt.id('O1'), NULL) WHERE client_id = rt.id('PD'))::int, 0);
  PERFORM rt.eq('D whitespace carrier/number, zero amounts -> 0 policies',
    (SELECT count(*) FROM private.report_policy_facts(rt.id('O1'), NULL) WHERE client_id = rt.id('PD2'))::int, 0);

  j := rt.summary('ADMIN', '2026-09-01', '2026-09-29');
  PERFORM rt.eq('D/E/H undated policies (scope-wide, all time): PE2 x2 + PH x1',
    (j -> 'policy_quality' ->> 'undated_policies')::int, 3);
  PERFORM rt.eq('F malformed (string 1 + JSON null 1 + 4 non-object elements)',
    (j -> 'policy_quality' ->> 'malformed_additional_policies')::int, 6);
  PERFORM rt.eq('F quality basis is labelled scope-wide, all-time', j -> 'policy_quality' ->> 'basis', 'scope_wide_all_time');

  j := rt.rpc('get_report_call_volume', 'ADMIN', '2026-09-01', '2026-09-29');
  PERFORM rt.eq('E additional with only legacy issueDate counts on that date', rt.day_policies(j, '2026-09-15'), 1);
  PERFORM rt.eq('E blank soldDate does NOT fall back to issueDate (server canon)', rt.day_policies(j, '2026-09-16'), 0);
  PERFORM rt.eq('E impossible soldDate does NOT fall back to issueDate (server canon)', rt.day_policies(j, '2026-09-17'), 0);
  PERFORM rt.eq('E server canon agrees with get_profile_book_stats: PE2 is two UNDATED policies',
    (SELECT count(*) FROM private.report_policy_facts(rt.id('O1'), NULL) WHERE client_id = rt.id('PE2') AND sold_date IS NULL)::int, 2);
  PERFORM rt.eq('F string container: primary still counts (09-20)', rt.day_policies(j, '2026-09-20'), 1);
  PERFORM rt.eq('F JSON-null container: no phantom policy',
    (SELECT count(*) FROM private.report_policy_facts(rt.id('O1'), NULL) WHERE client_id = rt.id('PF2'))::int, 0);
  PERFORM rt.eq('F mixed array: only the object element counts (09-21)', rt.day_policies(j, '2026-09-21'), 1);
  PERFORM rt.eq('F mixed array: exactly one policy for PF3',
    (SELECT count(*) FROM private.report_policy_facts(rt.id('O1'), NULL) WHERE client_id = rt.id('PF3'))::int, 1);
  PERFORM rt.eq('F volume carries the same quality counts', (j -> 'policy_quality' ->> 'malformed_additional_policies')::int, 6);
  PERFORM rt.eq('F volume declares the policy source', j ->> 'policy_source', 'normalized_policies');
  RAISE NOTICE 'D/E/F OK  no evidence = 0; issueDate only when soldDate absent; malformed never fabricates, always counted';
END $$;

-- =====================================================================================================
-- G / H — sale dates outside the window are excluded; an undated policy is never placed in a period
-- =====================================================================================================
DO $$
DECLARE j jsonb;
BEGIN
  j := rt.summary('ADMIN', '2026-09-01', '2026-09-29');
  PERFORM rt.eq('G/H S total (17 dated in window; 08-31, 09-30, 10-01 and undated excluded)',
    (j -> 'totals' ->> 'policies_sold')::int, 17);
  PERFORM rt.eq('G primary sold 08-31 counts only on 08-31', (rt.summary('ADMIN', '2026-08-31', '2026-08-31') -> 'totals' ->> 'policies_sold')::int, 1);
  PERFORM rt.eq('G primary sold 09-30 counts only on 09-30', (rt.summary('ADMIN', '2026-09-30', '2026-09-30') -> 'totals' ->> 'policies_sold')::int, 1);
  PERFORM rt.eq('H additional sold 10-01 counts only on 10-01', (rt.summary('ADMIN', '2026-10-01', '2026-10-01') -> 'totals' ->> 'policies_sold')::int, 1);
  j := rt.rpc('get_report_call_volume', 'ADMIN', '2026-09-01', '2026-09-29');
  PERFORM rt.eq('G/H by_date sums to the summary total',
    (SELECT sum((e ->> 'policies_sold')::int) FROM jsonb_array_elements(j -> 'by_date') e)::int, 17);
  -- An undated policy is never assigned created_at (every fixture client was created 2026-01-05).
  PERFORM rt.eq('H nothing lands on the clients'' created_at date',
    (rt.summary('ADMIN', '2026-01-05', '2026-01-05') -> 'totals' ->> 'policies_sold')::int, 0);
  RAISE NOTICE 'G/H OK  window is inclusive of its agency dates only; undated never dated by created_at';
END $$;

-- =====================================================================================================
-- I — own / team / organization / single-agent scope never widens
-- =====================================================================================================
DO $$
DECLARE j jsonb;
BEGIN
  j := rt.summary('ADMIN', '2026-09-01', '2026-09-29');
  PERFORM rt.eq('I org A1', (rt.agent_row(j, 'A1') ->> 'policies_sold')::int, 10);
  PERFORM rt.eq('I org A2', (rt.agent_row(j, 'A2') ->> 'policies_sold')::int, 4);
  PERFORM rt.eq('I org A3', (rt.agent_row(j, 'A3') ->> 'policies_sold')::int, 2);
  PERFORM rt.eq('I org unattributed (unassigned client)', (j -> 'unattributed' ->> 'policies_sold')::int, 1);

  j := rt.summary('A1', '2026-09-01', '2026-09-29');
  PERFORM rt.eq('I own scope = own policies only', (j -> 'totals' ->> 'policies_sold')::int, 10);
  PERFORM rt.eq('I own scope: no unattributed leak', (j -> 'unattributed' ->> 'policies_sold')::int, 0);
  PERFORM rt.eq('I own quality is own-scope (A1 has none undated)', (j -> 'policy_quality' ->> 'undated_policies')::int, 0);
  PERFORM rt.eq('I own quality: another agent''s malformed data not counted', (j -> 'policy_quality' ->> 'malformed_additional_policies')::int, 0);
  PERFORM rt.denied('I agent cannot ask for another agent', rt.err('authenticated', rt.id('A1'), rt.id('O1'),
    format('SELECT public.get_report_call_summary(''2026-09-01'', ''2026-09-29'', %L)', rt.id('A2'))), 'outside your report scope');

  j := rt.summary('TL', '2026-09-01', '2026-09-29');
  PERFORM rt.eq('I team scope = A1 + A2 (A3 and unassigned excluded)', (j -> 'totals' ->> 'policies_sold')::int, 14);
  PERFORM rt.eq('I team: A3 absent', rt.agent_row(j, 'A3'), NULL::jsonb);
  PERFORM rt.eq('I team quality undated (A2)', (j -> 'policy_quality' ->> 'undated_policies')::int, 3);
  PERFORM rt.eq('I team quality malformed (A3 outside team)', (j -> 'policy_quality' ->> 'malformed_additional_policies')::int, 0);
  PERFORM rt.eq('I team volume never includes A3',
    (SELECT sum((e ->> 'policies_sold')::int) FROM jsonb_array_elements(rt.rpc('get_report_call_volume', 'TL', '2026-09-01', '2026-09-29') -> 'by_date') e)::int, 14);
  PERFORM rt.denied('I team leader cannot ask for A3', rt.err('authenticated', rt.id('TL'), rt.id('O1'),
    format('SELECT public.get_report_call_volume(''2026-09-01'', ''2026-09-29'', %L)', rt.id('A3'))), 'outside your report scope');

  j := rt.summary('ADMIN', '2026-09-01', '2026-09-29', 'A3');
  PERFORM rt.eq('I admin single-agent filter narrows to A3', (j -> 'totals' ->> 'policies_sold')::int, 2);
  PERFORM rt.eq('I single-agent filter: no unattributed', (j -> 'unattributed' ->> 'policies_sold')::int, 0);
  PERFORM rt.eq('I single-agent filter quality is that agent''s', (j -> 'policy_quality' ->> 'malformed_additional_policies')::int, 6);
  PERFORM rt.eq('I single-agent volume', (SELECT sum((e ->> 'policies_sold')::int)
    FROM jsonb_array_elements(rt.rpc('get_report_call_volume', 'ADMIN', '2026-09-01', '2026-09-29', 'A3') -> 'by_date') e)::int, 2);

  -- The other tenant (configured for this block only) sees only its own client; O1 never sees PX.
  INSERT INTO public.company_settings (organization_id, timezone) VALUES (rt.id('O2'), 'America/Chicago');
  j := rt.summary('B_ADMIN', '2026-09-01', '2026-09-29');
  PERFORM rt.eq('I tenant isolation: O2 sees only PX', (j -> 'totals' ->> 'policies_sold')::int, 1);
  DELETE FROM public.company_settings WHERE organization_id = rt.id('O2');
  PERFORM rt.eq('I O1 never includes the O2 client', (rt.summary('ADMIN', '2026-09-06', '2026-09-06') -> 'totals' ->> 'policies_sold')::int, 1);
  RAISE NOTICE 'I OK  own / team / organization / single-agent / tenant scopes never widen';
END $$;

-- =====================================================================================================
-- K — campaign attribution by conversion lineage only
-- =====================================================================================================
DO $$
DECLARE j jsonb;
BEGIN
  j := rt.rpc('get_report_campaign_performance', 'ADMIN', '2026-09-01', '2026-09-29');
  PERFORM rt.eq('K C1 attributed (PA 1 + PC primary + 2 additional)', (rt.campaign_row(j, 'C1') ->> 'attributed_policies')::int, 4);
  PERFORM rt.eq('K C2 duplicate join candidates never multiply (PK1 = 2 policies, 3 wins)',
    (rt.campaign_row(j, 'C2') ->> 'attributed_policies')::int, 2);
  PERFORM rt.eq('K other tenant campaign never listed', rt.campaign_row(j, 'CB'), NULL::jsonb);
  PERFORM rt.eq('K policies in period = the summary total', (j ->> 'policies_in_period')::int, 17);
  PERFORM rt.eq('K without campaign (manual, conflicting, foreign, no-campaign, unassigned, ...)',
    (j ->> 'policies_attribution_unavailable')::int, 11);
  PERFORM rt.eq('K each policy contributes at most once',
    (SELECT sum((e ->> 'attributed_policies')::int) FROM jsonb_array_elements(j -> 'campaigns') e)::int
      + (j ->> 'policies_attribution_unavailable')::int, 17);
  PERFORM rt.eq('K attribution basis', j ->> 'policy_attribution', 'conversion_lineage_only');
  PERFORM rt.eq('K no COUNT(wins) field', rt.campaign_row(j, 'C1') ? 'policies_sold', false);
  PERFORM rt.eq('K no conversion rate / ROI', (rt.campaign_row(j, 'C1') ? 'conversion_rate_pct') OR (j ? 'roi'), false);

  PERFORM rt.eq('K conflicting campaigns -> unattributed (PK2)',
    (SELECT campaign_id FROM private.report_policy_campaign_lineage(rt.id('O1'), NULL) WHERE client_id = rt.id('PK2')), NULL::uuid);
  PERFORM rt.eq('K foreign-organization campaign -> unattributed (PK3)',
    (SELECT campaign_id FROM private.report_policy_campaign_lineage(rt.id('O1'), NULL) WHERE client_id = rt.id('PK3')), NULL::uuid);
  PERFORM rt.eq('K a foreign organization''s win is never lineage (PK4)',
    (SELECT count(*) FROM private.report_policy_campaign_lineage(rt.id('O1'), NULL) WHERE client_id = rt.id('PK4'))::int, 0);
  PERFORM rt.eq('K manual client with a stray campaign win is never inferred (PK6)',
    (SELECT count(*) FROM private.report_policy_campaign_lineage(rt.id('O1'), NULL) WHERE client_id = rt.id('PK6'))::int, 0);
  PERFORM rt.eq('K lineage is one row per client',
    (SELECT count(*) - count(DISTINCT client_id) FROM private.report_policy_campaign_lineage(rt.id('O1'), NULL))::int, 0);

  j := rt.rpc('get_report_campaign_performance', 'A2', '2026-09-01', '2026-09-29');
  PERFORM rt.eq('K agent scope: A2 sees only own attributed policies (PC in C1)', (rt.campaign_row(j, 'C1') ->> 'attributed_policies')::int, 3);
  PERFORM rt.eq('K agent scope: no C2 (A1''s)', rt.campaign_row(j, 'C2'), NULL::jsonb);
  PERFORM rt.eq('K agent scope: policies in period = own', (j ->> 'policies_in_period')::int, 4);
  RAISE NOTICE 'K OK  conversion-lineage attribution: once per policy; conflicting / foreign / manual unattributed';
END $$;

-- =====================================================================================================
-- J — production-shaped reconciliation: 4 stored policies vs 2 wins -> 4
-- =====================================================================================================
DO $$
DECLARE j jsonb; v jsonb;
BEGIN
  PERFORM rt.eq('J wins in the window (the old, wrong answer)',
    (SELECT count(*) FROM public.wins WHERE organization_id = rt.id('O4')
       AND created_at >= '2026-09-01T07:00:00Z' AND created_at < '2026-09-30T07:00:00Z')::int, 2);
  j := rt.call(rt.id('J_ADMIN'), rt.id('O4'), 'SELECT public.get_report_call_summary(''2026-09-01'', ''2026-09-29'', NULL)');
  PERFORM rt.eq('J Reports policy total follows stored policies, not wins', (j -> 'totals' ->> 'policies_sold')::int, 4);
  PERFORM rt.eq('J J_A1 (current assignment)', (rt.agent_row(j, 'J_A1') ->> 'policies_sold')::int, 3);
  PERFORM rt.eq('J J_A2 (current assignment)', (rt.agent_row(j, 'J_A2') ->> 'policies_sold')::int, 1);
  v := rt.call(rt.id('J_ADMIN'), rt.id('O4'), 'SELECT public.get_report_call_volume(''2026-09-01'', ''2026-09-29'', NULL)');
  PERFORM rt.eq('J policy chart sums to 4', (SELECT sum((e ->> 'policies_sold')::int) FROM jsonb_array_elements(v -> 'by_date') e)::int, 4);
  RAISE NOTICE 'J OK  September reconciliation: 4 stored policies, 2 wins -> Reports says 4';
END $$;

-- =====================================================================================================
-- R — reassignment moves the current-assignment breakdown, never the total, never the calls
-- =====================================================================================================
DO $$
DECLARE b jsonb; a jsonb;
BEGIN
  b := rt.summary('ADMIN', '2026-09-25', '2026-09-25');
  PERFORM rt.eq('R before: A1 holds PR', (rt.agent_row(b, 'A1') ->> 'policies_sold')::int, 1);
  PERFORM rt.eq('R before: A1 made the call', (rt.agent_row(b, 'A1') ->> 'calls_made')::int, 1);

  UPDATE public.clients SET assigned_agent_id = rt.id('A2') WHERE id = rt.id('PR');
  a := rt.summary('ADMIN', '2026-09-25', '2026-09-25');
  PERFORM rt.eq('R after: breakdown moves to the new owner (A2)', (rt.agent_row(a, 'A2') ->> 'policies_sold')::int, 1);
  PERFORM rt.eq('R after: A1 no longer credited', (rt.agent_row(a, 'A1') ->> 'policies_sold')::int, 0);
  PERFORM rt.eq('R after: organization total unchanged', (a -> 'totals' ->> 'policies_sold')::int, (b -> 'totals' ->> 'policies_sold')::int);
  PERFORM rt.eq('R after: the call stays with the calling agent (A1)', (rt.agent_row(a, 'A1') ->> 'calls_made')::int, 1);
  PERFORM rt.eq('R after: A2 gains no calls', (rt.agent_row(a, 'A2') ->> 'calls_made')::int, 0);
  PERFORM rt.eq('R the payload says the breakdown is current assignment, not seller credit',
    a -> 'policy_basis' ->> 'agent_attribution', 'current_assignment');
  UPDATE public.clients SET assigned_agent_id = rt.id('A1') WHERE id = rt.id('PR');
  RAISE NOTICE 'R OK  reassignment moves the current-assignment breakdown; total and call credit unchanged';
END $$;

-- =====================================================================================================
-- Z — static source contract (last, so the behavioural assertions above are what catch a reversion)
-- =====================================================================================================
DO $$
DECLARE v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY['public.get_report_call_summary(date,date,uuid)', 'public.get_report_call_volume(date,date,uuid)',
                               'public.get_report_campaign_performance(date,date,uuid)', 'private.report_policy_facts(uuid,uuid[])'] LOOP
    PERFORM rt.eq('Z ' || v_sig || ' never reads wins', (SELECT prosrc FROM pg_proc WHERE oid = v_sig::regprocedure) LIKE '%public.wins%', false);
  END LOOP;
  RAISE NOTICE 'Z OK  no policy count reads public.wins (lineage alone consults wins, for campaign attribution only)';
END $$;

\echo '================ ALL REPORTS POLICY PROOFS PASSED (P0, A-K, J, R, Z) ================'
