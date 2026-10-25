#!/usr/bin/env bash
# =====================================================================================================
# Google Sheets — REAL pg_cron / pg_net check in the pinned supabase/postgres image (production: 17.6.1.063).
# LOCAL / CI ONLY. The container runs with --network none (verified before anything is scheduled), every
# credential is synthetic, and nothing here can reach a hosted project.
#   1. isolation proof (network mode none, only the loopback interface, DNS for the production host fails)
#   2. harness + foundation migration (real Vault) + synthetic fixtures (one due source, synthetic token)
#   3. the EXACT pending schedule migration: job exists ('* * * * *'), a replay is refused
#   4. the job runs and its worker request fails at the network layer (no HTTP response) → no reachability
#   5. supabase/ops/google_sheets_unschedule.sql: job gone; no new cron run for 70 s; queue drained
#   6. supabase/ops/google_sheets_drain_check.sql against real pg_cron / pg_net
#   7. push sync: the old 5-minute schedule file is byte-identical (pinned SHA-256); the push migration applies on top;
#      the EXACT pending push maintenance schedule: job exists, calls only the maintenance function through the cron
#      guard (never the sync worker, never next_sync_at), replay refused
#   8. nothing due (mode off) → the job runs but sends NO request for 70 s (no polling)
#   9. work due (mode on: an enabled tab without a channel) → one maintenance request, failing at the network layer
#  10. supabase/ops/google_sheets_push_unschedule.sql: job gone; idempotent
# Usage: ./scripts/run_google_sheets_cron_check.sh   (GS_CRON_IMAGE overrides the image)
# =====================================================================================================
set -euo pipefail
IMAGE="${GS_CRON_IMAGE:-supabase/postgres:17.6.1.063}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="gs_cron_$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
fail() { echo "   FAIL: $*"; exit 1; }
SQL() { docker exec -i -e PGPASSWORD=postgres "$NAME" psql -U supabase_admin -h localhost -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }

echo "== 1. start $IMAGE with --network none and prove isolation =="
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 120); do docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 1; done
docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null || fail "database did not start"
sleep 3
[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$NAME")" = "none" ] || fail "container is not network-isolated"
IFACES="$(docker exec "$NAME" sh -c "tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d ' '" | tr '\n' ' ')"
[ "$IFACES" = "lo " ] || fail "unexpected interfaces: $IFACES"
if docker exec "$NAME" getent hosts jncvvsvckxhqgqvkppmj.supabase.co >/dev/null 2>&1; then fail "production host resolved"; fi
echo "   OK (network mode none; interfaces: $IFACES; production host does not resolve)"

echo; echo "== 2. harness + foundation migration + synthetic fixtures =="
SQL < "$ROOT/supabase/tests/google_sheets_harness.sql" >/dev/null 2>&1 || fail "harness"
SQL -1 < "$ROOT/supabase/migrations/20261022062539_google_sheets_import_foundation.sql" >/dev/null 2>&1 || fail "foundation migration"
SQL < "$ROOT/supabase/tests/google_sheets_cron_check.sql" >/dev/null || fail "fixtures"
echo "   OK ($(SQL -c "select count(*) from pg_proc where proname like 'google\_sheets\_%'") Sheets functions; pg_cron $(SQL -c "select extversion from pg_extension where extname='pg_cron'"), pg_net $(SQL -c "select extversion from pg_extension where extname='pg_net'"), supabase_vault $(SQL -c "select extversion from pg_extension where extname='supabase_vault'"))"

echo; echo "== 3. exact pending schedule migration =="
PENDING="$ROOT/supabase/migrations/pending/20261013120100_google_sheets_sync_schedule.sql"
SQL < "$PENDING" >/dev/null || fail "pending schedule migration"
JOB="$(SQL -c "select schedule || '|' || (command like '%/functions/v1/google-sheets-sync-worker%')::text || '|' || (command like '%google_sheets_worker_token%')::text from cron.job where jobname = 'google-sheets-sync-every-minute'")"
[ "$JOB" = "* * * * *|true|true" ] || fail "unexpected job: $JOB"
if SQL < "$PENDING" >/dev/null 2>&1; then fail "replay was not refused"; fi
echo "   OK (job '* * * * *' posts to the worker with the Vault token; replay refused)"

echo; echo "== 4. the job runs; its request fails at the network layer =="
for _ in $(seq 1 90); do
  RUNS="$(SQL -c "select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'google-sheets-sync-every-minute' and d.status in ('succeeded','failed')")"
  [ "$RUNS" -ge 1 ] && break; sleep 1
done
[ "$RUNS" -ge 1 ] || fail "the job never ran"
for _ in $(seq 1 60); do
  RESP="$(SQL -c "select count(*) from net._http_response")"
  [ "$RESP" -ge 1 ] && break; sleep 1
done
[ "$RESP" -ge 1 ] || fail "no pg_net outcome recorded"
OUTCOME="$(SQL -c "select coalesce(status_code::text, 'none') || '|' || coalesce(error_msg, '') from net._http_response order by id desc limit 1")"
case "$OUTCOME" in none\|?*) ;; *) fail "a request got an HTTP response: $OUTCOME" ;; esac
echo "   OK ($RUNS cron run(s); pg_net outcome: status none, error '${OUTCOME#none|}')"

