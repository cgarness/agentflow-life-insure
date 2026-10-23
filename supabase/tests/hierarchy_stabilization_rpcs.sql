-- =====================================================================================================
-- Hierarchy stabilization — RPC authorization matrix (plan §8 "RPCs (all 17 direct callers)" and the ported
-- import_campaign_attachment.sql T4 / contacts_permissions_integration.sql T2g cases). DISPOSABLE LOCAL PostgreSQL
-- ONLY; synthetic data only.
-- =====================================================================================================
-- Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md §2, §4, §5 (D2, D3, D7), §8, §R (R1).
-- Run by scripts/run_hierarchy_stabilization_tests.sh once per database state, as the postgres superuser:
--   psql -X -qAt -v ON_ERROR_STOP=1 -v state=<S0|S1|S2|S3|S1R|S2R|S3R> -f supabase/tests/hierarchy_stabilization_rpcs.sql
-- Every function below is production's own body, verbatim and digest-checked by scripts/hierarchy_fixture.py
-- (AUTHZ_FUNCTIONS). Public entry points run as role authenticated with PostgREST-shaped claims; private helpers run
-- as postgres with the caller's claims, the way their SECURITY DEFINER entry points reach them.
--
-- The 17 direct is_ancestor_of callers and where they are exercised:
--   _contacts_filtered_leads (via contacts_lead_ids_matching, get_contacts_lead_kanban, search_contacts_leads) · 1
--   get_contact_scope_agents · 1   private.performance_scope · 2   _import_undo_context (undo / finalize) · 3
--   convert_lead_to_client_atomic · 4   delete_contact · 5   profile_authz.can_update_profile · hierarchy_
--   stabilization_rls.sql §2/§6   private.can_administer_campaign, private.can_authorize_campaign_lead,
--   private.assert_may_assign_to (create_import_campaign, add_leads_to_campaign, validate_team_queue_association) · 6
--   notify_win · 7   create_client_with_sale, convert_lead_to_client_with_sales, update_client_with_policy_sale,
--   record_client_policy, update_client_with_policy_sale_handoff · 8   policy_commission_authz.access · 9
--   Reports (get_report_scope_v2 → resolve_downline_ids) and is_ancestor_of ↔ resolve_downline_ids parity · 10
--   R1 promotion and organization-claim mismatch · 11 (Deleted / demoted Team Leaders: in every section)
-- The suite ends by proving every refusal left nothing behind (all business and receipt tables equal the setup).
--
-- NOT HARNESSED (residual risk, recorded here and in the Gate 1 report):
--   * The Phase 2A commission engine behind private.policy_sale_commission_step (policy_commission_handoff, grids,
--     estimates, the cluster-global writer role). The capture decision it delegates to — policy_commission_authz.
--     access: 'read' for a Team Leader over a downline seller when "View Others' Commission Percentage" is on, NULL
--     when off — is exercised verbatim (§9); a handoff here reports {status: not_recorded, reason: handoff_failed}.
--     Capture rows themselves are covered by supabase/tests/policy_commission_handoff.sql (preimage is_ancestor_of).
--   * get_performance_summary / get_performance_details: only their scope resolver performance_scope is exercised.
--   * retry_import_campaign_attachment, preview_contact_import: they share _import_undo_context with undo/finalize.
--   * Production's side-effect triggers on leads / clients / campaign_leads (history capture, workflows, counters).
--
-- Deleted descendants (D2): is_ancestor_of keeps them, so a Team Leader still reaches a Deleted report's records and
-- performance; Reports' resolve_downline_ids excludes them. Only functions that themselves require an Active target
-- (assert_may_assign_to) refuse a Deleted target. Both are pinned below.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

SELECT :'state' IN ('S0', 'S1', 'S2', 'S3', 'S1R', 'S2R', 'S3R') AS state_known \gset
\if :state_known
\else
SELECT hierarchy_test.check(false, 'the state variable is one of S0 S1 S2 S3 S1R S2R S3R');
\endif
SELECT :'state' IN ('S1', 'S2', 'S3', 'S2R') AS m1, :'state' IN ('S3', 'S3R') AS repaired \gset
SELECT hierarchy_test.eq(hierarchy_test.fn_md5('public.is_ancestor_of(uuid,uuid)'),
                         CASE WHEN :'m1' THEN 'c6d121db50b7ea2e37ce4a620cc855af' ELSE '7c5213032696734f2e0c5ffe5a71a07a' END,
                         :'state' || ' rpc: the database is in the declared state (is_ancestor_of digest)');
SELECT hierarchy_test.eq(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'hierarchy_test') AND p.prosrc ~ 'is_ancestor_of'
      AND p.oid <> 'public.is_ancestor_of(uuid,uuid)'::regprocedure),
  17::bigint, :'state' || ' rpc: exactly the 17 production direct callers of is_ancestor_of are present (verbatim)');

-- ── Helpers (session-local; not production objects) ─────────────────────────────────────────────────────────────
-- call(uid, sql[, role, org, super]): the single value sql returns, as text, run as role authenticated with the
-- caller's claims (fresh, or stale / forged when role/org/super are given); 'REJECTED <sqlstate>: <message>' on error.
CREATE FUNCTION pg_temp.call(p_uid uuid, p_sql text, p_role text DEFAULT NULL, p_org uuid DEFAULT NULL,
                             p_super boolean DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_prev text := coalesce(current_setting('request.jwt.claims', true), ''); v_out text;
BEGIN
  PERFORM set_config('request.jwt.claims', hierarchy_test.claims(p_uid, p_role, p_org, p_super), true);
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql INTO v_out;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    v_out := 'REJECTED ' || SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', v_prev, true);
  RETURN coalesce(v_out, '<null>');
END $$;
-- definer(uid, sql[, role, org]): the same as postgres with the caller's claims (a private helper as reached from its
-- SECURITY DEFINER entry point; clients cannot execute private.*).
CREATE FUNCTION pg_temp.definer(p_uid uuid, p_sql text, p_role text DEFAULT NULL, p_org uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_prev text := coalesce(current_setting('request.jwt.claims', true), ''); v_out text;
BEGIN
  PERFORM set_config('request.jwt.claims', hierarchy_test.claims(p_uid, p_role, p_org), true);
  BEGIN
    EXECUTE p_sql INTO v_out;
  EXCEPTION WHEN OTHERS THEN
    v_out := 'REJECTED ' || SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', v_prev, true);
  RETURN coalesce(v_out, '<null>');
END $$;
-- keys(ids): profile keys of a uuid array, sorted ('-' when empty).
CREATE FUNCTION pg_temp.keys(p_ids uuid[]) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(hierarchy_test.key(x), ',' ORDER BY hierarchy_test.key(x) COLLATE "C"), '-') FROM unnest(p_ids) x $$;
GRANT EXECUTE ON FUNCTION pg_temp.keys(uuid[]) TO authenticated;

