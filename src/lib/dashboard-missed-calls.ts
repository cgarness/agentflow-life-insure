/**
 * dashboard-missed-calls — the ONE missed-call contract for the Dashboard (Polish V2 plan §3.6).
 *
 * Consumed by the Missed Calls widget (preview + exact total) and its detail view (pages + Cleared),
 * which may differ only in page size. Before this module the two read different columns and only
 * the widget could resolve a contact to call back.
 *
 * Rows: the viewer's organization's inbound calls with `is_missed` (monotonic, D13) from the last
 * 24 hours, newest first. "My missed calls" keeps the routing scope (`buildMyMissedCallsOrFilter`),
 * never `agent_id` alone. The organization filter is explicit: `calls` also has an Agency Group
 * peer-read policy, so RLS alone would let a Team list include another agency's missed calls.
 *
 * Clearances (when on) are excluded INSIDE the paging math: the read is fetched `K` rows deeper,
 * where `K` bounds how many rows a clearance can hide, then cleared rows are dropped and the page
 * is sliced. Totals subtract only clearances that still match a row under the same filters.
 *
 * Read-only. The call, voicemail, recording and notification are never written here.
 */
import { supabase } from "@/integrations/supabase/client";
import { buildMyMissedCallsOrFilter } from "@/lib/missedCallScope";
import { describeInboundCallOutcome, type InboundCallOutcome } from "@/lib/inbound-call-labels";
import { DashboardQueryError } from "@/lib/dashboard-contact-identity";
import type { QuickCallContactType } from "@/lib/quick-call";
import { assertPageActive } from "@/lib/pageActivity";
import { linkedAbort, settleAll } from "@/lib/requestLifetime";
import {
  type AttentionClearance,
  AttentionExclusions,
  chunk,
  compareInstants,
  MATCH_CHUNK_SIZE,
} from "@/lib/dashboard-attention";
import type { MissedCallRouting } from "@/lib/dashboard-people";

/** The detail view lists the last 24 hours; the widget previews the newest of them. */
export const MISSED_CALL_WINDOW_MS = 24 * 60 * 60 * 1000;

export const MISSED_CALL_COLUMNS =
  "id, contact_id, contact_name, contact_phone, created_at, disposition_name, direction, is_missed, missed_reason, " +
  "outcome, agent_id, answered_by_agent_id, voicemail_id, missed_for_agent_id, missed_recipient_ids, routed_agent_ids";

export interface MissedCallScope {
  userId: string;
  organizationId: string | null;
  /** Own missed calls only (routing scope); the list rule in `dashboard-scope`. */
  isFiltered: boolean;
  /** Window start (ISO), computed once per load and shared by every read of it. */
  since: string;
  exclusions?: AttentionExclusions;
  signal?: AbortSignal;
}

export interface MissedCallItem extends MissedCallRouting {
  /** Source-qualified render key (`missed_call:<calls.id>`). */
  key: string;
  /** `calls.id` — the clearance identity; NEVER a contact identity. */
  id: string;
  contactId: string | null;
  contactName: string;
  /** `calls.created_at` exactly as the server returned it (the clearance occurrence). */
  createdAt: string;
  phone: string;
  /** Real contact kind, resolved from the contact tables — never assumed. */
  contactType: QuickCallContactType | null;
  outcome: InboundCallOutcome;
  voicemailId: string | null;
  /** Set on rows of the Cleared view. */
  clearance: AttentionClearance | null;
}

export function missedCallsSince(now: Date = new Date()): string {
  return new Date(now.getTime() - MISSED_CALL_WINDOW_MS).toISOString();
}

/**
 * The shared filter chain (rows, counts and match reads all use it), or `null` when the viewer
 * id cannot be scoped — the caller then returns nothing, never the unscoped organization.
 */
function applyMissedFilters(query: any, scope: MissedCallScope, organizationId: string) {
  let q = query
    .eq("organization_id", organizationId)
    .eq("direction", "inbound")
    .eq("is_missed", true)
    .gte("created_at", scope.since);
  if (scope.isFiltered) {
    // D13 (§3.2): a missed row has no answering agent, so `agent_id = me` never matched. Scope
    // by the intended recipient / durable snapshot / legacy routed wave instead (UUID-validated).
    const or = buildMyMissedCallsOrFilter(scope.userId);
    if (!or) return null;
    q = q.or(or);
  }
  return q;
}

function requireOrganization(scope: MissedCallScope): string {
  // Fail closed: without the viewer's organization there is no tenant to read.
  if (!scope.organizationId) throw new DashboardQueryError("missed-calls-organization", new Error("No organization"));
  return scope.organizationId;
}

/**
 * Resolve contact kind and a dialable phone for linked rows (moved verbatim from the widget).
 * `calls.contact_type` is NULL on most real rows (AGENT_RULES §5), so it cannot be trusted.
 */
async function resolveMissedCallContacts(rows: any[], signal?: AbortSignal) {
  const contactIds = rows.map((c) => c.contact_id).filter(Boolean) as string[];
  const contactMap: Record<string, { phone: string; type: QuickCallContactType }> = {};
  if (contactIds.length === 0) return contactMap;
  // A follow-on read: a tab hidden or offline since the calls read sends nothing more; the section
  // loads again once the tab is visible and online.
  assertPageActive();
  const cancel = linkedAbort(signal);
  try {
    const [leads, clients] = await settleAll(
      [
        supabase.from("leads").select("id, phone").in("id", contactIds).abortSignal(cancel.signal),
        supabase.from("clients").select("id, phone").in("id", contactIds).abortSignal(cancel.signal),
      ] as const,
      cancel.abort,
    );
    // A failed lookup is a failure, never "no linked contact record" (AGENT_RULES #22).
    if (leads.error || clients.error) throw leads.error ?? clients.error;
    for (const lead of leads.data ?? []) contactMap[lead.id] = { phone: lead.phone ?? "", type: "lead" };
    for (const client of clients.data ?? []) contactMap[client.id] = { phone: client.phone ?? "", type: "client" };
    return contactMap;
  } finally {
    cancel.dispose();
  }
}

