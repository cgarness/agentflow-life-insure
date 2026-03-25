
-- Update handle_new_user function to extract organization_id and role from raw_user_meta_data
-- Adds resilience against empty strings for UUID fields and standardizes role capitalization
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_org_id TEXT;
  raw_role TEXT;
BEGIN
  raw_org_id := NEW.raw_user_meta_data->>'organization_id';
  raw_role := NEW.raw_user_meta_data->>'role';

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
    NULLIF(raw_org_id, '')::UUID,
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
