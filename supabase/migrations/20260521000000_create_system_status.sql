-- Create system_status table
CREATE TABLE IF NOT EXISTS public.system_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy', 'degraded', 'outage', 'maintenance')),
    description TEXT,
    notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.system_status ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read system status
DROP POLICY IF EXISTS "Allow authenticated to select system status" ON public.system_status;
CREATE POLICY "Allow authenticated to select system status" 
ON public.system_status
FOR SELECT
TO authenticated
USING (true);

-- Restrict modification rights to Super Admins
DROP POLICY IF EXISTS "Allow super admins to insert system status" ON public.system_status;
CREATE POLICY "Allow super admins to insert system status"
ON public.system_status
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Allow super admins to update system status" ON public.system_status;
CREATE POLICY "Allow super admins to update system status"
ON public.system_status
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Allow super admins to delete system status" ON public.system_status;
CREATE POLICY "Allow super admins to delete system status"
ON public.system_status
FOR DELETE
TO authenticated
USING (public.is_super_admin());

-- Seed the initial components
INSERT INTO public.system_status (component_name, status, description, notes) VALUES
('Database (PostgreSQL)', 'healthy', 'Stores user profiles, agency settings, lead details, campaigns, and logs.', 'Database cluster performance is optimal. CPU utilization at < 15%.'),
('Authentication (Supabase Auth)', 'healthy', 'Handles registration, login, JWT validation, and access control.', 'Service operational. Average latency under 80ms.'),
('Twilio Voice Integration', 'healthy', 'Handles carrier routing, outbound calling, subaccounts provisioning, and webhooks.', 'All voice servers green. Subaccount provisioning operational.'),
('Telnyx Messaging & Direct Lines', 'healthy', 'Manages direct phone line assignments, reputations checks, and SMS logs.', 'SMS delivery rates within normal thresholds (99.8% success).'),
('Storage Buckets (S3/Supabase)', 'healthy', 'Stores call recordings, agency logos, and document resources.', 'Read/write times within bounds. Expiration policies executing correctly.'),
('Background Work & Cron Engine', 'healthy', 'Executes scheduled sync jobs, email crons, and periodic database maintenance.', 'Cron triggers are firing on schedule without delay.'),
('Email Provider (SendGrid)', 'healthy', 'Manages system-generated emails, verification links, and user invitations.', 'Deliverability rate 99.4%. Spam report rate < 0.05%.')
ON CONFLICT (component_name) DO UPDATE 
SET status = EXCLUDED.status, 
    description = EXCLUDED.description, 
    notes = EXCLUDED.notes;

-- Notify schema reload
NOTIFY pgrst, 'reload schema';
