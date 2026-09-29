import { viewerTimeZoneLabel, type ContactFollowUp, type FollowUpKind } from "@/lib/contactFollowUps";

export const FOLLOW_UP_KIND_LABEL: Record<FollowUpKind, string> = {
  appointment: "Appointment",
  callback: "Callback",
  task: "Task",
};

/**
 * Due text via the app's existing formatters (viewer-local, org 12/24h setting) plus the viewer's
 * zone label at that instant. Tasks are day-granular: date only.
 */
export function formatFollowUpDue(
  item: ContactFollowUp,
  fmt: { formatDate: (d: string) => string; formatDateTime: (d: string) => string },
): string {
  if (item.dateOnly) return fmt.formatDate(item.dueAt);
  return `${fmt.formatDateTime(item.dueAt)} ${viewerTimeZoneLabel(new Date(item.dueAt))}`.trim();
}

export function formatFollowUpAssignee(item: ContactFollowUp, resolveAgentName: (id: string) => string): string {
  if (item.assigneeName) return item.assigneeName;
  if (!item.assigneeId) return "Unassigned";
  return resolveAgentName(item.assigneeId) || "Unassigned";
}
