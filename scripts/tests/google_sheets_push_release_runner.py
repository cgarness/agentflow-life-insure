"""Gate D release-runner verification: synthetic, disposable PostgreSQL on loopback ONLY.
No production credentials. Extracts the exact program embedded in .github/workflows/google-sheets-push-release.yml
and executes its gates, psql transaction, history repair (real Supabase CLI 2.121.0), Vault write and stage machine
against a local PostgreSQL 17.6 service. Management API and HTTP calls are replaced by fakes: at the opener level
for management() (status classification, redaction, failure read-back) and a loopback server for the redirect guard.
Env: RUNNER_PG (default 127.0.0.1:55435, password synthetic-runner-only), RUNNER_SOURCE (checkout of the pinned
SOURCE commit; default ./sheets-source), SUPABASE_BIN (default `supabase`).
"""
import ast
import contextlib
import email.message
import hashlib
from http.client import RemoteDisconnected
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
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
STAGES = ['check', 'apply-migration', 'record-history', 'deploy-functions', 'configure-secrets', 'recover-secrets',
          'rollback-secrets', 'rollback-functions', 'rollback-migration']
assert workflow.get('on', workflow.get(True))['workflow_dispatch']['inputs']['stage']['options'] == STAGES
print('PASS: dispatch-only, main-only, protected environment, pinned actions and source; nine dispatchable stages')

MUTATORS = ('apply', 'repair', 'deploy', 'configure', 'rollback_secrets', 'rollback_functions', 'rollback_migration')


