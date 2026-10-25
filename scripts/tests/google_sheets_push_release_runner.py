"""Gate D release-runner verification: synthetic, disposable PostgreSQL on loopback ONLY.
No production credentials. Extracts the exact program embedded in .github/workflows/google-sheets-push-release.yml
and executes its gates, psql transaction, history repair (real Supabase CLI 2.121.0), Vault write and stage machine
against a local PostgreSQL 17.6 service. Management API and HTTP calls are replaced by fakes.
Env: RUNNER_PG (default 127.0.0.1:55435, password synthetic-runner-only), RUNNER_SOURCE (checkout of the pinned
SOURCE commit; default ./sheets-source), SUPABASE_BIN (default `supabase`).
"""
import ast
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from unittest.mock import patch
import yaml

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(os.environ.get('RUNNER_SOURCE', ROOT / 'sheets-source')).resolve()
HOST, PORT = os.environ.get('RUNNER_PG', '127.0.0.1:55435').split(':')
PASSWORD = os.environ.get('RUNNER_PG_PASSWORD', 'synthetic-runner-only')
SUPABASE = os.environ.get('SUPABASE_BIN', 'supabase')
if os.sep in SUPABASE:  # the runner calls `supabase` by name
    os.environ["PATH"] = str(Path(SUPABASE).absolute().parent) + os.pathsep + os.environ["PATH"]
assert HOST == '127.0.0.1', 'loopback only'

workflow = yaml.safe_load((ROOT / '.github/workflows/google-sheets-push-release.yml').read_text())
assert set(workflow.get('on', workflow.get(True))) == {'workflow_dispatch'}
assert workflow['permissions'] == {'contents': 'read'}
job = workflow['jobs']['push-release']
assert job['environment'] == 'google-sheets-production'
assert job['if'] == "github.ref == 'refs/heads/main'"
assert workflow['concurrency'] == {'group': 'google-sheets-production', 'cancel-in-progress': False}
steps = job['steps']
assert steps[0]['with']['persist-credentials'] is False
assert all(len(x['uses'].split('@')[1].split()[0]) == 40 for x in steps if 'uses' in x)
code = steps[-1]['run'].split("<<'PYCODE'\n", 1)[1].rsplit('PYCODE', 1)[0]
ast.parse(code)
assert steps[0]['with']['ref'] in code, 'checkout ref and pinned SOURCE agree'
assert set(steps[-1]['env']) == {'STAGE', 'CONFIRM', 'SUPABASE_DB_PASSWORD', 'SUPABASE_POOLER_HOST', 'SUPABASE_ACCESS_TOKEN'}
print('PASS: dispatch-only, main-only, protected environment, pinned actions and source')

MUTATORS = ('apply', 'repair', 'deploy', 'configure', 'rollback_secrets', 'rollback_functions', 'rollback_migration')


