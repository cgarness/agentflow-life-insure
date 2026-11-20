import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ContactNumberControl } from "@/components/contacts/ContactNumberControl";
import { useContactNumberAffinity } from "@/hooks/useContactNumberAffinity";
import { useComposerDraftSink,useMarkObserved,usePendingSmsRecords,useSmsScopeEvents } from "@/hooks/usePendingSms";
import { manualSmsSender } from "@/lib/sms-send/manualSmsSender";
import { pendingSmsStore,smsScopeKey,type SmsIdentityScope } from "@/lib/sms-send/pendingSmsStore";
import { pendingView } from "@/lib/sms-send/smsDisplayMerge";
import { PendingSmsStatus } from "@/components/messaging/PendingSmsStatus";
import { MessageComposePanel } from "@/components/messaging/MessageComposePanel";
export function DialerSmsComposer({contactId,phone,name,text,onChange,onTemplates,onRefresh,savedIds}:{contactId?:string;phone?:string;name:string;text:string;onChange:(v:string)=>void;onTemplates:()=>void;onRefresh:()=>void;savedIds:string[]}) {
 const {user,profile,isImpersonating}=useAuth();
 const scope=useMemo<SmsIdentityScope|null>(()=>contactId&&user?.id&&profile?.id===user.id&&profile.organization_id&&!isImpersonating?{organizationId:profile.organization_id,actorId:user.id,viewerId:profile.id,contactId,contactType:"lead"}:null,[contactId,user?.id,profile?.id,profile?.organization_id,isImpersonating]);
 const key=scope?smsScopeKey(scope):null;const pending=usePendingSmsRecords(key);const draft=useComposerDraftSink(key,"sms",text,onChange);
 const numbers=useContactNumberAffinity(contactId,"lead");const sending=pending.some(r=>r.state==="sending");
 useMarkObserved(pending.filter(r=>r.receipt&&savedIds.includes(r.receipt.messageId)).map(r=>r.localId));
 useSmsScopeEvents(key,()=>{onRefresh();void numbers.refresh();});
 const send=()=>{if(!scope||!phone||!numbers.canText||!text.trim())return;
  const result=manualSmsSender.submit({...scope,to:phone,body:text.trim(),senderPreference:numbers.sender?.number??null,expectedSenderId:numbers.sender?.id??null,overrideSenderId:numbers.override?.id??null,contactLabel:name,origin:{sinkId:draft.sinkId,clear:()=>{const revision=draft.clearForSend();onChange("");return revision;}}});
  if(result.ok)numbers.chooseOneText(null);
 };
 if(isImpersonating)return <p className="p-3 text-xs text-muted-foreground">Read-only while viewing as another user.</p>;
 if(!contactId)return <p className="p-3 text-xs text-muted-foreground">Save or open the contact before texting.</p>;
 return <div className="mt-3 grid gap-2"><ContactNumberControl model={numbers} phone={phone} name={name}/>
  {pending.filter(r=>!r.hidden&&!r.observed).map(r=><div key={r.localId} className="ml-auto max-w-full rounded-lg bg-primary/10 p-2 text-sm"><p className="whitespace-pre-wrap break-words">{r.snapshot.body}</p><PendingSmsStatus view={pendingView(r)} canEdit={!text} onEdit={id=>pendingSmsStore.editIntoComposer(id,draft.sinkId)} onDismiss={pendingSmsStore.dismiss}/></div>)}
  <MessageComposePanel smsOnly channel="sms" onChannelChange={()=>{}} messageText={text} onMessageChange={onChange} subjectText="" onSubjectChange={()=>{}} onOpenTemplates={onTemplates} onSendMessage={send} sendDisabled={!scope||!phone||!text.trim()||sending||!numbers.canText} sendLoading={sending}/>
 </div>;
}
