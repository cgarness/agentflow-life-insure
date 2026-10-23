-- =====================================================================================================
-- Hierarchy stabilization M1 — authorization boundaries before any Team Leader hierarchy is activated
-- =====================================================================================================
-- Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md (rev 3) §6.1, §R (R1), D2–D6, D10.
-- Gate 1 (approved 2026-10-23) authorizes building and disposable-database testing ONLY. Applying this file to
-- production is Gate 2a and needs Chris's separate explicit approval (#APPROVE_RLS_CHANGE). Order (R2):
-- M1 → frontend release → M2 → M3.
--
-- Narrowing only: no row is read or written, and no current user loses visibility today (the only Active Team
-- Leader has 0 is_ancestor_of descendants). Every hierarchy authorization decision becomes database-authoritative,
-- so a promoted, demoted, deactivated or deleted member's still-valid JWT cannot carry hierarchy authority (R1):
--   * public.is_ancestor_of(ancestor_id, descendant_id) — same signature and parameter names (9 policies depend on
--     it). Adds: the ancestor must be the caller whenever a caller exists (closes the cross-org ancestry oracle);
--     ancestor and descendant in the same organization; strict ancestry only when the ANCESTOR'S PROFILE is Active
--     with role Team Leader / Admin / Super Admin or is_super_admin. Self stays true; Deleted descendants stay
--     included. EXECUTE revoked from PUBLIC and anon (authenticated and service_role keep it).
--   * profile_authz.actor_is_team_leader() / profile_authz.actor_is_org_admin(uuid) — read the caller's own
--     profile row, never the JWT. EXECUTE for authenticated only. actor_is_org_admin also requires the actor's
--     profile to be Active (a deactivated or deleted Admin's live token carries no org-admin override).
--   * tasks_select_team_leader — same name and command, now TO authenticated and decided by is_ancestor_of
--     (viewer's profile role check kept). Narrowing only (0 rows today).
--   * trg_01_guard_profile_commission_level — CHANGING another member's commission_level needs an Active
--     Admin / Super Admin profile of that organization or is_super_admin. Fires only when the value changes, so
--     unchanged-value saves pass; system callers (no auth.uid()) and self-edits are unchanged.
--   * RESTRICTIVE DELETE policies: a Team Leader PROFILE needs the Contacts delete toggle for any direct
--     leads / clients / recruits delete, own rows included (the delete_contact rule; closes reassign-then-delete);
--     a calls row may be deleted only by its agent or an Active org-admin profile.
--   * calls_00_guard_team_leader_downline_update — on another agent's call, a client write (current_user =
--     authenticated) by a non-admin profile may change only flagged_for_coaching, notes and updated_at.
--     Definer RPCs, webhooks, service_role and real Admins are unaffected.
--
-- Unchanged: every other policy (including the 9 that call is_ancestor_of), enforce_profile_field_authorization,
-- profile_authz.can_update_profile, has_contacts_permission, the hierarchy path functions and profiles triggers
-- (M2), calls_guard_dialer_core, calls_reporting_fields, all table and column grants, all data.
--
-- Guards: every replaced or relied-on object must match its reviewed production preimage, or (is_ancestor_of
-- only) the state this file's rollback leaves; anything else — including a replay — is refused.
-- Rollback: supabase/migrations/rollback/20261023210000_hierarchy_authorization_boundaries.rollback.sql
-- Proof:    scripts/run_hierarchy_stabilization_tests.sh (disposable local PostgreSQL only).
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, pg_temp;

-- ── 0. Preimage, drift and replay guard ──────────────────────────────────────────────────────────────────────────
DO $guard$
DECLARE
  v_old_sp text := pg_catalog.current_setting('search_path');
  r        record;
  v        text;
BEGIN
  -- pg_get_functiondef / pg_get_expr print names relative to search_path; the digests were captured under this one.
  PERFORM pg_catalog.set_config('search_path', '"$user", public, extensions', true);

  -- is_ancestor_of: the reviewed body, owned by postgres, SECURITY DEFINER, with either the production ACL or the
  -- ACL this file's rollback leaves (EXECUTE already revoked from PUBLIC and anon).
  IF pg_catalog.to_regprocedure('public.is_ancestor_of(uuid,uuid)') IS NULL
     OR md5(pg_catalog.pg_get_functiondef('public.is_ancestor_of(uuid,uuid)'::regprocedure)) <> '7c5213032696734f2e0c5ffe5a71a07a' THEN
    RAISE EXCEPTION 'hierarchy M1 refused: public.is_ancestor_of(uuid,uuid) differs from the reviewed preimage (already applied or drifted)';
  END IF;
  SELECT string_agg(g, ',' ORDER BY g COLLATE "C") INTO v
    FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS g
            FROM pg_catalog.pg_proc f,
                 pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
           WHERE f.oid = 'public.is_ancestor_of(uuid,uuid)'::regprocedure AND a.privilege_type = 'EXECUTE') s;
  IF v IS NULL OR v NOT IN ('PUBLIC,anon,authenticated,postgres,service_role', 'authenticated,postgres,service_role')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f
                     WHERE f.oid = 'public.is_ancestor_of(uuid,uuid)'::regprocedure
                       AND f.proowner = 'postgres'::regrole AND f.prosecdef) THEN
    RAISE EXCEPTION 'hierarchy M1 refused: public.is_ancestor_of(uuid,uuid) owner, definer flag or ACL drifted';
  END IF;

  -- Unchanged objects whose behaviour this file relies on.
  FOR r IN SELECT * FROM (VALUES
      ('public.enforce_profile_field_authorization()', 'b9b4c345b470c94923cddace49cd1d5b'),
      ('profile_authz.can_update_profile(uuid)', 'c9761a65a963c45cb7aa6dc178bfde36'),
      ('public.has_contacts_permission(text)', 'b656907ca141c08a9ba9f5c867c42b6a'),
      ('private.guard_dialer_core_write()', 'c2fbba6d647babc57c9b4c429d13a551'),
      ('private.guard_call_reporting_fields()', '7df31398a10a3fb6fa17d3cf515439ca')) x(fn, digest)
  LOOP
    IF pg_catalog.to_regprocedure(r.fn) IS NULL
       OR md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(r.fn))) <> r.digest THEN
      RAISE EXCEPTION 'hierarchy M1 refused: % differs from the reviewed preimage', r.fn;
    END IF;
  END LOOP;

  -- Exactly the 9 reviewed policies call is_ancestor_of, with their reviewed expressions; tasks_select_team_leader
  -- is the reviewed TO-public inline-ltree policy.
  SELECT string_agg(pol.polrelid::regclass::text || '.' || pol.polname, ',' ORDER BY pol.polrelid::regclass::text COLLATE "C", pol.polname COLLATE "C")
    INTO v
    FROM pg_catalog.pg_policy pol
   WHERE pol.oid IN (SELECT d.objid FROM pg_catalog.pg_depend d
                      WHERE d.classid = 'pg_catalog.pg_policy'::regclass
                        AND d.refobjid = 'public.is_ancestor_of(uuid,uuid)'::regprocedure);
  IF v IS DISTINCT FROM 'calls.Calls Hierarchical Delete,calls.Calls Hierarchical Insert,calls.Calls Hierarchical Select,'
                        'calls.Calls Hierarchical Update,clients.Clients Hierarchical Access,'
                        'contact_emails.contact_emails_select,leads.Leads Hierarchical Access,'
                        'profiles.profiles_select_hierarchical,recruits.Recruits Hierarchical Access' THEN
    RAISE EXCEPTION 'hierarchy M1 refused: the policies depending on is_ancestor_of are not the reviewed 9 (found %)', v;
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.calls', 'Calls Hierarchical Select', 'r', '{authenticated}', '11a30ab26c1dc348d1125863fd71a6fd', '336d5ebc5436534e61d16e63ddfca327'),
      ('public.calls', 'Calls Hierarchical Insert', 'a', '{authenticated}', '336d5ebc5436534e61d16e63ddfca327', '983d0bbf7a63d66586402747d60138d0'),
      ('public.calls', 'Calls Hierarchical Update', 'w', '{authenticated}', '37497d04aa864ed0d6b80d2ab0a01810', '983d0bbf7a63d66586402747d60138d0'),
      ('public.calls', 'Calls Hierarchical Delete', 'd', '{authenticated}', '37497d04aa864ed0d6b80d2ab0a01810', '336d5ebc5436534e61d16e63ddfca327'),
      ('public.clients', 'Clients Hierarchical Access', '*', '{authenticated}', '6bc2d03ca69f509d66711ec272b223e8', '6bc2d03ca69f509d66711ec272b223e8'),
      ('public.leads', 'Leads Hierarchical Access', '*', '{authenticated}', '4db40edfe28246948621a7c90b7b4309', '4db40edfe28246948621a7c90b7b4309'),
      ('public.recruits', 'Recruits Hierarchical Access', '*', '{authenticated}', '6bc2d03ca69f509d66711ec272b223e8', '6bc2d03ca69f509d66711ec272b223e8'),
      ('public.contact_emails', 'contact_emails_select', 'r', '{authenticated}', '795bda19a5048190ff71471b375c4a0f', '336d5ebc5436534e61d16e63ddfca327'),
      ('public.profiles', 'profiles_select_hierarchical', 'r', '{authenticated}', '5234dd30570f6c000db0ed918c53621f', '336d5ebc5436534e61d16e63ddfca327'),
      ('public.tasks', 'tasks_select_team_leader', 'r', '{public}', '98e4d5f1c5fac3108c9f9a938cfa08de', '336d5ebc5436534e61d16e63ddfca327')
    ) x(tbl, name, cmd, roles, qual, chk)
  LOOP
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policy pol
         WHERE pol.polrelid = r.tbl::regclass AND pol.polname = r.name AND pol.polpermissive
           AND pol.polcmd::text = r.cmd
           AND (SELECT array_agg(CASE WHEN g = 0 THEN 'public' ELSE pg_catalog.pg_get_userbyid(g) END ORDER BY 1)
                  FROM unnest(pol.polroles) g)::text = r.roles
           AND md5(coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '-')) = r.qual
           AND md5(coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '-')) = r.chk) THEN
      RAISE EXCEPTION 'hierarchy M1 refused: policy "%" on % differs from the reviewed preimage', r.name, r.tbl;
    END IF;
  END LOOP;

  -- The triggers the new guards are ordered against.
  FOR r IN SELECT * FROM (VALUES
      ('public.profiles', 'trg_00_enforce_profile_field_authorization', 'fc02958ebc6986a60bda53127323bb7c'),
      ('public.calls', 'calls_guard_dialer_core', 'bce9db5747cd6023eaeef99a38e5ec64'),
      ('public.calls', 'calls_reporting_fields', '577beff3268dd0e9c58106b4a1088d65')) x(tbl, name, digest)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                    WHERE t.tgrelid = r.tbl::regclass AND t.tgname = r.name AND t.tgenabled = 'O'
                      AND md5(pg_catalog.pg_get_triggerdef(t.oid)) = r.digest) THEN
      RAISE EXCEPTION 'hierarchy M1 refused: trigger % on % differs from the reviewed preimage', r.name, r.tbl;
    END IF;
  END LOOP;

  -- Nothing this file creates may exist yet, and no restrictive policy may already narrow these tables.
  IF pg_catalog.to_regprocedure('profile_authz.actor_is_team_leader()') IS NOT NULL
     OR pg_catalog.to_regprocedure('profile_authz.actor_is_org_admin(uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.guard_profile_commission_level()') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.guard_team_leader_downline_call_update()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                 WHERE t.tgname IN ('trg_01_guard_profile_commission_level', 'calls_00_guard_team_leader_downline_update'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy pol
                 WHERE pol.polrelid IN ('public.leads'::regclass, 'public.clients'::regclass,
                                        'public.recruits'::regclass, 'public.calls'::regclass)
                   AND (NOT pol.polpermissive
                        OR pol.polname IN ('leads_tl_delete_requires_contacts_permission',
                                           'clients_tl_delete_requires_contacts_permission',
                                           'recruits_tl_delete_requires_contacts_permission',
                                           'calls_delete_own_rows_or_org_admin'))) THEN
    RAISE EXCEPTION 'hierarchy M1 refused: an object this migration creates already exists (already applied?)';
  END IF;

  -- profile_authz is the policy-helper schema authenticated can use; no client role can create objects in the
  -- schemas on the new functions' search_path.
  IF NOT pg_catalog.has_schema_privilege('authenticated', 'profile_authz', 'USAGE')
     OR pg_catalog.has_schema_privilege('anon', 'profile_authz', 'USAGE')
     OR pg_catalog.has_schema_privilege('authenticated', 'profile_authz', 'CREATE')
     OR pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')
     OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'hierarchy M1 refused: schema privileges on profile_authz or public differ from the reviewed state';
  END IF;

  PERFORM pg_catalog.set_config('search_path', v_old_sp, true);
