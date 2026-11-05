"""Disposable Reports v3 verification database built from verbatim repository sources; no network access.

The database starts in the production-equivalent v2 state (the reviewed v2 migrations, the overlap
correction and its release enable, built by the same verbatim extraction as reports_integrity_fixture.py),
then applies the PKG-A v3 migrations, found by their unique suffixes, and runs the v3 suites.
"""
from pathlib import Path
import importlib.util, itertools, json, os, re, sys

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


# ── Release enable (D1 §5, §2.8 class E): the pinned report closure ──────────────────────────────────────────────────
# The seed: the 15 v2 pins and the 12 closure helpers (supabase/ops/reports_integrity_enable.sql and …10), plus every
# private.report_v3_% and public.get_report_%_v3. The closure adds every public/private function a member's body names
# (all overloads), transitively. The enable pins exactly this set; the harness writes it from the disposable database.
CLOSURE_SEED = [
    'private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])', 'private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[])',
    'private.report_call_facts(uuid,timestamptz,timestamptz,uuid[])', 'public.get_report_call_summary(date,date,uuid)',
    'private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])', 'private.report_access_v2(text,uuid)',
    'private.report_monthly_amount(text)', 'private.report_policy_value_facts(uuid,uuid[])',
    'private.report_premium_totals(bigint,bigint,numeric,bigint,bigint,bigint)', 'public.get_report_scope_v2(text)',
    'public.get_report_call_summary_v2(date,date,uuid,text)', 'public.get_report_call_volume_v2(date,date,uuid,text)',
    'public.get_report_disposition_breakdown_v2(date,date,uuid,text)', 'public.get_report_campaign_performance_v2(date,date,uuid,text)',
    'public.get_report_lead_source_performance_v2(date,date,uuid,text)',
    'private.report_window(uuid,date,date)', 'private.report_meta(text,uuid,text,text,date,date,timestamptz,timestamptz)',
    'private.report_agent_name(text,text)', 'private.report_visible_campaigns(uuid)', 'private.report_policy_quality(uuid,uuid[])',
    'private.report_policy_facts(uuid,uuid[])', 'private.report_policy_campaign_lineage(uuid,uuid[])',
    'private.report_agency_time_zone(uuid)', 'private.report_permission_flags(uuid,text)', 'private.campaign_actor()',
    'private.resolve_downline_ids(uuid,uuid)', 'private.profile_parse_iso_date(text)']
V2_READERS = ['public.get_report_scope_v2(text)'] + [f'public.get_report_{r}_v2(date,date,uuid,text)' for r in (
    'call_summary', 'call_volume', 'disposition_breakdown', 'campaign_performance', 'lead_source_performance')]
V3_READERS = ['public.get_report_scope_v3(text)'] + [f'public.get_report_{r}_v3(date,date,uuid,text)' for r in (
    'summary', 'journey', 'sales_appointments', 'state_breakdown', 'call_volume', 'disposition_breakdown',
    'campaign_calls', 'lead_source_calls')]
ENABLE_PACKAGES = {  # package → (release-enable migration, contract version)
    'A': ('20261105120017_reports_v3_release_enable.sql', '3.0.0'),
    'B': ('20261105120022_reports_v3_release_enable_pkg_b.sql', '3.1.0'),
    'C': ('20261105120033_reports_v3_release_enable_pkg_c.sql', '3.2.0'),
    'D': ('20261105120044_reports_v3_release_enable_pkg_d.sql', '3.3.0')}


def closure_cte(indent='  '):
    """WITH RECURSIVE report_closure(oid): the seed and every public/private function a member body names."""
    seed = (',\n' + indent + '    ').join("'" + s + "'" for s in CLOSURE_SEED)
    return f"""WITH RECURSIVE report_closure(oid) AS (
{indent}  SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
{indent}   WHERE (n.nspname = 'private' AND p.proname LIKE 'report\\_v3\\_%')
{indent}      OR (n.nspname = 'public' AND p.proname LIKE 'get\\_report\\_%\\_v3')
{indent}  UNION
{indent}  SELECT pg_catalog.to_regprocedure(s)::oid FROM unnest(ARRAY[
{indent}    {seed}]) s
{indent}  UNION
{indent}  SELECT q.oid FROM report_closure c JOIN pg_catalog.pg_proc p ON p.oid = c.oid
{indent}   CROSS JOIN LATERAL pg_catalog.regexp_matches(p.prosrc, '(public|private)\\.([a-z_][a-z0-9_]*)\\s*\\(', 'g') m
{indent}   JOIN pg_catalog.pg_namespace qn ON qn.nspname = m[1]
{indent}   JOIN pg_catalog.pg_proc q ON q.pronamespace = qn.oid AND q.proname = m[2])"""


def closure_tuple(alias='p'):
    """One pin as text: signature|md5(prosrc)|definer|volatility|proconfig (the read-back fingerprint input)."""
    return (f"concat_ws('|', {alias}.oid::regprocedure::text, md5({alias}.prosrc), {alias}.prosecdef::text, "
            f"{alias}.provolatile::text, coalesce({alias}.proconfig::text, ''))")


def enable_pins_part():
    """Prints, for the database's current state, the enable's VALUES rows and the read-back fingerprint (harness only).
    Every function in the closure must be owned by postgres, or the pin list cannot be written."""
    return f"""SET search_path = pg_catalog;
SELECT rt_owner.n AS not_owned_by_postgres FROM (SELECT count(*) AS n FROM ({closure_cte('')}
SELECT oid FROM report_closure) c JOIN pg_proc p ON p.oid = c.oid WHERE p.proowner <> 'postgres'::regrole) rt_owner;
\\pset format unaligned
\\pset tuples_only on
{closure_cte('')}
SELECT '    (' || quote_literal(p.oid::regprocedure::text) || ', ' || quote_literal(md5(p.prosrc)) || ', '
       || p.prosecdef::text || ', ' || quote_literal(p.provolatile::text) || ', '
       || coalesce(quote_literal(p.proconfig::text), 'NULL') || ')'
  FROM report_closure c JOIN pg_proc p ON p.oid = c.oid ORDER BY p.oid::regprocedure::text COLLATE "C";
{closure_cte('')}
SELECT '-- fingerprint ' || (private.report_v3_basis_flags() ->> 'contract_version') || ' ' || count(*) || ' '
       || md5(string_agg({closure_tuple()}, E'\\n' ORDER BY p.oid::regprocedure::text COLLATE "C"))
  FROM report_closure c JOIN pg_proc p ON p.oid = c.oid;
"""


