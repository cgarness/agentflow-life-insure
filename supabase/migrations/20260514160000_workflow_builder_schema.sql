-- Workflow Builder | Schema + Execution Engine (Prompt 1)
-- Multi-tenant visual automation engine. Every table is scoped to organization_id
-- and protected by RLS via public.get_org_id().

CREATE EXTENSION IF NOT EXISTS pg_net;
-- pg_cron is optional; cron.schedule calls at the bottom are commented out
-- until Chris confirms the extension is enabled on the target project.
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------------------------------------------------------------------------
-- 1. workflows
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  trigger_type    text NOT NULL
                    CHECK (trigger_type IN (
                      'disposition', 'stage_change', 'lead_created',
                      'time_based', 'manual', 'tag_added', 'tag_removed'
                    )),
  trigger_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflows_org_status_idx
  ON public.workflows (organization_id, status);

-- ---------------------------------------------------------------------------
-- 2. workflow_nodes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_nodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type            text NOT NULL
                    CHECK (type IN ('trigger', 'condition', 'action', 'wait')),
  action_type     text
                    CHECK (action_type IS NULL OR action_type IN (
                      'send_sms', 'send_email', 'update_stage',
                      'add_tag', 'remove_tag', 'assign_agent',
                      'create_task', 'assign_ai_agent', 'webhook'
                    )),
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  label           text,
  position_x      double precision NOT NULL DEFAULT 0,
  position_y      double precision NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_nodes_workflow_id_idx
  ON public.workflow_nodes (workflow_id);

-- ---------------------------------------------------------------------------
-- 3. workflow_edges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_edges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_node_id   uuid NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
  target_node_id   uuid NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
  condition_branch text
                    CHECK (condition_branch IS NULL OR condition_branch IN ('yes', 'no')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Enforce one outgoing edge per branch from a given source node.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workflow_edges_source_branch_key'
  ) THEN
    ALTER TABLE public.workflow_edges
      ADD CONSTRAINT workflow_edges_source_branch_key
      UNIQUE (workflow_id, source_node_id, condition_branch);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS workflow_edges_workflow_id_idx
  ON public.workflow_edges (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_edges_source_node_id_idx
  ON public.workflow_edges (source_node_id);

-- ---------------------------------------------------------------------------
-- 4. workflow_executions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_executions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id       uuid NOT NULL,
  contact_type     text NOT NULL DEFAULT 'lead'
                     CHECK (contact_type IN ('lead', 'client', 'recruit')),
  status           text NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running', 'completed', 'failed', 'paused')),
  current_node_id  uuid REFERENCES public.workflow_nodes(id) ON DELETE SET NULL,
  trigger_event    jsonb,
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_executions_workflow_status_idx
  ON public.workflow_executions (workflow_id, status);
CREATE INDEX IF NOT EXISTS workflow_executions_contact_id_idx
  ON public.workflow_executions (contact_id);

-- ---------------------------------------------------------------------------
-- 5. workflow_execution_steps
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_execution_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id    uuid NOT NULL REFERENCES public.workflow_executions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  node_id         uuid NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  input_data      jsonb,
  output_data     jsonb,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_execution_steps_execution_id_idx
  ON public.workflow_execution_steps (execution_id);

-- ---------------------------------------------------------------------------
-- 6. RLS — every table scoped by organization_id = public.get_org_id()
-- ---------------------------------------------------------------------------
ALTER TABLE public.workflows                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_nodes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_edges           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_executions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_execution_steps ENABLE ROW LEVEL SECURITY;

-- workflows ------------------------------------------------------------------
DROP POLICY IF EXISTS workflows_select_org ON public.workflows;
CREATE POLICY workflows_select_org ON public.workflows
  FOR SELECT TO authenticated
  USING (organization_id = public.get_org_id());

DROP POLICY IF EXISTS workflows_insert_org ON public.workflows;
CREATE POLICY workflows_insert_org ON public.workflows
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_org_id());

