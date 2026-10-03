#!/usr/bin/env bash
# Synthetic PostgreSQL only. Never source an application .env or use a linked Supabase project.
set -euo pipefail
: "${PGURL:?Set PGURL to a disposable localhost cluster URL without a database path}"
TASK_HOST=$(python3 - "$PGURL" <<'PY'
import sys,urllib.parse
u=urllib.parse.urlparse(sys.argv[1])
if u.scheme not in ('postgres','postgresql') or u.hostname not in ('localhost','127.0.0.1') or u.path not in ('','/') or u.query or u.fragment:
 raise SystemExit('REFUSING: disposable localhost cluster URL required, no database/query/fragment')
print(u.hostname)
PY
)
TASK_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TASK_DB="dnc_test_$$"
TASK_URL="${PGURL%/}/$TASK_DB"
TASK_EVIDENCE=$(mktemp -d)
echo "Evidence: $TASK_EVIDENCE"
echo "Locality: host=$TASK_HOST database=$TASK_DB; synthetic data only"
psql "${PGURL%/}/postgres" -v ON_ERROR_STOP=1 -tAc "SELECT 'server='||inet_server_addr()||' version='||current_setting('server_version');"
if [ "$(psql "${PGURL%/}/postgres" -tAc "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator','supabase_auth_admin')")" != 0 ]; then
  echo 'REFUSING: hosted Supabase platform roles present'; exit 2
fi
cleanup() { psql "${PGURL%/}/postgres" -q -c "DROP DATABASE IF EXISTS $TASK_DB" >/dev/null; }
trap cleanup EXIT
psql "${PGURL%/}/postgres" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $TASK_DB"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -f "$TASK_ROOT/supabase/tests/dialer_dnc_harness.sql" >"$TASK_EVIDENCE/harness.txt" 2>&1
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -f "$TASK_ROOT/supabase/tests/dialer_dnc_upgrade.sql" >"$TASK_EVIDENCE/upgrade.txt" 2>&1
echo "PASS forward upgrade preserves legacy canonical duplicates"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -1 -f "$TASK_ROOT/supabase/migrations/20261003022218_dialer_disposition_dnc_integrity.sql" >"$TASK_EVIDENCE/migration.txt" 2>&1
psql "$TASK_URL" -v ON_ERROR_STOP=1 -tA -f "$TASK_ROOT/supabase/tests/dialer_dnc_metadata.sql" >"$TASK_EVIDENCE/expected-functions.json"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -f "$TASK_ROOT/supabase/tests/dialer_dnc_fixtures.sql" >"$TASK_EVIDENCE/fixtures.txt" 2>&1
for suite in dialer_disposition_dnc dialer_dnc_security dialer_dnc_matrix; do
  if ! psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -f "$TASK_ROOT/supabase/tests/$suite.sql" >"$TASK_EVIDENCE/$suite.txt" 2>&1; then
    tail -25 "$TASK_EVIDENCE/$suite.txt"; exit 1
  fi
  echo "PASS $suite"
done
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -f "$TASK_ROOT/supabase/tests/dialer_dnc_concurrency.sql"
DNC_TEST_URL="$TASK_URL" node --input-type=module <<'JS'
import postgres from 'postgres';
import assert from 'node:assert/strict';
const url = process.env.DNC_TEST_URL;
if (!['127.0.0.1','localhost'].includes(new URL(url).hostname)) throw new Error('localhost only');
const db = postgres(url, { max: 8 });
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const deferred = () => { let resolve; const promise = new Promise(r => resolve=r); return { promise, resolve }; };
const actor = async (sql,n=11) => {
  await sql`select public.test_actor(${n})`;
  await sql.unsafe('SET LOCAL ROLE authenticated');
};
const ready=deferred(), commit=deferred();
try {
  const first = db.begin(async sql => {
    await actor(sql);
    const [r]=await sql`select public.advance_campaign_lead(${id(301)},${id(401)},${id(501)},p_operation_id=>${id(801)},p_expected_version=>0) as result`;
    ready.resolve();
    await commit.promise;
    return r.result;
  });
  await ready.promise;
  const second = db.begin(async sql => {
    await actor(sql);
    await sql`select set_config('application_name','dnc_racing_writer',true)`;
    const [r]=await sql`select public.advance_campaign_lead(${id(302)},null,${id(501)},p_operation_id=>${id(802)},p_expected_version=>0) as result`;
    return r.result;
  });
  // Wait until the second real backend is blocked on the phone lock.
  const deadline=Date.now()+3000;
  for (;;) {
    const [r]=await db`select count(*)::int as n from pg_stat_activity where application_name='dnc_racing_writer' and wait_event='advisory'`;
    if (r.n===1) break;
    if (Date.now()>deadline) throw new Error('second DNC writer never reached advisory lock');
    await new Promise(r=>setTimeout(r,10));
  }
  const started=Date.now();
  const queue = await db.begin(async sql => {
    await actor(sql);
    await sql.unsafe("SET LOCAL statement_timeout='1500ms'");
    return sql`select id from public.get_next_queue_lead(${id(103)})`;
  });
  assert.equal(queue[0]?.id,id(306),'queue skips contended phone and returns unrelated lead');
  assert.ok(Date.now()-started<1500,'independent queue throughput');
  const admission = db.begin(async sql => {
    await sql.unsafe('SET LOCAL ROLE service_role');
    await sql`select set_config('application_name','dnc_racing_admission',true)`;
    const [r]=await sql`select public.admit_twilio_outbound(${id(402)},'synthetic_agent_12','+15551234567','+15559990000','CA00000000000000000000000000000001') as result`;
    return r.result;
  });
  const admissionDeadline=Date.now()+3000;
  for (;;) {
    const [r]=await db`select count(*)::int as n from pg_stat_activity where application_name='dnc_racing_admission' and wait_event='advisory'`;
    if (r.n===1) break;
    if (Date.now()>admissionDeadline) throw new Error('admission never reached shared phone lock');
    await new Promise(r=>setTimeout(r,10));
  }
  commit.resolve();
  const [a,b,c]=await Promise.all([first,second,admission]);
  assert.equal(a.status,'DNC'); assert.equal(b.status,'DNC'); assert.equal(c.admitted,false);
  const [supp]=await db`select count(*)::int as n from public.dnc_list`;
  assert.equal(supp.n,1,'simultaneous DNC writes create one canonical suppression');
  const replays=await Promise.all([1,2].map(()=>db.begin(async sql=>{
    await actor(sql);
    const [r]=await sql`select public.advance_campaign_lead(${id(301)},${id(401)},${id(501)},p_operation_id=>${id(801)},p_expected_version=>0) as result`;
    return r.result;
  })));
  assert.ok(replays.every(r=>r.replayed));
  const [attempts]=await db`select call_attempts from public.campaign_leads where id=${id(301)}`;
  assert.equal(attempts.call_attempts,1,'simultaneous replay never double advances');
  // Row locks are independently skipped, including when there is no phone contention.
  const rowReady=deferred(), rowCommit=deferred();
  const holder=db.begin(async sql=>{ await sql`select id from public.campaign_leads where id=${id(306)} for update`;rowReady.resolve();await rowCommit.promise; });
  await rowReady.promise;
  const skipped=await db.begin(async sql=>{await actor(sql,12);await sql.unsafe("SET LOCAL statement_timeout='1500ms'");return sql`select id from public.get_next_queue_lead(${id(103)})`;});
  assert.equal(skipped.length,0,'SKIP LOCKED excludes row locked by independent connection');
  rowCommit.resolve(); await holder;
  console.log('PASS real PostgreSQL concurrency: simultaneous DNC, claim race, stale admission, duplicate saves, SKIP LOCKED');
} finally { commit.resolve(); await db.end({ timeout: 2 }); }
JS

# A repeated production migration must stop on the changed fingerprint.
if psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -1 -f "$TASK_ROOT/supabase/migrations/20261003022218_dialer_disposition_dnc_integrity.sql" >"$TASK_EVIDENCE/replay.txt" 2>&1; then
  echo 'FAIL: replay was not refused'; exit 1
fi
if ! grep -q 'precondition' "$TASK_EVIDENCE/replay.txt"; then cat "$TASK_EVIDENCE/replay.txt"; exit 1; fi
echo "PASS replay refused"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -1 -f "$TASK_ROOT/supabase/rollback/dialer_dnc_integrity_local_restore.sql" >"$TASK_EVIDENCE/restore.txt" 2>&1
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -1 -f "$TASK_ROOT/supabase/migrations/20261003022218_dialer_disposition_dnc_integrity.sql" >"$TASK_EVIDENCE/reapply.txt" 2>&1
psql "$TASK_URL" -v ON_ERROR_STOP=1 -tA -f "$TASK_ROOT/supabase/tests/dialer_dnc_metadata.sql" >"$TASK_EVIDENCE/reapplied-functions.json"
cmp "$TASK_EVIDENCE/expected-functions.json" "$TASK_EVIDENCE/reapplied-functions.json"
echo "PASS reapplied function definitions, owners, search paths and ACLs match"
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -f "$TASK_ROOT/supabase/ops/dialer_dnc_fail_closed.sql" >"$TASK_EVIDENCE/pause.txt" 2>&1
psql "$TASK_URL" -v ON_ERROR_STOP=1 -q -c "SELECT public.test_assert(NOT has_function_privilege('authenticated','public.check_dialer_dnc(text,uuid)','EXECUTE'),'pause seals browser preflight'); SELECT public.test_assert(NOT has_function_privilege('service_role','public.admit_twilio_outbound(uuid,text,text,text,text)','EXECUTE'),'pause seals webhook admission'); SELECT public.test_assert((SELECT count(*)=1 FROM public.dnc_list),'pause preserves DNC');" >>"$TASK_EVIDENCE/pause.txt" 2>&1
echo "PASS local restore/reapply and fail-closed pause"
echo "Evidence: $TASK_EVIDENCE"
