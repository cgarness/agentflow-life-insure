#!/usr/bin/env python3
"""Protected release of the reviewed Reports V2 (v3) database stages: PKG-A, B, C and D, one stage per dispatch.

Release order and stages (plan D1 §3.10, §7; release-proposal.md §2). Each stage is separately approved by Chris,
dispatched by hand on main, confirmed by repeating its name and reviewed by cgarness in the protected environment
google-sheets-production:
  PKG-A  check → apply ×6 (…10–…15) → apply-index-concurrently (…16) → STOP (independent read-only verification)
         → apply-enable (…17) → read-back → record-history
  PKG-B  disable-v3 → …20 → …21 → apply-enable (…22) → read-back → record-history
  PKG-C  …30 → …31 → disable-v3 → …32 → apply-enable (…33) → read-back → record-history
  PKG-D  …40 → category-baseline (36 rows) → …41 → …42 → disable-v3 → …43 → apply-enable (…44) → read-back
         → record-history
  Recovery: disable-v3, disable-all, re-enable (the current package's release enable), the guarded package rollbacks
  in reverse order, and category-baseline-revert.

Only the SHA-256-pinned files below can execute. Every write stage reads the catalog and the migration history first,
refuses any state but the one its stage needs, and stops on any refusal; nothing is retried. Values that can only be
known after the branch's filename-only renumbering above the production head, or after a run of the pinned CLI on
PostgreSQL 17.6 (the history baseline and the recorded statement digests), are UNPINNED and fail closed. Never runs
db push or migration up, and never touches frontend flags, Vercel, Twilio, call or callback data.
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
CLI_VERSION = '2.121.0'
WATCHDOG_SECONDS = 600
UNPINNED = 'UNPINNED'
SUMMARY = 'public.get_report_summary_v3(date,date,uuid,text)'


@dataclass(frozen=True)
class Item:
    version: str          # history version ('' for the category baseline, which is an ops data write)
    stage: str            # the stage that applies it
    package: str
    kind: str             # tx | concurrent | enable | ops
    path: str
    marker: str           # SQL boolean for "installed" (tx/concurrent); '' when derived (enable, contract, ops)
    needs_disabled: bool  # the v3-only window (the file also refuses while Reports v3 is enabled)
    contract: str = ''    # contract version this file installs (stub replacements) or enables (release enables)


M = 'supabase/migrations/'
ITEMS = (
    Item('20261105120010', 'apply-20261105120010', 'A', 'tx', M + '20261105120010_reports_v3_foundation.sql',
         "to_regprocedure('private.report_v3_basis_flags()') IS NOT NULL", False),
    Item('20261105120011', 'apply-20261105120011', 'A', 'tx', M + '20261105120011_reports_v3_sale_facts.sql',
         "to_regprocedure('private.report_v3_sale_facts(uuid,uuid[],date,date)') IS NOT NULL", False),
    Item('20261105120012', 'apply-20261105120012', 'A', 'tx', M + '20261105120012_reports_v3_call_journey_helpers.sql',
         "to_regprocedure('private.report_v3_call_facts(uuid,timestamptz,timestamptz)') IS NOT NULL", False),
    Item('20261105120013', 'apply-20261105120013', 'A', 'tx', M + '20261105120013_reports_v3_appointment_facts_stub.sql',
         "to_regprocedure('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)') IS NOT NULL",
         False),
    Item('20261105120014', 'apply-20261105120014', 'A', 'tx', M + '20261105120014_reports_v3_state_helpers.sql',
         "to_regprocedure('private.report_v3_state_classify(text)') IS NOT NULL", False),
    Item('20261105120015', 'apply-20261105120015', 'A', 'tx', M + '20261105120015_reports_v3_readers.sql',
         f"to_regprocedure('{SUMMARY}') IS NOT NULL", False),
    Item('20261105120016', 'apply-index-concurrently', 'A', 'concurrent', M + '20261105120016_reports_v3_calls_campaign_lead_index.sql',
         "EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.report_v3_calls_org_campaign_lead') AND indisvalid AND indisready)",
         False),
    Item('20261105120017', 'apply-enable-20261105120017', 'A', 'enable', M + '20261105120017_reports_v3_release_enable.sql', '', False, '3.0.0'),
    Item('20261105120020', 'apply-20261105120020', 'B', 'tx', M + '20261105120020_policy_sale_premium_corrections.sql',
         "to_regprocedure('public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)') IS NOT NULL", True),
    Item('20261105120021', 'apply-20261105120021', 'B', 'tx', M + '20261105120021_reports_v3_sale_premium_basis.sql', '', True, '3.1.0'),
    Item('20261105120022', 'apply-enable-20261105120022', 'B', 'enable', M + '20261105120022_reports_v3_release_enable_pkg_b.sql', '', False, '3.1.0'),
    Item('20261105120030', 'apply-20261105120030', 'C', 'tx', M + '20261105120030_policy_sale_call_links.sql',
         "to_regclass('private.policy_sale_call_links') IS NOT NULL", False),
    Item('20261105120031', 'apply-20261105120031', 'C', 'tx', M + '20261105120031_policy_sale_call_link_capture.sql',
         "coalesce(has_function_privilege('authenticated', to_regprocedure('public.retry_policy_sale_call_link(uuid)'), 'EXECUTE'), false)", False),
    Item('20261105120032', 'apply-20261105120032', 'C', 'tx', M + '20261105120032_reports_v3_sale_call_links.sql', '', True, '3.2.0'),
    Item('20261105120033', 'apply-enable-20261105120033', 'C', 'enable', M + '20261105120033_reports_v3_release_enable_pkg_c.sql', '', False, '3.2.0'),
    Item('20261105120040', 'apply-20261105120040', 'D', 'tx', M + '20261105120040_appointment_type_categories.sql',
         "to_regprocedure('private.guard_appointment_type_classification()') IS NOT NULL", False),
    Item('', 'category-baseline', 'D', 'ops', 'supabase/ops/appointment_type_category_baseline.sql', '', False),
    Item('20261105120041', 'apply-20261105120041', 'D', 'tx', M + '20261105120041_appointment_occurrence_evidence.sql',
         "to_regprocedure('public.record_appointment_outcome(uuid,uuid,timestamptz,text)') IS NOT NULL", False),
    Item('20261105120042', 'apply-20261105120042', 'D', 'tx', M + '20261105120042_policy_appointment_attributions.sql',
         "to_regprocedure('public.link_policy_appointment(uuid,uuid,uuid,timestamptz,text,text)') IS NOT NULL", False),
    Item('20261105120043', 'apply-20261105120043', 'D', 'tx', M + '20261105120043_reports_v3_appointment_facts.sql', '', True, '3.3.0'),
    Item('20261105120044', 'apply-enable-20261105120044', 'D', 'enable', M + '20261105120044_reports_v3_release_enable_pkg_d.sql', '', False, '3.3.0'),
)
R = 'supabase/migrations/rollback/'
# Each guarded rollback undoes its file (…20's also undoes …21 when the ledger is empty); reverse order only.
ROLLBACKS = {
    '20261105120043': R + '20261105120043_reports_v3_appointment_facts.rollback.sql',
    '20261105120042': R + '20261105120042_policy_appointment_attributions.rollback.sql',
    '20261105120041': R + '20261105120041_appointment_occurrence_evidence.rollback.sql',
    '20261105120040': R + '20261105120040_appointment_type_categories.rollback.sql',
    '20261105120032': R + '20261105120032_reports_v3_sale_call_links.rollback.sql',
    '20261105120031': R + '20261105120031_policy_sale_call_link_capture.rollback.sql',
    '20261105120020': R + '20261105120020_policy_sale_premium_corrections.rollback.sql',
}
OPS = {
    'disable-v3': 'supabase/ops/reports_v3_disable.sql',
    'disable-all': 'supabase/ops/reports_all_disable.sql',
    'read-back': 'supabase/ops/reports_v3_readback.sql',
    'preflight': 'supabase/ops/reports_v3_preflight.sql',
    'category-baseline-revert': 'supabase/ops/appointment_type_category_baseline_revert.sql',
    'enable': 'supabase/ops/reports_v3_enable.sql',
}
# Bytes and SHA-256 of every file this runner can execute (the release-enable byte copies included). Regenerate only
# together with the reviewed SQL; any other byte refuses before a connection is made.
PINS = {
    'supabase/migrations/20261105120010_reports_v3_foundation.sql': (53894, '5e7c134400950a18720a176d48bc67310bb354ac77493a80f9913eb6af6c433b'),
    'supabase/migrations/20261105120011_reports_v3_sale_facts.sql': (18150, '8ee83c78eec631d959a60c78dbc06818d273717834a771fac4124b901df9df1b'),
    'supabase/migrations/20261105120012_reports_v3_call_journey_helpers.sql': (92063, 'b8aed0938924de6cedafa276e8fd346e120d37cc69dac5eefcb084e3d87f00c9'),
    'supabase/migrations/20261105120013_reports_v3_appointment_facts_stub.sql': (7184, '82473351065aff8dbf47b6c22bda38741d82d79880e167eb83a70c1a71d45ab6'),
    'supabase/migrations/20261105120014_reports_v3_state_helpers.sql': (23086, 'd1e3924eac6fef3ffa4296438dcb04a2cd841709f98983b0d2a917372be53b66'),
    'supabase/migrations/20261105120015_reports_v3_readers.sql': (137954, 'e251b737a6f61f845d228ae7325179a7a030cac5f153c4195d707f9c5a353a41'),
    'supabase/migrations/20261105120016_reports_v3_calls_campaign_lead_index.sql': (1319, '3afedbee7b4edcee5bd85d1f39ca156a8f8fdf318d3bff0898570f3bee999b5f'),
    'supabase/migrations/20261105120017_reports_v3_release_enable.sql': (24074, '4aa127242482fee5979925976995b4388b76aa56a7783cd17c095c3bfe9acc9a'),
    'supabase/migrations/20261105120020_policy_sale_premium_corrections.sql': (28112, '66c8c5963cdf73a232c1c1081888bd4e1ee0de2f6605117bc7176f7c32cf6b56'),
    'supabase/migrations/20261105120021_reports_v3_sale_premium_basis.sql': (9302, 'df9a1e49eb626e7e4ddf50350d2d245e0c963ecf910932869deb4e2b398bd273'),
    'supabase/migrations/20261105120022_reports_v3_release_enable_pkg_b.sql': (24080, '16ffbe8eca6e0e18bf25095eb1da888793b1035cc5a94a43ce46852d96b8f7ac'),
    'supabase/migrations/20261105120030_policy_sale_call_links.sql': (5592, '6cd1e59deac34c38cb9dfe44e012187d2f09277eaf631915742f1fc9b22889bf'),
    'supabase/migrations/20261105120031_policy_sale_call_link_capture.sql': (18167, '4bfb733eaefd6bffffd1c6c759e592611eabe78c0157146d9774633f5cfda6d9'),
    'supabase/migrations/20261105120032_reports_v3_sale_call_links.sql': (4449, 'f17a09b9b1b732289ce3b865d7963644f118ff1dd3c7ef6f53974067e7fecff0'),
    'supabase/migrations/20261105120033_reports_v3_release_enable_pkg_c.sql': (24080, '8abb91505eba84b9affc277ca3111e2ec2a157e373f218a1295f99a4f346806a'),
    'supabase/migrations/20261105120040_appointment_type_categories.sql': (9882, '7c0d97baac891a0d57f63857e5857b69812a87ace3d89c444f19228d6c7e8b40'),
    'supabase/migrations/20261105120041_appointment_occurrence_evidence.sql': (26704, 'bf39780f1a333c215d95492a15e387b770b67f7935f8c83c9373eafc970afb17'),
    'supabase/migrations/20261105120042_policy_appointment_attributions.sql': (19047, 'dea3c83cf242304fb1559050bbbb2c0b997a8cea2f65a94532cab406957bc296'),
    'supabase/migrations/20261105120043_reports_v3_appointment_facts.sql': (29993, '69f0beff5323da9df070f1c255e5506cf606f3d0fbe13a317edf83ff0b76eeb4'),
    'supabase/migrations/20261105120044_reports_v3_release_enable_pkg_d.sql': (25534, 'c23f949f2f98f1e147d44dfa603a2bc70019909df3eba637d6fca0ee441a03b3'),
    'supabase/ops/appointment_type_category_baseline.sql': (2097, 'a9ef73c8f8de1fb1d9061405479055985dd36bc468b2474e692f5340c2fee14a'),
    'supabase/migrations/rollback/20261105120043_reports_v3_appointment_facts.rollback.sql': (3904, '95a24f52669d9dbd97a5c0f967243f9180bda953395f004d285011ab99a3517d'),
    'supabase/migrations/rollback/20261105120042_policy_appointment_attributions.rollback.sql': (1682, '9eb5b336f4c7180814781f23bef1ab5a56adfbae820a9511bfb82f5e2d0ec72e'),
    'supabase/migrations/rollback/20261105120041_appointment_occurrence_evidence.rollback.sql': (1135, '8179b7c24b68ce6dab7566d55f0f7be947b844c524131340819fbac3d2b34ae1'),
    'supabase/migrations/rollback/20261105120040_appointment_type_categories.rollback.sql': (1201, 'dd6c60ea84f790f597ddb88ceb0b9cba73b6d8dfeaa9b5fb854dd55d4c0902cc'),
    'supabase/migrations/rollback/20261105120032_reports_v3_sale_call_links.rollback.sql': (2495, 'd522cf07cb58aa04a0c76fc30d0008127940bd70d8d49294727c145359de6df5'),
    'supabase/migrations/rollback/20261105120031_policy_sale_call_link_capture.rollback.sql': (1537, '1ae920173f06cada445520495b6a3b026bb8d080e5b373577bbddb953031a73a'),
    'supabase/migrations/rollback/20261105120020_policy_sale_premium_corrections.rollback.sql': (6814, 'b170a8a902b971a7a5a129242743e7d7edf6e993cbdb7786a3fd70afa63fdb53'),
    'supabase/ops/reports_v3_disable.sql': (2595, '5fdfd7e9ca6334b6802eb7120050e6c4eef4413910123b23cf37de32f3303618'),
    'supabase/ops/reports_all_disable.sql': (2406, '001f851acae694a8b172c2b9173451ee63bdce15d77e52cce6349fbbafcfbfb0'),
    'supabase/ops/reports_v3_readback.sql': (24711, '5f97fb91e41d9e53e14e6b573eec590f9cdbb7be4dd0c6ce144ad7b9fc043ba4'),
    'supabase/ops/reports_v3_preflight.sql': (11190, 'd60450cf9c28822e4799a1d15a26d6db1ebb03bc1d64bc765f58cdbc0020a1dd'),
    'supabase/ops/appointment_type_category_baseline_revert.sql': (1647, 'e7196dd2665788dc2341bac23acbc5bd97e75a669ed746bf6a40cbc06c85093a'),
    'supabase/ops/reports_v3_enable.sql': (25534, 'c23f949f2f98f1e147d44dfa603a2bc70019909df3eba637d6fca0ee441a03b3'),
}
NAMES = {i.version: Path(i.path).name[15:-4] for i in ITEMS if i.version}
# The production history baseline before PKG-A (independently verified, 2026-11-05: 356 applied migrations, head
# 20261105051037_dialer_admitted_call_counts, no Reports V3 migration applied), and the CLI's recorded row per version
# (statement count and SHA-256 of the concatenated statements), captured by supabase migration repair with exactly
# Supabase CLI 2.121.0 on PostgreSQL 17.6 (CI run 42051570639) from the pinned bytes below. Any other value refuses.
# …31 alone was repinned after C-NULL-IDENTITY using the same CLI/engine (2026-11-08 UTC).
PRODUCTION_ROWS_BEFORE = 356
PRODUCTION_HEAD_BEFORE = '20261105051037'
RECORDED = {
    '20261105120010': (31, 'b9d232b67ad4f82cb3c80fb373a374d24de821249082dc8df51f852a00013051'),
    '20261105120011': (13, '74ec3d89dd30c012c0546b244160738c1dcde63b8a30fc84b74ad38e3b102241'),
    '20261105120012': (40, 'a273b46a26b2b993aec82a8d4d44836fcda223733c8b49102e615a703ec41ad1'),
    '20261105120013': (6, '00f137fe3f77d9f707cec6ed929c2a5c3cb33552961ecb6a2444a2e69af24966'),
    '20261105120014': (11, 'fe4b8005d44f008be42be07dfcb530b99439f934886c66ca7836ce7f73297ef3'),
    '20261105120015': (32, '2620d8494264229e3715b3c508f48f803a2963e7188c9d8e3d083aed4e5f93f0'),
    '20261105120016': (1, '45d7f42cca7b1ab7fa9e52adae90cc5e94b31ce7bf30a5409225e90d8d6bed80'),
    '20261105120017': (3, 'a8ccde415cdaf69ab58bf9ca95097036434e403c4dfeb4c30b6da5b3192422a2'),
    '20261105120020': (25, 'ad3cee6d4ed167fa79b83ce162e1c24cc4da16f4c2a38cc4f67f4d38865d9aac'),
    '20261105120021': (13, '099dd2093f855fe94a3b549d2eaec9cf744929c1e152b65bf683ba786d459ed2'),
    '20261105120022': (3, '23163481bb90cb95d99f51cf924e9147edb88b94cd88ce3e8cab06a2ae1649cd'),
    '20261105120030': (14, 'e7299b966c56ed3a16551c87c6019396e9c030df1dab6e08adf2e4347dc8476a'),
    '20261105120031': (21, '6cc671fa5fda16dec6ecaaf69a99642f13231a8ae8e10f3eb4d972d154a4d6a0'),
    '20261105120032': (9, '112d08b575efc9965b057b67b0bcf32239c06495bd7b14d0017b516013fa56e8'),
    '20261105120033': (3, '3126a14d0074fbd19081414ec1c91b59d9284e3df5b9579a5d43c6c30a56d5f5'),
    '20261105120040': (22, 'af5f721548e7e92d84a4ce877ddbbfc0e598edeb275300d3db611e2d589e8618'),
    '20261105120041': (41, '23e3626f973e52d7369315a649dc43b02f280fa284fbe57ce1d7a608156ef64c'),
    '20261105120042': (34, '4b71a769746331ee19f2e0c3b6f98a27c2c00077a39091e8e4688f32e282a2e8'),
    '20261105120043': (13, 'c1ca9c4f3d1153ddac565b1ecde9d23fa20a8c8ca899a90b837658677e5785e3'),
    '20261105120044': (3, '96db6d3b94e5f0292ad8dec0607895b32f99ed77d51425baf3bbb7afe3a9da37'),
}

STAGES = (('check', 'read-back', 'record-history', 'disable-v3', 'disable-all', 're-enable')
          + tuple(i.stage for i in ITEMS) + ('category-baseline-revert',) + tuple('rollback-' + v for v in ROLLBACKS))


@dataclass(frozen=True)
class Expect:
    rows_before: int
    head_before: str


@dataclass(frozen=True)
class Target:
    env: dict     # libpq environment for psql (the password lives only here)
    db_url: str   # the CLI needs a URL; masked before use and never printed


@dataclass(frozen=True)
class State:
    applied: int        # ITEMS[:applied] are installed
    recorded: tuple     # versions recorded in history, in release order (a prefix of the applied history items)
    enabled: bool       # the v3 readers are executable by authenticated
    contract: str       # report_v3_basis_flags() contract_version ('' before …10)


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
    files = {}
    for path, (size, digest) in PINS.items():
        data = (root / path).read_bytes() if (root / path).is_file() else b''
        require(len(data) == size and hashlib.sha256(data).hexdigest() == digest, f'{path}: {size:,} bytes, SHA-256 {digest[:8]}…')
        files[path] = data
    require(files[OPS['enable']] == files[ITEMS[-1].path], 'the ops enable is byte-equal to the PKG-D release enable')
    migrations = root / 'supabase/migrations'
    for item in ITEMS:
        if item.version:
            require(sorted(migrations.glob(f'*_{NAMES[item.version]}.sql')) == [root / item.path], f'exactly one {NAMES[item.version]}')
    require(sorted(p.name for p in (migrations / 'pending').glob('*_reports_v3_*.sql')) == [], 'no pending Reports v3 copy')
    return files


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
    env = clean_env() | {
        'PGHOST': host, 'PGPORT': '5432', 'PGDATABASE': 'postgres', 'PGUSER': user, 'PGPASSWORD': password,
        'PGSSLMODE': 'require', 'PGCONNECT_TIMEOUT': '10', 'PGAPPNAME': 'agentflow-reports-release',
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

OURS = "(" + ", ".join(f"'{i.version}'" for i in ITEMS if i.version) + ")"


def history(target):
    other = sql(target, f"""select count(*) || '|' || coalesce(max(version), '')
        from supabase_migrations.schema_migrations where version not in {OURS}""")
    ours = sql(target, f"""select coalesce(string_agg(version, ',' order by version), '')
        from supabase_migrations.schema_migrations where version in {OURS}""")
    return other, tuple(v for v in ours.split(',') if v)


def catalog(target):
    flags = sql(target, 'select concat_ws(\'|\', ' + ', '.join(
        f'({i.marker})::text' for i in ITEMS if i.marker) + ')').split('|')
    marker = dict(zip([i.version for i in ITEMS if i.marker], [f == 'true' for f in flags]))
    contract, enabled, baseline = '', False, False
    if marker['20261105120010']:
        contract = sql(target, "select coalesce(private.report_v3_basis_flags() ->> 'contract_version', '')")
    if marker['20261105120015']:
        enabled = sql(target, f"select has_function_privilege('authenticated', '{SUMMARY}', 'EXECUTE')::text") == 'true'
    if marker['20261105120040']:
        # Applied: the 36 ops_baseline events and no ops_revert event (the event log is append-only).
        baseline = sql(target, """select (count(*) filter (where source = 'ops_baseline') = 36
            and count(*) filter (where source = 'ops_revert') = 0)::text from private.appointment_type_category_events""") == 'true'
    return marker, contract, enabled, baseline


def classify(target, expect, reverting=()):
    """The installed prefix of ITEMS. `reverting`: recorded versions a rollback is about to revert (their rows are
    still present between the rollback transaction and the history repair)."""
    require(expect is not None and expect.head_before != UNPINNED and expect.rows_before > 0,
            'production history baseline is pinned (after the renumbering above the production head)')
    other, recorded = history(target)
    require(other == f'{expect.rows_before}|{expect.head_before}', 'every other history row is the pinned baseline')
    recorded = tuple(v for v in recorded if v not in reverting)
    marker, contract, enabled, baseline = catalog(target)
    applied = []
    for item in ITEMS:
        if item.marker:
            applied.append(marker[item.version])
        elif item.kind == 'ops':
            applied.append(baseline)
        elif item.kind == 'enable':
            applied.append(item.version in recorded or (enabled and contract == item.contract))
        else:  # a stub replacement: installed once the contract version reaches the one it installs
            applied.append(contract >= item.contract)
    n = applied.index(False) if False in applied else len(applied)
    if any(applied[n:]):
        raise Stop('unrecognized catalog state: installed objects are not a prefix of the release order')
    expected_contract = max([i.contract for i in ITEMS[:n] if i.kind == 'tx' and i.contract] + ['3.0.0']) if n else ''
    require(contract == expected_contract, 'basis contract version matches the installed files')
    history_items = [i.version for i in ITEMS[:n] if i.version]
    require(recorded == tuple(history_items[:len(recorded)]), 'recorded history is a prefix of the installed files')
    state = State(n, recorded, enabled, contract)
    last = ITEMS[n - 1] if n else None
    print(f'STATE: installed through {last.stage if last else "nothing (pre-PKG-A)"}; recorded {len(recorded)} of '
          f'{len(history_items)}; Reports v3 {"enabled" if enabled else "disabled"}; contract {contract or "none"}', flush=True)
    return state


def matrix(target):
    # Every (report function, client role) pair that can execute; a C/W apply must not change it.
    return sql(target, """select count(*) || '|' || md5(coalesce(string_agg(x, ',' order by x), ''))
        from (select p.oid::regprocedure::text || ':' || r as x
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                     unnest(array['anon', 'authenticated', 'service_role']) r
               where ((n.nspname = 'private' and p.proname like 'report\\_%')
                   or (n.nspname = 'public' and (p.proname like 'get\\_report\\_%' or p.proname like 'rpc\\_report\\_%')))
                 and has_function_privilege(r, p.oid, 'EXECUTE')) m""")


def v3_executable(target):
    return int(sql(target, """select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
        unnest(array['anon', 'authenticated', 'service_role']) r
        where ((n.nspname = 'private' and p.proname like 'report\\_v3\\_%') or (n.nspname = 'public' and p.proname like 'get\\_report\\_%\\_v3'))
          and has_function_privilege(r, p.oid, 'EXECUTE')"""))


def report_executable(target):
    return int(sql(target, """select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
        unnest(array['anon', 'authenticated', 'service_role']) r
        where ((n.nspname = 'private' and p.proname like 'report\\_%')
            or (n.nspname = 'public' and (p.proname like 'get\\_report\\_%' or p.proname like 'rpc\\_report\\_%')))
          and has_function_privilege(r, p.oid, 'EXECUTE')"""))


def history_snapshot(target):
    return sql(target, f"""select count(*) || '|' || md5(coalesce(string_agg(t::text, E'\\n' order by version), ''))
        from supabase_migrations.schema_migrations t where version not in {OURS}""")


def recorded_row(target, version):
    return sql(target, f"""select concat_ws('|', name, cardinality(statements),
        encode(sha256(convert_to(array_to_string(statements, ''), 'UTF8')), 'hex'),
        (created_by is null)::text, (idempotency_key is null)::text, (rollback is null)::text)
        from supabase_migrations.schema_migrations where version='{version}'""")


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


def psql_file(target, body, single_transaction=True, env_extra=None):
    """Runs the checksummed bytes over stdin. Output is never logged; errors are reported as SQLSTATEs only."""
    global CHILD
    args = ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate']
    if single_transaction:
        args.append('--single-transaction')
    args += ['--file', '-']
    previous = signal.signal(signal.SIGTERM, cancel), signal.signal(signal.SIGINT, cancel)
    CHILD = subprocess.Popen(args, env=target.env | (env_extra or {}), stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
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


def run_file(target, label, body, single_transaction=True, env_extra=None):
    code, states = psql_file(target, body, single_transaction, env_extra)
    if code != 0:
        if '55P03' in states:
            raise Stop(f'{label}: lock not acquired (lock_timeout); nothing was committed')
        if '57014' in states:
            raise Stop(f'{label}: statement timeout; nothing was committed')
        raise Stop(f'{label}: refused or failed; nothing was committed; the state read-back is authoritative')
    print(f'PASS: {label} committed', flush=True)


def read_back(target, files):
    code, states = psql_file(target, files[OPS['read-back']], single_transaction=False)
    if code != 0:
        raise Stop('read-back failed' + (' (statement timeout)' if '57014' in states else '') + '; stop before record-history')
    print('PASS: read-back (pins, privilege matrix, class W ACLs, tables, index, role-simulated reads, invariant)', flush=True)


def repair(target, version, status, data, cli):
    # A temporary workdir holding only a byte copy of this migration at its version. The CLI reads name and statements
    # from that copy; it executes none of it. `reverted` deletes only the row.
    work = Path(tempfile.mkdtemp(prefix='reports-release-'))
    try:
        migrations = work / 'supabase' / 'migrations'
        migrations.mkdir(parents=True)
        staged = migrations / f'{version}_{NAMES[version]}.sql'
        staged.write_bytes(data)
        require([p.name for p in migrations.iterdir()] == [staged.name], f'the workdir holds only {version}')
        command([cli, 'migration', 'repair', version, '--status', status, '--db-url', target.db_url,
                 '--workdir', str(work)], cli_env(), timeout=120, cwd=work)
        print(f'PASS: supabase migration repair {version} --status {status} completed', flush=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── stages ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def next_stage(state):
    return ITEMS[state.applied].stage if state.applied < len(ITEMS) else 'none (PKG-D complete)'


def run_stage(stage, target, expect, files, cli):
    require(stage in STAGES, 'known stage')
    state = classify(target, expect)

    if stage == 'check':
        if state.applied == 0:
            code, _ = psql_file(target, files[OPS['preflight']], single_transaction=False)
            require(code == 0, 'PKG-A preflight (read-only) passes')
        if state.enabled:
            read_back(target, files)
        print(f'NEXT STAGE IN RELEASE ORDER: {next_stage(state)}', flush=True)
        print('CHECK COMPLETE: read-only; nothing was written.', flush=True)
        return state

    if stage == 'read-back':
        require(state.enabled, 'read-back needs Reports v3 enabled')
        read_back(target, files)
        return state

    if stage in ('disable-v3', 'disable-all'):
        require(state.applied >= 6, f'{stage} needs the v3 readers')
        run_file(target, stage, files[OPS[stage]])
        require(v3_executable(target) == 0, 'no v3 function is executable by a client role')
        if stage == 'disable-all':
            require(report_executable(target) == 0, 'no report function is executable by a client role')
        after = classify(target, expect)
        require(not after.enabled and after.applied >= state.applied - 1, 'Reports v3 is off; installed files unchanged')
        return after

    if stage == 're-enable':
        current = [i for i in ITEMS[:state.applied] if i.kind == 'enable' and i.contract == state.contract]
        require(not state.enabled and len(current) == 1 and state.applied >= ITEMS.index(current[0]) + 1,
                're-enable needs Reports v3 off and its package release enable already applied')
        run_file(target, 're-enable ' + current[0].version, files[current[0].path])
        after = classify(target, expect)
        require(after.enabled and after.applied == state.applied, 'Reports v3 is enabled at the same state')
        read_back(target, files)
        return after

    if stage == 'record-history':
        pending = [i for i in ITEMS[:state.applied] if i.version and i.version not in state.recorded]
        require(len(pending) > 0, 'record-history needs installed, unrecorded files')
        require(ITEMS[state.applied - 1].kind == 'enable' and state.enabled,
                'record-history follows a package release enable (Reports v3 enabled)')
        read_back(target, files)
        for item in pending:
            count, digest = RECORDED[item.version]
            require(count > 0 and digest != UNPINNED, f'recorded CLI statements for {item.version} are pinned')
        before = history_snapshot(target)
        for item in pending:
            repair(target, item.version, 'applied', files[item.path], cli)
            count, digest = RECORDED[item.version]
            require(recorded_row(target, item.version) == f'{NAMES[item.version]}|{count}|{digest}|true|true|true',
                    f'{item.version}: recorded row identity, statement count, digest and metadata')
        require(history_snapshot(target) == before, 'every other history row byte-identical')
        after = classify(target, expect)
        require(after.recorded == tuple(i.version for i in ITEMS[:state.applied] if i.version), 'history records exactly the installed files')
        print('STOP HERE: independent read-only verification next; the next package needs its own approval.', flush=True)
        return after

    if stage == 'category-baseline-revert':
        i = ITEMS.index(next(x for x in ITEMS if x.stage == 'category-baseline'))
        require(state.applied == i + 1, 'category-baseline-revert needs the baseline applied and …41 not installed')
        run_file(target, stage, files[OPS[stage]], single_transaction=False)
        after = classify(target, expect)
        require(after.applied == i, 'the 36 baseline classifications are reverted')
        return after

    if stage.startswith('rollback-'):
        version = stage.removeprefix('rollback-')
        i = next(k for k, x in enumerate(ITEMS) if x.version == version)
        tail = ITEMS[i:state.applied]
        require(state.applied > i and all(x.kind == 'enable' or x.version == version or (version == '20261105120020' and x.version == '20261105120021')
                                          for x in tail), f'{stage} needs {version} to be the last installed file of its package')
        require(not state.enabled, f'{stage} needs Reports v3 disabled (disable-v3 first)')
        before = history_snapshot(target)
        run_file(target, stage, files[ROLLBACKS[version]])
        after_sql = classify_quiet(target, expect, tuple(x.version for x in tail if x.version in state.recorded))
        require(after_sql is not None and after_sql.applied == i and not after_sql.enabled,
                f'{stage} restored the state before {version} (anything else: the rollback sealed only; investigate)')
        for x in reversed(tail):
            if x.version in state.recorded:
                repair(target, x.version, 'reverted', files[x.path], cli)
        require(history_snapshot(target) == before, 'every other history row byte-identical')
        after = classify(target, expect)
        require(after.applied == i and after.recorded == tuple(v for v in state.recorded if v < version), 'the exact earlier state')
        return after

    # apply-* and category-baseline: the next file in release order only.
    item = next(x for x in ITEMS if x.stage == stage)
    require(state.applied < len(ITEMS) and ITEMS[state.applied] is item, f'{stage} is the next stage in release order')
    require(state.recorded == tuple(x.version for x in ITEMS[:state.applied] if x.version)
            or item.package == ITEMS[state.applied - 1].package,
            'the previous package is recorded in history before the next package starts')
    if item.needs_disabled:
        require(not state.enabled, f'{stage} runs inside the v3-only window (disable-v3 first)')
    if item.kind == 'enable':
        run_file(target, stage, files[item.path])
        after = classify(target, expect)
        require(after.applied == state.applied + 1 and after.enabled, 'Reports v3 enabled at the reviewed pins')
        print('STOP HERE: read-back next, then record-history.', flush=True)
        return after
    before = matrix(target)
    if item.kind == 'concurrent':
        run_file(target, stage, files[item.path], single_transaction=False, env_extra={'PGOPTIONS': '-c lock_timeout=2s'})
    elif item.kind == 'ops':
        run_file(target, stage, files[item.path], single_transaction=False)
    else:
        run_file(target, stage, files[item.path])
    after = classify_quiet(target, expect)
    if item.kind == 'concurrent' and (after is None or after.applied != state.applied + 1):
        raise Stop('the concurrent index is missing or not valid: drop it concurrently under a separate approval; never retried')
    require(after is not None and after.applied == state.applied + 1, f'{stage} installed exactly its file')
    require(matrix(target) == before, 'no report function privilege changed')
    if item.version == '20261105120016':
        print('STOP HERE: independent read-only verification (A8) and Chris approval before apply-enable.', flush=True)
    else:
        print(f'STOP HERE: next stage in release order is {next_stage(after)} (separately approved).', flush=True)
    return after


def classify_quiet(target, expect, reverting=()):
    try:
        return classify(target, expect, reverting)
    except Stop:
        print('STATE AFTER STAGE: unrecognized (stop; investigate)', flush=True)
        return None


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
    expect = Expect(PRODUCTION_ROWS_BEFORE, PRODUCTION_HEAD_BEFORE)
    run_stage(stage, target, expect, files, 'supabase')


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
