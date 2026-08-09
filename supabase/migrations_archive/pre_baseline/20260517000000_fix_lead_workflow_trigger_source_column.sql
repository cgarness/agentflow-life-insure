-- BUGFIX: Lead CSV import failed with "record 'new' has no field 'source'".
-- Root cause (live DB, 2026-05-17): AFTER INSERT on public.leads uses
--   trg_workflow_lead_created -> public.workflow_on_lead_created(),
--   which referenced NEW.source. Column on leads is lead_source.
-- public.handle_lead_workflow_events() was already correct (to_jsonb path)
-- but is not the function attached to current insert trigger — align INSERT
-- metadata to NEW.lead_source for consistency.
--
-- Note: workflow_lead_insert_trigger does not exist on production; only DROP
-- is included so stale envs don't keep a duplicate path. We do NOT CREATE it
-- here because that would double-fire lead_created alongside trg_workflow_lead_created.

-- ---------------------------------------------------------------------------
-- 1. Fix the live insert trigger target (authoritative fix for import).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_on_lead_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  PERFORM private.workflow_dispatch_event(
    NEW.organization_id,
    'lead_created',
    NULL,
    NEW.id,
    'lead',
    jsonb_build_object('source', NEW.lead_source)
  );
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Align handle_lead_workflow_events INSERT branch (matches live body; JSON
--    metadata key remains 'source' for the workflow evaluator).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_lead_workflow_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF TG_OP = 'INSERT' THEN
    PERFORM public.workflow_dispatch_event(
      NEW.organization_id, 'lead_created', NULL, NEW.id, 'lead',
      jsonb_build_object('source', NEW.lead_source)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.pipeline_stage_id IS DISTINCT FROM OLD.pipeline_stage_id
       AND NEW.pipeline_stage_id IS NOT NULL THEN
      PERFORM public.workflow_dispatch_event(
        NEW.organization_id, 'stage_change', NEW.pipeline_stage_id::text, NEW.id, 'lead',
        jsonb_build_object('old_stage_id', OLD.pipeline_stage_id, 'new_stage_id', NEW.pipeline_stage_id)
      );
    END IF;

    FOREACH v_field IN ARRAY v_tracked_fields LOOP
      v_old_val := to_jsonb(OLD) ->> v_field;
      v_new_val := to_jsonb(NEW) ->> v_field;
      IF v_old_val IS DISTINCT FROM v_new_val THEN
        PERFORM public.workflow_dispatch_event(
          NEW.organization_id, 'contact_field_changed', v_field, NEW.id, 'lead',
          jsonb_build_object('field', v_field, 'old_value', v_old_val, 'new_value', v_new_val)
        );
      END IF;
    END LOOP;

    v_has_tags := (to_jsonb(NEW) ? 'tags');
    IF v_has_tags THEN
      BEGIN
        v_old_tags := COALESCE(ARRAY(SELECT jsonb_array_elements_text(to_jsonb(OLD) -> 'tags')), ARRAY[]::text[]);
        v_new_tags := COALESCE(ARRAY(SELECT jsonb_array_elements_text(to_jsonb(NEW) -> 'tags')), ARRAY[]::text[]);
      EXCEPTION WHEN OTHERS THEN
        v_old_tags := ARRAY[]::text[]; v_new_tags := ARRAY[]::text[];
      END;

      FOREACH v_added_tag IN ARRAY v_new_tags LOOP
        IF NOT (v_added_tag = ANY (v_old_tags)) THEN
          PERFORM public.workflow_dispatch_event(
            NEW.organization_id, 'tag_added', v_added_tag, NEW.id, 'lead',
            jsonb_build_object('tag', v_added_tag)
          );
        END IF;
      END LOOP;

      FOREACH v_removed_tag IN ARRAY v_old_tags LOOP
        IF NOT (v_removed_tag = ANY (v_new_tags)) THEN
          PERFORM public.workflow_dispatch_event(
            NEW.organization_id, 'tag_removed', v_removed_tag, NEW.id, 'lead',
            jsonb_build_object('tag', v_removed_tag)
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS workflow_lead_insert_trigger ON public.leads;

NOTIFY pgrst, 'reload schema';
