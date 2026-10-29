import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { contactHref } from "@/lib/dashboard-contact-identity";
import { dispatchQuickCall } from "@/lib/quick-call";
import type { Milestone, MilestoneReviewRow } from "@/lib/dashboard-milestones";
import {
  clearMilestoneReview,
  MilestoneActionError,
  REMIND_LATER_OPTIONS,
  remindAtFor,
  reviewInputFor,
  setMilestoneReview,
  type RemindLaterOption,
} from "@/lib/dashboard-milestones-data";

const UNDO_TOAST_MS = 8000;

/** Fired after any stored review change, so every milestone surface (widget and detail) reloads. */
export const MILESTONES_CHANGED_EVENT = "agentflow:client-milestones-changed";
const announceChange = () => window.dispatchEvent(new Event(MILESTONES_CHANGED_EVENT));

function failure(err: unknown, fallback: string) {
  // Only the user-safe message is shown; raw errors were already logged by the data layer.
  toast.error(err instanceof MilestoneActionError ? err.message : fallback);
}

/**
 * Mark Reviewed / Remind Later / Undo for Client Milestones (plan §6.5).
 *
 * Every action is awaited and reported only after the server stored it; a failure
 * leaves the milestone as it was. One action per milestone at a time. After any
 * change `onChanged` reloads the list through its normal load path, so nothing is
 * hidden locally without being persisted. Undo removes the row only if it is still
 * exactly what this action stored.
 */
export function useMilestoneActions(onChanged: () => void) {
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
    (item: Milestone, row: MilestoneReviewRow) =>
      guarded(item.key, async () => {
        try {
          await clearMilestoneReview({ id: row.id, updatedAt: row.updated_at });
          toast.success(`${item.clientName} is back in your milestones.`);
        } catch (err) {
          failure(err, "Couldn't undo. Please try again.");
        } finally {
          onChanged();
          announceChange();
        }
      }),
    [guarded, onChanged],
  );

  const store = useCallback(
    (item: Milestone, action: { state: "reviewed" } | { state: "snoozed"; remindAt: Date }, done: string) =>
      guarded(item.key, async () => {
        const input = reviewInputFor(item, action);
        if (!input) {
          toast.error(item.actionBlockedReason ?? "This milestone can't be updated here.");
          return;
        }
        try {
          const row = await setMilestoneReview(input);
          toast.success(done, {
            duration: UNDO_TOAST_MS,
            action: { label: "Undo", onClick: () => void undo(item, row) },
          });
          onChanged();
          announceChange();
        } catch (err) {
          failure(err, "Couldn't update this reminder. Please try again.");
        }
      }),
    [guarded, onChanged, undo],
  );

  const markReviewed = useCallback(
    (item: Milestone) => store(item, { state: "reviewed" }, `Marked reviewed: ${item.clientName}`),
    [store],
  );

  const remindLater = useCallback(
    (item: Milestone, option: RemindLaterOption) => {
      const remindAt = remindAtFor(option);
      const label = REMIND_LATER_OPTIONS.find((o) => o.id === option)?.label.toLowerCase() ?? "later";
      return store(item, { state: "snoozed", remindAt }, `We'll remind you ${label}: ${item.clientName}`);
    },
    [store],
  );

  /** Restore a reviewed or snoozed milestone to pending (the detail view's Undo). */
  const restore = useCallback(
    (item: Milestone) => {
      if (!item.reviewId || !item.reviewUpdatedAt) return Promise.resolve();
      return undo(item, { id: item.reviewId, updated_at: item.reviewUpdatedAt } as MilestoneReviewRow);
    },
    [undo],
  );

  return { busyKeys, markReviewed, remindLater, restore };
}

/** Call and View Contact for a milestone row (a client, never a lead). */
export function useMilestoneContactHandlers() {
  const navigate = useNavigate();
  return {
    onCall: (item: Milestone) => {
      const started = dispatchQuickCall({ contactId: item.clientId, name: item.clientName, phone: item.phone, type: "client" });
      // Never report a call that did not start.
      if (!started) toast.error(`No phone number on file for ${item.clientName}.`);
    },
    onView: (item: Milestone) => {
      const href = contactHref(item.clientId, "client");
      if (href) navigate(href);
    },
  };
}
