// Automations V2 CRM screens in a real browser, at 1440 px and 375 px in light and dark: a contact's timed
// automation task, Confirm issuance on a client's policy, and the Inbounds callback list. Run after
// v2-workflows.mjs, whose records it reads, on a server started with the Inbounds room build option on.
// Nothing here places a call, and nothing leaves the machine.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, session, APP } from '../team-open-local/lib.mjs';
import { settings, sql, agency, email } from './fixture.mjs';
import { worker } from './work.mjs';

const dir = process.env.AUTOMATION_UI_EVIDENCE || '/tmp/automation-ui-evidence';
const evidence = { sessions: [] };
const screenshots = [];
const browser = await launch();
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const count = query => Number(sql('select count(*) from ' + query));
const wide = { width: 1440, height: 1000 }, phone = { width: 375, height: 812 };

async function login(n) {
  // Screenshots are for people, so they are taken at twice the pixel density.
  const { page } = await session(browser, 'crm ' + n, email(n), settings.PASSWORD, evidence, { deviceScaleFactor: 2 });
  page.setDefaultTimeout(20000);
  return page;
}
/** Open a page in one theme. The theme is the app's own stored preference, read when the page loads. */
async function open(page, path, tone, size) {
  await page.setViewportSize(size);
  await page.evaluate(value => localStorage.setItem('agentflow-theme', value), tone);
  await page.goto(APP + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, tone === 'dark');
}
async function shot(page, name) {
  const width = page.viewportSize().width;
  const dark = await page.locator('html').evaluate(element => element.classList.contains('dark'));
  const file = `automations-v2-${name}-${width}-${dark ? 'dark' : 'light'}.png`;
  // Finite animations are completed first, so a dialog is captured fully open.
  await page.screenshot({ path: join(dir, file), animations: 'disabled' });
  screenshots.push(file);
}
/** The control is wholly inside the window, so nobody has to scroll sideways to reach it. */
async function inside(page, control, what) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  const { width, height } = page.viewportSize();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 0.5 && box.y + box.height <= height + 0.5,
    what + ' is not inside the ' + width + ' px window: ' + JSON.stringify(box));
}
/** The page itself never scrolls sideways. */
async function noSideScroll(page, what) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(extra <= 0, what + ' is wider than the window by ' + extra + ' px');
}
/** The same request the signed-in app makes, with the user's own token. */
async function rpc(page, name, args) {
  return page.evaluate(async ({ url, key, name, args }) => {
    const entry = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const token = JSON.parse(localStorage.getItem(entry)).access_token;
    const response = await fetch(url + '/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(args),
      headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { url: settings.API_URL, key: settings.ANON_KEY, name, args });
}
/** The telephony webhook's own database call, with the service credential it uses. */
async function service(name, args) {
  const response = await fetch(settings.API_URL + '/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(args),
    headers: { apikey: settings.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + settings.SERVICE_ROLE_KEY, 'Content-Type': 'application/json' } });
  assert.ok(response.ok, name + ' failed: ' + await response.text());
}

try {
  const page = await login('one');
  const tones = ['light', 'dark'];

  // 1. A contact's timed automation task shows its date and time of day, with the Automation badge. The contact
  // screen is a fixed desktop layout anchored to the right edge, so on a phone its right column, with the Tasks tab,
  // is the part on screen.
  const [lead, title] = sql(`select contact_id||'|'||title from public.tasks where organization_id='${agency}' and contact_type='lead'
    and automation_run_id is not null and not all_day and completed_at is null order by created_at limit 1`).split('|');
  assert.ok(lead && title, 'v2-workflows.mjs leaves an open timed automation task on a lead');
  for (const size of [wide, phone]) for (const tone of tones) {
    await open(page, '/leads/' + lead, tone, size);
    await page.getByText('First Name', { exact: true }).waitFor();
    await button(page, 'Tasks').click();
    const done = page.getByRole('checkbox', { name: 'Mark “' + title + '” complete' });
    await done.waitFor();
    const row = done.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
    const text = await row.innerText();
    assert.match(text, /Automation/, 'The task is marked as created by an automation');
    assert.match(text, /\d{1,2}:\d{2}\s?(AM|PM|am|pm)?/, 'A timed task shows its time of day: ' + text);
    assert.equal(await row.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'The task row never overflows its card');
    await inside(page, row, 'The task row');
    await shot(page, 'contact-tasks');
  }

  // 2. Confirm issuance on a client's policy: one policy already issued, the other offered for confirmation.
  // On a phone the policies column is the part of the contact screen pushed off the left edge, so the dialog is
  // opened on the desktop layout and the window is then narrowed: the dialog itself must still fit a phone.
  const client = sql(`select id from public.clients where organization_id='${agency}' and first_name='Pat' and last_name='Holder'
    order by created_at desc limit 1`);
  assert.ok(client, 'v2-workflows.mjs leaves a client with two policies');
  const confirmations = count(`public.policy_issuance_confirmations where organization_id='${agency}'`);
  for (const size of [wide, phone]) for (const tone of tones) {
    await open(page, '/clients/' + client, tone, wide);
    await page.getByText('First Name', { exact: true }).waitFor();
    // Each policy is a collapsed row. Issuance shows inside it.
    const rows = page.getByRole('region', { name: 'Policies', exact: true }).locator('button[aria-expanded]');
    await rows.first().waitFor();
    assert.equal(await rows.count(), 2);
    for (let index = 0; index < 2; index++) {
      if (await rows.nth(index).getAttribute('aria-expanded') !== 'true') await rows.nth(index).click();
    }
    const start = button(page, 'Confirm issuance');
    await start.waitFor();
    assert.equal(await start.count(), 1, 'Only the policy that is not yet issued offers Confirm issuance');
    await page.getByText('Issued', { exact: true }).waitFor();
    await inside(page, start, 'Confirm issuance');
    await start.click();
    const dialog = page.getByRole('dialog', { name: 'Confirm policy issuance' });
    await dialog.waitFor();
    if (size === phone) await page.setViewportSize(phone);
    const date = dialog.getByLabel('Issue date', { exact: true });
    assert.match(await date.inputValue(), /^\d{4}-\d{2}-\d{2}$/, 'The issue date starts as today');
    await inside(page, dialog, 'The Confirm issuance dialog');
    if (size === phone && tone === 'light') {
      // The form is checked in the browser before anything is sent.
      await date.fill('');
      await button(dialog, 'Confirm issuance').click();
      await dialog.getByRole('alert').getByText('Enter the date the policy was issued.', { exact: true }).waitFor();
      await date.fill(await date.getAttribute('max'));
    }
    await shot(page, 'confirm-issuance');
    await button(dialog, 'Cancel').click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(count(`public.policy_issuance_confirmations where organization_id='${agency}'`), confirmations,
      'Opening and cancelling the dialog confirms nothing');
  }

  // 3. The Inbounds callback list. A missed call from an unknown number becomes one open callback.
  const flow = sql(`select id from public.workflows where organization_id='${agency}' and name='V2 Missed call callback'`);
  assert.match(flow, /^[\da-f-]{36}$/);
  if (sql(`select status from public.workflows where id='${flow}'`) === 'paused') {
    // The same request the Resume button sends.
    const context = (await rpc(page, 'automation_session_context', {})).body;
    const resumed = await rpc(page, 'automation_lifecycle', { p_workflow_id: flow, p_operation: 'resume', p_session_revision: context.revision });
    assert.ok(resumed.status >= 200 && resumed.status < 300, 'Resuming failed: ' + JSON.stringify(resumed));
    assert.equal(sql(`select status from public.workflows where id='${flow}'`), 'active');
  }
  const call = randomUUID(), caller = '+12025559913';
  sql(`insert into public.calls(id,organization_id,direction,status,twilio_call_sid,contact_phone,caller_id_used)
    values ('${call}','${agency}','inbound','ringing','CA${randomUUID().replace(/-/g, '')}','${caller}','+12025550181')`);
  await service('finalize_inbound_call_terminal', { p_call_row_id: call, p_org_id: agency, p_status: 'no-answer', p_mark_missed: true, p_external_answer: false });
  sql(`update private.automation_events set available_at=now()-interval '1 second' where organization_id='${agency}' and event_type='inbound_call_missed' and processed_at is null`);
  for (let turn = 0; turn < 4 && !count(`public.inbound_callbacks where call_id='${call}'`); turn++) worker();
  assert.equal(sql(`select status from public.inbound_callbacks where call_id='${call}'`), 'open');
  const claim = 'Claim callback for ' + caller;
  for (const size of [wide, phone]) for (const tone of tones) {
    await open(page, '/inbounds', tone, size);
    const list = page.getByRole('region', { name: /^Callbacks/ });
    await button(list, claim).waitFor();
    await noSideScroll(page, 'Inbounds');
    await inside(page, button(list, claim), 'Claim');
    await shot(page, 'inbounds-callbacks');
  }
  // Claim and finish it from the phone layout. The list never places a call.
  const calls = count(`public.calls where organization_id='${agency}'`);
  const list = page.getByRole('region', { name: /^Callbacks/ });
  await button(list, claim).click();
  await list.getByText('Claimed by you', { exact: true }).waitFor();
  await button(list, 'Done with callback for ' + caller).click();
  await button(list, 'Done with callback for ' + caller).waitFor({ state: 'detached' });
  assert.equal(sql(`select status from public.inbound_callbacks where call_id='${call}'`), 'done');
  assert.equal(count(`public.calls where organization_id='${agency}'`), calls, 'Claiming and finishing a callback places no call');

  // Nothing tried to leave the machine except the app's font stylesheet, which the harness blocks.
  const blocked = [...new Set(evidence.sessions.flatMap(item => item.net.blocked))];
  assert.deepEqual(blocked.filter(url => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)), []);
  writeFileSync(join(dir, 'automations-v2-crm.json'), JSON.stringify({ result: 'pass', viewports: [1440, 375], themes: tones,
    screenshots, blockedOutsideRequests: blocked }, null, 2) + '\n');
  console.log('PASS CRM screens: a timed automation task, the Confirm issuance dialog and the Inbounds callback list at 1440 px and 375 px ' +
    'in both themes; cancelling confirmed nothing, and a callback was claimed and finished without a call. ' +
    screenshots.length + ' screenshots.');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: join(dir, 'automations-v2-crm-failure.png') }).catch(() => {});
    console.error(new URL(page.url()).pathname, (await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')).slice(-900));
  }
  console.error(evidence.sessions.map(item => ({ label: item.label, errors: item.consoleErrors.slice(-3), api: item.net.httpErrors.slice(-6) })));
  throw error;
} finally {
  await browser.close();
}