def render_enable(package, rows):
    """The release enable for one package state, from the harness's VALUES rows (enable_pins_part). The ops file is the
    rendering for the latest package; each release-enable migration is the rendering for its own package."""
    migration, contract = ENABLE_PACKAGES[package]
    readers = ',\n'.join("    '" + s + "'" for s in V2_READERS + V3_READERS)
    report_fn = ("(n.nspname = 'private' AND p.proname LIKE 'report\\_%')\n"
                 "        OR (n.nspname = 'public' AND (p.proname LIKE 'get\\_report\\_%' OR p.proname LIKE 'rpc\\_report\\_%'))")
    return f"""-- =====================================================================================================
-- Reports V2 (v3) release enable, PKG-{package} state (contract {contract}). Privilege class E (plan §2.8).
-- Byte copy: supabase/migrations/{migration}. The highest-version release-enable migration is byte-equal to
-- supabase/ops/reports_v3_enable.sql; earlier ones are pinned by SHA-256 in scripts/reports_release.py.
--
-- 1. Pins: every function in the report closure (the 15 v2 pins, the 12 closure helpers, every private.report_v3_%
--    and public.get_report_%_v3, and every public/private function a pinned body names) by md5(prosrc), SECURITY
--    DEFINER, volatility, proconfig and owner postgres. Generated by the harness from the disposable database at this
--    package state (scripts/reports_v3_fixture.py --part enable-pins); regenerate after any SQL change.
-- 2. Completeness: the closure recomputed here must equal the pin set exactly (no unpinned or stale function).
-- 3. Seal: REVOKE ALL on every private.report_%, public.get_report_% and public.rpc_report_% from PUBLIC, anon,
--    authenticated and service_role; then EXECUTE on exactly the 15 report readers (6 v2, 9 v3) TO authenticated,
--    service_role. Class W application RPCs are not report functions and are untouched.
-- 4. Effective privileges, including any PUBLIC entry, are checked before commit; any mismatch rolls back.
-- Reads and writes no table data; changes no RLS policy. Apply only with Chris's separate approval of this stage.
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';

DO $enable$
DECLARE
  f record; v_sig text; v_role text; v_expected boolean; v_pinned oid[] := '{{}}'; v_drift text;
  v_readers text[] := ARRAY[
{readers}];
BEGIN
  FOR f IN SELECT * FROM (VALUES
{rows.rstrip()}
  ) AS expected(signature, body_md5, is_definer, volatility, config) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure(f.signature)
                     AND md5(prosrc) = f.body_md5 AND proowner = 'postgres'::regrole AND prosecdef = f.is_definer
                     AND provolatile::text = f.volatility AND proconfig::text IS NOT DISTINCT FROM f.config) THEN
      RAISE EXCEPTION 'Reports v3 enable: unverified body or authorization metadata: %', f.signature;
    END IF;
    v_pinned := v_pinned || pg_catalog.to_regprocedure(f.signature)::oid;
  END LOOP;

  {closure_cte('  ')}
  SELECT string_agg(c.oid::regprocedure::text, ', ' ORDER BY c.oid::regprocedure::text COLLATE "C") INTO v_drift
    FROM report_closure c WHERE NOT c.oid = ANY (v_pinned);
  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION 'Reports v3 enable: unpinned function in the report closure: %', v_drift;
  END IF;
  {closure_cte('  ')}
  SELECT string_agg(x::regprocedure::text, ', ') INTO v_drift
    FROM unnest(v_pinned) x WHERE x NOT IN (SELECT oid FROM report_closure);
  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION 'Reports v3 enable: pinned function outside the report closure: %', v_drift;
  END IF;
  IF private.report_v3_basis_flags() ->> 'contract_version' IS DISTINCT FROM '{contract}' THEN
    RAISE EXCEPTION 'Reports v3 enable: contract version is not {contract}';
  END IF;

  FOR f IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE {report_fn} LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f.oid::regprocedure);
  END LOOP;
  FOREACH v_sig IN ARRAY v_readers LOOP
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', pg_catalog.to_regprocedure(v_sig));
  END LOOP;

  FOR f IN SELECT p.oid, p.proacl, p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE {report_fn} LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'Reports v3 enable: PUBLIC can execute %', f.oid::regprocedure;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      v_expected := v_role <> 'anon' AND f.oid = ANY (SELECT pg_catalog.to_regprocedure(r)::oid FROM unnest(v_readers) r);
      IF pg_catalog.has_function_privilege(v_role, f.oid, 'EXECUTE') IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'Reports v3 enable: effective privilege mismatch for % on %', v_role, f.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
END $enable$;
NOTIFY pgrst, 'reload schema';
"""


def release_file(package):
    return v2.read('supabase/migrations/' + ENABLE_PACKAGES[package][0])


def read_only_body(name):
    """A read-only ops script without its BEGIN READ ONLY / ROLLBACK, for a refusal probe inside a transaction."""
    text = v2.read('supabase/ops/' + name)
    assert text.count('BEGIN TRANSACTION READ ONLY;\n') == 1 and text.endswith('ROLLBACK;\n'), name
    return text.replace('BEGIN TRANSACTION READ ONLY;\n', '').removesuffix('ROLLBACK;\n')


W_WRITERS_ON = ("SELECT rt.eq('class W RPCs keep their authenticated EXECUTE', (SELECT string_agg(p.proname || ':' || "
                "has_function_privilege('authenticated', p.oid, 'EXECUTE') || ':' || has_function_privilege('anon', p.oid, 'EXECUTE'), ' ' "
                "ORDER BY p.proname COLLATE \"C\") FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN "
                "('correct_policy_sale_premium', 'get_client_policy_sale_premiums', 'record_appointment_outcome', 'get_policy_appointment_links', "
                "'link_policy_appointment', 'correct_policy_appointment_link')), {want});")


def release_steps(package):
    """The release-enable, read-back and disable stages at one package state (D1 §3.10, §9.6), ending as they began:
    v2 enabled, v3 sealed. Each release enable passes only at its own state; the ops disables never touch class W."""
    migration = ENABLE_PACKAGES[package][0]
    for other in ENABLE_PACKAGES:
        if other != package:
            yield f'PKG-{package}: the PKG-{other} release enable refuses', v2.refused(
                release_file(other), 'Reports v3 enable: unverified body or authorization metadata')
    if package == 'A':
        yield 'release enable refuses an unpinned report function', v2.refused(
            'CREATE FUNCTION private.report_v3_unpinned() RETURNS integer LANGUAGE sql SET search_path = pg_catalog, pg_temp '
            'AS $f$ SELECT 1 $f$;\n' + release_file('A'), 'Reports v3 enable: unpinned function in the report closure')
        yield 'release enable refuses a drifted pin (SECURITY DEFINER added)', v2.refused(
            'ALTER FUNCTION private.report_v3_kpi_ids(text) SECURITY DEFINER;\n' + release_file('A'),
            'Reports v3 enable: unverified body or authorization metadata: private.report_v3_kpi_ids(text)')
        yield 'read-back refuses while Reports v3 is sealed', v2.refused(read_only_body('reports_v3_readback.sql'),
                                                                        'Reports v3 read-back: unexpected privileges on')
    yield migration.removesuffix('.sql'), release_file(package) + 'SELECT rt.assert_sealed_v3(true, true);'
    yield f'read-back (PKG-{package})', no_transaction(v2.read('supabase/ops/reports_v3_readback.sql'))
    yield f'read-back refuses a narrowed reader privilege (PKG-{package}, probe)', v2.refused(
        'REVOKE EXECUTE ON FUNCTION public.get_report_journey_v3(date,date,uuid,text) FROM service_role;\n'
        + read_only_body('reports_v3_readback.sql'), 'Reports v3 read-back: unexpected privileges on public.get_report_journey_v3')
    yield f'release enable replay is idempotent (PKG-{package})', release_file(package) + 'SELECT rt.assert_sealed_v3(true, true);'
    yield f'disable-v3 (PKG-{package})', v2.read('supabase/ops/reports_v3_disable.sql') + 'SELECT rt.assert_sealed_v3(true, false);' + (
        W_WRITERS_ON.format(want="'correct_policy_sale_premium:true:false get_client_policy_sale_premiums:true:false'") if package in ('B', 'C') else
        W_WRITERS_ON.format(want="'correct_policy_appointment_link:true:false correct_policy_sale_premium:true:false get_client_policy_sale_premiums:true:false "
                                 "get_policy_appointment_links:true:false link_policy_appointment:true:false record_appointment_outcome:true:false'")
        if package == 'D' else '')
    if package in ('A', 'D'):
        yield f'disable-all (PKG-{package})', release_file(package) + v2.read('supabase/ops/reports_all_disable.sql') + (
            'SELECT rt.assert_sealed_v3(false, false);') + (W_WRITERS_ON.format(
                want="'correct_policy_appointment_link:true:false correct_policy_sale_premium:true:false get_client_policy_sale_premiums:true:false "
                     "get_policy_appointment_links:true:false link_policy_appointment:true:false record_appointment_outcome:true:false'") if package == 'D' else '')
        yield f're-enable after disable-all (PKG-{package}{", the ops enable" if package == "D" else ""})', (
            v2.read('supabase/ops/reports_v3_enable.sql') if package == 'D' else release_file('A')) + 'SELECT rt.assert_sealed_v3(true, true);'
        yield f'read-back after re-enable (PKG-{package})', no_transaction(v2.read('supabase/ops/reports_v3_readback.sql'))
        yield f'disable-v3 after re-enable (PKG-{package})', v2.read('supabase/ops/reports_v3_disable.sql') + 'SELECT rt.assert_sealed_v3(true, false);'


