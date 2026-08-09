-- Custom fields: per-creator visibility within org, fix cross-tenant leak from NULL organization_id,
-- and allow agents to create their own definitions (not only admins).

-- 1. Column: who owns this definition (NULL = legacy org-wide template visible to whole org)
ALTER TABLE public.custom_fields
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS custom_fields_org_created_by_idx
  ON public.custom_fields(organization_id, created_by);

COMMENT ON COLUMN public.custom_fields.created_by IS
  'Profile id of the user who defined this field. NULL = org-wide (legacy) template visible to all org members. Admins/Team Leaders see all rows in their org.';

-- 2. Replace RLS policies
DROP POLICY IF EXISTS "Users can view their organization's custom fields" ON public.custom_fields;
DROP POLICY IF EXISTS "Admins can manage their organization's custom fields" ON public.custom_fields;

-- SELECT: super admin sees all; otherwise must belong to org and satisfy role/ownership rules.
-- Rows with NULL organization_id are never visible to non–super-admins (fixes cross-org leak).
CREATE POLICY "custom_fields_select" ON public.custom_fields
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      custom_fields.organization_id IS NOT NULL
      AND custom_fields.organization_id = public.get_org_id()
      AND (
        public.get_user_role() IN ('Admin', 'Team Leader', 'Team Lead')
        OR custom_fields.created_by IS NULL
        OR custom_fields.created_by = auth.uid()
      )
    )
  );

-- INSERT: org members insert into their org; created_by must be self OR (admin/TL + org-wide NULL)
CREATE POLICY "custom_fields_insert" ON public.custom_fields
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.get_org_id()
      AND (
        (created_by = auth.uid())
        OR (
          created_by IS NULL
          AND public.get_user_role() IN ('Admin', 'Team Leader', 'Team Lead')
        )
      )
    )
  );

-- UPDATE: super admin; or admin/TL on any row in org; or owner on own row (not legacy NULL unless admin/TL)
CREATE POLICY "custom_fields_update" ON public.custom_fields
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      custom_fields.organization_id IS NOT NULL
      AND custom_fields.organization_id = public.get_org_id()
      AND (
        public.get_user_role() IN ('Admin', 'Team Leader', 'Team Lead')
        OR custom_fields.created_by = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.get_org_id()
      AND (
        public.get_user_role() IN ('Admin', 'Team Leader', 'Team Lead')
        OR created_by = auth.uid()
      )
    )
  );

-- DELETE: same as UPDATE USING
CREATE POLICY "custom_fields_delete" ON public.custom_fields
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      custom_fields.organization_id IS NOT NULL
      AND custom_fields.organization_id = public.get_org_id()
      AND (
        public.get_user_role() IN ('Admin', 'Team Leader', 'Team Lead')
        OR custom_fields.created_by = auth.uid()
      )
    )
  );

NOTIFY pgrst, 'reload schema';
