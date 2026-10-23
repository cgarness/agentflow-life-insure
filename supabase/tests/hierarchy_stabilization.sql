-- =====================================================================================================
-- Hierarchy stabilization — core database suite (plan §8: Reproduce, No-op, Derivation, Integrity, Consistency,
-- an authorization smoke test of M1 / R1, grants). DISPOSABLE LOCAL PostgreSQL ONLY; synthetic data only.
-- =====================================================================================================
-- Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md §8.
-- Run by scripts/run_hierarchy_stabilization_tests.sh once per database state, as the postgres superuser:
--   psql -X -qAt -v ON_ERROR_STOP=1 -v state=<S0|S1|S2|S3|S1R|S2R|S3R> -f supabase/tests/hierarchy_stabilization.sql
-- States (scripts/hierarchy_test_state.sh): S0 = verbatim production preimage + production-shaped stale data;
-- S1 = S0+M1; S2 = S1+M2; S3 = S2+M3 (synthetic fingerprint); S1R = S1 then M1 rolled back; S2R = S2 then M2 rolled
-- back; S3R = S3 then M2 and M1 rolled back.
-- Every case prints exactly one 'PASS <name>' line or stops with 'FAIL: <name> (actual …, expected …)'. Writes run
-- through hierarchy_test.probe (always rolled back) or inside BEGIN … ROLLBACK, so the database is left exactly as
-- it was given. Migration guards and rollbacks, M3's side effects and two-session concurrency are proved by the
-- runner. The full authorization matrix lives in hierarchy_stabilization_rls.sql / _rpcs.sql.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

SELECT :'state' IN ('S0', 'S1', 'S2', 'S3', 'S1R', 'S2R', 'S3R') AS state_known \gset
\if :state_known
\else
SELECT hierarchy_test.check(false, 'the state variable is one of S0 S1 S2 S3 S1R S2R S3R');
\endif
-- m1: M1's post-image is live; m2: M2's; repaired: the stale rows were repaired by M3; anon_revoked: is_ancestor_of
-- no longer executable by anon (M1 or its rollback); compute_revoked: M2's revokes (M2 or its rollback).
SELECT :'state' IN ('S1', 'S2', 'S3', 'S2R') AS m1,
       :'state' IN ('S2', 'S3') AS m2,
       :'state' IN ('S3', 'S3R') AS repaired,
       :'state' <> 'S0' AS anon_revoked,
       :'state' IN ('S2', 'S3', 'S2R', 'S3R') AS compute_revoked \gset
SELECT hierarchy_test.id('R') AS r, hierarchy_test.id('T') AS t, hierarchy_test.id('A1') AS a1,
       hierarchy_test.id('A2') AS a2, hierarchy_test.id('D1') AS d1, hierarchy_test.id('T2') AS t2,
       hierarchy_test.id('D2') AS d2, hierarchy_test.id('K1') AS k1, hierarchy_test.id('K2') AS k2,
       hierarchy_test.id('K3') AS k3, hierarchy_test.id('K4') AS k4, hierarchy_test.id('K5') AS k5,
       hierarchy_test.id('BA') AS ba, hierarchy_test.org('A') AS org_a, hierarchy_test.org('B') AS org_b,
       hierarchy_test.org('E') AS org_e, hierarchy_test.org('F') AS org_f,
       (SELECT coalesce(string_agg(key, ',' ORDER BY key COLLATE "C"), '') FROM hierarchy_test.stale()) AS stale0 \gset

-- ── 0. The database is the declared state ───────────────────────────────────────────────────────────────────────
SELECT hierarchy_test.check((SELECT marker FROM hierarchy_test.synthetic_sentinel) = 'agentflow-hierarchy-synthetic-fixture'
                            AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE first_name NOT LIKE 'Synthetic %'),
                            :'state' || ' database holds the synthetic fixture only');
SELECT hierarchy_test.eq(hierarchy_test.fn_md5('public.is_ancestor_of(uuid,uuid)'),
                         CASE WHEN :'m1' THEN 'c6d121db50b7ea2e37ce4a620cc855af' ELSE '7c5213032696734f2e0c5ffe5a71a07a' END,
                         :'state' || ' is_ancestor_of body is the ' || CASE WHEN :'m1' THEN 'M1 post-image' ELSE 'production preimage' END);
SELECT hierarchy_test.eq(hierarchy_test.fn_md5('public.compute_hierarchy_path(uuid)'),
                         CASE WHEN :'m2' THEN '058bb6b37b152aec062c87f8ac929425' ELSE 'b9aaa16d5b974676ce18d55c5dce9e18' END,
                         :'state' || ' compute_hierarchy_path body is the ' || CASE WHEN :'m2' THEN 'M2 post-image' ELSE 'production preimage' END);

-- ── 1. Reproduce: production's stale paths and missing ancestor pairs (repaired only in S3 / S3R) ────────────────
SELECT hierarchy_test.eq(
  (SELECT row(profiles, edges, expected_pairs, path_pairs, missing_pairs, extra_pairs, stale_paths, null_paths,
              self_parents, cross_org_edges, unreachable)::text FROM hierarchy_test.consistency()),
  CASE WHEN :'repaired' THEN '(16,11,15,15,0,0,0,0,0,0,0)' ELSE '(16,11,15,9,6,0,4,0,0,0,0)' END,
  :'state' || ' consistency (profiles, edges, expected, path pairs, missing, extra, stale, null, self, cross-org, unreachable)');
SELECT hierarchy_test.eq(
  (SELECT coalesce(string_agg(key || '=' || stored, ' ' ORDER BY key COLLATE "C"), '') FROM hierarchy_test.stale()),
  CASE WHEN :'repaired' THEN '' ELSE 'A1=R.A1 A2=R.A2 D1=D1 D2=D2' END,
  :'state' || CASE WHEN :'repaired' THEN ' no stale row remains after the repair' ELSE ' stale rows and their stored paths are exactly production''s' END);
SELECT hierarchy_test.eq(
  (SELECT coalesce(string_agg(ancestor || '>' || descendant, ' ' ORDER BY ancestor || '>' || descendant COLLATE "C"), '') FROM hierarchy_test.missing_pairs()),
  CASE WHEN :'repaired' THEN '' ELSE 'R>D1 R>D2 T2>D2 T>A1 T>A2 T>D1' END,
  :'state' || CASE WHEN :'repaired' THEN ' no ancestor pair is missing after the repair' ELSE ' missing ancestor pairs are exactly production''s 6' END);
SELECT hierarchy_test.eq(
  (SELECT count(*) FROM public.profiles c JOIN public.profiles u ON u.id = c.upline_id
    WHERE NOT (c.hierarchy_path <@ u.hierarchy_path)),
  CASE WHEN :'repaired' THEN 0::bigint ELSE 4::bigint END,
  :'state' || ' direct upline edges the stored paths do not recognise');
SELECT hierarchy_test.eq(
  (SELECT string_agg(hierarchy_test.key(p.id) || ':' || hierarchy_test.sp(p.hierarchy_path), ' ' ORDER BY hierarchy_test.key(p.id) COLLATE "C")
     FROM public.profiles p),
  (SELECT string_agg(s.key || ':' ||
            (SELECT string_agg(x, '.' ORDER BY o)
               FROM jsonb_array_elements_text(j.doc #> ARRAY['shapes', 'production', 'expected',
                      CASE WHEN :'repaired' OR s.key NOT IN ('A1', 'A2', 'D1', 'D2') THEN 'canonical_paths' ELSE 'stale_paths' END,
                      s.key]) WITH ORDINALITY e(x, o)),
            ' ' ORDER BY s.key COLLATE "C")
     FROM hierarchy_test.shape s, hierarchy_test.shapes_json j WHERE s.shape = 'production'),
  :'state' || ' every stored path equals hierarchy_shapes.json (canonical, or the recorded stale path)');

