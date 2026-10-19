import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTrackingMutation } from "@/hooks/useClientPolicyCommissions";
import { commissionTrackingApi } from "@/lib/commission/trackingApi";
import { formatCalendarDate, formatMonth, scheduledMonths } from "@/lib/commission/installments";
import type { CommissionEstimateRecord } from "@/lib/commission/trackingSchemas";

const fieldCls =
  "w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

/**
 * The confirmed schedule start that places Months 10–12 (start month + 9/10/11). Offered from the policy's
 * Effective Date, never applied automatically; Sold Date and Draft Date are never used. Manual per-payment timing
 * is kept when the start changes.
 */
export function ScheduleBasisControl({ estimate, effectiveDate, canWrite }: {
  estimate: CommissionEstimateRecord;
  effectiveDate: string | null;
  canWrite: boolean;
}) {
  const id = useId();
  const mutation = useTrackingMutation();
  const [editing, setEditing] = useState(false);
  const [startOn, setStartOn] = useState("");

  const save = async (next: string | null, source: "effective_date" | "manual" | null) => {
    const result = await mutation.run((requestId) => commissionTrackingApi.setScheduleBasis({
      requestId, estimateId: estimate.id, expectedRevision: estimate.state_revision, startOn: next, source,
    }));
    if (result) { setEditing(false); mutation.restart(); }
  };

  const current = estimate.schedule_start_on;
  const months = current ? scheduledMonths(current) : null;
  // After an unknown outcome the same change can be resent (same request id); a different one is refused.
  const busy = mutation.saving;
  return (
    <div className="space-y-1.5 text-[11px]">
      <p className="text-muted-foreground">
        {current ? (
          <>
            Schedule start <span className="text-foreground">{formatCalendarDate(current)}</span>
            {estimate.schedule_start_source === "effective_date" ? " (effective date)" : ""}
            {months?.month_10 && ` · Months 10–12: ${formatMonth(months.month_10)} – ${formatMonth(months.month_12!)}`}
          </>
        ) : (
          "Schedule start not confirmed, so Months 10–12 have no expected month yet."
        )}
      </p>
      {canWrite && !editing && (
        <div className="flex flex-wrap gap-3">
          {effectiveDate && effectiveDate !== current && (
            <button type="button" disabled={busy} className="font-medium text-primary hover:underline disabled:opacity-50"
              onClick={() => void save(effectiveDate, "effective_date")}>
              Use effective date ({formatCalendarDate(effectiveDate)})
            </button>
          )}
          <button type="button" disabled={busy} className="font-medium text-primary hover:underline disabled:opacity-50"
            onClick={() => { setStartOn(current ?? ""); setEditing(true); mutation.restart(); }}>
            {current ? "Change start" : "Set start date"}
          </button>
          {current && (
            <button type="button" disabled={busy} className="font-medium text-muted-foreground hover:underline disabled:opacity-50"
              onClick={() => void save(null, null)}>
              Clear
            </button>
          )}
        </div>
      )}
      {canWrite && editing && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (/^\d{4}-\d{2}-\d{2}$/.test(startOn)) void save(startOn, "manual"); }}>
          <label htmlFor={`${id}-start`} className="sr-only">Schedule start date</label>
          <input id={`${id}-start`} type="date" className={`${fieldCls} h-8 w-auto text-xs`} value={startOn} disabled={busy}
            onChange={(event) => setStartOn(event.target.value)} />
          <Button type="submit" size="sm" className="h-8" disabled={mutation.saving || !startOn}>{mutation.locked ? "Retry" : "Save"}</Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" disabled={mutation.saving} onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      )}
      {mutation.message && <p role="alert" className="break-words text-destructive">{mutation.message}</p>}
    </div>
  );
}
