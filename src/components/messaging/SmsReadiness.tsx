import type { SmsConsentStatus } from "@/hooks/useSmsConsentStatus";
export function SmsReadiness({data,reason,onRefresh}:{data?:SmsConsentStatus;reason:string;onRefresh:()=>void}) {
  return <div className="mt-2 text-xs text-muted-foreground" aria-live="polite">
    {data?.enforced && <p>Informational: {data.informational?"granted":"not granted"} · Marketing: {data.marketing?"granted":"not granted"}</p>}
    {reason && <p>{reason} <button type="button" className="underline" onClick={onRefresh}>Refresh</button></p>}
  </div>;
}
