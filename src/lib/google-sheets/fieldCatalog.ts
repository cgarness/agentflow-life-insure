import { buildImportFieldOptions, normalizeFieldName } from "@/lib/import-field-matching";
import { STANDARD_LEAD_FIELDS, standardFieldForName, type StandardLeadFieldKey } from "@/lib/standard-lead-fields";
import { STANDARD_FIELDS, type CatalogField, type CustomFieldType, type SheetsContext } from "./schema";

/**
 * Mapping v2 field catalog: every field the owner may map, grouped and searchable. Nothing is dropped silently — a
 * field that cannot be mapped is listed as unavailable with its reason. Visibility is the server's (the catalog is
 * google_sheets_context: agency-wide, own personal, all for an Admin); this module only organises it.
 */
export type CatalogGroup = "required" | "contact" | "details" | "address" | "agency" | "mine" | "others" | "unavailable";
export const GROUP_LABELS: Record<CatalogGroup, string> = {
  required: "Required", contact: "Contact", details: "Details", address: "Address", agency: "Agency fields",
  mine: "My fields", others: "Other users' personal fields", unavailable: "Unavailable",
};
export interface CatalogOption {
  value: string;               // mapping target: standard key or custom:<uuid>
  label: string;
  group: CatalogGroup;
  type?: CustomFieldType | null;
  disabled?: boolean;
  reason?: string;
  keywords: string[];
  /** Address group: the standard field this option stands for. */
  standardKey?: StandardLeadFieldKey;
}
/** An Address-group standard field the agency does not have as a visible field yet. */
export interface MissingStandardField { key: StandardLeadFieldKey; name: string }
export interface FieldCatalog { options: CatalogOption[]; missingStandard: MissingStandardField[]; byValue: Map<string, CatalogOption> }

const STANDARD_GROUP: Record<string, CatalogGroup> = {
  first_name: "required", last_name: "required", full_name: "required", phone: "required",
  email: "contact", state: "contact", best_time_to_call: "contact",
  age: "details", date_of_birth: "details", lead_source: "details", notes: "details",
};

const toMappable = (f: CatalogField) => ({ id: f.id, name: f.name, createdBy: f.created_by, createdAt: f.created_at });

/** The type every visible row of a logical name agrees on, or null (the server keeps such values exactly). */
function logicalType(fields: CatalogField[], name: string): CustomFieldType | null {
  const rows = fields.filter((f) => normalizeFieldName(f.name) === normalizeFieldName(name));
  const t = rows[0]?.type ?? null;
  return rows.every((r) => (r.type ?? null) === t) ? t : null;
}

export function buildFieldCatalog(context: Pick<SheetsContext, "custom_fields">, viewerId: string | null): FieldCatalog {
  const fields = context.custom_fields ?? [];
  const options: CatalogOption[] = STANDARD_FIELDS.map((f) => ({
    value: f.key, label: f.label, group: STANDARD_GROUP[f.key], keywords: [f.label.toLowerCase(), f.key.replace(/_/g, " ")],
  }));
  const logical = buildImportFieldOptions(fields.map(toMappable)).filter((o) => o.kind === "custom" && o.customFieldId);
  const covered = new Set<StandardLeadFieldKey>();
  for (const o of logical) {
    const rep = fields.find((f) => f.id === o.customFieldId)!;
    const std = standardFieldForName(o.canonicalName);
    const reserved = ["full name", "tags", "additional_policies", "__agentflow"].includes(normalizeFieldName(o.canonicalName));
    const base = { value: `custom:${o.customFieldId}`, label: o.canonicalName, type: logicalType(fields, o.canonicalName),
                   keywords: [o.canonicalName.toLowerCase()] };
    if (o.ambiguous || reserved) {
      options.push({ ...base, group: "unavailable", disabled: true,
        reason: reserved ? "Reserved by AgentFlow" : "Same name as a built-in field — rename it in Settings to use it" });
      continue;
    }
    const agency = rep.scope ? rep.scope === "agency" : rep.created_by === null;
    const own = rep.own ?? (viewerId !== null && rep.created_by === viewerId);
    if (std && !covered.has(std.key)) {
      covered.add(std.key);
      options.push({ ...base, group: "address", standardKey: std.key,
        reason: agency ? undefined : own ? "Personal field — only you can use it until an Admin makes it agency-wide"
          : "Another user's personal field" });
      continue;
    }
    options.push({ ...base, group: agency ? "agency" : own ? "mine" : "others" });
  }
  const missingStandard = STANDARD_LEAD_FIELDS.filter((f) => !covered.has(f.key)).map((f) => ({ key: f.key, name: f.name }));
  return { options, missingStandard, byValue: new Map(options.map((o) => [o.value, o])) };
}

/** Case-insensitive search over labels and keywords (spaces and punctuation ignored). */
export function searchCatalog(options: readonly CatalogOption[], query: string): CatalogOption[] {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!q) return [...options];
  return options.filter((o) => [o.label, ...o.keywords].some((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "").includes(q)));
}

/** Required custom fields the mapping leaves out (a non-blocking warning; Sheets never blocks a source for them). */
export function unmappedRequiredFields(context: Pick<SheetsContext, "custom_fields">, targets: readonly string[]): string[] {
  const mapped = new Set(targets.filter((t) => t.startsWith("custom:")).map((t) => t.slice(7)));
  const mappedNames = new Set((context.custom_fields ?? []).filter((f) => mapped.has(f.id)).map((f) => normalizeFieldName(f.name)));
  return [...new Set((context.custom_fields ?? []).filter((f) => f.required && !mappedNames.has(normalizeFieldName(f.name))).map((f) => f.name))];
}
