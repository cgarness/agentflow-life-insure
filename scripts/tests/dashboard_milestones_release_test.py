"""G2 release runner rehearsal: a DISPOSABLE loopback PostgreSQL and synthetic data ONLY.

Drives the exact runner (scripts/dashboard_milestones_release.py) through every stage against the dashboard milestone
harness (supabase/tests/dashboard_milestone_reviews_harness.sql), a synthetic supabase_migrations.schema_migrations
(production's columns, 350 rows, head 20261028040215) and synthetic CRM rows, with the REAL pinned Supabase CLI for
the history writes. The CLI connects as a role that may only read and write the history table, so it cannot have
executed any migration SQL. A checkout copy carries decoy migrations, which must never run. No production
credential, host or environment is used.

Usage: DMR_RELEASE_PGURL=postgresql://postgres[:password]@127.0.0.1:5432 \
       python3 -I scripts/tests/dashboard_milestones_release_test.py
Port 5432 and ssl=on are required: the runner's identity gate pins port 5432 and requires TLS, and the test proves
each of its checks fails closed. The CLI is `supabase` on PATH, or DMR_RELEASE_CLI. Needs PyYAML. Creates and drops
only database dmr_release_<pid> and roles dmr_release_<pid>_recorder and "postgres.jncvvsvckxhqgqvkppmj".
"""
import ast
import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from unittest.mock import patch

import yaml

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / 'scripts' / 'dashboard_milestones_release.py'
WORKFLOW = ROOT / '.github' / 'workflows' / 'dashboard-milestones-release.yml'
HARNESS = ROOT / 'supabase/tests/dashboard_milestone_reviews_harness.sql'
CHECKOUT = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'
SETUP_CLI = 'supabase/setup-cli@3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf'

spec = importlib.util.spec_from_file_location('dashboard_milestones_release', RUNNER)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

PASSES = 0
OUTPUT = []  # every line the runner printed, scanned for secrets at the end


def ok(label):
    global PASSES
    PASSES += 1
    print(f'   PASS {label}', flush=True)


def quiet(fn):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        try:
            result = fn()
        finally:
            OUTPUT.append(out.getvalue())
    return result, out.getvalue()


def stops(fn, expected):
    """fn must raise the runner's Stop with exactly this label; returns what the runner printed."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        try:
            fn()
        except m.Stop as error:
            OUTPUT.append(out.getvalue())
            assert str(error) == expected, f'expected STOP {expected!r}, got {str(error)!r}'
            return out.getvalue()
    OUTPUT.append(out.getvalue())
    raise AssertionError(f'expected STOP {expected!r}; the runner continued')


# ── locality proof (invariant #28: destructive statements only on a proven-local stack) ──────────────────────────
URL = os.environ.get('DMR_RELEASE_PGURL', '')
parts = urllib.parse.urlsplit(URL)
if not (parts.scheme in ('postgres', 'postgresql') and parts.hostname in ('127.0.0.1', 'localhost')
        and parts.username == 'postgres' and parts.port == 5432 and parts.path in ('', '/')):
    sys.exit('REFUSED: DMR_RELEASE_PGURL must be postgresql://postgres[:password]@127.0.0.1:5432')
PASSWORD = urllib.parse.unquote(parts.password or '')
CLI = os.environ.get('DMR_RELEASE_CLI') or shutil.which('supabase') or sys.exit('REFUSED: no supabase CLI')
BASE_ENV = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'SUPABASE_', 'GITHUB_'))} | {
    'PGHOST': '127.0.0.1', 'PGPORT': '5432', 'PGUSER': 'postgres', 'PGSSLMODE': 'disable'}
if PASSWORD:
    BASE_ENV['PGPASSWORD'] = PASSWORD
PID = os.getpid()
DB = f'dmr_release_{PID}'
ROLE = f'dmr_release_{PID}_recorder'
POOLER_ROLE = f'postgres.{m.REF}'
ROLE_PASSWORD = hashlib.sha256(os.urandom(32)).hexdigest()[:32]
DB_ENV = BASE_ENV | {'PGDATABASE': DB}

ORG = 'a0000000-0000-4000-8000-000000000001'
AGENT = 'b0000000-0000-4000-8000-000000000001'
CLIENT = 'c0000000-0000-4000-8000-000000000001'


def psql(query, db=DB, stdin=None, env=None):
    args = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', db]
    args += ['-f', '-'] if stdin is not None else ['-c', query]
    result = subprocess.run(args, env=env or BASE_ENV, input=stdin, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, f'psql failed: {result.stderr.strip()[:400]}'
    return result.stdout.strip()


def prove_local():
    assert psql("select host(inet_server_addr())", 'postgres') in ('127.0.0.1', '::1'), 'server is not on loopback'
    assert psql("select rolsuper from pg_roles where rolname = current_user", 'postgres') == 't'
    assert psql("""select count(*) from pg_roles where rolname in ('supabase_admin', 'authenticator',
                   'supabase_auth_admin')""", 'postgres') == '0', 'hosted platform roles present'
    assert psql(f"select count(*) from pg_database where datname = '{m.REF}'", 'postgres') == '0'
    assert psql('show ssl', 'postgres') == 'on', 'the rehearsal server must have ssl=on (identity gates)'
    print(f'== locality proof: loopback PostgreSQL {psql("show server_version", "postgres")} with TLS; '
          f'CLI {subprocess.run([CLI, "--version"], capture_output=True, text=True).stdout.strip()}', flush=True)


# ── synthetic fixture ─────────────────────────────────────────────────────────────────────────────────────────────

def fresh():
    """A new database in the exact `before` state: harness, synthetic history, synthetic CRM rows."""
    psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)', 'postgres')
    psql(f'CREATE DATABASE {DB}', 'postgres')
    psql(None, stdin=HARNESS.read_text())
    psql(None, stdin=f"""
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY, statements text[], name text,
  created_by text, idempotency_key text UNIQUE, rollback text[]);
