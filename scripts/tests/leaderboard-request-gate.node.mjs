import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeaderboardRequestGate, leaderboardPollMs, leaderboardErrorMessage } from '../../src/lib/leaderboard-request-gate.ts';
const ok = (n) => ({ data: [n], error: null });
const fail = (code = '57014') => ({ data: null, error: { code } });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('twenty simultaneous refreshes share exactly one request and result', async () => {
  const gate = new LeaderboardRequestGate(); const d = deferred(); let calls = 0;
  const promises = Array.from({length: 20}, () => gate.run('u:o:today', () => { calls++; return d.promise; }));
  await tick(); assert.equal(calls, 1); d.resolve(ok(1));
  assert.deepEqual(await Promise.all(promises), Array(20).fill(ok(1)));
});
test('different contexts serialize instead of overlapping', async () => {
  const gate = new LeaderboardRequestGate(); const d = deferred(); const started = [];
  const a = gate.run('today', () => { started.push('today'); return d.promise; });
  const b = gate.run('month', async () => { started.push('month'); return ok(2); });
  await tick(); assert.deepEqual(started, ['today']); d.resolve(ok(1)); await a; await b;
  assert.deepEqual(started, ['today','month']);
});
test('superseded queued contexts never start a network request', async () => {
  const gate = new LeaderboardRequestGate(); const d = deferred(); let current = 'today'; let staleCalls = 0;
  const a = gate.run('today', () => d.promise);
  const b = gate.run('week', async () => { staleCalls++; return ok(2); }, () => current === 'week');
  current = 'month'; d.resolve(ok(1)); await a;
  assert.equal((await b).error.code, 'CLIENT_CANCELLED'); assert.equal(staleCalls, 0);
});
test('successful snapshots are reused only within ten seconds', async () => {
  let now = 0; let calls = 0; const gate = new LeaderboardRequestGate({ now: () => now });
  const load = async () => ok(++calls);
  assert.deepEqual(await gate.run('u:o:today', load), ok(1)); now = 9999;
  assert.deepEqual(await gate.run('u:o:today', load), ok(1)); now = 10000;
  assert.deepEqual(await gate.run('u:o:today', load), ok(2));
});
test('identity, organization, group, and date keys do not share snapshots', async () => {
  const gate = new LeaderboardRequestGate(); let n = 0;
  for (const key of ['u1:o1:today','u2:o1:today','u1:o2:today','u1:o1:group','u1:o1:tomorrow']) {
    assert.deepEqual(await gate.run(key, async () => ok(++n)), ok(n));
  }
  assert.equal(n, 5);
});
test('empty data is valid, null data is not a fabricated empty board', async () => {
  const gate = new LeaderboardRequestGate();
  assert.deepEqual(await gate.run('empty', async () => ({data: [],error: null})), {data: [],error: null});
  assert.equal((await gate.run('invalid', async () => ({data: null,error: null}))).error.code, 'EMPTY_RESPONSE');
});
test('failure cooldown cannot be bypassed by retry clicks or changing periods', async () => {
  let now = 0; let calls = 0; const gate = new LeaderboardRequestGate({ now: () => now });
  const load = async () => { calls++; return fail(); };
  await gate.run('today', load);
  for (let i=0;i<30;i++) await gate.run(`period:${i}`, load);
  assert.equal(calls, 1); now = 30000; await gate.run('today', load); assert.equal(calls, 2);
  now = 89999; await gate.run('month', load); assert.equal(calls, 2);
  now = 90000; await gate.run('today', load); assert.equal(calls, 3);
});
test('maintenance cools down for five minutes rather than retrying every poll', async () => {
  let now = 0; let calls = 0; const gate = new LeaderboardRequestGate({ now: () => now });
  const load = async () => { calls++; return fail('PT503'); };
  await gate.run('a',load); now = 299999; await gate.run('a',load); assert.equal(calls,1);
  now = 300000; await gate.run('a',load); assert.equal(calls,2);
});
test('success after a cooldown resets the exponential backoff', async () => {
  let now = 0; let calls = 0; const gate = new LeaderboardRequestGate({ now: () => now });
  await gate.run('a', async () => fail()); now = 30000;
  await gate.run('a', async () => ok(1)); now = 40000;
  await gate.run('a', async () => { calls++; return fail(); }); now = 70000;
  await gate.run('a', async () => { calls++; return ok(2); }); assert.equal(calls,2);
});
test('a hung request times out, aborts transport, and opens cooldown', async () => {
  let aborted = false; const gate = new LeaderboardRequestGate({ timeoutMs: 15 });
  const r = await gate.run('a', signal => {
    signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {});
  });
  assert.equal(r.error.code, 'CLIENT_TIMEOUT'); assert.equal(aborted,true);
  let calls=0; await gate.run('b',async()=>{calls++;return ok(1);}); assert.equal(calls,0);
});
test('network rejection becomes an explicit failure, without an unhandled rejection', async () => {
  const gate=new LeaderboardRequestGate();
  assert.equal((await gate.run('a',async()=>{throw new Error('secret server details');})).error.code,'NETWORK_ERROR');
});
test('identity reset aborts old work, clears snapshots, and skips old queued work', async () => {
  const gate=new LeaderboardRequestGate(); let stale=0;
  const a=gate.run('old',()=>new Promise(()=>{}));
  const b=gate.run('old2',async()=>{stale++;return ok(2);}); await tick(); gate.reset();
  const c=gate.run('new',async()=>ok(3));
  assert.equal((await a).error.code,'CLIENT_CANCELLED'); assert.equal((await b).error.code,'CLIENT_CANCELLED');
  assert.deepEqual(await c,ok(3)); assert.equal(stale,0);
});
test('reset and reuse supports StrictMode cleanup/remount', async()=>{
  const gate=new LeaderboardRequestGate(); await gate.run('a',async()=>ok(1)); gate.reset();
  assert.deepEqual(await gate.run('a',async()=>ok(2)),ok(2));
});
test('queue is bounded when filters change faster than the server',async()=>{
  const gate=new LeaderboardRequestGate({maxEntries:2}); const d=deferred();
  const a=gate.run('a',()=>d.promise); const b=gate.run('b',async()=>ok(2));
  assert.equal((await gate.run('c',async()=>ok(3))).error.code,'CLIENT_BUSY'); d.resolve(ok(1)); await a; await b;
});
test('results that become stale during flight are neither exposed nor cached',async()=>{
  const gate=new LeaderboardRequestGate(); const d=deferred(); let current=true;
  const a=gate.run('a',()=>d.promise,()=>current); await tick(); current=false; d.resolve(ok(1));
  assert.equal((await a).error.code,'CLIENT_CANCELLED'); current=true;
  assert.deepEqual(await gate.run('a',async()=>ok(2),()=>current),ok(2));
});
test('legacy/invalid polling values are clamped to the safe floor',()=>{
  for(const v of [undefined,null,'',0,-1,4_000,'4000',NaN,Infinity,'bad']) assert.equal(leaderboardPollMs(v),30_000);
  assert.equal(leaderboardPollMs('60000'),60_000); assert.equal(leaderboardPollMs(1e9),300_000);
});
test('maintenance and busy errors are explicit and no raw error message is displayed',()=>{
  assert.match(leaderboardErrorMessage({code:'PT503'},false),/temporarily paused/);
  assert.match(leaderboardErrorMessage({code:'PT429'},true),/busy/);
  assert.equal(leaderboardErrorMessage({message:'private error'},false),"Couldn't load the leaderboard.");
});
