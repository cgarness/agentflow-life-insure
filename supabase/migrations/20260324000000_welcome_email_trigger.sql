
-- Function to invoke the welcome email edge function safely
CREATE OR REPLACE FUNCTION public.handle_new_user_welcome_email()
RETURNS TRIGGER AS $$
DECLARE
  payload JSONB;
  function_url TEXT;
  service_role_key TEXT;
BEGIN
  -- Construct the payload
  payload := jsonb_build_object(
    'email', NEW.email,
    'firstName', NEW.first_name
  );

  -- 1. Try to get configuration from app settings (set via dashboard or CLI)
  -- If not found, we use safe defaults or fallback
  function_url := current_setting('app.settings.supabase_url', true);
  service_role_key := current_setting('app.settings.service_role_key', true);

  -- If we don't have the URL, we can't send, but we SHOULD NOT fail the user signup
  IF function_url IS NULL OR function_url = '' THEN
    RAISE WARNING 'Welcome email skipped: SUPABASE_URL not set in app.settings';
    RETURN NEW;
  END IF;

  -- 2. Perform the request inside a safety block
  BEGIN
    PERFORM
      net.http_post(
        url := function_url || '/functions/v1/send-welcome-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(service_role_key, '')
        ),
        body := payload,
        timeout_milliseconds := 2000 -- Short timeout to avoid hanging transactions
      );
  EXCEPTION WHEN OTHERS THEN
    -- Log the error but ALLOW the transaction to continue
    RAISE WARNING 'Welcome email failed to trigger: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function when a new profile is created
DROP TRIGGER IF EXISTS on_profile_created_welcome_email ON public.profiles;
CREATE TRIGGER on_profile_created_welcome_email
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_welcome_email();

-- Help the user set up the required settings
-- Usage: ALTER DATABASE postgres SET "app.settings.supabase_url" = 'your-url';
-- Usage: ALTER DATABASE postgres SET "app.settings.service_role_key" = 'your-key';
