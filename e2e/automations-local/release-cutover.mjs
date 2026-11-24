import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync} from 'node:fs';
import {APP,launch,session} from '../team-open-local/lib.mjs';
import {agency,settings,sql} from './fixture.mjs';
import {serveCutover} from './release-static.mjs';
import {releaseControls} from './release-controls.mjs';
import {visibility,runSqlFile} from './release-visibility.mjs';

const org='bce00000-0000-4000-8000-000000000001';
const oldWorkflow='bce00000-0000-4000-8000-000000000012';
const button = (p,name) => p.getByRole('button',{name,exact:true});
const exec=promisify(execFile);
const output=process.argv[2];
assert.ok(output,'Provide the temporary directory containing both local builds');
assert.equal(sql("select to_regclass('public.workflow_versions') is null"),'t');
assert.equal(sql('select count(*) from workflows'),'0');
assert.equal(sql('show cron.launch_active_jobs'),'off');
if (process.env.AUTOMATIONS_LOCAL_SCHEMA_RECEIPT) {
  const receipt=JSON.parse(sql(readFileSync('e2e/automations-local/schema-fingerprint.sql','utf8')));
  writeFileSync(process.env.AUTOMATIONS_LOCAL_SCHEMA_RECEIPT,JSON.stringify(receipt)+'\n',{mode:0o600});
}
sql(readFileSync('supabase/tests/fixtures/automation_legacy.sql','utf8'));