DROP POLICY IF EXISTS workflows_update_org ON public.workflows;
CREATE POLICY workflows_update_org ON public.workflows
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_org_id())
  WITH CHECK (organization_id = public.get_org_id());

DROP POLICY IF EXISTS workflows_delete_org ON public.workflows;
CREATE POLICY workflows_delete_org ON public.workflows
  FOR DELETE TO authenticated
  USING (organization_id = public.get_org_id());

-- workflow_nodes -------------------------------------------------------------
DROP POLICY IF EXISTS workflow_nodes_select_org ON public.workflow_nodes;
CREATE POLICY workflow_nodes_select_org ON public.workflow_nodes
  FOR SELECT TO authenticated
  USING (organization_id = public.get_org_id());

DROP POLICY IF EXISTS workflow_nodes_insert_org ON public.workflow_nodes;
CREATE POLICY workflow_nodes_insert_org ON public.workflow_nodes
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_org_id());

DROP POLICY IF EXISTS workflow_nodes_update_org ON public.workflow_nodes;
CREATE POLICY workflow_nodes_update_org ON public.workflow_nodes
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_org_id())
  WITH CHECK (organization_id = public.get_org_id());

DROP POLICY IF EXISTS workflow_nodes_delete_org ON public.workflow_nodes;
CREATE POLICY workflow_nodes_delete_org ON public.workflow_nodes
  FOR DELETE TO authenticated
  USING (organization_id = public.get_org_id());

-- workflow_edges -------------------------------------------------------------
DROP POLICY IF EXISTS workflow_edges_select_org ON public.workflow_edges;
CREATE POLICY workflow_edges_select_org ON public.workflow_edges
  FOR SELECT TO authenticated
  USING (organization_id = public.get_org_id());

DROP POLICY IF EXISTS workflow_edges_insert_org ON public.workflow_edges;
CREATE POLICY workflow_edges_insert_org ON public.workflow_edges
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_org_id());

DROP POLICY IF EXISTS workflow_edges_update_org ON public.workflow_edges;
CREATE POLICY workflow_edges_update_org ON public.workflow_edges
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_org_id())
  WITH CHECK (organization_id = public.get_org_id());

DROP POLICY IF EXISTS workflow_edges_delete_org ON public.workflow_edges;
CREATE POLICY workflow_edges_delete_org ON public.workflow_edges
  FOR DELETE TO authenticated
  USING (organization_id = public.get_org_id());

-- workflow_executions -- SELECT + INSERT only (immutable audit log) ----------
DROP POLICY IF EXISTS workflow_executions_select_org ON public.workflow_executions;
CREATE POLICY workflow_executions_select_org ON public.workflow_executions
  FOR SELECT TO authenticated
  USING (organization_id = public.get_org_id());

DROP POLICY IF EXISTS workflow_executions_insert_org ON public.workflow_executions;
CREATE POLICY workflow_executions_insert_org ON public.workflow_executions
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_org_id());

-- workflow_execution_steps -- SELECT + INSERT only ---------------------------
DROP POLICY IF EXISTS workflow_execution_steps_select_org ON public.workflow_execution_steps;
CREATE POLICY workflow_execution_steps_select_org ON public.workflow_execution_steps
  FOR SELECT TO authenticated
  USING (organization_id = public.get_org_id());

DROP POLICY IF EXISTS workflow_execution_steps_insert_org ON public.workflow_execution_steps;
CREATE POLICY workflow_execution_steps_insert_org ON public.workflow_execution_steps
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_org_id());

-- service_role bypasses RLS, so the Edge Functions can read/write everything.

