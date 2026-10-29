#!/usr/bin/env python3
"""Dashboard milestone reviews — protected G2 release runner.

Applies ONLY the approved G2 migration supabase/migrations/pending/20261029120000_dashboard_milestone_reviews.sql
(16,405 bytes, SHA-256 e6737493…8806) to production jncvvsvckxhqgqvkppmj, in one psql transaction fed from the
checksummed bytes, then records it as 20261029120000 with the pinned CLI's `supabase migration repair --status
applied` from a temporary workdir that holds only a byte copy of that file. It never runs db push, migration up or
any other migration, and it never touches a frontend flag, a Vercel variable or a deploy.

Each stage is a separate dispatch with Chris's separate approval, then the protected environment's review:
  check               read-only: classify production and, once the objects exist, read them back
  apply-migration     before  -> applied  (the one schema write)
  record-history      applied -> recorded (one history row; no SQL executed)
  rollback-migration  applied | recorded | reverted-recorded -> before. REFUSES while any milestone review row
                      exists: destroying review records needs a separately approved, verified recovery procedure,
                      which this runner does not provide.

Production CRM activity (client inserts, updates, deletes) continues during a stage. No check here reads or
fingerprints CRM data: the invariants are the schema catalog outside the new objects and the migration history,
which that activity never changes. Lock contention is bounded by the migration's own lock_timeout (2 s): the whole
transaction rolls back and the state stays `before`.

Subcommands:
  guard-environment  secret-free: reads the protected environment with the run's own token; fails closed unless the
                     required reviewer is exactly cgarness, deployments come from main only and admin bypass is off.
  run                the stage in STAGE / CONFIRM.

Design: docs/plans/2026-10-29-dashboard-premium-redesign/g2-release-workflow-design.md. Proof:
scripts/tests/dashboard_milestones_release_test.py (loopback PostgreSQL, the real pinned CLI, synthetic history).
"""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
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
VERSION = '20261029120000'
NAME = 'dashboard_milestone_reviews'
SOURCE = Path('supabase/migrations/pending/20261029120000_dashboard_milestone_reviews.sql')
SOURCE_BYTES = 16405
SOURCE_SHA256 = 'e673749357f7612991cccf7405aa0f5f0a9ac49c798bfbd13b006d34f78d8806'
ROLLBACK = Path('supabase/migrations/rollback/20261029120000_dashboard_milestone_reviews.rollback.sql')
ROLLBACK_BYTES = 1724
ROLLBACK_SHA256 = '08a2a897414b0e150ca5926f2ad40ae7c44ad796db4dadebd6d8a1253f4b98c6'
CLI_VERSION = '2.121.0'
# What CLI 2.121.0 records for these bytes (its client-side split; reproduced by the test with the real CLI).
RECORDED_STATEMENTS = 28
RECORDED_DIGEST = '07cabc94f4a42c2c0d9a7c1265c9aa622eee65af14bb26dc9889b878d9765ec7'
# md5(pg_get_functiondef(public.get_org_id())): production's definition, read 2026-10-29 (the RLS relies on it).
GET_ORG_ID_MD5 = 'fb1d12f537aac3b3ed18c9e0628f2251'
STAGES = ('check', 'apply-migration', 'record-history', 'rollback-migration')
WATCHDOG_SECONDS = 120
TABLE = 'public.dashboard_milestone_reviews'
SET_RPC = 'public.set_dashboard_milestone_review(text,uuid,text,date,text,timestamp with time zone)'
CLEAR_RPC = 'public.clear_dashboard_milestone_review(uuid,timestamp with time zone)'
GUARD_FN = 'private.dashboard_milestone_reviews_guard()'
ROWS_PRESENT = 'DMR01'  # raised inside the rollback transaction while review rows exist


@dataclass(frozen=True)
class Expect:
    rows_before: int
    head_before: str


PRODUCTION = Expect(rows_before=350, head_before='20261028040215')


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
    # Every check runs read-only in its own session, with names deparsed schema-qualified (search_path pg_catalog).
    # Booleans are compared as ::text ('true').
    return command(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                    '-c', 'SET default_transaction_read_only = on',
                    '-c', "SET statement_timeout = '30s'",
                    '-c', 'SET search_path = pg_catalog',
                    '-c', query], target.env)


