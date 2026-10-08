-- Owner-requested manual SMS simplification. Automated messages retain their
-- purpose-specific evidence and confirmation checks. Existing history is intact.
BEGIN;

ALTER TABLE public.sms_dispatches DROP CONSTRAINT sms_dispatches_purpose_check;
ALTER TABLE public.sms_dispatches ADD CONSTRAINT sms_dispatches_purpose_check
  CHECK (purpose IN ('informational', 'marketing', 'manual'));
ALTER TABLE public.sms_dispatches ADD CONSTRAINT sms_dispatches_manual_scope_check
  CHECK (purpose <> 'manual' OR (
    actor_id IS NOT NULL AND contact_id IS NOT NULL AND contact_type IS NOT NULL
    AND contact_type IN ('lead', 'client', 'recruit')
    AND confirmation_id IS NULL AND cardinality(evidence_ids) = 0
    AND request_key ~ ('^manual:' || actor_id::text || ':[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  ));

-- Preserve the service-only signature, owner, invoker behavior, ACL and DNC helper.
-- The authenticated Edge entry point resolves actor/contact access before calling.
CREATE OR REPLACE FUNCTION public.sms_prepare_dispatch(p_org uuid,p_key text,p_phone text,p_from text,p_body text,p_purpose text,p_hash text,p_evidence uuid[],p_actor uuid DEFAULT NULL,p_contact uuid DEFAULT NULL,p_type text DEFAULT NULL,p_confirmation uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_policy public.sms_agency_policies; v_row public.sms_dispatches;
BEGIN
  SELECT * INTO v_policy FROM public.sms_agency_policies WHERE organization_id=p_org AND enforced;
  IF NOT FOUND OR NOT v_policy.send_enabled THEN RAISE EXCEPTION 'sms_paused'; END IF;
  IF p_phone !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' OR p_purpose IS NULL OR p_purpose NOT IN ('informational','marketing','manual') THEN RAISE EXCEPTION 'sms_permission'; END IF;
  IF p_purpose='manual' THEN
    IF p_actor IS NULL OR p_contact IS NULL OR p_type IS NULL OR p_type NOT IN ('lead','client','recruit')
      OR p_confirmation IS NOT NULL OR p_evidence IS NULL OR cardinality(p_evidence)<>0
      OR p_key IS NULL OR p_key !~ ('^manual:' || p_actor::text || ':[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    THEN RAISE EXCEPTION 'sms_manual_scope'; END IF;
  ELSIF coalesce(cardinality(p_evidence),0)=0 THEN RAISE EXCEPTION 'sms_permission';
  END IF;
  PERFORM private.sms_recipient_guard(p_org,p_phone);
  SELECT * INTO v_row FROM public.sms_dispatches WHERE organization_id=p_org AND request_key=p_key FOR UPDATE;
  IF FOUND THEN
    IF v_row.payload_hash<>p_hash THEN RAISE EXCEPTION 'sms_request_conflict'; END IF;
    RETURN to_jsonb(v_row);
  END IF;
  IF private.sms_recipient_guard(p_org,p_phone) OR EXISTS(SELECT 1 FROM public.sms_suppressions WHERE organization_id=p_org AND phone_e164=p_phone) THEN RAISE EXCEPTION 'sms_suppressed'; END IF;
  IF p_purpose<>'manual' THEN
    IF p_confirmation IS NULL THEN
      IF NOT EXISTS(SELECT 1 FROM public.sms_enrollments WHERE organization_id=p_org AND phone_e164=p_phone AND
        CASE p_purpose WHEN 'informational' THEN informational_confirmed ELSE marketing_confirmed END) THEN RAISE EXCEPTION 'sms_confirmation_pending'; END IF;
    ELSIF NOT EXISTS(SELECT 1 FROM public.sms_confirmation_jobs WHERE id=p_confirmation AND organization_id=p_org AND phone_e164=p_phone AND state='pending' AND created_at>=now()-interval '30 minutes' AND evidence_ids=p_evidence) THEN RAISE EXCEPTION 'sms_confirmation_scope'; END IF;
  END IF;
  INSERT INTO public.sms_dispatches(organization_id,request_key,payload_hash,phone_e164,from_number,body,purpose,evidence_ids,actor_id,contact_id,contact_type,confirmation_id)
  VALUES(p_org,p_key,p_hash,p_phone,p_from,p_body,p_purpose,p_evidence,p_actor,p_contact,p_type,p_confirmation) RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

COMMIT;
