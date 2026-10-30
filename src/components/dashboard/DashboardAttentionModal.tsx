import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { dispatchQuickCall } from "@/lib/quick-call";
import { contactHref } from "@/lib/dashboard-contact-identity";
import { ATTENTION_TYPE, type NormalizedCallbackRow } from "@/lib/dashboard-callbacks";
import type { MissedCallItem } from "@/lib/dashboard-missed-calls";
import { ATTENTION_CONFIG, type AttentionConfig } from "@/lib/dashboard-attention-config";
import { callbackFeedSource, missedCallFeedSource } from "@/lib/dashboard-attention-sources";
import { type AttentionView, useAttentionDetailFeed } from "@/hooks/useAttentionDetailFeed";
import { useAttentionClearActions } from "@/hooks/useAttentionClearActions";
import { useRowFocusRecovery } from "@/hooks/useRowFocusRecovery";
import DashboardCallbacksModal from "@/components/dashboard/DashboardCallbacksModal";
import DashboardMissedCallsModal from "@/components/dashboard/DashboardMissedCallsModal";

interface Props {
  open: boolean;
  onClose: () => void;
  kind: "callbacks" | "missed_calls";
  userId: string;
  /** Own items only — the opener's scope rule (plan rev 1, §2A). */
  isFiltered: boolean;
  scopeNote: string | null;
  initialView?: AttentionView;
  config?: AttentionConfig;
}

/**
 * The Callbacks / Missed Calls detail view (plan §3.5.5, §3.7, §3.8): one feed over the same
 * contract as its widget, Call / View / Clear / Undo, focus recovery after a row leaves, and a
 * refresh in place after every stored Clear or Undo. Owner and recipient names only in an Admin's
 * Team view. Never writes a call, callback or appointment.
 */
const DashboardAttentionModal: React.FC<Props> = ({ open, onClose, kind, userId, isFiltered, scopeNote, initialView = "active", config = ATTENTION_CONFIG }) => {
  const navigate = useNavigate();
  const { user, profile, isImpersonating } = useAuth();
  const organizationId = profile?.organization_id ?? null;
  const clearable = config.clearancesEnabled && !isImpersonating;
  const scope = { userId, organizationId, isFiltered, clearable };
  const callbacks = useMemo(() => callbackFeedSource(scope), [userId, organizationId, isFiltered, clearable]); // eslint-disable-line react-hooks/exhaustive-deps
  const missed = useMemo(() => missedCallFeedSource(scope), [userId, organizationId, isFiltered, clearable]); // eslint-disable-line react-hooks/exhaustive-deps
  const scopeKey = `${userId}|${organizationId}|${isFiltered}|${clearable}`;
  const cb = useAttentionDetailFeed(open && kind === "callbacks", scopeKey, callbacks, initialView);
  const mc = useAttentionDetailFeed(open && kind === "missed_calls", scopeKey, missed, initialView);
  const active = kind === "callbacks" ? cb : mc;
  const actions = useAttentionClearActions(kind === "callbacks" ? "callback" : "missed call", active.refreshInPlace);
  const rowsOnScreen = active.feed.view === "cleared" ? active.feed.clearedRows : active.feed.rows;
  const focus = useRowFocusRecovery(rowsOnScreen.map((r: { key: string }) => r.key).join("|"));
  const remember = (key: string) => focus.remember(rowsOnScreen.findIndex((r: { key: string }) => r.key === key));

  const startCall = (contactId: string | null, contactType: NormalizedCallbackRow["contactType"], name: string, phone: string, blocked: string | null) => {
    if (!user) {
      toast.error("You must be logged in to make calls.");
      return;
    }
    // An unresolved identity or type must not dispatch a call.
    if (!contactId || !contactType) {
      toast.error(blocked ?? "This row has no resolvable contact record, so it cannot be dialed.");
      return;
    }
    // Route through the ONE canonical path; only report what actually happened.
    if (!dispatchQuickCall({ contactId, name, phone, type: contactType })) toast.error(`No phone number on file for ${name}.`);
  };
  const view = (contactId: string | null, contactType: NormalizedCallbackRow["contactType"], blocked: string | null) => {
    const href = contactHref(contactId, contactType);
    if (!href) {
      toast.error(blocked ?? "This row has no resolvable contact record, so it cannot be opened.");
      return;
    }
    onClose();
    navigate(href);
  };
  const common = {
    open, onClose, clearable, busyKeys: actions.busyKeys, team: !isFiltered, scopeNote,
    onViewChange: active.setView, onRetry: active.retry, onLoadMore: () => void active.loadMore(), onScroll: active.handleScroll,
    listRef: focus.containerRef,
  };

  if (kind === "callbacks") {
    return (
      <DashboardCallbacksModal {...common} feed={cb.feed} handlers={{
        onCall: (row) => startCall(row.contactId, row.contactType, row.contactName || "Unknown", row.phone, row.blockedReason),
        onView: (row) => view(row.contactId, row.contactType, row.blockedReason),
        onClear: (row) => {
          remember(row.key);
          void actions.clear({ key: row.key, sourceType: ATTENTION_TYPE[row.source], sourceId: row.sourceRowId, occurrenceAt: row.dueAt, name: row.contactName });
        },
        onUndo: (row) => {
          remember(row.key);
          if (row.clearance) void actions.undo(row.key, row.contactName, row.clearance);
        },
      }} />
    );
  }
  const nameOf = (item: MissedCallItem) => (item.contactName !== "Unknown" ? item.contactName : item.phone || "Unknown caller");
  return (
    <DashboardMissedCallsModal {...common} feed={mc.feed} handlers={{
      onCallBack: (item) => startCall(item.contactId, item.contactType, nameOf(item), item.phone, "This call has no linked contact record — open it in Contacts to call back."),
      onView: (item) => view(item.contactId, item.contactType, "No linked contact record is available"),
      onClear: (item) => {
        remember(item.key);
        void actions.clear({ key: item.key, sourceType: "missed_call", sourceId: item.id, occurrenceAt: item.createdAt, name: nameOf(item) });
      },
      onUndo: (item) => {
        remember(item.key);
        if (item.clearance) void actions.undo(item.key, nameOf(item), item.clearance);
      },
    }} />
  );
};

export default DashboardAttentionModal;
