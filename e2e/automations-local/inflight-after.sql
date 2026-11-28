-- Backend-first rehearsal, step 2 of 2. Run after the V2 migrations.
-- The two first-release runs committed by inflight-before.sql continue under the V2 functions.
begin;
do $$
declare c jsonb; org constant uuid:='7a610000-0000-4000-8000-000000000001'; turns integer:=0;
begin
  if (select count(*)<>2 or bool_or(scope_key is distinct from 'lead:'||contact_id::text or contact_type<>'lead')
      from private.automation_runs where organization_id=org) then
    raise exception 'In-flight rehearsal: both runs should carry their lead as the re-entry scope'; end if;
  if (select count(*) filter (where status='waiting')<>1 or count(*) filter (where status='queued')<>1
      from private.automation_runs where organization_id=org) then
    raise exception 'In-flight rehearsal: the migrations changed a run state'; end if;
  -- The queued run is leased in the V2 contract and starts its wait.
  for c in select claim from public.automation_claim_work(25) claim where claim->>'organization_id'=org::text loop
    if not (c ? 'trigger' and c->>'trigger'='lead_created' and c ? 'context') then
      raise exception 'In-flight rehearsal: the V2 claim should name its trigger and context'; end if;
    perform public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'wait',null);
    turns:=turns+1;
  end loop;
  if turns<>1 or (select count(*)<>2 from private.automation_runs where organization_id=org and status='waiting') then
    raise exception 'In-flight rehearsal: expected the queued run to start waiting (% turns)',turns; end if;
  -- Both waits come due and both runs complete.
  update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where organization_id=org;
  turns:=0;
  for c in select claim from public.automation_claim_work(25) claim where claim->>'organization_id'=org::text loop
    perform public.automation_finish_node((c->>'run_id')::uuid,(c->>'lease_token')::uuid,'elapsed',null);
    turns:=turns+1;
  end loop;
  if turns<>2 or (select count(*)<>2 from private.automation_runs where organization_id=org and status='completed') then
    raise exception 'In-flight rehearsal: expected both runs to complete (% turns)',turns; end if;
  -- The harness's first-visibility step needs every agency control off.
  update private.automation_release_controls set enrollment_enabled=false where organization_id=org;
  raise notice 'PASS two first-release runs that were waiting and queued when V2 was applied kept their state, gained their re-entry scope and completed under the V2 functions.';
end $$;
commit;
