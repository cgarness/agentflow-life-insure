
-- Slug-Aware Recovery Migration
-- This script handles cases where organization_id in metadata might be a slug instead of a UUID

DO $$
DECLARE
    user_record RECORD;
    raw_org_id TEXT;
    resolved_org_id UUID;
    raw_role TEXT;
    final_role TEXT;
BEGIN
    FOR user_record IN 
        SELECT id, email, raw_user_meta_data 
        FROM auth.users 
        WHERE id NOT IN (SELECT id FROM public.profiles)
    LOOP
        -- Extract metadata
        raw_org_id := NULLIF(user_record.raw_user_meta_data->>'organization_id', '');
        raw_role := user_record.raw_user_meta_data->>'role';

        -- Resolve Organization ID (Handle UUID vs Slug)
        resolved_org_id := NULL;
        IF raw_org_id IS NOT NULL THEN
            BEGIN
                -- Try to cast as UUID first
                resolved_org_id := raw_org_id::UUID;
            EXCEPTION WHEN OTHERS THEN
                -- If it fails, treat it as a slug and look it up
                SELECT id INTO resolved_org_id FROM public.organizations WHERE slug = raw_org_id LIMIT 1;
                
                IF resolved_org_id IS NULL THEN
                  RAISE WARNING 'Could not resolve organization slug: % for user %', raw_org_id, user_record.email;
                END IF;
            END;
        END IF;

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
            resolved_org_id,
            final_role,
            'Active'
        ) ON CONFLICT (id) DO NOTHING;
        
        RAISE NOTICE 'Recovered profile for user: % (Org: %)', user_record.email, COALESCE(resolved_org_id::TEXT, 'NULL');
    END LOOP;
END $$;
