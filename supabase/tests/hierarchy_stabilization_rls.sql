-- =====================================================================================================
-- Hierarchy stabilization — RLS authorization matrix (plan §8 "TL permissions", "Stale / forged tokens (R1)",
-- "Ported full-stack cases"). DISPOSABLE LOCAL PostgreSQL ONLY; synthetic data only.
-- =====================================================================================================
-- Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md §R (R1), §4, §5 (D2–D6), §8.
-- Run by scripts/run_hierarchy_stabilization_tests.sh once per database state, as the postgres superuser:
--   psql -X -qAt -v ON_ERROR_STOP=1 -v state=<S0|S1|S2|S3|S1R|S2R|S3R> -f supabase/tests/hierarchy_stabilization_rls.sql
-- Every statement under test runs as the real client would: role authenticated (or anon) with PostgREST-shaped
-- request.jwt.claims — fresh from the profile, or stale / forged when the token and the database disagree. The
-- expectations follow from the state: m1 (M1 live: S1 S2 S3 S2R), m2 (S2 S3), repaired (S3 S3R).
--
-- The cast (inserted below, canonical paths in EVERY state, so TL reach is identical everywhere and only M1 changes
-- what a Team Leader may do with it):
--   org A  R  Admin (shape)                         org B  BA Admin (shape)
--          ├─ HT Team Leader ─┬─ HA Agent ── HG Agent        └─ BT Team Leader ── BB Agent   (cross-org TL)
--          │                  └─ HD Agent (Deleted)
--          ├─ HP Agent (peer, not downline)
--          ├─ HS Team Leader with is_super_admin
--          HX Super Admin (role 'Super Admin', is_super_admin)   HM Admin of org B (T19f, token says org A)
--   GH: an auth user without a profile (T19h)
-- Contacts carry their owner's key (leads/clients/recruits.last_name, calls.contact_name, contact_emails.subject,
-- tasks.title, contact_history_events.after_values->>'k') so a visible set prints as e.g. 'HA,HG,HT'.
-- The production-shaped stale data (shape T over A1/A2/D1) shows activation: dormant until M3 repairs the paths.
--
-- Every case prints 'PASS <name>' or stops with 'FAIL: <name> (actual …, expected …)'. A filtered UPDATE/DELETE is
-- checked by its affected-row count AND by re-reading the row. Everything runs inside BEGIN … ROLLBACK (writes that
-- succeed are undone with ROLLBACK TO SAVEPOINT), so the database is left exactly as it was given.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

SELECT :'state' IN ('S0', 'S1', 'S2', 'S3', 'S1R', 'S2R', 'S3R') AS state_known \gset
\if :state_known
\else
SELECT hierarchy_test.check(false, 'the state variable is one of S0 S1 S2 S3 S1R S2R S3R');
\endif
SELECT :'state' IN ('S1', 'S2', 'S3', 'S2R') AS m1, :'state' IN ('S2', 'S3') AS m2,
       :'state' IN ('S3', 'S3R') AS repaired \gset
SELECT hierarchy_test.eq(hierarchy_test.fn_md5('public.is_ancestor_of(uuid,uuid)'),
                         CASE WHEN :'m1' THEN 'c6d121db50b7ea2e37ce4a620cc855af' ELSE '7c5213032696734f2e0c5ffe5a71a07a' END,
                         :'state' || ' rls: the database is in the declared state (is_ancestor_of digest)');

-- ── Helpers (session-local; not production objects) ─────────────────────────────────────────────────────────────
-- seen(uid, table[, role, org, super]): the keys of the rows the caller can SELECT ('-' when none), or
-- 'REJECTED <sqlstate>: <message>'. uid NULL = anon with PostgREST's anon claims.
CREATE FUNCTION pg_temp.seen(p_uid uuid, p_table text, p_role text DEFAULT NULL, p_org uuid DEFAULT NULL,
                             p_super boolean DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_prev text := coalesce(current_setting('request.jwt.claims', true), '');
  v_key  text := CASE p_table WHEN 'calls' THEN 'contact_name' WHEN 'contact_emails' THEN 'subject' WHEN 'tasks' THEN 'title'
                              WHEN 'contact_history_events' THEN '(after_values->>''k'')' ELSE 'last_name' END;
  v_out  text;
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '{"role":"anon"}'
                                                ELSE hierarchy_test.claims(p_uid, p_role, p_org, p_super) END, true);
  BEGIN
    IF p_uid IS NULL THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
    EXECUTE format('SELECT coalesce(string_agg(%s, '','' ORDER BY %s COLLATE "C"), ''-'') FROM public.%I', v_key, v_key, p_table)
      INTO v_out;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    v_out := 'REJECTED ' || SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', v_prev, true);
  RETURN v_out;
END $$;
-- anon(sql): one statement as role anon with PostgREST's anon claims; 'OK <rows>' or 'REJECTED …'.
CREATE FUNCTION pg_temp.anon(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_prev text := coalesce(current_setting('request.jwt.claims', true), ''); v_n bigint; v_out text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  BEGIN
    SET LOCAL ROLE anon;
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    v_out := 'OK ' || v_n;
  EXCEPTION WHEN OTHERS THEN
    v_out := 'REJECTED ' || SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', v_prev, true);
  RETURN v_out;
END $$;
SELECT 'REJECTED 42501: Only the call''s agent or an Admin of this organization may change this call (coaching flag and notes excepted)' AS call_guard,
       'REJECTED 42501: Only an Admin of this organization may change another member''s commission level' AS level_guard,
       'REJECTED 42501: A contact''s organization cannot be changed by a direct client write' AS org_guard \gset

BEGIN;
-- ── Cast and contacts (system caller; paths canonicalised so every state starts from the same hierarchy) ────────
SELECT hierarchy_test.act_as(NULL) AS _ \gset
SELECT hierarchy_test.id('R') AS r, hierarchy_test.id('BA') AS ba, hierarchy_test.id('T') AS t, hierarchy_test.id('A1') AS a1,
       hierarchy_test.id('A2') AS a2, hierarchy_test.org('A') AS org_a, hierarchy_test.org('B') AS org_b,
       'f1000000-0000-4000-8000-000000000001' AS ht, 'f1000000-0000-4000-8000-000000000002' AS ha,
       'f1000000-0000-4000-8000-000000000003' AS hg, 'f1000000-0000-4000-8000-000000000004' AS hd,
       'f1000000-0000-4000-8000-000000000005' AS hp, 'f1000000-0000-4000-8000-000000000006' AS hs,
       'f1000000-0000-4000-8000-000000000007' AS hx, 'f1000000-0000-4000-8000-000000000008' AS bt,
       'f1000000-0000-4000-8000-000000000009' AS bb, 'f1000000-0000-4000-8000-00000000000a' AS gh,
       'f1000000-0000-4000-8000-00000000000b' AS hm \gset
-- auth.users rows for all eleven ids; GH (…0a) deliberately never gets a profile.
INSERT INTO auth.users (id, email)
SELECT ('f1000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid, 'authz' || n || '@synthetic.invalid'
  FROM generate_series(1, 11) n;
INSERT INTO hierarchy_test.shape (shape, key, id)
VALUES ('authz', 'HT', :'ht'), ('authz', 'HA', :'ha'), ('authz', 'HG', :'hg'), ('authz', 'HD', :'hd'), ('authz', 'HP', :'hp'),
       ('authz', 'HS', :'hs'), ('authz', 'HX', :'hx'), ('authz', 'BT', :'bt'), ('authz', 'BB', :'bb'), ('authz', 'HM', :'hm');
-- One statement per profile, parent first (the M2 builder refuses a child listed before its parent).
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email, commission_level)
VALUES (:'ht', :'org_a', :'r', 'Team Leader', 'Active', 'Synthetic HT', 'HT', 'ht@synthetic.invalid', '80%');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email, commission_level)
VALUES (:'ha', :'org_a', :'ht', 'Agent', 'Active', 'Synthetic HA', 'HA', 'ha@synthetic.invalid', '70%');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email, commission_level)
VALUES (:'hg', :'org_a', :'ha', 'Agent', 'Active', 'Synthetic HG', 'HG', 'hg@synthetic.invalid', '60%');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email, commission_level)
VALUES (:'hd', :'org_a', :'ht', 'Agent', 'Deleted', 'Synthetic HD', 'HD', 'hd@synthetic.invalid', '60%');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email, commission_level)
VALUES (:'hp', :'org_a', :'r', 'Agent', 'Active', 'Synthetic HP', 'HP', 'hp@synthetic.invalid', '60%');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email, is_super_admin)
VALUES (:'hs', :'org_a', :'r', 'Team Leader', 'Active', 'Synthetic HS', 'HS', 'hs@synthetic.invalid', true);
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email, is_super_admin)
VALUES (:'hx', :'org_a', NULL, 'Super Admin', 'Active', 'Synthetic HX', 'HX', 'hx@synthetic.invalid', true);
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email)
VALUES (:'bt', :'org_b', :'ba', 'Team Leader', 'Active', 'Synthetic BT', 'BT', 'bt@synthetic.invalid');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email)
VALUES (:'bb', :'org_b', :'bt', 'Agent', 'Active', 'Synthetic BB', 'BB', 'bb@synthetic.invalid');
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email)
VALUES (:'hm', :'org_b', NULL, 'Admin', 'Active', 'Synthetic HM', 'HM', 'hm@synthetic.invalid');
UPDATE public.profiles SET hierarchy_path = public.compute_hierarchy_path(id)
 WHERE id IN (:'ht', :'ha', :'hg', :'hd', :'hp', :'hs', :'hx', :'bt', :'bb', :'hm');
