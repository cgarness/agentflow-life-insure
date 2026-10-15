import { SmsIntent } from "@/lib/sms-intent";
import type { CanonicalSmsRow, SmsReceipt, SmsSendOutcome } from "./smsSendResult";

/**
 * Manual-SMS pending sends for ONE browser tab, held in memory only.
 *
 * Nothing here is written to localStorage, sessionStorage, IndexedDB, logs or analytics. Reload
 * discards it; sign-out or a user change clears it. A request that was already dispatched may still
 * finish on the server — its result then appears only through saved history, and nothing is resent.
 *
 * Every record is scoped by organization, real actor, effective viewer and contact, compared at
 * render time, and every attempt carries the authority generation it started under, so a late
 * result can never act under another identity.
 */

export type SmsContactType = "lead" | "client" | "recruit";
export type PendingSmsState = "sending" | "accepted" | "accepted_review" | "not_sent" | "uncertain";

export interface SmsIdentityScope {
  organizationId: string;
  /** The REAL authenticated user (never the View As target). */
  actorId: string;
  /** The effective viewer; equal to the actor whenever sending is allowed. */
  viewerId: string;
  contactType: SmsContactType;
  contactId: string;
}

export interface SmsSnapshot extends SmsIdentityScope {
  readonly requestId: string;
  readonly to: string;
  readonly body: string;
  /** The voice caller ID the agent had selected; the server resolves the real SMS sender. */
  readonly senderPreference: string | null;
  /** Display only (never part of the request identity): names the contact in an off-screen toast. */
  readonly contactLabel: string | null;
}

export interface PendingSmsRecord {
  readonly localId: string;
  readonly scopeKey: string;
  readonly snapshot: Readonly<SmsSnapshot>;
  readonly createdAt: number;
  readonly state: PendingSmsState;
  readonly reason: string | null;
  readonly code: string | null;
  readonly message: string | null;
  /** Set once any attempt was uncertain; a later refusal cannot prove that attempt never sent. */
  readonly uncertainty: { reason: string; code: string | null; message: string } | null;
  readonly attemptId: string;
  readonly attempts: number;
  readonly dispatched: boolean;
  readonly slow: boolean;
  readonly deadlineAt: number;
  readonly authorityGen: number;
  readonly receipt: SmsReceipt | null;
  readonly canonical: { readonly row: CanonicalSmsRow; readonly readSeq: number } | null;
  readonly reconcile: "none" | "pending" | "done" | "unavailable" | "mismatch";
  /** The receipt's row has been seen in a surface's own list. */
  readonly observed: boolean;
  /** Presentation only: dismissed, or its text returned to the composer. Identity is kept. */
  readonly hidden: boolean;
  readonly origin: { readonly sinkId: string; readonly revision: number } | null;
}

export interface Authority {
  realUserId: string | null;
  organizationId: string | null;
  impersonating: boolean;
}

export interface DraftSinkState {
  channel: "sms" | "email";
  text: string;
  revision: number;
}

/** A mounted SMS composer that may receive provably-unsent text back. */
export interface DraftSink {
  readonly id: string;
  readonly scopeKey: string;
  getState(): DraftSinkState;
  restore(text: string): void;
}

export type BeginRefusal = "authority" | "view_as" | "in_flight" | "duplicate_unresolved" | "capacity";
export type DispatchBlock = "stale" | "authority" | "deadline";
export type ScopeEvent = "recovery" | "accepted";

export interface BeginInput extends SmsIdentityScope {
  to: string;
  body: string;
  senderPreference: string | null;
  contactLabel?: string | null;
}

export const SEND_DEADLINE_MS = 60_000;
export const SLOW_AFTER_MS = 10_000;
export const MAX_RECORDS = 100;

const EMPTY: readonly PendingSmsRecord[] = Object.freeze([]);

export function smsScopeKey(scope: SmsIdentityScope): string {
  return [scope.organizationId, scope.actorId, scope.viewerId, scope.contactType, scope.contactId].join("|");
}

/** Sending, or no acceptance evidence yet. Never pruned, never forgotten while the tab lives. */
export function isUnresolved(record: PendingSmsRecord): boolean {
  return record.state === "sending" || record.state === "not_sent" || record.state === "uncertain";
}