PR515_RELIABILITY = 'supabase/migrations/20261105051018_dialer_reliability.sql'
PR515_COUNTS = 'supabase/migrations/20261105051037_dialer_admitted_call_counts.sql'


def pr515_v2_state():
    """Production's PR #515 v2 state, verbatim (both migrations are applied in production): the signed-admission
    projection (calls.dialer_provider_admitted, its BEFORE INSERT OR UPDATE trigger and the backfill) from …051018, and
    the admitted-call report_call_facts from …051037. The rest of those files touches dialer functions that the Reports
    fixture does not hold; it is proven by scripts/tests/dialer-reliability."""
    reliability = v2.read(PR515_RELIABILITY)
    a = reliability.index('ALTER TABLE public.calls ADD COLUMN dialer_provider_admitted boolean;')
    end = 'WHERE c.organization_id=a.organization_id AND c.id=a.call_id AND c.dialer_admission_required;'
    projection = reliability[a:reliability.index(end, a) + len(end)]
    counts = v2.read(PR515_COUNTS)
    b = counts.index('CREATE OR REPLACE FUNCTION private.report_call_facts(')
    reader = counts[b:counts.index('\n$function$\n', b) + len('\n$function$\n')] + ';'
    return '\n'.join([projection, reader,
        "SELECT rt.eq('PR #515 report_call_facts is the production body', md5(prosrc), '03b2c36446fb0b7dec0bac14b401a864') "
        "FROM pg_proc WHERE oid = 'private.report_call_facts(uuid,timestamptz,timestamptz,uuid[])'::regprocedure;"])


CORRECTION_SUITE = 'supabase/tests/policy_sale_premium_correction.sql'
CORRECTION_ROLLBACK = 'supabase/migrations/rollback/20261105120020_policy_sale_premium_corrections.rollback.sql'
MANIFEST_CHECK = 'supabase/ops/reporting-accuracy/check_sale_correction_manifest.sql'
# md5(pg_get_functiondef) postimages (D2 §3.7): PKG-A (…10, …11, live choke point) and PKG-B (…21).
PKG_A_BASIS = {'report_v3_sale_premium(public.wins,numeric)': '37800ccc8ada2fae26b86dd5a610eb09',
               'report_v3_basis_flags()': 'e446177c344762bec8caf7d5e9321d9b',
               'performance_sale_monthly(public.wins,numeric)': '51e06b46a13c3a8eec4d672bec158376'}
PKG_B_BASIS = {'report_v3_sale_premium(public.wins,numeric)': '9c46e97ff58247a13826ddef83e28355',
               'report_v3_basis_flags()': '67c6a60a1004b4596a4a61487a41d17b',
               'performance_sale_monthly(public.wins,numeric)': 'ee64ddb694ad2e1b250ba069342c75fa'}
CORRECTION_WRITER = 'public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)'


def correction_suite_v3():
    """The v3 section of the PKG-B correction suite (after its '-- @@v3@@' marker; the head runs in reporting_fixture.py)."""
    text = v2.read(CORRECTION_SUITE)
    assert text.count('\n-- @@v3@@\n') == 1, 'correction suite v3 marker'
    return text.split('\n-- @@v3@@\n')[1]


def basis_state(label, want):
    """Assert md5(pg_get_functiondef) of the premium functions against a postimage set."""
    names = sorted(want)
    got = " || ' ' || ".join(f"md5(pg_get_functiondef('private.{f}'::regprocedure))" for f in names)
    return f"SELECT rt.eq({v2.quote(label)}, {got}, {v2.quote(' '.join(want[f] for f in names))});"


def manifest_check(label, rows, want):
    """The read-only B6 manifest check (the ops file verbatim, its $1 and $2 bound to literals) in a read-only
    subtransaction. want is 'pass:has_revision,...'."""
    sql = v2.read(MANIFEST_CHECK).rstrip().rstrip(';')
    assert sql.count('$1::uuid') >= 1 and sql.count('$2::jsonb') == 1 and '$3' not in sql, 'manifest check parameters'
    sql = sql.replace('$1::uuid', "rt.v3('O1')").replace('$2::jsonb', v2.quote(rows) + '::jsonb')
    return '\n'.join([
        'SAVEPOINT manifest;',
        'SET LOCAL transaction_read_only = on;',
        f"SELECT rt.eq({v2.quote(label)}, (SELECT (r ->> 'pass') || ':' || coalesce((SELECT string_agg(x ->> 'has_revision', ',' ORDER BY o) "
        f"FROM jsonb_array_elements(r -> 'rows') WITH ORDINALITY y(x, o)), '') FROM ({sql}) z(r)), {v2.quote(want)});",
        "SELECT rt.expect_sql_failure($w$INSERT INTO rt.v3_ids VALUES ('RO', gen_random_uuid())$w$, 'read-only transaction');",
        'ROLLBACK TO SAVEPOINT manifest;'])


def ledger_row(win, previous, corrected, request, actor='ADM1'):
    """One synthetic first revision for a fixture sale, written as the table owner through the insert guard."""
    return ('INSERT INTO private.policy_sale_premium_corrections (organization_id, win_id, policy_id, policy_source, buyer_id, '
            'seller_id, sold_date, revision, previous_effective_monthly, previous_source, corrected_monthly, reason_code, note, '
            'book_mode, book_action, actor_id, actor_role, request_id, payload_hash, result) '
            f"SELECT w.organization_id, w.id, w.policy_id, 'primary', w.contact_id, w.agent_id, w.sold_date, 1, {previous}, "
            f"'sale_snapshot', {corrected}, 'entry_error', 'synthetic manifest check', 'keep_current', 'kept_current', rt.v3('{actor}'), "
            f"'Admin', '{request}'::uuid, repeat('0', 64), '{{}}'::jsonb FROM public.wins w WHERE w.id = rt.v3('{win}');")




def baseline_statements(prefix):
    """Every baseline statement starting with prefix, verbatim (policies, triggers, grants)."""
    text, out, i = v2.read(BASELINE), [], 0
    while True:
        a = text.find(prefix, i)
        if a < 0:
            return out
        b = text.index(';\n', a)
        out.append(text[a:b + 1])
        i = b


def baseline_table(name):
    text = v2.read(BASELINE)
    a = text.index(f'CREATE TABLE IF NOT EXISTS "public"."{name}" (')
    return text[a:text.index('\n);', a) + 3]


