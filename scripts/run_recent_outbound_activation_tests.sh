#!/usr/bin/env bash
# Actual activation/recovery scripts, isolated synthetic PostgreSQL only. Never calls production.
set -euo pipefail
export RO_TEST_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${PGURL:?Set PGURL to an isolated localhost PostgreSQL server}"
export PGURL
python3 - <<'PY'
import hashlib, os, pathlib, re, subprocess, tempfile, urllib.parse, uuid
root=pathlib.Path(os.environ['RO_TEST_ROOT']).resolve()
u=urllib.parse.urlparse(os.environ['PGURL'])
assert u.scheme in ('postgres','postgresql') and u.hostname in ('127.0.0.1','localhost'), 'REFUSING non-local database'
assert not u.query and not u.fragment and u.path in ('','/'), 'REFUSING connection overrides/database path'
assert 'jncvvsvckxhqgqvkppmj' not in os.environ['PGURL'], 'REFUSING production reference'
print('LOCALITY VERIFIED: synthetic database at',u.hostname,u.port,flush=True)
base=os.environ['PGURL'].rstrip('/')
env=dict(os.environ,PGOPTIONS='-c plpgsql.variable_conflict=error')
db='ro_activation_'+uuid.uuid4().hex[:16]
assert re.fullmatch(r'ro_activation_[0-9a-f]+',db)
home='a0000000-0000-0000-0000-000000000001'
other='bbbbbbbb-0000-0000-0000-000000000002'
agent='cccccccc-0000-0000-0000-000000000003'
enable=pathlib.Path(os.environ.get('ENABLE_SQL',root/'supabase/ops/recent_outbound_enable_complete.sql')).resolve()
disable=pathlib.Path(os.environ.get('DISABLE_SQL',root/'supabase/ops/recent_outbound_disable_org.sql')).resolve()
passed=0

