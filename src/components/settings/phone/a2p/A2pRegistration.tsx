import { SmsConsentReadiness } from "./SmsConsentReadiness";
import { lazy, Suspense, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { A2pPreparation } from "./A2pPreparation";
import { A2pStatus } from "./A2pStatus";
import { useA2pRegistration } from "./useA2pRegistration";
import { brandApproved } from "./types";
const A2pSession = lazy(() => import("./A2pSession"));
const editable = (s: string | undefined) => !s || ["not_started", "draft", "DRAFT", "FAILED", "REJECTED"].includes(s);
function RegistrationContent({ actor, org }: { actor: string; org: string }) {
  const api = useA2pRegistration(actor, org);
  const [accepted, setAccepted] = useState<string | null>(null);
  const d = api.data, r = d?.registration;
  if (!d) {
    return (
      <div className="rounded-xl border p-6" aria-live="polite">
        {api.error
          ? (
            <>
              <p role="alert" className="text-sm text-destructive">{api.error}</p>
              <Button
                className="mt-3"
                variant="outline"
                disabled={api.busy}
                onClick={() => void api.retry()}
              >
                Retry
              </Button>
            </>
          )
          : <p className="text-sm text-muted-foreground">Loading A2P registration…</p>}
      </div>
    );
  }
  const blocked = api.busy || !d.setup_ready || !r || r.operation_pending || accepted !== d.fee_version;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="h-5 w-5 text-primary" />A2P Registration
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Register your agency to send business texts from US local numbers.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={api.busy || !r} onClick={() => void api.refresh()}>
          <RefreshCw className={`mr-2 h-4 w-4 ${api.busy ? "animate-spin" : ""}`} />Refresh status
        </Button>
      </div>
      {api.error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {api.error}
        </p>
      )}
      {!d.setup_ready && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="font-medium">Account setup required</p>
          <p className="mt-1 text-sm text-muted-foreground">
            You can save your preparation now. An administrator must verify the registration account, enable secure
            registration access, reconcile any existing registrations, and confirm current fees before submission opens.
          </p>
        </div>
      )}
      {r?.operation_pending && (
        <p role="alert" className="rounded-lg border p-3 text-sm">
          A registration action is in progress or its result needs reconciliation. Refresh status; if this remains,
          contact support before submitting again.
        </p>
      )}
      <SmsConsentReadiness />
      <A2pStatus data={d} busy={api.busy} attach={(id) => void api.attach(id)} />
      <p className="text-xs text-muted-foreground">
        {r?.last_synced_at
          ? `Last checked ${new Date(r.last_synced_at).toLocaleString()}`
          : "Status has not been checked yet."}{" "}
        Approval updates and required actions appear in agency administrators’ notifications.
      </p>
      {api.session
        ? (
          <Suspense fallback={<p className="text-sm text-muted-foreground">Opening secure form…</p>}>
            <A2pSession session={api.session} onClose={api.close} />
          </Suspense>
        )
        : (
          <>
            <A2pPreparation
              initial={r?.draft}
              initialVersion={r?.version ?? null}
              busy={api.busy || !!r?.operation_pending}
              onSave={api.save}
            />
            <section className="space-y-4 rounded-xl border bg-card p-5">
              <div>
                <h4 className="font-semibold">Review fees and continue</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  The secure form includes the full application, required evidence, review, and final submission. Open
                  an existing registration to resume or correct an eligible rejection.
                </p>
              </div>
              {d.fees.length
                ? (
                  <dl className="divide-y rounded-lg border px-3">
                    {d.fees.map((f, i) => (
                      <div key={i} className="flex items-center justify-between gap-4 py-2 text-sm">
                        <dt>{f.label}</dt>
                        <dd className="font-medium">{f.amount}</dd>
                      </div>
                    ))}
                  </dl>
                )
                : <p className="text-sm text-muted-foreground">Current fees must be confirmed before submission.</p>}
              <div className="flex items-start gap-2">
                <Checkbox
                  id="a2p-fees"
                  checked={!!d.fee_version && accepted === d.fee_version}
                  disabled={!d.setup_ready || api.busy}
                  onCheckedChange={(v) => setAccepted(v === true ? d.fee_version : null)}
                />
                <label htmlFor="a2p-fees" className="text-sm leading-5">
                  I am authorized to register this business and accept the listed registration, recurring, and
                  applicable resubmission fees.
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button disabled={blocked || !editable(r?.brand_status)} onClick={() => void api.open("brand")}>
                  {r && r.brand_status !== "not_started"
                    ? "Resume / correct business registration"
                    : "Start business registration"}
                </Button>
                <Button
                  variant="outline"
                  disabled={blocked || !brandApproved(r ?? null) || !editable(r?.campaign_status)}
                  onClick={() => void api.open("campaign")}
                >
                  {r && r.campaign_status !== "not_started"
                    ? "Resume / correct campaign"
                    : "Register messaging campaign"}
                </Button>
              </div>
            </section>
          </>
        )}
    </div>
  );
}
export default function A2pRegistration() {
  const { user, realProfile, isImpersonating } = useAuth();
  if (isImpersonating) {
    return (
      <p className="rounded-xl border p-5 text-sm text-muted-foreground">Exit View As to manage A2P registration.</p>
    );
  }
  if (
    !user || !realProfile?.organization_id || realProfile.id !== user.id || realProfile.status !== "Active" ||
    !["Admin", "Super Admin"].includes(realProfile.role)
  ) {
    return (
      <p className="rounded-xl border p-5 text-sm text-muted-foreground">
        Agency administrator access is required to manage registration.
      </p>
    );
  }
  return (
    <RegistrationContent
      key={`${user.id}:${realProfile.organization_id}`}
      actor={user.id}
      org={realProfile.organization_id}
    />
  );
}
