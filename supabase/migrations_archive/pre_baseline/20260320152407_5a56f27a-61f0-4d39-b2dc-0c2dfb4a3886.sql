
-- Add recording_retention_days to phone_settings
ALTER TABLE public.phone_settings ADD COLUMN IF NOT EXISTS recording_retention_days integer DEFAULT 0;

-- Add flagged_for_coaching to calls
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS flagged_for_coaching boolean DEFAULT false;

-- Create inbound_routing_settings table
CREATE TABLE IF NOT EXISTS public.inbound_routing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_mode text NOT NULL DEFAULT 'round_robin',
  auto_create_lead boolean NOT NULL DEFAULT false,
  after_hours_sms_enabled boolean NOT NULL DEFAULT false,
  after_hours_sms text DEFAULT 'Thank you for calling. We are currently closed. We will return your call during business hours.',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inbound_routing_settings ENABLE ROW LEVEL SECURITY;

-- RLS policy
CREATE POLICY "Allow all for authenticated users" ON public.inbound_routing_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Insert default row
INSERT INTO public.inbound_routing_settings (id) VALUES ('00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;
