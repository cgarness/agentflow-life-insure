-- =====================================================================================================
-- Hierarchy stabilization M2 — upline_id is authoritative; the database keeps hierarchy_path derived and valid
-- =====================================================================================================
-- Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md (rev 3) §6.2, §7, D1, D8, D10–D12, R2.
-- Gate 1 (approved 2026-10-23) authorizes building and disposable-database testing ONLY. This file stays in
-- migrations/pending/ (outside the CLI glob) until Gate 2b, which needs Chris's separate explicit approval and
-- comes AFTER M1 (Gate 2a) and the frontend release (Gate 3). It refuses to run unless M1's post-image is live.
--
-- No row is written and no access changes at apply time (the $post$ probe below rolls itself back). Afterwards:
--   * private.build_hierarchy_path(p_self, p_upline, p_org, p_lock) walks from the INCOMING upline (never the
--     stored row): rejects a self/descendant upline (cycle), an existing loop above, a chain deeper than 32 levels,
--     a missing upline (23503) and any ancestor in another organization (23514). p_lock takes FOR SHARE on each
--     ancestor so a concurrent READ COMMITTED move cannot interleave (see the lock trigger below for why only READ
--     COMMITTED is accepted). The 32-level cap (plan §3 said 100) keeps every path inside
--     what the GiST ltree index idx_profiles_hierarchy_path handles: with 36-character uuid labels its keys
--     degenerate beyond ~60 levels (measured on PostgreSQL 16: a 70-level insert hits "stack depth limit exceeded"
--     after bloating the index by hundreds of MB). Production's longest chain is 3; the preimage silently
--     truncated at 20. Traversal caps of 100 (resolve_downline_ids, getAgentScopeIds) remain supersets.
--   * public.compute_hierarchy_path(uuid) — same signature and output format; delegates to the builder.
--   * public.update_hierarchy_path() — self-parent rejected; an UPDATE that leaves upline_id, organization_id and
--     hierarchy_path unchanged returns immediately (a no-op save changes nothing and heals nothing); an org change
--     that would strand direct reports is rejected; otherwise the path is re-derived (any direct path write, even
--     by a system caller, is overwritten with the canonical value). Trigger now fires on INSERT OR UPDATE OF
--     upline_id, organization_id, hierarchy_path.
--   * public.cascade_hierarchy_update() — one set-based statement re-derives the moved row's whole subtree,
--     writing only rows that differ; trigger fires only WHEN the upline really changed.
--   * trg_update_hierarchy_path_lock — statement-level transaction advisory lock: every statement that lists a
--     hierarchy column serializes on one key (D11). READ COMMITTED only: such a statement in a REPEATABLE READ or
--     SERIALIZABLE transaction is refused (0A000) before the lock is taken, because its snapshot predates the lock and
--     the cascade / org-change checks would read an old subtree (a concurrent insert or move-in would be missed,
--     leaving a stale fail-open path or a cross-organization edge). PostgREST, GoTrue and the Supabase SQL paths run
--     at the database default, READ COMMITTED (production, read-only 2026-10-23: default_transaction_isolation
--     'read committed' from the built-in default, no role / database / function isolation override).
--   * trg_validate_invitation_upline — an invitation's upline must be an Active member of the invitation's
--     organization, checked when the invitation is created and when its upline_id or organization_id changes (D8).
--     It is a creation / upline-change rule only: accepting or releasing an invitation re-checks nothing, so a
--     member accepted after their upline was deactivated is placed under that (inert, M1) upline, and one whose upline
--     changed organization fails acceptance (cross-org builder error) until the invitation is revoked.
--   * idx_profiles_upline_id (D12); private.hierarchy_consistency() (path-based, postgres only).
--   * Hygiene (D10): on_profile_update loses client EXECUTE and gets a pinned search_path (body unchanged).
--     compute_hierarchy_path, update_hierarchy_path and cascade_hierarchy_update were already revoked by M1.
-- Documented behaviour changes: a multi-row INSERT that lists a child before its parent is rejected; a multi-row
-- UPDATE of upline_id validates each row against the statement's intermediate state (the rows already processed,
-- in physical order), so an interdependent re-parenting may be rejected as a cycle even when its final state is
-- valid — apply such moves as separate statements in dependency order; hierarchy statements (any profiles INSERT, or
-- an UPDATE listing upline_id, organization_id or hierarchy_path) must run at READ COMMITTED;
-- provision_organization on a founder who already has an upline is rejected; error messages start with
-- "Hierarchy:" and never echo organization ids.
-- ⚠ From this migration on, every real upline change and every accepted invitation derives a correct path, so a
-- real move in an inactive Team Leader branch activates that branch before M3 (interim guidance D14).
--
-- Unchanged: is_ancestor_of and every M1 object, enforce_profile_field_authorization (its compute_hierarchy_path
-- comparison still holds because the cascade writes exactly what compute returns), on_profile_update's body, the
-- other profiles triggers, every policy, every grant not named above, all data.
--
-- Guards: M1 post-image required; each replaced or hardened object must be its reviewed preimage or the exact
-- state this file's rollback leaves; anything else — including a replay — is refused.
-- Rollback: supabase/migrations/rollback/20261023210100_hierarchy_integrity.rollback.sql
-- Proof:    scripts/run_hierarchy_stabilization_tests.sh (disposable local PostgreSQL only).
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, pg_temp;

