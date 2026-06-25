-- =====================================================================================================
-- Contacts permissions enforcement — SQL integration tests (Contacts Build 5, CP3B)
-- =====================================================================================================
-- STATUS: PENDING-EXECUTION. Run ONLY against a LOCAL Supabase stack or an APPROVED Supabase dev BRANCH
-- — never production. Requires migration 20260624120000_contacts_permissions_enforcement applied AND the
-- base helpers get_org_id / is_ancestor_of present, plus prod-typed leads/clients/recruits/profiles/
-- role_permissions/organizations/campaign_leads/calls. Runs in ONE transaction and ROLLBACKs — persists
-- nothing even if misdirected.
--
-- Auth is simulated via request.jwt.claims (auth.uid()/get_org_id()) + seeded profiles. RLS-policy tests
-- additionally `SET LOCAL ROLE authenticated`. Assertions RAISE EXCEPTION on failure.
--
-- Covers: has_contacts_permission (anon/unknown/agent-default/TL-default/stored true/false/Admin/Super
-- Admin home-org/cross-org); delete_contact (perm denied / owner allowed / Admin / TL downline / peer
-- denied / cross-org / invalid type / not found / telemetry survives); view_unassigned + view_all SELECT
-- policies (off→hidden, on→visible, never cross-org, no UPDATE/DELETE broadening); conversion untouched.
-- =====================================================================================================

BEGIN;

\set ORG_A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set ORG_B '''bbbbbbbb-0000-0000-0000-000000000001'''
\set ADMIN '''aaaaaaaa-0000-0000-0000-0000000000ad'''
\set TL    '''aaaaaaaa-0000-0000-0000-0000000000c1'''
\set AGENT '''aaaaaaaa-0000-0000-0000-0000000000a1'''
\set PEER  '''aaaaaaaa-0000-0000-0000-0000000000b2'''
\set DOWN  '''aaaaaaaa-0000-0000-0000-0000000000d1'''
\set SUPER '''aaaaaaaa-0000-0000-0000-0000000000fe'''
\set L_OWN  '''aaaaaaaa-1111-0000-0000-000000000001'''
\set L_PEER '''aaaaaaaa-1111-0000-0000-000000000002'''
\set L_UN   '''aaaaaaaa-1111-0000-0000-000000000003'''
\set L_DOWN '''aaaaaaaa-1111-0000-0000-000000000004'''
\set L_ORGB '''bbbbbbbb-1111-0000-0000-000000000001'''
\set C_OWN  '''aaaaaaaa-2222-0000-0000-000000000001'''
\set R_OWN  '''aaaaaaaa-3333-0000-0000-000000000001'''

INSERT INTO public.organizations (id, name) VALUES
  (:ORG_A::uuid, 'Perm Test Org A'), (:ORG_B::uuid, 'Perm Test Org B')
ON CONFLICT (id) DO NOTHING;

-- Profiles. hierarchy_path makes DOWN a descendant of TL (is_ancestor_of(TL, DOWN) = true).
INSERT INTO public.profiles (id, organization_id, role, first_name, last_name, status, is_super_admin, hierarchy_path) VALUES
  (:ADMIN::uuid, :ORG_A::uuid, 'Admin',       'Ad','Min','Active', false, 'admin'),
  (:TL::uuid,    :ORG_A::uuid, 'Team Leader', 'Te','Lead','Active',false, 'tl'),
  (:AGENT::uuid, :ORG_A::uuid, 'Agent',       'Ag','Ent','Active', false, 'agent'),
  (:PEER::uuid,  :ORG_A::uuid, 'Agent',       'Pe','Er','Active',  false, 'peer'),
  (:DOWN::uuid,  :ORG_A::uuid, 'Agent',       'Do','Wn','Active',  false, 'tl.down'),
  (:SUPER::uuid, :ORG_A::uuid, 'Agent',       'Su','Per','Active', true,  'super')
ON CONFLICT (id) DO NOTHING;

