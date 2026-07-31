-- =====================================================================================================
-- !! EXECUTION WINDOW WARNING - READ BEFORE RUNNING !!
--
--  * This transaction takes ACCESS EXCLUSIVE locks (ALTER TABLE ... DISABLE/ENABLE TRIGGER on
--    public.organizations and public.profiles, plus the migration's own DDL) and HOLDS THEM FOR THE
--    ENTIRE TRANSACTION. Concurrent readers and writers of those tables block until it ends.
--  * Run ONLY inside an explicitly approved low-traffic maintenance window.
--  * Wrap the run in a SHELL-LEVEL total timeout that closes the connection if it exceeds the approved
--    duration, e.g.  timeout --signal=INT 600s psql ...   lock_timeout/statement_timeout bound
--    INDIVIDUAL statements; only a shell timeout bounds the WHOLE run.
--  * A shell timeout, or ANY nonzero psql exit code, is a FAILED RUN and blocks every subsequent
--    action: no migration apply, no Edge Function deploy, no merge. Investigate before retrying.
--  * Run with --set ON_ERROR_STOP=1 and WITHOUT --single-transaction: this script owns its explicit
--    BEGIN ... ROLLBACK.
-- =====================================================================================================

-- =====================================================================================================
-- P0 SECURITY — PRODUCTION DRY RUN (rolled back; nothing is persisted)
--
-- Runs the complete proposed migration AND the complete adversarial authorization matrix inside ONE
-- transaction that ends in an unconditional ROLLBACK. Nothing is committed. No Edge Function, no
-- net.http_* call, no cron, no email, no Twilio, no Vault/secret, no Storage, no CREATE INDEX
-- CONCURRENTLY, and no mutation of any existing production row.
--
-- Fixtures only: UUID prefixes a1111111/b1111111/a0a0a0a0/b0b0b0b0/c1111111 and the reserved
-- @p0test.invalid domain. Every assertion RAISEs on an unexpected outcome, which aborts the run --
-- the transaction is then rolled back either way.
--
-- TWO TRIGGERS ARE TEMPORARILY DISABLED (transactionally, restored before ROLLBACK):
--   public.organizations.on_organization_created_provision_twilio  (would pg_net -> Twilio)
--   public.profiles.on_profile_created_welcome_email               (would pg_net -> email)
-- ALL other triggers stay ACTIVE because they are part of the security assertions:
--   trg_00_enforce_profile_field_authorization (added by the migration), trg_update_hierarchy_path,
--   trg_cascade_hierarchy_update, on_profile_update_trigger (claim sync), profiles_updated_at,
--   on_auth_user_created (handle_new_user), and every invitations policy/constraint.
-- =====================================================================================================

BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '5min';
SET LOCAL client_min_messages = notice;

-- Belt-and-braces: even if the welcome trigger were somehow active, its guard bails when this GUC is
-- empty, so no net.http_post can be queued.
SET LOCAL app.settings.supabase_url = '';
SET LOCAL app.settings.service_role_key = '';

-- -----------------------------------------------------------------------------------------------
-- STEP 0 - PRE-STATE ASSERTIONS + fixture counts BEFORE
-- -----------------------------------------------------------------------------------------------
DO $pre$
DECLARE t_twilio char; t_welcome char; n_fix int;
BEGIN
  SELECT tgenabled INTO t_twilio  FROM pg_trigger WHERE tgname='on_organization_created_provision_twilio' AND tgrelid='public.organizations'::regclass;
  SELECT tgenabled INTO t_welcome FROM pg_trigger WHERE tgname='on_profile_created_welcome_email'        AND tgrelid='public.profiles'::regclass;
  IF t_twilio IS DISTINCT FROM 'O' THEN RAISE EXCEPTION 'PRE-CHECK FAIL: on_organization_created_provision_twilio not enabled (%)', t_twilio; END IF;
  IF t_welcome IS DISTINCT FROM 'O' THEN RAISE EXCEPTION 'PRE-CHECK FAIL: on_profile_created_welcome_email not enabled (%)', t_welcome; END IF;
  RAISE NOTICE 'PRE  triggers enabled: provision_twilio=% welcome_email=%', t_twilio, t_welcome;

  SELECT (SELECT count(*) FROM public.profiles      WHERE email LIKE '%%@p0test.invalid')
       + (SELECT count(*) FROM public.organizations WHERE slug  LIKE 'p0-dryrun-%%')
       + (SELECT count(*) FROM public.invitations   WHERE email LIKE '%%@p0test.invalid')
       + (SELECT count(*) FROM auth.users           WHERE email LIKE '%%@p0test.invalid')
  INTO n_fix;
  IF n_fix <> 0 THEN RAISE EXCEPTION 'PRE-CHECK FAIL: % pre-existing fixture rows found; aborting', n_fix; END IF;
  RAISE NOTICE 'PRE  fixture row count = 0 (clean)';
END
$pre$;

-- -----------------------------------------------------------------------------------------------
-- STEP 0b - BASELINE FINGERPRINT GATE
--
-- Production project: jncvvsvckxhqgqvkppmj
-- Baseline captured (UTC): 2026-07-31T14:48:55Z
--
-- Aborts BEFORE any trigger is disabled and BEFORE any DDL runs if production no longer matches the
-- exact state this script was reviewed against. Digests are md5 over canonically-ordered dumps, so a
-- changed policy expression, trigger definition, function body/owner/security-definer/search_path/ACL,
-- or table ACL flips the digest and stops the run.
-- -----------------------------------------------------------------------------------------------
DO $fingerprint$
DECLARE
  EXP_POL  constant text := '6c564dcacaea7d7885e6a8495a6384ae';
  EXP_TRG  constant text := 'a505cc16fa24e6eaf5d23a3626f70fb4';
  EXP_FN   constant text := '8dac1d5931a0fd2c60d7945cbb1639e3';
  EXP_ACL  constant text := '68fe629184134a6e67acff509ee3a00c';
  -- Private-schema boundary baseline, captured live 2026-07-31T15:13:28Z (same project).
  EXP_PRIV_ACL constant text := 'postgres=UC/postgres';
  EXP_WF_DEF   constant text := 'af82e3d5fe84dfca9209c0631be69ae4';
  got_pol text; got_trg text; got_fn text; got_acl text;
  n_colacl int; n_rolechk int; role_nullable text; n_newfns int;
  n_privfn int; n_newpol int; n_oldpol int; n_defacl int;
  priv_acl text; wf_acl text; wf_def text;
BEGIN
  SELECT md5(string_agg(format('%s|%s|%s|%s|%s|%s', c.relname, p.polname, p.polpermissive, p.polcmd,
              coalesce(pg_get_expr(p.polqual,p.polrelid),''), coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')),
              E'\n' ORDER BY c.relname, p.polname))
    INTO got_pol
  FROM pg_policy p JOIN pg_class c ON p.polrelid=c.oid WHERE c.relname IN ('profiles','invitations');

  SELECT md5(string_agg(format('%s|%s|%s', c.relname, pg_get_triggerdef(t.oid), t.tgenabled), E'\n' ORDER BY c.relname, t.tgname))
    INTO got_trg
  FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid
  WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname IN ('profiles','organizations');

  SELECT md5(string_agg(format('%s|%s|%s|%s|%s|%s', p.proname, md5(pg_get_functiondef(p.oid)), p.proowner::regrole,
              p.prosecdef, coalesce(array_to_string(p.proconfig,','),''), coalesce(array_to_string(p.proacl::text[],','),'')),
              E'\n' ORDER BY p.proname))
    INTO got_fn
  FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
  WHERE n.nspname='public' AND p.proname IN ('get_invitation_by_token_rpc','compute_hierarchy_path',
        'cascade_hierarchy_update','update_hierarchy_path','on_profile_update','handle_new_user');

  SELECT md5(string_agg(format('%s|%s', c.relname, coalesce(array_to_string(c.relacl::text[],','),'')), E'\n' ORDER BY c.relname))
    INTO got_acl
  FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
  WHERE n.nspname='public' AND c.relname IN ('profiles','invitations');

  SELECT count(*) INTO n_colacl FROM pg_attribute a JOIN pg_class c ON a.attrelid=c.oid
   WHERE c.relname IN ('profiles','invitations') AND a.attacl IS NOT NULL;
  SELECT count(*) INTO n_rolechk FROM pg_constraint
   WHERE conrelid='public.profiles'::regclass AND conname='profiles_role_check';
  SELECT is_nullable INTO role_nullable FROM information_schema.columns
   WHERE table_schema='public' AND table_name='profiles' AND column_name='role';
  SELECT count(*) INTO n_newfns FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
   WHERE n.nspname='public' AND p.proname IN ('enforce_profile_field_authorization','provision_organization');

  -- ---------------------------------------------------------------------------------------------
  -- PRIVATE-SCHEMA BOUNDARY + UPDATE-POLICY PRE-STATE
  --
  -- The migration now also crosses the `private` schema boundary (creates private.can_update_profile,
  -- GRANTs USAGE to authenticated, REVOKEs private.workflow_dispatch_event from PUBLIC, and adds a
  -- default-privileges row). These assertions pin the exact pre-migration state that change was
  -- reviewed against, so the run aborts if production has drifted.
  -- ---------------------------------------------------------------------------------------------
  SELECT count(*) INTO n_privfn FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
   WHERE n.nspname='private' AND p.proname='can_update_profile';

  SELECT count(*) INTO n_newpol FROM pg_policy p JOIN pg_class c ON p.polrelid=c.oid
        JOIN pg_namespace n ON c.relnamespace=n.oid
   WHERE n.nspname='public' AND c.relname='profiles' AND p.polname='profiles_update_authorized';

  SELECT count(*) INTO n_oldpol FROM pg_policy p JOIN pg_class c ON p.polrelid=c.oid
        JOIN pg_namespace n ON c.relnamespace=n.oid
   WHERE n.nspname='public' AND c.relname='profiles'
     AND p.polname IN ('profiles_update_own','profiles_update_admin','profiles_update_hierarchical');

  SELECT coalesce(array_to_string(n.nspacl::text[],','),'<null>') INTO priv_acl
    FROM pg_namespace n WHERE n.nspname='private';

  SELECT count(*) INTO n_defacl FROM pg_default_acl d JOIN pg_namespace n ON d.defaclnamespace=n.oid
   WHERE d.defaclrole::regrole::text='postgres' AND n.nspname='private' AND d.defaclobjtype='f';

  SELECT coalesce(array_to_string(p.proacl::text[],','),'<null>'), md5(pg_get_functiondef(p.oid))
    INTO wf_acl, wf_def
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('private.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb)');

  IF got_pol IS DISTINCT FROM EXP_POL THEN RAISE EXCEPTION 'BASELINE MISMATCH: policies digest % (expected %)', got_pol, EXP_POL; END IF;
  IF got_trg IS DISTINCT FROM EXP_TRG THEN RAISE EXCEPTION 'BASELINE MISMATCH: triggers digest % (expected %)', got_trg, EXP_TRG; END IF;
  IF got_fn  IS DISTINCT FROM EXP_FN  THEN RAISE EXCEPTION 'BASELINE MISMATCH: functions digest % (expected %)', got_fn,  EXP_FN;  END IF;
  IF got_acl IS DISTINCT FROM EXP_ACL THEN RAISE EXCEPTION 'BASELINE MISMATCH: table ACL digest % (expected %)', got_acl, EXP_ACL; END IF;
  IF n_colacl <> 0 THEN RAISE EXCEPTION 'BASELINE MISMATCH: % column ACL(s) exist, expected 0', n_colacl; END IF;
  IF n_rolechk <> 0 THEN RAISE EXCEPTION 'BASELINE MISMATCH: profiles_role_check already exists'; END IF;
  IF role_nullable <> 'NO' THEN RAISE EXCEPTION 'BASELINE MISMATCH: profiles.role nullability is %, expected NO', role_nullable; END IF;
  IF n_newfns <> 0 THEN RAISE EXCEPTION 'BASELINE MISMATCH: % migration-added function(s) already exist', n_newfns; END IF;

  IF n_privfn <> 0 THEN RAISE EXCEPTION 'BASELINE MISMATCH: private.can_update_profile already exists (% overload(s)), expected 0', n_privfn; END IF;
  IF n_newpol <> 0 THEN RAISE EXCEPTION 'BASELINE MISMATCH: policy profiles_update_authorized already exists on public.profiles, expected 0'; END IF;
  IF n_oldpol <> 3 THEN RAISE EXCEPTION 'BASELINE MISMATCH: % of the 3 original profiles UPDATE policies present (profiles_update_own/profiles_update_admin/profiles_update_hierarchical), expected 3', n_oldpol; END IF;
  IF priv_acl IS NULL THEN RAISE EXCEPTION 'BASELINE MISMATCH: schema private does not exist'; END IF;
  IF priv_acl IS DISTINCT FROM EXP_PRIV_ACL THEN RAISE EXCEPTION 'BASELINE MISMATCH: private schema nspacl is % (expected %)', priv_acl, EXP_PRIV_ACL; END IF;
  IF n_defacl <> 0 THEN RAISE EXCEPTION 'BASELINE MISMATCH: % pg_default_acl row(s) for (postgres, private, functions), expected 0', n_defacl; END IF;
  IF wf_def IS NULL THEN RAISE EXCEPTION 'BASELINE MISMATCH: private.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb) not found'; END IF;
  IF wf_acl IS DISTINCT FROM '<null>' THEN RAISE EXCEPTION 'BASELINE MISMATCH: private.workflow_dispatch_event proacl is % (expected NULL, i.e. the built-in PUBLIC EXECUTE default)', wf_acl; END IF;
  IF wf_def IS DISTINCT FROM EXP_WF_DEF THEN RAISE EXCEPTION 'BASELINE MISMATCH: private.workflow_dispatch_event definition md5 % (expected %)', wf_def, EXP_WF_DEF; END IF;

  RAISE NOTICE 'STEP0b baseline fingerprint MATCHES (policies/triggers/functions/ACLs, 0 column ACLs, no role CHECK, role NOT NULL, 0 new fns)';
  RAISE NOTICE 'STEP0b private-schema baseline MATCHES (no private.can_update_profile, no profiles_update_authorized, 3 original UPDATE policies, private.nspacl=%, 0 default-ACL rows, workflow_dispatch_event proacl NULL)', priv_acl;
END
$fingerprint$;

-- -----------------------------------------------------------------------------------------------
-- STEP 1 - transactionally disable ONLY the two external-effect triggers
-- -----------------------------------------------------------------------------------------------
ALTER TABLE public.organizations DISABLE TRIGGER on_organization_created_provision_twilio;
ALTER TABLE public.profiles      DISABLE TRIGGER on_profile_created_welcome_email;

DO $chk$
DECLARE a char; b char;
BEGIN
  SELECT tgenabled INTO a FROM pg_trigger WHERE tgname='on_organization_created_provision_twilio' AND tgrelid='public.organizations'::regclass;
  SELECT tgenabled INTO b FROM pg_trigger WHERE tgname='on_profile_created_welcome_email'        AND tgrelid='public.profiles'::regclass;
  IF a <> 'D' OR b <> 'D' THEN RAISE EXCEPTION 'FAIL: external-effect triggers not disabled (%/%)', a, b; END IF;
  RAISE NOTICE 'STEP1 external-effect triggers disabled';
END
$chk$;

-- =============================================================================
-- =============================================================================
-- =============================================================================
-- P0 SECURITY — profile authorization + invitation write hardening
-- [#APPROVE_RLS_CHANGE granted by Chris, 2026-07-30]
--
-- WHAT THIS CLOSES
--
-- (1) public.profiles policy `profiles_update_own` was UPDATE, TO PUBLIC,
--     USING (id = auth.uid()) with NO WITH CHECK. Postgres reuses USING as the
--     check, so any authenticated user could set ANY column on their own row —
--     including role, is_super_admin, organization_id, platform_role and
--     hierarchy_path.
--
--     That is not cosmetic. The AFTER trigger on_profile_update calls
--     set_claim(), which writes auth.users.raw_app_meta_data; get_user_role()
--     gates 109 policies and get_org_id() gates 179. custom_access_token_hook
--     re-mints the same values as JWT claims on refresh. So a self-UPDATE of
--     profiles.role/organization_id was a cross-tenant account takeover.
--
-- (2) policy `profiles_insert` was INSERT, TO PUBLIC, WITH CHECK (true), and
--     anon held the INSERT grant, with an attacker-chosen id. (Supabase
--     advisor lint 0024_permissive_rls_policy.)
--
-- (3) twilio_client_identity is a capability minted into a Twilio access token
--     (twilio-token/index.ts) and has no unique constraint, so overwriting it
--     with a peer's value enabled inbound-call interception.
--
-- (4) hierarchy_path was directly forgeable: trg_update_hierarchy_path is
--     scoped `UPDATE OF upline_id`, so a statement writing ONLY hierarchy_path
--     never triggered the recompute. That ltree feeds is_ancestor_of(), which
--     gates 7 policies across 6 tables.
--
-- (5) invitations policy `invitations_update_status` was UPDATE TO authenticated
--     USING (true). It is inert TODAY only because invitations_status_check
--     requires capitalized values while the policy demands lowercase
--     'accepted' — but USING (true) destroys row scoping, and RLS cannot
--     restrict COLUMNS, so one relaxed constraint away it becomes a
--     cross-tenant rewrite primitive over email/role/organization_id/token.
--
-- DEFENSE IN DEPTH — three independent layers, per the approved plan:
--   Layer 1  least-privilege GRANTs (incl. column-level UPDATE)
--   Layer 2  least-privilege RLS policies
--   Layer 3  a BEFORE trigger enforcing per-column authorization
--
-- TRUSTED AUTHORIZATION SOURCE: the enforcement function resolves the actor by
-- reading public.profiles directly for auth.uid() — NEVER the JWT and NEVER
-- user_metadata. The JWT's role/org/is_super_admin claims are DERIVED from the
-- very columns being protected, so trusting them would let a poisoned claim
-- authorize its own poisoning.
--
-- NOT APPLIED BY THIS COMMIT. Rollback block at the bottom.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Pre-flight — fail loudly rather than silently corrupting authorization
-- -----------------------------------------------------------------------------
DO $preflight$
DECLARE
  bad_roles text;
BEGIN
  SELECT string_agg(DISTINCT role, ', ') INTO bad_roles
  FROM public.profiles
  WHERE role IS NULL OR role NOT IN ('Agent', 'Team Leader', 'Admin', 'Super Admin');

  IF bad_roles IS NOT NULL THEN
    RAISE EXCEPTION
      'P0 migration aborted: profiles.role contains non-canonical values (%). Reconcile before applying.',
      bad_roles;
  END IF;
END
$preflight$;

-- -----------------------------------------------------------------------------
-- 1. Canonical role allowlist (closes the "any string is a role" hole)
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('Agent', 'Team Leader', 'Admin', 'Super Admin'));

-- -----------------------------------------------------------------------------
-- 2. Layer 3 — protected-column enforcement
--
-- Fires BEFORE INSERT OR UPDATE. Named trg_00_* so it runs BEFORE
-- trg_update_hierarchy_path (Postgres fires BEFORE triggers in alphabetical
-- order): the guard therefore inspects the CLIENT-supplied row, and the
-- recompute trigger legitimately assigns hierarchy_path afterwards.
--
-- `updated_at` is deliberately NOT guarded — the profiles_updated_at BEFORE
-- trigger (which sorts before this one) already forces it to now(), so any
-- client-supplied value is discarded by construction.
--
-- welcome_email_sent_at does not exist until PR #338 lands; membership is
-- tested with `to_jsonb(NEW) ? '<col>'` (the AGENT_RULES invariant #10 idiom)
-- so protection turns on automatically when the column appears.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_profile_field_authorization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id             uuid := auth.uid();
  actor_role           text;
  actor_org            uuid;
  actor_is_super       boolean := false;
  actor_platform_role  text;
  actor_is_platform    boolean := false;
  is_self              boolean;
  has_welcome_col      boolean := (to_jsonb(NEW) ? 'welcome_email_sent_at');
BEGIN
  -- System callers (service role, SECURITY DEFINER triggers, cron) have no
  -- auth.uid() and are trusted: handle_new_user, cascade_hierarchy_update,
  -- sync_last_login_at, twilio-token, send-welcome-email, seed scripts.
  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Trusted source: the actor's OWN row, read directly (RLS is bypassed here
  -- because this function is SECURITY DEFINER owned by postgres and
  -- relforcerowsecurity is false). Never the JWT.
  SELECT p.role, p.organization_id, COALESCE(p.is_super_admin, false), p.platform_role
    INTO actor_role, actor_org, actor_is_super, actor_platform_role
  FROM public.profiles p
  WHERE p.id = actor_id;

  -- FAIL CLOSED. `SELECT ... INTO` leaves EVERY target variable NULL when no row
  -- matches, so an authenticated Auth user with no profile row would otherwise
  -- reach the gates below with actor_is_super = NULL / actor_is_platform = NULL —
  -- and `IF NOT NULL` is treated as false by plpgsql, silently PERMITTING the
  -- protected write. Forged JWT claims cannot help here: the actor is resolved
  -- from public.profiles, never from the token.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authenticated actor profile not found'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Normalise every authorization boolean to a non-NULL value. `x = 'literal'`
  -- yields NULL (not false) when x IS NULL, which is exactly how the
  -- platform_role gate could be bypassed by any actor whose platform_role was
  -- NULL — i.e. every ordinary user.
  actor_is_super    := COALESCE(actor_is_super, false);
  actor_is_platform := COALESCE(actor_platform_role = 'platform_admin', false);
  is_self           := COALESCE(actor_id = NEW.id, false);

  -- ---------------------------------------------------------------------
  -- INSERT: only the system may create profile rows. The client INSERT
  -- policy is dropped below, so this is belt-and-braces.
  -- ---------------------------------------------------------------------
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Profile rows may only be created by the system'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------------------
  -- Tier: SYSTEM-ONLY — never writable by any authenticated caller.
  -- (Also column-REVOKEd in Layer 1; this is the second line of defense.)
  -- ---------------------------------------------------------------------
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profiles.id is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'profiles.organization_id may only be changed by the system (tenancy is not user-editable)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- hierarchy_path must equal the value the database derives for this row.
  --
  -- A plain "changed => reject" test would break legitimate maintenance: the
  -- AFTER trigger trg_cascade_hierarchy_update issues a nested
  -- `UPDATE profiles SET hierarchy_path = compute_hierarchy_path(id)` over every
  -- descendant when an upline changes, and SECURITY DEFINER does NOT reset
  -- auth.uid() (it reads the request GUC, which stays set for the whole
  -- PostgREST transaction) — so those nested updates arrive here with a
  -- non-null actor and would abort the admin's upline change with 42501.
  --
  -- Comparing against compute_hierarchy_path() instead enforces the real
  -- invariant ("database-derived only"): the cascade's correct value passes,
  -- while any forged ltree an attacker supplies does not.
  IF NEW.hierarchy_path IS DISTINCT FROM OLD.hierarchy_path
     AND NEW.hierarchy_path IS DISTINCT FROM public.compute_hierarchy_path(NEW.id) THEN
    RAISE EXCEPTION 'profiles.hierarchy_path is database-derived; change upline_id instead'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.twilio_client_identity IS DISTINCT FROM OLD.twilio_client_identity THEN
    RAISE EXCEPTION 'profiles.twilio_client_identity is system-managed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.last_login_at IS DISTINCT FROM OLD.last_login_at THEN
    RAISE EXCEPTION 'profiles system timestamps are not user-editable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF has_welcome_col
     AND (to_jsonb(NEW) -> 'welcome_email_sent_at') IS DISTINCT FROM (to_jsonb(OLD) -> 'welcome_email_sent_at') THEN
    RAISE EXCEPTION 'profiles.welcome_email_sent_at is system-managed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------------------
  -- Tier: PLATFORM-ONLY — AgentFlow staff powers, never self-granted.
  -- ---------------------------------------------------------------------
  IF COALESCE(NEW.is_super_admin, false) IS DISTINCT FROM COALESCE(OLD.is_super_admin, false) THEN
    IF actor_is_super IS NOT TRUE THEN
      RAISE EXCEPTION 'Only a platform super admin may change is_super_admin'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF is_self IS TRUE THEN
      RAISE EXCEPTION 'is_super_admin may not be changed on your own profile'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.platform_role IS DISTINCT FROM OLD.platform_role THEN
    IF actor_is_platform IS NOT TRUE THEN
      RAISE EXCEPTION 'Only a platform admin may change platform_role'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF is_self IS TRUE THEN
      RAISE EXCEPTION 'platform_role may not be changed on your own profile'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- Tier: ADMIN-MANAGED — same-org Admin/Super Admin, or platform super
  -- admin cross-org. Self-promotion is barred for every actor.
  -- ---------------------------------------------------------------------
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF is_self IS TRUE THEN
      RAISE EXCEPTION 'You may not change your own role'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- `IS NOT TRUE`, not `NOT (...)`: when OLD.organization_id IS NULL the
    -- comparison yields NULL, and plpgsql treats a NULL IF as false — which
    -- would silently ALLOW the protected write. Org-less rows are real (a
    -- self-serve profile exists briefly with organization_id NULL).
    IF (
      actor_is_super
      OR (actor_role IN ('Admin', 'Super Admin') AND actor_org IS NOT NULL AND actor_org = OLD.organization_id)
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'Only an Admin of this organization may change a member role'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Explicit role-transition allowlist. Only a platform super admin may
    -- mint the 'Super Admin' agency role.
    IF NEW.role NOT IN ('Agent', 'Team Leader', 'Admin', 'Super Admin') THEN
      RAISE EXCEPTION 'Role % is not an allowed role', NEW.role
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.role = 'Super Admin' AND actor_is_super IS NOT TRUE THEN
      RAISE EXCEPTION 'Only a platform super admin may grant the Super Admin role'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.team_id IS DISTINCT FROM OLD.team_id
     OR NEW.upline_id IS DISTINCT FROM OLD.upline_id
     OR NEW.billing_type IS DISTINCT FROM OLD.billing_type THEN
    IF (
      actor_is_super
      OR (actor_role IN ('Admin', 'Super Admin') AND actor_org IS NOT NULL AND actor_org = OLD.organization_id)
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'Only an Admin of this organization may change account-control fields (status, team, upline, billing)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_profile_field_authorization() IS
  'P0: per-column authorization guard for public.profiles. Resolves the actor from public.profiles (never the JWT, never user_metadata) because the JWT claims are derived from the protected columns themselves. Trigger-invoked only; EXECUTE revoked from PUBLIC/anon/authenticated.';

REVOKE ALL ON FUNCTION public.enforce_profile_field_authorization() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_00_enforce_profile_field_authorization ON public.profiles;
CREATE TRIGGER trg_00_enforce_profile_field_authorization
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_field_authorization();

-- -----------------------------------------------------------------------------
-- 3. Layer 2 — least-privilege RLS on public.profiles
--
-- These four policies exist ONLY in the live database (never in
-- supabase/migrations/), and permissive policies OR together — so each must be
-- explicitly DROPped or the old hole survives alongside the new policy.
-- SELECT policies are intentionally untouched (deferred: issue #339).
-- -----------------------------------------------------------------------------

-- (a) Unrestricted public INSERT — dropped outright, not replaced.
--     No client-side INSERT into profiles exists anywhere in the repo; rows are
--     created by SECURITY DEFINER handle_new_user, which bypasses RLS.
DROP POLICY IF EXISTS profiles_insert ON public.profiles;

-- (b) ONE database-authoritative UPDATE policy replaces all three.
--
-- WHY: the three live UPDATE policies were PERMISSIVE, so they OR together, and
-- two of them decided authorization from the JWT: get_user_role() reads ONLY
-- current_setting('request.jwt.claims'), and get_org_id() prefers the token's
-- app_metadata.organization_id. A stale or previously-poisoned token therefore
-- still satisfied Layer 2 for non-protected columns, even after the database had
-- demoted or moved that user. Layer 2 must be database-authoritative, not
-- token-authoritative, or it is not an independent layer at all.
--
-- private.can_update_profile() resolves BOTH the actor and the target from
-- public.profiles and never consults the JWT beyond auth.uid() (an identity, not
-- an authorization claim). It lives in the non-exposed `private` schema so it is
-- not reachable through PostgREST.
--
-- Division of responsibility (unchanged): RLS decides WHICH ROW may be updated;
-- trg_00_enforce_profile_field_authorization decides WHICH COLUMNS and which
-- transitions are allowed. They remain independent layers.
CREATE OR REPLACE FUNCTION private.can_update_profile(p_target_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id      uuid := auth.uid();
  a_role        text;
  a_org         uuid;
  a_super       boolean;
  t_org         uuid;
BEGIN
  -- Unauthenticated / system paths never rely on this policy (service role and
  -- SECURITY DEFINER callers bypass RLS entirely).
  IF actor_id IS NULL OR p_target_profile_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.role, p.organization_id, COALESCE(p.is_super_admin, false)
    INTO a_role, a_org, a_super
  FROM public.profiles p
  WHERE p.id = actor_id;
  IF NOT FOUND THEN
    RETURN false;                      -- authenticated but no profile => no authority
  END IF;

  SELECT p.organization_id INTO t_org
  FROM public.profiles p
  WHERE p.id = p_target_profile_id;
  IF NOT FOUND THEN
    RETURN false;                      -- unknown target
  END IF;

  a_super := COALESCE(a_super, false);

  -- Everyone may update their own row (column limits are the trigger's job).
  IF p_target_profile_id = actor_id THEN
    RETURN true;
  END IF;

  -- Org boundary for every non-self case. NULL-safe: a NULL org on either side
  -- yields NULL from `=`, so COALESCE it to false rather than letting a NULL
  -- propagate into the return value.
  IF COALESCE(a_org = t_org, false) IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- Platform super admin: preserved at OWN-ORG scope only, matching the live
  -- super_admin_own_org() behaviour. Cross-organization browser writes are NOT
  -- broadened here.
  IF a_super IS TRUE THEN
    RETURN true;
  END IF;

  IF a_role IN ('Admin', 'Super Admin') THEN
    RETURN true;
  END IF;

  IF a_role = 'Team Leader' THEN
    RETURN COALESCE(public.is_ancestor_of(actor_id, p_target_profile_id), false);
  END IF;

  -- Agent (and any unrecognised role): self only, already handled above.
  RETURN false;
END;
$$;

COMMENT ON FUNCTION private.can_update_profile(uuid) IS
  'P0 Layer 2: database-authoritative row authorization for UPDATE on public.profiles. Resolves actor and target from public.profiles; never reads JWT role/org/is_super_admin/platform_role or user_metadata. Returns only a boolean (no profile data).';

REVOKE ALL ON FUNCTION private.can_update_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_update_profile(uuid) TO authenticated;

-- An RLS policy expression is evaluated with the privileges of the querying
-- user, so `authenticated` needs USAGE on the schema as well as EXECUTE on the
-- function -- without it EVERY profile UPDATE fails with
-- "permission denied for schema private". Verified live: private.nspacl is
-- postgres=UC/postgres, i.e. authenticated currently has no USAGE.
GRANT USAGE ON SCHEMA private TO authenticated;

-- Granting that USAGE would otherwise newly expose private.workflow_dispatch_event,
-- whose proacl is NULL (PostgreSQL default = EXECUTE to PUBLIC). This REVOKE
-- closes the DIRECT path that the new USAGE grant would have opened; the private
-- function is only meant to be reached through the SECURITY DEFINER wrapper
-- public.workflow_dispatch_event (owned by postgres, which keeps EXECUTE).
--
-- SCOPE NOTE - do not overstate this. The PUBLIC wrapper remains callable by anon
-- and authenticated through PostgREST (/rest/v1/rpc/workflow_dispatch_event); it
-- is a bare pass-through that forwards all six arguments, including a
-- caller-supplied p_org_id, with NO authorization check and errors swallowed into
-- a RAISE WARNING. That is PRE-EXISTING and is NOT closed by this migration.
-- Recorded as INFO-3 in the dry run and tracked for separate triage.
REVOKE ALL ON FUNCTION private.workflow_dispatch_event(uuid, text, text, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- Future functions created by postgres in `private` must not inherit PostgreSQL's
-- built-in default of EXECUTE TO PUBLIC either. Captured live: there is NO
-- pg_default_acl row for (postgres, private, functions), so the built-in default
-- is in force today; this adds an explicit row that removes the PUBLIC grant.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- private.close_stale_dialer_sessions already has an explicit postgres-only ACL.
-- No CREATE on the schema, and no grants on private tables/sequences.

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_update_hierarchical ON public.profiles;

CREATE POLICY profiles_update_authorized ON public.profiles
  FOR UPDATE TO authenticated
  USING (private.can_update_profile(id))
  WITH CHECK (private.can_update_profile(id));

-- -----------------------------------------------------------------------------
-- 4. Layer 1 — least-privilege GRANTs on public.profiles
--
-- anon needs nothing: signup runs through the create-user Edge Function on the
-- service role, the profile row is written by SECURITY DEFINER handle_new_user,
-- login uses only supabase.auth.*, and the invite page uses a definer RPC.
--
-- authenticated needs SELECT + a COLUMN-SCOPED UPDATE. There is no client-side
-- INSERT and no hard DELETE (deleteUser is a soft delete to status='Deleted').
--
-- The excluded columns are exactly those no browser caller ever references, so
-- the 42501 "column not privileged" failure mode cannot break a real payload.
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.profiles FROM anon;

REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM authenticated;

GRANT UPDATE (
  first_name, last_name, email, phone, role, status, availability_status,
  avatar_url, theme_preference, updated_at, resident_state, commission_level,
  npn, timezone, win_sound_enabled, email_notifications_enabled,
  sms_notifications_enabled, push_notifications_enabled, licensed_states,
  carriers, auto_dial_preference, local_presence_enabled, upline_id,
  monthly_call_goal, monthly_policies_goal, weekly_appointments_goal,
  monthly_talk_time_goal, monthly_premium_goal, weekly_appointment_goal,
  team_id, is_super_admin, onboarding_complete, monthly_appointment_goal,
  billing_type, platform_role
) ON public.profiles TO authenticated;

-- NOT granted (system-only, enforced at the privilege layer):
--   id, organization_id, hierarchy_path, created_at, last_login_at,
--   twilio_client_identity, welcome_email_sent_at (when it exists)

-- -----------------------------------------------------------------------------
-- 4b. Atomic founder-organization provisioning
--
-- Requirement 15 ("signup must not leave orphaned users, organizations, or
-- accepted invitations — use a transaction where the platform permits it").
--
-- An Edge Function CANNOT compensate a failed organization creation: 41 tables
-- hold ON DELETE NO ACTION foreign keys to public.organizations, and the org is
-- populated by its own AFTER INSERT triggers (pipeline_stages, appointment
-- types) plus the disposition seed before any later step can fail — so a
-- DELETE would raise 23503 and the orphan would survive.
--
-- Postgres, however, does permit a transaction: this function performs the org
-- insert, the disposition seed and the profile attach as ONE statement-level
-- unit. If any part fails the whole thing rolls back — including the pg_net
-- row queued by the Twilio provisioning trigger, so no external subaccount is
-- stranded either. create-user then only has to delete the auth user.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_organization(
  p_name           text,
  p_slug           text,
  p_owner_user_id  uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_org_id uuid;
  attached   int;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  INSERT INTO public.organizations (name, slug)
  VALUES (btrim(p_name), p_slug)
  RETURNING id INTO new_org_id;

  -- Default dispositions. Pipeline stages and appointment types are seeded by
  -- existing AFTER INSERT triggers on public.organizations — do NOT add them.
  INSERT INTO public.dispositions
    (name, color, is_locked, campaign_action, dnc_auto_add, appointment_scheduler, callback_scheduler, organization_id, sort_order)
  VALUES
    ('No Answer',       '#3B82F6', true,  'none',                  false, false, false, new_org_id, 0),
    ('Appointment Set', '#10B981', true,  'remove_from_queue',     false, true,  false, new_org_id, 1),
    ('Call Back',       '#F59E0B', false, 'none',                  false, false, true,  new_org_id, 2),
    ('Not Interested',  '#EF4444', false, 'remove_from_campaign',  false, false, false, new_org_id, 3),
    ('DNC',             '#000000', true,  'remove_from_campaign',  true,  false, false, new_org_id, 4),
    ('Sold',            '#059669', false, 'remove_from_queue',     false, false, false, new_org_id, 5);

  -- Attach the founder as Admin of the organization just created. This runs
  -- inside the same transaction, so a failure here rolls the organization back.
  IF p_owner_user_id IS NOT NULL THEN
    UPDATE public.profiles
       SET organization_id = new_org_id,
           role            = 'Admin'
     WHERE id = p_owner_user_id;
    GET DIAGNOSTICS attached = ROW_COUNT;
    IF attached <> 1 THEN
      RAISE EXCEPTION 'Founder profile % not found; rolling back organization', p_owner_user_id;
    END IF;
  END IF;

  RETURN new_org_id;
END;
$$;

COMMENT ON FUNCTION public.provision_organization(text, text, uuid) IS
  'P0: atomic organization provisioning (org + default dispositions + optional founder attach). Used by create-user self-serve signup and create-organization. Service-role only.';

REVOKE ALL ON FUNCTION public.provision_organization(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_organization(text, text, uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Invitations write hardening
--
-- invitations_update_status (USING true) is dropped: there is no legitimate
-- browser writer of status='Accepted' — both acceptance writers (create-user,
-- accept-invite) use the service role and bypass RLS.
--
-- The one real browser UPDATE is revokeInvitation (status -> 'Revoked'), so
-- authenticated keeps a COLUMN-SCOPED UPDATE(status) only. RLS has no column
-- granularity, so without this REVOKE an authorized statement could rewrite
-- email/role/organization_id/upline_id/commission_level/token/expires_at.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS invitations_update_status ON public.invitations;

-- Replace the FOR ALL policy with per-command policies.
DROP POLICY IF EXISTS invitations_org_admin_manage ON public.invitations;

CREATE POLICY invitations_delete_org_admin ON public.invitations
  FOR DELETE TO authenticated
  USING (
    super_admin_own_org(organization_id)
    OR (
      organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid())
      AND (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()) IN ('Admin', 'Super Admin', 'Team Leader')
    )
  );

-- Pending -> Revoked only, by an admin of the invitation's own organization.
CREATE POLICY invitations_revoke_org_admin ON public.invitations
  FOR UPDATE TO authenticated
  USING (
    status = 'Pending'
    AND (
      super_admin_own_org(organization_id)
      OR (
        organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid())
        AND (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()) IN ('Admin', 'Super Admin', 'Team Leader')
      )
    )
  )
  WITH CHECK (status = 'Revoked');

-- The dropped FOR ALL policy also granted Team Leaders SELECT on their org's
-- invitations (invitations_select alone is Admin/Super Admin only). Restore
-- exactly that read so Pending Invites does not silently empty for them.
CREATE POLICY invitations_select_team_leader ON public.invitations
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid())
    AND (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()) = 'Team Leader'
  );

REVOKE UPDATE ON public.invitations FROM anon, authenticated;
GRANT UPDATE (status) ON public.invitations TO authenticated;
REVOKE ALL ON public.invitations FROM anon;

-- invitations_insert and invitations_select are unchanged (both already
-- TO authenticated and org-scoped); invitations_service_role is unchanged.

-- -----------------------------------------------------------------------------
-- 6. Stop leaking revoked/expired invitations to anonymous token holders
-- -----------------------------------------------------------------------------
-- Signature preserved EXACTLY (invite_token text, same 14 output columns in the
-- same order) — AcceptInvitePage needs `status` and `expires_at` to render its
-- distinct revoked / expired / already-used messages, so the row must still be
-- returned. What changes: when the invitation is NOT usable (not Pending, or
-- past expiry) the authority and PII columns are nulled out, so an anonymous
-- token holder can no longer read organization, role, upline, commission,
-- licensed states, or the invitee's email from a dead invitation.
CREATE OR REPLACE FUNCTION public.get_invitation_by_token_rpc(invite_token text)
RETURNS TABLE (
  id uuid, email text, organization_id uuid, role text, upline_id uuid,
  first_name text, last_name text, licensed_states jsonb, commission_level text,
  token text, expires_at timestamp with time zone, created_at timestamp with time zone,
  status text, org_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    CASE WHEN u.usable THEN i.email ELSE NULL END,
    CASE WHEN u.usable THEN i.organization_id ELSE NULL END,
    CASE WHEN u.usable THEN i.role ELSE NULL END,
    CASE WHEN u.usable THEN i.upline_id ELSE NULL END,
    CASE WHEN u.usable THEN i.first_name ELSE NULL END,
    CASE WHEN u.usable THEN i.last_name ELSE NULL END,
    CASE WHEN u.usable THEN i.licensed_states ELSE NULL END,
    CASE WHEN u.usable THEN i.commission_level ELSE NULL END,
    i.token::TEXT,
    i.expires_at,
    i.created_at,
    i.status,
    CASE WHEN u.usable THEN o.name ELSE NULL END
  FROM public.invitations i
  LEFT JOIN public.organizations o ON i.organization_id = o.id
  CROSS JOIN LATERAL (SELECT (i.status = 'Pending' AND i.expires_at > now()) AS usable) u
  WHERE i.token::TEXT = invite_token
  LIMIT 1;
END;
$function$;

COMMENT ON FUNCTION public.get_invitation_by_token_rpc(text) IS
  'P0: still returns the row (status/expires_at drive the AcceptInvitePage messaging) but nulls organization, role, upline, commission, licensed_states, email and org_name unless the invitation is Pending and unexpired — a dead token no longer discloses tenant data to an anonymous caller.';

-- =============================================================================
-- ROLLBACK (verbatim pre-change state; apply in this order)
-- =============================================================================
-- DROP TRIGGER IF EXISTS trg_00_enforce_profile_field_authorization ON public.profiles;
-- DROP FUNCTION IF EXISTS public.enforce_profile_field_authorization();
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
--
-- GRANT ALL ON public.profiles TO anon;
-- GRANT ALL ON public.profiles TO authenticated;
-- GRANT ALL ON public.invitations TO anon;
-- GRANT UPDATE ON public.invitations TO authenticated;
--
-- DROP POLICY IF EXISTS profiles_update_authorized ON public.profiles;
-- DROP FUNCTION IF EXISTS private.can_update_profile(uuid);
-- REVOKE USAGE ON SCHEMA private FROM authenticated;
-- --   restores private.nspacl to the captured live value: postgres=UC/postgres
--
-- -- Restore the workflow dispatcher's captured live ACL. Live proacl is NULL,
-- -- i.e. PostgreSQL's default of EXECUTE TO PUBLIC; granting EXECUTE back to
-- -- PUBLIC returns proacl to NULL because Postgres drops an ACL that equals the
-- -- built-in default.
-- GRANT EXECUTE ON FUNCTION private.workflow_dispatch_event(uuid, text, text, uuid, text, jsonb) TO PUBLIC;
--
-- -- Restore default privileges. Live state has NO pg_default_acl row for
-- -- (postgres, private, functions); granting EXECUTE back to PUBLIC makes the
-- -- effective ACL equal the built-in default, so Postgres REMOVES the row again.
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
--   GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
--
-- CREATE POLICY profiles_update_own ON public.profiles
--   FOR UPDATE USING (id = auth.uid());
--
-- CREATE POLICY profiles_update_admin ON public.profiles
--   FOR UPDATE USING (organization_id = get_user_org_id() AND get_user_role() = 'Admin');
--
-- CREATE POLICY profiles_update_hierarchical ON public.profiles
--   FOR UPDATE TO authenticated
--   USING (((organization_id IS NOT NULL) AND super_admin_own_org(organization_id)) OR ((organization_id = get_org_id()) AND ((get_user_role() = 'Admin'::text) OR ((get_user_role() = 'Team Leader'::text) AND ((id = auth.uid()) OR is_ancestor_of(auth.uid(), id))) OR ((get_user_role() = 'Agent'::text) AND (id = auth.uid())))))
--   WITH CHECK (((organization_id IS NOT NULL) AND super_admin_own_org(organization_id)) OR ((organization_id = get_org_id()) AND ((get_user_role() = 'Admin'::text) OR ((get_user_role() = 'Team Leader'::text) AND ((id = auth.uid()) OR is_ancestor_of(auth.uid(), id))) OR ((get_user_role() = 'Agent'::text) AND (id = auth.uid())))));
--
-- CREATE POLICY profiles_insert ON public.profiles FOR INSERT WITH CHECK (true);
--
-- DROP POLICY IF EXISTS invitations_delete_org_admin ON public.invitations;
-- DROP POLICY IF EXISTS invitations_revoke_org_admin ON public.invitations;
-- CREATE POLICY invitations_org_admin_manage ON public.invitations
--   FOR ALL TO authenticated
--   USING (super_admin_own_org(organization_id) OR ((organization_id = ( SELECT profiles.organization_id
--      FROM profiles WHERE (profiles.id = auth.uid()))) AND (( SELECT profiles.role
--      FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['Admin'::text, 'Team Leader'::text]))))
--   WITH CHECK (super_admin_own_org(organization_id) OR ((organization_id = ( SELECT profiles.organization_id
--      FROM profiles WHERE (profiles.id = auth.uid()))) AND (( SELECT profiles.role
--      FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['Admin'::text, 'Team Leader'::text]))));
-- CREATE POLICY invitations_update_status ON public.invitations
--   FOR UPDATE TO authenticated USING (true) WITH CHECK (status = 'accepted');
--
-- DROP FUNCTION IF EXISTS public.provision_organization(text, text, uuid);
--
-- get_invitation_by_token_rpc — restore the VERBATIM pre-change live body.
-- Do NOT use supabase/migrations/20260402000004_fix_invitations_leak.sql: that
-- historical definition declares 15 OUT columns (it includes accepted_at) while
-- the live function has 14, so replaying it fails with "cannot change return
-- type of existing function". The body below was captured from
-- pg_get_functiondef on the live database and is signature-identical, so a
-- plain CREATE OR REPLACE succeeds and the ACL is preserved (no DROP needed —
-- dropping would silently remove the anon EXECUTE grant that the anonymous
-- accept-invite prefill page depends on).
--
-- CREATE OR REPLACE FUNCTION public.get_invitation_by_token_rpc(invite_token text)
--  RETURNS TABLE(id uuid, email text, organization_id uuid, role text, upline_id uuid,
--                first_name text, last_name text, licensed_states jsonb, commission_level text,
--                token text, expires_at timestamp with time zone, created_at timestamp with time zone,
--                status text, org_name text)
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- BEGIN
--     RETURN QUERY
--     SELECT
--         i.id, i.email, i.organization_id, i.role, i.upline_id,
--         i.first_name, i.last_name, i.licensed_states, i.commission_level,
--         i.token::TEXT, i.expires_at, i.created_at, i.status,
--         o.name as org_name
--     FROM public.invitations i
--     LEFT JOIN public.organizations o ON i.organization_id = o.id
--     WHERE i.token::TEXT = invite_token
--     LIMIT 1;
-- END;
-- $function$;
--
-- Only if the function had to be DROPped, restore the live ACL as well:
--   GRANT EXECUTE ON FUNCTION public.get_invitation_by_token_rpc(text) TO PUBLIC, anon, authenticated, service_role;
-- =============================================================================

DO $m$ BEGIN RAISE NOTICE 'STEP2 migration applied inside transaction'; END $m$;

-- ===============================================================================================
-- STEP 3 - THE COMPLETE ADVERSARIAL AUTHORIZATION MATRIX (verbatim; its own BEGIN/ROLLBACK removed)
-- ===============================================================================================
-- =====================================================================================================
-- P0 SECURITY — profile authorization + invitation write hardening: adversarial test matrix
-- Covers every row of implementation_plan.md §7 that is enforceable in SQL.
-- =====================================================================================================
--
-- WHAT THIS FILE PROVES
--   Migration supabase/migrations/20260730210000_p0_profile_authorization_hardening.sql installs three
--   independent layers over public.profiles (column GRANTs, RLS policies, and the BEFORE trigger
--   trg_00_enforce_profile_field_authorization) plus write hardening on public.invitations. This script
--   drives all three from the roles a real request actually runs as (anon / authenticated / service_role)
--   and asserts, per plan §5 and §7:
--
--     T1   anon (and authenticated) INSERT into public.profiles is rejected
--     T2   a normal user cannot promote themselves (role)                       + JWT-propagation proof
--     T3   a normal user cannot change organization_id / status / hierarchy_path / team_id /
--          is_super_admin on their own row (one case each)
--     T4   a normal user CAN still write first_name / phone / timezone / goals / licensed_states /
--          commission_level (onboarding must keep working)
--     T5   a same-org Admin CAN change another user's role / status / team_id / billing_type / upline_id,
--          the authorized role change DOES reach auth.users.raw_app_meta_data (set_claim fires), and
--          hierarchy_path is recomputed by the database rather than supplied by the client
--     T6   an Admin cannot promote themselves
--     T7   an Admin cannot grant the 'Super Admin' role
--     T8   an Admin cannot edit a profile in another organization
--     T9   a platform super admin CAN grant is_super_admin to another user
--     T10  a platform super admin CANNOT change is_super_admin on their own row
--     T11  the service-role/system path still writes the system-only columns
--          (organization_id, hierarchy_path, twilio_client_identity, last_login_at)
--     T12  invitations: cross-org UPDATE rejected; status rewrite to anything but 'Revoked' rejected;
--          email / role / organization_id rewrites rejected by the column GRANT; own-org admin
--          Pending -> Revoked succeeds
--     T13  an authorized upline_id change on a user WHO HAS DOWNLINE — exercises the
--          cascade_hierarchy_update() AFTER trigger against the new guard. HARD GATE: the cascade must
--          be PERMITTED (see the T13 entry under INFORMATIONAL OBSERVATIONS below)
--     T14  platform_role authorization and the NO-PROFILE ACTOR — the fail-open regression matrix:
--          a same-org Admin with platform_role NULL and an ordinary Agent cannot write platform_role;
--          an authenticated Auth user with NO profiles row and FORGED claims cannot write
--          platform_role / is_super_admin / role / status / organization_id / hierarchy_path;
--          a real platform administrator can — except on their own row
--     T15  invitations, the COMPLETE column matrix: authenticated holds UPDATE on NO invitation column
--          except `status` (email, role, organization_id, token, expires_at, upline_id, team_id,
--          commission_level, licensed_states, invited_by, accepted_at, created_at, id, first_name,
--          last_name — asserted both statically and at runtime), `status` may only go
--          Pending -> Revoked, and the whole row is unchanged afterwards
--     T16  Team Leader behaviour after the over-broad FOR ALL policy is replaced: a Team Leader CAN
--          select / revoke / delete their OWN org's invitations, CANNOT insert one (the single
--          INTENTIONAL capability removal), and CANNOT touch another organization's — plus the
--          counterpart that a same-org Admin CAN still insert one (the browser invite path)
--     T17  get_invitation_by_token_rpc(text) as `anon`: a Pending+unexpired token returns the full
--          signup prefill authority; a Revoked or EXPIRED token still returns status/expires_at but
--          NULLs email / organization_id / role / upline_id / commission_level / licensed_states /
--          org_name; unknown and malformed tokens return nothing; plus a signature / owner /
--          SECURITY DEFINER / search_path / ACL metadata gate
--
--   NOT covered here (they are API-level, not SQL — they belong with the create-user /
--   create-organization function tests): anonymous Admin creation in an existing org; anonymous
--   organization creation; the five invalid/expired/accepted/mismatched-email/forged invitation cases;
--   "invitation role+org always from the server row"; and the no-orphan signup rollback cases.
--
-- HOW TO RUN
--   Apply the P0 migration FIRST, then run this file, e.g.
--
--     psql "$DEV_BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/p0_profile_authorization.sql
--
--   Run it ONLY against a local Supabase stack or an APPROVED Supabase dev branch — or, with explicit
--   sign-off, a production session that is known to roll back. Connect as `postgres` (the script needs
--   SET ROLE anon/authenticated/service_role and INSERT on auth.users; postgres is a member of all three
--   and holds those grants). T0 aborts immediately with a readable message if the migration is not
--   applied, so a mis-targeted run stops before it touches anything.
--
-- SAFETY
--   * The whole script is one transaction wrapped in BEGIN ... ROLLBACK. Every fixture — organizations,
--     teams, auth.users, profiles, invitations — is created INSIDE that transaction and disappears when
--     it rolls back. Nothing is persisted even if the script is pointed at the wrong database.
--   * All fixture identifiers are fixed, obviously-synthetic UUIDs (a1111111-…, b1111111-…, c1111111-…,
--     a0a0a0a0-…, b0b0b0b0-…, c0c0c0c0-…, e0e0e0e0-…) and all fixture email addresses use the
--     non-routable @p0test.invalid domain. Because they are FIXED, T0a refuses to create anything if a
--     single one of them already exists in auth.users / profiles / organizations / teams / invitations.
--   * No mail is sent: `SET LOCAL app.settings.supabase_url = ''` makes the AFTER INSERT trigger
--     on_profile_created_welcome_email short-circuit before its net.http_post call. Each fixture profile
--     therefore emits one expected `WARNING: Welcome email skipped: SUPABASE_URL not set` — harmless.
--
-- READING THE OUTPUT
--   Every SECURITY assertion in T0-T14 is a HARD GATE: it RAISEs and aborts the run on an unexpected
--   outcome, or prints `Tn PASS`. Nothing in this file downgrades a security failure to a warning.
--   Two temp tables carry the two kinds of result, and they are NOT interchangeable:
--     pg_temp._p0_soft_fail  SECURITY failures. The summary block re-raises, so any row here FAILS
--                            the run. (Nothing writes to it today — every security check aborts inline.)
--     pg_temp._p0_info       PRE-EXISTING, non-security observations. NEVER gates the run and an INFO
--                            row is NEVER a pass. Only the T5c/T13 canonical-chain notes land here.
--   >>> grep the psql output for `FAIL` <<<
--
-- INFORMATIONAL OBSERVATIONS (PRE-EXISTING defects; NOT security assertions, NOT gated, NOT 'passing')
--   T5c  public.update_hierarchy_path() calls compute_hierarchy_path(NEW.id) from a BEFORE UPDATE
--        trigger, and compute_hierarchy_path() re-reads public.profiles — which still holds the OLD
--        upline_id at that point. The recompute is therefore one change stale. PRE-EXISTING (visible in
--        live data today: every profile with an upline_id still has a 1-level hierarchy_path); NOT
--        introduced by this migration. T5c hard-asserts the security property (the path is DB-derived
--        and ends in the row's own label); the canonical-ancestor-chain comparison is recorded here as
--        INFO-1 and never gates the run.
--   T13  HARD GATE, not a soft check — the assertion aborts the run on failure, and a failure here is a
--        real regression. Only the descendant-path staleness note (INFO-2) is informational.
--        cascade_hierarchy_update() (AFTER UPDATE OF upline_id) issues
--        `UPDATE public.profiles SET hierarchy_path = …` for each descendant. SECURITY DEFINER does not
--        change auth.uid(), so the guard does see the *caller* on those nested writes. An earlier
--        revision of the migration rejected them with 42501, which would have broken every admin
--        upline change on a user with downline. The shipped guard instead compares the new value
--        against public.compute_hierarchy_path(NEW.id): the cascade's own correct value passes, while
--        a forged ltree still fails. T13 therefore asserts the cascade SUCCEEDS.
--
-- =====================================================================================================

-- [wrapper owns BEGIN]

SET LOCAL client_min_messages = notice;

-- Neutralise the welcome-email HTTP trigger for the duration of this transaction (see SAFETY above).
SET LOCAL app.settings.supabase_url = '';
SET LOCAL app.settings.service_role_key = '';

-- -----------------------------------------------------------------------------------------------------
-- Fixture identifiers (psql variables — NOTE: psql does not interpolate inside dollar-quoted DO blocks,
-- so the same UUIDs appear as literals there. Keep the two in sync.)
-- -----------------------------------------------------------------------------------------------------
\set ORG_A      '''a0a0a0a0-0000-4000-8000-000000000001'''
\set ORG_B      '''b0b0b0b0-0000-4000-8000-000000000001'''
\set TEAM_A     '''c0c0c0c0-0000-4000-8000-000000000001'''
\set INV_A      '''e0e0e0e0-0000-4000-8000-00000000000a'''
\set INV_B      '''e0e0e0e0-0000-4000-8000-00000000000b'''

\set U_ADMIN_A  '''a1111111-0000-4000-8000-000000000001'''
\set U_AGENT_A  '''a1111111-0000-4000-8000-000000000002'''
\set U_TARGET_A '''a1111111-0000-4000-8000-000000000003'''
\set U_OLDUP_A  '''a1111111-0000-4000-8000-000000000004'''
\set U_UPLINE_A '''a1111111-0000-4000-8000-000000000005'''
\set U_SUPER    '''a1111111-0000-4000-8000-000000000006'''
\set U_SYS      '''a1111111-0000-4000-8000-000000000007'''
\set U_CHAIN_A  '''a1111111-0000-4000-8000-000000000008'''
\set U_DOWN_A   '''a1111111-0000-4000-8000-000000000009'''
\set U_ADMIN_B  '''b1111111-0000-4000-8000-000000000001'''
\set U_AGENT_B  '''b1111111-0000-4000-8000-000000000002'''

CREATE TEMP TABLE _p0_soft_fail (label text, detail text) ON COMMIT DROP;
-- Informational observations about PRE-EXISTING defects. These are NOT security
-- assertions, never gate the run, and must never be reported as "passing".
CREATE TEMP TABLE _p0_info (label text, detail text) ON COMMIT DROP;

-- =====================================================================================================
-- T0. Preflight — refuse to run a security matrix against a database the migration was never applied to
-- =====================================================================================================
DO $t0$
DECLARE
  missing text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND tgname = 'trg_00_enforce_profile_field_authorization'
  ) THEN missing := missing || E'\n  - BEFORE trigger trg_00_enforce_profile_field_authorization is absent'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enforce_profile_field_authorization'
  ) THEN missing := missing || E'\n  - function public.enforce_profile_field_authorization() is absent'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_role_check'
  ) THEN missing := missing || E'\n  - CHECK constraint profiles_role_check is absent'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid = 'public.profiles'::regclass AND polname = 'profiles_insert'
  ) THEN missing := missing || E'\n  - permissive policy profiles_insert (WITH CHECK true) still exists'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid = 'public.invitations'::regclass AND polname = 'invitations_update_status'
  ) THEN missing := missing || E'\n  - policy invitations_update_status (USING true) still exists'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid = 'public.invitations'::regclass AND polname = 'invitations_revoke_org_admin'
  ) THEN missing := missing || E'\n  - policy invitations_revoke_org_admin is absent'; END IF;

  -- Layer 1 (grants)
  IF has_table_privilege('anon', 'public.profiles', 'INSERT')
     OR has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR has_table_privilege('anon', 'public.profiles', 'UPDATE')
  THEN missing := missing || E'\n  - role anon still holds privileges on public.profiles'; END IF;

  IF has_column_privilege('authenticated', 'public.profiles', 'organization_id', 'UPDATE')
  THEN missing := missing || E'\n  - authenticated still holds UPDATE on profiles.organization_id'; END IF;

  IF has_column_privilege('authenticated', 'public.profiles', 'hierarchy_path', 'UPDATE')
  THEN missing := missing || E'\n  - authenticated still holds UPDATE on profiles.hierarchy_path'; END IF;

  IF has_column_privilege('authenticated', 'public.profiles', 'twilio_client_identity', 'UPDATE')
  THEN missing := missing || E'\n  - authenticated still holds UPDATE on profiles.twilio_client_identity'; END IF;

  IF NOT has_column_privilege('authenticated', 'public.profiles', 'first_name', 'UPDATE')
  THEN missing := missing || E'\n  - authenticated LOST UPDATE on profiles.first_name (self-service would break)'; END IF;

  IF has_column_privilege('authenticated', 'public.invitations', 'email', 'UPDATE')
  THEN missing := missing || E'\n  - authenticated still holds UPDATE on invitations.email'; END IF;

  IF NOT has_column_privilege('authenticated', 'public.invitations', 'status', 'UPDATE')
  THEN missing := missing || E'\n  - authenticated LOST UPDATE on invitations.status (revoke UI would break)'; END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION
      'T0 preflight FAIL — migration 20260730210000_p0_profile_authorization_hardening is not (fully) applied to this database:%',
      missing;
  END IF;

  RAISE NOTICE 'T0 PASS — P0 migration artifacts present (trigger, guard function, role CHECK, policies, column grants)';
END
$t0$;

-- =====================================================================================================
-- Fixtures — two organizations, one team, eleven users, two invitations. Created as the session role
-- (auth.uid() IS NULL), which the guard treats as the trusted system path.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- T0a. FIXTURE COLLISION PREFLIGHT — nothing is created until this passes.
--
-- Every fixture identifier in this file is a FIXED literal. If a database already held one of them, the
-- old `ON CONFLICT (id) DO NOTHING` clauses would have made this script silently ADOPT that pre-existing
-- row and then mutate it (T5a/T9/T11 rewrite role, status, organization_id, is_super_admin, …) — an
-- invisible, destructive failure mode on a mis-targeted run. Those clauses have been removed, so a
-- collision now aborts the INSERT loudly; this block aborts even earlier, with a readable inventory.
--
-- Checked here: every fixed UUID used ANYWHERE in this file (auth.users, profiles, organizations, teams,
-- invitations), the whole reserved @p0test.invalid email domain, both invitation tokens, and the fixture
-- organization names/slugs and team name.
--
-- KEEPING THE LIST IN SYNC — regenerate the UUID list with:
--   grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
--     supabase/tests/p0_profile_authorization.sql | sort -u
-- (psql does not interpolate :VARS inside dollar-quoted blocks, so these are literals — same convention
-- as every other DO block in this file.)
-- -----------------------------------------------------------------------------------------------------
DO $t0a$
DECLARE
  fixture_ids uuid[] := ARRAY[
    -- organizations / team / invitations
    'a0a0a0a0-0000-4000-8000-000000000001',  -- ORG_A
    'b0b0b0b0-0000-4000-8000-000000000001',  -- ORG_B
    'c0c0c0c0-0000-4000-8000-000000000001',  -- TEAM_A
    'e0e0e0e0-0000-4000-8000-00000000000a',  -- INV_A
    'e0e0e0e0-0000-4000-8000-00000000000b',  -- INV_B
    -- org A users
    'a1111111-0000-4000-8000-000000000001',  -- U_ADMIN_A
    'a1111111-0000-4000-8000-000000000002',  -- U_AGENT_A
    'a1111111-0000-4000-8000-000000000003',  -- U_TARGET_A
    'a1111111-0000-4000-8000-000000000004',  -- U_OLDUP_A
    'a1111111-0000-4000-8000-000000000005',  -- U_UPLINE_A
    'a1111111-0000-4000-8000-000000000006',  -- U_SUPER
    'a1111111-0000-4000-8000-000000000007',  -- U_SYS
    'a1111111-0000-4000-8000-000000000008',  -- U_CHAIN_A
    'a1111111-0000-4000-8000-000000000009',  -- U_DOWN_A
    -- org B users
    'b1111111-0000-4000-8000-000000000001',  -- U_ADMIN_B
    'b1111111-0000-4000-8000-000000000002',  -- U_AGENT_B
    -- T14 platform_role / no-profile-actor fixtures (created just before T14)
    'c1111111-0000-4000-8000-00000000014a',  -- U_PLATFORM  (platform_role = 'platform_admin')
    'c1111111-0000-4000-8000-00000000014b',  -- U_PTARGET   (T14 victim row)
    'c1111111-0000-4000-8000-00000000014c',  -- U_GHOST     (auth user with NO profile row)
    -- T15 invitation-column-matrix fixture
    'e0e0e0e0-0000-4000-8000-00000000001a',  -- INV_T15 (fully populated Pending org-A invitation)
    'f1f1f1f1-0000-4000-8000-00000000001a',  -- INV_T15 token
    'f1f1f1f1-0000-4000-8000-0000000000ff',  -- the token value T15 tries to forge
    -- T16 Team Leader fixtures
    'c1111111-0000-4000-8000-00000000000a',  -- U_TEAMLEAD_A
    'e0e0e0e0-0000-4000-8000-00000000002a',  -- INV_T16 revoke target (org A)
    'e0e0e0e0-0000-4000-8000-00000000002b',  -- INV_T16 delete target (org A)
    'e0e0e0e0-0000-4000-8000-00000000002c',  -- INV_T16 insert target (org A)
    'e0e0e0e0-0000-4000-8000-00000000002d',  -- INV_T16 cross-org target (org B)
    'e0e0e0e0-0000-4000-8000-00000000002e',  -- INV_T16 Admin-insert counterpart (T16f)
    'f1f1f1f1-0000-4000-8000-00000000002a',  -- INV_T16 tokens
    'f1f1f1f1-0000-4000-8000-00000000002b',
    'f1f1f1f1-0000-4000-8000-00000000002c',
    'f1f1f1f1-0000-4000-8000-00000000002d',
    'f1f1f1f1-0000-4000-8000-00000000002e',
    -- T17 get_invitation_by_token_rpc fixtures
    'e0e0e0e0-0000-4000-8000-00000000003a',  -- INV_T17 usable
    'e0e0e0e0-0000-4000-8000-00000000003b',  -- INV_T17 revoked
    'e0e0e0e0-0000-4000-8000-00000000003c',  -- INV_T17 expired
    'f1f1f1f1-0000-4000-8000-00000000003a',  -- INV_T17 tokens
    'f1f1f1f1-0000-4000-8000-00000000003b',
    'f1f1f1f1-0000-4000-8000-00000000003c',
    '99999999-9999-4999-8999-999999999999',  -- the unknown token T17 probes for (must match nothing)
    -- T19 database-authority fixtures (created just before T19, after T18)
    'c1111111-0000-4000-8000-000000001901',  -- U19_AGENT    org-A Agent; the forged-claim actor
    'c1111111-0000-4000-8000-000000001902',  -- U19_VICTIM_A org-A victim that must NEVER change
    'c1111111-0000-4000-8000-000000001903',  -- U19_VICTIM_B org-B victim that must NEVER change
    'c1111111-0000-4000-8000-000000001904',  -- U19_TL       org-A Team Leader
    'c1111111-0000-4000-8000-000000001905',  -- U19_DESC     org-A real DESCENDANT of U19_TL
    'c1111111-0000-4000-8000-000000001906',  -- U19_NONDESC  org-A NON-descendant of U19_TL
    'c1111111-0000-4000-8000-000000001907',  -- U19_ADMIN    org-A Admin
    'c1111111-0000-4000-8000-000000001908',  -- U19_MOVED    Admin whose profiles.organization_id is org B
    'c1111111-0000-4000-8000-000000001909',  -- U19_DEMOTED  DB-demoted Admin (profiles.role is now Agent)
    'c1111111-0000-4000-8000-00000000190a',  -- U19_MEMBER   org-A member the T19 POSITIVE tests do update
    -- the id T1 tries to forge: if a real row already held it, T1's "no forged row exists" check
    -- would false-pass AND a real profile would be misread as the attacker's.
    'f0f0f0f0-0000-4000-8000-00000000000f',
    'f1f1f1f1-0000-4000-8000-00000000000a', 'f1f1f1f1-0000-4000-8000-00000000000b']::uuid[];
  collisions text := '';
  r record;
BEGIN
  FOR r IN
    SELECT 'auth.users'         AS rel, u.id::text AS key, COALESCE(u.email, '<no email>') AS detail
      FROM auth.users u
     WHERE u.id = ANY(fixture_ids) OR u.email ILIKE '%@p0test.invalid'
    UNION ALL
    SELECT 'public.profiles', p.id::text, COALESCE(p.email, '<no email>')
      FROM public.profiles p
     WHERE p.id = ANY(fixture_ids) OR p.email ILIKE '%@p0test.invalid'
    UNION ALL
    SELECT 'public.organizations', o.id::text, format('name=%L slug=%L', o.name, o.slug)
      FROM public.organizations o
     WHERE o.id = ANY(fixture_ids)
        OR o.name IN ('P0 Test Org A', 'P0 Test Org B')
        OR o.slug IN ('p0-test-org-a', 'p0-test-org-b')
    UNION ALL
    SELECT 'public.teams', t.id::text, format('name=%L', t.name)
      FROM public.teams t
     WHERE t.id = ANY(fixture_ids) OR t.name = 'P0 Test Team A'
    UNION ALL
    SELECT 'public.invitations', i.id::text, format('email=%L token=%L', i.email, i.token::text)
      FROM public.invitations i
     WHERE i.id = ANY(fixture_ids)
        OR i.email ILIKE '%@p0test.invalid'
        -- token is uuid-typed, so compare as text: this covers both the uuid fixture tokens
        -- (f1f1f1f1-…) and the two legacy string tokens.
        OR i.token::text = ANY(fixture_ids::text[])
        OR i.token::text IN ('f1f1f1f1-0000-4000-8000-00000000000a', 'f1f1f1f1-0000-4000-8000-00000000000b')
  LOOP
    collisions := collisions || format(E'\n  - %s  id=%s  %s', r.rel, r.key, r.detail);
  END LOOP;

  IF collisions <> '' THEN
    RAISE EXCEPTION
      'T0a FIXTURE COLLISION — refusing to create P0 test fixtures. This database ALREADY contains row(s) using a fixture identifier, so the matrix would adopt and then MUTATE them. Rows found:%',
      collisions;
  END IF;

  RAISE NOTICE 'T0a PASS — no fixture id / @p0test.invalid address / invitation token / fixture org name or slug pre-exists';
END
$t0a$;

-- NOTE: no ON CONFLICT clauses below. T0a has just proved every identifier is free, so a duplicate-key
-- error here is a REAL failure (a concurrent run, or a stale T0a list) and must abort the script.
INSERT INTO public.organizations (id, name) VALUES
  (:ORG_A::uuid, 'P0 Test Org A'),
  (:ORG_B::uuid, 'P0 Test Org B');

INSERT INTO public.teams (id, organization_id, name) VALUES
  (:TEAM_A::uuid, :ORG_A::uuid, 'P0 Test Team A');

-- auth.users first: the AFTER INSERT trigger on_auth_user_created -> handle_new_user() creates the
-- matching public.profiles row, exactly as a real signup does.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  (:U_ADMIN_A::uuid,  'p0.admin.a@p0test.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  (:U_AGENT_A::uuid,  'p0.agent.a@p0test.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  (:U_TARGET_A::uuid, 'p0.target.a@p0test.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  (:U_OLDUP_A::uuid,  'p0.oldup.a@p0test.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  (:U_UPLINE_A::uuid, 'p0.upline.a@p0test.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  (:U_SUPER::uuid,    'p0.super@p0test.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  (:U_SYS::uuid,      'p0.sys@p0test.invalid',      '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  (:U_CHAIN_A::uuid,  'p0.chain.a@p0test.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  (:U_DOWN_A::uuid,   'p0.down.a@p0test.invalid',   '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  (:U_ADMIN_B::uuid,  'p0.admin.b@p0test.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  (:U_AGENT_B::uuid,  'p0.agent.b@p0test.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

-- Belt and braces: if on_auth_user_created is not installed on this database, create the rows directly.
-- The NOT EXISTS predicate replaces the old `ON CONFLICT (id) DO NOTHING`: it states the intent
-- explicitly (skip only the rows handle_new_user just made) instead of swallowing EVERY unique
-- violation, and T0a has already proved no foreign row can be sitting on these ids.
INSERT INTO public.profiles (id, email, first_name, last_name, role, status)
SELECT u.id, u.email, 'P0', 'Fixture', 'Agent', 'Active'
FROM auth.users u
WHERE u.email LIKE 'p0.%@p0test.invalid'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- Org A
UPDATE public.profiles SET organization_id = :ORG_A::uuid, role = 'Admin',  status = 'Active', is_super_admin = false, billing_type = 'agency_covered' WHERE id = :U_ADMIN_A::uuid;
UPDATE public.profiles SET organization_id = :ORG_A::uuid, role = 'Agent',  status = 'Active', is_super_admin = false, billing_type = 'agency_covered' WHERE id = :U_AGENT_A::uuid;
UPDATE public.profiles SET organization_id = :ORG_A::uuid, role = 'Agent',  status = 'Active', is_super_admin = false, billing_type = 'agency_covered' WHERE id = :U_TARGET_A::uuid;
UPDATE public.profiles SET organization_id = :ORG_A::uuid, role = 'Agent',  status = 'Active', is_super_admin = false WHERE id = :U_OLDUP_A::uuid;
UPDATE public.profiles SET organization_id = :ORG_A::uuid, role = 'Agent',  status = 'Active', is_super_admin = false WHERE id = :U_UPLINE_A::uuid;
UPDATE public.profiles SET organization_id = :ORG_A::uuid, role = 'Agent',  status = 'Active', is_super_admin = false WHERE id = :U_CHAIN_A::uuid;
UPDATE public.profiles SET organization_id = :ORG_A::uuid, role = 'Agent',  status = 'Active', is_super_admin = false WHERE id = :U_DOWN_A::uuid;
UPDATE public.profiles SET organization_id = :ORG_A::uuid, role = 'Agent',  status = 'Active', is_super_admin = false WHERE id = :U_SYS::uuid;
-- Platform super admin: agency role Admin so the JWT-driven admin policies apply, plus the DB-resolved
-- is_super_admin flag the guard actually trusts.
UPDATE public.profiles SET organization_id = :ORG_A::uuid, role = 'Admin',  status = 'Active', is_super_admin = true  WHERE id = :U_SUPER::uuid;

-- Org B
UPDATE public.profiles SET organization_id = :ORG_B::uuid, role = 'Admin',  status = 'Active', is_super_admin = false WHERE id = :U_ADMIN_B::uuid;
UPDATE public.profiles SET organization_id = :ORG_B::uuid, role = 'Agent',  status = 'Active', is_super_admin = false WHERE id = :U_AGENT_B::uuid;

-- Hierarchy: TARGET reports to OLDUP (T5c re-points it to UPLINE); DOWN reports to CHAIN (T13).
UPDATE public.profiles SET upline_id = :U_OLDUP_A::uuid WHERE id = :U_TARGET_A::uuid;
UPDATE public.profiles SET upline_id = :U_CHAIN_A::uuid WHERE id = :U_DOWN_A::uuid;

-- Canonicalise the stored ltree paths so T5c/T13 start from a known-correct baseline. This statement
-- does not touch upline_id, so trg_update_hierarchy_path does not fire; auth.uid() IS NULL, so the
-- guard treats it as a system write.
UPDATE public.profiles
   SET hierarchy_path = public.compute_hierarchy_path(id)
 WHERE id IN (
   :U_ADMIN_A::uuid, :U_AGENT_A::uuid, :U_TARGET_A::uuid, :U_OLDUP_A::uuid, :U_UPLINE_A::uuid,
   :U_SUPER::uuid, :U_SYS::uuid, :U_CHAIN_A::uuid, :U_DOWN_A::uuid, :U_ADMIN_B::uuid, :U_AGENT_B::uuid
 );

INSERT INTO public.invitations (id, email, organization_id, role, token, expires_at, status) VALUES
  (:INV_A::uuid, 'p0.invitee.a@p0test.invalid', :ORG_A::uuid, 'Agent', 'f1f1f1f1-0000-4000-8000-00000000000a'::uuid, now() + interval '7 days', 'Pending'),
  (:INV_B::uuid, 'p0.invitee.b@p0test.invalid', :ORG_B::uuid, 'Agent', 'f1f1f1f1-0000-4000-8000-00000000000b'::uuid, now() + interval '7 days', 'Pending');

-- -----------------------------------------------------------------------------------------------------
-- Impersonation helpers. `_sim` mints the request.jwt.claims shape the app really sends:
--   auth.uid()          <- claims.sub
--   get_org_id()        <- claims.app_metadata.organization_id
--   get_user_role()     <- claims.app_metadata.role
--   is_super_admin()    <- claims.is_super_admin
--   get_user_org_id()   <- read from public.profiles for auth.uid() (SECURITY DEFINER, not the JWT)
-- Call _sim first, then `SET LOCAL ROLE authenticated`. `_sys` clears the claims so auth.uid() is NULL
-- (the system/service-role path).
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp._sim(p_uid uuid, p_org uuid, p_role text, p_super boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $sim$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object(
      'sub', p_uid,
      'role', 'authenticated',
      'is_super_admin', p_super,
      'app_metadata', json_build_object('organization_id', p_org, 'role', p_role)
    )::text, true);
END;
$sim$;

CREATE OR REPLACE FUNCTION pg_temp._sys()
RETURNS void LANGUAGE plpgsql AS $sys$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
END;
$sys$;

-- Fixture sanity: on_profile_update -> set_claim must already have stamped auth.users, otherwise the
-- JWT-propagation assertions in T2/T5b/T8 would be meaningless.
DO $t0b$
DECLARE m jsonb;
BEGIN
  SELECT raw_app_meta_data INTO m FROM auth.users WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid;
  IF m IS NULL OR m->>'role' IS DISTINCT FROM 'Agent'
     OR m->>'organization_id' IS DISTINCT FROM 'a0a0a0a0-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION
      'T0b fixture FAIL — auth.users.raw_app_meta_data for the agent fixture is % (expected role=Agent, organization_id=ORG_A). Is trigger on_profile_update_trigger installed?',
      m;
  END IF;
  IF (SELECT count(*) FROM public.profiles WHERE email LIKE 'p0.%@p0test.invalid') <> 11 THEN
    RAISE EXCEPTION 'T0b fixture FAIL — expected 11 fixture profiles, found %',
      (SELECT count(*) FROM public.profiles WHERE email LIKE 'p0.%@p0test.invalid');
  END IF;
  RAISE NOTICE 'T0b PASS — fixtures created and app_metadata baseline stamped by set_claim()';
END
$t0b$;

-- =====================================================================================================
-- T1. Profile forgery — anon (and authenticated) INSERT into public.profiles
-- Plan §7: "Anonymous profile INSERT rejected (grant AND absent policy)".
-- The guard's INSERT branch cannot help here (auth.uid() IS NULL for anon), so this is purely a
-- Layer 1 + Layer 2 assertion.
-- =====================================================================================================
DO $t1$
DECLARE
  denied_anon boolean := false;
  denied_auth boolean := false;
  msg_anon text; msg_auth text;
BEGIN
  -- T1a: anonymous
  PERFORM pg_temp._sys();
  SET LOCAL ROLE anon;
  BEGIN
    INSERT INTO public.profiles (id, email, first_name, last_name, role, status, organization_id)
    VALUES ('f0f0f0f0-0000-4000-8000-00000000000f'::uuid, 'p0.forged@p0test.invalid',
            'For', 'Ged', 'Admin', 'Active', 'a0a0a0a0-0000-4000-8000-000000000001'::uuid);
  EXCEPTION WHEN insufficient_privilege THEN
    denied_anon := true; msg_anon := SQLERRM;
  END;
  RESET ROLE;

  -- T1b: authenticated (no client INSERT path exists; INSERT is revoked and no policy remains)
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000002'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Agent');
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.profiles (id, email, first_name, last_name, role, status, organization_id)
    VALUES ('f0f0f0f0-0000-4000-8000-00000000000f'::uuid, 'p0.forged2@p0test.invalid',
            'For', 'Ged', 'Admin', 'Active', 'a0a0a0a0-0000-4000-8000-000000000001'::uuid);
  EXCEPTION WHEN insufficient_privilege THEN
    denied_auth := true; msg_auth := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF NOT denied_anon THEN RAISE EXCEPTION 'T1a FAIL — anon INSERT into public.profiles was NOT rejected'; END IF;
  IF NOT denied_auth THEN RAISE EXCEPTION 'T1b FAIL — authenticated INSERT into public.profiles was NOT rejected'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = 'f0f0f0f0-0000-4000-8000-00000000000f'::uuid) THEN
    RAISE EXCEPTION 'T1 FAIL — a forged profile row exists after the rejected INSERTs';
  END IF;

  RAISE NOTICE 'T1 PASS — profile INSERT rejected for anon (%) and for authenticated (%)', msg_anon, msg_auth;
END
$t1$;

-- =====================================================================================================
-- T2. Self-promotion by a normal user + requirement #11 (a rejected attempt never reaches app metadata)
-- =====================================================================================================
DO $t2$
DECLARE
  meta_before jsonb;
  meta_after  jsonb;
  v_role text;
  denied boolean := false;
  msg text;
BEGIN
  SELECT raw_app_meta_data INTO meta_before FROM auth.users WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid;

  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000002'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Agent');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET role = 'Admin' WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true; msg := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF NOT denied THEN RAISE EXCEPTION 'T2 FAIL — an Agent promoted themselves to Admin'; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid;
  IF v_role <> 'Agent' THEN RAISE EXCEPTION 'T2 FAIL — profiles.role is now % (expected Agent)', v_role; END IF;

  SELECT raw_app_meta_data INTO meta_after FROM auth.users WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid;
  IF meta_after->>'role' IS DISTINCT FROM 'Agent'
     OR meta_after->>'role' IS DISTINCT FROM meta_before->>'role' THEN
    RAISE EXCEPTION
      'T2 FAIL (plan requirement #11) — a REJECTED self-promotion reached auth.users.raw_app_meta_data: before=% after=%',
      meta_before->>'role', meta_after->>'role';
  END IF;

  RAISE NOTICE 'T2 PASS — Agent self-promotion rejected (%); auth.users app_metadata.role unchanged (%)',
    msg, meta_after->>'role';
END
$t2$;

-- =====================================================================================================
-- T3. Protected columns on a normal user's OWN row — one case each (plan §3 / §5)
--   organization_id, hierarchy_path  -> Layer 1 (column GRANT revoked)
--   status, team_id, is_super_admin  -> Layer 3 (guard trigger)
-- =====================================================================================================
DO $t3$
DECLARE
  r record;
  denied boolean;
  msg text;
  fails text := '';
  v_org uuid; v_status text; v_team uuid; v_super boolean; v_path text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('organization_id',
       $q$UPDATE public.profiles SET organization_id = 'b0b0b0b0-0000-4000-8000-000000000001'::uuid WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid$q$),
      ('status',
       $q$UPDATE public.profiles SET status = 'Inactive' WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid$q$),
      ('hierarchy_path',
       $q$UPDATE public.profiles SET hierarchy_path = 'a1111111_0000_4000_8000_000000000001'::public.ltree WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid$q$),
      ('team_id',
       $q$UPDATE public.profiles SET team_id = 'c0c0c0c0-0000-4000-8000-000000000001'::uuid WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid$q$),
      ('is_super_admin',
       $q$UPDATE public.profiles SET is_super_admin = true WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid$q$)
    ) AS t(col, stmt)
  LOOP
    denied := false;
    PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000002'::uuid,
                         'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Agent');
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE r.stmt;
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true; msg := SQLERRM;
    END;
    RESET ROLE;

    IF denied THEN
      RAISE NOTICE 'T3 PASS — Agent self-write of % rejected: %', r.col, msg;
    ELSE
      fails := fails || ' ' || r.col;
    END IF;
  END LOOP;
  PERFORM pg_temp._sys();

  IF fails <> '' THEN
    RAISE EXCEPTION 'T3 FAIL — an Agent was able to self-write protected column(s):%', fails;
  END IF;

  -- Nothing leaked through even partially.
  SELECT organization_id, status, team_id, COALESCE(is_super_admin, false), hierarchy_path::text
    INTO v_org, v_status, v_team, v_super, v_path
  FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid;

  IF v_org <> 'a0a0a0a0-0000-4000-8000-000000000001'::uuid OR v_status <> 'Active'
     OR v_team IS NOT NULL OR v_super
     OR v_path <> 'a1111111_0000_4000_8000_000000000002' THEN
    RAISE EXCEPTION 'T3 FAIL — protected values mutated: org=% status=% team=% super=% path=%',
      v_org, v_status, v_team, v_super, v_path;
  END IF;

  RAISE NOTICE 'T3 PASS — org/status/hierarchy_path/team_id/is_super_admin all unchanged on the Agent row';
END
$t3$;

-- =====================================================================================================
-- T4. The approved self-editable set must still be writable (onboarding must not regress)
-- =====================================================================================================
DO $t4$
DECLARE n int; v record;
BEGIN
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000002'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Agent');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles
       SET first_name = 'P0Self',
           last_name  = 'Edited',
           phone      = '+15555550123',
           timezone   = 'America/Chicago',
           monthly_call_goal        = 321,
           monthly_policies_goal    = 32,
           weekly_appointments_goal = 9,
           licensed_states  = '["TX", "NV"]'::jsonb,
           commission_level = '75%',
           onboarding_complete = true
     WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'T4 FAIL — the approved self-service update was rejected: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF n <> 1 THEN RAISE EXCEPTION 'T4 FAIL — self-service update affected % row(s), expected 1', n; END IF;

  SELECT first_name, last_name, phone, timezone, monthly_call_goal, monthly_policies_goal,
         weekly_appointments_goal, licensed_states, commission_level, onboarding_complete
    INTO v
  FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid;

  IF v.first_name <> 'P0Self' OR v.last_name <> 'Edited' OR v.phone <> '+15555550123'
     OR v.timezone <> 'America/Chicago' OR v.monthly_call_goal <> 321
     OR v.monthly_policies_goal <> 32 OR v.weekly_appointments_goal <> 9
     OR v.licensed_states <> '["TX", "NV"]'::jsonb OR v.commission_level <> '75%'
     OR v.onboarding_complete IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T4 FAIL — self-service values were not persisted: first_name=% last_name=% phone=% timezone=% call_goal=% policies_goal=% appt_goal=% licensed_states=% commission_level=% onboarding_complete=%',
      v.first_name, v.last_name, v.phone, v.timezone, v.monthly_call_goal,
      v.monthly_policies_goal, v.weekly_appointments_goal, v.licensed_states,
      v.commission_level, v.onboarding_complete;
  END IF;

  RAISE NOTICE 'T4 PASS — names/phone/timezone/goals/licensed_states/commission_level/onboarding_complete still self-writable';
END
$t4$;

-- =====================================================================================================
-- T5a. Same-org Admin: role / status / team_id / billing_type on another user  => allowed
-- T5b. …and the AUTHORIZED role change DOES reach auth.users.raw_app_meta_data (set_claim fires)
-- =====================================================================================================
DO $t5a$
DECLARE n int; v record; meta jsonb;
BEGIN
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles
       SET role         = 'Team Leader',
           status       = 'Inactive',
           team_id      = 'c0c0c0c0-0000-4000-8000-000000000001'::uuid,
           billing_type = 'self_pay'
     WHERE id = 'a1111111-0000-4000-8000-000000000003'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'T5a FAIL — an approved same-org Admin edit was rejected: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF n <> 1 THEN RAISE EXCEPTION 'T5a FAIL — admin edit affected % row(s), expected 1', n; END IF;

  SELECT role, status, team_id, billing_type INTO v
  FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000003'::uuid;

  IF v.role <> 'Team Leader' OR v.status <> 'Inactive'
     OR v.team_id <> 'c0c0c0c0-0000-4000-8000-000000000001'::uuid OR v.billing_type <> 'self_pay' THEN
    RAISE EXCEPTION 'T5a FAIL — admin edit did not persist: role=% status=% team_id=% billing_type=%',
      v.role, v.status, v.team_id, v.billing_type;
  END IF;
  RAISE NOTICE 'T5a PASS — same-org Admin changed role/status/team_id/billing_type on another member';

  -- T5b: JWT propagation on the authorized path.
  SELECT raw_app_meta_data INTO meta FROM auth.users WHERE id = 'a1111111-0000-4000-8000-000000000003'::uuid;
  IF meta->>'role' IS DISTINCT FROM 'Team Leader' THEN
    RAISE EXCEPTION
      'T5b FAIL — an AUTHORIZED role change did not refresh auth.users.raw_app_meta_data (role=%). set_claim()/on_profile_update_trigger is not firing.',
      meta->>'role';
  END IF;
  IF meta->>'organization_id' IS DISTINCT FROM 'a0a0a0a0-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'T5b FAIL — app_metadata.organization_id drifted to %', meta->>'organization_id';
  END IF;
  RAISE NOTICE 'T5b PASS — authorized role change propagated to auth.users.raw_app_meta_data (role=%)', meta->>'role';
END
$t5a$;

-- =====================================================================================================
-- T5c. hierarchy_path is database-derived, for Admins too (plan §5 marks it ✗ for every browser actor),
--      and a same-org Admin re-points upline_id on a LEAF member.
--   HARD  : a direct hierarchy_path write by an Admin is rejected; the upline_id change succeeds; and
--           hierarchy_path is DB-derived (never client-supplied) — it must end in the row's own label.
--   INFO  : whether hierarchy_path equals the canonical ancestor chain. This is a PRE-EXISTING
--           correctness observation, recorded in pg_temp._p0_info — it never gates the run and is
--           never reported as a pass. See INFORMATIONAL OBSERVATIONS (INFO-1) in the header.
-- =====================================================================================================
DO $t5c$
DECLARE
  n int;
  denied boolean := false;
  msg text;
  v_upline uuid;
  v_path text;
  v_canonical text;
BEGIN
  -- An Admin may not write hierarchy_path directly either (column GRANT is role-based, so the same
  -- 42501 that stops an Agent stops an Admin).
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles
       SET hierarchy_path = 'a1111111_0000_4000_8000_000000000001'::public.ltree
     WHERE id = 'a1111111-0000-4000-8000-000000000003'::uuid;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true; msg := SQLERRM;
  END;
  RESET ROLE;
  IF NOT denied THEN
    RAISE EXCEPTION 'T5c FAIL — a same-org Admin wrote profiles.hierarchy_path directly';
  END IF;
  RAISE NOTICE 'T5c PASS — direct hierarchy_path write by an Admin rejected: %', msg;

  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles
       SET upline_id = 'a1111111-0000-4000-8000-000000000005'::uuid
     WHERE id = 'a1111111-0000-4000-8000-000000000003'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'T5c FAIL — an authorized upline_id change was rejected: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF n <> 1 THEN RAISE EXCEPTION 'T5c FAIL — upline change affected % row(s), expected 1', n; END IF;

  SELECT upline_id, hierarchy_path::text INTO v_upline, v_path
  FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000003'::uuid;

  IF v_upline IS DISTINCT FROM 'a1111111-0000-4000-8000-000000000005'::uuid THEN
    RAISE EXCEPTION 'T5c FAIL — upline_id did not persist (got %)', v_upline;
  END IF;

  -- Security property: the path is produced by the database, so it always terminates in this row's label.
  IF v_path IS NULL OR v_path !~ '(^|\.)a1111111_0000_4000_8000_000000000003$' THEN
    RAISE EXCEPTION 'T5c FAIL — hierarchy_path (%) is not a database-derived path for this row', v_path;
  END IF;
  RAISE NOTICE 'T5c PASS (security) — upline_id change accepted; hierarchy_path is DB-derived: %', v_path;

  -- Correctness property — INFORMATIONAL ONLY (pg_temp._p0_info); never gates the run.
  v_canonical := public.compute_hierarchy_path('a1111111-0000-4000-8000-000000000003'::uuid)::text;
  IF v_path = v_canonical THEN
    RAISE NOTICE 'T5c PASS (correctness) — hierarchy_path recomputed to the canonical chain %', v_canonical;
  ELSE
    INSERT INTO pg_temp._p0_info VALUES ('INFO-1 / T5c (PRE-EXISTING, not gated)',
      format('hierarchy_path is %L but the canonical chain is %L — public.update_hierarchy_path() calls compute_hierarchy_path() from a BEFORE UPDATE trigger, where public.profiles still holds the OLD upline_id, so the recompute is one change stale. PRE-EXISTING, not introduced by this migration.',
             v_path, v_canonical));
    RAISE WARNING 'T5c FAIL (correctness, pre-existing) — hierarchy_path is % but the canonical chain is %', v_path, v_canonical;
  END IF;
END
$t5c$;

-- =====================================================================================================
-- T6. Admin self-promotion => rejected (plan §5: no actor may change their own role)
-- =====================================================================================================
DO $t6$
DECLARE denied boolean := false; msg text; v_role text; meta jsonb;
BEGIN
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET role = 'Super Admin' WHERE id = 'a1111111-0000-4000-8000-000000000001'::uuid;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true; msg := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF NOT denied THEN RAISE EXCEPTION 'T6 FAIL — an Admin promoted themselves'; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000001'::uuid;
  IF v_role <> 'Admin' THEN RAISE EXCEPTION 'T6 FAIL — admin role is now %', v_role; END IF;

  SELECT raw_app_meta_data INTO meta FROM auth.users WHERE id = 'a1111111-0000-4000-8000-000000000001'::uuid;
  IF meta->>'role' IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'T6 FAIL (#11) — rejected admin self-promotion reached app_metadata (role=%)', meta->>'role';
  END IF;

  RAISE NOTICE 'T6 PASS — Admin self-promotion rejected (%); app_metadata.role still Admin', msg;
END
$t6$;

-- =====================================================================================================
-- T7. Admin granting the 'Super Admin' agency role => rejected (platform super admin only)
-- =====================================================================================================
DO $t7$
DECLARE denied boolean := false; msg text; v_role text;
BEGIN
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET role = 'Super Admin' WHERE id = 'a1111111-0000-4000-8000-000000000003'::uuid;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true; msg := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF NOT denied THEN RAISE EXCEPTION 'T7 FAIL — an Admin granted the Super Admin role'; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000003'::uuid;
  IF v_role <> 'Team Leader' THEN
    RAISE EXCEPTION 'T7 FAIL — target role is now % (expected the T5a value Team Leader)', v_role;
  END IF;

  RAISE NOTICE 'T7 PASS — Admin cannot grant Super Admin (%)', msg;
END
$t7$;

-- =====================================================================================================
-- T8. Admin cross-org edit => rejected.
-- NOTE: RLS filters the row out of the UPDATE rather than raising, so the expected result is
-- "0 rows affected" (an insufficient_privilege error is equally acceptable). The load-bearing assertion
-- is that the victim row — and its app metadata — are untouched.
-- =====================================================================================================
DO $t8$
DECLARE n int := -1; denied boolean := false; msg text; v record; meta jsonb;
BEGIN
  SELECT raw_app_meta_data INTO meta FROM auth.users WHERE id = 'b1111111-0000-4000-8000-000000000002'::uuid;

  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles
       SET role = 'Admin', status = 'Inactive'
     WHERE id = 'b1111111-0000-4000-8000-000000000002'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true; msg := SQLERRM; n := 0;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF n <> 0 THEN
    RAISE EXCEPTION 'T8 FAIL — a same-org Admin edited % row(s) in another organization', n;
  END IF;

  SELECT role, status, organization_id INTO v
  FROM public.profiles WHERE id = 'b1111111-0000-4000-8000-000000000002'::uuid;
  IF v.role <> 'Agent' OR v.status <> 'Active'
     OR v.organization_id <> 'b0b0b0b0-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'T8 FAIL — the org-B victim row was mutated: role=% status=% organization_id=%',
      v.role, v.status, v.organization_id;
  END IF;

  IF (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = 'b1111111-0000-4000-8000-000000000002'::uuid)
     IS DISTINCT FROM meta->>'role' THEN
    RAISE EXCEPTION 'T8 FAIL (#11) — a cross-org attempt changed the victim''s app_metadata role';
  END IF;

  RAISE NOTICE 'T8 PASS — cross-org Admin edit affected 0 rows%',
    CASE WHEN denied THEN format(' (denied: %s)', msg) ELSE '' END;
END
$t8$;

-- =====================================================================================================
-- T9.  Platform super admin grants is_super_admin to ANOTHER user => allowed
-- T10. …but never on their own row => rejected
-- =====================================================================================================
DO $t9$
DECLARE n int; v_super boolean;
BEGIN
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000006'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET is_super_admin = true WHERE id = 'a1111111-0000-4000-8000-000000000003'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'T9 FAIL — a platform super admin could not grant is_super_admin: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF n <> 1 THEN RAISE EXCEPTION 'T9 FAIL — is_super_admin grant affected % row(s), expected 1', n; END IF;
  SELECT COALESCE(is_super_admin, false) INTO v_super
  FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000003'::uuid;
  IF NOT v_super THEN RAISE EXCEPTION 'T9 FAIL — is_super_admin did not persist'; END IF;

  RAISE NOTICE 'T9 PASS — platform super admin granted is_super_admin to another user';
END
$t9$;

DO $t10$
DECLARE denied boolean := false; msg text; v_super boolean;
BEGIN
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000006'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET is_super_admin = false WHERE id = 'a1111111-0000-4000-8000-000000000006'::uuid;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true; msg := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF NOT denied THEN RAISE EXCEPTION 'T10 FAIL — a platform super admin changed is_super_admin on their own row'; END IF;
  SELECT COALESCE(is_super_admin, false) INTO v_super
  FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000006'::uuid;
  IF NOT v_super THEN RAISE EXCEPTION 'T10 FAIL — own is_super_admin was cleared despite the rejection'; END IF;

  RAISE NOTICE 'T10 PASS — is_super_admin on own row rejected (%)', msg;
END
$t10$;

-- =====================================================================================================
-- T11. Service-role / system path — the system-only columns must remain writable
-- (handle_new_user, cascade_hierarchy_update, sync_last_login_at, twilio-token and the Edge Functions
-- all run with no auth.uid(); the guard returns NEW immediately for them.)
-- =====================================================================================================
DO $t11$
DECLARE n int; v record; meta jsonb;
BEGIN
  PERFORM pg_temp._sys();            -- no JWT claims  =>  auth.uid() IS NULL  =>  system caller
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.profiles
       SET organization_id        = 'b0b0b0b0-0000-4000-8000-000000000001'::uuid,
           hierarchy_path         = 'p0_sys_root'::public.ltree,
           twilio_client_identity = 'p0-sys-identity',
           last_login_at          = now(),
           role                   = 'Admin',
           status                 = 'Inactive'
     WHERE id = 'a1111111-0000-4000-8000-000000000007'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'T11 FAIL — the service-role system write was rejected: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RESET ROLE;

  IF n <> 1 THEN RAISE EXCEPTION 'T11 FAIL — system write affected % row(s), expected 1', n; END IF;

  SELECT organization_id, hierarchy_path::text AS hierarchy_path, twilio_client_identity, last_login_at, role, status
    INTO v
  FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000007'::uuid;

  IF v.organization_id <> 'b0b0b0b0-0000-4000-8000-000000000001'::uuid
     OR v.hierarchy_path <> 'p0_sys_root'
     OR v.twilio_client_identity <> 'p0-sys-identity'
     OR v.last_login_at IS NULL
     OR v.role <> 'Admin' OR v.status <> 'Inactive' THEN
    RAISE EXCEPTION 'T11 FAIL — system columns did not persist: organization_id=% hierarchy_path=% twilio_client_identity=% last_login_at=% role=% status=%',
      v.organization_id, v.hierarchy_path, v.twilio_client_identity, v.last_login_at, v.role, v.status;
  END IF;

  SELECT raw_app_meta_data INTO meta FROM auth.users WHERE id = 'a1111111-0000-4000-8000-000000000007'::uuid;
  IF meta->>'organization_id' IS DISTINCT FROM 'b0b0b0b0-0000-4000-8000-000000000001'
     OR meta->>'role' IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'T11 FAIL — set_claim() did not follow the system write (app_metadata=%)', meta;
  END IF;

  RAISE NOTICE 'T11 PASS — service_role wrote organization_id/hierarchy_path/twilio_client_identity/last_login_at and set_claim() followed';
END
$t11$;

-- =====================================================================================================
-- T12. Invitations write hardening (plan §6)
--   a) cross-org UPDATE                                  => 0 rows (RLS row scoping)
--   b) status rewritten to anything but 'Revoked'        => rejected (RLS WITH CHECK)
--   c) email / role / organization_id rewritten          => rejected (column GRANT), even when smuggled
--                                                          into an otherwise-authorized status change
--   d) own-org admin Pending -> Revoked                  => allowed
-- =====================================================================================================
DO $t12$
DECLARE
  n int := -1;
  denied boolean;
  msg text;
  r record;
  v record;
  fails text := '';
