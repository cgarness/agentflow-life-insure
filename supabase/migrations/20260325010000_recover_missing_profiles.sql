
-- Migration to recover missing profiles for users who signed up while the trigger was failing
-- This script will identify users in auth.users who don't have a profile and create one.

DO $$
DECLARE
    user_record RECORD;
    raw_org_id TEXT;
    raw_role TEXT;
    final_role TEXT;
BEGIN
    FOR user_record IN 
        SELECT id, email, raw_user_meta_data 
        FROM auth.users 
        WHERE id NOT IN (SELECT id FROM public.profiles)
    LOOP
        -- Extract metadata
        raw_org_id := user_record.raw_user_meta_data->>'organization_id';
        raw_role := user_record.raw_user_meta_data->>'role';

        -- Standardize role
        CASE 
            WHEN LOWER(COALESCE(raw_role, 'Agent')) = 'admin' THEN final_role := 'Admin';
            WHEN LOWER(COALESCE(raw_role, 'Agent')) = 'team leader' THEN final_role := 'Team Leader';
            ELSE final_role := 'Agent';
        END CASE;

        -- Create profile
        INSERT INTO public.profiles (
            id, 
            email, 
            first_name, 
            last_name, 
            organization_id, 
            role, 
            status
        ) VALUES (
            user_record.id,
            user_record.email,
            COALESCE(user_record.raw_user_meta_data->>'first_name', ''),
            COALESCE(user_record.raw_user_meta_data->>'last_name', ''),
            NULLIF(raw_org_id, '')::UUID,
            final_role,
            'Active'
        ) ON CONFLICT (id) DO NOTHING;
        
        RAISE NOTICE 'Recovered profile for user: %', user_record.email;
    END LOOP;
END $$;
