export interface AppointmentTypeRecord {
  id: string;
  organizationId: string;
  name: string;
  color: string;
  durationMinutes: number;
  sortOrder: number;
  isDefault: boolean;
  isLocked: boolean;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export const KNOWN_DEFAULT_APPOINTMENT_TYPE_NAMES = [
  "Sales Call",
  "Follow Up",
  "Recruit Interview",
  "Policy Review",
  "Policy Anniversary",
  "Other",
] as const;

export type KnownAppointmentType = typeof KNOWN_DEFAULT_APPOINTMENT_TYPE_NAMES[number];

export const KNOWN_APPOINTMENT_TYPE_COLORS: Record<KnownAppointmentType, string> = {
  "Sales Call": "#3B82F6",
  "Follow Up": "#F97316",
  "Recruit Interview": "#A855F7",
  "Policy Review": "#22C55E",
  "Policy Anniversary": "#EC4899",
  "Other": "#64748B",
};

export const KNOWN_APPOINTMENT_TYPE_DURATIONS: Record<KnownAppointmentType, number> = {
  "Sales Call": 30,
  "Follow Up": 20,
  "Recruit Interview": 45,
  "Policy Review": 60,
  "Policy Anniversary": 60,
  "Other": 30,
};

export const KNOWN_APPOINTMENT_TYPE_SUBJECT_LEAD: Record<KnownAppointmentType, string> = {
  "Sales Call": "Sales call",
  "Follow Up": "Follow up",
  "Recruit Interview": "Recruit interview",
  "Policy Review": "Policy review",
  "Policy Anniversary": "Policy anniversary",
  "Other": "Meeting",
};

export const FALLBACK_APPOINTMENT_TYPE_NAME: KnownAppointmentType = "Other";
export const FALLBACK_APPOINTMENT_TYPE_COLOR = "#64748B";
export const FALLBACK_APPOINTMENT_TYPE_DURATION = 30;
export const FALLBACK_APPOINTMENT_TYPE_SUBJECT_LEAD = "Meeting";

function isKnown(name: string): name is KnownAppointmentType {
  return (KNOWN_DEFAULT_APPOINTMENT_TYPE_NAMES as readonly string[]).includes(name);
}

function findByName(name: string, types: AppointmentTypeRecord[]): AppointmentTypeRecord | undefined {
  if (!name) return undefined;
  const target = name.trim().toLowerCase();
  return types.find((t) => t.name.trim().toLowerCase() === target);
}

export function normalizeAppointmentTypeName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : FALLBACK_APPOINTMENT_TYPE_NAME;
}

export function getAppointmentTypeColor(name: string | null | undefined, types: AppointmentTypeRecord[]): string {
  const normalized = normalizeAppointmentTypeName(name);
  const hit = findByName(normalized, types);
  if (hit) return hit.color;
  if (isKnown(normalized)) return KNOWN_APPOINTMENT_TYPE_COLORS[normalized];
  return FALLBACK_APPOINTMENT_TYPE_COLOR;
}

export function getAppointmentTypeDuration(name: string | null | undefined, types: AppointmentTypeRecord[]): number {
  const normalized = normalizeAppointmentTypeName(name);
  const hit = findByName(normalized, types);
  if (hit) return hit.durationMinutes;
  if (isKnown(normalized)) return KNOWN_APPOINTMENT_TYPE_DURATIONS[normalized];
  return FALLBACK_APPOINTMENT_TYPE_DURATION;
}

export function getAppointmentTypeSubjectLead(name: string | null | undefined, types: AppointmentTypeRecord[]): string {
  const normalized = normalizeAppointmentTypeName(name);
  if (isKnown(normalized)) return KNOWN_APPOINTMENT_TYPE_SUBJECT_LEAD[normalized];
  const hit = findByName(normalized, types);
  if (hit) return hit.name;
  return FALLBACK_APPOINTMENT_TYPE_SUBJECT_LEAD;
}

export function buildAutoSubject(typeName: string, displayName: string, types: AppointmentTypeRecord[]): string {
  const lead = getAppointmentTypeSubjectLead(typeName, types);
  const trimmed = displayName.trim();
  if (!trimmed) return "";
  const first = trimmed.split(/\s+/)[0];
  return `${lead} with ${first}`;
}

export function pickDefaultAppointmentTypeName(types: AppointmentTypeRecord[]): string {
  const active = types.filter((t) => t.isActive);
  const salesCall = active.find((t) => t.name.trim().toLowerCase() === "sales call");
  if (salesCall) return salesCall.name;
  if (active.length > 0) return active[0].name;
  return FALLBACK_APPOINTMENT_TYPE_NAME;
}
