/**
 * Dashboard attention clearances — data access (Polish V2 plan §3.3–§3.8).
 *
 * "Clear" hides one Missed Call or Callback occurrence from the VIEWER's own Dashboard. It is
 * alert state only: the call, voicemail, recording, notification, campaign lead, callback time,
 * callback owner and appointment are never written, and a cleared callback is never "completed".
 *
 * Reads: the viewer's own `dashboard_attention_clearances` rows for a source window. A clearance
 * matches a source row only while the row's CURRENT occurrence (call time / authoritative due time)
 * equals the one that was cleared, so a rescheduled callback comes back on its own.
 *
 * Writes: only `clear_dashboard_attention_item` / `undo_dashboard_attention_clear` (SECURITY
 * INVOKER). They derive the user and organization server-side and read the source's current
 * occurrence under its own RLS.
 */
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { assertValidUserId, DashboardQueryError } from "@/lib/dashboard-contact-identity";
import { assertPageActive } from "@/lib/pageActivity";
import { readAllExact } from "@/lib/paged-exact-read";

export const ATTENTION_SOURCE_TYPES = ["missed_call", "campaign_callback", "appointment_callback"] as const;
export type AttentionSourceType = (typeof ATTENTION_SOURCE_TYPES)[number];

/**
 * Most clearances one load reads. Beyond it the load FAILS (never partial): an incomplete set
 * could show a cleared item again or miscount the queue.
 */
export const CLEARANCE_READ_CAP = 2000;
/** Source ids per `.in()` match read, so a request URL stays small. */
export const MATCH_CHUNK_SIZE = 100;

/** Fired after any stored Clear / Undo, so every attention surface (widget and detail) reloads. */
export const ATTENTION_CHANGED_EVENT = "agentflow:dashboard-attention-changed";
export const announceAttentionChange = () => window.dispatchEvent(new Event(ATTENTION_CHANGED_EVENT));

const timestamp = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), "timestamp");

const clearanceRowSchema = z.object({
  id: z.string().uuid(),
  source_type: z.enum(ATTENTION_SOURCE_TYPES),
  source_id: z.string().uuid(),
  occurrence_at: timestamp,
  cleared_at: timestamp,
});
interface ClearanceRow {
  id: string;
  source_type: AttentionSourceType;
  source_id: string;
  occurrence_at: string;
  cleared_at: string;
}

/** One stored clearance. Timestamps are kept EXACTLY as the server returned them (microseconds). */
export interface AttentionClearance {
  id: string;
  sourceType: AttentionSourceType;
  sourceId: string;
  occurrenceAt: string;
  clearedAt: string;
}

const toClearance = (row: ClearanceRow): AttentionClearance => ({
  id: row.id,
  sourceType: row.source_type,
  sourceId: row.source_id,
  occurrenceAt: row.occurrence_at,
  clearedAt: row.cleared_at,
});

/** Sub-second digits of an ISO timestamp, padded to microseconds ("" → "000000"). */
function fraction(iso: string): string {
  const match = /T\d{2}:\d{2}:\d{2}(?:\.(\d+))?/.exec(iso);
  return ((match?.[1] ?? "") + "000000").slice(0, 6);
}

/**
 * Two server timestamps name the same instant. Compares the epoch millisecond AND the
 * sub-millisecond digits, so `…00.123456` and `…00.123` are different (as they are in Postgres).
 */
export function sameInstant(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb) || ta !== tb) return false;
  return fraction(a) === fraction(b);
}

