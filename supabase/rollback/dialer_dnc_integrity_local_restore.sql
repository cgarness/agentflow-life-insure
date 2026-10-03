-- LOCAL RESTORE FIXTURE ONLY. NEVER a production rollback.
-- Drops synthetic-test receipts/metadata only on disposable localhost test databases.
DO $$ BEGIN
 IF inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_database() NOT LIKE 'dnc_test_%'
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator','supabase_auth_admin')) THEN
   RAISE EXCEPTION 'REFUSING: local DNC test database required';
 END IF;
END $$;
DROP TRIGGER calls_guard_dialer_core ON public.calls;
DROP TRIGGER campaign_leads_guard_dialer_core ON public.campaign_leads;
DROP TRIGGER campaign_leads_capture_conversion_lineage ON public.campaign_leads;
DROP TRIGGER dnc_phone_identity_guard ON public.dnc_list;
DROP FUNCTION public.advance_campaign_lead(uuid,uuid,uuid,timestamptz,text,boolean,uuid,text,uuid,bigint,text);
DROP FUNCTION public.get_personal_queue_leads(uuid,integer,integer);
DROP FUNCTION public.check_dialer_dnc(text,uuid);
DROP FUNCTION public.admit_twilio_outbound(uuid,text,text,text,text);
DROP FUNCTION public.get_outbound_admission(uuid);
DROP FUNCTION public.force_release_campaign_lead_lock(uuid);
DROP FUNCTION private.guard_dialer_core_write();
DROP FUNCTION private.capture_dialer_conversion_lineage();
DROP FUNCTION private.try_queue_phone(uuid,text,text);
DROP FUNCTION private.guard_dnc_phone();
DROP FUNCTION private.is_dnc_phone(uuid,text);
DROP FUNCTION private.dnc_phone_lock_key(uuid,text);
DROP TABLE private.dialer_conversion_lineage;
DROP TABLE private.dialer_outbound_admissions;
DROP TABLE private.dialer_disposition_receipts;
DROP INDEX public.dnc_list_org_canonical_phone_idx;
ALTER TABLE public.campaign_leads DROP COLUMN disposition_version;
ALTER TABLE public.calls DROP COLUMN dialer_admission_required;
REVOKE EXECUTE ON FUNCTION private.phone_digits_e164ish(text) FROM authenticated, service_role;
GRANT TRUNCATE ON public.dnc_list TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.advance_campaign_lead(p_campaign_lead_id uuid, p_call_id uuid DEFAULT NULL::uuid, p_disposition_id uuid DEFAULT NULL::uuid, p_callback_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_callback_note text DEFAULT NULL::text, p_release_lock boolean DEFAULT true)
 RETURNS campaign_leads
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
  v_campaign_action text;
  v_dnc_auto_add    boolean := false;
  v_callback_sched  boolean := false;
  v_appt_sched      boolean := false;
  v_is_convert      boolean := false;
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

  SELECT * INTO v_cl
  FROM public.campaign_leads
  WHERE id = p_campaign_lead_id
    AND organization_id = v_org
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

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

  v_already := (p_call_id IS NOT NULL
                AND v_cl.last_advance_call_id IS NOT DISTINCT FROM p_call_id);
  v_new_attempts := COALESCE(v_cl.call_attempts, 0) + (CASE WHEN v_already THEN 0 ELSE 1 END);

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
    v_retry_at := now() + make_interval(mins => v_retry_minutes);
    IF v_max_attempts IS NOT NULL AND v_new_attempts >= v_max_attempts THEN
      v_status := 'Completed';
    ELSE
      v_status := 'Called';
    END IF;
  END IF;

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

  IF p_release_lock THEN
    PERFORM public.release_lead_lock(p_campaign_lead_id);
  END IF;

  RETURN v_result;
END;
$function$
;

