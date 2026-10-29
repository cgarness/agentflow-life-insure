-- =====================================================================================================
-- Dashboard milestone review state (G2) — behaviour suite.
-- Run by scripts/run_dashboard_milestone_tests.sh on a disposable LOCAL database after the harness and
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
\set C_A1 '''c0000000-0000-4000-8000-0000000000a1'''
\set C_A2 '''c0000000-0000-4000-8000-0000000000a2'''
\set C_B1 '''c0000000-0000-4000-8000-0000000000b1'''
\set P1 '''e0000000-0000-4000-8000-0000000000e1'''

-- ---- Fixture (superuser) -----------------------------------------------------------------------------
INSERT INTO public.organizations VALUES (:ORG_A, 'Agency A'), (:ORG_B, 'Agency B');
INSERT INTO auth.users VALUES (:A1), (:A2), (:TL), (:AD), (:B1), (:A3);
INSERT INTO public.profiles VALUES
  (:TL, :ORG_A, 'Team Leader', 'Active', NULL),
  (:A1, :ORG_A, 'Agent', 'Active', :TL),
  (:A2, :ORG_A, 'Agent', 'Active', NULL),
  (:AD, :ORG_A, 'Admin', 'Active', NULL),
  (:B1, :ORG_B, 'Agent', 'Active', NULL),
  (:A3, :ORG_A, 'Agent', 'Inactive', NULL);
INSERT INTO public.clients VALUES (:C_A1, :ORG_A, :A1, 'Riley'), (:C_A2, :ORG_A, :A2, 'Sam'), (:C_B1, :ORG_B, :B1, 'Pat');

-- ---- T1 metadata ---------------------------------------------------------------------------------------
SELECT dmr_t.check('T1.1 RLS enabled', relrowsecurity) FROM pg_class WHERE oid = 'public.dashboard_milestone_reviews'::regclass;
SELECT dmr_t.check('T1.2 four policies, all TO authenticated',
  (SELECT count(*) = 4 AND bool_and(roles = '{authenticated}') FROM pg_policies WHERE tablename = 'dashboard_milestone_reviews'));
