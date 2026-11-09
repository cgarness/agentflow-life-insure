import { CORRECTION_REASONS, type SalePremiumHistoryEntry } from "@/lib/policySaleCorrection";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const monthly = (value: number | null) => (value === null ? "unknown" : `${money.format(value)}/mo`);
const RECORD: Record<SalePremiumHistoryEntry["book_action"], string> = {
  updated: "Policy record updated",
  already_matched: "Policy record already matched",
  kept_current: "Policy record kept",
  no_policy_record: "No policy record",
};

/** The audit list of one sale's premium corrections, oldest first. Admins also see each request id (B6 manifest). */
export function SalePremiumHistory({ history, formatDate }: {
  history: SalePremiumHistoryEntry[];
  formatDate: (value: string) => string;
}) {
  if (history.length === 0) return null;
  return (
    <ol aria-label="Sale premium history" className="mt-1.5 space-y-1.5 text-xs">
      {history.map((entry) => (
        <li key={entry.revision} className="rounded-md bg-muted/40 px-2 py-1.5">
          <p className="text-foreground">
            <span className="font-medium">{monthly(entry.previous_effective_monthly)} → {monthly(entry.corrected_monthly)}</span>
            {" · "}{CORRECTION_REASONS.find((reason) => reason.value === entry.reason_code)?.label ?? entry.reason_code}
          </p>
          <p className="break-words text-muted-foreground">{entry.note}</p>
          <p className="text-[10px] text-muted-foreground">
            {formatDate(entry.created_at)} · {entry.actor_name ?? "Unknown user"} · {RECORD[entry.book_action]}
          </p>
          {entry.request_id && <p className="break-all font-mono text-[10px] text-muted-foreground">Request {entry.request_id}</p>}
        </li>
      ))}
    </ol>
  );
}
