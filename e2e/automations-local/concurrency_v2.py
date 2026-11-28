"""Automations V2 contention checks on the dedicated, disposable test database.

Independent PostgreSQL connections race for one callback claim, one task step, and one callback per
missed call. A final check holds the lock a publish takes and proves a CRM save still commits at once.
Real row locks held by another session show that late-answer cleanup never holds up the call and finishes later,
that a reopened appointment seen by two workers at once gets one run, that an appointment save in flight refuses a
reminder's provider handoff while a handoff in progress keeps the save waiting only until it commits, that an
unrelated save in flight is waited out briefly and never costs the reminder, that saves queued one behind another
are waited out for half a second in all, and that a reopening committed while a worker waits to admit the booking
paces the run from the reopening. The record of what a booking run gave for an appointment time decides two handoffs of
one text for one time, two retries of it, a retry meeting a receipt in progress and two task steps for one time, and a
stop committed before the handoff keeps the text from being handed off, also one committed while the handoff waits for
its locks.
"""
import json
import os
import subprocess
import time
import uuid
from contextlib import contextmanager

container = os.environ["AUTOMATIONS_DB_CONTAINER"]
def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()

if docker("inspect", "-f", '{{index .Config.Labels "agentflow-test"}}', container) != "automations":
    raise ValueError("Expected the disposable Automations container")
network = docker("inspect", "-f", '{{range $n, $_ := .NetworkSettings.Networks}}{{$n}}{{end}}', container)
if docker("network", "inspect", "-f", "{{.Internal}}", network) != "true":
    raise ValueError("Expected an isolated internal network")
if not os.environ.get("PGPASSWORD"):
    raise ValueError("Supply the disposable database password")

psql = ["docker", "exec", "-i", "-e", "PGPASSWORD", container, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1",
        "-U", "postgres", "-d", "postgres"]
org, admin, first, second = [str(uuid.uuid4()) for _ in range(4)]
ids = {name: str(uuid.uuid4()) for name in ["lead_flow", "lead_version", "call_flow_a", "call_version_a", "call_flow_b",
                                             "call_version_b", "lead", "call", "callback", "callback_call", "appointment",
                                             "late_lead", "late_task_call", "late_callback_call",
                                             "appt_flow", "appt_version", "appt_lead", "reopened",
                                             "busy_lead", "busy_call", "bridge_call", "bridge_attempt",
                                             "first_seen_flow", "first_seen_version", "first_seen_lead", "first_seen",
                                             "text_flow", "text_version", "text_moved", "text_kept", "text_busy",
                                             "text_long", "text_queued", "race_flow", "race_version", "race_lead",
                                             "race_appt", "record_text_flow", "record_text_version", "record_task_flow",
                                             "record_task_version", "record_stop_flow", "record_stop_version",
                                             "record1_lead", "record1_appt", "record2_lead", "record2_appt", "record3_lead",
                                             "record3_appt", "record4_lead", "record4_appt", "record5_lead", "record5_appt",
                                             "record6_lead", "record6_appt", "record7_lead", "record7_appt", "record8_lead",
                                             "record8_appt"]}

def query(sql, timeout=25):
    return subprocess.check_output(psql, input=sql, text=True, timeout=timeout).strip()

def identity(user):
    claims = json.dumps({"sub": user, "role": "authenticated", "app_metadata": {"organization_id": org, "role": "Agent"}})
    return f"set local role authenticated; set local request.jwt.claim.sub='{user}'; set local request.jwt.claims='{claims}';"

@contextmanager
def hold(sql):
    """Keep a transaction open after the server confirms its statements finished."""
    process = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        process.stdin.write("begin; set local idle_in_transaction_session_timeout='20s';\n" + sql + "\n\\echo LOCK_HELD\n")
        process.stdin.flush()
        for line in process.stdout:
            if line.rstrip() == "LOCK_HELD":
                break
        else:
            raise RuntimeError("Holding transaction failed before acquiring its lock")
        yield
        process.stdin.write("commit;\n")
        process.stdin.close()
        if process.wait(timeout=15):
            raise RuntimeError("Holding transaction failed to commit")
    finally:
        if process.poll() is None:
            process.kill()

def contender(name, sql):
    """A second connection that is expected to wait behind the held transaction."""
    waiter = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    waiter.stdin.write(f"begin; set local application_name='{name}'; set local statement_timeout='12s';\n{sql}\ncommit;\n")
    waiter.stdin.close()
    for _ in range(100):
        if query(f"select count(*) from pg_stat_activity where application_name='{name}' and wait_event_type='Lock'") == "1":
            return waiter
        time.sleep(0.05)
    raise AssertionError("The second connection never waited: " + waiter.stderr.read())

def session(name):
    """An open psql session, ready for statements, and its server process id."""
    process = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"set application_name='{name}';\nselect pg_backend_pid();\n")
    process.stdin.flush()
    return process, process.stdout.readline().strip()

def send(process, sql, marker):
    """Run statements in an open session and return their output once they finish."""
    process.stdin.write(sql + f"\n\\echo {marker}\n")
    process.stdin.flush()
    lines = []
    for line in process.stdout:
        if line.rstrip() == marker:
            return lines
        lines.append(line.rstrip())
    raise RuntimeError(f"The session ended before {marker}: " + process.stderr.read())

def late_answer(call, made):
    """Make a missed call's task or callback in one transaction while another commits an answer for the call.

    The step holds a share lock on the call row, so the answer's own update waits for the step to commit and its
    settlement then closes what the step made. The step's session commits as soon as it sees the answer waiting."""
    query(f"""update private.automation_events set available_at=clock_timestamp()-interval '1 second'
        where organization_id='{org}' and event_type='inbound_call_missed' and source_id='{call}';
      select public.automation_process_events(25);""")
    runs = [run for run in claims() if run["trigger"] == "inbound_call_missed"]
    assert len(runs) == 2, runs
    answer, answer_pid = session("v2-late-answer")
    maker, _ = session("v2-late-maker")
    try:
        output = send(maker, "begin;\n" + f"select public.automation_create_task('{runs[0]['run_id']}','{runs[0]['lease_token']}','task','Call back',null);", "MADE")
        assert any('"created"' in line for line in output), output
        answer.stdin.write(f"update public.calls set outcome='forwarded_answered' where id='{call}';\n\\echo ANSWERED\n")
        answer.stdin.flush()
        for _ in range(2000):
            waiting = send(maker, f"select count(*) from pg_locks where pid={answer_pid} and not granted;", "LOOKED")
            if waiting != ["0"]:
                break
        else:
            raise AssertionError("The answer never waited for the step making its " + made)
        send(maker, "commit;", "COMMITTED")
        maker.stdin.close()
        assert maker.wait(timeout=15) == 0
        for line in answer.stdout:
            if line.rstrip() == "ANSWERED":
                break
        answer.stdin.close()
        assert answer.wait(timeout=15) == 0
        warnings = answer.stderr.read()
        assert "requires investigation" not in warnings, warnings
    finally:
        # A failed check never leaves a session holding locks for the clean-up that follows.
        for process in (maker, answer):
            if process.poll() is None:
                process.kill()
    # The other automation's step finds the call answered and stops.
    other = query(f"select public.automation_create_task('{runs[1]['run_id']}','{runs[1]['lease_token']}','task','Call back',null);")
    assert '"stopped"' in other and "Call was answered" in other, other