SELECT hierarchy_test.eq(
  (SELECT string_agg(hierarchy_test.key(id) || '=' || hierarchy_test.sp(hierarchy_path), ' ' ORDER BY hierarchy_test.key(id) COLLATE "C")
     FROM public.profiles WHERE id IN (:'ht', :'ha', :'hg', :'hd', :'hp', :'hs', :'hx', :'bt', :'bb', :'hm')),
  'BB=BA.BT.BB BT=BA.BT HA=R.HT.HA HD=R.HT.HD HG=R.HT.HA.HG HM=HM HP=R.HP HS=R.HS HT=R.HT HX=HX',
  :'state' || ' rls setup: the cast''s paths are canonical in this state');

INSERT INTO public.leads (id, organization_id, assigned_agent_id, user_id, first_name, last_name, status) VALUES
  ('f2000000-0000-4000-8000-000000000001', :'org_a', :'ht', :'ht', 'Synthetic lead', 'HT', 'New'),
  ('f2000000-0000-4000-8000-000000000002', :'org_a', :'ha', :'ha', 'Synthetic lead', 'HA', 'New'),
  ('f2000000-0000-4000-8000-000000000003', :'org_a', :'hg', :'hg', 'Synthetic lead', 'HG', 'New'),
  ('f2000000-0000-4000-8000-000000000004', :'org_a', :'hd', :'hd', 'Synthetic lead', 'HD', 'New'),
  ('f2000000-0000-4000-8000-000000000005', :'org_a', :'hp', :'hp', 'Synthetic lead', 'HP', 'New'),
  ('f2000000-0000-4000-8000-000000000006', :'org_b', :'bb', :'bb', 'Synthetic lead', 'BB', 'New'),
  ('f2000000-0000-4000-8000-000000000007', :'org_a', NULL, NULL, 'Synthetic lead', 'UN', 'New'),
  ('f2000000-0000-4000-8000-000000000008', :'org_a', :'a1', :'a1', 'Synthetic lead', 'A1', 'New');
INSERT INTO public.clients (id, organization_id, assigned_agent_id, first_name, last_name) VALUES
  ('f3000000-0000-4000-8000-000000000001', :'org_a', :'ht', 'Synthetic client', 'HT'),
  ('f3000000-0000-4000-8000-000000000002', :'org_a', :'ha', 'Synthetic client', 'HA'),
  ('f3000000-0000-4000-8000-000000000005', :'org_a', :'hp', 'Synthetic client', 'HP'),
  ('f3000000-0000-4000-8000-000000000006', :'org_b', :'bb', 'Synthetic client', 'BB');
INSERT INTO public.recruits (id, organization_id, assigned_agent_id, first_name, last_name, status) VALUES
  ('f4000000-0000-4000-8000-000000000001', :'org_a', :'ht', 'Synthetic recruit', 'HT', 'New'),
  ('f4000000-0000-4000-8000-000000000002', :'org_a', :'ha', 'Synthetic recruit', 'HA', 'New'),
  ('f4000000-0000-4000-8000-000000000005', :'org_a', :'hp', 'Synthetic recruit', 'HP', 'New'),
  ('f4000000-0000-4000-8000-000000000006', :'org_b', :'bb', 'Synthetic recruit', 'BB', 'New');
INSERT INTO public.calls (id, organization_id, agent_id, direction, status, contact_name, notes) VALUES
  ('f5000000-0000-4000-8000-000000000001', :'org_a', :'ht', 'outbound', 'completed', 'HT', 'n'),
  ('f5000000-0000-4000-8000-000000000002', :'org_a', :'ha', 'outbound', 'completed', 'HA', 'n'),
  ('f5000000-0000-4000-8000-000000000005', :'org_a', :'hp', 'outbound', 'completed', 'HP', 'n'),
  ('f5000000-0000-4000-8000-000000000006', :'org_b', :'bb', 'outbound', 'completed', 'BB', 'n'),
  ('f5000000-0000-4000-8000-000000000008', :'org_a', :'a1', 'outbound', 'completed', 'A1', 'n');
INSERT INTO public.contact_emails (id, organization_id, owner_user_id, provider, direction, external_message_id, from_email, subject) VALUES
  ('f6000000-0000-4000-8000-000000000001', :'org_a', :'ht', 'google', 'inbound', 'm1', 'x@synthetic.invalid', 'HT'),
  ('f6000000-0000-4000-8000-000000000002', :'org_a', :'ha', 'google', 'inbound', 'm2', 'x@synthetic.invalid', 'HA'),
  ('f6000000-0000-4000-8000-000000000005', :'org_a', :'hp', 'google', 'inbound', 'm5', 'x@synthetic.invalid', 'HP');
INSERT INTO public.tasks (id, organization_id, contact_id, contact_type, assigned_to, created_by, title, task_type, due_date) VALUES
  ('f7000000-0000-4000-8000-000000000001', :'org_a', 'f2000000-0000-4000-8000-000000000001', 'lead', :'ht', :'r', 'HT', 'General', now()),
  ('f7000000-0000-4000-8000-000000000002', :'org_a', 'f2000000-0000-4000-8000-000000000002', 'lead', :'ha', :'r', 'HA', 'General', now()),
  ('f7000000-0000-4000-8000-000000000005', :'org_a', 'f2000000-0000-4000-8000-000000000005', 'lead', :'hp', :'r', 'HP', 'General', now());
INSERT INTO public.contact_history_events (id, organization_id, contact_id, contact_type, source_table, source_id, action,
                                           actor_kind, access_ids, after_values) VALUES
  ('f8000000-0000-4000-8000-000000000002', :'org_a', 'f2000000-0000-4000-8000-000000000002', 'lead', 'leads',
   'f2000000-0000-4000-8000-000000000002', 'updated', 'system', '{}', '{"k": "H_HA"}'),
  ('f8000000-0000-4000-8000-000000000012', :'org_a', 'f2000000-0000-4000-8000-000000000002', 'lead', 'tasks',
   'f7000000-0000-4000-8000-000000000002', 'created', 'system', '{}', '{"k": "H_HAtask"}'),
  ('f8000000-0000-4000-8000-000000000022', :'org_a', 'f2000000-0000-4000-8000-000000000002', 'lead', 'contact_notes',
   gen_random_uuid(), 'deleted', 'system', ARRAY[:'ha']::uuid[], '{"k": "H_HAdeleted"}'),
  ('f8000000-0000-4000-8000-000000000005', :'org_a', 'f2000000-0000-4000-8000-000000000005', 'lead', 'leads',
   'f2000000-0000-4000-8000-000000000005', 'updated', 'system', '{}', '{"k": "H_HP"}');
SELECT 'f2000000-0000-4000-8000-000000000001' AS l_ht, 'f2000000-0000-4000-8000-000000000002' AS l_ha,
       'f2000000-0000-4000-8000-000000000003' AS l_hg, 'f2000000-0000-4000-8000-000000000005' AS l_hp,
       'f2000000-0000-4000-8000-000000000007' AS l_un, 'f2000000-0000-4000-8000-000000000008' AS l_a1,
       'f3000000-0000-4000-8000-000000000002' AS c_ha, 'f4000000-0000-4000-8000-000000000002' AS r_ha,
       'f5000000-0000-4000-8000-000000000002' AS k_ha, 'f5000000-0000-4000-8000-000000000005' AS k_hp,
       'f5000000-0000-4000-8000-000000000008' AS k_a1 \gset

-- ── 1. Visibility matrix, fresh tokens (identical in every state: M1 narrows only stale and Deleted authority) ──
SELECT hierarchy_test.eq(pg_temp.seen(:'ha', 'leads'), 'HA', :'state' || ' rls leads: Agent sees own leads only (a report''s leads stay hidden)');
SELECT hierarchy_test.eq(pg_temp.seen(:'hp', 'leads'), 'HP', :'state' || ' rls leads: peer Agent sees own leads only');
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'leads'), 'HA,HD,HG,HT', :'state' || ' rls leads: Team Leader sees own + whole downline (Deleted report included, D2)');
SELECT hierarchy_test.eq(pg_temp.seen(:'r', 'leads'), 'A1,HA,HD,HG,HP,HT,UN', :'state' || ' rls leads: Admin sees the organization');
SELECT hierarchy_test.eq(pg_temp.seen(:'hx', 'leads'), 'A1,HA,HD,HG,HP,HT,UN', :'state' || ' rls leads: Super Admin (is_super_admin) sees the organization');
SELECT hierarchy_test.eq(pg_temp.seen(:'hs', 'leads'), 'A1,HA,HD,HG,HP,HT,UN', :'state' || ' rls leads: is_super_admin Team Leader sees the organization');
SELECT hierarchy_test.eq(pg_temp.seen(:'bt', 'leads'), 'BB', :'state' || ' rls leads: cross-org Team Leader sees only its own organization''s downline');
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'clients'), 'HA,HT', :'state' || ' rls clients: Team Leader sees own + downline');
SELECT hierarchy_test.eq(pg_temp.seen(:'r', 'clients'), 'HA,HP,HT', :'state' || ' rls clients: Admin sees the organization');
SELECT hierarchy_test.eq(pg_temp.seen(:'ha', 'clients'), 'HA', :'state' || ' rls clients: Agent sees own');
SELECT hierarchy_test.eq(pg_temp.seen(:'bt', 'clients'), 'BB', :'state' || ' rls clients: cross-org Team Leader sees only its organization');
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'recruits'), 'HA,HT', :'state' || ' rls recruits: Team Leader sees own + downline');
SELECT hierarchy_test.eq(pg_temp.seen(:'hp', 'recruits'), 'HP', :'state' || ' rls recruits: peer Agent sees own');
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'calls'), 'HA,HT', :'state' || ' rls calls: Team Leader sees own + downline calls');
SELECT hierarchy_test.eq(pg_temp.seen(:'r', 'calls'), 'A1,HA,HP,HT', :'state' || ' rls calls: Admin sees the organization''s calls');
SELECT hierarchy_test.eq(pg_temp.seen(:'ha', 'calls'), 'HA', :'state' || ' rls calls: Agent sees own calls');
SELECT hierarchy_test.eq(pg_temp.seen(:'bt', 'calls'), 'BB', :'state' || ' rls calls: cross-org Team Leader sees only its organization');
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'contact_emails'), 'HA,HT', :'state' || ' rls contact_emails: Team Leader sees own + downline mail');
SELECT hierarchy_test.eq(pg_temp.seen(:'hx', 'contact_emails'), 'HA,HP,HT', :'state' || ' rls contact_emails: Super Admin sees the organization''s mail');
SELECT hierarchy_test.eq(pg_temp.seen(:'ha', 'contact_emails'), 'HA', :'state' || ' rls contact_emails: Agent sees own mail');
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'tasks'), 'HA,HT', :'state' || ' rls tasks: Team Leader sees own + downline tasks');
SELECT hierarchy_test.eq(pg_temp.seen(:'ha', 'tasks'), 'HA', :'state' || ' rls tasks: Agent sees own tasks');
SELECT hierarchy_test.eq(pg_temp.seen(:'bt', 'tasks'), '-', :'state' || ' rls tasks: cross-org Team Leader sees none');
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'contact_history_events'), 'H_HA,H_HAtask',
       :'state' || ' rls contact history: Team Leader sees downline history (deleted-source tombstone stays involved-only)');
