import postgres from 'postgres';
import assert from 'node:assert/strict';
const url=process.env.REPORTING_TEST_URL;
if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname)||!new URL(url).pathname.startsWith('/reporting_'))throw new Error('Disposable reporting database only');
const db=postgres(url,{max:6}),mode=process.argv[2];
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const actor=async sql=>{await sql`select test_actor(11)`;await sql.unsafe('SET LOCAL ROLE authenticated');};
async function race(name,firstOp,secondOp){
 const ready=deferred(),release=deferred();
 const first=db.begin(async sql=>{const r=await firstOp(sql);ready.resolve();await release.promise;return r;});
 let second;
 try{
  await Promise.race([ready.promise,first]);
  second=db.begin(async sql=>{await sql`select set_config('application_name',${name},true)`;return secondOp(sql)});
  const deadline=Date.now()+4000;
  for(;;){const [r]=await db`select count(*)::int n from pg_stat_activity where application_name=${name} and wait_event_type='Lock'`;
   if(r.n===1)break;if(Date.now()>deadline)throw new Error(name+' did not contend');await new Promise(r=>setTimeout(r,10));}
  release.resolve();return await Promise.all([first,second]);
 }finally{release.resolve();await Promise.allSettled([first,second].filter(Boolean));}
}
try{
 if(mode==='policy'){
  const [c]=await db`insert into clients(organization_id,assigned_agent_id,first_name,last_name) values(${id(1)},${id(11)},'Concurrency','Fixture') returning id`;
  const op=async sql=>{await actor(sql);const [r]=await sql`select record_client_policy(${id(90100)},${c.id},'{"policy_type":"Term","carrier":"Synthetic","premium":58.45,"sold_date":"2026-09-28"}'::jsonb,true) result`;return r.result;};
  const [a,b]=await race('reporting_policy_retry',op,op);assert.deepEqual(a.win_ids,b.win_ids);assert.equal(b.idempotent,true);
  const ready=deferred(),release=deferred();
  const holder=db.begin(async sql=>{await sql`select pg_advisory_xact_lock(hashtextextended('agentflow:leaderboard:v1:'||${id(1)}::text,0))`;ready.resolve();await release.promise;});
  await Promise.race([ready.promise,holder]);
  try{await assert.rejects(db.begin(async sql=>{await actor(sql);return sql`select get_leaderboard_snapshot('month')`}),e=>e.code==='PT429');}finally{release.resolve();await holder;}
  await db.begin(async sql=>{await actor(sql);await sql`select get_leaderboard_snapshot('month')`;});
  await db`insert into calls(organization_id,agent_id,direction,duration,created_at) select ${id(1)},${id(11)},'outbound',29,now()-make_interval(days=>(i%365),secs=>i%86400) from generate_series(1,50000) i`;
  await db.unsafe('ANALYZE calls');
  const plans=await db.unsafe(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT count(*),sum(duration) FROM calls WHERE organization_id='${id(1)}' AND created_at>=now()-interval '1 day' AND created_at<now()`);
  assert.match(JSON.stringify(plans),/performance_calls_org_date/,'bounded org-date index is used');
  const started=Date.now();
  await db.begin(async sql=>{await actor(sql);await sql.unsafe("SET LOCAL statement_timeout='2000ms'");await sql`select get_performance_summary('year','own')`;});
  const elapsed=Date.now()-started;
  assert.ok(elapsed<2000,`year summary exceeded 2 seconds: ${elapsed}ms`);
  console.log('PASS 50,000-row indexed fixture; year summary ms',elapsed);
 }else{
  const payload={title:'Concurrent booking',start_time:'2026-12-01T12:00:00Z',user_id:id(11),contact_id:id(201)};
  const op=async sql=>{await actor(sql);const [r]=await sql`select create_appointment_once(${id(90200)},${sql.json(payload)}) result`;return r.result;};
  const [a,b]=await race('reporting_booking_retry',op,op);assert.equal(a.id,b.id);
  const call=id(90201),sid='CA'+'9'.repeat(32),acct='AC'+'9'.repeat(32);
  await db`insert into calls(id,organization_id,agent_id,twilio_call_sid,direction,duration,dialer_admission_required,attempt_id) values(${call},${id(1)},${id(11)},${sid},'outbound',null,false,${call})`;
  const duration=(n,source,seq)=>async sql=>{await sql.unsafe('SET LOCAL ROLE service_role');const [r]=await sql`select record_call_duration_evidence(${call},${acct},${sid},${sid},null,${n},${source},${seq}) result`;return r.result;};
  await race('reporting_provider_race',duration(120,'elapsed_estimate',1),duration(90,'provider',2));
  await Promise.all([1,2].map(()=>db.begin(duration(90,'provider',2))));
  const [r]=await db`select duration,duration_source from calls where id=${call}`;assert.equal(r.duration,90);assert.equal(r.duration_source,'provider');
  const [e]=await db`select count(*)::int n from private.call_duration_observations where call_id=${call}`;assert.equal(e.n,2);
  await assert.rejects(db`insert into calls(organization_id,agent_id,attempt_id,twilio_call_sid) values(${id(1)},${id(11)},${id(90202)},${sid})`,e=>e.code==='23505');
  const external=async sql=>sql`insert into appointments(organization_id,user_id,title,start_time,external_provider,external_event_id) values(${id(1)},${id(11)},'Racing sync',now(),'google','concurrency-event') returning id`;
  await assert.rejects(race('reporting_external_sync',external,external),e=>e.code==='23505');
  const [n]=await db`select count(*)::int n from appointments where external_event_id='concurrency-event'`;assert.equal(n.n,1);
 }
}finally{await db.end({timeout:2});}
