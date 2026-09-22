-- Google credential protection and serialized OAuth lifecycle. NOT applied to production.
-- Expansion first; deploy every compatible Edge Function before the separate lockdown migration.
BEGIN;
ALTER TABLE public.user_email_connections
  ADD COLUMN connection_generation uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN google_account_id text;
ALTER TABLE public.calendar_integrations
  ADD COLUMN connection_generation uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN google_account_id text,
  ADD COLUMN provider_account_email text,
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
UPDATE public.calendar_integrations c SET organization_id = p.organization_id FROM public.profiles p WHERE p.id = c.user_id;
ALTER TABLE public.email_oauth_states
  ADD COLUMN integration_kind text NOT NULL DEFAULT 'email' CHECK (integration_kind IN ('email','calendar')),
  ADD COLUMN expected_generation uuid,
  ADD COLUMN completed_at timestamptz;
ALTER TABLE public.contact_emails ADD COLUMN source_account_email text;
-- Keep idempotency within a mailbox, not across unrelated users' mailboxes.
UPDATE public.contact_emails m SET source_account_email=c.provider_account_email
  FROM public.user_email_connections c WHERE m.connection_id=c.id AND m.owner_user_id=c.user_id AND m.organization_id=c.organization_id;
ALTER TABLE public.contact_emails ADD CONSTRAINT contact_emails_mailbox_message_key
  UNIQUE (organization_id,owner_user_id,provider,source_account_email,external_message_id);

