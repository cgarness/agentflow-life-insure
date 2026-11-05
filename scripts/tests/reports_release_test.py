"""Protected Reports V2 (v3) release runner rehearsal: synthetic LOCAL PostgreSQL ONLY (17.6 for release evidence).

The production release script runs every stage in release order (PKG-A, B, C, D), the emergency switches and the
recovery stages against an isolated loopback TLS database built by scripts/reports_v3_fixture.py (the reviewed v2
state from verbatim sources, synthetic data only). The Supabase CLI on PATH receives a separate role that can write
ONLY the synthetic migration-history table. No production project, credential or data is used.

REPORTS_RELEASE_PGURL=postgresql://postgres:<password>@127.0.0.1:<port> (loopback superuser, TLS on). Release evidence
needs PostgreSQL 17.6 and Supabase CLI 2.121.0; REPORTS_RELEASE_DIAGNOSTIC=1 accepts another server version for a local
diagnostic run that is never release evidence.
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
RUNNER = ROOT / 'scripts/reports_release.py'
FIXTURE = ROOT / 'scripts/reports_v3_fixture.py'
WORKFLOW = ROOT / '.github/workflows/reports-release.yml'
CLI = shutil.which('supabase') or sys.exit('REFUSED: pinned Supabase CLI not installed')
DIAGNOSTIC = os.environ.get('REPORTS_RELEASE_DIAGNOSTIC') == '1'
URL = os.environ.get('REPORTS_RELEASE_PGURL', '')
parts = urllib.parse.urlsplit(URL)
if not (parts.scheme in ('postgres', 'postgresql') and parts.hostname in ('127.0.0.1', 'localhost')
        and parts.username == 'postgres' and parts.port and parts.path in ('', '/')):
    sys.exit('REFUSED: REPORTS_RELEASE_PGURL must be a LOCAL postgres superuser URL with an explicit port')
PASSWORD = urllib.parse.unquote(parts.password or '')
PORT = str(parts.port)
BASE_ENV = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'SUPABASE_', 'GITHUB_'))} | {
    'PGHOST': '127.0.0.1', 'PGPORT': PORT, 'PGUSER': 'postgres', 'PGSSLMODE': 'require', 'PGPASSWORD': PASSWORD}
PID = os.getpid()
DB = f'reports_release_{PID}'
ROLE = f'reports_release_{PID}_recorder'
ROLE_PASSWORD = hashlib.sha256(os.urandom(32)).hexdigest()[:32]
DB_ENV = BASE_ENV | {'PGDATABASE': DB}
HISTORY_ROWS, HISTORY_HEAD = 351, '20261105051037'  # synthetic rows; the head is the recorded production head
EXPECT = None  # set after the runner module loads

spec = importlib.util.spec_from_file_location('reports_release', RUNNER)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)
fspec = importlib.util.spec_from_file_location('reports_v3_fixture', FIXTURE)
fixture = importlib.util.module_from_spec(fspec)
fspec.loader.exec_module(fixture)
EXPECT = m.Expect(HISTORY_ROWS, HISTORY_HEAD)
PASSES = 0


def ok(label):
    global PASSES
    PASSES += 1
    print('PASS TEST: ' + label, flush=True)


def psql(query=None, database=DB, stdin=None, env=None):
    args = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', database]
    args += ['-f', '-'] if stdin is not None else ['-c', query]
    result = subprocess.run(args, env=env or BASE_ENV, input=stdin, capture_output=True, text=True, timeout=900)
    assert result.returncode == 0, 'local psql failed: ' + result.stderr.strip()[-900:]
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
    version = psql('show server_version', 'postgres')
    assert version.startswith('17.6') or DIAGNOSTIC, 'release evidence needs PostgreSQL 17.6'
    assert psql("select count(*) from pg_roles where rolname in ('authenticator','supabase_admin')", 'postgres') == '0'
    assert psql("select count(*) from pg_database where datname='jncvvsvckxhqgqvkppmj'", 'postgres') == '0'
    ok(f'local PostgreSQL {version.split()[0]} with TLS and no production connection'
       + ('' if version.startswith('17.6') else ' (DIAGNOSTIC: not release evidence)'))


# ── static gates ──────────────────────────────────────────────────────────────────────────────────────────────────

def test_workflow_and_guard():
    w = yaml.safe_load(WORKFLOW.read_text())
    trigger = w.get('on', w.get(True))
    assert list(trigger) == ['workflow_dispatch']
    assert w['permissions'] == {'contents': 'read'}
    assert w['concurrency'] == {'group': 'reports-release', 'cancel-in-progress': False}
    assert set(w['jobs']) == {'environment-guard', 'release'}
    opts = trigger['workflow_dispatch']['inputs']
    assert opts['stage']['type'] == 'choice' and opts['stage']['options'] == list(m.STAGES)
    assert opts['confirm']['required'] is True
    for job in w['jobs'].values():
        assert job['if'] == "github.ref == 'refs/heads/main'"
        assert job['steps'][0]['with'] == {'persist-credentials': False}
    assert w['jobs']['release']['environment'] == m.ENVIRONMENT
    assert w['jobs']['release']['needs'] == 'environment-guard'
    assert w['jobs']['release']['steps'][2]['with']['version'] == m.CLI_VERSION
    action = w['jobs']['release']['steps'][3]
    assert action['env'] == {
        'STAGE': '${{ inputs.stage }}', 'CONFIRM': '${{ inputs.confirm }}',
        'SUPABASE_DB_PASSWORD': '${{ secrets.SUPABASE_DB_PASSWORD }}',
        'SUPABASE_POOLER_HOST': '${{ secrets.SUPABASE_POOLER_HOST }}'}
    assert action['run'] == 'python3 -I scripts/reports_release.py run'
    text = '\n'.join(line for line in WORKFLOW.read_text().splitlines() if not line.lstrip().startswith('#'))
    for forbidden in ('db push', 'migration up', 'db reset', '--include-all', 'vercel', 'VITE_', 'SUPABASE_ACCESS_TOKEN'):
        assert forbidden not in text, forbidden
    assert re.findall(r'secrets\.([A-Za-z_]+)', text) == ['SUPABASE_DB_PASSWORD', 'SUPABASE_POOLER_HOST']
    ok('only manual dispatches on main; protected environment; only two scoped secrets; one choice per stage')
    reviewer = {'type': 'User', 'reviewer': {'login': 'cgarness'}}
    protected = {'name': m.ENVIRONMENT, 'can_admins_bypass': False,
                 'protection_rules': [{'type': 'required_reviewers', 'reviewers': [reviewer]}],
                 'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True}}
    branches = {'total_count': 1, 'branch_policies': [{'name': 'main', 'type': 'branch'}]}
    quiet(lambda: m.check_environment(protected, branches))
    for weakened in ({**protected, 'can_admins_bypass': True}, {**protected, 'protection_rules': []}):
        try:
            quiet(lambda: m.check_environment(weakened, branches))
        except m.Stop:
            continue
        raise AssertionError('environment guard allowed weakened protection')
    ok('required reviewer is cgarness; admin bypass and other refs forbidden')


def test_file_and_cli_gates():
    files, _ = quiet(lambda: m.files_gate(ROOT))
    assert len(files) == len(m.PINS) == 34
    assert files['supabase/ops/reports_v3_enable.sql'] == files[m.ITEMS[-1].path]
    for item in m.ITEMS:
        assert item.path in m.PINS, item.path
    quiet(lambda: m.cli_gate(CLI))
    ok('34 checksum-pinned files (every migration, release enable, ops script and rollback) and the pinned CLI')
    # Negative control only: a stand-in that reports another CLI version must be refused before any connection.
    drift = Path(tempfile.mkdtemp(prefix='reports-cli-drift-'))
    try:
        stub = drift / 'supabase'
        stub.write_text('#!/bin/sh\necho 2.120.0\n')
        stub.chmod(0o755)
        stops(lambda: m.cli_gate(str(stub)), f'pinned Supabase CLI {m.CLI_VERSION}')
    finally:
        shutil.rmtree(drift)
    ok('a different Supabase CLI version is refused (version drift)')
    root = Path(tempfile.mkdtemp(prefix='reports-gates-'))
    try:
        for p in m.PINS:
            (root / p).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / p, root / p)
        quiet(lambda: m.files_gate(root))
        target = m.ITEMS[7].path
        size, digest = m.PINS[target]
        (root / target).write_bytes(files[target] + b'\n')
        stops(lambda: m.files_gate(root), f'{target}: {size:,} bytes, SHA-256 {digest[:8]}…')
        (root / target).write_bytes(files[target])
        second = root / 'supabase/migrations/20261105120099_reports_v3_readers.sql'
        second.write_bytes(files[m.ITEMS[5].path])
        stops(lambda: m.files_gate(root), 'exactly one reports_v3_readers')
        second.unlink()
        pending = root / 'supabase/migrations/pending/20261105120015_reports_v3_readers.sql'
        pending.parent.mkdir(parents=True, exist_ok=True)
        pending.write_bytes(files[m.ITEMS[5].path])
        stops(lambda: m.files_gate(root), 'no pending Reports v3 copy')
    finally:
        shutil.rmtree(root)
    ok('file tampering, duplicate and pending copies fail before any connection')
    for stage, confirm, ref, label in [('apply-20261105120010', 'check', 'refs/heads/main', 'explicit stage confirmation'),
                                       ('check', 'check', 'refs/heads/feature', 'main dispatch only'),
                                       ('drop-everything', 'drop-everything', 'refs/heads/main', 'explicit stage confirmation')]:
        with patch.dict(os.environ, {'GITHUB_REF': ref, 'STAGE': stage, 'CONFIRM': confirm}):
            stops(lambda: m.main(['run']), label)
    ok('wrong confirmation, unknown stage and non-main branch refused')
    assert (m.PRODUCTION_ROWS_BEFORE, m.PRODUCTION_HEAD_BEFORE) == (356, '20261105051037')
    assert sorted(m.RECORDED) == sorted(i.version for i in m.ITEMS if i.version)
    assert all(c > 0 and re.fullmatch(r'[0-9a-f]{64}', d) for c, d in m.RECORDED.values())
    ok('the verified production history baseline (356 rows, head 20261105051037) and all 20 CLI digests are pinned')


# ── the disposable release database ────────────────────────────────────────────────────────────────────────────────

def fresh():
    psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)', 'postgres')
    psql(f'CREATE DATABASE {DB}', 'postgres')
    sql = ''.join('\\echo ' + label + '\nBEGIN;\n' + (s if isinstance(s, str) else s[1]) + '\nCOMMIT;\n'
                  for label, s in cut(list(fixture.steps()), 'production PR #515 v2 state'))
    psql(stdin=sql)
    # The two live sale handoffs …31 wraps, verbatim from their migration (…31 pins their definitions).
    tracking = (ROOT / 'supabase/migrations/20261019170000_policy_commission_tracking.sql').read_text()
    handoffs = []
    for header in ('CREATE FUNCTION public.record_client_policy_handoff(', 'CREATE FUNCTION public.convert_lead_to_client_with_sales_handoff('):
        a = tracking.index(header)
        handoffs.append(tracking[a:tracking.index('\nEND $$;', a) + len('\nEND $$;')])
    psql(stdin='BEGIN;\n' + fixture.appointment_dependencies() + '\n' + '\n'.join(handoffs) + f"""
