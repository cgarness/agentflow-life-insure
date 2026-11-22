-- Disposable SQL integration test: the guarded Automations V2 rollback applied to real V2 work.
-- Synthetic agency, contacts, calls and automations. Everything rolls back, including the rollback itself.
begin;
update private.automation_session_cutover set visibility_cutover_at=installed_at where visibility_cutover_at is null;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('7a5f0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.ok(passed boolean, message text) returns void language plpgsql as $$
begin
  if passed is distinct from true then raise exception 'Automation V2 rollback: %', message; end if;
end $$;
create function pg_temp.refused(statement text, code text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=code then return; end if;
    raise exception 'Automation V2 rollback: expected % but got % (%) for %', code, sqlstate, sqlerrm, statement;
  end;
  raise exception 'Automation V2 rollback: unexpectedly allowed: %', statement;
end $$;
create function pg_temp.act(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub',pg_temp.id(n)::text,true),
    set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','session_id',pg_temp.id(n+100),
      'app_metadata',jsonb_build_object('organization_id',pg_temp.id(1),'role',case when n=10 then 'Admin' else 'Agent' end))::text,true);
$$;
create function pg_temp.nobody() returns void language sql as $$
  select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
$$;
create function pg_temp.as_user(n integer, statement text) returns jsonb language plpgsql as $$
declare answer jsonb;
begin
  perform pg_temp.act(n);
  set local role authenticated;
  execute statement into answer;
  reset role;
  perform pg_temp.nobody();
  return answer;
exception when others then
  reset role;
  perform pg_temp.nobody();
  raise;
end $$;

insert into public.organizations(id,name,twilio_subaccount_status) values (pg_temp.id(1),'V2 rollback fixture','active');
insert into private.automation_release_controls(organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
  values (pg_temp.id(1),true,true,false);
insert into auth.users(id,email) select pg_temp.id(n),'v2-rollback-'||n||'@example.invalid' from generate_series(10,11) n;
insert into public.profiles(id,organization_id,role,status,email,first_name,last_name)
  select pg_temp.id(n),pg_temp.id(1),case when n=10 then 'Admin' else 'Agent' end,'Active',
    'v2-rollback-'||n||'@example.invalid','Fixture',n::text from generate_series(10,11) n
  on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status;
insert into auth.sessions(id,user_id,created_at) select pg_temp.id(n+100),pg_temp.id(n),clock_timestamp() from generate_series(10,11) n;
insert into public.phone_numbers(id,organization_id,phone_number,assigned_to,is_direct_line)
  values (pg_temp.id(20),pg_temp.id(1),'+15550009000',null,false);

-- A linear graph with the UUID step IDs the editor writes.
create function pg_temp.graph(steps jsonb, settings jsonb default '{"reentry":"once","stop_on_reply":false}')
returns jsonb language sql as $$
  select jsonb_build_object('format',1,'settings',settings,
    'nodes',(select jsonb_agg(jsonb_build_object('version',1,'config','{}'::jsonb)||step.value
        ||jsonb_build_object('id',pg_temp.id(500+step.ordinality::integer)) order by step.ordinality)
      from jsonb_array_elements(steps) with ordinality step),
    'edges',coalesce((select jsonb_agg(jsonb_build_object('id',pg_temp.id(600+step.ordinality::integer),
        'source',pg_temp.id(499+step.ordinality::integer),'target',pg_temp.id(500+step.ordinality::integer)) order by step.ordinality)
      from jsonb_array_elements(steps) with ordinality step where step.ordinality>1),'[]'::jsonb))
$$;
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
-- The V2 worker at its database boundary: every due step is leased, run and saved.
create function pg_temp.work() returns text language plpgsql as $$
declare c jsonb; node jsonb; made jsonb; outcome text; results text:='';
begin
  for c in select claim from public.automation_claim_work(25) claim where claim->>'organization_id'=pg_temp.id(1)::text loop
    select n into node from jsonb_array_elements(c#>'{graph,nodes}') n where n->>'id'=c->>'node_id';
    made:=null;
    if node->>'type'='create_task' then
      made:=public.automation_create_task((c->>'run_id')::uuid,(c->>'lease_token')::uuid,c->>'node_id',node#>>'{config,title}',null);
      outcome:=made->>'status';
    else
      outcome:='wait';
    end if;
    perform public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,outcome,made->>'reason');
    results:=results||outcome||' ';
  end loop;
  return btrim(results);
end $$;
create function pg_temp.missed(call_n integer) returns void language plpgsql as $$
begin
  insert into public.calls(id,organization_id,direction,status,twilio_call_sid,contact_phone,caller_id_used)
    values(pg_temp.id(call_n),pg_temp.id(1),'inbound','ringing','CA'||lpad(call_n::text,32,'0'),'+1202555'||(9000+call_n)::text,'+15550009000');
  perform public.finalize_inbound_call_terminal(pg_temp.id(call_n),pg_temp.id(1),'no-answer',true,false);
end $$;

-- Two automations the first release can run as authored, and four that need V2.
select pg_temp.publish(40,41,'First release welcome',pg_temp.graph('[
  {"type":"lead_created"},{"type":"wait","config":{"duration":1,"unit":"days"}}]'));
select pg_temp.publish(42,43,'V2 callback',pg_temp.graph('[
  {"type":"lead_created","meta":{"name":"Every new lead"}},{"type":"wait","config":{"duration":1,"unit":"days"}},
  {"type":"create_task","config":{"title":"Call the new lead","task_type":"Follow Up","due_amount":5,"due_unit":"minutes"}}]'));
select pg_temp.publish(44,45,'V2 missed call',pg_temp.graph('[
  {"type":"inbound_call_missed"},
  {"type":"create_task","config":{"title":"Call back","task_type":"Follow Up","due_amount":15,"due_unit":"minutes"}}]'));
select pg_temp.publish(46,47,'Tightened text',pg_temp.graph('[
  {"type":"lead_created","config":{"lead_source":"Never used"}},
  {"type":"send_sms","config":{"body":"Hello","purpose":"informational"}}]'));
insert into private.automation_sms_purposes(organization_id,version_id,node_id,purpose,basis)
  values (pg_temp.id(1),pg_temp.id(47),pg_temp.id(502)::text,'marketing','custom');
select pg_temp.publish(48,49,'Named welcome',pg_temp.graph('[
  {"type":"lead_created","config":{"lead_source":"Never used"},"meta":{"name":"Every new lead","description":"Internal note"}},
  {"type":"wait","config":{"duration":2,"unit":"hours"},"meta":{"name":"Give them time"}}]',
  '{"reentry":"once","stop_on_reply":false,"stop_on_booking":false,"stop_on_contact":false}'));
select pg_temp.publish(50,51,'Stops when booked',pg_temp.graph('[
  {"type":"lead_created","config":{"lead_source":"Never used"}},{"type":"wait","config":{"duration":2,"unit":"hours"}}]',
  '{"reentry":"after_end","stop_on_reply":false,"stop_on_booking":true,"stop_on_contact":false}'));
select pg_temp.ok((select count(*)=6 and bool_and(private.automation_editable_graph(graph)) from public.workflow_versions
  where organization_id=pg_temp.id(1)),'V2 accepts all six published graphs');

insert into public.leads(id,organization_id,first_name,last_name,phone,assigned_agent_id)
  values (pg_temp.id(30),pg_temp.id(1),'Ada','Lead','+12025550130',pg_temp.id(11));
select pg_temp.ok(public.automation_process_events(25)=2,'one lead enrolls in the first-release automation and the V2 callback');
select pg_temp.ok(pg_temp.work()='wait wait','both first steps are waits');
select pg_temp.ok((select count(*)=2 and bool_and(status='waiting') from private.automation_runs
  where organization_id=pg_temp.id(1)),'both runs wait a day');

-- A missed call that already produced its callback, one whose run is still queued, and one not yet enrolled.
select pg_temp.missed(60);
update private.automation_events set available_at=clock_timestamp()-interval '1 second'
  where organization_id=pg_temp.id(1) and event_type='inbound_call_missed' and processed_at is null;
select pg_temp.ok(public.automation_process_events(25)=1,'the first missed call enrolls');
select pg_temp.ok(pg_temp.work()='created','its callback is created');
select pg_temp.missed(61);
update private.automation_events set available_at=clock_timestamp()-interval '1 second'
  where organization_id=pg_temp.id(1) and event_type='inbound_call_missed' and processed_at is null;
select pg_temp.ok(public.automation_process_events(25)=1,'the second missed call enrolls and stays queued');
select pg_temp.missed(62);
insert into private.automation_intake_recovery(organization_id,event_type,source_id,contact_id,contact_type,occurred_at)
  values (pg_temp.id(1),'sale_recorded',pg_temp.id(70),null,null,clock_timestamp());
select pg_temp.ok((select count(*)=1 from private.automation_events where organization_id=pg_temp.id(1)
  and event_type='inbound_call_missed' and processed_at is null),'the third missed call is still settling');

create temporary table kept on commit drop as select
  (select count(*) from public.tasks where organization_id=pg_temp.id(1)) as tasks,
  (select count(*) from public.inbound_callbacks where organization_id=pg_temp.id(1)) as callbacks,
  (select count(*) from private.automation_task_receipts where organization_id=pg_temp.id(1)) as receipts,
  (select count(*) from private.automation_sms_purposes where organization_id=pg_temp.id(1)) as purposes,
  (select count(*) from private.automation_events where organization_id=pg_temp.id(1)) as events,
  (select count(*) from private.automation_runs where organization_id=pg_temp.id(1)) as runs,
  (select count(*) from private.automation_intake_recovery where organization_id=pg_temp.id(1)) as repairs,
  (select count(*) from public.workflow_versions where organization_id=pg_temp.id(1)) as versions,
  (select jsonb_agg(graph order by id) from public.workflow_versions where organization_id=pg_temp.id(1)) as graphs,
  (select due_at from private.automation_runs where workflow_id=pg_temp.id(40)) as first_due;
select pg_temp.ok((select callbacks=1 and receipts=1 and purposes=1 and runs=4 and repairs=1 and versions=6 from kept),
  'the fixture holds a callback, its receipt, a pinned requirement, four runs and an intake repair');

-- The operator turns enrollment and delivery off everywhere, then runs the file.
update private.automation_release_controls set enrollment_enabled=false,dispatch_enabled=false;
\ir ../migrations/rollback/20261122100600_automation_v2.rollback.sql

-- 1. The first-release functions are back and the V2 observers are detached.
select pg_temp.ok(private.automation_block_fields('create_task','1'::jsonb) is null
  and private.automation_block_fields('wait','1'::jsonb)=array['duration','unit'],'the first-release step catalog is restored');
select pg_temp.ok(private.automation_editable_graph((select graph from public.workflow_versions where id=pg_temp.id(41)))
  and not private.automation_editable_graph((select graph from public.workflow_versions where id=pg_temp.id(43)))
  and not private.automation_editable_graph((select graph from public.workflow_versions where id=pg_temp.id(45))),
  'the restored validator accepts the first-release graph and rejects the two V2 graphs');
select pg_temp.ok(not private.automation_needs_v2(pg_temp.id(1),pg_temp.id(41)) and not private.automation_needs_v2(pg_temp.id(1),pg_temp.id(49)),
  'a first-release graph, with or without step names, does not need V2');
select pg_temp.ok(private.automation_needs_v2(pg_temp.id(1),pg_temp.id(43)) and private.automation_needs_v2(pg_temp.id(1),pg_temp.id(45))
  and private.automation_needs_v2(pg_temp.id(1),pg_temp.id(47)) and private.automation_needs_v2(pg_temp.id(1),pg_temp.id(51)),
  'a V2 step, a V2 trigger, a tightened SMS requirement and a V2 stop rule each need V2');
select pg_temp.ok(not exists(select from pg_trigger where not tgisinternal and tgname like 'automation\_capture\_%'
  and tgname not in ('automation_capture_lead','automation_capture_campaign_membership')
  and tgrelid in ('public.calls'::regclass,'public.wins'::regclass,'public.policy_issuance_confirmations'::regclass,
    'private.appointment_occurrences'::regclass,'private.appointment_outcome_events'::regclass,
    'private.dialer_disposition_receipts'::regclass)),'no V2 observer remains attached');

-- 2. Only V2-only work was stopped or paused.
select pg_temp.ok((select status='waiting' and not workflow_paused and due_at=(select first_due from kept)
  from private.automation_runs where workflow_id=pg_temp.id(40)),'the first-release run keeps waiting with its due time');
select pg_temp.ok((select count(*)=2 and bool_and(status='stopped' and reason='Stopped when Automations V2 was rolled back'
    and ended_at is not null and lease_token is null)
  from private.automation_runs where workflow_id in (pg_temp.id(42),pg_temp.id(44)) and status<>'completed'),
  'the waiting V2 run and the queued missed-call run are stopped with a plain reason');
select pg_temp.ok((select status='completed' from private.automation_runs r join private.automation_events e on e.id=r.event_id
  where r.workflow_id=pg_temp.id(44) and e.source_id=pg_temp.id(60)),'a finished run is left as it ended');
select pg_temp.ok((select count(*)=2 and bool_and(status='active') from public.workflows where id in (pg_temp.id(40),pg_temp.id(48)))
  and (select count(*)=2 from public.automation_intervals where workflow_id in (pg_temp.id(40),pg_temp.id(48)) and ends_at is null),
  'the two first-release automations stay active');
select pg_temp.ok((select count(*)=4 and bool_and(status='paused') from public.workflows
    where id in (pg_temp.id(42),pg_temp.id(44),pg_temp.id(46),pg_temp.id(50)))
  and not exists(select from public.automation_intervals
    where workflow_id in (pg_temp.id(42),pg_temp.id(44),pg_temp.id(46),pg_temp.id(50)) and ends_at is null),
  'the four automations that need V2 are paused with their activation closed');
select pg_temp.ok(not exists(select from private.automation_events where organization_id=pg_temp.id(1) and processed_at is null)
  and (select retry_at='infinity' from private.automation_intake_recovery where organization_id=pg_temp.id(1)),
  'the unenrolled V2 event is settled and the V2 intake repair is parked');

-- 3. Nothing V2 created was removed or rewritten.
select pg_temp.ok((select k.tasks=(select count(*) from public.tasks where organization_id=pg_temp.id(1))
    and k.callbacks=(select count(*) from public.inbound_callbacks where organization_id=pg_temp.id(1))
    and k.receipts=(select count(*) from private.automation_task_receipts where organization_id=pg_temp.id(1))
    and k.purposes=(select count(*) from private.automation_sms_purposes where organization_id=pg_temp.id(1))
    and k.events=(select count(*) from private.automation_events where organization_id=pg_temp.id(1))
    and k.runs=(select count(*) from private.automation_runs where organization_id=pg_temp.id(1))
    and k.repairs=(select count(*) from private.automation_intake_recovery where organization_id=pg_temp.id(1))
    and k.versions=(select count(*) from public.workflow_versions where organization_id=pg_temp.id(1))
    and k.graphs=(select jsonb_agg(graph order by id) from public.workflow_versions where organization_id=pg_temp.id(1))
  from kept k),'every task, callback, receipt, pinned requirement, event, run, repair and published graph is retained');
do $$
declare target uuid:=(select id from public.inbound_callbacks where organization_id=pg_temp.id(1));
begin
  perform pg_temp.ok(pg_temp.as_user(11,format('select public.claim_inbound_callback(%L)',target))->>'status'='claimed',
    'an agent can still claim a callback that already exists');
end $$;

-- 4. A V2 automation cannot be resumed, and the first-release automation still pauses and resumes.
create function pg_temp.session() returns bigint language plpgsql as $$
begin
  perform pg_temp.act(10);
  return (public.automation_session_context()->>'revision')::bigint;
end $$;
select pg_temp.refused(format('select public.automation_lifecycle(%L,%L,%s)',pg_temp.id(42),'resume',pg_temp.session()),'PT409');
select pg_temp.refused(format('select public.automation_lifecycle(%L,%L,%s)',pg_temp.id(46),'resume',pg_temp.session()),'PT409');
select pg_temp.ok((select bool_and(status='paused') from public.workflows where id in (pg_temp.id(42),pg_temp.id(46))),
  'a refused resume leaves the automation paused');
select public.automation_lifecycle(pg_temp.id(40),'pause',pg_temp.session());
select public.automation_lifecycle(pg_temp.id(40),'resume',pg_temp.session());
select pg_temp.nobody();
select pg_temp.ok((select status='active' from public.workflows where id=pg_temp.id(40))
  and (select count(*)=1 from public.automation_intervals where workflow_id=pg_temp.id(40) and ends_at is null),
  'the first-release automation pauses and resumes');

-- 5. With enrollment back on, only first-release work starts, in the first-release worker contract.
update private.automation_release_controls set enrollment_enabled=true where organization_id=pg_temp.id(1);
select pg_temp.missed(63);
select pg_temp.ok((select count(*)=(select events from kept) from private.automation_events where organization_id=pg_temp.id(1)),
  'a missed call no longer records an automation event');
insert into public.leads(id,organization_id,first_name,last_name,phone,assigned_agent_id)
  values (pg_temp.id(31),pg_temp.id(1),'Bea','Lead','+12025550131',pg_temp.id(11));
select pg_temp.ok(public.automation_process_events(25)=1,'a new lead enrolls only in the first-release automation');
do $$
declare c jsonb;
begin
  select claim into c from public.automation_claim_work(25) claim where claim->>'organization_id'=pg_temp.id(1)::text;
  perform pg_temp.ok(c->>'contact_id'=pg_temp.id(31)::text and not c ? 'context' and not c ? 'trigger',
    'the worker receives the first-release claim shape');
  perform pg_temp.ok(public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'wait',null),'the step is saved');
  perform pg_temp.ok((select status='waiting' from private.automation_runs where id=(c->>'run_id')::uuid),'the new run waits');
end $$;
select pg_temp.ok((select count(*)=(select tasks from kept) from public.tasks where organization_id=pg_temp.id(1)),
  'no task was created after the rollback');
rollback;
