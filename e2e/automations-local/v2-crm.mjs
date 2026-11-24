// Automations V2 CRM screens in a real browser, at 1440 px and 375 px in light and dark: a contact's timed
// automation task, Confirm issuance on a client's policy (tapped through from the policy row on a touch phone), and
// the Inbounds callback list, each for the pilot agency and for an agency outside the pilot. Run after
// v2-workflows.mjs, whose records it reads, on a server started with the Inbounds room build option on.
// Nothing here places a call, and nothing leaves the machine.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, session, restPointer, APP } from '../team-open-local/lib.mjs';
import { settings, sql, agency, otherAgency, email } from './fixture.mjs';
import { worker } from './work.mjs';
import { visibility } from './release-visibility.mjs';

const dir = process.env.AUTOMATION_UI_EVIDENCE || '/tmp/automation-ui-evidence';
const evidence = { sessions: [] };
const screenshots = [];
const browser = await launch();
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const count = query => Number(sql('select count(*) from ' + query));
const wide = { width: 1440, height: 1000 }, phone = { width: 375, height: 812 };

async function login(n, options = {}) {
  // Screenshots are for people, so they are taken at twice the pixel density.
  const { page } = await session(browser, 'crm ' + n + (options.hasTouch ? ' touch' : ''), email(n), settings.PASSWORD, evidence,
    { deviceScaleFactor: 2, ...options });
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
  // The pointer rests away from every control, and finite animations are completed first,
  // so a dialog is captured fully open and no button in its hover colour.
  await restPointer(page);
  await page.screenshot({ path: join(dir, file), animations: 'disabled' });
  screenshots.push(file);
}
/** How far a pilot agency's phone contact screen is panned from its first view (0 when there is none). */
const panned = page => page.evaluate(() => document.querySelector('[data-phone-pan]')?.scrollLeft ?? 0);
/** The phone contact screen is panned all the way to its details column. */
const atDetails = page => page.evaluate(() => {
  const surface = document.querySelector('[data-phone-pan]');
  return !!surface && surface.scrollLeft <= -(surface.scrollWidth - surface.clientWidth) + 1;
});
/** The control is wholly on screen as the page stands, before anything scrolls. */
async function onScreen(page, control, what) {
  const box = await control.boundingBox();
  const { width, height } = page.viewportSize();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 0.5 && box.y + box.height <= height + 0.5,
    what + ' is not inside the ' + width + ' px window: ' + JSON.stringify(box));
}
/** The control is wholly inside the window once scrolled to, and reaching it never pans the screen sideways. */
async function inside(page, control, what) {
  const before = await panned(page);
  await control.scrollIntoViewIfNeeded();
  assert.equal(await panned(page), before, what + ' could only be reached by panning the screen sideways');
  await onScreen(page, control, what);
}
/** The phone contact screen's sideways position once a fling has stopped moving it. */
async function settled(page) {
  let last = await panned(page);
  for (let wait = 0; wait < 30; wait++) {
    await page.waitForTimeout(100);
    const now = await panned(page);
    if (now === last) return now;
    last = now;
  }
  return last;
}
/** A finger drag through the browser's own touch input, in small steps. */
async function drag(page, from, to) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 8,
      y: from.y + (to.y - from.y) * step / 8 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
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

  // 1. A contact's timed automation task shows its date and time of day, with the Automation badge. On a phone the
  // contact screen opens on its right-hand view, so the right column with the Tasks tab is on screen without panning.
  const [lead, title] = sql(`select contact_id||'|'||title from public.tasks where organization_id='${agency}' and contact_type='lead'
    and automation_run_id is not null and not all_day and completed_at is null order by created_at limit 1`).split('|');
  assert.ok(lead && title, 'v2-workflows.mjs leaves an open timed automation task on a lead');
  for (const size of [wide, phone]) for (const tone of tones) {
    await open(page, '/leads/' + lead, tone, size);
    await page.getByText('First Name', { exact: true }).waitFor();
    if (size === phone) {
      assert.equal(await panned(page), 0, 'The phone contact screen opens on its first view');
      await onScreen(page, button(page, 'Tasks'), 'The Tasks tab on the first view');
    }
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

  // 2. Confirm issuance on the client's own page: one policy already issued, the other offered for confirmation.
  // On a desktop the policies sit in the left column. On a phone, for an agency in the pilot, the contact screen opens
  // on the same right-hand view as before, with Call and Schedule; the agent drags it sideways with a finger to the
  // details column, taps the policy row, then taps Confirm issuance.
  const client = sql(`select id from public.clients where organization_id='${agency}' and first_name='Pat' and last_name='Holder'
    order by created_at desc limit 1`);
  assert.ok(client, 'v2-workflows.mjs leaves a client with two policies');
  const confirmations = count(`public.policy_issuance_confirmations where organization_id='${agency}'`);
  const policyRows = view => view.getByRole('region', { name: 'Policies', exact: true }).locator('button[aria-expanded]');
  for (const tone of tones) {
    await open(page, '/clients/' + client, tone, wide);
    await page.getByText('First Name', { exact: true }).waitFor();
    // Each policy is a collapsed row. Issuance shows inside it.
    const rows = policyRows(page);
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
    assert.match(await dialog.getByLabel('Issue date', { exact: true }).inputValue(), /^\d{4}-\d{2}-\d{2}$/, 'The issue date starts as today');
    await inside(page, dialog, 'The Confirm issuance dialog');
    await shot(page, 'confirm-issuance');
    await button(dialog, 'Cancel').click();
    await dialog.waitFor({ state: 'hidden' });
  }
  assert.equal(count(`public.policy_issuance_confirmations where organization_id='${agency}'`), confirmations,
    'Opening and cancelling the dialog confirms nothing');
  // A touch phone. Dark first, cancelled; then light, confirmed for real through the same taps.
  const touch = await login('one', { viewport: phone, hasTouch: true, isMobile: true });
  for (const tone of ['dark', 'light']) {
    await open(touch, '/clients/' + client, tone, phone);
    await touch.getByText('First Name', { exact: true }).waitFor();
    await touch.locator('[data-phone-pan]').waitFor();
    assert.equal(await panned(touch), 0, 'The client page opens on its first view');
    await onScreen(touch, button(touch, 'Call'), 'Call on the first view');
    await onScreen(touch, button(touch, 'Schedule'), 'Schedule on the first view');
    await shot(touch, 'client-first-view');
    // Drag with a finger until the details column is in view, letting each fling settle before the next drag. (A drag
    // begun with the surface already at its end is taken by desktop Chromium as swipe-to-go-back, which phones lack.)
    const where = touch.url();
    for (let drags = 0; drags < 8 && !await atDetails(touch); drags++) {
      await drag(touch, { x: 150, y: 420 }, { x: 350, y: 420 });
      await settled(touch);
    }
    assert.ok(await atDetails(touch), 'Dragging with a finger brings the details column into view');
    assert.equal(touch.url(), where, 'Panning stayed on the client page');
    const rows = policyRows(touch);
    await rows.first().waitFor();
    // From here only the details column scrolls, downwards. Every tap below happens without another sideways pan.
    await inside(touch, rows.nth(1), 'The second policy row');
    await shot(touch, 'client-policies');
    if (await rows.nth(1).getAttribute('aria-expanded') !== 'true') await rows.nth(1).tap();
    const start = button(touch, 'Confirm issuance');
    await start.waitFor();
    await inside(touch, start, 'Confirm issuance on a phone');
    await start.tap();
    const dialog = touch.getByRole('dialog', { name: 'Confirm policy issuance' });
    await dialog.waitFor();
    const date = dialog.getByLabel('Issue date', { exact: true });
    assert.match(await date.inputValue(), /^\d{4}-\d{2}-\d{2}$/, 'The issue date starts as today');
    await inside(touch, dialog, 'The Confirm issuance dialog on a phone');
    await noSideScroll(touch, 'The client page with the dialog open');
    await shot(touch, 'confirm-issuance');
    if (tone === 'dark') {
      await button(dialog, 'Cancel').tap();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(count(`public.policy_issuance_confirmations where organization_id='${agency}'`), confirmations,
        'Cancelling on the phone confirms nothing');
      continue;
    }
    // The form is checked in the browser before anything is sent, then the confirmation is saved.
    await date.fill('');
    await button(dialog, 'Confirm issuance').tap();
    await dialog.getByRole('alert').getByText('Enter the date the policy was issued.', { exact: true }).waitFor();
    const issuedOn = await date.getAttribute('max');
    await date.fill(issuedOn);
    await button(dialog, 'Confirm issuance').tap();
    await dialog.waitFor({ state: 'hidden' });
    await touch.getByText(/confirmed by Tester one/).first().waitFor();
    // The other policy's row is still folded on the phone. Open it to see both say Issued.
    if (await rows.nth(0).getAttribute('aria-expanded') !== 'true') await rows.nth(0).tap();
    await touch.getByText('Issued', { exact: true }).nth(1).waitFor();
    assert.equal(await button(touch, 'Confirm issuance').count(), 0, 'Both policies now show as issued');
    assert.equal(count(`public.policy_issuance_confirmations where organization_id='${agency}' and client_id='${client}'
      and issued_on='${issuedOn}' and confirmed_by=(select id from public.profiles where email='${email('one')}')`), 1,
      'The phone confirmation was saved once, with its date and the agent who confirmed it');
  }

  // 2b. An agency outside the Automations pilot has no issuance at all: no control on its client's page and a refused
  // server write, through the same sale writer and the same requests the app makes. builder.mjs showed the second
  // agency's builder for its two-author scenario, so it is hidden again first with the same operator tool.
  sql(`update private.automation_release_controls set enrollment_enabled=false,dispatch_enabled=false where organization_id='${otherAgency}'`);
  visibility(otherAgency, 'hide');
  assert.equal(sql(`select coalesce(bool_or(builder_visible or enrollment_enabled or dispatch_enabled),false)
    from private.automation_release_controls where organization_id='${otherAgency}'`), 'f', 'The second agency is outside the pilot');
  assert.equal(sql(`select builder_visible from private.automation_release_controls where organization_id='${agency}'`), 't',
    'The first agency stays in the pilot');
  sql(`insert into public.company_settings(company_name,organization_id,timezone) values ('Automation UI B','${otherAgency}','America/Chicago')
    on conflict do nothing`);
  const outsider = await login('other');
  const today = sql(`select (now() at time zone 'America/Chicago')::date`);
  const outsideOwner = sql(`select id from public.profiles where email='${email('other')}'`);
  const sale = await rpc(outsider, 'create_client_with_sale', { p_request_id: randomUUID(), p_expected_org: otherAgency, p_record_sale: true,
    p_client: { first_name: 'Quinn', last_name: 'Outside', assigned_agent_id: outsideOwner, policy_type: 'Term', carrier: 'Fixture Life',
      premium: 60, sold_date: today, payment_frequency: 'monthly' } });
  assert.ok(sale.status >= 200 && sale.status < 300 && sale.body?.client_id, 'Recording the outside sale failed: ' + JSON.stringify(sale));
  const outsideClient = sale.body.client_id;
  const outsidePolicy = sql(`select primary_policy_id from public.clients where id='${outsideClient}'`);
  assert.match(outsidePolicy, /^[\da-f-]{36}$/, 'The outside sale stored a policy');
  for (const size of [wide, phone]) {
    const listed = outsider.waitForResponse(response => response.url().includes('/rpc/get_policy_issuance'));
    const pilot = outsider.waitForResponse(response => response.url().includes('/rpc/policy_issuance_available'));
    await open(outsider, '/clients/' + outsideClient, 'light', size);
    await outsider.getByText('First Name', { exact: true }).waitFor();
    const answer = await listed;
    assert.deepEqual(await answer.json(), [], 'An agency outside the pilot is given no issuance list');
    assert.equal(await (await pilot).json(), false, 'and is told issuance is not available to it');
    assert.equal(await button(outsider, 'Confirm issuance').count(), 0, 'and is offered no Confirm issuance');
    assert.equal(await outsider.getByText('Issued', { exact: true }).count(), 0);
    if (size === phone) {
      // Outside the pilot the phone contact screen keeps its production layout: no sideways surface, Call and Schedule
      // on screen as before.
      assert.equal(await outsider.locator('[data-phone-pan]').count(), 0, 'An agency outside the pilot keeps its phone layout');
      await onScreen(outsider, button(outsider, 'Call'), 'Call outside the pilot');
      await onScreen(outsider, button(outsider, 'Schedule'), 'Schedule outside the pilot');
      await shot(outsider, 'outside-pilot-client');
    }
  }
  const refused = await rpc(outsider, 'confirm_policy_issuance', { p_request_id: randomUUID(), p_policy_id: outsidePolicy, p_issued_on: today });
  assert.equal(refused.status, 403, 'The server refuses an outside confirmation: ' + JSON.stringify(refused));
  assert.equal(refused.body?.message, 'Issuance confirmation is not available for this agency');
  assert.equal(count(`public.policy_issuance_confirmations where organization_id='${otherAgency}'`), 0, 'Nothing was saved for it');

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
    // Centre the whole Callbacks card, with its note and footer, instead of leaving Claim on the bottom edge.
    await list.evaluate(element => element.scrollIntoView({ block: 'center' }));
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
  // The same room for an agency outside the pilot: the list's own request says it is not available, and no list shows.
  sql(`update public.organizations set twilio_subaccount_status='active' where id='${otherAgency}'`);
  for (const size of [wide, phone]) {
    // The room itself loads for the outside agency, and the list asks the server, which says it has none.
    const roomState = outsider.waitForResponse(response => response.url().includes('/rpc/inbounds_room_state'));
    const queued = outsider.waitForResponse(response => response.url().includes('/rpc/inbound_callback_queue'));
    await open(outsider, '/inbounds', 'light', size);
    assert.equal((await roomState).status(), 200, 'The outside agency can open its Inbounds room');
    const queue = await (await queued).json();
    assert.equal(queue.available, false, 'The outside agency is told it has no callback list');
    assert.deepEqual(queue.items, []);
    await outsider.waitForTimeout(500);
    assert.equal(await outsider.getByRole('region', { name: /^Callbacks/ }).count(), 0, 'Its room shows no Callbacks section');
  }
  const outsideClaim = await rpc(outsider, 'claim_inbound_callback', { p_callback: randomUUID() });
  assert.equal(outsideClaim.status, 403, 'Claiming outside the pilot is refused: ' + JSON.stringify(outsideClaim));

  // Nothing tried to leave the machine except the app's font stylesheet, which the harness blocks.
  const blocked = [...new Set(evidence.sessions.flatMap(item => item.net.blocked))];
  assert.deepEqual(blocked.filter(url => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)), []);
  writeFileSync(join(dir, 'automations-v2-crm.json'), JSON.stringify({ result: 'pass', viewports: [1440, 375], themes: tones,
    phoneTouch: { firstView: ['Call', 'Schedule', 'Tasks'], fingerPanToPolicies: true, tapsWithoutSidewaysPan: true },
    outsidePilot: { issuanceList: [], confirmation: 403, callbacksAvailable: false, phoneLayout: 'unchanged' }, screenshots,
    blockedOutsideRequests: blocked }, null, 2) + '\n');
  console.log('PASS CRM screens: a timed automation task, Confirm issuance on a 375 px touch phone (the client page opened with ' +
    'Call and Schedule on screen, a finger drag reached the policies, the policy row and Confirm issuance were tapped without ' +
    'another sideways pan, and the confirmation saved once), and the Inbounds callback list, at 1440 px and 375 px in both ' +
    'themes; cancelling confirmed nothing, a callback was claimed and finished without a call, and an agency outside the pilot ' +
    'had no issuance control, a refused confirmation, its phone contact layout unchanged and no callback list. ' +
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