BEGIN
  -- (a) cross-org
  denied := false;
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.invitations SET status = 'Revoked' WHERE id = 'e0e0e0e0-0000-4000-8000-00000000000b'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true; msg := SQLERRM; n := 0;
  END;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'T12a FAIL — an org-A Admin updated % org-B invitation row(s)', n; END IF;
  IF (SELECT status FROM public.invitations WHERE id = 'e0e0e0e0-0000-4000-8000-00000000000b'::uuid) <> 'Pending' THEN
    RAISE EXCEPTION 'T12a FAIL — the org-B invitation status changed';
  END IF;
  RAISE NOTICE 'T12a PASS — cross-org invitation UPDATE affected 0 rows%',
    CASE WHEN denied THEN format(' (denied: %s)', msg) ELSE '' END;

  -- (b) status rewritten to something other than 'Revoked'
  FOR r IN SELECT s FROM (VALUES ('Accepted'), ('Expired'), ('Pending')) AS t(s)
  LOOP
    denied := false; n := -1; msg := NULL;
    PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                         'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE format('UPDATE public.invitations SET status = %L WHERE id = %L::uuid',
                     r.s, 'e0e0e0e0-0000-4000-8000-00000000000a');
      GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true; msg := SQLERRM; n := 0;
    END;
    RESET ROLE;
    -- 'Pending' -> 'Pending' is a no-op write that the WITH CHECK still refuses; either an error or a
    -- zero-row result proves the invitation was not re-opened.
    IF denied OR n = 0 THEN
      RAISE NOTICE 'T12b PASS — rewriting invitation status to % is refused (%)', r.s, COALESCE(msg, 'no rows matched');
    ELSE
      fails := fails || ' status=' || r.s;
    END IF;
  END LOOP;
  IF fails <> '' THEN
    RAISE EXCEPTION 'T12b FAIL — an authenticated Admin rewrote invitation status to:%', fails;
  END IF;
  IF (SELECT status FROM public.invitations WHERE id = 'e0e0e0e0-0000-4000-8000-00000000000a'::uuid) <> 'Pending' THEN
    RAISE EXCEPTION 'T12b FAIL — the org-A invitation status was rewritten';
  END IF;

  -- (c) authority columns smuggled into an otherwise-authorized status change
  fails := '';
  FOR r IN
    SELECT * FROM (VALUES
      ('email',
       $q$UPDATE public.invitations SET status = 'Revoked', email = 'p0.attacker@p0test.invalid' WHERE id = 'e0e0e0e0-0000-4000-8000-00000000000a'::uuid$q$),
      ('role',
       $q$UPDATE public.invitations SET status = 'Revoked', role = 'Admin' WHERE id = 'e0e0e0e0-0000-4000-8000-00000000000a'::uuid$q$),
      ('organization_id',
       $q$UPDATE public.invitations SET status = 'Revoked', organization_id = 'b0b0b0b0-0000-4000-8000-000000000001'::uuid WHERE id = 'e0e0e0e0-0000-4000-8000-00000000000a'::uuid$q$),
      ('expires_at',
       $q$UPDATE public.invitations SET status = 'Revoked', expires_at = now() + interval '365 days' WHERE id = 'e0e0e0e0-0000-4000-8000-00000000000a'::uuid$q$)
    ) AS t(col, stmt)
  LOOP
    denied := false;
    PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                         'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE r.stmt;
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true; msg := SQLERRM;
    END;
    RESET ROLE;
    IF denied THEN
      RAISE NOTICE 'T12c PASS — invitation column % is not writable by authenticated: %', r.col, msg;
    ELSE
      fails := fails || ' ' || r.col;
    END IF;
  END LOOP;
  IF fails <> '' THEN
    RAISE EXCEPTION 'T12c FAIL — authenticated rewrote invitation column(s):%', fails;
  END IF;

  SELECT email, role, organization_id, status, expires_at INTO v
  FROM public.invitations WHERE id = 'e0e0e0e0-0000-4000-8000-00000000000a'::uuid;
  IF v.email <> 'p0.invitee.a@p0test.invalid' OR v.role <> 'Agent'
     OR v.organization_id <> 'a0a0a0a0-0000-4000-8000-000000000001'::uuid
     OR v.status <> 'Pending' THEN
    RAISE EXCEPTION 'T12c FAIL — invitation authority columns mutated: email=% role=% organization_id=% status=% expires_at=%',
      v.email, v.role, v.organization_id, v.status, v.expires_at;
  END IF;

  -- (d) the one legitimate browser write
  n := -1;
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.invitations SET status = 'Revoked' WHERE id = 'e0e0e0e0-0000-4000-8000-00000000000a'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'T12d FAIL — own-org Admin could not revoke a Pending invitation: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF n <> 1 THEN RAISE EXCEPTION 'T12d FAIL — revoke affected % row(s), expected 1', n; END IF;
  IF (SELECT status FROM public.invitations WHERE id = 'e0e0e0e0-0000-4000-8000-00000000000a'::uuid) <> 'Revoked' THEN
    RAISE EXCEPTION 'T12d FAIL — status is not Revoked after the authorized revoke';
  END IF;
  RAISE NOTICE 'T12d PASS — own-org Admin revoked a Pending invitation (Pending -> Revoked)';