/** Orders two server timestamps by instant, microseconds included (negative when `a` is earlier). */
export function compareInstants(a: string, b: string): number {
  const diff = Date.parse(a) - Date.parse(b);
  if (diff !== 0 && !Number.isNaN(diff)) return diff;
  const fa = fraction(a);
  const fb = fraction(b);
  return fa < fb ? -1 : fa > fb ? 1 : 0;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The clearances of one load, indexed for exclusion. Empty = feature off (no reads, no change). */
export class AttentionExclusions {
  private readonly bySource = new Map<string, AttentionClearance[]>();

  constructor(readonly clearances: readonly AttentionClearance[] = []) {
    for (const c of clearances) {
      const key = `${c.sourceType}:${c.sourceId}`;
      this.bySource.set(key, [...(this.bySource.get(key) ?? []), c]);
    }
  }

  static empty(): AttentionExclusions {
    return new AttentionExclusions([]);
  }

  /** Clearances of one source type: an upper bound on how many rows of that source can be hidden. */
  count(type: AttentionSourceType): number {
    return this.clearances.filter((c) => c.sourceType === type).length;
  }

  /** Distinct cleared source ids of one type (for the match reads). */
  sourceIds(type: AttentionSourceType): string[] {
    return [...new Set(this.clearances.filter((c) => c.sourceType === type).map((c) => c.sourceId))];
  }

  /** The clearance that hides this occurrence, or `null` (rescheduled / never cleared). */
  match(type: AttentionSourceType, sourceId: string, occurrenceAt: string): AttentionClearance | null {
    const list = this.bySource.get(`${type}:${sourceId}`);
    return list?.find((c) => sameInstant(c.occurrenceAt, occurrenceAt)) ?? null;
  }

  get isEmpty(): boolean {
    return this.clearances.length === 0;
  }
}

export interface ClearanceReadScope {
  userId: string;
  organizationId: string | null;
  sourceTypes: readonly AttentionSourceType[];
  /** Inclusive lower bound of the occurrence window (ISO). */
  fromIso: string;
  /** Exclusive upper bound (ISO); omitted for windows that end now (missed calls). */
  toIso?: string;
  signal?: AbortSignal;
}

/**
 * The viewer's own clearances in a window; COMPLETE or it throws. A returned error is a
 * failure, never "nothing cleared".
 */
export async function readOwnClearances(scope: ClearanceReadScope): Promise<AttentionExclusions> {
  const userId = assertValidUserId(scope.userId);
  // Fail closed: without the viewer's organization there is no tenant to read.
  if (!scope.organizationId) throw new DashboardQueryError("attention-organization", new Error("No organization"));
  const organizationId = scope.organizationId;
  const result = await readAllExact<ClearanceRow>(
    (afterId, limit, withCount) => {
      let q = supabase
        .from("dashboard_attention_clearances")
        .select("id, source_type, source_id, occurrence_at, cleared_at", withCount ? { count: "exact" } : undefined)
        .eq("user_id", userId)
        .eq("organization_id", organizationId)
        .in("source_type", [...scope.sourceTypes])
        .gte("occurrence_at", scope.fromIso);
      if (scope.toIso) q = q.lt("occurrence_at", scope.toIso);
      if (afterId) q = q.gt("id", afterId);
      let ordered = q.order("id", { ascending: true }).limit(limit);
      if (scope.signal) ordered = ordered.abortSignal(scope.signal);
      return ordered as unknown as PromiseLike<{ data: ClearanceRow[] | null; error: unknown; count?: number | null }>;
    },
    { context: "attention-clearances", cap: CLEARANCE_READ_CAP + 1, beforeFollowOn: assertPageActive },
  );
  if (!result.complete || result.rows.length > CLEARANCE_READ_CAP) {
    throw new DashboardQueryError("attention-clearances-incomplete", new Error(`${result.rows.length} of ${result.total}`));
  }
  const rows = z.array(clearanceRowSchema).safeParse(result.rows);
  if (!rows.success) throw new DashboardQueryError("attention-clearances-shape", rows.error);
  return new AttentionExclusions((rows.data as ClearanceRow[]).map(toClearance));
}

// ---- actions --------------------------------------------------------------------------------------

export type AttentionActionFailure = "not_pending" | "changed" | "denied" | "offline" | "invalid" | "failed";

/** A user-safe action failure; the raw cause is for the console only. */
export class AttentionActionError extends Error {
  readonly cause: unknown;
  constructor(readonly kind: AttentionActionFailure, cause?: unknown) {
    super(kind);
    this.name = "AttentionActionError";
    this.cause = cause;
  }
}

const clearInputSchema = z.object({
  sourceType: z.enum(ATTENTION_SOURCE_TYPES),
  sourceId: z.string().uuid(),
  // Sent exactly as the server returned it: never through Date (that would drop microseconds).
  expectedOccurrenceAt: z.string().datetime({ offset: true }),
});
export type ClearAttentionInput = z.infer<typeof clearInputSchema>;

function failureKind(error: { code?: string } | null | undefined): AttentionActionFailure {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  switch (error?.code) {
    case "PT404":
      return "not_pending";
    case "PT409":
      return "changed";
    case "42501":
      return "denied";
    case "22023":
      return "invalid";
    default:
      return "failed";
  }
}

/** Clear. Resolves only with the clearance the server stored (or already had). */
export async function clearAttentionItem(input: ClearAttentionInput): Promise<AttentionClearance> {
  const parsed = clearInputSchema.safeParse(input);
  if (!parsed.success) throw new AttentionActionError("invalid", parsed.error);
  const { data, error } = await supabase.rpc("clear_dashboard_attention_item", {
    p_source_type: parsed.data.sourceType,
    p_source_id: parsed.data.sourceId,
    p_expected_occurrence_at: parsed.data.expectedOccurrenceAt,
  });
  if (error) {
    console.error("[DashboardAttention] Clear failed:", error);
    throw new AttentionActionError(failureKind(error), error);
  }
  const row = clearanceRowSchema.safeParse(Array.isArray(data) ? data[0] : data);
  // Nothing stored is a failure, never a reported success.
  if (!row.success) throw new AttentionActionError("failed", row.error);
  return toClearance(row.data as ClearanceRow);
}

/** Undo: removes the viewer's clearance only if it is still exactly the one being undone. */
export async function undoAttentionClear(clearance: { id: string; clearedAt: string }): Promise<void> {
  const parsed = z.object({ id: z.string().uuid(), clearedAt: timestamp }).safeParse(clearance);
  if (!parsed.success) throw new AttentionActionError("invalid", parsed.error);
  const { data, error } = await supabase.rpc("undo_dashboard_attention_clear", {
    p_id: parsed.data.id,
    p_expected_cleared_at: parsed.data.clearedAt,
  });
  if (error) {
    console.error("[DashboardAttention] Undo failed:", error);
    throw new AttentionActionError(failureKind(error), error);
  }
  if (data !== true) throw new AttentionActionError("changed");
}
