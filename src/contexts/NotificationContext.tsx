import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";

export type DbNotification = Tables<"notifications">;

interface NotificationContextType {
    notifications: DbNotification[];
    unreadCount: number;
    isLoading: boolean;
    markRead: (id: string) => Promise<void>;
    markAllRead: () => Promise<void>;
    deleteNotification: (id: string) => Promise<void>;
    requestPushPermission: () => Promise<void>;
    setPanelOpen: (open: boolean) => void;
}

const NotificationContext = createContext<NotificationContextType>({
    notifications: [],
    unreadCount: 0,
    isLoading: true,
    markRead: async () => { },
    markAllRead: async () => { },
    deleteNotification: async () => { },
    requestPushPermission: async () => { },
    setPanelOpen: () => { },
});

export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<DbNotification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const panelOpenRef = useRef(false);

    const setPanelOpen = useCallback((open: boolean) => {
        panelOpenRef.current = open;
    }, []);

    const requestPushPermission = useCallback(async () => {
        if (typeof window === "undefined" || !("Notification" in window)) return;
        if (Notification.permission === "default") {
            try {
                await Notification.requestPermission();
            } catch (err) {
                console.warn("Notification permission request failed:", err);
            }
        }
    }, []);

    const maybeFireBrowserPush = useCallback((n: DbNotification) => {
        if (typeof window === "undefined" || !("Notification" in window)) return;
        if (Notification.permission !== "granted") return;
        const tabHidden = document.visibilityState !== "visible";
        if (tabHidden || !panelOpenRef.current) {
            try {
                new Notification(n.title, {
                    body: n.body ?? undefined,
                    icon: "/favicon.ico",
                });
            } catch (err) {
                console.warn("Browser push failed:", err);
            }
        }
    }, []);

    // Fetch all notifications for the current user
    const fetchNotifications = useCallback(async () => {
        if (!user) {
            setNotifications([]);
            setIsLoading(false);
            return;
        }

        const { data, error } = await supabase
            .from("notifications")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(100);

        if (error) {
            console.error("Failed to fetch notifications:", error);
        }

        if (data) {
            setNotifications(data);
        }
        setIsLoading(false);
    }, [user]);

    // Set up Realtime subscription
    useEffect(() => {
        if (!user) return;

        fetchNotifications();

        // Subscribe to new notifications for this user
        const channel = supabase
            .channel(`notifications:${user.id}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "notifications",
                    filter: `user_id=eq.${user.id}`,
                },
                (payload) => {
                    console.log("Realtime INSERT received:", payload.new);
                    const newNotification = payload.new as DbNotification;
                    setNotifications((prev) => [newNotification, ...prev]);
                    maybeFireBrowserPush(newNotification);
                }
            )
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "notifications",
                    filter: `user_id=eq.${user.id}`,
                },
                (payload) => {
                    const updated = payload.new as DbNotification;
                    setNotifications((prev) =>
                        prev.map((n) => (n.id === updated.id ? updated : n))
                    );
                }
            )
            .on(
                "postgres_changes",
                {
                    event: "DELETE",
                    schema: "public",
                    table: "notifications",
                    filter: `user_id=eq.${user.id}`,
                },
                (payload) => {
                    const deleted = payload.old as { id: string };
                    setNotifications((prev) => prev.filter((n) => n.id !== deleted.id));
                }
            )
            .subscribe((status) => {
                if (status === "CHANNEL_ERROR") {
                    console.error("Notification realtime channel error");
                }
            });

        channelRef.current = channel;

        return () => {
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
        };
    }, [user, fetchNotifications, maybeFireBrowserPush]);

    // Clear state on logout
    useEffect(() => {
        if (!user) {
            setNotifications([]);
            setIsLoading(true);
        }
    }, [user]);

    const unreadCount = notifications.filter((n) => !n.read).length;

    const markRead = useCallback(async (id: string) => {
        if (!user) return;

        // Optimistic update
        const previousNotifications = notifications;
        setNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, read: true } : n))
        );
        const { error } = await supabase
            .from("notifications")
            .update({ read: true })
            .eq("id", id)
            .eq("user_id", user.id);

        if (error) {
            console.error("Failed to mark notification as read:", error);
            setNotifications(previousNotifications);
        }
    }, [notifications, user]);

    const markAllRead = useCallback(async () => {
        if (!user) return;
        // Optimistic update
        const previousNotifications = notifications;
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        const { error } = await supabase
            .from("notifications")
            .update({ read: true })
            .eq("user_id", user.id)
            .eq("read", false);

        if (error) {
            console.error("Failed to mark all notifications as read:", error);
            setNotifications(previousNotifications);
        }
    }, [notifications, user]);

    const deleteNotification = useCallback(async (id: string) => {
        if (!user) return;

        const previousNotifications = notifications;
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        const { error } = await supabase
            .from("notifications")
            .delete()
            .eq("id", id)
            .eq("user_id", user.id);

        if (error) {
            console.error("Failed to delete notification:", error);
            setNotifications(previousNotifications);
        }
    }, [notifications, user]);

    return (
        <NotificationContext.Provider
            value={{ notifications, unreadCount, isLoading, markRead, markAllRead, deleteNotification, requestPushPermission, setPanelOpen }}
        >
            {children}
        </NotificationContext.Provider>
    );
};