-- 349 synthetic rows below the head, then production's head: 350 rows, head 20261028040215.
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  SELECT to_char(timestamp '2025-01-01' + g * interval '1 hour', 'YYYYMMDDHH24MISS'), 'synthetic_' || g,
         ARRAY['-- synthetic statement ' || g] FROM generate_series(1, 349) g;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('20261028040215', 'standard_lead_fields', ARRAY['-- synthetic head']);
INSERT INTO public.organizations VALUES ('{ORG}', 'Synthetic agency');
INSERT INTO auth.users VALUES ('{AGENT}');
INSERT INTO public.profiles VALUES ('{AGENT}', '{ORG}', 'Agent', 'Active', NULL);
INSERT INTO public.clients (id, organization_id, assigned_agent_id, first_name)
  SELECT CASE WHEN g = 1 THEN '{CLIENT}'::uuid ELSE gen_random_uuid() END, '{ORG}', '{AGENT}', 'Client ' || g
  FROM generate_series(1, 200) g;
-- Ordinary CRM traffic: each iteration updates, inserts and deletes clients and commits.
CREATE TABLE dmr_t.crm_counter (n bigint NOT NULL);
INSERT INTO dmr_t.crm_counter VALUES (0);
CREATE PROCEDURE dmr_t.crm_activity(p_seconds numeric) LANGUAGE plpgsql AS $crm$
DECLARE
  v_until timestamptz := clock_timestamp() + make_interval(secs => p_seconds);
  v_id uuid;
BEGIN
  WHILE clock_timestamp() < v_until LOOP
    UPDATE public.clients SET first_name = 'crm ' || clock_timestamp() WHERE id = '{CLIENT}';
    v_id := gen_random_uuid();
    INSERT INTO public.clients (id, organization_id, assigned_agent_id, first_name) VALUES (v_id, '{ORG}', '{AGENT}', 'new');
    DELETE FROM public.clients WHERE id = v_id;
    UPDATE dmr_t.crm_counter SET n = n + 1;
    COMMIT;
    PERFORM pg_sleep(0.005);
  END LOOP;