-- ---------------------------------------------------------------------------
-- 7. Helper RPC: get_active_workflows_for_trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_active_workflows_for_trigger(
  p_org_id        uuid,
  p_trigger_type  text,
  p_trigger_key   text DEFAULT NULL
)
RETURNS SETOF public.workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT w.*
  FROM public.workflows w
  WHERE w.organization_id = p_org_id
    AND w.status = 'active'
    AND w.trigger_type = p_trigger_type
    AND (
      p_trigger_key IS NULL
      OR w.trigger_config ->> 'disposition_id' = p_trigger_key
      OR w.trigger_config ->> 'to_stage_id'    = p_trigger_key
      OR w.trigger_config ->> 'tag'            = p_trigger_key
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_workflows_for_trigger(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_active_workflows_for_trigger(uuid, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. dispositions.automation_id — repurpose comment
-- ---------------------------------------------------------------------------
-- Pre-Workflow-Builder this column referenced mock automation IDs. It now
-- references public.workflows.id. The column type stays text for backwards
-- compatibility with existing rows; new writes should store workflow UUIDs.
COMMENT ON COLUMN public.dispositions.automation_id IS
  'Optional workflows.id (UUID as text). Workflow-Builder replaces the prior mock automation system. Trigger evaluator uses workflows.trigger_config.disposition_id, not this column — kept for UI display & legacy.';

-- ---------------------------------------------------------------------------
-- 9. private.workflow_engine_config — populated via SQL Editor
-- ---------------------------------------------------------------------------
-- Same pattern as private.twilio_provisioning_config: the migration creates
-- the singleton row with empty values, and Chris fills in the real
-- supabase_url / service_role_key / workflow_internal_secret via SQL Editor.
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.workflow_engine_config (
  id                        int PRIMARY KEY CHECK (id = 1),
  supabase_url              text NOT NULL DEFAULT '',
  service_role_key          text NOT NULL DEFAULT '',
  workflow_internal_secret  text NOT NULL DEFAULT ''
);

INSERT INTO private.workflow_engine_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE private.workflow_engine_config OWNER TO postgres;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON TABLE private.workflow_engine_config FROM PUBLIC;
REVOKE ALL ON TABLE private.workflow_engine_config FROM anon, authenticated, service_role;

COMMENT ON TABLE private.workflow_engine_config IS
  'Singleton (id=1). Populate once via SQL Editor:
     UPDATE private.workflow_engine_config
        SET supabase_url             = ''https://<project>.supabase.co'',
            service_role_key         = ''<service_role_jwt>'',
            workflow_internal_secret = ''<shared_secret>''
      WHERE id = 1;
   Read by workflow_dispatch_event() to call workflow-trigger-evaluator via pg_net.
   The same workflow_internal_secret must be set as the WORKFLOW_INTERNAL_SECRET
   Supabase Function env var so the Edge Functions can validate the X-Workflow-Secret header.';

-- ---------------------------------------------------------------------------
-- 10. pg_cron schedules (commented out — uncomment after pg_cron is enabled
--     and after private.workflow_engine_config has real values)
-- ---------------------------------------------------------------------------
-- DO $$
-- DECLARE
--   v_url    text;
--   v_secret text;
-- BEGIN
--   SELECT supabase_url, workflow_internal_secret
--     INTO v_url, v_secret
--     FROM private.workflow_engine_config WHERE id = 1;
--
--   PERFORM cron.schedule(
--     'workflow-resume-paused',
--     '*/5 * * * *',
--     format($$
--       SELECT net.http_post(
--         url := %L,
--         headers := jsonb_build_object('Content-Type','application/json','X-Workflow-Secret',%L),
--         body := '{}'::jsonb,
--         timeout_milliseconds := 30000
--       );
--     $$, rtrim(v_url,'/') || '/functions/v1/workflow-resume-paused', v_secret)
--   );
--
--   PERFORM cron.schedule(
--     'workflow-time-based-trigger',
--     '*/15 * * * *',
--     format($$
--       SELECT net.http_post(
--         url := %L,
--         headers := jsonb_build_object('Content-Type','application/json','X-Workflow-Secret',%L),
--         body := '{}'::jsonb,
--         timeout_milliseconds := 60000
--       );
--     $$, rtrim(v_url,'/') || '/functions/v1/workflow-time-based-trigger', v_secret)
--   );
-- END $$;

NOTIFY pgrst, 'reload schema';