def check_migration_order(m):
    for version, latest in ((m.VERSION, m.VERSION), (m.VERSION, '99991231235959'), ('20261013120000', m.LATEST)):
        for stage in STAGES[1:]:
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
    print('PASS: twenty-four migration-order refusals, branch / confirmation / unknown-stage refusals')


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

        # Stage machine: every out-of-order or inconsistent state stops before any mutating call; every accepted stage
        # calls exactly its one mutator. A state is (history, push functions, Edge push secret names, Vault copy).
        CLI = ['2.121.0', '--db-url', '--project-ref --no-verify-jwt --use-api']
        PUSH_FNS = {name: {'version': 1} for name in m.NEW_FUNCTIONS}
        KEY, TOKEN = m.PUSH_SECRETS
        BOTH = set(m.PUSH_SECRETS)

        def drive(stage, state_key, functions, secret_set, expect, vault=False, called=None):
            names = set(m.B1_SECRETS) | secret_set
            out = io.StringIO()
            with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/main', 'STAGE': stage, 'CONFIRM': stage}), \
                 patch.object(m, 'files_gate'), patch.object(m, 'connection_env', return_value=good), patch.object(m, 'identity'), \
                 patch.object(m, 'command', side_effect=list(CLI)), patch.object(m, 'management', return_value=[{'name': n} for n in names]), \
                 patch.object(m, 'inventory', return_value=dict(functions)), patch.object(m, 'state', return_value=m.expected(state_key)), \
                 patch.object(m, 'sql', return_value=m.FUNCTIONS_PRE if state_key == 'before' else m.FUNCTIONS_POST), \
                 patch.object(m, 'vault_token_rows', return_value=vault), \
                 patch.object(m, 'data_fingerprint', return_value='x'), patch.object(m, 'operations_gate') as gate, \
                 patch.object(m, 'readbacks'), contextlib.redirect_stdout(out), contextlib.ExitStack() as stack:
                mutators = {name: stack.enter_context(patch.object(m, name)) for name in MUTATORS}
                try:
                    m.main()
                except m.Stop as error:
                    assert expect is not None and str(error) == expect, (stage, state_key, secret_set, vault, str(error))
                else:
                    assert expect is None, f'{stage} accepted in {state_key} {secret_set} vault={vault}'
                for name, call in mutators.items():
                    if name == called:
                        call.assert_called_once()
                    else:
                        call.assert_not_called()
                return out.getvalue(), gate.call_args_list

        wrong_order = 'stage order and exact production state'
        partial_stop = 'partial push secret configuration; only recover-secrets or rollback-secrets may run'
        DEPLOYED = ('recorded', PUSH_FNS, set(), False)
        CONFIGURED = ('recorded', PUSH_FNS, BOTH, True)
        # Every incomplete credential set: one Edge secret, both without Vault, Vault alone, one Edge secret with Vault.
        PARTIAL = [('recorded', PUSH_FNS, {KEY}, False), ('recorded', PUSH_FNS, {TOKEN}, False), ('recorded', PUSH_FNS, BOTH, False),
                   ('recorded', PUSH_FNS, set(), True), ('recorded', PUSH_FNS, {KEY}, True), ('recorded', PUSH_FNS, {TOKEN}, True)]
        EARLY = [('before', {}, set(), False), ('applied', {}, set(), False), ('recorded', {}, set(), False)]
        refusals = 0
        for stage, cases in {
            'rollback-secrets': EARLY + [DEPLOYED],
            'rollback-functions': [EARLY[1], EARLY[2], CONFIGURED] + PARTIAL,
            'rollback-migration': [EARLY[0], DEPLOYED, CONFIGURED] + PARTIAL,
            'apply-migration': EARLY[1:] + [DEPLOYED, CONFIGURED] + PARTIAL,
            'record-history': [EARLY[0], EARLY[2], DEPLOYED, CONFIGURED] + PARTIAL,
            'deploy-functions': EARLY[:2] + [DEPLOYED, CONFIGURED] + PARTIAL,
            'configure-secrets': EARLY + [CONFIGURED] + PARTIAL,
            'recover-secrets': EARLY + [DEPLOYED, CONFIGURED],
        }.items():
            for state_key, functions, secret_set, vault in cases:
                drive(stage, state_key, functions, secret_set, wrong_order, vault)
                refusals += 1
        inconsistent = [('check', 'recorded', {}, {m.KILL_SWITCH}, 'GOOGLE_SHEETS_PUSH_ENABLED absent (real-time sync off)', False),
                        ('check', 'recorded', {m.NEW_FUNCTIONS[0]: {}}, set(), 'push functions all present or all absent', False),
                        ('check', 'applied', PUSH_FNS, set(), 'functions deployed only after the recorded migration', False),
                        ('check', 'recorded', {}, BOTH, 'secrets configured only after deployment', False),
                        ('check', 'recorded', {}, {KEY}, 'secrets configured only after deployment', False),
                        ('check', 'recorded', {}, set(), 'secrets configured only after deployment', True),
                        ('check', 'reverted-recorded', PUSH_FNS, set(), 'functions deployed only after the recorded migration', False),
                        ('recover-secrets', 'recorded', PUSH_FNS, BOTH | {m.KILL_SWITCH}, 'GOOGLE_SHEETS_PUSH_ENABLED absent (real-time sync off)', False)]
        for stage, state_key, functions, secret_set, expect, vault in inconsistent:
            drive(stage, state_key, functions, secret_set, expect, vault)
        print(f'PASS: {refusals} out-of-order stage refusals and {len(inconsistent)} inconsistent-state refusals, no mutation')

        # check: complete states pass (and repeat identically); each partial state is named (names only) and stops after
        # every read-back; the operations gate is asked for the Vault presence that matches the state.
        for case, label, vault_expect in ((DEPLOYED, 'deployed', False), (CONFIGURED, 'configured', True)):
            first = drive('check', *case[:3], None, case[3])
            assert f'STATE: {label}\n' in first[0] and drive('check', *case[:3], None, case[3]) == first, label
            assert [c.args[1:] for c in first[1]] == [(True, vault_expect)], first[1]
        for state_key, functions, secret_set, vault in PARTIAL:
            out, gates = drive('check', state_key, functions, secret_set, partial_stop, vault)
            detail = ' '.join([f"{n}={'present' if n in secret_set else 'absent'}" for n in m.PUSH_SECRETS] +
                              [f"vault={'present' if vault else 'absent'}"])
            assert f'STATE: partial ({detail})\n' in out, out
            assert [c.args[1:] for c in gates] == [(True, None)], gates
        # Accepted stages: configure only from nothing, recover only from a partial set, rollback from either.
        drive('configure-secrets', *DEPLOYED[:3], None, DEPLOYED[3], called='configure')
        for case in PARTIAL:
            drive('recover-secrets', *case[:3], None, case[3], called='configure')
            drive('rollback-secrets', *case[:3], None, case[3], called='rollback_secrets')
        drive('rollback-secrets', *CONFIGURED[:3], None, CONFIGURED[3], called='rollback_secrets')
        print(f'PASS: check names {len(PARTIAL)} partial states and stops; deployed/configured pass and repeat identically; '
              'configure only from deployed, recover only from partial, rollback-secrets from configured or partial')

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

        # management(): the real function over a fake opener. Every outcome maps to a fixed, sanitized label; nothing the
        # server or the network says (body, reason, URL, header, exception text) reaches the log or the error.
        SENTINEL = 'SENTINEL-server-text-must-not-print'

        class Raw(io.BytesIO):
            def __init__(self, status, body=b''):
                super().__init__(body)
                self.status = status

        def http_error(code, content_type='application/json'):
            headers = email.message.Message()
            headers['Content-Type'] = content_type + '; charset=utf-8'
            return urllib.error.HTTPError('https://api.supabase.com/' + SENTINEL, code, 'reason ' + SENTINEL, headers,
                                          io.BytesIO(json.dumps({'message': SENTINEL}).encode()))

        class Opener:
            def __init__(self, respond):
                self.respond, self.seen = respond, []

            def open(self, request, timeout):
                self.seen.append((request.get_method(), request.get_header('User-agent'), timeout))
                outcome = self.respond(request)
                if isinstance(outcome, BaseException):
                    raise outcome
                return outcome

        def opened(opener):
            def build_opener(*handlers):
                assert handlers == (m.NoRedirect,), 'management() must refuse redirects'
                return opener
            return patch.object(m.urllib.request, 'build_opener', side_effect=build_opener)

        def call(outcome, method='POST', body=None):
            opener, out = Opener(lambda request: outcome), io.StringIO()
            with opened(opener), contextlib.redirect_stdout(out):
                try:
                    result = m.management('secrets', method, body)
                except m.Stop as error:
                    result = error
            assert opener.seen == [(method, 'agentflow-sheets-push-release', 30)], opener.seen
            assert SENTINEL not in out.getvalue() + str(result), 'server or network text reached the log'
            return result

        hint = '; secrets writes need Edge Function Secrets read-write'
        post = [{'name': KEY, 'value': 'x' * 64}, {'name': TOKEN, 'value': 'y' * 64}]
        cases = [(Raw(201), 'POST', 201), (Raw(200), 'POST', 200),
                 (Raw(202), 'POST', 'Management API POST secrets: unexpected success status 202; write outcome unknown'),
                 (Raw(204), 'POST', 'Management API POST secrets: unexpected success status 204; write outcome unknown'),
                 (Raw(200), 'DELETE', 200), (Raw(204), 'DELETE', 204),
                 (Raw(202), 'DELETE', 'Management API DELETE secrets: unexpected success status 202; write outcome unknown'),
                 (Raw(200, b'[{"name": "A", "value": "d"}]'), 'GET', [{'name': 'A', 'value': 'd'}]),
                 (Raw(200, ('<html>' + SENTINEL + '</html>').encode()), 'GET', 'Management API GET secrets: unexpected response format'),
                 (Raw(204), 'GET', 'Management API GET secrets: unexpected success status 204'),
                 (http_error(403), 'GET', 'Management API GET secrets: HTTP 403 (permission failure; json response)'),
                 (http_error(400), 'POST', 'Management API POST secrets: HTTP 400 (invalid payload; json response)'),
                 (http_error(422), 'POST', 'Management API POST secrets: HTTP 422 (invalid payload; json response)'),
                 (http_error(401), 'POST', 'Management API POST secrets: HTTP 401 (API authentication failure; json response)'),
                 (http_error(403), 'POST', f'Management API POST secrets: HTTP 403 (permission failure; json response{hint})'),
                 (http_error(403, 'text/html'), 'POST', f'Management API POST secrets: HTTP 403 (permission failure; html response{hint})'),
                 (http_error(403), 'DELETE', f'Management API DELETE secrets: HTTP 403 (permission failure; json response{hint})'),
                 (http_error(404), 'POST', 'Management API POST secrets: HTTP 404 (not found; json response)'),
                 (http_error(409), 'POST', 'Management API POST secrets: HTTP 409 (conflict; json response)'),
                 (http_error(429, 'text/plain'), 'POST', 'Management API POST secrets: HTTP 429 (rate limited; text response)'),
                 (http_error(500), 'POST', 'Management API POST secrets: HTTP 500 (server error; json response)'),
                 (http_error(503, 'application/octet-stream'), 'POST', 'Management API POST secrets: HTTP 503 (server error; other response)'),
                 (http_error(418), 'POST', 'Management API POST secrets: HTTP 418 (unexpected response status; json response)'),
                 (http_error(302), 'POST', 'Management API POST secrets: HTTP 302 (unexpected redirect; json response)'),
                 (TimeoutError(SENTINEL), 'POST', 'Management API POST secrets: network timeout'),
                 (urllib.error.URLError(TimeoutError(SENTINEL)), 'POST', 'Management API POST secrets: network timeout'),
                 (urllib.error.URLError(SENTINEL), 'POST', 'Management API POST secrets: network failure'),
                 (ConnectionResetError(SENTINEL), 'POST', 'Management API POST secrets: network failure'),
                 (RemoteDisconnected(SENTINEL), 'POST', 'Management API POST secrets: network failure')]
        for outcome, method, expect in cases:
            result = call(outcome, method, post if method == 'POST' else [KEY] if method == 'DELETE' else None)
            got = str(result) if isinstance(result, m.Stop) else result
            assert got == expect, (method, got, expect)
        with opened(Opener(lambda request: Raw(200, json.dumps({'name': KEY}).encode()))):
            try:
                m.secret_inventory()
            except m.Stop as error:
                assert str(error) == 'secret inventory response'
            else:
                raise AssertionError('non-list secret inventory accepted')
        with opened(Opener(lambda request: Raw(200, json.dumps([{'name': KEY, 'value': 'd1'}, {'name': TOKEN}]).encode()))), \
             contextlib.redirect_stdout(io.StringIO()):
            assert m.secret_inventory() == {KEY: 'd1', TOKEN: ''}
        print(f'PASS: management() maps {len(cases)} outcomes (201/200/2xx, 3xx, 400-429, 5xx, timeouts, network) to sanitized '
              'labels with no server text; User-Agent set; 30 s timeout')

        # The redirect guard itself, against a real loopback server: a 302 on POST is refused, never replayed as a GET.
        # Negative control: urllib's default opener does replay it as a GET and reports 200 (the latent bug).
        hits = []

        class Redirecting(BaseHTTPRequestHandler):
            def do_POST(self):
                hits.append(('POST', self.path))
                self.send_response(302)
                self.send_header('Location', '/landed')
                self.send_header('Content-Length', '0')
                self.end_headers()

            def do_GET(self):
                hits.append(('GET', self.path))
                self.send_response(200)
                self.send_header('Content-Length', '2')
                self.end_headers()
                self.wfile.write(b'[]')

            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Redirecting)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            redirect_url = f'http://127.0.0.1:{server.server_address[1]}/v1/secrets'
            direct = urllib.request.ProxyHandler({})
            try:
                urllib.request.build_opener(direct, m.NoRedirect).open(urllib.request.Request(redirect_url, data=b'[]', method='POST'), timeout=5)
            except urllib.error.HTTPError as error:
                assert error.code == 302
            else:
                raise AssertionError('redirect followed')
            assert hits == [('POST', '/v1/secrets')], hits
            hits.clear()
            with urllib.request.build_opener(direct).open(urllib.request.Request(redirect_url, data=b'[]', method='POST'), timeout=5) as response:
                assert response.status == 200
            assert hits == [('POST', '/v1/secrets'), ('GET', '/landed')], hits
        finally:
            server.shutdown()
            server.server_close()
        print('PASS: NoRedirect refuses a 302 on POST (real loopback server); negative control: default urllib replays it as a GET')

        # configure() / recover / rollback-secrets on the real synthetic database (real Vault stand-in, real psql), with
        # the real management() over a fake Management API (name → digest). Every failure reads back what is stored.
        B1 = set(m.B1_SECRETS)

        class FakeApi:
            def __init__(self, names, post=None, delete=None, store_first=False, noop=False, get_fails_after_write=False):
                self.store = {name: 'digest-' + name for name in names}
                self.post, self.delete, self.store_first, self.noop = post, delete, store_first, noop
                self.get_fails_after_write, self.writes = get_fails_after_write, []

            def __call__(self, request):
                method = request.get_method()
                if method == 'GET':
                    if self.get_fails_after_write and self.writes:
                        return http_error(503)
                    return Raw(200, json.dumps([{'name': n, 'value': d} for n, d in self.store.items()]).encode())
                body = json.loads(request.data)
                self.writes.append((method, body))
                if method == 'POST':
                    if self.store_first:  # stored one secret, then failed
                        self.store[body[0]['name']] = hashlib.sha256(body[0]['value'].encode()).hexdigest()
                    if self.post is not None:
                        return self.post
                    if not self.noop:
                        self.store.update({i['name']: hashlib.sha256(i['value'].encode()).hexdigest() for i in body})
                    return Raw(201)
                if self.delete is not None:
                    return self.delete
                for name in body:
                    self.store.pop(name)
                return Raw(200)

        def run_secrets(fn, api, psql_fails_on=None):
            out, sent, real = io.StringIO(), [], m.command

            def command(args, env=None, timeout=30, stdin=None, cwd=None):
                if stdin is not None:
                    sent.append(stdin)
                    if psql_fails_on and psql_fails_on in stdin:
                        raise m.Stop('command failed; stop and inspect state independently; no automatic retry')
                return real(args, env, timeout, stdin, cwd)
            with opened(Opener(api)), patch.object(m, 'command', side_effect=command), patch.object(m, 'http_checks') as http, \
                 contextlib.redirect_stdout(out):
                try:
                    fn(good)
                    error = None
                except m.Stop as stop:
                    error = str(stop)
            text = out.getvalue()
            values = [item['value'] for method, body in api.writes if method == 'POST' for item in body]
            printed = [line for line in text.splitlines() if not line.startswith('::add-mask::')]
            assert not any(v in line for v in values for line in printed), 'a secret value reached the log'
            assert SENTINEL not in text
            for method, body in api.writes:  # real-time stays off: only the two push names are ever written
                assert (body if method == 'DELETE' else [i['name'] for i in body]) in (list(m.PUSH_SECRETS), sorted(m.PUSH_SECRETS),
                                                                                         [KEY], [TOKEN]), body
                assert m.KILL_SWITCH not in json.dumps(body)
            for stdin in sent:  # a value travels only as a \bind parameter, never in SQL statement text
                for v in values:
                    if v in stdin:
                        assert stdin.count(v) == 1 and v not in stdin.split('\\bind', 1)[0], 'a value in SQL statement text'
            return error, text, values, http

        def after_failure(names, vault):
            return 'SECRETS AFTER FAILURE: ' + m.secret_detail(names, vault) + '\n'

        def vault_digest():
            return run(f"select encode(sha256(convert_to(decrypted_secret, 'UTF8')), 'hex') from vault.decrypted_secrets "
                       f"where name = '{m.VAULT_TOKEN}'", good)

        def sha(value):
            return hashlib.sha256(value.encode()).hexdigest()

        # 1. configure-secrets refused or failed by the API: nothing stored is reported, nothing reaches Vault.
        failures = [(http_error(403), f'HTTP 403 (permission failure; json response{hint})'),
                    (http_error(403, 'text/html'), f'HTTP 403 (permission failure; html response{hint})'),
                    (http_error(400), 'HTTP 400 (invalid payload; json response)'),
                    (http_error(401), 'HTTP 401 (API authentication failure; json response)'),
                    (http_error(409), 'HTTP 409 (conflict; json response)'),
                    (http_error(429), 'HTTP 429 (rate limited; json response)'),
                    (http_error(500), 'HTTP 500 (server error; json response)'),
                    (TimeoutError(SENTINEL), 'network timeout'), (urllib.error.URLError(SENTINEL), 'network failure'),
                    (Raw(202), 'unexpected success status 202; write outcome unknown')]
        for outcome, label in failures:
            api = FakeApi(B1, post=outcome)
            error, text, values, http = run_secrets(m.configure, api)
            assert error == 'Management API POST secrets: ' + label, error
            assert after_failure(set(), False) in text and 'PASS: push secrets stored' not in text, text
            assert len(api.writes) == 1 and not m.vault_token_rows(good) and not http.called
            m.operations_gate(good, True, False)
        api = FakeApi(B1, post=http_error(500), get_fails_after_write=True)
        error, text, _, _ = run_secrets(m.configure, api)
        assert 'SECRETS AFTER FAILURE: unknown (read-back stopped: Management API GET secrets: HTTP 503 (server error; json response))' in text
        print(f'PASS: {len(failures)} configure-secrets failures (403 json/html, 400, 401, 409, 429, 500, timeout, network, 202) '
              'stop with the sanitized label, read back "nothing stored", write no Vault row; an unreadable read-back says unknown')

        # 2. configure-secrets success: two 64-char values, Vault verified by hash, masked, never printed.
        api = FakeApi(B1)
        error, text, values, http = run_secrets(m.configure, api)
        assert error is None and [i['name'] for i in api.writes[0][1]] == list(m.PUSH_SECRETS) and all(len(v) == 64 for v in values)
        http.assert_called_once_with(configured=True)
        assert sum(line.startswith('::add-mask::') for line in text.splitlines()) == 2
        assert 'INFO: platform digests equal SHA-256 of the stored values' in text and vault_digest() == sha(values[-1])
        m.operations_gate(good, True, True)
        print('PASS: configure stores two 64-char secrets, Vault (bind parameter) verified by hash, values masked and never printed')

        # 3. rollback-secrets: from configured, from each partial shape, and a refused DELETE (state left intact, reported).
        error, text, _, http = run_secrets(m.rollback_secrets, FakeApi(B1 | BOTH, delete=http_error(403)))
        assert error == f'Management API DELETE secrets: HTTP 403 (permission failure; json response{hint})'
        assert after_failure(BOTH, True) in text and m.vault_token_rows(good) and not http.called
        api = FakeApi(B1 | BOTH)
        error, text, _, http = run_secrets(m.rollback_secrets, api)
        assert error is None and api.writes == [('DELETE', sorted(m.PUSH_SECRETS))] and not m.vault_token_rows(good)
        http.assert_called_once_with(configured=False)
        m.operations_gate(good, True, False)
        run(f"select vault.create_secret('synthetic-stale-token', '{m.VAULT_TOKEN}', 'stale')", good)
        api = FakeApi(B1 | {TOKEN})
        assert run_secrets(m.rollback_secrets, api)[0] is None and api.writes == [('DELETE', [TOKEN])] and not m.vault_token_rows(good)
        run(f"select vault.create_secret('synthetic-stale-token', '{m.VAULT_TOKEN}', 'stale')", good)
        api = FakeApi(B1)
        assert run_secrets(m.rollback_secrets, api)[0] is None and api.writes == [] and not m.vault_token_rows(good)
        m.operations_gate(good, True, False)
        print('PASS: rollback-secrets deletes only what exists (configured, one secret + Vault, Vault alone); '
              'a refused DELETE leaves the set intact and says so')

        # 4. A write that stored one secret then failed → partial (named); recover-secrets replaces every copy.
        api = FakeApi(B1, post=http_error(500), store_first=True)
        error, text, _, _ = run_secrets(m.configure, api)
        assert error == 'Management API POST secrets: HTTP 500 (server error; json response)'
        assert after_failure({KEY}, False) in text and not m.vault_token_rows(good)
        old_key = api.store[KEY]
        api.post, api.store_first = None, False
        error, text, values, http = run_secrets(m.configure, api)  # recover-secrets from KEY only
        assert error is None and api.store[KEY] != old_key and api.store[KEY] == sha(values[-2]) and vault_digest() == sha(values[-1])
        http.assert_called_once_with(configured=True)
        m.operations_gate(good, True, True)
        # A stale Vault copy (TOKEN only + Vault): replaced, never reused.
        run(f"delete from vault.secrets where name = '{m.VAULT_TOKEN}'; "
            f"select vault.create_secret('synthetic-stale-token', '{m.VAULT_TOKEN}', 'stale')", good)
        api = FakeApi(B1 | {TOKEN})
        error, text, values, http = run_secrets(m.configure, api)
        assert error is None and vault_digest() == sha(values[-1]) != sha('synthetic-stale-token')
        assert run(f"select count(*) from vault.secrets where name = '{m.VAULT_TOKEN}'", good) == '1'
        print('PASS: a half-stored write reads back as partial; recover-secrets replaces all three copies '
              '(KEY only; TOKEN only with a stale Vault row) and Vault matches the new token')

        # 5. Every failure inside recovery leaves 'partial', never three names with mismatched values.
        api = FakeApi(B1 | BOTH)
        error, text, _, http = run_secrets(m.configure, api, psql_fails_on='vault.create_secret')  # Vault fails after Edge
        assert error == 'command failed; stop and inspect state independently; no automatic retry'
        assert after_failure(BOTH, False) in text and not m.vault_token_rows(good) and not http.called
        api = FakeApi(B1 | BOTH, noop=True)  # 201 but nothing changed (digests unchanged)
        error, text, _, http = run_secrets(m.configure, api)
        assert error == f'{KEY} replaced (platform digest changed)', error
        assert after_failure(BOTH, False) in text and not m.vault_token_rows(good) and not http.called
        api = FakeApi(B1 | BOTH, post=http_error(403))
        run(f"select vault.create_secret('synthetic-stale-token', '{m.VAULT_TOKEN}', 'stale')", good)
        error, text, _, _ = run_secrets(m.configure, api)  # a stale Vault copy is removed before the refused write
        assert error.startswith('Management API POST secrets: HTTP 403') and after_failure(BOTH, False) in text
        # Repeated execution: recover again, then everything is consistent; a second rollback is clean.
        api = FakeApi(B1 | BOTH)
        error, text, values, http = run_secrets(m.configure, api)
        assert error is None and vault_digest() == sha(values[-1])
        m.operations_gate(good, True, True)
        assert run_secrets(m.rollback_secrets, api)[0] is None and not api.store.keys() & BOTH
        m.operations_gate(good, True, False)
        print('PASS: Vault failure after the Edge write, a silent no-op (digest unchanged) and a refused write all leave '
              'partial (Vault absent); recover then rollback repeat cleanly; real-time stays off throughout')

        # Rollbacks, in reverse order: secrets (above) → functions → migration (real SQL, real CLI).
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