BEGIN;
-- ── Cast and data (system caller; the cast's paths are canonicalised so every state starts identical) ──────────
SELECT hierarchy_test.act_as(NULL) AS _ \gset
SELECT hierarchy_test.id('R') AS r, hierarchy_test.id('BA') AS ba, hierarchy_test.id('T') AS t, hierarchy_test.id('A1') AS a1,
       hierarchy_test.org('A') AS org_a, hierarchy_test.org('B') AS org_b,
       'f1000000-0000-4000-8000-000000000001' AS ht, 'f1000000-0000-4000-8000-000000000002' AS ha,
       'f1000000-0000-4000-8000-000000000003' AS hg, 'f1000000-0000-4000-8000-000000000004' AS hd,
       'f1000000-0000-4000-8000-000000000005' AS hp, 'f1000000-0000-4000-8000-000000000006' AS hs,
       'f1000000-0000-4000-8000-000000000008' AS bt, 'f1000000-0000-4000-8000-000000000009' AS bb \gset
INSERT INTO auth.users (id, email)
SELECT ('f1000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid, 'authz' || n || '@synthetic.invalid'
  FROM generate_series(1, 9) n WHERE n <> 7;
INSERT INTO hierarchy_test.shape (shape, key, id)
VALUES ('authz', 'HT', :'ht'), ('authz', 'HA', :'ha'), ('authz', 'HG', :'hg'), ('authz', 'HD', :'hd'), ('authz', 'HP', :'hp'),
       ('authz', 'HS', :'hs'), ('authz', 'BT', :'bt'), ('authz', 'BB', :'bb');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email)
VALUES (:'ht', :'org_a', :'r', 'Team Leader', 'Active', 'Synthetic HT', 'HT', 'ht@synthetic.invalid');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email)
VALUES (:'ha', :'org_a', :'ht', 'Agent', 'Active', 'Synthetic HA', 'HA', 'ha@synthetic.invalid');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email)
VALUES (:'hg', :'org_a', :'ha', 'Agent', 'Active', 'Synthetic HG', 'HG', 'hg@synthetic.invalid');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email)
VALUES (:'hd', :'org_a', :'ht', 'Agent', 'Deleted', 'Synthetic HD', 'HD', 'hd@synthetic.invalid');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email)
VALUES (:'hp', :'org_a', :'r', 'Agent', 'Active', 'Synthetic HP', 'HP', 'hp@synthetic.invalid');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email, is_super_admin)
VALUES (:'hs', :'org_a', :'r', 'Team Leader', 'Active', 'Synthetic HS', 'HS', 'hs@synthetic.invalid', true);
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email)
VALUES (:'bt', :'org_b', :'ba', 'Team Leader', 'Active', 'Synthetic BT', 'BT', 'bt@synthetic.invalid');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email)
VALUES (:'bb', :'org_b', :'bt', 'Agent', 'Active', 'Synthetic BB', 'BB', 'bb@synthetic.invalid');
UPDATE public.profiles SET hierarchy_path = public.compute_hierarchy_path(id)
 WHERE id IN (:'ht', :'ha', :'hg', :'hd', :'hp', :'hs', :'bt', :'bb');
SELECT hierarchy_test.eq((SELECT count(*) FROM hierarchy_test.stale() s WHERE s.id IN (:'ht', :'ha', :'hg', :'hd', :'hp', :'hs', :'bt', :'bb')),
       0::bigint, :'state' || ' rpc setup: the cast''s paths are canonical in this state');
INSERT INTO public.company_settings (organization_id, company_name, timezone)
VALUES (:'org_a', 'Synthetic Agency A', 'America/Chicago'), (:'org_b', 'Synthetic Agency B', 'America/Chicago');
INSERT INTO public.leads (id, organization_id, assigned_agent_id, user_id, first_name, last_name, status, state) VALUES
  ('f2000000-0000-4000-8000-000000000001', :'org_a', :'ht', :'ht', 'Synthetic lead', 'HT', 'New', 'TX'),
  ('f2000000-0000-4000-8000-000000000002', :'org_a', :'ha', :'ha', 'Synthetic lead', 'HA', 'New', 'TX'),
  ('f2000000-0000-4000-8000-000000000003', :'org_a', :'hg', :'hg', 'Synthetic lead', 'HG', 'New', 'TX'),
  ('f2000000-0000-4000-8000-000000000004', :'org_a', :'hd', :'hd', 'Synthetic lead', 'HD', 'New', 'TX'),
  ('f2000000-0000-4000-8000-000000000005', :'org_a', :'hp', :'hp', 'Synthetic lead', 'HP', 'New', 'TX'),
  ('f2000000-0000-4000-8000-000000000006', :'org_b', :'bb', :'bb', 'Synthetic lead', 'BB', 'New', 'TX'),
  ('f2000000-0000-4000-8000-000000000007', :'org_a', NULL, NULL, 'Synthetic lead', 'UN', 'New', 'TX'),
  ('f2000000-0000-4000-8000-000000000008', :'org_a', :'a1', :'a1', 'Synthetic lead', 'A1', 'New', 'TX'),
  ('f2000000-0000-4000-8000-000000000011', :'org_a', :'ha', :'ha', 'Synthetic lead', 'CV1', 'New', 'TX'),
  ('f2000000-0000-4000-8000-000000000012', :'org_a', :'ha', :'ha', 'Synthetic lead', 'CV2', 'New', 'TX'),
  ('f2000000-0000-4000-8000-000000000021', :'org_a', :'ha', :'ha', 'Synthetic lead', 'IMP', 'New', 'TX'),
  ('f2000000-0000-4000-8000-000000000025', :'org_a', :'hp', :'hp', 'Synthetic lead', 'IMPP', 'New', 'TX'),
  ('f2000000-0000-4000-8000-000000000026', :'org_b', :'bb', :'bb', 'Synthetic lead', 'IMPB', 'New', 'TX');
INSERT INTO public.clients (id, organization_id, assigned_agent_id, first_name, last_name) VALUES
  ('f3000000-0000-4000-8000-000000000002', :'org_a', :'ha', 'Synthetic client', 'HA'),
  ('f3000000-0000-4000-8000-000000000005', :'org_a', :'hp', 'Synthetic client', 'HP'),
  ('f3000000-0000-4000-8000-000000000006', :'org_b', :'bb', 'Synthetic client', 'BB');
