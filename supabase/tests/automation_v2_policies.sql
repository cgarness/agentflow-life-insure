-- Disposable SQL integration test: policy follow-through after a recorded sale and a confirmed issuance.
-- Synthetic agency, clients and policies. Sales are recorded through the CRM's own sale writers.
begin;
update private.automation_session_cutover set visibility_cutover_at=installed_at where visibility_cutover_at is null;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('7a5f0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.ok(passed boolean, message text) returns void language plpgsql as $$
begin
  if passed is distinct from true then raise exception 'Automation V2 policies: %', message; end if;
end $$;
create function pg_temp.act(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub',pg_temp.id(n)::text,true),
    set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','session_id',pg_temp.id(n+100),
      'app_metadata',jsonb_build_object('organization_id',pg_temp.id(case when n=14 then 2 else 1 end),
        'role',case n when 10 then 'Admin' when 13 then 'Team Leader' else 'Agent' end))::text,true);
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
create function pg_temp.refused_as(n integer, statement text, code text) returns void language plpgsql as $$
begin
  begin perform pg_temp.as_user(n,statement);
  exception when others then
    if sqlstate=code then return; end if;
    raise exception 'Automation V2 policies: expected % but got % (%) for %', code, sqlstate, sqlerrm, statement;
  end;
  raise exception 'Automation V2 policies: unexpectedly allowed for %: %', n, statement;
end $$;

