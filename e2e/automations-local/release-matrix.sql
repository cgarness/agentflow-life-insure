-- Run after publishing the corresponding test-only single-action workflow.
-- All CRM events, admissions and reservations in this additional matrix roll back.
BEGIN;
SELECT set_config('test.agency', :'agency_id'::uuid::text, true),
       set_config('test.workflow', :'workflow_id'::uuid::text, true);
DO $$
DECLARE
  org uuid := current_setting('test.agency')::uuid;
  workflow uuid := current_setting('test.workflow')::uuid;
  existing_contact uuid := gen_random_uuid();
  new_contact uuid := gen_random_uuid();
  owner_id uuid;
  gates private.automation_release_controls;
  existing_run uuid;
  claim jsonb;
  allowed boolean;
BEGIN
  SELECT * INTO STRICT gates FROM private.automation_release_controls WHERE organization_id=org;
  SELECT created_by INTO STRICT owner_id FROM public.workflows WHERE organization_id=org AND id=workflow AND status='active';
  UPDATE private.automation_release_controls SET enrollment_enabled=true WHERE organization_id=org;
  INSERT INTO public.leads(id,organization_id,first_name,last_name,user_id,assigned_agent_id)
    VALUES (existing_contact,org,'Existing','Matrix',owner_id,owner_id);
  PERFORM public.automation_process_events(25);
  SELECT id INTO STRICT existing_run FROM private.automation_runs WHERE workflow_id=workflow AND contact_id=existing_contact;

  UPDATE private.automation_release_controls SET enrollment_enabled=gates.enrollment_enabled WHERE organization_id=org;
  INSERT INTO public.leads(id,organization_id,first_name,last_name,user_id,assigned_agent_id)
    VALUES (new_contact,org,'New','Matrix',owner_id,owner_id);
  PERFORM public.automation_process_events(25);
  IF EXISTS (SELECT FROM private.automation_runs WHERE workflow_id=workflow AND contact_id=new_contact)
       IS DISTINCT FROM gates.enrollment_enabled THEN RAISE EXCEPTION 'Enrollment disagrees with reviewed controls'; END IF;

  SELECT value INTO STRICT claim FROM public.automation_claim_work(25) value WHERE (value->>'run_id')::uuid=existing_run;
  -- This verifies the independent release gate only. No transport or provider is invoked.
  allowed:=public.automation_authorize_handoff(existing_run,(claim->>'lease_token')::uuid,claim->>'node_id');
  IF allowed IS DISTINCT FROM gates.dispatch_enabled THEN RAISE EXCEPTION 'Handoff gate disagrees with reviewed controls'; END IF;
  IF EXISTS (SELECT FROM private.automation_messages WHERE organization_id=org) THEN RAISE EXCEPTION 'Unexpected provider message'; END IF;
END $$;
ROLLBACK;
