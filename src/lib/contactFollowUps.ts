/**
 * Contact follow-ups — a DISPLAY-ONLY normalization of three real sources for ONE contact:
 *
 *   appointments    (contact_id)  — callback-type rows ("Follow Up" / "Call Back", Scheduled) are Callbacks;
 *   campaign_leads  (lead_id)     — campaign callbacks, `callback_due_at` wins over `scheduled_callback_at`;
 *   tasks           (contact_id + contact_type) — open tasks.
 *
 * The callback rules are the Dashboard contract's (`dashboard-callbacks.ts`, AGENT_RULES #22), imported
 * and never re-declared. No new table, no writes. Pure: no React, no Supabase calls (importing the
 * contract module loads the Supabase client, so tests mock `@/integrations/supabase/client`).
 */
import { APPOINTMENT_CALLBACK_TYPES, TERMINAL_CAMPAIGN_LEAD_STATUSES } from "@/lib/dashboard-callbacks";
import type { ContactType } from "@/lib/dashboard-contact-identity";
import { appointmentResponsibleUserId, isOpenAppointmentStatus } from "@/lib/calendar/appointmentOwnership";
import { endOfLocalDueDay, getTaskDueStatus } from "@/lib/taskDates";

export type FollowUpKind = "appointment" | "callback" | "task";
export type FollowUpSource = "appointment" | "campaign_lead" | "task";

export interface ContactRef {
  id: string;
  type: ContactType;
}

export interface ContactFollowUp {
  /** `${source}:${sourceRowId}` — stable React key across merged sources. */
  key: string;
  source: FollowUpSource;
  sourceRowId: string;
  kind: FollowUpKind;
  title: string;
  /** Absolute ISO instant as stored (timestamptz). Never shifted. */
  dueAt: string;
  /** Sort key (ms). `dueAt` for timed items; the end of the local due day for tasks. */
  rankAt: number;
  /** Tasks are day-granular: render the date only. */
  dateOnly: boolean;
  /** The responsible person. */
  assigneeId: string | null;
  /** Name carried by the source row itself (the task assignee embed), else null. */
  assigneeName: string | null;
  statusLabel: string;
  isOverdue: boolean;
  inProgress: boolean;
  contactId: string;
  contactType: ContactType;
  note: string | null;
}

export interface FollowUpAppointmentRow {
  id: string;
  title: string | null;
  type: string | null;
  status: string | null;
  start_time: string;
  end_time: string | null;
  notes: string | null;
  user_id: string | null;
  created_by: string | null;
  contact_id: string | null;
}

export interface FollowUpCampaignRow {
  id: string;
  lead_id: string | null;
  status: string | null;
  callback_due_at: string | null;
  scheduled_callback_at: string | null;
  callback_agent_id: string | null;
  callback_note: string | null;
  campaigns?: { name: string | null } | { name: string | null }[] | null;
}

export interface FollowUpTaskRow {
  id: string;
  contact_id: string;
  contact_type: string;
  assigned_to: string | null;
  title: string | null;
  task_type?: string | null;
  due_date: string;
  completed_at: string | null;
  notes?: string | null;
  assignee?: { first_name: string | null; last_name: string | null } | null;
}

export interface FollowUpSummary {
  primary: ContactFollowUp | null;
  total: number;
  /** Items other than the primary one. */
  others: number;
  /** Overdue items among the others ("2 other follow-ups · 1 overdue"). */
  overdue: number;
  /** A capped source returned its cap: counts are "at least". */
  truncated: boolean;
}

/** A non-callback appointment without an end time is treated as ending 30 min after its start. */
const DEFAULT_APPOINTMENT_SPAN_MS = 30 * 60 * 1000;
const SOURCE_RANK: Record<FollowUpSource, number> = { campaign_lead: 0, appointment: 1, task: 2 };
const CALLBACK_TYPES: readonly string[] = APPOINTMENT_CALLBACK_TYPES;
const TERMINAL_STATUSES: readonly string[] = TERMINAL_CAMPAIGN_LEAD_STATUSES;

function validTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Callback per the shared contract: callback type AND the contract's own "Scheduled" literal. */
export function isContractAppointmentCallback(row: { type: string | null; status: string | null }): boolean {
  return CALLBACK_TYPES.includes((row.type ?? "").trim()) && row.status === "Scheduled";
}

/** The main Dialer's shadow of a campaign callback: title exactly "Callback", non-callback type. */
export function isMainDialerCallbackShadow(row: { title: string | null; type: string | null }): boolean {
  return (row.title ?? "").trim().toLowerCase() === "callback" && !CALLBACK_TYPES.includes((row.type ?? "").trim());
}

export function normalizeAppointmentFollowUp(
  row: FollowUpAppointmentRow,
  contact: ContactRef,
  now: Date,
): ContactFollowUp | null {
  if (row.contact_id !== contact.id) return null;
  if (!isOpenAppointmentStatus(row.status)) return null;
  if (isMainDialerCallbackShadow(row)) return null;
  const isCallbackType = CALLBACK_TYPES.includes((row.type ?? "").trim());
  // Callback-type rows follow the Dashboard contract exactly (Scheduled only).
  if (isCallbackType && !isContractAppointmentCallback(row)) return null;
  const start = validTime(row.start_time);
  if (start === null) return null;
  const nowMs = now.getTime();

  let isOverdue = false;
  let inProgress = false;
  if (isCallbackType) {
    isOverdue = start < nowMs;
  } else {
    // A meeting is not a to-do: listed until it ends, never "overdue", then it leaves the card.
    const end = validTime(row.end_time) ?? start + DEFAULT_APPOINTMENT_SPAN_MS;
    if (nowMs >= end) return null;
    inProgress = nowMs >= start;
  }

  return {
    key: `appointment:${row.id}`,
    source: "appointment",
    sourceRowId: row.id,
    kind: isCallbackType ? "callback" : "appointment",
    title: row.title?.trim() || (isCallbackType ? "Callback" : "Appointment"),
    dueAt: row.start_time,
    rankAt: start,
    dateOnly: false,
    assigneeId: appointmentResponsibleUserId(row),
    assigneeName: null,
    statusLabel: inProgress ? "In progress" : (row.status ?? "").trim(),
    isOverdue,
    inProgress,
    contactId: contact.id,
    contactType: contact.type,
    note: row.notes ?? null,
  };
}

