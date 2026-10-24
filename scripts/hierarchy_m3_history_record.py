#!/usr/bin/env python3
"""Hierarchy M3 history-only record (Gate 2c closeout).

M3 (supabase/migrations/pending/20261023210200_hierarchy_path_repair.sql, SHA-256 2da22c6f…) ran ONCE in production,
through the Supabase SQL Editor, at 2026-10-24 04:58:12 UTC. It is not in supabase_migrations.schema_migrations. This
runner records it as 20261024045812 with Supabase's official `supabase migration repair --status applied` (CLI
2.121.0, as in the Google Sheets record-history stage). Rehearsed with log_statement = all, the CLI sends one
parameterized INSERT … ON CONFLICT (version) DO UPDATE SET name, statements: M3's SQL is a text parameter only and
is never executed. The CLI splits the file on the client, so the row holds 4 statements whose concatenation hashes
to 80b363c5…, not the file's 2da22c6f…. This runner never runs db push, migration up, psql -f or M3's SQL, and it
writes nothing but that one history row.

Subcommands:
  guard-environment  secret-free: reads the protected environment with the run's own token; fails closed unless the
                     required reviewer is exactly cgarness, deployments come from main only and admin bypass is off.
  run                the stage in STAGE / CONFIRM: check (read-only) or record-history (the one approved write).

Plan: implementation_plan.md (2026-10-24 hierarchy closeout) §C–§F. Evidence:
docs/plans/2026-10-23-hierarchy-stabilization/verification.md §13. Proof: scripts/tests/
hierarchy_m3_history_record_test.py (loopback PostgreSQL, the real pinned CLI, synthetic history).
"""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

REF = 'jncvvsvckxhqgqvkppmj'
REPOSITORY = 'cgarness/agentflow-life-insure'
ENVIRONMENT = 'google-sheets-production'
REVIEWER = 'cgarness'
VERSION = '20261024045812'
NAME = 'hierarchy_path_repair'
AUTHORED_VERSION = '20261023210200'
SOURCE = Path('supabase/migrations/pending/20261023210200_hierarchy_path_repair.sql')
SOURCE_SHA256 = '2da22c6f45163174c26b7edff75e73bb5a286ec9c87f12bfcabf3a0dc57a4c6b'
CLI_VERSION = '2.121.0'
# What CLI 2.121.0 records for these bytes (rehearsed; reproduced by the test with the real CLI).
RECORDED_STATEMENTS = 4
RECORDED_DIGEST = '80b363c573d9d2028aedc2dd8def58b0c8b50f99db3ff1872138b5ffa29c0af0'
STAGES = ('check', 'record-history')


@dataclass(frozen=True)
class Expect:
    rows_before: int
    head_before: str
    pinned_rows: tuple  # (version, name, statements, sha256 of the concatenation) as recorded by MCP apply_migration
    four_ids8: tuple
    id_fingerprint: str
    target_fingerprint: str  # md5 of id=hierarchy_path over the four rows: their stored paths are the reviewed targets


PRODUCTION = Expect(
    rows_before=345,
    head_before='20261023232435',
    pinned_rows=(
        ('20261023210027', 'hierarchy_authorization_boundaries', 1,
         '5d99c92328a507451968133603c8f53cd13a782a9749637dfc32d449e137d5df'),
        ('20261023232435', 'hierarchy_integrity', 1,
         '7f2c61dbdfdd39938d424bc26e024c81c823a5a41692c5a0607a8bff87377aa3'),
    ),
    four_ids8=('4ef505e0', '5f952f0d', '89f2e994', 'e5c4ee04'),
    id_fingerprint='ddc1f53f3823c6e367310a748ea0ac85',
    target_fingerprint='7daae418571600b43b7cf5d5155be0d4',
)


@dataclass(frozen=True)
class Target:
    env: dict     # libpq environment for psql (the password lives only here)
    db_url: str   # the CLI needs a URL; masked before use and never printed


class Stop(Exception):
    pass


