// Isolated PostgreSQL 17 fixtures only. Never point this script at production.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
const url = process.env.LEADERBOARD_TEST_DATABASE_URL;
assert(url && /^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):55432\/leaderboard_test$/.test(url), 'Refusing a non-local/non-fixture database');
const db=postgres(url,{max:4,connect_timeout:5,prepare:false});
const other=postgres(url,{max:2,connect_timeout:5,prepare:false});
let assertions=0;
const check=(value,message)=>{assert(value,message); assertions++;};
const A='00000000-0000-0000-0000-000000000011', B='00000000-0000-0000-0000-000000000012', C='00000000-0000-0000-0000-000000000021';
const O1='00000000-0000-0000-0000-000000000001', O2='00000000-0000-0000-0000-000000000002';
const start=new Date(Date.now()-86400000).toISOString(), end=new Date(Date.now()+60000).toISOString();
const runAs=(client,id,fn)=>client.begin(async tx=>{
  await tx.unsafe('SET LOCAL ROLE authenticated');
  await tx`select set_config('request.jwt.claim.sub',${id ?? ''},true)`;
  return fn(tx);
});
const query=(tx)=>tx`select * from public.get_org_leaderboard_stats(${start}::timestamptz,${end}::timestamptz)`;
try {
  await db.unsafe(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,organization_id uuid,first_name text,last_name text,avatar_url text,status text);
    CREATE TABLE public.calls(id bigint GENERATED ALWAYS AS IDENTITY,agent_id uuid,organization_id uuid,created_at timestamptz,direction text,duration integer);
    CREATE TABLE public.appointments(created_by uuid,user_id uuid,organization_id uuid,created_at timestamptz,status text);
    CREATE TABLE public.clients(id uuid PRIMARY KEY,organization_id uuid,premium numeric);
    CREATE TABLE public.wins(agent_id uuid,organization_id uuid,contact_id uuid,created_at timestamptz,premium_amount numeric);
    INSERT INTO profiles VALUES ('${A}','${O1}','A','Alpha',NULL,'Active'),('${B}','${O1}','B','Beta',NULL,'Active'),('${C}','${O2}','C','Gamma',NULL,'Active');
    INSERT INTO calls(agent_id,organization_id,created_at,direction,duration) VALUES
      ('${A}','${O1}',now()-interval '1 hour','outbound',60),('${A}','${O1}',now()-interval '1 hour','inbound',999),
      ('${B}','${O1}',now()-interval '1 hour','outgoing',120),('${B}','${O1}',now()-interval '1 hour','OUTBOUND',-5),
      ('${C}','${O2}',now()-interval '1 hour','outbound',999);
    INSERT INTO appointments VALUES ('${A}','${B}','${O1}',now()-interval '1 hour','canceled'),(NULL,'${B}','${O1}',now()-interval '1 hour','scheduled');
    INSERT INTO clients VALUES ('${A}','${O1}',50),('${C}','${O2}',999);
    INSERT INTO wins VALUES ('${A}','${O1}',NULL,now()-interval '1 hour',20),('${A}','${O1}','${A}',now()-interval '1 hour',0),('${B}','${O1}','${C}',now()-interval '1 hour',0),('${C}','${O2}',NULL,now()-interval '1 hour',7);
    ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_calls ON calls TO authenticated USING(agent_id=auth.uid());
    GRANT SELECT ON calls TO authenticated;
  `);
  const original=await readFile('supabase/migrations_archive/pre_baseline/20260805090000_get_org_leaderboard_stats_rpc.sql','utf8');
  await db.unsafe(original);
  const fingerprint=async()=> (await db`select md5(pg_get_functiondef('public.get_org_leaderboard_stats(timestamptz,timestamptz)'::regprocedure)) as value`)[0].value;
  check(await fingerprint()==='d26a38b59de90db91ed777236ee4acc4','Fixture must match the production original function exactly');
  const before=await runAs(db,A,query);
  const [a,b]=before;
  check(before.length===2 && a.agent_id===A && b.agent_id===B,'Authoritative same-org roster');
  check(+a.calls_made===1 && +b.calls_made===2 && +a.talk_time_seconds===60 && +b.talk_time_seconds===120,'Outbound-only calls and canonical nonnegative duration');
  check(+a.appointments_set===1 && +b.appointments_set===1,'Booking credit survives cancellation and honors created_by precedence');
  check(+a.policies_sold===2 && +a.annualized_premium===840 && +b.annualized_premium===0,'Wins count, one annualization, and cross-org premium protection');
  check(+a.recent_wins_7d===2 && +b.recent_wins_7d===1,'Recent wins remain canonical');
  const pause=await readFile('supabase/migrations/20260923224254_emergency_pause_org_leaderboard_20260923.sql','utf8');
  const repair=await readFile('supabase/ops/leaderboard_request_guard.sql','utf8');
  const repause=await readFile('supabase/ops/leaderboard_repause.sql','utf8');
  const metadata=async()=> (await db`select jsonb_build_object('acl',proacl,'owner',proowner,'config',proconfig,'stable',provolatile,'definer',prosecdef,'args',proargtypes::text,'returns',prorettype) as value from pg_proc where oid='public.get_org_leaderboard_stats(timestamptz,timestamptz)'::regprocedure`)[0].value;
  const initialMeta=await metadata();
  await db.begin(tx=>tx.unsafe(pause));
  check(await fingerprint()==='1314cefc781ff326540b83f748d48046','Fixture pause must match production exactly');
  await assert.rejects(runAs(db,A,query),e=>e.code==='PT503'); assertions++;
  await db.begin(tx=>tx.unsafe(repair));
  assert.deepEqual(await metadata(),initialMeta); assertions++;
  assert.deepEqual(await runAs(db,A,query),before); assertions++;
  check(!(await db`select has_function_privilege('anon','public.get_org_leaderboard_stats(timestamptz,timestamptz)','EXECUTE') as allowed`)[0].allowed,'Anonymous execution remains denied');
  await assert.rejects(runAs(db,null,query),e=>e.code==='P0001' && /not authenticated/.test(e.message)); assertions++;
  await assert.rejects(runAs(db,'00000000-0000-0000-0000-000000000099',query),e=>e.code==='P0001' && /no organization/.test(e.message)); assertions++;
  for (const expression of ["NULL,now()", "now(),now()-interval '1 day'", "now()-interval '36 days',now()"]) {
    await assert.rejects(runAs(db,A,tx=>tx.unsafe('select * from public.get_org_leaderboard_stats('+expression+')')),e=>e.code==='P0001'); assertions++;
  }
  const forged=await runAs(db,A,async tx=>{
    await tx`select set_config('request.jwt.claims',${JSON.stringify({sub:A,organization_id:O2})},true)`;
    const raw=await tx`select * from calls`;
    check(raw.every(row=>row.agent_id===A),'Raw call RLS remains restrictive');
    return query(tx);
  });
  assert.deepEqual(forged,before); assertions++;
  await db.begin(async holder=>{
    await holder`select pg_advisory_xact_lock(hashtextextended(${'agentflow:leaderboard:v1:'+O1},0))`;
    const began=performance.now();
    await assert.rejects(runAs(other,A,query),e=>e.code==='PT429'); assertions++;
    check(performance.now()-began<1500,'Busy standings fail fast instead of queuing');
    const foreign=await runAs(other,C,query);
    check(foreign.length===1 && foreign[0].agent_id===C,'Another organization has an independent guard');
    const core=await runAs(other,A,tx=>tx`select count(*) as n from calls`);
    check(+core[0].n===2,'Core CRM reads are not blocked by the standings guard');
  });
  assert.deepEqual(await runAs(other,A,query),before); assertions++;
  await assert.rejects(db.begin(tx=>tx.unsafe(repair)),e=>/definition changed/.test(e.message)); assertions++;
  await db.begin(tx=>tx.unsafe(repause));
  await assert.rejects(runAs(db,A,query),e=>e.code==='PT503'); assertions++;
  check((await db`select position('AF_LEADERBOARD_CONCURRENCY_GUARD_V1_BEGIN' in pg_get_functiondef('public.get_org_leaderboard_stats(timestamptz,timestamptz)'::regprocedure))>0 as kept`)[0].kept,'Emergency re-pause retains the concurrency guard');
  assert.deepEqual(await metadata(),initialMeta); assertions++;
  console.log(JSON.stringify({database:'isolated PostgreSQL 17',assertions,result:'PASS',metricParity:true,authorization:true,nonblockingGuard:true,rollback:true}));
} finally { await Promise.all([db.end(),other.end()]); }
