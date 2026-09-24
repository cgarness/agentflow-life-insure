-- TEST-ONLY: return the LOCAL stack to the synthetic baseline between scenarios (implementation_plan.md §10).
-- The harness runs it only via `docker exec` into supabase_db_agentflow-localverify.
-- The DELETEs below are NOT scoped by organization: they empty these tables entirely. That is safe only
-- because (1) the harness targets that disposable container, and (2) the guard refuses to run when any
-- organization other than the two fixture orgs exists. The guard is a fresh-stack check, not a locality
-- check: an empty non-local database would also pass it. Never run this file anywhere else.
-- bootstrap.mjs then re-applies fixtures.sql.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id NOT IN (
       'a1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001')) THEN
    RAISE EXCEPTION 'refusing: non-fixture organizations present';
  END IF;
END $$;
DELETE FROM public.dialer_lead_locks;
DELETE FROM public.campaign_lead_agent_suppressions;
DELETE FROM public.wins;
DELETE FROM public.contact_activities;
DELETE FROM public.contact_notes;
DELETE FROM public.calls;
DELETE FROM public.clients;
DELETE FROM public.campaign_leads;
DELETE FROM public.leads;
DELETE FROM public.dialer_sessions;
COMMIT;
