import { useEffect, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import {
  clearChipSelection, getActiveInboundCall, getChipSelection, getRecentEndedCalls, getTrackedCall, setChipSelection,
  subscribeTrackedCalls, trackedCallsVersion,
} from "@/lib/recentTrackedCall";

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * The producing call of a sale saved from a contact (Reports V2 PKG-C, D3 §4, ★6). During an active inbound call the
 * call is attached automatically as a removable chip; after it ends, within 30 minutes, it is offered unselected.
 * The selection is recorded under the modal's request id and read once when the sale is prepared. A newer call never
 * replaces the selected one, and nothing is attached again once the agent removed it. Without a selection the sale
 * has no producing call (Unclassified in Reports, never "No").
 */
export function SaleSourceCallChip({ requestId, disabled = false }: { requestId: string; disabled?: boolean }) {
  useSyncExternalStore(subscribeTrackedCalls, trackedCallsVersion);
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const userId = user?.id ?? null;
  const orgId = organizationId ?? null;
  const selection = requestId ? getChipSelection(requestId) : undefined;
  const active = getActiveInboundCall(userId, orgId);

  useEffect(() => {
    if (requestId && active && selection === undefined && !disabled) setChipSelection(requestId, active.rowId);
  }, [requestId, active, selection, disabled]);
  useEffect(() => () => { if (requestId) clearChipSelection(requestId); }, [requestId]);

  if (!requestId) return null;
  const selected = selection ? getTrackedCall(selection, userId, orgId) : null;
  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs text-primary" data-testid="sale-source-call">
        <span className="min-w-0 flex-1 break-words">
          Sold on {selected.endedAt === null ? "this call" : "the call"}{selected.callerLabel ? ` with ${selected.callerLabel}` : ""} at {time(selected.startedAt)}
        </span>
        <button type="button" disabled={disabled} aria-label="Remove the sale's source call" onClick={() => setChipSelection(requestId, null)}
          className="rounded p-0.5 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          <X className="h-3 w-3" aria-hidden />
        </button>
      </div>
    );
  }
  const recent = getRecentEndedCalls(userId, orgId).slice(0, 1);
  if (recent.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="sale-source-call-offers">
      {recent.map((call) => (
        <button key={call.rowId} type="button" disabled={disabled} onClick={() => setChipSelection(requestId, call.rowId)}
          className="w-full rounded-md border border-dashed border-input px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          Sold on the call with {call.callerLabel ?? "this caller"} at {time(call.startedAt)}
        </button>
      ))}
    </div>
  );
}
