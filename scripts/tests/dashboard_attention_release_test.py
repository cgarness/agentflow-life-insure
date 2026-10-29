"""Protected Dashboard attention G3 runner rehearsal: synthetic LOCAL PostgreSQL 17.6 ONLY.

The production release script is exercised against an isolated loopback TLS
database. The real pinned Supabase CLI receives a separate role that can write
ONLY the synthetic migration-history table (never production SQL).
"""
import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from unittest.mock import patch

import yaml

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / 'scripts/dashboard_attention_release.py'
WORKFLOW = ROOT / '.github/workflows/dashboard-attention-release.yml'
HARNESS = ROOT / 'supabase/tests/dashboard_attention_clearances_harness.sql'
CLI = shutil.which('supabase') or sys.exit('REFUSED: pinned Supabase CLI not installed')
URL = os.environ.get('DAC_RELEASE_PGURL', '')
parts = urllib.parse.urlsplit(URL)
if not (parts.scheme in ('postgres', 'postgresql') and parts.hostname in ('127.0.0.1', 'localhost')
        and parts.username == 'postgres' and parts.port == 5432 and parts.path in ('', '/')):
    sys.exit('REFUSED: DAC_RELEASE_PGURL must be a LOCAL postgres on port 5432')
PASSWORD = urllib.parse.unquote(parts.password or '')
BASE_ENV = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'SUPABASE_', 'GITHUB_'))} | {
    'PGHOST': '127.0.0.1', 'PGPORT': '5432', 'PGUSER': 'postgres', 'PGSSLMODE': 'require', 'PGPASSWORD': PASSWORD}
PID = os.getpid()
DB = f'dac_release_{PID}'
ROLE = f'dac_release_{PID}_recorder'
ROLE_PASSWORD = hashlib.sha256(os.urandom(32)).hexdigest()[:32]
DB_ENV = BASE_ENV | {'PGDATABASE': DB}
ORG = 'a0000000-0000-4000-8000-00000000000a'
AGENT = '10000000-0000-4000-8000-000000000001'
CALL = '40000000-0000-4000-8000-000000000001'

spec = importlib.util.spec_from_file_location('dashboard_attention_release', RUNNER)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)
PASSES = 0

def ok(label):
    global PASSES
    PASSES += 1
    print('PASS TEST: ' + label, flush=True)

def psql(query=None, database=DB, stdin=None, env=None):
    args = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', database]
    args += ['-f', '-'] if stdin is not None else ['-c', query]
    result = subprocess.run(args, env=env or BASE_ENV, input=stdin,
                            capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, 'local psql failed: ' + result.stderr.strip()[:700]
    return result.stdout.strip()

def quiet(fn):
    stream = io.StringIO()
    with contextlib.redirect_stdout(stream):
        result = fn()
    return result, stream.getvalue()

def stops(fn, label):
    stream = io.StringIO()
    with contextlib.redirect_stdout(stream):
        try:
            fn()
        except m.Stop as exc:
            assert str(exc) == label, f'expected STOP {label!r}, got {str(exc)!r}'
            return stream.getvalue()
    raise AssertionError('runner did not stop at ' + label)

def prove_local():
    assert psql('select host(inet_server_addr())', 'postgres') in ('127.0.0.1', '::1')
    assert psql("select rolsuper from pg_roles where rolname=current_user", 'postgres') == 't'
    assert psql('show ssl', 'postgres') == 'on'
    assert psql('show server_version', 'postgres').startswith('17.6')
    assert psql("select count(*) from pg_roles where rolname in ('authenticator','supabase_admin')",
                'postgres') == '0'
    assert psql("select count(*) from pg_database where datname='jncvvsvckxhqgqvkppmj'", 'postgres') == '0'
    ok('local PostgreSQL 17.6 with TLS and no production connection')

def fresh():
    psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)', 'postgres')
    psql(f'CREATE DATABASE {DB}', 'postgres')
    psql(f"ALTER DATABASE {DB} SET plpgsql.variable_conflict = 'error'", 'postgres')
    psql(stdin=HARNESS.read_text())
    psql(stdin=f"""
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (
    version text NOT NULL PRIMARY KEY, statements text[], name text,
    created_by text, idempotency_key text UNIQUE, rollback text[]);
-- 350 synthetic versions and the actual G2 history head, total 351.
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 SELECT to_char(timestamp '2025-01-01'+g*interval '1 hour','YYYYMMDDHH24MISS'),
 'synthetic_'||g, ARRAY['-- synthetic '||g] FROM generate_series(1,350) g;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES ('20261029120000','dashboard_milestone_reviews',ARRAY['-- synthetic G2 history head']);
INSERT INTO public.organizations(id,name) VALUES ('{ORG}','Synthetic organization');
INSERT INTO auth.users(id) VALUES ('{AGENT}');
INSERT INTO public.profiles(id,organization_id,role,status,upline_id,team_id)
 VALUES ('{AGENT}','{ORG}','Agent','Active',NULL,NULL);
INSERT INTO public.calls(id,organization_id,agent_id,direction,is_missed,created_at,status)
 VALUES ('{CALL}','{ORG}',NULL,'inbound',true,'2026-10-29 18:00:00.123456+00','no-answer');
REVOKE ALL ON DATABASE {DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE {DB} TO {ROLE};
GRANT USAGE ON SCHEMA supabase_migrations TO {ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON supabase_migrations.schema_migrations TO {ROLE};
""")

