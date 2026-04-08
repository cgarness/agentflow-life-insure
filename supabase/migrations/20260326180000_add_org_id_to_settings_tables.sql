-- Migration: Add organization_id to settings tables and update RLS for multi-tenancy
-- Affected tables: custom_fields, lead_sources, health_statuses, pipeline_stages

-- 1. Add organization_id column to tables if missing
ALTER TABLE public.custom_fields ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.lead_sources ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.health_statuses ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 2. Update existing records (if any) to a default organization if one exists
-- Since we don't have a reliable way to know which org to assign in this script, 
-- we leave them as NULL, which is allowed by the schema. 
-- New records created via the application will have organization_id populated.

-- 3. Drop existing insecure RLS policies
DROP POLICY IF EXISTS "Allow read access to all authenticated users for custom_fields" ON public.custom_fields;
DROP POLICY IF EXISTS "Allow all access to admins for custom_fields" ON public.custom_fields;
DROP POLICY IF EXISTS "Admins can manage custom fields" ON public.custom_fields;

DROP POLICY IF EXISTS "Allow read access to all authenticated users for lead_sources" ON public.lead_sources;
DROP POLICY IF EXISTS "Allow all access to admins for lead_sources" ON public.lead_sources;
DROP POLICY IF EXISTS "Admins can manage lead sources" ON public.lead_sources;

DROP POLICY IF EXISTS "Allow read access to all authenticated users for health_statuses" ON public.health_statuses;
DROP POLICY IF EXISTS "Allow all access to admins for health_statuses" ON public.health_statuses;
DROP POLICY IF EXISTS "Admins can manage health statuses" ON public.health_statuses;

DROP POLICY IF EXISTS "Allow read access to all authenticated users for pipeline_stages" ON public.pipeline_stages;
DROP POLICY IF EXISTS "Allow all access to admins for pipeline_stages" ON public.pipeline_stages;
DROP POLICY IF EXISTS "Admins can manage pipeline stages" ON public.pipeline_stages;

-- 4. Create new multi-tenant RLS policies

-- CUSTOM FIELDS
CREATE POLICY "Users can view their organization's custom fields"
ON public.custom_fields FOR SELECT
TO authenticated
USING (
    organization_id IS NULL OR 
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Admins can manage their organization's custom fields"
ON public.custom_fields FOR ALL
TO authenticated
USING (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin')
)
WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin')
);

-- LEAD SOURCES
CREATE POLICY "Users can view their organization's lead sources"
ON public.lead_sources FOR SELECT
TO authenticated
USING (
    organization_id IS NULL OR 
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Admins can manage their organization's lead sources"
ON public.lead_sources FOR ALL
TO authenticated
USING (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin')
)
WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin')
);

-- HEALTH STATUSES
CREATE POLICY "Users can view their organization's health statuses"
ON public.health_statuses FOR SELECT
TO authenticated
USING (
    organization_id IS NULL OR 
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Admins can manage their organization's health statuses"
ON public.health_statuses FOR ALL
TO authenticated
USING (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin')
)
WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin')
);

-- PIPELINE STAGES
CREATE POLICY "Users can view their organization's pipeline stages"
ON public.pipeline_stages FOR SELECT
TO authenticated
USING (
    organization_id IS NULL OR 
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Admins can manage their organization's pipeline stages"
ON public.pipeline_stages FOR ALL
TO authenticated
USING (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin')
)
WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin')
);