SELECT hierarchy_test.eq(pg_temp.seen(:'ha', 'contact_history_events'), 'H_HA,H_HAdeleted,H_HAtask', :'state' || ' rls contact history: owner sees own history and its tombstone');
SELECT hierarchy_test.eq(pg_temp.seen(:'r', 'contact_history_events'), 'H_HA,H_HAdeleted,H_HAtask,H_HP', :'state' || ' rls contact history: Admin sees the organization''s history');
SELECT hierarchy_test.eq(pg_temp.seen(:'hp', 'contact_history_events'), 'H_HP', :'state' || ' rls contact history: peer Agent sees own only');
-- anon: no table row is reachable with the anon key (tasks errors in get_org_id's profile fallback, as in production).
SELECT hierarchy_test.eq(pg_temp.seen(NULL, 'leads') || ' ' || pg_temp.seen(NULL, 'clients') || ' ' || pg_temp.seen(NULL, 'recruits')
                         || ' ' || pg_temp.seen(NULL, 'calls') || ' ' || pg_temp.seen(NULL, 'contact_emails'), '- - - - -',
       :'state' || ' rls anon: leads, clients, recruits, calls and contact_emails return no row');
SELECT hierarchy_test.eq(pg_temp.seen(NULL, 'tasks'), 'REJECTED 42501: permission denied for table profiles',
       :'state' || ' rls anon: tasks is refused (no row, no error from is_ancestor_of''s revoked EXECUTE)');
SELECT hierarchy_test.eq(split_part(pg_temp.seen(NULL, 'contact_history_events'), ':', 1) || ' ' || split_part(pg_temp.anon('SELECT 1 FROM public.profiles'), ':', 1),
       'REJECTED 42501 REJECTED 42501', :'state' || ' rls anon: contact_history_events and profiles are refused');
SELECT hierarchy_test.eq(pg_temp.anon(format('UPDATE public.leads SET notes = ''x'' WHERE id = %L', :'l_ha')) || ' ' ||
                         pg_temp.anon(format('DELETE FROM public.calls WHERE id = %L', :'k_ha')), 'OK 0 OK 0',
       :'state' || ' rls anon: UPDATE of a lead and DELETE of a call reach no row');
SELECT hierarchy_test.check((SELECT notes IS NULL FROM public.leads WHERE id = :'l_ha') AND EXISTS (SELECT 1 FROM public.calls WHERE id = :'k_ha'),
       :'state' || ' rls anon: (the lead is unchanged and the call survives)');

-- ── 2. Writes by a fresh Team Leader and the other roles ────────────────────────────────────────────────────────
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.leads SET notes = ''tl edit'' WHERE id = %L', :'l_ha')), 'OK 1',
       :'state' || ' rls leads: Team Leader updates a downline lead');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.leads SET notes = ''tl edit'' WHERE id = %L', :'l_hp')), 'OK 0',
       :'state' || ' rls leads: Team Leader update of a non-downline lead reaches no row');
SELECT hierarchy_test.check((SELECT notes IS NULL FROM public.leads WHERE id = :'l_hp'), :'state' || ' rls leads: (the non-downline lead is unchanged)');
ROLLBACK TO SAVEPOINT c;
-- D5: a Team Leader PROFILE needs contacts.leads.delete (default off) for any direct delete, own rows included.
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.leads WHERE id IN (%L, %L)', :'l_ht', :'l_ha')),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 2' END,
       :'state' || ' rls leads D5: Team Leader without the delete toggle ' || CASE WHEN :'m1' THEN 'deletes nothing (own lead included)' ELSE 'deletes own and downline leads (preimage)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.leads WHERE id IN (:'l_ht', :'l_ha')), CASE WHEN :'m1' THEN 2::bigint ELSE 0::bigint END,
       :'state' || ' rls leads D5: ' || CASE WHEN :'m1' THEN 'both rows survive' ELSE '(both rows gone)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.leads SET assigned_agent_id = %L WHERE id = %L', :'ht', :'l_ha')), 'OK 1',
       :'state' || ' rls leads D5: Team Leader reassigns a downline lead to self');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.leads WHERE id = %L', :'l_ha')),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' rls leads D5: reassign-to-self-then-delete ' || CASE WHEN :'m1' THEN 'deletes nothing' ELSE 'deletes the lead (preimage bypass)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.leads WHERE id = :'l_ha'), CASE WHEN :'m1' THEN 1::bigint ELSE 0::bigint END,
       :'state' || ' rls leads D5: ' || CASE WHEN :'m1' THEN 'the reassigned lead survives' ELSE '(the reassigned lead is gone)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
INSERT INTO public.role_permissions (organization_id, role, permissions)
VALUES (:'org_a', 'Team Leader', '{"contacts": {"contacts.leads.delete": true, "contacts.clients.delete": true, "contacts.recruits.delete": true}}');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.leads WHERE id = %L', :'l_ha')) || ' '
                         || hierarchy_test.as_user(:'ht', format('DELETE FROM public.clients WHERE id = %L', :'c_ha')) || ' '
                         || hierarchy_test.as_user(:'ht', format('DELETE FROM public.recruits WHERE id = %L', :'r_ha')), 'OK 1 OK 1 OK 1',
       :'state' || ' rls D5: with the delete toggles on, the Team Leader deletes a downline lead, client and recruit');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.leads WHERE id = %L', :'l_hp')), 'OK 0',
       :'state' || ' rls D5: the toggle never reaches a non-downline lead');
SELECT hierarchy_test.check(EXISTS (SELECT 1 FROM public.leads WHERE id = :'l_hp'), :'state' || ' rls D5: (the non-downline lead survives)');
ROLLBACK TO SAVEPOINT c;
-- D5 per type: each restrictive policy reads its OWN table's toggle (one toggle on at a time). The deletes are
-- followed by the surviving rows (a separate statement: subqueries share the outer statement's snapshot).
SAVEPOINT c;
INSERT INTO public.role_permissions (organization_id, role, permissions) VALUES (:'org_a', 'Team Leader', '{"contacts": {"contacts.leads.delete": true}}');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.leads WHERE id = %L', :'l_ha')) || ' '
                         || hierarchy_test.as_user(:'ht', format('DELETE FROM public.clients WHERE id = %L', :'c_ha')) || ' '
                         || hierarchy_test.as_user(:'ht', format('DELETE FROM public.recruits WHERE id = %L', :'r_ha')),
       CASE WHEN :'m1' THEN 'OK 1 OK 0 OK 0' ELSE 'OK 1 OK 1 OK 1' END,
       :'state' || ' rls D5 per type: leads toggle only ' || CASE WHEN :'m1' THEN 'deletes the lead, not the client or recruit' ELSE '(preimage: no toggle needed)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.leads WHERE id = :'l_ha') || ' ' || (SELECT count(*) FROM public.clients WHERE id = :'c_ha')
                         || ' ' || (SELECT count(*) FROM public.recruits WHERE id = :'r_ha'),
       CASE WHEN :'m1' THEN '0 1 1' ELSE '0 0 0' END,
       :'state' || ' rls D5 per type: leads toggle only — surviving lead / client / recruit');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