def appointment_dependencies():
    """Production appointment objects for PKG-D on the v3 fixture: the baseline appointments and appointment_types
    tables, their RLS policies, update triggers, grants and seed, the booking-receipt columns and table, and the
    baseline role helpers the appointments_select replica (…42) and the policy predicate need. Synthetic data only."""
    receipts = v2.read(next(str(p.relative_to(ROOT)) for p in (ROOT / 'supabase/migrations').glob('*_booking_disposition_receipts.sql')))
    a = receipts.index('CREATE TABLE private.booking_receipts(')
    receipts_table = receipts[a:receipts.index('\n);', a) + 3]
    helpers = [v2.block(BASELINE, f'CREATE OR REPLACE FUNCTION "public"."{f}"(') for f in ('get_user_role', 'is_super_admin', 'is_ancestor_of',
                                                                                         'update_updated_at', 'seed_default_appointment_types')]
    return '\n'.join([
        'CREATE EXTENSION IF NOT EXISTS ltree;',
        'ALTER TABLE public.profiles ADD COLUMN team_id uuid, ADD COLUMN hierarchy_path ltree;',
        *helpers,
        # The harness's reduced appointments table (v2 readers) gains the remaining baseline columns (types and defaults
        # verbatim; start_time stays nullable for the harness's existing rows) and the booking-receipt columns.
        "ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS contact_name text, ADD COLUMN IF NOT EXISTS contact_id uuid, ADD COLUMN IF NOT EXISTS start_time timestamptz, "
        "ADD COLUMN IF NOT EXISTS end_time timestamptz, ADD COLUMN IF NOT EXISTS notes text, ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(), "
        "ADD COLUMN IF NOT EXISTS external_event_id text, ADD COLUMN IF NOT EXISTS external_provider text, ADD COLUMN IF NOT EXISTS external_last_synced_at timestamptz, "
        "ADD COLUMN IF NOT EXISTS sync_source text DEFAULT 'internal' NOT NULL, ADD COLUMN IF NOT EXISTS booking_request_id uuid, ADD COLUMN IF NOT EXISTS booking_kind text;",
        "ALTER TABLE public.appointments ALTER COLUMN type SET DEFAULT 'Sales Call', ALTER COLUMN status SET DEFAULT 'Scheduled';",
        receipts_table, 'ALTER TABLE private.booking_receipts ENABLE ROW LEVEL SECURITY;',
        'REVOKE ALL ON private.booking_receipts FROM PUBLIC, anon, authenticated, service_role;',
        baseline_table('appointment_types'), 'ALTER TABLE public.appointment_types ADD PRIMARY KEY (id);',
        *baseline_statements('CREATE OR REPLACE TRIGGER "appointment_types_updated_at"'),
        *baseline_statements('CREATE OR REPLACE TRIGGER "appointments_updated_at"'),
        *baseline_statements('ALTER TABLE "public"."appointment_types" ENABLE ROW LEVEL SECURITY'),
        *baseline_statements('ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY'),
        *baseline_statements('CREATE POLICY "appointment_types_'), *baseline_statements('CREATE POLICY "appointments_'),
        *baseline_statements('GRANT ALL ON TABLE "public"."appointment_types" TO "authenticated"'),
        *baseline_statements('GRANT ALL ON TABLE "public"."appointments" TO "authenticated"')])


def appointment_facts_suite():
    """The appointment facts suite: the PKG-A stub section, then the PKG-D section after its '-- @@pkg-d@@' marker."""
    text = v2.read('supabase/tests/reports_v3_appointment_facts.sql')
    assert text.count('\n-- @@pkg-d@@\n') == 1, 'appointment facts pkg-d marker'
    return text.split('\n-- @@pkg-d@@\n')


def pkg_d_steps(back=False):
    """PKG-D on the v3 readers (D4 §3.2-§3.6), in release order B → C → D: the forward part runs after the PKG-C forward
    steps, while the flags are PKG-C's (3.2.0): …40-…43 and the attribution and appointment-facts suites (each rolled
    back). The back part (back=True) runs the rollbacks in reverse, back to the PKG-C state."""
    categories = v2.migration('appointment_type_categories')
    evidence = v2.migration('appointment_occurrence_evidence')
    links = v2.migration('policy_appointment_attributions')
    facts = v2.migration('reports_v3_appointment_facts')
    rb = lambda name: v2.read(next(str(p.relative_to(ROOT)) for p in (ROOT / 'supabase/migrations/rollback').glob('*_' + name + '.rollback.sql')))
    v3_on = ("DO $on$ DECLARE f regprocedure; BEGIN FOR f IN SELECT p.oid::regprocedure FROM pg_proc p "
             "JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'get_report_summary_v3' "
             "LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f); END LOOP; END $on$;\n")
    stub_md5 = "md5(pg_get_functiondef('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)'::regprocedure))"
    if back:
        yield from _pkg_d_back(v3_on, rb, stub_md5)
        return
    yield 'PKG-D appointment dependencies (verbatim baseline objects)', appointment_dependencies()
    yield 'appointment facts refuse to run before the evidence and attributions', v2.refused(
        facts, 'Reports v3 appointment facts: the appointment evidence (…41) and attributions (…42) must be applied first')
    yield '20261105120040_appointment_type_categories', categories
    yield 'seeded appointment types for the v3 organizations', 'SELECT public.seed_default_appointment_types(id) FROM public.organizations ORDER BY id;'
    yield '20261105120041_appointment_occurrence_evidence', evidence
    yield 'attributions refuse appointments_select drift', v2.refused(
        "ALTER POLICY appointments_select ON public.appointments USING (organization_id = public.get_org_id());" + links,
        'Policy appointment attributions: appointments_select drift')
    yield '20261105120042_policy_appointment_attributions', links
    yield 'attributions replay refuses', v2.refused(links, 'Policy appointment attributions: refusing replay')
    yield 'appointment facts refuse while Reports v3 is enabled', v2.refused(v3_on + facts, 'Reports v3 appointment facts: Reports v3 must be disabled first')
    yield 'appointment facts refuse stub drift', v2.refused(
        'ALTER FUNCTION private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz) COST 101;\n' + facts,
        'Reports v3 appointment facts: stub or basis flags preimage drift')
    yield 'policy appointment attribution regressions (rolled back)', v2.read('supabase/tests/policy_appointment_attributions.sql')
    yield '20261105120043_reports_v3_appointment_facts', facts
    yield 'appointment facts replay refuses', v2.refused(facts, 'Reports v3 appointment facts: refusing replay')
    yield from release_steps('D')
    yield 'v3 sales appointments on captured evidence (rolled back)', appointment_facts_suite()[1]


def _pkg_d_back(v3_on, rb, stub_md5):
    yield 'appointment facts rollback refuses while Reports v3 is enabled', v2.refused(
        v3_on + rb('reports_v3_appointment_facts'), 'Reports v3 appointment facts rollback: Reports v3 must be disabled first')
    yield 'attributions rollback refuses before the appointment facts rollback', v2.refused(
        rb('policy_appointment_attributions'), 'Policy appointment attributions rollback: roll back the appointment facts (…43) first')
    yield 'appointment facts rollback restores the …13 stub and the PKG-C flags', rb('reports_v3_appointment_facts') + (
        f"\nSELECT rt.eq('the PKG-C flags and the stub are back', private.report_v3_basis_flags() ->> 'contract_version' || ' ' || {stub_md5}, "
        "'3.2.0 ' || " + stub_md5 + ");"
        "\nSELECT rt.eq('the stub answers again', (private.report_v3_appointment_facts(rt.v3('O1'), NULL, NULL, '2026-10-01', '2026-11-01', "
        "'America/Los_Angeles', now()) -> 'metrics' -> 1 ->> 'reason'), 'evidence_not_captured');")
    yield 'attributions rollback', rb('policy_appointment_attributions')
    yield 'appointment evidence rollback', rb('appointment_occurrence_evidence')
    yield 'appointment type categories rollback', rb('appointment_type_categories')

