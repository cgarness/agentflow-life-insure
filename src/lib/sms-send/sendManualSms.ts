import {
  classifySmsResponse,
  matchCanonicalRow,
  noResponse,
  notStarted,
  type SmsSendOutcome,
} from "./smsSendResult";
import {
  SLOW_AFTER_MS,
  type BeginInput,
  type BeginRefusal,
  type PendingSmsRecord,
  type PendingSmsStore,
  type SmsSnapshot,
} from "./pendingSmsStore";

/**
 * The one manual-SMS send path shared by Conversations and the contact record.
 *
 * `submit` is synchronous: it creates the pending record, clears the originating composer and
 * returns before anything is awaited, so the bubble paints on the next frame. The request then runs
 * in the background: session → authority re-check → exactly one POST (never retried) → exact
 * classification → targeted read of the saved row.
 */

export interface ManualSmsRequestBody {
  request_id: string;
  actor_id: string;
  organization_id: string;
  view_as: false;
  to: string;
  from?: string;
  body: string;
  contact_id: string;
  contact_type: string;
  lead_id: string;
}

export interface SmsDraftOrigin {
  /** The composer's draft sink; without one the text is never restored automatically. */
  sinkId: string | null;
  /** Clears the composer for this send; returns its draft revision after clearing. */
  clear: () => number;
}

export interface SubmitInput extends BeginInput {
  origin?: SmsDraftOrigin | null;
}

export type SubmitRefusal = BeginRefusal | "offline";
export type SubmitResult = { ok: true; localId: string } | { ok: false; refusal: SubmitRefusal };

export interface ManualSmsSenderDeps {
  store: PendingSmsStore;
  getSession: () => Promise<{ accessToken: string; userId: string } | null>;
  post: (body: ManualSmsRequestBody, accessToken: string, signal: AbortSignal) => Promise<{ status: number; text: string }>;
  /** One `messages` row by id within the organization, or null; throws on a failed read. */
  readRow: (messageId: string, organizationId: string) => Promise<unknown>;
  notify: { error: (message: string) => void; warning: (message: string) => void };
  now?: () => number;
  schedule?: (run: () => void, ms: number) => () => void;
  isOnline?: () => boolean;
  /** Optional timing marks; never receives a body, phone number or token. */
  mark?: (localId: string, phase: string) => void;
  /** Offsets from acceptance at which the saved row is read. */
  reconcileAtMs?: readonly number[];
}

export const REFUSAL_MESSAGES: Readonly<Record<Exclude<SubmitRefusal, "in_flight">, string>> = Object.freeze({
  offline: "You're offline. The text was not sent.",
  authority: "Couldn't confirm your account. The text was not sent.",
  view_as: "View As is read-only — you can't send messages as another user.",
  duplicate_unresolved: "An earlier attempt of this text isn't confirmed. Edit the text to send a new message.",
  capacity: "Too many unresolved texts in this tab. The text was not sent.",
});

const DEFAULT_RECONCILE_AT_MS = [0, 2_000, 10_000] as const;

function defaultSchedule(run: () => void, ms: number) {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
}

export function manualSmsRequestBody(s: SmsSnapshot): ManualSmsRequestBody {
  return {
    request_id: s.requestId,
    actor_id: s.actorId,
    organization_id: s.organizationId,
    view_as: false,
    to: s.to,
    ...(s.senderPreference ? { from: s.senderPreference } : {}),
    body: s.body,
    contact_id: s.contactId,
    contact_type: s.contactType,
    lead_id: s.contactId,
  };
}