def require(condition, label):
    if not condition:
        raise Stop(label)
    print(f'PASS: {label}', flush=True)


def command(args, env=None, timeout=60, cwd=None):
    # Only the callers' fixed labels reach the log: output and errors can carry the URL, SQL or hostnames.
    try:
        result = subprocess.run(args, env=env, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise Stop('command timed out; verify state independently; no automatic retry') from None
    if result.returncode:
        raise Stop('command failed; verify state independently; no automatic retry')
    return result.stdout.strip()


def clean_env():
    return {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'SUPABASE_'))}


def cli_env():
    # No credential variables reach the CLI, and its usage telemetry stays off (it honours both switches).
    return clean_env() | {'DO_NOT_TRACK': '1', 'SUPABASE_TELEMETRY_DISABLED': '1'}


def sql(target, query):
    # Every check runs read-only in its own session. Booleans are compared as ::text ('true'): concat_ws
    # would render them with the output function ('t').
    return command(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                    '-c', 'SET default_transaction_read_only = on',
                    '-c', "SET statement_timeout = '30s'",
                    '-c', query], target.env)


def mask(*values):
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        for value in values:
            print('::add-mask::' + value.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A'), flush=True)


# ── repository, CLI and connection gates ──────────────────────────────────────────────────────────────────────────

def files_gate(root):
    source = root / SOURCE
    require(source.is_file() and hashlib.sha256(source.read_bytes()).hexdigest() == SOURCE_SHA256,
            'M3 source bytes (SHA-256 2da22c6f…)')
    top = sorted((root / 'supabase/migrations').glob('*_hierarchy_path_repair.sql'))
    require(not top, 'no top-level M3 file before the history record')
    return source.read_bytes()


def cli_gate(cli):
    require(command([cli, '--version'], cli_env()) == CLI_VERSION, f'pinned Supabase CLI {CLI_VERSION}')
    repair_help = command([cli, 'migration', 'repair', '--help'], cli_env())
    require(all(flag in repair_help for flag in ('--db-url', '--status', '--workdir')), 'reviewed repair flags')


def production_target():
    host = os.environ.get('SUPABASE_POOLER_HOST', '')
    password = os.environ.get('SUPABASE_DB_PASSWORD', '')
    require(bool(re.fullmatch(r'aws-[0-9]+-us-east-1\.pooler\.supabase\.com', host)), 'approved session pooler')
    require(bool(password), 'database credential present')
    user = f'postgres.{REF}'
    encoded = urllib.parse.quote(password, safe='')
    url = f'postgresql://{user}:{encoded}@{host}:5432/postgres?sslmode=require'
    mask(password, encoded, url)
    # Only psql receives the password through its environment, and only the CLI receives the URL; neither in a log.
    env = clean_env() | {
        'PGHOST': host, 'PGPORT': '5432', 'PGDATABASE': 'postgres', 'PGUSER': user, 'PGPASSWORD': password,
        'PGSSLMODE': 'require', 'PGCONNECT_TIMEOUT': '10', 'PGAPPNAME': 'agentflow-hierarchy-m3-history',
    }
    return Target(env, url)


def identity(target):
    env = target.env
    require(command(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', r'\echo :HOST :PORT :DBNAME :USER'], env) ==
            f"{env['PGHOST']} 5432 postgres postgres.{REF}", 'connection identity')
    require('SSL connection (protocol:' in command(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', r'\conninfo'],
                                                   env), 'runner connection uses TLS')
    require(sql(target, "select current_user || '|' || current_database()") == 'postgres|postgres',
            'postgres role and database')


# ── read-only state ───────────────────────────────────────────────────────────────────────────────────────────────

def history_state(target):
    return sql(target, f"""select concat_ws('|', count(*), max(version),
        count(*) filter (where version = '{VERSION}'),
        count(*) filter (where name = '{NAME}' or version = '{AUTHORED_VERSION}'))
        from supabase_migrations.schema_migrations""")


def expected_state(expect, state):
    return {'before': f'{expect.rows_before}|{expect.head_before}|0|0',
            'recorded': f'{expect.rows_before + 1}|{VERSION}|1|1'}[state]


def classify(target, expect):
    current = history_state(target)
    states = {expected_state(expect, key): key for key in ('before', 'recorded')}
    require(current in states, 'recognized history state')
    print('STATE: ' + states[current], flush=True)
    return states[current]


def pinned_rows_gate(target, expect):
    versions = ','.join(f"'{row[0]}'" for row in expect.pinned_rows)
    rows = sql(target, f"""select concat_ws('|', version, name, cardinality(statements),
        encode(sha256(convert_to(array_to_string(statements, ''), 'UTF8')), 'hex'))
        from supabase_migrations.schema_migrations where version in ({versions}) order by version""")
    require(rows.splitlines() == ['|'.join(map(str, row)) for row in expect.pinned_rows],
            'M1 and M2 recorded as reviewed')


def hierarchy_gate(target, expect):
    require(sql(target, """select concat_ws('|', stale_paths, null_paths, missing_pairs, extra_pairs, self_parents,
                cross_org_edges, unreachable, (path_pairs = expected_pairs)::text) from private.hierarchy_consistency()""") ==
            '0|0|0|0|0|0|0|true', 'hierarchy consistent: 0 stale, NULL, missing, extra or invalid; all pairs present')
    ids8 = ','.join(f"'{x}'" for x in expect.four_ids8)
    require(sql(target, f"""select concat_ws('|', count(*), md5(string_agg(id::text, ',' order by id)),
                md5(string_agg(id::text || '=' || hierarchy_path::text, ',' order by id)))
                from public.profiles where left(id::text, 8) in ({ids8})""") ==
            f'4|{expect.id_fingerprint}|{expect.target_fingerprint}',
            "the four reviewed rows hold exactly the reviewed target paths (M3's effect is live)")


def snapshot(target):
    # Full-row digests: every other history row, and the profile columns a write could touch.
    other = sql(target, f"""select count(*) || '|' || md5(string_agg(t::text, E'\\n' order by version))
        from supabase_migrations.schema_migrations t where version <> '{VERSION}'""")
    profiles = sql(target, """select count(*) || '|' || md5(string_agg(concat_ws('|', id, upline_id, hierarchy_path,
        updated_at, organization_id, role, status), E'\\n' order by id)) from public.profiles""")
    return other, profiles


def recorded_row(target):
    return sql(target, f"""select concat_ws('|', name, cardinality(statements),
        encode(sha256(convert_to(array_to_string(statements, ''), 'UTF8')), 'hex'),
        (created_by is null)::text, (idempotency_key is null)::text, (rollback is null)::text)
        from supabase_migrations.schema_migrations where version = '{VERSION}'""")


def verify_recorded(target, expect, before=None):
    require(history_state(target) == expected_state(expect, 'recorded'), 'history holds exactly one more row: M3')
    require(recorded_row(target) == f'{NAME}|{RECORDED_STATEMENTS}|{RECORDED_DIGEST}|true|true|true',
            'recorded row: hierarchy_path_repair, 4 CLI statements, digest 80b363c5…')
    pinned_rows_gate(target, expect)
    hierarchy_gate(target, expect)
    other, profiles = snapshot(target)
    if before is None:
        require(other.split('|')[0] == str(expect.rows_before), 'every other history row present')
    else:
        require(other == before[0], 'every other history row byte-identical')
        require(profiles == before[1], 'profiles unchanged: no application data written')


# ── the one write ─────────────────────────────────────────────────────────────────────────────────────────────────

def repair(target, source_bytes, cli):
    # A temporary workdir holding only a byte copy of M3 at the recorded version, so main never carries an
    # unrecorded top-level M3. The CLI reads name and statements from this file; it executes none of it.
    work = Path(tempfile.mkdtemp(prefix='hier-m3-history-'))
    try:
        migrations = work / 'supabase' / 'migrations'
        migrations.mkdir(parents=True)
        staged = migrations / f'{VERSION}_{NAME}.sql'
        staged.write_bytes(source_bytes)
        require(hashlib.sha256(staged.read_bytes()).hexdigest() == SOURCE_SHA256, 'staged copy is byte-identical')
        require([p.name for p in migrations.iterdir()] == [staged.name], 'the workdir holds only the M3 copy')
        command([cli, 'migration', 'repair', VERSION, '--status', 'applied', '--db-url', target.db_url,
                 '--workdir', str(work)], cli_env(), timeout=120, cwd=work)
        print(f'PASS: supabase migration repair {VERSION} --status applied completed', flush=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def run_stage(stage, target, expect, source_bytes, cli):
    require(stage in STAGES, 'known stage')
    state = classify(target, expect)
    pinned_rows_gate(target, expect)
    hierarchy_gate(target, expect)
    if stage == 'check':
        if state == 'recorded':
            verify_recorded(target, expect)
        print('CHECK COMPLETE: read-only; nothing was written.', flush=True)
        return state
    require(state == 'before', 'record-history needs the unrecorded state')
    before = snapshot(target)
    require(before[0].split('|')[0] == str(expect.rows_before), 'snapshot covers every history row')
    repair(target, source_bytes, cli)
    verify_recorded(target, expect, before)
    print('STOP HERE: independent read-only verification next; no further stage.', flush=True)
    return 'recorded'


# ── environment guard ─────────────────────────────────────────────────────────────────────────────────────────────

def github_get(path, token):
    request = urllib.request.Request('https://api.github.com' + path, headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise Stop(f'GitHub refused the environment read (HTTP {error.code}); fail closed') from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise Stop('GitHub environment read failed; fail closed') from None


def check_environment(environment, policies):
    require(environment.get('name') == ENVIRONMENT, f'environment {ENVIRONMENT}')
    reviewers = [reviewer for rule in environment.get('protection_rules') or []
                 if rule.get('type') == 'required_reviewers' for reviewer in rule.get('reviewers') or []]
    require([(r.get('type'), (r.get('reviewer') or {}).get('login')) for r in reviewers] == [('User', REVIEWER)],
            f'required reviewer is exactly {REVIEWER}')
    require(environment.get('can_admins_bypass') is False, 'administrator bypass disabled')
    require(environment.get('deployment_branch_policy') == {'protected_branches': False, 'custom_branch_policies': True},
            'custom deployment branch policy')
    names = [(p.get('name'), p.get('type', 'branch')) for p in policies.get('branch_policies') or []]
    require(policies.get('total_count') == 1 and names == [('main', 'branch')], 'deployments from main only')


def guard_environment():
    require(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY, 'expected repository')
    token = os.environ.get('GH_TOKEN', '')
    require(bool(token), 'run token present')
    base = f'/repos/{REPOSITORY}/environments/{ENVIRONMENT}'
    check_environment(github_get(base, token), github_get(base + '/deployment-branch-policies', token))


def main(argv):
    require(argv in (['guard-environment'], ['run']), 'known subcommand')
    if argv == ['guard-environment']:
        guard_environment()
        return
    stage = os.environ.get('STAGE', '')
    require(os.environ.get('GITHUB_REF') == 'refs/heads/main', 'main dispatch only')
    require(stage in STAGES and os.environ.get('CONFIRM') == stage, 'explicit stage confirmation')
    source_bytes = files_gate(Path.cwd())
    cli_gate('supabase')
    target = production_target()
    identity(target)
    run_stage(stage, target, PRODUCTION, source_bytes, 'supabase')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Stop as error:
        print('STOP: ' + str(error), flush=True)
        sys.exit(1)
    except BaseException:
        # Exceptions from subprocesses, URLs and JSON can include secrets. Do not print them.
        print('STOP: execution failed; no automatic retry. Verify production independently.', flush=True)
        sys.exit(1)
