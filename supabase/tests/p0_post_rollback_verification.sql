-- =====================================================================================================
-- P0 DRY RUN — POST-ROLLBACK VERIFICATION (read-only; run AFTER the dry run, as a SEPARATE call)
--
-- Proves the rolled-back transaction persisted NOTHING: no fixture row, no schema change, no grant
-- change, no queued side effect. Every row returned must show status = 'PASS'.
--
-- HOW THIS DIFFERS FROM THE PREVIOUS VERSION
--   The old file asserted on NAMES and COUNTS ("4 of these policies exist", "2 grants exist"). That
--   passes even if a policy's USING expression was rewritten, a trigger was disabled, a function body
--   was replaced, or an ACL was narrowed — precisely the damage this migration is capable of doing.
--   Every check below now compares an EXACT FINGERPRINT captured from production on 2026-07-31
--   (project jncvvsvckxhqgqvkppmj) against the live value. status = 'PASS' only on exact equality.
--
-- COMPANION FILE
--   supabase/tests/p0_baseline_fingerprint.sql prints the same values with no assertions. Run it
--   BEFORE the dry run; run this file AFTER. The canonicalisation rules (COLLATE "C" ordering,
--   re-sorted ACL arrays, 'ABSENT'/'<null>' sentinels) are identical in both files ON PURPOSE — do
--   not change one without the other.
--
-- SAFETY
--   Pure SELECT. No writes, no DDL, no transaction of its own.
--
-- REBASELINING
--   If a legitimate schema change lands, re-run p0_baseline_fingerprint.sql and update the constants
--   in the `exp_*` CTEs below. Never "fix" a FAIL by loosening a comparison.
-- =====================================================================================================

WITH
-- ---------------------------------------------------------------------------------------------------
-- Fixture identifiers, from supabase/tests/p0_profile_authorization.sql. Kept in one place so a new
-- fixture is added here once.
-- ---------------------------------------------------------------------------------------------------
fx_org(org_id) AS (VALUES
  ('a0a0a0a0-0000-4000-8000-000000000001'::uuid),   -- ORG_A
  ('b0b0b0b0-0000-4000-8000-000000000001'::uuid)    -- ORG_B
),
fx_prefix(pfx) AS (VALUES
  ('a0a0a0a0%'),   -- organizations
  ('b0b0b0b0%'),
  ('c0c0c0c0%'),   -- teams
  ('a1111111%'),   -- org A users/profiles
  ('b1111111%'),   -- org B users/profiles
  ('c1111111%'),   -- T14/T16 users/profiles
  ('e0e0e0e0%'),   -- invitations
  ('f0f0f0f0%'),   -- the id T1 tries to forge
  ('f1f1f1f1%')    -- invitation tokens
),

