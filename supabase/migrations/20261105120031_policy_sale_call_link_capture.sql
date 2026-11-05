-- Reports V2 PKG-C (D3 §3.6, §2.12): capture of the producing call when a sale is saved. Privilege class W: the only
-- GRANTs are EXECUTE TO authenticated on the two _v2 handoffs, the retry RPC and the status read. Everything else is
-- revoked from PUBLIC, anon, authenticated and service_role.
--
--   private.policy_sale_call_link_failures  one open/closed failure record per sale (no FK; RLS on, no policies)
--   private.capture_policy_sale_call_link   validates, then links in a savepoint under a function-level
--                                           lock_timeout of 100ms; validation never raises; a failure is recorded
--   public.record_client_policy_handoff_v2 / public.convert_lead_to_client_with_sales_handoff_v2
--                                           call the unchanged handoffs, then the capture; the sale result is never
--                                           altered (its errors, keys, hashes and status are the handoffs' own)
--   public.retry_policy_sale_call_link      the seller or an Admin re-runs a recorded failure with the server-recorded
--                                           call, actor, key and sale time
--   public.get_policy_sale_call_link_status status only (linked / open_failure / not_linked) for wins the caller may act on
-- QUERY_CANCELED and ASSERT_FAILURE are never caught: they abort the whole statement, sale included.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $guard$
DECLARE c text;
BEGIN
  IF to_regclass('private.policy_sale_call_links') IS NULL OR to_regprocedure('private.guard_policy_sale_call_link()') IS NULL THEN
    RAISE EXCEPTION 'Sale call link capture: the link table (…30) must be applied first' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('private.policy_sale_call_link_failures') IS NOT NULL
     OR to_regprocedure('private.capture_policy_sale_call_link(text,text,uuid,uuid,uuid[],uuid,uuid,timestamptz)') IS NOT NULL
     OR to_regprocedure('public.record_client_policy_handoff_v2(uuid,uuid,jsonb,boolean,jsonb,uuid)') IS NOT NULL
     OR to_regprocedure('public.convert_lead_to_client_with_sales_handoff_v2(uuid,uuid,uuid,jsonb,uuid,jsonb,uuid)') IS NOT NULL
     OR to_regprocedure('public.retry_policy_sale_call_link(uuid)') IS NOT NULL
     OR to_regprocedure('public.get_policy_sale_call_link_status(uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'Sale call link capture: refusing replay' USING ERRCODE = 'P0001';
  END IF;
  -- The two pinned handoffs, exactly as live (any change, including one from draft PR #486, refuses).
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.record_client_policy_handoff(uuid,uuid,jsonb,boolean,jsonb)')
                   AND md5(pg_get_functiondef(oid)) = 'b02760be55132f0be3fa91b04955e839' AND md5(prosrc) = 'd39e03a7dd2cf122a68dc0fefcbfb44a')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.convert_lead_to_client_with_sales_handoff(uuid,uuid,uuid,jsonb,uuid,jsonb)')
                   AND md5(pg_get_functiondef(oid)) = 'f331226b398134ea485d5543472d5ccf' AND md5(prosrc) = '4d6803ff7d94b7735e3f1b3baf18456c') THEN
    RAISE EXCEPTION 'Sale call link capture: sale handoff preimage drift' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('private.campaign_actor()') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Sale call link capture: dependency function missing' USING ERRCODE = 'P0001';
  END IF;
  FOR c IN SELECT * FROM unnest(ARRAY['public.calls.agent_id', 'public.calls.contact_id', 'public.calls.lead_id',
      'public.calls.campaign_lead_id', 'public.calls.voicemail_id', 'public.calls.created_at', 'public.campaign_leads.id',
      'public.campaign_leads.lead_id', 'public.wins.idempotency_key', 'public.wins.agent_id']) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = split_part(c, '.', 1)
                    AND table_name = split_part(c, '.', 2) AND column_name = split_part(c, '.', 3)) THEN
      RAISE EXCEPTION 'Sale call link capture: dependency column missing: %', c USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guard$;

CREATE TABLE private.policy_sale_call_link_failures (
  organization_id uuid NOT NULL,
  win_id uuid NOT NULL,
  client_id uuid NOT NULL,
  call_id uuid NOT NULL,
  sale_kind text NOT NULL CHECK (sale_kind IN ('record', 'convert')),
  operation_key text NOT NULL,
  request_id uuid,
  actor_id uuid NOT NULL,
  sale_at timestamptz NOT NULL,
  sqlstate text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  resolved_at timestamptz,
  resolution text,
  PRIMARY KEY (organization_id, win_id),
  CONSTRAINT psclf_resolved CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);