-- ── 2. No-op saves (Gate 1 exit criterion) ──────────────────────────────────────────────────────────────────────
-- The User Management step-2 save as the real client sends it (role authenticated, PostgREST claims). The F1
-- payload omits upline_id when it is unchanged; the legacy payload always lists it. After M2 NEITHER heals or
-- touches any other row. Before M2 the F1 payload heals nothing, and the legacy payload reproduces the §1 live risk
-- (the preimage cascade rewrites the saved member's direct reports).
\set legacy 'first_name = first_name, last_name = last_name, email = email, phone = phone, npn = npn, licensed_states = licensed_states, resident_state = resident_state, commission_level = commission_level, upline_id = upline_id'
\set f1 'first_name = first_name, last_name = last_name, email = email, phone = phone, npn = npn, licensed_states = licensed_states, resident_state = resident_state, commission_level = commission_level'
SELECT CASE WHEN :'m2' THEN 'changed=T:updated_at|stale=' || :'stale0' || '|set_claim=2'
            WHEN :'repaired' THEN 'changed=A1:updated_at A2:updated_at D1:updated_at T:updated_at|stale=|set_claim=8'
            ELSE 'changed=A1:path,updated_at A2:path,updated_at D1:path,updated_at T:updated_at|stale=D2|set_claim=8' END AS legacy_t,
       CASE WHEN :'m2' OR :'repaired' THEN 'changed=A1:updated_at|stale=' || :'stale0' || '|set_claim=2'
            ELSE 'changed=A1:path,updated_at|stale=A2,D1,D2|set_claim=2' END AS legacy_a1,
       'changed=T:updated_at|stale=' || :'stale0' || '|set_claim=2' AS f1_t,
       'changed=A1:updated_at|stale=' || :'stale0' || '|set_claim=2' AS f1_a1 \gset
SELECT hierarchy_test.eq(hierarchy_test.probe(:'t', format('UPDATE public.profiles SET %s WHERE id = %L', :'legacy', :'t')),
                         'OK 1|' || :'legacy_t' || '|side_effects=0',
                         :'state' || ' no-op: Team Leader self-save, legacy payload' || CASE WHEN :'m2' THEN ' heals nothing' ELSE ' (preimage: rewrites direct reports)' END);
SELECT hierarchy_test.eq(hierarchy_test.probe(:'t', format('UPDATE public.profiles SET %s WHERE id = %L', :'f1', :'t')),
                         'OK 1|' || :'f1_t' || '|side_effects=0',
                         :'state' || ' no-op: Team Leader self-save, F1 payload heals nothing and touches no other row');
SELECT hierarchy_test.eq(hierarchy_test.probe(:'r', format('UPDATE public.profiles SET %s WHERE id = %L', :'legacy', :'t')),
                         'OK 1|' || :'legacy_t' || '|side_effects=0',
                         :'state' || ' no-op: Admin save of the Team Leader, legacy payload' || CASE WHEN :'m2' THEN ' heals nothing' ELSE ' (preimage: rewrites direct reports)' END);
SELECT hierarchy_test.eq(hierarchy_test.probe(:'r', format('UPDATE public.profiles SET %s WHERE id = %L', :'f1', :'t')),
                         'OK 1|' || :'f1_t' || '|side_effects=0',
                         :'state' || ' no-op: Admin save of the Team Leader, F1 payload heals nothing');
SELECT hierarchy_test.eq(hierarchy_test.probe(:'r', format('UPDATE public.profiles SET %s WHERE id = %L', :'legacy', :'a1')),
                         'OK 1|' || :'legacy_a1' || '|side_effects=0',
                         :'state' || ' no-op: Admin save of a stale member, legacy payload' || CASE WHEN :'m2' OR :'repaired' THEN ' heals nothing' ELSE ' (preimage: heals that row)' END);
SELECT hierarchy_test.eq(hierarchy_test.probe(:'r', format('UPDATE public.profiles SET %s WHERE id = %L', :'f1', :'a1')),
                         'OK 1|' || :'f1_a1' || '|side_effects=0',
                         :'state' || ' no-op: Admin save of a stale member, F1 payload heals nothing');
SELECT hierarchy_test.eq(hierarchy_test.probe(NULL, format('UPDATE public.profiles SET upline_id = upline_id WHERE id IN (%L, %L, %L)', :'t', :'a1', :'k1')),
                         CASE WHEN :'m2' THEN 'OK 3|changed=A1:updated_at K1:updated_at T:updated_at|stale=' || :'stale0' || '|set_claim=6|side_effects=0'
                              WHEN :'repaired' THEN 'OK 3|changed=A1:updated_at A2:updated_at D1:updated_at K1:updated_at T:updated_at|stale=|set_claim=12|side_effects=0'
                              ELSE 'OK 3|changed=A1:path,updated_at A2:path,updated_at D1:path,updated_at K1:updated_at T:updated_at|stale=D2|set_claim=12|side_effects=0' END,
                         :'state' || ' no-op: multi-row system save listing upline_id' || CASE WHEN :'m2' THEN ' heals nothing' ELSE ' (preimage: heals)' END);

\if :m2
-- ── 3. Derivation (M2): paths derive from the incoming upline; whole subtrees follow real moves ──────────────────
BEGIN;
SELECT hierarchy_test.act_as(NULL) AS _ \gset
INSERT INTO auth.users (id) SELECT ('a1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(1, 9) n;
INSERT INTO hierarchy_test.shape (shape, key, id)
SELECT 'suite', 'N' || n, ('a1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(1, 9) n;
SELECT hierarchy_test.id('N1') AS n1, hierarchy_test.id('N2') AS n2, hierarchy_test.id('N3') AS n3,
       hierarchy_test.id('N4') AS n4, hierarchy_test.id('N5') AS n5, hierarchy_test.id('N6') AS n6 \gset
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'INSERT INTO public.profiles (id, organization_id, upline_id, first_name) VALUES (%L, %L, %L, ''Synthetic N1'')', :'n1', :'org_a', :'t')),
       'OK 1', :'state' || ' derive: INSERT with an upline is accepted');
SELECT hierarchy_test.eq((SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = :'n1'), 'R.T.N1',
       :'state' || ' derive: INSERT under the Team Leader stores the full chain (not self-only)');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'INSERT INTO public.profiles (id, organization_id, upline_id, first_name) VALUES (%L, %L, %L, ''Synthetic N2'')', :'n2', :'org_a', :'a1')),
       'OK 1', :'state' || ' derive: INSERT under a (possibly stale) member is accepted');
SELECT hierarchy_test.eq((SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = :'n2'), 'R.T.A1.N2',
       :'state' || ' derive: the builder walks upline_id, never the stored path of the upline');
SELECT hierarchy_test.eq((SELECT stale_paths FROM hierarchy_test.consistency()),
       CASE WHEN :'repaired' THEN 0::bigint ELSE 4::bigint END, :'state' || ' derive: inserts heal nothing else');
ROLLBACK;

