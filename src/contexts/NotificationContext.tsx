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
    retry: () => void;
    loadMore: () => Promise<void>;
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
    retry: () => { },
    loadMore: async () => { },
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

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, profile } = useAuth();
    const [notifications, setNotifications] = useState<DbNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const fetchGenerationRef = useRef(0);
    const notificationsRef = useRef<DbNotification[]>([]);
    const subscribedOnceRef = useRef(false);
    const pushEnabledRef = useRef(true);

    notificationsRef.current = notifications;
    // Column default is true; only an explicit false disables browser alerts.
    pushEnabledRef.current = profile?.push_notifications_enabled !== false;

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
                .range(0, PAGE_SIZE - 1),
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
        if (opts?.silent) {
            // Merge-by-id: fresh first page wins; previously loaded older pages are kept.
            setNotifications((prev) => dedupeById([...page, ...prev]).filter((n) => !n.dismissed_at));
        } else {
            setNotifications(page);
        }
        setUnreadCount(count);
        setHasMore(page.length === PAGE_SIZE);
        setLoadError(false);
        setIsLoading(false);
    }, [user, fetchUnreadCount]);

    const loadMore = useCallback(async () => {
        if (!user || isLoadingMore) return;
        setIsLoadingMore(true);
        const offset = notificationsRef.current.length;
        const { data, error } = await supabase
            .from("notifications")
            .select("*")
            .eq("user_id", user.id)
            .is("dismissed_at", null)
            .order("created_at", { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);
        if (error) {
            console.error("Failed to load more notifications:", error);
            toast.error("Couldn't load earlier notifications.");
            setIsLoadingMore(false);
            return;
        }
        const page = (data ?? []) as DbNotification[];
        setNotifications((prev) => dedupeById([...prev, ...page]));
        setHasMore(page.length === PAGE_SIZE);
        setIsLoadingMore(false);
    }, [user, isLoadingMore]);

    const retry = useCallback(() => {
        void fetchFirstPage();
    }, [fetchFirstPage]);

    // Realtime + reconciliation. UPDATE events (which support the user_id filter) carry
    // cross-device read/dismiss changes; DELETE events are best-effort only (the default
    // replica identity strips everything but the PK, so a filtered DELETE cannot be relied
    // on) — retention deletions converge via the focus/reconnect reconciliation below.
    useEffect(() => {
        if (!user) return;

        void fetchFirstPage();
        subscribedOnceRef.current = false;

        const channel = supabase
            .channel(`notifications:${user.id}`)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
                (payload) => {
                    const fresh = payload.new as DbNotification;
                    if (fresh.dismissed_at) return;
                    let added = false;
                    setNotifications((prev) => {
                        if (prev.some((n) => n.id === fresh.id)) return prev;
                        added = true;
                        return [fresh, ...prev];
                    });
                    if (added && !fresh.read) setUnreadCount((c) => c + 1);
                    if (added) maybeFireBrowserPush(fresh);
                },
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
                (payload) => {
                    const updated = payload.new as DbNotification;
                    const prevItem = notificationsRef.current.find((n) => n.id === updated.id);
                    if (updated.dismissed_at) {
                        setNotifications((prev) => prev.filter((n) => n.id !== updated.id));
                        if (prevItem && !prevItem.read) setUnreadCount((c) => Math.max(0, c - 1));
                        return;
                    }
                    setNotifications((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
                    if (prevItem && prevItem.read !== updated.read) {
                        setUnreadCount((c) => Math.max(0, c + (updated.read ? -1 : 1)));
                    }
                },
            )
            .on(
                "postgres_changes",
                { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
                (payload) => {
                    const deleted = payload.old as { id: string };
                    setNotifications((prev) => prev.filter((n) => n.id !== deleted.id));
                },
            )
            .subscribe((status) => {
                if (status === "SUBSCRIBED") {
                    // Reconcile after every (re)connect — events during the gap are lost.
                    if (subscribedOnceRef.current) void fetchFirstPage({ silent: true });
                    subscribedOnceRef.current = true;
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
            window.removeEventListener("focus", reconcile);
            document.removeEventListener("visibilitychange", reconcile);
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
        };
    }, [user, fetchFirstPage, maybeFireBrowserPush]);

    // Clear state on logout
    useEffect(() => {
        if (!user) {
            setNotifications([]);
            setUnreadCount(0);
            setIsLoading(true);
            setLoadError(false);
            setHasMore(false);
        }
    }, [user]);

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
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        if (!target.read) setUnreadCount((c) => Math.max(0, c - 1));
        const { error } = await supabase
            .from("notifications")
            .update({ dismissed_at: new Date().toISOString() })
            .eq("id", id)
            .eq("user_id", user.id);
        if (error) {
            console.error("Failed to dismiss notification:", error);
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
                retry,
                loadMore,
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
