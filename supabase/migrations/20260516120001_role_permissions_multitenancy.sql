-- =============================================================
-- HOTFIX: role_permissions — create with multi-tenant foundation
-- Table was defined in migration 20260315184000 but never applied.
-- This creates it properly with organization_id scoping from the start.
-- =============================================================

-- 0. Ensure the shared updated_at trigger function exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Create the table with full multi-tenant schema
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES profiles(id),
  CONSTRAINT role_permissions_org_role_unique UNIQUE (organization_id, role)
);

-- 2. Enable RLS
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- 3. Create org-scoped RLS policies using public.get_org_id()
DROP POLICY IF EXISTS "rp_select_own_org" ON public.role_permissions;
CREATE POLICY "rp_select_own_org" ON public.role_permissions
  FOR SELECT
  USING (organization_id = public.get_org_id());

DROP POLICY IF EXISTS "rp_insert_admin_only" ON public.role_permissions;
CREATE POLICY "rp_insert_admin_only" ON public.role_permissions
  FOR INSERT
  WITH CHECK (
    organization_id = public.get_org_id()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'Admin'
        AND organization_id = public.get_org_id()
    )
  );

DROP POLICY IF EXISTS "rp_update_admin_only" ON public.role_permissions;
CREATE POLICY "rp_update_admin_only" ON public.role_permissions
  FOR UPDATE
  USING (
    organization_id = public.get_org_id()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'Admin'
        AND organization_id = public.get_org_id()
    )
  );

DROP POLICY IF EXISTS "rp_delete_admin_only" ON public.role_permissions;
CREATE POLICY "rp_delete_admin_only" ON public.role_permissions
  FOR DELETE
  USING (
    organization_id = public.get_org_id()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'Admin'
        AND organization_id = public.get_org_id()
    )
  );

-- 4. Trigger for updated_at
DROP TRIGGER IF EXISTS update_role_permissions_updated_at ON public.role_permissions;
CREATE TRIGGER update_role_permissions_updated_at
  BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Seed default rows for Chris's main org
INSERT INTO public.role_permissions (organization_id, role, permissions)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Agent', '{}'),
  ('a0000000-0000-0000-0000-000000000001', 'Team Leader', '{}')
ON CONFLICT (organization_id, role) DO NOTHING;

-- 6. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
