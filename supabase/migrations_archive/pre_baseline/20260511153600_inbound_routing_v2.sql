ALTER TABLE public.inbound_routing_settings
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS voicemail_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS fallback_action TEXT DEFAULT 'voicemail' CHECK (fallback_action IN ('voicemail', 'forward', 'hangup')),
ADD COLUMN IF NOT EXISTS voicemail_greeting_text TEXT,
ADD COLUMN IF NOT EXISTS voicemail_greeting_url TEXT,
ADD COLUMN IF NOT EXISTS forwarding_number TEXT;

-- Update RLS policies for inbound_routing_settings
ALTER TABLE public.inbound_routing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.inbound_routing_settings;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.inbound_routing_settings;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.inbound_routing_settings;

CREATE POLICY "Users can view their organization's routing settings"
ON public.inbound_routing_settings FOR SELECT
USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can insert routing settings for their org"
ON public.inbound_routing_settings FOR INSERT
WITH CHECK (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin', 'manager')
    )
);

CREATE POLICY "Admins can update routing settings for their org"
ON public.inbound_routing_settings FOR UPDATE
USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin', 'manager')
    )
);
