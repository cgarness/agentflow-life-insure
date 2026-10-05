SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.advance_campaign_lead(uuid,uuid,uuid,timestamptz,text,boolean,uuid,text,uuid,bigint,text)'::regprocedure))<>'088c6d615225ccdca43f3099a5fbb65d' THEN
  RAISE EXCEPTION 'Canonical disposition preimage changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.advance_campaign_lead(uuid,uuid,uuid,timestamptz,text,boolean,uuid,text,uuid,bigint,text)'::regprocedure
  AND (proowner<>'postgres'::regrole OR NOT prosecdef OR has_function_privilege('anon',oid,'EXECUTE') OR NOT has_function_privilege('authenticated',oid,'EXECUTE'))) THEN
  RAISE EXCEPTION 'Canonical disposition authorization metadata changed'; END IF;
END $$;
ALTER TABLE public.appointments ADD COLUMN booking_request_id uuid;
ALTER TABLE public.appointments ADD COLUMN booking_kind text;
CREATE UNIQUE INDEX appointments_booking_request_once ON public.appointments(organization_id,booking_request_id,booking_kind) WHERE booking_request_id IS NOT NULL;
CREATE TABLE private.booking_receipts(
 organization_id uuid NOT NULL,request_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('appointment','callback')),
 actor_id uuid NOT NULL,payload jsonb NOT NULL,appointment_id uuid NOT NULL,result jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organization_id,request_id,kind)
);
ALTER TABLE private.booking_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.booking_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.persist_booking(p_request uuid,p_kind text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor record; prior private.booking_receipts; row public.appointments; assignee uuid; contact uuid; body jsonb;
BEGIN
 SELECT * INTO actor FROM private.campaign_actor();
 IF p_request IS NULL OR p_kind NOT IN ('appointment','callback') OR p_kind IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'A booking request identity is required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('title','contact_id','contact_name','user_id','type','status','start_time','end_time','notes','sync_source')) THEN
  RAISE EXCEPTION 'Unsupported booking field' USING ERRCODE='22023'; END IF;
 assignee:=coalesce(nullif(p_payload->>'user_id','')::uuid,actor.uid);
 contact:=nullif(p_payload->>'contact_id','')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=assignee AND p.organization_id=actor.org_id) THEN
  RAISE EXCEPTION 'Booking assignee outside organization' USING ERRCODE='42501'; END IF;
 -- Same organization scheduler is allowed by the existing appointments_insert policy (created_by=auth.uid()).
 IF contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=contact AND c.organization_id=actor.org_id)
  AND NOT EXISTS(SELECT 1 FROM public.leads l WHERE l.id=contact AND l.organization_id=actor.org_id)
  AND NOT EXISTS(SELECT 1 FROM public.recruits r WHERE r.id=contact AND r.organization_id=actor.org_id) THEN
  RAISE EXCEPTION 'Booking contact outside organization' USING ERRCODE='42501'; END IF;
 body:=p_payload||jsonb_build_object('user_id',assignee,'contact_id',contact);
 PERFORM pg_advisory_xact_lock(hashtextextended(actor.org_id::text||':booking:'||p_request||':'||p_kind,0));
 SELECT * INTO prior FROM private.booking_receipts WHERE organization_id=actor.org_id AND request_id=p_request AND kind=p_kind;
 IF FOUND THEN
  IF prior.actor_id<>actor.uid OR prior.payload IS DISTINCT FROM body THEN
   RAISE EXCEPTION 'Booking already saved with different data; refresh before making another booking' USING ERRCODE='22023'; END IF;
  SELECT * INTO row FROM public.appointments WHERE id=prior.appointment_id AND organization_id=actor.org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'This booking was deleted. Create a new intentional booking.' USING ERRCODE='23514'; END IF;
  RETURN to_jsonb(row);
 END IF;
 IF nullif(btrim(p_payload->>'title'),'') IS NULL OR (p_payload->>'start_time') IS NULL
  OR coalesce(p_payload->>'status','Scheduled') NOT IN ('Scheduled','Confirmed','Completed','Cancelled','No Show')
  OR ((p_payload->>'end_time')::timestamptz IS NOT NULL AND (p_payload->>'end_time')::timestamptz<=(p_payload->>'start_time')::timestamptz) THEN
  RAISE EXCEPTION 'Invalid booking details' USING ERRCODE='22023'; END IF;
 INSERT INTO public.appointments(organization_id,booking_request_id,booking_kind,created_by,user_id,contact_id,contact_name,title,type,status,start_time,end_time,notes,sync_source)
 VALUES(actor.org_id,p_request,p_kind,actor.uid,assignee,contact,p_payload->>'contact_name',btrim(p_payload->>'title'),coalesce(nullif(p_payload->>'type',''),'Sales Call'),
  coalesce(p_payload->>'status','Scheduled'),(p_payload->>'start_time')::timestamptz,(p_payload->>'end_time')::timestamptz,p_payload->>'notes','internal') RETURNING * INTO row;
 IF contact IS NOT NULL THEN
  INSERT INTO public.contact_activities(organization_id,contact_id,agent_id,activity_type,description)
   VALUES(actor.org_id,contact,actor.uid,'status','Appointment scheduled');
 END IF;
 INSERT INTO private.booking_receipts VALUES(actor.org_id,p_request,p_kind,actor.uid,body,row.id,to_jsonb(row),clock_timestamp());
 RETURN to_jsonb(row);
