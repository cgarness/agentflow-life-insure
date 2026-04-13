/**
 * Inbound WebRTC: ANI may appear on `remoteCallerNumber` or the notification envelope.
 * Never use `options.callerNumber` for inbound — it is usually *your* Telnyx / SIP caller ID, not the customer.
 */

function digitLen(s: string): number {
  return s.replace(/\D/g, "").length;
}

export function last10Digits(s: string): string | null {
  const d = s.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

/** `calls.direction` / Telnyx payloads may use `inbound` or legacy `incoming`. */
export function isCallsRowInboundDirection(direction: unknown): boolean {
  const d = String(direction ?? "").toLowerCase();
  return d === "inbound" || d === "incoming";
}

/** Telnyx JS SDK often prefixes `call_control_id` with `v3:` while webhooks may omit it. */
export function telnyxCallControlIdsEqual(a: string, b: string): boolean {
  const ta = (a || "").trim();
  const tb = (b || "").trim();
  if (!ta || !tb) return false;
  if (ta === tb) return true;
  const na = ta.replace(/^v[0-9]+:/i, "");
  const nb = tb.replace(/^v[0-9]+:/i, "");
  return na.length > 0 && na === nb;
}

/**
 * If `label` is a phone whose last-10 matches an org-owned DID, return "" — the WebRTC SDK
 * often reports the destination (your Telnyx number) as "remote" on inbound browser legs.
 */
export function stripIfOrgOwnedPhoneLabel(
  label: string,
  excludeOrgLast10?: Set<string>,
): string {
  const t = (label || "").trim();
  if (!t || !excludeOrgLast10?.size) return t;
  const l10 = last10Digits(t);
  if (l10 && excludeOrgLast10.has(l10)) return "";
  return t;
}

/**
 * True when `name` is empty or matches the caller’s digits (Telnyx / DB often duplicate ANI as “name”).
 */
export function isInboundNameSameAsPhoneNumber(name: string, callerPhone: string): boolean {
  const n = name.trim();
  if (!n) return true;
  const nd = callerPhone.replace(/\D/g, "");
  const nn = n.replace(/\D/g, "");
  if (nn.length < 7) return false;
  if (!nd) return nn.length >= 10;
  return nn === nd || nd.endsWith(nn) || (nn.length >= 10 && nd.endsWith(nn.slice(-10)));
}

/** Last-10 sets for numbers you own (DIDs) — never treat these as the inbound customer. */
export function buildOrgDidLast10Set(
  availableNumbers: { phone_number?: string | null }[],
  ...extras: (string | undefined | null)[]
): Set<string> {
  const s = new Set<string>();
  for (const n of availableNumbers) {
    const t = last10Digits(n.phone_number || "");
    if (t) s.add(t);
  }
  for (const e of extras) {
    const t = last10Digits(String(e || ""));
    if (t) s.add(t);
  }
  return s;
}

export function resolveInboundCallerRawNumber(
  call: any,
  rawNotification?: unknown,
  excludeOrgLast10?: Set<string>,
): string {
  const opts = call?.options ?? {};

  type Cand = { v: string; p: number; excluded: boolean };
  const cands: Cand[] = [];

  const add = (v: unknown, priority: number) => {
    if (typeof v !== "string" || !v.trim()) return;
    const t = v.trim();
    const d = digitLen(t);
    if (d < 10 || d > 15) return;
    const l10 = last10Digits(t);
    const excluded = Boolean(l10 && excludeOrgLast10?.has(l10));
    cands.push({ v: t, p: priority, excluded });
  };

  // Remote party only — do NOT add opts.callerNumber (agency DID on inbound legs).
  add(opts.remoteCallerNumber, 0);
  add(call?.remoteCallerNumber, 1);

  if (rawNotification && typeof rawNotification === "object" && rawNotification !== null) {
    const n = rawNotification as Record<string, unknown>;
    add(n.caller_id_number, 2);
    add(n.caller_id, 3);
    add(n.from, 4);
    add(n.from_number, 4);
    add(n.caller_number, 4);
    const inner = n.call;
    if (inner && typeof inner === "object") {
      const c = inner as Record<string, unknown>;
      const co = c.options as Record<string, unknown> | undefined;
      if (co) {
        add(co.remoteCallerNumber, 5);
        // skip co.callerNumber — same as opts.callerNumber semantics on inbound
      }
      add(c.remoteCallerNumber, 6);
    }
  }

  if (cands.length === 0) return "";

  cands.sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    const da = digitLen(a.v);
    const db = digitLen(b.v);
    if (db !== da) return db - da;
    return a.p - b.p;
  });

  return cands[0].v;
}

/**
 * Best-effort remote party number on an inbound WebRTC leg when `resolveInboundCallerRawNumber`
 * returns nothing — tries `call.remote` and `options.remoteCallerIdNumber` (SDK/version dependent).
 */
export function extractWebrtcInboundRemoteNumber(
  call: any,
  excludeOrgLast10?: Set<string>,
): string {
  const resolved = resolveInboundCallerRawNumber(call, undefined, excludeOrgLast10).trim();
  if (resolved) return resolved;

  const opts = call?.options ?? {};
  const tryStr = (v: unknown): string =>
    typeof v === "string" && v.trim() ? v.trim() : "";

  for (const v of [tryStr(call?.remote), tryStr(opts.remoteCallerIdNumber)]) {
    const d = digitLen(v);
    if (d < 10 || d > 15) continue;
    const l10 = last10Digits(v);
    if (l10 && excludeOrgLast10?.has(l10)) continue;
    return v;
  }
  return "";
}