-- Sold clients and their wins, written as the system the way insert_policy_sale writes them (identity trigger,
-- premium snapshot, the client's own seller).
INSERT INTO public.clients (id, organization_id, assigned_agent_id, first_name, last_name, carrier, policy_type, premium, sold_date) VALUES
  ('f3000000-0000-4000-8000-000000000012', :'org_a', :'ha', 'Synthetic sold', 'WHA', 'Synthetic Life', 'Term', 50, '2026-10-01'),
  ('f3000000-0000-4000-8000-000000000015', :'org_a', :'hp', 'Synthetic sold', 'WHP', 'Synthetic Life', 'Term', 50, '2026-10-01'),
  ('f3000000-0000-4000-8000-000000000016', :'org_b', :'bb', 'Synthetic sold', 'WBB', 'Synthetic Life', 'Term', 50, '2026-10-01');
INSERT INTO public.wins (id, organization_id, policy_id, agent_id, agent_name, contact_id, contact_name, policy_type,
                         premium_amount, premium_snapshot, sold_date)
SELECT ('f9000000-0000-4000-8000-0000000000' || right(c.id::text, 2))::uuid, c.organization_id, c.primary_policy_id,
       c.assigned_agent_id, 'Synthetic seller', c.id, 'Synthetic sold', 'Term', 50, true, '2026-10-01'
  FROM public.clients c WHERE c.id IN ('f3000000-0000-4000-8000-000000000012', 'f3000000-0000-4000-8000-000000000015',
                                       'f3000000-0000-4000-8000-000000000016');
INSERT INTO public.import_history (id, organization_id, agent_id, imported_lead_ids, file_name) VALUES
  ('fa000000-0000-4000-8000-000000000002', :'org_a', :'ha', '["f2000000-0000-4000-8000-000000000021"]', 'synthetic.csv'),
  ('fa000000-0000-4000-8000-000000000005', :'org_a', :'hp', '["f2000000-0000-4000-8000-000000000025"]', 'synthetic.csv'),
  ('fa000000-0000-4000-8000-000000000006', :'org_b', :'bb', '["f2000000-0000-4000-8000-000000000026"]', 'synthetic.csv');
INSERT INTO public.campaigns (id, organization_id, name, type, status, user_id, created_by, assigned_agent_ids) VALUES
  ('fb000000-0000-4000-8000-000000000001', :'org_a', 'Synthetic TL pool', 'Open Pool', 'Active', :'ht', :'ht', '[]'),
  ('fb000000-0000-4000-8000-000000000002', :'org_a', 'Synthetic HA personal', 'Personal', 'Active', :'ha', :'ha', '[]'),
  ('fb000000-0000-4000-8000-000000000005', :'org_a', 'Synthetic HP personal', 'Personal', 'Active', :'hp', :'hp', '[]');
SELECT 'f2000000-0000-4000-8000-000000000002' AS l_ha, 'f2000000-0000-4000-8000-000000000005' AS l_hp,
       'f2000000-0000-4000-8000-000000000006' AS l_bb, 'f2000000-0000-4000-8000-000000000007' AS l_un,
       'f2000000-0000-4000-8000-000000000011' AS l_cv1, 'f2000000-0000-4000-8000-000000000012' AS l_cv2,
       'f3000000-0000-4000-8000-000000000002' AS c_ha, 'f3000000-0000-4000-8000-000000000005' AS c_hp,
       'f3000000-0000-4000-8000-000000000006' AS c_bb,
       'f9000000-0000-4000-8000-000000000012' AS w_ha, 'f9000000-0000-4000-8000-000000000015' AS w_hp,
       'f9000000-0000-4000-8000-000000000016' AS w_bb,
       'fa000000-0000-4000-8000-000000000002' AS imp_ha, 'fa000000-0000-4000-8000-000000000005' AS imp_hp,
       'fa000000-0000-4000-8000-000000000006' AS imp_bb,
       'fb000000-0000-4000-8000-000000000001' AS camp_ht, 'fb000000-0000-4000-8000-000000000002' AS camp_ha,
       'fb000000-0000-4000-8000-000000000005' AS camp_hp,
       'REJECTED 42501: profile is not active' AS inactive,
       '{"policy_type": "Term", "carrier": "Synthetic Life", "sold_date": "2026-10-01", "premium": "50"}' AS policy \gset
SELECT hierarchy_test.eq((SELECT count(*) FROM public.wins WHERE id IN (:'w_ha', :'w_hp', :'w_bb') AND policy_id IS NOT NULL), 3::bigint,
       :'state' || ' rpc setup: three wins recorded through the verbatim sale-identity guard');
SELECT md5(string_agg(t || ':' || r, E'\n' ORDER BY t, r)) AS setup_fp FROM (
  SELECT 'profiles' t, to_jsonb(x)::text r FROM public.profiles x UNION ALL SELECT 'leads', to_jsonb(x)::text FROM public.leads x
  UNION ALL SELECT 'clients', to_jsonb(x)::text FROM public.clients x UNION ALL SELECT 'wins', to_jsonb(x)::text FROM public.wins x
  UNION ALL SELECT 'notifications', to_jsonb(x)::text FROM public.notifications x UNION ALL SELECT 'campaigns', to_jsonb(x)::text FROM public.campaigns x
  UNION ALL SELECT 'campaign_leads', to_jsonb(x)::text FROM public.campaign_leads x UNION ALL SELECT 'imports', to_jsonb(x)::text FROM public.import_history x
  UNION ALL SELECT 'role_permissions', to_jsonb(x)::text FROM public.role_permissions x
  UNION ALL SELECT 'receipts', to_jsonb(x)::text FROM private.policy_sale_receipts x
  UNION ALL SELECT 'identities', to_jsonb(x)::text FROM private.policy_identities x
  UNION ALL SELECT 'associations', to_jsonb(x)::text FROM private.team_queue_associations x) s \gset

-- ── 1. Contacts readers (_contacts_filtered_leads, get_contact_scope_agents; invoker, RLS also applies) ────────
SELECT 'SELECT coalesce(string_agg(l.last_name, '','' ORDER BY l.last_name COLLATE "C"), ''-'') FROM public.contacts_lead_ids_matching(''{"scope": "team"}'') m JOIN public.leads l ON l.id = m.id WHERE l.last_name IN (''HT'', ''HA'', ''HG'', ''HD'', ''HP'', ''BB'')' AS team_leads,
       'SELECT pg_temp.keys(ARRAY(SELECT id FROM public.get_contact_scope_agents()))' AS scope_agents \gset
SELECT hierarchy_test.eq(pg_temp.call(:'ht', :'team_leads'), 'HA,HD,HG,HT',
       :'state' || ' rpc _contacts_filtered_leads (bulk select): Team Leader "team" scope = own + downline leads');
SELECT hierarchy_test.eq(pg_temp.call(:'ht', 'SELECT (public.get_contacts_lead_kanban(''{"scope": "team"}'', 50)->>''grand_total'')') || ' '
                         || pg_temp.call(:'ht', 'SELECT (public.search_contacts_leads(''{"scope": "team"}'')->>''total_count'')'),
       '7 7', :'state' || ' rpc _contacts_filtered_leads (kanban, search): Team Leader "team" totals (4 cast + 3 downline conversion/import leads)');
SELECT hierarchy_test.eq(pg_temp.call(:'hp', :'team_leads') || ' ' || pg_temp.call(:'bt', :'team_leads'), 'HP BB',
       :'state' || ' rpc _contacts_filtered_leads: peer Agent and cross-org Team Leader "team" scopes hold only their own rows');
SELECT hierarchy_test.eq(pg_temp.call(:'ha', :'team_leads'), 'HA',
       :'state' || ' rpc _contacts_filtered_leads: an Agent with a report sees no report lead (RLS)');
SELECT hierarchy_test.eq(pg_temp.call(:'ht', :'scope_agents'), 'HA,HG,HT',
       :'state' || ' rpc get_contact_scope_agents: Team Leader = self + Active downline (Deleted report excluded)');
SELECT hierarchy_test.eq(pg_temp.call(:'ha', :'scope_agents'), CASE WHEN :'m1' THEN 'HA' ELSE 'HA,HG' END,
       :'state' || ' rpc get_contact_scope_agents: an Agent with a report ' || CASE WHEN :'m1' THEN 'lists only self (no hierarchy authority, D3)' ELSE 'lists the report (preimage: role-blind)' END);
SELECT hierarchy_test.eq(pg_temp.call(:'t', :'scope_agents'), CASE WHEN :'repaired' THEN 'A1,A2,T' ELSE 'T' END,
       :'state' || ' rpc get_contact_scope_agents: shape Team Leader T ' || CASE WHEN :'repaired' THEN 'lists its repaired downline' ELSE 'lists only self (stale paths)' END);
SAVEPOINT c;
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', :'team_leads') || ' ' || pg_temp.call(:'ht', :'scope_agents'),
       CASE WHEN :'m1' THEN 'HT -' ELSE 'HA,HD,HG,HT HA,HG' END,
       :'state' || ' rpc R1 Deleted TL (live JWT): contacts team scope and scope agents ' || CASE WHEN :'m1' THEN 'hold no downline' ELSE 'still hold the downline (preimage gap)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET role = 'Agent' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', :'team_leads', 'Team Leader', :'org_a') || ' ' || pg_temp.call(:'ht', :'scope_agents', 'Team Leader', :'org_a'),
       CASE WHEN :'m1' THEN 'HT HT' ELSE 'HA,HD,HG,HT HA,HG,HT' END,
       :'state' || ' rpc R1 demoted TL (stale TL token): contacts team scope and scope agents ' || CASE WHEN :'m1' THEN 'hold no downline' ELSE 'still hold the downline (preimage gap)' END);
