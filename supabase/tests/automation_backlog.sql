-- Disposable synthetic acceptance only. Roll back source rows, event receipts and all work.
begin;
set local statement_timeout='60s';

do $$
declare
  agency uuid:=gen_random_uuid();
  actor uuid:=gen_random_uuid();
  workflow uuid:=gen_random_uuid();
  version uuid:=gen_random_uuid();
  graph jsonb:='{"format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[
    {"id":"start","type":"lead_created","version":1,"config":{"lead_source":"Opted in fixture"}},
    {"id":"step","type":"send_sms","version":1,"config":{"purpose":"informational","body":"Isolated fixture"}}
  ],"edges":[{"id":"a","source":"start","target":"step"}]}';
  started timestamptz;
  imported_at timestamptz;
  enrolled_at timestamptz;
  elapsed interval;
  n integer;
  total integer:=0;
  cycles integer:=0;
  claimed integer:=0;
  sample jsonb;
  session_id uuid:=gen_random_uuid();
  revision bigint;
  page_one jsonb;
  page_two jsonb;
  cursor_row jsonb;
begin
  insert into public.organizations(id,name) values(agency,'Automation load test fixture');
  insert into auth.users(id,email) values(actor,actor::text||'@example.invalid');
  insert into public.profiles(id,organization_id,role,status) values(actor,agency,'Admin','Active')
    on conflict(id) do update set organization_id=agency,role='Admin',status='Active';
  insert into private.automation_release_controls values(agency,true,true,false);
  insert into public.workflows(id,organization_id,name,status,trigger_type,automation_graph,automation_revision)
    values(workflow,agency,'Synthetic load test','active','manual',graph,1);
  insert into public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
    values(version,agency,workflow,'Synthetic load test',1,graph,clock_timestamp(),actor);
  update public.workflows set automation_version_id=version where id=workflow and organization_id=agency;
  insert into public.automation_intervals(organization_id,workflow_id,version_id,starts_at)
    values(agency,workflow,version,clock_timestamp());

  started:=clock_timestamp();
  insert into public.leads(id,organization_id,lead_source)
    select gen_random_uuid(),agency,case when seq%5=0 then 'Opted in fixture' else 'Other source' end
    from generate_series(1,1000) seq;
  imported_at:=clock_timestamp();
  while exists(select 1 from private.automation_events where organization_id=agency and processed_at is null) loop
    total:=total+public.automation_process_events(25);
    cycles:=cycles+1;
    if cycles>40 then raise exception 'Event backlog did not drain in bounded batches'; end if;
  end loop;
  enrolled_at:=clock_timestamp();
  if total<>200 or cycles<>40 then raise exception 'Unexpected enrollment count or worker batch size'; end if;

  loop
    n:=0;
    for sample in select * from public.automation_claim_work(25) loop
      if (sample->>'organization_id')::uuid<>agency then raise exception 'Expected an empty disposable database'; end if;
      if public.automation_authorize_handoff((sample->>'run_id')::uuid,(sample->>'lease_token')::uuid,'step') then
        raise exception 'Dispatch release gate unexpectedly open';
      end if;
      if not public.automation_finish_node((sample->>'run_id')::uuid,(sample->>'lease_token')::uuid,'held','Synthetic dispatch disabled') then
        raise exception 'Cannot finish synthetic lease'; end if;
      n:=n+1;
    end loop;
    if n>25 then raise exception 'Claim exceeded worker batch size'; end if;
    claimed:=claimed+n;
    exit when n=0;
  end loop;
  if claimed<>200 or exists(select 1 from private.automation_intents where organization_id=agency and status<>'prepared') then
    raise exception 'Unexpected synthetic dispatch or dropped claim'; end if;
  elapsed:=clock_timestamp()-enrolled_at;
  insert into auth.sessions(id,user_id) values(session_id,actor);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,
    'session_id',session_id,'app_metadata',jsonb_build_object('organization_id',agency))::text,true);
  revision:=(public.automation_session_context()->>'revision')::bigint;
  page_one:=public.automation_activity(revision,actor,workflow);
  cursor_row:=page_one->99;
  page_two:=public.automation_activity(revision,actor,workflow,null,null,(cursor_row->>'updated_at')::timestamptz,(cursor_row->>'run_id')::uuid);
  if jsonb_array_length(page_one)<>100 or jsonb_array_length(page_two)<>100 or exists(
    select from jsonb_array_elements(page_one) a join jsonb_array_elements(page_two) b on a->>'run_id'=b->>'run_id'
  ) then raise exception 'Activity pages skipped or duplicated runs'; end if;
  cursor_row:=page_two->99;
  if jsonb_array_length(public.automation_activity(revision,actor,workflow,null,null,(cursor_row->>'updated_at')::timestamptz,(cursor_row->>'run_id')::uuid))<>0
    then raise exception 'Unexpected history after final cursor'; end if;

  raise notice '1000 leads, 200 matched, 0 handoffs. Insert %, drain % (40 batches), claim-and-hold % (8 batches).',
    imported_at-started,enrolled_at-imported_at,elapsed;
end $$;
rollback;
