/**
 * Contacts Build 2 — the ONE canonical filter contract.
 *
 * The page builds a `LeadFilterPayload` (resolving timezone groups and
 * callable-now into concrete state sets via the canonical timezoneUtils maps)
 * and hands the SAME payload to every Lead record operation: list rows, exact
 * total, matching IDs, select-all, delete, status change, assign, add-to-campaign.
 * Rows == count == ids can never drift because they share one payload.
 *
 * Scope only ever NARROWS within RLS — it never widens access.
 */

import {
  PRIMARY_TIMEZONE_MAP,
  STATE_TIMEZONES,
  isCallableNow,
} from "@/utils/timezoneUtils";

export type ContactScope = "mine" | "team" | "agency";

/** Attempt-count buckets (Build 2 decision D2). The orphaned "5+" bucket is gone. */
export const ATTEMPT_BUCKETS = ["0", "1-3", "4+"] as const;
export type AttemptBucket = (typeof ATTEMPT_BUCKETS)[number];

/** Sentinel for the "No Disposition" filter option. */
export const NO_DISPOSITION = "__none__" as const;

/** UI-level lead filter inputs (what the page holds in state). */
export interface LeadUiFilters {
  scope: ContactScope;
  /** Specific-agent narrowing, already constrained to the active scope by the UI. */
  agentIds?: string[];
  search?: string;
  status?: string;
  source?: string;
  state?: string;
  startDate?: string; // ISO
  endDate?: string; // ISO
  /** Selected timezone groups (e.g. "Eastern"); resolved to a state set here. */
  timezoneGroups?: string[];
  /** Callable-Now toggle; resolved to a frozen callable state set here. */
  callableNow?: boolean;
  /**
   * Pre-frozen callable state snapshot (select-all). When present it is used
   * verbatim so a later bulk action can't target a different set if the clock
   * crosses a calling-window boundary.
   */
  frozenCallableStates?: string[] | null;
  attemptBuckets?: string[];
  /** "" = no filter; a value; or NO_DISPOSITION. */
  lastDisposition?: string;
  /** Canonical sort key (LEAD_SORT_COLUMNS) — invalid/missing → default created_at desc. */
  sortColumn?: string | null;
  sortDirection?: string | null;
  page?: number;
  pageSize?: number;
}

/** The exact jsonb shape passed to the SQL RPCs (`p_filters`). */
export interface LeadFilterPayload {
  scope: ContactScope;
  agent_ids?: string[] | null;
  search?: string | null;
  status?: string | null;
  source?: string | null;
  state?: string | null;
  created_start?: string | null;
  created_end?: string | null;
  timezone_states?: string[] | null;
  callable_states?: string[] | null;
  attempt_buckets?: string[] | null;
  last_disposition?: string | null;
  sort_column?: string | null;
  sort_direction?: string | null;
  page?: number;
  page_size?: number;
}

// ---------------------------------------------------------------------------
// Sorting (Build 2 full-dataset, server-side, before LIMIT/OFFSET).
// TS allowlist (first gate) — the SQL has its own allowlist (second gate).
// Invalid/missing column OR direction → the tab's default sort (created_at desc).
// ---------------------------------------------------------------------------

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];
export const DEFAULT_SORT: { column: string; direction: SortDirection } = { column: "created_at", direction: "desc" };

export const LEAD_SORT_COLUMNS = [
  "name", "status", "lead_source", "state", "phone", "email", "dob", "best_time",
  "last_contacted", "assigned_agent", "attempt_count", "last_disposition", "created_at",
] as const;
export const CLIENT_SORT_COLUMNS = [
  "name", "phone", "email", "state", "policy_type", "carrier", "premium",
  "face_amount", "issue_date", "assigned_agent", "created_at",
] as const;
export const RECRUIT_SORT_COLUMNS = [
  "name", "phone", "email", "state", "status", "assigned_agent", "created_at",
] as const;