def pkg_b_steps(then=lambda: (), keep=None):
    """PKG-B on the v3 readers (D2 §3.7, §6.7, §9, §10): refusals, …20, …21, the suite's v3 section (rolled back), the
    read-only manifest check, the rollback probes, then the empty-ledger rollback, which returns the database to the
    exact PKG-A state so the differential and performance runners that follow keep comparing PKG-A."""
    corrections = v2.migration('policy_sale_premium_corrections')
    basis = v2.migration('reports_v3_sale_premium_basis')
    rollback = v2.read(CORRECTION_ROLLBACK)
    v3_on = ("DO $on$ DECLARE f regprocedure; BEGIN FOR f IN SELECT p.oid::regprocedure FROM pg_proc p "
             "JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'get_report_summary_v3' "
             "LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f); END LOOP; END $on$;\n")
    flags_drift = ("DO $drift$ BEGIN EXECUTE replace(pg_get_functiondef('private.report_v3_basis_flags()'::regprocedure), "
                   "'\"sale_call_links\":\"not_installed\"', '\"sale_call_links\":\"installed\"'); END $drift$;\n")
    sealed_only = ("SELECT rt.eq('the writer and the history reader are sealed; the effective reader stays', "
                   f"has_function_privilege('authenticated', '{CORRECTION_WRITER}', 'EXECUTE')::text || ':' || "
                   "has_function_privilege('authenticated', 'public.get_client_policy_sale_premiums(uuid)', 'EXECUTE') || ':' || "
                   "(to_regprocedure('private.policy_sale_effective_premium(public.wins,numeric)') IS NOT NULL), 'false:false:true');")
    yield 'sale premium basis refuses to run before the corrections ledger', v2.refused(
        basis, 'Reports v3 sale premium basis: the corrections ledger (…20) must be applied first')
    yield '20261105120020_policy_sale_premium_corrections', corrections
    yield 'sale premium basis refuses while Reports v3 is enabled', v2.refused(
        v3_on + basis, 'Reports v3 sale premium basis: Reports v3 must be disabled first')
    yield 'sale premium basis refuses sale premium stub drift', v2.refused(
        'ALTER FUNCTION private.report_v3_sale_premium(public.wins,numeric) COST 101;\n' + basis,
        'Reports v3 sale premium basis: PKG-A preimage drift')
    yield 'sale premium basis refuses basis flags drift', v2.refused(
        flags_drift + basis, 'Reports v3 sale premium basis: PKG-A preimage drift')
    yield '20261105120021_reports_v3_sale_premium_basis', basis
    yield 'sale premium basis postimages', basis_state('PKG-B postimages in place', PKG_B_BASIS)
    yield 'sale premium basis replay refuses', v2.refused(basis, 'Reports v3 sale premium basis: refusing replay')
    yield from release_steps('B')
    yield 'sale premium corrections rollback refuses while Reports v3 is enabled', v2.refused(
        v3_on + rollback, 'Sale premium corrections rollback: Reports v3 must be disabled first')
    yield 'v3 sale premium corrections (rolled back)', correction_suite_v3()
    if keep is not None:
        # REPORTS_V3_KEEP_PACKAGES=1 (integrated review database only): the later packages forward, nothing rolled back.
        yield from keep()
        return

    req_a = 'c3f00000-0000-0000-0000-00000000000a'
    req_b = 'c3f00000-0000-0000-0000-00000000000b'
    req_o2 = 'c3f00000-0000-0000-0000-0000000000b2'
    p1, p13, pb1 = 'c3d00000-0000-0000-0000-000000000001', 'c3d00000-0000-0000-0000-000000000013', 'c3d20000-0000-0000-0000-000000000001'
    rows = json.dumps([{'policy_id': p1, 'request_id': req_a}, {'policy_id': p1, 'request_id': req_b},
                       {'policy_id': p13, 'request_id': req_a}, {'policy_id': p1}, {'policy_id': pb1, 'request_id': req_o2}])
    yield 'manifest check (read only): a real revision passes; missing, other-sale, no-id and other-organization rows fail', '\n'.join([
        'SAVEPOINT rows;',
        ledger_row('W1', '100.00', '120.00', req_a),
        ledger_row('WB1', '500.00', '510.00', req_o2, actor='B1'),
        manifest_check('manifest rows in order', rows, 'false:true,false,false,false,false'),
        manifest_check('manifest with only the real revision', json.dumps([{'policy_id': p1, 'request_id': req_a}]), 'true:true'),
        manifest_check('an empty manifest has nothing to fail', '[]', 'true:'),
        'ROLLBACK TO SAVEPOINT rows;'])
    yield 'rollback with a non-empty ledger seals the writer only (probe, rolled back)', '\n'.join([
        'SAVEPOINT nonempty;',
        ledger_row('W1', '100.00', '120.00', req_a),
        rollback, sealed_only,
        basis_state('a non-empty ledger keeps the PKG-B bodies', PKG_B_BASIS),
        "SELECT rt.eq('the correction stays applied', rt.sf('W1'), '120.00|correction|known|1');",
        'ROLLBACK TO SAVEPOINT nonempty;'])
    yield 'rollback after a later package replaced the basis flags seals the writer only (probe, rolled back)', '\n'.join([
        'SAVEPOINT later;',
        flags_drift + rollback, sealed_only,
        "SELECT rt.eq('performance_sale_monthly keeps its PKG-B body', "
        "md5(pg_get_functiondef('private.performance_sale_monthly(public.wins,numeric)'::regprocedure)), 'ee64ddb694ad2e1b250ba069342c75fa');",
        'ROLLBACK TO SAVEPOINT later;'])
    # Later packages forward and back, in release order (C, then D forward; D, then C back), so this file's
    # empty-ledger rollback still meets its PKG-B postimages.
    yield from then()
    yield 'rollback with an empty ledger restores the exact PKG-A state', '\n'.join([
        rollback,
        basis_state('PKG-A preimages restored', PKG_A_BASIS),
        "SELECT rt.eq('readers and RPCs dropped; the empty ledger is kept', "
        f"(to_regprocedure('{CORRECTION_WRITER}') IS NULL)::text || ':' || "
        "(to_regprocedure('public.get_client_policy_sale_premiums(uuid)') IS NULL) || ':' || "
        "(to_regprocedure('private.policy_sale_effective_premium(public.wins,numeric)') IS NULL) || ':' || "
        "(SELECT count(*) FROM private.policy_sale_premium_corrections), 'true:true:true:0');",
        "SELECT rt.eq('PKG-A sale facts again', rt.sf('W1') || ' ' || rt.sf('W6'), "
        "'100.00|sale_snapshot|known|0 80.50|legacy_record_fallback|known|0');",
        "SELECT rt.eq('PKG-A basis flags again', private.report_v3_basis_flags() ->> 'contract_version', '3.0.0');",
        'SELECT rt.assert_sealed(true); SELECT rt.assert_sealed_v3(true, false); SELECT rt.assert_v3_helper_shape();'])
    yield 'sale premium corrections replay after rollback refuses (a re-forward is a new reviewed migration)', v2.refused(
        corrections, 'Sale premium corrections: refusing replay')


CALL_LINK_SUITE = 'supabase/tests/policy_sale_call_links.sql'
CALL_LINK_WINDOW_ROLLBACK = 'supabase/migrations/rollback/20261105120032_reports_v3_sale_call_links.rollback.sql'
LINK_STUB = 'report_v3_sale_call_links(uuid,timestamptz)'
PKG_C_BASIS = {LINK_STUB: '998bad67912edf1d113b4f72417520d7', 'report_v3_basis_flags()': '9c6c9d5e9a2ca2b985e027e72cd5e10d'}
PKG_C_PREIMAGE = {LINK_STUB: '769d31d180bf61264b0609e87b3ea24f', 'report_v3_basis_flags()': '67c6a60a1004b4596a4a61487a41d17b'}


def call_link_suite_v3():
    """The v3 section of the PKG-C link suite (after '-- @@v3@@', inside its psql \\if; the commission runner runs the head)."""
    text = v2.read(CALL_LINK_SUITE)
    assert text.count('\n-- @@v3@@\n') == 1, 'call link suite v3 marker'
    return '\\set pscl_v3 1\n' + text.split('\n-- @@v3@@\n')[1]


