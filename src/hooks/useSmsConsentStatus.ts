import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
export interface SmsConsentStatus {
  enforced: boolean; send_enabled?: boolean; provider_ready?: boolean; suppressed?: boolean;
  informational?: boolean; marketing?: boolean; informational_confirmed?: boolean; marketing_confirmed?: boolean;
  selected_senders?: number; pending_confirmations?: number; review_sends?: number; pending_suppressions?: number;
}
export function useSmsConsentStatus(contactId?: string, contactType?: string) {
  const {user,profile,isImpersonating} = useAuth();
  const enabled = !!user?.id && !!profile?.organization_id && user.id === profile.id && !isImpersonating;
  return useQuery({
    queryKey:["sms-consent",user?.id,profile?.id,profile?.organization_id,contactId,contactType,isImpersonating],
    enabled, staleTime:0, retry:false,
    queryFn:async ():Promise<SmsConsentStatus> => {
      const {data:{session}} = await supabase.auth.getSession();
      if (!session || session.user.id !== user?.id) throw new Error("Sign in again to check texting permissions.");
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-consent-status`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action:"status",actor_id:user.id,organization_id:profile?.organization_id,contact_id:contactId,contact_type:contactType,view_as:false})});
      const body = await res.json(); if(!res.ok) throw new Error(body.error || "Texting status unavailable."); return body;
    },
  });
}
