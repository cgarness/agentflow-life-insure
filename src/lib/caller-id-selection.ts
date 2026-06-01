/**
 * Outbound caller ID selection: sticky (spoken-to), local/state match, LRU rotation,
 * and daily caps (counts maintained server-side; client passes current rows).
 */

import { supabase } from "@/integrations/supabase/client";

// Cooldown removed — daily cap + LRU handles rotation
export const CALLER_ID_STICKY_MIN_DURATION_SEC = 45;
export const DEFAULT_DAILY_CALL_LIMIT = 100;

export interface CallerIdPhoneRow {
  phone_number: string;
  area_code: string | null;
  is_default: boolean | null;
  daily_call_count: number | null;
  daily_call_limit: number | null;
  /** Outbound role (Pass 2). 'agency' = shared pool; 'personal' = owner-only. */
  assignment_type?: string | null;
  /** Owner (profiles.id / auth.users.id). Only meaningful for personal numbers. */
  assigned_to?: string | null;
  /** Phone-number lifecycle status; pools are pre-filtered to active. */
  status?: string | null;
}

export interface SelectCallerIdInput {
  destinationPhone: string;
  contactId: string | null;
  phones: CallerIdPhoneRow[];
  /** When false, skip area-code / same-state matching (default + LRU only). */
  localPresenceEnabled: boolean;
  defaultFallback: string;
  /** LRU map (E.164 keys). */
  didLastUsedAt: Map<string, number>;
  now: number;
  stickyMinDurationSec: number;
}

function dailyLimit(p: CallerIdPhoneRow): number {
  const lim = p.daily_call_limit;
  return lim != null && lim > 0 ? lim : DEFAULT_DAILY_CALL_LIMIT;
}

function underDailyCap(p: CallerIdPhoneRow): boolean {
  return (p.daily_call_count ?? 0) < dailyLimit(p);
}

// TODO: re-enable spam_status filtering once reputation system is fully configured
/** Strict: under daily cap only. */
export function isEligibleStrict(
  p: CallerIdPhoneRow,
  _input: Pick<SelectCallerIdInput, "didLastUsedAt">,
): boolean {
  if (!underDailyCap(p)) return false;
  return true;
}

/** Fallback pool: ignores daily cap and cooldown. */
export function isEligibleFallback(_p: CallerIdPhoneRow): boolean {
  return true;
}

// ──────────────────────────────────────────────────────────────────────────
// Pass 2 — assignment_type caller-ID eligibility.
//
// Outbound role is governed by phone_numbers.assignment_type, NOT by
// assigned_to alone and NOT by is_direct_line:
//   - 'agency'   = shared outbound pool; automatic + manual eligible; assigned_to ignored.
//   - 'personal' = owner-only; NEVER automatic; manual eligible only for assigned_to === userId.
// Unknown/missing assignment_type is treated as 'agency' (prod is NOT NULL DEFAULT 'agency';
// this only affects local/dev/test rows). is_direct_line is never read for outbound eligibility.
// ──────────────────────────────────────────────────────────────────────────

/** Pools are pre-filtered to active; a missing status is treated as active (dev/test rows). */
function isActiveStatus(status?: string | null): boolean {
  if (status == null) return true;
  return String(status).toLowerCase() === "active";
}

function isPersonalNumber(p: CallerIdPhoneRow): boolean {
  return (p.assignment_type ?? "agency") === "personal";
}

/** Active Agency number — eligible for both automatic and manual selection (assigned_to ignored). */
export function isAgencyCallerIdEligible(p: CallerIdPhoneRow): boolean {
  return isActiveStatus(p.status) && !isPersonalNumber(p);
}

/** Active Personal number owned by the given user. */
export function isPersonalCallerIdOwnedByUser(
  p: CallerIdPhoneRow,
  userId: string | null | undefined,
): boolean {
  return (
    isActiveStatus(p.status) &&
    isPersonalNumber(p) &&
    !!userId &&
    p.assigned_to === userId
  );
}

/** Eligible for AUTOMATIC selection (local presence, rotation, smart/fallback). Personal is never automatic. */
export function isAutomaticCallerIdAllowed(p: CallerIdPhoneRow): boolean {
  return isAgencyCallerIdEligible(p) && underDailyCap(p);
}

/** Eligible for MANUAL selection by this user: any active Agency number, or the user's own Personal number. */
export function isManualCallerIdAllowed(
  p: CallerIdPhoneRow,
  userId: string | null | undefined,
): boolean {
  return isAgencyCallerIdEligible(p) || isPersonalCallerIdOwnedByUser(p, userId);
}

/** Automatic pool: active Agency numbers under daily cap. */
export function filterAutomaticCallerIdPool<T extends CallerIdPhoneRow>(rows: T[]): T[] {
  return rows.filter(isAutomaticCallerIdAllowed);
}

/** Manual options for this user: Agency numbers + the user's own Personal numbers. */
export function filterManualCallerIdOptions<T extends CallerIdPhoneRow>(
  rows: T[],
  userId: string | null | undefined,
): T[] {
  return rows.filter((r) => isManualCallerIdAllowed(r, userId));
}

