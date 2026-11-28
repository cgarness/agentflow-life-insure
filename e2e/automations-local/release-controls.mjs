import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {visibility,runSqlFile} from './release-visibility.mjs';
import {APP} from '../team-open-local/lib.mjs';
import {sql,listView} from './fixture.mjs';

const button = (p,name) => p.getByRole('button',{name,exact:true});
async function checkEffects(region,enroll,dispatch) {
  for (const [name,on] of [['Agency enrollment',enroll],['Agency message delivery',dispatch]])
    await region.getByText(name+': '+(on?'On':'Off'),{exact:true}).waitFor();
  await region.getByText(enroll?/Qualifying new leads can start a run\./:/New events cannot start a run\./).waitFor();
  const sending = dispatch ? enroll?/Messages may go out after sender, consent, timing and limit checks\./
    :/Existing runs may send after sender, consent, timing and limit checks\./ :/Messages cannot be handed to a provider\./;
  await region.getByText(sending).waitFor();
}
export async function releaseControls(page,org) {
  const captures=process.env.AUTOMATIONS_LOCAL_EVIDENCE;
  const results=[];
  if (captures) mkdirSync(captures,{recursive:true});
  for (const [enroll,dispatch] of [[false,false],[false,true],[true,false],[true,true]]) {
    sql(`update private.automation_release_controls set enrollment_enabled=${enroll},dispatch_enabled=${dispatch} where organization_id='${org}'`);
    if (enroll||dispatch) visibility(org,'hide',true);
    await page.goto(APP+'/automations');
    await button(page,'Create automation').click();
    const name='Cutover controls '+Number(enroll)+Number(dispatch);
    await page.getByLabel('Automation name').fill(name);
    const choose=async label => button(page.getByRole('dialog').and(page.locator('[data-state="open"]')),label).click();
    await button(page,'Choose trigger').click();
    await choose('New lead created');
    await listView(page);
    await button(page.getByRole('list',{name:'Ordered steps'}).getByRole('listitem').first(),'Add step').click();
    await choose('Send SMS');
    await page.getByLabel('Message',{exact:true}).fill('Synthetic release check');
    await button(page,'Save draft').click();
    await page.getByText('Draft saved.').waitFor();
    const current=page.getByRole('region',{name:'Workflow status',exact:true});
    await current.getByText(/This draft cannot enroll/).waitFor();
    await button(page,'Save & review').click();
    const review=page.getByRole('region',{name:'Publish review controls',exact:true});
    await checkEffects(review,enroll,dispatch);
    if (!enroll && !dispatch) {
      const workflow=new URL(page.url()).searchParams.get('workflow');
      assert.match(workflow,/^[a-f0-9-]{36}$/);
      const publish=button(page,'Publish version');
      // Wait for completed validation, then change the test agency's controls while the review remains open.
      await publish.click({trial:true});
      sql(`update private.automation_release_controls set dispatch_enabled=true where organization_id='${org}'`);
      const [rejected]=await Promise.all([
        page.waitForResponse(r=>r.url().endsWith('/rpc/publish_automation') && r.request().method()==='POST'),
        publish.click(),
      ]);
      assert.equal(rejected.status(),409,'A stale human review returns a terminal HTTP conflict');
      assert.equal((await rejected.json()).code,'PT409');
      await page.getByText('Review the current agency settings before publishing.').waitFor();
      assert.equal(await publish.isDisabled(),true);
      assert.equal(sql(`select count(*) from workflow_versions where workflow_id='${workflow}'`),'0');
      sql(`update private.automation_release_controls set dispatch_enabled=false where organization_id='${org}'`);
      await page.reload();
      await current.getByText(/This draft cannot enroll/).waitFor();
      await button(page,'Save & review').click();
      await checkEffects(review,enroll,dispatch);
      console.log('PASS stale review blocked until current controls were reviewed');
    }
    await button(page,'Publish version').click();
    await current.getByText('Version published.',{exact:true}).waitFor();
    await checkEffects(current,enroll,dispatch);
    const confirmation=await current.innerText();
    const label=Number(enroll).toString()+Number(dispatch);
    if (captures) await current.screenshot({path:join(captures,'release-controls-'+label+'.png'),animations:'disabled'});
    await page.reload();
    await checkEffects(current,enroll,dispatch);
    const fromEditor=await current.locator('p').last().innerText();
    await button(page,'Back to automations').click();
    const row=page.getByRole('listitem').filter({has:button(page,name)});
    await row.getByText(fromEditor,{exact:true}).waitFor();
    await button(row,name).click();
    await checkEffects(current,enroll,dispatch);
    const id=new URL(page.url()).searchParams.get('workflow');
    assert.match(id,/^[a-f0-9-]{36}$/);
    assert.equal(sql(`select count(*) from workflow_versions where workflow_id='${id}'`),'1');
    runSqlFile('e2e/automations-local/release-matrix.sql',{agency_id:org,workflow_id:id});
    results.push({agencyEnrollment:enroll,providerDispatch:dispatch,confirmation,
      publishedVersions:1,matchingLeadEnrolled:enroll,existingRunPassedDispatchGate:dispatch,providerRequestsInMatrix:0});
    // Pausing and archiving have workflow-specific effects even when both agency controls are on.
    if (enroll && dispatch) {
      await button(page,'Pause').click();
      await current.getByText(/This workflow is paused/).waitFor();
      await button(page,'Resume').click();
      await checkEffects(current,enroll,dispatch);
      await button(page,'Archive').click();
      await button(page.getByRole('alertdialog'),'Archive automation').click();
      await current.getByText(/This workflow is archived/).waitFor();
    }
    console.log('PASS review, published confirmation and reopened status:',name);
  }
  if (captures) writeFileSync(join(captures,'release-controls.json'),JSON.stringify(results,null,2)+'\n');
  sql(`update private.automation_release_controls set enrollment_enabled=false,dispatch_enabled=false where organization_id='${org}'`);
}
