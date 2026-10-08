-- Forward-only, disabled by default. STOP evidence is never deleted or rewritten.
ALTER TABLE public.sms_agency_policies
  ADD COLUMN start_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN start_active_from timestamptz,
  ADD CONSTRAINT sms_start_activation CHECK (NOT start_enabled OR start_active_from IS NOT NULL);

CREATE TABLE public.sms_keyword_jobs (
  organization_id uuid NOT NULL REFERENCES public.sms_agency_policies(organization_id),
  message_sid text NOT NULL CHECK(message_sid ~ '^SM[0-9a-fA-F]{32}$'),
  phone_e164 text NOT NULL,
  keyword text NOT NULL CHECK(keyword IN ('STOP','START')),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  verified_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  retry_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,message_sid)
);
CREATE INDEX sms_keyword_jobs_pending ON public.sms_keyword_jobs(retry_at) WHERE verified_at IS NULL;
CREATE TABLE public.sms_keyword_events (
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  message_sid text NOT NULL,
  phone_e164 text NOT NULL,
  to_number text NOT NULL,
  keyword text NOT NULL CHECK(keyword IN ('STOP','START')),
  occurred_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,message_sid),
  FOREIGN KEY(organization_id,message_sid) REFERENCES public.sms_keyword_jobs(organization_id,message_sid)
);
CREATE INDEX sms_keyword_events_recipient ON public.sms_keyword_events(organization_id,phone_e164,occurred_at);
CREATE TABLE public.sms_recipient_lifecycle (
  organization_id uuid NOT NULL REFERENCES public.sms_agency_policies(organization_id),
  phone_e164 text NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  synced_revision bigint NOT NULL DEFAULT 0,
  synced_at timestamptz,
  informational_restored boolean NOT NULL DEFAULT false,
  start_event_id uuid REFERENCES public.sms_keyword_events(id),
  prior_consent_event uuid,
  first_stop_at timestamptz,
  start_at timestamptz,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retry_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,phone_e164)
);
CREATE INDEX sms_lifecycle_pending ON public.sms_recipient_lifecycle(retry_at) WHERE revision>synced_revision;
CREATE INDEX sms_lifecycle_start_evidence ON public.sms_recipient_lifecycle(start_event_id);