/**
 * Final-gate primitive: return the row matching `phoneNumber` only if this user is allowed to
 * use it (Agency, or own Personal). Returns null for unknown / inactive / another user's Personal.
 * Automatic selection can never yield a Personal number because the automatic pool excludes them.
 */
export function findAllowedCallerId<T extends CallerIdPhoneRow>(
  rows: T[],
  phoneNumber: string | null | undefined,
  userId: string | null | undefined,
): T | null {
  if (!phoneNumber) return null;
  const row = rows.find((r) => r.phone_number === phoneNumber);
  if (!row) return null;
  return isManualCallerIdAllowed(row, userId) ? row : null;
}

export function extractDestinationAreaCode(destinationPhone: string): string | null {
  const digits = destinationPhone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10, -7);
}

function sortLru(
  list: CallerIdPhoneRow[],
  didLastUsedAt: Map<string, number>,
): CallerIdPhoneRow[] {
  return [...list].sort((a, b) => {
    const ta = didLastUsedAt.get(a.phone_number);
    const tb = didLastUsedAt.get(b.phone_number);
    const ua = ta === undefined ? Number.NEGATIVE_INFINITY : ta;
    const ub = tb === undefined ? Number.NEGATIVE_INFINITY : tb;
    if (ua !== ub) return ua - ub;
    return a.phone_number.localeCompare(b.phone_number);
  });
}

function pickFromTier(
  tier: CallerIdPhoneRow[],
  input: SelectCallerIdInput,
  strict: boolean,
): string | null {
  const pool = strict
    ? tier.filter((p) => isEligibleStrict(p, input))
    : tier.filter((p) => isEligibleFallback(p));
  if (pool.length === 0) return null;
  const sorted = sortLru(pool, input.didLastUsedAt);
  return sorted[0]!.phone_number;
}

export interface CallerIdSelectionDeps {
  queryStickyCaller: (
    contactId: string,
  ) => Promise<{ caller_id_used: string; duration_sec: number } | null>;
  getStateByAreaCode: (areaCode: string) => Promise<string | null>;
}

/**
 * Choose outbound caller ID. Manual override should be handled by the caller before invoking this.
 */
export async function selectOutboundCallerId(
  input: SelectCallerIdInput,
  deps: CallerIdSelectionDeps,
): Promise<string> {
  const { phones, defaultFallback, localPresenceEnabled, contactId } = input;

  if (phones.length === 0) {
    return defaultFallback || "";
  }

  // ── Sticky: only if last outbound to contact was a real conversation ──
  if (contactId) {
    const sticky = await deps.queryStickyCaller(contactId);
    if (sticky && sticky.duration_sec >= input.stickyMinDurationSec) {
      const row = phones.find((p) => p.phone_number === sticky.caller_id_used);
      if (row && isEligibleStrict(row, input)) {
        return row.phone_number;
      }
    }
  }

  const destAc = extractDestinationAreaCode(input.destinationPhone);

  // ── Tier: same area code ──
  if (localPresenceEnabled && destAc) {
    const localTier = phones.filter((p) => (p.area_code || "") === destAc);
    const picked = pickFromTier(localTier, input, true);
    if (picked) return picked;
  }

  // ── Tier: same state (via area_code_mapping) ──
  if (localPresenceEnabled && destAc) {
    const leadState = await deps.getStateByAreaCode(destAc);
    if (leadState) {
      const stateTier: CallerIdPhoneRow[] = [];
      for (const p of phones) {
        const pac = p.area_code || "";
        if (!pac) continue;
        if (pac === destAc) continue;
        const ps = await deps.getStateByAreaCode(pac);
        if (ps && ps === leadState) stateTier.push(p);
      }
      const picked = pickFromTier(stateTier, input, true);
      if (picked) return picked;
    }
  }

  // ── Tier: org default ──
  const defaultTier = phones.filter((p) => p.is_default === true);
  const defaultPick = pickFromTier(defaultTier, input, true);
  if (defaultPick) return defaultPick;

  // ── Tier: any strict eligible ──
  const anyStrict = pickFromTier(phones, input, true);
  if (anyStrict) return anyStrict;

  // ── Hard fallback: ignore daily/cooldown ──
  const fb = pickFromTier(phones, input, false);
  if (fb) return fb;

  return defaultFallback || phones[0]?.phone_number || "";
}

/** Look up the US state for a given 3-digit area code via the `area_code_mapping` table. */
export async function getStateByAreaCode(areaCode: string): Promise<string | null> {
  try {
    const { data, error } = await (supabase as any)
      .from('area_code_mapping')
      .select('state')
      .eq('area_code', areaCode)
      .maybeSingle();

    if (error) {
      console.warn(`[caller-id-selection] area_code_mapping lookup failed for areaCode=${areaCode}`, error);
      return null;
    }
    if (!data) return null;
    return (data as any).state;
  } catch (err) {
    console.warn(`[caller-id-selection] getStateByAreaCode threw for areaCode=${areaCode}`, err);
    return null;
  }
}
