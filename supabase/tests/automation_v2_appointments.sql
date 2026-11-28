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
-- The worker's event pass, repeated until no event that is due remains, as its next passes would. A pass visits at
-- most 25 automations per event, and later sections have more than 25 on at once in an order that differs from run to
-- run (interval ids are random), so a single pass could leave an event half done for a step to see.
create function pg_temp.events(p_limit integer) returns integer language plpgsql as $$
declare total integer:=0;
begin
  for i in 1..20 loop
    total:=total+public.automation_process_events(p_limit);
    if not exists (select 1 from private.automation_events e join private.automation_release_controls c using(organization_id)
        where e.processed_at is null and e.available_at<=clock_timestamp() and c.enrollment_enabled) then
      return total;
    end if;
  end loop;
  raise exception 'Automation V2 appointments: events still due after 20 worker passes';
end $$;

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
  perform pg_temp.ok(pg_temp.events(25)=0 and pg_temp.work() is null,story||': nothing else is due');
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
do $$
declare turn jsonb:=pg_temp.work(); run private.automation_runs; expected timestamptz;
begin
  perform pg_temp.ok(turn->>'result'='wait' and (turn#>>'{context,appointment_start}')::timestamptz=(select starts from booked where n=30)
    and turn#>>'{context,agency_timezone}'='America/New_York','the lease carries the appointment time and agency zone');
  run:=pg_temp.reminder(30);
  expected:=(((select starts from booked where n=30) at time zone 'America/New_York')-interval '1 day') at time zone 'America/New_York';
  perform pg_temp.ok(run.status='waiting' and run.due_at=expected and run.anchor_at=(select starts from booked where n=30),
    'the reminder waits until the same wall-clock time one day earlier');
  perform pg_temp.ok(pg_temp.events(25)=0,'a repeated sweep enrolls nothing');
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
select pg_temp.events(25);
update private.automation_runs set status='stopped',ended_at=clock_timestamp() where contact_id=pg_temp.id(31);

-- Rescheduling while the reminder waits moves the same run. It does not start a second one.
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts+interval '2 days' from booked where n=30),(select id from booked where n=30)));
select pg_temp.ok((select count(*)=2 from private.automation_events where subject->>'appointment_id'=(select id::text from booked where n=30)
  and event_type in ('appointment_booked','appointment_changed') and processed_at is null),'a reschedule is recorded as a change and a new slot');
select pg_temp.ok(pg_temp.events(25)=0,'the reschedule starts no second run');
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
select pg_temp.ok(pg_temp.events(25)=1,'second booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=32)));
select pg_temp.ok(pg_temp.events(25)=0,'a cancellation enrolls nothing');
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from pg_temp.reminder(32)),
  'cancelling ends the waiting reminder straight away');

-- A cancel that races the worker: the run is checked again at the moment it is leased.
insert into booked select 33,pg_temp.book(65,33,clock_timestamp()+interval '4 days'),null;
select pg_temp.ok(pg_temp.events(25)=1,'third booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=33)));
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where contact_id=pg_temp.id(33);
select pg_temp.ok(pg_temp.work() is null,'a cancelled appointment''s reminder is never handed to a worker');
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from pg_temp.reminder(33)),'and it is stopped');
select pg_temp.events(25);

-- Deleting the appointment removes the pending reminder.
insert into booked select 34,pg_temp.book(66,34,clock_timestamp()+interval '4 days'),null;
select pg_temp.ok(pg_temp.events(25)=1,'fourth booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
select pg_temp.as_agent(format('delete from public.appointments where id=%L',(select id from booked where n=34)));
select pg_temp.events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment was removed' from pg_temp.reminder(34)),'deleting ends the reminder');

-- Moving the appointment inside the reminder window ends the pending reminder, which can no longer be on time.
insert into booked select 35,pg_temp.book(67,35,clock_timestamp()+interval '4 days'),null;
select pg_temp.ok(pg_temp.events(25)=1,'fifth booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  clock_timestamp()+interval '3 hours',(select id from booked where n=35)));
select pg_temp.events(25);
select pg_temp.ok((select status='completed' and reason='The reminder time had already passed' from pg_temp.reminder(35)),
  'a reminder that can no longer be on time is skipped');
select pg_temp.ok(not exists(select from public.tasks where contact_id=pg_temp.id(35))
  and (select count(*)=1 from private.automation_runs where contact_id=pg_temp.id(35)),
  'no late reminder was created and the moved slot started no second run');

-- A late booking skips by default. An author can choose to continue instead.
insert into booked select 36,pg_temp.book(68,36,clock_timestamp()+interval '5 hours'),null;
select pg_temp.ok(pg_temp.events(25)=1,'a booking inside the window still enrolls');
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
select pg_temp.events(25);
select pg_temp.ok(pg_temp.work()->>'result'='wait','the continue step is evaluated');
select pg_temp.ok(pg_temp.work()->>'result'='created','a late booking continues straight to the next step when the author chose that');

-- Bookings that are not upcoming appointments start nothing.
insert into booked select 38,pg_temp.book(70,38,clock_timestamp()-interval '2 hours'),null;
insert into public.appointments(id,organization_id,title,contact_id,user_id,start_time,sync_source,booking_kind,type)
  values (pg_temp.id(71),pg_temp.id(1),'Callback',pg_temp.id(39),pg_temp.id(11),clock_timestamp()+interval '2 days','internal','callback','Follow Up');
select pg_temp.ok(pg_temp.events(25)=0,'a past appointment and a callback reminder start no run');
select pg_temp.ok(not exists(select from private.automation_events where event_type='appointment_booked'
  and contact_id=pg_temp.id(39)),'a callback is not an appointment booking');
update public.workflows set status='paused' where id=pg_temp.id(22);

-- No-show recovery: only a person's explicit No-show creates the rescheduling task, and only once.
select pg_temp.publish(24,25,'No-show recovery','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_outcome_recorded","version":1,"config":{"outcomes":["no_show"]}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Reschedule the missed appointment","task_type":"Follow Up","due_amount":1,"due_unit":"hours"}}],
  "edges":[{"id":"a","source":"start","target":"task"}]}');
select pg_temp.ok(pg_temp.events(25)=0,'nothing enrolls in no-show recovery yet');
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
  perform pg_temp.ok(pg_temp.events(25)=1,'the no-show enrolls');
  turn:=pg_temp.work();
  perform pg_temp.ok(turn->>'result'='created' and (turn#>>'{context,appointment_start}')::timestamptz=starts,
    'the rescheduling task is created with the missed appointment''s time available');
  -- Reopened and marked No-show again: still the same missed appointment.
  perform pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',target));
  perform pg_temp.as_agent(format('update public.appointments set status=''No Show'' where id=%L',target));
  perform pg_temp.ok((select count(*)=2 from private.automation_events where event_type='appointment_outcome_recorded'),
    'marking it again is recorded');
  perform pg_temp.ok(pg_temp.events(25)=0,'but does not start a second run for the same missed appointment');
  perform pg_temp.ok((select count(*)=1 from public.tasks where title='Reschedule the missed appointment'),'one rescheduling task');
end $$;

-- A Held outcome does not match a No-show trigger. A corrected outcome ends a pending No-show run.
insert into booked select 40,pg_temp.book(72,40,clock_timestamp()-interval '3 hours'),null;
select pg_temp.as_agent(format('update public.appointments set status=''Completed'' where id=%L',(select id from booked where n=40)));
select pg_temp.ok(pg_temp.events(25)=0,'a Held appointment does not start no-show recovery');
insert into booked select 41,pg_temp.book(73,41,clock_timestamp()-interval '3 hours'),null;
select pg_temp.as_agent(format('update public.appointments set status=''No Show'' where id=%L',(select id from booked where n=41)));
select pg_temp.ok(pg_temp.events(25)=1,'a second contact''s no-show enrolls');
select pg_temp.as_agent(format('update public.appointments set status=''Completed'' where id=%L',(select id from booked where n=41)));
select pg_temp.events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment outcome was changed' from private.automation_runs
  where workflow_id=pg_temp.id(24) and contact_id=pg_temp.id(41)),'correcting the outcome ends the pending recovery');
select pg_temp.ok(not exists(select from public.tasks where contact_id=pg_temp.id(41)),'no task for an appointment that was held');

-- Another agency's appointments never reach this agency's workflows.
insert into public.appointments(id,organization_id,title,user_id,start_time,sync_source)
  values (pg_temp.id(74),pg_temp.id(2),'Foreign',pg_temp.id(14),clock_timestamp()+interval '4 days','internal');
select pg_temp.ok(pg_temp.events(25)=0,'another agency''s appointment enrolls in nothing here');
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls in the two-reminder automation');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(26);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the day-before wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the day-before reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run now waits for the hour before');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts+interval '14 days' from booked where n=42),(select id from booked where n=42)));
select pg_temp.ok(pg_temp.events(25)=1,'the new time starts the automation again');
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
select pg_temp.ok(pg_temp.events(25)=1,'the second booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(28);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the first reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run sits in its plain wait');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts+interval '14 days' from booked where n=43),(select id from booked where n=43)));
select pg_temp.ok(pg_temp.events(25)=1,'the new time starts the automation again');
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
select pg_temp.ok(pg_temp.events(25)=1,'the third booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=44)));
select pg_temp.events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from private.automation_runs where workflow_id=pg_temp.id(30)),
  'cancelling ends the reminder');
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=44)));
select pg_temp.ok(pg_temp.events(25)=0,'reopening starts no second run');
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
select pg_temp.events(25);
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(32);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the day-before wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the day-before reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run waits for the hour before');
update booked set starts=date_trunc('minute',clock_timestamp())+interval '20 hours' where n=46;
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts from booked where n=46),(select id from booked where n=46)));
select pg_temp.ok(pg_temp.events(25)=0,'a move inside the day-before window starts nothing new');
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
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
select pg_temp.ok(pg_temp.events(25)=1,'admitting the new time starts the automation again');
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the plain wait starts');
update private.automation_runs set due_at=clock_timestamp()+interval '1 hour' where workflow_id=pg_temp.id(36);
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=48)));
select pg_temp.events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from private.automation_runs
  where workflow_id=pg_temp.id(36)),'cancelling ends the run');
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=48)));
select pg_temp.ok(pg_temp.events(25)=0,'reopening starts no second run');
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
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
select pg_temp.ok(pg_temp.events(25)=1,'admitting the new time starts the automation again');
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(40);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','the day-before wait elapses');
select pg_temp.ok(pg_temp.work()->>'result'='created','the day-before reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run waits for the hour before');
update booked set starts=date_trunc('minute',clock_timestamp())+interval '20 hours' where n=51;
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts from booked where n=51),(select id from booked where n=51)));
select pg_temp.ok(pg_temp.events(25)=0,'the move keeps the run in place');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=51)));
select pg_temp.events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from private.automation_runs where workflow_id=pg_temp.id(40)),
  'cancelling ends the run');
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=51)));
select pg_temp.ok(pg_temp.events(25)=0,'reopening starts no second run');
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
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
select pg_temp.ok(pg_temp.events(25)=0,'the admission is refused');
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the late day-before reminder goes ahead');
select pg_temp.ok(pg_temp.work()->>'result'='created','the day-before reminder is made');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the run waits for the hour before');
update booked set starts=date_trunc('minute',clock_timestamp())+interval '3 hours' where n=53;
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  (select starts from booked where n=53),(select id from booked where n=53)));
update public.profiles set status='Inactive' where id=pg_temp.id(10);
select pg_temp.ok(pg_temp.events(25)=0,'the admission is refused');
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
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
select pg_temp.ok(pg_temp.events(25)=1,'the new time starts the automation again');
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=55)));
select pg_temp.events(25);
select pg_temp.as_agent(format('update public.appointments set type=''Zoom review'' where id=%L',(select id from booked where n=55)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=55)));
select pg_temp.ok(pg_temp.events(25)=0,'reopening starts no second run');
select pg_temp.ok((select status='queued' and reason is null from private.automation_runs where workflow_id=pg_temp.id(48)
  and contact_id=pg_temp.id(55)),'the run stopped by the cancellation carries on, though the cancellation was restated');

-- Moving an appointment that stays cancelled never starts reminders for it.
insert into booked select 56,pg_temp.book(87,56,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=56)));
select pg_temp.events(25);
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=56)));
select pg_temp.ok(pg_temp.events(25)=0,'a cancelled appointment moved to a new time starts nothing');
select pg_temp.ok(not exists(select from private.automation_runs where workflow_id=pg_temp.id(48) and contact_id=pg_temp.id(56)
  and status in ('queued','waiting','held')),'and no run for it is live');

-- Reopening it at that new time resumes its reminders, exactly once. The new slot has no outcome to take back, so the
-- appointment's own change log tells the automations it stands again.
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where workflow_id=pg_temp.id(48) and contact_id<>pg_temp.id(56) and status in ('queued','waiting','held');
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=56)));
select pg_temp.ok(pg_temp.events(25)=0,'reopening the moved appointment starts no second run');
select pg_temp.ok(pg_temp.events(25)=0,'nor does a later sweep');
select pg_temp.reopened_reminder_fires_once(56,'the appointment moved while cancelled, then reopened');

-- The same three changes reaching the worker late, after all of them were made: still one run, at the new time.
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(57,58) n;
insert into booked select 57,pg_temp.book(88,57,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=57)));
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=57)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=57)));
select pg_temp.events(25);
select pg_temp.ok(pg_temp.events(25)=0,'nothing more enrolls after the late sweep');
select pg_temp.reopened_reminder_fires_once(57,'all three changes handled after the fact');

-- The cancellation handled at once, the move and the reopening only later.
insert into booked select 58,pg_temp.book(89,58,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=58)));
select pg_temp.events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from private.automation_runs
  where workflow_id=pg_temp.id(48) and contact_id=pg_temp.id(58)),'cancelling ends the reminder');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=58)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=58)));
select pg_temp.events(25);
select pg_temp.ok(pg_temp.events(25)=0,'nothing more enrolls');
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
  perform pg_temp.ok(pg_temp.events(25)=0,'a booking first processed while cancelled enrolls nothing');
  perform pg_temp.ok((select processed_at is not null from private.automation_events where event_type='appointment_booked'
    and subject->>'appointment_id'=appointment::text),'the booking was processed');
  perform pg_temp.ok(pg_temp.reminder_runs(lead_n)=0,'and no run was ever started for it');
end $$;

-- Moved while cancelled, then opened again at the new time.
select pg_temp.first_seen_cancelled(120,70);
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=70)));
select pg_temp.ok(pg_temp.events(25)=0 and pg_temp.reminder_runs(70)=0,
  'the move while cancelled starts nothing');
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=70)));
select pg_temp.events(25);
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
select pg_temp.events(25);
select pg_temp.reopened_reminder_fires_once(71,'a booking first processed while cancelled, then reopened at its time');

-- Opened again at a time that has already passed: nothing to remind about.
select pg_temp.first_seen_cancelled(122,72);
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())-interval '2 hours',(select id from booked where n=72)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=72)));
select pg_temp.events(25);
select pg_temp.ok(pg_temp.reminder_runs(72)=0,'an appointment reopened at a past time starts no reminders');

-- Booked, cancelled, moved and reopened before the worker sees any of it: one run, for the new time.
insert into booked select 73,pg_temp.book(123,73,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=73)));
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=73)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=73)));
select pg_temp.events(25);
select pg_temp.reopened_reminder_fires_once(73,'every change made before the worker saw the booking');

-- Paused when the appointment reopens: the booking waits for the automation, which starts once when it resumes. The
-- automation is paused and resumed the way the builder does it, so it was off when the appointment moved and reopened.
select pg_temp.first_seen_cancelled(124,74);
select pg_temp.lifecycle(48,'pause');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=74)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=74)));
select pg_temp.events(25);
select pg_temp.ok(pg_temp.reminder_runs(74)=0 and exists(select from private.automation_deferred_admissions d
    join private.automation_events e on e.id=d.event_id where d.workflow_id=pg_temp.id(48)
      and e.subject->>'appointment_id'=(select id::text from booked where n=74)),
  'a paused automation keeps the booking for when it resumes');
select pg_temp.lifecycle(48,'resume');
select pg_temp.events(25);
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
select pg_temp.events(25);
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
select pg_temp.events(25);
select pg_temp.publish(62,63,'Reminder published after the booking','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"until","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Later reminder","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"until"},{"id":"b","source":"until","target":"task"}]}');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '5 days',(select id from booked where n=76)));
select pg_sleep(0.05);
select pg_temp.events(25);
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
-- The start is read from the clock once, so the time recorded is the time booked, also across a minute boundary.
create function pg_temp.booking(appointment_n integer, lead_n integer, days integer) returns void language sql as $$
  insert into booked select lead_n,pg_temp.book(appointment_n,lead_n,t.starts),t.starts
  from (select date_trunc('minute',clock_timestamp())+make_interval(days=>days) as starts) t
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
select pg_temp.ok(pg_temp.events(25)=0,'lead 87: the booking first processed while cancelled starts nothing');
select pg_temp.reply(87);
select pg_temp.save(87,pg_temp.later(5)||',status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(170,87)='stopped:Verified reply received' and pg_temp.tasks_for(170,87)=0,
  'a reply since the booking ends the reminders for an appointment moved and reopened in one save: '||pg_temp.runs_for(170,87));
-- The worker saw the booking while it stood. The contact replies after the cancellation, then one save moves and reopens.
select pg_temp.booking(161,88,3);
select pg_temp.ok(pg_temp.events(25)=1 and pg_temp.work()->>'result'='wait','lead 88: the reminder run waits');
select pg_temp.save(88,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.reply(88);
select pg_temp.save(88,pg_temp.later(5)||',status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(170,88)='stopped:Appointment was cancelled' and pg_temp.tasks_for(170,88)=0,
  'the run a cancellation stopped stays ended after a reply, and nothing starts for the new time: '||pg_temp.runs_for(170,88));
-- Two saves the worker sees in one pass: moved while cancelled, then reopened.
select pg_temp.booking(162,89,3);
select pg_temp.save(89,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.reply(89);
select pg_temp.save(89,pg_temp.later(5));
select pg_temp.save(89,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(170,89)='stopped:Verified reply received' and pg_temp.tasks_for(170,89)=0,
  'a reply since the booking ends the reminders when the worker sees the move and the reopening together: '||pg_temp.runs_for(170,89));
-- An ordinary move of an appointment that stood, after a reply ended its reminders, starts the automation again for the
-- new time, counted from the move, as every booking does. (Whether stop rules should outlive a reschedule is a product
-- decision recorded in the release plan; this pins the behavior this round keeps.)
select pg_temp.booking(163,90,3);
select pg_temp.ok(pg_temp.events(25)=1 and pg_temp.work()->>'result'='wait','lead 90: the reminder run waits');
select pg_temp.reply(90);
select pg_temp.save(90,pg_temp.later(5));
select pg_temp.events(25);
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
select pg_temp.ok(pg_temp.events(25)=1 and pg_temp.work()->>'result'='wait','lead 91: the reminder run waits');
select pg_temp.talk(91);
select pg_temp.save(91,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(91,pg_temp.later(5));
select pg_temp.events(25);
select pg_temp.save(91,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.booking(165,92,3);
select pg_temp.talk(92);
select pg_temp.save(92,'status=''Cancelled''');
select pg_temp.ok(pg_temp.events(25)=0,'lead 92: the booking first processed while cancelled starts nothing');
select pg_temp.save(92,pg_temp.later(5));
select pg_temp.events(25);
select pg_temp.save(92,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(172,91)='stopped:Contact was reached' and pg_temp.tasks_for(172,91)=0
    and pg_temp.runs_for(172,92)='stopped:Contact was reached' and pg_temp.tasks_for(172,92)=0,
  'a conversation since the booking ends the reminders whichever way the worker saw the booking: '
    ||pg_temp.runs_for(172,91)||' / '||pg_temp.runs_for(172,92));
-- An ordinary move after the contact was reached starts the automation again for the new time, as above.
select pg_temp.booking(166,93,3);
select pg_temp.ok(pg_temp.events(25)=1 and pg_temp.work()->>'result'='wait','lead 93: the reminder run waits');
select pg_temp.talk(93);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(172) and status='waiting';
select pg_temp.ok(pg_temp.work() is null and pg_temp.runs_for(172,93)='stopped:Contact was reached','lead 93: the conversation ends the run');
select pg_temp.save(93,pg_temp.later(5));
select pg_temp.events(25);
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
select pg_temp.events(25);
select pg_temp.save(94,pg_temp.later(5));
select pg_temp.events(25);
select pg_temp.save(94,'status=''Scheduled''');
select pg_temp.events(25);
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
select pg_temp.ok(pg_temp.events(25)=1,'lead 95: the booking enrolls');
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(176,95)='completed:-' and pg_temp.tasks_for(176,95)=1,'lead 95: the reminder for the old time was given');
select pg_temp.save(95,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(95,pg_temp.later(14));
select pg_temp.events(25);
select pg_temp.save(95,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(176,95)='completed:-; completed:-' and pg_temp.tasks_for(176,95)=2,
  'a run that finished for the old time leaves the reopened new time its reminder: '||pg_temp.runs_for(176,95));
-- Booked five hours out, so the day-before reminder was skipped as too late; then cancelled, moved and reopened.
insert into booked select 96,pg_temp.book(181,96,date_trunc('minute',clock_timestamp())+interval '5 hours'),
  date_trunc('minute',clock_timestamp())+interval '5 hours';
select pg_temp.ok(pg_temp.events(25)=1,'lead 96: the booking enrolls');
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(176,96)='completed:The reminder time had already passed','lead 96: the reminder was too late');
select pg_temp.save(96,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(96,pg_temp.later(7));
select pg_temp.events(25);
select pg_temp.save(96,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.tasks_for(176,96)=1,
  'a reminder skipped as too late for the old time is given for the reopened new time: '||pg_temp.runs_for(176,96));
-- First seen cancelled, the automation paused only while the appointment was moved, and resumed before the reopening.
select pg_temp.booking(182,97,3);
select pg_temp.save(97,'status=''Cancelled''');
select pg_temp.ok(pg_temp.events(25)=0,'lead 97: the booking first processed while cancelled starts nothing');
select pg_temp.lifecycle(176,'pause');
select pg_temp.save(97,pg_temp.later(5));
select pg_temp.events(25);
select pg_temp.lifecycle(176,'resume');
select pg_temp.save(97,'status=''Scheduled''');
select pg_temp.events(25);
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
select pg_temp.ok(pg_temp.events(25)=1 and pg_temp.work()->>'result'='wait','lead 98: it waits for the day before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(178);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed' and pg_temp.work()->>'result'='created'
  and pg_temp.work()->>'result'='wait','lead 98: the day-before reminder is given and the run waits for the hour before');
select pg_temp.save(98,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(98,pg_temp.later(14));
select pg_temp.events(25);
select pg_temp.save(98,'status=''Scheduled''');
select pg_sleep(0.5);
select pg_temp.events(25);
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
select pg_temp.ok(pg_temp.events(25)=2,'a client''s and a recruit''s bookings enroll');
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
update private.automation_runs set paced_from=clock_timestamp()-interval '2 days' where workflow_id=pg_temp.id(52);
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=61)));
select pg_temp.events(25);
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '20 hours',(select id from booked where n=61)));
select pg_temp.events(25);
insert into reopened values (61,clock_timestamp());
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=61)));
select pg_temp.events(25);
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','the plain wait starts');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=62)));
select pg_temp.events(25);
select pg_temp.ok((select status='stopped' and reason='Appointment was cancelled' from private.automation_runs
  where workflow_id=pg_temp.id(54)),'cancelling ends the run');
update private.automation_runs set due_at=clock_timestamp()-interval '1 hour',paced_from=clock_timestamp()-interval '2 days'
  where workflow_id=pg_temp.id(54);
insert into reopened values (62,clock_timestamp());
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=62)));
select pg_temp.ok(pg_temp.events(25)=0,'reopening starts no second run');
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
  perform pg_temp.ok(pg_temp.events(25)=1,'lead '||lead_n||': the booking enrolls');
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
  perform pg_temp.ok(pg_temp.events(25)=0 and pg_temp.work() is null,story||': nothing else is due');
  perform pg_temp.ok((select count(*) filter (where t.title='Day-before reminder (P)')=2 and count(*) filter (where t.title='Hour-before reminder (P)')=1
    from public.tasks t join private.automation_runs r on r.id=t.automation_run_id where r.workflow_id=pg_temp.id(56) and t.contact_id=pg_temp.id(lead_n)),
    story||': one day-before reminder for each time and one hour-before reminder for the new time');
end $$;
insert into booked select 63,pg_temp.book(94,63,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.first_reminder_given(63);
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=63)));
select pg_temp.events(25);
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '10 days',(select id from booked where n=63)));
select pg_temp.events(25);
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=63)));
select pg_temp.events(25);
select pg_temp.new_time_gets_both(63,'each change seen as it happened');

insert into booked select 64,pg_temp.book(95,64,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.first_reminder_given(64);
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=64)));
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '10 days',(select id from booked where n=64)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=64)));
select pg_temp.events(25);
select pg_temp.events(25);
select pg_temp.new_time_gets_both(64,'all three changes seen afterwards');

insert into booked select 66,pg_temp.book(97,66,date_trunc('minute',clock_timestamp())+interval '3 days'),
  date_trunc('minute',clock_timestamp())+interval '3 days';
select pg_temp.first_reminder_given(66);
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=66)));
select pg_temp.events(25);
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '10 days',(select id from booked where n=66)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=66)));
select pg_temp.events(25);
select pg_temp.events(25);
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','it waits for the day before');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=65)));
select pg_temp.events(25);
select private.automation_cancel_reply(pg_temp.id(1),pg_temp.id(65),'lead',clock_timestamp());
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=65)));
select pg_temp.events(25);
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
  perform pg_temp.ok(pg_temp.events(25)=1,'lead '||lead_n||': the booking enrolls');
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
select pg_temp.events(25);
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
select pg_temp.events(25);
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
select pg_temp.ok(pg_temp.events(25)=1,'the booking enrolls the confirmation');
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
select pg_temp.events(25);
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
select pg_temp.ok(pg_temp.events(25)=1 and pg_temp.work()->>'result'='wait','lead 100: it waits for the hour before');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(140) and contact_id=pg_temp.id(100);
select pg_temp.ok(pg_temp.work()->>'result'='elapsed','lead 100: the hour before arrives');
select pg_temp.as_agent(format('update public.appointments set start_time=start_time+interval ''1 day'',end_time=end_time+interval ''1 day'' where id=%L',
  (select id from booked where n=100)));
select pg_temp.as_agent(format('update public.appointments set start_time=%L,end_time=%L where id=%L',
  (select starts from booked where n=100),(select starts+interval '30 minutes' from booked where n=100),(select id from booked where n=100)));
select pg_temp.events(25);
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
select pg_temp.ok(pg_temp.events(25)=2,'leads 102 and 103: the bookings enroll the confirmation');
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

-- A booking taken up because its appointment was reopened is judged as the run that followed the appointment would
-- have been (automation_stops_from, kept on the run as stops_from): from the latest booking the automation followed
-- while the appointment stood, an ordinary move included, else from when it first stood again. Facts recorded after
-- admission still count, a pause keeps a booking moved and reopened in one save, a person's stop is kept, and an
-- automation republished without a booking trigger takes nothing.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(104,135) n;
create temporary table marks(n integer primary key, at timestamptz) on commit drop;
create function pg_temp.reminder_graph(title text, settings jsonb) returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',settings,'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','until','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',1,'unit','days')),
    jsonb_build_object('id','task','type','create_task','version',1,'config',jsonb_build_object('title',title,'task_type','Follow Up','due_amount',0,'due_unit','minutes'))),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','until'),jsonb_build_object('id','b','source','until','target','task')))
$$;

-- One calendar save moves and reopens an appointment first processed while cancelled, while the automation is paused.
select pg_temp.publish(190,191,'Reminder kept by a pause (one save)',pg_temp.reminder_graph('Reminder (pause)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(190,104,3);
select pg_temp.save(104,'status=''Cancelled''');
select pg_temp.ok(pg_temp.events(25)=0,'lead 104: the booking first processed while cancelled starts nothing');
select pg_temp.booking(191,105,3);
select pg_temp.ok(pg_temp.events(25)=1 and pg_temp.work()->>'result'='wait','lead 105: the reminder run waits');
select pg_temp.save(105,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.lifecycle(190,'pause');
select pg_temp.save(104,pg_temp.later(5)||',status=''Scheduled''');
select pg_temp.save(105,pg_temp.later(5)||',status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.ok(pg_temp.runs_for(190,104)='none' and (select count(*)=1 from private.automation_deferred_admissions d
    join private.automation_events e on e.id=d.event_id where d.workflow_id=pg_temp.id(190)
      and e.subject->>'appointment_id'=(select id::text from booked where n=104)),
  'lead 104: the paused automation keeps the booking moved and reopened in one save');
select pg_temp.lifecycle(190,'resume');
select pg_temp.events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(190,104)='completed:-' and pg_temp.tasks_for(190,104)=1,
  'once resumed, the booking moved and reopened in one save gets its reminder, once: '||pg_temp.runs_for(190,104));
select pg_temp.ok(pg_temp.runs_for(190,105)='completed:-' and pg_temp.tasks_for(190,105)=1,
  'as does the run that existed before the cancellation: '||pg_temp.runs_for(190,105));
select pg_temp.lifecycle(190,'pause');

-- An ordinary move after a reply ended the reminders, then a cancellation and a reopening. The worker sees the moved
-- booking either while the appointment stands (lead 106) or only once it is cancelled (lead 107); the answer is the same.
select pg_temp.publish(192,193,'Reminder that stops on a reply (seen either way)',
  pg_temp.reminder_graph('Reminder (either way)','{"reentry":"once","stop_on_reply":true}'));
select pg_temp.booking(192,106,3);
select pg_temp.booking(193,107,3);
select pg_temp.ok(pg_temp.events(25)=2,'leads 106 and 107 enroll');
select pg_temp.work(); select pg_temp.work();
select pg_temp.reply(106);
select pg_temp.reply(107);
select pg_temp.save(106,pg_temp.later(5));
select pg_temp.events(25);
select pg_temp.save(107,pg_temp.later(5));
select pg_temp.save(106,'status=''Cancelled''');
select pg_temp.save(107,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(106,'status=''Scheduled''');
select pg_temp.save(107,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(192,106)='stopped:Verified reply received; completed:-' and pg_temp.tasks_for(192,106)=1,
  'lead 106: the ordinary move starts the reminders again, and they resume after the reopening: '||pg_temp.runs_for(192,106));
select pg_temp.ok(pg_temp.runs_for(192,107)=pg_temp.runs_for(192,106) and pg_temp.tasks_for(192,107)=1,
  'lead 107: the same, though the worker first saw the moved booking while cancelled: '||pg_temp.runs_for(192,107));
select pg_temp.lifecycle(192,'pause');

-- Facts recorded after admission. A call under way when one save moves and reopens the appointment, whose length is
-- written when it ends (lead 108 first seen cancelled, lead 109 with a run before the cancellation).
select pg_temp.publish(194,195,'Reminder that stops on contact (late facts)',
  pg_temp.reminder_graph('Reminder (late call)','{"reentry":"once","stop_on_reply":false,"stop_on_contact":true}'));
select pg_temp.booking(194,108,3);
select pg_temp.save(108,'status=''Cancelled''');
select pg_temp.ok(pg_temp.events(25)=0,'lead 108: first processed while cancelled');
select pg_temp.booking(195,109,3);
select pg_temp.ok(pg_temp.events(25)=1 and pg_temp.work()->>'result'='wait','lead 109: the reminder run waits');
select pg_temp.save(109,'status=''Cancelled''');
select pg_temp.events(25);
insert into public.calls(id,organization_id,agent_id,contact_id,contact_type,contact_phone,direction,status,duration,started_at,
    dialer_admission_required)
  select pg_temp.id(9000+n),pg_temp.id(1),pg_temp.id(11),pg_temp.id(n),'lead','+1202555'||lpad(n::text,4,'0'),'outbound',
    'connected',null,clock_timestamp(),false from (values (108),(109)) v(n);
select pg_temp.save(108,pg_temp.later(5)||',status=''Scheduled''');
select pg_temp.save(109,pg_temp.later(5)||',status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.ok(pg_temp.runs_for(194,108)='queued:-' and pg_temp.runs_for(194,109)='queued:-',
  'reopened during the call, both appointments are followed again');
update public.calls set status='completed',duration=180 where id in (pg_temp.id(9108),pg_temp.id(9109));
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(194,108)='stopped:Contact was reached' and pg_temp.tasks_for(194,108)=0
    and pg_temp.runs_for(194,109)='stopped:Contact was reached' and pg_temp.tasks_for(194,109)=0,
  'a conversation under way at the reopening ends the reminders once it is recorded, whatever the worker saw first: '
    ||pg_temp.runs_for(194,108)||' / '||pg_temp.runs_for(194,109));
select pg_temp.lifecycle(194,'pause');

-- A reply received before the reopening but verified after it (lead 110). An appointment entered as cancelled is judged
-- from that entry, the moment the automation began following it (a decision recorded in the release plan): a reply or
-- a conversation while it was on file as cancelled ends its reminders once it is opened (leads 111 and 112), and a reply
-- verified only after the reopening gives the same answer (lead 125).
select pg_temp.publish(196,197,'Reminder that stops on a reply or contact',
  pg_temp.reminder_graph('Reminder (reply or contact)','{"reentry":"once","stop_on_reply":true,"stop_on_contact":true}'));
select pg_temp.booking(196,110,3);
select pg_temp.save(110,'status=''Cancelled''');
select pg_temp.events(25);
insert into marks values (110,clock_timestamp());
select pg_temp.save(110,pg_temp.later(5)||',status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.ok(pg_temp.runs_for(196,110)='queued:-','lead 110: the reopened appointment is followed');
select private.automation_cancel_reply(pg_temp.id(1),pg_temp.id(110),'lead',(select at from marks where n=110));
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(196,110)='stopped:Verified reply received' and pg_temp.tasks_for(196,110)=0,
  'a reply received before the reopening and verified after it ends the reminders: '||pg_temp.runs_for(196,110));
do $$
begin
  perform pg_temp.act(11);
  set local role authenticated;
  perform public.create_appointment_once(pg_temp.id(197+n-110),jsonb_build_object('title','Fixture review','status','Cancelled',
    'start_time',date_trunc('minute',clock_timestamp())+interval '3 days','contact_id',pg_temp.id(n),'user_id',pg_temp.id(11)))
    from (values (111),(112),(125)) v(n);
  reset role;
  perform pg_temp.nobody();
end $$;
insert into booked select n,(select a.id from public.appointments a where a.booking_request_id=pg_temp.id(197+n-110)),
  date_trunc('minute',clock_timestamp())+interval '3 days' from (values (111),(112),(125)) v(n);
select pg_temp.ok(pg_temp.events(25)=0,'leads 111, 112 and 125: entered as cancelled, nothing starts');
select pg_temp.reply(111);
select pg_temp.talk(112);
insert into marks values (125,clock_timestamp());
select pg_temp.save(111,'status=''Scheduled''');
select pg_temp.save(112,'status=''Scheduled''');
select pg_temp.save(125,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.ok(pg_temp.runs_for(196,125)='queued:-','lead 125: opened before its reply was verified, the appointment is followed');
select private.automation_cancel_reply(pg_temp.id(1),pg_temp.id(125),'lead',(select at from marks where n=125));
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(196,111)='stopped:Verified reply received' and pg_temp.tasks_for(196,111)=0
    and pg_temp.runs_for(196,112)='stopped:Contact was reached' and pg_temp.tasks_for(196,112)=0
    and pg_temp.runs_for(196,125)='stopped:Verified reply received' and pg_temp.tasks_for(196,125)=0,
  'an appointment entered as cancelled is judged from that entry, whenever its reply is verified: '
    ||pg_temp.runs_for(196,111)||' / '||pg_temp.runs_for(196,112)||' / '||pg_temp.runs_for(196,125));
select pg_temp.lifecycle(196,'pause');

-- A person stopped the reminder run. A stop a person makes ends its own run, as every stop does: cancelled and reopened
-- at the same time the appointment is not followed again (lead 124), while a new time starts over, as an ordinary move
-- does (two saves the worker sees one at a time, lead 113; one save, lead 114).
select pg_temp.publish(198,199,'Reminder a person stopped',pg_temp.reminder_graph('Reminder (stopped)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(200,113,3);
select pg_temp.booking(201,114,3);
select pg_temp.booking(219,124,3);
select pg_temp.ok(pg_temp.events(25)=3,'leads 113, 114 and 124 enroll');
select pg_temp.work(); select pg_temp.work(); select pg_temp.work();
do $$
begin
  perform pg_temp.act(10);
  perform public.automation_stop_run(r.id,(public.automation_session_context()->>'revision')::bigint)
    from private.automation_runs r where r.workflow_id=pg_temp.id(198) and r.contact_id in (pg_temp.id(113),pg_temp.id(114),pg_temp.id(124));
  perform pg_temp.nobody();
end $$;
select pg_temp.ok(pg_temp.runs_for(198,113)='stopped:Stopped by user' and pg_temp.runs_for(198,114)='stopped:Stopped by user'
    and pg_temp.runs_for(198,124)='stopped:Stopped by user','an admin stops the three reminder runs');
select pg_temp.save(113,'status=''Cancelled''');
select pg_temp.save(114,'status=''Cancelled''');
select pg_temp.save(124,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(113,pg_temp.later(5));
select pg_temp.events(25);
select pg_temp.save(113,'status=''Scheduled''');
select pg_temp.save(114,pg_temp.later(5)||',status=''Scheduled''');
select pg_temp.save(124,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(198,124)='stopped:Stopped by user' and pg_temp.tasks_for(198,124)=0,
  'reopened at the time a person stopped the reminders for, the appointment is not followed again: '||pg_temp.runs_for(198,124));
select pg_temp.ok(pg_temp.runs_for(198,113)='stopped:Stopped by user; completed:-' and pg_temp.tasks_for(198,113)=1
    and pg_temp.runs_for(198,114)='stopped:Stopped by user; completed:-' and pg_temp.tasks_for(198,114)=1,
  'reopened at a new time, the reminders start over, whatever the worker saw first: '
    ||pg_temp.runs_for(198,113)||' / '||pg_temp.runs_for(198,114));
select pg_temp.lifecycle(198,'pause');

-- Republished with a lead trigger after the booking was first processed while cancelled: the automation no longer
-- follows bookings, so nothing of the superseded version starts (two saves, lead 115; one save, lead 116).
select pg_temp.publish(202,203,'Reminder later republished for leads',pg_temp.reminder_graph('Reminder (superseded)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(202,115,3);
select pg_temp.booking(203,116,3);
select pg_temp.save(115,'status=''Cancelled''');
select pg_temp.save(116,'status=''Cancelled''');
select pg_temp.ok(pg_temp.events(25)=0,'leads 115 and 116: first processed while cancelled');
update public.automation_intervals set ends_at=clock_timestamp() where workflow_id=pg_temp.id(202) and ends_at is null;
insert into public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
  values(pg_temp.id(204),pg_temp.id(1),pg_temp.id(202),'Lead welcome',2,'{"format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"lead_created","version":1,"config":{}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Welcome","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
    "edges":[{"id":"a","source":"start","target":"task"}]}',clock_timestamp(),pg_temp.id(10));
update public.workflows set automation_version_id=pg_temp.id(204) where id=pg_temp.id(202);
insert into public.automation_intervals(organization_id,workflow_id,version_id,starts_at)
  values(pg_temp.id(1),pg_temp.id(202),pg_temp.id(204),clock_timestamp());
select pg_temp.save(115,pg_temp.later(5));
select pg_temp.save(115,'status=''Scheduled''');
select pg_temp.save(116,pg_temp.later(5)||',status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(202,115)='none' and pg_temp.runs_for(202,116)='none',
  'an automation republished without a booking trigger starts nothing for a reopened appointment: '
    ||pg_temp.runs_for(202,115)||' / '||pg_temp.runs_for(202,116));
update public.workflows set status='paused' where id=pg_temp.id(202);
-- The same while paused: publishing while paused opens no interval, and the version published last decides.
select pg_temp.publish(206,207,'Reminder republished while paused',pg_temp.reminder_graph('Reminder (republished while paused)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(213,126,3);
select pg_temp.save(126,'status=''Cancelled''');
select pg_temp.ok(pg_temp.events(25)=0,'lead 126: first processed while cancelled');
select pg_temp.lifecycle(206,'pause');
insert into public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
  values(pg_temp.id(208),pg_temp.id(1),pg_temp.id(206),'Lead welcome',2,'{"format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"lead_created","version":1,"config":{}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Welcome","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
    "edges":[{"id":"a","source":"start","target":"task"}]}',clock_timestamp(),pg_temp.id(10));
update public.workflows set automation_version_id=pg_temp.id(208) where id=pg_temp.id(206);
select pg_temp.save(126,pg_temp.later(5)||',status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.ok((select count(*)=0 from private.automation_deferred_admissions d where d.workflow_id=pg_temp.id(206)),
  'lead 126: an automation republished while paused without a booking trigger keeps nothing for its resume');
select pg_temp.lifecycle(206,'resume');
select pg_temp.events(25);
select pg_temp.drive();
select pg_temp.ok(pg_temp.runs_for(206,126)='none','and nothing of the superseded version starts once it resumes: '||pg_temp.runs_for(206,126));
select pg_temp.lifecycle(206,'pause');

-- Send time. The text reminders and the booking confirmation above follow new bookings again; admissions they kept
-- while set aside are dropped first.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
delete from private.automation_deferred_admissions where workflow_id in (pg_temp.id(140),pg_temp.id(142));
update public.workflows set status='active' where id=pg_temp.id(140);

-- Cancelled, reopened, and cancelled again after the reminder was picked up, the second time with the slot record
-- missing the cancellation (a capture gap): the calendar's own status still refuses the reminder.
select pg_temp.text_picked_up(205,117,date_trunc('minute',clock_timestamp())+interval '3 hours');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=117)));
select pg_temp.events(25);
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=117)));
select pg_temp.events(25);
do $$
declare lease jsonb;
begin
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.ok(lease->>'node_id'='text' and lease->>'contact_id'=pg_temp.id(117)::text,'lead 117: the reopened reminder is picked up again');
  delete from leases where n=117;
  insert into leases values (117,lease);
end $$;
alter table public.appointments disable trigger appointments_v3_evidence_capture;
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=117)));
alter table public.appointments enable trigger appointments_v3_evidence_capture;
select pg_temp.ok(pg_temp.check(117)='Appointment was cancelled' and not pg_temp.hand_off(117) and pg_temp.intent(117)='prepared',
  'a cancellation the slot record missed, after an earlier one was taken back, still refuses the reminder');
select pg_temp.held(117);
select pg_temp.ok(pg_temp.work() is null and (pg_temp.texts(117)).status='stopped' and (pg_temp.texts(117)).reason='Appointment was cancelled',
  'and the next lease ends the run');

-- Handed off, then cancelled while the provider call was in flight; the provider's acceptance arrives while the run is
-- stopped. Moved within the reminder's hour while cancelled and reopened, the run carries on at the text step, which is
-- finished from its receipt instead of being written again for the new time.
select pg_temp.text_picked_up(206,118,date_trunc('minute',clock_timestamp())+interval '3 hours');
select pg_temp.ok(pg_temp.check(118) is null and pg_temp.hand_off(118),'lead 118: the reminder is handed off');
select pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L',(select id from booked where n=118)));
select pg_temp.events(25);
select private.automation_apply_receipt(pg_temp.id(1),(lease->>'run_id')::uuid,'text','accepted') from leases where n=118;
select pg_temp.ok((pg_temp.texts(118)).status='stopped' and pg_temp.intent(118)='accepted',
  'the provider accepted it after its run stopped');
select pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())+interval '30 minutes',(select id from booked where n=118)));
select pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L',(select id from booked where n=118)));
select pg_temp.events(25);
do $$
declare lease jsonb; run private.automation_runs;
begin
  run:=pg_temp.texts(118);
  perform pg_temp.ok(run.status='queued' and run.current_node_id='text','the run carries on at the text step');
  select * into lease from public.automation_claim_work(1);
  run:=pg_temp.texts(118);
  perform pg_temp.ok(coalesce(lease->>'node_id','none')<>'text' and run.current_node_id='soon'
      and (select s.status='accepted' from private.automation_steps s where s.run_id=run.id and s.node_id='text'),
    'a text the provider accepted is finished from that receipt and never handed out again: '||coalesce(lease->>'node_id','nothing'));
end $$;
update public.workflows set status='paused' where id=pg_temp.id(140);
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');

-- A confirmation held minutes before its appointment is tried again before the appointment starts.
delete from private.automation_deferred_admissions where workflow_id=pg_temp.id(142);
update public.workflows set status='active' where id=pg_temp.id(142);
insert into booked select 119,pg_temp.book(207,119,t),t from (select date_trunc('second',clock_timestamp())+interval '4 minutes' t) x;
select pg_temp.ok(pg_temp.events(25)=1,'lead 119: the booking four minutes out enrolls the confirmation');
do $$
declare lease jsonb; run private.automation_runs;
begin
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.ok(lease->>'node_id'='text' and lease->>'contact_id'=pg_temp.id(119)::text,'lead 119: the confirmation is picked up');
  perform public.automation_finish_node((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,'held','A calendar save was in progress.');
  select * into run from private.automation_runs where id=(lease->>'run_id')::uuid;
  perform pg_temp.ok(run.status='held' and run.due_at>clock_timestamp() and run.due_at<(select starts from booked where n=119),
    'held minutes before its appointment, the confirmation is tried again before it starts: due '||run.due_at::text);
end $$;
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');

-- A confirmation held while the slot record missed a move to a later time (a capture gap), then the slot's old time
-- passes: the claim leaves it to the final check, which holds it until the record catches up, and it then goes out.
-- Lead 127, booked for the same moment, is moved earlier with the same gap, so by the time checked both its slot
-- record and its calendar say it has started: that one is skipped at once.
insert into booked select n,pg_temp.book(case n when 120 then 208 else 214 end,n,t),t
  from (select clock_timestamp()+interval '3 seconds' t) x,(values (120),(127)) v(n);
select pg_temp.ok(pg_temp.events(25)=2,'leads 120 and 127: the bookings enroll the confirmation');
do $$
declare lease jsonb;
begin
  for i in 1..2 loop
    select * into lease from public.automation_claim_work(1);
    perform pg_temp.ok(lease->>'node_id'='text' and lease->>'contact_id' in (pg_temp.id(120)::text,pg_temp.id(127)::text),
      'leads 120 and 127: the confirmation is picked up');
    perform public.automation_finish_node((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,'held','Outside the recipient local sending window.');
  end loop;
end $$;
alter table public.appointments disable trigger appointments_v3_evidence_capture;
update public.appointments set start_time=start_time+interval '1 day',end_time=end_time+interval '1 day'
  where id=(select id from booked where n=120);
update public.appointments set start_time=start_time-interval '2 seconds',end_time=end_time-interval '2 seconds'
  where id=(select id from booked where n=127);
alter table public.appointments enable trigger appointments_v3_evidence_capture;
select pg_sleep(greatest(0,extract(epoch from (select starts from booked where n=120)-clock_timestamp()))+0.3);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(142)
  and contact_id in (pg_temp.id(120),pg_temp.id(127));
do $$
declare lease jsonb;
begin
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.ok(lease->>'node_id'='text' and lease->>'contact_id'=pg_temp.id(120)::text,
    'a confirmation whose calendar time is still ahead is not skipped on the slot record''s passed time');
  delete from leases where n=120;
  insert into leases values (120,lease);
  -- A one-step claim may hand out lead 120 before it looks at lead 127, so the worker claims once more.
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.ok(lease is null,'nothing else is handed out: '||coalesce(lease::text,''));
  perform pg_temp.ok((select r.status='completed' and s.status='skipped' and s.reason='The appointment had already started'
      from private.automation_runs r join private.automation_steps s on s.run_id=r.id and s.node_id='text'
      where r.workflow_id=pg_temp.id(142) and r.contact_id=pg_temp.id(127)),
    'one whose slot record and calendar have both passed is skipped at once, and its run goes on');
end $$;
select pg_temp.ok(pg_temp.check(120)='The appointment''s new time is not recorded yet' and not pg_temp.hand_off(120),
  'the final check holds it until the record catches up');
select pg_temp.held(120);
select pg_temp.as_agent(format('update public.appointments set notes=''Repaired'' where id=%L',(select id from booked where n=120)));
select pg_temp.events(25);
do $$
declare lease jsonb;
begin
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.ok(lease->>'node_id'='text' and lease->>'contact_id'=pg_temp.id(120)::text,'once the record is repaired it is picked up again');
  delete from leases where n=120;
  insert into leases values (120,lease);
end $$;
select pg_temp.ok(pg_temp.check(120) is null and pg_temp.hand_off(120),'and handed off');
-- A confirmation whose appointment an agent moved to a time before the booking was made is not sent: the
-- appointment has started, and admission would never have followed a slot starting at or before its booking.
insert into booked select 128,pg_temp.book(215,128,t),t from (select date_trunc('minute',clock_timestamp())+interval '1 hour' t) x;
select pg_temp.ok(pg_temp.events(25)=1,'lead 128: the booking enrolls the confirmation');
select pg_temp.as_agent(format('update public.appointments set start_time=%L,end_time=%L where id=%L',
  date_trunc('minute',clock_timestamp())-interval '1 hour',date_trunc('minute',clock_timestamp())-interval '30 minutes',
  (select id from booked where n=128)));
select pg_temp.events(25);
do $$
declare lease jsonb;
begin
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.ok(lease is null and (select r.status='completed' and s.status='skipped'
      and s.reason='The appointment had already started' from private.automation_runs r
      join private.automation_steps s on s.run_id=r.id and s.node_id='text'
      where r.workflow_id=pg_temp.id(142) and r.contact_id=pg_temp.id(128)),
    'a confirmation for an appointment moved to before its booking is skipped: '||coalesce(lease->>'node_id','nothing leased'));
end $$;
update public.workflows set status='paused' where id=pg_temp.id(142);
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');

-- Moved away and back to the same time, with the worker seeing the move away in between: the run that was following
-- that time carries on, and the run started for the other time ends having sent nothing. Lead 121's first reminder was
-- still to go out; leads 122 and 123 had been given it and were waiting for the second, lead 123's automation sending
-- a passed reminder late.
create temporary table moved_back(t timestamptz) on commit drop;
insert into moved_back select date_trunc('second',clock_timestamp())+interval '2 minutes 8 seconds';
select pg_temp.publish(210,211,'Two reminders (moved back)','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"w1","type":"wait_until_before_appointment","version":1,"config":{"amount":2,"unit":"minutes"}},
    {"id":"text","type":"send_sms","version":1,"config":{"body":"See you at {{appointment_time}}","purpose":"informational"}},
    {"id":"w2","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"minutes"}},
    {"id":"last","type":"send_sms","version":1,"config":{"body":"Starting in a minute","purpose":"informational"}}],
  "edges":[{"id":"a","source":"start","target":"w1"},{"id":"b","source":"w1","target":"text"},
    {"id":"c","source":"text","target":"w2"},{"id":"d","source":"w2","target":"last"}]}');
insert into booked select n,pg_temp.book(209+n-121,n,(select t from moved_back)),(select t from moved_back) from (values (121),(122)) v(n);
select pg_temp.ok(pg_temp.events(25)=2,'leads 121 and 122 enroll');
select pg_temp.publish(212,213,'Two reminders, a passed one sent late (moved back)','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"w1","type":"wait_until_before_appointment","version":1,"config":{"amount":2,"unit":"minutes","late":"continue"}},
    {"id":"text","type":"send_sms","version":1,"config":{"body":"See you at {{appointment_time}}","purpose":"informational"}},
    {"id":"w2","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"minutes"}},
    {"id":"last","type":"send_sms","version":1,"config":{"body":"Starting in a minute","purpose":"informational"}}],
  "edges":[{"id":"a","source":"start","target":"w1"},{"id":"b","source":"w1","target":"text"},
    {"id":"c","source":"text","target":"w2"},{"id":"d","source":"w2","target":"last"}]}');
insert into booked select 123,pg_temp.book(211,123,(select t from moved_back)),(select t from moved_back);
select pg_temp.ok(pg_temp.events(25)=2,'lead 123 enrolls');
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp()
  where workflow_id=pg_temp.id(210) and contact_id=pg_temp.id(123);
-- Each lead follows one of the two automations; a booking the other one takes up is set aside.
create function pg_temp.own(lead_n integer) returns uuid language sql as $$
  select pg_temp.id(case when lead_n=123 then 212 else 210 end)
$$;
create function pg_temp.set_aside_other() returns void language sql as $$
  update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where workflow_id in (pg_temp.id(210),pg_temp.id(212)) and status in ('queued','waiting','held')
    and contact_id in (pg_temp.id(121),pg_temp.id(122),pg_temp.id(123))
    and workflow_id<>case contact_id when pg_temp.id(123) then pg_temp.id(212) else pg_temp.id(210) end
$$;
create function pg_temp.back(lead_n integer) returns text language sql as $$
  select coalesce(string_agg(r.status||':'||coalesce(r.reason,'-')||'@'||r.current_node_id,'; ' order by e.id),'none')
  from private.automation_runs r join private.automation_events e on e.id=r.event_id
  where r.workflow_id=pg_temp.own(lead_n) and r.contact_id=pg_temp.id(lead_n) and r.reason is distinct from 'Set aside'
$$;
create function pg_temp.texts_out(lead_n integer) returns bigint language sql as $$
  select count(*) from private.automation_intents i join private.automation_runs r on r.id=i.run_id
  where r.workflow_id=pg_temp.own(lead_n) and r.contact_id=pg_temp.id(lead_n) and i.node_id='text'
    and i.status in ('handed_off','accepted')
$$;
do $$ declare c jsonb; begin
  for i in 1..3 loop c:=pg_temp.work(); perform pg_temp.ok(c->>'result'='wait','each run waits for two minutes before'); end loop;
end $$;
select pg_sleep(greatest(0,extract(epoch from (select t from moved_back)-interval '2 minutes'-clock_timestamp()))+0.3);
do $$ declare c jsonb; begin
  for i in 1..3 loop c:=pg_temp.work(); perform pg_temp.ok(c->>'result'='elapsed','the first reminder time arrives'); end loop;
end $$;
-- Leads 122 and 123 are given the first reminder (synthetic transport); lead 121's is still to go.
update private.automation_runs set due_at=clock_timestamp()+interval '1 hour' where workflow_id=pg_temp.id(210) and contact_id=pg_temp.id(121);
do $$ declare c jsonb; begin
  for i in 1..2 loop
    select * into c from public.automation_claim_work(1);
    perform pg_temp.ok(c->>'node_id'='text' and public.automation_authorize_handoff((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'text'),
      'the first reminder is handed off');
    update private.automation_intents set status='accepted' where run_id=(c->>'run_id')::uuid and node_id='text';
    perform pg_temp.ok(public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'accepted',null),'and accepted');
  end loop;
  for i in 1..2 loop c:=pg_temp.work(); perform pg_temp.ok(c->>'node_id'='w2' and c->>'result'='wait','the second reminder waits'); end loop;
end $$;
select pg_temp.as_agent(format('update public.appointments set start_time=start_time+interval ''1 day'',end_time=end_time+interval ''1 day''
  where id=any(%L::uuid[])',(select array_agg(id) from booked where n in (121,122,123))));
select pg_temp.events(25);
select pg_temp.set_aside_other();
select pg_temp.ok(pg_temp.back(121)='stopped:Appointment was rescheduled@text; queued:-@w1'
    and pg_temp.back(122)='stopped:Appointment was rescheduled@w2; queued:-@w1'
    and pg_temp.back(123)='stopped:Appointment was rescheduled@w2; queued:-@w1',
  'the worker sees the move away and starts over for the other time: '||pg_temp.back(121)||' / '||pg_temp.back(122)||' / '||pg_temp.back(123));
do $$ declare c jsonb; begin
  for i in 1..3 loop c:=pg_temp.work(); perform pg_temp.ok(c->>'node_id'='w1' and c->>'result'='wait','the new runs wait for the other time'); end loop;
end $$;
select pg_temp.as_agent(format('update public.appointments set start_time=%L,end_time=%L where id=any(%L::uuid[])',
  (select t from moved_back),(select t+interval '30 minutes' from moved_back),(select array_agg(id) from booked where n in (121,122,123))));
select pg_temp.events(25);
select pg_temp.set_aside_other();
select pg_temp.ok(pg_temp.back(121)='queued:-@text; stopped:Appointment was moved back@w1'
    and pg_temp.back(122)='queued:-@w2; stopped:Appointment was moved back@w1'
    and pg_temp.back(123)='queued:-@w2; stopped:Appointment was moved back@w1',
  'moved back, the runs that followed this time carry on and the others end: '||pg_temp.back(121)||' / '||pg_temp.back(122)||' / '||pg_temp.back(123));
do $$
declare c jsonb; texts integer:=0; waits integer:=0;
begin
  for i in 1..3 loop
    select * into c from public.automation_claim_work(1);
    if c->>'node_id'='text' then
      texts:=texts+1;
      perform pg_temp.ok(c->>'contact_id'=pg_temp.id(121)::text
          and (c#>>'{context,appointment_start}')::timestamptz=(select t from moved_back)
          and public.automation_message_check((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'text') is null
          and public.automation_authorize_handoff((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'text'),
        'lead 121: the first reminder, still to go, goes out for the unchanged time');
    elsif c->>'node_id'='w2' then
      waits:=waits+1;
      perform public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'wait',null);
    end if;
  end loop;
  perform pg_temp.ok(texts=1 and waits=2,'one first reminder and two second-reminder waits are handed out: '||texts||' '||waits);
end $$;
select pg_temp.ok(pg_temp.texts_out(121)=1 and pg_temp.texts_out(122)=1 and pg_temp.texts_out(123)=1,
  'each lead gets the first reminder for this time exactly once, the late-sending automation included');
select pg_temp.ok((select count(*)=2 from private.automation_runs r where r.workflow_id in (pg_temp.id(210),pg_temp.id(212))
    and r.contact_id in (pg_temp.id(122),pg_temp.id(123)) and r.status='waiting' and r.current_node_id='w2'
    and r.due_at=(select t-interval '1 minute' from moved_back)),
  'and the second reminders wait for a minute before the unchanged time');

-- Moved away and back with the worker in between, across a conversation (lead 129), a cancellation the appointment
-- was moved back and reopened through in two saves (lead 130), or a cancellation then one save that moved and reopened
-- it before it was moved back (lead 131). The run that followed the original time carries on, with its stop rules
-- counted as a reopened booking's are: from an ordinary move back itself (leads 129 and 131), and from the move away
-- for lead 130, whose move back was made while it was cancelled. Neither reminder is given twice. Due times are forced,
-- so each reminder is given when its wait is reached.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
select pg_temp.publish(216,217,'Two task reminders (moved back)','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false,"stop_on_contact":true},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"w1","type":"wait_until_before_appointment","version":1,"config":{"amount":2,"unit":"days"}},
    {"id":"t1","type":"create_task","version":1,"config":{"title":"First reminder","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"w2","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days"}},
    {"id":"t2","type":"create_task","version":1,"config":{"title":"Second reminder","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"w1"},{"id":"b","source":"w1","target":"t1"},
    {"id":"c","source":"t1","target":"w2"},{"id":"d","source":"w2","target":"t2"}]}');
create function pg_temp.round_trip(lead_n integer) returns text language sql as $$
  select coalesce(string_agg(r.status||':'||coalesce(r.reason,'-')||'@'||r.current_node_id,'; ' order by e.id),'none')
  from private.automation_runs r join private.automation_events e on e.id=r.event_id
  where r.workflow_id=pg_temp.id(216) and r.contact_id=pg_temp.id(lead_n)
$$;
create function pg_temp.reminders(lead_n integer) returns text language sql as $$
  select coalesce(string_agg(t.title,', ' order by t.title),'none') from public.tasks t
    join private.automation_runs r on r.id=t.automation_run_id
  where r.workflow_id=pg_temp.id(216) and r.contact_id=pg_temp.id(lead_n)
$$;
select pg_temp.booking(216,129,5);
select pg_temp.booking(217,130,5);
select pg_temp.booking(218,131,5);
select pg_temp.ok(pg_temp.events(25)=3,'leads 129 to 131 enroll');
do $$
begin
  for i in 1..3 loop perform pg_temp.work(); end loop;
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(216) and status='waiting';
  for i in 1..9 loop perform pg_temp.work(); end loop;
end $$;
select pg_temp.ok((select bool_and(pg_temp.reminders(n)='First reminder' and pg_temp.round_trip(n)='waiting:-@w2')
    from (values (129),(130),(131)) v(n)),'each lead has its first reminder and waits for the second');
-- Lead 129: moved away (the worker sees it), a conversation, moved back.
select pg_temp.save(129,pg_temp.later(7));
select pg_temp.events(25);
select pg_temp.talk(129);
select pg_temp.save(129,format('start_time=%L',(select starts from booked where n=129)));
select pg_temp.events(25);
-- Lead 130: moved away (seen), cancelled (seen), moved back while cancelled (seen), reopened.
select pg_temp.save(130,pg_temp.later(7));
select pg_temp.events(25);
select pg_temp.save(130,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(130,format('start_time=%L',(select starts from booked where n=130)));
select pg_temp.events(25);
select pg_temp.save(130,'status=''Scheduled''');
select pg_temp.events(25);
-- Lead 131: cancelled (seen), one save moves it away and reopens it (the automation starts over for that time), then
-- moved back.
select pg_temp.save(131,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(131,pg_temp.later(7)||',status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.ok(pg_temp.round_trip(131)='stopped:Appointment was rescheduled@w2; queued:-@w1',
  'lead 131: the run a reopening at another time replaced is recorded as rescheduled: '||pg_temp.round_trip(131));
select pg_temp.save(131,format('start_time=%L',(select starts from booked where n=131)));
select pg_temp.events(25);
select pg_temp.ok((select bool_and(pg_temp.round_trip(n)='queued:-@w2; stopped:Appointment was moved back@w1')
    from (values (129),(130),(131)) v(n)),
  'moved back, the run that followed the original time carries on and the other ends: '
    ||pg_temp.round_trip(129)||' / '||pg_temp.round_trip(130)||' / '||pg_temp.round_trip(131));
select pg_temp.drive();
select pg_temp.ok((select bool_and(pg_temp.reminders(n)='First reminder, Second reminder') from (values (129),(130),(131)) v(n)),
  'each reminder is given once, the conversation before the move back included: '
    ||pg_temp.reminders(129)||' / '||pg_temp.reminders(130)||' / '||pg_temp.reminders(131));

-- A move back made while the appointment was cancelled is a reopened booking's move, not an ordinary one: the run it
-- carries on counts its stop rules from the latest booking the automation followed while the appointment stood (here
-- the move away), so a conversation or a reply since then ends its reminders once it is opened. Lead 136: a
-- conversation while it was cancelled, moved back while cancelled, then reopened. Lead 137: a reply at the other time,
-- then cancelled and the same saves. Lead 138: a conversation while it was cancelled, then one save that moved it back
-- and reopened it. Lead 139: the same with a reply. Lead 140: nothing in between, so both reminders are given. Lead 141:
-- a reply while it was cancelled ends the reminders when it is reopened at the other time; moved back afterwards in an
-- ordinary move, the run that followed the original time carries on, counted from that move, and neither reminder is
-- given twice.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(136,150) n;
create function pg_temp.two_reminders(settings jsonb) returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',settings,'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','w1','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',2,'unit','days')),
    jsonb_build_object('id','t1','type','create_task','version',1,'config',jsonb_build_object('title','First reminder','task_type','Follow Up','due_amount',0,'due_unit','minutes')),
    jsonb_build_object('id','w2','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',1,'unit','days')),
    jsonb_build_object('id','t2','type','create_task','version',1,'config',jsonb_build_object('title','Second reminder','task_type','Follow Up','due_amount',0,'due_unit','minutes'))),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','w1'),jsonb_build_object('id','b','source','w1','target','t1'),
      jsonb_build_object('id','c','source','t1','target','w2'),jsonb_build_object('id','d','source','w2','target','t2')))
$$;
create function pg_temp.trip(workflow_n integer, lead_n integer) returns text language sql as $$
  select coalesce(string_agg(r.status||':'||coalesce(r.reason,'-')||'@'||r.current_node_id,'; ' order by e.id,r.id),'none')
  from private.automation_runs r join private.automation_events e on e.id=r.event_id
  where r.workflow_id=pg_temp.id(workflow_n) and r.contact_id=pg_temp.id(lead_n)
$$;
create function pg_temp.given(workflow_n integer, lead_n integer) returns text language sql as $$
  select coalesce(string_agg(t.title,', ' order by t.title),'none') from public.tasks t
    join private.automation_runs r on r.id=t.automation_run_id
  where r.workflow_id=pg_temp.id(workflow_n) and r.contact_id=pg_temp.id(lead_n)
$$;
-- The worker runs every active automation until nothing is left, each wait ending as soon as it is checked.
create function pg_temp.finish() returns void language plpgsql as $$
begin
  for i in 1..80 loop
    update private.automation_runs r set due_at=clock_timestamp()-interval '1 second'
      from public.workflows w where w.id=r.workflow_id and w.status='active' and r.status='waiting';
    if pg_temp.work() is null then return; end if;
  end loop;
  raise exception 'Automation V2 appointments: work still due after 80 steps';
end $$;
-- Every step due now, then each wait ends as soon as it is placed, until the reminders are waiting for the second.
create function pg_temp.first_reminders(workflow_n integer) returns void language plpgsql as $$
begin
  for i in 1..20 loop exit when pg_temp.work() is null; end loop;
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(workflow_n) and status='waiting';
  for i in 1..40 loop exit when pg_temp.work() is null; end loop;
end $$;
select pg_temp.publish(220,221,'Two task reminders (stop rules across a move back)',
  pg_temp.two_reminders('{"reentry":"once","stop_on_reply":true,"stop_on_contact":true}'));
select pg_temp.booking(200+n,n,5) from generate_series(136,141) n;
select pg_temp.ok(pg_temp.events(25)=6,'leads 136 to 141 enroll');
select pg_temp.first_reminders(220);
select pg_temp.ok((select bool_and(pg_temp.given(220,n)='First reminder' and pg_temp.trip(220,n)='waiting:-@w2')
    from generate_series(136,141) n),'each lead has its first reminder and waits for the second');
select pg_temp.save(n,pg_temp.later(7)) from generate_series(136,141) n;
select pg_temp.events(25);
select pg_temp.reply(137);
select pg_temp.save(n,'status=''Cancelled''') from generate_series(136,141) n;
select pg_temp.events(25);
select pg_temp.talk(136);
select pg_temp.talk(138);
select pg_temp.reply(139);
select pg_temp.reply(141);
select pg_temp.save(n,format('start_time=%L',(select starts from booked where booked.n=v.n))) from (values (136),(137)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from (values (136),(137),(141)) v(n);
select pg_temp.save(n,format('start_time=%L,status=''Scheduled''',(select starts from booked where booked.n=v.n)))
  from (values (138),(139),(140)) v(n);
select pg_temp.events(25);
select pg_temp.ok(pg_temp.trip(220,141)='stopped:Appointment was rescheduled@w2; stopped:Appointment was cancelled@w1',
  'lead 141: reopened at the other time after a reply while it was cancelled, nothing starts: '||pg_temp.trip(220,141));
select pg_temp.save(141,format('start_time=%L',(select starts from booked where n=141)));
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok((select bool_and(pg_temp.given(220,n)='First reminder' and pg_temp.trip(220,n) not like '%queued%'
      and pg_temp.trip(220,n) not like '%waiting%') from generate_series(136,139) n),
  'a conversation or a reply since the move away ends the reminders a move back made while cancelled carried on: '
    ||pg_temp.given(220,136)||' / '||pg_temp.given(220,137)||' / '||pg_temp.given(220,138)||' / '||pg_temp.given(220,139));
select pg_temp.ok((select bool_and(pg_temp.given(220,n)='First reminder, Second reminder') from (values (140),(141)) v(n)),
  'with nothing in between, or after an ordinary move back, each reminder is given once: '
    ||pg_temp.given(220,140)||' / '||pg_temp.given(220,141));

-- Cancelled, then one save moves the appointment to another time and reopens it while the automation is on, and the
-- automation is paused before the worker sees that save: the booking is kept for the resume and starts over then. The
-- run it replaced is recorded as rescheduled when the new run starts, so a later move back to the original time
-- carries that run on, and neither reminder is given twice (lead 142).
update public.workflows set status='paused' where id=pg_temp.id(220);
select pg_temp.publish(222,223,'Two task reminders (kept for a resume)',pg_temp.two_reminders('{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(342,142,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 142 enrolls');
select pg_temp.first_reminders(222);
select pg_temp.ok(pg_temp.given(222,142)='First reminder' and pg_temp.trip(222,142)='waiting:-@w2','lead 142 has its first reminder');
select pg_temp.save(142,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(142,pg_temp.later(7)||',status=''Scheduled''');
select pg_temp.lifecycle(222,'pause');
select pg_temp.events(25);
select pg_temp.ok(pg_temp.trip(222,142)='stopped:Appointment was cancelled@w2'
    and exists (select 1 from private.automation_deferred_admissions d where d.workflow_id=pg_temp.id(222)),
  'paused before the worker saw the save, the automation keeps the booking for its resume: '||pg_temp.trip(222,142));
select pg_temp.lifecycle(222,'resume');
select pg_temp.events(25);
select pg_temp.ok(pg_temp.trip(222,142)='stopped:Appointment was rescheduled@w2; queued:-@w1',
  'resumed, it starts over for the new time and records the run it replaced as rescheduled: '||pg_temp.trip(222,142));
select pg_temp.save(142,format('start_time=%L',(select starts from booked where n=142)));
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(222,142)='First reminder, Second reminder',
  'moved back, each reminder is given once: '||pg_temp.given(222,142)||' / '||pg_temp.trip(222,142));

-- A stop a person made, or the stop after seven days on hold, ends its own run, and reopened at the time that run
-- followed nothing starts, on the same slot (lead 124 above) or on another slot at that time: moved away and back while
-- cancelled in two saves (lead 143, and lead 145 after seven days on hold), or moved away and then back and reopened
-- in one save (lead 144).
update public.workflows set status='paused' where id=pg_temp.id(222);
select pg_temp.publish(224,225,'Reminder (a stop at the same time)',
  pg_temp.reminder_graph('Reminder (stopped)','{"reentry":"once","stop_on_reply":false}'));
-- Lead 145 first, alone, so its reminder step can be held until the hold ends the run.
select pg_temp.booking(345,145,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 145 enrolls');
do $$
declare c jsonb;
begin
  perform pg_temp.ok(pg_temp.work()->>'result'='wait','lead 145 waits for the day before');
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(224) and status='waiting';
  perform pg_temp.ok(pg_temp.work()->>'result'='elapsed','lead 145: the day before arrives');
  select * into c from public.automation_claim_work(1);
  perform pg_temp.ok(c->>'node_id'='task' and public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'held','Fixture hold'),
    'lead 145: the reminder is held');
  update private.automation_runs set held_since=clock_timestamp()-interval '8 days',due_at=clock_timestamp()-interval '1 second'
    where workflow_id=pg_temp.id(224) and contact_id=pg_temp.id(145);
  select * into c from public.automation_claim_work(1);
  perform public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'held','Fixture hold');
end $$;
select pg_temp.ok(pg_temp.trip(224,145)='stopped:Stopped after 7 days on hold: Fixture hold@task',
  'lead 145: seven days on hold end the run: '||pg_temp.trip(224,145));
select pg_temp.booking(200+n,n,5) from (values (143),(144)) v(n);
select pg_temp.ok(pg_temp.events(25)=2,'leads 143 and 144 enroll');
do $$ begin for i in 1..5 loop exit when pg_temp.work() is null; end loop; end $$;
do $$
begin
  perform pg_temp.act(10);
  perform public.automation_stop_run(r.id,(public.automation_session_context()->>'revision')::bigint)
    from private.automation_runs r where r.workflow_id=pg_temp.id(224) and r.contact_id in (pg_temp.id(143),pg_temp.id(144));
  perform pg_temp.nobody();
end $$;
select pg_temp.ok((select bool_and(pg_temp.trip(224,n)='stopped:Stopped by user@until') from (values (143),(144)) v(n)),
  'an Admin stops the reminders of leads 143 and 144');
select pg_temp.save(n,'status=''Cancelled''') from (values (143),(144),(145)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.later(7)) from (values (143),(144),(145)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,format('start_time=%L',(select starts from booked where booked.n=v.n))) from (values (143),(145)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from (values (143),(145)) v(n);
select pg_temp.save(144,format('start_time=%L,status=''Scheduled''',(select starts from booked where n=144)));
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok((select bool_and(pg_temp.given(224,n)='none' and pg_temp.trip(224,n) like 'stopped:Stopped %'
      and pg_temp.trip(224,n) not like '%;%') from (values (143),(144),(145)) v(n)),
  'reopened at the time the stopped run followed, on another slot, nothing starts: '
    ||pg_temp.trip(224,143)||' / '||pg_temp.trip(224,144)||' / '||pg_temp.trip(224,145));

-- An appointment deleted while its slot record could not be written (the evidence capture off, as during an incident):
-- the calendar row is gone, so a text already picked up is refused and its run ends as removed (lead 146), and a
-- reminder still waiting ends the same way when it comes due, without being written (lead 147).
update public.workflows set status='paused' where id=pg_temp.id(224);
delete from private.automation_deferred_admissions where workflow_id=pg_temp.id(140);
update public.workflows set status='active' where id=pg_temp.id(140);
select pg_temp.text_picked_up(346,146,date_trunc('minute',clock_timestamp())+interval '3 hours');
insert into booked select 147,pg_temp.book(347,147,t),t from (select date_trunc('minute',clock_timestamp())+interval '3 hours' t) x;
select pg_temp.ok(pg_temp.events(25)=1,'lead 147: the booking enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='wait','lead 147: it waits for the hour before');
alter table public.appointments disable trigger appointments_v3_evidence_capture;
select pg_temp.as_agent(format('delete from public.appointments where id=%L',(select id from booked where booked.n=v.n)))
  from (values (146),(147)) v(n);
alter table public.appointments enable trigger appointments_v3_evidence_capture;
select pg_temp.ok((select count(*)=2 from booked b where b.n in (146,147) and pg_temp.slot(b.n) is not null
    and not exists (select 1 from public.appointments a where a.id=b.id)),
  'leads 146 and 147: the calendar rows are gone while their slot records still stand');
select pg_temp.ok(pg_temp.check(146)='Appointment was removed' and not pg_temp.hand_off(146) and pg_temp.intent(146)='prepared',
  'a text about an appointment deleted while its slot record was not written is refused: '||coalesce(pg_temp.check(146),'nothing'));
select pg_temp.held(146);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(140) and contact_id=pg_temp.id(147);
select pg_temp.ok(pg_temp.work() is null
    and (select bool_and((pg_temp.texts(n)).status='stopped' and (pg_temp.texts(n)).reason='Appointment was removed') from (values (146),(147)) v(n))
    and not exists (select 1 from private.automation_intents i where i.run_id=(pg_temp.texts(147)).id),
  'and both runs end as removed, the waiting reminder without being written: '
    ||coalesce((pg_temp.texts(146)).reason,'-')||' / '||coalesce((pg_temp.texts(147)).reason,'-'));

-- A booking whose appointment was reopened counts from its reopening, as its admission and its pacing do. Moved to a
-- time between the booking and the reopening, the appointment began before that, so its confirmation is skipped
-- whether the run was carried on at the reopening (lead 148) or admitted there (lead 149), and so is a follow-up timed
-- after the start (lead 150), as for an appointment moved to before an ordinary booking (lead 128).
update public.workflows set status='paused' where id=pg_temp.id(140);
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
delete from private.automation_deferred_admissions where workflow_id=pg_temp.id(142);
update public.workflows set status='active' where id=pg_temp.id(142);
create function pg_temp.back_to_booking(lead_n integer) returns void language plpgsql as $$
declare booked_at timestamptz;
begin
  select e.occurred_at into strict booked_at from private.automation_events e where e.event_type='appointment_booked'
    and e.subject->>'appointment_id'=(select id::text from booked where n=lead_n) order by e.occurred_at limit 1;
  perform pg_temp.as_agent(format('update public.appointments set start_time=%L,end_time=%L where id=%L',
    booked_at+interval '0.5 second',booked_at+interval '30 minutes',(select id from booked where n=lead_n)));
end $$;
insert into booked select 148,pg_temp.book(348,148,t),t from (select date_trunc('minute',clock_timestamp())+interval '2 days' t) x;
select pg_temp.ok(pg_temp.events(25)=1,'lead 148: the booking enrolls the confirmation');
do $$
declare lease jsonb;
begin
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.ok(lease->>'node_id'='text' and lease->>'contact_id'=pg_temp.id(148)::text,'lead 148: the confirmation is picked up');
  perform public.automation_finish_node((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,'held','Outside the recipient local sending window.');
end $$;
insert into booked select 149,pg_temp.book(349,149,t),t from (select date_trunc('minute',clock_timestamp())+interval '2 days' t) x;
select pg_temp.save(149,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.ok(not exists (select 1 from private.automation_runs where workflow_id=pg_temp.id(142) and contact_id=pg_temp.id(149)),
  'lead 149: booked and cancelled before the worker saw it, nothing starts');
select pg_sleep(1.5);
select pg_temp.save(148,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from (values (148),(149)) v(n);
select pg_temp.events(25);
select pg_temp.ok((select count(*)=2 from private.automation_runs r join private.automation_events e on e.id=r.event_id
    where r.workflow_id=pg_temp.id(142) and r.contact_id in (pg_temp.id(148),pg_temp.id(149)) and r.status in ('queued','held','waiting')
      and r.paced_from>e.occurred_at+interval '1 second'),
  'leads 148 and 149: reopened, the confirmation follows the appointment again, paced from the reopening');
select pg_temp.back_to_booking(n) from (values (148),(149)) v(n);
select pg_temp.events(25);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(142)
  and contact_id in (pg_temp.id(148),pg_temp.id(149)) and status in ('queued','held','waiting');
do $$
declare lease jsonb;
begin
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.ok(lease is null and (select count(*)=2 from private.automation_runs r
      join private.automation_steps s on s.run_id=r.id and s.node_id='text'
      where r.workflow_id=pg_temp.id(142) and r.contact_id in (pg_temp.id(148),pg_temp.id(149)) and r.status='completed'
        and s.status='skipped' and s.reason='The appointment had already started'),
    'moved to a time between the booking and its reopening, the confirmation is skipped: '||coalesce(lease->>'contact_id','nothing leased'));
end $$;
update public.workflows set status='paused' where id=pg_temp.id(142);
select pg_temp.publish(226,227,'Follow-up text after the appointment','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"pause","type":"wait","version":1,"config":{"duration":1,"unit":"days"}},
    {"id":"text","type":"send_sms","version":1,"config":{"body":"Thanks for meeting on {{appointment_time}}","purpose":"informational"}}],
  "edges":[{"id":"a","source":"start","target":"pause"},{"id":"b","source":"pause","target":"text"}]}');
insert into booked select 150,pg_temp.book(350,150,t),t from (select date_trunc('minute',clock_timestamp())+interval '2 days' t) x;
select pg_temp.ok(pg_temp.events(25)=1,'lead 150: the booking enrolls the follow-up');
select pg_temp.ok(pg_temp.work()->>'result'='wait','lead 150: the follow-up waits a day');
select pg_sleep(1.5);
select pg_temp.save(150,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(150,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.back_to_booking(150);
select pg_temp.events(25);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(226)
  and contact_id=pg_temp.id(150) and status in ('queued','held','waiting');
do $$
declare lease jsonb;
begin
  for i in 1..3 loop
    select * into lease from public.automation_claim_work(1);
    exit when lease is null;
    perform pg_temp.ok(lease->>'node_id'='pause','lead 150: only the wait is handed out, never the text: '||(lease->>'node_id'));
    perform public.automation_finish_node((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,'elapsed',null);
  end loop;
  perform pg_temp.ok((select r.status='completed' and s.status='skipped' and s.reason='The appointment had already started'
      from private.automation_runs r join private.automation_steps s on s.run_id=r.id and s.node_id='text'
      where r.workflow_id=pg_temp.id(226) and r.contact_id=pg_temp.id(150)),
    'the follow-up timed after the start is skipped too: the appointment began before its reopening');
end $$;

-- After a move back carried a run on, every later run it replaced is recorded as replaced, a run a stop rule had already
-- ended included, so the run carried on stays the one that follows the appointment: a person's stop on it holds when
-- the appointment is reopened at its time after a move away and back while cancelled (lead 151), and a cancellation
-- taken back on the same slot carries it on, so its second reminder is given (lead 152).
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(151,160) n;
select pg_temp.publish(228,229,'Two task reminders (after a move back)',
  pg_temp.two_reminders('{"reentry":"once","stop_on_reply":true,"stop_on_contact":true}'));
select pg_temp.booking(200+n,n,5) from (values (151),(152)) v(n);
select pg_temp.ok(pg_temp.events(25)=2,'leads 151 and 152 enroll');
select pg_temp.first_reminders(228);
select pg_temp.ok((select bool_and(pg_temp.given(228,n)='First reminder' and pg_temp.trip(228,n)='waiting:-@w2')
    from (values (151),(152)) v(n)),'leads 151 and 152 have their first reminder');
select pg_temp.save(n,pg_temp.later(7)) from (values (151),(152)) v(n);
select pg_temp.events(25);
select pg_temp.reply(n) from (values (151),(152)) v(n);
select pg_temp.save(n,format('start_time=%L',(select starts from booked where booked.n=v.n))) from (values (151),(152)) v(n);
select pg_temp.events(25);
select pg_temp.ok((select bool_and(pg_temp.trip(228,n)='queued:-@w2; stopped:Appointment was moved back@w1') from (values (151),(152)) v(n)),
  'moved back after a reply ended the run for the other time, that run is recorded as replaced: '||pg_temp.trip(228,151));
do $$
begin
  perform pg_temp.act(10);
  perform public.automation_stop_run(r.id,(public.automation_session_context()->>'revision')::bigint)
    from private.automation_runs r where r.workflow_id=pg_temp.id(228) and r.contact_id=pg_temp.id(151) and r.status in ('queued','waiting','held');
  perform pg_temp.nobody();
end $$;
select pg_temp.save(n,'status=''Cancelled''') from (values (151),(152)) v(n);
select pg_temp.events(25);
select pg_temp.save(151,pg_temp.later(8));
select pg_temp.events(25);
select pg_temp.save(151,format('start_time=%L',(select starts from booked where n=151)));
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from (values (151),(152)) v(n);
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(228,151)='First reminder' and pg_temp.trip(228,151) not like '%queued%'
    and pg_temp.trip(228,151) not like '%waiting%',
  'a person''s stop on the run a move back carried on holds when the appointment is reopened at that time: '
    ||pg_temp.given(228,151)||' / '||pg_temp.trip(228,151));
select pg_temp.ok(pg_temp.given(228,152)='First reminder, Second reminder',
  'a cancellation taken back carries the moved-back run on, and its second reminder is given: '
    ||pg_temp.given(228,152)||' / '||pg_temp.trip(228,152));

-- A deletion the slot record missed ends a run started by a no-show too: the no-show text already picked up is
-- refused, and the run ends as removed (lead 153).
update public.workflows set status='paused' where id=pg_temp.id(228);
select pg_temp.publish(230,231,'No-show text (deleted appointment)','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_outcome_recorded","version":1,"config":{"outcomes":["no_show"]}},
    {"id":"text","type":"send_sms","version":1,"config":{"body":"Sorry we missed you on {{appointment_time}}","purpose":"informational"}}],
  "edges":[{"id":"a","source":"start","target":"text"}]}');
insert into booked select 153,pg_temp.book(353,153,t),t from (select date_trunc('minute',clock_timestamp())-interval '3 hours' t) x;
select pg_temp.events(25);
select pg_temp.as_agent(format('update public.appointments set status=''No Show'' where id=%L',(select id from booked where n=153)));
select pg_temp.ok(pg_temp.events(25)=1,'lead 153: the no-show enrolls the text');
do $$
declare lease jsonb;
begin
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.ok(lease->>'node_id'='text' and lease->>'contact_id'=pg_temp.id(153)::text,'lead 153: the no-show text is picked up');
  delete from leases where n=153;
  insert into leases values (153,lease);
end $$;
alter table public.appointments disable trigger appointments_v3_evidence_capture;
select pg_temp.as_agent(format('delete from public.appointments where id=%L',(select id from booked where n=153)));
alter table public.appointments enable trigger appointments_v3_evidence_capture;
select pg_temp.ok(pg_temp.check(153)='Appointment was removed' and not pg_temp.hand_off(153) and pg_temp.intent(153)='prepared',
  'a no-show text about an appointment deleted while its slot record was not written is refused: '||coalesce(pg_temp.check(153),'nothing'));
select pg_temp.held(153);
select pg_temp.ok(pg_temp.work() is null,'lead 153: nothing is handed out');
select pg_temp.ok((select r.status='stopped' and r.reason='Appointment was removed'
    from private.automation_runs r where r.workflow_id=pg_temp.id(230) and r.contact_id=pg_temp.id(153)),
  'and its run ends as removed');

-- Cancelled after the appointment started and put back: any recorded reopening counts, one after the start included, so
-- the appointment gets no further text or email whether or not the worker saw the cancellation. Unseen, a follow-up
-- text timed after the start is skipped as begun before its reopening (lead 154, and lead 159, also moved while
-- cancelled to a time between its booking and its reopening); seen, the cancellation ends the run, which is not carried
-- on after the start (lead 160).
update public.workflows set status='paused' where id=pg_temp.id(230);
delete from private.automation_deferred_admissions where workflow_id=pg_temp.id(226);
update public.workflows set status='active' where id=pg_temp.id(226);
insert into booked select n,pg_temp.book(200+n,n,t),t from (select clock_timestamp()+interval '2 seconds' t) x,(values (154),(159),(160)) v(n);
select pg_temp.ok(pg_temp.events(25)=3,'leads 154, 159 and 160: the bookings enroll the follow-up');
do $$ begin for i in 1..3 loop perform pg_temp.ok(pg_temp.work()->>'result'='wait','the follow-up waits a day'); end loop; end $$;
select pg_sleep(greatest(0,extract(epoch from (select max(starts) from booked where n in (154,159,160))-clock_timestamp()))+0.3);
select pg_temp.save(154,'status=''Cancelled''');
select pg_temp.save(154,'status=''Scheduled''');
select pg_temp.save(159,'status=''Cancelled''');
select pg_temp.back_to_booking(159);
select pg_temp.save(159,'status=''Scheduled''');
select pg_temp.save(160,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(160,'status=''Scheduled''');
select pg_temp.events(25);
-- The waits end after the start, so the follow-ups are timed after it.
select pg_sleep(1.2);
update private.automation_runs set due_at=clock_timestamp()-interval '0.1 second' where workflow_id=pg_temp.id(226)
  and contact_id in (pg_temp.id(154),pg_temp.id(159),pg_temp.id(160)) and status in ('queued','held','waiting');
do $$
declare lease jsonb;
begin
  for i in 1..4 loop
    select * into lease from public.automation_claim_work(1);
    exit when lease is null;
    perform pg_temp.ok(lease->>'node_id'='pause','only the waits are handed out, never a follow-up: '||(lease->>'node_id'));
    perform public.automation_finish_node((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,'elapsed',null);
  end loop;
end $$;
select pg_temp.ok((select count(*)=2 from private.automation_runs r join private.automation_steps s on s.run_id=r.id and s.node_id='text'
    where r.workflow_id=pg_temp.id(226) and r.contact_id in (pg_temp.id(154),pg_temp.id(159)) and r.status='completed'
      and s.status='skipped' and s.reason='The appointment had already started'),
  'cancelled and put back after the start before the worker saw it, the follow-up is skipped');
select pg_temp.ok((select r.status='stopped' and r.reason='Appointment was cancelled' from private.automation_runs r
    where r.workflow_id=pg_temp.id(226) and r.contact_id=pg_temp.id(160)),
  'and when the worker saw the cancellation, the run it ended is not carried on after the start');

-- Cancelled at the time its reminders were for, then a reply (lead 155) or a conversation (lead 156) while cancelled,
-- then one save moves the appointment to another time and reopens it: the stop rule refuses that time, and the run the
-- cancellation stopped is recorded as rescheduled all the same. Moved back to the original time in an ordinary move, that
-- run carries on, counted from the move back, so each reminder is given once. Leads 157 and 158 have the same start, then
-- are cancelled again, moved back while cancelled and reopened: the stop rules still end their reminders.
update public.workflows set status='paused' where id=pg_temp.id(226);
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
select pg_temp.publish(232,233,'Two task reminders (a refused reopening)',
  pg_temp.two_reminders('{"reentry":"once","stop_on_reply":true,"stop_on_contact":true}'));
select pg_temp.booking(200+n,n,5) from generate_series(155,158) n;
select pg_temp.ok(pg_temp.events(25)=4,'leads 155 to 158 enroll');
select pg_temp.first_reminders(232);
select pg_temp.ok((select bool_and(pg_temp.given(232,n)='First reminder' and pg_temp.trip(232,n)='waiting:-@w2')
    from generate_series(155,158) n),'leads 155 to 158 have their first reminder');
select pg_temp.save(n,'status=''Cancelled''') from generate_series(155,158) n;
select pg_temp.events(25);
select pg_temp.reply(n) from (values (155),(157)) v(n);
select pg_temp.talk(n) from (values (156),(158)) v(n);
select pg_temp.save(n,pg_temp.later(7)||',status=''Scheduled''') from generate_series(155,158) n;
select pg_temp.events(25);
select pg_temp.ok((select bool_and(pg_temp.trip(232,n)='stopped:Appointment was rescheduled@w2') from generate_series(155,158) n),
  'reopened at another time that a stop rule refuses, nothing starts and the stopped run is recorded as rescheduled: '
    ||pg_temp.trip(232,155)||' / '||pg_temp.trip(232,156));
select pg_temp.save(n,format('start_time=%L',(select starts from booked where booked.n=v.n))) from (values (155),(156)) v(n);
select pg_temp.save(n,'status=''Cancelled''') from (values (157),(158)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,format('start_time=%L',(select starts from booked where booked.n=v.n))) from (values (157),(158)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from (values (157),(158)) v(n);
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok((select bool_and(pg_temp.given(232,n)='First reminder, Second reminder') from (values (155),(156)) v(n)),
  'moved back in an ordinary move, the run that followed the original time carries on and each reminder is given once: '
    ||pg_temp.given(232,155)||' / '||pg_temp.given(232,156));
select pg_temp.ok((select bool_and(pg_temp.given(232,n)='First reminder' and pg_temp.trip(232,n) not like '%queued%'
      and pg_temp.trip(232,n) not like '%waiting%') from (values (157),(158)) v(n)),
  'moved back while cancelled and reopened, the reply or conversation still ends the reminders: '
    ||pg_temp.trip(232,157)||' / '||pg_temp.trip(232,158));

-- A move back carries on the run that followed the original time. When the appointment was cancelled and stood again
-- after that run ended, the run counts from the recorded reopening, as a cancellation taken back does: a plain wait
-- whose end passed while the appointment was cancelled ends at the reopening, so the task after it is due no earlier
-- (lead 161: moved away, cancelled and moved back while cancelled; lead 166: cancelled while moved away, reopened there,
-- then moved back), as after a cancellation taken back on the same slot (lead 162). An ordinary move away and back, with
-- no cancellation, keeps the wait's end (lead 163). A reminder whose time passed while the appointment was cancelled goes
-- out late paced from the reopening, after a move back (lead 164) as after a cancellation taken back (lead 165).
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(161,166) n;
create temporary table moved_at(n integer primary key, at timestamptz) on commit drop;
create temporary table cancelled_at(n integer primary key, at timestamptz) on commit drop;
select pg_temp.publish(234,235,'Reminder, then a plain wait (a move back after a cancellation)','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"w1","type":"wait_until_before_appointment","version":1,"config":{"amount":2,"unit":"days"}},
    {"id":"t1","type":"create_task","version":1,"config":{"title":"First reminder","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"pause","type":"wait","version":1,"config":{"duration":2,"unit":"days"}},
    {"id":"t2","type":"create_task","version":1,"config":{"title":"After the wait","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"w1"},{"id":"b","source":"w1","target":"t1"},
    {"id":"c","source":"t1","target":"pause"},{"id":"d","source":"pause","target":"t2"}]}');
select pg_temp.booking(200+n,n,5) from (values (161),(162),(163),(166)) v(n);
select pg_temp.ok(pg_temp.events(25)=4,'leads 161, 162, 163 and 166 enroll');
select pg_temp.first_reminders(234);
select pg_temp.ok((select bool_and(pg_temp.given(234,n)='First reminder' and pg_temp.trip(234,n)='waiting:-@pause')
    from (values (161),(162),(163),(166)) v(n)),'each lead has its first reminder and its plain wait has started');
select pg_temp.save(n,pg_temp.later(7)) from (values (161),(163),(166)) v(n);
select pg_temp.events(25);
do $$ begin for i in 1..20 loop exit when pg_temp.work() is null; end loop; end $$;
select pg_temp.ok((select bool_and(pg_temp.trip(234,n)='stopped:Appointment was rescheduled@pause; waiting:-@w1')
    from (values (161),(163),(166)) v(n)),'moved away, the automation follows the other time: '||pg_temp.trip(234,161));
select pg_temp.save(n,'status=''Cancelled''') from (values (161),(162),(166)) v(n);
select pg_temp.events(25);
select pg_temp.save(161,format('start_time=%L',(select starts from booked where n=161)));
select pg_temp.events(25);
-- Each plain wait's end passes now: while cancelled for leads 161, 162 and 166, while moved away for lead 163.
update private.automation_runs set due_at=clock_timestamp()
  where workflow_id=pg_temp.id(234) and current_node_id='pause' and contact_id in (select pg_temp.id(n) from generate_series(161,166) n);
select pg_sleep(0.5);
insert into reopened select n,clock_timestamp() from (values (161),(162),(166)) v(n);
insert into moved_at values (163,clock_timestamp());
select pg_temp.save(n,'status=''Scheduled''') from (values (161),(162),(166)) v(n);
select pg_temp.save(163,format('start_time=%L',(select starts from booked where n=163)));
select pg_temp.events(25);
select pg_temp.save(166,format('start_time=%L',(select starts from booked where n=166)));
select pg_temp.events(25);
do $$ begin for i in 1..20 loop exit when pg_temp.work() is null; end loop; end $$;
select pg_temp.ok((select bool_and(pg_temp.given(234,n)='After the wait, First reminder') from (values (161),(162),(163),(166)) v(n)),
  'each lead gets the task after the wait once: '||pg_temp.given(234,161)||' / '||pg_temp.given(234,166)||' / '||pg_temp.trip(234,161));
select pg_temp.ok((select bool_and(t.due_date>=o.at) from reopened o join private.automation_runs r
      on r.workflow_id=pg_temp.id(234) and r.contact_id=pg_temp.id(o.n) join public.tasks t on t.automation_run_id=r.id
    where t.title='After the wait' and o.n in (161,166)),
  'after a cancellation and a move back, the task after the plain wait is due no earlier than the reopening: '
    ||(select string_agg(format('lead %s %s',o.n,t.due_date-o.at),', ' order by o.n) from reopened o join private.automation_runs r
      on r.workflow_id=pg_temp.id(234) and r.contact_id=pg_temp.id(o.n) join public.tasks t on t.automation_run_id=r.id
    where t.title='After the wait'));
select pg_temp.ok((select t.due_date>=o.at from reopened o join private.automation_runs r
      on r.workflow_id=pg_temp.id(234) and r.contact_id=pg_temp.id(o.n) join public.tasks t on t.automation_run_id=r.id
    where t.title='After the wait' and o.n=162),
  'after a cancellation taken back on the same slot, the task after the plain wait is due no earlier than the reopening');
select pg_temp.ok((select t.due_date<m.at from moved_at m join private.automation_runs r
      on r.workflow_id=pg_temp.id(234) and r.contact_id=pg_temp.id(m.n) join public.tasks t on t.automation_run_id=r.id
    where t.title='After the wait' and m.n=163),
  'an ordinary move away and back keeps the plain wait''s end, so the task after it is due from that end');
update public.workflows set status='paused' where id=pg_temp.id(234);
select pg_temp.publish(236,237,'Two reminders that go out late (a move back after a cancellation)','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"w1","type":"wait_until_before_appointment","version":1,"config":{"amount":2,"unit":"days","late":"continue"}},
    {"id":"t1","type":"create_task","version":1,"config":{"title":"First reminder","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"w2","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"days","late":"continue"}},
    {"id":"t2","type":"create_task","version":1,"config":{"title":"Second reminder","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"w1"},{"id":"b","source":"w1","target":"t1"},
    {"id":"c","source":"t1","target":"w2"},{"id":"d","source":"w2","target":"t2"}]}');
insert into booked select n,pg_temp.book(200+n,n,x.t),x.t from (values (164),(165)) v(n),
  (select date_trunc('second',clock_timestamp())+interval '1 day 10 seconds' t) x;
select pg_temp.ok(pg_temp.events(25)=2,'leads 164 and 165 enroll');
do $$ begin for i in 1..20 loop exit when pg_temp.work() is null; end loop; end $$;
select pg_temp.ok((select bool_and(pg_temp.given(236,n)='First reminder' and pg_temp.trip(236,n)='waiting:-@w2') from (values (164),(165)) v(n)),
  'the first reminder goes out late at once and the second waits for its time: '||pg_temp.trip(236,164)||' / '||pg_temp.trip(236,165));
select pg_temp.save(164,pg_temp.later(7));
select pg_temp.events(25);
do $$ begin for i in 1..20 loop exit when pg_temp.work() is null; end loop; end $$;
select pg_temp.ok(pg_temp.trip(236,164)='stopped:Appointment was rescheduled@w2; waiting:-@w1',
  'lead 164 moved away, the automation follows the other time: '||pg_temp.trip(236,164));
insert into cancelled_at select n,clock_timestamp() from (values (164),(165)) v(n);
select pg_temp.save(n,'status=''Cancelled''') from (values (164),(165)) v(n);
select pg_temp.events(25);
select pg_temp.save(164,format('start_time=%L',(select starts from booked where n=164)));
select pg_temp.events(25);
select pg_sleep(greatest(0,extract(epoch from (select max(starts) from booked where n in (164,165))-interval '1 day'-clock_timestamp()))+0.3);
insert into reopened select n,clock_timestamp() from (values (164),(165)) v(n);
select pg_temp.ok((select bool_and(c.at<b.starts-interval '1 day' and b.starts-interval '1 day'<o.at and o.at<b.starts)
    from booked b join cancelled_at c using(n) join reopened o using(n) where b.n in (164,165)),
  'the second reminder''s time passed while the appointment was cancelled, and the appointment is still ahead');
select pg_temp.save(n,'status=''Scheduled''') from (values (164),(165)) v(n);
select pg_temp.events(25);
do $$ begin for i in 1..20 loop exit when pg_temp.work() is null; end loop; end $$;
select pg_temp.ok((select bool_and(pg_temp.given(236,n)='First reminder, Second reminder') from (values (164),(165)) v(n)),
  'the second reminder goes out late once: '||pg_temp.given(236,164)||' / '||pg_temp.trip(236,164)||' / '||pg_temp.given(236,165));
select pg_temp.ok((select bool_and(t.due_date>=o.at) from reopened o join private.automation_runs r
      on r.workflow_id=pg_temp.id(236) and r.contact_id=pg_temp.id(o.n) join public.tasks t on t.automation_run_id=r.id
    where t.title='Second reminder' and o.n=164),
  'after a cancellation and a move back, the reminder that goes out late is paced from the reopening: '
    ||(select string_agg(format('lead %s %s',o.n,t.due_date-o.at),', ' order by o.n) from reopened o join private.automation_runs r
      on r.workflow_id=pg_temp.id(236) and r.contact_id=pg_temp.id(o.n) join public.tasks t on t.automation_run_id=r.id
    where t.title='Second reminder' and o.n in (164,165)));
select pg_temp.ok((select t.due_date>=o.at from reopened o join private.automation_runs r
      on r.workflow_id=pg_temp.id(236) and r.contact_id=pg_temp.id(o.n) join public.tasks t on t.automation_run_id=r.id
    where t.title='Second reminder' and o.n=165),
  'after a cancellation taken back on the same slot, the reminder that goes out late is paced from the reopening');

-- The run a cancellation stopped is recorded as replaced whenever a run starts for another time, so a later move back
-- carries it on and no reminder goes twice: after a reopening and a move to another time the worker saw together (lead
-- 167, its control 168 seeing each save), and the same with the automation paused for that pass and resumed before the
-- move back (lead 169). After a cancellation and a move back, the run counts from the recorded reopening also when the
-- worker saw the move away only after the reopening (lead 170, its control 171). A No Show taken back on the moved-back
-- slot is not a reopening, so the plain wait keeps its end (lead 172, and lead 173 marked No Show by the save that moved
-- it back); a cancellation changed to No Show and then taken back still counts from that recorded revert, whenever the
-- worker runs (lead 174), also when the cancellation reached the slot by a move while cancelled (leads 175 and 176) or
-- the appointment was moved back after it (lead 178). A No Show taken back after the appointment stood again is not a
-- reopening, after a person's reopening (lead 177) as after a calendar sync's save that opened it, which records no
-- retraction and leaves the person's cancellation on the slot until the No Show is taken back (lead 180). A booking first
-- processed while cancelled starts one run when it is reopened after a change to No Show (lead 179).
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(167,180) n;
create temporary table stamps(n integer, what text, at timestamptz, primary key(n,what)) on commit drop;
create function pg_temp.stamp(lead_n integer, label text) returns void language sql as $$
  insert into stamps values (lead_n,label,clock_timestamp()) on conflict (n,what) do update set at=excluded.at
$$;
create function pg_temp.drain() returns void language plpgsql as $$
begin
  for i in 1..60 loop exit when pg_temp.work() is null; end loop;
end $$;
create function pg_temp.plain_wait_graph() returns jsonb language sql as $$
  select '{"format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"w1","type":"wait_until_before_appointment","version":1,"config":{"amount":2,"unit":"days"}},
    {"id":"t1","type":"create_task","version":1,"config":{"title":"First reminder","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}},
    {"id":"pause","type":"wait","version":1,"config":{"duration":2,"unit":"days"}},
    {"id":"t2","type":"create_task","version":1,"config":{"title":"After the wait","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"w1"},{"id":"b","source":"w1","target":"t1"},
    {"id":"c","source":"t1","target":"pause"},{"id":"d","source":"pause","target":"t2"}]}'::jsonb
$$;
-- The plain wait's end passes now, for the run that waits at it on the given automation.
create function pg_temp.end_wait(workflow_n integer, lead_n integer) returns void language sql as $$
  update private.automation_runs set due_at=clock_timestamp() where workflow_id=pg_temp.id(workflow_n)
    and contact_id=pg_temp.id(lead_n) and current_node_id='pause';
  select pg_temp.stamp(lead_n,'wait end');
$$;
-- How long after the given stamp the task after the plain wait is due (null when there is no such task).
create function pg_temp.after_wait(workflow_n integer, lead_n integer, label text) returns interval language sql as $$
  select t.due_date-s.at from public.tasks t join private.automation_runs r on r.id=t.automation_run_id
    join stamps s on s.n=lead_n and s.what=label
  where r.workflow_id=pg_temp.id(workflow_n) and r.contact_id=pg_temp.id(lead_n) and t.title='After the wait'
$$;
select pg_temp.publish(238,239,'Reminder, then a plain wait (a run replaced by another time)',pg_temp.plain_wait_graph());
select pg_temp.booking(200+n,n,5) from (values (167),(168),(170),(171),(172),(173),(174),(175),(176),(177),(178),(180)) v(n);
select pg_temp.ok(pg_temp.events(25)=12,'leads 167, 168, 170 to 178 and 180 enroll');
select pg_temp.first_reminders(238);
select pg_temp.ok((select bool_and(pg_temp.given(238,n)='First reminder' and pg_temp.trip(238,n)='waiting:-@pause')
    from (values (167),(168),(170),(171),(172),(173),(174),(175),(176),(177),(178),(180)) v(n)),
  'each lead has its first reminder and its plain wait has started');
-- Leads 167 and 168: cancelled (seen), reopened and moved to another time, then moved back.
select pg_temp.save(n,'status=''Cancelled''') from (values (167),(168)) v(n);
select pg_temp.events(25);
select pg_temp.save(167,'status=''Scheduled''');
select pg_temp.save(167,pg_temp.later(7));
select pg_temp.save(168,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.save(168,pg_temp.later(7));
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok((select bool_and(pg_temp.trip(238,n)='stopped:Appointment was rescheduled@pause; waiting:-@w1') from (values (167),(168)) v(n)),
  'a run started for the other time records the run the cancellation stopped as replaced, whether the worker saw the reopening and the move together or apart: '
    ||pg_temp.trip(238,167)||' / '||pg_temp.trip(238,168));
select pg_temp.save(n,format('start_time=%L',(select starts from booked where booked.n=v.n))) from (values (167),(168)) v(n);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok((select bool_and(pg_temp.trip(238,n)='waiting:-@pause; stopped:Appointment was moved back@w1') from (values (167),(168)) v(n)),
  'the move back carries the original run on: '||pg_temp.trip(238,167)||' / '||pg_temp.trip(238,168));
-- Lead 171: moved away (seen), cancelled (seen). Lead 170: moved away and cancelled, unseen. The plain wait's end passes
-- while cancelled; both are reopened, the worker seeing lead 170's move away, cancellation and reopening in one pass.
select pg_temp.save(171,pg_temp.later(7));
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.save(171,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(170,pg_temp.later(7));
select pg_temp.save(170,'status=''Cancelled''');
select pg_temp.end_wait(238,n) from (values (170),(171)) v(n);
select pg_sleep(0.3);
select pg_temp.stamp(n,'reopened') from (values (170),(171)) v(n);
select pg_temp.save(n,'status=''Scheduled''') from (values (170),(171)) v(n);
select pg_sleep(0.1);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.save(n,format('start_time=%L',(select starts from booked where booked.n=v.n))) from (values (170),(171)) v(n);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok((select bool_and(pg_temp.after_wait(238,n,'reopened')>=interval '0') from (values (170),(171)) v(n)),
  'after a cancellation and a move back, the task after the plain wait is due no earlier than the reopening, whenever the worker saw the move away: '
    ||coalesce(pg_temp.after_wait(238,170,'reopened')::text,'no task')||' / '||coalesce(pg_temp.after_wait(238,171,'reopened')::text,'no task'));
-- Leads 172 and 173: moved away (seen), moved back and marked No Show (lead 173 in one save, seen), the plain wait's end
-- passes, the No Show is taken back.
select pg_temp.save(n,pg_temp.later(7)) from (values (172),(173)) v(n);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.save(172,format('start_time=%L',(select starts from booked where n=172)));
select pg_temp.save(172,'status=''No Show''');
select pg_temp.save(173,format('start_time=%L,status=''No Show''',(select starts from booked where n=173)));
select pg_temp.events(25);
select pg_temp.end_wait(238,n) from (values (172),(173)) v(n);
select pg_sleep(0.3);
select pg_temp.stamp(n,'taken back') from (values (172),(173)) v(n);
select pg_temp.save(n,'status=''Scheduled''') from (values (172),(173)) v(n);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok((select bool_and(pg_temp.after_wait(238,n,'wait end')<interval '0.2 seconds') from (values (172),(173)) v(n)),
  'a No Show taken back is not a reopening: the plain wait keeps its end (due after the wait end '
    ||coalesce(pg_temp.after_wait(238,172,'wait end')::text,'no task')||' / '||coalesce(pg_temp.after_wait(238,173,'wait end')::text,'no task')||')');
-- Lead 174: cancelled (seen), then marked No Show (seen), the plain wait's end passes, taken back; the worker half a
-- second late.
select pg_temp.save(174,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(174,'status=''No Show''');
select pg_temp.events(25);
select pg_temp.end_wait(238,174);
select pg_sleep(0.3);
select pg_temp.stamp(174,'taken back');
select pg_temp.save(174,'status=''Scheduled''');
select pg_sleep(0.5);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok(pg_temp.after_wait(238,174,'taken back') between interval '0' and interval '0.3 seconds',
  'a cancellation changed to No Show and taken back counts from that recorded moment, not from when the worker saw it: '
    ||coalesce(pg_temp.after_wait(238,174,'taken back')::text,'no task'));
-- Leads 175 and 176: the cancellation reached the slot by a move while cancelled, so that slot's outcome record holds
-- none; the change log still shows it. Lead 175: moved away (seen), cancelled at the other time (seen), moved back while
-- cancelled (seen), changed to No Show (seen), the plain wait's end passes, taken back (the move-back carry-on). Lead
-- 176: cancelled (seen), moved while cancelled to a time whose first reminder already passed (seen), changed to No Show
-- (seen), the wait's end passes, taken back (the cancellation carry-on). The worker is half a second late for both.
select pg_temp.save(175,pg_temp.later(7));
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.save(n,'status=''Cancelled''') from (values (175),(176)) v(n);
select pg_temp.events(25);
select pg_temp.save(175,format('start_time=%L',(select starts from booked where n=175)));
select pg_temp.save(176,pg_temp.later(1));
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.save(n,'status=''No Show''') from (values (175),(176)) v(n);
select pg_temp.events(25);
select pg_temp.end_wait(238,n) from (values (175),(176)) v(n);
select pg_sleep(0.3);
select pg_temp.stamp(n,'taken back') from (values (175),(176)) v(n);
select pg_temp.save(n,'status=''Scheduled''') from (values (175),(176)) v(n);
select pg_sleep(0.5);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok((select bool_and(pg_temp.after_wait(238,n,'taken back') between interval '0' and interval '0.3 seconds')
    from (values (175),(176)) v(n)),
  'a cancellation moved with the appointment, changed to No Show and taken back counts from that recorded moment: '
    ||coalesce(pg_temp.after_wait(238,175,'taken back')::text,'no task')||' / '||coalesce(pg_temp.after_wait(238,176,'taken back')::text,'no task'));
-- Lead 178: moved away (seen), cancelled at the other time (seen), the original run's plain wait end passes, changed to
-- No Show (seen), reopened (seen), then moved back (seen).
select pg_temp.save(178,pg_temp.later(7));
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.save(178,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.end_wait(238,178);
select pg_sleep(0.3);
select pg_temp.save(178,'status=''No Show''');
select pg_temp.events(25);
select pg_temp.stamp(178,'reopened');
select pg_temp.save(178,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.save(178,format('start_time=%L',(select starts from booked where n=178)));
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok(pg_temp.after_wait(238,178,'reopened')>=interval '0',
  'reopened after a cancellation changed to No Show and then moved back, the task after the plain wait is due no earlier than the reopening: '
    ||coalesce(pg_temp.after_wait(238,178,'reopened')::text,'no task'));
-- Lead 177: cancelled (seen) and moved while cancelled (seen), then reopened and marked No Show, the plain wait's end
-- passes, and the No Show is taken back. Lead 180: cancelled (seen), opened by a calendar sync's save, the wait's end
-- passes, then marked No Show and taken back by a person. The worker sees each lead's last three saves at once, half a
-- second late.
select pg_temp.save(n,'status=''Cancelled''') from (values (177),(180)) v(n);
select pg_temp.events(25);
select pg_temp.save(177,pg_temp.later(1));
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.save(177,'status=''Scheduled''');
update public.appointments set status='Scheduled' where id=(select id from booked where n=180);
select pg_temp.save(177,'status=''No Show''');
select pg_sleep(0.1);
select pg_temp.end_wait(238,n) from (values (177),(180)) v(n);
select pg_sleep(0.3);
select pg_temp.save(180,'status=''No Show''');
select pg_temp.stamp(n,'taken back') from (values (177),(180)) v(n);
select pg_temp.save(n,'status=''Scheduled''') from (values (177),(180)) v(n);
select pg_sleep(0.5);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok((select bool_and(pg_temp.after_wait(238,n,'wait end')<interval '0.2 seconds') from (values (177),(180)) v(n)),
  'a No Show taken back after the appointment stood again is not a reopening: the plain wait keeps its end (due after the wait end '
    ||coalesce(pg_temp.after_wait(238,177,'wait end')::text,'no task')||' / '||coalesce(pg_temp.after_wait(238,180,'wait end')::text,'no task')||')');
-- Lead 179: booked and cancelled before the worker ran, so no run started; then marked No Show (seen) and reopened
-- (seen).
select pg_temp.booking(379,179,5);
select pg_temp.save(179,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.ok(pg_temp.trip(238,179)='none','a booking first processed while cancelled starts nothing: '||pg_temp.trip(238,179));
select pg_temp.save(179,'status=''No Show''');
select pg_temp.events(25);
select pg_temp.save(179,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok(pg_temp.trip(238,179)='waiting:-@w1',
  'reopened after a change from Cancelled to No Show, the booking first processed while cancelled starts one run: '||pg_temp.trip(238,179));
-- Lead 169: the same as lead 167, with the automation paused for the pass that sees the reopening and the move.
update public.workflows set status='paused' where id=pg_temp.id(238);
select pg_temp.publish(240,241,'Reminder, then a plain wait (a pause between the saves and the worker)',pg_temp.plain_wait_graph());
select pg_temp.booking(369,169,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 169 enrolls');
select pg_temp.first_reminders(240);
select pg_temp.save(169,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(169,'status=''Scheduled''');
select pg_temp.save(169,pg_temp.later(7));
select pg_temp.lifecycle(240,'pause');
select pg_temp.events(25);
select pg_temp.lifecycle(240,'resume');
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.save(169,format('start_time=%L',(select starts from booked where n=169)));
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok(pg_temp.trip(240,169)='waiting:-@pause; stopped:Appointment was moved back@w1',
  'resumed, the automation takes up the booking it kept and records the original run as replaced, so the move back carries it on: '
    ||pg_temp.trip(240,169));
update public.workflows set status='active' where id=pg_temp.id(238);
select pg_temp.finish();
select pg_temp.ok((select bool_and(pg_temp.given(238,n)='After the wait, First reminder') from (values (167),(168)) v(n))
    and pg_temp.given(240,169)='After the wait, First reminder',
  'after the move back each reminder is given once: '||pg_temp.given(238,167)||' / '||pg_temp.given(238,168)||' / '||pg_temp.given(240,169));
select pg_temp.ok((select bool_and(pg_temp.given(238,n)='After the wait, First reminder') from generate_series(175,180) n),
  'after each reopening one reminder sequence goes out: '
    ||(select string_agg(n||' '||pg_temp.given(238,n),' / ' order by n) from generate_series(175,180) n));
-- The stop basis, a calendar sync's save, a status the outcome record ignores, and the reopening observer (leads 181 to
-- 191, 194 and 195). One save that moves the appointment and opens it from No Show after a cancellation is a save made
-- while it was cancelled, not a booking made while it stood, so a reply while it was cancelled ends its reminders, at a
-- new time (lead 181) as on a move back to the time its reminders were for (lead 183), as from Cancelled (leads 182 and
-- 184). A save without a signed-in person (a calendar sync) takes back a cancellation such a save recorded, on the same
-- slot (lead 185); a person's cancellation on the slot stands over it (lead 186), while a sync's save that opens an
-- appointment moved while it was cancelled reopens it, its slot holding no outcome (lead 187); both are decisions in the
-- release plan. A move made in a status the outcome record ignores after a cancellation opens a slot that is still
-- cancelled: no run follows it until it stands again, and then a reply while it was cancelled ends its reminders (lead
-- 188) or the run the cancellation stopped carries on (lead 189). Cancelled, changed to No Show and moved while No Show,
-- then opened by a person (lead 190) or by a calendar sync (lead 191): the new slot holds no outcome to take back, so
-- only the reopening the change log records makes the worker look again, and the run the cancellation stopped carries
-- on. A No Show taken back on a slot the worker saw booked keeps the run it has (lead 194), and so does a slot a run with
-- no appointment wait followed in an ordinary move and finished for (lead 195). The setup checks (each lead enrolls,
-- waits, has its first reminder, is stopped by its cancellation) pin unchanged behavior, as do the checks marked below;
-- every other check failed before this change.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(181,195) n;
-- A calendar sync's save: no signed-in person, as google-calendar-inbound-sync writes with its service-role client.
create function pg_temp.sync(lead_n integer, changes text) returns void language plpgsql as $$
begin
  perform pg_temp.nobody();
  execute format('update public.appointments set %s,sync_source=''external'' where id=%L',changes,(select id from booked where n=lead_n));
end $$;
-- Leads 181 to 184: each has its first reminder; leads 183 and 184 are moved away (seen); all are cancelled (seen) and
-- the contact replies; leads 181 and 183 are changed to No Show (seen); then one save opens each: leads 181 and 182 at a
-- new time, leads 183 and 184 at the time their reminders were for.
select pg_temp.publish(250,251,'Two reminders that stop on a reply (stop basis)',
  pg_temp.two_reminders('{"reentry":"once","stop_on_reply":true}'));
select pg_temp.booking(400+n,n,5) from generate_series(181,184) n;
select pg_temp.ok(pg_temp.events(25)=4,'leads 181 to 184 enroll');
select pg_temp.first_reminders(250);
select pg_temp.ok((select bool_and(pg_temp.given(250,n)='First reminder' and pg_temp.trip(250,n)='waiting:-@w2')
    from generate_series(181,184) n),'each of leads 181 to 184 has its first reminder and waits for the second');
select pg_temp.save(n,pg_temp.later(7)) from (values (183),(184)) v(n);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.save(n,'status=''Cancelled''') from generate_series(181,184) n;
select pg_temp.events(25);
select pg_temp.reply(n) from generate_series(181,184) n;
select pg_temp.save(n,'status=''No Show''') from (values (181),(183)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.later(6)||',status=''Scheduled''') from (values (181),(182)) v(n);
select pg_temp.save(n,format('start_time=%L,status=''Scheduled''',(select starts from booked where booked.n=v.n)))
  from (values (183),(184)) v(n);
select pg_temp.events(25);
select pg_temp.finish();
-- Pins unchanged behavior: the controls from Cancelled.
select pg_temp.ok(pg_temp.given(250,182)='First reminder' and pg_temp.given(250,184)='First reminder',
  'a reply while cancelled ends the reminders when one save opens the appointment from Cancelled, at a new time or on a move back: '
    ||pg_temp.given(250,182)||' / '||pg_temp.given(250,184));
select pg_temp.ok(pg_temp.given(250,181)='First reminder' and pg_temp.trip(250,181) not like '%queued%'
    and pg_temp.trip(250,181) not like '%waiting%',
  'one save that moves the appointment and opens it from No Show after a cancellation is not a booking made while it stood: the reply ends the reminders: '
    ||pg_temp.given(250,181)||' / '||pg_temp.trip(250,181));
select pg_temp.ok(pg_temp.given(250,183)='First reminder' and pg_temp.trip(250,183) not like '%queued%'
    and pg_temp.trip(250,183) not like '%waiting%',
  'a move back made by a save that opens the appointment from No Show after a cancellation counts from the booking the automation followed while it stood: the reply ends the reminders: '
    ||pg_temp.given(250,183)||' / '||pg_temp.trip(250,183));
update public.workflows set status='paused' where id=pg_temp.id(250);
-- Leads 185 to 187, 190, 191 and 194 are seen booked. Lead 185: a calendar sync cancels (seen), the sync writes Scheduled.
-- Lead 186: a person cancels (seen), the sync writes Scheduled. Lead 187: a person cancels (seen), moves it while
-- cancelled (seen), the sync writes Scheduled. Leads 190 and 191: a person cancels (seen), changes it to No Show (seen)
-- and moves it while No Show (seen); then a person (190) or the sync (191) writes Scheduled. Lead 194: a person marks No
-- Show (seen) and takes it back.
select pg_temp.publish(252,253,'Reminder (calendar sync and observer)',
  pg_temp.reminder_graph('Reminder (fourth pass)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(400+n,n,5) from (values (185),(186),(187),(190),(191),(194)) v(n);
select pg_temp.ok(pg_temp.events(25)=6,'leads 185 to 187, 190, 191 and 194 enroll');
select pg_temp.drain();
select pg_temp.ok((select bool_and(pg_temp.trip(252,n)='waiting:-@until') from (values (185),(186),(187),(190),(191),(194)) v(n)),
  'each of leads 185 to 187, 190, 191 and 194 waits for the day before');
select pg_temp.sync(185,'status=''Cancelled''');
select pg_temp.save(n,'status=''Cancelled''') from (values (186),(187),(190),(191)) v(n);
select pg_temp.save(194,'status=''No Show''');
select pg_temp.events(25);
select pg_temp.ok((select bool_and(pg_temp.trip(252,n)='stopped:Appointment was cancelled@until') from (values (185),(186),(187),(190),(191)) v(n))
    and pg_temp.trip(252,194)='waiting:-@until',
  'each cancellation stops its run, whoever saved it, and a No Show does not');
select pg_temp.save(187,pg_temp.later(6));
select pg_temp.save(n,'status=''No Show''') from (values (190),(191)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.later(6)) from (values (190),(191)) v(n);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.sync(n,'status=''Scheduled''') from (values (185),(186),(187),(191)) v(n);
select pg_temp.save(n,'status=''Scheduled''') from (values (190),(194)) v(n);
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(252,185)='Reminder (fourth pass)' and pg_temp.trip(252,185)='completed:-@task',
  'a cancellation a calendar sync recorded is taken back when the sync opens the appointment on the same slot: the run carries on: '
    ||pg_temp.given(252,185)||' / '||pg_temp.trip(252,185));
-- Pins a decision: a person's cancellation stands over a sync's save.
select pg_temp.ok(pg_temp.given(252,186)='none' and pg_temp.trip(252,186)='stopped:Appointment was cancelled@until',
  'a person''s cancellation on the slot stands over a calendar sync''s save that opens the appointment: nothing goes out: '
    ||pg_temp.given(252,186)||' / '||pg_temp.trip(252,186));
-- Pins a decision: on a slot the appointment was moved to while cancelled, a sync's save that opens it reopens it.
select pg_temp.ok(pg_temp.given(252,187)='Reminder (fourth pass)' and pg_temp.trip(252,187)='completed:-@task',
  'a calendar sync''s save that opens an appointment moved while cancelled reopens it: the run carries on: '
    ||pg_temp.given(252,187)||' / '||pg_temp.trip(252,187));
-- Pins unchanged behavior that only the reopening observer gives (a new slot with no outcome to take back).
select pg_temp.ok((select bool_and(pg_temp.given(252,n)='Reminder (fourth pass)' and pg_temp.trip(252,n)='completed:-@task')
    from (values (190),(191)) v(n)),
  'cancelled, changed to No Show and moved while No Show, then opened by a person or by a calendar sync: the run the cancellation stopped carries on: '
    ||pg_temp.given(252,190)||' '||pg_temp.trip(252,190)||' / '||pg_temp.given(252,191)||' '||pg_temp.trip(252,191));
-- Pins unchanged behavior: a No Show taken back on a slot the worker saw booked keeps its one run.
select pg_temp.ok(pg_temp.given(252,194)='Reminder (fourth pass)' and pg_temp.trip(252,194)='completed:-@task',
  'a No Show taken back on a slot the worker saw booked keeps its one run: '||pg_temp.given(252,194)||' / '||pg_temp.trip(252,194));
update public.workflows set status='paused' where id=pg_temp.id(252);
-- Leads 188 and 189: cancelled (seen); lead 188's contact replies; changed to 'Pending' (188) or 'Rescheduled' (189),
-- statuses the outcome record ignores (seen); moved while in that status (seen); then opened.
select pg_temp.publish(254,255,'Reminder that stops on a reply (ignored status)',
  pg_temp.reminder_graph('Reminder (ignored status)','{"reentry":"once","stop_on_reply":true}'));
select pg_temp.booking(400+n,n,5) from (values (188),(189)) v(n);
select pg_temp.ok(pg_temp.events(25)=2,'leads 188 and 189 enroll');
select pg_temp.drain();
select pg_temp.save(n,'status=''Cancelled''') from (values (188),(189)) v(n);
select pg_temp.events(25);
select pg_temp.reply(188);
select pg_temp.save(188,'status=''Pending''');
select pg_temp.save(189,'status=''Rescheduled''');
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.later(6)) from (values (188),(189)) v(n);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok((select bool_and(pg_temp.trip(254,n) not like '%queued%' and pg_temp.trip(254,n) not like '%waiting%')
    from (values (188),(189)) v(n)),
  'moved in a status the outcome record ignores after a cancellation, the appointment is still cancelled: no run follows it: '
    ||pg_temp.trip(254,188)||' / '||pg_temp.trip(254,189));
select pg_temp.save(n,'status=''Scheduled''') from (values (188),(189)) v(n);
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(254,188)='none',
  'opened after a move in a status the outcome record ignores, a reply while it was cancelled ends the reminders: '
    ||pg_temp.given(254,188)||' / '||pg_temp.trip(254,188));
-- Pins unchanged behavior: the reminder goes out once.
select pg_temp.ok(pg_temp.given(254,189)='Reminder (ignored status)',
  'opened after a move in a status the outcome record ignores, the reminder goes out once: '||pg_temp.given(254,189)||' / '||pg_temp.trip(254,189));
update public.workflows set status='paused' where id=pg_temp.id(254);
-- Lead 195: an automation with no appointment wait follows an ordinary move (seen) and finishes; a person then marks the
-- appointment No Show (seen) and takes it back.
select pg_temp.publish(256,257,'Follow-up after a plain wait (no appointment wait)','{"format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"pause","type":"wait","version":1,"config":{"duration":2,"unit":"days"}},
    {"id":"t2","type":"create_task","version":1,"config":{"title":"After the wait","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"pause"},{"id":"b","source":"pause","target":"t2"}]}'::jsonb);
select pg_temp.booking(595,195,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 195 enrolls');
select pg_temp.drain();
select pg_temp.save(195,pg_temp.later(6));
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok(pg_temp.trip(256,195)='waiting:-@pause','the ordinary move starts no second run: '||pg_temp.trip(256,195));
select pg_temp.finish();
select pg_temp.save(195,'status=''No Show''');
select pg_temp.events(25);
select pg_temp.save(195,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
-- Pins unchanged behavior: no second run.
select pg_temp.ok(pg_temp.given(256,195)='After the wait' and pg_temp.trip(256,195)='completed:-@t2',
  'a No Show taken back on a slot that a finished run followed starts no second run: '||pg_temp.given(256,195)||' / '||pg_temp.trip(256,195));
-- A finished or stopped run, a retype after a calendar sync's cancellation, and the admission a sync's take-back opens
-- (leads 196 to 218). An automation with no appointment wait records no slot on its run, so a reopening used to admit
-- the slot's booking again after its run had followed an ordinary move to that slot: a finished follow-up was given
-- twice, after a sync's cancellation and Scheduled (lead 196) as after a person's cancellation and reopening (lead 197,
-- and lead 198 with both saves made before the worker ran), and a person's stop did not hold (lead 199). A run still
-- following the appointment when the slot was booked, or started since, now counts as having followed that slot, except
-- a run a cancellation stopped, which the carry-on decides about (leads 202 to 204). A person's retype restates the
-- slot's outcome under the person, so it used to make a sync's cancellation a person's, and reminders stopped while the
-- appointment read Scheduled: retyped after the sync's Scheduled (lead 205), while cancelled (lead 206), or twice (lead
-- 207). A restated cancellation is now judged by the record it restates, found through the record's own chain, also
-- when the record's times are out of order (lead 210); a person's cancellation, retyped or not, still stands (leads 208
-- and 209). Leads 211 to 214 pin what a sync's take-back opens: a booking first processed while the sync's own
-- cancellation was in effect gets one run when the sync opens the appointment (lead 211), none after a reply while it
-- was cancelled (lead 212); a person's stop holds although the appointment stands again (lead 213); and the sync's
-- cancellation and Scheduled made before the worker ran give one run (lead 214). Leads 215 to 218 pin what follows
-- from a person's cancellation standing over a sync's save, both decisions in the release plan: the sync's one save that
-- moves the appointment opens a slot with no outcome, so it reopens it, and once the sync has rewritten Scheduled, a
-- person's plain Scheduled save does not take the cancellation back, while a status round trip or a move does. The
-- setup checks pin unchanged behavior, as do the checks marked below; every other check failed before this change.
update public.workflows set status='paused' where id=pg_temp.id(256);
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(196,218) n;
-- Leads 196 to 200: an automation with no appointment wait. Leads 196 to 199 follow an ordinary move (seen); lead 199's
-- run is stopped by an Admin; the others finish. Then the sync cancels (seen) and writes Scheduled (lead 196), a person
-- cancels (seen) and reopens (lead 197, and lead 199), or a person cancels and reopens before the worker sees either
-- (lead 198). Lead 200 is not moved: its run finishes, then the sync cancels (seen) and writes Scheduled.
select pg_temp.publish(258,259,'Follow-up after a plain wait (a slot followed in a move)','{"format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"appointment_booked","version":1,"config":{}},
    {"id":"pause","type":"wait","version":1,"config":{"duration":2,"unit":"days"}},
    {"id":"t2","type":"create_task","version":1,"config":{"title":"After the wait (moved)","task_type":"Follow Up","due_amount":0,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"pause"},{"id":"b","source":"pause","target":"t2"}]}'::jsonb);
select pg_temp.booking(600+n,n,5) from generate_series(196,200) n;
select pg_temp.ok(pg_temp.events(25)=5,'leads 196 to 200 enroll');
select pg_temp.drain();
select pg_temp.save(n,pg_temp.later(6)) from generate_series(196,199) n;
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok((select bool_and(pg_temp.trip(258,n)='waiting:-@pause') from generate_series(196,200) n),
  'each of leads 196 to 200 has one run, waiting at its plain wait');
do $$
begin
  perform pg_temp.act(10);
  perform public.automation_stop_run(r.id,(public.automation_session_context()->>'revision')::bigint)
    from private.automation_runs r where r.workflow_id=pg_temp.id(258) and r.contact_id=pg_temp.id(199);
  perform pg_temp.nobody();
end $$;
select pg_temp.finish();
select pg_temp.ok((select bool_and(pg_temp.given(258,n)='After the wait (moved)' and pg_temp.trip(258,n)='completed:-@t2')
    from (values (196),(197),(198),(200)) v(n)) and pg_temp.trip(258,199)='stopped:Stopped by user@pause',
  'the runs of leads 196 to 198 and 200 finish, and an Admin stops lead 199''s');
select pg_temp.sync(n,'status=''Cancelled''') from (values (196),(200)) v(n);
select pg_temp.save(n,'status=''Cancelled''') from (values (197),(199)) v(n);
select pg_temp.events(25);
select pg_temp.sync(n,'status=''Scheduled''') from (values (196),(200)) v(n);
select pg_temp.save(n,'status=''Scheduled''') from (values (197),(199)) v(n);
select pg_temp.save(198,'status=''Cancelled''');
select pg_temp.save(198,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(258,196)='After the wait (moved)' and pg_temp.trip(258,196)='completed:-@t2',
  'a finished run that followed an ordinary move is not repeated after the sync cancels and writes Scheduled: '
    ||pg_temp.given(258,196)||' / '||pg_temp.trip(258,196));
select pg_temp.ok((select bool_and(pg_temp.given(258,n)='After the wait (moved)' and pg_temp.trip(258,n)='completed:-@t2')
    from (values (197),(198)) v(n)),
  'a finished run that followed an ordinary move is not repeated after a person cancels and reopens, seen or not: '
    ||pg_temp.given(258,197)||' '||pg_temp.trip(258,197)||' / '||pg_temp.given(258,198)||' '||pg_temp.trip(258,198));
select pg_temp.ok(pg_temp.given(258,199)='none' and pg_temp.trip(258,199)='stopped:Stopped by user@pause',
  'a person''s stop of a run that followed an ordinary move holds after a cancellation and a reopening at that time: '
    ||pg_temp.given(258,199)||' / '||pg_temp.trip(258,199));
-- Pins unchanged behavior: on the slot the run followed from its booking, no second run.
select pg_temp.ok(pg_temp.given(258,200)='After the wait (moved)' and pg_temp.trip(258,200)='completed:-@t2',
  'a finished run on its own slot is not repeated after the sync cancels and writes Scheduled: '
    ||pg_temp.given(258,200)||' / '||pg_temp.trip(258,200));
update public.workflows set status='paused' where id=pg_temp.id(258);
-- Lead 201: a reminder with an appointment wait follows an ordinary move (seen) and gives its reminder; the sync cancels
-- (seen) and writes Scheduled.
select pg_temp.publish(260,261,'Reminder (a slot followed in a move)',
  pg_temp.reminder_graph('Reminder (moved)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(801,201,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 201 enrolls');
select pg_temp.drain();
select pg_temp.save(201,pg_temp.later(6));
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(260,201)='Reminder (moved)' and pg_temp.trip(260,201)='completed:-@task',
  'lead 201''s run follows the move and gives its reminder');
select pg_temp.sync(201,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.sync(201,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
-- Pins unchanged behavior: a run with an appointment wait records the slot it followed.
select pg_temp.ok(pg_temp.given(260,201)='Reminder (moved)' and pg_temp.trip(260,201)='completed:-@task',
  'a reminder that followed an ordinary move is not repeated after the sync cancels and writes Scheduled: '
    ||pg_temp.given(260,201)||' / '||pg_temp.trip(260,201));
update public.workflows set status='paused' where id=pg_temp.id(260);
-- Leads 202 to 204: two reminders that stop on a reply, the first given. Lead 202 follows an ordinary move to a time
-- whose first reminder has passed (seen), so its run keeps its place on the new slot; a person cancels it (seen), the
-- contact replies, a person reopens it (seen), then moves it back to its first time (seen). One save moves leads 203
-- and 204 to a new time and cancels them (seen), lead 204's contact replies, and a person reopens both (seen).
select pg_temp.publish(262,263,'Two reminders that stop on a reply (a run a cancellation stopped)',
  pg_temp.two_reminders('{"reentry":"once","stop_on_reply":true}'));
select pg_temp.booking(600+n,n,5) from generate_series(202,204) n;
select pg_temp.ok(pg_temp.events(25)=3,'leads 202 to 204 enroll');
select pg_temp.first_reminders(262);
select pg_temp.ok((select bool_and(pg_temp.given(262,n)='First reminder' and pg_temp.trip(262,n)='waiting:-@w2')
    from generate_series(202,204) n),'each of leads 202 to 204 has its first reminder and waits for the second');
select pg_temp.save(202,format('start_time=%L',date_trunc('minute',clock_timestamp())+interval '36 hours'));
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok(pg_temp.trip(262,202)='waiting:-@w2','lead 202''s run keeps its place on the new slot: '||pg_temp.trip(262,202));
select pg_temp.save(202,'status=''Cancelled''');
select pg_temp.save(n,pg_temp.later(8)||',status=''Cancelled''') from (values (203),(204)) v(n);
select pg_temp.events(25);
select pg_temp.reply(n) from (values (202),(204)) v(n);
select pg_temp.save(n,'status=''Scheduled''') from generate_series(202,204) n;
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.save(202,format('start_time=%L',(select starts from booked where n=202)));
select pg_temp.events(25);
select pg_temp.finish();
-- Pins unchanged behavior: a run a cancellation stopped is the carry-on's, and a reply while cancelled ends it.
select pg_temp.ok(pg_temp.given(262,202)='First reminder, Second reminder' and pg_temp.trip(262,202)='completed:-@t2',
  'after a reply, a reopening at the new time and a move back, the run carries on for its time and no reminder goes out twice: '
    ||pg_temp.given(262,202)||' / '||pg_temp.trip(262,202));
-- Pins unchanged behavior: one save that moves and cancels the appointment ends the run, and the new time gets its own
-- reminders once, or none after a reply while cancelled.
select pg_temp.ok(pg_temp.given(262,203)='First reminder, First reminder, Second reminder'
    and pg_temp.trip(262,203)='stopped:Appointment was rescheduled@w2; completed:-@t2'
    and pg_temp.given(262,204)='First reminder' and pg_temp.trip(262,204)='stopped:Appointment was rescheduled@w2',
  'one save that moves the appointment and cancels it, then a reopening: the new time''s reminders go out once, or none after a reply: '
    ||pg_temp.given(262,203)||' '||pg_temp.trip(262,203)||' / '||pg_temp.given(262,204)||' '||pg_temp.trip(262,204));
update public.workflows set status='paused' where id=pg_temp.id(262);
-- Leads 205 to 210 are seen booked. Lead 205: the sync cancels (seen), the sync writes Scheduled (seen), then a person
-- changes only the type (seen). Lead 206: the sync cancels (seen), a person retypes it (seen), the sync writes
-- Scheduled. Lead 207: the sync cancels (seen), the sync writes Scheduled (seen), a person retypes it twice (seen).
-- Lead 208: a person cancels (seen), a person retypes it (seen), the sync writes Scheduled. Lead 209: a person cancels
-- (seen), the sync writes Scheduled (seen), a person retypes it. Lead 210: the slot's record holds a person's
-- cancellation and its retraction written while the server clock ran a day ahead; then the sync cancels (seen), a
-- person retypes it (seen) and the sync writes Scheduled.
select pg_temp.publish(264,265,'Reminder (retyped after a sync)',
  pg_temp.reminder_graph('Reminder (retyped)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(600+n,n,5) from generate_series(205,210) n;
select pg_temp.ok(pg_temp.events(25)=6,'leads 205 to 210 enroll');
select pg_temp.drain();
insert into private.appointment_outcome_events(organization_id,occurrence_id,outcome,event_at,recorded_at,recorded_by,actor_kind,
    source,contact_id,category)
  select o.organization_id,o.id,'cancelled',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day',pg_temp.id(11),
    'human','status_edit',o.contact_id,o.category
  from private.appointment_occurrences o where o.appointment_id=(select id from booked where n=210) and o.closed_at is null;
insert into private.appointment_outcome_events(organization_id,occurrence_id,outcome,event_at,recorded_at,recorded_by,actor_kind,
    source,contact_id,category,supersedes_event_id)
  select e.organization_id,e.occurrence_id,'retracted',e.recorded_at+interval '1 second',e.recorded_at+interval '1 second',
    pg_temp.id(11),'human','status_edit',e.contact_id,e.category,e.id
  from private.appointment_outcome_events e join private.appointment_occurrences o on o.id=e.occurrence_id
  where o.appointment_id=(select id from booked where n=210) and o.closed_at is null;
select pg_temp.events(25);
select pg_temp.ok((select bool_and(pg_temp.trip(264,n)='waiting:-@until') from generate_series(205,210) n),
  'each of leads 205 to 210 waits for the day before');
select pg_temp.sync(n,'status=''Cancelled''') from (values (205),(206),(207),(210)) v(n);
select pg_temp.save(n,'status=''Cancelled''') from (values (208),(209)) v(n);
select pg_temp.events(25);
select pg_temp.ok((select bool_and(pg_temp.trip(264,n)='stopped:Appointment was cancelled@until') from generate_series(205,210) n),
  'each cancellation stops its run');
select pg_temp.save(n,'type=''Retyped review''') from (values (206),(208),(210)) v(n);
select pg_temp.events(25);
select pg_temp.sync(n,'status=''Scheduled''') from generate_series(205,210) n;
select pg_temp.events(25);
select pg_temp.save(n,'type=''Retyped review''') from (values (205),(207),(209)) v(n);
select pg_temp.events(25);
select pg_temp.save(207,'type=''Retyped again''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(264,205)='Reminder (retyped)' and pg_temp.trip(264,205)='completed:-@task',
  'a person''s retype after the sync took back its own cancellation keeps the reminder: '||pg_temp.given(264,205)||' / '||pg_temp.trip(264,205));
select pg_temp.ok((select bool_and(pg_temp.given(264,n)='Reminder (retyped)' and pg_temp.trip(264,n)='completed:-@task')
    from (values (206),(207)) v(n)),
  'a sync''s cancellation retyped by a person, before or after the sync writes Scheduled, is still taken back: '
    ||pg_temp.given(264,206)||' '||pg_temp.trip(264,206)||' / '||pg_temp.given(264,207)||' '||pg_temp.trip(264,207));
-- Pins a decision: a person's cancellation, retyped or not, stands over a sync's save.
select pg_temp.ok((select bool_and(pg_temp.given(264,n)='none' and pg_temp.trip(264,n)='stopped:Appointment was cancelled@until')
    from (values (208),(209)) v(n)),
  'a person''s cancellation, retyped before or after the sync writes Scheduled, stands: '
    ||pg_temp.given(264,208)||' '||pg_temp.trip(264,208)||' / '||pg_temp.given(264,209)||' '||pg_temp.trip(264,209));
select pg_temp.ok(pg_temp.given(264,210)='Reminder (retyped)' and pg_temp.trip(264,210)='completed:-@task',
  'a retype restates the record it supersedes, whatever the record''s times say: the sync''s cancellation is taken back: '
    ||pg_temp.given(264,210)||' / '||pg_temp.trip(264,210));
update public.workflows set status='paused' where id=pg_temp.id(264);
-- Leads 211 to 214, on a reminder that stops on a reply. Leads 211 and 212 are booked and the sync cancels them before
-- the worker runs, so their bookings are first processed while cancelled; lead 212's contact replies; the sync writes
-- Scheduled (seen), then lead 211 gets more sync saves and worker passes. Lead 213 is seen booked, an Admin stops its
-- run, the sync cancels (seen) and writes Scheduled. Lead 214 is booked, and the sync cancels and writes Scheduled, all
-- before the worker runs.
select pg_temp.publish(266,267,'Reminder that stops on a reply (a sync''s take-back)',
  pg_temp.reminder_graph('Reminder (taken back)','{"reentry":"once","stop_on_reply":true}'));
select pg_temp.booking(600+n,n,5) from (values (211),(212)) v(n);
select pg_temp.sync(n,'status=''Cancelled''') from (values (211),(212)) v(n);
select pg_temp.booking(813,213,5);
select pg_temp.ok(pg_temp.events(25)=1 and pg_temp.trip(266,211)='none' and pg_temp.trip(266,212)='none',
  'bookings first processed while the sync''s cancellation is in effect start nothing; lead 213 enrolls');
select pg_temp.drain();
select pg_temp.reply(212);
do $$
begin
  perform pg_temp.act(10);
  perform public.automation_stop_run(r.id,(public.automation_session_context()->>'revision')::bigint)
    from private.automation_runs r where r.workflow_id=pg_temp.id(266) and r.contact_id=pg_temp.id(213);
  perform pg_temp.nobody();
end $$;
select pg_temp.sync(213,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.sync(n,'status=''Scheduled''') from generate_series(211,213) n;
select pg_temp.events(25);
select pg_temp.booking(814,214,5);
select pg_temp.sync(214,'status=''Cancelled''');
select pg_temp.sync(214,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.sync(211,'title=''Synced again'',status=''Scheduled''');
select pg_temp.events(25);
-- The worker looks at lead 211's appointment again while its run waits, and again once the run has finished.
select private.automation_refresh_appointment_runs(pg_temp.id(1),(select id::text from booked where n=211));
select pg_temp.events(25);
select pg_temp.finish();
select private.automation_refresh_appointment_runs(pg_temp.id(1),(select id::text from booked where n=211));
select pg_temp.events(25);
select pg_temp.finish();
-- Pins unchanged behavior: a booking first processed while the sync's own cancellation was in effect starts one run
-- when the sync opens the appointment, however often it is seen again.
select pg_temp.ok(pg_temp.given(266,211)='Reminder (taken back)' and pg_temp.trip(266,211)='completed:-@task',
  'a booking first processed while the sync''s cancellation was in effect gets one run when the sync opens the appointment: '
    ||pg_temp.given(266,211)||' / '||pg_temp.trip(266,211));
-- Pins unchanged behavior: a reply while cancelled refuses that booking, and the run is recorded as stopped.
select pg_temp.ok(pg_temp.given(266,212)='none' and pg_temp.trip(266,212)='stopped:Verified reply received@until',
  'a reply while the sync''s cancellation was in effect refuses the booking: '||pg_temp.trip(266,212));
-- Pins unchanged behavior: the appointment stands again, and a person's stop holds.
select pg_temp.ok(pg_temp.given(266,213)='none' and pg_temp.trip(266,213)='stopped:Stopped by user@until'
    and (select s.head_outcome from private.automation_appointment_state(pg_temp.id(1),(select id from booked where n=213)) s)='retracted',
  'the sync takes back its own cancellation, and a person''s stop holds: '||pg_temp.trip(266,213));
-- Pins unchanged behavior: the sync's cancellation and Scheduled both made before the worker ran give one run.
select pg_temp.ok(pg_temp.given(266,214)='Reminder (taken back)' and pg_temp.trip(266,214)='completed:-@task',
  'the sync''s cancellation and Scheduled made before the worker ran give one run: '||pg_temp.given(266,214)||' / '||pg_temp.trip(266,214));
update public.workflows set status='paused' where id=pg_temp.id(266);
-- Leads 215 to 218: a person cancels (seen). Lead 215: the sync's one save then moves the appointment and writes
-- Scheduled (seen). Leads 216 to 218: the sync writes Scheduled (seen); then a person saves it as Scheduled with new
-- notes (lead 216), marks it No Show (seen) and Scheduled (lead 217), or moves it (lead 218).
select pg_temp.publish(268,269,'Reminder (a person''s cancellation rewritten by the sync)',
  pg_temp.reminder_graph('Reminder (rewritten)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(600+n,n,5) from generate_series(215,218) n;
select pg_temp.ok(pg_temp.events(25)=4,'leads 215 to 218 enroll');
select pg_temp.drain();
select pg_temp.save(n,'status=''Cancelled''') from generate_series(215,218) n;
select pg_temp.events(25);
select pg_temp.sync(215,pg_temp.later(6)||',status=''Scheduled''');
select pg_temp.sync(n,'status=''Scheduled''') from generate_series(216,218) n;
select pg_temp.events(25);
select pg_temp.ok((select bool_and(pg_temp.trip(268,n)='stopped:Appointment was cancelled@until') from generate_series(216,218) n),
  'after the sync writes Scheduled over a person''s cancellation, the runs of leads 216 to 218 stay stopped');
select pg_temp.save(216,'status=''Scheduled'',notes=''Still on''');
select pg_temp.save(217,'status=''No Show''');
select pg_temp.save(218,pg_temp.later(6));
select pg_temp.events(25);
select pg_temp.save(217,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
-- Pins a decision: the sync's one save that moves the appointment opens a slot with no outcome, so it reopens it.
select pg_temp.ok(pg_temp.given(268,215)='Reminder (rewritten)' and pg_temp.trip(268,215)='completed:-@task',
  'a person''s cancellation followed by the sync''s one save that moves the appointment and writes Scheduled: the run carries on: '
    ||pg_temp.given(268,215)||' / '||pg_temp.trip(268,215));
-- Pins a decision: once the sync has rewritten Scheduled, a person's plain Scheduled save does not take the person's
-- cancellation back, though the appointment reads Scheduled; a status round trip or a move does.
select pg_temp.ok(pg_temp.given(268,216)='none' and pg_temp.trip(268,216)='stopped:Appointment was cancelled@until'
    and (select a.status from public.appointments a where a.id=(select id from booked where n=216))='Scheduled'
    and (select bool_and(pg_temp.given(268,n)='Reminder (rewritten)' and pg_temp.trip(268,n)='completed:-@task')
      from (values (217),(218)) v(n)),
  'after the sync''s rewrite, a person''s plain Scheduled save leaves the reminders stopped, a status round trip or a move resumes them: '
    ||pg_temp.trip(268,216)||' / '||pg_temp.trip(268,217)||' / '||pg_temp.trip(268,218));
-- A run that never followed the current time, a run another trigger started, and a time a run already followed (leads
-- 219 to 250). The first-processed guard counted every run that ended after the slot's booking. So a run the worker had
-- not yet stopped for a cancellation, which an Admin then stopped after a move made while cancelled (leads 219 and 223,
-- and lead 224 through the sync's saves) or after one save that moved and cancelled the appointment (leads 220, 225 and
-- 226), held back the new time. The guard now counts only a run that ended after the appointment first stood at the
-- slot, so the new time starts over, as it does when the worker saw the cancellation first (leads 227 and 228). The
-- guard also counted a live run, so a run carried on for a new time while the automation was paused across the move
-- made while cancelled no longer started over (leads 221 and 222); a live run is now admission's. It counted a run
-- another trigger started (a no-show run after a republish), so the reopened booking got no run (leads 231 and 249).
-- The carry-on and the move back treated such a run as a later one: a task was given twice (leads 233 and 234), and the
-- move back recorded the other run as replaced (leads 235 and 236). A run that finished, or that a person stopped,
-- while it followed a time is now not repeated when the appointment is moved away and back to that time while cancelled
-- and reopened, by a person (leads 237, 238 and 240 to 243) or by the sync's one save that moves it back and writes
-- Scheduled (lead 245), also when a later no-show run of the same automation stands between (lead 248) or a run for
-- another time followed in between (lead 250). A run with no appointment wait followed its booking's slot and the time
-- the appointment last stood at before the run ended. Leads 229 and 230 (a paused automation whose run finished), 232
-- (a live run for another appointment), 239 and 244 (a stop on the slot the run recorded) and 246 and 247 (the sync's
-- move, or its Cancelled then Scheduled, after its rewrite) pin unchanged behavior. The setup checks pin unchanged
-- behavior, as do the checks marked below; every other check failed before this change.
-- The automations a part of this section is done with are paused, and their open intervals are ended, as pausing in
-- the builder ends them, so the worker does not visit each of them for every booking that follows.
create function pg_temp.retire() returns void language sql as $$
  update public.automation_intervals i set ends_at=clock_timestamp() from public.workflows w
  where w.organization_id=i.organization_id and w.id=i.workflow_id and w.status='paused' and i.ends_at is null
$$;
update public.workflows set status='paused' where id=pg_temp.id(268);
select pg_temp.retire();
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(219,250) n;
create temporary table followed_at(n integer primary key, at timestamptz) on commit drop;
create function pg_temp.keep(lead_n integer) returns void language sql as $$
  insert into followed_at select lead_n,a.start_time from public.appointments a where a.id=(select id from booked where n=lead_n)
  on conflict (n) do update set at=excluded.at
$$;
create function pg_temp.back_to(lead_n integer) returns text language sql as $$
  select format('start_time=%L',(select at from followed_at where n=lead_n))
$$;
create function pg_temp.admin_stop(workflow_n integer, lead_n integer) returns void language plpgsql as $$
begin
  perform pg_temp.act(10);
  perform public.automation_stop_run(r.id,(public.automation_session_context()->>'revision')::bigint)
    from private.automation_runs r where r.workflow_id=pg_temp.id(workflow_n) and r.contact_id=pg_temp.id(lead_n)
      and r.status in ('queued','waiting','held','unknown');
  perform pg_temp.nobody();
end $$;
-- A new version of an automation, published the way publish_automation records it: the open interval ends and one for
-- the new version starts.
create function pg_temp.republish(workflow_n integer, version_n integer, title text, graph jsonb) returns void language plpgsql as $$
declare boundary timestamptz:=clock_timestamp(); rev integer;
begin
  select coalesce(max(v.revision),0)+1 into rev from public.workflow_versions v where v.workflow_id=pg_temp.id(workflow_n);
  insert into public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
    values(pg_temp.id(version_n),pg_temp.id(1),pg_temp.id(workflow_n),title,rev,graph,boundary,pg_temp.id(10));
  update public.automation_intervals set ends_at=boundary where workflow_id=pg_temp.id(workflow_n) and ends_at is null;
  insert into public.automation_intervals(organization_id,workflow_id,version_id,starts_at)
    values(pg_temp.id(1),pg_temp.id(workflow_n),pg_temp.id(version_n),boundary);
  update public.workflows set automation_version_id=pg_temp.id(version_n),automation_graph=graph,automation_revision=rev
    where id=pg_temp.id(workflow_n);
end $$;
create function pg_temp.plain_graph(title text) returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','pause','type','wait','version',1,'config',jsonb_build_object('duration',2,'unit','days')),
    jsonb_build_object('id','t2','type','create_task','version',1,'config',jsonb_build_object('title',title,'task_type','Follow Up','due_amount',0,'due_unit','minutes'))),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','pause'),jsonb_build_object('id','b','source','pause','target','t2')))
$$;
create function pg_temp.noshow_graph(stop_on_reply boolean) returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',jsonb_build_object('reentry','once','stop_on_reply',stop_on_reply),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_outcome_recorded','version',1,'config',jsonb_build_object('outcomes',jsonb_build_array('no_show'))),
    jsonb_build_object('id','pause','type','wait','version',1,'config',jsonb_build_object('duration',2,'unit','days')),
    jsonb_build_object('id','task','type','create_task','version',1,'config',jsonb_build_object('title','After a no-show','task_type','Follow Up','due_amount',0,'due_unit','minutes'))),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','pause'),jsonb_build_object('id','b','source','pause','target','task')))
$$;
-- Leads 219 to 222: two reminders. Lead 219 is cancelled and moved while cancelled, one save moves and cancels lead 220,
-- and an Admin stops both runs, all before the worker runs. Leads 221 and 222 have their first reminder; they are
-- cancelled (seen) and the automation is paused while both are moved while cancelled (seen); it is on again for lead
-- 221's reopening, and paused again for lead 222's and resumed after it.
select pg_temp.publish(270,271,'Two reminders (a run that never followed the new time)',
  pg_temp.two_reminders('{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(600+n,n,5) from generate_series(219,222) n;
select pg_temp.ok(pg_temp.events(25)=4,'leads 219 to 222 enroll');
select pg_temp.drain();
update private.automation_runs set due_at=clock_timestamp()-interval '1 second'
  where workflow_id=pg_temp.id(270) and contact_id in (pg_temp.id(221),pg_temp.id(222)) and status='waiting';
select pg_temp.drain();
select pg_temp.ok(pg_temp.given(270,219)='none' and pg_temp.given(270,220)='none'
    and pg_temp.given(270,221)='First reminder' and pg_temp.given(270,222)='First reminder',
  'leads 221 and 222 have their first reminder, and leads 219 and 220 wait for theirs');
select pg_temp.save(219,'status=''Cancelled''');
select pg_temp.save(219,pg_temp.later(8));
select pg_temp.save(220,pg_temp.later(8)||',status=''Cancelled''');
select pg_temp.admin_stop(270,n) from (values (219),(220)) v(n);
select pg_temp.save(n,'status=''Cancelled''') from (values (221),(222)) v(n);
select pg_temp.events(25);
select pg_temp.lifecycle(270,'pause');
select pg_temp.save(n,pg_temp.later(8)) from (values (221),(222)) v(n);
select pg_temp.events(25);
select pg_temp.lifecycle(270,'resume');
select pg_temp.save(n,'status=''Scheduled''') from generate_series(219,221) n;
select pg_temp.events(25);
select pg_temp.lifecycle(270,'pause');
select pg_temp.save(222,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.lifecycle(270,'resume');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok((select bool_and(pg_temp.given(270,n)='First reminder, Second reminder'
      and pg_temp.trip(270,n)='stopped:Stopped by user@w1; completed:-@t2') from (values (219),(220)) v(n)),
  'a run an Admin stopped before the worker saw the cancellation never followed the new time, which starts over: '
    ||pg_temp.given(270,219)||' '||pg_temp.trip(270,219)||' / '||pg_temp.given(270,220)||' '||pg_temp.trip(270,220));
select pg_temp.ok((select bool_and(pg_temp.given(270,n)='First reminder, First reminder, Second reminder'
      and pg_temp.trip(270,n)='stopped:Appointment was rescheduled@w2; completed:-@t2') from (values (221),(222)) v(n)),
  'paused while moved while cancelled, the run carried on for a new time still starts over, so the new time gets every reminder: '
    ||pg_temp.given(270,221)||' '||pg_temp.trip(270,221)||' / '||pg_temp.given(270,222)||' '||pg_temp.trip(270,222));
update public.workflows set status='paused' where id=pg_temp.id(270);
select pg_temp.retire();
-- Leads 223 and 224, each followed by an automation with no appointment wait and by a reminder. Lead 223 is cancelled
-- and moved while cancelled by a person, and lead 224 by the sync, and an Admin stops their runs, all before the worker
-- runs; then a person reopens lead 223 and the sync writes Scheduled on lead 224.
select pg_temp.publish(272,273,'Follow-up after a plain wait (a run that never followed the new time)',
  pg_temp.plain_graph('After the wait (never followed)'));
select pg_temp.publish(274,275,'Reminder (a run that never followed the new time)',
  pg_temp.reminder_graph('Reminder (never followed)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(600+n,n,5) from (values (223),(224)) v(n);
select pg_temp.ok(pg_temp.events(25)=4,'leads 223 and 224 enroll on both automations');
select pg_temp.drain();
select pg_temp.save(223,'status=''Cancelled''');
select pg_temp.save(223,pg_temp.later(8));
select pg_temp.sync(224,'status=''Cancelled''');
select pg_temp.sync(224,pg_temp.later(8));
select pg_temp.admin_stop(w,n) from (values (272),(274)) f(w) cross join (values (223),(224)) v(n);
select pg_temp.events(25);
select pg_temp.save(223,'status=''Scheduled''');
select pg_temp.sync(224,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(272,223)='After the wait (never followed)' and pg_temp.trip(272,223)='stopped:Stopped by user@pause; completed:-@t2'
    and pg_temp.given(274,223)='Reminder (never followed)' and pg_temp.trip(274,223)='stopped:Stopped by user@until; completed:-@task',
  'a run, with or without an appointment wait, that an Admin stopped before the worker saw the cancellation never followed the new time, '
    ||'which starts over: '||pg_temp.trip(272,223)||' / '||pg_temp.trip(274,223));
select pg_temp.ok(pg_temp.given(272,224)='After the wait (never followed)' and pg_temp.trip(272,224)='stopped:Stopped by user@pause; completed:-@t2'
    and pg_temp.given(274,224)='Reminder (never followed)' and pg_temp.trip(274,224)='stopped:Stopped by user@until; completed:-@task',
  'the same after the sync cancelled and moved it, and the sync''s Scheduled: the new time starts over: '
    ||pg_temp.trip(272,224)||' / '||pg_temp.trip(274,224));
update public.workflows set status='paused' where id in (pg_temp.id(272),pg_temp.id(274));
select pg_temp.retire();
-- Leads 225 to 228, each followed by an automation with no appointment wait and by a reminder: one save moves each to a
-- new time and cancels it. An Admin stops the runs of leads 225 and 226 before the worker sees that save; the worker
-- sees leads 227 and 228's first. Then a person reopens each at its new time.
select pg_temp.publish(276,277,'Follow-up after a plain wait (a stop before a move and cancel was seen)',
  pg_temp.plain_graph('After the wait (stop before the save was seen)'));
select pg_temp.publish(278,279,'Reminder (a stop before a move and cancel was seen)',
  pg_temp.reminder_graph('Reminder (stop before the save was seen)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(600+n,n,5) from generate_series(225,228) n;
select pg_temp.ok(pg_temp.events(25)=8,'leads 225 to 228 enroll on both automations');
select pg_temp.drain();
select pg_temp.save(n,pg_temp.later(7)||',status=''Cancelled''') from generate_series(225,228) n;
select pg_temp.admin_stop(w,n) from (values (276),(278)) f(w) cross join (values (225),(226)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from generate_series(225,228) n;
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok((select bool_and(pg_temp.given(276,n)='After the wait (stop before the save was seen)'
      and pg_temp.trip(276,n)='stopped:Stopped by user@pause; completed:-@t2'
      and pg_temp.given(278,n)='Reminder (stop before the save was seen)'
      and pg_temp.trip(278,n)='stopped:Stopped by user@until; completed:-@task') from (values (225),(226)) v(n)),
  'a person''s stop made before the worker processed one save that moved and cancelled the appointment does not hold the new time: '
    ||pg_temp.trip(276,225)||' '||pg_temp.trip(278,225)||' / '||pg_temp.trip(276,226)||' '||pg_temp.trip(278,226));
-- Pins unchanged behavior: seen first, the save stops the run, and the new time gets its follow-up and reminder once.
select pg_temp.ok((select bool_and(pg_temp.given(276,n)='After the wait (stop before the save was seen)' and pg_temp.trip(276,n)='completed:-@t2'
      and pg_temp.given(278,n)='Reminder (stop before the save was seen)' and pg_temp.trip(278,n)='completed:-@task')
    from (values (227),(228)) v(n)),
  'the same save seen by the worker first: the new time gets one follow-up and one reminder: '
    ||pg_temp.trip(276,227)||' '||pg_temp.trip(278,227)||' / '||pg_temp.trip(276,228)||' '||pg_temp.trip(278,228));
-- Leads 229 and 230: an automation with no appointment wait follows an ordinary move (seen) and finishes; it is paused;
-- the sync cancels lead 229 (seen) and writes Scheduled (seen), a person cancels lead 230 (seen) and reopens it (seen);
-- then the automation resumes.
update public.workflows set status='paused' where id=pg_temp.id(278);
select pg_temp.retire();
select pg_temp.booking(600+n,n,5) from (values (229),(230)) v(n);
select pg_temp.ok(pg_temp.events(25)=2,'leads 229 and 230 enroll');
select pg_temp.drain();
select pg_temp.save(n,pg_temp.later(6)) from (values (229),(230)) v(n);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.finish();
select pg_temp.lifecycle(276,'pause');
select pg_temp.sync(229,'status=''Cancelled''');
select pg_temp.save(230,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.sync(229,'status=''Scheduled''');
select pg_temp.save(230,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.lifecycle(276,'resume');
select pg_temp.events(25);
select pg_temp.finish();
-- Pins unchanged behavior: the finished run followed the slot, so the paused automation keeps nothing for its resume.
select pg_temp.ok((select bool_and(pg_temp.given(276,n)='After the wait (stop before the save was seen)' and pg_temp.trip(276,n)='completed:-@t2')
    from (values (229),(230)) v(n))
    and not exists (select 1 from private.automation_deferred_admissions d where d.workflow_id=pg_temp.id(276)),
  'a paused automation''s finished follow-up is not repeated after the reopening and the resume: '
    ||pg_temp.trip(276,229)||' / '||pg_temp.trip(276,230));
update public.workflows set status='paused' where id=pg_temp.id(276);
select pg_temp.retire();
-- Lead 231: an automation with no appointment wait follows the booking and its run finishes; a person cancels (seen) and
-- moves it while cancelled (seen); the automation is republished with a no-show trigger; a person marks it No Show
-- (seen), which starts a no-show run of the same automation for the appointment; it is republished with a booking
-- trigger; a person sets Scheduled (seen). Lead 232 has two appointments: the first is seen booked and its run waits; the
-- second is booked and cancelled before the worker runs, then reopened (seen).
select pg_temp.publish(280,281,'Follow-up after a plain wait (a run another trigger started)',pg_temp.plain_graph('After the wait (other trigger)'));
select pg_temp.booking(831,231,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 231 enrolls');
select pg_temp.finish();
select pg_temp.save(231,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(231,pg_temp.later(6));
select pg_temp.events(25);
select pg_temp.republish(280,300,'No-show follow-up (a run another trigger started)',pg_temp.noshow_graph(false));
select pg_temp.save(231,'status=''No Show''');
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok(pg_temp.trip(280,231)='completed:-@t2; waiting:-@pause',
  'lead 231''s booking run finished and a no-show run of the same automation waits: '||pg_temp.trip(280,231));
select pg_temp.republish(280,301,'Follow-up after a plain wait (republished)',pg_temp.plain_graph('After the wait (other trigger)'));
select pg_temp.save(231,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(280,231)='After the wait (other trigger), After the wait (other trigger)'
    and pg_temp.trip(280,231)='completed:-@t2; completed:-@t2; stopped:Appointment outcome was changed@pause',
  'a run another trigger started never followed the booking: the reopened new time gets its own run: '
    ||pg_temp.given(280,231)||' / '||pg_temp.trip(280,231));
update public.workflows set status='paused' where id=pg_temp.id(280);
select pg_temp.retire();
select pg_temp.publish(282,283,'Follow-up after a plain wait (two appointments)',pg_temp.plain_graph('After the wait (two appointments)'));
select pg_temp.booking(832,232,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 232''s first appointment enrolls');
select pg_temp.drain();
insert into booked select 932,pg_temp.book(932,232,t.starts),t.starts
  from (select date_trunc('minute',clock_timestamp())+interval '6 days' as starts) t;
select pg_temp.save(932,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(932,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
-- Pins unchanged behavior: a live run for another appointment of the same lead does not count.
select pg_temp.ok(pg_temp.tasks_for(282,232)=1 and pg_temp.tasks_for(282,932)=1,
  'each of lead 232''s appointments gets its follow-up once: '||pg_temp.runs_for(282,232)||' / '||pg_temp.runs_for(282,932));
update public.workflows set status='paused' where id=pg_temp.id(282);
select pg_temp.retire();
-- Lead 233: a day's wait, task A, a day's wait, task B; task A is given; the automation is republished with a no-show
-- trigger; a person marks it No Show (seen), which starts a no-show run; it is republished with the first graph; a person
-- cancels (seen), moves it while cancelled (seen) and reopens it (seen).
select pg_temp.publish(284,285,'Task A then task B (a run another trigger started)',jsonb_build_object('format',1,
  'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','w1','type','wait','version',1,'config',jsonb_build_object('duration',1,'unit','days')),
    jsonb_build_object('id','ta','type','create_task','version',1,'config',jsonb_build_object('title','Task A','task_type','Follow Up','due_amount',0,'due_unit','minutes')),
    jsonb_build_object('id','w2','type','wait','version',1,'config',jsonb_build_object('duration',1,'unit','days')),
    jsonb_build_object('id','tb','type','create_task','version',1,'config',jsonb_build_object('title','Task B','task_type','Follow Up','due_amount',0,'due_unit','minutes'))),
  'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','w1'),jsonb_build_object('id','b','source','w1','target','ta'),
    jsonb_build_object('id','c','source','ta','target','w2'),jsonb_build_object('id','d','source','w2','target','tb'))));
select pg_temp.booking(833,233,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 233 enrolls');
select pg_temp.drain();
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(284) and status='waiting';
select pg_temp.drain();
select pg_temp.republish(284,302,'No-show follow-up (Task A then task B)',pg_temp.noshow_graph(false));
select pg_temp.save(233,'status=''No Show''');
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok(pg_temp.given(284,233)='Task A' and pg_temp.trip(284,233)='waiting:-@w2; waiting:-@pause',
  'lead 233 has task A, and a no-show run of the same automation waits: '||pg_temp.trip(284,233));
select pg_temp.republish(284,303,'Task A then task B (republished)',(select v.graph from public.workflow_versions v where v.id=pg_temp.id(285)));
select pg_temp.save(233,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(233,pg_temp.later(6));
select pg_temp.events(25);
select pg_temp.save(233,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(284,233)='Task A, Task B'
    and pg_temp.trip(284,233)='completed:-@tb; stopped:Appointment outcome was changed@pause',
  'a run another trigger started is not a later run: the booking run the cancellation stopped carries on, and task A is not repeated: '
    ||pg_temp.given(284,233)||' / '||pg_temp.trip(284,233));
update public.workflows set status='paused' where id=pg_temp.id(284);
select pg_temp.retire();
-- Leads 234 to 236: two reminders, the first given; an ordinary move to a new time (seen) starts the automation over for
-- it (the first run is recorded as rescheduled and a second run waits); the automation is republished with a no-show
-- trigger, one that stops on a reply for lead 236; a person marks each No Show (seen), which starts a no-show run; lead
-- 236's contact replies; the automation is republished with the two reminders. Leads 234 and 236: a person sets
-- Scheduled (seen) and moves it back to its first time (seen). Lead 235: both saves are made before the worker runs, so
-- the no-show run is still live at the move back.
select pg_temp.publish(286,287,'Two reminders (a move back after another trigger''s run)',
  pg_temp.two_reminders('{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(600+n,n,5) from generate_series(234,236) n;
select pg_temp.ok(pg_temp.events(25)=3,'leads 234 to 236 enroll');
select pg_temp.first_reminders(286);
select pg_temp.save(n,pg_temp.later(8)) from generate_series(234,236) n;
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok((select bool_and(pg_temp.given(286,n)='First reminder' and pg_temp.trip(286,n)='stopped:Appointment was rescheduled@w2; waiting:-@w1')
    from generate_series(234,236) n),
  'each of leads 234 to 236 has its first reminder, and the move started the automation over for the new time');
select pg_temp.republish(286,304,'No-show follow-up (a move back)',pg_temp.noshow_graph(false));
select pg_temp.save(n,'status=''No Show''') from (values (234),(235)) v(n);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.republish(286,305,'No-show follow-up that stops on a reply (a move back)',pg_temp.noshow_graph(true));
select pg_temp.save(236,'status=''No Show''');
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.reply(236);
select pg_temp.republish(286,306,'Two reminders (republished)',(select v.graph from public.workflow_versions v where v.id=pg_temp.id(287)));
select pg_temp.save(n,'status=''Scheduled''') from (values (234),(236)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,format('start_time=%L',(select starts from booked where booked.n=v.n))) from (values (234),(236)) v(n);
select pg_temp.events(25);
select pg_temp.save(235,'status=''Scheduled''');
select pg_temp.save(235,format('start_time=%L',(select starts from booked where n=235)));
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(286,234)='First reminder, Second reminder'
    and pg_temp.trip(286,234)='completed:-@t2; stopped:Appointment was moved back@w1; stopped:Appointment outcome was changed@pause',
  'a no-show run of the same automation does not keep the move back from carrying the first run on: '
    ||pg_temp.given(286,234)||' / '||pg_temp.trip(286,234));
select pg_temp.ok((select bool_and(pg_temp.given(286,n)='First reminder, Second reminder') from (values (235),(236)) v(n))
    and pg_temp.trip(286,235)='completed:-@t2; stopped:Appointment was moved back@w1; stopped:Appointment was rescheduled@pause'
    and pg_temp.trip(286,236)='completed:-@t2; stopped:Appointment was moved back@w1; stopped:Verified reply received@pause',
  'the move back records only the booking''s later run as replaced; the no-show run ends for its own reason: '
    ||pg_temp.trip(286,235)||' / '||pg_temp.trip(286,236));
update public.workflows set status='paused' where id=pg_temp.id(286);
select pg_temp.retire();
-- Leads 237 to 242 and 245, on an automation with no appointment wait. Lead 237 follows an ordinary move (seen) and
-- finishes, lead 238 follows it and an Admin stops its run, lead 239's run is stopped on its booking's slot; a person
-- cancels (seen), moves it away while cancelled (seen) and back to the time the run followed while still cancelled
-- (seen), and reopens it (seen). Leads 241 and 242 follow an ordinary move (seen), lead 241's run stopped by an Admin and
-- lead 242's finished; a person cancels (seen) and moves it away (seen); the move back and the reopening are saved before
-- the worker runs. Lead 245 follows an ordinary move (seen) and finishes; a person cancels (seen) and moves it away while
-- cancelled (seen); the sync's one save moves it back and writes Scheduled.
select pg_temp.publish(288,289,'Follow-up after a plain wait (the same time again)',pg_temp.plain_graph('After the wait (same time)'));
select pg_temp.booking(600+n,n,5) from (values (237),(238),(239),(241),(242),(245)) v(n);
select pg_temp.ok(pg_temp.events(25)=6,'leads 237 to 239, 241, 242 and 245 enroll');
select pg_temp.drain();
select pg_temp.save(n,pg_temp.later(6)) from (values (237),(238),(241),(242),(245)) v(n);
select pg_temp.keep(n) from (values (237),(238),(239),(241),(242),(245)) v(n);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.admin_stop(288,n) from (values (238),(239),(241)) v(n);
select pg_temp.finish();
select pg_temp.ok((select bool_and(pg_temp.trip(288,n)='completed:-@t2') from (values (237),(242),(245)) v(n))
    and (select bool_and(pg_temp.trip(288,n)='stopped:Stopped by user@pause') from (values (238),(239),(241)) v(n)),
  'the runs of leads 237, 242 and 245 finish, and an Admin stops those of leads 238, 239 and 241');
select pg_temp.save(n,'status=''Cancelled''') from (values (237),(238),(239),(241),(242),(245)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.later(8)) from (values (237),(238),(239),(241),(242),(245)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.back_to(n)) from (values (237),(238),(239)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from (values (237),(238),(239)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.back_to(n)) from (values (241),(242)) v(n);
select pg_temp.save(n,'status=''Scheduled''') from (values (241),(242)) v(n);
select pg_temp.sync(245,pg_temp.back_to(245)||',status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok((select bool_and(pg_temp.given(288,n)='After the wait (same time)' and pg_temp.trip(288,n)='completed:-@t2')
    from (values (237),(242),(245)) v(n)),
  'a finished run with no appointment wait is not repeated at the time it followed after a move away and back while cancelled, '
    ||'by a person, seen or not, or by the sync''s one save: '||pg_temp.trip(288,237)||' / '||pg_temp.trip(288,242)||' / '||pg_temp.trip(288,245));
select pg_temp.ok((select bool_and(pg_temp.given(288,n)='none' and pg_temp.trip(288,n)='stopped:Stopped by user@pause')
    from (values (238),(241)) v(n)),
  'a person''s stop of a run that followed an ordinary move holds after a move away and back to that time while cancelled: '
    ||pg_temp.trip(288,238)||' / '||pg_temp.trip(288,241));
-- Pins unchanged behavior: a person's stop on the booking's own slot holds at that time.
select pg_temp.ok(pg_temp.given(288,239)='none' and pg_temp.trip(288,239)='stopped:Stopped by user@pause',
  'a person''s stop on the booking''s own slot holds after a move away and back while cancelled: '||pg_temp.trip(288,239));
update public.workflows set status='paused' where id=pg_temp.id(288);
select pg_temp.retire();
-- Lead 240, on an automation with a plain wait and then an appointment wait: moved (seen) while its run is in the plain
-- wait, stopped there by an Admin; a person cancels (seen), moves it away while cancelled (seen), back to the time the
-- run followed (seen) and reopens it (seen).
select pg_temp.publish(290,291,'A plain wait, then a reminder (the same time again)',jsonb_build_object('format',1,
  'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','pause','type','wait','version',1,'config',jsonb_build_object('duration',1,'unit','days')),
    jsonb_build_object('id','ta','type','create_task','version',1,'config',jsonb_build_object('title','After a day','task_type','Follow Up','due_amount',0,'due_unit','minutes')),
    jsonb_build_object('id','w1','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',1,'unit','days')),
    jsonb_build_object('id','tb','type','create_task','version',1,'config',jsonb_build_object('title','A day before','task_type','Follow Up','due_amount',0,'due_unit','minutes'))),
  'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','pause'),jsonb_build_object('id','b','source','pause','target','ta'),
    jsonb_build_object('id','c','source','ta','target','w1'),jsonb_build_object('id','d','source','w1','target','tb'))));
select pg_temp.booking(840,240,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 240 enrolls');
select pg_temp.drain();
select pg_temp.save(240,pg_temp.later(6));
select pg_temp.keep(240);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.admin_stop(290,240);
select pg_temp.save(240,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(240,pg_temp.later(8));
select pg_temp.events(25);
select pg_temp.save(240,pg_temp.back_to(240));
select pg_temp.events(25);
select pg_temp.save(240,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(290,240)='none' and pg_temp.trip(290,240)='stopped:Stopped by user@pause',
  'a person''s stop in a plain wait after an ordinary move holds after a move away and back to that time while cancelled: '
    ||pg_temp.given(290,240)||' / '||pg_temp.trip(290,240));
update public.workflows set status='paused' where id=pg_temp.id(290);
select pg_temp.retire();
-- Leads 243 and 244: a reminder a day before that is given late when its time has passed. Lead 243 is booked 20 hours
-- ahead, so its reminder is given at once and the run finishes; a person cancels (seen), moves it away (seen), back to
-- the same time (seen) and reopens it (seen). Lead 244 is booked 30 hours ahead and moved to 28 hours ahead (seen) while
-- its run waits; an Admin stops the run; then the same saves back to 28 hours ahead.
select pg_temp.publish(292,293,'A reminder given late (the same time again)',jsonb_build_object('format',1,
  'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','until','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',1,'unit','days','late','continue')),
    jsonb_build_object('id','task','type','create_task','version',1,'config',jsonb_build_object('title','Reminder (given late)','task_type','Follow Up','due_amount',0,'due_unit','minutes'))),
  'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','until'),jsonb_build_object('id','b','source','until','target','task'))));
insert into booked select n,pg_temp.book(600+n,n,t.starts),t.starts
  from (values (243,interval '20 hours'),(244,interval '30 hours')) v(n,ahead)
  cross join lateral (select date_trunc('minute',clock_timestamp())+v.ahead as starts) t;
select pg_temp.ok(pg_temp.events(25)=2,'leads 243 and 244 enroll');
select pg_temp.drain();
select pg_temp.save(244,format('start_time=%L',date_trunc('minute',clock_timestamp())+interval '28 hours'));
select pg_temp.keep(n) from (values (243),(244)) v(n);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.admin_stop(292,244);
select pg_temp.ok(pg_temp.given(292,243)='Reminder (given late)' and pg_temp.trip(292,243)='completed:-@task'
    and pg_temp.trip(292,244)='stopped:Stopped by user@until',
  'lead 243''s late reminder is given and its run finishes; an Admin stops lead 244''s');
select pg_temp.save(n,'status=''Cancelled''') from (values (243),(244)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.later(4)) from (values (243),(244)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.back_to(n)) from (values (243),(244)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from (values (243),(244)) v(n);
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok(pg_temp.given(292,243)='Reminder (given late)' and pg_temp.trip(292,243)='completed:-@task',
  'a reminder given late is not given again after a move away and back to the same time while cancelled: '
    ||pg_temp.given(292,243)||' / '||pg_temp.trip(292,243));
-- Pins unchanged behavior: a run with an appointment wait records the slot it followed.
select pg_temp.ok(pg_temp.given(292,244)='none' and pg_temp.trip(292,244)='stopped:Stopped by user@until',
  'a person''s stop of a reminder that followed an ordinary move holds after a move away and back while cancelled: '
    ||pg_temp.trip(292,244));
update public.workflows set status='paused' where id=pg_temp.id(292);
select pg_temp.retire();
-- Leads 246 and 247: a person cancels (seen) and the sync writes Scheduled (seen); then the sync moves lead 246's
-- appointment (seen), and cancels lead 247's (seen) and writes Scheduled again (seen).
select pg_temp.publish(294,295,'Reminder (the sync after its rewrite)',
  pg_temp.reminder_graph('Reminder (after the rewrite)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(600+n,n,5) from (values (246),(247)) v(n);
select pg_temp.ok(pg_temp.events(25)=2,'leads 246 and 247 enroll');
select pg_temp.drain();
select pg_temp.save(n,'status=''Cancelled''') from (values (246),(247)) v(n);
select pg_temp.events(25);
select pg_temp.sync(n,'status=''Scheduled''') from (values (246),(247)) v(n);
select pg_temp.events(25);
select pg_temp.ok((select bool_and(pg_temp.trip(294,n)='stopped:Appointment was cancelled@until') from (values (246),(247)) v(n)),
  'after the sync writes Scheduled over a person''s cancellation, the runs of leads 246 and 247 stay stopped');
select pg_temp.sync(246,pg_temp.later(6)||',status=''Scheduled''');
select pg_temp.sync(247,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.sync(247,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
-- Pins a decision: after its rewrite, the sync's move, or its Cancelled then Scheduled, resumes the reminders.
select pg_temp.ok((select bool_and(pg_temp.given(294,n)='Reminder (after the rewrite)' and pg_temp.trip(294,n)='completed:-@task')
    from (values (246),(247)) v(n)),
  'after the sync''s rewrite, the sync''s move, or its Cancelled then Scheduled, resumes the reminders: '
    ||pg_temp.trip(294,246)||' / '||pg_temp.trip(294,247));
update public.workflows set status='paused' where id=pg_temp.id(294);
select pg_temp.retire();
-- Lead 248: an automation with no appointment wait follows the booking and its run finishes; the automation is
-- republished with a no-show trigger; a person marks it No Show (seen), which starts a no-show run; it is republished
-- with a booking trigger; a person cancels (seen), moves it away while cancelled (seen), back to its time (seen) and
-- reopens it (seen).
select pg_temp.publish(296,297,'Follow-up after a plain wait (behind a no-show run)',pg_temp.plain_graph('After the wait (behind a no-show run)'));
select pg_temp.booking(848,248,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 248 enrolls');
select pg_temp.finish();
select pg_temp.keep(248);
select pg_temp.republish(296,307,'No-show follow-up (behind a no-show run)',pg_temp.noshow_graph(false));
select pg_temp.save(248,'status=''No Show''');
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.republish(296,308,'Follow-up after a plain wait (republished)',(select v.graph from public.workflow_versions v where v.id=pg_temp.id(297)));
select pg_temp.ok(pg_temp.trip(296,248)='completed:-@t2; waiting:-@pause',
  'lead 248''s booking run finished and a no-show run of the same automation waits: '||pg_temp.trip(296,248));
select pg_temp.save(248,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(248,pg_temp.later(8));
select pg_temp.events(25);
select pg_temp.save(248,pg_temp.back_to(248));
select pg_temp.events(25);
select pg_temp.save(248,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(296,248)='After the wait (behind a no-show run)'
    and pg_temp.trip(296,248)='completed:-@t2; stopped:Appointment outcome was changed@pause',
  'a later no-show run of the same automation does not hide the finished booking run that followed this time: '
    ||pg_temp.given(296,248)||' / '||pg_temp.trip(296,248));
update public.workflows set status='paused' where id=pg_temp.id(296);
select pg_temp.retire();
-- Lead 249: an automation that follows bookings sees the booking only after a person cancelled it; it is republished
-- with a no-show trigger; a person marks it No Show (seen), which starts a no-show run that finishes; it is republished
-- with a booking trigger; a person reopens it (seen).
select pg_temp.publish(298,299,'Follow-up after a plain wait (a finished no-show run)',pg_temp.plain_graph('After the wait (a finished no-show run)'));
select pg_temp.booking(849,249,5);
select pg_temp.save(249,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.ok(pg_temp.trip(298,249)='none','lead 249''s booking, first processed while cancelled, starts nothing');
select pg_temp.republish(298,309,'No-show follow-up (a finished no-show run)',pg_temp.noshow_graph(false));
select pg_temp.save(249,'status=''No Show''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.republish(298,310,'Follow-up after a plain wait (republished)',(select v.graph from public.workflow_versions v where v.id=pg_temp.id(299)));
select pg_temp.ok(pg_temp.given(298,249)='After a no-show' and pg_temp.trip(298,249)='completed:-@task',
  'lead 249''s no-show run finishes: '||pg_temp.trip(298,249));
select pg_temp.save(249,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
-- A finished run another trigger started followed no booking, so it holds no time for one.
select pg_temp.ok(pg_temp.given(298,249)='After a no-show, After the wait (a finished no-show run)'
    and pg_temp.trip(298,249)='completed:-@t2; completed:-@task',
  'a finished no-show run of the same automation does not keep the reopened booking from its run: '
    ||pg_temp.given(298,249)||' / '||pg_temp.trip(298,249));
update public.workflows set status='paused' where id=pg_temp.id(298);
select pg_temp.retire();
-- Lead 250, followed by an automation with no appointment wait and by a reminder: each run finishes at its booked time;
-- a person cancels (seen), moves it to a new time while cancelled (seen) and reopens it (seen), so the new time gets its
-- own runs, which finish; then a person cancels (seen), moves it back to the first time while cancelled (seen) and
-- reopens it (seen).
select pg_temp.publish(312,313,'Follow-up after a plain wait (back by reopenings)',pg_temp.plain_graph('After the wait (back by reopenings)'));
select pg_temp.publish(314,315,'Reminder (back by reopenings)',
  pg_temp.reminder_graph('Reminder (back by reopenings)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(850,250,5);
select pg_temp.keep(250);
select pg_temp.ok(pg_temp.events(25)=2,'lead 250 enrolls on both automations');
select pg_temp.finish();
select pg_temp.save(250,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(250,pg_temp.later(7));
select pg_temp.events(25);
select pg_temp.save(250,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.trip(312,250)='completed:-@t2; completed:-@t2' and pg_temp.trip(314,250)='completed:-@task; completed:-@task',
  'lead 250''s new time gets its own runs, which finish: '||pg_temp.trip(312,250)||' / '||pg_temp.trip(314,250));
select pg_temp.save(250,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(250,pg_temp.back_to(250));
select pg_temp.events(25);
select pg_temp.save(250,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(312,250)='After the wait (back by reopenings), After the wait (back by reopenings)'
    and pg_temp.given(314,250)='Reminder (back by reopenings), Reminder (back by reopenings)'
    and pg_temp.trip(312,250)='completed:-@t2; completed:-@t2' and pg_temp.trip(314,250)='completed:-@task; completed:-@task',
  'back at its first time by reopenings, the follow-up and the reminder the first runs gave are not given again: '
    ||pg_temp.given(312,250)||' / '||pg_temp.given(314,250));
update public.workflows set status='paused' where id in (pg_temp.id(312),pg_temp.id(314));
select pg_temp.retire();
-- Leads 251 to 273: the final send check's outcome rule, and the rule for the times a booking run holds, which a
-- reopening's admission, the cancellation carry-on and the move back share (automation_time_held). The checks marked
-- "Pins" passed before this change too, and so did the checks that set a lead up or report a step on the way; the
-- other 14 checks failed before it.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
select pg_temp.retire();
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(251,272) n;
create temporary table texts_out7(workflow_id uuid, contact_id uuid, node_id text, at timestamptz) on commit drop;
-- One worker step, as work() does, with texts through the synthetic transport: the worker's last check, the handoff,
-- and the provider's acceptance. Each worker call is its own transaction in production, so a handed-off intent's
-- created_at is that call's moment; this suite runs in one transaction, so the moment is written here. As channel.ts
-- does, a check answering 'skip:' finishes the step as skipped with the rest as its reason, 'retry:' goes on to the
-- handoff, and a refused handoff asks the check again and is skipped on a 'skip:' answer.
create function pg_temp.step7() returns jsonb language plpgsql as $$
declare c jsonb; node jsonb; made jsonb; outcome text; why text; refusal text; again text;
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
  elsif node->>'type'='send_sms' then
    refusal:=public.automation_message_check((c->>'run_id')::uuid,(c->>'lease_token')::uuid,c->>'node_id');
    if refusal like 'skip:%' then
      outcome:='skipped'; why:=substr(refusal,6);
    elsif (refusal is null or refusal='retry:')
        and public.automation_authorize_handoff((c->>'run_id')::uuid,(c->>'lease_token')::uuid,c->>'node_id') then
      update private.automation_intents set status='accepted',created_at=clock_timestamp()
        where run_id=(c->>'run_id')::uuid and node_id=c->>'node_id';
      insert into texts_out7 select r.workflow_id,r.contact_id,c->>'node_id',clock_timestamp()
        from private.automation_runs r where r.id=(c->>'run_id')::uuid;
      outcome:='accepted';
    else
      if refusal is null or refusal='retry:' then
        again:=public.automation_message_check((c->>'run_id')::uuid,(c->>'lease_token')::uuid,c->>'node_id');
      end if;
      if again like 'skip:%' then
        outcome:='skipped'; why:=substr(again,6);
      else
        outcome:='held'; why:='Refused at handoff: '||coalesce(nullif(refusal,'retry:'),'the handoff was not authorized');
      end if;
    end if;
  else
    outcome:='held'; why:='Synthetic transport';
  end if;
  perform public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,outcome,why);
  return c||jsonb_build_object('result',outcome,'reason',why);
end $$;
create function pg_temp.drain7() returns void language plpgsql as $$
begin
  for i in 1..60 loop exit when pg_temp.step7() is null; end loop;
end $$;
create function pg_temp.sent7(workflow_n integer, lead_n integer) returns text language sql as $$
  select coalesce(string_agg(s.node_id,', ' order by s.at),'none') from texts_out7 s
  where s.workflow_id=pg_temp.id(workflow_n) and s.contact_id=pg_temp.id(lead_n)
$$;
create function pg_temp.kept(workflow_n integer) returns bigint language sql as $$
  select count(*) from private.automation_deferred_admissions d where d.workflow_id=pg_temp.id(workflow_n)
$$;
-- Leads 251 to 253: a text a day before (sent late when passed). Before the reminder time, lead 251 is marked No Show,
-- lead 252 Completed, and lead 253 No Show and then Scheduled again. The worker then picks the text up.
select pg_temp.publish(320,321,'Text a day before (outcome before the start)',jsonb_build_object('format',1,
  'settings',jsonb_build_object('reentry','once','stop_on_reply',false),
  'nodes',jsonb_build_array(jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','until','type','wait_until_before_appointment','version',1,
      'config',jsonb_build_object('amount',1,'unit','days','late','continue')),
    jsonb_build_object('id','text','type','send_sms','version',1,'config',jsonb_build_object('body','See you soon','purpose','informational'))),
  'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','until'),
    jsonb_build_object('id','b','source','until','target','text'))));
select pg_temp.booking(900+n,n,3) from generate_series(251,253) n;
select pg_temp.ok(pg_temp.events(25)=3,'leads 251 to 253 enroll');
select pg_temp.drain7();
select pg_temp.save(251,'status=''No Show''');
select pg_temp.save(252,'status=''Completed''');
select pg_temp.save(253,'status=''No Show''');
select pg_temp.events(25);
select pg_temp.save(253,'status=''Scheduled''');
select pg_temp.events(25);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(320) and status='waiting';
select pg_temp.drain7();
select pg_temp.ok(pg_temp.sent7(320,251)='none' and pg_temp.sent7(320,252)='none'
    and pg_temp.trip(320,251)='held:Refused at handoff: The appointment has an outcome recorded@text'
    and pg_temp.trip(320,252)='held:Refused at handoff: The appointment has an outcome recorded@text',
  'a reminder is held, not sent, while its appointment is still ahead and marked No Show or Completed: '
    ||pg_temp.sent7(320,251)||' / '||pg_temp.trip(320,251)||' / '||pg_temp.sent7(320,252)||' / '||pg_temp.trip(320,252));
-- Pins: a No Show taken back before the reminder time lets the reminder out once.
select pg_temp.ok(pg_temp.sent7(320,253)='text' and pg_temp.trip(320,253)='completed:-@text',
  'a No Show taken back first leaves one reminder: '||pg_temp.sent7(320,253)||' / '||pg_temp.trip(320,253));
-- Lead 251's No Show is taken back before the start: the held reminder goes out once. Lead 252 stays Completed, and the
-- hold's seven-day limit ends its run.
select pg_temp.save(251,'status=''Scheduled''');
select pg_temp.events(25);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(320) and contact_id=pg_temp.id(251);
update private.automation_runs set held_since=clock_timestamp()-interval '8 days',due_at=clock_timestamp()-interval '1 second'
  where workflow_id=pg_temp.id(320) and contact_id=pg_temp.id(252);
select pg_temp.drain7();
select pg_temp.ok(pg_temp.sent7(320,251)='text' and pg_temp.trip(320,251)='completed:-@text'
    and pg_temp.sent7(320,252)='none'
    and pg_temp.trip(320,252)='stopped:Stopped after 7 days on hold: Refused at handoff: The appointment has an outcome recorded@text',
  'taken back before the start, the held reminder goes out once; still Completed, the hold''s limit ends the run: '
    ||pg_temp.sent7(320,251)||' / '||pg_temp.trip(320,251)||' / '||pg_temp.sent7(320,252)||' / '||pg_temp.trip(320,252));
update public.workflows set status='paused' where id=pg_temp.id(320);
select pg_temp.retire();
-- Lead 254: a reminder a day before. The Admin pauses the automation; a person cancels (seen), moves the appointment
-- while cancelled (seen) and reopens it (seen), so the run is carried on to the new time while paused; an Admin stops
-- it; the automation is resumed.
select pg_temp.publish(322,323,'Reminder (paused, carried on, stopped)',
  pg_temp.reminder_graph('Reminder (paused, carried on, stopped)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(954,254,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 254 enrolls');
select pg_temp.drain();
select pg_temp.lifecycle(322,'pause');
select pg_temp.save(254,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(254,pg_temp.later(6));
select pg_temp.events(25);
select pg_temp.save(254,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.ok(pg_temp.kept(322)=0 and pg_temp.trip(322,254)='queued:-@until',
  'carried on to the new time while its automation is paused, the run keeps no booking for the resume: '
    ||pg_temp.kept(322)||' / '||pg_temp.trip(322,254));
select pg_temp.admin_stop(322,254);
select pg_temp.lifecycle(322,'resume');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(322,254)='none' and pg_temp.trip(322,254)='stopped:Stopped by user@until',
  'an Admin''s stop of that run holds after the resume: '||pg_temp.given(322,254)||' / '||pg_temp.trip(322,254));
update public.workflows set status='paused' where id=pg_temp.id(322);
select pg_temp.retire();
-- Lead 255: the same, with the automation on throughout. Lead 256: a plain wait and a task, paused as lead 254.
select pg_temp.publish(324,325,'Reminder (carried on, stopped)',
  pg_temp.reminder_graph('Reminder (carried on, stopped)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(955,255,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 255 enrolls');
select pg_temp.drain();
select pg_temp.save(255,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(255,pg_temp.later(6));
select pg_temp.events(25);
select pg_temp.save(255,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.admin_stop(324,255);
select pg_temp.finish();
-- Pins: with the automation on, the stop holds.
select pg_temp.ok(pg_temp.given(324,255)='none' and pg_temp.trip(324,255)='stopped:Stopped by user@until',
  'with the automation on, an Admin''s stop of the carried-on run holds: '||pg_temp.given(324,255)||' / '||pg_temp.trip(324,255));
update public.workflows set status='paused' where id=pg_temp.id(324);
select pg_temp.retire();
select pg_temp.publish(326,327,'Follow-up after a plain wait (paused, carried on, stopped)',
  pg_temp.plain_graph('After the wait (paused, carried on, stopped)'));
select pg_temp.booking(956,256,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 256 enrolls');
select pg_temp.drain();
select pg_temp.lifecycle(326,'pause');
select pg_temp.save(256,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(256,pg_temp.later(6));
select pg_temp.events(25);
select pg_temp.save(256,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.admin_stop(326,256);
select pg_temp.lifecycle(326,'resume');
select pg_temp.events(25);
select pg_temp.finish();
-- Pins: a plain wait's stop holds after the resume.
select pg_temp.ok(pg_temp.given(326,256)='none' and pg_temp.trip(326,256)='stopped:Stopped by user@pause',
  'a plain wait''s run carried on while paused and stopped by an Admin gives nothing after the resume: '
    ||pg_temp.given(326,256)||' / '||pg_temp.trip(326,256));
update public.workflows set status='paused' where id=pg_temp.id(326);
select pg_temp.retire();
-- Lead 257: a reminder a day before. A person cancels (seen), moves the appointment while cancelled (seen) and reopens
-- it (seen), so the run is carried on to the new time; an Admin stops it before the worker places its wait there. A
-- person then cancels (seen), moves it away while cancelled (seen), back to the new time while cancelled (seen) and
-- reopens it (seen). The run followed that time when it was stopped, whatever slot its wait still named, so its stop
-- holds that time.
select pg_temp.publish(328,329,'Reminder (stopped before its wait was placed again)',
  pg_temp.reminder_graph('Reminder (stopped before its wait was placed again)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(957,257,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 257 enrolls');
select pg_temp.drain();
select pg_temp.save(257,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(257,pg_temp.later(6));
select pg_temp.events(25);
select pg_temp.save(257,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.keep(257);
select pg_temp.ok(pg_temp.trip(328,257)='queued:-@until' and (select r.anchor_at<(select at from followed_at where n=257)
    from private.automation_runs r where r.workflow_id=pg_temp.id(328) and r.contact_id=pg_temp.id(257)),
  'lead 257''s run is carried on and its wait still names the first time: '||pg_temp.trip(328,257));
select pg_temp.admin_stop(328,257);
select pg_temp.save(257,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(257,pg_temp.later(8));
select pg_temp.events(25);
select pg_temp.save(257,pg_temp.back_to(257));
select pg_temp.events(25);
select pg_temp.save(257,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(328,257)='none' and pg_temp.trip(328,257)='stopped:Stopped by user@until',
  'back at the time an Admin stopped the carried-on run at, by reopenings, nothing starts: '
    ||pg_temp.given(328,257)||' / '||pg_temp.trip(328,257));
update public.workflows set status='paused' where id=pg_temp.id(328);
select pg_temp.retire();
-- Leads 258 and 259: two reminders. Lead 258's run gives both for its first time and finishes; lead 259's run gives the
-- first and an Admin stops it. A person cancels (seen), moves it while cancelled (seen) and reopens it (seen), so a run
-- starts for the new time and gives its first reminder; then a person cancels (seen), moves it back to the first time
-- while cancelled (seen) and reopens it (seen).
select pg_temp.publish(330,331,'Two reminders (carry-on at a held time)',
  pg_temp.two_reminders('{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(900+n,n,5) from (values (258),(259)) v(n);
select pg_temp.ok(pg_temp.events(25)=2,'leads 258 and 259 enroll');
select pg_temp.first_reminders(330);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second'
  where workflow_id=pg_temp.id(330) and contact_id=pg_temp.id(258) and status='waiting';
select pg_temp.drain();
select pg_temp.admin_stop(330,259);
select pg_temp.keep(n) from (values (258),(259)) v(n);
select pg_temp.save(n,'status=''Cancelled''') from (values (258),(259)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.later(7)) from (values (258),(259)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from (values (258),(259)) v(n);
select pg_temp.events(25);
select pg_temp.first_reminders(330);
select pg_temp.ok(pg_temp.trip(330,258)='completed:-@t2; waiting:-@w2' and pg_temp.trip(330,259)='stopped:Stopped by user@w2; waiting:-@w2',
  'a run starts for the new time and gives its first reminder: '||pg_temp.trip(330,258)||' / '||pg_temp.trip(330,259));
select pg_temp.save(n,'status=''Cancelled''') from (values (258),(259)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.back_to(n)) from (values (258),(259)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from (values (258),(259)) v(n);
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(330,258)='First reminder, First reminder, Second reminder'
    and pg_temp.trip(330,258)='completed:-@t2; stopped:Appointment was rescheduled@w2',
  'back at the time a finished run gave every reminder, the run for the other time is not carried on there: '
    ||pg_temp.given(330,258)||' / '||pg_temp.trip(330,258));
select pg_temp.ok(pg_temp.given(330,259)='First reminder, First reminder'
    and pg_temp.trip(330,259)='stopped:Stopped by user@w2; stopped:Appointment was rescheduled@w2',
  'nor to the time an Admin''s stop holds: '||pg_temp.given(330,259)||' / '||pg_temp.trip(330,259));
update public.workflows set status='paused' where id=pg_temp.id(330);
select pg_temp.retire();
-- Lead 260: a plain wait and a task. The run gives the task and finishes. A person cancels (seen), moves the
-- appointment while cancelled (seen) and reopens it (seen), so a run starts for the new time and waits; then a person
-- cancels (seen), moves it back while cancelled (seen) and reopens it (seen).
select pg_temp.publish(332,333,'Follow-up after a plain wait (carry-on at a held time)',
  pg_temp.plain_graph('After the wait (carry-on at a held time)'));
select pg_temp.booking(960,260,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 260 enrolls');
select pg_temp.finish();
select pg_temp.keep(260);
select pg_temp.save(260,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(260,pg_temp.later(7));
select pg_temp.events(25);
select pg_temp.save(260,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.drain();
select pg_temp.ok(pg_temp.trip(332,260)='completed:-@t2; waiting:-@pause','lead 260''s new time gets a run that waits: '||pg_temp.trip(332,260));
select pg_temp.save(260,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(260,pg_temp.back_to(260));
select pg_temp.events(25);
select pg_temp.save(260,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(332,260)='After the wait (carry-on at a held time)'
    and pg_temp.trip(332,260)='completed:-@t2; stopped:Appointment was cancelled@pause',
  'back at the time a finished follow-up followed, the run for the other time is not carried on there: '
    ||pg_temp.given(332,260)||' / '||pg_temp.trip(332,260));
update public.workflows set status='paused' where id=pg_temp.id(332);
select pg_temp.retire();
-- Leads 261 and 262: two reminders. The run gives both and finishes; an ordinary move (seen) starts a run for the new
-- time (the ordinary-move decision), which gives its first reminder. Lead 261 is then cancelled (seen), moved back to
-- the first time while cancelled (seen) and reopened (seen); lead 262 is moved back by an ordinary move (seen).
select pg_temp.publish(334,335,'Two reminders (ordinary move, then back by reopenings)',
  pg_temp.two_reminders('{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(900+n,n,5) from (values (261),(262)) v(n);
select pg_temp.ok(pg_temp.events(25)=2,'leads 261 and 262 enroll');
select pg_temp.finish();
select pg_temp.keep(n) from (values (261),(262)) v(n);
select pg_temp.save(n,pg_temp.later(7)) from (values (261),(262)) v(n);
select pg_temp.events(25);
select pg_temp.first_reminders(334);
select pg_temp.ok((select bool_and(pg_temp.trip(334,n)='completed:-@t2; waiting:-@w2') from (values (261),(262)) v(n)),
  'an ordinary move starts a run for the new time, which gives its first reminder: '||pg_temp.trip(334,261));
select pg_temp.save(261,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(261,pg_temp.back_to(261));
select pg_temp.events(25);
select pg_temp.save(261,'status=''Scheduled''');
select pg_temp.save(262,pg_temp.back_to(262));
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(334,261)='First reminder, First reminder, Second reminder'
    and pg_temp.trip(334,261)='completed:-@t2; stopped:Appointment was rescheduled@w2',
  'back by reopenings at the time the finished run followed, the run the ordinary move started is not carried on there: '
    ||pg_temp.given(334,261)||' / '||pg_temp.trip(334,261));
-- Pins the ordinary-move decision: an ordinary move back starts the automation over for that time.
-- Changed by the reminder record: the run that starts over there skips both reminders the finished run already gave
-- for that time, so that time gets each reminder once (was First reminder x3, Second reminder x2, the last run
-- completing with no reason).
select pg_temp.ok(pg_temp.given(334,262)='First reminder, First reminder, Second reminder'
    and pg_temp.trip(334,262)
      ='completed:-@t2; stopped:Appointment was rescheduled@w2; completed:Already created for this appointment time@t2',
  'an ordinary move back starts over: '||pg_temp.given(334,262)||' / '||pg_temp.trip(334,262));
update public.workflows set status='paused' where id=pg_temp.id(334);
select pg_temp.retire();
-- Leads 263 and 264: two reminders. The run gives its first; a person cancels (seen), moves the appointment while
-- cancelled (seen) and reopens it (seen), so the automation starts over for the new time, replacing that run, and the
-- new run gives both and finishes. A person cancels lead 263 (seen), moves it back while cancelled (seen) and reopens it
-- (seen); one person's save moves lead 264 back and reopens it.
select pg_temp.publish(336,337,'Two reminders (replaced, then back by reopenings)',
  pg_temp.two_reminders('{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(900+n,n,5) from (values (263),(264)) v(n);
select pg_temp.ok(pg_temp.events(25)=2,'leads 263 and 264 enroll');
select pg_temp.first_reminders(336);
select pg_temp.keep(n) from (values (263),(264)) v(n);
select pg_temp.save(n,'status=''Cancelled''') from (values (263),(264)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.later(7)) from (values (263),(264)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from (values (263),(264)) v(n);
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok((select bool_and(pg_temp.trip(336,n)='stopped:Appointment was rescheduled@w2; completed:-@t2'
    and pg_temp.given(336,n)='First reminder, First reminder, Second reminder') from (values (263),(264)) v(n)),
  'the new time gets its own run, which replaces the first and finishes: '||pg_temp.trip(336,263));
select pg_temp.save(n,'status=''Cancelled''') from (values (263),(264)) v(n);
select pg_temp.events(25);
select pg_temp.save(263,pg_temp.back_to(263));
select pg_temp.events(25);
select pg_temp.save(263,'status=''Scheduled''');
select pg_temp.save(264,pg_temp.back_to(264)||',status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok((select bool_and(pg_temp.given(336,n)='First reminder, First reminder, Second reminder, Second reminder'
    and pg_temp.trip(336,n)='completed:-@t2; completed:-@t2') from (values (263),(264)) v(n)),
  'back at the first time by reopenings, the replaced run carries on and gives only its remaining reminder: '
    ||pg_temp.given(336,263)||' / '||pg_temp.trip(336,263)||' / '||pg_temp.given(336,264)||' / '||pg_temp.trip(336,264));
update public.workflows set status='paused' where id=pg_temp.id(336);
select pg_temp.retire();
-- Leads 265 and 266 (verifier v2's leads 253 and 254): a run stopped at its booked time, then a run for another time in
-- between, then a reopening at the stopped time. Lead 265's reminder is held for seven days and the hold ends the run,
-- which gave nothing; lead 266's run is stopped by an Admin while it waits. An ordinary move (seen) starts a run for the
-- new time, which gives its reminder; a person cancels (seen), moves it back to the first time while cancelled (seen)
-- and reopens it (seen).
select pg_temp.publish(338,339,'Reminder (a stop, then a run for another time)',
  pg_temp.reminder_graph('Reminder (stop, then another time)','{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(965,265,5);
select pg_temp.keep(265);
select pg_temp.ok(pg_temp.events(25)=1,'lead 265 enrolls');
do $$
declare c jsonb;
begin
  perform pg_temp.ok(pg_temp.work()->>'result'='wait','lead 265 waits for the day before');
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(338) and status='waiting';
  perform pg_temp.ok(pg_temp.work()->>'result'='elapsed','lead 265: the day before arrives');
  select * into c from public.automation_claim_work(1);
  perform pg_temp.ok(c->>'node_id'='task' and public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'held','Fixture hold'),
    'lead 265: the reminder is held');
  update private.automation_runs set held_since=clock_timestamp()-interval '8 days',due_at=clock_timestamp()-interval '1 second'
    where workflow_id=pg_temp.id(338) and contact_id=pg_temp.id(265);
  select * into c from public.automation_claim_work(1);
  perform public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'held','Fixture hold');
end $$;
select pg_temp.booking(966,266,5);
select pg_temp.keep(266);
select pg_temp.ok(pg_temp.events(25)=1,'lead 266 enrolls');
select pg_temp.drain();
select pg_temp.admin_stop(338,266);
select pg_temp.ok(pg_temp.trip(338,265)='stopped:Stopped after 7 days on hold: Fixture hold@task' and pg_temp.given(338,265)='none'
    and pg_temp.trip(338,266)='stopped:Stopped by user@until',
  'lead 265''s run ends after seven days on hold, having given nothing, and an Admin stops lead 266''s');
select pg_temp.save(n,pg_temp.later(8)) from (values (265),(266)) v(n);
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok((select bool_and(pg_temp.given(338,n)='Reminder (stop, then another time)') from (values (265),(266)) v(n)),
  'an ordinary move starts a run for the new time, which gives its reminder: '||pg_temp.trip(338,265)||' / '||pg_temp.trip(338,266));
select pg_temp.save(n,'status=''Cancelled''') from (values (265),(266)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.back_to(n)) from (values (265),(266)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from (values (265),(266)) v(n);
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(338,265)='Reminder (stop, then another time), Reminder (stop, then another time)'
    and pg_temp.trip(338,265)='stopped:Stopped after 7 days on hold: Fixture hold@task; completed:-@task; completed:-@task',
  'back at the time whose reminder the hold kept from going out, after a run for another time, it gets that reminder: '
    ||pg_temp.given(338,265)||' / '||pg_temp.trip(338,265));
-- Pins: a person's stop holds every time its run followed, also after a run for another time.
select pg_temp.ok(pg_temp.given(338,266)='Reminder (stop, then another time)'
    and pg_temp.trip(338,266)='stopped:Stopped by user@until; completed:-@task',
  'back at the time an Admin''s stop held, after a run for another time, nothing starts: '||pg_temp.given(338,266)||' / '||pg_temp.trip(338,266));
update public.workflows set status='paused' where id=pg_temp.id(338);
select pg_temp.retire();
-- Lead 267: two reminders. The run gives its first; its second is held for seven days and the hold ends the run. An
-- ordinary move (seen) starts a run for the new time, which gives both; a person cancels (seen), moves it back to the
-- first time while cancelled (seen) and reopens it (seen).
select pg_temp.publish(340,341,'Two reminders (held after the first)',pg_temp.two_reminders('{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(967,267,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 267 enrolls');
select pg_temp.first_reminders(340);
select pg_temp.keep(267);
do $$
declare c jsonb;
begin
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(340) and status='waiting';
  perform pg_temp.ok(pg_temp.work()->>'result'='elapsed','lead 267: the second reminder''s time arrives');
  select * into c from public.automation_claim_work(1);
  perform pg_temp.ok(c->>'node_id'='t2' and public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'held','Fixture hold'),
    'lead 267: the second reminder is held');
  update private.automation_runs set held_since=clock_timestamp()-interval '8 days',due_at=clock_timestamp()-interval '1 second'
    where workflow_id=pg_temp.id(340) and contact_id=pg_temp.id(267);
  select * into c from public.automation_claim_work(1);
  perform public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'held','Fixture hold');
end $$;
select pg_temp.ok(pg_temp.trip(340,267)='stopped:Stopped after 7 days on hold: Fixture hold@t2' and pg_temp.given(340,267)='First reminder',
  'lead 267''s run gives its first reminder and the hold ends it: '||pg_temp.trip(340,267));
select pg_temp.save(267,pg_temp.later(8));
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.save(267,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(267,pg_temp.back_to(267));
select pg_temp.events(25);
select pg_temp.save(267,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
-- Pins: a run the hold stopped after it gave something holds its time across a later run for another time.
select pg_temp.ok(pg_temp.given(340,267)='First reminder, First reminder, Second reminder'
    and pg_temp.trip(340,267)='stopped:Stopped after 7 days on hold: Fixture hold@t2; completed:-@t2',
  'back at the time whose first reminder went out before the hold ended the run, nothing starts: '
    ||pg_temp.given(340,267)||' / '||pg_temp.trip(340,267));
update public.workflows set status='paused' where id=pg_temp.id(340);
select pg_temp.retire();
-- Leads 268 and 269: a plain wait of an hour, a step, then a reminder a day before. Each gives the step at its booked
-- time and waits for the reminder; an ordinary move (seen) twelve hours later moves that wait. An Admin stops lead 268's
-- run; lead 269's gives its reminder for the new time and finishes. A person cancels each (seen), moves it back to the
-- first time while cancelled (seen) and reopens it (seen).
select pg_temp.publish(342,343,'A step, then a reminder',jsonb_build_object('format',1,
  'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','pause','type','wait','version',1,'config',jsonb_build_object('duration',1,'unit','hours')),
    jsonb_build_object('id','ta','type','create_task','version',1,'config',jsonb_build_object('title','Step after the wait','task_type','Follow Up','due_amount',0,'due_unit','minutes')),
    jsonb_build_object('id','until','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',1,'unit','days')),
    jsonb_build_object('id','tb','type','create_task','version',1,'config',jsonb_build_object('title','Reminder after the step','task_type','Follow Up','due_amount',0,'due_unit','minutes'))),
  'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','pause'),jsonb_build_object('id','b','source','pause','target','ta'),
    jsonb_build_object('id','c','source','ta','target','until'),jsonb_build_object('id','d','source','until','target','tb'))));
select pg_temp.booking(900+n,n,5) from (values (268),(269)) v(n);
select pg_temp.ok(pg_temp.events(25)=2,'leads 268 and 269 enroll');
select pg_temp.drain();
select pg_temp.keep(n) from (values (268),(269)) v(n);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(342) and status='waiting';
select pg_temp.drain();
select pg_temp.save(n,format('start_time=%L',(select at from followed_at where followed_at.n=v.n)+interval '12 hours')) from (values (268),(269)) v(n);
select pg_temp.events(25);
select pg_temp.ok((select bool_and(pg_temp.trip(342,n)='waiting:-@until' and pg_temp.given(342,n)='Step after the wait'
    and (select r.anchor_at from private.automation_runs r where r.workflow_id=pg_temp.id(342) and r.contact_id=pg_temp.id(n))
      =(select at from followed_at where followed_at.n=v.n)+interval '12 hours') from (values (268),(269)) v(n)),
  'each gives its step at the booked time, and its reminder wait follows the move: '||pg_temp.trip(342,268));
select pg_temp.admin_stop(342,268);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second'
  where workflow_id=pg_temp.id(342) and contact_id=pg_temp.id(269) and status='waiting';
select pg_temp.drain();
select pg_temp.save(n,'status=''Cancelled''') from (values (268),(269)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,pg_temp.back_to(n)) from (values (268),(269)) v(n);
select pg_temp.events(25);
select pg_temp.save(n,'status=''Scheduled''') from (values (268),(269)) v(n);
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(342,268)='Step after the wait' and pg_temp.trip(342,268)='stopped:Stopped by user@until',
  'back at the time the stopped run gave its step at, nothing starts: '||pg_temp.given(342,268)||' / '||pg_temp.trip(342,268));
-- Pins the rule that a run that finished holds only the time it ended at: back at the time it gave its step at before
-- following the move, the sequence starts over there.
-- Changed by the reminder record: the sequence still starts over there, but the step the finished run gave at that
-- time is skipped, and the reminder goes out once for each time (was Step after the wait x2).
select pg_temp.ok(pg_temp.given(342,269)='Reminder after the step, Reminder after the step, Step after the wait'
    and pg_temp.trip(342,269)='completed:-@tb; completed:-@tb',
  'a finished run does not hold a time it passed through and left: '||pg_temp.given(342,269)||' / '||pg_temp.trip(342,269));
update public.workflows set status='paused' where id=pg_temp.id(342);
select pg_temp.retire();
-- Lead 270: two reminders. The run gives its first, and its second fails, so the run ends failed. A person cancels it
-- (seen), moves it away while cancelled (seen), back to the first time while cancelled (seen) and reopens it (seen).
select pg_temp.publish(344,345,'Two reminders (the second fails)',pg_temp.two_reminders('{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(970,270,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 270 enrolls');
select pg_temp.first_reminders(344);
select pg_temp.keep(270);
do $$
declare c jsonb;
begin
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(344) and status='waiting';
  perform pg_temp.ok(pg_temp.work()->>'result'='elapsed','lead 270: the second reminder''s time arrives');
  select * into c from public.automation_claim_work(1);
  perform pg_temp.ok(c->>'node_id'='t2' and public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'failed','Fixture failure'),
    'lead 270: the second reminder fails');
end $$;
select pg_temp.save(270,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(270,pg_temp.later(8));
select pg_temp.events(25);
select pg_temp.save(270,pg_temp.back_to(270));
select pg_temp.events(25);
select pg_temp.save(270,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(344,270)='First reminder' and pg_temp.trip(344,270)='failed:Fixture failure@t2',
  'back at the time a failed run ended at, on another slot at that time, nothing starts: '
    ||pg_temp.given(344,270)||' / '||pg_temp.trip(344,270));
update public.workflows set status='paused' where id=pg_temp.id(344);
select pg_temp.retire();
-- Leads 271 and 272 (verifier v3's W2): saves in a status the outcome record ignores (Pending), with no cancellation
-- since the save that last left the appointment open, count as standing. A plain wait and a task. An ordinary move
-- (seen) to a new time also sets Pending. Lead 271's run follows it and finishes there; a person cancels it (seen),
-- moves it away while cancelled (seen), back while cancelled (seen) and reopens it (seen). Lead 272's run fails there;
-- the Admin pauses the automation; a person cancels it (seen) and reopens it (seen) on the same slot.
select pg_temp.publish(346,347,'Follow-up after a plain wait (ignored status)',pg_temp.plain_graph('After the wait (ignored status)'));
select pg_temp.booking(971,271,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 271 enrolls');
select pg_temp.drain();
select pg_temp.save(271,pg_temp.later(6)||',status=''Pending''');
select pg_temp.keep(271);
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.save(271,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(271,pg_temp.later(8));
select pg_temp.events(25);
select pg_temp.save(271,pg_temp.back_to(271));
select pg_temp.events(25);
select pg_temp.save(271,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
-- Pins: a run that finished while the appointment stood at its time in an ignored status holds that time.
select pg_temp.ok(pg_temp.given(346,271)='After the wait (ignored status)' and pg_temp.trip(346,271)='completed:-@t2',
  'back at the time a finished run followed in an ignored status, nothing starts: '||pg_temp.given(346,271)||' / '||pg_temp.trip(346,271));
update public.workflows set status='paused' where id=pg_temp.id(346);
select pg_temp.retire();
select pg_temp.publish(348,349,'Follow-up after a plain wait (ignored status, failed)',pg_temp.plain_graph('After the wait (ignored status, failed)'));
select pg_temp.booking(972,272,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 272 enrolls');
select pg_temp.drain();
select pg_temp.save(272,pg_temp.later(6)||',status=''Pending''');
select pg_temp.events(25);
do $$
declare c jsonb;
begin
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(348) and status='waiting';
  perform pg_temp.ok(pg_temp.work()->>'result'='elapsed','lead 272: the plain wait ends');
  select * into c from public.automation_claim_work(1);
  perform pg_temp.ok(c->>'node_id'='t2' and public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'failed','Fixture failure'),
    'lead 272: the task fails');
end $$;
select pg_temp.lifecycle(348,'pause');
select pg_temp.save(272,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(272,'status=''Scheduled''');
select pg_temp.events(25);
-- Pins: a run that ended after the slot first stood in an ignored status is counted by the first-processed guard, so
-- the paused automation keeps no booking for its resume.
select pg_temp.ok(pg_temp.kept(348)=0 and pg_temp.trip(348,272)='failed:Fixture failure@t2',
  'a run that failed after its slot first stood in an ignored status keeps the reopened booking from the resume: '
    ||pg_temp.kept(348)||' / '||pg_temp.trip(348,272));
select pg_temp.lifecycle(348,'resume');
select pg_temp.events(25);
select pg_temp.finish();
select pg_temp.ok(pg_temp.given(348,272)='none' and pg_temp.trip(348,272)='failed:Fixture failure@t2',
  'and nothing starts after the resume: '||pg_temp.given(348,272)||' / '||pg_temp.trip(348,272));
update public.workflows set status='paused' where id=pg_temp.id(348);
select pg_temp.retire();
-- Lead 273: two reminders. The run gives both for the first time and finishes. An ordinary move (seen) starts a run for
-- a second time, which gives its first reminder; an ordinary move back (seen) starts the automation over for the first
-- time (the ordinary-move decision), and that run skips the first reminder the finished run gave there (the reminder
-- record); another ordinary move (seen) starts a run
-- for a third time, which gives its first reminder. A person cancels (seen), moves it back to the first time while
-- cancelled (seen) and reopens it (seen). The first run holds the first time, so neither the run for the third time nor
-- the replaced run whose reminders were for the first time is carried on there.
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  values (pg_temp.id(273),pg_temp.id(1),'Lead 273','+12025550273',pg_temp.id(11),pg_temp.id(11));
select pg_temp.publish(350,351,'Two reminders (moves, then back by reopenings)',pg_temp.two_reminders('{"reentry":"once","stop_on_reply":false}'));
select pg_temp.booking(973,273,5);
select pg_temp.ok(pg_temp.events(25)=1,'lead 273 enrolls');
select pg_temp.finish();
select pg_temp.keep(273);
select pg_temp.save(273,pg_temp.later(7));
select pg_temp.events(25);
select pg_temp.first_reminders(350);
select pg_temp.save(273,pg_temp.back_to(273));
select pg_temp.events(25);
select pg_temp.first_reminders(350);
select pg_temp.save(273,pg_temp.later(8));
select pg_temp.events(25);
select pg_temp.first_reminders(350);
-- Changed by the reminder record: the run the move back starts for the first time skips the first reminder the
-- finished run gave there (was First reminder x4).
select pg_temp.ok(pg_temp.given(350,273)='First reminder, First reminder, First reminder, Second reminder'
    and pg_temp.trip(350,273)='completed:-@t2; stopped:Appointment was rescheduled@w2; stopped:Appointment was rescheduled@w2; waiting:-@w2',
  'each ordinary move starts the automation over: '||pg_temp.given(350,273)||' / '||pg_temp.trip(350,273));
select pg_temp.save(273,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(273,pg_temp.back_to(273));
select pg_temp.events(25);
select pg_temp.save(273,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.finish();
-- Changed by the reminder record: one first reminder fewer, as in the check above (was First reminder x4).
select pg_temp.ok(pg_temp.given(350,273)='First reminder, First reminder, First reminder, Second reminder'
    and pg_temp.trip(350,273)
      ='completed:-@t2; stopped:Appointment was rescheduled@w2; stopped:Appointment was rescheduled@w2; stopped:Appointment was rescheduled@w2',
  'back at the first time by reopenings, which the first run holds, no run is carried on there: '
    ||pg_temp.given(350,273)||' / '||pg_temp.trip(350,273));
update public.workflows set status='paused' where id=pg_temp.id(350);
select pg_temp.retire();
-- Leads 274 to 296: the eighth pass's fixes, and rule parts of the held-time rule no check pinned before. The checks
-- marked "Pins" pass before this change too; so do the checks that set a lead up or report a step on the way; the other
-- 12 checks failed before it, as did lead 260's expected reason above (now 'Appointment was cancelled'). Each story has
-- an automation of its own, on only while its leads book. Texts go through the synthetic transport of step8, which
-- dates a text's intent at its first lease and can record the handoff's message row (automation_begin_message's).
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
select pg_temp.retire();
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(274,296) n;
-- What each lead was given (a text sent or a task created), with the time of the slot its lease was for; the times named
-- for each lead; the texts the transport holds ('hold') or the provider rejects ('fail'); the leads whose handoffs
-- record a message row.
create temporary table given8(workflow_id uuid, contact_id uuid, node_id text, slot_start timestamptz, at timestamptz) on commit drop;
create temporary table times8(n integer, k text, at timestamptz, primary key(n,k)) on commit drop;
create temporary table hold8(contact_id uuid, node_id text, action text) on commit drop;
create temporary table rows8(contact_id uuid primary key) on commit drop;
-- One worker step, as step7 does, except that a text's intent is dated at the step's first lease (each worker call is
-- its own transaction in production, and the claim that first leases a message writes its intent), a text can be held
-- or rejected (hold8), and for a lead in rows8 the handoff records its message row as automation_begin_message does
-- right after it (authorized_at is the handoff moment). The check's 'skip:' and 'retry:' answers are taken as step7
-- takes them; a text held before its handoff (hold8 'hold', as sending hours are) is skipped on a 'skip:' answer.
create function pg_temp.step8() returns jsonb language plpgsql as $$
declare c jsonb; node jsonb; made jsonb; outcome text; why text; refusal text; action text; again text;
begin
  select * into c from public.automation_claim_work(1);
  if c is null then return null; end if;
  select n into node from jsonb_array_elements(c#>'{graph,nodes}') n where n->>'id'=c->>'node_id';
  select h.action into action from hold8 h where h.contact_id=(c->>'contact_id')::uuid and h.node_id=c->>'node_id';
  if node->>'type'='create_task' then
    made:=public.automation_create_task((c->>'run_id')::uuid,(c->>'lease_token')::uuid,c->>'node_id',
      node#>>'{config,title}',node#>>'{config,notes}');
    outcome:=made->>'status'; why:=made->>'reason';
    if outcome='created' then
      insert into given8 select r.workflow_id,r.contact_id,c->>'node_id',o.scheduled_start,clock_timestamp()
        from private.automation_runs r left join private.appointment_occurrences o on o.id=r.leased_for
        where r.id=(c->>'run_id')::uuid;
    end if;
  elsif node->>'type' in ('wait','wait_until_before_appointment') then
    outcome:=case when c->>'status'='waiting' then 'elapsed' else 'wait' end;
  elsif node->>'type'='send_sms' then
    update private.automation_intents set created_at=clock_timestamp()
      where run_id=(c->>'run_id')::uuid and node_id=c->>'node_id' and created_at=now();
    refusal:=public.automation_message_check((c->>'run_id')::uuid,(c->>'lease_token')::uuid,c->>'node_id');
    if refusal like 'skip:%' then
      outcome:='skipped'; why:=substr(refusal,6);
    elsif action='hold' then
      outcome:='held'; why:='Outside sending hours (suite)';
    else
      if (refusal is null or refusal='retry:')
          and public.automation_authorize_handoff((c->>'run_id')::uuid,(c->>'lease_token')::uuid,c->>'node_id') then
        if action='fail' then
          outcome:='failed'; why:='The provider did not accept this message (suite)';
        else
          update private.automation_intents set status='accepted' where run_id=(c->>'run_id')::uuid and node_id=c->>'node_id';
          insert into private.automation_messages(organization_id,run_id,node_id,contact_id,contact_type,channel,recipient,sender,
              owner_id,body)
            select r.organization_id,r.id,c->>'node_id',r.contact_id,'lead','sms','+12025550000','+12025559999',pg_temp.id(11),'Suite'
            from private.automation_runs r join rows8 w on w.contact_id=r.contact_id where r.id=(c->>'run_id')::uuid
            on conflict do nothing;
          insert into given8 select r.workflow_id,r.contact_id,c->>'node_id',o.scheduled_start,clock_timestamp()
            from private.automation_runs r left join private.appointment_occurrences o on o.id=r.leased_for
            where r.id=(c->>'run_id')::uuid;
          outcome:='accepted';
        end if;
      else
        if refusal is null or refusal='retry:' then
          again:=public.automation_message_check((c->>'run_id')::uuid,(c->>'lease_token')::uuid,c->>'node_id');
        end if;
        if again like 'skip:%' then
          outcome:='skipped'; why:=substr(again,6);
        else
          outcome:='held'; why:='Refused at handoff: '||coalesce(nullif(refusal,'retry:'),'the handoff was not authorized');
        end if;
      end if;
    end if;
  else
    outcome:='held'; why:='Synthetic transport';
  end if;
  perform public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,outcome,why);
  return c||jsonb_build_object('result',outcome,'reason',why);
end $$;
-- The worker: events, every step that is due (nothing is forced), then events again.
create function pg_temp.pass8() returns void language plpgsql as $$
begin
  perform pg_temp.events(25);
  for i in 1..150 loop exit when pg_temp.step8() is null; end loop;
  perform pg_temp.events(25);
end $$;
-- Time passes for one automation's runs for a lead (its waiting and held runs are due now), then the worker runs.
create function pg_temp.due8(workflow_n integer, lead_n integer) returns void language plpgsql as $$
begin
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second'
    where workflow_id=pg_temp.id(workflow_n) and contact_id=pg_temp.id(lead_n) and status in ('waiting','held');
  perform pg_temp.pass8();
end $$;
-- Time passes until that automation has nothing left for the lead.
create function pg_temp.all8(workflow_n integer, lead_n integer) returns void language plpgsql as $$
begin
  for i in 1..12 loop
    exit when not exists (select 1 from private.automation_runs where workflow_id=pg_temp.id(workflow_n)
      and contact_id=pg_temp.id(lead_n) and status in ('queued','waiting','held'));
    perform pg_temp.due8(workflow_n,lead_n);
  end loop;
end $$;
create function pg_temp.at8(lead_n integer, k text) returns text language sql as $$
  select format('start_time=%L',(select t.at from times8 t where t.n=lead_n and t.k=at8.k))
$$;
create function pg_temp.book8(lead_n integer, k text) returns void language sql as $$
  insert into booked select lead_n,pg_temp.book(1000+lead_n,lead_n,t.at),t.at from times8 t where t.n=lead_n and t.k=book8.k
$$;
-- A person cancels, moves the appointment to another time while it is cancelled and opens it again, each seen.
create function pg_temp.away8(lead_n integer, k text) returns void language plpgsql as $$
begin
  perform pg_temp.save(lead_n,'status=''Cancelled'''); perform pg_temp.pass8();
  perform pg_temp.save(lead_n,pg_temp.at8(lead_n,k)); perform pg_temp.pass8();
  perform pg_temp.save(lead_n,'status=''Scheduled'''); perform pg_temp.pass8();
end $$;
-- What the lead was given on the automation, in order, each with the name of its slot's time.
create function pg_temp.given8(workflow_n integer, lead_n integer) returns text language sql as $$
  select coalesce(string_agg(g.node_id||'@'||coalesce((select t.k from times8 t where t.n=lead_n and t.at=g.slot_start),'?'),', '
    order by g.at),'none')
  from given8 g where g.workflow_id=pg_temp.id(workflow_n) and g.contact_id=pg_temp.id(lead_n)
$$;
-- The lead's held run on the automation has been held for eight days, and is due.
create function pg_temp.hold_aged8(workflow_n integer, lead_n integer) returns void language sql as $$
  update private.automation_runs set held_since=clock_timestamp()-interval '8 days',due_at=clock_timestamp()-interval '1 second'
  where workflow_id=pg_temp.id(workflow_n) and contact_id=pg_temp.id(lead_n) and status='held'
$$;
-- Graphs. Both: a plain wait of a day, text ta, a day before the appointment (a passed reminder is skipped), text tb.
-- Plain texts and plain tasks: a plain wait of a day, the first, a plain wait of a day, the second (no appointment wait).
-- Two texts: two days before (t1) and a day before (t2), sent late or skipped when passed.
create function pg_temp.g8_both(pause_unit text) returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','pause','type','wait','version',1,'config',jsonb_build_object('duration',1,'unit',pause_unit)),
    jsonb_build_object('id','ta','type','send_sms','version',1,'config',jsonb_build_object('body','After the wait','purpose','informational')),
    jsonb_build_object('id','w1','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',1,'unit','days')),
    jsonb_build_object('id','tb','type','send_sms','version',1,'config',jsonb_build_object('body','A day before','purpose','informational'))),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','pause'),
      jsonb_build_object('id','b','source','pause','target','ta'),jsonb_build_object('id','c','source','ta','target','w1'),
      jsonb_build_object('id','d','source','w1','target','tb')))
$$;
create function pg_temp.g8_plain(kind text) returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','qa','type','wait','version',1,'config',jsonb_build_object('duration',1,'unit','days')),
    case when kind='task' then jsonb_build_object('id','q1','type','create_task','version',1,'config',jsonb_build_object('title',
        'First plain task','task_type','Follow Up','due_amount',0,'due_unit','minutes'))
      else jsonb_build_object('id','q1','type','send_sms','version',1,'config',jsonb_build_object('body','First','purpose','informational')) end,
    jsonb_build_object('id','qb','type','wait','version',1,'config',jsonb_build_object('duration',1,'unit','days')),
    case when kind='task' then jsonb_build_object('id','q2','type','create_task','version',1,'config',jsonb_build_object('title',
        'Second plain task','task_type','Follow Up','due_amount',0,'due_unit','minutes'))
      else jsonb_build_object('id','q2','type','send_sms','version',1,'config',jsonb_build_object('body','Second','purpose','informational')) end),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','qa'),
      jsonb_build_object('id','b','source','qa','target','q1'),jsonb_build_object('id','c','source','q1','target','qb'),
      jsonb_build_object('id','d','source','qb','target','q2')))
$$;
create function pg_temp.g8_two(late text) returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','w1','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',2,'unit','days','late',late)),
    jsonb_build_object('id','t1','type','send_sms','version',1,'config',jsonb_build_object('body','Two days','purpose','informational')),
    jsonb_build_object('id','w2','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',1,'unit','days','late',late)),
    jsonb_build_object('id','t2','type','send_sms','version',1,'config',jsonb_build_object('body','A day','purpose','informational'))),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','w1'),
      jsonb_build_object('id','b','source','w1','target','t1'),jsonb_build_object('id','c','source','t1','target','w2'),
      jsonb_build_object('id','d','source','w2','target','t2')))
$$;
-- The automation in use is on, and every other one of this section is off (its interval ended).
create function pg_temp.only8(workflow_n integer) returns void language plpgsql as $$
begin
  update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active' and id<>pg_temp.id(workflow_n);
  perform pg_temp.retire();
end $$;

-- Leads 274 to 277: a run that gave a text or a task after a plain wait and has not passed an appointment wait (its
-- reminders were for no slot) is cancelled at T3; the appointment is reopened at T2, which the automation's finished
-- first run holds, so the run is not carried on there; it then comes back to T3, its own time. Before this change the
-- carry-on recorded such a run as rescheduled, which the move back never takes up (it takes runs by the slot their
-- reminders were for), so the automation started over at T3 and gave the text or task again. Now the run stays stopped
-- by the cancellation and the carry-on takes it up at T3. T2 is 5 days out and T3 6 days.
-- 274: both waits, back at T3 by a reopening. 275: plain tasks, by a reopening. 276: plain texts, by an ordinary move of
-- the standing appointment. 277: both waits, by the calendar sync's one save that moves it and writes Scheduled.
insert into times8 select n,'T2',date_trunc('minute',clock_timestamp())+interval '5 days' from generate_series(274,277) n;
insert into times8 select n,'T3',date_trunc('minute',clock_timestamp())+interval '6 days' from generate_series(274,277) n;
select pg_temp.publish(352,353,'Plain wait, text, a day before, text (stranded run)',pg_temp.g8_both('days'));
select pg_temp.book8(274,'T2');
select pg_temp.pass8();
select pg_temp.all8(352,274);
select pg_temp.save(274,pg_temp.at8(274,'T3'));
select pg_temp.pass8();
select pg_temp.due8(352,274);
select pg_temp.ok(pg_temp.given8(352,274)='ta@T2, tb@T2, ta@T3'
    and pg_temp.trip(352,274)='completed:-@tb; waiting:-@w1',
  'lead 274: an ordinary move to T3 starts over, and the new run gives ta and waits for tb: '
    ||pg_temp.given8(352,274)||' / '||pg_temp.trip(352,274));
select pg_temp.away8(274,'T2');
select pg_temp.ok(pg_temp.given8(352,274)='ta@T2, tb@T2, ta@T3'
    and pg_temp.trip(352,274)='completed:-@tb; stopped:Appointment was cancelled@w1',
  'reopened at T2, which the finished run holds, the run with no reminder slot stays stopped by the cancellation: '
    ||pg_temp.given8(352,274)||' / '||pg_temp.trip(352,274));
select pg_temp.away8(274,'T3');
select pg_temp.all8(352,274);
select pg_temp.ok(pg_temp.given8(352,274)='ta@T2, tb@T2, ta@T3, tb@T3'
    and pg_temp.trip(352,274)='completed:-@tb; completed:-@tb',
  'reopened back at T3, that run carries on and gives tb, and ta is not given there again: '
    ||pg_temp.given8(352,274)||' / '||pg_temp.trip(352,274));
select pg_temp.publish(354,355,'Plain tasks (stranded run)',pg_temp.g8_plain('task'));
select pg_temp.only8(354);
select pg_temp.book8(275,'T2');
select pg_temp.pass8();
select pg_temp.all8(354,275);
select pg_temp.save(275,pg_temp.at8(275,'T3'));
select pg_temp.pass8();
select pg_temp.due8(354,275);
select pg_temp.away8(275,'T2');
select pg_temp.away8(275,'T3');
select pg_temp.all8(354,275);
select pg_temp.ok(pg_temp.given8(354,275)='q1@T2, q2@T2, q1@T3, q2@T3'
    and pg_temp.trip(354,275)='completed:-@q2; completed:-@q2',
  'lead 275: plain tasks, back at T3 by a reopening, each task once per time: '
    ||pg_temp.given8(354,275)||' / '||pg_temp.trip(354,275));
select pg_temp.publish(356,357,'Plain texts (stranded run)',pg_temp.g8_plain('text'));
select pg_temp.only8(356);
select pg_temp.book8(276,'T2');
select pg_temp.pass8();
select pg_temp.all8(356,276);
select pg_temp.save(276,pg_temp.at8(276,'T3'));
select pg_temp.pass8();
select pg_temp.due8(356,276);
select pg_temp.away8(276,'T2');
select pg_temp.save(276,pg_temp.at8(276,'T3'));
select pg_temp.pass8();
select pg_temp.all8(356,276);
select pg_temp.ok(pg_temp.given8(356,276)='q1@T2, q2@T2, q1@T3, q2@T3'
    and pg_temp.trip(356,276)='completed:-@q2; completed:-@q2',
  'lead 276: plain texts, back at T3 by an ordinary move of the standing appointment, each text once per time: '
    ||pg_temp.given8(356,276)||' / '||pg_temp.trip(356,276));
select pg_temp.publish(358,359,'Plain wait, text, a day before, text (stranded run, sync)',pg_temp.g8_both('days'));
select pg_temp.only8(358);
select pg_temp.book8(277,'T2');
select pg_temp.pass8();
select pg_temp.all8(358,277);
select pg_temp.save(277,pg_temp.at8(277,'T3'));
select pg_temp.pass8();
select pg_temp.due8(358,277);
select pg_temp.away8(277,'T2');
select pg_temp.save(277,'status=''Cancelled''');
select pg_temp.pass8();
select pg_temp.sync(277,format('%s,status=''Scheduled''',pg_temp.at8(277,'T3')));
select pg_temp.pass8();
select pg_temp.all8(358,277);
select pg_temp.ok(pg_temp.given8(358,277)='ta@T2, tb@T2, ta@T3, tb@T3'
    and pg_temp.trip(358,277)='completed:-@tb; completed:-@tb',
  'lead 277: back at T3 by the sync''s one save that moves it and writes Scheduled, each text once per time: '
    ||pg_temp.given8(358,277)||' / '||pg_temp.trip(358,277));

-- Leads 278 to 285, eight copies of one story: two texts, two days and a day before, sent late when passed. Booked at
-- T1, 47 hours out, so t1 goes out at once; ordinary moves, each seen, to T2 (30 hours out), back to T1 and to T2 again,
-- each starting the automation over (the ordinary-move decision), so two runs are recorded as rescheduled with their
-- reminders for T1. A person then cancels, moves it back to T1 while cancelled and reopens it. Exactly one of those two
-- runs carries on, so T1 gets t2 once: the later one, which keeps the earlier one from carrying on. Before this change
-- each passed the other's check, and both carried on whenever the loop took the earlier first, which the order of
-- random run ids decides (about half the time for each copy, so all eight copies passed by chance one time in 256).
insert into times8 select n,'T1',date_trunc('minute',clock_timestamp())+interval '47 hours' from generate_series(278,285) n;
insert into times8 select n,'T2',date_trunc('minute',clock_timestamp())+interval '30 hours' from generate_series(278,285) n;
select pg_temp.publish(360,361,'Two texts, late (two runs moved back)',pg_temp.g8_two('continue'));
select pg_temp.only8(360);
select pg_temp.book8(n,'T1') from generate_series(278,285) n;
select pg_temp.pass8();
select pg_temp.save(n,pg_temp.at8(n,'T2')) from generate_series(278,285) n;
select pg_temp.pass8();
select pg_temp.save(n,pg_temp.at8(n,'T1')) from generate_series(278,285) n;
select pg_temp.pass8();
select pg_temp.save(n,pg_temp.at8(n,'T2')) from generate_series(278,285) n;
select pg_temp.pass8();
-- Changed by the reminder record: the runs that start over at T1 and at T2 again skip t1, which each time already got
-- (was t1@T1, t1@T2, t1@T1, t1@T2).
select pg_temp.ok((select count(*) from generate_series(278,285) n where pg_temp.given8(360,n)='t1@T1, t1@T2'
    and pg_temp.trip(360,n)='stopped:Appointment was rescheduled@w2; stopped:Appointment was rescheduled@w2; '
      ||'stopped:Appointment was rescheduled@w2; waiting:-@w2')=8,
  'leads 278 to 285: each ordinary move starts over: '||pg_temp.given8(360,278)||' / '||pg_temp.trip(360,278));
select pg_temp.save(n,'status=''Cancelled''') from generate_series(278,285) n;
select pg_temp.pass8();
select pg_temp.save(n,pg_temp.at8(n,'T1')) from generate_series(278,285) n;
select pg_temp.pass8();
select pg_temp.save(n,'status=''Scheduled''') from generate_series(278,285) n;
select pg_temp.pass8();
select pg_temp.ok((select count(*) from generate_series(278,285) n where (select count(*) from private.automation_runs r
    where r.workflow_id=pg_temp.id(360) and r.contact_id=pg_temp.id(n) and r.status in ('queued','waiting','held'))=1)=8,
  'reopened at T1, exactly one run carries on for each of the eight leads: '||(select string_agg(n||' '||pg_temp.trip(360,n),' | ')
    from generate_series(278,285) n where (select count(*) from private.automation_runs r where r.workflow_id=pg_temp.id(360)
      and r.contact_id=pg_temp.id(n) and r.status in ('queued','waiting','held'))<>1));
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(360) and status='waiting';
select pg_temp.pass8();
-- Changed by the reminder record: t2 still once, after the two t1 texts above (was t1@T1, t1@T2, t1@T1, t1@T2, t2@T1).
select pg_temp.ok((select count(*) from generate_series(278,285) n where pg_temp.given8(360,n)='t1@T1, t1@T2, t2@T1')=8,
  'the day before T1, each of the eight leads gets t2 once: '||(select string_agg(n||' '||pg_temp.given8(360,n),' | ')
    from generate_series(278,285) n where pg_temp.given8(360,n)<>'t1@T1, t1@T2, t2@T1'));

-- Lead 286: rule (c) counts every later booking run, also one a move back later replaced. Two texts, sent late. Booked
-- at T1 (47 hours out): run E gives t1. An ordinary move to T2 (30 hours out) starts run R, whose t1 is held for seven
-- days, so the hold ends R having given nothing. An ordinary move to T3 (40 hours out) starts run M, which the worker
-- has not run. Cancelled, moved back to T1 while cancelled and reopened: E carries on there (M is recorded as moved back)
-- and gives t2. Cancelled, moved to T2 while cancelled and reopened: R is not the latest booking run, so it holds no
-- time, and T2 gets its reminders. Before this change M did not count, so R held T2 and T2 got nothing.
insert into times8 values (286,'T1',date_trunc('minute',clock_timestamp())+interval '47 hours'),
  (286,'T2',date_trunc('minute',clock_timestamp())+interval '30 hours'),(286,'T3',date_trunc('minute',clock_timestamp())+interval '40 hours');
select pg_temp.publish(362,363,'Two texts, late (hold stop and a run moved back)',pg_temp.g8_two('continue'));
select pg_temp.only8(362);
select pg_temp.book8(286,'T1');
select pg_temp.pass8();
insert into hold8 values (pg_temp.id(286),'t1','hold');
select pg_temp.save(286,pg_temp.at8(286,'T2'));
select pg_temp.pass8();
select pg_temp.hold_aged8(362,286);
select pg_temp.pass8();
delete from hold8;
select pg_temp.save(286,pg_temp.at8(286,'T3'));
select pg_temp.events(25);
select pg_temp.ok(pg_temp.trip(362,286)='stopped:Appointment was rescheduled@w2; '
    ||'stopped:Stopped after 7 days on hold: Outside sending hours (suite)@t1; queued:-@w1',
  'lead 286: R ended by the hold having given nothing, and M booked at T3: '||pg_temp.trip(362,286));
select pg_temp.save(286,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(286,pg_temp.at8(286,'T1'));
select pg_temp.events(25);
select pg_temp.save(286,'status=''Scheduled''');
select pg_temp.pass8();
select pg_temp.due8(362,286);
select pg_temp.ok(pg_temp.given8(362,286)='t1@T1, t2@T1' and pg_temp.trip(362,286) like '%stopped:Appointment was moved back@%',
  'reopened at T1, E carries on and gives t2, and M is recorded as moved back: '
    ||pg_temp.given8(362,286)||' / '||pg_temp.trip(362,286));
select pg_temp.save(286,'status=''Cancelled''');
select pg_temp.events(25);
select pg_temp.save(286,pg_temp.at8(286,'T2'));
select pg_temp.events(25);
select pg_temp.save(286,'status=''Scheduled''');
select pg_temp.events(25);
select pg_temp.pass8();
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id=pg_temp.id(362) and status='waiting';
select pg_temp.pass8();
select pg_temp.ok(pg_temp.given8(362,286)='t1@T1, t2@T1, t1@T2, t2@T2',
  'reopened at T2, where the hold stopped R before it gave anything, T2 gets its reminders: '
    ||pg_temp.given8(362,286)||' / '||pg_temp.trip(362,286));

-- Leads 287 and 288: the final send check holds a booking's text while the appointment is still ahead and marked
-- Completed; held seven days, the hold ends the run; the person then takes Completed back (Scheduled), still before the
-- start. The carry-on takes the run up at the slot it followed, so the text goes out once and the time keeps its later
-- reminders. Before this change nothing resumed. 287: a text a day before (sent late when passed), booked 3 days out.
-- 288: a text at once and one a day before, booked 21 days out, marked Completed before the first lease.
insert into times8 values (287,'T',date_trunc('minute',clock_timestamp())+interval '3 days'),
  (288,'T',date_trunc('minute',clock_timestamp())+interval '21 days');
select pg_temp.publish(364,365,'Text a day before (taken back after the hold)',jsonb_build_object('format',1,
  'settings',jsonb_build_object('reentry','once','stop_on_reply',false),
  'nodes',jsonb_build_array(jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','until','type','wait_until_before_appointment','version',1,
      'config',jsonb_build_object('amount',1,'unit','days','late','continue')),
    jsonb_build_object('id','text','type','send_sms','version',1,'config',jsonb_build_object('body','See you soon','purpose','informational'))),
  'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','until'),
    jsonb_build_object('id','b','source','until','target','text'))));
select pg_temp.only8(364);
select pg_temp.book8(287,'T');
select pg_temp.pass8();
select pg_temp.save(287,'status=''Completed''');
select pg_temp.due8(364,287);
select pg_temp.ok(pg_temp.given8(364,287)='none' and pg_temp.trip(364,287)='held:Refused at handoff: The appointment has an outcome recorded@text',
  'lead 287: Completed before the start holds the text: '||pg_temp.trip(364,287));
select pg_temp.hold_aged8(364,287);
select pg_temp.pass8();
select pg_temp.ok(pg_temp.trip(364,287)='stopped:Stopped after 7 days on hold: Refused at handoff: The appointment has an outcome recorded@text',
  'held seven days, the hold ends the run: '||pg_temp.trip(364,287));
select pg_temp.save(287,'status=''Scheduled''');
select pg_temp.pass8();
select pg_temp.all8(364,287);
select pg_temp.ok(pg_temp.given8(364,287)='text@T' and pg_temp.trip(364,287)='completed:-@text',
  'Completed taken back before the start after the hold ended the run: the text still goes out once: '
    ||pg_temp.given8(364,287)||' / '||pg_temp.trip(364,287));
select pg_temp.publish(366,367,'Thanks, then a day before (taken back after the hold)',jsonb_build_object('format',1,
  'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','t_now','type','send_sms','version',1,'config',jsonb_build_object('body','Thanks','purpose','informational')),
    jsonb_build_object('id','w_near','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',1,'unit','days')),
    jsonb_build_object('id','t_near','type','send_sms','version',1,'config',jsonb_build_object('body','A day','purpose','informational'))),
  'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','t_now'),
    jsonb_build_object('id','b','source','t_now','target','w_near'),jsonb_build_object('id','c','source','w_near','target','t_near'))));
select pg_temp.only8(366);
select pg_temp.book8(288,'T');
select pg_temp.events(25);
select pg_temp.save(288,'status=''Completed''');
select pg_temp.pass8();
select pg_temp.hold_aged8(366,288);
select pg_temp.pass8();
select pg_temp.ok(pg_temp.given8(366,288)='none'
    and pg_temp.trip(366,288)='stopped:Stopped after 7 days on hold: Refused at handoff: The appointment has an outcome recorded@t_now',
  'lead 288: the text at once, held by Completed for seven days, ends the run: '||pg_temp.trip(366,288));
select pg_temp.save(288,'status=''Scheduled''');
select pg_temp.pass8();
select pg_temp.all8(366,288);
select pg_temp.ok(pg_temp.given8(366,288)='t_now@T, t_near@T' and pg_temp.trip(366,288)='completed:-@t_near',
  'taken back two weeks before the start, the held text goes out once and the reminder a day before follows: '
    ||pg_temp.given8(366,288)||' / '||pg_temp.trip(366,288));

-- Lead 289: a run whose first text the provider rejected (the run failed, nothing reached the customer at Ta) holds no
-- time. Two texts, two days and a day before (skipped when passed); Ta is 5 days out and Tb 8 days. Cancelled, moved to
-- Tb while cancelled and reopened: a new run gives Tb both texts. Cancelled, moved back to Ta while cancelled and
-- reopened: a new run starts at Ta, which does not send the rejected text again and sends t2. Before the failed run
-- stopped holding its time, Ta got none of its reminders.
insert into times8 values (289,'Ta',date_trunc('minute',clock_timestamp())+interval '5 days'),
  (289,'Tb',date_trunc('minute',clock_timestamp())+interval '8 days');
select pg_temp.publish(368,369,'Two texts (the first rejected)',pg_temp.g8_two('skip'));
select pg_temp.only8(368);
select pg_temp.book8(289,'Ta');
select pg_temp.pass8();
insert into hold8 values (pg_temp.id(289),'t1','fail');
select pg_temp.due8(368,289);
delete from hold8;
select pg_temp.ok(pg_temp.given8(368,289)='none' and pg_temp.trip(368,289)='failed:The provider did not accept this message (suite)@t1',
  'lead 289: the provider rejects the first text and the run fails: '||pg_temp.trip(368,289));
select pg_temp.away8(289,'Tb');
select pg_temp.all8(368,289);
select pg_temp.away8(289,'Ta');
select pg_temp.all8(368,289);
-- Changed by the reminder record: the failed run still holds no time, so Ta gets its run, but the text the provider
-- rejected there with no retryable code is not sent again ('Not sent again: delivery failed for this appointment time
-- and cannot be retried'); t2 goes out (was t1@Tb, t2@Tb, t1@Ta, t2@Ta). The rejection here is the synthetic driver's
-- 'fail', an intent marked failed with no failed dispatch or message, which the record counts as a confirmed failure
-- with no code (amendment A7), so the reason is pinned too.
select pg_temp.ok(pg_temp.given8(368,289)='t1@Tb, t2@Tb, t2@Ta'
    and (select s.reason from private.automation_steps s join private.automation_runs r on r.id=s.run_id
      where r.workflow_id=pg_temp.id(368) and r.contact_id=pg_temp.id(289) and r.status='completed' and s.node_id='t1'
        and r.reminded_for in (select o.id from private.appointment_occurrences o
          where o.scheduled_start=(select t.at from times8 t where t.n=289 and t.k='Ta')))
      ='Not sent again: delivery failed for this appointment time and cannot be retried',
  'back at Ta, which the failed run gave nothing, a run starts there; its rejected t1 is not sent again and t2 goes out: '
    ||pg_temp.given8(368,289)||' / '||pg_temp.trip(368,289));

-- Leads 290 and 291: a person's stop holds each time the appointment stood at when the run gave something, a text dated
-- by its handoff. Plain texts; T1 is 8 days out, T2 6 days and T3 7 days. 290: the first text is first leased at T1 and
-- held (sending hours); an ordinary move to T2; it goes out at T2, and its handoff records its message row; an ordinary
-- move to T3; an Admin stops the run; cancelled, moved to T2 while cancelled and reopened: T2 gets nothing again.
-- Before this change the text was dated by its first lease (at T1), so T2 started over and got the text again. 291
-- (Pins): with no message row, as with synthetic transports, a text first leased and sent at T2 is dated by its lease.
insert into times8 select n,'T1',date_trunc('minute',clock_timestamp())+interval '8 days' from generate_series(290,291) n;
insert into times8 select n,'T2',date_trunc('minute',clock_timestamp())+interval '6 days' from generate_series(290,291) n;
insert into times8 select n,'T3',date_trunc('minute',clock_timestamp())+interval '7 days' from generate_series(290,291) n;
insert into rows8 values (pg_temp.id(290));
select pg_temp.publish(370,371,'Plain texts (dated by the handoff)',pg_temp.g8_plain('text'));
select pg_temp.only8(370);
select pg_temp.book8(n,'T1') from generate_series(290,291) n;
select pg_temp.pass8();
insert into hold8 values (pg_temp.id(290),'q1','hold');
select pg_temp.due8(370,290);
select pg_temp.save(n,pg_temp.at8(n,'T2')) from generate_series(290,291) n;
select pg_temp.pass8();
delete from hold8;
select pg_temp.due8(370,290);
select pg_temp.due8(370,291);
select pg_temp.ok(pg_temp.given8(370,290)='q1@T2' and pg_temp.given8(370,291)='q1@T2'
    and (select count(*) from private.automation_messages m join private.automation_runs r on r.id=m.run_id
      where r.workflow_id=pg_temp.id(370) and r.contact_id=pg_temp.id(290))=1
    and (select count(*) from private.automation_messages m join private.automation_runs r on r.id=m.run_id
      where r.workflow_id=pg_temp.id(370) and r.contact_id=pg_temp.id(291))=0,
  'leads 290 and 291: the first text goes out at T2, with a message row for lead 290 only: '
    ||pg_temp.given8(370,290)||' / '||pg_temp.given8(370,291));
select pg_temp.save(n,pg_temp.at8(n,'T3')) from generate_series(290,291) n;
select pg_temp.pass8();
select pg_temp.admin_stop(370,n) from generate_series(290,291) n;
select pg_temp.away8(n,'T2') from generate_series(290,291) n;
select pg_temp.all8(370,n) from generate_series(290,291) n;
select pg_temp.ok(pg_temp.given8(370,290)='q1@T2' and pg_temp.trip(370,290)='stopped:Stopped by user@qb',
  'lead 290: the stop holds T2, where the held text went out by its handoff: '||pg_temp.given8(370,290)||' / '||pg_temp.trip(370,290));
select pg_temp.ok(pg_temp.given8(370,291)='q1@T2' and pg_temp.trip(370,291)='stopped:Stopped by user@qb',
  'Pins: lead 291, with no message row the text is dated by its first lease, at T2: '
    ||pg_temp.given8(370,291)||' / '||pg_temp.trip(370,291));

-- Lead 292 (Pins): a text the hold kept from going out was not given. A text a day before; booked at T1 (5 days out);
-- the text is leased and held, and seven days on hold end the run with its intent still prepared. An ordinary move to
-- T2 (T1 and 12 hours) starts a run that gives the text there. Cancelled, moved back to T1 while cancelled and reopened:
-- the stopped run is not the latest and gave nothing, so T1 gets the text once.
insert into times8 values (292,'T1',date_trunc('minute',clock_timestamp())+interval '5 days'),
  (292,'T2',date_trunc('minute',clock_timestamp())+interval '5 days 12 hours');
select pg_temp.publish(372,373,'A text a day before (a prepared intent)',jsonb_build_object('format',1,
  'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','w1','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',1,'unit','days')),
    jsonb_build_object('id','text','type','send_sms','version',1,'config',jsonb_build_object('body','A day before','purpose','informational'))),
  'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','w1'),jsonb_build_object('id','b','source','w1','target','text'))));
select pg_temp.only8(372);
select pg_temp.book8(292,'T1');
select pg_temp.pass8();
insert into hold8 values (pg_temp.id(292),'text','hold');
select pg_temp.due8(372,292);
select pg_temp.hold_aged8(372,292);
select pg_temp.pass8();
delete from hold8;
select pg_temp.ok(pg_temp.trip(372,292)='stopped:Stopped after 7 days on hold: Outside sending hours (suite)@text'
    and (select string_agg(i.status,',') from private.automation_intents i join private.automation_runs r on r.id=i.run_id
      where r.workflow_id=pg_temp.id(372) and r.contact_id=pg_temp.id(292))='prepared',
  'Pins: lead 292, the hold ends the run with the text''s intent still prepared: '||pg_temp.trip(372,292));
select pg_temp.save(292,pg_temp.at8(292,'T2'));
select pg_temp.pass8();
select pg_temp.all8(372,292);
select pg_temp.away8(292,'T1');
select pg_temp.all8(372,292);
select pg_temp.ok(pg_temp.given8(372,292)='text@T2, text@T1',
  'Pins: back at T1, the text the hold kept from going out goes out once: '||pg_temp.given8(372,292)||' / '||pg_temp.trip(372,292));

-- Lead 293 (Pins): a person's stop holds the time the appointment stood at when the run handed a text to a provider.
-- A plain wait of an hour, text ta, a day before, text tb. Booked at T1 (5 days out): ta goes out at T1. An ordinary move
-- to T2 (T1 and 12 hours) while the run waits for tb (it keeps its place); an Admin stops it there. Cancelled, moved back
-- to T1 while cancelled and reopened: T1, where ta went out, gets nothing again.
insert into times8 values (293,'T1',date_trunc('minute',clock_timestamp())+interval '5 days'),
  (293,'T2',date_trunc('minute',clock_timestamp())+interval '5 days 12 hours');
select pg_temp.publish(374,375,'An hour, text, a day before, text (a stop after a text)',pg_temp.g8_both('hours'));
select pg_temp.only8(374);
select pg_temp.book8(293,'T1');
select pg_temp.pass8();
select pg_temp.due8(374,293);
select pg_temp.save(293,pg_temp.at8(293,'T2'));
select pg_temp.pass8();
select pg_temp.admin_stop(374,293);
select pg_temp.away8(293,'T1');
select pg_temp.all8(374,293);
select pg_temp.ok(pg_temp.given8(374,293)='ta@T1' and pg_temp.trip(374,293)='stopped:Stopped by user@w1',
  'Pins: lead 293, back at T1, where the stopped run handed off ta, nothing is given again: '
    ||pg_temp.given8(374,293)||' / '||pg_temp.trip(374,293));

-- Lead 294 (Pins): the carry-on takes up a run with no appointment wait at the time the appointment stood at when it
-- was stopped, also when another run holds that time. Plain texts; T2 is 5 days out and T1 6 days. Booked at T2; an Admin
-- stops the first run before it gives anything (it holds T2). An ordinary move to T1 starts a run, which gives q1 there.
-- An ordinary move back to T2 (the run keeps its place), then a cancellation taken back on the same slot: the run
-- followed T2, so it carries on there, and the Admin's stop of the first run, which holds T2, skips q2.
insert into times8 values (294,'T2',date_trunc('minute',clock_timestamp())+interval '5 days'),
  (294,'T1',date_trunc('minute',clock_timestamp())+interval '6 days');
select pg_temp.publish(376,377,'Plain texts (a run that followed by a move)',pg_temp.g8_plain('text'));
select pg_temp.only8(376);
select pg_temp.book8(294,'T2');
select pg_temp.pass8();
select pg_temp.admin_stop(376,294);
select pg_temp.save(294,pg_temp.at8(294,'T1'));
select pg_temp.pass8();
select pg_temp.due8(376,294);
select pg_temp.save(294,pg_temp.at8(294,'T2'));
select pg_temp.pass8();
select pg_temp.save(294,'status=''Cancelled''');
select pg_temp.pass8();
select pg_temp.save(294,'status=''Scheduled''');
select pg_temp.pass8();
select pg_temp.all8(376,294);
-- Changed by the reminder record: the Admin's stop of the first run holds T2, also after the appointment moved away and
-- back there, so the carried-on run skips q2 at T2 and completes (was q1@T1, q2@T2 and completed:-@q2).
select pg_temp.ok(pg_temp.given8(376,294)='q1@T1'
    and pg_temp.trip(376,294)='stopped:Stopped by user@qa; completed:Stopped by a person for this appointment time@q2',
  'Pins: lead 294, the run that followed T2 by an ordinary move carries on there after the cancellation is taken back: '
    ||pg_temp.given8(376,294)||' / '||pg_temp.trip(376,294));

-- Lead 295 (Pins): without a reopening, the move back's rule for later runs is unchanged. Two texts, sent late; T1 is
-- 47 hours out and T2 30 hours. Booked at T1 (t1 goes out); an ordinary move to T2 starts over and t1 goes out there; an
-- Admin stops that run; an ordinary move back to T1: the stopped run gave T2 a text, so the earlier run does not carry
-- on, and the automation starts over for T1 (the ordinary-move decision, as in lead 262).
insert into times8 values (295,'T1',date_trunc('minute',clock_timestamp())+interval '47 hours'),
  (295,'T2',date_trunc('minute',clock_timestamp())+interval '30 hours');
select pg_temp.publish(378,379,'Two texts, late (an ordinary move back)',pg_temp.g8_two('continue'));
select pg_temp.only8(378);
select pg_temp.book8(295,'T1');
select pg_temp.pass8();
select pg_temp.save(295,pg_temp.at8(295,'T2'));
select pg_temp.pass8();
select pg_temp.admin_stop(378,295);
select pg_temp.save(295,pg_temp.at8(295,'T1'));
select pg_temp.pass8();
select pg_temp.all8(378,295);
-- Changed by the reminder record: the run that starts over for T1 skips t1, which T1 already got, and sends t2 (was
-- t1@T1, t1@T2, t1@T1, t2@T1).
select pg_temp.ok(pg_temp.given8(378,295)='t1@T1, t1@T2, t2@T1'
    and pg_temp.trip(378,295)='stopped:Appointment was rescheduled@w2; stopped:Stopped by user@w2; completed:-@t2',
  'Pins: lead 295, an ordinary move back after a later run gave another time a text starts over: '
    ||pg_temp.given8(378,295)||' / '||pg_temp.trip(378,295));

-- Lead 296 (Pins): once the appointment has started, the outcome does not hold a follow-up timed after the start. A
-- plain wait of three minutes, then a text. Booked 3 days out; the slot's start is then moved, as a fixture, to a moment
-- after the booking that has passed (as if the appointment had started; the change log and the slot record keep their
-- triggers off for that one write); the person marks it Completed; the wait ends; the text goes out.
insert into times8 values (296,'T',date_trunc('minute',clock_timestamp())+interval '3 days');
select pg_temp.publish(380,381,'Follow-up after the start',jsonb_build_object('format',1,
  'settings',jsonb_build_object('reentry','once','stop_on_reply',false),
  'nodes',jsonb_build_array(jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','pause','type','wait','version',1,'config',jsonb_build_object('duration',3,'unit','minutes')),
    jsonb_build_object('id','f_text','type','send_sms','version',1,'config',jsonb_build_object('body','Thanks','purpose','informational'))),
  'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','pause'),jsonb_build_object('id','b','source','pause','target','f_text'))));
select pg_temp.only8(380);
select pg_temp.book8(296,'T');
select pg_temp.pass8();
update times8 set at=(select e.occurred_at+(clock_timestamp()-e.occurred_at)/2 from private.automation_events e
  where e.event_type='appointment_booked' and e.subject->>'appointment_id'=(select id::text from booked where n=296)
  order by e.id limit 1) where n=296 and k='T';
alter table public.appointments disable trigger user;
alter table private.appointment_occurrences disable trigger appointment_occurrences_append_only;
update public.appointments set start_time=(select at from times8 where n=296 and k='T') where id=(select id from booked where n=296);
update private.appointment_occurrences set scheduled_start=(select at from times8 where n=296 and k='T')
  where appointment_id=(select id from booked where n=296) and closed_at is null;
alter table private.appointment_occurrences enable trigger appointment_occurrences_append_only;
alter table public.appointments enable trigger user;
select pg_temp.save(296,'status=''Completed''');
select pg_temp.events(25);
update private.automation_runs set due_at=clock_timestamp() where workflow_id=pg_temp.id(380) and contact_id=pg_temp.id(296)
  and status='waiting';
select pg_temp.pass8();
select pg_temp.ok(pg_temp.given8(380,296)='f_text@T' and pg_temp.trip(380,296)='completed:-@f_text',
  'Pins: lead 296, after the start a follow-up timed after it goes out although the appointment is marked Completed: '
    ||pg_temp.given8(380,296)||' / '||pg_temp.trip(380,296));
update public.workflows set status='paused' where id=pg_temp.id(380);
select pg_temp.retire();

-- Leads 297 to 308: the ninth pass's fix, and pins for the scenarios the eighth pass's verifiers wrote against the
-- seven-day hold's take-back, the stranded run and the dating of a given text. Of these 21 checks, 1 failed before this
-- change (lead 297's last); 12 are marked "Pins" and pass before it too; the other 8 set a lead up or report a step on
-- the way, and pass before it too. Lead 308's Pin fails with the eighth pass's tested take-back clause alone (without
-- the check that no other booking run holds the time). The section uses the helpers of leads 274 to 296 (step8, pass8,
-- all8 and given8).
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
select pg_temp.retire();
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),pg_temp.id(11),pg_temp.id(11) from generate_series(297,308) n;
-- No step was given twice for one time (the step and its slot's start) to the lead on the automation.
create function pg_temp.once8(workflow_n integer, lead_n integer) returns boolean language sql as $$
  select not exists (select 1 from given8 g where g.workflow_id=pg_temp.id(workflow_n) and g.contact_id=pg_temp.id(lead_n)
    group by g.node_id,g.slot_start having count(*)>1)
$$;
-- A text a day before the appointment, sent late when that time has passed.
create function pg_temp.g9_day(stop_on_reply boolean) returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',jsonb_build_object('reentry','once','stop_on_reply',stop_on_reply),
    'nodes',jsonb_build_array(jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
      jsonb_build_object('id','until','type','wait_until_before_appointment','version',1,
        'config',jsonb_build_object('amount',1,'unit','days','late','continue')),
      jsonb_build_object('id','text','type','send_sms','version',1,'config',jsonb_build_object('body','See you soon','purpose','informational'))),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','until'),
      jsonb_build_object('id','b','source','until','target','text')))
$$;

-- Leads 297 and 298 (verifier v3's S5): the seven-day hold's take-back for a run with neither an appointment wait nor
-- reminders. Plain texts (a plain wait of a day, q1, a plain wait of a day, q2). 297: booked at T1 (8 days out); an
-- ordinary move to T2 (6 days), seen: the run follows it in place. A person marks the appointment Completed; q1 comes due
-- and the final send check holds it; held seven days, the hold ends the run. The person takes Completed back
-- (Scheduled), still before the start: the run stood at T2 when the hold ended it, so the carry-on takes it up there and
-- T2 gets q1 and q2 once. Before this change the carry-on read only the booking's slot, at T1, so nothing resumed and T2
-- lost both texts. 298 (Pins): the same without the move (booked at T2).
insert into times8 select n,'T1',date_trunc('minute',clock_timestamp())+interval '8 days' from generate_series(297,298) n;
insert into times8 select n,'T2',date_trunc('minute',clock_timestamp())+interval '6 days' from generate_series(297,298) n;
select pg_temp.publish(382,383,'Plain texts (the outcome hold after a move in place)',pg_temp.g8_plain('text'));
select pg_temp.only8(382);
select pg_temp.book8(297,'T1');
select pg_temp.book8(298,'T2');
select pg_temp.pass8();
select pg_temp.save(297,pg_temp.at8(297,'T2'));
select pg_temp.pass8();
select pg_temp.save(n,'status=''Completed''') from generate_series(297,298) n;
select pg_temp.pass8();
select pg_temp.due8(382,n) from generate_series(297,298) n;
select pg_temp.hold_aged8(382,n) from generate_series(297,298) n;
select pg_temp.pass8();
select pg_temp.ok(pg_temp.given8(382,297)='none'
    and pg_temp.trip(382,297)='stopped:Stopped after 7 days on hold: Refused at handoff: The appointment has an outcome recorded@q1',
  'lead 297: moved in place, then q1 held by Completed for seven days ends the run: '||pg_temp.trip(382,297));
select pg_temp.ok(pg_temp.given8(382,298)='none'
    and pg_temp.trip(382,298)='stopped:Stopped after 7 days on hold: Refused at handoff: The appointment has an outcome recorded@q1',
  'lead 298: q1 held by Completed for seven days ends the run: '||pg_temp.trip(382,298));
select pg_temp.save(n,'status=''Scheduled''') from generate_series(297,298) n;
select pg_temp.pass8();
select pg_temp.all8(382,n) from generate_series(297,298) n;
select pg_temp.ok(pg_temp.given8(382,297)='q1@T2, q2@T2' and pg_temp.trip(382,297)='completed:-@q2',
  'lead 297: Completed taken back after the hold, the run that followed the move in place carries on at T2: '
    ||pg_temp.given8(382,297)||' / '||pg_temp.trip(382,297));
select pg_temp.ok(pg_temp.given8(382,298)='q1@T2, q2@T2' and pg_temp.trip(382,298)='completed:-@q2',
  'Pins: lead 298, not moved, the run carries on at its booking''s time: '||pg_temp.given8(382,298)||' / '||pg_temp.trip(382,298));

-- Lead 299 (verifier v3's S6 916): only the outcome hold's stop is taken up. A text a day before, sent late; booked 3
-- days out. The text is held for another reason (sending hours) for seven days, so the hold ends the run; a person
-- cancels and reopens the appointment on the same slot. The stopped run is the latest booking run and holds its time,
-- and the carry-on does not take up a hold stop for another reason, so nothing goes out.
insert into times8 values (299,'T',date_trunc('minute',clock_timestamp())+interval '3 days');
select pg_temp.publish(384,385,'Text a day before (held for sending hours)',pg_temp.g9_day(false));
select pg_temp.only8(384);
select pg_temp.book8(299,'T');
select pg_temp.pass8();
insert into hold8 values (pg_temp.id(299),'text','hold');
select pg_temp.due8(384,299);
select pg_temp.hold_aged8(384,299);
select pg_temp.pass8();
delete from hold8;
select pg_temp.ok(pg_temp.trip(384,299)='stopped:Stopped after 7 days on hold: Outside sending hours (suite)@text',
  'lead 299: held for sending hours for seven days, the hold ends the run: '||pg_temp.trip(384,299));
select pg_temp.save(299,'status=''Cancelled''');
select pg_temp.pass8();
select pg_temp.save(299,'status=''Scheduled''');
select pg_temp.pass8();
select pg_temp.all8(384,299);
select pg_temp.ok(pg_temp.given8(384,299)='none'
    and pg_temp.trip(384,299)='stopped:Stopped after 7 days on hold: Outside sending hours (suite)@text',
  'Pins: lead 299, cancelled and reopened, a hold stop for another reason is not carried on: '
    ||pg_temp.given8(384,299)||' / '||pg_temp.trip(384,299));

-- Lead 300 (verifier v3's S7 918): each text is dated by its own handoff. Three plain texts, each after a plain wait of
-- a day; every handoff records its message row. Booked at T0 (9 days out); ordinary moves, each seen: to T1 (8 days),
-- where q1 goes out; to T2 (7 days), where q2 goes out; to T3 (6 days), where an Admin stops the run. Cancelled, moved
-- to T1 while cancelled and reopened: the stop holds T1, where q1 went out, so nothing is given again there.
insert into times8 values (300,'T0',date_trunc('minute',clock_timestamp())+interval '9 days'),
  (300,'T1',date_trunc('minute',clock_timestamp())+interval '8 days'),(300,'T2',date_trunc('minute',clock_timestamp())+interval '7 days'),
  (300,'T3',date_trunc('minute',clock_timestamp())+interval '6 days');
insert into rows8 values (pg_temp.id(300));
select pg_temp.publish(386,387,'Three plain texts (dated by each handoff)',jsonb_build_object('format',1,
  'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','qa','type','wait','version',1,'config',jsonb_build_object('duration',1,'unit','days')),
    jsonb_build_object('id','q1','type','send_sms','version',1,'config',jsonb_build_object('body','First','purpose','informational')),
    jsonb_build_object('id','qb','type','wait','version',1,'config',jsonb_build_object('duration',1,'unit','days')),
    jsonb_build_object('id','q2','type','send_sms','version',1,'config',jsonb_build_object('body','Second','purpose','informational')),
    jsonb_build_object('id','qc','type','wait','version',1,'config',jsonb_build_object('duration',1,'unit','days')),
    jsonb_build_object('id','q3','type','send_sms','version',1,'config',jsonb_build_object('body','Third','purpose','informational'))),
  'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','qa'),
    jsonb_build_object('id','b','source','qa','target','q1'),jsonb_build_object('id','c','source','q1','target','qb'),
    jsonb_build_object('id','d','source','qb','target','q2'),jsonb_build_object('id','e','source','q2','target','qc'),
    jsonb_build_object('id','f','source','qc','target','q3'))));
select pg_temp.only8(386);
select pg_temp.book8(300,'T0');
select pg_temp.pass8();
select pg_temp.save(300,pg_temp.at8(300,'T1'));
select pg_temp.pass8();
select pg_temp.due8(386,300);
select pg_temp.save(300,pg_temp.at8(300,'T2'));
select pg_temp.pass8();
select pg_temp.due8(386,300);
select pg_temp.save(300,pg_temp.at8(300,'T3'));
select pg_temp.pass8();
select pg_temp.admin_stop(386,300);
select pg_temp.away8(300,'T1');
select pg_temp.all8(386,300);
select pg_temp.ok(pg_temp.given8(386,300)='q1@T1, q2@T2' and pg_temp.trip(386,300)='stopped:Stopped by user@qc',
  'Pins: lead 300, the stop holds T1, where q1 went out by its own handoff: '||pg_temp.given8(386,300)||' / '||pg_temp.trip(386,300));

-- Lead 301 (verifier v3's S9b 922): the outcome hold's stop is taken up only at a time the run followed. Plain texts;
-- booked at T1 (6 days out): q1 goes out after a day. Completed is recorded; q2 comes due and is held seven days, so the
-- hold ends the run. The person changes Completed to Cancelled, moves the appointment to T2 (8 days) while cancelled and
-- reopens it there: a new time the run did not follow, so the automation starts over there (q1 and q2 for T2).
insert into times8 values (301,'T1',date_trunc('minute',clock_timestamp())+interval '6 days'),
  (301,'T2',date_trunc('minute',clock_timestamp())+interval '8 days');
select pg_temp.publish(388,389,'Plain texts (the outcome hold, then a new time by a reopening)',pg_temp.g8_plain('text'));
select pg_temp.only8(388);
select pg_temp.book8(301,'T1');
select pg_temp.pass8();
select pg_temp.due8(388,301);
select pg_temp.save(301,'status=''Completed''');
select pg_temp.pass8();
select pg_temp.due8(388,301);
select pg_temp.hold_aged8(388,301);
select pg_temp.pass8();
select pg_temp.ok(pg_temp.given8(388,301)='q1@T1'
    and pg_temp.trip(388,301)='stopped:Stopped after 7 days on hold: Refused at handoff: The appointment has an outcome recorded@q2',
  'lead 301: q2 held by Completed for seven days ends the run: '||pg_temp.given8(388,301)||' / '||pg_temp.trip(388,301));
select pg_temp.away8(301,'T2');
select pg_temp.all8(388,301);
select pg_temp.ok(pg_temp.given8(388,301)='q1@T1, q1@T2, q2@T2',
  'Pins: lead 301, reopened at a time the stopped run did not follow, the automation starts over there: '
    ||pg_temp.given8(388,301)||' / '||pg_temp.trip(388,301));

-- Leads 302 and 303 (verifier v3's S2): the seven-day hold ends a run while No Show is recorded before the start. A text
-- a day before, sent late; booked 3 days out. 302: the person changes No Show to Cancelled and reopens the appointment
-- (Scheduled) on the same slot, still before the start: the outcome is no longer in effect, so the carry-on takes the run
-- up and the text goes out once (the reopening starts nothing more). 303: the automation stops on a reply; a verified
-- reply comes after the hold ended the run, and the person then takes No Show back (Scheduled): nothing goes out.
insert into times8 values (302,'T',date_trunc('minute',clock_timestamp())+interval '3 days'),
  (303,'T',date_trunc('minute',clock_timestamp())+interval '3 days');
select pg_temp.publish(390,391,'Text a day before (No Show, then Cancelled and reopened)',pg_temp.g9_day(false));
select pg_temp.only8(390);
select pg_temp.book8(302,'T');
select pg_temp.pass8();
select pg_temp.save(302,'status=''No Show''');
select pg_temp.due8(390,302);
select pg_temp.hold_aged8(390,302);
select pg_temp.pass8();
select pg_temp.ok(pg_temp.given8(390,302)='none'
    and pg_temp.trip(390,302)='stopped:Stopped after 7 days on hold: Refused at handoff: The appointment has an outcome recorded@text',
  'lead 302: the text held by No Show for seven days ends the run: '||pg_temp.trip(390,302));
select pg_temp.save(302,'status=''Cancelled''');
select pg_temp.pass8();
select pg_temp.save(302,'status=''Scheduled''');
select pg_temp.pass8();
select pg_temp.all8(390,302);
select pg_temp.ok(pg_temp.given8(390,302)='text@T' and pg_temp.trip(390,302)='completed:-@text' and pg_temp.once8(390,302),
  'Pins: lead 302, No Show changed to Cancelled and reopened after the hold, the text goes out once: '
    ||pg_temp.given8(390,302)||' / '||pg_temp.trip(390,302));
select pg_temp.publish(392,393,'Text a day before, stops on a reply (No Show taken back after a reply)',pg_temp.g9_day(true));
select pg_temp.only8(392);
select pg_temp.book8(303,'T');
select pg_temp.pass8();
select pg_temp.save(303,'status=''No Show''');
select pg_temp.due8(392,303);
select pg_temp.hold_aged8(392,303);
select pg_temp.pass8();
select pg_temp.reply(303);
select pg_temp.save(303,'status=''Scheduled''');
select pg_temp.pass8();
select pg_temp.all8(392,303);
select pg_temp.ok(pg_temp.given8(392,303)='none'
    and pg_temp.trip(392,303)='stopped:Stopped after 7 days on hold: Refused at handoff: The appointment has an outcome recorded@text',
  'Pins: lead 303, a verified reply after the hold ended the run keeps it ended when No Show is taken back: '
    ||pg_temp.given8(392,303)||' / '||pg_temp.trip(392,303));

-- Leads 304 and 305 (verifier v3's S1): a stranded run carried on to a new time gives that time only its remaining
-- steps. Both waits (a plain wait of a day, ta, a day before, tb). Booked at T2 (5 days out): the first run gives ta and
-- tb and finishes. An ordinary move to T3 (6 days): a second run gives ta and waits for tb. Cancelled, moved to T2 while
-- cancelled and reopened: the first run holds T2, so the second is passed over and stays stopped by the cancellation.
-- Then 304: an ordinary move of the standing appointment to T4 (7 days), which no booking run holds; 305: cancelled,
-- moved to T4 while cancelled and reopened. The second run carries on there from its step, so T4 gets tb only.
insert into times8 select n,'T2',date_trunc('minute',clock_timestamp())+interval '5 days' from generate_series(304,305) n;
insert into times8 select n,'T3',date_trunc('minute',clock_timestamp())+interval '6 days' from generate_series(304,305) n;
insert into times8 select n,'T4',date_trunc('minute',clock_timestamp())+interval '7 days' from generate_series(304,305) n;
select pg_temp.publish(394,395,'Plain wait, text, a day before, text (stranded, then another time)',pg_temp.g8_both('days'));
select pg_temp.only8(394);
select pg_temp.book8(n,'T2') from generate_series(304,305) n;
select pg_temp.pass8();
select pg_temp.all8(394,n) from generate_series(304,305) n;
select pg_temp.save(n,pg_temp.at8(n,'T3')) from generate_series(304,305) n;
select pg_temp.pass8();
select pg_temp.due8(394,n) from generate_series(304,305) n;
select pg_temp.away8(n,'T2') from generate_series(304,305) n;
select pg_temp.ok(pg_temp.given8(394,304)='ta@T2, tb@T2, ta@T3' and pg_temp.given8(394,305)='ta@T2, tb@T2, ta@T3'
    and pg_temp.trip(394,304)='completed:-@tb; stopped:Appointment was cancelled@w1' and pg_temp.trip(394,305)=pg_temp.trip(394,304),
  'leads 304 and 305: reopened at T2, which the first run holds, the second run stays stopped by the cancellation: '
    ||pg_temp.given8(394,304)||' / '||pg_temp.trip(394,304));
select pg_temp.save(304,pg_temp.at8(304,'T4'));
select pg_temp.pass8();
select pg_temp.away8(305,'T4');
select pg_temp.all8(394,n) from generate_series(304,305) n;
select pg_temp.ok(pg_temp.given8(394,304)='ta@T2, tb@T2, ta@T3, tb@T4' and pg_temp.once8(394,304)
    and pg_temp.trip(394,304)='completed:-@tb; completed:-@tb',
  'Pins: lead 304, an ordinary move to T4 carries the stranded run on from its step: '||pg_temp.given8(394,304)||' / '||pg_temp.trip(394,304));
select pg_temp.ok(pg_temp.given8(394,305)='ta@T2, tb@T2, ta@T3, tb@T4' and pg_temp.once8(394,305)
    and pg_temp.trip(394,305)='completed:-@tb; completed:-@tb',
  'Pins: lead 305, reopened at T4, the stranded run carries on from its step: '||pg_temp.given8(394,305)||' / '||pg_temp.trip(394,305));

-- Lead 306: the take-back after the seven-day hold depends on the hold's reason, which the final send check writes and
-- automation_finish_node prefixes. The text goes through the worker's channel as channel.ts takes it: the final send
-- check (automation_message_check) returns a reason, and the text is held with that reason as it is; a hold older than
-- seven days then ends the run through automation_finish_node. Each pattern the carry-on matches a hold's stop by
-- (automation_refresh_appointment_runs) must match the reason the run ended with, and the take-back must carry it on.
-- A text a day before, sent late; booked 3 days out; marked Completed before the text comes due.
create temporary table checked8(run_id uuid, node_id text, reason text, at timestamptz) on commit drop;
create function pg_temp.channel8() returns jsonb language plpgsql as $$
declare c jsonb; node jsonb; outcome text; why text;
begin
  select * into c from public.automation_claim_work(1);
  if c is null then return null; end if;
  select n into node from jsonb_array_elements(c#>'{graph,nodes}') n where n->>'id'=c->>'node_id';
  if node->>'type' in ('wait','wait_until_before_appointment') then
    outcome:=case when c->>'status'='waiting' then 'elapsed' else 'wait' end;
  elsif node->>'type'='send_sms' then
    why:=public.automation_message_check((c->>'run_id')::uuid,(c->>'lease_token')::uuid,c->>'node_id');
    insert into checked8 values ((c->>'run_id')::uuid,c->>'node_id',why,clock_timestamp());
    -- As channel.ts takes the check's answer: 'skip:' finishes the step as skipped, 'retry:' goes on to send.
    if why like 'skip:%' then
      outcome:='skipped'; why:=substr(why,6);
    else
      outcome:='held'; why:=coalesce(nullif(why,'retry:'),'Synthetic transport');
    end if;
  else
    outcome:='held'; why:='Synthetic transport';
  end if;
  perform public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,outcome,why);
  return c||jsonb_build_object('result',outcome,'reason',why);
end $$;
create function pg_temp.channel_pass8() returns void language plpgsql as $$
begin
  perform pg_temp.events(25);
  for i in 1..150 loop exit when pg_temp.channel8() is null; end loop;
  perform pg_temp.events(25);
end $$;
insert into times8 values (306,'T',date_trunc('minute',clock_timestamp())+interval '3 days');
select pg_temp.publish(396,397,'Text a day before (the reason of the outcome hold)',pg_temp.g9_day(false));
select pg_temp.only8(396);
select pg_temp.book8(306,'T');
select pg_temp.pass8();
select pg_temp.save(306,'status=''Completed''');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second'
  where workflow_id=pg_temp.id(396) and contact_id=pg_temp.id(306) and status='waiting';
select pg_temp.channel_pass8();
select pg_temp.ok((select string_agg(coalesce(k.reason,'null'),', ') from checked8 k)='The appointment has an outcome recorded'
    and pg_temp.trip(396,306)='held:The appointment has an outcome recorded@text',
  'lead 306: the final send check holds the text with its outcome reason: '||pg_temp.trip(396,306));
select pg_temp.hold_aged8(396,306);
select pg_temp.channel_pass8();
select pg_temp.ok((select r.reason from private.automation_runs r where r.workflow_id=pg_temp.id(396) and r.contact_id=pg_temp.id(306))
      ='Stopped after 7 days on hold: '||(select k.reason from checked8 k order by k.at desc limit 1)
    and (select count(*)>0 and bool_and(r.reason like p.m[1]) from private.automation_runs r,
      regexp_matches(pg_get_functiondef('private.automation_refresh_appointment_runs(uuid,text)'::regprocedure),
        'r\.reason LIKE ''(Stopped after 7 days on hold:[^'']*)''','g') p(m)
      where r.workflow_id=pg_temp.id(396) and r.contact_id=pg_temp.id(306) and r.status='stopped'),
  'Pins: lead 306, the run the seven-day hold ended carries the final send check''s reason, which the carry-on''s patterns match: '
    ||pg_temp.trip(396,306));
select pg_temp.save(306,'status=''Scheduled''');
select pg_temp.pass8();
select pg_temp.all8(396,306);
select pg_temp.ok(pg_temp.given8(396,306)='text@T' and pg_temp.trip(396,306)='completed:-@text',
  'Pins: lead 306, Completed taken back after the hold, the text goes out once: '||pg_temp.given8(396,306)||' / '||pg_temp.trip(396,306));

-- Lead 307 (Pins): a failed run holds its time once a text it gave has an unknown provider outcome. Two texts, two days
-- and a day before (skipped when passed); Ta is 5 days out and Tb 8 days. t1 goes out at Ta and its provider outcome is
-- then unknown (as when the provider's answer never came); the provider rejects t2, so the run fails. Cancelled, moved to
-- Tb while cancelled and reopened: a new run gives Tb both texts. Cancelled, moved back to Ta while cancelled and
-- reopened: the failed run holds Ta, where t1 may have reached the customer, so nothing is given again there.
insert into times8 values (307,'Ta',date_trunc('minute',clock_timestamp())+interval '5 days'),
  (307,'Tb',date_trunc('minute',clock_timestamp())+interval '8 days');
select pg_temp.publish(398,399,'Two texts (an unknown outcome, then a rejection)',pg_temp.g8_two('skip'));
select pg_temp.only8(398);
select pg_temp.book8(307,'Ta');
select pg_temp.pass8();
select pg_temp.due8(398,307);
update private.automation_intents set status='unknown' where node_id='t1' and run_id=(select r.id from private.automation_runs r
  where r.workflow_id=pg_temp.id(398) and r.contact_id=pg_temp.id(307));
insert into hold8 values (pg_temp.id(307),'t2','fail');
select pg_temp.due8(398,307);
delete from hold8;
select pg_temp.ok(pg_temp.given8(398,307)='t1@Ta' and pg_temp.trip(398,307)='failed:The provider did not accept this message (suite)@t2',
  'lead 307: t1 goes out at Ta, then the provider rejects t2 and the run fails: '||pg_temp.given8(398,307)||' / '||pg_temp.trip(398,307));
select pg_temp.away8(307,'Tb');
select pg_temp.all8(398,307);
select pg_temp.away8(307,'Ta');
select pg_temp.all8(398,307);
select pg_temp.ok(pg_temp.given8(398,307)='t1@Ta, t1@Tb, t2@Tb',
  'Pins: lead 307, back at Ta, the failed run whose t1 has an unknown outcome holds Ta: '||pg_temp.given8(398,307)||' / '||pg_temp.trip(398,307));
update public.workflows set status='paused' where id=pg_temp.id(398);
select pg_temp.retire();

-- Lead 308 (Pins): the take-back after the seven-day hold does not carry a run with no appointment wait on at a time
-- another booking run of the automation already holds. Plain texts. Booked at T2 (6 days out): the first run gives q1
-- and q2 at T2 and finishes. An ordinary move to T1 (8 days), seen: the automation starts over for T1. An ordinary move
-- back to T2, seen: the second run follows it in place. A person marks the appointment Completed; the second run's q1
-- is held seven days and the hold ends the run; the person takes Completed back (Scheduled), still before the start.
-- The first run holds T2, so the second stays ended and T2 keeps q1 and q2 once. The eighth pass's tested take-back
-- clause alone carried the second run on there and gave T2 both texts again.
insert into times8 values (308,'T2',date_trunc('minute',clock_timestamp())+interval '6 days'),
  (308,'T1',date_trunc('minute',clock_timestamp())+interval '8 days');
select pg_temp.publish(400,401,'Plain texts (moved back to a time an earlier run gave)',pg_temp.g8_plain('text'));
select pg_temp.only8(400);
select pg_temp.book8(308,'T2');
select pg_temp.pass8();
select pg_temp.all8(400,308);
select pg_temp.save(308,pg_temp.at8(308,'T1'));
select pg_temp.pass8();
select pg_temp.save(308,pg_temp.at8(308,'T2'));
select pg_temp.pass8();
select pg_temp.save(308,'status=''Completed''');
select pg_temp.pass8();
select pg_temp.due8(400,308);
select pg_temp.hold_aged8(400,308);
select pg_temp.pass8();
select pg_temp.save(308,'status=''Scheduled''');
select pg_temp.pass8();
select pg_temp.all8(400,308);
select pg_temp.ok(pg_temp.given8(400,308)='q1@T2, q2@T2' and pg_temp.once8(400,308)
    and pg_temp.trip(400,308)='completed:-@q2; stopped:Stopped after 7 days on hold: Refused at handoff: The appointment has an outcome recorded@q1',
  'Pins: lead 308, Completed taken back after the hold, a run that followed a move back to a time another run gave stays ended: '
    ||pg_temp.given8(400,308)||' / '||pg_temp.trip(400,308));
update public.workflows set status='paused' where id=pg_temp.id(400);
select pg_temp.retire();
-- Leads 309 to 366: the record of what a booking run gave for an appointment time (private.automation_given_steps):
-- for one organization, automation, appointment, start time and step, across runs. A step another run already gave at
-- that time is skipped; a text whose provider confirmed a retryable failure is retried at most once across all runs,
-- on a qualifying new run, while the retry window is open; a person's stop or a stop rule at a time holds that time on
-- an ordinary move away and back. These are the decisions approved on November 28. Each check is labelled "fix" (it
-- failed before this change) or "pin" (it passed before it too), with its case (A1 to L1) and what it checks. The checks
-- that need the record itself, or the receipt wrapper automation_record_provider_receipt, read them only when they
-- exist (to_regclass, to_regprocedure), so the section runs to its end without them and reports each such check as
-- failed; once they exist, those guards change nothing.
-- The worker here (rr_step) follows the worker's contract for automation_message_check (channel.ts): null is a first
-- attempt, 'retry:' a retry, 'skip:<reason>' finishes the step as skipped with that reason, and any other answer holds
-- it; a handoff that is refused, or that raises (as the record's own refusals do), asks automation_message_check again
-- and finishes skipped on a 'skip:' answer.
update public.workflows set status='paused' where organization_id=pg_temp.id(1) and status='active';
select pg_temp.retire();
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
insert into public.leads(id,organization_id,first_name,phone,email,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(1),'Lead '||n,'+1202555'||lpad(n::text,4,'0'),'lead'||n||'@example.invalid',pg_temp.id(11),
    pg_temp.id(11) from generate_series(309,366) n;
-- The planner is given statistics for what the suite has written so far, as a database in use has them (the suite is
-- one transaction, and this rolls back with it). Each part below does the same.
create function pg_temp.rr_analyze() returns void language plpgsql as $$
begin
  analyze private.automation_runs,private.automation_events,private.automation_steps,private.automation_intents,
    private.automation_messages,private.automation_task_receipts,private.automation_deferred_admissions,
    private.appointment_occurrences,private.appointment_evidence_observations,private.appointment_outcome_events,
    public.appointments,public.sms_dispatches,public.tasks,public.leads;
  if pg_temp.rr_has_ledger() then execute 'analyze private.automation_given_steps'; end if;
end $$;
-- The times each lead's appointment stands at, by name.
create temporary table rr_times(n integer, k text, at timestamptz, primary key(n,k)) on commit drop;
-- What the transport does with a lead's step: accept (no row), hold (sending hours), no_consent (the consent service
-- refuses), reject:<code> (the provider rejects the request with that code), timeout (no answer: uncertain), crash (the
-- worker stops right after the handoff), email_4xx (failed) or email_5xx (unknown).
create temporary table rr_plan(contact_id uuid, node_id text, action text, primary key(contact_id,node_id)) on commit drop;
-- Each handoff the worker made, and each task created, with the start of the slot its lease was for.
create temporary table rr_sent(organization_id uuid, workflow_id uuid, contact_id uuid, run_id uuid, node_id text, channel text,
  slot_start timestamptz, message_id uuid, retry boolean, outcome text, at timestamptz) on commit drop;
create temporary table rr_made(workflow_id uuid, contact_id uuid, run_id uuid, node_id text, slot_start timestamptz,
  at timestamptz) on commit drop;
-- Every answer of automation_message_check the worker was given, with what the final send check the handoff makes under
-- its lock (automation_message_issue) answered at that moment.
create temporary table rr_checks(run_id uuid, contact_id uuid, node_id text, answer text, at timestamptz, issue text)
  on commit drop;
create temporary table rr_leases(n integer primary key, lease jsonb) on commit drop;
-- A check, reported by label ("fix" or "pin", the case, and what it checks) and then asserted.
create function pg_temp.rr_ok(label text, passed boolean, message text) returns void language plpgsql as $$
begin
  raise notice 'rr % %: %', label, case when passed then 'pass' else 'FAIL' end, message;
  perform pg_temp.ok(passed, label||': '||message);
end $$;
create function pg_temp.rr_has_ledger() returns boolean language sql as $$
  select to_regclass('private.automation_given_steps') is not null
$$;
create function pg_temp.rr_has_wrapper() returns boolean language sql as $$
  select to_regprocedure('public.automation_record_provider_receipt(uuid,uuid,text,text,timestamptz,text,text)') is not null
$$;
create function pg_temp.rr_at(lead_n integer, k text) returns text language sql as $$
  select format('start_time=%L',(select t.at from rr_times t where t.n=lead_n and t.k=rr_at.k))
$$;
create function pg_temp.rr_book(lead_n integer, k text) returns void language sql as $$
  insert into booked select lead_n,pg_temp.book(2000+lead_n,lead_n,t.at),t.at from rr_times t where t.n=lead_n and t.k=rr_book.k
$$;
-- The automations in use are on, and every other one of the agency is off (its interval ended).
create function pg_temp.rr_only(variadic kept integer[]) returns void language plpgsql as $$
begin
  update public.workflows w set status='paused' where w.organization_id=pg_temp.id(1) and w.status='active'
    and w.id<>all(select pg_temp.id(k) from unnest(kept) k);
  perform pg_temp.retire();
end $$;
create function pg_temp.rr_check(run uuid, token uuid, node text, contact uuid) returns text language plpgsql as $$
declare answer text:=public.automation_message_check(run,token,node);
begin
  insert into rr_checks values (run,contact,node,answer,clock_timestamp(),
    (select private.automation_message_issue(r) from private.automation_runs r where r.id=run));
  return answer;
end $$;
-- One worker step. A message is checked (automation_message_check), then the worker's own checks before the handoff
-- refuse it for sending hours, the consent service, or a text to a number with a local opt-out or do-not-call entry (as
-- the sending path checks it). A refusal of a retry the lead can no longer receive finishes skipped ('Not retried: the
-- lead can no longer receive this message'); any other refusal, and a refused handoff, asks automation_message_check
-- again. A handoff that raises is undone and refused, as automation_begin_message's transaction is undone and the
-- worker then holds with the error (channel.ts). The handoff records the message row as automation_begin_message does,
-- and a text's dispatch as the sending path does (reserved, then accepted, rejected with its code, or uncertain). An
-- accepted message's receipt is recorded as channel.ts records it (automation_record_receipt), which advances the run. A
-- lease that ended after a handoff comes back for reconciliation and waits for the provider's receipt.
create function pg_temp.rr_step() returns jsonb language plpgsql as $$
declare c jsonb; node jsonb; made jsonb; outcome text; why text; answer text; action text; retry boolean:=false;
  run uuid; token uuid; nid text; contact uuid; org uuid; channel text; msg uuid; sid text; r private.automation_runs;
  starts timestamptz; handed boolean:=false; refusal text; phone text; raised text;
begin
  select * into c from public.automation_claim_work(1);
  if c is null then return null; end if;
  run:=(c->>'run_id')::uuid; token:=(c->>'lease_token')::uuid; nid:=c->>'node_id'; contact:=(c->>'contact_id')::uuid;
  org:=(c->>'organization_id')::uuid;
  if (c->>'uncertain_handoff')::boolean then
    perform public.automation_finish_node(run,token,'unknown','Awaiting the provider receipt');
    return c||jsonb_build_object('result','unknown');
  end if;
  select n into node from jsonb_array_elements(c#>'{graph,nodes}') n where n->>'id'=nid;
  select p.action into action from rr_plan p where p.contact_id=contact and p.node_id=nid;
  if node->>'type'='create_task' then
    made:=public.automation_create_task(run,token,nid,node#>>'{config,title}',node#>>'{config,notes}');
    outcome:=made->>'status'; why:=made->>'reason';
    if outcome='created' then
      insert into rr_made select x.workflow_id,x.contact_id,x.id,nid,o.scheduled_start,clock_timestamp()
        from private.automation_runs x left join private.appointment_occurrences o on o.id=x.leased_for where x.id=run;
    end if;
  elsif node->>'type' in ('wait','wait_until_before_appointment') then
    outcome:=case when c->>'status'='waiting' then 'elapsed' else 'wait' end;
  elsif node->>'type' in ('send_sms','send_email') then
    channel:=case node->>'type' when 'send_sms' then 'sms' else 'email' end;
    -- Each worker call is its own transaction in production; this suite runs in one, so a new intent is dated here.
    update private.automation_intents set created_at=clock_timestamp() where run_id=run and node_id=nid and created_at=now();
    answer:=pg_temp.rr_check(run,token,nid,contact);
    if answer like 'skip:%' then
      outcome:='skipped'; why:=substr(answer,6);
    elsif answer is not null and answer<>'retry:' then
      outcome:='held'; why:=answer;
    else
      retry:=answer is not distinct from 'retry:';
      select private.affinity_phone(l.phone) into phone from public.leads l where l.organization_id=org and l.id=contact;
      refusal:=case when action='hold' then 'HOURS' when action='no_consent' then 'NO_CONSENT'
        when channel='sms' and private.sms_recipient_guard(org,phone) then 'SMS_SUPPRESSED' end;
      if refusal is null then
        begin
          handed:=public.automation_authorize_handoff(run,token,nid);
        exception when others then
          handed:=false; raised:=sqlerrm;
        end;
      end if;
      if not handed then
        if retry and refusal in ('NO_CONSENT','SMS_SUPPRESSED') then
          outcome:='skipped'; why:='Not retried: the lead can no longer receive this message';
        else
          answer:=pg_temp.rr_check(run,token,nid,contact);
          if answer like 'skip:%' then
            outcome:='skipped'; why:=substr(answer,6);
          else
            outcome:='held'; why:=case refusal when 'HOURS' then 'Outside the recipient local sending window.'
              when 'NO_CONSENT' then 'Consent for this text could not be confirmed.'
              when 'SMS_SUPPRESSED' then 'This recipient has opted out of agency texts.'
              else coalesce(raised,'Run no longer permits a provider handoff.') end;
          end if;
        end if;
      else
        select * into r from private.automation_runs x where x.id=run;
        select o.scheduled_start into starts from private.appointment_occurrences o where o.id=r.leased_for;
        insert into private.automation_messages(organization_id,run_id,node_id,contact_id,contact_type,channel,recipient,sender,
            owner_id,body)
          values(r.organization_id,r.id,nid,r.contact_id,r.contact_type,channel,
            case channel when 'sms' then phone else 'lead-'||r.contact_id::text||'@example.invalid' end,
            case channel when 'sms' then '+12025559999' else 'reminders@example.invalid' end,pg_temp.id(11),'Suite')
          returning id into msg;
        insert into rr_sent values (r.organization_id,r.workflow_id,r.contact_id,r.id,nid,channel,starts,msg,retry,
          coalesce(action,'accept'),clock_timestamp());
        if channel='sms' then
          insert into public.sms_dispatches(organization_id,request_key,payload_hash,phone_e164,from_number,body,purpose,
              evidence_ids,state,contact_id,contact_type)
            values(r.organization_id,'automation:'||r.id||':'||nid,'suite',phone,'+12025559999','Suite','informational',
              '{}'::uuid[],'attempting',r.contact_id,r.contact_type);
        end if;
        if action='crash' then
          return c||jsonb_build_object('result','crash');
        elsif action like 'reject:%' then
          update public.sms_dispatches set state='failed',error_code=substr(action,8),updated_at=clock_timestamp()
            where organization_id=r.organization_id and request_key='automation:'||r.id||':'||nid;
          -- A provider block (21610) is recorded as the recipient's opt-out, as the sending path records it.
          if action='reject:21610' then
            insert into public.sms_suppressions(organization_id,phone_e164,reason,source_id)
              values(r.organization_id,phone,'provider_block','dispatch:automation:'||r.id||':'||nid) on conflict do nothing;
          end if;
          outcome:='failed'; why:='The provider did not accept this message.';
        elsif action='timeout' then
          update public.sms_dispatches set state='uncertain',error_code='transport_unknown',updated_at=clock_timestamp()
            where organization_id=r.organization_id and request_key='automation:'||r.id||':'||nid;
          outcome:='unknown'; why:='Delivery could not be confirmed. This message will not be sent again automatically.';
        elsif action='email_4xx' then
          outcome:='failed'; why:='Email provider returned HTTP 422.';
        elsif action='email_5xx' then
          outcome:='unknown'; why:='Email provider returned HTTP 503.';
        else
          sid:=case channel when 'sms' then 'SM'||md5(msg::text) else gen_random_uuid()::text end;
          if channel='sms' then
            update public.sms_dispatches set state='accepted',provider_sid=sid,provider_status='queued',updated_at=clock_timestamp()
              where organization_id=r.organization_id and request_key='automation:'||r.id||':'||nid;
          end if;
          perform public.automation_record_receipt(msg,channel,sid,'accepted',clock_timestamp(),null,r.organization_id);
          outcome:='accepted';
        end if;
      end if;
    end if;
  else
    outcome:='held'; why:='Synthetic transport';
  end if;
  perform public.automation_finish_node(run,token,outcome,why);
  return c||jsonb_build_object('result',outcome,'reason',why);
end $$;
-- The worker: events, every step that is due (nothing is forced), then events again.
create function pg_temp.rr_pass() returns void language plpgsql as $$
begin
  perform pg_temp.events(25);
  for i in 1..300 loop exit when pg_temp.rr_step() is null; end loop;
  perform pg_temp.events(25);
end $$;
-- Time passes for one automation's runs for a lead (its waiting and held runs are due now), then the worker runs.
create function pg_temp.rr_due(workflow_n integer, lead_n integer) returns void language plpgsql as $$
begin
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second'
    where workflow_id=pg_temp.id(workflow_n) and contact_id=pg_temp.id(lead_n) and status in ('waiting','held');
  perform pg_temp.rr_pass();
end $$;
-- Time passes until that automation has nothing left for the lead, or nothing changes any more (a step held for good).
create function pg_temp.rr_all(workflow_n integer, lead_n integer) returns void language plpgsql as $$
declare before text; after text;
begin
  for i in 1..12 loop
    exit when not exists (select 1 from private.automation_runs where workflow_id=pg_temp.id(workflow_n)
      and contact_id=pg_temp.id(lead_n) and status in ('queued','waiting','held'));
    before:=pg_temp.rr_runs(workflow_n,lead_n);
    perform pg_temp.rr_due(workflow_n,lead_n);
    after:=pg_temp.rr_runs(workflow_n,lead_n);
    exit when after=before and not exists (select 1 from private.automation_runs where workflow_id=pg_temp.id(workflow_n)
      and contact_id=pg_temp.id(lead_n) and status in ('queued','waiting'));
  end loop;
end $$;
-- An ordinary move to another time, where the run that starts over there hands off its first text when its reminder
-- time comes, and an ordinary move back, each seen.
create function pg_temp.rr_away_back(workflow_n integer, lead_n integer, away text, back text) returns void language plpgsql as $$
begin
  perform pg_temp.save(lead_n,pg_temp.rr_at(lead_n,away)); perform pg_temp.rr_pass();
  perform pg_temp.rr_due(workflow_n,lead_n);
  perform pg_temp.save(lead_n,pg_temp.rr_at(lead_n,back)); perform pg_temp.rr_pass();
end $$;
-- A person cancels, moves the appointment while it is cancelled to another time and back, and opens it again, each seen.
create function pg_temp.rr_reopen_via(lead_n integer, away text, back text) returns void language plpgsql as $$
begin
  perform pg_temp.save(lead_n,'status=''Cancelled'''); perform pg_temp.rr_pass();
  perform pg_temp.save(lead_n,pg_temp.rr_at(lead_n,away)); perform pg_temp.rr_pass();
  perform pg_temp.save(lead_n,pg_temp.rr_at(lead_n,back)); perform pg_temp.rr_pass();
  perform pg_temp.save(lead_n,'status=''Scheduled'''); perform pg_temp.rr_pass();
end $$;
-- A provider status callback for the text a run of the lead's on the automation handed off at a step (the run by its
-- position, 1 for the first), passed on as receiptHandler.ts passes it: MessageStatus mapped to a receipt state, the raw
-- MessageStatus and the ErrorCode. Without automation_record_provider_receipt (the base) only the state is recorded.
create function pg_temp.rr_receipt(workflow_n integer, lead_n integer, run_ord integer, node text, status text, code text)
returns void language plpgsql as $$
declare m private.automation_messages; state text:=case when status in ('delivered','read') then 'delivered'
  when status in ('failed','undelivered') then 'failed' else 'accepted' end; run private.automation_runs;
begin
  select r.* into strict run from private.automation_runs r where r.id=pg_temp.rr_run_id(workflow_n,lead_n,run_ord);
  select x.* into strict m from private.automation_messages x
    where x.organization_id=run.organization_id and x.run_id=run.id and x.node_id=node and x.channel='sms';
  if pg_temp.rr_has_wrapper() then
    perform public.automation_record_provider_receipt(m.id,m.organization_id,coalesce(m.provider_id,'SM'||md5(m.id::text)),
      state,clock_timestamp(),status,code);
  else
    perform public.automation_record_receipt(m.id,'sms',coalesce(m.provider_id,'SM'||md5(m.id::text)),state,clock_timestamp(),
      null,m.organization_id);
  end if;
end $$;
-- The lead's runs on the automation, by booking (1 is the first), and one of them by its position.
-- (Runs are ordered by their booking event's id, which a run keeps, so no reader joins the events. Readers drive from
-- the run's own keys: inside this one transaction the planner has no statistics for what the suite wrote.)
create function pg_temp.rr_ords(workflow_n integer, lead_n integer)
returns table(run_id uuid, organization_id uuid, ord bigint) language sql stable as $$
  select r.id,r.organization_id,row_number() over (order by r.event_id,r.id) from private.automation_runs r
  where r.workflow_id=pg_temp.id(workflow_n) and r.contact_id=pg_temp.id(lead_n)
$$;
create function pg_temp.rr_run_id(workflow_n integer, lead_n integer, ord integer) returns uuid language sql stable as $$
  select o.run_id from pg_temp.rr_ords(workflow_n,lead_n) o where o.ord=rr_run_id.ord
$$;
-- Readers. What the provider was handed for the lead on the automation, in order: the step, the name of the time its
-- lease was for, "+retry" when the database asked for a retry, and the transport's answer when it did not accept.
create function pg_temp.rr_sent(workflow_n integer, lead_n integer) returns text language sql as $$
  select coalesce(string_agg(s.node_id||'@'||coalesce((select t.k from rr_times t where t.n=lead_n and t.at=s.slot_start),'?')
      ||case when s.retry then '+retry' else '' end||case when s.outcome<>'accept' then '!'||s.outcome else '' end,', '
      order by s.at),'none')
  from rr_sent s where s.workflow_id=pg_temp.id(workflow_n) and s.contact_id=pg_temp.id(lead_n)
$$;
-- The tasks created for the lead on the automation, in order, with the name of the time.
create function pg_temp.rr_tasks(workflow_n integer, lead_n integer) returns text language sql as $$
  select coalesce(string_agg(s.node_id||'@'||coalesce((select t.k from rr_times t where t.n=lead_n and t.at=s.slot_start),'?'),', '
      order by s.at),'none')
  from rr_made s where s.workflow_id=pg_temp.id(workflow_n) and s.contact_id=pg_temp.id(lead_n)
$$;
-- Each run of the automation for the lead, by booking: how it ended, and its steps in graph order with their reasons.
create function pg_temp.rr_runs(workflow_n integer, lead_n integer) returns text language sql as $$
  select coalesce(string_agg(r.status||':'||coalesce(r.reason,'-')||' ['||coalesce((select string_agg(s.node_id||'='||s.status
      ||coalesce(':'||s.reason,''),', ' order by g.ord) from private.automation_steps s
      join public.workflow_versions v on v.id=r.version_id
      cross join lateral jsonb_array_elements(v.graph->'nodes') with ordinality g(n,ord)
      where s.run_id=r.id and g.n->>'id'=s.node_id),'')||']',' | ' order by r.event_id,r.id),'none')
  from private.automation_runs r where r.workflow_id=pg_temp.id(workflow_n) and r.contact_id=pg_temp.id(lead_n)
$$;
-- One run of the lead on the automation, by booking (1 is the first).
create function pg_temp.rr_run(workflow_n integer, lead_n integer, ord integer) returns text language sql as $$
  select split_part(pg_temp.rr_runs(workflow_n,lead_n),' | ',ord)
$$;
-- The automation's messages for the lead at a step, in order, by run and state.
create function pg_temp.rr_msgs(workflow_n integer, lead_n integer, node text) returns text language sql as $$
  select coalesce(string_agg('r'||o.ord||':'||m.state,', ' order by m.authorized_at,m.id),'none')
  from pg_temp.rr_ords(workflow_n,lead_n) o join private.automation_messages m
    on m.organization_id=o.organization_id and m.run_id=o.run_id and m.node_id=node
$$;
-- Every answer of automation_message_check for the lead at a step, in order.
create function pg_temp.rr_answers(workflow_n integer, lead_n integer, node text) returns text language sql as $$
  select coalesce(string_agg(coalesce(k.answer,'null'),' | ' order by k.at),'none') from rr_checks k
    join private.automation_runs r on r.id=k.run_id
  where k.contact_id=pg_temp.id(lead_n) and k.node_id=node and r.workflow_id=pg_temp.id(workflow_n)
$$;
-- What the final send check under the handoff lock (automation_message_issue) answered at each of those moments.
create function pg_temp.rr_issues(workflow_n integer, lead_n integer, node text) returns text language sql as $$
  select coalesce(string_agg(coalesce(k.issue,'null'),' | ' order by k.at),'none') from rr_checks k
    join private.automation_runs r on r.id=k.run_id
  where k.contact_id=pg_temp.id(lead_n) and k.node_id=node and r.workflow_id=pg_temp.id(workflow_n)
$$;
-- The record's rows for the lead's appointment on the automation, in its organization, in order: the step, the name of
-- its start, the attempt, the kind, the run, and the provider's failure status and code (none where the base has no
-- record).
create function pg_temp.rr_ledger(workflow_n integer, lead_n integer) returns text language plpgsql as $$
declare answer text;
begin
  if not pg_temp.rr_has_ledger() then return 'no record'; end if;
  execute $q$select coalesce(string_agg(g.node_id||'@'||coalesce((select t.k from rr_times t where t.n=$2 and t.at=g.starts_at),'?')
      ||'#'||g.attempt||':'||g.kind||':r'||coalesce(o.ord::text,'?')||coalesce(':'||g.failure_status,'')
      ||coalesce(':'||g.failure_code,''),', ' order by g.given_at,g.attempt),'none')
    from private.automation_given_steps g join public.workflows w on w.id=g.workflow_id
      left join pg_temp.rr_ords($1,$2) o on o.run_id=g.run_id
    where g.organization_id=w.organization_id and g.workflow_id=pg_temp.id($1)
      and g.appointment_id=(select b.id from booked b where b.n=$2)$q$ into answer using workflow_n,lead_n;
  return answer;
end $$;
-- Graphs. The three steps a day before (a text, an email and a task), then an hour before, a text.
create function pg_temp.rr_graph_x(late text) returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','w24','type','wait_until_before_appointment','version',1,
      'config',jsonb_build_object('amount',24,'unit','hours','late',late)),
    jsonb_build_object('id','t24','type','send_sms','version',1,'config',jsonb_build_object('body','See you tomorrow','purpose','informational')),
    jsonb_build_object('id','e24','type','send_email','version',1,'config',jsonb_build_object('subject','Tomorrow','body','See you tomorrow')),
    jsonb_build_object('id','k24','type','create_task','version',1,'config',jsonb_build_object('title','Confirm tomorrow''s appointment',
      'task_type','Follow Up','due_amount',0,'due_unit','minutes')),
    jsonb_build_object('id','w1','type','wait_until_before_appointment','version',1,
      'config',jsonb_build_object('amount',1,'unit','hours','late',late)),
    jsonb_build_object('id','t1','type','send_sms','version',1,'config',jsonb_build_object('body','See you in an hour','purpose','informational'))),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','w24'),
      jsonb_build_object('id','b','source','w24','target','t24'),jsonb_build_object('id','c','source','t24','target','e24'),
      jsonb_build_object('id','d','source','e24','target','k24'),jsonb_build_object('id','e','source','k24','target','w1'),
      jsonb_build_object('id','f','source','w1','target','t1')))
$$;
-- A text a day before, then an hour before an email and a text (sent late when passed).
create function pg_temp.rr_graph_f() returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','w24','type','wait_until_before_appointment','version',1,
      'config',jsonb_build_object('amount',24,'unit','hours','late','continue')),
    jsonb_build_object('id','t24','type','send_sms','version',1,'config',jsonb_build_object('body','See you tomorrow','purpose','informational')),
    jsonb_build_object('id','w1','type','wait_until_before_appointment','version',1,
      'config',jsonb_build_object('amount',1,'unit','hours','late','continue')),
    jsonb_build_object('id','e1','type','send_email','version',1,'config',jsonb_build_object('subject','Soon','body','See you in an hour')),
    jsonb_build_object('id','t1','type','send_sms','version',1,'config',jsonb_build_object('body','See you in an hour','purpose','informational'))),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','w24'),
      jsonb_build_object('id','b','source','w24','target','t24'),jsonb_build_object('id','c','source','t24','target','w1'),
      jsonb_build_object('id','d','source','w1','target','e1'),jsonb_build_object('id','e','source','e1','target','t1')))
$$;
-- A text and a task a day before, then a text an hour before, for an automation that stops on a reply.
create function pg_temp.rr_graph_s() returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',jsonb_build_object('reentry','once','stop_on_reply',true),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','w24','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',24,'unit','hours')),
    jsonb_build_object('id','t24','type','send_sms','version',1,'config',jsonb_build_object('body','See you tomorrow','purpose','informational')),
    jsonb_build_object('id','k24','type','create_task','version',1,'config',jsonb_build_object('title','Call before the appointment',
      'task_type','Follow Up','due_amount',0,'due_unit','minutes')),
    jsonb_build_object('id','w1','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',1,'unit','hours')),
    jsonb_build_object('id','t1','type','send_sms','version',1,'config',jsonb_build_object('body','See you in an hour','purpose','informational'))),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','w24'),
      jsonb_build_object('id','b','source','w24','target','t24'),jsonb_build_object('id','c','source','t24','target','k24'),
      jsonb_build_object('id','d','source','k24','target','w1'),jsonb_build_object('id','e','source','w1','target','t1')))
$$;
-- Leads 309 to 315: the acceptance case and its neighbours. Each appointment is at T, a day and a few seconds from now
-- (Friday at 2 PM). Two automations follow every booking: a text, an email and a task a day before, and a text an hour
-- before, one skipping a reminder whose time has passed (402) and one sending it late (404). Each run waits for the day
-- before; that moment then really passes, so the day-before steps go out at T, and for a run placed at T from then on the
-- day-before wait has passed (skipped, or sent late), while the hour before is still to come.
insert into rr_times select n,'T',date_trunc('second',clock_timestamp())+interval '24 hours 15 seconds' from generate_series(309,315) n;
insert into rr_times select n,'T2',date_trunc('minute',clock_timestamp())+interval '3 days' from generate_series(309,315) n;
update rr_times set at=(select t.at-interval '3 hours' from rr_times t where t.n=311 and t.k='T') where n=311 and k='T2';
select pg_temp.rr_analyze();
select pg_temp.publish(402,403,'A day before and an hour before (a passed one skipped)',pg_temp.rr_graph_x('skip'));
select pg_temp.publish(404,405,'A day before and an hour before (a passed one sent late)',pg_temp.rr_graph_x('continue'));
select pg_temp.rr_only(402,404);
select pg_temp.rr_book(n,'T') from generate_series(309,315) n;
-- Lead 312's day-before email is held for sending hours.
insert into rr_plan values (pg_temp.id(312),'e24','hold');
select pg_temp.rr_pass();
select pg_temp.rr_ok('pin setup X',(select count(*)=14 and bool_and(r.status='waiting' and r.current_node_id='w24'
    and r.due_at=(select t.at-interval '24 hours' from rr_times t where t.n=309 and t.k='T')) from private.automation_runs r
  where r.workflow_id in (pg_temp.id(402),pg_temp.id(404)) and r.contact_id in (select pg_temp.id(n) from generate_series(309,315) n)),
  'leads 309 to 315 each wait on both automations until a day before T, seconds from now');
select pg_sleep(greatest(0,extract(epoch from (select t.at-interval '24 hours' from rr_times t where t.n=309 and t.k='T')
  -clock_timestamp()))+0.3);
select pg_temp.rr_pass();
delete from rr_plan;
select pg_temp.rr_ok('pin setup X',(select bool_and(pg_temp.rr_sent(w,n)=case n when 312 then 't24@T' else 't24@T, e24@T' end
    and pg_temp.rr_runs(w,n)=case n when 312 then 'held:Outside the recipient local sending window. [w24=elapsed, '
      ||'t24=accepted:Verified provider receipt, e24=held:Outside the recipient local sending window.]'
      else 'waiting:- [w24=elapsed, t24=accepted:Verified provider receipt, e24=accepted:Verified provider receipt, k24=created, w1=wait]' end)
  from generate_series(309,315) n,(values (402),(404)) v(w)),
  'the day before T, the text, email and task go out for T (lead 312''s email is held) and the runs wait for the hour before: '
    ||pg_temp.rr_runs(402,309)||' / '||pg_temp.rr_runs(402,312));

-- Lead 309, A1 (402) and A2 (404), the acceptance case (the final send check and the catch-up through a passed wait,
-- automation_message_issue and automation_finish_node). An ordinary move to T2,
-- three days out, whose day-before time is still to come, so the automation starts over there; the T2 run gives its
-- reminders and finishes; an ordinary move back to T then starts a new run at T. Before this change that run ended at
-- the passed day-before wait and T lost its hour-before text (402), or it sent the day-before text and email again (404).
-- Now the new run passes the day-before wait as already reached (402) or late (404), skips what T was given and sends
-- the hour-before text once. A task is created once per time (H1).
select pg_temp.save(309,pg_temp.rr_at(309,'T2'));
select pg_temp.rr_pass();
select pg_temp.rr_all(402,309);
select pg_temp.rr_all(404,309);
select pg_temp.save(309,pg_temp.rr_at(309,'T'));
select pg_temp.rr_pass();
select pg_temp.rr_all(402,309);
select pg_temp.rr_all(404,309);
select pg_temp.rr_ok('pin A6 (lead 309)',pg_temp.rr_run(402,309,2)='completed:Verified provider receipt [w24=elapsed, '
    ||'t24=accepted:Verified provider receipt, e24=accepted:Verified provider receipt, k24=created, w1=elapsed, '
    ||'t1=accepted:Verified provider receipt]' and pg_temp.rr_run(404,309,2)=pg_temp.rr_run(402,309,2),
  'the genuinely new time T2 gets every reminder: '||pg_temp.rr_run(402,309,2));
select pg_temp.rr_ok('fix A1 sends',pg_temp.rr_sent(402,309)='t24@T, e24@T, t24@T2, e24@T2, t1@T2, t1@T',
  'back at T, one day-before text in all for T and its hour-before text once: '||pg_temp.rr_sent(402,309));
select pg_temp.rr_ok('fix A1 steps',pg_temp.rr_run(402,309,3)='completed:Verified provider receipt [w24=elapsed:Already reached '
    ||'for this appointment time, t24=skipped:Already sent for this appointment time, e24=skipped:Already sent for this '
    ||'appointment time, k24=skipped:Already created for this appointment time, w1=elapsed, t1=accepted:Verified provider receipt]',
  'the new run at T passes the day-before wait as already reached and skips what T was given: '||pg_temp.rr_run(402,309,3));
select pg_temp.rr_ok('pin A1 first run',pg_temp.rr_run(402,309,1)='stopped:Appointment was rescheduled [w24=elapsed, '
    ||'t24=accepted:Verified provider receipt, e24=accepted:Verified provider receipt, k24=created, w1=wait]',
  'the first run ended as rescheduled: '||pg_temp.rr_run(402,309,1));
select pg_temp.rr_ok('fix A2 sends',pg_temp.rr_sent(404,309)='t24@T, e24@T, t24@T2, e24@T2, t1@T2, t1@T',
  'sent late when passed, back at T the day-before text and email are not sent again: '||pg_temp.rr_sent(404,309));
select pg_temp.rr_ok('fix A2 steps',pg_temp.rr_run(404,309,3)='completed:Verified provider receipt [w24=elapsed:The reminder '
    ||'time had already passed, t24=skipped:Already sent for this appointment time, e24=skipped:Already sent for this '
    ||'appointment time, k24=skipped:Already created for this appointment time, w1=elapsed, t1=accepted:Verified provider receipt]',
  'the new run at T: '||pg_temp.rr_run(404,309,3));
select pg_temp.rr_ok('fix H1',pg_temp.rr_tasks(404,309)='k24@T, k24@T2' and pg_temp.rr_tasks(402,309)='k24@T, k24@T2',
  'a task another run already created at T is not created again: '||pg_temp.rr_tasks(404,309));
select pg_temp.rr_ok('fix A1 record',pg_temp.rr_ledger(402,309)='t24@T#1:sms:r1, e24@T#1:email:r1, k24@T#1:task:r1, '
    ||'t24@T2#1:sms:r2, e24@T2#1:email:r2, k24@T2#1:task:r2, t1@T2#1:sms:r2, t1@T#1:sms:r3',
  'the record holds each step once per time, by the run that gave it: '||pg_temp.rr_ledger(402,309));

-- Lead 310 (Pins, the sign-off story of a move away and back): the same move away to T2 and back, while the T2 run has given nothing
-- yet. The move back carries the first run on, so T has one day-before text in all and its hour-before text once.
select pg_temp.save(310,pg_temp.rr_at(310,'T2'));
select pg_temp.rr_pass();
select pg_temp.save(310,pg_temp.rr_at(310,'T'));
select pg_temp.rr_pass();
select pg_temp.rr_all(402,310);
select pg_temp.rr_all(404,310);
select pg_temp.rr_ok('pin A1 natural',(select bool_and(pg_temp.rr_sent(w,310)='t24@T, e24@T, t1@T' and pg_temp.rr_tasks(w,310)='k24@T'
    and pg_temp.rr_runs(w,310)='completed:Verified provider receipt [w24=elapsed, t24=accepted:Verified provider receipt, '
      ||'e24=accepted:Verified provider receipt, k24=created, w1=elapsed, t1=accepted:Verified provider receipt] | '
      ||'stopped:Appointment was moved back [w24=wait]') from (values (402),(404)) v(w)),
  'moved away and straight back, the first run carries on: '||pg_temp.rr_sent(402,310)||' / '||pg_temp.rr_runs(402,310));
select pg_temp.rr_ok('fix A1 natural record',pg_temp.rr_ledger(402,310)='t24@T#1:sms:r1, e24@T#1:email:r1, k24@T#1:task:r1, '
    ||'t1@T#1:sms:r1','and the record holds T''s steps once: '||pg_temp.rr_ledger(402,310));

-- Lead 311, A3 (402; the acceptance case after a reopening, the shape of automation_run_holds' rule (d)). An ordinary move to
-- T2, three hours before T and also inside its day-before time, so the first run follows it in place, gives the
-- hour-before text there and finishes: it passed through T and left. Cancelled, moved back to T while cancelled and
-- reopened: rule (d) lets a new run start at T. Before this change it ended at the passed day-before wait and T never got
-- its hour-before text. With late sending (404, pins) the move to T2 started over there, and the reopening carries the
-- first run on at T.
select pg_temp.save(311,pg_temp.rr_at(311,'T2'));
select pg_temp.rr_pass();
select pg_temp.rr_all(402,311);
select pg_temp.rr_all(404,311);
select pg_temp.save(311,'status=''Cancelled''');
select pg_temp.rr_pass();
select pg_temp.save(311,pg_temp.rr_at(311,'T'));
select pg_temp.rr_pass();
select pg_temp.save(311,'status=''Scheduled''');
select pg_temp.rr_pass();
select pg_temp.rr_all(402,311);
select pg_temp.rr_all(404,311);
select pg_temp.rr_ok('fix A3 sends',pg_temp.rr_sent(402,311)='t24@T, e24@T, t1@T2, t1@T' and pg_temp.rr_tasks(402,311)='k24@T',
  'reopened at T, nothing is repeated there and its hour-before text goes out once: '||pg_temp.rr_sent(402,311));
select pg_temp.rr_ok('fix A3 steps',pg_temp.rr_runs(402,311)='completed:Verified provider receipt [w24=elapsed, '
    ||'t24=accepted:Verified provider receipt, e24=accepted:Verified provider receipt, k24=created, w1=elapsed, '
    ||'t1=accepted:Verified provider receipt] | completed:Verified provider receipt [w24=elapsed:Already reached for this '
    ||'appointment time, t24=skipped:Already sent for this appointment time, e24=skipped:Already sent for this appointment time, '
    ||'k24=skipped:Already created for this appointment time, w1=elapsed, t1=accepted:Verified provider receipt]',
  'the run the reopening started: '||pg_temp.rr_runs(402,311));
select pg_temp.rr_ok('pin A3 late sending',pg_temp.rr_sent(404,311)='t24@T, e24@T, t24@T2, e24@T2, t1@T2, t1@T'
    and pg_temp.rr_runs(404,311)='completed:Verified provider receipt [w24=elapsed, t24=accepted:Verified provider receipt, '
      ||'e24=accepted:Verified provider receipt, k24=created, w1=elapsed, t1=accepted:Verified provider receipt] | '
      ||'completed:Verified provider receipt [w24=elapsed:The reminder time had already passed, t24=accepted:Verified provider '
      ||'receipt, e24=accepted:Verified provider receipt, k24=created, w1=elapsed, t1=accepted:Verified provider receipt]',
  'sent late when passed, the first run is carried on at T: '||pg_temp.rr_sent(404,311)||' / '||pg_temp.rr_runs(404,311));

-- Lead 312, C1 (the late rule in a caught-up segment): T got its day-before text but not its email twin
-- (held for sending hours) nor the task after it. The T2 run finishes, and an ordinary move back starts a new run at T.
-- With a passed reminder skipped (402), that run skips the text as sent and the email and task as late, then sends the
-- hour-before text. Sent late when passed (404), the email and task go out late, and the text is not sent again.
select pg_temp.save(312,pg_temp.rr_at(312,'T2'));
select pg_temp.rr_pass();
select pg_temp.rr_all(402,312);
select pg_temp.rr_all(404,312);
select pg_temp.save(312,pg_temp.rr_at(312,'T'));
select pg_temp.rr_pass();
select pg_temp.rr_all(402,312);
select pg_temp.rr_all(404,312);
select pg_temp.rr_ok('fix C1',pg_temp.rr_sent(402,312)='t24@T, t24@T2, e24@T2, t1@T2, t1@T' and pg_temp.rr_tasks(402,312)='k24@T2'
    and pg_temp.rr_run(402,312,3)='completed:Verified provider receipt [w24=elapsed:Already reached for this appointment time, '
      ||'t24=skipped:Already sent for this appointment time, e24=skipped:The reminder time had already passed, '
      ||'k24=skipped:The reminder time had already passed, w1=elapsed, t1=accepted:Verified provider receipt]',
  'the email and task T never got are late, and its hour-before text goes out: '||pg_temp.rr_sent(402,312)||' / '
    ||pg_temp.rr_run(402,312,3));
select pg_temp.rr_ok('fix C1 late sending',pg_temp.rr_sent(404,312)='t24@T, t24@T2, e24@T2, t1@T2, e24@T, t1@T'
    and pg_temp.rr_tasks(404,312)='k24@T2, k24@T'
    and pg_temp.rr_run(404,312,3)='completed:Verified provider receipt [w24=elapsed:The reminder time had already passed, '
      ||'t24=skipped:Already sent for this appointment time, e24=accepted:Verified provider receipt, k24=created, w1=elapsed, '
      ||'t1=accepted:Verified provider receipt]',
  'sent late when passed, only the text is not sent again: '||pg_temp.rr_sent(404,312)||' / '||pg_temp.rr_run(404,312,3));
-- C1, the lock window (review RV3-2): the late rule is decided before the handoff's lock, by the worker's check
-- (automation_message_check), not by the final send check the handoff makes under its lock (automation_message_issue),
-- which keeps to index lookups. It depends only on the run's version's graph, its own steps, the slots its reminders
-- and its lease are for and their start times, none of which changes while the run holds its lease. At each check of
-- lead 312's day-before email, what both answered:
select pg_temp.rr_ok('fix C1 lock window',pg_temp.rr_answers(402,312,'e24')
    ='null | null | null | skip:The reminder time had already passed'
  and pg_temp.rr_issues(402,312,'e24')='null | null | null | null',
  'the worker''s check skips the late email, and the check under the handoff''s lock does not decide it: '
    ||pg_temp.rr_answers(402,312,'e24')||' / '||pg_temp.rr_issues(402,312,'e24'));

-- Leads 313 and 314, A4 and A5 (Pins, the sign-off story of a corrected outcome): marked No Show (313) or Completed (314) by mistake
-- before T. The hour-before text is held while the outcome stands; corrected (Scheduled), it goes out once, and the
-- day-before text is never repeated.
select pg_temp.save(313,'status=''No Show''');
select pg_temp.save(314,'status=''Completed''');
select pg_temp.rr_pass();
select pg_temp.rr_due(w,n) from generate_series(313,314) n,(values (402),(404)) v(w);
select pg_temp.rr_ok('pin A4 A5 held',(select bool_and(pg_temp.rr_runs(w,n)='held:The appointment has an outcome recorded [w24=elapsed, '
    ||'t24=accepted:Verified provider receipt, e24=accepted:Verified provider receipt, k24=created, w1=elapsed, '
    ||'t1=held:The appointment has an outcome recorded]') from generate_series(313,314) n,(values (402),(404)) v(w)),
  'the hour-before text is held while No Show or Completed stands: '||pg_temp.rr_runs(402,313));
select pg_temp.save(n,'status=''Scheduled''') from generate_series(313,314) n;
select pg_temp.rr_pass();
select pg_temp.rr_all(w,n) from generate_series(313,314) n,(values (402),(404)) v(w);
select pg_temp.rr_ok('pin A4 A5',(select bool_and(pg_temp.rr_sent(w,n)='t24@T, e24@T, t1@T' and pg_temp.rr_tasks(w,n)='k24@T'
    and pg_temp.rr_runs(w,n)='completed:Verified provider receipt [w24=elapsed, t24=accepted:Verified provider receipt, '
      ||'e24=accepted:Verified provider receipt, k24=created, w1=elapsed, t1=accepted:Verified provider receipt]')
  from generate_series(313,314) n,(values (402),(404)) v(w)),
  'corrected before T, the held hour-before text goes out once and nothing is repeated: '||pg_temp.rr_sent(402,313)
    ||' / '||pg_temp.rr_sent(404,314));
select pg_temp.rr_ok('fix A4 record',pg_temp.rr_ledger(402,313)='t24@T#1:sms:r1, e24@T#1:email:r1, k24@T#1:task:r1, t1@T#1:sms:r1',
  'the record: '||pg_temp.rr_ledger(402,313));

-- Lead 315, A6 and H2 (Pins): a genuinely new time, T3 four days out, gets every reminder, its task included.
insert into rr_times values (315,'T3',date_trunc('minute',clock_timestamp())+interval '4 days');
select pg_temp.save(315,pg_temp.rr_at(315,'T3'));
select pg_temp.rr_pass();
select pg_temp.rr_all(402,315);
select pg_temp.rr_all(404,315);
select pg_temp.rr_ok('pin A6 H2',(select bool_and(pg_temp.rr_sent(w,315)='t24@T, e24@T, t24@T3, e24@T3, t1@T3'
    and pg_temp.rr_tasks(w,315)='k24@T, k24@T3'
    and pg_temp.rr_runs(w,315)='stopped:Appointment was rescheduled [w24=elapsed, t24=accepted:Verified provider receipt, '
      ||'e24=accepted:Verified provider receipt, k24=created, w1=wait] | completed:Verified provider receipt [w24=elapsed, '
      ||'t24=accepted:Verified provider receipt, e24=accepted:Verified provider receipt, k24=created, w1=elapsed, '
      ||'t1=accepted:Verified provider receipt]') from (values (402),(404)) v(w)),
  'a new time gets every reminder and its task: '||pg_temp.rr_sent(402,315)||' / '||pg_temp.rr_tasks(402,315));
update public.workflows set status='paused' where id in (pg_temp.id(402),pg_temp.id(404));
select pg_temp.retire();
-- Leads 316 to 343: one retry, for texts only, its window, an opt-out before it and a run that carries on. One
-- automation: a text a day before, then an hour before an email and a text, each
-- sent late when its time passed. Each appointment is at T, three days out (lead 321's and 342's forty minutes out, lead
-- 341's fifty), and a qualifying new run at T comes from an ordinary move to another time where the automation starts
-- over and its run there hands off its first text, and an ordinary move back, which starts over at T (rr_away_back).
-- Before this change that run sent T's day-before text again, whatever its provider had said.
insert into rr_times select n,'T',date_trunc('minute',clock_timestamp())+interval '3 days' from generate_series(316,343) n;
insert into rr_times select n,v.k,date_trunc('minute',clock_timestamp())+make_interval(days=>v.d) from generate_series(316,343) n,
  (values ('T2',4),('T3',5),('T4',6),('T5',7)) v(k,d);
update rr_times set at=date_trunc('minute',clock_timestamp())+interval '40 minutes' where k='T' and n in (321,342);
update rr_times set at=date_trunc('minute',clock_timestamp())+interval '50 minutes' where k='T' and n=341;
select pg_temp.rr_analyze();
select pg_temp.publish(406,407,'A day before, then an hour before an email and a text (sent late when passed)',pg_temp.rr_graph_f());
select pg_temp.rr_only(406);
insert into rr_plan values (pg_temp.id(318),'t24','reject:20429'),(pg_temp.id(319),'t24','reject:first_contact_4xx:20429'),
  (pg_temp.id(320),'t24','reject:429'),(pg_temp.id(321),'e1','hold'),(pg_temp.id(325),'t24','reject:21610'),
  (pg_temp.id(327),'t24','reject:21211'),(pg_temp.id(329),'e1','email_4xx'),(pg_temp.id(330),'t24','timeout'),
  (pg_temp.id(331),'t24','crash'),(pg_temp.id(333),'e1','email_5xx'),(pg_temp.id(341),'t1','reject:20429');
-- K1: another agency books the same time on its own automation with the same step ids (leads 3001 and 3002).
insert into auth.users(id,email) values (pg_temp.id(3000),'v2-appt-3000@example.invalid');
insert into public.profiles(id,organization_id,role,status,email)
  values (pg_temp.id(3000),pg_temp.id(2),'Admin','Active','v2-appt-3000@example.invalid')
  on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status;
update private.automation_release_controls set dispatch_enabled=true where organization_id=pg_temp.id(2);
insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
  select pg_temp.id(n),pg_temp.id(2),'Lead '||n,'+1202555'||n::text,pg_temp.id(14),pg_temp.id(14) from generate_series(3001,3002) n;
insert into public.workflows(id,organization_id,name,status,trigger_type,automation_graph,automation_revision)
  values(pg_temp.id(430),pg_temp.id(2),'Another agency''s reminders','active','manual',pg_temp.rr_graph_f(),1);
insert into public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
  values(pg_temp.id(431),pg_temp.id(2),pg_temp.id(430),'Another agency''s reminders',1,pg_temp.rr_graph_f(),clock_timestamp(),pg_temp.id(3000));
update public.workflows set automation_version_id=pg_temp.id(431) where id=pg_temp.id(430);
insert into public.automation_intervals(organization_id,workflow_id,version_id,starts_at)
  values(pg_temp.id(2),pg_temp.id(430),pg_temp.id(431),clock_timestamp());
insert into rr_times select n,'T',(select t.at from rr_times t where t.n=343 and t.k='T') from generate_series(3001,3002) n;
insert into public.appointments(id,organization_id,title,contact_id,user_id,start_time,sync_source)
  select pg_temp.id(t.n+10),pg_temp.id(2),'Another agency''s appointment',pg_temp.id(t.n),pg_temp.id(14),t.at,'internal'
  from rr_times t where t.n in (3001,3002) and t.k='T';
insert into booked select t.n,pg_temp.id(t.n+10),t.at from rr_times t where t.n in (3001,3002) and t.k='T';
select pg_temp.rr_book(n,'T') from generate_series(316,343) n;
select pg_temp.rr_pass();
-- Records another agency holds for this agency's lead 343 at its time and steps, as if a lookup ignored the organization:
-- a failed day-before text a retry would follow, and an hour-before text.
do $$
begin
  if pg_temp.rr_has_ledger() then
    begin
      execute $q$insert into private.automation_given_steps(organization_id,workflow_id,appointment_id,starts_at,node_id,attempt,
          kind,run_id,failure_status,failure_code)
        select pg_temp.id(2),pg_temp.id(406),b.id,b.starts,v.node,1,'sms',(select r.id from private.automation_runs r
            where r.workflow_id=pg_temp.id(430) and r.contact_id=pg_temp.id(3002)),v.status,v.code
        from booked b,(values ('t24','undelivered','30003'),('t1',null,null)) v(node,status,code) where b.n=343$q$;
    exception when others then
      raise notice 'rr K1: the record refuses another agency''s rows for this agency''s keys (%)',sqlerrm;
    end;
  end if;
end $$;
select pg_temp.rr_ok('pin setup F',(select count(*)=25 and bool_and(r.status='waiting' and r.current_node_id='w24')
    from private.automation_runs r where r.workflow_id=pg_temp.id(406) and r.contact_id in (select pg_temp.id(n)
      from generate_series(316,343) n where n not in (321,341,342)))
  and (select count(*)=2 and bool_and(r.status='waiting' and r.current_node_id='w24') from private.automation_runs r
    where r.workflow_id=pg_temp.id(430))
  and pg_temp.rr_runs(406,321)='held:Outside the recipient local sending window. [w24=elapsed:The reminder time had already '
    ||'passed, t24=accepted:Verified provider receipt, w1=elapsed:The reminder time had already passed, e1=held:Outside the '
    ||'recipient local sending window.]'
  and pg_temp.rr_sent(406,341)='t24@T, e1@T, t1@T!reject:20429' and pg_temp.rr_runs(406,341) like 'failed:%'
  and pg_temp.rr_sent(406,342)='t24@T, e1@T, t1@T' and pg_temp.rr_runs(406,342) like 'completed:%',
  'the runs three days out wait for the day before; forty and fifty minutes out, every reminder has passed and goes out '
    ||'late: '||pg_temp.rr_runs(406,321)||' / '||pg_temp.rr_runs(406,341));
-- The day before T comes for every run three days out, and each hands off its day-before text.
select pg_temp.rr_due(406,n) from generate_series(316,343) n where n not in (321,341,342);
select pg_temp.rr_due(430,3001);
-- Leads 329 and 333 also reach the hour before: their emails fail (HTTP 4xx) or have no confirmed outcome (HTTP 5xx).
select pg_temp.rr_due(406,n) from (values (329),(333)) v(n);
delete from rr_plan where contact_id<>pg_temp.id(341);
-- The provider's status callbacks for the day-before texts.
select pg_temp.rr_receipt(406,n,1,'t24',v.status,v.code) from (values (316,'undelivered','30003'),(317,'failed','30001'),
  (321,'undelivered','30003'),(322,'undelivered','30003'),(323,'undelivered','30003'),(324,'undelivered','30008'),
  (326,'undelivered','30006'),(328,'failed',null),(335,'undelivered','30003'),(336,'undelivered','30003'),
  (338,'undelivered','30003'),(339,'undelivered','30003'),(340,'undelivered','30003'),(342,'undelivered','30003')) v(n,status,code);
select pg_temp.rr_receipt(430,3001,1,'t24','undelivered','30003');
-- F1: the same failure reported twice and then a different one: the first status and code are kept.
create temporary table rr_marks(n integer, what text, at timestamptz, primary key(n,what)) on commit drop;
insert into rr_marks values (334,'before',clock_timestamp());
select pg_temp.rr_receipt(406,334,1,'t24','undelivered','30003');
insert into rr_marks values (334,'after',clock_timestamp());
select pg_temp.rr_receipt(406,334,1,'t24','undelivered','30003');
select pg_temp.rr_receipt(406,334,1,'t24','failed','30001');
-- F2: failed, then delivered before any retry.
select pg_temp.rr_receipt(406,335,1,'t24','delivered',null);
select pg_temp.rr_ok('fix F1 receipts',pg_temp.rr_ledger(406,334)='t24@T#1:sms:r1:undelivered:30003'
    and pg_temp.rr_ledger(406,316)='t24@T#1:sms:r1:undelivered:30003' and pg_temp.rr_ledger(406,317)='t24@T#1:sms:r1:failed:30001'
    and pg_temp.rr_ledger(406,328)='t24@T#1:sms:r1:failed' and pg_temp.rr_ledger(406,335)='t24@T#1:sms:r1:undelivered:30003'
    and pg_temp.rr_ledger(406,318)='t24@T#1:sms:r1',
  'each verified callback keeps the provider''s first failure, never overwritten, with no code when none was sent, and a '
    ||'request rejection writes none: '||pg_temp.rr_ledger(406,334)||' / '||pg_temp.rr_ledger(406,328)||' / '
    ||pg_temp.rr_ledger(406,318));
do $$
declare at timestamptz;
begin
  if pg_temp.rr_has_ledger() then
    execute $q$select g.failure_at from private.automation_given_steps g where g.organization_id=pg_temp.id(1)
      and g.workflow_id=pg_temp.id(406) and g.appointment_id=(select b.id from booked b where b.n=334) and g.node_id='t24'$q$ into at;
  end if;
  perform pg_temp.rr_ok('fix F1 first failure time',at between (select m.at from rr_marks m where m.n=334 and m.what='before')
      and (select m.at from rr_marks m where m.n=334 and m.what='after'),
    'the failure is dated by the first failed callback: '||coalesce(at::text,'none'));
end $$;
select pg_temp.rr_ok('pin F2 receipts',pg_temp.rr_msgs(406,335,'t24')='r1:delivered' and pg_temp.rr_msgs(406,334,'t24')='r1:failed',
  'a delivered callback after a failed one leaves the message delivered: '||pg_temp.rr_msgs(406,335,'t24'));
-- D3, D3b and D4: the provider rate-limited the request (20429, also as a first contact's 4xx, or HTTP 429 with no code).
-- The rejection is dated by its dispatch: leads 319 and 320's a minute and a second ago, so their backoff has passed;
-- lead 318's ten seconds ago when its new run reaches the text, and a minute and a second ago after that.
update public.sms_dispatches d set updated_at=clock_timestamp()-interval '61 seconds' from private.automation_runs r
  where d.organization_id=r.organization_id and d.request_key='automation:'||r.id||':t24' and d.state='failed'
    and r.workflow_id=pg_temp.id(406) and r.contact_id in (pg_temp.id(319),pg_temp.id(320));

-- Each comes back to T on a qualifying new run (I1, G1, G1b, J1, J2 and K1 do not; F4 does three times).
select pg_temp.rr_away_back(406,n,'T2','T') from generate_series(316,337) n;
update public.sms_dispatches d set updated_at=clock_timestamp()-interval '10 seconds' from private.automation_runs r
  where d.organization_id=r.organization_id and d.request_key='automation:'||r.id||':t24' and d.state='failed'
    and r.workflow_id=pg_temp.id(406) and r.contact_id=pg_temp.id(318);
select pg_temp.rr_due(406,318);
select pg_temp.rr_ok('fix D3 backoff',pg_temp.rr_run(406,318,3)='held:Waiting before retrying a text the provider rate-limited '
    ||'[w24=elapsed, t24=held:Waiting before retrying a text the provider rate-limited]' and pg_temp.rr_sent(406,318)='t24@T!reject:20429, t24@T2',
  'within a minute of the rate-limited request the new run holds its retry: '||pg_temp.rr_run(406,318,3));
update public.sms_dispatches d set updated_at=clock_timestamp()-interval '61 seconds' from private.automation_runs r
  where d.organization_id=r.organization_id and d.request_key='automation:'||r.id||':t24' and d.state='failed'
    and r.workflow_id=pg_temp.id(406) and r.contact_id=pg_temp.id(318);
select pg_temp.rr_all(406,n) from generate_series(316,337) n;

-- D1, D2, D3, D3b and D4: exactly one retry on the new run at T, which the database asks for ('retry:'). The first
-- attempt keeps its message, its status and its code; the retry is attempt 2 on its own run.
select pg_temp.rr_ok('fix D1 D2 D3 D4 sends',(select bool_and(pg_temp.rr_sent(406,n)=case n when 316 then 't24@T' when 317 then 't24@T'
      when 318 then 't24@T!reject:20429' when 319 then 't24@T!reject:first_contact_4xx:20429' else 't24@T!reject:429' end
    ||', t24@T2, t24@T+retry, e1@T, t1@T') from generate_series(316,320) n),
  'each failed day-before text is sent again once, as a retry: '||pg_temp.rr_sent(406,316)||' / '||pg_temp.rr_sent(406,318)
    ||' / '||pg_temp.rr_sent(406,320));
select pg_temp.rr_ok('fix D1 D2 D3 D4 steps',(select bool_and(pg_temp.rr_run(406,n,3)='completed:Verified provider receipt '
    ||'[w24=elapsed, t24=accepted:Verified provider receipt, w1=elapsed, e1=accepted:Verified provider receipt, '
    ||'t1=accepted:Verified provider receipt]'
  and pg_temp.rr_answers(406,n,'t24')=case n when 318 then 'null | null | Waiting before retrying a text the provider rate-limited | retry:'
    else 'null | null | retry:' end) from generate_series(316,320) n)
  and pg_temp.rr_run(406,316,1)='stopped:Appointment was rescheduled [w24=elapsed, t24=accepted:Verified provider receipt, w1=wait]'
  and pg_temp.rr_run(406,318,1)='failed:The provider did not accept this message. [w24=elapsed, t24=failed:The provider did '
    ||'not accept this message.]',
  'the new run at T is asked to retry: '||pg_temp.rr_answers(406,318,'t24')||' / '||pg_temp.rr_run(406,316,3));
select pg_temp.rr_ok('fix D1 D2 D3 D4 record',pg_temp.rr_ledger(406,316)='t24@T#1:sms:r1:undelivered:30003, t24@T2#1:sms:r2, '
    ||'t24@T#2:sms:r3, e1@T#1:email:r3, t1@T#1:sms:r3'
  and pg_temp.rr_ledger(406,317)='t24@T#1:sms:r1:failed:30001, t24@T2#1:sms:r2, t24@T#2:sms:r3, e1@T#1:email:r3, t1@T#1:sms:r3'
  and (select bool_and(pg_temp.rr_ledger(406,n)='t24@T#1:sms:r1, t24@T2#1:sms:r2, t24@T#2:sms:r3, e1@T#1:email:r3, t1@T#1:sms:r3')
    from generate_series(318,320) n)
  and pg_temp.rr_msgs(406,316,'t24')='r1:failed, r2:accepted, r3:accepted' and pg_temp.rr_msgs(406,318,'t24')='r1:unknown, r2:accepted, r3:accepted',
  'two messages on two runs for T, attempts 1 and 2, the first keeping the provider''s result: '||pg_temp.rr_ledger(406,316)
    ||' / '||pg_temp.rr_msgs(406,316,'t24'));

-- D5 (lead 321, forty minutes out): the hour-before time has come, so the retry window is closed. The new run skips the
-- older retry and goes on to the current reminder, which its first run never handed off.
select pg_temp.rr_ok('fix D5',pg_temp.rr_sent(406,321)='t24@T, t24@T2, e1@T, t1@T'
    and pg_temp.rr_run(406,321,3)='completed:Verified provider receipt [w24=elapsed:The reminder time had already passed, '
      ||'t24=skipped:Not retried: the next reminder for this appointment time is already due, w1=elapsed:The reminder time '
      ||'had already passed, e1=accepted:Verified provider receipt, t1=accepted:Verified provider receipt]'
    and pg_temp.rr_answers(406,321,'t24')='null | null | skip:Not retried: the next reminder for this appointment time is already due',
  'the older retry is skipped and the hour-before email and text go out: '||pg_temp.rr_sent(406,321)||' / '||pg_temp.rr_run(406,321,3));

-- D6 (lead 322): the retry itself is undelivered (30003). A later qualifying run makes no third attempt.
select pg_temp.rr_receipt(406,322,3,'t24','undelivered','30003');
select pg_temp.rr_away_back(406,322,'T3','T');
select pg_temp.rr_all(406,322);
select pg_temp.rr_ok('fix D6',pg_temp.rr_sent(406,322)='t24@T, t24@T2, t24@T+retry, e1@T, t1@T, t24@T3'
    and pg_temp.rr_run(406,322,5)='completed:Already sent for this appointment time [w24=elapsed, t24=skipped:Not sent again: '
      ||'already retried once for this appointment time, w1=elapsed, e1=skipped:Already sent for this appointment time, '
      ||'t1=skipped:Already sent for this appointment time]'
    and pg_temp.rr_ledger(406,322)='t24@T#1:sms:r1:undelivered:30003, t24@T2#1:sms:r2, t24@T#2:sms:r3:undelivered:30003, '
      ||'e1@T#1:email:r3, t1@T#1:sms:r3, t24@T3#1:sms:r4',
  'a failed retry is not followed by a third attempt: '||pg_temp.rr_sent(406,322)||' / '||pg_temp.rr_run(406,322,5));

-- D7 (lead 323): after the retry, the appointment comes back to T three more times. Nothing more goes out there.
do $$
declare k text;
begin
  foreach k in array array['T3','T4','T5'] loop
    perform pg_temp.rr_away_back(406,323,k,'T');
    perform pg_temp.rr_all(406,323);
  end loop;
end $$;
select pg_temp.rr_ok('fix D7',pg_temp.rr_sent(406,323)='t24@T, t24@T2, t24@T+retry, e1@T, t1@T, t24@T3, t24@T4, t24@T5'
    and (select bool_and(pg_temp.rr_run(406,323,k)='completed:Already sent for this appointment time [w24=elapsed, '
      ||'t24=skipped:Not sent again: already retried once for this appointment time, w1=elapsed, e1=skipped:Already sent for '
      ||'this appointment time, t1=skipped:Already sent for this appointment time]') from (values (5),(7),(9)) v(k)),
  'three more new runs at T send nothing: '||pg_temp.rr_sent(406,323));

-- E1 to E4: never retried. A code the provider does not list as temporary (30008), a permanent code (21610 and 21211 at
-- the request, 30006 by callback), a failure with no code, and an email the provider refused (HTTP 4xx). The new run at T
-- skips that step and its later steps still run. 21610 is also recorded as the lead's opt-out (lead 325), so the run
-- that starts at T2 and the hour-before text at T are held for it, as any first attempt to that number is.
select pg_temp.rr_ok('fix E1 E2 E3',(select bool_and(pg_temp.rr_sent(406,n)=case n when 327 then 't24@T!reject:21211' else 't24@T' end
      ||', t24@T2, e1@T, t1@T'
    and pg_temp.rr_run(406,n,3)='completed:Verified provider receipt [w24=elapsed, t24=skipped:Not sent again: delivery failed '
      ||'for this appointment time and cannot be retried, w1=elapsed, e1=accepted:Verified provider receipt, '
      ||'t1=accepted:Verified provider receipt]') from (values (324),(326),(327),(328)) v(n)),
  'a failure that cannot be retried is not sent again, and the later steps run: '||pg_temp.rr_sent(406,324)||' / '
    ||pg_temp.rr_run(406,324,3));
select pg_temp.rr_ok('fix E2 opt-out',pg_temp.rr_sent(406,325)='t24@T!reject:21610, e1@T'
    and pg_temp.rr_runs(406,325)='failed:The provider did not accept this message. [w24=elapsed, t24=failed:The provider did '
      ||'not accept this message.] | stopped:Appointment was rescheduled [w24=elapsed, t24=held:This recipient has opted out '
      ||'of agency texts.] | held:This recipient has opted out of agency texts. [w24=elapsed, t24=skipped:Not sent again: '
      ||'delivery failed for this appointment time and cannot be retried, w1=elapsed, e1=accepted:Verified provider receipt, '
      ||'t1=held:This recipient has opted out of agency texts.]',
  'a blocked recipient''s failed text is not sent again and the email still goes out: '||pg_temp.rr_runs(406,325));
select pg_temp.rr_ok('fix E4',pg_temp.rr_sent(406,329)='t24@T, e1@T!email_4xx, t24@T2, t1@T'
    and pg_temp.rr_run(406,329,3)='completed:Verified provider receipt [w24=elapsed, t24=skipped:Already sent for this '
      ||'appointment time, w1=elapsed, e1=skipped:Not sent again: delivery failed for this appointment time and cannot be '
      ||'retried, t1=accepted:Verified provider receipt]'
    and pg_temp.rr_ledger(406,329)='t24@T#1:sms:r1, e1@T#1:email:r1, t24@T2#1:sms:r2, t1@T#1:sms:r3',
  'an email the provider refused is never retried: '||pg_temp.rr_sent(406,329)||' / '||pg_temp.rr_run(406,329,3));
select pg_temp.rr_ok('fix E1 E3 record',pg_temp.rr_ledger(406,324)='t24@T#1:sms:r1:undelivered:30008, t24@T2#1:sms:r2, '
    ||'e1@T#1:email:r3, t1@T#1:sms:r3' and pg_temp.rr_ledger(406,328)='t24@T#1:sms:r1:failed, t24@T2#1:sms:r2, e1@T#1:email:r3, '
    ||'t1@T#1:sms:r3','no second attempt is recorded: '||pg_temp.rr_ledger(406,324));

-- E5: an outcome that is not a confirmed failure is never sent again: no answer from the provider (an uncertain dispatch,
-- transport_unknown, lead 330), the worker stopping right after the handoff (an intent still handed_off, lead 331), an
-- acceptance with no final receipt (lead 332), and an email with no confirmed outcome (HTTP 5xx, lead 333).
select pg_temp.rr_ok('fix E5',pg_temp.rr_sent(406,330)='t24@T!timeout, t24@T2, e1@T, t1@T'
    and pg_temp.rr_sent(406,331)='t24@T!crash, t24@T2, e1@T, t1@T' and pg_temp.rr_sent(406,332)='t24@T, t24@T2, e1@T, t1@T'
    and pg_temp.rr_sent(406,333)='t24@T, e1@T!email_5xx, t24@T2, t1@T'
    and (select bool_and(pg_temp.rr_run(406,n,3)='completed:Verified provider receipt [w24=elapsed, t24=skipped:Already sent for '
      ||'this appointment time, w1=elapsed, e1=accepted:Verified provider receipt, t1=accepted:Verified provider receipt]')
      from (values (330),(331),(332)) v(n))
    and pg_temp.rr_run(406,333,3)='completed:Verified provider receipt [w24=elapsed, t24=skipped:Already sent for this '
      ||'appointment time, w1=elapsed, e1=skipped:Already sent for this appointment time, t1=accepted:Verified provider receipt]',
  'an uncertain or pending outcome counts as sent: '||pg_temp.rr_sent(406,330)||' / '||pg_temp.rr_sent(406,331)||' / '
    ||pg_temp.rr_run(406,333,3));
select pg_temp.rr_ok('pin E5 first runs',pg_temp.rr_run(406,330,1)='stopped:Appointment was rescheduled [w24=elapsed, '
    ||'t24=unknown:Delivery could not be confirmed. This message will not be sent again automatically.]'
  and pg_temp.rr_run(406,331,1)='stopped:Appointment was rescheduled [w24=elapsed]'
  and (select i.status from private.automation_intents i join private.automation_runs r on r.id=i.run_id
    where i.run_id=(select pg_temp.rr_run_id(406,331,1)) and i.node_id='t24' and r.id=i.run_id)='handed_off'
  and pg_temp.rr_run(406,333,1)='stopped:Appointment was rescheduled [w24=elapsed, t24=accepted:Verified provider receipt, '
    ||'w1=elapsed, e1=unknown:Email provider returned HTTP 503.]',
  'the first runs, as their outcomes left them: '||pg_temp.rr_run(406,330,1)||' / '||pg_temp.rr_run(406,331,1));

-- F2 and F3: failed, then delivered before the retry: no retry (lead 335). Delivered after the retry: both attempts are
-- kept (lead 336).
select pg_temp.rr_receipt(406,336,1,'t24','delivered',null);
select pg_temp.rr_ok('fix F2',pg_temp.rr_sent(406,335)='t24@T, t24@T2, e1@T, t1@T'
    and pg_temp.rr_run(406,335,3)='completed:Verified provider receipt [w24=elapsed, t24=skipped:Already sent for this '
      ||'appointment time, w1=elapsed, e1=accepted:Verified provider receipt, t1=accepted:Verified provider receipt]',
  'a text delivered after all is not retried: '||pg_temp.rr_run(406,335,3));
select pg_temp.rr_ok('fix F3',pg_temp.rr_sent(406,336)='t24@T, t24@T2, t24@T+retry, e1@T, t1@T'
    and pg_temp.rr_msgs(406,336,'t24')='r1:delivered, r2:accepted, r3:accepted'
    and pg_temp.rr_ledger(406,336)='t24@T#1:sms:r1:undelivered:30003, t24@T2#1:sms:r2, t24@T#2:sms:r3, e1@T#1:email:r3, t1@T#1:sms:r3',
  'delivered after the retry, both attempts stay in history: '||pg_temp.rr_msgs(406,336,'t24')||' / '||pg_temp.rr_ledger(406,336));

-- F4 (lead 337): accepted with no receipt, so the first new run skips the text as sent; a failed callback for it then
-- arrives late, and a later qualifying run retries once; late and repeated failed callbacks for both attempts never
-- authorize a third, which the record's key (attempt 1 or 2) also refuses outright.
select pg_temp.rr_receipt(406,337,1,'t24','undelivered','30003');
select pg_temp.rr_away_back(406,337,'T3','T');
select pg_temp.rr_all(406,337);
select pg_temp.rr_receipt(406,337,1,'t24','undelivered','30003');
select pg_temp.rr_receipt(406,337,5,'t24','undelivered','30003');
select pg_temp.rr_away_back(406,337,'T4','T');
select pg_temp.rr_all(406,337);
select pg_temp.rr_ok('fix F4',pg_temp.rr_sent(406,337)='t24@T, t24@T2, e1@T, t1@T, t24@T3, t24@T+retry, t24@T4'
    and pg_temp.rr_run(406,337,3)='completed:Verified provider receipt [w24=elapsed, t24=skipped:Already sent for this '
      ||'appointment time, w1=elapsed, e1=accepted:Verified provider receipt, t1=accepted:Verified provider receipt]'
    and pg_temp.rr_run(406,337,5)='completed:Already sent for this appointment time [w24=elapsed, t24=accepted:Verified provider '
      ||'receipt, w1=elapsed, e1=skipped:Already sent for this appointment time, t1=skipped:Already sent for this appointment time]'
    and pg_temp.rr_run(406,337,7)='completed:Already sent for this appointment time [w24=elapsed, t24=skipped:Not sent again: '
      ||'already retried once for this appointment time, w1=elapsed, e1=skipped:Already sent for this appointment time, '
      ||'t1=skipped:Already sent for this appointment time]'
    and pg_temp.rr_ledger(406,337)='t24@T#1:sms:r1:undelivered:30003, t24@T2#1:sms:r2, e1@T#1:email:r3, t1@T#1:sms:r3, '
      ||'t24@T3#1:sms:r4, t24@T#2:sms:r5:undelivered:30003, t24@T4#1:sms:r6',
  'a late failure allows one retry and no third attempt: '||pg_temp.rr_sent(406,337)||' / '||pg_temp.rr_ledger(406,337));
do $$
declare third text:='no record'; again text:='no record';
begin
  if pg_temp.rr_has_ledger() then
    begin
      execute $q$insert into private.automation_given_steps(organization_id,workflow_id,appointment_id,starts_at,node_id,attempt,kind,run_id)
        select pg_temp.id(1),pg_temp.id(406),b.id,b.starts,'t24',3,'sms',pg_temp.rr_run_id(406,337,7)
        from booked b where b.n=337$q$;
      third:='inserted';
    exception when check_violation then third:='refused';
      when others then third:='refused with '||sqlstate;
    end;
    begin
      execute $q$insert into private.automation_given_steps(organization_id,workflow_id,appointment_id,starts_at,node_id,attempt,kind,run_id)
        select pg_temp.id(1),pg_temp.id(406),b.id,b.starts,'t24',2,'sms',pg_temp.rr_run_id(406,337,7)
        from booked b where b.n=337$q$;
      again:='inserted';
    exception when unique_violation then again:='refused';
      when others then again:='refused with '||sqlstate;
    end;
  end if;
  perform pg_temp.rr_ok('fix F4 key',third='refused' and again='refused',
    'a third attempt, or a second attempt 2, cannot be recorded: '||third||' / '||again);
end $$;

-- G1 and G1b: before the retry, the lead's number is suppressed (an opt-out, lead 338) or put on the do-not-call list
-- (lead 339). automation_message_check skips the retry ('Not retried: the lead can no longer receive this message'),
-- there is no attempt 2, and the run's later steps still run: the hour-before email goes out, and the hour-before text,
-- a first attempt, is held for the opt-out as before. G2, a temporary failure to confirm consent, is the worker's to
-- decide (channel.ts) and is covered by its unit tests.
select pg_temp.save(n,pg_temp.rr_at(n,'T2')) from (values (338),(339)) v(n);
select pg_temp.rr_pass();
select pg_temp.rr_due(406,n) from (values (338),(339)) v(n);
insert into public.sms_suppressions(organization_id,phone_e164,reason,source_id) values (pg_temp.id(1),'+12025550338','stop','suite:338');
insert into public.dnc_list(organization_id,phone_number,reason) values (pg_temp.id(1),'+12025550339','Asked not to be contacted');
select pg_temp.save(n,pg_temp.rr_at(n,'T')) from (values (338),(339)) v(n);
select pg_temp.rr_pass();
select pg_temp.rr_all(406,n) from (values (338),(339)) v(n);
select pg_temp.rr_ok('fix G1',(select bool_and(pg_temp.rr_sent(406,n)='t24@T, t24@T2, e1@T'
    and pg_temp.rr_run(406,n,3)='held:This recipient has opted out of agency texts. [w24=elapsed, t24=skipped:Not retried: the '
      ||'lead can no longer receive this message, w1=elapsed, e1=accepted:Verified provider receipt, t1=held:This recipient has '
      ||'opted out of agency texts.]'
    and pg_temp.rr_answers(406,n,'t24')='null | null | skip:Not retried: the lead can no longer receive this message'
    and pg_temp.rr_ledger(406,n)='t24@T#1:sms:r1:undelivered:30003, t24@T2#1:sms:r2, e1@T#1:email:r3')
    from (values (338),(339)) v(n)),
  'an opted-out or do-not-call lead''s retry is skipped and the email still goes out: '||pg_temp.rr_run(406,338,3)||' / '
    ||pg_temp.rr_answers(406,339,'t24'));
-- G2 (informational, never an assertion): a temporary failure to confirm consent holds a retry. The worker decides it
-- (channel.ts), and the Deno tests in channel_test.ts cover it: 'a retry the consent service cannot verify at its first
-- check holds before any request is reserved' and 'a retry the consent service cannot verify after its request was
-- reserved holds and the reservation is cancelled'.
do $$ begin raise notice 'rr info G2: a retry consent cannot verify now is held by the worker (channel.ts, channel_test.ts)'; end $$;

-- I1 (lead 340, a run that carries on): the live run's day-before text was undelivered (30003). Cancelled and reopened at the same
-- time, the run is carried on: it never rewinds to retry that text, and its still-due hour-before text goes out once.
select pg_temp.save(340,'status=''Cancelled''');
select pg_temp.rr_pass();
select pg_temp.save(340,'status=''Scheduled''');
select pg_temp.rr_pass();
select pg_temp.rr_all(406,340);
select pg_temp.rr_ok('pin I1',pg_temp.rr_sent(406,340)='t24@T, e1@T, t1@T'
    and pg_temp.rr_runs(406,340)='completed:Verified provider receipt [w24=elapsed, t24=accepted:Verified provider receipt, '
      ||'w1=elapsed, e1=accepted:Verified provider receipt, t1=accepted:Verified provider receipt]'
    and pg_temp.rr_answers(406,340,'t24')='null',
  'a run carried on does not go back to retry, and the hour-before reminders go out once: '||pg_temp.rr_runs(406,340));
select pg_temp.rr_ok('fix I1 record',pg_temp.rr_ledger(406,340)='t24@T#1:sms:r1:undelivered:30003, e1@T#1:email:r1, t1@T#1:sms:r1',
  'the record: '||pg_temp.rr_ledger(406,340));

-- J1 (lead 341, fifty minutes out, sent late when passed; automation_run_holds' rule (a)): the run's hour-before text was rate-limited
-- (20429) and it failed. Cancelled, moved away and back while cancelled and reopened, a new run starts at T: a finished
-- or failed run does not hold a time where a text is owed its retry and the window is open. Before this change the
-- failed run held T and nothing started. The day-before text and the email are skipped, and the text is retried once.
update public.sms_dispatches d set updated_at=clock_timestamp()-interval '61 seconds' from private.automation_runs r
  where d.organization_id=r.organization_id and d.request_key='automation:'||r.id||':t1' and r.workflow_id=pg_temp.id(406)
    and r.contact_id=pg_temp.id(341);
delete from rr_plan;
select pg_temp.rr_reopen_via(341,'T2','T');
select pg_temp.rr_all(406,341);
select pg_temp.rr_ok('fix J1',pg_temp.rr_sent(406,341)='t24@T, e1@T, t1@T!reject:20429, t1@T+retry'
    and pg_temp.rr_run(406,341,2)='completed:Verified provider receipt [w24=elapsed:The reminder time had already passed, '
      ||'t24=skipped:Already sent for this appointment time, w1=elapsed:The reminder time had already passed, '
      ||'e1=skipped:Already sent for this appointment time, t1=accepted:Verified provider receipt]'
    and pg_temp.rr_ledger(406,341)='t24@T#1:sms:r1, e1@T#1:email:r1, t1@T#1:sms:r1, t1@T#2:sms:r2',
  'reopened, the rate-limited hour-before text is retried once and nothing else is repeated: '||pg_temp.rr_sent(406,341)
    ||' / '||pg_temp.rr_runs(406,341));

-- J2 (lead 342, Pins, automation_run_holds' rule (a)): the day-before text was undelivered (30003), but the hour-before time has come,
-- so its retry window is closed: the finished run still holds T, and a reopening starts nothing.
select pg_temp.rr_reopen_via(342,'T2','T');
select pg_temp.rr_all(406,342);
select pg_temp.rr_ok('pin J2',pg_temp.rr_sent(406,342)='t24@T, e1@T, t1@T'
    and pg_temp.rr_runs(406,342)='completed:Verified provider receipt [w24=elapsed:The reminder time had already passed, '
      ||'t24=accepted:Verified provider receipt, w1=elapsed:The reminder time had already passed, e1=accepted:Verified provider '
      ||'receipt, t1=accepted:Verified provider receipt]',
  'reopened after the window closed, nothing starts: '||pg_temp.rr_runs(406,342));

-- K1 (lead 343, and another agency's leads 3001 and 3002; every lookup is by organization): two agencies with the same step ids and the
-- same time. This agency's run sends both texts as first attempts, whatever the other agency's record holds, and each
-- agency's record holds only its own runs.
select pg_temp.rr_all(406,343);
select pg_temp.rr_ok('pin K1',pg_temp.rr_sent(406,343)='t24@T, e1@T, t1@T' and pg_temp.rr_answers(406,343,'t24')='null'
    and pg_temp.rr_answers(406,343,'t1')='null' and pg_temp.rr_sent(430,3001)='t24@T',
  'another agency''s record at the same time and steps changes nothing here: '||pg_temp.rr_sent(406,343)||' / '
    ||pg_temp.rr_answers(406,343,'t24')||' / '||pg_temp.rr_answers(406,343,'t1'));
do $$
declare mixed bigint;
begin
  if pg_temp.rr_has_ledger() then
    execute $q$select count(*) from private.automation_given_steps g join private.automation_runs r on r.id=g.run_id
      where g.organization_id<>r.organization_id$q$ into mixed;
  end if;
  perform pg_temp.rr_ok('fix K1 record',pg_temp.rr_ledger(406,343)='t24@T#1:sms:r1, e1@T#1:email:r1, t1@T#1:sms:r1'
      and pg_temp.rr_ledger(430,3001)='t24@T#1:sms:r1:undelivered:30003' and mixed=0,
    'each agency''s record holds its own runs: '||pg_temp.rr_ledger(406,343)||' / '||pg_temp.rr_ledger(430,3001));
end $$;

-- F1b (lead 356, the retry review's F1): the provider reports the day-before text failed with no ErrorCode, then
-- undelivered with 30003. The first failed callback is kept as a whole, so the text stays a failure with no code, which
-- is never retried: a qualifying new run at T does not send it again. Before the fix the later callback filled in the
-- code the first one lacked, and the text was retried.
insert into rr_times values (356,'T',date_trunc('minute',clock_timestamp())+interval '3 days'),
  (356,'T2',date_trunc('minute',clock_timestamp())+interval '4 days');
select pg_temp.rr_book(356,'T');
select pg_temp.rr_pass();
select pg_temp.rr_due(406,356);
select pg_temp.rr_receipt(406,356,1,'t24','failed',null);
select pg_temp.rr_receipt(406,356,1,'t24','undelivered','30003');
select pg_temp.rr_away_back(406,356,'T2','T');
select pg_temp.rr_all(406,356);
select pg_temp.rr_ok('fix F1b',pg_temp.rr_ledger(406,356)='t24@T#1:sms:r1:failed, t24@T2#1:sms:r2, e1@T#1:email:r3, t1@T#1:sms:r3'
    and pg_temp.rr_sent(406,356)='t24@T, t24@T2, e1@T, t1@T'
    and pg_temp.rr_run(406,356,3)='completed:Verified provider receipt [w24=elapsed, t24=skipped:Not sent again: delivery '
      ||'failed for this appointment time and cannot be retried, w1=elapsed, e1=accepted:Verified provider receipt, '
      ||'t1=accepted:Verified provider receipt]',
  'a failure first reported with no code stays one, and is not retried: '||pg_temp.rr_ledger(406,356)||' / '
    ||pg_temp.rr_run(406,356,3));

-- J1b (lead 355, the retry review's F2; automation_run_holds' rule (a)): the run that gave T its reminders finishes; an
-- ordinary move to T2 starts a run that gives T2 its own and finishes; an ordinary move back starts a run at T, which
-- skips every step as already sent (no failure is known yet) and finishes. Only then does the provider report T's
-- day-before text undelivered (30003). No finished run holds T while a text the automation gave there is owed its one
-- retry and the window is open, also a run that did not give that text itself, so a reopening at T (cancelled, moved
-- away and back while cancelled, reopened) starts a run that retries it once. Before the fix the last run, which gave T
-- nothing, still held T, and the retry was never sent.
create function pg_temp.rr_holds(workflow_n integer, lead_n integer, k text) returns text language sql as $$
  select coalesce(string_agg('r'||o.ord||'='||private.automation_run_holds(o.organization_id,o.run_id,
    (select t.at from rr_times t where t.n=lead_n and t.k=rr_holds.k))::text,', ' order by o.ord),'none')
  from pg_temp.rr_ords(workflow_n,lead_n) o
$$;
insert into rr_times values (355,'T',date_trunc('minute',clock_timestamp())+interval '3 days'),
  (355,'T2',date_trunc('minute',clock_timestamp())+interval '4 days');
select pg_temp.rr_book(355,'T');
select pg_temp.rr_pass();
select pg_temp.rr_all(406,355);
select pg_temp.save(355,pg_temp.rr_at(355,'T2'));
select pg_temp.rr_pass();
select pg_temp.rr_all(406,355);
select pg_temp.save(355,pg_temp.rr_at(355,'T'));
select pg_temp.rr_pass();
select pg_temp.rr_all(406,355);
select pg_temp.rr_ok('pin setup J1b',pg_temp.rr_sent(406,355)='t24@T, e1@T, t1@T, t24@T2, e1@T2, t1@T2'
    and pg_temp.rr_run(406,355,3)='completed:Already sent for this appointment time [w24=elapsed, t24=skipped:Already sent '
      ||'for this appointment time, w1=elapsed, e1=skipped:Already sent for this appointment time, t1=skipped:Already sent '
      ||'for this appointment time]',
  'back at T, the new run skips what T was given and finishes: '||pg_temp.rr_runs(406,355));
select pg_temp.rr_receipt(406,355,1,'t24','undelivered','30003');
select pg_temp.rr_ok('fix J1b holds',pg_temp.rr_holds(406,355,'T')='r1=false, r2=false, r3=false',
  'while the late failure is owed its retry, no finished run holds T: '||pg_temp.rr_holds(406,355,'T'));
select pg_temp.rr_reopen_via(355,'T2','T');
select pg_temp.rr_all(406,355);
select pg_temp.rr_ok('fix J1b',pg_temp.rr_sent(406,355)='t24@T, e1@T, t1@T, t24@T2, e1@T2, t1@T2, t24@T+retry'
    and pg_temp.rr_run(406,355,4)='completed:Already sent for this appointment time [w24=elapsed, t24=accepted:Verified '
      ||'provider receipt, w1=elapsed, e1=skipped:Already sent for this appointment time, t1=skipped:Already sent for this '
      ||'appointment time]'
    and pg_temp.rr_ledger(406,355)='t24@T#1:sms:r1:undelivered:30003, e1@T#1:email:r1, t1@T#1:sms:r1, t24@T2#1:sms:r2, '
      ||'e1@T2#1:email:r2, t1@T2#1:sms:r2, t24@T#2:sms:r4'
    and pg_temp.rr_holds(406,355,'T')='r1=true, r2=false, r3=true, r4=true',
  'reopened at T, the late failure is retried once and T is held again: '||pg_temp.rr_sent(406,355)||' / '
    ||pg_temp.rr_ledger(406,355)||' / '||pg_temp.rr_holds(406,355,'T'));

-- F2, the record's own refusals at the handoff (review RV5-5; automation_record_given, called directly): lead 335's
-- day-before text at T failed and was then delivered before any retry (F2). Recording it again for T, as a third run's
-- handoff of it would, is refused by the record's key. A retry whose read of the record, before the lock, still found
-- the text owed its retry when the receipt that delivered it committed since is refused by the delivered re-check: that
-- read is given here by a stand-in that answers 'retry', which the block undoes, with all it did, when it ends.
do $$
declare r private.automation_runs; again text:='no record'; delivered text:='no record';
begin
  if to_regprocedure('private.automation_record_given(private.automation_runs,text)') is not null then
    select x.* into r from private.automation_runs x where x.id=pg_temp.rr_run_id(406,335,3);
    begin
      execute 'select private.automation_record_given($1,$2)' using r,'t24';
      again:='recorded';
      raise exception using errcode='RRG01';
    exception when sqlstate 'RRG01' then null;
      when others then again:=sqlerrm;
    end;
    begin
      execute $f$create or replace function private.automation_step_record(p_org uuid,p_workflow uuid,p_appointment uuid,
          p_starts_at timestamptz,p_node text,p_except_run uuid) returns text language sql stable as $b$ select 'retry'::text $b$ $f$;
      execute 'select private.automation_record_given($1,$2)' using r,'t24';
      delivered:='recorded';
      raise exception using errcode='RRG01';
    exception when sqlstate 'RRG01' then null;
      when others then delivered:=sqlerrm;
    end;
  end if;
  perform pg_temp.rr_ok('fix F2 record refusals',again='This message was already given for this appointment time.'
      and delivered='The first attempt of this text was delivered.'
      and pg_temp.rr_ledger(406,335)='t24@T#1:sms:r1:undelivered:30003, t24@T2#1:sms:r2, e1@T#1:email:r3, t1@T#1:sms:r3',
    'a text given there already, and a retry of one delivered since the record was read, are refused, recording nothing: '
      ||again||' / '||delivered||' / '||pg_temp.rr_ledger(406,335));
end $$;
update public.workflows set status='paused' where id in (pg_temp.id(406),pg_temp.id(430));
update public.automation_intervals set ends_at=clock_timestamp() where workflow_id=pg_temp.id(430) and ends_at is null;
select pg_temp.retire();
-- Leads 344 to 348: a stop holds its time (automation_message_check's full stop check, the final send check's cross-run
-- guard, and automation_create_task). An automation that stops on a reply:
-- a text and a task a day before, a text an hour before. Each appointment is at T, three days out.
insert into rr_times select n,'T',date_trunc('minute',clock_timestamp())+interval '3 days' from generate_series(344,348) n;
insert into rr_times select n,'T2',date_trunc('minute',clock_timestamp())+interval '4 days' from generate_series(344,348) n;
select pg_temp.rr_analyze();
select pg_temp.publish(408,409,'A day before and an hour before (stops on a reply)',pg_temp.rr_graph_s());
select pg_temp.rr_only(408);
-- Lead 348's first day-before text is held for sending hours, so its first run gave nothing.
insert into rr_plan values (pg_temp.id(348),'t24','hold');
select pg_temp.rr_book(n,'T') from generate_series(344,348) n;
select pg_temp.rr_pass();
select pg_temp.rr_due(408,348);
delete from rr_plan;
-- An Admin stops the runs of leads 344, 345 and 347 while they wait for the day before T; lead 346 replies.
select pg_temp.admin_stop(408,n) from (values (344),(345),(347)) v(n);
select pg_temp.reply(346);
select pg_temp.rr_ok('pin setup S',(select bool_and(pg_temp.rr_runs(408,n)=case n when 346 then 'stopped:Verified reply received [w24=wait]'
      when 348 then 'held:Outside the recipient local sending window. [w24=elapsed, t24=held:Outside the recipient local sending window.]'
      else 'stopped:Stopped by user [w24=wait]' end) from generate_series(344,348) n),
  'the stops are recorded: '||pg_temp.rr_runs(408,344)||' / '||pg_temp.rr_runs(408,346));

-- B1 (lead 344): a person's stop at T, then an ordinary move to T2 (a genuinely new time, which gets its day-before text
-- and task by the existing rules) and an ordinary move back, which starts over at T. Nothing goes out at T. Before this
-- change the new run sent T's texts and created its task.
select pg_temp.rr_away_back(408,344,'T2','T');
select pg_temp.rr_all(408,344);
select pg_temp.rr_ok('fix B1',pg_temp.rr_sent(408,344)='t24@T2' and pg_temp.rr_tasks(408,344)='k24@T2'
    and pg_temp.rr_run(408,344,3)='completed:Stopped by a person for this appointment time [w24=elapsed, t24=skipped:Stopped by '
      ||'a person for this appointment time, k24=skipped:Stopped by a person for this appointment time, w1=elapsed, '
      ||'t1=skipped:Stopped by a person for this appointment time]',
  'a person''s stop at T holds T after a move away and back: '||pg_temp.rr_runs(408,344));
select pg_temp.rr_ok('pin B1 new time',pg_temp.rr_run(408,344,2)='stopped:Appointment was rescheduled [w24=elapsed, '
    ||'t24=accepted:Verified provider receipt, k24=created, w1=wait]',
  'the new time in between followed the existing rules: '||pg_temp.rr_run(408,344,2));
-- B1, the same with the move back seen before the T2 run gave anything (lead 345): that run follows the appointment back
-- to T in place, and the stop still holds T.
select pg_temp.save(345,pg_temp.rr_at(345,'T2'));
select pg_temp.rr_pass();
select pg_temp.save(345,pg_temp.rr_at(345,'T'));
select pg_temp.rr_pass();
select pg_temp.rr_all(408,345);
select pg_temp.rr_ok('fix B1 in place',pg_temp.rr_sent(408,345)='none' and pg_temp.rr_tasks(408,345)='none'
    and pg_temp.rr_runs(408,345)='stopped:Stopped by user [w24=wait] | completed:Stopped by a person for this appointment time '
      ||'[w24=elapsed, t24=skipped:Stopped by a person for this appointment time, k24=skipped:Stopped by a person for this '
      ||'appointment time, w1=elapsed, t1=skipped:Stopped by a person for this appointment time]',
  'the run that followed the move back in place gives T nothing: '||pg_temp.rr_runs(408,345));

-- B2 (lead 346): a verified reply ended the run at T (a stop rule), then an ordinary move away and back. Nothing goes out
-- at T.
select pg_temp.rr_away_back(408,346,'T2','T');
select pg_temp.rr_all(408,346);
select pg_temp.rr_ok('fix B2',pg_temp.rr_sent(408,346)='t24@T2' and pg_temp.rr_tasks(408,346)='k24@T2'
    and pg_temp.rr_run(408,346,3)='completed:Stopped by a stop rule for this appointment time [w24=elapsed, t24=skipped:Stopped '
      ||'by a stop rule for this appointment time, k24=skipped:Stopped by a stop rule for this appointment time, w1=elapsed, '
      ||'t1=skipped:Stopped by a stop rule for this appointment time]',
  'a stop rule at T holds T after a move away and back: '||pg_temp.rr_runs(408,346));

-- B3 (lead 347, Pins): a person's stop at T, then cancelled, moved away and back while cancelled and reopened at T.
-- Nothing starts.
select pg_temp.rr_reopen_via(347,'T2','T');
select pg_temp.rr_all(408,347);
select pg_temp.rr_ok('pin B3',pg_temp.rr_runs(408,347)='stopped:Stopped by user [w24=wait]' and pg_temp.rr_sent(408,347)='none',
  'reopened at a time a person stopped, nothing starts: '||pg_temp.rr_runs(408,347));

-- B4 (lead 348, the final send check's cross-run guard): the run that followed T gave nothing (its text was held) and ended as
-- rescheduled; the T2 run hands off its first text, and a move back starts a new run at T. That run is leased at its
-- day-before text; a person's stop of another booking run of the automation for the appointment then commits before
-- the handoff (written here as automation_stop_run records one, on the run that followed T, since two booking runs of an
-- automation never follow one appointment at once). The final check holds the handoff, and the next lease's full check
-- skips the step because that stop holds T.
select pg_temp.rr_away_back(408,348,'T2','T');
update private.automation_runs set due_at=clock_timestamp()-interval '1 second'
  where workflow_id=pg_temp.id(408) and contact_id=pg_temp.id(348) and status='waiting';
select pg_temp.rr_step();
do $$
declare lease jsonb;
begin
  select * into lease from public.automation_claim_work(1);
  perform pg_temp.rr_ok('pin setup B4',lease->>'node_id'='t24' and (lease->>'run_id')::uuid=pg_temp.rr_run_id(408,348,3),
    'the new run at T is leased at its day-before text');
  insert into rr_leases values (348,lease);
end $$;
update private.automation_runs r set reason='Stopped by user',ended_at=clock_timestamp(),updated_at=clock_timestamp()
  where r.id=(select pg_temp.rr_run_id(408,348,1));
do $$
declare lease jsonb:=(select l.lease from rr_leases l where l.n=348); answer text; handed boolean;
begin
  answer:=pg_temp.rr_check((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,lease->>'node_id',pg_temp.id(348));
  handed:=public.automation_authorize_handoff((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,lease->>'node_id');
  perform pg_temp.rr_ok('fix B4 guard',answer='A run of this automation for this appointment was stopped just now' and not handed
      and (select i.status from private.automation_intents i where i.run_id=(lease->>'run_id')::uuid and i.node_id='t24')='prepared',
    'a stop of another run of the automation for the appointment after this lease holds the handoff: '||coalesce(answer,'null')
      ||' / handed off: '||handed);
  perform public.automation_finish_node((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,'held',
    coalesce(answer,'Run no longer permits a provider handoff.'));
end $$;
select pg_temp.rr_all(408,348);
select pg_temp.rr_ok('fix B4',pg_temp.rr_sent(408,348)='t24@T2'
    and pg_temp.rr_run(408,348,3)='completed:Stopped by a person for this appointment time [w24=elapsed, t24=skipped:Stopped by '
      ||'a person for this appointment time, k24=skipped:Stopped by a person for this appointment time, w1=elapsed, '
      ||'t1=skipped:Stopped by a person for this appointment time]'
    and pg_temp.rr_answers(408,348,'t24')='null | null | null | A run of this automation for this appointment was stopped just now'
      ||' | skip:Stopped by a person for this appointment time',
  'the next lease skips the step because the stop holds T: '||pg_temp.rr_run(408,348,3)||' / '||pg_temp.rr_answers(408,348,'t24'));
update public.workflows set status='paused' where id=pg_temp.id(408);
select pg_temp.retire();

-- Leads 350 and 351, B2b and B2c (a stop rule's end outlives the move back's carry-on, review RV3-1): an automation that
-- stops on a reply or a conversation, with a text, an email and a task a day before and a text an hour before. Each
-- appointment is at T, three days out. The run that gave T its day-before steps starts over at T2 (an ordinary move,
-- four days out); a stop rule then ends the T2 run while it waits, before it passed a step: a verified reply (lead 350),
-- recorded at once, or a conversation (lead 351), a stop rule recorded when work is leased, so that run is still
-- waiting. An ordinary move back to T carries the first run on there and records the T2 run as replaced ('Appointment
-- was moved back'); an ordinary move to T2 again starts a run there. The stop rule's end still holds T2, so nothing goes
-- out at T2. Before the fix the move back's record of the T2 run lost the stop rule's end (a reply's reason was
-- overwritten; a conversation was never recorded), and T2's text, email and task were given again.
insert into rr_times select n,'T',date_trunc('minute',clock_timestamp())+interval '3 days' from generate_series(350,351) n;
insert into rr_times select n,'T2',date_trunc('minute',clock_timestamp())+interval '4 days' from generate_series(350,351) n;
select pg_temp.rr_analyze();
select pg_temp.publish(412,413,'A day before and an hour before (stops on a reply or a conversation)',
  jsonb_set(pg_temp.rr_graph_x('skip'),'{settings}','{"reentry":"once","stop_on_reply":true,"stop_on_contact":true}'));
select pg_temp.rr_only(412);
select pg_temp.rr_book(n,'T') from generate_series(350,351) n;
select pg_temp.rr_pass();
select pg_temp.rr_due(412,n) from generate_series(350,351) n;
select pg_temp.save(n,pg_temp.rr_at(n,'T2')) from generate_series(350,351) n;
select pg_temp.rr_pass();
select pg_temp.reply(350);
select pg_temp.talk(351);
select pg_temp.rr_ok('pin setup B2b B2c',pg_temp.rr_run(412,350,2)='stopped:Verified reply received [w24=wait]'
    and pg_temp.rr_run(412,351,2)='waiting:- [w24=wait]',
  'the reply ends the T2 run at once; the conversation is recorded when work is leased: '||pg_temp.rr_runs(412,350)||' / '
    ||pg_temp.rr_runs(412,351));
select pg_temp.save(n,pg_temp.rr_at(n,'T')) from generate_series(350,351) n;
select pg_temp.rr_pass();
select pg_temp.rr_ok('pin setup B2b B2c',(select bool_and(pg_temp.rr_runs(412,n)='waiting:- [w24=elapsed, t24=accepted:Verified '
    ||'provider receipt, e24=accepted:Verified provider receipt, k24=created, w1=wait] | stopped:Appointment was moved back '
    ||'[w24=wait]') from generate_series(350,351) n),
  'the move back carries the first run on at T and records the T2 run as replaced: '||pg_temp.rr_runs(412,350)||' / '
    ||pg_temp.rr_runs(412,351));
do $$
declare kept text:='no record';
begin
  if exists (select 1 from pg_attribute a where a.attrelid='private.automation_runs'::regclass
      and a.attname='replaced_stop_reason' and not a.attisdropped) then
    execute $q$select string_agg(coalesce(r.replaced_stop_reason,'-'),', ' order by n) from generate_series(350,351) n
      join private.automation_runs r on r.id=pg_temp.rr_run_id(412,n,2)$q$ into kept;
  end if;
  perform pg_temp.rr_ok('fix B2b B2c replaced',kept='Verified reply received, Contact was reached',
    'the replaced runs keep the stop rule''s end: '||coalesce(kept,'null'));
end $$;
select pg_temp.save(n,pg_temp.rr_at(n,'T2')) from generate_series(350,351) n;
select pg_temp.rr_pass();
select pg_temp.rr_all(412,n) from generate_series(350,351) n;
select pg_temp.rr_ok('fix B2b',pg_temp.rr_sent(412,350)='t24@T, e24@T' and pg_temp.rr_tasks(412,350)='k24@T'
    and pg_temp.rr_run(412,350,3)='completed:Stopped by a stop rule for this appointment time [w24=elapsed, '
      ||'t24=skipped:Stopped by a stop rule for this appointment time, e24=skipped:Stopped by a stop rule for this '
      ||'appointment time, k24=skipped:Stopped by a stop rule for this appointment time, w1=elapsed, t1=skipped:Stopped by '
      ||'a stop rule for this appointment time]'
    and pg_temp.rr_ledger(412,350)='t24@T#1:sms:r1, e24@T#1:email:r1, k24@T#1:task:r1',
  'a verified reply''s end at T2 holds T2 after a move back to T carried an earlier run on: '||pg_temp.rr_sent(412,350)
    ||' / '||pg_temp.rr_tasks(412,350)||' / '||pg_temp.rr_runs(412,350));
select pg_temp.rr_ok('fix B2c',pg_temp.rr_sent(412,351)='t24@T, e24@T' and pg_temp.rr_tasks(412,351)='k24@T'
    and pg_temp.rr_run(412,351,3)=pg_temp.rr_run(412,350,3)
    and pg_temp.rr_ledger(412,351)='t24@T#1:sms:r1, e24@T#1:email:r1, k24@T#1:task:r1',
  'a conversation''s end at T2, recorded only when the move back replaced the run, holds T2 too: '||pg_temp.rr_sent(412,351)
    ||' / '||pg_temp.rr_tasks(412,351)||' / '||pg_temp.rr_runs(412,351));
update public.workflows set status='paused' where id=pg_temp.id(412);
select pg_temp.retire();

-- Leads 352 to 354 (part Y, the catch-up through a passed wait as the appointment moves): an automation that texts a
-- confirmation at once, then a day before a text, a plain wait of an hour and a task, then an hour before a text (a
-- passed reminder skipped). Each appointment is at T, a day and a few seconds from now; the day before T then really
-- passes, so each run gives T its confirmation and day-before text and waits in the plain wait.
create function pg_temp.rr_graph_c() returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',jsonb_build_object('reentry','once','stop_on_reply',false),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','c','type','send_sms','version',1,'config',jsonb_build_object('body','Booked','purpose','informational')),
    jsonb_build_object('id','w24','type','wait_until_before_appointment','version',1,
      'config',jsonb_build_object('amount',24,'unit','hours','late','skip')),
    jsonb_build_object('id','t24','type','send_sms','version',1,'config',jsonb_build_object('body','See you tomorrow','purpose','informational')),
    jsonb_build_object('id','pause','type','wait','version',1,'config',jsonb_build_object('duration',1,'unit','hours')),
    jsonb_build_object('id','k24','type','create_task','version',1,'config',jsonb_build_object('title','Call to confirm',
      'task_type','Follow Up','due_amount',0,'due_unit','minutes')),
    jsonb_build_object('id','w1','type','wait_until_before_appointment','version',1,
      'config',jsonb_build_object('amount',1,'unit','hours','late','skip')),
    jsonb_build_object('id','t1','type','send_sms','version',1,'config',jsonb_build_object('body','See you in an hour','purpose','informational'))),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','c'),
      jsonb_build_object('id','b','source','c','target','w24'),jsonb_build_object('id','x','source','w24','target','t24'),
      jsonb_build_object('id','y','source','t24','target','pause'),jsonb_build_object('id','z','source','pause','target','k24'),
      jsonb_build_object('id','d','source','k24','target','w1'),jsonb_build_object('id','e','source','w1','target','t1')))
$$;
insert into rr_times select n,'T',date_trunc('second',clock_timestamp())+interval '24 hours 12 seconds' from generate_series(352,354) n;
insert into rr_times select n,'T2',date_trunc('minute',clock_timestamp())+interval '3 days' from generate_series(352,354) n;
insert into rr_times select n,'T3',date_trunc('minute',clock_timestamp())+interval '20 hours' from generate_series(352,354) n;
select pg_temp.rr_analyze();
select pg_temp.publish(414,415,'A confirmation, a day before (a text, a pause and a task) and an hour before',pg_temp.rr_graph_c());
select pg_temp.rr_only(414);
select pg_temp.rr_book(n,'T') from generate_series(352,354) n;
select pg_temp.rr_pass();
select pg_temp.rr_ok('pin setup Y',(select bool_and(pg_temp.rr_sent(414,n)='c@T' and pg_temp.rr_runs(414,n)
    ='waiting:- [c=accepted:Verified provider receipt, w24=wait]') from generate_series(352,354) n),
  'each run texts its confirmation and waits for the day before T, seconds from now: '||pg_temp.rr_runs(414,352));
select pg_sleep(greatest(0,extract(epoch from (select t.at-interval '24 hours' from rr_times t where t.n=352 and t.k='T')
  -clock_timestamp()))+0.3);
select pg_temp.rr_pass();
select pg_temp.rr_ok('pin setup Y',(select bool_and(pg_temp.rr_sent(414,n)='c@T, t24@T' and pg_temp.rr_runs(414,n)
    ='waiting:- [c=accepted:Verified provider receipt, w24=elapsed, t24=accepted:Verified provider receipt, pause=wait]')
  from generate_series(352,354) n),
  'the day before T, each run gives T its day-before text and waits in the plain wait: '||pg_temp.rr_runs(414,352));

-- Lead 352, A1 in place (review RV5-1; automation_refresh_appointment_runs follows a run through a passed wait): moved
-- to T2, where the automation starts over and the run there texts its confirmation and waits for T2's day before; moved
-- back to T. That run has given T2 something, so the first run is not carried on, and it follows the move back in
-- place, to a day-before wait that has passed for T. Another run gave that reminder at T (automation_caught_up), so the
-- run goes on past it instead of ending there: it skips the day-before text T was given and the task, late in the
-- segment the first run gave (the same time), and T gets its hour-before text. Without that, the run ended at the
-- passed wait and T never got its hour-before text.
select pg_temp.save(352,pg_temp.rr_at(352,'T2'));
select pg_temp.rr_pass();
select pg_temp.save(352,pg_temp.rr_at(352,'T'));
select pg_temp.rr_pass();
select pg_temp.rr_all(414,352);
select pg_temp.rr_ok('fix A1 in place',pg_temp.rr_sent(414,352)='c@T, t24@T, c@T2, t1@T'
    and pg_temp.rr_run(414,352,2)='completed:Verified provider receipt [c=accepted:Verified provider receipt, '
      ||'w24=elapsed:Already reached for this appointment time, t24=skipped:Already sent for this appointment time, '
      ||'pause=elapsed, k24=skipped:The reminder time had already passed, w1=elapsed, t1=accepted:Verified provider receipt]'
    and pg_temp.rr_ledger(414,352)='c@T#1:sms:r1, t24@T#1:sms:r1, c@T2#1:sms:r2, t1@T#1:sms:r2' and pg_temp.rr_tasks(414,352)='none',
  'the run that texted its confirmation at T2 follows the move back to T in place past the passed day-before wait, and '
    ||'T gets its hour-before text once: '||pg_temp.rr_sent(414,352)||' / '||pg_temp.rr_run(414,352,2));

-- Leads 353 and 354, C1b (review RV1-1; the late rule applies to the time the segment was caught up for): lead 353 is
-- moved to T2, where a run gives T2 every reminder and finishes, and back to T, where a new run passes the day-before
-- wait as already reached and waits in the plain wait. Then an ordinary move to T3, twenty hours out, a genuinely new
-- time: the run keeps its place (T3's day-before time has passed), and its task, which no run gave at T3, is created
-- there, as for lead 354, whose first run is in the same place on the same move. Before the fix the catch-up made at T
-- also made the task late at T3.
select pg_temp.save(353,pg_temp.rr_at(353,'T2'));
select pg_temp.rr_pass();
select pg_temp.rr_all(414,353);
select pg_temp.save(353,pg_temp.rr_at(353,'T'));
select pg_temp.rr_pass();
select pg_temp.rr_ok('pin setup C1b',pg_temp.rr_run(414,353,3)='waiting:- [c=skipped:Already sent for this appointment time, '
    ||'w24=elapsed:Already reached for this appointment time, t24=skipped:Already sent for this appointment time, pause=wait]',
  'back at T, the new run passes the day-before wait as already reached and waits in the plain wait: '||pg_temp.rr_runs(414,353));
select pg_temp.save(n,pg_temp.rr_at(n,'T3')) from (values (353),(354)) v(n);
select pg_temp.rr_pass();
select pg_temp.rr_all(414,n) from (values (353),(354)) v(n);
select pg_temp.rr_ok('fix C1b',pg_temp.rr_tasks(414,353)='k24@T2, k24@T3' and pg_temp.rr_sent(414,353)='c@T, t24@T, c@T2, t24@T2, '
      ||'t1@T2, t1@T3'
    and pg_temp.rr_run(414,353,3)='completed:Verified provider receipt [c=skipped:Already sent for this appointment time, '
      ||'w24=elapsed:Already reached for this appointment time, t24=skipped:Already sent for this appointment time, '
      ||'pause=elapsed, k24=created, w1=elapsed, t1=accepted:Verified provider receipt]',
  'moved on to a genuinely new time, the caught-up run creates its task there: '||pg_temp.rr_tasks(414,353)||' / '
    ||pg_temp.rr_run(414,353,3));
select pg_temp.rr_ok('pin C1b control',pg_temp.rr_tasks(414,354)='k24@T3' and pg_temp.rr_sent(414,354)='c@T, t24@T, t1@T3'
    and pg_temp.rr_runs(414,354)='completed:Verified provider receipt [c=accepted:Verified provider receipt, w24=elapsed, '
      ||'t24=accepted:Verified provider receipt, pause=elapsed, k24=created, w1=elapsed, t1=accepted:Verified provider receipt]',
  'a run that passed the day-before wait normally creates the task at T3 in the same place: '||pg_temp.rr_runs(414,354));
update public.workflows set status='paused' where id=pg_temp.id(414);
select pg_temp.retire();

-- Leads 357 to 366, B5 to B8 (a stop rule's end hidden by another end recorded first, recheck rc1, amendment A8): an
-- automation that stops on a reply or a conversation, with a text and a task a day before and a text and a task an hour
-- before. Each appointment is at T, three days out; the run that follows T gives T its day-before text and task and
-- waits for the hour before. A conversation then ends that run in fact, but something else ends it first, so it is
-- recorded as rescheduled, never as stopped by the stop rule: a cancellation, then a move to T2 while cancelled and a
-- reopening there that the conversation refuses (B5, lead 357; lead 358 moves and reopens in one save, and every save
-- of lead 359 is the calendar sync's, with no signed-in person); a move to T2 made while the call was still under way,
-- its length written after the move (B6, lead 360); or a move to T2 while the run waited for its provider's answer
-- about its day-before text (B7, lead 361). An ordinary move back to T follows. The conversation's end still holds T, so
-- T's remaining text and task are skipped as stopped by a stop rule. Before the fix the move back carried that run on,
-- counting its stop rules from the move back, so T's hour-before text and task went out. Leads 362 to 365 are controls
-- that pass before the fix too, and lead 366 records a known limitation.
create function pg_temp.rr_graph_k() returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',jsonb_build_object('reentry','once','stop_on_reply',true,
      'stop_on_contact',true),'nodes',jsonb_build_array(
    jsonb_build_object('id','start','type','appointment_booked','version',1,'config','{}'::jsonb),
    jsonb_build_object('id','w24','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',24,'unit','hours')),
    jsonb_build_object('id','t24','type','send_sms','version',1,'config',jsonb_build_object('body','See you tomorrow','purpose','informational')),
    jsonb_build_object('id','k24','type','create_task','version',1,'config',jsonb_build_object('title','Call before the appointment',
      'task_type','Follow Up','due_amount',0,'due_unit','minutes')),
    jsonb_build_object('id','w1','type','wait_until_before_appointment','version',1,'config',jsonb_build_object('amount',1,'unit','hours')),
    jsonb_build_object('id','t1','type','send_sms','version',1,'config',jsonb_build_object('body','See you in an hour','purpose','informational')),
    jsonb_build_object('id','k1','type','create_task','version',1,'config',jsonb_build_object('title','Last call before the appointment',
      'task_type','Follow Up','due_amount',0,'due_unit','minutes'))),
    'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','w24'),
      jsonb_build_object('id','b','source','w24','target','t24'),jsonb_build_object('id','c','source','t24','target','k24'),
      jsonb_build_object('id','d','source','k24','target','w1'),jsonb_build_object('id','e','source','w1','target','t1'),
      jsonb_build_object('id','f','source','t1','target','k1')))
$$;
-- A call with the lead that is under way (its length is written when it ends), and its end after three minutes.
create function pg_temp.rr_call_starts(lead_n integer) returns void language sql as $$
  insert into public.calls(id,organization_id,agent_id,contact_id,contact_type,contact_phone,direction,status,duration,started_at,
      dialer_admission_required)
    values(gen_random_uuid(),pg_temp.id(1),pg_temp.id(11),pg_temp.id(lead_n),'lead','+1202555'||lpad(lead_n::text,4,'0'),
      'outbound','connected',null,clock_timestamp(),false)
$$;
create function pg_temp.rr_call_ends(lead_n integer) returns void language sql as $$
  update public.calls set status='completed',duration=180
    where organization_id=pg_temp.id(1) and contact_id=pg_temp.id(lead_n) and status='connected'
$$;
-- How a run at T held by that end finishes: what T was given is skipped as given (the task too, when the run that
-- followed T created it), and the rest as stopped by a stop rule.
create function pg_temp.rr_held_at_t(task_given boolean) returns text language sql as $$
  select 'completed:Stopped by a stop rule for this appointment time [w24=elapsed, t24=skipped:Already sent for this '
    ||'appointment time, k24=skipped:'||case when task_given then 'Already created for this appointment time'
      else 'Stopped by a stop rule for this appointment time' end||', w1=elapsed, t1=skipped:Stopped by a stop rule for '
    ||'this appointment time, k1=skipped:Stopped by a stop rule for this appointment time]'
$$;
-- The reason a run kept for a stop rule's end something else recorded first (none where the base has no such field).
create function pg_temp.rr_kept(workflow_n integer, lead_n integer, ord integer) returns text language plpgsql as $$
declare kept text;
begin
  if not exists (select 1 from pg_attribute a where a.attrelid='private.automation_runs'::regclass
      and a.attname='replaced_stop_reason' and not a.attisdropped) then
    return 'no record';
  end if;
  execute 'select coalesce(r.replaced_stop_reason,''-'') from private.automation_runs r where r.id=$1'
    into kept using pg_temp.rr_run_id(workflow_n,lead_n,ord);
  return kept;
end $$;
insert into rr_times select n,'T',date_trunc('minute',clock_timestamp())+interval '3 days' from generate_series(357,366) n;
insert into rr_times select n,'T2',date_trunc('minute',clock_timestamp())+interval '4 days' from generate_series(357,366) n;
select pg_temp.rr_analyze();
select pg_temp.publish(416,417,'A text and a task a day before and an hour before (stops on a reply or a conversation)',
  pg_temp.rr_graph_k());
select pg_temp.rr_only(416);
-- Lead 361's day-before text is handed off and the worker stops right after; the lease that comes back for it waits for
-- the provider's answer.
insert into rr_plan values (pg_temp.id(361),'t24','crash');
select pg_temp.rr_book(n,'T') from generate_series(357,366) n;
select pg_temp.rr_pass();
select pg_temp.rr_due(416,n) from generate_series(357,366) n;
delete from rr_plan;
update private.automation_runs set leased_until=clock_timestamp()-interval '1 second'
  where workflow_id=pg_temp.id(416) and contact_id=pg_temp.id(361) and status='queued';
select pg_temp.rr_pass();
select pg_temp.rr_ok('pin setup B5',(select bool_and(pg_temp.rr_runs(416,n)=case n
      when 361 then 'unknown:Awaiting the provider receipt [w24=elapsed, t24=unknown:Awaiting the provider receipt]'
      else 'waiting:- [w24=elapsed, t24=accepted:Verified provider receipt, k24=created, w1=wait]' end)
    from generate_series(357,366) n),
  'each run gives T its day-before text and task and waits for the hour before, lead 361''s for its provider''s answer: '
    ||pg_temp.rr_runs(416,357)||' / '||pg_temp.rr_runs(416,361));
-- A conversation while each run follows T (leads 357 to 359 and 361 to 363); lead 360's call is under way.
select pg_temp.talk(n) from (values (357),(358),(359),(361),(362),(363)) v(n);
select pg_temp.rr_call_starts(360);
-- Leads 357, 358 and 363 to 365 are cancelled (lead 359 by the sync); leads 360 to 362 and 366 move to T2 in an
-- ordinary move. Each change is seen.
select pg_temp.save(n,'status=''Cancelled''') from (values (357),(358),(363),(364),(365)) v(n);
select pg_temp.sync(359,'status=''Cancelled''');
select pg_temp.save(n,pg_temp.rr_at(n,'T2')) from (values (360),(361),(362),(366)) v(n);
select pg_temp.rr_pass();
-- While cancelled, lead 365 replies (a verified reply), and leads 357, 364 and 365 move to T2; one save moves lead 358
-- to T2 and opens it (lead 359's is the sync's), and lead 363 is opened again at T. Lead 360's call ends, the provider
-- accepts lead 361's day-before text, and a call with lead 366 begins while its run follows T2 (still under way).
select pg_temp.reply(365);
select pg_temp.save(n,pg_temp.rr_at(n,'T2')) from (values (357),(364),(365)) v(n);
select pg_temp.save(358,pg_temp.rr_at(358,'T2')||',status=''Scheduled''');
select pg_temp.sync(359,pg_temp.rr_at(359,'T2')||',status=''Scheduled''');
select pg_temp.save(363,'status=''Scheduled''');
select pg_temp.rr_call_ends(360);
select pg_temp.rr_receipt(416,361,1,'t24','sent',null);
select pg_temp.rr_call_starts(366);
select pg_temp.rr_pass();
-- Leads 357, 364 and 365 are opened again at T2.
select pg_temp.save(n,'status=''Scheduled''') from (values (357),(364),(365)) v(n);
select pg_temp.rr_pass();
select pg_temp.rr_ok('pin setup B5',(select bool_and(pg_temp.rr_runs(416,n)=case
      when n in (357,358,359,365) then 'stopped:Appointment was rescheduled [w24=elapsed, t24=accepted:Verified provider '
        ||'receipt, k24=created, w1=wait]'
      when n=361 then 'stopped:Appointment was rescheduled [w24=elapsed, t24=unknown:Awaiting the provider receipt] | '
        ||'waiting:- [w24=wait]'
      when n in (362,363) then 'stopped:Contact was reached [w24=elapsed, t24=accepted:Verified provider receipt, k24=created, '
        ||'w1=wait]'||case n when 362 then ' | waiting:- [w24=wait]' else '' end
      else 'stopped:Appointment was rescheduled [w24=elapsed, t24=accepted:Verified provider receipt, k24=created, w1=wait] | '
        ||'waiting:- [w24=wait]' end)
    from generate_series(357,366) n),
  'the conversation refuses T2 for leads 357 to 359 and the reply for lead 365, and the run that followed T is recorded '
    ||'as rescheduled; leads 360, 361, 364 and 366 have a run at T2; a stop rule recorded the end of the runs of leads 362 '
    ||'(at the move) and 363 (at the reopening): '||pg_temp.rr_runs(416,357)||' / '||pg_temp.rr_runs(416,360)||' / '
    ||pg_temp.rr_runs(416,363));
-- An ordinary move back to T (lead 359's by the sync). Lead 366's call is still under way.
select pg_temp.save(n,pg_temp.rr_at(n,'T')) from (values (357),(358),(360),(361),(362),(364),(365),(366)) v(n);
select pg_temp.sync(359,pg_temp.rr_at(359,'T'));
select pg_temp.rr_pass();
select pg_temp.rr_ok('fix B5 B6 B7 kept',(select string_agg(n||'='||pg_temp.rr_kept(416,n,1),', ' order by n)
    from generate_series(357,365) n)='357=Contact was reached, 358=Contact was reached, 359=Contact was reached, '
    ||'360=Contact was reached, 361=Contact was reached, 362=-, 363=-, 364=-, 365=-',
  'the run that followed T keeps the conversation''s end that something else recorded first, and no control does: '
    ||(select string_agg(n||'='||pg_temp.rr_kept(416,n,1),', ' order by n) from generate_series(357,365) n));
select pg_temp.rr_all(416,n) from generate_series(357,365) n;
-- B5 (leads 357 to 359): the move back starts a new run at T, which skips what T was given and its remaining text and
-- task.
select pg_temp.rr_ok('fix B5 cancel',pg_temp.rr_sent(416,357)='t24@T' and pg_temp.rr_tasks(416,357)='k24@T'
    and pg_temp.rr_run(416,357,2)=pg_temp.rr_held_at_t(true) and pg_temp.rr_ledger(416,357)='t24@T#1:sms:r1, k24@T#1:task:r1',
  'a conversation, a cancellation, a move to T2 while cancelled and a reopening there that the conversation refuses, and '
    ||'an ordinary move back: T is held: '||pg_temp.rr_sent(416,357)||' / '||pg_temp.rr_tasks(416,357)||' / '
    ||pg_temp.rr_runs(416,357));
select pg_temp.rr_ok('fix B5 one save',pg_temp.rr_sent(416,358)='t24@T' and pg_temp.rr_tasks(416,358)='k24@T'
    and pg_temp.rr_run(416,358,2)=pg_temp.rr_held_at_t(true) and pg_temp.rr_ledger(416,358)='t24@T#1:sms:r1, k24@T#1:task:r1',
  'the same when one save moves the appointment to T2 and opens it: '||pg_temp.rr_sent(416,358)||' / '
    ||pg_temp.rr_tasks(416,358)||' / '||pg_temp.rr_runs(416,358));
select pg_temp.rr_ok('fix B5 sync',pg_temp.rr_sent(416,359)='t24@T' and pg_temp.rr_tasks(416,359)='k24@T'
    and pg_temp.rr_run(416,359,2)=pg_temp.rr_held_at_t(true) and pg_temp.rr_ledger(416,359)='t24@T#1:sms:r1, k24@T#1:task:r1',
  'the same when every save is the calendar sync''s, with no signed-in person: '||pg_temp.rr_sent(416,359)||' / '
    ||pg_temp.rr_tasks(416,359)||' / '||pg_temp.rr_runs(416,359));
-- B6 (lead 360) and B7 (lead 361): the run that started at T2 follows the move back to T in place, and is held there.
select pg_temp.rr_ok('fix B6 call during the move',pg_temp.rr_sent(416,360)='t24@T' and pg_temp.rr_tasks(416,360)='k24@T'
    and pg_temp.rr_run(416,360,2)=pg_temp.rr_held_at_t(true) and pg_temp.rr_ledger(416,360)='t24@T#1:sms:r1, k24@T#1:task:r1',
  'a call under way while the appointment moves to T2, which ends before the move back, still holds T: '
    ||pg_temp.rr_sent(416,360)||' / '||pg_temp.rr_tasks(416,360)||' / '||pg_temp.rr_runs(416,360));
select pg_temp.rr_ok('fix B7 provider answer',pg_temp.rr_sent(416,361)='t24@T!crash' and pg_temp.rr_tasks(416,361)='none'
    and pg_temp.rr_run(416,361,2)=pg_temp.rr_held_at_t(false)
    and pg_temp.rr_msgs(416,361,'t24')='r1:accepted' and pg_temp.rr_ledger(416,361)='t24@T#1:sms:r1',
  'a conversation while the run waits for its provider''s answer, then a move to T2, the answer, and the move back: T is '
    ||'held: '||pg_temp.rr_sent(416,361)||' / '||pg_temp.rr_tasks(416,361)||' / '||pg_temp.rr_runs(416,361));
-- The end that the move back kept holds only T, the time the reminders of the run that met it were for, never T2,
-- where the move that ended that run took it (recheck rc3: before this, the end also held T2, through that run's
-- appointment wait, which a move under way had moved to T2's slot, and the moment it ended, after the appointment stood
-- at T2). Leads 360 and 361 move to T2 again: the run that starts there gives T2 its day-before text and task.
select pg_temp.save(n,pg_temp.rr_at(n,'T2')) from (values (360),(361)) v(n);
select pg_temp.rr_pass();
select pg_temp.rr_due(416,n) from (values (360),(361)) v(n);
select pg_temp.rr_ok('fix B6 B7 T2 not held',pg_temp.rr_sent(416,360)='t24@T, t24@T2'
    and pg_temp.rr_tasks(416,360)='k24@T, k24@T2' and pg_temp.rr_sent(416,361)='t24@T!crash, t24@T2'
    and pg_temp.rr_tasks(416,361)='k24@T2'
    and pg_temp.rr_run(416,360,3)='waiting:- [w24=elapsed, t24=accepted:Verified provider receipt, k24=created, w1=wait]'
    and pg_temp.rr_run(416,361,3)='waiting:- [w24=elapsed, t24=accepted:Verified provider receipt, k24=created, w1=wait]',
  'back at T2, which the kept end does not hold, a new run gives T2 its day-before text and task: '
    ||pg_temp.rr_sent(416,360)||' / '||pg_temp.rr_tasks(416,360)||' / '||pg_temp.rr_sent(416,361)||' / '
    ||pg_temp.rr_tasks(416,361)||' / '||pg_temp.rr_runs(416,360));
-- The controls (Pins). Lead 362: the conversation is recorded at the ordinary move to T2, and the run that started
-- there follows the move back and is held at T. Lead 363: cancelled and opened again at T itself, the run ends as the
-- conversation's. Lead 364: no conversation, so T2 starts a run and the move back carries the first run on at T, which
-- gives T its hour-before text and task. Lead 365: a verified reply while the appointment is cancelled, after the run
-- ended, does not hold T, and the move back carries the run on (as leads 155 and 156 pin).
select pg_temp.rr_ok('pin B5 ordinary',pg_temp.rr_sent(416,362)='t24@T' and pg_temp.rr_tasks(416,362)='k24@T'
    and pg_temp.rr_runs(416,362)='stopped:Contact was reached [w24=elapsed, t24=accepted:Verified provider receipt, '
      ||'k24=created, w1=wait] | '||pg_temp.rr_held_at_t(true),
  'a conversation, an ordinary move to T2 and back: T is held: '||pg_temp.rr_runs(416,362));
select pg_temp.rr_ok('pin B5 cancelled at T',pg_temp.rr_sent(416,363)='t24@T' and pg_temp.rr_tasks(416,363)='k24@T'
    and pg_temp.rr_runs(416,363)='stopped:Contact was reached [w24=elapsed, t24=accepted:Verified provider receipt, '
      ||'k24=created, w1=wait]',
  'a conversation, then cancelled and opened again at T: the run ends as the conversation''s: '||pg_temp.rr_runs(416,363));
select pg_temp.rr_ok('pin B5 no conversation',pg_temp.rr_sent(416,364)='t24@T, t1@T' and pg_temp.rr_tasks(416,364)='k24@T, k1@T'
    and pg_temp.rr_runs(416,364)='completed:- [w24=elapsed, t24=accepted:Verified provider receipt, k24=created, w1=elapsed, '
      ||'t1=accepted:Verified provider receipt, k1=created] | stopped:Appointment was moved back [w24=wait]',
  'no conversation: the move back carries the first run on at T: '||pg_temp.rr_runs(416,364));
select pg_temp.rr_ok('pin B5 reply while cancelled',pg_temp.rr_sent(416,365)='t24@T, t1@T'
    and pg_temp.rr_tasks(416,365)='k24@T, k1@T'
    and pg_temp.rr_runs(416,365)='completed:- [w24=elapsed, t24=accepted:Verified provider receipt, k24=created, w1=elapsed, '
      ||'t1=accepted:Verified provider receipt, k1=created]',
  'a reply while the appointment is cancelled, after the run ended, does not hold T: '||pg_temp.rr_runs(416,365));
-- B8 (lead 366, Pins, a known limitation): a call that begins while the run at T2 follows the appointment and is still
-- under way at the move back to T has no length yet, so it is not counted when the move back replaces that run, and
-- nothing attributes it to that run later. After the call ends, a move to T2 again starts a run there that gives T2 its
-- day-before text and task.
select pg_temp.rr_call_ends(366);
select pg_temp.save(366,pg_temp.rr_at(366,'T2'));
select pg_temp.rr_pass();
select pg_temp.rr_due(416,366);
select pg_temp.rr_ok('pin B8 known limitation',pg_temp.rr_sent(416,366)='t24@T, t24@T2' and pg_temp.rr_tasks(416,366)='k24@T, k24@T2'
    and pg_temp.rr_runs(416,366)='stopped:Appointment was rescheduled [w24=elapsed, t24=accepted:Verified provider '
      ||'receipt, k24=created, w1=wait] | stopped:Appointment was moved back [w24=wait] | waiting:- [w24=elapsed, '
      ||'t24=accepted:Verified provider receipt, k24=created, w1=wait]'
    and pg_temp.rr_kept(416,366,2) in ('-','no record'),
  'a call still under way at the move back is not attributed to the run it began under, so T2 is not held: '
    ||pg_temp.rr_sent(416,366)||' / '||pg_temp.rr_tasks(416,366)||' / '||pg_temp.rr_runs(416,366));
update public.workflows set status='paused' where id=pg_temp.id(416);
select pg_temp.retire();

-- Lead 349, L1 (informational, never an assertion; nothing slow after the handoff's lock): the time automation_message_check
-- and automation_authorize_handoff take with eleven booking runs of the automation on one appointment, a person's stop
-- among them, and a long change log. Each handoff is undone at once, so every one is measured on the same lease.
insert into rr_times select 349,'T'||k,date_trunc('minute',clock_timestamp())+make_interval(days=>3+k) from generate_series(0,10) k;
select pg_temp.rr_analyze();
select pg_temp.publish(410,411,'A day before (timing)',pg_temp.rr_graph_f());
select pg_temp.rr_only(410);
select pg_temp.rr_book(349,'T0');
select pg_temp.rr_pass();
select pg_temp.rr_due(410,349);
do $$
begin
  for k in 1..9 loop
    perform pg_temp.save(349,pg_temp.rr_at(349,'T'||k));
    perform pg_temp.rr_pass();
    perform pg_temp.rr_due(410,349);
  end loop;
end $$;
select pg_temp.save(349,format('title=%L','Review '||i)) from generate_series(1,200) i;
update private.automation_runs r set reason='Stopped by user' where r.id=(select pg_temp.rr_run_id(410,349,1));
select pg_temp.save(349,pg_temp.rr_at(349,'T10'));
select pg_temp.rr_pass();
update private.automation_runs set due_at=clock_timestamp()-interval '1 second'
  where workflow_id=pg_temp.id(410) and contact_id=pg_temp.id(349) and status='waiting';
select pg_temp.rr_step();
do $$
declare lease jsonb; t0 timestamptz; checks double precision[]:='{}'; handoffs double precision[]:='{}'; answer text; ok boolean;
begin
  select * into lease from public.automation_claim_work(1);
  for i in 1..20 loop
    t0:=clock_timestamp();
    answer:=public.automation_message_check((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,lease->>'node_id');
    checks:=checks||extract(epoch from clock_timestamp()-t0)*1000;
    begin
      t0:=clock_timestamp();
      ok:=public.automation_authorize_handoff((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,lease->>'node_id');
      handoffs:=handoffs||extract(epoch from clock_timestamp()-t0)*1000;
      raise exception using errcode='RRL01';
    exception when sqlstate 'RRL01' then null;
    end;
  end loop;
  raise notice 'rr L1 timing (informational): message_check avg % ms, max % ms (%); authorize_handoff avg % ms, max % ms (%); % runs, % log rows',
    round((select avg(x) from unnest(checks) x)::numeric,3),round((select max(x) from unnest(checks) x)::numeric,3),coalesce(answer,'null'),
    round((select avg(x) from unnest(handoffs) x)::numeric,3),round((select max(x) from unnest(handoffs) x)::numeric,3),ok,
    (select count(*) from private.automation_runs r where r.workflow_id=pg_temp.id(410) and r.contact_id=pg_temp.id(349)),
    (select count(*) from private.appointment_evidence_observations x where x.appointment_id=(select b.id from booked b where b.n=349));
  perform public.automation_finish_node((lease->>'run_id')::uuid,(lease->>'lease_token')::uuid,'held','Timing only');
end $$;
update public.workflows set status='paused' where id=pg_temp.id(410);
select pg_temp.retire();
rollback;
