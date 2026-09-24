-- TEST-ONLY synthetic fixtures for the isolated LOCAL verification (implementation_plan.md §10).
-- Run ONLY by bootstrap.mjs, via `docker exec` into the local container supabase_db_agentflow-localverify,
-- which cannot reach any hosted project. Every row is synthetic; there is no production data.
-- psql variables: :'admin' :'agent1' :'agent2' :'agentb' (auth user ids created by bootstrap.mjs).
\set ON_ERROR_STOP on
BEGIN;

-- Fresh-stack guard: refuse when any non-fixture organization exists. This is not a locality check;
-- locality comes from bootstrap.mjs, which runs this file only via `docker exec` into the local container.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id NOT IN (
       'a1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001')) THEN
    RAISE EXCEPTION 'refusing: non-fixture organizations present (not a fresh local stack)';
  END IF;
END $$;

-- ── Organizations ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.organizations (id, name, slug, twilio_subaccount_status) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'LV Main Test Org', 'lv-main', 'pending'),
  ('b1000000-0000-4000-8000-000000000001', 'LV Second Test Org', 'lv-second', 'pending')
ON CONFLICT (id) DO NOTHING;

-- ── Profiles (created by the auth trigger; org/role set here by the privileged bootstrap) ─────────
UPDATE public.profiles SET organization_id = 'a1000000-0000-4000-8000-000000000001', role = 'Admin',
  first_name = 'Ada', last_name = 'Admin', onboarding_complete = true WHERE id = :'admin';
UPDATE public.profiles SET organization_id = 'a1000000-0000-4000-8000-000000000001', role = 'Agent',
  first_name = 'Avery', last_name = 'AgentOne', onboarding_complete = true WHERE id = :'agent1';
UPDATE public.profiles SET organization_id = 'a1000000-0000-4000-8000-000000000001', role = 'Agent',
  first_name = 'Blake', last_name = 'AgentTwo', onboarding_complete = true WHERE id = :'agent2';
UPDATE public.profiles SET organization_id = 'b1000000-0000-4000-8000-000000000001', role = 'Agent',
  first_name = 'Casey', last_name = 'OtherOrg', onboarding_complete = true WHERE id = :'agentb';

-- ── Custom field definitions (org A, Leads) ──────────────────────────────────────────────────────
INSERT INTO public.custom_fields (id, organization_id, name, type, applies_to, active) VALUES
  ('a1000000-0000-4000-8000-0000000000c1', 'a1000000-0000-4000-8000-000000000001', 'Policy Interest', 'Text',   '["Leads"]', true),
  ('a1000000-0000-4000-8000-0000000000c2', 'a1000000-0000-4000-8000-000000000001', 'Dependents',      'Number', '["Leads"]', true),
  ('a1000000-0000-4000-8000-0000000000c3', 'a1000000-0000-4000-8000-000000000001', 'Coverage Amount', 'Number', '["Leads"]', true),
  ('a1000000-0000-4000-8000-0000000000c4', 'a1000000-0000-4000-8000-000000000001', 'Smoker',          'Text',   '["Leads"]', true),
  ('a1000000-0000-4000-8000-0000000000c5', 'a1000000-0000-4000-8000-000000000001', 'Blank Note',      'Text',   '["Leads"]', true),
  ('a1000000-0000-4000-8000-0000000000c6', 'a1000000-0000-4000-8000-000000000001', 'Email',           'Text',   '["Leads"]', true)
ON CONFLICT (id) DO NOTHING;

-- Org layout: some custom fields are in the layout; "Coverage Amount", "Smoker" and "Email" (custom) are NOT.
INSERT INTO public.contact_management_settings (organization_id, field_order_lead)
VALUES ('a1000000-0000-4000-8000-000000000001',
  '["firstName","lastName","phone","custom:Policy Interest","email","state","custom:Dependents","custom:Blank Note","leadSource","age","notes"]')
ON CONFLICT DO NOTHING;

