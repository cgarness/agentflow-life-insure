"""Hierarchy M3 history runner verification: a DISPOSABLE loopback PostgreSQL and synthetic data ONLY.

Drives the exact runner (scripts/hierarchy_m3_history_record.py) against a synthetic copy of
supabase_migrations.schema_migrations (production's columns and constraints, 345 rows, M1 and M2 with their real
bytes) and a minimal hierarchy stand-in, with the REAL pinned Supabase CLI for the one write. The CLI connects as a
role that may only read and write the history table, so executing any of M3's SQL would fail. No production
credential, host or environment is used.

Usage: HIER_HISTORY_PGURL=postgresql://postgres[:password]@127.0.0.1:<port> \
       python3 -I scripts/tests/hierarchy_m3_history_record_test.py
The CLI is `supabase` on PATH, or HIER_HISTORY_CLI. Needs PyYAML. Creates and drops only database
hier_m3hist_<pid> and role hier_m3hist_<pid>_recorder.
"""
import ast
import contextlib
import dataclasses
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
RUNNER = ROOT / 'scripts' / 'hierarchy_m3_history_record.py'
WORKFLOW = ROOT / '.github' / 'workflows' / 'hierarchy-m3-history.yml'
M1 = ROOT / 'supabase/migrations/20261023210027_hierarchy_authorization_boundaries.sql'
M2 = ROOT / 'supabase/migrations/20261023232435_hierarchy_integrity.sql'
CHECKOUT = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'
SETUP_CLI = 'supabase/setup-cli@3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf'

spec = importlib.util.spec_from_file_location('hierarchy_m3_history_record', RUNNER)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

PASSES = 0


def ok(label):
    global PASSES
    PASSES += 1
    print(f'   PASS {label}', flush=True)


def stops(fn, expected):
    """fn must raise the runner's Stop with exactly this label (its PASS lines are captured, not printed)."""
    with contextlib.redirect_stdout(io.StringIO()):
        try:
            fn()
        except m.Stop as error:
            assert str(error) == expected, f'expected STOP {expected!r}, got {str(error)!r}'
            return
    raise AssertionError(f'expected STOP {expected!r}; the runner continued')


def quiet(fn):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        result = fn()
    return result, out.getvalue()


# ── locality proof (invariant #28: destructive statements only on a proven-local stack) ──────────────────────────
URL = os.environ.get('HIER_HISTORY_PGURL', '')
parts = urllib.parse.urlsplit(URL)
if not (parts.scheme in ('postgres', 'postgresql') and parts.hostname in ('127.0.0.1', 'localhost')
        and parts.username == 'postgres' and parts.port and parts.path in ('', '/')):
    sys.exit('REFUSED: HIER_HISTORY_PGURL must be postgresql://postgres[:password]@127.0.0.1:<port>')
PORT = parts.port
PASSWORD = urllib.parse.unquote(parts.password or '')
CLI = os.environ.get('HIER_HISTORY_CLI') or shutil.which('supabase') or sys.exit('REFUSED: no supabase CLI')
BASE_ENV = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'SUPABASE_', 'GITHUB_'))} | {
    'PGHOST': '127.0.0.1', 'PGPORT': str(PORT), 'PGUSER': 'postgres', 'PGSSLMODE': 'disable'}
if PASSWORD:
    BASE_ENV['PGPASSWORD'] = PASSWORD
PID = os.getpid()
DB = f'hier_m3hist_{PID}'
ROLE = f'hier_m3hist_{PID}_recorder'
ROLE_PASSWORD = hashlib.sha256(os.urandom(32)).hexdigest()[:32]
DB_ENV = BASE_ENV | {'PGDATABASE': DB}


