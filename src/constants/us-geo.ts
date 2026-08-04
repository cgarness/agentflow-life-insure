/** US state names (full) — shared by onboarding and profile flows */
export const US_STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
  "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;

/**
 * USPS codes in the same alphabetical-by-name order as `US_STATE_NAMES`, so the
 * two arrays zip positionally into the lookup maps below.
 */
export const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

/** "CA" → "California" */
export const US_STATE_NAME_BY_CODE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(US_STATE_CODES.map((code, i) => [code, US_STATE_NAMES[i]])),
);

/** "California" → "CA" */
export const US_STATE_CODE_BY_NAME: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(US_STATE_CODES.map((code, i) => [US_STATE_NAMES[i], code])),
);

export const US_TIMEZONES = [
  "Eastern Time (US & Canada)",
  "Central Time (US & Canada)",
  "Mountain Time (US & Canada)",
  "Pacific Time (US & Canada)",
  "Alaska Time",
  "Hawaii Time",
] as const;

export const COMMISSION_LEVELS = ["Street", "105%", "110%", "115%", "120%", "125%"] as const;
