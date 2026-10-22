import { useSearchParams } from "react-router-dom";
import ReportSegmented from "@/components/reports/ReportSegmented";
import { parseView } from "@/lib/commission/centerFilters";
import type { OpenPolicy } from "../CommissionDrawer";
import { HistoryView } from "./HistoryView";
import { ScheduledView } from "./ScheduledView";

const VIEWS = [["scheduled", "Scheduled"], ["history", "History"]] as const;
/** Filters that belong to one view only; the period is kept when switching. */
const VIEW_ONLY = ["dates", "status", "kind", "carrier", "carrier_unknown", "voided", "page"];

/** Payments: Scheduled (expected installments) | History (recorded receipts). */
export function PaymentsTab({ onOpen }: { onOpen: OpenPolicy }) {
  const [params, setParams] = useSearchParams();
  const view = parseView(params);
  const switchView = (next: "scheduled" | "history") => {
    const p = new URLSearchParams(params);
    VIEW_ONLY.forEach((key) => p.delete(key));
    if (next === "history") p.set("view", "history");
    else p.delete("view");
    setParams(p);
  };
  return (
    <div className="space-y-4">
      <ReportSegmented ariaLabel="Payments view" value={view} onChange={switchView} options={VIEWS} />
      {view === "scheduled" ? <ScheduledView onOpen={onOpen} /> : <HistoryView onOpen={onOpen} />}
    </div>
  );
}
