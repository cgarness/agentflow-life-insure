import React, { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { HistorySkeleton } from "@/components/dialer/DialerSkeletons";
import { CallHistoryItem } from "./CallHistoryItem";
import { EmailHistoryItem } from "./EmailHistoryItem";
import { SmsHistoryItem } from "./SmsHistoryItem";
import {
  CONVERSATION_FILTERS,
  filterConversationItems,
  type ConversationFilter,
  type ConversationItem,
} from "./conversationTypes";

const EMPTY_STATE_COPY: Record<ConversationFilter, string> = {
  all: "No activity yet",
  call: "No calls yet",
  sms: "No text messages yet",
  email: "No emails yet",
};

interface ConversationTimelineProps {
  items: ConversationItem[];
  loading: boolean;
  loadError: boolean;
  filter: ConversationFilter;
  onFilterChange: (filter: ConversationFilter) => void;
  /** Agency disposition colors (normalized name → hex) for call badges; optional — absent → neutral badges. */
  dispositionColors?: Record<string, string>;
  hasMore?: boolean;
  onLoadEarlier?: () => void;
  onRefresh?: () => void;
  enrichmentUnavailable?: boolean;
}

/**
 * FullScreenContactView center-column Conversation History card: canonical
 * filter bar, `flex-col-reverse` feed (ascending sort, newest at the bottom),
 * per-channel empty states, and the one-line load-error notice. Data fetching,
 * filter state, and contact-switch guards stay in FullScreenContactView; mount
 * with `key={contact.id}` so per-item expansion resets on contact switch.
 */
export const ConversationTimeline: React.FC<ConversationTimelineProps> = ({
  items,
  loading,
  loadError,
  filter,
  onFilterChange,
  dispositionColors,
  hasMore, onLoadEarlier, onRefresh, enrichmentUnavailable,
}) => {
  const threadRef = useRef<HTMLDivElement>(null);

  const filteredItems = useMemo(() => filterConversationItems(items, filter), [items, filter]);
  /** Newest-first for the dialer-aligned `flex-col-reverse` presentation. */
  const reversedItems = useMemo(() => [...filteredItems].reverse(), [filteredItems]);

  const newestKey = items[items.length - 1]?.key;
  useEffect(() => {
    // flex-col-reverse keeps the newest row at scrollTop 0. Older pages must not reset it.
    if (threadRef.current) threadRef.current.scrollTop = 0;
  }, [newestKey, filter]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-card border rounded-xl">
      <div className="shrink-0 border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-4 h-4 text-primary shrink-0" aria-hidden />
            <span className="font-semibold text-sm text-foreground">Conversation History</span>
            {onRefresh && <button type="button" disabled={loading} onClick={onRefresh} className="text-[10px] text-primary disabled:opacity-50">Refresh</button>}
          </div>
          <div className="flex bg-muted rounded-lg p-0.5 shrink-0">
            {CONVERSATION_FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onFilterChange(option.id)}
                aria-pressed={filter === option.id}
                className={cn(
                  "px-3 py-1 rounded-md text-[10px] font-bold transition-colors uppercase tracking-tight",
                  filter === option.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col-reverse gap-3 min-h-0">
        {loading && items.length === 0 && <HistorySkeleton />}

        {!loading && loadError && (
          <p className="text-muted-foreground text-sm text-center py-6 flex items-center justify-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" aria-hidden />
            Couldn't load conversation history. {onRefresh && <button type="button" onClick={onRefresh} className="underline">Retry</button>}
          </p>
        )}

        {!loading && !loadError && filteredItems.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-6">{EMPTY_STATE_COPY[filter]}</p>
        )}

        {reversedItems.map((item) => {
            if (item.kind === "call")
              return <CallHistoryItem key={item.key} item={item} dispositionColors={dispositionColors} />;
            if (item.kind === "email") return <EmailHistoryItem key={item.key} item={item} />;
            return <SmsHistoryItem key={item.key} item={item} />;
          })}
        {enrichmentUnavailable && <p className="text-xs text-muted-foreground">Some agent or campaign names are unavailable. Refresh to retry.</p>}
        {hasMore && <button type="button" onClick={onLoadEarlier} disabled={loading} className="text-xs text-primary disabled:opacity-50">{loading ? "Loading…" : "Load earlier"}</button>}
        {!loading && !loadError && !hasMore && items.length > 0 && <p className="text-[10px] text-center text-muted-foreground">No more recorded events available</p>}
      </div>
    </div>
  );
};