INSERT INTO public.role_permissions (organization_id, role, permissions) VALUES (:'org_a', 'Team Leader', '{"contacts": {"contacts.clients.delete": true}}');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.leads WHERE id = %L', :'l_ha')) || ' '
                         || hierarchy_test.as_user(:'ht', format('DELETE FROM public.clients WHERE id = %L', :'c_ha')) || ' '
                         || hierarchy_test.as_user(:'ht', format('DELETE FROM public.recruits WHERE id = %L', :'r_ha')),
       CASE WHEN :'m1' THEN 'OK 0 OK 1 OK 0' ELSE 'OK 1 OK 1 OK 1' END,
       :'state' || ' rls D5 per type: clients toggle only ' || CASE WHEN :'m1' THEN 'deletes the client, not the lead or recruit' ELSE '(preimage: no toggle needed)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.leads WHERE id = :'l_ha') || ' ' || (SELECT count(*) FROM public.clients WHERE id = :'c_ha')
                         || ' ' || (SELECT count(*) FROM public.recruits WHERE id = :'r_ha'),
       CASE WHEN :'m1' THEN '1 0 1' ELSE '0 0 0' END,
       :'state' || ' rls D5 per type: clients toggle only — surviving lead / client / recruit');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
INSERT INTO public.role_permissions (organization_id, role, permissions) VALUES (:'org_a', 'Team Leader', '{"contacts": {"contacts.recruits.delete": true}}');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.leads WHERE id = %L', :'l_ha')) || ' '
                         || hierarchy_test.as_user(:'ht', format('DELETE FROM public.clients WHERE id = %L', :'c_ha')) || ' '
                         || hierarchy_test.as_user(:'ht', format('DELETE FROM public.recruits WHERE id = %L', :'r_ha')),
       CASE WHEN :'m1' THEN 'OK 0 OK 0 OK 1' ELSE 'OK 1 OK 1 OK 1' END,
       :'state' || ' rls D5 per type: recruits toggle only ' || CASE WHEN :'m1' THEN 'deletes the recruit, not the lead or client' ELSE '(preimage: no toggle needed)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.leads WHERE id = :'l_ha') || ' ' || (SELECT count(*) FROM public.clients WHERE id = :'c_ha')
                         || ' ' || (SELECT count(*) FROM public.recruits WHERE id = :'r_ha'),
       CASE WHEN :'m1' THEN '1 1 0' ELSE '0 0 0' END,
       :'state' || ' rls D5 per type: recruits toggle only — surviving lead / client / recruit');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.clients WHERE id = %L', :'c_ha')) || ' '
                         || hierarchy_test.as_user(:'ht', format('DELETE FROM public.recruits WHERE id = %L', :'r_ha')),
       CASE WHEN :'m1' THEN 'OK 0 OK 0' ELSE 'OK 1 OK 1' END,
       :'state' || ' rls D5: Team Leader delete of a downline client and recruit without the toggles ' || CASE WHEN :'m1' THEN 'deletes nothing' ELSE '(preimage: deleted)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.clients WHERE id = :'c_ha') + (SELECT count(*) FROM public.recruits WHERE id = :'r_ha'),
       CASE WHEN :'m1' THEN 2::bigint ELSE 0::bigint END, :'state' || ' rls D5: ' || CASE WHEN :'m1' THEN 'the client and recruit survive' ELSE '(both gone)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ha', format('DELETE FROM public.leads WHERE id = %L', :'l_ha')) || ' '
                         || hierarchy_test.as_user(:'r', format('DELETE FROM public.leads WHERE id = %L', :'l_hp')) || ' '
                         || hierarchy_test.as_user(:'hs', format('DELETE FROM public.leads WHERE id = %L', :'l_hg')) || ' '
                         || hierarchy_test.as_user(:'hx', format('DELETE FROM public.leads WHERE id = %L', :'l_un')), 'OK 1 OK 1 OK 1 OK 1',
       :'state' || ' rls D5: Agent (own row), Admin, is_super_admin Team Leader and Super Admin deletes are unchanged');
ROLLBACK TO SAVEPOINT c;
-- AUTHZ-1 (contact tenancy): the owner branches of the contacts policies' WITH CHECK do not bind organization_id, so
-- before M1 a Team Leader reassigning a downline contact to itself can move it out of the organization (NULL) or into
-- another tenant — removing it without the D5 toggle — and an Agent can do the same to its own rows. From M1 on a
-- direct client write may not change organization_id at all; the row stays in the organization, visible to its Admin.
-- Each case: <write as the client> / <org Admin R sees the row> [/ <foreign Admin BA sees it>].
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.leads SET assigned_agent_id = %L, organization_id = NULL WHERE id = %L', :'ht', :'l_ha'))
                         || ' / ' || hierarchy_test.as_user(:'r', format('SELECT 1 FROM public.leads WHERE id = %L', :'l_ha')),
       CASE WHEN :'m1' THEN :'org_guard' || ' / OK 1' ELSE 'OK 1 / OK 0' END,
       :'state' || ' rls AUTHZ-1 leads: Team Leader reassign-to-self + organization_id NULL ' || CASE WHEN :'m1' THEN 'rejected; the lead stays visible to the Admin' ELSE 'escapes the organization (preimage)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.leads SET assigned_agent_id = %L, organization_id = %L WHERE id = %L', :'ht', :'org_b', :'l_ha'))
                         || ' / ' || hierarchy_test.as_user(:'r', format('SELECT 1 FROM public.leads WHERE id = %L', :'l_ha'))
                         || ' / ' || hierarchy_test.as_user(:'ba', format('SELECT 1 FROM public.leads WHERE id = %L', :'l_ha')),
       CASE WHEN :'m1' THEN :'org_guard' || ' / OK 1 / OK 0' ELSE 'OK 1 / OK 0 / OK 1' END,
       :'state' || ' rls AUTHZ-1 leads: Team Leader reassign-to-self + foreign organization ' || CASE WHEN :'m1' THEN 'rejected; the lead stays in org A' ELSE 'moves the lead into org B (preimage)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.clients SET assigned_agent_id = %L, organization_id = NULL WHERE id = %L', :'ht', :'c_ha'))
                         || ' / ' || hierarchy_test.as_user(:'r', format('SELECT 1 FROM public.clients WHERE id = %L', :'c_ha')),
       CASE WHEN :'m1' THEN :'org_guard' || ' / OK 1' ELSE 'OK 1 / OK 0' END,
       :'state' || ' rls AUTHZ-1 clients: Team Leader reassign-to-self + organization_id NULL ' || CASE WHEN :'m1' THEN 'rejected; the client stays visible to the Admin' ELSE 'escapes the organization (preimage)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.clients SET assigned_agent_id = %L, organization_id = %L WHERE id = %L', :'ht', :'org_b', :'c_ha'))
                         || ' / ' || hierarchy_test.as_user(:'r', format('SELECT 1 FROM public.clients WHERE id = %L', :'c_ha'))
                         || ' / ' || hierarchy_test.as_user(:'ba', format('SELECT 1 FROM public.clients WHERE id = %L', :'c_ha')),
       CASE WHEN :'m1' THEN :'org_guard' || ' / OK 1 / OK 0' ELSE 'OK 1 / OK 0 / OK 1' END,
       :'state' || ' rls AUTHZ-1 clients: Team Leader reassign-to-self + foreign organization ' || CASE WHEN :'m1' THEN 'rejected; the client stays in org A' ELSE 'moves the client into org B (preimage)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.recruits SET assigned_agent_id = %L, organization_id = NULL WHERE id = %L', :'ht', :'r_ha'))
                         || ' / ' || hierarchy_test.as_user(:'r', format('SELECT 1 FROM public.recruits WHERE id = %L', :'r_ha')),
       CASE WHEN :'m1' THEN :'org_guard' || ' / OK 1' ELSE 'OK 1 / OK 0' END,
       :'state' || ' rls AUTHZ-1 recruits: Team Leader reassign-to-self + organization_id NULL ' || CASE WHEN :'m1' THEN 'rejected; the recruit stays visible to the Admin' ELSE 'escapes the organization (preimage)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.recruits SET assigned_agent_id = %L, organization_id = %L WHERE id = %L', :'ht', :'org_b', :'r_ha'))
                         || ' / ' || hierarchy_test.as_user(:'r', format('SELECT 1 FROM public.recruits WHERE id = %L', :'r_ha'))
                         || ' / ' || hierarchy_test.as_user(:'ba', format('SELECT 1 FROM public.recruits WHERE id = %L', :'r_ha')),
       CASE WHEN :'m1' THEN :'org_guard' || ' / OK 1 / OK 0' ELSE 'OK 1 / OK 0 / OK 1' END,
       :'state' || ' rls AUTHZ-1 recruits: Team Leader reassign-to-self + foreign organization ' || CASE WHEN :'m1' THEN 'rejected; the recruit stays in org A' ELSE 'moves the recruit into org B (preimage)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ha', format('UPDATE public.leads SET organization_id = %L WHERE id = %L', :'org_b', :'l_ha'))
                         || ' / ' || hierarchy_test.as_user(:'r', format('SELECT 1 FROM public.leads WHERE id = %L', :'l_ha')),
       CASE WHEN :'m1' THEN :'org_guard' || ' / OK 1' ELSE 'OK 1 / OK 0' END,
       :'state' || ' rls AUTHZ-1 leads: Agent moving its OWN lead to another organization ' || CASE WHEN :'m1' THEN 'rejected' ELSE 'accepted (pre-existing own-row hole)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
-- Controls: an unchanged organization_id in the SET list passes (the guard rejects only a change); a system caller
-- (definer RPCs, service_role, migrations) may still move a contact.
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.leads SET organization_id = %L, notes = ''same org'' WHERE id = %L', :'org_a', :'l_ha'))
                         || ' / ' || hierarchy_test.as_system(format('UPDATE public.clients SET organization_id = %L WHERE id = %L', :'org_b', :'c_ha')),
       'OK 1 / OK 1', :'state' || ' rls AUTHZ-1 controls: a same-organization save and a system caller''s move are accepted');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
