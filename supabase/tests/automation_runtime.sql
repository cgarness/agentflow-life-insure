-- Disposable SQL integration test. Provider and worker time are simulated at their boundaries.
begin;
update private.automation_session_cutover set visibility_cutover_at=installed_at where visibility_cutover_at is null;
create function pg_temp.runtime_id(n integer) returns uuid language sql immutable as $$
  select ('dade0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.require_result(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Automation runtime: %', message; end if;
end $$;

insert into public.organizations (id, name) values
  (pg_temp.runtime_id(1),'Runtime fixture'), (pg_temp.runtime_id(2),'Separate agency');
insert into private.automation_release_controls (organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
  values (pg_temp.runtime_id(1),true,true,false), (pg_temp.runtime_id(2),true,true,false);
insert into auth.users (id,email) values (pg_temp.runtime_id(3),'worker-fixture@example.invalid');
insert into public.profiles (id,organization_id,role,status,email)
values (pg_temp.runtime_id(3),pg_temp.runtime_id(1),'Admin','Active','worker-fixture@example.invalid')
on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status;

-- This event predates both published intervals, even when a worker evaluates it later.
insert into public.leads (id,organization_id,lead_source) values
  (pg_temp.runtime_id(21),pg_temp.runtime_id(1),'Agency form');

create function pg_temp.runtime_workflow(workflow_n integer, version_n integer, title text, graph jsonb)
returns void language plpgsql as $$
declare
  org uuid := pg_temp.runtime_id(1);
  workflow uuid := pg_temp.runtime_id(workflow_n);
  version uuid := pg_temp.runtime_id(version_n);
begin
  insert into public.workflows(id,organization_id,name,status,trigger_type,automation_graph,automation_revision)
    values(workflow,org,title,'active','manual',graph,1);
  insert into public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
    values(version,org,workflow,title,1,graph,clock_timestamp(),pg_temp.runtime_id(3));
  update public.workflows set automation_version_id=version where id=workflow;
  insert into public.automation_intervals(organization_id,workflow_id,version_id,starts_at)
    values(org,workflow,version,clock_timestamp());
end $$;

select pg_temp.runtime_workflow(5,6,'Fixture wait and SMS','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"lead_created","version":1,"config":{"lead_source":"Agency form"}},
    {"id":"delay","type":"wait","version":1,"config":{"duration":1,"unit":"hours"}},
    {"id":"message","type":"send_sms","version":1,"config":{"body":"Fixture original","purpose":"informational"}}],
  "edges":[{"id":"a","source":"start","target":"delay"},{"id":"b","source":"delay","target":"message"}]}');
select pg_temp.runtime_workflow(7,8,'Fixture membership email','{
  "format":1,"settings":{"reentry":"once","stop_on_reply":true},"nodes":[
    {"id":"start","type":"campaign_membership_created","version":1,"config":{"any_campaign":true}},
    {"id":"email","type":"send_email","version":1,"config":{"subject":"Fixture","body":"Email body","sender_id":"dade0000-0000-4000-8000-000000000010"}}],
  "edges":[{"id":"a","source":"start","target":"email"}]}');

insert into public.leads(id,organization_id,lead_source) values
 (pg_temp.runtime_id(22),pg_temp.runtime_id(1),'Agency form'),
 (pg_temp.runtime_id(23),pg_temp.runtime_id(1),'Third-party import'),
 (pg_temp.runtime_id(24),pg_temp.runtime_id(2),'Agency form');
select pg_temp.require_result(public.automation_process_events(25)=1,'only post-publish matching event enrolls');
select pg_temp.require_result((select count(*)=1 from private.automation_runs where contact_id=pg_temp.runtime_id(22)
 and workflow_id=pg_temp.runtime_id(5) and version_id=pg_temp.runtime_id(6)),'pinned matching lead');
select pg_temp.require_result(public.automation_process_events(25)=0,'duplicate worker sweep');

do $$
declare c jsonb; fresh_claim jsonb; r uuid; lease uuid; first_intent uuid;
begin
  select * into strict c from public.automation_claim_work(1);
  r:=(c->>'run_id')::uuid; lease:=(c->>'lease_token')::uuid;
  perform pg_temp.require_result(c->>'node_id'='delay','wait leads action');
  perform pg_temp.require_result(not exists(select from public.automation_claim_work(1)),'second worker cannot claim lease');
  perform pg_temp.require_result(public.automation_finish_node(r,lease,'wait'),'wait persisted');
  perform pg_temp.require_result((select status='waiting' and due_at between now()+interval '59 minutes' and
    clock_timestamp()+interval '61 minutes' from private.automation_runs where id=r),'positive server due time');
  perform pg_temp.require_result(not exists(select from public.automation_claim_work(1)),'future wait stays idle');

  update public.workflows set automation_graph=jsonb_set(automation_graph,'{nodes,2,config,body}','"Edited later"'),
    automation_revision=automation_revision+1 where id=pg_temp.runtime_id(5);
  update private.automation_runs set due_at=clock_timestamp()-interval '1 minute' where id=r;
  select * into strict c from public.automation_claim_work(1);
  perform pg_temp.require_result(public.automation_finish_node(r,(c->>'lease_token')::uuid,'elapsed'),'resumed wait');
  select * into strict c from public.automation_claim_work(1);
  perform pg_temp.require_result(c->>'node_id'='message' and c#>>'{graph,nodes,2,config,body}'='Fixture original',
    'waiting execution used original graph and content');
  lease:=(c->>'lease_token')::uuid;
  select id into strict first_intent from private.automation_intents where run_id=r and node_id='message';
  perform pg_temp.require_result(not public.automation_authorize_handoff(r,lease,'message'),'closed dispatch gate');
  update private.automation_runs set leased_until=clock_timestamp()-interval '1 minute' where id=r;
  select * into strict fresh_claim from public.automation_claim_work(1);
  perform pg_temp.require_result((fresh_claim->>'lease_token')::uuid<>lease,'worker restart takes fresh lease');
  perform pg_temp.require_result(not public.automation_finish_node(r,lease,'accepted'),'stale worker cannot advance');
  lease:=(fresh_claim->>'lease_token')::uuid;
  perform pg_temp.require_result((select id=first_intent from private.automation_intents where run_id=r),
    'worker restart reuses original intent');
  update private.automation_release_controls set dispatch_enabled=true where organization_id=pg_temp.runtime_id(1);
  update public.workflows set status='paused' where id=pg_temp.runtime_id(5);
  perform pg_temp.require_result(not public.automation_authorize_handoff(r,lease,'message'),'pause blocks handoff');
  update public.workflows set status='active' where id=pg_temp.runtime_id(5);
  perform pg_temp.require_result(public.automation_authorize_handoff(r,lease,'message'),'eligible claim handed off');
  perform pg_temp.require_result(not public.automation_authorize_handoff(r,lease,'message'),'same intent cannot hand off twice');
  perform pg_temp.require_result(public.automation_finish_node(r,lease,'unknown','Synthetic provider timeout'),
    'timeout preserved');
  perform pg_temp.require_result(not exists(select from public.automation_claim_work(1)),'uncertain outcome has no automatic retry');
end $$;

-- Insert a campaign attachment after lead creation; a unique membership and event identity survive replay.
insert into public.campaigns(id,name,organization_id,user_id)
 values(pg_temp.runtime_id(9),'Fixture campaign',pg_temp.runtime_id(1),pg_temp.runtime_id(3));
insert into public.campaign_leads(id,campaign_id,lead_id,organization_id) values
 (pg_temp.runtime_id(25),pg_temp.runtime_id(9),pg_temp.runtime_id(22),pg_temp.runtime_id(1)) on conflict do nothing;
insert into public.campaign_leads(id,campaign_id,lead_id,organization_id) values
 (pg_temp.runtime_id(26),pg_temp.runtime_id(9),pg_temp.runtime_id(22),pg_temp.runtime_id(1)) on conflict do nothing;
select pg_temp.require_result(public.automation_process_events(25)=1,'one new campaign membership');
select pg_temp.require_result((select count(*)=1 from private.automation_events
 where event_type='campaign_membership_created' and contact_id=pg_temp.runtime_id(22)),'membership replay dedupes');

do $$
declare c jsonb; r uuid; lease uuid;
begin
  select * into strict c from public.automation_claim_work(1);
  r:=(c->>'run_id')::uuid; lease:=(c->>'lease_token')::uuid;
  perform pg_temp.require_result(c->>'node_id'='email','email-only graph reaches its action');
  perform pg_temp.require_result(public.automation_finish_node(r,lease,'held','Fixture missing sender'),'reason held');
  perform pg_temp.require_result((select status='held' and reason='Fixture missing sender' from private.automation_runs where id=r),
    'hold is visible on the run');
  perform private.automation_cancel_reply(pg_temp.runtime_id(2),pg_temp.runtime_id(22),'lead',clock_timestamp());
  perform private.automation_cancel_reply(pg_temp.runtime_id(1),pg_temp.runtime_id(22),'client',clock_timestamp());
  perform pg_temp.require_result((select status='held' from private.automation_runs where id=r),'reply checks tenant and contact type');
  perform private.automation_cancel_reply(pg_temp.runtime_id(1),pg_temp.runtime_id(22),'lead',clock_timestamp());
  perform pg_temp.require_result((select status='stopped' from private.automation_runs where id=r),'verified matching reply stops held work');
  perform pg_temp.require_result(not public.automation_authorize_handoff(r,lease,'email'),'late stopped handoff refused');
end $$;

-- Force the primary capture to fail for one fixture CRM insert. Save the committed facts in recovery.
create function pg_temp.fail_intake() returns trigger language plpgsql as $$
begin raise exception 'synthetic intake outage'; end $$;
create trigger test_temporarily_unavailable before insert on private.automation_events
for each row execute function pg_temp.fail_intake();
insert into public.leads(id,organization_id,lead_source) values(pg_temp.runtime_id(27),pg_temp.runtime_id(1),'Agency form');
drop trigger test_temporarily_unavailable on private.automation_events;
select pg_temp.require_result(exists(select from public.leads where id=pg_temp.runtime_id(27)) and
 exists(select from private.automation_intake_recovery where contact_id=pg_temp.runtime_id(27)),'intake failure allows CRM write');
select pg_temp.require_result(public.automation_process_events(25)=1,'recovered event enrolls exactly once');
select pg_temp.require_result(public.automation_process_events(25)=0,'recovered event retained source identity');
-- An authorized operator stops only the selected workflow for a contact in two workflows.
insert into public.campaign_leads(id,campaign_id,lead_id,organization_id) values
 (pg_temp.runtime_id(28),pg_temp.runtime_id(9),pg_temp.runtime_id(27),pg_temp.runtime_id(1));
select pg_temp.require_result(public.automation_process_events(25)=1,'overlapping workflows enroll independently');
insert into auth.sessions(id,user_id,created_at) values(pg_temp.runtime_id(29),pg_temp.runtime_id(3),clock_timestamp());
select set_config('request.jwt.claim.sub',pg_temp.runtime_id(3)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.runtime_id(3),
  'session_id',pg_temp.runtime_id(29),'app_metadata',jsonb_build_object('organization_id',pg_temp.runtime_id(1)))::text,true);
