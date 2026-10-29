-- =====================================================================================================
-- Dashboard attention clearances (G3 package) — behaviour suite.
-- Run by scripts/run_dashboard_attention_tests.sh on a disposable LOCAL database after the harness and
-- the migration under test. Every check raises on failure (ON_ERROR_STOP), so a passing run means all
-- of them held.
-- =====================================================================================================
\set ON_ERROR_STOP on
\pset tuples_only on
-- A write and a read in ONE statement share its snapshot, so every "write, then count" check below
-- writes in one statement and reads in the next.
\set ORG_A '''a0000000-0000-4000-8000-00000000000a'''
\set ORG_B '''b0000000-0000-4000-8000-00000000000b'''
\set A1 '''10000000-0000-4000-8000-000000000001'''
\set A2 '''10000000-0000-4000-8000-000000000002'''
\set TL '''10000000-0000-4000-8000-000000000003'''
\set AD '''10000000-0000-4000-8000-000000000004'''
\set B1 '''10000000-0000-4000-8000-000000000005'''
\set A3 '''10000000-0000-4000-8000-000000000006'''
\set CP_A1 '''20000000-0000-4000-8000-0000000000a1'''
\set CP_A2 '''20000000-0000-4000-8000-0000000000a2'''
\set CP_B '''20000000-0000-4000-8000-0000000000b1'''
\set CL1 '''30000000-0000-4000-8000-000000000001'''
\set CL2 '''30000000-0000-4000-8000-000000000002'''
\set CL3 '''30000000-0000-4000-8000-000000000003'''
\set CL4 '''30000000-0000-4000-8000-000000000004'''
\set CL5 '''30000000-0000-4000-8000-000000000005'''
\set CL_B '''30000000-0000-4000-8000-0000000000b1'''
\set K1 '''40000000-0000-4000-8000-000000000001'''
\set K2 '''40000000-0000-4000-8000-000000000002'''
\set K3 '''40000000-0000-4000-8000-000000000003'''
\set K4 '''40000000-0000-4000-8000-000000000004'''
\set K5 '''40000000-0000-4000-8000-000000000005'''
\set K6 '''40000000-0000-4000-8000-000000000006'''
\set AP1 '''50000000-0000-4000-8000-000000000001'''
\set AP2 '''50000000-0000-4000-8000-000000000002'''
\set AP3 '''50000000-0000-4000-8000-000000000003'''
\set AP4 '''50000000-0000-4000-8000-000000000004'''
\set AP5 '''50000000-0000-4000-8000-000000000005'''
\set AP6 '''50000000-0000-4000-8000-000000000006'''

-- ---- Fixture (superuser) -----------------------------------------------------------------------------
INSERT INTO public.organizations VALUES (:ORG_A, 'Agency A'), (:ORG_B, 'Agency B');
INSERT INTO auth.users VALUES (:A1), (:A2), (:TL), (:AD), (:B1), (:A3);
INSERT INTO public.profiles VALUES
  (:TL, :ORG_A, 'Team Leader', 'Active', NULL, NULL),
  (:A1, :ORG_A, 'Agent', 'Active', :TL, NULL),
  (:A2, :ORG_A, 'Agent', 'Active', NULL, NULL),
  (:AD, :ORG_A, 'Admin', 'Active', NULL, NULL),
  (:B1, :ORG_B, 'Agent', 'Active', NULL, NULL),
  (:A3, :ORG_A, 'Agent', 'Inactive', NULL, NULL);
INSERT INTO public.campaigns (id, organization_id, type, user_id) VALUES
  (:CP_A1, :ORG_A, 'Personal', :A1), (:CP_A2, :ORG_A, 'Personal', :A2), (:CP_B, :ORG_B, 'Personal', :B1);
