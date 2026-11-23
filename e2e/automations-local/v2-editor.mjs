// Automations V2 editor acceptance against the loopback-only signed-in CRM fixture: the add-step picker,
// the direct message editor, saved messages, Insert field, step details, the three explicit saves,
// historical step names, concurrent edits, tenant isolation, and both layouts in both themes.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { launch, session, restPointer, APP } from '../team-open-local/lib.mjs';
import { settings, sql, agency, sender, email, listView } from './fixture.mjs';
import { worker } from './work.mjs';

const dir = process.env.AUTOMATION_UI_EVIDENCE || '/tmp/automation-ui-evidence';
mkdirSync(dir, { recursive: true });
const evidence = { sessions: [] };
const screenshots = [];
const browser = await launch();
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const rows = page => page.getByRole('list', { name: 'Ordered steps' }).getByRole('listitem');
const picker = page => page.getByRole('dialog').and(page.locator('[data-state="open"]'));
const field = (page, label) => page.getByLabel(label, { exact: true });
const count = query => Number(sql('select count(*) from ' + query));
const notice = 'ba921000-0000-4000-8000-000000000060';
// A name of its own, so the script can be run again against the same disposable database.
const title = 'V2 editor check ' + randomUUID().slice(0, 8);

async function login(n) {
  // Screenshots are for people, so they are taken at twice the pixel density.
  const { page, net } = await session(browser, 'editor ' + n, email(n), settings.PASSWORD, evidence, { deviceScaleFactor: 2 });
  page.setDefaultTimeout(20000);
  return { page, net };
}
async function add(page, index, type) {
  await button(rows(page).nth(index), 'Add step').click();
  await button(picker(page), type).click();
}
async function insertMenu(page, label) {
  const id = await page.locator('label', { hasText: new RegExp('^' + label + '$') }).getAttribute('id');
  return page.locator('button[aria-describedby="' + id + '"]');
}
async function insert(page, label, name) {
  await (await insertMenu(page, label)).click();
  await button(page.getByRole('dialog', { name: 'Insert field' }), name).click();
  await page.getByRole('dialog', { name: 'Insert field' }).waitFor({ state: 'hidden' });
}
/** Put the cursor, or a selection, where an author would have left it. */
async function caret(control, start, end = start) {
  await control.focus();
  await control.evaluate((element, range) => element.setSelectionRange(range[0], range[1]), [start, end]);
  await control.dispatchEvent('keyup');
}
const focused = control => control.evaluate(element => document.activeElement === element);
async function useSaved(page, name) {
  await button(page, 'Use saved message').click();
  await button(page.getByRole('dialog', { name: 'Saved messages' }), name).click();
}
async function theme(page, wanted) {
  const dark = await page.locator('html').evaluate(element => element.classList.contains('dark'));
  if ((wanted === 'dark') === dark) return;
  const menu = page.getByRole('button', { name: /Account menu/ });
  await menu.click();
  await button(page, wanted === 'dark' ? 'Dark mode' : 'Light mode').click();
  await menu.click();
  await page.waitForFunction(expected => document.documentElement.classList.contains('dark') === expected, wanted === 'dark');
}
/** `fullPage` captures the whole page, for screens taller than the window; sheets and dialogs are captured as seen. */
async function shot(page, name, { fullPage = false } = {}) {
  const width = page.viewportSize().width;
  const dark = await page.locator('html').evaluate(element => element.classList.contains('dark'));
  const file = `automations-v2-${name}-${width}-${dark ? 'dark' : 'light'}.png`;
  // The pointer rests away from every control, and finite animations are completed first,
  // so a sheet or menu is captured fully open and no button in its hover colour.
  await restPointer(page);
  // A whole-page capture draws the fixed sidebar and header where the window is scrolled, so start at the top.
  if (fullPage) await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(dir, file), animations: 'disabled', fullPage });
  screenshots.push(file);
}

