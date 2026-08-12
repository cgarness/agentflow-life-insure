import { z } from "zod";

/** Key inside `user_preferences.settings` JSON. */
export const CONTACT_FIELD_LAYOUT_KEY = "contact_field_layout" as const;

export type ContactType = "lead" | "client" | "recruit";

export type ContactFieldLayout = Partial<Record<ContactType, string[]>>;

/** Validates merged `contact_field_layout` blob before persistence. */
export const ContactFieldLayoutSchema = z
  .object({
    lead: z.array(z.string()).optional(),
    client: z.array(z.string()).optional(),
    recruit: z.array(z.string()).optional(),
  })
  .strict();

export type LeadDialerFieldDescriptor = {
  label: string;
  key: string;
  kind: "standard" | "custom";
};

/**
 * Field ids that are INTERNAL system metadata and must never resolve into a
 * user-facing individual contact field.
 *
 * `leadScore` (`leads.lead_score`) is queue metadata: it drives the manager
 * Min/Max Score queue filters and the "Highest Score" queue sort, and it is not
 * an agent-editable attribute of a contact. It is stripped from every saved
 * layout on read because migration `20260326220000_add_field_order_to_settings`
 * set the `contact_management_settings.field_order_lead` column DEFAULT to an
 * array containing it — so live agency rows (and user layouts cloned from them)
 * still carry the stale key. Sanitizing here is frontend-only; no stored value
 * is rewritten and no queue behaviour changes.
 */
export const HIDDEN_CONTACT_FIELD_IDS: readonly string[] = ["leadScore"];

/** Drops internal-only ids from a saved layout, preserving the order of the rest. */
function sanitizeFieldOrder(ids: string[]): string[] {
  return ids.filter((id) => !HIDDEN_CONTACT_FIELD_IDS.includes(id));
}

/** Same arrays as legacy `FullScreenContactView.getDefaultFieldOrder` (verbatim). */
export function getDefaultFieldOrder(t: ContactType): string[] {
  if (t === "lead") {
    return [
      "firstName",
      "lastName",
      "phone",
      "email",
      "state",
      "leadSource",
      "age",
      "dateOfBirth",
      "spouseInfo",
      "assignedAgentId",
      "notes",
    ];
  }
  if (t === "client") {
    // 'issueDate' is retired from the default layout (Sold Date replaced it, approved D4). The
    // render case remains, so saved layouts that still contain 'issueDate' keep working.
    return [
      "firstName",
      "lastName",
      "phone",
      "email",
      "policyType",
      "carrier",
      "state",
      "policyNumber",
      "premiumAmount",
      "faceAmount",
      "soldDate",
      "effectiveDate",
      "draftDate",
      "paymentFrequency",
      "assignedAgentId",
      "notes",
    ];
  }
  return ["firstName", "lastName", "phone", "email", "status", "state", "assignedAgentId", "notes"];
}

export function resolveFieldOrder(
  type: ContactType,
  userOrder: string[] | null | undefined,
  orgOrder: string[] | null | undefined
): string[] {
  // A saved layout that sanitizes to empty falls through to the next source
  // rather than rendering an empty field list.
  if (Array.isArray(userOrder) && userOrder.length > 0) {
    const sanitized = sanitizeFieldOrder(userOrder);
    if (sanitized.length > 0) return sanitized;
  }
  if (Array.isArray(orgOrder) && orgOrder.length > 0) {
    const sanitized = sanitizeFieldOrder(orgOrder);
    if (sanitized.length > 0) return sanitized;
  }
  return getDefaultFieldOrder(type);
}

const LEAD_STANDARD: Record<string, LeadDialerFieldDescriptor> = {
  firstName: { label: "First Name", key: "first_name", kind: "standard" },
  lastName: { label: "Last Name", key: "last_name", kind: "standard" },
  phone: { label: "Phone", key: "phone", kind: "standard" },
  email: { label: "Email", key: "email", kind: "standard" },
  state: { label: "State", key: "state", kind: "standard" },
  age: { label: "Age", key: "age", kind: "standard" },
  dateOfBirth: { label: "DOB", key: "date_of_birth", kind: "standard" },
  healthStatus: { label: "Health", key: "health_status", kind: "standard" },
  bestTimeToCall: { label: "Best Time", key: "best_time_to_call", kind: "standard" },
  spouseInfo: { label: "Spouse", key: "spouse_info", kind: "standard" },
  leadSource: { label: "Source", key: "source", kind: "standard" },
  // No `leadScore` entry: lead score is internal queue metadata (see
  // HIDDEN_CONTACT_FIELD_IDS). Ids absent from this registry are skipped below,
  // so a stale saved layout cannot surface it on the Dialer lead card.
  notes: { label: "Notes", key: "notes", kind: "standard" },
  assignedAgentId: { label: "Assigned Agent", key: "assigned_agent_id", kind: "standard" },
};

export function leadLayoutIdsToDialerDescriptors(ids: string[]): LeadDialerFieldDescriptor[] {
  const out: LeadDialerFieldDescriptor[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !id.length) continue;
    if (id.startsWith("custom:")) {
      const name = id.slice("custom:".length);
      if (!name.length) continue;
      out.push({ label: name, key: name, kind: "custom" });
      continue;
    }
    const std = LEAD_STANDARD[id];
    if (std) {
      out.push(std);
    }
  }
  return out;
}
