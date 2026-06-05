// =============================================================================
// Control Center → Tracker — vocab constants, labels, tones, and row types.
// Kept separate from the existing control-center constants/types so the
// feature/issue trackers are untouched. Vocab mirrors the schema migration
// (20260605120000_control_center_tracker_schema.sql) and the seed exactly.
// =============================================================================

// --- Status (systems + items) ------------------------------------------------
export const TRACKER_STATUSES = [
  "not_started",
  "in_progress",
  "needs_work",
  "broken",
  "complete",
  "deferred",
] as const;
export type TrackerStatus = (typeof TRACKER_STATUSES)[number];

export const TRACKER_STATUS_LABELS: Record<TrackerStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  needs_work: "Needs work",
  broken: "Broken",
  complete: "Complete",
  deferred: "Deferred",
};

export const TRACKER_STATUS_TONES: Record<TrackerStatus, string> = {
  not_started: "bg-slate-800 text-slate-300 ring-slate-700",
  in_progress: "bg-sky-950 text-sky-300 ring-sky-800",
  needs_work: "bg-amber-950 text-amber-300 ring-amber-800",
  broken: "bg-rose-950 text-rose-300 ring-rose-800",
  complete: "bg-emerald-950 text-emerald-300 ring-emerald-800",
  deferred: "bg-zinc-900 text-zinc-400 ring-zinc-700",
};

/** Statuses that mean a system/item needs attention on the dashboard. */
export const TRACKER_ATTENTION_STATUSES: TrackerStatus[] = [
  "needs_work",
  "broken",
  "not_started",
];

// --- Priority ----------------------------------------------------------------
export const TRACKER_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type TrackerPriority = (typeof TRACKER_PRIORITIES)[number];

export const TRACKER_PRIORITY_LABELS: Record<TrackerPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const TRACKER_PRIORITY_TONES: Record<TrackerPriority, string> = {
  critical: "bg-rose-950 text-rose-300 ring-rose-800",
  high: "bg-amber-950 text-amber-300 ring-amber-800",
  medium: "bg-slate-800 text-slate-300 ring-slate-700",
  low: "bg-zinc-900 text-zinc-400 ring-zinc-700",
};

// --- Marketable --------------------------------------------------------------
export const TRACKER_MARKETABLE_STATUSES = ["yes", "partial", "no", "unknown"] as const;
export type TrackerMarketableStatus = (typeof TRACKER_MARKETABLE_STATUSES)[number];

export const TRACKER_MARKETABLE_LABELS: Record<TrackerMarketableStatus, string> = {
  yes: "Yes",
  partial: "Partial",
  no: "No",
  unknown: "Unknown",
};

export const TRACKER_MARKETABLE_TONES: Record<TrackerMarketableStatus, string> = {
  yes: "bg-emerald-950 text-emerald-300 ring-emerald-800",
  partial: "bg-amber-950 text-amber-300 ring-amber-800",
  no: "bg-rose-950 text-rose-300 ring-rose-800",
  unknown: "bg-slate-800 text-slate-300 ring-slate-700",
};

// --- Issue severity ----------------------------------------------------------
export const TRACKER_ISSUE_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type TrackerIssueSeverity = (typeof TRACKER_ISSUE_SEVERITIES)[number];

export const TRACKER_ISSUE_SEVERITY_LABELS: Record<TrackerIssueSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export const TRACKER_ISSUE_SEVERITY_TONES: Record<TrackerIssueSeverity, string> = {
  critical: "bg-rose-950 text-rose-300 ring-rose-800",
  high: "bg-amber-950 text-amber-300 ring-amber-800",
  medium: "bg-sky-950 text-sky-300 ring-sky-800",
  low: "bg-slate-800 text-slate-300 ring-slate-700",
  info: "bg-zinc-900 text-zinc-400 ring-zinc-700",
};

// --- Issue status ------------------------------------------------------------
export const TRACKER_ISSUE_STATUSES = [
  "open",
  "investigating",
  "fix_in_progress",
  "resolved",
  "ignored",
] as const;
export type TrackerIssueStatus = (typeof TRACKER_ISSUE_STATUSES)[number];

export const TRACKER_ISSUE_STATUS_LABELS: Record<TrackerIssueStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  fix_in_progress: "Fix in progress",
  resolved: "Resolved",
  ignored: "Ignored",
};

export const TRACKER_ISSUE_STATUS_TONES: Record<TrackerIssueStatus, string> = {
  open: "bg-sky-950 text-sky-300 ring-sky-800",
  investigating: "bg-indigo-950 text-indigo-300 ring-indigo-800",
  fix_in_progress: "bg-violet-950 text-violet-300 ring-violet-800",
  resolved: "bg-emerald-950 text-emerald-300 ring-emerald-800",
  ignored: "bg-zinc-900 text-zinc-400 ring-zinc-700",
};

