-- Chris approved the five-sender launch and an informational test to his own phone.
-- Forward-only activation: historical enrollments/confirmations are never replayed.
DO $activation$
DECLARE
  p public.sms_agency_policies;
  r public.a2p_registrations;
  a public.a2p_accounts;
  actual_numbers text[];
BEGIN
  SELECT * INTO STRICT p FROM public.sms_agency_policies
    WHERE sender_name='CG Financial' AND uv_project='jzdzeevjpootbeuniygx';
  IF NOT p.enforced OR p.send_enabled OR p.active_from IS NOT NULL
    OR cardinality(p.selected_phone_ids)<>5 THEN RAISE EXCEPTION 'sms_activation_policy_drift'; END IF;
  SELECT * INTO STRICT r FROM public.a2p_registrations WHERE organization_id=p.organization_id;
  SELECT * INTO STRICT a FROM public.a2p_accounts WHERE organization_id=p.organization_id;
  IF a.enabled OR NOT a.sms_enforced OR a.account_scope<>'master'
    OR r.account_sid IS DISTINCT FROM a.account_sid OR r.is_test
    OR r.brand_status IS DISTINCT FROM 'APPROVED' OR r.identity_status IS DISTINCT FROM 'VERIFIED'
    OR r.campaign_status IS DISTINCT FROM 'VERIFIED'
    OR r.messaging_service_sid IS DISTINCT FROM 'MG7fad5487a26f23727408342cc5db5346'
    OR r.campaign_sid IS DISTINCT FROM 'QE2c6890da8086d771620e9b13fadeba0b'
    OR r.sync_error IS NOT NULL OR r.last_synced_at IS NULL
    OR r.last_synced_at<now()-interval '5 minutes' THEN RAISE EXCEPTION 'sms_activation_provider_drift'; END IF;
  SELECT array_agg(n.phone_number ORDER BY n.phone_number) INTO actual_numbers
  FROM public.phone_numbers n JOIN public.a2p_numbers s
    ON s.organization_id=n.organization_id AND s.phone_number_id=n.id AND s.phone_sid=n.twilio_sid
  WHERE n.organization_id=p.organization_id AND n.id=ANY(p.selected_phone_ids)
    AND n.assignment_type='agency' AND n.status IN ('active','Active')
    AND s.status='registered' AND s.pool_member AND s.messaging_service_sid=r.messaging_service_sid;
  IF actual_numbers IS DISTINCT FROM ARRAY['+12136676225','+12162706473','+14632313033','+15673645227','+19162998778']::text[]
    OR (SELECT count(*) FROM public.a2p_numbers WHERE organization_id=p.organization_id)<>5 THEN
    RAISE EXCEPTION 'sms_activation_sender_drift';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sms_enrollments WHERE organization_id=p.organization_id)
    OR EXISTS (SELECT 1 FROM public.sms_confirmation_jobs WHERE organization_id=p.organization_id)
    OR EXISTS (SELECT 1 FROM public.sms_dispatches WHERE organization_id=p.organization_id) THEN
    RAISE EXCEPTION 'sms_activation_existing_work';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE active AND schedule='* * * * *'
      AND jobname IN ('sms-consent-recovery-every-minute','a2p-reconcile-every-minute'))<>2 THEN
    RAISE EXCEPTION 'sms_activation_recovery_missing';
  END IF;
  UPDATE public.a2p_accounts SET enabled=true WHERE organization_id=p.organization_id;
  UPDATE public.sms_agency_policies SET send_enabled=true,active_from='2026-10-08T03:52:00Z'
    WHERE organization_id=p.organization_id;
  -- enrollment_verified_at stays unchanged: enabling existing registered senders
  -- is not a claim of Embeddable onboarding entitlement or new fee acceptance.
END $activation$;
