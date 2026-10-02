-- =====================================================================================================
-- Reports RPC suite — behaviour, metric canon and authorization for
-- supabase/migrations/20260929152553_reports_secure_scoped_rpcs.sql as amended by
-- supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql (Policies Sold =
-- normalized stored policies; the dedicated policy regressions live in reports_policy_facts.sql).
-- Run ONLY through scripts/run_reports_rpc_tests.sh on a disposable LOCAL database (AGENT_RULES #28).
-- Synthetic tenants and users only. Every expected number below was computed BY HAND from the fixture
-- table in this file (see the comments next to each fixture); none is read back from the function
-- under test.
-- =====================================================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;
SET TIME ZONE 'UTC';

-- The suite may run twice on one database (the runner re-runs it after disable/enable).
SET client_min_messages = warning;
DROP SCHEMA IF EXISTS rt CASCADE;
SET client_min_messages = notice;
CREATE SCHEMA rt;

CREATE TABLE rt.ids (name text PRIMARY KEY, id uuid NOT NULL UNIQUE);
INSERT INTO rt.ids VALUES
  ('O1', '10000000-0000-0000-0000-000000000001'), ('O2', '10000000-0000-0000-0000-000000000002'),
  ('O3', '10000000-0000-0000-0000-000000000003'),
  ('ADMIN',  '11000000-0000-0000-0000-0000000000a1'), ('SUPER',  '11000000-0000-0000-0000-0000000000a2'),
  ('SUPER2', '11000000-0000-0000-0000-0000000000a3'), ('TL',     '11000000-0000-0000-0000-0000000000b1'),
  ('A1',     '11000000-0000-0000-0000-0000000000c1'), ('A2',     '11000000-0000-0000-0000-0000000000c2'),
  ('A3',     '11000000-0000-0000-0000-0000000000c3'), ('INACT',  '11000000-0000-0000-0000-0000000000c4'),
  ('DEL',    '11000000-0000-0000-0000-0000000000c5'), ('A1B',    '11000000-0000-0000-0000-0000000000c6'),
  ('B_ADMIN','22000000-0000-0000-0000-0000000000a1'), ('B1',     '22000000-0000-0000-0000-0000000000c1'),
  ('C_ADMIN','33000000-0000-0000-0000-0000000000a1'),
  ('D_NA',   '11000000-0000-0000-0000-0000000000d1'), ('D_INT',  '11000000-0000-0000-0000-0000000000d2'),
  ('D_NI',   '11000000-0000-0000-0000-0000000000d3'), ('D_SOLD', '11000000-0000-0000-0000-0000000000d4'),
  ('D_DNC',  '11000000-0000-0000-0000-0000000000d5'), ('D_CB',   '11000000-0000-0000-0000-0000000000d6'),
  ('D_LEG',  '11000000-0000-0000-0000-0000000000d7'), ('D_APPT', '11000000-0000-0000-0000-0000000000d8'),
  ('D_B',    '22000000-0000-0000-0000-0000000000d1'),
  ('PS_CONV','11000000-0000-0000-0000-0000000000e1'),
  ('C1',     '11000000-0000-0000-0000-0000000000f1'), ('C2',     '11000000-0000-0000-0000-0000000000f2'),
  ('CB',     '22000000-0000-0000-0000-0000000000f1'),
  ('L1',     '11000000-0000-0000-0000-000000000011'), ('L2',     '11000000-0000-0000-0000-000000000012'),
  ('L3',     '11000000-0000-0000-0000-000000000013'), ('L4',     '11000000-0000-0000-0000-000000000014'),
  ('L5',     '11000000-0000-0000-0000-000000000015'), ('L6',     '11000000-0000-0000-0000-000000000016'),
  ('L7',     '11000000-0000-0000-0000-000000000017'), ('CL7',    '11000000-0000-0000-0000-000000000028'),
  ('CL1',    '11000000-0000-0000-0000-000000000021'), ('CL2',    '11000000-0000-0000-0000-000000000022'),
  ('CL3',    '11000000-0000-0000-0000-000000000023'),
  ('CL6A',   '11000000-0000-0000-0000-000000000026'), ('CL6B',   '11000000-0000-0000-0000-000000000027'),
  ('CLIENT99','11000000-0000-0000-0000-000000000099'),
  -- Stored-policy clients (Policies Sold source, migration 20260930120000; plan §20).
  ('LC99',   '11000000-0000-0000-0000-000000000098'), ('K_A3',   '11000000-0000-0000-0000-0000000000a9'),
  ('K_UN',   '11000000-0000-0000-0000-0000000000aa'), ('K_A1IN', '11000000-0000-0000-0000-0000000000ab'),
  ('K_A1OUT','11000000-0000-0000-0000-0000000000ac'), ('K_B1',   '22000000-0000-0000-0000-0000000000ab');

CREATE FUNCTION rt.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM rt.ids WHERE name = p $$;

-- Impersonate a caller exactly the way PostgREST does (claims GUC + role), inside the current txn.
CREATE FUNCTION rt.claims(p_uid uuid, p_org uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '{}' ELSE
      json_build_object('sub', p_uid, 'role', 'authenticated',
                        'app_metadata', json_build_object('organization_id', p_org))::text END, true);
$$;

-- Run p_sql as an authenticated caller and return its jsonb result.
CREATE FUNCTION rt.call(p_uid uuid, p_org uuid, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM rt.claims(p_uid, p_org);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE p_sql INTO v;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $$;

-- Run p_sql as p_role; 'OK' on success, else 'SQLSTATE:message'. Subtransaction resets role/claims.
CREATE FUNCTION rt.err(p_role text, p_uid uuid, p_org uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM rt.claims(p_uid, p_org);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
    EXECUTE 'RESET ROLE';
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ':' || SQLERRM;
  END;
END $$;

CREATE FUNCTION rt.summary(p_who text, p_start date, p_end date, p_agent text DEFAULT NULL, p_org text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT rt.call(rt.id(p_who), rt.id(coalesce(p_org, CASE WHEN p_who LIKE 'B%' THEN 'O2' WHEN p_who LIKE 'C\_%' THEN 'O3' ELSE 'O1' END)),
    format('SELECT public.get_report_call_summary(%L::date, %L::date, %s)', p_start, p_end,
           CASE WHEN p_agent IS NULL THEN 'NULL' ELSE quote_literal(rt.id(p_agent)) || '::uuid' END));
$$;

CREATE FUNCTION rt.rpc(p_fn text, p_who text, p_start date, p_end date, p_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT rt.call(rt.id(p_who), rt.id(CASE WHEN p_who LIKE 'B%' THEN 'O2' WHEN p_who LIKE 'C\_%' THEN 'O3' ELSE 'O1' END),
    format('SELECT public.%I(%L::date, %L::date, %s)', p_fn, p_start, p_end,
           CASE WHEN p_agent IS NULL THEN 'NULL' ELSE quote_literal(rt.id(p_agent)) || '::uuid' END));
$$;

CREATE FUNCTION rt.agent_row(p_payload jsonb, p_agent text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(p_payload -> 'by_agent') e WHERE (e ->> 'agent_id')::uuid = rt.id(p_agent);
$$;

CREATE FUNCTION rt.eq(p_label text, p_got anyelement, p_want anyelement) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION '% FAIL: got [%] want [%]', p_label, p_got, p_want;
  END IF;
END $$;

CREATE FUNCTION rt.denied(p_label text, p_result text, p_fragment text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_result NOT LIKE '42501:%' OR (p_fragment IS NOT NULL AND position(p_fragment IN p_result) = 0) THEN
    RAISE EXCEPTION '% FAIL: expected 42501%, got [%]', p_label,
      coalesce(' containing "' || p_fragment || '"', ''), p_result;
  END IF;
END $$;

-- The agency-time-zone configuration refusal (55000), never a report in a guessed zone.
CREATE FUNCTION rt.unconfigured(p_label text, p_result text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_result NOT LIKE '55000:%' OR position(p_fragment IN p_result) = 0 THEN
    RAISE EXCEPTION '% FAIL: expected 55000 containing "%", got [%]', p_label, p_fragment, p_result;
  END IF;
END $$;

-- =====================================================================================================
-- FIXTURES (synthetic). Report window W = 2026-07-01 .. 2026-07-31 in America/Los_Angeles (PDT, UTC-7):
-- [2026-07-01T07:00Z, 2026-08-01T07:00Z).
-- =====================================================================================================
TRUNCATE public.organizations, public.profiles, public.role_permissions, public.company_settings,
         public.pipeline_stages, public.dispositions, public.campaigns, public.leads, public.campaign_leads,
         public.calls, public.wins, public.appointments, public.dialer_sessions, public.clients CASCADE;

INSERT INTO public.organizations VALUES (rt.id('O1'), 'Alpha Agency'), (rt.id('O2'), 'Beta Agency'), (rt.id('O3'), 'Gamma Agency');

INSERT INTO public.profiles (id, organization_id, first_name, last_name, email, role, status, upline_id, is_super_admin) VALUES
  (rt.id('ADMIN'),  rt.id('O1'), 'Ada',  'Admin',     'ada@example.test',  'Admin',       'Active',   NULL,          false),
  (rt.id('SUPER'),  rt.id('O1'), 'Sam',  'Super',     'sam@example.test',  'Admin',       'Active',   NULL,          true),
  (rt.id('SUPER2'), rt.id('O1'), 'Sue',  'Superrole', 'sue@example.test',  'Super Admin', 'Active',   NULL,          true),
  (rt.id('TL'),     rt.id('O1'), 'Tina', 'Leader',    'tina@example.test', 'Team Leader', 'Active',   rt.id('ADMIN'), false),
  (rt.id('A1'),     rt.id('O1'), 'Alice','Agent',     'alice@example.test','Agent',       'Active',   rt.id('TL'),   false),
  (rt.id('A2'),     rt.id('O1'), 'Bob',  'Agent',     'bob@example.test',  'Agent',       'Active',   rt.id('TL'),   false),
  (rt.id('A3'),     rt.id('O1'), 'Carl', 'Agent',     'carl@example.test', 'Agent',       'Active',   rt.id('ADMIN'), false),
  (rt.id('INACT'),  rt.id('O1'), 'Ivy',  'Inactive',  'ivy@example.test',  'Agent',       'Inactive', rt.id('TL'),   false),
  (rt.id('DEL'),    rt.id('O1'), 'Dan',  'Deleted',   'dan@example.test',  'Agent',       'Deleted',  rt.id('TL'),   false),
  (rt.id('A1B'),    rt.id('O1'), 'Abe',  'Downline',  'abe@example.test',  'Agent',       'Active',   rt.id('A1'),   false),
  (rt.id('B_ADMIN'),rt.id('O2'), 'Bea',  'Boss',      'bea@example.test',  'Admin',       'Active',   NULL,          false),
  (rt.id('B1'),     rt.id('O2'), 'Ben',  'Beta',      'ben@example.test',  'Agent',       'Active',   rt.id('B_ADMIN'), false),
  (rt.id('C_ADMIN'),rt.id('O3'), 'Cy',   'Gamma',     'cy@example.test',   'Admin',       'Active',   NULL,          false);

-- Production-shaped permissions for O1 (read-only prod check 2026-09-28): Agent page ON, View Own ON,
-- View Team OFF, Export OFF, scope own; Team Leader page ON, View Own/Team ON, Export ON, scope team.
-- The SAME JSON is stored on both role rows; each role reads its own key. O2 has NO rows (defaults).
CREATE FUNCTION rt.perm(p_page_agent boolean, p_own_agent boolean, p_team_agent boolean, p_scope_agent text,
                        p_page_tl boolean, p_own_tl boolean, p_team_tl boolean, p_scope_tl text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'p', jsonb_build_array(
      jsonb_build_object('name', 'Dashboard', 'agent', true, 'teamLeader', true),
      jsonb_build_object('name', 'Reports', 'agent', p_page_agent, 'teamLeader', p_page_tl)),
    'f', jsonb_build_array(
      jsonb_build_object('category', 'Dialer', 'features', jsonb_build_array(
        jsonb_build_object('name', 'Manual Dial', 'agent', true, 'teamLeader', true))),
      jsonb_build_object('category', 'Reports', 'features', jsonb_build_array(
        jsonb_build_object('name', 'View Own Reports',  'agent', p_own_agent,  'teamLeader', p_own_tl),
        jsonb_build_object('name', 'View Team Reports', 'agent', p_team_agent, 'teamLeader', p_team_tl),
        jsonb_build_object('name', 'Export Reports',    'agent', false,        'teamLeader', true)))),
    'd', jsonb_build_array(
      jsonb_build_object('label', 'Leads & Contacts',    'agent', 'own',         'teamLeader', 'team'),
      jsonb_build_object('label', 'Dashboard & Reports', 'agent', p_scope_agent, 'teamLeader', p_scope_tl)),
    'c', '[]'::jsonb, 's', '[]'::jsonb);
$$;

CREATE FUNCTION rt.reset_perms() RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.role_permissions WHERE organization_id = rt.id('O1');
  INSERT INTO public.role_permissions (organization_id, role, permissions) VALUES
    (rt.id('O1'), 'Agent',       rt.perm(true, true, false, 'own', true, true, true, 'team')),
    (rt.id('O1'), 'Team Leader', rt.perm(true, true, false, 'own', true, true, true, 'team'));
$$;
\o /dev/null
SELECT rt.reset_perms();
\o

INSERT INTO public.company_settings (organization_id, timezone) VALUES
  (rt.id('O1'), 'America/Los_Angeles'),
  (rt.id('O3'), 'Not/AZone');            -- invalid on purpose (the production trigger would refuse it)
-- O2 has NO settings row -> official Reports fail closed (55000), never a guessed zone (T6, T15).

INSERT INTO public.pipeline_stages (id, name, convert_to_client, organization_id) VALUES
  (rt.id('PS_CONV'), 'Won', true, rt.id('O1'));

INSERT INTO public.dispositions (id, name, color, counts_as_contacted, dnc_auto_add, callback_scheduler, appointment_scheduler, pipeline_stage_id, organization_id) VALUES
  (rt.id('D_NA'),   'No Answer',       '#6B7281', false, false, false, false, NULL,             rt.id('O1')),
  (rt.id('D_INT'),  'Interested',      '#10B981', true,  false, false, false, NULL,             rt.id('O1')),
  (rt.id('D_NI'),   'Not Interested',  '#EF4444', false, false, false, false, NULL,             rt.id('O1')),
  (rt.id('D_SOLD'), 'Sold',            '#22C55E', true,  false, false, false, rt.id('PS_CONV'), rt.id('O1')),
  (rt.id('D_DNC'),  'DNC',             '#111827', false, true,  false, false, NULL,             rt.id('O1')),
  (rt.id('D_CB'),   'Call Back',       '#F59E0B', false, false, true,  false, NULL,             rt.id('O1')),
  (rt.id('D_LEG'),  'Legacy Hot',      '#8B5CF6', true,  false, false, false, NULL,             rt.id('O1')),
  (rt.id('D_APPT'), 'Appointment Set', '#0EA5E9', true,  false, false, true,  NULL,             rt.id('O1')),
  (rt.id('D_B'),    'Beta Only',       '#000000', true,  false, false, false, NULL,             rt.id('O2'));

INSERT INTO public.campaigns (id, name, type, user_id, organization_id) VALUES
  (rt.id('C1'), 'Spring Team', 'Team',     rt.id('ADMIN'), rt.id('O1')),
  (rt.id('C2'), 'Carl Personal', 'Personal', rt.id('A3'),  rt.id('O1')),
  (rt.id('CB'), 'Beta Campaign', 'Team',   rt.id('B_ADMIN'), rt.id('O2'));

-- Membership was absent from the former simplified harness. Match real Team read access.
UPDATE public.campaigns SET assigned_agent_ids = jsonb_build_array(rt.id('A1')::text, rt.id('A2')::text, rt.id('A1B')::text)
 WHERE id = rt.id('C1');

INSERT INTO public.leads (id, first_name, last_name, phone, lead_source, assigned_agent_id, user_id, created_at, organization_id) VALUES
  (rt.id('L1'), 'Lead', 'One',   '5550000001', 'Facebook', rt.id('A1'), rt.id('A1'), '2026-07-02T18:00:00Z', rt.id('O1')),
  (rt.id('L2'), 'Lead', 'Two',   '5550000002', ' Google ', rt.id('A2'), rt.id('A2'), '2026-07-03T18:00:00Z', rt.id('O1')),
  (rt.id('L3'), 'Lead', 'Three', '5550000003', 'Facebook', rt.id('A3'), rt.id('A3'), '2026-07-04T18:00:00Z', rt.id('O1')),
  (rt.id('L4'), 'Lead', 'Four',  '5550000004', '',         rt.id('A1'), rt.id('A1'), '2026-06-15T18:00:00Z', rt.id('O1')),
  (rt.id('L5'), 'Lead', 'Five',  '5550000005', 'Referral', rt.id('A2'), rt.id('A2'), '2026-07-20T18:00:00Z', rt.id('O1')),
  -- L6: ONE person with membership in TWO campaigns (T14). Created in May so no July test sees it.
  (rt.id('L6'), 'Lead', 'Six',   '5550000006', 'Referral', rt.id('A2'), rt.id('A2'), '2026-05-01T18:00:00Z', rt.id('O1')),
  -- L7: the Converted fallbacks (T14). Created in April so no July test sees it.
  (rt.id('L7'), 'Lead', 'Seven', '5550000007', 'Referral', rt.id('A1'), rt.id('A1'), '2026-04-01T18:00:00Z', rt.id('O1'));

INSERT INTO public.campaign_leads (id, campaign_id, lead_id, organization_id) VALUES
  (rt.id('CL1'), rt.id('C1'), rt.id('L1'), rt.id('O1')),
  (rt.id('CL2'), rt.id('C1'), rt.id('L2'), rt.id('O1')),
  (rt.id('CL3'), rt.id('C2'), rt.id('L3'), rt.id('O1')),
  (rt.id('CL6A'), rt.id('C1'), rt.id('L6'), rt.id('O1')),
  (rt.id('CL6B'), rt.id('C2'), rt.id('L6'), rt.id('O1')),
  (rt.id('CL7'),  rt.id('C1'), rt.id('L7'), rt.id('O1'));

-- Calls. id suffix = fixture number. started_at deliberately equals created_at except k25.
CREATE FUNCTION rt.call_row(p_n int, p_agent text, p_dir text, p_at timestamptz, p_dur int, p_disp text,
                            p_disp_name text, p_campaign text, p_cl text, p_contact uuid, p_contact_type text,
                            p_org text DEFAULT 'O1', p_started timestamptz DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.calls (id, agent_id, direction, created_at, started_at, duration, disposition_id, disposition_name,
                            campaign_id, campaign_lead_id, contact_id, contact_type, contact_phone, organization_id)
  VALUES (('11000000-0000-0000-0000-00000000' || lpad(p_n::text, 4, '0'))::uuid,
          rt.id(p_agent), p_dir, p_at, coalesce(p_started, p_at), p_dur,
          rt.id(p_disp), coalesce(p_disp_name, (SELECT name FROM public.dispositions WHERE id = rt.id(p_disp))),
          rt.id(p_campaign), rt.id(p_cl), p_contact, p_contact_type, '5559990000', rt.id(p_org));
$$;

\o /dev/null
--                n   agent    dir         created_at (UTC)          dur  disp      name override  camp  cl     contact           type
SELECT rt.call_row( 1, 'A1',    'outbound', '2026-07-10T17:00:00Z',   60, 'D_INT',  NULL,          'C1', 'CL1', rt.id('L1'), NULL);    -- contacted (>45)
SELECT rt.call_row( 2, 'A1',    'outbound', '2026-07-10T18:00:00Z',   10, 'D_NA',   NULL,          'C1', 'CL1', rt.id('L1'), NULL);    -- not contacted
SELECT rt.call_row( 3, 'A1',    'outbound', '2026-07-11T18:00:00Z',   50, 'D_NA',   NULL,          NULL, NULL,  rt.id('L1'), 'lead');  -- NO ANSWER wins over >45
SELECT rt.call_row( 4, 'A1',    'outbound', '2026-07-12T18:00:00Z',   20, 'D_INT',  NULL,          NULL, NULL,  rt.id('L1'), NULL);    -- contacted by flag
SELECT rt.call_row( 5, 'A1',    'outbound', '2026-07-12T19:00:00Z',   30, NULL,     'legacy HOT',  NULL, NULL,  rt.id('L4'), NULL);    -- contacted by org name fallback
SELECT rt.call_row( 6, 'A2',    'outbound', '2026-07-15T20:00:00Z',  120, 'D_SOLD', NULL,          'C1', 'CL2', rt.id('L2'), NULL);    -- contacted + converting
SELECT rt.call_row( 7, 'A2',    'outbound', '2026-07-16T20:00:00Z',    5, 'D_SOLD', NULL,          'C1', 'CL2', rt.id('L2'), NULL);    -- contacted (flag) + converting, same lead
SELECT rt.call_row( 8, 'A2',    'inbound',  '2026-07-15T21:00:00Z',  300, 'D_INT',  NULL,          NULL, NULL,  NULL,        NULL);    -- inbound: never Calls Made / Contacted
SELECT rt.call_row( 9, 'A3',    'outbound', '2026-07-20T20:00:00Z',   46, NULL,     NULL,          'C2', 'CL3', rt.id('L3'), NULL);    -- contacted (46 > 45), no disposition
SELECT rt.call_row(10, 'A3',    'outbound', '2026-07-20T21:00:00Z',   45, 'D_DNC',  NULL,          'C2', 'CL3', rt.id('L3'), NULL);    -- 45 is NOT > 45; DNC flag
SELECT rt.call_row(11, 'TL',    'outbound', '2026-07-05T16:00:00Z',    0, 'D_CB',   NULL,          NULL, NULL,  NULL,        NULL);    -- callback flag
SELECT rt.call_row(12, 'INACT', 'outbound', '2026-07-06T16:00:00Z',   70, 'D_NI',   NULL,          NULL, NULL,  NULL,        NULL);    -- contacted (>45)
SELECT rt.call_row(13, NULL,    'inbound',  '2026-07-07T16:00:00Z',   40, NULL,     NULL,          NULL, NULL,  NULL,        NULL);    -- unattributed inbound
SELECT rt.call_row(14, 'A1',    'outbound', '2026-08-01T06:59:59Z',   15, 'D_NA',   NULL,          NULL, NULL,  NULL,        NULL);    -- Jul 31 23:59:59 PDT: IN
SELECT rt.call_row(15, 'A1',    'outbound', '2026-08-01T07:00:00Z',   99, 'D_INT',  NULL,          NULL, NULL,  NULL,        NULL);    -- Aug 1 00:00 PDT: OUT
SELECT rt.call_row(16, 'A1',    'outbound', '2026-07-01T06:59:59Z',   99, 'D_INT',  NULL,          NULL, NULL,  NULL,        NULL);    -- Jun 30 PDT: OUT
SELECT rt.call_row(17, 'A1',    'outbound', '2026-07-01T07:00:00Z',   12, 'D_NI',   NULL,          NULL, NULL,  NULL,        NULL);    -- Jul 1 00:00 PDT: IN
SELECT rt.call_row(18, 'A1',    'outbound', '2026-07-13T18:00:00Z',   -5, 'D_NI',   NULL,          NULL, NULL,  NULL,        NULL);    -- negative clamps to 0
SELECT rt.call_row(19, 'A1',    'Outgoing', '2026-07-13T19:00:00Z',   47, 'D_NI',   NULL,          NULL, NULL,  NULL,        NULL);    -- 'Outgoing' counts as outbound
SELECT rt.call_row(20, 'A1',    'outbound', '2026-07-14T18:00:00Z',   20, NULL,     'Beta Only',   NULL, NULL,  NULL,        NULL);    -- other org's name: NOT contacted
SELECT rt.call_row(21, 'A1B',   'outbound', '2026-07-14T19:00:00Z',   80, 'D_APPT', NULL,          NULL, NULL,  NULL,        NULL);    -- contacted
SELECT rt.call_row(22, 'DEL',   'outbound', '2026-07-14T20:00:00Z',   50, 'D_NI',   NULL,          NULL, NULL,  NULL,        NULL);    -- deleted agent, contacted
SELECT rt.call_row(23, 'A1',    NULL,       '2026-07-14T21:00:00Z',   30, NULL,     NULL,          NULL, NULL,  NULL,        NULL);    -- NULL direction: 'other'
SELECT rt.call_row(24, 'A2',    'outbound', '2026-07-16T21:00:00Z',   60, 'D_SOLD', NULL,          NULL, NULL,  rt.id('CLIENT99'), 'client'); -- converting, client contact
SELECT rt.call_row(25, 'A1',    'outbound', '2026-06-20T18:00:00Z',   88, 'D_INT',  NULL,          NULL, NULL,  NULL,        NULL,
                   'O1', '2026-07-10T18:00:00Z');                                                                                       -- started in W, CREATED outside: OUT
SELECT rt.call_row(26, 'B1',    'outbound', '2026-07-10T18:00:00Z',  500, 'D_B',    NULL,          'CB', NULL,  NULL,        NULL, 'O2'); -- other tenant
-- DST (America/Los_Angeles falls back 2026-11-01 02:00 PDT -> 01:00 PST): Nov 1 is a 25-hour day.
SELECT rt.call_row(27, 'A2',    'outbound', '2026-11-01T07:30:00Z',   10, 'D_NI',   NULL,          NULL, NULL,  NULL,        NULL);    -- Nov 1 00:30 PDT
SELECT rt.call_row(28, 'A2',    'outbound', '2026-11-02T07:30:00Z',   10, 'D_NI',   NULL,          NULL, NULL,  NULL,        NULL);    -- Nov 1 23:30 PST
SELECT rt.call_row(29, 'A2',    'outbound', '2026-11-02T08:00:00Z',   10, 'D_NI',   NULL,          NULL, NULL,  NULL,        NULL);    -- Nov 2 00:00 PST
-- k30/k31 exist for the America/Havana midnight fall-back case in T9 (outside every Los Angeles window tested).
SELECT rt.call_row(30, 'A2',    'outbound', '2026-10-31T12:00:00Z',   10, 'D_NI',   NULL,          NULL, NULL,  NULL,        NULL);    -- Oct 31 08:00 CDT Havana
SELECT rt.call_row(31, 'A2',    'outbound', '2026-11-01T04:30:00Z',   10, 'D_NI',   NULL,          NULL, NULL,  NULL,        NULL);    -- Nov 1 00:30 CDT Havana (first 00:30)
-- k32/k33: the SAME contact (L6) converts through TWO different campaign_lead memberships in May (T14).
SELECT rt.call_row(32, 'A2',    'outbound', '2026-05-12T18:00:00Z',  120, 'D_SOLD', NULL,          'C1', 'CL6A', rt.id('L6'), 'lead');  -- converting via CL6A
SELECT rt.call_row(33, 'A2',    'outbound', '2026-05-14T18:00:00Z',   90, 'D_SOLD', NULL,          'C2', 'CL6B', rt.id('L6'), 'lead');  -- converting via CL6B
-- k34..k38 (April): the Converted FALLBACKS when a call carries no contact_id (T14).
SELECT rt.call_row(34, 'A1',    'outbound', '2026-04-10T18:00:00Z',   60, 'D_SOLD', NULL,          'C1', 'CL7', NULL,        NULL);    -- no contact -> campaign lead CL7
SELECT rt.call_row(35, 'A1',    'outbound', '2026-04-11T18:00:00Z',   60, 'D_SOLD', NULL,          'C1', 'CL7', NULL,        NULL);    -- same campaign lead -> same key
SELECT rt.call_row(36, 'A1',    'outbound', '2026-04-12T18:00:00Z',   60, 'D_SOLD', NULL,          NULL, NULL,  NULL,        NULL);    -- no contact, no campaign lead -> the call
SELECT rt.call_row(37, 'A1',    'outbound', '2026-04-13T18:00:00Z',   60, 'D_SOLD', NULL,          NULL, NULL,  NULL,        NULL);    -- another call -> its own key
SELECT rt.call_row(38, 'A1',    'outbound', '2026-04-14T18:00:00Z',   60, 'D_SOLD', NULL,          'C1', NULL,  rt.id('L7'), 'lead');  -- in C1 with NO campaign lead: contact L7

\o

-- Wins are an EVENT log and no longer a Reports source: every policy assertion below counts the STORED
-- policies (public.clients further down), which deliberately mirror these wins' agents and local dates
-- so the pre-existing expectations still hold. The wins stay to prove they are ignored.
INSERT INTO public.wins (id, agent_id, contact_id, campaign_id, created_at, organization_id, idempotency_key) VALUES
  ('11000000-0000-0000-0000-0000000005a1', rt.id('A2'), rt.id('CLIENT99'), rt.id('C1'), '2026-07-15T18:00:00Z', rt.id('O1'),
   'conversion:' || rt.id('LC99')),                                                                                   -- conversion win
  ('11000000-0000-0000-0000-0000000005a2', rt.id('A2'), rt.id('CLIENT99'), rt.id('C1'), '2026-07-15T18:05:00Z', rt.id('O1'), NULL), -- same client
  ('11000000-0000-0000-0000-0000000005a3', rt.id('A3'), NULL,              NULL,        '2026-07-21T18:00:00Z', rt.id('O1'), NULL),
  ('11000000-0000-0000-0000-0000000005a4', NULL,        NULL,              NULL,        '2026-07-22T18:00:00Z', rt.id('O1'), NULL), -- unattributed
  ('11000000-0000-0000-0000-0000000005a5', rt.id('A1'), NULL,              NULL,        '2026-08-01T07:00:00Z', rt.id('O1'), NULL), -- OUT (end)
  ('11000000-0000-0000-0000-0000000005a6', rt.id('A1'), NULL,              NULL,        '2026-07-01T07:00:00Z', rt.id('O1'), NULL), -- IN (start)
  ('11000000-0000-0000-0000-0000000005b1', rt.id('B1'), NULL,              rt.id('CB'), '2026-07-10T18:00:00Z', rt.id('O2'), NULL);

-- Stored policies (the Reports source). Hand-computed July: CLIENT99 (A2) = primary + 1 additional, both
-- sold 07-15 = 2; K_A3 (A3) 07-21 = 1; K_UN (unassigned) 07-22 = 1; K_A1IN (A1) 07-01 = 1 (first day, IN);
-- K_A1OUT (A1) 08-01 = OUT. Organization = 5, unattributed 1, A2 = 2; A1 own = 1; TL team (A1, A2) = 3.
-- CLIENT99's lineage (conversion win a1 + a2, both C1) attributes its 2 policies to C1. O2: K_B1 07-10.
INSERT INTO public.clients (id, first_name, last_name, carrier, policy_number, premium, sold_date, custom_fields, lead_id,
                            assigned_agent_id, created_at, organization_id) VALUES
  (rt.id('CLIENT99'), 'Client', 'NinetyNine', 'Americo', 'AM-99', 50, '2026-07-15',
   '{"additional_policies": [{"policyType": "Whole Life", "carrier": "Americo", "premiumAmount": "$30/mo", "soldDate": "2026-07-15"}]}',
   rt.id('LC99'), rt.id('A2'), '2026-07-15T18:00:00Z', rt.id('O1')),
  (rt.id('K_A3'),    'Kay', 'Three',   '', 'P-A3', 0,  '2026-07-21', NULL, NULL, rt.id('A3'), '2026-03-02T18:00:00Z', rt.id('O1')),
  (rt.id('K_UN'),    'Kay', 'Nobody',  '', '',     20, '2026-07-22', NULL, NULL, NULL,        '2026-03-02T18:00:00Z', rt.id('O1')),
  (rt.id('K_A1IN'),  'Kay', 'First',   'Aetna', '', 0, '2026-07-01', NULL, NULL, rt.id('A1'), '2026-06-30T18:00:00Z', rt.id('O1')),
  (rt.id('K_A1OUT'), 'Kay', 'Late',    'Aetna', '', 0, '2026-08-01', NULL, NULL, rt.id('A1'), '2026-07-31T18:00:00Z', rt.id('O1')),
  (rt.id('K_B1'),    'Kay', 'Beta',    'Aetna', '', 0, '2026-07-10', NULL, NULL, rt.id('B1'), '2026-07-10T18:00:00Z', rt.id('O2'));

INSERT INTO public.appointments (id, type, status, created_by, user_id, created_at, organization_id) VALUES
  ('11000000-0000-0000-0000-0000000006a1', 'Call',      'Scheduled', rt.id('A1'), NULL,        '2026-07-10T18:00:00Z', rt.id('O1')),
  ('11000000-0000-0000-0000-0000000006a2', 'Follow Up', 'Scheduled', NULL,        rt.id('A2'), '2026-07-11T18:00:00Z', rt.id('O1')), -- user_id rescue
  ('11000000-0000-0000-0000-0000000006a3', 'Call',      'Cancelled', rt.id('A3'), NULL,        '2026-07-12T18:00:00Z', rt.id('O1')), -- still counts
  ('11000000-0000-0000-0000-0000000006a4', 'Call',      'Scheduled', rt.id('A1'), NULL,        '2026-06-10T18:00:00Z', rt.id('O1')), -- OUT
  ('11000000-0000-0000-0000-0000000006a5', 'Call',      'Scheduled', NULL,        NULL,        '2026-07-13T18:00:00Z', rt.id('O1')); -- unattributed

INSERT INTO public.dialer_sessions (id, agent_id, started_at, ended_at, last_heartbeat_at, status, organization_id) VALUES
  ('11000000-0000-0000-0000-0000000007a1', rt.id('A1'), '2026-06-30T06:00:00Z', '2026-07-01T08:00:00Z', '2026-07-01T08:00:00Z', 'ended',     rt.id('O1')), -- clip -> 3600
  ('11000000-0000-0000-0000-0000000007a2', rt.id('A1'), '2026-07-10T16:00:00Z', '2026-07-10T16:30:00Z', '2026-07-10T16:30:00Z', 'ended',     rt.id('O1')), -- 1800
  ('11000000-0000-0000-0000-0000000007a3', rt.id('A2'), '2026-07-15T19:00:00Z', NULL,                   '2026-07-15T19:10:00Z', 'abandoned', rt.id('O1')), -- heartbeat -> 600
  ('11000000-0000-0000-0000-0000000007a4', rt.id('A1'), '2026-08-01T06:00:00Z', '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z', 'ended',     rt.id('O1')), -- clip -> 3600
  ('11000000-0000-0000-0000-0000000007a5', rt.id('A2'), '2026-08-02T06:00:00Z', '2026-08-02T08:00:00Z', '2026-08-02T08:00:00Z', 'ended',     rt.id('O1')), -- OUT
  ('11000000-0000-0000-0000-0000000007a6', rt.id('A3'), '2026-06-01T06:00:00Z', '2026-06-02T06:00:00Z', '2026-06-02T06:00:00Z', 'ended',     rt.id('O1')), -- OUT
  ('11000000-0000-0000-0000-0000000007a7', rt.id('TL'), '2026-07-31T06:00:00Z', NULL,                   '2026-07-31T06:05:00Z', 'active',    rt.id('O1')), -- active: now() -> clip to end = 90000
  ('11000000-0000-0000-0000-0000000007b1', rt.id('B1'), '2026-07-10T16:00:00Z', '2026-07-10T17:00:00Z', '2026-07-10T17:00:00Z', 'ended',     rt.id('O2'));

\echo '== fixtures loaded =='

DO $fixture_check$
BEGIN
  IF (SELECT count(*) FROM public.organizations) <> 3
     OR (SELECT count(*) FROM public.calls) <> 38
     OR (SELECT count(*) FROM public.campaigns) <> 3
     OR rt.id('A1') IS NULL OR rt.id('ADMIN') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.company_settings WHERE organization_id=rt.id('O1') AND timezone='America/Los_Angeles') THEN
    RAISE EXCEPTION 'REPORTS FIXTURE SETUP INCOMPLETE';
  END IF;
END
$fixture_check$;
