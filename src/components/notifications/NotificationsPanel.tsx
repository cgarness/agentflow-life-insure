import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, X, Trophy, PhoneMissed, UserPlus, Clock,
  Cake, Settings, MessageSquare,
} from "lucide-react";
import { useNotifications } from "@/contexts/NotificationContext";

const NOTIF_TABS = ["All", "Calls", "Leads", "Messages", "System"] as const;
type NotifTab = typeof NOTIF_TABS[number];

const TAB_TYPE_MAP: Record<NotifTab, string[] | null> = {
  All: null,
  Calls: ["missed_call", "win"],
  Leads: ["lead_claimed", "lead_assigned"],
  Messages: ["inbound_sms", "inbound_email"],
  System: ["system", "appointment_reminder", "anniversary"],
};

function getNotifIcon(type: string) {
  switch (type) {
    case "win": return <Trophy className="w-4 h-4 text-yellow-500" />;
    case "missed_call": return <PhoneMissed className="w-4 h-4 text-red-400" />;
    case "lead_claimed":
    case "lead_assigned": return <UserPlus className="w-4 h-4 text-blue-400" />;
    case "appointment_reminder": return <Clock className="w-4 h-4 text-orange-400" />;
    case "anniversary": return <Cake className="w-4 h-4 text-pink-400" />;
    case "system": return <Settings className="w-4 h-4 text-gray-400" />;
    case "inbound_sms":
    case "inbound_email": return <MessageSquare className="w-4 h-4 text-violet-400" />;
    default: return <Bell className="w-4 h-4 text-gray-400" />;
  }
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
  return new Date(dateStr).toLocaleDateString();
}

export interface NotificationsPanelProps {
  open: boolean;
  onClose: () => void;
}

export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({ open, onClose }) => {
  const { notifications, unreadCount, markRead, markAllRead, deleteNotification } = useNotifications();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<NotifTab>("All");

  const filteredNotifications = useMemo(() => {
    const types = TAB_TYPE_MAP[activeTab];
    if (!types) return notifications;
    return notifications.filter((n) => types.includes(n.type));
  }, [notifications, activeTab]);

  const tabUnreadCounts = useMemo(() => {
    const counts: Record<NotifTab, number> = { All: 0, Calls: 0, Leads: 0, Messages: 0, System: 0 };
    notifications.forEach((n) => {
      if (!n.read) {
        counts.All++;
        if (["missed_call", "win"].includes(n.type)) counts.Calls++;
        if (["lead_claimed", "lead_assigned"].includes(n.type)) counts.Leads++;
        if (["inbound_sms", "inbound_email"].includes(n.type)) counts.Messages++;
        if (["system", "appointment_reminder", "anniversary"].includes(n.type)) counts.System++;
      }
    });
    return counts;
  }, [notifications]);

  const handleNotifClick = async (n: any) => {
    if (!n.read) await markRead(n.id);
    if (n.action_url) {
      onClose();
      navigate(n.action_url);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 w-[380px] max-w-full h-screen bg-card border-l shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-foreground">Notifications</h2>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button onClick={() => markAllRead()} className="text-xs text-primary hover:underline">
                Mark All Read
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex border-b">
          {NOTIF_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-sm font-medium sidebar-transition relative ${
                activeTab === tab
                  ? "text-foreground border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {tab === "Messages" ? (
                <span className="inline-flex items-center justify-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Messages</span>
                </span>
              ) : (
                tab
              )}
              {tabUnreadCounts[tab] > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-destructive text-destructive-foreground">
                  {tabUnreadCounts[tab]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <Bell className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : (
            filteredNotifications.map((n) => (
              <div
                key={n.id}
                className={`group w-full flex items-start gap-3 px-4 py-3 border-b hover:bg-accent/50 sidebar-transition text-left ${
                  !n.read ? "bg-primary/5" : ""
                }`}
              >
                <button onClick={() => handleNotifClick(n)} className="flex items-start gap-3 flex-1 min-w-0 text-left">
                  <div className="mt-0.5 shrink-0">{getNotifIcon(n.type)}</div>
                  {!n.read && <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{n.title}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">{n.body}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
                      {n.action_label && n.action_url && (
                        <span className="text-xs text-primary font-medium">{n.action_label}</span>
                      )}
                    </div>
                  </div>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  aria-label="Delete notification"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};
