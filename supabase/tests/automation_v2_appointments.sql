-- Disposable SQL integration test: appointment reminders and no-show recovery.
-- Synthetic agency, contacts and appointments, driven through the CRM's own booking and outcome paths.
begin;
update private.automation_session_cutover set visibility_cutover_at=installed_at where visibility_cutover_at is null;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('7a5d0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.ok(passed boolean, message text) returns void language plpgsql as $$
begin
  if passed is distinct from true then raise exception 'Automation V2 appointments: %', message; end if;
end $$;
create function pg_temp.act(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub',pg_temp.id(n)::text,true),
    set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','session_id',pg_temp.id(n+100),
      'app_metadata',jsonb_build_object('organization_id',pg_temp.id(case when n=14 then 2 else 1 end)))::text,true);
$$;
create function pg_temp.nobody() returns void language sql as $$
  select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
$$;

insert into public.organizations(id,name) values (pg_temp.id(1),'V2 appointment fixture'),(pg_temp.id(2),'Agency without a zone');
insert into public.company_settings(company_name,organization_id,timezone) values ('V2 appointment fixture',pg_temp.id(1),'America/New_York');
insert into private.automation_release_controls(organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
  values (pg_temp.id(1),true,true,false),(pg_temp.id(2),true,true,false);
insert into auth.users(id,email) select pg_temp.id(n),'v2-appt-'||n||'@example.invalid' from generate_series(10,14) n;
insert into public.profiles(id,organization_id,role,status,email)
  select pg_temp.id(n),pg_temp.id(case when n=14 then 2 else 1 end),case when n=10 then 'Admin' else 'Agent' end,'Active',
    'v2-appt-'||n||'@example.invalid' from generate_series(10,14) n
  on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status;
insert into auth.sessions(id,user_id,created_at) select pg_temp.id(n+100),pg_temp.id(n),clock_timestamp() from generate_series(10,14) n;
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(30,45) n;

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
-- The agent books through the calendar's booking service.
create function pg_temp.book(appointment_n integer, lead_n integer, starts timestamptz) returns uuid language plpgsql as $$
declare booked jsonb;
begin
  perform pg_temp.act(11);
  set local role authenticated;
  booked:=public.create_appointment_once(pg_temp.id(appointment_n),jsonb_build_object('title','Fixture review',
    'start_time',starts,'contact_id',pg_temp.id(lead_n),'user_id',pg_temp.id(11)));
  reset role;
  perform pg_temp.nobody();
  return (select a.id from public.appointments a where a.booking_request_id=pg_temp.id(appointment_n));
end $$;
create function pg_temp.as_agent(statement text) returns void language plpgsql as $$
begin
  perform pg_temp.act(11);
  set local role authenticated;
  execute statement;
  reset role;
  perform pg_temp.nobody();
end $$;
-- The Admin pauses or resumes an automation the way the builder does: a pause ends its activation, a resume opens one.
create function pg_temp.lifecycle(workflow_n integer, operation text) returns void language plpgsql as $$
begin
  perform pg_temp.act(10);
  perform public.automation_lifecycle(pg_temp.id(workflow_n),operation,(public.automation_session_context()->>'revision')::bigint);
  perform pg_temp.nobody();
end $$;
-- After an appointment was cancelled, moved while cancelled and opened again: one run follows it, placed against the
-- new time, and gives its reminder once.
create function pg_temp.reopened_reminder_fires_once(lead_n integer, story text) returns void language plpgsql as $$
declare live private.automation_runs; starts timestamptz; turn jsonb;
begin
  select a.start_time into strict starts from public.appointments a join booked b on b.id=a.id where b.n=lead_n;
  perform pg_temp.ok((select count(*)=1 from private.automation_runs where workflow_id=pg_temp.id(48) and contact_id=pg_temp.id(lead_n)
    and status in ('queued','waiting','held')),story||': exactly one run follows the appointment');
  select * into strict live from private.automation_runs where workflow_id=pg_temp.id(48) and contact_id=pg_temp.id(lead_n)
    and status in ('queued','waiting','held');
  if live.status='queued' then
    turn:=pg_temp.work();
    perform pg_temp.ok(turn->>'result'='wait' and turn->>'run_id'=live.id::text,story||': the run is placed against the new time');
  end if;
  select * into strict live from private.automation_runs where id=live.id;
  perform pg_temp.ok(live.status='waiting' and live.anchor_at=starts
    and live.due_at=((starts at time zone 'America/New_York')-interval '1 day') at time zone 'America/New_York',
    story||': it waits until the day before the new time');
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where id=live.id;
  perform pg_temp.ok(pg_temp.work()->>'result'='elapsed',story||': the day before arrives');
  perform pg_temp.ok(pg_temp.work()->>'result'='created',story||': the reminder task is created');
  perform pg_temp.ok(public.automation_process_events(25)=0 and pg_temp.work() is null,story||': nothing else is due');
  perform pg_temp.ok((select count(*)=1 from public.tasks t join private.automation_runs r on r.id=t.automation_run_id
    where r.workflow_id=pg_temp.id(48) and t.contact_id=pg_temp.id(lead_n)),story||': the reminder was given once');
end $$;
create function pg_temp.reminder(lead_n integer) returns private.automation_runs language sql as $$
  select r from private.automation_runs r where r.workflow_id=pg_temp.id(20) and r.contact_id=pg_temp.id(lead_n)
    order by r.started_at desc limit 1
$$;

select pg_temp.publish(20,21,'Appointment reminder','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Confirm tomorrow''s appointment","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');

-- Booking three days out waits until one agency day before the appointment.
create temporary table booked(n integer primary key, id uuid, starts timestamptz) on commit drop;
insert into booked select 30,pg_temp.book(60,30,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok((select count(*)=1 from private.automation_events where event_type='appointment_booked'
  and contact_id=pg_temp.id(30) and scope_key like 'slot:%' and subject->>'appointment_id'=(select id::text from booked where n=30)),
  'a booking is one event tied to its appointment slot');
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
do $$
declare turn jsonb:=pg_temp.work(); run private.automation_runs; expected timestamptz;
begin
  perform pg_temp.ok(turn->>'result'='wait' and (turn#>>'{context,appointment_start}')::timestamptz=(select starts from booked where n=30)
    and turn#>>'{context,agency_timezone}'='America/New_York','the lease carries the appointment time and agency zone');
  run:=pg_temp.reminder(30);
  expected:=(((select starts from booked where n=30) at time zone 'America/New_York')-interval '1 day') at time zone 'America/New_York';
  perform pg_temp.ok(run.status='waiting' and run.due_at=expected and run.anchor_at=(select starts from booked where n=30),
    'the reminder waits until the same wall-clock time one day earlier');
  perform pg_temp.ok(public.automation_process_events(25)=0,'a repeated sweep enrolls nothing');
  perform pg_temp.ok(pg_temp.work() is null,'and no step is due');
end $$;

-- A day before across a clock change is the same wall-clock time, not twenty-four hours.
insert into public.appointments(id,organization_id,title,contact_id,user_id,start_time,sync_source) values
  (pg_temp.id(61),pg_temp.id(1),'Spring forward',pg_temp.id(31),pg_temp.id(11),'2027-03-14T19:00:00Z','internal'),
  (pg_temp.id(62),pg_temp.id(1),'Fall back',pg_temp.id(31),pg_temp.id(11),'2027-11-07T20:00:00Z','internal'),
  (pg_temp.id(63),pg_temp.id(2),'No agency zone',null,pg_temp.id(14),'2027-03-14T19:00:00Z','internal');
select pg_temp.ok((select due='2027-03-13T20:00:00Z' and verdict='wait' from private.automation_appointment_wait(pg_temp.id(1),pg_temp.id(61),
  '{"config":{"amount":1,"unit":"days"}}')),'3 PM the day before a spring-forward appointment');
select pg_temp.ok((select due='2027-11-06T19:00:00Z' from private.automation_appointment_wait(pg_temp.id(1),pg_temp.id(62),
  '{"config":{"amount":1,"unit":"days"}}')),'3 PM the day before a fall-back appointment');
select pg_temp.ok((select due='2027-03-14T17:00:00Z' from private.automation_appointment_wait(pg_temp.id(1),pg_temp.id(61),
  '{"config":{"amount":2,"unit":"hours"}}')),'hours are exact');
select pg_temp.ok((select due='2027-03-13T19:00:00Z' from private.automation_appointment_wait(pg_temp.id(2),pg_temp.id(63),
  '{"config":{"amount":1,"unit":"days"}}')),'without an agency zone a day is twenty-four hours');
select public.automation_process_events(25);
update private.automation_runs set status='stopped',ended_at=clock_timestamp() where contact_id=pg_temp.id(31);

-- Rescheduling while the reminder waits moves the same run. It does not start a second one.
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts+interval '2 days' from booked where n=30),(select id from booked where n=30)));
select pg_temp.ok((select count(*)=2 from private.automation_events where subject->>'appointment_id'=(select id::text from booked where n=30)
  and event_type in ('appointment_booked','appointment_changed') and processed_at is null),'a reschedule is recorded as a change and a new slot');
select pg_temp.ok(public.automation_process_events(25)=0,'the reschedule starts no second run');
do $$
declare run private.automation_runs:=pg_temp.reminder(30); moved timestamptz:=(select starts+interval '2 days' from booked where n=30);
begin
  perform pg_temp.ok((select count(*)=1 from private.automation_runs where contact_id=pg_temp.id(30)),'still one run for the appointment');
  perform pg_temp.ok(run.status='waiting' and run.anchor_at=moved
    and run.due_at=((moved at time zone 'America/New_York')-interval '1 day') at time zone 'America/New_York',
    'the pending reminder moved to the new time');
end $$;

-- Without the change event, the run still re-checks the appointment when its old time arrives.
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts+interval '6 days' from booked where n=30),(select id from booked where n=30)));
update private.automation_events set processed_at=clock_timestamp() where processed_at is null;
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where contact_id=pg_temp.id(30);
do $$
declare turn jsonb:=pg_temp.work(); run private.automation_runs:=pg_temp.reminder(30);
begin
  perform pg_temp.ok(turn->>'result'='elapsed' and run.status='waiting'
    and run.anchor_at=(select starts+interval '6 days' from booked where n=30) and run.due_at>clock_timestamp()+interval '4 days',
    'a run that wakes at its old time waits again for the appointment''s current time');
end $$;

-- The wait elapses and the reminder step runs with the appointment still standing.
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where contact_id=pg_temp.id(30);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the anchored wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the reminder step runs');
select pg_temp.ok((select count(*)=1 from public.tasks where contact_id=pg_temp.id(30)),'one reminder for the appointment');

-- Cancelling removes the pending reminder.
insert into booked select 32,pg_temp.book(64,32,clock_timestamp()+interval '4 days'),null;
select pg_temp.ok(public.automation_process_events(25)=1,'second booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=32)));
select pg_temp.ok(public.automation_process_events(25)=0,'a cancellation enrolls nothing');
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from pg_temp.reminder(32)),
  'cancelling ends the waiting reminder straight away');

-- A cancel that races the worker: the run is checked again at the moment it is leased.
insert into booked select 33,pg_temp.book(65,33,clock_timestamp()+interval '4 days'),null;
select pg_temp.ok(public.automation_process_events(25)=1,'third booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=33)));
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where contact_id=pg_temp.id(33);
select pg_temp.ok(pg_temp.work() is null,'a cancelled appointment''s reminder is never handed to a worker');
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from pg_temp.reminder(33)),'and it is stopped');
select public.automation_process_events(25);

