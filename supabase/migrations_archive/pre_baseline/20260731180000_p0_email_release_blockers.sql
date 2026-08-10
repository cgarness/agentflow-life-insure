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
-- two decided authorization from the JWT (get_user_role() reads only the token;
-- get_org_id() prefers the token's app_metadata). A stale or poisoned token
-- therefore still satisfied Layer 2 for non-protected columns. Layer 2 must be
-- database-authoritative or it is not an independent layer.
--
-- The helper lives in a DEDICATED schema, not in `private`: granting
-- authenticated USAGE on `private` would have widened access to an existing
-- internal schema (and would have required compensating ACL surgery on
-- unrelated objects). profile_authz contains exactly one function and nothing
-- else, so the blast radius of the USAGE grant is exactly that function.
-- The existing `private` schema is left byte-for-byte untouched.
CREATE SCHEMA IF NOT EXISTS profile_authz AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA profile_authz FROM PUBLIC;
REVOKE ALL ON SCHEMA profile_authz FROM anon;
REVOKE ALL ON SCHEMA profile_authz FROM authenticated;
GRANT USAGE ON SCHEMA profile_authz TO authenticated;   -- USAGE only; never CREATE

CREATE OR REPLACE FUNCTION profile_authz.can_update_profile(p_target_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id uuid := auth.uid();
  a_role   text;
  a_org    uuid;
  a_super  boolean;
  t_org    uuid;
BEGIN
  IF actor_id IS NULL OR p_target_profile_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.role, p.organization_id, COALESCE(p.is_super_admin, false)
    INTO a_role, a_org, a_super
  FROM public.profiles p
  WHERE p.id = actor_id;
  IF NOT FOUND THEN
    RETURN false;                       -- authenticated but no profile => no authority
  END IF;

  SELECT p.organization_id INTO t_org
  FROM public.profiles p
  WHERE p.id = p_target_profile_id;
  IF NOT FOUND THEN
    RETURN false;                       -- unknown target
  END IF;

  a_super := COALESCE(a_super, false);

  -- Self is always permitted at the ROW level; which COLUMNS may change is the
  -- trigger's job, not this function's.
  IF p_target_profile_id = actor_id THEN
    RETURN true;
  END IF;

  -- Every non-self case requires a non-NULL, matching organization.
  IF a_org IS NULL OR t_org IS NULL THEN
    RETURN false;
  END IF;
  IF COALESCE(a_org = t_org, false) IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- Platform super admin: OWN-ORG scope only, matching live super_admin_own_org().
  IF a_super IS TRUE THEN
    RETURN true;
  END IF;

  IF a_role IN ('Admin', 'Super Admin') THEN
    RETURN true;
  END IF;

  IF a_role = 'Team Leader' THEN
    RETURN COALESCE(public.is_ancestor_of(actor_id, p_target_profile_id), false);
  END IF;

  RETURN false;                         -- Agent and any unrecognised role: self only
END;
$$;

COMMENT ON FUNCTION profile_authz.can_update_profile(uuid) IS
  'P0 Layer 2: database-authoritative row authorization for UPDATE on public.profiles. Resolves actor and target from public.profiles; never reads JWT role/org/is_super_admin/platform_role or user_metadata. Returns a scalar boolean only.';

-- Explicitly strip the built-in PUBLIC EXECUTE default for THIS function, in the
-- same transaction that creates it. (No ALTER DEFAULT PRIVILEGES anywhere: any
-- future function added to this schema must carry its own REVOKE.)
REVOKE ALL ON FUNCTION profile_authz.can_update_profile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION profile_authz.can_update_profile(uuid) TO authenticated;

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_update_hierarchical ON public.profiles;

CREATE POLICY profiles_update_authorized ON public.profiles
  FOR UPDATE TO authenticated
  USING (profile_authz.can_update_profile(id))
  WITH CHECK (profile_authz.can_update_profile(id));

-- -----------------------------------------------------------------------------
-- DEFERRED (tracked, intentionally NOT in this release):
--   public.workflow_dispatch_event is a PostgREST-reachable SECURITY DEFINER
--   pass-through that accepts a caller-supplied organization id and currently
--   grants EXECUTE to anon and authenticated. It is a real finding, but it does
--   NOT block the email release, so per Chris's scope decision it is excluded
--   from this migration and tracked for its own security PR.
-- -----------------------------------------------------------------------------

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
-- DROP FUNCTION IF EXISTS profile_authz.can_update_profile(uuid);
-- DROP SCHEMA IF EXISTS profile_authz;          -- only after the function is gone
--
-- NOTE: no default-privilege rollback appears here because the migration makes
-- NO pg_default_acl change. The `private` schema, its functions, its tables and
-- its ACLs are likewise untouched by this migration, so nothing about `private`
-- needs restoring.
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
