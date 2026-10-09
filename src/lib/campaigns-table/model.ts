import { z } from "zod";
import type { CampaignCardStats } from "@/lib/campaign-card-stats";

/**
 * Pure model for the Campaigns management table (no React, no I/O).
 *
 * Metric rules (AGENT_RULES #17, Phase 1 decision D1-B):
 *  - Total / Called / Contacted / Converted come from `get_campaign_card_stats`.
 *  - While stats load (including a placeholder map that predates a new id) the value is
 *    "loading"; a failed request with no data is "error" — never a fabricated zero.
 *  - The RPC omits other users' Personal campaigns from Admin / Super Admin callers. For a
 *    settled response that omits a visible row, Total and Called fall back to the
 *    trigger-maintained `campaigns.total_leads` / `leads_called`; Contacted and Converted are
 *    "unavailable". The unmaintained `leads_contacted` / `leads_converted` are never read.
 */

/** Explicit projection (a single literal so the generated types parse it). Never `leads_contacted` / `leads_converted`. */
export const CAMPAIGN_LIST_COLUMNS = "id, name, type, status, description, assigned_agent_ids, tags, user_id, created_by, created_at, organization_id, retry_interval_minutes, retry_interval_hours, max_attempts, calling_hours_start, calling_hours_end, ring_timeout_seconds, total_leads, leads_called";

export interface CampaignRow {
  id: string;
  name: string;
  type: string;
  status: string;
  description: string | null;
  assigned_agent_ids: unknown;
  tags: unknown;
  user_id: string | null;
  created_by: string | null;
  created_at: string | null;
  organization_id: string | null;
  retry_interval_minutes: number | null;
  retry_interval_hours: number | null;
  max_attempts: number | null;
  calling_hours_start: string | null;
  calling_hours_end: string | null;
  ring_timeout_seconds: number | null;
  total_leads: number | null;
  leads_called: number | null;
}

export type CampaignTypeKey = "personal" | "team" | "open" | "other";
export const CAMPAIGN_STATUSES = ["Draft", "Active", "Paused", "Completed", "Archived"] as const;

export function campaignTypeKey(type: string | null | undefined): CampaignTypeKey {
  const t = (type ?? "").trim().toUpperCase();
  if (t === "PERSONAL") return "personal";
  if (t === "TEAM") return "team";
  if (t === "OPEN POOL" || t === "OPEN") return "open";
  return "other";
}

/** `assigned_agent_ids` / `tags` are jsonb arrays; tolerate a JSON-encoded string. */
export function parseStringList(raw: unknown): string[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = [];
    }
  }
  return arr.filter((x) => x !== null && x !== undefined).map((x) => String(x));
}

/* ─── Metrics ─── */

export type MetricState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "unavailable" }
  | { kind: "value"; value: number };

export interface StatsView {
  /** loading = first fetch or placeholder from an earlier id set; error = failed with no data. */
  status: "loading" | "error" | "ready";
  map: Record<string, CampaignCardStats>;
}

export interface CampaignMetrics {
  total: MetricState;
  called: MetricState;
  contacted: MetricState;
  converted: MetricState;
}

const LOADING: MetricState = { kind: "loading" };
const ERROR: MetricState = { kind: "error" };
const UNAVAILABLE: MetricState = { kind: "unavailable" };

function stored(value: number | null | undefined): MetricState {
  return typeof value === "number" && Number.isFinite(value) ? { kind: "value", value } : UNAVAILABLE;
}

export function resolveCampaignMetrics(row: CampaignRow, stats: StatsView): CampaignMetrics {
  const s = stats.map[row.id];
  if (s) {
    return {
      total: { kind: "value", value: s.total },
      called: { kind: "value", value: s.called },
      contacted: { kind: "value", value: s.contacted },
      converted: { kind: "value", value: s.converted },
    };
  }
  if (stats.status === "loading") return { total: LOADING, called: LOADING, contacted: LOADING, converted: LOADING };
  if (stats.status === "error") return { total: ERROR, called: ERROR, contacted: ERROR, converted: ERROR };
  return { total: stored(row.total_leads), called: stored(row.leads_called), contacted: UNAVAILABLE, converted: UNAVAILABLE };
}

