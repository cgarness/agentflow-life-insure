-- Separately approved operator operation. Supply exactly one agency_id and action=show or hide.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';
SELECT set_config('agentflow.release_agency', :'agency_id'::uuid::text, true) AS agency,
       set_config('agentflow.release_action', :'action', true) AS action \gset

DO $$
DECLARE
  agency uuid := current_setting('agentflow.release_agency')::uuid;
  action text := current_setting('agentflow.release_action');
  controls private.automation_release_controls;
  cutoff timestamptz;
BEGIN
  IF action NOT IN ('show','hide') OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=agency) THEN
    RAISE EXCEPTION 'Supply an existing agency UUID and show or hide.';
  END IF;
  IF action='show' THEN
    -- Seal the rollout once the compatible UI and PostgREST RPCs have been verified.
    -- Sessions opened while the older bundle or schema cache was still served remain fenced.
    SELECT visibility_cutover_at INTO STRICT cutoff FROM private.automation_session_cutover WHERE singleton FOR UPDATE;
    IF cutoff IS NULL THEN
      LOCK TABLE private.automation_release_controls IN SHARE ROW EXCLUSIVE MODE;
      IF EXISTS (SELECT FROM private.automation_release_controls WHERE builder_visible OR enrollment_enabled OR dispatch_enabled) THEN
        RAISE EXCEPTION 'First visibility cutover requires all agency controls to be off.';
      END IF;
      UPDATE private.automation_session_cutover SET visibility_cutover_at=clock_timestamp() WHERE singleton;
    END IF;
    INSERT INTO private.automation_release_controls (organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
      VALUES (agency,false,false,false) ON CONFLICT (organization_id) DO NOTHING;
  END IF;
  SELECT * INTO controls FROM private.automation_release_controls WHERE organization_id=agency FOR UPDATE;
  IF FOUND THEN
    IF controls.enrollment_enabled OR controls.dispatch_enabled THEN
      RAISE EXCEPTION 'This operation requires enrollment and sending to be off. Review the live execution controls separately.';
    END IF;
    UPDATE private.automation_release_controls SET builder_visible=(action='show') WHERE organization_id=agency;
  END IF;
END $$;

SELECT o.id AS organization_id, coalesce(c.builder_visible,false) AS builder_visible,
       coalesce(c.enrollment_enabled,false) AS enrollment_enabled, coalesce(c.dispatch_enabled,false) AS dispatch_enabled
  FROM public.organizations o LEFT JOIN private.automation_release_controls c ON c.organization_id=o.id
 WHERE o.id=current_setting('agentflow.release_agency')::uuid;
COMMIT;
