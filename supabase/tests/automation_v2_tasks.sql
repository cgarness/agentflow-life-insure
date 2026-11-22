-- Disposable SQL integration test: new-lead callback tasks and no-answer follow-up.
-- Synthetic agency, contacts and calls. The worker is simulated at its database boundary.
begin;
update private.automation_session_cutover set visibility_cutover_at=installed_at where visibility_cutover_at is null;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('7a5c0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.ok(passed boolean, message text) returns void language plpgsql as $$
begin
  if passed is distinct from true then raise exception 'Automation V2 tasks: %', message; end if;
end $$;
create function pg_temp.refused(statement text, code text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=code then return; end if;
    raise exception 'Automation V2 tasks: expected % but got % (%) for %', code, sqlstate, sqlerrm, statement;
  end;
  raise exception 'Automation V2 tasks: unexpectedly allowed: %', statement;
end $$;
create function pg_temp.act(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub',pg_temp.id(n)::text,true),
    set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','session_id',pg_temp.id(n+100),
      'app_metadata',jsonb_build_object('organization_id',pg_temp.id(case when n=14 then 2 else 1 end)))::text,true);
$$;
create function pg_temp.nobody() returns void language sql as $$
  select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
$$;

insert into public.organizations(id,name) values (pg_temp.id(1),'V2 task fixture'),(pg_temp.id(2),'Separate agency');
insert into private.automation_release_controls(organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
  values (pg_temp.id(1),true,true,false),(pg_temp.id(2),true,true,false);
insert into auth.users(id,email) select pg_temp.id(n),'v2-task-'||n||'@example.invalid' from generate_series(10,15) n;
insert into public.profiles(id,organization_id,role,status,email,first_name,last_name)
  select pg_temp.id(n),pg_temp.id(case when n=14 then 2 else 1 end),case when n=10 then 'Admin' else 'Agent' end,
    case when n=15 then 'Inactive' else 'Active' end,'v2-task-'||n||'@example.invalid','Fixture',n::text
  from generate_series(10,15) n
  on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status;
insert into auth.sessions(id,user_id,created_at) select pg_temp.id(n+100),pg_temp.id(n),clock_timestamp() from generate_series(10,14) n;

create function pg_temp.publish(workflow_n integer, version_n integer, title text, graph jsonb)
returns void language plpgsql as $$
begin
  insert into public.workflows(id,organization_id,name,status,trigger_type,automation_graph,automation_revision)
    values(pg_temp.id(workflow_n),pg_temp.id(1),title,'active','manual',graph,1);
  insert into public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
    values(pg_temp.id(version_n),pg_temp.id(1),pg_temp.id(workflow_n),title,1,graph,clock_timestamp(),pg_temp.id(10));
  update public.workflows set automation_version_id=pg_temp.id(version_n) where id=pg_temp.id(workflow_n);
  insert into public.automation_intervals(organization_id,workflow_id,version_id,starts_at)
    values(pg_temp.id(1),pg_temp.id(workflow_n),pg_temp.id(version_n),clock_timestamp());
end $$;
-- One worker turn: lease the oldest due step, run it the way the worker would and save the outcome.
create function pg_temp.work() returns jsonb language plpgsql as $$
declare c jsonb; node jsonb; made jsonb; outcome text; why text;
begin
  select * into c from public.automation_claim_work(1);
  if c is null then return null; end if;
  select n into node from jsonb_array_elements(c#>'{graph,nodes}') n where n->>'id'=c->>'node_id';
  if node->>'type'='create_task' then
    made:=public.automation_create_task((c->>'run_id')::uuid,(c->>'lease_token')::uuid,c->>'node_id',
      node#>>'{config,title}',node#>>'{config,notes}');
    outcome:=made->>'status'; why:=made->>'reason';
  elsif node->>'type' in ('wait','wait_until_before_appointment') then
    outcome:=case when c->>'status'='waiting' then 'elapsed' else 'wait' end;
  else
    outcome:='held'; why:='Synthetic transport';
  end if;
  perform public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,outcome,why);
  return c||jsonb_build_object('result',outcome,'reason',why);
end $$;

-- A. New lead callback -------------------------------------------------------------------------
select pg_temp.publish(20,21,'New lead callback','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"lead_created","version":1,"config":{},"meta":{"name":"Every new lead"}},
    {"id":"task","type":"create_task","version":1,"meta":{"name":"Speed to lead","description":"Internal note"},
     "config":{"title":"Call the new lead","task_type":"Follow Up","notes":"Within five minutes","due_amount":5,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"task"}]}');
insert into public.leads(id,organization_id,first_name,last_name,phone,assigned_agent_id) values
  (pg_temp.id(30),pg_temp.id(1),'Ada','Owner','+12025550130',pg_temp.id(11));
select pg_temp.ok(public.automation_process_events(25)=1,'a new lead enrolls once');
select pg_temp.ok((select contact_type='lead' and scope_key='lead:'||pg_temp.id(30)::text from private.automation_runs
  where contact_id=pg_temp.id(30)),'the run records a typed contact and a contact scope');
do $$
declare turn jsonb:=pg_temp.work(); made public.tasks;
begin
  perform pg_temp.ok(turn->>'result'='created' and turn->>'trigger'='lead_created','the task step reports created');
  select * into strict made from public.tasks where contact_id=pg_temp.id(30);
  perform pg_temp.ok(made.assigned_to=pg_temp.id(11) and made.created_by is null and made.contact_type='lead'
    and made.automation_run_id=(turn->>'run_id')::uuid,'the task belongs to the lead''s assigned agent and names its run');
  perform pg_temp.ok(not made.all_day and made.due_date between clock_timestamp()+interval '4 minutes'
    and clock_timestamp()+interval '6 minutes','the task carries its actual due time five minutes out');
  perform pg_temp.ok(made.title='Call the new lead' and made.task_type='Follow Up' and made.notes='Within five minutes',
    'the task keeps the authored title, type and notes');
  perform pg_temp.ok((select status='completed' from private.automation_runs where id=(turn->>'run_id')::uuid),'the run completed');
  perform pg_temp.ok(not exists(select from public.calls where organization_id=pg_temp.id(1)),'creating a task never places or records a call');
  perform pg_temp.ok(pg_temp.work() is null,'nothing else is due');
end $$;

-- A crashed worker repeats the step. The second attempt finds the first task.
insert into public.leads(id,organization_id,first_name,assigned_agent_id) values (pg_temp.id(31),pg_temp.id(1),'Replay',pg_temp.id(11));
select pg_temp.ok(public.automation_process_events(25)=1,'second lead enrolls');
do $$
declare c jsonb; again jsonb; made jsonb;
begin
  select * into strict c from public.automation_claim_work(1);
  made:=public.automation_create_task((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'task','Call the new lead',null);
  perform pg_temp.ok(made->>'status'='created','first attempt creates the task');
  update private.automation_runs set leased_until=clock_timestamp()-interval '1 minute' where id=(c->>'run_id')::uuid;
  select * into strict again from public.automation_claim_work(1);
  made:=public.automation_create_task((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'task','Call the new lead',null);
  perform pg_temp.ok(made->>'status'='held','the crashed worker''s stale lease creates nothing');
  made:=public.automation_create_task((again->>'run_id')::uuid,(again->>'lease_token')::uuid,'task','Call the new lead',null);
  perform pg_temp.ok(made->>'status'='created','the replacement worker is told the task exists');
  perform pg_temp.ok(public.automation_finish_node((again->>'run_id')::uuid,(again->>'lease_token')::uuid,'created'),'replay advances');
  perform pg_temp.ok((select count(*)=1 from public.tasks where contact_id=pg_temp.id(31)),'a replayed step created exactly one task');
end $$;

-- No owner is stated plainly, retried, and resolved when an owner appears.
insert into public.leads(id,organization_id,first_name) values (pg_temp.id(32),pg_temp.id(1),'Unowned');
insert into public.leads(id,organization_id,first_name,assigned_agent_id) values (pg_temp.id(33),pg_temp.id(1),'Former',pg_temp.id(15));
select pg_temp.ok(public.automation_process_events(25)=2,'unowned leads still enroll');
do $$
declare turn jsonb;
begin
  for n in 1..2 loop
    turn:=pg_temp.work();
    perform pg_temp.ok(turn->>'result'='held' and turn->>'reason'='Contact has no active assigned agent',
      'a missing or inactive owner holds the step with a plain reason');
  end loop;
  perform pg_temp.ok((select count(*)=2 from private.automation_runs where status='held'
    and reason='Contact has no active assigned agent' and due_at>clock_timestamp()+interval '4 minutes'),'held runs retry later');
  perform pg_temp.ok(not exists(select from public.tasks where contact_id in (pg_temp.id(32),pg_temp.id(33))),'no ownerless task exists');
  update public.leads set user_id=pg_temp.id(12) where id=pg_temp.id(32);
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where contact_id=pg_temp.id(32);
  turn:=pg_temp.work();
  perform pg_temp.ok(turn->>'result'='created' and (select assigned_to=pg_temp.id(12) from public.tasks where contact_id=pg_temp.id(32)),
    'once the lead has an owner the task is created for them');
end $$;

-- A converted lead ends its run instead of writing a task against a contact that no longer exists.
insert into public.leads(id,organization_id,first_name,assigned_agent_id) values (pg_temp.id(34),pg_temp.id(1),'Convert',pg_temp.id(11));
select pg_temp.ok(public.automation_process_events(25)=1,'lead to convert enrolls');
insert into public.clients(id,organization_id,first_name,last_name,lead_id,assigned_agent_id)
  values (pg_temp.id(35),pg_temp.id(1),'Convert','Client',pg_temp.id(34),pg_temp.id(11));
delete from public.leads where id=pg_temp.id(34);
do $$
declare turn jsonb:=pg_temp.work();
begin
  perform pg_temp.ok(turn->>'result'='stopped' and turn->>'reason'='Lead converted to client','conversion stops the run');
  perform pg_temp.ok((select status='stopped' and reason='Lead converted to client' from private.automation_runs
    where id=(turn->>'run_id')::uuid),'the stop and its reason are recorded');
end $$;

-- A paused workflow creates nothing, even for a step that was already leased.
insert into public.leads(id,organization_id,first_name,assigned_agent_id) values (pg_temp.id(36),pg_temp.id(1),'Paused',pg_temp.id(11));
select pg_temp.ok(public.automation_process_events(25)=1,'lead for pause enrolls');
do $$
declare c jsonb; made jsonb;
begin
  select * into strict c from public.automation_claim_work(1);
  update public.workflows set status='paused' where id=pg_temp.id(20);
  made:=public.automation_create_task((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'task','Call the new lead',null);
  perform pg_temp.ok(made->>'status'='held' and not exists(select from public.tasks where contact_id=pg_temp.id(36)),
    'a paused workflow holds the leased task step');
  update public.workflows set status='active' where id=pg_temp.id(20);
  update private.automation_runs set leased_until=null,lease_token=null,due_at=clock_timestamp()-interval '1 second'
    where contact_id=pg_temp.id(36);
  perform pg_temp.ok(pg_temp.work()->>'result'='created','resuming creates the task once');
end $$;

-- Signed-in people keep writing ordinary all-day tasks and cannot forge or relabel automation tasks.
select pg_temp.act(11);
set local role authenticated;
insert into public.tasks(id,organization_id,contact_id,contact_type,assigned_to,created_by,title,task_type,due_date)
  values (pg_temp.id(40),pg_temp.id(1),pg_temp.id(30),'lead',pg_temp.id(11),pg_temp.id(11),'Manual task','General',now());
select pg_temp.ok((select all_day and automation_run_id is null from public.tasks where id=pg_temp.id(40)),'a manual task stays all-day');
select pg_temp.refused(format('insert into public.tasks(organization_id,contact_id,contact_type,assigned_to,created_by,title,task_type,due_date,automation_run_id)
  values (%L,%L,''lead'',%L,%L,''Forged'',''General'',now(),gen_random_uuid())',pg_temp.id(1),pg_temp.id(30),pg_temp.id(11),pg_temp.id(11)),'42501');
select pg_temp.refused(format('insert into public.tasks(organization_id,contact_id,contact_type,assigned_to,title,task_type,due_date)
  values (%L,%L,''lead'',%L,''No creator'',''General'',now())',pg_temp.id(1),pg_temp.id(30),pg_temp.id(11)),'42501');
select pg_temp.refused(format('update public.tasks set automation_run_id=gen_random_uuid() where id=%L',pg_temp.id(40)),'42501');
select pg_temp.refused(format('update public.tasks set automation_run_id=null where contact_id=%L and automation_run_id is not null',pg_temp.id(30)),'42501');
update public.tasks set completed_at=now() where contact_id=pg_temp.id(30) and automation_run_id is not null;
select pg_temp.ok((select count(*)=1 from public.tasks where contact_id=pg_temp.id(30) and automation_run_id is not null
  and completed_at is not null),'the assigned agent completes an automation task like any other');
reset role;
select pg_temp.act(12);
set local role authenticated;
select pg_temp.ok(not exists(select from public.tasks where contact_id=pg_temp.id(30)),'another agent cannot read the task');
reset role;
select pg_temp.act(14);
set local role authenticated;
select pg_temp.ok(not exists(select from public.tasks),'another agency sees no tasks');
reset role;
select pg_temp.nobody();

-- B. No-answer follow-up ---------------------------------------------------------------------------
insert into public.dispositions(id,organization_id,name,counts_as_contacted) values
  (pg_temp.id(50),pg_temp.id(1),'No Answer',false),(pg_temp.id(51),pg_temp.id(1),'Interested',true),
  (pg_temp.id(52),pg_temp.id(2),'No Answer',false);
select pg_temp.publish(22,23,'No answer follow-up',jsonb_build_object(
  'format',1,'settings',jsonb_build_object('reentry','after_end','stop_on_reply',false,'stop_on_contact',true,'stop_on_booking',true),
  'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','disposition_recorded','version',1,'config',jsonb_build_object('disposition_ids',jsonb_build_array(pg_temp.id(50)))),
    jsonb_build_object('id','pause','type','wait','version',1,'config',jsonb_build_object('duration',1,'unit','hours')),
    jsonb_build_object('id','task','type','create_task','version',1,'config',jsonb_build_object(
      'title','Try the lead again','task_type','Follow Up','due_amount',0,'due_unit','minutes'))),
  'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','pause'),
    jsonb_build_object('id','b','source','pause','target','task'))));
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id) values
  (pg_temp.id(60),pg_temp.id(1),'Noanswer','+12025550160',pg_temp.id(11),pg_temp.id(11));
select public.automation_process_events(25);
select pg_temp.ok(not exists(select from private.automation_runs where workflow_id=pg_temp.id(22)),
  'creating the lead does not start the disposition workflow');
-- Set the new-lead callback aside so the rest of this section follows the disposition workflow alone.
update public.workflows set status='paused' where id=pg_temp.id(20);

-- The agent saves a disposition through the dialer's own save path.
create function pg_temp.dispose(call_n integer, disposition_n integer) returns jsonb language plpgsql as $$
declare saved jsonb;
begin
  insert into public.calls(id,organization_id,agent_id,contact_id,contact_type,contact_phone,direction,status,duration,dialer_admission_required)
    values(pg_temp.id(call_n),pg_temp.id(1),pg_temp.id(11),pg_temp.id(60),'lead','+12025550160','outbound','completed',0,false)
    on conflict (id) do nothing;
  perform pg_temp.act(11);
  set local role authenticated;
  saved:=public.save_disposition_with_booking(jsonb_build_object('p_call_id',pg_temp.id(call_n),'p_operation_id',pg_temp.id(call_n+1000),
    'p_disposition_id',pg_temp.id(disposition_n),'p_notes','synthetic','p_release_lock',false));
  reset role;
  perform pg_temp.nobody();
  return saved;
end $$;
select pg_temp.dispose(70,50);
select pg_temp.ok((select count(*)=1 from private.automation_events where event_type='disposition_recorded'
  and contact_id=pg_temp.id(60) and campaign_id is null and subject->>'disposition_id'=pg_temp.id(50)::text),
  'a saved disposition is one agency-wide event with its stable disposition id');
select pg_temp.dispose(70,50);
select pg_temp.ok((select count(*)=1 from private.automation_events where event_type='disposition_recorded'),
  'saving the same disposition again adds no event');
select pg_temp.ok(public.automation_process_events(25)=1,'the no-answer disposition enrolls the lead');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run waits before following up');

-- Double dial: a second no-answer minutes later does not stack a second run.
select pg_temp.dispose(71,50);
select pg_temp.ok(public.automation_process_events(25)=0,'a second no-answer while the first run waits does not stack');
select pg_temp.dispose(72,51);
select pg_temp.ok(public.automation_process_events(25)=0,'a different disposition does not match the trigger');

-- The agent reaches the lead before the wait ends: the follow-up ends without a task.
update public.calls set duration=120,disposition_id=pg_temp.id(51),disposition_name='Interested',
  started_at=clock_timestamp() where id=pg_temp.id(72);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(22) and status='waiting';
select pg_temp.ok(pg_temp.work() is null,'a run whose stop condition happened is not handed to a worker');
select pg_temp.ok((select status='stopped' and reason='Contact was reached' from private.automation_runs
  where workflow_id=pg_temp.id(22)),'a later successful contact stops the follow-up');
select pg_temp.ok(not exists(select from public.tasks where title='Try the lead again'),'no follow-up task was created');

-- A later no-answer is a legitimate new entry, and its task is created once.
select pg_temp.dispose(73,50);
select pg_temp.ok(public.automation_process_events(25)=1,'a later no-answer re-enters after the earlier run ended');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the new run waits');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(22) and status='waiting';
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the follow-up task is created');
select pg_temp.ok((select count(*)=1 from public.tasks where title='Try the lead again' and assigned_to=pg_temp.id(11)),'one follow-up task');

-- While that task is still open, another cycle re-enters but does not stack a duplicate task.
select pg_temp.dispose(74,50);
select pg_temp.ok(public.automation_process_events(25)=1,'the next no-answer re-enters');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(22) and status='waiting';
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','it elapses');
do $$
declare turn jsonb:=pg_temp.work();
begin
  perform pg_temp.ok(turn->>'result'='skipped' and turn->>'reason'='An earlier task from this automation is still open',
    'an open earlier task is not duplicated');
  perform pg_temp.ok((select count(*)=1 from public.tasks where title='Try the lead again'),'still one follow-up task');
  perform pg_temp.ok((select status='completed' from private.automation_runs where id=(turn->>'run_id')::uuid),'the run still completes');
end $$;

-- Booking an appointment ends a waiting follow-up.
select pg_temp.dispose(75,50);
select pg_temp.ok(public.automation_process_events(25)=1,'another no-answer re-enters');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
insert into public.appointments(id,organization_id,title,contact_id,user_id,created_by,start_time,sync_source)
  values (pg_temp.id(80),pg_temp.id(1),'Review',pg_temp.id(60),pg_temp.id(11),pg_temp.id(11),clock_timestamp()+interval '2 days','internal');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(22) and status='waiting';
select pg_temp.ok(pg_temp.work() is null,'the booked lead is not followed up');
select pg_temp.ok((select count(*)=1 from private.automation_runs where workflow_id=pg_temp.id(22) and status='stopped'
  and reason='Appointment booked'),'a booking stops the follow-up');

-- A person with authoring rights stops a run by hand. Another agency cannot.
select pg_temp.dispose(76,50);
select pg_temp.ok(public.automation_process_events(25)=1,'a final no-answer re-enters');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
create temporary table stop_target on commit drop as
  select id from private.automation_runs where workflow_id=pg_temp.id(22) and status='waiting';
grant select on stop_target to authenticated;
select pg_temp.act(14);
set local role authenticated;
select pg_temp.refused(format('select public.automation_stop_run(%L,(public.automation_session_context()->>''revision'')::bigint)',
  (select id from stop_target)),'42501');
reset role;
select pg_temp.act(10);
set local role authenticated;
select public.automation_stop_run((select id from stop_target),(public.automation_session_context()->>'revision')::bigint);
reset role;
select pg_temp.nobody();
select pg_temp.ok((select status='stopped' and reason='Stopped by user' from private.automation_runs
  where id=(select id from stop_target)),'a manual stop ends the run');

-- Activity shows the step name from the version that ran, for the right viewers only.
select pg_temp.act(10);
set local role authenticated;
do $$
declare rev bigint:=(public.automation_session_context()->>'revision')::bigint; rows jsonb;
begin
  rows:=public.automation_activity(rev,pg_temp.id(10),pg_temp.id(20));
  perform pg_temp.ok(jsonb_array_length(rows)>=4,'the administrator sees the callback runs');
  perform pg_temp.ok((select bool_and(item->>'node_name'='Speed to lead' and item->>'node_label'='Create task for assigned agent')
    from jsonb_array_elements(rows) item where item->>'node_type'='create_task'),'activity carries the step name and its block type');
end $$;
reset role;
select pg_temp.nobody();
-- Renaming the step in the draft does not rename history.
update public.workflows set automation_graph=jsonb_set(automation_graph,'{nodes,1,meta,name}','"Renamed later"') where id=pg_temp.id(20);
select pg_temp.act(12);
set local role authenticated;
do $$
declare rev bigint:=(public.automation_session_context()->>'revision')::bigint; rows jsonb;
begin
  rows:=public.automation_activity(rev,pg_temp.id(12),pg_temp.id(20));
  perform pg_temp.ok(jsonb_array_length(rows)=1 and rows#>>'{0,contact_id}'=pg_temp.id(32)::text
    and rows#>>'{0,node_name}'='Speed to lead','an agent sees only their own lead, with the historical step name');
end $$;
reset role;
select pg_temp.nobody();
rollback;
