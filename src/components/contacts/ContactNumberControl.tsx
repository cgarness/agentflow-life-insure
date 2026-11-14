import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChangeNumberModal } from "./ChangeNumberModal";
import { readinessLabels } from "@/lib/number-affinity";
import { dispatchQuickCall } from "@/lib/quick-call";
import type { useContactNumberAffinity } from "@/hooks/useContactNumberAffinity";
export function ContactNumberControl({model,phone,name}:{model:ReturnType<typeof useContactNumberAffinity>;phone?:string;name?:string}) {
 const [open,setOpen]=useState(false);const trigger=useRef<HTMLButtonElement>(null);
 if(model.readOnly||!model.contactId||!model.type)return null;
 if(model.isPending)return <p className="text-xs text-muted-foreground" role="status">Checking contact numbers…</p>;
 if(model.isError||!model.data)return <div className="flex items-center gap-2 text-xs text-destructive" role="alert">Numbers unavailable<Button size="sm" variant="ghost" onClick={()=>void model.refetch()}>Retry</Button></div>;
 if(model.data.voice_mode==="off"&&model.data.sms_mode==="off")return null;
 const sms=model.sender;const review=model.data.history==="needs_review"||model.data.sms.state==="needs_review";
 return <div className="rounded-md border border-border bg-muted/20 p-2 text-xs" aria-label="Contact numbers"><div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span>Calls <strong>{model.data.voice.number??"Eligible rotation"}</strong></span><span>Texts <strong>{sms?.number??"Review required"}</strong>{model.override&&" · once"}</span><Button ref={trigger} size="sm" variant="ghost" className="ml-auto h-7" onClick={()=>setOpen(true)}>Change</Button></div>
  <p className="mt-1 text-muted-foreground">{review&&!model.override?"Number history needs review.":readinessLabels[sms?.readiness??"unavailable"]??"Number unavailable"}</p>
  {model.data.reply&&<p className="mt-1">Last reply received on {model.data.reply.number}. <Button variant="link" className="h-6 px-1 text-xs" disabled={model.data.reply.readiness!=="ready"} onClick={()=>model.chooseOneText(model.data!.reply!)}>Reply once</Button></p>}
  {model.override&&<Button variant="link" className="h-6 px-0 text-xs" onClick={()=>model.chooseOneText(null)}>Keep permanent texting number</Button>}
  <ChangeNumberModal onClosed={()=>trigger.current?.focus()} open={open} onOpenChange={setOpen} contactId={model.contactId} type={model.type} generation={model.data.generation} onChanged={()=>void model.refresh()} onOnce={(kind,choice)=>{if(kind==="one_text")model.chooseOneText(choice);else if(phone&&choice.id)dispatchQuickCall({contactId:model.contactId!,type:model.type!,phone,name:name??"Contact",fromNumber:choice.number??undefined,oneCallNumberId:choice.id});}}/>
 </div>;
}
