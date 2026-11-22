// Workflow field catalog. One source for the builder's Insert field menu, graph validation,
// synthetic preview and worker rendering. Plain TypeScript only: imported by Deno and by the browser.

export const APPOINTMENT_TRIGGERS: readonly string[] = [
  "appointment_booked",
  "appointment_outcome_recorded",
];

export interface WorkflowField {
  token: string;
  label: string;
  group: "Contact" | "Appointment";
  sample: string;
  /** Trigger types whose event supplies this value. Absent means every trigger. */
  triggers?: readonly string[];
}

export const WORKFLOW_FIELDS: readonly WorkflowField[] = [
  { token: "first_name", label: "First name", group: "Contact", sample: "Alex" },
  { token: "last_name", label: "Last name", group: "Contact", sample: "Morgan" },
  { token: "email", label: "Email address", group: "Contact", sample: "alex@example.com" },
  { token: "phone", label: "Phone number", group: "Contact", sample: "(555) 010-0100" },
  {
    token: "appointment_date",
    label: "Appointment date",
    group: "Appointment",
    sample: "Tuesday, December 1",
    triggers: APPOINTMENT_TRIGGERS,
  },
  {
    token: "appointment_time",
    label: "Appointment time",
    group: "Appointment",
    sample: "3:00 PM EST",
    triggers: APPOINTMENT_TRIGGERS,
  },
];

const BY_TOKEN = new Map(WORKFLOW_FIELDS.map((field) => [field.token, field]));
const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

export function fieldsForTrigger(trigger: string | null | undefined): WorkflowField[] {
  return WORKFLOW_FIELDS.filter((field) => !field.triggers || (!!trigger && field.triggers.includes(trigger)));
}

export function fieldToken(token: string): string {
  return "{{" + token + "}}";
}

// Saved messages are written for manual texting, whose catalog uses different names.
// Only tokens with an exact automation equivalent are mapped. Whitespace handling is limited to
// spaces and tabs so the database applies the identical rewrite when it compares wording.
const SAVED_TO_WORKFLOW: ReadonlyArray<readonly [string, string]> = [
  ["contact_first_name", "{{first_name}}"],
  ["contact_last_name", "{{last_name}}"],
  ["contact_full_name", "{{first_name}} {{last_name}}"],
  ["contact_phone", "{{phone}}"],
  ["contact_email", "{{email}}"],
];

const SAVED_ONLY_LABELS: Readonly<Record<string, string>> = {
  contact_state: "State",
  contact_city: "City",
  policy_type: "Policy type",
  policy_amount: "Coverage amount",
  policy_anniversary_date: "Anniversary date",
  agent_first_name: "Agent first name",
  agent_last_name: "Agent last name",
  agent_phone: "Agent phone",
  agent_email: "Agent email",
  agency_name: "Agency name",
  appointment_link: "Booking link",
};

/** Rewrite a saved message into automation fields. The result is what the step stores. */
export function savedMessageText(text: string): string {
  let next = text ?? "";
  for (const [manual, workflow] of SAVED_TO_WORKFLOW) {
    next = next.replace(new RegExp("\\{\\{[ \\t]*" + manual + "[ \\t]*\\}\\}", "g"), workflow);
  }
  return next;
}

export interface FieldProblem {
  token: string;
  label: string;
  kind: "unavailable" | "unsupported";
}

/** Every field in the text that this trigger cannot fill, in order of first use. */
export function fieldProblems(text: unknown, trigger: string | null | undefined): FieldProblem[] {
  if (typeof text !== "string") return [];
  const allowed = new Set(fieldsForTrigger(trigger).map((field) => field.token));
  const seen = new Set<string>();
  const problems: FieldProblem[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const token = match[1];
    if (allowed.has(token) || seen.has(token)) continue;
    seen.add(token);
    const known = BY_TOKEN.get(token);
    problems.push(
      known
        ? { token, label: known.label, kind: "unavailable" }
        : { token, label: SAVED_ONLY_LABELS[token] ?? fieldToken(token), kind: "unsupported" },
    );
  }
  return problems;
}

/** Actionable author message, or undefined when every field can be filled. */
export function fieldIssue(text: unknown, label: string, trigger: string | null | undefined): string | undefined {
  if (typeof text !== "string") return undefined;
  const problems = fieldProblems(text, trigger);
  if (problems.length) {
    const unavailable = problems.filter((problem) => problem.kind === "unavailable").map((problem) => problem.label);
    const unsupported = problems.filter((problem) => problem.kind === "unsupported").map((problem) => problem.label);
    if (unsupported.length) {
      return label + " uses a field automations can't fill: " + unsupported.join(", ") +
        ". Remove it or choose one from Insert field.";
    }
    return label + " uses " + unavailable.join(" and ") +
      ", which this trigger does not provide. Remove it or start from an appointment trigger.";
  }
  if (/\{\{|\}\}/.test(text.replace(TOKEN, ""))) {
    return label + " has an incomplete field. Use Insert field to add one.";
  }
  return undefined;
}

export interface FieldSource {
  contact?: Record<string, unknown> | null;
  /** ISO instant of the appointment the run is anchored to. */
  appointment_start?: string | null;
  /** IANA zone used to write the appointment date and time. */
  timezone?: string | null;
  /** Caller number for a run without a matched contact. */
  caller_phone?: string | null;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function zoned(start: Date, timezone: string, options: Intl.DateTimeFormatOptions): string | undefined {
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone }).format(start);
  } catch {
    return undefined;
  }
}

/** Resolved values. A key that is absent could not be established and must hold a send. */
export function fieldValues(source: FieldSource): Record<string, string> {
  const contact = source.contact ?? {};
  const values: Record<string, string> = {
    first_name: text(contact.first_name),
    last_name: text(contact.last_name),
    email: text(contact.email),
    phone: text(contact.phone) || text(source.caller_phone),
  };
  const start = source.appointment_start ? new Date(source.appointment_start) : null;
  if (start && !Number.isNaN(start.getTime()) && source.timezone) {
    const date = zoned(start, source.timezone, { weekday: "long", month: "long", day: "numeric" });
    const time = zoned(start, source.timezone, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    if (date && time) {
      values.appointment_date = date;
      values.appointment_time = time;
    }
  }
  return values;
}

export interface RenderedText {
  text: string;
  /** Labels of fields used in the text whose value could not be established. */
  missing: string[];
}

/** Render with the catalog. Unknown tokens render empty, matching the original workflow renderer. */
export function renderFields(template: unknown, values: Record<string, string>): RenderedText {
  const missing: string[] = [];
  const rendered = (typeof template === "string" ? template : "").replace(TOKEN, (_match, token: string) => {
    if (Object.prototype.hasOwnProperty.call(values, token)) return values[token];
    const field = BY_TOKEN.get(token);
    if (field && !missing.includes(field.label)) missing.push(field.label);
    return "";
  });
  return { text: rendered, missing };
}

export function usesAppointmentField(template: unknown): boolean {
  return typeof template === "string" && /\{\{\s*appointment_(date|time)\s*\}\}/.test(template);
}
