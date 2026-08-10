DO $$
BEGIN
  IF to_regclass('public.appointments') IS NOT NULL THEN
    ALTER TABLE public.appointments
      ADD COLUMN IF NOT EXISTS external_provider text,
      ADD COLUMN IF NOT EXISTS external_event_id text,
      ADD COLUMN IF NOT EXISTS external_last_synced_at timestamptz;
  END IF;
END $$;
