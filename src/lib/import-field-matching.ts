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
 *
 * INVARIANT (Custom-Field Canonicalization): within an organization, normalized
 * custom-field names form ONE logical namespace. Several PHYSICAL `custom_fields` rows
 * that normalize to the same name are collapsed into ONE logical import option — see
 * `buildLogicalCustomFields`. The database enforces the same rule forward-only via
 * `private.custom_fields_logical_name_guard()`; the pre-existing duplicate rows stay
 * valid and are never mutated here. Ambiguity now means ONLY "this name is shared with
 * an AgentFlow built-in", which still fails closed.
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
  /** Derived from ownership columns. Used by the representative rule below. */
  scope?: "system" | "agency" | "personal";
  /** NULL on system templates and agency-wide fields. */
  createdBy?: string | null;
  /** `custom_fields.created_at`. Used by the representative rule below. */
  createdAt?: string | null;
}

/**
 * One LOGICAL custom field: the collapse of every physical `custom_fields` row in an
 * organization that normalizes to the same name.
 */
export interface LogicalCustomField {
  /** `normalizeFieldName(canonicalName)` — the logical identity. */
  normalizedName: string;
  /** The representative's RAW name. This is the `leads.custom_fields` JSON key. */
  canonicalName: string;
  /** The representative row's database id; becomes the option's stable value. */
  representativeId: string;
  /** EVERY physical row id in the group, representative first. */
  memberIds: readonly string[];
}

