import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { sql, agency, campaign, email } from './fixture.mjs';

const contact = 'ba921000-0000-4000-8000-000000000020';
const phoneId = 'ba921000-0000-4000-8000-000000000021';
const destination = '+12025550182';
export function prepareEvents() {
  const owner = sql(`select id from profiles where organization_id='${agency}' and email='${email('one')}'`);
  assert.match(owner,/^[\da-f-]{36}$/);
  // Install only the sender and recipient facts for this explicitly synthetic organization.
  const from = '+12025550181';
  const account = 'AC'+'b1'.padStart(32,'0'), number = 'PN'+'b1'.padStart(32,'0'), service = 'MG'+'b1'.padStart(32,'0');
  sql(`begin;
    insert into phone_numbers(id,organization_id,phone_number,status,assignment_type,is_default,twilio_sid,daily_call_limit)
      values ('${phoneId}','${agency}','${from}','active','agency',true,'${number}',500);
    insert into sms_agency_policies(organization_id,enforced,send_enabled,uv_profile_id,uv_project,sender_name,selected_phone_ids,active_from)
      values ('${agency}',true,true,'${owner}','jzdzeevjpootbeuniygx','Fixture agency',array['${phoneId}'::uuid],now()-interval '1 hour');
    insert into a2p_accounts(organization_id,account_sid,account_scope,primary_profile_sid,fee_version,fees,fees_valid_until,enabled,sms_enforced)
      values ('${agency}','${account}','master','BU000000000000000000000000000000b1','synthetic','[{"amount":0}]',now()+interval '1 day',true,true);
    insert into a2p_registrations(organization_id,created_by,account_sid,brand_status,identity_status,campaign_status,messaging_service_sid,is_test,last_synced_at)
      values ('${agency}','${owner}','${account}','APPROVED','VERIFIED','VERIFIED','${service}',false,now());
    insert into a2p_numbers(organization_id,phone_number_id,phone_sid,messaging_service_sid,status,pool_member,checked_at)
      values ('${agency}','${phoneId}','${number}','${service}','registered',true,now());
    insert into private.contact_number_reconciliation(organization_id,complete) values ('${agency}',true);
    select public.set_contact_number_modes('${agency}','enforced','enforced');
    -- Wording an author writes in the builder needs marketing consent, so the synthetic contact has both kinds.
    insert into sms_enrollments(organization_id,phone_e164,informational_confirmed,marketing_confirmed) values ('${agency}','${destination}',true,true);
    update private.automation_release_controls set dispatch_enabled=true where organization_id='${agency}';
    insert into leads(id,organization_id,lead_source,first_name,last_name,email,phone,user_id,assigned_agent_id)
      values ('${contact}','${agency}','UI event','Blake','Example','blake@example.invalid','${destination}','${owner}','${owner}');
    insert into private.automation_recipient_facts(organization_id,contact_type,contact_id,channel,destination,timezone_name,valid_until,email_permission,evidence_reference)
      values ('${agency}','lead','${contact}','email','blake@example.invalid','UTC',now()+interval '1 day',true,'Synthetic consent'),
             ('${agency}','lead','${contact}','sms','${destination}','UTC',now()+interval '1 day',false,'Synthetic consent');
    insert into campaigns(id,name,type,organization_id,created_by) values ('ba921000-0000-4000-8000-000000000022','Unselected campaign','Personal','${agency}','${owner}');
    insert into campaign_leads(organization_id,campaign_id,lead_id) values ('${agency}','ba921000-0000-4000-8000-000000000022','${contact}');
    insert into campaign_leads(organization_id,campaign_id,lead_id) values ('${agency}','${campaign}','${contact}') on conflict do nothing;
    insert into campaign_leads(organization_id,campaign_id,lead_id) values ('${agency}','${campaign}','${contact}') on conflict do nothing;
    commit;`);
}
export function worker() {
  const output = execFileSync(process.env.DENO_BIN || 'deno', [
    'run','--cached-only','--node-modules-dir=manual','--no-lock',
    '--import-map='+(process.env.AUTOMATION_IMPORT_MAP || 'scripts/deno-ci-import-map.json'),
    '--allow-env','--allow-read','--allow-net='+new URL(JSON.parse(readFileSync(process.env.AUTOMATIONS_LOCAL_SETTINGS)).API_URL).host+',127.0.0.1:54334',
    'e2e/automations-local/worker.ts',
  ], { encoding:'utf8', env:{...process.env,AUTOMATION_TEST_SETTINGS:process.env.AUTOMATIONS_LOCAL_SETTINGS} });
  return JSON.parse(output.trim());
}