def sql(text, database=db, check=True):
    p=subprocess.run(['psql',base+'/'+database,'--no-psqlrc','-X','-v','ON_ERROR_STOP=1','-At','-c',text],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if check and p.returncode: raise RuntimeError(p.stderr)
    return p

def file(path, expected_failure=None, transaction=False):
    args=['psql',base+'/'+db,'--no-psqlrc','-X','-v','ON_ERROR_STOP=1','-q']
    if transaction: args+=['--single-transaction']
    args+=['-f',str(path)]
    p=subprocess.run(args,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if expected_failure:
        assert p.returncode != 0 and expected_failure in p.stderr, (str(path),p.returncode,p.stderr)
    elif p.returncode: raise RuntimeError(str(path)+'\n'+p.stderr)
    return p

def assertq(expression):
    p=sql('SELECT ('+expression+');')
    assert p.stdout.strip()=='t', (expression,p.stdout,p.stderr)

def checkpoint(name):
    global passed
    passed+=1; print('PASS',passed,name,flush=True)

def rowhash(org):
    return sql("SELECT md5(to_jsonb(c)::text) FROM private.recent_outbound_routing_orgs c WHERE organization_id='"+org+"';").stdout.strip()

sql('CREATE DATABASE '+db,database='postgres')
try:
    sequence=[
      'supabase/tests/inbound_harness.sql',
      'supabase/migrations/20260823222528_inbound_identity_foundation.sql',
      'supabase/migrations/20260823222805_inbound_claim_lifecycle.sql',
      'supabase/migrations/20260823222926_recording_source_sid.sql',
      'supabase/tests/inbound_v2_harness.sql',
      'supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql',
      'supabase/migrations/20260915025931_inbound_routing_v2_settings.sql',
      'supabase/migrations/20260915035141_inbound_route_attempts_d13_and_recovery.sql',
      'supabase/migrations/20260915053646_inbound_voicemails.sql',
      'supabase/migrations/20260918000614_voicemail_cleanup_actionable_selection.sql',
      'supabase/migrations/20260918002859_voicemail_first_listen_guard.sql',
    ]
    for name in sequence: file(root/name)
    sql(f"INSERT INTO public.organizations(id,name) VALUES ('{home}','Synthetic activation home'),('{other}','Synthetic unaffected tenant');")
    sql(f"INSERT INTO auth.users(id) VALUES ('{agent}'); INSERT INTO public.profiles(id,organization_id,status,twilio_client_identity) VALUES ('{agent}','{home}','Active','synthetic_activation_agent');")
    file(enable,'migration missing'); checkpoint('missing migration refused')
    file(root/'supabase/migrations/20260927052736_inbound_recent_outbound_routing.sql',transaction=True)
    file(enable,'v2 and Auto-Create Leads off required'); checkpoint('missing settings refused')
    sql(f"INSERT INTO public.inbound_routing_settings(organization_id,routing_engine,auto_create_lead) VALUES ('{home}','legacy',false);")
    file(enable,'v2 and Auto-Create Leads off required'); checkpoint('legacy engine refused')
    sql(f"UPDATE public.inbound_routing_settings SET routing_engine='v2',auto_create_lead=true,inbound_group_agent_ids=ARRAY['{agent}'::uuid] WHERE organization_id='{home}';")
    file(enable,'v2 and Auto-Create Leads off required'); checkpoint('auto-created contact mode refused')
    sql(f"UPDATE public.inbound_routing_settings SET auto_create_lead=false WHERE organization_id='{home}';")
    sql(f"INSERT INTO private.recent_outbound_routing_orgs(organization_id,enabled,unanswered_eligible,did_allowlist) VALUES ('{other}',true,true,ARRAY['15550000001']);")
    original_other=rowhash(other)
    file(enable)
    assertq(f"EXISTS(SELECT 1 FROM private.recent_outbound_routing_orgs WHERE organization_id='{home}' AND enabled AND unanswered_eligible AND did_allowlist IS NULL)")
    assert rowhash(other)==original_other
    checkpoint('answered and unanswered enabled for precisely the home org')
    first=rowhash(home); file(enable); assert rowhash(home)==first
    checkpoint('activation replay makes zero timestamp/row changes')
    file(disable)
    assertq(f"EXISTS(SELECT 1 FROM private.recent_outbound_routing_orgs WHERE organization_id='{home}' AND NOT enabled AND NOT unanswered_eligible AND did_allowlist IS NULL)")
    assert rowhash(other)==original_other
    checkpoint('one-org kill switch preserves other tenant')
    first=rowhash(home); file(disable); assert rowhash(home)==first
    checkpoint('disable replay makes zero timestamp/row changes')
    file(enable); checkpoint('reenable from exact disabled state')
    file(disable)
    for state in ["enabled=true,unanswered_eligible=false,did_allowlist=NULL", "enabled=false,unanswered_eligible=true,did_allowlist=NULL", "enabled=false,unanswered_eligible=false,did_allowlist=ARRAY['15550000002']"]:
        sql(f"UPDATE private.recent_outbound_routing_orgs SET {state} WHERE organization_id='{home}';")
        before=rowhash(home); file(enable,'unexpected configuration prestate'); assert rowhash(home)==before
        checkpoint('conflicting prestate refused: '+state)
    sql(f"UPDATE private.recent_outbound_routing_orgs SET enabled=false,unanswered_eligible=false,did_allowlist=NULL WHERE organization_id='{home}';")
    functions=[
      'public.plan_inbound_route(uuid,uuid,uuid,text,uuid[],integer)',
      'private.intended_recipients_for_call(uuid,uuid)',
      'private.recent_outbound_route_candidate(uuid,uuid,boolean)',
      'public.record_outbound_dial_evidence(text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz)',
    ]
    for fn in functions:
        definition=sql("SELECT pg_get_functiondef('"+fn+"'::regprocedure);").stdout
        assert 'BEGIN' in definition
        sql(definition.replace('BEGIN','BEGIN /* isolated activation drift negative control */',1))
        before=rowhash(home); file(enable,'function drift or missing'); assert rowhash(home)==before
        sql(definition); checkpoint('function drift refused: '+fn.split('(')[0])
    for role in ['anon','authenticated','service_role']:
        sql('GRANT USAGE ON SCHEMA private TO '+role)
        before=rowhash(home); file(enable,'private-schema grant drift'); assert rowhash(home)==before
        sql('REVOKE USAGE ON SCHEMA private FROM '+role); checkpoint('private-schema exposure refused: '+role)
    # The exact postconditions prevent a trigger from silently disabling unanswered eligibility.
    sql("CREATE FUNCTION private.ro_mutate_flag() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.unanswered_eligible=false; RETURN NEW; END $$; CREATE TRIGGER ro_bad_flag BEFORE UPDATE ON private.recent_outbound_routing_orgs FOR EACH ROW EXECUTE FUNCTION private.ro_mutate_flag();")
    before=rowhash(home); file(enable,'one-org postcondition failed'); assert rowhash(home)==before
    sql('DROP TRIGGER ro_bad_flag ON private.recent_outbound_routing_orgs; DROP FUNCTION private.ro_mutate_flag();')
    checkpoint('failed activation postcondition rolls back atomically')
    file(enable); file(disable)
    assert rowhash(other)==original_other
    sql(f"DELETE FROM private.recent_outbound_routing_orgs WHERE organization_id='{home}';")
    file(disable)
    assertq(f"NOT EXISTS(SELECT 1 FROM private.recent_outbound_routing_orgs WHERE organization_id='{home}')")
    assert rowhash(other)==original_other
    checkpoint('absent home configuration disable does not create rows')
    # Infrastructure/setup failures do not count as successful negative controls.
    with tempfile.TemporaryDirectory() as td:
        bad=pathlib.Path(td)/'invalid.sql'; bad.write_text('THIS IS NOT SQL;\n')
        rejected=False
        try: file(bad,'recent_outbound complete:')
        except AssertionError: rejected=True
        assert rejected
    checkpoint('negative-control harness rejects unrelated SQL failures')
    print('ALL ACTIVATION AND ONE-ORG RECOVERY CHECKS PASSED:',passed,flush=True)
finally:
    sql('DROP DATABASE IF EXISTS '+db,database='postgres')
PY
