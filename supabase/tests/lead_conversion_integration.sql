-- =====================================================================================================
-- Atomic Lead-to-Client conversion — SQL integration tests (Contacts Build 3, CP4)
-- =====================================================================================================
-- STATUS: run ONLY on a LOCAL Supabase stack or an APPROVED Supabase dev BRANCH — never production.
-- Requires the harness schema (incl. a `clients` table that still has the lead_id FK) and migration
-- 20260620000200 applied. Auth is simulated via request.jwt.claims + seeded profiles. Each scenario is an
-- independent DO block; an uncaught RAISE names the failing scenario. No assertion is weakened.
--
-- Fixtures: org A (a000…A) + org B (b000…B); users in A: agent1 (a…a1, owns leads), agent2 (a…a2),
-- admin (a…ad), superadmin (a…s1); in B: other (b…b1).

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000A','Conv Org A'),
  ('bbbbbbbb-0000-0000-0000-00000000000B','Conv Org B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, organization_id, role, is_super_admin, first_name, last_name, status) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000A','Agent',       false,'Ag','One','Active'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-00000000000A','Agent',       false,'Ag','Two','Active'),
  ('aaaaaaaa-0000-0000-0000-0000000000ad','aaaaaaaa-0000-0000-0000-00000000000A','Admin',       false,'Ad','Min','Active'),
  ('aaaaaaaa-0000-0000-0000-0000000000c5','aaaaaaaa-0000-0000-0000-00000000000A','Super Admin', true, 'Su','Per','Active'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000B','Agent',       false,'Ot','Her','Active')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_uid uuid, p_org uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'app_metadata', json_build_object('organization_id', p_org::text))::text, true);
END$$;

-- ---- C1: eligible atomic conversion — client created, full graph moved, telemetry + campaign preserved
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000A';
  v_agent uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_lead uuid := gen_random_uuid(); v_camp uuid := gen_random_uuid(); v_cl uuid := gen_random_uuid();
  v_res jsonb; v_client uuid; v_call_dur int;
BEGIN
  PERFORM pg_temp.act_as(v_agent, v_org);
  INSERT INTO public.campaigns (id,name,type,status,organization_id,user_id) VALUES (v_camp,'C','Open Pool','Active',v_org,v_agent);
  INSERT INTO public.leads (id, first_name,last_name,phone,email,state,organization_id,user_id,assigned_agent_id,notes)
    VALUES (v_lead,'Pat','Lee','555','p@x.com','FL',v_org,v_agent,v_agent,'lead note');
  INSERT INTO public.contact_notes (contact_id,contact_type,organization_id) VALUES (v_lead,'lead',v_org);
  INSERT INTO public.contact_activities (contact_id,contact_type,organization_id) VALUES (v_lead,'lead',v_org);
  INSERT INTO public.appointments (contact_id,organization_id) VALUES (v_lead,v_org);
  INSERT INTO public.tasks (contact_id,contact_type,organization_id) VALUES (v_lead,'lead',v_org);
  INSERT INTO public.calls (contact_id,contact_type,lead_id,agent_id,direction,duration,disposition_name,campaign_lead_id,organization_id)
    VALUES (v_lead,'lead',v_lead,v_agent,'outbound',73,'Interested',v_cl,v_org);
  INSERT INTO public.messages (contact_id,contact_type,lead_id,organization_id) VALUES (v_lead,'lead',v_lead,v_org);
  INSERT INTO public.contact_emails (contact_id,organization_id) VALUES (v_lead,v_org);
  INSERT INTO public.workflow_executions (contact_id,contact_type,status,organization_id) VALUES (v_lead,'lead','completed',v_org);
  INSERT INTO public.campaign_leads (id,campaign_id,lead_id,organization_id,status,disposition) VALUES (v_cl,v_camp,v_lead,v_org,'Called','Interested');

  v_res := public.convert_lead_to_client_atomic(v_lead, jsonb_build_object(
    'policy_type','IUL','carrier','Acme','policy_number','P-1','premium',125.5,'face_amount',500000,
    'issue_date','2026-01-02','effective_date','2026-02-03','beneficiary_name','B','custom_fields',jsonb_build_object('foo','bar')));
  v_client := (v_res->>'client_id')::uuid;

  IF (v_res->>'idempotent')::boolean THEN RAISE EXCEPTION 'C1 should not be idempotent: %', v_res; END IF;
  -- client canonical columns
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id=v_client AND policy_type='IUL' AND carrier='Acme'
       AND premium=125.5 AND face_amount=500000 AND issue_date='2026-01-02' AND effective_date='2026-02-03'
       AND lead_id=v_lead AND assigned_agent_id=v_agent AND organization_id=v_org
       AND custom_fields->>'foo'='bar') THEN
    RAISE EXCEPTION 'C1 client canonical columns wrong'; END IF;
  -- premium_amount NEVER written (stays default 0)
  IF (SELECT premium_amount FROM public.clients WHERE id=v_client) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'C1 premium_amount must not be written (got %)', (SELECT premium_amount FROM public.clients WHERE id=v_client); END IF;
  -- lead deleted
  IF EXISTS (SELECT 1 FROM public.leads WHERE id=v_lead) THEN RAISE EXCEPTION 'C1 lead not deleted'; END IF;
  -- lineage survives lead deletion (FK dropped → not nulled)
  IF (SELECT lead_id FROM public.clients WHERE id=v_client) <> v_lead THEN RAISE EXCEPTION 'C1 lineage lead_id lost'; END IF;
  -- graph moved to client
  IF NOT EXISTS (SELECT 1 FROM public.contact_notes WHERE contact_id=v_client AND contact_type='client') THEN RAISE EXCEPTION 'C1 notes not moved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contact_activities WHERE contact_id=v_client AND contact_type='client') THEN RAISE EXCEPTION 'C1 activities not moved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE contact_id=v_client) THEN RAISE EXCEPTION 'C1 appt not moved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE contact_id=v_client AND contact_type='client') THEN RAISE EXCEPTION 'C1 task not moved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.calls WHERE contact_id=v_client AND contact_type='client') THEN RAISE EXCEPTION 'C1 call not moved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE contact_id=v_client AND contact_type='client') THEN RAISE EXCEPTION 'C1 message not moved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contact_emails WHERE contact_id=v_client) THEN RAISE EXCEPTION 'C1 email not moved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_executions WHERE contact_id=v_client AND contact_type='client') THEN RAISE EXCEPTION 'C1 workflow not moved'; END IF;
  -- call telemetry preserved (duration + disposition + campaign_lead_id intact)
  SELECT duration INTO v_call_dur FROM public.calls WHERE contact_id=v_client;
  IF v_call_dur <> 73 THEN RAISE EXCEPTION 'C1 call duration changed: %', v_call_dur; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.calls WHERE contact_id=v_client AND disposition_name='Interested' AND campaign_lead_id=v_cl) THEN
    RAISE EXCEPTION 'C1 call telemetry (disposition/campaign_lead_id) lost'; END IF;
  -- campaign queue preserved (row remains; lead_id SET NULL by existing FK)
  IF NOT EXISTS (SELECT 1 FROM public.campaign_leads WHERE id=v_cl AND disposition='Interested') THEN RAISE EXCEPTION 'C1 campaign_leads row lost'; END IF;
  -- transferred counts reported
  IF (v_res->'transferred'->>'calls')::int <> 1 OR (v_res->'transferred'->>'notes')::int <> 1 THEN RAISE EXCEPTION 'C1 transfer counts wrong: %', v_res; END IF;
  RAISE NOTICE 'C1 atomic-conversion OK';