END $guard$;

-- ── 1. is_ancestor_of: caller-bound, same organization, database-authoritative ancestor (D2, D3, R1) ──────────────
CREATE OR REPLACE FUNCTION public.is_ancestor_of(ancestor_id uuid, descendant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  -- Strict ancestry is authority only while the ancestor's PROFILE (never the JWT) is an Active Team Leader,
  -- Admin, Super Admin or platform super admin. Self is always its own ancestor. With a caller, the ancestor must
  -- be the caller (every policy and RPC already passes auth.uid()); system callers have no auth.uid().
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles d
      JOIN public.profiles a ON a.id = ancestor_id
     WHERE d.id = descendant_id
       AND (auth.uid() IS NULL OR a.id = auth.uid())
       AND d.organization_id = a.organization_id
       AND d.hierarchy_path OPERATOR(public.<@) a.hierarchy_path
       AND (a.id = d.id
            OR (a.status = 'Active'
                AND (coalesce(a.is_super_admin, false) OR a.role IN ('Team Leader', 'Admin', 'Super Admin'))))
  );
$$;

-- ── 1b. Database-authoritative actor helpers for policies and guards (R1) ────────────────────────────────────────
CREATE FUNCTION profile_authz.actor_is_team_leader()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  -- The caller's own profile role, whatever its status ('Team Lead' is a legacy alias the role CHECK forbids).
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND p.role IN ('Team Leader', 'Team Lead')
  );
