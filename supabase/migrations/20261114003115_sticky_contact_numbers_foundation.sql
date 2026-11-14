-- Isolated candidate only. No organization activation or disposition seed is included.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
CREATE ROLE agentflow_affinity_scope NOLOGIN INHERIT NOBYPASSRLS;
GRANT authenticated TO agentflow_affinity_scope;
GRANT USAGE ON SCHEMA public,private,auth TO agentflow_affinity_scope;

CREATE TABLE private.contact_number_settings (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 voice_mode text NOT NULL DEFAULT 'off' CHECK(voice_mode IN ('off','shadow','enforced','guard_only')),
 sms_mode text NOT NULL DEFAULT 'off' CHECK(sms_mode IN ('off','shadow','enforced','guard_only')),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE private.contact_number_enforcement (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 voice_ever boolean NOT NULL DEFAULT false, sms_ever boolean NOT NULL DEFAULT false,
 first_enforced_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE private.contact_number_affinities (
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 phone_e164 text NOT NULL CHECK(phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
 generation bigint NOT NULL DEFAULT 0,
 voice_number_id uuid, voice_number text, voice_state text NOT NULL DEFAULT 'unassigned', voice_version bigint NOT NULL DEFAULT 0,
 sms_number_id uuid, sms_number text, sms_state text NOT NULL DEFAULT 'unassigned', sms_version bigint NOT NULL DEFAULT 0,
 voice_source text, sms_source text, voice_event text, sms_event text,
 history_state text NOT NULL DEFAULT 'new' CHECK(history_state IN ('new','reconciled','needs_review')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,phone_e164),
 CHECK(voice_state IN ('unassigned','established','needs_review')),
 CHECK(sms_state IN ('unassigned','reserved','established','needs_review')),
 CHECK((voice_number_id IS NULL)=(voice_number IS NULL)), CHECK((sms_number_id IS NULL)=(sms_number IS NULL)),
 CHECK(voice_state <> 'unassigned' OR voice_number_id IS NULL), CHECK(sms_state <> 'unassigned' OR sms_number_id IS NULL),
 CHECK(voice_state <> 'established' OR voice_number_id IS NOT NULL),
 CHECK(sms_state NOT IN ('reserved','established') OR sms_number_id IS NOT NULL)
);
-- Deliberately no number FK: deletion must retain the exact historical number identity and snapshot.
CREATE TABLE private.contact_number_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id uuid NOT NULL,
 phone_e164 text NOT NULL, channel text NOT NULL CHECK(channel IN ('voice','sms','both')),
 kind text NOT NULL, actor_id uuid, number_id uuid, number_snapshot text, generation bigint NOT NULL,
 evidence_key text, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,phone_e164) REFERENCES private.contact_number_affinities(organization_id,phone_e164)
);
CREATE INDEX contact_number_event_endpoint ON private.contact_number_events(organization_id,phone_e164,id DESC);
CREATE TABLE private.contact_number_observations (
 organization_id uuid NOT NULL, evidence_key text NOT NULL, phone_e164 text NOT NULL,
 channel text NOT NULL, candidate_id uuid, details jsonb NOT NULL DEFAULT '{}', observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,evidence_key)
);
ALTER TABLE public.dispositions ADD COLUMN affinity_class text NOT NULL DEFAULT 'unreviewed'
 CHECK(affinity_class IN ('unreviewed','excluded','duration','confirmed'));
-- Default remains unreviewed; labels and counts_as_contacted are never a classification.
CREATE INDEX affinity_lead_phone ON public.leads(organization_id,(private.phone_digits_e164ish(phone)));
CREATE INDEX affinity_client_phone ON public.clients(organization_id,(private.phone_digits_e164ish(phone)));
CREATE INDEX affinity_recruit_phone ON public.recruits(organization_id,(private.phone_digits_e164ish(phone)));
CREATE INDEX affinity_call_phone ON public.calls(organization_id,(private.phone_digits_e164ish(contact_phone)),created_at DESC);
CREATE INDEX affinity_message_to ON public.messages(organization_id,(private.phone_digits_e164ish(to_number)));
CREATE INDEX affinity_message_from ON public.messages(organization_id,(private.phone_digits_e164ish(from_number)));

