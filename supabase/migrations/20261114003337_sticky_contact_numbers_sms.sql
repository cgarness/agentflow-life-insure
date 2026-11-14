-- Existing dispatch ledger remains the only attempt/receipt authority.
SET LOCAL lock_timeout='3s';
ALTER TABLE public.sms_dispatches
 ADD COLUMN affinity_intent jsonb,
 ADD COLUMN affinity_actor_id uuid, ADD COLUMN affinity_contact_id uuid, ADD COLUMN affinity_contact_type text,
 ADD COLUMN affinity_number_id uuid,
 ADD COLUMN affinity_generation bigint,
 ADD COLUMN affinity_version bigint,
 ADD COLUMN affinity_override boolean NOT NULL DEFAULT false,
 ADD COLUMN affinity_account_sid text,
 ADD COLUMN affinity_service_sid text,
 ADD COLUMN affinity_role text;
CREATE INDEX sms_dispatches_unresolved_endpoint ON public.sms_dispatches(organization_id,phone_e164)
 WHERE state IN ('prepared','attempting','uncertain');
CREATE TABLE private.contact_number_internal_alerts (
 organization_id uuid NOT NULL, key_prefix text NOT NULL CHECK(key_prefix IN ('clearpath:lead:','clearpath:test:')),
 actor_id uuid NOT NULL, sender text NOT NULL, recipient text NOT NULL, PRIMARY KEY(organization_id,key_prefix)
);
ALTER TABLE private.contact_number_internal_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.contact_number_internal_alerts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.affinity_internal_alert(p_org uuid,p_key text,p_from text,p_to text,p_actor uuid,p_purpose text) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT p_purpose='informational' AND EXISTS(SELECT 1 FROM private.contact_number_internal_alerts WHERE organization_id=p_org
 AND p_key LIKE key_prefix||'%' AND sender=p_from AND recipient=p_to AND actor_id=p_actor)
$$;
CREATE FUNCTION private.affinity_event(p_org uuid,p_phone text,p_channel text,p_kind text,p_actor uuid,p_number uuid,p_snapshot text,p_key text,p_details jsonb DEFAULT '{}') RETURNS void
LANGUAGE sql SET search_path='' AS $$
 INSERT INTO private.contact_number_events(organization_id,phone_e164,channel,kind,actor_id,number_id,number_snapshot,generation,evidence_key,details)
 SELECT p_org,p_phone,p_channel,p_kind,p_actor,p_number,p_snapshot,generation,p_key,p_details FROM private.contact_number_affinities WHERE organization_id=p_org AND phone_e164=p_phone
$$;
CREATE FUNCTION private.affinity_unresolved(p_org uuid,p_phone text) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.sms_dispatches WHERE organization_id=p_org AND phone_e164=p_phone AND state IN ('prepared','attempting','uncertain'))
$$;
-- The voice migration replaces this bounded coordinator before release. At this phase,
-- unknown history is held; no guessed voice evidence is used.
CREATE FUNCTION private.affinity_recover(p_org uuid,p_phone text,p_limit integer DEFAULT 20) RETURNS boolean LANGUAGE sql SET search_path='' AS $$SELECT true$$;

-- Refuse live drift rather than wrap a different production contract.
DO $preimage$ BEGIN
 IF md5(pg_get_functiondef('public.sms_prepare_dispatch(uuid,text,text,text,text,text,text,uuid[],uuid,uuid,text,uuid)'::regprocedure)) IS DISTINCT FROM '4b871cbd941d09d8de366fec1574bb6a' THEN RAISE EXCEPTION 'sticky preimage mismatch: sms_prepare_dispatch';END IF;
 IF md5(pg_get_functiondef('public.sms_start_dispatch(uuid,text)'::regprocedure)) IS DISTINCT FROM '954847735274f8511016cbb74d0ac7ed' THEN RAISE EXCEPTION 'sticky preimage mismatch: sms_start_dispatch';END IF;
 IF md5(pg_get_functiondef('public.sms_finish_dispatch(uuid,text,text,text,text,text)'::regprocedure)) IS DISTINCT FROM '482aec77a78d279fc792862ec19c737b' THEN RAISE EXCEPTION 'sticky preimage mismatch: sms_finish_dispatch';END IF;
