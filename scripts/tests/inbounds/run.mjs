// Disposable local database only. PGlite verifies semantics; PGURL adds real two-session lock tests.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const read=p=>fs.readFile(path.join(root,p),'utf8');
let db,sql,pg;
if(process.env.PGURL){
 const url=new URL(process.env.PGURL);assert(['127.0.0.1','localhost'].includes(url.hostname),'Only disposable localhost PostgreSQL');
 const {default:postgres}=await import('postgres');pg=postgres(process.env.PGURL,{max:4});
 const session=await pg.reserve();
 db={exec:s=>session.unsafe(s),query:async(s,p=[])=>({rows:await session.unsafe(s,p)}),close:async()=>{session.release();await pg.end();}};
}else{const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');db=new PGlite();}
const q=async(s,p)=>(await db.query(s,p)).rows;
const exec=s=>db.exec(s);
async function source(p){await exec(await read(p));}
try{
 await source('supabase/tests/inbound_harness.sql');
 for(const p of ['20260823222528_inbound_identity_foundation','20260823222805_inbound_claim_lifecycle','20260823222926_recording_source_sid'])await source(`supabase/migrations/${p}.sql`);
 await source('supabase/tests/inbound_v2_harness.sql');
 for(const p of ['20260914000530_inbound_agent_settings_and_registrations','20260915025931_inbound_routing_v2_settings','20260915035141_inbound_route_attempts_d13_and_recovery','20260915053646_inbound_voicemails'])await source(`supabase/migrations/${p}.sql`);
 await source('supabase/tests/inbounds/extension.sql');
 for(const f of JSON.parse(await read('supabase/tests/inbounds/live-routing-preimage.json')))await exec(f.definition);
 await exec(JSON.parse(await read('supabase/tests/inbounds/live-claim-preimage.json')).definition);
 await source('supabase/migrations/20261103191631_inbounds_room_v1.sql');
 await source('supabase/tests/inbounds/scenarios.sql');
 console.log('PASS: room SQL tenant isolation, dedicated DID, leases, busy/reservation, claim, refresh/disposition and report scenarios');
 if(pg){await import('./concurrency.mjs').then(m=>m.run(pg));console.log('PASS: real PostgreSQL simultaneous planner / outbound contention');}
 else console.log('LIMIT: PGlite is single-session; run with PGURL for contention proof.');
}catch(e){console.error(e.message,e.detail||'',e.where||'');process.exitCode=1;}finally{await db?.close();}
