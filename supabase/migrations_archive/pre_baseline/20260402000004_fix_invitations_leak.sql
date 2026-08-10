-- Fix Invitation Data Leak and Elevate Team Leaders

-- 1. Drop the leaky policy that allowed anyone to SELECT *
DROP POLICY IF EXISTS "invitations_public_select_by_token" ON public.invitations;

-- 2. Update management policy to include Team Leaders
DROP POLICY IF EXISTS "invitations_org_admin_manage" ON public.invitations;

CREATE POLICY "invitations_org_admin_manage" ON public.invitations
FOR ALL TO authenticated
USING (
    public.is_super_admin() OR
    (
        organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
        AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('Admin', 'Team Leader')
    )
)
WITH CHECK (
    public.is_super_admin() OR
    (
        organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
        AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('Admin', 'Team Leader')
    )
);

-- 3. Create a SECURITY DEFINER RPC to safely get an invitation by token without exposing the whole table
-- This includes the organization name joined for the welcome screen.
CREATE OR REPLACE FUNCTION public.get_invitation_by_token_rpc(invite_token TEXT)
RETURNS TABLE (
    id UUID,
    email TEXT,
    organization_id UUID,
    role TEXT,
    upline_id UUID,
    first_name TEXT,
    last_name TEXT,
    licensed_states JSONB,
    commission_level TEXT,
    token TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    status TEXT,
    org_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY 
    SELECT 
        i.id, i.email, i.organization_id, i.role, i.upline_id, 
        i.first_name, i.last_name, i.licensed_states, i.commission_level, 
        i.token, i.expires_at, i.created_at, i.accepted_at, i.status,
        o.name as org_name
    FROM public.invitations i
    LEFT JOIN public.organizations o ON i.organization_id = o.id
    WHERE i.token = invite_token 
    LIMIT 1;
END;
$$;
