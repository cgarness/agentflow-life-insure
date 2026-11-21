-- psql against an isolated base-release database, before installing the candidate.
-- Keep this prerequisite explicit since this rehearsal applies migrations that commit.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'automation_legacy_rehearsal%' OR EXISTS (SELECT FROM public.workflows) THEN
    RAISE EXCEPTION 'Use a new disposable automation_legacy_rehearsal database on the release baseline';
  END IF;
END $$;
BEGIN;
CREATE FUNCTION pg_temp.i(n int) RETURNS uuid LANGUAGE sql AS $$SELECT ('bce00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
INSERT INTO public.organizations(id,name) VALUES(pg_temp.i(1),'Isolated upgrade');
INSERT INTO public.workflow_folders(id,organization_id,name) VALUES(pg_temp.i(11),pg_temp.i(1),'Older folder');
INSERT INTO public.workflows(id,organization_id,name,trigger_type,status,folder_id,trigger_config) VALUES
(pg_temp.i(12),pg_temp.i(1),'Advanced legacy graph','stage_change','paused',pg_temp.i(11),'{"custom_configuration":"keep"}');
INSERT INTO public.workflow_nodes(id,organization_id,workflow_id,type,action_type,config) VALUES
(pg_temp.i(13),pg_temp.i(1),pg_temp.i(12),'trigger',null,'{"future":"unknown"}'),
(pg_temp.i(14),pg_temp.i(1),pg_temp.i(12),'action','webhook','{"url":"https://example.invalid","test_value":"legacy-webhook"}');
INSERT INTO public.workflow_edges(id,organization_id,workflow_id,source_node_id,target_node_id) VALUES
(pg_temp.i(15),pg_temp.i(1),pg_temp.i(12),pg_temp.i(13),pg_temp.i(14));
INSERT INTO public.workflow_executions(id,workflow_id,organization_id,contact_id,current_node_id,status) VALUES
(pg_temp.i(16),pg_temp.i(12),pg_temp.i(1),pg_temp.i(18),pg_temp.i(14),'completed');
INSERT INTO public.workflow_execution_steps(id,execution_id,organization_id,node_id,status,output_data) VALUES
(pg_temp.i(17),pg_temp.i(16),pg_temp.i(1),pg_temp.i(14),'completed','{"legacy_receipt":"fixture"}');
COMMIT;

-- Serialize every pre-existing workflow column, node, edge, folder and execution payload.
CREATE FUNCTION pg_temp.legacy_rows() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'workflows',(SELECT jsonb_agg(to_jsonb(w)-ARRAY['automation_graph','automation_draft_name','automation_revision','automation_version_id'] ORDER BY id) FROM public.workflows w),
    'nodes',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.workflow_nodes n),
    'edges',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.workflow_edges e),
    'folders',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM public.workflow_folders f),
    'runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.workflow_executions r),
    'steps',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.workflow_execution_steps s))
$$;
CREATE TEMP TABLE upgrade_baseline AS SELECT pg_temp.legacy_rows() AS snapshot;

\ir ../migrations/20261121075959_automation_sessions.sql
\ir ../migrations/20261121080000_automation_authoring.sql
\ir ../migrations/20261121080100_automation_runtime.sql
\ir ../migrations/20261121080200_automation_message_history.sql

DO $$ BEGIN
  IF pg_temp.legacy_rows() IS DISTINCT FROM (SELECT snapshot FROM upgrade_baseline) THEN
    RAISE EXCEPTION 'Installing the candidate changed the original definition, graph or history';
  END IF;
  IF EXISTS (SELECT FROM public.workflow_versions) OR EXISTS (SELECT FROM public.automation_intervals)
      OR EXISTS (SELECT FROM private.automation_events) OR EXISTS (SELECT FROM private.automation_runs)
      OR EXISTS (SELECT FROM private.automation_intents) OR EXISTS (SELECT FROM private.automation_messages) THEN
    RAISE EXCEPTION 'Unexpected installation activity';
  END IF;
END $$;
