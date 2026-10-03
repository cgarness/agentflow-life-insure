-- Approved isolated build: deploy requires a separate production approval.
-- A sale and its client commit together. No backfill, RLS policy changes, or notifications here.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE public.wins ADD COLUMN premium_snapshot boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.wins.premium_snapshot IS
  'True for immutable policy-event premium snapshots, including unknown/zero; never fall back to the primary client premium. Legacy false retains its existing fallback.';

-- No PII payloads; receipts outlive client deletion so a retry cannot recreate a deleted sale.
CREATE TABLE private.policy_sale_receipts (
  organization_id uuid NOT NULL,
  operation_key text NOT NULL,
  actor_id uuid NOT NULL,
  payload_hash text NOT NULL,
  client_id uuid NOT NULL,
  win_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, operation_key)
);
ALTER TABLE private.policy_sale_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.policy_sale_receipts FROM PUBLIC, anon, authenticated, service_role;

-- Shared validation for primary + additional policies. Additional policy JSON remains verbatim.
CREATE FUNCTION private.policy_sale_values(p_policy jsonb)
RETURNS TABLE (policy_type text, premium numeric, sold_date date)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_raw text;
BEGIN
  IF jsonb_typeof(p_policy) IS DISTINCT FROM 'object'
     OR nullif(btrim(p_policy->>'policy_type'), '') IS NULL
     OR nullif(btrim(p_policy->>'carrier'), '') IS NULL
     OR coalesce(p_policy->>'sold_date', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'A new sale requires policy type, carrier, and a valid sold date' USING ERRCODE='22023';
  END IF;
  sold_date := (p_policy->>'sold_date')::date;
  policy_type := p_policy->>'policy_type';
  v_raw := regexp_replace(coalesce(p_policy->>'premium', ''), '[,$[:space:]]', '', 'g');
  IF v_raw <> '' AND v_raw !~ '^\d+(\.\d{1,2})?$' THEN
    RAISE EXCEPTION 'Premium must be a nonnegative monthly amount with at most two decimal places' USING ERRCODE='22023';
  END IF;
  premium := coalesce(nullif(v_raw, '')::numeric, 0);
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION private.policy_sale_values(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Accessible only through the two authenticated entry points below.
CREATE FUNCTION private.insert_policy_sale(p_client_id uuid, p_policy jsonb, p_key text, p_campaign uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_c public.clients%ROWTYPE; v_policy record; v_name text; v_campaign_name text; v_id uuid;
BEGIN
  SELECT * INTO STRICT v_c FROM public.clients WHERE id=p_client_id;
  SELECT * INTO v_policy FROM private.policy_sale_values(p_policy);
  IF v_c.assigned_agent_id IS NOT NULL THEN
    SELECT concat_ws(' ', first_name, last_name) INTO v_name FROM public.profiles
     WHERE id=v_c.assigned_agent_id AND organization_id=v_c.organization_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid sale agent organization' USING ERRCODE='42501'; END IF;
  END IF;
  IF p_campaign IS NOT NULL THEN
    SELECT name INTO v_campaign_name FROM public.campaigns WHERE id=p_campaign AND organization_id=v_c.organization_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid sale campaign organization' USING ERRCODE='42501'; END IF;
  END IF;
  INSERT INTO public.wins (organization_id, agent_id, agent_name, contact_id, contact_name,
    campaign_id, campaign_name, policy_type, premium_amount, premium_snapshot, sold_date, idempotency_key)
  VALUES (v_c.organization_id, v_c.assigned_agent_id, v_name, v_c.id, concat_ws(' ',v_c.first_name,v_c.last_name),
    p_campaign, v_campaign_name, v_policy.policy_type, v_policy.premium, true, v_policy.sold_date, p_key)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION private.insert_policy_sale(uuid,jsonb,text,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_client_with_sale(p_request_id uuid, p_expected_org uuid, p_client jsonb, p_record_sale boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_actor record; v_key text; v_hash text; v_receipt private.policy_sale_receipts%ROWTYPE;
  v_client public.clients%ROWTYPE; v_ids uuid[] := '{}'; v_owner uuid;
BEGIN
  SELECT * INTO v_actor FROM private.campaign_actor();
  v_owner := (p_client->>'assigned_agent_id')::uuid;
  IF p_request_id IS NULL OR p_expected_org IS DISTINCT FROM v_actor.org_id OR v_owner IS NULL
     OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_owner AND organization_id=v_actor.org_id)
     OR NOT coalesce(v_owner=v_actor.uid OR v_actor.actor_role='Admin' OR v_actor.is_super
       OR (v_actor.actor_role IN ('Team Leader','Team Lead') AND public.is_ancestor_of(v_actor.uid,v_owner)),false) THEN
    RAISE EXCEPTION 'Client organization or owner changed; refresh before saving' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(p_client) IS DISTINCT FROM 'object' OR p_record_sale IS NULL
     OR p_client ?| ARRAY['id','organization_id','lead_id','user_id','premium_amount']
     OR nullif(btrim(p_client->>'first_name'),'') IS NULL
     OR nullif(btrim(p_client->>'last_name'),'') IS NULL THEN
    RAISE EXCEPTION 'Invalid client payload' USING ERRCODE='22023';
  END IF;
  IF p_client->'custom_fields' IS NOT NULL AND p_client->'custom_fields' <> 'null'::jsonb
     AND (jsonb_typeof(p_client->'custom_fields') <> 'object'
       OR (p_client->'custom_fields' ? 'additional_policies'
         AND jsonb_typeof(p_client->'custom_fields'->'additional_policies') <> 'array')) THEN
    RAISE EXCEPTION 'Invalid custom fields' USING ERRCODE='22023';
  END IF;
  IF p_record_sale AND coalesce(jsonb_array_length(p_client->'custom_fields'->'additional_policies'),0) > 0 THEN
    RAISE EXCEPTION 'Manual new-client entry records one primary policy' USING ERRCODE='22023';
  END IF;
  v_key := 'manual:' || v_actor.uid || ':' || p_request_id;
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_client,p_record_sale)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.org_id || ':' || v_key, 0));
  SELECT * INTO v_receipt FROM private.policy_sale_receipts WHERE organization_id=v_actor.org_id AND operation_key=v_key;
  IF FOUND THEN
    IF v_receipt.actor_id <> v_actor.uid OR v_receipt.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'This request already saved different details; refresh the client before editing' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_client FROM public.clients WHERE id=v_receipt.client_id
      AND organization_id=v_actor.org_id AND assigned_agent_id=v_owner;
    IF NOT FOUND THEN RAISE EXCEPTION 'Previously saved client is no longer available' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('client',to_jsonb(v_client),'client_id',v_client.id,'win_ids',v_receipt.win_ids,'idempotent',true);
  END IF;
  -- Explicit column list: no caller-supplied ids, lineage, timestamps, org or privileged attribution.
  INSERT INTO public.clients(first_name,last_name,phone,email,state,policy_type,carrier,policy_number,premium,
    face_amount,issue_date,effective_date,sold_date,draft_date,payment_frequency,
    beneficiary_name,beneficiary_relationship,beneficiary_phone,notes,assigned_agent_id,organization_id,custom_fields)
  VALUES(p_client->>'first_name',p_client->>'last_name',coalesce(p_client->>'phone',''),coalesce(p_client->>'email',''),
    p_client->>'state',coalesce(nullif(p_client->>'policy_type',''),'Term'),p_client->>'carrier',p_client->>'policy_number',
    (p_client->>'premium')::numeric,(p_client->>'face_amount')::numeric,p_client->>'issue_date',p_client->>'effective_date',
    nullif(p_client->>'sold_date','')::date,nullif(p_client->>'draft_date','')::date,nullif(p_client->>'payment_frequency',''),
    p_client->>'beneficiary_name',p_client->>'beneficiary_relationship',p_client->>'beneficiary_phone',p_client->>'notes',
    v_owner,v_actor.org_id,nullif(p_client->'custom_fields','null'::jsonb)) RETURNING * INTO v_client;
  IF p_record_sale THEN
    v_ids := ARRAY[private.insert_policy_sale(v_client.id,p_client,v_key,NULL)];
  END IF;
  INSERT INTO private.policy_sale_receipts(organization_id,operation_key,actor_id,payload_hash,client_id,win_ids)
    VALUES(v_actor.org_id,v_key,v_actor.uid,v_hash,v_client.id,v_ids);
  RETURN jsonb_build_object('client',to_jsonb(v_client),'client_id',v_client.id,'win_ids',v_ids,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.create_client_with_sale(uuid,uuid,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client_with_sale(uuid,uuid,jsonb,boolean) TO authenticated, service_role;

CREATE FUNCTION public.convert_lead_to_client_with_sales(p_lead_id uuid, p_expected_org uuid, p_client jsonb, p_campaign_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_actor record; v_key text; v_hash text; v_receipt private.policy_sale_receipts%ROWTYPE;
  v_existing public.clients%ROWTYPE; v_lead public.leads%ROWTYPE;
  v_result jsonb; v_client_id uuid; v_ids uuid[] := '{}';
  v_policy jsonb; v_ordinal bigint;
BEGIN
  SELECT * INTO v_actor FROM private.campaign_actor();
  IF p_lead_id IS NULL OR p_expected_org IS DISTINCT FROM v_actor.org_id THEN
    RAISE EXCEPTION 'Conversion organization changed; refresh before saving' USING ERRCODE='42501';
  END IF;
  v_key := 'conversion:' || p_lead_id;
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_client,p_campaign_id)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor.org_id || ':' || v_key, 0));
  SELECT * INTO v_receipt FROM private.policy_sale_receipts WHERE organization_id=v_actor.org_id AND operation_key=v_key;
  IF FOUND THEN
    IF v_receipt.actor_id <> v_actor.uid THEN
      RAISE EXCEPTION 'Conversion retry belongs to another actor' USING ERRCODE='42501';
    END IF;
    IF v_receipt.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'This lead is already converted; refresh the client before editing' USING ERRCODE='22023';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=v_receipt.client_id AND organization_id=v_actor.org_id) THEN
      RAISE EXCEPTION 'Previously converted client is no longer available' USING ERRCODE='42501';
    END IF;
    RETURN jsonb_build_object('client_id',v_receipt.client_id,'win_ids',v_receipt.win_ids,'idempotent',true);
  END IF;
  -- Legacy conversions remain historical evidence, never automatic backfill. Independently authorize
  -- this early return: the original converter predates the receipt and returns before its role guard.
  SELECT * INTO v_existing FROM public.clients WHERE lead_id=p_lead_id AND organization_id=v_actor.org_id;
  IF FOUND THEN
    IF NOT coalesce(v_existing.assigned_agent_id=v_actor.uid OR v_actor.actor_role='Admin' OR v_actor.is_super
       OR (v_actor.actor_role IN ('Team Leader','Team Lead') AND public.is_ancestor_of(v_actor.uid,v_existing.assigned_agent_id)),false) THEN
      RAISE EXCEPTION 'Not authorized to view the converted client' USING ERRCODE='42501';
    END IF;
    RETURN jsonb_build_object('client_id',v_existing.id,'win_ids','[]'::jsonb,'idempotent',true);
  END IF;
  IF jsonb_typeof(p_client) IS DISTINCT FROM 'object'
     OR (p_client->'custom_fields' ? 'additional_policies'
       AND jsonb_typeof(p_client->'custom_fields'->'additional_policies') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Invalid conversion policy payload' USING ERRCODE='22023';
  END IF;
  -- Repeat the intended conversion permission predicate with an explicit NULL-deny boundary.
  -- The historical converter's IF NOT nullable_boolean cannot safely authorize this new writer.
  SELECT * INTO v_lead FROM public.leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE='P0002'; END IF;
  IF v_lead.organization_id IS DISTINCT FROM v_actor.org_id OR NOT coalesce(
       v_lead.user_id=v_actor.uid OR v_lead.assigned_agent_id=v_actor.uid
       OR (v_lead.user_id IS NULL AND v_lead.assigned_agent_id IS NULL)
       OR v_actor.actor_role='Admin' OR v_actor.is_super
       OR (v_actor.actor_role IN ('Team Leader','Team Lead') AND
         (public.is_ancestor_of(v_actor.uid,v_lead.user_id) OR public.is_ancestor_of(v_actor.uid,v_lead.assigned_agent_id))), false) THEN
    RAISE EXCEPTION 'Not authorized to convert this lead' USING ERRCODE='42501';
  END IF;
  IF p_campaign_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.campaigns c JOIN public.campaign_leads cl ON cl.campaign_id=c.id
    WHERE c.id=p_campaign_id AND c.organization_id=v_actor.org_id
      AND cl.organization_id=v_actor.org_id AND cl.lead_id=p_lead_id
  ) THEN RAISE EXCEPTION 'Campaign does not contain this lead in your organization' USING ERRCODE='42501'; END IF;

  -- Original conversion owns lead authorization, row locks, lineage and all contact/telemetry moves.
  -- Never replace its body or weaken its ACL. A failed win INSERT rolls the whole transaction back.
  v_result := public.convert_lead_to_client_atomic(p_lead_id,p_client);
  IF (v_result->>'idempotent')::boolean THEN
    RAISE EXCEPTION 'Lead was converted concurrently; refresh before retrying' USING ERRCODE='40001';
  END IF;
  v_client_id := (v_result->>'client_id')::uuid;
  v_ids := ARRAY[private.insert_policy_sale(v_client_id,p_client,v_key,p_campaign_id)];
  FOR v_policy,v_ordinal IN SELECT value,ordinality FROM jsonb_array_elements(p_client->'custom_fields'->'additional_policies') WITH ORDINALITY LOOP
    v_ids := array_append(v_ids,private.insert_policy_sale(v_client_id,jsonb_build_object(
      'policy_type',v_policy->>'policyType','carrier',v_policy->>'carrier',
      'premium',v_policy->>'premiumAmount','sold_date',v_policy->>'soldDate'),
      v_key || ':policy:' || v_ordinal,p_campaign_id));
  END LOOP;
  INSERT INTO private.policy_sale_receipts(organization_id,operation_key,actor_id,payload_hash,client_id,win_ids)
    VALUES(v_actor.org_id,v_key,v_actor.uid,v_hash,v_client_id,v_ids);
  RETURN v_result || jsonb_build_object('win_ids',v_ids);