-- ── 0. M1 prerequisite, preimage / post-rollback state, drift and replay guard ───────────────────────────────────
DO $guard$
DECLARE
  v_old_sp text := pg_catalog.current_setting('search_path');
  r        record;
  v_md5    text;
  v_acl    text;
BEGIN
  PERFORM pg_catalog.set_config('search_path', '"$user", public, extensions', true);

  -- M1 must be live (R2: authorization boundaries before any path can activate hierarchy authority).
  IF pg_catalog.to_regprocedure('public.is_ancestor_of(uuid,uuid)') IS NULL
     OR md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.is_ancestor_of(uuid,uuid)'))) IS DISTINCT FROM 'c6d121db50b7ea2e37ce4a620cc855af'
     OR pg_catalog.to_regprocedure('profile_authz.actor_is_team_leader()') IS NULL
     OR md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('profile_authz.actor_is_team_leader()'))) IS DISTINCT FROM 'bbc07ccb69be5c0eed098e17bd9d191d'
     OR pg_catalog.to_regprocedure('profile_authz.actor_is_org_admin(uuid)') IS NULL
     OR md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('profile_authz.actor_is_org_admin(uuid)'))) IS DISTINCT FROM 'c64ef188736fae1b90dc7e6a8d29e04f'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                     WHERE t.tgrelid = 'public.profiles'::regclass AND t.tgname = 'trg_01_guard_profile_commission_level'
                       AND t.tgenabled = 'O' AND md5(pg_catalog.pg_get_triggerdef(t.oid)) = 'a85d3c1edb2ce795b391b780de7bc413')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                     WHERE t.tgrelid = 'public.calls'::regclass AND t.tgname = 'calls_00_guard_team_leader_downline_update'
                       AND t.tgenabled = 'O' AND md5(pg_catalog.pg_get_triggerdef(t.oid)) = 'ae888acb2d2139410e346827ec999c65')
     OR (SELECT count(*) FROM pg_catalog.pg_policy pol
          WHERE NOT pol.polpermissive
            AND pol.polname IN ('leads_tl_delete_requires_contacts_permission', 'clients_tl_delete_requires_contacts_permission',
                                'recruits_tl_delete_requires_contacts_permission', 'calls_delete_own_rows_or_org_admin')) <> 4 THEN
    RAISE EXCEPTION 'hierarchy M2 refused: M1 (20261023210000 hierarchy_authorization_boundaries) is not applied as reviewed';
  END IF;

  -- Replaced or hardened functions: (body, EXECUTE grantees) must be the preimage or the post-rollback state. M1
  -- already revoked client EXECUTE on the three path functions, so for them the preimage state and this file's
  -- post-rollback state are the same (preimage body, postgres,service_role); on_profile_update is hardened here.
  FOR r IN SELECT * FROM (VALUES
      ('public.compute_hierarchy_path(uuid)', 'b9aaa16d5b974676ce18d55c5dce9e18', 'postgres,service_role', 'b9aaa16d5b974676ce18d55c5dce9e18'),
      ('public.update_hierarchy_path()', 'd9ff2d22fcc0bd5e55ea288850ad1cfe', 'postgres,service_role', 'd9ff2d22fcc0bd5e55ea288850ad1cfe'),
      ('public.cascade_hierarchy_update()', '8392e93e9b09f726dcb097cb54dae522', 'postgres,service_role', '8392e93e9b09f726dcb097cb54dae522'),
      ('public.on_profile_update()', 'b44d4c7ddc97d62d2cc9a3b22a8fc057', 'PUBLIC,anon,authenticated,postgres,service_role',
       '0afa0358aca12d396b9ae50c292bca6f')) x(fn, preimage, preimage_acl, rolled_back)
  LOOP
    IF pg_catalog.to_regprocedure(r.fn) IS NULL THEN
      RAISE EXCEPTION 'hierarchy M2 refused: % not found', r.fn;
    END IF;
    v_md5 := md5(pg_catalog.pg_get_functiondef(r.fn::regprocedure));
    SELECT string_agg(g, ',' ORDER BY g COLLATE "C") INTO v_acl
      FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS g
              FROM pg_catalog.pg_proc f,
                   pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
             WHERE f.oid = r.fn::regprocedure AND a.privilege_type = 'EXECUTE') s;
    IF NOT ((v_md5 = r.preimage AND v_acl = r.preimage_acl)
            OR (v_md5 = r.rolled_back AND v_acl = 'postgres,service_role'))
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f
                       WHERE f.oid = r.fn::regprocedure AND f.proowner = 'postgres'::regrole AND f.prosecdef) THEN
      RAISE EXCEPTION 'hierarchy M2 refused: % differs from the reviewed preimage (already applied or drifted)', r.fn;
    END IF;
  END LOOP;
  IF md5(pg_catalog.pg_get_functiondef('public.enforce_profile_field_authorization()'::regprocedure)) <> 'b9b4c345b470c94923cddace49cd1d5b' THEN
    RAISE EXCEPTION 'hierarchy M2 refused: public.enforce_profile_field_authorization() differs from the reviewed preimage';
  END IF;

  -- profiles triggers: exactly production's 8 plus M1's trg_01, the two replaced ones at their preimage.
  IF (SELECT array_agg(t.tgname::text ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal)
     IS DISTINCT FROM ARRAY['on_profile_update_trigger', 'profiles_updated_at', 'trg_00_enforce_profile_field_authorization',
                            'trg_01_guard_profile_commission_level', 'trg_cascade_hierarchy_update', 'trg_update_hierarchy_path',
                            'trg_zz_platform_admin_notify_user_registered', 'uv_profile_deleted', 'uv_profile_saved'] THEN
    RAISE EXCEPTION 'hierarchy M2 refused: the profiles trigger set differs from the reviewed one';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('trg_update_hierarchy_path', '800fa050d8f940e783b14569fd01faef'),
      ('trg_cascade_hierarchy_update', '869f33cd50c475f78bb754fa9aa8efdd'),
      ('trg_00_enforce_profile_field_authorization', 'fc02958ebc6986a60bda53127323bb7c'),
      ('profiles_updated_at', '8dc89bf1e11c8e19fc11aaaa220640a1'),
      ('on_profile_update_trigger', '3a263cfd07d006faf8ee054842f785a7')) x(name, digest)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                    WHERE t.tgrelid = 'public.profiles'::regclass AND t.tgname = r.name AND t.tgenabled = 'O'
                      AND md5(pg_catalog.pg_get_triggerdef(t.oid)) = r.digest) THEN
      RAISE EXCEPTION 'hierarchy M2 refused: trigger % differs from the reviewed preimage (already applied or drifted)', r.name;
    END IF;
  END LOOP;

  -- Nothing this file creates may exist; invitations has no triggers today.
  IF pg_catalog.to_regprocedure('private.build_hierarchy_path(uuid,uuid,uuid,boolean)') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.lock_profile_hierarchy()') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.validate_invitation_upline()') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.hierarchy_consistency()') IS NOT NULL
     OR pg_catalog.to_regclass('public.idx_profiles_upline_id') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                 WHERE t.tgrelid = 'public.invitations'::regclass AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'hierarchy M2 refused: an object this migration creates already exists (already applied?)';
  END IF;

  -- The new functions run with search_path pg_catalog, public, pg_temp (ltree's operators live in public): that is
  -- only safe while ltree is in public and no client role can create objects there.
  IF (SELECT n.nspname FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname = 'ltree') IS DISTINCT FROM 'public'
     OR pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')
     OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
     OR pg_catalog.has_schema_privilege('anon', 'private', 'USAGE')
     OR pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'hierarchy M2 refused: ltree location or public/private schema privileges differ from the reviewed state';
  END IF;

  PERFORM pg_catalog.set_config('search_path', v_old_sp, true);
END $guard$;

-- ── 1. The path builder ──────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION private.build_hierarchy_path(p_self uuid, p_upline uuid, p_org uuid, p_lock boolean DEFAULT false)
RETURNS public.ltree
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_labels  text[] := ARRAY[replace(p_self::text, '-', '_')];
  v_visited uuid[] := ARRAY[p_self];
  v_cur     uuid   := p_upline;
  v_next    uuid;
  v_org     uuid;
BEGIN
  IF p_self IS NULL THEN
    RAISE EXCEPTION 'Hierarchy: a profile id is required' USING ERRCODE = '22004';
  END IF;
  WHILE v_cur IS NOT NULL LOOP
    IF v_cur = p_self THEN
      RAISE EXCEPTION 'Hierarchy: this upline would create a reporting cycle (a member cannot report to their own downline)'
        USING ERRCODE = '23514';
    END IF;
    IF v_cur = ANY (v_visited) THEN
      RAISE EXCEPTION 'Hierarchy: the upline chain above this member already contains a cycle' USING ERRCODE = '23514';
    END IF;
    IF cardinality(v_visited) >= 32 THEN
      RAISE EXCEPTION 'Hierarchy: the upline chain is deeper than 32 levels' USING ERRCODE = '23514';
    END IF;
    IF p_lock THEN
      SELECT p.upline_id, p.organization_id INTO v_next, v_org
        FROM public.profiles p WHERE p.id = v_cur FOR SHARE;
    ELSE
      SELECT p.upline_id, p.organization_id INTO v_next, v_org
        FROM public.profiles p WHERE p.id = v_cur;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Hierarchy: the selected upline does not exist' USING ERRCODE = '23503';
    END IF;
    IF v_org IS DISTINCT FROM p_org THEN
      RAISE EXCEPTION 'Hierarchy: an upline must belong to the same organization' USING ERRCODE = '23514';
    END IF;
    v_labels  := replace(v_cur::text, '-', '_') || v_labels;
    v_visited := v_visited || v_cur;
    v_cur     := v_next;
  END LOOP;
  RETURN public.text2ltree(array_to_string(v_labels, '.'));
END
$$;

-- ── 2. compute_hierarchy_path: same signature and output; reads the stored row, never locks ──────────────────────
CREATE OR REPLACE FUNCTION public.compute_hierarchy_path(target_user_id uuid)
RETURNS public.ltree
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_upline uuid;
  v_org    uuid;
BEGIN
  SELECT p.upline_id, p.organization_id INTO v_upline, v_org FROM public.profiles p WHERE p.id = target_user_id;
  IF NOT FOUND THEN
    RETURN public.text2ltree(replace(target_user_id::text, '-', '_'));
  END IF;
  RETURN private.build_hierarchy_path(target_user_id, v_upline, v_org);
END
$$;

-- ── 5. Statement-level hierarchy lock (D11), READ COMMITTED only ────────────────────────────────────────────────
CREATE FUNCTION private.lock_profile_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Under REPEATABLE READ / SERIALIZABLE the transaction snapshot predates this lock, so the subtree and org checks
  -- would read stale rows. 0A000, not 40001: a client retry at the same isolation level could never succeed.
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Hierarchy: upline and organization changes must run in a READ COMMITTED transaction'
      USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agentflow.public.profiles.hierarchy', 0));
  RETURN NULL;
END
$$;

-- ── 3. Row trigger: derive from the incoming row; no-op saves change nothing ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_hierarchy_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.upline_id IS NOT NULL AND NEW.upline_id = NEW.id THEN
    RAISE EXCEPTION 'Hierarchy: a member cannot be their own upline' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.upline_id IS NOT DISTINCT FROM OLD.upline_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.hierarchy_path IS NOT DISTINCT FROM OLD.hierarchy_path THEN
    RETURN NEW;                                   -- no-op save: change nothing, heal nothing
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.organization_id IS DISTINCT FROM OLD.organization_id
     AND EXISTS (SELECT 1 FROM public.profiles c
                  WHERE c.upline_id = NEW.id AND c.id <> NEW.id
                    AND c.organization_id IS DISTINCT FROM NEW.organization_id) THEN
    RAISE EXCEPTION 'Hierarchy: reassign this member''s direct reports before moving them to another organization'
      USING ERRCODE = '23514';
  END IF;

  NEW.hierarchy_path := private.build_hierarchy_path(NEW.id, NEW.upline_id, NEW.organization_id, true);
  RETURN NEW;
END
$$;

-- ── 4. Subtree refresh after a real upline change: one set-based statement, only differing rows ──────────────────
CREATE OR REPLACE FUNCTION public.cascade_hierarchy_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  WITH RECURSIVE subtree(id, path, visited) AS (
    SELECT p.id, public.compute_hierarchy_path(p.id), ARRAY[p.id]
      FROM public.profiles p
     WHERE p.id = NEW.id
    UNION ALL
    SELECT c.id, s.path || public.text2ltree(replace(c.id::text, '-', '_')), s.visited || c.id
      FROM subtree s
      JOIN public.profiles c ON c.upline_id = s.id
     WHERE c.id <> ALL (s.visited)
       AND cardinality(s.visited) < 32
  )
  UPDATE public.profiles p
     SET hierarchy_path = s.path
    FROM subtree s
   WHERE p.id = s.id
     AND p.hierarchy_path IS DISTINCT FROM s.path;
  RETURN NULL;
END
$$;

-- ── 6. Invitation upline guard (D8) ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION private.validate_invitation_upline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org    uuid;
  v_status text;
BEGIN
  IF NEW.upline_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- UPDATE OF fires whenever a column is listed: re-validate only a real upline or organization change.
  IF TG_OP = 'UPDATE'
     AND NEW.upline_id IS NOT DISTINCT FROM OLD.upline_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    RETURN NEW;
  END IF;
  SELECT p.organization_id, p.status INTO v_org, v_status FROM public.profiles p WHERE p.id = NEW.upline_id;
  IF NOT FOUND OR v_org IS DISTINCT FROM NEW.organization_id OR v_status IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'Hierarchy: an invitation''s upline must be an active member of the same organization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

-- ── 8. Path-based consistency report (postgres only; not is_ancestor_of, so D2/D3 cannot distort it) ─────────────
CREATE FUNCTION private.hierarchy_consistency()
RETURNS TABLE (profiles bigint, edges bigint, expected_pairs bigint, path_pairs bigint, missing_pairs bigint,
               extra_pairs bigint, stale_paths bigint, null_paths bigint, self_parents bigint, cross_org_edges bigint,
               unreachable bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH RECURSIVE
  anc(descendant_id, ancestor_id, visited) AS (
    SELECT p.id, p.upline_id, ARRAY[p.id] FROM public.profiles p
     WHERE p.upline_id IS NOT NULL AND p.upline_id <> p.id
    UNION ALL
    SELECT a.descendant_id, p.upline_id, a.visited || a.ancestor_id
      FROM anc a JOIN public.profiles p ON p.id = a.ancestor_id
     WHERE p.upline_id IS NOT NULL AND p.upline_id <> ALL (a.visited || a.ancestor_id)
  ),
  expected AS (SELECT DISTINCT ancestor_id, descendant_id FROM anc),
  actual AS (
    SELECT a.id AS ancestor_id, d.id AS descendant_id
      FROM public.profiles a JOIN public.profiles d ON d.id <> a.id
     WHERE d.hierarchy_path OPERATOR(public.<@) a.hierarchy_path
  ),
  canon(id, path, visited) AS (
    SELECT p.id, public.text2ltree(replace(p.id::text, '-', '_')), ARRAY[p.id]
      FROM public.profiles p WHERE p.upline_id IS NULL
    UNION ALL
    SELECT c.id, k.path OPERATOR(public.||) public.text2ltree(replace(c.id::text, '-', '_')), k.visited || c.id
      FROM canon k JOIN public.profiles c ON c.upline_id = k.id
     WHERE c.id <> ALL (k.visited)
  )
  SELECT
    (SELECT count(*) FROM public.profiles),
    (SELECT count(*) FROM public.profiles WHERE upline_id IS NOT NULL),
    (SELECT count(*) FROM expected),
    (SELECT count(*) FROM actual),
    (SELECT count(*) FROM (SELECT * FROM expected EXCEPT SELECT * FROM actual) m),
    (SELECT count(*) FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) x),
    (SELECT count(*) FROM public.profiles p JOIN canon c ON c.id = p.id
      WHERE p.hierarchy_path::text IS DISTINCT FROM c.path::text),
    (SELECT count(*) FROM public.profiles WHERE hierarchy_path IS NULL),
    (SELECT count(*) FROM public.profiles WHERE upline_id = id),
    (SELECT count(*) FROM public.profiles c JOIN public.profiles u ON u.id = c.upline_id
      WHERE c.organization_id IS DISTINCT FROM u.organization_id),
    (SELECT count(*) FROM public.profiles p WHERE NOT EXISTS (SELECT 1 FROM canon c WHERE c.id = p.id));
$$;

COMMENT ON FUNCTION private.build_hierarchy_path(uuid, uuid, uuid, boolean) IS
  'Hierarchy M2: the canonical root-first path for p_self under the INCOMING upline p_upline; rejects cycles, loops, depth > 32, missing and cross-organization uplines. p_lock = FOR SHARE on each ancestor.';
COMMENT ON FUNCTION private.lock_profile_hierarchy() IS
  'Hierarchy M2 (D11): statement-level transaction advisory lock serializing every statement that lists a hierarchy column; refuses (0A000) outside READ COMMITTED.';
COMMENT ON FUNCTION private.validate_invitation_upline() IS
  'Hierarchy M2 (D8): an invitation''s upline must be an Active member of the invitation''s organization when the invitation is created or its upline/org changes (acceptance re-checks nothing).';
COMMENT ON FUNCTION private.hierarchy_consistency() IS
  'Hierarchy M2: path-based consistency report (expected upline-walk pairs vs stored-path containment, stale and NULL paths, self-parents, cross-org edges, unreachable rows).';

-- ── 9. Grants and hygiene (D10). Triggers fire without EXECUTE. ─────────────────────────────────────────────────
REVOKE ALL ON FUNCTION private.build_hierarchy_path(uuid, uuid, uuid, boolean), private.lock_profile_hierarchy(),
                       private.validate_invitation_upline(), private.hierarchy_consistency()
  FROM PUBLIC, anon, authenticated, service_role;
-- compute_hierarchy_path, update_hierarchy_path and cascade_hierarchy_update: already revoked by M1 (guarded above).
REVOKE EXECUTE ON FUNCTION public.on_profile_update() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.on_profile_update() SET search_path = public, pg_temp;

-- ── 3–6. Trigger DDL and the index, after every function exists (short ShareRowExclusive / Share locks) ──────────
CREATE OR REPLACE TRIGGER trg_update_hierarchy_path
  BEFORE INSERT OR UPDATE OF upline_id, organization_id, hierarchy_path ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_hierarchy_path();
CREATE OR REPLACE TRIGGER trg_cascade_hierarchy_update
  AFTER UPDATE OF upline_id ON public.profiles
  FOR EACH ROW WHEN (OLD.upline_id IS DISTINCT FROM NEW.upline_id)
  EXECUTE FUNCTION public.cascade_hierarchy_update();
CREATE TRIGGER trg_update_hierarchy_path_lock
  BEFORE INSERT OR UPDATE OF upline_id, organization_id, hierarchy_path ON public.profiles
  FOR EACH STATEMENT EXECUTE FUNCTION private.lock_profile_hierarchy();
CREATE TRIGGER trg_validate_invitation_upline
  BEFORE INSERT OR UPDATE OF upline_id, organization_id ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION private.validate_invitation_upline();
CREATE INDEX idx_profiles_upline_id ON public.profiles USING btree (upline_id) WHERE upline_id IS NOT NULL;

-- ── 10. Postconditions, including a probe that FIRES the triggers and rolls itself back ─────────────────────────
DO $post$
DECLARE
  v_old_sp text := pg_catalog.current_setting('search_path');
  r        record;
  v        text;
  v_id     uuid;
  v_before public.ltree;
  v_after  public.ltree;
BEGIN
  PERFORM pg_catalog.set_config('search_path', '"$user", public, extensions', true);

  FOR r IN SELECT * FROM (VALUES
      ('private.build_hierarchy_path(uuid,uuid,uuid,boolean)', 'fecfc2995febeb119f0bc5b862e16500', 'postgres'),
      ('public.compute_hierarchy_path(uuid)', '058bb6b37b152aec062c87f8ac929425', 'postgres,service_role'),
      ('private.lock_profile_hierarchy()', '559344d1b35aafaa3567405269b34989', 'postgres'),
      ('public.update_hierarchy_path()', 'f892eb620cdf4d146a112e5b66783d6b', 'postgres,service_role'),
      ('public.cascade_hierarchy_update()', 'e26ddd18e96bffec29d440280176ca2a', 'postgres,service_role'),
      ('private.validate_invitation_upline()', '76f71d54f2ff396080616581f442c87c', 'postgres'),
      ('private.hierarchy_consistency()', 'e1984a07ba5c76004d5f9290d49f2834', 'postgres'),
      ('public.on_profile_update()', '0afa0358aca12d396b9ae50c292bca6f', 'postgres,service_role'),
      ('public.enforce_profile_field_authorization()', 'b9b4c345b470c94923cddace49cd1d5b', 'postgres,service_role'),
      ('public.is_ancestor_of(uuid,uuid)', 'c6d121db50b7ea2e37ce4a620cc855af', 'authenticated,postgres,service_role')) x(fn, digest, acl)
  LOOP
    SELECT string_agg(g, ',' ORDER BY g COLLATE "C") INTO v
      FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS g
              FROM pg_catalog.pg_proc f,
                   pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
             WHERE f.oid = r.fn::regprocedure AND a.privilege_type = 'EXECUTE') s;
    IF md5(pg_catalog.pg_get_functiondef(r.fn::regprocedure)) <> r.digest OR v IS DISTINCT FROM r.acl
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f
                       WHERE f.oid = r.fn::regprocedure AND f.proowner = 'postgres'::regrole AND f.prosecdef) THEN
      RAISE EXCEPTION 'hierarchy M2 postcondition failed: % (body, owner, definer flag or ACL %)', r.fn, v;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
      ('public.profiles', 'trg_update_hierarchy_path', '41c39a180f8715ab543c6a02af00eaf3'),
      ('public.profiles', 'trg_cascade_hierarchy_update', '9540c1a57f6878f9e1b625840c261085'),
      ('public.profiles', 'trg_update_hierarchy_path_lock', '69081184456094326ffbd0b34942e7c1'),
      ('public.invitations', 'trg_validate_invitation_upline', 'c393c409a3d428287db81f720c0a0065')) x(tbl, name, digest)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                    WHERE t.tgrelid = r.tbl::regclass AND t.tgname = r.name AND t.tgenabled = 'O'
                      AND md5(pg_catalog.pg_get_triggerdef(t.oid)) = r.digest) THEN
      RAISE EXCEPTION 'hierarchy M2 postcondition failed: trigger % on %', r.name, r.tbl;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal) <> 10
     OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.invitations'::regclass AND NOT t.tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                     WHERE i.indexrelid = 'public.idx_profiles_upline_id'::regclass AND i.indisvalid
                       AND md5(pg_catalog.pg_get_indexdef(i.indexrelid)) = '6200ef769341b8b0667f0716e6101081') THEN
    RAISE EXCEPTION 'hierarchy M2 postcondition failed: trigger count or idx_profiles_upline_id';
  END IF;

  -- The data invariants the new triggers assume (stale paths are expected until M3 and are only reported).
  SELECT * INTO r FROM private.hierarchy_consistency();
  IF r.self_parents <> 0 OR r.cross_org_edges <> 0 OR r.unreachable <> 0 OR r.null_paths <> 0 THEN
    RAISE EXCEPTION 'hierarchy M2 postcondition failed: self_parents=%, cross_org_edges=%, unreachable=%, null_paths=%',
      r.self_parents, r.cross_org_edges, r.unreachable, r.null_paths;
  END IF;
  RAISE NOTICE 'hierarchy M2: % of % stored paths differ from the canonical chain (left for M3; no row written)',
    r.stale_paths, r.profiles;

  -- Fire the real triggers once (any runtime operator-resolution error aborts the migration), then roll back.
  SELECT p.id, p.hierarchy_path INTO v_id, v_before FROM public.profiles p ORDER BY p.id LIMIT 1;
  IF v_id IS NOT NULL THEN
    BEGIN
      UPDATE public.profiles SET upline_id = upline_id WHERE id = v_id;
      IF (SELECT p.hierarchy_path FROM public.profiles p WHERE p.id = v_id) IS DISTINCT FROM v_before THEN
        RAISE EXCEPTION 'hierarchy M2 postcondition failed: a no-op save changed hierarchy_path';
      END IF;
      UPDATE public.profiles SET hierarchy_path = NULL WHERE id = v_id;
      SELECT p.hierarchy_path INTO v_after FROM public.profiles p WHERE p.id = v_id;
      IF v_after IS NULL OR v_after IS DISTINCT FROM public.compute_hierarchy_path(v_id) THEN
        RAISE EXCEPTION 'hierarchy M2 postcondition failed: a direct hierarchy_path write was not re-derived';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'HS001', MESSAGE = 'hierarchy M2 trigger probe rollback';
    EXCEPTION WHEN SQLSTATE 'HS001' THEN
      NULL;                                       -- probe rolled back; every other error propagates
    END;
  END IF;

  PERFORM pg_catalog.set_config('search_path', v_old_sp, true);
END $post$;

NOTIFY pgrst, 'reload schema';