def psql(query, db=DB, stdin=None):
    args = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', db]
    args += ['-f', '-'] if stdin is not None else ['-c', query]
    result = subprocess.run(args, env=BASE_ENV, input=stdin, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, f'psql failed: {result.stderr.strip()[:400]}'
    return result.stdout.strip()


def prove_local():
    assert psql("select host(inet_server_addr())", 'postgres') in ('127.0.0.1', '::1'), 'server is not on loopback'
    assert psql("select rolsuper from pg_roles where rolname = current_user", 'postgres') == 't'
    assert psql("""select count(*) from pg_roles where rolname in ('supabase_admin', 'authenticator',
                   'supabase_auth_admin')""", 'postgres') == '0', 'hosted platform roles present'
    assert psql(f"select count(*) from pg_database where datname = '{m.REF}'", 'postgres') == '0'
    print(f'== locality proof: loopback PostgreSQL {psql("show server_version", "postgres")}; '
          f'CLI {subprocess.run([CLI, "--version"], capture_output=True, text=True).stdout.strip()}', flush=True)


# ── synthetic fixture ─────────────────────────────────────────────────────────────────────────────────────────────

def dollar(text):
    assert '$m3t$' not in text
    return '$m3t$' + text + '$m3t$'


def uid(prefix, n):
    return f'{prefix}-{n:04d}-4000-8000-{n:012d}'


def label(u):
    return u.replace('-', '_')


ADMIN, TL, TL_GONE = uid('ecf2bb91', 1), uid('f809493e', 2), uid('86ca95f2', 3)
FOUR = {'4ef505e0': (uid('4ef505e0', 4), TL), '5f952f0d': (uid('5f952f0d', 5), TL_GONE),
        '89f2e994': (uid('89f2e994', 6), TL), 'e5c4ee04': (uid('e5c4ee04', 7), TL)}


def seed():
    rows = [(ADMIN, None, label(ADMIN)), (TL, ADMIN, f'{label(ADMIN)}.{label(TL)}'),
            (TL_GONE, ADMIN, f'{label(ADMIN)}.{label(TL_GONE)}')]
    rows += [(i, up, f'{label(ADMIN)}.{label(up)}.{label(i)}') for i, up in FOUR.values()]
    profiles = ',\n'.join(
        f"('{i}', {('NULL' if up is None else repr(up))}::uuid, '{path}', '2026-10-24 04:58:12.87362+00', "
        f"'a0000000-0000-0000-0000-000000000001', 'Agent', 'Active')" for i, up, path in rows)
    psql(None, stdin=f"""
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY, statements text[], name text,
  created_by text, idempotency_key text UNIQUE, rollback text[]);
-- 343 synthetic rows below M1, then M1 and M2 with their real single-statement bytes: 345 rows, head M2.
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  SELECT to_char(timestamp '2025-01-01' + g * interval '1 hour', 'YYYYMMDDHH24MISS'), 'synthetic_' || g,
         ARRAY['-- synthetic statement ' || g] FROM generate_series(1, 343) g;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES
  ('20261023210027', 'hierarchy_authorization_boundaries', ARRAY[{dollar(M1.read_text(encoding='utf-8'))}]),
  ('20261023232435', 'hierarchy_integrity', ARRAY[{dollar(M2.read_text(encoding='utf-8'))}]);
CREATE SCHEMA private;
CREATE TABLE private.test_consistency (profiles int, edges int, expected_pairs int, path_pairs int,
  missing_pairs int, extra_pairs int, stale_paths int, null_paths int, self_parents int, cross_org_edges int,
  unreachable int);
INSERT INTO private.test_consistency VALUES (7, 6, 11, 11, 0, 0, 0, 0, 0, 0, 0);
CREATE FUNCTION private.hierarchy_consistency() RETURNS SETOF private.test_consistency
  LANGUAGE sql STABLE AS 'SELECT * FROM private.test_consistency';
CREATE TABLE public.profiles (id uuid PRIMARY KEY, upline_id uuid, hierarchy_path text, updated_at timestamptz,
  organization_id uuid, role text, status text);
INSERT INTO public.profiles VALUES
{profiles};
CREATE TABLE private.profiles_seed AS SELECT * FROM public.profiles;
-- The CLI's role: connect, and read and write the history table. Nothing else (no public, no private).
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE {DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE {DB} TO {ROLE};
GRANT USAGE ON SCHEMA supabase_migrations TO {ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON supabase_migrations.schema_migrations TO {ROLE};
""")


def restore():
    psql(None, stdin="""
DELETE FROM supabase_migrations.schema_migrations WHERE version >= '20261023210028' AND version <> '20261023232435'
   OR version IN ('20261023000000', '20261023210200');
UPDATE supabase_migrations.schema_migrations SET statements = ARRAY[rtrim(statements[1], '!')]
 WHERE version = '20261023210027';
UPDATE supabase_migrations.schema_migrations SET name = 'synthetic_1' WHERE version = '20250101010000';
UPDATE private.test_consistency SET stale_paths = 0, path_pairs = 11;
TRUNCATE public.profiles;
INSERT INTO public.profiles SELECT * FROM private.profiles_seed;
""")


def digest():
    return psql("""select (select md5(string_agg(t::text, E'\\n' order by version))
                             from supabase_migrations.schema_migrations t) || '|' ||
                          (select md5(string_agg(p::text, E'\\n' order by id)) from public.profiles p) || '|' ||
                          (select md5(string_agg(c::text, E'\\n')) from private.test_consistency c)""")


def synthetic_expect():
    ids8 = ','.join(f"'{x}'" for x in m.PRODUCTION.four_ids8)
    ids, targets = psql(f"""select md5(string_agg(id::text, ',' order by id)) || ' ' ||
        md5(string_agg(id::text || '=' || hierarchy_path::text, ',' order by id))
        from public.profiles where left(id::text, 8) in ({ids8})""").split()
    return dataclasses.replace(m.PRODUCTION, id_fingerprint=ids, target_fingerprint=targets)


def target(user=ROLE, password=ROLE_PASSWORD):
    return m.Target(DB_ENV, f'postgresql://{user}:{urllib.parse.quote(password, safe="")}@127.0.0.1:{PORT}/{DB}'
                            '?sslmode=disable')


def script(path, body):
    path.write_text('#!/bin/sh\n' + body + '\n')
    path.chmod(0o755)
    return str(path)


# ── stages ────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_workflow_and_runner_text():
    print('== workflow and runner text', flush=True)
    text = WORKFLOW.read_text()
    wf = yaml.safe_load(text)
    triggers = wf.get('on', wf.get(True))
    assert list(triggers) == ['workflow_dispatch'], triggers
    inputs = triggers['workflow_dispatch']['inputs']
    assert inputs['stage']['type'] == 'choice' and inputs['stage']['options'] == list(m.STAGES)
    assert inputs['confirm']['type'] == 'string' and inputs['confirm']['required'] is True
    assert wf['permissions'] == {'contents': 'read'}
    assert wf['concurrency'] == {'group': 'hierarchy-m3-history', 'cancel-in-progress': False}
    jobs = wf['jobs']
    assert list(jobs) == ['environment-guard', 'record']
    ok('dispatch only; two stages with a typed confirmation; read-only token; no concurrent runs')
    guard, record = jobs['environment-guard'], jobs['record']
    main_only = "github.ref == 'refs/heads/main'"
    assert guard['if'] == main_only and record['if'] == main_only and record['needs'] == 'environment-guard'
    assert 'environment' not in guard and record['environment'] == m.ENVIRONMENT
    assert guard['permissions'] == {'contents': 'read', 'actions': 'read', 'deployments': 'read'}
    assert record['permissions'] == {'contents': 'read'}
    ok('both jobs main only; the protected job needs the guard; only it uses the environment')
    for job in (guard, record):
        checkout = job['steps'][0]
        assert checkout['uses'] == CHECKOUT and checkout['with'] == {'persist-credentials': False}
    assert guard['steps'][1]['run'] == 'python3 -I scripts/hierarchy_m3_history_record.py guard-environment'
    assert guard['steps'][1]['env'] == {'GH_TOKEN': '${{ github.token }}'}
    assert record['steps'][2]['uses'] == SETUP_CLI and record['steps'][2]['with'] == {'version': m.CLI_VERSION}
    assert record['steps'][3]['run'] == 'python3 -I scripts/hierarchy_m3_history_record.py run'
    assert record['steps'][3]['env'] == {
        'STAGE': '${{ inputs.stage }}', 'CONFIRM': '${{ inputs.confirm }}',
        'SUPABASE_DB_PASSWORD': '${{ secrets.SUPABASE_DB_PASSWORD }}',
        'SUPABASE_POOLER_HOST': '${{ secrets.SUPABASE_POOLER_HOST }}'}
    assert sorted(set(re.findall(r'secrets\.([A-Za-z_]+)', text))) == ['SUPABASE_DB_PASSWORD', 'SUPABASE_POOLER_HOST']
    ok('pinned checkout (no persisted credentials) and CLI 2.121.0; only the two database secrets, in one step')
    code = '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('#'))
    for word in ('db push', 'migration up', 'db reset', '--linked', 'psql -f', 'SUPABASE_ACCESS_TOKEN', 'apply_migration'):
        assert word not in code, word
    tree = ast.parse(RUNNER.read_text())
    literals = {node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)}
    for word in ('push', 'up', 'reset', 'db', '--linked', '-f', '--file', '--single-transaction', 'reverted'):
        assert word not in literals, word
    ok('no db push / migration up / reset / --linked / psql -f / revert anywhere in the executable text')