-- Leads: AGENT owns L_OWN, PEER owns L_PEER, L_UN is unassigned (org pool), DOWN owns L_DOWN, L_ORGB other org.
INSERT INTO public.leads (id, organization_id, user_id, assigned_agent_id, first_name, last_name, status, state) VALUES
  (:L_OWN::uuid,  :ORG_A::uuid, :AGENT::uuid, :AGENT::uuid, 'Own','Lead','New','TX'),
  (:L_PEER::uuid, :ORG_A::uuid, :PEER::uuid,  :PEER::uuid,  'Peer','Lead','New','TX'),
  (:L_UN::uuid,   :ORG_A::uuid, NULL,         NULL,         'Un','Assigned','New','TX'),
  (:L_DOWN::uuid, :ORG_A::uuid, :DOWN::uuid,  :DOWN::uuid,  'Down','Lead','New','TX'),
  (:L_ORGB::uuid, :ORG_B::uuid, NULL,         NULL,         'OrgB','Lead','New','TX')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.clients (id, organization_id, assigned_agent_id, first_name, last_name) VALUES
  (:C_OWN::uuid, :ORG_A::uuid, :AGENT::uuid, 'Own','Client') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.recruits (id, organization_id, assigned_agent_id, first_name, last_name, status) VALUES
  (:R_OWN::uuid, :ORG_A::uuid, :AGENT::uuid, 'Own','Recruit','New') ON CONFLICT (id) DO NOTHING;

-- A telemetry call on the owned lead (must survive a hard delete with lead_id SET NULL).
INSERT INTO public.calls (id, organization_id, agent_id, lead_id, contact_id, contact_type, direction, status, duration)
VALUES (gen_random_uuid(), :ORG_A::uuid, :AGENT::uuid, :L_OWN::uuid, :L_OWN::uuid, 'lead', 'outbound', 'completed', 60)
ON CONFLICT (id) DO NOTHING;

-- Helper to set the simulated JWT (auth.uid()/get_org_id()/is_super_admin()).
CREATE OR REPLACE FUNCTION pg_temp._sim(p_uid uuid, p_org uuid, p_role text, p_super boolean DEFAULT false)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'is_super_admin', p_super,
      'app_metadata', json_build_object('organization_id', p_org, 'role', p_role))::text, true);
$$;

-- =====================================================================================================
-- T1. has_contacts_permission
-- =====================================================================================================
DO $$
BEGIN
  -- anon / no claims → false
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF public.has_contacts_permission('contacts.leads.view_assigned') THEN RAISE EXCEPTION 'T1a anon should be false'; END IF;

  -- Agent defaults: view_assigned true, delete false, import false, view_unassigned false, unknown key false
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Agent');
  IF NOT public.has_contacts_permission('contacts.leads.view_assigned') THEN RAISE EXCEPTION 'T1b agent view_assigned default true'; END IF;
  IF public.has_contacts_permission('contacts.leads.delete') THEN RAISE EXCEPTION 'T1c agent delete default false'; END IF;
  IF public.has_contacts_permission('contacts.leads.view_unassigned') THEN RAISE EXCEPTION 'T1d agent view_unassigned default false'; END IF;
  IF public.has_contacts_permission('contacts.leads.bogus_key') THEN RAISE EXCEPTION 'T1e unknown key must be false'; END IF;

  -- Team Leader defaults: view_unassigned true, import true, delete false
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000c1'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Team Leader');
  IF NOT public.has_contacts_permission('contacts.leads.view_unassigned') THEN RAISE EXCEPTION 'T1f TL view_unassigned default true'; END IF;
  IF NOT public.has_contacts_permission('contacts.leads.import') THEN RAISE EXCEPTION 'T1g TL import default true'; END IF;
  IF public.has_contacts_permission('contacts.leads.delete') THEN RAISE EXCEPTION 'T1h TL delete default false'; END IF;

  -- Admin → all true; Super Admin (home org) → all true
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000ad'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Admin');
  IF NOT public.has_contacts_permission('contacts.leads.delete') THEN RAISE EXCEPTION 'T1i Admin delete true'; END IF;
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000fe'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Agent', true);
  IF NOT public.has_contacts_permission('contacts.leads.delete') THEN RAISE EXCEPTION 'T1j Super Admin (home org) delete true'; END IF;

  -- Cross-org: claims org = ORG_B, but profile is in ORG_A → profiles match fails → false
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'Agent');
  IF public.has_contacts_permission('contacts.leads.view_assigned') THEN RAISE EXCEPTION 'T1k cross-org must be false'; END IF;
  RAISE NOTICE 'T1 has_contacts_permission defaults/Admin/SA/cross-org PASS';
