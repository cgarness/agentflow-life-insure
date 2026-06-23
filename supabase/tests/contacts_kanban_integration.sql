-- =====================================================================================================
-- Contacts Kanban aggregates — SQL integration tests (Contacts Build 4, CP2)
-- =====================================================================================================
-- STATUS: PENDING-EXECUTION. Run ONLY against a LOCAL Supabase stack (`supabase db reset` / psql) or an
-- APPROVED Supabase dev BRANCH — never production. Requires migration 20260622120000 applied AND the
-- canonical Build 2 helpers `_contacts_filtered_leads` / `_contacts_filtered_recruits` +
-- `search_contacts_leads` / `search_contacts_recruits` present. The whole script runs in one transaction
-- and ROLLBACKs at the end, so it persists nothing even if misdirected.
--
-- Auth is simulated by setting request.jwt.claims (so auth.uid()/get_org_id() resolve) plus seeded
-- profile rows. Assertions raise EXCEPTION on failure.
--
-- Covers: grand_total parity with search_contacts_leads (status ignored), per-stage totals sum to
-- grand_total, the single-status filter is ignored (D1), unmapped statuses are returned (D3), the
-- per-column slice is bounded while totals stay exact, org/RLS scoping excludes other-org rows, recruit
-- parity with search_contacts_recruits, and ACL posture (anon denied / authenticated allowed).
-- =====================================================================================================

BEGIN;

\set ORG_A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set ORG_B '''bbbbbbbb-0000-0000-0000-000000000001'''
\set AGENT  '''aaaaaaaa-0000-0000-0000-0000000000a1'''

INSERT INTO public.organizations (id, name) VALUES
  (:ORG_A::uuid, 'Kanban Test Org A'),
  (:ORG_B::uuid, 'Kanban Test Org B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, organization_id, role, first_name, last_name, status)
VALUES (:AGENT::uuid, :ORG_A::uuid, 'Admin', 'Kan', 'Ban', 'Active')
ON CONFLICT (id) DO NOTHING;

-- Configured lead stages for org A: New(0), Quoted(1). 'Legacy' is intentionally NOT a stage.
INSERT INTO public.pipeline_stages (id, organization_id, name, color, pipeline_type, is_default, is_positive, convert_to_client, sort_order)
VALUES
  (gen_random_uuid(), :ORG_A::uuid, 'New',    '#3B82F6', 'lead', true,  false, false, 0),
  (gen_random_uuid(), :ORG_A::uuid, 'Quoted', '#F59E0B', 'lead', false, false, false, 1)
ON CONFLICT DO NOTHING;

-- Leads in org A: 3 New, 2 Quoted, 1 Legacy (unmapped). One lead in org B (must be excluded).
INSERT INTO public.leads (id, organization_id, user_id, assigned_agent_id, first_name, last_name, status, lead_source, state)
SELECT gen_random_uuid(), :ORG_A::uuid, :AGENT::uuid, :AGENT::uuid, 'New', n::text, 'New', 'Test', 'TX'
FROM generate_series(1, 3) n;
INSERT INTO public.leads (id, organization_id, user_id, assigned_agent_id, first_name, last_name, status, lead_source, state)
SELECT gen_random_uuid(), :ORG_A::uuid, :AGENT::uuid, :AGENT::uuid, 'Quo', n::text, 'Quoted', 'Test', 'TX'
FROM generate_series(1, 2) n;
INSERT INTO public.leads (id, organization_id, user_id, assigned_agent_id, first_name, last_name, status, lead_source, state)
VALUES (gen_random_uuid(), :ORG_A::uuid, :AGENT::uuid, :AGENT::uuid, 'Leg', 'Acy', 'Legacy', 'Test', 'TX');
INSERT INTO public.leads (id, organization_id, user_id, assigned_agent_id, first_name, last_name, status, lead_source, state)
VALUES (gen_random_uuid(), :ORG_B::uuid, :AGENT::uuid, :AGENT::uuid, 'Other', 'Org', 'New', 'Test', 'TX');

-- Recruits in org A: 2 'Interview', 1 'Hired'.
INSERT INTO public.recruits (id, organization_id, assigned_agent_id, first_name, last_name, status, state)
SELECT gen_random_uuid(), :ORG_A::uuid, :AGENT::uuid, 'Rec', n::text, 'Interview', 'TX' FROM generate_series(1, 2) n;
INSERT INTO public.recruits (id, organization_id, assigned_agent_id, first_name, last_name, status, state)
VALUES (gen_random_uuid(), :ORG_A::uuid, :AGENT::uuid, 'Rec', '3', 'Hired', 'TX');

-- Act as the org-A admin.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', :AGENT, 'role', 'authenticated',
    'app_metadata', json_build_object('organization_id', :ORG_A))::text, true);

DO $$
DECLARE
  v_kanban    jsonb;
  v_table     jsonb;
  v_kanban2   jsonb;
  v_sum       int;
  v_grand     int;
  v_legacy    int;
  v_new_total int;
  v_new_cards int;
