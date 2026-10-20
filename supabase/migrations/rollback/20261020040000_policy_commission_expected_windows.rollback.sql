-- Rollback for 20261020040000_policy_commission_expected_windows.sql (Phase 2A §13.7 expected windows).
-- Non-destructive only: refuses once any estimate or payment uses what this migration added (an assumed start, a saved
-- frequency or convention, a window, an automatic Advance date or a manual "Date needed"), so it can never discard or
-- reinterpret a saved schedule. Restores the 20261019170000 definitions exactly (checked by md5 below), the original
-- timing check, grants and guard. 20261019170000 itself stays applied.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE v_rows bigint;
BEGIN
  IF to_regclass('public.policy_commission_installments') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.policy_commission_installments'::regclass
                      AND attname = 'expected_until' AND NOT attisdropped)
     OR to_regprocedure('private.policy_commission_expected_schedule(date,text)') IS NULL THEN
    RAISE EXCEPTION 'policy commission expected windows is not installed; refusing replay';
  END IF;
  -- Lock first so no commission write can commit between this check and the change.
  LOCK TABLE public.policy_commission_estimates, public.policy_commission_installments IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO v_rows FROM public.policy_commission_estimates
   WHERE schedule_assumed OR schedule_frequency IS NOT NULL OR schedule_convention IS NOT NULL;
  SELECT v_rows + count(*) INTO v_rows FROM public.policy_commission_installments
   WHERE expected_until IS NOT NULL OR (timing_source = 'manual' AND timing_precision = 'unknown')
      OR (timing_source = 'schedule_basis' AND kind = 'advance');
  IF v_rows > 0 THEN
    RAISE EXCEPTION '% commission row(s) use expected windows or the new date fields; refusing to discard them', v_rows;
  END IF;
END $guard$;

-- Restore the 20261019170000 definitions (postgres-owned first).

