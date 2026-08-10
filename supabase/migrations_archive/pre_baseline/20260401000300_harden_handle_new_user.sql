-- Add null safety to handle_new_user trigger
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
  raw_upline_id TEXT;
  resolved_upline_id UUID;
  raw_licensed_states JSONB;
  raw_commission_level TEXT;
BEGIN
  -- Safety check for null metadata
  IF NEW.raw_user_meta_data IS NULL THEN
    INSERT INTO public.profiles (id, email, first_name, last_name, role, status)
    VALUES (NEW.id, NEW.email, 'User', '', 'Agent', 'Active');
    RETURN NEW;
  END IF;

  raw_org_id := NULLIF(NEW.raw_user_meta_data->>'organization_id', '');
  raw_role := NEW.raw_user_meta_data->>'role';
  raw_upline_id := NULLIF(NEW.raw_user_meta_data->>'upline_id', '');
  raw_licensed_states := NEW.raw_user_meta_data->'licensed_states';
  raw_commission_level := NULLIF(NEW.raw_user_meta_data->>'commission_level', '');

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

  -- Resolve Upline ID
  resolved_upline_id := NULL;
  IF raw_upline_id IS NOT NULL THEN
      BEGIN
          resolved_upline_id := raw_upline_id::UUID;
      EXCEPTION WHEN OTHERS THEN
          resolved_upline_id := NULL;
      END;
  END IF;

  INSERT INTO public.profiles (
    id, 
    email, 
    first_name, 
    last_name, 
    organization_id, 
    role,
    status,
    upline_id,
    licensed_states,
    commission_level
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'first_name', ''), 'User'),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    resolved_org_id,
    COALESCE(raw_role, 'Agent'),
    'Active',
    resolved_upline_id,
    COALESCE(raw_licensed_states, '[]'::jsonb),
    COALESCE(raw_commission_level, '0%')
  );

  RETURN NEW;
END;
$$;
