"""Disposable Reports v3 verification database built from verbatim repository sources; no network access.

The database starts in the production-equivalent v2 state (the reviewed v2 migrations, the overlap
correction and its release enable, built by the same verbatim extraction as reports_integrity_fixture.py),
then applies the PKG-A v3 migrations, found by their unique suffixes, and runs the v3 suites.
"""
from pathlib import Path
import importlib.util, json, os, re, sys

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
BASELINE = 'supabase/migrations/20260806000000_baseline_production_schema.sql'


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


def state_normalizer():
    """public.normalize_us_state(text), verbatim from the baseline, with its owner and production grants.

    The baseline's REVOKE from supabase_auth_admin is not reproduced: that platform role does not exist here,
    and run_reports_v3_tests.sh refuses any database that has it.
    """
    grants = [l for l in v2.read(BASELINE).splitlines()
              if l.startswith('GRANT ALL ON FUNCTION "public"."normalize_us_state"("p_raw" "text") TO ')]
    assert len(grants) == 3, grants
    return '\n'.join([v2.block(BASELINE, 'CREATE OR REPLACE FUNCTION "public"."normalize_us_state"('),
                      verbatim_line(BASELINE, 'ALTER FUNCTION "public"."normalize_us_state"("p_raw" "text") OWNER TO ')] + grants)


def normalizer_drift(alteration):
    """SQL that changes public.normalize_us_state inside a refused (rolled-back) attempt."""
    return alteration if alteration.startswith('ALTER') else (
        "DO $drift$ BEGIN EXECUTE replace(pg_get_functiondef('public.normalize_us_state(text)'::regprocedure), "
        + alteration + "); END $drift$;")


def reader_contract():
    """The reader section of reports_v3_contract.sql: it runs after …15, while the rest runs right after …10."""
    text = v2.read('supabase/tests/reports_v3_contract.sql')
    marker = '-- @readers'
    assert text.count(marker) == 1, marker
    head, tail = text.split(marker)
    return head, tail


