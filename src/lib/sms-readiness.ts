import type { SmsPurpose } from "./sms-intent";
import type { SmsConsentStatus } from "@/hooks/useSmsConsentStatus";
export function smsBlockReason(s:SmsConsentStatus|undefined,purpose:SmsPurpose,error?:boolean) {
  if(error) return "Texting status unavailable. Refresh before sending.";
  if(!s) return "Checking texting permissions…";
  if(!s.enforced) return "";
  if(s.suppressed) return "Recipient is blocked by agency DNC or SMS opt-out.";
  if(!s.send_enabled) return "Agency texting is not activated.";
  if(!s.provider_ready) return "Agency registration is not ready.";
  if(!purpose) return "Choose a text purpose.";
  if(!s[purpose]) return `No ${purpose} SMS permission.`;
  if(!s[`${purpose}_confirmed`]) return "Enrollment confirmation is pending.";
  return "";
}
