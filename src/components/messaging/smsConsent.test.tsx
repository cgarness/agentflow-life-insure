import {useState} from 'react';
import {render,screen,fireEvent,cleanup,renderHook,act} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {MessageComposePanel} from './MessageComposePanel';
import {smsBlockReason} from '@/lib/sms-readiness';
import {SmsReadiness} from './SmsReadiness';
import {SmsIntent,type SmsPurpose} from '@/lib/sms-intent';
import {useScopedDraft} from '@/hooks/useScopedDraft';
import {SmsForm} from '@/components/workflows/panels/actionForms';
import {sendSmsSchema} from '@/lib/workflow-types';
afterEach(cleanup);
const ready={enforced:true,send_enabled:true,provider_ready:true,informational:true,informational_confirmed:true,marketing:false,marketing_confirmed:false};
it('requires deliberate purpose, blocks marketing without permission, preserves draft',()=>{
 const send=vi.fn();
 function Test(){const [text,setText]=useState('Keep this draft'),[purpose,setPurpose]=useState<SmsPurpose>('');const reason=smsBlockReason(ready,purpose);return <MessageComposePanel channel="sms" onChannelChange={()=>{}} messageText={text} onMessageChange={setText} subjectText="" onSubjectChange={()=>{}} onOpenTemplates={()=>{}} onSendMessage={send} smsPurpose={purpose} onSmsPurposeChange={setPurpose} sendDisabled={!!reason} smsStatus={<SmsReadiness data={ready} reason={reason} onRefresh={()=>{}}/>}/>;}
 render(<Test/>);expect(screen.getByTitle('Send SMS')).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Text purpose'),{target:{value:'marketing'}});expect(screen.getByText(/No marketing SMS permission/)).toBeInTheDocument();
 fireEvent.keyDown(screen.getByPlaceholderText('Type SMS message…'),{key:'Enter'});expect(send).not.toHaveBeenCalled();expect(screen.getByDisplayValue('Keep this draft')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Text purpose'),{target:{value:'informational'}});fireEvent.click(screen.getByTitle('Send SMS'));expect(send).toHaveBeenCalledOnce();
});
it('blocks opted-out, paused, missing and unconfirmed readiness',()=>{
 expect(smsBlockReason({...ready,suppressed:true},'informational')).toMatch(/blocked/);
 expect(smsBlockReason({...ready,send_enabled:false},'informational')).toMatch(/not activated/);
 expect(smsBlockReason({...ready,informational_confirmed:false},'informational')).toMatch(/confirmation/);
 expect(smsBlockReason(undefined,'informational',true)).toMatch(/unavailable/);
});
it('stable intents survive retry, bind all scope/payload fields, and reset only after acceptance',()=>{
 const m=new SmsIntent(),p=['actor','org','contact','to','from','body','informational'];const first=m.id(p);expect(m.id(p)).toBe(first);
 for(let i=0;i<p.length;i++){const different=[...p];different[i]+='changed';expect(m.id(different)).not.toBe(first);}
 m.accepted(p);expect(m.id(p)).not.toBe(first);
});
it('draft cannot cross contact/actor scope or clear a new scope from an old completion',()=>{
 const h=renderHook(({scope})=>useScopedDraft(scope),{initialProps:{scope:'a'}});
 act(()=>h.result.current[1]('old draft'));const oldSetter=h.result.current[1];h.rerender({scope:'b'});expect(h.result.current[0]).toBe('');act(()=>h.result.current[1]('new draft'));act(()=>oldSetter(''));expect(h.result.current[0]).toBe('new draft');
 // Production completion is scope-checked before this setter can run. Old text is never exposed.
});
it('workflow template keeps its reviewed marketing purpose and legacy nodes need review',()=>{
 const set=vi.fn();render(<SmsForm config={{body:'hello'}} set={set} templates={[{id:'t',name:'Promotion',type:'sms',subject:null,content:'Offer',sms_purpose:'marketing'}]}/>);
 fireEvent.change(screen.getAllByRole('combobox')[1],{target:{value:'t'}});expect(set).toHaveBeenCalledWith({template_id:'t',body:'Offer',purpose:'marketing'});
 expect(sendSmsSchema.safeParse({body:'old node'}).success).toBe(false);expect(sendSmsSchema.safeParse({body:'reviewed',purpose:'marketing'}).success).toBe(true);
});