def no_transaction(sql):
    """A step psql runs outside BEGIN/COMMIT (CREATE INDEX CONCURRENTLY cannot run in a transaction block)."""
    return ('NO TRANSACTION', sql)


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
    yield 'verbatim state normalizer (20260806000000)', state_normalizer()
    yield 'v3 dependency schema', v2.read('supabase/tests/reports_v3_dependencies.sql')
    yield 'v3 state harness', v2.read('supabase/tests/reports_v3_state_harness.sql')
    yield 'verbatim premium choke point (20261005161623)', premium_choke_point()
    yield 'v3 synthetic fixtures', v2.read('supabase/tests/reports_v3_fixtures.sql')
    yield 'v3 call and journey fixtures', v2.read('supabase/tests/reports_v3_journey_fixtures.sql')

    foundation = v2.migration('reports_v3_foundation')
    sale_facts = v2.migration('reports_v3_sale_facts')
    call_journey = v2.migration('reports_v3_call_journey_helpers')
    appointment_stub = v2.migration('reports_v3_appointment_facts_stub')
    state_helpers = v2.migration('reports_v3_state_helpers')
    readers = v2.migration('reports_v3_readers')
    calls_index = v2.migration('reports_v3_calls_campaign_lead_index')
    contract_head, contract_readers = reader_contract()
    yield 'sale facts refuse to run before the foundation', v2.refused(sale_facts, 'Reports v3 sale facts: the foundation')
    yield 'foundation refuses closure-helper drift', v2.refused(
        'ALTER FUNCTION private.report_meta(text,uuid,text,text,date,date,timestamptz,timestamptz) SECURITY DEFINER;' + foundation,
        'Reports v3 foundation: v2 or closure preimage drift')
    yield 'foundation refuses v2 reader drift', v2.refused(
        'ALTER FUNCTION public.get_report_scope_v2(text) SET search_path = public;' + foundation,
        'Reports v3 foundation: v2 or closure preimage drift')
    yield '20261104120010_reports_v3_foundation', foundation
    yield 'foundation replay refuses', v2.refused(foundation, 'Reports v3 foundation: refusing replay')
    yield 'call journey refuses to run before sale facts', v2.refused(call_journey, 'Reports v3 call journey: the foundation')
    yield 'v3 contract', contract_head
    yield 'sale facts refuse premium choke-point drift', v2.refused(
        'ALTER FUNCTION private.performance_sale_monthly(public.wins,numeric) SECURITY DEFINER;' + sale_facts,
        'Reports v3 sale facts: premium choke point drift')
    yield '20261104120011_reports_v3_sale_facts', sale_facts
    yield 'sale facts replay refuses', v2.refused(sale_facts, 'Reports v3 sale facts: refusing replay')
    yield 'v3 sale facts', v2.read('supabase/tests/reports_v3_sale_facts.sql')
    yield 'appointment stub refuses to run before the call and journey helpers', v2.refused(
        appointment_stub, 'Reports v3 appointment stub: the foundation (…10) and the call and journey helpers (…12)')
    yield 'call journey refuses v2 call reader drift', v2.refused(
        'ALTER FUNCTION private.report_call_facts(uuid,timestamptz,timestamptz,uuid[]) SECURITY INVOKER;' + call_journey,
        'Reports v3 call journey: v2 call reader drift')
    yield '20261104120012_reports_v3_call_journey_helpers', call_journey
    yield 'call journey replay refuses', v2.refused(call_journey, 'Reports v3 call journey: refusing replay')
    yield 'v3 calls and identity', v2.read('supabase/tests/reports_v3_calls_identity.sql')
    yield 'v3 journeys', v2.read('supabase/tests/reports_v3_journey.sql')
    yield 'state helpers refuse to run before the appointment stub', v2.refused(
        state_helpers, 'Reports v3 state helpers: the call and journey helpers (…12) and the appointment stub (…13)')
    yield 'appointment stub refuses installed appointment evidence', v2.refused(
        "DO $drift$ BEGIN EXECUTE replace(pg_get_functiondef('private.report_v3_basis_flags()'::regprocedure), "
        "'\"appointment_evidence\":\"not_installed\"', '\"appointment_evidence\":\"installed\"'); END $drift$;" + appointment_stub,
        'Reports v3 appointment stub: contract drift')
    yield 'appointment stub refuses sales appointments registry drift', v2.refused(
        "DO $drift$ BEGIN EXECUTE replace(pg_get_functiondef('private.report_v3_kpi_ids(text)'::regprocedure), "
        "'ARRAY[12, 15, 16, 17, 18]', 'ARRAY[12, 15, 16, 18, 17]'); END $drift$;" + appointment_stub,
        'Reports v3 appointment stub: contract drift')
    yield '20261104120013_reports_v3_appointment_facts_stub', appointment_stub
    yield 'appointment stub replay refuses', v2.refused(appointment_stub, 'Reports v3 appointment stub: refusing replay')
    for label, alteration in [
            ('a changed body', "'WHEN ''texas''               THEN ''TX''', 'WHEN ''texas''               THEN ''OK'''"),
            ('a volatile normalizer', 'ALTER FUNCTION public.normalize_us_state(text) VOLATILE;'),
            ('a definer normalizer', 'ALTER FUNCTION public.normalize_us_state(text) SECURITY DEFINER;'),
            ('a changed search_path', 'ALTER FUNCTION public.normalize_us_state(text) SET search_path = public;')]:
        yield 'state helpers refuse normalizer drift: ' + label, v2.refused(
            normalizer_drift(alteration) + state_helpers, 'Reports v3 state helpers: normalize_us_state drift')
    yield 'state helpers refuse a missing state column', v2.refused(
        'ALTER TABLE public.campaign_leads DROP COLUMN state;' + state_helpers,
        'Reports v3 state helpers: dependency column missing: public.campaign_leads.state')
    yield 'readers refuse to run before the state helpers', v2.refused(readers, 'Reports v3 readers: the helpers (…10 to …14)')
    yield '20261104120014_reports_v3_state_helpers', state_helpers
    yield 'state helpers replay refuses', v2.refused(state_helpers, 'Reports v3 state helpers: refusing replay')
    yield 'readers refuse v2 reader drift', v2.refused(
        'ALTER FUNCTION public.get_report_call_volume_v2(date,date,uuid,text) SET search_path = public;' + readers,
        'Reports v3 readers: v2 or closure preimage drift: public.get_report_call_volume_v2')
    yield 'readers refuse closure-helper drift', v2.refused(
        'ALTER FUNCTION private.report_visible_campaigns(uuid) SECURITY DEFINER;' + readers,
        'Reports v3 readers: v2 or closure preimage drift: private.report_visible_campaigns')
    yield '20261104120015_reports_v3_readers', readers
    yield 'readers replay refuses', v2.refused(readers, 'Reports v3 readers: refusing replay')
    yield 'v3 readers are created sealed', 'SELECT rt.assert_sealed(true); SELECT rt.assert_sealed_v3(true, false); SELECT rt.assert_v3_helper_shape();'
    # The concurrent index, run as the release runner will: outside a transaction, lock_timeout 2s, then the
    # exact-definition and validity post-check. A leftover of the same name is never silently accepted.
    run_index = "SET lock_timeout = '2s';\n" + calls_index + "\nRESET lock_timeout;"
    yield 'index check refuses a missing index', "SELECT rt.expect_sql_failure('SELECT rt.v3_index_check()', 'report_v3_calls_org_campaign_lead is missing');"
    yield 'index leftover with another definition', no_transaction(
        'CREATE INDEX report_v3_calls_org_campaign_lead ON public.calls (organization_id);')
    yield 'index file keeps the leftover (IF NOT EXISTS)', no_transaction(run_index)
    yield 'index check refuses the other definition', "SELECT rt.expect_sql_failure('SELECT rt.v3_index_check()', 'report_v3_calls_org_campaign_lead definition mismatch');"
    yield 'index leftover removed', no_transaction('DROP INDEX public.report_v3_calls_org_campaign_lead;')
    yield 'invalid index leftover', no_transaction(
        'CREATE INDEX report_v3_calls_org_campaign_lead ON public.calls (organization_id, campaign_lead_id, created_at);\n'
        "UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.report_v3_calls_org_campaign_lead'::regclass;")
    yield 'index file keeps the invalid leftover (IF NOT EXISTS)', no_transaction(run_index)
    yield 'index check refuses the invalid leftover', "SELECT rt.expect_sql_failure('SELECT rt.v3_index_check()', 'report_v3_calls_org_campaign_lead is not valid');"
    yield 'invalid index leftover removed', no_transaction('DROP INDEX public.report_v3_calls_org_campaign_lead;')
    yield '20261104120016_reports_v3_calls_campaign_lead_index', no_transaction(run_index)
    yield 'index definition and validity', 'SELECT rt.v3_index_check();'
    yield 'v3 appointment facts', v2.read('supabase/tests/reports_v3_appointment_facts.sql')
    yield 'v3 state helpers and reader', v2.read('supabase/tests/reports_v3_state_breakdown.sql')
    yield 'v3 call readers', v2.read('supabase/tests/reports_v3_call_readers.sql')
    yield 'v3 security', v2.read('supabase/tests/reports_v3_security.sql')
    yield 'v3 negative controls', v2.read('supabase/tests/reports_v3_negative.sql')
    yield 'v3 reader contract', contract_readers
    yield 'v2 surface unchanged after the v3 readers', 'SELECT rt.assert_sealed(true); SELECT rt.assert_sealed_v3(true, false);'
    # Performance at the required scale, embedded for quick local diagnostics only: always mode diagnostic (report-only,
    # never acceptance evidence) and no restart round. Acceptance runs through scripts/run_reports_v3_perf_acceptance.sh.
    # REPORTS_V3_PERF=0 skips it (the CI functional job). Each sample is its own statement, so the measurement step runs
    # outside a transaction block.
    if os.environ.get('REPORTS_V3_PERF', '1') != '0':
        samples = int(os.environ.get('REPORTS_V3_PERF_SAMPLES', '5'))
        assert 3 <= samples <= 100, 'REPORTS_V3_PERF_SAMPLES must be between 3 and 100'
        enforce = 'true' if os.environ.get('REPORTS_V3_PERF_ENFORCE') == '1' else 'false'
        yield 'v3 performance fixture (500,000 calls, 5,000 clients, 10,000 policy objects)', performance_part('setup')
        yield 'v3 performance measurement (diagnostic, report-only)', no_transaction(
            '\\set perf_samples ' + str(samples) + '\n\\set perf_mode diagnostic\n\\set perf_enforce ' + enforce
            + '\n\\set perf_restart false\n'
            + performance_part('measure') + performance_part('explain') + performance_part('finish'))


