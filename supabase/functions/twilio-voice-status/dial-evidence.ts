// Recent-outbound callback routing (implementation_plan.md rev 4 §A3) — provider-verified evidence that an
// agent's browser dialled a number, captured from the signed outbound <Dial action> request.
//
// Deno-free on purpose (no Deno global, no esm.sh import; only standard web APIs) so it is unit-tested under
// vitest (src/lib/__tests__/outboundDialEvidence.test.ts) and executed inside the real handler bundle
// (src/lib/__tests__/twilioVoiceStatusHandler.test.ts).
//
// Contract:
//  - BEST-EFFORT and INVISIBLE to the webhook. index.ts starts the capture right after signature validation
//    and client creation and hands the promise to EdgeRuntime.waitUntil; it is never awaited, so no response
//    code, calls patch, status ladder/CAS, duration, missed flag or notification depends on it (AGENT_RULES
//    #30 rev 7(c) guarantees are unchanged). Losing it fails closed: no evidence row, pre-feature routing.
//  - PROVIDER-VERIFIED ONLY. The signed Dial action is cross-checked against Twilio's own parent and child
//    call records (REST, read with the outbound credential), then public.record_outbound_dial_evidence
//    re-checks every comparison plus the database predicates. There is no unverified fallback.
//  - BOUNDED. Each REST read ≤ restTimeoutMs with ONE retry on network error / timeout / 5xx; one re-read
//    after reReadDelayMs when the child is not final yet; the whole capture ≤ totalMs; at most one RPC call.
//    Nothing is queued or retried later.
//  - OBSERVABLE. Exactly one log line per triggered capture, carrying fixed vocabulary only — never a phone
//    number, client identity, SID, token or URL:
//      [twilio-voice-status] dial-evidence {category, reason, outcome, dial_call_status,
//                                            provider_child_status, rest_http_status, elapsed_ms}
//    `reason` uses the same names as the record RPC (§1.3) wherever the same check fails locally.

export type DialEvidenceCategory = "persisted" | "excluded" | "unverified" | "missing" | "operational_failure";

/** The signed Dial-action fields the capture needs (strings exactly as Twilio signed them). */
export interface DialEvidenceTrigger {
  accountSid: string;
  parentCallSid: string;
  dialCallSid: string;
  dialCallStatus: string;
  signedFrom: string;
  signedTo: string;
}

export interface DialEvidenceBounds {
  restTimeoutMs: number;
  reReadDelayMs: number;
  totalMs: number;
}

export const DIAL_EVIDENCE_BOUNDS: DialEvidenceBounds = Object.freeze({
  restTimeoutMs: 2500,
  reReadDelayMs: 1500,
  totalMs: 8000,
});

export const DIAL_EVIDENCE_LOG_TAG = "[twilio-voice-status] dial-evidence";

