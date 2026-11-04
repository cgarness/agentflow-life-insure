-- NOT APPLIED. Exact production approval required. Additive pilot; no phone is enabled here.
BEGIN;
ALTER TABLE public.phone_numbers ADD COLUMN inbounds_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.phone_numbers ADD CONSTRAINT inbounds_number_dedicated CHECK (NOT inbounds_only OR (assignment_type='agency' AND NOT coalesce(is_default,false) AND NOT is_direct_line));
CREATE TABLE public.inbounds_room_sessions (
 organization_id uuid NOT NULL REFERENCES public.organizations(id), agent_id uuid PRIMARY KEY REFERENCES public.profiles(id),
 session_id uuid NOT NULL UNIQUE, identity text NOT NULL UNIQUE, state text NOT NULL CHECK(state IN ('available','paused','offline')),
 ready boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL, seq bigint NOT NULL DEFAULT 0,
 UNIQUE(organization_id,agent_id)
);
CREATE TABLE public.inbounds_room_calls (
 call_id uuid PRIMARY KEY REFERENCES public.calls(id), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 phone_number_id uuid NOT NULL REFERENCES public.phone_numbers(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inbounds_room_calls_org_date ON public.inbounds_room_calls(organization_id,created_at);
CREATE TABLE public.inbounds_room_targets (
 call_id uuid NOT NULL REFERENCES public.inbounds_room_calls(call_id), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 agent_id uuid NOT NULL REFERENCES public.profiles(id), session_id uuid NOT NULL, identity text NOT NULL,
 PRIMARY KEY(call_id,agent_id)
);
ALTER TABLE public.inbounds_room_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbounds_room_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbounds_room_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbounds_room_sessions,public.inbounds_room_calls,public.inbounds_room_targets FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.inbounds_room_sessions,public.inbounds_room_calls,public.inbounds_room_targets TO service_role;
-- Browser access is through authenticated, narrowly scoped RPCs only, not table grants.
CREATE FUNCTION private.inbounds_actor() RETURNS TABLE(uid uuid,org uuid,admin boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 RETURN QUERY SELECT p.id,p.organization_id,p.role IN ('Admin','Super Admin') FROM public.profiles p
 WHERE p.id=auth.uid() AND p.organization_id=public.get_org_id() AND p.status='Active'
 AND EXISTS(SELECT 1 FROM public.organizations o WHERE o.id=p.organization_id AND o.twilio_subaccount_status='active');
 IF NOT FOUND THEN RAISE EXCEPTION 'Room access unavailable' USING ERRCODE='42501';END IF;
END $$;
REVOKE ALL ON FUNCTION private.inbounds_actor() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.inbounds_pending(p_org uuid,p_agent uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.inbounds_room_calls r JOIN public.calls c ON c.id=r.call_id
 WHERE r.organization_id=p_org AND c.organization_id=p_org AND c.agent_id=p_agent
 AND NOT EXISTS(SELECT 1 FROM private.dialer_disposition_receipts d WHERE d.call_id=c.id AND d.organization_id=p_org AND d.agent_id=p_agent));
$$;
REVOKE ALL ON FUNCTION private.inbounds_pending(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.inbounds_room_session(p_session uuid,p_action text,p_ready boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record;s public.inbounds_room_sessions;v_count integer;
BEGIN
 SELECT * INTO a FROM private.inbounds_actor();
 IF p_session IS NULL OR p_action NOT IN ('join','heartbeat','pause','resume','leave') OR p_action IS NULL THEN RAISE EXCEPTION 'Invalid room action' USING ERRCODE='22023';END IF;
 -- Capacity lock precedes agent lock; planners never acquire capacity lock.
 PERFORM pg_advisory_xact_lock(hashtext('inbounds_capacity:'||a.org::text));
 PERFORM pg_advisory_xact_lock(hashtext('inbound_agent:'||a.uid::text));
 SELECT * INTO s FROM public.inbounds_room_sessions WHERE agent_id=a.uid FOR UPDATE;
 IF p_action='join' THEN
  IF s.session_id IS DISTINCT FROM p_session AND s.state<>'offline' AND s.expires_at>now() THEN RAISE EXCEPTION 'Your room is already open in another tab';END IF;
  SELECT count(*) INTO v_count FROM public.inbounds_room_sessions WHERE organization_id=a.org AND agent_id<>a.uid AND state<>'offline' AND expires_at>now();
  IF v_count>=10 THEN RAISE EXCEPTION 'The pilot room is full (10 agents)';END IF;
  INSERT INTO public.inbounds_room_sessions(organization_id,agent_id,session_id,identity,state,ready,expires_at)
   VALUES(a.org,a.uid,p_session,'ir_'||replace(p_session::text,'-',''),'paused',false,now()+interval '45 seconds')
   ON CONFLICT(agent_id) DO UPDATE SET organization_id=excluded.organization_id,session_id=excluded.session_id,identity=excluded.identity,state='paused',ready=false,expires_at=excluded.expires_at;
 ELSE
  IF s.session_id IS DISTINCT FROM p_session OR s.organization_id IS DISTINCT FROM a.org THEN RAISE EXCEPTION 'Room session changed; rejoin';END IF;
  IF p_action<>'leave' AND (s.state='offline' OR s.expires_at<=now()) THEN RAISE EXCEPTION 'Room session expired; rejoin';END IF;
  IF p_action='resume' THEN
   IF NOT p_ready THEN RAISE EXCEPTION 'Connect the room phone first';END IF;
   IF public.is_agent_busy(a.org,a.uid,NULL) OR private.inbounds_pending(a.org,a.uid) THEN RAISE EXCEPTION 'Finish your call and save its disposition first';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.call_scripts WHERE organization_id=a.org AND active AND nullif(btrim(content),'') IS NOT NULL)
      OR NOT EXISTS(SELECT 1 FROM public.dispositions WHERE organization_id=a.org) THEN RAISE EXCEPTION 'Configure scripts and outcomes in AgentFlow Settings';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=a.uid AND coalesce(availability_status,'Available')='Available') THEN RAISE EXCEPTION 'Set your AgentFlow availability to Available first';END IF;
  END IF;
  UPDATE public.inbounds_room_sessions SET state=CASE p_action WHEN 'resume' THEN 'available' WHEN 'pause' THEN 'paused' WHEN 'leave' THEN 'offline' ELSE state END,
   ready=coalesce(p_ready,false) AND p_action<>'leave',expires_at=CASE WHEN p_action='leave' THEN now() ELSE now()+interval '45 seconds' END,seq=seq+1
   WHERE agent_id=a.uid;
 END IF;
 SELECT * INTO s FROM public.inbounds_room_sessions WHERE agent_id=a.uid;
 RETURN jsonb_build_object('session_id',s.session_id,'state',s.state,'ready',s.ready,'expires_at',s.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.inbounds_room_session(uuid,text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.inbounds_room_session(uuid,text,boolean) TO authenticated;
CREATE FUNCTION public.set_inbounds_number(p_number uuid,p_enabled boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record;
BEGIN
 SELECT * INTO a FROM private.inbounds_actor();IF NOT a.admin THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501';END IF;
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Routing choice required';END IF;
 IF p_enabled AND NOT EXISTS(SELECT 1 FROM public.inbound_routing_settings WHERE organization_id=a.org AND routing_engine='v2') THEN RAISE EXCEPTION 'Inbound routing v2 must be active first';END IF;
 UPDATE public.phone_numbers SET inbounds_only=p_enabled WHERE id=p_number AND organization_id=a.org;
 IF NOT FOUND THEN RAISE EXCEPTION 'Number not found' USING ERRCODE='42501';END IF;RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.set_inbounds_number(uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.set_inbounds_number(uuid,boolean) TO authenticated;
CREATE FUNCTION private.guard_inbounds_number() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record;
BEGIN
 IF (TG_OP='INSERT' AND NEW.inbounds_only) OR (TG_OP='UPDATE' AND NEW.inbounds_only IS DISTINCT FROM OLD.inbounds_only) THEN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Use the approved authenticated number setting';END IF;
  SELECT * INTO a FROM private.inbounds_actor();IF NOT a.admin OR a.org<>NEW.organization_id THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501';END IF;
  IF NEW.inbounds_only AND lower(coalesce(NEW.status,''))<>'active' THEN RAISE EXCEPTION 'Choose an active agency number';END IF;
  IF NEW.inbounds_only AND NOT EXISTS(SELECT 1 FROM public.inbound_routing_settings WHERE organization_id=a.org AND routing_engine='v2') THEN RAISE EXCEPTION 'Inbound routing v2 must be active first';END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_inbounds_number() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_inbounds_number BEFORE INSERT OR UPDATE ON public.phone_numbers FOR EACH ROW EXECUTE FUNCTION private.guard_inbounds_number();
CREATE FUNCTION private.capture_inbounds_call() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.direction='inbound' THEN
  IF auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.phone_numbers p WHERE p.organization_id=NEW.organization_id AND p.inbounds_only AND p.phone_number=NEW.caller_id_used) THEN RAISE EXCEPTION 'Room calls require provider ingestion' USING ERRCODE='42501';END IF;
  INSERT INTO public.inbounds_room_calls(call_id,organization_id,phone_number_id,created_at)
   SELECT NEW.id,NEW.organization_id,p.id,NEW.created_at FROM public.phone_numbers p
   WHERE p.organization_id=NEW.organization_id AND p.inbounds_only AND p.phone_number=NEW.caller_id_used;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.capture_inbounds_call() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER capture_inbounds_call AFTER INSERT ON public.calls FOR EACH ROW EXECUTE FUNCTION private.capture_inbounds_call();
-- A locked parent call enters this function from the existing planner. Reservation semantics remain shared.
CREATE FUNCTION private.plan_inbounds_room_locked(p_call public.calls,p_ring integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_ids uuid[];v_id uuid;v_stage text;a public.inbound_route_attempts;
BEGIN
 SELECT coalesce(array_agg(s.agent_id ORDER BY s.agent_id),'{}') INTO v_ids FROM public.inbounds_room_sessions s
 WHERE s.organization_id=p_call.organization_id AND s.state='available' AND s.ready AND s.expires_at>now();
 FOREACH v_id IN ARRAY v_ids LOOP PERFORM pg_advisory_xact_lock(hashtext('inbound_agent:'||v_id::text)); END LOOP;
 -- Fresh command snapshot after locks; no fetch-then-reserve race.
 SELECT coalesce(array_agg(s.agent_id ORDER BY s.agent_id),'{}') INTO v_ids FROM public.inbounds_room_sessions s JOIN public.profiles p ON p.id=s.agent_id
 WHERE s.agent_id=ANY(v_ids) AND s.organization_id=p_call.organization_id AND p.organization_id=s.organization_id
 AND p.status='Active' AND coalesce(p.availability_status,'Available')='Available' AND s.state='available' AND s.ready AND s.expires_at>now()
 AND NOT public.is_agent_busy(s.organization_id,s.agent_id,p_call.id) AND NOT private.inbounds_pending(s.organization_id,s.agent_id)
 AND EXISTS(SELECT 1 FROM public.call_scripts cs WHERE cs.organization_id=s.organization_id AND cs.active AND nullif(btrim(cs.content),'') IS NOT NULL)
 AND EXISTS(SELECT 1 FROM public.dispositions d WHERE d.organization_id=s.organization_id);
 IF cardinality(v_ids)>10 THEN RAISE EXCEPTION 'Room capacity invariant violated';END IF;
 v_stage:=CASE WHEN cardinality(v_ids)=0 THEN 'group_voicemail' ELSE 'group_browser' END;
 INSERT INTO public.inbound_route_attempts(call_id,organization_id,mode,eligibility_reason,stage,reserved_agent_ids,browser_ring_timeout_sent,voicemail_kind,voicemail_group_ids)
 VALUES(p_call.id,p_call.organization_id,'group','inbounds_room',v_stage,v_ids,p_ring,CASE WHEN v_stage='group_voicemail' THEN 'group' END,v_ids)
 ON CONFLICT(call_id) DO NOTHING RETURNING * INTO a;
 IF a.id IS NULL THEN SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id=p_call.id;
 ELSE
  INSERT INTO public.inbounds_room_targets(call_id,organization_id,agent_id,session_id,identity)
   SELECT p_call.id,s.organization_id,s.agent_id,s.session_id,s.identity FROM public.inbounds_room_sessions s WHERE s.agent_id=ANY(v_ids) AND s.organization_id=p_call.organization_id;
  IF v_stage='group_voicemail' THEN PERFORM public.mark_inbound_missed(p_call.id,p_call.organization_id,'group_empty','{}',NULL);END IF;
 END IF;
 RETURN jsonb_build_object('created',true,'attempt',to_jsonb(a),'stage',a.stage,'targets',to_jsonb(a.reserved_agent_ids));
END $$;
REVOKE ALL ON FUNCTION private.plan_inbounds_room_locked(public.calls,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.inbounds_room_route(p_call uuid,p_org uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('room',EXISTS(SELECT 1 FROM public.inbounds_room_calls WHERE call_id=p_call AND organization_id=p_org),
 'targets',coalesce((SELECT jsonb_agg(jsonb_build_object('agentId',agent_id,'identity',identity)) FROM public.inbounds_room_targets WHERE call_id=p_call AND organization_id=p_org),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.inbounds_room_route(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inbounds_room_route(uuid,uuid) TO service_role;
-- Outbound creation shares the inbound reservation lock for room participants. Duration untouched.
CREATE FUNCTION private.guard_inbounds_outbound() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.direction NOT IN ('outbound','outgoing') THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM public.phone_numbers WHERE organization_id=NEW.organization_id AND phone_number=NEW.caller_id_used AND inbounds_only) THEN RAISE EXCEPTION 'This number is reserved for Inbounds';END IF;
 IF EXISTS(SELECT 1 FROM public.inbounds_room_sessions WHERE organization_id=NEW.organization_id AND agent_id=NEW.agent_id) THEN
  PERFORM pg_advisory_xact_lock(hashtext('inbound_agent:'||NEW.agent_id::text));
  IF public.is_agent_busy(NEW.organization_id,NEW.agent_id,NEW.id) THEN RAISE EXCEPTION 'Finish your call and disposition before dialing';END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_inbounds_outbound() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_inbounds_outbound BEFORE INSERT ON public.calls FOR EACH ROW EXECUTE FUNCTION private.guard_inbounds_outbound();
CREATE FUNCTION public.inbounds_room_state(p_start timestamptz,p_end timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record;v_session jsonb;v_pending jsonb;v_stats jsonb;v_outcomes jsonb;v_agents jsonb;v_missed jsonb;v_vm jsonb;v_presence jsonb;
BEGIN
 SELECT * INTO a FROM private.inbounds_actor();
 IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR p_end-p_start>interval '2 days' THEN RAISE EXCEPTION 'Invalid room reporting window';END IF;
 SELECT jsonb_build_object('session_id',session_id,'state',CASE WHEN expires_at<=now() THEN 'offline' ELSE state END,'ready',ready AND expires_at>now(),'expires_at',expires_at)
 INTO v_session FROM public.inbounds_room_sessions WHERE agent_id=a.uid AND organization_id=a.org;
 SELECT jsonb_build_object('id',c.id,'contact_id',c.contact_id,'contact_type',c.contact_type,'contact_name',c.contact_name,'contact_phone',c.contact_phone,'ended_at',c.ended_at,'status',c.status,'duration',c.duration,'voicemail_id',c.voicemail_id,'created_at',c.created_at) INTO v_pending FROM public.inbounds_room_calls r JOIN public.calls c ON c.id=r.call_id
 WHERE r.organization_id=a.org AND c.organization_id=a.org AND c.agent_id=a.uid
 AND NOT EXISTS(SELECT 1 FROM private.dialer_disposition_receipts d WHERE d.organization_id=a.org AND d.call_id=c.id AND d.agent_id=a.uid)
 ORDER BY c.created_at,c.id LIMIT 1;
 SELECT jsonb_build_object('available',count(*) FILTER(WHERE s.state='available' AND s.ready AND NOT public.is_agent_busy(a.org,s.agent_id,NULL)),
 'busy',count(*) FILTER(WHERE public.is_agent_busy(a.org,s.agent_id,NULL)), 'paused',count(*) FILTER(WHERE s.state='paused')) INTO v_presence
 FROM public.inbounds_room_sessions s JOIN public.profiles p ON p.id=s.agent_id AND p.organization_id=a.org
 WHERE s.organization_id=a.org AND s.state<>'offline' AND s.expires_at>now() AND p.status='Active';
 WITH scoped AS (SELECT c.* FROM public.inbounds_room_calls r JOIN public.calls c ON c.id=r.call_id WHERE r.organization_id=a.org AND c.organization_id=a.org AND (a.admin OR c.agent_id=a.uid) AND c.created_at>=p_start AND c.created_at<p_end)
 SELECT jsonb_build_object('total',count(*),'answered',count(*) FILTER(WHERE agent_id IS NOT NULL),'missed',count(*) FILTER(WHERE is_missed AND agent_id IS NULL),
 'voicemails',count(*) FILTER(WHERE voicemail_id IS NOT NULL),'pending',count(*) FILTER(WHERE agent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.dialer_disposition_receipts d WHERE d.organization_id=a.org AND d.call_id=scoped.id AND d.agent_id=scoped.agent_id))) INTO v_stats FROM scoped;
 SELECT coalesce(jsonb_agg(x ORDER BY x.name),'[]') INTO v_outcomes FROM (
 SELECT d.id::text,d.name,count(c.id) AS count FROM public.dispositions d LEFT JOIN public.calls c ON c.disposition_id=d.id AND c.organization_id=a.org AND (a.admin OR c.agent_id=a.uid) AND c.created_at>=p_start AND c.created_at<p_end
 AND EXISTS(SELECT 1 FROM public.inbounds_room_calls r WHERE r.call_id=c.id AND r.organization_id=a.org)
 AND EXISTS(SELECT 1 FROM private.dialer_disposition_receipts q WHERE q.call_id=c.id AND q.organization_id=a.org)
 WHERE d.organization_id=a.org GROUP BY d.id,d.name) x;
 IF a.admin THEN
  SELECT coalesce(jsonb_agg(x ORDER BY x.answered DESC),'[]') INTO v_agents FROM (
   SELECT p.id,concat_ws(' ',p.first_name,p.last_name) name,count(*) answered,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM private.dialer_disposition_receipts q WHERE q.call_id=c.id AND q.organization_id=a.org)) dispositioned
   FROM public.inbounds_room_calls r JOIN public.calls c ON c.id=r.call_id JOIN public.profiles p ON p.id=c.agent_id AND p.organization_id=a.org
   WHERE r.organization_id=a.org AND c.organization_id=a.org AND c.created_at>=p_start AND c.created_at<p_end GROUP BY p.id,p.first_name,p.last_name) x;
 END IF;
 SELECT coalesce(jsonb_agg(x),'[]') INTO v_missed FROM (SELECT c.id,c.contact_id,c.contact_type,c.contact_name,c.contact_phone,c.ended_at,c.status,c.duration,c.voicemail_id,c.created_at FROM public.calls c JOIN public.inbounds_room_calls r ON r.call_id=c.id WHERE r.organization_id=a.org AND c.organization_id=a.org AND (a.admin OR a.uid=ANY(c.missed_recipient_ids)) AND c.is_missed AND c.agent_id IS NULL AND c.created_at>=p_start AND c.created_at<p_end ORDER BY c.created_at DESC,c.id LIMIT 50) x;
  SELECT coalesce(jsonb_agg(x),'[]') INTO v_vm FROM (SELECT c.id,c.contact_id,c.contact_type,c.contact_name,c.contact_phone,c.ended_at,c.status,c.duration,c.voicemail_id,c.created_at FROM public.calls c JOIN public.inbounds_room_calls r ON r.call_id=c.id WHERE r.organization_id=a.org AND c.organization_id=a.org AND (a.admin OR a.uid=ANY(c.missed_recipient_ids) OR c.agent_id=a.uid) AND c.voicemail_id IS NOT NULL AND c.created_at>=p_start AND c.created_at<p_end ORDER BY c.created_at DESC,c.id LIMIT 50) x;
 RETURN jsonb_build_object('organization_id',a.org,'user_id',a.uid,'admin',a.admin,'session',v_session,'pending',v_pending,'presence',v_presence,'stats',v_stats,'outcomes',v_outcomes,'agents',coalesce(v_agents,'[]'),'missed',coalesce(v_missed,'[]'),'voicemail_calls',coalesce(v_vm,'[]'));
END $$;
REVOKE ALL ON FUNCTION public.inbounds_room_state(timestamptz,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.inbounds_room_state(timestamptz,timestamptz) TO authenticated;

-- Read only proof for the SDK accept latch. A local click never claims a call.
CREATE FUNCTION public.inbounds_room_call_state(p_call uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record;c public.calls;
BEGIN
 SELECT * INTO a FROM private.inbounds_actor();
 SELECT ca.* INTO c FROM public.calls ca JOIN public.inbounds_room_calls r ON r.call_id=ca.id AND r.organization_id=a.org
 WHERE ca.id=p_call AND ca.organization_id=a.org AND (ca.agent_id=a.uid OR EXISTS(SELECT 1 FROM public.inbounds_room_targets t WHERE t.call_id=ca.id AND t.organization_id=a.org AND t.agent_id=a.uid));
 IF NOT FOUND THEN RAISE EXCEPTION 'Call unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('agent_id',c.agent_id,'ended_at',c.ended_at,'dispositioned',EXISTS(SELECT 1 FROM private.dialer_disposition_receipts d WHERE d.call_id=c.id AND d.organization_id=a.org AND d.agent_id=a.uid));
END $$;
REVOKE ALL ON FUNCTION public.inbounds_room_call_state(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.inbounds_room_call_state(uuid) TO authenticated;
-- Explicit caller-details action. No lifecycle/ownership/duration writes; canonical resolver avoids duplicates.
CREATE FUNCTION public.inbounds_room_add_contact(p_call uuid,p_first text,p_last text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record;c public.calls;r jsonb;v_id uuid;v_phone text;
BEGIN
 SELECT * INTO a FROM private.inbounds_actor();
 IF nullif(btrim(p_first),'') IS NULL OR nullif(btrim(p_last),'') IS NULL OR length(p_first)>100 OR length(p_last)>100 THEN RAISE EXCEPTION 'Enter caller first and last name';END IF;
 SELECT ca.* INTO c FROM public.calls ca JOIN public.inbounds_room_calls rc ON rc.call_id=ca.id AND rc.organization_id=a.org
 WHERE ca.id=p_call AND ca.organization_id=a.org AND ca.agent_id=a.uid FOR UPDATE OF ca;
 IF NOT FOUND OR c.ended_at IS NULL THEN RAISE EXCEPTION 'Finish your own inbound call first' USING ERRCODE='42501';END IF;
 IF c.contact_id IS NOT NULL THEN RETURN c.contact_id;END IF;
 IF EXISTS(SELECT 1 FROM private.dialer_disposition_receipts d WHERE d.call_id=c.id AND d.organization_id=a.org) THEN RAISE EXCEPTION 'Disposition already saved';END IF;
 v_phone:='+'||private.phone_digits_e164ish(c.contact_phone);
 IF v_phone !~ '^\+[1-9][0-9]{6,14}$' THEN RAISE EXCEPTION 'A valid caller number is required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('af_inbound_autocreate:'||a.org::text||':'||public.phone_last10(v_phone),0));
 r:=public.resolve_inbound_contact(a.org,v_phone);
 IF r->>'resolution'='ambiguous' THEN RAISE EXCEPTION 'Multiple contacts match this caller. Ask an admin to resolve the duplicate contacts first';END IF;
 IF r->>'resolution'='unique' THEN
  v_id:=(r->>'contact_id')::uuid;
  UPDATE public.calls SET contact_id=v_id,contact_type=r->>'contact_type',contact_name=r->>'contact_name' WHERE id=c.id;
 ELSIF r->>'resolution'='not_found' THEN
  INSERT INTO public.leads(organization_id,phone,first_name,last_name,lead_source,status,assigned_agent_id)
  VALUES(a.org,v_phone,btrim(p_first),btrim(p_last),'Inbound Call','New',a.uid) RETURNING id INTO v_id;
  UPDATE public.calls SET contact_id=v_id,contact_type='lead',contact_name=concat_ws(' ',btrim(p_first),btrim(p_last)) WHERE id=c.id;
 ELSE RAISE EXCEPTION 'Could not resolve caller';END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.inbounds_room_add_contact(uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.inbounds_room_add_contact(uuid,text,text) TO authenticated;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.is_agent_busy(uuid,uuid,uuid)'))) IS DISTINCT FROM '81a421613276d4cc965405c87fbaea01' THEN RAISE EXCEPTION 'Live function drift: is_agent_busy'; END IF;END $$;
CREATE OR REPLACE FUNCTION public.is_agent_busy(p_org_id uuid, p_agent_id uuid, p_exclude_call_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT private.inbounds_pending(p_org_id,p_agent_id) OR EXISTS (
    SELECT 1 FROM public.calls c
     WHERE c.organization_id = p_org_id
       AND (c.agent_id = p_agent_id OR c.answered_by_agent_id = p_agent_id)
       AND c.status IN ('ringing','connected')
       AND c.ended_at IS NULL
       AND c.created_at > now() - interval '4 hours'
       AND (p_exclude_call_id IS NULL OR c.id <> p_exclude_call_id)
  ) OR EXISTS (
    SELECT 1 FROM public.inbound_route_attempts a
      JOIN public.calls pc ON pc.id = a.call_id
     WHERE a.organization_id = p_org_id
       AND NOT a.terminal
       AND (p_exclude_call_id IS NULL OR a.call_id <> p_exclude_call_id)
       AND p_agent_id = ANY (a.reserved_agent_ids)
       AND (
         -- Browser waves: the reservation follows the AUTHORITATIVE browser claim (claim_inbound_call
         -- writes calls.agent_id). Until someone claims, EVERY reserved member is busy (simultaneous-
         -- call protection). The moment calls.agent_id is set, only the claimant stays busy — through
         -- the calls branch above — and the losing members are released immediately, not five minutes
         -- later when the parent <Dial action> returns after the conversation ends. A parent that has
         -- already ended releases everyone too.
         (a.stage IN ('owner_browser','group_browser') AND pc.agent_id IS NULL AND pc.ended_at IS NULL
            AND a.stage_started_at > now() - interval '5 minutes')
         -- Mobile leg ringing / whisper in progress (no genuine acceptance yet — a wrong or missing digit
         -- keeps the whisper open): reserved for the stage window while the parent and the leg are live.
         OR (a.stage = 'owner_mobile' AND a.mobile_accept_result IS DISTINCT FROM 'accepted'
            AND a.mobile_leg_ended_at IS NULL AND pc.ended_at IS NULL
            AND a.stage_started_at > now() - interval '5 minutes')
         -- GENUINELY accepted mobile leg (approved design, A5b): busy until the child leg's own end callback
         -- arrives — the parent's completion may be reported first — bounded by the 4-hour ceiling. The
         -- other results (accepted_after_hangup / wrong_digit / no_digit) also stamp mobile_accepted_at but
         -- never earn this ceiling: they stay in the whisper branch above and its 5-minute window.
         OR (a.stage = 'owner_mobile' AND a.mobile_accept_result = 'accepted'
             AND a.mobile_leg_ended_at IS NULL
             AND a.mobile_accepted_at > now() - interval '4 hours')
       )
  );
$function$
;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.plan_inbound_route(uuid,uuid,uuid,text,uuid[],integer)'))) IS DISTINCT FROM 'b3d0602b0efc2cb4829ee3b0c6256335' THEN RAISE EXCEPTION 'Live function drift: plan_inbound_route'; END IF;END $$;
CREATE OR REPLACE FUNCTION public.plan_inbound_route(p_call_row_id uuid, p_org_id uuid, p_owner_agent_id uuid, p_owner_source text, p_candidate_group_ids uuid[], p_browser_ring_seconds integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a public.inbound_route_attempts%ROWTYPE;
  c public.calls%ROWTYPE;
  v_owner_ok boolean := false;
  v_avail text; v_identity text;
  v_connected boolean; v_busy boolean; v_mobile text;
  v_stage text; v_reason text; v_missed_reason text;
  v_group uuid[]; v_eligible uuid[] := '{}'; v_id uuid;
  v_ring integer := greatest(5, least(120, coalesce(p_browser_ring_seconds, 20)));
  r jsonb;
  v_source text; v_ro_failed boolean := false; v_ro_enabled boolean := false; v_ro_unanswered boolean := false;
  v_res text; v_is_direct boolean; v_ro_agent uuid; v_ev_sid text; v_ev_outcome text; v_ev_started timestamptz;
BEGIN
  IF p_call_row_id IS NULL OR p_org_id IS NULL THEN
    RAISE EXCEPTION 'plan_inbound_route: call and organization required' USING ERRCODE = '22023';
  END IF;

  -- Idempotent: a duplicate initial webhook returns the persisted attempt and writes nothing.
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = p_call_row_id;
  IF FOUND THEN
    RETURN jsonb_build_object('created', false, 'attempt', to_jsonb(a), 'stage', a.stage,
                              'targets', to_jsonb(a.reserved_agent_ids));
  END IF;

  -- LOCK ORDER (corrective pass 4): the parent `calls` row is locked FIRST (FOR UPDATE), then any agent
  -- advisory lock. Every writer that touches both (plan, advance_to_owner_mobile, commit_owner_mobile)
  -- takes them in this order; finalize / abandon / claim take only the row lock. The terminal check and
  -- the attempt insert are therefore one atomic decision: a finalize that lands while this planner waits
  -- for an agent lock either ran BEFORE (the row reads terminal here and nothing is created) or waits for
  -- this transaction and then closes the attempt it created (finalize closes open ringing stages).
  SELECT * INTO c FROM public.calls WHERE id = p_call_row_id AND organization_id = p_org_id AND direction = 'inbound' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('created', false, 'reason', 'call_not_found');
  END IF;
  -- A call already finalized (the webhook's infrastructure-failure path answered it, or it ended) is never
  -- planned: planning work that outlives the request deadline must not start a ring on a dead call.
  IF c.ended_at IS NOT NULL OR c.status IN ('completed','failed','no-answer') THEN
    RETURN jsonb_build_object('created', false, 'reason', 'call_terminal');
  END IF;
  -- Routing and recovery agree on ONE persisted decision: a call is planned by v2 only when the handler
  -- recorded 'v2' for it (record_inbound_engine_decision) — never on the organization's current flag.
  IF c.routing_engine IS DISTINCT FROM 'v2' THEN
    RETURN jsonb_build_object('created', false, 'reason', 'engine_mismatch', 'engine', c.routing_engine);
  END IF;

  IF EXISTS(SELECT 1 FROM public.inbounds_room_calls WHERE call_id=c.id AND organization_id=p_org_id) THEN
    RETURN private.plan_inbounds_room_locked(c,v_ring);
  END IF;

  -- ── Recent-outbound tier (20260927052736) — only when the handler supplied NO owner (no direct line, no
  -- contact owner) and the call carries no contact. (1) The optional configuration read is CONTAINED: a fault
  -- logs a WARNING and routes the group with a recent_outbound_unavailable reason. (2) The identity/ownership
  -- re-check is NOT contained: a CRM or direct-line fault propagates (fail closed). (3) The optional evidence
  -- lookup is CONTAINED like (1). A match enters the unchanged owner mode below as owner_source recent_outbound.
  IF p_owner_agent_id IS NULL AND c.contact_id IS NULL THEN
    BEGIN
      SELECT (cfg.enabled AND (cfg.did_allowlist IS NULL OR EXISTS (
                SELECT 1 FROM unnest(cfg.did_allowlist) d(x)
                 WHERE private.phone_digits_e164ish(d.x) = private.phone_digits_e164ish(c.caller_id_used)
                   AND length(private.phone_digits_e164ish(d.x)) >= 10))),
             cfg.unanswered_eligible
        INTO v_ro_enabled, v_ro_unanswered
        FROM private.recent_outbound_routing_orgs cfg
       WHERE cfg.organization_id = p_org_id;
      v_ro_enabled := coalesce(v_ro_enabled, false);
      v_ro_unanswered := coalesce(v_ro_unanswered, false);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'plan_inbound_route: recent_outbound config unavailable (%): %', SQLSTATE, SQLERRM;
      v_ro_failed := true; v_ro_enabled := false;
    END;
    IF v_ro_enabled THEN
      v_res := public.resolve_inbound_contact(p_org_id, c.contact_phone)->>'resolution';
      v_is_direct := EXISTS (SELECT 1 FROM public.phone_numbers pn
                              WHERE pn.organization_id = p_org_id AND pn.is_direct_line
                                AND private.phone_digits_e164ish(pn.phone_number) = private.phone_digits_e164ish(c.caller_id_used));
      IF v_res = 'not_found' AND NOT v_is_direct THEN
        BEGIN
          SELECT cand.o_agent_id, cand.o_dial_call_sid, cand.o_outcome, cand.o_provider_started_at
            INTO v_ro_agent, v_ev_sid, v_ev_outcome, v_ev_started
            FROM private.recent_outbound_route_candidate(p_org_id, p_call_row_id, v_ro_unanswered) cand;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'plan_inbound_route: recent_outbound evidence unavailable (%): %', SQLSTATE, SQLERRM;
          v_ro_failed := true;
          v_ro_agent := NULL; v_ev_sid := NULL; v_ev_outcome := NULL; v_ev_started := NULL;
        END;
        IF v_ro_agent IS NOT NULL THEN
          p_owner_agent_id := v_ro_agent; v_source := 'recent_outbound';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── Owner mode ──
  IF p_owner_agent_id IS NOT NULL THEN
    SELECT p.availability_status, p.twilio_client_identity INTO v_avail, v_identity
      FROM public.profiles p
     WHERE p.id = p_owner_agent_id AND p.organization_id = p_org_id AND p.status = 'Active';
    v_owner_ok := FOUND;
  END IF;

  IF v_owner_ok THEN
    PERFORM pg_advisory_xact_lock(hashtext('inbound_agent:' || p_owner_agent_id::text));
    v_connected := public.is_phone_connected(p_owner_agent_id)
                   AND btrim(coalesce(v_identity, '')) <> ''
                   AND coalesce(v_avail, 'Available') <> 'Offline';
    v_busy := public.is_agent_busy(p_org_id, p_owner_agent_id, p_call_row_id);
    SELECT s.mobile_forward_number INTO v_mobile
      FROM public.agent_inbound_settings s
     WHERE s.agent_id = p_owner_agent_id AND s.organization_id = p_org_id AND s.mobile_forward_enabled;

    IF v_avail IN ('On Break','Do Not Disturb') THEN
      v_stage := 'owner_voicemail'; v_reason := 'owner_dnd'; v_missed_reason := 'dnd';
    ELSIF v_busy THEN
      v_stage := 'owner_voicemail'; v_reason := 'owner_busy'; v_missed_reason := 'busy';
    ELSIF NOT v_connected THEN
      IF v_mobile IS NOT NULL THEN
        v_stage := 'owner_mobile'; v_reason := 'owner_offline_mobile';
      ELSE
        v_stage := 'owner_voicemail'; v_reason := 'owner_offline_no_mobile'; v_missed_reason := 'offline_no_mobile';
      END IF;
    ELSE
      v_stage := 'owner_browser'; v_reason := 'owner_available_connected';
    END IF;

    INSERT INTO public.inbound_route_attempts
      (call_id, organization_id, mode, owner_agent_id, owner_source, eligibility_reason, stage,
       reserved_agent_ids, browser_ring_timeout_sent, voicemail_kind, voicemail_agent_id,
       owner_evidence_dial_call_sid, owner_evidence_provider_started_at, owner_evidence_outcome)
    VALUES
      (p_call_row_id, p_org_id, 'owner', p_owner_agent_id,
       CASE WHEN v_source = 'recent_outbound' THEN 'recent_outbound'
            WHEN p_owner_source IN ('contact','direct_line') THEN p_owner_source ELSE 'contact' END,
       v_reason, v_stage,
       CASE WHEN v_stage = 'owner_browser' THEN ARRAY[p_owner_agent_id] ELSE '{}'::uuid[] END,
       CASE WHEN v_stage = 'owner_browser' THEN v_ring END,
       CASE WHEN v_stage = 'owner_voicemail' THEN 'agent' END,
       CASE WHEN v_stage = 'owner_voicemail' THEN p_owner_agent_id END,
       CASE WHEN v_source = 'recent_outbound' THEN v_ev_sid END,
       CASE WHEN v_source = 'recent_outbound' THEN v_ev_started END,
       CASE WHEN v_source = 'recent_outbound' THEN v_ev_outcome END)
    ON CONFLICT (call_id) DO NOTHING
    RETURNING * INTO a;
    IF NOT FOUND THEN
      SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = p_call_row_id;
      RETURN jsonb_build_object('created', false, 'attempt', to_jsonb(a), 'stage', a.stage,
                                'targets', to_jsonb(a.reserved_agent_ids));
    END IF;

    IF v_stage = 'owner_mobile' THEN
      -- Immediate offline forwarding: the D13 mark, destination snapshot and reservation commit HERE.
      r := private.commit_owner_mobile(a.id, p_call_row_id, p_org_id, p_owner_agent_id, v_mobile, NULL);
      IF (r->>'forward')::boolean IS DISTINCT FROM true THEN
        v_missed_reason := CASE r->>'reason' WHEN 'dnd' THEN 'dnd' WHEN 'busy' THEN 'busy' ELSE 'offline_no_mobile' END;
        UPDATE public.inbound_route_attempts
           SET stage = 'owner_voicemail', stage_started_at = now(), reserved_agent_ids = '{}',
               voicemail_kind = 'agent', voicemail_agent_id = p_owner_agent_id,
               eligibility_reason = v_reason || '->' || coalesce(r->>'reason', 'refused'), updated_at = now()
         WHERE id = a.id;
        PERFORM public.mark_inbound_missed(p_call_row_id, p_org_id, v_missed_reason, ARRAY[p_owner_agent_id], p_owner_agent_id);
      END IF;
    ELSIF v_stage = 'owner_voicemail' THEN
      PERFORM public.mark_inbound_missed(p_call_row_id, p_org_id, v_missed_reason, ARRAY[p_owner_agent_id], p_owner_agent_id);
    END IF;

    SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
    RETURN jsonb_build_object('created', true, 'attempt', to_jsonb(a), 'stage', a.stage,
                              'targets', to_jsonb(a.reserved_agent_ids), 'mobile', a.mobile_number_dialed);
  END IF;

  -- ── Group mode (no eligible owner) ──
  SELECT coalesce(array_agg(p.id ORDER BY p.id), '{}'::uuid[]) INTO v_group
    FROM public.profiles p
   WHERE p.id = ANY (coalesce(p_candidate_group_ids, '{}'::uuid[]))
     AND p.organization_id = p_org_id AND p.status = 'Active'
     AND btrim(coalesce(p.twilio_client_identity, '')) <> '';

  FOREACH v_id IN ARRAY v_group LOOP
    PERFORM pg_advisory_xact_lock(hashtext('inbound_agent:' || v_id::text));
  END LOOP;

  SELECT coalesce(array_agg(p.id ORDER BY p.id), '{}'::uuid[]) INTO v_eligible
    FROM public.profiles p
   WHERE p.id = ANY (v_group)
     AND coalesce(p.availability_status, 'Available') = 'Available'
     AND public.is_phone_connected(p.id)
     AND NOT public.is_agent_busy(p_org_id, p.id, p_call_row_id);

  IF cardinality(v_eligible) = 0 THEN
    v_stage := 'group_voicemail';
    v_reason := CASE WHEN v_ro_failed THEN 'recent_outbound_unavailable->group_empty'
                     WHEN p_owner_agent_id IS NOT NULL THEN 'owner_ineligible->group_empty'
                     WHEN cardinality(v_group) = 0 THEN 'group_unconfigured' ELSE 'group_none_eligible' END;
  ELSE
    v_stage := 'group_browser';
    v_reason := CASE WHEN v_ro_failed THEN 'recent_outbound_unavailable->group'
                     WHEN p_owner_agent_id IS NOT NULL THEN 'owner_ineligible->group' ELSE 'no_owner->group' END;
  END IF;

  INSERT INTO public.inbound_route_attempts
    (call_id, organization_id, mode, owner_agent_id, owner_source, eligibility_reason, stage,
     reserved_agent_ids, browser_ring_timeout_sent, voicemail_kind, voicemail_group_ids)
  VALUES
    (p_call_row_id, p_org_id, 'group', NULL, NULL, v_reason, v_stage,
     CASE WHEN v_stage = 'group_browser' THEN v_eligible ELSE '{}'::uuid[] END,
     CASE WHEN v_stage = 'group_browser' THEN v_ring END,
     CASE WHEN v_stage = 'group_voicemail' THEN 'group' END,
     CASE WHEN v_stage = 'group_voicemail' THEN v_group END)
  ON CONFLICT (call_id) DO NOTHING
  RETURNING * INTO a;
  IF NOT FOUND THEN
    SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = p_call_row_id;
    RETURN jsonb_build_object('created', false, 'attempt', to_jsonb(a), 'stage', a.stage,
                              'targets', to_jsonb(a.reserved_agent_ids));
  END IF;

  IF v_stage = 'group_voicemail' THEN
    PERFORM public.mark_inbound_missed(p_call_row_id, p_org_id, 'group_empty', v_group, NULL);
  END IF;

  RETURN jsonb_build_object('created', true, 'attempt', to_jsonb(a), 'stage', a.stage,
                            'targets', to_jsonb(a.reserved_agent_ids), 'group', to_jsonb(v_group));
END;
$function$
;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.claim_inbound_call(uuid,uuid,text,text)'))) IS DISTINCT FROM '74939d57f102697c2c375b7d0470b8d6' THEN RAISE EXCEPTION 'Live function drift: claim_inbound_call'; END IF;END $$;
CREATE OR REPLACE FUNCTION public.claim_inbound_call(p_user_id uuid, p_call_row_id uuid, p_child_call_sid text, p_parent_call_sid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_child text := btrim(coalesce(p_child_call_sid, ''));
  v_parent text := btrim(coalesce(p_parent_call_sid, ''));
  v_org uuid;
  v_profile_status text;
  v_identity text;
  r public.calls%ROWTYPE;
  v_row public.calls%ROWTYPE;
BEGIN
  -- R16: strict SID validation before the CAS; blank/malformed rejected.
  IF p_user_id IS NULL OR p_call_row_id IS NULL
     OR v_child !~ '^CA[0-9a-fA-F]{32}$' OR v_parent !~ '^CA[0-9a-fA-F]{32}$' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_sid');
  END IF;

  -- R1: database-authoritative profile checks against the wrapper-verified p_user_id.
  SELECT p.organization_id, p.status,
    CASE WHEN EXISTS(SELECT 1 FROM public.inbounds_room_calls rc WHERE rc.call_id=p_call_row_id AND rc.organization_id=p.organization_id)
    THEN (SELECT t.identity FROM public.inbounds_room_targets t WHERE t.call_id=p_call_row_id AND t.agent_id=p.id AND t.organization_id=p.organization_id)
    ELSE p.twilio_client_identity END
    INTO v_org, v_profile_status, v_identity
    FROM public.profiles p
   WHERE p.id = p_user_id;
  IF NOT FOUND OR v_org IS NULL OR v_profile_status IS DISTINCT FROM 'Active'
     OR v_identity IS NULL OR btrim(v_identity) = '' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'inactive_profile');
  END IF;

  -- C1 FIRST-WRITE CAS — the only write this path ever issues. agent_id IS NULL makes it fire at most
  -- once per row: updated_at bumps exactly once, update triggers fire exactly once. NO live-state
  -- predicate (R19): a delayed authentic callback ENRICHES an already-terminal row; the status CASE
  -- leaves terminal states untouched, and ended_at/duration/terminal metadata are never written.
  UPDATE public.calls SET
    agent_id            = p_user_id,
    provider_session_id = COALESCE(provider_session_id, v_child),   -- first-writer-wins (R2)
    status              = CASE WHEN status = 'ringing' THEN 'connected' ELSE status END,
    updated_at          = now()
  WHERE id = p_call_row_id
    AND organization_id = v_org                    -- exact org match; organization_id is NEVER updated
    AND twilio_call_sid = v_parent                 -- row↔ParentCallSid cross-check (R13/R16)
    AND direction = 'inbound'
    AND agent_id IS NULL                           -- FIRST WRITE ONLY (C1)
    AND (provider_session_id IS NULL
         OR provider_session_id = v_child)         -- same child leg only (R2)
    AND routed_agent_ids IS NOT NULL
    AND p_user_id = ANY (routed_agent_ids)         -- durably persisted routing REQUIRED (R3/R14)
  RETURNING * INTO r;

  IF FOUND THEN
    IF r.provider_session_id IS NULL THEN
      -- structurally unreachable (v_child validated non-blank); assert the R16 invariant anyway
      RAISE EXCEPTION 'claim_inbound_call: provider_session_id NULL after successful claim';
    END IF;
    RETURN jsonb_build_object(
      'claimed', true, 'idempotent', false,
      'enriched_terminal', r.status IN ('completed','failed','no-answer'),
      'call_row_id', r.id, 'agent_id', r.agent_id, 'provider_session_id', r.provider_session_id,
      'status', r.status, 'contact_id', r.contact_id, 'contact_type', r.contact_type,
      'contact_name', r.contact_name, 'contact_phone', r.contact_phone,
      'caller_id_used', r.caller_id_used);
  END IF;

  -- C1 READ-ONLY classification (no UPDATE, no updated_at bump, no trigger, no column change),
  -- in the exact plan §4.2 order.
  SELECT * INTO v_row FROM public.calls WHERE id = p_call_row_id;
  IF NOT FOUND OR v_row.organization_id IS DISTINCT FROM v_org OR v_row.direction <> 'inbound' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'cross_org_or_not_found');
  END IF;
  IF v_row.twilio_call_sid IS DISTINCT FROM v_parent THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'parent_sid_mismatch');
  END IF;
  IF v_row.routed_agent_ids IS NULL OR cardinality(v_row.routed_agent_ids) = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'no_routed_agents');
  END IF;
  IF NOT (p_user_id = ANY (v_row.routed_agent_ids)) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_routed');
  END IF;
  IF v_row.agent_id = p_user_id AND v_row.provider_session_id = v_child THEN
    -- exact duplicate: same row, parent SID, org, direction, agent, child SID, routed membership —
    -- idempotent success FROM THE READ ALONE; the row (updated_at included) stays byte-identical.
    RETURN jsonb_build_object(
      'claimed', true, 'idempotent', true,
      'enriched_terminal', v_row.status IN ('completed','failed','no-answer'),
      'call_row_id', v_row.id, 'agent_id', v_row.agent_id,
      'provider_session_id', v_row.provider_session_id, 'status', v_row.status,
      'contact_id', v_row.contact_id, 'contact_type', v_row.contact_type,
      'contact_name', v_row.contact_name, 'contact_phone', v_row.contact_phone,
      'caller_id_used', v_row.caller_id_used);
  END IF;
  IF v_row.agent_id = p_user_id THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'sid_conflict');
  END IF;
  IF v_row.agent_id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_claimed');
  END IF;
  -- agent_id NULL but the CAS did not fire: the only remaining cause is a foreign provider_session_id.
  RETURN jsonb_build_object('claimed', false, 'reason', 'sid_conflict');
END;
$function$
;
COMMIT;
