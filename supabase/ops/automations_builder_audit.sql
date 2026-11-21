-- Read-only installation/visibility evidence. Supply the one agency_id selected for review.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='250ms';
SELECT EXISTS (SELECT FROM public.organizations WHERE id=:'agency_id'::uuid) AS agency_exists;
SELECT (SELECT count(*) FROM public.workflows) AS definitions,
       (SELECT count(*) FROM public.workflow_executions) AS legacy_runs,
       (SELECT count(*) FROM public.workflow_execution_steps) AS legacy_steps;
SELECT to_regclass('private.automation_session_cutover') IS NOT NULL AS sessions,
       to_regclass('public.workflow_versions') IS NOT NULL AS versions,
       to_regclass('private.automation_runs') IS NOT NULL AS runtime,
       to_regclass('private.automation_messages') IS NOT NULL AS messaging;
SELECT to_regclass('private.automation_messages') IS NOT NULL AS installed \gset
\if :installed
SELECT (SELECT count(*) FROM public.workflows WHERE automation_graph IS NOT NULL) AS versioned_builder_definitions,
       (SELECT count(*) FROM public.workflow_versions) AS published_versions,
       (SELECT count(*) FROM public.automation_intervals) AS active_or_closed_intervals,
       (SELECT count(*) FROM private.automation_events) AS intake_events,
       (SELECT count(*) FROM private.automation_runs) AS runs,
       (SELECT count(*) FROM private.automation_intents) AS intents,
       (SELECT count(*) FROM private.automation_messages) AS message_intents,
       (SELECT count(*) FROM public.messages WHERE automation_message_id IS NOT NULL) AS automation_sms_history,
       (SELECT count(*) FROM public.contact_emails WHERE automation_message_id IS NOT NULL) AS automation_email_history;
SELECT count(*) FILTER (WHERE builder_visible) AS visible_agencies,
       count(*) FILTER (WHERE enrollment_enabled) AS enrollment_enabled_agencies,
       count(*) FILTER (WHERE dispatch_enabled) AS dispatch_enabled_agencies
  FROM private.automation_release_controls;
SELECT coalesce(c.builder_visible,false) AS builder_visible, coalesce(c.enrollment_enabled,false) AS enrollment_enabled,
       coalesce(c.dispatch_enabled,false) AS dispatch_enabled,
       (SELECT visibility_cutover_at IS NOT NULL FROM private.automation_session_cutover WHERE singleton) AS session_cutover_sealed
  FROM public.organizations o LEFT JOIN private.automation_release_controls c ON c.organization_id=o.id
 WHERE o.id=:'agency_id'::uuid;
\endif
COMMIT;
