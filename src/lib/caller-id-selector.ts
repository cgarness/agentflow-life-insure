import { supabase } from "@/integrations/supabase/client";

// TypeScript interfaces
interface PhoneNumber {
  id: string;
  phone_number: string; // E.164 format
  spam_status: 'Clean' | 'At Risk' | 'Flagged' | 'Unknown';
  spam_score: number;
  daily_call_count: number;
  daily_call_limit: number;
  is_default: boolean;
}

interface CampaignLead {
  id: string;
  phone: string; // E.164 format
  campaign_id: string;
}

// Area code to state mapping lookup
export async function getStateByAreaCode(areaCode: string): Promise<string | null> {
  try {
    const { data, error } = await (supabase as any)
      .from('area_code_mapping')
      .select('state')
      .eq('area_code', areaCode)
      .maybeSingle();

    if (error) {
      console.warn(`[caller-id-selector] area_code_mapping lookup failed for areaCode=${areaCode}`, error);
      return null;
    }
    if (!data) return null;
    return (data as any).state;
  } catch (err) {
    console.warn(`[caller-id-selector] getStateByAreaCode threw for areaCode=${areaCode}`, err);
    return null;
  }
}

// Extract area code from E.164 phone number
// E.164 format: +19098345211 → extract "909"
function extractAreaCode(phone: string): string {
  return phone.substring(2, 5);
}

// Check if two area codes match exactly
function isLocalMatch(leadAreaCode: string, phoneAreaCode: string): boolean {
  return leadAreaCode === phoneAreaCode;
}

// Check if two states match (near-local)
function isNearLocalMatch(leadState: string | null, phoneState: string | null): boolean {
  if (!leadState || !phoneState) return false;
  return leadState === phoneState;
}

// Main caller ID selection logic
export async function selectCallerID(
  lead: CampaignLead,
  agentId: string,
  phoneNumbers: PhoneNumber[],
  localPresenceEnabled: boolean = true
): Promise<string> {

  // Filter out Flagged numbers and numbers that hit daily limit
  const availableNumbers = phoneNumbers.filter(
    p => p.spam_status !== 'Flagged' && p.daily_call_count < p.daily_call_limit
  );

  if (availableNumbers.length === 0) {
    // All numbers are exhausted or flagged — strict fallback to org primary number
    const primaryNumber = phoneNumbers.find(p => p.is_default);
    if (primaryNumber) {
      console.warn('[caller-id-selector] All numbers at daily limit or flagged — falling back to org primary number:', primaryNumber.phone_number);
      return primaryNumber.phone_number;
    }
    // No primary configured — this is a misconfiguration
    if (phoneNumbers.length > 0) {
      console.error('[caller-id-selector] CRITICAL: No is_default number configured for this organization. Using first available as emergency fallback.');
      return phoneNumbers[0].phone_number;
    }
    console.error('[caller-id-selector] CRITICAL: Organization has zero phone numbers. Cannot select caller ID.');
    return '';
  }

  // If local presence disabled, return cleanest number
  if (!localPresenceEnabled) {
    return getCleanestNumber(availableNumbers);
  }

  // Extract lead's area code
  const leadAreaCode = extractAreaCode(lead.phone);
  const leadState = await getStateByAreaCode(leadAreaCode);

  // Priority 1: Exact local match (same area code, Clean status)
  const exactLocalMatches = availableNumbers.filter(p => {
    const phoneAreaCode = extractAreaCode(p.phone_number);
    return isLocalMatch(leadAreaCode, phoneAreaCode) && p.spam_status === 'Clean';
  });

  if (exactLocalMatches.length > 0) {
    return exactLocalMatches.sort((a, b) => b.spam_score - a.spam_score)[0].phone_number;
  }

  // Priority 2: Near-local match (same state, Clean status)
  if (leadState) {
    const nearLocalMatches: PhoneNumber[] = [];
    for (const phone of availableNumbers) {
      if (phone.spam_status !== 'Clean') continue;
      const phoneAreaCode = extractAreaCode(phone.phone_number);
      const phoneState = await getStateByAreaCode(phoneAreaCode);
      if (isNearLocalMatch(leadState, phoneState)) {
        nearLocalMatches.push(phone);
      }
    }

    if (nearLocalMatches.length > 0) {
      return nearLocalMatches.sort((a, b) => b.spam_score - a.spam_score)[0].phone_number;
    }
  }

  // Priority 3: Cleanest number overall (Clean > At Risk > Unknown)
  const cleanest = getCleanestNumber(availableNumbers);
  if (cleanest) return cleanest;

  // Priority 4: Organization primary number (is_default=true) regardless of daily limit
  const orgPrimary = phoneNumbers.find(p => p.is_default);
  if (orgPrimary) {
    console.warn('[caller-id-selector] No clean numbers available — falling back to org primary:', orgPrimary.phone_number);
    return orgPrimary.phone_number;
  }

  console.error('[caller-id-selector] CRITICAL: No suitable caller ID found. Returning first number as emergency fallback.');
  return phoneNumbers[0]?.phone_number || '';
}

// Helper: Get cleanest number based on spam status + score
function getCleanestNumber(phoneNumbers: PhoneNumber[]): string {
  const sortedByStatus = [...phoneNumbers].sort((a, b) => {
    // Priority scores: Clean = 3, At Risk = 2, Unknown = 1, Flagged = 0
    const scoreA = a.spam_status === 'Clean' ? 3 : a.spam_status === 'At Risk' ? 2 : 1;
    const scoreB = b.spam_status === 'Clean' ? 3 : b.spam_status === 'At Risk' ? 2 : 1;

    if (scoreA !== scoreB) {
      return scoreB - scoreA; // Higher status score first
    }

    return b.spam_score - a.spam_score; // Then by spam score
  });

  return sortedByStatus[0]?.phone_number || '';
}