insert into public.organizations(id,name) values (pg_temp.id(1),'V2 policy fixture'),(pg_temp.id(2),'Separate agency');
insert into public.company_settings(company_name,organization_id,timezone) values ('V2 policy fixture',pg_temp.id(1),'America/Chicago');
insert into private.automation_release_controls(organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
  values (pg_temp.id(1),true,true,false),(pg_temp.id(2),true,true,false);
insert into auth.users(id,email) select pg_temp.id(n),'v2-policy-'||n||'@example.invalid' from generate_series(10,14) n;
insert into public.profiles(id,organization_id,role,status,email,first_name,last_name)
  select pg_temp.id(n),pg_temp.id(case when n=14 then 2 else 1 end),
    case n when 10 then 'Admin' when 13 then 'Team Leader' else 'Agent' end,'Active','v2-policy-'||n||'@example.invalid','Person',n::text
  from generate_series(10,14) n
  on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status,
    first_name=excluded.first_name,last_name=excluded.last_name;
-- Person 13 leads the team that agent 11 is on. Agent 12 is a peer outside it.
update public.profiles set upline_id=pg_temp.id(13) where id=pg_temp.id(11);
update public.profiles set upline_id=upline_id where id=pg_temp.id(11);
select pg_temp.ok(public.is_ancestor_of(pg_temp.id(13),pg_temp.id(11)) and not public.is_ancestor_of(pg_temp.id(13),pg_temp.id(12)),
  'fixture hierarchy: the team leader is above agent 11 only');
insert into auth.sessions(id,user_id,created_at) select pg_temp.id(n+100),pg_temp.id(n),clock_timestamp() from generate_series(10,14) n;

create function pg_temp.publish(workflow_n integer, version_n integer, title text, trigger_type text, task_title text, task_type text)
returns void language plpgsql as $$
declare graph jsonb:=jsonb_build_object('format',1,'settings',jsonb_build_object('reentry','once','stop_on_reply',false),
  'nodes',jsonb_build_array(jsonb_build_object('id','start','type',trigger_type,'version',1,'config','{}'::jsonb),
    jsonb_build_object('id','task','type','create_task','version',1,'config',jsonb_build_object(
      'title',task_title,'task_type',task_type,'due_amount',3,'due_unit','days'))),
  'edges',jsonb_build_array(jsonb_build_object('id','a','source','start','target','task')));
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
select pg_temp.publish(20,21,'After a sale','sale_recorded','Check the application status','Check Application');
select pg_temp.publish(22,23,'After issuance','policy_issuance_confirmed','Deliver the policy','Policy Review');

-- The agent records a sale with a new client, a second policy for the same client, and a historical policy.
create temporary table sold(label text primary key, answer jsonb) on commit drop;
grant select,insert on sold to authenticated;
create temporary table before_counts on commit drop as
  select (select count(*) from public.policy_commission_estimates) as estimates;
select pg_temp.act(11);
set local role authenticated;
insert into sold values ('client',public.create_client_with_sale(pg_temp.id(60),pg_temp.id(1),jsonb_build_object(
  'first_name','Policy','last_name','Holder','assigned_agent_id',pg_temp.id(11),'policy_type','Term','carrier','Fixture Life',
  'premium',100,'sold_date',(now() at time zone 'America/Chicago')::date::text,'payment_frequency','monthly'),true));
insert into sold values ('second',public.record_client_policy(pg_temp.id(61),(select (answer->>'client_id')::uuid from sold where label='client'),
  jsonb_build_object('policy_type','Whole Life','carrier','Fixture Life','premium',80,'sold_date',(now() at time zone 'America/Chicago')::date::text)));
insert into sold values ('historical',public.record_client_policy(pg_temp.id(62),(select (answer->>'client_id')::uuid from sold where label='client'),
  jsonb_build_object('policy_type','Final Expense','carrier','Fixture Life','premium',40,'sold_date','2024-03-01','sale_mode','historical')));
reset role;
select pg_temp.nobody();
create temporary table policy(label text primary key, id uuid) on commit drop;
grant select on policy to authenticated;
insert into policy select 'client',(answer->>'client_id')::uuid from sold where label='client';
insert into policy select 'primary',c.primary_policy_id from public.clients c where c.id=(select id from policy where label='client');
insert into policy select case w.event_time_source when 'event' then 'second' else 'historical' end,w.policy_id from public.wins w
  where w.contact_id=(select id from policy where label='client') and w.policy_id<>(select id from policy where label='primary');
select pg_temp.ok((select count(*)=4 from policy) and (select count(*)=3 from public.wins
  where contact_id=(select id from policy where label='client')),'one client holds three policies, each with its own sale');

select pg_temp.ok((select count(*)=2 and count(distinct scope_key)=2 and bool_and(contact_type='client' and campaign_id is null)
  from private.automation_events where event_type='sale_recorded'),'each live sale is its own event; the historical entry is none');
select pg_temp.ok(not exists(select from private.automation_events e where e.subject->>'policy_id'=(select id::text from policy where label='historical')),
  'a historical policy entry starts nothing');
select pg_temp.ok(public.automation_process_events(25)=2,'both live sales enroll in the sale follow-up');
select pg_temp.ok(not exists(select from private.automation_runs where workflow_id=pg_temp.id(22)),
  'a recorded sale is not an issued policy');
select pg_temp.ok(pg_temp.work()->>'result'='created','the first application-status task is created');
select pg_temp.ok(pg_temp.work()->>'result'='created','the second policy gets its own task');
select pg_temp.ok((select count(*)=2 and bool_and(assigned_to=pg_temp.id(11) and contact_type='client' and task_type='Check Application'
  and not all_day and due_date between clock_timestamp()+interval '71 hours' and clock_timestamp()+interval '73 hours')
  from public.tasks where contact_id=(select id from policy where label='client')),
  'two policies on one client are followed independently, three days out');
select pg_temp.ok(pg_temp.work() is null,'nothing else is due');

-- Dates on the client record are not issuance.
update public.clients set effective_date='2026-11-01',issue_date='2026-11-02' where id=(select id from policy where label='client');
select pg_temp.ok(not exists(select from private.automation_events where event_type='policy_issuance_confirmed'),
  'an effective date or the old issue-date text never confirms issuance');

-- Who sees what, and who may confirm.
do $$
declare client uuid:=(select id from policy where label='client'); first_policy uuid:=(select id from policy where label='primary');
  listed jsonb; answer jsonb; today text:=(now() at time zone 'America/Chicago')::date::text;
begin
  listed:=pg_temp.as_user(11,format('select public.get_policy_issuance(%L)',client));
  perform pg_temp.ok(jsonb_array_length(listed)=3 and listed#>>'{0,policy_id}'=first_policy::text
    and (select bool_and(item->>'can_confirm'='true' and item->>'issued_on' is null) from jsonb_array_elements(listed) item),
    'the client''s agent sees each stored policy as unconfirmed and confirmable');
  perform pg_temp.ok(pg_temp.as_user(14,format('select public.get_policy_issuance(%L)',client))='[]'::jsonb,'another agency sees nothing');
  perform pg_temp.ok((select coalesce(bool_and(item->>'can_confirm'='false'),true)
    from jsonb_array_elements(pg_temp.as_user(12,format('select public.get_policy_issuance(%L)',client))) item),
    'a peer agent is never offered the action');
  perform pg_temp.refused_as(12,format('select public.confirm_policy_issuance(%L,%L,%L)',pg_temp.id(70),first_policy,today),'42501');
  perform pg_temp.refused_as(14,format('select public.confirm_policy_issuance(%L,%L,%L)',pg_temp.id(70),first_policy,today),'PT404');
  perform pg_temp.refused_as(11,format('select public.confirm_policy_issuance(%L,%L,%L)',pg_temp.id(70),first_policy,
    ((now() at time zone 'America/Chicago')::date+3)::text),'22023');
  perform pg_temp.refused_as(11,format('select public.confirm_policy_issuance(%L,%L,%L)',pg_temp.id(70),gen_random_uuid(),today),'PT404');
  -- A session recorded as viewing as someone else cannot confirm.
  insert into private.automation_sessions(session_id,actor_id,target_id) values (pg_temp.id(111),pg_temp.id(11),pg_temp.id(12));
  perform pg_temp.refused_as(11,format('select public.confirm_policy_issuance(%L,%L,%L)',pg_temp.id(70),first_policy,today),'42501');
  perform pg_temp.ok((select bool_and(item->>'can_confirm'='false')
    from jsonb_array_elements(pg_temp.as_user(11,format('select public.get_policy_issuance(%L)',client))) item),
    'and is not offered the action');
  delete from private.automation_sessions where session_id=pg_temp.id(111);
  perform pg_temp.ok(not exists(select from public.policy_issuance_confirmations),'no refused attempt recorded anything');

  answer:=pg_temp.as_user(11,format('select public.confirm_policy_issuance(%L,%L,%L)',pg_temp.id(70),first_policy,today));
  perform pg_temp.ok(answer->>'policy_id'=first_policy::text and answer->>'issued_on'=today and answer->>'idempotent'='false',
    'the client''s agent confirms issuance');
  answer:=pg_temp.as_user(11,format('select public.confirm_policy_issuance(%L,%L,%L)',pg_temp.id(70),first_policy,today));
  perform pg_temp.ok(answer->>'idempotent'='true','a retried request is the same confirmation');
  answer:=pg_temp.as_user(10,format('select public.confirm_policy_issuance(%L,%L,%L)',pg_temp.id(71),first_policy,today));
  perform pg_temp.ok(answer->>'idempotent'='true','confirming the same date again changes nothing');
  perform pg_temp.refused_as(10,format('select public.confirm_policy_issuance(%L,%L,%L)',pg_temp.id(72),first_policy,
    ((now() at time zone 'America/Chicago')::date-5)::text),'PT409');
  perform pg_temp.ok((select count(*)=1 and bool_and(organization_id=pg_temp.id(1) and client_id=client and confirmed_by=pg_temp.id(11)
    and confirmed_at is not null and issued_on::text=today) from public.policy_issuance_confirmations),
    'one record holds the policy, agency, person, issue date and confirmation time');
  listed:=pg_temp.as_user(11,format('select public.get_policy_issuance(%L)',client));
  perform pg_temp.ok(listed#>>'{0,issued_on}'=today and listed#>>'{0,can_confirm}'='false' and listed#>>'{0,confirmed_by_name}'='Person 11'
    and listed#>>'{1,issued_on}' is null and listed#>>'{1,can_confirm}'='true','only that policy shows as issued');
end $$;
select pg_temp.ok((select count(*)=1 and bool_and(contact_type='client' and scope_key='issuance:'||(select id::text from policy where label='primary'))
  from private.automation_events where event_type='policy_issuance_confirmed'),'the confirmation is one event for that policy');
select pg_temp.ok(public.automation_process_events(25)=1,'the confirmed policy enrolls in delivery follow-up');
select pg_temp.ok(pg_temp.work()->>'result'='created','the delivery task is created');
select pg_temp.ok((select count(*)=1 from public.tasks where title='Deliver the policy' and assigned_to=pg_temp.id(11)),
  'one delivery task, for the confirmed policy only');

-- The second policy is confirmed separately, by the team leader above the agent.
select pg_temp.as_user(13,format('select public.confirm_policy_issuance(%L,%L,%L)',pg_temp.id(73),
  (select id from policy where label='second'),((now() at time zone 'America/Chicago')::date-1)::text));
select pg_temp.ok(public.automation_process_events(25)=1,'the second policy enrolls independently');
select pg_temp.ok(pg_temp.work()->>'result'='created','and gets its own delivery task');
select pg_temp.ok((select count(*)=2 from public.tasks where title='Deliver the policy'),'two policies, two delivery tasks');

-- A historical policy can be confirmed for the record. It still starts no follow-up.
select pg_temp.as_user(10,format('select public.confirm_policy_issuance(%L,%L,%L)',pg_temp.id(74),
  (select id from policy where label='historical'),'2024-03-20'));
select pg_temp.ok((select count(*)=3 from public.policy_issuance_confirmations)
  and (select count(*)=2 from private.automation_events where event_type='policy_issuance_confirmed'),
  'confirming a historical policy is recorded without an automation event');
select pg_temp.ok(public.automation_process_events(25)=0,'and enrolls nothing');

-- A confirmation is permanent, and nothing here touched sales or commission records.
do $$
begin
  begin
    update public.policy_issuance_confirmations set issued_on=issued_on-1;
    raise exception 'Automation V2 policies: a confirmation was edited';
  exception when check_violation then null;
  end;
  begin
    delete from public.policy_issuance_confirmations;
    raise exception 'Automation V2 policies: a confirmation was deleted';
  exception when check_violation then null;
  end;
end $$;
select pg_temp.ok((select count(*)=3 from public.wins where contact_id=(select id from policy where label='client'))
  and (select count(*) from public.policy_commission_estimates)=(select estimates from before_counts),
  'sales and commission records are exactly as the sale writers left them');
select pg_temp.act(12);
set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.policy_issuance_confirmations x
  where not exists(select from public.clients c where c.id=x.client_id)),'a reader sees confirmations only for clients they can see');
do $$
begin
  begin
    insert into public.policy_issuance_confirmations(organization_id,policy_id,client_id,issued_on,confirmed_by,request_id)
      values (pg_temp.id(1),gen_random_uuid(),gen_random_uuid(),current_date,pg_temp.id(12),gen_random_uuid());
    raise exception 'Automation V2 policies: a browser session wrote a confirmation directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.nobody();
rollback;
