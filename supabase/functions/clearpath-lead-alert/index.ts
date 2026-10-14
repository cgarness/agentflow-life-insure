import { database } from '../_shared/a2p/auth.ts';
import { registeredSender } from '../_shared/a2p/sending.ts';
import { dispatch } from '../_shared/sms/dispatch.ts';
import { checked } from '../_shared/sms/consent.ts';
import { SmsError } from '../_shared/sms/wire.ts';
import { handle, type Alert } from './handler.ts';

// Owner-authorized, fixed-purpose integration. No arbitrary recipient/body/org.
const ORG='a0000000-0000-0000-0000-000000000001';
const ACTOR='ecf2bb91-0350-4542-85ec-14d914311e99';
const FROM='+19162998778', TO='+19097756963';
async function run(a: Alert) {
  const db=database(), requestKey=`clearpath:${a.kind}:${a.id}`;
  if(a.action==='send') {
    const body=a.kind==='test'
      ? 'CG Financial / ClearPath TEST: New-lead alerts are connected. No new prospect was created. Reply STOP to opt out.'
      : `CG Financial / ClearPath: A new verified website lead was saved. Request ${a.id.slice(0,8)}. Check your lead records. Reply STOP to opt out.`;
    const receipt=await dispatch(db,{org:ORG,actor:ACTOR,key:requestKey,to:TO,from:FROM,body,purpose:'informational'});
    if(!receipt)throw new SmsError('ALERT_DISABLED','Agency alerts unavailable',503);
    return {success:true,status:receipt.status,message_sid:receipt.provider_message_id,replayed:receipt.replayed};
  }
  const row=checked(await db.from('sms_dispatches').select('provider_sid,provider_status,state,error_code').eq('organization_id',ORG).eq('request_key',requestKey).eq('phone_e164',TO).eq('from_number',FROM).maybeSingle());
  if(!row)return {success:false,status:'not_found'};
  if(!row.provider_sid)return {success:false,status:row.state,error_code:row.error_code};
  if(!/^SM[0-9a-f]{32}$/i.test(row.provider_sid))throw new SmsError('ALERT_RECEIPT','Invalid receipt',503);
  const c=await registeredSender(db,ORG,FROM,ACTOR);
  if(!c)throw new SmsError('ALERT_DISABLED','Agency alerts unavailable',503);
  const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages/${row.provider_sid}.json`,{headers:{Authorization:'Basic '+btoa(c.accountSid+':'+c.authToken)},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new SmsError('ALERT_STATUS','Delivery status unavailable',503);
  const data=await response.json();
  return {success:true,status:data.status,message_sid:row.provider_sid,error_code:data.error_code??null};
}
Deno.serve(req=>handle(req,run));
