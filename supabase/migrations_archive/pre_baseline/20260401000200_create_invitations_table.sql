-- Create invitations table
CREATE TABLE IF NOT EXISTS public.invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'Agent',
    upline_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    first_name TEXT,
    last_name TEXT,
    licensed_states JSONB NOT NULL DEFAULT '[]'::jsonb,
    commission_level TEXT DEFAULT '0%',
    token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'Expired', 'Revoked'))
);

-- Index for token lookup
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON public.invitations(organization_id);

-- Enable RLS
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Policies for public access (checking invitation by token)
CREATE POLICY "invitations_public_select_by_token" ON public.invitations
FOR SELECT TO anon, authenticated
USING (status = 'Pending' AND expires_at > NOW());

-- Policies for organization management (Admins can manage)
CREATE POLICY "invitations_org_admin_manage" ON public.invitations
FOR ALL TO authenticated
USING (
    public.is_super_admin() OR
    (
        organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
        AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'Admin'
    )
)
WITH CHECK (
    public.is_super_admin() OR
    (
        organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
        AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'Admin'
    )
);

-- Trigger to expire invitations
CREATE OR REPLACE FUNCTION public.check_invitation_expiry()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.expires_at <= NOW() AND NEW.status = 'Pending' THEN
        NEW.status := 'Expired';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invitations_expiry_trigger
    BEFORE UPDATE ON public.invitations
    FOR EACH ROW
    EXECUTE FUNCTION public.check_invitation_expiry();
