-- Workflow Trigger Expansion | 7 → 22 trigger types.
-- ---------------------------------------------------------------------------
-- Adds Postgres event triggers for: appointments (INSERT + UPDATE), messages
-- (inbound SMS), dnc_list (INSERT), clients (INSERT for lead_converted). Also
-- rewrites the existing calls trigger (call_completed + call_missed) and the
-- leads trigger (contact_field_changed). Updates the matching RPC so the
-- evaluator can fan out workflow_keys for the new types.
--
-- All dispatches go through public.workflow_dispatch_event(); failures are
-- swallowed by RAISE WARNING so CRM writes never block on automation infra.

-- ---------------------------------------------------------------------------
-- 1. Expand workflows.trigger_type CHECK constraint
-- ---------------------------------------------------------------------------
ALTER TABLE public.workflows DROP CONSTRAINT IF EXISTS workflows_trigger_type_check;
ALTER TABLE public.workflows ADD CONSTRAINT workflows_trigger_type_check CHECK (trigger_type IN (
  'disposition', 'stage_change', 'lead_created', 'time_based', 'manual',
  'tag_added', 'tag_removed',
  'call_completed', 'call_missed',
  'appointment_booked', 'appointment_cancelled', 'appointment_no_show',
  'sms_received', 'email_replied',
  'lead_converted', 'contact_field_changed', 'contact_dnc',
  'birthday_approaching', 'custom_date_approaching', 'stale_lead',
  'task_completed', 'task_overdue'
));

