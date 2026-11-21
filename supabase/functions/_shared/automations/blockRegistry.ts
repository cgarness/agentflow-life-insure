import type { z } from "zod";
import {
  type Config,
  type Outcome,
  type PreviewContext,
  previewEmail,
  previewEmailCondition,
  previewSms,
  type PreviewStep,
  previewTrigger,
  previewWait,
  runEmailCondition,
  runMessage,
  type RuntimeContext,
  runWait,
} from "./blockHandlers.ts";

interface Definition {
  type: string;
  version: number;
  label: string;
  editor: "lead" | "campaign" | "sms" | "email" | "wait" | "emailCondition";
  schema: (zod: typeof z) => z.ZodTypeAny;
  check?: (config: Config) => string | undefined;
  preview: (ctx: PreviewContext) => PreviewStep;
}

type BlockDefinition =
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

function copyIssue(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    return label + " is required.";
  }
  const rest = value.replace(
    /\{\{\s*(first_name|last_name|email|phone)\s*\}\}/g,
    "",
  );
  if (/\{\{|\}\}/.test(rest)) {
    return label + " contains an unsupported merge field.";
  }
}

export const registrations: BlockDefinition[] = [
  {
    type: "lead_created",
    version: 1,
    editor: "lead",
    preview: previewTrigger,
    label: "New lead created",
    category: "trigger",
    schema: (z) => z.object({ lead_source: z.string().optional() }).strict(),
  },
  {
    type: "campaign_membership_created",
    version: 1,
    editor: "campaign",
    preview: previewTrigger,
    label: "Lead added to campaign",
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
  },
  {
    type: "send_sms",
    version: 1,
    editor: "sms",
    preview: previewSms,
    execute: runMessage("send_sms"),
    label: "Send SMS",
    category: "action",
    schema: (z) =>
      z.object({
        body: z.string().max(1600),
        purpose: z.enum(["informational", "marketing"]),
        template_id: z.string().uuid().optional(),
      }).strict(),
    check: (c) =>
      !["informational", "marketing"].includes(String(c.purpose))
        ? "Choose the SMS purpose."
        : copyIssue(c.body, "Message"),
  },
  {
    type: "send_email",
    version: 1,
    editor: "email",
    preview: previewEmail,
    execute: runMessage("send_email"),
    label: "Send email",
    category: "action",
    schema: (z) =>
      z.object({
        body: z.string().max(20000),
        subject: z.string().max(200),
        sender_id: z.string().uuid(),
        template_id: z.string().uuid().optional(),
      }).strict(),
    check: (c) =>
      !c.sender_id
        ? "Select an authorized sender."
        : copyIssue(c.subject, "Subject") || copyIssue(c.body, "Message"),
  },
  {
    type: "wait",
    version: 1,
    editor: "wait",
    preview: previewWait,
    execute: runWait,
    label: "Wait",
    category: "wait",
    schema: (z) =>
      z.object({
        duration: z.number().int().positive().max(99999),
        unit: z.enum(["minutes", "hours", "days"]),
      }).strict(),
    check: (c) =>
      !Number.isSafeInteger(c.duration) || Number(c.duration) <= 0 ||
        !["minutes", "hours", "days"].includes(String(c.unit))
        ? "Choose a positive whole duration and unit."
        : undefined,
  },
  {
    type: "contact_has_email",
    version: 1,
    editor: "emailCondition",
    preview: previewEmailCondition,
    execute: runEmailCondition,
    label: "Contact has email",
    category: "condition",
    schema: (z) => z.object({}).strict(),
  },
];

export function registeredBlock(type: string, version: number) {
  return registrations.find((entry) =>
    entry.type === type && entry.version === version
  );
}
