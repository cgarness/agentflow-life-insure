-- Review build only. Apply with all compatible Gmail writers under maintenance.
BEGIN;
CREATE TABLE public.google_mailbox_deletion_requests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  mailbox text NOT NULL CHECK (mailbox=lower(trim(mailbox)) AND position('@' in mailbox)>1),
  received_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  authority_ref text NOT NULL CHECK (length(authority_ref) BETWEEN 1 AND 200),
  operator_ref text NOT NULL CHECK (length(operator_ref) BETWEEN 1 AND 200),
  ledger_ref text NOT NULL CHECK (length(ledger_ref) BETWEEN 1 AND 500),
  manifest jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','live_deleted')),
  deleted_messages integer NOT NULL DEFAULT 0,
  deleted_notifications integer NOT NULL DEFAULT 0,
  deleted_activities integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (received_at<=verified_at AND verified_at<=due_at AND due_at<=verified_at+interval '30 days')
);
-- Deliberately no cascading FK: an erasure ledger must outlive profile removal.
CREATE UNIQUE INDEX google_mailbox_deletion_pending_user ON public.google_mailbox_deletion_requests(user_id) WHERE status='pending';
CREATE INDEX google_mailbox_deletion_scope ON public.google_mailbox_deletion_requests(organization_id,user_id,mailbox);
ALTER TABLE public.google_mailbox_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_mailbox_deletion_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.google_mailbox_deletion_requests TO service_role;
ALTER TABLE public.contact_emails ADD COLUMN google_connection_generation uuid;
CREATE INDEX contact_emails_google_erasure_scope ON public.contact_emails(organization_id,owner_user_id,lower(source_account_email),id) WHERE provider='google';

