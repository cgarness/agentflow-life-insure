-- =====================================================================================================
-- Hierarchy stabilization M3 — fingerprint-bound repair of the reviewed stale hierarchy paths
-- =====================================================================================================
-- Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md (rev 3) §6.3, §4, §9 (Gate 2c), D9.
-- Gate 1 (approved 2026-10-23) authorizes building and disposable-database testing ONLY. This file stays in
-- migrations/pending/ until Gate 2c, which needs Chris's separate explicit approval (#APPROVE_RLS_CHANGE plus the
-- invariant #28 checklist: exact approval of the stale set, read-only preflight re-measuring §4, bounded targets,
-- recovery plan). It runs only after M1 (Gate 2a), the frontend (Gate 3) and M2 (Gate 2b).
--
-- PRODUCTION DATA CHANGE when anything is stale: rewrites hierarchy_path of exactly the reviewed stale rows to the
-- canonical upline chain. This ACTIVATES Team Leader f809493e's downline authority (§4; bounded by M1).
--   * Refuses unless M1's and M2's post-images are live and the data has no self-parent, cross-org edge or
--     unreachable (cyclic) row.
--   * No stale row: a no-op (replays and CI).
--   * Otherwise TWO fingerprints of the stale set must both equal the reviewed ones (re-confirmed at Gate 2b/2c):
--       c_reviewed_fingerprint        md5(string_agg(id::text, ',' ORDER BY id)): the 4 rows 4ef505e0, 5f952f0d,
--                                     89f2e994, e5c4ee04 (measured read-only 2026-10-23);
--       c_reviewed_target_fingerprint md5(string_agg(id::text || '=' || canon.path::text, ',' ORDER BY id)), where
--                                     canon.path is exactly the value written below: this binds WHO gains ancestry
--                                     (the reviewed new parents f809493e / 86ca95f2 / f809493e / f809493e and the 6
--                                     ancestor pairs of plan §4; measured read-only 2026-10-23).
--     (Each constant appears exactly once in this file: the test harness substitutes the synthetic values.)
--     Any other set — including the reviewed rows re-parented to another upline before M3 (same ids, other targets) —
--     is refused for re-review. One NOTICE per repaired row (8-character id prefix, old and new depth, old and new
--     parent id prefix).
--   * Side effects per repaired row: the path trigger and the statement lock trigger fire and re-derive the
--     identical value (brief FOR SHARE on the ancestors); the cascade does not fire (upline_id is unchanged); one
--     updated_at bump; on_profile_update → 2 unchanged-value set_claim writes. No session, realtime, UV or
--     notification effect. A lock timeout is a retryable failure.
--   * Postconditions: 0 stale, 0 NULL, 0 missing and 0 extra ancestor pairs; a second run updates 0 rows.
--
-- Unchanged: every function, trigger, policy and grant; upline_id, role, status and every other column.
-- Rollback: NONE automatic — supabase/migrations/rollback/20261023210200_hierarchy_path_repair.rollback.sql is a
-- refusal stub documenting the operational revocation path (plan §10).
-- Proof: scripts/run_hierarchy_stabilization_tests.sh (runs a copy with the synthetic fixture's two fingerprints
-- substituted; the unmodified file, a copy with only the id fingerprint substituted, and the substituted copy on a
-- re-parented stale set must all refuse).
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, pg_temp;

DO $repair$
DECLARE
  c_reviewed_fingerprint        CONSTANT text := 'ddc1f53f3823c6e367310a748ea0ac85';
  c_reviewed_target_fingerprint CONSTANT text := '7daae418571600b43b7cf5d5155be0d4';
  v_old_sp  text := pg_catalog.current_setting('search_path');
  r         record;
  v         text;
  v_stale   bigint;
  v_fp      text;
  v_tfp     text;
  v_updated bigint;
