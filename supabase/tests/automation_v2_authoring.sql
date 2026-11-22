-- Disposable SQL integration test: V2 graph editing, validation and publication.
-- Synthetic agencies, authors, dispositions and saved messages. Every definition rolls back.
begin;
update private.automation_session_cutover set visibility_cutover_at=installed_at where visibility_cutover_at is null;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('7a5b0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.ok(passed boolean, message text) returns void language plpgsql as $$
begin
  if passed is distinct from true then raise exception 'Automation V2 authoring: %', message; end if;
end $$;
create function pg_temp.refused(statement text, code text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=code then return; end if;
    raise exception 'Automation V2 authoring: expected % but got % (%) for %', code, sqlstate, sqlerrm, statement;
  end;
  raise exception 'Automation V2 authoring: unexpectedly allowed: %', statement;
end $$;
insert into public.organizations(id,name) values (pg_temp.id(1),'V2 authoring fixture'),(pg_temp.id(2),'Separate agency');
insert into private.automation_release_controls(organization_id,builder_visible) values (pg_temp.id(1),true),(pg_temp.id(2),true);
insert into auth.users(id,email) select pg_temp.id(n),'v2-author-'||n||'@example.invalid' from generate_series(10,12) n;
insert into public.profiles(id,organization_id,role,status,email)
  select pg_temp.id(n),pg_temp.id(case when n=12 then 2 else 1 end),case when n=11 then 'Agent' else 'Admin' end,'Active',
    'v2-author-'||n||'@example.invalid' from generate_series(10,12) n
  on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status;
insert into auth.sessions(id,user_id,created_at) select pg_temp.id(n+100),pg_temp.id(n),clock_timestamp() from generate_series(10,12) n;
-- Agent 11 holds delegated authoring. Agency-wide triggers still need agency management authority.
insert into public.role_permissions(organization_id,role,permissions)
  values (pg_temp.id(1),'Agent','{"f":[{"features":[{"name":"Manage Automations","agent":true}]}]}');
insert into public.dispositions(id,organization_id,name,color) values
  (pg_temp.id(20),pg_temp.id(1),'No Answer','#EF4444'),(pg_temp.id(21),pg_temp.id(1),'Interested','#22C55E'),
  (pg_temp.id(22),pg_temp.id(2),'Foreign disposition','#000000');
insert into public.message_templates(id,organization_id,name,type,scope,content,sms_purpose,created_by) values
  (pg_temp.id(30),pg_temp.id(1),'Appointment notice','sms','agency','Hi {{contact_first_name}}, your appointment is confirmed.','informational',pg_temp.id(10)),
  (pg_temp.id(31),pg_temp.id(1),'Promotion','sms','agency','Hi {{contact_first_name}}, ask about our new plans.','marketing',pg_temp.id(10)),
  (pg_temp.id(32),pg_temp.id(1),'My personal note','sms','personal','Hi {{contact_first_name}}, checking in.','informational',pg_temp.id(11)),
  (pg_temp.id(33),pg_temp.id(2),'Foreign message','sms','agency','Foreign wording','informational',pg_temp.id(12));
insert into public.message_templates(id,organization_id,name,type,scope,subject,content,created_by) values
  (pg_temp.id(34),pg_temp.id(1),'Welcome email','email','agency','Welcome {{contact_first_name}}','Glad to have you.',pg_temp.id(10));

create function pg_temp.session(actor integer) returns bigint language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',pg_temp.id(actor)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(actor),'role','authenticated','session_id',pg_temp.id(actor+100),
    'app_metadata',jsonb_build_object('organization_id',pg_temp.id(case when actor=12 then 2 else 1 end)))::text,true);
  return (public.automation_session_context()->>'revision')::bigint;
