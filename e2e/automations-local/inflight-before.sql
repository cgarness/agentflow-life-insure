-- Backend-first rehearsal, step 1 of 2. Run on the first release, before the V2 migrations.
-- Commits one first-release automation with a run that is waiting and a run that is still queued.
begin;
insert into public.organizations(id,name) values ('7a610000-0000-4000-8000-000000000001','In-flight fixture');
insert into private.automation_release_controls(organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
  values ('7a610000-0000-4000-8000-000000000001',false,true,false);
insert into auth.users(id,email) values ('7a610000-0000-4000-8000-000000000010','in-flight@example.invalid');
insert into public.profiles(id,organization_id,role,status,email)
  values ('7a610000-0000-4000-8000-000000000010','7a610000-0000-4000-8000-000000000001','Admin','Active','in-flight@example.invalid')
  on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status;
insert into public.workflows(id,organization_id,name,status,trigger_type,automation_graph,automation_revision)
  values ('7a610000-0000-4000-8000-000000000020','7a610000-0000-4000-8000-000000000001','In-flight welcome','active','manual','{
    "format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
      {"id":"7a610000-0000-4000-8000-000000000501","type":"lead_created","version":1,"config":{}},
      {"id":"7a610000-0000-4000-8000-000000000502","type":"wait","version":1,"config":{"duration":1,"unit":"days"}}],
    "edges":[{"id":"7a610000-0000-4000-8000-000000000601","source":"7a610000-0000-4000-8000-000000000501","target":"7a610000-0000-4000-8000-000000000502"}]}',1);
insert into public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
  select '7a610000-0000-4000-8000-000000000021',organization_id,id,name,1,automation_graph,clock_timestamp(),'7a610000-0000-4000-8000-000000000010'
  from public.workflows where id='7a610000-0000-4000-8000-000000000020';
update public.workflows set automation_version_id='7a610000-0000-4000-8000-000000000021' where id='7a610000-0000-4000-8000-000000000020';
insert into public.automation_intervals(organization_id,workflow_id,version_id,starts_at)
  values ('7a610000-0000-4000-8000-000000000001','7a610000-0000-4000-8000-000000000020','7a610000-0000-4000-8000-000000000021',clock_timestamp());
insert into public.leads(id,organization_id,first_name,last_name,phone) values
  ('7a610000-0000-4000-8000-000000000030','7a610000-0000-4000-8000-000000000001','Waiting','Lead','+12025550170'),
  ('7a610000-0000-4000-8000-000000000031','7a610000-0000-4000-8000-000000000001','Queued','Lead','+12025550171');
do $$
declare c jsonb;
begin
  if public.automation_process_events(25)<>2 then raise exception 'In-flight fixture: expected two first-release runs'; end if;
  select claim into strict c from public.automation_claim_work(1) claim;
  if not public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'wait',null) then
    raise exception 'In-flight fixture: the wait was not saved'; end if;
  if (select count(*) filter (where status='waiting')<>1 or count(*) filter (where status='queued')<>1
      from private.automation_runs where organization_id='7a610000-0000-4000-8000-000000000001') then
    raise exception 'In-flight fixture: expected one waiting and one queued run'; end if;
end $$;
commit;
