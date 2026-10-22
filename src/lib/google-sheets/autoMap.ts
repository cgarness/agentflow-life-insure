import { buildImportFieldOptions, matchCsvHeaderToField, normalizeFieldName } from "@/lib/import-field-matching";
import { STANDARD_FIELDS, type SheetsContext } from "./schema";

const LABEL_TO_KEY = new Map<string, string>(STANDARD_FIELDS.map((f) => [f.label, f.key]));
const ID_HEADERS = new Set(["lead id", "leadid", "lead_id", "id", "source id", "source lead id", "record id", "leadgen id", "facebook lead id"]);

export type CustomFieldOption = { value: string; label: string };

/** Logical custom-field options (CSV importer rules: one per normalised name; built-in shadows excluded). */
export function customFieldOptions(fields: SheetsContext["custom_fields"]): CustomFieldOption[] {
  return buildImportFieldOptions(fields.map((f) => ({ id: f.id, name: f.name, createdBy: f.created_by, createdAt: f.created_at })))
    .filter((o) => o.kind === "custom" && !o.ambiguous && o.customFieldId)
    .map((o) => ({ value: `custom:${o.customFieldId}`, label: o.canonicalName }));
}

/** Initial mapping using the CSV importer's header detection. Ambiguous headers stay unmapped. */
export function autoMap(headers: string[], fields: SheetsContext["custom_fields"]): { columns: { header: string; target: string }[]; idHeader: string | null } {
  const options = buildImportFieldOptions(fields.map((f) => ({ id: f.id, name: f.name, createdBy: f.created_by, createdAt: f.created_at })));
  const used = new Set<string>();
  const columns: { header: string; target: string }[] = [];
  const idHeader = headers.find((h) => ID_HEADERS.has(normalizeFieldName(h))) ?? null;
  for (const header of headers) {
    if (!header.trim() || header === idHeader) continue;
    const opt = matchCsvHeaderToField(header, options);
    if (!opt) continue;
    const target = opt.kind === "standard" ? LABEL_TO_KEY.get(opt.canonicalName) : opt.customFieldId ? `custom:${opt.customFieldId}` : undefined;
    if (!target || used.has(target)) continue;
    used.add(target);
    columns.push({ header, target });
  }
  return { columns, idHeader };
}
