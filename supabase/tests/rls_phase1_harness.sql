-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- RLS Phase 1 harness — the REAL production authorization surface for public.calls.
-- Layered ON TOP of inbound_harness.sql (roles, auth.uid(), profiles, calls, get_org_id) + M1/M2/M3.
--
-- inbound_harness installs a permissive `harness_all` policy so the ingest/claim suites can focus on
-- their own logic. This harness REPLACES that on public.calls with the two verbatim production
-- policies, plus faithful implementations of every authorization helper they reference, so the
-- Phase 1 authorization matrix is evaluated against the real predicates:
--
--   "Calls Hierarchical Access"     ALL,    TO authenticated  (the policy Phase 1 splits)
--   "Calls Agency Group Peer Read"  SELECT, TO authenticated  (must remain untouched)
--
-- Verified read-only against production (catalog only) before authoring: exactly these two
-- PERMISSIVE policies, RLS enabled / not forced, ALL grants to anon+authenticated+service_role.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS ltree;

-- ── Authorization helpers (baseline definitions) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_role() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role', '');
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role', '') = 'Super Admin',
    false);
$$;

CREATE OR REPLACE FUNCTION public.super_admin_own_org(row_org uuid) RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN row_org IS NULL THEN false
    WHEN NOT public.is_super_admin() THEN false
    WHEN public.get_org_id() IS NULL THEN false
    ELSE row_org = public.get_org_id()
  END;
$$;

-- Real ltree containment, exactly as in the baseline.
CREATE OR REPLACE FUNCTION public.is_ancestor_of(ancestor_id uuid, descendant_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles d
    WHERE d.id = descendant_id
      AND d.hierarchy_path::ltree <@ (
        SELECT p.hierarchy_path::ltree FROM public.profiles p WHERE p.id = ancestor_id
      )
  );
$$;

-- Peer-read helper: harness stand-in driven by a small membership table (production resolves agency
-- group membership); Phase 1 must leave this policy and helper completely alone.
CREATE TABLE IF NOT EXISTS public.harness_agency_group_peers (
  viewer_org uuid NOT NULL,
  peer_org   uuid NOT NULL,
  PRIMARY KEY (viewer_org, peer_org)
);
GRANT SELECT ON public.harness_agency_group_peers TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.is_agency_group_peer_organization(row_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN row_org IS NULL OR public.get_org_id() IS NULL THEN false
    ELSE EXISTS (SELECT 1 FROM public.harness_agency_group_peers g
                  WHERE g.viewer_org = public.get_org_id() AND g.peer_org = row_org)
  END;
$$;

-- ── The REAL calls policies (verbatim production expressions) ────────────────────────────────────
DROP POLICY IF EXISTS harness_all ON public.calls;
DROP POLICY IF EXISTS "Calls Hierarchical Access" ON public.calls;
DROP POLICY IF EXISTS "Calls Agency Group Peer Read" ON public.calls;

CREATE POLICY "Calls Agency Group Peer Read" ON public.calls
  FOR SELECT TO authenticated
  USING (public.is_agency_group_peer_organization(organization_id));

CREATE POLICY "Calls Hierarchical Access" ON public.calls
  TO authenticated
  USING (
    ((agent_id = auth.uid())
     OR public.super_admin_own_org(organization_id)
     OR ((public.get_user_role() = 'Admin'::text) AND (organization_id = public.get_org_id()))
     OR ((public.get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text]))
         AND (organization_id = public.get_org_id())
         AND (agent_id IS NOT NULL)
         AND public.is_ancestor_of(auth.uid(), agent_id))
     OR ((public.get_org_id() IS NOT NULL)
         AND (organization_id = public.get_org_id())
         AND (direction = 'inbound'::text)
         AND (agent_id IS NULL)))
  )
  WITH CHECK (
    ((agent_id = auth.uid())
     OR public.super_admin_own_org(organization_id)
     OR ((public.get_user_role() = 'Admin'::text) AND (organization_id = public.get_org_id()))
     OR ((public.get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text]))
         AND (organization_id = public.get_org_id())
         AND (agent_id IS NOT NULL)
         AND public.is_ancestor_of(auth.uid(), agent_id)))
  );

