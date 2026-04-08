
-- Update profiles table with missing fields
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS resident_state TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS licensed_states JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS commission_level TEXT DEFAULT '0%';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS upline_id UUID REFERENCES public.profiles(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS monthly_call_goal INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS monthly_sales_goal INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS weekly_appointment_goal INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS monthly_talk_time_goal_hours INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_items JSONB DEFAULT '[]'::jsonb;

-- Create pipeline_stages table
CREATE TABLE IF NOT EXISTS public.pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  is_positive BOOLEAN DEFAULT false,
  is_default BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  pipeline_type TEXT NOT NULL CHECK (pipeline_type IN ('lead', 'recruit')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to all authenticated users for pipeline_stages"
  ON public.pipeline_stages FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow all access to admins for pipeline_stages"
  ON public.pipeline_stages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'Admin'));

-- Create custom_fields table
CREATE TABLE IF NOT EXISTS public.custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Text', 'Number', 'Date', 'Dropdown')),
  applies_to JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of strings: 'Leads', 'Clients', 'Recruits'
  required BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  default_value TEXT,
  dropdown_options JSONB DEFAULT '[]'::jsonb,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to all authenticated users for custom_fields"
  ON public.custom_fields FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow all access to admins for custom_fields"
  ON public.custom_fields FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'Admin'));

-- Create lead_sources table
CREATE TABLE IF NOT EXISTS public.lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  active BOOLEAN DEFAULT true,
  usage_count INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to all authenticated users for lead_sources"
  ON public.lead_sources FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow all access to admins for lead_sources"
  ON public.lead_sources FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'Admin'));

-- Create health_statuses table
CREATE TABLE IF NOT EXISTS public.health_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.health_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to all authenticated users for health_statuses"
  ON public.health_statuses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow all access to admins for health_statuses"
  ON public.health_statuses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'Admin'));

-- Seed Pipeline Stages (Lead)
INSERT INTO public.pipeline_stages (name, color, is_positive, is_default, sort_order, pipeline_type)
VALUES 
  ('New', '#3B82F6', false, true, 1, 'lead'),
  ('Contacted', '#A855F7', false, true, 2, 'lead'),
  ('Interested', '#EAB308', false, true, 3, 'lead'),
  ('Hot', '#F97316', false, true, 4, 'lead'),
  ('Follow Up', '#14B8A6', false, true, 5, 'lead'),
  ('Closed Won', '#22C55E', true, true, 6, 'lead'),
  ('Closed Lost', '#EF4444', false, true, 7, 'lead')
ON CONFLICT DO NOTHING;

-- Seed Pipeline Stages (Recruit)
INSERT INTO public.pipeline_stages (name, color, is_positive, is_default, sort_order, pipeline_type)
VALUES 
  ('Interested in Joining', '#3B82F6', false, true, 1, 'recruit'),
  ('Contacted', '#A855F7', false, true, 2, 'recruit'),
  ('In Interview Process', '#EAB308', false, true, 3, 'recruit'),
  ('Pending Licensing', '#F97316', false, true, 4, 'recruit'),
  ('Licensed & Onboarding', '#22C55E', true, true, 5, 'recruit'),
  ('Not Interested', '#EF4444', false, true, 6, 'recruit')
ON CONFLICT DO NOTHING;

-- Seed Lead Sources
INSERT INTO public.lead_sources (name, color, active, usage_count, sort_order)
VALUES 
  ('Facebook Ad', '#3B82F6', true, 47, 1),
  ('Google Ad', '#22C55E', true, 31, 2),
  ('Direct Mail', '#F97316', true, 89, 3),
  ('Referral', '#EAB308', true, 23, 4),
  ('Aged Lead', '#6B7280', true, 156, 5),
  ('Cold Call', '#A855F7', true, 12, 6),
  ('Website', '#14B8A6', true, 8, 7),
  ('Live Transfer', '#EF4444', true, 34, 8),
  ('TV Ad', '#EC4899', true, 5, 9),
  ('Radio Ad', '#F97316', true, 3, 10),
  ('Door Knock', '#22C55E', true, 7, 11),
  ('Networking Event', '#3B82F6', true, 2, 12)
ON CONFLICT DO NOTHING;

-- Seed Health Statuses
INSERT INTO public.health_statuses (name, color, description, is_default, sort_order)
VALUES 
  ('Preferred Plus', '#22C55E', 'Excellent health, no major conditions', true, 1),
  ('Preferred', '#3B82F6', 'Very good health, minor conditions only', true, 2),
  ('Standard Plus', '#EAB308', 'Good health, some controlled conditions', true, 3),
  ('Standard', '#F97316', 'Average health, manageable conditions', true, 4),
  ('Substandard', '#EF4444', 'Below average health, significant conditions', true, 5),
  ('Tobacco User', '#6B7280', 'Current or recent tobacco use', true, 6)
ON CONFLICT DO NOTHING;

-- Create update_updated_at function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers
DROP TRIGGER IF EXISTS pipeline_stages_updated_at ON public.pipeline_stages;
CREATE TRIGGER pipeline_stages_updated_at BEFORE UPDATE ON public.pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS custom_fields_updated_at ON public.custom_fields;
CREATE TRIGGER custom_fields_updated_at BEFORE UPDATE ON public.custom_fields FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS lead_sources_updated_at ON public.lead_sources;
CREATE TRIGGER lead_sources_updated_at BEFORE UPDATE ON public.lead_sources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS health_statuses_updated_at ON public.health_statuses;
CREATE TRIGGER health_statuses_updated_at BEFORE UPDATE ON public.health_statuses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
