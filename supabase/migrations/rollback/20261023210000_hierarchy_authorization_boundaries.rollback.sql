-- Rollback for 20261023210000_hierarchy_authorization_boundaries.sql (hierarchy stabilization M1).
-- Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md §10. Production use requires Chris's
-- separate explicit approval (#APPROVE_RLS_CHANGE). Reads and writes no data.
--
-- Restores public.is_ancestor_of to its exact preimage body (baseline 20260806000000, byte-for-byte; digest
-- 7c5213032696734f2e0c5ffe5a71a07a) and tasks_select_team_leader to its exact preimage (TO public, inline ltree
-- test), and drops everything M1 added: the commission_level guard, the calls guard, the 4 RESTRICTIVE DELETE
-- policies and the two profile_authz actor helpers.
-- NOT restored: the PUBLIC / anon EXECUTE on is_ancestor_of (security revokes are re-assert-only; CREATE OR REPLACE
-- keeps today's ACL). Re-applying the forward migration after this rollback is supported: its guard accepts exactly
-- this state.
-- ⚠ With M3 (or any activated Team Leader branch) live, this re-widens Team Leader powers: downline deletes without
-- the Contacts toggle, edits and deletes of downline calls, downline commission_level changes, and downline access
-- for Deleted / Inactive / demoted Team Leaders whose tokens are still valid. The guard warns when that applies.
-- Guarded: refuses unless every M1 object is exactly the reviewed post-image.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, pg_temp;

DO $guard$
DECLARE
  v_old_sp text := pg_catalog.current_setting('search_path');
  r        record;
  v        text;
  v_active bigint;
BEGIN
  PERFORM pg_catalog.set_config('search_path', '"$user", public, extensions', true);

  FOR r IN SELECT * FROM (VALUES
      ('public.is_ancestor_of(uuid,uuid)', 'c6d121db50b7ea2e37ce4a620cc855af', 'authenticated,postgres,service_role'),
      ('profile_authz.actor_is_team_leader()', 'bbc07ccb69be5c0eed098e17bd9d191d', 'authenticated,postgres'),
      ('profile_authz.actor_is_org_admin(uuid)', 'c64ef188736fae1b90dc7e6a8d29e04f', 'authenticated,postgres'),
      ('private.guard_profile_commission_level()', 'cc306236935837d49ff89540bb8dff89', 'postgres'),
      ('private.guard_team_leader_downline_call_update()', '562fda2611f254d555675706e2673f75', 'postgres')) x(fn, digest, acl)
  LOOP
    IF pg_catalog.to_regprocedure(r.fn) IS NULL
       OR md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(r.fn))) <> r.digest THEN
      RAISE EXCEPTION 'hierarchy M1 rollback refused: % is not the reviewed M1 post-image', r.fn;
    END IF;
    SELECT string_agg(g, ',' ORDER BY g COLLATE "C") INTO v
      FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS g
              FROM pg_catalog.pg_proc f,
                   pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
             WHERE f.oid = r.fn::regprocedure AND a.privilege_type = 'EXECUTE') s;
    IF v IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'hierarchy M1 rollback refused: % ACL drifted (%)', r.fn, v;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.tasks', 'tasks_select_team_leader', true, 'r', '99b43cc5f9de132a3fa76f5ab0188f3e'),
      ('public.leads', 'leads_tl_delete_requires_contacts_permission', false, 'd', '3fc00bba927c58f93d681265c8dc7124'),
      ('public.clients', 'clients_tl_delete_requires_contacts_permission', false, 'd', 'b9b6c708202d5db1a3aa345621b108cc'),
      ('public.recruits', 'recruits_tl_delete_requires_contacts_permission', false, 'd', 'bd825cc1e1e085499e5d22318254567e'),
      ('public.calls', 'calls_delete_own_rows_or_org_admin', false, 'd', 'ae4bdbb08b4dfebc1f72c6759f84785f')) x(tbl, name, permissive, cmd, qual)
  LOOP
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policy pol
         WHERE pol.polrelid = r.tbl::regclass AND pol.polname = r.name AND pol.polpermissive = r.permissive
           AND pol.polcmd::text = r.cmd AND pol.polroles = ARRAY['authenticated'::regrole::oid]
           AND md5(coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '-')) = r.qual
           AND pol.polwithcheck IS NULL) THEN
      RAISE EXCEPTION 'hierarchy M1 rollback refused: policy "%" on % is not the reviewed M1 post-image', r.name, r.tbl;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.profiles', 'trg_01_guard_profile_commission_level', 'a85d3c1edb2ce795b391b780de7bc413'),
      ('public.calls', 'calls_00_guard_team_leader_downline_update', 'ae888acb2d2139410e346827ec999c65')) x(tbl, name, digest)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                    WHERE t.tgrelid = r.tbl::regclass AND t.tgname = r.name
                      AND md5(pg_catalog.pg_get_triggerdef(t.oid)) = r.digest) THEN
      RAISE EXCEPTION 'hierarchy M1 rollback refused: trigger % on % is not the reviewed M1 post-image', r.name, r.tbl;
    END IF;
  END LOOP;

  -- Path-based (not is_ancestor_of): live Team Leader downline relationships this rollback would widen again.
  SELECT count(*) INTO v_active
    FROM public.profiles a JOIN public.profiles d
      ON d.id <> a.id AND d.organization_id = a.organization_id
     AND d.hierarchy_path OPERATOR(public.<@) a.hierarchy_path
   WHERE a.role = 'Team Leader';
  IF v_active > 0 THEN
    RAISE WARNING 'hierarchy M1 rollback: % Team Leader downline relationship(s) are live; Team Leader powers widen again (plan §10)', v_active;
  END IF;

  PERFORM pg_catalog.set_config('search_path', v_old_sp, true);
