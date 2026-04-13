/**
 * Inbound WebRTC: Telnyx sometimes puts ANI in different option keys or only on the
 * notification envelope. Collect candidates and prefer the longest digit run (10–15).
 */

function digitLen(s: string): number {
  return s.replace(/\D/g, "").length;
}

export function resolveInboundCallerRawNumber(call: any, rawNotification?: unknown): string {
  const opts = call?.options ?? {};
  const candidates: string[] = [];

  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) candidates.push(v.trim());
  };

  push(opts.remoteCallerNumber);
  push(call?.remoteCallerNumber);
  push(opts.callerNumber);

  if (rawNotification && typeof rawNotification === "object" && rawNotification !== null) {
    const n = rawNotification as Record<string, unknown>;
    push(n.caller_id_number);
    push(n.caller_id);
    push(n.from);
    const inner = n.call;
    if (inner && typeof inner === "object") {
      const c = inner as Record<string, unknown>;
      const co = c.options as Record<string, unknown> | undefined;
      if (co) {
        push(co.remoteCallerNumber);
        push(co.callerNumber);
      }
      push(c.remoteCallerNumber);
    }
  }

  let best = "";
  for (const s of candidates) {
    const d = digitLen(s);
    if (d < 10) continue;
    if (d > 15) continue;
    if (d > digitLen(best)) best = s;
  }
  return best;
}
