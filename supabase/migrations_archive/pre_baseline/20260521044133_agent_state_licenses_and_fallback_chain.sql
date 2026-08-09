-- Phase 3a + 3b: Agent state licenses + inbound fallback chain
-- Creates the agent_state_licenses table (state-licensed agent routing) and
-- adds inbound_routing_settings.inbound_fallback_chain (configurable inbound
-- fallback waterfall). All RLS is org-scoped via public.get_org_id(); writes
-- restricted to Admin / Team Leader (super admins bypass).

-- =============================================================================
-- PART 1: agent_state_licenses
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.agent_state_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  state text NOT NULL,
  license_number text,
  expiration_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_state_licenses_agent_state_unique UNIQUE (agent_id, state)
);

COMMENT ON TABLE public.agent_state_licenses IS
  'Tracks which US states each agent is licensed to sell life insurance in. Used by the inbound fallback chain to route calls only to agents licensed in the caller''s state.';

CREATE INDEX IF NOT EXISTS idx_agent_state_licenses_agent_id
  ON public.agent_state_licenses(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_state_licenses_organization_id
  ON public.agent_state_licenses(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_state_licenses_state
  ON public.agent_state_licenses(state);

ALTER TABLE public.agent_state_licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_state_licenses_select ON public.agent_state_licenses;
CREATE POLICY agent_state_licenses_select
  ON public.agent_state_licenses
  FOR SELECT
  USING (
    organization_id = public.get_org_id()
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS agent_state_licenses_insert ON public.agent_state_licenses;
CREATE POLICY agent_state_licenses_insert
  ON public.agent_state_licenses
  FOR INSERT
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS agent_state_licenses_update ON public.agent_state_licenses;
CREATE POLICY agent_state_licenses_update
  ON public.agent_state_licenses
  FOR UPDATE
  USING (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS agent_state_licenses_delete ON public.agent_state_licenses;
CREATE POLICY agent_state_licenses_delete
  ON public.agent_state_licenses
  FOR DELETE
  USING (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

-- =============================================================================
-- PART 2: inbound_routing_settings.inbound_fallback_chain
-- =============================================================================

ALTER TABLE public.inbound_routing_settings
  ADD COLUMN IF NOT EXISTS inbound_fallback_chain jsonb
    NOT NULL
    DEFAULT '["last_agent", "campaign_agents", "all_available"]'::jsonb;

COMMENT ON COLUMN public.inbound_routing_settings.inbound_fallback_chain IS
  'Ordered JSON array of fallback tier names for inbound call routing. The webhook walks this array in order when the primary routing target is unavailable. Valid values: last_agent, campaign_agents, state_licensed, all_available. Admin configures the order and which tiers are active via the Inbound Routing settings UI.';

-- =============================================================================
-- PART 3: PostgREST schema reload
-- =============================================================================

NOTIFY pgrst, 'reload schema';
