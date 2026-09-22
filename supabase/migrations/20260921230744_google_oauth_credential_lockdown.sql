-- Apply only after every Google consumer uses server-scoped credentials and the new mailbox RPC.
BEGIN;
UPDATE public.contact_emails m SET source_account_email=c.provider_account_email
  FROM public.user_email_connections c WHERE m.source_account_email IS NULL AND m.connection_id=c.id AND m.owner_user_id=c.user_id AND m.organization_id=c.organization_id;
UPDATE public.calendar_integrations c SET organization_id=p.organization_id FROM public.profiles p WHERE p.id=c.user_id AND c.organization_id IS NULL;
-- Fail on orphaned integrations; do not assign an invented organization.
ALTER TABLE public.calendar_integrations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.contact_emails DROP CONSTRAINT contact_emails_organization_id_provider_external_message_id_key;
-- REVOKE table privileges does not remove explicitly granted column privileges.
DO $$
DECLARE t text; cols text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_email_connections','calendar_integrations','email_oauth_states','email_sync_cursors'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    SELECT string_agg(quote_ident(column_name), ',') INTO cols FROM information_schema.columns WHERE table_schema='public' AND table_name=t;
    EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON public.%I FROM PUBLIC, anon, authenticated', cols,cols,cols,cols,t);
  END LOOP;
END $$;
GRANT SELECT (id, organization_id, user_id, provider, provider_account_email, provider_account_name, status, last_sync_at, last_error, created_at, updated_at)
  ON public.user_email_connections TO authenticated;
GRANT SELECT (id, organization_id, user_id, provider, calendar_id, sync_mode, sync_enabled, last_sync_at, created_at, updated_at, provider_account_email)
  ON public.calendar_integrations TO authenticated;
-- Existing RLS continues to scope safe metadata. Credentials and writes are server-only.

COMMIT;
