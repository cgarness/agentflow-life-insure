import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { isInternalAppPath } from "@/lib/notification-presentation";

export type DbNotification = Tables<"notifications">;

/** Window event TopBar listens to so a browser-alert click can navigate inside the router. */
export const NOTIFICATION_NAVIGATE_EVENT = "agentflow-notification-navigate";

const PAGE_SIZE = 30;

interface NotificationContextType {
    notifications: DbNotification[];
    /** Authoritative server count of unread, non-dismissed rows — never derived from the loaded page. */
    unreadCount: number;
    isLoading: boolean;
    loadError: boolean;
    hasMore: boolean;
    isLoadingMore: boolean;
    isLoadingMoreUnread: boolean;
    retry: () => void;
    /** Keyset-paged older rows (all). */
    loadMore: () => Promise<void>;
    /** Keyset-paged older UNREAD rows — server-backed, so unread beyond the loaded window stay reachable. */
    loadMoreUnread: () => Promise<void>;
    markRead: (id: string) => Promise<void>;
    markAllRead: () => Promise<void>;
    /** Soft dismissal — sets dismissed_at; the row (and its event_key) survives until retention. */
    dismissNotification: (id: string) => Promise<void>;
    requestPushPermission: () => Promise<NotificationPermission | "unsupported">;
}

const NotificationContext = createContext<NotificationContextType>({
    notifications: [],
    unreadCount: 0,
    isLoading: true,
    loadError: false,
    hasMore: false,
    isLoadingMore: false,
    isLoadingMoreUnread: false,
    retry: () => { },
    loadMore: async () => { },
    loadMoreUnread: async () => { },
    markRead: async () => { },
    markAllRead: async () => { },
    dismissNotification: async () => { },
    requestPushPermission: async () => "unsupported",
});

export const useNotifications = () => useContext(NotificationContext);

function dedupeById(items: DbNotification[]): DbNotification[] {
    const seen = new Map<string, DbNotification>();
    for (const n of items) {
        if (!seen.has(n.id)) seen.set(n.id, n);
    }
    return [...seen.values()];
}

/** Oldest loaded row under (created_at, id) descending order — the keyset cursor anchor. */
function oldestOf(items: DbNotification[]): DbNotification | null {
    let oldest: DbNotification | null = null;
    for (const n of items) {
        if (
            !oldest ||
            n.created_at < oldest.created_at ||
            (n.created_at === oldest.created_at && n.id < oldest.id)
        ) {
            oldest = n;
        }
    }
    return oldest;
}

/**
 * `.or()` interpolates a RAW PostgREST filter string, so cursor values are validated before
 * interpolation — characters that could alter the filter's structure reject the value (and the
 * caller then fails closed by NOT issuing an unfiltered query).
 */
const SAFE_CURSOR_VALUE = /^[^,()\s]+$/;

