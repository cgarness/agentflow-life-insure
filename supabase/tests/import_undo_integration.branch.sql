-- =====================================================================================================
-- Import Undo — SQL integration tests, MCP-EXECUTABLE COPY of import_undo_integration.sql
-- =====================================================================================================
-- Identical SQL assertions to import_undo_integration.sql, with ONLY client-side psql constructs removed
-- so it runs via the Supabase MCP `execute_sql` (which has no psql preprocessor): the `\set` variables are
-- replaced by literal UUIDs, the outer BEGIN/ROLLBACK is dropped (run on a throwaway branch), and the
-- `act_as` helper is created as a session-temp function. NO assertion was weakened or removed.
-- Run ONLY on a local/dev branch — never production.

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','Test Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000001','Test Org B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, organization_id, role, first_name, last_name, status) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','Agent','Imp','Orter','Active'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000001','Agent','Other','User','Active')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_uid uuid, p_org uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'organization_id', p_org::text,
                      'app_metadata', json_build_object('organization_id', p_org::text))::text, true);
END$$;

-- ---- Scenario 1: eligible undo (campaign-attached, no engagement) ---------------------------------
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_imp uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_camp uuid := gen_random_uuid(); v_l1 uuid := gen_random_uuid(); v_l2 uuid := gen_random_uuid();
  v_hist uuid := gen_random_uuid(); v_prev jsonb; v_undo jsonb;
BEGIN
  PERFORM pg_temp.act_as(v_imp, v_org);
  INSERT INTO public.campaigns (id, name, type, status, organization_id, user_id)
    VALUES (v_camp, 'Test Camp', 'Open Pool', 'Active', v_org, v_imp);
  INSERT INTO public.leads (id, first_name, last_name, phone, email, state, organization_id, user_id, assigned_agent_id)
    VALUES (v_l1, 'A', 'One', '5550000001', '', 'FL', v_org, v_imp, v_imp),
           (v_l2, 'B', 'Two', '5550000002', '', 'TX', v_org, v_imp, v_imp);
  INSERT INTO public.import_history (id, file_name, total_records, imported, duplicates, errors,
                                     agent_id, organization_id, campaign_id, imported_lead_ids, import_completion_status)
    VALUES (v_hist, 'eligible.csv', 2, 2, 0, 0, v_imp, v_org, v_camp,
            to_jsonb(ARRAY[v_l1::text, v_l2::text]), 'pending_campaign');
  INSERT INTO public.campaign_leads (campaign_id, lead_id, organization_id, status, import_history_id)
    VALUES (v_camp, v_l1, v_org, 'Queued', v_hist),
           (v_camp, v_l2, v_org, 'Queued', v_hist);

  v_prev := public.preview_contact_import_undo(v_hist);
  IF (v_prev->>'eligible')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'S1 expected eligible, got %', v_prev; END IF;

  v_undo := public.undo_contact_import(v_hist);
  IF (v_undo->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'S1 undo failed: %', v_undo; END IF;
  IF (v_undo->>'deleted_leads')::int <> 2 THEN RAISE EXCEPTION 'S1 expected 2 deleted leads, got %', v_undo; END IF;
  IF (v_undo->>'deleted_campaign_rows')::int <> 2 THEN RAISE EXCEPTION 'S1 expected 2 campaign rows, got %', v_undo; END IF;
  IF EXISTS (SELECT 1 FROM public.leads WHERE id IN (v_l1, v_l2)) THEN RAISE EXCEPTION 'S1 leads not deleted'; END IF;
  IF EXISTS (SELECT 1 FROM public.campaign_leads WHERE import_history_id = v_hist) THEN RAISE EXCEPTION 'S1 campaign rows not deleted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.import_history WHERE id = v_hist AND undo_status = 'undone' AND undo_deleted_count = 2) THEN
    RAISE EXCEPTION 'S1 import_history not marked undone';
  END IF;
  v_undo := public.undo_contact_import(v_hist);
  IF (v_undo->>'success')::boolean IS NOT FALSE OR v_undo->>'reason' <> 'already_undone' THEN
    RAISE EXCEPTION 'S1 repeat undo not rejected: %', v_undo;
  END IF;
  RAISE NOTICE 'S1 eligible-undo OK';
END$$;

-- ---- Scenario 2: hidden cross-user engagement blocks undo (transaction integrity) ----------------
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_imp uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_l1 uuid := gen_random_uuid(); v_hist uuid := gen_random_uuid(); v_undo jsonb; v_prev jsonb;
BEGIN
  PERFORM pg_temp.act_as(v_imp, v_org);
  INSERT INTO public.leads (id, first_name, last_name, phone, email, state, organization_id, user_id, assigned_agent_id)
    VALUES (v_l1, 'C', 'Three', '5550000003', '', 'FL', v_org, v_imp, v_imp);
  INSERT INTO public.import_history (id, file_name, total_records, imported, duplicates, errors,
                                     agent_id, organization_id, imported_lead_ids, import_completion_status)
    VALUES (v_hist, 'engaged.csv', 1, 1, 0, 0, v_imp, v_org, to_jsonb(ARRAY[v_l1::text]), 'completed');
  INSERT INTO public.calls (organization_id, contact_id, contact_type, agent_id, direction)
    VALUES (v_org, v_l1, 'lead', gen_random_uuid(), 'outbound');

  v_prev := public.preview_contact_import_undo(v_hist);
  IF (v_prev->>'eligible')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'S2 expected ineligible'; END IF;
  IF NOT (v_prev->'blocked_reason_codes' ? 'has_calls') THEN RAISE EXCEPTION 'S2 expected has_calls: %', v_prev; END IF;

  v_undo := public.undo_contact_import(v_hist);
  IF (v_undo->>'success')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'S2 undo should be blocked'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = v_l1) THEN RAISE EXCEPTION 'S2 lead must NOT be deleted'; END IF;
  RAISE NOTICE 'S2 engagement-blocks-undo OK';