CREATE OR REPLACE FUNCTION private.policy_commission_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_mutable text[];
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Commission records are retained; use a void, replacement or hold' USING ERRCODE = '23514';
  END IF;
  IF current_user <> 'agentflow_policy_commission_writer' THEN
    RAISE EXCEPTION 'Commission records change only through AgentFlow commission functions' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  v_mutable := CASE TG_TABLE_NAME
    WHEN 'policy_commission_captures' THEN ARRAY['status', 'attention_code', 'status_reason', 'status_by', 'status_at',
      'resolved_by_estimate_id']
    WHEN 'policy_commission_estimates' THEN ARRAY['status', 'status_reason', 'status_by', 'status_at', 'superseded_by',
      'schedule_start_on', 'schedule_start_source', 'schedule_set_by', 'schedule_set_at', 'state_revision']
    WHEN 'policy_commission_installments' THEN ARRAY['timing_precision', 'expected_on', 'timing_source', 'timing_set_by', 'timing_set_at']
    WHEN 'policy_commission_receipts' THEN ARRAY['voided_at', 'voided_by', 'void_reason']
    ELSE ARRAY[]::text[] END;
  IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
    RAISE EXCEPTION '% rows are immutable apart from their audited state', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  -- Field access goes through jsonb: one trigger function serves tables with different columns.
  IF TG_TABLE_NAME = 'policy_commission_captures' AND to_jsonb(OLD)->>'status' IN ('recorded', 'dismissed', 'superseded') THEN
    RAISE EXCEPTION 'A recorded, dismissed or superseded capture is final' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'policy_commission_receipts' AND to_jsonb(OLD)->>'voided_at' IS NOT NULL THEN
    RAISE EXCEPTION 'A voided receipt is final' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'policy_commission_estimates' AND to_jsonb(OLD)->>'status' = 'superseded'
     AND ((to_jsonb(NEW) - 'superseded_by') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_by')
          OR to_jsonb(OLD)->>'superseded_by' IS NOT NULL) THEN
    RAISE EXCEPTION 'A superseded estimate is final' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.policy_commission_policy_facts(p_policy_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; v jsonb;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'policy_id', w.policy_id, 'win_id', w.id, 'client_id', w.contact_id, 'agent_id', w.agent_id,
           'source', pi.source, 'premium_amount', w.premium_amount, 'premium_snapshot', w.premium_snapshot,
           'policy_type', coalesce(nullif(w.policy_type, ''), CASE pi.source WHEN 'primary' THEN c.policy_type
                                                                    ELSE ap.item->>'policyType' END),
           'sold_date', w.sold_date, 'event_time_source', w.event_time_source,
           'carrier', CASE pi.source WHEN 'primary' THEN c.carrier ELSE ap.item->>'carrier' END,
           'policy_premium', CASE pi.source WHEN 'primary' THEN c.premium::text ELSE ap.item->>'premiumAmount' END,
           'effective_date', CASE pi.source WHEN 'primary' THEN c.effective_date ELSE ap.item->>'effectiveDate' END)), '[]'::jsonb)
    INTO v
    FROM public.wins w
    JOIN private.policy_identities pi
      ON pi.organization_id = w.organization_id AND pi.policy_id = w.policy_id AND pi.client_id = w.contact_id
    LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
    LEFT JOIN LATERAL (
      SELECT x AS item FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.custom_fields->'additional_policies') = 'array'
                                                      THEN c.custom_fields->'additional_policies' ELSE '[]'::jsonb END) x
       WHERE jsonb_typeof(x) = 'object' AND x->>'policyId' = w.policy_id::text LIMIT 1) ap ON pi.source = 'additional'
   WHERE w.organization_id = a.org_id AND w.policy_id = ANY (p_policy_ids)
     AND policy_commission_authz.access(w.agent_id) IS NOT NULL;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.get_client_policy_commissions(p_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_org uuid := policy_commission_authz.actor_org(); c record; p record; w record; v_access text; v_out jsonb := '[]'::jsonb;
  v_est jsonb; v_cap jsonb; v_state text; v_basis jsonb; v_pp text; v_eff text;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'Commission access is unavailable' USING ERRCODE = '42501'; END IF;
  SELECT cl.id, cl.primary_policy_id, cl.carrier, cl.policy_type, cl.premium, cl.effective_date, cl.custom_fields INTO c
    FROM public.clients cl WHERE cl.id = p_client_id AND cl.organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found' USING ERRCODE = 'PT404'; END IF;
  FOR p IN
    SELECT q.* FROM (
      SELECT 0::bigint AS ord, c.primary_policy_id AS policy_id, 'primary'::text AS source, c.carrier::text AS carrier,
             c.policy_type::text AS policy_type, c.premium::text AS premium_text, c.effective_date::text AS effective_date
       WHERE c.primary_policy_id IS NOT NULL
      UNION ALL
      SELECT a.n, (a.x->>'policyId')::uuid, 'additional', a.x->>'carrier', a.x->>'policyType', a.x->>'premiumAmount',
             a.x->>'effectiveDate'
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.custom_fields->'additional_policies') = 'array'
                                       THEN c.custom_fields->'additional_policies' ELSE '[]'::jsonb END) WITH ORDINALITY a(x, n)
       WHERE jsonb_typeof(a.x) = 'object'
         AND a.x->>'policyId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') q
    ORDER BY q.ord
  LOOP
    SELECT wn.id, wn.agent_id, wn.premium_amount, wn.premium_snapshot, wn.policy_type INTO w FROM public.wins wn
     WHERE wn.organization_id = v_org AND wn.policy_id = p.policy_id AND wn.contact_id = c.id;
    IF NOT FOUND THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('policy_id', p.policy_id, 'source', p.source, 'state', 'unavailable'));
      CONTINUE;
    END IF;
    v_access := policy_commission_authz.access(w.agent_id);
    IF v_access IS NULL THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('policy_id', p.policy_id, 'source', p.source, 'state', 'hidden'));
      CONTINUE;
    END IF;
    v_eff := CASE WHEN p.effective_date ~ '^\d{4}-\d{2}-\d{2}$' THEN p.effective_date END;
    SELECT jsonb_build_object('id', e.id, 'status', e.status, 'status_reason', e.status_reason, 'capture_mode', e.capture_mode,
             'captured_by', cp.captured_by, 'recorded_by', e.recorded_by, 'recorded_at', e.recorded_at,
             'grid_name', e.grid_name, 'grid_revision', e.grid_revision, 'grid_effective_date', e.grid_effective_date,
             'product_name', e.product_name, 'product_carrier', e.product_carrier, 'variant_label', e.variant_label,
             'insured_age', e.insured_age, 'term_years', e.term_years, 'contract_level', e.contract_level,
             'rate_percent', e.rate_percent::text, 'monthly_premium', e.monthly_premium::text, 'premium_source', e.premium_source,
             'first_year_cents', e.first_year_cents, 'advance_cents', e.advance_cents,
             'schedule_start_on', e.schedule_start_on, 'schedule_start_source', e.schedule_start_source,
             'state_revision', e.state_revision,
             'installments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind,
                 'expected_cents', i.expected_cents, 'timing_precision', i.timing_precision, 'expected_on', i.expected_on,
                 'timing_source', i.timing_source,
                 'receipts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount_cents', r.amount_cents,
                     'received_on', r.received_on, 'reference', r.reference, 'recorded_by', r.recorded_by,
                     'recorded_at', r.recorded_at, 'replaces_receipt_id', r.replaces_receipt_id, 'voided_at', r.voided_at,
                     'void_reason', r.void_reason) ORDER BY r.recorded_at, r.id), '[]'::jsonb)
                   FROM public.policy_commission_receipts r WHERE r.installment_id = i.id)) ORDER BY i.sequence), '[]'::jsonb)
               FROM public.policy_commission_installments i WHERE i.estimate_id = e.id))
      INTO v_est
      FROM public.policy_commission_estimates e
      LEFT JOIN public.policy_commission_captures cp ON cp.id = e.capture_id
     WHERE e.organization_id = v_org AND e.policy_id = p.policy_id AND e.status IN ('active', 'on_hold');
    SELECT jsonb_build_object('id', cp.id, 'status', cp.status, 'attention_code', cp.attention_code,
             'first_year_cents', cp.first_year_cents, 'advance_cents', cp.advance_cents, 'captured_by', cp.captured_by,
             'captured_at', cp.captured_at, 'product_id', cp.product_id, 'insured_age', cp.insured_age,
             'term_years', cp.term_years)
      INTO v_cap
      FROM public.policy_commission_captures cp
     WHERE cp.organization_id = v_org AND cp.policy_id = p.policy_id AND cp.status IN ('awaiting_confirmation', 'needs_attention');
    v_state := CASE WHEN v_est IS NOT NULL THEN 'recorded'
                    WHEN v_cap->>'status' = 'awaiting_confirmation' THEN 'awaiting_confirmation'
                    WHEN v_cap->>'status' = 'needs_attention' THEN 'needs_attention'
                    ELSE 'not_recorded' END;
    v_pp := regexp_replace(coalesce(p.premium_text, ''), '[,$[:space:]]', '', 'g');
    v_basis := jsonb_build_object('policy_type', coalesce(w.policy_type, p.policy_type), 'carrier', p.carrier,
      'monthly_premium', CASE WHEN w.premium_snapshot AND w.premium_amount > 0 THEN w.premium_amount::text
                              WHEN v_pp ~ '^\d+(\.\d{1,2})?$' AND v_pp::numeric > 0 THEN v_pp END,
      'premium_source', CASE WHEN w.premium_snapshot AND w.premium_amount > 0 THEN 'sale_snapshot'
                             WHEN v_pp ~ '^\d+(\.\d{1,2})?$' AND v_pp::numeric > 0 THEN 'policy_record' END,
      'effective_date', v_eff);
    v_out := v_out || jsonb_build_array(jsonb_build_object('policy_id', p.policy_id, 'source', p.source, 'state', v_state,
      'access', v_access, 'credited_agent_id', w.agent_id, 'win_id', w.id, 'basis', v_basis,
      'estimate', v_est, 'capture', v_cap));
  END LOOP;
  RETURN jsonb_build_object('client_id', c.id, 'policies', v_out);
