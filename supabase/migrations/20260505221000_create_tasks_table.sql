-- Migration: Create tasks table and RLS policies
-- Date: 2026-05-05

CREATE TABLE IF NOT EXISTS public.tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id uuid NOT NULL,
    contact_type text NOT NULL CHECK (contact_type IN ('lead', 'client', 'recruit')),
    assigned_to uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title text NOT NULL,
    task_type text NOT NULL CHECK (task_type IN ('Send Quote', 'Follow Up', 'Check Application', 'Policy Review', 'General')),
    due_date timestamptz NOT NULL,
    completed_at timestamptz,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS tasks_organization_id_idx ON public.tasks(organization_id);
CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx ON public.tasks(assigned_to);
CREATE INDEX IF NOT EXISTS tasks_due_date_idx ON public.tasks(due_date);
CREATE INDEX IF NOT EXISTS tasks_contact_id_idx ON public.tasks(contact_id);

-- Enable RLS
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- 1. Insert Policy (All roles, scoped to organization_id)
CREATE POLICY "tasks_insert_org"
ON public.tasks FOR INSERT
WITH CHECK (
    organization_id = public.get_org_id()
);

-- 2. Select Policy - Admins
CREATE POLICY "tasks_select_admin"
ON public.tasks FOR SELECT
USING (
    organization_id = public.get_org_id()
    AND public.get_user_role() = 'Admin'
);

-- 3. Select Policy - Team Leaders
CREATE POLICY "tasks_select_team_leader"
ON public.tasks FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.profiles viewer
        WHERE viewer.id = auth.uid()
        AND viewer.organization_id = tasks.organization_id
        AND viewer.role = 'Team Leader'
        AND EXISTS (
            SELECT 1 FROM public.profiles subject
            WHERE subject.id = tasks.assigned_to
            AND subject.upline_path <@ viewer.upline_path
        )
    )
);

-- 4. Select Policy - Agents (Own or Created By)
CREATE POLICY "tasks_select_agent"
ON public.tasks FOR SELECT
USING (
    organization_id = public.get_org_id()
    AND (assigned_to = auth.uid() OR created_by = auth.uid())
);

-- 5. Update Policy - Agents (Own or Created By)
CREATE POLICY "tasks_update_own"
ON public.tasks FOR UPDATE
USING (
    organization_id = public.get_org_id()
    AND (assigned_to = auth.uid() OR created_by = auth.uid())
)
WITH CHECK (
    organization_id = public.get_org_id()
);

-- 6. Delete Policy - Agents (Own or Created By)
CREATE POLICY "tasks_delete_own"
ON public.tasks FOR DELETE
USING (
    organization_id = public.get_org_id()
    AND (assigned_to = auth.uid() OR created_by = auth.uid())
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
