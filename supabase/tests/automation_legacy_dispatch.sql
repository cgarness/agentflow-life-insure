-- Isolated builder-only release. All workflow definitions and CRM events roll back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.fid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('ae540000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.expect(ok boolean, explanation text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',explanation; END IF; END $$;
UPDATE private.automation_session_cutover SET visibility_cutover_at=installed_at WHERE visibility_cutover_at IS NULL;
INSERT INTO public.organizations(id,name) VALUES(pg_temp.fid(1),'Isolated legacy dispatch');
INSERT INTO auth.users(id,email) VALUES(pg_temp.fid(2),'dispatch-author@example.invalid');
INSERT INTO public.profiles(id,organization_id,role,status,email)
  VALUES(pg_temp.fid(2),pg_temp.fid(1),'Admin','Active','dispatch-author@example.invalid')
  ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,role=excluded.role,status=excluded.status;
INSERT INTO auth.sessions(id,user_id,created_at) VALUES(pg_temp.fid(3),pg_temp.fid(2),clock_timestamp());
INSERT INTO private.automation_release_controls(organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
  VALUES(pg_temp.fid(1),true,false,false);
INSERT INTO public.campaigns(id,organization_id,user_id,name) VALUES(pg_temp.fid(4),pg_temp.fid(1),pg_temp.fid(2),'Fixture campaign');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',pg_temp.fid(2)::text,true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fid(2),'session_id',pg_temp.fid(3),
  'role','authenticated','app_metadata',jsonb_build_object('organization_id',pg_temp.fid(1)))::text,true);
DO $$
DECLARE
  rev bigint := (public.automation_session_context()->>'revision')::bigint;
  fixture record;
  graph jsonb;
  published jsonb;
BEGIN
  FOR fixture IN SELECT * FROM (VALUES
    (pg_temp.fid(10),'lead_created','{}'::jsonb),
    (pg_temp.fid(11),'campaign_membership_created',jsonb_build_object('campaign_id',pg_temp.fid(4)))
  ) AS scenarios(id,trigger_type,config) LOOP
    graph := jsonb_build_object('format',1,'settings','{"reentry":"once","stop_on_reply":false}'::jsonb,
      'nodes',jsonb_build_array(jsonb_build_object('id',pg_temp.fid(20),'version',1,'type',fixture.trigger_type,'config',fixture.config),
        jsonb_build_object('id',pg_temp.fid(21),'version',1,'type','send_sms','config','{"purpose":"informational","body":"Fixture"}'::jsonb)),
      'edges',jsonb_build_array(jsonb_build_object('id',pg_temp.fid(22),'source',pg_temp.fid(20),'target',pg_temp.fid(21))));
    PERFORM public.save_automation_draft(fixture.id,'Isolation '||fixture.trigger_type,graph,0,rev);
    published := public.publish_automation(fixture.id,1,rev,'{"enrollment_enabled":false,"dispatch_enabled":false}');
    PERFORM pg_temp.expect(published->>'status'='active' AND published->>'trigger_type'=fixture.trigger_type
      AND published->'release_controls'='{"enrollment_enabled":false,"dispatch_enabled":false}'::jsonb,
      'Expected active version with enrollment and dispatch disabled');
  END LOOP;
END $$;
RESET ROLE;
-- Use the deployed evaluator's actual RPC under its own role. The positive controls
-- ensure its lead_created and manual matches still work for the original graph format.
INSERT INTO public.workflows(id,organization_id,name,status,trigger_type,created_by) VALUES
  (pg_temp.fid(30),pg_temp.fid(1),'Legacy lead','active','lead_created',pg_temp.fid(2)),
  (pg_temp.fid(31),pg_temp.fid(1),'Legacy manual','active','manual',pg_temp.fid(2));
SET LOCAL ROLE service_role;
SELECT pg_temp.expect(ARRAY(SELECT id FROM public.get_active_workflows_for_trigger(pg_temp.fid(1),'lead_created',NULL))=ARRAY[pg_temp.fid(30)],
  'Deployed evaluator matched a versioned lead workflow');
SELECT pg_temp.expect(ARRAY(SELECT id FROM public.get_active_workflows_for_trigger(pg_temp.fid(1),'manual',NULL))=ARRAY[pg_temp.fid(31)],
  'Legacy manual event matched a versioned campaign workflow');
SELECT pg_temp.expect(NOT EXISTS(SELECT FROM public.get_active_workflows_for_trigger(pg_temp.fid(1),'campaign_membership_created',NULL)),
  'Versioned membership trigger unexpectedly exists in the legacy dispatcher');
RESET ROLE;
INSERT INTO public.leads(id,organization_id,user_id,first_name) VALUES(pg_temp.fid(5),pg_temp.fid(1),pg_temp.fid(2),'Synthetic');
INSERT INTO public.campaign_leads(id,campaign_id,lead_id,organization_id) VALUES(pg_temp.fid(6),pg_temp.fid(4),pg_temp.fid(5),pg_temp.fid(1));
SELECT pg_temp.expect((SELECT array_agg(trigger_type ORDER BY id) FROM public.workflows
    WHERE id IN (pg_temp.fid(10),pg_temp.fid(11)) AND automation_graph IS NOT NULL AND automation_version_id IS NOT NULL)
    =ARRAY['lead_created','manual']::text[], 'Unexpected legacy header or absent version');
SELECT pg_temp.expect(NOT EXISTS(SELECT FROM public.workflow_nodes WHERE workflow_id IN (pg_temp.fid(10),pg_temp.fid(11)))
  AND NOT EXISTS(SELECT FROM public.workflow_edges WHERE workflow_id IN (pg_temp.fid(10),pg_temp.fid(11)))
  AND NOT EXISTS(SELECT FROM public.workflow_executions WHERE workflow_id IN (pg_temp.fid(10),pg_temp.fid(11))),
  'Legacy executor or resume worker has a graph or execution to process');
SELECT pg_temp.expect(NOT EXISTS(SELECT FROM private.automation_events WHERE organization_id=pg_temp.fid(1))
  AND NOT EXISTS(SELECT FROM private.automation_intake_recovery WHERE organization_id=pg_temp.fid(1))
  AND NOT EXISTS(SELECT FROM private.automation_runs WHERE organization_id=pg_temp.fid(1))
  AND NOT EXISTS(SELECT FROM private.automation_messages WHERE organization_id=pg_temp.fid(1)),
  'Builder-only release captured intake or produced runtime work');
ROLLBACK;
