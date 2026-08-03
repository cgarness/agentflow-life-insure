/**
 * dashboard-callbacks — the ONE callback data contract for the Dashboard.
 *
 * Consumed by all three call sites, which may differ only in page size:
 *   - CallbacksWidget rows
 *   - CallbacksWidget exact total
 *   - DashboardDetailModal callback rows
 *
 * ## Why this is DUAL-SOURCE (approved decision)
 *
 * AgentFlow has **two live callback writers** that persist to different tables, and
 * neither can be dropped without losing real callbacks:
 *
 *  - **Campaign callbacks** — `DialerPage` → `advance_campaign_lead` writes the canonical
 *    `campaign_leads.callback_due_at` / `callback_agent_id` / `callback_note`
 *    (AGENT_RULES #16).
 *  - **Non-campaign callbacks** — `FloatingDialer` (quick-call) inserts an `appointments`
 *    row (`type: 'Follow Up'`, `status: 'Scheduled'`). A quick call has no
 *    `campaign_lead`, so it *cannot* write the canonical fields.
 *
 * Reading only `campaign_leads` would silently drop every quick-call callback. The
 * `appointments` source is therefore a supported compatibility source, **not** dead data.
 * A unified non-campaign callback architecture is a separate, unapproved project.
 *
 * ## Compatibility timestamp
 *
 * PostgREST cannot filter, order or paginate on a SQL `COALESCE`, so campaign callbacks
 * are read as **two mutually exclusive branches** — `callback_due_at IS NOT NULL`, and
 * `callback_due_at IS NULL AND scheduled_callback_at IS NOT NULL`. Each is bounded and
 * ordered by its own column, so a row appears exactly once and `callback_due_at` always
 * wins when both are populated.
 *
 * ## Pagination
 *
 * Each branch is fetched to `offset + pageSize`, merged, globally ordered, and only then
 * sliced. Offsetting each branch independently and concatenating would create gaps and
 * duplicates wherever the sources interleave.
 *
 * Read-only. No migration, RPC, view, RLS change or Supabase mutation.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  type ContactType,
  resolveContactDetailsByIds,
} from "@/lib/dashboard-contact-identity";
import { localCalendarWindow, windowToIso } from "@/lib/local-calendar";

/** Which writer a normalized row came from. */
export type CallbackSource = "campaign" | "appointment";

/** Stable tie-breaker so equal `dueAt` values never reorder between renders. */
const SOURCE_RANK: Record<CallbackSource, number> = { campaign: 0, appointment: 1 };

/**
 * `campaign_leads.status` values that are terminal, taken verbatim from AGENT_RULES #15
 * (`get_next_queue_lead` excludes exactly these). A terminal lead can still carry a
 * stale callback timestamp, so it must not surface as a pending callback. This list is
 * quoted from the canonical queue contract, not invented here.
 */
export const TERMINAL_CAMPAIGN_LEAD_STATUSES = ["DNC", "Completed", "Removed", "Failed"] as const;

/** Appointment types that represent a callback rather than a meeting. */
export const APPOINTMENT_CALLBACK_TYPES = ["Follow Up", "Call Back"] as const;

/** Default bounded window. Overdue matters; "every callback ever" does not. */
export const CALLBACK_LOOKBACK_DAYS = 30;
export const CALLBACK_LOOKAHEAD_DAYS = 4;

export interface NormalizedCallbackRow {
  /** Source-qualified unique key — safe as a React key across merged sources. */
  key: string;
  source: CallbackSource;
  /** The row id in its own table. NEVER used as a contact identity. */
  sourceRowId: string;
  /** ISO due timestamp already resolved through the compatibility rule. */
  dueAt: string;
  contactId: string | null;
  contactType: ContactType | null;
  contactName: string;
  phone: string;
  note: string | null;
  /** True only when the row has a usable contact identity, type and number. */
  canAct: boolean;
  /** Human-readable reason `canAct` is false, for a truthful disabled state. */
  blockedReason: string | null;
}

export interface CallbackScope {
  /** Personal filtering. When false, RLS alone decides (existing Admin behavior). */
  isFiltered: boolean;
  userId: string;
}

export interface CallbackQueryOptions extends CallbackScope {
  /** Reference instant; the window is built from its local calendar day. */
  reference?: Date;
  lookbackDays?: number;
  lookaheadDays?: number;
}

