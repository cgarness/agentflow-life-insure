import { supabase } from "@/integrations/supabase/client";
import type { AssigneeProfile, AssigneeProfileMap } from "@/components/dialer/campaignSelectionModel";
import { CAMPAIGN_LIST_COLUMNS, type CampaignRow } from "./model";

/**
 * Reads behind the Campaigns table. Every read is organization-scoped in the query itself
 * (RLS stays the authority), accepts an AbortSignal, and pages instead of relying on the
 * PostgREST row cap — a list is either complete or a visible error, never silently short.
 */

export const CAMPAIGN_LIST_PAGE_SIZE = 500;
export const CAMPAIGN_LIST_MAX_ROWS = 10_000;
export const ASSIGNEE_ID_CHUNK = 100;

export class CampaignsQueryError extends Error {
  readonly kind: "failed" | "too_large";
  /** The raw provider error, for console diagnostics only — never rendered. */
  readonly cause: unknown;
  constructor(kind: "failed" | "too_large", cause?: unknown) {
    super(kind === "too_large" ? "There are too many campaigns to display." : "Campaigns could not be loaded.");
    this.name = "CampaignsQueryError";
    this.kind = kind;
    this.cause = cause;
  }
}

/**
 * Shared TanStack options: refetch whenever the page mounts (cached rows stay on screen, so a
 * return from the detail page shows its edits/deletes without a skeleton), no focus refetch
 * storms, one retry, never retry a hard cap.
 */
export const CAMPAIGNS_TABLE_QUERY_OPTIONS = {
  staleTime: 30_000,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: false,
  retry: (failureCount: number, error: unknown) =>
    !(error instanceof CampaignsQueryError && error.kind === "too_large") && failureCount < 1,
} as const;

interface PageResult<T> {
  data: T[] | null;
  error: unknown;
  count?: number | null;
}

/**
 * Pages by the RAW rows received (not by the requested page size), so a server row cap below
 * the page size cannot end the sweep early. Stops at the exact count, or on an empty page when
 * no count is available. Rows are de-duplicated by id across pages.
 */
async function fetchAllPages<T extends { id: string }>(
  page: (from: number, to: number, withCount: boolean) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const byId = new Map<string, T>();
  let received = 0;
  let total: number | null = null;
  for (;;) {
    const { data, error, count } = await page(received, received + CAMPAIGN_LIST_PAGE_SIZE - 1, received === 0);
    if (error) throw new CampaignsQueryError("failed", error);
    if (received === 0) {
      total = typeof count === "number" ? count : null;
      if (total !== null && total > CAMPAIGN_LIST_MAX_ROWS) throw new CampaignsQueryError("too_large");
    }
    const batch = data ?? [];
    if (batch.length === 0) break;
    for (const row of batch) if (!byId.has(row.id)) byId.set(row.id, row);
    received += batch.length;
    if (received > CAMPAIGN_LIST_MAX_ROWS) throw new CampaignsQueryError("too_large");
    if (total !== null && received >= total) break;
  }
  return Array.from(byId.values());
}

/** Raw organization rows; the management filter is applied at render with current roles. */
export function fetchCampaignRows(orgId: string, signal?: AbortSignal): Promise<CampaignRow[]> {
  return fetchAllPages<CampaignRow>((from, to, withCount) => {
    let q = supabase
      .from("campaigns")
      .select(CAMPAIGN_LIST_COLUMNS, withCount ? { count: "exact" } : undefined)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, to);
    if (signal) q = q.abortSignal(signal);
    return q;
  });
}

/** Organization-wide MAX(calls.created_at) per campaign; a missing id means never dialed. */
export async function fetchCampaignLastDialed(signal?: AbortSignal): Promise<Record<string, string | null>> {
  const rows = await fetchAllPages<{ id: string; last: string | null }>(async (from, to, withCount) => {
    let q = supabase
      // No-argument RPC: its generated Args type is `never`, so the empty args slot is typed as such.
      .rpc("get_campaign_last_dialed", undefined as never, withCount ? { count: "exact" } : undefined)
      .order("campaign_id", { ascending: true })
      .range(from, to);
    if (signal) q = q.abortSignal(signal);
    const { data, error, count } = await q;
    return {
      data: (data ?? []).map((r) => ({ id: r.campaign_id, last: r.last_dialed_at ?? null })),
      error,
      count,
    };
  });
  const map: Record<string, string | null> = {};
  for (const r of rows) map[r.id] = r.last;
  return map;
}

/** Leadership-only identities for assigned agents, chunked so the GET URL stays bounded. */
export async function fetchAssigneeProfiles(
  orgId: string,
  ids: string[],
  signal?: AbortSignal,
): Promise<AssigneeProfileMap> {
  const map: AssigneeProfileMap = {};
  for (let i = 0; i < ids.length; i += ASSIGNEE_ID_CHUNK) {
    let q = supabase
      .from("profiles")
      .select("id, first_name, last_name, avatar_url")
      .eq("organization_id", orgId)
      .in("id", ids.slice(i, i + ASSIGNEE_ID_CHUNK));
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) throw new CampaignsQueryError("failed", error);
    for (const row of data ?? []) {
      const displayName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || null;
      const profile: AssigneeProfile = {
        id: row.id,
        displayName,
        avatarUrl: row.avatar_url?.trim() ? row.avatar_url : null,
      };
      map[row.id] = profile;
    }
  }
  return map;
}

export interface CreateModalAgent {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
}

/** The unchanged Create modal's picker list (Active same-org profiles, as before). */
export function fetchCreateModalAgents(orgId: string, signal?: AbortSignal): Promise<CreateModalAgent[]> {
  return fetchAllPages<CreateModalAgent>((from, to, withCount) => {
    let q = supabase
      .from("profiles")
      .select("id, first_name, last_name, email, role", withCount ? { count: "exact" } : undefined)
      .eq("organization_id", orgId)
      .eq("status", "Active")
      .order("id", { ascending: true })
      .range(from, to);
    if (signal) q = q.abortSignal(signal);
    return q;
  });
}

/**
 * Agency status ("active" | "suspended" | "archived" by CHECK). Same semantics as the previous
 * page: a missing row or a failed read resolves "active" (fail-open); any other stored value locks.
 */
export async function fetchOrgStatus(orgId: string, signal?: AbortSignal): Promise<string> {
  let q = supabase.from("organizations").select("status").eq("id", orgId);
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q.maybeSingle();
  if (error) {
    if (signal?.aborted) throw error;
    return "active";
  }
  return data?.status || "active";
}
