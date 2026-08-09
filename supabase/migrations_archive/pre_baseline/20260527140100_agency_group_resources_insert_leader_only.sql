-- Tighten agency_group_resources INSERT to leader/master agency only.
-- Why: Pass 1 product decision is that shared resources are uploaded by the
-- leader (master agency) Admin or Super Admin only. The previous INSERT
-- policy allowed any active member-org Admin to upload, which exceeds the
-- launch scope. SELECT / UPDATE / DELETE policies are unchanged so member
-- agencies preserve view/download access and existing own-org delete RLS.

DROP POLICY IF EXISTS agency_group_resources_insert ON public.agency_group_resources;

CREATE POLICY agency_group_resources_insert ON public.agency_group_resources
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.get_user_role() = 'Admin'
      AND uploaded_by_org_id = public.get_org_id()
      AND EXISTS (
        SELECT 1 FROM public.agency_groups g
        WHERE g.id = agency_group_resources.agency_group_id
          AND g.master_organization_id = public.get_org_id()
      )
    )
  );

NOTIFY pgrst, 'reload schema';
