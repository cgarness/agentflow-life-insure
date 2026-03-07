import { notificationsApi } from "@/lib/mock-api";
import { Notification } from "@/lib/types";

export type NotificationFilterCategory = "All" | "Calls" | "Leads" | "System";

const typeToCategoryMap: Record<Notification["type"], Exclude<NotificationFilterCategory, "All">> = {
  win: "System",
  missed_call: "Calls",
  lead_claimed: "Leads",
  appointment_reminder: "System",
  anniversary: "System",
  system: "System",
};

export const notificationFilterTabs: NotificationFilterCategory[] = ["All", "Calls", "Leads", "System"];

export const notificationsService = {
  async listNotifications(): Promise<Notification[]> {
    return notificationsApi.getAll();
  },
  async markNotificationRead(notificationId: string): Promise<void> {
    await notificationsApi.markRead(notificationId);
  },
  async markAllNotificationsRead(): Promise<void> {
    await notificationsApi.markAllRead();
  },
  async getUnreadNotificationsCount(): Promise<number> {
    return notificationsApi.getUnreadCount();
  },
  getFilterCategory(notificationType: Notification["type"]): Exclude<NotificationFilterCategory, "All"> {
    return typeToCategoryMap[notificationType] ?? "System";
  },
  filterNotifications(
    notifications: Notification[],
    category: NotificationFilterCategory,
  ): Notification[] {
    if (category === "All") {
      return notifications;
    }

    return notifications.filter((notification) =>
      typeToCategoryMap[notification.type] === category,
    );
  },
};
