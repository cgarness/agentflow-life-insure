-- Company Branding hardening: move logo/favicon assets to Storage.
-- Creates a public bucket for branding assets, scopes writes to org Admins/Super Admins,
-- and clears any stale base64 (`data:`) values left in company_settings.

INSERT INTO storage.buckets (id, name, public)
VALUES ('company-branding', 'company-branding', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "company_branding_public_read" ON storage.objects;
DROP POLICY IF EXISTS "company_branding_org_write" ON storage.objects;
DROP POLICY IF EXISTS "company_branding_org_update" ON storage.objects;
DROP POLICY IF EXISTS "company_branding_org_delete" ON storage.objects;

CREATE POLICY "company_branding_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'company-branding');

CREATE POLICY "company_branding_org_write"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'company-branding'
  AND (
    public.is_super_admin()
    OR (
      public.get_user_role() = 'Admin'
      AND (storage.foldername(name))[1] = public.get_org_id()::text
    )
  )
);

CREATE POLICY "company_branding_org_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'company-branding'
  AND (
    public.is_super_admin()
    OR (
      public.get_user_role() = 'Admin'
      AND (storage.foldername(name))[1] = public.get_org_id()::text
    )
  )
);

CREATE POLICY "company_branding_org_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-branding'
  AND (
    public.is_super_admin()
    OR (
      public.get_user_role() = 'Admin'
      AND (storage.foldername(name))[1] = public.get_org_id()::text
    )
  )
);

UPDATE public.company_settings
SET logo_url = NULL, logo_name = NULL
WHERE logo_url LIKE 'data:%';

UPDATE public.company_settings
SET favicon_url = NULL, favicon_name = NULL
WHERE favicon_url LIKE 'data:%';
