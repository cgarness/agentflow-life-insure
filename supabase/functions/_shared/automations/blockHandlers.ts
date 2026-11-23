import { fieldValues, renderFields } from "./fields.ts";

export type Config = Record<string, unknown>;
export type Outcome = { status: string; reason?: string };
export type MessageType = "send_email" | "send_sms";

export interface RuntimeContext {
  status: string;
  withContact(
    handler: (contact: Config) => Outcome | Promise<Outcome>,
  ): Promise<Outcome>;
  send(type: MessageType, config: Config, contact: Config): Promise<Outcome>;
  createTask(config: Config): Promise<Outcome>;
}

export interface PreviewContext {
  type: string;
  label: string;
  /** The author's name for the step, when it has one. */
  name?: string;
  config: Config;
  input: Config;
}
export interface PreviewStep {
  detail: string;
  hold?: boolean;
  branch?: "yes" | "no";
}

const UNIT_MS: Record<string, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

export function offsetLabel(amount: unknown, unit: unknown): string {
  const count = Number(amount);
  const name = String(unit ?? "");
  if (!Number.isFinite(count) || !UNIT_MS[name]) return "";
  return count + " " + (count === 1 ? name.slice(0, -1) : name);
}

function previewValues(input: Config) {
  return fieldValues({
    contact: input,
    appointment_start: typeof input.appointment_start === "string" ? input.appointment_start : null,
    timezone: typeof input.timezone === "string" ? input.timezone : null,
  });
}

function mismatch(config: Config, input: Config): boolean {
  const dispositions = Array.isArray(config.disposition_ids) ? config.disposition_ids : null;
  const outcomes = Array.isArray(config.outcomes) ? config.outcomes : null;
  return Boolean(
    (config.lead_source && config.lead_source !== input.lead_source) ||
      (config.campaign_id && !config.any_campaign && config.campaign_id !== input.campaign_id) ||
      (dispositions && input.disposition_id && !dispositions.includes(input.disposition_id)) ||
      (outcomes && input.outcome && !outcomes.includes(input.outcome)),
  );
}

export function previewTrigger(
  { type, label, config, input }: PreviewContext,
): PreviewStep {
  const hold = Boolean(input.trigger && input.trigger !== type) || mismatch(config, input);
  return {
    hold,
    detail: label +
      (hold
        ? " — synthetic event does not match the selected audience."
        : " — synthetic event qualifies."),
  };
}

export function previewWait({ config }: PreviewContext): PreviewStep {
  return { detail: "Wait " + config.duration + " " + config.unit };
}

export function previewWaitUntil({ config, input }: PreviewContext): PreviewStep {
  const offset = offsetLabel(config.amount, config.unit);
  const base = "Wait until " + offset + " before the appointment";
  const start = typeof input.appointment_start === "string" ? Date.parse(input.appointment_start) : NaN;
  if (Number.isNaN(start)) return { detail: base + " · Held: enter a test appointment time.", hold: true };
  const due = start - Number(config.amount) * (UNIT_MS[String(config.unit)] ?? 0);
  const now = typeof input.now === "number" ? input.now : Date.now();
  if (due > now) return { detail: base };
  // A run whose appointment has already started ends at this step, whatever the author chose for a late reminder.
  if (start <= now) return { detail: base + " · The appointment has already started, so the remaining steps are skipped.", hold: true };
  return config.late === "continue"
    ? { detail: base + " · That time has passed, so the next step runs right away." }
    : { detail: base + " · That time has passed, so the remaining steps are skipped.", hold: true };
}

export function previewEmailCondition(
  { label, input }: PreviewContext,
): PreviewStep {
  if (input.lookup_failed === true) {
    return { detail: "Held: contact lookup unavailable.", hold: true };
  }
  const branch = String(input.email ?? "").trim() ? "yes" : "no";
  return { branch, detail: label + (branch === "yes" ? " — Yes" : " — No") };
}

function missingHold(missing: string[]): string {
  return missing.length ? " · Held: " + missing.join(" and ") + " need a test appointment time and time zone." : "";
}

export function previewSms({ config, input }: PreviewContext): PreviewStep {
  const body = renderFields(config.body, previewValues(input));
  const hold = !input.phone || input.sms_eligible === false || body.missing.length > 0;
  return {
    hold,
    detail: "SMS" + (config.purpose ? " (" + config.purpose + ")" : "") + " · " + body.text + missingHold(body.missing) +
      (!input.phone || input.sms_eligible === false ? " · Held: destination or SMS eligibility unavailable." : ""),
  };
}

export function previewEmail({ config, input }: PreviewContext): PreviewStep {
  const identities = input.email_senders as
    | Record<string, { from_email: string; reply_to: string }>
    | undefined;
  const sender = identities?.[String(config.sender_id)];
  const identity = sender
    ? sender.from_email + " · Reply to " + sender.reply_to
    : "Sender unavailable";
  const values = previewValues(input);
  const subject = renderFields(config.subject, values);
  const body = renderFields(config.body, values);
  const missing = [...new Set([...subject.missing, ...body.missing])];
  const unavailable = !sender || !input.email || input.email_eligible === false;
  return {
    hold: unavailable || missing.length > 0,
    detail: "Email · " + identity + " · " + subject.text + " · " + body.text + missingHold(missing) +
      (unavailable ? " · Held: sender, destination or email eligibility unavailable." : ""),
  };
}

/** The title a task gets when its fields render to nothing. The database applies the same rule. */
export function fallbackTaskTitle(name: string | undefined, config: Config, trigger: unknown, callerPhone: unknown): string {
  if (name?.trim()) return name.trim();
  if (trigger === "inbound_call_missed") return "Call back " + (typeof callerPhone === "string" && callerPhone.trim() ? callerPhone.trim() : "the caller");
  return String(config.task_type ?? "Follow Up");
}

export function previewTask({ name, config, input }: PreviewContext): PreviewStep {
  const values = previewValues(input);
  const rendered = renderFields(config.title, values);
  const title = rendered.text.trim() ? rendered : { ...rendered, text: fallbackTaskTitle(name, config, input.trigger, input.caller_phone) };
  const notes = renderFields(config.notes, values);
  const missing = [...new Set([...title.missing, ...notes.missing])];
  const due = Number(config.due_amount) === 0 ? "due right away" : "due in " + offsetLabel(config.due_amount, config.due_unit);
  const queue = input.trigger === "inbound_call_missed" && input.responsible_agent === false;
  const noOwner = !queue && input.has_owner === false;
  return {
    hold: noOwner || missing.length > 0,
    detail: (queue ? "Callback in Inbounds" : String(config.task_type ?? "Task") + " task") + " · " + title.text + " · " + due +
      (notes.text ? " · " + notes.text : "") + missingHold(missing) +
      (noOwner ? " · Held: the contact has no active assigned agent." : ""),
  };
}

export function runWait(_config: Config, { status }: RuntimeContext): Outcome {
  return { status: status === "waiting" ? "elapsed" : "wait" };
}
export function runEmailCondition(_config: Config, ctx: RuntimeContext) {
  return ctx.withContact((contact) => {
    if (!Object.prototype.hasOwnProperty.call(contact, "email")) {
      return { status: "held", reason: "Contact email field unavailable" };
    }
    return {
      status: typeof contact.email === "string" && contact.email.trim()
        ? "yes"
        : "no",
    };
  });
}
export function runMessage(type: MessageType) {
  return (config: Config, ctx: RuntimeContext) =>
    ctx.withContact((contact) => ctx.send(type, config, contact));
}
export function runCreateTask(config: Config, ctx: RuntimeContext) {
  return ctx.createTask(config);
}