def target():
    url = f'postgresql://{ROLE}:{urllib.parse.quote(ROLE_PASSWORD,safe="")}@127.0.0.1:5432/{DB}?sslmode=require'
    return m.Target(DB_ENV, url)

def test_workflow_and_guard():
    w = yaml.safe_load(WORKFLOW.read_text())
    trigger = w.get('on', w.get(True))
    assert list(trigger) == ['workflow_dispatch']
    assert w['permissions'] == {'contents':'read'}
    assert w['concurrency'] == {'group':'dashboard-attention-release','cancel-in-progress':False}
    assert set(w['jobs']) == {'environment-guard','release'}
    opts = trigger['workflow_dispatch']['inputs']
    assert opts['stage']['type']=='choice' and opts['stage']['options']==list(m.STAGES)
    assert opts['confirm']['required'] is True
    for job in w['jobs'].values():
        assert job['if']=="github.ref == 'refs/heads/main'"
        assert job['steps'][0]['with']=={'persist-credentials':False}
    assert w['jobs']['release']['environment']==m.ENVIRONMENT
    assert w['jobs']['release']['needs']=='environment-guard'
    assert w['jobs']['release']['steps'][2]['with']['version']==m.CLI_VERSION
    action = w['jobs']['release']['steps'][3]
    assert action['env']=={
        'STAGE':'${{ inputs.stage }}','CONFIRM':'${{ inputs.confirm }}',
        'SUPABASE_DB_PASSWORD':'${{ secrets.SUPABASE_DB_PASSWORD }}',
        'SUPABASE_POOLER_HOST':'${{ secrets.SUPABASE_POOLER_HOST }}'}
    assert action['run']=='python3 -I scripts/dashboard_attention_release.py run'
    text='\n'.join(line for line in WORKFLOW.read_text().splitlines() if not line.lstrip().startswith('#'))
    for forbidden in ('db push','migration up','db reset','--include-all','vercel','VITE_','SUPABASE_ACCESS_TOKEN'):
        assert forbidden not in text, forbidden
    assert re.findall(r'secrets\.([A-Za-z_]+)',text)==['SUPABASE_DB_PASSWORD','SUPABASE_POOLER_HOST']
    ok('only manual dispatches on main; protected environment; only two scoped secrets')
    reviewer = {'type':'User','reviewer':{'login':'cgarness'}}
    protected = {'name':m.ENVIRONMENT,'can_admins_bypass':False,
        'protection_rules':[{'type':'required_reviewers','reviewers':[reviewer]}],
        'deployment_branch_policy':{'protected_branches':False,'custom_branch_policies':True}}
    branches={'total_count':1,'branch_policies':[{'name':'main','type':'branch'}]}
    quiet(lambda:m.check_environment(protected,branches))
    for weakened in ({**protected,'can_admins_bypass':True},{**protected,'protection_rules':[]}):
        try:
            quiet(lambda:m.check_environment(weakened,branches))
        except m.Stop:
            continue
        raise AssertionError('environment guard allowed weakened protection')
    ok('required reviewer is cgarness; admin bypass and other refs forbidden')

def test_file_and_cli_gates():
    files,_=quiet(lambda:m.files_gate(ROOT))
    assert hashlib.sha256(files[0]).hexdigest()==m.SOURCE_SHA256
    assert hashlib.sha256(files[1]).hexdigest()==m.ROLLBACK_SHA256
    assert len(files[0])==16396 and len(files[1])==2338
    assert m.PRODUCTION.rows_before==351 and m.PRODUCTION.head_before=='20261029120000'
    quiet(lambda:m.cli_gate(CLI))
    ok('checksum-pinned files, 351-history baseline and CLI 2.121.0')
    root=Path(tempfile.mkdtemp(prefix='dac-gates-'))
    try:
        for p in (m.SOURCE,m.ROLLBACK):
            (root/p).parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(ROOT/p,root/p)
        quiet(lambda:m.files_gate(root))
        (root/m.SOURCE).write_bytes(files[0]+b'\n')
        stops(lambda:m.files_gate(root),'migration bytes and checksum (16,396 bytes, SHA-256 85ac2ff7…)')
        (root/m.SOURCE).write_bytes(files[0])
        extra=root/'supabase/migrations/20261029200000_dashboard_attention_clearances.sql'
        extra.write_bytes(files[0])
        stops(lambda:m.files_gate(root),'no top-level copy (no auto-apply)')
        extra.unlink()
        (root/m.ROLLBACK).write_bytes(files[1]+b' ')
        stops(lambda:m.files_gate(root),'rollback bytes and checksum (2,338 bytes, SHA-256 9250e2e7…)')
    finally:
        shutil.rmtree(root)
    ok('file tampering and accidental top-level migration fail before any write')
    for stage,confirm,ref in [('apply-migration','check','refs/heads/main'),
                               ('check','check','refs/heads/feature')]:
        with patch.dict(os.environ, {'GITHUB_REF':ref,'STAGE':stage,'CONFIRM':confirm}):
            stops(lambda:m.main(['run']),'main dispatch only' if ref!='refs/heads/main' else 'explicit stage confirmation')
    ok('wrong confirmation and non-main branch refused')

