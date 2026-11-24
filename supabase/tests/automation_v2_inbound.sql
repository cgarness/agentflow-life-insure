-- Disposable SQL integration test: missed inbound calls and the claimable callback list.
-- Synthetic agency, numbers, callers and calls. Calls end through the telephony terminal writer.
begin;
update private.automation_session_cutover set visibility_cutover_at=installed_at where visibility_cutover_at is null;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('7a5e0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.ok(passed boolean, message text) returns void language plpgsql as $$
begin
  if passed is distinct from true then raise exception 'Automation V2 inbound: %', message; end if;
end $$;
create function pg_temp.refused(statement text, code text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=code then return; end if;
    raise exception 'Automation V2 inbound: expected % but got % (%) for %', code, sqlstate, sqlerrm, statement;
  end;
  raise exception 'Automation V2 inbound: unexpectedly allowed: %', statement;
end $$;
create function pg_temp.act(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub',pg_temp.id(n)::text,true),
    set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','session_id',pg_temp.id(n+100),
      'app_metadata',jsonb_build_object('organization_id',pg_temp.id(case when n=14 then 2 else 1 end),
        'role',case when n=10 then 'Admin' else 'Agent' end))::text,true);
$$;
create function pg_temp.nobody() returns void language sql as $$
  select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
$$;
-- Run one statement as a signed-in person and return its JSON answer.
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

create function pg_temp.refused_as(n integer, statement text, code text) returns void language plpgsql as $$
begin
  begin perform pg_temp.as_user(n,statement);
  exception when others then
    if sqlstate=code then return; end if;
    raise exception 'Automation V2 inbound: expected % but got % (%) for %', code, sqlstate, sqlerrm, statement;
  end;
  raise exception 'Automation V2 inbound: unexpectedly allowed for %: %', n, statement;
end $$;

insert into public.organizations(id,name,twilio_subaccount_status) values
  (pg_temp.id(1),'V2 inbound fixture','active'),(pg_temp.id(2),'Separate agency','active');
insert into private.automation_release_controls(organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
  values (pg_temp.id(1),true,true,false),(pg_temp.id(2),true,true,false);
insert into auth.users(id,email) select pg_temp.id(n),'v2-inbound-'||n||'@example.invalid' from generate_series(10,14) n;
insert into public.profiles(id,organization_id,role,status,email,first_name,last_name)
  select pg_temp.id(n),pg_temp.id(case when n=14 then 2 else 1 end),case when n=10 then 'Admin' else 'Agent' end,'Active',
    'v2-inbound-'||n||'@example.invalid','Agent',n::text from generate_series(10,14) n
  on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status,
    first_name=excluded.first_name,last_name=excluded.last_name;
insert into auth.sessions(id,user_id,created_at) select pg_temp.id(n+100),pg_temp.id(n),clock_timestamp() from generate_series(10,14) n;
insert into public.phone_numbers(id,organization_id,phone_number,assigned_to,is_direct_line) values
  (pg_temp.id(20),pg_temp.id(1),'+15550001000',null,false),
  (pg_temp.id(21),pg_temp.id(1),'+15550001001',pg_temp.id(12),true),
  (pg_temp.id(22),pg_temp.id(2),'+15550002000',null,false);
insert into public.leads(id,organization_id,first_name,last_name,phone,assigned_agent_id,user_id) values
  (pg_temp.id(30),pg_temp.id(1),'Known','Caller','+12025550130',pg_temp.id(11),pg_temp.id(11)),
  (pg_temp.id(31),pg_temp.id(1),'Unowned','Caller','+12025550131',null,null);

create function pg_temp.publish(workflow_n integer, version_n integer, title text)
returns void language plpgsql as $$
declare graph jsonb:='{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"inbound_call_missed","version":1,"config":{}},
    {"id":"task","type":"create_task","version":1,"config":{"title":"Call back the missed caller","task_type":"Follow Up","notes":"Missed inbound call","due_amount":15,"due_unit":"minutes"}}],
  "edges":[{"id":"a","source":"start","target":"task"}]}';
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
declare c jsonb; node jsonb; made jsonb;
begin
  select * into c from public.automation_claim_work(1);
  if c is null then return null; end if;
  select n into node from jsonb_array_elements(c#>'{graph,nodes}') n where n->>'id'=c->>'node_id';
  made:=public.automation_create_task((c->>'run_id')::uuid,(c->>'lease_token')::uuid,c->>'node_id',
    node#>>'{config,title}',node#>>'{config,notes}');
  perform public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,made->>'status',made->>'reason');
  return c||jsonb_build_object('result',made->>'status','reason',made->>'reason');
end $$;
-- The one parent call row an inbound call has, as ingest creates it.
create function pg_temp.ring(call_n integer, caller text, dialed text, lead_n integer default null, org_n integer default 1)
returns uuid language sql as $$
  insert into public.calls(id,organization_id,direction,status,twilio_call_sid,contact_phone,caller_id_used,contact_id,contact_type,
      contact_name,agent_id)
    values(pg_temp.id(call_n),pg_temp.id(org_n),'inbound','ringing','CA'||lpad(call_n::text,32,'0'),caller,dialed,
      case when lead_n is not null then pg_temp.id(lead_n) end,case when lead_n is not null then 'lead' end,null,null)
    returning id
$$;
-- The call ends, the event settles and the worker enrolls it.
create function pg_temp.ended(call_n integer, final text default 'no-answer') returns integer language plpgsql as $$
begin
  perform public.finalize_inbound_call_terminal(pg_temp.id(call_n),(select organization_id from public.calls where id=pg_temp.id(call_n)),final,true,false);
  update private.automation_events set available_at=clock_timestamp()-interval '1 second'
    where event_type='inbound_call_missed' and processed_at is null;
  return public.automation_process_events(25);
end $$;
select pg_temp.publish(40,41,'Missed call callback');

-- 1. An unknown caller nobody answered becomes one claimable callback, and nothing else.
select pg_temp.ring(60,'+12025559001','+15550001000');
update public.calls set is_missed=true,missed_reason='forwarded_to_mobile' where id=pg_temp.id(60);
select pg_temp.ok(not exists(select from private.automation_events where event_type='inbound_call_missed'),
  'the missed flag on a call that is still ringing proves nothing');
select pg_temp.ok((select available_at>occurred_at+interval '50 seconds' from private.automation_events
  where event_type='inbound_call_missed' and source_id=pg_temp.id(60)) is null,'no event yet');
select pg_temp.ok(pg_temp.ended(60)=1,'a call that ended unanswered enrolls once');
select pg_temp.ok((select count(*)=1 and bool_and(contact_id is null and contact_type is null and scope_key='call:'||pg_temp.id(60)::text
    and subject->>'caller_phone'='+12025559001') from private.automation_events where event_type='inbound_call_missed'),
  'the event names the call and the caller, without inventing a contact');
select public.finalize_inbound_call_terminal(pg_temp.id(60),pg_temp.id(1),'no-answer',true,false);
select pg_temp.ok((select count(*)=1 from private.automation_events where event_type='inbound_call_missed')
  and public.automation_process_events(25)=0,'a repeated terminal callback adds nothing');
create temporary table before_counts on commit drop as select (select count(*) from public.leads) as leads;
do $$
declare turn jsonb:=pg_temp.work(); item public.inbound_callbacks;
begin
  perform pg_temp.ok(turn->>'result'='created' and turn->>'contact_id' is null and turn#>>'{context,caller_phone}'='+12025559001',
    'the step runs without a contact and knows the caller''s number');
  select * into strict item from public.inbound_callbacks where call_id=pg_temp.id(60);
  perform pg_temp.ok(item.status='open' and item.claimed_by is null and item.contact_id is null and item.caller_phone='+12025559001'
    and item.title='Call back the missed caller' and item.due_at between clock_timestamp()+interval '14 minutes'
    and clock_timestamp()+interval '16 minutes','one open callback waits for anyone eligible, with no assignee');
  perform pg_temp.ok(not exists(select from public.tasks) and (select count(*) from public.leads)=(select leads from before_counts),
    'no task and no fictitious lead were created');
end $$;

-- 2. A voicemail on the same call is the same item, not a second one.
insert into public.voicemails(id,organization_id,call_id,recipient_kind,recording_sid,status)
  values (pg_temp.id(70),pg_temp.id(1),pg_temp.id(60),'group','RE'||repeat('0',30)||'70','stored');
update public.calls set voicemail_id=pg_temp.id(70) where id=pg_temp.id(60);
do $$
declare seen jsonb:=pg_temp.as_user(10,'select public.inbound_callback_queue()');
begin
  perform pg_temp.ok(seen->>'admin'='true' and jsonb_array_length(seen->'items')=1
    and seen#>>'{items,0,voicemail_id}'=pg_temp.id(70)::text and seen#>>'{items,0,contact_name}' is null
    and seen#>>'{items,0,can_claim}'='true' and seen#>>'{items,0,status}'='open',
    'the missed call and its voicemail are one callback');
end $$;

-- 3. Exactly one agent holds a claim. Others are told, the claimer can release or finish it.
do $$
declare target uuid:=(select id from public.inbound_callbacks where call_id=pg_temp.id(60)); answer jsonb;
begin
  answer:=pg_temp.as_user(11,format('select public.claim_inbound_callback(%L)',target));
  perform pg_temp.ok(answer->>'status'='claimed' and answer->>'claimed_by'=pg_temp.id(11)::text,'the first agent claims it');
  perform pg_temp.refused_as(12,format('select public.claim_inbound_callback(%L)',target),'PT409');
  answer:=pg_temp.as_user(11,format('select public.claim_inbound_callback(%L)',target));
  perform pg_temp.ok(answer->>'claimed_by'=pg_temp.id(11)::text,'claiming again is harmless for the holder');
  perform pg_temp.refused_as(12,format('select public.release_inbound_callback(%L)',target),'42501');
  perform pg_temp.refused_as(12,format('select public.complete_inbound_callback(%L)',target),'42501');
  perform pg_temp.refused_as(14,format('select public.claim_inbound_callback(%L)',target),'PT404');
  answer:=pg_temp.as_user(12,'select public.inbound_callback_queue()');
  perform pg_temp.ok(answer#>>'{items,0,status}'='claimed' and answer#>>'{items,0,claimed_by_name}'='Agent 11'
    and answer#>>'{items,0,claimed_by_me}'='false' and answer#>>'{items,0,can_claim}'='false','others see who holds it');
  answer:=pg_temp.as_user(10,format('select public.release_inbound_callback(%L)',target));
  perform pg_temp.ok(answer->>'status'='open','an administrator can release it');
  -- A session recorded as viewing as someone else cannot act on callbacks.
  insert into private.automation_sessions(session_id,actor_id,target_id) values (pg_temp.id(112),pg_temp.id(12),pg_temp.id(11));
  perform pg_temp.refused_as(12,format('select public.claim_inbound_callback(%L)',target),'42501');
  answer:=pg_temp.as_user(12,'select public.inbound_callback_queue()');
  perform pg_temp.ok(answer#>>'{items,0,can_claim}'='false','and is offered no claim');
  delete from private.automation_sessions where session_id=pg_temp.id(112);
  answer:=pg_temp.as_user(12,format('select public.claim_inbound_callback(%L)',target));
  answer:=pg_temp.as_user(12,format('select public.complete_inbound_callback(%L)',target));
  perform pg_temp.ok(answer->>'status'='done','the holder finishes it');
  answer:=pg_temp.as_user(12,'select public.inbound_callback_queue()');
  perform pg_temp.ok(jsonb_array_length(answer->'items')=0,'a finished callback leaves the list');
  perform pg_temp.ok(jsonb_array_length(pg_temp.as_user(14,'select public.inbound_callback_queue()')->'items')=0,
    'another agency''s list is its own');
end $$;

-- 4. A known caller with an active assigned agent becomes that agent's task, not a shared callback.
select pg_temp.ring(61,'+12025550130','+15550001000',30);
select pg_temp.ok(pg_temp.ended(61)=1,'known caller enrolls');
do $$
declare turn jsonb:=pg_temp.work(); made public.tasks;
begin
  perform pg_temp.ok(turn->>'result'='created','the responsible agent''s callback is created');
  select * into strict made from public.tasks where contact_id=pg_temp.id(30);
  perform pg_temp.ok(made.assigned_to=pg_temp.id(11) and made.contact_type='lead' and not made.all_day
    and made.automation_run_id=(turn->>'run_id')::uuid,'it is a timed task for the lead''s assigned agent');
  perform pg_temp.ok(not exists(select from public.inbound_callbacks where call_id=pg_temp.id(61)),'and not a shared callback');
end $$;

-- 5. A known caller nobody is responsible for waits in the list. Only people who may see the contact see the name.
select pg_temp.ring(62,'+12025550131','+15550001000',31);
select pg_temp.ok(pg_temp.ended(62)=1,'unowned caller enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='created','its callback is created');
do $$
declare item public.inbound_callbacks; seen jsonb;
begin
  select * into strict item from public.inbound_callbacks where call_id=pg_temp.id(62);
  perform pg_temp.ok(item.status='open' and item.contact_id=pg_temp.id(31) and item.contact_type='lead','the callback keeps the real contact');
  seen:=pg_temp.as_user(10,'select public.inbound_callback_queue()');
  perform pg_temp.ok(seen#>>'{items,0,contact_name}'='Unowned Caller','an administrator sees the contact');
  seen:=pg_temp.as_user(11,'select public.inbound_callback_queue()');
  perform pg_temp.ok(seen#>>'{items,0,contact_name}' is null and seen#>>'{items,0,contact_id}' is null
    and seen#>>'{items,0,caller_phone}'='+12025550131','an agent who cannot see the contact sees only the number to call');
end $$;

-- 6. An unknown caller on an agent's direct line is that agent's callback from the start.
select pg_temp.ring(63,'+12025559003','+15550001001');
select pg_temp.ok(pg_temp.ended(63)=1,'direct-line caller enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='created','its callback is created');
select pg_temp.ok((select status='claimed' and claimed_by=pg_temp.id(12) and contact_id is null from public.inbound_callbacks
  where call_id=pg_temp.id(63)),'the direct line''s owner holds it, with no invented contact');

-- 7. An answered call is never a missed call: answered on the computer, or a confirmed forwarded conversation.
select pg_temp.ring(64,'+12025559004','+15550001000');
update public.calls set agent_id=pg_temp.id(11),status='connected',routed_agent_ids=array[pg_temp.id(11)] where id=pg_temp.id(64);
select pg_temp.ok(pg_temp.ended(64,'completed')=0,'a call answered on the computer starts nothing');
select pg_temp.ring(65,'+12025559005','+15550001000');
update public.calls set is_missed=true where id=pg_temp.id(65);
select public.finalize_inbound_call_terminal(pg_temp.id(65),pg_temp.id(1),'completed',false,true);
select pg_temp.ok(not exists(select from private.automation_events where source_id in (pg_temp.id(64),pg_temp.id(65))),
  'a confirmed forwarded conversation starts nothing, whatever the missed flag says');

-- 8. A phone accepted the call but the conversation is not confirmed either way: nothing is created yet.
select pg_temp.ring(66,'+12025559006','+15550001000');
insert into public.inbound_route_attempts(id,call_id,organization_id,mode,owner_agent_id,eligibility_reason,stage,
    mobile_accepted_at,mobile_accept_result)
  values (pg_temp.id(80),pg_temp.id(66),pg_temp.id(1),'owner',pg_temp.id(11),'owner_offline_mobile','owner_mobile',clock_timestamp(),'accepted');
select pg_temp.ok(pg_temp.ended(66,'completed')=1,'an unconfirmed forward still enrolls');
do $$
declare turn jsonb:=pg_temp.work();
begin
  perform pg_temp.ok(turn->>'result'='held' and turn->>'reason'='Waiting for confirmation of whether the call was answered',
    'ambiguous evidence holds the step');
  perform pg_temp.ok(not exists(select from public.inbound_callbacks where call_id=pg_temp.id(66)),'and creates no callback');
  update public.inbound_route_attempts set mobile_bridge_evidence='not_bridged' where id=pg_temp.id(80);
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where id=(turn->>'run_id')::uuid;
  turn:=pg_temp.work();
  perform pg_temp.ok(turn->>'result'='created' and exists(select from public.inbound_callbacks
    where call_id=pg_temp.id(66) and status='open'),'once the phone is known not to have connected, the callback is created');
end $$;
select pg_temp.ring(67,'+12025559007','+15550001000');
insert into public.inbound_route_attempts(id,call_id,organization_id,mode,owner_agent_id,eligibility_reason,stage,
    mobile_accepted_at,mobile_accept_result)
  values (pg_temp.id(81),pg_temp.id(67),pg_temp.id(1),'owner',pg_temp.id(11),'owner_offline_mobile','owner_mobile',clock_timestamp(),'accepted');
select pg_temp.ok(pg_temp.ended(67,'completed')=1,'a second unconfirmed forward enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='held','it is held');
update public.inbound_route_attempts set mobile_bridge_evidence='dial_bridged',mobile_bridged_at=clock_timestamp() where id=pg_temp.id(81);
update public.calls set outcome='forwarded_answered',answered_by_agent_id=pg_temp.id(11) where id=pg_temp.id(67);
update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where status='held';
select pg_temp.ok(pg_temp.work() is null,'a run for an answered call is not handed to a worker');
select pg_temp.ok((select status='stopped' and reason='Call was answered' from private.automation_runs r
  join private.automation_events e on e.id=r.event_id where e.source_id=pg_temp.id(67))
  and not exists(select from public.inbound_callbacks where call_id=pg_temp.id(67)),'a conversation confirmed later ends the run with no callback');

-- 9. Proof of an answer that arrives after the callback exists dismisses it.
select pg_temp.ring(68,'+12025559008','+15550001000');
select pg_temp.ok(pg_temp.ended(68)=1,'another unknown caller enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='created','a callback is created');
update public.calls set outcome='forwarded_answered' where id=pg_temp.id(68);
select pg_temp.ok(not exists(select from jsonb_array_elements(pg_temp.as_user(10,'select public.inbound_callback_queue()')->'items') item
  where item->>'call_id'=pg_temp.id(68)::text),'an answered call no longer shows as a callback');
select pg_temp.ok((select status='dismissed' and closed_reason='answered' and closed_at is not null and closed_by is null
  from public.inbound_callbacks where call_id=pg_temp.id(68)),'the late answer dismissed the callback, with its reason');

-- 10. Two automations on the same trigger still make one callback per call.
select pg_temp.publish(42,43,'Second missed call automation');
select pg_temp.ring(69,'+12025559009','+15550001000');
select pg_temp.ok(pg_temp.ended(69)=2,'both automations enroll the call');
do $$
declare first jsonb:=pg_temp.work(); second jsonb:=pg_temp.work();
begin
  perform pg_temp.ok(array[first->>'result',second->>'result'] <@ array['created','skipped']
    and first->>'result'<>second->>'result','one creates the callback and the other finds it');
  perform pg_temp.ok((select count(*)=1 from public.inbound_callbacks where call_id=pg_temp.id(69)),'one callback for the call');
  perform pg_temp.ok((select count(*)=2 from private.automation_runs r join private.automation_events e on e.id=r.event_id
    where e.source_id=pg_temp.id(69) and r.status='completed'),'both runs finish');
end $$;

-- 11. Tenant isolation and activity scope.
select pg_temp.ring(90,'+12025559090','+15550002000',null,2);
select pg_temp.ok(pg_temp.ended(90)=0,'another agency''s missed call enrolls in nothing here');
select pg_temp.ok(not exists(select from private.automation_runs where organization_id=pg_temp.id(2))
  and exists(select from private.automation_events where organization_id=pg_temp.id(2) and source_id=pg_temp.id(90) and processed_at is not null),
  'its event was considered and reached none of this agency''s automations');
select pg_temp.act(10);
set local role authenticated;
do $$
declare rev bigint:=(public.automation_session_context()->>'revision')::bigint; rows jsonb;
begin
  rows:=public.automation_activity(rev,pg_temp.id(10));
  perform pg_temp.ok((select count(*)>=5 and bool_or(item->>'contact_id' is null and item->>'contact_name'='+12025559001')
    from jsonb_array_elements(rows) item),'an administrator sees runs for unmatched callers, shown by their number');
end $$;
reset role;
select pg_temp.act(11);
set local role authenticated;
do $$
declare rev bigint:=(public.automation_session_context()->>'revision')::bigint; rows jsonb;
begin
  rows:=public.automation_activity(rev,pg_temp.id(11));
  perform pg_temp.ok((select count(*)=1 and bool_and(item->>'contact_id'=pg_temp.id(30)::text)
    from jsonb_array_elements(rows) item),'an agent sees only the run for their own lead');
end $$;
reset role;
select pg_temp.nobody();
-- Browser sessions reach callbacks only through the functions above.
select pg_temp.act(11);
set local role authenticated;
select pg_temp.refused('select count(*) from public.inbound_callbacks','42501');
select pg_temp.refused('update public.inbound_callbacks set status=''open''','42501');
reset role;
select pg_temp.nobody();

-- 12. Review follow-ups ----------------------------------------------------------------------------
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
update public.workflows set status='paused' where id=pg_temp.id(42);
-- A known caller's task goes to the agent who owns the contact, whichever agent's line they rang.
select pg_temp.ring(100,'+12025550130','+15550001001',30);
select pg_temp.ok(pg_temp.ended(100)=1,'a known caller who rang another agent''s direct line enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='created','the step makes a task');
select pg_temp.ok((select t.assigned_to=pg_temp.id(11) and t.contact_id=pg_temp.id(30) from public.tasks t
    join private.automation_task_receipts x on x.record_id=t.id where x.scope_key='call:'||pg_temp.id(100)::text)
  and not exists(select from public.inbound_callbacks where call_id=pg_temp.id(100)),
  'it belongs to the agent who owns the contact, not the owner of the line that was rung');
-- A known caller whose contact has no active agent waits in Inbounds, already claimed by the agent whose line they rang.
select pg_temp.ring(101,'+12025550131','+15550001001',31);
select pg_temp.ok(pg_temp.ended(101)=1,'a missed call from an unowned contact enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='created','its callback is created');
select pg_temp.ok((select status='claimed' and claimed_by=pg_temp.id(12) and contact_id=pg_temp.id(31) from public.inbound_callbacks
  where call_id=pg_temp.id(101)),'the callback is claimed by the agent whose line was rung');
-- A bridge recorded as "unconfirmed" is unresolved: the step holds and no callback is made.
select pg_temp.ring(102,'+12025559102','+15550001000');
insert into public.inbound_route_attempts(id,call_id,organization_id,mode,owner_agent_id,eligibility_reason,stage,
    mobile_accepted_at,mobile_accept_result,mobile_bridge_evidence)
  values (pg_temp.id(82),pg_temp.id(102),pg_temp.id(1),'owner',pg_temp.id(11),'owner_offline_mobile','owner_mobile',clock_timestamp(),
    'accepted','unconfirmed');
select pg_temp.ok(pg_temp.ended(102,'completed')=1,'a forward whose bridge was recorded as unconfirmed enrolls');
do $$
declare turn jsonb:=pg_temp.work();
begin
  perform pg_temp.ok(turn->>'result'='held' and turn->>'reason'='Waiting for confirmation of whether the call was answered',
    'an unconfirmed bridge holds the step');
  update public.calls set ended_at=clock_timestamp()-interval '2 days' where id=pg_temp.id(102);
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where id=(turn->>'run_id')::uuid;
  perform pg_temp.ok(pg_temp.work()->>'result'='held','two days later it still holds');
  perform pg_temp.ok(not exists(select from public.inbound_callbacks where call_id=pg_temp.id(102)),'and no callback exists for it');
end $$;
-- A bridge result that never arrives never turns into a missed call. A definite result settles it.
select pg_temp.ring(103,'+12025559103','+15550001000');
insert into public.inbound_route_attempts(id,call_id,organization_id,mode,owner_agent_id,eligibility_reason,stage,
    mobile_accepted_at,mobile_accept_result)
  values (pg_temp.id(83),pg_temp.id(103),pg_temp.id(1),'owner',pg_temp.id(11),'owner_offline_mobile','owner_mobile',clock_timestamp(),'accepted');
select pg_temp.ok(pg_temp.ended(103,'completed')=1,'a forward without a bridge result enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='held','it is held while the bridge result may still arrive');
update public.calls set ended_at=clock_timestamp()-interval '11 minutes' where id=pg_temp.id(103);
update private.automation_runs r set due_at=clock_timestamp()-interval '1 second' from private.automation_events e
  where e.id=r.event_id and e.source_id=pg_temp.id(103);
select pg_temp.ok(pg_temp.work()->>'result'='held','eleven minutes after the call ended without a bridge result, it still holds');
select pg_temp.ok(not exists(select from public.inbound_callbacks where call_id=pg_temp.id(103)),'with no callback');
update public.inbound_route_attempts set mobile_bridge_evidence='not_bridged' where id=pg_temp.id(83);
update private.automation_runs r set due_at=clock_timestamp()-interval '1 second' from private.automation_events e
  where e.id=r.event_id and e.source_id=pg_temp.id(103);
select pg_temp.ok(pg_temp.work()->>'result'='created','once the phone is known not to have connected, the step goes on');
select pg_temp.ok(exists(select from public.inbound_callbacks where call_id=pg_temp.id(103)),'and the callback is created');
-- Proof of an answer that arrives after the callback exists: nobody can take it on, and it says why.
do $$
begin
  perform pg_temp.as_user(11,format('select public.claim_inbound_callback(%L)',
    (select id from public.inbound_callbacks where call_id=pg_temp.id(68))));
  raise exception 'Automation V2 inbound: an answered call''s callback was claimed';
exception when others then
  perform pg_temp.ok(sqlstate='PT409' and sqlerrm='This call was answered, so no callback is needed.',
    'claiming a dismissed callback says the call was answered ('||sqlstate||' '||sqlerrm||')');
end $$;
select pg_temp.ok((select status='dismissed' and claimed_by is null from public.inbound_callbacks where call_id=pg_temp.id(68)),
  'the answered call''s callback stays dismissed and unclaimed');
-- A super admin session whose mode the server cannot verify cannot act on callbacks until it signs in again.
insert into auth.users(id,email) values (pg_temp.id(16),'v2-inbound-16@example.invalid');
insert into public.profiles(id,organization_id,role,status,email,first_name,last_name,is_super_admin)
  values (pg_temp.id(16),pg_temp.id(1),'Admin','Active','v2-inbound-16@example.invalid','Super','Admin',true)
  on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status,is_super_admin=true;
insert into auth.sessions(id,user_id,created_at) values (pg_temp.id(116),pg_temp.id(16),clock_timestamp());
select pg_temp.ring(104,'+12025559104','+15550001000');
select pg_temp.ok(pg_temp.ended(104)=1,'one more unknown caller enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='created','its callback is open');
select pg_temp.ok((select item->>'can_claim'='false' from jsonb_array_elements(pg_temp.as_user(16,'select public.inbound_callback_queue()')->'items') item
  where item->>'call_id'=pg_temp.id(104)::text),'the list offers no claim to a super admin session the server cannot verify');
select pg_temp.refused_as(16,format('select public.claim_inbound_callback(%L)',
  (select id from public.inbound_callbacks where call_id=pg_temp.id(104))),'42501');
select pg_temp.as_user(16,'select public.automation_session_context()');
select pg_temp.ok(pg_temp.as_user(16,format('select public.claim_inbound_callback(%L)',
  (select id from public.inbound_callbacks where call_id=pg_temp.id(104))))->>'status'='claimed',
  'once the session is recorded, the same person can claim');
-- Text an automation rendered for a known contact is read only by people who can see the contact.
update public.inbound_callbacks set title='Call back Unowned Caller',notes='Unowned Caller asked about a term policy'
  where call_id=pg_temp.id(101);
do $$
declare mine jsonb; theirs jsonb;
begin
  select item into mine from jsonb_array_elements(pg_temp.as_user(10,'select public.inbound_callback_queue()')->'items') item
    where item->>'call_id'=pg_temp.id(101)::text;
  perform pg_temp.ok(mine->>'title'='Call back Unowned Caller' and mine->>'notes' like 'Unowned Caller%',
    'an administrator reads the title and notes rendered for the contact');
  select item into theirs from jsonb_array_elements(pg_temp.as_user(11,'select public.inbound_callback_queue()')->'items') item
    where item->>'call_id'=pg_temp.id(101)::text;
  perform pg_temp.ok(theirs->>'title'='Call back +12025550131' and theirs->'notes'='null'::jsonb,
    'an agent who cannot see the contact gets the number to call instead');
end $$;
-- 13. Only a genuinely unanswered call creates work ------------------------------------------------
update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,leased_until=null
  where organization_id=pg_temp.id(1) and status in ('queued','waiting','held');
-- Conflicting records hold the step: a bridged phone that never accepted the call.
select pg_temp.ring(120,'+12025559120','+15550001000');
insert into public.inbound_route_attempts(id,call_id,organization_id,mode,owner_agent_id,eligibility_reason,stage,
    mobile_accepted_at,mobile_accept_result,mobile_bridge_evidence)
  values (pg_temp.id(84),pg_temp.id(120),pg_temp.id(1),'owner',pg_temp.id(11),'owner_offline_mobile','owner_mobile',clock_timestamp(),
    'no_digit','dial_bridged');
select pg_temp.ok(pg_temp.ended(120,'completed')=1,'a call whose phone records disagree enrolls');
do $$
declare turn jsonb:=pg_temp.work();
begin
  perform pg_temp.ok(turn->>'result'='held' and turn->>'reason'='The call''s answer records disagree. Waiting until they agree',
    'a bridge without an acceptance holds the step as a disagreement');
  perform pg_temp.ok(not exists(select from public.inbound_callbacks where call_id=pg_temp.id(120)),'no callback for it');
end $$;
-- Conflicting records hold the step: a recorded answer while the phone shows no conversation.
select pg_temp.ring(121,'+12025559121','+15550001000');
insert into public.inbound_route_attempts(id,call_id,organization_id,mode,owner_agent_id,eligibility_reason,stage,
    mobile_accepted_at,mobile_accept_result,mobile_bridge_evidence)
  values (pg_temp.id(85),pg_temp.id(121),pg_temp.id(1),'owner',pg_temp.id(11),'owner_offline_mobile','owner_mobile',clock_timestamp(),
    'accepted','not_bridged');
select pg_temp.ok(pg_temp.ended(121,'completed')=1,'a call the phone did not connect enrolls');
update public.calls set outcome='forwarded_answered' where id=pg_temp.id(121);
do $$
declare turn jsonb:=pg_temp.work();
begin
  perform pg_temp.ok(turn->>'result'='held' and turn->>'reason'='The call''s answer records disagree. Waiting until they agree',
    'a forward answer against a phone that never connected holds the step');
  perform pg_temp.ok(not exists(select from public.inbound_callbacks where call_id=pg_temp.id(121)),'no callback for it either');
  perform pg_temp.ok((select status='held' from private.automation_runs where id=(turn->>'run_id')::uuid),
    'a disagreement does not count as an answer, so the run is not stopped');
end $$;
-- The caller hung up before the phone accepted, or nobody pressed a key: nobody answered.
select pg_temp.ring(122,'+12025559122','+15550001000');
insert into public.inbound_route_attempts(id,call_id,organization_id,mode,owner_agent_id,eligibility_reason,stage,
    mobile_accepted_at,mobile_accept_result)
  values (pg_temp.id(86),pg_temp.id(122),pg_temp.id(1),'owner',pg_temp.id(11),'owner_offline_mobile','owner_mobile',clock_timestamp(),
    'accepted_after_hangup');
select pg_temp.ring(123,'+12025559123','+15550001000');
insert into public.inbound_route_attempts(id,call_id,organization_id,mode,owner_agent_id,eligibility_reason,stage,
    mobile_accepted_at,mobile_accept_result)
  values (pg_temp.id(87),pg_temp.id(123),pg_temp.id(1),'owner',pg_temp.id(11),'owner_offline_mobile','owner_mobile',clock_timestamp(),
    'no_digit');
select pg_temp.ok(pg_temp.ended(122,'completed')+pg_temp.ended(123,'completed')=2,'both unanswered forwards enroll');
select pg_temp.ok(pg_temp.work()->>'result'='created' and pg_temp.work()->>'result'='created','each gets its callback');
select pg_temp.ok((select count(*)=2 from public.inbound_callbacks where call_id in (pg_temp.id(122),pg_temp.id(123)) and status='open'),
  'a press after the caller hung up and a missing key press are missed calls');

-- A late answer closes the known caller's automated task that is still open, with a note. A task the agent
-- already finished is left as it is.
select pg_temp.ring(124,'+12025550130','+15550001000',30);
select pg_temp.ring(125,'+12025550130','+15550001000',30);
select pg_temp.ok(pg_temp.ended(124)+pg_temp.ended(125)=2,'two missed calls from the known caller enroll');
select pg_temp.ok(pg_temp.work()->>'result'='created' and pg_temp.work()->>'result'='created','each makes the owner a task');
update public.tasks t set completed_at=clock_timestamp()-interval '1 minute',notes='Reached them on their cell'
  from private.automation_task_receipts x where x.record_id=t.id and x.scope_key='call:'||pg_temp.id(125)::text;
update public.calls set agent_id=pg_temp.id(11) where id=pg_temp.id(124);
update public.calls set outcome='forwarded_answered' where id=pg_temp.id(125);
do $$
declare open_one public.tasks; done_one public.tasks;
begin
  select t.* into strict open_one from public.tasks t join private.automation_task_receipts x on x.record_id=t.id
    where x.scope_key='call:'||pg_temp.id(124)::text;
  select t.* into strict done_one from public.tasks t join private.automation_task_receipts x on x.record_id=t.id
    where x.scope_key='call:'||pg_temp.id(125)::text;
  perform pg_temp.ok(open_one.completed_at is not null
    and open_one.notes='Missed inbound call'||E'\n\n'||'Closed automatically: the call was answered.',
    'the still-open task is closed with a note saying the call was answered');
  perform pg_temp.ok(done_one.completed_at<clock_timestamp()-interval '50 seconds' and done_one.notes='Reached them on their cell',
    'the task the agent finished keeps its own time and notes');
end $$;
-- A late answer also dismisses a callback someone already claimed, and Done then says why.
select pg_temp.ring(126,'+12025559126','+15550001000');
select pg_temp.ok(pg_temp.ended(126)=1,'one more unknown caller enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='created','its callback is created');
select pg_temp.ok(pg_temp.as_user(11,format('select public.claim_inbound_callback(%L)',
  (select id from public.inbound_callbacks where call_id=pg_temp.id(126))))->>'status'='claimed','an agent claims it');
update public.calls set outcome='forwarded_answered' where id=pg_temp.id(126);
do $$
begin
  perform pg_temp.ok((select status='dismissed' and closed_reason='answered' from public.inbound_callbacks where call_id=pg_temp.id(126)),
    'the claimed callback is dismissed once the answer is confirmed');
  perform pg_temp.as_user(11,format('select public.complete_inbound_callback(%L)',
    (select id from public.inbound_callbacks where call_id=pg_temp.id(126))));
  raise exception 'Automation V2 inbound: a dismissed callback was completed';
exception when others then
  perform pg_temp.ok(sqlstate='PT409' and sqlerrm='This call was answered, so no callback is needed.',
    'Done on a dismissed callback says the call was answered ('||sqlstate||' '||sqlerrm||')');
end $$;
-- The phone's bridge result alone confirms an answer when the call row was not updated with it.
select pg_temp.ring(127,'+12025559127','+15550001000');
insert into public.inbound_route_attempts(id,call_id,organization_id,mode,owner_agent_id,eligibility_reason,stage,
    mobile_accepted_at,mobile_accept_result,mobile_bridge_evidence)
  values (pg_temp.id(88),pg_temp.id(127),pg_temp.id(1),'owner',pg_temp.id(11),'owner_offline_mobile','owner_mobile',clock_timestamp(),
    'accepted','not_bridged');
select pg_temp.ok(pg_temp.ended(127,'completed')=1,'a call the phone did not connect enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='created','its callback is created');
update public.inbound_route_attempts set mobile_bridge_evidence='dial_bridged',mobile_bridged_at=clock_timestamp() where id=pg_temp.id(88);
select pg_temp.ok((select status='dismissed' and closed_reason='answered' from public.inbound_callbacks where call_id=pg_temp.id(127)),
  'a bridge result confirming the conversation dismisses the callback');
-- An unfinished run for a call answered late stops before its next step.
select pg_temp.ring(128,'+12025559128','+15550001000');
insert into public.inbound_route_attempts(id,call_id,organization_id,mode,owner_agent_id,eligibility_reason,stage,
    mobile_accepted_at,mobile_accept_result)
  values (pg_temp.id(89),pg_temp.id(128),pg_temp.id(1),'owner',pg_temp.id(11),'owner_offline_mobile','owner_mobile',clock_timestamp(),'accepted');
select pg_temp.ok(pg_temp.ended(128,'completed')=1,'an accepted forward enrolls');
select pg_temp.ok(pg_temp.work()->>'result'='held','it holds for the bridge result');
update public.inbound_route_attempts set mobile_bridge_evidence='dial_bridged',mobile_bridged_at=clock_timestamp() where id=pg_temp.id(89);
update private.automation_runs r set due_at=clock_timestamp()-interval '1 second' from private.automation_events e
  where e.id=r.event_id and e.source_id=pg_temp.id(128);
select pg_temp.ok(pg_temp.work() is null,'the answered call''s run is not handed to a worker');
select pg_temp.ok((select status='stopped' and reason='Call was answered' from private.automation_runs r
  join private.automation_events e on e.id=r.event_id where e.source_id=pg_temp.id(128))
  and not exists(select from public.inbound_callbacks where call_id=pg_temp.id(128)),'the run stopped with no callback');

-- 14. The list: newer claimed callbacks never hide an older open one, and the counts cover every waiting callback.
update public.inbound_callbacks set status='done',closed_at=clock_timestamp() where organization_id=pg_temp.id(1) and status in ('open','claimed');
select pg_temp.ring(n,'+1202557'||lpad(n::text,4,'0'),'+15550001000') from generate_series(400,501) n;
insert into public.inbound_callbacks(organization_id,call_id,caller_phone,title,status,claimed_by,claimed_at,due_at,created_at)
  select pg_temp.id(1),pg_temp.id(n),'+1202557'||lpad(n::text,4,'0'),'Call back','claimed',pg_temp.id(12),clock_timestamp(),
    clock_timestamp()+interval '15 minutes',clock_timestamp()-make_interval(secs=>501-n)
  from generate_series(401,501) n;
insert into public.inbound_callbacks(organization_id,call_id,caller_phone,title,status,due_at,created_at)
  values (pg_temp.id(1),pg_temp.id(400),'+12025570400','Call back the oldest caller','open',
    clock_timestamp()-interval '2 hours 45 minutes',clock_timestamp()-interval '3 hours');
do $$
declare listed jsonb:=pg_temp.as_user(11,'select public.inbound_callback_queue()');
begin
  perform pg_temp.ok((listed->>'available')::boolean and (listed->>'open_count')::integer=1 and (listed->>'claimed_count')::integer=101,
    'the counts cover all 102 waiting callbacks: 1 open and 101 claimed');
  perform pg_temp.ok(jsonb_array_length(listed->'items')=100 and listed->'items'->0->>'call_id'=pg_temp.id(400)::text
    and listed->'items'->0->>'status'='open','the older open callback heads the list ahead of 101 newer claimed ones');
  perform pg_temp.ok((select bool_and(item->>'status'='claimed') from jsonb_array_elements(listed->'items') with ordinality i(item,n) where n>1),
    'claimed callbacks follow it');
end $$;

-- 15. The callback list belongs to the Automations pilot. An agency without the builder has none.
update private.automation_release_controls set builder_visible=false where organization_id=pg_temp.id(2);
insert into public.inbound_callbacks(id,organization_id,call_id,caller_phone,title)
  values (pg_temp.id(130),pg_temp.id(2),pg_temp.id(90),'+12025559090','Call back');
do $$
declare theirs jsonb:=pg_temp.as_user(14,'select public.inbound_callback_queue()');
begin
  perform pg_temp.ok(theirs->>'available'='false' and theirs->'items'='[]'::jsonb and (theirs->>'open_count')::integer=0,
    'an agency outside the pilot is told it has no callback list');
  perform pg_temp.ok(pg_temp.as_user(11,'select public.inbound_callback_queue()')->>'available'='true','the pilot agency has its list');
end $$;
select pg_temp.refused_as(14,format('select public.claim_inbound_callback(%L)',pg_temp.id(130)),'42501');
select pg_temp.refused_as(14,format('select public.release_inbound_callback(%L)',pg_temp.id(130)),'42501');
select pg_temp.refused_as(14,format('select public.complete_inbound_callback(%L)',pg_temp.id(130)),'42501');
select pg_temp.ok((select status='open' and claimed_by is null from public.inbound_callbacks where id=pg_temp.id(130)),
  'nothing outside the pilot changed the callback');
rollback;