-- ---------------------------------------------------------------------------------------------------
-- (a) EXPECTED POLICIES — exact expressions, verified byte-for-byte against production 2026-07-31.
--     The multi-line expressions are reproduced verbatim including their leading whitespace; they are
--     dollar-quoted so the newlines survive. Do not reflow them.
-- ---------------------------------------------------------------------------------------------------
exp_pol(tbl, polname, cmd, permissive, roles, qual, wcheck) AS (VALUES
  ('profiles', 'profiles_insert', 'a', 'PERMISSIVE', 'PUBLIC',
   $q$<null>$q$,
   $q$true$q$),

  ('profiles', 'profiles_select_hierarchical', 'r', 'PERMISSIVE', 'authenticated',
   $q$(((organization_id IS NOT NULL) AND super_admin_own_org(organization_id)) OR ((organization_id = get_org_id()) AND ((get_user_role() = 'Admin'::text) OR ((get_user_role() = 'Team Leader'::text) AND ((id = auth.uid()) OR is_ancestor_of(auth.uid(), id))) OR ((get_user_role() = 'Agent'::text) AND (id = auth.uid())))))$q$,
   $q$<null>$q$),

  ('profiles', 'profiles_select_org', 'r', 'PERMISSIVE', 'PUBLIC',
   $q$(organization_id = get_user_org_id())$q$,
   $q$<null>$q$),

  -- The hole the migration closes: UPDATE, TO PUBLIC, and NO WITH CHECK.
  ('profiles', 'profiles_update_admin', 'w', 'PERMISSIVE', 'PUBLIC',
   $q$((organization_id = get_user_org_id()) AND (get_user_role() = 'Admin'::text))$q$,
   $q$<null>$q$),

  ('profiles', 'profiles_update_hierarchical', 'w', 'PERMISSIVE', 'authenticated',
   $q$(((organization_id IS NOT NULL) AND super_admin_own_org(organization_id)) OR ((organization_id = get_org_id()) AND ((get_user_role() = 'Admin'::text) OR ((get_user_role() = 'Team Leader'::text) AND ((id = auth.uid()) OR is_ancestor_of(auth.uid(), id))) OR ((get_user_role() = 'Agent'::text) AND (id = auth.uid())))))$q$,
   $q$(((organization_id IS NOT NULL) AND super_admin_own_org(organization_id)) OR ((organization_id = get_org_id()) AND ((get_user_role() = 'Admin'::text) OR ((get_user_role() = 'Team Leader'::text) AND ((id = auth.uid()) OR is_ancestor_of(auth.uid(), id))) OR ((get_user_role() = 'Agent'::text) AND (id = auth.uid())))))$q$),

  -- The other hole: UPDATE, TO PUBLIC, NO WITH CHECK — Postgres reuses USING as the check.
  ('profiles', 'profiles_update_own', 'w', 'PERMISSIVE', 'PUBLIC',
   $q$(id = auth.uid())$q$,
   $q$<null>$q$),

  ('invitations', 'invitations_insert', 'a', 'PERMISSIVE', 'authenticated',
   $q$<null>$q$,
   $q$(((organization_id IS NOT NULL) AND super_admin_own_org(organization_id)) OR ((organization_id = get_org_id()) AND (get_user_role() = ANY (ARRAY['Admin'::text, 'Super Admin'::text]))))$q$),

  ('invitations', 'invitations_org_admin_manage', '*', 'PERMISSIVE', 'authenticated',
   $q$(super_admin_own_org(organization_id) OR ((organization_id = ( SELECT profiles.organization_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND (( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['Admin'::text, 'Team Leader'::text]))))$q$,
   $q$(super_admin_own_org(organization_id) OR ((organization_id = ( SELECT profiles.organization_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND (( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['Admin'::text, 'Team Leader'::text]))))$q$),

  ('invitations', 'invitations_select', 'r', 'PERMISSIVE', 'authenticated',
   $q$(((organization_id IS NOT NULL) AND super_admin_own_org(organization_id)) OR ((organization_id = get_org_id()) AND (get_user_role() = ANY (ARRAY['Admin'::text, 'Super Admin'::text]))))$q$,
   $q$<null>$q$),

  ('invitations', 'invitations_service_role', '*', 'PERMISSIVE', 'service_role',
   $q$true$q$,
   $q$true$q$),

  -- Inert today only because invitations_status_check demands capitalised values.
  ('invitations', 'invitations_update_status', 'w', 'PERMISSIVE', 'authenticated',
   $q$true$q$,
   $q$(status = 'accepted'::text)$q$)
),
live_pol AS (
  SELECT c.relname AS tbl, p.polname, p.polcmd::text AS cmd,
         CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS permissive,
         CASE WHEN p.polroles = '{0}' THEN 'PUBLIC'
              ELSE (SELECT string_agg(r.rolname, '+' ORDER BY r.rolname COLLATE "C")
                      FROM pg_roles r WHERE r.oid = ANY (p.polroles)) END AS roles,
         COALESCE(pg_get_expr(p.polqual,      p.polrelid), '<null>') AS qual,
         COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '<null>') AS wcheck
  FROM pg_policy p
  JOIN pg_class c     ON p.polrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public' AND c.relname IN ('profiles', 'invitations')
),
pol_cmp AS (
  SELECT COALESCE(e.tbl, l.tbl) AS tbl,
         COALESCE(e.polname, l.polname) AS polname,
         -- full exact text drives the verdict
         (e.cmd IS NOT DISTINCT FROM l.cmd
          AND e.permissive IS NOT DISTINCT FROM l.permissive
          AND e.roles  IS NOT DISTINCT FROM l.roles
          AND e.qual   IS NOT DISTINCT FROM l.qual
          AND e.wcheck IS NOT DISTINCT FROM l.wcheck) AS ok,
         -- md5-abbreviated rendering keeps the output readable without weakening the comparison
         CASE WHEN e.polname IS NULL THEN 'ABSENT'
              ELSE format('%s|%s|%s|q:%s|w:%s', e.cmd, e.permissive, e.roles, md5(e.qual), md5(e.wcheck)) END AS exp_txt,
         CASE WHEN l.polname IS NULL THEN 'ABSENT'
              ELSE format('%s|%s|%s|q:%s|w:%s', l.cmd, l.permissive, l.roles, md5(l.qual), md5(l.wcheck)) END AS act_txt
  FROM exp_pol e FULL OUTER JOIN live_pol l ON e.tbl = l.tbl AND e.polname = l.polname
),

-- ---------------------------------------------------------------------------------------------------
-- (b) EXPECTED TRIGGERS — every user trigger on profiles and organizations, with its enable state.
--     organizations is included because its AFTER INSERT triggers seed pipeline_stages /
--     appointment_types / lead_sources and queue the Twilio pg_net request; a trigger silently left
--     DISABLED by a botched rollback would make the whole dry run's "no side effects" claim vacuous.
-- ---------------------------------------------------------------------------------------------------
exp_trg(tbl, tgname, enabled, def) AS (VALUES
  ('organizations', 'on_organization_created_provision_twilio', 'O',
   'CREATE TRIGGER on_organization_created_provision_twilio AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION handle_new_organization_provisioning()'),
  ('organizations', 'on_organization_created_seed_appointment_types', 'O',
   'CREATE TRIGGER on_organization_created_seed_appointment_types AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION handle_new_organization_seed_appointment_types()'),
  ('organizations', 'on_organization_created_seed_lead_sources', 'O',
   'CREATE TRIGGER on_organization_created_seed_lead_sources AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION handle_new_organization_seed_lead_sources()'),
  ('organizations', 'on_organization_created_seed_pipeline_stages', 'O',
   'CREATE TRIGGER on_organization_created_seed_pipeline_stages AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION handle_new_organization_seed_pipeline_stages()'),
  ('profiles', 'on_profile_created_welcome_email', 'O',
   'CREATE TRIGGER on_profile_created_welcome_email AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION handle_new_user_welcome_email()'),
  ('profiles', 'on_profile_update_trigger', 'O',
   'CREATE TRIGGER on_profile_update_trigger AFTER INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION on_profile_update()'),
  ('profiles', 'profiles_updated_at', 'O',
   'CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at()'),
  ('profiles', 'trg_cascade_hierarchy_update', 'O',
   'CREATE TRIGGER trg_cascade_hierarchy_update AFTER UPDATE OF upline_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION cascade_hierarchy_update()'),
  ('profiles', 'trg_update_hierarchy_path', 'O',
   'CREATE TRIGGER trg_update_hierarchy_path BEFORE INSERT OR UPDATE OF upline_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_hierarchy_path()')
),
live_trg AS (
  SELECT c.relname AS tbl, tg.tgname, tg.tgenabled::text AS enabled, pg_get_triggerdef(tg.oid) AS def
  FROM pg_trigger tg
  JOIN pg_class c     ON tg.tgrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public' AND c.relname IN ('profiles', 'organizations')
    AND NOT tg.tgisinternal
),
trg_cmp AS (
  SELECT COALESCE(e.tbl, l.tbl) AS tbl,
         COALESCE(e.tgname, l.tgname) AS tgname,
         (e.enabled IS NOT DISTINCT FROM l.enabled AND e.def IS NOT DISTINCT FROM l.def) AS ok,
         CASE WHEN e.tgname IS NULL THEN 'ABSENT'
              ELSE format('enabled=%s|def:%s', e.enabled, md5(e.def)) END AS exp_txt,
         CASE WHEN l.tgname IS NULL THEN 'ABSENT'
              ELSE format('enabled=%s|def:%s', l.enabled, md5(l.def)) END AS act_txt
  FROM exp_trg e FULL OUTER JOIN live_trg l ON e.tbl = l.tbl AND e.tgname = l.tgname
),

-- ---------------------------------------------------------------------------------------------------
-- (c) EXPECTED FUNCTIONS. The first two are CREATED by the migration, so their correct post-rollback
--     baseline is NON-EXISTENCE. The rest must be byte-identical: get_invitation_by_token_rpc is
--     CREATE OR REPLACEd by the migration, and the other four are the hierarchy/claim machinery the
--     guard leans on. md5(pg_get_functiondef(...)) catches a replaced body that a name check cannot.
--     The fingerprint also pins proowner / prosecdef / proconfig / proacl, because a SECURITY DEFINER
--     function silently reowned or re-granted is an authorization change even with an identical body.
-- ---------------------------------------------------------------------------------------------------
exp_fn(fname, fingerprint) AS (VALUES
  ('enforce_profile_field_authorization', 'ABSENT'),
  ('provision_organization',              'ABSENT'),
  ('get_invitation_by_token_rpc',
   'get_invitation_by_token_rpc(text) :: def_md5=dc2fb6ec407fc5c551dfaec7348d5329 owner=postgres secdef=true config=search_path=public acl==X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('compute_hierarchy_path',
   'compute_hierarchy_path(uuid) :: def_md5=b9aaa16d5b974676ce18d55c5dce9e18 owner=postgres secdef=true config=search_path=public acl==X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('cascade_hierarchy_update',
   'cascade_hierarchy_update() :: def_md5=8392e93e9b09f726dcb097cb54dae522 owner=postgres secdef=true config=search_path=public acl==X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('update_hierarchy_path',
   'update_hierarchy_path() :: def_md5=d9ff2d22fcc0bd5e55ea288850ad1cfe owner=postgres secdef=true config=search_path=public acl==X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  -- NB: on_profile_update has NO proconfig in production (config=<null>). That is the pre-existing
  -- state, recorded here as-is; it is not something the P0 dry run may alter either way.
  ('on_profile_update',
   'on_profile_update() :: def_md5=b44d4c7ddc97d62d2cc9a3b22a8fc057 owner=postgres secdef=true config=<null> acl==X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
  ('handle_new_user',
   'handle_new_user() :: def_md5=83e132e4d1c945c14eba0337727505d5 owner=postgres secdef=true config=search_path=public acl==X/postgres,anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres')
),
live_fn AS (
  SELECT e.fname,
         COALESCE((
           SELECT string_agg(
                    format('%s :: def_md5=%s owner=%s secdef=%s config=%s acl=%s',
                           p.oid::regprocedure::text,
                           md5(pg_get_functiondef(p.oid)),
                           p.proowner::regrole::text,
                           p.prosecdef::text,
                           COALESCE(array_to_string(p.proconfig, ','), '<null>'),
                           COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C")
                                       FROM unnest(p.proacl) a), '<null>')),
                    E'\n' ORDER BY p.oid::regprocedure::text COLLATE "C")
           FROM pg_proc p
           JOIN pg_namespace n ON p.pronamespace = n.oid
           WHERE n.nspname = 'public' AND p.proname = e.fname
         ), 'ABSENT') AS fingerprint
  FROM exp_fn e
),

-- ---------------------------------------------------------------------------------------------------
-- (d) EXPECTED TABLE ACLs. anon and authenticated must still hold the FULL table privileges the
--     migration would have revoked, and no column-level ACL may exist on either table.
-- ---------------------------------------------------------------------------------------------------
exp_acl(tbl, relacl) AS (VALUES
  ('profiles',    'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,supabase_auth_admin=r/postgres'),
  ('invitations', 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres')
),
live_acl AS (
  SELECT c.oid, c.relname AS tbl,
         COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C")
                     FROM unnest(c.relacl) a), '<null>') AS relacl,
         (SELECT count(*) FROM pg_attribute at
           WHERE at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped
             AND at.attacl IS NOT NULL) AS col_acl_count,
         (SELECT count(*) FROM pg_attribute at
           WHERE at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped) AS col_count
  FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public' AND c.relname IN ('profiles', 'invitations')
),

-- ---------------------------------------------------------------------------------------------------
-- (f) EXPECTED information_schema GRANTS for anon / authenticated.
-- ---------------------------------------------------------------------------------------------------
live_grant AS (
  SELECT g.table_name::text AS tbl, g.grantee::text AS grantee,
         string_agg(g.privilege_type::text, ',' ORDER BY g.privilege_type::text COLLATE "C") AS privs
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public'
    AND g.table_name IN ('profiles', 'invitations')
    AND g.grantee IN ('anon', 'authenticated')
  GROUP BY g.table_name, g.grantee
),
exp_grant(tbl, grantee, privs) AS (VALUES
  ('profiles',    'anon',          'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE'),
  ('profiles',    'authenticated', 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE'),
  ('invitations', 'anon',          'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE'),
  ('invitations', 'authenticated', 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE')
)

-- =====================================================================================================
-- SECTION 1 — FIXTURE ABSENCE. Nothing the dry run created may have survived the ROLLBACK.
-- =====================================================================================================
SELECT '1a_no_fixture_profiles' AS "check", '0' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM public.profiles
WHERE email LIKE '%@p0test.invalid'
   OR EXISTS (SELECT 1 FROM fx_prefix f WHERE public.profiles.id::text LIKE f.pfx)
   OR organization_id IN (SELECT org_id FROM fx_org)

UNION ALL
SELECT '1b_no_fixture_organizations', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.organizations
WHERE slug IN ('p0-test-org-a', 'p0-test-org-b')
   OR slug LIKE 'p0-dryrun-%'
   OR name IN ('P0 Test Org A', 'P0 Test Org B')
   OR id IN (SELECT org_id FROM fx_org)

UNION ALL
SELECT '1c_no_fixture_teams', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.teams
WHERE name = 'P0 Test Team A'
   OR id = 'c0c0c0c0-0000-4000-8000-000000000001'::uuid
   OR organization_id IN (SELECT org_id FROM fx_org)

UNION ALL
SELECT '1d_no_fixture_invitations', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.invitations
WHERE email LIKE '%@p0test.invalid'
   OR token::text IN ('p0-test-token-org-a', 'p0-test-token-org-b')
   OR EXISTS (SELECT 1 FROM fx_prefix f WHERE public.invitations.id::text LIKE f.pfx)
   OR organization_id IN (SELECT org_id FROM fx_org)

UNION ALL
SELECT '1e_no_fixture_auth_users', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM auth.users
WHERE email LIKE '%@p0test.invalid'
   OR EXISTS (SELECT 1 FROM fx_prefix f WHERE auth.users.id::text LIKE f.pfx)

-- The claim-sync trigger (on_profile_update -> set_claim) writes auth.users.raw_app_meta_data, so a
-- surviving app_metadata edit would be a live authorization change even with the profile row gone.
UNION ALL
SELECT '1f_no_fixture_app_metadata', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM auth.users
WHERE raw_app_meta_data::text ILIKE '%p0test.invalid%'
   OR raw_app_meta_data::text ILIKE '%a0a0a0a0-0000-4000-8000%'
   OR raw_app_meta_data::text ILIKE '%b0b0b0b0-0000-4000-8000%'
   OR raw_app_meta_data::text ILIKE '%c0c0c0c0-0000-4000-8000%'

-- Trigger-seeded child tables. Inserting an organization fires four AFTER INSERT triggers; a
-- surviving seed row would prove the rollback was partial even if the parent org is gone (the FKs
-- are ON DELETE NO ACTION, so orphans are possible).
UNION ALL
SELECT '1g_no_fixture_pipeline_stages', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.pipeline_stages WHERE organization_id IN (SELECT org_id FROM fx_org)

UNION ALL
SELECT '1h_no_fixture_appointment_types', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.appointment_types WHERE organization_id IN (SELECT org_id FROM fx_org)

UNION ALL
SELECT '1i_no_fixture_lead_sources', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.lead_sources WHERE organization_id IN (SELECT org_id FROM fx_org)

-- dispositions are seeded by provision_organization (the function the migration adds), not by a
-- trigger — so a surviving row here also proves the new function ran and did not roll back.
UNION ALL
SELECT '1j_no_fixture_dispositions', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.dispositions WHERE organization_id IN (SELECT org_id FROM fx_org)

-- pg_net is the one genuinely external side effect: a queued row becomes an outbound HTTP call.
UNION ALL
SELECT '1k_no_pgnet_queued_for_fixtures', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM net.http_request_queue
WHERE url ILIKE '%p0test.invalid%'
   OR body::text ILIKE '%p0test.invalid%'
   OR body::text ILIKE '%p0-dryrun-%'
   OR body::text ILIKE '%p0-test-org-%'
   OR body::text ILIKE '%a0a0a0a0-0000-4000-8000%'
   OR body::text ILIKE '%b0b0b0b0-0000-4000-8000%'

UNION ALL
SELECT '1l_no_migration_history_row', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM supabase_migrations.schema_migrations
WHERE version LIKE '202607302100%' OR name ILIKE '%p0_profile_authorization%'

-- =====================================================================================================
-- SECTION 2 — POLICY FINGERPRINTS (exact). One row per policy, from the union of expected and live,
-- so a MISSING policy and an EXTRA policy both surface as their own FAIL.
-- =====================================================================================================
UNION ALL
SELECT format('2_policy:%s.%s', tbl, polname), exp_txt, act_txt,
       CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END
FROM pol_cmp

UNION ALL
SELECT '2z_no_migration_policies', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND p.polname IN ('invitations_delete_org_admin', 'invitations_revoke_org_admin', 'invitations_select_team_leader')

-- =====================================================================================================
-- SECTION 3 — TRIGGER FINGERPRINTS (exact), including tgenabled.
-- =====================================================================================================
UNION ALL
SELECT format('3_trigger:%s.%s', tbl, tgname), exp_txt, act_txt,
       CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END
FROM trg_cmp

UNION ALL
SELECT '3z_no_guard_trigger', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM pg_trigger WHERE tgname = 'trg_00_enforce_profile_field_authorization'

-- =====================================================================================================
-- SECTION 4 — FUNCTION FINGERPRINTS (exact). 'ABSENT' is the correct expected value for the two
-- functions the migration creates.
-- =====================================================================================================
UNION ALL
SELECT format('4_function:public.%s', e.fname), e.fingerprint, l.fingerprint,
       CASE WHEN e.fingerprint IS NOT DISTINCT FROM l.fingerprint THEN 'PASS' ELSE 'FAIL' END
FROM exp_fn e JOIN live_fn l ON e.fname = l.fname

-- =====================================================================================================
-- SECTION 5 — TABLE AND COLUMN ACLs (exact).
-- =====================================================================================================
UNION ALL
SELECT format('5_relacl:public.%s', COALESCE(e.tbl, l.tbl)),
       COALESCE(e.relacl, 'ABSENT'), COALESCE(l.relacl, 'ABSENT'),
       CASE WHEN e.relacl IS NOT DISTINCT FROM l.relacl THEN 'PASS' ELSE 'FAIL' END
FROM exp_acl e FULL OUTER JOIN live_acl l ON e.tbl = l.tbl

UNION ALL
SELECT format('5_column_acls:public.%s', tbl), '0', col_acl_count::text,
       CASE WHEN col_acl_count = 0 THEN 'PASS' ELSE 'FAIL' END
FROM live_acl

-- =====================================================================================================
-- SECTION 6 — ROLE CONSTRAINT AND profiles.role SHAPE.
-- Expected TODAY: profiles_role_check does NOT exist (the migration adds it).
-- =====================================================================================================
UNION ALL
SELECT '6a_profiles_role_check', 'ABSENT',
       COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                  WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_role_check'), 'ABSENT'),
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_constraint
                              WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_role_check')
            THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT '6b_profiles_check_constraints',
       'profiles_billing_type_check,profiles_platform_role_check',
       COALESCE((SELECT string_agg(conname, ',' ORDER BY conname COLLATE "C") FROM pg_constraint
                  WHERE conrelid = 'public.profiles'::regclass AND contype = 'c'), '<none>'),
       CASE WHEN COALESCE((SELECT string_agg(conname, ',' ORDER BY conname COLLATE "C") FROM pg_constraint
                            WHERE conrelid = 'public.profiles'::regclass AND contype = 'c'), '<none>')
                 = 'profiles_billing_type_check,profiles_platform_role_check'
            THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT '6c_profiles_role_nullability', 'attnotnull=true|default=''Agent''::text|type=text',
       format('attnotnull=%s|default=%s|type=%s',
              (SELECT attnotnull::text FROM pg_attribute
                WHERE attrelid = 'public.profiles'::regclass AND attname = 'role'),
              COALESCE((SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
                          JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                         WHERE d.adrelid = 'public.profiles'::regclass AND a.attname = 'role'), '<none>'),
              (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
                WHERE attrelid = 'public.profiles'::regclass AND attname = 'role')),
       CASE WHEN format('attnotnull=%s|default=%s|type=%s',
              (SELECT attnotnull::text FROM pg_attribute
                WHERE attrelid = 'public.profiles'::regclass AND attname = 'role'),
              COALESCE((SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
                          JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                         WHERE d.adrelid = 'public.profiles'::regclass AND a.attname = 'role'), '<none>'),
              (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
                WHERE attrelid = 'public.profiles'::regclass AND attname = 'role'))
                 = 'attnotnull=true|default=''Agent''::text|type=text'
            THEN 'PASS' ELSE 'FAIL' END

-- =====================================================================================================
-- SECTION 7 — information_schema GRANTS (exact) and the derived column-privilege row count.
-- The column-privilege expectation is COMPUTED as 4 * (live column count) because information_schema
-- explodes a table-level grant across every column: equality proves the grants are still table-wide
-- and none was narrowed. It stays correct when PR #338 adds welcome_email_sent_at.
-- =====================================================================================================
UNION ALL
SELECT format('7_grants:public.%s:%s', COALESCE(e.tbl, l.tbl), COALESCE(e.grantee, l.grantee)),
       COALESCE(e.privs, 'ABSENT'), COALESCE(l.privs, 'ABSENT'),
       CASE WHEN e.privs IS NOT DISTINCT FROM l.privs THEN 'PASS' ELSE 'FAIL' END
FROM exp_grant e FULL OUTER JOIN live_grant l ON e.tbl = l.tbl AND e.grantee = l.grantee

UNION ALL
SELECT format('7_column_privileges:public.%s:%s', a.tbl, g.grantee),
       (4 * a.col_count)::text,
       (SELECT count(*) FROM information_schema.column_privileges cp
         WHERE cp.table_schema = 'public' AND cp.table_name = a.tbl AND cp.grantee = g.grantee)::text,
       CASE WHEN (SELECT count(*) FROM information_schema.column_privileges cp
                   WHERE cp.table_schema = 'public' AND cp.table_name = a.tbl AND cp.grantee = g.grantee)
                 = 4 * a.col_count
            THEN 'PASS' ELSE 'FAIL' END
FROM live_acl a CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(grantee)

-- =====================================================================================================
-- SECTION 8 — SCHEMA BOUNDARY AND THE profiles UPDATE POLICY SET.
-- The migration creates schema profile_authz plus profile_authz.can_update_profile(uuid), replaces the
-- three live UPDATE policies with the single profiles_update_authorized, and REVOKEs
-- public.workflow_dispatch_event from PUBLIC/anon/authenticated.
--
-- It makes NO change to schema `private`, to any function or table in it, or to pg_default_acl
-- anywhere — the helper-in-`private` design was REJECTED. So the `private` rows below are not rollback
-- proofs at all: they are UNCHANGED-BOUNDARY proofs, and a FAIL on one means something crossed a line
-- the migration was never supposed to approach. Nothing here checks for a helper in `private` or a
-- USAGE grant on it; both belonged to the rejected design.
--
-- After the ROLLBACK every migration-made change must be gone. The values below are the live baseline
-- captured from production on 2026-07-31T15:13:28Z (`private`) and 2026-07-31T16:02:24Z
-- (public.workflow_dispatch_event).
-- =====================================================================================================
UNION ALL
SELECT '8b_policy_profiles_update_authorized_absent', '0',
       (SELECT count(*)::text FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid
               JOIN pg_namespace n ON c.relnamespace = n.oid
         WHERE n.nspname = 'public' AND c.relname = 'profiles'
           AND p.polname = 'profiles_update_authorized'),
       CASE WHEN (SELECT count(*) FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid
                        JOIN pg_namespace n ON c.relnamespace = n.oid
                   WHERE n.nspname = 'public' AND c.relname = 'profiles'
                     AND p.polname = 'profiles_update_authorized') = 0
            THEN 'PASS' ELSE 'FAIL' END

-- The three policies the migration DROPs. SECTION 2 already pins their exact expressions; this row
-- states the restoration as a single unambiguous count.
UNION ALL
SELECT '8c_three_original_update_policies_present', '3',
       (SELECT count(*)::text FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid
               JOIN pg_namespace n ON c.relnamespace = n.oid
         WHERE n.nspname = 'public' AND c.relname = 'profiles'
           AND p.polname IN ('profiles_update_own', 'profiles_update_admin', 'profiles_update_hierarchical')),
       CASE WHEN (SELECT count(*) FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid
                        JOIN pg_namespace n ON c.relnamespace = n.oid
                   WHERE n.nspname = 'public' AND c.relname = 'profiles'
                     AND p.polname IN ('profiles_update_own', 'profiles_update_admin', 'profiles_update_hierarchical')) = 3
            THEN 'PASS' ELSE 'FAIL' END

-- schema `private` must be byte-identical to the capture: no role but postgres holds anything on it.
-- The shipped migration issues no GRANT here at all, so this row proves the boundary was never
-- crossed — by the dry run, or by a rollback that overshot.
UNION ALL
SELECT '8d_private_schema_nspacl', 'postgres=UC/postgres',
       COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C")
                   FROM pg_namespace n, unnest(n.nspacl) a WHERE n.nspname = 'private'), '<null>'),
       CASE WHEN COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C")
                             FROM pg_namespace n, unnest(n.nspacl) a WHERE n.nspname = 'private'), '<null>')
                 = 'postgres=UC/postgres'
            THEN 'PASS' ELSE 'FAIL' END

