import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@/index.css';
import {MessageComposePanel} from '@/components/messaging/MessageComposePanel';
import {SmsReadiness} from '@/components/messaging/SmsReadiness';
import {smsBlockReason} from '@/lib/sms-readiness';
import type {SmsPurpose} from '@/lib/sms-intent';
import {SmsForm} from '@/components/workflows/panels/actionForms';
function Fixture(){
 const [purpose,setPurpose]=useState<SmsPurpose>(''),[text,setText]=useState('Your requested appointment is tomorrow.'),[stopped,setStopped]=useState(false),[notice,setNotice]=useState(''),[config,setConfig]=useState<Record<string,unknown>>({body:'Your appointment reminder.'});
 const status={enforced:true,send_enabled:true,provider_ready:true,suppressed:stopped,informational:true,marketing:false,informational_confirmed:true,marketing_confirmed:false};
 const reason=smsBlockReason(status,purpose);
 return <main className="mx-auto max-w-3xl p-4 space-y-4"><h1 className="text-xl font-semibold">Synthetic contact · SMS consent</h1><p>No external services or real messages.</p><MessageComposePanel channel="sms" onChannelChange={()=>{}} messageText={text} onMessageChange={setText} subjectText="" onSubjectChange={()=>{}} onOpenTemplates={()=>{}} onSendMessage={()=>setNotice('Synthetic provider unavailable. Draft preserved.')} sendDisabled={!!reason} smsPurpose={purpose} onSmsPurposeChange={setPurpose} smsStatus={<SmsReadiness data={status} reason={reason} onRefresh={()=>{}}/>}/><p role="status">{notice}</p><button onClick={()=>setStopped(true)} className="rounded border p-2">Simulate STOP</button><section className="rounded-xl border p-4"><h2 className="mb-3 font-semibold">Workflow SMS</h2><SmsForm config={config} set={patch=>setConfig({...config,...patch})} templates={[]}/></section></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
