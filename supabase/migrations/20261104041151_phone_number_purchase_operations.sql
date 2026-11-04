-- PENDING: exact release authorization is required before applying to a hosted database.
-- Server-only purchase receipts. No existing phone row, schema, policy or Inbounds RPC changes.
BEGIN;

CREATE TABLE private.phone_number_purchase_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  -- Historical actor/phone IDs deliberately survive profile changes and number release.
  actor_id uuid NOT NULL,
  account_sid text NOT NULL CHECK (account_sid ~ '^AC[0-9a-fA-F]{32}$'),
  phone_number text NOT NULL CHECK (phone_number ~ '^\+1[2-9][0-9]{9}$'),
  number_type text NOT NULL CHECK (number_type IN ('local', 'toll_free')),
  friendly_name text NOT NULL CHECK (length(friendly_name) BETWEEN 1 AND 64),
  quote jsonb NOT NULL CHECK (
    jsonb_typeof(quote) = 'object'
    AND quote ?& ARRAY['monthly_price', 'inbound_per_minute', 'currency']
    AND jsonb_typeof(quote->'monthly_price') = 'string'
    AND jsonb_typeof(quote->'inbound_per_minute') = 'string'
    AND jsonb_typeof(quote->'currency') = 'string'
    AND quote->>'monthly_price' ~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$'
    AND quote->>'inbound_per_minute' ~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$'
    AND quote->>'currency' ~ '^[A-Z]{3}$'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'quoted' CHECK (state IN (
    'quoted', 'purchasing', 'purchased_pending_save', 'completed',
    'failed_before_purchase', 'needs_review'
  )),
  request_id uuid,
  attempted_at timestamptz,
  provider_sid text CHECK (provider_sid ~ '^PN[0-9a-fA-F]{32}$'),
  receipt_recorded_at timestamptz,
  phone_number_id uuid,
  completed_at timestamptz,
  error_code text,
  CONSTRAINT phone_purchase_number_type CHECK (
    (number_type = 'toll_free' AND phone_number ~ '^\+1(800|888)[0-9]{7}$')
    OR (number_type = 'local' AND phone_number !~ '^\+1(800|888|877|866|855|844|833)[0-9]{7}$')
  ),
  CONSTRAINT phone_purchase_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  CONSTRAINT phone_purchase_state_fields CHECK (
    (state = 'quoted' AND request_id IS NULL AND attempted_at IS NULL AND provider_sid IS NULL AND phone_number_id IS NULL)
    OR (state = 'failed_before_purchase' AND request_id IS NOT NULL AND attempted_at IS NULL AND provider_sid IS NULL AND phone_number_id IS NULL)
    OR (state IN ('purchasing', 'needs_review') AND request_id IS NOT NULL AND attempted_at IS NOT NULL AND provider_sid IS NULL AND phone_number_id IS NULL)
    OR (state = 'purchased_pending_save' AND request_id IS NOT NULL AND attempted_at IS NOT NULL AND provider_sid IS NOT NULL AND receipt_recorded_at IS NOT NULL AND phone_number_id IS NULL)
    OR (state = 'completed' AND request_id IS NOT NULL AND attempted_at IS NOT NULL AND provider_sid IS NOT NULL AND receipt_recorded_at IS NOT NULL AND phone_number_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX phone_purchase_request_unique
  ON private.phone_number_purchase_operations (organization_id, request_id)
  WHERE request_id IS NOT NULL;
-- An attempt never expires, even when its provider outcome is unknown or the DID is later released.
CREATE UNIQUE INDEX phone_purchase_attempt_unique
  ON private.phone_number_purchase_operations (lower(account_sid), phone_number)
  WHERE attempted_at IS NOT NULL;
CREATE UNIQUE INDEX phone_purchase_provider_unique
  ON private.phone_number_purchase_operations (lower(provider_sid))
  WHERE provider_sid IS NOT NULL;
CREATE INDEX phone_purchase_org_actor_created
  ON private.phone_number_purchase_operations (organization_id, actor_id, created_at DESC);

ALTER TABLE private.phone_number_purchase_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.phone_number_purchase_operations FROM PUBLIC, anon, authenticated, service_role;

-- The Edge functions authenticate the user before passing actor/org through their service client.
-- Re-read profile and telephony state here; stale JWT role claims never authorize an attempt.
CREATE FUNCTION private.phone_number_purchase_authorize(p_actor uuid, p_org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_actor IS NULL OR p_org IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_actor AND p.organization_id = p_org AND p.status = 'Active'
      AND p.role IN ('Admin', 'Super Admin')
  ) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = 'PT403';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = p_org AND o.twilio_subaccount_status = 'active'
      AND btrim(o.twilio_subaccount_sid) ~ '^AC[0-9a-fA-F]{32}$'
  ) THEN
    RAISE EXCEPTION 'telephony_unavailable' USING ERRCODE = 'PT403';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.phone_number_purchase_authorize(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.phone_number_purchase_result(p_op private.phone_number_purchase_operations, p_claimed boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'id', p_op.id, 'organization_id', p_op.organization_id, 'actor_id', p_op.actor_id,
    'account_sid', p_op.account_sid, 'phone_number', p_op.phone_number,
    'number_type', p_op.number_type, 'friendly_name', p_op.friendly_name, 'quote', p_op.quote,
    'expires_at', p_op.expires_at, 'state', p_op.state, 'request_id', p_op.request_id,
    'attempted_at', p_op.attempted_at, 'provider_sid', p_op.provider_sid,
    'phone_number_id', p_op.phone_number_id, 'error_code', p_op.error_code, 'claimed', p_claimed,
    'row', CASE WHEN p_op.state = 'completed' THEN (
      SELECT to_jsonb(n) FROM public.phone_numbers n
      WHERE n.id = p_op.phone_number_id AND n.organization_id = p_op.organization_id
        AND n.phone_number = p_op.phone_number AND n.twilio_sid = p_op.provider_sid
    ) ELSE NULL END
  );
$$;
REVOKE ALL ON FUNCTION private.phone_number_purchase_result(private.phone_number_purchase_operations, boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.phone_number_purchase_quote(
  p_actor uuid, p_org uuid, p_account text, p_number text, p_type text,
  p_friendly_name text, p_quote jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_op private.phone_number_purchase_operations;
  v_now timestamptz := clock_timestamp();
  v_name text := coalesce(nullif(btrim(p_friendly_name), ''), p_number);
BEGIN
  PERFORM private.phone_number_purchase_authorize(p_actor, p_org);
  IF p_account IS NULL OR p_account !~ '^AC[0-9a-fA-F]{32}$'
    OR p_number IS NULL OR p_number !~ '^\+1[2-9][0-9]{9}$'
    OR p_type IS NULL OR p_type NOT IN ('local', 'toll_free')
    OR length(v_name) NOT BETWEEN 1 AND 64
    OR (p_type = 'toll_free' AND p_number !~ '^\+1(800|888)[0-9]{7}$')
    OR (p_type = 'local' AND p_number ~ '^\+1(800|888|877|866|855|844|833)[0-9]{7}$') THEN
    RAISE EXCEPTION 'invalid_purchase_input' USING ERRCODE = 'PT400';
  END IF;
  IF p_quote IS NULL OR jsonb_typeof(p_quote) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_quote->'monthly_price') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_quote->'inbound_per_minute') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_quote->'currency') IS DISTINCT FROM 'string'
    OR coalesce(p_quote->>'monthly_price', '') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$'
    OR coalesce(p_quote->>'inbound_per_minute', '') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$'
    OR coalesce(p_quote->>'currency', '') !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'invalid_quote' USING ERRCODE = 'PT400';
  END IF;
  INSERT INTO private.phone_number_purchase_operations (
    organization_id, actor_id, account_sid, phone_number, number_type,
    friendly_name, quote, created_at, expires_at
  ) VALUES (
    p_org, p_actor, p_account, p_number, p_type, v_name,
    jsonb_build_object('monthly_price', p_quote->>'monthly_price', 'currency', p_quote->>'currency',
      'inbound_per_minute', p_quote->>'inbound_per_minute'), v_now, v_now + interval '5 minutes'
  ) RETURNING * INTO v_op;
  RETURN private.phone_number_purchase_result(v_op);
END $$;

CREATE FUNCTION public.phone_number_purchase_get(p_actor uuid, p_org uuid, p_quote uuid, p_request uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_op private.phone_number_purchase_operations;
BEGIN
  PERFORM private.phone_number_purchase_authorize(p_actor, p_org);
  SELECT o.* INTO v_op FROM private.phone_number_purchase_operations o
    WHERE o.id = p_quote AND o.actor_id = p_actor AND o.organization_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'PT404'; END IF;
  IF p_request IS NOT NULL AND v_op.request_id IS NOT NULL AND p_request <> v_op.request_id THEN
    RAISE EXCEPTION 'request_conflict' USING ERRCODE = 'PT409';
  END IF;
  RETURN private.phone_number_purchase_result(v_op);
END $$;

CREATE FUNCTION public.phone_number_purchase_claim(p_actor uuid, p_org uuid, p_quote uuid, p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_op private.phone_number_purchase_operations;
BEGIN
  PERFORM private.phone_number_purchase_authorize(p_actor, p_org);
  IF p_quote IS NULL OR p_request IS NULL THEN
    RAISE EXCEPTION 'invalid_purchase_input' USING ERRCODE = 'PT400';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phone_purchase_request:' || p_org::text || ':' || p_request::text, 0));
  SELECT o.* INTO v_op FROM private.phone_number_purchase_operations o
    WHERE o.id = p_quote AND o.actor_id = p_actor AND o.organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'PT404'; END IF;
  IF (v_op.request_id IS NOT NULL AND v_op.request_id <> p_request) OR EXISTS (
    SELECT 1 FROM private.phone_number_purchase_operations o
    WHERE o.organization_id = p_org AND o.request_id = p_request AND o.id <> v_op.id
  ) THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE = 'PT409'; END IF;
  -- Replays can report progress/recover a known receipt; they can never authorize another POST.
  IF v_op.state <> 'quoted' THEN RETURN private.phone_number_purchase_result(v_op); END IF;
  IF v_op.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'quote_expired' USING ERRCODE = 'PT409'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phone_purchase_number:' || lower(v_op.account_sid) || ':' || v_op.phone_number, 0));
  -- Locks may wait behind another transaction. Recheck current authority and TTL after waiting.
  PERFORM private.phone_number_purchase_authorize(p_actor, p_org);
  IF v_op.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'quote_expired' USING ERRCODE = 'PT409'; END IF;
  IF EXISTS (SELECT 1 FROM public.phone_numbers n WHERE n.phone_number = v_op.phone_number)
    OR EXISTS (
      SELECT 1 FROM private.phone_number_purchase_operations o
      WHERE lower(o.account_sid) = lower(v_op.account_sid) AND o.phone_number = v_op.phone_number
        AND o.attempted_at IS NOT NULL AND o.id <> v_op.id
    ) THEN RAISE EXCEPTION 'number_unavailable' USING ERRCODE = 'PT409'; END IF;
  UPDATE private.phone_number_purchase_operations o
    SET state = 'purchasing', request_id = p_request, attempted_at = clock_timestamp()
    WHERE o.id = v_op.id RETURNING o.* INTO v_op;
  RETURN private.phone_number_purchase_result(v_op, true);
END $$;

CREATE FUNCTION public.phone_number_purchase_record(
  p_actor uuid, p_org uuid, p_quote uuid, p_request uuid,
  p_sid text, p_provider_account text, p_provider_number text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_op private.phone_number_purchase_operations;
BEGIN
  -- A paid receipt belongs to the original immutable operation even after actor revocation/movement.
  SELECT o.* INTO v_op FROM private.phone_number_purchase_operations o
    WHERE o.id = p_quote AND o.actor_id = p_actor AND o.organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'PT404'; END IF;
  IF p_request IS NULL OR v_op.request_id IS DISTINCT FROM p_request THEN
    RAISE EXCEPTION 'request_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_op.attempted_at IS NULL THEN RAISE EXCEPTION 'invalid_operation_state' USING ERRCODE = 'PT409'; END IF;
  IF p_sid IS NULL OR p_sid !~ '^PN[0-9a-fA-F]{32}$'
    OR p_provider_account IS DISTINCT FROM v_op.account_sid
    OR p_provider_number IS DISTINCT FROM v_op.phone_number
    OR (v_op.provider_sid IS NOT NULL AND v_op.provider_sid <> p_sid) THEN
    RAISE EXCEPTION 'receipt_mismatch' USING ERRCODE = 'PT409';
  END IF;
  IF v_op.provider_sid IS NOT NULL THEN RETURN private.phone_number_purchase_result(v_op); END IF;
  BEGIN
    UPDATE private.phone_number_purchase_operations o
      SET state = 'purchased_pending_save', provider_sid = p_sid,
        receipt_recorded_at = clock_timestamp(), error_code = NULL
      WHERE o.id = v_op.id RETURNING o.* INTO v_op;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'receipt_conflict' USING ERRCODE = 'PT409';
  END;
  RETURN private.phone_number_purchase_result(v_op);
END $$;

CREATE FUNCTION public.phone_number_purchase_review(p_actor uuid, p_org uuid, p_quote uuid, p_request uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_op private.phone_number_purchase_operations;
BEGIN
  IF p_request IS NULL THEN RAISE EXCEPTION 'invalid_purchase_input' USING ERRCODE = 'PT400'; END IF;
  IF p_code IS NULL OR p_code NOT IN (
    'QUOTE_EXPIRED', 'ACCOUNT_CHANGED', 'NUMBER_UNAVAILABLE', 'PRICE_CHANGED', 'PRECHECK_FAILED',
    'PURCHASE_OUTCOME_UNKNOWN', 'PROVIDER_RECEIPT_MISMATCH', 'RECEIPT_NOT_RECORDED', 'RECEIPT_VERIFICATION_FAILED'
  ) THEN RAISE EXCEPTION 'invalid_review_code' USING ERRCODE = 'PT400'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phone_purchase_request:' || p_org::text || ':' || p_request::text, 0));
  SELECT o.* INTO v_op FROM private.phone_number_purchase_operations o
    WHERE o.id = p_quote AND o.actor_id = p_actor AND o.organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'PT404'; END IF;
  IF (v_op.request_id IS NOT NULL AND v_op.request_id <> p_request) OR EXISTS (
    SELECT 1 FROM private.phone_number_purchase_operations o
    WHERE o.organization_id = p_org AND o.request_id = p_request AND o.id <> v_op.id
  ) THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE = 'PT409'; END IF;
  -- A later error cannot erase a known provider receipt or a completed purchase.
  IF v_op.state IN ('purchased_pending_save', 'completed', 'failed_before_purchase') THEN
    RETURN private.phone_number_purchase_result(v_op);
  END IF;
  UPDATE private.phone_number_purchase_operations o
    SET state = CASE WHEN v_op.attempted_at IS NULL THEN 'failed_before_purchase' ELSE 'needs_review' END,
      request_id = p_request, error_code = p_code
    WHERE o.id = v_op.id RETURNING o.* INTO v_op;
  RETURN private.phone_number_purchase_result(v_op);
END $$;

CREATE FUNCTION public.phone_number_purchase_complete(p_actor uuid, p_org uuid, p_quote uuid, p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_op private.phone_number_purchase_operations; v_phone_id uuid;
BEGIN
  -- Service-only finalization cannot reassign the charged resource to the actor's later organization.
  SELECT o.* INTO v_op FROM private.phone_number_purchase_operations o
    WHERE o.id = p_quote AND o.actor_id = p_actor AND o.organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'operation_not_found' USING ERRCODE = 'PT404'; END IF;
  IF p_request IS NULL OR v_op.request_id IS DISTINCT FROM p_request THEN
    RAISE EXCEPTION 'request_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_op.state = 'completed' THEN RETURN private.phone_number_purchase_result(v_op); END IF;
  IF v_op.state <> 'purchased_pending_save' OR v_op.provider_sid IS NULL THEN
    RAISE EXCEPTION 'invalid_operation_state' USING ERRCODE = 'PT409';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phone_purchase_number:' || lower(v_op.account_sid) || ':' || v_op.phone_number, 0));
  IF EXISTS (
    SELECT 1 FROM public.phone_numbers n
    WHERE n.phone_number = v_op.phone_number OR lower(n.twilio_sid) = lower(v_op.provider_sid)
  ) THEN RAISE EXCEPTION 'number_unavailable' USING ERRCODE = 'PT409'; END IF;
  BEGIN
    INSERT INTO public.phone_numbers (
      organization_id, phone_number, twilio_sid, friendly_name, area_code,
      assignment_type, assigned_to, is_default, is_direct_line, inbounds_only, status, trust_hub_status
    ) VALUES (
      v_op.organization_id, v_op.phone_number, v_op.provider_sid, v_op.friendly_name,
      substring(v_op.phone_number FROM 3 FOR 3), 'agency', NULL, false, false, false, 'active', 'pending'
    ) RETURNING id INTO v_phone_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'number_unavailable' USING ERRCODE = 'PT409';
  END;
  UPDATE private.phone_number_purchase_operations o
    SET state = 'completed', phone_number_id = v_phone_id, completed_at = clock_timestamp(), error_code = NULL
    WHERE o.id = v_op.id RETURNING o.* INTO v_op;
  RETURN private.phone_number_purchase_result(v_op);
END $$;

-- Restrict each new RPC explicitly; do not alter schema-wide defaults or existing grants.
REVOKE ALL ON FUNCTION public.phone_number_purchase_quote(uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phone_number_purchase_get(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phone_number_purchase_claim(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phone_number_purchase_record(uuid, uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phone_number_purchase_review(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phone_number_purchase_complete(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.phone_number_purchase_quote(uuid, uuid, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_number_purchase_get(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_number_purchase_claim(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_number_purchase_record(uuid, uuid, uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_number_purchase_review(uuid, uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_number_purchase_complete(uuid, uuid, uuid, uuid) TO service_role;

COMMIT;