SELECT dmr_t.check('T1.3 anon holds no table privilege',
  NOT has_table_privilege('anon', 'public.dashboard_milestone_reviews', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
SELECT dmr_t.check('T1.4 authenticated: SELECT/INSERT/UPDATE/DELETE and nothing else',
  has_table_privilege('authenticated', 'public.dashboard_milestone_reviews', 'SELECT')
  AND has_table_privilege('authenticated', 'public.dashboard_milestone_reviews', 'INSERT')
  AND has_table_privilege('authenticated', 'public.dashboard_milestone_reviews', 'UPDATE')
  AND has_table_privilege('authenticated', 'public.dashboard_milestone_reviews', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.dashboard_milestone_reviews', 'TRUNCATE,REFERENCES,TRIGGER'));
SELECT dmr_t.check('T1.5 service_role: SELECT only',
  has_table_privilege('service_role', 'public.dashboard_milestone_reviews', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.dashboard_milestone_reviews', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
SELECT dmr_t.check('T1.6 both RPCs SECURITY INVOKER with a pinned search_path',
  (SELECT count(*) = 2 AND bool_and(NOT prosecdef) AND bool_and(proconfig = '{"search_path=pg_catalog, pg_temp"}')
   FROM pg_proc WHERE proname IN ('set_dashboard_milestone_review', 'clear_dashboard_milestone_review')));
SELECT dmr_t.check('T1.7 EXECUTE: authenticated only (no anon, no PUBLIC, no service_role)',
  has_function_privilege('authenticated', 'public.set_dashboard_milestone_review(text,uuid,text,date,text,timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.clear_dashboard_milestone_review(uuid,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.set_dashboard_milestone_review(text,uuid,text,date,text,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.clear_dashboard_milestone_review(uuid,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.set_dashboard_milestone_review(text,uuid,text,date,text,timestamptz)', 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                  WHERE p.proname IN ('set_dashboard_milestone_review', 'clear_dashboard_milestone_review', 'dashboard_milestone_reviews_guard')
                    AND a.grantee = 0));
SELECT dmr_t.check('T1.8 the guard function is executable by no client role',
  NOT has_function_privilege('authenticated', 'private.dashboard_milestone_reviews_guard()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'private.dashboard_milestone_reviews_guard()', 'EXECUTE'));

-- ---- T2 Agent A1: own client ---------------------------------------------------------------------------
SET ROLE authenticated;
SELECT dmr_t.claims(:A1, :ORG_A);
SELECT dmr_t.check('T2.1 Mark Reviewed stores the caller''s row with derived user and organization',
  (SELECT user_id = :A1 AND organization_id = :ORG_A AND occurrence_year = 2026 AND state = 'reviewed' AND remind_at IS NULL
   FROM public.set_dashboard_milestone_review('client_birthday', :C_A1, 'birthday', '2026-11-03', 'reviewed')));
CREATE TEMP TABLE t_first AS SELECT id, updated_at FROM public.dashboard_milestone_reviews;
SELECT dmr_t.check('T2.2a Remind Later on the same occurrence updates that row with a new updated_at',
  (SELECT r.id = f.id AND r.state = 'snoozed' AND r.updated_at > f.updated_at
   FROM public.set_dashboard_milestone_review('client_birthday', :C_A1, 'birthday', '2026-11-03', 'snoozed', now() + interval '3 days') r, t_first f));
SELECT dmr_t.check('T2.2b ... and there is still one row', (SELECT count(*) = 1 FROM public.dashboard_milestone_reviews));
SELECT dmr_t.check('T2.3a another year of the same birthday is stored with its own year',
  (SELECT occurrence_year = 2027 FROM public.set_dashboard_milestone_review('client_birthday', :C_A1, 'birthday', '2027-11-03', 'reviewed')));
SELECT dmr_t.check('T2.3b ... as a separate row', (SELECT count(*) = 2 FROM public.dashboard_milestone_reviews));
SELECT dmr_t.check('T2.4 another agent''s client is not found (PT404)',
  dmr_t.try($$SELECT public.set_dashboard_milestone_review('client_birthday', 'c0000000-0000-4000-8000-0000000000a2', 'birthday', '2026-11-03', 'reviewed')$$) = 'PT404');
SELECT dmr_t.check('T2.5 another agency''s client is not found (PT404)',
  dmr_t.try($$SELECT public.set_dashboard_milestone_review('client_birthday', 'c0000000-0000-4000-8000-0000000000b1', 'birthday', '2026-11-03', 'reviewed')$$) = 'PT404');
SELECT dmr_t.check('T2.6 a forged user_id on a direct insert is refused by RLS (42501)',
  dmr_t.try($$INSERT INTO public.dashboard_milestone_reviews (organization_id, user_id, client_id, milestone_kind, event_key, occurrence_year, occurrence_date, state)
             VALUES ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-0000000000a1', 'client_birthday', 'birthday', 2026, '2026-11-03', 'reviewed')$$) = '42501');
SELECT dmr_t.check('T2.7 a forged organization on a direct insert is refused by RLS (42501)',
  dmr_t.try($$INSERT INTO public.dashboard_milestone_reviews (organization_id, user_id, client_id, milestone_kind, event_key, occurrence_year, occurrence_date, state)
             VALUES ('b0000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b1', 'client_birthday', 'birthday', 2026, '2026-11-03', 'reviewed')$$) = '42501');
SELECT dmr_t.check('T2.8 a direct insert for a client the caller cannot see is refused by RLS (42501)',
  dmr_t.try($$INSERT INTO public.dashboard_milestone_reviews (organization_id, user_id, client_id, milestone_kind, event_key, occurrence_year, occurrence_date, state)
             VALUES ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000a2', 'client_birthday', 'birthday', 2026, '2026-11-03', 'reviewed')$$) = '42501');

-- ---- T3 input validation (22023) and table constraints (23514) ------------------------------------------
SELECT dmr_t.check('T3.1 unknown kind', dmr_t.try($$SELECT public.set_dashboard_milestone_review('renewal', 'c0000000-0000-4000-8000-0000000000a1', 'birthday', '2026-11-03', 'reviewed')$$) = '22023');
SELECT dmr_t.check('T3.2 wrong event key for a birthday', dmr_t.try($$SELECT public.set_dashboard_milestone_review('client_birthday', 'c0000000-0000-4000-8000-0000000000a1', 'x', '2026-11-03', 'reviewed')$$) = '22023');
SELECT dmr_t.check('T3.3 anniversary key must be a policy uuid or primary',
  dmr_t.try($$SELECT public.set_dashboard_milestone_review('policy_anniversary', 'c0000000-0000-4000-8000-0000000000a1', 'garbage', '2026-11-05', 'reviewed')$$) = '22023'
  AND dmr_t.try($$SELECT public.set_dashboard_milestone_review('policy_anniversary', 'c0000000-0000-4000-8000-0000000000a1', 'primary', '2026-11-05', 'reviewed')$$) = 'OK'
  AND dmr_t.try($$SELECT public.set_dashboard_milestone_review('policy_anniversary', 'c0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000e1', '2026-11-05', 'reviewed')$$) = 'OK');
SELECT dmr_t.check('T3.4 Remind Later needs a time; Mark Reviewed takes none',
  dmr_t.try($$SELECT public.set_dashboard_milestone_review('client_birthday', 'c0000000-0000-4000-8000-0000000000a1', 'birthday', '2026-11-03', 'snoozed')$$) = '22023'
  AND dmr_t.try($$SELECT public.set_dashboard_milestone_review('client_birthday', 'c0000000-0000-4000-8000-0000000000a1', 'birthday', '2026-11-03', 'reviewed', now() + interval '1 day')$$) = '22023');
SELECT dmr_t.check('T3.5 a reminder in the past or more than 31 days ahead is refused',
  dmr_t.try($$SELECT public.set_dashboard_milestone_review('client_birthday', 'c0000000-0000-4000-8000-0000000000a1', 'birthday', '2026-11-03', 'snoozed', now() - interval '1 minute')$$) = '22023'
  AND dmr_t.try($$SELECT public.set_dashboard_milestone_review('client_birthday', 'c0000000-0000-4000-8000-0000000000a1', 'birthday', '2026-11-03', 'snoozed', now() + interval '32 days')$$) = '22023');
SELECT dmr_t.check('T3.6 a direct insert cannot bypass the reminder bound (trigger) or the key rules (CHECK)',
  dmr_t.try($$INSERT INTO public.dashboard_milestone_reviews (organization_id, user_id, client_id, milestone_kind, event_key, occurrence_year, occurrence_date, state, remind_at)
             VALUES ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000a1', 'client_birthday', 'birthday', 2028, '2028-11-03', 'snoozed', now() + interval '90 days')$$) = '22023'
  AND dmr_t.try($$INSERT INTO public.dashboard_milestone_reviews (organization_id, user_id, client_id, milestone_kind, event_key, occurrence_year, occurrence_date, state)
             VALUES ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000a1', 'client_birthday', 'other', 2028, '2028-11-03', 'reviewed')$$) = '23514'
  AND dmr_t.try($$INSERT INTO public.dashboard_milestone_reviews (organization_id, user_id, client_id, milestone_kind, event_key, occurrence_year, occurrence_date, state)
             VALUES ('a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000a1', 'client_birthday', 'birthday', 2027, '2028-11-03', 'reviewed')$$) = '23514');
SELECT dmr_t.check('T3.7 a row cannot be moved to another client or event (22023)',
  dmr_t.try($$UPDATE public.dashboard_milestone_reviews SET client_id = 'c0000000-0000-4000-8000-0000000000a2' WHERE occurrence_year = 2027$$) = '22023'
  AND dmr_t.try($$UPDATE public.dashboard_milestone_reviews SET event_key = 'other' WHERE occurrence_year = 2027$$) IN ('22023', '23514'));

-- ---- T4 first payment is one-time ------------------------------------------------------------------------
SELECT dmr_t.check('T4.1a first payment reviewed',
  (SELECT state = 'reviewed' FROM public.set_dashboard_milestone_review('first_payment', :C_A1, 'first_payment', '2026-11-05', 'reviewed')));
SELECT dmr_t.check('T4.1b a later Draft Date (another year) updates that row',
  (SELECT occurrence_year = 2027 AND occurrence_date = '2027-01-05'
   FROM public.set_dashboard_milestone_review('first_payment', :C_A1, 'first_payment', '2027-01-05', 'reviewed')));
SELECT dmr_t.check('T4.1c ... one first-payment row per client, whatever the year',
  (SELECT count(*) = 1 FROM public.dashboard_milestone_reviews WHERE milestone_kind = 'first_payment'));

-- ---- T5 Undo is conditional ------------------------------------------------------------------------------
CREATE TEMP TABLE t_fp AS SELECT id, updated_at FROM public.dashboard_milestone_reviews WHERE milestone_kind = 'first_payment';
SELECT dmr_t.check('T5.1a a stale updated_at deletes nothing',
  NOT (SELECT public.clear_dashboard_milestone_review(id, updated_at - interval '1 microsecond') FROM t_fp));
SELECT dmr_t.check('T5.1b ... the row is still there',
  (SELECT count(*) = 1 FROM public.dashboard_milestone_reviews WHERE milestone_kind = 'first_payment'));
SELECT dmr_t.check('T5.2a the exact updated_at deletes the row',
  (SELECT public.clear_dashboard_milestone_review(id, updated_at) FROM t_fp));
SELECT dmr_t.check('T5.2b ... and it is gone',
  (SELECT count(*) = 0 FROM public.dashboard_milestone_reviews WHERE milestone_kind = 'first_payment'));

-- ---- T6 isolation between users --------------------------------------------------------------------------
RESET ROLE;
CREATE TEMP TABLE t_a1 AS SELECT id, updated_at FROM public.dashboard_milestone_reviews WHERE user_id = :A1 ORDER BY id LIMIT 1;
GRANT SELECT ON t_a1, t_first, t_fp TO authenticated;
SET ROLE authenticated;
SELECT dmr_t.claims(:A2, :ORG_A);
SELECT dmr_t.check('T6.1 another agent sees none of A1''s rows', (SELECT count(*) = 0 FROM public.dashboard_milestone_reviews));
SELECT dmr_t.check('T6.2 another agent cannot undo A1''s row', NOT (SELECT public.clear_dashboard_milestone_review(id, updated_at) FROM t_a1));
SELECT dmr_t.check('T6.3 another agent''s UPDATE reaches none of A1''s rows', dmr_t.try($$UPDATE public.dashboard_milestone_reviews SET state = 'reviewed', remind_at = NULL$$) = 'OK');
RESET ROLE;
SELECT dmr_t.check('T6.3b ... and A1''s snoozed birthday is unchanged',
  (SELECT state = 'snoozed' FROM public.dashboard_milestone_reviews
   WHERE user_id = :A1 AND milestone_kind = 'client_birthday' AND occurrence_year = 2026));
SET ROLE authenticated;
SELECT dmr_t.claims(:AD, :ORG_A, 'Admin');
SELECT dmr_t.check('T6.4 review state is per user: an Admin sees none of A1''s rows', (SELECT count(*) = 0 FROM public.dashboard_milestone_reviews));
SELECT dmr_t.check('T6.5 an Admin may review a client in the agency for themselves',
  (SELECT user_id = :AD FROM public.set_dashboard_milestone_review('client_birthday', :C_A1, 'birthday', '2026-11-03', 'reviewed')));
SELECT dmr_t.claims(:TL, :ORG_A, 'Team Leader');
SELECT dmr_t.check('T6.6 a Team Leader may review a downline client visible to them',
  (SELECT user_id = :TL FROM public.set_dashboard_milestone_review('client_birthday', :C_A1, 'birthday', '2026-11-03', 'reviewed')));
SELECT dmr_t.check('T6.7 ... but not a client outside their visibility (PT404)',
  dmr_t.try($$SELECT public.set_dashboard_milestone_review('client_birthday', 'c0000000-0000-4000-8000-0000000000a2', 'birthday', '2026-11-03', 'reviewed')$$) = 'PT404');

-- ---- T7 identity agreement -------------------------------------------------------------------------------
SELECT dmr_t.claims(:A1, :ORG_B);
SELECT dmr_t.check('T7.1 a JWT organization that disagrees with the profile is refused (42501)',
  dmr_t.try($$SELECT public.set_dashboard_milestone_review('client_birthday', 'c0000000-0000-4000-8000-0000000000b1', 'birthday', '2026-11-03', 'reviewed')$$) = '42501');
SELECT dmr_t.claims(:A3, :ORG_A);
SELECT dmr_t.check('T7.2 an inactive profile is refused (42501)',
  dmr_t.try($$SELECT public.set_dashboard_milestone_review('client_birthday', 'c0000000-0000-4000-8000-0000000000a1', 'birthday', '2026-11-03', 'reviewed')$$) = '42501');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SET ROLE anon;
SELECT dmr_t.check('T7.3 anon cannot execute either RPC (42501)',
  dmr_t.try($$SELECT public.set_dashboard_milestone_review('client_birthday', 'c0000000-0000-4000-8000-0000000000a1', 'birthday', '2026-11-03', 'reviewed')$$) = '42501'
  AND dmr_t.try($$SELECT public.clear_dashboard_milestone_review(gen_random_uuid(), now())$$) = '42501'
  AND dmr_t.try($$SELECT 1 FROM public.dashboard_milestone_reviews$$) = '42501');
RESET ROLE;

-- ---- T8 lifecycle --------------------------------------------------------------------------------------
SELECT dmr_t.check('T8.1 the business record is untouched by any of this',
  (SELECT count(*) = 3 FROM public.clients) AND (SELECT first_name = 'Riley' AND assigned_agent_id = :A1 FROM public.clients WHERE id = :C_A1));
DELETE FROM public.clients WHERE id = :C_A1;
SELECT dmr_t.check('T8.2 deleting a client removes its review rows (cascade)',
  (SELECT count(*) = 0 FROM public.dashboard_milestone_reviews WHERE client_id = :C_A1));

SELECT 'ALL dashboard_milestone_reviews CHECKS PASSED' AS result;
