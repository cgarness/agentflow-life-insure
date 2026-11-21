-- Isolated candidate. No jobs, flags, definitions or enrollments are created on install.
begin;
set local lock_timeout='5s';

create table private.automation_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  event_type text not null check (event_type in ('lead_created','campaign_membership_created')),
  source_id uuid not null,
  source_revision integer not null check (source_revision > 0),
  contact_id uuid not null,
  campaign_id uuid,
  lead_source text,
  occurred_at timestamptz not null,
  interval_cursor uuid,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (organization_id,event_type,source_id,source_revision)
);
create index automation_events_due on private.automation_events (available_at,id) where processed_at is null;

-- The CRM transaction can still retain the original event facts when the canonical intake fails.
create table private.automation_intake_recovery (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  event_type text not null,
  source_id uuid not null,
  contact_id uuid not null,
  campaign_id uuid,
  lead_source text,
  occurred_at timestamptz not null,
  retry_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_sqlstate text,
  unique(organization_id,event_type,source_id)
);
create index automation_intake_repair_due on private.automation_intake_recovery(retry_at,id);

create table private.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workflow_id uuid not null references public.workflows(id),
  version_id uuid not null references public.workflow_versions(id),
  event_id bigint not null references private.automation_events(id),
  contact_id uuid not null,
  contact_type text not null default 'lead' check(contact_type = 'lead'),
  current_node_id text not null,
  status text not null check(status in ('queued','waiting','held','completed','stopped','failed','unknown')),
  reason text,
  due_at timestamptz not null default now(),
  workflow_paused boolean not null default false,
  lease_token uuid,
  leased_until timestamptz,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  unique(organization_id, workflow_id, event_id)
);
create index automation_runs_due on private.automation_runs(greatest(due_at,leased_until),id)
 where not workflow_paused and status in ('queued','waiting','held');
create index automation_runs_workflow_activity on private.automation_runs(organization_id,workflow_id,updated_at desc,id desc);
create index automation_runs_contact_activity on private.automation_runs(organization_id,contact_id,updated_at desc,id desc);
create index automation_runs_admission on private.automation_runs(organization_id,workflow_id,contact_id,contact_type,ended_at);

create table private.automation_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null references private.automation_runs(id),
  node_id text not null,
  status text not null check(status in ('prepared','handed_off','accepted','failed','unknown')),
  created_at timestamptz not null default now(),
  unique(run_id,node_id)
);
create table private.automation_steps (
  organization_id uuid not null,
  run_id uuid not null references private.automation_runs(id),
  node_id text not null,
  status text not null,
  reason text,
  updated_at timestamptz not null default now(),
  primary key(run_id,node_id)
);

create function private.automation_capture_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  kind text := tg_argv[0];
  org uuid := new.organization_id;
  recipient uuid;
  campaign uuid;
  source text;
  occurred timestamptz;
begin
  if org is null or not exists (select 1 from private.automation_release_controls
    where organization_id=org and enrollment_enabled for share) then return new; end if;
  -- Order committed source events against publish/pause boundaries without serializing imports together.
  perform pg_advisory_xact_lock_shared(hashtextextended('automation-activation:'||org::text,0));
  occurred:=clock_timestamp();
  if kind='lead_created' then
    recipient:=new.id;
    source:=new.lead_source;
  else
    recipient:=new.lead_id;
    campaign:=new.campaign_id;
    if recipient is null then return new; end if;
    select l.lead_source into source from public.leads l
      join public.campaigns c on c.organization_id=l.organization_id and c.id=campaign
      where l.id=recipient and l.organization_id=org;
    if not found then return new; end if;
  end if;
  begin
    insert into private.automation_events(organization_id,event_type,source_id,source_revision,contact_id,campaign_id,lead_source,occurred_at)
      values(org,kind,new.id,1,recipient,campaign,source,occurred) on conflict do nothing;
  exception when others then
    insert into private.automation_intake_recovery(organization_id,event_type,source_id,contact_id,campaign_id,lead_source,occurred_at)
      values(org,kind,new.id,recipient,campaign,source,occurred) on conflict do nothing;
  end;
  return new;
exception when others then
  raise warning 'Automation event capture requires investigation (table %, SQLSTATE %)', tg_table_name, sqlstate;
  return new;
