-- Storage bucket for Agency Group shared resources.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agency-group-resources',
  'agency-group-resources',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4',
    'image/png',
    'image/jpeg',
    'text/plain'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies — gate writes by membership; reads via signed URLs (no public select).

DROP POLICY IF EXISTS agency_group_resources_storage_select ON storage.objects;
CREATE POLICY agency_group_resources_storage_select ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'agency-group-resources'
    AND (
      public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.agency_group_members
        WHERE agency_group_id = ((storage.foldername(name))[1])::uuid
          AND organization_id = public.get_org_id()
          AND status = 'active'
      )
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
      OR EXISTS (
        SELECT 1 FROM public.agency_group_members
        WHERE agency_group_id = ((storage.foldername(name))[1])::uuid
          AND organization_id = public.get_org_id()
          AND status = 'active'
      )
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
      OR EXISTS (
        SELECT 1 FROM public.agency_group_members
        WHERE agency_group_id = ((storage.foldername(name))[1])::uuid
          AND organization_id = public.get_org_id()
          AND status = 'active'
      )
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
      OR EXISTS (
        SELECT 1 FROM public.agency_group_members
        WHERE agency_group_id = ((storage.foldername(name))[1])::uuid
          AND organization_id = public.get_org_id()
          AND status = 'active'
      )
    )
  );
