-- Approved isolated implementation. Apply only with the reviewed release packet.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.create_client_with_sale(uuid,uuid,jsonb,boolean)'::regprocedure))
       <> 'd9f0f8c20e9548a70769132bcce4a007'
     OR md5(pg_get_functiondef('public.convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid)'::regprocedure))
       <> '3d974a5c893753d5f10cacd9605c565f' THEN
    RAISE EXCEPTION 'Sale writer preimage changed';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN ('public.create_client_with_sale(uuid,uuid,jsonb,boolean)'::regprocedure,'public.convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid)'::regprocedure)
    AND (proowner<>'postgres'::regrole OR NOT prosecdef OR has_function_privilege('anon',oid,'EXECUTE') OR NOT has_function_privilege('authenticated',oid,'EXECUTE'))) THEN
    RAISE EXCEPTION 'Sale writer authorization metadata changed'; END IF;
END $guard$;

ALTER TABLE public.clients ADD COLUMN primary_policy_id uuid;
ALTER TABLE public.wins ADD COLUMN policy_id uuid;
ALTER TABLE public.wins ADD COLUMN recorded_at timestamptz;
ALTER TABLE public.wins ALTER COLUMN recorded_at SET DEFAULT clock_timestamp();
ALTER TABLE public.wins ADD COLUMN event_time_source text NOT NULL DEFAULT 'event';
ALTER TABLE public.wins ADD CONSTRAINT wins_event_time_source_check
  CHECK(event_time_source IN ('event','sold_date_proxy','client_creation_proxy'));
CREATE UNIQUE INDEX wins_policy_identity ON public.wins(organization_id,policy_id) WHERE policy_id IS NOT NULL;

CREATE TABLE private.policy_identities (
  policy_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  source text NOT NULL CHECK(source IN ('primary','additional')),
  legacy boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(organization_id,policy_id)
);
CREATE INDEX policy_identities_client ON private.policy_identities(organization_id,client_id);
ALTER TABLE private.policy_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.policy_identities FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.wins ADD CONSTRAINT wins_policy_registry_fk
 FOREIGN KEY(organization_id,policy_id) REFERENCES private.policy_identities(organization_id,policy_id);

