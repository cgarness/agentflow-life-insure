-- Agency Groups: RLS policies for agency_groups, agency_group_members, agency_group_resources.

-- ============================================================
-- agency_groups
-- ============================================================
DROP POLICY IF EXISTS agency_groups_select ON public.agency_groups;
CREATE POLICY agency_groups_select ON public.agency_groups
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.agency_group_members m
      WHERE m.agency_group_id = agency_groups.id
        AND m.organization_id = public.get_org_id()
        AND m.status IN ('active', 'invited')
    )
  );

DROP POLICY IF EXISTS agency_groups_insert ON public.agency_groups;
CREATE POLICY agency_groups_insert ON public.agency_groups
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      master_organization_id = public.get_org_id()
      AND public.get_user_role() IN ('Admin')
    )
  );

DROP POLICY IF EXISTS agency_groups_update ON public.agency_groups;
CREATE POLICY agency_groups_update ON public.agency_groups
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      master_organization_id = public.get_org_id()
      AND public.get_user_role() IN ('Admin')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      master_organization_id = public.get_org_id()
      AND public.get_user_role() IN ('Admin')
    )
  );

DROP POLICY IF EXISTS agency_groups_delete ON public.agency_groups;
CREATE POLICY agency_groups_delete ON public.agency_groups
  FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      master_organization_id = public.get_org_id()
      AND public.get_user_role() IN ('Admin')
    )
  );

-- ============================================================
-- agency_group_members
-- ============================================================
DROP POLICY IF EXISTS agency_group_members_select ON public.agency_group_members;
CREATE POLICY agency_group_members_select ON public.agency_group_members
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.agency_group_members m2
      WHERE m2.agency_group_id = agency_group_members.agency_group_id
        AND m2.organization_id = public.get_org_id()
        AND m2.status IN ('active', 'invited')
    )
  );

DROP POLICY IF EXISTS agency_group_members_insert ON public.agency_group_members;
CREATE POLICY agency_group_members_insert ON public.agency_group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      EXISTS (
        SELECT 1 FROM public.agency_groups g
        WHERE g.id = agency_group_members.agency_group_id
          AND g.master_organization_id = public.get_org_id()
      )
      AND public.get_user_role() IN ('Admin')
    )
  );

DROP POLICY IF EXISTS agency_group_members_update ON public.agency_group_members;
CREATE POLICY agency_group_members_update ON public.agency_group_members
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      EXISTS (
        SELECT 1 FROM public.agency_groups g
        WHERE g.id = agency_group_members.agency_group_id
          AND g.master_organization_id = public.get_org_id()
      )
      AND public.get_user_role() IN ('Admin')
    )
    OR (
      agency_group_members.organization_id = public.get_org_id()
      AND public.get_user_role() IN ('Admin')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      EXISTS (
        SELECT 1 FROM public.agency_groups g
        WHERE g.id = agency_group_members.agency_group_id
          AND g.master_organization_id = public.get_org_id()
      )
      AND public.get_user_role() IN ('Admin')
    )
    OR (
      agency_group_members.organization_id = public.get_org_id()
      AND public.get_user_role() IN ('Admin')
    )
  );

DROP POLICY IF EXISTS agency_group_members_delete ON public.agency_group_members;
CREATE POLICY agency_group_members_delete ON public.agency_group_members
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- ============================================================
-- agency_group_resources
-- ============================================================
DROP POLICY IF EXISTS agency_group_resources_select ON public.agency_group_resources;
CREATE POLICY agency_group_resources_select ON public.agency_group_resources
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR uploaded_by_org_id = public.get_org_id()
    OR EXISTS (
      SELECT 1 FROM public.agency_group_members m
      WHERE m.agency_group_id = agency_group_resources.agency_group_id
        AND m.organization_id = public.get_org_id()
        AND m.status = 'active'
    )
  );

DROP POLICY IF EXISTS agency_group_resources_insert ON public.agency_group_resources;
CREATE POLICY agency_group_resources_insert ON public.agency_group_resources
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.get_user_role() IN ('Admin')
      AND uploaded_by_org_id = public.get_org_id()
      AND EXISTS (
        SELECT 1 FROM public.agency_group_members m
        WHERE m.agency_group_id = agency_group_resources.agency_group_id
          AND m.organization_id = public.get_org_id()
          AND m.status = 'active'
      )
    )
  );

DROP POLICY IF EXISTS agency_group_resources_update ON public.agency_group_resources;
CREATE POLICY agency_group_resources_update ON public.agency_group_resources
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      uploaded_by_org_id = public.get_org_id()
      AND public.get_user_role() IN ('Admin')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      uploaded_by_org_id = public.get_org_id()
      AND public.get_user_role() IN ('Admin')
    )
  );

DROP POLICY IF EXISTS agency_group_resources_delete ON public.agency_group_resources;
CREATE POLICY agency_group_resources_delete ON public.agency_group_resources
  FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      uploaded_by_org_id = public.get_org_id()
      AND public.get_user_role() IN ('Admin')
    )
  );

NOTIFY pgrst, 'reload schema';
