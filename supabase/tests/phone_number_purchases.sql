-- SYNTHETIC LOCAL FIXTURE ONLY. Run through scripts/tests/phone-number-purchases/run.mjs.
-- The runner refuses hosted URLs and any database that already contains user tables.
CREATE TABLE public.phone_purchase_test_results (label text NOT NULL);
CREATE FUNCTION public.phone_purchase_test_assert(p_ok boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %', p_label; END IF;
  INSERT INTO public.phone_purchase_test_results VALUES (p_label);
END $$;
CREATE FUNCTION public.phone_purchase_test_error(p_sql text, p_state text, p_message text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state AND (p_message IS NULL OR SQLERRM = p_message) THEN
      INSERT INTO public.phone_purchase_test_results VALUES (coalesce(p_message, p_state));
      RETURN;
    END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected % / %: %', p_state, p_message, p_sql;
END $$;
CREATE FUNCTION public.phone_purchase_test_quote(p_actor uuid, p_org uuid, p_number text, p_type text DEFAULT 'toll_free') RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.phone_number_purchase_quote(p_actor, p_org, 'AC11111111111111111111111111111111', p_number, p_type,
    'Synthetic purchase', '{"monthly_price":"2.15","currency":"USD","inbound_per_minute":"0.022"}');
$$;

INSERT INTO public.organizations(id, name, twilio_subaccount_status, twilio_subaccount_sid) VALUES
 ('10000000-0000-4000-8000-000000000001', 'Synthetic purchase agency A', 'active', 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
 ('20000000-0000-4000-8000-000000000001', 'Synthetic purchase agency B', 'active', 'ACbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
INSERT INTO auth.users(id) VALUES
 ('10000000-0000-4000-8000-000000000011'), ('10000000-0000-4000-8000-000000000012'),
 ('10000000-0000-4000-8000-000000000013'), ('10000000-0000-4000-8000-000000000014'),
 ('10000000-0000-4000-8000-000000000015'), ('10000000-0000-4000-8000-000000000016'),
 ('10000000-0000-4000-8000-000000000017'), ('20000000-0000-4000-8000-000000000011');
INSERT INTO public.profiles(id, organization_id, role, status) VALUES
 ('10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'Admin', 'Active'),
 ('10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'Agent', 'Active'),
 ('10000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', 'Team Leader', 'Active'),
 ('10000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001', 'Super Admin', 'Active'),
 ('10000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000001', 'Admin', 'Suspended'),
 ('10000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000001', 'Admin', 'Active'),
 ('10000000-0000-4000-8000-000000000017', '10000000-0000-4000-8000-000000000001', 'Admin', 'Active'),
 ('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'Admin', 'Active');
UPDATE public.profiles SET twilio_client_identity='synthetic_' || replace(id::text,'-','');
INSERT INTO public.inbound_routing_settings(organization_id, routing_engine, inbound_group_agent_ids) VALUES
 ('10000000-0000-4000-8000-000000000001', 'v2', ARRAY['10000000-0000-4000-8000-000000000011']::uuid[]),
 ('20000000-0000-4000-8000-000000000001', 'v2', ARRAY['20000000-0000-4000-8000-000000000011']::uuid[]);
INSERT INTO public.phone_numbers(organization_id, phone_number, friendly_name, twilio_sid, trust_hub_status) VALUES
 ('10000000-0000-4000-8000-000000000001', '+12025550001', 'Synthetic existing A', 'PN00000000000000000000000000000001', 'approved'),
 ('20000000-0000-4000-8000-000000000001', '+12025550002', 'Synthetic existing B', 'PN00000000000000000000000000000002', 'approved');

-- Local security-advisor equivalents for every new object, including inherited default grants.
DO $$ DECLARE r record; v_role text; v_count integer := 0; BEGIN
  PERFORM public.phone_purchase_test_assert((SELECT relrowsecurity FROM pg_class WHERE oid='private.phone_number_purchase_operations'::regclass), 'ledger RLS enabled');
  PERFORM public.phone_purchase_test_assert(NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.phone_number_purchase_operations'::regclass), 'ledger has no client policy');
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    PERFORM public.phone_purchase_test_assert(NOT has_table_privilege(v_role, 'private.phone_number_purchase_operations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), v_role || ' has no direct ledger privileges');
  END LOOP;
  FOR r IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig, n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') AND p.proname LIKE 'phone_number_purchase_%' LOOP
    PERFORM public.phone_purchase_test_assert(r.prosecdef AND r.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], r.proname || ' pinned security definer');
    PERFORM public.phone_purchase_test_assert(NOT has_function_privilege('anon', r.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', r.oid, 'EXECUTE'), r.proname || ' no client execution');
    PERFORM public.phone_purchase_test_assert(has_function_privilege('service_role', r.oid, 'EXECUTE') = (r.nspname='public'), r.proname || ' narrow service execution');
    IF r.nspname='public' THEN v_count := v_count+1; END IF;
  END LOOP;
  PERFORM public.phone_purchase_test_assert(v_count=6, 'exactly six service purchase RPCs');
END $$;

SET ROLE anon;
SELECT public.phone_purchase_test_error('select * from private.phone_number_purchase_operations', '42501');
SELECT public.phone_purchase_test_error('select public.phone_number_purchase_quote(null,null,null,null,null,null,null)', '42501');
SELECT public.phone_purchase_test_error('select public.phone_number_purchase_get(null,null,null,null)', '42501');
SELECT public.phone_purchase_test_error('select public.phone_number_purchase_claim(null,null,null,null)', '42501');
SELECT public.phone_purchase_test_error('select public.phone_number_purchase_record(null,null,null,null,null,null,null)', '42501');
SELECT public.phone_purchase_test_error('select public.phone_number_purchase_review(null,null,null,null,null)', '42501');
SELECT public.phone_purchase_test_error('select public.phone_number_purchase_complete(null,null,null,null)', '42501');
RESET ROLE;
SET ROLE authenticated;
SELECT public.phone_purchase_test_error('select * from private.phone_number_purchase_operations', '42501');
SELECT public.phone_purchase_test_error('select public.phone_number_purchase_quote(null,null,null,null,null,null,null)', '42501');
SELECT public.phone_purchase_test_error('select public.phone_number_purchase_get(null,null,null,null)', '42501');
SELECT public.phone_purchase_test_error('select public.phone_number_purchase_claim(null,null,null,null)', '42501');
SELECT public.phone_purchase_test_error('select public.phone_number_purchase_record(null,null,null,null,null,null,null)', '42501');
SELECT public.phone_purchase_test_error('select public.phone_number_purchase_review(null,null,null,null,null)', '42501');
SELECT public.phone_purchase_test_error('select public.phone_number_purchase_complete(null,null,null,null)', '42501');
RESET ROLE;
SET ROLE service_role;
SELECT public.phone_purchase_test_error('select * from private.phone_number_purchase_operations', '42501');
SELECT public.phone_purchase_test_assert(public.phone_purchase_test_quote('10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','+18005550999')->>'state'='quoted', 'service role can create authorized quote');
SELECT public.phone_purchase_test_error('select public.set_inbounds_number(null,true)', '42501');
RESET ROLE;

-- The injected failure occurs after the phone insert and ledger update, proving both roll back.
CREATE FUNCTION public.phone_purchase_test_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.state='completed' AND current_setting('phone_purchase_tests.fail_complete', true)='on' THEN
    RAISE EXCEPTION 'synthetic_finalization_failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_test_fail_completion AFTER UPDATE ON private.phone_number_purchase_operations
  FOR EACH ROW EXECUTE FUNCTION public.phone_purchase_test_fail_completion();

DO $$ DECLARE
  a constant uuid := '10000000-0000-4000-8000-000000000011';
  b constant uuid := '20000000-0000-4000-8000-000000000011';
  oa constant uuid := '10000000-0000-4000-8000-000000000001';
  ob constant uuid := '20000000-0000-4000-8000-000000000001';
  master constant text := 'AC11111111111111111111111111111111';
  terms constant jsonb := '{"monthly_price":"2.15","currency":"USD","inbound_per_minute":"0.022"}';
  v_quote jsonb; v_other jsonb; v_result jsonb; v_first jsonb; v_id uuid; v_other_id uuid;
  v_request uuid; v_time timestamptz; v_actor uuid; v_bad jsonb; v_text text;
BEGIN
  -- Active database roles, not JWT metadata, authorize quote/get/claim. Super Admin stays home-scoped.
  FOREACH v_actor IN ARRAY ARRAY[
    '10000000-0000-4000-8000-000000000012'::uuid, '10000000-0000-4000-8000-000000000013'::uuid,
    '10000000-0000-4000-8000-000000000015'::uuid, '90000000-0000-4000-8000-000000000011'::uuid
  ] LOOP
    PERFORM public.phone_purchase_test_error(format('select public.phone_purchase_test_quote(%L,%L,%L)',v_actor,oa,'+18005550010'), 'PT403', 'admin_required');
  END LOOP;
  PERFORM public.phone_purchase_test_error(format('select public.phone_purchase_test_quote(%L,%L,%L)',a,ob,'+18005550010'), 'PT403', 'admin_required');
  PERFORM public.phone_purchase_test_error(format('select public.phone_purchase_test_quote(%L,%L,%L)','10000000-0000-4000-8000-000000000014',ob,'+18005550010'), 'PT403', 'admin_required');
  PERFORM public.phone_purchase_test_assert(public.phone_purchase_test_quote('10000000-0000-4000-8000-000000000014',oa,'+18005550010')->>'state'='quoted', 'Super Admin home organization allowed');
  v_quote := public.phone_purchase_test_quote(a,oa,'+18005550100'); v_id := (v_quote->>'id')::uuid; v_request := gen_random_uuid();
  PERFORM public.phone_purchase_test_assert(v_quote->>'state'='quoted' AND (v_quote->>'claimed')::boolean=false AND v_quote->>'request_id' IS NULL, 'new quote has no purchase authority');
  PERFORM public.phone_purchase_test_assert((SELECT expires_at-created_at=interval '5 minutes' FROM private.phone_number_purchase_operations WHERE id=v_id), 'server-generated five-minute expiry');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_get(%L,%L,%L,null)',b,ob,v_id), 'PT404', 'operation_not_found');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_get(%L,%L,%L,null)','10000000-0000-4000-8000-000000000016',oa,v_id), 'PT404', 'operation_not_found');
  UPDATE public.organizations SET twilio_subaccount_status='suspended' WHERE id=oa;
  PERFORM public.phone_purchase_test_error(format('select public.phone_purchase_test_quote(%L,%L,%L)',a,oa,'+18005550010'), 'PT403', 'telephony_unavailable');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_get(%L,%L,%L,null)',a,oa,v_id), 'PT403', 'telephony_unavailable');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_claim(%L,%L,%L,%L)',a,oa,v_id,v_request), 'PT403', 'telephony_unavailable');
  UPDATE public.organizations SET twilio_subaccount_status='active',twilio_subaccount_sid=NULL WHERE id=oa;
  PERFORM public.phone_purchase_test_error(format('select public.phone_purchase_test_quote(%L,%L,%L)',a,oa,'+18005550010'), 'PT403', 'telephony_unavailable');
  UPDATE public.organizations SET twilio_subaccount_sid='ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE id=oa;
  UPDATE public.profiles SET role='Agent' WHERE id=a;
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_claim(%L,%L,%L,%L)',a,oa,v_id,v_request), 'PT403', 'admin_required');
  UPDATE public.profiles SET role='Admin' WHERE id=a;

  FOREACH v_bad IN ARRAY ARRAY[
    '{}'::jsonb, '{"monthly_price":2.15,"currency":"USD","inbound_per_minute":"0.022"}'::jsonb,
    terms || '{"monthly_price":"-2"}', terms || '{"monthly_price":"NaN"}', terms || '{"monthly_price":"1e2"}',
    terms || '{"inbound_per_minute":"0.123456789"}', terms || '{"currency":"usd"}'
  ] LOOP
    PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_quote(%L,%L,%L,%L,%L,%L,%L::jsonb)',a,oa,master,'+18005550011','toll_free','Test',v_bad), 'PT400', 'invalid_quote');
  END LOOP;
  PERFORM public.phone_purchase_test_error(format('select public.phone_purchase_test_quote(%L,%L,%L)',a,oa,'+18335550011'), 'PT400', 'invalid_purchase_input');
  PERFORM public.phone_purchase_test_error(format('select public.phone_purchase_test_quote(%L,%L,%L,%L)',a,oa,'+18005550011','local'), 'PT400', 'invalid_purchase_input');
  PERFORM public.phone_purchase_test_error(format('select public.phone_purchase_test_quote(%L,%L,%L,%L)',a,oa,'+442025550011','local'), 'PT400', 'invalid_purchase_input');
  v_other := public.phone_number_purchase_quote(a,oa,master,'+18005550012','toll_free','  Trimmed  ',terms || '{"ignored":"not persisted"}');
  PERFORM public.phone_purchase_test_assert(v_other->>'friendly_name'='Trimmed' AND v_other->'quote'=terms, 'only validated quote terms persisted');

  v_result := public.phone_number_purchase_claim(a,oa,v_id,v_request);
  PERFORM public.phone_purchase_test_assert(v_result->>'state'='purchasing' AND (v_result->>'claimed')::boolean AND v_result->>'attempted_at' IS NOT NULL, 'first claim authorizes one attempt');
  PERFORM public.phone_purchase_test_assert(NOT (public.phone_number_purchase_claim(a,oa,v_id,v_request)->>'claimed')::boolean, 'same request replay cannot purchase again');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_claim(%L,%L,%L,%L)',a,oa,v_id,gen_random_uuid()), 'PT409', 'request_conflict');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_get(%L,%L,%L,%L)',a,oa,v_id,gen_random_uuid()), 'PT409', 'request_conflict');
  v_other := public.phone_purchase_test_quote(a,oa,'+18885550100'); v_other_id := (v_other->>'id')::uuid;
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_claim(%L,%L,%L,%L)',a,oa,v_other_id,v_request), 'PT409', 'request_conflict');
  v_other := public.phone_number_purchase_quote(a,oa,master,'+18005550100','toll_free','Changed',terms || '{"monthly_price":"7.77"}');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_claim(%L,%L,%L,%L)',a,oa,v_other->>'id',v_request), 'PT409', 'request_conflict');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_claim(%L,%L,%L,%L)',a,oa,v_other->>'id',gen_random_uuid()), 'PT409', 'number_unavailable');
  v_other := public.phone_purchase_test_quote(b,ob,'+18005550100');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_claim(%L,%L,%L,%L)',b,ob,v_other->>'id',gen_random_uuid()), 'PT409', 'number_unavailable');
  FOREACH v_text IN ARRAY ARRAY['+12025550001','+12025550002'] LOOP
    v_other := public.phone_purchase_test_quote(a,oa,v_text,'local');
    PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_claim(%L,%L,%L,%L)',a,oa,v_other->>'id',gen_random_uuid()), 'PT409', 'number_unavailable');
  END LOOP;
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_complete(%L,%L,%L,%L)',a,oa,v_id,v_request), 'PT409', 'invalid_operation_state');

  -- Receipt validation and exact replay precede atomic local persistence.
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_record(%L,%L,%L,%L,%L,%L,%L)',a,oa,v_id,v_request,'PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',master,'+18885550100'), 'PT409', 'receipt_mismatch');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_record(%L,%L,%L,%L,%L,%L,%L)',a,oa,v_id,v_request,'PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','AC22222222222222222222222222222222','+18005550100'), 'PT409', 'receipt_mismatch');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_record(%L,%L,%L,%L,%L,%L,%L)',a,oa,v_id,v_request,'not-a-sid',master,'+18005550100'), 'PT409', 'receipt_mismatch');
  v_result := public.phone_number_purchase_record(a,oa,v_id,v_request,'PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',master,'+18005550100');
  PERFORM public.phone_purchase_test_assert(v_result->>'state'='purchased_pending_save' AND NOT EXISTS(SELECT 1 FROM public.phone_numbers WHERE phone_number='+18005550100'), 'provider receipt saved before number row');
  PERFORM public.phone_purchase_test_assert(public.phone_number_purchase_record(a,oa,v_id,v_request,'PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',master,'+18005550100')->>'state'='purchased_pending_save', 'receipt replay preserves pending state');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_record(%L,%L,%L,%L,%L,%L,%L)',a,oa,v_id,v_request,'PNbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',master,'+18005550100'), 'PT409', 'receipt_mismatch');
  PERFORM public.phone_purchase_test_assert(public.phone_number_purchase_review(a,oa,v_id,v_request,'PURCHASE_OUTCOME_UNKNOWN')->>'state'='purchased_pending_save', 'unknown response cannot erase known receipt');
  v_first := public.phone_number_purchase_complete(a,oa,v_id,v_request);
  PERFORM public.phone_purchase_test_assert(v_first->>'state'='completed' AND v_first->>'phone_number_id' IS NOT NULL, 'complete returns durable phone id');
  PERFORM public.phone_purchase_test_assert(v_first->'row'->>'organization_id'=oa::text AND v_first->'row'->>'assignment_type'='agency' AND v_first->'row'->>'assigned_to' IS NULL, 'agency ownership and no personal assignment');
  PERFORM public.phone_purchase_test_assert((v_first->'row'->>'is_default')::boolean=false AND (v_first->'row'->>'is_direct_line')::boolean=false AND (v_first->'row'->>'inbounds_only')::boolean=false, 'purchase does not bypass dedicated-number workflow');
  PERFORM public.phone_purchase_test_assert(v_first->'row'->>'status'='active' AND v_first->'row'->>'trust_hub_status'='pending' AND v_first->'row'->>'area_code'='800', 'status and toll-free area code preserved');
  PERFORM public.phone_purchase_test_assert(public.phone_number_purchase_complete(a,oa,v_id,v_request)->>'phone_number_id'=v_first->>'phone_number_id' AND (SELECT count(*)=1 FROM public.phone_numbers WHERE phone_number='+18005550100'), 'completed replay inserts no duplicate');
  PERFORM public.phone_purchase_test_assert(public.phone_number_purchase_get(a,oa,v_id,v_request)->'row'=v_first->'row', 'authorized status includes completed row');
  PERFORM public.phone_purchase_test_assert(public.phone_number_purchase_review(a,oa,v_id,v_request,'RECEIPT_VERIFICATION_FAILED')->>'state'='completed', 'late errors never regress completion');

  -- Expiry closes only an unattempted quote; it never restores paid/uncertain purchase authority.
  v_other := public.phone_purchase_test_quote(a,oa,'+18005550101'); v_other_id := (v_other->>'id')::uuid;
  v_time := clock_timestamp()-interval '10 minutes';
  UPDATE private.phone_number_purchase_operations SET created_at=v_time,expires_at=v_time+interval '5 minutes' WHERE id IN (v_id,v_other_id);
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_claim(%L,%L,%L,%L)',a,oa,v_other_id,gen_random_uuid()), 'PT409', 'quote_expired');
  PERFORM public.phone_purchase_test_assert(NOT (public.phone_number_purchase_claim(a,oa,v_id,v_request)->>'claimed')::boolean, 'completed replay survives quote expiry safely');
  v_quote := public.phone_purchase_test_quote(a,oa,'+18005550102'); v_id := (v_quote->>'id')::uuid; v_request := gen_random_uuid();
  v_result := public.phone_number_purchase_review(a,oa,v_id,v_request,'PRICE_CHANGED');
  PERFORM public.phone_purchase_test_assert(v_result->>'state'='failed_before_purchase' AND v_result->>'attempted_at' IS NULL, 'precheck failure records no provider attempt');
  PERFORM public.phone_purchase_test_assert(NOT (public.phone_number_purchase_claim(a,oa,v_id,v_request)->>'claimed')::boolean, 'failed quote is not silently rearmed');
  v_quote := public.phone_purchase_test_quote(a,oa,'+18005550102'); v_id := (v_quote->>'id')::uuid; v_request := gen_random_uuid();
  PERFORM public.phone_number_purchase_claim(a,oa,v_id,v_request);
  PERFORM public.phone_purchase_test_assert(public.phone_number_purchase_review(a,oa,v_id,v_request,'PURCHASE_OUTCOME_UNKNOWN')->>'state'='needs_review', 'uncertain provider outcome is irreversible review state');
  UPDATE private.phone_number_purchase_operations SET created_at=v_time,expires_at=v_time+interval '5 minutes' WHERE id=v_id;
  PERFORM public.phone_purchase_test_assert(NOT (public.phone_number_purchase_claim(a,oa,v_id,v_request)->>'claimed')::boolean, 'uncertain attempt cannot expire into a retry');
  v_other := public.phone_purchase_test_quote(a,oa,'+18005550102');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_claim(%L,%L,%L,%L)',a,oa,v_other->>'id',gen_random_uuid()), 'PT409', 'number_unavailable');

  -- Capture/finish a paid receipt using its original actor/org even after revocation and movement.
  v_actor := '10000000-0000-4000-8000-000000000017';
  v_quote := public.phone_purchase_test_quote(v_actor,oa,'+18885550100'); v_id := (v_quote->>'id')::uuid; v_request := gen_random_uuid();
  PERFORM public.phone_number_purchase_claim(v_actor,oa,v_id,v_request);
  UPDATE public.profiles SET organization_id=ob,role='Agent',status='Suspended' WHERE id=v_actor;
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_get(%L,%L,%L,%L)',v_actor,oa,v_id,v_request), 'PT403', 'admin_required');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_record(%L,%L,%L,%L,%L,%L,%L)',v_actor,ob,v_id,v_request,'PNbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',master,'+18885550100'), 'PT404', 'operation_not_found');
  PERFORM public.phone_number_purchase_record(v_actor,oa,v_id,v_request,'PNbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',master,'+18885550100');
  v_result := public.phone_number_purchase_complete(v_actor,oa,v_id,v_request);
  PERFORM public.phone_purchase_test_assert(v_result->'row'->>'organization_id'=oa::text, 'paid number remains in original agency after actor moves');
  UPDATE public.profiles SET organization_id=oa,role='Admin',status='Active' WHERE id=v_actor;

  -- Receipt uniqueness across different attempted numbers and organizations.
  v_quote := public.phone_purchase_test_quote(b,ob,'+18885550103'); v_id := (v_quote->>'id')::uuid; v_request := gen_random_uuid();
  PERFORM public.phone_number_purchase_claim(b,ob,v_id,v_request);
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_record(%L,%L,%L,%L,%L,%L,%L)',b,ob,v_id,v_request,'PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',master,'+18885550103'), 'PT409', 'receipt_conflict');

  -- A transient database failure preserves the receipt. Recovery creates one row, without re-claiming.
  v_quote := public.phone_purchase_test_quote(a,oa,'+12025550104','local'); v_id := (v_quote->>'id')::uuid; v_request := gen_random_uuid();
  PERFORM public.phone_number_purchase_claim(a,oa,v_id,v_request);
  PERFORM public.phone_number_purchase_record(a,oa,v_id,v_request,'PNcccccccccccccccccccccccccccccccc',master,'+12025550104');
  PERFORM set_config('phone_purchase_tests.fail_complete','on',true);
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_complete(%L,%L,%L,%L)',a,oa,v_id,v_request), 'P0001', 'synthetic_finalization_failure');
  PERFORM public.phone_purchase_test_assert((SELECT state='purchased_pending_save' AND phone_number_id IS NULL FROM private.phone_number_purchase_operations WHERE id=v_id) AND NOT EXISTS(SELECT 1 FROM public.phone_numbers WHERE phone_number='+12025550104'), 'phone insert and completion are atomic');
  PERFORM set_config('phone_purchase_tests.fail_complete','off',true);
  v_result := public.phone_number_purchase_complete(a,oa,v_id,v_request);
  PERFORM public.phone_purchase_test_assert(v_result->>'state'='completed' AND v_result->'row'->>'area_code'='202', 'same receipt recovery preserves local-number behavior');

  -- A late legacy insert must not be overwritten or adopted, even on the shared master account.
  v_quote := public.phone_purchase_test_quote(a,oa,'+18005550105'); v_id := (v_quote->>'id')::uuid; v_request := gen_random_uuid();
  PERFORM public.phone_number_purchase_claim(a,oa,v_id,v_request);
  PERFORM public.phone_number_purchase_record(a,oa,v_id,v_request,'PNdddddddddddddddddddddddddddddddd',master,'+18005550105');
  INSERT INTO public.phone_numbers(organization_id,phone_number,friendly_name,twilio_sid,trust_hub_status)
    VALUES(ob,'+18005550105','Synthetic existing foreign owner','PNeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','approved');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_complete(%L,%L,%L,%L)',a,oa,v_id,v_request), 'PT409', 'number_unavailable');
  PERFORM public.phone_purchase_test_assert((SELECT organization_id=ob AND friendly_name='Synthetic existing foreign owner' AND trust_hub_status='approved' FROM public.phone_numbers WHERE phone_number='+18005550105'), 'existing foreign number remains unchanged');
  PERFORM public.phone_purchase_test_assert((SELECT state='purchased_pending_save' AND provider_sid='PNdddddddddddddddddddddddddddddddd' FROM private.phone_number_purchase_operations WHERE id=v_id), 'known receipt survives ownership conflict');
  v_quote := public.phone_purchase_test_quote(a,oa,'+18005550106'); v_id := (v_quote->>'id')::uuid; v_request := gen_random_uuid();
  PERFORM public.phone_number_purchase_claim(a,oa,v_id,v_request);
  PERFORM public.phone_number_purchase_record(a,oa,v_id,v_request,'PNeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',master,'+18005550106');
  PERFORM public.phone_purchase_test_error(format('select public.phone_number_purchase_complete(%L,%L,%L,%L)',a,oa,v_id,v_request), 'PT409', 'number_unavailable');
