-- SMS policy is opt-in per agency. No agency is activated by this migration.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE public.sms_agency_policies (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  enforced boolean NOT NULL DEFAULT false,
  send_enabled boolean NOT NULL DEFAULT false,
  uv_profile_id uuid NOT NULL,
  uv_project text NOT NULL CHECK(uv_project='jzdzeevjpootbeuniygx'),
  sender_name text NOT NULL,
  selected_phone_ids uuid[] NOT NULL DEFAULT '{}',
  active_from timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(NOT send_enabled OR (enforced AND active_from IS NOT NULL AND cardinality(selected_phone_ids)>0))
);
CREATE FUNCTION private.preserve_sms_enforcement() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.enforced AND (TG_OP='DELETE' OR NOT NEW.enforced OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.uv_profile_id IS DISTINCT FROM OLD.uv_profile_id OR NEW.uv_project IS DISTINCT FROM OLD.uv_project) THEN
    RAISE EXCEPTION 'sms_enforcement_cannot_be_removed';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.preserve_sms_enforcement() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER preserve_sms_enforcement BEFORE UPDATE OR DELETE ON public.sms_agency_policies FOR EACH ROW EXECUTE FUNCTION private.preserve_sms_enforcement();

CREATE TABLE public.sms_bridge_nonces(nonce uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.sms_suppressions (
  organization_id uuid NOT NULL REFERENCES public.organizations(id), phone_e164 text NOT NULL,
  reason text NOT NULL CHECK(reason IN ('stop','provider_block')), source_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), synced_at timestamptz,
  sync_attempts integer NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,phone_e164), CHECK(phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$')
);
CREATE TABLE public.sms_suppression_events (
  organization_id uuid NOT NULL, source_id text NOT NULL, phone_e164 text NOT NULL,
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,source_id)
);
CREATE TABLE public.sms_consent_inbox (
  organization_id uuid NOT NULL, request_id uuid NOT NULL, payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,request_id)
);
CREATE TABLE public.sms_enrollments (
  organization_id uuid NOT NULL, phone_e164 text NOT NULL,
  informational_event uuid, marketing_event uuid,
  informational_confirmed boolean NOT NULL DEFAULT false, marketing_confirmed boolean NOT NULL DEFAULT false,
  PRIMARY KEY(organization_id,phone_e164)
);
CREATE TABLE public.sms_confirmation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, phone_e164 text NOT NULL,
  request_id uuid NOT NULL, purposes text[] NOT NULL, evidence_ids uuid[] NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','blocked','uncertain','failed')),
  retry_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_id uuid,
  attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,request_id)
);
CREATE TABLE public.sms_dispatches (
  organization_id uuid NOT NULL, request_key text NOT NULL, payload_hash text NOT NULL,
  phone_e164 text NOT NULL, from_number text NOT NULL, body text NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('informational','marketing')),
  actor_id uuid, contact_id uuid, contact_type text, confirmation_id uuid REFERENCES public.sms_confirmation_jobs(id),
  evidence_ids uuid[] NOT NULL, state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','attempting','accepted','failed','uncertain')),
  provider_sid text, provider_status text, message_id uuid, error_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,request_key), CHECK(length(request_key) BETWEEN 1 AND 160), CHECK(length(body) BETWEEN 1 AND 1600)
);
CREATE INDEX sms_jobs_pending ON public.sms_confirmation_jobs(retry_at) WHERE state='pending';