BEGIN;
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'t', :'k1')), 'OK 1',
       :'state' || ' derive: Admin moves an agent R -> T (direct client write)');
SELECT hierarchy_test.eq((SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = :'k1'), 'R.T.K1',
       :'state' || ' derive: A -> B move stores the new chain');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'k2', :'k1')), 'OK 1',
       :'state' || ' derive: Admin moves the agent T -> K2 (TL1 -> TL2)');
SELECT hierarchy_test.check((SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = :'k1') = 'R.K2.K1'
                            AND NOT (SELECT k.hierarchy_path <@ t.hierarchy_path FROM public.profiles k, public.profiles t WHERE k.id = :'k1' AND t.id = :'t')
                            AND NOT public.is_ancestor_of(:'t', :'k1'),
       :'state' || ' derive: the previous leader loses ancestry immediately (no fail-open)');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET upline_id = NULL WHERE id = %L', :'k1')), 'OK 1',
       :'state' || ' derive: Admin removes the upline');
SELECT hierarchy_test.eq((SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = :'k1'), 'K1',
       :'state' || ' derive: upline None stores a self-only path (all ancestry revoked)');
ROLLBACK;

BEGIN;
SELECT hierarchy_test.act_as(NULL) AS _ \gset
INSERT INTO auth.users (id) VALUES ('a1000000-0000-4000-8000-000000000001');
INSERT INTO hierarchy_test.shape (shape, key, id) VALUES ('suite', 'G', 'a1000000-0000-4000-8000-000000000001');
INSERT INTO public.profiles (id, organization_id, upline_id, first_name)
VALUES ('a1000000-0000-4000-8000-000000000001', :'org_a', :'a1', 'Synthetic G');
SELECT hierarchy_test.eq(hierarchy_test.probe(:'r', format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'k3', :'t')),
       'OK 1|changed=A1:path,updated_at A2:path,updated_at D1:path,updated_at G:path T:path,updated_at,upline'
       || '|stale=' || CASE WHEN :'repaired' THEN '' ELSE 'D2' END || '|set_claim=10|side_effects=0',
       :'state' || ' derive: moving a Team Leader re-derives the whole subtree (grandchildren included)'
       || CASE WHEN :'repaired' THEN '' ELSE '; on stale data this activates the branch before M3 (D14)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_system(format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'k3', :'t')), 'OK 1',
       :'state' || ' derive: the same Team Leader move applied (kept for inspection)');
SELECT hierarchy_test.eq((SELECT string_agg(hierarchy_test.key(id) || '=' || hierarchy_test.sp(hierarchy_path), ' ' ORDER BY hierarchy_test.key(id) COLLATE "C")
                            FROM public.profiles WHERE hierarchy_path <@ (SELECT hierarchy_path FROM public.profiles WHERE id = :'t')),
       'A1=R.K3.T.A1 A2=R.K3.T.A2 D1=R.K3.T.D1 G=R.K3.T.A1.G T=R.K3.T',
       :'state' || ' derive: the moved subtree is canonical at every depth');
ROLLBACK;

BEGIN;
SELECT hierarchy_test.act_as(NULL) AS _ \gset
INSERT INTO auth.users (id) SELECT ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(1, 4) n;
INSERT INTO hierarchy_test.shape (shape, key, id)
SELECT 'suite', 'C' || n, ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(1, 4) n;
INSERT INTO public.profiles (id, organization_id, upline_id, first_name)
SELECT ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, :'org_a',
       CASE WHEN n = 1 THEN :'k4'::uuid ELSE ('a2000000-0000-4000-8000-' || lpad((n - 1)::text, 12, '0'))::uuid END,
       'Synthetic C' || n
  FROM generate_series(1, 4) n ORDER BY n;
SELECT hierarchy_test.eq((SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = hierarchy_test.id('C4')), 'R.K4.C1.C2.C3.C4',
       :'state' || ' derive: a depth-6 chain inserted parent-first in ONE multi-row INSERT');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'k5', hierarchy_test.id('C2'))), 'OK 1',
       :'state' || ' derive: re-parent a middle node');
SELECT hierarchy_test.eq((SELECT string_agg(hierarchy_test.key(id) || '=' || hierarchy_test.sp(hierarchy_path), ' ' ORDER BY hierarchy_test.key(id) COLLATE "C")
                            FROM public.profiles WHERE hierarchy_test.key(id) ~ '^C[0-9]$'),
       'C1=R.K4.C1 C2=R.K5.C2 C3=R.K5.C2.C3 C4=R.K5.C2.C3.C4',
       :'state' || ' derive: re-parenting a middle node moves exactly its subtree');
ROLLBACK;

BEGIN;
SELECT hierarchy_test.act_as(NULL) AS _ \gset
INSERT INTO auth.users (id) SELECT s.id FROM hierarchy_test.shape s WHERE s.shape = 'deep_chain';
INSERT INTO public.profiles (id, organization_id, upline_id, role, first_name)
SELECT s.id, s.org_id, u.id, s.role, 'Synthetic ' || s.key
  FROM hierarchy_test.shape s LEFT JOIN hierarchy_test.shape u ON u.shape = s.shape AND u.key = s.upline_key
 WHERE s.shape = 'deep_chain' ORDER BY s.key COLLATE "C";
SELECT hierarchy_test.eq((SELECT public.nlevel(hierarchy_path) FROM public.profiles WHERE id = hierarchy_test.id('L25')), 25,
       :'state' || ' derive: a 25-level chain keeps all 25 labels (the preimage truncated at 20)');
SELECT hierarchy_test.check((SELECT l25.hierarchy_path <@ l01.hierarchy_path FROM public.profiles l01, public.profiles l25
                              WHERE l01.id = hierarchy_test.id('L01') AND l25.id = hierarchy_test.id('L25')),
       :'state' || ' derive: the root of a 25-level chain is an ancestor of its deepest member');
ROLLBACK;

BEGIN;
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'UPDATE public.profiles SET upline_id = CASE id WHEN %L THEN %L::uuid ELSE %L::uuid END WHERE id IN (%L, %L)',
         :'k1', :'k2', :'k3', :'k1', :'k2')), 'OK 2',
       :'state' || ' derive: one statement moves a member and its new upline (K1 -> K2, K2 -> K3)');
SELECT hierarchy_test.eq((SELECT string_agg(hierarchy_test.key(id) || '=' || hierarchy_test.sp(hierarchy_path), ' ' ORDER BY hierarchy_test.key(id) COLLATE "C")
                            FROM public.profiles WHERE id IN (:'k1', :'k2')),
       'K1=R.K3.K2.K1 K2=R.K3.K2', :'state' || ' derive: multi-row move ends canonical (child row first)');
ROLLBACK;
BEGIN;
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'UPDATE public.profiles SET upline_id = CASE id WHEN %L THEN %L::uuid ELSE %L::uuid END WHERE id IN (%L, %L)',
         :'k4', :'k3', :'k4', :'k4', :'k5')), 'OK 2',
       :'state' || ' derive: one statement moves K4 -> K3 and K5 -> K4 (parent row first)');
SELECT hierarchy_test.eq((SELECT string_agg(hierarchy_test.key(id) || '=' || hierarchy_test.sp(hierarchy_path), ' ' ORDER BY hierarchy_test.key(id) COLLATE "C")
                            FROM public.profiles WHERE id IN (:'k4', :'k5')),
       'K4=R.K3.K4 K5=R.K3.K4.K5', :'state' || ' derive: multi-row move ends canonical (parent row first)');
