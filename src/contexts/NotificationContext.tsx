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
}

const NotificationContext = createContext<NotificationContextType>({
    notifications: [],
    unreadCount: 0,
    isLoading: true,
    markRead: async () => { },
    markAllRead: async () => { },
    deleteNotification: async () => { },
});

export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<DbNotification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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

        if (!error && data) {
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
                    const newNotification = payload.new as DbNotification;
                    setNotifications((prev) => [newNotification, ...prev]);
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
            .subscribe();

        channelRef.current = channel;

        return () => {
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
        };
    }, [user, fetchNotifications]);

    // Clear state on logout
    useEffect(() => {
        if (!user) {
            setNotifications([]);
            setIsLoading(true);
        }
    }, [user]);

    const unreadCount = notifications.filter((n) => !n.read).length;

    const markRead = useCallback(async (id: string) => {
        // Optimistic update
        setNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, read: true } : n))
        );
        await supabase.from("notifications").update({ read: true }).eq("id", id);
    }, []);

    const markAllRead = useCallback(async () => {
        if (!user) return;
        // Optimistic update
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        await supabase
            .from("notifications")
            .update({ read: true })
            .eq("user_id", user.id)
            .eq("read", false);
    }, [user]);

    const deleteNotification = useCallback(async (id: string) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        await supabase.from("notifications").delete().eq("id", id);
    }, []);

    return (
        <NotificationContext.Provider
            value={{ notifications, unreadCount, isLoading, markRead, markAllRead, deleteNotification }}
        >
            {children}
        </NotificationContext.Provider>
    );
};
