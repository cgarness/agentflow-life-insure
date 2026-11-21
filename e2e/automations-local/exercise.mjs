import assert from 'node:assert/strict';
import { sql, agency } from './fixture.mjs';
import { prepareEvents, worker } from './work.mjs';

export async function exercise({first, second, immediate, delayed}) {
  assert.match(immediate,/^[a-f0-9-]{36}$/);
  assert.match(delayed,/^[a-f0-9-]{36}$/);
  prepareEvents();
  const initial = worker();
  assert.deepEqual(initial,{sms:[],email:['Hello Blake from the first graph.']}, sql(`select status,reason from private.automation_runs where organization_id='${agency}'`));
  assert.equal(sql(`select status from private.automation_runs where organization_id='${agency}' and workflow_id='${delayed}'`),'waiting');
  await second.getByRole('list',{name:'Ordered steps'}).getByRole('button',{name:'Send SMS',exact:true}).click();
  await second.getByLabel('Message body').fill('Changed after enrollment.');
  await second.getByRole('button',{name:'Save draft',exact:true}).click();
  await second.getByText('Draft saved.').waitFor();
  sql(`update private.automation_runs set due_at=now()-interval '1 second' where organization_id='${agency}' and workflow_id='${delayed}' and status='waiting'`);
  assert.deepEqual(worker(),{sms:[],email:[]}); // restart and advance past the saved wait
  assert.deepEqual(worker(),{sms:['Original for Blake'],email:[]},sql(`select status,reason from private.automation_runs where organization_id='${agency}'`));
  assert.deepEqual(worker(),{sms:[],email:[]});
  assert.equal(sql(`select count(*) from private.automation_runs where organization_id='${agency}' and workflow_id in ('${immediate}','${delayed}') and status='completed'`),'2');
  for (const page of [first,second]) {
    await page.getByRole('button',{name:'Activity',exact:true}).click();
    await page.getByText(/completed/i).first().waitFor();
  }
  console.log('Both published versions completed. One synthetic email and one synthetic SMS matched the authored graphs. Restart, duplicate membership and later draft passed.');
}
