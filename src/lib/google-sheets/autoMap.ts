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

// ---------------------------------------------------------------- mapping v2 auto-detection (legacy autoMap above is unchanged)
/** Address-style headers → standard field key. Matched only to a field the owner can map; never to a built-in. */
const ADDRESS_ALIASES: Record<"address" | "city" | "zip_code", string[]> = {
  address: ["address", "street", "street address", "address 1", "address line 1", "address1", "addr", "street address 1", "street 1"],
  city: ["city", "town", "city/town", "city town"],
  zip_code: ["zip", "zip code", "zipcode", "zip+4", "postal code", "postcode", "postal", "zip/postal code", "zip postal code", "zip / postal code"],
};
/** Location qualifiers stripped before matching: "Mailing State" → State, "Mailing Address" → Address (never Email). */
const QUALIFIER = /^(mailing|home|billing|residential|physical|shipping|primary|current)\s+/;

const squash = (s: string) => normalizeFieldName(s).replace(/[^a-z0-9]/g, "");

/**
 * Initial v2 mapping. Order per header: Lead ID → address aliases (only to a visible, mappable field) → the CSV
 * importer's detection (on the qualifier-stripped header when a qualifier is present) → a UNIQUE punctuation-
 * insensitive custom-field name match. Ambiguous or unavailable matches stay unmapped. A target is used once.
 */
export function autoMapV2(headers: string[], catalog: { options: { value: string; label: string; group: string; disabled?: boolean; standardKey?: string }[] },
  fields: SheetsContext["custom_fields"]): { columns: { header: string; target: string }[]; idHeader: string | null } {
  const csvOptions = buildImportFieldOptions(fields.map((f) => ({ id: f.id, name: f.name, createdBy: f.created_by, createdAt: f.created_at })));
  const usable = new Set(catalog.options.filter((o) => !o.disabled).map((o) => o.value));
  const used = new Set<string>();
  const columns: { header: string; target: string }[] = [];
  const idHeader = headers.find((h) => ID_HEADERS.has(normalizeFieldName(h))) ?? null;
  const take = (header: string, target: string | undefined) => {
    if (!target || used.has(target) || !usable.has(target)) return false;
    used.add(target); columns.push({ header, target }); return true;
  };
  for (const header of headers) {
    if (!header.trim() || header === idHeader) continue;
    const n = normalizeFieldName(header);
    const stripped = n.replace(QUALIFIER, "");
    const alias = (Object.keys(ADDRESS_ALIASES) as (keyof typeof ADDRESS_ALIASES)[])
      .find((k) => ADDRESS_ALIASES[k].includes(stripped) || ADDRESS_ALIASES[k].map(squash).includes(squash(stripped)));
    if (alias) { take(header, catalog.options.find((o) => o.standardKey === alias)?.value); continue; }
    const opt = matchCsvHeaderToField(stripped !== n ? stripped : header, csvOptions);
    if (opt) {
      const target = opt.kind === "standard" ? LABEL_TO_KEY.get(opt.canonicalName) : opt.customFieldId ? `custom:${opt.customFieldId}` : undefined;
      if (take(header, target)) continue;
    }
    const loose = catalog.options.filter((o) => o.value.startsWith("custom:") && !o.disabled && squash(o.label) === squash(stripped));
    if (loose.length === 1) take(header, loose[0].value);
  }
  return { columns, idHeader };
}