set local role authenticated;
do $$
declare ctx jsonb := public.automation_session_context();
  activity jsonb := public.automation_activity((ctx->>'revision')::bigint,pg_temp.runtime_id(3),null,pg_temp.runtime_id(27),'lead');
  selected uuid;
begin
  begin
    perform public.automation_activity((ctx->>'revision')::bigint,pg_temp.runtime_id(999),null,pg_temp.runtime_id(27),'lead');
    raise exception 'Wrong viewer could read activity';
  exception when insufficient_privilege then null; end;
  begin
    perform public.automation_activity(-1,pg_temp.runtime_id(3),null,pg_temp.runtime_id(27),'lead');
    raise exception 'Stale session revision could read activity';
  exception when insufficient_privilege or serialization_failure or sqlstate 'PT409' then null; end;
  perform pg_temp.require_result(jsonb_array_length(activity)=2,'both runs are visible on the accessible contact');
  select (item->>'run_id')::uuid into strict selected from jsonb_array_elements(activity) item
   where item->>'workflow_id'=pg_temp.runtime_id(7)::text and (item->>'can_stop')::boolean;
  perform public.automation_stop_run(selected,(ctx->>'revision')::bigint);
end $$;
reset role;
select pg_temp.require_result((select status='stopped' and reason='Stopped by user' from private.automation_runs
 where contact_id=pg_temp.runtime_id(27) and workflow_id=pg_temp.runtime_id(7)),'selected run stopped');
