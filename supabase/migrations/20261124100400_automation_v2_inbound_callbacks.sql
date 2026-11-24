-- Automations V2 missed inbound calls. Observes the one parent call row when it ends unanswered and
-- adds an agency callback list that agents claim from Inbounds. Nothing here places a call.
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

-- At most one callback per inbound call. Reached only through the functions below.
CREATE TABLE public.inbound_callbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  call_id uuid NOT NULL UNIQUE REFERENCES public.calls(id) ON DELETE CASCADE,
  run_id uuid,
  caller_phone text,
  contact_id uuid,
  contact_type text CHECK (contact_type IN ('lead','client','recruit')),
  title text NOT NULL CHECK (btrim(title)<>''),
  notes text,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','done','dismissed')),
  claimed_by uuid,
  claimed_at timestamptz,
  closed_by uuid,
  closed_at timestamptz,
  -- Why a callback closed without an agent: the call turned out to have been answered.
  closed_reason text CHECK (closed_reason IN ('answered')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((contact_id IS NULL) = (contact_type IS NULL)),
  CHECK (status<>'claimed' OR claimed_by IS NOT NULL)
);
CREATE INDEX inbound_callbacks_queue ON public.inbound_callbacks(organization_id,status,due_at,created_at) WHERE status IN ('open','claimed');
ALTER TABLE public.inbound_callbacks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbound_callbacks FROM PUBLIC,anon,authenticated;

-- A call that ended with nobody on it. The answer proofs are a computer claim (agent_id) or a
-- confirmed forwarded conversation. The missed flag and a forward attempt prove nothing by themselves.
CREATE FUNCTION private.automation_capture_missed_inbound()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text;
BEGIN
  IF NOT private.automation_enrolling(NEW.organization_id) THEN RETURN NULL; END IF;
  IF NEW.contact_id IS NOT NULL THEN kind:=private.automation_contact_type(NEW.organization_id,NEW.contact_id); END IF;
  PERFORM private.automation_record_event(NEW.organization_id,'inbound_call_missed',NEW.id,
    CASE WHEN kind IS NULL THEN NULL ELSE NEW.contact_id END,kind,
    jsonb_build_object('call_id',NEW.id,'caller_phone',nullif(btrim(NEW.contact_phone),'')),'call:'||NEW.id::text,
    -- Answer evidence for a forwarded call can land just after the call ends. Let it settle first.
    interval '1 minute');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Automation missed-call capture requires investigation (SQLSTATE %)', SQLSTATE;
  RETURN NULL;
END $$;
CREATE TRIGGER automation_capture_missed_inbound AFTER UPDATE OF status ON public.calls
  FOR EACH ROW WHEN (NEW.direction='inbound' AND NEW.status IN ('completed','no-answer','failed')
    AND OLD.status IS DISTINCT FROM NEW.status AND NEW.agent_id IS NULL
    AND NEW.outcome IS DISTINCT FROM 'forwarded_answered')
  EXECUTE FUNCTION private.automation_capture_missed_inbound();

