import postgres from 'postgres';
import assert from 'node:assert/strict';
// Called only with the freshly-created database from engine.mjs.
export async function verifyDispatchContention(url) {
  const location=new URL(url);
  if(!['127.0.0.1','localhost'].includes(location.hostname)||!/^\/dialer_reliability_\d+_\d+$/.test(location.pathname))throw new Error('Synthetic database only');
  const db=postgres(url,{max:5,onnotice:()=>{}});
  const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()};};
  const actor=async sql=>{await sql`SELECT test_actor(11)`;await sql.unsafe('SET LOCAL ROLE authenticated');};
  const admission=async(sql,n)=>{await sql.unsafe('SET LOCAL ROLE service_role');return sql`SELECT public.admit_twilio_outbound(${id(n)},'synthetic_agent_11','+15551234567','+15559990000',${'CA'+String(n).padStart(32,'0')}) result`;};
  const waitForLock=async name=>{
    const deadline=Date.now()+5000;
    for(;;){
      const [row]=await db`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=${name} AND wait_event_type='Lock'`;
      if(row.n===1)return;
      if(Date.now()>deadline)throw new Error('Expected real row-lock wait: '+name);
      await new Promise(r=>setTimeout(r,10));
    }
  };
  const releases=[];
  try {
    await db.begin(async sql=>{await actor(sql);for(const n of [911,912])await sql`INSERT INTO public.calls(id,organization_id,agent_id,campaign_id,campaign_lead_id,contact_phone,caller_id_used,status,direction)
      VALUES(${id(n)},${id(1)},${id(11)},${id(101)},${id(301)},'+15551234567','+15559990000','ringing','outbound')`;});
    for(const providerFirst of [false,true]) {
      const n=providerFirst?912:911,ready=defer(),release=defer();releases.push(release);
      const first=db.begin(async sql=>{
        if(providerFirst)await admission(sql,n);else{await actor(sql);await sql`SELECT public.record_dialer_dispatch_failure(${id(n)},'unconfirmed')`;}
        ready.resolve();await release.promise;
      });
      // Propagate a failed first transaction rather than hanging at readiness.
      await Promise.race([ready.promise,first.then(()=>{throw new Error('holder ended early');})]);
      const label='dialer_receipt_wait_'+n;
      const second=db.begin(async sql=>{
        await sql`SELECT set_config('application_name',${label},true)`;
        if(providerFirst){await actor(sql);await sql`SELECT public.record_dialer_dispatch_failure(${id(n)},'not_sent')`;}
        else await admission(sql,n);
      });
      try{await waitForLock(label);}finally{release.resolve();}
      await Promise.all([first,second]);
      const [row]=await db`SELECT dialer_provider_admitted,status,duration,ended_at FROM public.calls WHERE id=${id(n)}`;
      assert.equal(row.dialer_provider_admitted,true);assert.equal(row.status,'ringing');
      assert.equal(row.duration,0);assert.equal(row.ended_at,null);
    }
    console.log('PASS native row-lock contention in both orders: provider truth wins, no fabricated duration');
  }finally{for(const release of releases)release.resolve();await db.end({timeout:2});}
}
