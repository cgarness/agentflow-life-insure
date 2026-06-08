-- =============================================================================
-- Campaign Settings — per-campaign EDIT-PERMISSION model (Build 2a, Parts A/D)
-- =============================================================================
-- Adds a per-campaign "who may edit calling settings" policy + a per-USER grant
-- table, and enforces it server-side via a BEFORE UPDATE trigger (hard backstop)
-- plus a SECURITY DEFINER write RPC (the app's save path). The base
-- `campaigns_update` RLS policy is intentionally NOT rewritten — the trigger is
-- the enforcer, so renames / status / assigned_agent_ids / counter writes keep
-- working for Team Leaders while SETTINGS edits are gated.
--
-- DECISIONS (locked with Chris):
--   D1  campaign_settings_permissions.user_id -> profiles(id) ON DELETE CASCADE
--       (profiles.id IS auth.users.id here; the picker selects same-org profiles).
--   D2  granted_by -> profiles(id) ON DELETE SET NULL (soft FK; keeps the grant
--       if the granter is later removed).
--   D3  can_edit_campaign_settings = SECURITY DEFINER, SET search_path, boolean
--       only, with an explicit org-isolation guard (no cross-org read leak).
--   D4  trigger constrains END USERS only: auth.uid() IS NULL (service-role /
--       migrations) bypasses, so backfills touching these columns won't RAISE.
--   D5  'admins_only' is hidden from non-admins in the UI ONLY — it remains in
--       the column CHECK and in can_edit (an Admin can still set it).
--
-- Default 'creator_and_admins' on EXISTING rows intentionally removes Team
-- Leaders' previous blanket settings-edit ability.
--
-- NOTE: authored as a FILE — PENDING APPLY. Not applied to prod by this change.
-- =============================================================================

-- ── A1. Per-campaign policy column ───────────────────────────────────────────
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS settings_edit_policy text NOT NULL DEFAULT 'creator_and_admins';

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_settings_edit_policy_check;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_settings_edit_policy_check
  CHECK (settings_edit_policy IN ('creator_and_admins', 'admins_only', 'team_leaders', 'specific_users'));

COMMENT ON COLUMN public.campaigns.settings_edit_policy IS
  'Who may edit this campaign''s calling settings. creator_and_admins (default) | admins_only | team_leaders | specific_users. Enforced by trg_enforce_campaign_settings_edit + update_campaign_settings().';

-- ── A2. Per-USER grant table (specific_users / extra grantees) ───────────────
CREATE TABLE IF NOT EXISTS public.campaign_settings_permissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id     uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,        -- D1
  permission      text NOT NULL DEFAULT 'edit_settings' CHECK (permission = 'edit_settings'),
  granted_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,                -- D2
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_csp_campaign ON public.campaign_settings_permissions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_csp_user     ON public.campaign_settings_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_csp_org      ON public.campaign_settings_permissions(organization_id);

COMMENT ON TABLE public.campaign_settings_permissions IS
  'Per-user edit_settings grants for a campaign (used by settings_edit_policy team_leaders/specific_users). Org-scoped; RLS writes gated by can_edit_campaign_settings().';

-- ── A3. Authorization oracle — can_edit_campaign_settings(campaign) ───────────
-- SECURITY DEFINER (D3): evaluates identically whether called from RLS, the
-- trigger, or the write RPC, independent of the caller's row-visibility. It only
-- ever returns a boolean and self-scopes with an explicit org guard, so there is
-- no cross-org read leak. auth.uid()/get_org_id()/get_user_role() remain the
-- REAL end user even under DEFINER (they read request GUCs, not the function role).
CREATE OR REPLACE FUNCTION public.can_edit_campaign_settings(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org    uuid;
  v_owner  uuid;
  v_policy text;
  v_role   text;
BEGIN
  SELECT organization_id, user_id, settings_edit_policy
    INTO v_org, v_owner, v_policy
  FROM public.campaigns
  WHERE id = p_campaign_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Super admin scoped to their own org (matches campaign policies).
  IF public.super_admin_own_org(v_org) THEN
    RETURN true;
  END IF;

  -- Hard org isolation (null-safe: NULL org -> blocked).
  IF v_org IS DISTINCT FROM public.get_org_id() THEN
    RETURN false;
  END IF;

  v_role := public.get_user_role();

  -- Admins always — creators cannot lock admins out.
  IF v_role = 'Admin' THEN
    RETURN true;
  END IF;

  -- Creator/owner — allowed unless the policy is admins_only.
  IF v_owner = auth.uid()
     AND v_policy IN ('creator_and_admins', 'team_leaders', 'specific_users') THEN
    RETURN true;
  END IF;

  -- Team Leaders when the policy opens to them ('Team Lead' = defensive alias).
  IF v_policy = 'team_leaders' AND v_role IN ('Team Leader', 'Team Lead') THEN
    RETURN true;
  END IF;

  -- Explicit per-user grant (team_leaders or specific_users).
  IF v_policy IN ('team_leaders', 'specific_users')
     AND EXISTS (
       SELECT 1
       FROM public.campaign_settings_permissions g
       WHERE g.campaign_id = p_campaign_id
         AND g.user_id = auth.uid()
         AND g.permission = 'edit_settings'
     ) THEN
    RETURN true;
  END IF;

  -- admins_only (admins already returned true above) and everything else.
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_edit_campaign_settings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_edit_campaign_settings(uuid) TO authenticated;

COMMENT ON FUNCTION public.can_edit_campaign_settings(uuid) IS
  'True if the current user may edit the campaign''s calling settings (super admin own-org, Admin, owner unless admins_only, Team Leader under team_leaders, or an explicit edit_settings grant). Boolean only; org-isolated.';

-- ── A4. Hard backstop — BEFORE UPDATE trigger on campaigns ───────────────────
-- Guards ONLY the settings columns. Any other column change (name, status,
-- assigned_agent_ids, counters, …) passes through untouched. End-user only (D4).
CREATE OR REPLACE FUNCTION public.enforce_campaign_settings_edit_permission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed boolean;
BEGIN
  v_changed :=
       NEW.max_attempts            IS DISTINCT FROM OLD.max_attempts
    OR NEW.calling_hours_start     IS DISTINCT FROM OLD.calling_hours_start
    OR NEW.calling_hours_end       IS DISTINCT FROM OLD.calling_hours_end
    OR NEW.retry_interval_hours    IS DISTINCT FROM OLD.retry_interval_hours
    OR NEW.retry_interval_minutes  IS DISTINCT FROM OLD.retry_interval_minutes
    OR NEW.ring_timeout_seconds    IS DISTINCT FROM OLD.ring_timeout_seconds
    OR NEW.auto_dial_enabled       IS DISTINCT FROM OLD.auto_dial_enabled
    OR NEW.local_presence_enabled  IS DISTINCT FROM OLD.local_presence_enabled
    OR NEW.number_group_id         IS DISTINCT FROM OLD.number_group_id
    OR NEW.settings_edit_policy    IS DISTINCT FROM OLD.settings_edit_policy;

  -- Constrain authenticated END USERS only. System/service-role/migration
  -- contexts (auth.uid() IS NULL) bypass — they already operate above app auth,
  -- so backfills touching these columns won't be blocked.
  IF v_changed
     AND auth.uid() IS NOT NULL
     AND NOT public.can_edit_campaign_settings(NEW.id) THEN
    RAISE EXCEPTION 'You don''t have permission to edit this campaign''s settings.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_campaign_settings_edit ON public.campaigns;
CREATE TRIGGER trg_enforce_campaign_settings_edit
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_campaign_settings_edit_permission();

-- ── A5. App write path — update_campaign_settings(...) ───────────────────────
-- SECURITY DEFINER so a granted NON-owner (whom the base campaigns_update RLS
-- would block) can save. The BEFORE UPDATE trigger still fires under it and
-- re-checks via the REAL auth.uid(). Pre-checks can_edit for a friendly error.
-- number_group_id is intentionally NOT a parameter (no modal UI) — never changed
-- here; the trigger still guards it against other direct writes.
CREATE OR REPLACE FUNCTION public.update_campaign_settings(
  p_campaign_id            uuid,
  p_max_attempts           integer,
  p_calling_hours_start    time,
  p_calling_hours_end      time,
  p_retry_interval_hours   integer,
  p_retry_interval_minutes integer,
  p_ring_timeout_seconds   integer,
  p_auto_dial_enabled      boolean,
  p_local_presence_enabled boolean,
  p_settings_edit_policy   text
)
RETURNS public.campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.campaigns;
BEGIN
  IF NOT public.can_edit_campaign_settings(p_campaign_id) THEN
    RAISE EXCEPTION 'You don''t have permission to edit this campaign''s settings.'
      USING ERRCODE = '42501';
  END IF;

  IF p_settings_edit_policy IS NOT NULL
     AND p_settings_edit_policy NOT IN ('creator_and_admins', 'admins_only', 'team_leaders', 'specific_users') THEN
    RAISE EXCEPTION 'Invalid settings_edit_policy: %', p_settings_edit_policy
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.campaigns
  SET max_attempts           = p_max_attempts,
      calling_hours_start    = p_calling_hours_start,
      calling_hours_end      = p_calling_hours_end,
      retry_interval_hours   = p_retry_interval_hours,
      retry_interval_minutes = COALESCE(p_retry_interval_minutes, retry_interval_minutes),  -- NOT NULL column
      ring_timeout_seconds   = p_ring_timeout_seconds,
      auto_dial_enabled      = p_auto_dial_enabled,
      local_presence_enabled = p_local_presence_enabled,
      settings_edit_policy   = COALESCE(p_settings_edit_policy, settings_edit_policy)
  WHERE id = p_campaign_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_campaign_settings(uuid, integer, time, time, integer, integer, integer, boolean, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_campaign_settings(uuid, integer, time, time, integer, integer, integer, boolean, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.update_campaign_settings(uuid, integer, time, time, integer, integer, integer, boolean, boolean, text) IS
  'App write path for campaign calling settings. SECURITY DEFINER so granted non-owners can save; re-checks can_edit_campaign_settings and the BEFORE UPDATE trigger still enforces via the real auth.uid(). Returns the updated campaigns row.';

-- ── A6. RLS on campaign_settings_permissions (org on every policy) ────────────
ALTER TABLE public.campaign_settings_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS csp_select_own_org ON public.campaign_settings_permissions;
CREATE POLICY csp_select_own_org ON public.campaign_settings_permissions
  FOR SELECT TO authenticated
  USING (organization_id = public.get_org_id());

DROP POLICY IF EXISTS csp_insert_can_edit ON public.campaign_settings_permissions;
CREATE POLICY csp_insert_can_edit ON public.campaign_settings_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND public.can_edit_campaign_settings(campaign_id)
  );

DROP POLICY IF EXISTS csp_update_can_edit ON public.campaign_settings_permissions;
CREATE POLICY csp_update_can_edit ON public.campaign_settings_permissions
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND public.can_edit_campaign_settings(campaign_id)
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND public.can_edit_campaign_settings(campaign_id)
  );

DROP POLICY IF EXISTS csp_delete_can_edit ON public.campaign_settings_permissions;
CREATE POLICY csp_delete_can_edit ON public.campaign_settings_permissions
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND public.can_edit_campaign_settings(campaign_id)
  );

-- ── A7. Reload PostgREST schema cache (exposes the two new RPCs) ──────────────
NOTIFY pgrst, 'reload schema';