try {
  const { page, net } = await login('one');
  const owner = sql(`select id from profiles where email='${email('one')}'`);
  sql(`update public.workflows set status='paused' where organization_id='${agency}' and status='active';
    update private.automation_release_controls set enrollment_enabled=true,dispatch_enabled=true where organization_id='${agency}';
    insert into public.lead_sources(organization_id,name,active) select '${agency}','Editor check',true
      where not exists (select from public.lead_sources where organization_id='${agency}' and name='Editor check');
    insert into public.message_templates(id,organization_id,name,type,scope,subject,content,sms_purpose,created_by) values
      ('${notice}','${agency}','Appointment notice','sms','agency',null,'Hi {{contact_first_name}}, your appointment is confirmed.','informational','${owner}'),
      ('ba921000-0000-4000-8000-000000000061','${agency}','Agent introduction','sms','agency',null,'This is {{agent_name}} from the agency.','informational','${owner}'),
      ('ba921000-0000-4000-8000-000000000062','${agency}','Welcome email','email','agency','Welcome {{contact_first_name}}','Glad to have you, {{contact_first_name}}.',null,'${owner}')
      on conflict (id) do update set content=excluded.content,subject=excluded.subject,sms_purpose=excluded.sms_purpose;`);

  // 1. One Create button. A blank canvas offers only triggers, with search, and leaving it writes nothing.
  await page.goto(APP + '/automations', { waitUntil: 'domcontentloaded' });
  await button(page, 'Create automation').waitFor();
  assert.equal(await button(page, 'Create automation').count(), 1);
  const before = count(`public.workflows where organization_id='${agency}'`);
  await button(page, 'Create automation').click();
  await page.getByText('Start with a trigger').waitFor();
  await page.getByLabel('Automation canvas').waitFor();
  await button(page, 'Choose trigger').click();
  const triggers = picker(page);
  assert.deepEqual(await triggers.getByRole('group').evaluateAll(groups => groups.map(group => group.getAttribute('aria-labelledby') && document.getElementById(group.getAttribute('aria-labelledby')).textContent)), ['Triggers']);
  assert.equal(await triggers.locator('button[data-choice]').count(), 8);
  await triggers.getByRole('searchbox').fill('missed call');
  assert.deepEqual(await triggers.locator('button[data-choice]').evaluateAll(choices => choices.map(choice => choice.getAttribute('aria-labelledby') && document.getElementById(choice.getAttribute('aria-labelledby')).textContent)), ['Inbound call missed']);
  await triggers.getByRole('searchbox').fill('sale');
  await button(triggers, 'Sale recorded').click();
  await listView(page);
  await button(rows(page).nth(0), 'Add step').click();
  const steps = picker(page);
  // A sale's contact is a client, so only steps that work for a client are offered.
  assert.deepEqual(await steps.locator('button[data-choice]').evaluateAll(choices => choices.map(choice => document.getElementById(choice.getAttribute('aria-labelledby')).textContent)),
    ['Create task for assigned agent', 'Wait']);
  await page.keyboard.press('Escape');
  await button(page, 'Back to automations').click();
  await button(page.getByRole('alertdialog'), 'Leave without saving').click();
  await button(page, 'Create automation').waitFor();
  assert.equal(count(`public.workflows where organization_id='${agency}'`), before);
  assert.equal(net.requests.filter(request => /rpc\/(save_automation_draft|publish_automation)/.test(request)).length, 0);
  console.log('PASS picker and blank canvas: only valid choices are offered, search narrows them, and opening then leaving wrote nothing.');

  // 2. The message editor opens on the wording. Saved messages and fields are optional helpers.
  await button(page, 'Create automation').click();
  await field(page, 'Automation name').fill(title);
  await button(page, 'Choose trigger').click();
  await button(picker(page), 'New lead created').click();
  await field(page, 'Lead source').selectOption('Editor check');
  await listView(page);
  await add(page, 0, 'Send SMS');
  const message = field(page, 'Message');
  await message.waitFor();
  for (const gone of ['Agency template', 'Write my own', 'SMS purpose', 'Message purpose']) assert.equal(await page.getByText(gone, { exact: true }).count(), 0, gone);
  await message.pressSequentially('Typed straight away');
  assert.equal(await message.inputValue(), 'Typed straight away');
  // Choosing a saved message over existing wording asks first.
  await useSaved(page, 'Appointment notice');
  const replace = page.getByRole('alertdialog', { name: 'Replace your message?' });
  await button(replace, 'Keep my message').click();
  assert.equal(await message.inputValue(), 'Typed straight away');
  await useSaved(page, 'Appointment notice');
  await button(replace, 'Replace message').click();
  assert.equal(await message.inputValue(), 'Hi {{first_name}}, your appointment is confirmed.');
  await page.getByText('Started from “Appointment notice”').waitFor();
  // A saved message that needs a field automations cannot fill is shown but cannot be chosen.
  await button(page, 'Use saved message').click();
  const unusable = button(page.getByRole('dialog', { name: 'Saved messages' }), 'Agent introduction');
  assert.equal(await unusable.isDisabled(), true);
  await page.getByText(/Uses fields automations can't fill/).waitFor();
  await page.keyboard.press('Escape');

  // A second text step: hand-written wording with fields inserted where the cursor is.
  await add(page, 1, 'Send SMS');
  await message.fill('Hello , welcome');
  await caret(message, 6);
  await insert(page, 'Message', 'First name');
  assert.equal(await message.inputValue(), 'Hello {{first_name}}, welcome');
  await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
  assert.equal(await focused(message), true, 'Focus returns to the field after an insertion');
  assert.equal(await message.evaluate(element => element.selectionStart), 'Hello {{first_name}}'.length);
  await insert(page, 'Message', 'Last name');
  assert.equal(await message.inputValue(), 'Hello {{first_name}}{{last_name}}, welcome');
  await caret(message, await message.evaluate(element => element.value.indexOf('welcome')), await message.evaluate(element => element.value.length));
  await insert(page, 'Message', 'Phone number');
  assert.equal(await message.inputValue(), 'Hello {{first_name}}{{last_name}}, {{phone}}');
  // The same from the keyboard: open the menu, move down one field, choose it.
  await message.fill('Reach me at ');
  await caret(message, 12);
  const menuButton = await insertMenu(page, 'Message');
  await menuButton.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('dialog', { name: 'Insert field' });
  await menu.waitFor();
  assert.deepEqual(await menu.getByRole('button').allInnerTexts().then(items => items.map(item => item.split('\n')[0])),
    ['First name', 'Last name', 'Email address', 'Phone number'], 'Appointment fields are not offered without an appointment trigger');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await message.inputValue(), 'Reach me at {{phone}}');
  // A field automations cannot fill is reported with what to do about it. Save & review still keeps the
  // draft, says plainly that it cannot be published yet, and publishes nothing.
  await message.fill('From {{agent_name}}');
  await button(page, 'Save & review').click();
  await page.getByText(/Message uses a field automations can't fill: .*Remove it or choose one from Insert field\./).first().waitFor();
  await page.getByText('Draft saved. Fix the highlighted steps before publishing.', { exact: true }).waitFor();
  assert.equal(count(`public.workflows where organization_id='${agency}' and automation_draft_name='${title}'
    and status='draft' and automation_version_id is null`), 1, 'The incomplete draft is saved and nothing is published');
  await message.fill('Hello {{first_name}}, welcome to the agency.');
  await button(page, 'Step details').click();
  await field(page, 'Step name').fill('Welcome text');
  await field(page, 'Description').fill('Sent to every new lead from the Editor check source.');
  await button(rows(page).nth(2), 'Welcome text').waitFor();
  assert.match(await rows(page).nth(2).innerText(), /Send SMS · Hello \{\{first_name\}\}/);
  await shot(page, 'message-editor', { fullPage: true });

  // An email step: Subject and Message, each with its own Insert field, starting from a saved email.
  await add(page, 2, 'Send email');
  await field(page, 'Email sender').selectOption(sender);
  await useSaved(page, 'Welcome email');
  assert.equal(await field(page, 'Subject').inputValue(), 'Welcome {{first_name}}');
  assert.equal(await message.inputValue(), 'Glad to have you, {{first_name}}.');
  await caret(field(page, 'Subject'), 7);
  await insert(page, 'Subject', 'Last name');
  assert.equal(await field(page, 'Subject').inputValue(), 'Welcome{{last_name}} {{first_name}}');
  await field(page, 'Subject').fill('Welcome {{first_name}} {{last_name}}');
  await button(page, 'Preview').click();
  await field(page, 'First name').fill('Jordan');
  await page.getByLabel('Last name', { exact: true }).fill('Lee');
  await field(page, 'Email').fill('jordan@example.invalid');
  await field(page, 'Lead source').fill('Editor check');
  await field(page, 'Phone').fill('+12025550124');
  await page.getByText('Welcome Jordan Lee').first().waitFor();
  assert.match(await page.getByRole('list', { name: 'Preview results' }).innerText(), /Welcome Jordan Lee[\s\S]*Glad to have you, Jordan\./);
  assert.equal(count(`private.automation_runs where organization_id='${agency}' and started_at>now()-interval '5 seconds'`), 0, 'A preview enrolls nobody');
  console.log('PASS message editor: direct wording, saved messages with replacement protection, fields at the cursor by mouse and keyboard, an actionable unsupported-field error and a rendered email subject.');

  // 3. Three explicit saves with three different results.
  await button(page, 'Edit draft').click();
  await button(page, 'Save draft').click();
  await page.getByText('Draft saved.').waitFor();
  await page.getByText('All changes saved').waitFor();
  const id = new URL(page.url()).searchParams.get('workflow');
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal(sql(`select status||'|'||(select count(*) from public.workflow_versions where workflow_id='${id}') from public.workflows where id='${id}'`), 'draft|0');
  const stepIds = sql(`select string_agg(node.value->>'id',',' order by node.ordinality) from public.workflows w, jsonb_array_elements(w.automation_graph->'nodes') with ordinality node where w.id='${id}'`);
  assert.equal(sql(`select automation_graph#>>'{nodes,2,meta,name}'||'|'||(automation_graph#>'{nodes,2,config}' ? 'name') from public.workflows where id='${id}'`), 'Welcome text|false');
  assert.equal(sql(`select content from public.message_templates where id='${notice}'`), 'Hi {{contact_first_name}}, your appointment is confirmed.',
    'Editing a step never changes the saved message it started from');
  await field(page, 'Automation name').fill(title + ' (renamed)');
  await page.getByText('Unsaved changes').waitFor();
  await button(page, 'Save & review').click();
  const review = page.getByRole('list', { name: 'Steps to publish' });
  await review.waitFor();
  await review.getByText('Informational · unchanged saved message').waitFor();
  await review.getByText('Requires marketing consent · custom wording').waitFor();
  await page.getByRole('region', { name: 'Publish review controls', exact: true }).getByText('Agency message delivery: On', { exact: true }).waitFor();
  assert.equal(sql(`select status||'|'||(select count(*) from public.workflow_versions where workflow_id='${id}')||'|'||automation_draft_name from public.workflows where id='${id}'`),
    'draft|0|' + title + ' (renamed)');
  await shot(page, 'review', { fullPage: true });
  await button(page, 'Publish version').click();
  const status = page.getByRole('region', { name: 'Workflow status', exact: true });
  await status.getByText('Version published.', { exact: true }).waitFor();
  await status.getByText('Agency enrollment: On', { exact: true }).waitFor();
  assert.equal(sql(`select w.status||'|'||count(v.*) from public.workflows w join public.workflow_versions v on v.workflow_id=w.id where w.id='${id}' group by w.status`), 'active|1');
  assert.equal(sql(`select string_agg(purpose||'/'||basis,',' order by purpose) from private.automation_sms_purposes p
    join public.workflow_versions v on v.id=p.version_id where v.workflow_id='${id}'`), 'informational/saved_message,marketing/custom');
  // A failed status lookup reads Unknown. It never shows a switch as on or off.
  await page.route('**/rest/v1/rpc/automation_access*', route => route.abort());
  await button(status, 'Refresh status').click();
  await status.getByText('Agency enrollment: Unknown', { exact: true }).waitFor();
  await status.getByText('Agency message delivery: Unknown', { exact: true }).waitFor();
  await page.unroute('**/rest/v1/rpc/automation_access*');
  await button(status, 'Refresh status').click();
  await status.getByText('Agency enrollment: On', { exact: true }).waitFor();
  console.log('PASS explicit saves: Save draft stored a draft, Save & review stored and reviewed it with each text\'s consent requirement, Publish version created the one version and pinned those requirements. A failed lookup read Unknown.');

  // 4. History keeps the step name of the version that ran.
  const first = randomUUID(), second = randomUUID();
  sql(`insert into public.leads(id,organization_id,first_name,last_name,phone,lead_source,user_id,assigned_agent_id)
    values ('${first}','${agency}','Robin','First','+12025550194','Editor check','${owner}','${owner}')`);
  assert.deepEqual(worker(), { sms: [], email: [] }, 'A lead without consent evidence receives nothing');
  await listView(page);
  await button(rows(page).nth(1), 'Send SMS').click();
  await button(page, 'Step details').click();
  await field(page, 'Step name').fill('Appointment notice v2');
  await button(page, 'Save & review').click();
  await button(page, 'Publish version').click();
  await status.getByText('Version published.', { exact: true }).waitFor();
  assert.equal(sql(`select string_agg(node.value->>'id',',' order by node.ordinality) from public.workflows w, jsonb_array_elements(w.automation_graph->'nodes') with ordinality node where w.id='${id}'`),
    stepIds, 'Naming a step keeps every step ID');
  sql(`insert into public.leads(id,organization_id,first_name,last_name,phone,lead_source,user_id,assigned_agent_id)
    values ('${second}','${agency}','Robin','Second','+12025550195','Editor check','${owner}','${owner}')`);
  worker();
  await button(page, 'Activity').click();
  const activity = page.getByRole('region', { name: 'Automation activity' });
  await activity.getByRole('listitem').filter({ hasText: 'Robin First' }).getByText(/^Version \d+ · Send SMS$/).waitFor();
  await activity.getByRole('listitem').filter({ hasText: 'Robin Second' }).getByText(/^Version \d+ · Appointment notice v2 · Send SMS$/).waitFor();
  assert.equal(await activity.getByRole('listitem').filter({ hasText: 'Robin First' }).getByText(/Appointment notice v2/).count(), 0);
  console.log('PASS step names: a run shows the name its own version gave the step, after the step was renamed and republished with the same step IDs.');

  // 5. Two people editing the same draft: the later save is refused, not merged or lost silently.
  const other = await login('two');
  await other.page.goto(APP + '/automations?workflow=' + id, { waitUntil: 'domcontentloaded' });
  await field(other.page, 'Automation name').waitFor();
  await button(page, 'Edit draft').click();
  await field(page, 'Automation name').fill('Saved first');
  await button(page, 'Save draft').click();
  await page.getByText('Draft saved.').waitFor();
  await field(other.page, 'Automation name').fill('Saved second');
  await button(other.page, 'Save draft').click();
  await other.page.getByRole('alert').filter({ hasText: /Draft changed or unavailable/ }).waitFor();
  assert.equal(sql(`select automation_draft_name from public.workflows where id='${id}'`), 'Saved first');
  // Another agency cannot open it at all.
  const outsider = await login('other');
  await outsider.page.goto(APP + '/automations?workflow=' + id, { waitUntil: 'domcontentloaded' });
  await outsider.page.getByText('Automation unavailable.').waitFor();
  console.log('PASS concurrent edits and isolation: a stale save was refused with the first save intact, and another agency could not open the draft.');

  // 6. Both layouts in both themes. A wide screen has the canvas or the list beside the settings; a phone has a timeline and a sheet.
  await page.getByRole('radio', { name: 'Canvas', exact: true }).click();
  const canvas = page.getByLabel('Automation canvas');
  await canvas.waitFor();
  assert.equal(await page.getByRole('list', { name: 'Ordered steps' }).count(), 0, 'One view at a time');
  await button(canvas, 'Welcome text').click();
  await page.getByRole('region', { name: 'Configure block' }).waitFor();
  const box = await canvas.boundingBox();
  assert.ok(box.height >= 500, 'The canvas uses the height of the workspace: ' + box.height);
  for (const tone of ['light', 'dark']) { await theme(page, tone); await shot(page, 'canvas', { fullPage: true }); }
  await theme(page, 'light');
  await listView(page);
  await shot(page, 'list', { fullPage: true });
  await button(page, 'Close step settings').click();
  await page.setViewportSize({ width: 375, height: 812 });
  const timeline = page.getByRole('list', { name: 'Ordered steps' });
  await timeline.waitFor();
  // The app shell slides its sidebar away when the window narrows. Wait for it to finish before measuring.
  await page.waitForFunction(() => document.querySelector('main')?.getBoundingClientRect().x === 0);
  await page.waitForTimeout(400);
  assert.equal(await page.getByLabel('Automation canvas').count(), 0);
  assert.equal(await page.getByRole('radio', { name: 'List', exact: true }).count(), 0);
  const fits = await timeline.boundingBox();
  assert.ok(fits.x >= 0 && fits.x + fits.width <= 376, 'The timeline fits a phone');
  for (const tone of ['light', 'dark']) { await theme(page, tone); await shot(page, 'timeline', { fullPage: true }); }
  const stepButton = button(rows(page).nth(2), 'Welcome text');
  await stepButton.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Send SMS' });
  await sheet.waitFor();
  await field(page, 'Message').waitFor();
  for (const tone of ['dark', 'light']) {
    // The account menu sits behind the sheet, so the theme is switched with the sheet closed.
    await button(sheet, 'Done').click();
    await sheet.waitFor({ state: 'hidden' });
    await theme(page, tone);
    await stepButton.focus();
    await page.keyboard.press('Enter');
    await sheet.waitFor();
    // Wait until the sheet has finished sliding in and its Done button can be pressed.
    await button(sheet, 'Done').click({ trial: true });
    await shot(page, 'step-sheet');
  }
  await button(sheet, 'Done').press('Enter');
  await sheet.waitFor({ state: 'hidden' });
  assert.equal(await focused(stepButton), true, 'Closing the sheet returns focus to the step that opened it');
  // Insert, reorder and remove on the phone, from the keyboard.
  await button(rows(page).nth(3), 'Add step').press('Enter');
  await button(picker(page), 'Wait').press('Enter');
  await field(page, 'Duration').fill('5');
  await field(page, 'Unit').selectOption('minutes');
  await button(page.getByRole('dialog', { name: 'Wait' }), 'Done').press('Enter');
  await button(rows(page).nth(4), 'Wait 5 minutes').waitFor();
  await button(rows(page).nth(4), 'Move up').press('Enter');
  await button(rows(page).nth(3), 'Wait 5 minutes').waitFor();
  await button(rows(page).nth(3), 'Remove').press('Enter');
  assert.equal(await rows(page).count(), 4);
  {
    // Insert field by touch on a phone: tap into the message, then tap Insert field and a field.
    const touch = await session(browser, 'editor touch', email('one'), settings.PASSWORD, evidence,
      { deviceScaleFactor: 2, hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });
    touch.page.setDefaultTimeout(20000);
    await touch.page.goto(APP + '/automations?workflow=' + new URL(page.url()).searchParams.get('workflow'), { waitUntil: 'domcontentloaded' });
    await button(rows(touch.page).nth(2), 'Welcome text').tap();
    const touchSheet = touch.page.getByRole('dialog', { name: 'Send SMS' });
    await button(touchSheet, 'Done').click({ trial: true });
    const tapped = field(touch.page, 'Message');
    const before = await tapped.inputValue();
    await tapped.tap({ position: { x: 40, y: 14 } });
    await touch.page.waitForTimeout(100);
    const at = await tapped.evaluate(element => element.selectionStart);
    assert.ok(at > 0 && at < before.length, 'The tap put the cursor inside the message: ' + at);
    await (await insertMenu(touch.page, 'Message')).tap();
    await button(touch.page.getByRole('dialog', { name: 'Insert field' }), 'First name').tap();
    await touch.page.getByRole('dialog', { name: 'Insert field' }).waitFor({ state: 'hidden' });
    await touch.page.waitForTimeout(100);
    assert.equal(await tapped.inputValue(), before.slice(0, at) + '{{first_name}}' + before.slice(at), 'The field goes where the tap left the cursor');
    assert.equal(await focused(tapped), true, 'Focus returns to the message after a touch insertion');
    assert.equal(await tapped.evaluate(element => element.selectionStart), at + '{{first_name}}'.length);
    await touch.page.context().close();
    console.log('PASS touch: on a phone, a tap put the cursor inside the message, Insert field placed the field there and returned focus.');
  }
  const result = { result: 'pass', viewports: [1440, 375], themes: ['light', 'dark'], screenshots,
    blockedOutsideRequests: [...new Set(evidence.sessions.flatMap(item => item.net.blocked))] };
  assert.deepEqual(result.blockedOutsideRequests.filter(url => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)), []);
  writeFileSync(join(dir, 'automations-v2-editor.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS layouts: canvas and list beside the step settings at 1440 px, timeline and settings sheet at 375 px, both themes, with insertion, reordering and removal by keyboard. ' + screenshots.length + ' screenshots.');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error(new URL(page.url()).pathname + new URL(page.url()).search, (await page.locator('main').innerText({ timeout: 1000 }).catch(() => '')).slice(-900));
    await page.screenshot({ path: join(dir, 'automations-v2-editor-failure.png') }).catch(() => {});
  }
  console.error(evidence.sessions.map(item => ({ label: item.label, errors: item.consoleErrors.slice(-3), api: item.net.httpErrors.slice(-6) })));
  throw error;
} finally {
  await browser.close();
}