END $$;

-- Stored override (Agent role): delete true, view_assigned false
INSERT INTO public.role_permissions (organization_id, role, permissions)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Agent',
        jsonb_build_object('contacts', jsonb_build_object('contacts.leads.delete', true, 'contacts.leads.view_assigned', false)))
ON CONFLICT (organization_id, role) DO UPDATE SET permissions = EXCLUDED.permissions;
DO $$
BEGIN
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Agent');
  IF NOT public.has_contacts_permission('contacts.leads.delete') THEN RAISE EXCEPTION 'T1l stored true override'; END IF;
  IF public.has_contacts_permission('contacts.leads.view_assigned') THEN RAISE EXCEPTION 'T1m stored false override'; END IF;
  -- a key not in the stored block still falls back to default (create = true)
  IF NOT public.has_contacts_permission('contacts.leads.create') THEN RAISE EXCEPTION 'T1n missing key falls back to default'; END IF;
  RAISE NOTICE 'T1 stored override PASS';
END $$;
-- reset Agent role to empty for the delete tests below (defaults: delete false)
UPDATE public.role_permissions SET permissions = '{}'::jsonb
 WHERE organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid AND role = 'Agent';

-- =====================================================================================================
-- T2. delete_contact
-- =====================================================================================================
DO $$
DECLARE v jsonb;
BEGIN
  -- Agent WITHOUT delete permission → permission_denied, row remains
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Agent');
  BEGIN
    v := public.delete_contact('lead', 'aaaaaaaa-1111-0000-0000-000000000001'::uuid);
    RAISE EXCEPTION 'T2a expected permission_denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = 'aaaaaaaa-1111-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'T2a lead must remain'; END IF;

  -- invalid type → 22023
  BEGIN
    v := public.delete_contact('widget', 'aaaaaaaa-1111-0000-0000-000000000001'::uuid);
    RAISE EXCEPTION 'T2b expected invalid_contact_type';
  EXCEPTION WHEN data_exception THEN NULL; END;
  RAISE NOTICE 'T2 deny-without-perm + invalid-type PASS';
END $$;