def performance_part(name):
    """One stage of reports_v3_performance.sql, split at its '-- @@performance-<stage>@@' markers ('setup' is the part
    before the first marker). The differential and acceptance runners run the stages as separate psql invocations."""
    text = v2.read('supabase/tests/reports_v3_performance.sql')
    pieces = re.split(r'^-- @@performance-([a-z-]+)@@$', text, flags=re.M)
    parts = {'setup': pieces[0]}
    for i in range(1, len(pieces), 2):
        assert pieces[i] not in parts, 'duplicate performance marker: ' + pieces[i]
        parts[pieces[i]] = pieces[i + 1]
    assert name in parts, 'no performance stage named ' + name
    return parts[name]


PAYLOAD_READERS = [  # (payload key, reader, scope-only) in REPORT_RPC_V3 order; the v2 keys serve the base bundle
    ('scopeV3', 'get_report_scope_v3', True), ('summaryV3', 'get_report_summary_v3', False),
    ('journeyV3', 'get_report_journey_v3', False), ('salesAppointmentsV3', 'get_report_sales_appointments_v3', False),
    ('statesV3', 'get_report_state_breakdown_v3', False), ('volumeV3', 'get_report_call_volume_v3', False),
    ('dispositionsV3', 'get_report_disposition_breakdown_v3', False), ('campaignsV3', 'get_report_campaign_calls_v3', False),
    ('leadSourcesV3', 'get_report_lead_source_calls_v3', False),
    ('scope', 'get_report_scope_v2', True), ('summary', 'get_report_call_summary_v2', False),
    ('volume', 'get_report_call_volume_v2', False), ('dispositions', 'get_report_disposition_breakdown_v2', False),
    ('campaigns', 'get_report_campaign_performance_v2', False), ('leadSources', 'get_report_lead_source_performance_v2', False),
]