END$$;

-- ---- C2: idempotent retry returns the existing client, no second client
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000A';
  v_agent uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_lead uuid := gen_random_uuid(); v_res1 jsonb; v_res2 jsonb;
BEGIN
  PERFORM pg_temp.act_as(v_agent, v_org);
  INSERT INTO public.leads (id,first_name,last_name,phone,email,state,organization_id,user_id,assigned_agent_id)
    VALUES (v_lead,'Re','Try','555','r@x.com','TX',v_org,v_agent,v_agent);
  v_res1 := public.convert_lead_to_client_atomic(v_lead, jsonb_build_object('carrier','C1'));
  -- the lead is gone; a retry with the SAME lead id must return the existing client idempotently.
  v_res2 := public.convert_lead_to_client_atomic(v_lead, jsonb_build_object('carrier','C2'));
  IF (v_res2->>'idempotent')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'C2 retry not idempotent: %', v_res2; END IF;
  IF (v_res2->>'client_id') <> (v_res1->>'client_id') THEN RAISE EXCEPTION 'C2 retry returned different client'; END IF;
  IF (SELECT count(*) FROM public.clients WHERE lead_id=v_lead) <> 1 THEN RAISE EXCEPTION 'C2 created a second client'; END IF;
  RAISE NOTICE 'C2 idempotent-retry OK';
END$$;

-- ---- C3: failure mid-transaction rolls everything back (lead intact, no client)
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000A';
  v_agent uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_lead uuid := gen_random_uuid(); v_raised boolean := false;