END$$;

-- ---- Scenario 3: legacy empty-ID + expired ineligibility ------------------------------------------
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_imp uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_legacy uuid := gen_random_uuid(); v_expired uuid := gen_random_uuid(); v_l uuid := gen_random_uuid(); v_prev jsonb;
BEGIN
  PERFORM pg_temp.act_as(v_imp, v_org);
  INSERT INTO public.import_history (id, file_name, total_records, imported, agent_id, organization_id, imported_lead_ids)
    VALUES (v_legacy, 'legacy.csv', 5, 5, v_imp, v_org, '[]'::jsonb);
  v_prev := public.preview_contact_import_undo(v_legacy);
  IF (v_prev->'blocked_reason_codes' ? 'legacy_no_ids') IS NOT TRUE THEN RAISE EXCEPTION 'S3 expected legacy_no_ids: %', v_prev; END IF;

  INSERT INTO public.leads (id, first_name, last_name, phone, email, state, organization_id, user_id, assigned_agent_id)
    VALUES (v_l, 'D', 'Four', '5550000004', '', 'FL', v_org, v_imp, v_imp);
  INSERT INTO public.import_history (id, file_name, total_records, imported, agent_id, organization_id, imported_lead_ids, created_at)
    VALUES (v_expired, 'old.csv', 1, 1, v_imp, v_org, to_jsonb(ARRAY[v_l::text]), now() - interval '25 hours');
  v_prev := public.preview_contact_import_undo(v_expired);
  IF (v_prev->'blocked_reason_codes' ? 'expired') IS NOT TRUE THEN RAISE EXCEPTION 'S3 expected expired: %', v_prev; END IF;
  RAISE NOTICE 'S3 legacy/expired OK';
END$$;

-- ---- Scenario 4: cross-org rejection --------------------------------------------------------------
DO $$
DECLARE
  v_org_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_imp uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_other uuid := 'bbbbbbbb-0000-0000-0000-0000000000b1';
  v_org_b uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_l uuid := gen_random_uuid(); v_hist uuid := gen_random_uuid(); v_prev jsonb; v_undo jsonb;
BEGIN
  INSERT INTO public.leads (id, first_name, last_name, phone, email, state, organization_id, user_id, assigned_agent_id)
    VALUES (v_l, 'E', 'Five', '5550000005', '', 'FL', v_org_a, v_imp, v_imp);
  INSERT INTO public.import_history (id, file_name, total_records, imported, agent_id, organization_id, imported_lead_ids)
    VALUES (v_hist, 'orgA.csv', 1, 1, v_imp, v_org_a, to_jsonb(ARRAY[v_l::text]));
  PERFORM pg_temp.act_as(v_other, v_org_b);
  v_prev := public.preview_contact_import_undo(v_hist);
  IF (v_prev->'blocked_reason_codes' ? 'cross_org') IS NOT TRUE THEN RAISE EXCEPTION 'S4 expected cross_org: %', v_prev; END IF;
  v_undo := public.undo_contact_import(v_hist);
  IF (v_undo->>'reason') <> 'cross_org' THEN RAISE EXCEPTION 'S4 undo should be cross_org: %', v_undo; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = v_l) THEN RAISE EXCEPTION 'S4 cross-org must not delete'; END IF;
  RAISE NOTICE 'S4 cross-org OK';