END $$;
REVOKE ALL ON FUNCTION public.convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_client_with_sales(uuid,uuid,jsonb,uuid) TO authenticated, service_role;

-- One expression only. Preserve the lean payload, reporting bounds, roster, advisory guard and ACL.
DO $premium$
DECLARE
  target oid := 'public.get_org_leaderboard_stats(timestamptz,timestamptz)'::regprocedure;
  original text; before_meta jsonb; after_meta jsonb;
  needle text := E'12 * CASE\n          WHEN COALESCE(ww.premium_amount, 0) <> 0 THEN ww.premium_amount';
  replacement text;
BEGIN
  SELECT pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' INTO original,before_meta FROM pg_proc p WHERE p.oid=target;
  IF md5(original) <> 'c8b1f9d0c7cf5f8dfb7e437577029278'
    OR (SELECT proowner <> 'postgres'::regrole OR proacl IS DISTINCT FROM
      ARRAY['postgres=X/postgres','authenticated=X/postgres','service_role=X/postgres']::aclitem[] FROM pg_proc WHERE oid=target)
    OR (length(original)-length(replace(original,needle,'')))/length(needle) <> 1 THEN
    RAISE EXCEPTION 'Leaderboard definition or ACL changed; refusing premium snapshot patch';
  END IF;
  replacement := replace(original,needle,E'12 * CASE\n          WHEN ww.premium_snapshot THEN COALESCE(ww.premium_amount, 0)\n          WHEN COALESCE(ww.premium_amount, 0) <> 0 THEN ww.premium_amount');
  EXECUTE replacement;
  SELECT to_jsonb(p)-'prosrc' INTO after_meta FROM pg_proc p WHERE p.oid=target;
  IF after_meta IS DISTINCT FROM before_meta OR pg_get_functiondef(target) <> replacement THEN
    RAISE EXCEPTION 'Unexpected leaderboard metadata or body change';
  END IF;
END $premium$;
