-- Shared Team/Open queue: guard unfinished and recently finished calls even if
-- client disposition persistence has not run. No existing lead/call rows are modified.
CREATE INDEX IF NOT EXISTS idx_calls_campaign_lead_recent_outbound
  ON public.calls (campaign_lead_id, started_at DESC)
  WHERE campaign_lead_id IS NOT NULL AND direction = 'outbound';

CREATE OR REPLACE FUNCTION "public"."get_next_queue_lead"("p_campaign_id" "uuid", "p_filters" "jsonb" DEFAULT '{}'::"jsonb") RETURNS SETOF "public"."campaign_leads"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_org            uuid := public.get_org_id();
  v_uid            uuid := auth.uid();
  v_campaign       RECORD;
  v_ctype          text;
  v_locked_id      uuid;
  v_result         public.campaign_leads;
  v_claimed_id     uuid;
  v_retry_minutes  integer;
  v_filter_state   text;
  v_filter_source  text;
  v_filter_status  text;
  v_filter_max_att integer;
  v_require_licensed boolean := false;
  v_licensed_states  text[]  := '{}';
BEGIN
  DELETE FROM public.dialer_lead_locks
  WHERE campaign_id = p_campaign_id
    AND expires_at <= now();

  SELECT c.id,
         upper(trim(c.type)) AS ctype,
         c.assigned_agent_ids,
         c.organization_id,
         c.max_attempts,
         c.require_licensed_state_access,
         COALESCE(NULLIF(c.retry_interval_minutes, 0), NULLIF(c.retry_interval_hours, 0) * 60, 1440) AS retry_minutes
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id
    AND c.organization_id = v_org;

  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_ctype := v_campaign.ctype;
  v_retry_minutes := CASE WHEN v_campaign.retry_minutes > 0 THEN v_campaign.retry_minutes ELSE 1440 END;

  IF v_ctype = 'TEAM' THEN
    IF NOT (
      v_uid::text = ANY (
        ARRAY(SELECT jsonb_array_elements_text(v_campaign.assigned_agent_ids))
      )
    ) THEN
      RETURN;
    END IF;
  END IF;

  v_require_licensed := COALESCE(v_campaign.require_licensed_state_access, false);
  IF v_require_licensed THEN
    SELECT COALESCE(array_agg(DISTINCT x.s), '{}')
    INTO v_licensed_states
    FROM (
      SELECT upper(public.normalize_us_state(asl.state)) AS s
      FROM public.agent_state_licenses asl
      WHERE asl.agent_id = v_uid
        AND asl.organization_id = v_org
    ) x
    WHERE x.s ~ '^[A-Z]{2}$';
  END IF;

  v_filter_state   := NULLIF(p_filters->>'state', '');
  v_filter_source  := NULLIF(p_filters->>'lead_source', '');
  v_filter_status  := NULLIF(p_filters->>'status', '');
  v_filter_max_att := NULLIF(p_filters->>'max_attempts', '')::integer;

  SELECT cl.id
  INTO v_locked_id
  FROM public.campaign_leads cl
  JOIN public.leads l ON l.id = cl.lead_id
  WHERE cl.campaign_id = p_campaign_id
    AND cl.organization_id = v_org
    AND cl.status NOT IN ('DNC', 'Completed', 'Removed', 'Failed')
    AND (v_campaign.max_attempts IS NULL
         OR COALESCE(cl.call_attempts, 0) < v_campaign.max_attempts)
    AND (cl.retry_eligible_at IS NULL OR cl.retry_eligible_at <= now())
    -- Calls exist before the browser saves a disposition. Enforce the retry
    -- globally from the canonical call record, even when advancement failed.
    AND (
      (cl.callback_agent_id = v_uid
       AND COALESCE(cl.callback_due_at, cl.scheduled_callback_at) <= now() + interval '5 minutes')
      OR NOT EXISTS (
      SELECT 1 FROM public.calls recent
      WHERE recent.campaign_lead_id = cl.id
        AND recent.campaign_id = p_campaign_id
        AND recent.direction = 'outbound'
        AND (
          (recent.ended_at IS NOT NULL OR recent.status IN ('completed', 'no-answer', 'busy', 'failed', 'canceled'))
          AND COALESCE(recent.ended_at, recent.started_at) + make_interval(mins => v_retry_minutes) > now()
          OR
          (recent.ended_at IS NULL AND recent.status NOT IN ('completed', 'no-answer', 'busy', 'failed', 'canceled')
           AND recent.started_at > now() - interval '30 minutes')
        )
      )
    )
    AND (cl.callback_agent_id IS NULL OR cl.callback_agent_id = v_uid)
    AND (l.assigned_agent_id IS NULL OR l.assigned_agent_id = v_uid)
    AND NOT EXISTS (
      SELECT 1 FROM public.dialer_lead_locks dll
      WHERE dll.campaign_lead_id = cl.id
        AND dll.expires_at > now()
        AND dll.locked_by <> v_uid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_lead_agent_suppressions s
      WHERE s.campaign_lead_id = cl.id
        AND s.agent_id = v_uid
        AND s.suppressed_until > now()
    )
    AND (v_filter_status IS NULL OR cl.status = v_filter_status)
    AND (v_filter_state  IS NULL
         OR cl.state = v_filter_state
         OR (cl.state IS NULL AND l.state = v_filter_state))
    AND (v_filter_source IS NULL OR l.lead_source = v_filter_source)
    AND (v_filter_max_att IS NULL OR COALESCE(cl.call_attempts, 0) <= v_filter_max_att)
    AND (
      NOT v_require_licensed
      OR NULLIF(btrim(public.normalize_us_state(cl.state)), '') IS NULL
      OR upper(public.normalize_us_state(cl.state)) = ANY (v_licensed_states)
    )
  ORDER BY
    CASE
      WHEN COALESCE(cl.callback_due_at, cl.scheduled_callback_at) IS NOT NULL
           AND cl.callback_agent_id = v_uid
           AND COALESCE(cl.callback_due_at, cl.scheduled_callback_at) <= now() + interval '5 minutes'
        THEN 0
      WHEN COALESCE(cl.call_attempts, 0) = 0 THEN 1
      ELSE 2
    END,
    COALESCE(cl.callback_due_at, cl.scheduled_callback_at) ASC NULLS LAST,
    cl.last_called_at ASC NULLS FIRST,
    cl.created_at ASC
  LIMIT 1
  FOR UPDATE OF cl SKIP LOCKED;

  IF v_locked_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.dialer_lead_locks
    (campaign_lead_id, locked_by, campaign_id, organization_id, expires_at)
  VALUES
    (v_locked_id, v_uid, p_campaign_id, v_org, now() + interval '5 minutes')
  ON CONFLICT (campaign_lead_id) DO UPDATE
    SET expires_at = EXCLUDED.expires_at
    WHERE dialer_lead_locks.locked_by = EXCLUDED.locked_by
      AND dialer_lead_locks.expires_at > now()
  RETURNING campaign_lead_id INTO v_claimed_id;

  -- A conflict owned by another agent returns no row. Never hand out that lead.
  IF v_claimed_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_result FROM public.campaign_leads WHERE id = v_locked_id;
  RETURN NEXT v_result;
  RETURN;
END;
$_$;

REVOKE ALL ON FUNCTION public.get_next_queue_lead(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_queue_lead(uuid, jsonb) TO authenticated, service_role;
