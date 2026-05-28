-- HOTFIX: Dialer Disposition Reliability + Workflow Trigger Hardening
-- ===========================================================================
-- Invariant established here:
--   Workflow automation must NEVER block core CRM writes. Workflow dispatch
--   errors are logged via RAISE WARNING and swallowed; appointments, calls,
--   leads, clients, DNC, notes, and campaign-lead saves must still commit.
--
-- Root causes fixed (confirmed against live prod jncvvsvckxhqgqvkppmj):
--   1. Live triggers on appointments/dnc_list/clients/messages call
--      public.workflow_dispatch_event(...) which does NOT exist (only the
--      private.* variant exists) -> the trigger raises -> the core INSERT
--      rolls back. This kills Callback, Appointment, DNC auto-add, and
--      Convert saves and leaves Team/Open queue locks stuck.
--   2. workflow_on_lead_updated() references OLD/NEW.pipeline_stage_id and
--      OLD/NEW.tags -- NEITHER column exists on public.leads -> every leads
--      UPDATE errors.
--   3. campaign_leads_status_check rejects 'Removed' and 'DNC', which the
--      disposition lifecycle writes (Remove-from-Campaign, DNC).
--   4. public.claim_lead(...) (Team/Open hard claim RPC) is missing.
--
-- Scope guard: NO change to calls.duration, twilio-voice-status,
-- twilio-voice-webhook, answerOnBridge, Twilio architecture, or queue
-- SKIP-LOCKED RPCs. This migration only creates/replaces workflow dispatch
-- + trigger functions, recreates claim_lead, and widens one CHECK constraint.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. public.workflow_dispatch_event — safe wrapper delegating to private.*
-- ---------------------------------------------------------------------------
-- The four live handle_*_workflow_events triggers call public.* (which was
-- missing). Create it as a self-swallowing wrapper to the existing private.*
-- implementation so a dispatch failure can never abort the triggering write.
CREATE OR REPLACE FUNCTION public.workflow_dispatch_event(
  p_org_id       uuid,
  p_trigger_type text,
  p_trigger_key  text,
  p_contact_id   uuid,
  p_contact_type text,
  p_metadata     jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM private.workflow_dispatch_event(
      p_org_id, p_trigger_type, p_trigger_key, p_contact_id, p_contact_type, p_metadata
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'workflow_dispatch_event wrapper failed (% / %): %',
      p_trigger_type, p_contact_id, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_dispatch_event(uuid, text, text, uuid, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.workflow_dispatch_event(uuid, text, text, uuid, text, jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Trigger hardening — wrap every dispatch so failures never block writes.
--    Bodies are preserved verbatim from live prod except the dispatch region
--    is wrapped in BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING.
-- ---------------------------------------------------------------------------

-- 2a. appointments (INSERT + UPDATE) -> appointment_booked/cancelled/no_show
CREATE OR REPLACE FUNCTION public.handle_appointment_workflow_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id       uuid;
  v_contact_id   uuid;
  v_appt_type    text;
  v_status_new   text;
  v_status_old   text;
  v_status_lc    text;
BEGIN
  v_org_id     := NULLIF(to_jsonb(NEW) ->> 'organization_id', '')::uuid;
  v_contact_id := NULLIF(to_jsonb(NEW) ->> 'contact_id', '')::uuid;
  v_appt_type  := to_jsonb(NEW) ->> 'type';
  v_status_new := COALESCE(to_jsonb(NEW) ->> 'status', '');

  IF v_org_id IS NULL OR v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.workflow_dispatch_event(
        v_org_id, 'appointment_booked', v_appt_type, v_contact_id, 'lead',
        jsonb_build_object('appointment_id', NEW.id, 'appointment_type', v_appt_type, 'start_time', to_jsonb(NEW) ->> 'start_time')
      );
    ELSIF TG_OP = 'UPDATE' THEN
      v_status_old := COALESCE(to_jsonb(OLD) ->> 'status', '');
      IF v_status_new IS DISTINCT FROM v_status_old THEN
        v_status_lc := lower(v_status_new);
        IF v_status_lc IN ('cancelled', 'canceled') THEN
          PERFORM public.workflow_dispatch_event(
            v_org_id, 'appointment_cancelled', v_appt_type, v_contact_id, 'lead',
            jsonb_build_object('appointment_id', NEW.id, 'appointment_type', v_appt_type)
          );
        ELSIF v_status_lc IN ('no_show', 'no-show', 'noshow') THEN
          PERFORM public.workflow_dispatch_event(
            v_org_id, 'appointment_no_show', v_appt_type, v_contact_id, 'lead',
            jsonb_build_object('appointment_id', NEW.id, 'appointment_type', v_appt_type)
          );
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_appointment_workflow_events dispatch failed (appt %): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- 2b. dnc_list (INSERT) -> contact_dnc
CREATE OR REPLACE FUNCTION public.handle_dnc_workflow_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id     uuid;
  v_phone      text;
  v_contact_id uuid;
BEGIN
  v_org_id := NULLIF(to_jsonb(NEW) ->> 'organization_id', '')::uuid;
  v_phone  := NULLIF(to_jsonb(NEW) ->> 'phone_number', '');

  IF v_org_id IS NULL OR v_phone IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT id INTO v_contact_id
    FROM public.leads
    WHERE organization_id = v_org_id AND phone = v_phone
    LIMIT 1;

    IF v_contact_id IS NOT NULL THEN
      PERFORM public.workflow_dispatch_event(
        v_org_id, 'contact_dnc', NULL, v_contact_id, 'lead',
        jsonb_build_object('phone_number', v_phone, 'reason', to_jsonb(NEW) ->> 'reason')
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_dnc_workflow_events dispatch failed (phone %): %', v_phone, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- 2c. messages (INSERT, inbound only) -> sms_received
CREATE OR REPLACE FUNCTION public.handle_message_workflow_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id      uuid;
  v_contact_id  uuid;
  v_direction   text;
  v_body        text;
BEGIN
  v_direction := COALESCE(to_jsonb(NEW) ->> 'direction', '');
  IF v_direction <> 'inbound' THEN
    RETURN NEW;
  END IF;

  v_org_id := NULLIF(to_jsonb(NEW) ->> 'organization_id', '')::uuid;
  v_contact_id := NULLIF(to_jsonb(NEW) ->> 'lead_id', '')::uuid;
  IF v_contact_id IS NULL THEN
    v_contact_id := NULLIF(to_jsonb(NEW) ->> 'contact_id', '')::uuid;
  END IF;
  v_body := COALESCE(to_jsonb(NEW) ->> 'body', '');

  IF v_org_id IS NULL OR v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.workflow_dispatch_event(
      v_org_id, 'sms_received', v_body, v_contact_id, 'lead',
      jsonb_build_object('message_id', NEW.id, 'body', v_body)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_message_workflow_events dispatch failed (msg %): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- 2d. clients (INSERT) -> lead_converted
CREATE OR REPLACE FUNCTION public.handle_client_workflow_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id    uuid;
  v_lead_id   uuid;
BEGIN
  v_org_id  := NULLIF(to_jsonb(NEW) ->> 'organization_id', '')::uuid;
  v_lead_id := NULLIF(to_jsonb(NEW) ->> 'lead_id', '')::uuid;

  IF v_org_id IS NULL OR v_lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.workflow_dispatch_event(
      v_org_id, 'lead_converted', NULL, v_lead_id, 'lead',
      jsonb_build_object('client_id', NEW.id, 'policy_type', to_jsonb(NEW) ->> 'policy_type')
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_client_workflow_events dispatch failed (client %): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- 2e. calls (INSERT) -> disposition  (preserve private.* call, wrap it)
CREATE OR REPLACE FUNCTION public.workflow_on_call_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  BEGIN
    IF NEW.disposition_id IS NOT NULL AND NEW.contact_id IS NOT NULL THEN
      PERFORM private.workflow_dispatch_event(
        NEW.organization_id,
        'disposition',
        NEW.disposition_id::text,
        NEW.contact_id,
        'lead',
        jsonb_build_object('disposition_id', NEW.disposition_id)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'workflow_on_call_created dispatch failed (call %): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

-- 2f. leads (INSERT) -> lead_created  (preserve private.* call, wrap it)
CREATE OR REPLACE FUNCTION public.workflow_on_lead_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  BEGIN
    PERFORM private.workflow_dispatch_event(
      NEW.organization_id,
      'lead_created',
      NULL,
      NEW.id,
      'lead',
      jsonb_build_object('source', NEW.lead_source)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'workflow_on_lead_created dispatch failed (lead %): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

-- 2g. leads (UPDATE) -> stage_change / tag_added / tag_removed
-- FIX: public.leads has NO pipeline_stage_id and NO tags columns, so the prior
-- body raised "record has no field" on every leads UPDATE. Guard both via
-- to_jsonb key-existence (future-proof if the columns are ever added) and wrap
-- the whole dispatch region so it can never abort a leads UPDATE.
CREATE OR REPLACE FUNCTION public.workflow_on_lead_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_old_tags text[];
  v_new_tags text[];
  v_tag      text;
  v_old_stage text;
  v_new_stage text;
BEGIN
  BEGIN
    -- Stage change (only if the column actually exists on leads)
    IF (to_jsonb(NEW) ? 'pipeline_stage_id') THEN
      v_old_stage := to_jsonb(OLD) ->> 'pipeline_stage_id';
      v_new_stage := to_jsonb(NEW) ->> 'pipeline_stage_id';
      IF v_old_stage IS DISTINCT FROM v_new_stage AND v_new_stage IS NOT NULL THEN
        PERFORM private.workflow_dispatch_event(
          NEW.organization_id,
          'stage_change',
          v_new_stage,
          NEW.id,
          'lead',
          jsonb_build_object('old_stage_id', v_old_stage, 'new_stage_id', v_new_stage)
        );
      END IF;
    END IF;

    -- Tag changes (only if the column actually exists on leads)
    IF (to_jsonb(NEW) ? 'tags') THEN
      v_old_tags := COALESCE(ARRAY(SELECT jsonb_array_elements_text(to_jsonb(OLD) -> 'tags')), ARRAY[]::text[]);
      v_new_tags := COALESCE(ARRAY(SELECT jsonb_array_elements_text(to_jsonb(NEW) -> 'tags')), ARRAY[]::text[]);

      FOREACH v_tag IN ARRAY v_new_tags LOOP
        IF NOT (v_tag = ANY(v_old_tags)) THEN
          PERFORM private.workflow_dispatch_event(
            NEW.organization_id, 'tag_added', v_tag, NEW.id, 'lead',
            jsonb_build_object('tag', v_tag)
          );
        END IF;
      END LOOP;

      FOREACH v_tag IN ARRAY v_old_tags LOOP
        IF NOT (v_tag = ANY(v_new_tags)) THEN
          PERFORM private.workflow_dispatch_event(
            NEW.organization_id, 'tag_removed', v_tag, NEW.id, 'lead',
            jsonb_build_object('tag', v_tag)
          );
        END IF;
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'workflow_on_lead_updated dispatch failed (lead %): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. public.claim_lead — recreate missing Team/Open hard-claim RPC.
--    Signature matches the frontend caller (useHardClaim.ts) and the original
--    hard_claim_engine migration: (p_campaign_lead_id, p_lead_id, p_campaign_id).
--    Writes leads.assigned_agent_id ONLY (never campaign_leads.assigned_agent_id).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_lead(
  p_campaign_lead_id  uuid,
  p_lead_id           uuid,
  p_campaign_id       uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Transfer ownership: write ONLY to leads.assigned_agent_id
  UPDATE public.leads
  SET assigned_agent_id = auth.uid(),
      updated_at        = now()
  WHERE id              = p_lead_id
    AND organization_id = v_org_id;
  -- Non-fatal if the lead row wasn't found: silently no-op.
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_lead(uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. campaign_leads_status_check — allow disposition-lifecycle statuses.
--    Preserve the existing 7 values; add 'Removed' (Remove-from-Campaign) and
--    'DNC' (DNC disposition). No further loosening.
-- ---------------------------------------------------------------------------
ALTER TABLE public.campaign_leads DROP CONSTRAINT IF EXISTS campaign_leads_status_check;
ALTER TABLE public.campaign_leads ADD CONSTRAINT campaign_leads_status_check
  CHECK (status = ANY (ARRAY[
    'Queued', 'Locked', 'Claimed', 'Called', 'Skipped', 'Completed', 'Failed',
    'Removed', 'DNC'
  ]));

NOTIFY pgrst, 'reload schema';
