/** Contact / lead row: supports snake_case (dialer) and camelCase (CRM views). */
export type MergeContactRecord = Record<string, unknown> | null | undefined;

export interface MessageTemplateMergeInput {
  contact: MergeContactRecord;
  agentFirstName?: string | null;
  agentLastName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  agencyName?: string | null;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
  appointmentLink?: string | null;
}

function pickStr(source: MergeContactRecord, keys: string[]): string {
  if (!source || typeof source !== "object") return "";
  for (const k of keys) {
    const v = source[k];
    if (v == null || v === "") continue;
    return String(v);
  }
  return "";
}

function buildReplacementMap(input: MessageTemplateMergeInput): Record<string, string> {
  const c = input.contact;
  const fn = pickStr(c, ["first_name", "firstName"]);
  const ln = pickStr(c, ["last_name", "lastName"]);
  const full = `${fn}${fn && ln ? " " : ""}${ln}`.trim();

  const afn = input.agentFirstName ?? "";
  const aln = input.agentLastName ?? "";

  const map: Record<string, string> = {
    "{{contact_first_name}}": fn,
    "{{contact_last_name}}": ln,
    "{{contact_full_name}}": full,
    "{{contact_phone}}": pickStr(c, ["phone", "phone_number", "phoneNumber", "mobile", "mobile_phone"]),
    "{{contact_email}}": pickStr(c, ["email", "email_address"]),
    "{{contact_state}}": pickStr(c, ["state", "province"]),
    "{{contact_city}}": pickStr(c, ["city", "town"]),
    "{{policy_type}}": pickStr(c, ["policyType", "policy_type", "product_type", "productType"]),
    "{{policy_amount}}": pickStr(c, ["faceAmount", "face_amount", "coverage_amount", "coverageAmount", "policy_amount"]),
    "{{policy_anniversary_date}}": pickStr(c, [
      "policyAnniversaryDate",
      "policy_anniversary_date",
      "effectiveDate",
      "effective_date",
      "renewal_date",
      "renewalDate",
      "policyAnniversary",
    ]),
    "{{agent_first_name}}": String(afn),
    "{{agent_last_name}}": String(aln),
    "{{agent_phone}}": input.agentPhone != null ? String(input.agentPhone) : "",
    "{{agent_email}}": input.agentEmail != null ? String(input.agentEmail) : "",
    "{{agency_name}}": input.agencyName != null ? String(input.agencyName) : "",
    "{{appointment_date}}": input.appointmentDate != null ? String(input.appointmentDate) : "",
    "{{appointment_time}}": input.appointmentTime != null ? String(input.appointmentTime) : "",
    "{{appointment_link}}": input.appointmentLink != null ? String(input.appointmentLink) : "",
  };
  return map;
}

/** Replaces merge tokens in saved template bodies/subjects using live contact + agent context. */
export function applyMessageTemplateMerge(text: string, input: MessageTemplateMergeInput): string {
  if (!text) return text;
  const map = buildReplacementMap(input);
  let out = text;
  for (const [token, value] of Object.entries(map)) {
    out = out.split(token).join(value);
  }
  return out;
}

/** Normalize template row type from DB (`sms`, `email`, null). */
export function templateMatchesChannel(templateType: string | null | undefined, channel: "sms" | "email"): boolean {
  const t = templateType?.toLowerCase().trim();
  if (!t) return true;
  return t === channel;
}
