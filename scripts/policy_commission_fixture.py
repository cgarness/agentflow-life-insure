"""Disposable fixture for Phase 2A policy commission tracking (synthetic data only; never production).

Restores the verbatim sale writers, sale identity and commission grid schema in migration order, then the
policy commission harness. The commission migration itself is applied by the runner so that replay, rollback
and preimage guards can be exercised separately.
Usage: python3 scripts/policy_commission_fixture.py > fixture.sql
"""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text()


def migration(suffix):
    paths = list((ROOT / 'supabase/migrations').glob('*_' + suffix + '.sql'))
    assert len(paths) == 1, suffix
    return paths[0].read_text()


def block(source, header, end):
    start = source.index(header)
    return source[start:source.index(end, start) + len(end)]


base = read('supabase/migrations/20260806000000_baseline_production_schema.sql')
reports = read('supabase/migrations/20260929152553_reports_secure_scoped_rpcs.sql')
steps = [
    ('verbatim sale fixture', subprocess.check_output(['python3', str(ROOT / 'scripts/policy_sale_fixture.py')], text=True)),
    ('sale recording', migration('leaderboard_sale_recording')),
    ('report helpers', 'CREATE TABLE public.company_settings(organization_id uuid PRIMARY KEY,timezone text);'
        + block(base, 'CREATE TABLE IF NOT EXISTS "public"."role_permissions" (', '\n);')
        + block(reports, 'CREATE FUNCTION private.report_agency_time_zone(', '\n$$;')
        + block(reports, 'CREATE FUNCTION private.report_permission_flags(', '\n$$;')),
    ('policy identity', migration('policy_identity_sale_integrity')),
    ('commission grid schema', migration('commission_grids_schema')),
    ('commission grid operations', migration('commission_grids_operations')),
    ('policy commission harness', read('supabase/tests/policy_commission_harness.sql')),
]
for label, sql in steps:
    print('-- ' + label + '\nBEGIN;\n' + sql + '\nCOMMIT;')
