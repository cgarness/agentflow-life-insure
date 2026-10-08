-- One-time processing of authentic signed provider events received after attachment.
-- Does not infer approval from membership or enable sending.
BEGIN;
DO $$
DECLARE v_org uuid; v_account text; v_event record;
BEGIN
 SELECT o.id,a.account_sid INTO STRICT v_org,v_account
 FROM public.organizations o JOIN public.a2p_accounts a ON a.organization_id=o.id
 JOIN public.sms_agency_policies p ON p.organization_id=o.id
 WHERE o.slug='ffl-chris-garcia' AND o.name='Family First Life - Chris Garness'
 AND a.account_scope='master' AND a.sms_enforced AND p.enforced AND NOT p.send_enabled;
 IF (SELECT count(*) FROM public.a2p_numbers WHERE organization_id=v_org)<>5
 OR (SELECT count(DISTINCT e.payload->>'phonenumbersid') FROM public.a2p_event_inbox e
 JOIN public.a2p_numbers n ON n.organization_id=e.organization_id AND n.phone_sid=e.payload->>'phonenumbersid'
 AND n.messaging_service_sid=e.payload->>'messagingservicesid'
 WHERE e.organization_id=v_org AND e.account_sid=v_account
 AND e.event_type='com.twilio.messaging.compliance.number-registration.successful')<>5
 THEN RAISE EXCEPTION 'Five authentic successful number events required'; END IF;
 FOR v_event IN SELECT event_id FROM public.a2p_event_inbox
 WHERE organization_id=v_org AND account_sid=v_account AND processed_at IS NULL
 AND event_type LIKE 'com.twilio.messaging.compliance.number-%'
 ORDER BY event_at,event_id LIMIT 50 LOOP
  PERFORM public.process_a2p_number_event(v_account,v_event.event_id);
 END LOOP;
 IF (SELECT count(*) FROM public.a2p_numbers WHERE organization_id=v_org AND status='registered')<>5
 THEN RAISE EXCEPTION 'Number event reconciliation incomplete'; END IF;
END $$;
COMMIT;