-- RESIDUAL (pinned, pre-existing, outside hierarchy scope, recorded in plan §12): INSERT is not guarded, so a member
-- can still create a contact owned by itself in a foreign organization (closing it needs a RESTRICTIVE FOR INSERT).
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ha', format(
         'INSERT INTO public.leads (organization_id, assigned_agent_id, user_id, first_name, last_name, status) VALUES (%L, %L, %L, ''Synthetic lead'', ''XO'', ''New'')',
         :'org_b', :'ha', :'ha')),
       'OK 1', :'state' || ' rls AUTHZ-1 RESIDUAL (pre-existing): an Agent INSERT of an own lead into a foreign organization is accepted');
ROLLBACK TO SAVEPOINT c;
-- View / edit / assign toggles are UI-only for Team Leader downline rows, exactly as for own rows (pinned, §12).
SAVEPOINT c;
INSERT INTO public.role_permissions (organization_id, role, permissions)
VALUES (:'org_a', 'Team Leader', '{"contacts": {"contacts.leads.view_assigned": false, "contacts.leads.edit": false, "contacts.leads.assign": false}}');
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'leads') || ' ' || hierarchy_test.as_user(:'ht', format('UPDATE public.leads SET notes = ''edit off'' WHERE id = %L', :'l_ha'))
                         || ' ' || hierarchy_test.as_user(:'ht', format('UPDATE public.leads SET assigned_agent_id = %L WHERE id = %L', :'hg', :'l_ha')),
       'HA,HD,HG,HT OK 1 OK 1', :'state' || ' rls toggles: view/edit/assign off still let the Team Leader read, edit and reassign downline leads (UI-only, current behaviour)');
ROLLBACK TO SAVEPOINT c;

-- Calls (D6): on a downline call a Team Leader may change only the coaching flag and notes.
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.calls SET flagged_for_coaching = true, notes = ''coached'' WHERE id = %L', :'k_ha')), 'OK 1',
       :'state' || ' rls calls D6: Team Leader sets the coaching flag and notes on a downline call');
SELECT hierarchy_test.check((SELECT flagged_for_coaching AND notes = 'coached' FROM public.calls WHERE id = :'k_ha'), :'state' || ' rls calls D6: (the coaching edit is stored)');
ROLLBACK TO SAVEPOINT c;
-- AUTHZ-4: on a downline call the modification time is the database's (now() = this transaction's start, i.e. the
-- statement time of a PostgREST request); the call's own agent keeps today's behaviour (any value it sends).
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.calls SET flagged_for_coaching = true, updated_at = ''2000-01-01'' WHERE id = %L', :'k_ha')),
       'OK 1', :'state' || ' rls calls AUTHZ-4: Team Leader coaching write supplying updated_at 2000-01-01 is accepted');
SELECT hierarchy_test.eq((SELECT CASE WHEN flagged_for_coaching AND updated_at >= now() THEN 'flagged, database time'
                                      WHEN flagged_for_coaching AND updated_at = '2000-01-01'::timestamptz THEN 'flagged, 2000-01-01' ELSE 'other' END
                            FROM public.calls WHERE id = :'k_ha'),
       CASE WHEN :'m1' THEN 'flagged, database time' ELSE 'flagged, 2000-01-01' END,
       :'state' || ' rls calls AUTHZ-4: ' || CASE WHEN :'m1' THEN 'the stored updated_at is the database time (>= the statement time), not the client''s' ELSE '(preimage: the call is backdated)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ha', format('UPDATE public.calls SET notes = ''own'', updated_at = ''2000-01-01'' WHERE id = %L', :'k_ha')),
       'OK 1', :'state' || ' rls calls AUTHZ-4: the call''s own agent sets updated_at');
SELECT hierarchy_test.eq((SELECT updated_at = '2000-01-01'::timestamptz FROM public.calls WHERE id = :'k_ha'), true,
       :'state' || ' rls calls AUTHZ-4: (the own agent''s value is stored, unchanged behaviour)');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.calls SET status = ''failed'' WHERE id = %L', :'k_ha')),
       CASE WHEN :'m1' THEN :'call_guard' ELSE 'OK 1' END,
       :'state' || ' rls calls D6: Team Leader change of a downline call''s status ' || CASE WHEN :'m1' THEN 'rejected' ELSE '(preimage: allowed)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.calls SET created_at = created_at - interval ''1 day'' WHERE id = %L', :'k_ha')),
       CASE WHEN :'m1' THEN :'call_guard' ELSE 'OK 1' END,
       :'state' || ' rls calls D6: Team Leader change of a downline call''s created_at ' || CASE WHEN :'m1' THEN 'rejected' ELSE '(preimage: allowed)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.calls SET is_missed = true, notes = ''x'' WHERE id = %L', :'k_ha')),
       CASE WHEN :'m1' THEN :'call_guard' ELSE 'OK 1' END,
       :'state' || ' rls calls D6: Team Leader change of is_missed (with notes) ' || CASE WHEN :'m1' THEN 'rejected as a whole' ELSE '(preimage: allowed)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.calls SET status = ''failed'' WHERE id = %L', :'k_hp')), 'OK 0',
       :'state' || ' rls calls: Team Leader update of a non-downline call reaches no row');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ha', format('UPDATE public.calls SET status = ''failed'', is_missed = true WHERE id = %L', :'k_ha')) || ' '
                         || hierarchy_test.as_user(:'r', format('UPDATE public.calls SET status = ''no-answer'' WHERE id = %L', :'k_ha')) || ' '
                         || hierarchy_test.as_user(:'hs', format('UPDATE public.calls SET created_at = created_at - interval ''1 day'' WHERE id = %L', :'k_ha')),
       'OK 1 OK 1 OK 1', :'state' || ' rls calls D6: the call''s agent, the Admin and an is_super_admin Team Leader edit any column (unchanged)');
SELECT hierarchy_test.eq((SELECT status FROM public.calls WHERE id = :'k_hp'), 'completed', :'state' || ' rls calls: (the non-downline call is unchanged)');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.calls WHERE id = %L', :'k_ha')),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' rls calls D6: Team Leader delete of a downline call ' || CASE WHEN :'m1' THEN 'deletes nothing' ELSE '(preimage: deleted)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.calls WHERE id = :'k_ha'), CASE WHEN :'m1' THEN 1::bigint ELSE 0::bigint END,
       :'state' || ' rls calls D6: ' || CASE WHEN :'m1' THEN 'the downline call survives' ELSE '(the downline call is gone)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ha', format('DELETE FROM public.calls WHERE id = %L', :'k_ha')) || ' '
                         || hierarchy_test.as_user(:'r', format('DELETE FROM public.calls WHERE id = %L', :'k_hp')), 'OK 1 OK 1',
       :'state' || ' rls calls D6: the call''s agent and the Admin delete calls (unchanged)');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(split_part(hierarchy_test.as_user(:'ht', format(
         'INSERT INTO public.calls (organization_id, agent_id, direction, status, contact_name) VALUES (%L, %L, ''outbound'', ''completed'', ''X'')', :'org_a', :'ha')), ':', 1),
       'REJECTED 42501', :'state' || ' rls calls: Team Leader INSERT of a call for a downline agent is refused (calls_guard_dialer_core, unchanged)');

-- Profiles UPDATE (D4): downline edits stay as designed; changing another member's commission_level is Admin-only.
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.profiles SET phone = ''+15550000002'' WHERE id = %L', :'ha')), 'OK 1',
       :'state' || ' rls profiles: Team Leader edits a downline member''s phone (as designed since 2026-03)');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.profiles SET commission_level = commission_level, first_name = first_name WHERE id = %L', :'ha')), 'OK 1',
       :'state' || ' rls profiles D4: Team Leader save of a downline member with an unchanged commission_level');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.profiles SET commission_level = ''95%%'' WHERE id = %L', :'ha')),
       CASE WHEN :'m1' THEN :'level_guard' ELSE 'OK 1' END,
       :'state' || ' rls profiles D4: Team Leader change of a downline commission_level ' || CASE WHEN :'m1' THEN 'rejected' ELSE '(preimage: allowed)' END);
SELECT hierarchy_test.eq((SELECT commission_level FROM public.profiles WHERE id = :'ha'), CASE WHEN :'m1' THEN '70%' ELSE '95%' END,
       :'state' || ' rls profiles D4: ' || CASE WHEN :'m1' THEN 'the level is unchanged' ELSE '(the level changed)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET commission_level = ''95%%'' WHERE id = %L', :'ha')) || ' '
                         || hierarchy_test.as_user(:'hs', format('UPDATE public.profiles SET commission_level = ''90%%'' WHERE id = %L', :'hg')) || ' '
                         || hierarchy_test.as_user(:'hx', format('UPDATE public.profiles SET commission_level = ''85%%'' WHERE id = %L', :'hp')) || ' '
                         || hierarchy_test.as_user(:'ha', format('UPDATE public.profiles SET commission_level = ''99%%'' WHERE id = %L', :'ha')),
       'OK 1 OK 1 OK 1 OK 1', :'state' || ' rls profiles D4: Admin, is_super_admin Team Leader and Super Admin change levels; self-edit unchanged (recorded follow-up)');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.profiles SET phone = ''+15550000005'' WHERE id = %L', :'hp')) || ' '
                         || hierarchy_test.as_user(:'bt', format('UPDATE public.profiles SET phone = ''+15550000005'' WHERE id = %L', :'ha')), 'OK 0 OK 0',
       :'state' || ' rls profiles: Team Leader edit of a non-downline member and a cross-org Team Leader edit reach no row');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'hp', :'ha')),
       'REJECTED 42501: Only an Admin of this organization may change account-control fields (status, team, upline, billing)',
       :'state' || ' rls profiles: Team Leader change of a downline member''s upline is refused (account-control field)');
