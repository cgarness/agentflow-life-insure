import { useSmsConsentStatus } from "@/hooks/useSmsConsentStatus";
export function SmsConsentReadiness() {
  const q=useSmsConsentStatus(),s=q.data;
  return <div className="rounded-xl border p-4 text-sm" aria-live="polite"><p className="font-medium">Website consent and sending</p>
    {q.error ? <p>Consent connection status is unavailable.</p> : !s ? <p>Checking…</p> : !s.enforced ? <p>Website consent connection has not been activated.</p> : <>
      <p>Agency texting: {s.send_enabled?"activated":"paused"} · Registration: {s.provider_ready?"approved":"pending"}</p>
      <p>{s.selected_senders} selected senders · {s.pending_confirmations} pending confirmations · {s.review_sends} sends need review · {s.pending_suppressions} opt-outs awaiting website sync</p>
    </>}
    <button className="mt-2 underline" onClick={()=>void q.refetch()} type="button">Refresh consent status</button>
  </div>;
}