end $$;
create trigger automation_capture_lead after insert on public.leads
 for each row execute function private.automation_capture_event('lead_created');
create trigger automation_capture_campaign_membership after insert on public.campaign_leads
 for each row execute function private.automation_capture_event('campaign_membership_created');

create table private.automation_deferred_admissions (
  organization_id uuid not null,
  event_id bigint not null references private.automation_events(id),
  interval_id uuid not null references public.automation_intervals(id),
  workflow_id uuid not null references public.workflows(id),
  retry_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_sqlstate text,
  primary key(event_id,interval_id)
);
create index automation_deferred_due on private.automation_deferred_admissions(retry_at,event_id,interval_id);
create index automation_deferred_by_workflow on private.automation_deferred_admissions(organization_id,workflow_id,event_id);

-- Verified contact reply occurrence survives delayed or recovered enrollment.
create table private.automation_reply_watermarks (
  organization_id uuid not null,
  contact_type text not null,
  contact_id uuid not null,
  latest_reply_at timestamptz not null,
  primary key(organization_id,contact_type,contact_id)
);

create function private.automation_admit_event(e private.automation_events,p_interval uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; trigger_node jsonb; first_node text; replied boolean;
begin
  select i.workflow_id,i.version_id,v.graph,v.published_by,w.status into candidate
    from public.automation_intervals i
    join public.workflow_versions v on v.id=i.version_id and v.organization_id=i.organization_id and v.workflow_id=i.workflow_id
    join public.workflows w on w.id=i.workflow_id and w.organization_id=i.organization_id
    where i.organization_id=e.organization_id and i.id=p_interval and i.starts_at<=e.occurred_at
      and (i.ends_at is null or i.ends_at>e.occurred_at)
    for share of w;
  if not found or candidate.status not in ('paused','active') then return 0; end if;
  if not private.automation_audience_allowed(e.organization_id,candidate.published_by,e.campaign_id)
    then return 0; end if;
  select n into trigger_node from jsonb_array_elements(candidate.graph->'nodes') n
    where n->>'type'=e.event_type;
  if trigger_node is null then return 0; end if;
  if nullif(trigger_node#>>'{config,lead_source}','') is not null
    and trigger_node#>>'{config,lead_source}' is distinct from e.lead_source then return 0; end if;
  if e.event_type='campaign_membership_created' and (
    coalesce(trigger_node#>>'{config,any_campaign}','false')<>'true'
    and trigger_node#>>'{config,campaign_id}' is distinct from e.campaign_id::text
  ) then return 0; end if;
  select edge->>'target' into first_node from jsonb_array_elements(candidate.graph->'edges') edge
    where edge->>'source'=trigger_node->>'id';
  if first_node is null then return 0; end if;

  if candidate.status='paused' then
    insert into private.automation_deferred_admissions(organization_id,event_id,interval_id,workflow_id)
      values(e.organization_id,e.id,p_interval,candidate.workflow_id) on conflict do nothing;
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('automation-contact:'||e.organization_id::text||'lead'||e.contact_id::text,0));
  replied:=candidate.graph#>>'{settings,stop_on_reply}'='true' and exists(
    select 1 from private.automation_reply_watermarks m where m.organization_id=e.organization_id
      and m.contact_type='lead' and m.contact_id=e.contact_id and m.latest_reply_at>=e.occurred_at
  );
  if exists(select 1 from private.automation_runs r where r.organization_id=e.organization_id
    and r.workflow_id=candidate.workflow_id and r.contact_id=e.contact_id and r.contact_type='lead'
    and (candidate.graph#>>'{settings,reentry}' is distinct from 'after_completion'
      or r.status<>'completed' or r.ended_at>e.occurred_at)) then return 0; end if;
  insert into private.automation_runs(organization_id,workflow_id,version_id,event_id,contact_id,current_node_id,status,reason,ended_at)
    values(e.organization_id,candidate.workflow_id,candidate.version_id,e.id,e.contact_id,first_node,
      case when replied then 'stopped' else 'queued' end,
      case when replied then 'Verified reply received' end,case when replied then clock_timestamp() end)
    on conflict do nothing;
  return case when found then 1 else 0 end;
end $$;

-- Recover and enroll in bounded transactions from the same event identity and immutable interval.
create function public.automation_process_events(p_limit integer default 10)
returns integer language plpgsql security definer set search_path='' as $$
declare
  e private.automation_events;
  candidate record;
  recovery private.automation_intake_recovery;
  visited integer;
  last_interval uuid;
  count_enrolled integer:=0;
  bounded integer:=least(25,greatest(1,coalesce(p_limit,10)));
  cutoff timestamptz:=clock_timestamp();
begin
  for recovery in select * from private.automation_intake_recovery
    where retry_at<=cutoff order by retry_at,id limit bounded for update skip locked
  loop
    begin
      insert into private.automation_events(organization_id,event_type,source_id,source_revision,contact_id,campaign_id,lead_source,occurred_at)
        values(recovery.organization_id,recovery.event_type,recovery.source_id,1,recovery.contact_id,
          recovery.campaign_id,recovery.lead_source,recovery.occurred_at) on conflict do nothing;
      delete from private.automation_intake_recovery where id=recovery.id and organization_id=recovery.organization_id;
    exception when others then
      update private.automation_intake_recovery set attempts=attempts+1,last_sqlstate=sqlstate,
        retry_at=cutoff+interval '1 minute' where id=recovery.id and organization_id=recovery.organization_id;
      raise warning 'Automation intake repair delayed (SQLSTATE %)',sqlstate;
    end;
  end loop;

  -- A paused workflow never holds another interval behind its cursor.
  for candidate in select d.organization_id,d.event_id,d.interval_id from private.automation_deferred_admissions d
    join public.workflows w on w.id=d.workflow_id and w.organization_id=d.organization_id
    join private.automation_release_controls c on c.organization_id=w.organization_id
    where w.status<>'paused' and c.enrollment_enabled and d.retry_at<=cutoff order by d.retry_at,d.event_id,d.interval_id
    limit bounded for update of d skip locked for share of w,c
  loop
    begin
      select * into strict e from private.automation_events where id=candidate.event_id and organization_id=candidate.organization_id;
      count_enrolled:=count_enrolled+private.automation_admit_event(e,candidate.interval_id);
      delete from private.automation_deferred_admissions where event_id=e.id and interval_id=candidate.interval_id
        and organization_id=candidate.organization_id;
    exception when others then
      update private.automation_deferred_admissions set attempts=attempts+1,last_sqlstate=sqlstate,retry_at=cutoff+interval '1 minute'
        where event_id=candidate.event_id and interval_id=candidate.interval_id and organization_id=candidate.organization_id;
      raise warning 'Automation admission repair delayed (SQLSTATE %)',sqlstate;
    end;
  end loop;

  for e in select ev.* from private.automation_events ev
    join private.automation_release_controls ctl using(organization_id)
    where ev.processed_at is null and ev.available_at<=cutoff and ctl.enrollment_enabled
    order by ev.available_at,ev.id limit bounded for update of ev skip locked for share of ctl
  loop
    visited:=0;
    last_interval:=e.interval_cursor;
    for candidate in select i.id,i.workflow_id from public.automation_intervals i
      where i.organization_id=e.organization_id and i.starts_at<=e.occurred_at
        and (i.ends_at is null or i.ends_at>e.occurred_at)
        and (e.interval_cursor is null or i.id>e.interval_cursor)
      order by i.id limit 25
    loop
      visited:=visited+1;
      last_interval:=candidate.id;
      begin
        count_enrolled:=count_enrolled+private.automation_admit_event(e,candidate.id);
      exception when others then
        insert into private.automation_deferred_admissions(organization_id,event_id,interval_id,workflow_id,retry_at,attempts,last_sqlstate)
          values(e.organization_id,e.id,candidate.id,candidate.workflow_id,cutoff+interval '1 minute',1,sqlstate)
          on conflict(event_id,interval_id) do nothing;
        raise warning 'Automation admission retained for repair (SQLSTATE %)',sqlstate;
      end;
    end loop;
    update private.automation_events set processed_at=case when visited<25 then clock_timestamp() end,
      available_at=clock_timestamp(),interval_cursor=last_interval where id=e.id;
  end loop;
  return count_enrolled;
end $$;

-- A lease covers one node. A crashed worker can be replaced without changing the intent identity.
create function public.automation_claim_work(p_limit integer default 10)
returns setof jsonb language plpgsql security definer set search_path='' as $$
declare
  claim record;
  token uuid;
  previous_intent text;
  cutoff timestamptz := clock_timestamp();
begin
  for claim in
    select r.*,v.graph from private.automation_runs r
    join public.workflows w on w.id=r.workflow_id and w.organization_id=r.organization_id
    join public.workflow_versions v on v.id=r.version_id and v.organization_id=r.organization_id and v.workflow_id=w.id
    where w.status='active' and not r.workflow_paused and r.status in ('queued','waiting','held')
      and greatest(r.due_at,r.leased_until)<=cutoff
    order by greatest(r.due_at,r.leased_until),r.id limit least(25,greatest(1,coalesce(p_limit,10))) for update of r skip locked
  loop
    token:=gen_random_uuid();
    update private.automation_runs set lease_token=token,leased_until=clock_timestamp()+interval '2 minutes'
      where id=claim.id;
    previous_intent:=null;
    if exists(select 1 from jsonb_array_elements(claim.graph->'nodes') n
      where n->>'id'=claim.current_node_id and n->>'type' in ('send_sms','send_email')) then
      insert into private.automation_intents(organization_id,run_id,node_id,status)
        values(claim.organization_id,claim.id,claim.current_node_id,'prepared') on conflict do nothing;
      select status into previous_intent from private.automation_intents where run_id=claim.id
        and node_id=claim.current_node_id and organization_id=claim.organization_id;
    end if;
    return next jsonb_build_object('organization_id',claim.organization_id,'workflow_id',claim.workflow_id,
      'version_id',claim.version_id,'run_id',claim.id,'contact_id',claim.contact_id,'contact_type',claim.contact_type,
      'lease_token',token,'node_id',claim.current_node_id,'status',claim.status,
      'due_lag_ms',greatest(0,round(extract(epoch from cutoff-claim.due_at)*1000)),
      'uncertain_handoff',previous_intent='handed_off','stop_on_reply',claim.graph#>'{settings,stop_on_reply}','graph',claim.graph);
  end loop;
end $$;

-- Linearize the last local authorization against pause, stop, revocation and release gates.
create function public.automation_authorize_handoff(p_run uuid,p_token uuid,p_node text)
returns boolean language plpgsql security definer set search_path='' as $$
declare scope record;
begin
  select r.organization_id,r.workflow_id,v.published_by,e.campaign_id into scope
    from private.automation_runs r
    join public.workflows w on w.id=r.workflow_id and w.organization_id=r.organization_id
    join public.workflow_versions v on v.id=r.version_id and v.workflow_id=w.id and v.organization_id=w.organization_id
    join private.automation_events e on e.id=r.event_id and e.organization_id=r.organization_id
    join private.automation_release_controls ctl on ctl.organization_id=w.organization_id
    where r.id=p_run and r.lease_token=p_token and r.current_node_id=p_node and r.leased_until>=clock_timestamp()
      and r.status in ('queued','held','waiting') and w.status='active' and ctl.dispatch_enabled
    for update of w,r for share of ctl;
  if not found or not private.automation_audience_allowed(scope.organization_id,scope.published_by,scope.campaign_id)
    then return false; end if;
  update private.automation_intents set status='handed_off'
    where organization_id=scope.organization_id and run_id=p_run and node_id=p_node and status='prepared';
  return found;
end $$;

-- Persist the node outcome and graph advancement atomically. A stale lease cannot advance a run.
create function public.automation_finish_node(p_run uuid,p_token uuid,p_result text,p_reason text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  r private.automation_runs;
  graph jsonb;
  node jsonb;
  target text;
  next_status text;
  next_due timestamptz:=clock_timestamp();
  branch text;
  kind text;
begin
  select * into r from private.automation_runs where id=p_run and lease_token=p_token for update;
  if not found or r.status not in ('queued','waiting','held') then return false; end if;
  select v.graph into graph from public.workflow_versions v where v.organization_id=r.organization_id
    and v.workflow_id=r.workflow_id and v.id=r.version_id;
  select n into strict node from jsonb_array_elements(graph->'nodes') n where n->>'id'=r.current_node_id;
  kind:=node->>'type';
  -- Worker success alone cannot establish provider acceptance. The channel receipt
  -- transaction marks its original intent before normal or recovered advancement.
  if p_result='accepted' and kind in ('send_sms','send_email') and not exists(
    select 1 from private.automation_intents i where i.organization_id=r.organization_id
      and i.run_id=r.id and i.node_id=r.current_node_id and i.status='accepted'
  ) then
    if exists(select 1 from private.automation_intents i where i.organization_id=r.organization_id
      and i.run_id=r.id and i.node_id=r.current_node_id and i.status='handed_off') then
      p_result:='unknown';
      p_reason:='Awaiting confirmation of the original provider handoff';
    else
      p_result:='held';
      p_reason:='Verified handoff and provider receipt required';
    end if;
  end if;
  if p_result in ('held','failed','unknown') then
    next_status:=p_result;
    next_due:=next_due+interval '5 minutes';
  elsif kind='wait' and p_result='wait' and r.status<>'waiting' then
    next_status:='waiting';
    next_due:=next_due+(node#>>'{config,duration}')::integer *
      case node#>>'{config,unit}' when 'minutes' then interval '1 minute' when 'hours' then interval '1 hour'
        when 'days' then interval '1 day' end;
  elsif (kind in ('send_sms','send_email') and p_result='accepted')
    or (kind='wait' and p_result='elapsed' and r.status='waiting' and r.due_at<=clock_timestamp())
    or (kind='contact_has_email' and p_result in ('yes','no')) then
    branch:=case when kind='contact_has_email' then p_result end;
    select edge->>'target' into target from jsonb_array_elements(graph->'edges') edge
      where edge->>'source'=r.current_node_id and edge->>'branch' is not distinct from branch;
    next_status:=case when target is null then 'completed' else 'queued' end;
  else raise exception 'Invalid automation node outcome'; end if;

  if kind in ('send_sms','send_email') and p_result in ('accepted','failed','unknown') then
    update private.automation_intents set status=p_result where organization_id=r.organization_id
      and run_id=p_run and node_id=r.current_node_id;
  end if;
  insert into private.automation_steps(organization_id,run_id,node_id,status,reason)
    values(r.organization_id,p_run,r.current_node_id,p_result,left(p_reason,500))
    on conflict (run_id,node_id) do update set status=excluded.status,reason=excluded.reason,updated_at=clock_timestamp();
  update private.automation_runs set current_node_id=coalesce(target,r.current_node_id),status=next_status,
    reason=left(p_reason,500),due_at=next_due,lease_token=null,leased_until=null,updated_at=clock_timestamp(),
    ended_at=case when next_status in ('completed','failed','unknown') then clock_timestamp() end
    where id=p_run;
  return true;
end $$;

-- Authenticated provider callbacks may arrive before the worker finishes or after a crash.
-- Reconcile only the same run/node/intent. Stopped runs retain history without advancing.
create function private.automation_apply_receipt(p_org uuid,p_run uuid,p_node text,p_state text)
returns void language plpgsql security definer set search_path='' as $$
declare
  r private.automation_runs;
  token uuid:=gen_random_uuid();
  outcome text;
begin
  outcome:=case p_state when 'accepted' then 'accepted' when 'delivered' then 'accepted' when 'failed' then 'failed' end;
  if outcome is null then raise exception 'Unsupported provider receipt'; end if;
  select * into r from private.automation_runs where organization_id=p_org and id=p_run for update;
  if not found then return; end if;
  update private.automation_intents set status=outcome where organization_id=p_org and run_id=p_run and node_id=p_node
    and status in ('handed_off','unknown');
  if not found or r.current_node_id<>p_node or r.status not in ('queued','waiting','held','unknown') then return; end if;
  update private.automation_runs set lease_token=token,status='queued',ended_at=null where id=r.id and organization_id=p_org;
  perform public.automation_finish_node(r.id,token,outcome,'Verified provider receipt');
end $$;

create function private.automation_lifecycle_effects()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Resume only overdue work in paced groups. Future authored waits retain their due time.
  if new.status='paused' then
    update private.automation_runs set workflow_paused=true
      where organization_id=new.organization_id and workflow_id=new.id and status in ('queued','waiting','held','unknown');
  elsif new.status='active' and old.status='paused' then
    update private.automation_runs set workflow_paused=false
      where organization_id=new.organization_id and workflow_id=new.id and workflow_paused;
    with overdue as (
      select id,row_number() over(order by due_at,id)-1 as position from private.automation_runs
      where organization_id=new.organization_id and workflow_id=new.id and status in ('queued','waiting','held') and due_at<now()
    )
    update private.automation_runs r set due_at=clock_timestamp()+(overdue.position/5)*interval '10 seconds'
      from overdue where r.id=overdue.id;
  elsif new.status='archived' then
    update private.automation_runs set status='stopped',reason='Workflow archived',ended_at=clock_timestamp(),
      updated_at=clock_timestamp(),lease_token=null,leased_until=null
      where organization_id=new.organization_id and workflow_id=new.id and status in ('queued','waiting','held','unknown');
  end if;
  return new;
end $$;
create trigger automation_lifecycle_effects after update of status on public.workflows
 for each row when (old.status is distinct from new.status and new.automation_version_id is not null)
 execute function private.automation_lifecycle_effects();

-- Called only after the channel adapter verifies tenant, recipient, channel and inbound identity.
create function private.automation_cancel_reply(p_org uuid,p_contact uuid,p_contact_type text,p_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_at is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('automation-contact:'||p_org::text||p_contact_type||p_contact::text,0));
  insert into private.automation_reply_watermarks as watermark(organization_id,contact_type,contact_id,latest_reply_at)
    values(p_org,p_contact_type,p_contact,p_at) on conflict (organization_id,contact_type,contact_id)
    do update set latest_reply_at=greatest(watermark.latest_reply_at,excluded.latest_reply_at);
  update private.automation_runs r set status='stopped',reason='Verified reply received',
    ended_at=clock_timestamp(),updated_at=clock_timestamp(),lease_token=null,leased_until=null
  from public.workflow_versions v,private.automation_events e
  where v.organization_id=r.organization_id and v.workflow_id=r.workflow_id and v.id=r.version_id
    and e.organization_id=r.organization_id and e.id=r.event_id and e.occurred_at<=p_at
    and r.organization_id=p_org and r.contact_type=p_contact_type and r.contact_id=p_contact
    and r.status in ('queued','waiting','held','unknown') and v.graph#>>'{settings,stop_on_reply}'='true';
end $$;

create function private.automation_visible_lead(p_viewer uuid,p_org uuid,p_contact uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.profiles actor
    join public.leads l on l.organization_id=actor.organization_id and l.id=p_contact
    where actor.id=p_viewer and actor.status='Active' and actor.organization_id=p_org
      and (actor.role='Admin' or actor.is_super_admin is true or l.user_id=actor.id
        or (actor.role in ('Team Leader','Team Lead') and l.user_id in (select agent_id from private.resolve_downline_ids(actor.id,p_org))))
  )
$$;
create index automation_runs_recent on private.automation_runs(organization_id,updated_at desc,id desc);
-- Replaced by the channel migration once verified provider receipts are available.
create function private.automation_message_status(p_org uuid,p_run uuid,p_node text)
returns text language sql stable set search_path='' as $$ select null::text $$;
create index automation_steps_recent on private.automation_steps(organization_id,run_id,updated_at desc);

create function public.automation_activity(p_session_revision bigint,p_viewer_id uuid,p_workflow uuid default null,p_contact uuid default null,p_type text default null,
  p_before_at timestamptz default null,p_before_run uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  viewer uuid:=private.automation_viewer_id();
  visible_org uuid;
  may_stop boolean;
  activity jsonb;
begin
  if viewer is distinct from p_viewer_id or not exists (
    select 1 from private.automation_sessions s where s.session_id=private.automation_session_id()
      and s.actor_id=auth.uid() and s.revision=p_session_revision
  ) then raise exception 'Automation activity viewer changed' using errcode='42501'; end if;
  if (p_before_at is null) <> (p_before_run is null) then
    raise exception 'Incomplete activity cursor' using errcode='22023'; end if;
  select p.organization_id into visible_org from public.profiles p join private.automation_release_controls c
    on c.organization_id=p.organization_id and c.builder_visible where p.id=viewer and p.status='Active';
  may_stop:=viewer=auth.uid() and private.automation_can_author(visible_org);
  select coalesce(jsonb_agg(to_jsonb(item) order by item.updated_at desc,item.run_id desc),'[]'::jsonb) into activity from (
    select r.id run_id,r.version_id,r.workflow_id,v.name workflow_name,r.contact_id,r.contact_type,
      nullif(trim(concat_ws(' ',l.first_name,l.last_name)),'') contact_name,r.current_node_id node_id,
      case when r.workflow_paused and r.status in ('waiting','held','queued') then 'paused' else r.status end status,
      case when r.workflow_paused and r.status in ('waiting','held','queued') then 'Workflow paused' else r.reason end reason,
      r.updated_at,
      v.revision version_revision,block.node_type,
      case block.node_type when 'send_sms' then 'Send SMS' when 'send_email' then 'Send email'
        when 'wait' then 'Wait' when 'contact_has_email' then 'Contact has email' else 'Automation step' end node_label,
      case when r.status in ('waiting','held') then r.due_at end due_at,
      private.automation_message_status(r.organization_id,r.id,r.current_node_id) message_status,last_step.reason step_reason,
      may_stop and r.status in ('queued','waiting','held','unknown') can_stop
    from private.automation_runs r
    join public.workflows w on w.organization_id=r.organization_id and w.id=r.workflow_id
    join public.leads l on l.organization_id=r.organization_id and l.id=r.contact_id and r.contact_type='lead'
    join public.workflow_versions v on v.organization_id=r.organization_id and v.workflow_id=r.workflow_id and v.id=r.version_id
    left join lateral (select n->>'type' node_type from jsonb_array_elements(v.graph->'nodes') n where n->>'id'=r.current_node_id limit 1) block on true
    left join lateral (select s.reason from private.automation_steps s where s.organization_id=r.organization_id and s.run_id=r.id
      order by s.updated_at desc limit 1) last_step on true
    where r.organization_id=visible_org and (p_contact is null or r.contact_id=p_contact)
      and (p_workflow is null or r.workflow_id=p_workflow) and (p_type is null or r.contact_type=p_type)
      and (p_before_at is null or (r.updated_at,r.id)<(p_before_at,p_before_run))
      and private.automation_visible_lead(viewer,r.organization_id,r.contact_id)
    order by r.updated_at desc,r.id desc limit 100
  ) item;
  return activity;
end $$;

create function public.automation_stop_run(p_run uuid,p_session_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid:=private.automation_require_author(p_session_revision);
begin
  update private.automation_runs set status='stopped',reason='Stopped by user',ended_at=clock_timestamp(),
    updated_at=clock_timestamp(),lease_token=null,leased_until=null
    where id=p_run and organization_id=org and status in ('queued','waiting','held','unknown')
      and private.automation_visible_lead(auth.uid(),organization_id,contact_id);
  if not found then raise exception 'Running automation unavailable' using errcode='42501'; end if;
end $$;

alter table private.automation_events enable row level security;
alter table private.automation_intake_recovery enable row level security;
alter table private.automation_runs enable row level security;
alter table private.automation_intents enable row level security;
alter table private.automation_steps enable row level security;
alter table private.automation_deferred_admissions enable row level security;
alter table private.automation_reply_watermarks enable row level security;
revoke all on table private.automation_events,private.automation_intake_recovery,private.automation_runs,
 private.automation_intents,private.automation_steps,private.automation_deferred_admissions,private.automation_reply_watermarks from public,anon,authenticated;
revoke all on function private.automation_message_status(uuid,uuid,text),private.automation_admit_event(private.automation_events,uuid),private.automation_capture_event(),private.automation_lifecycle_effects(),
 private.automation_cancel_reply(uuid,uuid,text,timestamptz),private.automation_apply_receipt(uuid,uuid,text,text),private.automation_visible_lead(uuid,uuid,uuid),
 public.automation_authorize_handoff(uuid,uuid,text),public.automation_process_events(integer),public.automation_claim_work(integer),
 public.automation_finish_node(uuid,uuid,text,text),public.automation_activity(bigint,uuid,uuid,uuid,text,timestamptz,uuid),
 public.automation_stop_run(uuid,bigint) from public,anon,authenticated;
grant execute on function public.automation_process_events(integer),public.automation_claim_work(integer),
 public.automation_finish_node(uuid,uuid,text,text),public.automation_authorize_handoff(uuid,uuid,text) to service_role;
grant execute on function public.automation_activity(bigint,uuid,uuid,uuid,text,timestamptz,uuid),public.automation_stop_run(uuid,bigint) to authenticated;
commit;