function keysetFilter(cursor: DbNotification): string | null {
    const ts = cursor.created_at;
    const id = cursor.id;
    if (!SAFE_CURSOR_VALUE.test(ts) || !SAFE_CURSOR_VALUE.test(id)) return null;
    return `created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${id})`;
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, profile } = useAuth();
    const [notifications, setNotifications] = useState<DbNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isLoadingMoreUnread, setIsLoadingMoreUnread] = useState(false);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const fetchGenerationRef = useRef(0);
    const notificationsRef = useRef<DbNotification[]>([]);
    const loadedIdsRef = useRef<Set<string>>(new Set());
    const pushEnabledRef = useRef(true);

    notificationsRef.current = notifications;
    // Column default is true; only an explicit false disables browser alerts.
    pushEnabledRef.current = profile?.push_notifications_enabled !== false;

    // Rebuilt from committed state; the realtime INSERT handler also adds to it imperatively so
    // same-tick duplicate deliveries dedupe without relying on setState-updater side effects.
    useEffect(() => {
        loadedIdsRef.current = new Set(notifications.map((n) => n.id));
    }, [notifications]);

    /** Invalidate every in-flight fetch so a late response can never commit stale state. */
    const invalidateInFlightFetches = useCallback(() => {
        fetchGenerationRef.current += 1;
    }, []);

    const requestPushPermission = useCallback(async (): Promise<NotificationPermission | "unsupported"> => {
        if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
        if (Notification.permission === "default") {
            try {
                return await Notification.requestPermission();
            } catch (err) {
                console.warn("Notification permission request failed:", err);
            }
        }
        return Notification.permission;
    }, []);

    const maybeFireBrowserPush = useCallback((n: DbNotification) => {
        if (typeof window === "undefined" || !("Notification" in window)) return;
        if (!pushEnabledRef.current) return;
        if (Notification.permission !== "granted") return;
        // Fire only when the app genuinely isn't being looked at — hidden or unfocused —
        // never merely because the drawer happens to be closed.
        const appVisible = document.visibilityState === "visible" && document.hasFocus();
        if (appVisible) return;
        try {
            const alert = new Notification(n.title, {
                body: n.body ?? undefined,
                icon: "/favicon.ico",
                tag: n.id,
            });
            alert.onclick = () => {
                try {
                    window.focus();
                    if (n.action_url && isInternalAppPath(n.action_url)) {
                        window.dispatchEvent(
                            new CustomEvent(NOTIFICATION_NAVIGATE_EVENT, { detail: { path: n.action_url } }),
                        );
                    }
                    alert.close();
                } catch {
                    // focus/navigation support varies by browser — never throw from the handler
                }
            };
        } catch (err) {
            console.warn("Browser push failed:", err);
        }
    }, []);

    const fetchUnreadCount = useCallback(async (): Promise<number | null> => {
        if (!user) return null;
        const { count, error } = await supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .eq("read", false)
            .is("dismissed_at", null);
        if (error) {
            console.error("Failed to fetch unread count:", error);
            return null;
        }
        return count ?? 0;
    }, [user]);

    /** Authoritative count refresh (used when a realtime event concerns an unloaded row). */
    const refreshUnreadCount = useCallback(async () => {
        const generation = fetchGenerationRef.current;
        const count = await fetchUnreadCount();
        if (count !== null && generation === fetchGenerationRef.current) setUnreadCount(count);
    }, [fetchUnreadCount]);

    /**
     * First page + count. As a reconciliation (silent) this is AUTHORITATIVE: the list resets to
     * exactly what the server returns, so rows that no longer exist (retention-deleted, deleted
     * elsewhere) drop out instead of being merged forever. Older keyset-loaded pages are re-loadable
     * on demand.
     */
    const fetchFirstPage = useCallback(async (opts?: { silent?: boolean }) => {
        if (!user) {
            setNotifications([]);
            setUnreadCount(0);
            setIsLoading(false);
            return;
        }
        const generation = ++fetchGenerationRef.current;
        if (!opts?.silent) {
            setIsLoading(true);
            setLoadError(false);
        }

        const [pageRes, count] = await Promise.all([
            supabase
                .from("notifications")
                .select("*")
                .eq("user_id", user.id)
                .is("dismissed_at", null)
                .order("created_at", { ascending: false })
                .order("id", { ascending: false })
                .limit(PAGE_SIZE),
            fetchUnreadCount(),
        ]);

        if (generation !== fetchGenerationRef.current) return;

        if (pageRes.error || count === null) {
            if (pageRes.error) console.error("Failed to fetch notifications:", pageRes.error);
            if (opts?.silent) return; // reconciliation failure keeps the last good state silently
            setLoadError(true);
            setIsLoading(false);
            return;
        }

        const page = (pageRes.data ?? []) as DbNotification[];
        setNotifications(page);
        loadedIdsRef.current = new Set(page.map((n) => n.id));
        setUnreadCount(count);
        setHasMore(page.length === PAGE_SIZE);
        setLoadError(false);
        setIsLoading(false);
    }, [user, fetchUnreadCount]);

    const fetchOlderPage = useCallback(async (unreadOnly: boolean) => {
        if (!user) return;
        const loaded = notificationsRef.current;
        const cursorRow = oldestOf(unreadOnly ? loaded.filter((n) => !n.read) : loaded);
        const generation = fetchGenerationRef.current;

        let query = supabase
            .from("notifications")
            .select("*")
            .eq("user_id", user.id)
            .is("dismissed_at", null);
        if (unreadOnly) query = query.eq("read", false);
        if (cursorRow) {
            const filter = keysetFilter(cursorRow);
            if (!filter) {
                // fail closed — never issue the query without its cursor filter
                console.error("Notification keyset cursor rejected; skipping page load");
                return;
            }
            query = query.or(filter);
        }
        const { data, error } = await query
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(PAGE_SIZE);

        if (generation !== fetchGenerationRef.current) return;
        if (error) {
            console.error("Failed to load more notifications:", error);
            toast.error("Couldn't load earlier notifications.");
            return;
        }
        const page = (data ?? []) as DbNotification[];
        setNotifications((prev) => dedupeById([...prev, ...page]));
        if (!unreadOnly) setHasMore(page.length === PAGE_SIZE);
    }, [user]);

    const loadMore = useCallback(async () => {
        if (isLoadingMore) return;
        setIsLoadingMore(true);
        try {
            await fetchOlderPage(false);
        } finally {
            setIsLoadingMore(false);
        }
    }, [fetchOlderPage, isLoadingMore]);

    const loadMoreUnread = useCallback(async () => {
        if (isLoadingMoreUnread) return;
        setIsLoadingMoreUnread(true);
        try {
            await fetchOlderPage(true);
        } finally {
            setIsLoadingMoreUnread(false);
        }
    }, [fetchOlderPage, isLoadingMoreUnread]);

    const retry = useCallback(() => {
        void fetchFirstPage();
    }, [fetchFirstPage]);

    // Realtime + reconciliation. UPDATE events (which support the user_id filter) carry
    // cross-device read/dismiss changes; DELETE events are best-effort only (the default
    // replica identity strips everything but the PK, so a filtered DELETE cannot be relied
    // on) — retention deletions converge via the SUBSCRIBED/focus reconciliations, which
    // reset the loaded window to the server's truth.
    useEffect(() => {
        if (!user) return;

        void fetchFirstPage();

        const channel = supabase
            .channel(`notifications:${user.id}`)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
                (payload) => {
                    const fresh = payload.new as DbNotification;
                    if (fresh.dismissed_at) return;
                    // Dedupe decided against the imperative id set (not inside a setState updater),
                    // so same-tick duplicate deliveries cannot double-count or double-push.
                    if (loadedIdsRef.current.has(fresh.id)) return;
                    loadedIdsRef.current.add(fresh.id);
                    setNotifications((prev) => (prev.some((n) => n.id === fresh.id) ? prev : [fresh, ...prev]));
                    if (!fresh.read) setUnreadCount((c) => c + 1);
                    maybeFireBrowserPush(fresh);
                },
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
                (payload) => {
                    const updated = payload.new as DbNotification;
                    const prevItem = notificationsRef.current.find((n) => n.id === updated.id);
                    if (!prevItem) {
                        // The row isn't in the loaded window — its read/dismiss change still moves the
                        // authoritative unread count, so re-fetch it rather than leaving it stale.
                        void refreshUnreadCount();
                        return;
                    }
                    if (updated.dismissed_at) {
                        loadedIdsRef.current.delete(updated.id);
                        setNotifications((prev) => prev.filter((n) => n.id !== updated.id));
                        if (!prevItem.read) setUnreadCount((c) => Math.max(0, c - 1));
                        return;
                    }
                    setNotifications((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
                    if (prevItem.read !== updated.read) {
                        setUnreadCount((c) => Math.max(0, c + (updated.read ? -1 : 1)));
                    }
                },
            )
            .on(
                "postgres_changes",
                { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
                (payload) => {
                    const deleted = payload.old as { id: string };
                    loadedIdsRef.current.delete(deleted.id);
                    setNotifications((prev) => prev.filter((n) => n.id !== deleted.id));
                },
            )
            .subscribe((status) => {
                if (status === "SUBSCRIBED") {
                    // Reconcile on EVERY (re)connect, including the first: rows inserted between the
                    // initial fetch and the subscription becoming live would otherwise be lost.
                    void fetchFirstPage({ silent: true });
                }
                if (status === "CHANNEL_ERROR") {
                    console.error("Notification realtime channel error");
                }
            });

        channelRef.current = channel;

        const reconcile = () => {
            if (document.visibilityState === "visible") void fetchFirstPage({ silent: true });
        };
        window.addEventListener("focus", reconcile);
        document.addEventListener("visibilitychange", reconcile);

        return () => {
            // A late response for this user must never repopulate state after logout / user switch.
            invalidateInFlightFetches();
            window.removeEventListener("focus", reconcile);
            document.removeEventListener("visibilitychange", reconcile);
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
        };
    }, [user, fetchFirstPage, maybeFireBrowserPush, refreshUnreadCount, invalidateInFlightFetches]);

    // Clear state on logout (and invalidate any still-in-flight fetches).
    useEffect(() => {
        if (!user) {
            invalidateInFlightFetches();
            loadedIdsRef.current = new Set();
            setNotifications([]);
            setUnreadCount(0);
            setIsLoading(true);
            setLoadError(false);
            setHasMore(false);
        }
    }, [user, invalidateInFlightFetches]);

    const markRead = useCallback(async (id: string) => {
        if (!user) return;
        const previous = notificationsRef.current;
        const target = previous.find((n) => n.id === id);
        if (!target || target.read) return;
        const previousUnread = unreadCount;
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
        setUnreadCount((c) => Math.max(0, c - 1));
        const { error } = await supabase
            .from("notifications")
            .update({ read: true })
            .eq("id", id)
            .eq("user_id", user.id);
        if (error) {
            console.error("Failed to mark notification as read:", error);
            setNotifications(previous);
            setUnreadCount(previousUnread);
            toast.error("Couldn't mark the notification as read.");
        }
    }, [user, unreadCount]);

    const markAllRead = useCallback(async () => {
        if (!user) return;
        const previous = notificationsRef.current;
        const previousUnread = unreadCount;
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
        const { error } = await supabase
            .from("notifications")
            .update({ read: true })
            .eq("user_id", user.id)
            .eq("read", false)
            .is("dismissed_at", null);
        if (error) {
            console.error("Failed to mark all notifications as read:", error);
            setNotifications(previous);
            setUnreadCount(previousUnread);
            toast.error("Couldn't mark all notifications as read.");
        }
    }, [user, unreadCount]);

    const dismissNotification = useCallback(async (id: string) => {
        if (!user) return;
        const previous = notificationsRef.current;
        const target = previous.find((n) => n.id === id);
        if (!target) return;
        const previousUnread = unreadCount;
        loadedIdsRef.current.delete(id);
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        if (!target.read) setUnreadCount((c) => Math.max(0, c - 1));
        const { error } = await supabase
            .from("notifications")
            .update({ dismissed_at: new Date().toISOString() })
            .eq("id", id)
            .eq("user_id", user.id);
        if (error) {
            console.error("Failed to dismiss notification:", error);
            loadedIdsRef.current.add(id);
            setNotifications(previous);
            setUnreadCount(previousUnread);
            toast.error("Couldn't delete the notification.");
        }
    }, [user, unreadCount]);

    return (
        <NotificationContext.Provider
            value={{
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
                requestPushPermission,
            }}
        >
            {children}
        </NotificationContext.Provider>
    );
};
