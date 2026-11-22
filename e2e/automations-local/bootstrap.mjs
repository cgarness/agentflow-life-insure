import { settings, sql, agency, otherAgency, sender, campaign, email } from './fixture.mjs';
import { visibility } from './release-visibility.mjs';
if (sql("show cron.launch_active_jobs") !== 'off') throw Error('Fixture requires disabled jobs');
sql(`insert into organizations(id,name,slug) values ('${agency}','Automation UI A','automation-ui-a'),('${otherAgency}','Automation UI B','automation-ui-b');`);
visibility(agency,'show');
for (const n of ['one','two','other']) {
  const org = n === 'other' ? otherAgency : agency;
  const res = await fetch(settings.API_URL+'/auth/v1/admin/users', {
    method:'POST',headers:{'Content-Type':'application/json',apikey:settings.SERVICE_ROLE_KEY,Authorization:'Bearer '+settings.SERVICE_ROLE_KEY},
    body:JSON.stringify({email:email(n),password:settings.PASSWORD,email_confirm:true,
      user_metadata:{first_name:'Tester',last_name:n,organization_id:org,role:'Admin'}}),
  });
  if (!res.ok) throw Error('Local auth user creation failed '+res.status+' '+(await res.text()).slice(0,100));
}
sql(`update profiles set onboarding_complete=true where organization_id in ('${agency}','${otherAgency}');
insert into campaigns(id,organization_id,name,type,created_by) select '${campaign}','${agency}','UI fixture campaign','Personal',id from profiles where email='${email('two')}';
insert into user_email_connections(id,organization_id,user_id,provider,provider_account_email,access_token_encrypted,status,last_sync_at)
 select '${sender}','${agency}',id,'google','reply@example.invalid','test-only','connected',now() from profiles where email='${email('one')}';
insert into private.automation_email_senders(id,organization_id,connection_id,from_email,verified_until,verification_reference,enabled)
 values ('${sender}','${agency}','${sender}','author@example.invalid',now()+interval '4 hours','Local fixture',true);
insert into private.automation_channel_policies(organization_id,channel,daily_limit,local_start,local_end,reply_max_age,reply_checked_at,enabled)
 select '${agency}',channel,10,((now() at time zone 'UTC')-interval '1 hour')::time,((now() at time zone 'UTC')+interval '1 hour')::time,interval '1 hour',now(),true from unnest(array['email','sms']) channel;
notify pgrst,'reload schema';`);
console.log('Created three isolated browser users, two agencies and channel fixtures.');
