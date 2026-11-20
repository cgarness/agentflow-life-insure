-- Guarded inverse for the unsaved reconciled endpoint correction.
-- Production use needs its own instruction. This restores the previous manual
-- call refusal for reconciled or pinned unsaved history and never rewrites identity/data.
-- Execute atomically under the migration runner; retain all migration history.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Pin/state correspondence and non-nullness must remain enforced.
DO $shape$
DECLARE actual jsonb;
BEGIN
 SELECT jsonb_build_object('columns',(SELECT jsonb_agg(jsonb_build_object('name',attname,'not_null',attnotnull) ORDER BY attname)
  FROM pg_attribute WHERE attrelid='private.contact_number_affinities'::regclass
  AND attname IN ('history_state','voice_state','sms_state') AND NOT attisdropped),
  'checks',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname)
  FROM pg_constraint WHERE conrelid='private.contact_number_affinities'::regclass AND contype='c')) INTO actual;
 IF actual IS DISTINCT FROM $expected${"checks":[{"name":"contact_number_affinities_check","validated":true,"definition":"CHECK (((voice_number_id IS NULL) = (voice_number IS NULL)))"},{"name":"contact_number_affinities_check1","validated":true,"definition":"CHECK (((sms_number_id IS NULL) = (sms_number IS NULL)))"},{"name":"contact_number_affinities_check2","validated":true,"definition":"CHECK (((voice_state <> 'unassigned'::text) OR (voice_number_id IS NULL)))"},{"name":"contact_number_affinities_check3","validated":true,"definition":"CHECK (((sms_state <> 'unassigned'::text) OR (sms_number_id IS NULL)))"},{"name":"contact_number_affinities_check4","validated":true,"definition":"CHECK (((voice_state <> 'established'::text) OR (voice_number_id IS NOT NULL)))"},{"name":"contact_number_affinities_check5","validated":true,"definition":"CHECK (((sms_state <> ALL (ARRAY['reserved'::text, 'established'::text])) OR (sms_number_id IS NOT NULL)))"},{"name":"contact_number_affinities_history_state_check","validated":true,"definition":"CHECK ((history_state = ANY (ARRAY['new'::text, 'reconciled'::text, 'needs_review'::text])))"},{"name":"contact_number_affinities_phone_e164_check","validated":true,"definition":"CHECK ((phone_e164 ~ '^\\+[1-9][0-9]{6,14}$'::text))"},{"name":"contact_number_affinities_sms_state_check","validated":true,"definition":"CHECK ((sms_state = ANY (ARRAY['unassigned'::text, 'reserved'::text, 'established'::text, 'needs_review'::text])))"},{"name":"contact_number_affinities_voice_state_check","validated":true,"definition":"CHECK ((voice_state = ANY (ARRAY['unassigned'::text, 'established'::text, 'needs_review'::text])))"}],"columns":[{"name":"history_state","not_null":true},{"name":"sms_state","not_null":true},{"name":"voice_state","not_null":true}]}$expected$::jsonb THEN
  RAISE EXCEPTION 'sticky unsaved call affinity state constraint drift';
 END IF;