-- Narrow new service entry; existing DNC helper ACLs and bodies remain unchanged.
GRANT USAGE ON SCHEMA private TO service_role;
CREATE FUNCTION private.sms_recipient_guard(p_org uuid,p_phone text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(private.dnc_phone_lock_key(p_org,p_phone));
  RETURN private.is_dnc_phone(p_org,p_phone) OR EXISTS(SELECT 1 FROM public.sms_suppressions WHERE organization_id=p_org AND phone_e164=p_phone);
END $$;
REVOKE ALL ON FUNCTION private.sms_recipient_guard(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.sms_recipient_guard(uuid,text) TO service_role;

CREATE FUNCTION public.sms_record_suppression(p_org uuid,p_phone text,p_reason text,p_source text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_phone text:='+'||private.phone_digits_e164ish(p_phone);
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.sms_agency_policies WHERE organization_id=p_org AND enforced) THEN RAISE EXCEPTION 'sms_not_enrolled'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('stop','provider_block') OR p_source IS NULL OR length(p_source) NOT BETWEEN 1 AND 160
    OR v_phone !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' THEN RAISE EXCEPTION 'sms_input'; END IF;
  PERFORM private.sms_recipient_guard(p_org,v_phone);
  IF EXISTS(SELECT 1 FROM public.sms_suppression_events WHERE organization_id=p_org AND source_id=p_source
    AND (phone_e164<>v_phone OR reason<>p_reason)) THEN RAISE EXCEPTION 'sms_event_conflict'; END IF;
  INSERT INTO public.sms_suppression_events(organization_id,source_id,phone_e164,reason) VALUES(p_org,p_source,v_phone,p_reason) ON CONFLICT DO NOTHING;
  INSERT INTO public.sms_suppressions(organization_id,phone_e164,reason,source_id) VALUES(p_org,v_phone,p_reason,p_source) ON CONFLICT DO NOTHING;
  UPDATE public.sms_confirmation_jobs SET state='blocked' WHERE organization_id=p_org AND phone_e164=v_phone AND state='pending';
END $$;

CREATE FUNCTION public.sms_ingest_consent(p_org uuid,p_profile uuid,p_request uuid,p_phone text,p_events jsonb,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_policy public.sms_agency_policies; v_enroll public.sms_enrollments; v_event jsonb; v_purposes text[]:='{}'; v_ids uuid[]:='{}'; v_phone text:='+'||private.phone_digits_e164ish(p_phone);
BEGIN
  SELECT * INTO v_policy FROM public.sms_agency_policies WHERE organization_id=p_org AND uv_profile_id=p_profile AND enforced;
  IF NOT FOUND OR v_policy.active_from IS NULL THEN RAISE EXCEPTION 'sms_mapping'; END IF;
  IF v_phone !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' OR jsonb_array_length(p_events)<>2
    OR (SELECT count(DISTINCT e->>'purpose') FROM jsonb_array_elements(p_events)e WHERE e->>'purpose' IN ('informational','marketing'))<>2 THEN RAISE EXCEPTION 'sms_event'; END IF;
  PERFORM private.sms_recipient_guard(p_org,v_phone);
  IF EXISTS(SELECT 1 FROM public.sms_consent_inbox WHERE organization_id=p_org AND request_id=p_request) THEN
    IF NOT EXISTS(SELECT 1 FROM public.sms_consent_inbox WHERE organization_id=p_org AND request_id=p_request AND payload_hash=p_hash) THEN RAISE EXCEPTION 'sms_event_conflict'; END IF;
    RETURN;
  END IF;
  INSERT INTO public.sms_consent_inbox(organization_id,request_id,payload_hash) VALUES(p_org,p_request,p_hash);
  INSERT INTO public.sms_enrollments(organization_id,phone_e164) VALUES(p_org,v_phone) ON CONFLICT DO NOTHING;
  SELECT * INTO v_enroll FROM public.sms_enrollments WHERE organization_id=p_org AND phone_e164=v_phone FOR UPDATE;
  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    IF v_event->>'choice' IS NULL OR v_event->>'choice' NOT IN ('granted','not_granted') OR v_event->>'id' IS NULL OR v_event->>'version' IS NULL OR v_event->>'created_at' IS NULL THEN RAISE EXCEPTION 'sms_event'; END IF;
    -- No backlog enrollment or stale confirmation replay across the activation boundary.
    IF (v_event->>'created_at')::timestamptz < v_policy.active_from OR (v_event->>'created_at')::timestamptz > now()+interval '1 minute' THEN CONTINUE; END IF;
    IF v_event->>'choice'='granted' THEN
      IF v_event->>'purpose'='informational' AND v_enroll.informational_event IS NULL THEN
        UPDATE public.sms_enrollments SET informational_event=(v_event->>'id')::uuid WHERE organization_id=p_org AND phone_e164=v_phone;
        v_purposes:=array_append(v_purposes,'informational'); v_ids:=array_append(v_ids,(v_event->>'id')::uuid);
      ELSIF v_event->>'purpose'='marketing' AND v_enroll.marketing_event IS NULL THEN
        UPDATE public.sms_enrollments SET marketing_event=(v_event->>'id')::uuid WHERE organization_id=p_org AND phone_e164=v_phone;
        v_purposes:=array_append(v_purposes,'marketing'); v_ids:=array_append(v_ids,(v_event->>'id')::uuid);
      END IF;
    END IF;
  END LOOP;
  IF cardinality(v_purposes)>0 THEN
    INSERT INTO public.sms_confirmation_jobs(organization_id,phone_e164,request_id,purposes,evidence_ids,state,created_at)
      VALUES(p_org,v_phone,p_request,v_purposes,v_ids,CASE WHEN EXISTS(SELECT 1 FROM public.sms_suppressions WHERE organization_id=p_org AND phone_e164=v_phone) OR private.sms_recipient_guard(p_org,v_phone) THEN 'blocked' ELSE 'pending' END,(SELECT min((e->>'created_at')::timestamptz) FROM jsonb_array_elements(p_events)e));
  END IF;
END $$;

CREATE FUNCTION public.sms_prepare_dispatch(p_org uuid,p_key text,p_phone text,p_from text,p_body text,p_purpose text,p_hash text,p_evidence uuid[],p_actor uuid DEFAULT NULL,p_contact uuid DEFAULT NULL,p_type text DEFAULT NULL,p_confirmation uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_policy public.sms_agency_policies; v_row public.sms_dispatches;
BEGIN
  SELECT * INTO v_policy FROM public.sms_agency_policies WHERE organization_id=p_org AND enforced;
  IF NOT FOUND OR NOT v_policy.send_enabled THEN RAISE EXCEPTION 'sms_paused'; END IF;
  IF p_phone !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' OR p_purpose IS NULL OR p_purpose NOT IN ('informational','marketing') OR coalesce(cardinality(p_evidence),0)=0 THEN RAISE EXCEPTION 'sms_permission'; END IF;
  PERFORM private.sms_recipient_guard(p_org,p_phone);
  SELECT * INTO v_row FROM public.sms_dispatches WHERE organization_id=p_org AND request_key=p_key FOR UPDATE;
  IF FOUND THEN
    IF v_row.payload_hash<>p_hash THEN RAISE EXCEPTION 'sms_request_conflict'; END IF;
    RETURN to_jsonb(v_row);
  END IF;
  IF private.sms_recipient_guard(p_org,p_phone) OR EXISTS(SELECT 1 FROM public.sms_suppressions WHERE organization_id=p_org AND phone_e164=p_phone) THEN RAISE EXCEPTION 'sms_suppressed'; END IF;
  IF p_confirmation IS NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.sms_enrollments WHERE organization_id=p_org AND phone_e164=p_phone AND
      CASE p_purpose WHEN 'informational' THEN informational_confirmed ELSE marketing_confirmed END) THEN RAISE EXCEPTION 'sms_confirmation_pending'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.sms_confirmation_jobs WHERE id=p_confirmation AND organization_id=p_org AND phone_e164=p_phone AND state='pending' AND created_at>=now()-interval '30 minutes' AND evidence_ids=p_evidence) THEN RAISE EXCEPTION 'sms_confirmation_scope'; END IF;
  INSERT INTO public.sms_dispatches(organization_id,request_key,payload_hash,phone_e164,from_number,body,purpose,evidence_ids,actor_id,contact_id,contact_type,confirmation_id)
  VALUES(p_org,p_key,p_hash,p_phone,p_from,p_body,p_purpose,p_evidence,p_actor,p_contact,p_type,p_confirmation) RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

CREATE FUNCTION public.sms_start_dispatch(p_org uuid,p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_row public.sms_dispatches;
BEGIN
  SELECT * INTO STRICT v_row FROM public.sms_dispatches WHERE organization_id=p_org AND request_key=p_key;
  PERFORM private.sms_recipient_guard(p_org,v_row.phone_e164);
  IF NOT EXISTS(SELECT 1 FROM public.sms_agency_policies WHERE organization_id=p_org AND enforced AND send_enabled AND EXISTS(SELECT 1 FROM public.phone_numbers n WHERE n.organization_id=p_org AND n.phone_number=v_row.from_number AND n.id=ANY(selected_phone_ids) AND n.status IN ('active','Active')))
    OR private.sms_recipient_guard(p_org,v_row.phone_e164) OR EXISTS(SELECT 1 FROM public.sms_suppressions WHERE organization_id=p_org AND phone_e164=v_row.phone_e164) THEN RAISE EXCEPTION 'sms_suppressed_or_paused'; END IF;
  IF v_row.confirmation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sms_confirmation_jobs WHERE id=v_row.confirmation_id AND state='pending' AND created_at>=now()-interval '30 minutes') THEN RAISE EXCEPTION 'sms_confirmation_expired'; END IF;
  UPDATE public.sms_dispatches SET state='attempting',updated_at=now() WHERE organization_id=p_org AND request_key=p_key AND state='prepared';
  RETURN FOUND;
END $$;

CREATE FUNCTION public.sms_finish_dispatch(p_org uuid,p_key text,p_state text,p_sid text,p_status text,p_error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_row public.sms_dispatches; v_message uuid; v_purposes text[];
BEGIN
  SELECT * INTO STRICT v_row FROM public.sms_dispatches WHERE organization_id=p_org AND request_key=p_key FOR UPDATE;
  IF v_row.state='accepted' THEN RETURN to_jsonb(v_row); END IF;
  IF v_row.state NOT IN ('attempting','uncertain') OR p_state NOT IN ('accepted','uncertain','failed') THEN RAISE EXCEPTION 'sms_receipt_state'; END IF;
  IF p_state='accepted' THEN
    IF p_sid IS NULL OR p_sid !~ '^SM[0-9a-fA-F]{32}$' OR p_status IS NULL THEN RAISE EXCEPTION 'sms_provider_receipt'; END IF;
    INSERT INTO public.messages(organization_id,direction,body,from_number,to_number,status,provider_message_id,created_by,sent_at,contact_id,contact_type,lead_id)
    VALUES(p_org,'outbound',v_row.body,v_row.from_number,v_row.phone_e164,p_status,p_sid,v_row.actor_id,now(),v_row.contact_id,v_row.contact_type,CASE WHEN v_row.contact_type='lead' THEN v_row.contact_id END) RETURNING id INTO v_message;
    IF v_row.confirmation_id IS NOT NULL THEN
      UPDATE public.sms_confirmation_jobs SET state='accepted' WHERE id=v_row.confirmation_id RETURNING purposes INTO v_purposes;
      UPDATE public.sms_enrollments SET informational_confirmed=informational_confirmed OR 'informational'=ANY(v_purposes),
        marketing_confirmed=marketing_confirmed OR 'marketing'=ANY(v_purposes) WHERE organization_id=p_org AND phone_e164=v_row.phone_e164;
    END IF;
  ELSIF v_row.confirmation_id IS NOT NULL THEN UPDATE public.sms_confirmation_jobs SET state=p_state WHERE id=v_row.confirmation_id; END IF;
  UPDATE public.sms_dispatches SET state=p_state,provider_sid=p_sid,provider_status=p_status,message_id=v_message,error_code=p_error,updated_at=now()
    WHERE organization_id=p_org AND request_key=p_key RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

CREATE FUNCTION public.sms_claim_confirmations() RETURNS SETOF public.sms_confirmation_jobs
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  UPDATE public.sms_confirmation_jobs SET state='blocked' WHERE state='pending' AND created_at<now()-interval '30 minutes';
  RETURN QUERY UPDATE public.sms_confirmation_jobs j SET lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=j.attempts+1
  WHERE j.id IN(SELECT q.id FROM public.sms_confirmation_jobs q JOIN public.sms_agency_policies p USING(organization_id)
    WHERE p.enforced AND p.send_enabled AND q.state='pending' AND q.retry_at<=now() AND q.attempts<8
      AND (q.lease_until IS NULL OR q.lease_until<now()) ORDER BY q.created_at LIMIT 2 FOR UPDATE OF q SKIP LOCKED)
  RETURNING j.*;
END $$;

-- Browser access stays through authenticated, org-scoped Edge functions only.
DO $$ DECLARE t text; f record; BEGIN
  FOREACH t IN ARRAY ARRAY['sms_agency_policies','sms_bridge_nonces','sms_suppressions','sms_suppression_events','sms_consent_inbox','sms_enrollments','sms_confirmation_jobs','sms_dispatches'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
  END LOOP;
  GRANT DELETE ON public.sms_bridge_nonces TO service_role;
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('sms_record_suppression','sms_ingest_consent','sms_prepare_dispatch','sms_start_dispatch','sms_finish_dispatch','sms_claim_confirmations') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;

-- Evidence identity is immutable; suppression synchronization may only advance its checkpoint.
CREATE FUNCTION private.sms_evidence_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_TABLE_NAME='sms_suppressions' AND TG_OP='UPDATE' THEN
    IF (NEW.organization_id,NEW.phone_e164,NEW.reason,NEW.source_id,NEW.created_at) IS NOT DISTINCT FROM
    (OLD.organization_id,OLD.phone_e164,OLD.reason,OLD.source_id,OLD.created_at) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'sms_evidence_immutable';
END $$;
REVOKE ALL ON FUNCTION private.sms_evidence_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sms_suppression_immutable BEFORE UPDATE OR DELETE ON public.sms_suppressions FOR EACH ROW EXECUTE FUNCTION private.sms_evidence_immutable();
CREATE TRIGGER sms_event_immutable BEFORE UPDATE OR DELETE ON public.sms_suppression_events FOR EACH ROW EXECUTE FUNCTION private.sms_evidence_immutable();
CREATE TRIGGER sms_inbox_immutable BEFORE UPDATE OR DELETE ON public.sms_consent_inbox FOR EACH ROW EXECUTE FUNCTION private.sms_evidence_immutable();

-- pg_net defers transmission until transaction commit; recovery cron is separately activated.
CREATE FUNCTION private.wake_sms_worker() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_secret text;
BEGIN
  BEGIN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1' INTO v_secret USING 'sms_consent_worker_token';
    IF length(v_secret)>=32 THEN
      EXECUTE 'SELECT net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 2000)'
      USING 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/sms-consent-worker',
        jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),'{}'::jsonb;
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'sms_worker_wake_failed'; END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.wake_sms_worker() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sms_confirmation_wake AFTER INSERT ON public.sms_confirmation_jobs FOR EACH ROW EXECUTE FUNCTION private.wake_sms_worker();
CREATE TRIGGER sms_suppression_wake AFTER INSERT ON public.sms_suppressions FOR EACH ROW EXECUTE FUNCTION private.wake_sms_worker();

-- Purpose metadata is explicit review, never inferred from template text.
ALTER TABLE public.message_templates ADD COLUMN sms_purpose text CHECK(sms_purpose IN ('informational','marketing'));

CREATE FUNCTION public.sms_recipient_blocked(p_org uuid,p_phone text) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.sms_recipient_guard(p_org,p_phone); $$;
REVOKE ALL ON FUNCTION public.sms_recipient_blocked(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_recipient_blocked(uuid,text) TO service_role;
