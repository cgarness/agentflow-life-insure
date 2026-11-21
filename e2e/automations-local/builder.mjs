import assert from 'node:assert/strict';
import { launch, session, APP } from '../team-open-local/lib.mjs';
import { settings, sql, agency, campaign, sender, email } from './fixture.mjs';

const evidence = { sessions: [] };
const browser = await launch();
const button = (page, name) => page.getByRole('button', { name, exact: true });
function rows(page) { return page.getByRole('list', { name:'Ordered steps' }).getByRole('listitem'); }
async function login(n) {
  const {page} = await session(browser, n, email(n), settings.PASSWORD, evidence);
  page.setDefaultTimeout(20000);
  await page.goto(APP+'/automations',{waitUntil:'domcontentloaded',timeout:60000});
  await button(page,'Create automation').waitFor();
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
try {
  const first = await login('one');
  await first.getByText('Your agency has no automations yet.').waitFor();
  assert.equal(await button(first,'Create automation').count(),1);
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