CREATE OR REPLACE FUNCTION public.begin_google_oauth(p_user_id uuid, p_kind text, p_state text, p_redirect text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE org uuid; generation uuid; result uuid;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('email','calendar') THEN RAISE EXCEPTION 'invalid_integration'; END IF;
  SELECT organization_id INTO org FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF org IS NULL THEN RAISE EXCEPTION 'organization_changed'; END IF;
  IF p_kind='email' THEN
    SELECT connection_generation INTO generation FROM public.user_email_connections WHERE user_id=p_user_id AND provider='google';
  ELSE
    SELECT connection_generation INTO generation FROM public.calendar_integrations WHERE user_id=p_user_id AND provider='google';
  END IF;
  INSERT INTO public.email_oauth_states(user_id,organization_id,provider,state,redirect_to,expires_at,integration_kind,expected_generation)
    VALUES(p_user_id,org,'google',p_state,p_redirect,now()+interval '15 minutes',p_kind,generation) RETURNING id INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.complete_google_oauth(
  p_state_id uuid, p_account_id text, p_email text, p_name text, p_access text, p_refresh text, p_expires timestamptz, p_scope text
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE s public.email_oauth_states; e public.user_email_connections; c public.calendar_integrations;
  org uuid; uid uuid; result uuid; refresh_value text; switched boolean;
BEGIN
  SELECT user_id INTO uid FROM public.email_oauth_states WHERE id=p_state_id;
  IF uid IS NULL THEN RAISE EXCEPTION 'invalid_or_expired_state'; END IF;
  -- Same lock order as begin/disconnect: profile -> state -> connection.
  SELECT organization_id INTO org FROM public.profiles WHERE id=uid FOR UPDATE;
  SELECT * INTO s FROM public.email_oauth_states WHERE id=p_state_id FOR UPDATE;
  IF s.id IS NULL OR s.used_at IS NULL OR s.completed_at IS NOT NULL OR s.expires_at<=now() OR s.provider<>'google' THEN
    RAISE EXCEPTION 'invalid_or_expired_state';
  END IF;
  IF org IS NULL OR org IS DISTINCT FROM s.organization_id THEN RAISE EXCEPTION 'organization_changed'; END IF;
  IF nullif(p_account_id,'') IS NULL OR nullif(p_email,'') IS NULL OR nullif(p_access,'') IS NULL OR p_expires IS NULL OR p_expires<=now() THEN RAISE EXCEPTION 'invalid_token_response'; END IF;
  IF s.integration_kind='email' THEN
    SELECT * INTO e FROM public.user_email_connections WHERE user_id=uid AND provider='google' FOR UPDATE;
    IF e.connection_generation IS DISTINCT FROM s.expected_generation THEN RAISE EXCEPTION 'connection_changed'; END IF;
    IF e.id IS NOT NULL AND e.organization_id IS DISTINCT FROM org THEN RAISE EXCEPTION 'organization_changed'; END IF;
    refresh_value := nullif(p_refresh,'');
    IF refresh_value IS NULL AND e.google_account_id=p_account_id THEN refresh_value:=nullif(e.refresh_token_encrypted,''); END IF;
    IF refresh_value IS NULL THEN RAISE EXCEPTION 'offline_access_required'; END IF;
    switched := e.id IS NOT NULL AND (lower(e.provider_account_email)<>lower(p_email) OR (e.google_account_id IS NOT NULL AND e.google_account_id<>p_account_id));
    IF switched THEN
      -- History keeps its original mailbox identity, not the replacement account's connection.
      UPDATE public.contact_emails SET source_account_email=coalesce(source_account_email,e.provider_account_email), connection_id=NULL WHERE connection_id=e.id;
    END IF;
    IF e.id IS NOT NULL THEN
      DELETE FROM public.email_sync_cursors WHERE connection_id=e.id;
      UPDATE public.user_email_connections SET organization_id=org, provider_account_email=lower(p_email), provider_account_name=p_name,
        google_account_id=p_account_id, access_token_encrypted=p_access, refresh_token_encrypted=refresh_value,
        access_token_expires_at=p_expires, scope=p_scope, status='connected', last_error=NULL, last_sync_at=NULL,
        connection_generation=gen_random_uuid() WHERE id=e.id RETURNING id INTO result;
    ELSE
      INSERT INTO public.user_email_connections(organization_id,user_id,provider,provider_account_email,provider_account_name,google_account_id,access_token_encrypted,refresh_token_encrypted,access_token_expires_at,scope,status)
      VALUES(org,uid,'google',lower(p_email),p_name,p_account_id,p_access,refresh_value,p_expires,p_scope,'connected') RETURNING id INTO result;
    END IF;
  ELSE
    SELECT * INTO c FROM public.calendar_integrations WHERE user_id=uid AND provider='google' FOR UPDATE;
    IF c.connection_generation IS DISTINCT FROM s.expected_generation THEN RAISE EXCEPTION 'connection_changed'; END IF;
    IF c.id IS NOT NULL AND c.organization_id IS DISTINCT FROM org THEN RAISE EXCEPTION 'organization_changed'; END IF;
    refresh_value:=nullif(p_refresh,'');
    IF refresh_value IS NULL AND c.google_account_id=p_account_id THEN refresh_value:=nullif(c.refresh_token,''); END IF;
    IF refresh_value IS NULL THEN RAISE EXCEPTION 'offline_access_required'; END IF;
    IF c.id IS NULL THEN
      INSERT INTO public.calendar_integrations(user_id,organization_id,provider,google_account_id,provider_account_email,access_token,refresh_token,token_expires_at,sync_enabled)
      VALUES(uid,org,'google',p_account_id,lower(p_email),p_access,refresh_value,p_expires,true) RETURNING id INTO result;
    ELSE
      UPDATE public.calendar_integrations SET access_token=p_access,refresh_token=refresh_value,token_expires_at=p_expires,
        google_account_id=p_account_id,provider_account_email=lower(p_email),sync_enabled=true,last_sync_token=NULL,
        calendar_id=CASE WHEN c.google_account_id=p_account_id THEN c.calendar_id ELSE 'primary' END,
        connection_generation=gen_random_uuid(),oauth_state=NULL,oauth_state_expires_at=NULL
        WHERE id=c.id RETURNING id INTO result;
    END IF;
  END IF;
  UPDATE public.email_oauth_states SET completed_at=now() WHERE id=s.id;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.disconnect_google_oauth(p_user_id uuid, p_kind text, p_connection_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE e public.user_email_connections; c public.calendar_integrations; credentials jsonb:='[]'::jsonb;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('email','calendar','all') THEN RAISE EXCEPTION 'invalid_integration'; END IF;
  PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'connection_not_found'; END IF;
  IF p_kind IN ('email','all') THEN
    SELECT * INTO e FROM public.user_email_connections WHERE user_id=p_user_id AND provider='google' AND (p_kind='all' OR id=p_connection_id) FOR UPDATE;
    IF p_kind='email' AND e.id IS NULL THEN RAISE EXCEPTION 'connection_not_found'; END IF;
    IF e.id IS NOT NULL THEN
      credentials:=credentials||jsonb_build_array(jsonb_build_object('kind','email','access',e.access_token_encrypted,'refresh',e.refresh_token_encrypted));
      UPDATE public.user_email_connections SET access_token_encrypted='',refresh_token_encrypted=NULL,access_token_expires_at=NULL,
        status='disconnected',last_error=NULL,connection_generation=gen_random_uuid() WHERE id=e.id;
      DELETE FROM public.email_sync_cursors WHERE connection_id=e.id;
    END IF;
  END IF;
  IF p_kind IN ('calendar','all') THEN
    SELECT * INTO c FROM public.calendar_integrations WHERE user_id=p_user_id AND provider='google' FOR UPDATE;
    IF p_kind='calendar' AND c.id IS NULL THEN RAISE EXCEPTION 'connection_not_found'; END IF;
    IF c.id IS NOT NULL THEN
      credentials:=credentials||jsonb_build_array(jsonb_build_object('kind','calendar','access',c.access_token,'refresh',c.refresh_token));
      UPDATE public.calendar_integrations SET access_token=NULL,refresh_token=NULL,token_expires_at=NULL,sync_enabled=false,
        last_sync_token=NULL,oauth_state=NULL,oauth_state_expires_at=NULL,connection_generation=gen_random_uuid() WHERE id=c.id;
    END IF;
  END IF;
  DELETE FROM public.email_oauth_states WHERE user_id=p_user_id AND provider='google' AND (p_kind='all' OR integration_kind=p_kind);
  -- Only service_role may call this function; this value must never be returned by an Edge endpoint.
  RETURN credentials;
END $$;

CREATE OR REPLACE FUNCTION public.persist_google_email_message(p_connection_id uuid, p_generation uuid, p_message jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c public.user_email_connections; result uuid;
BEGIN
  SELECT * INTO c FROM public.user_email_connections WHERE id=p_connection_id FOR UPDATE;
  IF c.id IS NULL OR c.provider<>'google' OR c.status<>'connected' OR c.connection_generation IS DISTINCT FROM p_generation THEN RAISE EXCEPTION 'connection_changed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=c.user_id AND organization_id=c.organization_id) THEN RAISE EXCEPTION 'organization_changed'; END IF;
  INSERT INTO public.contact_emails(organization_id,contact_id,owner_user_id,connection_id,provider,direction,external_message_id,thread_id,internet_message_id,in_reply_to,reference_ids,from_email,to_emails,cc_emails,subject,body_text,body_html,received_at,delivery_status,source_account_email)
  VALUES(c.organization_id,(p_message->>'contact_id')::uuid,c.user_id,c.id,'google','inbound',p_message->>'external_message_id',p_message->>'thread_id',p_message->>'internet_message_id',p_message->>'in_reply_to',p_message->>'reference_ids',p_message->>'from_email',p_message->'to_emails',p_message->'cc_emails',p_message->>'subject',p_message->>'body_text',p_message->>'body_html',(p_message->>'received_at')::timestamptz,'received',c.provider_account_email)
  ON CONFLICT (organization_id,owner_user_id,provider,source_account_email,external_message_id) DO NOTHING RETURNING id INTO result;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.advance_google_email_cursor(p_connection_id uuid, p_generation uuid, p_cursor text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c public.user_email_connections;
BEGIN
  SELECT * INTO c FROM public.user_email_connections WHERE id=p_connection_id FOR UPDATE;
  IF c.id IS NULL OR c.provider<>'google' OR c.status<>'connected' OR c.connection_generation IS DISTINCT FROM p_generation THEN RAISE EXCEPTION 'connection_changed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=c.user_id AND organization_id=c.organization_id) THEN RAISE EXCEPTION 'organization_changed'; END IF;
  INSERT INTO public.email_sync_cursors(organization_id,connection_id,provider,cursor_value,cursor_updated_at)
  VALUES(c.organization_id,c.id,'google',p_cursor,now()) ON CONFLICT(connection_id) DO UPDATE SET cursor_value=excluded.cursor_value,cursor_updated_at=excluded.cursor_updated_at;
  UPDATE public.user_email_connections SET last_sync_at=now(),last_error=NULL WHERE id=c.id;
END $$;

CREATE OR REPLACE FUNCTION public.migrate_google_credential(p_kind text,p_id uuid,p_generation uuid,p_old_access text,p_old_refresh text,p_new_access text,p_new_refresh text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_kind='email' THEN
    UPDATE public.user_email_connections SET access_token_encrypted=coalesce(p_new_access,''),refresh_token_encrypted=p_new_refresh
      WHERE id=p_id AND connection_generation=p_generation AND access_token_encrypted IS NOT DISTINCT FROM p_old_access AND refresh_token_encrypted IS NOT DISTINCT FROM p_old_refresh;
  ELSIF p_kind='calendar' THEN
    UPDATE public.calendar_integrations SET access_token=p_new_access,refresh_token=p_new_refresh
      WHERE id=p_id AND connection_generation=p_generation AND access_token IS NOT DISTINCT FROM p_old_access AND refresh_token IS NOT DISTINCT FROM p_old_refresh;
  ELSE RAISE EXCEPTION 'invalid_integration'; END IF;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.migrate_google_credential(text,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_google_credential(text,uuid,uuid,text,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.begin_google_oauth(uuid,text,text,text), public.complete_google_oauth(uuid,text,text,text,text,text,timestamptz,text), public.disconnect_google_oauth(uuid,text,uuid), public.persist_google_email_message(uuid,uuid,jsonb), public.advance_google_email_cursor(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_google_oauth(uuid,text,text,text), public.complete_google_oauth(uuid,text,text,text,text,text,timestamptz,text), public.disconnect_google_oauth(uuid,text,uuid), public.persist_google_email_message(uuid,uuid,jsonb), public.advance_google_email_cursor(uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