function toItem(c: any, contactMap: Record<string, { phone: string; type: QuickCallContactType }>, clearance: AttentionClearance | null): MissedCallItem {
  const resolved = c.contact_id ? contactMap[c.contact_id] : undefined;
  return {
    key: `missed_call:${c.id}`,
    id: c.id,
    contactId: c.contact_id ?? null,
    contactName: c.contact_name || "Unknown",
    createdAt: c.created_at || "",
    // Fall back to the number the call itself recorded when the contact row is gone — the missed
    // call is still actionable.
    phone: resolved?.phone || c.contact_phone || "",
    contactType: resolved?.type ?? null,
    outcome: describeInboundCallOutcome(c),
    voicemailId: c.voicemail_id ?? null,
    missed_for_agent_id: c.missed_for_agent_id ?? null,
    missed_recipient_ids: c.missed_recipient_ids ?? [],
    routed_agent_ids: c.routed_agent_ids ?? null,
    answered_by_agent_id: c.answered_by_agent_id ?? null,
    clearance,
  };
}

/** One page of ACTIVE (not cleared) missed calls, newest first; throws on any failed read. */
export async function fetchMissedCallPage(scope: MissedCallScope & { pageSize: number; offset?: number }): Promise<MissedCallItem[]> {
  const organizationId = requireOrganization(scope);
  const exclusions = scope.exclusions ?? AttentionExclusions.empty();
  const offset = scope.offset ?? 0;
  // Each clearance can hide at most one row, so `K` extra rows always cover the active page.
  const depth = offset + scope.pageSize + exclusions.count("missed_call");
  const q = applyMissedFilters(supabase.from("calls").select(MISSED_CALL_COLUMNS), scope, organizationId);
  if (!q) return [];
  let ordered = q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(depth);
  if (scope.signal) ordered = ordered.abortSignal(scope.signal);
  const { data, error } = await ordered;
  if (error) throw error;
  const active = (data ?? []).filter((c: any) => !exclusions.match("missed_call", c.id, c.created_at ?? ""));
  const page = active.slice(offset, offset + scope.pageSize);
  // An empty result clears the list (a refresh must not leave calls that are gone).
  if (page.length === 0) return [];
  const contacts = await resolveMissedCallContacts(page, scope.signal);
  return page.map((c: any) => toItem(c, contacts, null));
}

/** The cleared ids that still hide a row under the SAME filters (rows or ids only). */
async function matchedClearedRows(scope: MissedCallScope, organizationId: string, columns: string) {
  const exclusions = scope.exclusions ?? AttentionExclusions.empty();
  const ids = exclusions.sourceIds("missed_call");
  if (ids.length === 0) return [];
  const cancel = linkedAbort(scope.signal);
  try {
    const batches = await settleAll(
      chunk(ids, MATCH_CHUNK_SIZE).map((batch) => {
        const q = applyMissedFilters(supabase.from("calls").select(columns), scope, organizationId);
        if (!q) return Promise.resolve([] as any[]);
        return q.in("id", batch).abortSignal(cancel.signal).then((res: any) => {
          if (res.error) throw res.error;
          return (res.data ?? []) as any[];
        });
      }),
      cancel.abort,
    );
    return batches
      .flat()
      .map((row) => ({ row, clearance: exclusions.match("missed_call", row.id, row.created_at ?? "") }))
      .filter((m): m is { row: any; clearance: AttentionClearance } => m.clearance !== null);
  } finally {
    cancel.dispose();
  }
}

/** Exact counts: `active` excludes cleared rows; `cleared` is how many rows a clearance hides. */
export async function fetchMissedCallCounts(scope: MissedCallScope): Promise<{ active: number; cleared: number }> {
  const organizationId = requireOrganization(scope);
  const q = applyMissedFilters(supabase.from("calls").select("id", { count: "exact", head: true }), scope, organizationId);
  if (!q) return { active: 0, cleared: 0 };
  const cancel = linkedAbort(scope.signal);
  try {
    const [count, matched] = await settleAll(
      [
        q.abortSignal(cancel.signal).then((res: any) => {
          if (res.error) throw res.error;
          return typeof res.count === "number" ? res.count : 0;
        }),
        matchedClearedRows({ ...scope, signal: cancel.signal }, organizationId, "id, created_at"),
      ] as const,
      cancel.abort,
    );
    return { active: Math.max(0, count - matched.length), cleared: matched.length };
  } finally {
    cancel.dispose();
  }
}

/** Every currently cleared missed call in the window (the Cleared view), newest first. */
export async function fetchClearedMissedCalls(scope: MissedCallScope): Promise<MissedCallItem[]> {
  const organizationId = requireOrganization(scope);
  const matched = await matchedClearedRows(scope, organizationId, MISSED_CALL_COLUMNS);
  if (matched.length === 0) return [];
  // Newest first, then id descending — the same order as the active list.
  matched.sort((a, b) => compareInstants(b.row.created_at ?? "", a.row.created_at ?? "") || (a.row.id < b.row.id ? 1 : -1));
  const contacts = await resolveMissedCallContacts(matched.map((m) => m.row), scope.signal);
  return matched.map((m) => toItem(m.row, contacts, m.clearance));
}