def test_environment_guard():
    print('== environment guard (fixtures)', flush=True)
    user = {'type': 'User', 'reviewer': {'login': m.REVIEWER}}
    good = {'name': m.ENVIRONMENT, 'can_admins_bypass': False,
            'protection_rules': [{'type': 'required_reviewers', 'prevent_self_review': False, 'reviewers': [user]},
                                 {'type': 'branch_policy'}],
            'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True}}
    policies = {'total_count': 1, 'branch_policies': [{'name': 'main', 'type': 'branch'}]}
    quiet(lambda: m.check_environment(good, policies))
    ok('the recorded configuration passes')
    bad = [
        ({**good, 'name': 'other'}, policies, f'environment {m.ENVIRONMENT}'),
        ({**good, 'protection_rules': [{'type': 'branch_policy'}]}, policies, 'required reviewer is exactly cgarness'),
        ({**good, 'protection_rules': [{'type': 'required_reviewers', 'reviewers': [
            user, {'type': 'User', 'reviewer': {'login': 'someone-else'}}]}]}, policies,
         'required reviewer is exactly cgarness'),
        ({**good, 'protection_rules': [{'type': 'required_reviewers', 'reviewers': [
            {'type': 'Team', 'reviewer': {'slug': 'admins'}}]}]}, policies, 'required reviewer is exactly cgarness'),
        ({**good, 'can_admins_bypass': True}, policies, 'administrator bypass disabled'),
        ({k: v for k, v in good.items() if k != 'can_admins_bypass'}, policies, 'administrator bypass disabled'),
        ({**good, 'deployment_branch_policy': None}, policies, 'custom deployment branch policy'),
        ({**good, 'deployment_branch_policy': {'protected_branches': True, 'custom_branch_policies': False}},
         policies, 'custom deployment branch policy'),
        (good, {'total_count': 2, 'branch_policies': [{'name': 'main'}, {'name': 'release/*'}]},
         'deployments from main only'),
        (good, {'total_count': 1, 'branch_policies': [{'name': '*', 'type': 'branch'}]}, 'deployments from main only'),
        (good, {'total_count': 1, 'branch_policies': [{'name': 'main', 'type': 'tag'}]}, 'deployments from main only'),
    ]
    for environment, branch_policies, expected in bad:
        stops(lambda: m.check_environment(environment, branch_policies), expected)
    ok(f'{len(bad)} weakened configurations fail closed (reviewer, admin bypass absent or on, branch policy)')
    with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'someone/fork', 'GH_TOKEN': 'x'}):
        stops(m.guard_environment, 'expected repository')
    with patch.dict(os.environ, {'GITHUB_REPOSITORY': m.REPOSITORY, 'GH_TOKEN': ''}):
        stops(m.guard_environment, 'run token present')
    ok('wrong repository or missing token refused before any request')