END $$;

-- Use the ACTUAL existing authenticated Inbounds workflow and outbound insertion trigger.
SET ROLE authenticated;
SET request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000011","org_id":"10000000-0000-4000-8000-000000000001"}';
SELECT public.phone_purchase_test_assert(public.set_inbounds_number((SELECT id FROM public.phone_numbers WHERE phone_number='+18005550100'),true), 'purchased 800 authorized for Inbounds');
SELECT public.phone_purchase_test_assert(public.set_inbounds_number((SELECT id FROM public.phone_numbers WHERE phone_number='+18885550100'),true), 'purchased 888 authorized for Inbounds');
SELECT public.phone_purchase_test_error($q$INSERT INTO public.calls(organization_id,agent_id,direction,status,caller_id_used) VALUES('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','outbound','ringing','+18005550100')$q$, 'P0001', 'This number is reserved for Inbounds');
SELECT public.phone_purchase_test_error($q$INSERT INTO public.calls(organization_id,agent_id,direction,status,caller_id_used) VALUES('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','outbound','ringing','+18885550100')$q$, 'P0001', 'This number is reserved for Inbounds');
INSERT INTO public.calls(organization_id,agent_id,direction,status,caller_id_used) VALUES('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','outbound','completed','+12025550104');
SELECT public.phone_purchase_test_assert(EXISTS(SELECT 1 FROM public.calls WHERE caller_id_used='+12025550104'), 'ordinary purchased local number remains outbound eligible');
SELECT public.phone_purchase_test_error($q$SELECT public.set_inbounds_number((SELECT id FROM public.phone_numbers WHERE phone_number='+12025550002'),true)$q$, '42501', 'Number not found');
SET request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000012","org_id":"10000000-0000-4000-8000-000000000001"}';
SELECT public.phone_purchase_test_error($q$SELECT public.set_inbounds_number((SELECT id FROM public.phone_numbers WHERE phone_number='+12025550104'),true)$q$, '42501', 'Admin access required');
RESET ROLE;
SET request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000011","org_id":"10000000-0000-4000-8000-000000000001"}';
DO $$ DECLARE v_id uuid := (SELECT id FROM public.phone_numbers WHERE phone_number='+12025550104'); BEGIN
  UPDATE public.phone_numbers SET is_default=true WHERE id=v_id;
  PERFORM public.phone_purchase_test_error(format('select public.set_inbounds_number(%L,true)',v_id), '23514');
  UPDATE public.phone_numbers SET is_default=false,is_direct_line=true WHERE id=v_id;
  PERFORM public.phone_purchase_test_error(format('select public.set_inbounds_number(%L,true)',v_id), '23514');
  UPDATE public.phone_numbers SET is_direct_line=false,assignment_type='personal',assigned_to='10000000-0000-4000-8000-000000000012' WHERE id=v_id;
  PERFORM public.phone_purchase_test_error(format('select public.set_inbounds_number(%L,true)',v_id), '23514');
  UPDATE public.phone_numbers SET assignment_type='agency',assigned_to=NULL,status='inactive' WHERE id=v_id;
  PERFORM public.phone_purchase_test_error(format('select public.set_inbounds_number(%L,true)',v_id), 'P0001', 'Choose an active agency number');
  UPDATE public.phone_numbers SET status='active' WHERE id=v_id;
  UPDATE public.inbound_routing_settings SET routing_engine='legacy' WHERE organization_id='10000000-0000-4000-8000-000000000001';
  PERFORM public.phone_purchase_test_error(format('select public.set_inbounds_number(%L,true)',v_id), 'P0001', 'Inbound routing v2 must be active first');
  UPDATE public.inbound_routing_settings SET routing_engine='v2' WHERE organization_id='10000000-0000-4000-8000-000000000001';
END $$;
SET request.jwt.claims='{}';
SET ROLE service_role;
SELECT public.phone_purchase_test_error($q$UPDATE public.phone_numbers SET inbounds_only=true WHERE phone_number='+12025550104'$q$, 'P0001', 'Use the approved authenticated number setting');
RESET ROLE;
SELECT public.phone_purchase_test_assert((SELECT count(*)=2 FROM public.phone_numbers WHERE phone_number IN ('+12025550001','+12025550002') AND trust_hub_status='approved' AND friendly_name LIKE 'Synthetic existing %' AND NOT inbounds_only), 'pre-existing local ownership and Trust Hub state unchanged');
