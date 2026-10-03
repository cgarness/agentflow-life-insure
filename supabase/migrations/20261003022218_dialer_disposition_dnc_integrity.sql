-- Permanent disposition/DNC invariant. NOT APPLIED. No historical data repair.
-- Production queue provenance (20261002184930/954) is a prerequisite.
DO $preflight$
BEGIN
  IF (SELECT md5(pg_get_functiondef(to_regprocedure('public.advance_campaign_lead(uuid,uuid,uuid,timestamptz,text,boolean)')))) IS DISTINCT FROM 'b857ea1abdf075d361f68656bba31a24' THEN
    RAISE EXCEPTION 'DNC migration precondition: advance_campaign_lead drift';
  END IF;
  IF (SELECT md5(pg_get_functiondef(to_regprocedure('public.get_next_queue_lead(uuid,jsonb)')))) IS DISTINCT FROM '8bc7ec6830c9b3374c6b7bea1fd1a38e' THEN
    RAISE EXCEPTION 'DNC migration precondition: get_next_queue_lead drift';
  END IF;
  IF (SELECT md5(pg_get_functiondef(to_regprocedure('public.get_queue_metrics(uuid)')))) IS DISTINCT FROM '7a9aedc3802d550709bdbf1004b1ee50' THEN
    RAISE EXCEPTION 'DNC migration precondition: get_queue_metrics drift';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='dialer_lead_locks' AND column_name='queue_issued_at') THEN
    RAISE EXCEPTION 'DNC migration requires queue provenance';
  END IF;
END;
$preflight$;

-- Country-qualified keys use the existing immutable project normalizer. An expression
-- index, rather than a unique index, preserves pre-existing canonical duplicates.
CREATE INDEX dnc_list_org_canonical_phone_idx
  ON public.dnc_list (organization_id, private.phone_digits_e164ish(phone_number));
GRANT EXECUTE ON FUNCTION private.phone_digits_e164ish(text) TO authenticated, service_role;
REVOKE TRUNCATE ON public.dnc_list FROM anon, authenticated;

CREATE FUNCTION private.dnc_phone_lock_key(p_org uuid, p_phone text) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT hashtextextended(p_org::text || ':' || private.phone_digits_e164ish(p_phone), 918273);
$$;
CREATE FUNCTION private.is_dnc_phone(p_org uuid, p_phone text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.dnc_list d
    WHERE d.organization_id = p_org
      AND private.phone_digits_e164ish(d.phone_number) = private.phone_digits_e164ish(p_phone));
$$;

CREATE FUNCTION private.guard_dnc_phone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_phone text; a record;
BEGIN
  -- BEFORE triggers run before WITH CHECK. Validate tenant authority before even
  -- checking another row, so duplicate errors cannot probe a different tenant.
  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO a FROM private.campaign_actor();
    IF NEW.organization_id IS DISTINCT FROM a.org_id THEN
      RAISE EXCEPTION 'DNC organization mismatch' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.organization_id, NEW.phone_number)
      IS NOT DISTINCT FROM (OLD.organization_id, OLD.phone_number) THEN RETURN NEW; END IF;
  v_phone := '+' || private.phone_digits_e164ish(NEW.phone_number);
  IF NEW.organization_id IS NULL OR v_phone IS NULL OR v_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'DNC requires an organization and valid phone' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(private.dnc_phone_lock_key(NEW.organization_id, v_phone));
  IF EXISTS (SELECT 1 FROM public.dnc_list d WHERE d.organization_id=NEW.organization_id
      AND private.phone_digits_e164ish(d.phone_number)=private.phone_digits_e164ish(v_phone) AND d.id<>NEW.id) THEN
    RAISE EXCEPTION 'Phone already suppressed in this organization' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dnc_phone_identity_guard BEFORE INSERT OR UPDATE ON public.dnc_list
FOR EACH ROW EXECUTE FUNCTION private.guard_dnc_phone();

-- Not exposed to the API: no browser can manufacture a successful receipt/admission.
CREATE TABLE private.dialer_disposition_receipts (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  operation_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  campaign_lead_id uuid,
  call_id uuid,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, operation_id)
);
CREATE UNIQUE INDEX dialer_disposition_call_once ON private.dialer_disposition_receipts
  (organization_id, call_id) WHERE call_id IS NOT NULL;