export interface DialEvidenceDeps {
  /** The outbound REST credential (loadOutboundTwilioCreds() in index.ts), or null when unconfigured. */
  credentials: { accountSid: string; authToken: string } | null;
  fetchJson(url: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<{ status: number; body: unknown }>;
  rpc(fn: "record_outbound_dial_evidence", args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  now(): number;
  /** Resolves after `ms`, or early when `signal` aborts (an implementation may ignore the signal). */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  log(tag: string, fields: Record<string, unknown>): void;
}

export interface DialEvidenceVerdict {
  category: DialEvidenceCategory;
  reason: string;
  outcome: "answered" | "unanswered" | null;
  /** Signed DialCallStatus, reduced to a status word (never free text). */
  dialCallStatus: string;
  /** Twilio's child-call status from the last child read, reduced to a status word; null if never read. */
  providerChildStatus: string | null;
  /** HTTP status of the last REST attempt; null when it had no HTTP response or no REST call was made. */
  restHttpStatus: number | null;
  elapsedMs: number | null;
  /** The RPC inserted the evidence row during THIS capture. */
  recorded: boolean;
  /** D3 context the RPC classified at capture time (not proof of CRM/campaign state when dialling began). */
  dialedContext: string | null;
}

const CALL_SID = /^CA[0-9a-fA-F]{32}$/;
const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/;
const QUALIFYING_DIAL_STATUSES = new Set(["completed", "answered", "no-answer"]);
const NON_FINAL_CHILD_STATUSES = new Set(["queued", "initiated", "ringing", "in-progress"]);
const CATEGORIES = new Set<string>(["persisted", "excluded", "unverified", "missing", "operational_failure"]);
const DIALED_CONTEXTS = new Set(["unsaved", "contact", "ambiguous", "campaign", "browser_marked"]);

/**
 * A capture runs only for a signed outbound Dial action placed by a browser (`From=client:<identity>`) that
 * carries a well-formed DialCallSid. Parent-status callbacks (no DialCallStatus), inbound calls and
 * non-`client:` callers return null and are never logged.
 */
export function dialEvidenceTrigger(params: Record<string, string>): DialEvidenceTrigger | null {
  try {
    const text = (k: string) => (typeof params[k] === "string" ? params[k] : "");
    const trigger: DialEvidenceTrigger = {
      accountSid: text("AccountSid"),
      parentCallSid: text("CallSid"),
      dialCallSid: text("DialCallSid"),
      dialCallStatus: text("DialCallStatus"),
      signedFrom: text("From"),
      signedTo: text("To"),
    };
    if (!trigger.dialCallStatus.trim() || !CALL_SID.test(trigger.dialCallSid)) return null;
    if (!trigger.parentCallSid.trim() || !trigger.accountSid.trim() || !trigger.signedTo.trim()) return null;
    if (!trigger.signedFrom.startsWith("client:")) return null;
    return trigger;
  } catch {
    return null;
  }
}

/**
 * Standard-web-API dependencies for index.ts: `fetchJson` wraps `fetch`, `rpc` wraps `supabase.rpc`,
 * `log` is console.log, `sleep` is a cancellable setTimeout.
 */
export function standardDialEvidenceDeps(input: {
  credentials: DialEvidenceDeps["credentials"];
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  rpc: (fn: "record_outbound_dial_evidence", args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}): DialEvidenceDeps {
  return {
    credentials: input.credentials,
    fetchJson: async (url, init) => {
      const res = await input.fetch(url, { method: "GET", headers: init.headers, signal: init.signal });
      if (!res.ok) {
        try {
          await res.body?.cancel();
        } catch {
          // the status is all that is used
        }
        return { status: res.status, body: null };
      }
      // An unreadable or aborted 2xx body rejects, i.e. it counts as a network failure (retried once).
      return { status: res.status, body: await res.json() };
    },
    rpc: (fn, args) => Promise.resolve().then(() => input.rpc(fn, args)),
    now: () => Date.now(),
    sleep: (ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          signal?.removeEventListener("abort", done);
          resolve();
        }
        signal?.addEventListener("abort", done);
      }),
    log: (tag, fields) => console.log(tag, fields),
  };
}

type Finding = Pick<DialEvidenceVerdict, "category" | "reason" | "outcome"> & {
  recorded?: boolean;
  dialedContext?: string | null;
};

const finding = (category: DialEvidenceCategory, reason: string): Finding => ({ category, reason, outcome: null });

/** Mutable observations shared by the capture body and the single log line. */
interface Observed {
  restHttpStatus: number | null;
  providerChildStatus: string | null;
}

type ReadResult =
  | { kind: "record"; record: Record<string, unknown> }
  | { kind: "failed"; finding: Finding }
  | { kind: "aborted" };

/** A status word for the log (lower-case letters and hyphens only), never free text. */
function statusWord(value: unknown): string {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z][a-z-]{0,23}$/.test(s) ? s : "unrecognized";
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeNow(deps: DialEvidenceDeps): number {
  try {
    const t = deps.now();
    return typeof t === "number" && Number.isFinite(t) ? t : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

/** Resolves when `signal` aborts; the listener is removed by the returned cleanup. */
function abortedPromise(signal: AbortSignal): { promise: Promise<"aborted">; cleanup: () => void } {
  let onAbort: () => void = () => {};
  const promise = new Promise<"aborted">((resolve) => {
    onAbort = () => resolve("aborted");
    if (signal.aborted) resolve("aborted");
    else signal.addEventListener("abort", onAbort);
  });
  return { promise, cleanup: () => signal.removeEventListener("abort", onAbort) };
}

/**
 * One bounded REST read: its own AbortController, aborted by the per-read timer or by the capture's lifetime
 * signal. The timer is raced as well, so a fetch that ignores its signal still cannot hold the capture.
 */
async function readOnce(
  deps: DialEvidenceDeps,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  lifetime: AbortSignal,
): Promise<{ kind: "http"; status: number; body: unknown } | { kind: "network" } | { kind: "timeout" } | { kind: "aborted" }> {
  const controller = new AbortController();
  const stop = abortedPromise(lifetime);
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });
  try {
    const response = Promise.resolve()
      .then(() => deps.fetchJson(url, { headers, signal: controller.signal }))
      .then(
        (r) => ({ kind: "http" as const, status: Number(r?.status), body: r?.body }),
        () => (timedOut ? { kind: "timeout" as const } : { kind: "network" as const }),
      );
    const winner = await Promise.race([
      response,
      timeout.then(() => ({ kind: "timeout" as const })),
      stop.promise.then(() => {
        controller.abort();
        return { kind: "aborted" as const };
      }),
    ]);
    return winner;
  } finally {
    clearTimeout(timer);
    stop.cleanup();
  }
}

/** A call record read with ONE retry on network error / timeout / 5xx. */
async function readCall(
  deps: DialEvidenceDeps,
  headers: Record<string, string>,
  url: string,
  notFoundReason: string,
  bounds: DialEvidenceBounds,
  lifetime: AbortSignal,
  seen: Observed,
): Promise<ReadResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (lifetime.aborted) return { kind: "aborted" };
    const r = await readOnce(deps, url, headers, bounds.restTimeoutMs, lifetime);
    if (r.kind === "aborted") return r;
    seen.restHttpStatus = r.kind === "http" && Number.isInteger(r.status) ? r.status : null;
    const retryable = r.kind !== "http" || r.status >= 500;
    if (retryable && attempt === 0) continue;
    if (r.kind === "network") return { kind: "failed", finding: finding("operational_failure", "rest_network") };
    if (r.kind === "timeout") return { kind: "failed", finding: finding("operational_failure", "rest_timeout") };
    const status = seen.restHttpStatus;
    if (status === null) return { kind: "failed", finding: finding("operational_failure", "rest_invalid_status") };
    if (status >= 200 && status < 300) {
      return isRecord(r.body)
        ? { kind: "record", record: r.body }
        : { kind: "failed", finding: finding("operational_failure", "rest_invalid_body") };
    }
    if (status === 404) return { kind: "failed", finding: finding("missing", notFoundReason) };
    if (status === 401 || status === 403) {
      return { kind: "failed", finding: finding("operational_failure", `rest_auth_${status}`) };
    }
    return { kind: "failed", finding: finding("operational_failure", `rest_${status}`) };
  }
  return { kind: "aborted" }; // unreachable: the second attempt always returns
}

