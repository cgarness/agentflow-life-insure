import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@/index.css';
import {MessageComposePanel} from '@/components/messaging/MessageComposePanel';
import {SmsForm} from '@/components/workflows/panels/actionForms';
function Fixture(){
 const [text,setText]=useState('Your requested appointment is tomorrow.'),[stopped,setStopped]=useState(false),[notice,setNotice]=useState(''),[config,setConfig]=useState<Record<string,unknown>>({body:'Your appointment reminder.'});
 return <main className="mx-auto max-w-3xl p-4 space-y-4"><h1 className="text-xl font-semibold">Synthetic contact · Manual SMS</h1><p>No external services or real messages.</p><section aria-label="Manual composer"><MessageComposePanel channel="sms" onChannelChange={()=>{}} messageText={text} onMessageChange={setText} subjectText="" onSubjectChange={()=>{}} onOpenTemplates={()=>{}} onSendMessage={()=>setNotice(stopped ? 'Synthetic server: recipient opted out.' : 'Synthetic provider unavailable. Draft preserved.')} sendDisabled={!text.trim()}/></section><p role="status">{notice}</p><button onClick={()=>setStopped(true)} className="rounded border p-2">Simulate STOP</button><section className="rounded-xl border p-4"><h2 className="mb-3 font-semibold">Workflow SMS</h2><SmsForm config={config} set={patch=>setConfig({...config,...patch})} templates={[]}/></section></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
