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

DROP POLICY IF EXISTS user_email_connections_select ON public.user_email_connections;
DROP POLICY IF EXISTS user_email_connections_insert ON public.user_email_connections;
DROP POLICY IF EXISTS user_email_connections_update ON public.user_email_connections;
DROP POLICY IF EXISTS user_email_connections_delete ON public.user_email_connections;

CREATE POLICY user_email_connections_select ON public.user_email_connections
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      organization_id = public.get_org_id()
      AND (
        user_id = auth.uid()
        OR public.get_user_role() IN ('Admin', 'Super Admin', 'Team Leader', 'Team Lead')
      )
    )
  );

CREATE POLICY user_email_connections_insert ON public.user_email_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND user_id = auth.uid()
  );

CREATE POLICY user_email_connections_update ON public.user_email_connections
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND user_id = auth.uid()
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND user_id = auth.uid()
  );

CREATE POLICY user_email_connections_delete ON public.user_email_connections
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS email_sync_cursors_select ON public.email_sync_cursors;
DROP POLICY IF EXISTS email_sync_cursors_insert ON public.email_sync_cursors;
DROP POLICY IF EXISTS email_sync_cursors_update ON public.email_sync_cursors;
DROP POLICY IF EXISTS email_sync_cursors_delete ON public.email_sync_cursors;

CREATE POLICY email_sync_cursors_select ON public.email_sync_cursors
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      organization_id = public.get_org_id()
      AND EXISTS (
        SELECT 1
        FROM public.user_email_connections c
        WHERE c.id = connection_id
          AND c.organization_id = public.get_org_id()
          AND (
            c.user_id = auth.uid()
            OR public.get_user_role() IN ('Admin', 'Super Admin', 'Team Leader', 'Team Lead')
          )
      )
    )
  );

CREATE POLICY email_sync_cursors_insert ON public.email_sync_cursors
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.user_email_connections c
      WHERE c.id = connection_id
        AND c.user_id = auth.uid()
        AND c.organization_id = public.get_org_id()
    )
  );

CREATE POLICY email_sync_cursors_update ON public.email_sync_cursors
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.user_email_connections c
      WHERE c.id = connection_id
        AND c.user_id = auth.uid()
        AND c.organization_id = public.get_org_id()
    )
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.user_email_connections c
      WHERE c.id = connection_id
        AND c.user_id = auth.uid()
        AND c.organization_id = public.get_org_id()
    )
  );

CREATE POLICY email_sync_cursors_delete ON public.email_sync_cursors
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.user_email_connections c
      WHERE c.id = connection_id
        AND c.user_id = auth.uid()
        AND c.organization_id = public.get_org_id()
    )
  );

DROP POLICY IF EXISTS contact_emails_select ON public.contact_emails;
DROP POLICY IF EXISTS contact_emails_insert ON public.contact_emails;
DROP POLICY IF EXISTS contact_emails_update ON public.contact_emails;
DROP POLICY IF EXISTS contact_emails_delete ON public.contact_emails;

CREATE POLICY contact_emails_select ON public.contact_emails
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      organization_id = public.get_org_id()
      AND (
        public.get_user_role() IN ('Admin', 'Super Admin')
        OR owner_user_id = auth.uid()
        OR (
          public.get_user_role() IN ('Team Leader', 'Team Lead')
          AND public.is_ancestor_of(auth.uid(), owner_user_id)
        )
      )
    )
  );

CREATE POLICY contact_emails_insert ON public.contact_emails
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND owner_user_id = auth.uid()
  );

CREATE POLICY contact_emails_update ON public.contact_emails
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND owner_user_id = auth.uid()
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND owner_user_id = auth.uid()
  );

-- No client-side delete in MVP. Keep cleanup/admin actions service-role only.

NOTIFY pgrst, 'reload schema';
