import assert from 'node:assert/strict';
const org='a0000000-0000-0000-0000-000000000001',agent='a1000000-0000-0000-0000-000000000002';
const call=n=>`a6000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export async function run(pg){
 await pg`UPDATE calls SET status='completed',ended_at=now()`;
 await pg`UPDATE inbound_route_attempts SET terminal=true`;
 await pg`UPDATE inbounds_room_sessions SET state='available',ready=true,expires_at=now()+interval '10 minutes'`;
 for(const n of [1,2,3])await pg`INSERT INTO calls(id,organization_id,direction,caller_id_used,status,routing_engine) VALUES(${call(n)},${org},'inbound','+12025550123','ringing','v2')`;
 let firstPlanned;const barrier=new Promise(r=>firstPlanned=r);
 const first=pg.begin(async tx=>{
  const r=await tx`SELECT plan_inbound_route(${call(1)},${org},NULL,NULL,'{}',20) AS plan`;
  firstPlanned();await tx`SELECT pg_sleep(0.4)`;return r[0].plan;
 });
 await barrier;
 const second=pg.begin(async tx=>(await tx`SELECT plan_inbound_route(${call(2)},${org},NULL,NULL,'{}',20) AS plan`)[0].plan);
 const [a,b]=await Promise.all([first,second]);
 assert.equal(a.targets.length,2);assert.equal(b.targets.length,0,'second planner must observe first reservation after waiting');
 // End the first wave; hold an outbound insert open while an inbound planner waits on the same agent.
 await pg`UPDATE calls SET status='completed',ended_at=now() WHERE id=${call(1)}`;
 await pg`UPDATE inbound_route_attempts SET terminal=true WHERE call_id=${call(1)}`;
 await pg`UPDATE inbounds_room_sessions SET state='paused' WHERE agent_id<>${agent}`;
 let inserted;const insertedBarrier=new Promise(r=>inserted=r);
 const outbound=pg.begin(async tx=>{
  await tx`INSERT INTO calls(organization_id,agent_id,direction,status) VALUES(${org},${agent},'outbound','ringing')`;
  inserted();await tx`SELECT pg_sleep(0.4)`;
 });
 await insertedBarrier;
 const inbound=pg.begin(async tx=>(await tx`SELECT plan_inbound_route(${call(3)},${org},NULL,NULL,'{}',20) AS plan`)[0].plan);
 await outbound;assert.equal((await inbound).targets.length,0,'inbound must observe the outbound call after waiting');
}
