-- Automations V2 tasks. A task can carry a time of day and can record the automation run that
-- created it. Every existing task keeps today's all-day behaviour. No row-security policy changes.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.tasks
  ADD COLUMN all_day boolean NOT NULL DEFAULT true,
  ADD COLUMN automation_run_id uuid,
  ALTER COLUMN created_by DROP NOT NULL,
  -- A person created the task, or an automation run did. Never neither.
  ADD CONSTRAINT tasks_creator_or_automation CHECK (created_by IS NOT NULL OR automation_run_id IS NOT NULL);
COMMENT ON COLUMN public.tasks.all_day IS
  'true: due on a calendar day (every task a person adds). false: due at the exact time in due_date.';
COMMENT ON COLUMN public.tasks.automation_run_id IS
  'The automation run that created this task. Set only by the automation worker.';

-- Signed-in sessions keep writing ordinary tasks. Only server-owned code records that an
-- automation created a task, and nobody can relabel a task afterwards.
CREATE FUNCTION private.guard_task_automation_provenance()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.automation_run_id IS NOT NULL OR NEW.created_by IS NULL THEN
      RAISE EXCEPTION 'Only an automation can mark a task as automated' USING ERRCODE='42501';
    END IF;
  ELSIF NEW.automation_run_id IS DISTINCT FROM OLD.automation_run_id
    OR (OLD.automation_run_id IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'A task''s automation record cannot be changed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tasks_automation_provenance BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION private.guard_task_automation_provenance();

-- One record per run and step, so a retried or replayed step never creates a second task or callback.
CREATE TABLE private.automation_task_receipts (
  organization_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES private.automation_runs(id),
  node_id text NOT NULL,
  workflow_id uuid NOT NULL,
  scope_key text,
  kind text NOT NULL CHECK (kind IN ('task','callback')),
  -- The task or callback created. No foreign key: the record outlives a task a person later deletes.
  record_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (run_id,node_id)
);
CREATE INDEX automation_task_receipts_scope ON private.automation_task_receipts(organization_id,scope_key);
ALTER TABLE private.automation_task_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.automation_task_receipts FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.guard_task_automation_provenance() FROM PUBLIC,anon,authenticated;
COMMIT;