END $crm$;
-- The CLI's role: connect, and read and write the history table. Nothing else.
REVOKE ALL ON DATABASE {DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE {DB} TO {ROLE};
GRANT USAGE ON SCHEMA supabase_migrations TO {ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON supabase_migrations.schema_migrations TO {ROLE};
""")


def digest():
    """Everything a stage could touch, CRM rows included (only for checks with no concurrent activity)."""
    return psql("""select (select md5(string_agg(t::text, E'\\n' order by version))
                             from supabase_migrations.schema_migrations t) || '|' ||
                          (select md5(string_agg(c::text, E'\\n' order by id)) from public.clients c) || '|' ||
                          (select count(*) from pg_class where relname like 'dashboard\\_milestone%') || '|' ||
                          (select count(*) from pg_proc where proname like '%dashboard\\_milestone\\_review%')""")


def target(user=ROLE, password=ROLE_PASSWORD):
    return m.Target(DB_ENV, f'postgresql://{user}:{urllib.parse.quote(password, safe="")}@127.0.0.1:5432/{DB}'
                            '?sslmode=disable')


def state():
    return quiet(lambda: m.classify(target(), m.PRODUCTION))[0]


def script(path, body):
    path.write_text('#!/bin/sh\n' + body + '\n')
    path.chmod(0o755)
    return str(path)


def checkout_with_decoys(tmp):
    """A checkout copy with the approved files plus decoy migrations that would leave markers if ever executed."""
    root = tmp / 'checkout'
    for rel in (m.SOURCE, m.ROLLBACK):
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / rel, root / rel)
    decoys = {'supabase/migrations/20261029130000_decoy_after.sql': 'decoy_top',
              'supabase/migrations/20261028000000_decoy_before.sql': 'decoy_old',
              'supabase/migrations/pending/20261029140000_decoy_pending.sql': 'decoy_pending',
              'supabase/migrations/rollback/20261029130000_decoy_after.rollback.sql': 'decoy_rollback'}
    for rel, marker in decoys.items():
        (root / rel).write_text(f'CREATE TABLE public.{marker} (id int);\n'
                                f"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('1', '{marker}');\n")
    return root, sorted(decoys.values())


def no_decoys(markers):
    found = psql("select count(*) from pg_class where relname in (" + ','.join(f"'{x}'" for x in markers) + ")")
    names = psql("select count(*) from supabase_migrations.schema_migrations where name like 'decoy%' or version = '1'")
    return found == '0' and names == '0'


class Recorder:
    """Wraps the runner's two execution points: every SQL body it executes and every external command it runs."""

    def __init__(self):
        self.bodies, self.commands = [], []

    def __enter__(self):
        real_transaction, real_command = m.transaction, m.command

        def transaction(target_, body, prelude=()):
            self.bodies.append(hashlib.sha256(body).hexdigest())
            return real_transaction(target_, body, prelude)

        def command(args, env=None, timeout=60, cwd=None):
            if args[0] != 'psql':
                self.commands.append([a if not a.startswith('postgresql://') else '<db-url>' for a in args])
            return real_command(args, env, timeout, cwd)

        self._patches = [patch.object(m, 'transaction', transaction), patch.object(m, 'command', command)]
        for p in self._patches:
            p.start()
        return self

    def __exit__(self, *exc):
        for p in self._patches:
            p.stop()


# ── 1. workflow and runner text ──────────────────────────────────────────────────────────────────────────────────

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
    assert wf['concurrency'] == {'group': 'dashboard-milestones-release', 'cancel-in-progress': False}
    jobs = wf['jobs']
    assert list(jobs) == ['environment-guard', 'release']
    ok('dispatch only; four stages with a typed confirmation; read-only token; no concurrent runs')
    guard, release = jobs['environment-guard'], jobs['release']
    main_only = "github.ref == 'refs/heads/main'"
    assert guard['if'] == main_only and release['if'] == main_only and release['needs'] == 'environment-guard'
    assert 'environment' not in guard and release['environment'] == m.ENVIRONMENT
    assert guard['permissions'] == {'contents': 'read', 'actions': 'read', 'deployments': 'read'}
    assert release['permissions'] == {'contents': 'read'}
    ok('both jobs main only; the protected job needs the guard; only it uses the protected environment')
    for job in (guard, release):
        checkout = job['steps'][0]
        assert checkout['uses'] == CHECKOUT and checkout['with'] == {'persist-credentials': False}
    assert guard['steps'][1]['run'] == 'python3 -I scripts/dashboard_milestones_release.py guard-environment'
    assert guard['steps'][1]['env'] == {'GH_TOKEN': '${{ github.token }}'}
    assert release['steps'][2]['uses'] == SETUP_CLI and release['steps'][2]['with'] == {'version': m.CLI_VERSION}
    assert release['steps'][3]['run'] == 'python3 -I scripts/dashboard_milestones_release.py run'
    assert release['steps'][3]['env'] == {
        'STAGE': '${{ inputs.stage }}', 'CONFIRM': '${{ inputs.confirm }}',
        'SUPABASE_DB_PASSWORD': '${{ secrets.SUPABASE_DB_PASSWORD }}',
        'SUPABASE_POOLER_HOST': '${{ secrets.SUPABASE_POOLER_HOST }}'}
    assert sorted(set(re.findall(r'secrets\.([A-Za-z_]+)', text))) == ['SUPABASE_DB_PASSWORD', 'SUPABASE_POOLER_HOST']
    ok('pinned checkout (no persisted credentials) and CLI 2.121.0; only the two database secrets, in one step')
    code = '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('#'))
    for word in ('db push', 'migration up', 'db reset', '--linked', 'SUPABASE_ACCESS_TOKEN', 'apply_migration',
                 'vercel', 'VITE_'):
        assert word not in code, word
    tree = ast.parse(RUNNER.read_text())
    literals = {node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)}
    for word in ('push', 'up', 'reset', 'db', '--linked', '--include-all', 'new', 'squash', 'pull'):
        assert word not in literals, word
    paths = sorted(x for x in literals if '\n' not in x and ('supabase/migrations' in x or x.endswith('.sql')))
    assert set(paths) <= {str(m.SOURCE), str(m.ROLLBACK), 'supabase/migrations', '.sql', '.rollback.sql'}, paths
    ok('no db push / migration up / reset / --linked / --include-all, no Vercel or flag reference; the only SQL '
       'files the runner names are the approved migration and its rollback')


# ── 2. environment guard ─────────────────────────────────────────────────────────────────────────────────────────

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


# ── 3. entry, file, CLI and connection gates ─────────────────────────────────────────────────────────────────────

def test_entry_gates(tmp):
    print('== entry, checksum, CLI, pooler and identity gates', flush=True)
    untouched = ('files_gate', 'cli_gate', 'production_target', 'identity', 'run_stage', 'guard_environment')
    cases = [(['deploy'], {}, 'known subcommand'),
             (['run'], {'GITHUB_REF': 'refs/heads/feature', 'STAGE': 'check', 'CONFIRM': 'check'}, 'main dispatch only'),
             (['run'], {'GITHUB_REF': 'refs/pull/1/merge', 'STAGE': 'check', 'CONFIRM': 'check'}, 'main dispatch only'),
             (['run'], {'GITHUB_REF': 'refs/heads/main', 'STAGE': 'apply-migration', 'CONFIRM': 'check'},
              'explicit stage confirmation'),
             (['run'], {'GITHUB_REF': 'refs/heads/main', 'STAGE': 'push', 'CONFIRM': 'push'},
              'explicit stage confirmation'),
             (['run'], {'GITHUB_REF': 'refs/heads/main', 'STAGE': '', 'CONFIRM': ''}, 'explicit stage confirmation')]
    for argv, env, expected in cases:
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, env))
            mocks = [stack.enter_context(patch.object(m, name)) for name in untouched]
            stops(lambda: m.main(argv), expected)
            for mock in mocks:
                mock.assert_not_called()
    ok('unknown subcommand, non-main ref (branch or PR) and unconfirmed or unknown stage refused before files, '
       'CLI or connection')

    (source, rollback), _ = quiet(lambda: m.files_gate(ROOT))
    assert hashlib.sha256(source).hexdigest() == m.SOURCE_SHA256 and len(source) == m.SOURCE_BYTES
    assert hashlib.sha256(rollback).hexdigest() == m.ROLLBACK_SHA256 and len(rollback) == m.ROLLBACK_BYTES
    ok('the repository holds the approved bytes: migration e6737493… (16,405), rollback 08a2a897… (1,724)')
    fake = tmp / 'files'
    for rel in (m.SOURCE, m.ROLLBACK):
        (fake / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / rel, fake / rel)
    quiet(lambda: m.files_gate(fake))
    flip = lambda data: data[:-1] + bytes([data[-1] ^ 1])  # noqa: E731
    (fake / m.SOURCE).write_bytes(flip(source))
    stops(lambda: m.files_gate(fake), 'migration bytes and checksum (16,405 bytes, SHA-256 e6737493…)')
    (fake / m.SOURCE).write_bytes(source + b'\n')
    stops(lambda: m.files_gate(fake), 'migration bytes and checksum (16,405 bytes, SHA-256 e6737493…)')
    (fake / m.SOURCE).write_bytes(source)
    (fake / m.ROLLBACK).write_bytes(flip(rollback))
    stops(lambda: m.files_gate(fake), 'rollback bytes and checksum (1,724 bytes, SHA-256 08a2a897…)')
    (fake / m.ROLLBACK).write_bytes(rollback)
    top = fake / 'supabase/migrations/20261029120000_dashboard_milestone_reviews.sql'
    top.write_bytes(source)
    stops(lambda: m.files_gate(fake), 'no top-level copy (no integration can pick it up)')
    top.unlink()
    second = fake / 'supabase/migrations/pending/20261029130000_dashboard_milestone_reviews.sql'
    second.write_bytes(source)
    stops(lambda: m.files_gate(fake), 'exactly one copy, in pending/')
    second.unlink()
    extra = fake / 'supabase/migrations/rollback/20261029130000_dashboard_milestone_reviews.rollback.sql'
    extra.write_bytes(rollback)
    stops(lambda: m.files_gate(fake), 'exactly one rollback')
    extra.unlink()
    (fake / m.SOURCE).unlink()
    stops(lambda: m.files_gate(fake), 'migration bytes and checksum (16,405 bytes, SHA-256 e6737493…)')
    ok('one-bit and one-byte changes to either file, a top-level copy, a second pending copy, a second rollback and '
       'a missing file are all refused')

    with patch.dict(os.environ, {'PGPASSWORD': 'x', 'SUPABASE_ACCESS_TOKEN': 'x', 'SUPABASE_DB_PASSWORD': 'x'}):
        env = m.cli_env()
    assert not any(k.startswith('PG') or k in ('SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD') for k in env)
    assert env['DO_NOT_TRACK'] == '1' and env['SUPABASE_TELEMETRY_DISABLED'] == '1'
    quiet(lambda: m.cli_gate(CLI))
    stops(lambda: m.cli_gate(script(tmp / 'old-cli', 'echo 2.120.0')), f'pinned Supabase CLI {m.CLI_VERSION}')
    stops(lambda: m.cli_gate(script(tmp / 'flagless-cli', 'if [ "$1" = --version ]; then echo 2.121.0; else echo usage; fi')),
          'reviewed repair flags')
    ok('the real CLI is exactly 2.121.0 with --db-url, --status and --workdir; another version or a CLI without '
       'those flags refused; no credential variables and telemetry off in its environment')

    for env, expected in (({'SUPABASE_POOLER_HOST': 'db.jncvvsvckxhqgqvkppmj.supabase.co', 'SUPABASE_DB_PASSWORD': 'x'},
                           'approved session pooler'),
                          ({'SUPABASE_POOLER_HOST': 'aws-0-us-east-1.pooler.supabase.com.evil.test',
                            'SUPABASE_DB_PASSWORD': 'x'}, 'approved session pooler'),
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
    OUTPUT[-1] = '\n'.join(line for line in out.splitlines() if line not in masks)
    assert prod.env['PGUSER'] == f'postgres.{m.REF}' and prod.env['PGSSLMODE'] == 'require'
    assert prod.env['PGHOST'] == 'aws-0-us-east-1.pooler.supabase.com' and prod.env['PGPORT'] == '5432'
    assert prod.db_url.endswith('@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require')
    assert urllib.parse.quote(secret, safe='') in prod.db_url
    ok('direct host, look-alike host or loopback refused; pooler user, TLS required, URL-encoded password masked '
       'three ways')

    # The identity gate against the loopback server: each of its three checks fails closed in turn.
    pooler_password = hashlib.sha256(os.urandom(32)).hexdigest()[:24]
    psql(f'DROP ROLE IF EXISTS "{POOLER_ROLE}"', 'postgres')
    psql(f'''CREATE ROLE "{POOLER_ROLE}" LOGIN PASSWORD '{pooler_password}' ''', 'postgres')
    try:
        base = {k: v for k, v in BASE_ENV.items() if not k.startswith('PG')} | {
            'PGHOST': '127.0.0.1', 'PGPORT': '5432', 'PGDATABASE': 'postgres', 'PGCONNECT_TIMEOUT': '10'}
        superuser = base | {'PGUSER': 'postgres', 'PGSSLMODE': 'require'} | ({'PGPASSWORD': PASSWORD} if PASSWORD else {})
        stops(lambda: m.identity(m.Target(superuser, '')), 'connection identity')
        plain = base | {'PGUSER': POOLER_ROLE, 'PGPASSWORD': pooler_password, 'PGSSLMODE': 'disable'}
        stops(lambda: m.identity(m.Target(plain, '')), 'runner connection uses TLS')
        tls = plain | {'PGSSLMODE': 'require'}
        stops(lambda: m.identity(m.Target(tls, '')), 'postgres role and database')
    finally:
        psql(f'DROP ROLE IF EXISTS "{POOLER_ROLE}"', 'postgres')
    ok('identity: another user, then no TLS, then a session that is not postgres/postgres each refused')


# ── 4. refusals before any write ─────────────────────────────────────────────────────────────────────────────────

def test_refusals(files, tripwire):
    print('== drifted production states refused before any write', flush=True)
    cases = [
        ("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261029000001', 'later')",
         'a later migration moved the head'),
        ("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261029163000', "
         "'dashboard_milestone_reviews')", 'G2 recorded under another version (an MCP stamp)'),
        ("DELETE FROM supabase_migrations.schema_migrations WHERE version = '20250101010000'", 'a history row missing'),
        ('CREATE FUNCTION private.dashboard_milestone_reviews_guard() RETURNS trigger LANGUAGE plpgsql '
         'AS $x$ BEGIN RETURN NEW; END $x$', 'a partial object (the guard function alone)'),
    ]
    for change, why in cases:
        fresh()
        psql(change)
        before = digest()
        for stage in m.STAGES:
            stops(lambda: m.run_stage(stage, target(), m.PRODUCTION, files, tripwire), 'recognized production state')
        assert digest() == before, f'changed after: {why}'
        assert not Path(tripwire + '.called').exists(), f'CLI invoked despite: {why}'
    ok(f'{len(cases)} unrecognized states (later head, G2 under another version, a missing row, a partial object) '
       'refused by all four stages; nothing written; the CLI never invoked')
    fresh()
    psql("""CREATE OR REPLACE FUNCTION public.get_org_id() RETURNS uuid LANGUAGE sql STABLE
            AS $x$ SELECT NULL::uuid $x$""")
    before = digest()
    for stage in ('check', 'apply-migration'):
        stops(lambda: m.run_stage(stage, target(), m.PRODUCTION, files, tripwire),
              'public.get_org_id() is the reviewed definition')
    assert digest() == before and state() == 'before'
    ok('a changed public.get_org_id() (the RLS dependency) blocks check and apply-migration')
    fresh()
    before = digest()
    stops(lambda: m.run_stage('record-history', target(), m.PRODUCTION, files, tripwire),
          'record-history needs the applied state')
    stops(lambda: m.run_stage('rollback-migration', target(), m.PRODUCTION, files, tripwire),
          'rollback-migration needs an installed state')
    assert digest() == before and not Path(tripwire + '.called').exists()
    ok('out-of-order stages refused in the before state (record-history, rollback-migration)')


# ── 5. the release under live CRM traffic ────────────────────────────────────────────────────────────────────────

def crm_traffic(seconds):
    return subprocess.Popen(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
                             f'CALL dmr_t.crm_activity({seconds})'], env=DB_ENV,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)


