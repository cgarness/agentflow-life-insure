import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { changeContactNumber,contactNumberOptions,readinessLabels,type ContactNumberType,type SenderChoice } from "@/lib/number-affinity";
const schema=z.object({action:z.enum(["one_text","one_call","voice","sms","both","reset"]),number:z.string(),reason:z.string().trim().max(200)}).superRefine((v,c)=>{if(v.action!=="reset"&&!z.string().uuid().safeParse(v.number).success)c.addIssue({code:"custom",path:["number"],message:"Choose an available number."});if(!v.action.startsWith("one_")&&v.reason.length<3)c.addIssue({code:"custom",path:["reason"],message:"Add a short reason for this permanent change."});});
export function ChangeNumberModal({open,onOpenChange,contactId,type,generation,onChanged,onOnce,onClosed}:{open:boolean;onOpenChange:(v:boolean)=>void;contactId:string;type:ContactNumberType;generation:number;onClosed?:()=>void;onChanged:()=>void;onOnce:(kind:"one_text"|"one_call",choice:SenderChoice)=>void}) {
 const {user,profile}=useAuth();
 const [action,setAction]=useState("one_text"),[number,setNumber]=useState(""),[reason,setReason]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const options=useQuery({queryKey:["contact-number-options",profile?.organization_id,user?.id,contactId,type],queryFn:()=>contactNumberOptions(contactId,type),enabled:open,retry:false});
 const submit=async()=>{const parsed=schema.safeParse({action,number,reason});if(!parsed.success){setError(parsed.error.issues[0].message);return;}setBusy(true);setError("");try{
  const v=parsed.data;const choice=options.data?.find(x=>x.id===v.number);if(v.action!=="reset"&&!choice)throw new Error("Choose an available number.");
  if(v.action==="one_text"||v.action==="one_call")onOnce(v.action,choice!);
  else await changeContactNumber(contactId,type,v.action==="reset"?"both":v.action,v.action==="reset"?null:v.number,generation,v.reason);
  onChanged();onOpenChange(false);
 }catch(e){setError(e instanceof Error?e.message:"Number change failed.");}finally{setBusy(false);}};
 return <Dialog open={open} onOpenChange={v=>!busy&&onOpenChange(v)}><DialogContent onCloseAutoFocus={event=>{if(onClosed){event.preventDefault();onClosed();}}} className="w-[calc(100vw-2rem)] max-w-md grid-cols-1"><DialogHeader><DialogTitle>Change contact number</DialogTitle><DialogDescription>A one-time choice keeps the contact’s permanent numbers.</DialogDescription></DialogHeader>
  <label className="grid min-w-0 gap-1 text-sm">Action<select aria-label="Action" className="min-w-0 w-full max-w-full rounded-md border bg-background p-2" value={action} onChange={e=>setAction(e.target.value)}><option value="one_text">Use once for a text</option><option value="one_call">Use once for a call</option><option value="voice">Change calls</option><option value="sms">Change texts</option><option value="both">Change calls and texts</option><option value="reset">Reset both for review</option></select></label>
  {action!=="reset"&&<label className="grid min-w-0 gap-1 text-sm">Number<select aria-label="Number" className="min-w-0 w-full max-w-full rounded-md border bg-background p-2" value={number} onChange={e=>setNumber(e.target.value)}><option value="">Choose a number</option>{options.data?.map(n=><option key={n.id} value={n.id!}>{n.number} · {readinessLabels[action==="one_call"||action==="voice"?n.voice_readiness:n.readiness]??"Unavailable"}</option>)}</select></label>}
  {!action.startsWith("one_")&&<label className="grid min-w-0 gap-1 text-sm">Reason<input className="min-w-0 w-full max-w-full rounded-md border bg-background p-2" maxLength={200} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
  {(error||options.error)&&<p role="alert" className="text-sm text-destructive">{error||"Available numbers could not be loaded."}</p>}
  <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>onOpenChange(false)}>Cancel</Button><Button disabled={busy||options.isPending||options.isError} onClick={()=>void submit()}>{busy?"Saving…":"Confirm choice"}</Button></div>
 </DialogContent></Dialog>;
}
