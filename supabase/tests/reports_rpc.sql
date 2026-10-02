-- Behavioral assertions. Fixture failures are fatal, including in mutation builds.
\set ON_ERROR_STOP on
\ir reports_fixtures.sql


-- =====================================================================================================
-- T0 installation metadata
-- =====================================================================================================
DO $$
DECLARE v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY['public.get_report_scope()', 'public.get_report_call_summary(date,date,uuid)',
    'public.get_report_call_volume(date,date,uuid)', 'public.get_report_disposition_breakdown(date,date,uuid)',
    'public.get_report_campaign_performance(date,date,uuid)', 'public.get_report_lead_source_performance(date,date,uuid)'] LOOP
    PERFORM rt.eq('T0 ' || v_sig || ' secdef/stable/search_path',
      (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
         FROM pg_proc p WHERE p.oid = to_regprocedure(v_sig)), true);
    PERFORM rt.eq('T0 ' || v_sig || ' owner', (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure(v_sig)), 'postgres');
  END LOOP;
  -- No organization parameter anywhere in the public Reports API.
  PERFORM rt.eq('T0 no org parameter',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'get\_report\_%'
        AND (p.proargnames && ARRAY['p_org_id', 'p_organization_id', 'p_org'] OR p.proargnames && ARRAY['p_time_zone', 'p_timezone'])), 0::bigint);
  RAISE NOTICE 'T0 OK  six RPCs installed: SECURITY DEFINER, STABLE, search_path pinned, no org / time-zone parameter';
END $$;

-- =====================================================================================================
-- T1 grants — anon / PUBLIC can execute nothing; legacy sealed; private unreachable
-- =====================================================================================================
DO $$
DECLARE v_sig text; r text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY['public.get_report_scope()', 'public.get_report_call_summary(date,date,uuid)',
    'public.get_report_call_volume(date,date,uuid)', 'public.get_report_disposition_breakdown(date,date,uuid)',
    'public.get_report_campaign_performance(date,date,uuid)', 'public.get_report_lead_source_performance(date,date,uuid)'] LOOP
    PERFORM rt.eq('T1 anon ' || v_sig, has_function_privilege('anon', v_sig, 'EXECUTE'), false);
    PERFORM rt.eq('T1 authenticated ' || v_sig, has_function_privilege('authenticated', v_sig, 'EXECUTE'), true);
    PERFORM rt.eq('T1 PUBLIC ' || v_sig,
      EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               WHERE p.oid = to_regprocedure(v_sig) AND a.grantee = 0), false);
  END LOOP;
  FOREACH v_sig IN ARRAY ARRAY['public.rpc_report_call_summary(uuid,timestamptz,timestamptz,uuid)',
    'public.rpc_report_call_volume_timeseries(uuid,timestamptz,timestamptz,uuid)',
    'public.rpc_report_campaign_performance(uuid,timestamptz,timestamptz,uuid)',
    'public.rpc_report_disposition_breakdown(uuid,timestamptz,timestamptz,uuid)'] LOOP
    PERFORM rt.eq('T1 legacy anon ' || v_sig, has_function_privilege('anon', v_sig, 'EXECUTE'), false);
    PERFORM rt.eq('T1 legacy authenticated ' || v_sig, has_function_privilege('authenticated', v_sig, 'EXECUTE'), false);
  END LOOP;
  -- Actual calls, not just catalog privileges.
  r := rt.err('anon', NULL, NULL, 'SELECT public.get_report_scope()');
  IF r NOT LIKE '42501:permission denied for function%' THEN RAISE EXCEPTION 'T1 FAIL anon scope call: %', r; END IF;
  r := rt.err('anon', NULL, NULL, 'SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', NULL)');
  IF r NOT LIKE '42501:permission denied for function%' THEN RAISE EXCEPTION 'T1 FAIL anon summary call: %', r; END IF;
  r := rt.err('anon', NULL, NULL, format('SELECT public.rpc_report_call_summary(%L, now() - interval ''1 year'', now(), NULL)', rt.id('O1')));
  IF r NOT LIKE '42501:permission denied for function%' THEN RAISE EXCEPTION 'T1 FAIL anon legacy call: %', r; END IF;
  r := rt.err('authenticated', rt.id('ADMIN'), rt.id('O1'), format('SELECT public.rpc_report_call_summary(%L, now() - interval ''1 year'', now(), NULL)', rt.id('O2')));
  IF r NOT LIKE '42501:permission denied for function%' THEN RAISE EXCEPTION 'T1 FAIL authenticated legacy cross-org call: %', r; END IF;
  r := rt.err('authenticated', rt.id('ADMIN'), rt.id('O1'), 'SELECT * FROM private.report_access(NULL)');
  IF r NOT LIKE '42501:permission denied for schema private%' THEN RAISE EXCEPTION 'T1 FAIL private reachable: %', r; END IF;
  RAISE NOTICE 'T1 OK  anon/PUBLIC denied on all six; legacy rpc_report_* denied to anon AND authenticated (catalog + real calls); private unreachable';
END $$;

