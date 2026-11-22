-- Isolated synthetic organization. Every definition and version rolls back.
BEGIN;
UPDATE private.automation_session_cutover SET visibility_cutover_at=installed_at WHERE visibility_cutover_at IS NULL;
CREATE FUNCTION pg_temp.aid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('aee00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION pg_temp.require(ok boolean, explanation text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed: %',explanation; END IF; END $$;
CREATE FUNCTION pg_temp.denied(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege OR serialization_failure OR invalid_parameter_value OR SQLSTATE 'PT409' THEN RETURN;
  END;
  RAISE EXCEPTION 'Unexpectedly allowed: %',statement;
END $$;
INSERT INTO public.organizations(id,name) VALUES(pg_temp.aid(1),'Authoring fixtures'),(pg_temp.aid(2),'Foreign fixtures');
INSERT INTO auth.users(id,email) SELECT pg_temp.aid(n),'fixture-'||n||'@example.invalid' FROM generate_series(10,12)n;
INSERT INTO public.profiles (id,organization_id,role,status,email)
  SELECT pg_temp.aid(n),pg_temp.aid(CASE WHEN n=12 THEN 2 ELSE 1 END),CASE WHEN n=11 THEN 'Agent' ELSE 'Admin' END,
    'Active','fixture-'||n||'@example.invalid' FROM generate_series(10,12)n
  ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,role=excluded.role,status='Active';
INSERT INTO auth.sessions(id,user_id,created_at) SELECT pg_temp.aid(n+10),pg_temp.aid(n),clock_timestamp() FROM generate_series(10,12)n;
CREATE FUNCTION pg_temp.session(actor integer) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',pg_temp.aid(actor)::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.aid(actor),'role','authenticated','session_id',pg_temp.aid(actor+10),
    'app_metadata',jsonb_build_object('organization_id',pg_temp.aid(CASE WHEN actor=12 THEN 2 ELSE 1 END)))::text,true);
  RETURN (public.automation_session_context()->>'revision')::bigint;
