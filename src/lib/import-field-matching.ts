/**
 * CSV import field-matching contract (Contacts / Import Build).
 *
 * Separates four concepts that were previously collapsed onto a single name string:
 *
 *   - `value`          stable option identity used by mapping state and the <select>
 *   - `canonicalName`  the real field name — the key used in `leads.custom_fields`
 *   - `label`          rendered display text; may carry UI-only decoration
 *   - `kind`           built-in AgentFlow field vs agency/personal custom field
 *
 * INVARIANT: `"(Custom)"` is UI decoration only. It is never persisted as part of a
 * custom field's name, never stored in mapping state, and never used as a matching key.
 *
 * INVARIANT: `leads.custom_fields` / `clients.custom_fields` / `recruits.custom_fields`
 * are flat JSONB objects keyed by the field's canonical NAME (migration
 * `20260403000000_add_custom_fields_to_leads_and_clients.sql`), and no rename
 * propagation exists anywhere. Mapping state therefore carries the stable id, and the
 * import payload is resolved back to the canonical name at submit time via
 * `resolveMappingToCanonicalName`.
 */

/** Built-in AgentFlow lead fields offered by the import mapper. Order is the dropdown order. */
export const AGENTFLOW_FIELDS = [
  "First Name", "Last Name", "Full Name", "Phone", "Email", "State", "Lead Source",
  "Age", "Date of Birth", "Best Time to Call", "Notes", "Assigned Agent",
] as const;

export type AgentFlowField = (typeof AGENTFLOW_FIELDS)[number];

/** Sentinel option value meaning "ignore this CSV column". */
export const DO_NOT_IMPORT = "Do Not Import";

/** Sentinel option value that opens the inline "create a custom field" form. */
export const CREATE_NEW_FIELD = "__create_new__";

/**
 * Header-variation table for built-in fields.
 *
 * UNCHANGED from the original in-component table — built-in auto-detection behaviour is
 * explicitly preserved (see `matchBuiltInField`).
 */
const FIELD_VARIATIONS: Record<AgentFlowField, string[]> = {
  "First Name": ["first name", "firstname", "first", "fname", "given name", "customer first name", "lead first name"],
  "Last Name": ["last name", "lastname", "last", "lname", "surname", "family name", "customer last name", "lead last name"],
  "Full Name": ["full name", "fullname", "name", "complete name", "contact name", "customer name", "lead name", "client name"],
  "Phone": ["phone", "phone number", "cell", "mobile", "telephone", "contact number", "primary phone", "cell phone", "work phone", "home phone"],
  "Email": ["email", "email address", "e-mail", "mail", "primary email", "contact email"],
  "State": ["state", "st", "province", "region", "location", "customer state", "shipping state", "billing state"],
  "Lead Source": ["lead source", "source", "how did you hear", "referral source", "origin", "marketing source", "traffic source"],
  "Age": ["age", "years old", "current age", "customer age"],
  "Date of Birth": ["date of birth", "dob", "birth date", "birthday", "birthdate"],
  "Best Time to Call": ["best time to call", "best time", "call time", "preferred time", "contact time", "callback time"],
  "Notes": ["notes", "note", "comments", "comment", "additional info", "remarks", "description", "details"],
  "Assigned Agent": ["assigned agent", "agent", "rep", "sales rep", "assigned to", "owner", "agent name", "staff"],
};

/** The subset of a `custom_fields` row the mapper needs. */
export interface MappableCustomField {
  id: string;
  name: string;
}

export interface ImportFieldOption {
  /** Stable identity: the canonical name for built-ins, `custom:<uuid>` for custom fields. */
  value: string;
  /** The real, undecorated field name — the `leads.custom_fields` JSON key. */
  canonicalName: string;
  /** Rendered dropdown text. Custom fields carry the UI-only `" (Custom)"` suffix. */
  label: string;
  kind: "standard" | "custom";
  /** Present only for custom fields. */
  customFieldId?: string;
  /**
   * True when another option shares this option's normalized name. Ambiguous options
   * remain selectable manually but are never auto-detected.
   */
  ambiguous: boolean;
}

/** Stable option value for a custom field. Derived from the immutable database id. */
export function customFieldOptionValue(customFieldId: string): string {
  return `custom:${customFieldId}`;
}

/**
 * The ONE normalization used for deterministic custom-field matching:
 * trim → collapse repeated internal whitespace → lowercase.
 *
 * Punctuation is deliberately preserved: `"Date/Time"` and `"Date Time"` are different
 * fields, and over-normalizing would merge distinct agency fields.
 */