def test_entry_gates(tmp):
    print('== entry, file, CLI and connection gates', flush=True)
    untouched = ('files_gate', 'cli_gate', 'production_target', 'identity', 'run_stage', 'guard_environment')
    cases = [(['deploy'], {}, 'known subcommand'),
             (['run'], {'GITHUB_REF': 'refs/heads/feature', 'STAGE': 'check', 'CONFIRM': 'check'}, 'main dispatch only'),
             (['run'], {'GITHUB_REF': 'refs/heads/main', 'STAGE': 'record-history', 'CONFIRM': 'check'},
              'explicit stage confirmation'),
             (['run'], {'GITHUB_REF': 'refs/heads/main', 'STAGE': 'apply', 'CONFIRM': 'apply'},
              'explicit stage confirmation')]
    for argv, env, expected in cases:
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, env))
            mocks = [stack.enter_context(patch.object(m, name)) for name in untouched]
            stops(lambda: m.main(argv), expected)
            for mock in mocks:
                mock.assert_not_called()
    ok('unknown subcommand, non-main ref and unconfirmed stage refused before files, CLI or connection')
    data, _ = quiet(lambda: m.files_gate(ROOT))
    assert hashlib.sha256(data).hexdigest() == m.SOURCE_SHA256
    fake = tmp / 'root'
    (fake / m.SOURCE).parent.mkdir(parents=True)
    (fake / m.SOURCE).write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
    stops(lambda: m.files_gate(fake), 'M3 source bytes (SHA-256 2da22c6f…)')
    (fake / m.SOURCE).write_bytes(data)
    (fake / 'supabase/migrations/20261024045812_hierarchy_path_repair.sql').write_bytes(data)
    stops(lambda: m.files_gate(fake), 'no top-level M3 file before the history record')
    ok('M3 bytes pinned (a one-bit change refused); a top-level copy refused')
    with patch.dict(os.environ, {'PGPASSWORD': 'x', 'SUPABASE_ACCESS_TOKEN': 'x', 'SUPABASE_DB_PASSWORD': 'x'}):
        env = m.cli_env()
    assert not any(k.startswith('PG') or k in ('SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD') for k in env)
    assert env['DO_NOT_TRACK'] == '1' and env['SUPABASE_TELEMETRY_DISABLED'] == '1'
    quiet(lambda: m.cli_gate(CLI))
    stops(lambda: m.cli_gate(script(tmp / 'old-cli', 'echo 2.120.0')), f'pinned Supabase CLI {m.CLI_VERSION}')
    ok('the real CLI is exactly 2.121.0 with --db-url, --status and --workdir; another version refused; no credential '
       'variables and telemetry off in its environment')
    for env, expected in (({'SUPABASE_POOLER_HOST': 'db.jncvvsvckxhqgqvkppmj.supabase.co', 'SUPABASE_DB_PASSWORD': 'x'},
                           'approved session pooler'),
                          ({'SUPABASE_POOLER_HOST': '127.0.0.1', 'SUPABASE_DB_PASSWORD': 'x'}, 'approved session pooler'),
                          ({'SUPABASE_POOLER_HOST': 'aws-0-us-east-1.pooler.supabase.com', 'SUPABASE_DB_PASSWORD': ''},
                           'database credential present')):
        with patch.dict(os.environ, env):
            stops(m.production_target, expected)
    secret = 'p@ss w/rd%'
    with patch.dict(os.environ, {'SUPABASE_POOLER_HOST': 'aws-0-us-east-1.pooler.supabase.com',
                                 'SUPABASE_DB_PASSWORD': secret, 'GITHUB_ACTIONS': 'true', 'PGHOST': 'elsewhere'}):
        prod, out = quiet(m.production_target)
    masks = [line for line in out.splitlines() if line.startswith('::add-mask::')]
    assert len(masks) == 3 and all(secret not in line for line in out.splitlines() if line not in masks)
    assert prod.env['PGUSER'] == f'postgres.{m.REF}' and prod.env['PGSSLMODE'] == 'require'
    assert prod.env['PGHOST'] == 'aws-0-us-east-1.pooler.supabase.com' and prod.env['PGPORT'] == '5432'
    assert prod.db_url.endswith('@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require')
    assert urllib.parse.quote(secret, safe='') in prod.db_url
    ok('direct host or loopback refused; pooler user, TLS required, URL-encoded password masked three ways')


