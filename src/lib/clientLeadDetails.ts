import { z } from "zod";
import type { Client, LeadConversionHistory } from "@/lib/types";

/**
 * Lead details preserved on a converted client (migration 20261021200000).
 *
 * - `clients.lead_conversion` is protected history written only by the conversion function; the browser parses it
 *   tolerantly (anything unreadable hides the panel, never breaks the profile) and never sends it back.
 * - The four person fields are ordinary editable columns. Only fields the agent actually changed are validated, so a
 *   legacy value (an odd DOB format, an out-of-range age from an import) never blocks an unrelated save.
 */

const text = z.string().nullable().optional().transform((v) => (v && v.trim() ? v : null));

const leadConversionSchema = z.object({
  version: z.literal(1),
  lead_id: z.string().min(1),
  converted_at: text,
  converted_by: text,
  lead_status: text,
  lead_source: text,
  lead_created_at: text,
  lead_last_contacted_at: text,
  lead_notes: text,
  legacy_conversion_notes: text,
  preserved_custom_fields: z.unknown().optional(),
}).passthrough();

/** The panel's view of the stored history, or undefined when it is absent, malformed or from an unknown version. */
export function parseLeadConversion(raw: unknown): LeadConversionHistory | undefined {
  const parsed = leadConversionSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const h = parsed.data;
  return {
    version: 1,
    leadId: h.lead_id,
    convertedAt: h.converted_at,
    convertedBy: h.converted_by,
    leadStatus: h.lead_status,
    leadSource: h.lead_source,
    leadCreatedAt: h.lead_created_at,
    leadLastContactedAt: h.lead_last_contacted_at,
    leadNotes: h.lead_notes,
    legacyConversionNotes: h.legacy_conversion_notes,
    hasPreservedCustomFields: h.preserved_custom_fields !== undefined && h.preserved_custom_fields !== null,
  };
}

/** Text (or nothing) is editable like a lead's; a structured stored value is shown read-only and never re-sent. */
export function isEditableSpouseInfo(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

/** Read-only display of any stored spouse value ("name: Pat · age: 60" for an object). */
export function formatSpouseInfo(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(formatSpouseInfo).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" · ");
  }
  return String(value);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** A stored DOB the native date picker cannot show (e.g. "03/04/1960") is edited as plain text so it is never blanked. */
export function clientDobEditor(value: unknown): "date" | "text" {
  return typeof value === "string" && value.trim() !== "" && !isRealIsoDate(value.trim()) ? "text" : "date";
}

/** Keep a stored value selectable even when it is not one of today's options (legacy lead data). */
export function optionsWithCurrent(options: readonly string[], current: unknown): string[] {
  const value = typeof current === "string" ? current : "";
  return value.trim() && !options.includes(value) ? [...options, value] : [...options];
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export const clientPersonFieldsSchema = z.object({
  dateOfBirth: z.unknown().refine((v) => {
    if (blank(v)) return true;
    if (typeof v !== "string") return false;
    const s = v.trim();
    return isRealIsoDate(s) && s <= new Date().toISOString().slice(0, 10);
  }, "Date of birth must be a real date (YYYY-MM-DD) that is not in the future."),
  age: z.unknown().refine((v) => blank(v) || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 130)
    || (typeof v === "string" && /^\d{1,3}$/.test(v.trim()) && Number(v) <= 130), "Age must be a whole number from 0 to 130."),
  bestTimeToCall: z.unknown().refine((v) => blank(v) || (typeof v === "string" && v.length <= 100),
    "Best time to call must be 100 characters or fewer."),
  spouseInfo: z.unknown().refine((v) => blank(v) || (typeof v === "string" && v.length <= 500),
    "Spouse info must be 500 characters or fewer."),
});

type PersonKey = keyof z.infer<typeof clientPersonFieldsSchema>;
const PERSON_KEYS: PersonKey[] = ["dateOfBirth", "age", "bestTimeToCall", "spouseInfo"];

/** Unchanged = exactly the saved value (structured values compared by content); empty, null and undefined match. */
function sameValue(a: unknown, b: unknown): boolean {
  if (blank(a) && blank(b)) return true;
  if (a === b) return true;
  return typeof a === "object" && a !== null && typeof b === "object" && b !== null && JSON.stringify(a) === JSON.stringify(b);
}

/** The person fields the agent changed from the saved contact. Validation and sending use this same set. */
export function changedClientPersonFields(original: Partial<Client>, edited: Partial<Client>): PersonKey[] {
  return PERSON_KEYS.filter((k) => !sameValue(original[k], edited[k]));
}

/**
 * The edit to send: person fields the agent did not change are left out entirely, so an unrelated edit can never trim,
 * normalize, clear or otherwise rewrite a stored DOB, age, best time to call or spouse value (legacy formats included).
 */
export function omitUnchangedPersonFields<T extends Partial<Client>>(original: Partial<Client>, edited: T): T {
  const changed = new Set(changedClientPersonFields(original, edited));
  const out = { ...edited };
  for (const k of PERSON_KEYS) if (!changed.has(k)) delete out[k];
  return out;
}

/** Messages for the person fields the agent changed from the saved contact; [] when the save may proceed. */
export function validateChangedClientPersonFields(original: Partial<Client>, edited: Partial<Client>): string[] {
  const changed = changedClientPersonFields(original, edited);
  if (changed.length === 0) return [];
  const result = clientPersonFieldsSchema.safeParse(Object.fromEntries(PERSON_KEYS.map((k) => [k, edited[k]])));
  if (result.success) return [];
  return result.error.issues.filter((i) => changed.includes(i.path[0] as PersonKey)).map((i) => i.message);
}