END$$;

-- ---- Scenario 5: finalize 'completed_with_skips' via the real attach path (metadata-driven) --------
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_imp uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_camp uuid := gen_random_uuid(); v_l1 uuid := gen_random_uuid(); v_l2 uuid := gen_random_uuid();
  v_hist uuid := gen_random_uuid(); v_res jsonb; v_fin jsonb;
BEGIN
  PERFORM pg_temp.act_as(v_imp, v_org);
  INSERT INTO public.campaigns (id, name, type, status, organization_id, user_id)
    VALUES (v_camp, 'Personal C', 'Personal', 'Active', v_org, v_imp);
  INSERT INTO public.leads (id, first_name, last_name, phone, email, state, organization_id, user_id, assigned_agent_id)
    VALUES (v_l1, 'F', 'Six', '5550000006', '', 'FL', v_org, v_imp, v_imp),
           (v_l2, 'G', 'Sev', '5550000007', '', 'TX', v_org, NULL, NULL);
  INSERT INTO public.import_history (id, file_name, total_records, imported, agent_id, organization_id, campaign_id, imported_lead_ids, import_completion_status)
    VALUES (v_hist, 'mix.csv', 2, 2, v_imp, v_org, v_camp, to_jsonb(ARRAY[v_l1::text, v_l2::text]), 'pending_campaign');

  v_res := public.add_leads_to_campaign(v_camp, ARRAY[v_l1, v_l2], v_hist);
  IF (v_res->>'added')::int <> 1 OR (v_res->>'skipped')::int <> 1 THEN RAISE EXCEPTION 'S5 expected 1 added/1 skipped, got %', v_res; END IF;

  v_fin := public.finalize_contact_import(v_hist);
  IF (v_fin->>'status') <> 'completed_with_skips' THEN RAISE EXCEPTION 'S5 expected completed_with_skips, got %', v_fin; END IF;
  v_fin := public.finalize_contact_import(v_hist);
  IF (v_fin->>'status') <> 'completed_with_skips' OR (v_fin->>'idempotent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'S5 finalize not idempotent: %', v_fin;
  END IF;
  RAISE NOTICE 'S5 finalize completed_with_skips OK';
END$$;

-- ---- Scenario 6: generic Add-to-Campaign (no import id) unchanged; nothing tagged -----------------
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_imp uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_camp uuid := gen_random_uuid(); v_l1 uuid := gen_random_uuid(); v_res jsonb;
BEGIN
  PERFORM pg_temp.act_as(v_imp, v_org);
  INSERT INTO public.campaigns (id, name, type, status, organization_id, user_id)
    VALUES (v_camp, 'Open C', 'Open Pool', 'Active', v_org, v_imp);
  INSERT INTO public.leads (id, first_name, last_name, phone, email, state, organization_id, user_id, assigned_agent_id)
    VALUES (v_l1, 'H', 'Eig', '5550000008', '', 'FL', v_org, v_imp, v_imp);
  v_res := public.add_leads_to_campaign(v_camp, ARRAY[v_l1]);
  IF (v_res->>'added')::int <> 1 THEN RAISE EXCEPTION 'S6 expected 1 added, got %', v_res; END IF;
  IF EXISTS (SELECT 1 FROM public.campaign_leads WHERE campaign_id = v_camp AND import_history_id IS NOT NULL) THEN
    RAISE EXCEPTION 'S6 generic add must not tag provenance';
  END IF;
  RAISE NOTICE 'S6 generic-add OK';
END$$;

-- ---- Scenario 7: 3-arg tags newly-inserted rows + accumulates metadata; completed when no skips ----
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_imp uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_camp uuid := gen_random_uuid(); v_l1 uuid := gen_random_uuid(); v_l2 uuid := gen_random_uuid();
  v_hist uuid := gen_random_uuid(); v_meta jsonb; v_fin jsonb;
BEGIN
  PERFORM pg_temp.act_as(v_imp, v_org);
  INSERT INTO public.campaigns (id, name, type, status, organization_id, user_id)
    VALUES (v_camp, 'Open C2', 'Open Pool', 'Active', v_org, v_imp);
  INSERT INTO public.leads (id, first_name, last_name, phone, email, state, organization_id, user_id, assigned_agent_id)
    VALUES (v_l1, 'I', 'Nin', '5550000009', '', 'FL', v_org, v_imp, v_imp),
           (v_l2, 'J', 'Ten', '5550000010', '', 'TX', v_org, v_imp, v_imp);
  INSERT INTO public.import_history (id, file_name, total_records, imported, agent_id, organization_id, campaign_id, imported_lead_ids, import_completion_status)
    VALUES (v_hist, 't.csv', 2, 2, v_imp, v_org, v_camp, to_jsonb(ARRAY[v_l1::text, v_l2::text]), 'pending_campaign');
  PERFORM public.add_leads_to_campaign(v_camp, ARRAY[v_l1, v_l2], v_hist);
  IF (SELECT count(*) FROM public.campaign_leads WHERE import_history_id = v_hist) <> 2 THEN RAISE EXCEPTION 'S7 expected 2 tagged'; END IF;
  SELECT import_completion_metadata INTO v_meta FROM public.import_history WHERE id = v_hist;
  IF (v_meta->>'attempted')::int <> 2 OR (v_meta->>'added')::int <> 2 OR (v_meta->>'skipped')::int <> 0 OR (v_meta->>'batches')::int <> 1 THEN
    RAISE EXCEPTION 'S7 metadata wrong: %', v_meta;
  END IF;
  v_fin := public.finalize_contact_import(v_hist);
  IF (v_fin->>'status') <> 'completed' THEN RAISE EXCEPTION 'S7 expected completed, got %', v_fin; END IF;
  RAISE NOTICE 'S7 tagging+metadata OK';
END$$;

-- ---- Scenario 8/9/10/11: validation rejections + no-retag --------------------------------------------
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_org_b uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_imp uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_other uuid := 'bbbbbbbb-0000-0000-0000-0000000000b1';
  v_camp uuid := gen_random_uuid(); v_camp2 uuid := gen_random_uuid();
  v_l1 uuid := gen_random_uuid(); v_l2 uuid := gen_random_uuid(); v_lx uuid := gen_random_uuid();
  v_hist uuid := gen_random_uuid(); v_histb uuid := gen_random_uuid(); v_raised boolean;
BEGIN
  PERFORM pg_temp.act_as(v_imp, v_org);
  INSERT INTO public.campaigns (id, name, type, status, organization_id, user_id)
    VALUES (v_camp, 'C-A', 'Open Pool', 'Active', v_org, v_imp),
           (v_camp2, 'C-A2', 'Open Pool', 'Active', v_org, v_imp);
  INSERT INTO public.leads (id, first_name, last_name, phone, email, state, organization_id, user_id, assigned_agent_id)
    VALUES (v_l1, 'K', 'A', '5550000011', '', 'FL', v_org, v_imp, v_imp),
           (v_l2, 'L', 'B', '5550000012', '', 'TX', v_org, v_imp, v_imp),
           (v_lx, 'X', 'Z', '5550000013', '', 'TX', v_org, v_imp, v_imp);
  INSERT INTO public.import_history (id, file_name, total_records, imported, agent_id, organization_id, campaign_id, imported_lead_ids, import_completion_status)
    VALUES (v_hist, 'a.csv', 2, 2, v_imp, v_org, v_camp, to_jsonb(ARRAY[v_l1::text, v_l2::text]), 'pending_campaign');

  v_raised := false;
  BEGIN PERFORM public.add_leads_to_campaign(v_camp2, ARRAY[v_l1], v_hist);
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'S8 campaign mismatch not rejected'; END IF;

  v_raised := false;
  BEGIN PERFORM public.add_leads_to_campaign(v_camp, ARRAY[v_l1, v_lx], v_hist);
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'S10 foreign lead not rejected'; END IF;
  IF EXISTS (SELECT 1 FROM public.campaign_leads WHERE import_history_id = v_hist) THEN
    RAISE EXCEPTION 'S10 nothing should have been tagged after rejection';
  END IF;

  INSERT INTO public.campaign_leads (campaign_id, lead_id, organization_id, status, import_history_id)
    VALUES (v_camp, v_l1, v_org, 'Queued', NULL);
  PERFORM public.add_leads_to_campaign(v_camp, ARRAY[v_l1, v_l2], v_hist);
  IF EXISTS (SELECT 1 FROM public.campaign_leads WHERE campaign_id = v_camp AND lead_id = v_l1 AND import_history_id IS NOT NULL) THEN
    RAISE EXCEPTION 'S11 pre-existing membership must not be retagged';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.campaign_leads WHERE campaign_id = v_camp AND lead_id = v_l2 AND import_history_id = v_hist) THEN
    RAISE EXCEPTION 'S11 new lead must be tagged';
  END IF;

  INSERT INTO public.import_history (id, file_name, total_records, imported, agent_id, organization_id, campaign_id, imported_lead_ids, import_completion_status)
    VALUES (v_histb, 'b.csv', 1, 1, v_other, v_org_b, v_camp, to_jsonb(ARRAY[v_l1::text]), 'pending_campaign');
  v_raised := false;
  BEGIN PERFORM public.add_leads_to_campaign(v_camp, ARRAY[v_l1], v_histb);
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'S9 cross-org history not rejected'; END IF;
  RAISE NOTICE 'S8/9/10/11 add_leads validation OK';