$$;

CREATE FUNCTION profile_authz.actor_is_org_admin(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  -- The caller's own Active profile is a platform super admin, or an Admin / Super Admin of p_org.
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.status = 'Active'
       AND (coalesce(p.is_super_admin, false)
            OR (p.role IN ('Admin', 'Super Admin') AND p.organization_id IS NOT NULL AND p.organization_id = p_org))
  );
$$;

-- ── 2. commission_level guard (D4) ───────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION private.guard_profile_commission_level()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  -- System callers (service role, definer triggers, cron) and self-edits keep today's behaviour (self-edit of the
  -- level is a recorded follow-up). The trigger's WHEN clause already skips unchanged values; this re-check keeps
  -- the function correct if it is ever attached without it.
  IF v_actor IS NULL OR v_actor = OLD.id OR NEW.commission_level IS NOT DISTINCT FROM OLD.commission_level THEN
    RETURN NEW;
  END IF;
  IF profile_authz.actor_is_org_admin(OLD.organization_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Only an Admin of this organization may change another member''s commission level'
    USING ERRCODE = 'insufficient_privilege';
END
$$;

-- ── 4. calls guard: non-admin writes on another agent's call (D6, R1) ────────────────────────────────────────────
-- SECURITY INVOKER on purpose: current_user identifies a direct client write (PostgREST runs as authenticated;
-- definer RPCs run as their owner, webhooks as service_role).
CREATE FUNCTION private.guard_team_leader_downline_call_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  IF current_user <> 'authenticated' OR OLD.agent_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_actor := auth.uid();
  IF v_actor IS NOT NULL AND v_actor = OLD.agent_id THEN
    RETURN NEW;
  END IF;
  IF profile_authz.actor_is_org_admin(OLD.organization_id) THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['flagged_for_coaching', 'notes', 'updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['flagged_for_coaching', 'notes', 'updated_at']) THEN
    RAISE EXCEPTION 'Only the call''s agent or an Admin of this organization may change this call (coaching flag and notes excepted)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION profile_authz.actor_is_team_leader() IS
  'Hierarchy M1 (R1): true when the caller''s own profile role is Team Leader. Database-authoritative; never reads the JWT.';
COMMENT ON FUNCTION profile_authz.actor_is_org_admin(uuid) IS
  'Hierarchy M1 (R1): true when the caller''s own Active profile is is_super_admin or an Admin / Super Admin of the given organization. Never reads the JWT.';
COMMENT ON FUNCTION private.guard_profile_commission_level() IS
  'Hierarchy M1 (D4): changing another member''s commission_level needs an Active org-admin profile or is_super_admin.';
COMMENT ON FUNCTION private.guard_team_leader_downline_call_update() IS
  'Hierarchy M1 (D6, R1): on another agent''s call, a direct client write by a non-admin profile may change only flagged_for_coaching, notes and updated_at.';

-- ── Grants (D10): helpers for authenticated only; trigger functions for nobody (triggers fire without EXECUTE) ──
REVOKE EXECUTE ON FUNCTION public.is_ancestor_of(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_ancestor_of(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION profile_authz.actor_is_team_leader(), profile_authz.actor_is_org_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION profile_authz.actor_is_team_leader(), profile_authz.actor_is_org_admin(uuid) TO authenticated;
REVOKE ALL ON FUNCTION private.guard_profile_commission_level(), private.guard_team_leader_downline_call_update()
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 1c. tasks_select_team_leader: same name and command, TO authenticated, decided by is_ancestor_of (R1) ────────
ALTER POLICY tasks_select_team_leader ON public.tasks
  TO authenticated
  USING (
    EXISTS (SELECT 1
              FROM public.profiles viewer
             WHERE viewer.id = auth.uid()
               AND viewer.organization_id = tasks.organization_id
               AND viewer.role = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text]))
    AND public.is_ancestor_of(auth.uid(), tasks.assigned_to)
  );

-- ── 2. commission_level trigger (after trg_00_enforce_profile_field_authorization, before the path trigger) ──────
CREATE TRIGGER trg_01_guard_profile_commission_level
  BEFORE UPDATE OF commission_level ON public.profiles
  FOR EACH ROW
  WHEN (OLD.commission_level IS DISTINCT FROM NEW.commission_level)
  EXECUTE FUNCTION private.guard_profile_commission_level();

-- ── 3. RESTRICTIVE DELETE policies (D5, D6, R1) ──────────────────────────────────────────────────────────────────
CREATE POLICY leads_tl_delete_requires_contacts_permission ON public.leads
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT profile_authz.actor_is_team_leader() OR public.has_contacts_permission('contacts.leads.delete'));
CREATE POLICY clients_tl_delete_requires_contacts_permission ON public.clients
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT profile_authz.actor_is_team_leader() OR public.has_contacts_permission('contacts.clients.delete'));
CREATE POLICY recruits_tl_delete_requires_contacts_permission ON public.recruits
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT profile_authz.actor_is_team_leader() OR public.has_contacts_permission('contacts.recruits.delete'));
CREATE POLICY calls_delete_own_rows_or_org_admin ON public.calls
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (agent_id = auth.uid() OR profile_authz.actor_is_org_admin(organization_id));
COMMENT ON POLICY leads_tl_delete_requires_contacts_permission ON public.leads IS
  'Hierarchy M1 (D5, R1): a Team Leader profile needs contacts.leads.delete for any direct delete, own rows included (the delete_contact rule).';