select pg_temp.require_result((select status='queued' from private.automation_runs
 where contact_id=pg_temp.runtime_id(27) and workflow_id=pg_temp.runtime_id(5)),'other run retained');
update public.workflows set status='archived' where id=pg_temp.runtime_id(5);
select pg_temp.require_result((select status='stopped' from private.automation_runs where contact_id=pg_temp.runtime_id(27) and workflow_id=pg_temp.runtime_id(5)),
 'archive cancels future work');
do $$
declare stopped_id uuid;
begin
  select id into strict stopped_id from private.automation_runs
    where workflow_id=pg_temp.runtime_id(5) and contact_id=pg_temp.runtime_id(22) and status='stopped';
  perform private.automation_apply_receipt(pg_temp.runtime_id(1),stopped_id,'message','accepted');
  perform pg_temp.require_result((select status='stopped' from private.automation_runs where id=stopped_id),
    'receipt for archived unknown outcome cannot advance the run');
  perform pg_temp.require_result((select status='accepted' from private.automation_intents where run_id=stopped_id
    and node_id='message'),'late receipt can still settle the original intent');
end $$;

-- Synthetic email handoff: prove acceptance persists even if the first Conversations projection fails.
insert into public.leads(id,organization_id,lead_source,email)
 values(pg_temp.runtime_id(30),pg_temp.runtime_id(1),'Third-party import','recipient@example.invalid');
