/**
 * Outbound caller ID selection: sticky (spoken-to), local/state match, LRU rotation,
 * and daily caps (counts maintained server-side; client passes current rows).
 */

import { supabase } from "@/integrations/supabase/client";

// Cooldown removed — daily cap + LRU handles rotation
export const CALLER_ID_STICKY_MIN_DURATION_SEC = 30;
export const DEFAULT_DAILY_CALL_LIMIT = 100;

export interface CallerIdPhoneRow {
  phone_number: string;
  area_code: string | null;
  is_default: boolean | null;
  daily_call_count: number | null;
  daily_call_limit: number | null;
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