CREATE FUNCTION private.affinity_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'affinity_immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER contact_number_events_immutable BEFORE UPDATE OR DELETE ON private.contact_number_events FOR EACH ROW EXECUTE FUNCTION private.affinity_immutable();
CREATE TRIGGER contact_number_enforcement_no_delete BEFORE DELETE ON private.contact_number_enforcement FOR EACH ROW EXECUTE FUNCTION private.affinity_immutable();
CREATE FUNCTION private.affinity_enforcement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='contact_number_enforcement' THEN
  IF (OLD.voice_ever AND NOT NEW.voice_ever) OR (OLD.sms_ever AND NOT NEW.sms_ever) THEN RAISE EXCEPTION 'affinity_enforcement_irreversible'; END IF;
 ELSE
  INSERT INTO private.contact_number_enforcement(organization_id,voice_ever,sms_ever)
   VALUES(NEW.organization_id,NEW.voice_mode='enforced',NEW.sms_mode='enforced')
   ON CONFLICT(organization_id) DO UPDATE SET voice_ever=contact_number_enforcement.voice_ever OR excluded.voice_ever,
    sms_ever=contact_number_enforcement.sms_ever OR excluded.sms_ever;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER contact_number_enforcement_monotonic BEFORE UPDATE ON private.contact_number_enforcement FOR EACH ROW EXECUTE FUNCTION private.affinity_enforcement_guard();
CREATE TRIGGER contact_number_settings_guard AFTER INSERT OR UPDATE ON private.contact_number_settings FOR EACH ROW EXECUTE FUNCTION private.affinity_enforcement_guard();