def test_refusals(expect, tripwire):
    print('== refusals before any write (each on the seeded state, then restored)', flush=True)
    baseline = digest()
    data = (ROOT / m.SOURCE).read_bytes()
    cases = [
        ("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261024000001', 'later')",
         'recognized history state', 'a later migration moved the head'),
        ("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261023210200', 'x')",
         'recognized history state', 'M3 recorded under its authored version'),
        ("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261023000000', "
         "'hierarchy_path_repair')", 'recognized history state', 'M3 recorded under another version'),
        ("UPDATE supabase_migrations.schema_migrations SET statements = ARRAY[statements[1] || '!'] "
         "WHERE version = '20261023210027'", 'M1 and M2 recorded as reviewed', 'M1 history row changed'),
        ('UPDATE private.test_consistency SET stale_paths = 1',
         'hierarchy consistent: 0 stale, NULL, missing, extra or invalid; all pairs present', 'a stale path'),
        ('UPDATE private.test_consistency SET path_pairs = 10',
         'hierarchy consistent: 0 stale, NULL, missing, extra or invalid; all pairs present', 'a missing pair'),
        (f"UPDATE public.profiles SET hierarchy_path = '{label(FOUR['89f2e994'][0])}' "
         f"WHERE id = '{FOUR['89f2e994'][0]}'",
         "the four reviewed rows hold exactly the reviewed target paths (M3's effect is live)",
         'a reviewed row not at its target'),
        (f"INSERT INTO public.profiles SELECT '{uid('e5c4ee04', 99)}', upline_id, hierarchy_path, updated_at, "
         f"organization_id, role, status FROM public.profiles WHERE id = '{FOUR['e5c4ee04'][0]}'",
         "the four reviewed rows hold exactly the reviewed target paths (M3's effect is live)",
         'a fifth row with a reviewed prefix'),
    ]
    for change, expected, why in cases:
        psql(change)
        for stage in m.STAGES:
            stops(lambda: m.run_stage(stage, target(), expect, data, tripwire), expected)
        restore()
        assert digest() == baseline, f'state not restored after: {why}'
        assert not Path(tripwire + '.called').exists(), f'CLI invoked despite: {why}'
    ok(f'{len(cases)} drifted states refused by both stages; the CLI was never invoked; nothing changed')


