import type { CustomField } from "@/lib/types";

export type RequiredContactType = "lead" | "client" | "recruit";

export const LOCKED_REQUIRED_FIELDS: Record<RequiredContactType, string[]> = {
  lead: ["First Name", "Last Name", "Phone"],
  client: ["First Name", "Last Name", "Phone"],
  recruit: ["First Name", "Last Name", "Phone"],
};

/** Optional standard fields surfaced in the Required Fields settings UI. */
export const OPTIONAL_STANDARD_FIELDS: Record<RequiredContactType, string[]> = {
  lead: ["Email", "State", "Lead Source", "Date of Birth", "Age", "Best Time to Call", "Assigned Agent"],
  client: ["Email", "State", "Policy Type", "Carrier", "Policy Number", "Face Amount", "Premium Amount", "Issue Date", "Effective Date", "Beneficiary Name"],
  recruit: ["Email", "State", "Status", "Assigned Agent", "Notes"],
};

/**
 * Display-label → entity key map. Keys point at fields on the JS-shaped
 * partial entity (camelCase). Custom fields are not in this map — they live
 * under `customFields[<custom field name>]`.
 */
export const STANDARD_FIELD_KEY: Record<RequiredContactType, Record<string, string>> = {
  lead: {
    "First Name": "firstName",
    "Last Name": "lastName",
    "Phone": "phone",
    "Email": "email",
    "State": "state",
    "Lead Source": "leadSource",
    "Date of Birth": "dateOfBirth",
    "Age": "age",
    "Best Time to Call": "bestTimeToCall",
    "Assigned Agent": "assignedAgentId",
    "Status": "status",
    "Notes": "notes",
  },
  client: {
    "First Name": "firstName",
    "Last Name": "lastName",
    "Phone": "phone",
    "Email": "email",
    "State": "state",
    "Policy Type": "policyType",
    "Carrier": "carrier",
    "Policy Number": "policyNumber",
    "Face Amount": "faceAmount",
    "Premium Amount": "premiumAmount",
    "Issue Date": "issueDate",
    "Effective Date": "effectiveDate",
    "Beneficiary Name": "beneficiaryName",
    "Notes": "notes",
    "Assigned Agent": "assignedAgentId",
  },
  recruit: {
    "First Name": "firstName",
    "Last Name": "lastName",
    "Phone": "phone",
    "Email": "email",
    "State": "state",
    "Status": "status",
    "Assigned Agent": "assignedAgentId",
    "Notes": "notes",
  },
};

export function isPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  if (typeof v === "boolean") return v;
  return true;
}

const APPLIES_TO_LABEL: Record<RequiredContactType, "Leads" | "Clients" | "Recruits"> = {
  lead: "Leads",
  client: "Clients",
  recruit: "Recruits",
};

export interface ComputeMissingOpts {
  contactType: RequiredContactType;
  /** JS-shaped partial entity (camelCase). */
  entity: Record<string, unknown>;
  /** Optional separate custom-fields blob (entity.customFields takes precedence if set). */
  customFields?: Record<string, unknown> | null;
  /** Saved Required Fields settings for this contact type ({ "Email": true, ... }). */
  requiredFieldsSetting?: Record<string, boolean> | null;
  /** All active custom fields for the org; required toggles are honored only if the field applies to the type. */
  activeCustomFields?: CustomField[] | null;
  /** When true, also enforce custom required fields (e.g. FullScreenContactView). Defaults to false. */
  enforceCustomFields?: boolean;
}

/**
 * Returns the list of human-friendly required-field labels that are missing on
 * the entity. Locked core (First/Last/Phone) is always included.
 */
export function computeMissingRequired(opts: ComputeMissingOpts): string[] {
  const { contactType, entity } = opts;
  const setting = opts.requiredFieldsSetting ?? {};
  const cfMap = (opts.customFields ?? (entity.customFields as Record<string, unknown> | undefined)) ?? {};
  const missing: string[] = [];

  const checkStandard = (label: string) => {
    const key = STANDARD_FIELD_KEY[contactType][label];
    if (!key) return;
    if (!isPresent(entity[key])) missing.push(label);
  };

  for (const label of LOCKED_REQUIRED_FIELDS[contactType]) checkStandard(label);

  for (const label of OPTIONAL_STANDARD_FIELDS[contactType]) {
    if (setting[label]) checkStandard(label);
  }

  if (opts.enforceCustomFields) {
    const appliesLabel = APPLIES_TO_LABEL[contactType];
    for (const cf of opts.activeCustomFields ?? []) {
      if (!cf.active || !cf.required) continue;
      if (!Array.isArray(cf.appliesTo) || !cf.appliesTo.includes(appliesLabel as any)) continue;
      const v = (cfMap as Record<string, unknown>)[cf.name];
      if (!isPresent(v)) missing.push(cf.name);
    }
  }

  // De-dupe while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of missing) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}