SELECT hierarchy_test.eq((SELECT row(stale_paths, missing_pairs, extra_pairs, self_parents, unreachable)::text FROM hierarchy_test.consistency()),
       CASE WHEN :'repaired' THEN '(0,0,0,0,0)' ELSE '(4,6,0,0,0)' END, :'state' || ' derive: multi-row moves leave every touched row canonical');
ROLLBACK;

-- ── 4. Integrity (M2): structural rules are enforced by the database ────────────────────────────────────────────
BEGIN;
SELECT hierarchy_test.act_as(NULL) AS _ \gset
INSERT INTO auth.users (id) SELECT ('a3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(1, 4) n;
SELECT 'a3000000-0000-4000-8000-000000000001' AS x1, 'a3000000-0000-4000-8000-000000000002' AS x2,
       'a3000000-0000-4000-8000-000000000003' AS x3 \gset
SELECT hierarchy_test.eq(hierarchy_test.as_system(format('UPDATE public.profiles SET upline_id = id WHERE id = %L', :'k1')),
       'REJECTED 23514: Hierarchy: a member cannot be their own upline', :'state' || ' integrity: self-parent UPDATE rejected');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'INSERT INTO public.profiles (id, organization_id, upline_id, first_name) VALUES (%L, %L, %L, ''Synthetic X'')', :'x1', :'org_a', :'x1')),
       'REJECTED 23514: Hierarchy: a member cannot be their own upline', :'state' || ' integrity: self-parent INSERT rejected');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'a1', :'t')),
       'REJECTED 23514: Hierarchy: this upline would create a reporting cycle (a member cannot report to their own downline)',
       :'state' || ' integrity: moving a Team Leader under their own report rejected (Admin, client write)');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'k2', :'k1')), 'OK 1',
       :'state' || ' integrity: (K1 under K2 accepted)');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'k1', :'k2')),
       'REJECTED 23514: Hierarchy: this upline would create a reporting cycle (a member cannot report to their own downline)',
       :'state' || ' integrity: 2-cycle across two statements rejected');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'UPDATE public.profiles SET upline_id = CASE id WHEN %L THEN %L::uuid ELSE %L::uuid END WHERE id IN (%L, %L)',
         :'k3', :'k4', :'k3', :'k3', :'k4')),
       'REJECTED 23514: Hierarchy: this upline would create a reporting cycle (a member cannot report to their own downline)',
       :'state' || ' integrity: 2-cycle inside one multi-row statement rejected');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'INSERT INTO public.profiles (id, organization_id, upline_id, first_name) VALUES (%L, %L, %L, ''Synthetic X'')', :'x1', :'org_a', :'ba')),
       'REJECTED 23514: Hierarchy: an upline must belong to the same organization', :'state' || ' integrity: cross-org upline on INSERT rejected');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'ba', :'k5')),
       'REJECTED 23514: Hierarchy: an upline must belong to the same organization',
       :'state' || ' integrity: same-org Admin setting a cross-org upline (client write) rejected');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format('UPDATE public.profiles SET organization_id = %L WHERE id = %L', :'org_b', :'t')),
       'REJECTED 23514: Hierarchy: reassign this member''s direct reports before moving them to another organization',
       :'state' || ' integrity: organization change stranding direct reports rejected');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format('UPDATE public.profiles SET organization_id = %L WHERE id = %L', :'org_b', :'k5')),
       'REJECTED 23514: Hierarchy: an upline must belong to the same organization',
       :'state' || ' integrity: organization change keeping a cross-org upline rejected');
SELECT hierarchy_test.eq(hierarchy_test.probe(NULL, format('UPDATE public.profiles SET organization_id = %L, upline_id = NULL WHERE id = %L', :'org_b', :'k5')),
       'OK 1|changed=K5:path,updated_at,upline,other|stale=' || :'stale0' || '|set_claim=2|side_effects=1',
       :'state' || ' integrity: organization change that detaches the upline in the same statement accepted');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format('SELECT public.provision_organization(''Synthetic Org'', NULL, %L)', :'k5')),
       'REJECTED 23514: Hierarchy: an upline must belong to the same organization',
       :'state' || ' integrity: provision_organization on a founder who still has an upline rejected (documented)');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format('SELECT public.provision_organization(''Synthetic Org'', NULL, %L)', :'ba')),
       'OK 1', :'state' || ' integrity: provision_organization on a founder without an upline or reports accepted');
SELECT hierarchy_test.eq((SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = :'ba'), 'BA',
       :'state' || ' integrity: the provisioned founder''s path is self-only in the new organization');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'INSERT INTO public.profiles (id, organization_id, upline_id, first_name) VALUES (%L, %L, %L, ''Synthetic X2''), (%L, %L, %L, ''Synthetic X1'')',
         :'x2', :'org_a', :'x1', :'x1', :'org_a', :'t')),
       'REJECTED 23503: Hierarchy: the selected upline does not exist',
       :'state' || ' integrity: multi-row INSERT listing a child before its parent rejected (documented)');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'INSERT INTO public.profiles (id, organization_id, upline_id, first_name) VALUES (%L, %L, %L, ''Synthetic X1''), (%L, %L, %L, ''Synthetic X2'')',
         :'x1', :'org_a', :'t', :'x2', :'org_a', :'x1')), 'OK 2',
       :'state' || ' integrity: the same rows parent-first accepted');
ROLLBACK;

BEGIN;
SELECT hierarchy_test.act_as(NULL) AS _ \gset
INSERT INTO auth.users (id) SELECT ('a4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(1, 33) n;
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'INSERT INTO public.profiles (id, organization_id, upline_id, first_name) '
         'SELECT (''a4000000-0000-4000-8000-'' || lpad(n::text, 12, ''0''))::uuid, %L, '
         'CASE WHEN n > 1 THEN (''a4000000-0000-4000-8000-'' || lpad((n - 1)::text, 12, ''0''))::uuid END, ''Synthetic Z'' || n '
         'FROM generate_series(1, 32) n ORDER BY n', :'org_a')), 'OK 32',
       :'state' || ' integrity: a 32-level chain is accepted');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'INSERT INTO public.profiles (id, organization_id, upline_id, first_name) VALUES (%L, %L, %L, ''Synthetic Z33'')',
         'a4000000-0000-4000-8000-000000000033', :'org_a', 'a4000000-0000-4000-8000-000000000032')),
       'REJECTED 23514: Hierarchy: the upline chain is deeper than 32 levels',
       :'state' || ' integrity: a 33rd level is rejected cleanly, before any heap or GiST index write');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format('UPDATE public.profiles SET upline_id = %L WHERE id = %L',
         'a4000000-0000-4000-8000-000000000032', :'k1')),
       'REJECTED 23514: Hierarchy: the upline chain is deeper than 32 levels',
       :'state' || ' integrity: moving a member under the 32nd level is rejected');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format('UPDATE public.profiles SET upline_id = %L WHERE id = %L',
         'a4000000-0000-4000-8000-000000000031', :'t')),
       'REJECTED 23514: Hierarchy: the upline chain is deeper than 32 levels',
       :'state' || ' integrity: moving a subtree whose descendants would pass 32 levels is rejected (cascade re-check)');
ROLLBACK;

