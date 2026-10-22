"""Release-runner verification: synthetic, disposable PostgreSQL on loopback ONLY.
No production credentials. Extracts the exact embedded workflow program and executes
its gates/psql transaction/history repair against a local PostgreSQL 17.6 service.
"""
import ast
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch
import yaml

def check_migration_order(m):
    # Exercise the dispatch path, not just the comparator: invalid versions must stop
    # before source/credential access and before any apply/history/deployment call.
    for version, latest in ((m.VERSION, m.VERSION), (m.VERSION, '99991231235959'),
                            ('20261013120000', '20261017043757')):
        for stage in ('apply-migration', 'record-history', 'deploy-functions'):
            with contextlib.ExitStack() as checks:
                checks.enter_context(patch.object(m, 'VERSION', version))
                checks.enter_context(patch.object(m, 'LATEST', latest))
                checks.enter_context(patch.dict(os.environ, {
                    'GITHUB_REF': 'refs/heads/main', 'STAGE': stage, 'CONFIRM': stage}))
                untouched = [checks.enter_context(patch.object(m, name)) for name in (
                    'files_gate', 'connection_env', 'identity', 'command',
                    'apply', 'repair', 'deploy')]
                try:
                    m.main()
                except m.Stop as error:
                    assert str(error) == 'migration version follows hosted head'
                else:
                    raise AssertionError('equal/older migration version accepted')
                for call in untouched:
                    call.assert_not_called()
    m.migration_order_gate()
    assert m.expected('before').split('|')[-2] == m.LATEST
    assert m.expected('applied').split('|')[-2] == m.LATEST
    assert m.expected('recorded').split('|')[-2] == m.VERSION
    print('PASS: nine migration-order refusals including old pins; current ordered history maximum')

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'sheets-source'
workflow = yaml.safe_load((ROOT / '.github/workflows/google-sheets-phase-b.yml').read_text())
assert set(workflow.get('on', workflow.get(True))) == {'workflow_dispatch'}
assert workflow['permissions'] == {'contents':'read'}
assert workflow['jobs']['phase-b']['environment'] == 'google-sheets-production'
assert workflow['jobs']['phase-b']['if'] == "github.ref == 'refs/heads/main'"
assert workflow['concurrency']['cancel-in-progress'] is False
steps = workflow['jobs']['phase-b']['steps']
assert steps[0]['with']['persist-credentials'] is False
assert all(len(x['uses'].split('@')[1].split()[0])==40 for x in steps if 'uses' in x)
code = steps[-1]['run'].split("<<'PYCODE'\n",1)[1].rsplit('PYCODE',1)[0]
ast.parse(code)
os.chdir(SOURCE)