END$$;

-- ---- Scenario 12: finalize 'campaign_partial' when a later batch never attempted -------------------
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_imp uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_camp uuid := gen_random_uuid();
  v_l1 uuid := gen_random_uuid(); v_l2 uuid := gen_random_uuid(); v_l3 uuid := gen_random_uuid();
  v_hist uuid := gen_random_uuid(); v_fin jsonb;
BEGIN
  PERFORM pg_temp.act_as(v_imp, v_org);
  INSERT INTO public.campaigns (id, name, type, status, organization_id, user_id)
    VALUES (v_camp, 'Open C3', 'Open Pool', 'Active', v_org, v_imp);
  INSERT INTO public.leads (id, first_name, last_name, phone, email, state, organization_id, user_id, assigned_agent_id)
    VALUES (v_l1, 'M', 'A', '5550000014', '', 'FL', v_org, v_imp, v_imp),
           (v_l2, 'N', 'B', '5550000015', '', 'FL', v_org, v_imp, v_imp),
           (v_l3, 'O', 'C', '5550000016', '', 'FL', v_org, v_imp, v_imp);
  INSERT INTO public.import_history (id, file_name, total_records, imported, agent_id, organization_id, campaign_id, imported_lead_ids, import_completion_status)
    VALUES (v_hist, 'p.csv', 3, 3, v_imp, v_org, v_camp, to_jsonb(ARRAY[v_l1::text, v_l2::text, v_l3::text]), 'pending_campaign');
  PERFORM public.add_leads_to_campaign(v_camp, ARRAY[v_l1, v_l2], v_hist);
  v_fin := public.finalize_contact_import(v_hist);
  IF (v_fin->>'status') <> 'campaign_partial' THEN RAISE EXCEPTION 'S12 expected campaign_partial, got %', v_fin; END IF;
  RAISE NOTICE 'S12 partial-interrupted OK';