BEGIN;
SELECT hierarchy_test.act_as(NULL) AS _ \gset
UPDATE public.profiles SET status = 'Inactive' WHERE id = :'k5';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format(
         'INSERT INTO public.invitations (organization_id, email, upline_id) VALUES (%L, ''i1@synthetic.invalid'', %L)', :'org_a', :'t')),
       'OK 1', :'state' || ' integrity: Admin invitation under an Active same-org Team Leader accepted');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format(
         'INSERT INTO public.invitations (organization_id, email, upline_id) VALUES (%L, ''i2@synthetic.invalid'', NULL)', :'org_a')),
       'OK 1', :'state' || ' integrity: invitation without an upline accepted');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'INSERT INTO public.invitations (organization_id, email, upline_id) VALUES (%L, ''i3@synthetic.invalid'', %L)', :'org_a', :'ba')),
       'REJECTED 23514: Hierarchy: an invitation''s upline must be an active member of the same organization',
       :'state' || ' integrity: invitation with a cross-org upline rejected');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'INSERT INTO public.invitations (organization_id, email, upline_id) VALUES (%L, ''i4@synthetic.invalid'', %L)', :'org_a', :'t2')),
       'REJECTED 23514: Hierarchy: an invitation''s upline must be an active member of the same organization',
       :'state' || ' integrity: invitation with a Deleted upline rejected');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format(
         'INSERT INTO public.invitations (organization_id, email, upline_id) VALUES (%L, ''i5@synthetic.invalid'', %L)', :'org_a', :'k5')),
       'REJECTED 23514: Hierarchy: an invitation''s upline must be an active member of the same organization',
       :'state' || ' integrity: invitation with an Inactive upline rejected');
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'t';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', 'UPDATE public.invitations SET status = ''Revoked'' WHERE email = ''i1@synthetic.invalid'''),
       'OK 1', :'state' || ' integrity: revoking an invitation whose upline was since deleted still works');
SELECT hierarchy_test.eq(hierarchy_test.as_system('UPDATE public.invitations SET status = ''Accepted'', upline_id = upline_id WHERE email = ''i1@synthetic.invalid'''),
       'OK 1', :'state' || ' integrity: an UPDATE listing an unchanged upline is not re-validated');
SELECT hierarchy_test.eq(hierarchy_test.as_system(format('UPDATE public.invitations SET upline_id = %L WHERE email = ''i2@synthetic.invalid''', :'ba')),
       'REJECTED 23514: Hierarchy: an invitation''s upline must be an active member of the same organization',
       :'state' || ' integrity: changing an invitation''s upline to a cross-org member rejected');
ROLLBACK;

BEGIN;
SELECT hierarchy_test.act_as(NULL) AS _ \gset
INSERT INTO auth.users (id) SELECT s.id FROM hierarchy_test.shape s WHERE s.shape = 'deleted_intermediate';
INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name)
SELECT s.id, s.org_id, u.id, s.role, s.status, 'Synthetic ' || s.key
  FROM hierarchy_test.shape s LEFT JOIN hierarchy_test.shape u ON u.shape = s.shape AND u.key = s.upline_key
 WHERE s.shape = 'deleted_intermediate' ORDER BY s.key = 'M' DESC, s.key = 'MT' DESC;
SELECT hierarchy_test.check((SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = hierarchy_test.id('MG')) = 'M.MT.MG'
                            AND public.is_ancestor_of(hierarchy_test.id('M'), hierarchy_test.id('MG'))
                            AND NOT public.is_ancestor_of(hierarchy_test.id('MT'), hierarchy_test.id('MG')),
       :'state' || ' integrity: a Deleted intermediate keeps passing ancestry through (and holds none itself)');
SELECT hierarchy_test.eq(hierarchy_test.probe(NULL, format('UPDATE public.profiles SET hierarchy_path = %L::public.ltree WHERE id = %L',
                                                           hierarchy_test.label('R') || '.' || hierarchy_test.label('T') || '.' || hierarchy_test.label('K1'), :'k1')),
       'OK 1|changed=K1:updated_at|stale=' || :'stale0' || '|set_claim=2|side_effects=0',
       :'state' || ' integrity: a forged hierarchy_path written by a system caller is overwritten with the canonical one');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET hierarchy_path = NULL WHERE id = %L', :'k1')),
       'REJECTED 42501: permission denied for table profiles', :'state' || ' integrity: clients cannot write hierarchy_path at all');
ROLLBACK;
\else
-- ── 3/4. Reproduce the preimage defects (no M2) ──────────────────────────────────────────────────────────────────
BEGIN;
SELECT hierarchy_test.act_as(NULL) AS _ \gset
INSERT INTO auth.users (id) VALUES ('a1000000-0000-4000-8000-000000000001');
INSERT INTO hierarchy_test.shape (shape, key, id) VALUES ('suite', 'N1', 'a1000000-0000-4000-8000-000000000001');
INSERT INTO public.profiles (id, organization_id, upline_id, first_name) VALUES ('a1000000-0000-4000-8000-000000000001', :'org_a', :'t', 'Synthetic N1');
SELECT hierarchy_test.eq((SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = hierarchy_test.id('N1')), 'N1',
       :'state' || ' reproduce: INSERT with an upline stores a self-only path (defect 1)');
ROLLBACK;
BEGIN;
SELECT hierarchy_test.act_as(NULL) AS _ \gset
UPDATE public.profiles SET upline_id = :'t' WHERE id = :'k1';
SELECT hierarchy_test.eq((SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = :'k1'), 'R.K1',
       :'state' || ' reproduce: a move stores the path of the PREVIOUS upline (defect 2)');
UPDATE public.profiles SET upline_id = :'k2' WHERE id = :'a1';
SELECT hierarchy_test.eq((SELECT hierarchy_test.sp(hierarchy_path) FROM public.profiles WHERE id = :'a1'), 'R.T.A1',
       :'state' || ' reproduce: after TL1 -> TL2 the stored path still names the old leader (fail-open, defect 3)');
ROLLBACK;
SELECT hierarchy_test.eq(split_part(hierarchy_test.probe(NULL, format('UPDATE public.profiles SET upline_id = id WHERE id = %L', :'k1')), '|', 1), 'OK 1',
       :'state' || ' reproduce: a self-parent is accepted (no structural guard, defect 4)');
SELECT hierarchy_test.eq(split_part(hierarchy_test.probe(:'r', format('UPDATE public.profiles SET upline_id = %L WHERE id = %L', :'ba', :'k5')), '|', 1), 'OK 1',
       :'state' || ' reproduce: a same-org Admin can set a cross-org upline over the client API (defect 4)');
BEGIN;
SELECT hierarchy_test.act_as(NULL) AS _ \gset
INSERT INTO auth.users (id) SELECT s.id FROM hierarchy_test.shape s WHERE s.shape = 'deep_chain';
INSERT INTO public.profiles (id, organization_id, role, first_name)
SELECT s.id, s.org_id, s.role, 'Synthetic ' || s.key FROM hierarchy_test.shape s WHERE s.shape = 'deep_chain';
UPDATE public.profiles p SET upline_id = u.id
  FROM hierarchy_test.shape s JOIN hierarchy_test.shape u ON u.shape = s.shape AND u.key = s.upline_key
 WHERE s.shape = 'deep_chain' AND p.id = s.id;
SELECT hierarchy_test.eq((SELECT public.nlevel(public.compute_hierarchy_path(hierarchy_test.id('L25')))), 20,
       :'state' || ' reproduce: compute_hierarchy_path silently truncates a 25-level chain at 20');
ROLLBACK;
\endif