-- ── Leads (org A). All Team/Open leads start UNASSIGNED (user_id and assigned_agent_id NULL). ─────
INSERT INTO public.leads (id, organization_id, first_name, last_name, phone, email, state, lead_source, age,
                          notes, status, assigned_agent_id, user_id, custom_fields) VALUES
  ('a1000000-0000-4000-8000-0000000001a1', 'a1000000-0000-4000-8000-000000000001', 'Tessa', 'Teamlead',
   '+15555550111', 'tessa.team@example.test', 'TX', 'LV Synthetic', 41, 'Team lead master note', 'New', NULL, NULL,
   '{"Policy Interest":"Term 20","Dependents":0,"Coverage Amount":250000,"Smoker":false,"Blank Note":"",
     "Email":"custom-email-value@example.test","__agentflow":{"import":"lv"},"tags":["lv"],
     "additional_policies":[{"carrier":"LV Carrier","premium":10}]}'),
  ('a1000000-0000-4000-8000-0000000001a2', 'a1000000-0000-4000-8000-000000000001', 'Oliver', 'Openpool',
   '+15555550112', 'oliver.open@example.test', 'FL', 'LV Synthetic', 58, 'Open lead master note', 'New', NULL, NULL,
   '{"Policy Interest":"Whole Life","Dependents":3,"Coverage Amount":0,"Smoker":"Yes","__agentflow":{"k":1}}'),
  ('a1000000-0000-4000-8000-0000000001a3', 'a1000000-0000-4000-8000-000000000001', 'Olga', 'Openpooltwo',
   '+15555550113', 'olga.open2@example.test', 'CA', 'LV Synthetic', 63, 'Second open lead note', 'New', NULL, NULL,
   '{"Policy Interest":"Final Expense","Dependents":1}'),
  ('a1000000-0000-4000-8000-0000000001a4', 'a1000000-0000-4000-8000-000000000001', 'Owen', 'Ownedbytwo',
   '+15555550114', 'owen.owned@example.test', 'GA', 'LV Synthetic', 50, 'Owned by agent two', 'New', :'agent2', :'agent2',
   '{"Policy Interest":"Owned secret"}'),
  ('a1000000-0000-4000-8000-0000000001a5', 'a1000000-0000-4000-8000-000000000001', 'Pat', 'Personal',
   '+15555550115', 'pat.personal@example.test', 'NY', 'LV Synthetic', 45, 'Personal lead note', 'New', :'agent1', :'agent1',
   '{"Policy Interest":"IUL","Dependents":2}')
ON CONFLICT (id) DO NOTHING;

-- Org B lead (isolation checks).
INSERT INTO public.leads (id, organization_id, first_name, last_name, phone, email, state, lead_source, status,
                          assigned_agent_id, user_id, custom_fields) VALUES
  ('b1000000-0000-4000-8000-0000000001b1', 'b1000000-0000-4000-8000-000000000001', 'Bianca', 'Otherorg',
   '+15555550121', 'bianca.other@example.test', 'WA', 'LV Synthetic', 'New', :'agentb', :'agentb',
   '{"Policy Interest":"Other org secret"}')
ON CONFLICT (id) DO NOTHING;

