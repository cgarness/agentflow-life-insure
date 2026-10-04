import { getDefaultFieldOrder, type ContactType } from "./contactFieldLayout";
import { buildLogicalCustomFields, normalizeFieldName } from "./import-field-matching";
import { isReservedCustomFieldKey } from "./reservedCustomFields";
import type { CustomField } from "./types";

export type DetailEditor = "text" | "email" | "number" | "select" | "textarea" | "date";
export interface ContactDetailField {
  id: string;
  kind: "standard" | "custom";
  key: string;
  label: string;
  normalizedName?: string;
  required?: boolean;
  editor?: DetailEditor;
  options?: string[];
  readOnly?: boolean;
}

const labels: Record<string, string> = {
  firstName: "First Name", lastName: "Last Name", phone: "Phone", email: "Email", state: "State",
  leadSource: "Source", age: "Age", dateOfBirth: "DOB", spouseInfo: "Spouse Info", bestTimeToCall: "Best Time to Call",
  policyType: "Policy Type", carrier: "Carrier", policyNumber: "Policy #", premiumAmount: "Premium",
  faceAmount: "Face Amount", soldDate: "Sold Date", issueDate: "Issue Date", effectiveDate: "Effective Date",
  draftDate: "Draft Date", paymentFrequency: "Payment Frequency", beneficiaryName: "Beneficiary Name",
  status: "Status", assignedAgentId: "Assigned Agent", notes: "System Notes",
};
const appliesTo = { lead: "Leads", client: "Clients", recruit: "Recruits" } as const;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Presence for DISPLAY/custom required values: false and zero are recorded answers. */
export function isPopulatedDetailValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function formatDetailValue(value: unknown): string {
  return value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** A restrictive native input must never sanitize an existing legacy value on display. */
function customEditor(rows: CustomField[], representative: CustomField | undefined, value: unknown) {
  if (value !== null && typeof value === "object") return { editor: "text" as const, readOnly: true };
  if (typeof value === "boolean") return { editor: "select" as const, options: ["true", "false"] };
  const signature = (f: CustomField) => JSON.stringify([f.type, f.type === "Dropdown" ? f.dropdownOptions ?? [] : []]);
  if (!representative || rows.some(f => signature(f) !== signature(representative))) return { editor: "text" as const };
  const populated = isPopulatedDetailValue(value);
  switch (representative.type) {
    case "Number":
      return { editor: populated && !/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value)) ? "text" as const : "number" as const };
    case "Date":
      return { editor: populated && (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || (!Number.isFinite(Date.parse(String(value))) || new Date(String(value)).toISOString().slice(0, 10) !== String(value))) ? "text" as const : "date" as const };
    case "Dropdown": {
      const options = [...new Set(representative.dropdownOptions ?? [])];
      if (populated && !options.includes(String(value))) options.push(String(value));
      return { editor: "select" as const, options };
    }
    case "Email": return { editor: "email" as const };
    default: return { editor: "text" as const };
  }
}

/**
 * Read-only presentation projection. The caller supplies ONLY its current scoped/RLS-visible
 * definitions. Normalization resolves definition/layout aliases; it NEVER rewrites the JSONB bag.
 * Every exact stored key survives, even equal-valued case/spacing variants. Definition-only fields
 * use the import mapper's agency/oldest/id representative. Reserved metadata never enters this list.
 */
export function buildContactDetailFields({ type, order, definitions = [], values = {}, entity = {} }: {
  type: ContactType;
  order: readonly string[];
  definitions?: readonly CustomField[];
  values?: Record<string, unknown> | null;
  entity?: Record<string, unknown>;
}): ContactDetailField[] {
  const standardIds = [...getDefaultFieldOrder(type)];
  if (type === "lead") standardIds.push("bestTimeToCall");
  if (type === "client") {
    standardIds.push("beneficiaryName");
    if (order.includes("issueDate") || isPopulatedDetailValue(entity.issueDate)) standardIds.push("issueDate");
  }
  const fields: ContactDetailField[] = standardIds.map(key => ({ id: key, kind: "standard", key, label: labels[key] }));
  const active = definitions.filter(f => f.active && f.appliesTo?.includes(appliesTo[type]) && !isReservedCustomFieldKey(f.name));
  // Stable id input also handles legacy representatives with two missing timestamps.
  const groups = buildLogicalCustomFields([...active].sort((a, b) => compare(a.id, b.id)));
  const rowsById = new Map(active.map(f => [f.id, f]));
  const stored = new Map<string, string[]>();
  for (const key of Object.keys(values ?? {}).filter(k => !isReservedCustomFieldKey(k)).sort(compare)) {
    const normalized = normalizeFieldName(key);
    stored.set(normalized, [...(stored.get(normalized) ?? []), key]);
  }
  const logical = new Map(groups.map(g => [g.normalizedName, g]));
  const names = [...new Set([...logical.keys(), ...stored.keys()])].sort(compare);
  for (const normalizedName of names) {
    const group = logical.get(normalizedName);
    const representative = group ? rowsById.get(group.representativeId) : undefined;
    const rows = group ? group.memberIds.map(id => rowsById.get(id)!) : [];
    const keys = stored.get(normalizedName) ?? (representative ? [representative.name] : []);
    for (const key of keys) {
      fields.push({ id: `custom:${key}`, kind: "custom", key, normalizedName,
        label: keys.length > 1 ? `${representative?.name ?? key.trim()} [${JSON.stringify(key)}]` : key,
        required: rows.some(f => f.required), ...customEditor(rows, representative, values?.[key]),
      });
    }
  }
  const byId = new Map(fields.map(f => [f.id, f]));
  const placed = new Set<string>();
  const result: ContactDetailField[] = [];
  const place = (field: ContactDetailField) => {
    if (!placed.has(field.id)) { placed.add(field.id); result.push(field); }
  };
  for (const id of order) {
    if (byId.has(id)) place(byId.get(id)!);
    else if (id.startsWith("custom:") && !isReservedCustomFieldKey(id.slice(7))) {
      const normalized = normalizeFieldName(id.slice(7));
      fields.filter(f => f.kind === "custom" && f.normalizedName === normalized).forEach(place);
    }
  }
  fields.forEach(place);
  return result;
}

export function missingRequiredCustomDetails(fields: readonly ContactDetailField[], values: Record<string, unknown> = {}): string[] {
  const required = new Map<string, ContactDetailField[]>();
  for (const field of fields) {
    if (field.kind !== "custom" || !field.required) continue;
    const name = field.normalizedName!;
    required.set(name, [...(required.get(name) ?? []), field]);
  }
  return [...required.values()].filter(group => !group.some(f => isPopulatedDetailValue(values[f.key])))
    .map(group => group[0].label);
}