export interface ImportFieldOption {
  /** Stable identity: the canonical name for built-ins, `custom:<uuid>` for custom fields. */
  value: string;
  /** The real, undecorated field name — the `leads.custom_fields` JSON key. */
  canonicalName: string;
  /** Rendered dropdown text. Custom fields carry the UI-only `" (Custom)"` suffix. */
  label: string;
  kind: "standard" | "custom";
  /** Present only for custom fields: the LOGICAL representative's id. */
  customFieldId?: string;
  /**
   * Custom fields only: every physical row id collapsed into this logical option. A
   * mapping made against ANY member still resolves to this option's canonical name, so a
   * representative change between renders can never silently drop a column.
   */
  memberIds?: readonly string[];
  /**
   * True when this option's normalized name collides with an option of the OTHER kind —
   * i.e. a custom field shadowing an AgentFlow built-in. Duplicate custom rows sharing one
   * normalized name are NOT ambiguous: they are one logical field. Ambiguous options
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
 * Ranks two physical rows of the SAME normalized name. Returns < 0 when `a` should be the
 * representative. The order is TOTAL and independent of input order, which matters because
 * `customFieldsSupabaseApi.getAll` sorts by `name` only — Postgres gives no stability
 * guarantee among equal sort keys, so array position among duplicates is not deterministic.
 *
 * 1. Agency-wide (`created_by IS NULL` with an organization) beats personal: it is the
 *    organization-authoritative definition and the only row every member can already see.
 * 2. Then the OLDEST `createdAt`. A missing/unparseable timestamp sorts LAST, so an absent
 *    value can never win by accident.
 * 3. Then the lowest `id`. UUIDs are unique, so this breaks every remaining tie.
 */
function compareRepresentative(a: MappableCustomField, b: MappableCustomField): number {
  const agency = (f: MappableCustomField) => (f.scope === "agency" || f.createdBy === null ? 0 : 1);
  const byAgency = agency(a) - agency(b);
  if (byAgency !== 0) return byAgency;

  const at = (f: MappableCustomField) => {
    const t = f.createdAt ? Date.parse(f.createdAt) : NaN;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  const byAge = at(a) - at(b);
  if (byAge !== 0) return byAge;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Collapses physical `custom_fields` rows into one LOGICAL field per normalized name.
 *
 * Pure: reads rows already in memory, queries nothing, and mutates no row. The duplicate
 * rows keep existing and stay individually manageable in Settings — only the IMPORT
 * MAPPER presents them as one field.
 */
export function buildLogicalCustomFields(
  customFields: readonly MappableCustomField[],
): LogicalCustomField[] {
  const groups = new Map<string, MappableCustomField[]>();
  for (const f of customFields) {
    const key = normalizeFieldName(f.name);
    const bucket = groups.get(key);
    if (bucket) bucket.push(f);
    else groups.set(key, [f]);
  }

  return [...groups.entries()].map(([normalizedName, rows]) => {
    // Copy before sorting: the caller's array must not be reordered under it.
    const ranked = [...rows].sort(compareRepresentative);
    const representative = ranked[0];
    return {
      normalizedName,
      canonicalName: representative.name,
      representativeId: representative.id,
      memberIds: ranked.map((r) => r.id),
    };
  });
}

/**
 * Builds the full option list: every built-in, plus ONE option per logical custom field.
 *
 * Ambiguity is computed across built-ins AND logical custom fields, so a custom field that
 * shadows a built-in name is still flagged on both sides and still fails closed. Several
 * physical rows sharing one normalized name are NOT ambiguity — they are one field.
 */
export function buildImportFieldOptions(customFields: readonly MappableCustomField[]): ImportFieldOption[] {
  const logical = buildLogicalCustomFields(customFields);

  const counts = new Map<string, number>();
  const bump = (name: string) => {
    const k = normalizeFieldName(name);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };

  AGENTFLOW_FIELDS.forEach(bump);
  logical.forEach((f) => bump(f.canonicalName));

  const isAmbiguous = (name: string) => (counts.get(normalizeFieldName(name)) ?? 0) > 1;

  const standard: ImportFieldOption[] = AGENTFLOW_FIELDS.map((name) => ({
    value: name,
    canonicalName: name,
    label: name,
    kind: "standard" as const,
    ambiguous: isAmbiguous(name),
  }));

  const custom: ImportFieldOption[] = logical.map((f) => ({
    value: customFieldOptionValue(f.representativeId),
    canonicalName: f.canonicalName,
    label: `${f.canonicalName} (Custom)`,
    kind: "custom" as const,
    customFieldId: f.representativeId,
    memberIds: f.memberIds,
    ambiguous: isAmbiguous(f.canonicalName),
  }));

  return [...standard, ...custom];
}

/**
 * Finds the logical option a requested field NAME resolves to, using the ONE canonical
 * normalization. Used by the create-custom-field paths to reuse an existing field instead
 * of inserting another definition.
 */
export function findOptionByFieldName(
  fieldName: string,
  options: readonly ImportFieldOption[],
  kind?: ImportFieldOption["kind"],
): ImportFieldOption | null {
  const key = normalizeFieldName(fieldName);
  return (
    options.find(
      (o) => (kind ? o.kind === kind : true) && normalizeFieldName(o.canonicalName) === key,
    ) ?? null
  );
}

/**
 * The outcome of asking "may I create a custom field called X?".
 *
 * ONE rule, shared by BOTH creation ingresses — the CSV import mapper and
 * Settings > Contact Management — so the two can never disagree with each other or with
 * auto-detection. The database guard
 * (`private.custom_fields_logical_name_guard`) remains the authority: this check only
 * turns the common case into a precise message instead of a raw error, and it can only
 * see rows RLS returned to this caller.
 */
export type RequestedFieldNameVerdict =
  /** The name is an AgentFlow built-in. Use that field; never shadow it. */
  | { kind: "builtin"; builtInName: AgentFlowField }
  /** A custom field with this normalized name already exists and must be reused. */
  | { kind: "existing"; field: MappableCustomField }
  /** No collision among the rows this caller can see. */
  | { kind: "available" };

export function classifyRequestedFieldName(
  requestedName: string,
  existingFields: readonly MappableCustomField[],
  options?: {
    /** Ignore this row — the one being renamed. */
    excludeId?: string;
    /** Rows this predicate rejects are ignored (e.g. inactive fields). */
    isEligible?: (f: MappableCustomField) => boolean;
  },
): RequestedFieldNameVerdict {
  const key = normalizeFieldName(requestedName);

  const builtIn = AGENTFLOW_FIELDS.find((n) => normalizeFieldName(n) === key);
  if (builtIn) return { kind: "builtin", builtInName: builtIn };

  const candidates = existingFields.filter(
    (f) =>
      f.id !== options?.excludeId &&
      (options?.isEligible ? options.isEligible(f) : true) &&
      normalizeFieldName(f.name) === key,
  );
  if (candidates.length > 0) {
    // Report the same row the mapper would present, so the message and the selection agree.
    const [representative] = buildLogicalCustomFields(candidates);
    const field = candidates.find((f) => f.id === representative.representativeId) ?? candidates[0];
    return { kind: "existing", field };
  }

  return { kind: "available" };
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

  // Custom options are already collapsed to one per normalized name, so N physical
  // duplicates of "Gender" produce exactly one match here rather than N.
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

  const exact = options.find((o) => o.value === mappingValue);
  if (exact) return exact.canonicalName;

  // A mapping may have been stored against a NON-REPRESENTATIVE member of a logical group
  // — the representative can change when the field list is refetched, or when another
  // user's row becomes visible. Resolving only the representative's value would return
  // null here, and the payload builder SILENTLY SKIPS a null, dropping that column from
  // every imported row with no error. Accept any member of the group.
  if (isCustomFieldMapping(mappingValue)) {
    const id = mappingValue.slice("custom:".length);
    const member = options.find((o) => o.kind === "custom" && o.memberIds?.includes(id));
    if (member) return member.canonicalName;
  }
  return null;
}

/** True when the mapping value refers to a custom (non-built-in) field. */
export function isCustomFieldMapping(mappingValue: string): boolean {
  return mappingValue.startsWith("custom:");
}