insert into public.campaign_leads(id,campaign_id,lead_id,organization_id) values
 (pg_temp.runtime_id(31),pg_temp.runtime_id(9),pg_temp.runtime_id(30),pg_temp.runtime_id(1));
select pg_temp.require_result(public.automation_process_events(25)=1,'email-only enrollment');
insert into public.user_email_connections(id,organization_id,user_id,provider,provider_account_email,
  access_token_encrypted,status,last_sync_at) values
 (pg_temp.runtime_id(11),pg_temp.runtime_id(1),pg_temp.runtime_id(3),'google','reply.runtime.dade@example.invalid',
  'fixture-only','connected',clock_timestamp());
insert into private.automation_channel_policies(organization_id,channel,daily_limit,local_start,local_end,
  reply_max_age,reply_checked_at,enabled)
 values(pg_temp.runtime_id(1),'email',5,((now() at time zone 'UTC')-interval '1 hour')::time,
  ((now() at time zone 'UTC')+interval '1 hour')::time,interval '1 hour',now(),true);
insert into private.automation_recipient_facts(organization_id,contact_type,contact_id,channel,destination,
  timezone_name,valid_until,email_permission,evidence_reference)
 values(pg_temp.runtime_id(1),'lead',pg_temp.runtime_id(30),'email','recipient@example.invalid',
  'UTC',now()+interval '1 hour',true,'synthetic consent');