export function metricNumber(m: MetricState): number | null {
  return m.kind === "value" ? m.value : null;
}

/** Share of leads called at least once, 0–100; null when either side is unknown. */
export function progressPercent(metrics: CampaignMetrics): number | null {
  const total = metricNumber(metrics.total);
  const called = metricNumber(metrics.called);
  if (total === null || called === null) return null;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (called / total) * 100));
}

/* ─── Filters ─── */

export type TypeFilter = "all" | Exclude<CampaignTypeKey, "other">;
export type StatusFilter = "all" | (typeof CAMPAIGN_STATUSES)[number];
export interface CampaignFilters {
  search: string;
  type: TypeFilter;
  status: StatusFilter;
}
export const DEFAULT_FILTERS: CampaignFilters = { search: "", type: "all", status: "all" };

export function filterCampaigns(rows: CampaignRow[], f: CampaignFilters): CampaignRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.type !== "all" && campaignTypeKey(r.type) !== f.type) return false;
    if (f.status !== "all" && r.status !== f.status) return false;
    if (q && !(r.name ?? "").toLowerCase().includes(q)) return false;
    return true;
  });
}

/* ─── Sorting (always over the full filtered set) ─── */

export type SortKey =
  | "created" | "name" | "status" | "type" | "progress" | "total" | "converted" | "contacted" | "last_dialed";
export type SortDir = "asc" | "desc";
export interface CampaignSort {
  key: SortKey;
  dir: SortDir;
}
export const DEFAULT_SORT: CampaignSort = { key: "created", dir: "desc" };

export const SORT_LABELS: Record<SortKey, string> = {
  created: "Created", name: "Name", status: "Status", type: "Type", progress: "Lead progress",
  total: "Total leads", converted: "Converted", contacted: "Contacted", last_dialed: "Last dialed",
};

/** Text-like keys start ascending; measures and dates start descending. */
export function defaultDirFor(key: SortKey): SortDir {
  return key === "name" || key === "status" || key === "type" ? "asc" : "desc";
}

const STATUS_RANK: Record<string, number> = { Active: 0, Paused: 1, Draft: 2, Completed: 3, Archived: 4 };
const TYPE_LABEL: Record<CampaignTypeKey, string> = { open: "Open Pool", personal: "Personal", team: "Team", other: "~" };

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

export interface SortContext {
  metrics: Record<string, CampaignMetrics>;
  lastDialed: Record<string, string | null> | null;
}

function sortValue(row: CampaignRow, key: SortKey, ctx: SortContext): number | string | null {
  const m = ctx.metrics[row.id];
  switch (key) {
    case "created": return timeOf(row.created_at);
    case "name": return (row.name ?? "").toLowerCase();
    case "status": return STATUS_RANK[row.status] ?? 99;
    case "type": return TYPE_LABEL[campaignTypeKey(row.type)];
    case "progress": return m ? progressPercent(m) : null;
    case "total": return m ? metricNumber(m.total) : null;
    case "converted": return m ? metricNumber(m.converted) : null;
    case "contacted": return m ? metricNumber(m.contacted) : null;
    case "last_dialed": return ctx.lastDialed ? timeOf(ctx.lastDialed[row.id]) : null;
  }
}

