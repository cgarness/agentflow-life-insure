SET LOCAL lock_timeout='3s';
CREATE TABLE private.contact_number_inbound_sms (
 organization_id uuid NOT NULL,provider_sid text NOT NULL,account_sid text NOT NULL,phone_e164 text NOT NULL,
 number_id uuid NOT NULL,number_snapshot text NOT NULL,ordinary boolean NOT NULL,one_off_reply boolean NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organization_id,provider_sid)
);
CREATE INDEX contact_number_inbound_sms_endpoint ON private.contact_number_inbound_sms(organization_id,phone_e164,observed_at DESC);
CREATE TABLE private.contact_number_reconciliation (
 organization_id uuid PRIMARY KEY,cursor_phone text,complete boolean NOT NULL DEFAULT false,
 scanned bigint NOT NULL DEFAULT 0,review_count bigint NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION private.affinity_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM private.contact_number_enforcement WHERE organization_id=OLD.organization_id AND sms_ever)
  AND (TG_OP='DELETE' OR NOT NEW.enforced OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
 THEN RAISE EXCEPTION 'affinity_policy_must_remain_enforced';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER affinity_policy_stays_enforced BEFORE DELETE OR UPDATE ON public.sms_agency_policies FOR EACH ROW EXECUTE FUNCTION private.affinity_policy_guard();
CREATE FUNCTION private.affinity_activation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.sms_mode='enforced' AND NOT EXISTS(SELECT 1 FROM public.sms_agency_policies WHERE organization_id=NEW.organization_id AND enforced)
 THEN RAISE EXCEPTION 'affinity_sms_policy_required';END IF;RETURN NEW;
END $$;
CREATE TRIGGER affinity_activation_policy BEFORE INSERT OR UPDATE ON private.contact_number_settings FOR EACH ROW EXECUTE FUNCTION private.affinity_activation_guard();
CREATE FUNCTION public.sms_describe_contact_sender(p_org uuid,p_actor uuid,p_contact uuid,p_type text,p_override uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claims text; scope jsonb; result jsonb;
BEGIN
 claims:=private.affinity_actor_claims(p_org,p_actor);scope:=private.affinity_assert_contact(p_org,p_contact,p_type);
 result:=private.affinity_view(p_org,scope->>'phone',p_actor);
 IF p_override IS NOT NULL THEN result:=jsonb_set(result,'{sms}',private.affinity_number(p_org,p_override,'sms',p_actor,true)||jsonb_build_object('state','one_text','version',0));END IF;
 PERFORM set_config('request.jwt.claims',coalesce(claims,''),true);RETURN result;
END $$;
CREATE FUNCTION public.observe_contact_inbound_sms(p_org uuid,p_from text,p_to text,p_sid text,p_account text,p_body text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE phone text:=private.affinity_phone(p_from); snapshot text:=private.affinity_phone(p_to); n public.phone_numbers;
 a private.contact_number_affinities; old private.contact_number_inbound_sms; ordinary boolean; oneoff boolean; mode text;
BEGIN
 IF p_sid !~ '^SM[0-9a-fA-F]{32}$' OR p_account !~ '^AC[0-9a-fA-F]{32}$' OR p_sid IS NULL OR p_account IS NULL THEN RAISE EXCEPTION 'affinity_inbound_provenance';END IF;
 SELECT * INTO n FROM public.phone_numbers WHERE organization_id=p_org AND phone_number=snapshot AND assignment_type='agency' AND NOT inbounds_only;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM private.affinity_lock(p_org,phone);
 SELECT * INTO old FROM private.contact_number_inbound_sms WHERE organization_id=p_org AND provider_sid=p_sid;
 IF FOUND THEN
  IF old.phone_e164 IS DISTINCT FROM phone OR old.number_id IS DISTINCT FROM n.id OR old.account_sid IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'affinity_inbound_replay_mismatch';END IF;
  RETURN old.ordinary AND NOT old.one_off_reply;
 END IF;
 ordinary:=upper(btrim(coalesce(p_body,''))) NOT IN ('','STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','HELP','START','UNSTOP');
 oneoff:=EXISTS(SELECT 1 FROM public.sms_dispatches WHERE organization_id=p_org AND phone_e164=phone AND from_number=snapshot AND affinity_override
  AND state IN ('attempting','accepted','uncertain'));
 INSERT INTO private.contact_number_inbound_sms(organization_id,provider_sid,account_sid,phone_e164,number_id,number_snapshot,ordinary,one_off_reply)
 VALUES(p_org,p_sid,p_account,phone,n.id,snapshot,ordinary,oneoff);
 mode:=private.affinity_mode(p_org,'sms');
 IF mode='shadow' THEN
  INSERT INTO private.contact_number_observations(organization_id,evidence_key,phone_e164,channel,candidate_id,details)
  VALUES(p_org,'inbound:'||p_sid,phone,'sms',n.id,jsonb_build_object('ordinary',ordinary,'one_off_reply',oneoff)) ON CONFLICT DO NOTHING;
  RETURN false;
 END IF;
 IF mode<>'enforced' OR NOT ordinary OR oneoff THEN RETURN false;END IF;
 PERFORM private.affinity_ensure(p_org,phone);
 SELECT * INTO a FROM private.contact_number_affinities WHERE organization_id=p_org AND phone_e164=phone FOR UPDATE;
 IF a.sms_state<>'unassigned' OR a.history_state='needs_review' OR private.affinity_unresolved(p_org,phone) THEN
  PERFORM private.affinity_event(p_org,phone,'sms','inbound_observed',NULL,n.id,snapshot,p_sid);RETURN false;
 END IF;
 UPDATE private.contact_number_affinities SET sms_number_id=n.id,sms_number=snapshot,sms_state='established',sms_source='signed_inbound',sms_event=p_sid,
 sms_version=sms_version+1,updated_at=clock_timestamp() WHERE organization_id=p_org AND phone_e164=phone;
 PERFORM private.affinity_event(p_org,phone,'sms','signed_inbound',NULL,n.id,snapshot,p_sid);
 IF a.voice_state='unassigned' AND private.affinity_mode(p_org,'voice')='enforced' AND private.affinity_number(p_org,n.id,'voice')->>'readiness'='ready' THEN
  UPDATE private.contact_number_affinities SET voice_number_id=n.id,voice_number=snapshot,voice_state='established',voice_source='sms_common',voice_event=p_sid,
  voice_version=voice_version+1 WHERE organization_id=p_org AND phone_e164=phone;
  PERFORM private.affinity_event(p_org,phone,'voice','common_number',NULL,n.id,snapshot,p_sid);
 END IF;RETURN true;
END $$;

CREATE FUNCTION public.reconcile_contact_number_history(p_org uuid,p_after text DEFAULT NULL,p_limit integer DEFAULT 100,p_dry_run boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; a private.contact_number_affinities; ids uuid[]; snaps text[]; last_phone text:=p_after;
 n integer:=0; reviews integer:=0; seeded integer:=0; ambiguous boolean; more boolean:=false;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'affinity_batch_limit';END IF;
 FOR r IN WITH phones AS (
 SELECT private.phone_digits_e164ish(phone) phone FROM public.leads WHERE organization_id=p_org
 UNION SELECT private.phone_digits_e164ish(phone) FROM public.clients WHERE organization_id=p_org
 UNION SELECT private.phone_digits_e164ish(phone) FROM public.recruits WHERE organization_id=p_org
 UNION SELECT private.phone_digits_e164ish(contact_phone) FROM public.calls WHERE organization_id=p_org
 UNION SELECT private.phone_digits_e164ish(CASE WHEN direction IN ('outbound','outgoing') THEN to_number ELSE from_number END) FROM public.messages WHERE organization_id=p_org
 UNION SELECT substr(phone_e164,2) FROM private.contact_number_affinities WHERE organization_id=p_org)
 SELECT '+'||phone phone FROM phones WHERE phone ~ '^[1-9][0-9]{6,14}$' AND (p_after IS NULL OR '+'||phone>p_after)
 ORDER BY phone LIMIT p_limit+1 LOOP
  IF n=p_limit THEN more:=true;EXIT;END IF;n:=n+1;last_phone:=r.phone;
  PERFORM private.affinity_lock(p_org,r.phone);
  SELECT * INTO a FROM private.contact_number_affinities WHERE organization_id=p_org AND phone_e164=r.phone FOR UPDATE;
  IF a.generation>0 OR a.sms_state IN ('reserved','established') OR a.voice_state='established' THEN CONTINUE;END IF;
  SELECT array_agg(DISTINCT id),array_agg(DISTINCT snapshot) INTO ids,snaps FROM (
   SELECT coalesce(d.affinity_number_id,nm.id) id,d.from_number snapshot FROM public.sms_dispatches d LEFT JOIN public.phone_numbers nm
    ON nm.organization_id=d.organization_id AND nm.phone_number=d.from_number AND nm.created_at<=d.created_at
   WHERE d.organization_id=p_org AND d.phone_e164=r.phone AND d.state='accepted' AND d.provider_sid ~ '^SM[0-9a-fA-F]{32}$'
    AND NOT d.affinity_override AND NOT private.affinity_internal_alert(p_org,d.request_key,d.from_number,d.phone_e164,d.actor_id,d.purpose)
   UNION ALL SELECT number_id,number_snapshot FROM private.contact_number_inbound_sms WHERE organization_id=p_org AND phone_e164=r.phone AND ordinary AND NOT one_off_reply
  ) evidence;
  ambiguous:=coalesce(cardinality(ids)>1 OR cardinality(snaps)>1 OR array_position(ids,NULL) IS NOT NULL,false)
   OR private.affinity_unresolved(p_org,r.phone)
   OR EXISTS(SELECT 1 FROM public.messages m WHERE m.organization_id=p_org
    AND private.phone_digits_e164ish(CASE WHEN m.direction IN ('outbound','outgoing') THEN m.to_number ELSE m.from_number END)=substr(r.phone,2)
    AND NOT EXISTS(SELECT 1 FROM public.sms_dispatches d WHERE d.organization_id=p_org AND d.provider_sid=m.provider_message_id AND d.state='accepted'
      AND d.phone_e164=r.phone AND d.from_number=m.from_number AND d.body=m.body)
    AND NOT EXISTS(SELECT 1 FROM private.contact_number_inbound_sms i WHERE i.organization_id=p_org AND i.provider_sid=m.provider_message_id
      AND i.phone_e164=r.phone AND i.number_snapshot=m.to_number));
  -- Legacy qualified voice evidence lacks historical override provenance. Surface it for
  -- review; never fabricate a new call binding or silently infer an intentional assignment.
  ambiguous:=ambiguous OR EXISTS(SELECT 1 FROM public.calls c JOIN public.dispositions d ON d.id=c.disposition_id AND d.organization_id=c.organization_id
   WHERE c.organization_id=p_org AND private.phone_digits_e164ish(c.contact_phone)=substr(r.phone,2) AND d.affinity_class IN ('duration','confirmed')
    AND c.status='completed' AND c.duration>0 AND NOT EXISTS(SELECT 1 FROM private.contact_number_call_bindings WHERE call_id=c.id));
  IF ambiguous THEN reviews:=reviews+1;ELSIF cardinality(ids)=1 THEN seeded:=seeded+1;END IF;
  IF NOT p_dry_run THEN
   INSERT INTO private.contact_number_affinities(organization_id,phone_e164) VALUES(p_org,r.phone) ON CONFLICT DO NOTHING;
   UPDATE private.contact_number_affinities SET history_state=CASE WHEN ambiguous THEN 'needs_review' ELSE 'reconciled' END,
    sms_state=CASE WHEN ambiguous THEN 'needs_review' WHEN cardinality(ids)=1 THEN 'established' ELSE sms_state END,
    sms_number_id=CASE WHEN NOT ambiguous AND cardinality(ids)=1 THEN ids[1] ELSE sms_number_id END,
    sms_number=CASE WHEN NOT ambiguous AND cardinality(ids)=1 THEN snaps[1] ELSE sms_number END,
    sms_source=CASE WHEN NOT ambiguous AND cardinality(ids)=1 THEN 'verified_history' ELSE sms_source END,
    sms_version=sms_version+CASE WHEN NOT ambiguous AND cardinality(ids)=1 THEN 1 ELSE 0 END,updated_at=clock_timestamp()
   WHERE organization_id=p_org AND phone_e164=r.phone AND generation=0 AND sms_state NOT IN ('reserved','established') AND voice_state<>'established'
    AND (history_state IS DISTINCT FROM CASE WHEN ambiguous THEN 'needs_review' ELSE 'reconciled' END OR (NOT ambiguous AND cardinality(ids)=1));
   IF FOUND THEN PERFORM private.affinity_event(p_org,r.phone,'both',CASE WHEN ambiguous THEN 'history_review' ELSE 'history_reconciled' END,NULL,NULL,NULL,'backfill');END IF;
  END IF;
 END LOOP;
 IF NOT p_dry_run THEN INSERT INTO private.contact_number_reconciliation(organization_id,cursor_phone,complete,scanned,review_count)
  VALUES(p_org,last_phone,NOT more,n,reviews) ON CONFLICT(organization_id) DO UPDATE SET cursor_phone=excluded.cursor_phone,complete=excluded.complete,
  scanned=contact_number_reconciliation.scanned+excluded.scanned,review_count=contact_number_reconciliation.review_count+excluded.review_count,updated_at=clock_timestamp();END IF;
 RETURN jsonb_build_object('scanned',n,'review',reviews,'seeded',seeded,'cursor',last_phone,'complete',NOT more,'dry_run',p_dry_run);
END $$;
CREATE FUNCTION public.set_contact_number_modes(p_org uuid,p_voice text,p_sms text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_voice='enforced' OR p_sms='enforced' THEN
  IF NOT EXISTS(SELECT 1 FROM private.contact_number_reconciliation WHERE organization_id=p_org AND complete)
   THEN RAISE EXCEPTION 'affinity_reconciliation_required';END IF;
 END IF;
 INSERT INTO private.contact_number_settings(organization_id,voice_mode,sms_mode) VALUES(p_org,p_voice,p_sms)
 ON CONFLICT(organization_id) DO UPDATE SET voice_mode=excluded.voice_mode,sms_mode=excluded.sms_mode,updated_at=clock_timestamp();
 RETURN public.sticky_number_guard(p_org);
END $$;

DO $seal$ DECLARE r record;BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='private' AND tablename LIKE 'contact_number_%' LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',r.tablename);EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',r.tablename);END LOOP;
 FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'affinity_%'
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.signature);END LOOP;
END $seal$;
GRANT EXECUTE ON FUNCTION private.affinity_phone(text),private.phone_digits_e164ish(text) TO agentflow_affinity_scope;
REVOKE ALL ON FUNCTION public.sms_describe_contact_sender(uuid,uuid,uuid,text,uuid),public.observe_contact_inbound_sms(uuid,text,text,text,text,text),
 public.reconcile_contact_number_history(uuid,text,integer,boolean),public.set_contact_number_modes(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sms_describe_contact_sender(uuid,uuid,uuid,text,uuid),public.observe_contact_inbound_sms(uuid,text,text,text,text,text),
 public.reconcile_contact_number_history(uuid,text,integer,boolean),public.set_contact_number_modes(uuid,text,text) TO service_role;

CREATE FUNCTION public.contact_number_options(p_contact uuid,p_type text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid;
BEGIN
 SELECT organization_id INTO org FROM public.profiles WHERE id=auth.uid() AND status='Active';
 PERFORM private.affinity_assert_contact(org,p_contact,p_type);
 RETURN (SELECT coalesce(jsonb_agg(private.affinity_number(org,n.id,'sms',auth.uid(),true)||jsonb_build_object('voice_readiness',private.affinity_number(org,n.id,'voice',auth.uid(),true)->>'readiness') ORDER BY n.phone_number),'[]')
 FROM public.phone_numbers n WHERE n.organization_id=org AND lower(n.status)='active' AND NOT n.inbounds_only
 AND (n.assignment_type='agency' OR (n.assignment_type='personal' AND n.assigned_to=auth.uid())));
END $$;
REVOKE ALL ON FUNCTION public.contact_number_options(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.contact_number_options(uuid,text) TO authenticated;

CREATE FUNCTION private.affinity_disposition_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.affinity_class<>'unreviewed') OR (TG_OP='UPDATE' AND NEW.affinity_class IS DISTINCT FROM OLD.affinity_class) THEN
  IF auth.uid() IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND organization_id=NEW.organization_id AND status='Active' AND role='Admin')
   THEN RAISE EXCEPTION 'affinity_disposition_admin' USING ERRCODE='42501';END IF;
 END IF;
 IF NEW.dnc_auto_add OR NEW.auto_add_to_dnc THEN NEW.affinity_class:='excluded';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.affinity_disposition_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER affinity_disposition_class_guard BEFORE INSERT OR UPDATE ON public.dispositions FOR EACH ROW EXECUTE FUNCTION private.affinity_disposition_guard();

CREATE FUNCTION public.contact_number_modes() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid;
BEGIN SELECT organization_id INTO org FROM public.profiles WHERE id=auth.uid() AND status='Active';
 IF org IS NULL OR org IS DISTINCT FROM public.get_org_id() THEN RAISE EXCEPTION 'affinity_actor' USING ERRCODE='42501';END IF;
 RETURN public.sticky_number_guard(org);END $$;
REVOKE ALL ON FUNCTION public.contact_number_modes() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.contact_number_modes() TO authenticated;

-- Accessible endpoint identity only; no inbound body, sender record or related contact is exposed.
CREATE OR REPLACE FUNCTION private.affinity_view(p_org uuid,p_phone text,p_actor uuid,p_group uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE a private.contact_number_affinities; v uuid; s uuid; history text; vm text; sm text;
BEGIN
 SELECT * INTO a FROM private.contact_number_affinities WHERE organization_id=p_org AND phone_e164=p_phone;
 history:=coalesce(a.history_state,CASE WHEN private.affinity_has_history(p_org,p_phone) THEN 'needs_review' ELSE 'new' END);
 vm:=private.affinity_mode(p_org,'voice');sm:=private.affinity_mode(p_org,'sms');
 v:=coalesce(a.voice_number_id,a.sms_number_id);s:=coalesce(a.sms_number_id,a.voice_number_id);
 IF v IS NULL AND history<>'needs_review' AND a.voice_state IS DISTINCT FROM 'needs_review' THEN v:=private.affinity_default(p_org,'voice',p_actor,p_group);END IF;
 IF s IS NULL AND history<>'needs_review' AND sm<>'guard_only' AND a.sms_state IS DISTINCT FROM 'needs_review' THEN s:=private.affinity_default(p_org,'sms',p_actor);END IF;
 RETURN jsonb_build_object('voice_mode',vm,'sms_mode',sm,'generation',coalesce(a.generation,0),'history',history,
 'reply', (SELECT private.affinity_number(p_org,i.number_id,'sms',p_actor)||jsonb_build_object('number',i.number_snapshot) FROM private.contact_number_inbound_sms i WHERE i.organization_id=p_org AND i.phone_e164=p_phone AND i.ordinary AND i.number_id IS DISTINCT FROM s ORDER BY i.observed_at DESC LIMIT 1),
 'voice',private.affinity_number(p_org,v,'voice',p_actor,false,p_group)||jsonb_build_object('number',coalesce(a.voice_number,a.sms_number,(SELECT phone_number FROM public.phone_numbers WHERE id=v AND organization_id=p_org)),'state',coalesce(a.voice_state,'unassigned'),'version',coalesce(a.voice_version,0)),
 'sms',private.affinity_number(p_org,s,'sms',p_actor)||jsonb_build_object('number',coalesce(a.sms_number,a.voice_number,(SELECT phone_number FROM public.phone_numbers WHERE id=s AND organization_id=p_org)),'state',coalesce(a.sms_state,'unassigned'),'version',coalesce(a.sms_version,0)));
END $$;