ROLLBACK TO SAVEPOINT c;

-- ── 2. private.performance_scope (Dashboard team / selected agent) ─────────────────────────────────────────────
SELECT 'SELECT pg_temp.keys(agents) || ''|'' || scope_label FROM private.performance_scope(NULL, ''team'')' AS perf_team \gset
SELECT hierarchy_test.eq(pg_temp.definer(:'ht', :'perf_team'), 'HA,HD,HG,HT|self and downline',
       :'state' || ' rpc performance_scope: Team Leader team = self + downline (Deleted report included, D2)');
SELECT hierarchy_test.eq(pg_temp.definer(:'ht', format('SELECT pg_temp.keys(agents) FROM private.performance_scope(%L, ''own'')', :'ha')) || ' '
                         || pg_temp.definer(:'ht', format('SELECT pg_temp.keys(agents) FROM private.performance_scope(%L, ''own'')', :'hd')),
       'HA HD', :'state' || ' rpc performance_scope: Team Leader selects a downline agent (a Deleted one too, D2)');
SELECT hierarchy_test.eq(pg_temp.definer(:'ht', format('SELECT pg_temp.keys(agents) FROM private.performance_scope(%L, ''own'')', :'hp')) || ' | '
                         || pg_temp.definer(:'ht', format('SELECT pg_temp.keys(agents) FROM private.performance_scope(%L, ''own'')', :'bb')),
       'REJECTED 42501: Agent outside permitted performance scope | REJECTED 42501: Agent outside permitted performance scope',
       :'state' || ' rpc performance_scope: a non-downline or cross-org agent is refused');
SELECT hierarchy_test.eq(pg_temp.definer(:'t', :'perf_team'), CASE WHEN :'repaired' THEN 'A1,A2,D1,T|self and downline' ELSE 'T|self and downline' END,
       :'state' || ' rpc performance_scope: shape Team Leader T ' || CASE WHEN :'repaired' THEN 'covers its repaired downline' ELSE 'covers only self (stale paths)' END);
SAVEPOINT c;
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.definer(:'ht', :'perf_team'), :'inactive',
       :'state' || ' rpc R1 Deleted TL (live JWT): performance_scope refuses (campaign_actor requires an Active profile)');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET role = 'Agent' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.definer(:'ht', :'perf_team', 'Team Leader', :'org_a'), 'REJECTED 42501: Team performance access denied',
       :'state' || ' rpc R1 demoted TL (stale TL token): performance_scope follows the database role');
ROLLBACK TO SAVEPOINT c;

-- ── 3. _import_undo_context: undo_contact_import / finalize_contact_import ───────────────────────────────────────
SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.undo_contact_import(%L)->>''success''', :'imp_ha')), 'true',
       :'state' || ' rpc undo_contact_import: Team Leader undoes a downline agent''s import');
SELECT hierarchy_test.check(NOT EXISTS (SELECT 1 FROM public.leads WHERE id = 'f2000000-0000-4000-8000-000000000021'),
       :'state' || ' rpc undo_contact_import: (the imported lead is gone)');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.undo_contact_import(%L)->>''reason''', :'imp_hp')) || ' '
                         || pg_temp.call(:'ht', format('SELECT public.undo_contact_import(%L)->>''reason''', :'imp_bb')),
       'not_authorized cross_org', :'state' || ' rpc undo_contact_import: a non-downline import and a cross-org import are refused');
