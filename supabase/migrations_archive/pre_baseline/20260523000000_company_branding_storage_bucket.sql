-- =============================================================
-- Migration: Company Branding Storage Bucket
-- Date: 2026-05-23
-- Phase: B1 — bucket + policies for new logo uploads
-- Purpose:
--   1. Create public-read 'company-branding' Storage bucket.
--   2. Restrict INSERT/UPDATE/DELETE to Admin or is_super_admin
--      within the caller's own organization folder prefix.
--   3. Folder structure: company-branding/{organization_id}/logo/{file}
--   4. Public bucket → no SELECT policy (Supabase serves public objects without RLS).
--   5. SVG blocked at bucket level via allowed_mime_types.
-- =============================================================

-- 1. Create bucket (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-branding',
  'company-branding',
  true,
  5242880,  -- 5 MB
  ARRAY['image/png', 'image/jpeg']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Write policies — Admin / Super Admin only, org-folder scoped.
--    Uses canonical JWT helpers: is_super_admin(), get_user_role(), get_org_id().
--    Super Admin check uses is_super_admin() (the platform source of truth),
--    NOT role = 'Super Admin' alone.

-- Drop legacy policies from prior session (weaker org-scoping)
DROP POLICY IF EXISTS "company_branding_public_read" ON storage.objects;
DROP POLICY IF EXISTS "company_branding_org_write" ON storage.objects;
DROP POLICY IF EXISTS "company_branding_org_update" ON storage.objects;
DROP POLICY IF EXISTS "company_branding_org_delete" ON storage.objects;

-- INSERT
DROP POLICY IF EXISTS "company_branding_insert" ON storage.objects;
CREATE POLICY "company_branding_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'company-branding'
  AND split_part(name, '/', 1) = public.get_org_id()::text
  AND (
    public.get_user_role() = 'Admin'
    OR public.is_super_admin()
  )
);

-- UPDATE
DROP POLICY IF EXISTS "company_branding_update" ON storage.objects;
CREATE POLICY "company_branding_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'company-branding'
  AND split_part(name, '/', 1) = public.get_org_id()::text
  AND (
    public.get_user_role() = 'Admin'
    OR public.is_super_admin()
  )
);

-- DELETE
DROP POLICY IF EXISTS "company_branding_delete" ON storage.objects;
CREATE POLICY "company_branding_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'company-branding'
  AND split_part(name, '/', 1) = public.get_org_id()::text
  AND (
    public.get_user_role() = 'Admin'
    OR public.is_super_admin()
  )
);

-- 3. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
