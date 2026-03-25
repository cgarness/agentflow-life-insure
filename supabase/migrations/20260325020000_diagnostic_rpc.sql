
-- Diagnostic RPC to check for user existence (can be called via Supabase Console)
CREATE OR REPLACE FUNCTION public.check_user_diagnostic(email_to_check TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    auth_user_id UUID;
    profile_id UUID;
    profile_role TEXT;
    profile_org_id UUID;
BEGIN
    -- 1. Check Auth Users
    SELECT id INTO auth_user_id FROM auth.users WHERE email = email_to_check;
    
    -- 2. Check Profiles
    SELECT id, role, organization_id INTO profile_id, profile_role, profile_org_id 
    FROM public.profiles WHERE email = email_to_check;
    
    RETURN jsonb_build_object(
        'auth_user_found', auth_user_id IS NOT NULL,
        'auth_user_id', auth_user_id,
        'profile_found', profile_id IS NOT NULL,
        'profile_id', profile_id,
        'profile_role', profile_role,
        'profile_org_id', profile_org_id
    );
END;
$$;