SELECT hierarchy_test.check((SELECT phone = '' AND upline_id = :'ht'::uuid FROM public.profiles WHERE id = :'ha')
                            AND (SELECT phone = '' FROM public.profiles WHERE id = :'hp'),
       :'state' || ' rls profiles: (the refused rows are unchanged)');

-- ── 3. Contacts permissions TL cases (ported from contacts_permissions_integration.sql T1f-h, T3g-h) ───────────
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', 'SELECT 1 WHERE public.has_contacts_permission(''contacts.leads.view_unassigned'')') || ' '
                         || hierarchy_test.as_user(:'ht', 'SELECT 1 WHERE public.has_contacts_permission(''contacts.leads.import'')') || ' '
                         || hierarchy_test.as_user(:'ht', 'SELECT 1 WHERE public.has_contacts_permission(''contacts.leads.delete'')'),
       'OK 1 OK 1 OK 0', :'state' || ' rls port contacts_permissions T1f-h: Team Leader defaults view_unassigned on, import on, delete off');
SAVEPOINT c;
UPDATE public.leads SET imported_by_user_id = :'hp' WHERE id = :'l_un';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('SELECT 1 FROM public.leads WHERE id = %L', :'l_un')), 'OK 0',
       :'state' || ' rls port contacts_permissions T3g: Team Leader does not see an unassigned lead imported by another member');
UPDATE public.leads SET imported_by_user_id = :'ht' WHERE id = :'l_un';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('SELECT 1 FROM public.leads WHERE id = %L', :'l_un')), 'OK 1',
       :'state' || ' rls port contacts_permissions T3h: Team Leader sees an unassigned lead it imported');
ROLLBACK TO SAVEPOINT c;

-- ── 4. Stale and forged tokens (R1): the database, not the JWT, decides hierarchy authority ──────────────────────
-- Promotion: DB Team Leader, token still Agent. JWT-gated branches fail closed until the token refreshes; the
-- database-authoritative checks (profile edits, the TL delete rule) apply at once.
SAVEPOINT c;
UPDATE public.profiles SET role = 'Team Leader' WHERE id = :'ha';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ha', format('SELECT 1 FROM public.leads WHERE id = %L', :'l_hg'), 'Agent', :'org_a'), 'OK 0',
       :'state' || ' rls R1 promotion: promoted Team Leader with an old Agent token reads no downline lead (fail closed)');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ha', format('SELECT 1 FROM public.leads WHERE id = %L', :'l_hg')), 'OK 1',
       :'state' || ' rls R1 promotion: after the token refreshes the downline lead is readable');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ha', format('UPDATE public.profiles SET phone = ''+15550000003'' WHERE id = %L', :'hg'), 'Agent', :'org_a'), 'OK 1',
       :'state' || ' rls R1 promotion: profile edits follow the database role at once (can_update_profile)');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ha', format('DELETE FROM public.leads WHERE id = %L', :'l_ha'), 'Agent', :'org_a'),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' rls R1 promotion: the new Team Leader''s own-lead delete ' || CASE WHEN :'m1' THEN 'needs the toggle at once (D5)' ELSE '(preimage: allowed)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.leads WHERE id = :'l_ha'), CASE WHEN :'m1' THEN 1::bigint ELSE 0::bigint END,
       :'state' || ' rls R1 promotion: ' || CASE WHEN :'m1' THEN 'the own lead survives' ELSE '(the own lead is gone)' END);
ROLLBACK TO SAVEPOINT c;
-- Demotion: DB Agent, token still Team Leader.
SAVEPOINT c;
UPDATE public.profiles SET role = 'Agent' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'leads', 'Team Leader', :'org_a') || ' ' || pg_temp.seen(:'ht', 'clients', 'Team Leader', :'org_a') || ' '
                         || pg_temp.seen(:'ht', 'recruits', 'Team Leader', :'org_a') || ' ' || pg_temp.seen(:'ht', 'calls', 'Team Leader', :'org_a') || ' '
                         || pg_temp.seen(:'ht', 'contact_emails', 'Team Leader', :'org_a') || ' ' || pg_temp.seen(:'ht', 'contact_history_events', 'Team Leader', :'org_a'),
       CASE WHEN :'m1' THEN 'HT HT HT HT HT -' ELSE 'HA,HD,HG,HT HA,HT HA,HT HA,HT HA,HT H_HA' END,
       :'state' || ' rls R1 demotion: stale TL token ' || CASE WHEN :'m1' THEN 'reads only own rows in leads, clients, recruits, calls, mail and history' ELSE 'still reads the downline (preimage gap)' END);
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'tasks', 'Team Leader', :'org_a'), 'HT',
       :'state' || ' rls R1 demotion: tasks already follow the database role (own task only)');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.leads SET notes = ''stale'' WHERE id = %L', :'l_ha'), 'Team Leader', :'org_a') || ' '
                         || hierarchy_test.as_user(:'ht', format('UPDATE public.calls SET flagged_for_coaching = true WHERE id = %L', :'k_ha'), 'Team Leader', :'org_a') || ' '
                         || hierarchy_test.as_user(:'ht', format('UPDATE public.calls SET notes = ''stale'' WHERE id = %L', :'k_ha'), 'Team Leader', :'org_a'),
       CASE WHEN :'m1' THEN 'OK 0 OK 0 OK 0' ELSE 'OK 1 OK 1 OK 1' END,
       :'state' || ' rls R1 demotion: stale TL token ' || CASE WHEN :'m1' THEN 'cannot edit a downline lead or call, coaching flag and notes included' ELSE 'still edits them (preimage gap)' END);
SELECT hierarchy_test.check(CASE WHEN :'m1' THEN (SELECT notes IS NULL FROM public.leads WHERE id = :'l_ha')
                                              AND (SELECT NOT flagged_for_coaching AND notes = 'n' FROM public.calls WHERE id = :'k_ha') ELSE true END,
       :'state' || ' rls R1 demotion: (the downline lead and call are unchanged)');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.profiles SET phone = ''+15550000002'' WHERE id = %L', :'ha'), 'Team Leader', :'org_a'), 'OK 0',
       :'state' || ' rls R1 demotion: profile edits already follow the database role');
SELECT hierarchy_test.check((SELECT phone = '' FROM public.profiles WHERE id = :'ha'), :'state' || ' rls R1 demotion: (the downline profile is unchanged)');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('SELECT 1 FROM public.leads WHERE id = %L', :'l_ht'), 'Team Leader', :'org_a'), 'OK 1',
       :'state' || ' rls R1 demotion: own rows stay readable');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET role = 'Agent' WHERE id = :'ht';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.leads WHERE id = %L', :'l_ha'), 'Team Leader', :'org_a') || ' '
                         || hierarchy_test.as_user(:'ht', format('DELETE FROM public.calls WHERE id = %L', :'k_ha'), 'Team Leader', :'org_a'),
       CASE WHEN :'m1' THEN 'OK 0 OK 0' ELSE 'OK 1 OK 1' END,
       :'state' || ' rls R1 demotion: stale TL token delete of a downline lead and call ' || CASE WHEN :'m1' THEN 'deletes nothing' ELSE '(preimage: deleted)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.leads WHERE id = :'l_ha') + (SELECT count(*) FROM public.calls WHERE id = :'k_ha'),
       CASE WHEN :'m1' THEN 2::bigint ELSE 0::bigint END, :'state' || ' rls R1 demotion: ' || CASE WHEN :'m1' THEN 'the lead and call survive' ELSE '(both gone)' END);
ROLLBACK TO SAVEPOINT c;
-- Deactivation: DB Inactive or Deleted, token still Team Leader (live session).
SAVEPOINT c;
UPDATE public.profiles SET status = 'Inactive' WHERE id = :'ht';
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'leads') || ' ' || pg_temp.seen(:'ht', 'calls') || ' ' || pg_temp.seen(:'ht', 'tasks') || ' '
                         || pg_temp.seen(:'ht', 'contact_emails') || ' ' || pg_temp.seen(:'ht', 'contact_history_events'),
       CASE WHEN :'m1' THEN 'HT HT HT HT -' ELSE 'HA,HD,HG,HT HA,HT HA,HT HA,HT H_HA,H_HAtask' END,
       :'state' || ' rls R1 deactivation (Inactive): live TL token ' || CASE WHEN :'m1' THEN 'reads only own rows (tasks included)' ELSE 'still reads the downline (preimage gap)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.profiles SET phone = ''+15550000002'' WHERE id = %L', :'ha')) || ' '
                         || hierarchy_test.as_user(:'ht', format('UPDATE public.calls SET flagged_for_coaching = true WHERE id = %L', :'k_ha')) || ' '
                         || hierarchy_test.as_user(:'ht', format('UPDATE public.leads SET notes = ''inactive'' WHERE id = %L', :'l_ha')),
       CASE WHEN :'m1' THEN 'OK 0 OK 0 OK 0' ELSE 'OK 1 OK 1 OK 1' END,
       :'state' || ' rls R1 deactivation (Inactive): ' || CASE WHEN :'m1' THEN 'no downline profile, call or lead edit' ELSE 'downline profile, call and lead edits still pass (preimage gap)' END);