insert into private.automation_email_senders(id,organization_id,connection_id,from_email,verified_until,verification_reference,enabled)
 values(pg_temp.runtime_id(10),pg_temp.runtime_id(1),pg_temp.runtime_id(11),'sender@example.invalid',
  now()+interval '1 hour','fixture verification',true);

create function pg_temp.fail_projection() returns trigger language plpgsql as $$
begin raise exception 'synthetic mailbox outage'; end $$;
create trigger test_projection_unavailable before insert on public.contact_emails
 for each row execute function pg_temp.fail_projection();
do $$
declare c jsonb; msg jsonb; mid uuid; r uuid; lease uuid;
begin
  select * into strict c from public.automation_claim_work(1);
  r:=(c->>'run_id')::uuid; lease:=(c->>'lease_token')::uuid;
  msg:=public.automation_begin_message(r,lease,'email','email','recipient@example.invalid',
     'Fixture','Email body',pg_temp.runtime_id(10)::text,null);
  mid:=(msg->>'id')::uuid;
  perform pg_temp.require_result(msg->>'from_email'='sender@example.invalid' and msg->>'reply_to'='reply.runtime.dade@example.invalid',
    'verified sender and monitored reply address');
  perform public.automation_record_receipt(mid,'email','fixture-email-1','accepted',clock_timestamp(),null,pg_temp.runtime_id(1));
  perform public.automation_finish_node(r,lease,'accepted');
  perform pg_temp.require_result(public.automation_repair_messages(10)=0,'projection failure remains repairable');
  perform pg_temp.require_result((select state='accepted' and provider_id='fixture-email-1' and projected_at is null
    from private.automation_messages where id=mid),'receipt durable across mailbox failure');
  perform pg_temp.require_result(not exists(select from public.automation_claim_work(1)),'repair does not retry the send');
end $$;
drop trigger test_projection_unavailable on public.contact_emails;
update private.automation_messages set repair_after=now() where provider_id='fixture-email-1';
select pg_temp.require_result(public.automation_repair_messages(10)=1,'original receipt repaired once');
select pg_temp.require_result(public.automation_repair_messages(10)=0,'no duplicate logical message');
do $$
declare mid uuid; event_time timestamptz:=clock_timestamp();
begin
  select id into strict mid from private.automation_messages where contact_id=pg_temp.runtime_id(30);
  perform public.automation_record_receipt(mid,'email','fixture-email-1','delivered',event_time,null,pg_temp.runtime_id(1));
  perform public.automation_record_receipt(mid,'email','fixture-email-1','accepted',event_time-interval '1 minute',null,pg_temp.runtime_id(1));
  perform public.automation_record_receipt(mid,'email','fixture-email-1','delivered',event_time,null,pg_temp.runtime_id(1));
  perform pg_temp.require_result(public.automation_repair_messages(10)=1,'late delivery updates the original history');
  perform pg_temp.require_result((select count(*)=1 and bool_and(owner_user_id=pg_temp.runtime_id(3)
    and contact_id=pg_temp.runtime_id(30) and organization_id=pg_temp.runtime_id(1) and provider='resend'
    and delivery_status='delivered' and subject='Fixture' and body_text='Email body') from public.contact_emails
    where automation_message_id=mid),'one owned, attributed Conversations email with delivery evidence');
end $$;

-- A failing recovery cannot monopolize unrelated intake, and its original evidence remains replayable.
create function pg_temp.runtime_unavailable() returns trigger language plpgsql as $$
begin raise exception 'Synthetic intake outage'; end $$;
create trigger fixture_bad_recovery before insert on private.automation_events for each row
 when (new.source_id='dade0000-0000-4000-8000-000000000083'::uuid) execute function pg_temp.runtime_unavailable();
insert into private.automation_intake_recovery(organization_id,event_type,source_id,contact_id,occurred_at)
 select pg_temp.runtime_id(1),'lead_created',pg_temp.runtime_id(n),pg_temp.runtime_id(23),clock_timestamp()
 from generate_series(83,84) n;
