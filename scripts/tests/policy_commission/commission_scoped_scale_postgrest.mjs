// Real PostgREST 12.2.3 timeout hoisting and large-book reconciliation; synthetic loopback databases only.
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import postgres from 'postgres';
const { PGURL, DB_URL, POSTGREST_BIN, PC_SCOPE_OUTPUT } = process.env;
for (const value of [PGURL, DB_URL]) if (!value || !['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) throw Error('Disposable localhost only');
if (!new URL(DB_URL).pathname.startsWith('/pc_test_') || !POSTGREST_BIN) throw Error('Disposable scope database and PostgREST required');
const version = spawnSync(POSTGREST_BIN, ['--version'], { encoding: 'utf8' }).stdout.trim();
assert.match(version, /12\.2\.3/);
const admin = postgres(DB_URL, { max: 1, onnotice: () => {} });
const cluster = postgres(new URL('/postgres', PGURL).toString(), { max: 1, onnotice: () => {} });
const authRole = 'pc_scope_scale_authenticator', secret = randomBytes(32).toString('hex'), password = randomBytes(18).toString('hex');
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const port = await new Promise(resolve => { const server = createServer().listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); }); });
const samples = []; let child, originalTimeout;
try {
  originalTimeout = (await cluster`SELECT split_part(setting,'=',2) value FROM pg_roles r CROSS JOIN LATERAL unnest(r.rolconfig) setting WHERE r.rolname='authenticated' AND setting LIKE 'statement_timeout=%'`)[0]?.value;
  await cluster.unsafe(`DROP ROLE IF EXISTS ${authRole}; CREATE ROLE ${authRole} LOGIN NOINHERIT PASSWORD '${password}'; GRANT anon,authenticated TO ${authRole}; ALTER ROLE ${authRole} SET statement_timeout='8s'; ALTER ROLE authenticated SET statement_timeout='8s'`);
  for (const [name, timeout] of [['pc_scope_default_probe', null], ['pc_scope_twenty_probe', '20s'], ['pc_scope_forty_probe', '40s']]) {
    await admin.unsafe(`CREATE FUNCTION public.${name}(p_delay double precision DEFAULT 0) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp ${timeout ? `SET statement_timeout='${timeout}'` : ''} AS $$ SELECT jsonb_build_object('statement_timeout',current_setting('statement_timeout')) FROM pg_sleep(p_delay) $$; REVOKE ALL ON FUNCTION public.${name}(double precision) FROM PUBLIC,anon,service_role; GRANT EXECUTE ON FUNCTION public.${name}(double precision) TO authenticated`);
  }
  const expectedTimed = [
    ['get_scoped_commission_breakdown','20s'], ['get_scoped_commission_installments','40s'],
    ['get_scoped_commission_overview','40s'], ['get_scoped_commission_policy_list','40s'],
  ];
  const timed = await admin`SELECT p.proname,split_part(setting,'=',2) budget FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL unnest(p.proconfig) setting WHERE n.nspname='public' AND p.proname LIKE 'get_%commission%' AND setting LIKE 'statement_timeout=%' ORDER BY p.proname`;
  assert.deepEqual(timed.map(row => [row.proname,row.budget]), expectedTimed, 'exactly the three approved new readers use40s; Breakdown remains20s; legacy readers unchanged');
  const [actor] = await admin`SELECT p.id,p.organization_id,p.role FROM cs_scale_cases c JOIN profiles p ON p.id=test_id(c.actor) WHERE c.n=1000`;
  assert.ok(actor, '50,000-policy synthetic book is required');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor.id, role: 'authenticated', exp: Math.floor(Date.now()/1000)+3600, app_metadata: { organization_id: actor.organization_id, role: actor.role } })}`;
  const token = `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
  const db = new URL(DB_URL); db.username = authRole; db.password = password;
  child = spawn(POSTGREST_BIN, [], { env: { PATH: process.env.PATH, PGRST_DB_URI: db.toString(), PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port), PGRST_DB_POOL: '1', PGRST_LOG_LEVEL: 'error' }, stdio: ['ignore', 'inherit', 'inherit'] });
  const base = `http://127.0.0.1:${port}`;
  for (let n=0;;n++) { try { if ((await fetch(base)).ok) break; } catch {} if(n>100) throw Error('PostgREST startup failed'); await new Promise(resolve => setTimeout(resolve,100)); }
  const rpc = async (name, args={}) => {
    const started=performance.now(); const response=await fetch(`${base}/rpc/${name}`, { method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args) });
    const data=await response.json(); const ms=performance.now()-started; samples.push({name,args,status:response.status,ms,error:data.code ?? null});
    console.log(JSON.stringify(samples.at(-1))); return {data,status:response.status,ms};
  };
  const defaultRestored = async () => { const r=await rpc('pc_scope_default_probe'); assert.equal(r.status,200); assert.equal(r.data.statement_timeout,'8s','next transaction on same pool connection restores role default'); };
  await defaultRestored();
  const [ledger] = await admin`WITH r AS (SELECT installment_id,sum(amount_cents) received FROM policy_commission_receipts WHERE organization_id=${actor.organization_id} AND voided_at IS NULL GROUP BY installment_id)
    SELECT count(*)::int payments,sum(i.expected_cents) expected,sum(coalesce(r.received,0)) received,sum(greatest(i.expected_cents-coalesce(r.received,0),0)) remaining,sum(greatest(coalesce(r.received,0)-i.expected_cents,0)) excess
    FROM policy_commission_installments i JOIN policy_commission_estimates e ON e.id=i.estimate_id AND e.organization_id=i.organization_id AND e.credited_agent_id=i.credited_agent_id
    LEFT JOIN r ON r.installment_id=i.id WHERE i.organization_id=${actor.organization_id} AND e.status='active'`;
  assert.equal(ledger.payments,200000);
  for (let iteration=0;iteration<3;iteration++) {
    const overview=await rpc('get_scoped_commission_overview',{p_agent_scope:'all',p_agent_ids:null,p_period:'this_year'});
    assert.equal(overview.status,200,JSON.stringify(overview.data)); assert.equal(overview.data.meta.agent_scope.agent_ids.length,1000); assert.equal(overview.data.setup.eligible_count,50000);
    const [forecast]=await admin`SELECT sum(i.expected_cents) expected,count(*)::int n FROM policy_commission_installments i JOIN policy_commission_estimates e ON e.id=i.estimate_id WHERE i.organization_id=${actor.organization_id} AND e.organization_id=${actor.organization_id} AND e.status='active' AND i.expected_on BETWEEN ${overview.data.meta.from}::date AND ${overview.data.meta.to}::date`;
    const [receipts]=await admin`SELECT coalesce(sum(amount_cents),0) received,count(*)::int n FROM policy_commission_receipts WHERE organization_id=${actor.organization_id} AND voided_at IS NULL AND received_on BETWEEN ${overview.data.meta.from}::date AND ${overview.data.meta.to}::date`;
    assert.equal(overview.data.summary.expected_cents,Number(forecast.expected)); assert.equal(overview.data.summary.expected_count,forecast.n); assert.equal(overview.data.summary.received_cents,Number(receipts.received)); assert.equal(overview.data.summary.received_count,receipts.n);
    await defaultRestored();
    const scheduled=await rpc('get_scoped_commission_installments',{p_agent_scope:'all',p_agent_ids:null,p_period:'all',p_scope:'any',p_limit:25,p_offset:iteration*25});
    assert.equal(scheduled.status,200,JSON.stringify(scheduled.data)); assert.equal(scheduled.data.total_count,ledger.payments); assert.equal(scheduled.data.rows.length,25);
    for (const [key,column] of [['expected_cents','expected'],['received_cents','received'],['remaining_cents','remaining'],['excess_cents','excess']]) assert.equal(scheduled.data.totals[key],Number(ledger[column]),`complete ledger total ${key}`);
    await defaultRestored();
    const policies=await rpc('get_scoped_commission_policy_list',{p_agent_scope:'all',p_agent_ids:null,p_period:'all',p_limit:25,p_offset:iteration*25});
    assert.equal(policies.status,200,JSON.stringify(policies.data)); assert.equal(policies.data.total_count,50000); assert.equal(policies.data.rows.length,25);
    const [policyLedger]=await admin`SELECT count(*)::int policies,sum(e.first_year_cents) estimate FROM wins w JOIN policy_commission_estimates e ON e.win_id=w.id AND e.organization_id=w.organization_id AND e.credited_agent_id=w.agent_id AND e.status='active' WHERE w.organization_id=${actor.organization_id}`;
    assert.equal(policies.data.totals.policies,policyLedger.policies); assert.equal(policies.data.totals.estimate_cents,Number(policyLedger.estimate));
    await defaultRestored();
    const breakdown=await rpc('get_scoped_commission_breakdown',{p_agent_scope:'all',p_agent_ids:null,p_period:'this_year'});
    assert.equal(breakdown.status,200,JSON.stringify(breakdown.data));
    const [sold]=await admin`SELECT count(*)::int policies,sum(e.first_year_cents) estimate FROM wins w JOIN policy_commission_estimates e ON e.win_id=w.id AND e.organization_id=w.organization_id AND e.credited_agent_id=w.agent_id AND e.status='active' WHERE w.organization_id=${actor.organization_id} AND w.sold_date BETWEEN ${breakdown.data.meta.from}::date AND ${breakdown.data.meta.to}::date`;
    assert.equal(breakdown.data.sold.policies,sold.policies); assert.equal(breakdown.data.sold.estimate_cents,Number(sold.estimate));
    await defaultRestored();
  }
  // Synthetic probes independently demonstrate all three active caps; release readers retain their exact definitions.
  const eight=await rpc('pc_scope_default_probe',{p_delay:9}); assert.equal(eight.data.code,'57014'); assert.ok(eight.ms>=7500 && eight.ms<15000);
  await defaultRestored();
  const twenty=await rpc('pc_scope_twenty_probe',{p_delay:21}); assert.equal(twenty.data.code,'57014'); assert.ok(twenty.ms>=19000 && twenty.ms<30000);
  await defaultRestored();
  const forty=await rpc('pc_scope_forty_probe',{p_delay:41}); assert.equal(forty.data.code,'57014'); assert.ok(forty.ms>=39000 && forty.ms<50000);
  await defaultRestored();
  assert.ok(samples.some(s=>s.name==='get_scoped_commission_overview' && s.status===200 && s.ms>8000),'an exact released request actually exceeds the role default and completes under its own cap');
  const evidence={version,agents:1000,policies:50000,installments:200000,role_default:'8s',new_rpc_timeouts:Object.fromEntries(expectedTimed),samples};
  if(PC_SCOPE_OUTPUT){await mkdir(PC_SCOPE_OUTPUT,{recursive:true});await writeFile(`${PC_SCOPE_OUTPUT}/postgrest-scale.json`,JSON.stringify(evidence,null,2)+'\n');}
  console.log('PASS actual PostgREST approved scoped40s/Breakdown20s/role8s hoisting, caps, transaction reset, repeated50k-book complete-ledger reconciliation');
} finally {
  child?.kill('SIGTERM'); await new Promise(resolve=>setTimeout(resolve,100));
  await admin.unsafe('DROP FUNCTION IF EXISTS public.pc_scope_default_probe(double precision); DROP FUNCTION IF EXISTS public.pc_scope_twenty_probe(double precision); DROP FUNCTION IF EXISTS public.pc_scope_forty_probe(double precision)').catch(()=>{});
  await admin.end();
  await cluster.unsafe(`DROP ROLE IF EXISTS ${authRole}`).catch(()=>{});
  if(originalTimeout) await cluster.unsafe(`ALTER ROLE authenticated SET statement_timeout='${originalTimeout.replaceAll("'","''")}'`); else await cluster.unsafe('ALTER ROLE authenticated RESET statement_timeout');
  await cluster.end();
}
