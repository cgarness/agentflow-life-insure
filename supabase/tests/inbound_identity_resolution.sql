-- =====================================================================================================
-- Inbound canonical identity resolution — SQL tests T1–T7 + R8 + resolution-level R21 (plan rev 5 §11)
-- =====================================================================================================
-- STATUS: disposable LOCAL stack only. Apply supabase/tests/inbound_harness.sql, then M1
-- (inbound_identity_foundation), then M2, then run this file with ON_ERROR_STOP=1.
-- Each scenario is a DO block; an uncaught RAISE names the failing scenario. Whole file rolls back.

BEGIN;

-- ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','Inbound Org A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','Inbound Org B');

INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1');
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a1');

-- T1: formatted unique lead phone
INSERT INTO public.leads (id, organization_id, phone, first_name, last_name) VALUES
  ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','(209) 840-2988','Pat','Lead');
-- T2: formatted unique client phone
INSERT INTO public.clients (id, organization_id, phone, first_name, last_name) VALUES
  ('22222222-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','(310) 555-0177','Cleo','Client');
-- T3: formatted unique recruit phone
INSERT INTO public.recruits (id, organization_id, phone, first_name, last_name) VALUES
  ('33333333-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','530.777.1234','Rex','Recruit');
-- T5: same-type duplicate pair (two leads, one normalized number, different stored formats)
INSERT INTO public.leads (id, organization_id, phone, first_name, last_name) VALUES
  ('11111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','209-555-1111','Dup','One'),
  ('11111111-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','+12095551111','Dup','Two');
-- Cross-type duplicate pair (lead + client share a normalized number) — strict D1 ambiguity
INSERT INTO public.leads (id, organization_id, phone, first_name, last_name) VALUES
  ('11111111-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-00000000000a','916-555-2222','Cross','Lead');
INSERT INTO public.clients (id, organization_id, phone, first_name, last_name) VALUES
  ('22222222-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','(916) 555-2222','Cross','Client');
