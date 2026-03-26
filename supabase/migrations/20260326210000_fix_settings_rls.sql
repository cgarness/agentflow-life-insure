-- MASTER RLS FIX: Make settings RLS more robust and inclusive

DO $$ 
BEGIN
    -- 1. custom_fields
    DROP POLICY IF EXISTS "Users can view their organization's custom fields" ON public.custom_fields;
    CREATE POLICY "Users can view their organization's custom fields" ON public.custom_fields
      FOR SELECT TO authenticated 
      USING (
        organization_id IS NULL 
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() 
          AND (profiles.organization_id = custom_fields.organization_id OR profiles.is_super_admin = true)
        )
      );

    DROP POLICY IF EXISTS "Admins can manage their organization's custom fields" ON public.custom_fields;
    CREATE POLICY "Admins can manage their organization's custom fields" ON public.custom_fields
      FOR ALL TO authenticated 
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() 
          AND (LOWER(role) IN ('admin', 'super admin', 'superadmin') OR is_super_admin = true)
          AND (organization_id = custom_fields.organization_id OR is_super_admin = true)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() 
          AND (LOWER(role) IN ('admin', 'super admin', 'superadmin') OR is_super_admin = true)
          AND (organization_id = custom_fields.organization_id OR is_super_admin = true)
        )
      );

    -- 2. lead_sources
    DROP POLICY IF EXISTS "Users can view their organization's lead sources" ON public.lead_sources;
    CREATE POLICY "Users can view their organization's lead sources" ON public.lead_sources
      FOR SELECT TO authenticated 
      USING (
        organization_id IS NULL 
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() 
          AND (profiles.organization_id = lead_sources.organization_id OR profiles.is_super_admin = true)
        )
      );

    DROP POLICY IF EXISTS "Admins can manage their organization's lead sources" ON public.lead_sources;
    CREATE POLICY "Admins can manage their organization's lead sources" ON public.lead_sources
      FOR ALL TO authenticated 
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() 
          AND (LOWER(role) IN ('admin', 'super admin', 'superadmin') OR is_super_admin = true)
          AND (organization_id = lead_sources.organization_id OR is_super_admin = true)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() 
          AND (LOWER(role) IN ('admin', 'super admin', 'superadmin') OR is_super_admin = true)
          AND (organization_id = lead_sources.organization_id OR is_super_admin = true)
        )
      );

    -- 3. health_statuses
    DROP POLICY IF EXISTS "Users can view their organization's health statuses" ON public.health_statuses;
    CREATE POLICY "Users can view their organization's health statuses" ON public.health_statuses
      FOR SELECT TO authenticated 
      USING (
        organization_id IS NULL 
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() 
          AND (profiles.organization_id = health_statuses.organization_id OR profiles.is_super_admin = true)
        )
      );

    DROP POLICY IF EXISTS "Admins can manage their organization's health statuses" ON public.health_statuses;
    CREATE POLICY "Admins can manage their organization's health statuses" ON public.health_statuses
      FOR ALL TO authenticated 
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() 
          AND (LOWER(role) IN ('admin', 'super admin', 'superadmin') OR is_super_admin = true)
          AND (organization_id = health_statuses.organization_id OR is_super_admin = true)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() 
          AND (LOWER(role) IN ('admin', 'super admin', 'superadmin') OR is_super_admin = true)
          AND (organization_id = health_statuses.organization_id OR is_super_admin = true)
        )
      );

END $$;

-- Refresh Schema Cache
NOTIFY pgrst, 'reload schema';
