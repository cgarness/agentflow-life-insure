-- Create contact_management_settings table
CREATE TABLE IF NOT EXISTS public.contact_management_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Duplicate Detection
    duplicate_detection_rule TEXT NOT NULL DEFAULT 'phone_or_email' 
        CHECK (duplicate_detection_rule IN ('phone_only', 'email_only', 'phone_or_email', 'phone_and_email')),
    duplicate_detection_scope TEXT NOT NULL DEFAULT 'all_agents'
        CHECK (duplicate_detection_scope IN ('all_agents', 'assigned_only')),
    manual_action TEXT NOT NULL DEFAULT 'warn'
        CHECK (manual_action IN ('warn', 'block', 'allow')),
    csv_action TEXT NOT NULL DEFAULT 'flag'
        CHECK (csv_action IN ('flag', 'skip', 'overwrite')),
    
    -- Required Fields
    required_fields_lead JSONB NOT NULL DEFAULT '{}'::jsonb,
    required_fields_client JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- Assignment Rules
    assignment_method TEXT NOT NULL DEFAULT 'unassigned'
        CHECK (assignment_method IN ('unassigned', 'specific', 'round_robin', 'weighted_distribution')),
    assignment_specific_agent_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    assignment_rotation JSONB NOT NULL DEFAULT '[]'::jsonb,
    import_override BOOLEAN NOT NULL DEFAULT false,
    import_method TEXT NOT NULL DEFAULT 'unassigned',
    import_specific_agent_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    import_rotation JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure one record per organization
    CONSTRAINT unique_org_settings UNIQUE (organization_id)
);

-- Enable RLS
ALTER TABLE public.contact_management_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their organization's settings"
ON public.contact_management_settings FOR SELECT
USING (organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
));

CREATE POLICY "Admins can update their organization's settings"
ON public.contact_management_settings FOR UPDATE
USING (organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin'
))
WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin'
));

CREATE POLICY "Admins can insert their organization's settings"
ON public.contact_management_settings FOR INSERT
WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid() AND role = 'Admin'
));

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_contact_management_settings_updated_at
    BEFORE UPDATE ON public.contact_management_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
