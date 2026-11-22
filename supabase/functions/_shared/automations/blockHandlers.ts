import { renderMergeFields } from "../workflowMergeFields.ts";

export type Config = Record<string, unknown>;
export type Outcome = { status: string; reason?: string };
export type MessageType = "send_email" | "send_sms";

export interface RuntimeContext {
  status: string;
  withContact(
    handler: (contact: Config) => Outcome | Promise<Outcome>,
  ): Promise<Outcome>;
  send(type: MessageType, config: Config, contact: Config): Promise<Outcome>;
}

export interface PreviewContext {
  type: string;
  label: string;
  config: Config;
  input: Config;
}
export interface PreviewStep {
  detail: string;
  hold?: boolean;
  branch?: "yes" | "no";
}

export function previewTrigger(
  { type, label, config, input }: PreviewContext,
): PreviewStep {
  const hold = Boolean(
    (input.trigger && input.trigger !== type) ||
      (config.lead_source && config.lead_source !== input.lead_source) ||
      (config.campaign_id && !config.any_campaign &&
        config.campaign_id !== input.campaign_id),
  );
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

export function previewEmailCondition(
  { label, input }: PreviewContext,
): PreviewStep {
  if (input.lookup_failed === true) {
    return { detail: "Held: contact lookup unavailable.", hold: true };
  }
  const branch = String(input.email ?? "").trim() ? "yes" : "no";
  return { branch, detail: label + (branch === "yes" ? " — Yes" : " — No") };
}

export function previewSms({ config, input }: PreviewContext): PreviewStep {
  const hold = !input.phone || input.sms_eligible === false;
  const body = renderMergeFields(String(config.body ?? ""), input);
  return {
    hold,
    detail: "SMS (" + config.purpose + ") · " + body +
      (hold ? " · Held: destination or SMS eligibility unavailable." : ""),
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
  const subject = renderMergeFields(String(config.subject ?? ""), input);
  const body = renderMergeFields(String(config.body ?? ""), input);
  const hold = !sender || !input.email || input.email_eligible === false;
  return {
    hold,
    detail: "Email · " + identity + " · " + subject + " · " + body +
      (hold
        ? " · Held: sender, destination or email eligibility unavailable."
        : ""),
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