-- =====================================================================================================
-- T2 caller identity — fail closed
-- =====================================================================================================
DO $$
BEGIN
  PERFORM rt.denied('T2 unauthenticated', rt.err('authenticated', NULL, NULL, 'SELECT public.get_report_scope()'), 'not authenticated');
  PERFORM rt.denied('T2 missing profile', rt.err('authenticated', 'deadbeef-0000-0000-0000-000000000000', rt.id('O1'),
    'SELECT public.get_report_scope()'), 'profile not found');
  PERFORM rt.denied('T2 inactive profile', rt.err('authenticated', rt.id('INACT'), rt.id('O1'), 'SELECT public.get_report_scope()'), 'not active');
  PERFORM rt.denied('T2 deleted profile', rt.err('authenticated', rt.id('DEL'), rt.id('O1'), 'SELECT public.get_report_scope()'), 'not active');
  -- A forged JWT organization claim is refused: the profile row, not the claim, is the tenant.
  PERFORM rt.denied('T2 forged org claim (agent)', rt.err('authenticated', rt.id('A1'), rt.id('O2'),
    'SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', NULL)'), 'organization mismatch');
  PERFORM rt.denied('T2 forged org claim (super admin)', rt.err('authenticated', rt.id('SUPER'), rt.id('O2'),
    'SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', NULL)'), 'organization mismatch');
  -- Authorization is decided before input validation (no oracle for unauthorized callers).
  PERFORM rt.denied('T2 unauthorized + bad window', rt.err('authenticated', NULL, NULL,
    'SELECT public.get_report_call_summary(''2026-07-31'', ''2026-07-01'', NULL)'), 'not authenticated');
  RAISE NOTICE 'T2 OK  unauthenticated / missing / inactive / deleted / forged-org callers are refused (42501)';
END $$;

-- =====================================================================================================
-- T3 Agent (own scope)
-- =====================================================================================================
DO $$
DECLARE s jsonb; j jsonb;
BEGIN
  s := rt.call(rt.id('A1'), rt.id('O1'), 'SELECT public.get_report_scope()');
  PERFORM rt.eq('T3 scope', s ->> 'scope', 'own');
  PERFORM rt.eq('T3 export flag', (s ->> 'can_export')::boolean, false);
  PERFORM rt.eq('T3 agents', jsonb_array_length(s -> 'agents'), 1);
  PERFORM rt.eq('T3 agent is self', (s -> 'agents' -> 0 ->> 'id')::uuid, rt.id('A1'));
  PERFORM rt.eq('T3 name only', s -> 'agents' -> 0 ->> 'name', 'Alice Agent');

  j := rt.summary('A1', '2026-07-01', '2026-07-31');
  PERFORM rt.eq('T3 null agent = self calls', (j -> 'totals' ->> 'calls_made')::int, 10);
  PERFORM rt.eq('T3 contacted', (j -> 'totals' ->> 'contacted')::int, 4);
  PERFORM rt.eq('T3 talk', (j -> 'totals' ->> 'talk_time_seconds')::int, 264);
  PERFORM rt.eq('T3 policies (stored K_A1IN, first day)', (j -> 'totals' ->> 'policies_sold')::int, 1);
  PERFORM rt.eq('T3 appointments (a1)', (j -> 'totals' ->> 'appointments_set')::int, 1);
  PERFORM rt.eq('T3 sessions', (j -> 'totals' ->> 'session_seconds')::int, 9000);
  PERFORM rt.eq('T3 by_agent only self', jsonb_array_length(j -> 'by_agent'), 1);
  PERFORM rt.eq('T3 no unattributed leak', (j -> 'unattributed' ->> 'policies_sold')::int, 0);

  j := rt.summary('A1', '2026-07-01', '2026-07-31', 'A1');
  PERFORM rt.eq('T3 explicit self', (j -> 'totals' ->> 'calls_made')::int, 10);
  PERFORM rt.denied('T3 other agent', rt.err('authenticated', rt.id('A1'), rt.id('O1'),
    format('SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', %L)', rt.id('A2'))), 'outside your report scope');
  PERFORM rt.denied('T3 own downline still refused (own scope)', rt.err('authenticated', rt.id('A1'), rt.id('O1'),
    format('SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', %L)', rt.id('A1B'))), 'outside your report scope');
  PERFORM rt.denied('T3 other tenant agent', rt.err('authenticated', rt.id('A1'), rt.id('O1'),
    format('SELECT public.get_report_call_volume(''2026-07-01'', ''2026-07-31'', %L)', rt.id('B1'))), 'outside your report scope');
  RAISE NOTICE 'T3 OK  Agent: own scope, null agent = self, other/downline/cross-tenant agents refused';
END $$;

-- =====================================================================================================
-- T4 Team Leader (team scope via profiles.upline_id; Deleted excluded, Inactive included)
-- =====================================================================================================
DO $$
DECLARE s jsonb; j jsonb;
BEGIN
  s := rt.call(rt.id('TL'), rt.id('O1'), 'SELECT public.get_report_scope()');
  PERFORM rt.eq('T4 scope', s ->> 'scope', 'team');
  PERFORM rt.eq('T4 export', (s ->> 'can_export')::boolean, true);
  PERFORM rt.eq('T4 team size (TL, A1, A2, INACT, A1B)', jsonb_array_length(s -> 'agents'), 5);
  PERFORM rt.eq('T4 names sorted', (SELECT string_agg(e ->> 'name', ',') FROM jsonb_array_elements(s -> 'agents') e),
                'Abe Downline,Alice Agent,Bob Agent,Ivy Inactive,Tina Leader');

  j := rt.summary('TL', '2026-07-01', '2026-07-31');
  PERFORM rt.eq('T4 null agent = team calls', (j -> 'totals' ->> 'calls_made')::int, 16);
  PERFORM rt.eq('T4 inbound', (j -> 'totals' ->> 'inbound_calls')::int, 1);
  PERFORM rt.eq('T4 other', (j -> 'totals' ->> 'other_calls')::int, 1);
  PERFORM rt.eq('T4 contacted', (j -> 'totals' ->> 'contacted')::int, 9);
  PERFORM rt.eq('T4 talk', (j -> 'totals' ->> 'talk_time_seconds')::int, 599);
  PERFORM rt.eq('T4 converted', (j -> 'totals' ->> 'converted')::int, 2);
  PERFORM rt.eq('T4 policies', (j -> 'totals' ->> 'policies_sold')::int, 3);
  PERFORM rt.eq('T4 appointments', (j -> 'totals' ->> 'appointments_set')::int, 2);
  PERFORM rt.eq('T4 sessions (incl. active clipped)', (j -> 'totals' ->> 'session_seconds')::int, 99600);
  PERFORM rt.eq('T4 by_agent rows', jsonb_array_length(j -> 'by_agent'), 5);
  PERFORM rt.eq('T4 no org-wide leak: A3 absent', rt.agent_row(j, 'A3'), NULL::jsonb);

  j := rt.summary('TL', '2026-07-01', '2026-07-31', 'A1B');
  PERFORM rt.eq('T4 narrow to grand-downline', (j -> 'totals' ->> 'calls_made')::int, 1);
  PERFORM rt.denied('T4 non-downline same org', rt.err('authenticated', rt.id('TL'), rt.id('O1'),
    format('SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', %L)', rt.id('A3'))), 'outside your report scope');
  PERFORM rt.denied('T4 deleted downline', rt.err('authenticated', rt.id('TL'), rt.id('O1'),
    format('SELECT public.get_report_disposition_breakdown(''2026-07-01'', ''2026-07-31'', %L)', rt.id('DEL'))), 'outside your report scope');
  PERFORM rt.denied('T4 admin (upline) refused', rt.err('authenticated', rt.id('TL'), rt.id('O1'),
    format('SELECT public.get_report_campaign_performance(''2026-07-01'', ''2026-07-31'', %L)', rt.id('ADMIN'))), 'outside your report scope');
  RAISE NOTICE 'T4 OK  Team Leader: downline scope, null agent = team (never org), non-downline refused';
END $$;

-- =====================================================================================================
-- T5 Admin / Super Admin (home organization) + T8 metric canon on the organization totals
-- =====================================================================================================
DO $$
DECLARE s jsonb; j jsonb; a jsonb;
BEGIN
  s := rt.call(rt.id('ADMIN'), rt.id('O1'), 'SELECT public.get_report_scope()');
  PERFORM rt.eq('T5 admin scope', s ->> 'scope', 'organization');
  PERFORM rt.eq('T5 roster excludes Deleted', jsonb_array_length(s -> 'agents'), 9);
  PERFORM rt.eq('T5 no email in scope payload', position('@example.test' IN s::text), 0);

  j := rt.summary('ADMIN', '2026-07-01', '2026-07-31');
  -- T8 canon (hand-computed from the fixture table above)
  PERFORM rt.eq('T8 calls made (outbound + Outgoing; created_at half-open)', (j -> 'totals' ->> 'calls_made')::int, 19);
  PERFORM rt.eq('T8 inbound', (j -> 'totals' ->> 'inbound_calls')::int, 2);
  PERFORM rt.eq('T8 other (NULL direction)', (j -> 'totals' ->> 'other_calls')::int, 1);
  PERFORM rt.eq('T8 total calls', (j -> 'totals' ->> 'total_calls')::int, 22);
  PERFORM rt.eq('T8 contacted (No Answer first, >45, flag by id, org name fallback, outbound only)',
                (j -> 'totals' ->> 'contacted')::int, 11);
  PERFORM rt.eq('T8 contact rate', (j -> 'totals' ->> 'contact_rate_pct')::numeric, 57.9);
  PERFORM rt.eq('T8 talk time (outbound, negative clamped)', (j -> 'totals' ->> 'talk_time_seconds')::int, 740);
  PERFORM rt.eq('T8 avg talk per dial', (j -> 'totals' ->> 'avg_talk_per_dial_seconds')::numeric, 38.9);
  PERFORM rt.eq('T8 inbound talk', (j -> 'totals' ->> 'inbound_talk_seconds')::int, 340);
  PERFORM rt.eq('T8 converted = distinct contacts (L2 twice + client)', (j -> 'totals' ->> 'converted')::int, 2);
  PERFORM rt.eq('T8 policies sold = stored policies (two policies, one client)', (j -> 'totals' ->> 'policies_sold')::int, 5);
  PERFORM rt.eq('T8 appointments (created_by, user_id rescue, cancelled counts)', (j -> 'totals' ->> 'appointments_set')::int, 4);
  PERFORM rt.eq('T8 dnc calls', (j -> 'totals' ->> 'dnc_calls')::int, 1);
  PERFORM rt.eq('T8 callback calls', (j -> 'totals' ->> 'callback_calls')::int, 1);
  PERFORM rt.eq('T8 sessions (overlap-clipped at both ends)', (j -> 'totals' ->> 'session_seconds')::int, 99600);
  PERFORM rt.eq('T8 no conversion rate field', (j -> 'totals') ? 'conversion_rate_pct', false);
  PERFORM rt.eq('T8 unattributed inbound', (j -> 'unattributed' ->> 'inbound_calls')::int, 1);
  PERFORM rt.eq('T8 unattributed policy', (j -> 'unattributed' ->> 'policies_sold')::int, 1);
  PERFORM rt.eq('T8 unattributed appointment', (j -> 'unattributed' ->> 'appointments_set')::int, 1);
  PERFORM rt.eq('T8 by_agent rows (8 Active + INACT + DEL with activity)', jsonb_array_length(j -> 'by_agent'), 10);
  PERFORM rt.eq('T8 per-agent calls sum to org calls',
    (SELECT sum((e ->> 'calls_made')::int) FROM jsonb_array_elements(j -> 'by_agent') e)::int, 19);
  a := rt.agent_row(j, 'A2');
  PERFORM rt.eq('T8 A2 calls', (a ->> 'calls_made')::int, 3);
  PERFORM rt.eq('T8 A2 inbound', (a ->> 'inbound_calls')::int, 1);
  PERFORM rt.eq('T8 A2 converted', (a ->> 'converted')::int, 2);
  PERFORM rt.eq('T8 A2 policies', (a ->> 'policies_sold')::int, 2);
  PERFORM rt.eq('T8 A2 appointments (user_id rescue)', (a ->> 'appointments_set')::int, 1);
  PERFORM rt.eq('T8 A2 session (heartbeat end)', (a ->> 'session_seconds')::int, 600);
  a := rt.agent_row(j, 'A1');
  PERFORM rt.eq('T8 A1 sessions (3600 clipped start + 1800 + 3600 clipped end)', (a ->> 'session_seconds')::int, 9000);
  PERFORM rt.eq('T8 A1 contact rate', (a ->> 'contact_rate_pct')::numeric, 40.0);
  a := rt.agent_row(j, 'ADMIN');
  PERFORM rt.eq('T8 zero-call agent contact rate is null', a -> 'contact_rate_pct', 'null'::jsonb);
  PERFORM rt.eq('T5 no email / phone / lead ids in payload',
    position('@example.test' IN j::text) + position('555' IN j::text) + position(rt.id('L1')::text IN j::text), 0);

  PERFORM rt.eq('T5 admin narrows to A3', (rt.summary('ADMIN', '2026-07-01', '2026-07-31', 'A3') -> 'totals' ->> 'calls_made')::int, 2);
  PERFORM rt.eq('T5 admin may read a Deleted agent''s history', (rt.summary('ADMIN', '2026-07-01', '2026-07-31', 'DEL') -> 'totals' ->> 'calls_made')::int, 1);
  PERFORM rt.denied('T5 admin cross-tenant agent', rt.err('authenticated', rt.id('ADMIN'), rt.id('O1'),
    format('SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', %L)', rt.id('B1'))), 'outside your report scope');

  -- Super Admin (is_super_admin with role Admin, and role 'Super Admin'): HOME org only.
  PERFORM rt.eq('T5 super admin = home org totals', (rt.summary('SUPER', '2026-07-01', '2026-07-31') -> 'totals' ->> 'calls_made')::int, 19);
  PERFORM rt.eq('T5 super admin role string', (rt.call(rt.id('SUPER2'), rt.id('O1'), 'SELECT public.get_report_scope()') ->> 'scope'), 'organization');
  PERFORM rt.denied('T5 super admin cross-tenant agent', rt.err('authenticated', rt.id('SUPER'), rt.id('O1'),
    format('SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', %L)', rt.id('B1'))), 'outside your report scope');

  -- The other tenant has NO agency time zone configured: its official Reports fail closed (55000) —
  -- no default zone is substituted (plan §R3.2).
  PERFORM rt.unconfigured('T6 O2 unconfigured zone refuses the report', rt.err('authenticated', rt.id('B_ADMIN'), rt.id('O2'),
    'SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', NULL)'), 'not configured');
  -- Once O2 configures a zone, it sees only itself (and its data never appears in O1). Block-local.
  INSERT INTO public.company_settings (organization_id, timezone) VALUES (rt.id('O2'), 'America/Chicago');
  j := rt.summary('B_ADMIN', '2026-07-01', '2026-07-31');
  PERFORM rt.eq('T6 tenant isolation O2 calls', (j -> 'totals' ->> 'calls_made')::int, 1);
  PERFORM rt.eq('T6 O2 contacted', (j -> 'totals' ->> 'contacted')::int, 1);
  PERFORM rt.eq('T6 O2 policies', (j -> 'totals' ->> 'policies_sold')::int, 1);
  PERFORM rt.eq('T6 O2 configured zone', j -> 'window' ->> 'time_zone', 'America/Chicago');
  PERFORM rt.eq('T6 O2 zone source', j -> 'window' ->> 'time_zone_source', 'agency_settings');
  PERFORM rt.eq('T6 O2 window start (CDT midnight)', j -> 'window' ->> 'start_at', '2026-07-01T05:00:00Z');
  DELETE FROM public.company_settings WHERE organization_id = rt.id('O2');
  RAISE NOTICE 'T5 OK  Admin/Super Admin: home organization only; narrowing works; cross-tenant agent refused';
  RAISE NOTICE 'T6 OK  tenant isolation: O2 sees only O2 once configured; unconfigured O2 fails closed';
  RAISE NOTICE 'T8 OK  metric canon: Calls Made, Talk Time, Contacted, Converted vs Policies Sold, appointments, sessions, null rates';
END $$;

-- =====================================================================================================
-- T7 permission changes take effect on the next call; malformed state fails closed
-- =====================================================================================================
DO $$
DECLARE r text; s jsonb;
BEGIN
  -- Reports page revoked for Agents.
  UPDATE public.role_permissions SET permissions = rt.perm(false, true, false, 'own', true, true, true, 'team')
   WHERE organization_id = rt.id('O1') AND role = 'Agent';
  PERFORM rt.denied('T7 page revoked', rt.err('authenticated', rt.id('A1'), rt.id('O1'), 'SELECT public.get_report_scope()'), 'not enabled');
  -- View Own revoked (own scope).
  UPDATE public.role_permissions SET permissions = rt.perm(true, false, false, 'own', true, true, true, 'team')
   WHERE organization_id = rt.id('O1') AND role = 'Agent';
  PERFORM rt.denied('T7 view own revoked', rt.err('authenticated', rt.id('A1'), rt.id('O1'), 'SELECT public.get_report_scope()'), 'no report scope');
  -- Agent given team scope but no View Team -> still own.
  UPDATE public.role_permissions SET permissions = rt.perm(true, true, false, 'team', true, true, true, 'team')
   WHERE organization_id = rt.id('O1') AND role = 'Agent';
  PERFORM rt.eq('T7 team scope without View Team = own',
    rt.call(rt.id('A1'), rt.id('O1'), 'SELECT public.get_report_scope()') ->> 'scope', 'own');
  -- Agent with team scope + View Team -> their own downline (A1B).
  UPDATE public.role_permissions SET permissions = rt.perm(true, true, true, 'team', true, true, true, 'team')
   WHERE organization_id = rt.id('O1') AND role = 'Agent';
  s := rt.call(rt.id('A1'), rt.id('O1'), 'SELECT public.get_report_scope()');
  PERFORM rt.eq('T7 agent team scope', s ->> 'scope', 'team');
  PERFORM rt.eq('T7 agent team = self + A1B', jsonb_array_length(s -> 'agents'), 2);
  -- Team Leader loses View Team -> own.
  UPDATE public.role_permissions SET permissions = rt.perm(true, true, false, 'own', true, true, false, 'team')
   WHERE organization_id = rt.id('O1') AND role = 'Team Leader';
  PERFORM rt.eq('T7 TL without View Team = own', rt.call(rt.id('TL'), rt.id('O1'), 'SELECT public.get_report_scope()') ->> 'scope', 'own');
  PERFORM rt.denied('T7 TL narrowed to own refuses downline agent', rt.err('authenticated', rt.id('TL'), rt.id('O1'),
    format('SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', %L)', rt.id('A1'))), 'outside your report scope');
  -- Team Leader with 'all' + View Team -> organization.
  UPDATE public.role_permissions SET permissions = rt.perm(true, true, false, 'own', true, true, true, 'all')
   WHERE organization_id = rt.id('O1') AND role = 'Team Leader';
  PERFORM rt.eq('T7 TL all scope = organization', rt.call(rt.id('TL'), rt.id('O1'), 'SELECT public.get_report_scope()') ->> 'scope', 'organization');
  -- Unknown scope string -> own (narrowest).
  UPDATE public.role_permissions SET permissions = rt.perm(true, true, false, 'own', true, true, true, 'everything')
   WHERE organization_id = rt.id('O1') AND role = 'Team Leader';
  PERFORM rt.eq('T7 unknown scope = own', rt.call(rt.id('TL'), rt.id('O1'), 'SELECT public.get_report_scope()') ->> 'scope', 'own');
  -- Non-boolean page flag -> denied (fail closed where the browser would treat "true" as truthy).
  UPDATE public.role_permissions
     SET permissions = jsonb_set(rt.perm(true, true, false, 'own', true, true, true, 'team'), '{p,1,agent}', '"true"')
   WHERE organization_id = rt.id('O1') AND role = 'Agent';
  PERFORM rt.denied('T7 string "true" is not true', rt.err('authenticated', rt.id('A1'), rt.id('O1'), 'SELECT public.get_report_scope()'), 'not enabled');
  -- Malformed pages block -> Agent defaults (page OFF) -> denied.
  UPDATE public.role_permissions SET permissions = '{"p": "garbage", "f": [], "d": []}'::jsonb
   WHERE organization_id = rt.id('O1') AND role = 'Agent';
  PERFORM rt.denied('T7 malformed p -> default page off', rt.err('authenticated', rt.id('A1'), rt.id('O1'), 'SELECT public.get_report_scope()'), 'not enabled');
  -- Row removed -> Agent defaults -> denied.  (O2 agent has no row at all.)
  DELETE FROM public.role_permissions WHERE organization_id = rt.id('O1') AND role = 'Agent';
  PERFORM rt.denied('T7 no row -> agent default denied', rt.err('authenticated', rt.id('A1'), rt.id('O1'), 'SELECT public.get_report_scope()'), 'not enabled');
  PERFORM rt.denied('T7 O2 agent defaults denied', rt.err('authenticated', rt.id('B1'), rt.id('O2'), 'SELECT public.get_report_scope()'), 'not enabled');
  -- Team Leader row removed -> TL defaults (page ON, team).
  DELETE FROM public.role_permissions WHERE organization_id = rt.id('O1') AND role = 'Team Leader';
  PERFORM rt.eq('T7 TL defaults = team', rt.call(rt.id('TL'), rt.id('O1'), 'SELECT public.get_report_scope()') ->> 'scope', 'team');
  -- Admins are locked: removing every row changes nothing for them.
  PERFORM rt.eq('T7 admin locked', rt.call(rt.id('ADMIN'), rt.id('O1'), 'SELECT public.get_report_scope()') ->> 'scope', 'organization');
  PERFORM rt.reset_perms();
  PERFORM rt.eq('T7 restored', rt.call(rt.id('A1'), rt.id('O1'), 'SELECT public.get_report_scope()') ->> 'scope', 'own');
  RAISE NOTICE 'T7 OK  permission changes apply on the next call; malformed/non-boolean state fails closed; admins locked';
END $$;

-- =====================================================================================================
-- T9 window + agency time zone (DST)
-- =====================================================================================================
DO $$
DECLARE j jsonb; s jsonb; d jsonb; z text; n int;
BEGIN
  s := rt.call(rt.id('A1'), rt.id('O1'), 'SELECT public.get_report_scope()');
  PERFORM rt.eq('T9 zone', s ->> 'time_zone', 'America/Los_Angeles');
  PERFORM rt.eq('T9 zone source', s ->> 'time_zone_source', 'agency_settings');
  PERFORM rt.eq('T9 agency today', (s ->> 'today')::date, (now() AT TIME ZONE 'America/Los_Angeles')::date);

  j := rt.rpc('get_report_call_volume', 'ADMIN', '2026-07-01', '2026-07-31');
  PERFORM rt.eq('T9 start_at (PDT midnight)', j -> 'window' ->> 'start_at', '2026-07-01T07:00:00Z');
  PERFORM rt.eq('T9 end_at exclusive', j -> 'window' ->> 'end_at', '2026-08-01T07:00:00Z');
  PERFORM rt.eq('T9 31 zero-filled days', jsonb_array_length(j -> 'by_date'), 31);
  PERFORM rt.eq('T9 first day holds only k17 (k16 was June 30 local)', (j -> 'by_date' -> 0 ->> 'calls_made')::int, 1);
  PERFORM rt.eq('T9 last day holds k14 (23:59:59 local)', (j -> 'by_date' -> 30 ->> 'calls_made')::int, 1);
  PERFORM rt.eq('T9 by_date sums to calls made', (SELECT sum((e ->> 'calls_made')::int) FROM jsonb_array_elements(j -> 'by_date') e)::int, 19);
  PERFORM rt.eq('T9 by_date policies (stored, by sale date)', (SELECT sum((e ->> 'policies_sold')::int) FROM jsonb_array_elements(j -> 'by_date') e)::int, 5);
  PERFORM rt.eq('T9 24 hours', jsonb_array_length(j -> 'by_hour'), 24);
  PERFORM rt.eq('T9 7 weekdays', jsonb_array_length(j -> 'by_day_of_week'), 7);
  PERFORM rt.eq('T9 heatmap 7x24', jsonb_array_length(j -> 'heatmap'), 168);
  -- k01 at 17:00Z = 10:00 PDT on a Friday: local hour 10, not UTC hour 17.
  PERFORM rt.eq('T9 local hour 10 holds k01 (17:00Z)', (j -> 'by_hour' -> 10 ->> 'calls_made')::int, 1);
  PERFORM rt.eq('T9 nothing in local hour 17 (would be k01 under UTC bucketing)', (j -> 'by_hour' -> 17 ->> 'calls_made')::int, 0);
  PERFORM rt.eq('T9 heatmap cell (Fri 10:00 local)',
    (SELECT (e ->> 'calls_made')::int FROM jsonb_array_elements(j -> 'heatmap') e
      WHERE (e ->> 'dow')::int = extract(dow FROM timestamp '2026-07-10 10:00')::int AND (e ->> 'hour')::int = 10), 1);
  PERFORM rt.eq('T9 heatmap sums to calls made', (SELECT sum((e ->> 'calls_made')::int) FROM jsonb_array_elements(j -> 'heatmap') e)::int, 19);

  -- DST fall-back: Nov 1 2026 is a 25-hour day in Los Angeles.
  j := rt.rpc('get_report_call_volume', 'ADMIN', '2026-11-01', '2026-11-01');
  PERFORM rt.eq('T9 DST start', j -> 'window' ->> 'start_at', '2026-11-01T07:00:00Z');
  PERFORM rt.eq('T9 DST end (PST midnight, 25h later)', j -> 'window' ->> 'end_at', '2026-11-02T08:00:00Z');
  PERFORM rt.eq('T9 DST day holds k27 + k28, not k29', (j -> 'by_date' -> 0 ->> 'calls_made')::int, 2);
  PERFORM rt.eq('T9 DST hour 0 (00:30 PDT)', (j -> 'by_hour' -> 0 ->> 'calls_made')::int, 1);
  PERFORM rt.eq('T9 DST hour 23 (23:30 PST)', (j -> 'by_hour' -> 23 ->> 'calls_made')::int, 1);

  -- Midnight fall-back (America/Havana, 2026-11-01 01:00 CDT -> 00:00 CST): local midnight occurs twice,
  -- and the day must start at the FIRST one (04:00Z), or k31 (the first 00:30) lands in Oct 31's window
  -- but outside its by_date. O1's zone is switched inside this block only.
  UPDATE public.company_settings SET timezone = 'America/Havana' WHERE organization_id = rt.id('O1');
  j := rt.rpc('get_report_call_volume', 'ADMIN', '2026-10-31', '2026-10-31');
  d := rt.rpc('get_report_call_summary', 'ADMIN', '2026-10-31', '2026-10-31');
  PERFORM rt.eq('T9 Havana Oct 31 end = first Nov 1 midnight', j -> 'window' ->> 'end_at', '2026-11-01T04:00:00Z');
  PERFORM rt.eq('T9 Havana Oct 31 holds only k30', (d -> 'totals' ->> 'calls_made')::int, 1);
  PERFORM rt.eq('T9 Havana Oct 31 by_date = totals', (SELECT sum((e ->> 'calls_made')::int) FROM jsonb_array_elements(j -> 'by_date') e)::int, 1);
  j := rt.rpc('get_report_call_volume', 'ADMIN', '2026-11-01', '2026-11-01');
  d := rt.rpc('get_report_call_summary', 'ADMIN', '2026-11-01', '2026-11-01');
  PERFORM rt.eq('T9 Havana Nov 1 start = first midnight', j -> 'window' ->> 'start_at', '2026-11-01T04:00:00Z');
  PERFORM rt.eq('T9 Havana Nov 1 end (25h day)', j -> 'window' ->> 'end_at', '2026-11-02T05:00:00Z');
  PERFORM rt.eq('T9 Havana Nov 1 holds k31 + k27', (d -> 'totals' ->> 'calls_made')::int, 2);
  PERFORM rt.eq('T9 Havana Nov 1 by_date = totals', (SELECT sum((e ->> 'calls_made')::int) FROM jsonb_array_elements(j -> 'by_date') e)::int, 2);
  PERFORM rt.eq('T9 Havana Nov 1 hour 0 holds k31', (j -> 'by_hour' -> 0 ->> 'calls_made')::int, 1);
  -- Midnight spring-forward (Havana 2026-03-08 00:00 -> 01:00): the day starts at 01:00 CDT = 05:00Z.
  j := rt.rpc('get_report_call_volume', 'ADMIN', '2026-03-08', '2026-03-08');
  PERFORM rt.eq('T9 Havana Mar 8 start (no local midnight)', j -> 'window' ->> 'start_at', '2026-03-08T05:00:00Z');
  -- Property: every day of 2026 in zones with midnight / 30-minute / US transitions starts at the first
  -- instant whose agency date is that day.
  FOR z IN SELECT unnest(ARRAY['America/Havana', 'America/Santiago', 'Australia/Lord_Howe', 'America/Los_Angeles']) LOOP
    UPDATE public.company_settings SET timezone = z WHERE organization_id = rt.id('O1');
    SELECT count(*) INTO n
      FROM generate_series('2026-01-01'::date, '2026-12-31'::date, interval '1 day') g,
           LATERAL private.report_window(rt.id('O1'), g::date, g::date) w
     WHERE NOT (    (w.start_at AT TIME ZONE z)::date = g::date
                AND ((w.start_at - interval '1 second') AT TIME ZONE z)::date = g::date - 1
                AND (w.end_at AT TIME ZONE z)::date = g::date + 1
                AND ((w.end_at - interval '1 second') AT TIME ZONE z)::date = g::date);
    PERFORM rt.eq('T9 every 2026 day is exactly its local calendar day in ' || z, n, 0);
  END LOOP;
  UPDATE public.company_settings SET timezone = 'America/Los_Angeles' WHERE organization_id = rt.id('O1');

  -- Validation (22023), after authorization.
  IF rt.err('authenticated', rt.id('ADMIN'), rt.id('O1'), 'SELECT public.get_report_call_summary(''2026-07-31'', ''2026-07-01'', NULL)') NOT LIKE '22023:%' THEN
    RAISE EXCEPTION 'T9 FAIL reversed window accepted'; END IF;
  IF rt.err('authenticated', rt.id('ADMIN'), rt.id('O1'), 'SELECT public.get_report_call_summary(''2025-01-01'', ''2026-01-02'', NULL)') NOT LIKE '22023:%' THEN
    RAISE EXCEPTION 'T9 FAIL 367-day window accepted'; END IF;
  IF rt.err('authenticated', rt.id('ADMIN'), rt.id('O1'), 'SELECT public.get_report_call_summary(NULL, ''2026-01-02'', NULL)') NOT LIKE '22023:%' THEN
    RAISE EXCEPTION 'T9 FAIL null start accepted'; END IF;
  PERFORM rt.eq('T9 366-day window accepted',
    rt.err('authenticated', rt.id('ADMIN'), rt.id('O1'), 'SELECT public.get_report_call_summary(''2025-07-31'', ''2026-07-31'', NULL)'), 'OK');
  -- Invalid stored agency zone fails closed (same configuration condition as a missing one; T15).
  PERFORM rt.unconfigured('T9 invalid agency zone refused (scope)',
    rt.err('authenticated', rt.id('C_ADMIN'), rt.id('O3'), 'SELECT public.get_report_scope()'), 'not a valid IANA zone');
  PERFORM rt.unconfigured('T9 invalid agency zone refused (summary)',
    rt.err('authenticated', rt.id('C_ADMIN'), rt.id('O3'), 'SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', NULL)'), 'not a valid IANA zone');
  RAISE NOTICE 'T9 OK  agency-zone half-open window, zero-filled local buckets, DST 25h day, midnight fall-back (Havana), every-day boundary property, validation, invalid zone fails closed';
END $$;

-- =====================================================================================================
-- T10 disposition breakdown
-- =====================================================================================================
DO $$
DECLARE j jsonb; h text;
BEGIN
  j := rt.rpc('get_report_disposition_breakdown', 'ADMIN', '2026-07-01', '2026-07-31');
  PERFORM rt.eq('T10 total outbound', (j ->> 'total_calls')::int, 19);
  PERFORM rt.eq('T10 buckets sum', (SELECT sum((e ->> 'calls')::int) FROM jsonb_array_elements(j -> 'by_disposition') e)::int, 19);
  PERFORM rt.eq('T10 top = Not Interested (5)', j -> 'by_disposition' -> 0 ->> 'name', 'Not Interested');
  PERFORM rt.eq('T10 top count', (j -> 'by_disposition' -> 0 ->> 'calls')::int, 5);
  PERFORM rt.eq('T10 tie ordered by name (No Answer before Sold)', j -> 'by_disposition' -> 1 ->> 'name', 'No Answer');
  PERFORM rt.eq('T10 name fallback resolves to the org disposition',
    (SELECT (e ->> 'calls')::int FROM jsonb_array_elements(j -> 'by_disposition') e WHERE e ->> 'key' = rt.id('D_LEG')::text), 1);
  PERFORM rt.eq('T10 other-org name stays unresolved',
    (SELECT (e ->> 'calls')::int FROM jsonb_array_elements(j -> 'by_disposition') e WHERE e ->> 'key' = 'name:beta only'), 1);
  PERFORM rt.eq('T10 no-disposition bucket',
    (SELECT e ->> 'name' FROM jsonb_array_elements(j -> 'by_disposition') e WHERE e ->> 'key' = 'none'), '(No disposition)');
  PERFORM rt.eq('T10 converts flag',
    (SELECT (e ->> 'converts')::boolean FROM jsonb_array_elements(j -> 'by_disposition') e WHERE e ->> 'key' = rt.id('D_SOLD')::text), true);
  SELECT string_agg((e ->> 'range') || '=' || (e ->> 'calls'), ',') INTO h FROM jsonb_array_elements(j -> 'duration_histogram') e;
  PERFORM rt.eq('T10 fixed ordered histogram', h, '0-30s=8,30s-1m=6,1-2m=4,2-5m=1,5m+=0');
  PERFORM rt.eq('T10 by_agent excludes unattributed', (SELECT count(*) FROM jsonb_array_elements(j -> 'by_agent') e WHERE e ->> 'agent_id' IS NULL)::int, 0);
  PERFORM rt.eq('T10 by_campaign rows', jsonb_array_length(j -> 'by_campaign'), 2);
  j := rt.rpc('get_report_disposition_breakdown', 'A1', '2026-07-01', '2026-07-31');
  PERFORM rt.eq('T10 agent scoped total', (j ->> 'total_calls')::int, 10);
  PERFORM rt.eq('T10 agent sees no other agent', jsonb_array_length(j -> 'by_agent'), 1);
  RAISE NOTICE 'T10 OK  disposition grouping by id, org name fallback, unresolved + none buckets, fixed histogram';
END $$;

-- =====================================================================================================
-- T11 campaign performance — attribution and restricted population
-- =====================================================================================================
DO $$
DECLARE j jsonb; c jsonb;
BEGIN
  j := rt.rpc('get_report_campaign_performance', 'ADMIN', '2026-07-01', '2026-07-31');
  PERFORM rt.eq('T11 campaigns', jsonb_array_length(j -> 'campaigns'), 2);
  SELECT e INTO c FROM jsonb_array_elements(j -> 'campaigns') e WHERE (e ->> 'campaign_id')::uuid = rt.id('C1');
  PERFORM rt.eq('T11 C1 calls', (c ->> 'calls_made')::int, 4);
  PERFORM rt.eq('T11 C1 contacted calls', (c ->> 'contacted_calls')::int, 3);
  PERFORM rt.eq('T11 C1 contact rate', (c ->> 'contact_rate_pct')::numeric, 75.0);
  PERFORM rt.eq('T11 C1 leads dialed', (c ->> 'leads_dialed')::int, 2);
  PERFORM rt.eq('T11 C1 contacted leads', (c ->> 'contacted_leads')::int, 2);
  PERFORM rt.eq('T11 C1 converted leads', (c ->> 'converted_leads')::int, 1);
  PERFORM rt.eq('T11 C1 attributed policies (CLIENT99 lineage, primary + additional)', (c ->> 'attributed_policies')::int, 2);
  PERFORM rt.eq('T11 no COUNT(wins) policies_sold field', c ? 'policies_sold', false);
  PERFORM rt.eq('T11 policies in period', (j ->> 'policies_in_period')::int, 5);
  PERFORM rt.eq('T11 policies without campaign', (j ->> 'policies_attribution_unavailable')::int, 3);
  PERFORM rt.eq('T11 attribution basis', j ->> 'policy_attribution', 'conversion_lineage_only');
  PERFORM rt.eq('T11 C1 type column', c ->> 'type', 'Team');
  PERFORM rt.eq('T11 no all-time size field', c ? 'total_leads', false);
  PERFORM rt.eq('T11 unattributed calls', (j ->> 'unattributed_calls')::int, 13);
  PERFORM rt.eq('T11 other tenant campaign absent', position(rt.id('CB')::text IN j::text), 0);
  j := rt.rpc('get_report_campaign_performance', 'A1', '2026-07-01', '2026-07-31');
  PERFORM rt.eq('T11 agent sees only campaigns they dialed', jsonb_array_length(j -> 'campaigns'), 1);
  PERFORM rt.eq('T11 agent C1 calls (own only)', (j -> 'campaigns' -> 0 ->> 'calls_made')::int, 2);
  PERFORM rt.eq('T11 agent never sees org policies', (j -> 'campaigns' -> 0 ->> 'attributed_policies')::int, 0);
  PERFORM rt.eq('T11 agent policies in period = own (K_A1IN)', (j ->> 'policies_in_period')::int, 1);
  PERFORM rt.eq('T11 personal campaign of another agent hidden', position(rt.id('C2')::text IN j::text), 0);
  RAISE NOTICE 'T11 OK  campaign attribution + restricted users never receive organization totals';
END $$;

-- =====================================================================================================
-- T12 lead source — scope, trimming, new leads, converted unavailable
-- =====================================================================================================
DO $$
DECLARE j jsonb; f jsonb;
BEGIN
  j := rt.rpc('get_report_lead_source_performance', 'ADMIN', '2026-07-01', '2026-07-31');
  PERFORM rt.eq('T12 converted unavailable', (j ->> 'converted_available')::boolean, false);
  PERFORM rt.eq('T12 reason present', length(j ->> 'converted_unavailable_reason') > 20, true);
  PERFORM rt.eq('T12 sources', (SELECT string_agg(e ->> 'lead_source', ',') FROM jsonb_array_elements(j -> 'sources') e),
                'Facebook,Google,(No source),Referral');
  SELECT e INTO f FROM jsonb_array_elements(j -> 'sources') e WHERE e ->> 'lead_source' = 'Facebook';
  PERFORM rt.eq('T12 Facebook calls', (f ->> 'calls_made')::int, 6);
  PERFORM rt.eq('T12 Facebook contacted', (f ->> 'contacted_calls')::int, 3);
  PERFORM rt.eq('T12 Facebook leads dialed', (f ->> 'leads_dialed')::int, 2);
  PERFORM rt.eq('T12 Facebook new leads', (f ->> 'new_leads')::int, 2);
  PERFORM rt.eq('T12 converted is null, never 0', f -> 'converted', 'null'::jsonb);
  PERFORM rt.eq('T12 unattributed', (j ->> 'unattributed_calls')::int, 10);
  j := rt.rpc('get_report_lead_source_performance', 'A1', '2026-07-01', '2026-07-31');
  PERFORM rt.eq('T12 agent sources', (SELECT string_agg(e ->> 'lead_source', ',') FROM jsonb_array_elements(j -> 'sources') e),
                'Facebook,(No source)');
  PERFORM rt.eq('T12 agent Facebook calls', (j -> 'sources' -> 0 ->> 'calls_made')::int, 4);
  PERFORM rt.eq('T12 agent new leads = own assigned only', (j -> 'sources' -> 0 ->> 'new_leads')::int, 1);
  PERFORM rt.eq('T12 no org-wide Referral leak', position('Referral' IN j::text), 0);
  RAISE NOTICE 'T12 OK  lead-source attribution via current leads, restricted scope, converted explicitly unavailable';
END $$;

-- =====================================================================================================
-- T13 successful empty result vs zero denominators
-- =====================================================================================================
DO $$
DECLARE j jsonb;
BEGIN
  j := rt.summary('ADMIN', '2026-03-01', '2026-03-31');
  PERFORM rt.eq('T13 empty calls', (j -> 'totals' ->> 'calls_made')::int, 0);
  PERFORM rt.eq('T13 empty rate is null', j -> 'totals' -> 'contact_rate_pct', 'null'::jsonb);
  PERFORM rt.eq('T13 empty avg is null', j -> 'totals' -> 'avg_talk_per_dial_seconds', 'null'::jsonb);
  PERFORM rt.eq('T13 roster still listed with zeros (8 Active)', jsonb_array_length(j -> 'by_agent'), 8);
  j := rt.rpc('get_report_campaign_performance', 'ADMIN', '2026-03-01', '2026-03-31');
  PERFORM rt.eq('T13 empty campaigns array', j -> 'campaigns', '[]'::jsonb);
  j := rt.rpc('get_report_disposition_breakdown', 'ADMIN', '2026-03-01', '2026-03-31');
  PERFORM rt.eq('T13 empty histogram still ordered', jsonb_array_length(j -> 'duration_histogram'), 5);
  j := rt.rpc('get_report_call_volume', 'ADMIN', '2026-03-01', '2026-03-31');
  PERFORM rt.eq('T13 empty days zero-filled', jsonb_array_length(j -> 'by_date'), 31);
  RAISE NOTICE 'T13 OK  a successful empty window is well-formed JSON with zeros and null rates';
END $$;

-- =====================================================================================================
-- T14 Converted identity — one person, two campaign_lead memberships, counts ONCE
-- =====================================================================================================
DO $$
DECLARE j jsonb; a jsonb; c jsonb;
BEGIN
  -- May 2026 holds only k32 (L6 via CL6A, campaign C1) and k33 (L6 via CL6B, campaign C2), both converting.
  j := rt.summary('ADMIN', '2026-05-01', '2026-05-31');
  PERFORM rt.eq('T14 May calls made', (j -> 'totals' ->> 'calls_made')::int, 2);
  PERFORM rt.eq('T14 same contact via two campaign leads = 1 converted', (j -> 'totals' ->> 'converted')::int, 1);
  a := rt.agent_row(j, 'A2');
  PERFORM rt.eq('T14 A2 converted (same contact) = 1', (a ->> 'converted')::int, 1);
  PERFORM rt.eq('T14 agent-narrowed converted = 1', (rt.summary('ADMIN', '2026-05-01', '2026-05-31', 'A2') -> 'totals' ->> 'converted')::int, 1);
  -- Campaign Performance keeps its campaign-specific semantics: each campaign counts ITS campaign lead.
  j := rt.rpc('get_report_campaign_performance', 'ADMIN', '2026-05-01', '2026-05-31');
  SELECT e INTO c FROM jsonb_array_elements(j -> 'campaigns') e WHERE (e ->> 'campaign_id')::uuid = rt.id('C1');
  PERFORM rt.eq('T14 C1 converted leads (its own campaign lead)', (c ->> 'converted_leads')::int, 1);
  SELECT e INTO c FROM jsonb_array_elements(j -> 'campaigns') e WHERE (e ->> 'campaign_id')::uuid = rt.id('C2');
  PERFORM rt.eq('T14 C2 converted leads (its own campaign lead)', (c ->> 'converted_leads')::int, 1);

  -- April holds k34..k38, none with a contact on k34..k37. Keys: campaign_lead:CL7 (k34, k35 -> once),
  -- call:k36, call:k37, contact:L7 (k38) = 4. Dropping the campaign-lead level gives 5; dropping the
  -- call level gives 2 (NULL keys are not counted).
  j := rt.summary('ADMIN', '2026-04-01', '2026-04-30');
  PERFORM rt.eq('T14 April calls made', (j -> 'totals' ->> 'calls_made')::int, 5);
  PERFORM rt.eq('T14 NULL-contact fallbacks (campaign lead once, each call once)', (j -> 'totals' ->> 'converted')::int, 4);
  -- Campaign Performance counts converting CAMPAIGN LEADS of C1: CL7 only (k38 has no campaign lead),
  -- so it differs from the person count (campaign_lead:CL7 + contact:L7 = 2 within C1).
  j := rt.rpc('get_report_campaign_performance', 'ADMIN', '2026-04-01', '2026-04-30');
  SELECT e INTO c FROM jsonb_array_elements(j -> 'campaigns') e WHERE (e ->> 'campaign_id')::uuid = rt.id('C1');
  PERFORM rt.eq('T14 April C1 calls', (c ->> 'calls_made')::int, 3);
  PERFORM rt.eq('T14 April C1 converted leads = campaign leads, not people', (c ->> 'converted_leads')::int, 1);
  RAISE NOTICE 'T14 OK  Converted counts one person once across campaign_lead memberships; NULL-contact fallbacks; campaign converted leads stay per campaign lead';
END $$;

-- =====================================================================================================
-- T15 Official Reports require a configured agency time zone — never a guessed default
-- =====================================================================================================
DO $$
DECLARE fn text; v text;
BEGIN
  -- O2 has no settings row: the scope and EVERY report RPC refuse with 55000 before computing anything.
  PERFORM rt.unconfigured('T15 O2 scope', rt.err('authenticated', rt.id('B_ADMIN'), rt.id('O2'), 'SELECT public.get_report_scope()'), 'not configured');
  FOREACH fn IN ARRAY ARRAY['get_report_call_summary', 'get_report_call_volume', 'get_report_disposition_breakdown',
                            'get_report_campaign_performance', 'get_report_lead_source_performance'] LOOP
    PERFORM rt.unconfigured('T15 O2 ' || fn, rt.err('authenticated', rt.id('B_ADMIN'), rt.id('O2'),
      format('SELECT public.%I(''2026-07-01'', ''2026-07-31'', NULL)', fn)), 'not configured');
  END LOOP;
  -- Authorization is decided FIRST: an unauthorized caller learns nothing about configuration.
  PERFORM rt.denied('T15 unauthorized O2 agent still 42501', rt.err('authenticated', rt.id('B1'), rt.id('O2'), 'SELECT public.get_report_scope()'), 'not enabled');
  PERFORM rt.eq('T15 anon still denied', left(rt.err('anon', NULL, NULL, 'SELECT public.get_report_scope()'), 5), '42501');
  -- A row whose zone is NULL, blank or unknown is not a configured zone either (O1, block-local).
  FOREACH v IN ARRAY ARRAY['', '   '] LOOP
    UPDATE public.company_settings SET timezone = v WHERE organization_id = rt.id('O1');
    PERFORM rt.unconfigured('T15 blank zone [' || v || ']', rt.err('authenticated', rt.id('ADMIN'), rt.id('O1'), 'SELECT public.get_report_scope()'), 'not configured');
  END LOOP;
  UPDATE public.company_settings SET timezone = NULL WHERE organization_id = rt.id('O1');
  PERFORM rt.unconfigured('T15 NULL zone', rt.err('authenticated', rt.id('ADMIN'), rt.id('O1'),
    'SELECT public.get_report_call_volume(''2026-07-01'', ''2026-07-31'', NULL)'), 'not configured');
  UPDATE public.company_settings SET timezone = 'Mars/Olympus_Mons' WHERE organization_id = rt.id('O1');
  PERFORM rt.unconfigured('T15 unknown zone', rt.err('authenticated', rt.id('ADMIN'), rt.id('O1'),
    'SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', NULL)'), 'not a valid IANA zone');
  -- Names pg_timezone_names may list that are not an agency's zone: IANA's "not set" placeholder, the
  -- database host's zone and the POSIX rules file. Each would silently mean UTC / the server's zone.
  FOREACH v IN ARRAY ARRAY['Factory', 'localtime', 'posixrules', 'factory'] LOOP
    UPDATE public.company_settings SET timezone = v WHERE organization_id = rt.id('O1');
    PERFORM rt.unconfigured('T15 pseudo-zone [' || v || ']', rt.err('authenticated', rt.id('ADMIN'), rt.id('O1'),
      'SELECT public.get_report_call_summary(''2026-07-01'', ''2026-07-31'', NULL)'), 'not a valid IANA zone');
  END LOOP;
  UPDATE public.company_settings SET timezone = 'America/Los_Angeles' WHERE organization_id = rt.id('O1');
  PERFORM rt.eq('T15 configured again', rt.call(rt.id('ADMIN'), rt.id('O1'), 'SELECT public.get_report_scope()') ->> 'time_zone_source', 'agency_settings');
  RAISE NOTICE 'T15 OK  missing / NULL / blank / unknown / pseudo agency zone fails closed (55000) for scope and every RPC; authorization first';
END $$;

\echo ''
\echo '================ ALL REPORTS RPC PROOFS PASSED (T0-T15) ================'