BEGIN
  PERFORM pg_temp.act_as(v_agent, v_org);
  INSERT INTO public.leads (id,first_name,last_name,phone,email,state,organization_id,user_id,assigned_agent_id)
    VALUES (v_lead,'Fail','Case','555','f@x.com','FL',v_org,v_agent,v_agent);
  BEGIN
    -- premium not numeric => the client INSERT cast fails => whole txn rolls back.
    PERFORM public.convert_lead_to_client_atomic(v_lead, jsonb_build_object('premium','not-a-number'));
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'C3 expected failure'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id=v_lead) THEN RAISE EXCEPTION 'C3 lead must remain on failure'; END IF;
  IF EXISTS (SELECT 1 FROM public.clients WHERE lead_id=v_lead) THEN RAISE EXCEPTION 'C3 no client should exist on failure'; END IF;
  RAISE NOTICE 'C3 rollback-on-failure OK';
END$$;

-- ---- C4: partial unique index — two clients for one source lead is rejected
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000A';
  v_lead uuid := gen_random_uuid(); v_raised boolean := false;
BEGIN
  INSERT INTO public.clients (first_name,last_name,phone,email,organization_id,lead_id) VALUES ('A','B','5','e',v_org,v_lead);
  BEGIN INSERT INTO public.clients (first_name,last_name,phone,email,organization_id,lead_id) VALUES ('C','D','5','e',v_org,v_lead);
  EXCEPTION WHEN unique_violation THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'C4 unique index did not prevent two clients for one lead'; END IF;
  RAISE NOTICE 'C4 client lineage unique OK';
END$$;

-- ---- C5: wins.idempotency_key unique on non-null; null keys unrestricted (additional policies)
DO $$
DECLARE v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000A'; v_raised boolean := false;
BEGIN
  INSERT INTO public.wins (organization_id, idempotency_key) VALUES (v_org,'conversion:KEYTEST');
  BEGIN INSERT INTO public.wins (organization_id, idempotency_key) VALUES (v_org,'conversion:KEYTEST');
  EXCEPTION WHEN unique_violation THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'C5 duplicate conversion win not prevented'; END IF;
  -- two NULL-key wins allowed (future additional-policy wins)
  INSERT INTO public.wins (organization_id, idempotency_key) VALUES (v_org, NULL);
  INSERT INTO public.wins (organization_id, idempotency_key) VALUES (v_org, NULL);
  RAISE NOTICE 'C5 win idempotency OK';
END$$;

-- ---- C6/C7/C8: authorization (cross-org, unauthorized agent, super-admin home-org)
DO $$
DECLARE
  v_orgA uuid := 'aaaaaaaa-0000-0000-0000-00000000000A';
  v_orgB uuid := 'bbbbbbbb-0000-0000-0000-00000000000B';
  v_agent1 uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_agent2 uuid := 'aaaaaaaa-0000-0000-0000-0000000000a2';
  v_super uuid := 'aaaaaaaa-0000-0000-0000-0000000000c5';
  v_other uuid := 'bbbbbbbb-0000-0000-0000-0000000000b1';
  v_lead uuid := gen_random_uuid(); v_lead2 uuid := gen_random_uuid(); v_lead3 uuid := gen_random_uuid();
  v_raised boolean; v_res jsonb;
BEGIN
  -- C6 cross-org: lead in A, caller in B
  INSERT INTO public.leads (id,first_name,last_name,phone,email,state,organization_id,user_id,assigned_agent_id)
    VALUES (v_lead,'X','Y','5','e','FL',v_orgA,v_agent1,v_agent1);
  PERFORM pg_temp.act_as(v_other, v_orgB);
  v_raised := false;
  BEGIN PERFORM public.convert_lead_to_client_atomic(v_lead, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'C6 cross-org not rejected'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id=v_lead) THEN RAISE EXCEPTION 'C6 cross-org must not delete'; END IF;

  -- C7 unauthorized: lead assigned to agent1, caller agent2 (plain Agent, not admin/TL)
  INSERT INTO public.leads (id,first_name,last_name,phone,email,state,organization_id,user_id,assigned_agent_id)
    VALUES (v_lead2,'X','Y','5','e','FL',v_orgA,v_agent1,v_agent1);
  PERFORM pg_temp.act_as(v_agent2, v_orgA);
  v_raised := false;
  BEGIN PERFORM public.convert_lead_to_client_atomic(v_lead2, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'C7 unauthorized agent not rejected'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id=v_lead2) THEN RAISE EXCEPTION 'C7 must not delete'; END IF;

  -- C8 super-admin converts a home-org lead -> allowed
  INSERT INTO public.leads (id,first_name,last_name,phone,email,state,organization_id,user_id,assigned_agent_id)
    VALUES (v_lead3,'X','Y','5','e','FL',v_orgA,v_agent1,v_agent1);
  PERFORM pg_temp.act_as(v_super, v_orgA);
  v_res := public.convert_lead_to_client_atomic(v_lead3, jsonb_build_object('carrier','SA'));
  IF (v_res->>'client_id') IS NULL THEN RAISE EXCEPTION 'C8 super-admin home-org convert failed: %', v_res; END IF;
  RAISE NOTICE 'C6/7/8 authorization OK';