SELECT hierarchy_test.check(EXISTS (SELECT 1 FROM public.leads WHERE id = 'f2000000-0000-4000-8000-000000000025'),
       :'state' || ' rpc undo_contact_import: (the refused import''s lead survives)');
SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT (public.finalize_contact_import(%L)->>''finalized'') || ''/'' || (public.finalize_contact_import(%L)->>''status'')', :'imp_ha', :'imp_ha')),
       'true/completed', :'state' || ' rpc finalize_contact_import: Team Leader finalizes a downline agent''s import');
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.finalize_contact_import(%L)->>''reason''', :'imp_hp')), 'not_authorized',
       :'state' || ' rpc finalize_contact_import: a non-downline import is refused');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT coalesce(public.undo_contact_import(%L)->>''reason'', ''undone'')', :'imp_ha')) || ' '
                         || pg_temp.call(:'ht', format('SELECT coalesce(public.finalize_contact_import(%L)->>''reason'', ''finalized'')', :'imp_ha')),
       CASE WHEN :'m1' THEN 'not_authorized not_authorized' ELSE 'undone finalized' END,
       :'state' || ' rpc R1 Deleted TL (live JWT): downline import undo and finalize ' || CASE WHEN :'m1' THEN 'refused' ELSE 'still pass (preimage gap)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET role = 'Agent' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.undo_contact_import(%L)->>''reason''', :'imp_ha'), 'Team Leader', :'org_a'), 'not_authorized',
       :'state' || ' rpc R1 demoted TL (stale TL token): import undo follows the database role');
ROLLBACK TO SAVEPOINT c;

-- ── 4. convert_lead_to_client_atomic ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT (public.convert_lead_to_client_atomic(%L, ''{}'')->>''idempotent'')', :'l_cv1')), 'false',
       :'state' || ' rpc convert_lead_to_client_atomic: Team Leader converts a downline lead');
SELECT hierarchy_test.eq((SELECT assigned_agent_id::text FROM public.clients WHERE lead_id = :'l_cv1'), :'ha',
       :'state' || ' rpc convert_lead_to_client_atomic: (the client keeps the downline seller)');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.convert_lead_to_client_atomic(%L, ''{}'')::text', :'l_hp')) || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.convert_lead_to_client_atomic(%L, ''{}'')::text', :'l_bb')),
       'REJECTED 42501: not_authorized | REJECTED 42501: cross_org', :'state' || ' rpc convert_lead_to_client_atomic: non-downline and cross-org leads refused');
SAVEPOINT c;
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.convert_lead_to_client_atomic(%L, ''{}'')->>''idempotent''', :'l_cv1')),
       CASE WHEN :'m1' THEN 'REJECTED 42501: not_authorized' ELSE 'false' END,
       :'state' || ' rpc R1 Deleted TL (live JWT): downline conversion ' || CASE WHEN :'m1' THEN 'refused' ELSE 'still passes (preimage gap)' END);
ROLLBACK TO SAVEPOINT c;

-- ── 5. delete_contact and the Contacts delete toggle (ported contacts_permissions_integration.sql T2g) ──────────
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.delete_contact(''lead'', %L)::text', :'l_ha')),
       'REJECTED 42501: permission_denied:contacts.leads.delete', :'state' || ' rpc delete_contact: Team Leader without the toggle is refused');
SAVEPOINT c;
INSERT INTO public.role_permissions (organization_id, role, permissions) VALUES (:'org_a', 'Team Leader', '{"contacts": {"contacts.leads.delete": true}}');
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.delete_contact(''lead'', %L)->>''deleted''', :'l_ha')), 'true',
       :'state' || ' rpc port contacts_permissions T2g: with the toggle on, the Team Leader deletes a downline lead');
SELECT hierarchy_test.check(NOT EXISTS (SELECT 1 FROM public.leads WHERE id = :'l_ha'), :'state' || ' rpc delete_contact: (the downline lead is gone)');
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.delete_contact(''lead'', %L)::text', :'l_hp')) || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.delete_contact(''lead'', %L)::text', :'l_bb')),
       'REJECTED 42501: not_authorized | REJECTED 42501: cross_org', :'state' || ' rpc delete_contact: non-downline and cross-org leads refused');
SELECT hierarchy_test.check((SELECT count(*) FROM public.leads WHERE id IN (:'l_hp', :'l_bb')) = 2, :'state' || ' rpc delete_contact: (both refused leads survive)');
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.delete_contact(''lead'', %L)->>''deleted''', 'f2000000-0000-4000-8000-000000000003')),
       CASE WHEN :'m1' THEN 'REJECTED 42501: not_authorized' ELSE 'true' END,
       :'state' || ' rpc R1 Deleted TL (live JWT, toggle on): downline delete ' || CASE WHEN :'m1' THEN 'refused' ELSE 'still passes (preimage gap)' END);
ROLLBACK TO SAVEPOINT c;

-- ── 6. Campaigns: assert_may_assign_to (create_import_campaign), can_administer_campaign, can_authorize_campaign_lead
-- Ported import_campaign_attachment.sql T4: a Team Leader may create for self and for a real downline agent.
SELECT 'SELECT public.create_import_campaign(''Synthetic'', ''Personal'', '''', %L, NULL, ''specific_agent'')->>''user_id''' AS mk_personal \gset
SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', 'SELECT public.create_import_campaign(''Synthetic'', ''Personal'', '''', NULL, NULL, ''myself'')->>''user_id'''), :'ht',
       :'state' || ' rpc port import_campaign_attachment T4a: Team Leader creates a Personal campaign for self');
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format(:'mk_personal', :'ha')), :'ha',
       :'state' || ' rpc port import_campaign_attachment T4b: Team Leader creates a Personal campaign for a downline agent');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format(:'mk_personal', :'hp')), format('REJECTED 42501: not authorized to create a campaign for user %s', :'hp'),
       :'state' || ' rpc assert_may_assign_to: a non-downline agent is refused');
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format(:'mk_personal', :'hd')) || ' | ' || pg_temp.call(:'ht', format(:'mk_personal', :'bb')),
       format('REJECTED 42501: target user %s is not active | REJECTED 42501: target user %s is outside your organization', :'hd', :'bb'),
       :'state' || ' rpc assert_may_assign_to: a Deleted downline target and a cross-org target are refused');
SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'t', format(:'mk_personal', :'a1')),
       CASE WHEN :'repaired' THEN :'a1' ELSE format('REJECTED 42501: not authorized to create a campaign for user %s', :'a1') END,
       :'state' || ' rpc port import_campaign_attachment T4b on the shape: T for A1 ' || CASE WHEN :'repaired' THEN 'allowed after the repair' ELSE 'fails closed (stale path)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format(:'mk_personal', :'ha')), :'inactive',
       :'state' || ' rpc R1 Deleted TL (live JWT): create_import_campaign refuses (campaign_actor)');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.definer(:'ht', format('SELECT private.can_administer_campaign(%L)::text', :'camp_ha')) || ' '
                         || pg_temp.definer(:'ht', format('SELECT private.can_administer_campaign(%L)::text', :'camp_hp')) || ' '
                         || pg_temp.definer(:'ht', format('SELECT private.can_authorize_campaign_lead(%L, %L)::text', :'camp_ht', :'l_ha')) || ' '
                         || pg_temp.definer(:'ht', format('SELECT private.can_authorize_campaign_lead(%L, %L)::text', :'camp_ht', :'l_hp')),
       'true false true false', :'state' || ' rpc can_administer_campaign / can_authorize_campaign_lead: downline campaign and lead yes, peer no');
SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT (r->>''added'') || ''/'' || (r->>''skipped_ineligible'') FROM public.add_leads_to_campaign(%L, ARRAY[%L, %L]::uuid[]) r',
                                                    :'camp_ht', :'l_ha', :'l_hp')), '1/1',
       :'state' || ' rpc add_leads_to_campaign: Team Leader attaches the downline lead and the peer lead is ineligible');
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.add_leads_to_campaign(%L, ARRAY[%L]::uuid[])::text', :'camp_hp', :'l_hp')),
       format('REJECTED 42501: not authorized for campaign %s', :'camp_hp'), :'state' || ' rpc add_leads_to_campaign: a peer''s campaign is refused');
INSERT INTO public.campaign_leads (id, campaign_id, lead_id, organization_id, user_id)
VALUES ('fc000000-0000-4000-8000-000000000005', :'camp_ht', :'l_hp', :'org_a', :'hp');
SELECT id AS cl_ha FROM public.campaign_leads WHERE campaign_id = :'camp_ht' AND lead_id = :'l_ha' \gset
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.validate_team_queue_association(%L, %L, %L)::text', :'cl_ha', :'camp_ht', :'l_ha')) || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.validate_team_queue_association(%L, %L, %L)::text', 'fc000000-0000-4000-8000-000000000005', :'camp_ht', :'l_hp')),
       'true | REJECTED 42501: not eligible', :'state' || ' rpc validate_team_queue_association: downline association validated, peer association refused');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.definer(:'ht', format('SELECT private.can_administer_campaign(%L)::text', :'camp_ha')), :'inactive',
       :'state' || ' rpc R1 Deleted TL (live JWT): can_administer_campaign refuses (campaign_actor)');
ROLLBACK TO SAVEPOINT c;

-- ── 7. notify_win ────────────────────────────────────────────────────────────────────────────────────────────────
SELECT (SELECT count(*) FROM public.profiles WHERE organization_id = :'org_a' AND status = 'Active')::text AS org_a_active \gset
SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.notify_win(%L)::text', :'w_ha')), :'org_a_active',
       :'state' || ' rpc notify_win: Team Leader broadcasts a downline win to every Active member of the organization');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.notify_win(%L)::text', :'w_hp')) || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.notify_win(%L)::text', :'w_bb')),
       'REJECTED 42501: not_authorized | REJECTED 42501: not_authorized', :'state' || ' rpc notify_win: a peer''s and a cross-org win are refused');
SELECT hierarchy_test.eq((SELECT count(*) FROM public.notifications), 0::bigint, :'state' || ' rpc notify_win: (no notification written by a refusal)');
SAVEPOINT c;
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.notify_win(%L)::text', :'w_ha')),
       CASE WHEN :'m1' THEN 'REJECTED 42501: not_authorized' ELSE (:'org_a_active'::int - 1)::text END,
       :'state' || ' rpc R1 Deleted TL (live JWT): downline win broadcast ' || CASE WHEN :'m1' THEN 'refused' ELSE 'still passes (preimage gap)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET role = 'Agent' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.notify_win(%L)::text', :'w_ha'), 'Team Leader', :'org_a'), 'REJECTED 42501: not_authorized',
       :'state' || ' rpc R1 demoted TL (stale TL token): notify_win follows the database role');
ROLLBACK TO SAVEPOINT c;

-- ── 8. Sale writers ──────────────────────────────────────────────────────────────────────────────────────────────
SELECT format('SELECT public.create_client_with_sale(gen_random_uuid(), %L, jsonb_build_object(''assigned_agent_id'', %%L, ''first_name'', ''Synthetic'', ''last_name'', ''Sale'') || %L::jsonb, true)->>''client_id''',
              :'org_a', :'policy') AS mk_sale \gset
SAVEPOINT c;
SELECT hierarchy_test.check(pg_temp.call(:'ht', format(:'mk_sale', :'ha')) ~ '^[0-9a-f-]{36}$',
       :'state' || ' rpc create_client_with_sale: Team Leader records a new sale for a downline agent');
SELECT hierarchy_test.eq((SELECT count(*) FROM public.wins w JOIN public.clients c ON c.id = w.contact_id
                           WHERE c.last_name = 'Sale' AND w.agent_id = :'ha' AND c.assigned_agent_id = :'ha'), 1::bigint,
       :'state' || ' rpc create_client_with_sale: (client and win credited to the downline seller)');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format(:'mk_sale', :'hp')) || ' | ' || pg_temp.call(:'ht', format(:'mk_sale', :'bb')),
       'REJECTED 42501: Client organization or owner changed; refresh before saving | REJECTED 42501: Client organization or owner changed; refresh before saving',
       :'state' || ' rpc create_client_with_sale: non-downline and cross-org owners refused');
SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT jsonb_array_length(public.convert_lead_to_client_with_sales(%L, %L, %L::jsonb)->''win_ids'')::text',
                                                    :'l_cv2', :'org_a', :'policy')), '1',
       :'state' || ' rpc convert_lead_to_client_with_sales: Team Leader converts a downline lead with its sale');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.convert_lead_to_client_with_sales(%L, %L, %L::jsonb)::text', :'l_hp', :'org_a', :'policy')) || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.convert_lead_to_client_with_sales(%L, %L, %L::jsonb)::text', :'l_bb', :'org_a', :'policy')),
       'REJECTED 42501: Not authorized to convert this lead | REJECTED 42501: Not authorized to convert this lead',
       :'state' || ' rpc convert_lead_to_client_with_sales: non-downline and cross-org leads refused');
SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.update_client_with_policy_sale(%L, ''{"notes": "tl"}'')->''client''->>''notes''', :'c_ha')) || ' '
                         || pg_temp.call(:'ht', format('SELECT public.update_client_with_policy_sale(%L, jsonb_build_object(''assigned_agent_id'', %L))->''client''->>''assigned_agent_id''', :'c_ha', :'hg')),
       'tl ' || :'hg', :'state' || ' rpc update_client_with_policy_sale: Team Leader edits a downline client and reassigns it within the downline');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.update_client_with_policy_sale(%L, ''{"notes": "tl"}'')::text', :'c_hp')) || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.update_client_with_policy_sale(%L, jsonb_build_object(''assigned_agent_id'', %L))::text', :'c_ha', :'hp')),
       'REJECTED 42501: Client not available | REJECTED 42501: Invalid client owner',
       :'state' || ' rpc update_client_with_policy_sale: a non-downline client and a reassignment outside the downline are refused');
SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT jsonb_array_length(public.record_client_policy(gen_random_uuid(), %L, %L::jsonb, false)->''win_ids'')::text', :'c_ha', :'policy')), '1',
       :'state' || ' rpc record_client_policy: Team Leader records a downline client''s additional policy');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.record_client_policy(gen_random_uuid(), %L, %L::jsonb, false)::text', :'c_hp', :'policy')) || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.record_client_policy(gen_random_uuid(), %L, %L::jsonb, false)::text', :'c_bb', :'policy')),
       'REJECTED 42501: Client not available | REJECTED 42501: Client not available', :'state' || ' rpc record_client_policy: non-downline and cross-org clients refused');
SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.update_client_with_policy_sale_handoff(gen_random_uuid(), %L, ''{"notes": "h"}'')->''commission''->>''status''', :'c_ha')),
       'no_new_policy', :'state' || ' rpc update_client_with_policy_sale_handoff: Team Leader edits a downline client through the handoff');
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT (r->''commission''->>''status'') || ''/'' || (r->''commission''->>''reason'') || ''/'' || jsonb_array_length(r->''win_ids'') FROM public.update_client_with_policy_sale_handoff(gen_random_uuid(), %L, %L::jsonb) r', :'c_ha', :'policy')),
       'not_recorded/handoff_failed/1',
       :'state' || ' rpc update_client_with_policy_sale_handoff: a first policy records its sale; the unharnessed commission engine reports handoff_failed (residual)');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format('SELECT public.update_client_with_policy_sale_handoff(gen_random_uuid(), %L, ''{"notes": "h"}'')::text', :'c_hp')),
       'REJECTED 42501: Client not available', :'state' || ' rpc update_client_with_policy_sale_handoff: a non-downline client is refused');
SAVEPOINT c;
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format(:'mk_sale', :'ha')) || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.update_client_with_policy_sale(%L, ''{"notes": "x"}'')::text', :'c_ha')) || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.record_client_policy(gen_random_uuid(), %L, %L::jsonb, false)::text', :'c_ha', :'policy')) || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.convert_lead_to_client_with_sales(%L, %L, %L::jsonb)::text', :'l_cv2', :'org_a', :'policy')) || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.update_client_with_policy_sale_handoff(gen_random_uuid(), %L, ''{"notes": "h"}'')::text', :'c_ha')),
       :'inactive' || ' | ' || :'inactive' || ' | ' || :'inactive' || ' | ' || :'inactive' || ' | ' || :'inactive',
       :'state' || ' rpc R1 Deleted TL (live JWT): all four sale writers and the handoff refuse (campaign_actor)');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET role = 'Agent' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format(:'mk_sale', :'ha'), 'Team Leader', :'org_a') || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.update_client_with_policy_sale(%L, ''{"notes": "x"}'')::text', :'c_ha'), 'Team Leader', :'org_a'),
       'REJECTED 42501: Client organization or owner changed; refresh before saving | REJECTED 42501: Client not available',
       :'state' || ' rpc R1 demoted TL (stale TL token): sale writers follow the database role');
ROLLBACK TO SAVEPOINT c;

-- Cross-org Team Leader and is_super_admin Team Leader as the actor.
SELECT hierarchy_test.eq(pg_temp.call(:'bt', format('SELECT public.undo_contact_import(%L)->>''reason''', :'imp_ha')) || ' | '
                         || pg_temp.call(:'bt', format('SELECT public.notify_win(%L)::text', :'w_ha')) || ' | '
                         || pg_temp.call(:'bt', format(:'mk_personal', :'ha')),
       format('cross_org | REJECTED 42501: not_authorized | REJECTED 42501: target user %s is outside your organization', :'ha'),
       :'state' || ' rpc cross-org Team Leader: undo, win broadcast and campaign creation over another organization are refused');
SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'hs', format('SELECT public.update_client_with_policy_sale(%L, ''{"notes": "super"}'')->''client''->>''notes''', :'c_hp')) || ' '
                         || pg_temp.call(:'hs', format('SELECT public.undo_contact_import(%L)->>''success''', :'imp_hp')),
       'super true', :'state' || ' rpc is_super_admin Team Leader: organization-wide authority in the sale writers and import undo (unchanged)');
ROLLBACK TO SAVEPOINT c;

-- ── 9. policy_commission_authz.access: the commission capture/read decision (D7, Phase 2A) ──────────────────────
SELECT 'SELECT coalesce(policy_commission_authz.access(%L), ''none'')' AS access \gset
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format(:'access', :'ha')) || ' ' || pg_temp.call(:'ht', format(:'access', :'ht')) || ' '
                         || pg_temp.call(:'r', format(:'access', :'ha')),
       'none write write', :'state' || ' rpc access: toggle off — Team Leader gets nothing over a downline seller (own: write; Admin: write)');
SAVEPOINT c;
INSERT INTO public.role_permissions (organization_id, role, permissions)
VALUES (:'org_a', 'Team Leader', '{"c": [{"name": "View Own Commission Percentage", "agent": true, "teamLeader": true},
                                         {"name": "View Others'' Commission Percentage", "agent": false, "teamLeader": true}]}');
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format(:'access', :'ha')) || ' ' || pg_temp.call(:'ht', format(:'access', :'hd')) || ' '
                         || pg_temp.call(:'ht', format(:'access', :'hp')) || ' ' || pg_temp.call(:'ht', format(:'access', :'bb')),
       'read read none none', :'state' || ' rpc access: toggle on — read over downline sellers (Deleted included), nothing over a peer or another organization');