def crm_count():
    return int(psql('select n from dmr_t.crm_counter'))


def test_release_under_crm_traffic(files, root, markers):
    print('== the full release with ordinary CRM traffic running (insert/update/delete clients, committed)', flush=True)
    fresh()
    pre_release = quiet(lambda: m.snapshot(target()))[0]
    result, out = quiet(lambda: m.run_stage('check', target(), m.PRODUCTION, files, CLI))
    assert result == 'before' and 'CHECK COMPLETE' in out
    ok('check: before, read-only')
    with Recorder() as rec:
        traffic = crm_traffic(8)
        time.sleep(1.0)
        start = crm_count()
        result, out = quiet(lambda: m.run_stage('apply-migration', target(), m.PRODUCTION, files, CLI))
        during = crm_count()
        snap = quiet(lambda: m.snapshot(target()))[0]
        _, err = traffic.communicate(timeout=60)
        assert traffic.returncode == 0, f'CRM traffic failed: {err[:300]}'
        after_traffic = quiet(lambda: m.snapshot(target()))[0]
        assert result == 'applied' and 'STOP HERE' in out, out
        assert during > start and crm_count() > during, (start, during)
        assert snap == after_traffic, 'CRM traffic changed the schema fingerprint'
        ok(f'apply-migration: applied while CRM traffic committed {crm_count()} client write cycles; the traffic '
           'never failed; the schema fingerprint ignores CRM rows')
        result, out = quiet(lambda: m.run_stage('check', target(), m.PRODUCTION, files, CLI))
        assert result == 'applied' and 'REVIEW ROWS: 0' in out
        ok('check: applied, every read-back passes, no review rows')
        traffic = crm_traffic(4)
        result, out = quiet(lambda: m.run_stage('record-history', target(), m.PRODUCTION, files, CLI))
        assert traffic.wait(timeout=60) == 0
        assert result == 'recorded' and 'STOP HERE' in out
    row = psql(f"""select concat_ws('|', count(*) over (), version, name, cardinality(statements),
        encode(sha256(convert_to(array_to_string(statements, ''), 'UTF8')), 'hex'))
        from supabase_migrations.schema_migrations where version > '20261028040215'""")
    assert row == f'1|{m.VERSION}|{m.NAME}|{m.RECORDED_STATEMENTS}|{m.RECORDED_DIGEST}', row
    ok(f'record-history (real CLI, a role limited to the history table, CRM traffic running): exactly one row, '
       f'{m.VERSION} / {m.NAME}, {m.RECORDED_STATEMENTS} statements, digest {m.RECORDED_DIGEST[:8]}…')
    result, _ = quiet(lambda: m.run_stage('check', target(), m.PRODUCTION, files, CLI))
    assert result == 'recorded'
    stops(lambda: m.run_stage('apply-migration', target(), m.PRODUCTION, files, CLI),
          'apply-migration needs the before state')
    stops(lambda: m.run_stage('record-history', target(), m.PRODUCTION, files, CLI),
          'record-history needs the applied state')
    ok('check: recorded; a second apply-migration or record-history is refused')
    assert rec.bodies == [m.SOURCE_SHA256], rec.bodies
    assert all(c == [CLI, '--version'] or c == [CLI, 'migration', 'repair', '--help'] or
               c[:5] == [CLI, 'migration', 'repair', m.VERSION, '--status'] for c in rec.commands), rec.commands
    assert [c[5] for c in rec.commands if len(c) > 5] == ['applied'], rec.commands
    assert no_decoys(markers)
    ok('the only SQL executed was the approved migration (by SHA-256, once); the only CLI call was one '
       'migration repair; the decoy migrations in the checkout never ran')
    return pre_release


