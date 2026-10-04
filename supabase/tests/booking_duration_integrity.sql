CREATE FUNCTION public.test_reject(q text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; ELSE RAISE; END IF; END; RAISE EXCEPTION 'Expected %',expected; END $$;
CREATE TABLE public.booking_test_results(key text PRIMARY KEY,result jsonb);
GRANT ALL ON public.booking_test_results TO authenticated;
SELECT test_actor(11);
SET ROLE authenticated;
INSERT INTO booking_test_results VALUES('first',create_appointment_once(test_uuid(31001),jsonb_build_object('title','Booking fixture','start_time',now()+interval '1 day','contact_id',test_uuid(201),'user_id',test_uuid(12))));
INSERT INTO booking_test_results VALUES('retry',create_appointment_once(test_uuid(31001),jsonb_build_object('title','Booking fixture','start_time',now()+interval '1 day','contact_id',test_uuid(201),'user_id',test_uuid(12))));
SELECT test_reject($q$SELECT create_appointment_once(test_uuid(31001),jsonb_build_object('title','Changed','start_time',now()+interval '1 day'))$q$,'22023');
SELECT test_reject($q$SELECT create_appointment_once(test_uuid(31002),jsonb_build_object('title','Foreign','start_time',now()+interval '1 day','contact_id',test_uuid(204)))$q$,'42501');
SELECT test_reject($q$SELECT create_appointment_once(test_uuid(31003),jsonb_build_object('title','Foreign','start_time',now()+interval '1 day','user_id',test_uuid(21)))$q$,'42501');
RESET ROLE;
SELECT test_assert((SELECT result FROM booking_test_results WHERE key='first')=(SELECT result FROM booking_test_results WHERE key='retry'),'lost-ack returns exact original booking');
SELECT test_assert((SELECT count(*) FROM appointments WHERE booking_request_id=test_uuid(31001))=1,'one persisted booking');
SELECT test_assert((SELECT created_by=test_uuid(11) AND user_id=test_uuid(12) FROM appointments WHERE booking_request_id=test_uuid(31001)),'setter/assignee remain distinct');
-- Fresh isolated standalone call: original disposition authorization and callback receipt run unchanged.
INSERT INTO calls(id,organization_id,agent_id,contact_id,contact_type,contact_phone,direction,status,dialer_admission_required)
 VALUES(test_uuid(31010),test_uuid(1),test_uuid(11),test_uuid(201),'lead','5551234567','outbound','completed',false);
SET ROLE authenticated;
INSERT INTO booking_test_results VALUES('callback',save_disposition_with_booking(jsonb_build_object('p_call_id',test_uuid(31010),'p_operation_id',test_uuid(31011),'p_disposition_id',test_uuid(505),'p_callback_due_at',now()+interval '1 day','p_callback_note','call later','p_notes','call later','p_release_lock',false)));
INSERT INTO booking_test_results VALUES('callback-retry',save_disposition_with_booking(jsonb_build_object('p_call_id',test_uuid(31010),'p_operation_id',test_uuid(31011),'p_disposition_id',test_uuid(505),'p_callback_due_at',now()+interval '1 day','p_callback_note','call later','p_notes','call later','p_release_lock',false)));
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT test_assert((SELECT count(*) FROM appointments WHERE booking_request_id=test_uuid(31010) AND booking_kind='callback')=1,'callback retry booking exactly once');
SELECT test_assert((SELECT (result->>'replayed')::boolean FROM booking_test_results WHERE key='callback-retry'),'original disposition replay preserved');
INSERT INTO calls(id,organization_id,agent_id,contact_id,contact_type,contact_phone,direction,status,dialer_admission_required)
 VALUES(test_uuid(31012),test_uuid(1),test_uuid(11),test_uuid(201),'lead','5551234567','outbound','completed',false);
SET CONSTRAINTS ALL DEFERRED;
SET ROLE authenticated;
SELECT test_reject($q$SELECT save_disposition_with_booking(jsonb_build_object('p_call_id',test_uuid(31012),'p_operation_id',test_uuid(31013),'p_disposition_id',test_uuid(506),'p_notes','appointment','p_release_lock',false),null)$q$,'22023');
RESET ROLE;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM private.dialer_disposition_receipts WHERE operation_id=test_uuid(31013)),'missing booking rolls back disposition receipt');
SELECT test_assert((SELECT disposition_id IS NULL FROM calls WHERE id=test_uuid(31012)),'missing booking rolls back call disposition');
-- Pure service-only canonical duration evidence: estimate 120 -> provider 90 -> stale estimate/failure.
INSERT INTO calls(id,organization_id,agent_id,direction,status,twilio_call_sid,duration,dialer_admission_required)
 VALUES(test_uuid(31020),test_uuid(1),test_uuid(11),'outbound','completed','CA00000000000000000000000000031020',null,false);
