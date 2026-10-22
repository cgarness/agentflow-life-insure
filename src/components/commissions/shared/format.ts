import { formatCalendarDate, formatDateRange, formatMonth, INSTALLMENT_LABELS } from "@/lib/commission/installments";
import type { InstallmentKind } from "@/lib/commission/trackingSchemas";
import type { CenterContact, RowStatus, SetupState } from "@/lib/commission/centerSchemas";

/** "Oct 5 – 7, 2026", "Oct 2026" (month timing) or "Date needed". Calendar dates only; the full window is always shown. */
export function windowLabel(row: { timing_precision?: "unknown" | "month" | "date"; expected_on?: string | null; expected_until?: string | null }): string {
  if (row.timing_precision === "unknown" || !row.expected_on) return "Date needed";
  if (row.timing_precision === "month") return formatMonth(row.expected_on);
  return row.expected_until ? formatDateRange(row.expected_on, row.expected_until) : formatCalendarDate(row.expected_on);
}

export const kindLabel = (kind: InstallmentKind) => INSTALLMENT_LABELS[kind];

export type ChipTone = "positive" | "attention" | "neutral" | "muted";

/** Row states. "Check payment" never says overdue: a missing receipt record is not proof the carrier did not pay. */
export const ROW_STATUS: Record<RowStatus, { label: string; tone: ChipTone } | null> = {
  upcoming: { label: "Upcoming", tone: "neutral" },
  check_payment: { label: "Check payment", tone: "attention" },
  received: { label: "Received", tone: "positive" },
  date_needed: { label: "Date needed", tone: "attention" },
  on_hold: { label: "On hold", tone: "muted" },
  none: null,
};

export const SETUP_STATE: Record<SetupState, { label: string; tone: ChipTone } | null> = {
  recorded: null,
  on_hold: { label: "On hold", tone: "muted" },
  needs_review: { label: "Needs review", tone: "attention" },
  missing: { label: "Missing", tone: "attention" },
};

/** "Oct 1 – 31, 2026" for a period or a timeline month. */
export const rangeLabel = (from: string, to: string) => formatDateRange(from, to);

/** Client name, or a neutral label when the viewer can no longer open that contact (financial history stays visible). */
export function contactName(contact: CenterContact): string {
  if (!contact) return "Restricted contact";
  return contact.name?.trim() || "Unnamed client";
}
