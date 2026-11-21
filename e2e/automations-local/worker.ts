// Deno restricts native I/O to the local API. The transport handles all external requests in memory.
import {db, processClaim, calls, emails} from '../../scripts/tests/automations/channel-transport.ts';
const {error: intake} = await db.rpc('automation_process_events',{p_limit:10});
if (intake) throw intake;
const {data: claims,error} = await db.rpc('automation_claim_work',{p_limit:10});
if (error) throw error;
for (const c of claims) {
  if (c.organization_id !== 'ba921000-0000-4000-8000-000000000001') throw Error('Another test owns this run');
  await processClaim(c);
}
const {error: repair} = await db.rpc('automation_repair_messages',{p_limit:10});
if (repair) throw repair;
console.log(JSON.stringify({sms:calls.map(c=>c.get('Body')), email:emails.map(e=>e.text)}));