END $shape$;
DO $preimage$
DECLARE expected jsonb; actual jsonb; function_oid oid;
BEGIN
 FOR expected IN SELECT value FROM jsonb_array_elements($catalog$[{"signature":"private.affinity_number(uuid,uuid,text,uuid,boolean,uuid)","md5":"04617e0576eaf471b1a52124a9293252","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"},{"signature":"public.admit_twilio_outbound(uuid,text,text,text,text)","md5":"86983bad02b2a563056179605f62b219","owner":"postgres","security_definer":true,"config":["search_path=pg_catalog, pg_temp"],"acl":"{postgres=X/postgres,service_role=X/postgres}","volatility":"v"},{"signature":"public.authorize_contact_call(uuid,uuid,text,text,text,uuid,uuid,uuid,boolean)","md5":"8acdd566aa0f24500b518b6869106086","owner":"postgres","security_definer":true,"config":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","volatility":"v"},{"signature":"private.affinity_admit_original(uuid,text,text,text,text)","md5":"298cceaaf17a494b1736ce9b3c4fc4fc","owner":"postgres","security_definer":true,"config":["search_path=pg_catalog, pg_temp"],"acl":"{postgres=X/postgres}","volatility":"v"},{"signature":"private.affinity_default(uuid,text,uuid,uuid)","md5":"41ff1911d3b82d8bbace92b2ebc98d6c","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"},{"signature":"private.affinity_process_call(uuid)","md5":"27bc67b3418b02c0330622e4e059a729","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"v"},{"signature":"private.affinity_view(uuid,text,uuid,uuid)","md5":"5733b5e71d4acf669e4c1a72e83871e4","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"},{"signature":"private.affinity_voice_scope(uuid,uuid,uuid,text,text,uuid,uuid,boolean)","md5":"35a5067097bf950383c7911789b43ce5","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"},{"signature":"private.affinity_voice_number(uuid,text,uuid,uuid,boolean,uuid)","md5":"70b097a9323ac7c0c20c26cbc82503b5","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"}]$catalog$::jsonb) LOOP
  function_oid := to_regprocedure(expected->>'signature');
  SELECT jsonb_build_object('signature',expected->>'signature','md5',md5(pg_get_functiondef(p.oid)),
   'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',to_jsonb(p.proconfig),
   'acl',p.proacl::text,'volatility',p.provolatile::text)
  INTO actual FROM pg_proc p WHERE p.oid=function_oid;
  IF actual IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'sticky unsaved call function drift: %', expected->>'signature';
  END IF;
 END LOOP;
END $preimage$;

CREATE OR REPLACE FUNCTION private.affinity_voice_scope(p_org uuid, p_actor uuid, p_contact uuid, p_type text, p_phone text, p_campaign uuid, p_member uuid, p_unsaved boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
END $function$;

DO $postimage$
DECLARE expected jsonb; actual jsonb; function_oid oid;
BEGIN
 FOR expected IN SELECT value FROM jsonb_array_elements($catalog$[{"signature":"private.affinity_number(uuid,uuid,text,uuid,boolean,uuid)","md5":"04617e0576eaf471b1a52124a9293252","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"},{"signature":"public.admit_twilio_outbound(uuid,text,text,text,text)","md5":"86983bad02b2a563056179605f62b219","owner":"postgres","security_definer":true,"config":["search_path=pg_catalog, pg_temp"],"acl":"{postgres=X/postgres,service_role=X/postgres}","volatility":"v"},{"signature":"public.authorize_contact_call(uuid,uuid,text,text,text,uuid,uuid,uuid,boolean)","md5":"8acdd566aa0f24500b518b6869106086","owner":"postgres","security_definer":true,"config":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","volatility":"v"},{"signature":"private.affinity_admit_original(uuid,text,text,text,text)","md5":"298cceaaf17a494b1736ce9b3c4fc4fc","owner":"postgres","security_definer":true,"config":["search_path=pg_catalog, pg_temp"],"acl":"{postgres=X/postgres}","volatility":"v"},{"signature":"private.affinity_default(uuid,text,uuid,uuid)","md5":"41ff1911d3b82d8bbace92b2ebc98d6c","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"},{"signature":"private.affinity_process_call(uuid)","md5":"27bc67b3418b02c0330622e4e059a729","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"v"},{"signature":"private.affinity_view(uuid,text,uuid,uuid)","md5":"5733b5e71d4acf669e4c1a72e83871e4","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"},{"signature":"private.affinity_voice_scope(uuid,uuid,uuid,text,text,uuid,uuid,boolean)","md5":"55de8731da7051ddbbec29d5f52ad702","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"},{"signature":"private.affinity_voice_number(uuid,text,uuid,uuid,boolean,uuid)","md5":"70b097a9323ac7c0c20c26cbc82503b5","owner":"postgres","security_definer":false,"config":["search_path=\"\""],"acl":"{postgres=X/postgres}","volatility":"s"}]$catalog$::jsonb) LOOP
  function_oid := to_regprocedure(expected->>'signature');
  SELECT jsonb_build_object('signature',expected->>'signature','md5',md5(pg_get_functiondef(p.oid)),
   'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',to_jsonb(p.proconfig),
   'acl',p.proacl::text,'volatility',p.provolatile::text)
  INTO actual FROM pg_proc p WHERE p.oid=function_oid;
  IF actual IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'sticky unsaved call function drift: %', expected->>'signature';
  END IF;
 END LOOP;
END $postimage$;
