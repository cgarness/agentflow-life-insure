// Pure presentation helpers for the notifications drawer. No React, no Supabase.

export type NotificationLike = {
  id: string;
  read: boolean;
  created_at: string;
};

export type NotificationFilter = "all" | "unread";

export const NOTIFICATION_FILTERS: ReadonlyArray<{ value: NotificationFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
];

export function filterNotifications<T extends NotificationLike>(
  items: T[],
  filter: NotificationFilter,
): T[] {
  if (filter === "unread") return items.filter((n) => !n.read);
  return items;
}

function newestFirst<T extends NotificationLike>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const at = new Date(a.created_at).getTime();
    const bt = new Date(b.created_at).getTime();
    return bt - at;
  });
}

/** Unread rows group under "New", read rows under "Earlier"; newest first within each. */
export function groupNotifications<T extends NotificationLike>(
  items: T[],
): { newItems: T[]; earlierItems: T[] } {
  return {
    newItems: newestFirst(items.filter((n) => !n.read)),
    earlierItems: newestFirst(items.filter((n) => n.read)),
  };
}

export function notificationTimeAgo(dateStr: string, nowMs: number = Date.now()): string {
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, nowMs - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
  return new Date(dateStr).toLocaleDateString();
}

/**
 * Guard for notification action_url navigation: accept only a plain in-app path.
 * Rejects protocols, protocol-relative URLs, backslashes, and whitespace/control characters —
 * the safe-redirect pattern, without touching that module's deliberately narrow allowlist.
 */
export function isInternalAppPath(url: string | null | undefined): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  if (!url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  if (url.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return false;
  if (url.includes(":")) return false;
  return true;
}