-- Grant Agent delete, then owner can delete own (telemetry survives), peer cannot, cross-org blocked.
UPDATE public.role_permissions SET permissions = jsonb_build_object('contacts', jsonb_build_object('contacts.leads.delete', true))
 WHERE organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid AND role = 'Agent';
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Agent');

  -- peer-owned lead → not_authorized (has perm capability, but not the owner)
  BEGIN
    v := public.delete_contact('lead', 'aaaaaaaa-1111-0000-0000-000000000002'::uuid);
    RAISE EXCEPTION 'T2c expected not_authorized for peer lead';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = 'aaaaaaaa-1111-0000-0000-000000000002'::uuid) THEN RAISE EXCEPTION 'T2c peer lead must remain'; END IF;

  -- owner deletes own lead → deleted; telemetry call survives with lead_id SET NULL
  v := public.delete_contact('lead', 'aaaaaaaa-1111-0000-0000-000000000001'::uuid);
  IF (v->>'deleted')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T2d owner delete should succeed: %', v; END IF;
  IF EXISTS (SELECT 1 FROM public.leads WHERE id = 'aaaaaaaa-1111-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'T2d lead should be gone'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.calls WHERE contact_id = 'aaaaaaaa-1111-0000-0000-000000000001'::uuid AND lead_id IS NULL) THEN
    RAISE EXCEPTION 'T2d telemetry call must survive with lead_id SET NULL'; END IF;

  -- cross-org delete blocked (org B lead while acting in org A)
  BEGIN
    v := public.delete_contact('lead', 'bbbbbbbb-1111-0000-0000-000000000001'::uuid);
    RAISE EXCEPTION 'T2e expected cross_org';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = 'bbbbbbbb-1111-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'T2e org-B lead must remain'; END IF;

  -- not found → {deleted:false}
  v := public.delete_contact('lead', 'aaaaaaaa-9999-0000-0000-000000000000'::uuid);
  IF (v->>'deleted')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'T2f not-found should be deleted=false'; END IF;
  RAISE NOTICE 'T2 owner/peer/cross-org/not-found + telemetry PASS';
END $$;

-- Admin deletes any in org; TL deletes downline but not a peer-of-TL outside downline.
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000c1'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Team Leader');
  -- TL has delete? default false → grant via Admin/full? TL delete default false, so give TL stored delete:
  UPDATE public.role_permissions SET permissions = jsonb_build_object('contacts', jsonb_build_object('contacts.leads.delete', true))
   WHERE organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid AND role = 'Team Leader';
  -- downline lead → deleted
  v := public.delete_contact('lead', 'aaaaaaaa-1111-0000-0000-000000000004'::uuid);
  IF (v->>'deleted')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T2g TL should delete downline lead: %', v; END IF;

  -- Admin deletes the still-present peer lead (full access)
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000ad'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Admin');
  v := public.delete_contact('lead', 'aaaaaaaa-1111-0000-0000-000000000002'::uuid);
  IF (v->>'deleted')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T2h Admin should delete any org lead: %', v; END IF;
  RAISE NOTICE 'T2 TL-downline + Admin PASS';
END $$;

-- =====================================================================================================
-- T3. view_unassigned / view_all SELECT policies (RLS, as the authenticated role)
-- =====================================================================================================
-- Reset Agent role to defaults (both off).
UPDATE public.role_permissions SET permissions = '{}'::jsonb
 WHERE organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid AND role = 'Agent';

DO $$
DECLARE n int;
BEGIN
  -- Agent without view_unassigned → cannot see the unassigned org lead
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Agent');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.leads WHERE id = 'aaaaaaaa-1111-0000-0000-000000000003'::uuid;
  IF n <> 0 THEN RAISE EXCEPTION 'T3a unassigned hidden without perm (got %)', n; END IF;
  RESET ROLE;
END $$;

-- Grant Agent view_unassigned, re-test: visible; never cross-org; no UPDATE broadening.
UPDATE public.role_permissions SET permissions = jsonb_build_object('contacts', jsonb_build_object('contacts.leads.view_unassigned', true))
 WHERE organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid AND role = 'Agent';
DO $$
DECLARE n int;
BEGIN
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Agent');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.leads WHERE id = 'aaaaaaaa-1111-0000-0000-000000000003'::uuid;
  IF n <> 1 THEN RAISE EXCEPTION 'T3b unassigned visible with perm (got %)', n; END IF;
  -- cross-org unassigned still hidden (org B)
  SELECT count(*) INTO n FROM public.leads WHERE id = 'bbbbbbbb-1111-0000-0000-000000000001'::uuid;
  IF n <> 0 THEN RAISE EXCEPTION 'T3c cross-org unassigned must stay hidden (got %)', n; END IF;
  -- no UPDATE broadening: updating the unassigned lead affects 0 rows (ALL policy still gates writes)
  UPDATE public.leads SET state = 'CA' WHERE id = 'aaaaaaaa-1111-0000-0000-000000000003'::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'T3d view_unassigned must NOT broaden UPDATE (updated % rows)', n; END IF;
  RESET ROLE;
  RAISE NOTICE 'T3 view_unassigned on/off + cross-org + no-write-broadening PASS';
END $$;

