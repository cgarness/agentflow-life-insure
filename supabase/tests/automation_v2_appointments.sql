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
rollback;
