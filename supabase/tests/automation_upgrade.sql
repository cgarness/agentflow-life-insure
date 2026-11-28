-- psql against an isolated base-release database, before installing the candidate.
-- Keep this prerequisite explicit since this rehearsal applies migrations that commit.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'automation_legacy_rehearsal%' OR EXISTS (SELECT FROM public.workflows) THEN
    RAISE EXCEPTION 'Use a new disposable automation_legacy_rehearsal database on the release baseline';
  END IF;
END $$;
\ir fixtures/automation_legacy.sql
\ir fixtures/automation_legacy_rows.sql
CREATE TEMP TABLE upgrade_baseline AS SELECT pg_temp.legacy_rows() AS snapshot;

\ir ../migrations/20261121075959_automation_sessions.sql
\ir ../migrations/20261121080000_automation_authoring.sql
\ir ../migrations/20261121080100_automation_runtime.sql
\ir ../migrations/20261121080200_automation_message_history.sql
-- Production applied the contact first-text sender after the first release (ledger 20261123231917).
\ir ../migrations/20261123170000_contact_first_sms_sender.sql
\ir ../migrations/20261124100000_automation_v2_authoring.sql
\ir ../migrations/20261124100100_automation_v2_events.sql
\ir ../migrations/20261124100200_automation_v2_tasks.sql
\ir ../migrations/20261124100300_automation_v2_appointment_timing.sql
\ir ../migrations/20261124100400_automation_v2_inbound_callbacks.sql
\ir ../migrations/20261124100500_automation_v2_policy_issuance.sql
\ir ../migrations/20261124100600_automation_v2_runtime.sql

DO $$ BEGIN
  IF pg_temp.legacy_rows() IS DISTINCT FROM (SELECT snapshot FROM upgrade_baseline) THEN
    RAISE EXCEPTION 'Installing the candidate changed the original definition, graph or history';
  END IF;
  IF EXISTS (SELECT FROM public.workflow_versions) OR EXISTS (SELECT FROM public.automation_intervals)
      OR EXISTS (SELECT FROM private.automation_events) OR EXISTS (SELECT FROM private.automation_runs)
      OR EXISTS (SELECT FROM private.automation_intents) OR EXISTS (SELECT FROM private.automation_messages)
      OR EXISTS (SELECT FROM private.automation_sms_purposes) OR EXISTS (SELECT FROM private.automation_task_receipts)
      OR EXISTS (SELECT FROM public.inbound_callbacks) OR EXISTS (SELECT FROM public.policy_issuance_confirmations)
      OR EXISTS (SELECT FROM public.tasks WHERE NOT all_day OR automation_run_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Unexpected installation activity';
  END IF;
END $$;