-- ── 5. Consistency: paths vs the upline walk, is_ancestor_of semantics, Reports parity ──────────────────────────
\if :m2
SELECT hierarchy_test.eq((SELECT row(c.*)::text FROM private.hierarchy_consistency() c),
                         (SELECT row(c.*)::text FROM hierarchy_test.consistency() c),
                         :'state' || ' consistency: private.hierarchy_consistency() equals the independent test measure');
\endif
WITH RECURSIVE walk(descendant, ancestor, visited) AS (
  SELECT p.id, p.id, ARRAY[p.id] FROM public.profiles p
  UNION ALL
  SELECT w.descendant, p.upline_id, w.visited || p.upline_id FROM walk w JOIN public.profiles p ON p.id = w.ancestor
   WHERE p.upline_id IS NOT NULL AND p.upline_id <> ALL (w.visited))
SELECT hierarchy_test.eq(
  (SELECT count(*) FROM public.profiles a CROSS JOIN public.profiles d
    WHERE (d.hierarchy_path <@ a.hierarchy_path)
          IS DISTINCT FROM EXISTS (SELECT 1 FROM walk w WHERE w.descendant = d.id AND w.ancestor = a.id)),
  CASE WHEN :'repaired' THEN 0::bigint ELSE 6::bigint END,
  :'state' || ' consistency: full ordered-pair truth table (stored paths vs upline walk) '
  || CASE WHEN :'repaired' THEN 'agrees on every pair' ELSE 'differs only on the 6 missing pairs' END);
SELECT hierarchy_test.eq(
  (SELECT count(*) FROM public.profiles a CROSS JOIN public.profiles d
    WHERE public.is_ancestor_of(a.id, d.id) IS DISTINCT FROM
          CASE WHEN :'m1' THEN d.organization_id = a.organization_id AND d.hierarchy_path <@ a.hierarchy_path
                               AND (a.id = d.id OR (a.status = 'Active'
                                                    AND (coalesce(a.is_super_admin, false) OR a.role IN ('Team Leader', 'Admin', 'Super Admin'))))
               ELSE d.hierarchy_path <@ a.hierarchy_path END),
  0::bigint,
  :'state' || ' consistency: is_ancestor_of (system caller) = ' || CASE WHEN :'m1' THEN 'same org + path + Active TL/Admin ancestor (D2, D3)' ELSE 'raw path containment (preimage)' END
  || ' over all ordered pairs');
SELECT hierarchy_test.eq(
  (SELECT count(*) FROM public.profiles root
    WHERE (SELECT coalesce(array_agg(d.id ORDER BY d.id), '{}') FROM public.profiles d
            WHERE d.organization_id = root.organization_id AND d.hierarchy_path <@ root.hierarchy_path
              AND (d.id = root.id OR d.status <> 'Deleted'))
          IS DISTINCT FROM
          (SELECT coalesce(array_agg(x.agent_id ORDER BY x.agent_id), '{}') FROM private.resolve_downline_ids(root.id, root.organization_id) x)),
  CASE WHEN :'repaired' THEN 0::bigint ELSE 1::bigint END,
  :'state' || ' consistency: path descendants equal Reports'' resolve_downline_ids (Deleted excluded)'
  || CASE WHEN :'repaired' THEN ' for every root' ELSE ' except the stale Team Leader' END);

-- ── 6. Authorization smoke test of M1 / R1 (the full matrix is in hierarchy_stabilization_rls.sql) ──────────────
BEGIN;
SELECT hierarchy_test.act_as(NULL) AS _ \gset
INSERT INTO public.leads (id, organization_id, assigned_agent_id, first_name) VALUES
  ('a5000000-0000-4000-8000-000000000001', :'org_a', :'a1', 'Synthetic lead of A1'),
  ('a5000000-0000-4000-8000-000000000002', :'org_a', :'t', 'Synthetic lead of T');
INSERT INTO public.calls (id, organization_id, agent_id, direction, status) VALUES
  ('a6000000-0000-4000-8000-000000000001', :'org_a', :'a1', 'outbound', 'completed');
INSERT INTO public.tasks (id, organization_id, contact_id, contact_type, assigned_to, created_by, title, task_type, due_date) VALUES
  ('a7000000-0000-4000-8000-000000000001', :'org_a', 'a5000000-0000-4000-8000-000000000001', 'lead', :'a1', :'r', 'Synthetic task', 'General', now());
SELECT 'a5000000-0000-4000-8000-000000000001' AS lead_a1, 'a5000000-0000-4000-8000-000000000002' AS lead_t,
       'a6000000-0000-4000-8000-000000000001' AS call_a1, 'a7000000-0000-4000-8000-000000000001' AS task_a1 \gset
-- Team Leader reach: on repaired data T leads A1; before the repair it does not (that is the dormant branch).
SELECT CASE WHEN :'repaired' THEN 'OK 1' ELSE 'OK 0' END AS reach \gset
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('SELECT 1 FROM public.leads WHERE id = %L', :'lead_a1')), :'reach',
       :'state' || ' authz: Team Leader (fresh token) reads a downline lead only when the path says so');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('SELECT 1 FROM public.leads WHERE id = %L', :'lead_a1'), 'Team Leader', :'org_a'),
       :'reach', :'state' || ' authz: (same with explicit Team Leader claims)');
UPDATE public.profiles SET role = 'Agent' WHERE id = :'t';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('SELECT 1 FROM public.leads WHERE id = %L', :'lead_a1'), 'Team Leader', :'org_a'),
       CASE WHEN :'m1' THEN 'OK 0' ELSE :'reach' END,
       :'state' || ' authz R1: demoted Team Leader with a stale TL token ' || CASE WHEN :'m1' THEN 'reads no downline lead' ELSE 'still reads it (preimage gap)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('UPDATE public.calls SET flagged_for_coaching = true WHERE id = %L', :'call_a1'), 'Team Leader', :'org_a'),
       CASE WHEN :'m1' THEN 'OK 0' ELSE :'reach' END,
       :'state' || ' authz R1: demoted Team Leader with a stale TL token ' || CASE WHEN :'m1' THEN 'cannot edit a downline call (even the coaching flag)' ELSE 'still edits it (preimage gap)' END);
UPDATE public.profiles SET role = 'Team Leader', status = 'Inactive' WHERE id = :'t';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('SELECT 1 FROM public.leads WHERE id = %L', :'lead_a1'), 'Team Leader', :'org_a'),
       CASE WHEN :'m1' THEN 'OK 0' ELSE :'reach' END,
       :'state' || ' authz R1: deactivated Team Leader with a live token ' || CASE WHEN :'m1' THEN 'reads no downline lead' ELSE 'still reads it (preimage gap)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('SELECT 1 FROM public.tasks WHERE id = %L', :'task_a1'), 'Team Leader', :'org_a'),
       CASE WHEN :'m1' THEN 'OK 0' ELSE :'reach' END,
       :'state' || ' authz R1: deactivated Team Leader ' || CASE WHEN :'m1' THEN 'reads no downline task' ELSE 'still reads downline tasks (preimage gap)' END);
UPDATE public.profiles SET status = 'Deleted' WHERE id = :'t';
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('SELECT 1 FROM public.calls WHERE id = %L', :'call_a1'), 'Team Leader', :'org_a'),
       CASE WHEN :'m1' THEN 'OK 0' ELSE :'reach' END,
       :'state' || ' authz R1: deleted Team Leader with a live token ' || CASE WHEN :'m1' THEN 'reads no downline call' ELSE 'still reads it (preimage gap)' END);
