/**
 * Inbound WebRTC: ANI may appear on `remoteCallerNumber` or the notification envelope.
 * Never use `options.callerNumber` for inbound — it is usually *your* Telnyx / SIP caller ID, not the customer.
 */

function digitLen(s: string): number {
  return s.replace(/\D/g, "").length;
}

function last10Digits(s: string): string | null {
  const d = s.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
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

  type Cand = { v: string; p: number };
  const cands: Cand[] = [];

  const add = (v: unknown, priority: number) => {
    if (typeof v !== "string" || !v.trim()) return;
    const t = v.trim();
    const d = digitLen(t);
    if (d < 10 || d > 15) return;
    const l10 = last10Digits(t);
    if (l10 && excludeOrgLast10?.has(l10)) return;
    cands.push({ v: t, p: priority });
  };

  // Remote party only — do NOT add opts.callerNumber (agency DID on inbound legs).
  add(opts.remoteCallerNumber, 0);
  add(call?.remoteCallerNumber, 1);

  if (rawNotification && typeof rawNotification === "object" && rawNotification !== null) {
    const n = rawNotification as Record<string, unknown>;
    add(n.caller_id_number, 2);
    add(n.caller_id, 3);
    add(n.from, 4);
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
    const da = digitLen(a.v);
    const db = digitLen(b.v);
    if (db !== da) return db - da;
    return a.p - b.p;
  });

  return cands[0].v;
}