def pkg_c_steps(back=False):
    """PKG-C on the v3 readers (D3 §3.6, §8): refusals, …30, …32, the suite's v3 section (rolled back), then the …32
    rollback back to the exact PKG-B postimages (back=True, after PKG-D's rollbacks). …31 needs the sale handoffs and is
    proven in the commission runner."""
    links = v2.migration('policy_sale_call_links')
    window = v2.migration('reports_v3_sale_call_links')
    rollback = v2.read(CALL_LINK_WINDOW_ROLLBACK)
    v3_on = ("DO $on$ BEGIN EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_report_journey_v3(date,date,uuid,text) TO authenticated'; "
             "END $on$;\n")
    flags_drift = ("DO $drift$ BEGIN EXECUTE replace(pg_get_functiondef('private.report_v3_basis_flags()'::regprocedure), "
                   "'\"appointment_evidence\":\"not_installed\"', '\"appointment_evidence\":\"installed\"'); END $drift$;\n")
    if back:
        yield from _pkg_c_back(v3_on, rollback)
        return
    yield 'sale call links window refuses to run before the link table', v2.refused(
        window, 'Reports v3 sale call links: the link table (…30) must be applied first')
    yield '20261105120030_policy_sale_call_links', links
    yield 'sale call links replay refuses', v2.refused(links, 'Sale call links: refusing replay')
    yield 'sale call links window rollback refuses before the window', v2.refused(
        rollback, 'Reports v3 sale call links rollback: the …32 postimages are not in place')
    yield 'sale call links window refuses while Reports v3 is enabled', v2.refused(
        v3_on + window, 'Reports v3 sale call links: Reports v3 must be disabled first')
    yield 'sale call links window refuses link stub drift', v2.refused(
        'ALTER FUNCTION private.report_v3_sale_call_links(uuid,timestamptz) COST 101;\n' + window, 'Reports v3 sale call links: preimage drift')
    yield 'sale call links window refuses basis flags drift', v2.refused(
        flags_drift + window, 'Reports v3 sale call links: preimage drift')
    yield '20261105120032_reports_v3_sale_call_links', window
    yield 'sale call links window postimages', basis_state('PKG-C postimages in place', PKG_C_BASIS)
    yield 'sale call links window replay refuses', v2.refused(window, 'Reports v3 sale call links: refusing replay')
    yield from release_steps('C')
    yield 'v3 sale call links (rolled back)', call_link_suite_v3()


def _pkg_c_back(v3_on, rollback):
    """The …32 rollback (D3 §8), run after PKG-D's rollbacks have restored the PKG-C flags."""
    yield 'sale call links window rollback refuses while Reports v3 is enabled', v2.refused(
        v3_on + rollback, 'Reports v3 sale call links rollback: Reports v3 must be disabled first')
    yield 'sale call links window rollback restores the exact PKG-B postimages', '\n'.join([
        rollback, basis_state('PKG-A link stub and PKG-B flags restored', PKG_C_PREIMAGE),
        "SELECT rt.eq('KPI 38 is not captured again', (SELECT e ->> 'reason' FROM jsonb_array_elements(rt.jkpis(NULL, '2026-12-15 00:00+00')) e "
        "WHERE (e ->> 'id')::int = 38), 'sale_call_link_not_captured');",
        'SELECT rt.assert_sealed(true); SELECT rt.assert_sealed_v3(true, false); SELECT rt.assert_v3_helper_shape();'])

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
    # After the synthetic history loads, as in production: …051018's backfill projects the signed admissions that exist.
    yield 'production PR #515 v2 state (signed-admission projection, admitted-call report_call_facts)', pr515_v2_state()
    yield 'preflight (read only) passes before v3', no_transaction(v2.read('supabase/ops/reports_v3_preflight.sql'))
    yield 'disable-v3 refuses before any v3 reader exists', v2.refused(
        v2.read('supabase/ops/reports_v3_disable.sql'), 'Reports v3 disable: no v3 reader exists; refusing')

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
    yield '20261105120010_reports_v3_foundation', foundation
    yield 'foundation replay refuses', v2.refused(foundation, 'Reports v3 foundation: refusing replay')
    yield 'call journey refuses to run before sale facts', v2.refused(call_journey, 'Reports v3 call journey: the foundation')
    yield 'v3 contract', contract_head
    yield 'sale facts refuse premium choke-point drift', v2.refused(
        'ALTER FUNCTION private.performance_sale_monthly(public.wins,numeric) SECURITY DEFINER;' + sale_facts,
        'Reports v3 sale facts: premium choke point drift')
    yield '20261105120011_reports_v3_sale_facts', sale_facts
    yield 'sale facts replay refuses', v2.refused(sale_facts, 'Reports v3 sale facts: refusing replay')
    yield 'v3 sale facts', v2.read('supabase/tests/reports_v3_sale_facts.sql')
    yield 'appointment stub refuses to run before the call and journey helpers', v2.refused(
        appointment_stub, 'Reports v3 appointment stub: the foundation (…10) and the call and journey helpers (…12)')
    yield 'call journey refuses v2 call reader drift', v2.refused(
        'ALTER FUNCTION private.report_call_facts(uuid,timestamptz,timestamptz,uuid[]) SECURITY INVOKER;' + call_journey,
        'Reports v3 call journey: v2 call reader drift')
    yield '20261105120012_reports_v3_call_journey_helpers', call_journey
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
    yield '20261105120013_reports_v3_appointment_facts_stub', appointment_stub
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
    yield '20261105120014_reports_v3_state_helpers', state_helpers
    yield 'state helpers replay refuses', v2.refused(state_helpers, 'Reports v3 state helpers: refusing replay')
    yield 'readers refuse v2 reader drift', v2.refused(
        'ALTER FUNCTION public.get_report_call_volume_v2(date,date,uuid,text) SET search_path = public;' + readers,
        'Reports v3 readers: v2 or closure preimage drift: public.get_report_call_volume_v2')
    yield 'readers refuse closure-helper drift', v2.refused(
        'ALTER FUNCTION private.report_visible_campaigns(uuid) SECURITY DEFINER;' + readers,
        'Reports v3 readers: v2 or closure preimage drift: private.report_visible_campaigns')
    yield '20261105120015_reports_v3_readers', readers
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
    yield '20261105120016_reports_v3_calls_campaign_lead_index', no_transaction(run_index)
    yield 'index definition and validity', 'SELECT rt.v3_index_check();'
    yield 'v3 appointment facts', appointment_facts_suite()[0]
    yield 'v3 state helpers and reader', v2.read('supabase/tests/reports_v3_state_breakdown.sql')
    yield 'v3 call readers', v2.read('supabase/tests/reports_v3_call_readers.sql')
    yield 'v3 security', v2.read('supabase/tests/reports_v3_security.sql')
    yield 'v3 negative controls', v2.read('supabase/tests/reports_v3_negative.sql')
    yield 'v3 reader contract', contract_readers
    yield 'v2 surface unchanged after the v3 readers', 'SELECT rt.assert_sealed(true); SELECT rt.assert_sealed_v3(true, false);'
    yield 'preflight refuses once v3 exists', v2.refused(read_only_body('reports_v3_preflight.sql'), 'Reports v3 preflight: a v3 object already exists')
    yield from release_steps('A')
    yield 'v2 surface unchanged after the PKG-A release stages', 'SELECT rt.assert_sealed(true); SELECT rt.assert_sealed_v3(true, false);'
    # Release order B → C → D (D1 §4.1): C forward, D forward on C's flags, then D back and C back to the PKG-B state.
    yield from pkg_b_steps(then=lambda: itertools.chain(pkg_c_steps(), pkg_d_steps(), pkg_d_steps(back=True), pkg_c_steps(back=True)),
                           keep=(lambda: itertools.chain(pkg_c_steps(), pkg_d_steps()))
                           if os.environ.get('REPORTS_V3_KEEP_PACKAGES') == '1' else None)
    if os.environ.get('REPORTS_V3_KEEP_PACKAGES') != '1':
        # Recovery (§9.6): after the D, C and B rollbacks the PKG-A release enable and read-back pass again unchanged.
        yield 'recovery: the PKG-A release enable after the D, C and B rollbacks', release_file('A') + 'SELECT rt.assert_sealed_v3(true, true);'
        yield 'recovery: read-back at PKG-A', no_transaction(v2.read('supabase/ops/reports_v3_readback.sql'))
        yield 'recovery: disable-v3 (the differential and performance runners compare the sealed PKG-A state)', \
            v2.read('supabase/ops/reports_v3_disable.sql') + 'SELECT rt.assert_sealed(true); SELECT rt.assert_sealed_v3(true, false);'
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


