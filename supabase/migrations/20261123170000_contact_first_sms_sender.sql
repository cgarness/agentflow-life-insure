-- New manual Full Contact View requests only. Existing clients, tables and RPCs keep their contracts.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION private.require_first_contact_sms_mode(p_org uuid) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Hold the enrollment decision through the reservation or final handoff transaction.
  PERFORM 1 FROM private.contact_number_settings WHERE organization_id = p_org FOR SHARE;
  IF private.affinity_mode(p_org, 'sms') IS DISTINCT FROM 'enforced'
     OR private.affinity_mode(p_org, 'voice') = 'guard_only' THEN
    RAISE EXCEPTION 'affinity_first_contact_changed';
  END IF;
END $$;

CREATE FUNCTION public.sms_prepare_first_contact_dispatch(
  p_org uuid, p_key text, p_phone text, p_from text, p_body text, p_purpose text,
  p_hash text, p_evidence uuid[], p_actor uuid, p_contact uuid, p_type text,
  p_confirmation uuid, p_expected uuid, p_generation bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  prior_claims text;
  intent jsonb;
  prepared jsonb;
  dispatch public.sms_dispatches;
  assignment private.contact_number_affinities;
  sender_number text;
BEGIN
  IF p_purpose IS DISTINCT FROM 'manual' OR p_actor IS NULL OR p_contact IS NULL
     OR p_type IS NULL OR p_type NOT IN ('lead', 'client', 'recruit')
     OR p_confirmation IS NOT NULL OR p_evidence IS NULL OR cardinality(p_evidence) <> 0
     OR p_expected IS NULL OR p_generation IS NULL OR p_generation < 0 OR p_hash IS NULL
     OR p_key IS NULL OR p_key !~ ('^manual:' || p_actor::text ||
       ':[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN
    RAISE EXCEPTION 'sms_manual_scope' USING ERRCODE = '22023';
  END IF;
  p_phone := private.affinity_phone(p_phone);
  p_from := private.affinity_phone(p_from);
  prior_claims := private.affinity_actor_claims(p_org, p_actor);
  PERFORM private.affinity_assert_contact(p_org, p_contact, p_type, p_phone);
  PERFORM set_config('request.jwt.claims', coalesce(prior_claims, ''), true);

  PERFORM private.affinity_lock(p_org, p_phone);
  intent := jsonb_build_array('first_contact', p_phone, p_from, p_body, p_actor, p_contact,
                             p_type, p_expected, p_generation);
  SELECT * INTO dispatch FROM public.sms_dispatches
   WHERE organization_id = p_org AND request_key = p_key FOR UPDATE;
  IF FOUND THEN
    IF dispatch.affinity_role IS DISTINCT FROM 'first_contact'
       OR dispatch.affinity_intent IS DISTINCT FROM intent THEN
      RAISE EXCEPTION 'sms_request_conflict' USING ERRCODE = '22023';
    END IF;
    -- Immutable receipts remain readable after an assignment, policy, or mode change.
    RETURN to_jsonb(dispatch);
  END IF;

  PERFORM private.require_first_contact_sms_mode(p_org);
  PERFORM private.affinity_ensure(p_org, p_phone);
  IF NOT private.affinity_recover(p_org, p_phone, 20) THEN
    RETURN jsonb_build_object('blocked', 'affinity_evidence_pending');
  END IF;
  SELECT * INTO STRICT assignment FROM private.contact_number_affinities
   WHERE organization_id = p_org AND phone_e164 = p_phone FOR UPDATE;
  IF assignment.generation <> p_generation OR assignment.history_state NOT IN ('new', 'reconciled')
     OR assignment.voice_state <> 'unassigned' OR assignment.sms_state <> 'unassigned'
     OR private.affinity_unresolved(p_org, p_phone) THEN
    RAISE EXCEPTION 'affinity_first_contact_changed';
  END IF;

  SELECT phone_number INTO sender_number FROM public.phone_numbers
   WHERE organization_id = p_org AND id = p_expected AND assignment_type = 'agency'
   FOR SHARE;
  IF sender_number IS DISTINCT FROM p_from
     OR (private.affinity_number(p_org, p_expected, 'sms', p_actor, false)->>'readiness') IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'affinity_sender_unready';
  END IF;

  -- Reuse the production manual consent/suppression and idempotent insert. Its v1 hash
  -- and the v2 affinity intent must each distinguish this send from an old client.
  prepared := private.affinity_prepare_original(p_org, p_key, p_phone, sender_number,
    p_body, p_purpose, 'first_contact:' || p_hash, p_evidence, p_actor, p_contact, p_type, p_confirmation);
  -- The ledger key is organization-wide, whereas contact locks serialize each phone. A
  -- contending request using the same key for another recipient must never rebind its row.
  IF prepared->>'phone_e164' IS DISTINCT FROM p_phone
     OR prepared->>'from_number' IS DISTINCT FROM sender_number OR prepared->>'body' IS DISTINCT FROM p_body
     OR prepared->>'actor_id' IS DISTINCT FROM p_actor::text OR prepared->>'contact_id' IS DISTINCT FROM p_contact::text
     OR prepared->>'contact_type' IS DISTINCT FROM p_type OR prepared->>'affinity_role' IS NOT NULL THEN
    RAISE EXCEPTION 'sms_request_conflict' USING ERRCODE = '22023';
  END IF;
  UPDATE private.contact_number_affinities
     SET sms_number_id = p_expected, sms_number = sender_number, sms_state = 'reserved',
         sms_version = sms_version + 1, sms_source = 'first_contact', sms_event = p_key,
         updated_at = clock_timestamp()
   WHERE organization_id = p_org AND phone_e164 = p_phone RETURNING * INTO STRICT assignment;
  PERFORM private.affinity_event(p_org, p_phone, 'sms', 'reserved', p_actor, p_expected, sender_number, p_key);
  UPDATE public.sms_dispatches
     SET affinity_intent = intent, affinity_actor_id = p_actor, affinity_contact_id = p_contact,
         affinity_contact_type = p_type, affinity_number_id = p_expected, affinity_generation = p_generation,
         affinity_version = assignment.sms_version, affinity_role = 'first_contact', affinity_override = false,
         affinity_account_sid = (SELECT account_sid FROM public.a2p_accounts WHERE organization_id = p_org),
         affinity_service_sid = (SELECT messaging_service_sid FROM public.a2p_registrations WHERE organization_id = p_org)
   WHERE organization_id = p_org AND request_key = p_key RETURNING * INTO STRICT dispatch;
  RETURN to_jsonb(dispatch);
END $$;

CREATE FUNCTION public.sms_start_first_contact_dispatch(p_org uuid, p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target_phone text;
  dispatch public.sms_dispatches;
BEGIN
  SELECT phone_e164 INTO STRICT target_phone FROM public.sms_dispatches
   WHERE organization_id = p_org AND request_key = p_key;
  PERFORM private.affinity_lock(p_org, target_phone);
  SELECT * INTO STRICT dispatch FROM public.sms_dispatches
   WHERE organization_id = p_org AND request_key = p_key FOR UPDATE;
  IF dispatch.affinity_role IS DISTINCT FROM 'first_contact' THEN
    RAISE EXCEPTION 'sms_request_conflict' USING ERRCODE = '22023';
  END IF;
  IF dispatch.state <> 'prepared' THEN RETURN false; END IF;
  PERFORM private.require_first_contact_sms_mode(p_org);
  -- The older dispatcher accepts historical agency rows with a null role. First-contact
  -- founding requires a strictly agency-owned sender even if ownership changed after prepare.
  PERFORM 1 FROM public.phone_numbers
   WHERE organization_id = p_org AND id = dispatch.affinity_number_id
     AND phone_number = dispatch.from_number AND assignment_type = 'agency' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'affinity_sender_unready'; END IF;
  -- Revalidate scope, number, local suppression and account binding, then use the original CAS.
  RETURN public.sms_start_dispatch(p_org, p_key);
END $$;

-- An authenticated provider receipt can exist before local message persistence succeeds.
-- A later ambiguous or contradictory report cannot erase that evidence, replace its SID,
-- or make this dispatch eligible for cancellation/release.
CREATE FUNCTION private.preserve_first_contact_sms_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.affinity_role = 'first_contact' OR EXISTS (
    SELECT 1 FROM private.contact_number_affinities
     WHERE organization_id = OLD.organization_id AND phone_e164 = OLD.phone_e164
       AND sms_source = 'first_contact' AND sms_state = 'reserved'
       AND sms_number_id = OLD.affinity_number_id AND generation = OLD.affinity_generation
       AND sms_version = OLD.affinity_version
  ) THEN
    RAISE EXCEPTION 'affinity_first_receipt_conflict' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER preserve_first_contact_sms_receipt
BEFORE UPDATE OF state, provider_sid, provider_status ON public.sms_dispatches FOR EACH ROW
WHEN (OLD.state = 'uncertain' AND OLD.provider_sid IS NOT NULL
      AND OLD.affinity_role IN ('first_contact', 'customer') AND NOT OLD.affinity_override
      AND (NEW.state NOT IN ('uncertain', 'accepted') OR NEW.provider_sid IS DISTINCT FROM OLD.provider_sid
           OR (OLD.provider_status IS NOT NULL AND NEW.provider_status IS NULL)))
EXECUTE FUNCTION private.preserve_first_contact_sms_receipt();

-- An ordinary send may have reused a pending first-contact reservation. Remove it only
-- after the last dependent send has definitely failed and no acceptance evidence exists.
CREATE FUNCTION private.release_failed_first_contact_sms() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  assignment private.contact_number_affinities;
BEGIN
  PERFORM private.affinity_lock(NEW.organization_id, NEW.phone_e164);
  SELECT * INTO assignment FROM private.contact_number_affinities
   WHERE organization_id = NEW.organization_id AND phone_e164 = NEW.phone_e164
     AND sms_source = 'first_contact' AND sms_state = 'reserved'
     AND sms_number_id = NEW.affinity_number_id AND generation = NEW.affinity_generation
     AND sms_version = NEW.affinity_version FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.sms_dispatches
     WHERE organization_id = NEW.organization_id AND phone_e164 = NEW.phone_e164
       AND affinity_generation = assignment.generation AND affinity_version = assignment.sms_version
       AND affinity_number_id = assignment.sms_number_id AND NOT affinity_override
       AND (state <> 'failed' OR provider_sid IS NOT NULL)
  ) THEN RETURN NULL; END IF;
  UPDATE private.contact_number_affinities
     SET sms_number_id = NULL, sms_number = NULL, sms_state = 'unassigned',
         sms_version = sms_version + 1, sms_source = NULL, sms_event = NULL, updated_at = clock_timestamp()
   WHERE organization_id = NEW.organization_id AND phone_e164 = NEW.phone_e164;
  PERFORM private.affinity_event(NEW.organization_id, NEW.phone_e164, 'sms', 'reservation_released',
    NEW.actor_id, assignment.sms_number_id, assignment.sms_number, assignment.sms_event);
  RETURN NULL;
END $$;

CREATE TRIGGER release_failed_first_contact_sms
AFTER UPDATE OF state ON public.sms_dispatches FOR EACH ROW
WHEN (NEW.state = 'failed' AND OLD.state <> 'failed' AND OLD.provider_sid IS NULL AND NEW.provider_sid IS NULL
      AND NEW.affinity_role IN ('first_contact', 'customer') AND NOT NEW.affinity_override)
EXECUTE FUNCTION private.release_failed_first_contact_sms();

REVOKE ALL ON FUNCTION private.require_first_contact_sms_mode(uuid),
  private.preserve_first_contact_sms_receipt(),
  private.release_failed_first_contact_sms(),
  public.sms_prepare_first_contact_dispatch(uuid,text,text,text,text,text,text,uuid[],uuid,uuid,text,uuid,uuid,bigint),
  public.sms_start_first_contact_dispatch(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sms_prepare_first_contact_dispatch(uuid,text,text,text,text,text,text,uuid[],uuid,uuid,text,uuid,uuid,bigint),
  public.sms_start_first_contact_dispatch(uuid,text) TO service_role;