# ── 6. interrupted stages and their recovery ─────────────────────────────────────────────────────────────────────

def hold_client_lock(seconds):
    holder = subprocess.Popen(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                               '-c', 'BEGIN', '-c', f"UPDATE public.clients SET first_name = 'held' WHERE id = '{CLIENT}'",
                               '-c', f'SELECT pg_sleep({seconds})', '-c', 'COMMIT'],
                              env=DB_ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        if psql("""select count(*) from pg_locks l join pg_class c on c.oid = l.relation
                   where c.relname = 'clients' and l.mode = 'RowExclusiveLock' and l.granted
                     and l.pid <> pg_backend_pid()""") != '0':
            return holder
        time.sleep(0.05)
    raise AssertionError('lock holder never acquired its lock')


def test_interrupted_recovery(files, tmp):
    print('== interrupted stages: each leaves a recognized state, and the next approved run recovers', flush=True)
    fresh()
    before = digest()
    holder = hold_client_lock(6)
    out = stops(lambda: m.run_stage('apply-migration', target(), m.PRODUCTION, files, CLI),
                'lock not acquired within 2 s (lock_timeout); the transaction rolled back')
    holder.wait(timeout=30)
    assert 'STATE AFTER FAILURE: before' in out and state() == 'before'
    ok('a long client transaction holding its lock: lock_timeout aborts the whole migration; state before')
    holder = hold_client_lock(6)
    with patch.object(m, 'WATCHDOG_SECONDS', 0.5):
        out = stops(lambda: m.run_stage('apply-migration', target(), m.PRODUCTION, files, CLI),
                    'watchdog cancelled psql; verify state independently; no automatic retry')
    holder.wait(timeout=30)
    assert 'STATE AFTER FAILURE: before' in out and state() == 'before'
    ok('the watchdog interrupts a stalled psql; the transaction rolls back; state before')
    holder = hold_client_lock(6)
    timer = threading.Timer(0.7, os.kill, (os.getpid(), signal.SIGTERM))
    timer.start()
    out = stops(lambda: m.run_stage('apply-migration', target(), m.PRODUCTION, files, CLI),
                'cancelled; verify database state before any further action')
    timer.join()
    holder.wait(timeout=30)
    assert 'STATE AFTER FAILURE: before' in out and state() == 'before'
    assert signal.getsignal(signal.SIGTERM) == signal.SIG_DFL, 'the cancel handler outlived the transaction'
    assert digest().split('|')[2:] == before.split('|')[2:] == ['0', '0']
    ok('a cancelled job (SIGTERM) interrupts psql and rolls back; state before; the handler is removed afterwards')
    result, _ = quiet(lambda: m.run_stage('apply-migration', target(), m.PRODUCTION, files, CLI))
    assert result == 'applied'
    ok('recovery: the next approved apply-migration from before succeeds')

    fresh()
    psql(None, stdin=(ROOT / m.SOURCE).read_text())  # a runner that died after its commit
    result, out = quiet(lambda: m.run_stage('check', target(), m.PRODUCTION, files, CLI))
    assert result == 'applied' and 'REVIEW ROWS: 0' in out
    stops(lambda: m.run_stage('apply-migration', target(), m.PRODUCTION, files, CLI),
          'apply-migration needs the before state')
    ok('a runner lost after the commit: check reports applied with every read-back; apply-migration is refused')
    out = stops(lambda: m.run_stage('record-history', target(), m.PRODUCTION, files, script(tmp / 'silent-cli', 'exit 0')),
                'history holds exactly one more row: G2')
    assert state() == 'applied'
    ok('a CLI that reports success but writes nothing is caught; state stays applied')
    lost = script(tmp / 'lost-cli', f'"{CLI}" "$@" >/dev/null 2>&1\nexit 1')
    out = stops(lambda: m.run_stage('record-history', target(), m.PRODUCTION, files, lost),
                'command failed; verify state independently; no automatic retry')
    assert 'STATE AFTER FAILURE: recorded' in out and state() == 'recorded'
    result, _ = quiet(lambda: m.run_stage('check', target(), m.PRODUCTION, files, CLI))
    assert result == 'recorded'
    stops(lambda: m.run_stage('record-history', target(), m.PRODUCTION, files, CLI),
          'record-history needs the applied state')
    ok('a record-history lost after the CLI wrote the row: reported as recorded; check verifies it; a re-run is refused')

    no_revert = script(tmp / 'no-revert-cli', f'case "$*" in *reverted*) exit 1;; esac\nexec "{CLI}" "$@"')
    out = stops(lambda: m.run_stage('rollback-migration', target(), m.PRODUCTION, files, no_revert),
                'command failed; verify state independently; no automatic retry')
    assert 'STATE AFTER FAILURE: reverted-recorded' in out and state() == 'reverted-recorded'
    result, out = quiet(lambda: m.run_stage('check', target(), m.PRODUCTION, files, CLI))
    assert result == 'reverted-recorded'
    for stage in ('apply-migration', 'record-history'):
        stops(lambda: m.run_stage(stage, target(), m.PRODUCTION, files, CLI),
              f'{stage} needs the {"before" if stage == "apply-migration" else "applied"} state')
    result, _ = quiet(lambda: m.run_stage('rollback-migration', target(), m.PRODUCTION, files, CLI))
    assert result == 'before' and state() == 'before'
    ok('a rollback lost between its SQL and the history revert: reported as reverted-recorded; only '
       'rollback-migration may continue, and it completes to before')