ALTER FUNCTION public.advance_campaign_lead(p_campaign_lead_id uuid, p_call_id uuid, p_disposition_id uuid, p_callback_due_at timestamp with time zone, p_callback_note text, p_release_lock boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.advance_campaign_lead(p_campaign_lead_id uuid, p_call_id uuid, p_disposition_id uuid, p_callback_due_at timestamp with time zone, p_callback_note text, p_release_lock boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.advance_campaign_lead(p_campaign_lead_id uuid, p_call_id uuid, p_disposition_id uuid, p_callback_due_at timestamp with time zone, p_callback_note text, p_release_lock boolean) TO authenticated;

GRANT EXECUTE ON FUNCTION public.advance_campaign_lead(p_campaign_lead_id uuid, p_call_id uuid, p_disposition_id uuid, p_callback_due_at timestamp with time zone, p_callback_note text, p_release_lock boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.can_dial_campaign(p_campaign_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor    RECORD;
  v_campaign public.campaigns%ROWTYPE;
  v_type     text;
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    SELECT * INTO v_actor FROM private.campaign_actor();
  EXCEPTION WHEN OTHERS THEN
    RETURN false;  -- unauthenticated / inactive / no-org / org mismatch → fail closed
  END;

  SELECT * INTO v_campaign
    FROM public.campaigns
   WHERE id = p_campaign_id
     AND organization_id = v_actor.org_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_type := upper(btrim(COALESCE(v_campaign.type, '')));

  IF v_type IN ('OPEN POOL', 'OPEN') THEN
    RETURN true;
  END IF;

  IF v_type = 'PERSONAL' THEN
    RETURN v_campaign.user_id = v_actor.uid;   -- owner only. No admin/viewAll escape.
  END IF;

  IF v_type = 'TEAM' THEN
    RETURN v_actor.uid::text IN (
      SELECT jsonb_array_elements_text(COALESCE(v_campaign.assigned_agent_ids, '[]'::jsonb))
    );
  END IF;

  RETURN false;
END;
$function$
;

ALTER FUNCTION public.can_dial_campaign(p_campaign_id uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.can_dial_campaign(p_campaign_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.can_dial_campaign(p_campaign_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.can_dial_campaign(p_campaign_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_lead(p_campaign_lead_id uuid, p_lead_id uuid, p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
BEGIN
  v_org_id := public.get_org_id();

  IF NOT EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE id = p_campaign_id AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'claim_lead: campaign not found or org mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_leads
    WHERE id = p_campaign_lead_id
      AND campaign_id = p_campaign_id
      AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'claim_lead: campaign_lead not found or org mismatch';
  END IF;

  UPDATE public.leads
  SET assigned_agent_id = auth.uid(),
      updated_at        = now()
  WHERE id              = p_lead_id
    AND organization_id = v_org_id;
END;
$function$
;

ALTER FUNCTION public.claim_lead(p_campaign_lead_id uuid, p_lead_id uuid, p_campaign_id uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.claim_lead(p_campaign_lead_id uuid, p_lead_id uuid, p_campaign_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.claim_lead(p_campaign_lead_id uuid, p_lead_id uuid, p_campaign_id uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_lead(p_campaign_lead_id uuid, p_lead_id uuid, p_campaign_id uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.claim_lead(p_campaign_lead_id uuid, p_lead_id uuid, p_campaign_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.claim_lead(p_campaign_lead_id uuid, p_lead_id uuid, p_campaign_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fetch_and_lock_next_lead(p_campaign_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS SETOF campaign_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- DEPRECATED (Build 1): legacy alias retained for compatibility.
  -- All claim/lock logic now lives in public.get_next_queue_lead.
  RETURN QUERY SELECT * FROM public.get_next_queue_lead(p_campaign_id, p_filters);
END;
$function$
;

ALTER FUNCTION public.fetch_and_lock_next_lead(p_campaign_id uuid, p_filters jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.fetch_and_lock_next_lead(p_campaign_id uuid, p_filters jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.fetch_and_lock_next_lead(p_campaign_id uuid, p_filters jsonb) TO anon;

GRANT EXECUTE ON FUNCTION public.fetch_and_lock_next_lead(p_campaign_id uuid, p_filters jsonb) TO authenticated;

GRANT EXECUTE ON FUNCTION public.fetch_and_lock_next_lead(p_campaign_id uuid, p_filters jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_next_queue_lead(p_campaign_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS SETOF campaign_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    (campaign_lead_id, locked_by, campaign_id, organization_id, expires_at, queue_issued_at)
  VALUES
    (v_locked_id, v_uid, p_campaign_id, v_org, now() + interval '5 minutes', now())
  ON CONFLICT (campaign_lead_id) DO UPDATE
    SET expires_at = EXCLUDED.expires_at,
        queue_issued_at = EXCLUDED.queue_issued_at
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
$function$
;

ALTER FUNCTION public.get_next_queue_lead(p_campaign_id uuid, p_filters jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_next_queue_lead(p_campaign_id uuid, p_filters jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_next_queue_lead(p_campaign_id uuid, p_filters jsonb) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_next_queue_lead(p_campaign_id uuid, p_filters jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_queue_metrics(p_campaign_id uuid)
 RETURNS TABLE(total_leads integer, eligible_leads integer, locked_leads integer, active_agents integer, available_leads integer, suppressed_for_current_agent integer, retry_blocked_leads integer, callback_waiting_leads integer, next_eligible_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org            uuid := public.get_org_id();
  v_uid            uuid := auth.uid();
  v_campaign       RECORD;
  v_ctype          text;
  -- Manager queue_filters (same supported keys as get_next_queue_lead).
  v_filter_state   text;
  v_filter_source  text;
  v_filter_status  text;
  v_filter_max_att integer;
BEGIN
  -- Load campaign, org-scoped (incl. queue_filters so metrics match the claim path).
  SELECT c.id,
         upper(trim(c.type))    AS ctype,
         c.assigned_agent_ids,
         c.organization_id,
         c.max_attempts,
         c.queue_filters
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id
    AND c.organization_id = v_org;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0, 0, 0, 0, NULL::timestamptz;
    RETURN;
  END IF;
  v_ctype := v_campaign.ctype;

  -- Parse the stored manager filters (tolerant; absent/empty key = no filter).
  -- Mirrors get_next_queue_lead exactly. min_score/max_score are intentionally
  -- NOT applied here because the canonical claim RPC does not apply them either.
  v_filter_state   := NULLIF(v_campaign.queue_filters->>'state', '');
  v_filter_source  := NULLIF(v_campaign.queue_filters->>'lead_source', '');
  v_filter_status  := NULLIF(v_campaign.queue_filters->>'status', '');
  v_filter_max_att := NULLIF(v_campaign.queue_filters->>'max_attempts', '')::integer;

  -- TEAM eligibility gate: caller must be assigned. Return only the non-
  -- agent-specific total so the panel can still say "N total / 0 available".
  IF v_ctype = 'TEAM'
     AND NOT (
       v_uid::text = ANY (
         ARRAY(SELECT jsonb_array_elements_text(v_campaign.assigned_agent_ids))
       )
     ) THEN
    RETURN QUERY
      SELECT (SELECT count(*)::int
                FROM public.campaign_leads cl
               WHERE cl.campaign_id = p_campaign_id
                 AND cl.organization_id = v_org),
             0, 0, 0, 0, 0, 0, 0, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT cl.id,
           cl.status,
           cl.call_attempts,
           cl.retry_eligible_at,
           cl.callback_agent_id,
           cl.callback_due_at,
           cl.scheduled_callback_at,
           cl.state           AS cl_state,
           l.state            AS lead_state,
           l.lead_source      AS lead_source,
           l.assigned_agent_id AS lead_assigned_agent_id
    FROM public.campaign_leads cl
    JOIN public.leads l ON l.id = cl.lead_id
    WHERE cl.campaign_id = p_campaign_id
      AND cl.organization_id = v_org
  ),
  locks AS (
    SELECT dll.campaign_lead_id, dll.locked_by, dll.expires_at
    FROM public.dialer_lead_locks dll
    WHERE dll.campaign_id = p_campaign_id
      AND dll.expires_at > now()
  ),
  supp AS (
    SELECT s.campaign_lead_id, s.suppressed_until
    FROM public.campaign_lead_agent_suppressions s
    WHERE s.campaign_id = p_campaign_id
      AND s.agent_id = v_uid
      AND s.suppressed_until > now()
  ),
  enriched AS (
    SELECT b.*,
      (b.status NOT IN ('DNC','Completed','Removed','Failed')
        AND (v_campaign.max_attempts IS NULL
             OR COALESCE(b.call_attempts, 0) < v_campaign.max_attempts)
        -- manager queue_filters — same supported keys as get_next_queue_lead
        AND (v_filter_status IS NULL OR b.status = v_filter_status)
        AND (v_filter_state  IS NULL
             OR b.cl_state = v_filter_state
             OR (b.cl_state IS NULL AND b.lead_state = v_filter_state))
        AND (v_filter_source IS NULL OR b.lead_source = v_filter_source)
        AND (v_filter_max_att IS NULL
             OR COALESCE(b.call_attempts, 0) <= v_filter_max_att)
      )                                                            AS is_eligible_universe,
      (b.callback_agent_id IS NULL OR b.callback_agent_id = v_uid) AS callback_ok,
      (b.lead_assigned_agent_id IS NULL
        OR b.lead_assigned_agent_id = v_uid)                       AS lead_ok,
      EXISTS (SELECT 1 FROM locks lk
               WHERE lk.campaign_lead_id = b.id
                 AND lk.locked_by <> v_uid)                        AS locked_by_other,
      EXISTS (SELECT 1 FROM supp sp
               WHERE sp.campaign_lead_id = b.id)                   AS suppressed_me
    FROM base b
  )
  SELECT
    (SELECT count(*)::int FROM base)                                AS total_leads,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe)                                  AS eligible_leads,
    (SELECT count(*)::int FROM locks)                               AS locked_leads,
    (SELECT count(DISTINCT locked_by)::int FROM locks)             AS active_agents,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe
         AND callback_ok AND lead_ok
         AND NOT locked_by_other AND NOT suppressed_me
         AND (retry_eligible_at IS NULL OR retry_eligible_at <= now())
    )                                                              AS available_leads,
    (SELECT count(*)::int FROM supp)                               AS suppressed_for_current_agent,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe
         AND callback_ok AND lead_ok
         AND NOT locked_by_other AND NOT suppressed_me
         AND retry_eligible_at IS NOT NULL AND retry_eligible_at > now()
    )                                                              AS retry_blocked_leads,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe
         AND callback_agent_id = v_uid
         AND COALESCE(callback_due_at, scheduled_callback_at) IS NOT NULL
         AND COALESCE(callback_due_at, scheduled_callback_at) > now()
    )                                                              AS callback_waiting_leads,
    (SELECT min(t) FROM (
        SELECT retry_eligible_at AS t FROM enriched
          WHERE is_eligible_universe AND callback_ok AND lead_ok
            AND NOT locked_by_other AND NOT suppressed_me
            AND retry_eligible_at IS NOT NULL AND retry_eligible_at > now()
        UNION ALL
        SELECT COALESCE(callback_due_at, scheduled_callback_at) FROM enriched
          WHERE is_eligible_universe AND callback_agent_id = v_uid
            AND COALESCE(callback_due_at, scheduled_callback_at) > now()
        UNION ALL
        SELECT suppressed_until FROM supp
        UNION ALL
        SELECT lk.expires_at FROM locks lk
          JOIN enriched e ON e.id = lk.campaign_lead_id
          WHERE lk.locked_by <> v_uid
            AND e.is_eligible_universe AND e.callback_ok AND e.lead_ok
            AND NOT e.suppressed_me
            AND (e.retry_eligible_at IS NULL OR e.retry_eligible_at <= now())
    ) future_times WHERE t > now())                                AS next_eligible_at;
END;
$function$
;

ALTER FUNCTION public.get_queue_metrics(p_campaign_id uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_queue_metrics(p_campaign_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_queue_metrics(p_campaign_id uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.get_queue_metrics(p_campaign_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_queue_metrics(p_campaign_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.release_all_agent_locks(p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.dialer_lead_locks
  WHERE campaign_id = p_campaign_id
    AND locked_by = auth.uid();
END;
$function$
;

ALTER FUNCTION public.release_all_agent_locks(p_campaign_id uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.release_all_agent_locks(p_campaign_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.release_all_agent_locks(p_campaign_id uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.release_all_agent_locks(p_campaign_id uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.release_all_agent_locks(p_campaign_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.release_all_agent_locks(p_campaign_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.release_lead_lock(p_campaign_lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.dialer_lead_locks
  WHERE campaign_lead_id = p_campaign_lead_id
    AND locked_by = auth.uid();
END;
$function$
;

ALTER FUNCTION public.release_lead_lock(p_campaign_lead_id uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.release_lead_lock(p_campaign_lead_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.release_lead_lock(p_campaign_lead_id uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.release_lead_lock(p_campaign_lead_id uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.release_lead_lock(p_campaign_lead_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.release_lead_lock(p_campaign_lead_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.renew_lead_lock(p_campaign_lead_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.dialer_lead_locks
  SET expires_at = now() + interval '5 minutes'
  WHERE campaign_lead_id = p_campaign_lead_id
    AND locked_by = auth.uid()
    AND organization_id = public.get_org_id();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$
;

ALTER FUNCTION public.renew_lead_lock(p_campaign_lead_id uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.renew_lead_lock(p_campaign_lead_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.renew_lead_lock(p_campaign_lead_id uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.renew_lead_lock(p_campaign_lead_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.renew_lead_lock(p_campaign_lead_id uuid) TO service_role;