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

  actor_is_platform := (actor_platform_role = 'platform_admin');
  is_self := (actor_id = NEW.id);

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
    IF NOT actor_is_super THEN
      RAISE EXCEPTION 'Only a platform super admin may change is_super_admin'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF is_self THEN
      RAISE EXCEPTION 'is_super_admin may not be changed on your own profile'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.platform_role IS DISTINCT FROM OLD.platform_role THEN
    IF NOT actor_is_platform THEN
      RAISE EXCEPTION 'Only a platform admin may change platform_role'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF is_self THEN
      RAISE EXCEPTION 'platform_role may not be changed on your own profile'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- Tier: ADMIN-MANAGED — same-org Admin/Super Admin, or platform super
  -- admin cross-org. Self-promotion is barred for every actor.
  -- ---------------------------------------------------------------------
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF is_self THEN
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

    IF NEW.role = 'Super Admin' AND NOT actor_is_super THEN
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

-- (b) Self-update: TO PUBLIC + missing WITH CHECK  ->  TO authenticated + explicit check.
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- (c) Admin update: TO PUBLIC + missing WITH CHECK  ->  TO authenticated + matching check.
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'Admin')
  WITH CHECK (organization_id = get_user_org_id() AND get_user_role() = 'Admin');

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
-- DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
-- CREATE POLICY profiles_update_own ON public.profiles
--   FOR UPDATE USING (id = auth.uid());
--
-- DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
-- CREATE POLICY profiles_update_admin ON public.profiles
--   FOR UPDATE USING (organization_id = get_user_org_id() AND get_user_role() = 'Admin');
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
--     T13  probe: an authorized upline_id change on a user WHO HAS DOWNLINE — exercises the
--          cascade_hierarchy_update() AFTER trigger against the new guard (see KNOWN SOFT FAILURES)
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
--   * All fixture identifiers are fixed, obviously-synthetic UUIDs (a1111111-…, b1111111-…) and all
--     fixture email addresses use the non-routable @p0test.invalid domain.
--   * No mail is sent: `SET LOCAL app.settings.supabase_url = ''` makes the AFTER INSERT trigger
--     on_profile_created_welcome_email short-circuit before its net.http_post call. Each fixture profile
--     therefore emits one expected `WARNING: Welcome email skipped: SUPABASE_URL not set` — harmless.
--
-- READING THE OUTPUT
--   Every assertion either RAISEs (aborting the run at the first hard failure) or prints `Tn PASS`.
--   Two checks are deliberately SOFT — they record a row in pg_temp._p0_soft_fail and print a WARNING
--   instead of aborting, so the rest of the matrix still runs. The last block reprints them.
--   >>> grep the psql output for `FAIL` <<<
--
-- INFORMATIONAL OBSERVATIONS (PRE-EXISTING defects; NOT security assertions, NOT gated, NOT 'passing')
--   T5c  public.update_hierarchy_path() calls compute_hierarchy_path(NEW.id) from a BEFORE UPDATE
--        trigger, and compute_hierarchy_path() re-reads public.profiles — which still holds the OLD
--        upline_id at that point. The recompute is therefore one change stale. PRE-EXISTING (visible in
--        live data today: every profile with an upline_id still has a 1-level hierarchy_path); NOT
--        introduced by this migration. T5c hard-asserts the security property (the path is DB-derived
--        and ends in the row's own label) and soft-asserts the canonical ancestor chain.
--   T13  RESOLVED — this check should now PASS, and a failure here is a real regression.
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
INSERT INTO public.organizations (id, name) VALUES
  (:ORG_A::uuid, 'P0 Test Org A'),
  (:ORG_B::uuid, 'P0 Test Org B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.teams (id, organization_id, name) VALUES
  (:TEAM_A::uuid, :ORG_A::uuid, 'P0 Test Team A')
ON CONFLICT (id) DO NOTHING;

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
  (:U_AGENT_B::uuid,  'p0.agent.b@p0test.invalid',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now())
ON CONFLICT (id) DO NOTHING;

-- Belt and braces: if on_auth_user_created is not installed on this database, create the rows directly.
INSERT INTO public.profiles (id, email, first_name, last_name, role, status)
SELECT u.id, u.email, 'P0', 'Fixture', 'Agent', 'Active'
FROM auth.users u
WHERE u.email LIKE 'p0.%@p0test.invalid'
ON CONFLICT (id) DO NOTHING;

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
  (:INV_A::uuid, 'p0.invitee.a@p0test.invalid', :ORG_A::uuid, 'Agent', 'p0-test-token-org-a', now() + interval '7 days', 'Pending'),
  (:INV_B::uuid, 'p0.invitee.b@p0test.invalid', :ORG_B::uuid, 'Agent', 'p0-test-token-org-b', now() + interval '7 days', 'Pending')
ON CONFLICT (id) DO NOTHING;

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
--   SOFT  : hierarchy_path equals the canonical ancestor chain. See KNOWN SOFT FAILURES in the header.
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

  -- Correctness property (soft).
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
-- T13. PROBE — authorized upline_id change on a member WHO HAS DOWNLINE.
-- cascade_hierarchy_update() (AFTER UPDATE OF upline_id) rewrites each descendant's hierarchy_path with
-- its own UPDATE. SECURITY DEFINER does not change auth.uid(), so the new guard evaluates that inner
-- write as the *caller* and refuses it — which fails the whole outer statement. SOFT so the matrix
-- finishes; see KNOWN SOFT FAILURES in the header.
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
-- Summary
-- =====================================================================================================
DO $done$
DECLARE c int; i int; r record;
BEGIN
  SELECT count(*) INTO c FROM pg_temp._p0_soft_fail;
  SELECT count(*) INTO i FROM pg_temp._p0_info;

  RAISE NOTICE '=========================================================================';
  IF c = 0 THEN
    RAISE NOTICE 'P0 SECURITY MATRIX (HARD GATES T0-T13): ALL PASSED';
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