CREATE FUNCTION public.assert_google_user_available(p_user uuid,p_kind text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM 1 FROM public.profiles WHERE id=p_user AND organization_id IS NOT NULL AND lower(coalesce(status::text,''))<>'deleted' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account_unavailable'; END IF;
  IF p_kind='email' AND EXISTS(SELECT 1 FROM public.google_mailbox_deletion_requests WHERE user_id=p_user AND status='pending') THEN
    RAISE EXCEPTION 'deletion_in_progress';
  END IF;
END $$;




CREATE FUNCTION public.lock_google_mailbox(p_connection uuid,p_generation uuid,p_allow_failed boolean DEFAULT false)
RETURNS public.user_email_connections LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c public.user_email_connections; uid uuid;
BEGIN
  SELECT user_id INTO uid FROM public.user_email_connections WHERE id=p_connection;
  PERFORM 1 FROM public.profiles WHERE id=uid AND lower(coalesce(status::text,''))<>'deleted' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account_unavailable'; END IF;
  SELECT * INTO c FROM public.user_email_connections WHERE id=p_connection FOR UPDATE;
  IF c.id IS NULL OR c.provider<>'google' OR c.connection_generation IS DISTINCT FROM p_generation
    OR (c.status<>'connected' AND NOT (coalesce(p_allow_failed,false) AND c.status='needs_reconnect')) THEN RAISE EXCEPTION 'connection_changed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=c.user_id AND organization_id=c.organization_id) THEN RAISE EXCEPTION 'organization_changed'; END IF;
  IF EXISTS(SELECT 1 FROM public.google_mailbox_deletion_requests WHERE organization_id=c.organization_id AND user_id=c.user_id AND mailbox=lower(c.provider_account_email) AND status='pending') THEN RAISE EXCEPTION 'deletion_in_progress'; END IF;
  RETURN c;
END $$;
CREATE FUNCTION public.check_google_mailbox(p_connection uuid,p_generation uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN PERFORM public.lock_google_mailbox(p_connection,p_generation); RETURN true; END $$;

-- Guard all persisted Google message content, including obsolete workers and direct API writes.
-- Existing lead conversion may change contact_id; account switching may detach connection_id.
CREATE FUNCTION public.guard_google_message_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c public.user_email_connections;
BEGIN
  IF TG_OP='UPDATE' AND (OLD.provider='google' OR NEW.provider='google') THEN
    IF (to_jsonb(NEW)-ARRAY['contact_id','connection_id','updated_at'])=(to_jsonb(OLD)-ARRAY['contact_id','connection_id','updated_at'])
      AND (NEW.connection_id IS NOT DISTINCT FROM OLD.connection_id OR NEW.connection_id IS NULL) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'google_message_content_is_immutable';
  END IF;
  IF NEW.provider<>'google' THEN RETURN NEW; END IF;
  c:=public.lock_google_mailbox(NEW.connection_id,NEW.google_connection_generation,NEW.delivery_status='failed');
  IF NEW.organization_id IS DISTINCT FROM c.organization_id OR NEW.owner_user_id IS DISTINCT FROM c.user_id
    OR lower(NEW.source_account_email) IS DISTINCT FROM lower(c.provider_account_email) THEN RAISE EXCEPTION 'mailbox_scope_changed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_google_message_write BEFORE INSERT OR UPDATE ON public.contact_emails FOR EACH ROW EXECUTE FUNCTION public.guard_google_message_write();

-- Derived copies need a still-live message and its original connection epoch.
CREATE FUNCTION public.guard_google_derived_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE message_id uuid; m public.contact_emails; c public.user_email_connections;
BEGIN
  IF TG_TABLE_NAME='notifications' THEN
    IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['read','dismissed_at'])=(to_jsonb(OLD)-ARRAY['read','dismissed_at']) THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND OLD.type='inbound_email' THEN RAISE EXCEPTION 'google_notification_content_is_immutable'; END IF;
    IF NEW.type<>'inbound_email' THEN RETURN NEW; END IF;
    IF NEW.event_key IS NULL OR NEW.event_key !~ '^inbound_email:[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'google_message_provenance_required'; END IF;
    message_id:=substring(NEW.event_key from 15)::uuid;
  ELSE
    IF TG_OP='UPDATE' AND OLD.action IN ('email sent','email send failed') AND OLD.metadata->>'provider'='google' THEN RAISE EXCEPTION 'google_activity_content_is_immutable'; END IF;
    IF NEW.action NOT IN ('email sent','email send failed') OR NEW.metadata->>'provider' IS DISTINCT FROM 'google' THEN RETURN NEW; END IF;
    message_id:=(NEW.metadata->>'contact_email_id')::uuid;
  END IF;
  SELECT * INTO m FROM public.contact_emails WHERE id=message_id AND organization_id=NEW.organization_id AND provider='google';
  IF m.id IS NULL THEN RAISE EXCEPTION 'google_message_provenance_required'; END IF;
  c:=public.lock_google_mailbox(m.connection_id,m.google_connection_generation,m.delivery_status='failed');
  -- Recheck after acquiring the lifecycle locks, which serialize against erasure.
  IF NOT EXISTS(SELECT 1 FROM public.contact_emails WHERE id=m.id AND organization_id=c.organization_id AND owner_user_id=c.user_id AND google_connection_generation=c.connection_generation) THEN RAISE EXCEPTION 'connection_changed'; END IF;
  IF TG_TABLE_NAME='activity_logs' AND NEW.user_id IS DISTINCT FROM c.user_id THEN RAISE EXCEPTION 'mailbox_scope_changed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_google_notification_write BEFORE INSERT OR UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.guard_google_derived_write();
CREATE TRIGGER guard_google_activity_write BEFORE INSERT OR UPDATE ON public.activity_logs FOR EACH ROW EXECUTE FUNCTION public.guard_google_derived_write();

CREATE FUNCTION public.persist_google_email_notifications(p_connection uuid,p_generation uuid,p_message uuid,p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c public.user_email_connections; result integer;
BEGIN
  c:=public.lock_google_mailbox(p_connection,p_generation);
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>500 THEN RAISE EXCEPTION 'invalid_notifications'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.contact_emails WHERE id=p_message AND connection_id=c.id AND google_connection_generation=p_generation AND organization_id=c.organization_id AND owner_user_id=c.user_id) THEN RAISE EXCEPTION 'connection_changed'; END IF;
  INSERT INTO public.notifications(user_id,type,title,body,action_url,action_label,organization_id,metadata,read,event_key)
    SELECT (r->>'user_id')::uuid,'inbound_email','New Email',r->>'body',r->>'action_url','View Contact',c.organization_id,r->'metadata',false,'inbound_email:'||p_message::text
    FROM jsonb_array_elements(p_rows) r JOIN public.profiles p ON p.id=(r->>'user_id')::uuid AND p.organization_id=c.organization_id AND lower(coalesce(p.status::text,''))<>'deleted'
    ON CONFLICT(user_id,event_key) DO NOTHING;
  GET DIAGNOSTICS result=ROW_COUNT; RETURN result;
END $$;

CREATE FUNCTION public.persist_google_outbound_email(p_connection uuid,p_generation uuid,p_message jsonb,p_user_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c public.user_email_connections; result uuid;
BEGIN
  c:=public.lock_google_mailbox(p_connection,p_generation,p_message->>'delivery_status'='failed');
  INSERT INTO public.contact_emails(organization_id,contact_id,owner_user_id,connection_id,provider,direction,external_message_id,thread_id,internet_message_id,from_email,source_account_email,to_emails,subject,body_text,sent_at,delivery_status,provider_error,google_connection_generation)
    VALUES(c.organization_id,(p_message->>'contact_id')::uuid,c.user_id,c.id,'google','outbound',p_message->>'external_message_id',p_message->>'thread_id',p_message->>'internet_message_id',c.provider_account_email,c.provider_account_email,p_message->'to_emails',p_message->>'subject',p_message->>'body_text',(p_message->>'sent_at')::timestamptz,p_message->>'delivery_status',p_message->>'provider_error',c.connection_generation)
    ON CONFLICT(organization_id,owner_user_id,provider,source_account_email,external_message_id) DO NOTHING RETURNING id INTO result;
  IF result IS NOT NULL THEN
    INSERT INTO public.activity_logs(action,category,organization_id,user_id,user_name,metadata)
      VALUES(CASE WHEN p_message->>'delivery_status'='sent' THEN 'email sent' ELSE 'email send failed' END,'contacts',c.organization_id,c.user_id,p_user_name,
        jsonb_build_object('provider','google','connection_id',c.id,'contact_email_id',result,'contact_id',p_message->>'contact_id','delivery_status',p_message->>'delivery_status'));
  END IF;
  RETURN result;
END $$;

-- No content or tokens in the manifest. Oversized/ambiguous inventories fail closed.
CREATE FUNCTION public.google_mailbox_deletion_manifest(p_org uuid,p_user uuid,p_mailbox text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE messages jsonb; notifications jsonb; activities jsonb; gaps jsonb; generation uuid;
BEGIN
  IF p_org IS NULL OR p_user IS NULL OR nullif(trim(p_mailbox),'') IS NULL OR p_mailbox<>lower(trim(p_mailbox)) OR position('@' in p_mailbox)<2 THEN RAISE EXCEPTION 'invalid_deletion_scope'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user AND organization_id=p_org) THEN RAISE EXCEPTION 'invalid_deletion_scope'; END IF;
  SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO messages FROM (SELECT id FROM public.contact_emails WHERE organization_id=p_org AND owner_user_id=p_user AND provider='google' AND lower(source_account_email)=p_mailbox ORDER BY id LIMIT 10001) x;
  SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO notifications FROM (SELECT n.id FROM public.notifications n WHERE n.organization_id=p_org AND n.event_key IN (SELECT 'inbound_email:'||value FROM jsonb_array_elements_text(messages)) ORDER BY n.id LIMIT 10001) x;
  SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO activities FROM (SELECT a.id FROM public.activity_logs a WHERE a.organization_id=p_org AND a.user_id=p_user AND a.metadata->>'provider'='google' AND a.metadata->>'contact_email_id' IN (SELECT value FROM jsonb_array_elements_text(messages)) ORDER BY a.id LIMIT 10001) x;
  gaps:=jsonb_build_object(
    'unknown_mailbox',(SELECT count(*) FROM public.contact_emails WHERE organization_id=p_org AND owner_user_id=p_user AND provider='google' AND nullif(trim(source_account_email),'') IS NULL),
    'unverified_legacy_messages',(SELECT count(*) FROM public.contact_emails WHERE organization_id=p_org AND owner_user_id=p_user AND provider='google' AND lower(source_account_email)=p_mailbox AND google_connection_generation IS NULL),
    'unlinked_activities',(SELECT count(*) FROM public.activity_logs a WHERE a.organization_id=p_org AND a.user_id=p_user AND a.action IN ('email sent','email send failed') AND a.metadata->>'provider'='google' AND NOT EXISTS(SELECT 1 FROM public.contact_emails m WHERE m.id::text=a.metadata->>'contact_email_id' AND m.organization_id=p_org AND m.owner_user_id=p_user AND m.provider='google')),
    'unlinked_notifications',(SELECT count(*) FROM public.notifications n WHERE n.organization_id=p_org AND n.type='inbound_email' AND NOT EXISTS(SELECT 1 FROM public.contact_emails m WHERE 'inbound_email:'||m.id::text=n.event_key AND m.organization_id=p_org AND m.provider='google')));
  SELECT connection_generation INTO generation FROM public.user_email_connections WHERE organization_id=p_org AND user_id=p_user AND provider='google' AND lower(provider_account_email)=p_mailbox;
  RETURN jsonb_build_object('version',1,'organization_id',p_org,'user_id',p_user,'mailbox',p_mailbox,'connection_generation',generation,'messages',messages,'notifications',notifications,'activities',activities,'gaps',gaps,'oversized',greatest(jsonb_array_length(messages),jsonb_array_length(notifications),jsonb_array_length(activities))>10000);
END $$;

CREATE FUNCTION public.begin_google_mailbox_deletion(p_request jsonb,p_manifest jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE rid uuid:=(p_request->>'id')::uuid; uid uuid:=(p_request->>'user_id')::uuid;
  org uuid:=(p_request->>'organization_id')::uuid; mailbox text:=p_request->>'mailbox';
  existing public.google_mailbox_deletion_requests; current_manifest jsonb; c public.user_email_connections;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id=uid AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_deletion_scope'; END IF;
  SELECT * INTO c FROM public.user_email_connections WHERE user_id=uid AND provider='google' FOR UPDATE;
  SELECT * INTO existing FROM public.google_mailbox_deletion_requests WHERE id=rid FOR UPDATE;
  IF existing.id IS NOT NULL THEN
    IF existing.organization_id IS DISTINCT FROM org OR existing.user_id IS DISTINCT FROM uid OR existing.mailbox IS DISTINCT FROM mailbox OR existing.manifest IS DISTINCT FROM p_manifest THEN RAISE EXCEPTION 'request_scope_changed'; END IF;
    RETURN existing.status;
  END IF;
  IF p_request->'holds_reviewed' IS DISTINCT FROM 'true'::jsonb OR (p_request->>'verified_at')::timestamptz>now() THEN RAISE EXCEPTION 'verified_request_required'; END IF;
  current_manifest:=public.google_mailbox_deletion_manifest(org,uid,mailbox);
  IF current_manifest IS DISTINCT FROM p_manifest THEN RAISE EXCEPTION 'manifest_changed'; END IF;
  IF (current_manifest->>'oversized')::boolean OR EXISTS(SELECT 1 FROM jsonb_each_text(current_manifest->'gaps') WHERE value::bigint<>0) THEN RAISE EXCEPTION 'manual_provenance_review_required'; END IF;
  INSERT INTO public.google_mailbox_deletion_requests(id,organization_id,user_id,mailbox,received_at,verified_at,due_at,authority_ref,operator_ref,ledger_ref,manifest)
    VALUES(rid,org,uid,mailbox,(p_request->>'received_at')::timestamptz,(p_request->>'verified_at')::timestamptz,(p_request->>'due_at')::timestamptz,p_request->>'authority_ref',p_request->>'operator_ref',p_request->>'ledger_ref',p_manifest);
  IF c.id IS NOT NULL AND c.organization_id=org AND lower(c.provider_account_email)=mailbox THEN
    UPDATE public.user_email_connections SET status='disconnected',access_token_encrypted='',refresh_token_encrypted=NULL,access_token_expires_at=NULL,provider_account_name=NULL,last_error=NULL,last_sync_at=NULL,connection_generation=gen_random_uuid() WHERE id=c.id;
    DELETE FROM public.email_sync_cursors WHERE connection_id=c.id;
  END IF;
  DELETE FROM public.email_oauth_states WHERE user_id=uid AND organization_id=org AND provider='google' AND integration_kind='email';
  RETURN 'pending';
END $$;

CREATE FUNCTION public.erase_google_mailbox_batch(p_request uuid,p_manifest jsonb,p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE r public.google_mailbox_deletion_requests; uid uuid; n integer; a integer; m integer; remaining jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_batch_limit'; END IF;
  SELECT user_id INTO uid FROM public.google_mailbox_deletion_requests WHERE id=p_request;
  PERFORM 1 FROM public.profiles WHERE id=uid FOR UPDATE;
  PERFORM 1 FROM public.user_email_connections WHERE user_id=uid AND provider='google' FOR UPDATE;
  SELECT * INTO r FROM public.google_mailbox_deletion_requests WHERE id=p_request FOR UPDATE;
  IF r.id IS NULL OR r.manifest IS DISTINCT FROM p_manifest THEN RAISE EXCEPTION 'request_scope_changed'; END IF;
  IF r.status='pending' THEN
    DELETE FROM public.notifications WHERE id IN (SELECT id FROM public.notifications WHERE organization_id=r.organization_id AND id::text IN (SELECT value FROM jsonb_array_elements_text(r.manifest->'notifications')) ORDER BY id LIMIT p_limit);
    GET DIAGNOSTICS n=ROW_COUNT;
    DELETE FROM public.activity_logs WHERE id IN (SELECT id FROM public.activity_logs WHERE organization_id=r.organization_id AND user_id=r.user_id AND id::text IN (SELECT value FROM jsonb_array_elements_text(r.manifest->'activities')) ORDER BY id LIMIT p_limit);
    GET DIAGNOSTICS a=ROW_COUNT;
    -- Retain messages until their snapshotted derived copies have gone (possibly multiple batches).
    DELETE FROM public.contact_emails WHERE id IN (SELECT e.id FROM public.contact_emails e WHERE e.organization_id=r.organization_id AND e.owner_user_id=r.user_id AND e.provider='google' AND lower(e.source_account_email)=r.mailbox AND e.id::text IN (SELECT value FROM jsonb_array_elements_text(r.manifest->'messages'))
      AND NOT EXISTS(SELECT 1 FROM public.notifications WHERE organization_id=r.organization_id AND event_key='inbound_email:'||e.id::text)
      AND NOT EXISTS(SELECT 1 FROM public.activity_logs WHERE organization_id=r.organization_id AND metadata->>'contact_email_id'=e.id::text) ORDER BY e.id LIMIT p_limit);
    GET DIAGNOSTICS m=ROW_COUNT;
    UPDATE public.google_mailbox_deletion_requests SET deleted_notifications=deleted_notifications+n,deleted_activities=deleted_activities+a,deleted_messages=deleted_messages+m WHERE id=r.id;
    remaining:=public.google_mailbox_deletion_manifest(r.organization_id,r.user_id,r.mailbox);
    IF EXISTS(SELECT 1 FROM jsonb_each_text(remaining->'gaps') WHERE value::bigint<>0) THEN RAISE EXCEPTION 'manual_provenance_review_required'; END IF;
    IF jsonb_array_length(remaining->'messages')+jsonb_array_length(remaining->'notifications')+jsonb_array_length(remaining->'activities')=0 THEN
      UPDATE public.google_mailbox_deletion_requests SET status='live_deleted',completed_at=now() WHERE id=r.id;
    ELSIF n+a+m=0 THEN RAISE EXCEPTION 'deletion_inventory_changed'; END IF;
  END IF;
  SELECT * INTO r FROM public.google_mailbox_deletion_requests WHERE id=p_request;
  RETURN jsonb_build_object('request_id',r.id,'status',r.status,'messages',r.deleted_messages,'notifications',r.deleted_notifications,'activities',r.deleted_activities,'completed_at',r.completed_at,'other_copies','pending_review','google_grant','not_revoked_by_local_erasure');
END $$;

CREATE OR REPLACE FUNCTION public.begin_google_oauth(p_user_id uuid, p_kind text, p_state text, p_redirect text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE org uuid; generation uuid; result uuid;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('email','calendar') THEN RAISE EXCEPTION 'invalid_integration'; END IF;
  SELECT organization_id INTO org FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF org IS NULL THEN RAISE EXCEPTION 'organization_changed'; END IF;
  PERFORM public.assert_google_user_available(p_user_id,p_kind);
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
  PERFORM public.assert_google_user_available(uid,s.integration_kind);
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

CREATE OR REPLACE FUNCTION public.persist_google_email_message(p_connection_id uuid, p_generation uuid, p_message jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c public.user_email_connections; result uuid;
BEGIN
  c:=public.lock_google_mailbox(p_connection_id,p_generation);
  INSERT INTO public.contact_emails(organization_id,contact_id,owner_user_id,connection_id,provider,direction,external_message_id,thread_id,internet_message_id,in_reply_to,reference_ids,from_email,to_emails,cc_emails,subject,body_text,body_html,received_at,delivery_status,source_account_email,google_connection_generation)
  VALUES(c.organization_id,(p_message->>'contact_id')::uuid,c.user_id,c.id,'google','inbound',p_message->>'external_message_id',p_message->>'thread_id',p_message->>'internet_message_id',p_message->>'in_reply_to',p_message->>'reference_ids',p_message->>'from_email',p_message->'to_emails',p_message->'cc_emails',p_message->>'subject',p_message->>'body_text',p_message->>'body_html',(p_message->>'received_at')::timestamptz,'received',c.provider_account_email,c.connection_generation)
  ON CONFLICT (organization_id,owner_user_id,provider,source_account_email,external_message_id) DO NOTHING RETURNING id INTO result;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.advance_google_email_cursor(p_connection_id uuid, p_generation uuid, p_cursor text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c public.user_email_connections;
BEGIN
  c:=public.lock_google_mailbox(p_connection_id,p_generation);
  INSERT INTO public.email_sync_cursors(organization_id,connection_id,provider,cursor_value,cursor_updated_at)
  VALUES(c.organization_id,c.id,'google',p_cursor,now()) ON CONFLICT(connection_id) DO UPDATE SET cursor_value=excluded.cursor_value,cursor_updated_at=excluded.cursor_updated_at;
  UPDATE public.user_email_connections SET last_sync_at=now(),last_error=NULL WHERE id=c.id;
END $$;


DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'assert_google_user_available','lock_google_mailbox','check_google_mailbox','guard_google_message_write',
      'guard_google_derived_write','persist_google_email_notifications','persist_google_outbound_email',
      'google_mailbox_deletion_manifest','begin_google_mailbox_deletion','erase_google_mailbox_batch')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
  END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
