// Capture-only providers. Never imported by the application or production build.
// Queries and telephony cannot reach a service; only the fixtures below exist.
import { format, parseISO } from "date-fns";
export const useAuth = () => ({ user: { id: "demo-agent" }, profile: { id: "demo-agent", role: "Agent", organization_id: "demo-org" } });
const date = (value: string | Date) => typeof value === "string" ? parseISO(value) : value;
export const useBranding = () => ({ branding: { timezone: "America/Los_Angeles", companyName: "Demo workspace" },
  formatTime: (value: string | Date) => format(date(value), "h:mm a"),
  formatDate: (value: string | Date) => format(date(value), "MM/dd/yyyy") });
const deny = () => { throw new Error("External service unavailable in synthetic capture"); };
export const supabase = { from: deny, rpc: deny, channel: deny, functions: { invoke: deny },
  auth: { getSession: deny, getUser: deny }, storage: { from: deny } };
export function useDashboardSection({ section }: { section: string }) {
  const appointments = [
    { id: "demo-a", contact_name: "Casey Demo", title: "Coverage review", type: "Policy Review", status: "Confirmed", start_time: "2026-10-29T22:00:00Z" },
    { id: "demo-b", contact_name: "Morgan Demo", title: "Follow-up", type: "Sales Call", status: "Scheduled", start_time: "2026-10-29T23:30:00Z" },
  ];
  const callbacks = { overdue: [], dueSoon: [], totalCount: 1, dueToday: [{ key: "demo-callback", source: "campaign", sourceRowId: "demo-cb",
    dueAt: "2026-10-29T22:30:00Z", contactId: "11111111-0000-4000-8000-000000000001", contactType: "lead", contactName: "Riley Demo",
    phone: "2025550142", note: "Requested a coverage review", canAct: false, blockedReason: "Capture-only sample" }] };
  return { data: section === "appointments" ? appointments : callbacks, loading: false, failed: false, offline: false,
    refreshing: false, complete: true, updatedAt: Date.now(), reload: async () => {}, error: null };
}