select public.automation_process_events(25);
select pg_temp.require_result(exists(select from private.automation_intake_recovery where source_id=pg_temp.runtime_id(83)
  and attempts=1 and last_sqlstate='P0001' and retry_at>clock_timestamp()),'broken recovery retains evidence and backs off');
select pg_temp.require_result(exists(select from private.automation_events where source_id=pg_temp.runtime_id(84))
  and not exists(select from private.automation_intake_recovery where source_id=pg_temp.runtime_id(84)),'later intake progresses');
drop trigger fixture_bad_recovery on private.automation_events;
update private.automation_intake_recovery set retry_at=clock_timestamp() where source_id=pg_temp.runtime_id(83);
select public.automation_process_events(25);
select pg_temp.require_result((select count(*)=1 from private.automation_events where source_id=pg_temp.runtime_id(83)),
 'repaired intake reuses the original source identity');

-- A verified reply can commit after attachment and before its event is drained.
select pg_temp.runtime_workflow(70,71,'Fixture independent reply rule',
  jsonb_set(graph,'{settings,stop_on_reply}','false'::jsonb))
from public.workflow_versions where id=pg_temp.runtime_id(8);
insert into public.leads(id,organization_id,lead_source)
 values(pg_temp.runtime_id(72),pg_temp.runtime_id(1),'Third-party import');
insert into public.campaign_leads(id,campaign_id,lead_id,organization_id) values
 (pg_temp.runtime_id(73),pg_temp.runtime_id(9),pg_temp.runtime_id(72),pg_temp.runtime_id(1));
create trigger fixture_broken_admission before insert on private.automation_runs for each row
 when (new.workflow_id='dade0000-0000-4000-8000-000000000070'::uuid) execute function pg_temp.runtime_unavailable();
select private.automation_cancel_reply(pg_temp.runtime_id(1),pg_temp.runtime_id(72),'lead',clock_timestamp());
select public.automation_process_events(25);
select pg_temp.require_result((select status='stopped' from private.automation_runs
 where contact_id=pg_temp.runtime_id(72) and workflow_id=pg_temp.runtime_id(7)),
 'reply before delayed enrollment precludes all future handoffs');
select pg_temp.require_result(exists(select from private.automation_deferred_admissions where workflow_id=pg_temp.runtime_id(70)
  and attempts=1 and last_sqlstate='P0001' and retry_at>clock_timestamp()),'one failed interval leaves its sibling free to progress');
drop trigger fixture_broken_admission on private.automation_runs;
update private.automation_deferred_admissions set retry_at=clock_timestamp() where workflow_id=pg_temp.runtime_id(70);
select public.automation_process_events(25);
select pg_temp.require_result((select status='queued' from private.automation_runs
 where contact_id=pg_temp.runtime_id(72) and workflow_id=pg_temp.runtime_id(70)),
 'overlapping workflow retains independently authored reply rule');
update public.workflows set status='archived' where id=pg_temp.runtime_id(70);

-- Force an early paused candidate onto page one, then verify the cursor reaches later intervals.
update public.automation_intervals set ends_at=clock_timestamp() where ends_at is null;
do $$
declare graph jsonb; i integer;
begin
  select v.graph into strict graph from public.workflow_versions v where v.id=pg_temp.runtime_id(8);
  for i in 0..26 loop
    perform pg_temp.runtime_workflow(100+i,200+i,'Fixture campaign page '||i,graph);
    update public.automation_intervals set id=pg_temp.runtime_id(300+i) where workflow_id=pg_temp.runtime_id(100+i);
  end loop;
end $$;
insert into public.campaign_leads(id,campaign_id,lead_id,organization_id) values
 (pg_temp.runtime_id(50),pg_temp.runtime_id(9),pg_temp.runtime_id(23),pg_temp.runtime_id(1));