/** The pre-existing SmsIntent identity, field for field: actor, org, type, contact, to, sender, body. */
function intentPayload(s: BeginInput | SmsSnapshot): unknown[] {
  return [s.actorId, s.organizationId, s.contactType, s.contactId, s.to, s.senderPreference ?? null, s.body];
}

export interface PendingSmsStoreOptions {
  now?: () => number;
  uuid?: () => string;
}

export function createPendingSmsStore(options: PendingSmsStoreOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const intents = new SmsIntent();
  const listeners = new Set<() => void>();
  const sinks = new Map<string, DraftSink>();
  const scopeListeners = new Map<string, Set<(event: ScopeEvent) => void>>();
  let records: readonly PendingSmsRecord[] = EMPTY;
  let authority: Authority = { realUserId: null, organizationId: null, impersonating: false };
  let generation = 0;
  let readSeq = 0;

  const emit = () => listeners.forEach((listener) => listener());
  const find = (localId: string) => records.find((r) => r.localId === localId);
  const replace = (next: PendingSmsRecord) => {
    records = records.map((r) => (r.localId === next.localId ? next : r));
    emit();
  };
  const clearAll = () => {
    intents.clear();
    if (records.length) {
      records = EMPTY;
      emit();
    }
  };
  const completeIntent = (r: PendingSmsRecord) => intents.accepted(intentPayload(r.snapshot), r.snapshot.requestId);

  /** Free only resolved slots: list-reconciled or dismissed ones first, then the oldest others. */
  const prune = () => {
    const resolved = records.filter((r) => !isUnresolved(r));
    const ordered = [
      ...resolved.filter((r) => r.observed || r.hidden),
      ...resolved.filter((r) => !(r.observed || r.hidden)),
    ];
    const drop = new Set<string>();
    for (const r of ordered) {
      if (records.length - drop.size < MAX_RECORDS) break;
      drop.add(r.localId);
    }
    if (drop.size) records = records.filter((r) => !drop.has(r.localId));
  };

  const api = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: (): readonly PendingSmsRecord[] => records,
    get: (localId: string) => find(localId),
    get generation() {
      return generation;
    },

    /** Bound by PendingSmsAuthorityBridge from the real session. */
    bindAuthority(next: Authority) {
      const prev = authority;
      const userChanged = prev.realUserId !== next.realUserId;
      const orgReplaced = prev.organizationId !== null && next.organizationId !== null && prev.organizationId !== next.organizationId;
      if (userChanged || orgReplaced) clearAll();
      if (userChanged || prev.organizationId !== next.organizationId || prev.impersonating !== next.impersonating) generation += 1;
      authority = { ...next };
    },

    /**
     * A Supabase auth event, forwarded even when no SMS surface is mounted. It clears and supersedes
     * synchronously, before React re-renders; the identity itself is re-bound only by the bridge, so
     * a sign-out answered by a sign-in that React never rendered cannot leave the store unbound. In
     * the gap the dispatch re-check still requires the session user to be the snapshot's actor.
     */
    handleAuthEvent(event: string, userId: string | null) {
      if (event === "SIGNED_OUT" || (userId !== null && authority.realUserId !== null && userId !== authority.realUserId)) {
        clearAll();
        generation += 1;
      }
    },

    begin(input: BeginInput): { ok: true; record: PendingSmsRecord } | { ok: false; refusal: BeginRefusal } {
      const a = authority;
      if (!a.realUserId || !a.organizationId || a.realUserId !== input.actorId || a.organizationId !== input.organizationId) {
        return { ok: false, refusal: "authority" };
      }
      if (a.impersonating || input.viewerId !== input.actorId) return { ok: false, refusal: "view_as" };
      const scopeKey = smsScopeKey(input);
      if (records.some((r) => r.scopeKey === scopeKey && r.state === "sending")) return { ok: false, refusal: "in_flight" };

      const payload = intentPayload(input);
      const existingId = intents.peek(payload);
      const existing = existingId ? records.find((r) => r.snapshot.requestId === existingId) : undefined;
      const at = now();
      if (existing && isUnresolved(existing)) {
        // The same unresolved attempt: same record, same request ID, same frozen snapshot.
        const next: PendingSmsRecord = {
          ...existing,
          state: "sending",
          reason: null,
          code: null,
          message: null,
          attemptId: uuid(),
          attempts: existing.attempts + 1,
          dispatched: false,
          slow: false,
          deadlineAt: at + SEND_DEADLINE_MS,
          authorityGen: generation,
          hidden: false,
          origin: null,
        };
        replace(next);
        return { ok: true, record: next };
      }
      if (existingId) intents.accepted(payload, existingId);

      // D2: a changed sender preference never turns an attempt that may have sent into a fresh retry.
      const mayHaveSent = records.some(
        (r) =>
          r.scopeKey === scopeKey &&
          isUnresolved(r) &&
          (r.state === "uncertain" || r.uncertainty !== null) &&
          r.snapshot.to === input.to &&
          r.snapshot.body === input.body &&
          r.snapshot.senderPreference !== input.senderPreference,
      );
      if (mayHaveSent) return { ok: false, refusal: "duplicate_unresolved" };

      if (records.length >= MAX_RECORDS) prune();
      if (records.length >= MAX_RECORDS) {
        emit();
        return { ok: false, refusal: "capacity" };
      }

      const snapshot: SmsSnapshot = Object.freeze({
        organizationId: input.organizationId,
        actorId: input.actorId,
        viewerId: input.viewerId,
        contactType: input.contactType,
        contactId: input.contactId,
        to: input.to,
        body: input.body,
        senderPreference: input.senderPreference ?? null,
        contactLabel: input.contactLabel ?? null,
        requestId: intents.id(payload),
      });
      const record: PendingSmsRecord = {
        localId: uuid(),
        scopeKey,
        snapshot,
        createdAt: at,
        state: "sending",
        reason: null,
        code: null,
        message: null,
        uncertainty: null,
        attemptId: uuid(),
        attempts: 1,
        dispatched: false,
        slow: false,
        deadlineAt: at + SEND_DEADLINE_MS,
        authorityGen: generation,
        receipt: null,
        canonical: null,
        reconcile: "none",
        observed: false,
        hidden: false,
        origin: null,
      };
      records = [...records, record];
      emit();
      return { ok: true, record };
    },

    /** The composer cleared at send time, and its revision right after clearing. */
    setOrigin(localId: string, sinkId: string, revision: number) {
      const r = find(localId);
      if (r && r.state === "sending") replace({ ...r, origin: { sinkId, revision } });
    },

    /** Re-checked immediately before the POST. */
    dispatchBlock(localId: string, attemptId: string, sessionUserId: string): DispatchBlock | null {
      const r = find(localId);
      if (!r || r.attemptId !== attemptId || r.state !== "sending") return "stale";
      const a = authority;
      if (
        generation !== r.authorityGen ||
        a.impersonating ||
        a.realUserId !== r.snapshot.actorId ||
        a.organizationId !== r.snapshot.organizationId ||
        sessionUserId !== r.snapshot.actorId
      ) {
        return "authority";
      }
      return now() >= r.deadlineAt ? "deadline" : null;
    },

    markDispatched(localId: string, attemptId: string) {
      const r = find(localId);
      if (r && r.attemptId === attemptId && r.state === "sending") replace({ ...r, dispatched: true });
    },

    markSlow(localId: string, attemptId: string) {
      const r = find(localId);
      if (r && r.attemptId === attemptId && r.state === "sending" && !r.slow) replace({ ...r, slow: true });
    },

    /** Apply one attempt's outcome. Returns the updated record, or null for a stale or cleared attempt. */
    settle(localId: string, attemptId: string, outcome: SmsSendOutcome): PendingSmsRecord | null {
      const r = find(localId);
      if (!r || r.attemptId !== attemptId || r.state !== "sending") return null;
      let next: PendingSmsRecord;
      if (outcome.state === "accepted") {
        next = { ...r, state: "accepted", receipt: outcome.receipt, reconcile: "pending", reason: null, code: null, message: null };
        completeIntent(r);
      } else if (outcome.state === "accepted_review") {
        next = { ...r, state: "accepted_review", reason: "accepted_review", code: outcome.code, message: outcome.message };
        completeIntent(r);
      } else if (outcome.state === "not_sent") {
        next = r.uncertainty
          ? { ...r, state: "uncertain", reason: r.uncertainty.reason, code: r.uncertainty.code, message: r.uncertainty.message }
          : { ...r, state: "not_sent", reason: outcome.reason, code: outcome.code, message: outcome.message };
      } else {
        const uncertainty = { reason: outcome.reason, code: outcome.code, message: outcome.message };
        next = { ...r, state: "uncertain", ...uncertainty, uncertainty };
      }
      replace(next);
      return next;
    },

    isAuthorityCurrent(r: PendingSmsRecord) {
      return generation === r.authorityGen && !authority.impersonating && authority.realUserId === r.snapshot.actorId;
    },

    nextReadSeq: () => ++readSeq,

    attachCanonical(localId: string, row: CanonicalSmsRow, seq: number) {
      const r = find(localId);
      if (!r || r.state !== "accepted" || r.receipt?.messageId !== row.id) return;
      if (r.canonical && r.canonical.readSeq > seq) return;
      replace({ ...r, canonical: { row, readSeq: seq }, reconcile: "done" });
    },

    markReconcile(localId: string, state: "unavailable" | "mismatch") {
      const r = find(localId);
      if (r && r.state === "accepted" && !r.canonical) replace({ ...r, reconcile: state });
    },

    markObserved(localIds: readonly string[]) {
      const ids = new Set(localIds);
      if (!records.some((r) => ids.has(r.localId) && !r.observed)) return;
      records = records.map((r) => (ids.has(r.localId) && !r.observed ? { ...r, observed: true } : r));
      emit();
    },

    /** Hide the presentation only; the request identity stays so a resend reuses its ID. */
    dismiss(localId: string) {
      const r = find(localId);
      if (r && r.state !== "sending" && !r.hidden) replace({ ...r, hidden: true });
    },

    registerSink(sink: DraftSink) {
      sinks.set(sink.id, sink);
      return () => {
        if (sinks.get(sink.id) === sink) sinks.delete(sink.id);
      };
    },

    /**
     * Automatic restore: only for proven non-sending, into the ORIGINATING composer, while it still
     * has the same identity, is on SMS, is empty and has no newer draft revision.
     */
    tryRestore(localId: string): boolean {
      const r = find(localId);
      if (!r || r.state !== "not_sent" || r.uncertainty || !r.origin || r.authorityGen !== generation) return false;
      const sink = sinks.get(r.origin.sinkId);
      if (!sink || sink.scopeKey !== r.scopeKey) return false;
      const state = sink.getState();
      if (state.channel !== "sms" || state.text !== "" || state.revision !== r.origin.revision) return false;
      sink.restore(r.snapshot.body);
      replace({ ...r, hidden: true });
      return true;
    },

    /** The Edit action: proven non-sending only, into an empty SMS composer of the same identity. */
    editIntoComposer(localId: string, sinkId: string | null): boolean {
      const r = find(localId);
      if (!r || !sinkId || r.state !== "not_sent" || r.uncertainty) return false;
      const sink = sinks.get(sinkId);
      if (!sink || sink.scopeKey !== r.scopeKey) return false;
      const state = sink.getState();
      if (state.channel !== "sms" || state.text !== "") return false;
      sink.restore(r.snapshot.body);
      replace({ ...r, hidden: true });
      return true;
    },

    subscribeScope(scopeKey: string, listener: (event: ScopeEvent) => void) {
      let set = scopeListeners.get(scopeKey);
      if (!set) scopeListeners.set(scopeKey, (set = new Set()));
      set.add(listener);
      return () => {
        set?.delete(listener);
        if (set && set.size === 0) scopeListeners.delete(scopeKey);
      };
    },

    emitScope(scopeKey: string, event: ScopeEvent) {
      scopeListeners.get(scopeKey)?.forEach((listener) => listener(event));
    },

    /** A surface (or composer) showing this exact identity and contact is mounted. */
    isScopeMounted: (scopeKey: string) =>
      (scopeListeners.get(scopeKey)?.size ?? 0) > 0 || [...sinks.values()].some((s) => s.scopeKey === scopeKey),

    /** Tests and identity resets only. */
    reset() {
      clearAll();
      sinks.clear();
      scopeListeners.clear();
      authority = { realUserId: null, organizationId: null, impersonating: false };
      generation += 1;
    },
    get intentCount() {
      return intents.size;
    },
  };
  return api;
}

export type PendingSmsStore = ReturnType<typeof createPendingSmsStore>;

/** The one store shared by both SMS surfaces in this application instance. */
export const pendingSmsStore: PendingSmsStore = createPendingSmsStore();