-- A default-privilege rule lives in a GLOBAL catalog and would survive a rollback that only drops
-- functions. The shipped migration issues none, and the live baseline is 0 rows.
UNION ALL
SELECT '8e_private_default_acl_functions', '0',
       (SELECT count(*)::text FROM pg_default_acl d JOIN pg_namespace n ON d.defaclnamespace = n.oid
         WHERE d.defaclrole::regrole::text = 'postgres' AND n.nspname = 'private' AND d.defaclobjtype = 'f'),
       CASE WHEN (SELECT count(*) FROM pg_default_acl d JOIN pg_namespace n ON d.defaclnamespace = n.oid
                   WHERE d.defaclrole::regrole::text = 'postgres' AND n.nspname = 'private'
                     AND d.defaclobjtype = 'f') = 0
            THEN 'PASS' ELSE 'FAIL' END

-- proacl NULL is PostgreSQL's built-in default (EXECUTE TO PUBLIC) — the exact pre-migration live
-- state. The body md5 is pinned too, so a rollback that re-created the function cannot pass silently.
UNION ALL
SELECT '8f_private_workflow_dispatch_event',
       'proacl=<null>|def_md5=af82e3d5fe84dfca9209c0631be69ae4',
       COALESCE((SELECT format('proacl=%s|def_md5=%s',
                               COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C")
                                           FROM unnest(p.proacl) a), '<null>'),
                               md5(pg_get_functiondef(p.oid)))
                   FROM pg_proc p
                  WHERE p.oid = to_regprocedure('private.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb)')),
                'ABSENT'),
       CASE WHEN COALESCE((SELECT format('proacl=%s|def_md5=%s',
                                         COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C")
                                                     FROM unnest(p.proacl) a), '<null>'),
                                         md5(pg_get_functiondef(p.oid)))
                             FROM pg_proc p
                            WHERE p.oid = to_regprocedure('private.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb)')),
                          'ABSENT')
                 = 'proacl=<null>|def_md5=af82e3d5fe84dfca9209c0631be69ae4'
            THEN 'PASS' ELSE 'FAIL' END