SET ROLE service_role;
SELECT record_call_duration_evidence(test_uuid(31020),'AC00000000000000000000000000000001','CA00000000000000000000000000031020','CA00000000000000000000000000031020',null,120,'elapsed_estimate',1);
SELECT record_call_duration_evidence(test_uuid(31020),'AC00000000000000000000000000000001','CA00000000000000000000000000031020','CA00000000000000000000000000031020',null,90,'provider',2);
SELECT record_call_duration_evidence(test_uuid(31020),'AC00000000000000000000000000000001','CA00000000000000000000000000031020','CA00000000000000000000000000031020',null,180,'elapsed_estimate',1);
SELECT record_call_duration_evidence(test_uuid(31020),'AC00000000000000000000000000000001','CA00000000000000000000000000031020','CA00000000000000000000000000031020',null,0,'terminal_non_answer',0);
SELECT record_call_duration_evidence(test_uuid(31020),'AC00000000000000000000000000000001','CA00000000000000000000000000031020','CA00000000000000000000000000031020',null,95,'provider',2);
RESET ROLE;
SELECT test_assert((SELECT duration=90 AND duration_source='provider' AND duration_conflict FROM calls WHERE id=test_uuid(31020)),'provider truth corrects estimate, late callbacks cannot inflate it; conflicting finals flagged');
SELECT test_assert(NOT has_function_privilege('authenticated','public.record_call_duration_evidence(uuid,text,text,text,text,integer,text,bigint,timestamptz)','EXECUTE'),'browser cannot submit duration evidence');
SELECT test_assert(md5(pg_get_functiondef('public.advance_campaign_lead(uuid,uuid,uuid,timestamptz,text,boolean,uuid,text,uuid,bigint,text)'::regprocedure))='088c6d615225ccdca43f3099a5fbb65d','canonical disposition body unchanged');
-- Provider identity prevents overlapping imports; a different intentional provider event is valid.
INSERT INTO appointments(organization_id,user_id,title,start_time,external_provider,external_event_id)
 VALUES(test_uuid(1),test_uuid(11),'External',now(),'google','fixture-event-1');
SELECT test_reject($q$INSERT INTO appointments(organization_id,user_id,title,start_time,external_provider,external_event_id) VALUES(test_uuid(1),test_uuid(11),'External',now(),'google','fixture-event-1')$q$,'23505');
INSERT INTO appointments(organization_id,user_id,title,start_time,external_provider,external_event_id)
 VALUES(test_uuid(1),test_uuid(11),'External',now(),'google','fixture-event-2');
SELECT test_assert((SELECT count(*)=2 FROM appointments WHERE external_provider='google'),'provider retries do not create bookings');
SET ROLE authenticated;
SELECT test_reject($q$INSERT INTO appointments(organization_id,user_id,title,start_time) VALUES(test_uuid(1),test_uuid(11),'Bypass',now())$q$,'42501');
SELECT test_reject($q$UPDATE appointments SET created_by=test_uuid(12) WHERE booking_request_id=test_uuid(31001)$q$,'42501');
SELECT test_reject($q$UPDATE calls SET duration=999 WHERE id=test_uuid(31020)$q$,'42501');
RESET ROLE;
SET ROLE service_role;
SELECT test_reject($q$SELECT record_call_duration_evidence(test_uuid(31020),'AC00000000000000000000000000000001','CA00000000000000000000000000039999','CA00000000000000000000000000039999',null,1,'provider',99)$q$,'22023');
RESET ROLE;
-- Retry of an OLD committed receipt must still finish the missing booking once.
SET ROLE authenticated;
INSERT INTO booking_test_results VALUES('upgrade-retry',save_disposition_with_booking(jsonb_build_object('p_call_id',test_uuid(30990),'p_operation_id',test_uuid(30991),'p_disposition_id',test_uuid(505),'p_callback_due_at','2030-10-15T12:00:00Z','p_callback_note','Old callback','p_notes','Old notes','p_release_lock',false)));
SELECT save_disposition_with_booking(jsonb_build_object('p_call_id',test_uuid(30990),'p_operation_id',test_uuid(30991),'p_disposition_id',test_uuid(505),'p_callback_due_at','2030-10-15T12:00:00Z','p_callback_note','Old callback','p_notes','Old notes','p_release_lock',false));
RESET ROLE;
SELECT test_assert((SELECT (result->>'replayed')::boolean FROM booking_test_results WHERE key='upgrade-retry') AND (SELECT count(*)=1 FROM appointments WHERE booking_request_id=test_uuid(30990)),'old committed disposition gets its missing booking exactly once');
-- A real booking failure rolls back the call and receipt as well.
CREATE FUNCTION public.test_booking_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='Fail booking' THEN RAISE EXCEPTION 'Synthetic write failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER test_booking_failure BEFORE INSERT ON appointments FOR EACH ROW EXECUTE FUNCTION public.test_booking_failure();
SET ROLE authenticated;
SELECT test_reject($q$SELECT save_disposition_with_booking(jsonb_build_object('p_call_id',test_uuid(31012),'p_operation_id',test_uuid(31013),'p_disposition_id',test_uuid(506),'p_notes','appointment','p_release_lock',false),jsonb_build_object('title','Fail booking','start_time','2030-10-15T12:00:00Z'))$q$,'P0001');
RESET ROLE;
SELECT test_assert(NOT EXISTS(SELECT 1 FROM private.dialer_disposition_receipts WHERE operation_id=test_uuid(31013)) AND (SELECT disposition_id IS NULL FROM calls WHERE id=test_uuid(31012)),'database booking failure leaves no core disposition mutation');
DROP TRIGGER test_booking_failure ON appointments;
DROP FUNCTION public.test_booking_failure();