-- ── Probe scaffolding: results survive across psql sessions so pre/post can be compared ──────────
CREATE SCHEMA IF NOT EXISTS rls_probe;
GRANT USAGE ON SCHEMA rls_probe TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS rls_probe.select_truth (
  phase text NOT NULL,
  actor text NOT NULL,
  row_id uuid NOT NULL,
  PRIMARY KEY (phase, actor, row_id)
);
GRANT SELECT, INSERT ON rls_probe.select_truth TO authenticated, service_role;

-- ── Deterministic fixtures ───────────────────────────────────────────────────────────────────────
-- Org A actors (hierarchy: tl is an ancestor of agent; agent2 is NOT in tl's downline)
--   agent  a1  /  agent2 a2  /  team leader tl  /  team lead alias tl2  /  admin ad  /  super admin sa
-- Org B: cross-org agent b1. Org C: agency-group peer of org A (peer-read only).
INSERT INTO public.organizations (id, name) VALUES
  ('11111111-0000-0000-0000-00000000000a', 'RLS Org A'),
  ('22222222-0000-0000-0000-00000000000b', 'RLS Org B'),
  ('33333333-0000-0000-0000-00000000000c', 'RLS Org C (peer)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.harness_agency_group_peers (viewer_org, peer_org) VALUES
  ('33333333-0000-0000-0000-00000000000c', '11111111-0000-0000-0000-00000000000a')
ON CONFLICT DO NOTHING;

INSERT INTO auth.users (id) VALUES
  ('aaaa1111-0000-0000-0000-000000000001'),
  ('aaaa1111-0000-0000-0000-000000000002'),
  ('aaaa1111-0000-0000-0000-0000000000d0'),
  ('aaaa1111-0000-0000-0000-0000000000d2'),
  ('aaaa1111-0000-0000-0000-0000000000ad'),
  ('aaaa1111-0000-0000-0000-00000000005a'),
  ('bbbb2222-0000-0000-0000-000000000001'),
  ('cccc3333-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, organization_id, status, twilio_client_identity, hierarchy_path) VALUES
  ('aaaa1111-0000-0000-0000-0000000000d0', '11111111-0000-0000-0000-00000000000a', 'Active', 'tl_a',    'tl'),
  ('aaaa1111-0000-0000-0000-0000000000d2', '11111111-0000-0000-0000-00000000000a', 'Active', 'tl2_a',   'tl2'),
  ('aaaa1111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-00000000000a', 'Active', 'agent_a1','tl.a1'),
  ('aaaa1111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-00000000000a', 'Active', 'agent_a2','a2'),
  ('aaaa1111-0000-0000-0000-0000000000ad', '11111111-0000-0000-0000-00000000000a', 'Active', 'admin_a', 'ad'),
  ('aaaa1111-0000-0000-0000-00000000005a', '11111111-0000-0000-0000-00000000000a', 'Active', 'sa_a',    'sa'),
  ('bbbb2222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-00000000000b', 'Active', 'agent_b1','b1'),
  ('cccc3333-0000-0000-0000-000000000001', '33333333-0000-0000-0000-00000000000c', 'Active', 'agent_c1','c1')
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET hierarchy_path = 'tl.a1'
 WHERE id = 'aaaa1111-0000-0000-0000-000000000001';

-- Fixed call rows (stable ids so the truth table is comparable across phases).
--  r_unassigned_ring : org A, inbound, agent_id NULL, ringing      ← the Phase 1 target
--  r_unassigned_term : org A, inbound, agent_id NULL, no-answer    ← target, terminal
--  r_assigned_a1     : org A, inbound, agent_id a1                 ← must stay updatable by a1
--  r_assigned_a2     : org A, inbound, agent_id a2 (not tl downline)
--  r_outbound_null   : org A, outbound, agent_id NULL              ← non-target, behavior preserved
--  r_null_direction  : org A, direction NULL, agent_id NULL        ← NULL-safety canary
--    (NB: the legacy 'incoming' alias is UNREPRESENTABLE in public.calls — calls_direction_check
--     allows only 'outbound'/'inbound' (NULL passes). The alias exists solely in provider payloads
--     and frontend direction helpers, so the NULL-direction row is the real legacy/NULL canary.)
--  r_org_b           : org B, inbound, NULL agent                  ← cross-org denial
DELETE FROM public.calls WHERE id IN (
  '0a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000002',
  '0a000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-000000000004',
  '0a000000-0000-4000-8000-000000000005','0a000000-0000-4000-8000-000000000006',
  '0a000000-0000-4000-8000-000000000007','0b000000-0000-4000-8000-000000000001');

INSERT INTO public.calls (id, organization_id, direction, status, agent_id, twilio_call_sid,
                          routed_agent_ids, contact_phone, caller_id_used)
VALUES
  ('0a000000-0000-4000-8000-000000000001','11111111-0000-0000-0000-00000000000a','inbound','ringing',   NULL,
   'CA000000000000000000000000000ra01', ARRAY['aaaa1111-0000-0000-0000-000000000001'::uuid], '+15550000001','+14150000000'),
  ('0a000000-0000-4000-8000-000000000002','11111111-0000-0000-0000-00000000000a','inbound','no-answer', NULL,
   'CA000000000000000000000000000ra02', ARRAY['aaaa1111-0000-0000-0000-000000000001'::uuid], '+15550000002','+14150000000'),
  ('0a000000-0000-4000-8000-000000000003','11111111-0000-0000-0000-00000000000a','inbound','connected',
   'aaaa1111-0000-0000-0000-000000000001','CA000000000000000000000000000ra03', NULL, '+15550000003','+14150000000'),
  ('0a000000-0000-4000-8000-000000000004','11111111-0000-0000-0000-00000000000a','inbound','connected',
   'aaaa1111-0000-0000-0000-000000000002','CA000000000000000000000000000ra04', NULL, '+15550000004','+14150000000'),
  ('0a000000-0000-4000-8000-000000000005','11111111-0000-0000-0000-00000000000a','outbound','ringing',  NULL,
   'CA000000000000000000000000000ra05', NULL, '+15550000005','+14150000000'),
  ('0a000000-0000-4000-8000-000000000007','11111111-0000-0000-0000-00000000000a', NULL, 'ringing',      NULL,
   'CA000000000000000000000000000ra07', NULL, '+15550000007','+14150000000'),
  ('0b000000-0000-4000-8000-000000000001','22222222-0000-0000-0000-00000000000b','inbound','ringing',   NULL,
   'CA000000000000000000000000000rb01', NULL, '+15550000008','+14160000000');

-- ── act_as: run a statement with a role + JWT claims, exactly like PostgREST ─────────────────────
CREATE OR REPLACE FUNCTION rls_probe.claims(p_user uuid, p_org uuid, p_role text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT json_build_object(
    'sub', p_user::text,
    'app_metadata', json_build_object('organization_id', p_org::text, 'role', p_role)
  )::text;
$$;

-- ── Actors and fixture ids as PERMANENT probe tables (the truth capture must COMMIT) ─────────────
CREATE TABLE IF NOT EXISTS rls_probe.actor(name text PRIMARY KEY, uid uuid, org uuid, role text);
DELETE FROM rls_probe.actor;
INSERT INTO rls_probe.actor VALUES
  ('agent',      'aaaa1111-0000-0000-0000-000000000001','11111111-0000-0000-0000-00000000000a','Agent'),
  ('agent2',     'aaaa1111-0000-0000-0000-000000000002','11111111-0000-0000-0000-00000000000a','Agent'),
  ('team_leader','aaaa1111-0000-0000-0000-0000000000d0','11111111-0000-0000-0000-00000000000a','Team Leader'),
  ('team_lead',  'aaaa1111-0000-0000-0000-0000000000d2','11111111-0000-0000-0000-00000000000a','Team Lead'),
  ('admin',      'aaaa1111-0000-0000-0000-0000000000ad','11111111-0000-0000-0000-00000000000a','Admin'),
  ('super_admin','aaaa1111-0000-0000-0000-00000000005a','11111111-0000-0000-0000-00000000000a','Super Admin'),
  ('cross_org',  'bbbb2222-0000-0000-0000-000000000001','22222222-0000-0000-0000-00000000000b','Admin'),
  ('peer_org',   'cccc3333-0000-0000-0000-000000000001','33333333-0000-0000-0000-00000000000c','Agent');

CREATE TABLE IF NOT EXISTS rls_probe.fixture(name text PRIMARY KEY, id uuid);
DELETE FROM rls_probe.fixture;
INSERT INTO rls_probe.fixture VALUES
  ('unassigned_ring','0a000000-0000-4000-8000-000000000001'),
  ('unassigned_term','0a000000-0000-4000-8000-000000000002'),
  ('assigned_a1',    '0a000000-0000-4000-8000-000000000003'),
  ('assigned_a2',    '0a000000-0000-4000-8000-000000000004'),
  ('outbound_null',  '0a000000-0000-4000-8000-000000000005'),
  ('null_direction', '0a000000-0000-4000-8000-000000000007'),
  ('org_b',          '0b000000-0000-4000-8000-000000000001');

GRANT SELECT ON rls_probe.actor, rls_probe.fixture TO authenticated, service_role;

-- ── Baseline policy expressions captured from the catalog WHILE the original ALL policy exists.
-- The Phase 1 assertions compare the new SELECT/INSERT/UPDATE expressions against these, so
-- "uses the original expression exactly" is proven against Postgres's own normalized form.
CREATE TABLE IF NOT EXISTS rls_probe.baseline_policy(k text PRIMARY KEY, v text);
DELETE FROM rls_probe.baseline_policy;
INSERT INTO rls_probe.baseline_policy(k, v)
SELECT 'using', qual FROM pg_policies
 WHERE schemaname='public' AND tablename='calls' AND policyname='Calls Hierarchical Access';
INSERT INTO rls_probe.baseline_policy(k, v)
SELECT 'check', with_check FROM pg_policies
 WHERE schemaname='public' AND tablename='calls' AND policyname='Calls Hierarchical Access';
-- Grants + RLS state fingerprints, captured BEFORE Phase 1 so "unchanged" is proven by comparison
-- rather than by a hard-coded count (the harness grants differ from production's by design).
INSERT INTO rls_probe.baseline_policy(k, v)
SELECT 'grants', string_agg(grantee || ':' || privilege_type, ', ' ORDER BY grantee, privilege_type)
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'calls';
INSERT INTO rls_probe.baseline_policy(k, v)
SELECT 'rls_state', (relrowsecurity::text || '/' || relforcerowsecurity::text)
  FROM pg_class WHERE oid = 'public.calls'::regclass;
INSERT INTO rls_probe.baseline_policy(k, v)
SELECT 'peer_read', qual FROM pg_policies
 WHERE schemaname='public' AND tablename='calls' AND policyname='Calls Agency Group Peer Read';

DO $$ BEGIN
  IF (SELECT count(*) FROM rls_probe.baseline_policy) <> 5 THEN
    RAISE EXCEPTION 'harness could not capture the full baseline fingerprint (policies/grants/rls state)';
  END IF;
END $$;
GRANT SELECT ON rls_probe.baseline_policy TO authenticated, service_role;
