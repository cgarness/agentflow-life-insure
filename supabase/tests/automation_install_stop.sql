-- Disposable SQL check for every state of a stopped Automations V2 installation (none to all seven files) and for a
-- stopped installation that was backed out: the CRM's own saves all succeed with automations on for the agency, the
-- way they would for the pilot, and again with them off. Only paths that exist before V2 are used, so the same file runs
-- in every state. The runner fails it on any warning an automation observer raises. Synthetic agency, contacts and
-- calls; everything is rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('7a600000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.ok(passed boolean, message text) returns void language plpgsql as $$
begin
  if passed is distinct from true then raise exception 'Automation install stop: %', message; end if;
end $$;
create function pg_temp.act(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub',pg_temp.id(n)::text,true),
    set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','session_id',pg_temp.id(n+100),
      'app_metadata',jsonb_build_object('organization_id',pg_temp.id(1),'role',case when n=10 then 'Admin' else 'Agent' end))::text,true);
$$;
create function pg_temp.nobody() returns void language sql as $$
  select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
$$;
-- One CRM write as the signed-in agent.
create function pg_temp.as_agent(statement text) returns jsonb language plpgsql as $$
declare answer jsonb;
begin
  perform pg_temp.act(11);
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

insert into public.organizations(id,name,twilio_subaccount_status) values (pg_temp.id(1),'Install stop fixture','active');
insert into public.company_settings(company_name,organization_id,timezone) values ('Install stop fixture',pg_temp.id(1),'America/Chicago');
-- Automations on for this agency, as for the pilot, so every observer the installed files added runs.
insert into private.automation_release_controls(organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
  values (pg_temp.id(1),true,true,false);
insert into auth.users(id,email) select pg_temp.id(n),'install-stop-'||n||'@example.invalid' from generate_series(10,11) n;
insert into public.profiles(id,organization_id,role,status,email,first_name,last_name)
  select pg_temp.id(n),pg_temp.id(1),case when n=10 then 'Admin' else 'Agent' end,'Active','install-stop-'||n||'@example.invalid','Person',n::text
  from generate_series(10,11) n
  on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status;
insert into auth.sessions(id,user_id,created_at) select pg_temp.id(n+100),pg_temp.id(n),clock_timestamp() from generate_series(10,11) n;
insert into public.dispositions(id,organization_id,name,counts_as_contacted) values (pg_temp.id(20),pg_temp.id(1),'No Answer',false);

create function pg_temp.saves(round integer) returns void language plpgsql as $$
declare base integer:=round*100; lead uuid:=pg_temp.id(base+30); booked jsonb; appointment uuid; sale jsonb;
begin
  -- A new lead joins a campaign.
  insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id,user_id)
    values (lead,pg_temp.id(1),'Lead '||round,'+12025552'||lpad((base+30)::text,3,'0'),pg_temp.id(11),pg_temp.id(11));
  insert into public.campaigns(id,name,organization_id,user_id) values (pg_temp.id(base+31),'Campaign '||round,pg_temp.id(1),pg_temp.id(10));
  insert into public.campaign_leads(id,campaign_id,lead_id,organization_id) values (pg_temp.id(base+32),pg_temp.id(base+31),lead,pg_temp.id(1));
  perform pg_temp.ok(exists(select from public.campaign_leads where id=pg_temp.id(base+32)),'the lead joined the campaign');
  -- The agent saves a disposition through the dialer's own save path.
  insert into public.calls(id,organization_id,agent_id,contact_id,contact_type,contact_phone,direction,status,duration,dialer_admission_required)
    values (pg_temp.id(base+33),pg_temp.id(1),pg_temp.id(11),lead,'lead','+12025552'||lpad((base+30)::text,3,'0'),'outbound','completed',0,false);
  perform pg_temp.as_agent(format('select public.save_disposition_with_booking(%L::jsonb)',jsonb_build_object('p_call_id',pg_temp.id(base+33),
    'p_operation_id',pg_temp.id(base+34),'p_disposition_id',pg_temp.id(20),'p_notes','synthetic','p_release_lock',false)));
  perform pg_temp.ok((select disposition_id=pg_temp.id(20) from public.calls where id=pg_temp.id(base+33)),'the disposition was saved');
  -- An appointment is booked, moved, cancelled, moved while cancelled and opened again.
  booked:=pg_temp.as_agent(format('select public.create_appointment_once(%L,%L::jsonb)',pg_temp.id(base+35),jsonb_build_object(
    'title','Fixture review','start_time',date_trunc('minute',clock_timestamp())+interval '3 days','contact_id',lead,'user_id',pg_temp.id(11))));
  select a.id into strict appointment from public.appointments a where a.booking_request_id=pg_temp.id(base+35);
  perform pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L returning to_jsonb(id)',
    date_trunc('minute',clock_timestamp())+interval '4 days',appointment));
  perform pg_temp.as_agent(format('update public.appointments set status=''Cancelled'' where id=%L returning to_jsonb(id)',appointment));
  perform pg_temp.as_agent(format('update public.appointments set start_time=%L where id=%L returning to_jsonb(id)',
    date_trunc('minute',clock_timestamp())+interval '5 days',appointment));
  perform pg_temp.as_agent(format('update public.appointments set status=''Scheduled'' where id=%L returning to_jsonb(id)',appointment));
  perform pg_temp.ok((select status='Scheduled' from public.appointments where id=appointment),'the appointment was saved through every change');
  -- A missed inbound call ends, and an answer for it is recorded afterwards.
  insert into public.calls(id,organization_id,direction,status,twilio_call_sid,contact_phone,caller_id_used)
    values (pg_temp.id(base+36),pg_temp.id(1),'inbound','ringing','CA'||lpad((base+36)::text,32,'0'),'+12025559'||lpad((base+36)::text,3,'0'),'+15550003000');
  perform public.finalize_inbound_call_terminal(pg_temp.id(base+36),pg_temp.id(1),'no-answer',true,false);
  update public.calls set outcome='forwarded_answered' where id=pg_temp.id(base+36);
  perform pg_temp.ok((select status='no-answer' and outcome='forwarded_answered' from public.calls where id=pg_temp.id(base+36)),
    'the inbound call and its late answer were saved');
  -- A sale creates a client.
  sale:=pg_temp.as_agent(format('select public.create_client_with_sale(%L,%L,%L::jsonb,true)',pg_temp.id(base+37),pg_temp.id(1),
    jsonb_build_object('first_name','Client','last_name','Round '||round,'assigned_agent_id',pg_temp.id(11),'policy_type','Term',
      'carrier','Fixture Life','premium',100,'sold_date',(now() at time zone 'America/Chicago')::date::text,'payment_frequency','monthly')));
  perform pg_temp.ok(exists(select from public.clients where id=(sale->>'client_id')::uuid),'the sale created the client');
  -- An ordinary task.
  perform pg_temp.as_agent(format('insert into public.tasks(id,organization_id,contact_id,contact_type,assigned_to,created_by,title,task_type,due_date)
    values (%L,%L,%L,''lead'',%L,%L,''Manual task'',''General'',now()) returning to_jsonb(id)',pg_temp.id(base+38),pg_temp.id(1),lead,
    pg_temp.id(11),pg_temp.id(11)));
  perform pg_temp.ok(exists(select from public.tasks where id=pg_temp.id(base+38)),'the manual task was saved');
end $$;

select pg_temp.saves(1);
update private.automation_release_controls set enrollment_enabled=false,builder_visible=false where organization_id=pg_temp.id(1);
select pg_temp.saves(2);
select 'PASS core CRM saves with automations on and off' as result;
rollback;
