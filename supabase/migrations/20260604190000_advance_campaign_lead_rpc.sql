-- ============================================================================
-- Auto-dial redial loop fix — single canonical campaign_leads advancement path
-- ============================================================================
-- Root cause: every client-side campaign_leads UPDATE from the dialer silently
-- affected 0 rows. An UPDATE that references a column (WHERE id = …) requires the
-- row to ALSO pass the SELECT policy; the Open Pool / Team agent SELECT branch
-- needs get_user_role() = 'Agent', and get_user_role() reads ONLY the JWT
-- app_metadata.role claim with NO profiles fallback (unlike get_org_id()). A
-- stale/missing role claim => row invisible => UPDATE rows=0, no error. So
-- call_attempts / last_called_at / retry_eligible_at / callback fields / terminal
-- status never persisted, and get_next_queue_lead re-served the same lead.
--
-- Fix: ONE SECURITY DEFINER RPC, org-scoped via get_org_id() (which HAS the
-- profiles fallback), that persists the campaign_leads advancement exactly once
-- per call. Invoked identically by the auto No-Answer and manual Save paths.
--
-- Twilio remains the sole writer of calls.duration — this function NEVER touches
-- calls or any Twilio-owned telemetry.
-- ============================================================================

-- Idempotency key: ties an attempt increment to a specific calls.id so a given
-- call advances the lead exactly once even if the path runs twice.
ALTER TABLE public.campaign_leads
  ADD COLUMN IF NOT EXISTS last_advance_call_id uuid;

-- DROP guard (prior signatures, if any).
DROP FUNCTION IF EXISTS public.advance_campaign_lead(uuid, uuid, uuid, timestamptz, boolean);
DROP FUNCTION IF EXISTS public.advance_campaign_lead(uuid, uuid, uuid, timestamptz, text, boolean);

CREATE OR REPLACE FUNCTION public.advance_campaign_lead(
  p_campaign_lead_id uuid,
  p_call_id          uuid          DEFAULT NULL,
  p_disposition_id   uuid          DEFAULT NULL,
  p_callback_due_at  timestamptz   DEFAULT NULL,
  p_callback_note    text          DEFAULT NULL,
  p_release_lock     boolean       DEFAULT true
)
RETURNS public.campaign_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org           uuid := public.get_org_id();
  v_uid           uuid := auth.uid();
  v_cl            public.campaign_leads;
  v_max_attempts  integer;
  v_retry_minutes integer;
  -- disposition flags
  v_campaign_action text;
  v_dnc_auto_add    boolean := false;
  v_callback_sched  boolean := false;
  v_appt_sched      boolean := false;
  v_is_convert      boolean := false;
  -- computed
  v_already       boolean;
  v_new_attempts  integer;
  v_status        text;
  v_retry_at      timestamptz;
  v_cb_due        timestamptz := NULL;
  v_cb_sched      timestamptz := NULL;
  v_cb_agent      uuid := NULL;
  v_cb_note       text := NULL;
  v_result        public.campaign_leads;
BEGIN
  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;

  -- (1) Lock the target campaign_leads row, org-scoped. Never cross-org.
  SELECT * INTO v_cl
  FROM public.campaign_leads
  WHERE id = p_campaign_lead_id
    AND organization_id = v_org
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- (2) Campaign retry/cap config (canonical retry_interval_minutes; legacy fallbacks).
  SELECT c.max_attempts,
         COALESCE(NULLIF(c.retry_interval_minutes, 0),
                  NULLIF(c.retry_interval_hours, 0) * 60,
                  1440)
  INTO v_max_attempts, v_retry_minutes
  FROM public.campaigns c
  WHERE c.id = v_cl.campaign_id
    AND c.organization_id = v_org;

  IF v_retry_minutes IS NULL OR v_retry_minutes <= 0 THEN
    v_retry_minutes := 1440;
  END IF;

  -- (3) Disposition flags (org-scoped) — authoritative server-side classification.
  IF p_disposition_id IS NOT NULL THEN
    SELECT d.campaign_action,
           COALESCE(d.dnc_auto_add, false),
           COALESCE(d.callback_scheduler, false),
           COALESCE(d.appointment_scheduler, false),
           COALESCE(ps.convert_to_client, false)
    INTO v_campaign_action, v_dnc_auto_add, v_callback_sched, v_appt_sched, v_is_convert
    FROM public.dispositions d
    LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id
    WHERE d.id = p_disposition_id
      AND d.organization_id = v_org;
  END IF;

  -- (4) Idempotent attempt increment, tied to the call id.
  v_already := (p_call_id IS NOT NULL
                AND v_cl.last_advance_call_id IS NOT DISTINCT FROM p_call_id);
  v_new_attempts := COALESCE(v_cl.call_attempts, 0) + (CASE WHEN v_already THEN 0 ELSE 1 END);

  -- (5) Classify outcome → status / retry / callback fields.
  --     Mirrors the frontend isTerminalOrOwned logic, server-authoritative.
  IF v_is_convert THEN
    v_status := 'Completed';  v_retry_at := NULL;
  ELSIF v_dnc_auto_add THEN
    v_status := 'DNC';        v_retry_at := NULL;
  ELSIF v_campaign_action = 'remove_from_campaign' THEN
    v_status := 'Removed';    v_retry_at := NULL;
  ELSIF v_callback_sched THEN
    v_status := 'Called';     v_retry_at := NULL;
    v_cb_due := p_callback_due_at;  v_cb_sched := p_callback_due_at;  v_cb_agent := v_uid;
    v_cb_note := NULLIF(btrim(COALESCE(p_callback_note, '')), '');
  ELSIF v_appt_sched THEN
    v_status := 'Called';     v_retry_at := NULL;
  ELSE
    -- Retryable actual call (No Answer / Busy / Failed / Voicemail / generic).
    v_retry_at := now() + make_interval(mins => v_retry_minutes);
    IF v_max_attempts IS NOT NULL AND v_new_attempts >= v_max_attempts THEN
      v_status := 'Completed';  -- cap reached → terminal so the selector stops it
    ELSE
      v_status := 'Called';
    END IF;
  END IF;

  -- (6) Single canonical persistence write. NEVER touches calls.duration / Twilio.
  UPDATE public.campaign_leads
  SET call_attempts       = v_new_attempts,
      last_called_at      = now(),
      retry_eligible_at   = v_retry_at,
      status              = v_status,
      callback_due_at     = v_cb_due,
      scheduled_callback_at = v_cb_sched,
      callback_agent_id   = v_cb_agent,
      callback_note       = v_cb_note,
      last_advance_call_id = COALESCE(p_call_id, last_advance_call_id),
      updated_at          = now()
  WHERE id = p_campaign_lead_id
    AND organization_id = v_org
  RETURNING * INTO v_result;

  -- (7) Release the caller's lock when requested (Save Only keeps it).
  IF p_release_lock THEN
    PERFORM public.release_lead_lock(p_campaign_lead_id);
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.advance_campaign_lead(uuid, uuid, uuid, timestamptz, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_campaign_lead(uuid, uuid, uuid, timestamptz, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
