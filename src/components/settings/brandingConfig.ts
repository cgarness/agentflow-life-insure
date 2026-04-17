export interface BrandingState {
  companyName: string;
  logoUrl: string | null;
  logoName: string | null;
  faviconUrl: string | null;
  faviconName: string | null;
  timezone: string;
  timeFormat: string;
  companyPhone: string;
  websiteUrl: string;
}

export const SUPER_ADMIN_EMAIL = "cgarness.ffl@gmail.com";

export const BRANDING_DEFAULTS: BrandingState = {
  companyName: "",
  logoUrl: null,
  logoName: null,
  faviconUrl: null,
  faviconName: null,
  timezone: "America/Chicago",
  timeFormat: "12",
  companyPhone: "",
  websiteUrl: "",
};

export const TIMEZONES = [
  {
    group: "US & Canada", options: [
      { value: "America/New_York", label: "America/New_York (Eastern Time)" },
      { value: "America/Chicago", label: "America/Chicago (Central Time)" },
      { value: "America/Denver", label: "America/Denver (Mountain Time)" },
      { value: "America/Los_Angeles", label: "America/Los_Angeles (Pacific Time)" },
      { value: "America/Anchorage", label: "America/Anchorage (Alaska Time)" },
      { value: "Pacific/Honolulu", label: "Pacific/Honolulu (Hawaii Time)" },
    ],
  },
  {
    group: "Other", options: [
      { value: "Europe/London", label: "Europe/London (GMT)" },
      { value: "Europe/Paris", label: "Europe/Paris (CET)" },
      { value: "Europe/Berlin", label: "Europe/Berlin (CET)" },
      { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
      { value: "Asia/Shanghai", label: "Asia/Shanghai (CST)" },
      { value: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
      { value: "Australia/Sydney", label: "Australia/Sydney (AEST)" },
      { value: "America/Sao_Paulo", label: "America/Sao_Paulo (BRT)" },
    ],
  },
];

export const TIME_FORMATS = [
  { value: "12", label: "12-Hour (e.g. 2:30 PM)" },
  { value: "24", label: "24-Hour (e.g. 14:30)" },
];

export const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};
