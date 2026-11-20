-- Sticky Contact Numbers: keep established voice identities usable at the operational cap.
-- Approved by Chris November 20, 2026. No settings, assignments, counters or communication data change.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- All reads and replacements are atomic under the migration runner transaction.
-- Refuse replay or drift in the wrappers and the readiness/scope/admission contracts.
DO $preimage$
DECLARE expected jsonb; actual jsonb; function_oid oid;
BEGIN
 IF to_regprocedure('private.affinity_voice_number(uuid,text,uuid,uuid,boolean,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'sticky voice cap correction already present';
 END IF;
 FOR expected IN SELECT value FROM jsonb_array_elements($catalog$[{"signature":"private.affinity_number(uuid,uuid,text,uuid,boolean,uuid)","md5":"04617e0576eaf471b1a52124a9293252","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"},{"signature":"public.admit_twilio_outbound(uuid,text,text,text,text)","md5":"149bea68ea843c4790e292fc1438b06e","owner":"postgres","security_definer":true,"config":["search_path=pg_catalog, pg_temp"],"acl":"{postgres=X/postgres,service_role=X/postgres}","volatility":"v"},{"signature":"public.authorize_contact_call(uuid,uuid,text,text,text,uuid,uuid,uuid,boolean)","md5":"8a9fbdd85739abec3d1481e2706a1ce6","owner":"postgres","security_definer":true,"config":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","volatility":"v"},{"signature":"private.affinity_admit_original(uuid,text,text,text,text)","md5":"298cceaaf17a494b1736ce9b3c4fc4fc","owner":"postgres","security_definer":true,"config":["search_path=pg_catalog, pg_temp"],"acl":"{postgres=X/postgres}","volatility":"v"},{"signature":"private.affinity_default(uuid,text,uuid,uuid)","md5":"41ff1911d3b82d8bbace92b2ebc98d6c","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"},{"signature":"private.affinity_process_call(uuid)","md5":"27bc67b3418b02c0330622e4e059a729","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"v"},{"signature":"private.affinity_view(uuid,text,uuid,uuid)","md5":"267af2312e83540016c838d9b211a448","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"},{"signature":"private.affinity_voice_scope(uuid,uuid,uuid,text,text,uuid,uuid,boolean)","md5":"55de8731da7051ddbbec29d5f52ad702","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"}]$catalog$::jsonb) LOOP
  function_oid := to_regprocedure(expected->>'signature');
  SELECT jsonb_build_object('signature',expected->>'signature','md5',md5(pg_get_functiondef(p.oid)),
   'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',to_jsonb(p.proconfig),
   'acl',p.proacl::text,'volatility',p.provolatile::text)
  INTO actual FROM pg_proc p WHERE p.oid=function_oid;
  IF actual IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'sticky voice cap preimage drift: %', expected->>'signature';
  END IF;
 END LOOP;
END $preimage$;

-- A daily cap limits rotation, not reuse of a proven endpoint relationship.
-- This private helper delegates every ordinary eligibility check unchanged. It
-- never exempts a one-call override, reservation, arbitrary candidate or review.
CREATE FUNCTION private.affinity_voice_number(
 p_org uuid, p_phone text, p_number uuid, p_actor uuid,
 p_manual boolean DEFAULT false, p_group uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
 result := private.affinity_number(p_org,p_number,'voice',p_actor,p_manual,p_group);
 IF result->>'readiness' = 'daily_limit'
  AND p_manual IS FALSE
  AND private.affinity_mode(p_org,'voice') IN ('enforced','guard_only')
  AND EXISTS (
   SELECT 1 FROM private.contact_number_affinities a
   WHERE a.organization_id=p_org AND a.phone_e164=p_phone
    AND a.history_state IN ('new','reconciled')
    AND (
     (a.voice_state='established' AND a.voice_number_id=p_number)
     OR (a.voice_state='unassigned' AND a.voice_number_id IS NULL
      AND a.sms_state='established' AND a.sms_number_id=p_number)
    )
  ) THEN
  result := jsonb_set(result,'{readiness}','"ready"'::jsonb);
 END IF;
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION private.affinity_voice_number(uuid,text,uuid,uuid,boolean,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION private.affinity_voice_number(uuid,text,uuid,uuid,boolean,uuid)
 IS 'Endpoint-scoped voice readiness: established identity reuse ignores only the operational daily cap; all other eligibility and rotation rules remain unchanged.';

CREATE OR REPLACE FUNCTION private.affinity_view(p_org uuid, p_phone text, p_actor uuid, p_group uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
 'voice',private.affinity_voice_number(p_org,p_phone,v,p_actor,false,p_group)||jsonb_build_object('number',coalesce(a.voice_number,a.sms_number,(SELECT phone_number FROM public.phone_numbers WHERE id=v AND organization_id=p_org)),'state',coalesce(a.voice_state,'unassigned'),'version',coalesce(a.voice_version,0)),
 'sms',private.affinity_number(p_org,s,'sms',p_actor)||jsonb_build_object('number',coalesce(a.sms_number,a.voice_number,(SELECT phone_number FROM public.phone_numbers WHERE id=s AND organization_id=p_org)),'state',coalesce(a.sms_state,'unassigned'),'version',coalesce(a.sms_version,0)));
END $function$;

CREATE OR REPLACE FUNCTION public.authorize_contact_call(p_call uuid, p_contact uuid, p_type text, p_phone text, p_candidate text, p_campaign uuid DEFAULT NULL::uuid, p_member uuid DEFAULT NULL::uuid, p_override uuid DEFAULT NULL::uuid, p_unsaved boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 IF chosen IS NULL OR private.affinity_voice_number(org,p_phone,chosen,auth.uid(),p_override IS NOT NULL,grp)->>'readiness'<>'ready' THEN RAISE EXCEPTION 'affinity_sender_unavailable';END IF;
 SELECT phone_number INTO snapshot FROM public.phone_numbers WHERE id=chosen AND organization_id=org;
 IF private.is_dnc_phone(org,p_phone) THEN RAISE EXCEPTION 'affinity_dnc';END IF;
 IF p_call IS NULL OR EXISTS(SELECT 1 FROM public.calls WHERE id=p_call) OR EXISTS(SELECT 1 FROM private.contact_number_call_bindings WHERE call_id=p_call)
 THEN RAISE EXCEPTION 'affinity_attempt_reused';END IF;
 INSERT INTO private.contact_number_call_bindings(organization_id,call_id,actor_id,contact_id,contact_type,phone_e164,campaign_id,campaign_lead_id,group_id,
 number_id,number_snapshot,generation,voice_version,one_call,unsaved)
 VALUES(org,p_call,auth.uid(),p_contact,p_type,p_phone,p_campaign,p_member,grp,chosen,snapshot,a.generation,a.voice_version,p_override IS NOT NULL,p_unsaved);
 IF p_override IS NOT NULL THEN PERFORM private.affinity_event(org,p_phone,'voice','one_call',auth.uid(),chosen,snapshot,p_call::text);END IF;
 RETURN jsonb_build_object('enabled',true,'number_id',chosen,'number',snapshot,'generation',a.generation,'version',a.voice_version);
END $function$;

CREATE OR REPLACE FUNCTION public.admit_twilio_outbound(p_call_id uuid, p_identity text, p_to text, p_caller_id text, p_parent_sid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
 IF grp IS DISTINCT FROM b.group_id OR private.affinity_voice_number(c.organization_id,b.phone_e164,b.number_id,b.actor_id,b.one_call,grp)->>'readiness'<>'ready'
 OR NOT EXISTS(SELECT 1 FROM public.phone_numbers WHERE id=b.number_id AND organization_id=c.organization_id AND phone_number=b.number_snapshot)
 OR NOT EXISTS(SELECT 1 FROM private.contact_number_affinities WHERE organization_id=c.organization_id AND phone_e164=b.phone_e164 AND generation=b.generation
  AND (b.one_call OR (voice_state<>'needs_review' AND coalesce(voice_number_id,sms_number_id,b.number_id)=b.number_id)))
 THEN RAISE EXCEPTION 'affinity_admission_changed' USING ERRCODE='42501';END IF;
 UPDATE private.contact_number_call_bindings SET parent_sid=p_parent_sid WHERE call_id=p_call_id;
 RETURN result;
END $function$;

-- The new helper is unexposed and grants no direct execution to application roles.
DO $postcheck$
DECLARE function_oid oid := 'private.affinity_voice_number(uuid,text,uuid,uuid,boolean,uuid)'::regprocedure;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=function_oid AND NOT prosecdef
  AND proowner='postgres'::regrole AND provolatile='s' AND proconfig=ARRAY['search_path=""'])
  OR has_function_privilege('anon',function_oid,'EXECUTE')
  OR has_function_privilege('authenticated',function_oid,'EXECUTE')
  OR has_function_privilege('service_role',function_oid,'EXECUTE') THEN
  RAISE EXCEPTION 'sticky voice cap helper security mismatch';
 END IF;
END $postcheck$;
