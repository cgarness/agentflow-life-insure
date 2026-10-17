-- =====================================================================================================
-- ROLLBACK for 20261013120000_google_sheets_import_foundation.sql — run only with explicit approval.
-- Unschedule the cron job FIRST (if the pending schedule migration was applied):
--   SELECT cron.unschedule('google-sheets-sync-every-minute');
-- Effects: removes every Google Sheets object, Vault refresh-token secret, sync history, row ledger and
-- PERMANENT RECEIPTS (re-adding a sheet after a rollback could then re-import rows). Leads created by
-- the feature are NOT touched. Restores the exact _contacts_permission_default preimage.
-- =====================================================================================================
DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname IN ('public','private') AND p.proname LIKE 'google\_sheets\_%' LOOP
    EXECUTE format('DROP FUNCTION %s', fn);
  END LOOP;
END $$;

DELETE FROM vault.secrets WHERE name LIKE 'google\_sheets\_refresh\_%';

DROP TABLE private.google_sheets_receipts;
DROP TABLE private.google_sheets_source_rows;
DROP TABLE private.google_sheets_oauth_states;
DROP TABLE public.google_sheets_sync_runs;
DROP TABLE public.google_sheets_sources;
DROP TABLE public.google_sheets_connections;

CREATE OR REPLACE FUNCTION public._contacts_permission_default(p_role text, p_key text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT CASE p_role WHEN 'Agent' THEN d.agent WHEN 'Team Leader' THEN d.team_leader ELSE false END
     FROM (VALUES
       ('contacts.leads.view_assigned',   true,  true),
       ('contacts.leads.view_unassigned', false, true),
       ('contacts.leads.view_all',        false, false),
       ('contacts.leads.create',          true,  true),
       ('contacts.leads.edit',            true,  true),
       ('contacts.leads.delete',          false, false),
       ('contacts.leads.import',          false, true),
       ('contacts.leads.undo_own_import', false, true),
       ('contacts.leads.undo_team_import',false, true),
       ('contacts.leads.assign',          false, true),
       ('contacts.leads.bulk_assign',     false, true),
       ('contacts.leads.bulk_status',     true,  true),
       ('contacts.leads.update_status',   true,  true),
       ('contacts.leads.add_to_campaign', false, true),
       ('contacts.clients.view',          true,  true),
       ('contacts.clients.edit',          true,  true),
       ('contacts.clients.delete',        false, false),
       ('contacts.recruits.view',         true,  true),
       ('contacts.recruits.create',       true,  true),
       ('contacts.recruits.edit',         true,  true),
       ('contacts.recruits.delete',       false, false),
       ('contacts.notes.manage',          true,  true),
       ('contacts.tasks.manage',          true,  true),
       ('contacts.appointments.manage',   true,  true),
       ('contacts.messages.manage',       true,  true)
     ) AS d(key, agent, team_leader)
     WHERE d.key = p_key),
    false
  );
$function$
;
REVOKE ALL ON FUNCTION public._contacts_permission_default(text, text) FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF md5(pg_get_functiondef('public._contacts_permission_default(text,text)'::regprocedure)) <> 'a199d5ddfb9a56070aeb7706d3e9a4b8' THEN
    RAISE EXCEPTION 'rollback did not restore the exact _contacts_permission_default preimage';
  END IF;
END $$;
