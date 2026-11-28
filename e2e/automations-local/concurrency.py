"""Run the session and worker contention checks on the dedicated, disposable test database."""
import json
import os
import subprocess
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

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
org, actor, target, session, independent, workflow, lead = [str(uuid.uuid4()) for _ in range(7)]
trigger_node, action_node, edge_id = [str(uuid.uuid4()) for _ in range(3)]
draft = '{"format":1,"nodes":[],"edges":[],"settings":{"reentry":"once","stop_on_reply":false}}'
graph = json.dumps({"format": 1, "settings": {"reentry": "once", "stop_on_reply": False},
                    "nodes": [{"id": trigger_node, "type": "lead_created", "version": 1, "config": {}},
                              {"id": action_node, "type": "send_sms", "version": 1, "config": {"body": "Synthetic", "purpose": "informational"}}],
                    "edges": [{"id": edge_id, "source": trigger_node, "target": action_node}]})
def query(sql):
    return subprocess.check_output(psql, input=sql, text=True, timeout=25).strip()

def identity(sid):
    claims = json.dumps({"sub": actor, "session_id": sid, "role": "authenticated", "app_metadata": {"organization_id": org}})
    return f"""set local role authenticated;
    set local request.jwt.claim.sub='{actor}'; set local request.jwt.claims='{claims}';"""

def authenticated(sid, sql):
    return query(f"begin; {identity(sid)} {sql}; commit;")

@contextmanager
def hold(sql):
    """Keep a transaction open after the server confirms all preceding statements finished."""
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
            process.wait()

def wait_for_blocked(app_name):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if query(f"select exists(select from pg_stat_activity where application_name='{app_name}' and wait_event_type='Lock');") == "t":
            return
        time.sleep(0.05)
    raise AssertionError("The competing authenticated request did not block on the session row")

def save(rev, expected, uid):
    return f"select save_automation_draft('{uid}', 'Synthetic', '{draft}', {expected}, {rev});"

def cleanup():
    child_tables = ["private.automation_steps", "private.automation_intents", "private.automation_task_receipts",
                    "private.automation_runs", "private.automation_deferred_admissions", "private.automation_events",
                    "private.automation_intake_recovery", "private.automation_sms_purposes"]
    children = "\n".join(f"delete from {table} where organization_id='{org}';" for table in child_tables)
    query(f"""begin; {children}
      update public.workflows set automation_version_id=null where organization_id='{org}';
      delete from public.automation_intervals where organization_id='{org}';
      delete from public.workflow_versions where organization_id='{org}';
      delete from public.workflows where organization_id='{org}';
      delete from public.campaign_leads where organization_id='{org}';
      delete from public.campaigns where organization_id='{org}';
      delete from public.leads where organization_id='{org}';
      delete from private.automation_release_controls where organization_id='{org}';
      delete from auth.users where id in ('{actor}','{target}');
      delete from public.appointment_types where organization_id='{org}';
      delete from public.lead_sources where organization_id='{org}';
      delete from public.pipeline_stages where organization_id='{org}';
      delete from public.organizations where id='{org}'; commit;""")

try:
    query(f"""begin;
      insert into public.organizations(id,name) values ('{org}','Synthetic contention test');
      insert into auth.users(id,email) values ('{actor}','{actor}@example.invalid'),('{target}','{target}@example.invalid');
      update public.profiles set organization_id='{org}',role='Super Admin',is_super_admin=true,status='Active' where id='{actor}';
      update public.profiles set organization_id='{org}',role='Agent',status='Active' where id='{target}';
      commit;""")
    visibility = Path(__file__).resolve().parents[2] / "supabase/ops/automations_builder_visibility.sql"
    subprocess.run(psql + ["-v", f"agency_id={org}", "-v", "action=show"], input=visibility.read_text(),
                   text=True, stdout=subprocess.DEVNULL, check=True, timeout=25)
    query(f"""begin;
      insert into auth.sessions(id,user_id,created_at) values ('{session}','{actor}',clock_timestamp()),('{independent}','{actor}',clock_timestamp());
      update private.automation_release_controls set enrollment_enabled=true where organization_id='{org}';
      commit;""")
    own = int(authenticated(session, "select automation_session_context()->>'revision'"))
    other = int(authenticated(independent, "select automation_session_context()->>'revision'"))

    editor = str(uuid.uuid4())
    authenticated(session, f"select public.save_automation_draft('{workflow}','Synthetic valid graph','{graph}',0,{own});")
    controls = authenticated(session, f"select public.automation_access('{workflow}')->'release_controls'")
    assert json.loads(controls) == {"enrollment_enabled": True, "dispatch_enabled": False}
    worker_name = "automation-race-" + session
    with hold(identity(session) + f"select automation_session_transition({own},'{target}');"):
        # A different login remains immediately writable while the real actor's first session changes.
        authenticated(independent, save(other, 0, str(uuid.uuid4())))
        waiter = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        waiter.stdin.write(f"begin; set local application_name='{worker_name}'; set local statement_timeout='12s';\n"
                           + identity(session) + f"select public.publish_automation('{workflow}',1,{own},'{controls}'); commit;\n")
        waiter.stdin.close()
        wait_for_blocked(worker_name)
    assert waiter.wait(timeout=15) != 0 and "Automations write denied" in waiter.stderr.read()
    assert query(f"select count(*) from public.workflow_versions where workflow_id='{workflow}'") == "0"
    active = int(authenticated(session, "select automation_session_context()->>'revision'"))
    normal = int(authenticated(session, f"select automation_session_transition({active},null)->>'revision'"))
    authenticated(session, save(normal, 0, editor))

    authenticated(session, f"select public.publish_automation('{workflow}',1,{normal},'{controls}');")
    query(f"insert into public.leads(id,organization_id) values ('{lead}','{org}');")
    with hold("select public.automation_process_events(25);"):
        assert query("select public.automation_process_events(25);") == "0"
    assert query(f"select count(*) from private.automation_runs where organization_id='{org}';") == "1"
    with hold("select * from public.automation_claim_work(25);"):
        assert query("select count(*) from public.automation_claim_work(25);") == "0"
    assert query(f"select count(*) from private.automation_intents where organization_id='{org}';") == "1"
    campaign = str(uuid.uuid4())
    query(f"insert into public.campaigns(id,name,organization_id,user_id) values ('{campaign}','Fixture','{org}','{actor}');")
    membership = f"""insert into public.campaign_leads(campaign_id,lead_id,organization_id,user_id)
      values ('{campaign}','{lead}','{org}','{actor}') on conflict do nothing;"""
    with hold(membership):
        second = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        second.stdin.write(f"begin; set local statement_timeout='12s'; set local application_name='{worker_name}';" + membership + "commit;\n")
        second.stdin.close()
        wait_for_blocked(worker_name)
    if second.wait(timeout=15):
        raise AssertionError(second.stderr.read())
    assert query(f"select count(*) from public.campaign_leads where organization_id='{org}' and campaign_id='{campaign}'") == "1"
    assert query(f"select count(*) from private.automation_events where organization_id='{org}' and event_type='campaign_membership_created'") == "1"
    print("PASS publish serialized behind enter and denied; independent login allowed; duplicate CRM attachment created one event; one enrollment and one intent under concurrent claims")
finally:
    cleanup()