// Frontend column-key → canonical sort key, per tab.
const LEAD_COL_TO_CANONICAL: Record<string, string> = {
  name: "name", status: "status", source: "lead_source", leadSourceAlias: "lead_source",
  state: "state", phone: "phone", email: "email", dob: "dob", bestTime: "best_time",
  lastContacted: "last_contacted", agent: "assigned_agent", createdDate: "created_at",
  attempts: "attempt_count", lastDisposition: "last_disposition",
};
const CLIENT_COL_TO_CANONICAL: Record<string, string> = {
  name: "name", phone: "phone", email: "email", state: "state", policyType: "policy_type",
  carrier: "carrier", premium: "premium", faceAmount: "face_amount", issueDate: "issue_date",
  agent: "assigned_agent", createdDate: "created_at",
};
const RECRUIT_COL_TO_CANONICAL: Record<string, string> = {
  name: "name", phone: "phone", email: "email", state: "state", status: "status",
  agent: "assigned_agent", createdDate: "created_at",
};

function canonicalize(map: Record<string, string>, allow: readonly string[], colKey: string | null | undefined): string | null {
  if (!colKey) return null;
  const c = map[colKey];
  return c && allow.includes(c) ? c : null;
}
export const leadSortColumnToCanonical = (k: string | null | undefined) => canonicalize(LEAD_COL_TO_CANONICAL, LEAD_SORT_COLUMNS, k);
export const clientSortColumnToCanonical = (k: string | null | undefined) => canonicalize(CLIENT_COL_TO_CANONICAL, CLIENT_SORT_COLUMNS, k);
export const recruitSortColumnToCanonical = (k: string | null | undefined) => canonicalize(RECRUIT_COL_TO_CANONICAL, RECRUIT_SORT_COLUMNS, k);

export const isValidSortDirection = (d: string | null | undefined): d is SortDirection => d === "asc" || d === "desc";

/** Validate a canonical sort against an allowlist; returns null (→ default) when invalid. */
export function resolveSort(
  allow: readonly string[],
  column: string | null | undefined,
  direction: string | null | undefined,
): { column: string; direction: SortDirection } | null {
  if (!column || !allow.includes(column) || !isValidSortDirection(direction)) return null;
  return { column, direction };
}

const ALL_STATES = Object.keys(STATE_TIMEZONES);

/** All 2-letter states whose PRIMARY timezone group is in `groups`. null when no groups selected. */
export function resolveTimezoneStates(groups: string[] | undefined | null): string[] | null {
  if (!groups || groups.length === 0) return null;
  const set = new Set(groups);
  return ALL_STATES.filter((st) => set.has(PRIMARY_TIMEZONE_MAP[st]));
}

/**
 * All 2-letter states callable right now (strict TCPA, all of a state's zones).
 * Uses the canonical isCallableNow — capture the result once to "freeze" it.
 */
export function resolveCallableStates(): string[] {
  return ALL_STATES.filter((st) => isCallableNow(st));
}

const trimOrNull = (v: string | undefined | null): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Build the canonical RPC payload from UI filters.
 * For select-all, call this ONCE and reuse the returned payload for every bulk op.
 */
export function buildLeadFilterPayload(f: LeadUiFilters): LeadFilterPayload {
  const callableStates = f.callableNow
    ? f.frozenCallableStates ?? resolveCallableStates()
    : null;

  const attemptBuckets =
    f.attemptBuckets && f.attemptBuckets.length > 0 ? f.attemptBuckets : null;

  // Validate sort (TS gate); invalid/missing → omit so SQL applies the default.
  const sort = resolveSort(LEAD_SORT_COLUMNS, f.sortColumn ?? null, f.sortDirection ?? null);

  return {
    scope: f.scope,
    agent_ids: f.agentIds && f.agentIds.length > 0 ? f.agentIds : null,
    search: trimOrNull(f.search),
    status: trimOrNull(f.status),
    source: trimOrNull(f.source),
    state: trimOrNull(f.state),
    created_start: f.startDate ?? null,
    created_end: f.endDate ?? null,
    timezone_states: resolveTimezoneStates(f.timezoneGroups),
    callable_states: callableStates,
    attempt_buckets: attemptBuckets,
    last_disposition: trimOrNull(f.lastDisposition),
    sort_column: sort?.column ?? null,
    sort_direction: sort?.direction ?? null,
    page: f.page ?? 0,
    page_size: f.pageSize ?? 50,
  };
}

