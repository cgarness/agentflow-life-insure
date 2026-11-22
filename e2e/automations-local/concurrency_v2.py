"""Automations V2 contention checks on the dedicated, disposable test database.

Independent PostgreSQL connections race for one callback claim, one task step, and one callback per
missed call. A final check holds the lock a publish takes and proves a CRM save still commits at once.
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
                                             "call_version_b", "lead", "call", "callback", "callback_call", "appointment"]}

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
    print("PASS one winner of two simultaneous callback claims; one task from a twice-delivered step; one callback for a call "
          f"two automations reached together; an appointment saved in {waited:.2f}s during a held publish lock and its event recovered")
finally:
    cleanup()
