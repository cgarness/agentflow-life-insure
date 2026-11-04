// Imported only after run.mjs proves a fresh localhost database and loads synthetic fixtures.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const admin = '10000000-0000-4000-8000-000000000011';
const otherAdmin = '20000000-0000-4000-8000-000000000011';
const org = '10000000-0000-4000-8000-000000000001';
const otherOrg = '20000000-0000-4000-8000-000000000001';
const master = 'AC11111111111111111111111111111111';
const terms = { monthly_price: '2.15', currency: 'USD', inbound_per_minute: '0.022' };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

async function service(tx) {
  await tx`SET LOCAL ROLE service_role`;
  await tx`SET LOCAL request.jwt.claims='{}'`;
  await tx`SET LOCAL statement_timeout='10s'`;
}
async function claim(tx, quote, request, actor = admin, agency = org) {
  return (await tx`SELECT public.phone_number_purchase_claim(${actor},${agency},${quote.id},${request}) AS op`)[0].op;
}
async function record(tx, quote, request, sid, actor = admin, agency = org) {
  return (await tx`SELECT public.phone_number_purchase_record(${actor},${agency},${quote.id},${request},${sid},${master},${quote.phone_number}) AS op`)[0].op;
}
async function complete(tx, quote, request) {
  return (await tx`SELECT public.phone_number_purchase_complete(${admin},${org},${quote.id},${request}) AS op`)[0].op;
}

// The second transaction must actually block on the first, proved with pg_blocking_pids.
// Holding a transaction until the observed wait avoids a timing-only Promise.all smoke test.
async function contend(pg, first, second, whileBlocked) {
  const firstReady = deferred(), secondReady = deferred(), release = deferred();
  let secondFinished = false;
  const one = pg.begin(async (tx) => {
    await service(tx);
    const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
    const result = await first(tx);
    firstReady.resolve(pid);
    await release.promise;
    return result;
  });
  one.catch(firstReady.reject);
  let two, proofError;
  try {
    const firstPid = await firstReady.promise;
    two = pg.begin(async (tx) => {
      await service(tx);
      const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
      secondReady.resolve(pid);
      return second(tx);
    });
    two.then(() => { secondFinished = true; }, (error) => { secondFinished = true; secondReady.reject(error); });
    const secondPid = await secondReady.promise;
    let blocked = false;
    for (let attempt = 0; attempt < 150 && !secondFinished; attempt += 1) {
      const [{ blockers }] = await pg`SELECT pg_blocking_pids(${secondPid}) AS blockers`;
      if (blockers.includes(firstPid)) { blocked = true; break; }
      await delay(20);
    }
    assert(blocked, 'second PostgreSQL session must wait for the held first transaction');
    if (whileBlocked) await whileBlocked();
  } catch (error) {
    proofError = error;
  } finally {
    release.resolve();
  }
  const results = await Promise.allSettled([one, two]);
  if (proofError) throw proofError;
  assert.equal(results[0].status, 'fulfilled', results[0].reason?.message);
  return results;
}
function conflict(result, message, code = 'PT409') {
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason.code, code);
  assert.equal(result.reason.message, message);
}

