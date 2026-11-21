import { useRef, useState } from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChangeNumberModal } from "./ChangeNumberModal";
import { readinessLabels, type ContactNumberAffinity, type SenderChoice } from "@/lib/number-affinity";
import { dispatchQuickCall } from "@/lib/quick-call";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import type { useContactNumberAffinity } from "@/hooks/useContactNumberAffinity";

type Props = {
 model: ReturnType<typeof useContactNumberAffinity>;
 phone?: string;
 name?: string;
 variant?: "composer" | "details";
};
const detailClass = "min-w-0 rounded-md border border-border/70 bg-muted/40 px-2.5 py-2 text-xs";
const labelClass = "text-[10px] uppercase tracking-wide text-muted-foreground";

// Unassigned/review previews may contain another channel's candidate, not their own assignment.
function assignedNumber(sender: SenderChoice) {
 return ["established", "reserved"].includes(sender.state ?? "") ? sender.number : null;
}

function AssignedNumberDetails({data}: {data: ContactNumberAffinity}) {
 const channels = [
  {label: "Calls", mode: data.voice_mode, sender: data.voice},
  {label: "Texts", mode: data.sms_mode, sender: data.sms},
 ].filter(channel => channel.mode !== "off");
 const numbers = channels.map(channel => assignedNumber(channel.sender));
 const shared = channels.length === 2 && numbers[0] && numbers[0] === numbers[1]
  && data.voice.id === data.sms.id;
 const hasNumber = numbers.some(Boolean);
 const needsReview = data.history === "needs_review" || channels.some(channel => channel.sender.state === "needs_review");

 return <>
  <div className="flex items-start gap-2">
   <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
   <div className="min-w-0 flex-1">
    {shared ? <>
     <p className="break-words text-sm font-semibold tabular-nums text-foreground">{formatPhoneNumber(numbers[0]!)}</p>
     <p className="mt-0.5 text-[11px] text-muted-foreground">Calls &amp; texts</p>
    </> : !hasNumber ? (
     <p className="text-sm text-muted-foreground">{needsReview ? "Review required" : "Not assigned"}</p>
    ) : channels.map(({label, sender}) => (
     <div key={label} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="w-8 text-[11px] text-muted-foreground">{label}</span>
      <span className="break-words text-sm font-semibold tabular-nums text-foreground">
       {assignedNumber(sender) ? formatPhoneNumber(assignedNumber(sender)!) : sender.state === "needs_review" ? "Review required" : "Not assigned"}
      </span>
     </div>
    ))}
   </div>
  </div>
  {needsReview && hasNumber && <p className="mt-1.5 text-muted-foreground">Review required</p>}
  {data.sms_mode !== "off" && data.sms.state === "reserved" && <p className="mt-1.5 text-muted-foreground">Text pending</p>}
  {!needsReview && channels.filter(({sender}) => sender.readiness !== "ready").map(({label, sender}) => (
   <p key={label} className="mt-1.5 text-muted-foreground">{label}: {readinessLabels[sender.readiness] ?? "Number unavailable"}</p>
  ))}
 </>;
}

export function ContactNumberControl({model,phone,name,variant="composer"}: Props) {
 const [open,setOpen]=useState(false);const trigger=useRef<HTMLButtonElement>(null);
 const details=variant==="details";
 if(model.readOnly||!model.contactId||!model.type)return null;
 if(model.isPending)return <div className={details?detailClass:undefined} role="status">
  {details&&<p className={`${labelClass} mb-1`}>Assigned Number</p>}
  <p className="text-xs text-muted-foreground">Checking contact numbers…</p>
 </div>;
 if(model.isError||!model.data)return <div className={details?detailClass:undefined} role="alert">
  {details&&<p className={labelClass}>Assigned Number</p>}
  <div className="flex items-center gap-2 text-xs text-destructive">Numbers unavailable<Button size="sm" variant="ghost" onClick={()=>void model.refetch()}>Retry</Button></div>
 </div>;
 if(model.data.voice_mode==="off"&&model.data.sms_mode==="off")return null;
 const sms=model.sender;const review=model.data.history==="needs_review"||model.data.sms.state==="needs_review";
 const distinctNumbers=new Set([
  model.data.voice_mode!=="off"?assignedNumber(model.data.voice):null,
  model.data.sms_mode!=="off"?assignedNumber(model.data.sms):null,
 ].filter(Boolean)).size;
 const change=<Button ref={trigger} size="sm" variant="ghost" className={details?"-mr-1 h-11 px-2 text-xs sm:h-7":"ml-auto h-7"} onClick={()=>setOpen(true)}>Change</Button>;
 return <div className={details?detailClass:"rounded-md border border-border bg-muted/20 p-2 text-xs"} role="group" aria-label="Contact numbers">
  {details ? <>
   <div className="mb-1 flex items-center justify-between gap-2">
    <p className={labelClass}>{distinctNumbers>1?"Assigned Numbers":"Assigned Number"}</p>
    {change}
   </div>
   <AssignedNumberDetails data={model.data} />
  </> : <>
   <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span>Calls <strong>{model.data.voice.number??"Eligible rotation"}</strong></span><span>Texts <strong>{sms?.number??"Review required"}</strong>{model.override&&" · once"}</span>{change}</div>
   <p className="mt-1 text-muted-foreground">{review&&!model.override?"Number history needs review.":readinessLabels[sms?.readiness??"unavailable"]??"Number unavailable"}</p>
  </>}
  {model.data.reply&&<p className="mt-1 text-muted-foreground">Last reply received on {details?formatPhoneNumber(model.data.reply.number??""):model.data.reply.number}. <Button variant="link" className="h-6 px-1 text-xs" disabled={model.data.reply.readiness!=="ready"} onClick={()=>model.chooseOneText(model.data!.reply!)}>Reply once</Button></p>}
  {model.override&&(details ? <div className="mt-2 border-t border-border pt-2">
   <div className="flex flex-wrap items-center justify-between gap-2">
    <div><p className="text-[11px] text-muted-foreground">This text only</p><p className="font-medium tabular-nums">{formatPhoneNumber(model.override.number??"")}</p></div>
    <Button variant="ghost" className="h-11 px-2 text-xs sm:h-7" onClick={()=>model.chooseOneText(null)}>Clear</Button>
   </div>
   {model.override.readiness!=="ready"&&<p className="mt-1 text-muted-foreground">{readinessLabels[model.override.readiness]??"Number unavailable"}</p>}
  </div> : <Button variant="link" className="h-6 px-0 text-xs" onClick={()=>model.chooseOneText(null)}>Keep permanent texting number</Button>)}
  <ChangeNumberModal onClosed={()=>trigger.current?.focus()} open={open} onOpenChange={setOpen} contactId={model.contactId} type={model.type} generation={model.data.generation} onChanged={()=>void model.refresh()} onOnce={(kind,choice)=>{if(kind==="one_text")model.chooseOneText(choice);else if(phone&&choice.id)dispatchQuickCall({contactId:model.contactId!,type:model.type!,phone,name:name??"Contact",fromNumber:choice.number??undefined,oneCallNumberId:choice.id});}}/>
 </div>;
}