def run(sql, timeout=15):
    """Run statements in a fresh session and report how long they took, with the server's warnings."""
    started = time.monotonic()
    done = subprocess.run(psql, input=sql, capture_output=True, text=True, timeout=timeout)
    return done, time.monotonic() - started

def as_agent(user, sql):
    return f"begin; {identity(user)} {sql} commit;"

def pending(call):
    return query(f"select coalesce((select attempts||':'||last_sqlstate||':'||(retry_at>clock_timestamp())::text "
                 f"from private.automation_answer_settlements where call_id='{call}'),'none')")

def graph(trigger):
    return json.dumps({"format": 1, "settings": {"reentry": "once", "stop_on_reply": False}, "nodes": [
        {"id": "start", "type": trigger, "version": 1, "config": {}},
        {"id": "task", "type": "create_task", "version": 1,
         "config": {"title": "Synthetic follow-up", "task_type": "Follow Up", "due_amount": 5, "due_unit": "minutes"}}],
        "edges": [{"id": "a", "source": "start", "target": "task"}]})

def publish(flow, version, trigger):
    return f"""insert into public.workflows(id,organization_id,name,status,trigger_type,automation_graph,automation_revision)
      values ('{ids[flow]}','{org}','Concurrency {flow}','active','manual','{graph(trigger)}',1);
    insert into public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
      values ('{ids[version]}','{org}','{ids[flow]}','Concurrency {flow}',1,'{graph(trigger)}',clock_timestamp(),'{admin}');
    update public.workflows set automation_version_id='{ids[version]}' where id='{ids[flow]}';
    insert into public.automation_intervals(organization_id,workflow_id,version_id,starts_at)
      values ('{org}','{ids[flow]}','{ids[version]}',clock_timestamp());"""

def claims():
    rows = query("select c from public.automation_claim_work(10) c;")
    found = [json.loads(line) for line in rows.splitlines() if line]
    assert all(item["organization_id"] == org for item in found), "Another test's run was due"
    return found

def cleanup():
    query(f"""update private.automation_runs set status='stopped',reason='Test finished',ended_at=clock_timestamp(),
        lease_token=null,leased_until=null where organization_id='{org}' and status in ('queued','waiting','held');
      update public.workflows set status='archived' where organization_id='{org}';
      update private.automation_release_controls set enrollment_enabled=false where organization_id='{org}';""")

query(f"""begin;
  insert into public.organizations(id,name,twilio_subaccount_status) values ('{org}','Concurrency V2','active');
  insert into public.company_settings(company_name,organization_id,timezone) values ('Concurrency V2','{org}','America/New_York');
  insert into private.automation_release_controls(organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
    values ('{org}',true,true,false);
  insert into auth.users(id,email) values ('{admin}','{admin}@example.invalid'),('{first}','{first}@example.invalid'),
    ('{second}','{second}@example.invalid');
  insert into public.profiles(id,organization_id,role,status,email,first_name,last_name) values
    ('{admin}','{org}','Admin','Active','{admin}@example.invalid','Admin','Fixture'),
    ('{first}','{org}','Agent','Active','{first}@example.invalid','First','Agent'),
    ('{second}','{org}','Agent','Active','{second}@example.invalid','Second','Agent')
    on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status,
      first_name=excluded.first_name,last_name=excluded.last_name;
  {publish('lead_flow', 'lead_version', 'lead_created')}
  {publish('call_flow_a', 'call_version_a', 'inbound_call_missed')}
  {publish('call_flow_b', 'call_version_b', 'inbound_call_missed')}
  commit;""")
