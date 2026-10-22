import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTrackingMutation } from "@/hooks/useClientPolicyCommissions";
import { commissionTrackingApi } from "@/lib/commission/trackingApi";
import { formatCalendarDate, parseStartDateForm, scheduleSummary, type StartChoice } from "@/lib/commission/installments";
import type { CommissionEstimateRecord } from "@/lib/commission/trackingSchemas";
import { useAmounts } from "../ui/amountsContext";

const fieldCls =
  "w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

/**
 * Where the expected dates come from, and Edit dates. The server assumes the start from the policy's own Effective
 * Date when the estimate is saved (never Draft Date); Edit dates confirms it, sets a first premium date or clears it.
 * Manual per-payment dates are kept when the start changes.
 */
export function ScheduleBasisControl({ estimate, effectiveDate, canWrite }: {
  estimate: CommissionEstimateRecord;
  effectiveDate: string | null;
  canWrite: boolean;
}) {
  const id = useId();
  // Dates are edited only with amounts shown (the drawer offers Show amounts); a draft or unresolved change is kept.
  const { hidden } = useAmounts();
  const canEdit = canWrite && !hidden;
  const mutation = useTrackingMutation<{ startOn: string | null }>(`schedule:${estimate.id}`);
  const { restart } = mutation;
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<StartChoice>("effective_date");
  const [startOn, setStartOn] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Remounted with an unresolved change: re-read the commission data before offering the retry.
  useEffect(() => {
    if (mutation.unresolved) restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restart]);

  const edit = () => {
    const manual = estimate.schedule_start_source === "manual";
    setChoice(manual || (!estimate.schedule_start_on && !effectiveDate) ? "manual" : "effective_date");
    setStartOn(manual ? estimate.schedule_start_on ?? "" : "");
    setError(null);
    setEditing(true);
    restart();
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseStartDateForm({ choice, startOn, effectiveDate });
    if ("error" in parsed) { setError(parsed.error); return; }
    setError(null);
    const result = await mutation.run((requestId) => commissionTrackingApi.setScheduleBasis({
      requestId, estimateId: estimate.id, expectedRevision: estimate.state_revision, startOn: parsed.startOn, source: parsed.source,
    }), { startOn: parsed.startOn });
    if (result) { setEditing(false); restart(); }
  };
  const retry = async () => {
    if (await mutation.retry()) { setEditing(false); restart(); }
  };

  const summary = scheduleSummary(estimate);
  // After an unknown outcome the same change can be resent (same request id); a different one is refused.
  const busy = mutation.saving;
  const options: Array<[StartChoice, string, boolean]> = [
    ["effective_date", effectiveDate ? `Effective date (${formatCalendarDate(effectiveDate)})` : "Effective date (none on the policy)", !effectiveDate],
    ["manual", "First premium date", false],
    ["none", "Date needed", false],
  ];
  return (
    <div className="space-y-1.5 text-[11px]">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className={estimate.schedule_start_on ? "text-muted-foreground" : "text-foreground"}>{summary.text}</span>
        {canEdit && !mutation.unresolved && !editing && (
          <button type="button" disabled={busy} className="font-medium text-primary hover:underline disabled:opacity-50" onClick={edit}>
            Edit dates
          </button>
        )}
      </div>
      {summary.exception && <p className="text-muted-foreground">{summary.exception}</p>}
      {canEdit && mutation.unresolved && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            Unconfirmed change: {mutation.pending?.startOn ? `start ${formatCalendarDate(mutation.pending.startOn)}` : "clear the start"}.
          </span>
          <Button type="button" size="sm" className="h-7 px-2 text-[11px]" disabled={mutation.saving || mutation.syncing} onClick={() => void retry()}>
            {mutation.saving ? "Saving…" : "Retry"}
          </Button>
        </div>
      )}
      {canWrite && !mutation.unresolved && editing && (
        <div hidden={!canEdit}>
          <form className="space-y-2 rounded-md border border-border/60 p-2.5" onSubmit={save}>
            <fieldset disabled={busy} className="space-y-1.5">
              <legend className="mb-1 font-medium text-foreground">Payment dates start from</legend>
              {options.map(([value, label, disabled]) => (
                <label key={value} className={`flex items-center gap-1.5 text-xs ${disabled ? "text-muted-foreground" : ""}`}>
                  <input type="radio" name={`${id}-start`} checked={choice === value} disabled={disabled} onChange={() => setChoice(value)} />
                  {label}
                </label>
              ))}
              {choice === "manual" && (
                <div>
                  <label htmlFor={`${id}-date`} className="sr-only">First premium date</label>
                  <input id={`${id}-date`} type="date" className={`${fieldCls} h-8 text-xs sm:w-auto`} value={startOn}
                    onChange={(event) => setStartOn(event.target.value)} />
                </div>
              )}
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" className="h-8" disabled={mutation.saving || mutation.syncing}>Save</Button>
              <Button type="button" size="sm" variant="ghost" className="h-8" disabled={mutation.saving} onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        </div>
      )}
      {(error || mutation.message) && <p role="alert" className="break-words text-destructive">{error ?? mutation.message}</p>}
    </div>
  );
}
