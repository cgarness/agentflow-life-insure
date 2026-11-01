"""Disposable Reports v3 verification database built from verbatim repository sources; no network access.

The database starts in the production-equivalent v2 state (the reviewed v2 migrations, the overlap
correction and its release enable, built by the same verbatim extraction as reports_integrity_fixture.py),
then applies the PKG-A v3 migrations, found by their unique suffixes, and runs the v3 suites.
"""
from pathlib import Path
import importlib.util, json, sys

sys.dont_write_bytecode = True  # loading the v2 fixture must not leave __pycache__ in the repository
ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('reports_integrity_fixture', ROOT / 'scripts' / 'reports_integrity_fixture.py')
v2 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v2)

# Production default ACL in schema public: every new function there is executable by anon, authenticated
# and service_role unless revoked (plan §2.8). Emulated so a missing class C REVOKE fails here first.
DEFAULT_ACL = ('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public '
               'GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;')

# The v2 integrity fixture steps that build state (its assertion and recovery-proof steps are not repeated).
V2_STATE = [
    'harness',
    'verbatim authorization dependencies',
    '20260929152553_reports_secure_scoped_rpcs',
    '20261002160849_reports_policies_sold_normalized_source',
    'original fixtures',
    'current reporting schema dependencies',
    'integrity control helpers and source fingerprint',
    '20261006043731_reports_integrity_readers',
    '20261006043738_reports_scopes_and_policy_premium',
]


PERFORMANCE_CONTRACT = 'supabase/migrations/20261005161623_performance_reporting_contract.sql'
PHONE_NORMALIZER = 'supabase/migrations/20260823222528_inbound_identity_foundation.sql'


def verbatim_line(path, prefix):
    """The single line of a migration that starts with prefix (for its REVOKE statements)."""
    lines = [l for l in v2.read(path).splitlines() if l.startswith(prefix)]
    assert len(lines) == 1, prefix
    return lines[0]


def premium_choke_point():
    """private.performance_monthly and private.performance_sale_monthly, verbatim, with their REVOKEs."""
    parts = []
    for name in ['performance_monthly(', 'performance_sale_monthly(']:
        parts.append(v2.block(PERFORMANCE_CONTRACT, 'CREATE FUNCTION private.' + name))
        parts.append(verbatim_line(PERFORMANCE_CONTRACT, 'REVOKE ALL ON FUNCTION private.' + name))
    return '\n'.join(parts)


def phone_normalizer():
    """public.phone_last10(text), verbatim, with its production privilege lines."""
    lines = v2.read(PHONE_NORMALIZER).splitlines()
    acl = [l for l in lines if l.startswith(('REVOKE ALL ON FUNCTION public.phone_last10(text)',
                                             'GRANT EXECUTE ON FUNCTION public.phone_last10(text)'))]
    assert len(acl) == 4, acl
    return v2.block(PHONE_NORMALIZER, 'CREATE OR REPLACE FUNCTION public.phone_last10(') + '\n' + '\n'.join(acl)


def release_enable_check():
    """The highest-version release-enable migration must be byte-equal to supabase/ops/reports_v3_enable.sql."""
    files = sorted((ROOT / 'supabase/migrations').glob('*_reports_v3_release_enable*.sql'))
    if files:
        assert files[-1].read_text() == v2.read('supabase/ops/reports_v3_enable.sql'), \
            files[-1].name + ' must be byte-equal to supabase/ops/reports_v3_enable.sql'