-- The schema the migration actually creates. It is granted USAGE to authenticated, so a surviving
-- profile_authz would leave a live, callable authorization helper in production — the exact opposite
-- of "this dry run persisted nothing".
UNION ALL
SELECT '8g_schema_profile_authz_absent', '0',
       (SELECT count(*)::text FROM pg_namespace n WHERE n.nspname = 'profile_authz'),
       CASE WHEN (SELECT count(*) FROM pg_namespace n WHERE n.nspname = 'profile_authz') = 0
            THEN 'PASS' ELSE 'FAIL' END

-- Checked separately from the schema: a DROP SCHEMA that failed on a dependency would leave the
-- function behind, and a count taken only on the schema would still read 0-if-absent.
UNION ALL
SELECT '8h_profile_authz_can_update_profile_absent', '0',
       (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = 'profile_authz' AND p.proname = 'can_update_profile'),
       CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
                   WHERE n.nspname = 'profile_authz' AND p.proname = 'can_update_profile') = 0
            THEN 'PASS' ELSE 'FAIL' END

-- public.workflow_dispatch_event is the PostgREST-reachable SECURITY DEFINER wrapper the migration
-- REVOKEs from PUBLIC/anon/authenticated. After the rollback its captured ACL must be back VERBATIM,
-- anon=X and authenticated=X included. That expectation is deliberately the VULNERABLE state: a
-- narrower ACL here would mean the dry run persisted a privilege change, and the fix has to land as
-- the reviewed migration, not as an untracked leftover. def_md5 is pinned too, so a rollback that
-- re-created the function cannot pass silently.
UNION ALL
SELECT '8i_public_workflow_dispatch_event',
       'proacl=anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres|def_md5=0fd0695c7f2d6bf8bcd7e0cb0d2bdd67',
       COALESCE((SELECT format('proacl=%s|def_md5=%s',
                               COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C")
                                           FROM unnest(p.proacl) a), '<null>'),
                               md5(pg_get_functiondef(p.oid)))
                   FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb)')),
                'ABSENT'),
       CASE WHEN COALESCE((SELECT format('proacl=%s|def_md5=%s',
                                         COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C")
                                                     FROM unnest(p.proacl) a), '<null>'),
                                         md5(pg_get_functiondef(p.oid)))
                             FROM pg_proc p
                            WHERE p.oid = to_regprocedure('public.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb)')),
                          'ABSENT')
                 = 'proacl=anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres|def_md5=0fd0695c7f2d6bf8bcd7e0cb0d2bdd67'
            THEN 'PASS' ELSE 'FAIL' END

