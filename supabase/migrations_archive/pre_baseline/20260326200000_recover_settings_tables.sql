-- MASTER RECOVERY MIGRATION: Ensure all settings tables exist with organization scoping

-- 1. custom_fields
CREATE TABLE IF NOT EXISTS public.custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Text', 'Number', 'Date', 'Dropdown')),
  applies_to JSONB NOT NULL DEFAULT '[]'::jsonb,
  required BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  default_value TEXT,
  dropdown_options JSONB DEFAULT '[]'::jsonb,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. lead_sources
CREATE TABLE IF NOT EXISTS public.lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  active BOOLEAN DEFAULT true,
  usage_count INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. health_statuses
CREATE TABLE IF NOT EXISTS public.health_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. Ensure organization_id on pipeline_stages (just in case)
ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Enable RLS for all
ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_statuses ENABLE ROW LEVEL SECURITY;

-- NEW RLS Policies (Multi-tenant)
-- We use DO blocks to avoid errors if policies already exist

DO $$ 
BEGIN
    -- custom_fields
    DROP POLICY IF EXISTS "Users can view their organization's custom fields" ON public.custom_fields;
    CREATE POLICY "Users can view their organization's custom fields" ON public.custom_fields
      FOR SELECT TO authenticated USING (organization_id IS NULL OR organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

    DROP POLICY IF EXISTS "Admins can manage their organization's custom fields" ON public.custom_fields;
    CREATE POLICY "Admins can manage their organization's custom fields" ON public.custom_fields
      FOR ALL TO authenticated USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin'));

    -- lead_sources
    DROP POLICY IF EXISTS "Users can view their organization's lead sources" ON public.lead_sources;
    CREATE POLICY "Users can view their organization's lead sources" ON public.lead_sources
      FOR SELECT TO authenticated USING (organization_id IS NULL OR organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

    DROP POLICY IF EXISTS "Admins can manage their organization's lead sources" ON public.lead_sources;
    CREATE POLICY "Admins can manage their organization's lead sources" ON public.lead_sources
      FOR ALL TO authenticated USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin'));

    -- health_statuses
    DROP POLICY IF EXISTS "Users can view their organization's health statuses" ON public.health_statuses;
    CREATE POLICY "Users can view their organization's health statuses" ON public.health_statuses
      FOR SELECT TO authenticated USING (organization_id IS NULL OR organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

    DROP POLICY IF EXISTS "Admins can manage their organization's health statuses" ON public.health_statuses;
    CREATE POLICY "Admins can manage their organization's health statuses" ON public.health_statuses
      FOR ALL TO authenticated USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin'));
END $$;

-- Refresh Schema Cache
NOTIFY pgrst, 'reload schema';