-- Deleting the appointment removes the pending reminder.
insert into booked select 34,pg_temp.book(66,34,clock_timestamp()+interval '4 days'),null;
select pg_temp.ok(public.automation_process_events(25)=1,'fourth booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
select pg_temp.as_agent(format('delete from public.appointments where id=%L',(select id from booked where n=34)));
select public.automation_process_events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment was removed' from pg_temp.reminder(34)),'deleting ends the reminder');

-- Moving the appointment inside the reminder window ends the pending reminder, which can no longer be on time.
insert into booked select 35,pg_temp.book(67,35,clock_timestamp()+interval '4 days'),null;
select pg_temp.ok(public.automation_process_events(25)=1,'fifth booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  clock_timestamp()+interval '3 hours',(select id from booked where n=35)));
select public.automation_process_events(25);
select pg_temp.ok((select status='completed' and reason='The reminder time had already passed' from pg_temp.reminder(35)),
  'a reminder that can no longer be on time is skipped');
select pg_temp.ok(not exists(select from public.tasks where contact_id=pg_temp.id(35))
  and (select count(*)=1 from private.automation_runs where contact_id=pg_temp.id(35)),
  'no late reminder was created and the moved slot started no second run');

-- A late booking skips by default. An author can choose to continue instead.
insert into booked select 36,pg_temp.book(68,36,clock_timestamp()+interval '5 hours'),null;
select pg_temp.ok(public.automation_process_events(25)=1,'a booking inside the window still enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the step is evaluated');
select pg_temp.ok((select status='completed' and reason='The reminder time had already passed' from pg_temp.reminder(36))
  and not exists(select from public.tasks where contact_id=pg_temp.id(36)),'a late booking skips the reminder');
update public.workflows set status='paused' where id=pg_temp.id(20);
select pg_temp.publish(22,23,'Late reminders continue','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days","late":"continue"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Confirm today''s appointment","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');
insert into booked select 37,pg_temp.book(69,37,clock_timestamp()+interval '5 hours'),null;
select public.automation_process_events(25);
select pg_temp.ok(pg_temp.work()->>'result'='wait','the continue step is evaluated');
select pg_temp.ok(pg_temp.work()->>'result'='created','a late booking continues straight to the next step when the author chose that');

-- Bookings that are not upcoming appointments start nothing.
insert into booked select 38,pg_temp.book(70,38,clock_timestamp()-interval '2 hours'),null;
insert into public.appointments(id,organization_id,title,contact_id,user_id,start_time,sync_source,booking_kind,type)
  values (pg_temp.id(71),pg_temp.id(1),'Callback',pg_temp.id(39),pg_temp.id(11),clock_timestamp()+interval '2 days','internal','callback','Follow Up');
select pg_temp.ok(public.automation_process_events(25)=0,'a past appointment and a callback reminder start no run');
select pg_temp.ok(not exists(select from private.automation_events where event_type='appointment_booked'
  and contact_id=pg_temp.id(39)),'a callback is not an appointment booking');
update public.workflows set status='paused' where id=pg_temp.id(22);

-- No-show recovery: only a person's explicit No-show creates the rescheduling task, and only once.
select pg_temp.publish(24,25,'No-show recovery','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_outcome_recorded","version":1,"config":{"outcomes":["no_show"]}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Reschedule the missed appointment","task_type":"Follow Up","due_amount":1,"due_unit":"hours"}}],
  "edges":[{"id":"a","source":"start","target":"task"}]}');
select pg_temp.ok(public.automation_process_events(25)=0,'nothing enrolls in no-show recovery yet');
select pg_temp.ok(not exists(select from private.automation_events
  where event_type='appointment_outcome_recorded'),'an appointment whose time has passed is not a no-show');
-- A background status change is not a person's outcome.
update public.appointments set status='No Show' where id=(select id from booked where n=38);
select pg_temp.ok(not exists(select from private.automation_events where event_type='appointment_outcome_recorded'),
  'a status changed by a background process starts nothing');
update public.appointments set status='Scheduled' where id=(select id from booked where n=38);
do $$
declare target uuid:=(select id from booked where n=38); starts timestamptz; answer jsonb; turn jsonb;
begin
  select a.start_time into starts from public.appointments a where a.id=target;
  perform pg_temp.act(11);
  set local role authenticated;
  answer:=public.record_appointment_outcome(pg_temp.id(90),target,starts,'no_show');
  answer:=public.record_appointment_outcome(pg_temp.id(90),target,starts,'no_show');
  reset role;
  perform pg_temp.nobody();
  perform pg_temp.ok((select count(*)=1 from private.automation_events where event_type='appointment_outcome_recorded'
    and subject->>'outcome'='no_show' and contact_id=pg_temp.id(38) and scope_key like 'outcome:%:no_show'),
    'an explicit No-show is one event, even when the request is sent twice');
  perform pg_temp.ok(public.automation_process_events(25)=1,'the no-show enrolls');
  turn:=pg_temp.work();
  perform pg_temp.ok(turn->>'result'='created' and (turn#>>'{context,appointment_start}')::timestamptz=starts,
    'the rescheduling task is created with the missed appointment''s time available');
  -- Reopened and marked No-show again: still the same missed appointment.
  perform pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',target));
  perform pg_temp.as_agent(format('update public.appointments set status=''No Show'' where id=%L',target));
  perform pg_temp.ok((select count(*)=2 from private.automation_events where event_type='appointment_outcome_recorded'),
    'marking it again is recorded');
  perform pg_temp.ok(public.automation_process_events(25)=0,'but does not start a second run for the same missed appointment');
  perform pg_temp.ok((select count(*)=1 from public.tasks where title='Reschedule the missed appointment'),'one rescheduling task');
end $$;

-- A Held outcome does not match a No-show trigger. A corrected outcome ends a pending No-show run.
insert into booked select 40,pg_temp.book(72,40,clock_timestamp()-interval '3 hours'),null;
select pg_temp.as_agent(format('update public.appointments set status=''Completed'' where id=%L',(select id from booked where n=40)));
select pg_temp.ok(public.automation_process_events(25)=0,'a Held appointment does not start no-show recovery');
insert into booked select 41,pg_temp.book(73,41,clock_timestamp()-interval '3 hours'),null;
select pg_temp.as_agent(format('update public.appointments set status=''No Show'' where id=%L',(select id from booked where n=41)));
select pg_temp.ok(public.automation_process_events(25)=1,'a second contact''s no-show enrolls');
select pg_temp.as_agent(format('update public.appointments set status=''Completed'' where id=%L',(select id from booked where n=41)));
select public.automation_process_events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment outcome was changed' from private.automation_runs
  where workflow_id=pg_temp.id(24) and contact_id=pg_temp.id(41)),'correcting the outcome ends the pending recovery');
select pg_temp.ok(not exists(select from public.tasks where contact_id=pg_temp.id(41)),'no task for an appointment that was held');

-- Another agency's appointments never reach this agency's workflows.
insert into public.appointments(id,organization_id,title,user_id,start_time,sync_source)
  values (pg_temp.id(74),pg_temp.id(2),'Foreign',pg_temp.id(14),clock_timestamp()+interval '4 days','internal');
select pg_temp.ok(public.automation_process_events(25)=0,'another agency''s appointment enrolls in nothing here');
select pg_temp.ok(not exists(select from private.automation_runs where organization_id=pg_temp.id(2)),'no cross-agency enrollment');

-- Review follow-ups ------------------------------------------------------------------------------
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';

-- A reschedule after a reminder already went out starts the automation again, so the new time gets every reminder.
select pg_temp.publish(26,27,'Two reminders','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"day","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"first","type":"create_task","version":1,"config":{"title":"Day-before reminder","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"hour","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"hours"}},
    {"id":"second","type":"create_task","version":1,"config":{"title":"Hour-before reminder","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"day"},{"id":"b","source":"day","target":"first"},
    {"id":"c","source":"first","target":"hour"},{"id":"d","source":"hour","target":"second"}]}');
insert into booked select 42,pg_temp.book(75,42,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls in the two-reminder automation');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(26);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the day-before wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the day-before reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run now waits for the hour before');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts+interval '14 days' from booked where n=42),(select id from booked where n=42)));
select pg_temp.ok(public.automation_process_events(25)=1,'the new time starts the automation again');
select pg_temp.ok((select count(*)=1 from private.automation_runs where workflow_id=pg_temp.id(26) and status='stopped'
  and reason='Appointment was rescheduled'),'the run that already reminded for the old time ends');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the new run waits');
do $$
declare moved timestamptz:=(select starts+interval '14 days' from booked where n=42); fresh private.automation_runs;
begin
  select * into strict fresh from private.automation_runs where workflow_id=pg_temp.id(26) and status='waiting';
  perform pg_temp.ok(fresh.current_node_id='day' and fresh.anchor_at=moved
    and fresh.due_at=((moved at time zone 'America/New_York')-interval '1 day') at time zone 'America/New_York',
    'and the new time gets its day-before reminder');
end $$;
update public.workflows set status='paused' where id=pg_temp.id(26);

-- The same when the run sits in a plain wait after its first reminder.
select pg_temp.publish(28,29,'Reminder then nudge','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"day","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"first","type":"create_task","version":1,"config":{"title":"Day-before reminder (B)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"pause","type":"wait","version":1,"config":{"duration":20,"unit":"hours"}},
    {"id":"nudge","type":"create_task","version":1,"config":{"title":"See you soon","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"day"},{"id":"b","source":"day","target":"first"},
    {"id":"c","source":"first","target":"pause"},{"id":"d","source":"pause","target":"nudge"}]}');
insert into booked select 43,pg_temp.book(76,43,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the second booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(28);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the first reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run sits in its plain wait');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts+interval '14 days' from booked where n=43),(select id from booked where n=43)));
select pg_temp.ok(public.automation_process_events(25)=1,'the new time starts the automation again');
select pg_temp.ok((select count(*)=1 from private.automation_runs where workflow_id=pg_temp.id(28) and status='stopped'
  and reason='Appointment was rescheduled' and current_node_id='pause'),'the run in its plain wait ends instead of nudging two weeks early');
update public.workflows set status='paused' where id=pg_temp.id(28);

-- Taking back a cancellation brings the reminder back, placed against the appointment's time again.
select pg_temp.publish(30,31,'Reminder for reopening','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Reminder after reopening","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');
insert into booked select 44,pg_temp.book(77,44,date_trunc('minute',clock_timestamp())+interval '4 days'),
  date_trunc('minute',clock_timestamp())+interval '4 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the third booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=44)));
select public.automation_process_events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from private.automation_runs where workflow_id=pg_temp.id(30)),
  'cancelling ends the reminder');
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=44)));
select pg_temp.ok(public.automation_process_events(25)=0,'reopening starts no second run');
select pg_temp.ok((select status='queued' and reason is null and ended_at is null from private.automation_runs where workflow_id=pg_temp.id(30)),
  'the reminder that the cancellation stopped carries on');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it is placed against the appointment again');
select pg_temp.ok((select status='waiting' and due_at=(((select starts from booked where n=44) at time zone 'America/New_York')-interval '1 day')
  at time zone 'America/New_York' from private.automation_runs where workflow_id=pg_temp.id(30)),'and waits for the day before');