CREATE FUNCTION private.has_primary_policy(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT nullif(btrim(p->>'carrier'),'') IS NOT NULL
 OR nullif(btrim(p->>'policy_number'),'') IS NOT NULL
 OR coalesce((p->>'premium')::numeric,0)>0
 OR coalesce((p->>'face_amount')::numeric,0)>0
 OR nullif(p->>'sold_date','') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION private.has_primary_policy(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Trigger-only identity registration. Unchanged legacy policies do not acquire new sales.
CREATE FUNCTION private.ensure_policy_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 old_primary boolean := false; old_items jsonb := '[]'; items jsonb; item jsonb; result jsonb := '[]';
 identity uuid; is_legacy boolean; existing private.policy_identities%ROWTYPE; seen uuid[] := '{}';
BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM private.policy_identities p WHERE p.client_id=NEW.id) THEN
  RAISE EXCEPTION 'A deleted policy-bearing client identity cannot be recreated' USING ERRCODE='23514'; END IF;
 IF (TG_OP='INSERT' OR NEW.premium IS DISTINCT FROM OLD.premium) AND NEW.premium<0 THEN
   RAISE EXCEPTION 'Premium cannot be negative' USING ERRCODE='22023'; END IF;
 IF (TG_OP='INSERT' OR NEW.face_amount IS DISTINCT FROM OLD.face_amount) AND NEW.face_amount<0 THEN
   RAISE EXCEPTION 'Face amount cannot be negative' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' THEN
   old_primary := private.has_primary_policy(to_jsonb(OLD));
   old_items := coalesce(OLD.custom_fields->'additional_policies','[]');
   IF OLD.primary_policy_id IS NOT NULL AND NEW.primary_policy_id IS DISTINCT FROM OLD.primary_policy_id THEN
     RAISE EXCEPTION 'An existing policy identity cannot be replaced' USING ERRCODE='22023';
   END IF;
 END IF;
 IF private.has_primary_policy(to_jsonb(NEW)) OR NEW.primary_policy_id IS NOT NULL THEN
   NEW.primary_policy_id := coalesce(NEW.primary_policy_id,gen_random_uuid());
   SELECT * INTO existing FROM private.policy_identities WHERE policy_id=NEW.primary_policy_id;
   IF FOUND THEN
     IF existing.organization_id IS DISTINCT FROM NEW.organization_id OR existing.client_id<>NEW.id OR existing.source<>'primary' THEN
       RAISE EXCEPTION 'Policy identity belongs to another record' USING ERRCODE='42501';
     END IF;
   ELSE
     INSERT INTO private.policy_identities VALUES(NEW.primary_policy_id,NEW.organization_id,NEW.id,'primary',old_primary,clock_timestamp());
   END IF;
 END IF;
 items := coalesce(NEW.custom_fields->'additional_policies','[]');
 IF jsonb_typeof(items)<>'array' THEN
   IF TG_OP='UPDATE' AND items=old_items THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Additional policies must be an array' USING ERRCODE='22023';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
   IF jsonb_typeof(item)<>'object' THEN
     IF TG_OP='UPDATE' AND items=old_items THEN result:=result||jsonb_build_array(item); CONTINUE; END IF;
     RAISE EXCEPTION 'Invalid additional policy' USING ERRCODE='22023';
   END IF;
   identity := nullif(item->>'policyId','')::uuid;
   is_legacy := false;
   IF identity IS NULL AND TG_OP='UPDATE' AND jsonb_typeof(old_items)='array' THEN
     is_legacy := EXISTS(SELECT 1 FROM jsonb_array_elements(old_items) x WHERE x=item);
   END IF;
   identity := coalesce(identity,gen_random_uuid());
   IF identity=ANY(seen) THEN RAISE EXCEPTION 'Duplicate policy identity' USING ERRCODE='22023'; END IF;
   seen := array_append(seen,identity);
   SELECT * INTO existing FROM private.policy_identities WHERE policy_id=identity;
   IF FOUND THEN
     IF existing.organization_id IS DISTINCT FROM NEW.organization_id OR existing.client_id<>NEW.id OR existing.source<>'additional' THEN
       RAISE EXCEPTION 'Policy identity belongs to another record' USING ERRCODE='42501';
     END IF;
   ELSE
     INSERT INTO private.policy_identities VALUES(identity,NEW.organization_id,NEW.id,'additional',is_legacy,clock_timestamp());
   END IF;
   result := result || jsonb_build_array(item||jsonb_build_object('policyId',identity));
 END LOOP;
 IF NEW.custom_fields ? 'additional_policies' THEN
   NEW.custom_fields := jsonb_set(NEW.custom_fields,'{additional_policies}',result);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.ensure_policy_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER clients_policy_identity BEFORE INSERT OR UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION private.ensure_policy_identity();

CREATE FUNCTION private.check_policy_sale_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid; client uuid;
BEGIN
 IF TG_TABLE_NAME='clients' THEN org:=NEW.organization_id; client:=NEW.id;
 ELSE org:=OLD.organization_id; client:=OLD.contact_id; END IF;
 IF EXISTS(SELECT 1 FROM private.policy_identities p
   WHERE p.organization_id=org AND p.client_id=client AND NOT p.legacy
   AND NOT EXISTS(SELECT 1 FROM public.wins w WHERE w.organization_id=p.organization_id AND w.policy_id=p.policy_id)) THEN
   RAISE EXCEPTION 'A new policy must be saved together with its sale; use Record Policy' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.check_policy_sale_complete() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER clients_policy_sale_complete AFTER INSERT OR UPDATE ON public.clients
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_policy_sale_complete();
CREATE CONSTRAINT TRIGGER wins_policy_sale_complete AFTER DELETE ON public.wins
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_policy_sale_complete();

CREATE TABLE private.policy_sale_reversals(
 win_id uuid PRIMARY KEY, operation_key text NOT NULL UNIQUE, row_hash text NOT NULL,
 before_row jsonb NOT NULL, reason text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), consumed_at timestamptz
);
ALTER TABLE private.policy_sale_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.policy_sale_reversals FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.guard_policy_win() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF current_user='postgres' THEN
     -- Only an owner-reviewed, exact-postimage reversal ticket can remove a repaired event.
     UPDATE private.policy_sale_reversals SET consumed_at=clock_timestamp()
      WHERE win_id=OLD.id AND consumed_at IS NULL AND row_hash=md5(to_jsonb(OLD)::text);
     IF FOUND THEN RETURN OLD; END IF;
   END IF;
   RAISE EXCEPTION 'Recorded sales require an audited correction, not deletion' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
   IF current_user NOT IN ('postgres','service_role') THEN
     RAISE EXCEPTION 'Use an atomic policy writer to record sales' USING ERRCODE='42501'; END IF;
   IF NEW.policy_id IS NULL OR NOT NEW.premium_snapshot OR NOT EXISTS(
     SELECT 1 FROM private.policy_identities p JOIN public.clients c ON c.id=p.client_id AND c.organization_id=p.organization_id
     WHERE p.policy_id=NEW.policy_id AND p.organization_id=NEW.organization_id
       AND p.client_id=NEW.contact_id AND c.assigned_agent_id IS NOT DISTINCT FROM NEW.agent_id
   ) THEN RAISE EXCEPTION 'A sale requires its authorized stored policy' USING ERRCODE='23514'; END IF;
 ELSIF (to_jsonb(NEW)-ARRAY['celebrated','notes','policy_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['celebrated','notes','policy_id'])
   OR (OLD.policy_id IS NOT NULL AND NEW.policy_id IS DISTINCT FROM OLD.policy_id) THEN
   RAISE EXCEPTION 'Recorded policy sales are immutable; use an audited correction' USING ERRCODE='23514';
 END IF;
 IF (TG_OP='INSERT' OR NEW.policy_id IS DISTINCT FROM OLD.policy_id) AND NEW.policy_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.policy_identities p
   WHERE p.policy_id=NEW.policy_id AND p.organization_id=NEW.organization_id AND p.client_id=NEW.contact_id) THEN
   RAISE EXCEPTION 'Policy identity belongs to another sale' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_policy_win() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER wins_policy_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.wins
FOR EACH ROW EXECUTE FUNCTION private.guard_policy_win();

-- Same signature used by both existing atomic wrappers. Primary/additional IDs are read from
-- the stored client after its BEFORE trigger; receipt keys remain backward compatible.
CREATE OR REPLACE FUNCTION private.insert_policy_sale(p_client_id uuid,p_policy jsonb,p_key text,p_campaign uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.clients%ROWTYPE; v record; v_win_id uuid; policy uuid; ordinal integer;
 agent_name text; campaign_name text; event_time timestamptz:=now(); historical boolean; zone text;
BEGIN
 SELECT * INTO STRICT c FROM public.clients WHERE public.clients.id=p_client_id;
 SELECT * INTO v FROM private.policy_sale_values(p_policy);
 ordinal := substring(p_key FROM ':policy:([0-9]+)$')::integer;
 policy := coalesce(nullif(p_policy->>'policy_id','')::uuid,
   CASE WHEN ordinal IS NULL THEN c.primary_policy_id ELSE (c.custom_fields->'additional_policies'->(ordinal-1)->>'policyId')::uuid END);
 IF NOT EXISTS(SELECT 1 FROM private.policy_identities p WHERE p.policy_id=policy AND p.client_id=c.id AND p.organization_id=c.organization_id) THEN
   RAISE EXCEPTION 'Missing stored policy identity' USING ERRCODE='23514';
 END IF;
 SELECT concat_ws(' ',p.first_name,p.last_name) INTO agent_name FROM public.profiles p
 WHERE p.id=c.assigned_agent_id AND p.organization_id=c.organization_id;
 IF c.assigned_agent_id IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'Invalid sale agent' USING ERRCODE='42501'; END IF;
 IF p_campaign IS NOT NULL THEN
   SELECT name INTO campaign_name FROM public.campaigns WHERE public.campaigns.id=p_campaign AND organization_id=c.organization_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Invalid sale campaign' USING ERRCODE='42501'; END IF;
 END IF;
 historical := coalesce(p_policy->>'sale_mode','new')='historical';
 IF coalesce(p_policy->>'sale_mode','new') NOT IN ('new','historical') THEN RAISE EXCEPTION 'Invalid sale mode' USING ERRCODE='22023'; END IF;
 IF historical THEN
   IF c.assigned_agent_id IS NULL THEN RAISE EXCEPTION 'Historical sale requires a seller' USING ERRCODE='22023'; END IF;
   SELECT time_zone INTO zone FROM private.report_agency_time_zone(c.organization_id);
   event_time := v.sold_date::timestamp AT TIME ZONE zone;
   IF event_time>now() THEN RAISE EXCEPTION 'Historical sold date cannot be in the future' USING ERRCODE='22023'; END IF;
 END IF;
 INSERT INTO public.wins(organization_id,policy_id,agent_id,agent_name,contact_id,contact_name,campaign_id,campaign_name,
   policy_type,premium_amount,premium_snapshot,sold_date,idempotency_key,created_at,celebrated,event_time_source)
 VALUES(c.organization_id,policy,c.assigned_agent_id,agent_name,c.id,concat_ws(' ',c.first_name,c.last_name),
   p_campaign,campaign_name,v.policy_type,v.premium,true,v.sold_date,p_key,event_time,historical,
   CASE WHEN historical THEN 'sold_date_proxy' ELSE 'event' END) RETURNING public.wins.id INTO v_win_id;
 RETURN v_win_id;
END $$;

-- Full editable-client patch, with existing owner authorization; identity and privileged columns
-- are not accepted. A first primary policy gets its event inside the same transaction.
CREATE FUNCTION public.update_client_with_policy_sale(p_client_id uuid,p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor record; before_row public.clients%ROWTYPE; c public.clients%ROWTYPE; merged public.clients%ROWTYPE; ids uuid[]:='{}';
BEGIN
 SELECT * INTO actor FROM private.campaign_actor();
 SELECT * INTO before_row FROM public.clients WHERE id=p_client_id AND organization_id=actor.org_id FOR UPDATE;
 IF NOT FOUND OR NOT coalesce(before_row.assigned_agent_id=actor.uid OR actor.actor_role='Admin' OR actor.is_super
  OR(actor.actor_role IN ('Team Leader','Team Lead') AND public.is_ancestor_of(actor.uid,before_row.assigned_agent_id)),false) THEN
   RAISE EXCEPTION 'Client not available' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_patch)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k<>ALL(ARRAY[
  'first_name','last_name','phone','email','state','policy_type','carrier','policy_number','premium','face_amount',
  'issue_date','effective_date','sold_date','draft_date','payment_frequency','beneficiary_name','beneficiary_relationship',
  'beneficiary_phone','notes','assigned_agent_id','custom_fields','updated_at'])) THEN
   RAISE EXCEPTION 'Invalid client edit' USING ERRCODE='22023';
 END IF;
 merged := jsonb_populate_record(before_row,p_patch);
 IF merged.assigned_agent_id IS DISTINCT FROM before_row.assigned_agent_id AND NOT(
   EXISTS(SELECT 1 FROM public.profiles WHERE id=merged.assigned_agent_id AND organization_id=actor.org_id)
   AND coalesce(actor.actor_role='Admin' OR actor.is_super OR(actor.actor_role IN ('Team Leader','Team Lead')
     AND public.is_ancestor_of(actor.uid,merged.assigned_agent_id)),false)) THEN
   RAISE EXCEPTION 'Invalid client owner' USING ERRCODE='42501';
 END IF;
 UPDATE public.clients SET first_name=merged.first_name,last_name=merged.last_name,phone=merged.phone,email=merged.email,
 state=merged.state,policy_type=merged.policy_type,carrier=merged.carrier,policy_number=merged.policy_number,premium=merged.premium,
 face_amount=merged.face_amount,issue_date=merged.issue_date,effective_date=merged.effective_date,sold_date=merged.sold_date,
 draft_date=merged.draft_date,payment_frequency=merged.payment_frequency,beneficiary_name=merged.beneficiary_name,
 beneficiary_relationship=merged.beneficiary_relationship,beneficiary_phone=merged.beneficiary_phone,notes=merged.notes,
 assigned_agent_id=merged.assigned_agent_id,custom_fields=merged.custom_fields,updated_at=now()
 WHERE id=p_client_id RETURNING * INTO c;
 IF NOT private.has_primary_policy(to_jsonb(before_row)) AND before_row.primary_policy_id IS NULL AND private.has_primary_policy(to_jsonb(c)) THEN
   ids:=ARRAY[private.insert_policy_sale(c.id,to_jsonb(c),'policy:'||c.primary_policy_id,NULL)];
 END IF;
 RETURN jsonb_build_object('client',to_jsonb(c),'client_id',c.id,'win_ids',ids);
END $$;
REVOKE ALL ON FUNCTION public.update_client_with_policy_sale(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_client_with_policy_sale(uuid,jsonb) TO authenticated,service_role;

CREATE FUNCTION public.record_client_policy(p_request_id uuid,p_client_id uuid,p_policy jsonb,p_primary boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor record; c public.clients%ROWTYPE; key text; hash text; receipt private.policy_sale_receipts%ROWTYPE; v record; v_win_id uuid; item jsonb;
BEGIN
 SELECT * INTO actor FROM private.campaign_actor();
 IF p_request_id IS NULL OR p_primary IS NULL THEN RAISE EXCEPTION 'Missing policy request' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.clients WHERE id=p_client_id AND organization_id=actor.org_id FOR UPDATE;
 IF NOT FOUND OR NOT coalesce(c.assigned_agent_id=actor.uid OR actor.actor_role='Admin' OR actor.is_super
  OR(actor.actor_role IN ('Team Leader','Team Lead') AND public.is_ancestor_of(actor.uid,c.assigned_agent_id)),false) THEN
   RAISE EXCEPTION 'Client not available' USING ERRCODE='42501';
 END IF;
 key:='policy:'||p_request_id;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_client_id,p_policy,p_primary)::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM private.policy_sale_receipts WHERE organization_id=actor.org_id AND operation_key=key;
 IF FOUND THEN
   IF receipt.actor_id<>actor.uid OR receipt.payload_hash<>hash THEN RAISE EXCEPTION 'Policy request already saved different details' USING ERRCODE='22023'; END IF;
   RETURN jsonb_build_object('client',to_jsonb(c),'client_id',c.id,'win_ids',receipt.win_ids,'idempotent',true);
 END IF;
 SELECT * INTO v FROM private.policy_sale_values(p_policy);
 IF nullif(btrim(p_policy->>'policy_number'),'') IS NOT NULL AND (
   (lower(btrim(c.carrier))=lower(btrim(p_policy->>'carrier')) AND lower(btrim(c.policy_number))=lower(btrim(p_policy->>'policy_number')))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.custom_fields->'additional_policies')='array' THEN c.custom_fields->'additional_policies' ELSE '[]'::jsonb END) x
    WHERE lower(btrim(x->>'carrier'))=lower(btrim(p_policy->>'carrier')) AND lower(btrim(x->>'policyNumber'))=lower(btrim(p_policy->>'policy_number')))) THEN
   RAISE EXCEPTION 'This carrier and policy number are already recorded. Edit the existing policy.' USING ERRCODE='22023';
 END IF;
 IF p_primary THEN
   IF c.primary_policy_id IS NOT NULL OR private.has_primary_policy(to_jsonb(c)) THEN RAISE EXCEPTION 'Client already has a primary policy' USING ERRCODE='22023'; END IF;
   UPDATE public.clients SET primary_policy_id=p_request_id,policy_type=v.policy_type,carrier=p_policy->>'carrier',
     policy_number=p_policy->>'policy_number',premium=v.premium,sold_date=v.sold_date,
     face_amount=nullif(p_policy->>'face_amount','')::numeric,effective_date=nullif(p_policy->>'effective_date',''),
     updated_at=now() WHERE public.clients.id=c.id RETURNING * INTO c;
 ELSE
   IF c.custom_fields ? 'additional_policies' AND jsonb_typeof(c.custom_fields->'additional_policies')<>'array' THEN
     RAISE EXCEPTION 'Existing additional policy data needs review' USING ERRCODE='22023';
   END IF;
   item:=jsonb_build_object('policyId',p_request_id,'policyType',v.policy_type,'carrier',p_policy->>'carrier',
     'policyNumber',p_policy->>'policy_number','premiumAmount',v.premium,'soldDate',v.sold_date,
     'faceAmount',p_policy->>'face_amount','effectiveDate',p_policy->>'effective_date');
   UPDATE public.clients SET custom_fields=jsonb_set(coalesce(custom_fields,'{}'),'{additional_policies}',
     coalesce(custom_fields->'additional_policies','[]')||jsonb_build_array(item)),updated_at=now()
     WHERE public.clients.id=c.id RETURNING * INTO c;
 END IF;
 v_win_id:=private.insert_policy_sale(c.id,p_policy||jsonb_build_object('policy_id',p_request_id),key,NULL);
 INSERT INTO private.policy_sale_receipts VALUES(actor.org_id,key,actor.uid,hash,c.id,ARRAY[v_win_id],now());
 RETURN jsonb_build_object('client',to_jsonb(c),'client_id',c.id,'win_ids',ARRAY[v_win_id],'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.record_client_policy(uuid,uuid,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_client_policy(uuid,uuid,jsonb,boolean) TO authenticated,service_role;

-- Small, guarded edits to established functions; signatures/ACLs and the original converter stay intact.
DO $patch$
DECLARE original text;
BEGIN
 SELECT pg_get_functiondef('private.policy_sale_values(jsonb)'::regprocedure) INTO original;
 IF position('premium := coalesce(nullif(v_raw, '''')::numeric, 0);' IN original)=0 THEN RAISE EXCEPTION 'Premium parser changed'; END IF;
 EXECUTE replace(original,'premium := coalesce(nullif(v_raw, '''')::numeric, 0);','premium := nullif(v_raw, '''')::numeric;');
 SELECT pg_get_functiondef('public.create_client_with_sale(uuid,uuid,jsonb,boolean)'::regprocedure) INTO original;
 EXECUTE replace(original,'IF p_record_sale AND coalesce(jsonb_array_length',
  E'IF NOT p_record_sale AND private.has_primary_policy(p_client) THEN\n    RAISE EXCEPTION ''Every new policy requires a sale'' USING ERRCODE=''22023'';\n  END IF;\n  IF p_record_sale AND coalesce(jsonb_array_length');
END $patch$;