SELECT hierarchy_test.eq(pg_temp.call(:'t', format(:'access', :'a1')), CASE WHEN :'repaired' THEN 'read' ELSE 'none' END,
       :'state' || ' rpc access: shape Team Leader T over A1 with the toggle on: ' || CASE WHEN :'repaired' THEN 'read after the repair' ELSE 'nothing (stale path)' END);
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format(:'access', :'ha')), 'none',
       :'state' || ' rpc R1 Deleted TL (live JWT): commission access is withdrawn (campaign_actor)');
ROLLBACK TO SAVEPOINT c;

-- ── 10. Reports scope and resolver parity ────────────────────────────────────────────────────────────────────────
SELECT 'SELECT pg_temp.keys(ARRAY(SELECT (a->>''id'')::uuid FROM jsonb_array_elements(public.get_report_scope_v2(''team'')->''agents'') a))' AS report_team \gset
SELECT hierarchy_test.eq(pg_temp.call(:'ht', :'report_team') || ' ' || pg_temp.call(:'t', :'report_team'), 'HA,HG,HT A1,A2,T',
       :'state' || ' rpc get_report_scope_v2(''team''): identical in every state (resolve_downline_ids; Deleted excluded; unaffected by paths)');
SAVEPOINT c;
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.call(:'ht', :'report_team'), :'inactive', :'state' || ' rpc R1 Deleted TL (live JWT): Reports refuse (campaign_actor)');
ROLLBACK TO SAVEPOINT c;
-- is_ancestor_of as the root itself (caller-bound under M1) versus Reports' resolver: equal once Deleted
-- descendants are removed; the documented difference is exactly the Deleted descendants.
SELECT 'SELECT pg_temp.keys(ARRAY(SELECT p.id FROM public.profiles p WHERE p.organization_id = public.get_org_id() AND p.id <> auth.uid() AND public.is_ancestor_of(auth.uid(), p.id)))' AS anc \gset
SELECT hierarchy_test.eq(pg_temp.call(:'ht', :'anc') || ' / ' || pg_temp.keys(ARRAY(SELECT agent_id FROM private.resolve_downline_ids(:'ht', :'org_a') WHERE agent_id <> :'ht')),
       'HA,HD,HG / HA,HG', :'state' || ' rpc parity: Team Leader HT — is_ancestor_of keeps the Deleted report HD, resolve_downline_ids drops it');
SELECT hierarchy_test.eq(pg_temp.call(:'r', :'anc') = pg_temp.keys(ARRAY(SELECT agent_id FROM private.resolve_downline_ids(:'r', :'org_a') WHERE agent_id <> :'r'
                                                                      UNION SELECT id FROM public.profiles WHERE organization_id = :'org_a' AND status = 'Deleted'
                                                                        AND id <> :'r' AND hierarchy_path IS NOT NULL
                                                                        AND hierarchy_path <@ (SELECT hierarchy_path FROM public.profiles WHERE id = :'r'))),
       true, :'state' || ' rpc parity: Admin R — is_ancestor_of = resolve_downline_ids plus the Deleted path descendants');
SELECT hierarchy_test.eq(pg_temp.call(:'t', :'anc') || ' / ' || pg_temp.keys(ARRAY(SELECT agent_id FROM private.resolve_downline_ids(:'t', :'org_a') WHERE agent_id <> :'t')),
       CASE WHEN :'repaired' THEN 'A1,A2,D1 / A1,A2' ELSE '- / A1,A2' END,
       :'state' || ' rpc parity: shape Team Leader T ' || CASE WHEN :'repaired' THEN 'agrees after the repair (D1 Deleted)' ELSE 'disagrees on the stale paths (Reports already include A1, A2)' END);
-- ── 11. Promotion and organization-claim mismatch (R1) ─────────────────────────────────────────────────────────
-- Promotion: definer RPCs read the database role at once; RLS-bound readers wait for the refreshed token.
SAVEPOINT c;
UPDATE public.profiles SET role = 'Team Leader' WHERE id = :'ha';
SELECT hierarchy_test.eq(pg_temp.call(:'ha', format(:'mk_personal', :'hg'), 'Agent', :'org_a') || ' '
                         || pg_temp.call(:'ha', :'team_leads', 'Agent', :'org_a') || ' ' || pg_temp.call(:'ha', :'team_leads'),
       :'hg' || ' HA HA,HG',
       :'state' || ' rpc R1 promotion: with the old Agent token, campaign assignment follows the database role at once; the contacts team scope opens only with the refreshed token');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(pg_temp.call(:'ht', format(:'mk_personal', :'ha'), 'Team Leader', :'org_b') || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.delete_contact(''lead'', %L)::text', :'l_ha'), 'Team Leader', :'org_b') || ' | '
                         || pg_temp.call(:'ht', format('SELECT public.undo_contact_import(%L)->>''reason''', :'imp_ha'), 'Team Leader', :'org_b'),
       'REJECTED 42501: organization mismatch | REJECTED 42501: not_authorized | cross_org',
       :'state' || ' rpc R1 org-claim mismatch: a Team Leader token for another organization is refused by campaign_actor, delete_contact and import undo');

SELECT md5(string_agg(t || ':' || r, E'\n' ORDER BY t, r)) AS final_fp FROM (
  SELECT 'profiles' t, to_jsonb(x)::text r FROM public.profiles x UNION ALL SELECT 'leads', to_jsonb(x)::text FROM public.leads x
  UNION ALL SELECT 'clients', to_jsonb(x)::text FROM public.clients x UNION ALL SELECT 'wins', to_jsonb(x)::text FROM public.wins x
  UNION ALL SELECT 'notifications', to_jsonb(x)::text FROM public.notifications x UNION ALL SELECT 'campaigns', to_jsonb(x)::text FROM public.campaigns x
  UNION ALL SELECT 'campaign_leads', to_jsonb(x)::text FROM public.campaign_leads x UNION ALL SELECT 'imports', to_jsonb(x)::text FROM public.import_history x
  UNION ALL SELECT 'role_permissions', to_jsonb(x)::text FROM public.role_permissions x
  UNION ALL SELECT 'receipts', to_jsonb(x)::text FROM private.policy_sale_receipts x
  UNION ALL SELECT 'identities', to_jsonb(x)::text FROM private.policy_identities x
  UNION ALL SELECT 'associations', to_jsonb(x)::text FROM private.team_queue_associations x) s \gset
SELECT hierarchy_test.eq(:'final_fp'::text, :'setup_fp'::text,
       :'state' || ' rpc: every refusal left nothing behind (all business and receipt tables equal the setup state)');
ROLLBACK;