update public.workflows set status='paused' where id=pg_temp.runtime_id(100);
select pg_temp.require_result(public.automation_process_events(1)=24,'matching paused page-one interval defers independently');
-- Advance the worker clock between successive transactions represented by this rollback-only fixture.
update private.automation_events set available_at=now() where processed_at is null;
select pg_temp.require_result(public.automation_process_events(1)=2,'later interval page enrolls even while first remains paused');
select pg_temp.require_result(public.automation_process_events(1)=0,'paused admission stays ineligible');
select pg_temp.require_result((select count(*)=1 from private.automation_deferred_admissions where workflow_id=pg_temp.runtime_id(100)),
  'one durable deferred admission');
update public.workflows set status='active' where id=pg_temp.runtime_id(100);
select pg_temp.require_result(public.automation_process_events(1)=1,'resume releases original deferred event');
select pg_temp.require_result(public.automation_process_events(1)=0,'resumed event cannot enroll twice');
select pg_temp.require_result((select count(*)=27 and count(distinct workflow_id)=27 from private.automation_runs
 where contact_id=pg_temp.runtime_id(23)),'each authored workflow received exactly its event');
-- Re-entry depends on the occurrence of a different event after completion.
update public.workflows set status='archived' where organization_id=pg_temp.runtime_id(1);
update public.automation_intervals set ends_at=clock_timestamp() where organization_id=pg_temp.runtime_id(1) and ends_at is null;
select pg_temp.runtime_workflow(410,411,'Fixture re-entry',
  jsonb_set(graph,'{settings,reentry}','"after_completion"'::jsonb))
from public.workflow_versions where id=pg_temp.runtime_id(8);
insert into public.campaigns(id,name,organization_id,user_id)
 select pg_temp.runtime_id(n),'Synthetic campaign '||n,pg_temp.runtime_id(1),pg_temp.runtime_id(3)
 from generate_series(412,414) n;
insert into public.leads(id,organization_id) values(pg_temp.runtime_id(415),pg_temp.runtime_id(1));
insert into public.campaign_leads(id,campaign_id,lead_id,organization_id)
 values(pg_temp.runtime_id(416),pg_temp.runtime_id(412),pg_temp.runtime_id(415),pg_temp.runtime_id(1));
select pg_temp.require_result(public.automation_process_events(25)=1,'first qualifying occurrence enters');
do $$
declare claim jsonb; run uuid; token uuid;
begin
  select * into strict claim from public.automation_claim_work(1);
  run:=(claim->>'run_id')::uuid;
  token:=(claim->>'lease_token')::uuid;
  insert into public.campaign_leads(id,campaign_id,lead_id,organization_id)
    values(pg_temp.runtime_id(417),pg_temp.runtime_id(413),pg_temp.runtime_id(415),pg_temp.runtime_id(1));
  perform pg_temp.require_result(public.automation_authorize_handoff(run,token,'email'),'synthetic re-entry handoff');
  perform public.automation_finish_node(run,token,'accepted');
  perform pg_temp.require_result((select status='unknown' from private.automation_runs where id=run),
    'handoff without a provider receipt cannot be reported as accepted');
  perform private.automation_apply_receipt(pg_temp.runtime_id(1),run,'email','accepted');
  perform pg_temp.require_result((select status='completed' from private.automation_runs where id=run),'confirmed completion');
end $$;
select pg_temp.require_result(public.automation_process_events(25)=0,'delayed event from an active run cannot re-enter');
insert into public.campaign_leads(id,campaign_id,lead_id,organization_id)
 values(pg_temp.runtime_id(418),pg_temp.runtime_id(414),pg_temp.runtime_id(415),pg_temp.runtime_id(1));
select pg_temp.require_result(public.automation_process_events(25)=1,'subsequent new event enters after confirmed completion');
select pg_temp.require_result((select count(*)=2 from private.automation_runs where workflow_id=pg_temp.runtime_id(410)),
  'only two distinct eligible events created runs');
rollback;