export async function run(pg) {
  let passed = 0;
  const quote = (phone, actor = admin, agency = org) => pg.begin(async (tx) => {
    await service(tx);
    return (await tx`SELECT public.phone_number_purchase_quote(${actor},${agency},${master},${phone},'toll_free','Synthetic contention',${terms}::jsonb) AS op`)[0].op;
  });
  const invoke = (fn) => pg.begin(async (tx) => { await service(tx); return fn(tx); });

  let a = await quote('+18005550201'), key = randomUUID();
  let [one, two] = await contend(pg, (tx) => claim(tx,a,key), (tx) => claim(tx,a,key));
  assert.equal(one.value.claimed, true); assert.equal(two.status, 'fulfilled'); assert.equal(two.value.claimed, false); passed += 1;

  a = await quote('+18005550202'); let b = await quote('+18005550202');
  [one, two] = await contend(pg, (tx) => claim(tx,a,randomUUID()), (tx) => claim(tx,b,randomUUID()));
  assert.equal(one.value.claimed, true); conflict(two,'number_unavailable'); passed += 1;

  a = await quote('+18885550203'); b = await quote('+18885550203',otherAdmin,otherOrg);
  [one, two] = await contend(pg, (tx) => claim(tx,a,randomUUID()), (tx) => claim(tx,b,randomUUID(),otherAdmin,otherOrg));
  assert.equal(one.value.claimed, true); conflict(two,'number_unavailable'); passed += 1;

  a = await quote('+18005550204'); b = await quote('+18885550204'); key = randomUUID();
  [one, two] = await contend(pg, (tx) => claim(tx,a,key), (tx) => claim(tx,b,key));
  assert.equal(one.value.claimed, true); conflict(two,'request_conflict'); passed += 1;

  a = await quote('+18005550205');
  [one, two] = await contend(pg, (tx) => claim(tx,a,randomUUID()), (tx) => claim(tx,a,randomUUID()));
  assert.equal(one.value.claimed, true); conflict(two,'request_conflict'); passed += 1;

  a = await quote('+18005550206'); key = randomUUID();
  await invoke((tx) => claim(tx,a,key));
  await invoke((tx) => record(tx,a,key,'PN11111111111111111111111111111206'));
  [one, two] = await contend(pg, (tx) => complete(tx,a,key), (tx) => complete(tx,a,key));
  assert.equal(one.value.state,'completed'); assert.equal(two.status,'fulfilled');
  assert.equal(two.value.phone_number_id,one.value.phone_number_id);
  assert.equal((await pg`SELECT count(*)::int AS n FROM public.phone_numbers WHERE phone_number=${a.phone_number}`)[0].n,1); passed += 1;

  a = await quote('+18005550207'); b = await quote('+18885550207',otherAdmin,otherOrg);
  key = randomUUID(); const otherKey = randomUUID();
  await invoke((tx) => claim(tx,a,key)); await invoke((tx) => claim(tx,b,otherKey,otherAdmin,otherOrg));
  [one, two] = await contend(pg,
    (tx) => record(tx,a,key,'PN11111111111111111111111111111207'),
    (tx) => record(tx,b,otherKey,'PN11111111111111111111111111111207',otherAdmin,otherOrg));
  assert.equal(one.value.state,'purchased_pending_save'); conflict(two,'receipt_conflict'); passed += 1;

  [one, two] = await contend(pg, (tx) => complete(tx,a,key), async (tx) =>
    (await tx`SELECT public.phone_number_purchase_review(${admin},${org},${a.id},${key},'PURCHASE_OUTCOME_UNKNOWN') AS op`)[0].op);
  assert.equal(one.value.state,'completed'); assert.equal(two.status,'fulfilled'); assert.equal(two.value.state,'completed'); passed += 1;

  // Authorization must be fresh after waiting on a global number lock.
  const revocable = '10000000-0000-4000-8000-000000000017';
  a = await quote('+18005550208',revocable); key = randomUUID();
  const numberLock = `phone_purchase_number:${master.toLowerCase()}:${a.phone_number}`;
  try {
    [,two] = await contend(pg, async (tx) => { await tx`SELECT pg_advisory_xact_lock(hashtextextended(${numberLock},0))`; return true; },
      (tx) => claim(tx,a,key,revocable),
      () => pg`UPDATE public.profiles SET role='Agent' WHERE id=${revocable}`);
    conflict(two,'admin_required','PT403'); passed += 1;
  } finally { await pg`UPDATE public.profiles SET role='Admin' WHERE id=${revocable}`; }

  a = await quote('+18005550209'); key = randomUUID();
  const suspendedLock = `phone_purchase_number:${master.toLowerCase()}:${a.phone_number}`;
  try {
    [,two] = await contend(pg, async (tx) => { await tx`SELECT pg_advisory_xact_lock(hashtextextended(${suspendedLock},0))`; return true; },
      (tx) => claim(tx,a,key),
      () => pg`UPDATE public.organizations SET twilio_subaccount_status='suspended' WHERE id=${org}`);
    conflict(two,'telephony_unavailable','PT403'); passed += 1;
  } finally { await pg`UPDATE public.organizations SET twilio_subaccount_status='active' WHERE id=${org}`; }

  // Expiring while blocked also fails closed; no attempted timestamp/request is written.
  a = await quote('+18005550210'); key = randomUUID();
  await pg`UPDATE private.phone_number_purchase_operations SET created_at=clock_timestamp()-interval '4 minutes',expires_at=clock_timestamp()+interval '1 second' WHERE id=${a.id}`;
  const expiryLock = `phone_purchase_number:${master.toLowerCase()}:${a.phone_number}`;
  [,two] = await contend(pg, async (tx) => { await tx`SELECT pg_advisory_xact_lock(hashtextextended(${expiryLock},0))`; return true; },
    (tx) => claim(tx,a,key), () => delay(1200));
  conflict(two,'quote_expired');
  const [expired] = await pg`SELECT attempted_at,request_id FROM private.phone_number_purchase_operations WHERE id=${a.id}`;
  assert.equal(expired.attempted_at,null); assert.equal(expired.request_id,null); passed += 1;

  // The request key namespace is agency-scoped; unrelated authorized purchases remain independent.
  a = await quote('+18005550211'); b = await quote('+18885550211',otherAdmin,otherOrg); key = randomUUID();
  const independent = await Promise.all([invoke((tx) => claim(tx,a,key)), invoke((tx) => claim(tx,b,key,otherAdmin,otherOrg))]);
  assert(independent.every((op) => op.claimed)); passed += 1;
  console.log(`PASS: ${passed} native PostgreSQL contention/independence scenarios (11 observed lock waits)`);
}