END $$;
CREATE FUNCTION pg_temp.sms_graph(body text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('format',1,'settings','{"reentry":"once","stop_on_reply":false}'::jsonb,
    'nodes',jsonb_build_array(jsonb_build_object('type','lead_created','version',1,'id',pg_temp.aid(70),'config','{}'::jsonb),
      jsonb_build_object('type','send_sms','version',1,'id',pg_temp.aid(71),'config',jsonb_build_object('purpose','informational','body',body))),
    'edges',jsonb_build_array(jsonb_build_object('id',pg_temp.aid(72),'source',pg_temp.aid(70),'target',pg_temp.aid(71))))
$$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.session(10);
SELECT pg_temp.require(public.automation_access()='{"can_author":false,"visible":false}'::jsonb,'controls default off');
SELECT pg_temp.denied('select public.save_automation_draft(pg_temp.aid(80),''Before release'',pg_temp.sms_graph(''test''),0,pg_temp.session(10))');
RESET ROLE;
INSERT INTO private.automation_release_controls(organization_id,builder_visible) VALUES (pg_temp.aid(1),true),(pg_temp.aid(2),true);
INSERT INTO public.workflow_folders(id,organization_id,name) VALUES (pg_temp.aid(60),pg_temp.aid(2),'Foreign folder');
SET LOCAL ROLE authenticated;
DO $$
DECLARE s bigint:=pg_temp.session(10); doc uuid:=pg_temp.aid(80); copy jsonb:=pg_temp.sms_graph('Hi {{first_name}}');
  invalid jsonb; issues jsonb; version_one uuid; version_two uuid; f jsonb; confirmed jsonb; bad_controls jsonb;
  switches jsonb:='{"enrollment_enabled":false,"dispatch_enabled":false}';
BEGIN
  PERFORM pg_temp.require(public.automation_list(0,NULL)='[]','new agency empty');
  PERFORM pg_temp.require(public.automation_access() @> '{"can_author":true}','admin author access');
  PERFORM public.save_automation_draft(doc,'','{"format":1,"nodes":[],"edges":[],"settings":{"reentry":"once","stop_on_reply":false}}',0,s);
  PERFORM pg_temp.require(jsonb_array_length(public.validate_automation_draft(doc))>=2,'incomplete draft saved with validation');
  PERFORM pg_temp.denied(format('select public.publish_automation(%L,1,%s,%L)',doc,s,switches));
  PERFORM public.save_automation_draft(doc,'Independent SMS',copy,1,s);
  PERFORM pg_temp.require(public.validate_automation_draft(doc)='[]','single action without delay valid');
  PERFORM pg_temp.denied(format('select public.save_automation_draft(%L,''Stale'',%L,1,%s)',doc,copy,s));
  PERFORM pg_temp.require(public.automation_access(doc) @> jsonb_build_object('release_controls',switches,'workflow',
    jsonb_build_object('id',doc,'status','draft','revision',2,'trigger_type',NULL)),'review reads scoped controls and draft status');
  -- Omission must not resolve to a permissive overload, even for an authorized caller with a valid draft.
  BEGIN
    EXECUTE 'select public.publish_automation($1,$2,$3)' USING doc,2::bigint,s;
    RAISE EXCEPTION 'Publish without reviewed controls unexpectedly succeeded';
  EXCEPTION WHEN undefined_function THEN NULL;
  END;
  FOREACH bad_controls IN ARRAY ARRAY[NULL::jsonb, '{"enrollment_enabled":false}'::jsonb,
    jsonb_set(switches,'{dispatch_enabled}','true')] LOOP
    BEGIN
      PERFORM public.publish_automation(doc,2,s,bad_controls);
      RAISE EXCEPTION 'Unreviewed controls unexpectedly published';
    EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
    END;
  END LOOP;
  PERFORM pg_temp.require(NOT EXISTS(SELECT FROM public.workflow_versions WHERE workflow_id=doc),'mismatched review created no version');
  confirmed:=public.publish_automation(doc,2,s,switches);
  PERFORM pg_temp.require(confirmed @> jsonb_build_object('release_controls',switches,'status','active','trigger_type','lead_created',
    'revision',3),'publish confirms effective switches and workflow');
  version_one:=(confirmed->>'version_id')::uuid;
  PERFORM pg_temp.denied(format('select public.publish_automation(%L,2,%s,%L)',doc,s,switches));
  PERFORM public.save_automation_draft(doc,'Edited copy',pg_temp.sms_graph('Next'),3,s);
  PERFORM pg_temp.require((SELECT graph=copy AND name='Independent SMS' FROM public.workflow_versions WHERE id=version_one),'version frozen after edit');
  PERFORM pg_temp.require((SELECT name='Independent SMS' AND status='active' FROM public.workflows WHERE id=doc),'draft inert');
  PERFORM public.automation_lifecycle(doc,'pause',s);
  version_two:=(public.publish_automation(doc,5,s,switches)->>'version_id')::uuid;
  PERFORM pg_temp.require(version_two<>version_one AND (SELECT status='paused' FROM public.workflows WHERE id=doc),'publishing a paused edit preserves pause');
  PERFORM public.automation_lifecycle(doc,'resume',s);
  PERFORM pg_temp.require(public.automation_list(0,NULL)#>>'{0,trigger_type}'='lead_created' AND
    public.automation_list(0,NULL)#>'{0,release_controls}'=switches,'list confirms pinned trigger and switch settings');
  PERFORM pg_temp.require((SELECT trigger_type='lead_created' FROM public.workflows WHERE id=doc),'intake catalog sees published lead trigger');

  invalid:=jsonb_set(copy,'{edges,0,target}',to_jsonb(pg_temp.aid(99)));
  PERFORM public.save_automation_draft(pg_temp.aid(81),'Invalid edge',invalid,0,s);
  issues:=public.validate_automation_draft(pg_temp.aid(81));
  PERFORM pg_temp.require(issues @> jsonb_build_array(jsonb_build_object('node_id',pg_temp.aid(70)::text)),'invalid edge points to block');
  invalid:=pg_temp.sms_graph('{{unapproved.field}}');
  PERFORM public.save_automation_draft(pg_temp.aid(81),'Invalid token',invalid,1,s);
  PERFORM pg_temp.require(public.validate_automation_draft(pg_temp.aid(81)) @> '[{"message":"Unsupported merge field"}]','unsupported token blocked');
  PERFORM public.save_automation_draft(pg_temp.aid(81),'Overlapping',copy,2,s);
  PERFORM pg_temp.require(public.automation_overlap(pg_temp.aid(81)) @> jsonb_build_array(jsonb_build_object('id',doc)),'overlap on active version');
  invalid:=jsonb_set(copy,'{edges}',(copy->'edges') || jsonb_build_array(
    jsonb_build_object('id',pg_temp.aid(73),'source',pg_temp.aid(71),'target',pg_temp.aid(71))));
  PERFORM public.save_automation_draft(pg_temp.aid(81),'Cycle',invalid,3,s);
  PERFORM pg_temp.require(public.validate_automation_draft(pg_temp.aid(81)) @> '[{"message":"Remove the cycle"}]','reachable cycle blocked');

  f:=public.automation_folder('create',pg_temp.aid(61),'{"name":"Agency"}',s);
  PERFORM public.automation_folder('move',(f->>'id')::uuid,jsonb_build_object('workflow_id',doc),s);
  PERFORM pg_temp.denied(format('select public.automation_folder(''move'',pg_temp.aid(60),%L,%s)',jsonb_build_object('workflow_id',doc),s));
  PERFORM public.automation_lifecycle(doc,'archive',s);
  PERFORM pg_temp.require((SELECT count(*)=2 FROM public.workflow_versions WHERE workflow_id=doc),'archive retains both versions');
  PERFORM pg_temp.denied(format('select public.automation_lifecycle(%L,''resume'',%s)',doc,s));
  PERFORM pg_temp.denied('delete from public.workflow_versions where true');
  PERFORM pg_temp.denied('update public.workflows set name=''bypass''');
  PERFORM pg_temp.denied('update public.workflow_nodes set label=''bypass''');
  PERFORM pg_temp.denied('delete from public.workflow_folders where true');

  s:=pg_temp.session(11);
  PERFORM pg_temp.require(public.automation_access(doc) @> '{"can_author":false}' AND
    NOT public.automation_access(doc) ?| ARRAY['workflow','release_controls'],'agent cannot read management controls or workflow');
  PERFORM pg_temp.denied(format('select public.save_automation_draft(%L,''Agent'',%L,0,%s)',pg_temp.aid(82),copy,s));
  s:=pg_temp.session(12);
  PERFORM pg_temp.require(public.automation_list(0,NULL)='[]' AND NOT EXISTS(SELECT FROM public.workflows WHERE id=doc)
    AND NOT public.automation_access(doc) ? 'workflow','foreign agency denied workflow status and graph');
  PERFORM pg_temp.denied(format('select public.publish_automation(%L,8,%s,%L)',doc,s,switches));
END $$;
RESET ROLE;

SELECT pg_temp.require((SELECT count(*)=2 FROM public.automation_intervals WHERE workflow_id=pg_temp.aid(80) AND ends_at IS NOT NULL),
  'one interval for initial publication and one upon resume');
SELECT pg_temp.require(NOT EXISTS(SELECT FROM private.automation_runs WHERE organization_id=pg_temp.aid(1)),'publish creates zero enrollments');

-- Legacy graphs stay byte-for-byte intact when opened; the new draft API cannot overwrite one.
INSERT INTO public.workflows(id,organization_id,name,trigger_type) VALUES(pg_temp.aid(85),pg_temp.aid(1),'Older automation','manual');
INSERT INTO public.workflow_nodes(id,organization_id,workflow_id,type,action_type,config) VALUES
  (pg_temp.aid(86),pg_temp.aid(1),pg_temp.aid(85),'action','webhook','{"legacy_option":"preserve"}');
INSERT INTO public.workflow_nodes(id,organization_id,workflow_id,type,action_type,config) VALUES
  (pg_temp.aid(87),pg_temp.aid(1),pg_temp.aid(85),'action','update_stage','{"legacy_stage":"kept"}');
INSERT INTO public.workflow_edges(id,organization_id,workflow_id,source_node_id,target_node_id) VALUES
  (pg_temp.aid(88),pg_temp.aid(1),pg_temp.aid(85),pg_temp.aid(86),pg_temp.aid(87));
INSERT INTO public.leads(id,organization_id,user_id,assigned_agent_id) VALUES
  (pg_temp.aid(170),pg_temp.aid(1),pg_temp.aid(11),pg_temp.aid(11)),
  (pg_temp.aid(171),pg_temp.aid(1),pg_temp.aid(10),pg_temp.aid(10));
INSERT INTO public.workflow_executions(id,organization_id,workflow_id,contact_id,status) VALUES
  (pg_temp.aid(180),pg_temp.aid(1),pg_temp.aid(85),pg_temp.aid(170),'completed'),
  (pg_temp.aid(181),pg_temp.aid(1),pg_temp.aid(85),pg_temp.aid(171),'completed');
INSERT INTO public.workflow_execution_steps(id,execution_id,organization_id,node_id,status) VALUES
  (pg_temp.aid(182),pg_temp.aid(180),pg_temp.aid(1),pg_temp.aid(86),'completed'),
  (pg_temp.aid(183),pg_temp.aid(181),pg_temp.aid(1),pg_temp.aid(86),'completed');
SET LOCAL ROLE authenticated;
SELECT pg_temp.session(10);
SELECT pg_temp.require(EXISTS(SELECT FROM public.workflow_nodes WHERE id=pg_temp.aid(86) AND config='{"legacy_option":"preserve"}'),'legacy node readable');
SELECT pg_temp.denied('select public.save_automation_draft(pg_temp.aid(85),''Versioned'',pg_temp.sms_graph(''test''),0,pg_temp.session(10))');
SELECT pg_temp.require(EXISTS(SELECT FROM public.workflow_nodes WHERE id=pg_temp.aid(86) AND config='{"legacy_option":"preserve"}'),'legacy node preserved');
SELECT pg_temp.require(EXISTS(SELECT FROM public.workflow_edges WHERE id=pg_temp.aid(88) AND source_node_id=pg_temp.aid(86)
    AND target_node_id=pg_temp.aid(87)),'advanced graph edge and opaque node IDs are preserved');
SELECT pg_temp.session(11);
SELECT pg_temp.require((SELECT count(*)=1 FROM public.workflow_executions WHERE workflow_id=pg_temp.aid(85)) AND
  (SELECT count(*)=1 FROM public.workflow_execution_steps WHERE node_id=pg_temp.aid(86)),'legacy history visible only for accessible contact');
SELECT pg_temp.denied('update public.workflow_execution_steps set status=''failed'' where id=pg_temp.aid(182)');
SELECT pg_temp.session(12);
SELECT pg_temp.require(NOT EXISTS(SELECT FROM public.workflow_execution_steps WHERE node_id=pg_temp.aid(86)),'legacy history tenant isolation');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.session(10);
SELECT pg_temp.denied('select public.automation_lifecycle(pg_temp.aid(85),''archive'',pg_temp.session(10))');
RESET ROLE;
-- A delegate sees shared work only when its concrete audience falls within that delegate's scope.
INSERT INTO public.role_permissions(organization_id,role,permissions)
VALUES (pg_temp.aid(1),'Agent','{"f":[{"features":[{"name":"Manage Automations","agent":true}]}]}')
ON CONFLICT (organization_id,role) DO UPDATE SET permissions=excluded.permissions;
INSERT INTO public.campaigns(id,organization_id,user_id,name) VALUES
  (pg_temp.aid(90),pg_temp.aid(1),pg_temp.aid(11),'Delegated campaign'),
  (pg_temp.aid(91),pg_temp.aid(1),pg_temp.aid(10),'Admin campaign');
INSERT INTO public.campaigns(id,organization_id,user_id,name)
  SELECT pg_temp.aid(n),pg_temp.aid(1),pg_temp.aid(10),'Catalog entry '||n FROM generate_series(1000,1060) n;
CREATE FUNCTION pg_temp.campaign_graph(n integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_set(pg_temp.sms_graph('Campaign message'),'{nodes,0}',
    jsonb_build_object('id',pg_temp.aid(70),'version',1,'type','campaign_membership_created',
      'config',jsonb_build_object('campaign_id',pg_temp.aid(n))))
$$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE adm bigint:=pg_temp.session(10); delegate bigint; copies jsonb;
  switches jsonb:=public.automation_access()->'release_controls';
BEGIN
  PERFORM public.save_automation_draft(pg_temp.aid(92),'Visible',pg_temp.campaign_graph(90),0,adm);
  PERFORM public.publish_automation(pg_temp.aid(92),1,adm,switches);
  PERFORM public.save_automation_draft(pg_temp.aid(93),'Hidden',pg_temp.campaign_graph(91),0,adm);
  PERFORM public.publish_automation(pg_temp.aid(93),1,adm,switches);
  PERFORM public.automation_folder('create',pg_temp.aid(94),'{"name":"Scoped folder"}',adm);
  PERFORM public.automation_folder('move',pg_temp.aid(94),jsonb_build_object('workflow_id',pg_temp.aid(93)),adm);
  delegate:=pg_temp.session(11);
  copies:=public.automation_campaign_options('',pg_temp.aid(90));
  PERFORM pg_temp.require(copies->>'next_cursor' IS NOT NULL AND copies#>>'{selected,id}'=pg_temp.aid(90)::text,
    'bounded catalog with independently scoped selected option');
  PERFORM pg_temp.require(public.automation_campaign_options(copies->>'next_cursor',pg_temp.aid(91))->'selected'='null',
    'cannot look up inaccessible selected campaign');
  PERFORM pg_temp.require(public.automation_access() @> '{"can_author":true}','explicit grant authorizes');
  copies:=public.automation_list(0,NULL);
  PERFORM pg_temp.require(copies @> jsonb_build_array(jsonb_build_object('id',pg_temp.aid(92))) AND
     NOT copies @> jsonb_build_array(jsonb_build_object('id',pg_temp.aid(93))),'only managed campaign shared to delegate');
  PERFORM pg_temp.require(NOT EXISTS (SELECT FROM public.workflows WHERE id=pg_temp.aid(93)),'direct graph SELECT enforce audience');
  PERFORM pg_temp.denied(format('select public.save_automation_draft(pg_temp.aid(93),%L,pg_temp.campaign_graph(90),2,%s)','Attempted takeover',delegate));
  PERFORM pg_temp.denied(format('select public.publish_automation(pg_temp.aid(93),2,%s,%L)',delegate,switches));
  PERFORM pg_temp.denied(format('select public.automation_lifecycle(pg_temp.aid(93),%L,%s)','pause',delegate));
  PERFORM pg_temp.denied(format('select public.automation_folder(%L,pg_temp.aid(94),%L,%s)','delete','{}',delegate));
  PERFORM public.save_automation_draft(pg_temp.aid(92),'Accessible shared draft',pg_temp.campaign_graph(90),2,delegate);
  PERFORM pg_temp.denied(format('select public.save_automation_draft(pg_temp.aid(92),%L,pg_temp.campaign_graph(91),3,%s)','Change to unauthorized audience',delegate));
END $$;
RESET ROLE;
-- New and old lead-created automations may coexist; only the legacy graph enters its evaluator.
UPDATE public.workflows SET trigger_type='lead_created',status='active' WHERE id=pg_temp.aid(85);
SET LOCAL ROLE authenticated;
SELECT pg_temp.session(10);
SELECT public.save_automation_draft(pg_temp.aid(1100),'Lead header',pg_temp.sms_graph('fixture'),0,pg_temp.session(10));
SELECT public.publish_automation(pg_temp.aid(1100),1,pg_temp.session(10),public.automation_access()->'release_controls');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.require(ARRAY(SELECT id FROM public.get_active_workflows_for_trigger(pg_temp.aid(1),'lead_created',NULL))
    = ARRAY[pg_temp.aid(85)],'legacy evaluator selects only the original graph');
RESET ROLE;
-- Simulate a record stored by a future/older implementation. A direct API caller cannot
-- replace it with a simplified graph, even with the correct revision and author privileges.
INSERT INTO public.workflows(id,organization_id,created_by,name,trigger_type,automation_revision,automation_graph)
SELECT pg_temp.aid(1200+n),pg_temp.aid(1),pg_temp.aid(10),'Opaque format','manual',1,graph
FROM (VALUES
  (1,jsonb_set(pg_temp.sms_graph('retain'),'{nodes,1,version}','2')),
  (2,jsonb_set(pg_temp.sms_graph('retain'),'{nodes,1,type}','"future_action"')),
  (3,jsonb_set(pg_temp.sms_graph('retain'),'{nodes}','{}')),
  (4,jsonb_set(pg_temp.sms_graph('retain'),'{nodes,1,config,future_field}','true')),
  (5,jsonb_set(pg_temp.sms_graph('retain'),'{settings}','null')),
  (6,jsonb_set(pg_temp.sms_graph('retain'),'{edges,0}','null')),
  (7,jsonb_set(pg_temp.sms_graph('retain'),'{nodes,1,config}','null')),
  (8,jsonb_set(pg_temp.sms_graph('retain'),'{edges,0,source}','"malformed"'))
) AS sample(n,graph);
SET LOCAL ROLE authenticated;
DO $$
DECLARE session_rev bigint:=pg_temp.session(10); w record;
BEGIN
  FOR w IN SELECT id,automation_graph FROM public.workflows WHERE id>=pg_temp.aid(1201) AND id<=pg_temp.aid(1208) LOOP
    PERFORM pg_temp.denied(format('SELECT public.save_automation_draft(%L,%L,%L,1,%s)',w.id,'Replacement',pg_temp.sms_graph('new'),session_rev));
    PERFORM pg_temp.denied(format('SELECT public.save_automation_draft(%L,%L,%L,0,%s)',pg_temp.aid(1220),'Malformed',w.automation_graph,session_rev));
    PERFORM pg_temp.require((SELECT automation_graph=w.automation_graph AND automation_revision=1 AND name='Opaque format'
      FROM public.workflows WHERE id=w.id),'opaque data preserved with stable revision');
  END LOOP;
  PERFORM public.automation_list(0,NULL);
  PERFORM public.automation_list(0,pg_temp.aid(91));
  PERFORM public.save_automation_draft(pg_temp.aid(1221),'Incomplete',jsonb_set(pg_temp.sms_graph('retain'),'{nodes,1,config}','{}'),0,session_rev);
  PERFORM pg_temp.require(jsonb_array_length(public.validate_automation_draft(pg_temp.aid(1221)))>0,'incomplete supported block can be saved');
END $$;
RESET ROLE;
ROLLBACK;