-- ── Campaigns ─────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.campaigns (id, organization_id, name, type, status, assigned_agent_ids, created_by, user_id) VALUES
  ('a1000000-0000-4000-8000-0000000002c1', 'a1000000-0000-4000-8000-000000000001', 'LV Team Campaign', 'Team', 'Active',
   jsonb_build_array(:'agent1'::text, :'agent2'::text), :'admin', :'admin'),
  ('a1000000-0000-4000-8000-0000000002c2', 'a1000000-0000-4000-8000-000000000001', 'LV Open Pool', 'Open Pool', 'Active',
   '[]', :'admin', :'admin'),
  ('a1000000-0000-4000-8000-0000000002c3', 'a1000000-0000-4000-8000-000000000001', 'LV Personal (Agent One)', 'Personal', 'Active',
   jsonb_build_array(:'agent1'::text), :'agent1', :'agent1'),
  ('b1000000-0000-4000-8000-0000000002d1', 'b1000000-0000-4000-8000-000000000001', 'LV Org B Open Pool', 'Open Pool', 'Active',
   '[]', :'agentb', :'agentb')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.campaign_leads (id, campaign_id, lead_id, organization_id, first_name, last_name, phone, email, state,
                                   age, source, status, user_id) VALUES
  ('a1000000-0000-4000-8000-0000000003d1', 'a1000000-0000-4000-8000-0000000002c1', 'a1000000-0000-4000-8000-0000000001a1',
   'a1000000-0000-4000-8000-000000000001', 'Tessa', 'Teamlead', '+15555550111', 'tessa.team@example.test', 'TX', 41, 'LV Synthetic', 'Queued', :'admin'),
  ('a1000000-0000-4000-8000-0000000003d2', 'a1000000-0000-4000-8000-0000000002c2', 'a1000000-0000-4000-8000-0000000001a2',
   'a1000000-0000-4000-8000-000000000001', 'Oliver', 'Openpool', '+15555550112', 'oliver.open@example.test', 'FL', 58, 'LV Synthetic', 'Queued', :'admin'),
  ('a1000000-0000-4000-8000-0000000003d3', 'a1000000-0000-4000-8000-0000000002c2', 'a1000000-0000-4000-8000-0000000001a3',
   'a1000000-0000-4000-8000-000000000001', 'Olga', 'Openpooltwo', '+15555550113', 'olga.open2@example.test', 'CA', 63, 'LV Synthetic', 'Queued', :'admin'),
  ('a1000000-0000-4000-8000-0000000003d4', 'a1000000-0000-4000-8000-0000000002c2', 'a1000000-0000-4000-8000-0000000001a4',
   'a1000000-0000-4000-8000-000000000001', 'Owen', 'Ownedbytwo', '+15555550114', 'owen.owned@example.test', 'GA', 50, 'LV Synthetic', 'Queued', :'admin'),
  ('a1000000-0000-4000-8000-0000000003d5', 'a1000000-0000-4000-8000-0000000002c3', 'a1000000-0000-4000-8000-0000000001a5',
   'a1000000-0000-4000-8000-000000000001', 'Pat', 'Personal', '+15555550115', 'pat.personal@example.test', 'NY', 45, 'LV Synthetic', 'Queued', :'agent1'),
  ('b1000000-0000-4000-8000-0000000003e1', 'b1000000-0000-4000-8000-0000000002d1', 'b1000000-0000-4000-8000-0000000001b1',
   'b1000000-0000-4000-8000-000000000001', 'Bianca', 'Otherorg', '+15555550121', 'bianca.other@example.test', 'WA', NULL, 'LV Synthetic', 'Queued', :'agentb')
ON CONFLICT (id) DO NOTHING;

-- ── Dispositions / pipeline (org A) ───────────────────────────────────────────────────────────────
-- Pipeline stages are seeded by the organization trigger (incl. lead 'Sold' with convert_to_client).
INSERT INTO public.dispositions (id, organization_id, name, is_locked, sort_order, pipeline_stage_id, counts_as_contacted) VALUES
  ('a1000000-0000-4000-8000-0000000005a1', 'a1000000-0000-4000-8000-000000000001', 'No Answer', true, 0, NULL, false),
  ('a1000000-0000-4000-8000-0000000005a2', 'a1000000-0000-4000-8000-000000000001', 'Not Interested', false, 1, NULL, true),
  ('a1000000-0000-4000-8000-0000000005a3', 'a1000000-0000-4000-8000-000000000001', 'Sold', false, 2, (SELECT id FROM public.pipeline_stages WHERE organization_id = 'a1000000-0000-4000-8000-000000000001' AND pipeline_type = 'lead' AND name = 'Sold' AND convert_to_client), true)
ON CONFLICT (id) DO NOTHING;

-- ── Telephony settings (org A): a synthetic 555 agency number; no credentials. The fake Voice.js
-- boundary never contacts Twilio.
INSERT INTO public.phone_settings (organization_id, provider, recording_enabled) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'twilio', false)
ON CONFLICT DO NOTHING;
INSERT INTO public.phone_numbers (id, organization_id, phone_number, friendly_name, status, is_default, area_code, assignment_type) VALUES
  ('a1000000-0000-4000-8000-0000000006a1', 'a1000000-0000-4000-8000-000000000001', '+15555550100', 'LV synthetic', 'active', true, '555', 'agency')
ON CONFLICT (id) DO NOTHING;

-- Synthetic carrier (the conversion modal requires one).
INSERT INTO public.carriers (id, organization_id, name) VALUES
  ('a1000000-0000-4000-8000-0000000007a1', 'a1000000-0000-4000-8000-000000000001', 'LV Synthetic Carrier')
ON CONFLICT (id) DO NOTHING;

COMMIT;
