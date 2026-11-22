// Automations V2: the five workflows, authored and published in the real builder, then started through
// the CRM's own entry points as signed-in users. The worker uses in-memory transports only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { launch, session, APP } from '../team-open-local/lib.mjs';
import { settings, sql, agency, email, listView } from './fixture.mjs';
import { worker } from './work.mjs';

const evidence = { sessions: [] };
const browser = await launch();
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const rows = page => page.getByRole('list', { name: 'Ordered steps' }).getByRole('listitem');
const picker = page => page.getByRole('dialog').and(page.locator('[data-state="open"]'));
const blake = 'ba921000-0000-4000-8000-000000000020';
const sent = { sms: [], email: [] };

async function login(n) {
  const { page } = await session(browser, 'v2 ' + n, email(n), settings.PASSWORD, evidence);
  page.setDefaultTimeout(20000);
  return page;
}
async function create(page, name, trigger) {
  await page.goto(APP + '/automations', { waitUntil: 'domcontentloaded' });
  await button(page, 'Create automation').click();
  await page.getByLabel('Automation name').fill(name);
  await button(page, 'Choose trigger').click();
  await button(picker(page), trigger).click();
  await listView(page);
}
async function add(page, index, type) {
  await button(rows(page).nth(index), 'Add step').click();
  await button(picker(page), type).click();
}
// Each personalizable field has its own Insert field button, described by that field's label.
async function insertField(page, field, name) {
  const label = await page.locator('label', { hasText: new RegExp('^' + field + '$') }).getAttribute('id');
  await page.locator('button[aria-describedby="' + label + '"]').click();
  await button(page.getByRole('dialog', { name: 'Insert field' }), name).click();
}
async function task(page, { title, field, type, due, unit, notes }) {
  await page.getByLabel('Task title', { exact: true }).fill(title);
  if (field) await insertField(page, 'Task title', field);
  if (type) await page.getByLabel('Task type', { exact: true }).selectOption(type);
  await page.getByLabel('Due', { exact: true }).fill(String(due));
  await page.getByLabel('Unit', { exact: true }).selectOption(unit);
  if (notes) await page.getByLabel('Notes', { exact: true }).fill(notes);
}
async function publish(page) {
  await button(page, 'Save & review').click();
  await button(page, 'Publish version').click();
  await page.getByRole('region', { name: 'Workflow status', exact: true }).getByText('Version published.', { exact: true }).waitFor();
  return new URL(page.url()).searchParams.get('workflow');
}
/** Call the API exactly as the signed-in app does: the user's own token against PostgREST. */
async function api(page, method, path, body) {
  return page.evaluate(async ({ url, key, method, path, body }) => {
    const entry = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const token = JSON.parse(localStorage.getItem(entry)).access_token;
    const response = await fetch(url + '/rest/v1/' + path, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=representation' } });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { url: settings.API_URL, key: settings.ANON_KEY, method, path, body });
}
const rpc = (page, name, args) => api(page, 'POST', 'rpc/' + name, args);
async function ok(result, what) {
  assert.ok(result.status >= 200 && result.status < 300, what + ' failed: ' + JSON.stringify(result));
  return result.body;
}
/** The telephony webhook's own database call, with the service credential it uses. */
async function service(name, args) {
  const response = await fetch(settings.API_URL + '/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(args),
    headers: { apikey: settings.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + settings.SERVICE_ROLE_KEY, 'Content-Type': 'application/json' } });
  assert.ok(response.ok, name + ' failed: ' + await response.text());
}
/** Run the worker until nothing more is due, keeping every message a transport received. */
function work() {
  for (let turn = 0; turn < 8; turn++) {
    const before = sql(`select md5(string_agg(id::text||status||current_node_id,',' order by id)) from private.automation_runs where organization_id='${agency}'`);
    const out = worker();
    sent.sms.push(...out.sms); sent.email.push(...out.email);
    const after = sql(`select md5(string_agg(id::text||status||current_node_id,',' order by id)) from private.automation_runs where organization_id='${agency}'`);
    if (before === after && !out.sms.length && !out.email.length) return;
  }
  throw Error('The worker never settled');
}
const count = query => Number(sql('select count(*) from ' + query));
const runOf = (workflow, where = 'true') => sql(`select coalesce(status||'|'||coalesce(reason,''),'none') from private.automation_runs
  where workflow_id='${workflow}' and ${where} order by started_at desc limit 1`);
const due = workflow => sql(`update private.automation_runs set due_at=now()-interval '1 second' where workflow_id='${workflow}' and status in ('waiting','held')`);

try {
  const one = await login('one'), two = await login('two');
  const owner = sql(`select id from profiles where email='${email('one')}'`);
  const today = sql(`select (now() at time zone 'America/Chicago')::date`);
  // Earlier browser scenarios leave two published workflows. They are set aside so every run below belongs to V2.
  sql(`update public.workflows set status='paused' where organization_id='${agency}' and status='active';
    update public.organizations set twilio_subaccount_status='active' where id='${agency}';
    insert into public.company_settings(company_name,organization_id,timezone) values ('Automation UI A','${agency}','America/Chicago')
      on conflict do nothing;
    update public.company_settings set timezone='America/Chicago' where organization_id='${agency}';
    insert into public.dispositions(id,organization_id,name,color,counts_as_contacted) values
      ('ba921000-0000-4000-8000-000000000050','${agency}','No Answer','#EF4444',false),
      ('ba921000-0000-4000-8000-000000000051','${agency}','Interested','#22C55E',true) on conflict (id) do nothing;
    update private.automation_release_controls set enrollment_enabled=true,dispatch_enabled=true where organization_id='${agency}';`);

  // A. New lead callback ---------------------------------------------------------------------------
  await create(one, 'V2 New lead callback', 'New lead created');
  await add(one, 0, 'Create task for assigned agent');
  await task(one, { title: 'Call ', field: 'First name', type: 'Follow Up', due: 5, unit: 'minutes', notes: 'New lead: call within five minutes' });
  assert.equal(await one.getByLabel('Task title', { exact: true }).inputValue(), 'Call {{first_name}}');
  await button(one, 'Step details').click();
  await one.getByLabel('Step name', { exact: true }).fill('Speed to lead');
  const callback = await publish(one);
  const sam = randomUUID();
  const callsBefore = count(`public.calls where organization_id='${agency}'`);
  sql(`insert into public.leads(id,organization_id,first_name,last_name,phone,lead_source,user_id,assigned_agent_id)
    values ('${sam}','${agency}','Sam','Rivera','+12025550190','Web form','${owner}','${owner}')`);
  work(); work();
  assert.equal(sql(`select title||'|'||task_type||'|'||all_day||'|'||(created_by is null)||'|'||(automation_run_id is not null)||'|'||
    (due_date between now()+interval '3 minutes' and now()+interval '6 minutes')||'|'||(assigned_to='${owner}')
    from public.tasks where contact_id='${sam}'`), 'Call Sam|Follow Up|false|true|true|true|true');
  assert.equal(count(`public.tasks where contact_id='${sam}'`), 1);
  assert.equal(count(`public.calls where organization_id='${agency}'`), callsBefore);
  await one.goto(APP + '/automations?workflow=' + callback, { waitUntil: 'domcontentloaded' });
  await button(one, 'Activity').click();
  await one.getByText('Speed to lead · Create task for assigned agent').first().waitFor();
  console.log('PASS A: a new lead produced one timed task for its assigned agent, named with the lead, with no call placed or counted.');

  // B. No-answer follow-up -------------------------------------------------------------------------
  await create(one, 'V2 No-answer follow-up', 'Disposition recorded');
  await one.getByRole('checkbox', { name: 'No Answer', exact: true }).click();
  await add(one, 0, 'Wait');
  await one.getByLabel('Duration', { exact: true }).fill('1');
  await one.getByLabel('Unit', { exact: true }).selectOption('hours');
  await add(one, 1, 'Create task for assigned agent');
  await task(one, { title: 'Try again: ', field: 'First name', due: 0, unit: 'minutes' });
  await button(one, 'Close step settings').click();
  await one.getByLabel('Re-entry', { exact: true }).selectOption('after_end');
  await one.getByRole('switch', { name: 'Stop when the contact is reached on a later call' }).click();
  await one.getByRole('switch', { name: 'Stop when an appointment is booked' }).click();
  const noAnswer = await publish(one);
  async function dispose(disposition) {
    const call = randomUUID();
    sql(`insert into public.calls(id,organization_id,agent_id,contact_id,contact_type,contact_phone,direction,status,duration,dialer_admission_required)
      values ('${call}','${agency}','${owner}','${sam}','lead','+12025550190','outbound','completed',0,false)`);
    const input = { p_call_id: call, p_operation_id: randomUUID(), p_disposition_id: disposition, p_notes: 'synthetic', p_release_lock: false };
    await ok(await rpc(one, 'save_disposition_with_booking', { p_input: input }), 'Saving the disposition');
    // The same save sent again is the same saved disposition.
    await ok(await rpc(one, 'save_disposition_with_booking', { p_input: input }), 'Repeating the disposition save');
    return call;
  }
  await dispose('ba921000-0000-4000-8000-000000000050');
  await dispose('ba921000-0000-4000-8000-000000000050');
  work();
  assert.equal(count(`private.automation_events where organization_id='${agency}' and event_type='disposition_recorded' and contact_id='${sam}'`), 2,
    'Each saved disposition is one event, however often the save is repeated');
  assert.equal(count(`private.automation_runs where workflow_id='${noAnswer}'`), 1, 'A double dial must not stack a second run');
  assert.match(runOf(noAnswer), /^waiting\|/);
  const reached = await dispose('ba921000-0000-4000-8000-000000000051');
  sql(`update public.calls set duration=140 where id='${reached}'`);
  due(noAnswer); work();
  assert.equal(runOf(noAnswer), 'stopped|Contact was reached');
  assert.equal(count(`public.tasks where contact_id='${sam}' and title like 'Try again%'`), 0);
  await dispose('ba921000-0000-4000-8000-000000000050');
  work();
  assert.equal(count(`private.automation_runs where workflow_id='${noAnswer}'`), 2, 'A later no-answer is a legitimate new entry');
  due(noAnswer); work();
  assert.equal(count(`public.tasks where contact_id='${sam}' and title='Try again: Sam'`), 1);
  console.log('PASS B: saved dispositions started one run for a double dial, a later conversation stopped it, and a later no-answer re-entered once.');

  // C. Appointment reminders and no-show recovery --------------------------------------------------
  await create(one, 'V2 Appointment reminder', 'Appointment booked');
  await add(one, 0, 'Wait until before appointment');
  await one.getByLabel('Time before', { exact: true }).fill('1');
  await one.getByLabel('Unit', { exact: true }).selectOption('days');
  await add(one, 1, 'Send SMS');
  await one.getByLabel('Message', { exact: true }).fill('Reminder: your appointment is ');
  await insertField(one, 'Message', 'Appointment date');
  await one.getByLabel('Message', { exact: true }).press('End');
  await one.keyboard.type(' at ');
  await insertField(one, 'Message', 'Appointment time');
  assert.equal(await one.getByLabel('Message', { exact: true }).inputValue(),
    'Reminder: your appointment is {{appointment_date}} at {{appointment_time}}');
  const reminder = await publish(one);
  await create(two, 'V2 No-show recovery', 'Appointment outcome recorded');
  await two.getByRole('checkbox', { name: 'No-show', exact: true }).click();
  await add(two, 0, 'Create task for assigned agent');
  await task(two, { title: 'Reschedule ', field: 'First name', due: 1, unit: 'hours' });
  const noShow = await publish(two);
  async function book(lead, startsInHours) {
    const request = randomUUID();
    const starts = new Date(Date.now() + startsInHours * 3_600_000).toISOString();
    await ok(await rpc(one, 'create_appointment_once', { p_request_id: request,
      p_appointment: { title: 'Fixture review', start_time: starts, contact_id: lead, user_id: owner } }), 'Booking the appointment');
    return { id: sql(`select id from public.appointments where booking_request_id='${request}'`), starts };
  }
  const visit = await book(blake, 72);
  work();
  assert.match(runOf(reminder, `contact_id='${blake}'`), /^waiting\|/);
  const waitUntil = sql(`select due_at from private.automation_runs where workflow_id='${reminder}' and contact_id='${blake}'`);
  // The agent moves the appointment two days later from the calendar.
  await ok(await api(one, 'PATCH', 'appointments?id=eq.' + visit.id,
    { start_time: new Date(Date.parse(visit.starts) + 48 * 3_600_000).toISOString() }), 'Rescheduling the appointment');
  work();
  assert.equal(count(`private.automation_runs where workflow_id='${reminder}' and contact_id='${blake}'`), 1, 'A reschedule moves the run; it does not add one');
  assert.equal(sql(`select (due_at='${waitUntil}'::timestamptz+interval '2 days')||'|'||status from private.automation_runs
    where workflow_id='${reminder}' and contact_id='${blake}'`), 'true|waiting');
  due(reminder); work();
  assert.equal(sent.sms.length, 1, 'One reminder text reached the synthetic transport');
  assert.match(sent.sms[0], /^Reminder: your appointment is [A-Z][a-z]+, [A-Z][a-z]+ \d{1,2} at \d{1,2}:\d{2} [AP]M UTC$/);
  assert.match(runOf(reminder, `contact_id='${blake}'`), /^completed\|/);
  // A cancelled appointment loses its pending reminder.
  const cancelled = await book(sam, 96);
  work();
  assert.match(runOf(reminder, `contact_id='${sam}'`), /^waiting\|/);
  await ok(await api(one, 'PATCH', 'appointments?id=eq.' + cancelled.id, { status: 'Cancelled' }), 'Cancelling the appointment');
  work();
  assert.equal(runOf(reminder, `contact_id='${sam}'`), 'stopped|Appointment was cancelled');
  // An explicit No-show, even when the request is sent twice, makes one rescheduling task.
  const missed = await book(sam, -2);
  assert.equal(count(`private.automation_runs where workflow_id='${reminder}' and contact_id='${sam}'`), 1, 'A past appointment is not a booking to remind');
  const outcome = { p_request_id: randomUUID(), p_appointment_id: missed.id, p_expected_start: missed.starts, p_outcome: 'no_show' };
  work();
  assert.equal(count(`private.automation_runs where workflow_id='${noShow}'`), 0, 'An appointment whose time passed is not a no-show');
  await ok(await rpc(one, 'record_appointment_outcome', outcome), 'Recording the no-show');
  await ok(await rpc(one, 'record_appointment_outcome', outcome), 'Repeating the no-show');
  work(); work();
  assert.equal(count(`public.tasks where contact_id='${sam}' and title='Reschedule Sam'`), 1);
  assert.equal(sent.sms.length, 1);
  console.log('PASS C: the reminder followed a rescheduled appointment and was sent once with its date and time, a cancellation removed a pending reminder, and one explicit no-show made one rescheduling task.');

  // D. Missed inbound callback ---------------------------------------------------------------------
  await create(one, 'V2 Missed call callback', 'Inbound call missed');
  await button(rows(one).nth(0), 'Add step').click();
  assert.equal(await button(picker(one), 'Send SMS').count(), 0, 'Messages are not offered where there may be no contact');
  await button(picker(one), 'Create task for assigned agent').click();
  await task(one, { title: 'Call back ', field: 'Phone number', due: 15, unit: 'minutes' });
  await publish(one);
  async function missedCall(caller, lead) {
    const call = randomUUID();
    sql(`insert into public.calls(id,organization_id,direction,status,twilio_call_sid,contact_phone,caller_id_used,contact_id,contact_type,contact_name,agent_id)
      values ('${call}','${agency}','inbound','ringing','CA${randomUUID().replace(/-/g, '')}','${caller}','+12025550181',
        ${lead ? `'${lead}','lead'` : 'null,null'},null,null)`);
    await service('finalize_inbound_call_terminal', { p_call_row_id: call, p_org_id: agency, p_status: 'no-answer', p_mark_missed: true, p_external_answer: false });
    await service('finalize_inbound_call_terminal', { p_call_row_id: call, p_org_id: agency, p_status: 'no-answer', p_mark_missed: true, p_external_answer: false });
    sql(`update private.automation_events set available_at=now()-interval '1 second' where organization_id='${agency}' and event_type='inbound_call_missed' and processed_at is null`);
    work();
    return call;
  }
  const leadsBefore = count(`public.leads where organization_id='${agency}'`);
  const unknown = await missedCall('+12025559911', null);
  assert.equal(sql(`select status||'|'||coalesce(claimed_by::text,'nobody')||'|'||coalesce(contact_id::text,'no contact')||'|'||title
    from public.inbound_callbacks where call_id='${unknown}'`), 'open|nobody|no contact|Call back +12025559911');
  assert.equal(count(`public.leads where organization_id='${agency}'`), leadsBefore, 'No lead is invented for an unknown caller');
  const queue = await ok(await rpc(one, 'inbound_callback_queue', {}), 'Reading the callback list');
  const waiting = queue.items.find(item => item.call_id === unknown);
  assert.ok(waiting && waiting.can_claim && waiting.caller_phone === '+12025559911');
  // Two agents press Claim at the same moment.
  const claims = await Promise.all([one, two].map(page => rpc(page, 'claim_inbound_callback', { p_callback: waiting.id })));
  assert.deepEqual(claims.map(claim => claim.status).sort(), [200, 409], JSON.stringify(claims));
  assert.equal(claims.find(claim => claim.status === 409).body.message, 'Someone else already claimed this callback.');
  const winner = claims[0].status === 200 ? one : two;
  await ok(await rpc(winner, 'complete_inbound_callback', { p_callback: waiting.id }), 'Completing the callback');
  const known = await missedCall('+12025550190', sam);
  assert.equal(count(`public.inbound_callbacks where call_id='${known}'`), 0);
  assert.equal(count(`public.tasks where contact_id='${sam}' and title='Call back +12025550190' and assigned_to='${owner}' and not all_day`), 1);
  console.log('PASS D: an unknown caller became one claimable callback that exactly one of two simultaneous agents claimed, and a known caller became a task for the responsible agent.');

  // E. Policy follow-through -----------------------------------------------------------------------
  await create(one, 'V2 Application status', 'Sale recorded');
  await add(one, 0, 'Create task for assigned agent');
  await task(one, { title: 'Check the application for ', field: 'First name', type: 'Check Application', due: 3, unit: 'days' });
  await publish(one);
  await create(two, 'V2 Policy delivery', 'Policy issuance confirmed');
  await add(two, 0, 'Create task for assigned agent');
  await task(two, { title: 'Deliver the policy to ', field: 'First name', type: 'Policy Review', due: 1, unit: 'days' });
  const delivery = await publish(two);
  const sale = await ok(await rpc(one, 'create_client_with_sale', { p_request_id: randomUUID(), p_expected_org: agency, p_record_sale: true,
    p_client: { first_name: 'Pat', last_name: 'Holder', assigned_agent_id: owner, policy_type: 'Term', carrier: 'Fixture Life',
      premium: 100, sold_date: today, payment_frequency: 'monthly' } }), 'Recording the sale');
  const client = sale.client_id;
  await ok(await rpc(one, 'record_client_policy', { p_request_id: randomUUID(), p_client_id: client,
    p_policy: { policy_type: 'Whole Life', carrier: 'Fixture Life', premium: 80, sold_date: today } }), 'Recording a second policy');
  work();
  assert.equal(count(`public.tasks where contact_id='${client}' and contact_type='client' and title='Check the application for Pat'`), 2,
    'Two policies on one client are followed independently');
  assert.equal(count(`private.automation_runs where workflow_id='${delivery}'`), 0, 'A recorded sale is not an issued policy');
  const policies = await ok(await rpc(one, 'get_policy_issuance', { p_client_id: client }), 'Reading issuance');
  assert.equal(policies.length, 2);
  assert.ok(policies.every(policy => policy.can_confirm && policy.issued_on === null));
  const confirmation = { p_request_id: randomUUID(), p_policy_id: policies[0].policy_id, p_issued_on: today };
  assert.equal((await ok(await rpc(one, 'confirm_policy_issuance', confirmation), 'Confirming issuance')).idempotent, false);
  assert.equal((await ok(await rpc(one, 'confirm_policy_issuance', confirmation), 'Repeating the confirmation')).idempotent, true);
  work();
  assert.equal(count(`public.tasks where contact_id='${client}' and title='Deliver the policy to Pat'`), 1);
  const after = await ok(await rpc(two, 'get_policy_issuance', { p_client_id: client }), 'Reading issuance again');
  assert.deepEqual(after.map(policy => policy.issued_on), [today, null]);
  console.log('PASS E: two policies on one client each got an application task, and only the policy whose issuance was confirmed got a delivery task.');

  // A message without consent evidence is held, with a reason, and nothing is sent ------------------------
  sql(`insert into public.lead_sources(organization_id,name,active) values ('${agency}','Consent check',true) on conflict do nothing`);
  await create(one, 'V2 Consent check', 'New lead created');
  await one.getByLabel('Lead source', { exact: true }).selectOption('Consent check');
  await add(one, 0, 'Send SMS');
  await one.getByLabel('Message', { exact: true }).fill('Hello {{first_name}}, a new offer for you.');
  const consent = await publish(one);
  assert.equal(sql(`select purpose||'|'||basis from private.automation_sms_purposes p join public.workflow_versions v on v.id=p.version_id
    where v.workflow_id='${consent}'`), 'marketing|custom');
  const casey = randomUUID();
  sql(`insert into public.leads(id,organization_id,first_name,phone,lead_source,user_id,assigned_agent_id)
    values ('${casey}','${agency}','Casey','+12025550193','Consent check','${owner}','${owner}')`);
  work();
  const held = runOf(consent);
  assert.match(held, /^held\|.+/, 'A text without consent evidence must be held with a reason: ' + held);
  assert.ok(held.length < 220, 'The reason stays concise: ' + held);
  assert.equal(count(`private.automation_messages where organization_id='${agency}' and contact_id='${casey}'`), 0);
  assert.deepEqual([sent.sms.length, sent.email.length], [1, 0], 'Only the one reminder ever reached a transport');
  // The harness blocks every request that leaves this machine. The only ones the app even attempts are its font stylesheet.
  for (const item of evidence.sessions) {
    assert.deepEqual(item.net.blocked.filter(url => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)), [],
      'The browser attempted a request to an outside service');
  }
  console.log('PASS consent: hand-written wording was pinned to marketing consent and held (' + held.split('|')[1] + '). ' +
    'In total one synthetic text, zero emails and zero requests to any outside service.');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error(new URL(page.url()).pathname + new URL(page.url()).search, (await page.locator('main').innerText({ timeout: 1000 }).catch(() => '')).slice(-900));
  }
  console.error(evidence.sessions.map(item => ({ label: item.label, errors: item.consoleErrors.slice(-3), api: item.net.httpErrors.slice(-6) })));
  console.error(sql(`select w.name||' '||r.status||' '||coalesce(r.reason,'')||' '||r.current_node_id from private.automation_runs r
    join public.workflows w on w.id=r.workflow_id where r.organization_id='${agency}' order by r.started_at desc limit 12`));
  throw error;
} finally {
  await browser.close();
}