def payloads_part():
    """The payload file (D1 X9): every report reader's real response for one synthetic actor (the scale organization's
    Admin, persona 0) over the 30 days ending on the agency's today (the page's default "Last 30 days"), at agency, team
    and personal scope. One
    REPEATABLE READ snapshot; the sealed v3 readers are granted only inside it and the transaction rolls back, so the
    database is unchanged. Synthetic data only; the file is a test input, never part of a production build."""
    def call(reader, scope_only, scope):
        args = f"'{scope}'" if scope_only else f"%L::date, %L::date, NULL, '{scope}'"
        sql = f"format($q$SELECT public.{reader}({args})$q$, (now() AT TIME ZONE m.tz)::date - 29, (now() AT TIME ZONE m.tz)::date)" if not scope_only \
            else f"$q$SELECT public.{reader}({args})$q$"
        return f"rt.call(rt.perf_agent(0), m.org, {sql})"
    def bundle(scope):
        return 'jsonb_build_object(' + ', '.join(f"'{k}', {call(r, s, scope)}" for k, r, s in PAYLOAD_READERS) + ')'
    v3 = ', '.join(f"'{r}'" for k, r, s in PAYLOAD_READERS if k.endswith('V3'))
    return f"""\\set ON_ERROR_STOP 1
SET statement_timeout = 0;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $grant$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ({v3}) LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $grant$;
\\pset tuples_only on
\\pset format unaligned
\\o :payloads
SELECT jsonb_pretty({bundle('agency')} || jsonb_build_object(
         'scopes', jsonb_build_object('team', {bundle('team')}, 'personal', {bundle('personal')}),
         'fixture', jsonb_build_object('source', 'reports_v3_performance.sql scale organization (synthetic)',
                                       'actor', rt.perf_agent(0), 'organization', m.org, 'time_zone', m.tz,
                                       'start_date', (now() AT TIME ZONE m.tz)::date - 29, 'end_date', (now() AT TIME ZONE m.tz)::date)))
  FROM rt.perf_meta m;
\\o
ROLLBACK;
"""


if __name__ == '__main__':
    if '--part' in sys.argv and sys.argv[sys.argv.index('--part') + 1] == 'payloads':
        print('\\echo v3 payload file\n' + payloads_part())
        sys.exit(0)
    if '--part' in sys.argv:
        # One performance stage only, for a database that already holds the functional suites.
        stage = sys.argv[sys.argv.index('--part') + 1]
        sql = performance_part(stage)
        print('\\echo v3 performance ' + stage + '\n' + ('BEGIN;\n' + sql + '\nCOMMIT;\n' if stage == 'setup' else sql))
        sys.exit(0)
    data = list(steps())
    if '--json' in sys.argv:
        print(json.dumps([[label, sql[1] if isinstance(sql, tuple) else sql, not isinstance(sql, tuple)] for label, sql in data]))
    else:
        for label, sql in data:
            if isinstance(sql, tuple):
                print('\\echo ' + label + '\n' + sql[1] + '\n')
            else:
                print('\\echo ' + label + '\nBEGIN;\n' + sql + '\nCOMMIT;\n')