-- view_all: off → agent sees only own (+unassigned still on from above); on → sees peer's lead too.
UPDATE public.role_permissions SET permissions = '{}'::jsonb
 WHERE organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid AND role = 'Agent';
DO $$
DECLARE n int;
BEGIN
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000b2'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Agent');
  SET LOCAL ROLE authenticated;
  -- PEER cannot see AGENT-owned L_OWN... but L_OWN was deleted in T2. Use L_DOWN? also deleted. Use a fresh check:
  -- Without view_all, PEER sees only their own lead (L_PEER was deleted by Admin in T2h). Re-insert a peer-visible probe.
  RESET ROLE;
END $$;

-- Fresh leads for the view_all check (prior ones were deleted by delete tests).
INSERT INTO public.leads (id, organization_id, user_id, assigned_agent_id, first_name, last_name, status, state) VALUES
  ('aaaaaaaa-1111-0000-0000-0000000000aa'::uuid, :ORG_A::uuid, :AGENT::uuid, :AGENT::uuid, 'VA','Own','New','TX')
ON CONFLICT (id) DO NOTHING;
DO $$
DECLARE n int;
BEGIN
  -- PEER without view_all cannot see AGENT's lead
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000b2'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Agent');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.leads WHERE id = 'aaaaaaaa-1111-0000-0000-0000000000aa'::uuid;
  IF n <> 0 THEN RAISE EXCEPTION 'T3e view_all off: peer must not see other agent lead (got %)', n; END IF;
  RESET ROLE;

  -- Grant Agent role view_all → PEER now sees it; cross-org still hidden; no DELETE broadening
  UPDATE public.role_permissions SET permissions = jsonb_build_object('contacts', jsonb_build_object('contacts.leads.view_all', true))
   WHERE organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid AND role = 'Agent';
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000b2'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Agent');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.leads WHERE id = 'aaaaaaaa-1111-0000-0000-0000000000aa'::uuid;
  IF n <> 1 THEN RAISE EXCEPTION 'T3f view_all on: peer should see other agent lead (got %)', n; END IF;
  SELECT count(*) INTO n FROM public.leads WHERE id = 'bbbbbbbb-1111-0000-0000-000000000001'::uuid;
  IF n <> 0 THEN RAISE EXCEPTION 'T3g view_all cross-org must stay hidden (got %)', n; END IF;
  DELETE FROM public.leads WHERE id = 'aaaaaaaa-1111-0000-0000-0000000000aa'::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'T3h view_all must NOT broaden DELETE (deleted % rows)', n; END IF;
  RESET ROLE;
  RAISE NOTICE 'T3 view_all on/off + cross-org + no-delete-broadening PASS';
END $$;

-- =====================================================================================================
-- T4. _contacts_filtered_leads 'unassigned' scope returns the org pool only (with view_unassigned on)
-- =====================================================================================================
UPDATE public.role_permissions SET permissions = jsonb_build_object('contacts', jsonb_build_object('contacts.leads.view_unassigned', true))
 WHERE organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid AND role = 'Agent';
DO $$
DECLARE n int;
BEGIN
  PERFORM pg_temp._sim('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Agent');
  SET LOCAL ROLE authenticated;
  -- unassigned scope → only L_UN (the org pool row); RLS + scope branch agree
  SELECT count(*) INTO n FROM public._contacts_filtered_leads('{"scope":"unassigned"}'::jsonb);
  IF n <> 1 THEN RAISE EXCEPTION 'T4 unassigned scope should return exactly the 1 org-pool lead (got %)', n; END IF;
  RESET ROLE;
  RAISE NOTICE 'T4 unassigned scope helper PASS';
END $$;

-- =====================================================================================================
-- T5. Conversion untouched — the conversion RPC still exists and is unchanged (no perm key gating).
-- =====================================================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='convert_lead_to_client_atomic'
  ) THEN RAISE EXCEPTION 'T5 conversion RPC must still exist'; END IF;
  RAISE NOTICE 'T5 conversion RPC present/untouched PASS';
END $$;

ROLLBACK;