BEGIN
  -- ── Preconditions: the reviewed M1 and M2 post-images ─────────────────────────────────────────────────────────
  PERFORM pg_catalog.set_config('search_path', '"$user", public, extensions', true);
  FOR r IN SELECT * FROM (VALUES
      ('public.is_ancestor_of(uuid,uuid)', 'c6d121db50b7ea2e37ce4a620cc855af'),
      ('profile_authz.actor_is_team_leader()', 'bbc07ccb69be5c0eed098e17bd9d191d'),
      ('profile_authz.actor_is_org_admin(uuid)', 'c64ef188736fae1b90dc7e6a8d29e04f'),
      ('private.guard_profile_commission_level()', 'cc306236935837d49ff89540bb8dff89'),
      ('private.guard_team_leader_downline_call_update()', '454ee627b8df12d5e7f9acc6d526288e'),
      ('private.guard_contact_organization_change()', 'dc72173fb9d9c786a63af8ed193f5ef6'),
      ('private.build_hierarchy_path(uuid,uuid,uuid,boolean)', 'fecfc2995febeb119f0bc5b862e16500'),
      ('public.compute_hierarchy_path(uuid)', '058bb6b37b152aec062c87f8ac929425'),
      ('private.lock_profile_hierarchy()', '559344d1b35aafaa3567405269b34989'),
      ('public.update_hierarchy_path()', 'f892eb620cdf4d146a112e5b66783d6b'),
      ('public.cascade_hierarchy_update()', 'e26ddd18e96bffec29d440280176ca2a'),
      ('private.hierarchy_consistency()', 'e1984a07ba5c76004d5f9290d49f2834'),
      ('public.enforce_profile_field_authorization()', 'b9b4c345b470c94923cddace49cd1d5b')) x(fn, digest)
  LOOP
    IF pg_catalog.to_regprocedure(r.fn) IS NULL
       OR md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(r.fn))) <> r.digest THEN
      RAISE EXCEPTION 'hierarchy M3 refused: % is not the reviewed M1/M2 post-image', r.fn;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.profiles', 'trg_01_guard_profile_commission_level', 'a85d3c1edb2ce795b391b780de7bc413'),
      ('public.calls', 'calls_00_guard_team_leader_downline_update', 'ae888acb2d2139410e346827ec999c65'),
      ('public.profiles', 'trg_update_hierarchy_path', '41c39a180f8715ab543c6a02af00eaf3'),
      ('public.profiles', 'trg_cascade_hierarchy_update', '9540c1a57f6878f9e1b625840c261085'),
      ('public.profiles', 'trg_update_hierarchy_path_lock', '69081184456094326ffbd0b34942e7c1'),
      ('public.profiles', 'trg_00_enforce_profile_field_authorization', 'fc02958ebc6986a60bda53127323bb7c'),
      ('public.leads', 'contacts_00_guard_organization_change', 'e04378078c3e0f31b889a559acfc4519'),
      ('public.clients', 'contacts_00_guard_organization_change', '4566b07550a98655bd381f9626738767'),
      ('public.recruits', 'contacts_00_guard_organization_change', '387528f7702e1a276a0bbee1e64e62ab')) x(tbl, name, digest)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                    WHERE t.tgrelid = r.tbl::regclass AND t.tgname = r.name AND t.tgenabled = 'O'
                      AND md5(pg_catalog.pg_get_triggerdef(t.oid)) = r.digest) THEN
      RAISE EXCEPTION 'hierarchy M3 refused: trigger % on % is not the reviewed M1/M2 post-image', r.name, r.tbl;
    END IF;
  END LOOP;
  SELECT string_agg(pol.polname, ',' ORDER BY pol.polname COLLATE "C") INTO v
    FROM pg_catalog.pg_policy pol
   WHERE NOT pol.polpermissive AND pol.polcmd = 'd' AND pol.polroles = ARRAY['authenticated'::regrole::oid]
     AND pol.polrelid IN ('public.leads'::regclass, 'public.clients'::regclass,
                          'public.recruits'::regclass, 'public.calls'::regclass);
  IF v IS DISTINCT FROM 'calls_delete_own_rows_or_org_admin,clients_tl_delete_requires_contacts_permission,'
                        'leads_tl_delete_requires_contacts_permission,recruits_tl_delete_requires_contacts_permission' THEN
    RAISE EXCEPTION 'hierarchy M3 refused: the 4 M1 restrictive DELETE policies are not live (found %)', v;
  END IF;
  PERFORM pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', true);

  -- ── Preconditions: data invariants ───────────────────────────────────────────────────────────────────────────
  SELECT * INTO r FROM private.hierarchy_consistency();
  IF r.self_parents <> 0 OR r.cross_org_edges <> 0 OR r.unreachable <> 0 THEN
    RAISE EXCEPTION 'hierarchy M3 refused: self_parents=%, cross_org_edges=%, unreachable=%',
      r.self_parents, r.cross_org_edges, r.unreachable;
  END IF;

  -- ── The stale set: none → no-op; otherwise exactly the reviewed rows AND the reviewed target paths ────────────
  WITH RECURSIVE canon(id, path, visited) AS (
    SELECT p.id, public.text2ltree(replace(p.id::text, '-', '_')), ARRAY[p.id]
      FROM public.profiles p WHERE p.upline_id IS NULL
    UNION ALL
    SELECT c.id, k.path || public.text2ltree(replace(c.id::text, '-', '_')), k.visited || c.id
      FROM canon k JOIN public.profiles c ON c.upline_id = k.id WHERE c.id <> ALL (k.visited))
  SELECT count(*), md5(string_agg(p.id::text, ',' ORDER BY p.id)),
         md5(string_agg(p.id::text || '=' || c.path::text, ',' ORDER BY p.id))
    INTO v_stale, v_fp, v_tfp
    FROM public.profiles p JOIN canon c ON c.id = p.id
   WHERE p.hierarchy_path IS DISTINCT FROM c.path;

  IF v_stale = 0 THEN
    RAISE NOTICE 'hierarchy M3: no stale hierarchy path; nothing to repair (no-op)';
  ELSE
    IF v_fp IS DISTINCT FROM c_reviewed_fingerprint THEN
      RAISE EXCEPTION 'hierarchy M3 refused: the % stale row(s) are not the reviewed set (fingerprint %); re-review before repairing',
        v_stale, v_fp;
    END IF;
    IF v_tfp IS DISTINCT FROM c_reviewed_target_fingerprint THEN
      RAISE EXCEPTION 'hierarchy M3 refused: the % stale row(s) would be repaired to paths that are not the reviewed targets (target fingerprint %); re-review before repairing',
        v_stale, v_tfp;
    END IF;

    FOR r IN
      WITH RECURSIVE canon(id, path, visited) AS (
        SELECT p.id, public.text2ltree(replace(p.id::text, '-', '_')), ARRAY[p.id]
          FROM public.profiles p WHERE p.upline_id IS NULL
        UNION ALL
        SELECT c.id, k.path || public.text2ltree(replace(c.id::text, '-', '_')), k.visited || c.id
          FROM canon k JOIN public.profiles c ON c.upline_id = k.id WHERE c.id <> ALL (k.visited))
      SELECT left(p.id::text, 8) AS id8, public.nlevel(p.hierarchy_path) AS old_depth, public.nlevel(c.path) AS new_depth,
             CASE WHEN public.nlevel(p.hierarchy_path) > 1 THEN left(public.subpath(p.hierarchy_path, -2, 1)::text, 8) ELSE 'none' END AS old_parent8,
             CASE WHEN public.nlevel(c.path) > 1 THEN left(public.subpath(c.path, -2, 1)::text, 8) ELSE 'none' END AS new_parent8
        FROM public.profiles p JOIN canon c ON c.id = p.id
       WHERE p.hierarchy_path IS DISTINCT FROM c.path
       ORDER BY p.id
    LOOP
      RAISE NOTICE 'hierarchy M3 repair %: depth % -> %, parent % -> %', r.id8, r.old_depth, r.new_depth, r.old_parent8, r.new_parent8;
    END LOOP;

    WITH RECURSIVE canon(id, path, visited) AS (
      SELECT p.id, public.text2ltree(replace(p.id::text, '-', '_')), ARRAY[p.id]
        FROM public.profiles p WHERE p.upline_id IS NULL
      UNION ALL
      SELECT c.id, k.path || public.text2ltree(replace(c.id::text, '-', '_')), k.visited || c.id
        FROM canon k JOIN public.profiles c ON c.upline_id = k.id WHERE c.id <> ALL (k.visited))
    UPDATE public.profiles p
       SET hierarchy_path = canon.path
      FROM canon
     WHERE p.id = canon.id
       AND p.hierarchy_path IS DISTINCT FROM canon.path;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> v_stale THEN
      RAISE EXCEPTION 'hierarchy M3 failed: repaired % row(s), expected %', v_updated, v_stale;
    END IF;
  END IF;

  -- ── Postconditions: every stored path canonical; ancestor pairs equal the upline walk ───────────────────────
  SELECT * INTO r FROM private.hierarchy_consistency();
  IF r.stale_paths <> 0 OR r.null_paths <> 0 OR r.missing_pairs <> 0 OR r.extra_pairs <> 0
     OR r.path_pairs <> r.expected_pairs THEN
    RAISE EXCEPTION 'hierarchy M3 postcondition failed: stale=%, null=%, missing=%, extra=%, pairs=%/%',
      r.stale_paths, r.null_paths, r.missing_pairs, r.extra_pairs, r.path_pairs, r.expected_pairs;
  END IF;
  RAISE NOTICE 'hierarchy M3: % row(s) repaired; % of % expected ancestor pairs present', coalesce(v_updated, 0),
    r.path_pairs, r.expected_pairs;

  PERFORM pg_catalog.set_config('search_path', v_old_sp, true);
END $repair$;