-- The verified zone of an SMS recipient is found for a lead phone stored without its plus sign.
insert into private.automation_recipient_facts(organization_id,contact_id,contact_type,channel,destination,timezone_name,valid_until,
    email_permission,evidence_reference)
  values (pg_temp.id(1),pg_temp.id(44),'lead','sms','+12025550044','America/Chicago',clock_timestamp()+interval '1 day',false,'fixture');
select pg_temp.ok(public.automation_message_timezone((select id from private.automation_runs where workflow_id=pg_temp.id(30)),
  'sms','12025550044')='America/Chicago','a lead phone stored as 11 digits finds its verified zone');
select pg_temp.ok(public.automation_message_timezone((select id from private.automation_runs where workflow_id=pg_temp.id(30)),
  'sms','not a phone') is null,'a phone that cannot be read finds none');

-- A missed-call event recovered after a failed capture keeps its one-minute settle.
select private.automation_record_event(pg_temp.id(1),'inbound_call_missed',pg_temp.id(96),pg_temp.id(45),'not a type',
  jsonb_build_object('call_id',pg_temp.id(96)),'call:'||pg_temp.id(96)::text,interval '1 minute');
select pg_temp.ok((select available_at>=occurred_at+interval '1 minute' from private.automation_intake_recovery where source_id=pg_temp.id(96)),
  'a capture that fails keeps the settle time for its repair');
insert into private.automation_intake_recovery(organization_id,event_type,source_id,contact_id,contact_type,occurred_at,subject,scope_key,available_at)
  values (pg_temp.id(1),'inbound_call_missed',pg_temp.id(95),null,null,clock_timestamp(),jsonb_build_object('call_id',pg_temp.id(95)),
    'call:'||pg_temp.id(95)::text,clock_timestamp()+interval '1 minute');
select public.automation_process_events(25);
select pg_temp.ok((select available_at>clock_timestamp()+interval '50 seconds' and processed_at is null from private.automation_events
  where source_id=pg_temp.id(95)),'the repaired event still waits out its settle time before it can enroll');
-- Second review follow-ups -------------------------------------------------------------------------
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(46,49) n;
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';

-- A move into the first reminder's window keeps the run in place. Starting over would end at once, because the
-- new time is too close for the day-before reminder, and the hour-before reminder would be lost with it.
select pg_temp.publish(32,33,'Two reminders, moved closer','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"day","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"first","type":"create_task","version":1,"config":{"title":"Day-before reminder (C)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"hour","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"hours"}},
    {"id":"second","type":"create_task","version":1,"config":{"title":"Hour-before reminder (C)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"day"},{"id":"b","source":"day","target":"first"},
    {"id":"c","source":"first","target":"hour"},{"id":"d","source":"hour","target":"second"}]}');
insert into booked select 46,pg_temp.book(78,46,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(32);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the day-before wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the day-before reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run waits for the hour before');
update booked set starts=date_trunc('minute',clock_timestamp())+interval '20 hours' where n=46;
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts from booked where n=46),(select id from booked where n=46)));
select pg_temp.ok(public.automation_process_events(25)=0,'a move inside the day-before window starts nothing new');
select pg_temp.ok((select r.status='waiting' and r.current_node_id='hour' and r.anchor_at=b.starts and r.due_at=b.starts-interval '1 hour'
    from private.automation_runs r,booked b where r.workflow_id=pg_temp.id(32) and b.n=46),
  'the run keeps its place and its hour-before reminder moves to the new time');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(32);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the hour-before wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the new time gets its hour-before reminder');
select pg_temp.ok((select count(*)=1 from public.tasks where contact_id=pg_temp.id(46) and title='Hour-before reminder (C)'),
  'exactly once');
update public.workflows set status='paused' where id=pg_temp.id(32);

-- The worker can reach the old run before the new time is admitted. It leaves the run alone until then, and
-- admitting the new time ends that run and starts the automation again.
select pg_temp.publish(34,35,'Two reminders, worker first','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"day","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"first","type":"create_task","version":1,"config":{"title":"Day-before reminder (D)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"hour","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"hours"}},
    {"id":"second","type":"create_task","version":1,"config":{"title":"Hour-before reminder (D)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"day"},{"id":"b","source":"day","target":"first"},
    {"id":"c","source":"first","target":"hour"},{"id":"d","source":"hour","target":"second"}]}');
insert into booked select 47,pg_temp.book(79,47,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(34);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the day-before wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the day-before reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run waits for the hour before');
update booked set starts=starts+interval '14 days' where n=47;
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts from booked where n=47),(select id from booked where n=47)));
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(34) and status='waiting';
select pg_temp.ok(pg_temp.work() is null,'the worker leaves the old run alone while the new time waits to be admitted');
select pg_temp.ok((select status='waiting' and due_at>clock_timestamp() from private.automation_runs where workflow_id=pg_temp.id(34)),
  'and looks at it again a minute later');
select pg_temp.ok(public.automation_process_events(25)=1,'admitting the new time starts the automation again');
select pg_temp.ok((select status='stopped' and reason='Appointment was rescheduled' from private.automation_runs
  where workflow_id=pg_temp.id(34) and current_node_id='hour'),'and ends the run that reminded for the old time');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the new run waits');
select pg_temp.ok((select r.current_node_id='day' and r.anchor_at=b.starts from private.automation_runs r,booked b
  where r.workflow_id=pg_temp.id(34) and r.status='waiting' and b.n=47),'for the new time''s day-before reminder');
update public.workflows set status='paused' where id=pg_temp.id(34);

-- Taking back a cancellation keeps the time a plain wait had already served.
select pg_temp.publish(36,37,'Wait, then confirm','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"pause","type":"wait","version":1,"config":{"duration":2,"unit":"days"}},
    {"id":"confirm","type":"create_task","version":1,"config":{"title":"Confirm the appointment (E)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"pause"},{"id":"b","source":"pause","target":"confirm"}]}');
insert into booked select 48,pg_temp.book(80,48,date_trunc('minute',clock_timestamp())+interval '5 days'),
  date_trunc('minute',clock_timestamp())+interval '5 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the plain wait starts');
update private.automation_runs set due_at=clock_timestamp()+interval '1 hour' where workflow_id=pg_temp.id(36);
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=48)));
select public.automation_process_events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from private.automation_runs
  where workflow_id=pg_temp.id(36)),'cancelling ends the run');
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=48)));
select pg_temp.ok(public.automation_process_events(25)=0,'reopening starts no second run');
select pg_temp.ok((select status='waiting' and due_at between clock_timestamp()+interval '50 minutes' and clock_timestamp()+interval '1 hour'
  from private.automation_runs where workflow_id=pg_temp.id(36)),'the wait keeps the hour it had left, not two more days');
select pg_temp.ok(pg_temp.work() is null,'so nothing is due yet');
-- Third review follow-ups -------------------------------------------------------------------------
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(50,54) n;
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';

-- A run in a plain wait after its first reminder never acts on the old time, even when the worker reaches it
-- before the new time is admitted.
select pg_temp.publish(38,39,'Reminder then nudge, worker first','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"day","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"first","type":"create_task","version":1,"config":{"title":"Day-before reminder (F)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"pause","type":"wait","version":1,"config":{"duration":20,"unit":"hours"}},
    {"id":"nudge","type":"create_task","version":1,"config":{"title":"See you soon (F)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"day"},{"id":"b","source":"day","target":"first"},
    {"id":"c","source":"first","target":"pause"},{"id":"d","source":"pause","target":"nudge"}]}');
insert into booked select 50,pg_temp.book(81,50,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(38);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the day-before wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the day-before reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run sits in its plain wait');
update booked set starts=starts+interval '14 days' where n=50;
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts from booked where n=50),(select id from booked where n=50)));
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(38) and status='waiting';
select pg_temp.ok(pg_temp.work() is null,'the worker leaves the run in its plain wait alone');
select pg_temp.ok(public.automation_process_events(25)=1,'admitting the new time starts the automation again');
select pg_temp.ok(not exists(select from public.tasks where contact_id=pg_temp.id(50) and title='See you soon (F)'),
  'and the nudge for the old time is never made');
update public.workflows set status='paused' where id=pg_temp.id(38);

-- Taking back a cancellation brings back a run that had moved with a reschedule.
select pg_temp.publish(40,41,'Two reminders, moved then cancelled','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"day","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"first","type":"create_task","version":1,"config":{"title":"Day-before reminder (G)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"hour","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"hours"}},
    {"id":"second","type":"create_task","version":1,"config":{"title":"Hour-before reminder (G)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"day"},{"id":"b","source":"day","target":"first"},
    {"id":"c","source":"first","target":"hour"},{"id":"d","source":"hour","target":"second"}]}');
insert into booked select 51,pg_temp.book(82,51,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(40);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the day-before wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the day-before reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run waits for the hour before');
update booked set starts=date_trunc('minute',clock_timestamp())+interval '20 hours' where n=51;
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts from booked where n=51),(select id from booked where n=51)));
select pg_temp.ok(public.automation_process_events(25)=0,'the move keeps the run in place');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=51)));
select public.automation_process_events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from private.automation_runs where workflow_id=pg_temp.id(40)),
  'cancelling ends the run');
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=51)));
select pg_temp.ok(public.automation_process_events(25)=0,'reopening starts no second run');
select pg_temp.ok((select status='queued' and reason is null from private.automation_runs where workflow_id=pg_temp.id(40)),
  'the run that had moved with the reschedule carries on');
select pg_temp.ok(pg_temp.work()->>'result'='wait','and waits for the hour before the new time');
update public.workflows set status='paused' where id=pg_temp.id(40);

-- When admitting the new time is refused, here because the person who published the automation left, the run the
-- worker reached first keeps its place and still reminds for the new time.
select pg_temp.publish(42,43,'Two reminders, author leaves','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"day","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"first","type":"create_task","version":1,"config":{"title":"Day-before reminder (H)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"hour","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"hours"}},
    {"id":"second","type":"create_task","version":1,"config":{"title":"Hour-before reminder (H)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"day"},{"id":"b","source":"day","target":"first"},
    {"id":"c","source":"first","target":"hour"},{"id":"d","source":"hour","target":"second"}]}');
insert into booked select 52,pg_temp.book(83,52,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(42);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the day-before wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the day-before reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run waits for the hour before');
update booked set starts=starts+interval '14 days' where n=52;
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts from booked where n=52),(select id from booked where n=52)));
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(42) and status='waiting';
update public.profiles set status='Inactive' where id=pg_temp.id(10);
select pg_temp.ok(pg_temp.work() is null,'the worker leaves the run alone while the new time waits to be admitted');
select pg_temp.ok(public.automation_process_events(25)=0,'the admission is refused');
select pg_temp.ok((select r.status='waiting' and r.current_node_id='hour' and r.anchor_at=b.starts and r.due_at=b.starts-interval '1 hour'
    from private.automation_runs r,booked b where r.workflow_id=pg_temp.id(42) and b.n=52),
  'the run keeps its place and reminds an hour before the new time');
update public.profiles set status='Active' where id=pg_temp.id(10);
update public.workflows set status='paused' where id=pg_temp.id(42);

