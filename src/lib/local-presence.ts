import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/utils/phoneUtils";

export interface PhoneNumberEntry {
  id: string;
  phone_number: string;
  area_code: string | null;
  is_default: boolean | null;
  status: string | null;
}

export interface PhoneNumberCache {
  areaCodeMap: Record<string, string>; // area_code -> phone_number
  defaultNumber: string | null;
  allNumbers: PhoneNumberEntry[];
}

/** Fetch all active phone numbers and build the cache */
export async function loadPhoneNumbers(): Promise<PhoneNumberCache> {
  const { data, error } = await supabase
    .from("phone_numbers")
    .select("id, phone_number, area_code, is_default, status")
    .eq("status", "active");

  const numbers = (data as PhoneNumberEntry[]) || [];
  const areaCodeMap: Record<string, string> = {};
  let defaultNumber: string | null = null;

  for (const n of numbers) {
    if (n.area_code) {
      areaCodeMap[n.area_code] = n.phone_number;
    }
    if (n.is_default) {
      defaultNumber = n.phone_number;
    }
  }

  // If no explicit default, derive from first number
  if (!defaultNumber && numbers.length > 0) {
    defaultNumber = numbers[0].phone_number;
  }

  return { areaCodeMap, defaultNumber, allNumbers: numbers };
}

/** Extract area code from a phone number string */
export function extractAreaCode(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // If starts with "1" and is 11 digits, strip leading 1
  const normalized = digits.startsWith("1") && digits.length === 11
    ? digits.slice(1)
    : digits;
  return normalized.slice(0, 3);
}

export interface CallerIdResult {
  callerNumber: string;
  matchType: "local" | "default" | "none";
  matchedAreaCode: string | null;
}

/** Pick the best caller ID for a destination phone number */
export function pickCallerId(
  destinationPhone: string,
  cache: PhoneNumberCache
): CallerIdResult {
  const areaCode = extractAreaCode(destinationPhone);

  if (areaCode && cache.areaCodeMap[areaCode]) {
    return {
      callerNumber: cache.areaCodeMap[areaCode],
      matchType: "local",
      matchedAreaCode: areaCode,
    };
  }

  if (cache.defaultNumber) {
    return {
      callerNumber: cache.defaultNumber,
      matchType: "default",
      matchedAreaCode: null,
    };
  }

  return {
    callerNumber: "",
    matchType: "none",
    matchedAreaCode: null,
  };
}

/** Format a phone number for display: (XXX) XXX-XXXX */
export function formatPhoneDisplay(phone: string): string {
  return formatPhoneNumber(phone);
}
