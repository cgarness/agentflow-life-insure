-- Agency group leaderboard: true "today" period + read-only peer org access for badges/fire/wins.

CREATE OR REPLACE FUNCTION public.is_agency_group_peer_organization(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agency_group_members m1
    INNER JOIN public.agency_group_members m2
      ON m1.agency_group_id = m2.agency_group_id
      AND m2.status = 'active'
    WHERE m1.organization_id = public.get_org_id()
      AND m1.status = 'active'
      AND m2.organization_id = p_org_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_agency_group_peer_organization(uuid) TO authenticated;

-- Wins: allow SELECT for same agency group peer organizations (leaderboard group view).
DROP POLICY IF EXISTS wins_select ON public.wins;

CREATE POLICY wins_select ON public.wins
FOR SELECT TO authenticated
USING (
  organization_id = public.get_user_org_id()
  OR public.is_agency_group_peer_organization(organization_id)
);

-- Calls: read-only SELECT for peer orgs in the same agency group (badge / fire computation).
DROP POLICY IF EXISTS "Calls Agency Group Peer Read" ON public.calls;

CREATE POLICY "Calls Agency Group Peer Read" ON public.calls
FOR SELECT TO authenticated
USING (public.is_agency_group_peer_organization(organization_id));

-- Scorecards: read-only SELECT for peer org agents (Top Performer badge).
DROP POLICY IF EXISTS "agent_scorecards_agency_group_peer_read" ON public.agent_scorecards;

CREATE POLICY "agent_scorecards_agency_group_peer_read" ON public.agent_scorecards
FOR SELECT TO authenticated
USING (public.is_agency_group_peer_organization(organization_id));

-- Extend group leaderboard RPC with "today" using caller org timezone from company_settings.
CREATE OR REPLACE FUNCTION public.get_agency_group_leaderboard(
  p_group_id UUID,
  p_period TEXT DEFAULT 'month'
)
RETURNS TABLE (
  organization_id UUID,
  organization_name TEXT,
  agent_id UUID,
  agent_first_name TEXT,
  agent_last_name TEXT,
  agent_avatar_url TEXT,
  calls_made BIGINT,
  appointments_set BIGINT,
  policies_sold BIGINT,
  talk_time_seconds BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_org UUID;
  v_period_start TIMESTAMPTZ;
  v_is_member BOOLEAN;
  v_tz TEXT;
BEGIN
  v_caller_org := public.get_org_id();

  SELECT EXISTS (
    SELECT 1 FROM public.agency_group_members
    WHERE agency_group_id = p_group_id
      AND organization_id = v_caller_org
      AND status = 'active'
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Access denied: your organization is not an active member of this group';
  END IF;

  SELECT COALESCE(cs.timezone, 'UTC')
  INTO v_tz
  FROM public.company_settings cs
  WHERE cs.organization_id = v_caller_org
  LIMIT 1;

  v_period_start := CASE lower(COALESCE(p_period, 'month'))
    WHEN 'today' THEN (date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz)
    WHEN 'week' THEN date_trunc('week', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz
    WHEN 'month' THEN date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz
    WHEN 'quarter' THEN date_trunc('quarter', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz
    WHEN 'year' THEN date_trunc('year', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz
    ELSE date_trunc('month', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz
  END;

  RETURN QUERY
  SELECT
    p.organization_id,
    o.name AS organization_name,
    p.id AS agent_id,
    p.first_name AS agent_first_name,
    p.last_name AS agent_last_name,
    p.avatar_url AS agent_avatar_url,
    COALESCE(c.calls_made, 0)::BIGINT AS calls_made,
    COALESCE(a.appointments_set, 0)::BIGINT AS appointments_set,
    COALESCE(cl.policies_sold, 0)::BIGINT AS policies_sold,
    COALESCE(c.talk_time_seconds, 0)::BIGINT AS talk_time_seconds
  FROM public.profiles p
  INNER JOIN public.organizations o ON o.id = p.organization_id
  INNER JOIN public.agency_group_members agm
    ON agm.organization_id = p.organization_id
    AND agm.agency_group_id = p_group_id
    AND agm.status = 'active'
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::BIGINT AS calls_made,
      COALESCE(SUM(cc.duration), 0)::BIGINT AS talk_time_seconds
    FROM public.calls cc
    WHERE cc.agent_id = p.id
      AND cc.created_at >= v_period_start
  ) c ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::BIGINT AS appointments_set
    FROM public.appointments ap
    WHERE ap.user_id = p.id
      AND ap.created_at >= v_period_start
  ) a ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::BIGINT AS policies_sold
    FROM public.clients cli
    WHERE cli.assigned_agent_id = p.id
      AND cli.created_at >= v_period_start
  ) cl ON TRUE
  WHERE p.role IN ('Agent', 'Team Leader', 'Team Lead', 'Admin')
    AND p.status = 'Active'
  ORDER BY policies_sold DESC, calls_made DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_agency_group_leaderboard(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