BEGIN
  -- T1 — grand_total parity with the table RPC under the same (status-less) filter.
  v_kanban := public.get_contacts_lead_kanban('{"scope":"agency"}'::jsonb, 50);
  v_table  := public.search_contacts_leads('{"scope":"agency","page":0,"page_size":1000}'::jsonb);
  v_grand  := (v_kanban->>'grand_total')::int;
  IF v_grand <> (v_table->>'total_count')::int THEN
    RAISE EXCEPTION 'T1 parity FAILED: kanban grand_total=% vs table total_count=%', v_grand, v_table->>'total_count';
  END IF;
  IF v_grand <> 6 THEN
    RAISE EXCEPTION 'T1 expected 6 org-A leads (3 New + 2 Quoted + 1 Legacy), got %', v_grand;
  END IF;

  -- T2 — per-stage totals sum to grand_total.
  SELECT sum((s->>'total')::int) INTO v_sum FROM jsonb_array_elements(v_kanban->'stages') s;
  IF v_sum <> v_grand THEN
    RAISE EXCEPTION 'T2 sum-of-stage-totals FAILED: sum=% grand=%', v_sum, v_grand;
  END IF;

  -- T3 — the single-status filter is IGNORED (D1): adding status=Quoted changes nothing.
  v_kanban2 := public.get_contacts_lead_kanban('{"scope":"agency","status":"Quoted"}'::jsonb, 50);
  IF (v_kanban2->>'grand_total')::int <> v_grand THEN
    RAISE EXCEPTION 'T3 status-ignored FAILED: with-status grand=% vs %', v_kanban2->>'grand_total', v_grand;
  END IF;

  -- T4 — the unmapped 'Legacy' status is returned with its exact count (D3).
  SELECT (s->>'total')::int INTO v_legacy
  FROM jsonb_array_elements(v_kanban->'stages') s WHERE s->>'status' = 'Legacy';
  IF coalesce(v_legacy, 0) <> 1 THEN
    RAISE EXCEPTION 'T4 unmapped status FAILED: Legacy total=%', v_legacy;
  END IF;

  -- T5 — per-column slice is bounded by p_per_column while totals stay exact.
  v_kanban := public.get_contacts_lead_kanban('{"scope":"agency"}'::jsonb, 1);
  SELECT (s->>'total')::int, jsonb_array_length(s->'cards') INTO v_new_total, v_new_cards
  FROM jsonb_array_elements(v_kanban->'stages') s WHERE s->>'status' = 'New';
  IF v_new_total <> 3 THEN
    RAISE EXCEPTION 'T5 exact total FAILED: New total=% (expected 3)', v_new_total;
  END IF;
  IF v_new_cards <> 1 THEN
    RAISE EXCEPTION 'T5 bounded slice FAILED: New cards=% (expected 1 with p_per_column=1)', v_new_cards;
  END IF;

  -- T6 — org/RLS scoping: the org-B lead is excluded (grand_total stayed 6, not 7).
  --       (Re-fetch full to be explicit.)
  v_kanban := public.get_contacts_lead_kanban('{"scope":"agency"}'::jsonb, 50);
  IF (v_kanban->>'grand_total')::int <> 6 THEN
    RAISE EXCEPTION 'T6 org scoping FAILED: grand_total=% (org-B lead leaked?)', v_kanban->>'grand_total';
  END IF;

  -- T7 — recruit grand_total parity with the recruit table RPC.
  v_kanban := public.get_contacts_recruit_kanban('{}'::jsonb, 50);
  v_table  := public.search_contacts_recruits('{"page":0,"page_size":1000}'::jsonb);
  IF (v_kanban->>'grand_total')::int <> (v_table->>'total_count')::int THEN
    RAISE EXCEPTION 'T7 recruit parity FAILED: kanban=% table=%', v_kanban->>'grand_total', v_table->>'total_count';
  END IF;
  IF (v_kanban->>'grand_total')::int <> 3 THEN
    RAISE EXCEPTION 'T7 expected 3 recruits, got %', v_kanban->>'grand_total';
  END IF;

  RAISE NOTICE 'Kanban data tests T1-T7 PASSED';
END $$;

-- T8 — ACL posture: authenticated may execute; anon may not.
DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.get_contacts_lead_kanban(jsonb,int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T8 ACL FAILED: authenticated cannot execute get_contacts_lead_kanban';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_contacts_recruit_kanban(jsonb,int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T8 ACL FAILED: authenticated cannot execute get_contacts_recruit_kanban';
  END IF;
  IF has_function_privilege('anon', 'public.get_contacts_lead_kanban(jsonb,int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T8 ACL FAILED: anon CAN execute get_contacts_lead_kanban (should be revoked)';
  END IF;
  IF has_function_privilege('anon', 'public.get_contacts_recruit_kanban(jsonb,int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T8 ACL FAILED: anon CAN execute get_contacts_recruit_kanban (should be revoked)';
  END IF;
  RAISE NOTICE 'Kanban ACL test T8 PASSED';
END $$;

ROLLBACK;