end $$;
-- A linear graph: the trigger followed by each step in order.
create function pg_temp.graph(trigger_node jsonb, steps jsonb, settings jsonb default '{"reentry":"once","stop_on_reply":false}')
returns jsonb language sql as $$
  with nodes as (
    select 0 as position,trigger_node||jsonb_build_object('id',pg_temp.id(500),'version',1) as node
    union all
    select step.ordinality::integer,jsonb_build_object('version',1)||step.value||jsonb_build_object('id',pg_temp.id(500+step.ordinality::integer))
    from jsonb_array_elements(steps) with ordinality step
  )
  select jsonb_build_object('format',1,'settings',settings,
    'nodes',(select jsonb_agg(node order by position) from nodes),
    'edges',coalesce((select jsonb_agg(jsonb_build_object('id',pg_temp.id(600+position),'source',pg_temp.id(499+position),
      'target',pg_temp.id(500+position)) order by position) from nodes where position>0),'[]'::jsonb))
$$;
create function pg_temp.task(title text default 'Call {{first_name}}') returns jsonb language sql as $$
  select jsonb_build_object('type','create_task','config',jsonb_build_object('title',title,'task_type','Follow Up','due_amount',5,'due_unit','minutes'))
$$;
-- Save a draft as the signed-in author and return the server's issues for it.
create function pg_temp.issues(doc integer, graph jsonb, expected bigint, session bigint) returns jsonb language plpgsql as $$
begin
  perform public.save_automation_draft(pg_temp.id(doc),'V2 draft '||doc,graph,expected,session);
  return public.validate_automation_draft(pg_temp.id(doc));
end $$;
create function pg_temp.says(issues jsonb, message text) returns boolean language sql as $$
  select exists(select from jsonb_array_elements(issues) issue where issue->>'message'=message)
$$;

create temporary table versions(doc integer primary key, id uuid) on commit drop;
grant select,insert on versions to authenticated;
set local role authenticated;
do $$
declare s bigint:=pg_temp.session(10); found jsonb; g jsonb; controls jsonb:='{"enrollment_enabled":false,"dispatch_enabled":false}';
  published jsonb; rev bigint:=0; base jsonb;
