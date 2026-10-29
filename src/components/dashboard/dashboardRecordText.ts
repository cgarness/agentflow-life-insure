import { format, parseISO } from "date-fns";
import { formatPremiumSold } from "@/components/leaderboard/leaderboardTypes";

export type RecordType = "calls_today" | "appointments" | "policies_sold" | "premium_sold" | "missed_calls";

/** A sale's agency Sold Date (YYYY-MM-DD) as a calendar date; never shifted through UTC. */
const soldDateLabel = (soldDate?: string | null) => (soldDate ? ` • Sold ${format(parseISO(soldDate), "MM/dd/yyyy")}` : "");
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Title and detail line of one record (wording unchanged from the previous modal). */
export function recordText(type: RecordType, item: any): { title: string; meta: string } {
  switch (type) {
    case "appointments":
      return { title: item.contact_name || item.title || "Scheduled Event", meta: `${time(item.start_time)}${item.type ? ` • ${item.type}` : ""}` };
    case "calls_today":
    case "missed_calls": {
      const direction = item.direction === "inbound" ? "Inbound" : "Outbound";
      const duration = item.duration ? ` • ${Math.floor(item.duration / 60)}m ${item.duration % 60}s` : "";
      return {
        title: item.contact_name || item.contact_phone || "Caller",
        meta: `${direction} • ${time(item.created_at)}${duration}${item.disposition_name ? ` • ${item.disposition_name}` : ""}`,
      };
    }
    case "policies_sold":
      return {
        title: item.contact_name || `${item.first_name} ${item.last_name}`,
        meta: `${item.policy_type || "Life Insurance"}${item.premium_amount != null ? ` • ${formatPremiumSold(item.premium_amount)} monthly` : " • Premium unknown"}${soldDateLabel(item.sold_date)}`,
      };
    case "premium_sold":
      return {
        title: item.contact_name || "Activity",
        meta: item.policy_type
          ? `Closed: ${item.policy_type} • ${item.annual_premium == null ? "Premium unknown" : `${formatPremiumSold(item.annual_premium)} annual premium`}${soldDateLabel(item.sold_date)}`
          : `Call: ${item.disposition_name || "Completed"}`,
      };
  }
}