SELECT public.seed_default_appointment_types(id) FROM (SELECT id FROM public.organizations ORDER BY id LIMIT 6) o;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (
    version text NOT NULL PRIMARY KEY, statements text[], name text,
    created_by text, idempotency_key text UNIQUE, rollback text[]);
-- {HISTORY_ROWS - 1} synthetic versions and a synthetic head, total {HISTORY_ROWS}; all below the Reports placeholders.
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 SELECT to_char(timestamp '2025-01-01'+g*interval '1 hour','YYYYMMDDHH24MISS'), 'synthetic_'||g, ARRAY['-- synthetic '||g]
   FROM generate_series(1,{HISTORY_ROWS - 1}) g;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('{HISTORY_HEAD}','synthetic_head',ARRAY['-- head']);
REVOKE ALL ON DATABASE {DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE {DB} TO {ROLE};
GRANT USAGE ON SCHEMA supabase_migrations TO {ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON supabase_migrations.schema_migrations TO {ROLE};
COMMIT;
""")
    if DIAGNOSTIC:
        # Older CLIs (the repository's 2.84.5) create the history schema and table if missing before a repair, which
        # needs CREATE on the database and ownership of the history objects. Diagnostic runs only; the 2.121.0 release
        # rehearsal keeps the history-only role.
        psql(f'GRANT CREATE ON DATABASE {DB} TO {ROLE}', 'postgres')
        psql(f'ALTER SCHEMA supabase_migrations OWNER TO {ROLE}; ALTER TABLE supabase_migrations.schema_migrations OWNER TO {ROLE}')
    assert psql("select md5(pg_get_functiondef('public.record_client_policy_handoff(uuid,uuid,jsonb,boolean,jsonb)'::regprocedure))") \
        == 'b02760be55132f0be3fa91b04955e839'


def cut(steps, until):
    i = next(k for k, (label, _) in enumerate(steps) if until in label)
    return steps[:i + 1]


def target():
    url = f'postgresql://{ROLE}:{urllib.parse.quote(ROLE_PASSWORD, safe="")}@127.0.0.1:{PORT}/{DB}?sslmode=require'
    return m.Target(DB_ENV, url)


def source_digest():
    return psql("""select md5((select coalesce(string_agg(c::text, E'\\n' order by id), '') from public.calls c)
        || (select coalesce(string_agg(w::text, E'\\n' order by id), '') from public.wins w)
        || (select coalesce(string_agg(k::text, E'\\n' order by id), '') from public.clients k))""")


def run(t, stage, files):
    return quiet(lambda: m.run_stage(stage, t, EXPECT, files, CLI))[0]


def record(t, files):
    """record-history with the pinned CLI digests: the stage records each file with the real CLI and must reproduce the
    pinned statement count and digest (a mismatch stops the stage)."""
    state, _ = quiet(lambda: m.classify(t, EXPECT))
    after = run(t, 'record-history', files)
    assert after.recorded == tuple(i.version for i in m.ITEMS[:state.applied] if i.version)
    return after


def test_release(files):
    fresh()
    t = target()
    before = source_digest()
    stops(lambda: m.classify(t, m.Expect(m.PRODUCTION_ROWS_BEFORE, m.PRODUCTION_HEAD_BEFORE)),
          'every other history row is the pinned baseline')
    ok('history that differs from the pinned production baseline (356 rows, head 20261105051037) refuses every stage')
    assert run(t, 'check', files).applied == 0
    stops(lambda: m.run_stage('record-history', t, EXPECT, files, CLI), 'record-history needs installed, unrecorded files')
    stops(lambda: m.run_stage('apply-20261105120011', t, EXPECT, files, CLI), 'apply-20261105120011 is the next stage in release order')
    stops(lambda: m.run_stage('read-back', t, EXPECT, files, CLI), 'read-back needs Reports v3 enabled')
    ok('check (preflight) is read-only; out-of-order, read-back and record-history refuse before PKG-A')

    # PKG-A
    for item in m.ITEMS[:6]:
        assert run(t, item.stage, files).applied == m.ITEMS.index(item) + 1
    stops(lambda: m.run_stage('apply-enable-20261105120017', t, EXPECT, files, CLI),
          'apply-enable-20261105120017 is the next stage in release order')
    assert run(t, 'apply-index-concurrently', files).applied == 7
    assert run(t, 'apply-enable-20261105120017', files).enabled
    run(t, 'read-back', files)
    assert run(t, 'check', files).enabled
    stops(lambda: m.run_stage('apply-20261105120010', t, EXPECT, files, CLI), 'apply-20261105120010 is the next stage in release order')
    stops(lambda: m.run_stage('apply-20261105120020', t, EXPECT, files, CLI),
          'the previous package is recorded in history before the next package starts')
    assert len(record(t, files).recorded) == 8
    ok('PKG-A: six transactional files, the concurrent index, the enable, read-back and 8 history rows')

    # PKG-B (the v3-only window)
    stops(lambda: m.run_stage('apply-20261105120020', t, EXPECT, files, CLI),
          'apply-20261105120020 runs inside the v3-only window (disable-v3 first)')
    assert not run(t, 'disable-v3', files).enabled
    for stage in ('apply-20261105120020', 'apply-20261105120021', 'apply-enable-20261105120022'):
        run(t, stage, files)
    run(t, 'read-back', files)
    assert len(record(t, files).recorded) == 11
    ok('PKG-B: disable-v3, …20, …21, the PKG-B enable, read-back, history')

    # PKG-C (…30 and …31 with Reports v3 on; …32 in the window)
    for stage in ('apply-20261105120030', 'apply-20261105120031'):
        assert run(t, stage, files).enabled
    stops(lambda: m.run_stage('apply-20261105120032', t, EXPECT, files, CLI),
          'apply-20261105120032 runs inside the v3-only window (disable-v3 first)')
    run(t, 'disable-v3', files)
    for stage in ('apply-20261105120032', 'apply-enable-20261105120033'):
        run(t, stage, files)
    assert len(record(t, files).recorded) == 15
    ok('PKG-C: …30, …31, disable-v3, …32, the PKG-C enable, read-back, history')

    # PKG-D (the category baseline between …40 and …41)
    run(t, 'apply-20261105120040', files)
    stops(lambda: m.run_stage('apply-20261105120041', t, EXPECT, files, CLI), 'apply-20261105120041 is the next stage in release order')
    run(t, 'category-baseline', files)
    for stage in ('apply-20261105120041', 'apply-20261105120042'):
        run(t, stage, files)
    run(t, 'disable-v3', files)
    for stage in ('apply-20261105120043', 'apply-enable-20261105120044'):
        run(t, stage, files)
    final = record(t, files)
    assert len(final.recorded) == 20 and final.contract == '3.3.0' and final.applied == len(m.ITEMS)
    assert psql('select count(*) from supabase_migrations.schema_migrations') == str(HISTORY_ROWS + 20)
    assert source_digest() == before
    ok('PKG-D: …40, the 36-row baseline, …41, …42, disable-v3, …43, the PKG-D enable, read-back, 20 history rows; '
       'calls, sales and clients unchanged')

    # Emergency switches and re-enable.
    assert not run(t, 'disable-all', files).enabled
    assert psql("select count(*) from pg_proc where proname like 'get\\_report\\_%' and has_function_privilege('authenticated', oid, 'EXECUTE')") == '0'
    assert psql("select has_function_privilege('authenticated', 'public.record_appointment_outcome(uuid,uuid,timestamptz,text)', 'EXECUTE')") == 't'
    assert run(t, 're-enable', files).enabled
    stops(lambda: m.run_stage('re-enable', t, EXPECT, files, CLI),
          're-enable needs Reports v3 off and its package release enable already applied')
    ok('disable-all leaves class W on; re-enable restores the PKG-D pins and passes read-back')

    # Recovery: the guarded rollbacks in reverse order, with history reverted.
    stops(lambda: m.run_stage('rollback-20261105120043', t, EXPECT, files, CLI),
          'rollback-20261105120043 needs Reports v3 disabled (disable-v3 first)')
    run(t, 'disable-v3', files)
    stops(lambda: m.run_stage('rollback-20261105120041', t, EXPECT, files, CLI),
          'rollback-20261105120041 needs 20261105120041 to be the last installed file of its package')
    for stage in ('rollback-20261105120043', 'rollback-20261105120042', 'rollback-20261105120041'):
        run(t, stage, files)
    stops(lambda: m.run_stage('rollback-20261105120040', t, EXPECT, files, CLI),
          'rollback-20261105120040 needs 20261105120040 to be the last installed file of its package')
    run(t, 'category-baseline-revert', files)
    run(t, 'rollback-20261105120040', files)
    after_d = run(t, 'rollback-20261105120032', files)
    assert after_d.contract == '3.1.0'
    run(t, 'rollback-20261105120031', files)
    stops(lambda: m.run_stage('rollback-20261105120020', t, EXPECT, files, CLI),
          'rollback-20261105120020 needs 20261105120020 to be the last installed file of its package')
    state = quiet(lambda: m.classify(t, EXPECT))[0]
    assert state.applied == m.ITEMS.index(next(i for i in m.ITEMS if i.version == '20261105120031'))
    assert len(state.recorded) == 12  # PKG-A, PKG-B and …30 stay recorded
    assert run(t, 're-enable', files).enabled
    assert source_digest() == before
    ok('recovery: D, C (…32, …31) rolled back in reverse order with history reverted; …30 has no rollback, so PKG-B '
       'cannot roll back past it; re-enable at the PKG-B pins passes read-back')

    psql("insert into supabase_migrations.schema_migrations(version,name) values ('20261104999999','unreviewed')")
    stops(lambda: m.classify(t, EXPECT), 'every other history row is the pinned baseline')
    ok('history drift stops every further stage')


def main():
    prove_local()
    psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)', 'postgres')
    psql(f'DROP ROLE IF EXISTS {ROLE}', 'postgres')
    psql(f"CREATE ROLE {ROLE} LOGIN PASSWORD '{ROLE_PASSWORD}'", 'postgres')
    try:
        test_workflow_and_guard()
        test_file_and_cli_gates()
        files, _ = quiet(lambda: m.files_gate(ROOT))
        test_release(files)
        print(f'ALL PASSED: {PASSES} release rehearsal checks', flush=True)
    finally:
        psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)', 'postgres')
        psql(f'DROP ROLE IF EXISTS {ROLE}', 'postgres')


if __name__ == '__main__':
    main()