SELECT hierarchy_test.check(CASE WHEN :'m1' THEN (SELECT phone = '' FROM public.profiles WHERE id = :'ha')
                                              AND (SELECT NOT flagged_for_coaching FROM public.calls WHERE id = :'k_ha')
                                              AND (SELECT notes IS NULL FROM public.leads WHERE id = :'l_ha') ELSE true END,
       :'state' || ' rls R1 deactivation (Inactive): (the downline profile, call and lead are unchanged)');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
INSERT INTO public.role_permissions (organization_id, role, permissions)
VALUES (:'org_a', 'Team Leader', '{"contacts": {"contacts.leads.delete": true}}');
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'leads') || ' ' || pg_temp.seen(:'ht', 'clients') || ' ' || pg_temp.seen(:'ht', 'recruits') || ' '
                         || pg_temp.seen(:'ht', 'calls') || ' ' || pg_temp.seen(:'ht', 'tasks'),
       CASE WHEN :'m1' THEN 'HT HT HT HT HT' ELSE 'HA,HD,HG,HT HA,HT HA,HT HA,HT HA,HT' END,
       :'state' || ' rls R1 deactivation (Deleted): live TL token ' || CASE WHEN :'m1' THEN 'reads only own rows' ELSE 'still reads the downline (preimage gap)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.calls SET flagged_for_coaching = true WHERE id = %L', :'k_ha')),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' rls R1 deactivation (Deleted): live TL token ' || CASE WHEN :'m1' THEN 'cannot set a downline call''s coaching flag' ELSE 'still sets it (preimage gap)' END);
SELECT hierarchy_test.eq((SELECT flagged_for_coaching FROM public.calls WHERE id = :'k_ha'), NOT :'m1'::boolean,
       :'state' || ' rls R1 deactivation (Deleted): ' || CASE WHEN :'m1' THEN 'the coaching flag is unchanged' ELSE '(the coaching flag was set)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.leads WHERE id = %L', :'l_ha')),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' rls R1 deactivation (Deleted): live TL token with the delete toggle on ' || CASE WHEN :'m1' THEN 'deletes no downline lead' ELSE '(preimage: deleted)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.leads WHERE id = :'l_ha'), CASE WHEN :'m1' THEN 1::bigint ELSE 0::bigint END,
       :'state' || ' rls R1 deactivation (Deleted): ' || CASE WHEN :'m1' THEN 'the downline lead survives' ELSE '(gone)' END);
ROLLBACK TO SAVEPOINT c;
-- D5 regardless of status: an Inactive or Deleted Team Leader profile with a live token still needs the delete toggle
-- for its OWN lead (actor_is_team_leader reads the role, whatever the status).
SAVEPOINT c;
UPDATE public.profiles SET status = 'Inactive' WHERE id = :'ht';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.leads WHERE id = %L', :'l_ht')),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' rls D5 deactivation (Inactive): own-lead delete without the toggle ' || CASE WHEN :'m1' THEN 'deletes nothing' ELSE '(preimage: deleted)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.leads WHERE id = :'l_ht'), CASE WHEN :'m1' THEN 1::bigint ELSE 0::bigint END,
       :'state' || ' rls D5 deactivation (Inactive): ' || CASE WHEN :'m1' THEN 'the own lead survives' ELSE '(gone)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'ht';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('DELETE FROM public.leads WHERE id = %L', :'l_ht')),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' rls D5 deactivation (Deleted): own-lead delete without the toggle ' || CASE WHEN :'m1' THEN 'deletes nothing' ELSE '(preimage: deleted)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.leads WHERE id = :'l_ht'), CASE WHEN :'m1' THEN 1::bigint ELSE 0::bigint END,
       :'state' || ' rls D5 deactivation (Deleted): ' || CASE WHEN :'m1' THEN 'the own lead survives' ELSE '(gone)' END);
ROLLBACK TO SAVEPOINT c;
-- Demoted or deactivated Admin with a stale Admin token: no edit (beyond coaching) and no delete of others' calls.
SAVEPOINT c;
UPDATE public.profiles SET role = 'Agent' WHERE id = :'r';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.calls SET status = ''failed'' WHERE id = %L', :'k_ha'), 'Admin', :'org_a'),
       CASE WHEN :'m1' THEN :'call_guard' ELSE 'OK 1' END,
       :'state' || ' rls R1 demoted Admin: stale Admin token ' || CASE WHEN :'m1' THEN 'cannot change another agent''s call' ELSE 'still changes it (preimage gap)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('DELETE FROM public.calls WHERE id = %L', :'k_ha'), 'Admin', :'org_a'),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' rls R1 demoted Admin: stale Admin token ' || CASE WHEN :'m1' THEN 'deletes no call of another agent' ELSE 'still deletes it (preimage gap)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.calls WHERE id = :'k_ha'), CASE WHEN :'m1' THEN 1::bigint ELSE 0::bigint END,
       :'state' || ' rls R1 demoted Admin: ' || CASE WHEN :'m1' THEN 'the call survives' ELSE '(gone)' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET role = 'Agent' WHERE id = :'r';
-- RESIDUAL (pinned, outside R1's hierarchy scope, bounded by the JWT lifetime): the Admin branches of the contacts
-- policies trust the JWT role, so a demoted Admin's stale token keeps org-wide lead access; on calls it keeps only
-- the coaching flag and notes (the D6 guard's allowed columns).
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.calls SET flagged_for_coaching = true WHERE id = %L', :'k_ha'), 'Admin', :'org_a') || ' '
                         || pg_temp.seen(:'r', 'leads', 'Admin', :'org_a') || ' '
                         || hierarchy_test.as_user(:'r', format('DELETE FROM public.leads WHERE id = %L', :'l_hp'), 'Admin', :'org_a'),
       'OK 1 A1,HA,HD,HG,HP,HT,UN OK 1',
       :'state' || ' rls R1 demoted Admin RESIDUAL (JWT Admin branch, pre-existing): coaching edit, org-wide lead read and lead delete still pass with the stale token');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
UPDATE public.profiles SET status = 'Inactive' WHERE id = :'r';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.calls SET status = ''failed'' WHERE id = %L', :'k_ha')) || ' '
                         || hierarchy_test.as_user(:'r', format('DELETE FROM public.calls WHERE id = %L', :'k_ha')),
       CASE WHEN :'m1' THEN :'call_guard' || ' OK 0' ELSE 'OK 1 OK 1' END,
       :'state' || ' rls R1 deactivated Admin: live Admin token ' || CASE WHEN :'m1' THEN 'cannot change or delete another agent''s call' ELSE 'still does both (preimage gap)' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.calls WHERE id = :'k_ha' AND status = 'completed'), CASE WHEN :'m1' THEN 1::bigint ELSE 0::bigint END,
       :'state' || ' rls R1 deactivated Admin: ' || CASE WHEN :'m1' THEN 'the call survives unchanged' ELSE '(the call is gone)' END);
ROLLBACK TO SAVEPOINT c;
-- Forged / mismatched claims.
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ha', format('SELECT 1 FROM public.leads WHERE id = %L', :'l_hg'), 'Team Leader', :'org_a'),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' rls R1 forged: an Agent with a report and a forged TL role claim ' || CASE WHEN :'m1' THEN 'reads nothing below it' ELSE 'reads the report''s lead (preimage gap)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'hp', format('SELECT 1 FROM public.leads WHERE id = %L', :'l_ha'), 'Team Leader', :'org_a'), 'OK 0',
       :'state' || ' rls R1 forged: a peer Agent with a forged TL claim reads no lead outside its own subtree');
SELECT hierarchy_test.eq(pg_temp.seen(:'ht', 'leads', 'Team Leader', :'org_b'), 'HT',
       :'state' || ' rls R1 org-claim mismatch: TL token for another organization reaches no downline row (own rows only)');
SELECT hierarchy_test.eq(pg_temp.seen(:'bt', 'leads', 'Team Leader', :'org_a'), '-',
       :'state' || ' rls R1 org-claim mismatch: cross-org Team Leader with an org-A claim reaches nothing in org A or org B');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'ht', format('UPDATE public.profiles SET phone = ''+15550000002'' WHERE id = %L', :'ha'), 'Team Leader', :'org_b'), 'OK 1',
       :'state' || ' rls R1 org-claim mismatch: profile edits follow the database organization, not the claim');
-- RESIDUAL (pinned, pre-existing): an is_super_admin claim the database no longer backs still opens org-wide reads.
SELECT hierarchy_test.eq(pg_temp.seen(:'hp', 'leads', 'Agent', :'org_a', true), 'A1,HA,HD,HG,HP,HT,UN',
       :'state' || ' rls R1 forged is_super_admin claim RESIDUAL (super_admin_own_org trusts the JWT): org-wide lead read');

-- ── 5. Activation of the production-shaped stale data (T over A1): dormant until M3 repairs the paths ───────────
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('SELECT 1 FROM public.leads WHERE id = %L', :'l_a1')) || ' '
                         || hierarchy_test.as_user(:'t', format('SELECT 1 FROM public.calls WHERE id = %L', :'k_a1')),
       CASE WHEN :'repaired' THEN 'OK 1 OK 1' ELSE 'OK 0 OK 0' END,
       :'state' || ' rls activation: shape Team Leader T ' || CASE WHEN :'repaired' THEN 'reads its repaired downline''s lead and call' ELSE 'has no reach over its stale downline' END);
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('UPDATE public.calls SET status = ''failed'' WHERE id = %L', :'k_a1')) || ' '
                         || hierarchy_test.as_user(:'t', format('DELETE FROM public.leads WHERE id = %L', :'l_a1')),
       CASE WHEN :'repaired' AND :'m1' THEN :'call_guard' || ' OK 0' WHEN :'repaired' THEN 'OK 1 OK 1' ELSE 'OK 0 OK 0' END,
       :'state' || ' rls activation: T''s status edit and delete over A1 '
       || CASE WHEN :'repaired' AND :'m1' THEN 'are refused by M1''s boundaries' WHEN :'repaired' THEN 'pass (S3R: M1 rolled back re-widens TL powers, plan §10)' ELSE 'reach nothing' END);