# ── 7. rollback never destroys review records ────────────────────────────────────────────────────────────────────

def add_review_row():
    # Through the real RPC, as a signed-in agent (the way the Dashboard stores one).
    return psql(None, stdin=f"""
SET ROLE authenticated;
SELECT dmr_t.claims('{AGENT}', '{ORG}');
SELECT (public.set_dashboard_milestone_review('client_birthday', '{CLIENT}', 'birthday', '2026-11-02', 'reviewed')).id;
""").splitlines()[-1]


def test_rollback_protects_reviews(files, pre_release):
    print('== rollback refuses while any milestone review row exists', flush=True)
    fresh()
    quiet(lambda: m.run_stage('apply-migration', target(), m.PRODUCTION, files, CLI))
    quiet(lambda: m.run_stage('record-history', target(), m.PRODUCTION, files, CLI))
    review = add_review_row()
    assert re.fullmatch(r'[0-9a-f-]{36}', review), review
    rows_before = psql('select md5(string_agg(r::text, E\'\\n\')) from public.dashboard_milestone_reviews r')
    out = stops(lambda: m.run_stage('rollback-migration', target(), m.PRODUCTION, files, CLI),
                'no milestone review rows exist (rollback never destroys review records)')
    assert state() == 'recorded'
    ok('a review row stored through the real RPC: rollback-migration refused before any write; state recorded')
    with patch.object(m, 'review_rows', lambda target_: 0):  # a row that appears after the pre-check
        out = stops(lambda: m.run_stage('rollback-migration', target(), m.PRODUCTION, files, CLI),
                    'milestone review rows exist: rollback refused; it needs a separately approved, verified '
                    'recovery procedure')
    assert 'STATE AFTER FAILURE: recorded' in out and state() == 'recorded'
    assert psql('select md5(string_agg(r::text, E\'\\n\')) from public.dashboard_milestone_reviews r') == rows_before
    ok('a row that slips past the pre-check is caught inside the rollback transaction (ACCESS EXCLUSIVE + check): '
       'nothing dropped; the review row is intact')
    psql(f"DELETE FROM public.dashboard_milestone_reviews WHERE id = '{review}'")
    result, _ = quiet(lambda: m.run_stage('rollback-migration', target(), m.PRODUCTION, files, CLI))
    assert result == 'before' and state() == 'before'
    assert quiet(lambda: m.snapshot(target()))[0][0] == pre_release[0]
    ok('with no review rows, rollback-migration from recorded returns the exact pre-release schema fingerprint')
    quiet(lambda: m.run_stage('apply-migration', target(), m.PRODUCTION, files, CLI))
    result, _ = quiet(lambda: m.run_stage('rollback-migration', target(), m.PRODUCTION, files, CLI))
    assert result == 'before' and state() == 'before'
    ok('rollback-migration from applied (never recorded) returns to before, with no history change')


