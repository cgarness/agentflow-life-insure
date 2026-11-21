import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { previewContactNumbers, type ContactNumberAffinity, type ContactNumberType, type SenderChoice } from "@/lib/number-affinity";
import { toE164Plus } from "@/utils/phoneUtils";
export function useContactNumberAffinity(contactId?: string, type?: ContactNumberType, campaign?: string, phone?: string) {
 const {user,profile,isImpersonating}=useAuth();const client=useQueryClient();
 const key=["contact-numbers",profile?.organization_id,user?.id,contactId,type,campaign,...(phone===undefined?[]:[toE164Plus(phone)])];
 const scope=key.join(":");const [oneText,setOneText]=useState<{scope:string;sender:SenderChoice}|null>(null);
 useEffect(()=>setOneText(null),[scope]);
 const query=useQuery({queryKey:key,queryFn:()=>previewContactNumbers(contactId!,type!,campaign),enabled:!!contactId&&!!type&&!!user?.id&&profile?.id===user.id&&!isImpersonating,staleTime:5000,refetchInterval:15000,retry:false});
 const override=oneText?.scope===scope?oneText.sender:null;
 const sender=override??query.data?.sms;
 const guarded=query.data?.sms_mode==="enforced"||query.data?.sms_mode==="guard_only";
 return {...query,contactId,type,readOnly:!!isImpersonating,override,sender,
  canText:!!query.data&&!query.isError&&(!guarded||(!!sender?.id&&sender.readiness==="ready"&&(!!override||(query.data.history!=="needs_review"&&query.data.sms.state!=="needs_review")))),
  chooseOneText:(choice:SenderChoice|null)=>setOneText(choice?{scope,sender:choice}:null),
  acceptPreview:async(data:ContactNumberAffinity)=>{await client.cancelQueries({queryKey:key,exact:true});client.setQueryData(key,data);},
  refresh:()=>client.invalidateQueries({queryKey:["contact-numbers"]}),
 };
}