-- ---------------------------------------------------------------------------
-- 2. Rewrite get_active_workflows_for_trigger to support new trigger_keys.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_active_workflows_for_trigger(
  p_org_id        uuid,
  p_trigger_type  text,
  p_trigger_key   text DEFAULT NULL
)
RETURNS SETOF public.workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT w.*
  FROM public.workflows w
  WHERE w.organization_id = p_org_id
    AND w.status = 'active'
    AND w.trigger_type = p_trigger_type
    AND (
      p_trigger_key IS NULL
      OR (w.trigger_config ->> 'disposition_id')   = p_trigger_key
      OR (w.trigger_config ->> 'to_stage_id')      = p_trigger_key
      OR (w.trigger_config ->> 'tag')              = p_trigger_key
      OR (w.trigger_config ->> 'field_name')       = p_trigger_key
      OR (w.trigger_config ->> 'appointment_type') = p_trigger_key
      -- sms_received: trigger_key is the message body; match if keyword_filter
      -- is set AND body contains the keyword (case-insensitive). If no filter
      -- is configured, match any body.
      OR (
        p_trigger_type = 'sms_received'
        AND COALESCE(w.trigger_config ->> 'keyword_filter', '') = ''
      )
      OR (
        p_trigger_type = 'sms_received'
        AND COALESCE(w.trigger_config ->> 'keyword_filter', '') <> ''
        AND p_trigger_key ILIKE '%' || (w.trigger_config ->> 'keyword_filter') || '%'
      )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_workflows_for_trigger(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_active_workflows_for_trigger(uuid, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Rewrite handle_lead_workflow_events: add contact_field_changed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_lead_workflow_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_tags    text[];
  v_new_tags    text[];
  v_added_tag   text;
  v_removed_tag text;
  v_has_tags    boolean;
  v_field       text;
  v_old_val     text;
  v_new_val     text;
  v_tracked_fields text[] := ARRAY[
    'first_name', 'last_name', 'email', 'phone', 'state',
    'lead_source', 'assigned_agent_id'
  ];
BEGIN
  -- INSERT → lead_created
  IF TG_OP = 'INSERT' THEN
    PERFORM public.workflow_dispatch_event(
      NEW.organization_id,
      'lead_created',
      NULL,
      NEW.id,
      'lead',
      jsonb_build_object('source', to_jsonb(NEW) ->> 'lead_source')
    );
    RETURN NEW;
  END IF;

  -- UPDATE
  IF TG_OP = 'UPDATE' THEN
    -- stage_change
    IF NEW.pipeline_stage_id IS DISTINCT FROM OLD.pipeline_stage_id
       AND NEW.pipeline_stage_id IS NOT NULL THEN
      PERFORM public.workflow_dispatch_event(
        NEW.organization_id,
        'stage_change',
        NEW.pipeline_stage_id::text,
        NEW.id,
        'lead',
        jsonb_build_object(
          'old_stage_id', OLD.pipeline_stage_id,
          'new_stage_id', NEW.pipeline_stage_id
        )
      );
    END IF;

    -- contact_field_changed: one dispatch per tracked field that changed
    FOREACH v_field IN ARRAY v_tracked_fields LOOP
      v_old_val := to_jsonb(OLD) ->> v_field;
      v_new_val := to_jsonb(NEW) ->> v_field;
      IF v_old_val IS DISTINCT FROM v_new_val THEN
        PERFORM public.workflow_dispatch_event(
          NEW.organization_id,
          'contact_field_changed',
          v_field,
          NEW.id,
          'lead',
          jsonb_build_object(
            'field', v_field,
            'old_value', v_old_val,
            'new_value', v_new_val
          )
        );
      END IF;
    END LOOP;

    -- tag_added / tag_removed (guarded — column may not exist on leads)
    v_has_tags := (to_jsonb(NEW) ? 'tags');
    IF v_has_tags THEN
      BEGIN
        v_old_tags := COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(to_jsonb(OLD) -> 'tags')),
          ARRAY[]::text[]
        );
        v_new_tags := COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(to_jsonb(NEW) -> 'tags')),
          ARRAY[]::text[]
        );
      EXCEPTION WHEN OTHERS THEN
        v_old_tags := ARRAY[]::text[];
        v_new_tags := ARRAY[]::text[];
      END;

      FOREACH v_added_tag IN ARRAY v_new_tags LOOP
        IF NOT (v_added_tag = ANY (v_old_tags)) THEN
          PERFORM public.workflow_dispatch_event(
            NEW.organization_id,
            'tag_added',
            v_added_tag,
            NEW.id,
            'lead',
            jsonb_build_object('tag', v_added_tag)
          );
        END IF;
      END LOOP;

      FOREACH v_removed_tag IN ARRAY v_old_tags LOOP
        IF NOT (v_removed_tag = ANY (v_new_tags)) THEN
          PERFORM public.workflow_dispatch_event(
            NEW.organization_id,
            'tag_removed',
            v_removed_tag,
            NEW.id,
            'lead',
            jsonb_build_object('tag', v_removed_tag)
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Rewrite handle_call_workflow_events: add call_completed + call_missed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_call_workflow_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id      uuid;
  v_contact_id  uuid;
  v_disp        text;
  v_disp_name   text;
  v_status      text;
  v_duration    int;
  v_is_missed   boolean;
BEGIN
  v_org_id     := NULLIF(to_jsonb(NEW) ->> 'organization_id', '')::uuid;
  v_contact_id := NULLIF(to_jsonb(NEW) ->> 'contact_id', '')::uuid;
  -- Fall back to lead_id if contact_id is null (the dialer stores both).
  IF v_contact_id IS NULL THEN
    v_contact_id := NULLIF(to_jsonb(NEW) ->> 'lead_id', '')::uuid;
  END IF;
  v_disp       := NULLIF(to_jsonb(NEW) ->> 'disposition_id', '');
  v_disp_name  := to_jsonb(NEW) ->> 'disposition_name';
  v_status     := COALESCE(to_jsonb(NEW) ->> 'status', '');
  v_duration   := COALESCE((to_jsonb(NEW) ->> 'duration')::int, 0);
  v_is_missed  := COALESCE((to_jsonb(NEW) ->> 'is_missed')::boolean, false);

  IF v_org_id IS NULL OR v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- disposition (preserved)
  IF v_disp IS NOT NULL THEN
    PERFORM public.workflow_dispatch_event(
      v_org_id, 'disposition', v_disp, v_contact_id, 'lead',
      jsonb_build_object(
        'disposition_id',   v_disp,
        'disposition_name', v_disp_name
      )
    );
  END IF;

  -- call_completed: fires for every call insert that resolves to a contact
  PERFORM public.workflow_dispatch_event(
    v_org_id, 'call_completed', NULL, v_contact_id, 'lead',
    jsonb_build_object(
      'duration', v_duration,
      'status',   v_status,
      'is_missed', v_is_missed,
      'disposition_id', v_disp
    )
  );

  -- call_missed: when explicitly missed OR status indicates no answer OR zero duration
  IF v_is_missed
     OR v_status IN ('no-answer', 'no_answer', 'missed')
     OR v_duration = 0 THEN
    PERFORM public.workflow_dispatch_event(
      v_org_id, 'call_missed', NULL, v_contact_id, 'lead',
      jsonb_build_object(
        'status',   v_status,
        'duration', v_duration,
        'is_missed', v_is_missed
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. handle_appointment_workflow_events: INSERT + UPDATE on appointments
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_appointment_workflow_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  IF TG_OP = 'INSERT' THEN
    PERFORM public.workflow_dispatch_event(
      v_org_id, 'appointment_booked', v_appt_type, v_contact_id, 'lead',
      jsonb_build_object(
        'appointment_id', NEW.id,
        'appointment_type', v_appt_type,
        'start_time', to_jsonb(NEW) ->> 'start_time'
      )
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_status_old := COALESCE(to_jsonb(OLD) ->> 'status', '');
    IF v_status_new IS DISTINCT FROM v_status_old THEN
      v_status_lc := lower(v_status_new);
      IF v_status_lc IN ('cancelled', 'canceled') THEN
        PERFORM public.workflow_dispatch_event(
          v_org_id, 'appointment_cancelled', v_appt_type, v_contact_id, 'lead',
          jsonb_build_object(
            'appointment_id', NEW.id,
            'appointment_type', v_appt_type
          )
        );
      ELSIF v_status_lc IN ('no_show', 'no-show', 'noshow') THEN
        PERFORM public.workflow_dispatch_event(
          v_org_id, 'appointment_no_show', v_appt_type, v_contact_id, 'lead',
          jsonb_build_object(
            'appointment_id', NEW.id,
            'appointment_type', v_appt_type
          )
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_appointment_insert_trigger ON public.appointments;
CREATE TRIGGER workflow_appointment_insert_trigger
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.handle_appointment_workflow_events();

DROP TRIGGER IF EXISTS workflow_appointment_update_trigger ON public.appointments;
CREATE TRIGGER workflow_appointment_update_trigger
  AFTER UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.handle_appointment_workflow_events();

-- ---------------------------------------------------------------------------
-- 6. handle_message_workflow_events: inbound SMS only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_message_workflow_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- trigger_key carries the body so the RPC can match keyword_filter via ILIKE
  PERFORM public.workflow_dispatch_event(
    v_org_id, 'sms_received', v_body, v_contact_id, 'lead',
    jsonb_build_object(
      'message_id', NEW.id,
      'body', v_body
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_message_insert_trigger ON public.messages;
CREATE TRIGGER workflow_message_insert_trigger
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_message_workflow_events();

-- ---------------------------------------------------------------------------
-- 7. handle_dnc_workflow_events: dnc_list INSERT → contact_dnc
-- ---------------------------------------------------------------------------
-- dnc_list has no contact_id; we resolve it from leads by phone match.
CREATE OR REPLACE FUNCTION public.handle_dnc_workflow_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  SELECT id INTO v_contact_id
  FROM public.leads
  WHERE organization_id = v_org_id AND phone = v_phone
  LIMIT 1;

  IF v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.workflow_dispatch_event(
    v_org_id, 'contact_dnc', NULL, v_contact_id, 'lead',
    jsonb_build_object(
      'phone_number', v_phone,
      'reason', to_jsonb(NEW) ->> 'reason'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_dnc_insert_trigger ON public.dnc_list;
CREATE TRIGGER workflow_dnc_insert_trigger
  AFTER INSERT ON public.dnc_list
  FOR EACH ROW EXECUTE FUNCTION public.handle_dnc_workflow_events();

-- ---------------------------------------------------------------------------
-- 8. handle_client_workflow_events: clients INSERT → lead_converted
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_client_workflow_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id    uuid;
  v_lead_id   uuid;
BEGIN
  v_org_id  := NULLIF(to_jsonb(NEW) ->> 'organization_id', '')::uuid;
  v_lead_id := NULLIF(to_jsonb(NEW) ->> 'lead_id', '')::uuid;

  IF v_org_id IS NULL OR v_lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.workflow_dispatch_event(
    v_org_id, 'lead_converted', NULL, v_lead_id, 'lead',
    jsonb_build_object(
      'client_id', NEW.id,
      'policy_type', to_jsonb(NEW) ->> 'policy_type'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_client_insert_trigger ON public.clients;
CREATE TRIGGER workflow_client_insert_trigger
  AFTER INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.handle_client_workflow_events();

NOTIFY pgrst, 'reload schema';
