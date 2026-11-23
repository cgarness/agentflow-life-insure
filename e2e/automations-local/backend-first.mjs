// Backend-first release rehearsal, driven by run.sh backend-first after the first release's own acceptance
// script has published two automations with the first-release frontend and worker on the V2 database.
//   candidate    the V2 editor opens, saves and republishes those first-release automations
//   rolled-back  after the guarded rollback, the first-release frontend still runs what it can run
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, session, APP } from '../team-open-local/lib.mjs';
import { settings, sql, agency, email, listView } from './fixture.mjs';

const phase = process.argv[2];
assert.ok(['candidate', 'rolled-back'].includes(phase), 'Choose candidate or rolled-back');
const dir = process.env.AUTOMATION_UI_EVIDENCE || '/tmp/automation-ui-evidence';
mkdirSync(dir, { recursive: true });
const evidence = { sessions: [] };
const browser = await launch();
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const rows = page => page.getByRole('list', { name: 'Ordered steps' }).getByRole('listitem');
const field = (page, label) => page.getByLabel(label, { exact: true });
const flow = name => sql(`select id from public.workflows where organization_id='${agency}' and name='${name}'`);
const steps = id => sql(`select jsonb_agg(jsonb_build_object('id',n->>'id','type',n->>'type','version',n->'version','config',n->'config') order by n->>'id')
  from public.workflows w, jsonb_array_elements(w.automation_graph->'nodes') n where w.id='${id}'`);
const state = id => sql(`select w.status||'|'||(select count(*) from public.workflow_versions v where v.workflow_id=w.id)
  ||'|'||(select count(*) from public.automation_intervals i where i.workflow_id=w.id and i.ends_at is null) from public.workflows w where w.id='${id}'`);
const emailFlow = flow('One UI action'), textFlow = flow('Membership wait');
assert.match(emailFlow, /^[a-f0-9-]{36}$/);
assert.match(textFlow, /^[a-f0-9-]{36}$/);

async function login(n) {
  const { page, net } = await session(browser, phase + ' ' + n, email(n), settings.PASSWORD, evidence, { deviceScaleFactor: 2 });
  page.setDefaultTimeout(20000);
  return { page, net };
}