const ids={};
const address=role=>'upgrade-'+role.replace(' ','-').toLowerCase()+'@example.invalid';
for (const role of ['Super Admin','Admin','Agent']) {
  const res=await fetch(settings.API_URL+'/auth/v1/admin/users',{method:'POST',headers:{apikey:settings.SERVICE_ROLE_KEY,
    Authorization:'Bearer '+settings.SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({
      email:address(role),password:settings.PASSWORD,email_confirm:true,
      user_metadata:{organization_id:org,role,first_name:'Cutover',last_name:role},
    })});
  assert.ok(res.ok,'Local Auth user '+role+' could not be created');
  ids[role]=(await res.json()).id;
  assert.match(ids[role],/^[a-f0-9-]{36}$/);
}
sql(`update public.profiles set onboarding_complete=true,is_super_admin=(id='${ids['Super Admin']}') where organization_id='${org}'`);
sql(`insert into public.leads(id,organization_id,lead_source,first_name,last_name,email,phone,user_id,assigned_agent_id)
  values ('bce00000-0000-4000-8000-000000000018','${org}','Synthetic upgrade','Legacy','Contact','upgrade-contact@example.invalid',
    '+12025550192','${ids.Admin}','${ids.Admin}')`);
const legacyHash=()=>sql(readFileSync('supabase/tests/fixtures/automation_legacy_rows.sql','utf8')+
  'select encode(sha256(convert_to(pg_temp.legacy_rows()::text,\'UTF8\')),\'hex\');');
const oldTables=['public.workflows','public.workflow_nodes','public.workflow_edges','public.workflow_folders',
  'public.workflow_executions','public.workflow_execution_steps','public.messages','public.contact_emails','public.sms_dispatches',
  'public.leads','public.campaign_leads'];
const newTables=['public.workflow_versions','public.automation_intervals','private.automation_events','private.automation_runs',
  'private.automation_steps','private.automation_intents','private.automation_messages','private.automation_intake_recovery',
  'private.automation_deferred_admissions','private.automation_reply_watermarks','private.automation_task_receipts',
  'private.automation_sms_purposes','public.inbound_callbacks','public.policy_issuance_confirmations',
  'private.automation_release_controls'];
function counts(tables) {
  return JSON.parse(sql('select jsonb_build_object('+tables.map(t=>`'${t}',(select count(*) from ${t})`).join(',')+')'));
}
function snapshot() {
  const tables=[...oldTables,...newTables.filter(t=>t!=='private.automation_release_controls')];
  const rowDigests=tables.map(t=>`'${t}',(select md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')) from ${t} r)`);
  return sql('select jsonb_build_object('+rowDigests.join(',')+')::text');
}
async function contextResult(page,refresh=false) {
  return page.evaluate(async ({url,key,refresh})=>{
    const entry=Object.keys(localStorage).find(k=>k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!entry) throw Error('Local signed-in Auth storage unavailable');
    const session=JSON.parse(localStorage.getItem(entry));
    let token=session.access_token;
    const payload=key=>JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    const id=payload(token).session_id;
    if (refresh) {
      const renew=await fetch(url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:session.refresh_token})});
      if (!renew.ok) throw Error('Native test login refresh failed');
      token=(await renew.json()).access_token;
      if (payload(token).session_id !== id) throw Error('Token refresh must retain the original session');
    }
    const r=await fetch(url+'/rest/v1/rpc/automation_session_context',{method:'POST',headers:{apikey:key,
      Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});
    const result=await r.json();
    return {status:r.status,code:result.code,hint:result.hint,id};
  },{url:settings.API_URL,key:settings.ANON_KEY,refresh});
}
const server=await serveCutover(output);
const browser=await launch();
const evidence={sessions:[]};
try {
  const login=async role=>(await session(browser,role,address(role),settings.PASSWORD,evidence)).page;
  const [ordinary,normal,viewAs]=await Promise.all([login('Admin'),login('Super Admin'),login('Super Admin')]);
  await viewAs.getByRole('button',{name:/Account menu/}).click();
  await button(viewAs,'View As').click();
  await viewAs.getByPlaceholder('Search users...').fill(address('Agent'));
  await viewAs.getByRole('dialog').getByRole('button').filter({hasText:address('Agent')}).click();
  await button(viewAs,'Exit View As').waitFor();
  const old=await contextResult(normal);
  assert.equal(old.status,404);
  assert.equal(old.code,'PGRST202');
  const pre=counts(oldTables);
  const priorDigest=legacyHash();
  const audit=phase => console.log('Installation audit '+phase+'\n'+runSqlFile('supabase/ops/automations_builder_audit.sql',{agency_id:org}).trim());
  const advisors=phase=>{
    if (process.env.AUTOMATIONS_LOCAL_ADVISOR_SQL && process.env.AUTOMATIONS_LOCAL_ADVISOR_OUTPUT)
      writeFileSync(process.env.AUTOMATIONS_LOCAL_ADVISOR_OUTPUT+'-'+phase+'.txt',
        sql(readFileSync(process.env.AUTOMATIONS_LOCAL_ADVISOR_SQL,'utf8'))+'\n',{mode:0o600});
  };
  audit('before'); advisors('before');
  assert.equal(pre['public.workflows'],1);
  assert.equal(pre['public.workflow_executions'],1);
  assert.equal(pre['public.workflow_execution_steps'],1);
  console.log('PASS three real Auth sessions predate installation, including legacy local View As.');
  server.promote();
  const response=await ordinary.goto(APP+'/automations');
  assert.equal(response.headers()['x-local-test-build'],'candidate');
  await ordinary.getByText('Automations are unavailable for this session.').waitFor();
  const start=performance.now();
  await exec('bash',['e2e/automations-local/upgrade.sh','feature']);
  sql("notify pgrst,'reload schema'");
  assert.equal(legacyHash(),priorDigest);
  assert.deepEqual(counts(oldTables),pre);
  assert.deepEqual(Object.values(counts(newTables)),newTables.map(()=>0));
  console.log('PASS twelve ordered migrations (the first release, the first-text sender and the seven V2 files) in '+((performance.now()-start)/1000).toFixed(2)+' s; unchanged six-table legacy hash '+priorDigest+
    '; install deltas zero for definitions, enrollments, messages, contacts and control rows.');
  const duringInstall=await login('Super Admin');
  const gapContext=await contextResult(duringInstall);
  assert.deepEqual([gapContext.status,gapContext.hint],[403,'automation_session_reauth']);
  visibility(org,'show'); visibility(org,'show');
  audit('after show'); advisors('after');
  for (const p of [ordinary,normal,viewAs,duringInstall]) {
    const got=await contextResult(p);
    assert.deepEqual([got.status,got.code,got.hint],[403,'42501','automation_session_reauth']);
  }
  await button(viewAs,'Exit View As').waitFor();
  const required='Sign in again to use Automations after the upgrade.';
  for (const p of [ordinary,normal,viewAs]) {
    await p.goto(APP+'/automations');
    await p.getByText(required,{exact:true}).waitFor();
  }
  await button(viewAs,'Exit View As').waitFor();
  await button(viewAs,'Exit View As').click();
  await button(viewAs,'Exit View As').waitFor({state:'hidden'});
  const refreshed=await contextResult(normal,true);
  assert.equal(refreshed.id,old.id);
  assert.deepEqual([refreshed.status,refreshed.hint],[403,'automation_session_reauth']);
  assert.equal((await contextResult(viewAs)).hint,'automation_session_reauth');
  assert.equal(sql(`select count(*) from private.automation_sessions where actor_id='${ids['Super Admin']}' and session_id in ('${old.id}','${(await contextResult(viewAs)).id}')`),'0');
  const fresh=await login('Super Admin');
  await fresh.goto(APP+'/automations');
  await button(fresh,'Create automation').waitFor();
  const freshCtx=await contextResult(fresh);
  assert.notEqual(freshCtx.id,old.id);
  assert.equal(freshCtx.status,200);
  sql(`update public.profiles set is_super_admin=false,role='Admin' where id='${ids['Super Admin']}'`);
  assert.equal((await contextResult(viewAs)).hint,'automation_session_reauth');
  await ordinary.goto(APP+'/contacts');
  await ordinary.getByRole('heading',{name:'Contacts',exact:true}).waitFor();
  console.log('PASS old ordinary, normal Super Admin, legacy View As and pre-show sessions require a new Auth login for Automations; token refresh, exit and demotion preserve the fence; ordinary CRM remains accessible.');
  const author=await login('Admin');
  await author.goto(APP+'/settings?section=automation&workflow='+oldWorkflow);
  await author.getByRole('heading',{name:'Advanced legacy graph'}).waitFor();
  await author.getByText('This automation uses the original graph format.',{exact:false}).waitFor();
  await button(author,'Execution history').click();
  await author.getByText(/^completed$/i).first().waitFor();
  await releaseControls(author,org);
  await exec('node',['e2e/automations-local/bootstrap.mjs']);
  const built=await exec('node',['e2e/automations-local/builder.mjs'],{maxBuffer:4*1024*1024});
  console.log(built.stdout.trim());
  // Verify retained receipts and edited drafts after the real, loopback-only two-graph browser exercise.
  assert.equal(sql(`select count(*) from private.automation_messages where organization_id='${agency}' and provider_id is not null`),'2');
  assert.equal(sql(`select count(*) from private.automation_runs where organization_id='${agency}' and status='completed'`),'2');
  sql(`update private.automation_release_controls set enrollment_enabled=false,dispatch_enabled=false where organization_id='${agency}'`);
  const before=snapshot();
  for (const target of [org,agency]) { visibility(target,'hide'); visibility(target,'hide'); }
  assert.equal(snapshot(),before); audit('after hide');
  const rollback=await author.goto(APP+'/automations');
  assert.equal(rollback.status(),200);
  await author.getByText('Automations are unavailable for this session.').waitFor();
  assert.equal(sql(`select bool_and(not builder_visible and not enrollment_enabled and not dispatch_enabled) from private.automation_release_controls where organization_id in ('${org}','${agency}')`),'t');
  console.log('PASS data-preserving hide after two completed runs and two provider receipts; identical drafts/versions, graph/history, events, runs, intents, messages and leads. Controls remain off.');
} catch(error) {
  for(const c of browser.contexts()) for (const p of c.pages()) {
    console.error(new URL(p.url()).pathname,(await p.locator('body').innerText().catch(()=>'' )).slice(-700));
  }
  throw error;
} finally { await browser.close(); await server.close(); }
