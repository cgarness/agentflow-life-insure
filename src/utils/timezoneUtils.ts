import { toZonedTime, format } from "date-fns-tz";

// Map each 2-letter state abbreviation to its primary (majority) IANA timezone
// and include additional timezones for states that split.
export const STATE_TIMEZONES: Record<string, string[]> = {
  AL: ["America/Chicago"],
  AK: ["America/Anchorage"],
  AZ: ["America/Phoenix"],
  AR: ["America/Chicago"],
  CA: ["America/Los_Angeles"],
  CO: ["America/Denver"],
  CT: ["America/New_York"],
  DE: ["America/New_York"],
  DC: ["America/New_York"],
  FL: ["America/New_York", "America/Chicago"], // Split: Eastern/Central
  GA: ["America/New_York"],
  HI: ["Pacific/Honolulu"],
  ID: ["America/Boise", "America/Los_Angeles"], // Split: Mountain/Pacific
  IL: ["America/Chicago"],
  IN: ["America/Indiana/Indianapolis", "America/Chicago"], // Split: Eastern/Central
  IA: ["America/Chicago"],
  KS: ["America/Chicago", "America/Denver"], // Split: Central/Mountain
  KY: ["America/New_York", "America/Chicago"], // Split: Eastern/Central
  LA: ["America/Chicago"],
  ME: ["America/New_York"],
  MD: ["America/New_York"],
  MA: ["America/New_York"],
  MI: ["America/Detroit", "America/Chicago"], // Split: Eastern/Central
  MN: ["America/Chicago"],
  MS: ["America/Chicago"],
  MO: ["America/Chicago"],
  MT: ["America/Denver"],
  NE: ["America/Chicago", "America/Denver"], // Split: Central/Mountain
  NV: ["America/Los_Angeles"],
  NH: ["America/New_York"],
  NJ: ["America/New_York"],
  NM: ["America/Denver"],
  NY: ["America/New_York"],
  NC: ["America/New_York"],
  ND: ["America/Chicago", "America/Denver"], // Split: Central/Mountain
  OH: ["America/New_York"],
  OK: ["America/Chicago"],
  OR: ["America/Los_Angeles", "America/Boise"], // Split: Pacific/Mountain
  PA: ["America/New_York"],
  RI: ["America/New_York"],
  SC: ["America/New_York"],
  SD: ["America/Chicago", "America/Denver"], // Split: Central/Mountain
  TN: ["America/Chicago", "America/New_York"], // Split: Central/Eastern
  TX: ["America/Chicago", "America/Denver"], // Split: Central/Mountain
  UT: ["America/Denver"],
  VT: ["America/New_York"],
  VA: ["America/New_York"],
  WA: ["America/Los_Angeles"],
  WV: ["America/New_York"],
  WI: ["America/Chicago"],
  WY: ["America/Denver"],
};

// Map each 2-letter state to its PRIMARY (majority) timezone for grouping in filters
export const PRIMARY_TIMEZONE_MAP: Record<string, string> = {
  AL: "Central", AK: "Alaska", AZ: "Mountain", AR: "Central", CA: "Pacific",
  CO: "Mountain", CT: "Eastern", DE: "Eastern", DC: "Eastern", FL: "Eastern",
  GA: "Eastern", HI: "Hawaii", ID: "Mountain", IL: "Central", IN: "Eastern",
  IA: "Central", KS: "Central", KY: "Eastern", LA: "Central", ME: "Eastern",
  MD: "Eastern", MA: "Eastern", MI: "Eastern", MN: "Central", MS: "Central",
  MO: "Central", MT: "Mountain", NE: "Central", NV: "Pacific", NH: "Eastern",
  NJ: "Eastern", NM: "Mountain", NY: "Eastern", NC: "Eastern", ND: "Central",
  OH: "Eastern", OK: "Central", OR: "Pacific", PA: "Eastern", RI: "Eastern",
  SC: "Eastern", SD: "Central", TN: "Central", TX: "Central", UT: "Mountain",
  VT: "Eastern", VA: "Eastern", WA: "Pacific", WV: "Eastern", WI: "Central",
  WY: "Mountain",
};

export const TIMEZONE_GROUPS = [
  "Eastern",
  "Central",
  "Mountain",
  "Pacific",
  "Alaska",
  "Hawaii",
];

/**
 * Checks if the current time is between 8:00 AM and 9:00 PM for ALL timezones a state occupies.
 * Implements 'Strict Safety' logic for TCPA compliance.
 */
export function isCallableNow(stateAbbr: string | null | undefined): boolean {
  if (!stateAbbr) return false;
  
  const zones = STATE_TIMEZONES[stateAbbr.toUpperCase()];
  if (!zones || zones.length === 0) return false;

  const now = new Date();

  // A lead is only 'Callable Now' if it is between 8:00 AM and 9:00 PM in BOTH/ALL timezones the state occupies.
  return zones.every(zone => {
    const zonedTime = toZonedTime(now, zone);
    const hour = zonedTime.getHours();
    
    // TCPA Window: 8:00 AM to 9:00 PM (inclusive of 8:00:00, exclusive of 21:00:00)
    return hour >= 8 && hour < 21;
  });
}

/**
 * Gets the primary timezone group for a state.
 */
export function getPrimaryTimezoneGroup(stateAbbr: string | null | undefined): string | null {
  if (!stateAbbr) return null;
  return PRIMARY_TIMEZONE_MAP[stateAbbr.toUpperCase()] || null;
}