UPDATE public.profiles SET status = 'Active' WHERE id = :'t';
-- Active Team Leader on repaired data: coaching flag and notes only; no other call column, no call delete.
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('UPDATE public.calls SET flagged_for_coaching = true, notes = ''coached'' WHERE id = %L', :'call_a1')),
       :'reach', :'state' || ' authz: Team Leader coaching flag and notes on a downline call');
SELECT hierarchy_test.eq(split_part(hierarchy_test.as_user(:'t', format('UPDATE public.calls SET status = ''failed'' WHERE id = %L', :'call_a1')), ':', 1),
       CASE WHEN :'repaired' AND :'m1' THEN 'REJECTED 42501' ELSE :'reach' END,
       :'state' || ' authz D6: Team Leader edit of a downline call''s status ' || CASE WHEN :'m1' THEN 'is limited to coaching fields' ELSE '(preimage: allowed when reachable)' END);
SELECT hierarchy_test.eq(split_part(CASE WHEN :'m1' THEN hierarchy_test.as_user(:'t', format('DELETE FROM public.calls WHERE id = %L', :'call_a1'))
                                         ELSE hierarchy_test.probe(:'t', format('DELETE FROM public.calls WHERE id = %L', :'call_a1')) END, '|', 1),
       CASE WHEN :'m1' THEN 'OK 0' ELSE :'reach' END,
       :'state' || ' authz D6: Team Leader delete of a downline call ' || CASE WHEN :'m1' THEN 'deletes nothing' ELSE '(preimage: allowed when reachable)' END);
SELECT hierarchy_test.check(EXISTS (SELECT 1 FROM public.calls WHERE id = :'call_a1'), :'state' || ' authz: the downline call still exists');
SELECT hierarchy_test.check(EXISTS (SELECT 1 FROM public.leads WHERE id = :'lead_t'), :'state' || ' authz: (leads intact before the toggle cases)');
-- Admin: unchanged when the profile is a real, Active Admin; a demoted or deactivated Admin's stale token cannot
-- edit or delete other agents' calls beyond coaching (R1).
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.calls SET status = ''failed'' WHERE id = %L', :'call_a1')), 'OK 1',
       :'state' || ' authz: Admin edits another agent''s call');
UPDATE public.profiles SET role = 'Agent' WHERE id = :'r';
SELECT hierarchy_test.eq(split_part(hierarchy_test.as_user(:'r', format('UPDATE public.calls SET status = ''no-answer'' WHERE id = %L', :'call_a1'), 'Admin', :'org_a'), ':', 1),
       CASE WHEN :'m1' THEN 'REJECTED 42501' ELSE 'OK 1' END,
       :'state' || ' authz R1: demoted Admin with a stale Admin token ' || CASE WHEN :'m1' THEN 'cannot edit another agent''s call' ELSE 'still edits it (preimage gap)' END);
SELECT hierarchy_test.eq(split_part(CASE WHEN :'m1' THEN hierarchy_test.as_user(:'r', format('DELETE FROM public.calls WHERE id = %L', :'call_a1'), 'Admin', :'org_a')
                                         ELSE hierarchy_test.probe(:'r', format('DELETE FROM public.calls WHERE id = %L', :'call_a1'), 'Admin', :'org_a') END, '|', 1),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' authz R1: demoted Admin with a stale Admin token ' || CASE WHEN :'m1' THEN 'cannot delete another agent''s call' ELSE 'still deletes it (preimage gap)' END);
UPDATE public.profiles SET role = 'Admin', status = 'Inactive' WHERE id = :'r';
SELECT hierarchy_test.eq(split_part(hierarchy_test.as_user(:'r', format('UPDATE public.calls SET status = ''no-answer'' WHERE id = %L', :'call_a1'), 'Admin', :'org_a'), ':', 1),
       CASE WHEN :'m1' THEN 'REJECTED 42501' ELSE 'OK 1' END,
       :'state' || ' authz R1: deactivated Admin with a live token ' || CASE WHEN :'m1' THEN 'cannot edit another agent''s call' ELSE 'still edits it (preimage gap)' END);
UPDATE public.profiles SET status = 'Active' WHERE id = :'r';
-- Contacts delete toggle (D5): a Team Leader profile needs contacts.leads.delete for ANY direct delete.
SELECT hierarchy_test.eq(split_part(CASE WHEN :'m1' THEN hierarchy_test.as_user(:'t', format('DELETE FROM public.leads WHERE id = %L', :'lead_t'))
                                         ELSE hierarchy_test.probe(:'t', format('DELETE FROM public.leads WHERE id = %L', :'lead_t')) END, '|', 1),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' authz D5: Team Leader without the delete toggle ' || CASE WHEN :'m1' THEN 'cannot delete even an own lead' ELSE 'deletes an own lead (preimage)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('UPDATE public.leads SET assigned_agent_id = %L WHERE id = %L', :'t', :'lead_a1')), :'reach',
       :'state' || ' authz D5: Team Leader reassigns a downline lead to self');
SELECT hierarchy_test.eq(split_part(CASE WHEN :'m1' THEN hierarchy_test.as_user(:'t', format('DELETE FROM public.leads WHERE id = %L', :'lead_a1'))
                                         ELSE hierarchy_test.probe(:'t', format('DELETE FROM public.leads WHERE id = %L', :'lead_a1')) END, '|', 1),
       CASE WHEN :'m1' THEN 'OK 0' WHEN :'repaired' THEN 'OK 1' ELSE 'OK 0' END,
       :'state' || ' authz D5: reassign-to-self-then-delete ' || CASE WHEN :'m1' THEN 'deletes nothing' ELSE '(preimage: bypasses the toggle when reachable)' END);
INSERT INTO public.role_permissions (organization_id, role, permissions)
VALUES (:'org_a', 'Team Leader', '{"contacts": {"contacts.leads.delete": true}}');
SELECT hierarchy_test.eq(split_part(hierarchy_test.probe(:'t', format('DELETE FROM public.leads WHERE id = %L', :'lead_t')), '|', 1), 'OK 1',
       :'state' || ' authz D5: with the toggle on, the Team Leader deletes an own lead');
-- commission_level (D4): changing a downline member's level needs an org-admin profile; unchanged saves pass.
SELECT hierarchy_test.eq(split_part(hierarchy_test.as_user(:'t', format('UPDATE public.profiles SET commission_level = ''90%%'' WHERE id = %L', :'a2')), ':', 1),
       CASE WHEN :'m1' AND :'repaired' THEN 'REJECTED 42501' WHEN :'repaired' THEN 'OK 1' ELSE 'OK 0' END,
       :'state' || ' authz D4: Team Leader change of a downline commission_level'
       || CASE WHEN :'m1' AND :'repaired' THEN ' rejected' WHEN :'repaired' THEN ' (preimage: allowed)' ELSE ' (not reachable before the repair)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('UPDATE public.profiles SET commission_level = commission_level, first_name = first_name WHERE id = %L', :'a2')),
       :'reach', :'state' || ' authz D4: Team Leader save of a downline profile with an unchanged commission_level');
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'r', format('UPDATE public.profiles SET commission_level = ''90%%'' WHERE id = %L', :'a2')), 'OK 1',
       :'state' || ' authz D4: Admin changes a member''s commission_level');