with tempfile.TemporaryDirectory() as folder:
    module_path=Path(folder)/'runner.py'; module_path.write_text(code)
    spec=importlib.util.spec_from_file_location('runner',module_path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    check_migration_order(m)
    m.files_gate()
    # The current release pins have valid ordering. The fixture mirrors only their
    # history count/head; its only connection remains fixed loopback synthetic data.
    local = {k:v for k,v in os.environ.items() if not k.startswith(('PG','SUPABASE_'))} | {
        'PGHOST':'127.0.0.1','PGPORT':'55435','PGUSER':'postgres','PGDATABASE':'postgres',
        'PGPASSWORD':'synthetic-runner-only','PGSSLMODE':'disable', 'PGCONNECT_TIMEOUT':'5',
        'PGAPPNAME':'sheets-runner-synthetic-test'}
    assert local['PGHOST']=='127.0.0.1' and m.REF not in json.dumps(local)
    def run(query, env=local):
        return m.command(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',query],env)
    assert run('select version()').startswith('PostgreSQL 17.6 ')
    dbs=['gs_runner_success','gs_runner_lock','gs_runner_cancel']
    try:
        def setup(db):
            run(f'CREATE DATABASE {db}')
            env=local | {'PGDATABASE':db}
            m.command(['psql','-X','-q','-v','ON_ERROR_STOP=1','-f','supabase/tests/google_sheets_harness.sql'],env)
            run(f"""CREATE SCHEMA supabase_migrations;
              CREATE TABLE supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
              INSERT INTO supabase_migrations.schema_migrations(version,name)
                SELECT (20000101000000 + n)::text,'synthetic' FROM generate_series(1,341) n;
              INSERT INTO supabase_migrations.schema_migrations VALUES ('{m.LATEST}','{{}}','synthetic_latest');
              CREATE SCHEMA cron; CREATE TABLE cron.job(jobname text);""",env)
            # Harness is synthetic and includes pre-existing leads. The feature ledger starts empty.
            return env
        def local_expected(stage, db):
            return m.expected(stage).replace('postgres|',db+'|',1)
        good=setup(dbs[0]); assert m.state(good)==local_expected('before',dbs[0])
        m.apply(good); assert m.state(good)==local_expected('applied',dbs[0]);m.readbacks(good)
        # Real CLI repair and the exact 81-statement read-back, using only a local URL.
        url=f"postgresql://postgres:synthetic-runner-only@127.0.0.1:55435/{dbs[0]}?sslmode=disable"
        m.command(['supabase','migration','repair',m.VERSION,'--status','applied','--db-url',url],local,timeout=120)
        assert m.state(good)==local_expected('recorded',dbs[0])
        assert m.sql("select name || '|' || cardinality(statements)::text from supabase_migrations.schema_migrations where version='20261022062539'",good)=='google_sheets_import_foundation|81'
        try:m.apply(good)
        except m.Stop:pass
        else:raise AssertionError('migration replay was not refused')
        print('PASS: real apply, all SQL read-backs, history repair and replay refusal')
        # Verify the real 5-second lock timeout rolls back without leaving Sheets objects.
        locked=setup(dbs[1])
        marker=Path(folder)/'lock-acquired'
        blocker=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=locked,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,text=True)
        blocker.stdin.write(f"BEGIN; LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;\\! touch {marker}\nSELECT pg_sleep(12); ROLLBACK;\n");blocker.stdin.close()
        for _ in range(100):
            if marker.exists():break
            time.sleep(.1)
        assert marker.exists(), 'failed to establish local lock'
        try:m.apply(locked)
        except m.Stop:pass
        else:raise AssertionError('lock wait did not refuse apply')
        blocker.wait(timeout=20)
        assert m.state(locked)==local_expected('before',dbs[1])
        print('PASS: real lock-timeout rollback')
        # Shorten only the local watchdog clock; run the actual SIGINT path against PostgreSQL.
        cancelled=setup(dbs[2]); marker.unlink()
        blocker=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=cancelled,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,text=True)
        blocker.stdin.write(f"BEGIN; LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;\\! touch {marker}\nSELECT pg_sleep(8); ROLLBACK;\n");blocker.stdin.close()
        for _ in range(100):
            if marker.exists():break
            time.sleep(.1)
        assert marker.exists()
        original_wait=subprocess.Popen.wait
        def short_wait(self,timeout=None):return original_wait(self,timeout=1 if timeout==120 else timeout)
        with patch.object(subprocess.Popen,'wait',short_wait):
            try:m.apply(cancelled)
            except m.Stop:pass
            else:raise AssertionError('watchdog did not cancel')
        blocker.wait(timeout=15)
        assert m.state(cancelled)==local_expected('before',dbs[2])
        print('PASS: real watchdog SIGINT rollback')
        # Every rejected ordering must stop before any mutating function.
        for stage,states in [('apply-migration',['applied','recorded']),('record-history',['before','recorded']),('deploy-functions',['before','applied'])]:
            for current in states:
                with patch.dict(os.environ,{'GITHUB_REF':'refs/heads/main','STAGE':stage,'CONFIRM':stage}),patch.object(m,'files_gate'),patch.object(m,'connection_env',return_value=good),patch.object(m,'identity'),patch.object(m,'command',side_effect=['2.121.0','--db-url','--project-ref --no-verify-jwt --use-api']),patch.object(m,'secrets_gate'),patch.object(m,'inventory',return_value={}),patch.object(m,'state',return_value=m.expected(current)),patch.object(m,'empty_operations'),patch.object(m,'apply') as apply,patch.object(m,'repair') as repair,patch.object(m,'deploy') as deploy:
                    try:m.main()
                    except m.Stop as error:assert str(error)=='stage order and exact production state'
                    else:raise AssertionError('out-of-order stage accepted')
                    apply.assert_not_called();repair.assert_not_called();deploy.assert_not_called()
        print('PASS: six replay/out-of-order stage refusals')
        # Public logs must never echo stderr/stdout from a failed subprocess.
        with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess(['x'],1,'SECRET_OUT','SECRET_ERR')):
            try:m.command(['x'])
            except m.Stop as error:assert 'SECRET' not in str(error)
            else:raise AssertionError('command failure not propagated')
        print('PASS: command error redaction')
        # identity(): TLS is asserted on the runner's own connection (\conninfo), never via pg_stat_ssl,
        # which would describe the session pooler's upstream hop.
        pooler = {'PGHOST':'aws-0-us-east-1.pooler.supabase.com'}
        echo = f"{pooler['PGHOST']} 5432 postgres postgres.{m.REF}"
        connected = 'You are connected to database "postgres" as user "postgres" on host "h" at port "5432".'
        tls = connected + '\nSSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)'
        with patch.object(m,'command',side_effect=[echo,tls]),patch.object(m,'sql',return_value='postgres|postgres'):
            m.identity(pooler)
        with patch.object(m,'command',side_effect=[echo,connected]),patch.object(m,'sql',return_value='postgres|postgres'):
            try:m.identity(pooler)
            except m.Stop:pass
            else:raise AssertionError('plaintext connection accepted')
        print('PASS: identity requires TLS on the runner connection')
        # Check sessions are read-only through in-session SET, independent of pooler startup options.
        try:m.sql('CREATE TABLE public.gs_runner_write_probe(i int)',good)
        except m.Stop:pass
        else:raise AssertionError('read-only check session accepted a write')
        assert m.sql("select current_setting('default_transaction_read_only') || '|' || current_setting('statement_timeout')",good)=='on|30s'
        print('PASS: read-only check sessions with a 30 s statement timeout')
    finally:
        for db in dbs:run(f'DROP DATABASE IF EXISTS {db} WITH (FORCE)')
print('ALL RUNNER CHECKS PASSED; no production access or deployment')