/**
 * Resolve a scope + optional explicit agent selection into a concrete owner-id
 * list for Clients/Recruits (which filter on assigned_agent_id). Returns
 * undefined for Agency (no owner filter — RLS scopes to org).
 *
 * - explicit agent selection wins (already scope-constrained by the UI)
 * - mine   -> [userId]
 * - team   -> teamAgentIds (self + recursive downline, from get_contact_scope_agents)
 * - agency -> undefined
 */
export function resolveOwnerAgentIds(args: {
  scope: ContactScope;
  userId: string | null | undefined;
  teamAgentIds: string[];
  explicitAgentIds?: string[];
}): string[] | undefined {
  const { scope, userId, teamAgentIds, explicitAgentIds } = args;
  if (explicitAgentIds && explicitAgentIds.length > 0) return explicitAgentIds;
  if (scope === "mine") return userId ? [userId] : [];
  if (scope === "team") return teamAgentIds.length > 0 ? teamAgentIds : userId ? [userId] : [];
  return undefined; // agency
}

// ---------------------------------------------------------------------------
// Attempt-count canonical linkage (Build 2 D2). Reference spec mirrored by the SQL
// in migration 20260619180000_fix_contacts_call_linkage_and_rpc_grants (which
// superseded the strict original). PRODUCTION FINDING: the Dialer writes a Lead's
// id in calls.contact_id but frequently leaves calls.contact_type NULL, so the
// fallback must accept contact_type = 'lead' OR NULL (still excluding explicitly
// client/recruit-typed calls). The lead_id branch is future-compatible.
// ---------------------------------------------------------------------------

export interface LeadCallRow {
  id: string;
  lead_id?: string | null;
  contact_id?: string | null;
  contact_type?: string | null;
  direction?: string | null;
  status?: string | null;
}

/**
 * A call belongs to a lead when `lead_id = leadId`, OR (lead_id is absent AND its
 * polymorphic `contact_id = leadId` AND contact_type is 'lead' or NULL). The two
 * branches are mutually exclusive (branch 2 requires lead_id absent → no double
 * count). Explicitly client/recruit-typed calls are excluded. Linkage only —
 * direction-agnostic (also used by Last Disposition).
 */
export function callBelongsToLead(call: LeadCallRow, leadId: string): boolean {
  if (call.lead_id != null) return call.lead_id === leadId;
  return call.contact_id === leadId && (call.contact_type === "lead" || call.contact_type == null);
}

/**
 * Canonical attempt count = distinct OUTBOUND dial rows linked to the lead.
 * Inbound calls are excluded; status is irrelevant (failed/busy/no-answer/completed
 * outbound all count as one attempted dial). Mirrors the SQL in migration
 * 20260617180000.
 */
export function countLeadCallAttempts(calls: LeadCallRow[], leadId: string): number {
  const ids = new Set<string>();
  for (const c of calls) {
    if (c.direction === "outbound" && callBelongsToLead(c, leadId)) ids.add(c.id);
  }
  return ids.size;
}

/** Whether an attempt count falls into ANY selected bucket (0 / 1-3 / 4+). Empty/none → no filter (true). */
export function matchesAttemptBucket(count: number, buckets: string[] | undefined): boolean {
  if (!buckets || buckets.length === 0) return true;
  return (
    (buckets.includes("0") && count === 0) ||
    (buckets.includes("1-3") && count >= 1 && count <= 3) ||
    (buckets.includes("4+") && count >= 4)
  );
}