def correction_payloads_part():
    """The PKG-B correction bundles (D2 §6.5 step 2, RL-17) for correctedPremiumSurfaces.test.tsx, written from the
    reporting fixture's policy database (the verbatim sale writers and performance readers): one synthetic sale entered
    today by the seller test_id(41) at $100/mo, then the seller's Leaderboard snapshot (month), performance summary
    (month, own) and Recent Wins before and after an Admin (test_id(13)) corrects it to $120/mo. One transaction,
    rolled back; the RPCs are granted only inside it. Synthetic data only; a test input, never part of a build."""
    return """\\set ON_ERROR_STOP 1
SET statement_timeout = 0;
BEGIN;
GRANT EXECUTE ON FUNCTION public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text) TO authenticated;
CREATE TEMP TABLE correction_bundle(stage text PRIMARY KEY, data jsonb NOT NULL);
GRANT ALL ON correction_bundle TO authenticated;
DO $bundle$
DECLARE v_today date; v_sale jsonb; v_policy uuid; v_win uuid;
  PROCEDURE_CAPTURE text := $q$INSERT INTO correction_bundle SELECT %L, jsonb_build_object(
    'snapshot', public.get_leaderboard_snapshot('month'), 'summary', public.get_performance_summary('month', 'own', NULL),
    'recentWins', public.get_leaderboard_recent_wins(NULL))$q$;
BEGIN
  PERFORM test_actor(41);
  SET LOCAL ROLE authenticated;
  v_today := (public.get_leaderboard_snapshot('month') ->> 'sold_date_through')::date;
  v_sale := create_client_with_sale(test_id(80201), test_id(1), test_client_payload() || jsonb_build_object('first_name', 'Surface',
    'assigned_agent_id', test_id(41), 'premium', 100, 'sold_date', v_today), true);
  RESET ROLE;
  SELECT c.primary_policy_id, w.id INTO v_policy, v_win FROM public.clients c JOIN public.wins w ON w.policy_id = c.primary_policy_id
   WHERE c.id = (v_sale ->> 'client_id')::uuid;
  -- Recent Wins lists sales entered before now(); this is one transaction, so the sale is backdated 1 microsecond.
  ALTER TABLE public.wins DISABLE TRIGGER wins_policy_identity_guard;
  UPDATE public.wins SET created_at = created_at - interval '1 microsecond' WHERE id = v_win;
  ALTER TABLE public.wins ENABLE TRIGGER wins_policy_identity_guard;
  PERFORM test_actor(41);
  SET LOCAL ROLE authenticated;
  EXECUTE format(PROCEDURE_CAPTURE, 'before');
  RESET ROLE;
  PERFORM test_actor(13);
  SET LOCAL ROLE authenticated;
  PERFORM public.correct_policy_sale_premium(test_id(90601), v_policy, 0, 100, '100'::jsonb, 120, 'entry_error',
    'Synthetic surface check', 'keep_current');
  RESET ROLE;
  PERFORM test_actor(41);
  SET LOCAL ROLE authenticated;
  EXECUTE format(PROCEDURE_CAPTURE, 'after');
  RESET ROLE;
  INSERT INTO correction_bundle VALUES ('fixture', jsonb_build_object('source', 'reporting_fixture.py policy (synthetic)',
    'actor', test_id(41), 'corrected_by', test_id(13), 'win_id', v_win, 'sold_date', v_today, 'monthly_before', 100, 'monthly_after', 120));
END $bundle$;
\\pset tuples_only on
\\pset format unaligned
\\o :payloads
SELECT jsonb_pretty(jsonb_build_object('correction', (SELECT jsonb_object_agg(stage, data) FROM correction_bundle)));
\\o
ROLLBACK;
"""

