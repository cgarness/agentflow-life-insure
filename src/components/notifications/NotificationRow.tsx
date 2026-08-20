import React from "react";
import {
  Bell, Trophy, PhoneMissed, UserPlus, Clock, Cake, Settings, MessageSquare, MoreHorizontal, Check, Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DbNotification } from "@/contexts/NotificationContext";
import { notificationTimeAgo } from "@/lib/notification-presentation";

// Category identity stays subtle: icon shape/color only, no colored row backgrounds.
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

export interface NotificationRowProps {
  notification: DbNotification;
  onOpen: (n: DbNotification) => void;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}

export const NotificationRow: React.FC<NotificationRowProps> = ({
  notification: n,
  onOpen,
  onMarkRead,
  onDismiss,
}) => {
  return (
    <div className="group relative flex items-start gap-1 border-b border-border/60 px-2 py-1 hover:bg-accent/40 transition-colors motion-reduce:transition-none">
      <button
        type="button"
        onClick={() => onOpen(n)}
        className="flex flex-1 min-w-0 items-start gap-3 rounded-md px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="mt-0.5 shrink-0" aria-hidden>{getNotifIcon(n.type)}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span
              data-testid="notification-title"
              className={`truncate text-sm ${n.read ? "font-medium text-foreground/90" : "font-semibold text-foreground"}`}
            >
              {n.title}
            </span>
            {!n.read && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />
            )}
          </span>
          {n.body && (
            <span className="mt-0.5 block truncate text-sm text-muted-foreground">{n.body}</span>
          )}
          <span className="mt-0.5 block text-xs text-muted-foreground/80">
            {notificationTimeAgo(n.created_at)}
          </span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Notification actions"
            className="mt-2 shrink-0 rounded-md p-1.5 text-muted-foreground opacity-60 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 motion-reduce:transition-none"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {!n.read && (
            <DropdownMenuItem onClick={() => onMarkRead(n.id)}>
              <Check className="mr-2 h-4 w-4" /> Mark as read
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => onDismiss(n.id)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
