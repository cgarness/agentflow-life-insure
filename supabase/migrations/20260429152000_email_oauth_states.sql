-- Temporary OAuth state records for email provider connect flows.

CREATE TABLE IF NOT EXISTS public.email_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  state TEXT NOT NULL UNIQUE,
  redirect_to TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_oauth_states_user_provider_idx
  ON public.email_oauth_states(user_id, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS email_oauth_states_expires_idx
  ON public.email_oauth_states(expires_at);

ALTER TABLE public.email_oauth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_oauth_states_select ON public.email_oauth_states;
DROP POLICY IF EXISTS email_oauth_states_insert ON public.email_oauth_states;
DROP POLICY IF EXISTS email_oauth_states_update ON public.email_oauth_states;
DROP POLICY IF EXISTS email_oauth_states_delete ON public.email_oauth_states;

-- Client does not need direct table access; edge functions use service role.
CREATE POLICY email_oauth_states_no_client_access ON public.email_oauth_states
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