-- The same refusal after a move earlier, with a day-before reminder the author lets go out late: the pending
-- reminder still moves to the new time instead of staying after it.
select pg_temp.publish(44,45,'Two reminders, late allowed','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"day","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days","late":"continue"}},
    {"id":"first","type":"create_task","version":1,"config":{"title":"Day-before reminder (J)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"hour","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"hours"}},
    {"id":"second","type":"create_task","version":1,"config":{"title":"Hour-before reminder (J)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"day"},{"id":"b","source":"day","target":"first"},
    {"id":"c","source":"first","target":"hour"},{"id":"d","source":"hour","target":"second"}]}');
insert into booked select 53,pg_temp.book(84,53,date_trunc('minute',clock_timestamp())+interval '20 hours'),
  date_trunc('minute',clock_timestamp())+interval '20 hours';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the late day-before reminder goes ahead');
select pg_temp.ok(pg_temp.work()->>'result'='created','the day-before reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run waits for the hour before');
update booked set starts=date_trunc('minute',clock_timestamp())+interval '3 hours' where n=53;
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts from booked where n=53),(select id from booked where n=53)));
update public.profiles set status='Inactive' where id=pg_temp.id(10);
select pg_temp.ok(public.automation_process_events(25)=0,'the admission is refused');
select pg_temp.ok((select r.status='waiting' and r.anchor_at=b.starts and r.due_at=b.starts-interval '1 hour'
    from private.automation_runs r,booked b where r.workflow_id=pg_temp.id(44) and b.n=53),
  'the hour-before reminder moved to the new time');
update public.profiles set status='Active' where id=pg_temp.id(10);
update public.workflows set status='paused' where id=pg_temp.id(44);

-- A run still waiting to hear whether its last message was accepted does not hold the new time back.
select pg_temp.publish(46,47,'Two reminders, unconfirmed','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"day","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"first","type":"create_task","version":1,"config":{"title":"Day-before reminder (K)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"hour","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"hours"}},
    {"id":"second","type":"create_task","version":1,"config":{"title":"Hour-before reminder (K)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"day"},{"id":"b","source":"day","target":"first"},
    {"id":"c","source":"first","target":"hour"},{"id":"d","source":"hour","target":"second"}]}');
insert into booked select 54,pg_temp.book(85,54,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(46);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the day-before wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the day-before reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run waits for the hour before');
update private.automation_runs set status='unknown',ended_at=clock_timestamp(),reason='Awaiting confirmation of the original provider handoff'
  where workflow_id=pg_temp.id(46);
update booked set starts=starts+interval '14 days' where n=54;
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts from booked where n=54),(select id from booked where n=54)));
select pg_temp.ok(public.automation_process_events(25)=1,'the new time starts the automation again');
select pg_temp.ok((select status='stopped' and reason='Appointment was rescheduled' from private.automation_runs
  where workflow_id=pg_temp.id(46) and current_node_id='hour'),'the unconfirmed run ends');

-- Fourth review follow-ups ------------------------------------------------------------------------
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(55,56) n;
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
select pg_temp.publish(48,49,'Reminder, retyped while cancelled','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Reminder (L)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');

-- Taking back a cancellation that was restated, here by retyping the cancelled appointment, still revives the run.
insert into booked select 55,pg_temp.book(86,55,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=55)));
select public.automation_process_events(25);
select pg_temp.as_agent(format('update public.appointments set type=''Zoom review'' where id=%L',(select id from booked where n=55)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=55)));
select pg_temp.ok(public.automation_process_events(25)=0,'reopening starts no second run');
select pg_temp.ok((select status='queued' and reason is null from private.automation_runs where workflow_id=pg_temp.id(48)
  and contact_id=pg_temp.id(55)),'the run stopped by the cancellation carries on, though the cancellation was restated');

-- Moving an appointment that stays cancelled never starts reminders for it.
insert into booked select 56,pg_temp.book(87,56,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=56)));
select public.automation_process_events(25);
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=56)));
select pg_temp.ok(public.automation_process_events(25)=0,'a cancelled appointment moved to a new time starts nothing');
select pg_temp.ok(not exists(select from private.automation_runs where workflow_id=pg_temp.id(48) and contact_id=pg_temp.id(56)
  and status in ('queued','waiting','held')),'and no run for it is live');

-- Reopening it at that new time resumes its reminders, exactly once. The new slot has no outcome to take back, so the
-- appointment's own change log tells the automations it stands again.
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where workflow_id=pg_temp.id(48) and contact_id<>pg_temp.id(56) and status in ('queued','waiting','held');
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=56)));
select pg_temp.ok(public.automation_process_events(25)=0,'reopening the moved appointment starts no second run');
select pg_temp.ok(public.automation_process_events(25)=0,'nor does a later sweep');
select pg_temp.reopened_reminder_fires_once(56,'the appointment moved while cancelled, then reopened');

-- The same three changes reaching the worker late, after all of them were made: still one run, at the new time.
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(57,58) n;
insert into booked select 57,pg_temp.book(88,57,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=57)));
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=57)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=57)));
select public.automation_process_events(25);
select pg_temp.ok(public.automation_process_events(25)=0,'nothing more enrolls after the late sweep');
select pg_temp.reopened_reminder_fires_once(57,'all three changes handled after the fact');

-- The cancellation handled at once, the move and the reopening only later.
insert into booked select 58,pg_temp.book(89,58,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=58)));
select public.automation_process_events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from private.automation_runs
  where workflow_id=pg_temp.id(48) and contact_id=pg_temp.id(58)),'cancelling ends the reminder');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=58)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=58)));
select public.automation_process_events(25);
select pg_temp.ok(public.automation_process_events(25)=0,'nothing more enrolls');
select pg_temp.reopened_reminder_fires_once(58,'the move and the reopening handled together');

-- A booking the worker first processes while the appointment is cancelled starts no run, so nothing is stopped for a
-- reopening to carry on. Opening the appointment again still starts its reminders, exactly once. Only the reminder
-- automation stays active for these cases, so each one follows a single automation.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active' and id<>pg_temp.id(48);
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(70,74) n;
create function pg_temp.reminder_runs(lead_n integer) returns bigint language sql as $$
  select count(*) from private.automation_runs where workflow_id=pg_temp.id(48) and contact_id=pg_temp.id(lead_n)
$$;
create function pg_temp.first_seen_cancelled(appointment_n integer, lead_n integer) returns void language plpgsql as $$
declare appointment uuid;
begin
  insert into booked select lead_n,pg_temp.book(appointment_n,lead_n,date_trunc('minute',clock_timestamp())+interval '3 days'),
    date_trunc('minute',clock_timestamp())+interval '3 days';
  appointment:=(select id from booked where n=lead_n);
  perform pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',appointment));
  perform pg_temp.ok(public.automation_process_events(25)=0,'a booking first processed while cancelled enrolls nothing');
  perform pg_temp.ok((select processed_at is not null from private.automation_events where event_type='appointment_booked'
    and subject->>'appointment_id'=appointment::text),'the booking was processed');
  perform pg_temp.ok(pg_temp.reminder_runs(lead_n)=0,'and no run was ever started for it');
end $$;

-- Moved while cancelled, then opened again at the new time.
select pg_temp.first_seen_cancelled(120,70);
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=70)));
select pg_temp.ok(public.automation_process_events(25)=0 and pg_temp.reminder_runs(70)=0,
  'the move while cancelled starts nothing');
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=70)));
select public.automation_process_events(25);
select pg_temp.ok(pg_temp.reminder_runs(70)=1,'reopening at the new time starts one reminder run');
select pg_temp.ok((select r.paced_from=(select max(x.observed_at) from private.appointment_evidence_observations x
    where x.appointment_id=(select id from booked where n=70) and x.op='UPDATE'
      and private.appointment_status_key(x.prev->>'status')='cancelled' and private.appointment_status_key(x.next->>'status')='open')
  from private.automation_runs r where r.workflow_id=pg_temp.id(48) and r.contact_id=pg_temp.id(70)),
  'it counts from the recorded reopening, not from the move made while cancelled or from when the worker saw it');
-- Seeing the reopening again, or the worker processing the booking again, starts nothing more.
select private.automation_refresh_appointment_runs(pg_temp.id(1),(select id::text from booked where n=70));
select private.automation_refresh_appointment_runs(pg_temp.id(1),(select id::text from booked where n=70));
select pg_temp.ok((select count(*)=0 from (select private.automation_admit_event(e,i.id) admitted
    from private.automation_events e join public.automation_intervals i on i.organization_id=e.organization_id
      and i.workflow_id=pg_temp.id(48)
    where e.event_type='appointment_booked' and e.subject->>'appointment_id'=(select id::text from booked where n=70)) a
  where a.admitted<>0),'admitting the bookings again starts nothing');
select pg_temp.ok(pg_temp.reminder_runs(70)=1,'still one run after the reopening is seen again');
select pg_temp.reopened_reminder_fires_once(70,'a booking first processed while cancelled, moved and reopened');

-- Opened again at the same time it had when it was cancelled.
select pg_temp.first_seen_cancelled(121,71);
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=71)));
select public.automation_process_events(25);
select pg_temp.reopened_reminder_fires_once(71,'a booking first processed while cancelled, then reopened at its time');

-- Opened again at a time that has already passed: nothing to remind about.
select pg_temp.first_seen_cancelled(122,72);
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())-interval '2 hours',(select id from booked where n=72)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=72)));
select public.automation_process_events(25);
select pg_temp.ok(pg_temp.reminder_runs(72)=0,'an appointment reopened at a past time starts no reminders');

-- Booked, cancelled, moved and reopened before the worker sees any of it: one run, for the new time.
insert into booked select 73,pg_temp.book(123,73,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=73)));
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=73)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=73)));
select public.automation_process_events(25);
select pg_temp.reopened_reminder_fires_once(73,'every change made before the worker saw the booking');

-- Paused when the appointment reopens: the booking waits for the automation, which starts once when it resumes. The
-- automation is paused and resumed the way the builder does it, so it was off when the appointment moved and reopened.
select pg_temp.first_seen_cancelled(124,74);
select pg_temp.lifecycle(48,'pause');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=74)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=74)));
select public.automation_process_events(25);
select pg_temp.ok(pg_temp.reminder_runs(74)=0 and exists(select from private.automation_deferred_admissions d
    join private.automation_events e on e.id=d.event_id where d.workflow_id=pg_temp.id(48)
      and e.subject->>'appointment_id'=(select id::text from booked where n=74)),
  'a paused automation keeps the booking for when it resumes');
select pg_temp.lifecycle(48,'resume');
select public.automation_process_events(25);
select pg_temp.reopened_reminder_fires_once(74,'the automation resumed after the reopening');

-- An automation that stops on a reply starts nothing when the contact replied after the appointment was first booked,
-- as a run that a cancellation stopped would not carry on. The other reminder still starts.
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(75,76) n;
select pg_temp.publish(60,61,'Reminder that stops on a reply','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":true},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Reply-aware reminder","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');
select pg_temp.first_seen_cancelled(125,75);
insert into private.automation_reply_watermarks(organization_id,contact_type,contact_id,latest_reply_at)
  values(pg_temp.id(1),'lead',pg_temp.id(75),clock_timestamp());
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=75)));
select public.automation_process_events(25);
select pg_temp.ok((select count(*)=1 and bool_and(status='stopped' and reason='Verified reply received')
    from private.automation_runs where workflow_id=pg_temp.id(60) and contact_id=pg_temp.id(75)),
  'a reply after the booking keeps the stop-on-reply automation from starting, and its activity says why');
select pg_temp.ok(not exists(select from public.tasks t join private.automation_runs r on r.id=t.automation_run_id
  where r.workflow_id=pg_temp.id(60) and t.contact_id=pg_temp.id(75)),'and it gives no reminder');
select pg_temp.reopened_reminder_fires_once(75,'the reminder without stop on reply still starts');
update public.workflows set status='paused' where id=pg_temp.id(60);

