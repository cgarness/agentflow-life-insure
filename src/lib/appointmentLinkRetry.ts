import { toast } from "sonner";
import { LINK_REASON_TEXT, LinkTransportError, linkPolicyAppointment, type ClosingAppointmentChoice } from "@/lib/policyAppointmentLinks";

/**
 * Module-level closing-appointment link delivery (Reports V2 PKG-D, D4 §4, D-A3). A sale modal registers its selection
 * under its own sale request id; sendPreparedSale calls onSaleSaved(saleRequestId, winIds) right after a confirmed
 * result. Delivery is not tied to any modal, so navigation or unmount cannot lose it. Transport failures are retried at
 * 1 s, 4 s and 15 s with the same link request id; a final failure shows one global toast whose Retry resends the same
 * request ids. A business rejection is not retried. Memory only: after a reload, recovery is explicit linking.
 */
interface Selection { choice: ClosingAppointmentChoice; linkRequestId: string }
const selections = new Map<string, Selection>();
const inFlight = new Set<string>();
export const LINK_RETRY_DELAYS_MS = [1000, 4000, 15000];
export const LINK_FAILED_TOAST = "Sale saved. Closing appointment not linked — Retry";

type Timer = (fn: () => void, ms: number) => unknown;
let schedule: Timer = (fn, ms) => setTimeout(fn, ms);
/** Test-only: replace the timer and clear the registry. */
export function resetAppointmentLinkRetry(timer?: Timer) {
  selections.clear(); inFlight.clear(); schedule = timer ?? ((fn, ms) => setTimeout(fn, ms));
}

export function registerClosingAppointmentSelection(saleRequestId: string, choice: ClosingAppointmentChoice, linkRequestId: string) {
  if (!saleRequestId) return;
  if (choice.kind === "not_recorded") selections.delete(saleRequestId);
  else selections.set(saleRequestId, { choice, linkRequestId });
}
export function clearClosingAppointmentSelection(saleRequestId: string) { selections.delete(saleRequestId); }
export function hasClosingAppointmentSelection(saleRequestId: string) { return selections.has(saleRequestId); }

async function deliver(selection: Selection, winIds: string[], attempt: number): Promise<void> {
  const pending: string[] = [];
  for (const winId of winIds) {
    const key = `${selection.linkRequestId}|${winId}`;
    if (inFlight.has(key)) continue;
    inFlight.add(key);
    try {
      const result = await linkPolicyAppointment(selection.linkRequestId, winId, selection.choice, "sale_entry");
      if (result.status === "rejected") {
        toast.error(`Sale saved. The closing appointment wasn't linked: ${LINK_REASON_TEXT[result.reason ?? ""] ?? "it could not be linked"}.`);
      }
    } catch (error) {
      if (!(error instanceof LinkTransportError)) throw error;
      pending.push(winId);
    } finally {
      inFlight.delete(key);
    }
  }
  if (pending.length === 0) return;
  if (attempt < LINK_RETRY_DELAYS_MS.length) {
    schedule(() => { void deliver(selection, pending, attempt + 1); }, LINK_RETRY_DELAYS_MS[attempt]);
    return;
  }
  toast.error(LINK_FAILED_TOAST, { action: { label: "Retry", onClick: () => { void deliver(selection, pending, 0); } } });
}

/** Called once after a confirmed sale result; does nothing when the sale had no registered selection. */
export function onSaleSaved(saleRequestId: string, winIds: string[]): Promise<void> {
  const selection = selections.get(saleRequestId);
  if (!selection || winIds.length === 0) return Promise.resolve();
  return deliver(selection, winIds, 0);
}
