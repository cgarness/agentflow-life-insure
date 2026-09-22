-- Disposable test schema only. No production connection is used.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION public.get_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.org',true),'')::uuid $$;
CREATE FUNCTION public.get_user_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,organization_id uuid REFERENCES public.organizations(id));
ALTER TABLE public.profiles ADD COLUMN status text NOT NULL DEFAULT 'Active';
CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,organization_id uuid,type text,title text,body text,read boolean DEFAULT false,action_url text,action_label text,metadata jsonb,created_at timestamptz DEFAULT now(),event_key text,dismissed_at timestamptz,UNIQUE(user_id,event_key));
CREATE TABLE public.activity_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,user_id uuid,user_name text,action text,category text,metadata jsonb,created_at timestamptz DEFAULT now());
CREATE FUNCTION public.update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
-- Email inbox connection foundation (OAuth providers + contact-level email timeline)
-- MVP scope: connection records, sync cursors, and normalized contact email rows.

CREATE TABLE IF NOT EXISTS public.user_email_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  provider_account_email TEXT NOT NULL,
  provider_account_name TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  access_token_expires_at TIMESTAMPTZ,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'needs_reconnect', 'disconnected', 'sync_paused')),
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider),
  UNIQUE (provider, provider_account_email)
);

CREATE INDEX IF NOT EXISTS user_email_connections_org_status_idx
  ON public.user_email_connections(organization_id, status);

CREATE INDEX IF NOT EXISTS user_email_connections_user_status_idx
  ON public.user_email_connections(user_id, status);

CREATE TABLE IF NOT EXISTS public.email_sync_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.user_email_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  cursor_value TEXT NOT NULL,
  cursor_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id)
);

CREATE INDEX IF NOT EXISTS email_sync_cursors_org_provider_idx
  ON public.email_sync_cursors(organization_id, provider);

CREATE TABLE IF NOT EXISTS public.contact_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES public.user_email_connections(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  external_message_id TEXT NOT NULL,
  thread_id TEXT,
  internet_message_id TEXT,
  from_email TEXT NOT NULL,
  to_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  cc_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  bcc_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  delivery_status TEXT NOT NULL DEFAULT 'received' CHECK (delivery_status IN ('queued', 'sent', 'delivered', 'received', 'failed')),
  provider_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, external_message_id)
);

CREATE INDEX IF NOT EXISTS contact_emails_contact_ts_idx
  ON public.contact_emails(organization_id, contact_id, COALESCE(received_at, sent_at, created_at) DESC);

CREATE INDEX IF NOT EXISTS contact_emails_owner_ts_idx
  ON public.contact_emails(owner_user_id, COALESCE(received_at, sent_at, created_at) DESC);

CREATE INDEX IF NOT EXISTS contact_emails_thread_idx
  ON public.contact_emails(thread_id);

DROP TRIGGER IF EXISTS set_user_email_connections_updated_at ON public.user_email_connections;
CREATE TRIGGER set_user_email_connections_updated_at
  BEFORE UPDATE ON public.user_email_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS set_contact_emails_updated_at ON public.contact_emails;
CREATE TRIGGER set_contact_emails_updated_at
  BEFORE UPDATE ON public.contact_emails
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.user_email_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_emails ENABLE ROW LEVEL SECURITY;


-- Create calendar_integrations table (may already exist from earlier migrations)
CREATE TABLE IF NOT EXISTS public.calendar_integrations (
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

DROP POLICY IF EXISTS "Users can manage their own calendar integrations" ON public.calendar_integrations;
CREATE POLICY "Users can manage their own calendar integrations"
  ON public.calendar_integrations FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.calendar_integrations ADD COLUMN oauth_state text, ADD COLUMN oauth_state_expires_at timestamptz;
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

ALTER TABLE public.contact_emails ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE public.contact_emails ADD COLUMN in_reply_to text, ADD COLUMN reference_ids text;
CREATE POLICY email_connections_select ON public.user_email_connections FOR SELECT TO authenticated USING (organization_id=get_org_id() AND (user_id=auth.uid() OR get_user_role() IN ('Admin','Super Admin','Team Leader','Team Lead')));
CREATE POLICY email_connections_update ON public.user_email_connections FOR UPDATE TO authenticated USING (user_id=auth.uid() AND organization_id=get_org_id()) WITH CHECK(user_id=auth.uid() AND organization_id=get_org_id());
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;
-- Explicit column grants are a separate attack surface: the migration must remove these too.
GRANT SELECT(access_token_encrypted),UPDATE(refresh_token_encrypted) ON public.user_email_connections TO authenticated;
INSERT INTO public.organizations VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO public.profiles(id,organization_id) VALUES
('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('33333333-3333-3333-3333-333333333333','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('44444444-4444-4444-4444-444444444444','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO public.user_email_connections(id,user_id,organization_id,provider,provider_account_email,access_token_encrypted,refresh_token_encrypted)
VALUES('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','google','owner@example.test','synthetic-access','synthetic-refresh');
INSERT INTO public.calendar_integrations(user_id,provider,access_token,refresh_token) VALUES('11111111-1111-1111-1111-111111111111','google','synthetic-calendar-access','synthetic-calendar-refresh');