-- An ordinary move of an appointment that stood, for an automation with no run for it: the new slot's booking is
-- admitted by its own processing and counts from that booking, however late the worker reaches it.
insert into booked select 76,pg_temp.book(126,76,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select public.automation_process_events(25);
select pg_temp.publish(62,63,'Reminder published after the booking','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Later reminder","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=76)));
select pg_sleep(0.05);
select public.automation_process_events(25);
select pg_temp.ok((select count(*)=1 from private.automation_runs r join private.automation_events e on e.id=r.event_id
    where r.workflow_id=pg_temp.id(62) and r.contact_id=pg_temp.id(76) and r.paced_from=e.occurred_at),
  'the moved booking starts the later automation once, counted from the booking');
update public.workflows set status='paused' where id=pg_temp.id(62);
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');

-- A booking taken up because its appointment was reopened counts its stop rules from when the automation began
-- following the appointment, so the same facts give the same answer whether or not the worker saw the booking before
-- the cancellation, and whatever order it sees the changes in. A pause around the changes keeps the booking, and a run
-- that already finished for the old time leaves the new time its reminders.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(87,99) n;
create function pg_temp.runs_for(workflow_n integer, lead_n integer) returns text language sql as $$
  select coalesce(string_agg(r.status||':'||coalesce(r.reason,'-'),'; ' order by e.id,r.id),'none')
  from private.automation_runs r join private.automation_events e on e.organization_id=r.organization_id and e.id=r.event_id
  where r.workflow_id=pg_temp.id(workflow_n) and e.subject->>'appointment_id'=(select id::text from booked where n=lead_n)
$$;
create function pg_temp.tasks_for(workflow_n integer, lead_n integer) returns bigint language sql as $$
  select count(*) from public.tasks t join private.automation_runs r on r.id=t.automation_run_id
    join private.automation_events e on e.organization_id=r.organization_id and e.id=r.event_id
  where r.workflow_id=pg_temp.id(workflow_n) and e.subject->>'appointment_id'=(select id::text from booked where n=lead_n)
$$;
-- The worker runs every active automation until nothing is left, each wait ending as soon as it is checked.
create function pg_temp.drive() returns void language plpgsql as $$
begin
  for i in 1..12 loop
    update private.automation_runs r set due_at=clock_timestamp()-interval '1 second'
      from public.workflows w where w.id=r.workflow_id and w.status='active' and r.status='waiting';
    exit when pg_temp.work() is null;
  end loop;
end $$;
create function pg_temp.booking(appointment_n integer, lead_n integer, days integer) returns void language sql as $$
  insert into booked select lead_n,pg_temp.book(appointment_n,lead_n,date_trunc('minute',clock_timestamp())+make_interval(days=>days)),
    date_trunc('minute',clock_timestamp())+make_interval(days=>days)
$$;
create function pg_temp.save(lead_n integer, changes text) returns void language plpgsql as $$
begin
  perform pg_temp.as_agent(format('update public.appointments set %s where id=%L',changes,(select id from booked where n=lead_n)));
end $$;
create function pg_temp.later(days integer) returns text language sql as $$
  select format('start_time=%L',date_trunc('minute',clock_timestamp())+make_interval(days=>days))
$$;
-- A conversation on a later call.
create function pg_temp.talk(lead_n integer) returns void language sql as $$
  insert into public.calls(id,organization_id,agent_id,contact_id,contact_type,contact_phone,direction,status,duration,started_at,
      dialer_admission_required)
    values(gen_random_uuid(),pg_temp.id(1),pg_temp.id(11),pg_temp.id(lead_n),'lead','+1202555'||lpad(lead_n::text,4,'0'),
      'outbound','completed',180,clock_timestamp(),false)
$$;
create function pg_temp.reply(lead_n integer) returns void language sql as $$
  select private.automation_cancel_reply(pg_temp.id(1),pg_temp.id(lead_n),'lead',clock_timestamp())
$$;

-- An automation that stops on a reply.
select pg_temp.publish(170,171,'Reminder that stops on a reply (lineage)','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":true},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Reminder (reply)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');
-- First seen cancelled, the contact replies, and one calendar save moves and reopens the appointment.
select pg_temp.booking(160,87,3);
select pg_temp.save(87,'status=''Cancelled''');
select pg_temp.ok(public.automation_process_events(25)=0,'lead 87: the booking first processed while cancelled starts nothing');
select pg_temp.reply(87);
select pg_temp.save(87,pg_temp.later(5)||',status=''Scheduled''');
select public.automation_process_events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(170,87)='stopped:Verified reply received' and pg_temp.tasks_for(170,87)=0,
  'a reply since the booking ends the reminders for an appointment moved and reopened in one save: '||pg_temp.runs_for(170,87));
-- The worker saw the booking while it stood. The contact replies after the cancellation, then one save moves and reopens.
select pg_temp.booking(161,88,3);
select pg_temp.ok(public.automation_process_events(25)=1 and pg_temp.work()->>'result'='wait','lead 88: the reminder run waits');
select pg_temp.save(88,'status=''Cancelled''');
select public.automation_process_events(25);
select pg_temp.reply(88);
select pg_temp.save(88,pg_temp.later(5)||',status=''Scheduled''');
select public.automation_process_events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(170,88)='stopped:Appointment was cancelled' and pg_temp.tasks_for(170,88)=0,
  'the run a cancellation stopped stays ended after a reply, and nothing starts for the new time: '||pg_temp.runs_for(170,88));
-- Two saves the worker sees in one pass: moved while cancelled, then reopened.
select pg_temp.booking(162,89,3);
select pg_temp.save(89,'status=''Cancelled''');
select public.automation_process_events(25);
select pg_temp.reply(89);
select pg_temp.save(89,pg_temp.later(5));
select pg_temp.save(89,'status=''Scheduled''');
select public.automation_process_events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(170,89)='stopped:Verified reply received' and pg_temp.tasks_for(170,89)=0,
  'a reply since the booking ends the reminders when the worker sees the move and the reopening together: '||pg_temp.runs_for(170,89));
-- An ordinary move of an appointment that stood, after a reply ended its reminders, starts the automation again for the
-- new time, counted from the move, as every booking does. (Whether stop rules should outlive a reschedule is a product
-- decision recorded in the release plan; this pins the behavior this round keeps.)
select pg_temp.booking(163,90,3);
select pg_temp.ok(public.automation_process_events(25)=1 and pg_temp.work()->>'result'='wait','lead 90: the reminder run waits');
select pg_temp.reply(90);
select pg_temp.save(90,pg_temp.later(5));
select public.automation_process_events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(170,90)='stopped:Verified reply received; completed:-' and pg_temp.tasks_for(170,90)=1,
  'an ordinary move after a reply starts the reminders again for the new time: '||pg_temp.runs_for(170,90));
select pg_temp.lifecycle(170,'pause');

-- An automation that stops when the contact is reached on a later call.
select pg_temp.publish(172,173,'Reminder that stops on contact','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false,"stop_on_contact":true},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Reminder (contact)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');
-- The same facts, seen in two orders: a conversation after the booking, then a cancellation, a move and a reopening.
select pg_temp.booking(164,91,3);
select pg_temp.ok(public.automation_process_events(25)=1 and pg_temp.work()->>'result'='wait','lead 91: the reminder run waits');
select pg_temp.talk(91);
select pg_temp.save(91,'status=''Cancelled''');
select public.automation_process_events(25);
select pg_temp.save(91,pg_temp.later(5));
select public.automation_process_events(25);
select pg_temp.save(91,'status=''Scheduled''');
select public.automation_process_events(25);
select pg_temp.booking(165,92,3);
select pg_temp.talk(92);
select pg_temp.save(92,'status=''Cancelled''');
select pg_temp.ok(public.automation_process_events(25)=0,'lead 92: the booking first processed while cancelled starts nothing');
select pg_temp.save(92,pg_temp.later(5));
select public.automation_process_events(25);
select pg_temp.save(92,'status=''Scheduled''');
select public.automation_process_events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(172,91)='stopped:Contact was reached' and pg_temp.tasks_for(172,91)=0
    and pg_temp.runs_for(172,92)='stopped:Contact was reached' and pg_temp.tasks_for(172,92)=0,
  'a conversation since the booking ends the reminders whichever way the worker saw the booking: '
    ||pg_temp.runs_for(172,91)||' / '||pg_temp.runs_for(172,92));
-- An ordinary move after the contact was reached starts the automation again for the new time, as above.
select pg_temp.booking(166,93,3);
select pg_temp.ok(public.automation_process_events(25)=1 and pg_temp.work()->>'result'='wait','lead 93: the reminder run waits');
select pg_temp.talk(93);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(172) and status='waiting';
select pg_temp.ok(pg_temp.work() is null and pg_temp.runs_for(172,93)='stopped:Contact was reached','lead 93: the conversation ends the run');
select pg_temp.save(93,pg_temp.later(5));
select public.automation_process_events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(172,93)='stopped:Contact was reached; completed:-' and pg_temp.tasks_for(172,93)=1,
  'an ordinary move after a conversation starts the reminders again for the new time: '||pg_temp.runs_for(172,93));
select pg_temp.lifecycle(172,'pause');

-- An automation that stops when the contact books another appointment.
select pg_temp.publish(174,175,'Reminder that stops on another booking','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false,"stop_on_booking":true},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Reminder (booking)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');
select pg_temp.booking(167,94,3);
select pg_temp.book(168,94,date_trunc('minute',clock_timestamp())+interval '4 days');
select pg_temp.save(94,'status=''Cancelled''');
select public.automation_process_events(25);
select pg_temp.save(94,pg_temp.later(5));
select public.automation_process_events(25);
select pg_temp.save(94,'status=''Scheduled''');
select public.automation_process_events(25);
select pg_temp.ok(pg_temp.runs_for(174,94)='stopped:Appointment booked',
  'another appointment booked since the first booking ends the reminders for the reopened one: '||pg_temp.runs_for(174,94));
select pg_temp.lifecycle(174,'pause');

-- A plain reminder: a run that finished for the old time, a pause around the move, and a restart counted from the
-- reopening.
select pg_temp.publish(176,177,'Plain reminder (lineage)','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Reminder (plain)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');
-- The reminder for the old time was given, then the appointment was cancelled, moved while cancelled and reopened,
-- with the worker seeing each change: the new time gets its reminder too.
select pg_temp.booking(169,95,3);
select pg_temp.ok(public.automation_process_events(25)=1,'lead 95: the booking enrolls');
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(176,95)='completed:-' and pg_temp.tasks_for(176,95)=1,'lead 95: the reminder for the old time was given');
select pg_temp.save(95,'status=''Cancelled''');
select public.automation_process_events(25);
select pg_temp.save(95,pg_temp.later(14));
select public.automation_process_events(25);
select pg_temp.save(95,'status=''Scheduled''');
select public.automation_process_events(25);
select public.automation_process_events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(176,95)='completed:-; completed:-' and pg_temp.tasks_for(176,95)=2,
  'a run that finished for the old time leaves the reopened new time its reminder: '||pg_temp.runs_for(176,95));
-- Booked five hours out, so the day-before reminder was skipped as too late; then cancelled, moved and reopened.
insert into booked select 96,pg_temp.book(181,96,date_trunc('minute',clock_timestamp())+interval '5 hours'),
  date_trunc('minute',clock_timestamp())+interval '5 hours';
