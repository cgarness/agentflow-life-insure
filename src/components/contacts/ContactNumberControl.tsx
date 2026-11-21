import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChangeNumberModal } from "./ChangeNumberModal";
import { readinessLabels, type ContactNumberAffinity } from "@/lib/number-affinity";
import { dispatchQuickCall } from "@/lib/quick-call";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { contactAssignment } from "@/lib/contact-from-number";
import type { useContactNumberAffinity } from "@/hooks/useContactNumberAffinity";

type Props = {
 model: ReturnType<typeof useContactNumberAffinity>;
 phone?: string;
 name?: string;
 variant?: "composer" | "details";
 assignedPreview?: ContactNumberAffinity;
};
const detailClass = "min-w-0 rounded-md border border-border/70 bg-muted/40 px-2.5 py-2 text-xs";
const labelClass = "text-[10px] uppercase tracking-wide text-muted-foreground";

function AssignedNumberDetails({data}: {data: ContactNumberAffinity}) {
 const assignment=contactAssignment(data);
 return <div className={detailClass} role="group" aria-label="Contact numbers">
  <p className={`${labelClass} mb-1`}>Assigned Number</p>
  {assignment.split ? <div className="space-y-0.5 text-sm">
   <p><span className="mr-2 text-xs text-muted-foreground">Calls</span><span className="font-semibold tabular-nums">{formatPhoneNumber(assignment.voice!.number!)}</span></p>
   <p><span className="mr-2 text-xs text-muted-foreground">Texts</span><span className="font-semibold tabular-nums">{formatPhoneNumber(assignment.sms!.number!)}</span></p>
  </div> : <p className={`break-words text-sm ${assignment.number ? "font-semibold tabular-nums text-foreground" : "text-muted-foreground"}`}>
   {assignment.number ? formatPhoneNumber(assignment.number) : assignment.review ? "Review required" : "Not assigned"}
  </p>}
  {assignment.pending&&<p className="mt-1 text-xs text-muted-foreground">Text pending</p>}
  {assignment.review&&assignment.number&&<p className="mt-1 text-xs text-muted-foreground">Review required</p>}
 </div>;
}

export function ContactNumberControl({model,phone,name,variant="composer",assignedPreview}: Props) {
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
 if(details)return <AssignedNumberDetails data={assignedPreview??model.data} />;
 const sms=model.sender;const review=model.data.history==="needs_review"||model.data.sms.state==="needs_review";
 return <div className="rounded-md border border-border bg-muted/20 p-2 text-xs" role="group" aria-label="Contact numbers">
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span>Calls <strong>{model.data.voice.number??"Eligible rotation"}</strong></span><span>Texts <strong>{sms?.number??"Review required"}</strong>{model.override&&" · once"}</span>
   <Button ref={trigger} size="sm" variant="ghost" className="ml-auto h-7" onClick={()=>setOpen(true)}>Change</Button>
  </div>
  <p className="mt-1 text-muted-foreground">{review&&!model.override?"Number history needs review.":readinessLabels[sms?.readiness??"unavailable"]??"Number unavailable"}</p>
  {model.data.reply&&<p className="mt-1 text-muted-foreground">Last reply received on {model.data.reply.number}. <Button variant="link" className="h-6 px-1 text-xs" disabled={model.data.reply.readiness!=="ready"} onClick={()=>model.chooseOneText(model.data!.reply!)}>Reply once</Button></p>}
  {model.override&&<Button variant="link" className="h-6 px-0 text-xs" onClick={()=>model.chooseOneText(null)}>Keep permanent texting number</Button>}
  <ChangeNumberModal onClosed={()=>trigger.current?.focus()} open={open} onOpenChange={setOpen} contactId={model.contactId} type={model.type} generation={model.data.generation} onChanged={()=>void model.refresh()} onOnce={(kind,choice)=>{if(kind==="one_text")model.chooseOneText(choice);else if(phone&&choice.id)dispatchQuickCall({contactId:model.contactId!,type:model.type!,phone,name:name??"Contact",fromNumber:choice.number??undefined,oneCallNumberId:choice.id});}}/>
 </div>;
}
