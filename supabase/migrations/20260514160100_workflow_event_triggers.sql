-- Workflow Builder | Postgres event triggers
-- Fires workflow-trigger-evaluator (Edge Function) via pg_net on:
--   * INSERT  on leads          → lead_created
--   * UPDATE  on leads          → stage_change / tag_added / tag_removed
--   * INSERT  on calls          → disposition  (calls is the live dialer table
--                                   that actually carries disposition_id +
--                                   contact_id; call_logs does not)
--
-- All dispatches go through public.workflow_dispatch_event(), which reads
-- private.workflow_engine_config and pg_nets the Edge Function. Failures are
-- swallowed via RAISE WARNING so workflow infrastructure never blocks a CRM
-- write.

-- ---------------------------------------------------------------------------
-- 1. dispatch helper
-- ---------------------------------------------------------------------------
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
DECLARE
  v_url      text;
  v_secret   text;
  v_endpoint text;
BEGIN
  IF p_org_id IS NULL OR p_contact_id IS NULL OR p_trigger_type IS NULL THEN
    RETURN;
  END IF;

  SELECT supabase_url, workflow_internal_secret
    INTO v_url, v_secret
    FROM private.workflow_engine_config WHERE id = 1;

  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING 'workflow_dispatch_event: private.workflow_engine_config not populated; skipping (% / %)', p_trigger_type, p_contact_id;
    RETURN;
  END IF;

  v_endpoint := rtrim(v_url, '/') || '/functions/v1/workflow-trigger-evaluator';

  BEGIN
    PERFORM net.http_post(
      url := v_endpoint,
      headers := jsonb_build_object(
        'Content-Type',      'application/json',
        'X-Workflow-Secret', v_secret
      ),
      body := jsonb_build_object(
        'organization_id', p_org_id,
        'trigger_type',    p_trigger_type,
        'trigger_key',     p_trigger_key,
        'contact_id',      p_contact_id,
        'contact_type',    COALESCE(p_contact_type, 'lead'),
        'metadata',        COALESCE(p_metadata, '{}'::jsonb)
      ),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'workflow_dispatch_event pg_net failed (% / %): %', p_trigger_type, p_contact_id, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_dispatch_event(uuid, text, text, uuid, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.workflow_dispatch_event(uuid, text, text, uuid, text, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. leads trigger function
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
BEGIN
  -- INSERT → lead_created
  IF TG_OP = 'INSERT' THEN
    PERFORM public.workflow_dispatch_event(
      NEW.organization_id,
      'lead_created',
      NULL,
      NEW.id,
      'lead',
      jsonb_build_object('source', to_jsonb(NEW) ->> 'source')
    );
    RETURN NEW;
  END IF;

  -- UPDATE: stage_change
  IF TG_OP = 'UPDATE' THEN
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

    -- tag_added / tag_removed (guarded — column may not exist on leads yet)
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

      -- Added: in new, not in old
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

      -- Removed: in old, not in new
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

DROP TRIGGER IF EXISTS workflow_lead_insert_trigger ON public.leads;
CREATE TRIGGER workflow_lead_insert_trigger
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.handle_lead_workflow_events();

DROP TRIGGER IF EXISTS workflow_lead_update_trigger ON public.leads;
CREATE TRIGGER workflow_lead_update_trigger
  AFTER UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.handle_lead_workflow_events();

-- ---------------------------------------------------------------------------
-- 3. calls trigger function (disposition)
-- ---------------------------------------------------------------------------
-- NOTE: The spec wording said "on call_logs", but disposition_id + contact_id
-- live on public.calls (the dialer's primary log table). call_logs is a
-- minimal analytics table that lacks those columns. Attaching here is the
-- correct surface for dispatching disposition workflow events.
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
BEGIN
  -- Defensive lookups via to_jsonb so missing columns don't fail the trigger.
  v_org_id     := NULLIF(to_jsonb(NEW) ->> 'organization_id', '')::uuid;
  v_contact_id := NULLIF(to_jsonb(NEW) ->> 'contact_id', '')::uuid;
  v_disp       := NULLIF(to_jsonb(NEW) ->> 'disposition_id', '');
  v_disp_name  := to_jsonb(NEW) ->> 'disposition_name';

  IF v_disp IS NULL OR v_contact_id IS NULL OR v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.workflow_dispatch_event(
    v_org_id,
    'disposition',
    v_disp,
    v_contact_id,
    'lead',
    jsonb_build_object(
      'disposition_id',   v_disp,
      'disposition_name', v_disp_name
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_call_insert_trigger ON public.calls;
CREATE TRIGGER workflow_call_insert_trigger
  AFTER INSERT ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.handle_call_workflow_events();

NOTIFY pgrst, 'reload schema';