select pg_temp.ok(public.automation_process_events(25)=1,'lead 96: the booking enrolls');
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(176,96)='completed:The reminder time had already passed','lead 96: the reminder was too late');
select pg_temp.save(96,'status=''Cancelled''');
select public.automation_process_events(25);
select pg_temp.save(96,pg_temp.later(7));
select public.automation_process_events(25);
select pg_temp.save(96,'status=''Scheduled''');
select public.automation_process_events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.tasks_for(176,96)=1,
  'a reminder skipped as too late for the old time is given for the reopened new time: '||pg_temp.runs_for(176,96));
-- First seen cancelled, the automation paused only while the appointment was moved, and resumed before the reopening.
select pg_temp.booking(182,97,3);
select pg_temp.save(97,'status=''Cancelled''');
select pg_temp.ok(public.automation_process_events(25)=0,'lead 97: the booking first processed while cancelled starts nothing');
select pg_temp.lifecycle(176,'pause');
select pg_temp.save(97,pg_temp.later(5));
select public.automation_process_events(25);
select pg_temp.lifecycle(176,'resume');
select pg_temp.save(97,'status=''Scheduled''');
select public.automation_process_events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(176,97)='completed:-' and pg_temp.tasks_for(176,97)=1,
  'an automation paused only while the appointment moved still reminds about the reopened time: '||pg_temp.runs_for(176,97));
select pg_temp.lifecycle(176,'pause');

-- A run that started over for the reopened new time counts from the recorded reopening, however late the worker is.
select pg_temp.publish(178,179,'Two reminders (lineage)','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"day","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"first","type":"create_task","version":1,"config":{"title":"Day-before reminder (lineage)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"hour","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"hours"}},
    {"id":"second","type":"create_task","version":1,"config":{"title":"Hour-before reminder (lineage)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"day"},{"id":"b","source":"day","target":"first"},
    {"id":"c","source":"first","target":"hour"},{"id":"d","source":"hour","target":"second"}]}');
select pg_temp.booking(183,98,3);
select pg_temp.ok(public.automation_process_events(25)=1 and pg_temp.work()->>'result'='wait','lead 98: it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(178);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed' and pg_temp.work()->>'result'='created'
  and pg_temp.work()->>'result'='wait','lead 98: the day-before reminder is given and the run waits for the hour before');
select pg_temp.save(98,'status=''Cancelled''');
select public.automation_process_events(25);
select pg_temp.save(98,pg_temp.later(14));
select public.automation_process_events(25);
select pg_temp.save(98,'status=''Scheduled''');
select pg_sleep(0.5);
select public.automation_process_events(25);
select pg_temp.ok((select count(*)=1 from private.automation_runs r where r.workflow_id=pg_temp.id(178) and r.contact_id=pg_temp.id(98)
    and r.status in ('queued','waiting') and r.paced_from=(select max(x.observed_at) from private.appointment_evidence_observations x
      where x.appointment_id=(select id from booked where n=98) and x.op='UPDATE'
        and private.appointment_status_key(x.prev->>'status')='cancelled' and private.appointment_status_key(x.next->>'status')='open')),
  'the run that starts over for the new time counts from the recorded reopening, not from when the worker saw it');
select pg_temp.lifecycle(178,'pause');
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');

-- Live texts and emails go to leads only in this release (the worker skips them for anyone else, see runtime_test.ts).
-- An internal task still works for a client or a recruit with an active agent.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
select pg_temp.publish(50,51,'Reminder task for any contact','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Prepare for the review","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');
insert into public.clients(id,organization_id,first_name,last_name,assigned_agent_id) values (pg_temp.id(59),pg_temp.id(1),'Client','Reviewed',pg_temp.id(11));
insert into public.recruits(id,organization_id,first_name,last_name,assigned_agent_id) values (pg_temp.id(60),pg_temp.id(1),'Recruit','Reviewed',pg_temp.id(11));
insert into booked select 59,pg_temp.book(90,59,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
insert into booked select 60,pg_temp.book(91,60,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=2,'a client''s and a recruit''s bookings enroll');
select pg_temp.ok(pg_temp.work()->>'result'='wait' and pg_temp.work()->>'result'='wait','both wait for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(50);
select pg_temp.work() from generate_series(1,4);
select pg_temp.ok((select count(*)=2 and bool_and(t.assigned_to=pg_temp.id(11)) and bool_and(t.contact_type=r.contact_type)
    and array_agg(t.contact_type order by t.contact_type)=array['client','recruit']
  from public.tasks t join private.automation_runs r on r.id=t.automation_run_id where r.workflow_id=pg_temp.id(50)),
  'the client and the recruit each get the reminder task, assigned to their agent');
-- A run that carries on after its appointment stood again never dates its next task to a moment while the appointment
-- was cancelled.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(61,62) n;
create temporary table reopened(n integer primary key, at timestamptz) on commit drop;
select pg_temp.publish(52,53,'Late reminder after a reopening','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days","late":"continue"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Confirm (M)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');
-- Booked days ago for three days out, cancelled, moved while cancelled to 20 hours from now (so the day-before time has
-- already passed), then reopened.
insert into booked select 61,pg_temp.book(92,61,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set paced_from=clock_timestamp()-interval '2 days' where workflow_id=pg_temp.id(52);
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=61)));
select public.automation_process_events(25);
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '20 hours',(select id from booked where n=61)));
select public.automation_process_events(25);
insert into reopened values (61,clock_timestamp());
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=61)));
select public.automation_process_events(25);
select pg_temp.ok((select status='queued' from private.automation_runs where workflow_id=pg_temp.id(52)),'the run carries on');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the day-before time has passed and the author lets it go out late');
select pg_temp.ok(pg_temp.work()->>'result'='created','the task is created');
select pg_temp.ok((select t.due_date>=o.at from public.tasks t join private.automation_runs r on r.id=t.automation_run_id, reopened o
  where r.workflow_id=pg_temp.id(52) and o.n=61),
  'it is due from the reopening, not from the passed reminder time while the appointment was cancelled');

update public.workflows set status='paused' where id=pg_temp.id(52);
select pg_temp.publish(54,55,'Wait across a cancellation','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"pause","type":"wait","version":1,"config":{"duration":2,"unit":"days"}},
    {"id":"confirm","type":"create_task","version":1,"config":{"title":"Confirm (N)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"pause"},{"id":"b","source":"pause","target":"confirm"}]}');
-- The plain wait's end passes while the appointment is cancelled.
insert into booked select 62,pg_temp.book(93,62,date_trunc('minute',clock_timestamp())+interval '5 days'),
  date_trunc('minute',clock_timestamp())+interval '5 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the plain wait starts');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=62)));
select public.automation_process_events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from private.automation_runs
  where workflow_id=pg_temp.id(54)),'cancelling ends the run');
update private.automation_runs set due_at=clock_timestamp()-interval '1 hour',paced_from=clock_timestamp()-interval '2 days'
  where workflow_id=pg_temp.id(54);
insert into reopened values (62,clock_timestamp());
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=62)));
select pg_temp.ok(public.automation_process_events(25)=0,'reopening starts no second run');
select pg_temp.ok((select r.status='waiting' and r.due_at>=o.at from private.automation_runs r,reopened o
  where r.workflow_id=pg_temp.id(54) and o.n=62),'the wait whose end passed while cancelled ends on reopening');
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the wait ends');
select pg_temp.ok(pg_temp.work()->>'result'='created','the task is created');
select pg_temp.ok((select t.due_date>=o.at from public.tasks t join private.automation_runs r on r.id=t.automation_run_id, reopened o
  where r.workflow_id=pg_temp.id(54) and o.n=62),'it is due from the reopening, not from the wait''s end while cancelled');
-- A run whose first reminder already went out, cancelled, moved while cancelled and reopened: as with a move of an
-- appointment that stood, the automation starts over for the new time and gives it both reminders, once each, whether
-- the worker sees each change as it happens or all three afterwards.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(63,66) n;
select pg_temp.publish(56,57,'Two reminders across a cancellation','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"day","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"first","type":"create_task","version":1,"config":{"title":"Day-before reminder (P)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"hour","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"hours"}},
    {"id":"second","type":"create_task","version":1,"config":{"title":"Hour-before reminder (P)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"day"},{"id":"b","source":"day","target":"first"},
    {"id":"c","source":"first","target":"hour"},{"id":"d","source":"hour","target":"second"}]}');
create function pg_temp.first_reminder_given(lead_n integer) returns void language plpgsql as $$
begin
  perform pg_temp.ok(public.automation_process_events(25)=1,'lead '||lead_n||': the booking enrolls');
  perform pg_temp.ok(pg_temp.work()->>'result'='wait','lead '||lead_n||': it waits for the day before');
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(56) and contact_id=pg_temp.id(lead_n);
  perform pg_temp.ok(pg_temp.work()->>'result'='elapsed','lead '||lead_n||': the day before arrives');
  perform pg_temp.ok(pg_temp.work()->>'result'='created','lead '||lead_n||': the day-before reminder is given for the first time');
  perform pg_temp.ok(pg_temp.work()->>'result'='wait','lead '||lead_n||': the run waits for the hour before');
end $$;
create function pg_temp.new_time_gets_both(lead_n integer, story text) returns void language plpgsql as $$
declare starts timestamptz; live private.automation_runs;
begin
  select a.start_time into strict starts from public.appointments a join booked b on b.id=a.id where b.n=lead_n;
  perform pg_temp.ok((select count(*)=1 from private.automation_runs where workflow_id=pg_temp.id(56) and contact_id=pg_temp.id(lead_n)
    and status='stopped' and reason in ('Appointment was cancelled','Appointment was rescheduled')),
    story||': the run that reminded for the old time has ended');
  perform pg_temp.ok((select count(*)=1 from private.automation_runs where workflow_id=pg_temp.id(56) and contact_id=pg_temp.id(lead_n)
    and status in ('queued','waiting','held')),story||': exactly one run follows the new time');
  select * into strict live from private.automation_runs where workflow_id=pg_temp.id(56) and contact_id=pg_temp.id(lead_n)
    and status in ('queued','waiting','held');
  if live.status='queued' then perform pg_temp.ok(pg_temp.work()->>'result'='wait',story||': the new run is placed'); end if;
  select * into strict live from private.automation_runs where id=live.id;
  perform pg_temp.ok(live.current_node_id='day' and live.status='waiting' and live.anchor_at=starts
    and live.due_at=((starts at time zone 'America/New_York')-interval '1 day') at time zone 'America/New_York',
    story||': it waits for the new time''s day-before reminder');
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where id=live.id;
  perform pg_temp.ok(pg_temp.work()->>'result'='elapsed' and pg_temp.work()->>'result'='created',story||': the day-before reminder for the new time');
  perform pg_temp.ok(pg_temp.work()->>'result'='wait',story||': then it waits for the hour before');
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where id=live.id;
  perform pg_temp.ok(pg_temp.work()->>'result'='elapsed' and pg_temp.work()->>'result'='created',story||': the hour-before reminder for the new time');
  perform pg_temp.ok(public.automation_process_events(25)=0 and pg_temp.work() is null,story||': nothing else is due');
  perform pg_temp.ok((select count(*) filter (where t.title='Day-before reminder (P)')=2 and count(*) filter (where t.title='Hour-before reminder (P)')=1
    from public.tasks t join private.automation_runs r on r.id=t.automation_run_id where r.workflow_id=pg_temp.id(56) and t.contact_id=pg_temp.id(lead_n)),
    story||': one day-before reminder for each time and one hour-before reminder for the new time');
end $$;
insert into booked select 63,pg_temp.book(94,63,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.first_reminder_given(63);
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=63)));
select public.automation_process_events(25);
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '10 days',(select id from booked where n=63)));
select public.automation_process_events(25);
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=63)));
select public.automation_process_events(25);
select pg_temp.new_time_gets_both(63,'each change seen as it happened');