/** The shared bounded window every branch and the counts must agree on. */
export function callbackWindow(opts: CallbackQueryOptions) {
  return windowToIso(
    localCalendarWindow(
      opts.reference ?? new Date(),
      opts.lookbackDays ?? CALLBACK_LOOKBACK_DAYS,
      opts.lookaheadDays ?? CALLBACK_LOOKAHEAD_DAYS,
    ),
  );
}

/**
 * Descriptor of one source branch. Exported so tests can assert that the row query and
 * the count query are built from the *same* descriptors — making divergence structurally
 * impossible rather than merely unlikely.
 */
export interface CallbackBranch {
  id: "campaign-due" | "campaign-legacy" | "appointment";
  source: CallbackSource;
  table: "campaign_leads" | "appointments";
  /** Column the branch is bounded and ordered by. */
  dueColumn: "callback_due_at" | "scheduled_callback_at" | "start_time";
  /** Ownership column applied for personal filtering, per source. */
  ownerColumn: "callback_agent_id" | "user_id";
}

export function callbackBranches(): CallbackBranch[] {
  return [
    {
      id: "campaign-due",
      source: "campaign",
      table: "campaign_leads",
      dueColumn: "callback_due_at",
      ownerColumn: "callback_agent_id",
    },
    {
      id: "campaign-legacy",
      source: "campaign",
      table: "campaign_leads",
      dueColumn: "scheduled_callback_at",
      ownerColumn: "callback_agent_id",
    },
    {
      id: "appointment",
      source: "appointment",
      table: "appointments",
      dueColumn: "start_time",
      ownerColumn: "user_id",
    },
  ];
}

/** Build one branch's filter chain. Shared verbatim by the rows and count queries. */
function applyBranchFilters(query: any, branch: CallbackBranch, opts: CallbackQueryOptions) {
  const { startIso, endIso } = callbackWindow(opts);
  let q = query.gte(branch.dueColumn, startIso).lt(branch.dueColumn, endIso);

  if (branch.table === "campaign_leads") {
    // Terminal leads can retain a stale callback timestamp — exclude per AGENT_RULES #15.
    q = q.not("status", "in", `(${TERMINAL_CAMPAIGN_LEAD_STATUSES.join(",")})`);
    if (branch.id === "campaign-due") {
      q = q.not("callback_due_at", "is", null);
    } else {
      // Mutually exclusive with campaign-due, so no row is counted twice.
      q = q.is("callback_due_at", null).not("scheduled_callback_at", "is", null);
    }
  } else {
    q = q.in("type", [...APPOINTMENT_CALLBACK_TYPES]).eq("status", "Scheduled");
  }

  // Personal filtering uses the ownership column that belongs to THIS source.
  if (opts.isFiltered) q = q.eq(branch.ownerColumn, opts.userId);
  return q;
}

const CAMPAIGN_COLUMNS =
  "id, lead_id, first_name, last_name, phone, callback_due_at, scheduled_callback_at, callback_note, status";
const APPOINTMENT_COLUMNS = "id, contact_id, contact_name, start_time, type, notes";

/** Exact total across the mutually exclusive branches. Never a page length. */
export async function fetchCallbackTotal(opts: CallbackQueryOptions): Promise<number> {
  const counts = await Promise.all(
    callbackBranches().map((branch) =>
      applyBranchFilters(
        supabase.from(branch.table).select("id", { count: "exact", head: true }) as any,
        branch,
        opts,
      ),
    ),
  );
  return counts.reduce((sum, res: any) => sum + (res?.count ?? 0), 0);
}

/** Global ordering: dueAt ASC, then stable source rank, then source row id ASC. */
export function compareCallbackRows(a: NormalizedCallbackRow, b: NormalizedCallbackRow): number {
  if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  const rank = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  if (rank !== 0) return rank;
  return a.sourceRowId < b.sourceRowId ? -1 : a.sourceRowId > b.sourceRowId ? 1 : 0;
}

/**
 * Fetch, normalize, globally order and slice one page of callbacks.
 *
 * Every branch is fetched to `offset + pageSize` so the union provably contains the
 * global first `offset + pageSize` rows before the slice is taken.
 */
