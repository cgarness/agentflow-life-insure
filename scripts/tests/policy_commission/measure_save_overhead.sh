#!/usr/bin/env bash
# Phase 2A: server-side save overhead of the commission companions vs the unchanged sale writers, on a DISPOSABLE
# database prepared by scripts/run_policy_commission_tests.sh (fixture, harness, migration). Synthetic data only.
#   DB_URL=postgres://postgres@127.0.0.1:<port>/pc_test_<...> bash scripts/tests/policy_commission/measure_save_overhead.sh
# Each sample is one call on its own fresh request (and lead) inside one session, timed with clock_timestamp().
# Prints p50/p95 per case plus the per-function profile of the commission step (pg_stat_user_functions).
set -euo pipefail
: "${DB_URL:?Disposable database URL required}"
python3 - "$DB_URL" <<'PY'
import sys, urllib.parse
u = urllib.parse.urlparse(sys.argv[1])
if u.hostname not in ('localhost', '127.0.0.1') or not u.path.startswith('/pc_test_'):
    raise SystemExit('REFUSING: disposable policy commission test database required')
PY
N=${PC_SAMPLES:-30}
DB=$(python3 -c "import sys,urllib.parse;print(urllib.parse.urlparse(sys.argv[1]).path[1:])" "$DB_URL")
psql "$DB_URL" -qX -v ON_ERROR_STOP=1 -c "ALTER DATABASE $DB SET track_functions = 'pl'" >/dev/null
psql "$DB_URL" -qX -v ON_ERROR_STOP=1 -v n="$N" <<'SQL'
\pset footer off
SELECT pg_stat_reset();
CREATE TABLE pc_timing(label text, ms numeric);
GRANT ALL ON pc_timing TO authenticated;
INSERT INTO leads(organization_id, user_id, assigned_agent_id, first_name, last_name)
SELECT test_id(1), test_id(11), test_id(11), 'Timing' || g, 'Synthetic' FROM generate_series(1, 2000) g;
GRANT SELECT ON leads TO authenticated;
CREATE FUNCTION pc_next_lead() RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE leads SET last_name = 'Used' WHERE id = (SELECT id FROM leads WHERE last_name = 'Synthetic' AND first_name LIKE 'Timing%'
    ORDER BY first_name LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id $$;
GRANT EXECUTE ON FUNCTION pc_next_lead() TO authenticated;
-- Conversion payload with n policies (n - 1 additional rows) and, optionally, a commission slot for each.
CREATE FUNCTION pc_convert_args(p_n integer, OUT client jsonb, OUT commission jsonb) LANGUAGE plpgsql VOLATILE AS $$
DECLARE ids uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, p_n - 1));
BEGIN
  client := pc_client('Timing', 11, '50.00') || jsonb_build_object('custom_fields', jsonb_build_object('additional_policies',
    coalesce((SELECT jsonb_agg(jsonb_build_object('policyId', x, 'policyType', 'Final Expense', 'carrier', 'Synthetic Life',
      'premiumAmount', '30.00', 'soldDate', '2026-10-01')) FROM unnest(ids) x), '[]'::jsonb)));
  commission := jsonb_build_object('v', 'policy-commission-v1', 'slots',
    jsonb_build_array(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))
    || coalesce((SELECT jsonb_agg(pc_slot(x::text, 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400)) FROM unnest(ids) x), '[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION pc_convert_args(integer) TO authenticated;
SELECT set_config('pc.n', :'n', false);
SELECT pc_login(11);
SET ROLE authenticated;
DO $$
DECLARE n integer := current_setting('pc.n')::integer; i integer; t timestamptz; a record; k integer; r jsonb;
BEGIN
  FOR i IN 1..n + 3 LOOP   -- three warm-up rounds per case are discarded
    t := clock_timestamp();
    PERFORM create_client_with_sale(gen_random_uuid(), test_id(1), pc_client('Legacy' || i, 11, '50.00'), true);
    IF i > 3 THEN INSERT INTO pc_timing VALUES ('create 1 · writer', extract(epoch FROM clock_timestamp() - t) * 1000); END IF;
    t := clock_timestamp();
    PERFORM create_client_with_sale_handoff(gen_random_uuid(), test_id(1), pc_client('Empty' || i, 11, '50.00'), true, pc_payload());
    IF i > 3 THEN INSERT INTO pc_timing VALUES ('create 1 · companion, empty payload', extract(epoch FROM clock_timestamp() - t) * 1000); END IF;
    t := clock_timestamp();
    r := create_client_with_sale_handoff(gen_random_uuid(), test_id(1), pc_client('Comp' || i, 11, '50.00'), true,
      pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)));
    IF i > 3 THEN INSERT INTO pc_timing VALUES ('create 1 · companion, estimate', extract(epoch FROM clock_timestamp() - t) * 1000); END IF;
    IF r->'commission'->'slots'->0->>'status' <> 'recorded' THEN RAISE EXCEPTION 'not recorded: %', r; END IF;
    t := clock_timestamp();
    r := create_client_with_sale_handoff(gen_random_uuid(), test_id(1), pc_client('Fail' || i, 11, '50.00'), true,
      pc_payload(pc_slot(gen_random_uuid()::text, 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)));
    IF i > 3 THEN INSERT INTO pc_timing VALUES ('create 1 · companion, failed commission step', extract(epoch FROM clock_timestamp() - t) * 1000); END IF;
    IF r->'commission'->>'status' <> 'not_recorded' THEN RAISE EXCEPTION 'expected failure: %', r; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY[1, 5, 25, 100] LOOP
    FOR i IN 1..CASE WHEN k = 100 THEN greatest(n / 3, 5) ELSE n END + 3 LOOP
      SELECT * INTO a FROM pc_convert_args(k);
      t := clock_timestamp();
      PERFORM convert_lead_to_client_with_sales(pc_next_lead(), test_id(1), a.client, NULL);
      IF i > 3 THEN INSERT INTO pc_timing VALUES (format('convert %s · writer', lpad(k::text, 3)), extract(epoch FROM clock_timestamp() - t) * 1000); END IF;
      SELECT * INTO a FROM pc_convert_args(k);
      t := clock_timestamp();
      r := convert_lead_to_client_with_sales_handoff(gen_random_uuid(), pc_next_lead(), test_id(1), a.client, NULL, a.commission);
      IF i > 3 THEN
        INSERT INTO pc_timing VALUES (format('convert %s · companion, estimates', lpad(k::text, 3)), extract(epoch FROM clock_timestamp() - t) * 1000);
        INSERT INTO pc_timing VALUES (format('convert %s · slots recorded (count)', lpad(k::text, 3)),
          (SELECT count(*) FROM jsonb_array_elements(r->'commission'->'slots') s WHERE s->>'status' = 'recorded'));
      END IF;
    END LOOP;
  END LOOP;
END $$;
RESET ROLE;
SELECT label AS "case", count(*) AS samples,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ms))::numeric, 2) AS p50_ms,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY ms))::numeric, 2) AS p95_ms,
       round(max(ms), 2) AS max_ms
  FROM pc_timing GROUP BY label ORDER BY label;
SELECT funcname AS "function (self time, all samples)", calls, round(self_time::numeric, 1) AS self_ms, round(total_time::numeric, 1) AS total_ms
  FROM pg_stat_user_functions
 WHERE funcname LIKE '%commission%' OR funcname LIKE '%handoff%' OR funcname IN ('access', 'actor_org', 'actor_uid', 'campaign_actor')
 ORDER BY self_time DESC LIMIT 15;
SQL