ROLLBACK;
-- The cross-org ancestry oracle (D2) and direct RPC exposure (D10).
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('SELECT 1 WHERE public.is_ancestor_of(%L, %L)', :'ba', :'ba')),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' authz D2: a signed-in member probing a foreign self-pair ' || CASE WHEN :'m1' THEN 'learns nothing' ELSE 'learns the profile exists (preimage)' END);
SELECT hierarchy_test.eq(hierarchy_test.as_user(:'t', format('SELECT 1 WHERE public.is_ancestor_of(%L, %L)', :'r', :'a1')),
       CASE WHEN :'m1' THEN 'OK 0' ELSE 'OK 1' END,
       :'state' || ' authz D2: is_ancestor_of with someone else as the ancestor ' || CASE WHEN :'m1' THEN 'is false' ELSE 'answers (preimage)' END);
SELECT hierarchy_test.eq(split_part(hierarchy_test.as_anon(format('SELECT public.is_ancestor_of(%L, %L)', :'r', :'a1')), ':', 1),
       CASE WHEN :'anon_revoked' THEN 'REJECTED 42501' ELSE 'OK 1' END,
       :'state' || ' authz D10: anon EXECUTE on is_ancestor_of ' || CASE WHEN :'anon_revoked' THEN 'denied' ELSE 'allowed (preimage)' END);
SELECT hierarchy_test.eq(split_part(hierarchy_test.as_anon(format('SELECT public.compute_hierarchy_path(%L)', :'a1')), ':', 1),
       CASE WHEN :'compute_revoked' THEN 'REJECTED 42501' ELSE 'OK 1' END,
       :'state' || ' authz D10: anon EXECUTE on compute_hierarchy_path ' || CASE WHEN :'compute_revoked' THEN 'denied' ELSE 'allowed (preimage)' END);
SELECT hierarchy_test.eq(split_part(hierarchy_test.as_user(:'t', format('SELECT public.compute_hierarchy_path(%L)', :'a1')), ':', 1),
       CASE WHEN :'compute_revoked' THEN 'REJECTED 42501' ELSE 'OK 1' END,
       :'state' || ' authz D10: authenticated EXECUTE on compute_hierarchy_path ' || CASE WHEN :'compute_revoked' THEN 'denied' ELSE 'allowed (preimage)' END);

-- ── 7. Grants and catalog shape of the state ─────────────────────────────────────────────────────────────────────
SELECT hierarchy_test.eq(hierarchy_test.acl('public.is_ancestor_of(uuid,uuid)'),
       CASE WHEN :'anon_revoked' THEN 'authenticated,postgres,service_role' ELSE 'PUBLIC,anon,authenticated,postgres,service_role' END,
       :'state' || ' grants: is_ancestor_of EXECUTE');
SELECT hierarchy_test.eq((SELECT string_agg(f || '=' || hierarchy_test.acl(f::regprocedure), ' ' ORDER BY f COLLATE "C")
                            FROM unnest(ARRAY['public.compute_hierarchy_path(uuid)', 'public.update_hierarchy_path()',
                                              'public.cascade_hierarchy_update()', 'public.on_profile_update()']) f),
       (SELECT string_agg(f || '=' || CASE WHEN :'compute_revoked' THEN 'postgres,service_role' ELSE 'PUBLIC,anon,authenticated,postgres,service_role' END, ' ' ORDER BY f COLLATE "C")
          FROM unnest(ARRAY['public.compute_hierarchy_path(uuid)', 'public.update_hierarchy_path()',
                            'public.cascade_hierarchy_update()', 'public.on_profile_update()']) f),
       :'state' || ' grants: compute_hierarchy_path and the hierarchy trigger functions');
SELECT hierarchy_test.eq((SELECT coalesce(array_to_string(proconfig, ';'), '-') FROM pg_proc WHERE oid = 'public.on_profile_update()'::regprocedure),
       CASE WHEN :'compute_revoked' THEN 'search_path=public, pg_temp' ELSE '-' END,
       :'state' || ' grants: on_profile_update search_path');
SELECT hierarchy_test.eq((SELECT count(DISTINCT d.objid) FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass
                            AND d.refobjid = 'public.is_ancestor_of(uuid,uuid)'::regprocedure),
       CASE WHEN :'m1' THEN 10::bigint ELSE 9::bigint END,
       :'state' || ' catalog: count(DISTINCT objid) of policies depending on is_ancestor_of');
SELECT hierarchy_test.eq((SELECT count(*) FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass
                            AND d.refobjid = 'public.is_ancestor_of(uuid,uuid)'::regprocedure),
       CASE WHEN :'m1' THEN 14::bigint ELSE 13::bigint END,
       :'state' || ' catalog: pg_depend rows (USING and WITH CHECK counted separately)');
SELECT hierarchy_test.eq((SELECT coalesce(string_agg(polname, ',' ORDER BY polname COLLATE "C"), '') FROM pg_policy WHERE NOT polpermissive),
       CASE WHEN :'m1' THEN 'calls_delete_own_rows_or_org_admin,clients_tl_delete_requires_contacts_permission,leads_tl_delete_requires_contacts_permission,recruits_tl_delete_requires_contacts_permission' ELSE '' END,
       :'state' || ' catalog: restrictive policies');
SELECT hierarchy_test.eq((SELECT (SELECT array_agg(CASE WHEN g = 0 THEN 'public' ELSE pg_get_userbyid(g) END) FROM unnest(polroles) g)::text
                            FROM pg_policy WHERE polname = 'tasks_select_team_leader'),
       CASE WHEN :'m1' THEN '{authenticated}' ELSE '{public}' END, :'state' || ' catalog: tasks_select_team_leader roles');
SELECT hierarchy_test.eq((SELECT string_agg(tgname, ',' ORDER BY tgname COLLATE "C") FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal),
       'on_profile_update_trigger,profiles_updated_at,trg_00_enforce_profile_field_authorization,'
       || CASE WHEN :'m1' THEN 'trg_01_guard_profile_commission_level,' ELSE '' END
       || 'trg_cascade_hierarchy_update,trg_update_hierarchy_path,' || CASE WHEN :'m2' THEN 'trg_update_hierarchy_path_lock,' ELSE '' END
       || 'trg_zz_platform_admin_notify_user_registered,uv_profile_deleted,uv_profile_saved',
       :'state' || ' catalog: profiles triggers');
SELECT hierarchy_test.eq((SELECT string_agg(tgname, ',' ORDER BY tgname COLLATE "C") FROM pg_trigger WHERE tgrelid = 'public.calls'::regclass AND NOT tgisinternal),
       CASE WHEN :'m1' THEN 'calls_00_guard_team_leader_downline_update,' ELSE '' END || 'calls_guard_dialer_core,calls_reporting_fields',
       :'state' || ' catalog: calls triggers');
SELECT hierarchy_test.eq(
  (SELECT row(to_regprocedure('private.build_hierarchy_path(uuid,uuid,uuid,boolean)') IS NOT NULL,
              to_regprocedure('private.hierarchy_consistency()') IS NOT NULL,
              to_regclass('public.idx_profiles_upline_id') IS NOT NULL,
              EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_invitation_upline'),
              to_regprocedure('profile_authz.actor_is_team_leader()') IS NOT NULL)::text),
  row(:'m2'::boolean, :'m2'::boolean, :'m2'::boolean, :'m2'::boolean, :'m1'::boolean)::text,
  :'state' || ' catalog: M1 / M2 objects present exactly in their states');