def integrated_data_part():
    """Integrated review data (B + C + D on the scale organization, last 30 days): written only to the disposable
    database built with REPORTS_V3_KEEP_PACKAGES=1, after the scale setup. Synthetic data only, through the same
    guarded paths the packages ship: correction ledger heads (as the table owner, through the insert guard), producing-
    call links to a call with the buyer before the sale (the link guard checks the sale and the call), and Sales Call /
    Follow Up appointments written through the live capture trigger, outcomes recorded by their assignees, and
    closing-appointment links made through the shipped link RPC as the organization's Admin. Committed: the payload part reads it at its own now()."""
    return r"""\set ON_ERROR_STOP 1
SET statement_timeout = 0;
BEGIN;
SELECT rt.eq('integrated review data needs the kept packages (3.3.0)', private.report_v3_basis_flags() ->> 'contract_version', '3.3.0');

-- B: about one in seven dated sales of the last 30 days was entered $10/mo low; the correction restates it on its
-- original seller and Sold Date (no sale is inserted or changed).
INSERT INTO private.policy_sale_premium_corrections (organization_id, win_id, policy_id, policy_source, buyer_id, seller_id,
  sold_date, revision, previous_effective_monthly, previous_source, corrected_monthly, reason_code, note, book_mode,
  book_action, actor_id, actor_role, request_id, payload_hash, result)
SELECT w.organization_id, w.id, w.policy_id, coalesce(i.source, 'primary'), w.contact_id, w.agent_id, w.sold_date, 1,
       e.monthly, e.source, round(e.monthly + 10, 2), 'entry_error', 'Synthetic integrated review correction', 'keep_current',
       'kept_current', rt.perf_agent(0), 'Admin', md5('int-corr:' || w.id)::uuid, repeat('0', 64), '{}'::jsonb
  FROM public.wins w JOIN rt.perf_meta m ON w.organization_id = m.org
  LEFT JOIN private.policy_identities i ON i.organization_id = w.organization_id AND i.policy_id = w.policy_id
  LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
 CROSS JOIN LATERAL private.policy_sale_effective_premium(w, c.premium) e
 WHERE w.policy_id IS NOT NULL AND w.contact_id IS NOT NULL AND w.sold_date BETWEEN m.end_date - 29 AND m.end_date
   AND e.monthly IS NOT NULL AND rt.perf_hash('int-corr' || w.id, 7) = 0;

-- C: two in three of those sales were made on a call with the buyer: a synthetic producing call by the seller 20
-- minutes before the sale (a copy of one of the seller's answered calls, re-addressed to the client), linked within the
-- 24-hour capture rule.
CREATE TEMP TABLE int_sales AS
SELECT w.id AS win_id, w.organization_id, w.policy_id, w.contact_id, w.agent_id,
       coalesce(w.recorded_at, w.created_at) - interval '20 minutes' AS call_at, md5('int-call:' || w.id)::uuid AS call_id,
       (SELECT k.id FROM public.calls k WHERE k.organization_id = w.organization_id AND k.agent_id = w.agent_id
           AND lower(k.direction) = 'outbound' AND k.duration >= 120 ORDER BY k.created_at DESC LIMIT 1) AS template_id
  FROM public.wins w JOIN rt.perf_meta m ON w.organization_id = m.org
 WHERE w.policy_id IS NOT NULL AND w.agent_id IS NOT NULL AND w.contact_id IS NOT NULL
   AND w.sold_date BETWEEN m.end_date - 29 AND m.end_date AND rt.perf_hash('int-link' || w.id, 3) <> 0;
INSERT INTO public.calls
SELECT (jsonb_populate_record(NULL::public.calls, to_jsonb(k) || jsonb_build_object('id', s.call_id, 'contact_id', s.contact_id,
          'contact_type', 'client', 'campaign_id', NULL, 'campaign_lead_id', NULL, 'created_at', s.call_at, 'started_at', s.call_at))).*
  FROM int_sales s JOIN public.calls k ON k.id = s.template_id;
INSERT INTO private.policy_sale_call_links (organization_id, win_id, policy_id, client_id, call_id, call_direction, link_source,
  sale_kind, operation_key, request_id, actor_id, evidence_hash)
SELECT s.organization_id, s.win_id, s.policy_id, s.contact_id, s.call_id, 'outbound', 'sale_entry', 'record', 'int:' || s.win_id,
       NULL, s.agent_id, repeat('0', 64)
  FROM int_sales s WHERE s.template_id IS NOT NULL;

-- D: the organization's appointment types (seeded names carry their category), continuous capture back 40 days, then
-- 120 appointments over the last 28 days for the agents' clients (one in six a Follow Up), written as the Admin
-- through the capture trigger, with outcomes recorded by their assignees after the start.
SELECT public.seed_default_appointment_types(org) FROM rt.perf_meta;
INSERT INTO private.appointment_evidence_capture_windows (capture_kind, started_at, ended_at, ended_reason)
SELECT w.capture_kind, now() - interval '40 days', w.started_at, 'synthetic_history'
  FROM private.appointment_evidence_capture_windows w WHERE w.ended_at IS NULL;
CREATE TEMP TABLE int_appts AS
SELECT a.n, md5('int-appt:' || a.n)::uuid AS id, c.id AS contact_id, rt.perf_agent(6 + rt.perf_hash('int-aa' || a.n, 50)) AS agent,
       CASE WHEN a.n % 6 = 0 THEN 'Follow Up' ELSE 'Sales Call' END AS type,
       rt.perf_ts(1 + rt.perf_hash('int-ad' || a.n, 27), 54000) AS start_at,
       CASE WHEN rt.perf_hash('int-ao' || a.n, 10) < 6 THEN 'held' WHEN rt.perf_hash('int-ao' || a.n, 10) < 8 THEN 'no_show' END AS outcome
  FROM generate_series(1, 120) a(n)
  JOIN LATERAL (SELECT c.id FROM public.clients c, rt.perf_meta m WHERE c.organization_id = m.org
                 ORDER BY md5('int-ac' || a.n || c.id) LIMIT 1) c ON true;
DO $appts$
DECLARE r record; v_admin uuid := rt.perf_agent(0); v_org uuid := (SELECT org FROM rt.perf_meta);
BEGIN
  FOR r IN SELECT * FROM int_appts ORDER BY n LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated',
      'app_metadata', json_build_object('organization_id', v_org, 'role', 'Admin'))::text, true);
    INSERT INTO public.appointments (id, organization_id, title, contact_id, type, status, start_time, created_by, user_id, created_at, booking_kind)
    VALUES (r.id, v_org, 'Integrated review ' || r.n, r.contact_id, r.type, 'Scheduled', r.start_at, r.agent, r.agent,
            r.start_at - interval '3 days', 'appointment');
    IF r.outcome IS NOT NULL THEN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', r.agent, 'role', 'authenticated',
        'app_metadata', json_build_object('organization_id', v_org, 'role', 'Agent'))::text, true);
      -- The outcome the RPC writes (status Completed / No Show), under the assignee's claims through the capture
      -- trigger, as the D4 suites record it (the harness grants authenticated no profiles read).
      UPDATE public.appointments SET status = CASE r.outcome WHEN 'held' THEN 'Completed' ELSE 'No Show' END WHERE id = r.id;
    END IF;
  END LOOP;
END $appts$;

-- D: closing-appointment links, as the Admin, for held Sales Calls whose client bought within 30 days after the start.
DO $links$
DECLARE r record; v_admin uuid := rt.perf_agent(0); v_org uuid := (SELECT org FROM rt.perf_meta);
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated',
    'app_metadata', json_build_object('organization_id', v_org, 'role', 'Admin'))::text, true);
  FOR r IN SELECT DISTINCT ON (w.id) w.id AS win_id, a.id AS appt_id
             FROM int_appts a JOIN public.wins w ON w.organization_id = v_org AND w.contact_id = a.contact_id AND w.policy_id IS NOT NULL
            WHERE a.type = 'Sales Call' AND a.outcome = 'held'
              AND w.sold_date BETWEEN (a.start_at AT TIME ZONE 'America/Los_Angeles')::date
                                  AND (a.start_at AT TIME ZONE 'America/Los_Angeles')::date + 30
            ORDER BY w.id, a.start_at DESC LOOP
    SET LOCAL ROLE authenticated;
    PERFORM public.link_policy_appointment(md5('int-link:' || r.win_id)::uuid, r.win_id, r.appt_id, NULL, 'appointment', 'sale_entry');
    RESET ROLE;
  END LOOP;
END $links$;
SELECT rt.eq('integrated review data written', (SELECT count(*) > 0 FROM private.policy_sale_premium_corrections)::text || '/'
  || (SELECT count(*) > 0 FROM private.policy_sale_call_links)::text || '/' || (SELECT count(*) = 120 FROM int_appts)::text, 'true/true/true');
COMMIT;
\echo integrated review data: corrections, links, appointments
SELECT (SELECT count(*) FROM private.policy_sale_premium_corrections) AS corrections,
       (SELECT count(*) FROM private.policy_sale_call_links) AS call_links,
       (SELECT count(*) FROM private.policy_appointment_attributions) AS appointment_links;
"""

if __name__ == '__main__':
    if '--part' in sys.argv and sys.argv[sys.argv.index('--part') + 1] == 'enable-pins':
        # Harness only: the release enable's pin rows and the read-back fingerprint at the database's current state.
        print(enable_pins_part())
        sys.exit(0)
    if '--render-enable' in sys.argv:
        # Harness only: --render-enable <A|B|C|D> <rows file from --part enable-pins> writes the release enable text.
        i = sys.argv.index('--render-enable')
        rows = [l for l in Path(sys.argv[i + 2]).read_text().splitlines() if l.startswith('    (')]
        sys.stdout.write(render_enable(sys.argv[i + 1], ',\n'.join(rows)))
        sys.exit(0)
    if '--part' in sys.argv and sys.argv[sys.argv.index('--part') + 1] == 'integrated-data':
        print('\\echo integrated review data (B + C + D, scale organization)\n' + integrated_data_part())
        sys.exit(0)
    if '--part' in sys.argv and sys.argv[sys.argv.index('--part') + 1] == 'correction-payloads':
        print('\\echo PKG-B correction payload bundles\n' + correction_payloads_part())
        sys.exit(0)
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
    if '--until' in sys.argv:
        # Every step up to and including the first whose label contains the text (a live intermediate state for the
        # PKG-D multi-session script; disposable databases only).
        until = sys.argv[sys.argv.index('--until') + 1]
        cut = next(i for i, (label, _) in enumerate(data) if until in label)
        data = data[:cut + 1]
    if '--json' in sys.argv:
        print(json.dumps([[label, sql[1] if isinstance(sql, tuple) else sql, not isinstance(sql, tuple)] for label, sql in data]))
    else:
        for label, sql in data:
            if isinstance(sql, tuple):
                print('\\echo ' + label + '\n' + sql[1] + '\n')
            else:
                print('\\echo ' + label + '\nBEGIN;\n' + sql + '\nCOMMIT;\n')