def test_record_and_check(expect, tripwire):
    print('== check, record with the real CLI, re-run, check, inverse', flush=True)
    data = (ROOT / m.SOURCE).read_bytes()
    baseline = digest()
    others_before = psql("select md5(string_agg(t::text, E'\\n' order by version)) "
                         "from supabase_migrations.schema_migrations t")
    state, _ = quiet(lambda: m.run_stage('check', target(), expect, data, tripwire))
    assert state == 'before' and digest() == baseline
    ok('check on the unrecorded state: read-only, nothing changed')
    assert psql(f"select has_table_privilege('{ROLE}', 'public.profiles', 'UPDATE')::text || "
                f"has_schema_privilege('{ROLE}', 'private', 'USAGE')::text || "
                f"has_schema_privilege('{ROLE}', 'public', 'USAGE')::text") == 'falsefalsefalse'
    state, out = quiet(lambda: m.run_stage('record-history', target(), expect, data, CLI))
    assert state == 'recorded' and 'STOP HERE' in out
    row = psql(f"""select concat_ws('|', count(*) over (), version, name, cardinality(statements),
        encode(sha256(convert_to(array_to_string(statements, ''), 'UTF8')), 'hex'))
        from supabase_migrations.schema_migrations where version >= '20261024'""")
    assert row == f'1|{m.VERSION}|{m.NAME}|{m.RECORDED_STATEMENTS}|{m.RECORDED_DIGEST}', row
    assert psql("select md5(string_agg(t::text, E'\\n' order by version)) from supabase_migrations.schema_migrations t "
                f"where version <> '{m.VERSION}'") == others_before
    assert digest().split('|')[1] == baseline.split('|')[1]
    ok('the real CLI, as a role limited to the history table, recorded exactly one row: '
       f'{m.VERSION} / {m.NAME}, {m.RECORDED_STATEMENTS} statements, digest {m.RECORDED_DIGEST[:8]}…')
    ok('every other history row byte-identical; profiles unchanged; M3 never executed (the role could not have)')
    recorded = digest()
    stops(lambda: m.run_stage('record-history', target(), expect, data, tripwire),
          'record-history needs the unrecorded state')
    assert digest() == recorded and not Path(tripwire + '.called').exists()
    state, _ = quiet(lambda: m.run_stage('check', target(), expect, data, tripwire))
    assert state == 'recorded' and digest() == recorded
    ok('a second record-history is refused; check on the recorded state verifies the row read-only')
    work = Path(tempfile.mkdtemp(prefix='hier-m3-history-inverse-'))
    (work / 'supabase' / 'migrations').mkdir(parents=True)
    try:
        subprocess.run([CLI, 'migration', 'repair', m.VERSION, '--status', 'reverted', '--db-url', target().db_url,
                        '--workdir', str(work)], env=m.cli_env(), cwd=work, check=True, capture_output=True,
                       timeout=120)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    assert digest() == baseline
    ok('the documented inverse (--status reverted) deletes only that row: the exact before-image returns')