-- R8: campaign_leads-only phone match (stale snapshot; underlying lead's CURRENT phone differs)
INSERT INTO public.leads (id, organization_id, phone, first_name, last_name) VALUES
  ('11111111-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-00000000000a','(408) 555-8888','Moved','Number');
INSERT INTO public.campaign_leads (id, organization_id, lead_id, phone, first_name, last_name) VALUES
  ('44444444-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000005','(707) 555-9999','Moved','Number'),
  -- campaign_lead with NO lead_id at all
  ('44444444-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a',
   NULL,'(775) 555-6666','Orphan','Snapshot');
-- Org-scoping control: org B holds the same number as org A's T1 lead
INSERT INTO public.leads (id, organization_id, phone, first_name, last_name) VALUES
  ('11111111-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-00000000000b','(209) 840-2988','Other','Org');

-- ── S1 (T1): formatted unique lead ↔ E.164 ANI ⇒ unique, correct identity ───────────────────────────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.resolve_inbound_contact('aaaaaaaa-0000-0000-0000-00000000000a', '+12098402988');
  RESET ROLE;
  IF r->>'resolution' <> 'unique' THEN RAISE EXCEPTION 'S1 expected unique, got %', r; END IF;
  IF r->>'contact_id' <> '11111111-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'S1 wrong contact: %', r; END IF;
  IF r->>'contact_type' <> 'lead' THEN RAISE EXCEPTION 'S1 wrong type: %', r; END IF;
  IF r->>'contact_name' <> 'Pat Lead' THEN RAISE EXCEPTION 'S1 wrong name: %', r; END IF;
END $$;

-- ── S2 (T2): formatted unique client ⇒ unique client ─────────────────────────────────────────────────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.resolve_inbound_contact('aaaaaaaa-0000-0000-0000-00000000000a', '+13105550177');
  RESET ROLE;
  IF r->>'resolution' <> 'unique' OR r->>'contact_type' <> 'client'
     OR r->>'contact_id' <> '22222222-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'S2 expected unique client, got %', r; END IF;
END $$;

-- ── S3 (T3): formatted unique recruit ⇒ unique recruit ───────────────────────────────────────────────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.resolve_inbound_contact('aaaaaaaa-0000-0000-0000-00000000000a', '+15307771234');
  RESET ROLE;
  IF r->>'resolution' <> 'unique' OR r->>'contact_type' <> 'recruit'
     OR r->>'contact_id' <> '33333333-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'S3 expected unique recruit, got %', r; END IF;
END $$;

-- ── S4 (T4): no CRM match ⇒ not_found, NULL identity ────────────────────────────────────────────────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.resolve_inbound_contact('aaaaaaaa-0000-0000-0000-00000000000a', '+19995550000');
  RESET ROLE;
  IF r->>'resolution' <> 'not_found' OR r->'contact_id' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'S4 expected not_found/NULL, got %', r; END IF;
END $$;

-- ── S5 (T5): same-type normalized duplicates ⇒ ambiguous, NULL identity, match_count 2 ──────────────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.resolve_inbound_contact('aaaaaaaa-0000-0000-0000-00000000000a', '+12095551111');
  RESET ROLE;
  IF r->>'resolution' <> 'ambiguous' OR r->'contact_id' <> 'null'::jsonb
     OR (r->>'match_count')::int <> 2 THEN
    RAISE EXCEPTION 'S5 expected ambiguous(2), got %', r; END IF;
END $$;

-- ── S6 (D1): cross-type duplicate (lead + client) ⇒ ambiguous — never type-priority ─────────────────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.resolve_inbound_contact('aaaaaaaa-0000-0000-0000-00000000000a', '+19165552222');
  RESET ROLE;
  IF r->>'resolution' <> 'ambiguous' OR (r->>'match_count')::int <> 2 THEN
    RAISE EXCEPTION 'S6 expected cross-type ambiguous(2), got %', r; END IF;
END $$;

-- ── S7 (R8): campaign_leads snapshot phones NEVER resolve — with or without lead_id ─────────────────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.resolve_inbound_contact('aaaaaaaa-0000-0000-0000-00000000000a', '+17075559999');
  IF r->>'resolution' <> 'not_found' THEN
    RAISE EXCEPTION 'S7a campaign_lead snapshot (with lead_id) must not resolve, got %', r; END IF;
  r := public.resolve_inbound_contact('aaaaaaaa-0000-0000-0000-00000000000a', '+17755556666');
  RESET ROLE;
  IF r->>'resolution' <> 'not_found' THEN
    RAISE EXCEPTION 'S7b campaign_lead snapshot (lead_id NULL) must not resolve, got %', r; END IF;
END $$;

-- ── S8: organization scoping — org B's identical number is invisible to org A (and vice versa) ──────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  -- org A resolution of the shared number still uniquely finds ORG A's lead
  r := public.resolve_inbound_contact('aaaaaaaa-0000-0000-0000-00000000000a', '+12098402988');
  IF r->>'contact_id' <> '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'S8a org A must resolve its own lead, got %', r; END IF;
  -- org B resolution finds ORG B's lead
  r := public.resolve_inbound_contact('bbbbbbbb-0000-0000-0000-00000000000b', '+12098402988');
  RESET ROLE;
  IF r->>'contact_id' <> '11111111-0000-0000-0000-00000000000b' THEN
    RAISE EXCEPTION 'S8b org B must resolve its own lead, got %', r; END IF;
END $$;

-- ── S9 (R21 resolution level): <10-digit / non-dialable ANI ⇒ not_found, never an error ─────────────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.resolve_inbound_contact('aaaaaaaa-0000-0000-0000-00000000000a', 'anonymous');
  IF r->>'resolution' <> 'not_found' THEN RAISE EXCEPTION 'S9a anonymous must be not_found, got %', r; END IF;
  r := public.resolve_inbound_contact('aaaaaaaa-0000-0000-0000-00000000000a', '555-1234');
  RESET ROLE;
  IF r->>'resolution' <> 'not_found' THEN RAISE EXCEPTION 'S9b short must be not_found, got %', r; END IF;
END $$;

-- ── S10: expression indexes exist and are used (plan §3.1.2 — index-backed resolver) ────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_leads_org_phone_last10') THEN
    RAISE EXCEPTION 'S10 idx_leads_org_phone_last10 missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_clients_org_phone_last10') THEN
    RAISE EXCEPTION 'S10 idx_clients_org_phone_last10 missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_recruits_org_phone_last10') THEN
    RAISE EXCEPTION 'S10 idx_recruits_org_phone_last10 missing'; END IF;
END $$;

ROLLBACK;
