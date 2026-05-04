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
      "leadScore",
      "age",
      "dateOfBirth",
      "spouseInfo",
      "assignedAgentId",
      "notes",
    ];
  }
  if (t === "client") {
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
      "issueDate",
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
  if (Array.isArray(userOrder) && userOrder.length > 0) {
    return [...userOrder];
  }
  if (Array.isArray(orgOrder) && orgOrder.length > 0) {
    return [...orgOrder];
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
  leadScore: { label: "Score", key: "lead_score", kind: "standard" },
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
