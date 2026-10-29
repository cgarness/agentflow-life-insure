#!/usr/bin/env python3
"""Protected G3 release of approved Dashboard attention-clearance SQL.

Only the pinned 16,396-byte approved migration and its pinned rollback may execute.
Check, apply, record-history and rollback are separately dispatched, confirmed and
reviewed by cgarness in protected GitHub environment google-sheets-production.
Requires main, refuses configuration drift, refuses a rollback containing user data,
uses a production-identity gate and a schema-only fingerprint (no CRM row reads).
Never runs db push/migration up or touches frontend, Twilio, call or callback data.
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
VERSION = '20261029200000'
NAME = 'dashboard_attention_clearances'
SOURCE = Path('supabase/migrations/pending/20261029200000_dashboard_attention_clearances.sql')
SOURCE_BYTES = 16396
SOURCE_SHA256 = '85ac2ff7dcd435bd48718311b05704e4e7d96293abf9b47fd062ce30610cb8e8'
ROLLBACK = Path('supabase/migrations/rollback/20261029200000_dashboard_attention_clearances.rollback.sql')
ROLLBACK_BYTES = 2338
ROLLBACK_SHA256 = '9250e2e7cedc8d8e6476838d84e1bc924b869b79248a0e982f68dd267393db55'
CLI_VERSION = '2.121.0'
# These are pinned after rehearsal with exactly PostgreSQL 17.6 and Supabase CLI 2.121.0.
# Unpinned values fail closed: do not merge this release workflow until proven.
RECORDED_STATEMENTS = 0
RECORDED_DIGEST = 'UNPINNED'
GET_ORG_ID_MD5 = 'fb1d12f537aac3b3ed18c9e0628f2251'
STAGES = ('check', 'apply-migration', 'record-history', 'rollback-migration')
WATCHDOG_SECONDS = 120
TABLE = 'public.dashboard_attention_clearances'
CLEAR_RPC = 'public.clear_dashboard_attention_item(text,uuid,timestamp with time zone)'
UNDO_RPC = 'public.undo_dashboard_attention_clear(uuid,timestamp with time zone)'
GUARD_FN = 'private.dashboard_attention_clearances_guard()'
ROWS_PRESENT = 'DAC01'

@dataclass(frozen=True)
class Expect:
    rows_before: int
    head_before: str


PRODUCTION = Expect(rows_before=351, head_before='20261029120000')


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
            'migration bytes and checksum (16,396 bytes, SHA-256 85ac2ff7…)')
    require(rollback.is_file() and len(rollback.read_bytes()) == ROLLBACK_BYTES
            and hashlib.sha256(rollback.read_bytes()).hexdigest() == ROLLBACK_SHA256,
            'rollback bytes and checksum (2,338 bytes, SHA-256 9250e2e7…)')
    migrations = root / 'supabase/migrations'
    require(sorted(migrations.glob(f'*_{NAME}.sql')) == [], 'no top-level copy (no auto-apply)')
    require(sorted((migrations / 'pending').glob(f'*_{NAME}.sql')) == [source], 'exactly one copy in pending/')
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
        'PGSSLMODE': 'require', 'PGCONNECT_TIMEOUT': '10', 'PGAPPNAME': 'agentflow-dashboard-attention-release',
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
        (select (to_regclass('{TABLE}') is not null)::int::text || (to_regprocedure('{CLEAR_RPC}') is not null)::int::text
             || (to_regprocedure('{UNDO_RPC}') is not null)::int::text
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
  where n.nspname in ('public', 'private') and c.relname not like 'dashboard\_attention\_clearances%'
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
    and p.proname not in ('clear_dashboard_attention_item', 'undo_dashboard_attention_clear',
                          'dashboard_attention_clearances_guard')
  union all
  select 'y|' || concat_ws('|', n.nspname, t.typname, t.typtype::text)
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname in ('public', 'private') and t.typname not in ('dashboard_attention_clearances', '_dashboard_attention_clearances')
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


def clearance_rows(target):
    return int(sql(target, f'select count(*) from {TABLE}'))


# ── read-backs (exact values from the rehearsal on loopback PostgreSQL) ──────────────────────────────────────────────

# Source SQL is SHA-pinned. The three installed function bodies are checked
# byte-for-byte against that approved SQL using PostgreSQL prosrc digests.
OBJECTS = ('dashboard_attention_clearances:r,dashboard_attention_clearances_occurrence_key:i,'
           'dashboard_attention_clearances_pkey:i,dashboard_attention_clearances_reader_idx:i')
COLUMNS = ('id uuid not null default gen_random_uuid(), organization_id uuid not null, '
           'user_id uuid not null, source_type text not null, source_id uuid not null, '
           'occurrence_at timestamp with time zone not null, '
           'cleared_at timestamp with time zone not null default now()')
POLICY_ROLES = ('dashboard_attention_clearances_delete:d:true:authenticated,'
                'dashboard_attention_clearances_insert:a:true:authenticated,'
                'dashboard_attention_clearances_select:r:true:authenticated')
TABLE_GRANTS = 'authenticated:DELETE+INSERT+SELECT,service_role:SELECT'
SEARCH_PATH = '{"search_path=pg_catalog, pg_temp"}'


def grants(acl_source, oid_expr):
    # Grants to every role but the owner, as role:PRIV+PRIV (PUBLIC included); '' when there are none. A NULL ACL
    # means the type's defaults (for a function: EXECUTE to PUBLIC), so it is expanded with acldefault, never skipped.
    return f"""(select coalesce(string_agg(g.who || ':' || g.privs, ',' order by g.who collate "C"), '') from (
        select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who,
               string_agg(a.privilege_type, '+' order by a.privilege_type collate "C") as privs
        from {acl_source} x, aclexplode(coalesce(x.acl, acldefault(x.kind, x.owner))) a
        where x.oid = {oid_expr} and a.grantee <> x.owner group by 1) g)"""


def function_body_md5(source_bytes, schema, name):
    source = source_bytes.decode('utf-8')
    pattern = r'CREATE FUNCTION\s+' + re.escape(schema + '.' + name) + r'\s*\([\s\S]*?\)\s*RETURNS[\s\S]*?\bAS\s+\$\$(.*?)\$\$;'
    matches = re.findall(pattern, source, flags=re.IGNORECASE | re.DOTALL)
    require(len(matches) == 1, f'unambiguous approved function: {schema}.{name}')
    return hashlib.md5(matches[0].encode('utf-8')).hexdigest()


def readbacks(target, source_bytes):
    require(sql(target, r"""select string_agg(c.relname || ':' || c.relkind::text, ',' order by c.relname collate "C")
        from pg_class c where c.relnamespace = 'public'::regnamespace
        and c.relname like 'dashboard\_attention\_clearances%'""") == OBJECTS,
        'only the approved table and three indexes')
    require(sql(target, f"""select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
        || case when a.attnotnull then ' not null' else '' end ||
        coalesce(' default ' || pg_get_expr(d.adbin,d.adrelid), ''),
        ', ' order by a.attnum) from pg_attribute a
        left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid='{TABLE}'::regclass and a.attnum>0 and not a.attisdropped""") == COLUMNS,
        'seven approved columns with types and defaults')
    require(sql(target, f"""select count(*) || '|' || count(*) filter (where contype='p') || '|'
        || count(*) filter (where contype='u') || '|' || count(*) filter (where contype='c') || '|'
        || count(*) filter (where contype='f')
        from pg_constraint where conrelid='{TABLE}'::regclass""") == '5|1|1|1|2',
        'exact constraint inventory: primary, unique, check and two FKs')
    require(sql(target, f"""select string_agg(confrelid::regclass::text || ':' || confdeltype::text, ','
        order by confrelid::regclass::text collate "C") from pg_constraint
        where conrelid='{TABLE}'::regclass and contype='f'""") == 'auth.users:c,public.organizations:c',
        'FK cascades only from users and organizations; never source tables')
    check = sql(target, f"""select pg_get_constraintdef(oid) from pg_constraint
        where conrelid='{TABLE}'::regclass and contype='c'""")
    require(all(term in check for term in ('missed_call', 'campaign_callback', 'appointment_callback')),
            'exactly the three approved source types')
    require(sql(target, f"""select count(*) || '|' || count(*) filter (where indisunique)
        from pg_index where indrelid='{TABLE}'::regclass""") == '3|2',
        'three indexes, two unique')
    reader = sql(target, "select pg_get_indexdef('public.dashboard_attention_clearances_reader_idx'::regclass)")
    require('(user_id, organization_id, source_type, occurrence_at)' in reader,
            'reader index is correctly scoped')
    trig = ('CREATE TRIGGER dashboard_attention_clearances_guard BEFORE INSERT OR UPDATE ON ' + TABLE +
            ' FOR EACH ROW EXECUTE FUNCTION private.dashboard_attention_clearances_guard()')
    require(sql(target, f"""select string_agg(tgenabled::text || ' ' || pg_get_triggerdef(oid), E'\\n')
        from pg_trigger where tgrelid='{TABLE}'::regclass and not tgisinternal""") == 'O ' + trig,
        'one enabled guard trigger with the reviewed definition')
    require(sql(target, f"""select relrowsecurity::text || '|' || relforcerowsecurity::text || '|'
        || relowner::regrole::text || '|' || (obj_description(oid, 'pg_class') is not null)::text
        from pg_class where oid='{TABLE}'::regclass""") == 'true|false|postgres|true',
        'RLS enabled, correct owner and documentation')
    require(sql(target, f"""select string_agg(polname || ':' || polcmd::text || ':' ||
        polpermissive::text || ':' || array_to_string(polroles::regrole[], ','),
        ',' order by polname collate "C") from pg_policy where polrelid='{TABLE}'::regclass""") == POLICY_ROLES,
        'exactly three own-row policies for authenticated')
    insert = sql(target, f"""select pg_get_expr(polwithcheck, polrelid)
        from pg_policy where polrelid='{TABLE}'::regclass
        and polname='dashboard_attention_clearances_insert'""")
    require(all(term in insert for term in (
        'auth.uid()', 'get_org_id()', 'source_type', 'calls', 'campaign_leads',
        'appointments', 'created_at', 'callback_due_at', 'scheduled_callback_at', 'start_time',
        'is_missed', 'organization_id', 'source_id', 'occurrence_at')),
        'INSERT policy enforces own org, visible pending source, and exact occurrence')
    for name in ('dashboard_attention_clearances_select', 'dashboard_attention_clearances_delete'):
        expr = sql(target, f"""select pg_get_expr(polqual, polrelid)
            from pg_policy where polrelid='{TABLE}'::regclass and polname='{name}'""")
        require(all(term in expr for term in ('auth.uid()', 'get_org_id()', 'user_id', 'organization_id')),
                f'{name}: own user and org')
    table_acl = "(select oid, relacl as acl, relowner as owner, 'r'::\"char\" as kind from pg_class)"
    require(sql(target, 'select ' + grants(table_acl, f"'{TABLE}'::regclass")) == TABLE_GRANTS,
        'table grants exclude anon/PUBLIC and never allow UPDATE')
    proc_acl = "(select oid, proacl as acl, proowner as owner, 'f'::\"char\" as kind from pg_proc)"
    functions = [
        (GUARD_FN, 'private', 'dashboard_attention_clearances_guard', 'trigger', '', 'false'),
        (CLEAR_RPC, 'public', 'clear_dashboard_attention_item', TABLE, 'authenticated:EXECUTE', 'true'),
        (UNDO_RPC, 'public', 'undo_dashboard_attention_clear', 'boolean', 'authenticated:EXECUTE', 'true'),
    ]
    for oid, schema, name, result_type, expected_acl, comment in functions:
        body = function_body_md5(source_bytes, schema, name)
        actual = sql(target, f"""select concat_ws('|', p.prosecdef::text, p.provolatile::text, p.proconfig::text,
            p.prorettype::regtype::text, md5(p.prosrc), {grants(proc_acl, 'p.oid')},
            (obj_description(p.oid, 'pg_proc') is not null)::text)
            from pg_proc p where p.oid='{oid}'::regprocedure""")
        expected = f'false|v|{SEARCH_PATH}|{result_type}|{body}|{expected_acl}|{comment}'
        require(actual == expected, f'{name}: exact approved body, SECURITY INVOKER, path, grants, comment')


def recorded_row(target):
    return sql(target, f"""select concat_ws('|', name, cardinality(statements),
        encode(sha256(convert_to(array_to_string(statements, ''), 'UTF8')), 'hex'),
        (created_by is null)::text, (idempotency_key is null)::text, (rollback is null)::text)
        from supabase_migrations.schema_migrations where version='{VERSION}'""")


def verify_recorded(target):
    actual = recorded_row(target)
    if RECORDED_STATEMENTS == 0 or RECORDED_DIGEST == 'UNPINNED':
        print('UNPINNED RECORDED ROW: ' + actual, flush=True)
        raise Stop('recorded CLI statement count and digest are not pinned')
    require(actual == f'{NAME}|{RECORDED_STATEMENTS}|{RECORDED_DIGEST}|true|true|true',
            'recorded row identity, statement count, digest and metadata')


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
    guard = (f"DO $dac$ BEGIN IF EXISTS (SELECT 1 FROM {TABLE}) THEN RAISE EXCEPTION 'attention clearance rows exist' "
             f"USING ERRCODE = '{ROWS_PRESENT}'; END IF; END $dac$")
    code, found = transaction(target, rollback_bytes, (
        "SET LOCAL lock_timeout = '2s'", f'LOCK TABLE {TABLE} IN ACCESS EXCLUSIVE MODE', guard))
    if code != 0:
        if ROWS_PRESENT in found:
            raise Stop('attention clearance rows exist: rollback refused; it needs a separately approved, verified '
                       'recovery procedure')
        if '55P03' in found:
            raise Stop('lock not acquired within 2 s (lock_timeout); the rollback transaction rolled back')
        raise Stop('rollback transaction did not complete; the state read-back is authoritative')
    print('PASS: rollback transaction committed', flush=True)


def repair(target, status, source_bytes, cli):
    # A temporary workdir holding only a byte copy of this migration at its version (the approved file remains pending until the G3 release).
    # The CLI reads name and statements from that copy; it executes none of it. `reverted` deletes only the row.
    work = Path(tempfile.mkdtemp(prefix='dac-release-'))
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
            readbacks(target, source_bytes)
            print(f'CLEARANCE ROWS: {clearance_rows(target)}', flush=True)
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
        readbacks(target, source_bytes)
        require(clearance_rows(target) == 0, 'the new table holds no rows')
        unchanged(target, before)
        print('STOP HERE: independent read-only verification and Chris approval before record-history.', flush=True)
        return 'applied'

    if stage == 'record-history':
        require(state == 'applied', 'record-history needs the applied state')
        dependency_gate(target)
        readbacks(target, source_bytes)
        before = snapshot(target)
        try:
            repair(target, 'applied', source_bytes, cli)
        except Stop:
            state_after_failure(target, expect)
            raise
        require(history_state(target) == expected_state(expect, 'recorded'), 'history holds exactly one more row: G3')
        verify_recorded(target)
        unchanged(target, before)
        print('STOP HERE: independent read-only verification next; no further stage.', flush=True)
        return 'recorded'

    # rollback-migration
    require(state in ('applied', 'recorded', 'reverted-recorded'), 'rollback-migration needs an installed state')
    before = snapshot(target)
    if installed:
        require(clearance_rows(target) == 0, 'no attention clearance rows exist (rollback never destroys review records)')
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