# ── 8. the read-back catches drift ───────────────────────────────────────────────────────────────────────────────

def test_readback_catches(files):
    print('== the read-back catches a weakened or altered object (each on a fresh apply)', flush=True)
    cases = [
        ('GRANT SELECT ON public.dashboard_milestone_reviews TO anon',
         'table grants: authenticated SELECT/INSERT/UPDATE/DELETE, service_role SELECT; nothing for anon or PUBLIC'),
        ('GRANT TRUNCATE ON public.dashboard_milestone_reviews TO authenticated',
         'table grants: authenticated SELECT/INSERT/UPDATE/DELETE, service_role SELECT; nothing for anon or PUBLIC'),
        ('ALTER TABLE public.dashboard_milestone_reviews FORCE ROW LEVEL SECURITY',
         'RLS enabled (not forced), owned by postgres, documented'),
        ('ALTER TABLE public.dashboard_milestone_reviews DISABLE ROW LEVEL SECURITY',
         'RLS enabled (not forced), owned by postgres, documented'),
        ('DROP POLICY dashboard_milestone_reviews_select ON public.dashboard_milestone_reviews; '
         'CREATE POLICY dashboard_milestone_reviews_select ON public.dashboard_milestone_reviews FOR SELECT '
         'TO authenticated USING (true)', 'policy expressions: own user, own organization, visible client'),
        ('ALTER POLICY dashboard_milestone_reviews_delete ON public.dashboard_milestone_reviews TO authenticated, anon',
         'four permissive policies, all TO authenticated'),
        ('ALTER FUNCTION public.set_dashboard_milestone_review(text, uuid, text, date, text, timestamptz) SECURITY DEFINER',
         'functions: SECURITY INVOKER, pinned search_path and bodies; RPC EXECUTE for authenticated only; the guard '
         'function executable by no client role'),
        ('GRANT EXECUTE ON FUNCTION private.dashboard_milestone_reviews_guard() TO authenticated',
         'functions: SECURITY INVOKER, pinned search_path and bodies; RPC EXECUTE for authenticated only; the guard '
         'function executable by no client role'),
        ('GRANT EXECUTE ON FUNCTION public.clear_dashboard_milestone_review(uuid, timestamptz) TO PUBLIC',
         'functions: SECURITY INVOKER, pinned search_path and bodies; RPC EXECUTE for authenticated only; the guard '
         'function executable by no client role'),
        ('ALTER TABLE public.dashboard_milestone_reviews DROP CONSTRAINT dashboard_milestone_reviews_year_check',
         'primary key, three cascading foreign keys and five checks, as reviewed'),
        ('DROP INDEX public.dashboard_milestone_reviews_first_payment_key; CREATE UNIQUE INDEX '
         'dashboard_milestone_reviews_first_payment_key ON public.dashboard_milestone_reviews (organization_id, '
         'user_id, client_id)', 'the five indexes, partial predicates included, as reviewed'),
        ('ALTER TABLE public.dashboard_milestone_reviews DISABLE TRIGGER dashboard_milestone_reviews_guard',
         'the guard trigger, enabled, and only it'),
        ('ALTER TABLE public.dashboard_milestone_reviews ALTER COLUMN remind_at SET NOT NULL',
         'the twelve columns, types, nullability and defaults'),
    ]
    fresh()
    quiet(lambda: m.run_stage('apply-migration', target(), m.PRODUCTION, files, CLI))
    for change, expected in cases:
        psql(None, stdin=f'BEGIN; {change}; COMMIT;')
        stops(lambda: m.run_stage('check', target(), m.PRODUCTION, files, CLI), expected)
        fresh()
        quiet(lambda: m.run_stage('apply-migration', target(), m.PRODUCTION, files, CLI))
    ok(f'{len(cases)} weakened or altered objects (grants, RLS, policies, SECURITY DEFINER, EXECUTE, a check, a '
       'partial index, the trigger, a column) each fail the read-back with the matching label')
    fresh()
    real_apply = m.apply

    def apply_with_side_effect(target_, source_bytes):
        real_apply(target_, source_bytes)
        psql('ALTER TABLE public.clients ADD COLUMN side_effect text')

    with patch.object(m, 'apply', apply_with_side_effect):
        stops(lambda: m.run_stage('apply-migration', target(), m.PRODUCTION, files, CLI),
              'every unrelated schema object unchanged')
    ok('an unrelated schema change during apply-migration is caught by the fingerprint')
    fresh()
    first = quiet(lambda: m.snapshot(target()))[0]
    psql(None, stdin=f"""UPDATE public.clients SET first_name = 'changed';
DELETE FROM public.clients WHERE id <> '{CLIENT}';
INSERT INTO public.clients (id, organization_id, first_name) SELECT gen_random_uuid(), '{ORG}', 'x' FROM generate_series(1, 50);
ANALYZE public.clients;
VACUUM public.clients;
""")
    assert quiet(lambda: m.snapshot(target()))[0] == first
    ok('mass client updates, deletes, inserts, ANALYZE and VACUUM leave the fingerprint unchanged (no false failure)')