export async function fetchCallbackPage(
  opts: CallbackQueryOptions & { pageSize: number; offset?: number },
): Promise<NormalizedCallbackRow[]> {
  const offset = opts.offset ?? 0;
  const ceiling = offset + opts.pageSize;

  const branchResults = await Promise.all(
    callbackBranches().map((branch) => {
      const columns = branch.table === "campaign_leads" ? CAMPAIGN_COLUMNS : APPOINTMENT_COLUMNS;
      const q = applyBranchFilters(supabase.from(branch.table).select(columns) as any, branch, opts)
        .order(branch.dueColumn, { ascending: true })
        .order("id", { ascending: true })
        .limit(ceiling);
      return q.then((res: any) => ({ branch, rows: (res?.data ?? []) as any[] }));
    }),
  );

  // One batched lookup resolves both the contact type and a dialable number for
  // campaign leads (via lead_id) and appointment contacts (via contact_id).
  const idsToResolve: string[] = [];
  for (const { branch, rows } of branchResults) {
    for (const row of rows) {
      const id = branch.table === "campaign_leads" ? row.lead_id : row.contact_id;
      if (typeof id === "string" && id.length > 0) idsToResolve.push(id);
    }
  }
  const details = await resolveContactDetailsByIds(idsToResolve);

  const normalized: NormalizedCallbackRow[] = [];
  for (const { branch, rows } of branchResults) {
    for (const row of rows) {
      normalized.push(
        branch.table === "campaign_leads"
          ? normalizeCampaignRow(row, branch, details)
          : normalizeAppointmentRow(row, branch, details),
      );
    }
  }

  return normalized.sort(compareCallbackRows).slice(offset, offset + opts.pageSize);
}

function blockedFor(contactId: string | null, type: ContactType | null, phone: string): string | null {
  if (!contactId) return "No linked contact record — the source contact was removed.";
  if (!type) return "Contact type could not be determined.";
  if (!/\d/.test(phone)) return "No phone number on file.";
  return null;
}

/** Campaign callbacks are lead-sourced only when a real, visible lead is behind them. */
export function normalizeCampaignRow(
  row: any,
  branch: CallbackBranch,
  details: Map<string, { type: ContactType; name: string; phone: string }>,
): NormalizedCallbackRow {
  // `callback_due_at` wins whenever populated; the legacy branch only ever sees nulls.
  const dueAt: string = row.callback_due_at ?? row.scheduled_callback_at;
  const resolved = typeof row.lead_id === "string" ? details.get(row.lead_id) : undefined;

  // A null OR dangling `lead_id` (deleted lead, or not RLS-visible) still renders and
  // still counts — the callback commitment is real — but cannot be acted on.
  const contactId = resolved ? row.lead_id : null;
  const contactType: ContactType | null = resolved ? resolved.type : null;

  const denormName = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  const contactName = resolved?.name || denormName || "Unknown";
  const phone = resolved?.phone || row.phone || "";
  const blockedReason = blockedFor(contactId, contactType, phone);

  return {
    key: `campaign:${row.id}`,
    source: "campaign",
    sourceRowId: row.id,
    dueAt,
    contactId,
    contactType,
    contactName,
    phone,
    note: row.callback_note ?? null,
    canAct: blockedReason === null,
    blockedReason,
  };
}

/** Appointment callbacks resolve their polymorphic `contact_id` against real rows. */
export function normalizeAppointmentRow(
  row: any,
  branch: CallbackBranch,
  details: Map<string, { type: ContactType; name: string; phone: string }>,
): NormalizedCallbackRow {
  const resolved = typeof row.contact_id === "string" ? details.get(row.contact_id) : undefined;
  const contactId = resolved ? row.contact_id : null;
  const contactType: ContactType | null = resolved ? resolved.type : null;
  const contactName = row.contact_name || resolved?.name || "Unknown";
  const phone = resolved?.phone || "";
  const blockedReason = blockedFor(contactId, contactType, phone);

  return {
    key: `appointment:${row.id}`,
    source: "appointment",
    sourceRowId: row.id,
    dueAt: row.start_time,
    contactId,
    contactType,
    contactName,
    phone,
    note: row.notes ?? null,
    canAct: blockedReason === null,
    blockedReason,
  };
}

export type CallbackBucket = "overdue" | "dueToday" | "dueSoon";

/**
 * Today's bucket rule — the deliberate exception in the date contract: Today shows
 * overdue **plus** due-today. All boundaries are calendar-constructed local midnights.
 */
export function bucketCallback(
  row: NormalizedCallbackRow,
  now: Date,
  todayEndExclusive: Date,
): CallbackBucket {
  const due = new Date(row.dueAt);
  if (due < now) return "overdue";
  if (due < todayEndExclusive) return "dueToday";
  return "dueSoon";
}
