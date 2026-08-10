-- =============================================================
-- Migration: Company Settings — Admin-only RLS + Org Scoping
-- Date: 2026-04-17
-- Purpose:
--   1. Ensure company_settings.organization_id exists (FK to organizations).
--   2. Ensure company_settings.website_url exists (new field).
--   3. Drop the SINGLETON_ID pattern — key by organization_id (UNIQUE).
--   4. Replace permissive RLS with:
--        SELECT  → any authenticated user in the org (org-scoped).
--        INSERT/UPDATE/DELETE → Super Admin OR Admin role in the org.
--   5. Reload PostgREST schema cache.
-- =============================================================

-- 1. Ensure required columns exist
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS website_url text;

-- 2. Enforce one settings row per organization
--    Drop any stale constraint with the same name first.
ALTER TABLE public.company_settings
  DROP CONSTRAINT IF EXISTS company_settings_org_unique;

ALTER TABLE public.company_settings
  ADD CONSTRAINT company_settings_org_unique UNIQUE (organization_id);

-- 3. Ensure RLS is enabled
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

-- 4. Drop legacy permissive policies
DROP POLICY IF EXISTS "Allow authenticated users to read company settings"   ON public.company_settings;
DROP POLICY IF EXISTS "Allow authenticated users to update company settings" ON public.company_settings;
DROP POLICY IF EXISTS "Allow authenticated users to insert company settings" ON public.company_settings;
DROP POLICY IF EXISTS "company_settings_select" ON public.company_settings;
DROP POLICY IF EXISTS "company_settings_write"  ON public.company_settings;

-- 5. SELECT — any authenticated user in the same org may read branding
CREATE POLICY "company_settings_select" ON public.company_settings
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
);

-- 6. INSERT/UPDATE/DELETE — only Super Admins or org Admins may write
CREATE POLICY "company_settings_write" ON public.company_settings
FOR ALL TO authenticated
USING (
  public.is_super_admin()
  OR (organization_id = public.get_org_id() AND public.get_user_role() = 'Admin')
)
WITH CHECK (
  public.is_super_admin()
  OR (organization_id = public.get_org_id() AND public.get_user_role() = 'Admin')
);

-- 7. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