echo; echo "== 5. unschedule (exact ops file): no future runs =="
SQL < "$ROOT/supabase/ops/google_sheets_unschedule.sql" >/dev/null || fail "unschedule"
[ "$(SQL -c "select count(*) from cron.job where jobname = 'google-sheets-sync-every-minute'")" = 0 ] || fail "job still scheduled"
SQL < "$ROOT/supabase/ops/google_sheets_unschedule.sql" >/dev/null || fail "unschedule is not idempotent"
T_U="$(SQL -c "select now()")"
sleep 70
NEW="$(SQL -c "select count(*) from cron.job_run_details where start_time > '$T_U'")"
[ "$NEW" = 0 ] || fail "$NEW cron run(s) after unscheduling"
QUEUED="$(SQL -c "select count(*) from net.http_request_queue")"
[ "$QUEUED" = 0 ] || fail "$QUEUED request(s) still queued"
echo "   OK (job gone, idempotent; 0 runs in 70 s after unscheduling; request queue empty)"

echo; echo "== 6. drain check against real pg_cron / pg_net =="
DRAIN="$(SQL -F '|' < "$ROOT/supabase/ops/google_sheets_drain_check.sql")"
[ "$(echo "$DRAIN" | cut -d'|' -f4)" = 0 ] && [ "$(echo "$DRAIN" | cut -d'|' -f5)" = 0 ] || fail "drain check: $DRAIN"
echo "   OK (queued_worker_requests=0, cron_jobs=0)"

echo; echo "== 7. push sync: pinned old schedule, push migration, exact pending maintenance schedule =="
OLD_SHA="$(sha256sum "$ROOT/supabase/migrations/pending/20261013120100_google_sheets_sync_schedule.sql" | cut -d' ' -f1)"
[ "$OLD_SHA" = 6116f414faf8313b3d09fa2b721eee79ac43d57f16e9de29ef143b92c54f9665 ] || fail "the old 5-minute schedule file changed: $OLD_SHA"
SQL -1 < "$ROOT/supabase/migrations/20261025120000_google_sheets_push_sync.sql" >/dev/null || fail "push migration"
SQL < "$ROOT/supabase/tests/google_sheets_push_cron_check.sql" >/dev/null || fail "push fixtures"
PUSH_PENDING="$ROOT/supabase/migrations/pending/20261025120100_google_sheets_push_maintenance_schedule.sql"
SQL < "$PUSH_PENDING" >/dev/null || fail "pending push maintenance schedule"
PJOB="$(SQL -c "select schedule || '|' || (command like '%/functions/v1/google-sheets-push-maintenance%')::text || '|' || (command like '%google_sheets_push_maintenance_token%')::text || '|' || (command like '%private.google_sheets_push_maintenance_due()%')::text || '|' || (command like '%google-sheets-sync-worker%')::text || '|' || (command like '%next_sync_at%')::text from cron.job where jobname = 'google-sheets-push-maintenance-every-minute'")"
[ "$PJOB" = "* * * * *|true|true|true|false|false" ] || fail "unexpected push job: $PJOB"
if SQL < "$PUSH_PENDING" >/dev/null 2>&1; then fail "push schedule replay was not refused"; fi
echo "   OK (old schedule pinned $OLD_SHA; push job '* * * * *' → maintenance only, behind the guard; replay refused)"

echo; echo "== 8. nothing due → the job runs, no request is sent =="
SQL -c "select cron.unschedule('google-sheets-sync-every-minute') from cron.job where jobname = 'google-sheets-sync-every-minute'" >/dev/null
[ "$(SQL -c "select private.google_sheets_push_maintenance_due()")" = f ] || fail "guard true with push mode off and no channels"
T_P="$(SQL -c "select now()")"; R0="$(SQL -c "select count(*) from net._http_response")"; Q0="$(SQL -c "select count(*) from net.http_request_queue")"
sleep 70
PRUNS="$(SQL -c "select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'google-sheets-push-maintenance-every-minute' and d.start_time > '$T_P'")"
[ "$PRUNS" -ge 1 ] || fail "the push job never ran"
[ "$(SQL -c "select count(*) from net._http_response")" = "$R0" ] && [ "$(SQL -c "select count(*) from net.http_request_queue")" = "$Q0" ] || fail "a request was sent although nothing was due"
echo "   OK ($PRUNS run(s) in 70 s, 0 requests)"

echo; echo "== 9. work due → one maintenance request (fails at the network layer) =="
SQL -c "update private.google_sheets_push_config set mode = 'on'" >/dev/null
[ "$(SQL -c "select private.google_sheets_push_maintenance_due()")" = t ] || fail "guard false although an enabled tab has no channel"
for _ in $(seq 1 90); do
  NEWR="$(SQL -c "select count(*) from net._http_response")"
  [ "$NEWR" -gt "$R0" ] && break; sleep 1
done
[ "$NEWR" -gt "$R0" ] || fail "no maintenance request was attempted"
POUT="$(SQL -c "select coalesce(status_code::text, 'none') from net._http_response order by id desc limit 1")"
[ "$POUT" = none ] || fail "a maintenance request got an HTTP response: $POUT"
echo "   OK (request attempted only once work was due; no HTTP response under --network none)"

echo; echo "== 10. unschedule push maintenance (exact ops file) =="
SQL < "$ROOT/supabase/ops/google_sheets_push_unschedule.sql" >/dev/null || fail "push unschedule"
[ "$(SQL -c "select count(*) from cron.job where jobname = 'google-sheets-push-maintenance-every-minute'")" = 0 ] || fail "push job still scheduled"
SQL < "$ROOT/supabase/ops/google_sheets_push_unschedule.sql" >/dev/null || fail "push unschedule is not idempotent"
DRAINP="$(SQL -F '|' < "$ROOT/supabase/ops/google_sheets_drain_check.sql")"
[ "$(echo "$DRAINP" | cut -d'|' -f17)" = 0 ] || fail "drain check push_cron_jobs: $DRAINP"
echo "   OK (push job gone, idempotent; drain check push_cron_jobs=0)"

echo; echo "ALL GOOGLE SHEETS CRON CHECKS PASSED"
