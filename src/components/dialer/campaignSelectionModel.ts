import type { CampaignPresenceMap } from "@/lib/supabase-dialer-presence";

/**
 * Pure helpers behind the campaign-selection table (no React, no I/O).
 * Display rules pinned by campaignSelectionModel.test.ts / campaignSelectionTable.test.tsx:
 *  - presence: authoritative zero and "unavailable" are DIFFERENT states — an error or a
 *    missing row must render "—", never a fabricated zero (ruling D5);
 *  - "Never" only when get_campaign_last_dialed returned no entry (or null) for the campaign;
 *  - campaign ordering stays oldest-first by created_at (existing behavior).
 */

export type CampaignRecord = any;

export interface CampaignStateCount {
  state: string;
  count: number;
}

export interface AssigneeProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export type AssigneeProfileMap = Record<string, AssigneeProfile>;

/* ─── Campaign type ─── */

function normalizedType(type: string | null | undefined): string {
  return (type ?? "").trim().toUpperCase();
}

export function campaignTypeLabel(type: string | null | undefined): string {
  const t = normalizedType(type);
  if (t === "PERSONAL") return "Personal";
  if (t === "TEAM") return "Team";
  if (t === "OPEN POOL" || t === "OPEN") return "Open Pool";
  return (type ?? "").trim();
}

/** Existing card color mapping, preserved (TEAM blue / PERSONAL purple / pool emerald). */
export function campaignTypeBadgeClass(type: string | null | undefined): string {
  const t = normalizedType(type);
  if (t === "TEAM") return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  if (t === "PERSONAL") return "bg-purple-500/10 text-purple-400 border-purple-500/20";
  if (t.includes("POOL") || t === "OPEN") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  return "bg-muted text-muted-foreground border-border";
}

/* ─── Ordering + contacts (existing semantics, moved from the card component) ─── */

export function sortCampaignsOldestFirst<T extends { created_at?: string | null }>(items: T[]): T[] {
  return items.slice().sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  });
}

export function totalContacts(states: CampaignStateCount[] | undefined): number {
  return (states ?? []).reduce((sum, s) => sum + s.count, 0);
}

/* ─── Last dialed ─── */

export function formatCampaignDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "Never" only when the RPC map has no entry (or a null one) for this campaign. */
export function resolveLastDialedIso(
  campaignId: string,
  lastDialed: Record<string, string | null>,
): string | null {
  if (!(campaignId in lastDialed)) return null;
  return lastDialed[campaignId] ?? null;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isLocalYesterday(d: Date, now: Date): boolean {
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return sameLocalDay(d, y);
}

/** Readable relative copy; recency wins over the calendar for sub-hour ages. */
export function formatLastDialedRelative(
  iso: string | null | undefined,
  nowMs: number,
): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  const diff = nowMs - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  const now = new Date(nowMs);
  if (sameLocalDay(d, now)) return `${Math.floor(diff / 3_600_000)} hr ago`;
  if (isLocalYesterday(d, now)) return "Yesterday";
  return formatCampaignDate(iso);
}

export function formatExactTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/* ─── Presence display states (ruling D5) ─── */

export type PresenceCellState =
  | { kind: "unavailable" }
  | { kind: "zero" }
  | { kind: "active"; count: number };

export function presenceCellState(
  presence: CampaignPresenceMap | undefined,
  campaignId: string,
): PresenceCellState {
  const entry = presence?.[campaignId];
  if (!entry) return { kind: "unavailable" };
  if (entry.activeAgentCount > 0) return { kind: "active", count: entry.activeAgentCount };
  return { kind: "zero" };
}

/**
 * Header total across the currently VISIBLE campaigns, derived from the same response.
 * Summing per-campaign distinct counts cannot double-count an agent: dialer_sessions has a
 * UNIQUE (organization_id, agent_id) WHERE status='active' index, so an agent holds at most
 * one active session and contributes to at most one campaign.
 */
export function headerPresence(
  presence: CampaignPresenceMap | undefined,
  visibleCampaignIds: string[],
): PresenceCellState {
  if (!presence) return { kind: "unavailable" };
  let total = 0;
  for (const id of visibleCampaignIds) total += presence[id]?.activeAgentCount ?? 0;
  return total > 0 ? { kind: "active", count: total } : { kind: "zero" };
}

/* ─── Assigned cell (leadership only) ─── */

export type AssignedCellModel =
  | { kind: "open" }
  | { kind: "personal"; owner: AssigneeProfile | undefined }
  | { kind: "team"; people: AssigneeProfile[] }
  | { kind: "unknown" };

function parseAssignedIds(raw: unknown): string[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      if (Array.isArray(p)) arr = p;
    } catch {
      arr = [];
    }
  }
  return arr.map((x) => String(x));
}

function profileOrPlaceholder(id: string, profiles: AssigneeProfileMap | undefined): AssigneeProfile {
  return profiles?.[id] ?? { id, displayName: null, avatarUrl: null };
}

export function assignedCellModel(
  campaign: CampaignRecord,
  profiles: AssigneeProfileMap | undefined,
): AssignedCellModel {
  const t = normalizedType(campaign?.type);
  if (t === "OPEN POOL" || t === "OPEN") return { kind: "open" };
  if (t === "PERSONAL") {
    const ownerId = campaign?.user_id != null ? String(campaign.user_id) : null;
    return { kind: "personal", owner: ownerId ? profileOrPlaceholder(ownerId, profiles) : undefined };
  }
  if (t === "TEAM") {
    const ids = parseAssignedIds(campaign?.assigned_agent_ids);
    return { kind: "team", people: ids.map((id) => profileOrPlaceholder(id, profiles)) };
  }
  return { kind: "unknown" };
}

/** Personal owners + Team participants across the visible campaigns (unique, sorted). */
export function collectAssigneeIds(campaigns: CampaignRecord[]): string[] {
  const out = new Set<string>();
  for (const c of campaigns ?? []) {
    const t = normalizedType(c?.type);
    if (t === "PERSONAL" && c?.user_id != null) out.add(String(c.user_id));
    if (t === "TEAM") for (const id of parseAssignedIds(c?.assigned_agent_ids)) out.add(id);
  }
  return Array.from(out).sort();
}

export function initialsFor(displayName: string | null): string {
  const name = (displayName ?? "").trim();
  if (!name) return "?";
  const parts = name.split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/* ─── Expanded-row settings labels (existing authoritative fields only) ─── */

export function maxAttemptsLabel(v: number | null | undefined): string {
  return v == null ? "Unlimited" : String(v);
}

export function ringTimeoutLabel(v: number | null | undefined): string {
  return v == null ? "Org default" : `${v}s`;
}

/** Canonical minutes field with the house fallback chain (minutes → hours*60 → 1440). */
export function retryIntervalLabel(campaign: {
  retry_interval_minutes?: number | null;
  retry_interval_hours?: number | null;
}): string {
  const minutes =
    campaign.retry_interval_minutes ??
    (campaign.retry_interval_hours != null ? campaign.retry_interval_hours * 60 : 1440);
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) return `${minutes / 60} hr`;
  return `${minutes} min`;
}

function formatTimeOfDay(hms: string): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hms);
  if (!m) return null;
  const hour = Number(m[1]);
  if (hour < 0 || hour > 23) return null;
  const suffix = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

export function formatCallingWindow(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const s = start ? formatTimeOfDay(start) : null;
  const e = end ? formatTimeOfDay(end) : null;
  if (!s || !e) return "—";
  return `${s} – ${e}`;
}
