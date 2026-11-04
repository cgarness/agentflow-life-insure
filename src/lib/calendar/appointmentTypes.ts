import { z } from "zod";

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
  /** Business category (Reports V2 PKG-D, D4 §3.2); only `sales` counts as a Sales Appointment. */
  businessCategory?: AppointmentBusinessCategory;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Appointment-type business categories (D4 §3.2). `unclassified` is the default until a category is chosen. */
export const APPOINTMENT_BUSINESS_CATEGORIES = [
  "sales", "follow_up", "callback", "recruiting", "review", "service", "other", "unclassified",
] as const;
export type AppointmentBusinessCategory = typeof APPOINTMENT_BUSINESS_CATEGORIES[number];
/** What Settings may choose for a custom type (callback is booking-kind only; unclassified is the default). */
export const SELECTABLE_APPOINTMENT_BUSINESS_CATEGORIES = ["sales", "follow_up", "recruiting", "review", "service", "other"] as const;
export const APPOINTMENT_BUSINESS_CATEGORY_LABELS: Record<AppointmentBusinessCategory, string> = {
  sales: "Sales appointment", follow_up: "Follow up", callback: "Callback", recruiting: "Recruiting",
  review: "Policy review", service: "Service", other: "Other", unclassified: "Needs category",
};
export const appointmentBusinessCategorySchema = z.enum(APPOINTMENT_BUSINESS_CATEGORIES);
export const selectableAppointmentBusinessCategorySchema = z.enum(SELECTABLE_APPOINTMENT_BUSINESS_CATEGORIES);
/** A row read before the PKG-D column exists (or with an unknown value) reads as unclassified. */
export function parseAppointmentBusinessCategory(raw: unknown): AppointmentBusinessCategory {
  const parsed = appointmentBusinessCategorySchema.safeParse(raw);
  return parsed.success ? parsed.data : "unclassified";
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