INSERT INTO public.campaign_leads (id, campaign_id, organization_id, user_id, status, callback_due_at, scheduled_callback_at, callback_agent_id) VALUES
  (:CL1, :CP_A1, :ORG_A, :A1, 'Queued', '2026-10-30 15:00:00+00', '2026-10-30 15:00:00+00', :A1),
  (:CL2, :CP_A2, :ORG_A, :A2, 'Called', '2026-10-30 16:00:00+00', NULL, :A2),
  (:CL3, :CP_A1, :ORG_A, :A1, 'Completed', '2026-10-30 17:00:00+00', NULL, :A1),
  (:CL4, :CP_A1, :ORG_A, :A1, 'Queued', NULL, '2026-10-31 10:00:00+00', :A1),
  (:CL5, :CP_A1, :ORG_A, :A1, 'Queued', NULL, NULL, NULL),
  (:CL_B, :CP_B, :ORG_B, :B1, 'Queued', '2026-10-30 15:00:00+00', NULL, :B1);
INSERT INTO public.calls (id, organization_id, agent_id, direction, is_missed, missed_for_agent_id, missed_recipient_ids, created_at, duration, status) VALUES
  (:K1, :ORG_A, NULL, 'inbound', true, :A1, ARRAY[:A1]::uuid[], '2026-10-29 18:00:00.123456+00', 0, 'no-answer'),
  (:K2, :ORG_A, :A2, 'inbound', false, NULL, '{}', '2026-10-29 18:05:00+00', 120, 'completed'),
  (:K3, :ORG_A, :A1, 'outbound', NULL, NULL, '{}', '2026-10-29 18:10:00+00', 30, 'completed'),
  (:K4, :ORG_B, NULL, 'inbound', true, :B1, ARRAY[:B1]::uuid[], '2026-10-29 18:15:00+00', 0, 'no-answer'),
  (:K5, :ORG_A, NULL, 'inbound', true, NULL, ARRAY[:A1, :A2]::uuid[], '2026-10-29 18:20:00.5+00', 0, 'no-answer'),
  (:K6, :ORG_A, NULL, 'inbound', true, :A1, ARRAY[:A1]::uuid[], '2026-10-29 18:25:00.654321+00', 0, 'no-answer');
INSERT INTO public.appointments (id, organization_id, user_id, created_by, type, status, start_time) VALUES
  (:AP1, :ORG_A, :A1, :A1, 'Follow Up', 'Scheduled', '2026-10-30 17:00:00+00'),
  (:AP2, :ORG_A, NULL, :A1, 'Call Back', 'Scheduled', '2026-10-30 18:00:00+00'),
  (:AP3, :ORG_A, :A2, :A2, 'Follow Up', 'Scheduled', '2026-10-30 19:00:00+00'),
  (:AP4, :ORG_A, :A1, :A1, 'Meeting', 'Scheduled', '2026-10-30 20:00:00+00'),
  (:AP5, :ORG_A, :A1, :A1, 'Follow Up', 'Completed', '2026-10-30 21:00:00+00'),
  (:AP6, :ORG_A, :A1, :A1, 'Follow Up', 'Scheduled', '2026-10-30 22:00:00+00');
-- Agency A and Agency B share an (active) Agency Group: A's users can READ B's calls.
INSERT INTO public.harness_agency_group_peers VALUES (:ORG_A, :ORG_B);

-- Source snapshot: row version and content of every source row, then arm the write audit.
CREATE TEMP TABLE t_src AS
  SELECT 'calls' AS tbl, id, xmin::text AS xv, md5(row_to_json(c)::text) AS h FROM public.calls c
  UNION ALL SELECT 'campaign_leads', id, xmin::text, md5(row_to_json(cl)::text) FROM public.campaign_leads cl
  UNION ALL SELECT 'appointments', id, xmin::text, md5(row_to_json(a)::text) FROM public.appointments a;
UPDATE dac_t.armed SET on_ = true;