END $$;

-- ── 5. Writer-owned functions, replaced by their owner ───────────────────────────────────────────────────────────
-- CREATE on the two schemas exists only for this step (as in 20261019170000); owners and grants are unchanged.
GRANT CREATE ON SCHEMA public, private TO agentflow_policy_commission_writer;
SET LOCAL ROLE agentflow_policy_commission_writer;

CREATE OR REPLACE FUNCTION private.policy_commission_insert_estimate(
  p_id uuid, p_actor uuid, p_policy jsonb, p_presented jsonb, p_eval jsonb, p_capture_id uuid, p_mode text,
  p_request_id uuid, p_request_hash text, p_carry jsonb, p_status text, p_status_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_org uuid := policy_commission_authz.actor_org(); v_est public.policy_commission_estimates%ROWTYPE; v_installments jsonb;
BEGIN
  INSERT INTO public.policy_commission_estimates (
    id, organization_id, policy_id, win_id, credited_agent_id, capture_id, capture_mode, grid_id, grid_revision, grid_name,
    grid_effective_date, product_id, product_category, product_carrier, product_name, variant_id, variant_label,
    insured_age, term_years, contract_level, rate_percent, monthly_premium, premium_source, annual_premium,
    first_year_exact, advance_exact, first_year_cents, advance_cents, calculation_version, recorded_by,
    status, status_reason, status_by, status_at, schedule_start_on, schedule_start_source, schedule_set_by, schedule_set_at)
  VALUES (
    coalesce(p_id, gen_random_uuid()), v_org, (p_policy->>'policy_id')::uuid, (p_policy->>'win_id')::uuid,
    (p_policy->>'agent_id')::uuid, p_capture_id, p_mode, (p_presented->>'grid_id')::uuid,
    (p_presented->>'grid_revision')::bigint, p_eval->>'grid_name', (p_eval->>'grid_effective_date')::date,
    (p_presented->>'product_id')::uuid, p_eval->>'product_category', p_eval->>'product_carrier', p_eval->>'product_name',
    (p_presented->>'variant_id')::uuid, p_eval->>'variant_label', (p_presented->>'insured_age')::integer,
    (p_presented->>'term_years')::integer, (p_presented->>'contract_level')::integer, (p_eval->>'rate')::numeric,
    (p_eval->>'premium')::numeric, p_eval->>'premium_source', (p_eval->>'annual')::numeric,
    (p_eval->>'first_year')::numeric, (p_eval->>'advance')::numeric, (p_eval->>'first_year_cents')::bigint,
    (p_eval->>'advance_cents')::bigint, 'policy-commission-v1', p_actor,
    coalesce(p_status, 'active'), p_status_reason,
    CASE WHEN p_status = 'on_hold' THEN p_actor END, CASE WHEN p_status = 'on_hold' THEN clock_timestamp() END,
    (p_carry->>'schedule_start_on')::date, p_carry->>'schedule_start_source',
    CASE WHEN p_carry->>'schedule_start_on' IS NOT NULL THEN p_actor END,
    CASE WHEN p_carry->>'schedule_start_on' IS NOT NULL THEN clock_timestamp() END)
  RETURNING * INTO v_est;
  WITH ins AS (
    INSERT INTO public.policy_commission_installments (organization_id, estimate_id, policy_id, credited_agent_id, kind,
      sequence, expected_cents, timing_precision, expected_on, timing_source, timing_set_by, timing_set_at)
    SELECT v_org, v_est.id, v_est.policy_id, v_est.credited_agent_id, k.kind, k.seq, k.cents,
           coalesce(t->>'timing_precision', 'unknown'), (t->>'expected_on')::date, coalesce(t->>'timing_source', 'unset'),
           CASE WHEN t IS NOT NULL AND t->>'timing_source' <> 'unset' THEN p_actor END,
           CASE WHEN t IS NOT NULL AND t->>'timing_source' <> 'unset' THEN clock_timestamp() END
      FROM (VALUES ('advance', 1, (p_eval->>'advance_cents')::bigint), ('month_10', 2, (p_eval->>'month_10')::bigint),
                   ('month_11', 3, (p_eval->>'month_11')::bigint), ('month_12', 4, (p_eval->>'month_12')::bigint)) k(kind, seq, cents)
      LEFT JOIN LATERAL (SELECT p_carry->'installments'->k.kind AS t) c ON true
    RETURNING id, kind, sequence, expected_cents, timing_precision, expected_on, timing_source)
  SELECT jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'expected_cents', expected_cents, 'timing_precision', timing_precision,
                                      'expected_on', expected_on, 'timing_source', timing_source) ORDER BY sequence)
    INTO v_installments FROM ins;
  -- Baseline audit: the same shape as policy_commission_estimate_state, built from the inserted rows.
  INSERT INTO public.policy_commission_events (organization_id, estimate_id, policy_id, credited_agent_id, event_type,
    request_id, payload_hash, actor_id, reason, after_state, result)
  VALUES (v_org, v_est.id, v_est.policy_id, v_est.credited_agent_id, 'estimate_recorded', p_request_id, p_request_hash,
          p_actor, NULL, jsonb_build_object('estimate_id', v_est.id, 'status', v_est.status, 'status_reason', v_est.status_reason,
            'capture_mode', v_est.capture_mode, 'first_year_cents', v_est.first_year_cents, 'advance_cents', v_est.advance_cents,
            'schedule_start_on', v_est.schedule_start_on, 'schedule_start_source', v_est.schedule_start_source,
            'state_revision', v_est.state_revision, 'installments', v_installments),
          jsonb_build_object('estimate_id', v_est.id, 'status', 'recorded'));
  RETURN jsonb_build_object('estimate_id', v_est.id, 'status', 'recorded');
