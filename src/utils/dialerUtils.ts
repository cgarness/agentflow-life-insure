/** Maps US state abbreviations to their primary IANA timezone. */
export const STATE_TO_TZ: Record<string, string> = {
  // Eastern
  CT: 'America/New_York', DE: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', IN: 'America/New_York', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/New_York',
  NH: 'America/New_York', NJ: 'America/New_York', NY: 'America/New_York',
  NC: 'America/New_York', OH: 'America/New_York', PA: 'America/New_York',
  RI: 'America/New_York', SC: 'America/New_York', VT: 'America/New_York',
  VA: 'America/New_York', WV: 'America/New_York',
  // Central
  AL: 'America/Chicago', AR: 'America/Chicago', IL: 'America/Chicago',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/Chicago',
  LA: 'America/Chicago', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', NE: 'America/Chicago', ND: 'America/Chicago',
  OK: 'America/Chicago', SD: 'America/Chicago', TN: 'America/Chicago',
  TX: 'America/Chicago', WI: 'America/Chicago',
  // Mountain
  AZ: 'America/Phoenix', CO: 'America/Denver', ID: 'America/Denver',
  MT: 'America/Denver', NM: 'America/Denver', UT: 'America/Denver',
  WY: 'America/Denver',
  // Pacific
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles',
  WA: 'America/Los_Angeles',
  // Non-contiguous
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
};

/**
 * Returns true if the current local time in the lead's state is within the
 * campaign's configured calling hours window.
 */
export function checkCallingHours(
  leadState: string | undefined | null,
  callingHoursStart: string = '09:00',
  callingHoursEnd: string = '21:00'
): boolean {
  if (!callingHoursStart || !callingHoursEnd) return true;
  
  const stateKey = leadState?.toUpperCase().trim() ?? 'UNKNOWN';
  const tz = STATE_TO_TZ[stateKey] ?? 'America/New_York';
  
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  
  const rawHour = parts.find(p => p.type === 'hour')?.value ?? '00';
  const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
  
  // '24' can occur at midnight in some locales — normalize to '00'
  const h = parseInt(rawHour, 10) % 24;
  const current = `${String(h).padStart(2, '0')}:${minute.padStart(2, '0')}`;
  
  return current >= callingHoursStart && current < callingHoursEnd;
}

export function fmtDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fmtSessionDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function getStatusColorStyle(color: string) {
  return {
    backgroundColor: `${color}15`,
    color: color,
    borderColor: `${color}30`,
  };
}

export function normalizeStatusDisplay(status: string) {
  if (!status) return "NEW";
  const s = status.toUpperCase();
  if (s === "NEW" || s === "NEW LEAD") return "NEW";
  if (s === "NO ANSWER") return "NO ANSWER";
  if (s === "BUSY") return "BUSY";
  if (s === "WRONG NUMBER") return "WRONG #";
  if (s === "DISCONNECTED") return "DISC.";
  if (s === "DNC") return "DNC";
  return s;
}
