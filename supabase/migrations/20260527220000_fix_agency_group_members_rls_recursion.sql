-- Fix infinite recursion on agency_group_members SELECT (breaks all Storage uploads).
-- Replace self-referential EXISTS with SECURITY DEFINER helpers.
-- Harden agency-group-resources storage policies to use helpers.

-- ── Helpers ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_org_member_of_agency_group(
  p_agency_group_id uuid,
  p_statuses text[] DEFAULT ARRAY['active', 'invited']
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF p_agency_group_id IS NULL THEN
    RETURN false;
  END IF;

  v_org := public.get_org_id();
  IF v_org IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.agency_group_members m
    WHERE m.agency_group_id = p_agency_group_id
      AND m.organization_id = v_org
      AND m.status = ANY (p_statuses)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.storage_agency_group_resource_member_ok(p_object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  IF p_object_name IS NULL OR btrim(p_object_name) = '' THEN
    RETURN false;
  END IF;

  BEGIN
    v_group_id := split_part(p_object_name, '/', 1)::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN false;
  END;

  RETURN public.is_org_member_of_agency_group(v_group_id, ARRAY['active']::text[]);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_org_member_of_agency_group(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.storage_agency_group_resource_member_ok(text) TO authenticated;

-- ── agency_group_members: fix SELECT recursion ───────────────

DROP POLICY IF EXISTS agency_group_members_select ON public.agency_group_members;

CREATE POLICY agency_group_members_select ON public.agency_group_members
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_org_member_of_agency_group(
      agency_group_members.agency_group_id,
      ARRAY['active', 'invited']::text[]
    )
  );

-- ── agency_groups SELECT: same membership semantics, no inline EXISTS ──

DROP POLICY IF EXISTS agency_groups_select ON public.agency_groups;

CREATE POLICY agency_groups_select ON public.agency_groups
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_org_member_of_agency_group(
      agency_groups.id,
      ARRAY['active', 'invited']::text[]
    )
  );

-- ── agency_group_resources SELECT: active members only (unchanged semantics) ──

DROP POLICY IF EXISTS agency_group_resources_select ON public.agency_group_resources;

CREATE POLICY agency_group_resources_select ON public.agency_group_resources
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR uploaded_by_org_id = public.get_org_id()
    OR public.is_org_member_of_agency_group(
      agency_group_resources.agency_group_id,
      ARRAY['active']::text[]
    )
  );

-- ── storage.objects: agency-group-resources bucket ───────────

DROP POLICY IF EXISTS agency_group_resources_storage_select ON storage.objects;
CREATE POLICY agency_group_resources_storage_select ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'agency-group-resources'
    AND (
      public.is_super_admin()
      OR public.storage_agency_group_resource_member_ok(name)
    )
  );

DROP POLICY IF EXISTS agency_group_resources_storage_insert ON storage.objects;
CREATE POLICY agency_group_resources_storage_insert ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'agency-group-resources'
    AND (
      public.is_super_admin()
      OR public.storage_agency_group_resource_member_ok(name)
    )
  );

DROP POLICY IF EXISTS agency_group_resources_storage_update ON storage.objects;
CREATE POLICY agency_group_resources_storage_update ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'agency-group-resources'
    AND (
      public.is_super_admin()
      OR public.storage_agency_group_resource_member_ok(name)
    )
  );

DROP POLICY IF EXISTS agency_group_resources_storage_delete ON storage.objects;
CREATE POLICY agency_group_resources_storage_delete ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'agency-group-resources'
    AND (
      public.is_super_admin()
      OR public.storage_agency_group_resource_member_ok(name)
    )
  );

NOTIFY pgrst, 'reload schema';
