import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { APP, launch, session } from '../team-open-local/lib.mjs';
import { settings, sql } from './fixture.mjs';

const agency = randomUUID();
const operatorEmail = 'tabs-' + randomUUID() + '@example.invalid';
const targetEmail = 'target-' + randomUUID() + '@example.invalid';
sql(`begin; insert into public.organizations(id,name) values ('${agency}','Synthetic tab test');
  insert into private.automation_release_controls(organization_id,builder_visible) values ('${agency}',true); commit;`);
async function createAccount(address, role) {
  const response = await fetch(settings.API_URL + '/auth/v1/admin/users', {
    method:'POST',
    headers:{'Content-Type':'application/json', apikey:settings.SERVICE_ROLE_KEY, Authorization:'Bearer '+settings.SERVICE_ROLE_KEY},
    body:JSON.stringify({email:address,password:settings.PASSWORD,email_confirm:true,
      user_metadata:{first_name:'Session',last_name:role,organization_id:agency,role}}),
  });
  assert.ok(response.ok,'Local GoTrue could not create the synthetic session account');
  const id = (await response.json()).id;
  assert.match(id,/^[0-9a-f-]{36}$/);
  return id;
}
const operator = await createAccount(operatorEmail, 'Super Admin');
const targetId = await createAccount(targetEmail, 'Agent');
sql(`update profiles set onboarding_complete=true,is_super_admin=(id='${operator}')
  where organization_id='${agency}' and id in ('${operator}','${targetId}')`);
const browser = await launch();
let releaseSave;
const evidence = {sessions:[]};
const button = (page,name) => page.getByRole('button',{name,exact:true});
const isRpc = (r,name) => r.request().method()==='POST' && new URL(r.url()).pathname.endsWith('/rpc/'+name);
async function openAutomations(page) {
  page.setDefaultTimeout(30000);
  await page.goto(APP+'/automations');
  await button(page,'Create automation').waitFor();
  return page.evaluate(async () => {
    const { supabase } = await import('/src/integrations/supabase/client.ts');
    const {data,error} = await supabase.rpc('automation_session_context');
    if (error) throw Error('Local session context: '+error.message);
    return data;
  });
}
try {
  const login = () => session(browser, 'Session fixture', operatorEmail, settings.PASSWORD, evidence);
  console.log('Signing in through local CRM');
  const shared = await login();
  const a = shared.page;
  const b = await shared.context.newPage();
  const independent = (await login()).page;
  console.log('Both sign-ins finished. Opening shared and independent editors.');
  const [ctxA,ctxB,ctxOther] = await Promise.all([openAutomations(a),openAutomations(b),openAutomations(independent)]);
  assert.equal(ctxA.session_id,ctxB.session_id);
  assert.notEqual(ctxA.session_id,ctxOther.session_id);
  assert.equal(ctxA.actor_id,operator);
  assert.equal(ctxOther.actor_id,operator);

  console.log('Editing a shared-session draft');
  await button(a,'Create automation').click();
  await a.getByLabel('Automation name').fill('Stale shared tab');
  const released = new Promise(resolve => {releaseSave=resolve;});
  let captured;
  const intercepted = new Promise(resolve => {captured=resolve;});
  // Delay the actual signed request without changing its payload, cookies, headers or server.
  await a.route('**/rpc/save_automation_draft',async route => {
    captured(route.request().postDataJSON().p_session_revision);
    await released;
    await route.continue();
  });
  const denied = a.waitForResponse(r => isRpc(r,'save_automation_draft'));
  await button(a,'Save draft').click();
  assert.equal(await intercepted,ctxA.revision);

  console.log('Entering View As while the signed draft request is outstanding');
  await b.getByRole('button',{name:/Account menu/}).click();
  await button(b,'View As').click();
  const target = targetEmail;
  await b.getByPlaceholder('Search users...').fill(target);
  await b.getByRole('dialog').getByRole('button').filter({hasText:target}).click();
  await button(b,'Exit View As').waitFor();
  await button(a,'Exit View As').waitFor();
  releaseSave();
  const refused = await denied;
  assert.equal(refused.status(),403);
  assert.equal((await refused.json()).code,'42501');
  assert.equal(sql(`select count(*) from workflows where created_by='${operator}'`),'0');

  await button(independent,'Create automation').click();
  await independent.getByLabel('Automation name').fill('Independent signed session');
  await button(independent,'Save draft').click();
  await independent.getByText('Draft saved.').waitFor();
  assert.equal(sql(`select count(*) from workflows where created_by='${operator}'`),'1');
  assert.equal(await button(independent,'Exit View As').count(),0);

  await b.reload();
  await button(b,'Exit View As').waitFor();
  await button(b,'Exit View As').click();
  await button(a,'Exit View As').waitFor({state:'hidden'});
  await a.goto(APP+'/automations');
  await button(a,'Create automation').click();
  await a.getByLabel('Automation name').fill('Confirmed normal session');
  await button(a,'Save draft').click();
  await a.getByText('Draft saved.').waitFor();
  assert.equal(sql(`select count(*) from workflows where created_by='${operator}'`),'2');
  console.log('PASS two signed-in tabs share mode and reject an in-flight stale draft; separate login stays writable; reload and explicit exit recover the first login');
} catch (error) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      console.error(page.url(), (await page.locator('body').innerText().catch(() => '')).slice(0, 600));
    }
  }
  throw error;
} finally {
  releaseSave?.();
  await browser.close();
  sql(`begin; delete from public.workflows where created_by='${operator}' and organization_id='${agency}';
    delete from auth.users where id in ('${operator}','${targetId}');
    delete from private.automation_release_controls where organization_id='${agency}';
    delete from public.appointment_types where organization_id='${agency}';
    delete from public.pipeline_stages where organization_id='${agency}';
    delete from public.lead_sources where organization_id='${agency}';
    delete from public.organizations where id='${agency}'; commit;`);
}