insert into booked select 64,pg_temp.book(95,64,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.first_reminder_given(64);
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=64)));
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '10 days',(select id from booked where n=64)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=64)));
select public.automation_process_events(25);
select public.automation_process_events(25);
select pg_temp.new_time_gets_both(64,'all three changes seen afterwards');

insert into booked select 66,pg_temp.book(97,66,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.first_reminder_given(66);
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=66)));
select public.automation_process_events(25);
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '10 days',(select id from booked where n=66)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=66)));
select public.automation_process_events(25);
select public.automation_process_events(25);
select pg_temp.new_time_gets_both(66,'the cancellation seen at once, the move and the reopening together');

-- A verified reply while the appointment was cancelled ends the run for an automation that stops on a reply, so
-- reopening the appointment does not bring it back.
update public.workflows set status='paused' where id=pg_temp.id(56);
select pg_temp.publish(58,59,'Reminder that stops on a reply','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":true},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Reminder (Q)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');
insert into booked select 65,pg_temp.book(96,65,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=65)));
select public.automation_process_events(25);
select private.automation_cancel_reply(pg_temp.id(1),pg_temp.id(65),'lead',clock_timestamp());
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=65)));
select public.automation_process_events(25);
select pg_temp.ok(not exists(select from private.automation_runs where workflow_id=pg_temp.id(58) and status in ('queued','waiting','held')),
  'the run a reply ended stays ended when the appointment is reopened');
select pg_temp.ok(pg_temp.work() is null and not exists(select from public.tasks where contact_id=pg_temp.id(65)),'and no reminder is given');
-- The last check before a text goes to a provider. A reminder the worker has already picked up is not handed off
-- once its appointment has moved or been cancelled, and a text about a booking always describes the appointment's
-- current time. The worker holds a refused message, and the next lease settles what happened.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
update private.automation_release_controls set dispatch_enabled=true where organization_id=pg_temp.id(1);
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(80,85) n;
select pg_temp.publish(140,141,'Text reminders','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"hour","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"hours"}},
    {"id":"text","type":"send_sms","version":1,"config":{"body":"See you at {{appointment_time}}","purpose":"informational"}},
    {"id":"soon","type":"wait_until_before_appointment","version":1,"config":{"amount":10,"unit":"minutes"}},
    {"id":"last","type":"send_sms","version":1,"config":{"body":"Starting soon","purpose":"informational"}}],
  "edges":[{"id":"a","source":"start","target":"hour"},{"id":"b","source":"hour","target":"text"},
    {"id":"c","source":"text","target":"soon"},{"id":"d","source":"soon","target":"last"}]}');
create temporary table leases(n integer primary key, lease jsonb) on commit drop;
create function pg_temp.slot(lead_n integer) returns uuid language sql as $$
  select s.occurrence_id from private.automation_appointment_state(pg_temp.id(1),(select id from booked where n=lead_n)) s
$$;
create function pg_temp.texts(lead_n integer) returns private.automation_runs language sql as $$
  select r from private.automation_runs r where r.workflow_id=pg_temp.id(140) and r.contact_id=pg_temp.id(lead_n)
    order by r.ended_at is null desc,r.started_at desc limit 1
$$;
create function pg_temp.hand_off(lead_n integer) returns boolean language sql as $$
  select public.automation_authorize_handoff((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,lease->>'node_id')
  from leases where n=lead_n
$$;
create function pg_temp.check(lead_n integer) returns text language sql as $$
  select public.automation_message_check((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,lease->>'node_id')
  from leases where n=lead_n
$$;
create function pg_temp.intent(lead_n integer) returns text language sql as $$
  select i.status from private.automation_intents i join leases l on l.n=lead_n
  where i.run_id=(l.lease->>'run_id')::uuid and i.node_id=l.lease->>'node_id'
$$;
-- The worker holds a message whose handoff was refused, as it does for any refusal.
create function pg_temp.held(lead_n integer) returns void language plpgsql as $$
begin
  perform pg_temp.ok(public.automation_finish_node((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,'held',
    'Run no longer permits a provider handoff.'),'lead '||lead_n||': the worker holds the message') from leases where n=lead_n;
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where id=(select (lease->>'run_id')::uuid from leases where n=lead_n);
end $$;
-- Book, wait for the hour before, and let the worker pick up the reminder text.
create function pg_temp.text_picked_up(appointment_n integer, lead_n integer, starts timestamptz) returns void language plpgsql as $$
declare lease jsonb; run private.automation_runs;
begin
  insert into booked select lead_n,pg_temp.book(appointment_n,lead_n,starts),starts;
  perform pg_temp.ok(public.automation_process_events(25)=1,'lead '||lead_n||': the booking enrolls');
  perform pg_temp.ok(pg_temp.work()->>'result'='wait','lead '||lead_n||': it waits for the hour before');
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(140) and contact_id=pg_temp.id(lead_n);
  perform pg_temp.ok(pg_temp.work()->>'result'='elapsed','lead '||lead_n||': the hour before arrives');
  select * into lease from public.automation_claim_work(1);
  run:=pg_temp.texts(lead_n);
  perform pg_temp.ok(lease->>'run_id'=run.id::text and lease->>'node_id'='text'
    and (lease#>>'{context,appointment_start}')::timestamptz=starts and run.leased_for=pg_temp.slot(lead_n)
    and run.reminded_for=pg_temp.slot(lead_n),'lead '||lead_n||': the worker picks up the reminder for the appointment''s time');
  insert into leases values (lead_n,lease);
end $$;

-- Moved after the worker picked up its reminder: the reminder for the old time is never handed off, and the
-- automation starts over for the new time.
select pg_temp.text_picked_up(150,80,date_trunc('minute',clock_timestamp())+interval '3 hours');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '2 days',(select id from booked where n=80)));
select pg_temp.ok(pg_temp.check(80)='The appointment moved after this message was prepared',
  'asked before a provider request is reserved, the worker learns the appointment moved');
select pg_temp.ok(not pg_temp.hand_off(80) and pg_temp.intent(80)='prepared',
  'a reminder picked up before its appointment moved is refused, and nothing is recorded as handed off');
select pg_temp.held(80);
select pg_temp.ok(pg_temp.work() is null and (pg_temp.texts(80)).status='held'
  and (pg_temp.texts(80)).due_at>clock_timestamp(),'the held reminder waits while the new time is still to be admitted');
select public.automation_process_events(25);
select pg_temp.ok((select count(*)=1 from private.automation_runs where workflow_id=pg_temp.id(140) and contact_id=pg_temp.id(80)
    and status='stopped' and reason='Appointment was rescheduled' and current_node_id='text')
  and (select count(*)=1 from private.automation_runs where workflow_id=pg_temp.id(140) and contact_id=pg_temp.id(80)
    and status in ('queued','waiting','held')),'the run for the old time ended and one run follows the new time');
do $$
declare turn jsonb:=pg_temp.work();
begin
  perform pg_temp.ok(turn->>'result'='wait' and (turn#>>'{context,appointment_start}')::timestamptz=(select a.start_time
      from public.appointments a join booked b on b.id=a.id where b.n=80)
    and (pg_temp.texts(80)).due_at=(select a.start_time-interval '1 hour' from public.appointments a join booked b on b.id=a.id where b.n=80),
    'the new run waits until an hour before the new time');
end $$;

-- Cancelled after the worker picked up its reminder: refused, and the next lease ends the run.
select pg_temp.text_picked_up(151,81,date_trunc('minute',clock_timestamp())+interval '3 hours');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=81)));
select pg_temp.ok(pg_temp.check(81)='Appointment was cancelled','asked first, the worker learns the appointment was cancelled');
select pg_temp.ok(not pg_temp.hand_off(81) and pg_temp.intent(81)='prepared',
  'a reminder picked up before its appointment was cancelled is refused, and nothing is recorded as handed off');
select pg_temp.held(81);
select pg_temp.ok(pg_temp.work() is null and (pg_temp.texts(81)).status='stopped' and (pg_temp.texts(81)).reason='Appointment was cancelled',
  'the next lease ends the run because the appointment was cancelled');

-- Moved closer, past the hour before the new time: the automation does not start over, so the run keeps its place.
-- The reminder written for the old time is skipped, and the run goes on to the next reminder for the new time.
select pg_temp.text_picked_up(152,82,date_trunc('minute',clock_timestamp())+interval '3 hours');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '30 minutes',(select id from booked where n=82)));
select pg_temp.ok(not pg_temp.hand_off(82),'a reminder picked up before its appointment moved closer is refused');
select pg_temp.held(82);
select public.automation_process_events(25);
select pg_temp.ok((select count(*)=1 from private.automation_runs where workflow_id=pg_temp.id(140) and contact_id=pg_temp.id(82)),
  'the automation does not start over when the new time is inside the hour already passed');
do $$
declare turn jsonb:=pg_temp.work(); run private.automation_runs:=pg_temp.texts(82);
begin
  perform pg_temp.ok(turn is null and (select status='skipped' and reason='The appointment moved after this reminder was due'
      from private.automation_steps where run_id=run.id and node_id='text'),
    'the reminder for the old time is skipped instead of being handed to the worker');
  turn:=pg_temp.work();
  perform pg_temp.ok(turn->>'result'='wait' and turn->>'node_id'='soon','the run goes on to its next step');
  run:=pg_temp.texts(82);
  perform pg_temp.ok(run.status='waiting' and run.anchor_id=pg_temp.slot(82)
    and run.due_at=(select a.start_time-interval '10 minutes' from public.appointments a join booked b on b.id=a.id where b.n=82),
    'which waits until ten minutes before the new time');
  perform pg_temp.ok(not exists(select from private.automation_messages where run_id=run.id),'no text was written for either time');
end $$;

-- Not moved: the reminder is handed off.
select pg_temp.text_picked_up(153,83,date_trunc('minute',clock_timestamp())+interval '3 hours');
select pg_temp.ok(pg_temp.check(83) is null,'nothing keeps a reminder for the appointment''s current time from going out');
select pg_temp.ok(pg_temp.hand_off(83) and pg_temp.intent(83)='handed_off','a reminder for the appointment''s current time is handed off');
update private.automation_runs set leased_until=clock_timestamp()-interval '1 second' where id=(pg_temp.texts(83)).id;
select pg_temp.ok(pg_temp.check(83) is null,
  'once handed off, the early check leaves the message to its own record, so a replay finds its receipt');
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where id=(pg_temp.texts(83)).id;

-- The calendar moved the appointment but its slot record could not be written in time (a capture gap). The message
-- still describes the old time, so it is not handed off.
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  values (pg_temp.id(86),pg_temp.id(1),'Lead 86','+12025550086',pg_temp.id(11),pg_temp.id(11));
select pg_temp.text_picked_up(156,86,date_trunc('minute',clock_timestamp())+interval '3 hours');
alter table public.appointments disable trigger appointments_v3_evidence_capture;
update public.appointments set start_time=start_time+interval '1 day',end_time=end_time+interval '1 day'
  where id=(select id from booked where n=86);