/** Issue statuses that count as "open" (a live launch concern). */
export const TRACKER_ISSUE_OPEN_STATUSES: TrackerIssueStatus[] = [
  "open",
  "investigating",
  "fix_in_progress",
];

/** Issue statuses that render visually quieter. */
export const TRACKER_ISSUE_QUIET_STATUSES: TrackerIssueStatus[] = ["resolved", "ignored"];

// --- Marketing reality status ------------------------------------------------
export const TRACKER_REALITY_STATUSES = [
  "accurate",
  "partial",
  "inaccurate",
  "not_marketed",
] as const;
export type TrackerRealityStatus = (typeof TRACKER_REALITY_STATUSES)[number];

export const TRACKER_REALITY_STATUS_LABELS: Record<TrackerRealityStatus, string> = {
  accurate: "Accurate",
  partial: "Partial",
  inaccurate: "Inaccurate",
  not_marketed: "Not marketed",
};

export const TRACKER_REALITY_STATUS_TONES: Record<TrackerRealityStatus, string> = {
  accurate: "bg-emerald-950 text-emerald-300 ring-emerald-800",
  partial: "bg-amber-950 text-amber-300 ring-amber-800",
  inaccurate: "bg-rose-950 text-rose-300 ring-rose-800",
  not_marketed: "bg-slate-800 text-slate-300 ring-slate-700",
};

// --- Marketing action needed -------------------------------------------------
export const TRACKER_ACTIONS_NEEDED = [
  "keep",
  "update_copy",
  "remove_claim",
  "build_feature",
  "hide_until_ready",
  "defer",
] as const;
export type TrackerActionNeeded = (typeof TRACKER_ACTIONS_NEEDED)[number];

export const TRACKER_ACTION_NEEDED_LABELS: Record<TrackerActionNeeded, string> = {
  keep: "Keep",
  update_copy: "Update copy",
  remove_claim: "Remove claim",
  build_feature: "Build feature",
  hide_until_ready: "Hide until ready",
  defer: "Defer",
};

// --- Reference kind ----------------------------------------------------------
export const TRACKER_REFERENCE_KINDS = [
  "doc",
  "migration",
  "file",
  "rpc",
  "edge_function",
  "deploy",
  "url",
] as const;
export type TrackerReferenceKind = (typeof TRACKER_REFERENCE_KINDS)[number];

export const TRACKER_REFERENCE_KIND_LABELS: Record<TrackerReferenceKind, string> = {
  doc: "Doc",
  migration: "Migration",
  file: "File",
  rpc: "RPC",
  edge_function: "Edge function",
  deploy: "Deploy",
  url: "URL",
};

// =============================================================================
// Row shapes (hand-typed; absent from generated supabase/types.ts for now).
// =============================================================================

export interface TrackerSystem {
  id: string;
  organization_id: string | null;
  system_key: string;
  name: string;
  category: string;
  plain_english_summary: string | null;
  status: TrackerStatus;
  priority: TrackerPriority;
  marketable_status: TrackerMarketableStatus;
  owner: string | null;
  sort_order: number;
  last_reviewed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackerItem {
  id: string;
  organization_id: string | null;
  system_id: string;
  item_key: string;
  title: string;
  description: string | null;
  status: TrackerStatus;
  priority: TrackerPriority;
  marketable_status: TrackerMarketableStatus;
  production_critical: boolean;
  mobile_visible: boolean;
  source_of_truth: string | null;
  next_action: string | null;
  notes: string | null;
  sort_order: number;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackerIssue {
  id: string;
  organization_id: string | null;
  system_id: string | null;
  item_id: string | null;
  issue_key: string;
  title: string;
  description: string | null;
  severity: TrackerIssueSeverity;
  status: TrackerIssueStatus;
  owner: string | null;
  next_action: string | null;
  discovered_at: string;
  resolved_at: string | null;
  last_reviewed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackerMarketingClaim {
  id: string;
  organization_id: string | null;
  system_id: string | null;
  claim_key: string;
  feature_claim: string;
  marketed_location: string | null;
  reality_status: TrackerRealityStatus;
  actual_status: string | null;
  action_needed: TrackerActionNeeded;
  priority: TrackerPriority;
  notes: string | null;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackerReference {
  id: string;
  system_id: string | null;
  item_id: string | null;
  ref_key: string;
  kind: TrackerReferenceKind;
  label: string;
  url_or_path: string | null;
  notes: string | null;
  created_at: string;
}

// =============================================================================
// Derived helpers (completion is NEVER stored — always derived from items).
// =============================================================================

/** round(100 * complete / total); 0 when there are no items. */
export function deriveCompletionPercent(items: Pick<TrackerItem, "status">[]): number {
  if (items.length === 0) return 0;
  const complete = items.filter((i) => i.status === "complete").length;
  return Math.round((100 * complete) / items.length);
}

export function isWithinLastDays(iso: string | null, days: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= days * 24 * 60 * 60 * 1000;
}