END
$t12$;

-- =====================================================================================================
-- T13. HARD GATE — authorized upline_id change on a member WHO HAS DOWNLINE.
-- cascade_hierarchy_update() (AFTER UPDATE OF upline_id) rewrites each descendant's hierarchy_path with
-- its own UPDATE. SECURITY DEFINER does not change auth.uid(), so the guard evaluates those inner writes
-- as the *caller*. An earlier revision refused them with 42501, which would have broken every admin
-- upline change on a user with downline; the shipped guard compares the new value against
-- public.compute_hierarchy_path(NEW.id) instead, so the cascade's own correct value passes while a
-- forged ltree still fails. This block therefore asserts the cascade SUCCEEDS, and a failure here is a
-- real regression — it is NOT a soft check and it does NOT write to pg_temp._p0_soft_fail. Only the
-- descendant-path *correctness* note is informational (pg_temp._p0_info; see INFO-2 in the header).
-- =====================================================================================================
DO $t13$
DECLARE
  n int := -1;
  failed boolean := false;
  msg text; state text;
  v_down_path text;
  v_down_canonical text;
BEGIN
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles
       SET upline_id = 'a1111111-0000-4000-8000-000000000005'::uuid
     WHERE id = 'a1111111-0000-4000-8000-000000000008'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    failed := true; msg := SQLERRM; state := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF failed THEN
    RAISE EXCEPTION 'T13 FAIL (HARD GATE) — an authorized same-org Admin could not change upline_id for a member who has downline: % (SQLSTATE %). The guard must compare hierarchy_path against public.compute_hierarchy_path(NEW.id) so the cascade_hierarchy_update() descendant writes pass.', msg, state;
  END IF;

  IF n <> 1 THEN RAISE EXCEPTION 'T13 FAIL (HARD GATE) — upline change affected % row(s), expected 1', n; END IF;

  SELECT hierarchy_path::text INTO v_down_path
  FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000009'::uuid;
  v_down_canonical := public.compute_hierarchy_path('a1111111-0000-4000-8000-000000000009'::uuid)::text;
  IF v_down_path = v_down_canonical THEN
    RAISE NOTICE 'T13 PASS (HARD GATE) — cascade recomputed the descendant hierarchy_path to %', v_down_path;
  ELSE
    INSERT INTO pg_temp._p0_info VALUES ('INFO-2 / T13 descendant path (PRE-EXISTING staleness, not gated)',
      format('descendant hierarchy_path is %L, canonical chain is %L — same pre-existing compute_hierarchy_path staleness as INFO-1; the SECURITY property (cascade permitted, path DB-derived) passed.', v_down_path, v_down_canonical));
    RAISE NOTICE 'T13 PASS (HARD GATE, security) — cascade permitted; see INFO-2 for the pre-existing path-staleness observation';
  END IF;
