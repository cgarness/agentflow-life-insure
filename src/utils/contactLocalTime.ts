export const STATE_TIMEZONES: Record<string, string> = {
  AL: 'America/Chicago', ALABAMA: 'America/Chicago',
  AK: 'America/Anchorage', ALASKA: 'America/Anchorage',
  AZ: 'America/Phoenix', ARIZONA: 'America/Phoenix',
  AR: 'America/Chicago', ARKANSAS: 'America/Chicago',
  CA: 'America/Los_Angeles', CALIFORNIA: 'America/Los_Angeles',
  CO: 'America/Denver', COLORADO: 'America/Denver',
  CT: 'America/New_York', CONNECTICUT: 'America/New_York',
  DE: 'America/New_York', DELAWARE: 'America/New_York',
  FL: 'America/New_York', FLORIDA: 'America/New_York',
  GA: 'America/New_York', GEORGIA: 'America/New_York',
  HI: 'Pacific/Honolulu', HAWAII: 'Pacific/Honolulu',
  ID: 'America/Denver', IDAHO: 'America/Denver',
  IL: 'America/Chicago', ILLINOIS: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis', INDIANA: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago', IOWA: 'America/Chicago',
  KS: 'America/Chicago', KANSAS: 'America/Chicago',
  KY: 'America/New_York', KENTUCKY: 'America/New_York',
  LA: 'America/Chicago', LOUISIANA: 'America/Chicago',
  ME: 'America/New_York', MAINE: 'America/New_York',
  MD: 'America/New_York', MARYLAND: 'America/New_York',
  MA: 'America/New_York', MASSACHUSETTS: 'America/New_York',
  MI: 'America/Detroit', MICHIGAN: 'America/Detroit',
  MN: 'America/Chicago', MINNESOTA: 'America/Chicago',
  MS: 'America/Chicago', MISSISSIPPI: 'America/Chicago',
  MO: 'America/Chicago', MISSOURI: 'America/Chicago',
  MT: 'America/Denver', MONTANA: 'America/Denver',
  NE: 'America/Chicago', NEBRASKA: 'America/Chicago',
  NV: 'America/Los_Angeles', NEVADA: 'America/Los_Angeles',
  NH: 'America/New_York', 'NEW HAMPSHIRE': 'America/New_York',
  NJ: 'America/New_York', 'NEW JERSEY': 'America/New_York',
  NM: 'America/Denver', 'NEW MEXICO': 'America/Denver',
  NY: 'America/New_York', 'NEW YORK': 'America/New_York',
  NC: 'America/New_York', 'NORTH CAROLINA': 'America/New_York',
  ND: 'America/Chicago', 'NORTH DAKOTA': 'America/Chicago',
  OH: 'America/New_York', OHIO: 'America/New_York',
  OK: 'America/Chicago', OKLAHOMA: 'America/Chicago',
  OR: 'America/Los_Angeles', OREGON: 'America/Los_Angeles',
  PA: 'America/New_York', PENNSYLVANIA: 'America/New_York',
  RI: 'America/New_York', 'RHODE ISLAND': 'America/New_York',
  SC: 'America/New_York', 'SOUTH CAROLINA': 'America/New_York',
  SD: 'America/Chicago', 'SOUTH DAKOTA': 'America/Chicago',
  TN: 'America/Chicago', TENNESSEE: 'America/Chicago',
  TX: 'America/Chicago', TEXAS: 'America/Chicago',
  UT: 'America/Denver', UTAH: 'America/Denver',
  VT: 'America/New_York', VERMONT: 'America/New_York',
  VA: 'America/New_York', VIRGINIA: 'America/New_York',
  WA: 'America/Los_Angeles', WASHINGTON: 'America/Los_Angeles',
  WV: 'America/New_York', 'WEST VIRGINIA': 'America/New_York',
  WI: 'America/Chicago', WISCONSIN: 'America/Chicago',
  WY: 'America/Denver', WYOMING: 'America/Denver',
  DC: 'America/New_York', 'DISTRICT OF COLUMBIA': 'America/New_York',
};

export function getContactLocalTime(state: string): string {
  const tz = STATE_TIMEZONES[state?.toUpperCase()];
  if (!tz) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date());
}

export function getContactTimezone(state: string): string {
  const tz = STATE_TIMEZONES[state?.toUpperCase()];
  if (!tz) return '';
  const abbr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'short',
  }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? '';
  return abbr;
}

export function isGoodTimeToCall(state: string): 'good' | 'early' | 'late' | 'unknown' {
  const tz = STATE_TIMEZONES[state?.toUpperCase()];
  if (!tz) return 'unknown';
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
    10
  );
  if (hour >= 9 && hour < 20) return 'good';
  if (hour < 9) return 'early';
  return 'late';
}
