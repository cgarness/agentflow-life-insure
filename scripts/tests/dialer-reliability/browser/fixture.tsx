// Test-only: production hooks/controls, synthetic deferred boundaries. Never imported by the app.
import React, {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,useSearchParams} from 'react-router-dom';
import {useDialerNavigation,useDialerContactUrl} from '@/hooks/useDialerNavigation';
import {useDialerStateMachine} from '@/hooks/useDialerStateMachine';
import {DialerPrimaryActions} from '@/components/dialer/DialerPrimaryActions';
import {runGatedCall} from '@/pages/dialerCallGate';
import '@/index.css';
const leads=['a','b','c'].map(id=>({id,lead_id:`contact-${id}`,first_name:`Synthetic ${id}`}));
function Fixture(){
 const [params,setParams]=useSearchParams();const [scope,setScope]=useState('one');
 const nav=useDialerNavigation<typeof leads[number]>(scope);
 const [draft,setDraft]=useState(''),[auto,setAuto]=useState(false),[paused,setPaused]=useState(false);
 const [writes,setWrites]=useState(0),[dials,setDials]=useState(0),[state,setState]=useState('Ready');
 const pending=useRef<(()=>void)|null>(null),hasDialed=useRef({current:true});
 const blocked=nav.isAdvancing||!!draft;
 useDialerContactUrl({scope,contact:params.get('contact'),lead:nav.currentLead,queue:nav.leadQueue,loading:false,
  blocked:()=>blocked,select:nav.setCurrentLeadIndex,write:contact=>setParams(contact?{contact}:{},{replace:true})});
 const wait=()=>new Promise<void>(r=>{pending.current=r;});
 const call=async()=>{const action=nav.begin();if(!action)return;setState('Checking');
  await runGatedCall({isCurrent:action.isCurrent,ensureSession:async()=>{await wait();return true;},checkDnc:async()=>false,onDncBlocked:()=>{},incrementStats:()=>{},dispatch:async()=>{setDials(n=>n+1);return true;}});
  setState('Ready');action.finish();};
 useDialerStateMachine({isAutoDialEnabled:auto&&!paused,currentLead:nav.currentLead,twilioCallState:'idle',twilioStatus:'ready',hasDialedOnce:hasDialed.current,showWrapUp:!!draft,isAdvancing:nav.isAdvancing,
  checkCallingHours:()=>false,onBlocked:()=>{setPaused(true);setState('Outside calling hours');},onCall:()=>void call()});
 const skip=async()=>{if(blocked)return;const action=nav.begin();if(!action)return;setWrites(n=>n+1);await wait();
  if(action.isCurrent()){const queue=nav.getSelection().queue;const next=queue.find(l=>l.id!==nav.currentLead?.id);nav.commitQueue([...queue].reverse(),next?.id??null);}action.finish();};
 return <main className="min-h-screen bg-background text-foreground p-8 flex flex-col gap-4 max-w-xl">
  <h1 className="text-xl font-bold">Synthetic dialer reliability test</h1><p data-testid="selected">{nav.currentLead?.id??'none'}</p>
  <p data-testid="status">{state}</p><p data-testid="writes">{writes}</p><p data-testid="dials">{dials}</p>
  <DialerPrimaryActions voiceCallState="idle" voiceCallDuration={0} claimRingActive={false} campaignType="Personal" fmtDuration={()=>'0:00'} onHangUp={()=>{}} onCall={()=>void call()} onSkip={()=>void skip()} callBlockedReason={blocked?'Action pending or unsaved outcome':null} skipBlockedReason={blocked?'Action pending or unsaved outcome':null}/>
  <label>Outcome notes<input aria-label="Outcome notes" value={draft} onChange={e=>setDraft(e.target.value)} className="border text-foreground bg-background"/></label>
  <button onClick={()=>nav.commitQueue(leads,'b')}>Load synthetic queue</button>
  <button onClick={()=>pending.current?.()}>Resolve response</button>
  <button onClick={()=>setScope(s=>s+'-next')}>Switch scope</button>
  <button onClick={()=>nav.setLeadQueue(q=>[...q].reverse())}>Resort queue</button>
  <button onClick={()=>setParams({contact:'contact-c'})}>External contact link</button>
  <button onClick={()=>{setAuto(true);setPaused(false);}}>Enable Auto Dial</button>
 </main>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Fixture/></BrowserRouter>);
