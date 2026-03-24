
-- Function to invoke the welcome email edge function
CREATE OR REPLACE FUNCTION public.handle_new_user_welcome_email()
RETURNS TRIGGER AS $$
DECLARE
  payload JSONB;
BEGIN
  -- Construct the payload with user info
  payload := jsonb_build_object(
    'email', NEW.email,
    'firstName', NEW.first_name
  );

  -- Perform the HTTP request to the edge function
  -- Note: You'll need to set the supabase_url and service_role_key in your environment
  PERFORM
    net.http_post(
      url := (SELECT value FROM secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/send-welcome-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT value FROM secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
      ),
      body := payload
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function when a new profile is created
-- This assumes profiles are created automatically upon auth signup
DROP TRIGGER IF EXISTS on_profile_created_welcome_email ON public.profiles;
CREATE TRIGGER on_profile_created_welcome_email
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_welcome_email();
