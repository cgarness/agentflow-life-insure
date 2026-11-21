import assert from 'node:assert/strict';
import { launch, session, APP } from '../team-open-local/lib.mjs';
import { settings, sql, agency, otherAgency, campaign, sender, email } from './fixture.mjs';
import { visibility } from './release-visibility.mjs';

const evidence = { sessions: [] };
const browser = await launch();
const button = (page, name) => page.getByRole('button', { name, exact: true });
function rows(page) { return page.getByRole('list', { name:'Ordered steps' }).getByRole('listitem'); }
async function login(n, visible = true) {
  const {page} = await session(browser, n, email(n), settings.PASSWORD, evidence);
  page.setDefaultTimeout(20000);
  await page.goto(APP+'/automations',{waitUntil:'domcontentloaded',timeout:60000});
  if (visible) await button(page,'Create automation').waitFor();
  else await page.getByText('Automations are unavailable for this session.',{exact:true}).waitFor();
  return page;
}
async function start(page, name, trigger) {
  await button(page,'Create automation').click();
  await page.getByLabel('Automation name').fill(name);
  await button(page,'Choose trigger').click();
  await button(page.getByRole('dialog').and(page.locator('[data-state="open"]')),trigger).click();
}
async function add(page, index, type) {
  await button(rows(page).nth(index),'Add step').click();
  await button(page.getByRole('dialog').and(page.locator('[data-state="open"]')),type).click();
}
async function publish(page) {
  await button(page,'Review & publish').click();
  await button(page,'Publish').click();
  await page.getByRole('region',{name:'Workflow status',exact:true}).getByText('Version published.',{exact:true}).waitFor();
  return new URL(page.url()).searchParams.get('workflow');
}
function evidenceCount() {
  return sql(`select concat_ws(',',(select count(*) from private.automation_runs where organization_id='${agency}'),
    (select count(*) from private.automation_messages where organization_id='${agency}'))`);
}
function assertEmptyAgency() {
  const scoped = `where organization_id='${agency}'`;
  const counts = sql(`select row_to_json(a) from (select
    (select count(*) from public.workflows ${scoped}) as definitions,
    (select count(*) from public.workflows ${scoped} and status='active') as active,
    (select count(*) from public.workflow_versions ${scoped}) as versions,
    (select count(*) from public.workflow_executions ${scoped}) as legacy_runs,
    (select count(*) from public.workflow_execution_steps s join public.workflow_executions e
       on e.id=s.execution_id where e.organization_id='${agency}') as legacy_steps,
    (select count(*) from private.automation_runs ${scoped}) as runs,
    (select count(*) from private.automation_steps ${scoped}) as steps,
    (select count(*) from private.automation_intents ${scoped}) as intents,
    (select count(*) from private.automation_messages ${scoped}) as messages,
    (select count(*) from public.messages ${scoped} and automation_message_id is not null) as sms_history,
    (select count(*) from public.contact_emails ${scoped} and automation_message_id is not null) as email_history) a`);
  for (const [metric,count] of Object.entries(JSON.parse(counts))) assert.equal(count,0,metric);
}
try {
  const first = await login('one');
  await first.getByText('Your agency has no automations yet.').waitFor();
  assert.equal(await button(first,'Create automation').count(),1);
  assert.equal(sql(`select count(*) from private.automation_release_controls where enrollment_enabled or dispatch_enabled`),'0');
  const hidden = await login('other',false);
  assert.equal(await button(hidden,'Create automation').count(),0);
  assertEmptyAgency();
  await button(first,'Create automation').click();
  await button(first,'Choose trigger').waitFor();
  assert.equal(await first.getByLabel('Automation name').inputValue(),'');
  assert.equal(await rows(first).count(),0);
  await button(first,'Back to automations').click();
  await first.getByText('Your agency has no automations yet.').waitFor();
  assertEmptyAgency();
  console.log('PASS fresh pilot author opened and abandoned the blank canvas. Both controls off, second agency hidden, zero workflows, activations, versions, runs, steps, intents and messages.');

  // Enable the separate synthetic authoring and execution scenarios after the pilot check.
  visibility(otherAgency,'show');
  sql(`update private.automation_release_controls set enrollment_enabled=true where organization_id='${agency}'`);
  await start(first,'One UI action','New lead created');
  await add(first,0,'Send email');
  await first.getByLabel('Subject', {exact:true}).fill('First subject');
  await first.getByLabel('Message body').fill('Hello {{first_name}} from the first graph.');
  await first.getByLabel('Email sender').selectOption(sender);
  await button(first,'Save draft').click();
  await first.getByText('Draft saved.').waitFor();
  await first.reload();
  await rows(first).nth(1).waitFor();
  await button(first,'Preview').click();
  await first.getByLabel('First name',{exact:true}).fill('Alex');
  await first.getByLabel('Email',{exact:true}).fill('alex@example.invalid');
  assert.match(await first.getByRole('list',{name:'Preview results'}).innerText(),/Hello Alex/);
  assert.equal(evidenceCount(),'0,0');
  const immediate = await publish(first);
  assert.ok(immediate);
  const second = await login('two');
  await start(second,'Membership wait','Lead added to campaign');
  await second.getByRole('combobox',{name:/^Campaign/}).selectOption(campaign);
  await add(second,0,'Wait');
  await second.getByLabel('Duration').fill('2');
  await second.getByRole('combobox',{name:/^Unit/}).selectOption('minutes');
  await add(second,1,'Send SMS');
  await second.getByLabel('SMS purpose').selectOption('informational');
  await second.getByLabel('Message body').fill('Original for {{first_name}}');
  await button(second,'Preview').click();
  await second.getByLabel('First name',{exact:true}).fill('Blake');
  await second.getByLabel('Test campaign').selectOption(campaign);
  await second.getByLabel('Phone',{exact:true}).fill('+12025550124');
  assert.match(await second.getByRole('list',{name:'Preview results'}).innerText(),/Original for Blake/);
  assert.equal(evidenceCount(),'0,0');
  const delayed = await publish(second);
  assert.ok(delayed && delayed !== immediate);
  const other = await login('other');
  await other.getByText('Your agency has no automations yet.').waitFor();
  console.log('Two separate authors published one email-only graph and a campaign/wait/SMS graph. Preview made zero enrollments or handoffs; second agency is empty.');
  const run = await import('./exercise.mjs');
  await run.exercise({first, second, immediate, delayed});
} catch(error) {
  for (const c of browser.contexts()) for (const p of c.pages()) {
    console.error(new URL(p.url()).pathname,await p.locator('main').innerText({timeout:1000}).catch(()=>''));
  }
  console.error(evidence.sessions.map(s => ({label:s.label,errors:s.consoleErrors.slice(-3),api:s.net.httpErrors.filter(l=>l.includes('automation')).slice(-5)})));
  throw error;
} finally {
  await browser.close();
}