function compareFallback(a: CampaignRow, b: CampaignRow): number {
  const ta = timeOf(a.created_at);
  const tb = timeOf(b.created_at);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Unknown values sort last in either direction; ties fall back to newest-first, then id. */
export function sortCampaigns(rows: CampaignRow[], sort: CampaignSort, ctx: SortContext): CampaignRow[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const keyed = rows.map((row) => ({ row, v: sortValue(row, sort.key, ctx) }));
  keyed.sort((a, b) => {
    if (a.v === null && b.v === null) return compareFallback(a.row, b.row);
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    if (a.v < b.v) return -1 * dir;
    if (a.v > b.v) return 1 * dir;
    return compareFallback(a.row, b.row);
  });
  return keyed.map((k) => k.row);
}

export function isDefaultView(filters: CampaignFilters, sort: CampaignSort): boolean {
  return filters.search.trim() === "" && filters.type === "all" && filters.status === "all"
    && sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir;
}

/* ─── Roles (presentation only; the server and RLS stay authoritative) ─── */

interface ViewerLike {
  role?: string | null;
  is_super_admin?: boolean | null;
}

/** Same leadership rule as the Dialer campaign table (legacy "Team Lead" excluded). */
export function isLeadershipViewer(p: ViewerLike | null | undefined): boolean {
  return p?.is_super_admin === true || p?.role === "Admin" || p?.role === "Team Leader" || p?.role === "Super Admin";
}

export type DuplicateEligibility = "hidden" | "allowed" | "owner_only";

/** Unchanged from the card page: role strings, with "owner" = creator or any assignee. */
export function duplicateEligibility(role: string | null | undefined, row: CampaignRow, userId: string | null | undefined): DuplicateEligibility {
  const r = role?.toLowerCase();
  if (r === "agent") return "hidden";
  const isAdmin = r === "admin";
  const isTeamLeader = r === "team leader" || r === "team_leader";
  const uid = userId ?? "";
  const isOwner = (!!userId && row.created_by === userId) || parseStringList(row.assigned_agent_ids).includes(uid);
  return isAdmin || (isTeamLeader && isOwner) ? "allowed" : "owner_only";
}

/* ─── Duplicate (configuration only — leads are never copied) ─── */

const nonBlank = z.string().refine((s) => s.trim().length > 0);

/** Validates the exact payload the card page inserted; values pass through unmodified. */
export const DuplicatePayloadSchema = z.object({
  name: nonBlank,
  type: nonBlank,
  description: z.string().nullable(),
  assigned_agent_ids: z.unknown(),
  tags: z.unknown(),
  status: z.literal("Draft"),
  total_leads: z.literal(0),
  leads_contacted: z.literal(0),
  leads_converted: z.literal(0),
  created_by: z.string().nullable(),
  organization_id: z.string().min(1),
});

export function buildDuplicatePayload(row: CampaignRow, userId: string | null | undefined, organizationId: string | null) {
  return {
    name: `${row.name} (Copy)`,
    type: row.type,
    description: row.description,
    assigned_agent_ids: row.assigned_agent_ids || [],
    tags: row.tags || [],
    status: "Draft" as const,
    total_leads: 0,
    leads_contacted: 0,
    leads_converted: 0,
    created_by: userId || null,
    organization_id: organizationId,
  };
}

/* ─── Assignees ─── */

export type AgentsModel =
  | { kind: "personal"; ids: string[] }
  | { kind: "team"; ids: string[] }
  | { kind: "open"; ids: string[] }
  | { kind: "other"; ids: string[] };

export function agentsModel(row: CampaignRow): AgentsModel {
  const kind = campaignTypeKey(row.type);
  if (kind === "personal") return { kind, ids: row.user_id ? [String(row.user_id)] : [] };
  return { kind, ids: parseStringList(row.assigned_agent_ids) };
}

/** Personal owners, Team participants and Open Pool assignees (leadership identities only). */
export function collectAssigneeIds(rows: CampaignRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) for (const id of agentsModel(r).ids) out.add(id);
  return Array.from(out).sort();
}

/** Short, stable cache-key fragment for an id set (FNV-1a over the sorted ids). */
export function idsHash(ids: string[]): string {
  const sorted = [...ids].sort();
  let h = 0x811c9dc5;
  const s = sorted.join(",");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${sorted.length}:${h.toString(16)}`;
}