export function normalizeFieldName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Built-in field detection — byte-for-byte the original `fuzzyMatch` algorithm.
 * Moved here unmodified so existing auto-detection behaviour is provably unchanged.
 */
function matchBuiltInField(csvHeader: string): AgentFlowField | null {
  const h = csvHeader.toLowerCase().trim().replace(/[^a-z0-9]/g, " ");
  const normalizedH = h.replace(/\s+/g, "");

  // 1. Try exact match on field name or variations
  for (const [field, variations] of Object.entries(FIELD_VARIATIONS)) {
    const lowField = field.toLowerCase();
    if (h === lowField || normalizedH === lowField.replace(/\s+/g, "")) {
      return field as AgentFlowField;
    }
    if (variations.some((v) => h === v || normalizedH === v.replace(/\s+/g, ""))) {
      return field as AgentFlowField;
    }
  }

  // 2. Try partial match with a stricter threshold
  for (const [field, variations] of Object.entries(FIELD_VARIATIONS)) {
    if (
      variations.some((v) => {
        if (v.length <= 2) return h === v; // Don't partial match short codes like "st"
        return h.startsWith(v) || h.endsWith(v) || (h.includes(v) && v.length > 4);
      })
    ) {
      return field as AgentFlowField;
    }
  }
  return null;
}

/**
 * Builds the full option list. Ambiguity is computed across built-ins AND custom fields,
 * so a custom field that shadows a built-in name is flagged on both sides.
 */
export function buildImportFieldOptions(customFields: readonly MappableCustomField[]): ImportFieldOption[] {
  const counts = new Map<string, number>();
  const bump = (name: string) => {
    const k = normalizeFieldName(name);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };

  AGENTFLOW_FIELDS.forEach(bump);
  customFields.forEach((f) => bump(f.name));

  const isAmbiguous = (name: string) => (counts.get(normalizeFieldName(name)) ?? 0) > 1;

  const standard: ImportFieldOption[] = AGENTFLOW_FIELDS.map((name) => ({
    value: name,
    canonicalName: name,
    label: name,
    kind: "standard" as const,
    ambiguous: isAmbiguous(name),
  }));

  const custom: ImportFieldOption[] = customFields.map((f) => ({
    value: customFieldOptionValue(f.id),
    canonicalName: f.name,
    label: `${f.name} (Custom)`,
    kind: "custom" as const,
    customFieldId: f.id,
    ambiguous: isAmbiguous(f.name),
  }));

  return [...standard, ...custom];
}

/**
 * Auto-detects the field for a CSV header.
 *
 * Order: built-in detection first (unchanged behaviour), then custom fields by normalized
 * exact name. Returns `null` — leaving the column unmapped for the user to choose — when
 * nothing matches or when the match is ambiguous.
 */
export function matchCsvHeaderToField(
  csvHeader: string,
  options: readonly ImportFieldOption[],
): ImportFieldOption | null {
  const builtIn = matchBuiltInField(csvHeader);
  if (builtIn) {
    const opt = options.find((o) => o.kind === "standard" && o.canonicalName === builtIn);
    // A custom field shadowing a built-in name makes the choice ambiguous — do not guess.
    if (opt && !opt.ambiguous) return opt;
    if (opt?.ambiguous) return null;
  }

  const key = normalizeFieldName(csvHeader);
  const matches = options.filter((o) => o.kind === "custom" && normalizeFieldName(o.canonicalName) === key);
  if (matches.length !== 1) return null;
  return matches[0].ambiguous ? null : matches[0];
}

/**
 * Resolves a stored mapping value to the canonical field NAME used by the import payload
 * and by `leads.custom_fields`. Returns `null` for the do-not-import sentinel and for a
 * value whose option no longer exists (e.g. a custom field deleted mid-session).
 */
export function resolveMappingToCanonicalName(
  mappingValue: string,
  options: readonly ImportFieldOption[],
): string | null {
  if (!mappingValue || mappingValue === DO_NOT_IMPORT || mappingValue === CREATE_NEW_FIELD) return null;
  return options.find((o) => o.value === mappingValue)?.canonicalName ?? null;
}

/** True when the mapping value refers to a custom (non-built-in) field. */
export function isCustomFieldMapping(mappingValue: string): boolean {
  return mappingValue.startsWith("custom:");
}