function campaignName(row: FollowUpCampaignRow): string | null {
  const embed = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns;
  const name = embed?.name?.trim();
  return name ? name : null;
}

export function normalizeCampaignCallbackFollowUp(
  row: FollowUpCampaignRow,
  contact: ContactRef,
  now: Date,
): ContactFollowUp | null {
  if (contact.type !== "lead" || row.lead_id !== contact.id) return null;
  // Terminal (and NULL) statuses are excluded, exactly as `status NOT IN (...)` does for the Dashboard.
  if (!row.status || TERMINAL_STATUSES.includes(row.status)) return null;
  // `callback_due_at` wins; one row always yields exactly one item.
  const dueAt = row.callback_due_at ?? row.scheduled_callback_at;
  const due = validTime(dueAt);
  if (!dueAt || due === null) return null;
  const name = campaignName(row);

  return {
    key: `campaign_lead:${row.id}`,
    source: "campaign_lead",
    sourceRowId: row.id,
    kind: "callback",
    title: name ? `Campaign callback · ${name}` : "Campaign callback",
    dueAt,
    rankAt: due,
    dateOnly: false,
    assigneeId: row.callback_agent_id ?? null,
    assigneeName: null,
    statusLabel: "Pending",
    isOverdue: due < now.getTime(),
    inProgress: false,
    contactId: contact.id,
    contactType: contact.type,
    note: row.callback_note ?? null,
  };
}

export function normalizeTaskFollowUp(row: FollowUpTaskRow, contact: ContactRef, now: Date): ContactFollowUp | null {
  if (row.contact_id !== contact.id || row.contact_type !== contact.type) return null;
  if (row.completed_at) return null;
  const due = validTime(row.due_date);
  if (due === null) return null;
  const status = getTaskDueStatus(row.due_date, null, now);
  const embedName = `${row.assignee?.first_name ?? ""} ${row.assignee?.last_name ?? ""}`.trim();

  return {
    key: `task:${row.id}`,
    source: "task",
    sourceRowId: row.id,
    kind: "task",
    title: row.title?.trim() || "Task",
    dueAt: row.due_date,
    rankAt: endOfLocalDueDay(row.due_date).getTime(),
    dateOnly: true,
    assigneeId: row.assigned_to ?? null,
    assigneeName: embedName || null,
    statusLabel: status === "today" ? "Due today" : "Open",
    isOverdue: status === "overdue",
    inProgress: false,
    contactId: contact.id,
    contactType: contact.type,
    note: row.notes ?? null,
  };
}

export function compareFollowUps(a: ContactFollowUp, b: ContactFollowUp): number {
  if (a.rankAt !== b.rankAt) return a.rankAt - b.rankAt;
  const rank = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  if (rank !== 0) return rank;
  return a.sourceRowId < b.sourceRowId ? -1 : a.sourceRowId > b.sourceRowId ? 1 : 0;
}

/** Normalize, drop everything that is not an open follow-up of THIS contact, and order. */
export function buildContactFollowUps(input: {
  contact: ContactRef;
  appointments: readonly FollowUpAppointmentRow[];
  campaign: readonly FollowUpCampaignRow[];
  tasks: readonly FollowUpTaskRow[];
  now: Date;
}): ContactFollowUp[] {
  const { contact, now } = input;
  const items: ContactFollowUp[] = [];
  for (const row of input.appointments) {
    const item = normalizeAppointmentFollowUp(row, contact, now);
    if (item) items.push(item);
  }
  for (const row of input.campaign) {
    const item = normalizeCampaignCallbackFollowUp(row, contact, now);
    if (item) items.push(item);
  }
  for (const row of input.tasks) {
    const item = normalizeTaskFollowUp(row, contact, now);
    if (item) items.push(item);
  }
  return items.sort(compareFollowUps);
}

/** Primary = the next actionable item; with nothing actionable, the most recently due overdue one. */
export function summarizeFollowUps(sorted: readonly ContactFollowUp[], truncated: boolean): FollowUpSummary {
  const actionable = sorted.filter((i) => !i.isOverdue);
  const overdueItems = sorted.filter((i) => i.isOverdue);
  const primary = actionable[0] ?? overdueItems[overdueItems.length - 1] ?? null;
  return {
    primary,
    total: sorted.length,
    others: Math.max(0, sorted.length - 1),
    overdue: overdueItems.filter((i) => i !== primary).length,
    truncated,
  };
}

/** View-all grouping: overdue (oldest first), then upcoming in order. */
export function groupFollowUps(sorted: readonly ContactFollowUp[]): {
  overdue: ContactFollowUp[];
  upcoming: ContactFollowUp[];
} {
  return {
    overdue: sorted.filter((i) => i.isOverdue),
    upcoming: sorted.filter((i) => !i.isOverdue),
  };
}

/**
 * The viewer's short time-zone name AT that instant (so a date after the DST change reads PST, not
 * PDT). A label only — nothing is converted. "en-US" like `getContactTimezone`; non-US zones read GMT±N.
 */
export function viewerTimeZoneLabel(date: Date): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}