END $$;

CREATE OR REPLACE FUNCTION private.policy_commission_estimate_state(p_estimate_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('estimate_id', e.id, 'status', e.status, 'status_reason', e.status_reason,
    'capture_mode', e.capture_mode, 'first_year_cents', e.first_year_cents, 'advance_cents', e.advance_cents,
    'schedule_start_on', e.schedule_start_on, 'schedule_start_source', e.schedule_start_source,
    'state_revision', e.state_revision,
    'installments', (SELECT jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'expected_cents', i.expected_cents,
                       'timing_precision', i.timing_precision, 'expected_on', i.expected_on, 'timing_source', i.timing_source)
                       ORDER BY i.sequence)
                       FROM public.policy_commission_installments i WHERE i.estimate_id = e.id))
  FROM public.policy_commission_estimates e WHERE e.id = p_estimate_id
$$;

CREATE OR REPLACE FUNCTION public.set_policy_commission_schedule_basis(p_request_id uuid, p_estimate_id uuid, p_expected_revision bigint,
  p_start_on date, p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_hash text := encode(sha256(convert_to(jsonb_build_array('basis', p_estimate_id, p_expected_revision, p_start_on,
          p_source)::text, 'UTF8')), 'hex');
  v_prior jsonb; e public.policy_commission_estimates%ROWTYPE; v_before jsonb; v_policy jsonb; v_uid uuid := policy_commission_authz.actor_uid();
BEGIN
  v_prior := private.policy_commission_replay(p_request_id, v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  e := private.policy_commission_lock_estimate(p_estimate_id, p_expected_revision, false);
  IF p_expected_revision IS NULL THEN RAISE EXCEPTION 'Missing revision' USING ERRCODE = '22023'; END IF;
  IF (p_start_on IS NULL) <> (p_source IS NULL) OR (p_source IS NOT NULL AND p_source NOT IN ('effective_date', 'manual'))
     OR p_start_on NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN
    RAISE EXCEPTION 'Invalid schedule basis' USING ERRCODE = '22023';
  END IF;
  IF p_source = 'effective_date' THEN
    SELECT x INTO v_policy FROM jsonb_array_elements(private.policy_commission_policy_facts(ARRAY[e.policy_id])) x;
    IF v_policy->>'effective_date' IS DISTINCT FROM p_start_on::text THEN
      RAISE EXCEPTION 'The policy effective date changed; refresh and try again' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_before := private.policy_commission_estimate_state(e.id);
  UPDATE public.policy_commission_estimates SET schedule_start_on = p_start_on, schedule_start_source = p_source,
         schedule_set_by = v_uid, schedule_set_at = clock_timestamp() WHERE id = e.id;
  UPDATE public.policy_commission_installments i
     SET timing_precision = CASE WHEN p_start_on IS NULL THEN 'unknown' ELSE 'month' END,
         expected_on = CASE WHEN p_start_on IS NULL THEN NULL
                            ELSE (date_trunc('month', p_start_on) + make_interval(months => i.sequence + 7))::date END,
         timing_source = CASE WHEN p_start_on IS NULL THEN 'unset' ELSE 'schedule_basis' END,
         timing_set_by = v_uid, timing_set_at = clock_timestamp()
   WHERE i.estimate_id = e.id AND i.kind <> 'advance' AND i.timing_source IN ('unset', 'schedule_basis');
  RETURN private.policy_commission_record_event(e, 'schedule_basis_set', p_request_id, v_hash, NULL, v_before, NULL, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.set_policy_commission_installment_timing(p_request_id uuid, p_installment_id uuid,
  p_expected_revision bigint, p_precision text, p_expected_on date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_hash text := encode(sha256(convert_to(jsonb_build_array('timing', p_installment_id, p_expected_revision, p_precision,
          p_expected_on)::text, 'UTF8')), 'hex');
  v_prior jsonb; i public.policy_commission_installments%ROWTYPE; e public.policy_commission_estimates%ROWTYPE; v_before jsonb;
BEGIN
  v_prior := private.policy_commission_replay(p_request_id, v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  SELECT * INTO i FROM public.policy_commission_installments
   WHERE id = p_installment_id AND organization_id = policy_commission_authz.actor_org();
  IF NOT FOUND THEN RAISE EXCEPTION 'Installment not found' USING ERRCODE = 'PT404'; END IF;
  e := private.policy_commission_lock_estimate(i.estimate_id, p_expected_revision, false);
  IF p_expected_revision IS NULL OR p_precision NOT IN ('unknown', 'month', 'date')
     OR (p_precision = 'unknown') <> (p_expected_on IS NULL)
     OR (p_precision = 'month' AND p_expected_on <> date_trunc('month', p_expected_on)::date)
     OR p_expected_on NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN
    RAISE EXCEPTION 'Invalid payment timing' USING ERRCODE = '22023';
  END IF;
  v_before := private.policy_commission_estimate_state(e.id);
  UPDATE public.policy_commission_installments SET timing_precision = p_precision, expected_on = p_expected_on,
         timing_source = CASE WHEN p_precision = 'unknown' THEN 'unset' ELSE 'manual' END,
         timing_set_by = policy_commission_authz.actor_uid(), timing_set_at = clock_timestamp()
   WHERE id = i.id;
  RETURN private.policy_commission_record_event(e, 'installment_timing_set', p_request_id, v_hash, NULL, v_before, i.id, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.record_policy_commission_estimate_later(p_request_id uuid, p_policy_id uuid, p_inputs jsonb,
  p_replace_estimate_id uuid DEFAULT NULL, p_expected_revision bigint DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_hash text := encode(sha256(convert_to(jsonb_build_array('later', p_policy_id, p_inputs, p_replace_estimate_id,
          p_expected_revision, p_reason)::text, 'UTF8')), 'hex');
  v_prior jsonb; v_policy jsonb; v_grid jsonb; v_eval jsonb; old public.policy_commission_estimates%ROWTYPE;
  v_new uuid := gen_random_uuid(); v_carry jsonb; v_res jsonb; v_uid uuid := policy_commission_authz.actor_uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_before jsonb; v_open uuid;
BEGIN
  v_prior := private.policy_commission_replay(p_request_id, v_hash);
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF NOT private.policy_commission_valid_slot(p_inputs, false) THEN
    RAISE EXCEPTION 'Invalid commission inputs' USING ERRCODE = '22023';
  END IF;
  SELECT x INTO v_policy FROM jsonb_array_elements(private.policy_commission_policy_facts(ARRAY[p_policy_id])) x;
  IF v_policy IS NULL THEN RAISE EXCEPTION 'Policy sale not found' USING ERRCODE = 'PT404'; END IF;
  IF policy_commission_authz.access((v_policy->>'agent_id')::uuid) IS DISTINCT FROM 'write' THEN
    RAISE EXCEPTION 'Not authorized to record this commission' USING ERRCODE = '42501';
  END IF;
  -- Serialize with confirmation of the policy's sale-time capture: whichever commits first wins, and the other then
  -- sees the committed state (an estimate already recorded, or a capture no longer open).
  PERFORM pg_advisory_xact_lock(hashtextextended(policy_commission_authz.actor_org() || ':policy-commission-policy:'
                                                 || p_policy_id, 0));
  SELECT c.id INTO v_open FROM public.policy_commission_captures c
   WHERE c.organization_id = policy_commission_authz.actor_org() AND c.policy_id = p_policy_id
     AND c.status IN ('awaiting_confirmation', 'needs_attention')
     FOR UPDATE;
  IF p_replace_estimate_id IS NOT NULL THEN
    old := private.policy_commission_lock_estimate(p_replace_estimate_id, p_expected_revision, false);
    IF p_expected_revision IS NULL THEN RAISE EXCEPTION 'Replacement needs the loaded revision' USING ERRCODE = '22023'; END IF;
    IF old.policy_id <> p_policy_id THEN RAISE EXCEPTION 'Estimate belongs to another policy' USING ERRCODE = '22023'; END IF;
    IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 200 THEN
      RAISE EXCEPTION 'A replacement needs a reason of 3 to 200 characters' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.policy_commission_receipts r WHERE r.estimate_id = old.id AND r.voided_at IS NULL) THEN
      RAISE EXCEPTION 'Void the recorded payments before replacing this estimate' USING ERRCODE = '22023';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.policy_commission_estimates e WHERE e.organization_id = policy_commission_authz.actor_org()
                  AND e.policy_id = p_policy_id AND e.status IN ('active', 'on_hold')) THEN
    RAISE EXCEPTION 'A commission estimate is already recorded for this policy' USING ERRCODE = '22023';
  END IF;
  v_grid := private.policy_commission_grid_facts((v_policy->>'agent_id')::uuid, jsonb_build_array(jsonb_build_object(
    'key', 'later', 'product_id', p_inputs->>'product_id', 'age', (p_inputs->>'insured_age')::integer,
    'term', (p_inputs->>'term_years')::integer)));
  v_eval := private.policy_commission_evaluate(p_inputs, v_policy, v_grid, v_grid->'items'->0, 'recorded_later');
  IF NOT (v_eval->>'ok')::boolean THEN
    RETURN jsonb_build_object('status', 'changed', 'code', v_eval->>'code');
  END IF;
  IF p_replace_estimate_id IS NOT NULL THEN
    v_before := private.policy_commission_estimate_state(old.id);
    v_carry := jsonb_build_object('schedule_start_on', old.schedule_start_on, 'schedule_start_source', old.schedule_start_source,
      'installments', (SELECT jsonb_object_agg(i.kind, jsonb_build_object('timing_precision', i.timing_precision,
                         'expected_on', i.expected_on, 'timing_source', i.timing_source))
                         FROM public.policy_commission_installments i WHERE i.estimate_id = old.id));
    UPDATE public.policy_commission_estimates SET status = 'superseded', status_reason = v_reason, status_by = v_uid,
           status_at = clock_timestamp(), state_revision = state_revision + 1 WHERE id = old.id;
  END IF;
  v_res := private.policy_commission_insert_estimate(v_new, v_uid, v_policy, p_inputs, v_eval, NULL, 'recorded_later',
             p_request_id, v_hash, v_carry, CASE WHEN old.status = 'on_hold' THEN 'on_hold' ELSE 'active' END,
             CASE WHEN old.status = 'on_hold' THEN old.status_reason END);
  IF v_open IS NOT NULL THEN
    UPDATE public.policy_commission_captures SET status = 'superseded', attention_code = NULL,
           status_reason = 'Estimate recorded later with current rates', status_by = v_uid, status_at = clock_timestamp(),
           resolved_by_estimate_id = v_new
     WHERE id = v_open;
  END IF;
  IF EXISTS (SELECT 1 FROM public.policy_commission_captures c
              WHERE c.organization_id = policy_commission_authz.actor_org() AND c.policy_id = p_policy_id
                AND c.status IN ('awaiting_confirmation', 'needs_attention')) THEN
    RAISE EXCEPTION 'The sale-time estimate for this policy could not be resolved' USING ERRCODE = '42501';
  END IF;
  IF p_replace_estimate_id IS NOT NULL THEN
    UPDATE public.policy_commission_estimates SET superseded_by = v_new WHERE id = old.id;
    INSERT INTO public.policy_commission_events (organization_id, estimate_id, policy_id, credited_agent_id, event_type,
      actor_id, reason, before_state, after_state, result)
    VALUES (old.organization_id, old.id, old.policy_id, old.credited_agent_id, 'estimate_replaced', v_uid, v_reason,
            v_before, private.policy_commission_estimate_state(old.id), jsonb_build_object('replacement_id', v_new));
  END IF;
  RETURN v_res;
END $$;

RESET ROLE;
REVOKE CREATE ON SCHEMA public, private FROM agentflow_policy_commission_writer;

DO $restored$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('private.policy_commission_guard()', '848fb6e1d1328b2d081feb4a5cd1e9aa'),
      ('private.policy_commission_policy_facts(uuid[])', 'a1c30324d1de6cdd12b8cc8f9a39939e'),
      ('public.get_client_policy_commissions(uuid)', '6028b39b7cb096beb8ea45bd976ac4bc'),
      ('private.policy_commission_insert_estimate(uuid,uuid,jsonb,jsonb,jsonb,uuid,text,uuid,text,jsonb,text,text)',
       '5631cbbfa649d7e6d5db1f78148335df'),
      ('private.policy_commission_estimate_state(uuid)', 'a2287c85dcd3f7a5d4e48094bc58c9fe'),
      ('public.set_policy_commission_schedule_basis(uuid,uuid,bigint,date,text)', '28ceecaa4d67ecbf8e69c8932535e2dc'),
      ('public.set_policy_commission_installment_timing(uuid,uuid,bigint,text,date)', 'd4c7f786babc211e71c0c6f3e5a43da8'),
      ('public.record_policy_commission_estimate_later(uuid,uuid,jsonb,uuid,bigint,text)', '14999ee1ecde6ee378164515ff9357ea')) v(fn, digest)
  LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.fn))) <> r.digest THEN
      RAISE EXCEPTION 'rollback restored % with a different definition; refusing', r.fn;
    END IF;
  END LOOP;
END $restored$;

DROP FUNCTION private.policy_commission_expected_schedule(date, text);
DROP FUNCTION private.policy_commission_business_day_after(date, integer);
DROP FUNCTION private.policy_commission_fed_holiday(date);
DROP FUNCTION private.policy_commission_iso_date(text);

ALTER TABLE public.policy_commission_estimates
  DROP CONSTRAINT policy_commission_estimates_schedule,
  DROP COLUMN schedule_convention,
  DROP COLUMN schedule_frequency,
  DROP COLUMN schedule_assumed;
ALTER TABLE public.policy_commission_installments
  DROP CONSTRAINT policy_commission_installments_timing,
  DROP COLUMN expected_until,
  ADD CONSTRAINT policy_commission_installments_timing CHECK ((timing_precision = 'unknown') = (expected_on IS NULL)
    AND (timing_precision <> 'month' OR extract(day FROM expected_on) = 1)
    AND ((timing_source = 'unset') = (timing_precision = 'unknown'))
    AND (timing_source <> 'schedule_basis' OR kind <> 'advance'));