export interface ScopeAgentOption {
  id: string;
  firstName: string;
  lastName: string;
}

/**
 * Scope-aware specific-agent options for the Filter modal:
 *   mine   -> [] (the filter is hidden; locked to the current user)
 *   team   -> self + recursive downline (from get_contact_scope_agents)
 *   agency -> ALL authorized org agents (RLS-scoped profiles; includes non-descendants;
 *             Super Admin stays home-org via profiles RLS)
 */
export function resolveAgentFilterOptions(args: {
  scope: ContactScope;
  orgAgents: ScopeAgentOption[];
  teamAgents: ScopeAgentOption[];
}): ScopeAgentOption[] {
  if (args.scope === "agency") return args.orgAgents;
  if (args.scope === "team") return args.teamAgents;
  return [];
}

/** Human label for the count line ("42 My Contacts"). */
export function scopeLabel(scope: ContactScope): string {
  switch (scope) {
    case "mine":
      return "My Contacts";
    case "team":
      return "Team Contacts";
    case "agency":
      return "Agency Contacts";
  }
}

// ---------------------------------------------------------------------------
// Kanban data contract (Contacts Build 4).
//
// The Kanban board uses a SEPARATE read path from the table so it shows FULL
// filtered per-stage counts (never the page slice), while the table keeps its
// Build 2 pagination/sort/bulk behavior untouched. Both share the SAME canonical
// filter/scope (`_contacts_filtered_*`), so columns and the table can never
// contradict. The board fetch returns exact per-status totals + a bounded
// per-column card slice.
// ---------------------------------------------------------------------------

/** One Kanban column's data: the raw row status, its FULL filtered count, and a bounded card slice. */
export interface KanbanStageData<T> {
  /** Raw `status` string from the row. `null`/unmatched → the UI's "Unmapped" column. */
  status: string | null;
  /** Exact full count for this status across the whole filtered pipeline (not page-local). */
  total: number;
  /** Bounded slice of hydrated cards (length ≤ perColumnLimit). */
  cards: T[];
}

export interface KanbanResult<T> {
  stages: KanbanStageData<T>[];
  perColumnLimit: number;
  /** Sum of all stage totals — equals the table's total_count for the same filters (status ignored). */
  grandTotal: number;
}

/**
 * Derive the Kanban lead payload from the canonical table payload: same scope +
 * every other filter, but the single-status filter is dropped (Kanban columns
 * ARE the statuses — D1) and pagination is irrelevant (full per-stage counts).
 */
export function toLeadKanbanPayload(payload: LeadFilterPayload): LeadFilterPayload {
  // Strip pagination + status; keep scope/agents/search/source/state/date/tz/callable/attempt/disposition/sort.
  const { page: _page, page_size: _pageSize, status: _status, ...rest } = payload;
  return { ...rest, status: null };
}

/** Parse the `get_contacts_*_kanban` jsonb result into typed cards via a row mapper. */
export function parseKanbanResult<T>(
  raw: unknown,
  mapRow: (row: any) => T, // eslint-disable-line @typescript-eslint/no-explicit-any
): KanbanResult<T> {
  const obj = (raw ?? {}) as {
    grand_total?: number | string;
    per_column_limit?: number | string;
    stages?: Array<{ status?: string | null; total?: number | string; cards?: any[] }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const toNum = (v: number | string | undefined | null): number => {
    if (typeof v === "number") return v;
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const stages: KanbanStageData<T>[] = (obj.stages ?? []).map((s) => ({
    status: s?.status ?? null,
    total: toNum(s?.total),
    cards: (s?.cards ?? []).map(mapRow),
  }));
  return {
    stages,
    perColumnLimit: toNum(obj.per_column_limit) || 50,
    grandTotal: toNum(obj.grand_total),
  };
}