COMMENT ON POLICY clients_tl_delete_requires_contacts_permission ON public.clients IS
  'Hierarchy M1 (D5, R1): a Team Leader profile needs contacts.clients.delete for any direct delete, own rows included.';
COMMENT ON POLICY recruits_tl_delete_requires_contacts_permission ON public.recruits IS
  'Hierarchy M1 (D5, R1): a Team Leader profile needs contacts.recruits.delete for any direct delete, own rows included.';
COMMENT ON POLICY calls_delete_own_rows_or_org_admin ON public.calls IS
  'Hierarchy M1 (D6, R1): a call may be deleted directly only by its agent or an Active org-admin profile (or is_super_admin).';

-- ── 4. calls trigger (sorts before calls_guard_dialer_core and calls_reporting_fields: sees the client's row) ────
CREATE TRIGGER calls_00_guard_team_leader_downline_update
  BEFORE UPDATE ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_team_leader_downline_call_update();

-- ── 5. Postconditions ────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_old_sp text := pg_catalog.current_setting('search_path');
  r        record;
  v        text;
BEGIN
  PERFORM pg_catalog.set_config('search_path', '"$user", public, extensions', true);

  FOR r IN SELECT * FROM (VALUES
      ('public.is_ancestor_of(uuid,uuid)', 'c6d121db50b7ea2e37ce4a620cc855af', 'authenticated,postgres,service_role'),
      ('profile_authz.actor_is_team_leader()', 'bbc07ccb69be5c0eed098e17bd9d191d', 'authenticated,postgres'),
      ('profile_authz.actor_is_org_admin(uuid)', 'c64ef188736fae1b90dc7e6a8d29e04f', 'authenticated,postgres'),
      ('private.guard_profile_commission_level()', 'cc306236935837d49ff89540bb8dff89', 'postgres'),
      ('private.guard_team_leader_downline_call_update()', '562fda2611f254d555675706e2673f75', 'postgres')) x(fn, digest, acl)
  LOOP
    SELECT string_agg(g, ',' ORDER BY g COLLATE "C") INTO v
      FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS g
              FROM pg_catalog.pg_proc f,
                   pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
             WHERE f.oid = r.fn::regprocedure AND a.privilege_type = 'EXECUTE') s;
    IF md5(pg_catalog.pg_get_functiondef(r.fn::regprocedure)) <> r.digest OR v IS DISTINCT FROM r.acl
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f WHERE f.oid = r.fn::regprocedure AND f.proowner = 'postgres'::regrole) THEN
      RAISE EXCEPTION 'hierarchy M1 postcondition failed: % (body, owner or ACL %)', r.fn, v;
    END IF;
  END LOOP;

  -- 10 policies now call is_ancestor_of: the reviewed 9 plus tasks_select_team_leader (TO authenticated).
  SELECT string_agg(pol.polrelid::regclass::text || '.' || pol.polname, ',' ORDER BY pol.polrelid::regclass::text COLLATE "C", pol.polname COLLATE "C")
    INTO v
    FROM pg_catalog.pg_policy pol
   WHERE pol.oid IN (SELECT d.objid FROM pg_catalog.pg_depend d
                      WHERE d.classid = 'pg_catalog.pg_policy'::regclass
                        AND d.refobjid = 'public.is_ancestor_of(uuid,uuid)'::regprocedure);
  IF v IS DISTINCT FROM 'calls.Calls Hierarchical Delete,calls.Calls Hierarchical Insert,calls.Calls Hierarchical Select,'
                        'calls.Calls Hierarchical Update,clients.Clients Hierarchical Access,'
                        'contact_emails.contact_emails_select,leads.Leads Hierarchical Access,'
                        'profiles.profiles_select_hierarchical,recruits.Recruits Hierarchical Access,'
                        'tasks.tasks_select_team_leader' THEN
    RAISE EXCEPTION 'hierarchy M1 postcondition failed: policies depending on is_ancestor_of: %', v;
  END IF;

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
      RAISE EXCEPTION 'hierarchy M1 postcondition failed: policy "%" on %', r.name, r.tbl;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_policy pol
       WHERE NOT pol.polpermissive
         AND pol.polrelid IN ('public.leads'::regclass, 'public.clients'::regclass,
                              'public.recruits'::regclass, 'public.calls'::regclass)) <> 4 THEN
    RAISE EXCEPTION 'hierarchy M1 postcondition failed: expected exactly 4 restrictive policies';
  END IF;

  FOR r IN SELECT * FROM (VALUES
      ('public.profiles', 'trg_01_guard_profile_commission_level', 'a85d3c1edb2ce795b391b780de7bc413'),
      ('public.calls', 'calls_00_guard_team_leader_downline_update', 'ae888acb2d2139410e346827ec999c65')) x(tbl, name, digest)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                    WHERE t.tgrelid = r.tbl::regclass AND t.tgname = r.name AND t.tgenabled = 'O'
                      AND md5(pg_catalog.pg_get_triggerdef(t.oid)) = r.digest) THEN
      RAISE EXCEPTION 'hierarchy M1 postcondition failed: trigger % on %', r.name, r.tbl;
    END IF;
  END LOOP;
  -- Firing order (same timing and level fire in name order): the calls guard first; the commission guard right
  -- after the field-authorization trigger.
  IF (SELECT min(t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = 'public.calls'::regclass AND NOT t.tgisinternal
         AND (t.tgtype & 2) <> 0 AND (t.tgtype & 1) <> 0 AND (t.tgtype & 16) <> 0) <> 'calls_00_guard_team_leader_downline_update'
     OR (SELECT min(t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal
            AND (t.tgtype & 2) <> 0 AND (t.tgtype & 1) <> 0 AND (t.tgtype & 16) <> 0
            AND t.tgname COLLATE "C" > 'trg_00_enforce_profile_field_authorization') <> 'trg_01_guard_profile_commission_level' THEN
    RAISE EXCEPTION 'hierarchy M1 postcondition failed: trigger order';
  END IF;

  PERFORM pg_catalog.set_config('search_path', v_old_sp, true);
END $post$;

NOTIFY pgrst, 'reload schema';