try {
  if (phase === 'candidate') {
    assert.equal(state(emailFlow), 'active|1|1');
    assert.equal(state(textFlow), 'active|1|1');
    const stored = sql(`select automation_graph#>>'{nodes,2,config,purpose}' from public.workflows where id='${textFlow}'`);
    assert.ok(['informational', 'marketing'].includes(stored), 'The first-release editor stored a purpose on its SMS step');

    // 1. A first-release automation opens in the V2 editor and a plain save leaves every step as it was.
    const one = await login('one');
    await one.page.goto(APP + '/automations?workflow=' + emailFlow, { waitUntil: 'domcontentloaded' });
    await field(one.page, 'Automation name').waitFor();
    await listView(one.page);
    assert.equal(await rows(one.page).count(), 2);
    const emailSteps = steps(emailFlow);
    await field(one.page, 'Automation name').fill('One UI action (kept)');
    await button(one.page, 'Save draft').click();
    await one.page.getByText('Draft saved.').waitFor();
    assert.equal(steps(emailFlow), emailSteps, 'Saving in the V2 editor keeps every first-release step, version and setting');
    assert.equal(sql(`select automation_graph->'settings' from public.workflows where id='${emailFlow}'`), '{"reentry": "once", "stop_on_reply": false}');
    assert.equal(state(emailFlow), 'active|1|1', 'A saved draft changes nothing that is published');
    await one.page.screenshot({ path: join(dir, 'backend-first-v2-editor.png'), animations: 'disabled' });

    // 2. Its SMS step keeps its wording and stored purpose. Republishing pins the consent requirement.
    const two = await login('two');
    await two.page.goto(APP + '/automations?workflow=' + textFlow, { waitUntil: 'domcontentloaded' });
    await field(two.page, 'Automation name').waitFor();
    await listView(two.page);
    assert.equal(await rows(two.page).count(), 3);
    const textSteps = steps(textFlow);
    await button(rows(two.page).nth(2), 'Send SMS').click();
    const wording = sql(`select automation_graph#>>'{nodes,2,config,body}' from public.workflows where id='${textFlow}'`);
    assert.equal(await field(two.page, 'Message').inputValue(), wording);
    await button(two.page, 'Step details').click();
    await field(two.page, 'Step name').fill('Membership text');
    await button(two.page, 'Save & review').click();
    await two.page.getByRole('list', { name: 'Steps to publish' }).getByText(/consent/).first().waitFor();
    await button(two.page, 'Publish version').click();
    await two.page.getByRole('region', { name: 'Workflow status', exact: true }).getByText('Version published.', { exact: true }).waitFor();
    assert.equal(state(textFlow), 'active|2|1');
    const named = JSON.parse(steps(textFlow)), before = JSON.parse(textSteps);
    assert.deepEqual(named, before, 'Naming a step keeps its ID, version, wording and stored purpose');
    assert.equal(sql(`select automation_graph#>>'{nodes,2,meta,name}' from public.workflows where id='${textFlow}'`), 'Membership text');
    assert.equal(sql(`select count(*) from private.automation_sms_purposes p join public.workflow_versions v on v.id=p.version_id where v.workflow_id='${textFlow}'`), '2',
      'Each published version has its own pinned requirement');

    // 3. History from the first release reads correctly in the V2 activity list.
    await button(two.page, 'Activity').click();
    const activity = two.page.getByRole('region', { name: 'Automation activity' });
    await activity.getByText(/^Version 1 · Send SMS$/).first().waitFor();
    console.log('PASS V2 editor on first-release automations: both opened, a plain save kept every step, a named step republished with its ID, wording and stored purpose, and first-release history is listed.');
  } else {
    // The operator has fenced every agency, restored the first-release frontend and applied the rollback.
    const needsV2 = id => sql(`select private.automation_needs_v2('${agency}',automation_version_id) from public.workflows where id='${id}'`);
    assert.equal(needsV2(emailFlow), 'f');
    assert.equal(state(emailFlow), 'active|1|1', 'The first-release automation keeps running');
    const tightened = needsV2(textFlow) === 't';
    assert.equal(state(textFlow), tightened ? 'paused|2|0' : 'active|2|1');
    const one = await login('one');
    await one.page.goto(APP + '/automations', { waitUntil: 'domcontentloaded' });
    await one.page.getByText('One UI action').first().waitFor();
    await one.page.getByText('Membership wait').first().waitFor();
    // The first-release editor still edits and saves the automation it can run.
    await one.page.goto(APP + '/automations?workflow=' + emailFlow, { waitUntil: 'domcontentloaded' });
    await field(one.page, 'Automation name').waitFor();
    assert.equal(await field(one.page, 'Automation name').inputValue(), sql(`select automation_draft_name from public.workflows where id='${emailFlow}'`),
      'The draft last saved by the V2 editor opens for editing');
    await field(one.page, 'Automation name').fill('One UI action (first release)');
    await button(one.page, 'Save draft').click();
    await one.page.getByText('Draft saved.', { exact: true }).waitFor();
    assert.equal(sql(`select automation_draft_name from public.workflows where id='${emailFlow}'`), 'One UI action (first release)');
    // A draft the V2 editor named opens for inspection only, and its automation cannot be resumed.
    const two = await login('two');
    await two.page.goto(APP + '/automations?workflow=' + textFlow, { waitUntil: 'domcontentloaded' });
    await two.page.getByText('This graph contains an unsupported block, version or format. Its saved data is available for inspection.', { exact: true }).waitFor();
    assert.equal(await button(two.page, 'Save draft').count(), 0, 'A draft with V2 content is not editable in the first-release editor');
    if (tightened) {
      // The inspection page offers no Resume. A direct request is refused with a plain reason.
      const refused = await two.page.evaluate(async ({ url, key, id }) => {
        const entry = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
        const token = JSON.parse(localStorage.getItem(entry)).access_token;
        const call = (name, body) => fetch(url + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: key,
          Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const context = await (await call('automation_session_context', {})).json();
        const answer = await call('automation_lifecycle', { p_workflow_id: id, p_operation: 'resume', p_session_revision: context.revision });
        return { status: answer.status, body: await answer.json() };
      }, { url: settings.API_URL, key: settings.ANON_KEY, id: textFlow });
      assert.equal(refused.status, 409);
      assert.equal(refused.body.message, 'This automation was published with Automations V2 and stays paused until V2 is installed again.');
      assert.equal(state(textFlow), 'paused|2|0');
    }
    await two.page.screenshot({ path: join(dir, 'backend-first-rolled-back.png'), animations: 'disabled' });
    assert.equal(sql(`select count(*) from private.automation_sms_purposes p join public.workflow_versions v on v.id=p.version_id where v.workflow_id='${textFlow}'`), '2',
      'Pinned requirements are retained');
    console.log('PASS first-release frontend after the rollback: the first-release automation stayed active and editable; the automation republished under V2 '
      + (tightened ? 'is paused and a resume request is refused (HTTP 409) with a plain reason' : 'kept running') + ' and its V2 draft opens for inspection only. Nothing was removed.');
  }
  for (const item of evidence.sessions) {
    const outside = item.net.blocked.filter(url => !/fonts\.(googleapis|gstatic)\.com/.test(url));
    assert.deepEqual(outside, [], 'No request left the machine');
  }
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error(new URL(page.url()).pathname + new URL(page.url()).search, (await page.locator('body').innerText().catch(() => '')).slice(-900));
  }
  throw error;
} finally { await browser.close(); }
