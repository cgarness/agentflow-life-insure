CREATE TABLE IF NOT EXISTS public.calendar_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google',
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  calendar_id text NOT NULL DEFAULT 'primary',
  sync_mode text NOT NULL DEFAULT 'outbound_only' CHECK (sync_mode IN ('outbound_only', 'two_way')),
  sync_enabled boolean NOT NULL DEFAULT false,
  oauth_state text,
  oauth_state_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_integrations_user_id
  ON public.calendar_integrations(user_id);

ALTER TABLE public.calendar_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own calendar integrations"
  ON public.calendar_integrations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own calendar integrations"
  ON public.calendar_integrations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own calendar integrations"
  ON public.calendar_integrations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own calendar integrations"
  ON public.calendar_integrations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS calendar_integrations_updated_at ON public.calendar_integrations;
CREATE TRIGGER calendar_integrations_updated_at
  BEFORE UPDATE ON public.calendar_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
