SET LOCAL lock_timeout='3s';
CREATE TABLE private.contact_number_call_bindings (
 organization_id uuid NOT NULL, call_id uuid PRIMARY KEY, actor_id uuid NOT NULL,
 contact_id uuid,contact_type text,phone_e164 text NOT NULL,campaign_id uuid,campaign_lead_id uuid,group_id uuid,
 number_id uuid NOT NULL,number_snapshot text NOT NULL,generation bigint NOT NULL,voice_version bigint NOT NULL,
 one_call boolean NOT NULL DEFAULT false,unsaved boolean NOT NULL DEFAULT false,
 parent_sid text,expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '2 minutes',created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX contact_number_binding_endpoint ON private.contact_number_call_bindings(organization_id,phone_e164,created_at DESC);
CREATE TABLE private.contact_number_call_work (
 organization_id uuid NOT NULL,call_id uuid PRIMARY KEY,processed_fingerprint text,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),processed_at timestamptz,last_error text,attempts integer NOT NULL DEFAULT 0
);
CREATE TABLE private.contact_number_inbound_proofs (
 organization_id uuid NOT NULL,call_id uuid PRIMARY KEY,number_id uuid NOT NULL,number_snapshot text NOT NULL,
 phone_e164 text NOT NULL,parent_sid text NOT NULL,child_sid text,actor_id uuid,observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION private.affinity_voice_scope(p_org uuid,p_actor uuid,p_contact uuid,p_type text,p_phone text,p_campaign uuid,p_member uuid,p_unsaved boolean) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE c public.campaigns; l public.campaign_leads;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND organization_id=p_org AND status='Active') THEN RAISE EXCEPTION 'affinity_actor' USING ERRCODE='42501';END IF;
 IF p_campaign IS NOT NULL THEN
  IF p_unsaved OR p_contact IS NULL OR p_type IS DISTINCT FROM 'lead' THEN RAISE EXCEPTION 'affinity_campaign_scope' USING ERRCODE='42501';END IF;
  SELECT * INTO c FROM public.campaigns WHERE id=p_campaign AND organization_id=p_org;
  SELECT * INTO l FROM public.campaign_leads WHERE id=p_member AND organization_id=p_org AND campaign_id=p_campaign;
  IF c.id IS NULL OR l.id IS NULL OR p_contact IS DISTINCT FROM coalesce(l.lead_id,l.id) OR private.affinity_phone(l.phone) IS DISTINCT FROM p_phone
   OR NOT(upper(btrim(c.type)) IN ('OPEN','OPEN POOL') OR (upper(btrim(c.type))='PERSONAL' AND c.user_id=p_actor)
   OR (upper(btrim(c.type))='TEAM' AND c.assigned_agent_ids ? p_actor::text))
   OR l.status IN ('DNC','Completed','Removed','Failed','removed','Closed Won') THEN RAISE EXCEPTION 'affinity_campaign_scope' USING ERRCODE='42501';END IF;
  IF upper(btrim(c.type)) IN ('TEAM','OPEN','OPEN POOL') AND NOT EXISTS(SELECT 1 FROM public.dialer_lead_locks WHERE organization_id=p_org
    AND campaign_lead_id=p_member AND campaign_id=p_campaign AND locked_by=p_actor AND expires_at>now() AND queue_issued_at IS NOT NULL)
  THEN RAISE EXCEPTION 'affinity_campaign_lock' USING ERRCODE='42501';END IF;
  IF EXISTS(SELECT 1 FROM public.clients WHERE organization_id=p_org AND lead_id=l.lead_id) THEN RAISE EXCEPTION 'affinity_contact_converted';END IF;
  RETURN c.number_group_id;
 END IF;
 IF p_member IS NOT NULL THEN RAISE EXCEPTION 'affinity_campaign_scope' USING ERRCODE='42501';END IF;
 IF p_unsaved THEN
  IF p_contact IS NOT NULL OR EXISTS(SELECT 1 FROM public.leads WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=substr(p_phone,2))
   OR EXISTS(SELECT 1 FROM public.clients WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=substr(p_phone,2))
   OR EXISTS(SELECT 1 FROM public.recruits WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=substr(p_phone,2))
   OR EXISTS(SELECT 1 FROM private.contact_number_affinities WHERE organization_id=p_org AND phone_e164=p_phone AND (voice_number_id IS NOT NULL OR sms_number_id IS NOT NULL OR history_state<>'new'))
  THEN RAISE EXCEPTION 'affinity_select_contact' USING ERRCODE='42501';END IF;
 ELSE PERFORM private.affinity_assert_contact(p_org,p_contact,p_type,p_phone);END IF;
 IF EXISTS(SELECT 1 FROM public.dialer_lead_locks k JOIN public.campaign_leads member ON member.id=k.campaign_lead_id AND member.organization_id=k.organization_id
 WHERE k.organization_id=p_org AND k.locked_by=p_actor AND k.expires_at>now() AND k.queue_issued_at IS NOT NULL
 AND (coalesce(member.lead_id,member.id)=p_contact OR private.phone_digits_e164ish(member.phone)=substr(p_phone,2)))
 THEN RAISE EXCEPTION 'affinity_campaign_required' USING ERRCODE='42501';END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION public.authorize_contact_call(p_call uuid,p_contact uuid,p_type text,p_phone text,p_candidate text,p_campaign uuid DEFAULT NULL,p_member uuid DEFAULT NULL,p_override uuid DEFAULT NULL,p_unsaved boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; grp uuid; chosen uuid; snapshot text; a private.contact_number_affinities; mode text;
BEGIN
 SELECT organization_id INTO org FROM public.profiles WHERE id=auth.uid() AND status='Active';
 IF org IS NULL OR org IS DISTINCT FROM public.get_org_id() THEN RAISE EXCEPTION 'affinity_actor' USING ERRCODE='42501';END IF;
 mode:=private.affinity_mode(org,'voice');
 IF mode='shadow' THEN
  BEGIN
   PERFORM private.affinity_voice_scope(org,auth.uid(),p_contact,p_type,private.affinity_phone(p_phone),p_campaign,p_member,p_unsaved);
   INSERT INTO private.contact_number_observations(organization_id,evidence_key,phone_e164,channel,candidate_id,details)
   SELECT org,'call-intent:'||p_call,private.affinity_phone(p_phone),'voice',n.id,jsonb_build_object('candidate',p_candidate,'one_call',p_override IS NOT NULL)
   FROM (SELECT 1) unused LEFT JOIN public.phone_numbers n ON n.organization_id=org AND n.phone_number=private.affinity_phone(p_candidate)
   ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'affinity_shadow_observation_deferred';END;
 END IF;
 IF mode IN ('off','shadow') THEN RETURN jsonb_build_object('enabled',false);END IF;
 p_phone:=private.affinity_phone(p_phone);
 grp:=private.affinity_voice_scope(org,auth.uid(),p_contact,p_type,p_phone,p_campaign,p_member,p_unsaved);
 PERFORM private.affinity_ensure(org,p_phone);
 IF NOT private.affinity_recover(org,p_phone,20) THEN RETURN jsonb_build_object('blocked','affinity_evidence_pending');END IF;
 SELECT * INTO a FROM private.contact_number_affinities WHERE organization_id=org AND phone_e164=p_phone FOR UPDATE;
 IF p_override IS NOT NULL THEN chosen:=p_override;
 ELSE
  IF a.history_state='needs_review' OR a.voice_state='needs_review' THEN RAISE EXCEPTION 'affinity_history_review';END IF;
  chosen:=coalesce(a.voice_number_id,a.sms_number_id);
  IF chosen IS NULL THEN SELECT id INTO chosen FROM public.phone_numbers WHERE organization_id=org AND phone_number=private.affinity_phone(p_candidate)
   AND coalesce(assignment_type,'agency')='agency';END IF;
 END IF;
 IF chosen IS NULL OR private.affinity_number(org,chosen,'voice',auth.uid(),p_override IS NOT NULL,grp)->>'readiness'<>'ready' THEN RAISE EXCEPTION 'affinity_sender_unavailable';END IF;
 SELECT phone_number INTO snapshot FROM public.phone_numbers WHERE id=chosen AND organization_id=org;
 IF private.is_dnc_phone(org,p_phone) THEN RAISE EXCEPTION 'affinity_dnc';END IF;
 IF p_call IS NULL OR EXISTS(SELECT 1 FROM public.calls WHERE id=p_call) OR EXISTS(SELECT 1 FROM private.contact_number_call_bindings WHERE call_id=p_call)
 THEN RAISE EXCEPTION 'affinity_attempt_reused';END IF;
 INSERT INTO private.contact_number_call_bindings(organization_id,call_id,actor_id,contact_id,contact_type,phone_e164,campaign_id,campaign_lead_id,group_id,
 number_id,number_snapshot,generation,voice_version,one_call,unsaved)
 VALUES(org,p_call,auth.uid(),p_contact,p_type,p_phone,p_campaign,p_member,grp,chosen,snapshot,a.generation,a.voice_version,p_override IS NOT NULL,p_unsaved);
 IF p_override IS NOT NULL THEN PERFORM private.affinity_event(org,p_phone,'voice','one_call',auth.uid(),chosen,snapshot,p_call::text);END IF;
 RETURN jsonb_build_object('enabled',true,'number_id',chosen,'number',snapshot,'generation',a.generation,'version',a.voice_version);
END $$;

-- Refuse live drift rather than wrap a different production contract.
DO $preimage$ BEGIN
 IF md5(pg_get_functiondef('public.admit_twilio_outbound(uuid,text,text,text,text)'::regprocedure)) IS DISTINCT FROM 'e402240d8b4cfe1954e7a99fe50ee705' THEN RAISE EXCEPTION 'sticky preimage mismatch: admit_twilio_outbound';END IF;
 IF md5(pg_get_functiondef('public.ingest_inbound_call(text,uuid,text,text,boolean)'::regprocedure)) IS DISTINCT FROM '98818f288139d8ecdb365083c0775cf3' THEN RAISE EXCEPTION 'sticky preimage mismatch: ingest_inbound_call';END IF;
 IF md5(pg_get_functiondef('public.claim_inbound_call(uuid,uuid,text,text)'::regprocedure)) IS DISTINCT FROM '4102657ac5819ce430bd45fb550a1253' THEN RAISE EXCEPTION 'sticky preimage mismatch: claim_inbound_call';END IF;
END $preimage$;
ALTER FUNCTION public.admit_twilio_outbound(uuid,text,text,text,text) SET SCHEMA private;
ALTER FUNCTION private.admit_twilio_outbound(uuid,text,text,text,text) RENAME TO affinity_admit_original;
CREATE FUNCTION public.admit_twilio_outbound(p_call_id uuid,p_identity text,p_to text,p_caller_id text,p_parent_sid text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','pg_temp' AS $$
DECLARE result jsonb; c public.calls; b private.contact_number_call_bindings; claims text; grp uuid;
BEGIN
 result:=private.affinity_admit_original(p_call_id,p_identity,p_to,p_caller_id,p_parent_sid);
 IF private.affinity_mode((result->>'organization_id')::uuid,'voice') NOT IN ('enforced','guard_only') THEN RETURN result;END IF;
 SELECT * INTO c FROM public.calls WHERE id=p_call_id AND organization_id=(result->>'organization_id')::uuid;
 SELECT * INTO b FROM private.contact_number_call_bindings WHERE call_id=p_call_id AND organization_id=c.organization_id FOR UPDATE;
 IF NOT FOUND OR c.attempt_id IS DISTINCT FROM b.call_id OR b.actor_id IS DISTINCT FROM c.agent_id OR b.contact_id IS DISTINCT FROM c.contact_id
 OR b.contact_type IS DISTINCT FROM c.contact_type OR b.campaign_id IS DISTINCT FROM c.campaign_id OR b.campaign_lead_id IS DISTINCT FROM c.campaign_lead_id
 OR b.phone_e164 IS DISTINCT FROM private.affinity_phone(p_to) OR b.number_snapshot IS DISTINCT FROM private.affinity_phone(p_caller_id)
 OR (b.parent_sid IS NULL AND b.expires_at<clock_timestamp()) OR (b.parent_sid IS NOT NULL AND b.parent_sid<>p_parent_sid)
 THEN RAISE EXCEPTION 'affinity_admission_mismatch' USING ERRCODE='42501';END IF;
 claims:=private.affinity_actor_claims(c.organization_id,b.actor_id);
 grp:=private.affinity_voice_scope(c.organization_id,b.actor_id,b.contact_id,b.contact_type,b.phone_e164,b.campaign_id,b.campaign_lead_id,b.unsaved);
 PERFORM set_config('request.jwt.claims',coalesce(claims,''),true);
 IF grp IS DISTINCT FROM b.group_id OR private.affinity_number(c.organization_id,b.number_id,'voice',b.actor_id,b.one_call,grp)->>'readiness'<>'ready'
 OR NOT EXISTS(SELECT 1 FROM public.phone_numbers WHERE id=b.number_id AND organization_id=c.organization_id AND phone_number=b.number_snapshot)
 OR NOT EXISTS(SELECT 1 FROM private.contact_number_affinities WHERE organization_id=c.organization_id AND phone_e164=b.phone_e164 AND generation=b.generation
  AND (b.one_call OR (voice_state<>'needs_review' AND coalesce(voice_number_id,sms_number_id,b.number_id)=b.number_id)))
 THEN RAISE EXCEPTION 'affinity_admission_changed' USING ERRCODE='42501';END IF;
 UPDATE private.contact_number_call_bindings SET parent_sid=p_parent_sid WHERE call_id=p_call_id;
 RETURN result;
END $$;

-- Trusted service entrypoints keep their signatures and all original core behavior.
-- Sidecar failures are warnings only, with conservative recovery from core evidence.
ALTER FUNCTION public.ingest_inbound_call(text,uuid,text,text,boolean) SET SCHEMA private;
ALTER FUNCTION private.ingest_inbound_call(text,uuid,text,text,boolean) RENAME TO affinity_ingest_original;
CREATE FUNCTION public.ingest_inbound_call(p_twilio_call_sid text,p_org_id uuid,p_from_number text,p_to_number text,p_auto_create boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','pg_temp' AS $$
DECLARE result jsonb; number_id uuid; phone text; c public.calls;
BEGIN
 BEGIN
  IF private.affinity_mode(p_org_id,'voice')='enforced' THEN
   phone:=private.affinity_phone(p_from_number);
   SELECT id INTO number_id FROM public.phone_numbers WHERE organization_id=p_org_id AND phone_number=private.affinity_phone(p_to_number)
    AND assignment_type='agency' AND NOT inbounds_only;
   IF number_id IS NOT NULL THEN PERFORM private.affinity_ensure(p_org_id,phone);END IF;
  END IF;
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'affinity_inbound_prepare_deferred'; END;
 result:=private.affinity_ingest_original(p_twilio_call_sid,p_org_id,p_from_number,p_to_number,p_auto_create);
 BEGIN
  IF number_id IS NOT NULL THEN
   SELECT * INTO c FROM public.calls WHERE organization_id=p_org_id AND twilio_call_sid=p_twilio_call_sid AND direction='inbound';
   IF c.id IS NOT NULL THEN INSERT INTO private.contact_number_inbound_proofs(organization_id,call_id,number_id,number_snapshot,phone_e164,parent_sid)
    VALUES(p_org_id,c.id,number_id,private.affinity_phone(p_to_number),phone,p_twilio_call_sid) ON CONFLICT DO NOTHING;END IF;
  END IF;
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'affinity_inbound_observation_deferred';END;
 RETURN result;
END $$;
ALTER FUNCTION public.claim_inbound_call(uuid,uuid,text,text) SET SCHEMA private;
ALTER FUNCTION private.claim_inbound_call(uuid,uuid,text,text) RENAME TO affinity_claim_original;
CREATE FUNCTION public.claim_inbound_call(p_user_id uuid,p_call_row_id uuid,p_child_call_sid text,p_parent_call_sid text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','pg_temp' AS $$
DECLARE result jsonb;
BEGIN
 result:=private.affinity_claim_original(p_user_id,p_call_row_id,p_child_call_sid,p_parent_call_sid);
 BEGIN
  IF result->>'claimed'='true' THEN UPDATE private.contact_number_inbound_proofs SET actor_id=p_user_id,child_sid=p_child_call_sid
   WHERE call_id=p_call_row_id AND parent_sid=p_parent_call_sid AND (child_sid IS NULL OR child_sid=p_child_call_sid);END IF;
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'affinity_inbound_claim_deferred';END;
 RETURN result;
END $$;

CREATE FUNCTION private.affinity_call_fingerprint(p_call uuid) RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT md5(jsonb_build_array(to_jsonb(c),to_jsonb(d),to_jsonb(b),to_jsonb(i),
  (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.evidence_key) FROM private.call_duration_observations o WHERE o.call_id=c.id),
  (SELECT affinity_class FROM public.dispositions WHERE id=c.disposition_id AND organization_id=c.organization_id))::text)
 FROM public.calls c LEFT JOIN private.outbound_dial_evidence d ON d.call_id=c.id AND d.organization_id=c.organization_id
 LEFT JOIN private.contact_number_call_bindings b ON b.call_id=c.id AND b.organization_id=c.organization_id
 LEFT JOIN private.contact_number_inbound_proofs i ON i.call_id=c.id AND i.organization_id=c.organization_id WHERE c.id=p_call
$$;
CREATE FUNCTION private.affinity_qualify_call(p_call uuid,p_historical boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE c public.calls; d public.dispositions; e private.outbound_dial_evidence; b private.contact_number_call_bindings; i private.contact_number_inbound_proofs;
 duration integer; variants integer; number_id uuid; snapshot text; account text;
BEGIN
 SELECT * INTO c FROM public.calls WHERE id=p_call;
 SELECT * INTO d FROM public.dispositions WHERE id=c.disposition_id AND organization_id=c.organization_id;
 IF c.id IS NULL OR c.status IS DISTINCT FROM 'completed' OR c.is_missed OR c.voicemail_id IS NOT NULL OR coalesce(c.amd_result,'human') NOT IN ('human','unknown')
 OR d.affinity_class IS NULL OR d.affinity_class NOT IN ('duration','confirmed') OR d.dnc_auto_add OR d.auto_add_to_dnc
 OR private.is_dnc_phone(c.organization_id,c.contact_phone) THEN RETURN jsonb_build_object('qualified',false);END IF;
 IF c.direction='outbound' THEN
  SELECT * INTO e FROM private.outbound_dial_evidence WHERE call_id=c.id AND organization_id=c.organization_id;
  SELECT * INTO b FROM private.contact_number_call_bindings WHERE call_id=c.id AND organization_id=c.organization_id;
  -- Historical evidence is inspected separately: lack of one-off provenance is review, never invented intent.
  IF b.call_id IS NULL THEN RETURN jsonb_build_object('qualified',false,'historical_review',p_historical AND e.call_id IS NOT NULL);END IF;
  IF b.one_call OR b.actor_id IS DISTINCT FROM c.agent_id OR b.phone_e164 IS DISTINCT FROM private.affinity_phone(c.contact_phone)
   OR b.parent_sid IS DISTINCT FROM c.twilio_call_sid OR e.parent_call_sid IS DISTINCT FROM c.twilio_call_sid OR e.agent_id IS DISTINCT FROM c.agent_id
   OR e.dialed_to_digits IS DISTINCT FROM substr(b.phone_e164,2) OR e.caller_id_digits IS DISTINCT FROM private.phone_digits_e164ish(b.number_snapshot)
   OR e.outcome IS DISTINCT FROM 'answered' OR e.dial_call_status NOT IN ('completed','answered') OR e.provider_call_status IS DISTINCT FROM 'completed' THEN RETURN jsonb_build_object('qualified',false);END IF;
  SELECT count(DISTINCT (account_sid,candidate)),min(candidate) INTO variants,duration FROM private.call_duration_observations
   WHERE call_id=c.id AND organization_id=c.organization_id AND matched_sid=e.parent_call_sid
    AND duration_sid=e.dial_call_sid AND parent_sid=e.parent_call_sid AND source='provider';
  number_id:=b.number_id;snapshot:=b.number_snapshot;account:=e.account_sid;
 ELSE
  SELECT * INTO i FROM private.contact_number_inbound_proofs WHERE call_id=c.id AND organization_id=c.organization_id;
  IF i.call_id IS NULL THEN RETURN jsonb_build_object('qualified',false,'pending',true);END IF;
  IF i.actor_id IS NULL OR i.actor_id IS DISTINCT FROM c.agent_id OR i.parent_sid IS DISTINCT FROM c.twilio_call_sid
   OR i.child_sid IS DISTINCT FROM c.provider_session_id OR (i.actor_id=ANY(c.routed_agent_ids)) IS NOT TRUE THEN RETURN jsonb_build_object('qualified',false);END IF;
  SELECT count(DISTINCT (account_sid,candidate)),min(candidate) INTO variants,duration FROM private.call_duration_observations
   WHERE call_id=c.id AND organization_id=c.organization_id AND matched_sid=i.parent_sid AND duration_sid=i.child_sid AND parent_sid=i.parent_sid AND source='provider';
  number_id:=i.number_id;snapshot:=i.number_snapshot;
 END IF;
 IF variants<>1 OR duration<=0 OR (d.affinity_class='duration' AND duration<45) THEN RETURN jsonb_build_object('qualified',false,'conflicting',variants>1);END IF;
 -- Readiness never invalidates established relationship evidence. Both binding
 -- and signed inbound provenance captured the actual authorized agency identity.
 IF c.direction='outbound' AND NOT EXISTS(SELECT 1 FROM private.call_duration_observations WHERE call_id=c.id AND account_sid=e.account_sid AND duration_sid=e.dial_call_sid AND source='provider') THEN RETURN jsonb_build_object('qualified',false);END IF;
 RETURN jsonb_build_object('qualified',true,'number_id',number_id,'number',snapshot,'duration',duration,'generation',b.generation,'direction',c.direction);
END $$;
CREATE FUNCTION private.affinity_process_call(p_call uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c public.calls; q jsonb; a private.contact_number_affinities; phone text; fingerprint text;
BEGIN
 SELECT * INTO c FROM public.calls WHERE id=p_call;
 phone:=private.affinity_phone(c.contact_phone);PERFORM private.affinity_lock(c.organization_id,phone);
 fingerprint:=private.affinity_call_fingerprint(p_call);
 IF EXISTS(SELECT 1 FROM private.contact_number_call_work WHERE call_id=p_call AND processed_fingerprint=fingerprint) THEN RETURN;END IF;
 q:=private.affinity_qualify_call(p_call);
 IF q->>'pending'='true' THEN RAISE EXCEPTION 'affinity_verified_evidence_pending';END IF;
 SELECT * INTO a FROM private.contact_number_affinities WHERE organization_id=c.organization_id AND phone_e164=phone FOR UPDATE;
 IF private.affinity_mode(c.organization_id,'voice')='shadow' THEN
  INSERT INTO private.contact_number_observations(organization_id,evidence_key,phone_e164,channel,candidate_id,details)
  VALUES(c.organization_id,'call:'||p_call||':'||fingerprint,phone,'voice',(q->>'number_id')::uuid,q) ON CONFLICT DO NOTHING;
 ELSIF private.affinity_mode(c.organization_id,'voice')='enforced' AND a.organization_id IS NOT NULL THEN
  IF q->>'qualified'='true' AND a.voice_state='unassigned' AND a.history_state<>'needs_review'
   AND (c.direction='inbound' OR a.generation=(q->>'generation')::bigint) THEN
   UPDATE private.contact_number_affinities SET voice_number_id=(q->>'number_id')::uuid,voice_number=q->>'number',voice_state='established',
    voice_source='qualified_call',voice_event=p_call::text,voice_version=voice_version+1,updated_at=clock_timestamp()
    WHERE organization_id=c.organization_id AND phone_e164=phone;
   PERFORM private.affinity_event(c.organization_id,phone,'voice','qualified',c.agent_id,(q->>'number_id')::uuid,q->>'number',p_call::text,q);
   -- SMS identity can inherit an unset voice pin even while registration is pending; readiness stays separate.
  ELSIF q->>'qualified'<>'true' AND a.voice_source='qualified_call' AND a.voice_event=p_call::text AND a.voice_state='established' THEN
   UPDATE private.contact_number_affinities SET voice_state='needs_review',voice_version=voice_version+1,updated_at=clock_timestamp()
    WHERE organization_id=c.organization_id AND phone_e164=phone;
   PERFORM private.affinity_event(c.organization_id,phone,'voice','evidence_review',NULL,a.voice_number_id,a.voice_number,p_call::text,q);
  END IF;
 END IF;
 INSERT INTO private.contact_number_call_work(organization_id,call_id,processed_fingerprint,processed_at)
 VALUES(c.organization_id,p_call,fingerprint,clock_timestamp()) ON CONFLICT(call_id) DO UPDATE SET processed_fingerprint=excluded.processed_fingerprint,
 processed_at=excluded.processed_at,last_error=NULL,attempts=contact_number_call_work.attempts+1;
END $$;
CREATE OR REPLACE FUNCTION private.affinity_recover(p_org uuid,p_phone text,p_limit integer DEFAULT 20) RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r record; n integer:=0;
BEGIN
 FOR r IN SELECT c.id FROM public.calls c LEFT JOIN private.contact_number_call_work w ON w.call_id=c.id AND w.organization_id=c.organization_id
  WHERE c.organization_id=p_org AND private.phone_digits_e164ish(c.contact_phone)=substr(p_phone,2)
  AND w.processed_fingerprint IS DISTINCT FROM private.affinity_call_fingerprint(c.id)
  ORDER BY c.created_at,c.id LIMIT least(greatest(p_limit,1),50)+1 LOOP
  n:=n+1;IF n>least(greatest(p_limit,1),50) THEN RETURN false;END IF;
  BEGIN PERFORM private.affinity_process_call(r.id);
  EXCEPTION WHEN OTHERS THEN
   INSERT INTO private.contact_number_call_work(organization_id,call_id,last_error,attempts) VALUES(p_org,r.id,'processor_failed',1)
    ON CONFLICT(call_id) DO UPDATE SET last_error='processor_failed',attempts=contact_number_call_work.attempts+1;
   RETURN false;
  END;
 END LOOP;RETURN true;
END $$;
CREATE FUNCTION private.affinity_enqueue_call() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE id uuid; org uuid;
BEGIN
 BEGIN
  IF TG_TABLE_NAME='calls' THEN id:=NEW.id;org:=NEW.organization_id; ELSE id:=NEW.call_id;org:=NEW.organization_id;END IF;
  INSERT INTO private.contact_number_call_work(organization_id,call_id) VALUES(org,id)
   ON CONFLICT(call_id) DO UPDATE SET changed_at=clock_timestamp();
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'affinity_enqueue_deferred';END;
 RETURN NULL;
END $$;
CREATE TRIGGER affinity_calls_dirty AFTER INSERT OR UPDATE ON public.calls FOR EACH ROW EXECUTE FUNCTION private.affinity_enqueue_call();
CREATE TRIGGER affinity_duration_dirty AFTER INSERT OR UPDATE ON private.call_duration_observations FOR EACH ROW EXECUTE FUNCTION private.affinity_enqueue_call();
CREATE TRIGGER affinity_outbound_dirty AFTER INSERT OR UPDATE ON private.outbound_dial_evidence FOR EACH ROW EXECUTE FUNCTION private.affinity_enqueue_call();
CREATE TRIGGER affinity_inbound_dirty AFTER INSERT OR UPDATE ON private.contact_number_inbound_proofs FOR EACH ROW EXECUTE FUNCTION private.affinity_enqueue_call();
CREATE FUNCTION public.recover_contact_numbers(p_contact uuid,p_type text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; scope jsonb;
BEGIN SELECT organization_id INTO org FROM public.profiles WHERE id=auth.uid() AND status='Active';scope:=private.affinity_assert_contact(org,p_contact,p_type);
 RETURN private.affinity_recover(org,scope->>'phone',20);END $$;

DO $seal$ DECLARE r record;BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='private' AND tablename LIKE 'contact_number_%' LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',r.tablename);EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',r.tablename);END LOOP;
 FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'affinity_%'
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.signature);END LOOP;
END $seal$;
GRANT EXECUTE ON FUNCTION private.affinity_phone(text),private.phone_digits_e164ish(text) TO agentflow_affinity_scope;
REVOKE ALL ON FUNCTION public.authorize_contact_call(uuid,uuid,text,text,text,uuid,uuid,uuid,boolean),public.recover_contact_numbers(uuid,text),
 public.admit_twilio_outbound(uuid,text,text,text,text),public.ingest_inbound_call(text,uuid,text,text,boolean),public.claim_inbound_call(uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.authorize_contact_call(uuid,uuid,text,text,text,uuid,uuid,uuid,boolean),public.recover_contact_numbers(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admit_twilio_outbound(uuid,text,text,text,text),public.ingest_inbound_call(text,uuid,text,text,boolean),public.claim_inbound_call(uuid,uuid,text,text) TO service_role;
