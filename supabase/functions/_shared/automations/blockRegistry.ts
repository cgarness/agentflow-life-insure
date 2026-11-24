import type { z } from "zod";
import {
  type Config,
  offsetLabel,
  type Outcome,
  type PreviewContext,
  previewEmail,
  previewEmailCondition,
  previewSms,
  type PreviewStep,
  previewTask,
  previewTrigger,
  previewWait,
  previewWaitUntil,
  runCreateTask,
  runEmailCondition,
  runMessage,
  type RuntimeContext,
  runWait,
} from "./blockHandlers.ts";
import { characterCount, fieldIssue } from "./fields.ts";

export type BlockEditor =
  | "lead" | "campaign" | "disposition" | "appointment" | "appointmentOutcome" | "inboundMissed" | "sale" | "issuance"
  | "sms" | "email" | "task" | "wait" | "waitUntilAppointment" | "emailCondition";

/** Display names the builder resolves for a summary. Missing entries fall back to neutral wording. */
export interface SummaryNames {
  campaign?: (id: string) => string | undefined;
  disposition?: (id: string) => string | undefined;
}

interface Definition {
  type: string;
  version: number;
  label: string;
  /** One line for the add-step picker. */
  description: string;
  keywords: string[];
  editor: BlockEditor;
  /** Trigger types this block may follow. Absent means any trigger. Not used by triggers. */
  after?: readonly string[];
  schema: (zod: typeof z) => z.ZodTypeAny;
  check?: (config: Config, trigger: string | null) => string | undefined;
  /** Readable configuration summary for cards, lists and review. Empty when nothing is configured. */
  summary: (config: Config, names?: SummaryNames) => string;
  preview: (ctx: PreviewContext) => PreviewStep;
}

export type BlockDefinition =
  & Definition
  & (
    | { category: "trigger"; execute?: never }
    | {
      category: "action" | "wait" | "condition";
      execute: (
        config: Config,
        ctx: RuntimeContext,
      ) => Outcome | Promise<Outcome>;
    }
  );

export const TASK_TYPES = ["Follow Up", "Send Quote", "Check Application", "Policy Review", "General"] as const;
export const APPOINTMENT_OUTCOMES = ["no_show", "held"] as const;
const UNITS = ["minutes", "hours", "days"] as const;
// Automated messages use the lead delivery path. These triggers can carry a lead.
const MESSAGE_TRIGGERS = [
  "lead_created", "campaign_membership_created", "disposition_recorded", "appointment_booked",
  "appointment_outcome_recorded",
] as const;

/** Who a trigger's runs can be for. Live texts and emails in this release go to leads only; tasks go to anyone. */
export type ContactKind = "lead" | "client" | "recruit";
export function triggerContactKinds(type: string | undefined): ContactKind[] {
  switch (type) {
    case "sale_recorded":
    case "policy_issuance_confirmed":
      return ["client"];
    case "disposition_recorded":
    case "appointment_booked":
    case "appointment_outcome_recorded":
    case "inbound_call_missed":
      return ["lead", "client", "recruit"];
    default:
      return ["lead"];
  }
}

function required(value: unknown, label: string) {
  return typeof value !== "string" || !value.trim() ? label + " is required." : undefined;
}
// Lengths count characters, as the database does. The schema only bounds the raw size.
function withinLimit(value: unknown, label: string, max: number) {
  return typeof value === "string" && characterCount(value) > max
    ? label + " must be " + max.toLocaleString("en-US") + " characters or fewer."
    : undefined;
}
function excerpt(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return !text ? fallback : text.length > 64 ? text.slice(0, 63) + "…" : text;
}
function validOffset(amount: unknown, unit: unknown, minimum: number) {
  return Number.isSafeInteger(amount) && Number(amount) >= minimum && Number(amount) <= 99999 &&
    (UNITS as readonly string[]).includes(String(unit));
}
function sourceSummary(config: Config) {
  return config.lead_source ? "Source: " + String(config.lead_source) : "";
}