/** Waits `ms` unless the capture's lifetime ends first. */
async function pause(deps: DialEvidenceDeps, ms: number, lifetime: AbortSignal): Promise<void> {
  const stop = abortedPromise(lifetime);
  try {
    await Promise.race([Promise.resolve().then(() => deps.sleep(ms, lifetime)), stop.promise]);
  } finally {
    stop.cleanup();
  }
}

/** The capture body. Returns null once the lifetime has ended (the bound verdict was already chosen). */
async function runCapture(
  deps: DialEvidenceDeps,
  t: DialEvidenceTrigger,
  bounds: DialEvidenceBounds,
  lifetime: AbortSignal,
  seen: Observed,
): Promise<Finding | null> {
  // §1.3 step 1 — the same shape checks the RPC applies first.
  if (
    !ACCOUNT_SID.test(t.accountSid) || !CALL_SID.test(t.parentCallSid) || !CALL_SID.test(t.dialCallSid) ||
    !t.signedFrom.startsWith("client:") || !t.signedFrom.slice(7).trim() || !t.signedTo.trim() || !t.dialCallStatus.trim()
  ) {
    return finding("unverified", "invalid_input");
  }
  // §1.3 step 2 — busy / failed / canceled Dial actions are expected and never read from Twilio.
  const signedStatus = t.dialCallStatus.trim().toLowerCase(); // lower(btrim()), as the RPC compares
  if (!QUALIFYING_DIAL_STATUSES.has(signedStatus)) return finding("excluded", "status_not_qualifying");

  const creds = deps.credentials;
  if (!creds || !creds.accountSid?.trim() || !creds.authToken?.trim()) {
    return finding("operational_failure", "credentials_missing");
  }
  // Account binding, part 1: the signed account must be the account whose credential reads the records.
  if (creds.accountSid !== t.accountSid) return finding("unverified", "account_mismatch");

  const headers = {
    Authorization: "Basic " + btoa(`${creds.accountSid}:${creds.authToken}`),
    Accept: "application/json",
  };
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Calls/`;

  const parentRead = await readCall(deps, headers, `${base}${encodeURIComponent(t.parentCallSid)}.json`,
    "parent_not_found", bounds, lifetime, seen);
  if (parentRead.kind === "aborted") return null;
  if (parentRead.kind === "failed") return parentRead.finding;
  const parent = parentRead.record;
  if (parent.account_sid !== t.accountSid) return finding("unverified", "account_mismatch");
  if (parent.from !== t.signedFrom) return finding("unverified", "parent_from_mismatch");

  const childUrl = `${base}${encodeURIComponent(t.dialCallSid)}.json`;
  let child: Record<string, unknown> | null = null;
  for (let read = 0; read < 2; read++) {
    if (read > 0) {
      await pause(deps, bounds.reReadDelayMs, lifetime);
      if (lifetime.aborted) return null;
    }
    const childRead = await readCall(deps, headers, childUrl, "child_not_found", bounds, lifetime, seen);
    if (childRead.kind === "aborted") return null;
    if (childRead.kind === "failed") return childRead.finding;
    child = childRead.record;
    seen.providerChildStatus = statusWord(child.status);
    if (child.account_sid !== t.accountSid) return finding("unverified", "account_mismatch");
    if (child.parent_call_sid !== t.parentCallSid) return finding("unverified", "child_parent_mismatch");
    if (!NON_FINAL_CHILD_STATUSES.has(String(child.status ?? "").trim().toLowerCase())) break;
    if (read === 1) return finding("missing", "child_not_final");
  }
  if (!child) return finding("operational_failure", "unexpected_exception");

  const childStatus = String(child.status ?? "").trim().toLowerCase();
  const pairAccepted =
    ((signedStatus === "completed" || signedStatus === "answered") && childStatus === "completed") ||
    (signedStatus === "no-answer" && (childStatus === "no-answer" || childStatus === "canceled"));
  if (!pairAccepted) return finding("unverified", "status_pair_unaccepted");

  const startMs = typeof child.start_time === "string" ? Date.parse(child.start_time) : Number.NaN;
  const childStartIso = Number.isFinite(startMs) ? new Date(startMs).toISOString() : null;

  if (lifetime.aborted) return null;
  let rpcResult: { data: unknown; error: { message: string } | null };
  try {
    rpcResult = await deps.rpc("record_outbound_dial_evidence", {
      p_signed_account_sid: t.accountSid,
      p_credential_account_sid: creds.accountSid,
      p_parent_call_sid: t.parentCallSid,
      p_dial_call_sid: t.dialCallSid,
      p_dial_call_status: t.dialCallStatus,
      p_signed_from: t.signedFrom,
      p_signed_to: t.signedTo,
      p_parent_account_sid: textOrNull(parent.account_sid),
      p_parent_from: textOrNull(parent.from),
      p_child_account_sid: textOrNull(child.account_sid),
      p_child_parent_call_sid: textOrNull(child.parent_call_sid),
      p_child_to: textOrNull(child.to),
      p_child_from: textOrNull(child.from),
      p_child_status: textOrNull(child.status),
      p_child_start_time: childStartIso,
    });
  } catch {
    return finding("operational_failure", "rpc_error");
  }
  if (!rpcResult || rpcResult.error) return finding("operational_failure", "rpc_error");
  const d = rpcResult.data;
  if (
    !isRecord(d) || typeof d.category !== "string" || !CATEGORIES.has(d.category) ||
    typeof d.reason !== "string" || !/^[a-z0-9_]{1,64}$/.test(d.reason)
  ) {
    return finding("operational_failure", "rpc_unexpected_result");
  }
  return {
    category: d.category as DialEvidenceCategory,
    reason: d.reason,
    outcome: d.outcome === "answered" || d.outcome === "unanswered" ? d.outcome : null,
    recorded: d.recorded === true,
    dialedContext: typeof d.dialed_context === "string" && DIALED_CONTEXTS.has(d.dialed_context)
      ? d.dialed_context
      : null,
  };
}

/**
 * Runs one capture. NEVER rejects and logs exactly one line. On expiry of `bounds.totalMs` the verdict is
 * `operational_failure/bound_exceeded`: in-flight reads are aborted, no later REST call or RPC starts, and
 * every timer this module created is cleared. (An RPC already in flight at expiry cannot be recalled; it
 * writes one complete row or none — the same outcome as a terminated worker.)
 */
export async function captureDialEvidence(
  deps: DialEvidenceDeps,
  trigger: DialEvidenceTrigger,
  bounds: DialEvidenceBounds = DIAL_EVIDENCE_BOUNDS,
): Promise<DialEvidenceVerdict> {
  const startedAt = safeNow(deps);
  const seen: Observed = { restHttpStatus: null, providerChildStatus: null };
  const lifetime = new AbortController();
  let boundTimer: ReturnType<typeof setTimeout> | undefined;
  let result: Finding;
  try {
    const work = Promise.resolve()
      .then(() => runCapture(deps, trigger, bounds, lifetime.signal, seen))
      .then(
        (f) => f ?? finding("operational_failure", "bound_exceeded"),
        () => finding("operational_failure", "unexpected_exception"),
      );
    const bound = new Promise<Finding>((resolve) => {
      boundTimer = setTimeout(() => {
        lifetime.abort(); // synchronously: from this instant no read, pause or RPC may start
        resolve(finding("operational_failure", "bound_exceeded"));
      }, bounds.totalMs);
    });
    result = await Promise.race([work, bound]);
  } catch {
    result = finding("operational_failure", "unexpected_exception");
  } finally {
    clearTimeout(boundTimer);
    lifetime.abort();
  }

  const endedAt = safeNow(deps);
  const elapsed = endedAt - startedAt;
  const verdict: DialEvidenceVerdict = {
    category: result.category,
    reason: result.reason,
    outcome: result.outcome,
    dialCallStatus: statusWord(trigger?.dialCallStatus),
    providerChildStatus: seen.providerChildStatus,
    restHttpStatus: seen.restHttpStatus,
    elapsedMs: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : null,
    recorded: result.recorded === true,
    dialedContext: result.dialedContext ?? null,
  };
  try {
    deps.log(DIAL_EVIDENCE_LOG_TAG, {
      category: verdict.category,
      reason: verdict.reason,
      outcome: verdict.outcome,
      dial_call_status: verdict.dialCallStatus,
      provider_child_status: verdict.providerChildStatus,
      rest_http_status: verdict.restHttpStatus,
      elapsed_ms: verdict.elapsedMs,
    });
  } catch {
    // logging must never turn a verdict into a rejection
  }
  return verdict;
}
