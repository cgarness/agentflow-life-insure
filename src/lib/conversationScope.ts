/**
 * conversationScope — the pure half of Conversations sidebar scoping and ranking.
 *
 * Three rules this module encodes, all of them requirements rather than preferences:
 *
 * 1. **Sidebar conversations come from SMS and email ONLY.** A call must never create a sidebar
 *    row, set its preview, move a contact upward, or trigger a refresh. Calls remain visible
 *    inside the opened contact's thread (`getConversationThread`), which is untouched.
 *
 * 2. **Recency uses the real event timestamp**, not the row's insert time:
 *      - SMS            → `sent_at`, with `created_at` only as a legacy fallback
 *      - inbound email  → `received_at`, then `created_at`
 *      - outbound email → `sent_at`, then `created_at`
 *    Ranking by `created_at` puts a backfilled email at the top of the sidebar while the thread
 *    shows it in its correct historical position.
 *
 * 3. **A row whose timestamp cannot be parsed is dropped, never ranked.** `new Date(undefined)`
 *    yields `NaN`, which makes a comparator non-transitive (arbitrary sort order) and throws
 *    `RangeError: Invalid time value` inside `formatDistanceToNow`, taking down the whole list
 *    render rather than one row.
 *
 * This module is deliberately free of React and Supabase imports so it can be unit-tested directly.
 */

import type { EffectiveViewer } from "@/lib/effectiveViewer";
import { isOrganizationWideViewer } from "@/lib/effectiveViewer";

/**
 * How the sidebar is allowed to resolve contacts for this viewer.
 *
 * `org`    — Admin / non-impersonating Super Admin: every contact in the effective organization.
 * `agents` — everyone else: only contacts owned by an explicit, already-resolved id set.
 *
 * There is no third "unscoped" variant, by design. `null` (see `resolveConversationScope`) means
 * unresolved and MUST be treated as loading, never as a licence to query without a filter.
 */
export type ConversationScope =
  | { kind: "org"; organizationId: string }
  | { kind: "agents"; organizationId: string; agentIds: string[] };

/** Channels that may appear in the sidebar. `call` is intentionally absent — see rule 1. */
export type ConversationChannel = "sms" | "email";

export interface SmsTimestampFields {
  sent_at?: string | null;
  created_at?: string | null;
}

export interface EmailTimestampFields {
  direction?: string | null;
  received_at?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
}

function firstUsableTimestamp(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (Number.isNaN(Date.parse(trimmed))) continue;
    return trimmed;
  }
  return null;
}

/**
 * SMS recency: `sent_at`, falling back to `created_at` for legacy rows.
 *
 * `messages.sent_at` carries `DEFAULT now()` in production, so the fallback is rarely exercised —
 * but it must exist and BOTH columns must be selected, because the previous implementation read
 * `created_at` without selecting it and the fallback silently evaluated to `undefined`.
 */
export function smsEventAt(row: SmsTimestampFields | null | undefined): string | null {
  if (!row) return null;
  return firstUsableTimestamp(row.sent_at, row.created_at);
}

/**
 * Email recency: the real event time for the row's direction.
 *
 * `contact_emails_direction_check` constrains `direction` to exactly `inbound | outbound`, so this
 * split is total. An unrecognized direction still resolves (received → sent → created) rather than
 * dropping the row.
 */
export function emailEventAt(row: EmailTimestampFields | null | undefined): string | null {
  if (!row) return null;
  if (row.direction === "inbound") return firstUsableTimestamp(row.received_at, row.created_at);
  if (row.direction === "outbound") return firstUsableTimestamp(row.sent_at, row.created_at);
  return firstUsableTimestamp(row.received_at, row.sent_at, row.created_at);
}

export interface RankableEvent {
  contact_id: string;
  event_at: string | null;
}

/**
 * One row per contact — the newest qualifying SMS/email — ordered newest first.
 *
 * Rows with an unusable timestamp are dropped BEFORE sorting, so no `NaN` ever reaches the
 * comparator or the renderer. Ties break on `contact_id` so the order is deterministic.
 */
export function pickNewestPerContact<T extends RankableEvent>(events: readonly T[]): T[] {
  const usable: { event: T; ts: number }[] = [];
  for (const event of events ?? []) {
    if (!event || typeof event.contact_id !== "string" || event.contact_id.length === 0) continue;
    if (typeof event.event_at !== "string") continue;
    const ts = Date.parse(event.event_at);
    if (Number.isNaN(ts)) continue;
    usable.push({ event, ts });
  }

  usable.sort((a, b) => (b.ts - a.ts) || a.event.contact_id.localeCompare(b.event.contact_id));

  const newestPerContact = new Map<string, T>();
  for (const { event } of usable) {
    if (!newestPerContact.has(event.contact_id)) newestPerContact.set(event.contact_id, event);
  }
  return Array.from(newestPerContact.values());
}

/**
 * Turn an effective viewer plus an already-resolved agent id set into a scope.
 *
 * Returns `null` — meaning "cannot scope, show nothing and surface loading/failure" — when the
 * viewer is unresolved, or when a non-organization-wide viewer has an empty id set. That empty-set
 * case is the FAIL-CLOSED path: a failed downline traversal must yield zero rows, never an
 * organization-wide query.
 */
export function resolveConversationScope(
  viewer: EffectiveViewer | null | undefined,
  agentIds: string[] | null | undefined,
): ConversationScope | null {
  if (!viewer || !viewer.organizationId) return null;
  if (isOrganizationWideViewer(viewer)) {
    return { kind: "org", organizationId: viewer.organizationId };
  }
  if (!Array.isArray(agentIds)) return null;
  const ids = Array.from(new Set(agentIds.filter((id) => typeof id === "string" && id.trim().length > 0)));
  if (ids.length === 0) return null;
  return { kind: "agents", organizationId: viewer.organizationId, agentIds: ids };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guard for a `?contactId=` deep link.
 *
 * Besides rejecting nonsense before it reaches the network, this closes a PostgREST filter-string
 * injection: `getConversationThread` interpolates the id into
 * `` .or(`lead_id.eq.${id},contact_id.eq.${id}`) ``, so a value containing commas or parentheses
 * would rewrite the filter tree. A UUID cannot.
 */
export function isValidContactId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}
