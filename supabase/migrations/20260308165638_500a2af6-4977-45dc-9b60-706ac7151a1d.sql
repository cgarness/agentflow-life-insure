
-- Create calendar_integrations table
CREATE TABLE public.calendar_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'google',
  calendar_id text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  sync_mode text NOT NULL DEFAULT 'outbound_only',
  sync_enabled boolean NOT NULL DEFAULT true,
  last_sync_token text,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

ALTER TABLE public.calendar_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own calendar integrations"
  ON public.calendar_integrations FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add columns to appointments table
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS external_event_id text,
  ADD COLUMN IF NOT EXISTS external_provider text,
  ADD COLUMN IF NOT EXISTS external_last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_source text NOT NULL DEFAULT 'internal';