export const registrations: BlockDefinition[] = [
  {
    type: "lead_created",
    version: 1,
    editor: "lead",
    preview: previewTrigger,
    label: "New lead created",
    description: "Starts when a lead is added to the agency.",
    keywords: ["lead", "new", "created", "source"],
    category: "trigger",
    schema: (z) => z.object({ lead_source: z.string().optional() }).strict(),
    summary: (c) => sourceSummary(c) || "Any lead source",
  },
  {
    type: "campaign_membership_created",
    version: 1,
    editor: "campaign",
    preview: previewTrigger,
    label: "Lead added to campaign",
    description: "Starts when a lead joins the campaign you choose.",
    keywords: ["campaign", "lead", "added", "membership"],
    category: "trigger",
    schema: (z) =>
      z.object({
        lead_source: z.string().optional(),
        campaign_id: z.string().uuid().optional(),
        any_campaign: z.boolean().optional(),
      }).strict(),
    check: (c) =>
      (c.any_campaign === true) === Boolean(c.campaign_id)
        ? "Choose a campaign or explicitly choose any accessible campaign."
        : undefined,
    summary: (c, names) =>
      [
        c.any_campaign === true
          ? "Any campaign I can manage"
          : c.campaign_id
          ? names?.campaign?.(String(c.campaign_id)) ?? "Selected campaign"
          : "Choose a campaign",
        sourceSummary(c),
      ].filter(Boolean).join(" · "),
  },
  {
    type: "disposition_recorded",
    version: 1,
    editor: "disposition",
    preview: previewTrigger,
    label: "Disposition recorded",
    description: "Starts when a call or contact is saved with a disposition you choose.",
    keywords: ["disposition", "no answer", "call", "outcome", "follow up"],
    category: "trigger",
    schema: (z) => z.object({ disposition_ids: z.array(z.string().uuid()).max(20).optional() }).strict(),
    check: (c) =>
      Array.isArray(c.disposition_ids) && c.disposition_ids.length > 0 ? undefined : "Choose at least one disposition.",
    summary: (c, names) => {
      const ids = Array.isArray(c.disposition_ids) ? c.disposition_ids.map(String) : [];
      if (!ids.length) return "Choose dispositions";
      const shown = ids.slice(0, 2).map((id) => names?.disposition?.(id) ?? "Selected disposition");
      return shown.join(", ") + (ids.length > 2 ? " +" + (ids.length - 2) + " more" : "");
    },
  },
  {
    type: "appointment_booked",
    version: 1,
    editor: "appointment",
    preview: previewTrigger,
    label: "Appointment booked",
    description: "Starts when an appointment is booked with a contact. Callbacks are not included.",
    keywords: ["appointment", "booked", "scheduled", "reminder", "calendar"],
    category: "trigger",
    schema: (z) => z.object({}).strict(),
    summary: () => "Any booked appointment",
  },
  {
    type: "appointment_outcome_recorded",
    version: 1,
    editor: "appointmentOutcome",
    preview: previewTrigger,
    label: "Appointment outcome recorded",
    description: "Starts when someone records that an appointment was held or was a no-show.",
    keywords: ["appointment", "no-show", "no show", "held", "outcome", "reschedule"],
    category: "trigger",
    schema: (z) => z.object({ outcomes: z.array(z.enum(APPOINTMENT_OUTCOMES)).max(2).optional() }).strict(),
    check: (c) => Array.isArray(c.outcomes) && c.outcomes.length > 0 ? undefined : "Choose at least one outcome.",
    summary: (c) => {
      const chosen = Array.isArray(c.outcomes) ? c.outcomes.map(String) : [];
      if (!chosen.length) return "Choose an outcome";
      return chosen.map((value) => value === "no_show" ? "No-show" : "Held").join(" or ");
    },
  },
  {
    type: "inbound_call_missed",
    version: 1,
    editor: "inboundMissed",
    preview: previewTrigger,
    label: "Inbound call missed",
    description: "Starts when an inbound call ends without anyone answering.",
    keywords: ["inbound", "missed", "call", "callback", "voicemail"],
    category: "trigger",
    schema: (z) => z.object({}).strict(),
    summary: () => "Unanswered inbound calls",
  },
  {
    type: "sale_recorded",
    version: 1,
    editor: "sale",
    preview: previewTrigger,
    label: "Sale recorded",
    description: "Starts when a new policy sale is recorded.",
    keywords: ["sale", "policy", "sold", "application", "client"],
    category: "trigger",
    schema: (z) => z.object({}).strict(),
    summary: () => "New policy sales",
  },
  {
    type: "policy_issuance_confirmed",
    version: 1,
    editor: "issuance",
    preview: previewTrigger,
    label: "Policy issuance confirmed",
    description: "Starts when someone confirms that a policy was issued.",
    keywords: ["policy", "issued", "issuance", "delivery", "client"],
    category: "trigger",
    schema: (z) => z.object({}).strict(),
    summary: () => "Confirmed policy issuances",
  },
  {
    type: "send_sms",
    version: 1,
    editor: "sms",
    after: MESSAGE_TRIGGERS,
    preview: previewSms,
    execute: runMessage("send_sms"),
    label: "Send SMS",
    description: "Texts the contact.",
    keywords: ["sms", "text", "message"],
    category: "action",
    schema: (z) =>
      z.object({
        body: z.string().max(3200),
        purpose: z.enum(["informational", "marketing"]),
        template_id: z.string().uuid().optional(),
      }).strict(),
    check: (c, trigger) =>
      !["informational", "marketing"].includes(String(c.purpose))
        ? "Choose the SMS purpose."
        : required(c.body, "Message") ?? withinLimit(c.body, "Message", 1600) ?? fieldIssue(c.body, "Message", trigger),
    summary: (c) => excerpt(c.body, "Write a message"),
  },
  {
    type: "send_sms",
    version: 2,
    editor: "sms",
    after: MESSAGE_TRIGGERS,
    preview: previewSms,
    execute: runMessage("send_sms"),
    label: "Send SMS",
    description: "Texts the contact.",
    keywords: ["sms", "text", "message"],
    category: "action",
    schema: (z) => z.object({ body: z.string().max(3200), template_id: z.string().uuid().optional() }).strict(),
    check: (c, trigger) => required(c.body, "Message") ?? withinLimit(c.body, "Message", 1600) ?? fieldIssue(c.body, "Message", trigger),
    summary: (c) => excerpt(c.body, "Write a message"),
  },
  {
    type: "send_email",
    version: 1,
    editor: "email",
    after: MESSAGE_TRIGGERS,
    preview: previewEmail,
    execute: runMessage("send_email"),
    label: "Send email",
    description: "Emails the contact from a verified agency sender.",
    keywords: ["email", "message", "mail"],
    category: "action",
    schema: (z) =>
      z.object({
        body: z.string().max(40000),
        subject: z.string().max(400),
        sender_id: z.string().uuid(),
        template_id: z.string().uuid().optional(),
      }).strict(),
    check: (c, trigger) =>
      !c.sender_id
        ? "Select an authorized sender."
        : required(c.subject, "Subject") ?? withinLimit(c.subject, "Subject", 200) ?? fieldIssue(c.subject, "Subject", trigger) ??
          required(c.body, "Message") ?? withinLimit(c.body, "Message", 20000) ?? fieldIssue(c.body, "Message", trigger),
    summary: (c) => excerpt(c.subject, "Add a subject"),
  },
  {
    type: "create_task",
    version: 1,
    editor: "task",
    preview: previewTask,
    execute: runCreateTask,
    label: "Create task for assigned agent",
    description: "Adds a task for the contact's assigned agent. A missed call without an owner becomes a callback in Inbounds.",
    keywords: ["task", "call", "callback", "follow up", "reminder", "to do"],
    category: "action",
    schema: (z) =>
      z.object({
        title: z.string().max(400),
        task_type: z.enum(TASK_TYPES),
        notes: z.string().max(4000).optional(),
        due_amount: z.number().int().min(0).max(99999),
        due_unit: z.enum(UNITS),
      }).strict(),
    check: (c, trigger) =>
      required(c.title, "Task title") ?? withinLimit(c.title, "Task title", 200) ?? fieldIssue(c.title, "Task title", trigger) ??
        (!(TASK_TYPES as readonly string[]).includes(String(c.task_type)) ? "Choose a task type." : undefined) ??
        (!validOffset(c.due_amount, c.due_unit, 0) ? "Choose when the task is due." : undefined) ??
        withinLimit(c.notes, "Notes", 2000) ?? fieldIssue(c.notes, "Notes", trigger),
    summary: (c) =>
      [
        excerpt(c.title, "Add a task title"),
        validOffset(c.due_amount, c.due_unit, 0)
          ? Number(c.due_amount) === 0 ? "due right away" : "due in " + offsetLabel(c.due_amount, c.due_unit)
          : "",
      ].filter(Boolean).join(" · "),
  },
  {
    type: "wait",
    version: 1,
    editor: "wait",
    preview: previewWait,
    execute: runWait,
    label: "Wait",
    description: "Pauses for a set time before the next step.",
    keywords: ["wait", "delay", "pause", "minutes", "hours", "days"],
    category: "wait",
    schema: (z) =>
      z.object({
        duration: z.number().int().positive().max(99999),
        unit: z.enum(UNITS),
      }).strict(),
    check: (c) =>
      !validOffset(c.duration, c.unit, 1) ? "Choose a positive whole duration and unit." : undefined,
    summary: (c) => validOffset(c.duration, c.unit, 1) ? offsetLabel(c.duration, c.unit) : "Choose a duration",
  },
  {
    type: "wait_until_before_appointment",
    version: 1,
    editor: "waitUntilAppointment",
    after: ["appointment_booked"],
    preview: previewWaitUntil,
    execute: runWait,
    label: "Wait until before appointment",
    description: "Pauses until a set time before the appointment starts. Follows reschedules.",
    keywords: ["wait", "before", "appointment", "reminder", "timing"],
    category: "wait",
    schema: (z) =>
      z.object({
        amount: z.number().int().positive().max(99999),
        unit: z.enum(UNITS),
        late: z.enum(["skip", "continue"]).optional(),
      }).strict(),
    check: (c) =>
      !validOffset(c.amount, c.unit, 1)
        ? "Choose how long before the appointment."
        : c.late !== undefined && c.late !== "skip" && c.late !== "continue"
        ? "Choose what happens when the time has already passed."
        : undefined,
    summary: (c) =>
      validOffset(c.amount, c.unit, 1) ? offsetLabel(c.amount, c.unit) + " before the appointment" : "Choose a time",
  },
  {
    type: "contact_has_email",
    version: 1,
    editor: "emailCondition",
    after: MESSAGE_TRIGGERS,
    preview: previewEmailCondition,
    execute: runEmailCondition,
    label: "Contact has email",
    description: "Sends contacts with an email down Yes and everyone else down No.",
    keywords: ["condition", "email", "branch", "if"],
    category: "condition",
    schema: (z) => z.object({}).strict(),
    summary: () => "Yes when the contact has an email address",
  },
];

export function registeredBlock(type: string, version: number) {
  return registrations.find((entry) =>
    entry.type === type && entry.version === version
  );
}