ALTER TABLE private.dialer_disposition_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.dialer_disposition_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.dialer_outbound_admissions (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  call_id uuid NOT NULL,
  parent_sid text NOT NULL,
  destination text NOT NULL,
  admitted boolean NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, call_id),
  UNIQUE (parent_sid)
);
ALTER TABLE private.dialer_outbound_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.dialer_outbound_admissions FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.campaign_leads ADD COLUMN disposition_version bigint NOT NULL DEFAULT 0;
ALTER TABLE public.calls ADD COLUMN dialer_admission_required boolean NOT NULL DEFAULT false;
-- Capture original identity only on FUTURE conversions; never infer lineage from
-- matching phone numbers or repair existing historical rows.
CREATE TABLE private.dialer_conversion_lineage (
  organization_id uuid NOT NULL,
  campaign_lead_id uuid NOT NULL,
  original_lead_id uuid NOT NULL,
  PRIMARY KEY (organization_id,campaign_lead_id)
);
ALTER TABLE private.dialer_conversion_lineage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.dialer_conversion_lineage FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.capture_dialer_conversion_lineage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF OLD.lead_id IS NOT NULL AND NEW.lead_id IS NULL AND OLD.organization_id IS NOT NULL THEN
    INSERT INTO private.dialer_conversion_lineage(organization_id,campaign_lead_id,original_lead_id)
      VALUES(OLD.organization_id,OLD.id,OLD.lead_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_leads_capture_conversion_lineage BEFORE UPDATE OF lead_id ON public.campaign_leads
FOR EACH ROW EXECUTE FUNCTION private.capture_dialer_conversion_lineage();


-- Drop the legacy signature to avoid ambiguous PostgREST overload selection. Old
-- tabs lacking operation/version inputs fail closed with a reload instruction.
DROP FUNCTION public.advance_campaign_lead(uuid,uuid,uuid,timestamptz,text,boolean);
CREATE FUNCTION public.advance_campaign_lead(
  p_campaign_lead_id uuid,
  p_call_id uuid DEFAULT NULL,
  p_disposition_id uuid DEFAULT NULL,
  p_callback_due_at timestamptz DEFAULT NULL,
  p_callback_note text DEFAULT NULL,
  p_release_lock boolean DEFAULT true,
  p_operation_id uuid DEFAULT NULL,
  p_notes text DEFAULT '',
  p_converted_client_id uuid DEFAULT NULL,
  p_expected_version bigint DEFAULT NULL,
  p_action text DEFAULT 'disposition'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  cl public.campaign_leads;
  c public.campaigns;
  ca public.calls;
  d public.dispositions;
  ps public.pipeline_stages;
  receipt private.dialer_disposition_receipts;
  v_payload jsonb;
  v_result jsonb;
  v_phone text;
  v_contact uuid;
  v_contact_type text := 'lead';
  v_retry integer;
  v_attempt boolean := false;
  v_status text;
  v_shared boolean := false;
  v_release boolean := false;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Reload the dialer before saving this disposition' USING ERRCODE='22023';
  END IF;
  IF p_action NOT IN ('disposition','skip') OR p_action IS NULL THEN
    RAISE EXCEPTION 'Invalid disposition action' USING ERRCODE='22023';
  END IF;
  IF p_campaign_lead_id IS NULL AND p_call_id IS NULL THEN
    RAISE EXCEPTION 'A call or campaign membership is required' USING ERRCODE='22023';
  END IF;
  -- Serialize duplicate operation ids even across different memberships.
  PERFORM pg_advisory_xact_lock(hashtextextended(a.org_id::text || ':' || p_operation_id::text, 28391));
  IF p_campaign_lead_id IS NOT NULL THEN
    SELECT * INTO cl FROM public.campaign_leads
      WHERE id=p_campaign_lead_id AND organization_id=a.org_id FOR UPDATE;
    IF NOT FOUND OR public.can_dial_campaign(cl.campaign_id) IS NOT TRUE THEN
      RAISE EXCEPTION 'Campaign disposition not permitted' USING ERRCODE='42501';
    END IF;
    SELECT * INTO c FROM public.campaigns WHERE id=cl.campaign_id AND organization_id=a.org_id;
    v_shared := upper(btrim(c.type)) IN ('TEAM','OPEN','OPEN POOL');
    v_contact := cl.lead_id;
    v_phone := '+' || private.phone_digits_e164ish(cl.phone);
  END IF;
  IF p_call_id IS NOT NULL THEN
    SELECT * INTO ca FROM public.calls WHERE id=p_call_id AND organization_id=a.org_id FOR UPDATE;
    IF NOT FOUND OR ca.agent_id IS DISTINCT FROM a.uid
       OR ca.campaign_lead_id IS DISTINCT FROM p_campaign_lead_id
       OR (p_campaign_lead_id IS NOT NULL AND ca.campaign_id IS DISTINCT FROM cl.campaign_id) THEN
      RAISE EXCEPTION 'Call disposition not permitted' USING ERRCODE='42501';
    END IF;
    IF ca.direction='outbound' AND ca.dialer_admission_required AND NOT EXISTS (SELECT 1 FROM private.dialer_outbound_admissions x
        WHERE x.organization_id=a.org_id AND x.call_id=ca.id AND x.admitted) THEN
      RAISE EXCEPTION 'Outbound admission was not verified; no attempt to disposition' USING ERRCODE='22023';
    END IF;
    IF ca.direction='outbound' AND EXISTS (SELECT 1 FROM private.dialer_outbound_admissions x
        WHERE x.organization_id=a.org_id AND x.call_id=ca.id AND NOT x.admitted) THEN
      RAISE EXCEPTION 'Outbound call was not admitted; no attempt to disposition' USING ERRCODE='22023';
    END IF;
    v_contact := ca.contact_id;
    v_contact_type := COALESCE(ca.contact_type,'lead');
    v_phone := COALESCE('+' || private.phone_digits_e164ish(ca.contact_phone),v_phone);
    v_attempt := ca.direction='outbound';
  END IF;
  v_payload := jsonb_build_object('campaign_lead_id',p_campaign_lead_id,'call_id',p_call_id,
    'disposition_id',p_disposition_id,'callback_due_at',p_callback_due_at,
    'callback_note',NULLIF(btrim(p_callback_note),''),'notes',COALESCE(p_notes,''),
    'converted_client_id',p_converted_client_id,'action',p_action);
  SELECT * INTO receipt FROM private.dialer_disposition_receipts
    WHERE organization_id=a.org_id AND (operation_id=p_operation_id OR (p_call_id IS NOT NULL AND call_id=p_call_id))
    ORDER BY (operation_id=p_operation_id) DESC LIMIT 1;
  IF FOUND THEN
    IF receipt.agent_id<>a.uid OR receipt.payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION 'Disposition already saved with different data' USING ERRCODE='22023';
    END IF;
    IF p_campaign_lead_id IS NOT NULL AND cl.disposition_version IS DISTINCT FROM (receipt.result->>'disposition_version')::bigint THEN
      RAISE EXCEPTION 'This visit is stale; reload the queue' USING ERRCODE='40001';
    END IF;
    IF p_release_lock AND v_shared THEN
      IF EXISTS (SELECT 1 FROM public.dialer_lead_locks WHERE campaign_lead_id=cl.id
          AND organization_id=a.org_id AND locked_by<>a.uid AND expires_at>now()) THEN
        RAISE EXCEPTION 'Lead lock belongs to another agent' USING ERRCODE='42501';
      END IF;
      DELETE FROM public.dialer_lead_locks WHERE campaign_lead_id=cl.id
        AND organization_id=a.org_id AND locked_by=a.uid;
      IF EXISTS (SELECT 1 FROM public.dialer_lead_locks WHERE campaign_lead_id=cl.id
          AND organization_id=a.org_id AND locked_by=a.uid) THEN
        RAISE EXCEPTION 'Lock release failed' USING ERRCODE='40001';
      END IF;
    END IF;
    RETURN receipt.result || jsonb_build_object('replayed',true,'lock_released',p_release_lock OR NOT v_shared,
      'dnc_suppressed',private.is_dnc_phone(a.org_id,v_phone));
  END IF;
  IF p_campaign_lead_id IS NOT NULL THEN
    IF p_expected_version IS DISTINCT FROM cl.disposition_version THEN
      RAISE EXCEPTION 'This visit is stale; reload the queue' USING ERRCODE='40001';
    END IF;
    IF v_shared AND NOT EXISTS (SELECT 1 FROM public.dialer_lead_locks
        WHERE campaign_lead_id=cl.id AND organization_id=a.org_id AND campaign_id=c.id
        AND locked_by=a.uid AND expires_at>now() AND queue_issued_at IS NOT NULL) THEN
      RAISE EXCEPTION 'A current queue-issued lock is required' USING ERRCODE='42501';
    END IF;
    IF cl.status IN ('DNC','Completed','Removed','Failed','removed','Closed Won') THEN
      RAISE EXCEPTION 'Campaign membership is already terminal' USING ERRCODE='22023';
    END IF;
  END IF;
  IF p_action='skip' THEN
    IF p_call_id IS NOT NULL OR v_shared OR p_disposition_id IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid Personal skip' USING ERRCODE='22023';
    END IF;
    v_status := 'Skipped';
  ELSE
    SELECT * INTO d FROM public.dispositions WHERE id=p_disposition_id AND organization_id=a.org_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Disposition not found' USING ERRCODE='22023'; END IF;
    IF (d.require_notes OR COALESCE(d.min_note_chars,0)>0)
        AND length(btrim(COALESCE(p_notes,'')))<greatest(COALESCE(d.min_note_chars,0),1) THEN
      RAISE EXCEPTION 'Required disposition notes are missing' USING ERRCODE='22023';
    END IF;
    SELECT * INTO ps FROM public.pipeline_stages WHERE id=d.pipeline_stage_id AND organization_id=a.org_id;
    IF d.pipeline_stage_id IS NOT NULL AND NOT FOUND THEN
      RAISE EXCEPTION 'Disposition pipeline stage is invalid' USING ERRCODE='22023';
    END IF;
    IF COALESCE(ps.convert_to_client,false) THEN
      IF p_converted_client_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients x
          WHERE x.id=p_converted_client_id AND x.organization_id=a.org_id
          AND (x.id=ca.contact_id AND ca.contact_type='client'
            OR x.lead_id=cl.lead_id OR EXISTS (SELECT 1 FROM private.dialer_conversion_lineage lin
              WHERE lin.organization_id=a.org_id AND lin.campaign_lead_id=cl.id AND lin.original_lead_id=x.lead_id))) THEN
        RAISE EXCEPTION 'Complete lead conversion before disposition' USING ERRCODE='22023';
      END IF;
      v_contact := p_converted_client_id; v_contact_type := 'client';
    ELSIF p_converted_client_id IS NOT NULL THEN
      RAISE EXCEPTION 'Unexpected converted contact' USING ERRCODE='22023';
    END IF;
    IF d.callback_scheduler AND p_campaign_lead_id IS NOT NULL AND p_callback_due_at IS NULL THEN
      RAISE EXCEPTION 'Callback time is required' USING ERRCODE='22023';
    END IF;
    IF d.dnc_auto_add THEN
      IF v_phone IS NULL OR v_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
        RAISE EXCEPTION 'Cannot suppress an invalid phone' USING ERRCODE='22023';
      END IF;
      PERFORM pg_advisory_xact_lock(private.dnc_phone_lock_key(a.org_id,v_phone));
      IF NOT private.is_dnc_phone(a.org_id,v_phone) THEN
        INSERT INTO public.dnc_list (organization_id,phone_number,reason,added_by)
          VALUES (a.org_id,v_phone,d.name,a.uid);
      END IF;
    END IF;
    v_status := CASE WHEN d.dnc_auto_add THEN 'DNC'
      WHEN COALESCE(ps.convert_to_client,false) OR d.campaign_action='remove_from_queue' THEN 'Completed'
      WHEN d.campaign_action='remove_from_campaign' THEN 'Removed' ELSE 'Called' END;
    IF p_call_id IS NOT NULL THEN
      UPDATE public.calls SET disposition_id=d.id,disposition_name=d.name,notes=COALESCE(p_notes,''),
        contact_id=v_contact,contact_type=v_contact_type,updated_at=now()
        WHERE id=ca.id AND organization_id=a.org_id;
      -- No status, ended_at or duration writes: lifecycle remains provider-owned.
    END IF;
    IF v_contact IS NOT NULL THEN
      IF ps.id IS NOT NULL AND NOT COALESCE(ps.convert_to_client,false) AND v_contact_type='lead' THEN
        UPDATE public.leads SET status=ps.name,updated_at=now() WHERE id=v_contact AND organization_id=a.org_id;
        INSERT INTO public.contact_activities (contact_id,contact_type,agent_id,activity_type,description,organization_id)
          VALUES(v_contact,v_contact_type,a.uid,'pipeline','Pipeline stage → '||ps.name,a.org_id);
      END IF;
      INSERT INTO public.contact_activities(contact_id,contact_type,agent_id,activity_type,description,organization_id,metadata)
        VALUES(v_contact,v_contact_type,a.uid,CASE WHEN p_call_id IS NULL THEN 'status' ELSE 'call' END,
          'Disposition — '||d.name,a.org_id,jsonb_build_object('call_id',p_call_id,'campaign_lead_id',p_campaign_lead_id,'operation_id',p_operation_id));
      IF NULLIF(btrim(p_notes),'') IS NOT NULL THEN
        INSERT INTO public.contact_activities(contact_id,contact_type,agent_id,activity_type,description,organization_id)
          VALUES(v_contact,v_contact_type,a.uid,'note',p_notes,a.org_id);
      END IF;
      BEGIN
        PERFORM public.workflow_dispatch_event(a.org_id,'disposition',d.id::text,v_contact,v_contact_type,
          jsonb_build_object('disposition_id',d.id,'call_id',p_call_id));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Disposition automation failed; core save retained';
      END;
    END IF;
    -- Same configured hard-claim rule, using Twilio's stored duration.
    IF v_shared AND cl.lead_id IS NOT NULL AND NOT d.dnc_auto_add
       AND lower(btrim(d.name))<>'no answer'
       AND (COALESCE(ca.duration,0)>45 OR d.counts_as_contacted OR d.callback_scheduler) THEN
      UPDATE public.leads SET assigned_agent_id=a.uid WHERE id=cl.lead_id AND organization_id=a.org_id
        AND (assigned_agent_id IS NULL OR assigned_agent_id=a.uid);
      IF NOT FOUND THEN RAISE EXCEPTION 'Lead ownership changed' USING ERRCODE='40001'; END IF;
    END IF;
  END IF;
  IF p_campaign_lead_id IS NOT NULL THEN
    v_retry := COALESCE(NULLIF(c.retry_interval_minutes,0),NULLIF(c.retry_interval_hours,0)*60,1440);
    IF v_retry<=0 THEN v_retry:=1440; END IF;
    UPDATE public.campaign_leads SET
      call_attempts=COALESCE(cl.call_attempts,0)+CASE WHEN v_attempt THEN 1 ELSE 0 END,
      last_called_at=CASE WHEN v_attempt THEN now() ELSE cl.last_called_at END,
      last_advance_call_id=CASE WHEN v_attempt THEN p_call_id ELSE cl.last_advance_call_id END,
      disposition=CASE WHEN p_action='disposition' THEN d.name ELSE cl.disposition END,
      status=CASE WHEN v_status='Called' AND NOT (d.callback_scheduler OR d.appointment_scheduler)
        AND c.max_attempts IS NOT NULL AND COALESCE(cl.call_attempts,0)+CASE WHEN v_attempt THEN 1 ELSE 0 END >= c.max_attempts
        THEN 'Completed' ELSE v_status END,
      retry_eligible_at=CASE WHEN v_status IN ('Called','Skipped') AND NOT COALESCE(d.callback_scheduler OR d.appointment_scheduler,false)
        THEN now()+make_interval(mins=>v_retry) ELSE NULL END,
      callback_due_at=CASE WHEN d.callback_scheduler THEN p_callback_due_at END,
      scheduled_callback_at=CASE WHEN d.callback_scheduler THEN p_callback_due_at END,
      callback_agent_id=CASE WHEN d.callback_scheduler THEN a.uid END,
      callback_note=CASE WHEN d.callback_scheduler THEN NULLIF(btrim(p_callback_note),'') END,
      disposition_version=cl.disposition_version+1,updated_at=now()
      WHERE id=cl.id AND organization_id=a.org_id RETURNING * INTO cl;
    IF p_release_lock THEN
      DELETE FROM public.dialer_lead_locks WHERE campaign_lead_id=cl.id AND organization_id=a.org_id AND locked_by=a.uid;
      IF v_shared AND NOT FOUND THEN RAISE EXCEPTION 'Lock release failed' USING ERRCODE='40001'; END IF;
    END IF;
  END IF;
  v_result := COALESCE(to_jsonb(cl),'{}'::jsonb) || jsonb_build_object('call_id',p_call_id,
    'contact_id',v_contact,'contact_type',v_contact_type,'dnc_suppressed',private.is_dnc_phone(a.org_id,v_phone),
    'claimed_lead_id',CASE WHEN v_shared AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id=cl.lead_id
      AND l.organization_id=a.org_id AND l.assigned_agent_id=a.uid) THEN cl.lead_id ELSE NULL END,
    'lock_released',p_release_lock OR NOT v_shared,'replayed',false);
  INSERT INTO private.dialer_disposition_receipts(organization_id,operation_id,agent_id,campaign_lead_id,call_id,payload,result)
    VALUES(a.org_id,p_operation_id,a.uid,p_campaign_lead_id,p_call_id,v_payload,v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION private.try_queue_phone(p_org uuid,p_phone text,p_master_phone text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p text;
BEGIN
  IF private.phone_digits_e164ish(p_phone) IS NULL OR private.phone_digits_e164ish(p_phone) !~ '^[1-9][0-9]{6,14}$' THEN RETURN false; END IF;
  FOR p IN SELECT DISTINCT '+' || private.phone_digits_e164ish(x) FROM unnest(ARRAY[p_phone,p_master_phone]) x
    WHERE private.phone_digits_e164ish(x) ~ '^[1-9][0-9]{6,14}$' ORDER BY 1 LOOP
    IF NOT pg_try_advisory_xact_lock(private.dnc_phone_lock_key(p_org,p)) THEN RETURN false; END IF;
    -- VOLATILE function, fresh command snapshot AFTER obtaining the phone lock.
    IF private.is_dnc_phone(p_org,p) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_next_queue_lead(p_campaign_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS SETOF public.campaign_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_org            uuid;
  v_actor record;
  v_skipped uuid[] := ARRAY[]::uuid[];
  v_phone text;
  v_master_phone text;
  v_uid            uuid := auth.uid();
  v_campaign       RECORD;
  v_ctype          text;
  v_locked_id      uuid;
  v_result         public.campaign_leads;
  v_claimed_id     uuid;
  v_retry_minutes  integer;
  v_filter_state   text;
  v_filter_source  text;
  v_filter_status  text;
  v_filter_max_att integer;
  v_require_licensed boolean := false;
  v_licensed_states  text[]  := '{}';
BEGIN
  SELECT * INTO v_actor FROM private.campaign_actor();
  v_org := v_actor.org_id;
  IF public.can_dial_campaign(p_campaign_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Campaign queue not permitted' USING ERRCODE='42501';
  END IF;
  DELETE FROM public.dialer_lead_locks
  WHERE campaign_id = p_campaign_id
    AND organization_id = v_org
    AND expires_at <= now();

  SELECT c.id,
         upper(trim(c.type)) AS ctype,
         c.assigned_agent_ids,
         c.organization_id,
         c.max_attempts,
         c.require_licensed_state_access,
         COALESCE(NULLIF(c.retry_interval_minutes, 0), NULLIF(c.retry_interval_hours, 0) * 60, 1440) AS retry_minutes
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id
    AND c.organization_id = v_org;

  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_ctype := v_campaign.ctype;
  IF v_ctype NOT IN ('TEAM','OPEN','OPEN POOL') THEN
    RAISE EXCEPTION 'Use Personal queue for this campaign' USING ERRCODE='42501';
  END IF;
  v_retry_minutes := CASE WHEN v_campaign.retry_minutes > 0 THEN v_campaign.retry_minutes ELSE 1440 END;

  IF v_ctype = 'TEAM' THEN
    IF NOT (
      v_uid::text = ANY (
        ARRAY(SELECT jsonb_array_elements_text(v_campaign.assigned_agent_ids))
      )
    ) THEN
      RETURN;
    END IF;
  END IF;

  v_require_licensed := COALESCE(v_campaign.require_licensed_state_access, false);
  IF v_require_licensed THEN
    SELECT COALESCE(array_agg(DISTINCT x.s), '{}')
    INTO v_licensed_states
    FROM (
      SELECT upper(public.normalize_us_state(asl.state)) AS s
      FROM public.agent_state_licenses asl
      WHERE asl.agent_id = v_uid
        AND asl.organization_id = v_org
    ) x
    WHERE x.s ~ '^[A-Z]{2}$';
  END IF;

  v_filter_state   := NULLIF(p_filters->>'state', '');
  v_filter_source  := NULLIF(p_filters->>'lead_source', '');
  v_filter_status  := NULLIF(p_filters->>'status', '');
  v_filter_max_att := NULLIF(p_filters->>'max_attempts', '')::integer;

  LOOP
  SELECT cl.id, cl.phone, l.phone
  INTO v_locked_id, v_phone, v_master_phone
  FROM public.campaign_leads cl
  JOIN public.leads l ON l.id = cl.lead_id AND l.organization_id = v_org
  WHERE cl.campaign_id = p_campaign_id
    AND cl.organization_id = v_org
    AND NOT (cl.id = ANY(v_skipped))
    AND NOT private.is_dnc_phone(v_org,cl.phone)
    AND NOT private.is_dnc_phone(v_org,l.phone)
    AND (COALESCE(cl.callback_due_at,cl.scheduled_callback_at) IS NULL
         OR COALESCE(cl.callback_due_at,cl.scheduled_callback_at) <= now()+interval '5 minutes')
    AND cl.status NOT IN ('DNC', 'Completed', 'Removed', 'Failed', 'removed', 'Closed Won')
    AND (v_campaign.max_attempts IS NULL
         OR COALESCE(cl.call_attempts, 0) < v_campaign.max_attempts)
    AND (cl.retry_eligible_at IS NULL OR cl.retry_eligible_at <= now())
    -- Calls exist before the browser saves a disposition. Enforce the retry
    -- globally from the canonical call record, even when advancement failed.
    AND (
      (cl.callback_agent_id = v_uid
       AND COALESCE(cl.callback_due_at, cl.scheduled_callback_at) <= now() + interval '5 minutes')
      OR NOT EXISTS (
      SELECT 1 FROM public.calls recent
      WHERE recent.campaign_lead_id = cl.id
        AND recent.campaign_id = p_campaign_id
        AND recent.direction = 'outbound'
        AND recent.organization_id = v_org
        AND NOT EXISTS (SELECT 1 FROM private.dialer_outbound_admissions da WHERE da.organization_id=v_org AND da.call_id=recent.id AND NOT da.admitted)
        AND (
          (recent.ended_at IS NOT NULL OR recent.status IN ('completed', 'no-answer', 'busy', 'failed', 'canceled'))
          AND COALESCE(recent.ended_at, recent.started_at) + make_interval(mins => v_retry_minutes) > now()
          OR
          (recent.ended_at IS NULL AND recent.status NOT IN ('completed', 'no-answer', 'busy', 'failed', 'canceled')
           AND recent.started_at > now() - interval '30 minutes')
        )
      )
    )
    AND (cl.callback_agent_id IS NULL OR cl.callback_agent_id = v_uid)
    AND (l.assigned_agent_id IS NULL OR l.assigned_agent_id = v_uid)
    AND NOT EXISTS (
      SELECT 1 FROM public.dialer_lead_locks dll
      WHERE dll.campaign_lead_id = cl.id
        AND dll.expires_at > now()
        AND dll.locked_by <> v_uid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_lead_agent_suppressions s
      WHERE s.campaign_lead_id = cl.id
        AND s.agent_id = v_uid
        AND s.suppressed_until > now()
    )
    AND (v_filter_status IS NULL OR cl.status = v_filter_status)
    AND (v_filter_state  IS NULL
         OR cl.state = v_filter_state
         OR (cl.state IS NULL AND l.state = v_filter_state))
    AND (v_filter_source IS NULL OR l.lead_source = v_filter_source)
    AND (v_filter_max_att IS NULL OR COALESCE(cl.call_attempts, 0) <= v_filter_max_att)
    AND (
      NOT v_require_licensed
      OR NULLIF(btrim(public.normalize_us_state(cl.state)), '') IS NULL
      OR upper(public.normalize_us_state(cl.state)) = ANY (v_licensed_states)
    )
  ORDER BY
    CASE
      WHEN COALESCE(cl.callback_due_at, cl.scheduled_callback_at) IS NOT NULL
           AND cl.callback_agent_id = v_uid
           AND COALESCE(cl.callback_due_at, cl.scheduled_callback_at) <= now() + interval '5 minutes'
        THEN 0
      WHEN COALESCE(cl.call_attempts, 0) = 0 THEN 1
      ELSE 2
    END,
    COALESCE(cl.callback_due_at, cl.scheduled_callback_at) ASC NULLS LAST,
    cl.last_called_at ASC NULLS FIRST,
    cl.created_at ASC, cl.id ASC
  LIMIT 1
  FOR UPDATE OF cl SKIP LOCKED;

  IF v_locked_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT private.try_queue_phone(v_org,v_phone,v_master_phone) THEN
    v_skipped := array_append(v_skipped,v_locked_id);
    CONTINUE;
  END IF;
  INSERT INTO public.dialer_lead_locks
    (campaign_lead_id, locked_by, campaign_id, organization_id, expires_at, queue_issued_at)
  VALUES
    (v_locked_id, v_uid, p_campaign_id, v_org, now() + interval '5 minutes', now())
  ON CONFLICT (campaign_lead_id) DO UPDATE
    SET expires_at = EXCLUDED.expires_at,
        queue_issued_at = EXCLUDED.queue_issued_at
    WHERE dialer_lead_locks.locked_by = EXCLUDED.locked_by
      AND dialer_lead_locks.expires_at > now()
  RETURNING campaign_lead_id INTO v_claimed_id;

  -- A conflict owned by another agent returns no row. Never hand out that lead.
  IF v_claimed_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_result FROM public.campaign_leads WHERE id = v_locked_id;
  RETURN NEXT v_result;
  RETURN;
  END LOOP;
END;
$function$
;

CREATE FUNCTION public.get_personal_queue_leads(p_campaign_id uuid,p_limit integer DEFAULT 100,p_offset integer DEFAULT 0)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record; c public.campaigns;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  SELECT * INTO c FROM public.campaigns WHERE id=p_campaign_id AND organization_id=a.org_id;
  IF NOT FOUND OR upper(btrim(c.type))<>'PERSONAL' OR c.user_id IS DISTINCT FROM a.uid THEN
    RAISE EXCEPTION 'Personal queue not permitted' USING ERRCODE='42501';
  END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 OR p_offset IS NULL OR p_offset<0 THEN
    RAISE EXCEPTION 'Invalid queue page' USING ERRCODE='22023';
  END IF;
  -- Return membership fields only. Master details are enriched through caller RLS.
  RETURN QUERY SELECT to_jsonb(cl)
  FROM public.campaign_leads cl JOIN public.leads l ON l.id=cl.lead_id AND l.organization_id=a.org_id
  WHERE cl.organization_id=a.org_id AND cl.campaign_id=c.id
    AND (a.is_super OR a.actor_role IN ('Admin','Team Leader','Team Lead') OR cl.user_id=a.uid OR cl.claimed_by=a.uid)
    AND cl.status NOT IN ('DNC','Completed','Removed','Failed','removed','Closed Won')
    AND NOT private.is_dnc_phone(a.org_id,cl.phone) AND NOT private.is_dnc_phone(a.org_id,l.phone)
    AND private.phone_digits_e164ish(cl.phone) ~ '^[1-9][0-9]{6,14}$'
    AND (c.max_attempts IS NULL OR COALESCE(cl.call_attempts,0)<c.max_attempts)
    AND (cl.retry_eligible_at IS NULL OR cl.retry_eligible_at<=now())
    AND (cl.callback_agent_id IS NULL OR cl.callback_agent_id=a.uid)
    AND (COALESCE(cl.callback_due_at,cl.scheduled_callback_at) IS NULL
         OR COALESCE(cl.callback_due_at,cl.scheduled_callback_at)<=now()+interval '5 minutes')
    AND ((cl.callback_agent_id=a.uid AND COALESCE(cl.callback_due_at,cl.scheduled_callback_at)<=now()+interval '5 minutes')
      OR NOT EXISTS (SELECT 1 FROM public.calls recent WHERE recent.organization_id=a.org_id
        AND recent.campaign_lead_id=cl.id AND recent.campaign_id=c.id AND recent.direction='outbound'
        AND NOT EXISTS (SELECT 1 FROM private.dialer_outbound_admissions da WHERE da.organization_id=a.org_id AND da.call_id=recent.id AND NOT da.admitted)
        AND (((recent.ended_at IS NOT NULL OR recent.status IN ('completed','no-answer','busy','failed','canceled')) AND COALESCE(recent.ended_at,recent.started_at)+make_interval(mins=>greatest(COALESCE(NULLIF(c.retry_interval_minutes,0),NULLIF(c.retry_interval_hours,0)*60,1440),1))>now())
          OR (recent.ended_at IS NULL AND recent.status NOT IN ('completed','no-answer','busy','failed','canceled') AND recent.started_at>now()-interval '30 minutes'))))
  ORDER BY CASE WHEN cl.callback_agent_id=a.uid AND COALESCE(cl.callback_due_at,cl.scheduled_callback_at)<=now()+interval '5 minutes' THEN 0
    WHEN COALESCE(cl.call_attempts,0)=0 THEN 1 ELSE 2 END,
    COALESCE(cl.callback_due_at,cl.scheduled_callback_at) ASC NULLS LAST,cl.last_called_at ASC NULLS FIRST,cl.created_at,cl.id
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE FUNCTION public.check_dialer_dnc(p_phone text,p_campaign_lead_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record; cl public.campaign_leads; c public.campaigns; v_phone text; v_match jsonb;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  v_phone := private.phone_digits_e164ish(p_phone);
  IF v_phone IS NULL OR v_phone !~ '^[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'Invalid destination phone' USING ERRCODE='22023';
  END IF;
  IF p_campaign_lead_id IS NOT NULL THEN
    SELECT * INTO cl FROM public.campaign_leads WHERE id=p_campaign_lead_id AND organization_id=a.org_id;
    IF NOT FOUND OR public.can_dial_campaign(cl.campaign_id) IS NOT TRUE
       OR private.phone_digits_e164ish(cl.phone) IS DISTINCT FROM v_phone THEN
      RAISE EXCEPTION 'Campaign call not permitted' USING ERRCODE='42501';
    END IF;
    SELECT * INTO c FROM public.campaigns WHERE id=cl.campaign_id AND organization_id=a.org_id;
    IF cl.status IN ('DNC','Completed','Removed','Failed','removed','Closed Won') THEN
      RETURN jsonb_build_object('blocked',true,'match',NULL,'reason','Campaign lead is no longer dialable');
    END IF;
    IF upper(btrim(c.type)) IN ('TEAM','OPEN','OPEN POOL') AND NOT EXISTS (
        SELECT 1 FROM public.dialer_lead_locks WHERE campaign_lead_id=cl.id AND organization_id=a.org_id
          AND locked_by=a.uid AND expires_at>now() AND queue_issued_at IS NOT NULL) THEN
      RAISE EXCEPTION 'A current queue-issued lock is required' USING ERRCODE='42501';
    END IF;
  END IF;
  -- Fresh snapshot after serializing against a concurrent suppression commit.
  PERFORM pg_advisory_xact_lock(private.dnc_phone_lock_key(a.org_id,p_phone));
  SELECT jsonb_build_object('id',d.id,'phone_number',d.phone_number,'reason',d.reason) INTO v_match
    FROM public.dnc_list d WHERE d.organization_id=a.org_id
      AND private.phone_digits_e164ish(d.phone_number)=v_phone ORDER BY d.created_at,d.id LIMIT 1;
  RETURN jsonb_build_object('blocked',v_match IS NOT NULL,'match',v_match,'normalized_phone','+'||v_phone);
END;
$$;

-- Invoker trigger: current_user distinguishes browser DML from the narrowly
-- validated SECURITY DEFINER operation. No user-settable GUC can bypass it.
CREATE FUNCTION private.guard_dialer_core_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_check jsonb;
BEGIN
  IF current_user IN ('postgres','service_role') THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='calls' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.direction IS DISTINCT FROM 'outbound' THEN
        RAISE EXCEPTION 'Inbound calls are provider-owned' USING ERRCODE='42501';
      END IF;
      IF NEW.disposition_id IS NOT NULL OR NEW.disposition_name IS NOT NULL THEN
        RAISE EXCEPTION 'Use advance_campaign_lead to save dispositions' USING ERRCODE='42501';
      END IF;
      IF NEW.direction='outbound' THEN
        NEW.dialer_admission_required := true;
        IF NEW.agent_id IS DISTINCT FROM auth.uid() OR NEW.organization_id IS DISTINCT FROM public.get_org_id() THEN
          RAISE EXCEPTION 'Outbound actor mismatch' USING ERRCODE='42501';
        END IF;
        v_check := public.check_dialer_dnc(NEW.contact_phone,NEW.campaign_lead_id);
        IF (v_check->>'blocked')::boolean IS DISTINCT FROM false THEN
          RAISE EXCEPTION 'Phone cannot be dialed' USING ERRCODE='42501';
        END IF;
        IF NEW.campaign_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.campaign_leads cl
            WHERE cl.id=NEW.campaign_lead_id AND cl.campaign_id=NEW.campaign_id AND cl.organization_id=NEW.organization_id) THEN
          RAISE EXCEPTION 'Campaign call lineage mismatch' USING ERRCODE='42501';
        END IF;
        IF NEW.campaign_lead_id IS NOT NULL THEN
          -- Campaign membership, not a browser contact pointer, owns call lineage.
          SELECT cl.lead_id INTO NEW.contact_id FROM public.campaign_leads cl
            WHERE cl.id=NEW.campaign_lead_id AND cl.campaign_id=NEW.campaign_id
              AND cl.organization_id=NEW.organization_id;
          IF NOT FOUND THEN RAISE EXCEPTION 'Campaign call lineage mismatch' USING ERRCODE='42501'; END IF;
          NEW.contact_type := 'lead';
        ELSIF NEW.contact_id IS NOT NULL THEN
          -- This invoker trigger reads under the caller's existing contact RLS.
          -- No new contact visibility is granted by disposition persistence.
          IF (
            (COALESCE(NEW.contact_type,'lead')='lead' AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id=NEW.contact_id AND l.organization_id=NEW.organization_id))
            OR (NEW.contact_type='client' AND EXISTS (SELECT 1 FROM public.clients x WHERE x.id=NEW.contact_id AND x.organization_id=NEW.organization_id))
            OR (NEW.contact_type='recruit' AND EXISTS (SELECT 1 FROM public.recruits r WHERE r.id=NEW.contact_id AND r.organization_id=NEW.organization_id))
          ) IS NOT TRUE THEN RAISE EXCEPTION 'Call contact not permitted' USING ERRCODE='42501'; END IF;
        END IF;
      END IF;
    ELSIF (NEW.disposition_id,NEW.disposition_name,NEW.organization_id,NEW.agent_id,NEW.campaign_id,NEW.campaign_lead_id,NEW.contact_id,NEW.contact_type,NEW.contact_phone,NEW.direction,NEW.dialer_admission_required)
        IS DISTINCT FROM (OLD.disposition_id,OLD.disposition_name,OLD.organization_id,OLD.agent_id,OLD.campaign_id,OLD.campaign_lead_id,OLD.contact_id,OLD.contact_type,OLD.contact_phone,OLD.direction,OLD.dialer_admission_required) THEN
      RAISE EXCEPTION 'Use advance_campaign_lead to save dispositions' USING ERRCODE='42501';
    END IF;
  ELSE
    IF TG_OP='UPDATE' AND (NEW.organization_id,NEW.campaign_id,NEW.lead_id,NEW.user_id,NEW.claimed_by,NEW.claimed_at,
       NEW.status,NEW.call_attempts,NEW.last_called_at,NEW.retry_eligible_at,NEW.disposition,
       NEW.callback_due_at,NEW.scheduled_callback_at,NEW.callback_agent_id,NEW.callback_note,NEW.last_advance_call_id,NEW.disposition_version)
      IS DISTINCT FROM (OLD.organization_id,OLD.campaign_id,OLD.lead_id,OLD.user_id,OLD.claimed_by,OLD.claimed_at,
       OLD.status,OLD.call_attempts,OLD.last_called_at,OLD.retry_eligible_at,OLD.disposition,
       OLD.callback_due_at,OLD.scheduled_callback_at,OLD.callback_agent_id,OLD.callback_note,OLD.last_advance_call_id,OLD.disposition_version) THEN
      RAISE EXCEPTION 'Use advance_campaign_lead to advance the queue' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER calls_guard_dialer_core BEFORE INSERT OR UPDATE ON public.calls FOR EACH ROW EXECUTE FUNCTION private.guard_dialer_core_write();
CREATE TRIGGER campaign_leads_guard_dialer_core BEFORE UPDATE ON public.campaign_leads FOR EACH ROW EXECUTE FUNCTION private.guard_dialer_core_write();

-- Called only after Twilio HMAC validation. Browser OrgId is deliberately absent.
CREATE FUNCTION public.admit_twilio_outbound(p_call_id uuid,p_identity text,p_to text,p_caller_id text,p_parent_sid text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ca public.calls; p public.profiles; cl public.campaign_leads; c public.campaigns;
  prior private.dialer_outbound_admissions; v_phone text; v_allowed boolean := true; v_reason text;
BEGIN
  IF p_parent_sid IS NULL OR p_parent_sid !~ '^CA[0-9a-fA-F]{32}$' OR p_identity IS NULL THEN
    RAISE EXCEPTION 'Invalid Twilio admission identity' USING ERRCODE='42501';
  END IF;
  SELECT * INTO p FROM public.profiles WHERE twilio_client_identity=p_identity AND status='Active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Twilio actor not found' USING ERRCODE='42501'; END IF;
  SELECT * INTO ca FROM public.calls WHERE id=p_call_id AND organization_id=p.organization_id FOR UPDATE;
  v_phone := private.phone_digits_e164ish(p_to);
  IF NOT FOUND OR ca.agent_id IS DISTINCT FROM p.id OR ca.direction IS DISTINCT FROM 'outbound'
     OR v_phone IS NULL OR v_phone !~ '^[1-9][0-9]{6,14}$'
     OR private.phone_digits_e164ish(ca.contact_phone) IS DISTINCT FROM v_phone
     OR private.phone_digits_e164ish(ca.caller_id_used) IS DISTINCT FROM private.phone_digits_e164ish(p_caller_id)
     OR (ca.twilio_call_sid IS NOT NULL AND ca.twilio_call_sid<>p_parent_sid) THEN
    RAISE EXCEPTION 'Outbound call identity mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.phone_numbers n WHERE n.organization_id=p.organization_id
      AND private.phone_digits_e164ish(n.phone_number)=private.phone_digits_e164ish(p_caller_id)
      AND lower(n.status)='active' AND (COALESCE(n.assignment_type,'agency')='agency'
        OR (n.assignment_type='personal' AND n.assigned_to=p.id))) THEN
    RAISE EXCEPTION 'Outbound caller ID not permitted' USING ERRCODE='42501';
  END IF;
  IF ca.campaign_lead_id IS NOT NULL THEN
    SELECT * INTO cl FROM public.campaign_leads WHERE id=ca.campaign_lead_id AND campaign_id=ca.campaign_id AND organization_id=p.organization_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Outbound campaign mismatch' USING ERRCODE='42501'; END IF;
    SELECT * INTO c FROM public.campaigns WHERE id=ca.campaign_id AND organization_id=p.organization_id;
    IF NOT FOUND OR (upper(btrim(c.type)) IN ('OPEN','OPEN POOL')
        OR (upper(btrim(c.type))='PERSONAL' AND c.user_id=p.id)
        OR (upper(btrim(c.type))='TEAM' AND c.assigned_agent_ids ? p.id::text)) IS NOT TRUE THEN
      RAISE EXCEPTION 'Outbound campaign not permitted' USING ERRCODE='42501';
    END IF;
    IF cl.status IN ('DNC','Completed','Removed','Failed','removed','Closed Won') THEN v_allowed:=false;v_reason:='lead_not_dialable'; END IF;
    IF upper(btrim(c.type)) IN ('TEAM','OPEN','OPEN POOL') AND NOT EXISTS (SELECT 1 FROM public.dialer_lead_locks
        WHERE campaign_lead_id=cl.id AND organization_id=p.organization_id AND locked_by=p.id
          AND expires_at>now() AND queue_issued_at IS NOT NULL) THEN v_allowed:=false;v_reason:='lock_lost'; END IF;
  ELSIF ca.campaign_id IS NOT NULL THEN RAISE EXCEPTION 'Missing campaign lineage' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(private.dnc_phone_lock_key(p.organization_id,p_to));
  SELECT * INTO prior FROM private.dialer_outbound_admissions WHERE organization_id=p.organization_id AND call_id=ca.id;
  IF FOUND AND prior.parent_sid IS DISTINCT FROM p_parent_sid THEN
    RAISE EXCEPTION 'Call already admitted under another SID' USING ERRCODE='42501';
  END IF;
  -- Even a retried webhook must not re-authorize a number after DNC commits.
  IF private.is_dnc_phone(p.organization_id,p_to) THEN v_allowed:=false;v_reason:='dnc'; END IF;
  IF prior.call_id IS NOT NULL AND NOT prior.admitted THEN v_allowed:=false;v_reason:=prior.reason; END IF;
  INSERT INTO private.dialer_outbound_admissions(organization_id,call_id,parent_sid,destination,admitted,reason)
    VALUES(p.organization_id,ca.id,p_parent_sid,'+'||v_phone,v_allowed,v_reason)
    ON CONFLICT (organization_id,call_id) DO NOTHING;
  UPDATE public.calls SET twilio_call_sid=p_parent_sid,updated_at=now() WHERE id=ca.id AND organization_id=p.organization_id;
  RETURN jsonb_build_object('admitted',v_allowed,'reason',v_reason,'organization_id',p.organization_id);
END;
$$;

CREATE FUNCTION public.get_outbound_admission(p_call_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record; result jsonb;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF NOT EXISTS (SELECT 1 FROM public.calls WHERE id=p_call_id AND organization_id=a.org_id AND agent_id=a.uid) THEN
    RAISE EXCEPTION 'Call not permitted' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object('admitted',admitted,'reason',reason) INTO result
    FROM private.dialer_outbound_admissions WHERE call_id=p_call_id AND organization_id=a.org_id;
  IF result IS NULL AND EXISTS (SELECT 1 FROM public.calls WHERE id=p_call_id AND organization_id=a.org_id AND NOT dialer_admission_required) THEN
    RETURN jsonb_build_object('admitted',true,'reason','legacy_call');
  END IF;
  RETURN COALESCE(result,jsonb_build_object('admitted',NULL,'reason','unverified'));
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_lead(p_campaign_lead_id uuid,p_lead_id uuid,p_campaign_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record; cl public.campaign_leads;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF public.can_dial_campaign(p_campaign_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Campaign claim not permitted' USING ERRCODE='42501';
  END IF;
  SELECT * INTO cl FROM public.campaign_leads WHERE id=p_campaign_lead_id AND campaign_id=p_campaign_id
    AND organization_id=a.org_id AND lead_id=p_lead_id FOR UPDATE;
  IF NOT FOUND OR cl.status IN ('DNC','Completed','Removed','Failed','removed','Closed Won') OR private.is_dnc_phone(a.org_id,cl.phone)
    OR NOT EXISTS (SELECT 1 FROM public.dialer_lead_locks WHERE campaign_lead_id=cl.id AND organization_id=a.org_id
      AND locked_by=a.uid AND expires_at>now() AND queue_issued_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Current queue claim required' USING ERRCODE='42501';
  END IF;
  UPDATE public.leads SET assigned_agent_id=a.uid,updated_at=now() WHERE id=p_lead_id AND organization_id=a.org_id
    AND (assigned_agent_id IS NULL OR assigned_agent_id=a.uid);
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead ownership changed' USING ERRCODE='40001'; END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.release_lead_lock(p_campaign_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF NOT EXISTS (SELECT 1 FROM public.campaign_leads WHERE id=p_campaign_lead_id AND organization_id=a.org_id) THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.dialer_lead_locks WHERE campaign_lead_id=p_campaign_lead_id
      AND organization_id=a.org_id AND locked_by<>a.uid AND expires_at>now()) THEN
    RAISE EXCEPTION 'Lead lock belongs to another agent' USING ERRCODE='42501';
  END IF;
  DELETE FROM public.dialer_lead_locks WHERE campaign_lead_id=p_campaign_lead_id AND organization_id=a.org_id AND locked_by=a.uid;
  IF EXISTS (SELECT 1 FROM public.dialer_lead_locks WHERE campaign_lead_id=p_campaign_lead_id AND organization_id=a.org_id AND locked_by=a.uid) THEN
    RAISE EXCEPTION 'Lock release failed' USING ERRCODE='40001';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.release_all_agent_locks(p_campaign_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  DELETE FROM public.dialer_lead_locks WHERE campaign_id=p_campaign_id AND organization_id=a.org_id AND locked_by=a.uid;
END;
$$;
CREATE OR REPLACE FUNCTION public.renew_lead_lock(p_campaign_lead_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  UPDATE public.dialer_lead_locks SET expires_at=now()+interval '5 minutes'
    WHERE campaign_lead_id=p_campaign_lead_id AND organization_id=a.org_id AND locked_by=a.uid
      AND public.can_dial_campaign(campaign_id) IS TRUE;
  RETURN FOUND;
END;
$$;
CREATE FUNCTION public.force_release_campaign_lead_lock(p_campaign_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF a.actor_role NOT IN ('Admin','Super Admin') AND NOT a.is_super THEN
    RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';
  END IF;
  DELETE FROM public.dialer_lead_locks WHERE campaign_lead_id=p_campaign_lead_id AND organization_id=a.org_id;
  -- Never changes membership status or suppression/history.
END;
$$;

CREATE OR REPLACE FUNCTION public.get_queue_metrics(p_campaign_id uuid)
 RETURNS TABLE(total_leads integer, eligible_leads integer, locked_leads integer, active_agents integer, available_leads integer, suppressed_for_current_agent integer, retry_blocked_leads integer, callback_waiting_leads integer, next_eligible_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_org            uuid := public.get_org_id();
  v_uid            uuid := auth.uid();
  v_campaign       RECORD;
  v_ctype          text;
  a record;
  -- Manager queue_filters (same supported keys as get_next_queue_lead).
  v_filter_state   text;
  v_filter_source  text;
  v_filter_status  text;
  v_filter_max_att integer;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  IF public.can_dial_campaign(p_campaign_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Campaign metrics not permitted' USING ERRCODE='42501';
  END IF;
  -- Load campaign, org-scoped (incl. queue_filters so metrics match the claim path).
  SELECT c.id,
         upper(trim(c.type))    AS ctype,
         c.assigned_agent_ids,
         c.organization_id,
         c.max_attempts,
         c.require_licensed_state_access,
         greatest(COALESCE(NULLIF(c.retry_interval_minutes,0),NULLIF(c.retry_interval_hours,0)*60,1440),1) AS retry_minutes,
         c.queue_filters
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id
    AND c.organization_id = v_org;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0, 0, 0, 0, NULL::timestamptz;
    RETURN;
  END IF;
  v_ctype := v_campaign.ctype;

  -- Parse the stored manager filters (tolerant; absent/empty key = no filter).
  -- Mirrors get_next_queue_lead exactly. min_score/max_score are intentionally
  -- NOT applied here because the canonical claim RPC does not apply them either.
  v_filter_state   := NULLIF(v_campaign.queue_filters->>'state', '');
  v_filter_source  := NULLIF(v_campaign.queue_filters->>'lead_source', '');
  v_filter_status  := NULLIF(v_campaign.queue_filters->>'status', '');
  v_filter_max_att := NULLIF(v_campaign.queue_filters->>'max_attempts', '')::integer;

  -- TEAM eligibility gate: caller must be assigned. Return only the non-
  -- agent-specific total so the panel can still say "N total / 0 available".
  IF v_ctype = 'TEAM'
     AND NOT (
       v_uid::text = ANY (
         ARRAY(SELECT jsonb_array_elements_text(v_campaign.assigned_agent_ids))
       )
     ) THEN
    RETURN QUERY
      SELECT (SELECT count(*)::int
                FROM public.campaign_leads cl
               WHERE cl.campaign_id = p_campaign_id
                 AND cl.organization_id = v_org),
             0, 0, 0, 0, 0, 0, 0, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT cl.id, cl.phone, l.phone AS master_phone,
           cl.status,
           cl.call_attempts,
           cl.retry_eligible_at,
           cl.callback_agent_id,
           cl.callback_due_at,
           cl.scheduled_callback_at,
           cl.state           AS cl_state,
           l.state            AS lead_state,
           l.lead_source      AS lead_source,
           l.assigned_agent_id AS lead_assigned_agent_id
    FROM public.campaign_leads cl
    JOIN public.leads l ON l.id = cl.lead_id AND l.organization_id=v_org
    WHERE cl.campaign_id = p_campaign_id
      AND cl.organization_id = v_org
  ),
  locks AS (
    SELECT dll.campaign_lead_id, dll.locked_by, dll.expires_at
    FROM public.dialer_lead_locks dll
    WHERE dll.campaign_id = p_campaign_id
      AND dll.expires_at > now()
  ),
  supp AS (
    SELECT s.campaign_lead_id, s.suppressed_until
    FROM public.campaign_lead_agent_suppressions s
    WHERE s.campaign_id = p_campaign_id
      AND s.agent_id = v_uid
      AND s.suppressed_until > now()
  ),
  enriched AS (
    SELECT b.*,
      (b.status NOT IN ('DNC','Completed','Removed','Failed','removed','Closed Won')
        AND NOT private.is_dnc_phone(v_org,b.phone) AND NOT private.is_dnc_phone(v_org,b.master_phone)
        AND (NOT COALESCE(v_campaign.require_licensed_state_access,false)
          OR NULLIF(btrim(public.normalize_us_state(b.cl_state)), '') IS NULL
          OR EXISTS (SELECT 1 FROM public.agent_state_licenses asl WHERE asl.agent_id=v_uid AND asl.organization_id=v_org
            AND upper(public.normalize_us_state(asl.state))=upper(public.normalize_us_state(b.cl_state))))
        AND (v_campaign.max_attempts IS NULL
             OR COALESCE(b.call_attempts, 0) < v_campaign.max_attempts)
        -- manager queue_filters — same supported keys as get_next_queue_lead
        AND (v_filter_status IS NULL OR b.status = v_filter_status)
        AND (v_filter_state  IS NULL
             OR b.cl_state = v_filter_state
             OR (b.cl_state IS NULL AND b.lead_state = v_filter_state))
        AND (v_filter_source IS NULL OR b.lead_source = v_filter_source)
        AND (v_filter_max_att IS NULL
             OR COALESCE(b.call_attempts, 0) <= v_filter_max_att)
      )                                                            AS is_eligible_universe,
      (b.callback_agent_id IS NULL OR b.callback_agent_id = v_uid) AS callback_ok,
      (b.lead_assigned_agent_id IS NULL
        OR b.lead_assigned_agent_id = v_uid)                       AS lead_ok,
      EXISTS (SELECT 1 FROM locks lk
               WHERE lk.campaign_lead_id = b.id
                 AND lk.locked_by <> v_uid)                        AS locked_by_other,
      EXISTS (SELECT 1 FROM supp sp
               WHERE sp.campaign_lead_id = b.id)                   AS suppressed_me
    FROM base b
  )
  SELECT
    (SELECT count(*)::int FROM base)                                AS total_leads,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe)                                  AS eligible_leads,
    (SELECT count(*)::int FROM locks)                               AS locked_leads,
    (SELECT count(DISTINCT locked_by)::int FROM locks)             AS active_agents,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe
         AND callback_ok AND lead_ok
         AND NOT locked_by_other AND NOT suppressed_me
         AND (retry_eligible_at IS NULL OR retry_eligible_at <= now())
         AND (COALESCE(callback_due_at,scheduled_callback_at) IS NULL OR COALESCE(callback_due_at,scheduled_callback_at)<=now()+interval '5 minutes')
         AND ((callback_agent_id=v_uid AND COALESCE(callback_due_at,scheduled_callback_at)<=now()+interval '5 minutes')
           OR NOT EXISTS (SELECT 1 FROM public.calls recent WHERE recent.organization_id=v_org AND recent.campaign_id=p_campaign_id
             AND recent.campaign_lead_id=enriched.id AND recent.direction='outbound'
             AND NOT EXISTS (SELECT 1 FROM private.dialer_outbound_admissions da WHERE da.organization_id=v_org AND da.call_id=recent.id AND NOT da.admitted)
             AND (((recent.ended_at IS NOT NULL OR recent.status IN ('completed','no-answer','busy','failed','canceled')) AND COALESCE(recent.ended_at,recent.started_at)+make_interval(mins=>v_campaign.retry_minutes)>now())
               OR (recent.ended_at IS NULL AND recent.status NOT IN ('completed','no-answer','busy','failed','canceled') AND recent.started_at>now()-interval '30 minutes'))))
    )                                                              AS available_leads,
    (SELECT count(*)::int FROM supp)                               AS suppressed_for_current_agent,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe
         AND callback_ok AND lead_ok
         AND NOT locked_by_other AND NOT suppressed_me
         AND retry_eligible_at IS NOT NULL AND retry_eligible_at > now()
    )                                                              AS retry_blocked_leads,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe
         AND callback_agent_id = v_uid
         AND COALESCE(callback_due_at, scheduled_callback_at) IS NOT NULL
         AND COALESCE(callback_due_at, scheduled_callback_at) > now()
    )                                                              AS callback_waiting_leads,
    (SELECT min(t) FROM (
        SELECT retry_eligible_at AS t FROM enriched
          WHERE is_eligible_universe AND callback_ok AND lead_ok
            AND NOT locked_by_other AND NOT suppressed_me
            AND retry_eligible_at IS NOT NULL AND retry_eligible_at > now()
        UNION ALL
        SELECT COALESCE(callback_due_at, scheduled_callback_at) FROM enriched
          WHERE is_eligible_universe AND callback_agent_id = v_uid
            AND COALESCE(callback_due_at, scheduled_callback_at) > now()
        UNION ALL
        SELECT suppressed_until FROM supp
        UNION ALL
        SELECT lk.expires_at FROM locks lk
          JOIN enriched e ON e.id = lk.campaign_lead_id
          WHERE lk.locked_by <> v_uid
            AND e.is_eligible_universe AND e.callback_ok AND e.lead_ok
            AND NOT e.suppressed_me
            AND (e.retry_eligible_at IS NULL OR e.retry_eligible_at <= now())
    ) future_times WHERE t > now())                                AS next_eligible_at;
END;
$function$
;

-- The deprecated alias remains a delegate with the same hardened search path.
ALTER FUNCTION public.fetch_and_lock_next_lead(uuid,jsonb) SET search_path=pg_catalog,pg_temp;

-- Explicitly undo Supabase default function grants, including service_role on
-- private entry points. Authenticated callers cannot bypass the public core.
DO $acl$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='private' AND p.proname IN ('dnc_phone_lock_key','is_dnc_phone','guard_dnc_phone','try_queue_phone','guard_dialer_core_write','capture_dialer_conversion_lineage'))
       OR (n.nspname='public' AND p.proname IN ('advance_campaign_lead','get_next_queue_lead','get_queue_metrics','fetch_and_lock_next_lead',
         'get_personal_queue_leads','check_dialer_dnc','admit_twilio_outbound','get_outbound_admission','claim_lead',
         'release_lead_lock','renew_lead_lock','release_all_agent_locks','force_release_campaign_lead_lock'))
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',f.signature);
    IF f.nspname='public' THEN
      IF f.proname='admit_twilio_outbound' THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
      ELSE
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',f.signature);
      END IF;
    END IF;
  END LOOP;
END;
$acl$;
NOTIFY pgrst, 'reload schema';
