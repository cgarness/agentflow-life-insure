import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { campaignApproved, type Overview, statusLabel } from "./types";
export function A2pStatus({ data, busy, attach }: { data: Overview; busy: boolean; attach: (id: string) => void }) {
  const r = data.registration, approved = campaignApproved(r);
  const fresh = !!r?.last_synced_at && !r.sync_error && Date.now() - Date.parse(r.last_synced_at) < 86400000;
  const ready = data.numbers.filter((n) =>
    n.status === "registered" && n.pool_member && fresh && approved && data.account_enabled && data.sms_enforced
  );
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        {[["Business / brand", statusLabel(r?.brand_status)], ["Messaging campaign", statusLabel(r?.campaign_status)], [
          "Phone numbers",
          ready.length ? `${ready.length} ready to text` : "Not ready to text",
        ]].map(([title, label]) => (
          <div key={title} className="rounded-xl border bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
            <p className="mt-2 text-lg font-semibold">{label}</p>
          </div>
        ))}
      </div>
      {r?.brand_status === "APPROVED" && !approved && r.identity_status &&
        !["VERIFIED", "VETTED_VERIFIED"].includes(r.identity_status) && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
          Brand identity verification still needs attention:{" "}
          {statusLabel(r.identity_status)}. Follow the verification email or text from Twilio; contact support if it has
          expired.
        </p>
      )}
      {r?.is_test && (
        <p role="alert" className="text-sm text-destructive">
          This is a test registration and cannot enable live texting.
        </p>
      )}
      {r?.sync_error && <p role="alert" className="text-sm text-destructive">{r.sync_error}</p>}
      {(["brand", "campaign"] as const).map((stage) => {
        const errors = stage === "brand" ? r?.brand_errors : r?.campaign_errors;
        return errors?.length
          ? (
            <section key={stage} className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
              <h4 className="font-semibold">
                {stage === "brand" ? "Business / brand" : "Campaign"} review needs attention
              </h4>
              <ul className="mt-2 space-y-2 text-sm">
                {errors.map((e, i) => <li key={i}>{e.code && <strong>{e.code}: </strong>}{e.message}</li>)}
              </ul>
              <p className="mt-3 text-sm text-muted-foreground">
                Open the affected registration to review the provider’s correction instructions. Some rejections require
                support rather than resubmission.
              </p>
            </section>
          )
          : null;
      })}
      <section className="rounded-xl border bg-card p-5">
        <h4 className="font-semibold">Texting numbers</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Campaign approval and number registration are separate. Toll-free numbers require their own verification.
        </p>
        <div className="mt-4 divide-y">
          {data.phones.length
            ? data.phones.map((p) => {
              const n = data.numbers.find((x) => x.phone_number_id === p.id);
              const isReady = ready.some((x) => x.phone_number_id === p.id);
              return (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{p.phone_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.assignment_type === "personal" ? "Personal number" : "Agency number"}
                    </p>
                    {n?.failure_reason && <p className="mt-1 max-w-lg text-sm text-destructive">{n.failure_reason}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={isReady ? "default" : "outline"}>
                      {isReady
                        ? "Ready to text"
                        : n?.status === "registered"
                        ? "Checking readiness"
                        : statusLabel(n?.status ?? "not_started")}
                    </Badge>
                    {(!n || !n.pool_member) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !approved || !data.setup_ready || r?.operation_pending}
                        onClick={() => attach(p.id)}
                      >
                        {n ? "Retry number link" : "Register number"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
            : <p className="text-sm text-muted-foreground">No active agency phone numbers.</p>}
        </div>
      </section>
      <details className="rounded-xl border bg-card p-5">
        <summary className="cursor-pointer font-semibold">Registration history</summary>
        <ol className="mt-4 space-y-3">
          {data.history.length
            ? data.history.map((e) => (
              <li key={e.id} className="text-sm">
                <p className="font-medium">
                  {({
                    fee_authorization: "Fees reviewed and authorized",
                    secure_form_opened: "Secure registration form opened",
                    provider_status: "Provider review status updated",
                    number_status: "Phone-number status updated",
                    number_link_requested: "Phone-number registration requested",
                  } as Record<string, string>)[e.kind] ?? "Registration updated"}
                </p>
                <p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</p>
                {e.kind === "provider_status" && (
                  <p className="text-muted-foreground">
                    Brand: {statusLabel(String(e.detail.brand_status))} · Campaign:{" "}
                    {statusLabel(String(e.detail.campaign_status))}
                  </p>
                )}
              </li>
            ))
            : <li className="text-sm text-muted-foreground">No submissions or status updates yet.</li>}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">Showing the latest 50 entries.</p>
      </details>
    </>
  );
}