def source_digest():
    return psql(f"""select md5(string_agg(c::text, E'\\n' order by id))
        from public.calls c""")

def test_release(files):
    fresh()
    t=target()
    assert quiet(lambda:m.classify(t,m.PRODUCTION))[0]=='before'
    baseline,_=quiet(lambda:m.snapshot(t))
    before=source_digest()
    assert quiet(lambda:m.run_stage('check',t,m.PRODUCTION,files,CLI))[0]=='before'
    assert source_digest()==before
    ok('read-only check leaves all source calls unchanged')
    assert quiet(lambda:m.run_stage('apply-migration',t,m.PRODUCTION,files,CLI))[0]=='applied'
    assert quiet(lambda:m.classify(t,m.PRODUCTION))[0]=='applied'
    assert source_digest()==before
    ok('the single approved migration applies and does not change CRM source rows')
    stops(lambda:m.run_stage('apply-migration',t,m.PRODUCTION,files,CLI),'apply-migration needs the before state')
    ok('replaying apply-migration is refused')
    if m.RECORDED_STATEMENTS==0 or m.RECORDED_DIGEST=='UNPINNED':
        quiet(lambda:m.repair(t,'applied',files[0],CLI))
        print('HISTORY PIN CANDIDATE: '+m.recorded_row(t),flush=True)
        raise AssertionError('Pin the real CLI recorded statement count and digest before any merge')
    assert quiet(lambda:m.run_stage('record-history',t,m.PRODUCTION,files,CLI))[0]=='recorded'
    assert quiet(lambda:m.classify(t,m.PRODUCTION))[0]=='recorded'
    assert psql("select count(*) from supabase_migrations.schema_migrations")=='352'
    assert source_digest()==before
    stops(lambda:m.run_stage('record-history',t,m.PRODUCTION,files,CLI),'record-history needs the applied state')
    ok('one history record and no migration SQL reexecution')
    psql(stdin=f"""
SET ROLE authenticated;
SELECT dac_t.claims('{AGENT}','{ORG}');
SELECT id FROM public.clear_dashboard_attention_item('missed_call','{CALL}','2026-10-29 18:00:00.123456+00');
""")
    assert psql('select count(*) from public.dashboard_attention_clearances')=='1'
    stops(lambda:m.run_stage('rollback-migration',t,m.PRODUCTION,files,CLI),
          'no attention clearance rows exist (rollback never destroys review records)')
    assert psql('select count(*) from public.dashboard_attention_clearances')=='1'
    ok('rollback refuses to lose user clearance data')
    psql('delete from public.dashboard_attention_clearances')
    assert quiet(lambda:m.run_stage('rollback-migration',t,m.PRODUCTION,files,CLI))[0]=='before'
    assert quiet(lambda:m.classify(t,m.PRODUCTION))[0]=='before'
    assert quiet(lambda:m.snapshot(t))[0]==baseline
    ok('empty rollback restores schema catalog and history exactly')
    psql("insert into supabase_migrations.schema_migrations(version,name) values ('20261029210000','unreviewed')")
    stops(lambda:m.classify(t,m.PRODUCTION),'recognized production state')
    ok('history drift stops further release stages')

def main():
    prove_local()
    psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)','postgres')
    psql(f'DROP ROLE IF EXISTS {ROLE}','postgres')
    psql(f"CREATE ROLE {ROLE} LOGIN PASSWORD '{ROLE_PASSWORD}'",'postgres')
    try:
        test_workflow_and_guard()
        test_file_and_cli_gates()
        files,_=quiet(lambda:m.files_gate(ROOT))
        test_release(files)
        print(f'ALL PASSED: {PASSES} release rehearsal checks',flush=True)
    finally:
        psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)','postgres')
        psql(f'DROP ROLE IF EXISTS {ROLE}','postgres')

if __name__=='__main__':
    main()
