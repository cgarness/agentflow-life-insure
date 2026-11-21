-- Compatibility phase. Capture remains disabled until every sender has the managed-number guard.
BEGIN;

-- Twilio exposes the same USA2P resource SID under different Messaging Services. The
-- provider resource is account + service + QE. Existing unique MG and BN ownership stay intact.
ALTER TABLE public.a2p_registrations
  DROP CONSTRAINT a2p_registrations_campaign_sid_key,
  ADD CONSTRAINT a2p_registrations_scoped_campaign_key UNIQUE(account_sid,messaging_service_sid,campaign_sid);

CREATE TABLE private.phone_number_setup_jobs (
  purchase_id uuid NOT NULL REFERENCES private.phone_number_purchase_operations(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  phone_number_id uuid NOT NULL,
  phone_number text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('trust','sms')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','waiting','retry','review','complete')),
  code text CHECK (code ~ '^[a-zA-Z][a-zA-Z_0-9]{0,63}$'),
  next_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  submitted_at timestamptz,
  policy_selected_at timestamptz,
  PRIMARY KEY (purchase_id,kind),
  UNIQUE (organization_id,phone_number_id,kind),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
-- A separate per-agency setup lease avoids mutating the agency registration operation,
-- which the live sticky-sender guard uses to pause texting during manual onboarding.
CREATE UNIQUE INDEX phone_setup_org_sms_lease ON private.phone_number_setup_jobs(organization_id)
  WHERE kind='sms' AND lease_token IS NOT NULL;
CREATE INDEX phone_setup_due ON private.phone_number_setup_jobs(next_at,purchase_id,kind)
  WHERE state IN ('pending','waiting','retry');
CREATE INDEX phone_setup_managed_number ON private.phone_number_setup_jobs(phone_number) WHERE kind='sms';
ALTER TABLE private.phone_number_setup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.phone_number_setup_jobs FROM PUBLIC,anon,authenticated,service_role;

-- Write-once binding from the server-side Twilio CustomerProfiles creation response.
CREATE TABLE public.phone_number_setup_profiles (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_sid text NOT NULL CHECK (account_sid ~ '^AC[0-9A-Fa-f]{32}$'),
  profile_sid text PRIMARY KEY CHECK (profile_sid ~ '^BU[0-9A-Fa-f]{32}$')
);
ALTER TABLE public.phone_number_setup_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_number_setup_profiles FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.phone_number_setup_profiles TO service_role;

CREATE FUNCTION private.enqueue_phone_number_setup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  INSERT INTO private.phone_number_setup_jobs(purchase_id,organization_id,phone_number_id,phone_number,kind)
  VALUES (NEW.id,NEW.organization_id,NEW.phone_number_id,NEW.phone_number,'trust'),
         (NEW.id,NEW.organization_id,NEW.phone_number_id,NEW.phone_number,'sms');
  RETURN NULL;
END $$;
CREATE TRIGGER enqueue_phone_number_setup AFTER UPDATE OF state ON private.phone_number_purchase_operations
  FOR EACH ROW WHEN (OLD.state <> 'completed' AND NEW.state='completed')
  EXECUTE FUNCTION private.enqueue_phone_number_setup();
ALTER TABLE private.phone_number_purchase_operations DISABLE TRIGGER enqueue_phone_number_setup;

CREATE FUNCTION public.phone_number_setup_claim()
RETURNS TABLE(purchase_id uuid,kind text,lease_token uuid,organization_id uuid,actor_id uuid,
  account_sid text,phone_number_id uuid,phone_sid text,phone_number text,number_type text,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE candidate record;
BEGIN
  FOR candidate IN
    SELECT j.purchase_id,j.kind,j.organization_id FROM private.phone_number_setup_jobs j
    WHERE j.state IN ('pending','waiting','retry') AND j.next_at <= statement_timestamp()
      AND (j.lease_until IS NULL OR j.lease_until <= statement_timestamp())
      AND (j.kind='trust' OR NOT EXISTS (SELECT 1 FROM private.phone_number_setup_jobs held
        WHERE held.organization_id=j.organization_id AND held.kind='sms'
          AND held.lease_token IS NOT NULL AND held.purchase_id<>j.purchase_id))
    ORDER BY j.next_at,j.purchase_id,j.kind LIMIT 32
  LOOP
    -- Nonblocking under contention, including when two claims are still uncommitted.
    IF candidate.kind='sms' AND NOT pg_try_advisory_xact_lock(hashtextextended(
      'phone_number_setup_sms:'||candidate.organization_id::text,0)) THEN CONTINUE; END IF;
    RETURN QUERY
      WITH locked AS (
        SELECT j.purchase_id,j.kind FROM private.phone_number_setup_jobs j
        WHERE (j.purchase_id,j.kind)=(candidate.purchase_id,candidate.kind)
          AND j.state IN ('pending','waiting','retry') AND j.next_at<=statement_timestamp()
          AND (j.lease_until IS NULL OR j.lease_until<=statement_timestamp())
          AND (j.kind='trust' OR NOT EXISTS (SELECT 1 FROM private.phone_number_setup_jobs held
            WHERE held.organization_id=j.organization_id AND held.kind='sms'
              AND held.lease_token IS NOT NULL AND held.purchase_id<>j.purchase_id))
        FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE private.phone_number_setup_jobs j SET lease_token=gen_random_uuid(),
          lease_until=clock_timestamp()+interval '2 minutes', attempts=j.attempts+1
        FROM locked l WHERE (j.purchase_id,j.kind)=(l.purchase_id,l.kind) RETURNING j.*
      )
      SELECT j.purchase_id,j.kind,j.lease_token,j.organization_id,p.actor_id,p.account_sid,
        j.phone_number_id,p.provider_sid,j.phone_number,p.number_type,j.attempts
      FROM claimed j JOIN private.phone_number_purchase_operations p ON p.id=j.purchase_id;
    IF FOUND THEN RETURN; END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.phone_number_setup_finish(p_purchase uuid,p_kind text,p_lease uuid,p_state text,
  p_code text,p_retry_seconds integer,p_profile_sid text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j private.phone_number_setup_jobs;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('complete','waiting','retry','review') OR
    (p_code IS NOT NULL AND p_code !~ '^[a-zA-Z][a-zA-Z_0-9]{0,63}$') THEN
    RAISE EXCEPTION 'invalid_setup_outcome' USING ERRCODE='22023';
  END IF;
  SELECT * INTO j FROM private.phone_number_setup_jobs
  WHERE purchase_id=p_purchase AND kind=p_kind AND lease_token=p_lease AND lease_until>clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_kind='trust' AND p_state='complete' THEN
    -- Recheck current local identity after Twilio's response. A stale/ambiguous profile cannot stamp a number.
    UPDATE public.phone_numbers n SET trust_hub_status='approved'
    FROM private.phone_number_purchase_operations p
    WHERE p.id=j.purchase_id AND n.organization_id=j.organization_id AND n.id=j.phone_number_id
      AND n.phone_number=j.phone_number AND n.twilio_sid=p.provider_sid AND n.status IN ('active','Active')
      AND p_profile_sid ~ '^BU[0-9A-Fa-f]{32}$'
      AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=j.organization_id AND o.status='active' AND o.twilio_subaccount_status='active')
      AND EXISTS (SELECT 1 FROM public.phone_settings s WHERE s.organization_id=j.organization_id AND s.trust_hub_profile_sid=p_profile_sid)
      AND NOT EXISTS (SELECT 1 FROM public.phone_settings s WHERE s.organization_id<>j.organization_id AND s.trust_hub_profile_sid=p_profile_sid);
    IF NOT FOUND THEN
      p_state:='review';
      p_code:='profile_changed';
    END IF;
  END IF;
  UPDATE private.phone_number_setup_jobs SET state=p_state,code=p_code,lease_token=NULL,lease_until=NULL,
    submitted_at=CASE WHEN p_kind='sms' AND p_state='complete' THEN coalesce(submitted_at,clock_timestamp()) ELSE submitted_at END,
    next_at=clock_timestamp()+make_interval(secs=>greatest(30,least(86400,coalesce(p_retry_seconds,300))))
  WHERE purchase_id=p_purchase AND kind=p_kind;
  RETURN true;
END $$;

-- Look up paid provenance even after deletion, reassignment, or corruption of a live phone row.
CREATE FUNCTION public.phone_number_setup_managed(p_org uuid,p_number text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE WHEN count(*)=0 THEN jsonb_build_object('managed',false)
    WHEN count(*)=1 AND bool_and(j.organization_id=p_org) THEN jsonb_build_object(
      'managed',true,'owned',true,'account_sid',min(p.account_sid),'phone_sid',min(p.provider_sid),
      'phone_number_id',min(j.phone_number_id::text),
      'agency_active',coalesce(bool_and(o.status='active' AND o.twilio_subaccount_status='active'),false),
      'policy_enforced',coalesce(bool_and(pol.enforced),false),
      'policy_enabled',coalesce(bool_and(pol.send_enabled),false),
      'policy_selected',coalesce(bool_and(j.phone_number_id=ANY(pol.selected_phone_ids)),false))
    ELSE jsonb_build_object('managed',true,'owned',false) END
  FROM private.phone_number_setup_jobs j JOIN private.phone_number_purchase_operations p ON p.id=j.purchase_id
  JOIN public.organizations o ON o.id=j.organization_id
  LEFT JOIN public.sms_agency_policies pol ON pol.organization_id=j.organization_id
  WHERE j.kind='sms' AND j.phone_number=p_number;
$$;

CREATE FUNCTION public.phone_number_setup_legacy_workflow_sender(p_org uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT n.phone_number FROM public.phone_numbers n
  WHERE n.organization_id=p_org AND n.status IN ('active','Active') AND n.assignment_type='agency'
    AND n.inbounds_only IS NOT TRUE AND n.phone_number ~ '^\+[1-9][0-9]{6,14}$'
    AND n.phone_number !~ '^\+1(800|888|877|866|855|844|833)'
    AND NOT EXISTS (SELECT 1 FROM private.phone_number_setup_jobs j WHERE j.kind='sms' AND j.phone_number=n.phone_number)
  ORDER BY n.is_default DESC NULLS LAST,n.id LIMIT 1;
$$;

-- One common predicate for status and one-time sender selection. Only trusted code reads this view.
CREATE VIEW private.phone_number_setup_readiness WITH (security_invoker=true) AS
SELECT j.purchase_id,j.organization_id,j.phone_number_id,p.number_type,j.state,j.code,j.submitted_at,
  n.assignment_type,n.assigned_to,n.status AS number_status,j.policy_selected_at,r.operation_id AS registration_operation,
  pol.enforced AS policy_enforced,pol.send_enabled AS policy_enabled,n.id=ANY(pol.selected_phone_ids) AS policy_selected,
  CASE
    WHEN n.id IS NULL OR n.phone_number<>p.phone_number OR n.twilio_sid IS DISTINCT FROM p.provider_sid
      OR n.status IS NULL OR n.status NOT IN ('active','Active') THEN 'inactive_number'
    WHEN p.number_type='toll_free' THEN 'toll_free'
    WHEN n.inbounds_only THEN 'voice_only'
    WHEN o.status IS DISTINCT FROM 'active' OR o.twilio_subaccount_status IS DISTINCT FROM 'active' THEN 'agency_suspended'
    WHEN a.account_sid<>p.account_sid OR r.account_sid<>p.account_sid THEN 'account_mismatch'
    WHEN a.enabled IS DISTINCT FROM true OR a.sms_enforced IS DISTINCT FROM true OR a.resources_reconciled_at IS NULL
      OR r.is_test IS DISTINCT FROM false OR r.brand_sid IS NULL OR r.campaign_sid IS NULL
      OR r.messaging_service_sid IS NULL OR r.account_sid IS NULL OR r.brand_status IS DISTINCT FROM 'APPROVED'
      OR r.identity_status IS NULL OR r.identity_status NOT IN ('VERIFIED','VETTED_VERIFIED')
      OR r.campaign_status IS DISTINCT FROM 'VERIFIED' THEN 'waiting_agency'
    WHEN r.sync_error IS NOT NULL OR r.last_synced_at IS NULL OR r.last_synced_at < now()-interval '24 hours'
      THEN 'registration_stale'
    WHEN m.phone_number_id IS NULL THEN CASE WHEN j.submitted_at < now()-interval '24 hours' THEN 'confirmation_overdue' ELSE 'awaiting_registration' END
    WHEN m.phone_sid<>p.provider_sid OR m.messaging_service_sid<>r.messaging_service_sid THEN 'mapping_conflict'
    WHEN m.status IN ('unregistered','pending_deregistration') THEN 'sender_removed'
    WHEN m.status IN ('failed','error','unknown') THEN 'registration_failed'
    WHEN m.status<>'registered' OR m.event_at IS NULL THEN CASE WHEN j.submitted_at < now()-interval '24 hours' THEN 'confirmation_overdue' ELSE 'awaiting_registration' END
    WHEN m.checked_at IS NULL OR m.checked_at < now()-interval '24 hours' THEN 'registration_stale'
    WHEN NOT m.pool_member THEN 'sender_removed'
    ELSE 'registered'
  END AS evidence
FROM private.phone_number_setup_jobs j
JOIN private.phone_number_purchase_operations p ON p.id=j.purchase_id
JOIN public.organizations o ON o.id=j.organization_id
LEFT JOIN public.phone_numbers n ON n.organization_id=j.organization_id AND n.id=j.phone_number_id
LEFT JOIN public.a2p_accounts a ON a.organization_id=j.organization_id
LEFT JOIN public.a2p_registrations r ON r.organization_id=j.organization_id
LEFT JOIN public.a2p_numbers m ON m.organization_id=j.organization_id AND m.phone_number_id=j.phone_number_id
LEFT JOIN public.sms_agency_policies pol ON pol.organization_id=j.organization_id
WHERE j.kind='sms';
REVOKE ALL ON private.phone_number_setup_readiness FROM PUBLIC,anon,authenticated,service_role;

-- Either event order is valid. The existing reconciler updates pool timestamps only from provider snapshots.
CREATE FUNCTION private.select_purchased_sms_sender() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE receipt uuid;
BEGIN
  SELECT v.purchase_id INTO receipt FROM private.phone_number_setup_readiness v
  WHERE v.organization_id=NEW.organization_id AND v.phone_number_id=NEW.phone_number_id
    AND v.evidence='registered' AND v.assignment_type='agency'
    AND v.policy_enabled AND v.policy_enforced AND v.policy_selected_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE private.phone_number_setup_jobs SET policy_selected_at=statement_timestamp()
  WHERE purchase_id=receipt AND kind='sms' AND policy_selected_at IS NULL;
  IF FOUND THEN
    UPDATE public.sms_agency_policies SET selected_phone_ids=CASE WHEN NEW.phone_number_id=ANY(selected_phone_ids)
      THEN selected_phone_ids ELSE array_append(selected_phone_ids,NEW.phone_number_id) END
    WHERE organization_id=NEW.organization_id AND enforced AND send_enabled;
    IF NOT FOUND THEN
      UPDATE private.phone_number_setup_jobs SET policy_selected_at=NULL WHERE purchase_id=receipt AND kind='sms';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER select_purchased_sms_sender AFTER INSERT OR UPDATE OF status,event_at,pool_member,checked_at ON public.a2p_numbers
  FOR EACH ROW WHEN (NEW.status='registered' AND NEW.event_at IS NOT NULL AND NEW.pool_member)
  EXECUTE FUNCTION private.select_purchased_sms_sender();

CREATE FUNCTION public.phone_number_setup_status(p_org uuid,p_numbers uuid[]) RETURNS TABLE (
  phone_number_id uuid,trust_state text,sms_state text,trust_code text,sms_code text,can_retry boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE sticky_mode text:='off';
BEGIN
  IF cardinality(p_numbers)>200 THEN RAISE EXCEPTION 'too_many_numbers' USING ERRCODE='22023'; END IF;
  IF p_org IS DISTINCT FROM public.get_org_id() OR NOT EXISTS (
    SELECT 1 FROM public.profiles u WHERE u.id=auth.uid() AND u.organization_id=p_org AND u.status='Active'
  ) THEN RAISE EXCEPTION 'agency_access_required' USING ERRCODE='42501'; END IF;
  -- The independently released sticky feature may be absent on older installations.
  -- Resolve only its public service contract, once per page, after tenant authorization.
  IF to_regprocedure('public.sticky_number_guard(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.sticky_number_guard($1)->>''sms''' INTO sticky_mode USING p_org;
    IF sticky_mode IS NULL OR sticky_mode NOT IN ('off','shadow','guard_only','enforced') THEN
      RAISE EXCEPTION 'unknown_sender_guard';
    END IF;
  END IF;
  RETURN QUERY
  SELECT v.phone_number_id,
    CASE WHEN v.evidence='inactive_number' THEN 'inactive'
      WHEN t.state='complete' AND n.trust_hub_status='approved' THEN 'linked'
      WHEN t.state='complete' THEN 'review' ELSE t.state END,
    CASE WHEN v.evidence='inactive_number' THEN 'inactive'
      WHEN v.evidence IN ('voice_only','toll_free') THEN v.evidence
      WHEN v.evidence='registered' THEN CASE
        WHEN v.policy_enforced IS DISTINCT FROM true THEN 'waiting'
        WHEN sticky_mode IN ('guard_only','enforced') AND v.registration_operation IS NOT NULL THEN 'waiting'
        WHEN v.policy_enforced AND NOT v.policy_enabled THEN 'waiting'
        WHEN v.assignment_type='personal' AND (coalesce(v.policy_enforced,false) OR v.assigned_to IS DISTINCT FROM auth.uid()) THEN 'review'
        WHEN v.policy_enforced AND NOT v.policy_selected THEN 'review'
        ELSE 'ready' END
      WHEN v.code IN ('voice_only','toll_free') THEN v.code
      WHEN v.evidence IN ('account_mismatch','agency_suspended','mapping_conflict','registration_failed','sender_removed','confirmation_overdue') THEN 'review'
      WHEN v.state IN ('review','retry') THEN v.state
      WHEN v.evidence IN ('waiting_agency','registration_stale') THEN 'waiting'
      WHEN v.state='complete' THEN 'registering' ELSE v.state END,
    t.code, CASE WHEN v.evidence='registered' AND v.policy_enforced IS DISTINCT FROM true THEN 'policy_required'
      WHEN v.evidence='registered' AND sticky_mode IN ('guard_only','enforced') AND v.registration_operation IS NOT NULL THEN 'registration_busy'
      WHEN v.evidence='registered' AND v.policy_enforced AND NOT v.policy_enabled THEN 'policy_disabled'
      WHEN v.evidence='registered' AND v.assignment_type='personal' AND (coalesce(v.policy_enforced,false) OR v.assigned_to IS DISTINCT FROM auth.uid()) THEN 'personal_number'
      WHEN v.evidence='registered' AND v.policy_enforced AND NOT v.policy_selected THEN 'sender_not_selected'
      WHEN v.evidence='registered' THEN 'registered'
      WHEN v.code IN ('voice_only','toll_free') THEN v.code
      WHEN v.evidence IN ('inactive_number','voice_only','toll_free','account_mismatch','agency_suspended','mapping_conflict','registration_failed','sender_removed','confirmation_overdue') THEN v.evidence
      WHEN v.state IN ('review','retry') THEN v.code
      WHEN v.evidence IN ('waiting_agency','registration_stale') THEN v.evidence
      ELSE coalesce(v.code,nullif(v.evidence,'awaiting_registration')) END,
    EXISTS (SELECT 1 FROM public.profiles u WHERE u.id=auth.uid() AND u.organization_id=p_org AND u.status='Active'
      AND u.role IN ('Admin','Super Admin'))
      AND EXISTS (SELECT 1 FROM private.phone_number_setup_jobs retry WHERE retry.purchase_id=v.purchase_id
        AND retry.state IN ('review','retry') AND (retry.lease_until IS NULL OR retry.lease_until<=statement_timestamp())
        AND NOT (retry.kind='sms' AND coalesce(retry.code,'') IN ('voice_only','toll_free')))
      AND v.evidence<>'inactive_number'
  FROM private.phone_number_setup_readiness v JOIN private.phone_number_setup_jobs t
    ON t.purchase_id=v.purchase_id AND t.kind='trust'
  JOIN public.phone_numbers n ON n.id=v.phone_number_id AND n.organization_id=v.organization_id
  WHERE v.organization_id=p_org AND v.phone_number_id=ANY(p_numbers);
END $$;

CREATE FUNCTION public.phone_number_setup_retry(p_org uuid,p_number uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF p_org IS DISTINCT FROM public.get_org_id() OR NOT EXISTS (
    SELECT 1 FROM public.profiles u WHERE u.id=auth.uid() AND u.organization_id=p_org AND u.status='Active'
    AND u.role IN ('Admin','Super Admin')
  ) THEN RAISE EXCEPTION 'agency_admin_required' USING ERRCODE='42501'; END IF;
  UPDATE private.phone_number_setup_jobs j SET state='pending',next_at=statement_timestamp(),code=NULL
  WHERE j.organization_id=p_org AND j.phone_number_id=p_number AND j.state IN ('retry','review')
    AND (j.lease_until IS NULL OR j.lease_until<=statement_timestamp())
    AND NOT (j.kind='sms' AND coalesce(j.code,'') IN ('voice_only','toll_free'))
    AND EXISTS (SELECT 1 FROM public.phone_numbers n WHERE n.id=j.phone_number_id AND n.organization_id=p_org
      AND n.status IN ('active','Active') AND n.phone_number=j.phone_number
      AND n.twilio_sid=(SELECT p.provider_sid FROM private.phone_number_purchase_operations p WHERE p.id=j.purchase_id));
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION private.enqueue_phone_number_setup(),private.select_purchased_sms_sender(),
  public.phone_number_setup_claim(),public.phone_number_setup_finish(uuid,text,uuid,text,text,integer,text),
  public.phone_number_setup_managed(uuid,text),public.phone_number_setup_legacy_workflow_sender(uuid),
  public.phone_number_setup_status(uuid,uuid[]),public.phone_number_setup_retry(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.phone_number_setup_claim(),public.phone_number_setup_finish(uuid,text,uuid,text,text,integer,text),
  public.phone_number_setup_managed(uuid,text),public.phone_number_setup_legacy_workflow_sender(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_number_setup_status(uuid,uuid[]),public.phone_number_setup_retry(uuid,uuid) TO authenticated;
COMMIT;
