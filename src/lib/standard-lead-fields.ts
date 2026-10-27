import { supabase } from "@/integrations/supabase/client";
import { normalizeFieldName } from "@/lib/import-field-matching";

/**
 * AgentFlow standard lead fields (migration 20261028120100). Mirrors private.standard_lead_field_catalog() — a parity
 * test pins the two. They are ordinary agency-wide custom fields: values live in leads.custom_fields under the field
 * name, Text type so ZIP codes keep their leading zeros. An agency's existing "Zip Code" IS its standard ZIP field
 * (names match through normalizeFieldName), and it is never renamed.
 */
export const STANDARD_LEAD_FIELDS = [
  { key: "address", name: "Address", type: "Text" },
  { key: "city", name: "City", type: "Text" },
  { key: "zip_code", name: "ZIP Code", type: "Text" },
] as const;
export type StandardLeadFieldKey = (typeof STANDARD_LEAD_FIELDS)[number]["key"];
export const STANDARD_LEAD_FIELD_NAMES: readonly string[] = STANDARD_LEAD_FIELDS.map((f) => f.name);

/** The standard field a name refers to (normalized name only; never a fuzzy match). */
export function standardFieldForName(name: string) {
  const key = normalizeFieldName(name);
  return STANDARD_LEAD_FIELDS.find((f) => normalizeFieldName(f.name) === key) ?? null;
}

export type StandardFieldState = "created" | "would_create" | "exists_agency" | "exists_personal";
export interface StandardFieldsStatus {
  status: "complete" | "incomplete";
  fields: { key: StandardLeadFieldKey; name: string; state: StandardFieldState }[];
  last_attempt: { status: "complete" | "incomplete" | "failed"; last_error: string | null; attempts: number; at: string } | null;
}
export interface AgencyWideImpact {
  field: { id: string; name: string; type: string; applies_to: string[] };
  owner: { id: string; name: string };
  other_personal_rows: number;
  leads_with_key: number;
  snapshot: string;
  applied: boolean;
}

/** Server refusals → concise copy. `unavailable` = the database functions are not deployed (feature not released). */
export const STANDARD_FIELD_MESSAGES: Record<string, string> = {
  not_permitted: "Only an Admin can do this for your agency.",
  not_found: "That field no longer exists.",
  not_personal: "This field is already shared with your agency.",
  inactive: "Activate the field first.",
  agency_field_exists: "Your agency already has a shared field with this name.",
  field_changed: "This field changed after you reviewed it. Review it again.",
  unavailable: "This isn't available yet.",
  failed: "Something went wrong. Try again.",
};

export class StandardFieldsError extends Error {
  constructor(public code: string) { super(STANDARD_FIELD_MESSAGES[code] ?? STANDARD_FIELD_MESSAGES.failed); }
}

function codeOf(error: { message?: string; code?: string } | null): string {
  if (!error) return "failed";
  // PostgREST PGRST202 / Postgres 42883: the function does not exist (migration not applied).
  if (error.code === "PGRST202" || error.code === "42883") return "unavailable";
  const known = Object.keys(STANDARD_FIELD_MESSAGES).find((k) => error.message?.startsWith(k));
  if (known) return known;
  if (error.code === "42501") return "not_permitted";
  return "failed";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw new StandardFieldsError(codeOf(error));
  return data as T;
}

/** Live state (dry run, default) or the idempotent retry that creates the missing agency-wide standard fields. */
export const provisionStandardLeadFields = (dryRun: boolean) =>
  rpc<StandardFieldsStatus>("provision_standard_lead_fields", { p_dry_run: dryRun });

/** Personal → agency-wide. Dry run returns the impact and the snapshot the apply must present. */
export const makeCustomFieldAgencyWide = (fieldId: string, snapshot: string | null, dryRun: boolean) =>
  rpc<AgencyWideImpact>("custom_field_make_agency_wide", { p_field: fieldId, p_snapshot: snapshot, p_dry_run: dryRun });
