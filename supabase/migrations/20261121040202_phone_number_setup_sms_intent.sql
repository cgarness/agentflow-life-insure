-- Authorize exactly one sender-pool POST for a paid number. No change to other agency senders.
BEGIN;
ALTER TABLE private.phone_number_setup_jobs
  ADD COLUMN sms_target text[],
  ADD COLUMN sms_intent_lease uuid,
  ADD CONSTRAINT phone_setup_sms_target CHECK (
    (sms_target IS NULL OR (kind='sms' AND cardinality(sms_target)=3))
    AND (sms_intent_lease IS NULL OR sms_target IS NOT NULL));

CREATE FUNCTION public.phone_number_setup_sms_intent(
  p_purchase uuid, p_lease uuid, p_service text, p_brand text, p_campaign text, p_action text, p_sole boolean
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  j private.phone_number_setup_jobs; p private.phone_number_purchase_operations;
  r public.a2p_registrations; n public.a2p_numbers; target text[]:=ARRAY[p_service,p_brand,p_campaign];
BEGIN
  SELECT * INTO j FROM private.phone_number_setup_jobs WHERE purchase_id=p_purchase AND kind='sms' FOR UPDATE;
  IF j.lease_token IS NULL OR j.lease_token IS DISTINCT FROM p_lease OR j.lease_until<=clock_timestamp()
     OR j.state NOT IN ('pending','waiting','retry') THEN RETURN 'busy'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('reserve','member','rejected') OR p_sole IS NULL
     OR coalesce(p_service,'') !~ '^MG[0-9a-fA-F]{32}$' OR coalesce(p_brand,'') !~ '^BN[0-9a-fA-F]{32}$'
     OR coalesce(p_campaign,'') !~ '^QE[0-9a-fA-F]{32}$' THEN RETURN 'conflict'; END IF;
  IF j.sms_target IS NOT NULL AND j.sms_target IS DISTINCT FROM target THEN RETURN 'conflict'; END IF;
  IF p_action='rejected' THEN
    -- Called only after a definite, retryable rejection, or when the request was never sent.
    IF j.sms_intent_lease IS DISTINCT FROM p_lease THEN RETURN 'busy'; END IF;
    UPDATE private.phone_number_setup_jobs SET sms_intent_lease=NULL WHERE purchase_id=p_purchase AND kind='sms';
    RETURN 'retry';
  END IF;

  SELECT * INTO STRICT p FROM private.phone_number_purchase_operations WHERE id=p_purchase;
  IF p.state<>'completed' OR p.number_type<>'local' OR j.organization_id<>p.organization_id OR j.phone_number<>p.phone_number
     OR j.phone_number_id<>p.phone_number_id OR NOT EXISTS (
        SELECT 1 FROM public.phone_numbers ph JOIN public.organizations o ON o.id=ph.organization_id
        WHERE ph.id=p.phone_number_id AND ph.organization_id=p.organization_id AND ph.twilio_sid=p.provider_sid
          AND ph.phone_number=p.phone_number AND ph.status IN ('active','Active') AND ph.inbounds_only IS NOT TRUE
          AND o.status='active' AND o.twilio_subaccount_status='active'
     ) THEN RETURN 'inactive'; END IF;
  SELECT * INTO r FROM public.a2p_registrations WHERE organization_id=p.organization_id FOR SHARE;
  IF FOUND AND r.operation_id IS NOT NULL THEN RETURN 'busy'; END IF;
  IF r.account_sid IS DISTINCT FROM p.account_sid OR r.messaging_service_sid IS DISTINCT FROM p_service
     OR r.brand_sid IS DISTINCT FROM p_brand OR r.campaign_sid IS DISTINCT FROM p_campaign THEN RETURN 'conflict'; END IF;
  IF r.is_test IS DISTINCT FROM false OR r.brand_status IS DISTINCT FROM 'APPROVED'
     OR coalesce(r.identity_status,'') NOT IN ('VERIFIED','VETTED_VERIFIED') OR r.campaign_status IS DISTINCT FROM 'VERIFIED'
     OR NOT EXISTS (SELECT 1 FROM public.a2p_accounts a WHERE a.organization_id=p.organization_id
        AND a.account_sid=p.account_sid AND a.enabled AND a.sms_enforced AND a.resources_reconciled_at IS NOT NULL)
     THEN RETURN 'waiting'; END IF;

  SELECT * INTO n FROM public.a2p_numbers WHERE organization_id=p.organization_id AND phone_number_id=p.phone_number_id FOR UPDATE;
  IF FOUND THEN
    IF n.phone_sid<>p.provider_sid OR n.messaging_service_sid<>p_service THEN RETURN 'conflict'; END IF;
    IF n.status IN ('failed','unregistered','pending_deregistration') THEN RETURN 'failed'; END IF;
    IF p_action='reserve' AND (n.event_at IS NOT NULL OR j.sms_target IS NULL) THEN RETURN 'uncertain'; END IF;
  END IF;
  IF p_action='reserve' AND j.sms_intent_lease IS NOT NULL THEN RETURN 'uncertain'; END IF;
  IF p_action='reserve' AND p_sole AND EXISTS (
    SELECT 1 FROM public.a2p_numbers WHERE messaging_service_sid=p_service AND phone_sid<>p.provider_sid
    AND status IN ('pending_registration','registered','pending_deregistration')
  ) THEN RETURN 'capacity'; END IF;
  INSERT INTO public.a2p_numbers(organization_id,phone_number_id,phone_sid,messaging_service_sid)
    VALUES (p.organization_id,p.phone_number_id,p.provider_sid,p_service) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.a2p_numbers WHERE organization_id=p.organization_id AND phone_number_id=p.phone_number_id
    AND phone_sid=p.provider_sid AND messaging_service_sid=p_service) THEN RETURN 'conflict'; END IF;
  UPDATE private.phone_number_setup_jobs SET sms_target=target, sms_intent_lease=CASE
    WHEN p_action='reserve' THEN p_lease ELSE sms_intent_lease END WHERE purchase_id=p_purchase AND kind='sms';
  RETURN CASE WHEN p_action='reserve' THEN 'post' ELSE 'member' END;
END $$;
REVOKE ALL ON FUNCTION public.phone_number_setup_sms_intent(uuid,uuid,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.phone_number_setup_sms_intent(uuid,uuid,text,text,text,text,boolean) TO service_role;
COMMIT;
