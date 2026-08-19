import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Bell, BellOff, Inbox } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotifications, type DbNotification } from "@/contexts/NotificationContext";
import {
  NOTIFICATION_FILTERS,
  filterNotifications,
  groupNotifications,
  isInternalAppPath,
  type NotificationFilter,
} from "@/lib/notification-presentation";
import { NotificationRow } from "./NotificationRow";

export interface NotificationsPanelProps {
  open: boolean;
  onClose: () => void;
}

const GroupHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="sticky top-0 z-10 border-b border-border/60 bg-card/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
    {children}
  </p>
);

export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({ open, onClose }) => {
  const {
    notifications,
    unreadCount,
    isLoading,
    loadError,
    hasMore,
    isLoadingMore,
    isLoadingMoreUnread,
    retry,
    loadMore,
    loadMoreUnread,
    markRead,
    markAllRead,
    dismissNotification,
  } = useNotifications();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<NotificationFilter>("all");

  const filtered = useMemo(() => filterNotifications(notifications, filter), [notifications, filter]);
  const { newItems, earlierItems } = useMemo(() => groupNotifications(filtered), [filtered]);

  // The badge count is authoritative (server head-count); the loaded page may lag behind it.
  // When the Unread view has fewer rows loaded than the server says exist, the missing rows
  // stay reachable through server-backed unread paging — never hidden behind an empty state.
  const loadedUnread = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  const hasMoreUnread = loadedUnread < unreadCount;

  useEffect(() => {
    if (
      open &&
      filter === "unread" &&
      unreadCount > 0 &&
      loadedUnread === 0 &&
      !isLoading &&
      !loadError &&
      !isLoadingMoreUnread
    ) {
      void loadMoreUnread();
    }
  }, [open, filter, unreadCount, loadedUnread, isLoading, loadError, isLoadingMoreUnread, loadMoreUnread]);

  const handleOpenNotification = (n: DbNotification) => {
    // Optimistic read state — navigation must never wait on the network round trip.
    if (!n.read) void markRead(n.id);
    if (n.action_url && isInternalAppPath(n.action_url)) {
      onClose();
      navigate(n.action_url);
    }
  };

  const showEmptyAll = !isLoading && !loadError && filter === "all" && notifications.length === 0;
  // "No unread notifications" is truthful ONLY when the authoritative count is exactly zero.
  const showEmptyUnread =
    !isLoading && !loadError && filter === "unread" && unreadCount === 0 && filtered.length === 0 && !showEmptyAll;
  const showUnreadLoading =
    !isLoading && !loadError && filter === "unread" && filtered.length === 0 && unreadCount > 0;
  const showList = !isLoading && !loadError && filtered.length > 0;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        id="notifications-drawer"
        className="w-full sm:w-[440px] sm:max-w-md gap-0 p-0 flex flex-col bg-card motion-reduce:transition-none motion-reduce:animate-none"
      >
        <div className="flex items-center gap-2 border-b px-4 py-3 pr-12">
          <Bell className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <SheetTitle className="text-base">Notifications</SheetTitle>
          {unreadCount > 0 && (
            <span
              className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
              aria-label={`${unreadCount} unread notifications`}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="ml-auto text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              Mark all read
            </button>
          )}
        </div>
        <SheetDescription className="sr-only">
          Your latest alerts: missed calls, lead assignments, wins, and messages.
        </SheetDescription>

        <div role="group" aria-label="Filter notifications" className="flex gap-1.5 border-b px-4 py-2">
          {NOTIFICATION_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                filter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="space-y-3 p-4" aria-label="Loading notifications">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} data-testid="notification-skeleton" className="flex items-start gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && loadError && (
            <div className="flex h-48 flex-col items-center justify-center gap-3 px-6 text-center">
              <AlertCircle className="h-8 w-8 text-destructive/70" aria-hidden />
              <p className="text-sm text-muted-foreground">Couldn't load notifications.</p>
              <button
                type="button"
                onClick={retry}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Retry
              </button>
            </div>
          )}

          {showEmptyAll && (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Inbox className="h-8 w-8 opacity-30" aria-hidden />
              <p className="text-sm">No notifications yet</p>
            </div>
          )}

          {showEmptyUnread && (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
              <BellOff className="h-8 w-8 opacity-30" aria-hidden />
              <p className="text-sm">No unread notifications</p>
              <p className="text-xs">You're all caught up.</p>
            </div>
          )}

          {showUnreadLoading && (
            <div
              data-testid="unread-loading"
              className="space-y-3 p-4"
              aria-label="Loading unread notifications"
            >
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => void loadMoreUnread()}
                disabled={isLoadingMoreUnread}
                className="w-full rounded-md border border-border py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {isLoadingMoreUnread ? "Loading unread…" : "Load unread notifications"}
              </button>
            </div>
          )}

          {showList && (
            <>
              {newItems.length > 0 && (
                <section aria-label="New notifications">
                  <GroupHeading>New</GroupHeading>
                  {newItems.map((n) => (
                    <NotificationRow
                      key={n.id}
                      notification={n}
                      onOpen={handleOpenNotification}
                      onMarkRead={(id) => void markRead(id)}
                      onDismiss={(id) => void dismissNotification(id)}
                    />
                  ))}
                </section>
              )}
              {earlierItems.length > 0 && (
                <section aria-label="Earlier notifications">
                  <GroupHeading>Earlier</GroupHeading>
                  {earlierItems.map((n) => (
                    <NotificationRow
                      key={n.id}
                      notification={n}
                      onOpen={handleOpenNotification}
                      onMarkRead={(id) => void markRead(id)}
                      onDismiss={(id) => void dismissNotification(id)}
                    />
                  ))}
                </section>
              )}
              {filter === "all" && hasMore && (
                <div className="p-3">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={isLoadingMore}
                    className="w-full rounded-md border border-border py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {isLoadingMore ? "Loading…" : "Load earlier notifications"}
                  </button>
                </div>
              )}
              {filter === "unread" && hasMoreUnread && (
                <div className="p-3">
                  <button
                    type="button"
                    onClick={() => void loadMoreUnread()}
                    disabled={isLoadingMoreUnread}
                    className="w-full rounded-md border border-border py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {isLoadingMoreUnread ? "Loading unread…" : "Load more unread"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