SELECT hierarchy_test.eq((SELECT count(*) FROM public.leads WHERE id = :'l_a1') || '/' || (SELECT status FROM public.calls WHERE id = :'k_a1'),
       CASE WHEN :'repaired' AND NOT :'m1' THEN '0/failed' ELSE '1/completed' END,
       :'state' || ' rls activation: ' || CASE WHEN :'repaired' AND NOT :'m1' THEN '(A1''s lead deleted and call changed)' ELSE 'A1''s lead and call survive unchanged' END);
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('UPDATE public.profiles SET commission_level = ''95%%'' WHERE id = %L', :'a2')),
       CASE WHEN :'repaired' AND :'m1' THEN :'level_guard' WHEN :'repaired' THEN 'OK 1' ELSE 'OK 0' END,
       :'state' || ' rls activation: T''s change of A2''s commission_level ' || CASE WHEN :'repaired' AND :'m1' THEN 'rejected' WHEN :'repaired' THEN 'passes without M1' ELSE 'reaches no row' END);
SELECT hierarchy_test.eq((SELECT commission_level = '95%' FROM public.profiles WHERE id = :'a2'), :'repaired'::boolean AND NOT :'m1'::boolean,
       :'state' || ' rls activation: ' || CASE WHEN :'repaired' AND NOT :'m1' THEN '(A2''s level changed)' ELSE 'A2''s level is unchanged' END);
ROLLBACK TO SAVEPOINT c;

-- ── 6. Ported from p0_profile_authorization.sql: T5c, T13 and the T19 token-vs-database matrix ──────────────────
-- T5c: hierarchy_path is database-derived for Admins too; an Admin re-points a leaf member.
SAVEPOINT c;
SELECT hierarchy_test.eq(split_part(hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET hierarchy_path = %L::public.ltree WHERE id = %L',
                                                                       hierarchy_test.label('R'), :'hp')), ':', 1),
       'REJECTED 42501', :'state' || ' rls port p0 T5c: a direct hierarchy_path write by an Admin is refused (column grant)');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'ht', :'hp')), 'OK 1',
       :'state' || ' rls port p0 T5c: an Admin re-points a leaf member''s upline');
SELECT hierarchy_test.eq((SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = :'hp'), CASE WHEN :'m2' THEN 'R.HT.HP' ELSE 'R.HP' END,
       :'state' || ' rls port p0 T5c: the stored path is database-derived ' || CASE WHEN :'m2' THEN 'and canonical (INFO-1 fixed by M2)' ELSE '(INFO-1 pre-existing: one change stale)' END);
ROLLBACK TO SAVEPOINT c;
-- T13: an Admin upline change on a member WITH downline is permitted (the cascade passes the field guard).
SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'hp', :'ha')), 'OK 1',
       :'state' || ' rls port p0 T13 (HARD GATE): an Admin moves a member who has downline; the cascade is permitted');
SELECT hierarchy_test.eq((SELECT string_agg(hierarchy_test.key(id) || '=' || hierarchy_test.sp(hierarchy_path), ' ' ORDER BY hierarchy_test.key(id) COLLATE "C")
                            FROM public.profiles WHERE id IN (:'ha', :'hg')),
       CASE WHEN :'m2' THEN 'HA=R.HP.HA HG=R.HP.HA.HG' ELSE 'HA=R.HT.HA HG=R.HP.HA.HG' END,
       :'state' || ' rls port p0 T13: ' || CASE WHEN :'m2' THEN 'the whole moved subtree is canonical' ELSE 'the moved row keeps its old path (INFO-2 pre-existing)' END);
ROLLBACK TO SAVEPOINT c;
-- T19: in every case the token and the database disagree, and the database wins (phone: no Layer-3 guard).
SAVEPOINT c;
UPDATE public.profiles SET role = 'Agent' WHERE id = :'hx';   -- a DB-demoted former Super Admin (T19g shape)
UPDATE public.profiles SET is_super_admin = false WHERE id = :'hx';
SELECT hierarchy_test.eq(
  hierarchy_test.as_user(:'hp', format('UPDATE public.profiles SET phone = ''+1555'' WHERE id = %L', :'ha'), 'Admin', :'org_a') || ' '
  || hierarchy_test.as_user(:'hp', format('UPDATE public.profiles SET phone = ''+1555'' WHERE id = %L', :'ha'), 'Super Admin', :'org_a', true) || ' '
  || hierarchy_test.as_user(:'hp', format('UPDATE public.profiles SET phone = ''+1555'' WHERE id = %L', :'bb'), 'Agent', :'org_b') || ' '
  || hierarchy_test.as_user(:'ht', format('UPDATE public.profiles SET phone = ''+1555'' WHERE id = %L', :'hp'), 'Admin', :'org_a') || ' '
  || hierarchy_test.as_user(:'hm', format('UPDATE public.profiles SET phone = ''+1555'' WHERE id = %L', :'ha'), 'Admin', :'org_a') || ' '
  || hierarchy_test.as_user(:'hx', format('UPDATE public.profiles SET phone = ''+1555'' WHERE id = %L', :'ha'), 'Super Admin', :'org_a', true) || ' '
  || hierarchy_test.as_user(:'gh', format('UPDATE public.profiles SET phone = ''+1555'' WHERE id = %L', :'ha'), 'Admin', :'org_a', true),
  'OK 0 OK 0 OK 0 OK 0 OK 0 OK 0 OK 0',
  :'state' || ' rls port p0 T19a/b/c/d/f/g/h: forged Admin, Super Admin, cross-org, TL-as-Admin, moved-org, demoted and profile-less tokens update nothing');
SELECT hierarchy_test.check((SELECT count(*) FROM public.profiles WHERE phone = '+1555') = 0, :'state' || ' rls port p0 T19: (no victim row changed)');
ROLLBACK TO SAVEPOINT c;
SAVEPOINT c;
SELECT hierarchy_test.eq(
  hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET phone = ''+1666'' WHERE id = %L', :'hp'), 'Agent', :'org_a') || ' '
  || hierarchy_test.as_user(:'ht', format('UPDATE public.profiles SET phone = ''+1666'' WHERE id = %L', :'hg')) || ' '
  || hierarchy_test.as_user(:'ha', format('UPDATE public.profiles SET phone = ''+1666'' WHERE id = %L', :'ha')) || ' '
  || hierarchy_test.as_user(:'hs', format('UPDATE public.profiles SET phone = ''+1666'' WHERE id = %L', :'hp')),
  'OK 1 OK 1 OK 1 OK 1',
  :'state' || ' rls port p0 T19e/i: DB Admin with a stale Agent token, TL on a descendant, self, and is_super_admin each update one row');
SELECT hierarchy_test.eq(
  hierarchy_test.as_user(:'ht', format('UPDATE public.profiles SET phone = ''+1777'' WHERE id = %L', :'hp')) || ' '
  || hierarchy_test.as_user(:'ha', format('UPDATE public.profiles SET phone = ''+1777'' WHERE id = %L', :'hp')) || ' '
  || hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET phone = ''+1777'' WHERE id = %L', :'bb')),
  'OK 0 OK 0 OK 0', :'state' || ' rls port p0 T19j: TL on a non-descendant, Agent on another member and Admin across organizations update nothing');
SELECT hierarchy_test.check((SELECT count(*) FROM public.profiles WHERE phone = '+1777') = 0, :'state' || ' rls port p0 T19j: (no refused row changed)');
ROLLBACK TO SAVEPOINT c;
SELECT hierarchy_test.eq(hierarchy_test.acl('profile_authz.can_update_profile(uuid)') || ' '
                         || (SELECT string_agg(polname, ',') FROM pg_policy WHERE polrelid = 'public.profiles'::regclass AND polcmd = 'w'),
       'authenticated,postgres profiles_update_authorized', :'state' || ' rls port p0 T19k/l: one profiles UPDATE policy; helper EXECUTE for authenticated only');
-- D2: a stored path into ANOTHER organization is not ancestry. Such a path cannot be written through the M2 triggers
-- (nor, in S1, without an Admin's two-save cross-org sequence), so it is planted with triggers off.
SELECT hierarchy_test.id('K5') AS k5 \gset
SAVEPOINT c;
SET LOCAL session_replication_role = replica;
UPDATE public.profiles SET upline_id = :'ba', hierarchy_path = hierarchy_test.path_of('BA', 'K5') WHERE id = :'k5';
SET LOCAL session_replication_role = origin;
SELECT hierarchy_test.eq(public.is_ancestor_of(:'ba', :'k5')::text || ' '
                         || hierarchy_test.as_user(:'ba', format('SELECT 1 WHERE public.is_ancestor_of(%L, %L)', :'ba', :'k5')),
       CASE WHEN :'m1' THEN 'false OK 0' ELSE 'true OK 1' END,
       :'state' || ' rls D2: a stored path into another organization is ' || CASE WHEN :'m1' THEN 'not ancestry (system caller and the signed-in foreign Admin)' ELSE 'ancestry (preimage)' END);
ROLLBACK TO SAVEPOINT c;
ROLLBACK;