export function createManualSmsSender(deps: ManualSmsSenderDeps) {
  const { store, notify } = deps;
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.schedule ?? defaultSchedule;
  const isOnline = deps.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const mark = deps.mark ?? (() => {});
  const reconcileAt = deps.reconcileAtMs ?? DEFAULT_RECONCILE_AT_MS;
  const sleep = (ms: number) => new Promise<void>((resolve) => schedule(resolve, ms));

  /** Off-screen outcomes name the contact so they are never read as the open contact's. */
  const describe = (r: PendingSmsRecord, verdict: string) => {
    const message = r.message ?? verdict;
    const label = r.snapshot.contactLabel;
    return store.isScopeMounted(r.scopeKey) || !label ? message : `Text to ${label} ${verdict}: ${message}`;
  };

  async function reconcile(localId: string) {
    let waited = 0;
    for (const at of reconcileAt) {
      if (at > waited) {
        await sleep(at - waited);
        waited = at;
      }
      const r = store.get(localId);
      if (!r || r.state !== "accepted" || !r.receipt || r.canonical || r.observed) return;
      const seq = store.nextReadSeq();
      try {
        const raw = await deps.readRow(r.receipt.messageId, r.snapshot.organizationId);
        if (raw) {
          const row = matchCanonicalRow(raw, {
            messageId: r.receipt.messageId,
            organizationId: r.snapshot.organizationId,
            contactId: r.snapshot.contactId,
            actorId: r.snapshot.actorId,
          });
          if (row) {
            store.attachCanonical(localId, row, seq);
            mark(localId, "canonical");
          } else {
            store.markReconcile(localId, "mismatch");
            store.emitScope(r.scopeKey, "recovery");
          }
          return;
        }
      } catch {
        // A failed read never turns an accepted send into a failure; the next offset retries it.
      }
    }
    const r = store.get(localId);
    if (r && r.state === "accepted" && !r.canonical && !r.observed) {
      store.markReconcile(localId, "unavailable");
      store.emitScope(r.scopeKey, "recovery");
    }
  }

  function finish(localId: string, attemptId: string, outcome: SmsSendOutcome) {
    const next = store.settle(localId, attemptId, outcome);
    if (!next) return; // superseded, or cleared by a sign-out / user change
    mark(localId, "settled");
    if (next.state === "accepted") {
      store.emitScope(next.scopeKey, "accepted");
      void reconcile(localId);
      return;
    }
    // A late result under another identity restores nothing, toasts nothing and wakes nothing.
    if (!store.isAuthorityCurrent(next)) return;
    if (next.state === "not_sent") {
      store.tryRestore(localId);
      notify.error(describe(next, "not sent"));
    } else if (next.state === "uncertain") {
      notify.error(describe(next, "not confirmed"));
      store.emitScope(next.scopeKey, "recovery");
    } else {
      notify.warning(describe(next, "accepted, history not saved"));
      store.emitScope(next.scopeKey, "recovery");
    }
  }

  async function run(localId: string, attemptId: string) {
    const record = store.get(localId);
    if (!record) return;
    const controller = new AbortController();
    let deadlineReached = false;
    let reachDeadline!: () => void;
    const deadline = new Promise<"deadline">((resolve) => {
      reachDeadline = () => resolve("deadline");
    });
    const cancelSlow = schedule(() => store.markSlow(localId, attemptId), SLOW_AFTER_MS);
    const cancelDeadline = schedule(() => {
      deadlineReached = true;
      controller.abort();
      reachDeadline();
    }, Math.max(0, record.deadlineAt - now()));

    let outcome: SmsSendOutcome;
    try {
      const session = await Promise.race([
        Promise.resolve().then(deps.getSession).catch(() => null),
        deadline,
      ]);
      if (session === "deadline") outcome = notStarted("deadline");
      else if (!session) outcome = notStarted("session");
      else {
        // Immediately before the POST: same generation, actor, organization; not View As; in time.
        const block = store.dispatchBlock(localId, attemptId, session.userId);
        if (block === "stale") return;
        if (block) outcome = notStarted(block);
        else {
          store.markDispatched(localId, attemptId);
          mark(localId, "dispatch");
          try {
            const response = await deps.post(manualSmsRequestBody(record.snapshot), session.accessToken, controller.signal);
            mark(localId, "response");
            outcome = classifySmsResponse(response.status, response.text);
          } catch {
            // Aborting the browser request does not prove the server stopped: never "not sent".
            outcome = noResponse(deadlineReached ? "deadline" : "transport");
          }
        }
      }
    } finally {
      cancelSlow();
      cancelDeadline();
    }
    finish(localId, attemptId, outcome);
  }

  return {
    submit(input: SubmitInput): SubmitResult {
      if (!isOnline()) {
        notify.error(REFUSAL_MESSAGES.offline);
        return { ok: false, refusal: "offline" };
      }
      const begun = store.begin(input);
      // `in`, not `!begun.ok`: this project compiles without strict mode, which cannot narrow on it.
      if ("refusal" in begun) {
        // A second click while this contact's text is in flight is answered by the pending bubble.
        if (begun.refusal !== "in_flight") notify.error(REFUSAL_MESSAGES[begun.refusal]);
        return { ok: false, refusal: begun.refusal };
      }
      const { localId, attemptId } = begun.record;
      mark(localId, "pending");
      if (input.origin) {
        const revision = input.origin.clear();
        if (input.origin.sinkId) store.setOrigin(localId, input.origin.sinkId, revision);
      }
      void run(localId, attemptId);
      return { ok: true, localId };
    },
  };
}

export type ManualSmsSender = ReturnType<typeof createManualSmsSender>;