END $preimage$;
ALTER FUNCTION public.sms_prepare_dispatch(uuid,text,text,text,text,text,text,uuid[],uuid,uuid,text,uuid) SET SCHEMA private;
ALTER FUNCTION private.sms_prepare_dispatch(uuid,text,text,text,text,text,text,uuid[],uuid,uuid,text,uuid) RENAME TO affinity_prepare_original;
ALTER FUNCTION public.sms_start_dispatch(uuid,text) SET SCHEMA private;
ALTER FUNCTION private.sms_start_dispatch(uuid,text) RENAME TO affinity_start_original;
ALTER FUNCTION public.sms_finish_dispatch(uuid,text,text,text,text,text) SET SCHEMA private;
ALTER FUNCTION private.sms_finish_dispatch(uuid,text,text,text,text,text) RENAME TO affinity_finish_original;

CREATE FUNCTION private.affinity_automation_scope(p_org uuid,p_key text,p_phone text,p_contact uuid,p_type text,p_confirmation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE contact jsonb; owner_id uuid; count_rows integer; target uuid:=p_contact; kind text:=p_type;
BEGIN
 IF p_confirmation IS NOT NULL THEN
  IF p_key IS DISTINCT FROM 'confirmation:'||p_confirmation::text OR NOT EXISTS(SELECT 1 FROM public.sms_confirmation_jobs WHERE organization_id=p_org AND id=p_confirmation AND phone_e164=p_phone) THEN RAISE EXCEPTION 'affinity_automation_scope';END IF;
  SELECT count(*),min(id::text)::uuid,min(type) INTO count_rows,target,kind FROM (
   SELECT id,'lead' type FROM public.leads WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=substr(p_phone,2)
    AND NOT EXISTS(SELECT 1 FROM public.clients WHERE organization_id=p_org AND lead_id=leads.id)
   UNION ALL SELECT id,'client' FROM public.clients WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=substr(p_phone,2)
   UNION ALL SELECT id,'recruit' FROM public.recruits WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=substr(p_phone,2)) c;
  IF count_rows<>1 THEN RAISE EXCEPTION 'affinity_automation_contact_review';END IF;
 ELSIF p_key ~ '^workflow:[0-9a-fA-F-]{36}:' THEN
  IF NOT EXISTS(SELECT 1 FROM public.workflow_executions WHERE organization_id=p_org AND id=split_part(p_key,':',2)::uuid
    AND contact_id=p_contact AND contact_type=p_type) THEN RAISE EXCEPTION 'affinity_automation_scope';END IF;
 ELSE RAISE EXCEPTION 'affinity_automation_scope';END IF;
 IF kind='lead' THEN SELECT to_jsonb(c) INTO contact FROM public.leads c WHERE organization_id=p_org AND id=target;
 ELSIF kind='client' THEN SELECT to_jsonb(c) INTO contact FROM public.clients c WHERE organization_id=p_org AND id=target;
 ELSIF kind='recruit' THEN SELECT to_jsonb(c) INTO contact FROM public.recruits c WHERE organization_id=p_org AND id=target;END IF;
 IF contact IS NULL OR private.affinity_phone(contact->>'phone') IS DISTINCT FROM p_phone THEN RAISE EXCEPTION 'affinity_automation_scope';END IF;
 owner_id:=CASE WHEN kind='lead' THEN (contact->>'user_id')::uuid ELSE (contact->>'assigned_agent_id')::uuid END;
 RETURN jsonb_build_object('actor',owner_id,'contact',target,'type',kind);
END $$;
CREATE FUNCTION private.affinity_prepare(p_org uuid,p_key text,p_phone text,p_from text,p_body text,p_purpose text,p_hash text,p_evidence uuid[],
 p_actor uuid,p_contact uuid,p_type text,p_confirmation uuid,p_v2 boolean,p_expected uuid,p_override uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE row public.sms_dispatches; a private.contact_number_affinities; mode text; chosen uuid; number text;
 intent jsonb; prior_claims text; exempt boolean; result jsonb; effective jsonb; actor uuid:=p_actor; contact uuid:=p_contact; kind text:=p_type;
BEGIN
 p_phone:=private.affinity_phone(p_phone);p_from:=private.affinity_phone(p_from);
 PERFORM private.affinity_lock(p_org,p_phone);
 mode:=private.affinity_mode(p_org,'sms');
 exempt:=private.affinity_internal_alert(p_org,p_key,p_from,p_phone,p_actor,p_purpose);
 intent:=jsonb_build_array(p_phone,p_body,p_purpose,p_actor,p_contact,p_type,p_confirmation,p_override);
 SELECT * INTO row FROM public.sms_dispatches WHERE organization_id=p_org AND request_key=p_key FOR UPDATE;
 IF FOUND THEN
  IF (p_v2 AND row.affinity_intent IS NOT NULL AND row.affinity_intent IS DISTINCT FROM intent)
   OR (NOT p_v2 AND row.payload_hash IS DISTINCT FROM p_hash)
   OR (row.affinity_intent IS NULL AND (p_override IS NOT NULL OR row.phone_e164 IS DISTINCT FROM p_phone OR row.body IS DISTINCT FROM p_body
    OR row.purpose IS DISTINCT FROM p_purpose OR row.actor_id IS DISTINCT FROM p_actor OR row.contact_id IS DISTINCT FROM p_contact
    OR row.contact_type IS DISTINCT FROM p_type OR row.confirmation_id IS DISTINCT FROM p_confirmation OR row.from_number IS DISTINCT FROM p_from))
  THEN RAISE EXCEPTION 'sms_request_conflict' USING ERRCODE='22023';END IF;
  RETURN to_jsonb(row);
 END IF;
 IF mode IN ('off','shadow') OR exempt THEN
  result:=private.affinity_prepare_original(p_org,p_key,p_phone,p_from,p_body,p_purpose,p_hash,p_evidence,p_actor,p_contact,p_type,p_confirmation);
  IF mode='shadow' AND NOT exempt THEN INSERT INTO private.contact_number_observations(organization_id,evidence_key,phone_e164,channel,details)
   VALUES(p_org,'sms:'||p_key,p_phone,'sms',jsonb_build_object('from',p_from)) ON CONFLICT DO NOTHING;END IF;
  RETURN result;
 END IF;
 -- No implicit service/after-hours permission. Customer work must name its real contact and actor.
 IF p_purpose<>'manual' THEN effective:=private.affinity_automation_scope(p_org,p_key,p_phone,p_contact,p_type,p_confirmation);actor:=(effective->>'actor')::uuid;contact:=(effective->>'contact')::uuid;kind:=effective->>'type';END IF;
 IF actor IS NULL OR contact IS NULL OR kind NOT IN ('lead','client','recruit') THEN RAISE EXCEPTION 'affinity_customer_scope_required' USING ERRCODE='42501';END IF;
 prior_claims:=private.affinity_actor_claims(p_org,actor);
 PERFORM private.affinity_assert_contact(p_org,contact,kind,p_phone);
 PERFORM set_config('request.jwt.claims',coalesce(prior_claims,''),true);
 PERFORM private.affinity_ensure(p_org,p_phone);
 IF NOT private.affinity_recover(p_org,p_phone,20) THEN RETURN jsonb_build_object('blocked','affinity_evidence_pending');END IF;
 SELECT * INTO a FROM private.contact_number_affinities WHERE organization_id=p_org AND phone_e164=p_phone FOR UPDATE;
 IF p_override IS NOT NULL THEN
  IF NOT p_v2 OR p_purpose<>'manual' THEN RAISE EXCEPTION 'affinity_override_scope' USING ERRCODE='42501';END IF;
  chosen:=p_override;
 ELSE
  IF a.history_state='needs_review' OR a.sms_state='needs_review' THEN RAISE EXCEPTION 'affinity_history_review';END IF;
  chosen:=coalesce(a.sms_number_id,a.voice_number_id);
  IF chosen IS NULL AND mode='guard_only' THEN RAISE EXCEPTION 'affinity_guard_only';END IF;
  chosen:=coalesce(chosen,private.affinity_default(p_org,'sms',p_actor));
 END IF;
 IF chosen IS NULL OR private.affinity_number(p_org,chosen,'sms',p_actor,p_override IS NOT NULL)->>'readiness'<>'ready' THEN RAISE EXCEPTION 'affinity_sender_unready';END IF;
 SELECT phone_number INTO number FROM public.phone_numbers WHERE id=chosen AND organization_id=p_org;
 IF (NOT p_v2 AND p_from IS DISTINCT FROM number) OR (p_v2 AND p_purpose='manual' AND (p_expected IS NULL OR p_expected IS DISTINCT FROM chosen))
 THEN RAISE EXCEPTION 'affinity_sender_changed';END IF;
 result:=private.affinity_prepare_original(p_org,p_key,p_phone,number,p_body,p_purpose,p_hash,p_evidence,p_actor,p_contact,p_type,p_confirmation);
 IF p_override IS NULL AND a.sms_number_id IS NULL AND mode='enforced' THEN
  UPDATE private.contact_number_affinities SET sms_number_id=chosen,sms_number=number,sms_state='reserved',sms_version=sms_version+1,
   sms_source='outbound_sms',sms_event=p_key,updated_at=clock_timestamp() WHERE organization_id=p_org AND phone_e164=p_phone RETURNING * INTO a;
  PERFORM private.affinity_event(p_org,p_phone,'sms','reserved',p_actor,chosen,number,p_key);
 END IF;
 UPDATE public.sms_dispatches SET affinity_intent=intent,affinity_actor_id=actor,affinity_contact_id=contact,affinity_contact_type=kind,affinity_number_id=chosen,affinity_generation=a.generation,
  affinity_version=a.sms_version,affinity_override=p_override IS NOT NULL,affinity_role=CASE WHEN p_override IS NULL THEN 'customer' ELSE 'one_text' END,
  affinity_account_sid=(SELECT account_sid FROM public.a2p_accounts WHERE organization_id=p_org),
  affinity_service_sid=(SELECT messaging_service_sid FROM public.a2p_registrations WHERE organization_id=p_org)
 WHERE organization_id=p_org AND request_key=p_key RETURNING * INTO row;
 IF p_override IS NOT NULL THEN PERFORM private.affinity_event(p_org,p_phone,'sms','one_text',p_actor,chosen,number,p_key);END IF;
 RETURN to_jsonb(row);
END $$;
CREATE FUNCTION public.sms_prepare_dispatch(p_org uuid,p_key text,p_phone text,p_from text,p_body text,p_purpose text,p_hash text,p_evidence uuid[],
 p_actor uuid DEFAULT NULL,p_contact uuid DEFAULT NULL,p_type text DEFAULT NULL,p_confirmation uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT private.affinity_prepare(p_org,p_key,p_phone,p_from,p_body,p_purpose,p_hash,p_evidence,p_actor,p_contact,p_type,p_confirmation,false,NULL,NULL)
$$;
CREATE FUNCTION public.sms_prepare_bound_dispatch(p_org uuid,p_key text,p_phone text,p_from text,p_body text,p_purpose text,p_hash text,p_evidence uuid[],
 p_actor uuid DEFAULT NULL,p_contact uuid DEFAULT NULL,p_type text DEFAULT NULL,p_confirmation uuid DEFAULT NULL,p_expected uuid DEFAULT NULL,p_override uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT private.affinity_prepare(p_org,p_key,p_phone,p_from,p_body,p_purpose,p_hash,p_evidence,p_actor,p_contact,p_type,p_confirmation,true,p_expected,p_override)
$$;
CREATE FUNCTION public.sms_authorize_bound_dispatch(p_org uuid,p_key text,p_number uuid,p_from text,p_account text,p_service text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.sms_dispatches;
BEGIN
 SELECT * INTO STRICT d FROM public.sms_dispatches WHERE organization_id=p_org AND request_key=p_key;
 PERFORM private.affinity_lock(p_org,d.phone_e164);
 IF d.state<>'prepared' OR d.affinity_number_id IS DISTINCT FROM p_number OR d.from_number IS DISTINCT FROM p_from
  OR d.affinity_account_sid IS DISTINCT FROM p_account OR d.affinity_service_sid IS DISTINCT FROM p_service
 THEN RAISE EXCEPTION 'affinity_handoff_mismatch';END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.sms_start_dispatch(p_org uuid,p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.sms_dispatches; a private.contact_number_affinities; mode text; claims text;
BEGIN
 SELECT * INTO STRICT d FROM public.sms_dispatches WHERE organization_id=p_org AND request_key=p_key;
 PERFORM private.affinity_lock(p_org,d.phone_e164);
 SELECT * INTO d FROM public.sms_dispatches WHERE organization_id=p_org AND request_key=p_key FOR UPDATE;
 IF d.state<>'prepared' THEN RETURN false;END IF;
 mode:=private.affinity_mode(p_org,'sms');
 IF mode IN ('enforced','guard_only') AND NOT private.affinity_internal_alert(p_org,p_key,d.from_number,d.phone_e164,d.actor_id,d.purpose) THEN
  IF d.affinity_number_id IS NULL THEN RAISE EXCEPTION 'affinity_legacy_unbound';END IF;
  SELECT * INTO a FROM private.contact_number_affinities WHERE organization_id=p_org AND phone_e164=d.phone_e164;
  IF a.generation IS DISTINCT FROM d.affinity_generation OR (NOT d.affinity_override AND (a.sms_state='needs_review'
   OR coalesce(a.sms_number_id,a.voice_number_id) IS DISTINCT FROM d.affinity_number_id)) THEN RAISE EXCEPTION 'affinity_binding_changed';END IF;
  IF private.affinity_number(p_org,d.affinity_number_id,'sms',d.actor_id,d.affinity_override)->>'readiness'<>'ready'
   OR NOT EXISTS(SELECT 1 FROM public.phone_numbers WHERE id=d.affinity_number_id AND organization_id=p_org AND phone_number=d.from_number)
   OR NOT EXISTS(SELECT 1 FROM public.a2p_accounts acct JOIN public.a2p_registrations r USING(organization_id) WHERE acct.organization_id=p_org
    AND acct.account_sid=d.affinity_account_sid AND r.messaging_service_sid=d.affinity_service_sid) THEN RAISE EXCEPTION 'affinity_sender_unready';END IF;
  claims:=private.affinity_actor_claims(p_org,coalesce(d.affinity_actor_id,d.actor_id));
  PERFORM private.affinity_assert_contact(p_org,coalesce(d.affinity_contact_id,d.contact_id),coalesce(d.affinity_contact_type,d.contact_type),d.phone_e164);
  PERFORM set_config('request.jwt.claims',coalesce(claims,''),true);
 END IF;
 RETURN private.affinity_start_original(p_org,p_key);
END $$;
CREATE FUNCTION public.sms_cancel_prepared_dispatch(p_org uuid,p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE phone text;
BEGIN
 SELECT phone_e164 INTO phone FROM public.sms_dispatches WHERE organization_id=p_org AND request_key=p_key;
 IF phone IS NULL THEN RETURN false;END IF;PERFORM private.affinity_lock(p_org,phone);
 UPDATE public.sms_dispatches SET state='failed',error_code='pre_handoff_cancelled',updated_at=clock_timestamp()
 WHERE organization_id=p_org AND request_key=p_key AND state='prepared';RETURN FOUND;
END $$;
CREATE FUNCTION private.affinity_accept_sms(p_org uuid,p_key text) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d public.sms_dispatches; a private.contact_number_affinities;
BEGIN
 SELECT * INTO d FROM public.sms_dispatches WHERE organization_id=p_org AND request_key=p_key;
 IF d.affinity_number_id IS NULL OR d.affinity_override OR d.provider_sid IS NULL OR private.affinity_mode(p_org,'sms')<>'enforced' THEN RETURN;END IF;
 SELECT * INTO a FROM private.contact_number_affinities WHERE organization_id=p_org AND phone_e164=d.phone_e164 FOR UPDATE;
 IF a.generation IS DISTINCT FROM d.affinity_generation OR a.sms_number_id IS DISTINCT FROM d.affinity_number_id OR a.sms_state<>'reserved' THEN RETURN;END IF;
 UPDATE private.contact_number_affinities SET sms_state='established',sms_version=sms_version+1,updated_at=clock_timestamp()
 WHERE organization_id=p_org AND phone_e164=d.phone_e164;
 PERFORM private.affinity_event(p_org,d.phone_e164,'sms','established',d.actor_id,d.affinity_number_id,d.from_number,'sms:'||p_key);
 IF a.voice_number_id IS NULL AND a.voice_state='unassigned' AND private.affinity_mode(p_org,'voice')='enforced'
  AND private.affinity_number(p_org,d.affinity_number_id,'voice')->>'readiness'='ready' THEN
  UPDATE private.contact_number_affinities SET voice_number_id=d.affinity_number_id,voice_number=d.from_number,voice_state='established',voice_version=voice_version+1,
   voice_source='sms_common',voice_event='sms:'||p_key WHERE organization_id=p_org AND phone_e164=d.phone_e164;
  PERFORM private.affinity_event(p_org,d.phone_e164,'voice','common_number',d.actor_id,d.affinity_number_id,d.from_number,'sms:'||p_key);
 END IF;
END $$;
CREATE FUNCTION public.sms_finish_dispatch(p_org uuid,p_key text,p_state text,p_sid text,p_status text,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.sms_dispatches; result jsonb;
BEGIN
 SELECT * INTO STRICT d FROM public.sms_dispatches WHERE organization_id=p_org AND request_key=p_key;
 PERFORM private.affinity_lock(p_org,d.phone_e164);
 BEGIN result:=private.affinity_finish_original(p_org,p_key,p_state,p_sid,p_status,p_error);
 EXCEPTION WHEN OTHERS THEN
  -- Preserve acceptance even when the history INSERT/confirmation save rolls back.
  IF p_state<>'accepted' OR p_sid IS NULL OR p_sid !~ '^SM[0-9a-fA-F]{32}$' OR p_status IS NULL OR d.state NOT IN ('attempting','uncertain') THEN RAISE;END IF;
  UPDATE public.sms_dispatches SET state='uncertain',provider_sid=p_sid,provider_status=p_status,error_code='receipt_persistence',updated_at=clock_timestamp()
   WHERE organization_id=p_org AND request_key=p_key RETURNING to_jsonb(sms_dispatches) INTO result;
 END;
 IF p_state='accepted' THEN PERFORM private.affinity_accept_sms(p_org,p_key);END IF;
 RETURN result;
END $$;

CREATE FUNCTION private.affinity_all_editable(p_org uuid,p_phone text,p_actor uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE role_name text; owner_id uuid;
BEGIN
 SELECT role INTO role_name FROM public.profiles WHERE id=p_actor AND organization_id=p_org AND status='Active';
 IF role_name='Admin' THEN RETURN true;END IF;
 IF role_name IS NULL THEN RETURN false;END IF;
 FOR owner_id IN SELECT user_id FROM public.leads WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=substr(p_phone,2)
  UNION ALL SELECT assigned_agent_id FROM public.clients WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=substr(p_phone,2)
  UNION ALL SELECT assigned_agent_id FROM public.recruits WHERE organization_id=p_org AND private.phone_digits_e164ish(phone)=substr(p_phone,2) LOOP
  IF owner_id IS DISTINCT FROM p_actor AND NOT(role_name='Team Leader' AND owner_id IS NOT NULL AND public.is_ancestor_of(p_actor,owner_id)) THEN RETURN false;END IF;
 END LOOP;RETURN true;
END $$;
CREATE FUNCTION public.change_contact_number(p_contact uuid,p_type text,p_channel text,p_number uuid,p_generation bigint,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; scope jsonb; a private.contact_number_affinities; number text;
BEGIN
 SELECT organization_id INTO org FROM public.profiles WHERE id=auth.uid() AND status='Active';scope:=private.affinity_assert_contact(org,p_contact,p_type);
 IF p_channel NOT IN ('voice','sms','both') OR length(btrim(p_reason)) NOT BETWEEN 3 AND 200 THEN RAISE EXCEPTION 'affinity_change_invalid';END IF;
 PERFORM private.affinity_ensure(org,scope->>'phone');SELECT * INTO a FROM private.contact_number_affinities WHERE organization_id=org AND phone_e164=scope->>'phone' FOR UPDATE;
 IF NOT private.affinity_all_editable(org,a.phone_e164,auth.uid()) THEN RAISE EXCEPTION 'affinity_admin_resolution' USING ERRCODE='42501';END IF;
 IF a.generation IS DISTINCT FROM p_generation THEN RAISE EXCEPTION 'affinity_stale';END IF;
 IF private.affinity_unresolved(org,a.phone_e164) THEN RAISE EXCEPTION 'affinity_send_unresolved';END IF;
 IF p_number IS NOT NULL THEN
  IF p_channel IN ('voice','both') AND private.affinity_number(org,p_number,'voice',auth.uid(),false)->>'readiness'<>'ready' THEN RAISE EXCEPTION 'affinity_sender_unready';END IF;
  IF p_channel IN ('sms','both') AND private.affinity_number(org,p_number,'sms',auth.uid(),false)->>'readiness'<>'ready' THEN RAISE EXCEPTION 'affinity_sender_unready';END IF;
  SELECT phone_number INTO number FROM public.phone_numbers WHERE id=p_number AND organization_id=org;
 END IF;
 UPDATE private.contact_number_affinities SET generation=generation+1,history_state='reconciled',
 voice_number_id=CASE WHEN p_channel IN ('voice','both') THEN p_number ELSE voice_number_id END,
 voice_number=CASE WHEN p_channel IN ('voice','both') THEN number ELSE voice_number END,
 voice_state=CASE WHEN p_channel IN ('voice','both') THEN CASE WHEN p_number IS NULL THEN 'needs_review' ELSE 'established' END ELSE voice_state END,
 voice_version=voice_version+CASE WHEN p_channel IN ('voice','both') THEN 1 ELSE 0 END,
 voice_source=CASE WHEN p_channel IN ('voice','both') THEN 'deliberate' ELSE voice_source END,
 sms_number_id=CASE WHEN p_channel IN ('sms','both') THEN p_number ELSE sms_number_id END,
 sms_number=CASE WHEN p_channel IN ('sms','both') THEN number ELSE sms_number END,
 sms_state=CASE WHEN p_channel IN ('sms','both') THEN CASE WHEN p_number IS NULL THEN 'needs_review' ELSE 'established' END ELSE sms_state END,
 sms_version=sms_version+CASE WHEN p_channel IN ('sms','both') THEN 1 ELSE 0 END,
 sms_source=CASE WHEN p_channel IN ('sms','both') THEN 'deliberate' ELSE sms_source END,updated_at=clock_timestamp()
 WHERE organization_id=org AND phone_e164=a.phone_e164;
 PERFORM private.affinity_event(org,a.phone_e164,p_channel,CASE WHEN p_number IS NULL THEN 'reset_review' ELSE 'reassigned' END,auth.uid(),p_number,number,NULL,jsonb_build_object('reason',btrim(p_reason)));
 RETURN private.affinity_view(org,a.phone_e164,auth.uid());
END $$;

DO $seal$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'affinity_%'
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.signature);END LOOP;
END $seal$;
GRANT EXECUTE ON FUNCTION private.affinity_phone(text),private.phone_digits_e164ish(text) TO agentflow_affinity_scope;
REVOKE ALL ON FUNCTION public.sms_prepare_dispatch(uuid,text,text,text,text,text,text,uuid[],uuid,uuid,text,uuid),
 public.sms_prepare_bound_dispatch(uuid,text,text,text,text,text,text,uuid[],uuid,uuid,text,uuid,uuid,uuid),
 public.sms_authorize_bound_dispatch(uuid,text,uuid,text,text,text),public.sms_start_dispatch(uuid,text),public.sms_finish_dispatch(uuid,text,text,text,text,text),
 public.sms_cancel_prepared_dispatch(uuid,text),public.change_contact_number(uuid,text,text,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sms_prepare_dispatch(uuid,text,text,text,text,text,text,uuid[],uuid,uuid,text,uuid),
 public.sms_prepare_bound_dispatch(uuid,text,text,text,text,text,text,uuid[],uuid,uuid,text,uuid,uuid,uuid),
 public.sms_authorize_bound_dispatch(uuid,text,uuid,text,text,text),public.sms_start_dispatch(uuid,text),public.sms_finish_dispatch(uuid,text,text,text,text,text),
 public.sms_cancel_prepared_dispatch(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.change_contact_number(uuid,text,text,uuid,bigint,text) TO authenticated;