END$$;

-- ---- C9: call_logs source-lineage preserved through conversion (survives, unchanged, lead_id intact, retry-safe)
DO $$
DECLARE
  v_org uuid := 'aaaaaaaa-0000-0000-0000-00000000000A'; v_agent uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_lead uuid := gen_random_uuid(); v_cluser uuid := gen_random_uuid(); v_log uuid := gen_random_uuid();
BEGIN
  PERFORM pg_temp.act_as(v_agent, v_org);
  INSERT INTO public.leads (id,first_name,last_name,phone,email,state,organization_id,user_id,assigned_agent_id)
    VALUES (v_lead,'Cl','Log','555','c@x.com','FL',v_org,v_agent,v_agent);
  INSERT INTO public.call_logs (id,user_id,lead_id,duration,status,direction,organization_id)
    VALUES (v_log,v_cluser,v_lead,42,'completed','outbound',v_org);
  PERFORM public.convert_lead_to_client_atomic(v_lead, jsonb_build_object('carrier','CL'));
  -- survives + lead_id NOT nulled + telemetry unchanged (FK was dropped by the migration → no SET NULL)
  IF NOT EXISTS (SELECT 1 FROM public.call_logs WHERE id=v_log AND lead_id=v_lead
       AND duration=42 AND status='completed' AND direction='outbound' AND user_id=v_cluser AND organization_id=v_org) THEN
    RAISE EXCEPTION 'C9 call_logs not preserved/unchanged after conversion'; END IF;
  -- idempotent retry: no duplicate, no mutation
  PERFORM public.convert_lead_to_client_atomic(v_lead, jsonb_build_object('carrier','CL2'));
  IF (SELECT count(*) FROM public.call_logs WHERE lead_id=v_lead) <> 1 THEN RAISE EXCEPTION 'C9 retry mutated call_logs'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.call_logs WHERE id=v_log AND duration=42 AND status='completed') THEN RAISE EXCEPTION 'C9 retry changed telemetry'; END IF;
  RAISE NOTICE 'C9 call_logs lineage OK';
END$$;

-- ---- C10: rollback + cross-org leave call_logs exactly unchanged
DO $$
DECLARE
  v_orgA uuid := 'aaaaaaaa-0000-0000-0000-00000000000A'; v_orgB uuid := 'bbbbbbbb-0000-0000-0000-00000000000B';
  v_agent uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1'; v_other uuid := 'bbbbbbbb-0000-0000-0000-0000000000b1';
  v_lead uuid := gen_random_uuid(); v_log uuid := gen_random_uuid(); v_raised boolean;
BEGIN
  PERFORM pg_temp.act_as(v_agent, v_orgA);
  INSERT INTO public.leads (id,first_name,last_name,phone,email,state,organization_id,user_id,assigned_agent_id)
    VALUES (v_lead,'R','B','5','e','FL',v_orgA,v_agent,v_agent);
  INSERT INTO public.call_logs (id,user_id,lead_id,duration,status,direction,organization_id)
    VALUES (v_log,v_agent,v_lead,17,'failed','outbound',v_orgA);
  v_raised := false;
  BEGIN PERFORM public.convert_lead_to_client_atomic(v_lead, jsonb_build_object('premium','not-a-number')); EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'C10 expected rollback'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.call_logs WHERE id=v_log AND lead_id=v_lead AND duration=17 AND status='failed') THEN RAISE EXCEPTION 'C10 rollback changed call_logs'; END IF;
  PERFORM pg_temp.act_as(v_other, v_orgB);
  v_raised := false;
  BEGIN PERFORM public.convert_lead_to_client_atomic(v_lead, '{}'::jsonb); EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'C10 cross-org not rejected'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.call_logs WHERE id=v_log AND duration=17 AND status='failed') THEN RAISE EXCEPTION 'C10 cross-org touched call_logs'; END IF;
  RAISE NOTICE 'C10 call_logs rollback+auth OK';
END$$;

DO $$ BEGIN RAISE NOTICE 'ALL LEAD-CONVERSION INTEGRATION SCENARIOS PASSED'; END$$;