def test_no_secret_printed():
    print('== nothing the runner printed contains a credential', flush=True)
    text = '\n'.join(OUTPUT)
    for secret in filter(None, (ROLE_PASSWORD, PASSWORD, urllib.parse.quote(ROLE_PASSWORD, safe=''))):
        assert secret not in text
    assert 'postgresql://' not in text
    ok(f'{len(OUTPUT)} captured runs: no password, no connection URL')


def main():
    prove_local()
    psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)', 'postgres')
    psql(f'DROP ROLE IF EXISTS {ROLE}', 'postgres')
    psql(f"CREATE ROLE {ROLE} LOGIN PASSWORD '{ROLE_PASSWORD}'", 'postgres')
    tmp = Path(tempfile.mkdtemp(prefix='dmr-release-test-'))
    try:
        tripwire = script(tmp / 'tripwire-cli', 'touch "$0.called"\nexit 1')
        root, markers = checkout_with_decoys(tmp)
        files, _ = quiet(lambda: m.files_gate(root))
        test_workflow_and_runner_text()
        test_environment_guard()
        test_entry_gates(tmp)
        test_refusals(files, tripwire)
        pre_release = test_release_under_crm_traffic(files, root, markers)
        test_interrupted_recovery(files, tmp)
        test_rollback_protects_reviews(files, pre_release)
        test_readback_catches(files)
        assert no_decoys(markers) and not Path(tripwire + '.called').exists()
        test_no_secret_printed()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)', 'postgres')
        psql(f'DROP ROLE IF EXISTS {ROLE}', 'postgres')
    print(f'ALL PASSED: {PASSES} checks', flush=True)


if __name__ == '__main__':
    main()