-- Reuse the existing DNC serialization boundary, without granting its private helpers.
CREATE FUNCTION public.sms_lifecycle_refresh(p_org uuid,p_phone text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sms_agency_policies; v_start public.sms_keyword_events; e public.sms_enrollments;
  v_first timestamptz; v_last timestamptz; v_safe boolean := false;
BEGIN
  PERFORM private.sms_recipient_guard(p_org,p_phone);
  SELECT * INTO STRICT p FROM public.sms_agency_policies WHERE organization_id=p_org AND enforced;
  SELECT * INTO e FROM public.sms_enrollments WHERE organization_id=p_org AND phone_e164=p_phone;
  SELECT min(k.occurred_at),max(k.occurred_at) INTO v_first,v_last
    FROM public.sms_suppression_events s LEFT JOIN public.sms_keyword_events k
      ON k.organization_id=s.organization_id AND 'inbound:'||k.message_sid=s.source_id
      AND k.phone_e164=s.phone_e164 AND k.keyword='STOP'
    WHERE s.organization_id=p_org AND s.phone_e164=p_phone;
  SELECT * INTO v_start FROM public.sms_keyword_events
    WHERE organization_id=p_org AND phone_e164=p_phone AND keyword='START'
      AND occurred_at>=p.start_active_from
    ORDER BY occurred_at DESC,message_sid DESC LIMIT 1;
  IF p.start_enabled AND e.informational_confirmed AND e.informational_event IS NOT NULL
    AND v_start.id IS NOT NULL AND v_last IS NOT NULL AND v_start.occurred_at>v_last
    AND NOT EXISTS (
      SELECT 1 FROM public.sms_suppression_events s LEFT JOIN public.sms_keyword_events proof
        ON proof.organization_id=s.organization_id AND 'inbound:'||proof.message_sid=s.source_id
        AND proof.phone_e164=s.phone_e164 AND proof.keyword='STOP'
      WHERE s.organization_id=p_org AND s.phone_e164=p_phone
        AND (s.reason<>'stop' OR proof.id IS NULL)) THEN
    v_safe := true;
  END IF;
  INSERT INTO public.sms_recipient_lifecycle(organization_id,phone_e164) VALUES(p_org,p_phone) ON CONFLICT DO NOTHING;
  UPDATE public.sms_recipient_lifecycle SET revision=revision+1, informational_restored=v_safe,
    start_event_id=CASE WHEN v_safe THEN v_start.id END,
    prior_consent_event=CASE WHEN v_safe THEN e.informational_event END,
    first_stop_at=CASE WHEN v_safe THEN v_first END, start_at=CASE WHEN v_safe THEN v_start.occurred_at END,
    synced_at=NULL,changed_at=clock_timestamp(),retry_at=now()
    WHERE organization_id=p_org AND phone_e164=p_phone;
END $$;

CREATE OR REPLACE FUNCTION public.sms_record_suppression(p_org uuid,p_phone text,p_reason text,p_source text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_phone text:='+'||private.phone_digits_e164ish(p_phone); v_new integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.sms_agency_policies WHERE organization_id=p_org AND enforced) THEN RAISE EXCEPTION 'sms_not_enrolled'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('stop','provider_block') OR p_source IS NULL OR length(p_source) NOT BETWEEN 1 AND 160
    OR v_phone !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' THEN RAISE EXCEPTION 'sms_input'; END IF;
  PERFORM private.sms_recipient_guard(p_org,v_phone);
  IF EXISTS(SELECT 1 FROM public.sms_suppression_events WHERE organization_id=p_org AND source_id=p_source
    AND (phone_e164<>v_phone OR reason<>p_reason)) THEN RAISE EXCEPTION 'sms_event_conflict'; END IF;
  INSERT INTO public.sms_suppression_events(organization_id,source_id,phone_e164,reason) VALUES(p_org,p_source,v_phone,p_reason) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_new=ROW_COUNT;
  INSERT INTO public.sms_suppressions(organization_id,phone_e164,reason,source_id) VALUES(p_org,v_phone,p_reason,p_source) ON CONFLICT DO NOTHING;
  UPDATE public.sms_confirmation_jobs SET state='blocked' WHERE organization_id=p_org AND phone_e164=v_phone AND state='pending';
  IF p_reason='stop' AND p_source ~ '^inbound:SM[0-9a-fA-F]{32}$' THEN
    INSERT INTO public.sms_keyword_jobs(organization_id,message_sid,phone_e164,keyword)
      VALUES(p_org,substring(p_source FROM 9),v_phone,'STOP') ON CONFLICT DO NOTHING;
  END IF;
  IF v_new=1 THEN PERFORM public.sms_lifecycle_refresh(p_org,v_phone); END IF;
END $$;

CREATE FUNCTION public.sms_receive_start(p_org uuid,p_phone text,p_sid text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_phone text:='+'||private.phone_digits_e164ish(p_phone);
BEGIN
  IF v_phone !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' OR p_sid IS NULL OR p_sid !~ '^SM[0-9a-fA-F]{32}$' THEN RAISE EXCEPTION 'sms_input'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sms_agency_policies WHERE organization_id=p_org AND enforced AND start_enabled AND start_active_from<=now()) THEN RETURN; END IF;
  PERFORM private.sms_recipient_guard(p_org,v_phone);
  IF NOT EXISTS(SELECT 1 FROM public.sms_suppressions WHERE organization_id=p_org AND phone_e164=v_phone) THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.sms_keyword_jobs WHERE organization_id=p_org AND message_sid=p_sid AND (phone_e164<>v_phone OR keyword<>'START')) THEN RAISE EXCEPTION 'sms_event_conflict'; END IF;
  INSERT INTO public.sms_keyword_jobs(organization_id,message_sid,phone_e164,keyword) VALUES(p_org,p_sid,v_phone,'START') ON CONFLICT DO NOTHING;
  -- Older STOP metadata may be verified, never older START or historical enrollment replay.
  INSERT INTO public.sms_keyword_jobs(organization_id,message_sid,phone_e164,keyword)
    SELECT p_org,substring(source_id FROM 9),v_phone,'STOP' FROM public.sms_suppression_events
    WHERE organization_id=p_org AND phone_e164=v_phone AND reason='stop' AND source_id ~ '^inbound:SM[0-9a-fA-F]{32}$'
    ON CONFLICT DO NOTHING;
END $$;

CREATE FUNCTION public.sms_verify_keyword(p_org uuid,p_sid text,p_phone text,p_to text,p_keyword text,p_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.sms_keyword_jobs; p public.sms_agency_policies; v_new integer;
BEGIN
  PERFORM private.sms_recipient_guard(p_org,p_phone);
  SELECT * INTO STRICT j FROM public.sms_keyword_jobs WHERE organization_id=p_org AND message_sid=p_sid;
  SELECT * INTO STRICT p FROM public.sms_agency_policies WHERE organization_id=p_org AND enforced;
  IF p_phone IS DISTINCT FROM j.phone_e164 OR p_keyword IS DISTINCT FROM j.keyword
    OR p_at IS NULL OR p_at>clock_timestamp()+interval '1 minute'
    OR NOT EXISTS(SELECT 1 FROM public.phone_numbers WHERE organization_id=p_org AND phone_number=p_to
      AND id=ANY(p.selected_phone_ids) AND assignment_type='agency' AND status IN ('active','Active'))
    OR (p_keyword='START' AND (NOT p.start_enabled OR p.start_active_from IS NULL OR p_at<p.start_active_from OR j.received_at<p.start_active_from))
    THEN RAISE EXCEPTION 'sms_keyword_scope'; END IF;
  IF EXISTS(SELECT 1 FROM public.sms_keyword_events WHERE organization_id=p_org AND message_sid=p_sid
    AND (phone_e164,to_number,keyword,occurred_at) IS DISTINCT FROM (p_phone,p_to,p_keyword,p_at)) THEN RAISE EXCEPTION 'sms_event_conflict'; END IF;
  INSERT INTO public.sms_keyword_events(organization_id,message_sid,phone_e164,to_number,keyword,occurred_at)
    VALUES(p_org,p_sid,p_phone,p_to,p_keyword,p_at) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_new=ROW_COUNT;
  UPDATE public.sms_keyword_jobs SET verified_at=clock_timestamp() WHERE organization_id=p_org AND message_sid=p_sid AND verified_at IS NULL;
  IF v_new=1 THEN PERFORM public.sms_lifecycle_refresh(p_org,p_phone); END IF;
END $$;

CREATE FUNCTION public.sms_ack_lifecycle(p_org uuid,p_phone text,p_revision bigint,p_restored boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM private.sms_recipient_guard(p_org,p_phone);
  UPDATE public.sms_recipient_lifecycle SET synced_revision=revision,synced_at=clock_timestamp()
    WHERE organization_id=p_org AND phone_e164=p_phone AND revision=p_revision
      AND informational_restored=p_restored;
  RETURN FOUND;
END $$;

CREATE FUNCTION public.sms_effectively_suppressed(p_org uuid,p_phone text,p_purpose text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.sms_suppressions WHERE organization_id=p_org AND phone_e164=p_phone)
    AND NOT (p_purpose IS NOT DISTINCT FROM 'informational' AND EXISTS(
      SELECT 1 FROM public.sms_recipient_lifecycle l JOIN public.sms_agency_policies p USING(organization_id)
      WHERE l.organization_id=p_org AND l.phone_e164=p_phone AND p.start_enabled
        AND p.start_active_from<=l.start_at AND l.synced_at IS NOT NULL
        AND l.informational_restored AND l.synced_revision=l.revision));
$$;
CREATE OR REPLACE FUNCTION private.sms_recipient_guard(p_org uuid,p_phone text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(private.dnc_phone_lock_key(p_org,p_phone));
  RETURN private.is_dnc_phone(p_org,p_phone) OR public.sms_effectively_suppressed(p_org,p_phone,'informational');
END $$;

-- A dispatch prepared before an opt-out/re-enrollment may not resume afterward.
ALTER TABLE public.sms_dispatches ADD COLUMN consent_revision bigint NOT NULL DEFAULT 0;
CREATE FUNCTION private.sms_dispatch_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_revision bigint; v_start timestamptz;
BEGIN
  SELECT revision,start_at INTO v_revision,v_start FROM public.sms_recipient_lifecycle WHERE organization_id=NEW.organization_id AND phone_e164=NEW.phone_e164;
  IF v_start IS NOT NULL AND NEW.request_key LIKE 'workflow:%' AND (TG_OP='INSERT' OR NEW.state='attempting') THEN
    IF split_part(NEW.request_key,':',2) !~ '^[0-9a-fA-F-]{36}$' OR NOT EXISTS(
      SELECT 1 FROM public.workflow_executions WHERE id=split_part(NEW.request_key,':',2)::uuid
        AND organization_id=NEW.organization_id AND created_at>v_start) THEN RAISE EXCEPTION 'sms_workflow_reenrollment_review'; END IF;
  END IF;
  IF TG_OP='INSERT' THEN NEW.consent_revision:=coalesce(v_revision,0);
  ELSIF NEW.state='attempting' AND OLD.state='prepared' AND NEW.consent_revision<>coalesce(v_revision,0) THEN
    RAISE EXCEPTION 'sms_consent_changed_review';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sms_dispatch_lifecycle BEFORE INSERT OR UPDATE ON public.sms_dispatches FOR EACH ROW EXECUTE FUNCTION private.sms_dispatch_lifecycle_guard();

CREATE TRIGGER sms_keyword_immutable BEFORE UPDATE OR DELETE ON public.sms_keyword_events FOR EACH ROW EXECUTE FUNCTION private.sms_evidence_immutable();
CREATE TRIGGER sms_keyword_wake AFTER INSERT ON public.sms_keyword_jobs FOR EACH ROW EXECUTE FUNCTION private.wake_sms_worker();
CREATE TRIGGER sms_lifecycle_wake AFTER INSERT OR UPDATE ON public.sms_recipient_lifecycle FOR EACH ROW EXECUTE FUNCTION private.wake_sms_worker();
DO $$ DECLARE t text; f record; BEGIN
  FOREACH t IN ARRAY ARRAY['sms_keyword_jobs','sms_keyword_events','sms_recipient_lifecycle'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
  END LOOP;
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('sms_lifecycle_refresh','sms_receive_start','sms_verify_keyword','sms_ack_lifecycle','sms_effectively_suppressed') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.sms_dispatch_lifecycle_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.sms_prepare_dispatch(p_org uuid,p_key text,p_phone text,p_from text,p_body text,p_purpose text,p_hash text,p_evidence uuid[],p_actor uuid DEFAULT NULL,p_contact uuid DEFAULT NULL,p_type text DEFAULT NULL,p_confirmation uuid DEFAULT NULL)
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
  IF private.sms_recipient_guard(p_org,p_phone) OR public.sms_effectively_suppressed(p_org,p_phone,p_purpose) THEN RAISE EXCEPTION 'sms_suppressed'; END IF;
  IF p_confirmation IS NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.sms_enrollments WHERE organization_id=p_org AND phone_e164=p_phone AND
      CASE p_purpose WHEN 'informational' THEN informational_confirmed ELSE marketing_confirmed END) THEN RAISE EXCEPTION 'sms_confirmation_pending'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.sms_confirmation_jobs WHERE id=p_confirmation AND organization_id=p_org AND phone_e164=p_phone AND state='pending' AND created_at>=now()-interval '30 minutes' AND evidence_ids=p_evidence) THEN RAISE EXCEPTION 'sms_confirmation_scope'; END IF;
  INSERT INTO public.sms_dispatches(organization_id,request_key,payload_hash,phone_e164,from_number,body,purpose,evidence_ids,actor_id,contact_id,contact_type,confirmation_id)
  VALUES(p_org,p_key,p_hash,p_phone,p_from,p_body,p_purpose,p_evidence,p_actor,p_contact,p_type,p_confirmation) RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

CREATE OR REPLACE FUNCTION public.sms_start_dispatch(p_org uuid,p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_row public.sms_dispatches;
BEGIN
  SELECT * INTO STRICT v_row FROM public.sms_dispatches WHERE organization_id=p_org AND request_key=p_key;
  PERFORM private.sms_recipient_guard(p_org,v_row.phone_e164);
  IF NOT EXISTS(SELECT 1 FROM public.sms_agency_policies WHERE organization_id=p_org AND enforced AND send_enabled AND EXISTS(SELECT 1 FROM public.phone_numbers n WHERE n.organization_id=p_org AND n.phone_number=v_row.from_number AND n.id=ANY(selected_phone_ids) AND n.status IN ('active','Active')))
    OR private.sms_recipient_guard(p_org,v_row.phone_e164) OR public.sms_effectively_suppressed(p_org,v_row.phone_e164,v_row.purpose) THEN RAISE EXCEPTION 'sms_suppressed_or_paused'; END IF;
  IF v_row.confirmation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sms_confirmation_jobs WHERE id=v_row.confirmation_id AND state='pending' AND created_at>=now()-interval '30 minutes') THEN RAISE EXCEPTION 'sms_confirmation_expired'; END IF;
  UPDATE public.sms_dispatches SET state='attempting',updated_at=now() WHERE organization_id=p_org AND request_key=p_key AND state='prepared';
  RETURN FOUND;
END $$;

-- Initialize delivery checkpoints for existing opt-outs, not new consent or STARTs.
DO $$ DECLARE s record; BEGIN
  FOR s IN SELECT organization_id,phone_e164 FROM public.sms_suppressions LOOP
    PERFORM public.sms_lifecycle_refresh(s.organization_id,s.phone_e164);
  END LOOP;
END $$;