ALTER TABLE private.policy_sale_call_link_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.policy_sale_call_link_failures FROM PUBLIC, anon, authenticated, service_role;

-- Validation returns {status: 'rejected', reason}; it never raises. The link work runs in a savepoint; a failure
-- (including 55P03 from the 100ms lock bound) is recorded per win in a nested block.
CREATE FUNCTION private.capture_policy_sale_call_link(p_kind text, p_operation_key text, p_request_id uuid,
  p_client_id uuid, p_win_ids uuid[], p_source_call_id uuid, p_actor_id uuid, p_sale_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp SET lock_timeout = '100ms' AS $$
DECLARE
  cl public.clients%ROWTYPE; ca public.calls%ROWTYPE; v_dir text; v_win uuid; v_linked integer := 0; v_state text;
  v_existing uuid; v_hash text;
BEGIN
  IF p_source_call_id IS NULL OR p_win_ids IS NULL OR cardinality(p_win_ids) = 0 THEN
    RETURN jsonb_build_object('status', 'rejected', 'recorded', false, 'reason', 'win_mismatch');
  END IF;
  SELECT * INTO cl FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'rejected', 'recorded', false, 'reason', 'identity_mismatch'); END IF;
  SELECT * INTO ca FROM public.calls WHERE id = p_source_call_id AND organization_id = cl.organization_id;
  v_dir := CASE WHEN lower(ca.direction) = 'inbound' THEN 'inbound' WHEN lower(ca.direction) IN ('outbound', 'outgoing') THEN 'outbound' END;
  IF ca.id IS NULL OR v_dir IS NULL THEN RETURN jsonb_build_object('status', 'rejected', 'recorded', false, 'reason', 'call_not_found'); END IF;
  IF ca.agent_id IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('status', 'rejected', 'recorded', false, 'reason', 'call_not_actor');
  END IF;
  IF v_dir = 'inbound' AND ca.voicemail_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'recorded', false, 'reason', 'call_voicemail');
  END IF;
  IF ca.created_at IS NULL OR ca.created_at > p_sale_at OR ca.created_at < p_sale_at - interval '24 hours' THEN
    RETURN jsonb_build_object('status', 'rejected', 'recorded', false, 'reason', 'call_too_old');
  END IF;
  -- The call identity is the buyer: the client itself, or the lead the client was converted from (as the call's
  -- contact, its lead pointer, or the lead of its campaign membership).
  IF NOT (ca.contact_id = cl.id OR (cl.lead_id IS NOT NULL AND (ca.contact_id = cl.lead_id OR ca.lead_id = cl.lead_id
          OR EXISTS (SELECT 1 FROM public.campaign_leads m WHERE m.id = ca.campaign_lead_id
                      AND m.organization_id = cl.organization_id AND m.lead_id = cl.lead_id)))) THEN
    RETURN jsonb_build_object('status', 'rejected', 'recorded', false, 'reason', 'identity_mismatch');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_win_ids) x(id)
              WHERE NOT EXISTS (SELECT 1 FROM public.wins w WHERE w.id = x.id AND w.organization_id = cl.organization_id
                                  AND w.contact_id = cl.id AND w.policy_id IS NOT NULL
                                  AND (w.idempotency_key = p_operation_key
                                       OR (left(w.idempotency_key, length(p_operation_key) + 8) = p_operation_key || ':policy:'
                                           AND substr(w.idempotency_key, length(p_operation_key) + 9) ~ '^[0-9]+$')))) THEN
    RETURN jsonb_build_object('status', 'rejected', 'recorded', false, 'reason', 'win_mismatch');
  END IF;
  SELECT l.call_id INTO v_existing FROM private.policy_sale_call_links l
   WHERE l.organization_id = cl.organization_id AND l.win_id = ANY (p_win_ids) AND l.call_id <> p_source_call_id LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('status', 'rejected', 'recorded', false, 'reason', 'existing_link_differs'); END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_array(p_kind, p_operation_key, p_client_id, p_source_call_id, p_actor_id)::text, 'UTF8')), 'hex');
  BEGIN
    FOREACH v_win IN ARRAY p_win_ids LOOP
      INSERT INTO private.policy_sale_call_links (organization_id, win_id, policy_id, client_id, call_id, call_direction,
        link_source, sale_kind, operation_key, request_id, actor_id, evidence_hash)
      SELECT w.organization_id, w.id, w.policy_id, w.contact_id, p_source_call_id, v_dir, 'sale_entry', p_kind,
             p_operation_key, p_request_id, p_actor_id, v_hash
        FROM public.wins w WHERE w.id = v_win
      ON CONFLICT (win_id) DO NOTHING;
      IF FOUND THEN v_linked := v_linked + 1; END IF;
    END LOOP;
    UPDATE private.policy_sale_call_link_failures SET resolved_at = clock_timestamp(), resolution = 'linked'
     WHERE organization_id = cl.organization_id AND win_id = ANY (p_win_ids) AND resolved_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  IF v_state IS NULL THEN
    RETURN jsonb_build_object('status', CASE WHEN v_linked > 0 THEN 'linked' ELSE 'already_linked' END, 'recorded', true);
  END IF;
  BEGIN
    INSERT INTO private.policy_sale_call_link_failures AS f (organization_id, win_id, client_id, call_id, sale_kind,
      operation_key, request_id, actor_id, sale_at, sqlstate)
    SELECT cl.organization_id, x.id, cl.id, p_source_call_id, p_kind, p_operation_key, p_request_id, p_actor_id, p_sale_at, v_state
      FROM unnest(p_win_ids) x(id)
    ON CONFLICT (organization_id, win_id) DO UPDATE
      SET attempts = f.attempts + 1, sqlstate = EXCLUDED.sqlstate, failed_at = clock_timestamp(), resolved_at = NULL, resolution = NULL;
    RETURN jsonb_build_object('status', 'capture_failed', 'recorded', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Sale call link capture failed and could not be recorded (%, %)', v_state, SQLSTATE;
    RETURN jsonb_build_object('status', 'capture_failed', 'recorded', false);
  END;
END $$;
REVOKE ALL ON FUNCTION private.capture_policy_sale_call_link(text, text, uuid, uuid, uuid[], uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- The wrappers delegate to the unchanged handoffs (their errors, e.g. PT409, propagate unchanged), then capture.
CREATE FUNCTION public.record_client_policy_handoff_v2(p_request_id uuid, p_client_id uuid, p_policy jsonb,
  p_primary boolean DEFAULT false, p_commission jsonb DEFAULT NULL, p_source_call_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_sale jsonb; v_link jsonb;
BEGIN
  v_sale := public.record_client_policy_handoff(p_request_id, p_client_id, p_policy, p_primary, p_commission);
  IF p_source_call_id IS NULL THEN
    v_link := jsonb_build_object('status', 'not_requested', 'recorded', false);
  ELSE
    BEGIN
      v_link := private.capture_policy_sale_call_link('record', 'policy:' || p_request_id, p_request_id,
        (v_sale ->> 'client_id')::uuid,
        ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(coalesce(v_sale -> 'win_ids', '[]'::jsonb)) x),
        p_source_call_id, auth.uid(), now());
    EXCEPTION WHEN OTHERS THEN
      v_link := jsonb_build_object('status', 'capture_failed', 'recorded', false);
    END;
  END IF;
  RETURN v_sale || jsonb_build_object('source_call_link', v_link);
END $$;

CREATE FUNCTION public.convert_lead_to_client_with_sales_handoff_v2(p_request_id uuid, p_lead_id uuid, p_expected_org uuid,
  p_client jsonb, p_campaign_id uuid DEFAULT NULL, p_commission jsonb DEFAULT NULL, p_source_call_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_sale jsonb; v_link jsonb;
BEGIN
  v_sale := public.convert_lead_to_client_with_sales_handoff(p_request_id, p_lead_id, p_expected_org, p_client, p_campaign_id, p_commission);
  IF p_source_call_id IS NULL THEN
    v_link := jsonb_build_object('status', 'not_requested', 'recorded', false);
  ELSE
    BEGIN
      v_link := private.capture_policy_sale_call_link('convert', 'conversion:' || p_lead_id, p_request_id,
        (v_sale ->> 'client_id')::uuid,
        ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(coalesce(v_sale -> 'win_ids', '[]'::jsonb)) x),
        p_source_call_id, auth.uid(), now());
    EXCEPTION WHEN OTHERS THEN
      v_link := jsonb_build_object('status', 'capture_failed', 'recorded', false);
    END;
  END IF;
  RETURN v_sale || jsonb_build_object('source_call_link', v_link);
END $$;

-- Re-runs a recorded failure as at the sale (recorded call, actor, key and sale time). Seller or Admin only.
CREATE FUNCTION public.retry_policy_sale_call_link(p_win_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; w public.wins%ROWTYPE; f private.policy_sale_call_link_failures%ROWTYPE; v jsonb;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  SELECT * INTO w FROM public.wins WHERE id = p_win_id AND organization_id = a.org_id;
  IF NOT FOUND OR NOT coalesce(w.agent_id = a.uid OR a.actor_role IN ('Admin', 'Super Admin') OR a.is_super, false) THEN
    RAISE EXCEPTION 'Not allowed to retry this call link' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM private.policy_sale_call_link_failures
   WHERE organization_id = a.org_id AND win_id = p_win_id AND resolved_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', CASE WHEN EXISTS (SELECT 1 FROM private.policy_sale_call_links l
      WHERE l.organization_id = a.org_id AND l.win_id = p_win_id) THEN 'already_linked' ELSE 'no_open_failure' END);
  END IF;
  v := private.capture_policy_sale_call_link(f.sale_kind, f.operation_key, f.request_id, f.client_id, ARRAY[p_win_id],
    f.call_id, f.actor_id, f.sale_at);
  IF v ->> 'status' = 'rejected' THEN
    UPDATE private.policy_sale_call_link_failures SET resolved_at = clock_timestamp(), resolution = 'rejected:' || (v ->> 'reason')
     WHERE organization_id = a.org_id AND win_id = p_win_id AND resolved_at IS NULL;
  END IF;
  RETURN v - 'recorded' || jsonb_build_object('recorded', coalesce((v ->> 'recorded')::boolean, false));
END $$;

-- Status only (RL-21): no call id, number, time, SQLSTATE or attempt count.
CREATE FUNCTION public.get_policy_sale_call_link_status(p_win_ids uuid[])
RETURNS TABLE (win_id uuid, status text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; v_admin boolean;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  v_admin := coalesce(a.actor_role IN ('Admin', 'Super Admin') OR a.is_super, false);
  RETURN QUERY
    SELECT w.id,
           CASE WHEN EXISTS (SELECT 1 FROM private.policy_sale_call_links l WHERE l.organization_id = w.organization_id AND l.win_id = w.id)
                  THEN 'linked'
                WHEN EXISTS (SELECT 1 FROM private.policy_sale_call_link_failures f WHERE f.organization_id = w.organization_id
                               AND f.win_id = w.id AND f.resolved_at IS NULL) THEN 'open_failure'
                ELSE 'not_linked' END
      FROM public.wins w
     WHERE w.id = ANY (coalesce(p_win_ids, '{}'::uuid[])) AND w.organization_id = a.org_id
       AND (v_admin OR w.agent_id = a.uid)
     ORDER BY w.id;
END $$;

REVOKE ALL ON FUNCTION public.record_client_policy_handoff_v2(uuid, uuid, jsonb, boolean, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.convert_lead_to_client_with_sales_handoff_v2(uuid, uuid, uuid, jsonb, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retry_policy_sale_call_link(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_policy_sale_call_link_status(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_client_policy_handoff_v2(uuid,uuid,jsonb,boolean,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_client_with_sales_handoff_v2(uuid,uuid,uuid,jsonb,uuid,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_policy_sale_call_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_policy_sale_call_link_status(uuid[]) TO authenticated;

DO $acl$
DECLARE f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.record_client_policy_handoff_v2(uuid,uuid,jsonb,boolean,jsonb,uuid)'::regprocedure,
                           'public.convert_lead_to_client_with_sales_handoff_v2(uuid,uuid,uuid,jsonb,uuid,jsonb,uuid)'::regprocedure,
                           'public.retry_policy_sale_call_link(uuid)'::regprocedure,
                           'public.get_policy_sale_call_link_status(uuid[])'::regprocedure] LOOP
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('service_role', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f AND x.grantee <> p.proowner AND x.grantee <> 'authenticated'::regrole) THEN
      RAISE EXCEPTION 'Sale call link capture: % ACL is not authenticated-only', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'private.capture_policy_sale_call_link(text,text,uuid,uuid,uuid[],uuid,uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Sale call link capture: the helper must stay sealed' USING ERRCODE = 'P0001';
  END IF;
END $acl$;