-- Whether anyone answered an inbound call, from the call row and its one route attempt. This is the one answer rule:
-- the task step, the stop check, the callback list and its counts, a claim and the late-answer cleanup all use it.
-- answered: a computer claimed the call, the agent's phone bridged it after a genuine acceptance (even while the call
--   row's own summary has not caught up), or a forward was answered with no phone evidence against it. Nothing is
--   created and an unfinished run stops.
-- missed: nobody answered. Only this creates a callback or a task.
-- ambiguous: not settled yet. The call is still live, the phone accepted it and its bridge result has not arrived,
--   or the result arrived unconfirmed. The step holds; a result that never arrives never turns into a missed call.
-- conflicting: the records disagree, such as a bridged phone without an acceptance, or a recorded answer when the
--   phone shows no conversation. The step holds until they agree.
-- unknown: the call row is gone.
CREATE FUNCTION private.automation_inbound_evidence(p_org uuid,p_call uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE
    WHEN c.id IS NULL THEN 'unknown'
    WHEN c.agent_id IS NOT NULL THEN 'answered'
    -- The phone accepted the call and bridged it, so a conversation happened, whatever the call row's status,
    -- outcome or answering agent says so far.
    WHEN a.mobile_bridge_evidence='dial_bridged' AND a.mobile_accept_result='accepted' THEN 'answered'
    WHEN c.status NOT IN ('completed','no-answer','failed') THEN 'ambiguous'
    WHEN a.mobile_bridge_evidence='dial_bridged' THEN 'conflicting'
    WHEN a.mobile_bridge_evidence='unconfirmed'
      OR (a.mobile_accept_result='accepted' AND a.mobile_bridge_evidence IS NULL) THEN 'ambiguous'
    -- From here the phone shows no conversation, or was never reached.
    WHEN (a.mobile_accept_result IS NOT NULL OR a.mobile_bridge_evidence IS NOT NULL)
      AND (c.outcome IS NOT DISTINCT FROM 'forwarded_answered' OR c.answered_by_agent_id IS NOT NULL) THEN 'conflicting'
    WHEN c.outcome IS NOT DISTINCT FROM 'forwarded_answered' THEN 'answered'
    WHEN c.answered_by_agent_id IS NOT NULL THEN 'conflicting'
    ELSE 'missed' END
  FROM (SELECT 1) one
  LEFT JOIN public.calls c ON c.organization_id=p_org AND c.id=p_call AND c.direction='inbound'
  LEFT JOIN public.inbound_route_attempts a ON a.call_id=c.id AND a.organization_id=p_org
$$;

-- An answer confirmed after the callback or task for the call was made: the shared callback is dismissed and an
-- automated task still open for the call is closed with a note. A task an agent already finished is left as it is.
-- Unfinished runs for the call stop at their next step (automation_stop_check). A task or callback being made for the
-- call at this moment holds a share lock on the call row (automation_create_task), so the answer's own write waits for
-- it to commit and the updates below then see it. Like every observer it waits at most 200 ms for a lock, so a
-- telephony update is never held up; when a row stays busy, the observer records the cleanup and the worker finishes
-- it (automation_retry_answer_settlements). Running it again changes nothing.
CREATE FUNCTION private.automation_settle_answered_call(p_org uuid,p_call uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='200ms' AS $$
BEGIN
  IF private.automation_inbound_evidence(p_org,p_call)<>'answered' THEN RETURN; END IF;
  UPDATE public.inbound_callbacks b SET status='dismissed',closed_reason='answered',closed_at=clock_timestamp(),
      updated_at=clock_timestamp()
    WHERE b.organization_id=p_org AND b.call_id=p_call AND b.status IN ('open','claimed');
  UPDATE public.tasks t SET completed_at=clock_timestamp(),
      notes=concat_ws(E'\n\n',nullif(btrim(t.notes),''),'Closed automatically: the call was answered.')
    FROM private.automation_task_receipts x
    WHERE x.organization_id=p_org AND x.scope_key='call:'||p_call::text AND x.kind='task'
      AND t.organization_id=x.organization_id AND t.id=x.record_id AND t.completed_at IS NULL;
END $$;

-- Late-answer cleanup that could not finish when the answer was recorded, because a callback or task it closes was
-- busy. The worker finishes it (automation_retry_answer_settlements, run by automation_process_events), so the call
-- update is never held up and the cleanup is never lost. One row per call; the cleanup is the same however often it runs.
CREATE TABLE private.automation_answer_settlements (
  -- No foreign keys: recording a cleanup takes no lock on another table during the call update.
  organization_id uuid NOT NULL,
  call_id uuid NOT NULL,
  first_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 1,
  retry_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_sqlstate text,
  PRIMARY KEY (organization_id,call_id)
);
CREATE INDEX automation_answer_settlements_due ON private.automation_answer_settlements(retry_at);
ALTER TABLE private.automation_answer_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.automation_answer_settlements FROM PUBLIC,anon,authenticated;

-- Records a cleanup for the worker to finish. It also waits at most 200 ms, so it cannot hold up the call update either.
CREATE FUNCTION private.automation_note_answer_settlement(p_org uuid,p_call uuid,p_sqlstate text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' SET lock_timeout='200ms' AS $$
  INSERT INTO private.automation_answer_settlements(organization_id,call_id,last_sqlstate) VALUES(p_org,p_call,p_sqlstate)
  ON CONFLICT (organization_id,call_id) DO UPDATE SET last_sqlstate=excluded.last_sqlstate,
    retry_at=least(private.automation_answer_settlements.retry_at,clock_timestamp())
$$;

-- The worker finishes each recorded cleanup that is due. One still blocked is tried again later, less often the longer
-- it waits (one minute, doubling, at most an hour), and no more after seven days; its row stays as the record.
CREATE FUNCTION private.automation_retry_answer_settlements(p_limit integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pending private.automation_answer_settlements; settled integer:=0; cutoff timestamptz:=clock_timestamp();
BEGIN
  FOR pending IN SELECT * FROM private.automation_answer_settlements WHERE retry_at<=cutoff
      ORDER BY retry_at,organization_id,call_id LIMIT least(25,greatest(1,coalesce(p_limit,10))) FOR UPDATE SKIP LOCKED LOOP
    BEGIN
      PERFORM private.automation_settle_answered_call(pending.organization_id,pending.call_id);
      DELETE FROM private.automation_answer_settlements
        WHERE organization_id=pending.organization_id AND call_id=pending.call_id;
      settled:=settled+1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE private.automation_answer_settlements SET attempts=attempts+1,last_sqlstate=SQLSTATE,
          retry_at=CASE WHEN clock_timestamp()-first_attempt_at>interval '7 days' THEN 'infinity'::timestamptz
            ELSE clock_timestamp()+least(interval '1 hour',interval '1 minute'*power(2,least(attempts,6))) END
        WHERE organization_id=pending.organization_id AND call_id=pending.call_id;
    END;
  END LOOP;
  RETURN settled;
END $$;

-- Observes the answer proofs on the call row and the phone's bridge result. Like the other observers it never
-- blocks the call update that fired it. When a row the cleanup closes is busy, it records the cleanup for the worker.
CREATE FUNCTION private.automation_observe_answered_call()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE call uuid;
BEGIN
  -- A call row has no call_id field and a route attempt's own id is not the call.
  IF TG_TABLE_NAME='calls' THEN call:=NEW.id; ELSE call:=NEW.call_id; END IF;
  BEGIN
    PERFORM private.automation_settle_answered_call(NEW.organization_id,call);
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.automation_note_answer_settlement(NEW.organization_id,call,SQLSTATE);
  END;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Automation answered-call settlement requires investigation (SQLSTATE %)', SQLSTATE;
  RETURN NULL;
END $$;
CREATE TRIGGER automation_observe_answered_call AFTER UPDATE OF agent_id,outcome,answered_by_agent_id ON public.calls
  FOR EACH ROW WHEN (NEW.direction='inbound'
    AND (NEW.agent_id IS NOT NULL OR NEW.outcome IS NOT DISTINCT FROM 'forwarded_answered')
    AND (OLD.agent_id IS DISTINCT FROM NEW.agent_id OR OLD.outcome IS DISTINCT FROM NEW.outcome
      OR OLD.answered_by_agent_id IS DISTINCT FROM NEW.answered_by_agent_id))
  EXECUTE FUNCTION private.automation_observe_answered_call();
CREATE TRIGGER automation_observe_answered_call AFTER UPDATE OF mobile_bridge_evidence ON public.inbound_route_attempts
  FOR EACH ROW WHEN (NEW.mobile_bridge_evidence='dial_bridged' AND OLD.mobile_bridge_evidence IS DISTINCT FROM NEW.mobile_bridge_evidence)
  EXECUTE FUNCTION private.automation_observe_answered_call();

-- The one agent responsible for the caller, in routing order: the owner of the direct line dialed,
-- the contact's assigned agent, then the agent whose recent call the caller is returning.
CREATE FUNCTION private.automation_inbound_responsible(p_org uuid,p_call uuid,p_contact_type text,p_contact uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p.id FROM public.calls c
  CROSS JOIN LATERAL (
    SELECT pn.assigned_to AS agent,1 AS ord FROM public.phone_numbers pn
      WHERE pn.organization_id=p_org AND pn.is_direct_line AND pn.assigned_to IS NOT NULL AND pn.phone_number=c.caller_id_used
    UNION ALL SELECT private.automation_contact_owner(p_org,p_contact_type,p_contact),2 WHERE p_contact IS NOT NULL
    UNION ALL SELECT a.owner_agent_id,3 FROM public.inbound_route_attempts a
      WHERE a.call_id=c.id AND a.organization_id=p_org AND a.owner_source='recent_outbound' AND p_contact IS NULL
  ) pick
  JOIN public.profiles p ON p.id=pick.agent AND p.organization_id=p_org AND p.status='Active'
  WHERE c.organization_id=p_org AND c.id=p_call
  ORDER BY pick.ord LIMIT 1
$$;

-- This signed-in session is recorded as viewing the CRM as another person.
CREATE FUNCTION private.automation_viewing_as()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM private.automation_sessions s
    WHERE s.session_id=nullif(auth.jwt()->>'session_id','')::uuid AND s.actor_id=auth.uid() AND s.target_id IS NOT NULL)
$$;

-- Only a super admin can view as someone else, and the server knows a session's mode only once the
-- session has a record. A super admin session without one (a sign-in from before the Automations
-- upgrade keeps View As in the browser) cannot be verified, so it is not allowed to act.
CREATE FUNCTION private.automation_mode_unverified()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_super_admin IS TRUE)
    AND NOT EXISTS (SELECT 1 FROM private.automation_sessions s
      WHERE s.session_id=nullif(auth.jwt()->>'session_id','')::uuid AND s.actor_id=auth.uid())
$$;

-- Who may see a contact's name: the owner, an administrator, or a team leader above the owner.
CREATE FUNCTION private.automation_visible_contact(p_viewer uuid,p_org uuid,p_type text,p_contact uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles actor JOIN LATERAL (
      SELECT l.user_id AS owner_id FROM public.leads l WHERE p_type='lead' AND l.organization_id=p_org AND l.id=p_contact
      UNION ALL SELECT c.assigned_agent_id FROM public.clients c WHERE p_type='client' AND c.organization_id=p_org AND c.id=p_contact
      UNION ALL SELECT r.assigned_agent_id FROM public.recruits r WHERE p_type='recruit' AND r.organization_id=p_org AND r.id=p_contact
    ) contact ON true
    WHERE actor.id=p_viewer AND actor.status='Active' AND actor.organization_id=p_org
      AND (actor.role='Admin' OR actor.is_super_admin IS TRUE OR contact.owner_id=actor.id
        OR (actor.role IN ('Team Leader','Team Lead') AND contact.owner_id IN (
          SELECT agent_id FROM private.resolve_downline_ids(actor.id,p_org)))))
$$;

-- Callbacks are part of the Automations pilot: only an agency with the builder visible has the list.
CREATE FUNCTION private.automation_callbacks_available(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT private.automation_builder_visible(p_org)
$$;

-- The callbacks waiting in this agency. Open ones come first, the one due soonest at the top, then claimed ones,
-- newest first. The counts cover every waiting callback, however many the list shows. A call proven answered after the
-- fact drops out by the same answer rule a claim uses (automation_inbound_evidence), even before its cleanup has run.
CREATE FUNCTION public.inbound_callback_queue()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record; viewing boolean:=private.automation_viewing_as() OR private.automation_mode_unverified(); listed jsonb;
  counts record;
BEGIN
  SELECT * INTO actor FROM private.inbounds_actor();
  IF NOT private.automation_callbacks_available(actor.org) THEN
    RETURN jsonb_build_object('admin',actor.admin,'available',false,'open_count',0,'claimed_count',0,'items','[]'::jsonb);
  END IF;
  SELECT count(*) FILTER (WHERE b.status='open') AS open,count(*) FILTER (WHERE b.status='claimed') AS claimed INTO counts
    FROM public.inbound_callbacks b JOIN public.calls c ON c.id=b.call_id AND c.organization_id=b.organization_id
    WHERE b.organization_id=actor.org AND b.status IN ('open','claimed')
      AND private.automation_inbound_evidence(b.organization_id,b.call_id) IS DISTINCT FROM 'answered';
  SELECT coalesce(jsonb_agg(to_jsonb(item) - 'queue_order' ORDER BY item.queue_order),'[]'::jsonb) INTO listed FROM (
    SELECT b.id,b.call_id,b.caller_phone,
      CASE WHEN known.visible THEN b.contact_id END AS contact_id,
      CASE WHEN known.visible THEN b.contact_type END AS contact_type,
      CASE WHEN known.visible THEN known.name END AS contact_name,
      b.status,b.claimed_by,nullif(btrim(concat_ws(' ',claimer.first_name,claimer.last_name)),'') AS claimed_by_name,
      b.claimed_by IS NOT DISTINCT FROM actor.uid AS claimed_by_me,
      b.status='open' AND NOT viewing AS can_claim,
      coalesce(c.started_at,c.created_at,b.created_at) AS missed_at,b.due_at,
      -- Text the automation rendered for a known contact can carry that contact's details, so only people
      -- who can see the contact read it. Everyone else is shown the caller's number.
      CASE WHEN b.contact_id IS NULL OR known.visible THEN b.title
        ELSE 'Call back '||coalesce(nullif(b.caller_phone,''),'the caller') END AS title,
      CASE WHEN b.contact_id IS NULL OR known.visible THEN b.notes END AS notes,
      CASE WHEN c.voicemail_id IS NOT NULL AND public.can_access_voicemail(c.voicemail_id) THEN c.voicemail_id END AS voicemail_id,
      row_number() OVER (ORDER BY picked.grp,picked.rank) AS queue_order
    -- Up to 100 from each group, in this order: the viewer's own claimed callbacks, open callbacks with the one due
    -- soonest first, then other agents' claims, newest first. No group can push another off the list.
    FROM (SELECT w.id,w.grp,row_number() OVER (PARTITION BY w.grp ORDER BY
          CASE WHEN w.grp<2 THEN coalesce(w.due_at,w.created_at) END ASC,CASE WHEN w.grp=2 THEN w.created_at END DESC,w.id) AS rank
        FROM (SELECT b.id,b.due_at,b.created_at,
            CASE WHEN b.status='claimed' AND b.claimed_by IS NOT DISTINCT FROM actor.uid THEN 0 WHEN b.status='open' THEN 1 ELSE 2 END AS grp
          FROM public.inbound_callbacks b JOIN public.calls c ON c.id=b.call_id AND c.organization_id=b.organization_id
          WHERE b.organization_id=actor.org AND b.status IN ('open','claimed')
            AND private.automation_inbound_evidence(b.organization_id,b.call_id) IS DISTINCT FROM 'answered') w) picked
    JOIN public.inbound_callbacks b ON b.id=picked.id
    JOIN public.calls c ON c.id=b.call_id AND c.organization_id=b.organization_id
    LEFT JOIN public.profiles claimer ON claimer.id=b.claimed_by AND claimer.organization_id=b.organization_id
    LEFT JOIN LATERAL (
      SELECT private.automation_visible_contact(actor.uid,b.organization_id,b.contact_type,b.contact_id) AS visible,
        (SELECT nullif(btrim(concat_ws(' ',person.first_name,person.last_name)),'') FROM (
          SELECT l.first_name,l.last_name FROM public.leads l WHERE b.contact_type='lead' AND l.organization_id=b.organization_id AND l.id=b.contact_id
          UNION ALL SELECT k.first_name,k.last_name FROM public.clients k WHERE b.contact_type='client' AND k.organization_id=b.organization_id AND k.id=b.contact_id
          UNION ALL SELECT r.first_name,r.last_name FROM public.recruits r WHERE b.contact_type='recruit' AND r.organization_id=b.organization_id AND r.id=b.contact_id
        ) person LIMIT 1) AS name
      WHERE b.contact_id IS NOT NULL) known ON true
    WHERE picked.rank<=100
  ) item;
  RETURN jsonb_build_object('admin',actor.admin,'available',true,'open_count',counts.open,'claimed_count',counts.claimed,
    'items',listed);
END $$;

-- Exactly one agent wins a claim. Everyone else is told someone else has it.
CREATE FUNCTION public.claim_inbound_callback(p_callback uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record; item public.inbound_callbacks;
BEGIN
  SELECT * INTO actor FROM private.inbounds_actor();
  IF NOT private.automation_callbacks_available(actor.org) THEN
    RAISE EXCEPTION 'Callbacks are not available for this agency.' USING ERRCODE='42501'; END IF;
  IF private.automation_viewing_as() THEN
    RAISE EXCEPTION 'Callbacks cannot be claimed while viewing as another person' USING ERRCODE='42501'; END IF;
  IF private.automation_mode_unverified() THEN
    RAISE EXCEPTION 'Sign in again to claim callbacks.' USING ERRCODE='42501',HINT='automation_session_reauth'; END IF;
  -- Proof that the call was answered can arrive after its callback was made, before the call row's own summary
  -- catches up and before the cleanup has dismissed it. The list hides it by the same rule, and nobody can take it on.
  IF EXISTS (SELECT 1 FROM public.inbound_callbacks b WHERE b.id=p_callback AND b.organization_id=actor.org
      AND private.automation_inbound_evidence(b.organization_id,b.call_id)='answered') THEN
    RAISE EXCEPTION 'This call was answered, so no callback is needed.' USING ERRCODE='PT409'; END IF;
  UPDATE public.inbound_callbacks b SET status='claimed',claimed_by=actor.uid,claimed_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE b.id=p_callback AND b.organization_id=actor.org AND b.status='open' RETURNING b.* INTO item;
  IF NOT FOUND THEN
    SELECT * INTO item FROM public.inbound_callbacks b WHERE b.id=p_callback AND b.organization_id=actor.org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Callback not found' USING ERRCODE='PT404'; END IF;
    IF item.status='dismissed' AND item.closed_reason='answered' THEN
      RAISE EXCEPTION 'This call was answered, so no callback is needed.' USING ERRCODE='PT409'; END IF;
    IF item.status<>'claimed' THEN RAISE EXCEPTION 'This callback is no longer waiting.' USING ERRCODE='PT409'; END IF;
    IF item.claimed_by IS DISTINCT FROM actor.uid THEN
      RAISE EXCEPTION 'Someone else already claimed this callback.' USING ERRCODE='PT409'; END IF;
  END IF;
  RETURN jsonb_build_object('id',item.id,'status',item.status,'claimed_by',item.claimed_by);
END $$;

CREATE FUNCTION public.release_inbound_callback(p_callback uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record; item public.inbound_callbacks;
BEGIN
  SELECT * INTO actor FROM private.inbounds_actor();
  IF NOT private.automation_callbacks_available(actor.org) THEN
    RAISE EXCEPTION 'Callbacks are not available for this agency.' USING ERRCODE='42501'; END IF;
  IF private.automation_viewing_as() THEN
    RAISE EXCEPTION 'Callbacks cannot be released while viewing as another person' USING ERRCODE='42501'; END IF;
  IF private.automation_mode_unverified() THEN
    RAISE EXCEPTION 'Sign in again to release callbacks.' USING ERRCODE='42501',HINT='automation_session_reauth'; END IF;
  UPDATE public.inbound_callbacks b SET status='open',claimed_by=NULL,claimed_at=NULL,updated_at=clock_timestamp()
    WHERE b.id=p_callback AND b.organization_id=actor.org AND b.status='claimed'
      AND (b.claimed_by=actor.uid OR actor.admin) RETURNING b.* INTO item;
  IF NOT FOUND THEN
    SELECT * INTO item FROM public.inbound_callbacks b WHERE b.id=p_callback AND b.organization_id=actor.org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Callback not found' USING ERRCODE='PT404'; END IF;
    IF item.status='claimed' THEN RAISE EXCEPTION 'Only the agent who claimed this callback can release it' USING ERRCODE='42501'; END IF;
    IF item.status='dismissed' AND item.closed_reason='answered' THEN
      RAISE EXCEPTION 'This call was answered, so no callback is needed.' USING ERRCODE='PT409'; END IF;
    IF item.status<>'open' THEN RAISE EXCEPTION 'This callback is no longer waiting.' USING ERRCODE='PT409'; END IF;
  END IF;
  RETURN jsonb_build_object('id',item.id,'status',item.status);
END $$;

CREATE FUNCTION public.complete_inbound_callback(p_callback uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record; item public.inbound_callbacks;
BEGIN
  SELECT * INTO actor FROM private.inbounds_actor();
  IF NOT private.automation_callbacks_available(actor.org) THEN
    RAISE EXCEPTION 'Callbacks are not available for this agency.' USING ERRCODE='42501'; END IF;
  IF private.automation_viewing_as() THEN
    RAISE EXCEPTION 'Callbacks cannot be completed while viewing as another person' USING ERRCODE='42501'; END IF;
  IF private.automation_mode_unverified() THEN
    RAISE EXCEPTION 'Sign in again to complete callbacks.' USING ERRCODE='42501',HINT='automation_session_reauth'; END IF;
  UPDATE public.inbound_callbacks b SET status='done',closed_by=actor.uid,closed_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE b.id=p_callback AND b.organization_id=actor.org AND b.status='claimed'
      AND (b.claimed_by=actor.uid OR actor.admin) RETURNING b.* INTO item;
  IF NOT FOUND THEN
    SELECT * INTO item FROM public.inbound_callbacks b WHERE b.id=p_callback AND b.organization_id=actor.org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Callback not found' USING ERRCODE='PT404'; END IF;
    IF item.status='claimed' THEN RAISE EXCEPTION 'Only the agent who claimed this callback can complete it' USING ERRCODE='42501'; END IF;
    IF item.status='dismissed' AND item.closed_reason='answered' THEN
      RAISE EXCEPTION 'This call was answered, so no callback is needed.' USING ERRCODE='PT409'; END IF;
    IF item.status<>'done' THEN RAISE EXCEPTION 'Claim this callback before completing it.' USING ERRCODE='PT409'; END IF;
  END IF;
  RETURN jsonb_build_object('id',item.id,'status',item.status);
END $$;

REVOKE ALL ON FUNCTION private.automation_capture_missed_inbound(),private.automation_inbound_evidence(uuid,uuid),
  private.automation_settle_answered_call(uuid,uuid),private.automation_observe_answered_call(),
  private.automation_note_answer_settlement(uuid,uuid,text),private.automation_retry_answer_settlements(integer),
  private.automation_callbacks_available(uuid),
  private.automation_inbound_responsible(uuid,uuid,text,uuid),private.automation_visible_contact(uuid,uuid,text,uuid),
  private.automation_viewing_as(),private.automation_mode_unverified(),public.inbound_callback_queue(),public.claim_inbound_callback(uuid),
  public.release_inbound_callback(uuid),public.complete_inbound_callback(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.automation_viewing_as(),private.automation_mode_unverified() TO authenticated;
GRANT EXECUTE ON FUNCTION public.inbound_callback_queue(),public.claim_inbound_callback(uuid),
  public.release_inbound_callback(uuid),public.complete_inbound_callback(uuid) TO authenticated;
COMMIT;