alter table public.appointments enable trigger appointments_v3_evidence_capture;
select pg_temp.ok(pg_temp.slot(86)=(pg_temp.texts(86)).leased_for
  and pg_temp.check(86)='The appointment''s new time is not recorded yet' and not pg_temp.hand_off(86),
  'a move the slot record missed still refuses the old time''s reminder, and says why');

-- A message that may already be with a provider is reconciled, not skipped, when its appointment moves.
select pg_temp.text_picked_up(154,84,date_trunc('minute',clock_timestamp())+interval '3 hours');
select pg_temp.ok(pg_temp.hand_off(84),'the reminder is handed off');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '30 minutes',(select id from booked where n=84)));
update private.automation_runs set leased_until=clock_timestamp()-interval '1 second' where id=(pg_temp.texts(84)).id;
do $$
declare lease jsonb;
begin
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.ok(lease->>'run_id'=(pg_temp.texts(84)).id::text and lease->>'node_id'='text'
    and (lease->>'uncertain_handoff')::boolean
    and not exists(select from private.automation_steps where run_id=(pg_temp.texts(84)).id and node_id='text'),
    'a lease that ended after the handoff comes back for reconciliation, not as a skipped reminder');
  perform pg_temp.ok(public.automation_finish_node((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,'unknown',
    'Awaiting the provider receipt'),'it waits for the provider receipt');
end $$;

-- A booking confirmation, sent without waiting, follows the appointment too: a move after it was picked up is
-- refused, and the next lease describes the new time and is handed off.
update public.workflows set status='paused' where id=pg_temp.id(140);
select pg_temp.publish(142,143,'Booking confirmation text','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"text","type":"send_sms","version":1,"config":{"body":"Booked for {{appointment_time}}","purpose":"informational"}}],
  "edges":[{"id":"a","source":"start","target":"text"}]}');
insert into booked select 85,pg_temp.book(155,85,date_trunc('minute',clock_timestamp())+interval '2 days'),
  date_trunc('minute',clock_timestamp())+interval '2 days';
select pg_temp.ok(public.automation_process_events(25)=1,'the booking enrolls the confirmation');
do $$
declare lease jsonb; run private.automation_runs;
begin
  select * into lease from public.automation_claim_work(1);
  select * into strict run from private.automation_runs where id=(lease->>'run_id')::uuid;
  perform pg_temp.ok(run.contact_id=pg_temp.id(85) and run.reminded_for is null and run.leased_for=pg_temp.slot(85),
    'the confirmation is picked up for the booked time');
  insert into leases values (85,lease);
end $$;
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '4 days',(select id from booked where n=85)));
select pg_temp.ok(not pg_temp.hand_off(85),'a confirmation picked up before the appointment moved is refused');
select pg_temp.held(85);
select public.automation_process_events(25);
update leases set n=185 where n=85;
do $$
declare lease jsonb;
begin
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.ok(lease->>'node_id'='text' and (lease#>>'{context,appointment_start}')::timestamptz=(select a.start_time
      from public.appointments a join booked b on b.id=a.id where b.n=85),'the next lease describes the new time');
  insert into leases values (85,lease);
end $$;
select pg_temp.ok(pg_temp.check(185)='This step is no longer leased to this worker' and not pg_temp.hand_off(185),
  'the earlier lease is reported as ended and can hand nothing off');
select pg_temp.ok(pg_temp.check(85) is null and pg_temp.hand_off(85) and pg_temp.intent(85)='handed_off',
  'and that confirmation is handed off');

-- A reminder for the time the appointment is at again, after it moved away and back, still goes out.
-- Bookings a paused automation kept from earlier cases are not part of these.
update public.workflows set status='paused' where id=pg_temp.id(142);
delete from private.automation_deferred_admissions where workflow_id=pg_temp.id(140);
update public.workflows set status='active' where id=pg_temp.id(140);
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held','unknown');
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(100,103) n;
insert into booked select 100,pg_temp.book(184,100,date_trunc('minute',clock_timestamp())+interval '3 hours'),
  date_trunc('minute',clock_timestamp())+interval '3 hours';
select pg_temp.ok(public.automation_process_events(25)=1 and pg_temp.work()->>'result'='wait','lead 100: it waits for the hour before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(140) and contact_id=pg_temp.id(100);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','lead 100: the hour before arrives');
select pg_temp.as_agent(format('update public.appointments set start_time=start_time+interval ''1 day'',end_time=end_time+interval ''1 day'' where id=%L',
  (select id from booked where n=100)));
select pg_temp.as_agent(format('update public.appointments set start_time=%L,end_time=%L where id=%L',
  (select starts from booked where n=100),(select starts+interval '30 minutes' from booked where n=100),(select id from booked where n=100)));
select public.automation_process_events(25);
do $$
declare lease jsonb; run private.automation_runs;
begin
  select * into lease from public.automation_claim_work(1);
  run:=pg_temp.texts(100);
  perform pg_temp.ok(lease->>'run_id'=run.id::text and lease->>'node_id'='text' and run.reminded_for=pg_temp.slot(100)
      and run.leased_for=pg_temp.slot(100) and run.anchor_id=pg_temp.slot(100)
      and (lease#>>'{context,appointment_start}')::timestamptz=(select starts from booked where n=100),
    'a reminder for the time the appointment moved back to is handed to the worker, not skipped');
  insert into leases values (100,lease);
end $$;
select pg_temp.ok(pg_temp.check(100) is null and pg_temp.hand_off(100) and pg_temp.intent(100)='handed_off',
  'and it is handed off');
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where id=(pg_temp.texts(100)).id;

-- A cancelled-before-handoff text reservation is cleared by the worker holding the step's lease, and only that one.
select pg_temp.text_picked_up(185,101,date_trunc('minute',clock_timestamp())+interval '3 hours');
create function pg_temp.reservation(lead_n integer, reservation_state text, code text, sid text) returns void language sql as $$
  insert into public.sms_dispatches(organization_id,request_key,payload_hash,phone_e164,from_number,body,purpose,evidence_ids,state,
      error_code,provider_sid)
    select pg_temp.id(1),'automation:'||(lease->>'run_id')||':text','fixture','+1202555'||lpad(lead_n::text,4,'0'),'+12025550999',
      'Reminder','informational','{}'::uuid[],reservation_state,code,sid
    from leases where n=lead_n
$$;
create function pg_temp.release(lead_n integer, token uuid default null) returns boolean language sql as $$
  select public.automation_release_refused_dispatch((lease->>'run_id')::uuid,coalesce(token,(lease->>'lease_token')::uuid),
    lease->>'node_id') from leases where n=lead_n
$$;
create function pg_temp.reserved(lead_n integer) returns text language sql as $$
  select coalesce((select d.state||':'||coalesce(d.error_code,'-') from public.sms_dispatches d join leases l on l.n=lead_n
    where d.request_key='automation:'||(l.lease->>'run_id')||':text'),'none')
$$;
select pg_temp.ok(pg_temp.release(101) and pg_temp.reserved(101)='none','with nothing reserved there is nothing to clear');
select pg_temp.ok(pg_temp.release(101,gen_random_uuid()),
  'nothing to clear needs no lease, so a replay after the step moved on goes on to its own receipt');
select pg_temp.reservation(101,'failed','pre_handoff_cancelled',null);
select pg_temp.ok(not pg_temp.release(101,gen_random_uuid()) and pg_temp.reserved(101)='failed:pre_handoff_cancelled',
  'a worker without the step''s lease clears nothing');
select pg_temp.ok(pg_temp.release(101) and pg_temp.reserved(101)='none',
  'the lease holder clears a reservation cancelled before any handoff, so the text can try again');
select pg_temp.reservation(101,'failed','provider_rejected','SM00000000000000000000000000000001');
select pg_temp.ok(pg_temp.release(101) and pg_temp.reserved(101)='failed:provider_rejected',
  'a text a provider saw is never cleared');
delete from public.sms_dispatches where request_key like 'automation:'||(select lease->>'run_id' from leases where n=101)||':%';
select pg_temp.reservation(101,'attempting',null,null);
select pg_temp.ok(pg_temp.release(101) and pg_temp.reserved(101)='attempting:-','an attempt in progress is never cleared');
delete from public.sms_dispatches where request_key like 'automation:'||(select lease->>'run_id' from leases where n=101)||':%';
select pg_temp.ok(pg_temp.hand_off(101),'the text is handed off');
select pg_temp.reservation(101,'failed','pre_handoff_cancelled',null);
select pg_temp.ok(pg_temp.release(101) and pg_temp.reserved(101)='failed:pre_handoff_cancelled',
  'nor is one whose step was already handed off');
delete from public.sms_dispatches where request_key like 'automation:'||(select lease->>'run_id' from leases where n=101)||':%';
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where id=(pg_temp.texts(101)).id;

-- A text timed before its appointment is not sent once the appointment has started: one held past the start is
-- skipped, and a step timed after the start still goes out.
update public.workflows set status='paused' where id=pg_temp.id(140);
delete from private.automation_deferred_admissions where workflow_id=pg_temp.id(142);
update public.workflows set status='active' where id=pg_temp.id(142);
insert into booked select 102,pg_temp.book(186,102,clock_timestamp()+interval '3 seconds'),clock_timestamp()+interval '3 seconds';
insert into booked select 103,pg_temp.book(187,103,clock_timestamp()+interval '3 seconds'),clock_timestamp()+interval '3 seconds';
select pg_temp.ok(public.automation_process_events(25)=2,'leads 102 and 103: the bookings enroll the confirmation');
update private.automation_runs set due_at=clock_timestamp()+interval '1 hour' where workflow_id=pg_temp.id(142) and contact_id=pg_temp.id(103);
do $$
declare lease jsonb;
begin
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.ok(lease->>'node_id'='text' and lease->>'contact_id'=pg_temp.id(102)::text,'lead 102: the confirmation is picked up');
  insert into leases values (102,lease);
end $$;
select pg_sleep(greatest(0,extract(epoch from (select max(starts) from booked where n in (102,103))-clock_timestamp()))+0.2);
select pg_temp.ok(pg_temp.check(102)='The appointment had already started' and not pg_temp.hand_off(102)
    and pg_temp.intent(102)='prepared','a confirmation picked up before the appointment started is refused once it has');
select pg_temp.held(102);
-- The other run's step is timed after the start, as one after a wait that ended then would be.
update private.automation_runs set paced_from=(select starts+interval '1 second' from booked where n=103),
    due_at=clock_timestamp()-interval '1 second'
  where workflow_id=pg_temp.id(142) and contact_id=pg_temp.id(103);
do $$
declare lease jsonb; first jsonb; second jsonb;
begin
  select * into first from public.automation_claim_work(1);
  select * into second from public.automation_claim_work(1);
  lease:=coalesce(first,second);
  perform pg_temp.ok(first is not null and second is null and first->>'contact_id'=pg_temp.id(103)::text,
    'only the step timed after the start is handed to the worker');
  insert into leases values (103,lease);
  perform pg_temp.ok((select status='completed' from private.automation_runs where workflow_id=pg_temp.id(142) and contact_id=pg_temp.id(102))
      and (select s.status='skipped' and s.reason='The appointment had already started' from private.automation_steps s
        join private.automation_runs r on r.id=s.run_id where r.workflow_id=pg_temp.id(142) and r.contact_id=pg_temp.id(102)
          and s.node_id='text'),
    'the confirmation held past the start is skipped, and its run ends');
end $$;
select pg_temp.ok(pg_temp.check(103) is null and pg_temp.hand_off(103),'a step timed after the start still goes out');
rollback;
