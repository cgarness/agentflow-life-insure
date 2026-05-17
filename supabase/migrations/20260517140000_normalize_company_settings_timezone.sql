-- Normalize non-IANA company_settings.timezone and guard future writes.
-- CHECK with subquery against pg_timezone_names is not allowed in PostgreSQL;
-- use BEFORE INSERT/UPDATE trigger validation instead.

UPDATE public.company_settings
SET timezone = 'America/Los_Angeles'
WHERE timezone = 'Pacific Time (US & Canada)';

DROP TRIGGER IF EXISTS trg_company_settings_validate_timezone ON public.company_settings;
DROP FUNCTION IF EXISTS public.validate_iana_timezone();

CREATE OR REPLACE FUNCTION public.validate_iana_timezone()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.timezone IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone
     ) THEN
    RAISE EXCEPTION 'company_settings.timezone must be a valid IANA timezone (got %)', NEW.timezone;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_company_settings_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.company_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_iana_timezone();

NOTIFY pgrst, 'reload schema';
