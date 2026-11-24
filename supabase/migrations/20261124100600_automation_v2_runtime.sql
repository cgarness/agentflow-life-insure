-- Automations V2 runtime. Leases carry the facts a step needs, internal task steps are created once,
-- appointment waits follow the appointment, and activity shows every contact type with the step name
-- from the version that ran. Installs no job, definition, enrollment or send.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Never installed over a database where Automations V2 was rolled back, or where a stopped installation was backed
-- out: the files after a back-out would run beside restored first-release functions. That takes a new migration.
DO $v2_guard$ BEGIN
  IF to_regprocedure('private.automation_v2_rollback_guard()') IS NOT NULL
      OR to_regprocedure('private.automation_v2_backed_out()') IS NOT NULL THEN
    RAISE EXCEPTION 'Automations V2 was rolled back or backed out on this database. Installing it again takes a new migration.';
  END IF;
END $v2_guard$;

-- A lease covers one node. A run whose stop condition already happened ends here instead of running,
-- and the claim keeps looking, so a page of stopped runs never reads as an empty queue. A lease records
-- the appointment slot its facts describe, which the provider handoff checks again. A message about an appointment
-- that has moved since its reminder time, or that has already started, is skipped here rather than handed out.
CREATE OR REPLACE FUNCTION public.automation_claim_work(p_limit integer default 10)
returns setof jsonb language plpgsql security definer set search_path='' as $$
declare
  run private.automation_runs;
  graph jsonb;
  node jsonb;
  origin private.automation_events;
  slot_id uuid;
  slot_start timestamptz;
  token uuid;
  previous_intent text;
  cutoff timestamptz := clock_timestamp();
  bounded integer := least(25,greatest(1,coalesce(p_limit,10)));
  leased integer := 0;
  examined integer := 0;
  fetched integer;
begin
  loop
    fetched:=0;
    for run in
      select r.* from private.automation_runs r
      join public.workflows w on w.id=r.workflow_id and w.organization_id=r.organization_id
      where w.status='active' and not r.workflow_paused and r.status in ('queued','waiting','held')
        and greatest(r.due_at,r.leased_until)<=cutoff
      order by greatest(r.due_at,r.leased_until),r.id limit bounded-leased for update of r skip locked
    loop
      fetched:=fetched+1;
      examined:=examined+1;
      if private.automation_settle_stop(run) then continue; end if;
      -- Its appointment moved after it gave a reminder, and admitting the new time will decide whether the
      -- automation starts again. Until then the run does nothing on the old time.
      if private.automation_awaits_restart(run) then
        update private.automation_runs set due_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp()
          where id=run.id;
        continue;
      end if;
      select v.graph into graph from public.workflow_versions v
        where v.id=run.version_id and v.organization_id=run.organization_id and v.workflow_id=run.workflow_id;
      select n into node from jsonb_array_elements(graph->'nodes') n where n->>'id'=run.current_node_id;
      select * into origin from private.automation_events ev where ev.id=run.event_id and ev.organization_id=run.organization_id;
      slot_id:=null;
      slot_start:=null;
      if origin.event_type='appointment_booked' then
        select s.occurrence_id,s.starts_at into slot_id,slot_start
          from private.automation_appointment_state(run.organization_id,nullif(origin.subject->>'appointment_id','')::uuid) s;
      end if;
      -- An appointment moved away and back to the time a reminder was for is still at that time, so the reminder still
      -- describes it: the run follows the slot the appointment is in now.
      if run.reminded_for is not null and slot_id is not null and run.reminded_for is distinct from slot_id
          and exists (select 1 from private.appointment_occurrences o where o.organization_id=run.organization_id
            and o.id=run.reminded_for and o.scheduled_start=slot_start) then
        if run.anchor_id is not distinct from run.reminded_for then run.anchor_id:=slot_id; run.anchor_at:=slot_start; end if;
        run.reminded_for:=slot_id;
      end if;
      token:=gen_random_uuid();
      update private.automation_runs set lease_token=token,leased_until=clock_timestamp()+interval '2 minutes',leased_for=slot_id,
          reminded_for=run.reminded_for,anchor_id=run.anchor_id,anchor_at=run.anchor_at
        where id=run.id;
      -- A reminder is written for the time it became due for. When the appointment has moved since and the
      -- automation is not starting again for the new time, that reminder is not sent, and the run goes on to
      -- its next step, which follows the current time. A message that may already be with a provider is
      -- reconciled instead.
      if node->>'type' in ('send_sms','send_email') and run.reminded_for is not null
          and run.reminded_for is distinct from slot_id
          and not exists (select 1 from private.automation_intents i where i.organization_id=run.organization_id
            and i.run_id=run.id and i.node_id=run.current_node_id and i.status<>'prepared') then
        perform public.automation_finish_node(run.id,token,'skipped','The appointment moved after this reminder was due');
        continue;
      end if;
      -- A message timed before its appointment is not sent once the appointment has started, as a reminder wait whose
      -- time passed is not: one held until then (by sending hours, a limit, a pause) is skipped, and the run goes on.
      if node->>'type' in ('send_sms','send_email') and origin.event_type='appointment_booked'
          and slot_start<=clock_timestamp() and coalesce(run.paced_from,origin.occurred_at)<slot_start
          and not exists (select 1 from private.automation_intents i where i.organization_id=run.organization_id
            and i.run_id=run.id and i.node_id=run.current_node_id and i.status<>'prepared') then
        perform public.automation_finish_node(run.id,token,'skipped','The appointment had already started');
        continue;
      end if;
      previous_intent:=null;
      if node->>'type' in ('send_sms','send_email') then
        insert into private.automation_intents(organization_id,run_id,node_id,status)
          values(run.organization_id,run.id,run.current_node_id,'prepared') on conflict do nothing;
        select i.status into previous_intent from private.automation_intents i where i.run_id=run.id
          and i.node_id=run.current_node_id and i.organization_id=run.organization_id;
      end if;
      return next jsonb_build_object('organization_id',run.organization_id,'workflow_id',run.workflow_id,
        'version_id',run.version_id,'run_id',run.id,'contact_id',run.contact_id,'contact_type',run.contact_type,
        'lease_token',token,'node_id',run.current_node_id,'status',run.status,
        'due_lag_ms',greatest(0,round(extract(epoch from cutoff-run.due_at)*1000)),
        'uncertain_handoff',previous_intent='handed_off','stop_on_reply',graph#>'{settings,stop_on_reply}','graph',graph,
        'trigger',origin.event_type,
        'context',jsonb_strip_nulls(jsonb_build_object(
          'appointment_start',case origin.event_type
            when 'appointment_booked' then slot_start
            when 'appointment_outcome_recorded' then (select o.scheduled_start from private.appointment_occurrences o
              where o.organization_id=run.organization_id and o.id=nullif(origin.subject->>'occurrence_id','')::uuid) end,
          'agency_timezone',private.automation_agency_time_zone(run.organization_id),
          'caller_phone',origin.subject->>'caller_phone',
          'sms_purpose',(select p.purpose from private.automation_sms_purposes p
            where p.organization_id=run.organization_id and p.version_id=run.version_id and p.node_id=run.current_node_id))));
      leased:=leased+1;
    end loop;
    -- Leased and stopped runs no longer match, so another pass only sees work not yet examined.
    exit when fetched=0 or leased>=bounded or examined>=bounded*8;
  end loop;