try:
    # 1. Two agents claim the same callback at the same moment. Exactly one holds it.
    query(f"""insert into public.calls(id,organization_id,direction,status,contact_phone,caller_id_used,twilio_call_sid)
        values ('{ids['callback_call']}','{org}','inbound','no-answer','+12025550171','+15550001000','CA{uuid.uuid4().hex}');
      insert into public.inbound_callbacks(id,organization_id,call_id,caller_phone,title)
        values ('{ids['callback']}','{org}','{ids['callback_call']}','+12025550171','Synthetic callback');""")
    with hold(identity(first) + f"select public.claim_inbound_callback('{ids['callback']}');"):
        loser = contender("v2-claim", identity(second) + f"select public.claim_inbound_callback('{ids['callback']}');")
    assert loser.wait(timeout=15) != 0 and "Someone else already claimed this callback." in loser.stderr.read()
    assert query(f"select status||':'||claimed_by from public.inbound_callbacks where id='{ids['callback']}'") == "claimed:" + first

    # 2. The same task step delivered to two workers creates one task.
    query(f"""insert into public.leads(id,organization_id,first_name,assigned_agent_id) values ('{ids['lead']}','{org}','Race','{first}');
      select public.automation_process_events(25);""")
    [lease] = claims()
    step = f"select public.automation_create_task('{lease['run_id']}','{lease['lease_token']}','task','Synthetic follow-up',null);"
    with hold(step):
        twin = contender("v2-task", step)
    assert twin.wait(timeout=15) == 0 and '"created"' in twin.stdout.read()
    assert query(f"select count(*) from public.tasks where contact_id='{ids['lead']}'") == "1"
    assert query(f"select public.automation_finish_node('{lease['run_id']}','{lease['lease_token']}','created')") == "t"

    # 3. Two automations reach the same missed call together. One callback exists afterwards.
    query(f"""insert into public.calls(id,organization_id,direction,status,contact_phone,caller_id_used,twilio_call_sid)
        values ('{ids['call']}','{org}','inbound','ringing','+12025550172','+15550001000','CA{uuid.uuid4().hex}');
      update public.calls set status='no-answer' where id='{ids['call']}';
      update private.automation_events set available_at=clock_timestamp()-interval '1 second'
        where organization_id='{org}' and event_type='inbound_call_missed';
      select public.automation_process_events(25);""")
    pair = claims()
    assert len(pair) == 2, pair
    steps = [f"select public.automation_create_task('{item['run_id']}','{item['lease_token']}','task','Call back',null);" for item in pair]
    with hold(steps[0]):
        other = contender("v2-call", steps[1])
    assert other.wait(timeout=15) == 0 and '"skipped"' in other.stdout.read()
    assert query(f"select count(*) from public.inbound_callbacks where call_id='{ids['call']}'") == "1"
    assert query(f"select count(*) from public.tasks where organization_id='{org}'") == "1"

    # 4. A publish in progress never holds up a CRM save. The event is kept and enrolled afterwards.
    with hold(f"select pg_advisory_xact_lock(hashtextextended('automation-activation:{org}',0));"):
        started = time.monotonic()
        query(f"""insert into public.appointments(id,organization_id,title,contact_id,user_id,start_time,sync_source)
          values ('{ids['appointment']}','{org}','Saved during a publish','{ids['lead']}','{first}',now()+interval '3 days','internal');""", timeout=10)
        waited = time.monotonic() - started
        assert waited < 3, f"The appointment save waited {waited:.1f}s behind an automation lock"
        assert query(f"select count(*) from public.appointments where id='{ids['appointment']}'") == "1"
        assert query(f"select count(*) from private.automation_events where organization_id='{org}' and event_type='appointment_booked'") == "0"
        assert query(f"select count(*) from private.automation_intake_recovery where organization_id='{org}' and event_type='appointment_booked'") == "1"
    query("select public.automation_process_events(25);")
    assert query(f"""select count(*) from private.automation_events where organization_id='{org}' and event_type='appointment_booked'
      and subject->>'appointment_id'='{ids['appointment']}' and contact_type='lead' and scope_key like 'slot:%'""") == "1"
    assert query(f"select count(*) from private.automation_intake_recovery where organization_id='{org}'") == "0"

    # 5. An answer confirmed while the missed call's work is being made closes it: a known caller's task, then an unknown
    #    caller's shared callback.
    query(f"""insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id)
        values ('{ids['late_lead']}','{org}','Late','+12025550173','{first}');
      insert into public.calls(id,organization_id,direction,status,contact_id,contact_type,contact_phone,caller_id_used,twilio_call_sid)
        values ('{ids['late_task_call']}','{org}','inbound','ringing','{ids['late_lead']}','lead','+12025550173','+15550001000',
          'CA{uuid.uuid4().hex}');
      update public.calls set status='no-answer' where id='{ids['late_task_call']}';""")
    late_answer(ids['late_task_call'], "task")
    assert query(f"""select count(*) from public.tasks t join private.automation_task_receipts x on x.record_id=t.id
        where x.scope_key='call:{ids['late_task_call']}' and t.completed_at is not null
          and t.notes like '%Closed automatically: the call was answered.'""") == "1"
    query(f"""insert into public.calls(id,organization_id,direction,status,contact_phone,caller_id_used,twilio_call_sid)
        values ('{ids['late_callback_call']}','{org}','inbound','ringing','+12025550174','+15550001000','CA{uuid.uuid4().hex}');
      update public.calls set status='no-answer' where id='{ids['late_callback_call']}';""")
    late_answer(ids['late_callback_call'], "callback")
    assert query(f"""select status||':'||closed_reason from public.inbound_callbacks
        where call_id='{ids['late_callback_call']}'""") == "dismissed:answered"

    # Nothing was left for the worker: the direct path closed both items while the answers committed.
    assert query(f"select count(*) from private.automation_answer_settlements where organization_id='{org}'") == "0"

    # 7. An answer recorded while another session holds the task it closes. The call update is not held up, the
    #    cleanup is recorded, retried while the row is still busy, and finished by the worker once the row is free.
    query(f"""insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id)
        values ('{ids['busy_lead']}','{org}','Busy','+12025550175','{first}');
      insert into public.calls(id,organization_id,direction,status,contact_id,contact_type,contact_phone,caller_id_used,twilio_call_sid)
        values ('{ids['busy_call']}','{org}','inbound','ringing','{ids['busy_lead']}','lead','+12025550175','+15550001000',
          'CA{uuid.uuid4().hex}');
      update public.calls set status='no-answer' where id='{ids['busy_call']}';
      update private.automation_events set available_at=clock_timestamp()-interval '1 second'
        where organization_id='{org}' and event_type='inbound_call_missed' and source_id='{ids['busy_call']}';
      select public.automation_process_events(25);""")
    for item in claims():
        query(f"select public.automation_create_task('{item['run_id']}','{item['lease_token']}','task','Call back',null);")
    task = query(f"""select t.id from public.tasks t join private.automation_task_receipts x on x.record_id=t.id
        where x.scope_key='call:{ids['busy_call']}'""")
    assert task, "The missed call made no task"
    with hold(f"select 1 from public.tasks where id='{task}' for update;"):
        answered, took = run(f"update public.calls set agent_id='{first}' where id='{ids['busy_call']}';")
        assert answered.returncode == 0, answered.stderr
        assert took < 3, f"The answer waited {took:.1f}s behind a busy task"
        assert "requires investigation" not in answered.stderr, answered.stderr
        assert query(f"select agent_id from public.calls where id='{ids['busy_call']}'") == first
        assert query(f"select completed_at is null from public.tasks where id='{task}'") == "t"
        assert pending(ids['busy_call']) == "1:55P03:false", pending(ids['busy_call'])
        retried, _ = run("select public.automation_process_events(25);")
        assert retried.returncode == 0, retried.stderr
        assert pending(ids['busy_call']) == "2:55P03:true", pending(ids['busy_call'])
    query(f"""update private.automation_answer_settlements set retry_at=clock_timestamp()-interval '1 second'
        where call_id='{ids['busy_call']}'; select public.automation_process_events(25);""")
    assert query(f"""select completed_at is not null and notes like '%Closed automatically: the call was answered.'
        from public.tasks where id='{task}'""") == "t"
    assert pending(ids['busy_call']) == "none"

    # 8. A phone bridge confirmed while another session holds the callback it dismisses, with the call row's summary
    #    not caught up. The list and a claim already treat the call as answered; the worker dismisses the callback later.
    query(f"""insert into public.calls(id,organization_id,direction,status,contact_phone,caller_id_used,twilio_call_sid)
        values ('{ids['bridge_call']}','{org}','inbound','ringing','+12025550176','+15550001000','CA{uuid.uuid4().hex}');
      insert into public.inbound_route_attempts(id,call_id,organization_id,mode,owner_agent_id,eligibility_reason,stage,
          mobile_accepted_at,mobile_accept_result,mobile_bridge_evidence)
        values ('{ids['bridge_attempt']}','{ids['bridge_call']}','{org}','owner','{first}','owner_offline_mobile','owner_mobile',
          clock_timestamp(),'accepted','not_bridged');
      update public.calls set status='completed' where id='{ids['bridge_call']}';
      update private.automation_events set available_at=clock_timestamp()-interval '1 second'
        where organization_id='{org}' and event_type='inbound_call_missed' and source_id='{ids['bridge_call']}';
      select public.automation_process_events(25);""")
    for item in claims():
        query(f"select public.automation_create_task('{item['run_id']}','{item['lease_token']}','task','Call back',null);")
    callback = query(f"select id from public.inbound_callbacks where call_id='{ids['bridge_call']}' and status='open'")
    assert callback, "The missed call made no callback"
    listed = json.loads(query(as_agent(first, "select public.inbound_callback_queue();")).splitlines()[-1])
    open_before = listed["open_count"]
    assert any(item["call_id"] == ids['bridge_call'] for item in listed["items"])
    with hold(f"select 1 from public.inbound_callbacks where id='{callback}' for update;"):
        bridged, took = run(f"""update public.inbound_route_attempts set mobile_bridge_evidence='dial_bridged',
            mobile_bridged_at=clock_timestamp() where id='{ids['bridge_attempt']}';""")
        assert bridged.returncode == 0, bridged.stderr
        assert took < 3, f"The bridge waited {took:.1f}s behind a busy callback"
        assert "requires investigation" not in bridged.stderr, bridged.stderr
        assert query(f"""select (agent_id is null and outcome is distinct from 'forwarded_answered'
            and answered_by_agent_id is null)::text from public.calls where id='{ids['bridge_call']}'""") == "true"
        assert query(f"select status from public.inbound_callbacks where id='{callback}'") == "open"
        assert pending(ids['bridge_call']) == "1:55P03:false", pending(ids['bridge_call'])
        listed = json.loads(query(as_agent(first, "select public.inbound_callback_queue();")).splitlines()[-1])
        assert not any(item["call_id"] == ids['bridge_call'] for item in listed["items"])
        assert listed["open_count"] == open_before - 1, (open_before, listed["open_count"])
        refused, took = run(as_agent(first, f"set local statement_timeout='5s'; select public.claim_inbound_callback('{callback}');"))
        assert refused.returncode != 0 and "This call was answered, so no callback is needed." in refused.stderr, refused.stderr
        assert took < 3, f"The claim waited {took:.1f}s behind a busy callback"
    query(f"""update private.automation_answer_settlements set retry_at=clock_timestamp()-interval '1 second'
        where call_id='{ids['bridge_call']}'; select public.automation_process_events(25);""")
    assert query(f"select status||':'||closed_reason from public.inbound_callbacks where id='{callback}'") == "dismissed:answered"
    assert pending(ids['bridge_call']) == "none"
    caught_up, _ = run(f"update public.calls set outcome='forwarded_answered' where id='{ids['bridge_call']}';")
    assert caught_up.returncode == 0 and "requires investigation" not in caught_up.stderr, caught_up.stderr
    assert query(f"select status from public.inbound_callbacks where id='{callback}'") == "dismissed"
    assert pending(ids['bridge_call']) == "none"

    # 9. A booking first processed while the appointment was cancelled has no run. Two workers see it reopened at the
    #    same moment: the second waits for the first, and one run follows the appointment.
    def reminder_graph(step):
        return json.dumps({"format": 1, "settings": {"reentry": "once", "stop_on_reply": False}, "nodes": [
            {"id": "start", "type": "appointment_booked", "version": 1, "config": {}},
            {"id": "until", "type": "wait_until_before_appointment", "version": 1, "config": {"amount": 1, "unit": "hours"}},
            step], "edges": [{"id": "a", "source": "start", "target": "until"}, {"id": "b", "source": "until", "target": step["id"]}]})
    def publish_graph(flow, version, title, body):
        return f"""insert into public.workflows(id,organization_id,name,status,trigger_type,automation_graph,automation_revision)
            values ('{ids[flow]}','{org}','{title}','active','manual','{body}',1);
          insert into public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
            values ('{ids[version]}','{org}','{ids[flow]}','{title}',1,'{body}',clock_timestamp(),'{admin}');
          update public.workflows set automation_version_id='{ids[version]}' where id='{ids[flow]}';
          insert into public.automation_intervals(organization_id,workflow_id,version_id,starts_at)
            values ('{org}','{ids[flow]}','{ids[version]}',clock_timestamp());"""
    task_step = {"id": "task", "type": "create_task", "version": 1,
                 "config": {"title": "Synthetic reminder", "task_type": "Follow Up", "due_amount": 0, "due_unit": "minutes"}}
    query(f"""update public.workflows set status='paused' where organization_id='{org}' and status='active';
      {publish_graph('first_seen_flow', 'first_seen_version', 'Concurrency first seen cancelled', reminder_graph(task_step))}
      insert into public.leads(id,organization_id,first_name,assigned_agent_id) values ('{ids['first_seen_lead']}','{org}','First seen','{first}');
      insert into public.appointments(id,organization_id,title,contact_id,user_id,start_time,sync_source)
        values ('{ids['first_seen']}','{org}','First seen cancelled','{ids['first_seen_lead']}','{first}',now()+interval '3 days','internal');
      update public.appointments set status='Cancelled' where id='{ids['first_seen']}';
      select public.automation_process_events(25);
      update public.appointments set start_time=now()+interval '5 days' where id='{ids['first_seen']}';
      update public.appointments set status='Scheduled' where id='{ids['first_seen']}';""")
    first_seen_runs = f"select count(*) from private.automation_runs where workflow_id='{ids['first_seen_flow']}'"
    assert query(first_seen_runs) == "0", "A booking processed while cancelled started a run"
    refresh = f"select private.automation_refresh_appointment_runs('{org}','{ids['first_seen']}');"
    with hold(refresh):
        twin = contender("v2-first-seen", refresh)
    assert twin.wait(timeout=15) == 0, twin.stderr.read()
    assert query(first_seen_runs) == "1", "Two workers seeing the reopening started more than one run"
    query("select public.automation_process_events(25);")
    assert query(first_seen_runs) == "1", "Processing the reopening afterwards started another run"

    # 10. A reminder text at its final authorization. An appointment move still in flight refuses the handoff after a
    #     brief wait; a handoff in progress keeps a save of its appointment waiting only until it commits.
    text_step = {"id": "text", "type": "send_sms", "version": 1,
                 "config": {"body": "Reminder {{appointment_time}}", "purpose": "informational"}}
    query(f"""update public.workflows set status='paused' where organization_id='{org}' and status='active';
      update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,
        leased_until=null where organization_id='{org}' and status in ('queued','waiting','held');
      {publish_graph('text_flow', 'text_version', 'Concurrency reminder text', reminder_graph(text_step))}
      update private.automation_release_controls set dispatch_enabled=true where organization_id='{org}';
      insert into public.appointments(id,organization_id,title,contact_id,user_id,start_time,sync_source) values
        ('{ids['text_moved']}','{org}','Moved during the handoff','{ids['lead']}','{first}',now()+interval '3 hours','internal'),
        ('{ids['text_kept']}','{org}','Saved after the handoff','{ids['lead']}','{first}',now()+interval '3 hours','internal'),
        ('{ids['text_busy']}','{org}','Edited during the handoff','{ids['lead']}','{first}',now()+interval '3 hours','internal'),
        ('{ids['text_long']}','{org}','Edited at length during the handoff','{ids['lead']}','{first}',now()+interval '3 hours','internal'),
        ('{ids['text_queued']}','{org}','Edited twice during the handoff','{ids['lead']}','{first}',now()+interval '3 hours','internal');
      select public.automation_process_events(25);""")
    for item in claims():
        assert query(f"select public.automation_finish_node('{item['run_id']}','{item['lease_token']}','wait')") == "t"
    query(f"update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id='{ids['text_flow']}'")
    for item in claims():
        assert query(f"select public.automation_finish_node('{item['run_id']}','{item['lease_token']}','elapsed')") == "t"
    texts = {}
    for item in claims():
        appointment = query(f"""select e.subject->>'appointment_id' from private.automation_runs r
            join private.automation_events e on e.id=r.event_id where r.id='{item['run_id']}'""")
        assert item["node_id"] == "text", item
        texts[appointment] = item
    assert set(texts) == {ids['text_moved'], ids['text_kept'], ids['text_busy'], ids['text_long'], ids['text_queued']}, texts
    def authorize(item):
        return f"select public.automation_authorize_handoff('{item['run_id']}','{item['lease_token']}','text');"
    moved = texts[ids['text_moved']]
    with hold(f"update public.appointments set start_time=start_time+interval '1 day' where id='{ids['text_moved']}';"):
        refused, took = run(authorize(moved))
        assert refused.returncode == 0 and refused.stdout.strip() == "f", refused.stdout + refused.stderr
        assert took < 1.5, f"The handoff waited {took:.1f}s for a save in flight"
    assert query(authorize(moved)) == "f", "A reminder for the old time was authorized after the move"
    assert query(f"select status from private.automation_intents where run_id='{moved['run_id']}' and node_id='text'") == "prepared"
    kept = texts[ids['text_kept']]
    with hold(authorize(kept)):
        saved = contender("v2-save-after-handoff",
                          f"update public.appointments set title='Saved after the handoff' where id='{ids['text_kept']}';")
        assert query(f"select status from private.automation_intents where run_id='{kept['run_id']}' and node_id='text'") == "prepared"
    assert saved.wait(timeout=15) == 0, saved.stderr.read()
    assert query(f"select status from private.automation_intents where run_id='{kept['run_id']}' and node_id='text'") == "handed_off"

    # 11. An unrelated save of the appointment (its notes) in flight at the final authorization. A short one is waited
    #     out and the reminder is handed off. One that lasts longer refuses the handoff without recording anything, and
    #     the worker's next lease hands the same reminder off, once.
    def intent(item):
        return query(f"select status from private.automation_intents where run_id='{item['run_id']}' and node_id='text'")
    worker, _ = session("v2-busy-worker")
    busy = texts[ids['text_busy']]
    saver = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    saver.stdin.write(f"begin; update public.appointments set title='Notes edited' where id='{ids['text_busy']}';\n"
                      "\\echo LOCK_HELD\nselect pg_sleep(0.3);\ncommit;\n")
    saver.stdin.flush()
    for line in saver.stdout:
        if line.rstrip() == "LOCK_HELD":
            break
    started = time.monotonic()
    answer = send(worker, authorize(busy), "BUSY_DONE")
    took = time.monotonic() - started
    saver.stdin.close()
    assert saver.wait(timeout=15) == 0, saver.stderr.read()
    assert answer == ["t"], answer
    assert 0.1 < took < 1.5, f"The handoff did not wait out a short save ({took:.2f}s)"
    assert intent(busy) == "handed_off"
    long = texts[ids['text_long']]
    with hold(f"update public.appointments set title='Notes edited at length' where id='{ids['text_long']}';"):
        started = time.monotonic()
        answer = send(worker, authorize(long), "LONG_DONE")
        took = time.monotonic() - started
    assert answer == ["f"], answer
    assert 0.4 < took < 1.5, f"The handoff gave up on a long save after {took:.2f}s"
    assert intent(long) == "prepared", "A refused handoff recorded something"
    assert query(f"select public.automation_finish_node('{long['run_id']}','{long['lease_token']}','held','Run no longer permits a provider handoff.')") == "t"
    query(f"update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where id='{long['run_id']}'")
    again = [item for item in claims() if item["run_id"] == long["run_id"]]
    assert len(again) == 1 and again[0]["node_id"] == "text", again
    assert query(authorize(again[0])) == "t" and intent(long) == "handed_off", "The next lease did not hand the reminder off"
    # Two saves, the second queued behind the first: the worker gives up half a second after it first tried, measured
    # inside the server, however many saves are waiting; it never waits for each in turn.
    queued = texts[ids['text_queued']]
    first_save = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first_save.stdin.write(f"begin; update public.appointments set title='Edited once' where id='{ids['text_queued']}';\n"
                           "\\echo LOCK_HELD\nselect pg_sleep(0.45);\ncommit;\n")
    first_save.stdin.flush()
    for line in first_save.stdout:
        if line.rstrip() == "LOCK_HELD":
            break
    second_save = contender("v2-second-save", f"update public.appointments set title='Edited twice' where id='{ids['text_queued']}'; "
                            "select pg_sleep(0.45);")
    answer = send(worker, f"""select ok::text||' '||round(extract(epoch from clock_timestamp()-statement_timestamp())::numeric,3)
        from (select public.automation_authorize_handoff('{queued['run_id']}','{queued['lease_token']}','text') ok offset 0) x;""",
                  "QUEUED_DONE")
    first_save.stdin.close()
    assert first_save.wait(timeout=15) == 0, first_save.stderr.read()
    assert second_save.wait(timeout=15) == 0, second_save.stderr.read()
    verdict, waited_for = answer[0].split()
    assert verdict == "false" and 0.45 < float(waited_for) < 0.75, f"Two queued saves were waited out for {waited_for}s ({verdict})"
    assert intent(queued) == "prepared", "A refused handoff recorded something"
    worker.stdin.close()
    worker.wait(timeout=15)
    query(f"update private.automation_release_controls set dispatch_enabled=false where organization_id='{org}';")

    # 6. An appointment cancelled, moved while cancelled and reopened, while the new time's booking is admitted at the
    #    same moment: carrying the old run on waits for that admission, so one run follows the appointment, not two.
    reminder = json.dumps({"format": 1, "settings": {"reentry": "once", "stop_on_reply": False}, "nodes": [
        {"id": "start", "type": "appointment_booked", "version": 1, "config": {}},
        {"id": "until", "type": "wait_until_before_appointment", "version": 1, "config": {"amount": 1, "unit": "days"}},
        {"id": "task", "type": "create_task", "version": 1,
         "config": {"title": "Synthetic reminder", "task_type": "Follow Up", "due_amount": 0, "due_unit": "minutes"}}],
        "edges": [{"id": "a", "source": "start", "target": "until"}, {"id": "b", "source": "until", "target": "task"}]})
    query(f"""update public.workflows set status='paused' where organization_id='{org}' and status='active';
      insert into public.workflows(id,organization_id,name,status,trigger_type,automation_graph,automation_revision)
        values ('{ids['appt_flow']}','{org}','Concurrency reminder','active','manual','{reminder}',1);
      insert into public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
        values ('{ids['appt_version']}','{org}','{ids['appt_flow']}','Concurrency reminder',1,'{reminder}',clock_timestamp(),'{admin}');
      update public.workflows set automation_version_id='{ids['appt_version']}' where id='{ids['appt_flow']}';
      insert into public.automation_intervals(organization_id,workflow_id,version_id,starts_at)
        values ('{org}','{ids['appt_flow']}','{ids['appt_version']}',clock_timestamp());
      insert into public.leads(id,organization_id,first_name,assigned_agent_id) values ('{ids['appt_lead']}','{org}','Reopened','{first}');
      insert into public.appointments(id,organization_id,title,contact_id,user_id,start_time,sync_source)
        values ('{ids['reopened']}','{org}','Reopened later','{ids['appt_lead']}','{first}',now()+interval '3 days','internal');
      select public.automation_process_events(25);""")
    assert query(f"select count(*) from private.automation_runs where workflow_id='{ids['appt_flow']}' and status='queued'") == "1"
    query(f"""update public.appointments set status='Cancelled' where id='{ids['reopened']}';
      select public.automation_process_events(25);""")
    assert query(f"""select status||':'||reason from private.automation_runs where workflow_id='{ids['appt_flow']}'""") == \
        "stopped:Appointment was cancelled"
    query(f"""update public.appointments set start_time=now()+interval '5 days' where id='{ids['reopened']}';
      update public.appointments set status='Scheduled' where id='{ids['reopened']}';""")
    booked = query(f"""select id from private.automation_events where organization_id='{org}' and event_type='appointment_booked'
        and subject->>'appointment_id'='{ids['reopened']}' order by id desc limit 1""")
    admit = f"""select private.automation_admit_event(e,i.id) from private.automation_events e, public.automation_intervals i
        where e.id={booked} and i.workflow_id='{ids['appt_flow']}';"""
    with hold(admit):
        resume = contender("v2-reopen", f"select private.automation_refresh_appointment_runs('{org}','{ids['reopened']}');")
    assert resume.wait(timeout=15) == 0, resume.stderr.read()
    assert query(f"""select count(*) from private.automation_runs where workflow_id='{ids['appt_flow']}'
        and status in ('queued','waiting','held')""") == "1", "Two runs follow the reopened appointment"
    # 12. A booking first processed while the appointment was cancelled, then moved while cancelled. A worker taking up
    #     the moved booking waits for the contact's lock (another admission holds it) while the agent reopens the
    #     appointment and commits. The run it starts is paced from the recorded reopening, never from the move made while
    #     the appointment was cancelled.
    query(f"""update public.workflows set status='paused' where organization_id='{org}' and status='active';
      update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,
        leased_until=null where organization_id='{org}' and status in ('queued','waiting','held');
      {publish_graph('race_flow', 'race_version', 'Concurrency reopened while a worker waits', reminder_graph(task_step))}
      insert into public.leads(id,organization_id,first_name,assigned_agent_id) values ('{ids['race_lead']}','{org}','Reopened while waiting','{first}');
      insert into public.appointments(id,organization_id,title,contact_id,user_id,start_time,sync_source)
        values ('{ids['race_appt']}','{org}','Reopened while a worker waits','{ids['race_lead']}','{first}',now()+interval '3 days','internal');
      update public.appointments set status='Cancelled' where id='{ids['race_appt']}';
      select public.automation_process_events(25);
      update public.appointments set start_time=now()+interval '5 days' where id='{ids['race_appt']}';""")
    race_runs = f"select count(*) from private.automation_runs where workflow_id='{ids['race_flow']}'"
    assert query(race_runs) == "0", "A booking processed while cancelled started a run"
    with hold(f"select pg_advisory_xact_lock(hashtextextended('automation-contact:{org}lead{ids['race_lead']}',0));"):
        admitting = contender("v2-reopen-while-waiting", "select public.automation_process_events(25);")
        query(f"update public.appointments set status='Scheduled' where id='{ids['race_appt']}';")
    assert admitting.wait(timeout=15) == 0, admitting.stderr.read()
    paced = query(f"""select (r.paced_from=(select max(x.observed_at) from private.appointment_evidence_observations x
          where x.appointment_id='{ids['race_appt']}' and x.op='UPDATE'
            and private.appointment_status_key(x.prev->>'status')='cancelled'
            and private.appointment_status_key(x.next->>'status')='open'))::text||':'||r.status
        from private.automation_runs r where r.workflow_id='{ids['race_flow']}'""")
    assert paced == "true:queued", f"The run admitted as the reopening committed is paced from a moment while cancelled: {paced}"
    query("select public.automation_process_events(25);")
    assert query(race_runs) == "1", "Processing the reopening afterwards started another run"

    # 13 to 18. The record of what a booking run gave for an appointment time (private.automation_given_steps), one row per
    #     agency, automation, appointment, start time, step and attempt. Two booking runs of an automation never follow one
    #     appointment at once, so each race adds the runs it needs for the same time as admission would start them, one
    #     for each later booking of the appointment (a move a day later and back, each seen, opened their slots).
    def only(flow, version, title, step):
        """The one automation on: every other one is paused with its activation closed, so no booking waits for it."""
        query(f"""update public.workflows set status='paused' where organization_id='{org}' and status='active';
          update public.automation_intervals set ends_at=clock_timestamp() where organization_id='{org}' and ends_at is null;
          update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,
            leased_until=null where organization_id='{org}' and status in ('queued','waiting','held');
          {publish_graph(flow, version, title, reminder_graph(step))}""")
    only('record_text_flow', 'record_text_version', 'Concurrency record text', text_step)
    query(f"update private.automation_release_controls set dispatch_enabled=true where organization_id='{org}'")
    def record_runs(n, flow, version, node, extra):
        """Book an appointment three hours out for a new lead, move it a day later and back (each seen), bring the run its
        booking started to the step and add `extra` runs of the automation at that step for the same time, all leased now.
        Returns the leases, the booking run first."""
        lead, appointment = ids[f"record{n}_lead"], ids[f"record{n}_appt"]
        query(f"""insert into public.leads(id,organization_id,first_name,phone,assigned_agent_id)
            values ('{lead}','{org}','Record {n}','+120255501{80 + n}','{first}');
          insert into public.appointments(id,organization_id,title,contact_id,user_id,start_time,sync_source)
            values ('{appointment}','{org}','Record {n}','{lead}','{first}',date_trunc('minute',now())+interval '3 hours','internal');
          select public.automation_process_events(25);""")
        for item in claims():
            assert query(f"select public.automation_finish_node('{item['run_id']}','{item['lease_token']}','wait')") == "t"
        query(f"""update public.appointments set start_time=start_time+interval '1 day' where id='{appointment}';
          select public.automation_process_events(25);
          update public.appointments set start_time=start_time-interval '1 day' where id='{appointment}';
          select public.automation_process_events(25);
          update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where workflow_id='{ids[flow]}'
            and status='waiting';""")
        for item in claims():
            assert query(f"select public.automation_finish_node('{item['run_id']}','{item['lease_token']}','elapsed')") == "t"
        booked = query(f"""select string_agg(id::text,',' order by id) from private.automation_events where organization_id='{org}'
            and event_type='appointment_booked' and subject->>'appointment_id'='{appointment}'""").split(",")
        assert len(booked) == 3, booked
        order = [query(f"select id from private.automation_runs where event_id={booked[0]} and workflow_id='{ids[flow]}'")]
        for event in booked[1:1 + extra]:
            order.append(query(f"""insert into private.automation_runs(organization_id,workflow_id,version_id,event_id,contact_id,
                contact_type,scope_key,current_node_id,status,due_at,anchor_id,anchor_at,reminded_for,paced_from)
              select '{org}','{ids[flow]}','{ids[version]}',e.id,'{lead}','lead','slot:'||(e.subject->>'occurrence_id'),'{node}',
                'queued',clock_timestamp()-interval '1 second',s.occurrence_id,s.starts_at,s.occurrence_id,clock_timestamp()
              from private.automation_events e,private.automation_appointment_state('{org}','{appointment}') s
              where e.id={event} returning id"""))
        leased = {item["run_id"]: item for item in claims()}
        assert set(leased) == set(order) and all(item["node_id"] == node for item in leased.values()), leased
        return [leased[run] for run in order]
    def check(item):
        return f"select public.automation_message_check('{item['run_id']}','{item['lease_token']}','{item['node_id']}');"
    def given(n):
        """The record's rows for the race's appointment (none where the database has no record)."""
        if query("select to_regclass('private.automation_given_steps') is null") == "t":
            return "none"
        return query(f"""select coalesce(string_agg(g.node_id||'#'||g.attempt||':'||g.kind||':'||g.run_id,',' order by g.attempt),'none')
            from private.automation_given_steps g where g.organization_id='{org}' and g.appointment_id='{ids[f"record{n}_appt"]}'""")
    def message(item, n):
        """The message row the handoff records (automation_begin_message), as its id."""
        return query(f"""insert into private.automation_messages(organization_id,run_id,node_id,contact_id,contact_type,channel,
            recipient,sender,owner_id,body) values ('{org}','{item['run_id']}','{item['node_id']}','{ids[f"record{n}_lead"]}','lead',
            'sms','+120255501{80 + n}','+15550001000','{admin}','Reminder') returning id""")
    def undelivered(sms, sid):
        return f"""select public.automation_record_provider_receipt('{sms}','{org}','{sid}','failed',clock_timestamp(),
            'undelivered','30003');"""
    def set_aside():
        """Each race leaves no run that a later one could lease."""
        query(f"""update private.automation_runs set status='stopped',reason='Set aside',ended_at=clock_timestamp(),lease_token=null,
            leased_until=null where organization_id='{org}' and status in ('queued','waiting','held')""")

    # 13. Two runs hand off the same text for the same time at once. One handoff is recorded; the other waits for it, is
    #     refused, is told the text was already sent for this time, and finishes skipped with no record of its own.
    winner, twin = record_runs(1, "record_text_flow", "record_text_version", "text", 1)
    with hold(authorize(winner)):
        loser = contender("v2-record-handoff", authorize(twin))
    lost = loser.wait(timeout=15)
    assert lost == 0, "The run that lost the race raised instead of being refused: " + loser.stderr.read()
    assert loser.stdout.read().strip() == "f", "Both runs handed off the same text for one time"
    assert given(1) == f"text#1:sms:{winner['run_id']}", given(1)
    assert intent(winner) == "handed_off" and intent(twin) == "prepared"
    assert query(check(twin)) == "skip:Already sent for this appointment time", query(check(twin))
    assert query(f"""select public.automation_finish_node('{twin['run_id']}','{twin['lease_token']}','skipped',
        'Already sent for this appointment time')""") == "t"
    assert query(f"""select r.status||':'||s.status||':'||s.reason from private.automation_runs r join private.automation_steps s
        on s.run_id=r.id and s.node_id='text' where r.id='{twin['run_id']}'""") == "completed:skipped:Already sent for this appointment time"
    assert given(1) == f"text#1:sms:{winner['run_id']}", "The run that lost the race recorded something"
    set_aside()

    # 14. The provider reported the first attempt undelivered (30003), and two runs try its one retry at once. One second
    #     attempt is recorded; the other run is refused, told the text was already retried once for this time, and
    #     finishes skipped without recording or using a retry.
    first_try, retry_a, retry_b = record_runs(2, "record_text_flow", "record_text_version", "text", 2)
    assert query(authorize(first_try)) == "t"
    query(undelivered(message(first_try, 2), f"SM{uuid.uuid4().hex}"))
    assert query(check(retry_a)) == "retry:" and query(check(retry_b)) == "retry:", query(check(retry_a))
    with hold(authorize(retry_a)):
        loser = contender("v2-record-retry", authorize(retry_b))
    assert loser.wait(timeout=15) == 0 and loser.stdout.read().strip() == "f", "Two retries of one text went out"
    assert given(2) == f"text#1:sms:{first_try['run_id']},text#2:sms:{retry_a['run_id']}", given(2)
    assert query(check(retry_b)) == "skip:Not sent again: already retried once for this appointment time", query(check(retry_b))
    assert intent(retry_b) == "prepared"
    assert query(f"""select public.automation_finish_node('{retry_b['run_id']}','{retry_b['lease_token']}','skipped',
        'Not sent again: already retried once for this appointment time')""") == "t"
    assert query(f"select status from private.automation_runs where id='{retry_b['run_id']}'") == "completed"
    assert given(2) == f"text#1:sms:{first_try['run_id']},text#2:sms:{retry_a['run_id']}", "The run that lost the retry recorded something"
    set_aside()

    # 15. A retry handoff while a provider receipt holds the first attempt's message row is refused at once (it never
    #     queues for the row) and records no second attempt. Once the receipt commits, still failed, the worker's next
    #     lease sends the retry once.
    first_try, retry = record_runs(3, "record_text_flow", "record_text_version", "text", 1)
    assert query(authorize(first_try)) == "t"
    sms, sid = message(first_try, 3), f"SM{uuid.uuid4().hex}"
    query(undelivered(sms, sid))
    assert query(check(retry)) == "retry:"
    with hold(undelivered(sms, sid)):
        refused, took = run(authorize(retry))
        assert refused.returncode != 0 and "A receipt for the first attempt of this text is being recorded." in refused.stderr, \
            refused.stdout + refused.stderr
        assert took < 1.5, f"The retry waited {took:.1f}s for a receipt in progress"
        assert given(3) == f"text#1:sms:{first_try['run_id']}" and intent(retry) == "prepared", given(3)
    assert query(f"select state from private.automation_messages where id='{sms}'") == "failed"
    assert query(f"""select public.automation_finish_node('{retry['run_id']}','{retry['lease_token']}','held',
        'Run no longer permits a provider handoff.')""") == "t"
    query(f"update private.automation_runs set due_at=clock_timestamp()-interval '1 second' where id='{retry['run_id']}'")
    again = [item for item in claims() if item["run_id"] == retry["run_id"]]
    assert len(again) == 1 and query(check(again[0])) == "retry:" and query(authorize(again[0])) == "t", again
    assert given(3) == f"text#1:sms:{first_try['run_id']},text#2:sms:{retry['run_id']}", given(3)
    set_aside()

    # 16. Two task steps for the same time at once create one task: the second waits for the first's record and is
    #     skipped as already created.
    only('record_task_flow', 'record_task_version', 'Concurrency record task', task_step)
    made, twin = record_runs(4, "record_task_flow", "record_task_version", "task", 1)
    def create(item):
        return f"select public.automation_create_task('{item['run_id']}','{item['lease_token']}','task','Synthetic reminder',null);"
    with hold(create(made)):
        other = contender("v2-record-task", create(twin))
    assert other.wait(timeout=15) == 0, other.stderr.read()
    second = other.stdout.read()
    assert '"skipped"' in second and "Already created for this appointment time" in second, second
    assert query(f"select count(*) from public.tasks where contact_id='{ids['record4_lead']}'") == "1"
    assert given(4) == f"task#1:task:{made['run_id']}", given(4)
    set_aside()

    # 17. A person's stop of the run itself, committed while its handoff waits for the run, or just before it, keeps the
    #     text from being handed off.
    only('record_stop_flow', 'record_stop_version', 'Concurrency record stops', text_step)
    def stop(item):
        return f"""update private.automation_runs set status='stopped',reason='Stopped by user',ended_at=clock_timestamp(),
            updated_at=clock_timestamp(),lease_token=null,leased_until=null where id='{item['run_id']}';"""
    [stopped] = record_runs(5, "record_stop_flow", "record_stop_version", "text", 0)
    with hold(stop(stopped)):
        waiting = contender("v2-record-own-stop", authorize(stopped))
    assert waiting.wait(timeout=15) == 0 and waiting.stdout.read().strip() == "f", "A stopped run handed its text off"
    assert intent(stopped) == "prepared" and given(5) == "none", given(5)
    [stopped] = record_runs(6, "record_stop_flow", "record_stop_version", "text", 0)
    query(stop(stopped))
    assert query(authorize(stopped)) == "f" and intent(stopped) == "prepared" and given(6) == "none"
    set_aside()

    # 18. A person's stop of another booking run of the automation for the appointment, committed after this run's lease
    #     and before its handoff, keeps the text from being handed off (the final check's cross-run guard).
    leased, other = record_runs(7, "record_stop_flow", "record_stop_version", "text", 1)
    query(stop(other))
    assert query(authorize(leased)) == "f", "A run handed its text off after another run was stopped at its time"
    assert query(check(leased)) == "A run of this automation for this appointment was stopped just now", query(check(leased))
    assert intent(leased) == "prepared" and given(7) == "none", given(7)
    set_aside()
    # The same stop committed while the handoff waits for its locks: the workflow row is held for share (as a task step
    # holds it), the handoff queues for it, the other run's stop commits from another session, then the row is released.
    # The final check reads after the locks, so it sees the stop and refuses.
    leased, other = record_runs(8, "record_stop_flow", "record_stop_version", "text", 1)
    assert query(check(leased)) == "", "The text was not ready to go before the race: " + query(check(leased))
    with hold(f"select 1 from public.workflows where id='{ids['record_stop_flow']}' for share;"):
        waiting = contender("v2-record-other-stop", authorize(leased))
        query(stop(other))
    answered = waiting.wait(timeout=15)
    assert answered == 0, "The handoff raised while a stop was committed during its wait: " + waiting.stderr.read()
    assert waiting.stdout.read().strip() == "f", "A run handed its text off after another run was stopped while it waited"
    assert intent(leased) == "prepared" and given(8) == "none", given(8)
    query(f"""update public.workflows set status='paused' where id='{ids['record_stop_flow']}';
      update private.automation_release_controls set dispatch_enabled=false where organization_id='{org}';""")
    print("PASS one winner of two simultaneous callback claims; one task from a twice-delivered step; one callback for a call "
          f"two automations reached together; an appointment saved in {waited:.2f}s during a held publish lock and its event recovered; "
          "an answer confirmed while a missed call's task or callback was being made closed it; an answer recorded while "
          "its task or callback was held elsewhere did not wait, was hidden from the list and refused for claiming, and was "
          "finished by the worker; a reopening two workers saw at once started one run; a move in flight refused a "
          "reminder's handoff after a brief wait and a handoff in progress held a save only until it committed; a reopened appointment "
          "carried on while its new time was admitted at the same moment has one run; a short unrelated save was waited out "
          "and a long one refused the handoff without cost, the next lease handing the reminder off once; two queued saves were waited "
          "out for half a second in all; a reopening committed while a worker waited to admit the booking paced its run from "
          "the reopening; two runs handing off one text for one time made one handoff, the other skipped as already sent with "
          "no record of its own; two retries at once made one second attempt; a retry met a receipt holding the first "
          "attempt's message and was refused at once, then sent once on the next lease; two task steps for one time made one "
          "task; a person's stop of the run or of another run of the automation for the appointment, committed before the "
          "handoff or while it waited for its locks, kept the text from being handed off")
finally:
    cleanup()
