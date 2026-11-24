-- Read-only. Which of the seven Automations V2 files are installed, so a stopped installation is resumed from the
-- right file or backed out with rollback/20261124100600_automation_v2_stopped_install.rollback.sql.
-- Each file runs as one transaction, so it is either wholly present or wholly absent. Each is recognised by an object
-- that only it creates. A healthy result is a prefix: files 1..installed present, the rest absent.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
WITH files(n, version, name, present) AS (VALUES
  (1, '20261124100000', 'automation_v2_authoring', to_regprocedure('public.automation_sms_requirements(uuid)') IS NOT NULL),
  (2, '20261124100100', 'automation_v2_events', to_regprocedure('private.automation_stop_check(private.automation_runs)') IS NOT NULL),
  (3, '20261124100200', 'automation_v2_tasks', to_regclass('private.automation_task_receipts') IS NOT NULL),
  (4, '20261124100300', 'automation_v2_appointment_timing', to_regprocedure('private.automation_capture_appointment_slot()') IS NOT NULL),
  (5, '20261124100400', 'automation_v2_inbound_callbacks', to_regclass('public.inbound_callbacks') IS NOT NULL),
  (6, '20261124100500', 'automation_v2_policy_issuance', to_regclass('public.policy_issuance_confirmations') IS NOT NULL),
  (7, '20261124100600', 'automation_v2_runtime', to_regprocedure('public.automation_create_task(uuid,uuid,text,text,text)') IS NOT NULL)
)
SELECT jsonb_build_object(
  'installed', count(*) FILTER (WHERE present),
  -- Files 1..installed and nothing after them.
  'prefix', bool_and(present = (n <= (SELECT count(*) FROM files f WHERE f.present))),
  'next', (SELECT version || '_' || name || '.sql' FROM files f WHERE NOT f.present ORDER BY n LIMIT 1),
  'files', jsonb_agg(jsonb_build_object('version', version, 'name', name, 'present', present) ORDER BY n)
) FROM files;
COMMIT;
