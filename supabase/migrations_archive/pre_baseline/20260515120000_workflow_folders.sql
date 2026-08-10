-- Workflow Folders | Organize workflows into colored folder tabs.
-- Adds public.workflow_folders + public.workflows.folder_id.
-- All multi-tenant via organization_id + RLS keyed on public.get_org_id().

-- ---------------------------------------------------------------------------
-- 1. workflow_folders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_folders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  color           text DEFAULT '#6366f1',
  sort_order      int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_folders_org_idx
  ON public.workflow_folders (organization_id, sort_order);

ALTER TABLE public.workflow_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_folders_select" ON public.workflow_folders;
CREATE POLICY "workflow_folders_select" ON public.workflow_folders
  FOR SELECT TO authenticated
  USING (organization_id = public.get_org_id());

DROP POLICY IF EXISTS "workflow_folders_insert" ON public.workflow_folders;
CREATE POLICY "workflow_folders_insert" ON public.workflow_folders
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_org_id());

DROP POLICY IF EXISTS "workflow_folders_update" ON public.workflow_folders;
CREATE POLICY "workflow_folders_update" ON public.workflow_folders
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_org_id())
  WITH CHECK (organization_id = public.get_org_id());

DROP POLICY IF EXISTS "workflow_folders_delete" ON public.workflow_folders;
CREATE POLICY "workflow_folders_delete" ON public.workflow_folders
  FOR DELETE TO authenticated
  USING (organization_id = public.get_org_id());

-- ---------------------------------------------------------------------------
-- 2. workflows.folder_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS folder_id uuid
  REFERENCES public.workflow_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workflows_folder_id_idx
  ON public.workflows (folder_id);

NOTIFY pgrst, 'reload schema';