def check_migration_order(m):
    for version, latest in ((m.VERSION, m.VERSION), (m.VERSION, '99991231235959'), ('20261013120000', m.LATEST)):
        for stage in ('apply-migration', 'record-history', 'deploy-functions', 'configure-secrets',
                      'rollback-secrets', 'rollback-functions', 'rollback-migration'):
            with contextlib.ExitStack() as checks:
                checks.enter_context(patch.object(m, 'VERSION', version))
                checks.enter_context(patch.object(m, 'LATEST', latest))
                checks.enter_context(patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/main', 'STAGE': stage, 'CONFIRM': stage}))
                untouched = [checks.enter_context(patch.object(m, name)) for name in
                             ('files_gate', 'connection_env', 'identity', 'command') + MUTATORS]
                try:
                    m.main()
                except m.Stop as error:
                    assert str(error) == 'migration version follows hosted head'
                else:
                    raise AssertionError('equal/older migration version accepted')
                for call in untouched:
                    call.assert_not_called()
    for ref, stage, confirm in (('refs/heads/feature', 'check', 'check'), ('refs/heads/main', 'apply-migration', 'check'),
                                ('refs/heads/main', 'drop-everything', 'drop-everything')):
        with patch.dict(os.environ, {'GITHUB_REF': ref, 'STAGE': stage, 'CONFIRM': confirm}), \
             patch.object(m, 'files_gate') as files:
            try:
                m.main()
            except m.Stop:
                files.assert_not_called()
            else:
                raise AssertionError('non-main, unconfirmed or unknown stage accepted')
    m.migration_order_gate()
    print('PASS: twenty-one migration-order refusals, branch / confirmation / unknown-stage refusals')


os.chdir(SOURCE)
assert (SOURCE / 'previous-source').is_dir(), 'check out the previous source (27c8d0d) at <source>/previous-source'
with tempfile.TemporaryDirectory() as folder:
    module_path = Path(folder) / 'runner.py'
    module_path.write_text(code)
    spec = importlib.util.spec_from_file_location('runner', module_path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    check_migration_order(m)
    m.files_gate()
    m.previous_gate()
    local = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'SUPABASE_'))} | {
        'PGHOST': HOST, 'PGPORT': PORT, 'PGUSER': 'postgres', 'PGDATABASE': 'postgres', 'PGPASSWORD': PASSWORD,
        'PGSSLMODE': 'disable', 'PGCONNECT_TIMEOUT': '5', 'PGAPPNAME': 'sheets-push-runner-synthetic-test'}
    assert m.REF not in json.dumps(local)

    def run(query, env=local):
        return m.command(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query], env)

    assert run('select version()').startswith('PostgreSQL 17.6 ')
    dbs = ['gs_push_runner_ok', 'gs_push_runner_lock', 'gs_push_runner_cancel']
    try:
        def setup(db):
            run(f'DROP DATABASE IF EXISTS {db} WITH (FORCE)')
            run(f'CREATE DATABASE {db}')
            env = local | {'PGDATABASE': db}
            m.command(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/tests/google_sheets_harness.sql'], env, timeout=120)
            m.command(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f',
                       'supabase/migrations/20261022062539_google_sheets_import_foundation.sql'], env, timeout=120)
            run(f"""CREATE SCHEMA supabase_migrations;
              CREATE TABLE supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
              INSERT INTO supabase_migrations.schema_migrations(version, name)
                SELECT (20000101000000 + n)::text, 'synthetic' FROM generate_series(1, {m.HISTORY - 1}) n;
              INSERT INTO supabase_migrations.schema_migrations VALUES ('{m.LATEST}', '{{}}', 'synthetic_latest');
              CREATE SCHEMA cron; CREATE TABLE cron.job(jobname text, command text);
              INSERT INTO cron.job VALUES ('uv-profile-sync-every-minute', 'select 1');
              INSERT INTO public.organizations (id, name, status) VALUES ('a0000000-0000-0000-0000-0000000000d1', 'Gate D Org', 'active');
              INSERT INTO public.profiles (id, organization_id, role, status)
                VALUES ('d1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', 'Agent', 'Active');
              DO $$ DECLARE u uuid := 'd1000000-0000-0000-0000-000000000001'; o uuid := 'a0000000-0000-0000-0000-0000000000d1';
                g bigint; s record; BEGIN
                SELECT x.auth_generation INTO g FROM public.google_sheets_store_connection(u, o, 0, 'sub-d', 'd@example.test',
                  ARRAY['openid','email','https://www.googleapis.com/auth/drive.file'], 'rt-d') x;
                SELECT * INTO s FROM public.google_sheets_save_source(u, o, NULL, NULL, jsonb_build_object('spreadsheet_id', 'SPREADSHEET_GATE_D',
                  'sheet_id', 0, 'display_name', 'Pilot', 'mapping', '{{"v":1}}'::jsonb));
                PERFORM public.google_sheets_activate(u, o, s.source_id, s.config_version, g, '[]', 0); END $$;""", env)
            return env

        EXPECTED = m.expected

        def local_expected(stage, db):
            return EXPECTED(stage).replace('postgres|', db + '|', 1)

        good = setup(dbs[0])
        assert m.state(good) == local_expected('before', dbs[0])
        assert m.sql(m.FUNCTION_DIGEST, good) == m.FUNCTIONS_PRE, 'the synthetic preimage reproduces the production preimage'
        data = m.data_fingerprint(good)
        assert data.startswith('1|1|0|0|'), data
        m.operations_gate(good, False, False)
        m.apply(good)
        assert m.state(good) == local_expected('applied', dbs[0])
        assert m.data_fingerprint(good) == data, 'existing Sheets records unchanged by the migration'
        m.readbacks(good)
        m.operations_gate(good, True, False)
        url = f"postgresql://postgres:{PASSWORD}@{HOST}:{PORT}/{dbs[0]}?sslmode=disable"
        with patch.object(m, 'db_url', return_value=url), patch.object(m, 'expected', side_effect=lambda k: local_expected(k, dbs[0])):
            m.repair(good)  # real CLI: history state and the exact 57-statement read-back
        assert m.state(good) == local_expected('recorded', dbs[0])
        try:
            m.apply(good)
        except m.Stop:
            pass
        else:
            raise AssertionError('migration replay was not refused')
        assert m.state(good) == local_expected('recorded', dbs[0])
        print('PASS: real apply (data unchanged), all read-backs, real CLI history repair (57 statements), replay refusal')

        # A Sheets cron job or a premature Vault token fails the operations gate.
        run("INSERT INTO cron.job VALUES ('google-sheets-push-maintenance-every-minute', 'select 1')", good)
        try:
            m.operations_gate(good, True, False)
        except m.Stop as error:
            assert 'cron' in str(error)
        else:
            raise AssertionError('Sheets cron job not detected')
        run("DELETE FROM cron.job WHERE jobname LIKE 'google-sheets%'", good)
        run("UPDATE private.google_sheets_push_config SET mode = 'pilot'", good)
        try:
            m.operations_gate(good, True, False)
        except m.Stop as error:
            assert 'mode off' in str(error)
        else:
            raise AssertionError('push mode not off was accepted')
        run("UPDATE private.google_sheets_push_config SET mode = 'off'", good)
        print('PASS: operations gate refuses a Sheets cron job and a non-off push mode')

        locked = setup(dbs[1])
        marker = Path(folder) / 'lock-acquired'
        blocker = subprocess.Popen(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], env=locked, stdin=subprocess.PIPE,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
        blocker.stdin.write(f"BEGIN; LOCK TABLE public.google_sheets_sync_runs IN ACCESS EXCLUSIVE MODE;\\! touch {marker}\nSELECT pg_sleep(12); ROLLBACK;\n")
        blocker.stdin.close()
        for _ in range(100):
            if marker.exists():
                break
            time.sleep(.1)
        assert marker.exists(), 'failed to establish local lock'
        try:
            m.apply(locked)
        except m.Stop:
            pass
        else:
            raise AssertionError('lock wait did not refuse apply')
        blocker.wait(timeout=20)
        assert m.state(locked) == local_expected('before', dbs[1])
        print('PASS: real lock-timeout rollback (nothing left behind)')

        cancelled = setup(dbs[2])
        marker.unlink()
        blocker = subprocess.Popen(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], env=cancelled, stdin=subprocess.PIPE,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
        blocker.stdin.write(f"BEGIN; LOCK TABLE public.google_sheets_sync_runs IN ACCESS EXCLUSIVE MODE;\\! touch {marker}\nSELECT pg_sleep(8); ROLLBACK;\n")
        blocker.stdin.close()
        for _ in range(100):
            if marker.exists():
                break
            time.sleep(.1)
        assert marker.exists()
        original_wait = subprocess.Popen.wait

        def short_wait(self, timeout=None):
            return original_wait(self, timeout=1 if timeout == 120 else timeout)
        with patch.object(subprocess.Popen, 'wait', short_wait):
            try:
                m.apply(cancelled)
            except m.Stop:
                pass
            else:
                raise AssertionError('watchdog did not cancel')
        blocker.wait(timeout=15)
        assert m.state(cancelled) == local_expected('before', dbs[2])
        print('PASS: real watchdog SIGINT rollback')

        # Stage machine: every out-of-order or inconsistent state stops before any mutating call.
        CLI = ['2.121.0', '--db-url', '--project-ref --no-verify-jwt --use-api']
        PUSH_FNS = {name: {'version': 1} for name in m.NEW_FUNCTIONS}

        def drive(stage, state_key, functions, secret_set, expect):
            names = set(m.B1_SECRETS) | secret_set
            with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/main', 'STAGE': stage, 'CONFIRM': stage}), \
                 patch.object(m, 'files_gate'), patch.object(m, 'connection_env', return_value=good), patch.object(m, 'identity'), \
                 patch.object(m, 'command', side_effect=list(CLI)), patch.object(m, 'management', return_value=[{'name': n} for n in names]), \
                 patch.object(m, 'inventory', return_value=dict(functions)), patch.object(m, 'state', return_value=m.expected(state_key)), \
                 patch.object(m, 'sql', return_value=m.FUNCTIONS_PRE if state_key == 'before' else m.FUNCTIONS_POST), \
                 patch.object(m, 'data_fingerprint', return_value='x'), patch.object(m, 'operations_gate'), patch.object(m, 'readbacks'), \
                 contextlib.ExitStack() as stack:
                mutators = {name: stack.enter_context(patch.object(m, name)) for name in MUTATORS}
                try:
                    m.main()
                except m.Stop as error:
                    assert str(error) == expect, (stage, state_key, str(error))
                else:
                    raise AssertionError(f'{stage} accepted in {state_key}')
                for call in mutators.values():
                    call.assert_not_called()

        wrong_order = 'stage order and exact production state'
        configured = (PUSH_FNS, set(m.PUSH_SECRETS))
        for stage, cases in {
            'rollback-secrets': [('before', {}, set()), ('applied', {}, set()), ('recorded', {}, set()), ('recorded', PUSH_FNS, set())],
            'rollback-functions': [('applied', {}, set()), ('recorded', {}, set()), ('recorded', *configured)],
            'rollback-migration': [('before', {}, set()), ('recorded', PUSH_FNS, set()), ('recorded', *configured)],
            'apply-migration': [('applied', {}, set()), ('recorded', {}, set()), ('recorded', PUSH_FNS, set()), ('recorded', PUSH_FNS, set(m.PUSH_SECRETS))],
            'record-history': [('before', {}, set()), ('recorded', {}, set()), ('recorded', PUSH_FNS, set())],
            'deploy-functions': [('before', {}, set()), ('applied', {}, set()), ('recorded', PUSH_FNS, set()), ('recorded', PUSH_FNS, set(m.PUSH_SECRETS))],
            'configure-secrets': [('before', {}, set()), ('applied', {}, set()), ('recorded', {}, set()), ('recorded', PUSH_FNS, set(m.PUSH_SECRETS))],
        }.items():
            for state_key, functions, secret_set in cases:
                drive(stage, state_key, functions, secret_set, wrong_order)
        drive('check', 'recorded', {}, {m.KILL_SWITCH}, 'GOOGLE_SHEETS_PUSH_ENABLED absent (real-time sync off)')
        drive('check', 'recorded', {m.NEW_FUNCTIONS[0]: {}}, set(), 'push functions all present or all absent')
        drive('check', 'recorded', PUSH_FNS, {m.PUSH_SECRETS[0]}, 'push secrets all present or all absent')
        drive('check', 'applied', PUSH_FNS, set(), 'functions deployed only after the recorded migration')
        drive('check', 'recorded', {}, set(m.PUSH_SECRETS), 'secrets configured only after deployment')
        drive('check', 'reverted-recorded', PUSH_FNS, set(), 'functions deployed only after the recorded migration')
        print('PASS: twenty-five out-of-order stage refusals and six inconsistent-state refusals, no mutation')

        # deploy(): exactly three functions, never with push secrets present, unrelated inventory pinned.
        os.environ['SUPABASE_ACCESS_TOKEN'] = 'synthetic-not-a-token'
        unrelated = {'google-sheets-sync-worker': {'version': 6, 'verify_jwt': False, 'status': 'ACTIVE', 'ezbr_sha256': 'w'},
                     'twilio-sms': {'version': 56, 'verify_jwt': False, 'status': 'ACTIVE', 'ezbr_sha256': 't'}}
        before = unrelated | {'google-sheets-api': {'version': 6}}
        after = unrelated | {name: {'status': 'ACTIVE', 'verify_jwt': False, 'version': 7 if name == 'google-sheets-api' else 1} for name in m.BUNDLES}
        calls = []
        with patch.object(m, 'command', side_effect=lambda args, *a, **k: calls.append(args) or ''), \
             patch.object(m, 'secret_names', return_value=set(m.B1_SECRETS)), patch.object(m, 'inventory', return_value=after), \
             patch.object(m, 'http_checks') as http:
            m.deploy(before)
        assert [c[3] for c in calls] == list(m.BUNDLES) and all(c[4:] == ['--project-ref', m.REF, '--no-verify-jwt', '--use-api'] for c in calls)
        http.assert_called_once_with(configured=False)
        changed = after | {'twilio-sms': unrelated['twilio-sms'] | {'version': 57}}
        with patch.object(m, 'command', return_value=''), patch.object(m, 'secret_names', return_value=set(m.B1_SECRETS)), \
             patch.object(m, 'inventory', return_value=changed), patch.object(m, 'http_checks'):
            try:
                m.deploy(before)
            except m.Stop as error:
                assert 'unrelated' in str(error)
            else:
                raise AssertionError('changed unrelated function accepted')
        with patch.object(m, 'command') as cli, patch.object(m, 'secret_names', return_value=set(m.B1_SECRETS) | set(m.PUSH_SECRETS)):
            try:
                m.deploy(before)
            except m.Stop as error:
                assert 'push secrets absent' in str(error)
            else:
                raise AssertionError('deploy with push secrets present accepted')
            cli.assert_not_called()
        print('PASS: deploy = the three bundles with --no-verify-jwt; unrelated drift and premature secrets refused')

        # http_checks(): exact statuses before and after the secrets; only the receiver probe carries the dummy token.
        class FakeResponse(io.BytesIO):
            def __init__(self, status, body):
                super().__init__(json.dumps(body).encode() if body is not None else b'')
                self.status = status

        def fake_opener(configured, seen):
            def open_(request, timeout):
                fn, method = request.full_url.rsplit('/', 1)[1], request.get_method()
                seen.append((fn, method, request.get_header('X-goog-channel-token')))
                return {('google-sheets-push', 'GET'): FakeResponse(405, None),
                        ('google-sheets-push', 'POST'): FakeResponse(400 if configured else 503, None),
                        ('google-sheets-push-maintenance', 'POST'): FakeResponse(403, {'error': 'unauthorized'}),
                        ('google-sheets-api', 'POST'): FakeResponse(401, {'error': 'unauthorized'})}[(fn, method)]
            return type('Opener', (), {'open': staticmethod(open_)})()
        for configured in (False, True):
            seen, out = [], io.StringIO()
            with patch.object(m.urllib.request, 'build_opener', return_value=fake_opener(configured, seen)), \
                 contextlib.redirect_stdout(out):
                m.http_checks(configured=configured)
            assert seen == [('google-sheets-push', 'GET', None), ('google-sheets-push', 'POST', m.LOG_PROBE),
                            ('google-sheets-push-maintenance', 'POST', None), ('google-sheets-api', 'POST', None)], seen
            lines = out.getvalue().splitlines()
            assert len(lines) == 6 and all(line.startswith('PASS: ') for line in lines), lines
            with patch.object(m.urllib.request, 'build_opener', return_value=fake_opener(not configured, [])):
                try:
                    m.http_checks(configured=configured)
                except m.Stop as error:
                    assert 'google-sheets-push POST' in str(error)
                else:
                    raise AssertionError('wrong receiver status accepted')
        print('PASS: http_checks = 405 / 503→400 / 403 / 401 with exact bodies; only the receiver probe carries the log marker')

        # configure(): values generated in-process, masked, stored, Vault verified by hash only; never printed.
        stored, out = [], io.StringIO()
        names = set(m.B1_SECRETS)

        def fake_management(path, method='GET', body=None):
            if method == 'POST':
                stored.extend(body)
                names.update(item['name'] for item in body)
                return 201
            return [{'name': n} for n in names]
        with patch.object(m, 'management', side_effect=fake_management), patch.object(m, 'http_checks') as http, \
             contextlib.redirect_stdout(out):
            m.configure(good)
        http.assert_called_once_with(configured=True)
        assert [s['name'] for s in stored] == list(m.PUSH_SECRETS) and all(len(s['value']) == 64 for s in stored)
        printed = [line for line in out.getvalue().splitlines() if not line.startswith('::add-mask::')]
        assert not any(s['value'] in line for s in stored for line in printed), 'a secret value reached the log'
        assert sum(line.startswith('::add-mask::') for line in out.getvalue().splitlines()) == 2
        m.operations_gate(good, True, True)
        print('PASS: configure stores two 64-char secrets, Vault verified by hash, values masked and never printed')

        # Rollbacks, in reverse order: secrets → functions → migration (real SQL, real Vault delete, real CLI).
        with patch.object(m, 'management', side_effect=lambda path, method='GET', body=None:
                          (names.difference_update(body) or 204) if method == 'DELETE' else [{'name': n} for n in names]), \
             patch.object(m, 'http_checks') as http:
            m.rollback_secrets(good)
        http.assert_called_once_with(configured=False)
        assert not (names & set(m.PUSH_SECRETS))
        m.operations_gate(good, True, False)
        calls = []
        rolled = unrelated | {'google-sheets-api': {'status': 'ACTIVE', 'verify_jwt': False, 'version': 8}}
        with patch.object(m, 'command', side_effect=lambda args, *a, **k: calls.append((args, k.get('cwd'))) or
                          (m.PREVIOUS if args[:2] == ['git', 'rev-parse'] else '')), \
             patch.object(m, 'inventory', return_value=rolled), patch.object(m, 'digest_of', return_value=m.PREVIOUS_API[2]):
            m.rollback_functions(after)
        deploys = [c for c in calls if c[0][:3] == ['supabase', 'functions', 'deploy']]
        deletes = [c[0][3] for c in calls if c[0][:3] == ['supabase', 'functions', 'delete']]
        assert deploys == [(['supabase', 'functions', 'deploy', 'google-sheets-api', '--project-ref', m.REF, '--no-verify-jwt', '--use-api'], m.PREVIOUS_DIR)]
        assert deletes == list(m.NEW_FUNCTIONS)
        with patch.object(m, 'db_url', return_value=url), patch.object(m, 'expected', side_effect=lambda k: local_expected(k, dbs[0])):
            m.rollback_migration(good, 'recorded')
            assert m.state(good) == local_expected('before', dbs[0]) and m.sql(m.FUNCTION_DIGEST, good) == m.FUNCTIONS_PRE
            m.operations_gate(good, False, False)
            # applied-only rollback, then an interrupted rollback (SQL done, history row left) resumed
            m.apply(good)
            m.rollback_migration(good, 'applied')
            assert m.state(good) == local_expected('before', dbs[0])
            m.apply(good)
            m.repair(good)
            m.apply(good, m.ROLLBACK)
            assert m.state(good) == local_expected('reverted-recorded', dbs[0])
            m.rollback_migration(good, 'reverted-recorded')
            assert m.state(good) == local_expected('before', dbs[0])
        assert m.data_fingerprint(good) == data, 'rollbacks never touch existing Sheets records'
        print('PASS: rollback-secrets, rollback-functions (previous v6 bundle, push functions deleted), rollback-migration '
              '(recorded, applied-only and interrupted) restore the exact preimage; data unchanged')

        with patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess(['x'], 1, 'SECRET_OUT', 'SECRET_ERR')):
            try:
                m.command(['x'])
            except m.Stop as error:
                assert 'SECRET' not in str(error)
            else:
                raise AssertionError('command failure not propagated')
        print('PASS: command error redaction')

        pooler = {'PGHOST': 'aws-0-us-east-1.pooler.supabase.com'}
        echo = f"{pooler['PGHOST']} 5432 postgres postgres.{m.REF}"
        connected = 'You are connected to database "postgres" as user "postgres" on host "h" at port "5432".'
        tls = connected + '\nSSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)'
        with patch.object(m, 'command', side_effect=[echo, tls]), patch.object(m, 'sql', return_value='postgres|postgres'):
            m.identity(pooler)
        with patch.object(m, 'command', side_effect=[echo, connected]), patch.object(m, 'sql', return_value='postgres|postgres'):
            try:
                m.identity(pooler)
            except m.Stop:
                pass
            else:
                raise AssertionError('plaintext connection accepted')
        print('PASS: identity requires TLS on the runner connection')

        try:
            m.sql('CREATE TABLE public.gs_push_runner_write_probe(i int)', good)
        except m.Stop:
            pass
        else:
            raise AssertionError('read-only check session accepted a write')
        assert m.sql("select current_setting('default_transaction_read_only') || '|' || current_setting('statement_timeout')", good) == 'on|30s'
        print('PASS: read-only check sessions with a 30 s statement timeout')
    finally:
        for db in dbs:
            run(f'DROP DATABASE IF EXISTS {db} WITH (FORCE)')
print('ALL PUSH RELEASE RUNNER CHECKS PASSED; no production access or deployment')