END $guard$;

-- ── 1. is_ancestor_of: the exact preimage (baseline 20260806000000, byte-for-byte). The ACL is kept. ───────────────
CREATE OR REPLACE FUNCTION "public"."is_ancestor_of"("ancestor_id" "uuid", "descendant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles d
    WHERE d.id = descendant_id
    AND d.hierarchy_path <@ (
      SELECT p.hierarchy_path FROM public.profiles p WHERE p.id = ancestor_id
    )
  );
$$;

-- ── 2. tasks_select_team_leader: the exact preimage (TO public, inline ltree containment) ─────────────────────────
ALTER POLICY "tasks_select_team_leader" ON "public"."tasks" TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "viewer"
  WHERE (("viewer"."id" = "auth"."uid"()) AND ("viewer"."organization_id" = "tasks"."organization_id") AND ("viewer"."role" = ANY (ARRAY['Team Leader'::"text", 'Team Lead'::"text"])) AND (EXISTS ( SELECT 1
           FROM "public"."profiles" "subject"
          WHERE (("subject"."id" = "tasks"."assigned_to") AND ("subject"."hierarchy_path" OPERATOR("public".<@) "viewer"."hierarchy_path"))))))));

-- ── 3. Everything M1 added ────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY leads_tl_delete_requires_contacts_permission ON public.leads;
DROP POLICY clients_tl_delete_requires_contacts_permission ON public.clients;
DROP POLICY recruits_tl_delete_requires_contacts_permission ON public.recruits;
DROP POLICY calls_delete_own_rows_or_org_admin ON public.calls;
DROP TRIGGER calls_00_guard_team_leader_downline_update ON public.calls;
DROP TRIGGER trg_01_guard_profile_commission_level ON public.profiles;
DROP FUNCTION private.guard_team_leader_downline_call_update();
DROP FUNCTION private.guard_profile_commission_level();
DROP FUNCTION profile_authz.actor_is_org_admin(uuid);
DROP FUNCTION profile_authz.actor_is_team_leader();

-- ── 4. Postconditions: the exact preimage bodies and policies, with the revoked ACL ───────────────────────────────
DO $post$
DECLARE
  v_old_sp text := pg_catalog.current_setting('search_path');
  v        text;
BEGIN
  PERFORM pg_catalog.set_config('search_path', '"$user", public, extensions', true);
  SELECT string_agg(g, ',' ORDER BY g COLLATE "C") INTO v
    FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS g
            FROM pg_catalog.pg_proc f,
                 pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
           WHERE f.oid = 'public.is_ancestor_of(uuid,uuid)'::regprocedure AND a.privilege_type = 'EXECUTE') s;
  IF md5(pg_catalog.pg_get_functiondef('public.is_ancestor_of(uuid,uuid)'::regprocedure)) <> '7c5213032696734f2e0c5ffe5a71a07a'
     OR v IS DISTINCT FROM 'authenticated,postgres,service_role' THEN
    RAISE EXCEPTION 'hierarchy M1 rollback postcondition failed: is_ancestor_of body or ACL (%)', v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy pol
                  WHERE pol.polrelid = 'public.tasks'::regclass AND pol.polname = 'tasks_select_team_leader'
                    AND pol.polpermissive AND pol.polcmd = 'r' AND pol.polroles = ARRAY[0::oid]
                    AND md5(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)) = '98e4d5f1c5fac3108c9f9a938cfa08de') THEN
    RAISE EXCEPTION 'hierarchy M1 rollback postcondition failed: tasks_select_team_leader is not the preimage';
  END IF;
  IF (SELECT count(DISTINCT d.objid) FROM pg_catalog.pg_depend d
       WHERE d.classid = 'pg_catalog.pg_policy'::regclass
         AND d.refobjid = 'public.is_ancestor_of(uuid,uuid)'::regprocedure) <> 9
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy pol
                 WHERE NOT pol.polpermissive
                   AND pol.polrelid IN ('public.leads'::regclass, 'public.clients'::regclass,
                                        'public.recruits'::regclass, 'public.calls'::regclass))
     OR pg_catalog.to_regprocedure('profile_authz.actor_is_team_leader()') IS NOT NULL
     OR pg_catalog.to_regprocedure('profile_authz.actor_is_org_admin(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'hierarchy M1 rollback postcondition failed: dependent policies, restrictive policies or helpers';
  END IF;
  PERFORM pg_catalog.set_config('search_path', v_old_sp, true);
END $post$;

NOTIFY pgrst, 'reload schema';
