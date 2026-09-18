/** Inbound Calling v2 — pure input normalisation shared by the profile and admin settings cards. */

const E164 = /^\+[1-9][0-9]{7,14}$/;

/** Accepts "+15551234567", "(555) 123-4567", "555-123-4567", "1 555 123 4567"; returns E.164 or null. */
export function normalizeMobileForwardNumber(raw: string | null | undefined): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  if (E164.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (trimmed.startsWith("+") && E164.test(`+${digits}`)) return `+${digits}`;
  return null;
}

export const RING_SECONDS_MIN = 5;
export const RING_SECONDS_MAX = 120;
export const RETENTION_DAYS_MIN = 1;
export const RETENTION_DAYS_MAX = 365;
export const INBOUND_GROUP_MAX = 10;

export function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** P2: 1..10 DISTINCT ids; the server validates membership (same org, Active, identity). */
export function validateInboundGroupSelection(ids: string[]): { ok: true; ids: string[] } | { ok: false; message: string } {
  const distinct = [...new Set(ids.filter((v) => typeof v === "string" && v.length > 0))];
  if (distinct.length === 0) return { ok: false, message: "Select at least one agent for the inbound group." };
  if (distinct.length > INBOUND_GROUP_MAX) return { ok: false, message: `The inbound group can hold at most ${INBOUND_GROUP_MAX} agents (Twilio rings at most ten browsers at once).` };
  return { ok: true, ids: distinct };
}
