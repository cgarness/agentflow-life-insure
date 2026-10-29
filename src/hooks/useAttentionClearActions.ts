import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  announceAttentionChange,
  AttentionActionError,
  type AttentionActionFailure,
  type AttentionClearance,
  type AttentionSourceType,
  clearAttentionItem,
  undoAttentionClear,
} from "@/lib/dashboard-attention";

const UNDO_TOAST_MS = 8000;

/** What is being cleared, for the copy: "callback" or "missed call". */
export type AttentionNoun = "callback" | "missed call";

export interface ClearTarget {
  /** Source-qualified render key (busy lock). */
  key: string;
  sourceType: AttentionSourceType;
  /** `calls.id` / `campaign_leads.id` / `appointments.id` — never a contact id. */
  sourceId: string;
  /** The occurrence shown on screen, exactly as the server returned it. */
  occurrenceAt: string;
  /** Who the row is about, for the toast. */
  name: string;
}

function failureMessage(kind: AttentionActionFailure, noun: AttentionNoun): string {
  switch (kind) {
    case "not_pending":
      return `This ${noun} is no longer pending. Refresh to see the latest.`;
    case "changed":
      return noun === "callback"
        ? "This callback was rescheduled. Refresh to see it."
        : "This missed call changed since it was shown. Refresh and try again.";
    case "offline":
      return "You're offline — nothing was cleared.";
    case "denied":
      return "Couldn't clear this item. Refresh and try again.";
    default:
      return "Couldn't clear this item. Please try again.";
  }
}

/**
 * Clear / Undo for Missed Calls and Callbacks (plan §3.8).
 *
 * Every action is awaited and reported only after the server stored it; a failure leaves the row
 * as it was. One action per row at a time. After any change `onChanged` reloads the list through
 * its normal load path and every other attention surface is told to reload too — nothing is hidden
 * locally without being persisted, and no source record is ever written.
 */
export function useAttentionClearActions(noun: AttentionNoun, onChanged: () => void) {
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());

  const guarded = useCallback(async (key: string, work: () => Promise<void>) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setBusyKeys(new Set(inFlight.current));
    try {
      await work();
    } finally {
      inFlight.current.delete(key);
      setBusyKeys(new Set(inFlight.current));
    }
  }, []);

  const undo = useCallback(
    (key: string, name: string, clearance: Pick<AttentionClearance, "id" | "clearedAt">) =>
      guarded(key, async () => {
        try {
          await undoAttentionClear({ id: clearance.id, clearedAt: clearance.clearedAt });
          toast.success(`${name} is back on your Dashboard.`);
        } catch (err) {
          toast.error(
            err instanceof AttentionActionError && err.kind === "changed"
              ? "This was changed since then. Refresh to see its current state."
              : err instanceof AttentionActionError && err.kind === "offline"
                ? "You're offline — nothing was restored."
                : "Couldn't undo. Please try again.",
          );
        } finally {
          onChanged();
          announceAttentionChange();
        }
      }),
    [guarded, onChanged],
  );

  const clear = useCallback(
    (target: ClearTarget) =>
      guarded(target.key, async () => {
        try {
          const stored = await clearAttentionItem({
            sourceType: target.sourceType,
            sourceId: target.sourceId,
            expectedOccurrenceAt: target.occurrenceAt,
          });
          toast.success(`${noun === "callback" ? "Callback" : "Missed call"} cleared: ${target.name}`, {
            description: "Hidden from your Dashboard only.",
            // Readable on the green success toast (the shared description color is a muted gray).
            classNames: { description: "!text-white/90" },
            duration: UNDO_TOAST_MS,
            action: { label: "Undo", onClick: () => void undo(target.key, target.name, stored) },
          });
          onChanged();
          announceAttentionChange();
        } catch (err) {
          toast.error(failureMessage(err instanceof AttentionActionError ? err.kind : "failed", noun));
        }
      }),
    [guarded, noun, onChanged, undo],
  );

  return { busyKeys, clear, undo };
}
