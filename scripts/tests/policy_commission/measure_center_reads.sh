#!/usr/bin/env bash
# Commissions center: server-side timing of the five reads for one seller with a large synthetic book, on a DISPOSABLE
# database prepared by scripts/run_policy_commission_tests.sh (fixture, harness, both applied migrations, the center
# harness and 20261020212000, plus 20261021180000 when present: its four reads are then timed too). Synthetic data only.
#   DB_URL=postgres://postgres@127.0.0.1:<port>/pc_test_<...> PC_CENTER_POLICIES=2000 bash scripts/tests/policy_commission/measure_center_reads.sh
# The book: PC_CENTER_POLICIES sales with estimates (Edit dates spread their first premium dates over about two years
# around today) and a receipt on every third Advance, plus 50 sales without an estimate. Each read is timed with
# clock_timestamp() as the seller (RLS applies), after one untimed warm-up. Measured maxima are observations, not
# guarantees.
set -euo pipefail
: "${DB_URL:?Disposable database URL required}"
python3 - "$DB_URL" <<'PY'
import sys, urllib.parse
u = urllib.parse.urlparse(sys.argv[1])
if u.hostname not in ('localhost', '127.0.0.1') or not u.path.startswith('/pc_test_'):
    raise SystemExit('REFUSING: disposable policy commission test database required')
PY
N=${PC_CENTER_POLICIES:-500}
S=${PC_SAMPLES:-20}
psql "$DB_URL" -qX -v ON_ERROR_STOP=1 -v n="$N" -v s="$S" <<'SQL'
\pset footer off
CREATE TABLE cc_timing(label text, ms numeric);
GRANT ALL ON cc_timing TO authenticated;
SELECT set_config('cc.n', :'n', false), set_config('cc.s', :'s', false);
SELECT pc_login(11);
SET ROLE authenticated;
DO $$
DECLARE i integer; v_today date := (now() AT TIME ZONE 'America/Los_Angeles')::date; r jsonb; e uuid; rev bigint;
BEGIN
  FOR i IN 1 .. current_setting('cc.n')::integer LOOP
    r := create_client_with_sale_handoff(gen_random_uuid(), test_id(1), pc_client('Book' || i, 11, '50.00'), true,
      pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)));
    SELECT id, state_revision INTO e, rev FROM policy_commission_estimates
     WHERE policy_id = (r->'commission'->'slots'->0->>'policy_id')::uuid AND status = 'active';
    PERFORM set_policy_commission_schedule_basis(gen_random_uuid(), e, rev, v_today - 400 + (i * 7) % 760, 'manual');
    IF i % 3 = 0 THEN
      PERFORM record_policy_commission_receipt(gen_random_uuid(),
        (SELECT id FROM policy_commission_installments WHERE estimate_id = e AND kind = 'advance'), 30000, v_today - (i % 300), NULL);
    END IF;
  END LOOP;
  FOR i IN 1 .. 50 LOOP
    PERFORM create_client_with_sale_handoff(gen_random_uuid(), test_id(1), pc_client('Unestimated' || i, 11, '50.00'), true, pc_payload());
  END LOOP;
END $$;
RESET ROLE;
ANALYZE;
SET ROLE authenticated;
CREATE TEMP TABLE cc_reads(label text, q text);
INSERT INTO cc_reads VALUES
  ('overview (this month)', 'SELECT get_my_commission_overview()'),
  ('overview (two years)', format('SELECT get_my_commission_overview(%L, %L, %L)', 'custom', current_date - 365, current_date + 365)),
  ('scheduled page (period)', 'SELECT get_my_commission_installments(''this_year'', NULL, NULL, ''range'', ''all'', NULL, NULL, 25, 0)'),
  ('scheduled page (any, last page)', 'SELECT get_my_commission_installments(''all'', NULL, NULL, ''any'', ''all'', NULL, NULL, 25, 10000)'),
  ('history page', 'SELECT get_my_commission_receipts(''all'', NULL, NULL, true, 25, 0)'),
  ('policies page', 'SELECT get_my_commission_policies(''all'', NULL, 25, 0)'),
  ('policies (missing)', 'SELECT get_my_commission_policies(''missing'', NULL, 25, 0)'),
  ('drawer', format('SELECT get_my_policy_commission(%L)', (SELECT policy_id FROM policy_commission_estimates LIMIT 1)));
-- With 20261021180000 applied (the runner's default), the insights reads too.
INSERT INTO cc_reads SELECT * FROM (VALUES
  ('breakdown (this month)', 'SELECT get_my_commission_breakdown()'),
  ('breakdown (two years)', format('SELECT get_my_commission_breakdown(%L, %L, %L)', 'custom', current_date - 365, current_date + 365)),
  ('policy list (sold this year, one carrier)', 'SELECT get_my_commission_policy_list(''all'', ''Synthetic Life'', false, NULL, ''this_year'', NULL, NULL, 25, 0)'),
  ('receipt list (one carrier)', 'SELECT get_my_commission_receipt_list(''all'', NULL, NULL, true, ''Synthetic Life'', false, 25, 0)'),
  ('goal', 'SELECT get_my_commission_goal(date_trunc(''month'', current_date)::date)')) v
 WHERE to_regprocedure('public.get_my_commission_breakdown(text,date,date)') IS NOT NULL;
DO $$
DECLARE r record; k integer; t timestamptz; x jsonb;
BEGIN
  FOR r IN SELECT * FROM cc_reads LOOP
    EXECUTE r.q INTO x;
    FOR k IN 1 .. current_setting('cc.s')::integer LOOP
      t := clock_timestamp();
      EXECUTE r.q INTO x;
      INSERT INTO cc_timing VALUES (r.label, extract(epoch FROM clock_timestamp() - t) * 1000);
    END LOOP;
  END LOOP;
END $$;
SELECT current_setting('cc.n') AS policies, (SELECT count(*) FROM policy_commission_installments) AS installments,
       (SELECT count(*) FROM policy_commission_receipts) AS receipts;
SELECT label, count(*) AS samples, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms)::numeric, 1) AS p50_ms,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms)::numeric, 1) AS p95_ms, round(max(ms), 1) AS max_ms
  FROM cc_timing GROUP BY label ORDER BY min(ctid);
SQL