END
$t13$;

-- =====================================================================================================
-- T14 FIXTURES — platform-role actors and the no-profile "ghost" actor.
--
-- Created HERE rather than in the main fixture block on purpose: T0b hard-asserts an exact count of 11
-- fixture profiles, and that assertion stays meaningful only if these three arrive after it.
-- Created as the session role, so auth.uid() IS NULL and the guard treats them as system writes.
-- No ON CONFLICT — T0a already proved every id and address below is free.
-- =====================================================================================================
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('c1111111-0000-4000-8000-00000000014a'::uuid, 'p0.platform@p0test.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('c1111111-0000-4000-8000-00000000014b'::uuid, 'p0.ptarget@p0test.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('c1111111-0000-4000-8000-00000000014c'::uuid, 'p0.ghost@p0test.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

-- Belt and braces, same idiom as the main fixture block (only fires if on_auth_user_created is absent).
INSERT INTO public.profiles (id, email, first_name, last_name, role, status)
SELECT u.id, u.email, 'P0', 'Fixture', 'Agent', 'Active'
FROM auth.users u
WHERE u.id IN ('c1111111-0000-4000-8000-00000000014a'::uuid,
               'c1111111-0000-4000-8000-00000000014b'::uuid,
               'c1111111-0000-4000-8000-00000000014c'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- A LEGITIMATE platform administrator: agency role Admin (so the JWT-driven admin policies let the
-- statement reach the guard at all) PLUS the DB-resolved platform_role the guard actually trusts.
UPDATE public.profiles
   SET organization_id = 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
       role = 'Admin', status = 'Active', is_super_admin = false, platform_role = 'platform_admin'
 WHERE id = 'c1111111-0000-4000-8000-00000000014a'::uuid;

-- The victim row every T14 attempt aims at. platform_role stays NULL until T14d legitimately sets it.
UPDATE public.profiles
   SET organization_id = 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
       role = 'Agent', status = 'Active', is_super_admin = false, platform_role = NULL
 WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid;

UPDATE public.profiles
   SET hierarchy_path = public.compute_hierarchy_path(id)
 WHERE id IN ('c1111111-0000-4000-8000-00000000014a'::uuid,
              'c1111111-0000-4000-8000-00000000014b'::uuid);

-- THE GHOST — an authenticated Auth user with NO public.profiles row.
--
-- public.handle_new_user() is UNCONDITIONAL: even its "raw_user_meta_data IS NULL" early-return branch
-- INSERTs a profile first, so there is NO metadata shape that makes the trigger skip. The only way to
-- build this fixture is therefore to let on_auth_user_created create the row and then DELETE it here as
-- the system role. That is safe: trg_00_enforce_profile_field_authorization is BEFORE INSERT OR UPDATE
-- only (DELETE is unguarded), the script's session role is not subject to RLS on public.profiles, and
-- nothing anywhere references a profile that was created microseconds ago, so no FK can block it.
DELETE FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000014c'::uuid;

DO $t14f$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000014c'::uuid) THEN
    RAISE EXCEPTION 'T14 fixture FAIL — the ghost actor still has a public.profiles row, so T14c would not test the no-profile path at all';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'c1111111-0000-4000-8000-00000000014c'::uuid) THEN
    RAISE EXCEPTION 'T14 fixture FAIL — the ghost auth.users row is missing (a cascade removed it?)';
  END IF;
  IF (SELECT platform_role FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000014a'::uuid)
     IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'T14 fixture FAIL — the platform-administrator fixture does not carry platform_role=platform_admin';
  END IF;
  IF (SELECT platform_role FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid)
     IS NOT NULL THEN
    RAISE EXCEPTION 'T14 fixture FAIL — the victim fixture already carries a platform_role';
  END IF;
  -- T14a is only meaningful if the org-A Admin really is a NON-platform actor.
  IF (SELECT platform_role FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000001'::uuid)
     IS NOT NULL THEN
    RAISE EXCEPTION 'T14a precondition FAIL — the org-A Admin fixture unexpectedly has platform_role set';
  END IF;
  RAISE NOTICE 'T14 fixtures ready — platform administrator, victim row, and a no-profile ghost actor';
END
$t14f$;

-- =====================================================================================================
-- T14. platform_role authorization and the NO-PROFILE ACTOR — the fail-open regression matrix.
--
-- WHAT THIS EXISTS TO CATCH. An earlier revision of the guard read the actor with
--     SELECT ... INTO actor_role, actor_org, actor_is_super, actor_platform_role FROM public.profiles ...
-- and then gated on `IF NOT (actor_platform_role = 'platform_admin') THEN RAISE`. Two NULL bugs stacked:
--   (1) for an actor whose platform_role IS NULL — i.e. EVERY ordinary user — the comparison yields NULL,
--       and plpgsql treats a NULL IF condition as FALSE, so the RAISE never fired; and
--   (2) for an authenticated Auth user with NO profile row at all, SELECT ... INTO left EVERY variable
--       NULL, so is_super_admin, role, status, organization_id and hierarchy_path opened up too.
-- The shipped guard closes both: `IF NOT FOUND THEN RAISE`, COALESCE on every authorization boolean, and
-- IS TRUE / IS NOT TRUE at every gate. All four sub-tests below are HARD GATES.
--
-- WHY (2) IS REACHABLE AT ALL. public.profiles still carries policy profiles_update_hierarchical, whose
-- USING/WITH CHECK is decided by get_org_id() and get_user_role() — get_user_role() reads ONLY the JWT,
-- and get_org_id() prefers the JWT claim over the profiles lookup. A forged/stale token claiming
-- app_metadata.role='Admin' and an organization_id therefore passes Layer 2 with no profile row behind
-- it, and the guard is the only thing left. T14c drives exactly that.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- T14a. Same-org Admin whose platform_role IS NULL grants platform_role to another profile => REJECTED
-- ---------------------------------------------------------------------------------------------------
DO $t14a$
DECLARE
  denied boolean := false; msg text; sqlst text; n int := -1; v_platform text;
BEGIN
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,   -- org-A Admin, platform_role NULL
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET platform_role = 'platform_admin'
     WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    denied := true; msg := SQLERRM; sqlst := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF NOT denied THEN
    RAISE EXCEPTION 'T14a FAIL — a same-org Admin whose platform_role IS NULL granted platform_role to another profile (% row(s)). This is the NULL-comparison fail-open: the gate must be COALESCE(actor_platform_role = ''platform_admin'', false) ... IS NOT TRUE.', n;
  END IF;
  IF sqlst IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'T14a FAIL — the write was refused with SQLSTATE % (%), expected 42501 insufficient_privilege from the guard', sqlst, msg;
  END IF;

  SELECT platform_role INTO v_platform
  FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid;
  IF v_platform IS NOT NULL THEN
    RAISE EXCEPTION 'T14a FAIL — the target platform_role is now % despite the rejection', v_platform;
  END IF;

  RAISE NOTICE 'T14a PASS — non-platform Admin cannot grant platform_role; target unchanged (%)', msg;
END
$t14a$;

-- ---------------------------------------------------------------------------------------------------
-- T14b. Ordinary Agent -> platform_role on their OWN row, and on ANOTHER profile => REJECTED both times
-- ---------------------------------------------------------------------------------------------------
DO $t14b$
DECLARE
  denied boolean; msg text; sqlst text; n int; v_self text; v_other text;
BEGIN
  -- (1) own row. profiles_update_own admits the statement, so the guard is what refuses it.
  denied := false; n := -1; msg := NULL; sqlst := NULL;
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000002'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Agent');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET platform_role = 'platform_admin'
     WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    denied := true; msg := SQLERRM; sqlst := SQLSTATE;
  END;
  RESET ROLE;

  IF NOT denied THEN
    RAISE EXCEPTION 'T14b FAIL — an Agent set platform_role on their OWN row (% row(s)); self-granted platform staff powers', n;
  END IF;
  IF sqlst IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'T14b FAIL — own-row rejection came back as SQLSTATE % (%), expected 42501', sqlst, msg;
  END IF;
  SELECT platform_role INTO v_self
  FROM public.profiles WHERE id = 'a1111111-0000-4000-8000-000000000002'::uuid;
  IF v_self IS NOT NULL THEN
    RAISE EXCEPTION 'T14b FAIL — the Agent''s own platform_role is now % despite the rejection', v_self;
  END IF;
  RAISE NOTICE 'T14b PASS — Agent cannot set platform_role on their own row (%)', msg;

  -- (2) another profile. Layer 2 has no UPDATE policy that admits an Agent acting on someone else's
  -- row, so RLS filters it out before the guard runs: "0 rows affected" is the expected outcome and an
  -- insufficient_privilege error is equally acceptable. Same reasoning (and same idiom) as T8.
  denied := false; n := -1; msg := NULL; sqlst := NULL;
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000002'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Agent');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET platform_role = 'platform_admin'
     WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    denied := true; msg := SQLERRM; sqlst := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF NOT denied AND n <> 0 THEN
    RAISE EXCEPTION 'T14b FAIL — an Agent set platform_role on ANOTHER profile (% row(s))', n;
  END IF;
  SELECT platform_role INTO v_other
  FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'T14b FAIL — the victim platform_role is now % after an Agent attempt', v_other;
  END IF;
  RAISE NOTICE 'T14b PASS — Agent cannot set platform_role on another profile (%)',
    COALESCE(msg, 'no rows matched');
END
$t14b$;

-- ---------------------------------------------------------------------------------------------------
-- T14c. THE FAIL-OPEN CASE — an authenticated Auth user with NO public.profiles row, carrying FORGED
--       claims (app_metadata.role='Admin', is_super_admin=true, organization_id=ORG_A), attempts every
--       protected column on a real fixture profile. EVERY attempt must be rejected and nothing may move.
--
--       Which layer catches what, post-migration:
--         platform_role / is_super_admin / role / status  -> the GUARD only (authenticated holds the
--                                                            column UPDATE grant and the forged claims
--                                                            satisfy profiles_update_hierarchical)
--         organization_id / hierarchy_path                -> Layer 1, the column GRANT, refuses first
--       Both are SQLSTATE 42501. The `guard_only` flag below marks the four columns where the guard is
--       the sole defence, so this block can also prove the guard was actually EXERCISED rather than
--       accidentally shadowed by RLS.
-- ---------------------------------------------------------------------------------------------------
DO $t14c$
DECLARE
  r record;
  denied boolean; msg text; sqlst text; n int;
  fails text := '';
  guard_raises int := 0;
  b_platform text; b_super boolean; b_role text; b_status text; b_org uuid; b_path text;
  a_platform text; a_super boolean; a_role text; a_status text; a_org uuid; a_path text;
BEGIN
  SELECT platform_role, COALESCE(is_super_admin, false), role, status, organization_id, hierarchy_path::text
    INTO b_platform, b_super, b_role, b_status, b_org, b_path
  FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid;

  FOR r IN
    SELECT * FROM (VALUES
      ('platform_role', true,
       $q$UPDATE public.profiles SET platform_role = 'platform_admin' WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid$q$),
      ('is_super_admin', true,
       $q$UPDATE public.profiles SET is_super_admin = true WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid$q$),
      ('role', true,
       $q$UPDATE public.profiles SET role = 'Admin' WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid$q$),
      ('status', true,
       $q$UPDATE public.profiles SET status = 'Inactive' WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid$q$),
      ('organization_id', false,
       $q$UPDATE public.profiles SET organization_id = 'b0b0b0b0-0000-4000-8000-000000000001'::uuid WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid$q$),
      ('hierarchy_path', false,
       $q$UPDATE public.profiles SET hierarchy_path = 'p0_ghost_forged'::public.ltree WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid$q$)
    ) AS t(col, guard_only, stmt)
  LOOP
    denied := false; n := -1; msg := NULL; sqlst := NULL;
    -- Forged token: the ghost claims to be an org-A Admin AND a platform super admin. None of it is
    -- backed by a public.profiles row, which is the whole point.
    PERFORM pg_temp._sim('c1111111-0000-4000-8000-00000000014c'::uuid,
                         'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin', true);
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE r.stmt;
      GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      denied := true; msg := SQLERRM; sqlst := SQLSTATE;
    END;
    RESET ROLE;

    IF denied THEN
      IF r.guard_only THEN guard_raises := guard_raises + 1; END IF;
      RAISE NOTICE 'T14c PASS — no-profile actor with forged claims rejected on %: % [%]', r.col, msg, sqlst;
    ELSIF n = 0 THEN
      RAISE NOTICE 'T14c PASS — no-profile actor with forged claims matched 0 rows on % (Layer 2 filtered it)', r.col;
    ELSE
      fails := fails || format(' %s(rows=%s)', r.col, n);
    END IF;
  END LOOP;
  PERFORM pg_temp._sys();

  IF fails <> '' THEN
    RAISE EXCEPTION 'T14c FAIL — an authenticated Auth user with NO public.profiles row and FORGED JWT claims wrote protected column(s):%. This is the fail-open the guard''s `IF NOT FOUND THEN RAISE` exists to close.', fails;
  END IF;

  -- Test-validity gate: if RLS had filtered every attempt, all six would report 0 rows and this block
  -- would "pass" without ever running the guard. Refuse to claim a pass we did not earn.
  IF guard_raises = 0 THEN
    RAISE EXCEPTION 'T14c INCONCLUSIVE (HARD GATE) — none of the guard-only columns (platform_role, is_super_admin, role, status) produced an error, so the no-profile branch of enforce_profile_field_authorization() was never exercised. Layer 2 shadowed it; re-target this test before trusting the result.';
  END IF;

  SELECT platform_role, COALESCE(is_super_admin, false), role, status, organization_id, hierarchy_path::text
    INTO a_platform, a_super, a_role, a_status, a_org, a_path
  FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid;

  IF a_platform IS DISTINCT FROM b_platform OR a_super IS DISTINCT FROM b_super
     OR a_role IS DISTINCT FROM b_role OR a_status IS DISTINCT FROM b_status
     OR a_org IS DISTINCT FROM b_org OR a_path IS DISTINCT FROM b_path THEN
    RAISE EXCEPTION 'T14c FAIL — the victim row moved despite every attempt being rejected. before(platform_role=%, is_super_admin=%, role=%, status=%, organization_id=%, hierarchy_path=%) after(platform_role=%, is_super_admin=%, role=%, status=%, organization_id=%, hierarchy_path=%)',
      b_platform, b_super, b_role, b_status, b_org, b_path,
      a_platform, a_super, a_role, a_status, a_org, a_path;
  END IF;

  RAISE NOTICE 'T14c PASS — no-profile actor blocked on all 6 protected columns (% of them by the guard itself); victim row byte-identical', guard_raises;
END
$t14c$;

-- ---------------------------------------------------------------------------------------------------
-- T14d. A REAL platform administrator: may grant platform_role to ANOTHER user, never on their own row
-- ---------------------------------------------------------------------------------------------------
DO $t14d$
DECLARE
  n int := -1; denied boolean := false; msg text; sqlst text; v_target text; v_self text;
BEGIN
  -- (1) another user => allowed
  PERFORM pg_temp._sim('c1111111-0000-4000-8000-00000000014a'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET platform_role = 'platform_admin'
     WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'T14d FAIL — a legitimate platform administrator could not grant platform_role: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RESET ROLE;

  IF n <> 1 THEN RAISE EXCEPTION 'T14d FAIL — the platform_role grant affected % row(s), expected 1', n; END IF;
  SELECT platform_role INTO v_target
  FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000014b'::uuid;
  IF v_target IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'T14d FAIL — platform_role did not persist on the target (got %)', v_target;
  END IF;
  RAISE NOTICE 'T14d PASS — a real platform administrator granted platform_role to another user';

  -- (2) own row => rejected
  PERFORM pg_temp._sim('c1111111-0000-4000-8000-00000000014a'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET platform_role = NULL
     WHERE id = 'c1111111-0000-4000-8000-00000000014a'::uuid;
  EXCEPTION WHEN OTHERS THEN
    denied := true; msg := SQLERRM; sqlst := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF NOT denied THEN
    RAISE EXCEPTION 'T14d FAIL — a platform administrator changed platform_role on their OWN row';
  END IF;
  IF sqlst IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'T14d FAIL — own-row rejection came back as SQLSTATE % (%), expected 42501', sqlst, msg;
  END IF;
  SELECT platform_role INTO v_self
  FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000014a'::uuid;
  IF v_self IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'T14d FAIL — own platform_role was cleared despite the rejection (now %)', v_self;
  END IF;
  RAISE NOTICE 'T14d PASS — platform_role change on own row rejected (%)', msg;
END
$t14d$;

-- =====================================================================================================
-- T15 FIXTURE — a fresh, FULLY POPULATED Pending org-A invitation.
--
-- T12d already consumed e0e0e0e0-…-00000000000a (it is 'Revoked' by the time control reaches here), and
-- the WITH CHECK on invitations_revoke_org_admin only matches rows whose CURRENT status is 'Pending', so
-- T15 needs its own row. Created as the session role (auth.uid() IS NULL => the guard's trusted system
-- path) inside the outer transaction, so it rolls back with everything else.
--
-- NOTE: public.invitations.token is `uuid NOT NULL UNIQUE` in the live schema — every fixture token here
-- must therefore be a syntactically valid UUID, not a readable slug.
-- =====================================================================================================
INSERT INTO public.invitations
  (id, organization_id, email, role, team_id, upline_id, token, status, invited_by,
   created_at, expires_at, first_name, last_name, licensed_states, commission_level, accepted_at)
VALUES
  ('e0e0e0e0-0000-4000-8000-00000000001a'::uuid,
   'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
   'p0.invitee.cols@p0test.invalid', 'Agent',
   'c0c0c0c0-0000-4000-8000-000000000001'::uuid,
   'a1111111-0000-4000-8000-000000000005'::uuid,
   'f1f1f1f1-0000-4000-8000-00000000001a'::uuid, 'Pending',
   'a1111111-0000-4000-8000-000000000001'::uuid,
   now() - interval '1 hour', now() + interval '7 days',
   'P0', 'Invitee', '["TX"]'::jsonb, '65%', NULL);

-- =====================================================================================================
-- T15. Invitation column gates — the COMPLETE column matrix (plan §6, expanded from T12c)
--
-- The migration REVOKEs UPDATE on public.invitations from authenticated and re-GRANTs UPDATE(status)
-- ONLY. RLS has no column granularity, so this GRANT is the *only* thing standing between an authorized
-- revoke and a cross-tenant rewrite of the invitation's authority fields (email / role / organization_id
-- decide which tenant and which permissions the invitee lands in; token / expires_at decide whether a
-- dead invitation can be resurrected).
--
--   (1) Layer 1, statically  — authenticated holds UPDATE on NO invitation column except `status`.
--   (2) Layer 1, at runtime  — every one of those columns raises 42501 for an authenticated Admin.
--   (3) Layer 2              — `status` may only go Pending -> Revoked; every other target is refused.
--   (4) whole-row readback   — the fixture row is byte-identical after all of the above.
--
-- The ONE approved browser mutation (same-org Admin, Pending -> Revoked) is proved by T12d and is
-- deliberately NOT weakened here; T16b proves the same transition for a Team Leader.
-- =====================================================================================================
DO $t15$
DECLARE
  r          record;
  denied     boolean;
  msg        text;
  n          int;
  fails      text := '';
  priv_fails text := '';
  v_before   jsonb;
  v_after    jsonb;
  diff       text;
BEGIN
  SELECT to_jsonb(i) INTO v_before FROM public.invitations i
   WHERE i.id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'T15 FAIL (HARD GATE) — the T15 invitation fixture e0e0e0e0-…-00000000001a is missing';
  END IF;

  -- (1) Layer 1, statically. One assertion per column.
  FOR r IN
    SELECT c FROM (VALUES
      ('email'), ('role'), ('organization_id'), ('token'), ('expires_at'), ('upline_id'), ('team_id'),
      ('commission_level'), ('licensed_states'), ('invited_by'), ('accepted_at'), ('created_at'),
      ('id'), ('first_name'), ('last_name')
    ) AS t(c)
  LOOP
    IF has_column_privilege('authenticated', 'public.invitations', r.c, 'UPDATE') THEN
      priv_fails := priv_fails || ' ' || r.c;
    ELSE
      RAISE NOTICE 'T15 PASS (Layer 1) — authenticated holds NO UPDATE privilege on invitations.%', r.c;
    END IF;
  END LOOP;
  IF priv_fails <> '' THEN
    RAISE EXCEPTION 'T15 FAIL (HARD GATE, Layer 1) — authenticated still holds UPDATE on invitation column(s):%', priv_fails;
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.invitations', 'status', 'UPDATE') THEN
    RAISE EXCEPTION 'T15 FAIL (HARD GATE) — authenticated LOST UPDATE on invitations.status; revokeInvitation() in the browser would break';
  END IF;
  RAISE NOTICE 'T15 PASS (Layer 1) — the invitations UPDATE grant for authenticated is exactly {status}';

  -- (2) Layer 1, at runtime — each column on its own, as a real authenticated same-org Admin.
  FOR r IN
    SELECT * FROM (VALUES
      ('email',
       $q$UPDATE public.invitations SET email = 'p0.attacker@p0test.invalid' WHERE id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid$q$),
      ('role',
       $q$UPDATE public.invitations SET role = 'Super Admin' WHERE id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid$q$),
      ('organization_id',
       $q$UPDATE public.invitations SET organization_id = 'b0b0b0b0-0000-4000-8000-000000000001'::uuid WHERE id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid$q$),
      ('token',
       $q$UPDATE public.invitations SET token = 'f1f1f1f1-0000-4000-8000-0000000000ff'::uuid WHERE id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid$q$),
      ('expires_at',
       $q$UPDATE public.invitations SET expires_at = now() + interval '3650 days' WHERE id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid$q$),
      ('upline_id',
       $q$UPDATE public.invitations SET upline_id = 'a1111111-0000-4000-8000-000000000001'::uuid WHERE id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid$q$),
      ('team_id',
       $q$UPDATE public.invitations SET team_id = NULL WHERE id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid$q$),
      ('commission_level',
       $q$UPDATE public.invitations SET commission_level = '145%' WHERE id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid$q$),
      ('licensed_states',
       $q$UPDATE public.invitations SET licensed_states = '["CA","NY"]'::jsonb WHERE id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid$q$),
      ('invited_by',
       $q$UPDATE public.invitations SET invited_by = 'b1111111-0000-4000-8000-000000000001'::uuid WHERE id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid$q$),
      ('accepted_at',
       $q$UPDATE public.invitations SET accepted_at = now() WHERE id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid$q$),
      ('created_at',
       $q$UPDATE public.invitations SET created_at = now() - interval '3650 days' WHERE id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid$q$)
    ) AS t(col, stmt)
  LOOP
    denied := false; msg := NULL;
    PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                         'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE r.stmt;
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true; msg := SQLERRM;
    END;
    RESET ROLE;

    IF denied THEN
      RAISE NOTICE 'T15 PASS — an authenticated Admin cannot write invitations.%: %', r.col, msg;
    ELSE
      fails := fails || ' ' || r.col;
    END IF;
  END LOOP;
  IF fails <> '' THEN
    RAISE EXCEPTION 'T15 FAIL (HARD GATE) — an authenticated Admin rewrote invitation column(s):%', fails;
  END IF;

  -- (3) Layer 2 — `status` is granted, so only the RLS WITH CHECK stops a non-Revoked transition.
  fails := '';
  FOR r IN SELECT s FROM (VALUES ('Accepted'), ('Expired'), ('Pending')) AS t(s)
  LOOP
    denied := false; n := -1; msg := NULL;
    PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                         'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE format('UPDATE public.invitations SET status = %L WHERE id = %L::uuid',
                     r.s, 'e0e0e0e0-0000-4000-8000-00000000001a');
      GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true; msg := SQLERRM; n := 0;
    END;
    RESET ROLE;
    -- Either a 42501 or a zero-row result proves the transition did not happen.
    IF denied OR n = 0 THEN
      RAISE NOTICE 'T15 PASS — invitations.status cannot be rewritten to % (%)', r.s, COALESCE(msg, 'no rows matched');
    ELSE
      fails := fails || ' status=' || r.s;
    END IF;
  END LOOP;
  IF fails <> '' THEN
    RAISE EXCEPTION 'T15 FAIL (HARD GATE) — an authenticated Admin rewrote invitation status to:%', fails;
  END IF;

  -- (4) Whole-row readback — covers every column, including any added after this test was written.
  PERFORM pg_temp._sys();
  SELECT to_jsonb(i) INTO v_after FROM public.invitations i
   WHERE i.id = 'e0e0e0e0-0000-4000-8000-00000000001a'::uuid;

  IF v_after IS NULL THEN
    RAISE EXCEPTION 'T15 FAIL (HARD GATE) — the invitation row disappeared during the rejected writes';
  END IF;
  IF v_after IS DISTINCT FROM v_before THEN
    SELECT string_agg(format('%s: %s -> %s', t.k, v_before ->> t.k, v_after ->> t.k), ', ')
      INTO diff
      FROM jsonb_object_keys(v_before) AS t(k)
     WHERE (v_before -> t.k) IS DISTINCT FROM (v_after -> t.k);
    RAISE EXCEPTION 'T15 FAIL (HARD GATE) — the invitation row changed after the rejected writes: %', diff;
  END IF;

  RAISE NOTICE 'T15 PASS — no invitation column except status is writable by authenticated, and the row is unchanged';
END
$t15$;

-- =====================================================================================================
-- T16 FIXTURES — a dedicated Team Leader in org A plus three invitations.
--
-- A dedicated user is used rather than an existing fixture because T5a/T9 have already mutated
-- a1111111-…-000000000003 (it is now 'Team Leader' AND is_super_admin = true, so super_admin_own_org()
-- would answer for it and the Team-Leader-specific policies would never be exercised).
--
-- Created HERE, after T0b's exact profile count and after T14, for the same reason T14's fixtures are:
-- T0b hard-asserts exactly 11 fixture profiles, so this 12th one must arrive later.
-- No ON CONFLICT, per the convention T0a establishes: a duplicate key here is a REAL failure.
-- =====================================================================================================
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('c1111111-0000-4000-8000-00000000000a'::uuid, 'p0.teamlead.a@p0test.invalid',
   '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

-- Belt and braces, same NOT EXISTS idiom as the main fixture block (only fires if on_auth_user_created
-- is absent, i.e. handle_new_user did not already create the row).
INSERT INTO public.profiles (id, email, first_name, last_name, role, status)
SELECT u.id, u.email, 'P0', 'TeamLead', 'Agent', 'Active'
FROM auth.users u
WHERE u.id = 'c1111111-0000-4000-8000-00000000000a'::uuid
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

UPDATE public.profiles
   SET organization_id = 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
       role            = 'Team Leader',
       status          = 'Active',
       is_super_admin  = false,
       platform_role   = NULL
 WHERE id = 'c1111111-0000-4000-8000-00000000000a'::uuid;

-- The Team Leader fixture is only meaningful if it really is a plain Team Leader: any leftover
-- is_super_admin / platform_role would route the checks through super_admin_own_org() instead of the
-- Team-Leader arms of the new policies, and T16 would prove nothing.
DO $t16fx$
DECLARE v record;
BEGIN
  SELECT role, organization_id, COALESCE(is_super_admin, false) AS super, platform_role INTO v
  FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000000a'::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T16 fixture FAIL — the Team Leader fixture profile was not created';
  END IF;
  IF v.role <> 'Team Leader'
     OR v.organization_id IS DISTINCT FROM 'a0a0a0a0-0000-4000-8000-000000000001'::uuid
     OR v.super OR v.platform_role IS NOT NULL THEN
    RAISE EXCEPTION 'T16 fixture FAIL — expected a plain org-A Team Leader, got role=% organization_id=% is_super_admin=% platform_role=%',
      v.role, v.organization_id, v.super, v.platform_role;
  END IF;
  RAISE NOTICE 'T16 fixtures ready — a plain org-A Team Leader (no is_super_admin, no platform_role)';
END
$t16fx$;

INSERT INTO public.invitations (id, organization_id, email, role, token, status, expires_at) VALUES
  ('e0e0e0e0-0000-4000-8000-00000000002a'::uuid, 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
   'p0.invitee.tlrevoke@p0test.invalid', 'Agent',
   'f1f1f1f1-0000-4000-8000-00000000002a'::uuid, 'Pending', now() + interval '7 days'),
  ('e0e0e0e0-0000-4000-8000-00000000002b'::uuid, 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
   'p0.invitee.tldelete@p0test.invalid', 'Agent',
   'f1f1f1f1-0000-4000-8000-00000000002b'::uuid, 'Pending', now() + interval '7 days'),
  ('e0e0e0e0-0000-4000-8000-00000000002d'::uuid, 'b0b0b0b0-0000-4000-8000-000000000001'::uuid,
   'p0.invitee.orgb2@p0test.invalid', 'Agent',
   'f1f1f1f1-0000-4000-8000-00000000002d'::uuid, 'Pending', now() + interval '7 days');

-- =====================================================================================================
-- T16. Team Leader behaviour after the over-broad FOR ALL policy is replaced. ALL HARD GATES.
--
-- The migration DROPs invitations_org_admin_manage (FOR ALL TO authenticated, Admin OR Team Leader, same
-- USING and WITH CHECK for every command) and replaces it with per-command policies. That is a genuine
-- behaviour change for Team Leaders, so each surviving capability is asserted explicitly:
--
--   T16a  SELECT own-org invitations      -> ALLOWED  (new policy invitations_select_team_leader;
--                                                      invitations_select alone is Admin/Super Admin
--                                                      only, so without this the Pending Invites list
--                                                      would silently empty for Team Leaders)
--   T16b  Pending -> Revoked, own org     -> ALLOWED  (invitations_revoke_org_admin includes
--                                                      'Team Leader')
--   T16c  DELETE own-org invitation       -> ALLOWED  (invitations_delete_org_admin includes
--                                                      'Team Leader')
--   T16d  INSERT a new invitation         -> REFUSED  *** INTENTIONAL CAPABILITY REMOVAL ***
--   T16e  anything in ANOTHER org         -> REFUSED  (0 rows, and nothing readable)
--   T16f  the same INSERT as an Admin     -> ALLOWED  (counterpart: createInvitation() inserts from the
--                                                      browser, so invitations_insert must keep working)
--
-- *** THE ONE INTENTIONAL CAPABILITY REMOVAL ***
-- Until this migration, a Team Leader could INSERT invitations: the dropped FOR ALL policy's WITH CHECK
-- listed 'Team Leader', so it permitted INSERT as well as UPDATE/DELETE/SELECT. Nothing else granted
-- them that — invitations_insert has always required get_user_role() IN ('Admin','Super Admin'). After
-- this migration a Team Leader can no longer create an invitation. This is deliberate: inviting a member
-- mints role, organization_id, upline_id and commission_level for a future account, which is an Admin
-- function. Team Leaders keep every REVIEW capability (see, revoke, delete) over their org's invites.
-- If a Team Leader reports "I can't send invites any more", that is this change, not a bug.
-- =====================================================================================================
DO $t16$
DECLARE
  n        int := -1;
  denied   boolean := false;
  msg      text;
  state    text;
  v_status text;
  v_seen_a int;
  v_seen_b int;
BEGIN
  -- (a) A Team Leader can read their OWN organization's invitations — and only those.
  PERFORM pg_temp._sim('c1111111-0000-4000-8000-00000000000a'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Team Leader');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen_a FROM public.invitations
   WHERE id IN ('e0e0e0e0-0000-4000-8000-00000000002a'::uuid,
                'e0e0e0e0-0000-4000-8000-00000000002b'::uuid);
  SELECT count(*) INTO v_seen_b FROM public.invitations
   WHERE organization_id = 'b0b0b0b0-0000-4000-8000-000000000001'::uuid;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF v_seen_a <> 2 THEN
    RAISE EXCEPTION 'T16a FAIL (HARD GATE) — a Team Leader sees % of 2 own-org invitations; policy invitations_select_team_leader is missing or wrong, so Pending Invites would silently empty for them', v_seen_a;
  END IF;
  IF v_seen_b <> 0 THEN
    RAISE EXCEPTION 'T16a FAIL (HARD GATE) — a Team Leader can read % invitation(s) belonging to another organization', v_seen_b;
  END IF;
  RAISE NOTICE 'T16a PASS — Team Leader reads its own org''s invitations (2) and none from another org';

  -- (b) Pending -> Revoked on an own-org invitation.
  n := -1;
  PERFORM pg_temp._sim('c1111111-0000-4000-8000-00000000000a'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Team Leader');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.invitations SET status = 'Revoked'
     WHERE id = 'e0e0e0e0-0000-4000-8000-00000000002a'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'T16b FAIL (HARD GATE) — a Team Leader could not revoke an own-org Pending invitation: % (SQLSTATE %). invitations_revoke_org_admin must include ''Team Leader''.', SQLERRM, SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF n <> 1 THEN
    RAISE EXCEPTION 'T16b FAIL (HARD GATE) — the Team Leader revoke affected % row(s), expected 1', n;
  END IF;
  SELECT status INTO v_status FROM public.invitations
   WHERE id = 'e0e0e0e0-0000-4000-8000-00000000002a'::uuid;
  IF v_status IS DISTINCT FROM 'Revoked' THEN
    RAISE EXCEPTION 'T16b FAIL (HARD GATE) — status is % after the Team Leader revoke (expected Revoked)', v_status;
  END IF;
  RAISE NOTICE 'T16b PASS — Team Leader performed Pending -> Revoked on an own-org invitation';

  -- (c) DELETE an own-org invitation.
  n := -1;
  PERFORM pg_temp._sim('c1111111-0000-4000-8000-00000000000a'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Team Leader');
  SET LOCAL ROLE authenticated;
  BEGIN
    DELETE FROM public.invitations WHERE id = 'e0e0e0e0-0000-4000-8000-00000000002b'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'T16c FAIL (HARD GATE) — a Team Leader could not delete an own-org invitation: % (SQLSTATE %). invitations_delete_org_admin must include ''Team Leader''.', SQLERRM, SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF n <> 1 THEN
    RAISE EXCEPTION 'T16c FAIL (HARD GATE) — the Team Leader delete affected % row(s), expected 1', n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.invitations WHERE id = 'e0e0e0e0-0000-4000-8000-00000000002b'::uuid) THEN
    RAISE EXCEPTION 'T16c FAIL (HARD GATE) — the invitation still exists after the Team Leader DELETE';
  END IF;
  RAISE NOTICE 'T16c PASS — Team Leader deleted an own-org invitation';

  -- (d) INSERT — the one INTENTIONAL capability removal (see the block comment above).
  n := -1; denied := false; msg := NULL; state := NULL;
  PERFORM pg_temp._sim('c1111111-0000-4000-8000-00000000000a'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Team Leader');
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.invitations (id, organization_id, email, role, token, status, expires_at)
    VALUES ('e0e0e0e0-0000-4000-8000-00000000002c'::uuid,
            'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
            'p0.invitee.tlinsert@p0test.invalid', 'Admin',
            'f1f1f1f1-0000-4000-8000-00000000002c'::uuid, 'Pending', now() + interval '7 days');
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    denied := true; msg := SQLERRM; state := SQLSTATE; n := 0;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF NOT denied AND n <> 0 THEN
    RAISE EXCEPTION 'T16d FAIL (HARD GATE) — a Team Leader inserted % invitation row(s); invitations_insert requires Admin/Super Admin and the FOR ALL policy that used to permit this must be gone', n;
  END IF;
  IF denied AND state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'T16d FAIL (HARD GATE) — the Team Leader INSERT was refused with % (SQLSTATE %) rather than a row-level-security/privilege violation; the test proved nothing about authorization', msg, state;
  END IF;
  IF EXISTS (SELECT 1 FROM public.invitations WHERE id = 'e0e0e0e0-0000-4000-8000-00000000002c'::uuid) THEN
    RAISE EXCEPTION 'T16d FAIL (HARD GATE) — a Team-Leader-created invitation row exists';
  END IF;
  RAISE NOTICE 'T16d PASS (INTENTIONAL CAPABILITY REMOVAL) — Team Leader INSERT refused: % (SQLSTATE %)',
    COALESCE(msg, 'no rows inserted'), COALESCE(state, 'n/a');

  -- (e) Nothing in another organization is touchable.
  n := -1;
  PERFORM pg_temp._sim('c1111111-0000-4000-8000-00000000000a'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Team Leader');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.invitations SET status = 'Revoked'
     WHERE id = 'e0e0e0e0-0000-4000-8000-00000000002d'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    n := 0;
  END;
  RESET ROLE;
  IF n <> 0 THEN
    RAISE EXCEPTION 'T16e FAIL (HARD GATE) — a Team Leader revoked % invitation row(s) in another organization', n;
  END IF;

  n := -1;
  PERFORM pg_temp._sim('c1111111-0000-4000-8000-00000000000a'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Team Leader');
  SET LOCAL ROLE authenticated;
  BEGIN
    DELETE FROM public.invitations WHERE id = 'e0e0e0e0-0000-4000-8000-00000000002d'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    n := 0;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();
  IF n <> 0 THEN
    RAISE EXCEPTION 'T16e FAIL (HARD GATE) — a Team Leader deleted % invitation row(s) in another organization', n;
  END IF;

  SELECT status INTO v_status FROM public.invitations
   WHERE id = 'e0e0e0e0-0000-4000-8000-00000000002d'::uuid;
  IF v_status IS DISTINCT FROM 'Pending' THEN
    RAISE EXCEPTION 'T16e FAIL (HARD GATE) — the org-B invitation is now % (expected an untouched Pending row)',
      COALESCE(v_status, '<row deleted>');
  END IF;
  RAISE NOTICE 'T16e PASS — a Team Leader cannot read, revoke or delete another organization''s invitation';

  -- (f) COUNTERPART to T16d: the Admin invite path must still work.
  -- createInvitation() in src/lib/supabase-users.ts does a CLIENT-SIDE `.from("invitations").insert(...)`,
  -- so invitations_insert is load-bearing browser functionality, not just an ACL. Without this gate a
  -- too-tight insert policy would pass T16d and silently break inviting for everyone.
  n := -1;
  PERFORM pg_temp._sim('a1111111-0000-4000-8000-000000000001'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.invitations (id, organization_id, email, role, token, status, expires_at)
    VALUES ('e0e0e0e0-0000-4000-8000-00000000002e'::uuid,
            'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
            'p0.invitee.admininsert@p0test.invalid', 'Agent',
            'f1f1f1f1-0000-4000-8000-00000000002e'::uuid, 'Pending', now() + interval '7 days');
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'T16f FAIL (HARD GATE) — a same-org Admin could no longer create an invitation: % (SQLSTATE %). createInvitation() inserts from the browser, so this breaks the invite UI entirely.', SQLERRM, SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF n <> 1 THEN
    RAISE EXCEPTION 'T16f FAIL (HARD GATE) — the Admin invitation INSERT affected % row(s), expected 1', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invitations
                  WHERE id = 'e0e0e0e0-0000-4000-8000-00000000002e'::uuid
                    AND organization_id = 'a0a0a0a0-0000-4000-8000-000000000001'::uuid
                    AND status = 'Pending') THEN
    RAISE EXCEPTION 'T16f FAIL (HARD GATE) — the Admin-created invitation is missing or malformed';
  END IF;
  RAISE NOTICE 'T16f PASS — a same-org Admin can still create an invitation (the capability T16d removes from Team Leaders)';
END
$t16$;

-- =====================================================================================================
-- T17 FIXTURES — one usable, one revoked and one expired invitation, each fully populated so that a
-- leak of ANY authority column would be visible.
-- =====================================================================================================
INSERT INTO public.invitations
  (id, organization_id, email, role, team_id, upline_id, token, status, invited_by,
   created_at, expires_at, first_name, last_name, licensed_states, commission_level)
VALUES
  ('e0e0e0e0-0000-4000-8000-00000000003a'::uuid, 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
   'p0.invitee.pending@p0test.invalid', 'Team Leader',
   'c0c0c0c0-0000-4000-8000-000000000001'::uuid, 'a1111111-0000-4000-8000-000000000005'::uuid,
   'f1f1f1f1-0000-4000-8000-00000000003a'::uuid, 'Pending',
   'a1111111-0000-4000-8000-000000000001'::uuid,
   now(), now() + interval '7 days', 'P0', 'Usable', '["TX","NV"]'::jsonb, '80%'),
  ('e0e0e0e0-0000-4000-8000-00000000003b'::uuid, 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
   'p0.invitee.revoked@p0test.invalid', 'Admin',
   'c0c0c0c0-0000-4000-8000-000000000001'::uuid, 'a1111111-0000-4000-8000-000000000005'::uuid,
   'f1f1f1f1-0000-4000-8000-00000000003b'::uuid, 'Revoked',
   'a1111111-0000-4000-8000-000000000001'::uuid,
   now(), now() + interval '7 days', 'P0', 'Revoked', '["TX","NV"]'::jsonb, '80%'),
  ('e0e0e0e0-0000-4000-8000-00000000003c'::uuid, 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
   'p0.invitee.expired@p0test.invalid', 'Admin',
   'c0c0c0c0-0000-4000-8000-000000000001'::uuid, 'a1111111-0000-4000-8000-000000000005'::uuid,
   'f1f1f1f1-0000-4000-8000-00000000003c'::uuid, 'Pending',
   'a1111111-0000-4000-8000-000000000001'::uuid,
   now() - interval '30 days', now() - interval '1 day', 'P0', 'Expired', '["TX","NV"]'::jsonb, '80%');

-- =====================================================================================================
-- T17. get_invitation_by_token_rpc(text) — the anonymous invitation surface. ALL HARD GATES.
--
-- This is the ONE thing an unauthenticated caller can reach that reads public.invitations: it is
-- SECURITY DEFINER, so `REVOKE ALL ON public.invitations FROM anon` does not constrain it. Every call
-- below therefore runs as the `anon` role with NO JWT claims, exactly like AcceptInvitePage.
--
--   T17a  Pending + unexpired  -> row returned, and email / organization_id / role / upline_id /
--                                 commission_level / licensed_states / org_name are all NON-null
--                                 (these are the signup prefill authority fields — nulling them would
--                                 break invited signup, so this is a functional gate, not just security)
--   T17b  Revoked              -> row still returned (AcceptInvitePage needs status + expires_at to
--                                 render its distinct message) but every authority/PII column is NULL
--   T17c  Expired              -> identical nulling, driven by expires_at rather than status
--   T17d  unknown / malformed  -> no row at all
--   T17e  metadata             -> exactly one overload, identity args `invite_token text`, owner,
--                                 prosecdef, a pinned search_path in proconfig, the 14 OUT columns, and
--                                 EXECUTE for anon / authenticated / service_role
-- =====================================================================================================
DO $t17$
DECLARE
  rec         record;
  got         boolean;
  v_ident     text;
  v_owner     text;
  v_secdef    boolean;
  v_config    text[];
  v_names     text[];
  v_types     text[];
  v_acl       text[];
  v_overloads int;
BEGIN
  -- (a) Pending + unexpired: the prefill authority must be present.
  PERFORM pg_temp._sys();
  SET LOCAL ROLE anon;
  SELECT * INTO rec FROM public.get_invitation_by_token_rpc('f1f1f1f1-0000-4000-8000-00000000003a');
  got := FOUND;
  RESET ROLE;

  IF NOT got THEN
    RAISE EXCEPTION 'T17a FAIL (HARD GATE) — get_invitation_by_token_rpc returned NO row for a Pending, unexpired token; invited signup would break entirely';
  END IF;
  IF rec.id IS DISTINCT FROM 'e0e0e0e0-0000-4000-8000-00000000003a'::uuid THEN
    RAISE EXCEPTION 'T17a FAIL (HARD GATE) — the RPC returned the wrong invitation (id=%)', rec.id;
  END IF;
  IF rec.email IS NULL OR rec.organization_id IS NULL OR rec.role IS NULL
     OR rec.upline_id IS NULL OR rec.commission_level IS NULL
     OR rec.licensed_states IS NULL OR rec.org_name IS NULL THEN
    RAISE EXCEPTION 'T17a FAIL (HARD GATE) — a usable invitation must expose every signup prefill authority field, got email=% organization_id=% role=% upline_id=% commission_level=% licensed_states=% org_name=%',
      rec.email, rec.organization_id, rec.role, rec.upline_id, rec.commission_level,
      rec.licensed_states, rec.org_name;
  END IF;
  IF rec.email <> 'p0.invitee.pending@p0test.invalid'
     OR rec.organization_id <> 'a0a0a0a0-0000-4000-8000-000000000001'::uuid
     OR rec.role <> 'Team Leader'
     OR rec.org_name <> 'P0 Test Org A' THEN
    RAISE EXCEPTION 'T17a FAIL (HARD GATE) — prefill values do not match the server row: email=% organization_id=% role=% org_name=%',
      rec.email, rec.organization_id, rec.role, rec.org_name;
  END IF;
  IF rec.status IS DISTINCT FROM 'Pending' OR rec.expires_at IS NULL THEN
    RAISE EXCEPTION 'T17a FAIL (HARD GATE) — status/expires_at missing on a usable invitation (status=% expires_at=%)',
      rec.status, rec.expires_at;
  END IF;
  RAISE NOTICE 'T17a PASS — Pending+unexpired token returns the full prefill authority (org=%, role=%)',
    rec.org_name, rec.role;

  -- (b) Revoked: the row survives (for the UI message) but discloses nothing.
  PERFORM pg_temp._sys();
  SET LOCAL ROLE anon;
  SELECT * INTO rec FROM public.get_invitation_by_token_rpc('f1f1f1f1-0000-4000-8000-00000000003b');
  got := FOUND;
  RESET ROLE;

  IF NOT got THEN
    RAISE EXCEPTION 'T17b FAIL (HARD GATE) — no row returned for a Revoked token; AcceptInvitePage could no longer distinguish revoked from invalid';
  END IF;
  IF rec.status IS DISTINCT FROM 'Revoked' OR rec.expires_at IS NULL THEN
    RAISE EXCEPTION 'T17b FAIL (HARD GATE) — status/expires_at must stay populated for a Revoked invitation (status=% expires_at=%)',
      rec.status, rec.expires_at;
  END IF;
  IF rec.email IS NOT NULL OR rec.organization_id IS NOT NULL OR rec.role IS NOT NULL
     OR rec.upline_id IS NOT NULL OR rec.commission_level IS NOT NULL
     OR rec.licensed_states IS NOT NULL OR rec.org_name IS NOT NULL THEN
    RAISE EXCEPTION 'T17b FAIL (HARD GATE) — a REVOKED invitation leaked tenant data to an anonymous token holder: email=% organization_id=% role=% upline_id=% commission_level=% licensed_states=% org_name=%',
      rec.email, rec.organization_id, rec.role, rec.upline_id, rec.commission_level,
      rec.licensed_states, rec.org_name;
  END IF;
  RAISE NOTICE 'T17b PASS — Revoked invitation returns id/token/status/expires_at only; every authority and PII column is NULL';

  -- (c) Expired (status is still 'Pending' — expiry alone must null the same columns).
  PERFORM pg_temp._sys();
  SET LOCAL ROLE anon;
  SELECT * INTO rec FROM public.get_invitation_by_token_rpc('f1f1f1f1-0000-4000-8000-00000000003c');
  got := FOUND;
  RESET ROLE;

  IF NOT got THEN
    RAISE EXCEPTION 'T17c FAIL (HARD GATE) — no row returned for an expired token; AcceptInvitePage could no longer distinguish expired from invalid';
  END IF;
  IF rec.status IS DISTINCT FROM 'Pending' THEN
    RAISE EXCEPTION 'T17c FAIL (HARD GATE) — the expired fixture should still report status=Pending (got %); the nulling must be driven by expires_at, not only by status', rec.status;
  END IF;
  IF rec.expires_at IS NULL OR rec.expires_at >= now() THEN
    RAISE EXCEPTION 'T17c FAIL (HARD GATE) — expires_at must be returned and must be in the past (got %)', rec.expires_at;
  END IF;
  IF rec.email IS NOT NULL OR rec.organization_id IS NOT NULL OR rec.role IS NOT NULL
     OR rec.upline_id IS NOT NULL OR rec.commission_level IS NOT NULL
     OR rec.licensed_states IS NOT NULL OR rec.org_name IS NOT NULL THEN
    RAISE EXCEPTION 'T17c FAIL (HARD GATE) — an EXPIRED invitation leaked tenant data to an anonymous token holder: email=% organization_id=% role=% upline_id=% commission_level=% licensed_states=% org_name=%',
      rec.email, rec.organization_id, rec.role, rec.upline_id, rec.commission_level,
      rec.licensed_states, rec.org_name;
  END IF;
  RAISE NOTICE 'T17c PASS — expired-but-Pending invitation is nulled exactly like a Revoked one';

  -- (d) Unknown and malformed tokens return nothing at all.
  PERFORM pg_temp._sys();
  SET LOCAL ROLE anon;
  SELECT * INTO rec FROM public.get_invitation_by_token_rpc('99999999-9999-4999-8999-999999999999');
  got := FOUND;
  RESET ROLE;
  IF got THEN
    RAISE EXCEPTION 'T17d FAIL (HARD GATE) — a random UUID token returned a row (id=%)', rec.id;
  END IF;

  PERFORM pg_temp._sys();
  SET LOCAL ROLE anon;
  SELECT * INTO rec FROM public.get_invitation_by_token_rpc('p0-not-a-token');
  got := FOUND;
  RESET ROLE;
  IF got THEN
    RAISE EXCEPTION 'T17d FAIL (HARD GATE) — a malformed (non-UUID) token returned a row (id=%)', rec.id;
  END IF;
  RAISE NOTICE 'T17d PASS — unknown and malformed tokens return no row';

  -- (e) Metadata: signature, owner, definer-ness, pinned search_path and ACL.
  PERFORM pg_temp._sys();

  SELECT count(*) INTO v_overloads
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_invitation_by_token_rpc';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'T17e FAIL (HARD GATE) — expected exactly 1 public.get_invitation_by_token_rpc, found %; an extra overload would sit beside the hardened definition and could be resolved instead of it', v_overloads;
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid),
         pg_get_userbyid(p.proowner)::text,
         p.prosecdef,
         p.proconfig,
         p.proargnames,
         (SELECT array_agg(t.typname::text ORDER BY o.ord)
            FROM unnest(p.proallargtypes) WITH ORDINALITY AS o(t_oid, ord)
            JOIN pg_type t ON t.oid = o.t_oid),
         (SELECT array_agg(DISTINCT pg_get_userbyid(a.grantee)::text)
            FROM aclexplode(p.proacl) AS a
           WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> 0)
    INTO v_ident, v_owner, v_secdef, v_config, v_names, v_types, v_acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_invitation_by_token_rpc';

  IF v_ident IS DISTINCT FROM 'invite_token text' THEN
    RAISE EXCEPTION 'T17e FAIL (HARD GATE) — the RPC signature drifted to get_invitation_by_token_rpc(%); the client calls it with a single text argument', v_ident;
  END IF;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'T17e FAIL (HARD GATE) — prosecdef is %; the RPC must be SECURITY DEFINER because anon holds no privilege on public.invitations after this migration', v_secdef;
  END IF;
  IF v_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'T17e FAIL (HARD GATE) — the SECURITY DEFINER RPC is owned by % (expected postgres); the owner decides whose privileges the body runs with, and a DROP+CREATE by another role silently changes it', v_owner;
  END IF;
  IF v_config IS NULL
     OR NOT EXISTS (SELECT 1 FROM unnest(v_config) AS c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'T17e FAIL (HARD GATE) — proconfig is % — a SECURITY DEFINER function with no pinned search_path is hijackable by a caller-created schema', v_config;
  END IF;
  IF v_names IS DISTINCT FROM ARRAY[
       'invite_token','id','email','organization_id','role','upline_id','first_name','last_name',
       'licensed_states','commission_level','token','expires_at','created_at','status','org_name'
     ]::text[] THEN
    RAISE EXCEPTION 'T17e FAIL (HARD GATE) — the argument + 14 OUT column names drifted to %; the migration promises an exactly preserved signature', v_names;
  END IF;
  IF v_types IS DISTINCT FROM ARRAY[
       'text','uuid','text','uuid','text','uuid','text','text','jsonb','text','text',
       'timestamptz','timestamptz','text','text'
     ]::text[] THEN
    RAISE EXCEPTION 'T17e FAIL (HARD GATE) — the argument + OUT column types drifted to %', v_types;
  END IF;

  IF NOT has_function_privilege('anon', 'public.get_invitation_by_token_rpc(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T17e FAIL (HARD GATE) — anon lost EXECUTE on get_invitation_by_token_rpc; the anonymous accept-invite page would fail';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_invitation_by_token_rpc(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T17e FAIL (HARD GATE) — authenticated lost EXECUTE on get_invitation_by_token_rpc';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_invitation_by_token_rpc(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T17e FAIL (HARD GATE) — service_role lost EXECUTE on get_invitation_by_token_rpc';
  END IF;
  IF v_acl IS NULL OR NOT (v_acl @> ARRAY['anon','authenticated','service_role']::text[]) THEN
    RAISE EXCEPTION 'T17e FAIL (HARD GATE) — the RPC ACL does not explicitly grant EXECUTE to anon, authenticated and service_role (explicit grantees: %). CREATE OR REPLACE preserves the ACL; a DROP+CREATE does not, and would silently strip the anon grant.', v_acl;
  END IF;

  RAISE NOTICE 'T17e PASS — get_invitation_by_token_rpc(%) owner=% secdef=% proconfig=% explicit EXECUTE grantees=%',
    v_ident, v_owner, v_secdef, v_config, v_acl;
END
$t17$;

-- =====================================================================================================
-- T18 FIXTURES — the founder profile that provision_organization() must attach, plus a LOCAL collision
-- preflight covering the identifiers this block introduces.
--
-- Created HERE rather than in the main fixture block for the same reason the T14/T16 fixtures are: T0b
-- hard-asserts an exact count of 11 fixture profiles, and that assertion only stays meaningful if later
-- fixtures arrive after it. Created as the session role, so auth.uid() IS NULL and the guard
-- trg_00_enforce_profile_field_authorization treats every write below as the trusted system path.
--
-- IDENTIFIERS INTRODUCED HERE (add them to the T0a array the next time that list is regenerated):
--   c1111111-0000-4000-8000-00000000018a   U_FOUNDER_18   p0.founder18@p0test.invalid
--   c1111111-0000-4000-8000-00000000018c   the NONEXISTENT founder uuid T18c passes — NEVER created
--   organizations name 'P0 Dry Run Org T18b' / slug 'p0-dryrun-t18b'   (created by T18b)
--   organizations name 'P0 Dry Run Org T18c' / slug 'p0-dryrun-t18c'   (must NEVER come into existence)
-- The 'P0 ' name prefix and the 'p0-dryrun-' slug prefix are exactly what the dry-run wrapper's
-- collision preflight and supabase/tests/p0_post_rollback_verification.sql look for.
-- =====================================================================================================
DO $t18f$
DECLARE
  n_collide int;
  t_twilio  char;
BEGIN
  SELECT (SELECT count(*) FROM auth.users
            WHERE id IN ('c1111111-0000-4000-8000-00000000018a'::uuid,
                         'c1111111-0000-4000-8000-00000000018c'::uuid)
               OR email = 'p0.founder18@p0test.invalid')
       + (SELECT count(*) FROM public.profiles
            WHERE id IN ('c1111111-0000-4000-8000-00000000018a'::uuid,
                         'c1111111-0000-4000-8000-00000000018c'::uuid)
               OR email = 'p0.founder18@p0test.invalid')
       + (SELECT count(*) FROM public.organizations
            WHERE name IN ('P0 Dry Run Org T18b', 'P0 Dry Run Org T18c')
               OR slug IN ('p0-dryrun-t18b', 'p0-dryrun-t18c'))
  INTO n_collide;

  IF n_collide <> 0 THEN
    RAISE EXCEPTION
      'T18 fixture FAIL — % pre-existing row(s) already use a T18 identifier (auth user / profile / organization). Refusing to adopt and mutate them.',
      n_collide;
  END IF;

  -- Reporting only, never a gate. The dry-run wrapper disables
  -- public.organizations.on_organization_created_provision_twilio for the whole transaction, so the
  -- organization INSERT inside provision_organization() queues no pg_net request. On a STANDALONE run of
  -- this matrix that trigger is live — but the main fixture block already inserts ORG_A and ORG_B, so
  -- T18 introduces no external-effect exposure that the file did not already have. T18 deliberately does
  -- not touch the trigger's state in either direction.
  SELECT tgenabled INTO t_twilio
    FROM pg_trigger
   WHERE tgname = 'on_organization_created_provision_twilio'
     AND tgrelid = 'public.organizations'::regclass;
  RAISE NOTICE 'T18 fixtures — identifiers free; on_organization_created_provision_twilio tgenabled=% (D = disabled by the dry-run wrapper, as expected)',
    COALESCE(t_twilio::text, '(trigger absent)');
END
$t18f$;

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('c1111111-0000-4000-8000-00000000018a'::uuid, 'p0.founder18@p0test.invalid',
   '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

-- Belt and braces, same idiom as every other fixture block (only fires if on_auth_user_created is absent).
INSERT INTO public.profiles (id, email, first_name, last_name, role, status)
SELECT u.id, u.email, 'P0', 'Founder', 'Agent', 'Active'
FROM auth.users u
WHERE u.id = 'c1111111-0000-4000-8000-00000000018a'::uuid
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

DO $t18g$
DECLARE
  v_org  uuid;
  v_role text;
BEGIN
  SELECT organization_id, role INTO v_org, v_role
    FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000018a'::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T18 fixture FAIL — the founder profile was not created (is on_auth_user_created / handle_new_user installed?)';
  END IF;
  -- The founder must arrive org-less and NOT already an Admin, otherwise T18b would assert a state that
  -- provision_organization() did not actually produce.
  IF v_org IS NOT NULL THEN
    RAISE EXCEPTION 'T18 fixture FAIL — the founder profile already carries organization_id % ; T18b could not prove the attach', v_org;
  END IF;
  IF v_role IS DISTINCT FROM 'Agent' THEN
    RAISE EXCEPTION 'T18 fixture FAIL — the founder profile arrived with role % (expected Agent); T18b could not prove the promotion to Admin', v_role;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000018c'::uuid)
     OR EXISTS (SELECT 1 FROM auth.users    WHERE id = 'c1111111-0000-4000-8000-00000000018c'::uuid) THEN
    RAISE EXCEPTION 'T18 fixture FAIL — c1111111-0000-4000-8000-00000000018c exists; T18c needs it to be a genuinely NONEXISTENT founder';
  END IF;
  RAISE NOTICE 'T18 fixtures ready — org-less Agent founder profile, and the T18c founder uuid confirmed absent';
END
$t18g$;

-- =====================================================================================================
-- T18. public.provision_organization(text, text, uuid) — the atomic founder-organization provisioning
-- added by §4b of the migration. ALL HARD GATES.
--
-- This function is the ONLY writer that creates an organization together with its dispositions and its
-- founder Admin in one statement. Two things have to hold:
--   * it must be unreachable from the browser. It is SECURITY DEFINER and owned by the role that owns the
--     other public definer functions, so a stray EXECUTE grant to anon/authenticated/PUBLIC would let any
--     visitor mint an organization AND rewrite an arbitrary profile's organization_id + role='Admin' —
--     precisely the tenancy takeover the rest of this migration closes.
--   * it must be atomic. The whole point of moving provisioning into the database (plan requirement 15)
--     is that a failure leaves NOTHING behind: 41 tables hold ON DELETE NO ACTION FKs to
--     public.organizations, so an Edge Function cannot compensate a half-created org.
--
--   T18a  EXECUTE privilege — FALSE for PUBLIC / anon / authenticated, TRUE for service_role, and the
--         ACL carries no PUBLIC ("=X/owner") aclitem
--   T18b  a successful system/service-role call creates EXACTLY one organization, six dispositions, the
--         trigger-seeded pipeline_stages / appointment_types / lead_sources, and attaches the founder
--   T18c  a nonexistent founder uuid RAISEs and leaves NOTHING behind — no organization, no seeded rows,
--         no mutated profile
--   T18d  metadata — prosecdef, the owner (captured dynamically from the other public definer functions),
--         the pinned search_path, and the exact execution ACL asserted in T18a
--
-- EXPECTED SEED COUNTS ARE EXACT, NOT ">0". They were read off the live seeding functions, each of which
-- inserts a FIXED list of rows guarded by NOT EXISTS — deterministic for a brand-new organization:
--   public.seed_default_pipeline_stages(uuid)   6 'lead' + 5 'recruit'                     = 11
--   public.seed_default_appointment_types(uuid) Sales Call, Follow Up, Recruit Interview,
--                                               Policy Review, Policy Anniversary, Other   =  6
--   public.seed_default_lead_sources(uuid)      a single 8-row VALUES list                 =  8
--   dispositions come from provision_organization() itself                                 =  6
-- Exact counts matter because all three trigger wrappers swallow failures
-- (EXCEPTION WHEN OTHERS THEN RAISE WARNING), so a broken seed would otherwise pass a ">0" check on a
-- partially seeded org, or pass silently at 0 if a future revision changed the wrapper.
-- =====================================================================================================
DO $t18$
DECLARE
  v_founder        uuid := 'c1111111-0000-4000-8000-00000000018a'::uuid;
  v_ghost          uuid := 'c1111111-0000-4000-8000-00000000018c'::uuid;
  v_oid            oid;
  v_overloads      int;
  v_ident          text;
  v_acl_raw        aclitem[];
  v_acl            text[];
  v_acl2           text[];
  v_acl_expected   text[];
  v_pub_items      int;
  v_org            uuid;
  v_org_c          uuid;
  v_name           text;
  v_slug           text;
  v_disp_names     text[];
  v_prof_id        uuid;
  v_prof_role      text;
  n                bigint;
  n_disp           bigint;
  n_stages         bigint;
  n_appt           bigint;
  n_src            bigint;
  b_org            bigint; b_disp bigint; b_stg bigint; b_appt bigint; b_src bigint; b_digest text;
  a_org            bigint; a_disp bigint; a_stg bigint; a_appt bigint; a_src bigint; a_digest text;
  v_raised         boolean := false;
  v_sqlstate       text;
  v_msg            text;
  v_orphans        bigint;
  v_secdef         boolean;
  v_config         text[];
  v_sp             text;
  v_owner          text;
  v_expected_owner text;
  v_owner_others   bigint;
  v_owner_total    bigint;
BEGIN
  PERFORM pg_temp._sys();

  -- ---------------------------------------------------------------------------------------------------
  -- (a) EXECUTE privilege. Resolved through the function OID rather than a text signature so an added
  --     overload cannot make the check silently inspect a different function.
  -- ---------------------------------------------------------------------------------------------------
  SELECT count(*) INTO v_overloads
  FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
  WHERE n2.nspname = 'public' AND p.proname = 'provision_organization';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'T18a FAIL (HARD GATE) — expected exactly 1 public.provision_organization, found %; an extra overload would sit beside the hardened definition, carry its own ACL, and could be resolved instead of it',
      v_overloads;
  END IF;

  SELECT p.oid, pg_get_function_identity_arguments(p.oid), p.proacl
    INTO v_oid, v_ident, v_acl_raw
  FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
  WHERE n2.nspname = 'public' AND p.proname = 'provision_organization';

  IF v_ident IS DISTINCT FROM 'text, text, uuid' THEN
    RAISE EXCEPTION 'T18a FAIL (HARD GATE) — the signature drifted to provision_organization(%); create-user and create-organization call it as (text, text, uuid)', v_ident;
  END IF;

  IF has_function_privilege('public', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'T18a FAIL (HARD GATE) — PUBLIC holds EXECUTE on provision_organization(text, text, uuid). Any visitor could mint an organization and rewrite an arbitrary profile to organization_id=<new org>, role=Admin.';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'T18a FAIL (HARD GATE) — anon holds EXECUTE on provision_organization(text, text, uuid); an UNAUTHENTICATED caller could create organizations and re-tenant profiles.';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'T18a FAIL (HARD GATE) — authenticated holds EXECUTE on provision_organization(text, text, uuid); any logged-in user could re-tenant any profile by uuid and make it an Admin.';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'T18a FAIL (HARD GATE) — service_role LOST EXECUTE on provision_organization(text, text, uuid); self-serve signup and create-organization would break.';
  END IF;

  -- proacl NULL means the DEFAULT acl in Postgres: owner + EXECUTE for PUBLIC. It is a failure, not a
  -- neutral "no grants" state.
  IF v_acl_raw IS NULL THEN
    RAISE EXCEPTION 'T18a FAIL (HARD GATE) — proacl is NULL, which Postgres interprets as the DEFAULT ACL (owner + EXECUTE to PUBLIC). The REVOKE ALL ... FROM PUBLIC did not take effect.';
  END IF;

  -- The PUBLIC grant form is an aclitem whose GRANTEE is empty, i.e. it renders as "=X/owner". A naive
  -- `proacl::text LIKE '%=X/%'` cannot be used: it also matches the owner's own "postgres=X/postgres".
  -- Testing each aclitem for a leading '=' is the exact test, and the aclexplode grantee = 0 check below
  -- is the same assertion expressed structurally.
  SELECT count(*) INTO v_pub_items
    FROM unnest(v_acl_raw) AS t(ai)
   WHERE t.ai::text LIKE '=%';
  IF v_pub_items <> 0 THEN
    RAISE EXCEPTION 'T18a FAIL (HARD GATE) — proacl carries % PUBLIC aclitem(s) of the "=X/owner" form: %',
      v_pub_items, v_acl_raw::text;
  END IF;
  IF EXISTS (SELECT 1 FROM aclexplode(v_acl_raw) a WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
    RAISE EXCEPTION 'T18a FAIL (HARD GATE) — aclexplode reports an EXECUTE grant to grantee 0 (PUBLIC): %', v_acl_raw::text;
  END IF;

  SELECT array_agg(DISTINCT pg_get_userbyid(a.grantee)::text)
    INTO v_acl
    FROM aclexplode(v_acl_raw) a
   WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> 0;

  IF v_acl IS NULL OR NOT (v_acl @> ARRAY['service_role']::text[]) THEN
    RAISE EXCEPTION 'T18a FAIL (HARD GATE) — service_role is not an EXPLICIT EXECUTE grantee (explicit grantees: %)', v_acl;
  END IF;
  IF v_acl && ARRAY['anon', 'authenticated']::text[] THEN
    RAISE EXCEPTION 'T18a FAIL (HARD GATE) — anon and/or authenticated appear as explicit EXECUTE grantees: %', v_acl;
  END IF;

  RAISE NOTICE 'T18a PASS — provision_organization(%) is service_role-only (explicit EXECUTE grantees: %; no PUBLIC aclitem)',
    v_ident, v_acl;

  -- ---------------------------------------------------------------------------------------------------
  -- (b) A successful system/service-role call. _sys() first so auth.uid() IS NULL: that is the trusted
  --     system path in trg_00_enforce_profile_field_authorization, which is what lets the founder attach
  --     write the system-only organization_id column at all. The name is passed with padding so the
  --     btrim() in the function body is exercised too.
  -- ---------------------------------------------------------------------------------------------------
  PERFORM pg_temp._sys();
  SET LOCAL ROLE service_role;
  SELECT public.provision_organization('  P0 Dry Run Org T18b  ', 'p0-dryrun-t18b', v_founder)
    INTO v_org;
  RESET ROLE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — provision_organization returned NULL instead of the new organization id';
  END IF;

  SELECT count(*) INTO n FROM public.organizations WHERE id = v_org;
  IF n <> 1 THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — expected exactly 1 organization with the returned id %, found %', v_org, n;
  END IF;

  SELECT count(*) INTO n FROM public.organizations
   WHERE name LIKE 'P0 Dry Run Org T18b%' OR slug = 'p0-dryrun-t18b';
  IF n <> 1 THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — expected exactly 1 organization matching the T18b fixture name/slug, found %', n;
  END IF;

  SELECT o.name, o.slug INTO v_name, v_slug FROM public.organizations o WHERE o.id = v_org;
  IF v_name IS DISTINCT FROM 'P0 Dry Run Org T18b' THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — organization name is % (expected the btrim()ed "P0 Dry Run Org T18b")', quote_literal(v_name);
  END IF;
  IF v_slug IS DISTINCT FROM 'p0-dryrun-t18b' THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — organization slug is % (expected p0-dryrun-t18b)', quote_literal(v_slug);
  END IF;

  -- Exactly six dispositions, and exactly the six the function names.
  SELECT count(*) INTO n_disp FROM public.dispositions d WHERE d.organization_id = v_org;
  IF n_disp <> 6 THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — expected exactly 6 dispositions for the new organization, found %', n_disp;
  END IF;
  SELECT array_agg(d.name ORDER BY d.sort_order) INTO v_disp_names
    FROM public.dispositions d WHERE d.organization_id = v_org;
  IF v_disp_names IS DISTINCT FROM
     ARRAY['No Answer', 'Appointment Set', 'Call Back', 'Not Interested', 'DNC', 'Sold']::text[] THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — the seeded disposition set drifted to % (expected No Answer, Appointment Set, Call Back, Not Interested, DNC, Sold in sort_order)', v_disp_names;
  END IF;

  -- Trigger-seeded records. Exact counts, derived from the live seed functions (see the block header).
  SELECT count(*) INTO n_stages FROM public.pipeline_stages   s WHERE s.organization_id = v_org;
  SELECT count(*) INTO n_appt   FROM public.appointment_types a WHERE a.organization_id = v_org;
  SELECT count(*) INTO n_src    FROM public.lead_sources      l WHERE l.organization_id = v_org;

  IF n_stages <> 11 THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — expected exactly 11 pipeline_stages (6 lead + 5 recruit) from on_organization_created_seed_pipeline_stages, found %. That trigger wrapper swallows errors into a WARNING, so a low count means the seed failed silently and the new organization is unusable.', n_stages;
  END IF;
  IF n_appt <> 6 THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — expected exactly 6 appointment_types from on_organization_created_seed_appointment_types, found %. That trigger wrapper swallows errors into a WARNING.', n_appt;
  END IF;
  IF n_src <> 8 THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — expected exactly 8 lead_sources from on_organization_created_seed_lead_sources, found %. That trigger wrapper swallows errors into a WARNING.', n_src;
  END IF;

  -- Founder attached: exactly one profile in the new org, and it is the founder, as Admin.
  SELECT count(*) INTO n FROM public.profiles p WHERE p.organization_id = v_org;
  IF n <> 1 THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — expected exactly 1 profile attached to the new organization, found %', n;
  END IF;
  SELECT p.id, p.role INTO v_prof_id, v_prof_role
    FROM public.profiles p WHERE p.organization_id = v_org;
  IF v_prof_id IS DISTINCT FROM v_founder THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — the profile attached to the new organization is % (expected the founder %)', v_prof_id, v_founder;
  END IF;
  IF v_prof_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'T18b FAIL (HARD GATE) — the founder profile has role % (expected Admin)', quote_literal(v_prof_role);
  END IF;

  RAISE NOTICE 'T18b PASS — org % created with 6 dispositions, 11 pipeline_stages, 6 appointment_types, 8 lead_sources, and the founder attached as Admin',
    v_org;

  -- ---------------------------------------------------------------------------------------------------
  -- (c) A nonexistent founder uuid must RAISE and leave NOTHING behind.
  --
  --     provision_organization() raises from inside its own body, so the entire top-level statement —
  --     organization INSERT, disposition seed, and every AFTER INSERT trigger seed — rolls back. The
  --     BEGIN ... EXCEPTION wrapper below opens a subtransaction, which is what makes the rollback
  --     observable here instead of aborting the whole script. Counts are snapshotted before and compared
  --     after, so this proves "nothing behind" globally rather than only for the fixture names.
  -- ---------------------------------------------------------------------------------------------------
  SELECT count(*) INTO b_org  FROM public.organizations;
  SELECT count(*) INTO b_disp FROM public.dispositions;
  SELECT count(*) INTO b_stg  FROM public.pipeline_stages;
  SELECT count(*) INTO b_appt FROM public.appointment_types;
  SELECT count(*) INTO b_src  FROM public.lead_sources;
  SELECT md5(COALESCE(string_agg(
           p.id::text || '|' || COALESCE(p.organization_id::text, '-') || '|' || COALESCE(p.role, '-')
             || '|' || COALESCE(p.status, '-') || '|' || COALESCE(p.upline_id::text, '-')
             || '|' || COALESCE(p.team_id::text, '-') || '|' || COALESCE(p.is_super_admin::text, '-')
             || '|' || COALESCE(p.platform_role, '-'),
           ',' ORDER BY p.id), ''))
    INTO b_digest FROM public.profiles p;

  PERFORM pg_temp._sys();
  SET LOCAL ROLE service_role;
  BEGIN
    SELECT public.provision_organization('P0 Dry Run Org T18c', 'p0-dryrun-t18c', v_ghost)
      INTO v_org_c;
  EXCEPTION WHEN OTHERS THEN
    v_raised := true; v_sqlstate := SQLSTATE; v_msg := SQLERRM;
  END;
  RESET ROLE;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'T18c FAIL (HARD GATE) — provision_organization SUCCEEDED with a founder uuid that has no profile (returned %). Self-serve signup could then strand an organization whose founder does not exist, and 41 ON DELETE NO ACTION foreign keys make that orphan undeletable.',
      v_org_c;
  END IF;

  SELECT count(*) INTO a_org  FROM public.organizations;
  SELECT count(*) INTO a_disp FROM public.dispositions;
  SELECT count(*) INTO a_stg  FROM public.pipeline_stages;
  SELECT count(*) INTO a_appt FROM public.appointment_types;
  SELECT count(*) INTO a_src  FROM public.lead_sources;
  SELECT md5(COALESCE(string_agg(
           p.id::text || '|' || COALESCE(p.organization_id::text, '-') || '|' || COALESCE(p.role, '-')
             || '|' || COALESCE(p.status, '-') || '|' || COALESCE(p.upline_id::text, '-')
             || '|' || COALESCE(p.team_id::text, '-') || '|' || COALESCE(p.is_super_admin::text, '-')
             || '|' || COALESCE(p.platform_role, '-'),
           ',' ORDER BY p.id), ''))
    INTO a_digest FROM public.profiles p;

  SELECT count(*) INTO n FROM public.organizations
   WHERE name LIKE 'P0 Dry Run Org T18c%' OR slug = 'p0-dryrun-t18c';
  IF n <> 0 THEN
    RAISE EXCEPTION 'T18c FAIL (HARD GATE) — % organization row(s) matching the T18c fixture name/slug survived the failed call', n;
  END IF;

  IF a_org <> b_org THEN
    RAISE EXCEPTION 'T18c FAIL (HARD GATE) — organizations count changed across the failed call (% -> %)', b_org, a_org;
  END IF;
  IF a_disp <> b_disp THEN
    RAISE EXCEPTION 'T18c FAIL (HARD GATE) — dispositions count changed across the failed call (% -> %); the disposition seed was not rolled back', b_disp, a_disp;
  END IF;
  IF a_stg <> b_stg THEN
    RAISE EXCEPTION 'T18c FAIL (HARD GATE) — pipeline_stages count changed across the failed call (% -> %); the AFTER INSERT seed was not rolled back', b_stg, a_stg;
  END IF;
  IF a_appt <> b_appt THEN
    RAISE EXCEPTION 'T18c FAIL (HARD GATE) — appointment_types count changed across the failed call (% -> %); the AFTER INSERT seed was not rolled back', b_appt, a_appt;
  END IF;
  IF a_src <> b_src THEN
    RAISE EXCEPTION 'T18c FAIL (HARD GATE) — lead_sources count changed across the failed call (% -> %); the AFTER INSERT seed was not rolled back', b_src, a_src;
  END IF;

  -- Structural restatement of the same property: no seeded row may point at an organization that does
  -- not exist (which is what a half-rolled-back provisioning would look like from the child side).
  SELECT (SELECT count(*) FROM public.dispositions x
            WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = x.organization_id))
       + (SELECT count(*) FROM public.pipeline_stages x
            WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = x.organization_id))
       + (SELECT count(*) FROM public.appointment_types x
            WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = x.organization_id))
       + (SELECT count(*) FROM public.lead_sources x
            WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = x.organization_id))
  INTO v_orphans;
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION 'T18c FAIL (HARD GATE) — % seeded row(s) reference a nonexistent organization after the failed call', v_orphans;
  END IF;

  IF a_digest IS DISTINCT FROM b_digest THEN
    RAISE EXCEPTION 'T18c FAIL (HARD GATE) — a profile was mutated by the failed call (authorization digest over id/organization_id/role/status/upline_id/team_id/is_super_admin/platform_role changed from % to %). The founder UPDATE must roll back with the organization.',
      b_digest, a_digest;
  END IF;

  RAISE NOTICE 'T18c PASS — nonexistent founder raised (SQLSTATE %, %) and nothing was left behind (organizations/dispositions/pipeline_stages/appointment_types/lead_sources unchanged, profile digest unchanged)',
    v_sqlstate, v_msg;

  -- ---------------------------------------------------------------------------------------------------
  -- (d) Metadata: definer-ness, owner, pinned search_path, and the exact execution ACL from T18a.
  -- ---------------------------------------------------------------------------------------------------
  SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner)::text, p.proacl
    INTO v_secdef, v_config, v_owner, v_acl_raw
  FROM pg_proc p WHERE p.oid = v_oid;

  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'T18d FAIL (HARD GATE) — prosecdef is % ; provision_organization must be SECURITY DEFINER because service_role holds no direct privilege path for the founder attach, and an INVOKER function would also expose the caller''s RLS to the organization INSERT', v_secdef;
  END IF;

  -- Expected owner captured DYNAMICALLY: whatever role owns the other public SECURITY DEFINER functions.
  -- Hardcoding a guess would turn a legitimate platform-wide owner change into a false failure, while
  -- silently accepting the one case that matters — this function alone being owned by a different role.
  SELECT pg_get_userbyid(p.proowner)::text INTO v_expected_owner
  FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
  WHERE n2.nspname = 'public' AND p.prosecdef AND p.oid <> v_oid
  GROUP BY p.proowner
  ORDER BY count(*) DESC, 1
  LIMIT 1;

  IF v_expected_owner IS NULL THEN
    RAISE EXCEPTION 'T18d FAIL (HARD GATE) — no other public SECURITY DEFINER function exists to establish the expected owner; the owner assertion cannot be made and must not be skipped';
  END IF;

  SELECT count(*) FILTER (WHERE pg_get_userbyid(p.proowner)::text <> v_expected_owner),
         count(*)
    INTO v_owner_others, v_owner_total
  FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
  WHERE n2.nspname = 'public' AND p.prosecdef AND p.oid <> v_oid;

  IF v_owner IS DISTINCT FROM v_expected_owner THEN
    RAISE EXCEPTION 'T18d FAIL (HARD GATE) — provision_organization is owned by % but the other % public SECURITY DEFINER functions are predominantly owned by % (% of them differ from that). The owner decides whose privileges the body runs with; a DROP+CREATE by another role silently changes it AND discards the ACL.',
      v_owner, v_owner_total, v_expected_owner, v_owner_others;
  END IF;

  IF v_config IS NULL THEN
    RAISE EXCEPTION 'T18d FAIL (HARD GATE) — proconfig is NULL: a SECURITY DEFINER function with no pinned search_path is hijackable by a caller-created schema, and this one writes organizations, dispositions and profiles';
  END IF;

  SELECT c INTO v_sp FROM unnest(v_config) AS t(c) WHERE t.c LIKE 'search_path=%' LIMIT 1;
  IF v_sp IS NULL THEN
    RAISE EXCEPTION 'T18d FAIL (HARD GATE) — proconfig % contains no search_path entry', v_config;
  END IF;
  IF NOT ('public' = ANY (string_to_array(replace(substr(v_sp, 13), ' ', ''), ','))) THEN
    RAISE EXCEPTION 'T18d FAIL (HARD GATE) — the pinned search_path % does not include public; the body references public.organizations / public.dispositions / public.profiles unqualified-by-search-path resolution and would break or resolve elsewhere', v_sp;
  END IF;
  IF v_sp IS DISTINCT FROM 'search_path=public, pg_temp' THEN
    RAISE EXCEPTION 'T18d FAIL (HARD GATE) — the pinned search_path is % (expected exactly "search_path=public, pg_temp" as written by the migration)', quote_literal(v_sp);
  END IF;

  -- The ACL asserted in T18a, re-read and compared EXACTLY: {owner, service_role} and nothing else.
  IF v_acl_raw IS NULL THEN
    RAISE EXCEPTION 'T18d FAIL (HARD GATE) — proacl became NULL (the default owner + PUBLIC ACL) between T18a and T18d';
  END IF;
  SELECT array_agg(DISTINCT pg_get_userbyid(a.grantee)::text)
    INTO v_acl2
    FROM aclexplode(v_acl_raw) a
   WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> 0;
  IF v_acl2 IS DISTINCT FROM v_acl THEN
    RAISE EXCEPTION 'T18d FAIL (HARD GATE) — the explicit EXECUTE grantee set changed between T18a (%) and T18d (%)', v_acl, v_acl2;
  END IF;
  SELECT array_agg(DISTINCT e) INTO v_acl_expected
    FROM unnest(ARRAY[v_owner, 'service_role']) AS t(e);
  IF v_acl2 IS DISTINCT FROM v_acl_expected THEN
    RAISE EXCEPTION 'T18d FAIL (HARD GATE) — the exact EXECUTE ACL is % but must be exactly % (the owner plus service_role, nobody else)', v_acl2, v_acl_expected;
  END IF;

  RAISE NOTICE 'T18d PASS — provision_organization(%) owner=% secdef=% proconfig=% exact EXECUTE grantees=%',
    v_ident, v_owner, v_secdef, v_config, v_acl2;

  PERFORM pg_temp._sys();
END
$t18$;

-- =====================================================================================================
-- T19 FIXTURES — a dedicated cast for the "the DATABASE decides, not the token" matrix.
--
-- Created HERE, after T18, for the same reason the T14 / T16 / T18 fixtures are: T0b hard-asserts an
-- exact count of 11 fixture profiles and that assertion only stays meaningful if later fixtures arrive
-- after it. Created as the session role, so auth.uid() IS NULL and the guard
-- trg_00_enforce_profile_field_authorization treats every write below as the trusted system path.
--
-- EVERY T19 actor and victim is DEDICATED, deliberately. T5a / T9 / T13 / T14d have already mutated the
-- shared fixtures (role, is_super_admin, platform_role, upline_id), and T19's whole premise is that the
-- actor's DATABASE row says one thing while the token says another — which is only provable when the
-- database row is known exactly. Dedicated victims also mean T19f's "Admin moved to another org" and
-- T19g's "Admin demoted to Agent" cannot perturb anything else in this file.
--
-- All ten identifiers below are registered in the T0a collision-preflight array, so no local preflight
-- block is needed here (contrast T18, whose identifiers are not yet in that array).
--
-- THE CAST
--   U19_AGENT    ...1901  org A, Agent        actor for T19a/b/c (forged tokens) and T19i/T19j
--   U19_VICTIM_A ...1902  org A, Agent        target of T19a/b/f/g/h/j — must be byte-identical at the end
--   U19_VICTIM_B ...1903  org B, Agent        target of T19c and T19j — must be byte-identical at the end
--   U19_TL       ...1904  org A, Team Leader  actor for T19d, T19i, T19j
--   U19_DESC     ...1905  org A, Agent        upline_id = U19_TL, so is_ancestor_of(TL, DESC) is TRUE
--   U19_NONDESC  ...1906  org A, Agent        no upline, so is_ancestor_of(TL, NONDESC) is FALSE
--   U19_ADMIN    ...1907  org A, Admin        actor for T19e, T19i, T19j
--   U19_MOVED    ...1908  org B, Admin        profiles.organization_id was MOVED to org B (T19f actor)
--   U19_DEMOTED  ...1909  org A, Agent        DB-demoted from Admin (T19g actor)
--   U19_MEMBER   ...190a  org A, Agent        the only org-A member the POSITIVE tests are allowed to move
-- =====================================================================================================
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('c1111111-0000-4000-8000-000000001901'::uuid, 'p0.t19.agent@p0test.invalid',   '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('c1111111-0000-4000-8000-000000001902'::uuid, 'p0.t19.victima@p0test.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('c1111111-0000-4000-8000-000000001903'::uuid, 'p0.t19.victimb@p0test.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('c1111111-0000-4000-8000-000000001904'::uuid, 'p0.t19.tl@p0test.invalid',      '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('c1111111-0000-4000-8000-000000001905'::uuid, 'p0.t19.desc@p0test.invalid',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('c1111111-0000-4000-8000-000000001906'::uuid, 'p0.t19.nondesc@p0test.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('c1111111-0000-4000-8000-000000001907'::uuid, 'p0.t19.admin@p0test.invalid',   '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('c1111111-0000-4000-8000-000000001908'::uuid, 'p0.t19.moved@p0test.invalid',   '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('c1111111-0000-4000-8000-000000001909'::uuid, 'p0.t19.demoted@p0test.invalid', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('c1111111-0000-4000-8000-00000000190a'::uuid, 'p0.t19.member@p0test.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

-- Belt and braces, same NOT EXISTS idiom as every other fixture block (only fires if on_auth_user_created
-- is absent, i.e. handle_new_user did not already create the row).
INSERT INTO public.profiles (id, email, first_name, last_name, role, status)
SELECT u.id, u.email, 'P0', 'T19', 'Agent', 'Active'
FROM auth.users u
WHERE u.email LIKE 'p0.t19.%@p0test.invalid'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- Org A cast. phone carries a distinct, recognisable baseline per row so "unchanged" is a precise claim.
UPDATE public.profiles SET organization_id = 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
       role = 'Agent',       status = 'Active', is_super_admin = false, platform_role = NULL, phone = '+15555551901'
 WHERE id = 'c1111111-0000-4000-8000-000000001901'::uuid;
UPDATE public.profiles SET organization_id = 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
       role = 'Agent',       status = 'Active', is_super_admin = false, platform_role = NULL, phone = '+15555551902'
 WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;
UPDATE public.profiles SET organization_id = 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
       role = 'Team Leader', status = 'Active', is_super_admin = false, platform_role = NULL, phone = '+15555551904'
 WHERE id = 'c1111111-0000-4000-8000-000000001904'::uuid;
UPDATE public.profiles SET organization_id = 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
       role = 'Agent',       status = 'Active', is_super_admin = false, platform_role = NULL, phone = '+15555551905'
 WHERE id = 'c1111111-0000-4000-8000-000000001905'::uuid;
UPDATE public.profiles SET organization_id = 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
       role = 'Agent',       status = 'Active', is_super_admin = false, platform_role = NULL, phone = '+15555551906'
 WHERE id = 'c1111111-0000-4000-8000-000000001906'::uuid;
UPDATE public.profiles SET organization_id = 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
       role = 'Admin',       status = 'Active', is_super_admin = false, platform_role = NULL, phone = '+15555551907'
 WHERE id = 'c1111111-0000-4000-8000-000000001907'::uuid;
UPDATE public.profiles SET organization_id = 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
       role = 'Agent',       status = 'Active', is_super_admin = false, platform_role = NULL, phone = '+15555551910'
 WHERE id = 'c1111111-0000-4000-8000-00000000190a'::uuid;

-- Org B cast: the untouchable cross-org victim.
UPDATE public.profiles SET organization_id = 'b0b0b0b0-0000-4000-8000-000000000001'::uuid,
       role = 'Agent',       status = 'Active', is_super_admin = false, platform_role = NULL, phone = '+15555551903'
 WHERE id = 'c1111111-0000-4000-8000-000000001903'::uuid;

-- T19f actor: an Admin whose profiles.organization_id has been MOVED to org B while their (stale) token
-- still says org A. Deliberately an Admin, so ONLY the org boundary can stop them.
UPDATE public.profiles SET organization_id = 'b0b0b0b0-0000-4000-8000-000000000001'::uuid,
       role = 'Admin',       status = 'Active', is_super_admin = false, platform_role = NULL, phone = '+15555551908'
 WHERE id = 'c1111111-0000-4000-8000-000000001908'::uuid;

-- T19g actor: DB-DEMOTED. Seeded as Admin and then demoted in a second statement, so the row really has
-- travelled Admin -> Agent the way a live demotion does (rather than merely starting out as an Agent).
UPDATE public.profiles SET organization_id = 'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
       role = 'Admin',       status = 'Active', is_super_admin = false, platform_role = NULL, phone = '+15555551909'
 WHERE id = 'c1111111-0000-4000-8000-000000001909'::uuid;
UPDATE public.profiles SET role = 'Agent'
 WHERE id = 'c1111111-0000-4000-8000-000000001909'::uuid;

-- Hierarchy: DESC reports to TL; NONDESC reports to nobody. Set upline_id first, then canonicalise the
-- ltree in a SEPARATE statement — exactly the two-step the main fixture block uses, because
-- compute_hierarchy_path() re-reads public.profiles and must see the committed upline_id (see INFO-1).
UPDATE public.profiles SET upline_id = 'c1111111-0000-4000-8000-000000001904'::uuid
 WHERE id = 'c1111111-0000-4000-8000-000000001905'::uuid;

UPDATE public.profiles
   SET hierarchy_path = public.compute_hierarchy_path(id)
 WHERE id IN ('c1111111-0000-4000-8000-000000001901'::uuid, 'c1111111-0000-4000-8000-000000001902'::uuid,
              'c1111111-0000-4000-8000-000000001903'::uuid, 'c1111111-0000-4000-8000-000000001904'::uuid,
              'c1111111-0000-4000-8000-000000001905'::uuid, 'c1111111-0000-4000-8000-000000001906'::uuid,
              'c1111111-0000-4000-8000-000000001907'::uuid, 'c1111111-0000-4000-8000-000000001908'::uuid,
              'c1111111-0000-4000-8000-000000001909'::uuid, 'c1111111-0000-4000-8000-00000000190a'::uuid);

DO $t19fx$
DECLARE
  v          record;
  n_missing  int;
BEGIN
  SELECT count(*) INTO n_missing
  FROM (VALUES
    ('c1111111-0000-4000-8000-000000001901'::uuid), ('c1111111-0000-4000-8000-000000001902'::uuid),
    ('c1111111-0000-4000-8000-000000001903'::uuid), ('c1111111-0000-4000-8000-000000001904'::uuid),
    ('c1111111-0000-4000-8000-000000001905'::uuid), ('c1111111-0000-4000-8000-000000001906'::uuid),
    ('c1111111-0000-4000-8000-000000001907'::uuid), ('c1111111-0000-4000-8000-000000001908'::uuid),
    ('c1111111-0000-4000-8000-000000001909'::uuid), ('c1111111-0000-4000-8000-00000000190a'::uuid)
  ) AS t(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.id);
  IF n_missing <> 0 THEN
    RAISE EXCEPTION 'T19 fixture FAIL — % of the 10 T19 profiles were not created (is on_auth_user_created / handle_new_user installed?)', n_missing;
  END IF;

  -- Each actor's DATABASE row is the thing under test, so every one of them is asserted explicitly.
  SELECT p.role, p.organization_id INTO v FROM public.profiles p WHERE p.id = 'c1111111-0000-4000-8000-000000001901'::uuid;
  IF v.role <> 'Agent' OR v.organization_id IS DISTINCT FROM 'a0a0a0a0-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'T19 fixture FAIL — U19_AGENT is role=% org=% (expected Agent / ORG_A)', v.role, v.organization_id;
  END IF;

  SELECT p.role, p.organization_id INTO v FROM public.profiles p WHERE p.id = 'c1111111-0000-4000-8000-000000001904'::uuid;
  IF v.role <> 'Team Leader' OR v.organization_id IS DISTINCT FROM 'a0a0a0a0-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'T19 fixture FAIL — U19_TL is role=% org=% (expected Team Leader / ORG_A)', v.role, v.organization_id;
  END IF;

  SELECT p.role, p.organization_id INTO v FROM public.profiles p WHERE p.id = 'c1111111-0000-4000-8000-000000001907'::uuid;
  IF v.role <> 'Admin' OR v.organization_id IS DISTINCT FROM 'a0a0a0a0-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'T19 fixture FAIL — U19_ADMIN is role=% org=% (expected Admin / ORG_A)', v.role, v.organization_id;
  END IF;

  SELECT p.role, p.organization_id INTO v FROM public.profiles p WHERE p.id = 'c1111111-0000-4000-8000-000000001908'::uuid;
  IF v.role <> 'Admin' OR v.organization_id IS DISTINCT FROM 'b0b0b0b0-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'T19 fixture FAIL — U19_MOVED is role=% org=% (expected Admin / ORG_B; T19f proves a stale org-A token cannot follow the old tenancy)', v.role, v.organization_id;
  END IF;

  SELECT p.role, p.organization_id INTO v FROM public.profiles p WHERE p.id = 'c1111111-0000-4000-8000-000000001909'::uuid;
  IF v.role <> 'Agent' OR v.organization_id IS DISTINCT FROM 'a0a0a0a0-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'T19 fixture FAIL — U19_DEMOTED is role=% org=% (expected the DEMOTED value Agent / ORG_A)', v.role, v.organization_id;
  END IF;

  SELECT p.role, p.organization_id INTO v FROM public.profiles p WHERE p.id = 'c1111111-0000-4000-8000-000000001903'::uuid;
  IF v.organization_id IS DISTINCT FROM 'b0b0b0b0-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'T19 fixture FAIL — U19_VICTIM_B is in org % (expected ORG_B)', v.organization_id;
  END IF;

  -- The ancestry facts T19d / T19i / T19j hang on. Without these two the Team-Leader arms of
  -- private.can_update_profile() would be asserted against a hierarchy that does not exist, and both the
  -- positive (descendant) and the negative (non-descendant) results would be vacuous.
  IF public.is_ancestor_of('c1111111-0000-4000-8000-000000001904'::uuid,
                           'c1111111-0000-4000-8000-000000001905'::uuid) IS NOT TRUE THEN
    RAISE EXCEPTION 'T19 fixture FAIL — is_ancestor_of(U19_TL, U19_DESC) is not TRUE, so T19i could not prove a Team Leader may update a real descendant (TL path=%, DESC path=%)',
      (SELECT hierarchy_path::text FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001904'::uuid),
      (SELECT hierarchy_path::text FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001905'::uuid);
  END IF;
  IF public.is_ancestor_of('c1111111-0000-4000-8000-000000001904'::uuid,
                           'c1111111-0000-4000-8000-000000001906'::uuid) IS NOT FALSE THEN
    RAISE EXCEPTION 'T19 fixture FAIL — is_ancestor_of(U19_TL, U19_NONDESC) is not FALSE, so U19_NONDESC is not a non-descendant and T19d/T19j would prove nothing';
  END IF;

  -- T19h reuses the T14c ghost. Re-assert it, because T14/T15/T16/T17/T18 all ran in between.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000014c'::uuid) THEN
    RAISE EXCEPTION 'T19 fixture FAIL — the ghost actor acquired a public.profiles row after T14c, so T19h would not test the no-profile path';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'c1111111-0000-4000-8000-00000000014c'::uuid) THEN
    RAISE EXCEPTION 'T19 fixture FAIL — the ghost auth.users row is gone; T19h has no actor to impersonate';
  END IF;

  RAISE NOTICE 'T19 fixtures ready — 10 dedicated profiles, TL->DESC ancestry TRUE, TL->NONDESC ancestry FALSE, ghost still profile-less';
END
$t19fx$;

-- =====================================================================================================
-- T19. LAYER 2 IS DATABASE-AUTHORITATIVE, NOT TOKEN-AUTHORITATIVE. ALL HARD GATES.
--
-- WHAT THIS EXISTS TO CATCH
--   The three UPDATE policies this migration drops decided authorization from the JWT:
--     profiles_update_admin         USING (organization_id = get_user_org_id() AND get_user_role() = 'Admin')
--     profiles_update_hierarchical  USING (... get_org_id() ... get_user_role() ... super_admin_own_org ...)
--   get_user_role() reads ONLY current_setting('request.jwt.claims'); get_org_id() PREFERS the token's
--   app_metadata.organization_id; super_admin_own_org() consults the token's is_super_admin. They are
--   permissive, so they OR together. Consequence: anybody holding a token whose claims say "Admin of
--   org X" satisfied Layer 2 for every non-protected column of every profile in org X — whether or not
--   public.profiles agreed, and whether or not it ever had.
--
--   That is not hypothetical. The claims are DERIVED from the very columns being protected
--   (custom_access_token_hook re-mints role / organization_id / is_super_admin from profiles via
--   set_claim), so before this migration a single successful self-UPDATE of profiles.role minted a token
--   that then authorized itself. And even with the write hole closed, tokens live on: a demoted Admin, a
--   user moved between organizations, or anyone with a captured access token kept Layer 2 authority until
--   their JWT expired.
--
--   private.can_update_profile() resolves BOTH the actor and the target from public.profiles and never
--   reads a role / org / is_super_admin / platform_role claim. T19 is the proof: in every sub-test below
--   the token and the database DISAGREE, and the database must win — in BOTH directions.
--
--   T19a  DB Agent, token says Admin (same org)          -> 0 rows
--   T19b  DB Agent, token says Super Admin + is_super_admin=true -> 0 rows
--   T19c  DB Agent in org A, token says org B            -> 0 rows on an org-B profile
--   T19d  DB Team Leader, token says Admin               -> 0 rows on a same-org NON-descendant
--   T19e  DB Admin, STALE token says Agent               -> 1 row  *** the database must GRANT, too ***
--   T19f  DB org moved to org B, STALE org-A token       -> 0 rows on an org-A profile
--   T19g  DB-demoted Admin (now Agent), stale Admin token-> 0 rows
--   T19h  NO-profile actor, forged Admin/super/org claims-> 0 rows on a NON-protected column
--   T19i  POSITIVE preservation — the four writes that must keep working
--   T19j  NEGATIVE preservation — the three refusals that must keep holding
--   T19k  policy shape:  exactly one UPDATE policy, TO authenticated, USING = WITH CHECK, old three gone
--   T19l  helper metadata: SECURITY DEFINER, STABLE, owner, pinned search_path, exact EXECUTE ACL
--
-- WHY EVERY WRITE BELOW TARGETS `phone`
--   phone is NOT protected by Layer 3 and IS in the authenticated column GRANT, so neither the trigger
--   nor the privilege layer can produce the refusal. Layer 2 is the ONLY thing that can return 0 rows.
--   That is deliberate: T14c already proved the guard holds for protected columns, which means a broken
--   Layer 2 would be INVISIBLE to every other test in this file. Consequently these blocks require the
--   statement to complete WITHOUT raising and to report 0 rows — an exception here would mean RLS
--   admitted the row and some lower layer cleaned up after it, which is exactly the failure T19 is for.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- T19a / T19b / T19c. A DB Agent carrying FORGED authority claims.
-- Same actor every time (U19_AGENT is an Agent in public.profiles); only the lie changes.
-- ---------------------------------------------------------------------------------------------------
DO $t19abc$
DECLARE
  r          record;
  n          int;
  raised     boolean;
  msg        text;
  sqlst      text;
  fails      text := '';
  b_phone_a  text;
  b_phone_b  text;
  a_phone    text;
BEGIN
  SELECT phone INTO b_phone_a FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;
  SELECT phone INTO b_phone_b FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001903'::uuid;

  FOR r IN
    SELECT * FROM (VALUES
      -- label, claimed org, claimed role, claimed is_super_admin, target, what the old policies would have done
      ('T19a', 'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin', false,
       'c1111111-0000-4000-8000-000000001902'::uuid,
       'profiles_update_admin/hierarchical read get_user_role() from the token, so a forged app_metadata.role=Admin used to authorize any same-org row'),
      ('T19b', 'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Super Admin', true,
       'c1111111-0000-4000-8000-000000001902'::uuid,
       'super_admin_own_org() consults the token''s is_super_admin claim, so a forged is_super_admin=true used to authorize any same-org row'),
      ('T19c', 'b0b0b0b0-0000-4000-8000-000000000001'::uuid, 'Admin', false,
       'c1111111-0000-4000-8000-000000001903'::uuid,
       'get_org_id() PREFERS the token''s app_metadata.organization_id, so a forged org claim used to relocate the actor into another tenant (the role claim is forged too, so the org claim is the element actually under test)')
    ) AS t(label, claim_org, claim_role, claim_super, target, rationale)
  LOOP
    n := -1; raised := false; msg := NULL; sqlst := NULL;

    PERFORM pg_temp._sim('c1111111-0000-4000-8000-000000001901'::uuid, r.claim_org, r.claim_role, r.claim_super);
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE format('UPDATE public.profiles SET phone = %L WHERE id = %L::uuid', '+19995550000', r.target);
      GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      raised := true; msg := SQLERRM; sqlst := SQLSTATE;
    END;
    RESET ROLE;

    IF raised THEN
      fails := fails || format(E'\n  - %s raised %s (%s). phone is neither Layer-1 revoked nor Layer-3 guarded, so an error means Layer 2 ADMITTED the row and something below it refused — Layer 2 is still the wrong layer.',
                               r.label, sqlst, msg);
    ELSIF n <> 0 THEN
      fails := fails || format(E'\n  - %s updated %s row(s) with a token that disagrees with public.profiles. %s',
                               r.label, n, r.rationale);
    ELSE
      RAISE NOTICE '% PASS — DB Agent with forged claims (org=%, role=%, is_super_admin=%) matched 0 rows',
        r.label, r.claim_org, r.claim_role, r.claim_super;
    END IF;
  END LOOP;
  PERFORM pg_temp._sys();

  IF fails <> '' THEN
    RAISE EXCEPTION 'T19a-c FAIL (HARD GATE) — Layer 2 is still token-authoritative:%', fails;
  END IF;

  SELECT phone INTO a_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;
  IF a_phone IS DISTINCT FROM b_phone_a THEN
    RAISE EXCEPTION 'T19a/b FAIL (HARD GATE) — the org-A victim''s phone moved from % to % despite every attempt reporting 0 rows', b_phone_a, a_phone;
  END IF;
  SELECT phone INTO a_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001903'::uuid;
  IF a_phone IS DISTINCT FROM b_phone_b THEN
    RAISE EXCEPTION 'T19c FAIL (HARD GATE) — the org-B victim''s phone moved from % to % despite the attempt reporting 0 rows', b_phone_b, a_phone;
  END IF;

  RAISE NOTICE 'T19a-c PASS — a DB Agent gained nothing from forged Admin / Super Admin / cross-org claims; both victims unchanged';
END
$t19abc$;

-- ---------------------------------------------------------------------------------------------------
-- T19d. DB Team Leader + forged JWT role Admin -> a same-org NON-descendant.
-- The Team Leader arm of private.can_update_profile() calls public.is_ancestor_of(actor, target), which
-- reads hierarchy_path from public.profiles — no claim can widen it. The old policies took the Admin
-- claim at face value and skipped the ancestry test entirely.
-- ---------------------------------------------------------------------------------------------------
DO $t19d$
DECLARE
  n        int := -1;
  raised   boolean := false;
  msg      text; sqlst text;
  b_phone  text; a_phone text;
  v_anc    boolean;
BEGIN
  -- Precondition, restated at the point of use: the target really is OUTSIDE the Team Leader's downline.
  v_anc := public.is_ancestor_of('c1111111-0000-4000-8000-000000001904'::uuid,
                                 'c1111111-0000-4000-8000-000000001906'::uuid);
  IF v_anc IS NOT FALSE THEN
    RAISE EXCEPTION 'T19d FAIL (HARD GATE) — is_ancestor_of(U19_TL, U19_NONDESC) is % (expected false); the target is not a non-descendant, so a 0-row result would prove nothing', v_anc;
  END IF;

  SELECT phone INTO b_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001906'::uuid;

  PERFORM pg_temp._sim('c1111111-0000-4000-8000-000000001904'::uuid,   -- DB role: Team Leader
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
                       'Admin');                                       -- token role: FORGED Admin
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET phone = '+19995550000'
     WHERE id = 'c1111111-0000-4000-8000-000000001906'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    raised := true; msg := SQLERRM; sqlst := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF raised THEN
    RAISE EXCEPTION 'T19d FAIL (HARD GATE) — the statement raised % (%). phone is unguarded by Layers 1 and 3, so an error means Layer 2 admitted the row', sqlst, msg;
  END IF;
  IF n <> 0 THEN
    RAISE EXCEPTION 'T19d FAIL (HARD GATE) — a Team Leader updated % row(s) outside their downline by claiming app_metadata.role=Admin. private.can_update_profile() must reach is_ancestor_of() from the DATABASE role, never the token role.', n;
  END IF;

  SELECT phone INTO a_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001906'::uuid;
  IF a_phone IS DISTINCT FROM b_phone THEN
    RAISE EXCEPTION 'T19d FAIL (HARD GATE) — the non-descendant''s phone moved from % to %', b_phone, a_phone;
  END IF;

  RAISE NOTICE 'T19d PASS — a DB Team Leader with a forged Admin claim matched 0 rows on a same-org non-descendant; target unchanged';
END
$t19d$;

-- ---------------------------------------------------------------------------------------------------
-- T19e. THE POSITIVE HALF — DB Admin carrying a STALE token that claims role Agent.
--
-- This is the sub-test that proves the property is "the DATABASE decides", not merely "deny more". Under
-- the dropped policies this statement FAILED: get_user_role() would return 'Agent', the Agent arm of
-- profiles_update_hierarchical requires id = auth.uid(), and no other policy admitted it — so a genuine
-- Admin whose token had not yet refreshed could not edit their own org's members. After the migration the
-- token is irrelevant and public.profiles.role='Admin' carries the day.
-- ---------------------------------------------------------------------------------------------------
DO $t19e$
DECLARE
  n int := -1; v_phone text;
BEGIN
  PERFORM pg_temp._sim('c1111111-0000-4000-8000-000000001907'::uuid,   -- DB role: Admin
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
                       'Agent');                                       -- token role: STALE Agent
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET phone = '+15550001907'
     WHERE id = 'c1111111-0000-4000-8000-00000000190a'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'T19e FAIL (HARD GATE) — a real same-org Admin was REFUSED because their token still said Agent: % (SQLSTATE %). Layer 2 is still reading the JWT; a stale token must not strip an Admin of authority the database grants them.', SQLERRM, SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF n <> 1 THEN
    RAISE EXCEPTION 'T19e FAIL (HARD GATE) — the approved Admin update affected % row(s), expected exactly 1', n;
  END IF;

  SELECT phone INTO v_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000190a'::uuid;
  IF v_phone IS DISTINCT FROM '+15550001907' THEN
    RAISE EXCEPTION 'T19e FAIL (HARD GATE) — the Admin update reported 1 row but the value did not persist (phone=%)', v_phone;
  END IF;

  RAISE NOTICE 'T19e PASS — a DB Admin with a STALE Agent token updated a same-org member (1 row, value persisted): the database, not the token, is authoritative in BOTH directions';
END
$t19e$;

-- ---------------------------------------------------------------------------------------------------
-- T19f. Tenancy moved in the database, token still points at the old organization.
-- U19_MOVED is an ADMIN, so the role gate cannot be what refuses this — only the org boundary can, and
-- the org boundary must come from public.profiles.organization_id rather than the org claim.
-- ---------------------------------------------------------------------------------------------------
DO $t19f$
DECLARE
  n int := -1; raised boolean := false; msg text; sqlst text; b_phone text; a_phone text; v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001908'::uuid;
  IF v_org IS DISTINCT FROM 'b0b0b0b0-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'T19f FAIL (HARD GATE) — the moved Admin''s profiles.organization_id is % (expected ORG_B); the stale-token scenario is not set up', v_org;
  END IF;

  SELECT phone INTO b_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;

  PERFORM pg_temp._sim('c1111111-0000-4000-8000-000000001908'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid,   -- STALE org-A claim
                       'Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET phone = '+19995550000'
     WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;          -- an org-A profile
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    raised := true; msg := SQLERRM; sqlst := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF raised THEN
    RAISE EXCEPTION 'T19f FAIL (HARD GATE) — the statement raised % (%); phone is unguarded by Layers 1 and 3, so Layer 2 admitted the row', sqlst, msg;
  END IF;
  IF n <> 0 THEN
    RAISE EXCEPTION 'T19f FAIL (HARD GATE) — an Admin who has been MOVED to another organization still edited % row(s) in their old one, on the strength of a stale org claim. Until the token expires, every re-tenanted user would keep cross-tenant write access.', n;
  END IF;

  SELECT phone INTO a_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;
  IF a_phone IS DISTINCT FROM b_phone THEN
    RAISE EXCEPTION 'T19f FAIL (HARD GATE) — the org-A victim''s phone moved from % to %', b_phone, a_phone;
  END IF;

  RAISE NOTICE 'T19f PASS — a stale org-A token did not follow an Admin whose profiles.organization_id had moved to org B (0 rows, victim unchanged)';
END
$t19f$;

-- ---------------------------------------------------------------------------------------------------
-- T19g. Demotion takes effect immediately, not at token expiry.
-- U19_DEMOTED is an Agent in public.profiles and an Admin in the token. Same org as the target, so the
-- org boundary cannot be what refuses this — only the DATABASE-resolved role can.
-- ---------------------------------------------------------------------------------------------------
DO $t19g$
DECLARE
  n int := -1; raised boolean := false; msg text; sqlst text; b_phone text; a_phone text; v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001909'::uuid;
  IF v_role <> 'Agent' THEN
    RAISE EXCEPTION 'T19g FAIL (HARD GATE) — the demoted actor''s profiles.role is % (expected Agent); the demotion scenario is not set up', v_role;
  END IF;

  SELECT phone INTO b_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;

  PERFORM pg_temp._sim('c1111111-0000-4000-8000-000000001909'::uuid,
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
                       'Admin');                                       -- STALE pre-demotion role claim
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET phone = '+19995550000'
     WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    raised := true; msg := SQLERRM; sqlst := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF raised THEN
    RAISE EXCEPTION 'T19g FAIL (HARD GATE) — the statement raised % (%); phone is unguarded by Layers 1 and 3, so Layer 2 admitted the row', sqlst, msg;
  END IF;
  IF n <> 0 THEN
    RAISE EXCEPTION 'T19g FAIL (HARD GATE) — a DEMOTED Admin (profiles.role is now Agent) still edited % row(s) using a pre-demotion token. Revocation would not take effect until the JWT expired.', n;
  END IF;

  SELECT phone INTO a_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;
  IF a_phone IS DISTINCT FROM b_phone THEN
    RAISE EXCEPTION 'T19g FAIL (HARD GATE) — the victim''s phone moved from % to %', b_phone, a_phone;
  END IF;

  RAISE NOTICE 'T19g PASS — a stale Admin token bought a DB-demoted Agent nothing (0 rows, victim unchanged)';
END
$t19g$;

-- ---------------------------------------------------------------------------------------------------
-- T19h. The no-profile ghost from T14c, on a NON-PROTECTED column.
--
-- T14c proved the GUARD refuses a profile-less actor on the protected columns. It could not say anything
-- about the rest of the table: for first_name / phone / timezone / goals the guard has nothing to check,
-- so an authenticated Auth user with no profiles row and a forged Admin token used to be able to rewrite
-- every ordinary field of every profile in the claimed organization. This block is the missing half, and
-- only Layer 2 can produce the refusal.
-- ---------------------------------------------------------------------------------------------------
DO $t19h$
DECLARE
  n int := -1; raised boolean := false; msg text; sqlst text; b_phone text; a_phone text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-00000000014c'::uuid) THEN
    RAISE EXCEPTION 'T19h FAIL (HARD GATE) — the ghost actor has a public.profiles row, so this is not the no-profile path';
  END IF;

  SELECT phone INTO b_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;

  PERFORM pg_temp._sim('c1111111-0000-4000-8000-00000000014c'::uuid,   -- no profiles row at all
                       'a0a0a0a0-0000-4000-8000-000000000001'::uuid,
                       'Admin', true);                                 -- forged Admin + is_super_admin
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET phone = '+19995550000'
     WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    raised := true; msg := SQLERRM; sqlst := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF raised THEN
    RAISE EXCEPTION 'T19h FAIL (HARD GATE) — the statement raised % (%). On a non-protected column the guard has nothing to enforce, so an error means Layer 2 ADMITTED the ghost and the refusal came from somewhere it must not have to come from. private.can_update_profile() must return false on `IF NOT FOUND` for the actor lookup.', sqlst, msg;
  END IF;
  IF n <> 0 THEN
    RAISE EXCEPTION 'T19h FAIL (HARD GATE) — an authenticated Auth user with NO public.profiles row rewrote % row(s) of a real profile using forged Admin / is_super_admin / organization_id claims. T14c only covered the protected columns; this is the rest of the table.', n;
  END IF;

  SELECT phone INTO a_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;
  IF a_phone IS DISTINCT FROM b_phone THEN
    RAISE EXCEPTION 'T19h FAIL (HARD GATE) — the victim''s phone moved from % to %', b_phone, a_phone;
  END IF;

  RAISE NOTICE 'T19h PASS — a profile-less actor with fully forged claims matched 0 rows on a NON-protected column; victim unchanged';
END
$t19h$;

-- ---------------------------------------------------------------------------------------------------
-- T19i. POSITIVE PRESERVATION — everything the old policies legitimately allowed must still work.
-- Claims here are ACCURATE (they agree with public.profiles): the point is no longer "the token lies",
-- it is "replacing three policies with one did not amputate a real capability". Each MUST report 1 row.
-- ---------------------------------------------------------------------------------------------------
DO $t19i$
DECLARE
  r record; n int; v_phone text; fails text := '';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('T19i-1 Agent self-update',
       'c1111111-0000-4000-8000-000000001901'::uuid, 'Agent',
       'c1111111-0000-4000-8000-000000001901'::uuid, '+15550011901'),
      ('T19i-2 Team Leader self-update',
       'c1111111-0000-4000-8000-000000001904'::uuid, 'Team Leader',
       'c1111111-0000-4000-8000-000000001904'::uuid, '+15550011904'),
      ('T19i-3 Team Leader updates a real DESCENDANT',
       'c1111111-0000-4000-8000-000000001904'::uuid, 'Team Leader',
       'c1111111-0000-4000-8000-000000001905'::uuid, '+15550011905'),
      ('T19i-4 Admin updates a same-org member',
       'c1111111-0000-4000-8000-000000001907'::uuid, 'Admin',
       'c1111111-0000-4000-8000-00000000190a'::uuid, '+15550011910')
    ) AS t(label, actor, claim_role, target, new_phone)
  LOOP
    n := -1;
    PERFORM pg_temp._sim(r.actor, 'a0a0a0a0-0000-4000-8000-000000000001'::uuid, r.claim_role);
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE format('UPDATE public.profiles SET phone = %L WHERE id = %L::uuid', r.new_phone, r.target);
      GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      n := -1;
      fails := fails || format(E'\n  - %s raised %s (%s)', r.label, SQLSTATE, SQLERRM);
    END;
    RESET ROLE;

    IF n = 1 THEN
      SELECT phone INTO v_phone FROM public.profiles WHERE id = r.target;
      IF v_phone IS DISTINCT FROM r.new_phone THEN
        fails := fails || format(E'\n  - %s reported 1 row but phone is %L, expected %L', r.label, v_phone, r.new_phone);
      ELSE
        RAISE NOTICE '% PASS — 1 row, value persisted', r.label;
      END IF;
    ELSIF n <> -1 THEN
      fails := fails || format(E'\n  - %s affected %s row(s), expected exactly 1', r.label, n);
    END IF;
  END LOOP;
  PERFORM pg_temp._sys();

  IF fails <> '' THEN
    RAISE EXCEPTION 'T19i FAIL (HARD GATE) — collapsing three UPDATE policies into profiles_update_authorized removed a LEGITIMATE capability:%', fails;
  END IF;

  RAISE NOTICE 'T19i PASS — Agent self-edit, Team Leader self-edit, Team Leader -> descendant and Admin -> same-org member all still succeed';
END
$t19i$;

-- ---------------------------------------------------------------------------------------------------
-- T19j. NEGATIVE PRESERVATION — everything the old policies refused must still be refused, with the
-- claims ACCURATE this time. Without this block a helper that simply returned true would sail through
-- T19i and would only be caught where a token happened to lie.
-- ---------------------------------------------------------------------------------------------------
DO $t19j$
DECLARE
  r record; n int; raised boolean; fails text := '';
  b_nondesc text; b_victim_b text; b_victim_a text; a_phone text;
BEGIN
  SELECT phone INTO b_nondesc  FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001906'::uuid;
  SELECT phone INTO b_victim_b FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001903'::uuid;
  SELECT phone INTO b_victim_a FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;

  FOR r IN
    SELECT * FROM (VALUES
      ('T19j-1 Team Leader -> same-org NON-descendant',
       'c1111111-0000-4000-8000-000000001904'::uuid, 'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Team Leader',
       'c1111111-0000-4000-8000-000000001906'::uuid),
      ('T19j-2 Admin -> CROSS-ORG profile',
       'c1111111-0000-4000-8000-000000001907'::uuid, 'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Admin',
       'c1111111-0000-4000-8000-000000001903'::uuid),
      ('T19j-3 Agent -> another profile',
       'c1111111-0000-4000-8000-000000001901'::uuid, 'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Agent',
       'c1111111-0000-4000-8000-000000001902'::uuid)
    ) AS t(label, actor, claim_org, claim_role, target)
  LOOP
    n := -1; raised := false;
    PERFORM pg_temp._sim(r.actor, r.claim_org, r.claim_role);
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE format('UPDATE public.profiles SET phone = %L WHERE id = %L::uuid', '+19995550000', r.target);
      GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      raised := true;
      fails := fails || format(E'\n  - %s raised %s (%s); phone is unguarded by Layers 1 and 3, so Layer 2 admitted the row', r.label, SQLSTATE, SQLERRM);
    END;
    RESET ROLE;

    IF NOT raised THEN
      IF n <> 0 THEN
        fails := fails || format(E'\n  - %s affected %s row(s), expected 0', r.label, n);
      ELSE
        RAISE NOTICE '% PASS — 0 rows', r.label;
      END IF;
    END IF;
  END LOOP;
  PERFORM pg_temp._sys();

  IF fails <> '' THEN
    RAISE EXCEPTION 'T19j FAIL (HARD GATE) — profiles_update_authorized is more permissive than the policies it replaces:%', fails;
  END IF;

  SELECT phone INTO a_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001906'::uuid;
  IF a_phone IS DISTINCT FROM b_nondesc THEN
    RAISE EXCEPTION 'T19j FAIL (HARD GATE) — the non-descendant''s phone moved from % to %', b_nondesc, a_phone;
  END IF;
  SELECT phone INTO a_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001903'::uuid;
  IF a_phone IS DISTINCT FROM b_victim_b THEN
    RAISE EXCEPTION 'T19j FAIL (HARD GATE) — the org-B victim''s phone moved from % to %', b_victim_b, a_phone;
  END IF;
  SELECT phone INTO a_phone FROM public.profiles WHERE id = 'c1111111-0000-4000-8000-000000001902'::uuid;
  IF a_phone IS DISTINCT FROM b_victim_a THEN
    RAISE EXCEPTION 'T19j FAIL (HARD GATE) — the org-A victim''s phone moved from % to %', b_victim_a, a_phone;
  END IF;

  RAISE NOTICE 'T19j PASS — Team Leader -> non-descendant, Admin -> cross-org and Agent -> another profile all still refused (0 rows, nothing moved)';
END
$t19j$;

-- ---------------------------------------------------------------------------------------------------
-- T19k. POLICY SHAPE. Permissive policies OR together, so a single surviving old policy would restore the
-- token-authoritative path in full and every negative sub-test above would start failing — but only if a
-- token happened to lie in exactly the right way. Assert the shape directly instead.
--
-- Policies that can admit an UPDATE are polcmd 'w' (FOR UPDATE) and polcmd '*' (FOR ALL); both are
-- collected, so a FOR ALL policy cannot slip past a check that only looked at 'w'.
-- ---------------------------------------------------------------------------------------------------
DO $t19k$
DECLARE
  v_names    text[];
  v_leftover text[];
  v_perm     boolean;
  v_roles    oid[];
  v_rolnames text[];
  v_qual     text;
  v_check    text;
BEGIN
  SELECT array_agg(polname ORDER BY polname) INTO v_names
  FROM pg_policy
  WHERE polrelid = 'public.profiles'::regclass AND polcmd IN ('w', '*');

  IF v_names IS DISTINCT FROM ARRAY['profiles_update_authorized']::text[] THEN
    RAISE EXCEPTION 'T19k FAIL (HARD GATE) — the set of policies that can admit an UPDATE on public.profiles is % but must be exactly {profiles_update_authorized}. Permissive policies OR together, so any extra one re-opens whatever it permits.',
      COALESCE(v_names::text, '{}');
  END IF;

  SELECT array_agg(polname ORDER BY polname) INTO v_leftover
  FROM pg_policy
  WHERE polrelid = 'public.profiles'::regclass
    AND polname IN ('profiles_update_own', 'profiles_update_admin', 'profiles_update_hierarchical');
  IF v_leftover IS NOT NULL THEN
    RAISE EXCEPTION 'T19k FAIL (HARD GATE) — the replaced policies % still exist on public.profiles', v_leftover;
  END IF;

  SELECT p.polpermissive, p.polroles,
         pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_perm, v_roles, v_qual, v_check
  FROM pg_policy p
  WHERE p.polrelid = 'public.profiles'::regclass AND p.polname = 'profiles_update_authorized';

  IF v_perm IS NOT TRUE THEN
    RAISE EXCEPTION 'T19k FAIL (HARD GATE) — profiles_update_authorized is RESTRICTIVE; with no permissive UPDATE policy left, every browser profile write would be refused';
  END IF;

  SELECT array_agg(pg_get_userbyid(t.r)::text ORDER BY pg_get_userbyid(t.r)::text)
    INTO v_rolnames FROM unnest(v_roles) AS t(r) WHERE t.r <> 0::oid;
  IF 0::oid = ANY (v_roles) THEN
    RAISE EXCEPTION 'T19k FAIL (HARD GATE) — profiles_update_authorized is granted TO PUBLIC (polroles contains OID 0). Two of the three policies it replaces were TO PUBLIC, which is how they applied to anon as well; the replacement must be TO authenticated only.';
  END IF;
  IF v_rolnames IS DISTINCT FROM ARRAY['authenticated']::text[] THEN
    RAISE EXCEPTION 'T19k FAIL (HARD GATE) — profiles_update_authorized applies to % but must apply to exactly {authenticated}', COALESCE(v_rolnames::text, '{}');
  END IF;

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'T19k FAIL (HARD GATE) — polqual (USING) is NULL: the policy would admit every row for reading-into-update';
  END IF;
  IF v_check IS NULL THEN
    RAISE EXCEPTION 'T19k FAIL (HARD GATE) — polwithcheck is NULL. Postgres then reuses USING as the check, which is how profiles_update_own became a self-service privilege-escalation primitive in the first place; state it explicitly.';
  END IF;
  IF v_qual IS DISTINCT FROM v_check THEN
    RAISE EXCEPTION 'T19k FAIL (HARD GATE) — USING and WITH CHECK differ. USING=% WITH CHECK=%. A row the actor may read-for-update but not write back (or the reverse) is an authorization gap, not a feature.', v_qual, v_check;
  END IF;
  IF position('can_update_profile' in v_qual) = 0 THEN
    RAISE EXCEPTION 'T19k FAIL (HARD GATE) — the policy expression % does not call can_update_profile(); T19a-j would then be asserting against some other decision procedure', v_qual;
  END IF;

  RAISE NOTICE 'T19k PASS — exactly one UPDATE policy (profiles_update_authorized, PERMISSIVE, TO authenticated), USING = WITH CHECK = %, and the three replaced policies are gone', v_qual;
END
$t19k$;

-- ---------------------------------------------------------------------------------------------------
-- T19l. HELPER METADATA. private.can_update_profile() is the only thing standing between a forged token
-- and a cross-tenant profile write, so its definition is asserted as tightly as T18d asserts
-- provision_organization()'s:
--   * SECURITY DEFINER  — it must read public.profiles rows the CALLER cannot see; an INVOKER function
--                         would be evaluated under the caller's own RLS and could answer `false` for a
--                         target the caller may legitimately edit (or be steered by SELECT policies).
--   * STABLE            — it is called per row by the planner; VOLATILE would defeat caching and, worse,
--                         signals a function that may write.
--   * owner postgres    — the owner decides whose privileges the body runs with. A DROP+CREATE by another
--                         role silently changes the owner AND discards the ACL below.
--   * pinned search_path— a SECURITY DEFINER function with an unpinned search_path is hijackable by a
--                         caller-created schema, and this one resolves `public.profiles`.
--   * no EXECUTE for PUBLIC or anon — an anonymous caller must not be able to probe org membership, and
--                         the function must not be reachable at all outside the policy.
--   * EXECUTE for authenticated — the policy expression is what every browser UPDATE runs through.
-- ---------------------------------------------------------------------------------------------------
DO $t19l$
DECLARE
  v_oid        oid;
  v_overloads  int;
  v_secdef     boolean;
  v_vol        text;
  v_owner      text;
  v_config     text[];
  v_sp         text;
  v_pub        boolean;
  v_anon       boolean;
  v_auth       boolean;
BEGIN
  SELECT count(*) INTO v_overloads
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'can_update_profile';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'T19l FAIL (HARD GATE) — expected exactly 1 private.can_update_profile, found %. An overload would sit beside the hardened definition, carry its own ACL, and could be the one the policy resolves to.',
      v_overloads;
  END IF;

  SELECT p.oid, p.prosecdef, p.provolatile::text, p.proowner::regrole::text, p.proconfig
    INTO v_oid, v_secdef, v_vol, v_owner, v_config
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'can_update_profile'
    AND p.pronargs = 1 AND p.proargtypes[0]::regtype = 'uuid'::regtype;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T19l FAIL (HARD GATE) — private.can_update_profile(uuid) does not exist; policy profiles_update_authorized cannot be resolving to the function this matrix asserts';
  END IF;

  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'T19l FAIL (HARD GATE) — prosecdef is %; can_update_profile must be SECURITY DEFINER, otherwise the actor/target lookups run under the CALLER''s RLS on public.profiles and the answer depends on the SELECT policies rather than on the authorization rules', v_secdef;
  END IF;

  IF v_vol <> 's' THEN
    RAISE EXCEPTION 'T19l FAIL (HARD GATE) — provolatile is % (expected ''s'' = STABLE). The policy calls this once per candidate row.', v_vol;
  END IF;

  IF v_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'T19l FAIL (HARD GATE) — private.can_update_profile is owned by % (expected postgres, the owner of the other private/public SECURITY DEFINER functions). The owner supplies the privileges the body runs with, and a DROP+CREATE by another role changes it silently.', v_owner;
  END IF;

  IF v_config IS NULL THEN
    RAISE EXCEPTION 'T19l FAIL (HARD GATE) — proconfig is NULL: a SECURITY DEFINER function with no pinned search_path is hijackable by a caller-created schema, and this one resolves public.profiles and public.is_ancestor_of';
  END IF;
  SELECT c INTO v_sp FROM unnest(v_config) AS t(c) WHERE t.c LIKE 'search_path=%' LIMIT 1;
  IF v_sp IS NULL THEN
    RAISE EXCEPTION 'T19l FAIL (HARD GATE) — proconfig % contains no search_path entry', v_config;
  END IF;
  IF NOT ('public' = ANY (string_to_array(replace(substr(v_sp, 13), ' ', ''), ','))) THEN
    RAISE EXCEPTION 'T19l FAIL (HARD GATE) — the pinned search_path % does not include public; the body references public.profiles and public.is_ancestor_of', v_sp;
  END IF;

  v_pub  := has_function_privilege('public',        v_oid, 'EXECUTE');
  v_anon := has_function_privilege('anon',          v_oid, 'EXECUTE');
  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');

  IF v_pub IS NOT FALSE THEN
    RAISE EXCEPTION 'T19l FAIL (HARD GATE) — PUBLIC holds EXECUTE on private.can_update_profile. Every role inherits it, and a SECURITY DEFINER boolean oracle over public.profiles is directly callable by anyone who can reach the schema.';
  END IF;
  IF v_anon IS NOT FALSE THEN
    RAISE EXCEPTION 'T19l FAIL (HARD GATE) — anon holds EXECUTE on private.can_update_profile; an unauthenticated caller must have no path to it at all';
  END IF;
  IF v_auth IS NOT TRUE THEN
    RAISE EXCEPTION 'T19l FAIL (HARD GATE) — authenticated does NOT hold EXECUTE on private.can_update_profile; profiles_update_authorized calls it on every browser UPDATE';
  END IF;

  RAISE NOTICE 'T19l PASS — private.can_update_profile(uuid): secdef=% volatile=% owner=% proconfig=% execute(PUBLIC/anon/authenticated)=%/%/%',
    v_secdef, v_vol, v_owner, v_config, v_pub, v_anon, v_auth;
END
$t19l$;

-- >>> T20 PRIVATE-SCHEMA BOUNDARY SUITE — inserted after T19l, immediately before the Summary <<<
-- =====================================================================================================
-- T20. THE `private` SCHEMA BOUNDARY. ALL HARD GATES.
--
-- WHY THIS SUITE EXISTS
--   Layer 2 now runs through private.can_update_profile(), and an RLS policy expression is evaluated with
--   the privileges of the QUERYING user — so the migration MUST `GRANT USAGE ON SCHEMA private TO
--   authenticated` or every browser profile UPDATE dies with 42501 "permission denied for schema private"
--   instead of returning 0 rows. Captured from the live database at 2026-07-31T15:13:28Z, BEFORE the
--   migration:
--       private.nspacl                                   = {postgres=UC/postgres}  (authenticated: no USAGE)
--       private.workflow_dispatch_event proacl           = NULL                    (= EXECUTE TO PUBLIC)
--       pg_default_acl rows for (postgres, private, 'f') = 0                       (built-in default in force)
--       private tables                                   = 5, all owner-only
--
--   That USAGE grant is a real widening of the blast radius: it is the FIRST time `authenticated` can
--   resolve a name inside `private` at all. Everything the door now reaches has to be closed by the same
--   migration and STAY closed — which is what this suite asserts, in both directions.
--
--   The concrete hole the grant would otherwise open: private.workflow_dispatch_event(uuid, text, text,
--   uuid, text, jsonb) had proacl NULL, and Postgres reads NULL as the built-in default — EXECUTE TO
--   PUBLIC. It is SECURITY DEFINER and takes p_org_id as a PARAMETER, so it neither knows nor checks who
--   is calling: USAGE + PUBLIC EXECUTE would have let any logged-in user dispatch workflow events into an
--   arbitrary tenant DIRECTLY. Closing that DIRECT path is not the whole story, and this suite does not
--   pretend otherwise — see the INFO row T20k raises about the public wrapper's own ACL, which this
--   migration does not change. private.close_stale_dialer_sessions(uuid, uuid, integer) is the same shape (org id
--   and agent id as parameters) and already carried an explicit postgres-only ACL; it is asserted here so
--   that a future `GRANT ... ON ALL FUNCTIONS IN SCHEMA private` cannot quietly re-open it.
--
--     T20a  authenticated HAS USAGE on schema private            (the policy must be able to run at all)
--     T20b  authenticated has NO CREATE on schema private
--     T20c  anon has NEITHER USAGE nor CREATE
--     T20d  PUBLIC has NEITHER USAGE nor CREATE                  (nspacl carries no empty-grantee aclitem)
--     T20e  authenticated CAN execute private.can_update_profile(uuid)
--     T20f  authenticated CANNOT execute workflow_dispatch_event or close_stale_dialer_sessions
--     T20g  anon can execute NOTHING in private                  (swept over pg_proc, not a fixed list)
--     T20h  PUBLIC can execute NOTHING in private                (swept; proacl NOT NULL and no "=" item)
--     T20i  authenticated is the ONLY non-superuser, non-owner role holding EXECUTE anywhere in private,
--           and can_update_profile is the ONLY function it holds it on — enumerated exactly
--     T20j  every private TABLE stays unreachable for authenticated and anon (SELECT/INSERT/UPDATE/DELETE)
--     T20k  the public SECURITY DEFINER wrapper still REACHES the private dispatcher (asserted by
--           privilege — the dispatcher is NEVER invoked, see the block)
--     T20l  a pg_default_acl row now exists for (postgres, private, functions) with no PUBLIC entry
--     T20m  the helper is reachable THROUGH the real policy by a real authenticated caller, and can only
--           ever hand that caller a boolean
--
-- SWEEPS, NOT LISTS: T20g / T20h / T20i / T20j enumerate pg_proc and pg_class instead of naming the three
-- functions and five tables that exist today. A function added to `private` LATER is exposed by default
-- unless T20l's default-privilege row holds, so the sweep is the assertion that actually keeps working.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- T20a-d. Schema-level privileges on `private`.
-- ---------------------------------------------------------------------------------------------------
DO $t20abcd$
DECLARE
  v_nspacl    aclitem[];
  v_found     boolean := false;
  v_auth_u    boolean;
  v_auth_c    boolean;
  v_anon_u    boolean;
  v_anon_c    boolean;
  v_pub_items int;
  v_pub_txt   text;
BEGIN
  SELECT true, n.nspacl INTO v_found, v_nspacl FROM pg_namespace n WHERE n.nspname = 'private';
  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'T20 FAIL (HARD GATE) — schema `private` does not exist. profiles_update_authorized resolves private.can_update_profile(id), so the policy could not work at all and every assertion below would be vacuous.';
  END IF;

  v_auth_u := has_schema_privilege('authenticated', 'private', 'USAGE');
  v_auth_c := has_schema_privilege('authenticated', 'private', 'CREATE');
  v_anon_u := has_schema_privilege('anon',          'private', 'USAGE');
  v_anon_c := has_schema_privilege('anon',          'private', 'CREATE');

  -- T20a — the ENABLING half. Without it the migration is not "safe by omission", it is broken.
  IF v_auth_u IS NOT TRUE THEN
    RAISE EXCEPTION 'T20a FAIL (HARD GATE) — authenticated does NOT hold USAGE on schema private. An RLS policy expression is evaluated with the QUERYING user''s privileges, so profiles_update_authorized would abort EVERY browser profile UPDATE with 42501 "permission denied for schema private" rather than returning 0 rows. The live baseline nspacl was {postgres=UC/postgres}; the migration''s GRANT USAGE ON SCHEMA private TO authenticated did not take effect.';
  END IF;

  -- T20b — USAGE is the entire intended grant. CREATE would let any logged-in user place objects in the
  -- schema the authorization helper lives in.
  IF v_auth_c IS NOT FALSE THEN
    RAISE EXCEPTION 'T20b FAIL (HARD GATE) — authenticated holds CREATE on schema private (nspacl %). The migration grants USAGE and nothing else; CREATE here means an ordinary user can create objects alongside can_update_profile().',
      COALESCE(v_nspacl::text, 'NULL');
  END IF;

  -- T20c — anon gains nothing. No anonymous path (login, accept-invite prefill) resolves a private name.
  IF v_anon_u IS NOT FALSE THEN
    RAISE EXCEPTION 'T20c FAIL (HARD GATE) — anon holds USAGE on schema private (nspacl %). An unauthenticated caller must have no path into this schema at all.',
      COALESCE(v_nspacl::text, 'NULL');
  END IF;
  IF v_anon_c IS NOT FALSE THEN
    RAISE EXCEPTION 'T20c FAIL (HARD GATE) — anon holds CREATE on schema private (nspacl %).',
      COALESCE(v_nspacl::text, 'NULL');
  END IF;

  -- T20d — has_schema_privilege() takes a ROLE and PUBLIC is not one (there is no PUBLIC pseudo-role to
  -- pass), so the PUBLIC grant is read STRUCTURALLY: an aclitem granted to PUBLIC renders with an EMPTY
  -- grantee, i.e. "=U/postgres". A naive nspacl::text LIKE '%=U%' cannot be used — it also matches the
  -- owner's own "postgres=UC/postgres". Testing each aclitem for a leading '=' is the exact test, and it
  -- is the same idiom T18a uses on proacl.
  IF v_nspacl IS NULL THEN
    RAISE EXCEPTION 'T20d FAIL (HARD GATE) — private.nspacl is NULL. For a schema Postgres reads NULL as the built-in default (owner only), which also means authenticated has no USAGE — see T20a. After this migration the ACL must be explicit.';
  END IF;

  SELECT count(*), string_agg(t.ai::text, ', ')
    INTO v_pub_items, v_pub_txt
    FROM unnest(v_nspacl) AS t(ai)
   WHERE t.ai::text LIKE '=%';

  IF v_pub_items <> 0 THEN
    RAISE EXCEPTION 'T20d FAIL (HARD GATE) — private.nspacl carries % PUBLIC aclitem(s) with an empty grantee: %. Full nspacl: %. PUBLIC is inherited by EVERY role including anon, so a PUBLIC USAGE grant hands the schema to unauthenticated callers and makes T20c meaningless.',
      v_pub_items, v_pub_txt, v_nspacl::text;
  END IF;

  RAISE NOTICE 'T20a-d PASS — private.nspacl = % (authenticated USAGE=% CREATE=%, anon USAGE=% CREATE=%, no PUBLIC aclitem)',
    v_nspacl::text, v_auth_u, v_auth_c, v_anon_u, v_anon_c;
END
$t20abcd$;

-- ---------------------------------------------------------------------------------------------------
-- T20e-f. The three named functions, by EXACT signature.
--
-- Resolved with to_regprocedure() rather than a proname lookup: the migration REVOKEs one specific
-- signature, so if the live function ever drifted to a different argument list the REVOKE would silently
-- apply to nothing (or fail) and the real function would keep its PUBLIC grant. Asserting the signature
-- here is asserting that the migration's REVOKE targeted the function that actually exists.
-- ---------------------------------------------------------------------------------------------------
DO $t20ef$
DECLARE
  v_can     oid := to_regprocedure('private.can_update_profile(uuid)')::oid;
  v_disp    oid := to_regprocedure('private.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb)')::oid;
  v_stale   oid := to_regprocedure('private.close_stale_dialer_sessions(uuid,uuid,integer)')::oid;
  v_a_can   boolean;
  v_a_disp  boolean;
  v_a_stale boolean;
BEGIN
  IF v_can IS NULL THEN
    RAISE EXCEPTION 'T20e FAIL (HARD GATE) — private.can_update_profile(uuid) does not exist under that exact signature; profiles_update_authorized cannot be calling the function this matrix asserts.';
  END IF;
  IF v_disp IS NULL THEN
    RAISE EXCEPTION 'T20f FAIL (HARD GATE) — private.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb) does not exist under that exact signature. The migration REVOKEs precisely this signature, so a drift means the REVOKE hit nothing and the live dispatcher keeps its PUBLIC EXECUTE (live baseline proacl was NULL).';
  END IF;
  IF v_stale IS NULL THEN
    RAISE EXCEPTION 'T20f FAIL (HARD GATE) — private.close_stale_dialer_sessions(uuid,uuid,integer) does not exist under that exact signature; the live baseline recorded it with acl postgres=X/postgres.';
  END IF;

  v_a_can   := has_function_privilege('authenticated', v_can,   'EXECUTE');
  v_a_disp  := has_function_privilege('authenticated', v_disp,  'EXECUTE');
  v_a_stale := has_function_privilege('authenticated', v_stale, 'EXECUTE');

  -- T20e — the ENABLING half again: the policy calls this on every candidate row.
  IF v_a_can IS NOT TRUE THEN
    RAISE EXCEPTION 'T20e FAIL (HARD GATE) — authenticated does NOT hold EXECUTE on private.can_update_profile(uuid) (proacl %). Combined with T20a''s schema USAGE this is what makes profiles_update_authorized executable; without it every browser profile write fails with 42501.',
      COALESCE((SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_can), 'NULL');
  END IF;

  -- T20f — the two functions the USAGE grant would otherwise have newly exposed.
  IF v_a_disp IS NOT FALSE THEN
    RAISE EXCEPTION 'T20f FAIL (HARD GATE) — authenticated holds EXECUTE on private.workflow_dispatch_event (proacl %). This is exactly the door GRANT USAGE ON SCHEMA private opened: the function is SECURITY DEFINER and takes p_org_id as a PARAMETER, so it neither knows nor checks who is calling — any logged-in user could dispatch workflow events into an arbitrary organization. It is only ever meant to be reached through the SECURITY DEFINER wrapper public.workflow_dispatch_event (see T20k).',
      COALESCE((SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_disp), 'NULL (= the built-in default, EXECUTE TO PUBLIC)');
  END IF;
  IF v_a_stale IS NOT FALSE THEN
    RAISE EXCEPTION 'T20f FAIL (HARD GATE) — authenticated holds EXECUTE on private.close_stale_dialer_sessions(uuid,uuid,integer) (proacl %). It is SECURITY DEFINER and takes an organization id AND an agent id as parameters, so a direct caller could force-close another tenant''s dialer sessions.',
      COALESCE((SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_stale), 'NULL (= the built-in default, EXECUTE TO PUBLIC)');
  END IF;

  RAISE NOTICE 'T20e-f PASS — authenticated EXECUTE: can_update_profile=% workflow_dispatch_event=% close_stale_dialer_sessions=%',
    v_a_can, v_a_disp, v_a_stale;
END
$t20ef$;

-- ---------------------------------------------------------------------------------------------------
-- T20g-i. THE SWEEP. Every function in `private`, not a fixed list of the three that exist today.
--
-- T20e/f name signatures because the migration names signatures. This block asks the complementary
-- question — "is there ANYTHING else in here that an outside role can call?" — which is the question that
-- still has meaning after somebody adds a fourth function.
-- ---------------------------------------------------------------------------------------------------
DO $t20ghi$
DECLARE
  r        record;
  fails    text := '';
  n_funcs  int;
  v_pairs  text[];
BEGIN
  SELECT count(*) INTO n_funcs
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private';

  IF n_funcs = 0 THEN
    RAISE EXCEPTION 'T20g-i FAIL (HARD GATE) — schema private contains no functions at all. can_update_profile() must be in there (T20e), so this sweep is inspecting the wrong place and its "nothing is reachable" result would be vacuous.';
  END IF;

  FOR r IN
    SELECT p.oid,
           p.proacl,
           'private.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
    ORDER BY 3
  LOOP
    -- T20g. anon must not reach ANY of them.
    IF has_function_privilege('anon', r.oid, 'EXECUTE') IS NOT FALSE THEN
      fails := fails || format(E'\n  - T20g: anon holds EXECUTE on %s (proacl %s)', r.sig,
                               COALESCE(r.proacl::text, 'NULL'));
    END IF;

    -- T20h. PUBLIC, read structurally — has_function_privilege() takes a role and PUBLIC is not one.
    -- proacl NULL is NOT a neutral "no grants" state: Postgres reads it as the built-in default, which for
    -- a function is EXECUTE TO PUBLIC. That is precisely how workflow_dispatch_event was exposed, so a
    -- NULL proacl is a FAILURE here, not an absence of evidence.
    IF r.proacl IS NULL THEN
      fails := fails || format(E'\n  - T20h: %s has proacl NULL, which Postgres interprets as the BUILT-IN DEFAULT (owner + EXECUTE TO PUBLIC). authenticated now holds USAGE on this schema, so it is directly callable by every logged-in user.', r.sig);
    ELSIF EXISTS (SELECT 1 FROM unnest(r.proacl) AS t(ai) WHERE t.ai::text LIKE '=%') THEN
      fails := fails || format(E'\n  - T20h: %s carries a PUBLIC aclitem with an empty grantee: %s', r.sig, r.proacl::text);
    END IF;
  END LOOP;

  IF fails <> '' THEN
    RAISE EXCEPTION 'T20g-h FAIL (HARD GATE) — schema private is executable from outside:%', fails;
  END IF;

  -- T20i. The EXACT reachability set, enumerated rather than spot-checked.
  --
  -- Two exclusions, both principled:
  --   * superusers  — they bypass ACL checks entirely, so has_function_privilege() is always true for them
  --                   and including them would assert nothing. (On Supabase only supabase_admin is one.)
  --   * roles holding the privileges of the function's OWNER — `postgres` owns every function in `private`
  --                   and, on Supabase, is NOT a superuser, so it legitimately answers true here as the
  --                   owner. pg_has_role(role, proowner, 'USAGE') removes the owner and anything that
  --                   inherits from it, and nothing else.
  -- Everything that survives those two exclusions is a role that was deliberately GRANTed something, and
  -- there must be exactly one such pair. proname alone identifies the function because T19l already
  -- hard-asserts there is exactly one private.can_update_profile overload and T20e pins its signature.
  SELECT array_agg(x.pair ORDER BY x.pair) INTO v_pairs
  FROM (
    SELECT rr.rolname || ' -> ' || p.proname AS pair
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN pg_roles rr
    WHERE n.nspname = 'private'
      AND NOT rr.rolsuper
      AND NOT pg_has_role(rr.rolname, p.proowner, 'USAGE')
      AND has_function_privilege(rr.rolname, p.oid, 'EXECUTE')
  ) x;

  IF v_pairs IS DISTINCT FROM ARRAY['authenticated -> can_update_profile']::text[] THEN
    RAISE EXCEPTION 'T20i FAIL (HARD GATE) — the set of (non-superuser, non-owner) role -> function EXECUTE grants in schema private is % but must be exactly {authenticated -> can_update_profile}. Anything extra is a role that can call into the private schema without going through a public wrapper; a MISSING authenticated -> can_update_profile means profiles_update_authorized cannot run at all.',
      COALESCE(v_pairs::text, '{}');
  END IF;

  RAISE NOTICE 'T20g-i PASS — % function(s) in private: anon can execute none, PUBLIC can execute none, and the only non-superuser/non-owner EXECUTE grant in the whole schema is %',
    n_funcs, v_pairs;
END
$t20ghi$;

-- ---------------------------------------------------------------------------------------------------
-- T20j. TABLES. GRANT USAGE ON SCHEMA private must not arrive with any table access.
--
-- The live baseline recorded 5 tables in `private`, and what they hold is the point: cron secrets
-- (email_sync_cron_secret, google_sync_cron_secret, recording_retention_cron_secret) plus provisioning /
-- engine configuration. A single SELECT here is a credential disclosure, so all four DML privileges are
-- asserted for both browser-reachable roles rather than SELECT alone.
-- ---------------------------------------------------------------------------------------------------
DO $t20j$
DECLARE
  r         record;
  v_privs   text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  v_priv    text;
  v_role    text;
  fails     text := '';
  n_tables  int;
BEGIN
  SELECT count(*) INTO n_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'private' AND c.relkind = 'r';

  IF n_tables = 0 THEN
    RAISE EXCEPTION 'T20j FAIL (HARD GATE) — schema private contains no ordinary tables. The live baseline recorded 5, so this sweep is inspecting the wrong schema and its "nothing is reachable" result would be vacuous.';
  END IF;

  FOR r IN
    SELECT c.oid, 'private.' || c.relname AS tbl, c.relacl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private' AND c.relkind = 'r'
    ORDER BY 2
  LOOP
    FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
      FOREACH v_priv IN ARRAY v_privs LOOP
        IF has_table_privilege(v_role, r.oid, v_priv) IS NOT FALSE THEN
          fails := fails || format(E'\n  - %s holds %s on %s (relacl %s)',
                                   v_role, v_priv, r.tbl, COALESCE(r.relacl::text, 'NULL'));
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF fails <> '' THEN
    RAISE EXCEPTION 'T20j FAIL (HARD GATE) — the private schema''s tables are reachable. USAGE on the schema was granted so that ONE boolean function could be called from an RLS policy; these tables hold cron secrets and provisioning config:%', fails;
  END IF;

  RAISE NOTICE 'T20j PASS — all % table(s) in private remain unreachable (SELECT/INSERT/UPDATE/DELETE) for both authenticated and anon', n_tables;
END
$t20j$;

-- ---------------------------------------------------------------------------------------------------
-- T20k. THE WRAPPER MUST STILL REACH THE DISPATCHER.
--
-- T20f revokes the dispatcher from every browser role. The corresponding question is whether the
-- legitimate caller survived: public.workflow_dispatch_event is a SECURITY DEFINER wrapper owned by
-- postgres, so its body runs with postgres's privileges — and postgres keeps both USAGE on the schema and
-- EXECUTE on the private function, because REVOKE ... FROM PUBLIC, anon, authenticated never touches the
-- owner's own grant.
--
-- *** THE DISPATCHER IS DELIBERATELY NEVER INVOKED HERE. *** private.workflow_dispatch_event performs a
-- net.http_post, i.e. a real outbound request to the workflow engine. This file's SAFETY contract is that
-- it produces no external side effects, so reachability is asserted BY PRIVILEGE (owner + EXECUTE + schema
-- USAGE) rather than by calling it. A privilege proof is the right proof anyway: the only way this path
-- can break is a privilege change, since the wrapper's search_path already pins `private`.
-- ---------------------------------------------------------------------------------------------------
DO $t20k$
DECLARE
  v_overloads int;
  v_wrapper   oid;
  v_owner     text;
  v_secdef    boolean;
  v_priv      oid := to_regprocedure('private.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb)')::oid;
  v_own_exec  boolean;
  v_own_usage boolean;
  v_w_anon    boolean;
  v_w_auth    boolean;
  v_w_acl     text;
BEGIN
  SELECT count(*) INTO v_overloads
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'workflow_dispatch_event';

  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'T20k FAIL (HARD GATE) — expected exactly 1 public.workflow_dispatch_event, found %. An overload would carry its own ACL and its own owner, and could be the one a caller resolves to.',
      v_overloads;
  END IF;

  SELECT p.oid, p.proowner::regrole::text, p.prosecdef
    INTO v_wrapper, v_owner, v_secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'workflow_dispatch_event';

  IF v_priv IS NULL THEN
    RAISE EXCEPTION 'T20k FAIL (HARD GATE) — private.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb) does not exist, so the public wrapper has nothing to reach.';
  END IF;

  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'T20k FAIL (HARD GATE) — public.workflow_dispatch_event has prosecdef=%. As SECURITY INVOKER its body would run with the CALLER''s privileges, and T20f has just revoked the private dispatcher from anon and authenticated — so every workflow dispatch from the app would start failing with 42501.',
      v_secdef;
  END IF;

  IF v_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'T20k FAIL (HARD GATE) — public.workflow_dispatch_event is owned by % (expected postgres). The owner supplies the privileges a SECURITY DEFINER body runs with, and only postgres retains EXECUTE on the private dispatcher after this migration.',
      v_owner;
  END IF;

  v_own_exec  := has_function_privilege('postgres', v_priv, 'EXECUTE');
  v_own_usage := has_schema_privilege('postgres', 'private', 'USAGE');

  IF v_own_exec IS NOT TRUE THEN
    RAISE EXCEPTION 'T20k FAIL (HARD GATE) — postgres does NOT hold EXECUTE on private.workflow_dispatch_event (proacl %). The migration''s REVOKE ALL ... FROM PUBLIC, anon, authenticated must not strip the owner: the wrapper runs as postgres and every workflow trigger in the app goes through it.',
      COALESCE((SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_priv), 'NULL');
  END IF;
  IF v_own_usage IS NOT TRUE THEN
    RAISE EXCEPTION 'T20k FAIL (HARD GATE) — postgres does NOT hold USAGE on schema private, so the wrapper cannot even resolve the dispatcher''s name.';
  END IF;

  RAISE NOTICE 'T20k PASS — public.workflow_dispatch_event is SECURITY DEFINER owned by % and that owner retains USAGE on private (%) plus EXECUTE on the private dispatcher (%); reachability asserted by privilege, the dispatcher was NOT invoked (it performs net.http_post)',
    v_owner, v_own_usage, v_own_exec;

  -- -------------------------------------------------------------------------------------------------
  -- INFORMATIONAL, NEVER GATED — the other end of the same pipe.
  --
  -- T20f revokes the PRIVATE dispatcher from anon and authenticated, and the migration's comment gives the
  -- reason as "reaching it directly would let any authenticated user dispatch workflow events for an
  -- arbitrary organization id". That is true of the DIRECT path and this suite proves the direct path is
  -- shut. It is not, however, the whole capability: public.workflow_dispatch_event is a bare pass-through
  -- (PERFORM private.workflow_dispatch_event(<all six arguments verbatim>), errors swallowed into a
  -- WARNING), it is SECURITY DEFINER owned by postgres, it takes p_org_id from the CALLER, it performs no
  -- authorization check of its own, and it lives in `public` — so PostgREST exposes it as an RPC. Whoever
  -- holds EXECUTE on the wrapper keeps the capability regardless of the private-side REVOKE.
  --
  -- This migration does not change the wrapper's ACL, so this is PRE-EXISTING and is recorded here as an
  -- observation, NOT asserted: a hard gate would fail on a state the P0 change neither created nor claims
  -- to fix, and turn the dry run red for the wrong reason. It belongs in the follow-up that decides
  -- whether the wrapper should derive p_org_id from the caller instead of accepting it.
  -- -------------------------------------------------------------------------------------------------
  v_w_anon := has_function_privilege('anon',          v_wrapper, 'EXECUTE');
  v_w_auth := has_function_privilege('authenticated', v_wrapper, 'EXECUTE');
  SELECT COALESCE(p.proacl::text, 'NULL') INTO v_w_acl FROM pg_proc p WHERE p.oid = v_wrapper;

  IF v_w_anon OR v_w_auth THEN
    INSERT INTO pg_temp._p0_info VALUES ('INFO-3 / T20k wrapper reachability (PRE-EXISTING, not gated)',
      format('public.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb) is SECURITY DEFINER owned by %s, performs NO authorization check, takes p_org_id as a caller-supplied parameter, and holds EXECUTE for anon=%s / authenticated=%s (proacl %s). It is in the PostgREST-exposed public schema, so revoking the private dispatcher (T20f) closes the direct path but not this one. NOT introduced by this migration and NOT gated here.',
             v_owner, v_w_anon, v_w_auth, v_w_acl));
    RAISE NOTICE 'T20k INFO — the public wrapper itself is EXECUTE-able by anon=% / authenticated=% (proacl %); pre-existing, recorded in pg_temp._p0_info, not gated',
      v_w_anon, v_w_auth, v_w_acl;
  END IF;
END
$t20k$;

-- ---------------------------------------------------------------------------------------------------
-- T20l. DEFAULT PRIVILEGES — the assertion that keeps T20g/h true tomorrow.
--
-- Live baseline: ZERO pg_default_acl rows for (postgres, private, functions), which means PostgreSQL's
-- built-in default was in force — and for a function that default is {=X/owner, owner=X/owner}, i.e.
-- EXECUTE TO PUBLIC. Before this migration that was survivable because nothing outside postgres held USAGE
-- on the schema. It is not survivable now: with authenticated holding USAGE, the very next function anyone
-- creates in `private` would be callable by every logged-in user the moment it exists.
-- ---------------------------------------------------------------------------------------------------
DO $t20l$
DECLARE
  v_rows int;
  v_acl  aclitem[];
  v_pub  int;
BEGIN
  SELECT count(*) INTO v_rows
  FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE d.defaclrole = 'postgres'::regrole
    AND n.nspname = 'private'
    AND d.defaclobjtype = 'f';

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'T20l FAIL (HARD GATE) — expected exactly 1 pg_default_acl row for (defaclrole=postgres, schema=private, defaclobjtype=f), found %. Live baseline was 0 rows, i.e. PostgreSQL''s built-in default is in force, and for functions that default is % — EXECUTE TO PUBLIC. authenticated now holds USAGE on this schema (T20a), so the next function created in `private` by postgres would be immediately callable by every logged-in user.',
      v_rows, acldefault('f', 'postgres'::regrole)::text;
  END IF;

  SELECT d.defaclacl INTO v_acl
  FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE d.defaclrole = 'postgres'::regrole
    AND n.nspname = 'private'
    AND d.defaclobjtype = 'f';

  IF v_acl IS NULL THEN
    RAISE EXCEPTION 'T20l FAIL (HARD GATE) — the pg_default_acl row for (postgres, private, functions) exists but defaclacl is NULL.';
  END IF;

  SELECT count(*) INTO v_pub FROM unnest(v_acl) AS t(ai) WHERE t.ai::text LIKE '=%';
  IF v_pub <> 0 THEN
    RAISE EXCEPTION 'T20l FAIL (HARD GATE) — the default ACL for functions created by postgres in schema private still carries % PUBLIC aclitem(s) (empty grantee): %. ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC did not take effect, so T20g/T20h hold only for the functions that exist today.',
      v_pub, v_acl::text;
  END IF;

  RAISE NOTICE 'T20l PASS — pg_default_acl(postgres, private, functions) = % (no PUBLIC entry); a future function created by postgres in private will NOT be PUBLIC-executable', v_acl::text;
END
$t20l$;

-- ---------------------------------------------------------------------------------------------------
-- T20m. END-TO-END: the helper is reachable THROUGH the real policy, by a real authenticated caller.
--
-- T20a and T20e assert the two privileges the policy needs. This block proves they compose. It matters
-- because the failure mode is asymmetric and silent in opposite directions:
--   * missing schema USAGE  -> the UPDATE does not return 0 rows, it ABORTS with 42501 "permission denied
--                              for schema private". Every profile write in the product breaks, and no
--                              negative test in this file (all of which expect 0 rows or a refusal) would
--                              distinguish that from working correctly.
--   * present but wrong     -> reachable AND permissive is worse than unreachable, so the same session
--                              also calls the helper directly and asserts true(self) / false(cross-org).
--
-- The write targets `phone` on the actor's OWN row: phone is not guarded by Layer 3 and IS in the
-- authenticated column GRANT, so a successful 1-row result can only mean the RLS policy evaluated
-- private.can_update_profile(id) and got true. Actor is the dedicated T19 org-A Agent.
-- ---------------------------------------------------------------------------------------------------
DO $t20m$
DECLARE
  v_actor    uuid := 'c1111111-0000-4000-8000-000000001901'::uuid;  -- U19_AGENT   org A, DB role Agent
  v_victim_b uuid := 'c1111111-0000-4000-8000-000000001903'::uuid;  -- U19_VICTIM_B org B, cross-tenant
  v_new      text := '+15550012001';
  v_before   text;
  v_after    text;
  n          int  := -1;
  raised     boolean := false;
  msg        text;
  sqlst      text;
  v_self     boolean;
  v_cross    boolean;
  v_rettype  text;
  v_retset   boolean;
BEGIN
  -- The helper can only ever hand its caller a boolean. authenticated holds EXECUTE on it (T20e), so a
  -- composite or SETOF return type would turn the policy helper into a readable window onto
  -- public.profiles for a caller who has no SELECT policy covering those rows.
  SELECT p.prorettype::regtype::text, p.proretset
    INTO v_rettype, v_retset
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'can_update_profile'
    AND p.pronargs = 1 AND p.proargtypes[0]::regtype = 'uuid'::regtype;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T20m FAIL (HARD GATE) — private.can_update_profile(uuid) does not exist.';
  END IF;
  IF v_rettype IS DISTINCT FROM 'boolean' OR v_retset IS NOT FALSE THEN
    RAISE EXCEPTION 'T20m FAIL (HARD GATE) — private.can_update_profile(uuid) returns % (proretset=%), not a scalar boolean. It must expose an authorization DECISION and nothing else — no profile columns may be read out of it by the authenticated callers that hold EXECUTE.',
      v_rettype, v_retset;
  END IF;

  SELECT phone INTO v_before FROM public.profiles WHERE id = v_actor;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'T20m FAIL (HARD GATE) — the T19 agent fixture % has no phone baseline; "the value persisted" could not be asserted', v_actor;
  END IF;
  IF v_before = v_new THEN
    RAISE EXCEPTION 'T20m FAIL (HARD GATE) — the fixture phone already equals the value T20m writes (%), so "1 row and the value persisted" would prove nothing', v_new;
  END IF;

  PERFORM pg_temp._sim(v_actor, 'a0a0a0a0-0000-4000-8000-000000000001'::uuid, 'Agent');
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET phone = v_new WHERE id = v_actor;
    GET DIAGNOSTICS n = ROW_COUNT;

    -- Same session, same role: the helper called DIRECTLY. This exercises schema USAGE + function EXECUTE
    -- rather than merely asserting them from the catalogs.
    SELECT private.can_update_profile(v_actor)    INTO v_self;
    SELECT private.can_update_profile(v_victim_b) INTO v_cross;
  EXCEPTION WHEN OTHERS THEN
    raised := true; msg := SQLERRM; sqlst := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp._sys();

  IF raised THEN
    RAISE EXCEPTION 'T20m FAIL (HARD GATE) — the authenticated self-update / direct helper call raised % (%). If that is 42501 "permission denied for schema private", GRANT USAGE ON SCHEMA private TO authenticated is missing and EVERY browser profile write is broken — the one failure mode the rest of this file cannot see, because every other test expects a refusal.',
      sqlst, msg;
  END IF;

  IF n <> 1 THEN
    RAISE EXCEPTION 'T20m FAIL (HARD GATE) — the approved self-update of a NON-protected column affected % row(s), expected exactly 1. phone is neither Layer-1 revoked nor Layer-3 guarded, so the only thing that can have withheld the row is profiles_update_authorized failing to evaluate private.can_update_profile(id).',
      n;
  END IF;

  SELECT phone INTO v_after FROM public.profiles WHERE id = v_actor;
  IF v_after IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'T20m FAIL (HARD GATE) — the statement reported 1 row but phone is % (expected %)', v_after, v_new;
  END IF;

  IF v_self IS NOT TRUE THEN
    RAISE EXCEPTION 'T20m FAIL (HARD GATE) — private.can_update_profile(self) returned % when called directly by the same authenticated session whose UPDATE the policy had just admitted. The policy and the direct call must resolve to the same decision.',
      v_self;
  END IF;
  IF v_cross IS NOT FALSE THEN
    RAISE EXCEPTION 'T20m FAIL (HARD GATE) — private.can_update_profile(<org-B profile>) returned % for an org-A Agent. Reachable AND permissive is worse than unreachable.',
      v_cross;
  END IF;

  RAISE NOTICE 'T20m PASS — an org-A Agent self-updated phone through profiles_update_authorized (1 row, % -> %), and the helper called directly in the same session answered self=% cross-org=% — a boolean, never profile data',
    v_before, v_after, v_self, v_cross;
END
$t20m$;

-- =====================================================================================================
-- Summary
-- =====================================================================================================
DO $done$
DECLARE c int; i int; r record;
BEGIN
  SELECT count(*) INTO c FROM pg_temp._p0_soft_fail;
  SELECT count(*) INTO i FROM pg_temp._p0_info;

  RAISE NOTICE '=========================================================================';
  IF c = 0 THEN
    RAISE NOTICE 'P0 SECURITY MATRIX (HARD GATES T0-T17): ALL PASSED';
  ELSE
    RAISE WARNING 'P0 SECURITY MATRIX: % SECURITY FAILURE(S) — THIS RUN DOES NOT PASS:', c;
    FOR r IN SELECT label, detail FROM pg_temp._p0_soft_fail LOOP
      RAISE WARNING '  SECURITY FAIL % -- %', r.label, r.detail;
    END LOOP;
    RAISE EXCEPTION 'P0 SECURITY MATRIX FAILED (% security failure(s)); see warnings above', c;
  END IF;
  RAISE NOTICE '-------------------------------------------------------------------------';
  IF i = 0 THEN
    RAISE NOTICE 'Informational observations: none';
  ELSE
    RAISE NOTICE 'Informational observations (% — PRE-EXISTING defects, NOT gated, NOT a pass):', i;
    FOR r IN SELECT label, detail FROM pg_temp._p0_info LOOP
      RAISE NOTICE '  INFO % -- %', r.label, r.detail;
    END LOOP;
  END IF;
  RAISE NOTICE '=========================================================================';
END
$done$;

-- [wrapper owns ROLLBACK]
-- -----------------------------------------------------------------------------------------------
-- STEP 4 - restore role, fixture counts AFTER, re-enable triggers, assert restored
-- -----------------------------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);

DO $post$
DECLARE n_prof int; n_org int; n_inv int; n_usr int;
BEGIN
  SELECT count(*) INTO n_prof FROM public.profiles      WHERE email LIKE '%@p0test.invalid';
  SELECT count(*) INTO n_org  FROM public.organizations WHERE slug  LIKE 'p0-dryrun-%';
  SELECT count(*) INTO n_inv  FROM public.invitations   WHERE email LIKE '%@p0test.invalid';
  SELECT count(*) INTO n_usr  FROM auth.users           WHERE email LIKE '%@p0test.invalid';
  RAISE NOTICE 'POST(in-txn) fixtures: profiles=% orgs=% invitations=% auth_users=%', n_prof, n_org, n_inv, n_usr;
  IF n_prof = 0 AND n_usr = 0 THEN
    RAISE EXCEPTION 'FAIL: no fixtures were created - the matrix did not run as intended';
  END IF;
END
$post$;

ALTER TABLE public.organizations ENABLE TRIGGER on_organization_created_provision_twilio;
ALTER TABLE public.profiles      ENABLE TRIGGER on_profile_created_welcome_email;

DO $restore$
DECLARE a char; b char;
BEGIN
  SELECT tgenabled INTO a FROM pg_trigger WHERE tgname='on_organization_created_provision_twilio' AND tgrelid='public.organizations'::regclass;
  SELECT tgenabled INTO b FROM pg_trigger WHERE tgname='on_profile_created_welcome_email'        AND tgrelid='public.profiles'::regclass;
  IF a <> 'O' OR b <> 'O' THEN
    RAISE EXCEPTION 'FAIL: triggers NOT restored before rollback (twilio=%, welcome=%)', a, b;
  END IF;
  RAISE NOTICE 'STEP4 both external-effect triggers re-enabled and asserted';
END
$restore$;

-- No pg_net work may have been queued for fixtures.
DO $netchk$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM net.http_request_queue
   WHERE url ILIKE '%p0test.invalid%' OR body::text ILIKE '%p0test.invalid%'
      OR body::text ILIKE '%p0-dryrun-%';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % queued pg_net request(s) reference fixtures', n; END IF;
  RAISE NOTICE 'STEP4 pg_net queue clean for fixtures';
END
$netchk$;

DO $fin$ BEGIN RAISE NOTICE 'ALL STEPS COMPLETE - rolling back now; nothing is persisted'; END $fin$;

-- =====================================================================================================
-- FINAL STATEMENT - unconditional. Nothing above this line is committed.
-- =====================================================================================================
ROLLBACK;
