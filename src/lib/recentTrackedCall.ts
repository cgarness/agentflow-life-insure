/**
 * Tracked inbound calls of this signed-in session (Reports V2 PKG-C, D3 §4, ★6). Memory only: never persisted.
 *
 * The session-wide TrackedCallObserver records the server-issued call row id of an active inbound call; an entry is
 * kept 30 minutes after the call ends. Each open sale modal's source-call chip records its selection here under the
 * modal's request id, so the selection is read once, frozen with the submission and reused on every retry. Everything
 * is cleared when the signed-in user or organization changes, and an entry of another user or organization is never
 * returned. The latest call is never substituted for a selected one.
 */
export interface TrackedCall {
  rowId: string;
  callerLabel: string | null;
  startedAt: number;
  endedAt: number | null;
  userId: string;
  orgId: string;
}

export const TRACKED_CALL_TTL_MS = 30 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let identity: { userId: string; orgId: string } | null = null;
const calls = new Map<string, TrackedCall>();
/** requestId → selected row id; null means the agent removed the automatic choice. */
const selections = new Map<string, string | null>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version += 1;
  for (const listener of listeners) listener();
}

export const isCallRowId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Sets the signed-in identity; a different one (or none) clears every call and selection. */
export function setTrackedCallIdentity(userId: string | null, orgId: string | null) {
  const next = userId && orgId ? { userId, orgId } : null;
  if (identity?.userId === next?.userId && identity?.orgId === next?.orgId) return;
  identity = next;
  calls.clear();
  selections.clear();
  changed();
}

export function recordActiveInboundCall(rowId: string, callerLabel: string | null, now = Date.now()) {
  if (!identity || !isCallRowId(rowId)) return;
  const existing = calls.get(rowId);
  if (existing && existing.endedAt === null && existing.callerLabel === callerLabel) return;
  calls.set(rowId, { rowId, callerLabel, startedAt: existing?.startedAt ?? now, endedAt: null, ...identity });
  changed();
}

export function endTrackedCall(rowId: string, now = Date.now()) {
  const existing = calls.get(rowId);
  if (!existing || existing.endedAt !== null) return;
  calls.set(rowId, { ...existing, endedAt: now });
  changed();
}

function visible(entry: TrackedCall, userId: string | null, orgId: string | null, now: number) {
  return entry.userId === userId && entry.orgId === orgId && identity?.userId === userId && identity?.orgId === orgId
    && (entry.endedAt === null || now - entry.endedAt <= TRACKED_CALL_TTL_MS);
}

export function getActiveInboundCall(userId: string | null, orgId: string | null, now = Date.now()): TrackedCall | null {
  for (const entry of calls.values()) if (entry.endedAt === null && visible(entry, userId, orgId, now)) return entry;
  return null;
}

/** Calls that ended within 30 minutes, newest first. */
export function getRecentEndedCalls(userId: string | null, orgId: string | null, now = Date.now()): TrackedCall[] {
  return [...calls.values()].filter((entry) => entry.endedAt !== null && visible(entry, userId, orgId, now))
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
}

export function getTrackedCall(rowId: string, userId: string | null, orgId: string | null, now = Date.now()): TrackedCall | null {
  const entry = calls.get(rowId);
  return entry && visible(entry, userId, orgId, now) ? entry : null;
}

/** undefined: nothing chosen yet; null: the automatic choice was removed; a row id: the selected call. */
export function getChipSelection(requestId: string): string | null | undefined {
  return selections.get(requestId);
}

export function setChipSelection(requestId: string, rowId: string | null) {
  if (!requestId || (rowId !== null && !isCallRowId(rowId))) return;
  if (selections.get(requestId) === rowId) return;
  selections.set(requestId, rowId);
  changed();
}

export function clearChipSelection(requestId: string) {
  if (selections.delete(requestId)) changed();
}

export function subscribeTrackedCalls(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const trackedCallsVersion = () => version;

/** Test-only reset. */
export function resetTrackedCalls() {
  identity = null;
  calls.clear();
  selections.clear();
  changed();
}
