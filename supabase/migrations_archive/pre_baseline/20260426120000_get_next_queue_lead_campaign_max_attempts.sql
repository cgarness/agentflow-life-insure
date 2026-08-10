-- Enforce campaigns.max_attempts in get_next_queue_lead (Team / Open Pool).
-- NULL max_attempts = unlimited. Optional p_filters.max_attempts remains (manager queue_filters).
-- Campaign cap is mandatory; both ANDs apply when set (stricter wins).

CREATE OR REPLACE FUNCTION public.get_next_queue_lead(
  p_campaign_id UUID,
  p_filters     JSONB DEFAULT '{}'::JSONB
)
RETURNS SETOF public.campaign_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign      RECORD;
  v_locked_id     UUID;
  v_result        public.campaign_leads;
  v_team_agents   UUID[];
  v_filter_status     TEXT;
  v_filter_state      TEXT;
  v_filter_source     TEXT;
  v_filter_max_att    INTEGER;
  v_filter_min_score  INTEGER;
  v_filter_max_score  INTEGER;
BEGIN
  DELETE FROM public.dialer_lead_locks
  WHERE campaign_id = p_campaign_id
    AND expires_at <= now();

  SELECT type, assigned_agent_ids, organization_id, max_attempts
  INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id
    AND organization_id = public.get_org_id();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_filter_status    := p_filters->>'status';
  v_filter_state     := p_filters->>'state';
  v_filter_source    := p_filters->>'lead_source';
  v_filter_max_att   := (p_filters->>'max_attempts')::INTEGER;
  v_filter_min_score := (p_filters->>'min_score')::INTEGER;
  v_filter_max_score := (p_filters->>'max_score')::INTEGER;

  IF upper(v_campaign.type) = 'TEAM' THEN
    SELECT ARRAY(
      SELECT jsonb_array_elements_text(v_campaign.assigned_agent_ids)::UUID
    ) INTO v_team_agents;
  END IF;

  IF upper(v_campaign.type) = 'TEAM' THEN
    SELECT cl.id INTO v_locked_id
    FROM public.campaign_leads cl
    JOIN public.leads l ON l.id = cl.lead_id
    WHERE cl.campaign_id = p_campaign_id
      AND cl.organization_id = public.get_org_id()
      AND cl.assigned_agent_id::UUID = ANY(v_team_agents)
      AND cl.status NOT IN ('DNC', 'Completed', 'Removed')
      AND cl.id NOT IN (
        SELECT dll.lead_id
        FROM public.dialer_lead_locks dll
        WHERE dll.expires_at > now()
      )
      AND (v_filter_status IS NULL OR cl.status = v_filter_status)
      AND (v_filter_state IS NULL
           OR cl.state = v_filter_state
           OR (cl.state IS NULL AND l.state = v_filter_state))
      AND (v_filter_source IS NULL OR l.lead_source = v_filter_source)
      AND (v_filter_max_att IS NULL OR cl.call_attempts <= v_filter_max_att)
      AND (v_filter_min_score IS NULL OR l.lead_score >= v_filter_min_score)
      AND (v_filter_max_score IS NULL OR l.lead_score <= v_filter_max_score)
      AND (v_campaign.max_attempts IS NULL OR COALESCE(cl.call_attempts, 0) < v_campaign.max_attempts)
    ORDER BY cl.created_at ASC
    LIMIT 1
    FOR UPDATE OF cl SKIP LOCKED;

  ELSE
    SELECT cl.id INTO v_locked_id
    FROM public.campaign_leads cl
    JOIN public.leads l ON l.id = cl.lead_id
    WHERE cl.campaign_id = p_campaign_id
      AND cl.organization_id = public.get_org_id()
      AND cl.status NOT IN ('DNC', 'Completed', 'Removed')
      AND cl.id NOT IN (
        SELECT dll.lead_id
        FROM public.dialer_lead_locks dll
        WHERE dll.expires_at > now()
      )
      AND (v_filter_status IS NULL OR cl.status = v_filter_status)
      AND (v_filter_state IS NULL
           OR cl.state = v_filter_state
           OR (cl.state IS NULL AND l.state = v_filter_state))
      AND (v_filter_source IS NULL OR l.lead_source = v_filter_source)
      AND (v_filter_max_att IS NULL OR cl.call_attempts <= v_filter_max_att)
      AND (v_filter_min_score IS NULL OR l.lead_score >= v_filter_min_score)
      AND (v_filter_max_score IS NULL OR l.lead_score <= v_filter_max_score)
      AND (v_campaign.max_attempts IS NULL OR COALESCE(cl.call_attempts, 0) < v_campaign.max_attempts)
    ORDER BY cl.created_at ASC
    LIMIT 1
    FOR UPDATE OF cl SKIP LOCKED;
  END IF;

  IF v_locked_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.dialer_lead_locks
    (lead_id, agent_id, campaign_id, organization_id, expires_at)
  VALUES
    (v_locked_id, auth.uid(), p_campaign_id, public.get_org_id(), now() + INTERVAL '5 minutes')
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_result
  FROM public.campaign_leads
  WHERE id = v_locked_id;

  RETURN NEXT v_result;
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_next_queue_lead(UUID, JSONB) TO authenticated;