begin
  -- Step details: optional, bounded plain text, kept apart from configuration.
  base:=pg_temp.graph('{"type":"lead_created","config":{},"meta":{"name":"Every new lead","description":"Entry point"}}',
    jsonb_build_array(pg_temp.task()||'{"meta":{"name":"Speed to lead"}}'::jsonb));
  found:=pg_temp.issues(40,base,0,s); rev:=1;
  perform pg_temp.ok(found='[]'::jsonb,'a named trigger and a named task step validate');
  -- Malformed step details never replace a saved draft: over the limits, unknown keys, non-text or control characters.
  for g in select jsonb_set(base,'{nodes,1,meta}',bad.meta) from (values
      (jsonb_build_object('name',repeat('n',81))),(jsonb_build_object('description',repeat('d',501))),
      ('{"name":"Fine","colour":"red"}'::jsonb),('{"name":7}'::jsonb),('"text"'::jsonb),
      (jsonb_build_object('name',E'Line\nbreak'))) bad(meta) loop
    perform pg_temp.refused(format('select public.save_automation_draft(%L,''Bad'',%L,%s,%s)',pg_temp.id(40),g,rev,s),'22023');
  end loop;
  perform pg_temp.refused(format('select public.save_automation_draft(%L,''Bad'',%L,%s,%s)',pg_temp.id(40),
    jsonb_set(base,'{nodes,1,extra}','true'),rev,s),'22023');
  perform pg_temp.ok((select automation_revision=rev and automation_graph=base from public.workflows where id=pg_temp.id(40)),
    'a refused save leaves the draft and its revision untouched');
  found:=pg_temp.issues(40,jsonb_set(base,'{nodes,1,meta}',jsonb_build_object('name',repeat('n',80),
    'description',repeat('d',499)||E'\n')),rev,s); rev:=rev+1;
  perform pg_temp.ok(found='[]'::jsonb,'details at the limits, with a line break in the description, are fine');
  found:=pg_temp.issues(40,jsonb_set(base,'{nodes,1,meta}','{}'),rev,s); rev:=rev+1;
  perform pg_temp.ok(found='[]'::jsonb,'empty step details are fine');
  found:=pg_temp.issues(40,base,rev,s); rev:=rev+1;
  published:=public.publish_automation(pg_temp.id(40),rev,s,controls);
  perform pg_temp.ok((select graph#>>'{nodes,1,meta,name}'='Speed to lead' and graph#>>'{nodes,1,id}'=pg_temp.id(501)::text
    from public.workflow_versions where id=(published->>'version_id')::uuid),'the published version keeps step names and stable step ids');

  -- Every new trigger with a task step.
  for g in select pg_temp.graph(t.node,jsonb_build_array(pg_temp.task('Follow up'))) from (values
      (jsonb_build_object('type','disposition_recorded','config',jsonb_build_object('disposition_ids',jsonb_build_array(pg_temp.id(20),pg_temp.id(21))))),
      ('{"type":"appointment_booked","config":{}}'::jsonb),
      ('{"type":"appointment_outcome_recorded","config":{"outcomes":["no_show"]}}'::jsonb),
      ('{"type":"inbound_call_missed","config":{}}'::jsonb),
      ('{"type":"sale_recorded","config":{}}'::jsonb),
      ('{"type":"policy_issuance_confirmed","config":{}}'::jsonb)) t(node) loop
    found:=pg_temp.issues(41,g,case when g#>>'{nodes,0,type}'='disposition_recorded' then 0 else (select automation_revision from public.workflows where id=pg_temp.id(41)) end,s);
    perform pg_temp.ok(found='[]'::jsonb,'a task after '||(g#>>'{nodes,0,type}')||' validates: '||found::text);
  end loop;

  -- Trigger configuration.
  rev:=(select automation_revision from public.workflows where id=pg_temp.id(41));
  found:=pg_temp.issues(41,pg_temp.graph('{"type":"disposition_recorded","config":{}}',jsonb_build_array(pg_temp.task('x'))),rev,s); rev:=rev+1;
  perform pg_temp.ok(pg_temp.says(found,'Choose at least one disposition'),'a disposition trigger needs a disposition');
  found:=pg_temp.issues(41,pg_temp.graph(jsonb_build_object('type','disposition_recorded','config',jsonb_build_object('disposition_ids',
    jsonb_build_array(pg_temp.id(22)))),jsonb_build_array(pg_temp.task('x'))),rev,s); rev:=rev+1;
  perform pg_temp.ok(pg_temp.says(found,'Select dispositions that still exist in this agency'),'another agency''s disposition is refused');
  found:=pg_temp.issues(41,pg_temp.graph('{"type":"appointment_outcome_recorded","config":{"outcomes":["cancelled"]}}',
    jsonb_build_array(pg_temp.task('x'))),rev,s); rev:=rev+1;
  perform pg_temp.ok(pg_temp.says(found,'Choose at least one appointment outcome'),'only Held and No-show are outcomes');
  perform pg_temp.refused(format('select public.save_automation_draft(%L,''Bad'',%L,%s,%s)',pg_temp.id(41),
    pg_temp.graph('{"type":"sale_recorded","config":{"lead_source":"x"}}',jsonb_build_array(pg_temp.task('x'))),rev,s),'22023');

  -- Steps are offered and accepted only where the trigger supplies what they need.
  found:=pg_temp.issues(41,pg_temp.graph('{"type":"lead_created","config":{}}',jsonb_build_array(
    '{"type":"wait_until_before_appointment","config":{"amount":1,"unit":"days"}}'::jsonb,pg_temp.task('x'))),rev,s); rev:=rev+1;
  perform pg_temp.ok(pg_temp.says(found,'This step is not available after the selected trigger'),
    'waiting for an appointment needs an appointment trigger');
  found:=pg_temp.issues(41,pg_temp.graph('{"type":"sale_recorded","config":{}}',jsonb_build_array(
    '{"type":"send_sms","version":2,"config":{"body":"Thanks"}}'::jsonb)),rev,s); rev:=rev+1;
  perform pg_temp.ok(pg_temp.says(found,'This step is not available after the selected trigger'),
    'messages are not offered after a sale, whose contact is a client');
  found:=pg_temp.issues(41,pg_temp.graph('{"type":"appointment_booked","config":{}}',jsonb_build_array(
    '{"type":"wait_until_before_appointment","config":{"amount":0,"unit":"days"}}'::jsonb,pg_temp.task('x'))),rev,s); rev:=rev+1;
  perform pg_temp.ok(pg_temp.says(found,'Choose how long before the appointment'),'the reminder offset must be positive');
  found:=pg_temp.issues(41,pg_temp.graph('{"type":"appointment_booked","config":{}}',jsonb_build_array(
    '{"type":"wait_until_before_appointment","config":{"amount":1,"unit":"days","late":"continue"}}'::jsonb,
    pg_temp.task('Confirm {{appointment_date}} at {{appointment_time}}'))),rev,s); rev:=rev+1;
  perform pg_temp.ok(found='[]'::jsonb,'appointment fields are accepted after an appointment trigger');

  -- Fields: one catalog decides what a step may use.
  found:=pg_temp.issues(41,pg_temp.graph('{"type":"lead_created","config":{}}',jsonb_build_array(
    pg_temp.task('Confirm {{appointment_date}}'))),rev,s); rev:=rev+1;
  perform pg_temp.ok(pg_temp.says(found,'Unsupported field in the task text'),'appointment fields need an appointment trigger');
  found:=pg_temp.issues(41,pg_temp.graph('{"type":"lead_created","config":{}}',jsonb_build_array(
    pg_temp.task('Call {{contact_first_name}}'))),rev,s); rev:=rev+1;
  perform pg_temp.ok(pg_temp.says(found,'Unsupported field in the task text'),'saved-message field names are not automation fields');
  found:=pg_temp.issues(41,pg_temp.graph('{"type":"lead_created","config":{}}',jsonb_build_array(
    '{"type":"send_sms","version":2,"config":{"body":"Hi {{agent_name}}"}}'::jsonb)),rev,s); rev:=rev+1;
  perform pg_temp.ok(pg_temp.says(found,'Unsupported merge field'),'a field automations cannot fill is reported');
  found:=pg_temp.issues(41,pg_temp.graph('{"type":"lead_created","config":{}}',jsonb_build_array(
    '{"type":"send_sms","version":2,"config":{"body":"Hi {{first_name}} {{last_name}}, reach us at {{phone}} or {{email}}"}}'::jsonb)),rev,s); rev:=rev+1;
  perform pg_temp.ok(found='[]'::jsonb,'the four contact fields are accepted in an SMS');
  perform pg_temp.refused(format('select public.save_automation_draft(%L,''Bad'',%L,%s,%s)',pg_temp.id(41),
    pg_temp.graph('{"type":"lead_created","config":{}}',jsonb_build_array(
      '{"type":"send_sms","version":2,"config":{"body":"Hi","purpose":"informational"}}'::jsonb)),rev,s),'22023');
  perform pg_temp.refused(format('select public.save_automation_draft(%L,''Bad'',%L,%s,%s)',pg_temp.id(41),
    pg_temp.graph('{"type":"lead_created","config":{}}',jsonb_build_array('{"type":"send_sms","version":3,"config":{"body":"Hi"}}'::jsonb)),rev,s),'22023');

  -- Settings: the new stop rules and re-entry choice round trip, and unknown settings are refused.
  found:=pg_temp.issues(41,pg_temp.graph('{"type":"lead_created","config":{}}',jsonb_build_array(pg_temp.task('x')),
    '{"reentry":"after_end","stop_on_reply":true,"stop_on_booking":true,"stop_on_contact":false}'),rev,s); rev:=rev+1;
  perform pg_temp.ok(found='[]'::jsonb,'new settings validate');
  perform pg_temp.ok((select automation_graph#>>'{settings,reentry}'='after_end' and automation_graph#>'{settings,stop_on_booking}'='true'
    from public.workflows where id=pg_temp.id(41)),'and are stored as written');
  perform pg_temp.refused(format('select public.save_automation_draft(%L,''Bad'',%L,%s,%s)',pg_temp.id(41),
    pg_temp.graph('{"type":"lead_created","config":{}}',jsonb_build_array(pg_temp.task('x')),'{"reentry":"once","stop_on_reply":false,"surprise":true}'),rev,s),'22023');
end $$;

-- SMS purpose is decided by the server from the wording, and pinned when a version is published.
do $$
declare s bigint:=pg_temp.session(10); controls jsonb:='{"enrollment_enabled":false,"dispatch_enabled":false}';
  g jsonb; needs jsonb; published jsonb;
begin
  g:=pg_temp.graph('{"type":"lead_created","config":{}}',jsonb_build_array(
    jsonb_build_object('type','send_sms','version',2,'config',jsonb_build_object('template_id',pg_temp.id(30),
      'body','Hi {{first_name}}, your appointment is confirmed.')),
    jsonb_build_object('type','send_sms','version',2,'config',jsonb_build_object('template_id',pg_temp.id(30),
      'body','Hi {{first_name}}, your appointment is confirmed. Reply YES for a quote.')),
    jsonb_build_object('type','send_sms','version',2,'config',jsonb_build_object('template_id',pg_temp.id(31),
      'body','Hi {{first_name}}, ask about our new plans.')),
    jsonb_build_object('type','send_sms','version',2,'config',jsonb_build_object('body','Brand new wording')),
    jsonb_build_object('type','send_sms','version',2,'config',jsonb_build_object('template_id',pg_temp.id(32),'body','Hi {{first_name}}, checking in.')),
    jsonb_build_object('type','send_sms','version',2,'config',jsonb_build_object('template_id',pg_temp.id(33),'body','Foreign wording'))));
  perform pg_temp.ok(pg_temp.issues(42,g,0,s)='[]'::jsonb,'saved-message wording, edited wording and new wording all validate');
  needs:=public.automation_sms_requirements(pg_temp.id(42));
  perform pg_temp.ok(jsonb_array_length(needs)=6
    and (select bool_and(concat(item->>'purpose','/',item->>'basis')=(case item->>'node_id'
      when pg_temp.id(501)::text then 'informational/saved_message' when pg_temp.id(503)::text then 'marketing/saved_message'
      else 'marketing/custom' end)) from jsonb_array_elements(needs) item),
    'only an unchanged agency saved message keeps its own purpose; edited, new, personal and foreign wording need marketing consent: '||needs::text);
  published:=public.publish_automation(pg_temp.id(42),1,s,controls);
  insert into versions values (42,(published->>'version_id')::uuid);
  perform pg_temp.refused('select count(*) from private.automation_sms_purposes','42501');
end $$;
reset role;
select pg_temp.ok((select count(*)=6 and count(*) filter (where purpose='informational')=1
    and bool_and(organization_id=pg_temp.id(1)) from private.automation_sms_purposes
  where version_id=(select id from versions where doc=42)),'every SMS step of the version has a pinned purpose');
select pg_temp.ok((select basis='saved_message' and template_id=pg_temp.id(30) and template_hash is not null
  from private.automation_sms_purposes where version_id=(select id from versions where doc=42) and node_id=pg_temp.id(501)::text),
  'the pin records which saved message it rests on');
-- Editing the saved message afterwards changes neither the published wording nor its pinned purpose.
update public.message_templates set content='Completely different promotion',sms_purpose='marketing' where id=pg_temp.id(30);
select pg_temp.ok((select purpose='informational' from private.automation_sms_purposes where node_id=pg_temp.id(501)::text)
  and (select graph#>>'{nodes,1,config,body}'='Hi {{first_name}}, your appointment is confirmed.' from public.workflow_versions
    where workflow_id=pg_temp.id(42)),'a published version keeps its own wording and purpose');
select pg_temp.ok((select content='Completely different promotion' from public.message_templates where id=pg_temp.id(30)),
  'and editing a step never wrote to the saved message');
set local role authenticated;
do $$
declare s bigint:=pg_temp.session(10); needs jsonb;
begin
  -- The same draft step no longer matches the saved message, so a new version would need marketing consent.
  needs:=public.automation_sms_requirements(pg_temp.id(42));
  perform pg_temp.ok((select item->>'purpose'='marketing' and item->>'basis'='custom' from jsonb_array_elements(needs) item
    where item->>'node_id'=pg_temp.id(501)::text),'wording that no longer matches its saved message is treated as new wording');
end $$;

-- An earlier-format SMS step keeps publishing, with the purpose the server resolves rather than the declared one.
do $$
declare s bigint:=pg_temp.session(10); controls jsonb:='{"enrollment_enabled":false,"dispatch_enabled":false}'; g jsonb; published jsonb;
begin
  g:=pg_temp.graph('{"type":"lead_created","config":{}}',jsonb_build_array(
    '{"type":"send_sms","version":1,"config":{"body":"Declared informational, written by hand","purpose":"informational"}}'::jsonb,
    '{"type":"send_sms","version":1,"config":{"body":"Declared marketing","purpose":"marketing"}}'::jsonb));
  perform pg_temp.ok(pg_temp.issues(43,g,0,s)='[]'::jsonb,'an earlier-format SMS step still validates');
  published:=public.publish_automation(pg_temp.id(43),1,s,controls);
  insert into versions values (43,(published->>'version_id')::uuid);
  perform pg_temp.ok((select graph#>>'{nodes,1,config,purpose}'='informational' and graph#>'{nodes,1,version}'='1'
    from public.workflow_versions where id=(published->>'version_id')::uuid),'the stored version is exactly the graph that was saved');
end $$;
reset role;
select pg_temp.ok((select count(*)=2 and bool_and(purpose='marketing') from private.automation_sms_purposes
  where version_id=(select id from versions where doc=43)),'hand-written wording is pinned to marketing consent whatever the step declared');
set local role authenticated;

-- Pickers: dispositions and saved messages for this agency and this author only.
do $$
declare s bigint:=pg_temp.session(10); listed jsonb;
begin
  listed:=public.automation_disposition_options();
  perform pg_temp.ok(jsonb_array_length(listed)=2 and listed @> jsonb_build_array(jsonb_build_object('id',pg_temp.id(20),'name','No Answer','color','#EF4444')),
    'the disposition picker lists this agency''s dispositions with their colors');
  listed:=public.automation_saved_messages('sms','',0);
  perform pg_temp.ok(jsonb_array_length(listed->'items')=2 and listed->>'more'='false'
    and not exists(select from jsonb_array_elements(listed->'items') item where item->>'id' in (pg_temp.id(32)::text,pg_temp.id(33)::text)),
    'an administrator sees agency saved messages, not another person''s or another agency''s');
  listed:=public.automation_saved_messages('email','welcome',0);
  perform pg_temp.ok(jsonb_array_length(listed->'items')=1 and listed#>>'{items,0,subject}'='Welcome {{contact_first_name}}',
    'email saved messages carry their subject and search by name');
  perform pg_temp.refused('select public.automation_saved_messages(''push'','''',0)','22023');
end $$;
do $$
declare s bigint:=pg_temp.session(11); listed jsonb; found jsonb;
begin
  listed:=public.automation_saved_messages('sms','',0);
  perform pg_temp.ok(jsonb_array_length(listed->'items')=3 and exists(select from jsonb_array_elements(listed->'items') item
    where item->>'id'=pg_temp.id(32)::text),'an author also sees their own personal saved messages');
  -- Delegated authoring does not reach agency-wide triggers.
  found:=pg_temp.issues(44,pg_temp.graph('{"type":"inbound_call_missed","config":{}}',jsonb_build_array(pg_temp.task('Call back'))),0,s);
  perform pg_temp.ok(pg_temp.says(found,'This trigger requires agency management authority'),
    'a delegated author cannot publish an agency-wide trigger');
  perform pg_temp.refused(format('select public.publish_automation(%L,1,%s,%L)',pg_temp.id(44),s,
    '{"enrollment_enabled":false,"dispatch_enabled":false}'),'22023');
  perform pg_temp.refused(format('select public.automation_sms_requirements(%L)',pg_temp.id(42)),'42501');
end $$;
do $$
declare s bigint:=pg_temp.session(12);
begin
  perform pg_temp.ok(public.automation_disposition_options()=jsonb_build_array(jsonb_build_object('id',pg_temp.id(22),
    'name','Foreign disposition','color','#000000')),'another agency sees only its own dispositions');
  perform pg_temp.ok((select jsonb_array_length(public.automation_saved_messages('sms','',0)->'items'))=1,'and only its own saved messages');
  perform pg_temp.refused(format('select public.automation_sms_requirements(%L)',pg_temp.id(42)),'42501');
  perform pg_temp.refused(format('select public.validate_automation_draft(%L)',pg_temp.id(42)),'42501');
end $$;
reset role;
select pg_temp.ok(not has_table_privilege('authenticated','private.automation_sms_purposes','select'),'pinned purposes are server-only');
rollback;