def mask(*values):
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        for value in values:
            print('::add-mask::' + value.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A'), flush=True)


# ── repository, CLI and connection gates ──────────────────────────────────────────────────────────────────────────

def files_gate(root):
    source, rollback = root / SOURCE, root / ROLLBACK
    require(source.is_file() and len(source.read_bytes()) == SOURCE_BYTES
            and hashlib.sha256(source.read_bytes()).hexdigest() == SOURCE_SHA256,
            'migration bytes and checksum (16,405 bytes, SHA-256 e6737493…)')
    require(rollback.is_file() and len(rollback.read_bytes()) == ROLLBACK_BYTES
            and hashlib.sha256(rollback.read_bytes()).hexdigest() == ROLLBACK_SHA256,
            'rollback bytes and checksum (1,724 bytes, SHA-256 08a2a897…)')
    migrations = root / 'supabase/migrations'
    require(sorted(migrations.glob(f'*_{NAME}.sql')) == [], 'no top-level copy (no integration can pick it up)')
    require(sorted((migrations / 'pending').glob(f'*_{NAME}.sql')) == [source], 'exactly one copy, in pending/')
    require(sorted((migrations / 'rollback').glob(f'*_{NAME}.rollback.sql')) == [rollback], 'exactly one rollback')
    return source.read_bytes(), rollback.read_bytes()


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
        'PGSSLMODE': 'require', 'PGCONNECT_TIMEOUT': '10', 'PGAPPNAME': 'agentflow-dashboard-milestones-release',
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
        count(*) filter (where version = '{VERSION}'), count(*) filter (where name = '{NAME}'),
        (select (to_regclass('{TABLE}') is not null)::int::text || (to_regprocedure('{SET_RPC}') is not null)::int::text
             || (to_regprocedure('{CLEAR_RPC}') is not null)::int::text
             || (to_regprocedure('{GUARD_FN}') is not null)::int::text))
        from supabase_migrations.schema_migrations""")


def expected_state(expect, state):
    before = f'{expect.rows_before}|{expect.head_before}|0|0'
    recorded = f'{expect.rows_before + 1}|{VERSION}|1|1'
    return {'before': before + '|0000', 'applied': before + '|1111',
            'recorded': recorded + '|1111', 'reverted-recorded': recorded + '|0000'}[state]


def classify(target, expect):
    current = history_state(target)
    states = {expected_state(expect, key): key for key in ('before', 'applied', 'recorded', 'reverted-recorded')}
    require(current in states, 'recognized production state')
    print('STATE: ' + states[current], flush=True)
    return states[current]


def state_after_failure(target, expect):
    # Recovery needs to know where an interrupted stage left production; read-only, never raises.
    try:
        current = history_state(target)
        states = {expected_state(expect, key): key for key in ('before', 'applied', 'recorded', 'reverted-recorded')}
        print('STATE AFTER FAILURE: ' + states.get(current, 'unrecognized (stop; investigate)'), flush=True)
    except Exception:
        print('STATE AFTER FAILURE: unknown (read-back failed; verify independently)', flush=True)


def dependency_gate(target):
    require(sql(target, "select md5(pg_get_functiondef('public.get_org_id()'::regprocedure))") == GET_ORG_ID_MD5,
            'public.get_org_id() is the reviewed definition')


# Everything in public and private EXCEPT the objects this migration creates: relations (with ACLs and options),
# columns, constraints, user triggers, policies, views, routines, types, schema ACLs and default privileges. CRM rows,
# statistics and sequences' values are deliberately absent, so ordinary production activity cannot change it.
FINGERPRINT = r"""
with rel as (
  select c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.reloptions
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relname not like 'dashboard\_milestone\_reviews%'
), part(x) as (
  select 'r|' || concat_ws('|', nspname, relname, relkind::text, relrowsecurity::text, relforcerowsecurity::text,
                           relacl::text, reloptions::text) from rel
  union all
  select 'a|' || concat_ws('|', r.nspname, r.relname, a.attnum::text, a.attname, format_type(a.atttypid, a.atttypmod),
                           a.attnotnull::text, a.attidentity::text, a.attgenerated::text, pg_get_expr(d.adbin, d.adrelid))
  from rel r join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all
  select 'c|' || concat_ws('|', r.nspname, r.relname, k.conname, pg_get_constraintdef(k.oid))
  from rel r join pg_constraint k on k.conrelid = r.oid
  union all
  select 't|' || concat_ws('|', r.nspname, r.relname, t.tgname, t.tgenabled::text, pg_get_triggerdef(t.oid))
  from rel r join pg_trigger t on t.tgrelid = r.oid and not t.tgisinternal
  union all
  select 'p|' || concat_ws('|', r.nspname, r.relname, p.polname, p.polcmd::text, p.polpermissive::text,
                           p.polroles::regrole[]::text, pg_get_expr(p.polqual, p.polrelid),
                           pg_get_expr(p.polwithcheck, p.polrelid))
  from rel r join pg_policy p on p.polrelid = r.oid
  union all
  select 'v|' || concat_ws('|', r.nspname, r.relname, pg_get_viewdef(r.oid)) from rel r where r.relkind in ('v', 'm')
  union all
  select 'f|' || concat_ws('|', p.oid::regprocedure::text, p.prokind::text, p.prosecdef::text, p.provolatile::text,
                           p.proconfig::text, p.proacl::text, p.prorettype::regtype::text, md5(p.prosrc), p.probin)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.proname not in ('set_dashboard_milestone_review', 'clear_dashboard_milestone_review',
                          'dashboard_milestone_reviews_guard')
  union all
  select 'y|' || concat_ws('|', n.nspname, t.typname, t.typtype::text)
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname in ('public', 'private') and t.typname not in ('dashboard_milestone_reviews', '_dashboard_milestone_reviews')
  union all
  select 'n|' || concat_ws('|', nspname, nspacl::text) from pg_namespace where nspname in ('public', 'private')
  union all
  select 'd|' || concat_ws('|', defaclrole::regrole::text, defaclnamespace::regnamespace::text, defaclobjtype::text,
                           defaclacl::text) from pg_default_acl
)
select count(*) || '|' || md5(string_agg(x, E'\n' order by x collate "C")) from part"""


def snapshot(target):
    # The schema outside the new objects, and every history row other than this migration's (full-row digest).
    history = sql(target, f"""select count(*) || '|' || md5(string_agg(t::text, E'\\n' order by version))
        from supabase_migrations.schema_migrations t where version <> '{VERSION}'""")
    return sql(target, FINGERPRINT), history


def unchanged(target, before):
    after = snapshot(target)
    require(after[0] == before[0], 'every unrelated schema object unchanged')
    require(after[1] == before[1], 'every other history row byte-identical')


def review_rows(target):
    return int(sql(target, f'select count(*) from {TABLE}'))


# ── read-backs (exact values from the rehearsal on loopback PostgreSQL) ──────────────────────────────────────────────

OBJECTS = ('dashboard_milestone_reviews:r,dashboard_milestone_reviews_annual_key:i,'
           'dashboard_milestone_reviews_client_idx:i,dashboard_milestone_reviews_first_payment_key:i,'
           'dashboard_milestone_reviews_pkey:i,dashboard_milestone_reviews_reader_idx:i')
COLUMNS = ('id uuid not null default gen_random_uuid(), organization_id uuid not null, user_id uuid not null, '
           'client_id uuid not null, milestone_kind text not null, event_key text not null, '
           'occurrence_year integer not null, occurrence_date date not null, state text not null, '
           'remind_at timestamp with time zone, created_at timestamp with time zone not null default now(), '
           'updated_at timestamp with time zone not null default now()')
CONSTRAINTS_SHA256 = 'cecd4bace31696275c062919a73441c974d7b5970f8174d9cebe3b01e7b22c8e'
INDEXES_SHA256 = '8c0e0f6bfb179055e98ab6d288582a9740e795955ecddcfc1b26f5add1da4374'
TRIGGER = ('CREATE TRIGGER dashboard_milestone_reviews_guard BEFORE INSERT OR UPDATE ON public.dashboard_milestone_reviews '
           'FOR EACH ROW EXECUTE FUNCTION private.dashboard_milestone_reviews_guard()')
POLICY_ROLES = ('dashboard_milestone_reviews_delete:d:true:authenticated,dashboard_milestone_reviews_insert:a:true:'
                'authenticated,dashboard_milestone_reviews_select:r:true:authenticated,'
                'dashboard_milestone_reviews_update:w:true:authenticated')
POLICIES_SHA256 = 'b294c9ea9cecd7d8f3dcb9e771783522c42b1fc4fe9540868122ccb69ef27e59'
TABLE_GRANTS = 'authenticated:DELETE+INSERT+SELECT+UPDATE,service_role:SELECT'
SEARCH_PATH = '{"search_path=pg_catalog, pg_temp"}'
FUNCTIONS = (
    f'{GUARD_FN}|false|v|{SEARCH_PATH}|trigger|622928e9dc05c867c8bb360c82abaa09||false',
    f'{CLEAR_RPC}|false|v|{SEARCH_PATH}|boolean|ef96c28684442f49c8434644fbe415f8|authenticated:EXECUTE|true',
    f'{SET_RPC}|false|v|{SEARCH_PATH}|public.dashboard_milestone_reviews|2bb36bb5161c15bf999f949dc694ada4|'
    'authenticated:EXECUTE|true',
)


def grants(acl_source, oid_expr):
    # Grants to every role but the owner, as role:PRIV+PRIV (PUBLIC included); '' when there are none. A NULL ACL
    # means the type's defaults (for a function: EXECUTE to PUBLIC), so it is expanded with acldefault, never skipped.
    return f"""(select coalesce(string_agg(g.who || ':' || g.privs, ',' order by g.who collate "C"), '') from (
        select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who,
               string_agg(a.privilege_type, '+' order by a.privilege_type collate "C") as privs
        from {acl_source} x, aclexplode(coalesce(x.acl, acldefault(x.kind, x.owner))) a
        where x.oid = {oid_expr} and a.grantee <> x.owner group by 1) g)"""


def readbacks(target):
    digest = "encode(sha256(convert_to({}, 'UTF8')), 'hex')"
    require(sql(target, r"""select string_agg(c.relname || ':' || c.relkind::text, ',' order by c.relname collate "C") from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relname like 'dashboard\_milestone\_reviews%'""") == OBJECTS,
            'exactly the table and its five indexes')
    require(sql(target, f"""select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
        || case when a.attnotnull then ' not null' else '' end || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''),
        ', ' order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = '{TABLE}'::regclass and a.attnum > 0 and not a.attisdropped""") == COLUMNS,
            'the twelve columns, types, nullability and defaults')
    require(sql(target, 'select ' + digest.format(f"""string_agg(conname || ': ' || pg_get_constraintdef(oid), E'\\n'
        order by conname collate "C")""") + f" from pg_constraint where conrelid = '{TABLE}'::regclass") == CONSTRAINTS_SHA256,
            'primary key, three cascading foreign keys and five checks, as reviewed')
    require(sql(target, 'select ' + digest.format("string_agg(pg_get_indexdef(indexrelid), E'\\n' order by indexrelid::regclass::text collate \"C\")")
                + f" from pg_index where indrelid = '{TABLE}'::regclass") == INDEXES_SHA256,
            'the five indexes, partial predicates included, as reviewed')
    require(sql(target, f"""select string_agg(tgenabled::text || ' ' || pg_get_triggerdef(oid), E'\\n') from pg_trigger
        where tgrelid = '{TABLE}'::regclass and not tgisinternal""") == 'O ' + TRIGGER, 'the guard trigger, enabled, and only it')
    require(sql(target, f"""select relrowsecurity::text || '|' || relforcerowsecurity::text || '|' || relowner::regrole::text
        || '|' || (obj_description(oid, 'pg_class') is not null)::text from pg_class where oid = '{TABLE}'::regclass""") ==
            'true|false|postgres|true', 'RLS enabled (not forced), owned by postgres, documented')
    require(sql(target, f"""select string_agg(polname || ':' || polcmd::text || ':' || polpermissive::text || ':'
        || array_to_string(polroles::regrole[], ','), ',' order by polname collate "C") from pg_policy
        where polrelid = '{TABLE}'::regclass""") == POLICY_ROLES, 'four permissive policies, all TO authenticated')
    require(sql(target, 'select ' + digest.format("""string_agg(polname || '|' || coalesce(pg_get_expr(polqual, polrelid), '')
        || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), ''), E'\\n' order by polname collate "C")""")
                + f" from pg_policy where polrelid = '{TABLE}'::regclass") == POLICIES_SHA256,
            'policy expressions: own user, own organization, visible client')
    table_acl = "(select oid, relacl as acl, relowner as owner, 'r'::\"char\" as kind from pg_class)"
    require(sql(target, 'select ' + grants(table_acl, f"'{TABLE}'::regclass")) == TABLE_GRANTS,
            'table grants: authenticated SELECT/INSERT/UPDATE/DELETE, service_role SELECT; nothing for anon or PUBLIC')
    proc_acl = "(select oid, proacl as acl, proowner as owner, 'f'::\"char\" as kind from pg_proc)"
    rows = sql(target, f"""select concat_ws('|', p.oid::regprocedure::text, p.prosecdef::text, p.provolatile::text,
        p.proconfig::text, p.prorettype::regtype::text, md5(p.prosrc), {grants(proc_acl, 'p.oid')},
        (obj_description(p.oid, 'pg_proc') is not null)::text) from pg_proc p
        where p.oid in ('{GUARD_FN}'::regprocedure, '{CLEAR_RPC}'::regprocedure, '{SET_RPC}'::regprocedure)
        """)
    require(sorted(rows.splitlines()) == sorted(FUNCTIONS), 'functions: SECURITY INVOKER, pinned search_path and bodies; '
            'RPC EXECUTE for authenticated only; the guard function executable by no client role')


def recorded_row(target):
    return sql(target, f"""select concat_ws('|', name, cardinality(statements),
        encode(sha256(convert_to(array_to_string(statements, ''), 'UTF8')), 'hex'),
        (created_by is null)::text, (idempotency_key is null)::text, (rollback is null)::text)
        from supabase_migrations.schema_migrations where version = '{VERSION}'""")


def verify_recorded(target):
    require(recorded_row(target) == f'{NAME}|{RECORDED_STATEMENTS}|{RECORDED_DIGEST}|true|true|true',
            'recorded row: dashboard_milestone_reviews, 28 CLI statements, digest 07cabc94…')


# ── the writes ─────────────────────────────────────────────────────────────────────────────────────────────────────

CHILD = None


def cancel(signum, frame):
    # A cancelled job must not leave psql running: interrupt this exact child, wait, and stop.
    if CHILD is not None and CHILD.poll() is None:
        CHILD.send_signal(signal.SIGINT)
        try:
            CHILD.wait(timeout=40)
        except subprocess.TimeoutExpired:
            pass
    raise Stop('cancelled; verify database state before any further action')


def transaction(target, body, prelude=()):
    """Runs prelude commands and then `body` (the checksummed bytes, over stdin) in ONE transaction.

    Output is never logged. Errors are reported as their SQLSTATE only (psql VERBOSITY=sqlstate), which is all the
    caller matches on. Returns (exit code, SQLSTATEs)."""
    global CHILD
    args = ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '--single-transaction']
    for statement in prelude:
        args += ['-c', statement]
    args += ['--file', '-']
    previous = signal.signal(signal.SIGTERM, cancel), signal.signal(signal.SIGINT, cancel)
    CHILD = subprocess.Popen(args, env=target.env, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                             stderr=subprocess.PIPE)
    try:
        try:
            _, err = CHILD.communicate(body, timeout=WATCHDOG_SECONDS)
        except subprocess.TimeoutExpired:
            CHILD.send_signal(signal.SIGINT)
            try:
                CHILD.communicate(timeout=40)
            except subprocess.TimeoutExpired:
                pass
            raise Stop('watchdog cancelled psql; verify state independently; no automatic retry') from None
        return CHILD.returncode, {s.decode() for s in re.findall(rb'ERROR:\s+([0-9A-Z]{5})\b', err or b'')}
    finally:
        CHILD = None
        signal.signal(signal.SIGTERM, previous[0])
        signal.signal(signal.SIGINT, previous[1])


def apply(target, source_bytes):
    code, states = transaction(target, source_bytes)
    if code != 0:
        if '55P03' in states:
            raise Stop('lock not acquired within 2 s (lock_timeout); the transaction rolled back')
        raise Stop('migration transaction did not complete; the state read-back is authoritative')
    print('PASS: migration transaction committed', flush=True)


def rollback_sql(target, rollback_bytes):
    # The row check and the drop are one transaction under ACCESS EXCLUSIVE: no review row can appear in between.
    guard = (f"DO $dmr$ BEGIN IF EXISTS (SELECT 1 FROM {TABLE}) THEN RAISE EXCEPTION 'milestone review rows exist' "
             f"USING ERRCODE = '{ROWS_PRESENT}'; END IF; END $dmr$")
    code, found = transaction(target, rollback_bytes, (
        "SET LOCAL lock_timeout = '2s'", f'LOCK TABLE {TABLE} IN ACCESS EXCLUSIVE MODE', guard))
    if code != 0:
        if ROWS_PRESENT in found:
            raise Stop('milestone review rows exist: rollback refused; it needs a separately approved, verified '
                       'recovery procedure')
        if '55P03' in found:
            raise Stop('lock not acquired within 2 s (lock_timeout); the rollback transaction rolled back')
        raise Stop('rollback transaction did not complete; the state read-back is authoritative')
    print('PASS: rollback transaction committed', flush=True)


def repair(target, status, source_bytes, cli):
    # A temporary workdir holding only a byte copy of this migration at its version (main keeps it in pending/).
    # The CLI reads name and statements from that copy; it executes none of it. `reverted` deletes only the row.
    work = Path(tempfile.mkdtemp(prefix='dmr-release-'))
    try:
        migrations = work / 'supabase' / 'migrations'
        migrations.mkdir(parents=True)
        staged = migrations / f'{VERSION}_{NAME}.sql'
        staged.write_bytes(source_bytes)
        require(hashlib.sha256(staged.read_bytes()).hexdigest() == SOURCE_SHA256, 'staged copy is byte-identical')
        require([p.name for p in migrations.iterdir()] == [staged.name], 'the workdir holds only this migration')
        command([cli, 'migration', 'repair', VERSION, '--status', status, '--db-url', target.db_url,
                 '--workdir', str(work)], cli_env(), timeout=120, cwd=work)
        print(f'PASS: supabase migration repair {VERSION} --status {status} completed', flush=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── stages ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def run_stage(stage, target, expect, files, cli):
    source_bytes, rollback_bytes = files
    require(stage in STAGES, 'known stage')
    state = classify(target, expect)
    installed = state in ('applied', 'recorded')

    if stage == 'check':
        if installed:
            readbacks(target)
            print(f'REVIEW ROWS: {review_rows(target)}', flush=True)
        if state == 'recorded':
            verify_recorded(target)
        if state == 'before':
            dependency_gate(target)
        print('CHECK COMPLETE: read-only; nothing was written.', flush=True)
        return state

    if stage == 'apply-migration':
        require(state == 'before', 'apply-migration needs the before state')
        dependency_gate(target)
        before = snapshot(target)
        try:
            apply(target, source_bytes)
        except Stop:
            state_after_failure(target, expect)
            raise
        require(history_state(target) == expected_state(expect, 'applied'), 'applied state: all four objects, no history row')
        readbacks(target)
        require(review_rows(target) == 0, 'the new table holds no rows')
        unchanged(target, before)
        print('STOP HERE: independent read-only verification and Chris approval before record-history.', flush=True)
        return 'applied'

    if stage == 'record-history':
        require(state == 'applied', 'record-history needs the applied state')
        dependency_gate(target)
        readbacks(target)
        before = snapshot(target)
        try:
            repair(target, 'applied', source_bytes, cli)
        except Stop:
            state_after_failure(target, expect)
            raise
        require(history_state(target) == expected_state(expect, 'recorded'), 'history holds exactly one more row: G2')
        verify_recorded(target)
        unchanged(target, before)
        print('STOP HERE: independent read-only verification next; no further stage.', flush=True)
        return 'recorded'

    # rollback-migration
    require(state in ('applied', 'recorded', 'reverted-recorded'), 'rollback-migration needs an installed state')
    before = snapshot(target)
    if installed:
        require(review_rows(target) == 0, 'no milestone review rows exist (rollback never destroys review records)')
        try:
            rollback_sql(target, rollback_bytes)
        except Stop:
            state_after_failure(target, expect)
            raise
        require(history_state(target) == expected_state(expect, 'before' if state == 'applied' else 'reverted-recorded'),
                'all four objects removed')
    if state != 'applied':
        try:
            repair(target, 'reverted', source_bytes, cli)
        except Stop:
            state_after_failure(target, expect)
            raise
    require(history_state(target) == expected_state(expect, 'before'), 'the exact pre-release state')
    unchanged(target, before)
    print('STOP HERE: independent read-only verification next.', flush=True)
    return 'before'


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
    files = files_gate(Path.cwd())
    cli_gate('supabase')
    target = production_target()
    identity(target)
    run_stage(stage, target, PRODUCTION, files, 'supabase')


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