end $$;

-- Persist the node outcome and graph advancement atomically. A stale lease cannot advance a run.
CREATE OR REPLACE FUNCTION public.automation_finish_node(p_run uuid,p_token uuid,p_result text,p_reason text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  r private.automation_runs;
  graph jsonb;
  node jsonb;
  origin private.automation_events;
  placed record;
  target text;
  next_status text;
  next_due timestamptz:=clock_timestamp();
  next_anchor uuid;
  next_anchor_at timestamptz;
  next_held_since timestamptz;
  next_reminded_for uuid;
  next_paced_from timestamptz;
  held_for interval;
  step_status text:=p_result;
  advance boolean:=false;
  branch text;
  kind text;
begin
  select * into r from private.automation_runs where id=p_run and lease_token=p_token for update;
  if not found or r.status not in ('queued','waiting','held') then return false; end if;
  select v.graph into graph from public.workflow_versions v where v.organization_id=r.organization_id
    and v.workflow_id=r.workflow_id and v.id=r.version_id;
  select n into strict node from jsonb_array_elements(graph->'nodes') n where n->>'id'=r.current_node_id;
  kind:=node->>'type';
  -- The slot a run last waited for stays on the run, so the same slot is never handled twice.
  next_anchor:=r.anchor_id;
  next_anchor_at:=r.anchor_at;
  next_reminded_for:=r.reminded_for;
  next_paced_from:=r.paced_from;
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
    step_status:=p_result;
  end if;
  if p_result='held' then
    -- A hold is retried after five minutes, then less often the longer it lasts (half the time held so
    -- far, at most six hours). A run held for seven days ends with the reason it was held.
    held_for:=case when r.status='held' and r.held_since is not null then clock_timestamp()-r.held_since else interval '0' end;
    if held_for>interval '7 days' then
      next_status:='stopped';
      step_status:='stopped';
      p_reason:='Stopped after 7 days on hold: '||coalesce(p_reason,'no reason given');
    else
      next_status:='held';
      next_held_since:=case when r.status='held' then coalesce(r.held_since,clock_timestamp()) else clock_timestamp() end;
      next_due:=next_due+least(interval '6 hours',greatest(interval '5 minutes',held_for/2));
    end if;
  elsif p_result in ('failed','unknown') then
    next_status:=p_result;
    next_due:=next_due+interval '5 minutes';
  elsif kind='create_task' and p_result='stopped' then
    next_status:='stopped';
  elsif kind='wait' and p_result='wait' and r.status<>'waiting' then
    next_status:='waiting';
    next_due:=next_due+(node#>>'{config,duration}')::integer *
      case node#>>'{config,unit}' when 'minutes' then interval '1 minute' when 'hours' then interval '1 hour'
        when 'days' then interval '1 day' end;
  elsif kind='wait_until_before_appointment' and p_result in ('wait','elapsed') then
    select * into origin from private.automation_events ev where ev.id=r.event_id and ev.organization_id=r.organization_id;
    select * into placed from private.automation_appointment_wait(r.organization_id,
      nullif(origin.subject->>'appointment_id','')::uuid,node);
    if placed.verdict='gone' then
      next_status:='stopped';
      step_status:='stopped';
      p_reason:='Appointment was removed';
    elsif r.status='waiting' and r.due_at<=clock_timestamp() and placed.verdict<>'past'
      and placed.anchor is not distinct from r.anchor_id and placed.anchor_start is not distinct from r.anchor_at then
      -- The wait this run was given has elapsed and the appointment still stands at the same time.
      advance:=true;
      step_status:='elapsed';
      next_reminded_for:=r.anchor_id;
      next_paced_from:=r.due_at;
    elsif placed.verdict='wait' then
      -- First arrival, or the appointment moved while this run slept: wait for the current time.
      next_status:='waiting';
      next_due:=placed.due;
      next_anchor:=placed.anchor;
      next_anchor_at:=placed.anchor_start;
      step_status:='wait';
    elsif placed.verdict='advance' then
      advance:=true;
      next_anchor:=placed.anchor;
      next_anchor_at:=placed.anchor_start;
      next_reminded_for:=placed.anchor;
      -- The reminder time passed before the run reached it: later steps count from the reminder time,
      -- or from the event when the event came after it.
      next_paced_from:=greatest(r.paced_from,placed.due);
      step_status:='elapsed';
      p_reason:='The reminder time had already passed';
    else
      next_status:='completed';
      next_anchor:=placed.anchor;
      next_anchor_at:=placed.anchor_start;
      step_status:='skipped';
      p_reason:=case placed.verdict when 'past' then 'The appointment had already started'
        else 'The reminder time had already passed' end;
    end if;
  elsif kind='wait' and p_result='elapsed' and r.status='waiting' and r.due_at<=clock_timestamp() then
    -- Later steps count from the end this wait was given, however late the worker reached it.
    advance:=true;
    next_paced_from:=r.due_at;
  elsif (kind in ('send_sms','send_email') and p_result in ('accepted','skipped'))
    or (kind='create_task' and p_result in ('created','skipped'))
    or (kind='contact_has_email' and p_result in ('yes','no','skipped')) then
    advance:=true;
  else raise exception 'Invalid automation node outcome'; end if;

  if advance then
    -- A condition without a contact has no email, so it follows the No branch.
    branch:=case when kind='contact_has_email' then case p_result when 'yes' then 'yes' else 'no' end end;
    select edge->>'target' into target from jsonb_array_elements(graph->'edges') edge
      where edge->>'source'=r.current_node_id and edge->>'branch' is not distinct from branch;
    next_status:=case when target is null then 'completed' else 'queued' end;
  end if;

  if kind in ('send_sms','send_email') and p_result in ('accepted','failed','unknown') then
    update private.automation_intents set status=p_result where organization_id=r.organization_id
      and run_id=p_run and node_id=r.current_node_id;
  end if;
  insert into private.automation_steps(organization_id,run_id,node_id,status,reason)
    values(r.organization_id,p_run,r.current_node_id,step_status,left(p_reason,500))
    on conflict (run_id,node_id) do update set status=excluded.status,reason=excluded.reason,updated_at=clock_timestamp();
  update private.automation_runs set current_node_id=coalesce(target,r.current_node_id),status=next_status,
    reason=left(p_reason,500),due_at=next_due,anchor_id=next_anchor,anchor_at=next_anchor_at,held_since=next_held_since,
    reminded_for=next_reminded_for,paced_from=next_paced_from,
    lease_token=null,leased_until=null,updated_at=clock_timestamp(),
    ended_at=case when next_status in ('completed','failed','unknown','stopped') then clock_timestamp() end
    where id=p_run;
  return true;
end $$;

-- What would keep a leased message from going out now, or null. Nothing that ends the run has happened since the
-- lease, and a message about a booking still describes the appointment's current time: the time of the slot its
-- lease's facts came from, and of the slot its reminders were for, is the appointment's time now. The calendar itself
-- shows that time too: a move whose slot record could not be written in time (a capture gap, repaired by the
-- appointment's next save) holds the message until the record catches up. A message timed before the appointment is
-- not sent once it has started.
CREATE FUNCTION private.automation_message_issue(r private.automation_runs)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE origin private.automation_events; reason text; appointment uuid; current_slot uuid; slot_start timestamptz; booked_start timestamptz;
BEGIN
  SELECT s.stop_reason INTO reason FROM private.automation_stop_check(r) s WHERE s.stop_reason IS NOT NULL LIMIT 1;
  IF reason IS NOT NULL THEN RETURN reason; END IF;
  SELECT * INTO origin FROM private.automation_events e WHERE e.organization_id=r.organization_id AND e.id=r.event_id;
  IF origin.event_type IS DISTINCT FROM 'appointment_booked' THEN RETURN NULL; END IF;
  appointment:=nullif(origin.subject->>'appointment_id','')::uuid;
  SELECT s.occurrence_id,s.starts_at INTO current_slot,slot_start
    FROM private.automation_appointment_state(r.organization_id,appointment) s;
  SELECT a.start_time INTO booked_start FROM public.appointments a WHERE a.organization_id=r.organization_id AND a.id=appointment;
  IF current_slot IS NULL
      OR NOT EXISTS (SELECT 1 FROM private.appointment_occurrences o WHERE o.organization_id=r.organization_id
        AND o.id=r.leased_for AND o.scheduled_start=slot_start)
      OR (r.reminded_for IS NOT NULL AND NOT EXISTS (SELECT 1 FROM private.appointment_occurrences o
        WHERE o.organization_id=r.organization_id AND o.id=r.reminded_for AND o.scheduled_start=slot_start)) THEN
    RETURN 'The appointment moved after this message was prepared';
  END IF;
  IF booked_start IS DISTINCT FROM slot_start THEN
    RETURN 'The appointment''s new time is not recorded yet';
  END IF;
  IF slot_start<=clock_timestamp() AND coalesce(r.paced_from,origin.occurred_at)<slot_start THEN
    RETURN 'The appointment had already started';
  END IF;
  RETURN NULL;
END $$;

-- Asked by the worker before it reserves a provider request, so a change already made holds the message without
-- spending that request. Only an answer sooner: the handoff checks again under lock. A message already handed to a
-- provider is left to its own record, so a replay still finds its original receipt.
CREATE FUNCTION public.automation_message_check(p_run uuid,p_token uuid,p_node text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM private.automation_intents i WHERE i.run_id=p_run AND i.node_id=p_node
        AND i.status<>'prepared') THEN NULL
    WHEN r.id IS NULL THEN 'This step is no longer leased to this worker'
    ELSE private.automation_message_issue(r) END
  FROM (SELECT 1) one LEFT JOIN private.automation_runs r ON r.id=p_run AND r.lease_token=p_token AND r.current_node_id=p_node
    AND r.leased_until>=clock_timestamp() AND r.status IN ('queued','held','waiting')
$$;

-- Linearize the last local authorization against pause, stop, revocation and release gates, and against the
-- appointment the message is about (automation_message_issue). The appointment row is share-locked before it is
-- read, so a move or cancellation either committed first and refuses the handoff, or waits until the handoff is
-- recorded. A save of the appointment still in progress is waited for briefly (half a second), so a short one commits
-- and the check sees what it changed. A longer one refuses the handoff without spending the provider request
-- (automation_release_refused_dispatch): the worker holds the message, and the next lease, a few minutes later, sends
-- it if it is still due. The worker waits on a calendar save, never the other way round, and it is always the first to
-- wait, so it gives up before any deadlock check could abort the save.
CREATE OR REPLACE FUNCTION public.automation_authorize_handoff(p_run uuid,p_token uuid,p_node text)
returns boolean language plpgsql security definer set search_path='' as $$
declare scope record; run private.automation_runs; origin private.automation_events; waited text;
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
  select * into run from private.automation_runs where id=p_run;
  select * into origin from private.automation_events ev where ev.id=run.event_id and ev.organization_id=run.organization_id;
  if origin.event_type in ('appointment_booked','appointment_outcome_recorded') then
    waited:=current_setting('lock_timeout');
    perform set_config('lock_timeout','500ms',true);
    begin
      perform 1 from public.appointments a where a.organization_id=run.organization_id
        and a.id=nullif(origin.subject->>'appointment_id','')::uuid for share;
    exception when lock_not_available then
      perform set_config('lock_timeout',waited,true);
      return false;
    end;
    perform set_config('lock_timeout',waited,true);
  end if;
  if private.automation_message_issue(run) is not null then return false; end if;
  update private.automation_intents set status='handed_off'
    where organization_id=scope.organization_id and run_id=p_run and node_id=p_node and status='prepared';
  return found;
end $$;

-- A text refused before its handoff can try again on a later lease. The sticky sending path cancels a reservation that
-- a refusal left unsent (sms_cancel_prepared_dispatch), and a step's request key never changes, so a cancelled
-- reservation would otherwise keep the step from ever sending: a reminder refused for sending hours, a daily limit,
-- delivery being off, a stale reply feed or a calendar save in progress. The worker holding the step's lease clears
-- it before it reserves again, and only a reservation no provider has seen: cancelled before any handoff, with no
-- provider message, no message written for the step and an intent never handed off. A reservation in any other state,
-- or none, is left to the sending path, which never sends it twice and finds a replay's own receipt.
CREATE FUNCTION public.automation_release_refused_dispatch(p_run uuid,p_token uuid,p_node text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.automation_runs; d public.sms_dispatches; request text:='automation:'||p_run::text||':'||p_node;
BEGIN
  SELECT * INTO r FROM private.automation_runs WHERE id=p_run;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO d FROM public.sms_dispatches WHERE organization_id=r.organization_id AND request_key=request;
  IF NOT FOUND OR d.state<>'failed' OR d.error_code IS DISTINCT FROM 'pre_handoff_cancelled' THEN RETURN true; END IF;
  IF r.lease_token IS DISTINCT FROM p_token OR r.current_node_id IS DISTINCT FROM p_node
      OR r.leased_until<clock_timestamp() OR r.status NOT IN ('queued','held','waiting') THEN RETURN false; END IF;
  -- The recipient's lock, as the sending path takes it before it cancels or starts a reservation.
  PERFORM private.affinity_lock(r.organization_id,d.phone_e164);
  DELETE FROM public.sms_dispatches s WHERE s.organization_id=r.organization_id AND s.request_key=request
    AND s.state='failed' AND s.error_code='pre_handoff_cancelled' AND s.provider_sid IS NULL AND s.message_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM private.automation_messages m WHERE m.organization_id=r.organization_id
      AND m.run_id=p_run AND m.node_id=p_node)
    AND EXISTS (SELECT 1 FROM private.automation_intents i WHERE i.organization_id=r.organization_id
      AND i.run_id=p_run AND i.node_id=p_node AND i.status='prepared');
  RETURN true;
END $$;

-- Create the task for a "Create task" step exactly once. The worker supplies the rendered text.
-- The database decides who it is for, when it is due and whether it should exist at all.
CREATE FUNCTION public.automation_create_task(p_run uuid,p_token uuid,p_node text,p_title text,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.automation_runs; published record; node jsonb; cfg jsonb; origin private.automation_events;
  title text:=left(btrim(coalesce(p_title,'')),200); notes text:=nullif(left(btrim(coalesce(p_notes,'')),2000),'');
  kind text; owner_id uuid; claimant uuid; due timestamptz; made uuid; inbound uuid; evidence text; known boolean;
BEGIN
  SELECT run.* INTO r FROM private.automation_runs run WHERE run.id=p_run;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','held','reason','Run is unavailable'); END IF;
  -- Workflow before run, the same order a pause takes, so a pause never waits behind this step.
  PERFORM 1 FROM public.workflows w WHERE w.id=r.workflow_id AND w.organization_id=r.organization_id
    AND w.status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','held','reason','Workflow is not active'); END IF;
  SELECT run.* INTO r FROM private.automation_runs run WHERE run.id=p_run AND run.lease_token=p_token
    AND run.current_node_id=p_node AND run.leased_until>=clock_timestamp()
    AND run.status IN ('queued','held','waiting') AND NOT run.workflow_paused FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','held','reason','Run no longer permits this step'); END IF;
  SELECT v.graph,v.published_by INTO published FROM public.workflow_versions v
    WHERE v.organization_id=r.organization_id AND v.workflow_id=r.workflow_id AND v.id=r.version_id;
  SELECT n INTO node FROM jsonb_array_elements(published.graph->'nodes') n WHERE n->>'id'=p_node AND n->>'type'='create_task';
  IF NOT FOUND THEN RAISE EXCEPTION 'Published task step changed.'; END IF;
  cfg:=node->'config';
  SELECT * INTO origin FROM private.automation_events ev WHERE ev.id=r.event_id AND ev.organization_id=r.organization_id;
  IF NOT private.automation_audience_allowed(r.organization_id,published.published_by,origin.campaign_id) THEN
    RETURN jsonb_build_object('status','held','reason','Publisher no longer has authority over this audience'); END IF;
  -- A replayed or re-leased step finds its own record and creates nothing more.
  IF EXISTS (SELECT 1 FROM private.automation_task_receipts x WHERE x.run_id=r.id AND x.node_id=p_node) THEN
    RETURN jsonb_build_object('status','created'); END IF;
  -- Turning enrollment off stops automation output for the agency, the way turning message delivery off
  -- stops messages. An operator's change waits for this step, or this step sees the change.
  PERFORM 1 FROM private.automation_release_controls c WHERE c.organization_id=r.organization_id AND c.enrollment_enabled FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','held','reason','Automations are turned off for this agency'); END IF;
  IF private.automation_settle_stop(r) THEN
    RETURN jsonb_build_object('status','stopped','reason',(SELECT run.reason FROM private.automation_runs run WHERE run.id=r.id));
  END IF;
  -- Fields that render to nothing (an unmatched caller, a contact without a name) still give the task
  -- a title: the step's name, the caller for a missed call, or the task type.
  IF title='' THEN
    title:=left(coalesce(nullif(btrim(node#>>'{meta,name}'),''),
      CASE WHEN origin.event_type='inbound_call_missed' THEN 'Call back '||coalesce(nullif(origin.subject->>'caller_phone',''),'the caller') END,
      cfg->>'task_type','Follow Up'),200);
  END IF;
  -- Due a set time after the moment this step counts from: the event for a step with no wait before it, or
  -- the end the last wait was given. A worker that reaches the step late, a hold or a replay leaves it unchanged.
  due:=coalesce(r.paced_from,clock_timestamp())+(cfg->>'due_amount')::integer * CASE cfg->>'due_unit'
    WHEN 'minutes' THEN interval '1 minute' WHEN 'hours' THEN interval '1 hour' ELSE interval '1 day' END;
  known:=r.contact_id IS NOT NULL
    AND private.automation_contact_type(r.organization_id,r.contact_id) IS NOT DISTINCT FROM r.contact_type;

  IF origin.event_type='inbound_call_missed' THEN
    inbound:=nullif(origin.subject->>'call_id','')::uuid;
    -- Every writer of an answer updates or locks this call row, so an answer is ordered against this step: either it
    -- committed first and is read below, or it waits for this step to commit and automation_settle_answered_call then
    -- closes what this step made.
    PERFORM 1 FROM public.calls c WHERE c.organization_id=r.organization_id AND c.id=inbound FOR SHARE;
    evidence:=private.automation_inbound_evidence(r.organization_id,inbound);
    IF evidence='unknown' THEN RETURN jsonb_build_object('status','stopped','reason','Call record no longer exists'); END IF;
    IF evidence='answered' THEN RETURN jsonb_build_object('status','stopped','reason','Call was answered'); END IF;
    IF evidence='ambiguous' THEN
      RETURN jsonb_build_object('status','held','reason','Waiting for confirmation of whether the call was answered'); END IF;
    IF evidence='conflicting' THEN
      RETURN jsonb_build_object('status','held','reason','The call''s answer records disagree. Waiting until they agree'); END IF;
    IF evidence<>'missed' THEN
      RETURN jsonb_build_object('status','held','reason','Waiting for confirmation of whether the call was answered'); END IF;
    -- At most one callback per inbound call, whichever automation reaches it first.
    PERFORM pg_advisory_xact_lock(hashtextextended('automation-callback:'||inbound::text,0));
    IF EXISTS (SELECT 1 FROM private.automation_task_receipts x
        WHERE x.organization_id=r.organization_id AND x.scope_key='call:'||inbound::text) THEN
      RETURN jsonb_build_object('status','skipped','reason','A callback already exists for this call'); END IF;
    -- A known caller's task belongs to the contact's own active agent, like every automation task.
    IF known THEN owner_id:=private.automation_contact_owner(r.organization_id,r.contact_type,r.contact_id); END IF;
    IF owner_id IS NULL THEN
      -- The caller is not a contact, or the contact has no active agent: the callback waits in Inbounds,
      -- already claimed by the agent the call was for (the direct line dialed, or a recent outbound call)
      -- when there is one. The list shows a contact's name, and title and notes rendered for the contact,
      -- only to people who can see the contact.
      claimant:=private.automation_inbound_responsible(r.organization_id,inbound,NULL,NULL);
      INSERT INTO public.inbound_callbacks(organization_id,call_id,run_id,caller_phone,contact_id,contact_type,title,notes,due_at,
          status,claimed_by,claimed_at)
        VALUES(r.organization_id,inbound,r.id,nullif(origin.subject->>'caller_phone',''),
          CASE WHEN known THEN r.contact_id END,CASE WHEN known THEN r.contact_type END,title,notes,due,
          CASE WHEN claimant IS NULL THEN 'open' ELSE 'claimed' END,claimant,
          CASE WHEN claimant IS NOT NULL THEN clock_timestamp() END)
        ON CONFLICT (call_id) DO NOTHING RETURNING id INTO made;
      IF made IS NULL THEN
        RETURN jsonb_build_object('status','skipped','reason','A callback already exists for this call'); END IF;
      INSERT INTO private.automation_task_receipts(organization_id,run_id,node_id,workflow_id,scope_key,kind,record_id)
        VALUES(r.organization_id,r.id,p_node,r.workflow_id,'call:'||inbound::text,'callback',made);
      RETURN jsonb_build_object('status','created');
    END IF;
  ELSE
    IF r.contact_id IS NULL THEN
      RETURN jsonb_build_object('status','skipped','reason','This run has no matched contact'); END IF;
    IF NOT known THEN
      RETURN jsonb_build_object('status','stopped','reason',CASE WHEN r.contact_type='lead' AND EXISTS (
          SELECT 1 FROM public.clients c WHERE c.organization_id=r.organization_id AND c.lead_id=r.contact_id)
        THEN 'Lead converted to client' ELSE 'Contact no longer exists' END); END IF;
    owner_id:=private.automation_contact_owner(r.organization_id,r.contact_type,r.contact_id);
    IF owner_id IS NULL THEN
      RETURN jsonb_build_object('status','held','reason','Contact has no active assigned agent'); END IF;
    -- A repeated trigger does not stack a second task on the agent while their earlier one is still open.
    -- A task left with an agent the contact no longer belongs to does not hold back the current agent's.
    IF EXISTS (SELECT 1 FROM private.automation_task_receipts x
        JOIN public.tasks t ON t.id=x.record_id AND t.organization_id=x.organization_id
        WHERE x.organization_id=r.organization_id AND x.workflow_id=r.workflow_id AND x.node_id=p_node AND x.kind='task'
          AND x.scope_key IS NOT DISTINCT FROM r.scope_key AND x.run_id<>r.id AND t.completed_at IS NULL
          AND t.assigned_to=owner_id) THEN
      RETURN jsonb_build_object('status','skipped','reason','An earlier task from this automation is still open'); END IF;
  END IF;

  INSERT INTO public.tasks(organization_id,contact_id,contact_type,assigned_to,created_by,title,task_type,due_date,notes,
      all_day,automation_run_id)
    VALUES(r.organization_id,r.contact_id,r.contact_type,owner_id,NULL,title,cfg->>'task_type',due,notes,false,r.id)
    RETURNING id INTO made;
  INSERT INTO private.automation_task_receipts(organization_id,run_id,node_id,workflow_id,scope_key,kind,record_id)
    VALUES(r.organization_id,r.id,p_node,r.workflow_id,
      CASE WHEN origin.event_type='inbound_call_missed' THEN 'call:'||inbound::text ELSE r.scope_key END,'task',made);
  RETURN jsonb_build_object('status','created');
END $$;

-- The verified zone an automated message to this recipient is written in. The recipient is normalized
-- the way the handoff normalizes it (E.164 for a phone, trimmed lower case for an email), so a lead
-- phone stored as 11 digits finds the same eligibility record the handoff requires.
CREATE FUNCTION public.automation_message_timezone(p_run uuid,p_channel text,p_recipient text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE wanted text;
BEGIN
  IF p_channel='sms' THEN
    BEGIN wanted:=private.affinity_phone(p_recipient);
    EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
  ELSE wanted:=lower(btrim(p_recipient)); END IF;
  RETURN (SELECT f.timezone_name FROM private.automation_runs r JOIN private.automation_recipient_facts f
      ON f.organization_id=r.organization_id AND f.contact_id=r.contact_id AND f.contact_type=r.contact_type
    WHERE r.id=p_run AND f.channel=p_channel AND f.destination=wanted AND f.valid_until>clock_timestamp()
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=f.timezone_name)
    LIMIT 1);
END $$;

CREATE OR REPLACE FUNCTION public.automation_activity(p_session_revision bigint,p_viewer_id uuid,p_workflow uuid default null,p_contact uuid default null,p_type text default null,
  p_before_at timestamptz default null,p_before_run uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  viewer uuid:=private.automation_viewer_id();
  visible_org uuid;
  may_stop boolean;
  agency_wide boolean;
  activity jsonb;
begin
  if viewer is distinct from p_viewer_id or not exists (
    select 1 from private.automation_sessions s where s.session_id=private.automation_session_id()
      and s.actor_id=auth.uid() and s.revision=p_session_revision
  ) then raise exception 'Automation activity viewer changed' using errcode='42501'; end if;
  if (p_before_at is null) <> (p_before_run is null) then
    raise exception 'Incomplete activity cursor' using errcode='22023'; end if;
  select p.organization_id,(p.role='Admin' or p.is_super_admin is true) into visible_org,agency_wide
    from public.profiles p join private.automation_release_controls c
    on c.organization_id=p.organization_id and c.builder_visible where p.id=viewer and p.status='Active';
  may_stop:=viewer=auth.uid() and private.automation_can_author(visible_org);
  select coalesce(jsonb_agg(to_jsonb(item) order by item.updated_at desc,item.run_id desc),'[]'::jsonb) into activity from (
    select r.id run_id,r.version_id,r.workflow_id,v.name workflow_name,r.contact_id,r.contact_type,
      coalesce(person.name,case when r.contact_id is null then nullif(origin.subject->>'caller_phone','') end) contact_name,
      r.current_node_id node_id,
      case when r.workflow_paused and r.status in ('waiting','held','queued') then 'paused' else r.status end status,
      case when r.workflow_paused and r.status in ('waiting','held','queued') then 'Workflow paused' else r.reason end reason,
      r.updated_at,
      v.revision version_revision,block.node_type,
      case block.node_type when 'send_sms' then 'Send SMS' when 'send_email' then 'Send email'
        when 'wait' then 'Wait' when 'contact_has_email' then 'Contact has email'
        when 'create_task' then 'Create task for assigned agent'
        when 'wait_until_before_appointment' then 'Wait until before appointment' else 'Automation step' end node_label,
      -- The name the step had in the version this run executed.
      block.node_name,
      case when r.status in ('waiting','held') then r.due_at end due_at,
      private.automation_message_status(r.organization_id,r.id,r.current_node_id) message_status,last_step.reason step_reason,
      may_stop and r.status in ('queued','waiting','held','unknown') can_stop
    from private.automation_runs r
    join public.workflows w on w.organization_id=r.organization_id and w.id=r.workflow_id
    join private.automation_events origin on origin.organization_id=r.organization_id and origin.id=r.event_id
    join public.workflow_versions v on v.organization_id=r.organization_id and v.workflow_id=r.workflow_id and v.id=r.version_id
    left join lateral (
      select nullif(trim(concat_ws(' ',found.first_name,found.last_name)),'') as name from (
        select l.first_name,l.last_name from public.leads l where r.contact_type='lead' and l.organization_id=r.organization_id and l.id=r.contact_id
        union all select c.first_name,c.last_name from public.clients c where r.contact_type='client' and c.organization_id=r.organization_id and c.id=r.contact_id
        union all select x.first_name,x.last_name from public.recruits x where r.contact_type='recruit' and x.organization_id=r.organization_id and x.id=r.contact_id
      ) found limit 1) person on true
    left join lateral (select n->>'type' node_type,nullif(btrim(n#>>'{meta,name}'),'') node_name
      from jsonb_array_elements(v.graph->'nodes') n where n->>'id'=r.current_node_id limit 1) block on true
    left join lateral (select s.reason from private.automation_steps s where s.organization_id=r.organization_id and s.run_id=r.id
      order by s.updated_at desc limit 1) last_step on true
    where r.organization_id=visible_org and (p_contact is null or r.contact_id=p_contact)
      and (p_workflow is null or r.workflow_id=p_workflow) and (p_type is null or r.contact_type=p_type)
      and (p_before_at is null or (r.updated_at,r.id)<(p_before_at,p_before_run))
      -- A run for an unmatched caller has no contact to scope by, so only agency-wide viewers see it.
      and case when r.contact_id is null then agency_wide
        else private.automation_visible_contact(viewer,r.organization_id,r.contact_type,r.contact_id) end
    order by r.updated_at desc,r.id desc limit 100
  ) item;
  return activity;
end $$;

CREATE OR REPLACE FUNCTION public.automation_stop_run(p_run uuid,p_session_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid:=private.automation_require_author(p_session_revision);
begin
  update private.automation_runs set status='stopped',reason='Stopped by user',ended_at=clock_timestamp(),
    updated_at=clock_timestamp(),lease_token=null,leased_until=null
    where id=p_run and organization_id=org and status in ('queued','waiting','held','unknown')
      and case when contact_id is null then private.automation_audience_allowed(org,auth.uid(),null)
        else private.automation_visible_contact(auth.uid(),organization_id,contact_type,contact_id) end;
  if not found then raise exception 'Running automation unavailable' using errcode='42501'; end if;
end $$;

REVOKE ALL ON FUNCTION public.automation_create_task(uuid,uuid,text,text,text),
  public.automation_message_timezone(uuid,text,text),public.automation_message_check(uuid,uuid,text),
  public.automation_release_refused_dispatch(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.automation_message_issue(private.automation_runs) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.automation_create_task(uuid,uuid,text,text,text),
  public.automation_message_timezone(uuid,text,text),public.automation_message_check(uuid,uuid,text),
  public.automation_release_refused_dispatch(uuid,uuid,text) TO service_role;
COMMIT;