END $$;
REVOKE ALL ON FUNCTION private.persist_booking(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.create_appointment_once(p_request_id uuid,p_appointment jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN RETURN private.persist_booking(p_request_id,'appointment',p_appointment); END $$;
REVOKE ALL ON FUNCTION public.create_appointment_once(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_appointment_once(uuid,jsonb) TO authenticated,service_role;

CREATE FUNCTION public.save_disposition_with_booking(p_input jsonb,p_appointment jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor record; d public.dispositions; result jsonb; booking jsonb; ids jsonb:='[]'; request uuid;
BEGIN
 SELECT * INTO actor FROM private.campaign_actor();
 SELECT * INTO d FROM public.dispositions WHERE id=(p_input->>'p_disposition_id')::uuid AND organization_id=actor.org_id;
 -- Original body owns all canonical disposition/DNC, admission, conversion, queue and replay checks.
 result:=public.advance_campaign_lead((p_input->>'p_campaign_lead_id')::uuid,(p_input->>'p_call_id')::uuid,
  (p_input->>'p_disposition_id')::uuid,(p_input->>'p_callback_due_at')::timestamptz,p_input->>'p_callback_note',
  coalesce((p_input->>'p_release_lock')::boolean,true),(p_input->>'p_operation_id')::uuid,coalesce(p_input->>'p_notes',''),
  (p_input->>'p_converted_client_id')::uuid,(p_input->>'p_expected_version')::bigint,coalesce(p_input->>'p_action','disposition'));
 request:=coalesce((p_input->>'p_call_id')::uuid,(p_input->>'p_operation_id')::uuid);
 IF coalesce(p_input->>'p_action','disposition')='disposition' THEN
  IF d.appointment_scheduler THEN
   IF p_appointment IS NULL THEN RAISE EXCEPTION 'Appointment details required; nothing was saved' USING ERRCODE='22023'; END IF;
   booking:=private.persist_booking(request,'appointment',p_appointment||jsonb_build_object('contact_id',result->'contact_id','user_id',actor.uid));
   ids:=ids||jsonb_build_array(booking->'id');
  ELSIF p_appointment IS NOT NULL THEN RAISE EXCEPTION 'Disposition does not schedule an appointment' USING ERRCODE='22023'; END IF;
  IF d.callback_scheduler THEN
   booking:=private.persist_booking(request,'callback',jsonb_build_object('contact_id',result->'contact_id','user_id',actor.uid,
    'title','Callback','type','Follow Up','status','Scheduled','start_time',p_input->'p_callback_due_at','notes',p_input->>'p_callback_note'));
   ids:=ids||jsonb_build_array(booking->'id');
  END IF;
 END IF;
 RETURN result||jsonb_build_object('booking_ids',ids);
END $$;
REVOKE ALL ON FUNCTION public.save_disposition_with_booking(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_disposition_with_booking(jsonb,jsonb) TO authenticated,service_role;
-- Refuse old calendar-producing disposition writes without their booking; callers must upgrade/retry.
-- Deferred checking lets the wrapper insert the booking after the unchanged original receipt.
CREATE FUNCTION private.check_disposition_booking_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d public.dispositions; key uuid;
BEGIN
 IF NEW.payload->>'action'<>'disposition' THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.dispositions WHERE id=(NEW.payload->>'disposition_id')::uuid AND organization_id=NEW.organization_id;
 key:=coalesce(NEW.call_id,NEW.operation_id);
 IF (d.appointment_scheduler AND NOT EXISTS(SELECT 1 FROM private.booking_receipts b WHERE b.organization_id=NEW.organization_id AND b.request_id=key AND b.kind='appointment'))
 OR (d.callback_scheduler AND NOT EXISTS(SELECT 1 FROM private.booking_receipts b WHERE b.organization_id=NEW.organization_id AND b.request_id=key AND b.kind='callback')) THEN
  RAISE EXCEPTION 'Reload the dialer: scheduled dispositions must save their booking atomically' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.check_disposition_booking_complete() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER disposition_booking_complete AFTER INSERT ON private.dialer_disposition_receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.check_disposition_booking_complete();

CREATE FUNCTION private.guard_booking_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_user NOT IN ('postgres','service_role') THEN
  IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Use the booking service to save appointments' USING ERRCODE='42501'; END IF;
  IF (NEW.organization_id,NEW.created_by,NEW.created_at,NEW.booking_request_id,NEW.booking_kind)
   IS DISTINCT FROM (OLD.organization_id,OLD.created_by,OLD.created_at,OLD.booking_request_id,OLD.booking_kind) THEN
   RAISE EXCEPTION 'Booking creation credit and identity are immutable' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_booking_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER appointments_booking_identity BEFORE INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.guard_booking_identity();