-- ---- T1 metadata ---------------------------------------------------------------------------------------
SELECT dac_t.check('T1.1 RLS enabled', relrowsecurity) FROM pg_class WHERE oid = 'public.dashboard_attention_clearances'::regclass;
SELECT dac_t.check('T1.2 three policies (SELECT/INSERT/DELETE), all TO authenticated, no UPDATE policy',
  (SELECT count(*) = 3 AND bool_and(roles = '{authenticated}') AND NOT bool_or(cmd IN ('UPDATE', 'ALL'))
   FROM pg_policies WHERE tablename = 'dashboard_attention_clearances'));
SELECT dac_t.check('T1.3 anon holds no table privilege',
  NOT has_table_privilege('anon', 'public.dashboard_attention_clearances', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
SELECT dac_t.check('T1.4 authenticated: SELECT/INSERT/DELETE and nothing else (no UPDATE)',
  has_table_privilege('authenticated', 'public.dashboard_attention_clearances', 'SELECT')
  AND has_table_privilege('authenticated', 'public.dashboard_attention_clearances', 'INSERT')
  AND has_table_privilege('authenticated', 'public.dashboard_attention_clearances', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.dashboard_attention_clearances', 'UPDATE,TRUNCATE,REFERENCES,TRIGGER'));
SELECT dac_t.check('T1.5 service_role: SELECT only',
  has_table_privilege('service_role', 'public.dashboard_attention_clearances', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.dashboard_attention_clearances', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
SELECT dac_t.check('T1.6 both RPCs SECURITY INVOKER with a pinned search_path',
  (SELECT count(*) = 2 AND bool_and(NOT prosecdef) AND bool_and(proconfig = '{"search_path=pg_catalog, pg_temp"}')
   FROM pg_proc WHERE proname IN ('clear_dashboard_attention_item', 'undo_dashboard_attention_clear')));
SELECT dac_t.check('T1.7 EXECUTE: authenticated only (no anon, no PUBLIC, no service_role)',
  has_function_privilege('authenticated', 'public.clear_dashboard_attention_item(text,uuid,timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.undo_dashboard_attention_clear(uuid,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.clear_dashboard_attention_item(text,uuid,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.undo_dashboard_attention_clear(uuid,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.clear_dashboard_attention_item(text,uuid,timestamptz)', 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                  WHERE p.proname IN ('clear_dashboard_attention_item', 'undo_dashboard_attention_clear', 'dashboard_attention_clearances_guard')
                    AND a.grantee = 0));
SELECT dac_t.check('T1.8 the guard function is executable by no client role',
  NOT has_function_privilege('authenticated', 'private.dashboard_attention_clearances_guard()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'private.dashboard_attention_clearances_guard()', 'EXECUTE'));
SELECT dac_t.check('T1.9 no foreign key to calls / campaign_leads / appointments (no lock, no cascade from telemetry)',
  NOT EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.dashboard_attention_clearances'::regclass AND contype = 'f'
                AND confrelid IN ('public.calls'::regclass, 'public.campaign_leads'::regclass, 'public.appointments'::regclass))
  AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal
                  AND t.tgrelid IN ('public.calls'::regclass, 'public.campaign_leads'::regclass, 'public.appointments'::regclass)
                  AND t.tgname NOT LIKE 'audit_%'));
SELECT dac_t.check('T1.10 one row per user, organization, source and occurrence (unique constraint)',
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_attention_clearances_occurrence_key' AND contype = 'u'));

-- ---- T2 Missed calls (Agent A1) ------------------------------------------------------------------------
SET ROLE authenticated;
SELECT dac_t.claims(:A1, :ORG_A);
SELECT dac_t.check('T2.1 Clear stores the caller''s row; user, organization and occurrence are server-derived (microseconds kept)',
  (SELECT user_id = :A1 AND organization_id = :ORG_A AND source_type = 'missed_call' AND source_id = :K1
          AND occurrence_at = '2026-10-29 18:00:00.123456+00'::timestamptz
   FROM public.clear_dashboard_attention_item('missed_call', :K1, '2026-10-29T18:00:00.123456+00:00')));
CREATE TEMP TABLE t_k1 AS SELECT id, cleared_at FROM public.dashboard_attention_clearances WHERE source_id = :K1;
SELECT dac_t.check('T2.2a clearing it again returns the SAME row (idempotent)',
  (SELECT r.id = k.id AND r.cleared_at = k.cleared_at
   FROM public.clear_dashboard_attention_item('missed_call', :K1, '2026-10-29 18:00:00.123456+00') r, t_k1 k));
SELECT dac_t.check('T2.2b ... and there is still one row for it', (SELECT count(*) = 1 FROM public.dashboard_attention_clearances WHERE source_id = :K1));
SELECT dac_t.check('T2.3 an expected time truncated to milliseconds is "changed" (PT409), never a silent clear',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('missed_call', '40000000-0000-4000-8000-000000000006', '2026-10-29T18:25:00.654Z')$$) = 'PT409');
SELECT dac_t.check('T2.4 an answered inbound call is not a missed call (PT404)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('missed_call', '40000000-0000-4000-8000-000000000002', '2026-10-29 18:05:00+00')$$) = 'PT404');
SELECT dac_t.check('T2.5 an outbound call is not a missed call (PT404)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('missed_call', '40000000-0000-4000-8000-000000000003', '2026-10-29 18:10:00+00')$$) = 'PT404');
SELECT dac_t.check('T2.6a an Agency Group peer''s missed call IS readable here (the peer policy is live)',
  (SELECT count(*) = 1 FROM public.calls WHERE id = :K4));
SELECT dac_t.check('T2.6b ... but cannot be cleared: it belongs to another agency (PT404)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('missed_call', '40000000-0000-4000-8000-000000000004', '2026-10-29 18:15:00+00')$$) = 'PT404');
SELECT dac_t.check('T2.7 an unlinked missed call that rang several agents is cleared by its call id',
  (SELECT source_id = :K5 FROM public.clear_dashboard_attention_item('missed_call', :K5, '2026-10-29 18:20:00.5+00')));
SELECT dac_t.check('T2.8 unknown type, missing id or missing time are invalid input (22023)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('voicemail', '40000000-0000-4000-8000-000000000001', now())$$) = '22023'
  AND dac_t.try($$SELECT public.clear_dashboard_attention_item('missed_call', NULL, now())$$) = '22023'
  AND dac_t.try($$SELECT public.clear_dashboard_attention_item('missed_call', '40000000-0000-4000-8000-000000000001', NULL)$$) = '22023');

-- ---- T3 Campaign callbacks -----------------------------------------------------------------------------
SELECT dac_t.check('T3.1 a campaign callback is cleared at callback_due_at',
  (SELECT occurrence_at = '2026-10-30 15:00:00+00'::timestamptz
   FROM public.clear_dashboard_attention_item('campaign_callback', :CL1, '2026-10-30 15:00:00+00')));
SELECT dac_t.check('T3.2 a legacy callback (callback_due_at NULL) is cleared at scheduled_callback_at',
  (SELECT occurrence_at = '2026-10-31 10:00:00+00'::timestamptz
   FROM public.clear_dashboard_attention_item('campaign_callback', :CL4, '2026-10-31 10:00:00+00')));
SELECT dac_t.check('T3.3 another agent''s Personal-campaign callback is not visible, so not clearable (PT404)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('campaign_callback', '30000000-0000-4000-8000-000000000002', '2026-10-30 16:00:00+00')$$) = 'PT404');
SELECT dac_t.check('T3.4 a terminal (Completed) lead and a lead with no callback are not pending (PT404)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('campaign_callback', '30000000-0000-4000-8000-000000000003', '2026-10-30 17:00:00+00')$$) = 'PT404'
  AND dac_t.try($$SELECT public.clear_dashboard_attention_item('campaign_callback', '30000000-0000-4000-8000-000000000005', '2026-10-30 17:00:00+00')$$) = 'PT404');
SELECT dac_t.check('T3.5 another agency''s callback is refused (PT404)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('campaign_callback', '30000000-0000-4000-8000-0000000000b1', '2026-10-30 15:00:00+00')$$) = 'PT404');

-- Reschedule CL1 (the Dialer would do this through advance_campaign_lead; here the superuser, audit disarmed).
RESET ROLE;
UPDATE dac_t.armed SET on_ = false;
UPDATE public.campaign_leads SET callback_due_at = '2026-11-02 09:30:00+00', scheduled_callback_at = '2026-11-02 09:30:00+00' WHERE id = :CL1;
DELETE FROM t_src WHERE id = :CL1;
INSERT INTO t_src SELECT 'campaign_leads', id, xmin::text, md5(row_to_json(cl)::text) FROM public.campaign_leads cl WHERE id = :CL1;
UPDATE dac_t.armed SET on_ = true;
SET ROLE authenticated;
SELECT dac_t.claims(:A1, :ORG_A);
SELECT dac_t.check('T3.6a after a reschedule the old clearance no longer matches the callback''s due time',
  NOT EXISTS (SELECT 1 FROM public.dashboard_attention_clearances r JOIN public.campaign_leads cl ON cl.id = r.source_id
              WHERE r.source_id = :CL1 AND r.occurrence_at = COALESCE(cl.callback_due_at, cl.scheduled_callback_at)));
SELECT dac_t.check('T3.6b clearing with the time that was shown before the reschedule is "changed" (PT409)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('campaign_callback', '30000000-0000-4000-8000-000000000001', '2026-10-30 15:00:00+00')$$) = 'PT409');
SELECT dac_t.check('T3.6c clearing the new occurrence stores a second, separate row',
  (SELECT occurrence_at = '2026-11-02 09:30:00+00'::timestamptz
   FROM public.clear_dashboard_attention_item('campaign_callback', :CL1, '2026-11-02 09:30:00+00')));
SELECT dac_t.check('T3.6d ... so CL1 has two clearance rows, one per occurrence',
  (SELECT count(*) = 2 FROM public.dashboard_attention_clearances WHERE source_id = :CL1));

-- ---- T4 Appointment callbacks --------------------------------------------------------------------------
SELECT dac_t.check('T4.1 a Follow Up appointment callback is cleared at start_time',
  (SELECT occurrence_at = '2026-10-30 17:00:00+00'::timestamptz AND source_type = 'appointment_callback'
   FROM public.clear_dashboard_attention_item('appointment_callback', :AP1, '2026-10-30 17:00:00+00')));
SELECT dac_t.check('T4.2 a quick-call callback (user_id NULL, created_by = me) is clearable',
  (SELECT source_id = :AP2 FROM public.clear_dashboard_attention_item('appointment_callback', :AP2, '2026-10-30 18:00:00+00')));
SELECT dac_t.check('T4.3 another agent''s appointment is not visible (PT404)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('appointment_callback', '50000000-0000-4000-8000-000000000003', '2026-10-30 19:00:00+00')$$) = 'PT404');
SELECT dac_t.check('T4.4 a meeting and a Completed callback are not pending callbacks (PT404)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('appointment_callback', '50000000-0000-4000-8000-000000000004', '2026-10-30 20:00:00+00')$$) = 'PT404'
  AND dac_t.try($$SELECT public.clear_dashboard_attention_item('appointment_callback', '50000000-0000-4000-8000-000000000005', '2026-10-30 21:00:00+00')$$) = 'PT404');
SELECT dac_t.check('T4.5 a source id given under the wrong type is not found (PT404)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('appointment_callback', '30000000-0000-4000-8000-000000000004', '2026-10-31 10:00:00+00')$$) = 'PT404');

-- ---- T5 Direct table writes: the policy is the authority, not the RPC ------------------------------------
SELECT dac_t.check('T5.1 a direct INSERT with an occurrence the source does not have is refused (42501)',
  dac_t.try($$INSERT INTO public.dashboard_attention_clearances (organization_id, user_id, source_type, source_id, occurrence_at)
    VALUES ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'missed_call', '40000000-0000-4000-8000-000000000006', now())$$) = '42501');
SELECT dac_t.check('T5.2 a direct INSERT for a source hidden by its RLS is refused, even with the right time (42501)',
  dac_t.try($$INSERT INTO public.dashboard_attention_clearances (organization_id, user_id, source_type, source_id, occurrence_at)
    VALUES ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'campaign_callback', '30000000-0000-4000-8000-000000000002', '2026-10-30 16:00:00+00')$$) = '42501');
SELECT dac_t.check('T5.3 a direct INSERT for another user is refused (42501)',
  dac_t.try($$INSERT INTO public.dashboard_attention_clearances (organization_id, user_id, source_type, source_id, occurrence_at)
    VALUES ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000002', 'missed_call', '40000000-0000-4000-8000-000000000006', '2026-10-29 18:25:00.654321+00')$$) = '42501');
SELECT dac_t.check('T5.4 a direct INSERT for a peer agency''s call is refused (42501)',
  dac_t.try($$INSERT INTO public.dashboard_attention_clearances (organization_id, user_id, source_type, source_id, occurrence_at)
    VALUES ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'missed_call', '40000000-0000-4000-8000-000000000004', '2026-10-29 18:15:00+00')$$) = '42501');
SELECT dac_t.check('T5.5 a valid direct INSERT cannot backdate cleared_at (the guard stamps it)',
  dac_t.try($$INSERT INTO public.dashboard_attention_clearances (organization_id, user_id, source_type, source_id, occurrence_at, cleared_at)
    VALUES ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'missed_call', '40000000-0000-4000-8000-000000000006', '2026-10-29 18:25:00.654321+00', '2000-01-01')$$) = 'OK');
SELECT dac_t.check('T5.5b ... and the stored cleared_at is the server''s time',
  (SELECT cleared_at > now() - interval '1 hour' FROM public.dashboard_attention_clearances WHERE source_id = :K6));
SELECT dac_t.check('T5.6 a clearance cannot be edited (no UPDATE privilege, 42501)',
  dac_t.try($$UPDATE public.dashboard_attention_clearances SET occurrence_at = now()$$) = '42501');

-- ---- T6 Isolation --------------------------------------------------------------------------------------
RESET ROLE;
CREATE TEMP TABLE t_a1 AS SELECT id, cleared_at FROM public.dashboard_attention_clearances WHERE source_id = :AP1;
GRANT SELECT ON t_a1, t_k1 TO authenticated;
SET ROLE authenticated;
SELECT dac_t.claims(:A2, :ORG_A);
SELECT dac_t.check('T6.1 another agent sees none of A1''s clearances', (SELECT count(*) = 0 FROM public.dashboard_attention_clearances));
SELECT dac_t.check('T6.2 another agent cannot undo A1''s clearance', NOT (SELECT public.undo_dashboard_attention_clear(id, cleared_at) FROM t_a1));
SELECT dac_t.check('T6.3 another agent''s DELETE reaches none of A1''s rows', dac_t.try($$DELETE FROM public.dashboard_attention_clearances$$) = 'OK');
SELECT dac_t.check('T6.4 a missed call that rang A2 too is still pending for A2 (clearance is per viewer)',
  (SELECT user_id = :A2 FROM public.clear_dashboard_attention_item('missed_call', :K5, '2026-10-29 18:20:00.5+00')));
SELECT dac_t.claims(:AD, :ORG_A, 'Admin');
SELECT dac_t.check('T6.5 an Admin sees none of the agents'' clearances (own rows only)', (SELECT count(*) = 0 FROM public.dashboard_attention_clearances));
SELECT dac_t.check('T6.6 an Admin may clear an agent''s callback from the Admin''s own Dashboard',
  (SELECT user_id = :AD FROM public.clear_dashboard_attention_item('campaign_callback', :CL2, '2026-10-30 16:00:00+00')));
SELECT dac_t.claims(:TL, :ORG_A, 'Team Leader');
SELECT dac_t.check('T6.7 a Team Leader may clear a callback visible to them, for themselves',
  (SELECT user_id = :TL FROM public.clear_dashboard_attention_item('campaign_callback', :CL2, '2026-10-30 16:00:00+00')));
SELECT dac_t.claims(:B1, :ORG_B);
SELECT dac_t.check('T6.8 another agency sees none of these clearances', (SELECT count(*) = 0 FROM public.dashboard_attention_clearances));
SELECT dac_t.check('T6.9 another agency cannot clear this agency''s missed call (PT404)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('missed_call', '40000000-0000-4000-8000-000000000001', '2026-10-29 18:00:00.123456+00')$$) = 'PT404');
SELECT dac_t.claims(:A1, :ORG_B);
SELECT dac_t.check('T6.10 a JWT organization that disagrees with the profile is refused (42501)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('missed_call', '40000000-0000-4000-8000-000000000004', '2026-10-29 18:15:00+00')$$) = '42501');
SELECT dac_t.claims(:A3, :ORG_A);
SELECT dac_t.check('T6.11 an inactive profile is refused (42501)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('missed_call', '40000000-0000-4000-8000-000000000006', '2026-10-29 18:25:00.654321+00')$$) = '42501');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SET ROLE anon;
SELECT dac_t.check('T6.12 anon cannot execute either RPC or read the table (42501)',
  dac_t.try($$SELECT public.clear_dashboard_attention_item('missed_call', '40000000-0000-4000-8000-000000000001', now())$$) = '42501'
  AND dac_t.try($$SELECT public.undo_dashboard_attention_clear(gen_random_uuid(), now())$$) = '42501'
  AND dac_t.try($$SELECT 1 FROM public.dashboard_attention_clearances$$) = '42501');
RESET ROLE;
SELECT dac_t.check('T6.13 A1''s rows survived every other user''s attempts',
  (SELECT count(*) = 8 FROM public.dashboard_attention_clearances WHERE user_id = :A1));

-- ---- T7 Undo -------------------------------------------------------------------------------------------
SET ROLE authenticated;
SELECT dac_t.claims(:A1, :ORG_A);
SELECT dac_t.check('T7.1 Undo with a stale cleared_at removes nothing', NOT (SELECT public.undo_dashboard_attention_clear(id, cleared_at - interval '1 microsecond') FROM t_a1));
SELECT dac_t.check('T7.2 ... the clearance is still there', (SELECT count(*) = 1 FROM public.dashboard_attention_clearances WHERE source_id = :AP1));
SELECT dac_t.check('T7.3 Undo with the exact cleared_at removes exactly that row', (SELECT public.undo_dashboard_attention_clear(id, cleared_at) FROM t_a1));
SELECT dac_t.check('T7.4 ... so the callback is pending again for A1', (SELECT count(*) = 0 FROM public.dashboard_attention_clearances WHERE source_id = :AP1));
SELECT dac_t.check('T7.5 a second Undo of the same clearance reports false', NOT (SELECT public.undo_dashboard_attention_clear(id, cleared_at) FROM t_a1));
SELECT dac_t.check('T7.6 Undo needs both values (22023)', dac_t.try($$SELECT public.undo_dashboard_attention_clear(NULL, now())$$) = '22023');

-- ---- T8 Retention (own rows older than 90 days only) ---------------------------------------------------
RESET ROLE;
INSERT INTO public.dashboard_attention_clearances (organization_id, user_id, source_type, source_id, occurrence_at) VALUES
  (:ORG_A, :A1, 'missed_call', gen_random_uuid(), now() - interval '100 days'),
  (:ORG_A, :A1, 'missed_call', gen_random_uuid(), now() - interval '89 days'),
  (:ORG_A, :A2, 'missed_call', gen_random_uuid(), now() - interval '100 days');
SET ROLE authenticated;
SELECT dac_t.claims(:A1, :ORG_A);
SELECT dac_t.check('T8.1 a new clear runs the caller''s retention step',
  (SELECT source_id = :AP6 FROM public.clear_dashboard_attention_item('appointment_callback', :AP6, '2026-10-30 22:00:00+00')));
RESET ROLE;
SELECT dac_t.check('T8.2 the caller''s 100-day-old row is gone, the 89-day-old row stays',
  (SELECT count(*) = 0 FROM public.dashboard_attention_clearances WHERE user_id = :A1 AND occurrence_at < now() - interval '90 days')
  AND (SELECT count(*) = 1 FROM public.dashboard_attention_clearances WHERE user_id = :A1 AND occurrence_at BETWEEN now() - interval '90 days' AND now() - interval '80 days'));
SELECT dac_t.check('T8.3 another user''s old row is untouched', (SELECT count(*) = 1 FROM public.dashboard_attention_clearances WHERE user_id = :A2 AND occurrence_at < now() - interval '90 days'));

-- ---- T9 No source record was written --------------------------------------------------------------------
SELECT dac_t.check('T9.1 no INSERT/UPDATE/DELETE reached calls, campaign_leads or appointments', (SELECT count(*) = 0 FROM dac_t.source_writes));
SELECT dac_t.check('T9.2 every source row has its original row version and content',
  NOT EXISTS (
    SELECT 1 FROM t_src s
    LEFT JOIN (
      SELECT 'calls' AS tbl, id, xmin::text AS xv, md5(row_to_json(c)::text) AS h FROM public.calls c
      UNION ALL SELECT 'campaign_leads', id, xmin::text, md5(row_to_json(cl)::text) FROM public.campaign_leads cl
      UNION ALL SELECT 'appointments', id, xmin::text, md5(row_to_json(a)::text) FROM public.appointments a) n
      ON n.tbl = s.tbl AND n.id = s.id
    WHERE n.id IS NULL OR n.xv <> s.xv OR n.h <> s.h));
SELECT dac_t.check('T9.3 the missed call is still missed, unanswered, with its duration and status',
  (SELECT is_missed AND agent_id IS NULL AND duration = 0 AND status = 'no-answer' FROM public.calls WHERE id = :K1));
SELECT dac_t.check('T9.4 the rescheduled callback keeps its due time and owner; the appointment stays Scheduled',
  (SELECT callback_due_at = '2026-11-02 09:30:00+00'::timestamptz AND callback_agent_id = :A1 AND status = 'Queued' FROM public.campaign_leads WHERE id = :CL1)
  AND (SELECT status = 'Scheduled' FROM public.appointments WHERE id = :AP1));

-- ---- T10 Lifecycle -------------------------------------------------------------------------------------
SELECT dac_t.check('T10.0 A2 holds clearances before deletion', (SELECT count(*) = 2 FROM public.dashboard_attention_clearances WHERE user_id = :A2));
DELETE FROM public.profiles WHERE id = :A2;
DELETE FROM auth.users WHERE id = :A2;
SELECT dac_t.check('T10.1 deleting a user removes their clearances (cascade), and nobody else''s',
  (SELECT count(*) = 0 FROM public.dashboard_attention_clearances WHERE user_id = :A2)
  AND (SELECT count(*) > 0 FROM public.dashboard_attention_clearances WHERE user_id = :A1));

SELECT 'ALL dashboard_attention_clearances CHECKS PASSED' AS result;
