-- Rollback for 20261021200000_lead_client_conversion_preservation.sql (lead → client data preservation).
-- Function-only and NON-DESTRUCTIVE: restores the exact preimage bodies of convert_lead_to_client_atomic (from
-- 20260812042319) and update_client_with_policy_sale (from 20261005161611), byte-for-byte as copied from those files,
-- and re-verifies their reviewed digests. It KEEPS the five clients columns, every value already preserved in them,
-- and the clients_lead_conversion_guard trigger (the restored converter never writes lead_conversion, so the trigger
-- only keeps existing history immutable). Dropping the columns is NOT part of rollback: it would destroy preserved
-- data and needs its own approval with a proven export (AGENT_RULES #28, #29).
-- ORDER: roll the frontend back FIRST. The restored update writer refuses the four person-field keys the new
-- frontend sends (22023 'Invalid client edit'). Forward re-apply after this rollback is supported.
-- Production use requires Chris's separate approval.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE lead_conversion_preservation_rollback_meta ON COMMIT DROP AS
  SELECT p.oid, p.proowner, p.prosecdef, p.proconfig, p.proacl::text AS acl
  FROM pg_catalog.pg_proc p
  WHERE p.oid IN ('public.convert_lead_to_client_atomic(uuid,jsonb)'::regprocedure,
                  'public.update_client_with_policy_sale(uuid,jsonb)'::regprocedure);

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.convert_lead_to_client_atomic(uuid,jsonb)'::regprocedure)) <> '7109fdab661eac16ab6ff4f8d8343c20'
     OR md5(pg_get_functiondef('public.update_client_with_policy_sale(uuid,jsonb)'::regprocedure)) <> '6313ca0c1fc374a613bfcb7e9e587d4c' THEN
    RAISE EXCEPTION 'lead conversion preservation rollback: the installed bodies are not the reviewed post-images; refusing';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION "public"."convert_lead_to_client_atomic"("p_lead_id" "uuid", "p_client" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org    uuid := public.get_org_id();
  v_lead   public.leads%ROWTYPE;
  v_prof   RECORD;
  v_existing uuid;
  v_client uuid;
  v_authorized boolean;
  v_cf jsonb;
  v_freq text;
  v_notes int := 0; v_acts int := 0; v_appts int := 0; v_tasks int := 0;
  v_calls int := 0; v_msgs int := 0; v_msgs2 int := 0; v_emails int := 0; v_wf int := 0;
  v_campaign_rows int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'no_org' USING ERRCODE = '28000'; END IF;

  SELECT id INTO v_existing FROM public.clients
   WHERE lead_id = p_lead_id AND organization_id = v_org LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('client_id', v_existing, 'idempotent', true);
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_lead.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'cross_org' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.organization_id, p.is_super_admin
    INTO v_prof FROM public.profiles p WHERE p.id = v_uid;
  IF NOT FOUND OR v_prof.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_authorized :=
       (v_lead.user_id = v_uid)
    OR (v_lead.assigned_agent_id = v_uid)
    OR (v_lead.user_id IS NULL AND v_lead.assigned_agent_id IS NULL)
    OR (v_prof.role = 'Admin')
    OR (COALESCE(v_prof.is_super_admin, false) AND v_prof.organization_id = v_org)
    OR (v_prof.role IN ('Team Leader','Team Lead') AND (
          public.is_ancestor_of(v_uid, v_lead.user_id)
       OR public.is_ancestor_of(v_uid, v_lead.assigned_agent_id)));
  IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;

  SELECT id INTO v_existing FROM public.clients
   WHERE lead_id = p_lead_id AND organization_id = v_org LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('client_id', v_existing, 'idempotent', true);
  END IF;

  v_cf := CASE WHEN p_client ? 'custom_fields' AND jsonb_typeof(p_client->'custom_fields') = 'object'
               THEN p_client->'custom_fields' ELSE NULL END;

  -- Canonical payment frequency: blank → NULL; normalized spelling; anything else is a caller bug.
  v_freq := lower(replace(btrim(COALESCE(p_client->>'payment_frequency', '')), '-', '_'));
  v_freq := NULLIF(replace(v_freq, ' ', '_'), '');
  IF v_freq IS NOT NULL AND v_freq NOT IN ('monthly', 'quarterly', 'semi_annual', 'annual') THEN
    RAISE EXCEPTION 'invalid_payment_frequency' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.clients (
    first_name, last_name, phone, email,
    policy_type, carrier, policy_number, premium, face_amount, issue_date, effective_date,
    sold_date, draft_date, payment_frequency,
    beneficiary_name, beneficiary_relationship, beneficiary_phone, notes,
    assigned_agent_id, organization_id, custom_fields, lead_id
  ) VALUES (
    v_lead.first_name, v_lead.last_name, v_lead.phone, v_lead.email,
    COALESCE(NULLIF(p_client->>'policy_type', ''), 'Term'),
    COALESCE(p_client->>'carrier', ''),
    COALESCE(p_client->>'policy_number', ''),
    COALESCE((p_client->>'premium')::numeric, 0),
    COALESCE((p_client->>'face_amount')::numeric, 0),
    NULLIF(p_client->>'issue_date', ''),
    NULLIF(p_client->>'effective_date', ''),
    (NULLIF(p_client->>'sold_date', ''))::date,
    (NULLIF(p_client->>'draft_date', ''))::date,
    v_freq,
    NULLIF(p_client->>'beneficiary_name', ''),
    NULLIF(p_client->>'beneficiary_relationship', ''),
    NULLIF(p_client->>'beneficiary_phone', ''),
    COALESCE(NULLIF(p_client->>'notes', ''), v_lead.notes),
    v_lead.assigned_agent_id,
    v_org,
    v_cf,
    p_lead_id
  ) RETURNING id INTO v_client;

  UPDATE public.contact_notes SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  UPDATE public.contact_activities SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_acts = ROW_COUNT;

  UPDATE public.appointments SET contact_id = v_client WHERE contact_id = p_lead_id;
  GET DIAGNOSTICS v_appts = ROW_COUNT;

  UPDATE public.tasks SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  UPDATE public.calls SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND (contact_type = 'lead' OR contact_type IS NULL);
  GET DIAGNOSTICS v_calls = ROW_COUNT;

  UPDATE public.messages SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND (contact_type = 'lead' OR contact_type IS NULL);
  GET DIAGNOSTICS v_msgs = ROW_COUNT;
  UPDATE public.messages SET contact_id = v_client, contact_type = 'client'
   WHERE lead_id = p_lead_id AND contact_id IS NULL;
  GET DIAGNOSTICS v_msgs2 = ROW_COUNT;

  UPDATE public.contact_emails SET contact_id = v_client WHERE contact_id = p_lead_id;
  GET DIAGNOSTICS v_emails = ROW_COUNT;

  UPDATE public.workflow_executions SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  SELECT count(*) INTO v_campaign_rows FROM public.campaign_leads WHERE lead_id = p_lead_id;

  DELETE FROM public.leads WHERE id = p_lead_id;

  RETURN jsonb_build_object(
    'client_id', v_client,
    'idempotent', false,
    'transferred', jsonb_build_object(
      'notes', v_notes, 'activities', v_acts, 'appointments', v_appts, 'tasks', v_tasks,
      'calls', v_calls, 'messages', v_msgs + v_msgs2, 'contact_emails', v_emails,
      'workflow_executions', v_wf),
    'campaign_outcome', jsonb_build_object('campaign_leads_preserved', v_campaign_rows)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_client_with_policy_sale(p_client_id uuid,p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor record; before_row public.clients%ROWTYPE; c public.clients%ROWTYPE; merged public.clients%ROWTYPE; ids uuid[]:='{}';
BEGIN
 SELECT * INTO actor FROM private.campaign_actor();
 SELECT * INTO before_row FROM public.clients WHERE id=p_client_id AND organization_id=actor.org_id FOR UPDATE;
 IF NOT FOUND OR NOT coalesce(before_row.assigned_agent_id=actor.uid OR actor.actor_role='Admin' OR actor.is_super
  OR(actor.actor_role IN ('Team Leader','Team Lead') AND public.is_ancestor_of(actor.uid,before_row.assigned_agent_id)),false) THEN
   RAISE EXCEPTION 'Client not available' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_patch)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k<>ALL(ARRAY[
  'first_name','last_name','phone','email','state','policy_type','carrier','policy_number','premium','face_amount',
  'issue_date','effective_date','sold_date','draft_date','payment_frequency','beneficiary_name','beneficiary_relationship',
  'beneficiary_phone','notes','assigned_agent_id','custom_fields','updated_at'])) THEN
   RAISE EXCEPTION 'Invalid client edit' USING ERRCODE='22023';
 END IF;
 merged := jsonb_populate_record(before_row,p_patch);
 IF merged.assigned_agent_id IS DISTINCT FROM before_row.assigned_agent_id AND NOT(
   EXISTS(SELECT 1 FROM public.profiles WHERE id=merged.assigned_agent_id AND organization_id=actor.org_id)
   AND coalesce(actor.actor_role='Admin' OR actor.is_super OR(actor.actor_role IN ('Team Leader','Team Lead')
     AND public.is_ancestor_of(actor.uid,merged.assigned_agent_id)),false)) THEN
   RAISE EXCEPTION 'Invalid client owner' USING ERRCODE='42501';
 END IF;
 UPDATE public.clients SET first_name=merged.first_name,last_name=merged.last_name,phone=merged.phone,email=merged.email,
 state=merged.state,policy_type=merged.policy_type,carrier=merged.carrier,policy_number=merged.policy_number,premium=merged.premium,
 face_amount=merged.face_amount,issue_date=merged.issue_date,effective_date=merged.effective_date,sold_date=merged.sold_date,
 draft_date=merged.draft_date,payment_frequency=merged.payment_frequency,beneficiary_name=merged.beneficiary_name,
 beneficiary_relationship=merged.beneficiary_relationship,beneficiary_phone=merged.beneficiary_phone,notes=merged.notes,
 assigned_agent_id=merged.assigned_agent_id,custom_fields=merged.custom_fields,updated_at=now()
 WHERE id=p_client_id RETURNING * INTO c;
 IF NOT private.has_primary_policy(to_jsonb(before_row)) AND before_row.primary_policy_id IS NULL AND private.has_primary_policy(to_jsonb(c)) THEN
   ids:=ARRAY[private.insert_policy_sale(c.id,to_jsonb(c),'policy:'||c.primary_policy_id,NULL)];
 END IF;
 RETURN jsonb_build_object('client',to_jsonb(c),'client_id',c.id,'win_ids',ids);
END $$;

DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.convert_lead_to_client_atomic(uuid,jsonb)'::regprocedure)) <> '641ba66c96ca4a76f80c9c85eb9caa42'
     OR md5(pg_get_functiondef('public.update_client_with_policy_sale(uuid,jsonb)'::regprocedure)) <> '96e8f6e7ecc85d0d5385bf8640a144a6' THEN
    RAISE EXCEPTION 'lead conversion preservation rollback: restored bodies differ from the reviewed preimages';
  END IF;
  IF EXISTS (SELECT 1 FROM lead_conversion_preservation_rollback_meta pre JOIN pg_proc p ON p.oid = pre.oid
             WHERE p.proowner <> pre.proowner OR p.prosecdef <> pre.prosecdef
                OR p.proconfig IS DISTINCT FROM pre.proconfig OR p.proacl::text IS DISTINCT FROM pre.acl) THEN
    RAISE EXCEPTION 'lead conversion preservation rollback: writer metadata changed';
  END IF;
END $post$;