ORDER BY 1;

-- =====================================================================================================
-- BASELINE FINGERPRINT EQUALITY (must match the dry-run preflight exactly)
-- Production project: jncvvsvckxhqgqvkppmj   |   Baseline captured (UTC): 2026-07-31T14:48:55Z
-- =====================================================================================================
SELECT 'fingerprint_policies' AS check, '6c564dcacaea7d7885e6a8495a6384ae' AS expected,
       md5(string_agg(format('%s|%s|%s|%s|%s|%s', c.relname, p.polname, p.polpermissive, p.polcmd,
           coalesce(pg_get_expr(p.polqual,p.polrelid),''), coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')),
           E'\n' ORDER BY c.relname, p.polname)) AS actual,
       CASE WHEN md5(string_agg(format('%s|%s|%s|%s|%s|%s', c.relname, p.polname, p.polpermissive, p.polcmd,
           coalesce(pg_get_expr(p.polqual,p.polrelid),''), coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')),
           E'\n' ORDER BY c.relname, p.polname)) = '6c564dcacaea7d7885e6a8495a6384ae'
            THEN 'PASS' ELSE 'FAIL' END AS status
FROM pg_policy p JOIN pg_class c ON p.polrelid=c.oid WHERE c.relname IN ('profiles','invitations')
UNION ALL
SELECT 'fingerprint_triggers', 'a505cc16fa24e6eaf5d23a3626f70fb4',
       md5(string_agg(format('%s|%s|%s', c.relname, pg_get_triggerdef(t.oid), t.tgenabled), E'\n' ORDER BY c.relname, t.tgname)),
       CASE WHEN md5(string_agg(format('%s|%s|%s', c.relname, pg_get_triggerdef(t.oid), t.tgenabled), E'\n' ORDER BY c.relname, t.tgname))
            = 'a505cc16fa24e6eaf5d23a3626f70fb4' THEN 'PASS' ELSE 'FAIL' END
FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid
WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname IN ('profiles','organizations')
UNION ALL
SELECT 'fingerprint_functions', '8dac1d5931a0fd2c60d7945cbb1639e3',
       md5(string_agg(format('%s|%s|%s|%s|%s|%s', p.proname, md5(pg_get_functiondef(p.oid)), p.proowner::regrole,
           p.prosecdef, coalesce(array_to_string(p.proconfig,','),''), coalesce(array_to_string(p.proacl::text[],','),'')),
           E'\n' ORDER BY p.proname)),
       CASE WHEN md5(string_agg(format('%s|%s|%s|%s|%s|%s', p.proname, md5(pg_get_functiondef(p.oid)), p.proowner::regrole,
           p.prosecdef, coalesce(array_to_string(p.proconfig,','),''), coalesce(array_to_string(p.proacl::text[],','),'')),
           E'\n' ORDER BY p.proname)) = '8dac1d5931a0fd2c60d7945cbb1639e3' THEN 'PASS' ELSE 'FAIL' END
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
WHERE n.nspname='public' AND p.proname IN ('get_invitation_by_token_rpc','compute_hierarchy_path',
      'cascade_hierarchy_update','update_hierarchy_path','on_profile_update','handle_new_user')
UNION ALL
SELECT 'fingerprint_table_acls', '68fe629184134a6e67acff509ee3a00c',
       md5(string_agg(format('%s|%s', c.relname, coalesce(array_to_string(c.relacl::text[],','),'')), E'\n' ORDER BY c.relname)),
       CASE WHEN md5(string_agg(format('%s|%s', c.relname, coalesce(array_to_string(c.relacl::text[],','),'')), E'\n' ORDER BY c.relname))
            = '68fe629184134a6e67acff509ee3a00c' THEN 'PASS' ELSE 'FAIL' END
FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
WHERE n.nspname='public' AND c.relname IN ('profiles','invitations')
UNION ALL
SELECT 'no_fixture_teams', '0', count(*)::text, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END
FROM public.teams WHERE name LIKE 'P0 %' OR name LIKE '%p0test%'
UNION ALL
SELECT 'no_fixture_seeded_rows', '0', count(*)::text, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END
FROM (
  SELECT organization_id FROM public.dispositions
  UNION ALL SELECT organization_id FROM public.pipeline_stages
  UNION ALL SELECT organization_id FROM public.appointment_types
  UNION ALL SELECT organization_id FROM public.lead_sources
) x
WHERE x.organization_id IN (SELECT id FROM public.organizations WHERE slug LIKE 'p0-dryrun-%' OR name LIKE 'P0 %')
   OR x.organization_id::text LIKE 'a0a0a0a0%' OR x.organization_id::text LIKE 'b0b0b0b0%'
ORDER BY 1;
