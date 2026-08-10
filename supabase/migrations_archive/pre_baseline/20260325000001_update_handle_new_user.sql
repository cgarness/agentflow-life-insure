
-- Update handle_new_user function to extract organization_id and role from raw_user_meta_data
-- Adds resilience against empty strings for UUID fields and handles slug-to-UUID resolution
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_org_id TEXT;
  resolved_org_id UUID;
  raw_role TEXT;
BEGIN
  raw_org_id := NULLIF(NEW.raw_user_meta_data->>'organization_id', '');
  raw_role := NEW.raw_user_meta_data->>'role';

  -- Resolve Organization ID (Handle UUID vs Slug)
  resolved_org_id := NULL;
  IF raw_org_id IS NOT NULL THEN
      BEGIN
          -- Try to cast as UUID first
          resolved_org_id := raw_org_id::UUID;
      EXCEPTION WHEN OTHERS THEN
          -- If it fails, treat it as a slug and look it up
          SELECT id INTO resolved_org_id FROM public.organizations WHERE slug = raw_org_id LIMIT 1;
      END;
  END IF;

  INSERT INTO public.profiles (
    id, 
    email, 
    first_name, 
    last_name, 
    organization_id, 
    role,
    status
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    resolved_org_id,
    CASE 
      WHEN LOWER(COALESCE(raw_role, 'Agent')) = 'admin' THEN 'Admin'
      WHEN LOWER(COALESCE(raw_role, 'Agent')) = 'team leader' THEN 'Team Leader'
      ELSE 'Agent'
    END,
    'Active'
  );
  RETURN NEW;
END;
$$;