def steps():
    v2_steps = dict(v2.steps())
    missing = [label for label in V2_STATE if label not in v2_steps]
    assert not missing, 'v2 fixture steps not found: ' + ', '.join(missing)
    release_enable_check()

    yield 'harness', v2_steps['harness']
    yield 'production default function privileges in schema public', DEFAULT_ACL
    for label in V2_STATE[1:]:
        yield label, v2_steps[label]
    yield 'v2 overlap release disable', v2.migration('reports_overlap_release_disable')
    yield 'v2 overlap correction', v2.migration('reports_integrity_quality_overlap_seconds')
    yield 'v2 overlap release enable (production v2 state)', v2.migration('reports_overlap_release_enable') + \
        'SELECT rt.assert_sealed(true);'

    yield 'v3 controls', v2.read('supabase/tests/reports_v3_controls.sql')
    yield 'v2 state is sealed before v3', 'SELECT rt.assert_sealed_v3(true, false);'
    yield 'verbatim phone normalizer (20260823222528)', phone_normalizer()
    yield 'v3 dependency schema', v2.read('supabase/tests/reports_v3_dependencies.sql')
    yield 'verbatim premium choke point (20261005161623)', premium_choke_point()
    yield 'v3 synthetic fixtures', v2.read('supabase/tests/reports_v3_fixtures.sql')
    yield 'v3 call and journey fixtures', v2.read('supabase/tests/reports_v3_journey_fixtures.sql')

    foundation = v2.migration('reports_v3_foundation')
    sale_facts = v2.migration('reports_v3_sale_facts')
    call_journey = v2.migration('reports_v3_call_journey_helpers')
    yield 'sale facts refuse to run before the foundation', v2.refused(sale_facts, 'Reports v3 sale facts: the foundation')
    yield 'foundation refuses closure-helper drift', v2.refused(
        'ALTER FUNCTION private.report_meta(text,uuid,text,text,date,date,timestamptz,timestamptz) SECURITY DEFINER;' + foundation,
        'Reports v3 foundation: v2 or closure preimage drift')
    yield 'foundation refuses v2 reader drift', v2.refused(
        'ALTER FUNCTION public.get_report_scope_v2(text) SET search_path = public;' + foundation,
        'Reports v3 foundation: v2 or closure preimage drift')
    yield '20261101000010_reports_v3_foundation', foundation
    yield 'foundation replay refuses', v2.refused(foundation, 'Reports v3 foundation: refusing replay')
    yield 'call journey refuses to run before sale facts', v2.refused(call_journey, 'Reports v3 call journey: the foundation')
    yield 'v3 contract', v2.read('supabase/tests/reports_v3_contract.sql')
    yield 'sale facts refuse premium choke-point drift', v2.refused(
        'ALTER FUNCTION private.performance_sale_monthly(public.wins,numeric) SECURITY DEFINER;' + sale_facts,
        'Reports v3 sale facts: premium choke point drift')
    yield '20261101000011_reports_v3_sale_facts', sale_facts
    yield 'sale facts replay refuses', v2.refused(sale_facts, 'Reports v3 sale facts: refusing replay')
    yield 'v3 sale facts', v2.read('supabase/tests/reports_v3_sale_facts.sql')
    yield 'call journey refuses v2 call reader drift', v2.refused(
        'ALTER FUNCTION private.report_call_facts(uuid,timestamptz,timestamptz,uuid[]) SECURITY INVOKER;' + call_journey,
        'Reports v3 call journey: v2 call reader drift')
    yield '20261101000012_reports_v3_call_journey_helpers', call_journey
    yield 'call journey replay refuses', v2.refused(call_journey, 'Reports v3 call journey: refusing replay')
    yield 'v3 calls and identity', v2.read('supabase/tests/reports_v3_calls_identity.sql')
    yield 'v3 journeys', v2.read('supabase/tests/reports_v3_journey.sql')
    yield 'v2 surface unchanged after the v3 helpers', 'SELECT rt.assert_sealed(true); SELECT rt.assert_sealed_v3(true, false);'


if __name__ == '__main__':
    data = list(steps())
    if '--json' in sys.argv:
        print(json.dumps(data))
    else:
        for label, sql in data:
            print('\\echo ' + label + '\nBEGIN;\n' + sql + '\nCOMMIT;\n')