def test_readback_catches(expect, tmp):
    print('== the read-back catches a wrong write (fake CLIs, each on the seeded state, then restored)', flush=True)
    data = (ROOT / m.SOURCE).read_bytes()
    baseline = digest()
    su = f'"postgresql://postgres:{urllib.parse.quote(PASSWORD, safe="")}@127.0.0.1:{PORT}/{DB}?sslmode=disable"' \
        if PASSWORD else f'"postgresql://postgres@127.0.0.1:{PORT}/{DB}?sslmode=disable"'
    real = f'"{CLI}" "$@" || exit 1'
    one_statement = (f"psql -X -q {su} -v ON_ERROR_STOP=1 -c \"INSERT INTO supabase_migrations.schema_migrations "
                     f"(version, name, statements) VALUES ('{m.VERSION}', '{m.NAME}', ARRAY['whole file'])\"")
    cases = [
        ('exit 0', 'history holds exactly one more row: M3', 'a CLI that reports success but writes nothing'),
        ('exit 3', 'command failed; verify state independently; no automatic retry', 'a CLI that fails'),
        (real + f"\npsql -X -q {su} -c \"INSERT INTO supabase_migrations.schema_migrations (version, name) "
                f"VALUES ('20261025000000', 'extra')\"",
         'history holds exactly one more row: M3', 'an extra history row'),
        (one_statement, 'recorded row: hierarchy_path_repair, 4 CLI statements, digest 80b363c5…',
         'the apply_migration shape (one statement)'),
        (real + f"\npsql -X -q {su} -c \"UPDATE public.profiles SET status = 'Inactive' WHERE id = '{ADMIN}'\"",
         'profiles unchanged: no application data written', 'an application-data write'),
        (real + f"\npsql -X -q {su} -c \"UPDATE supabase_migrations.schema_migrations SET name = 'renamed' "
                f"WHERE version = '20250101010000'\"",
         'every other history row byte-identical', 'another history row changed'),
    ]
    for n, (body, expected, why) in enumerate(cases):
        fake = script(tmp / f'fake-cli-{n}', body)
        stops(lambda: m.run_stage('record-history', target(), expect, data, fake), expected)
        restore()
        assert digest() == baseline, f'state not restored after: {why}'
    ok(f'{len(cases)} wrong writes or failures stop the run with the matching label')


def main():
    prove_local()
    psql(f'DROP DATABASE IF EXISTS {DB}', 'postgres')
    psql(f'DROP ROLE IF EXISTS {ROLE}', 'postgres')
    psql(f"CREATE ROLE {ROLE} LOGIN PASSWORD '{ROLE_PASSWORD}'", 'postgres')
    psql(f'CREATE DATABASE {DB}', 'postgres')
    tmp = Path(tempfile.mkdtemp(prefix='hier-m3-history-test-'))
    try:
        seed()
        expect = synthetic_expect()
        tripwire = script(tmp / 'tripwire-cli', 'touch "$0.called"\nexit 1')
        test_workflow_and_runner_text()
        test_environment_guard()
        test_entry_gates(tmp)
        test_refusals(expect, tripwire)
        test_record_and_check(expect, tripwire)
        test_readback_catches(expect, tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)', 'postgres')
        psql(f'DROP ROLE IF EXISTS {ROLE}', 'postgres')
    print(f'ALL PASSED: {PASSES} checks', flush=True)


if __name__ == '__main__':
    main()