END$$;

-- ---- Scenario 13: ACLs on the new/extended functions ---------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.add_leads_to_campaign(uuid, uuid[], uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: anon must NOT execute add_leads_to_campaign'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.add_leads_to_campaign(uuid, uuid[], uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: authenticated must execute add_leads_to_campaign'; END IF;
  IF NOT has_function_privilege('service_role', 'public.add_leads_to_campaign(uuid, uuid[], uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: service_role must execute add_leads_to_campaign'; END IF;
  IF has_function_privilege('anon', 'public.undo_contact_import(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: anon must NOT execute undo_contact_import'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.undo_contact_import(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: authenticated must execute undo_contact_import'; END IF;
  IF has_function_privilege('authenticated', 'public._import_undo_context(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: authenticated must NOT execute the private helper _import_undo_context'; END IF;
  IF has_function_privilege('service_role', 'public._import_undo_context(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: service_role must NOT execute the private helper _import_undo_context'; END IF;
  IF has_function_privilege('service_role', 'public._import_undo_blockers(uuid, uuid, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: service_role must NOT execute the private helper _import_undo_blockers'; END IF;
  RAISE NOTICE 'S13 ACLs OK';
END$$;

-- ---- Scenario 14: >500 leads across 3 batches -> exact metadata accumulation + completed -----------
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_imp uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_camp uuid := gen_random_uuid(); v_ids uuid[] := ARRAY[]::uuid[];
  v_hist uuid := gen_random_uuid(); v_meta jsonb; v_fin jsonb; i int; v_id uuid;
BEGIN
  PERFORM pg_temp.act_as(v_imp, v_org);
  INSERT INTO public.campaigns (id,name,type,status,organization_id,user_id) VALUES (v_camp,'Big','Open Pool','Active',v_org,v_imp);
  FOR i IN 1..1200 LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.leads (id, organization_id, user_id, assigned_agent_id, state) VALUES (v_id, v_org, v_imp, v_imp, 'FL');
    v_ids := array_append(v_ids, v_id);
  END LOOP;
  INSERT INTO public.import_history (id,file_name,total_records,imported,agent_id,organization_id,campaign_id,imported_lead_ids,import_completion_status)
    VALUES (v_hist,'big.csv',1200,1200,v_imp,v_org,v_camp,to_jsonb(v_ids::text[]),'pending_campaign');
  PERFORM public.add_leads_to_campaign(v_camp, v_ids[1:500], v_hist);
  PERFORM public.add_leads_to_campaign(v_camp, v_ids[501:1000], v_hist);
  PERFORM public.add_leads_to_campaign(v_camp, v_ids[1001:1200], v_hist);
  SELECT import_completion_metadata INTO v_meta FROM public.import_history WHERE id=v_hist;
  IF (v_meta->>'attempted')::int <> 1200 OR (v_meta->>'added')::int <> 1200 OR (v_meta->>'skipped')::int <> 0 OR (v_meta->>'batches')::int <> 3 THEN
    RAISE EXCEPTION 'S14 metadata accumulation wrong: %', v_meta; END IF;
  IF (SELECT count(*) FROM public.campaign_leads WHERE import_history_id=v_hist) <> 1200 THEN RAISE EXCEPTION 'S14 expected 1200 tagged'; END IF;
  v_fin := public.finalize_contact_import(v_hist);
  IF (v_fin->>'status') <> 'completed' THEN RAISE EXCEPTION 'S14 expected completed, got %', v_fin; END IF;
  RAISE NOTICE 'S14 multi-batch metadata OK';
END$$;

-- ---- Scenario 15: malformed / duplicate / null / non-string / invalid-uuid provenance --------------
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_imp uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_dup uuid := gen_random_uuid(); v_nonstr uuid := gen_random_uuid();
  v_nullel uuid := gen_random_uuid(); v_baduuid uuid := gen_random_uuid(); v_g uuid := gen_random_uuid();
  v_prev jsonb;
BEGIN
  PERFORM pg_temp.act_as(v_imp, v_org);
  INSERT INTO public.import_history (id,file_name,total_records,imported,agent_id,organization_id,imported_lead_ids)
    VALUES (v_dup,'dup.csv',2,2,v_imp,v_org, to_jsonb(ARRAY[v_g::text, v_g::text]));
  v_prev := public.preview_contact_import_undo(v_dup);
  IF (v_prev->'blocked_reason_codes' ? 'invalid_import_provenance') IS NOT TRUE THEN RAISE EXCEPTION 'S15 dup not rejected: %', v_prev; END IF;
  INSERT INTO public.import_history (id,file_name,total_records,imported,agent_id,organization_id,imported_lead_ids)
    VALUES (v_nonstr,'ns.csv',1,1,v_imp,v_org, '[123]'::jsonb);
  v_prev := public.preview_contact_import_undo(v_nonstr);
  IF (v_prev->'blocked_reason_codes' ? 'invalid_import_provenance') IS NOT TRUE THEN RAISE EXCEPTION 'S15 nonstring not rejected: %', v_prev; END IF;
  INSERT INTO public.import_history (id,file_name,total_records,imported,agent_id,organization_id,imported_lead_ids)
    VALUES (v_nullel,'nl.csv',1,1,v_imp,v_org, '[null]'::jsonb);
  v_prev := public.preview_contact_import_undo(v_nullel);
  IF (v_prev->'blocked_reason_codes' ? 'invalid_import_provenance') IS NOT TRUE THEN RAISE EXCEPTION 'S15 null not rejected: %', v_prev; END IF;
  INSERT INTO public.import_history (id,file_name,total_records,imported,agent_id,organization_id,imported_lead_ids)
    VALUES (v_baduuid,'bad.csv',1,1,v_imp,v_org, '["not-a-uuid"]'::jsonb);
  v_prev := public.preview_contact_import_undo(v_baduuid);
  IF (v_prev->'blocked_reason_codes' ? 'invalid_import_provenance') IS NOT TRUE THEN RAISE EXCEPTION 'S15 invalid-uuid not rejected: %', v_prev; END IF;
  RAISE NOTICE 'S15 malformed-provenance OK';
END$$;

DO $$ BEGIN RAISE NOTICE 'ALL IMPORT-UNDO + PROVENANCE INTEGRATION SCENARIOS PASSED'; END$$;