CREATE FUNCTION private.affinity_phone(p_phone text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE digits text:=private.phone_digits_e164ish(p_phone);
BEGIN IF digits IS NULL OR digits !~ '^[1-9][0-9]{6,14}$' THEN RAISE EXCEPTION 'affinity_phone_invalid' USING ERRCODE='22023';END IF;RETURN '+'||digits;END $$;
CREATE FUNCTION private.affinity_mode(p_org uuid,p_channel text) RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN coalesce(CASE WHEN p_channel='sms' THEN e.sms_ever ELSE e.voice_ever END,false)
  AND coalesce(CASE WHEN p_channel='sms' THEN s.sms_mode ELSE s.voice_mode END,'off') IN ('off','shadow') THEN 'guard_only'
  ELSE coalesce(CASE WHEN p_channel='sms' THEN s.sms_mode ELSE s.voice_mode END,'off') END
 FROM (SELECT p_org organization_id) o LEFT JOIN private.contact_number_settings s USING(organization_id)
 LEFT JOIN private.contact_number_enforcement e USING(organization_id)
$$;
CREATE FUNCTION public.sticky_number_guard(p_org uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('voice',private.affinity_mode(p_org,'voice'),'sms',private.affinity_mode(p_org,'sms'))
$$;

-- This limited owner inherits existing authenticated RLS. Calling from a privileged
-- service wrapper does not turn the underlying contact SELECT into an RLS bypass.
CREATE FUNCTION private.affinity_contact_scope(p_org uuid,p_id uuid,p_type text,p_phone text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE contact jsonb; actor public.profiles;
BEGIN
 SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() AND organization_id=p_org AND status='Active';
 IF NOT FOUND OR p_org IS DISTINCT FROM public.get_org_id() OR actor.role IS DISTINCT FROM public.get_user_role() THEN RAISE EXCEPTION 'affinity_scope' USING ERRCODE='42501';END IF;
 IF p_type='lead' THEN SELECT to_jsonb(l) INTO contact FROM public.leads l WHERE id=p_id AND organization_id=p_org;
 ELSIF p_type='client' THEN SELECT to_jsonb(c) INTO contact FROM public.clients c WHERE id=p_id AND organization_id=p_org;
 ELSIF p_type='recruit' THEN SELECT to_jsonb(r) INTO contact FROM public.recruits r WHERE id=p_id AND organization_id=p_org;
 ELSE RAISE EXCEPTION 'affinity_scope' USING ERRCODE='42501';END IF;
 IF contact IS NULL OR (p_phone IS NOT NULL AND private.affinity_phone(contact->>'phone') IS DISTINCT FROM private.affinity_phone(p_phone))
 THEN RAISE EXCEPTION 'affinity_scope_changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('organization_id',p_org,'actor_id',actor.id,'role',actor.role,'phone',private.affinity_phone(contact->>'phone'),'contact_id',p_id,'contact_type',p_type);
END $$;
ALTER FUNCTION private.affinity_contact_scope(uuid,uuid,text,text) OWNER TO agentflow_affinity_scope;
GRANT EXECUTE ON FUNCTION private.affinity_phone(text),private.phone_digits_e164ish(text) TO agentflow_affinity_scope;
CREATE FUNCTION private.affinity_assert_contact(p_org uuid,p_id uuid,p_type text,p_phone text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result:=private.affinity_contact_scope(p_org,p_id,p_type,p_phone);
 IF p_type='lead' AND EXISTS(SELECT 1 FROM public.clients WHERE organization_id=p_org AND lead_id=p_id)
 THEN RAISE EXCEPTION 'affinity_contact_converted' USING ERRCODE='42501';END IF;
 RETURN result;
END $$;
CREATE FUNCTION private.affinity_actor_claims(p_org uuid,p_actor uuid) RETURNS text LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.profiles; prior text:=current_setting('request.jwt.claims',true);
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=p_actor AND organization_id=p_org AND status='Active';
 IF NOT FOUND THEN RAISE EXCEPTION 'affinity_actor' USING ERRCODE='42501';END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'role','authenticated','app_metadata',jsonb_build_object('organization_id',p.organization_id,'role',p.role))::text,true);
 RETURN prior;
END $$;
CREATE FUNCTION private.affinity_lock(p_org uuid,p_phone text) RETURNS void LANGUAGE sql SET search_path='' AS $$
 SELECT pg_advisory_xact_lock(private.dnc_phone_lock_key(p_org,p_phone))
$$;
CREATE FUNCTION private.affinity_has_history(p_org uuid,p_phone text) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.messages WHERE organization_id=p_org AND (private.phone_digits_e164ish(to_number)=substr(p_phone,2)
 OR private.phone_digits_e164ish(from_number)=substr(p_phone,2))) OR EXISTS(SELECT 1 FROM public.calls WHERE organization_id=p_org
 AND private.phone_digits_e164ish(contact_phone)=substr(p_phone,2) AND created_at<statement_timestamp())
$$;
CREATE FUNCTION private.affinity_ensure(p_org uuid,p_phone text) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM private.affinity_lock(p_org,p_phone);
 INSERT INTO private.contact_number_affinities(organization_id,phone_e164,history_state)
 VALUES(p_org,p_phone,CASE WHEN private.affinity_has_history(p_org,p_phone) THEN 'needs_review' ELSE 'new' END)
 ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION private.affinity_number(p_org uuid,p_number uuid,p_channel text,p_actor uuid DEFAULT NULL,p_manual boolean DEFAULT false,p_group uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE n public.phone_numbers; p public.sms_agency_policies; a public.a2p_accounts; r public.a2p_registrations; m public.a2p_numbers; code text;
BEGIN
 SELECT * INTO n FROM public.phone_numbers WHERE id=p_number AND organization_id=p_org;
 IF NOT FOUND OR lower(n.status)<>'active' OR n.inbounds_only OR (coalesce(n.assignment_type,'agency')<>'agency'
 AND NOT (p_manual AND n.assignment_type='personal' AND n.assigned_to=p_actor)) THEN code:='unavailable';
 ELSIF p_channel='voice' THEN
  IF p_group IS NOT NULL AND n.assignment_type<>'personal' AND NOT EXISTS(SELECT 1 FROM public.number_group_members gm
    JOIN public.number_groups g ON g.id=gm.number_group_id AND g.organization_id=p_org WHERE gm.phone_number_id=n.id AND gm.number_group_id=p_group)
  THEN code:='group_conflict';
  ELSIF coalesce(n.daily_call_count,0)>=coalesce(n.daily_call_limit,100) THEN code:='daily_limit'; ELSE code:='ready'; END IF;
 ELSE
  SELECT * INTO p FROM public.sms_agency_policies WHERE organization_id=p_org;
  SELECT * INTO a FROM public.a2p_accounts WHERE organization_id=p_org;
  SELECT * INTO r FROM public.a2p_registrations WHERE organization_id=p_org;
  SELECT * INTO m FROM public.a2p_numbers WHERE organization_id=p_org AND phone_number_id=n.id;
  IF n.phone_number ~ '^\+1(800|833|844|855|866|877|888)' THEN code:='unavailable';
  ELSIF a.organization_id IS NULL OR NOT a.enabled OR NOT a.sms_enforced OR (r.brand_status IS DISTINCT FROM 'APPROVED' OR coalesce(r.identity_status,'') NOT IN ('VERIFIED','VETTED_VERIFIED') OR r.is_test IS DISTINCT FROM false) OR r.campaign_status IS DISTINCT FROM 'VERIFIED' THEN code:='agency_approval_required';
  ELSIF p.organization_id IS NULL OR NOT p.enforced THEN code:='setup_required';
  ELSIF NOT p.send_enabled THEN code:='texting_paused';
  ELSIF r.sync_error IS NOT NULL OR r.account_sid IS DISTINCT FROM a.account_sid OR m.status IN ('failed','error') THEN code:='setup_needs_attention';
  ELSIF NOT(n.id=ANY(p.selected_phone_ids)) OR m.phone_number_id IS NULL THEN code:='setup_required';
  ELSIF m.status IN ('pending','registering','pending_registration') OR r.operation_id IS NOT NULL THEN code:='setting_up_texting';
  ELSIF m.status IS DISTINCT FROM 'registered' OR m.messaging_service_sid IS DISTINCT FROM r.messaging_service_sid OR NOT coalesce(m.pool_member,false)
    OR m.phone_sid IS DISTINCT FROM n.twilio_sid OR r.last_synced_at IS NULL OR r.last_synced_at<now()-interval '24 hours' THEN code:='setup_needs_attention';
  ELSE code:='ready';END IF;
 END IF;
 RETURN jsonb_build_object('id',p_number,'number',n.phone_number,'readiness',code,'provisional',true);
END $$;
CREATE FUNCTION private.affinity_default(p_org uuid,p_channel text,p_actor uuid DEFAULT NULL,p_group uuid DEFAULT NULL) RETURNS uuid
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT n.id FROM public.phone_numbers n WHERE n.organization_id=p_org AND coalesce(n.assignment_type,'agency')='agency'
 AND private.affinity_number(p_org,n.id,p_channel,p_actor,false,p_group)->>'readiness'='ready'
 ORDER BY n.is_default DESC,n.id LIMIT 1
$$;
CREATE FUNCTION private.affinity_view(p_org uuid,p_phone text,p_actor uuid,p_group uuid DEFAULT NULL) RETURNS jsonb
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
 'voice',private.affinity_number(p_org,v,'voice',p_actor,false,p_group)||jsonb_build_object('number',coalesce(a.voice_number,a.sms_number,(SELECT phone_number FROM public.phone_numbers WHERE id=v AND organization_id=p_org)),'state',coalesce(a.voice_state,'unassigned'),'version',coalesce(a.voice_version,0)),
 'sms',private.affinity_number(p_org,s,'sms',p_actor)||jsonb_build_object('number',coalesce(a.sms_number,a.voice_number,(SELECT phone_number FROM public.phone_numbers WHERE id=s AND organization_id=p_org)),'state',coalesce(a.sms_state,'unassigned'),'version',coalesce(a.sms_version,0)));
END $$;
CREATE FUNCTION public.preview_contact_numbers(p_contact uuid,p_type text,p_campaign uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; scope jsonb; grp uuid;
BEGIN
 SELECT organization_id INTO org FROM public.profiles WHERE id=auth.uid() AND status='Active';
 scope:=private.affinity_assert_contact(org,p_contact,p_type);
 IF p_campaign IS NOT NULL THEN SELECT number_group_id INTO grp FROM public.campaigns WHERE id=p_campaign AND organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'affinity_campaign' USING ERRCODE='42501';END IF;END IF;
 RETURN private.affinity_view(org,scope->>'phone',auth.uid(),grp);
END $$;

-- Private tables have no browser policies or grants; authorized RPCs return only the
-- selected contact's shared number identity, never related contacts or message data.
DO $seal$
DECLARE r record;
BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='private' AND tablename LIKE 'contact_number_%' LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',r.tablename);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',r.tablename);
 END LOOP;
 FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='private' AND p.proname LIKE 'affinity_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.signature);
 END LOOP;
END $seal$;
GRANT EXECUTE ON FUNCTION private.affinity_phone(text),private.phone_digits_e164ish(text) TO agentflow_affinity_scope;
REVOKE ALL ON FUNCTION public.preview_contact_numbers(uuid,text,uuid),public.sticky_number_guard(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_contact_numbers(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sticky_number_guard(uuid) TO service_role;
