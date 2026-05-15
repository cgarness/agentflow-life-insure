import { z } from "zod";
import {
  Zap, MessageSquare, Mail, ArrowRight, Tag, TagIcon, User, Globe,
  ListChecks, Bot, GitBranch, Clock, type LucideIcon,
} from "lucide-react";

export type WorkflowStatus = "draft" | "active" | "paused" | "archived";

export type TriggerType =
  | "disposition"
  | "stage_change"
  | "lead_created"
  | "time_based"
  | "tag_added"
  | "tag_removed"
  | "manual"
  | "call_completed"
  | "call_missed"
  | "appointment_booked"
  | "appointment_cancelled"
  | "appointment_no_show"
  | "sms_received"
  | "email_replied"
  | "lead_converted"
  | "contact_field_changed"
  | "contact_dnc"
  | "birthday_approaching"
  | "custom_date_approaching"
  | "stale_lead"
  | "task_completed"
  | "task_overdue";

export type NodeKind = "trigger" | "condition" | "action" | "wait";

export type ActionType =
  | "send_sms"
  | "send_email"
  | "update_stage"
  | "add_tag"
  | "remove_tag"
  | "assign_agent"
  | "create_task"
  | "assign_ai_agent"
  | "webhook";

export interface WorkflowRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown> | null;
  folder_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowFolderRow {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: string;
}

export interface WorkflowNodeRow {
  id: string;
  workflow_id: string;
  organization_id: string;
  type: NodeKind;
  action_type: ActionType | null;
  config: Record<string, unknown> | null;
  label: string | null;
  position_x: number;
  position_y: number;
  created_at: string;
}

export interface WorkflowEdgeRow {
  id: string;
  workflow_id: string;
  organization_id: string;
  source_node_id: string;
  target_node_id: string;
  condition_branch: "yes" | "no" | null;
  created_at: string;
}

export interface WorkflowExecutionRow {
  id: string;
  workflow_id: string;
  organization_id: string;
  contact_id: string | null;
  contact_type: string | null;
  status: "running" | "completed" | "failed" | "paused";
  current_node_id: string | null;
  trigger_event: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface WorkflowExecutionStepRow {
  id: string;
  execution_id: string;
  organization_id: string;
  node_id: string | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  input_data: Record<string, unknown> | null;
  output_data: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
}

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  disposition: "When a disposition is selected",
  stage_change: "When a lead changes stage",
  lead_created: "When a new lead is created",
  time_based: "When no contact in X days",
  tag_added: "When a tag is added",
  tag_removed: "When a tag is removed",
  manual: "Manual trigger",
  call_completed: "When a call is completed",
  call_missed: "When a call is missed",
  appointment_booked: "When an appointment is booked",
  appointment_cancelled: "When an appointment is cancelled",
  appointment_no_show: "When an appointment is a no-show",
  sms_received: "When an SMS is received",
  email_replied: "When an email reply is received",
  lead_converted: "When a lead is converted to client",
  contact_field_changed: "When a contact field changes",
  contact_dnc: "When a contact is added to DNC",
  birthday_approaching: "When a birthday is approaching",
  custom_date_approaching: "When a custom date is approaching",
  stale_lead: "When a lead goes stale",
  task_completed: "When a task is completed",
  task_overdue: "When a task is overdue",
};

export const TRIGGER_COMING_SOON: Partial<Record<TriggerType, true>> = {
  email_replied: true,
  task_completed: true,
  task_overdue: true,
};

export interface TriggerGroup {
  label: string;
  triggers: TriggerType[];
}

export const TRIGGER_GROUPS: TriggerGroup[] = [
  {
    label: "Contact Activity",
    triggers: [
      "disposition", "stage_change", "lead_created",
      "lead_converted", "contact_field_changed", "contact_dnc",
    ],
  },
  { label: "Tags", triggers: ["tag_added", "tag_removed"] },
  { label: "Calls", triggers: ["call_completed", "call_missed"] },
  {
    label: "Appointments",
    triggers: ["appointment_booked", "appointment_cancelled", "appointment_no_show"],
  },
  { label: "Messages", triggers: ["sms_received", "email_replied"] },
  {
    label: "Time-Based",
    triggers: ["time_based", "birthday_approaching", "custom_date_approaching", "stale_lead"],
  },
  { label: "Tasks", triggers: ["task_completed", "task_overdue"] },
  { label: "Other", triggers: ["manual"] },
];

export interface ActionMeta {
  type: ActionType;
  label: string;
  icon: LucideIcon;
  comingSoon?: boolean;
}

export const ACTION_METAS: ActionMeta[] = [
  { type: "send_sms", label: "Send SMS", icon: MessageSquare },
  { type: "send_email", label: "Send Email", icon: Mail },
  { type: "update_stage", label: "Update Stage", icon: ArrowRight },
  { type: "add_tag", label: "Add Tag", icon: Tag },
  { type: "remove_tag", label: "Remove Tag", icon: TagIcon },
  { type: "assign_agent", label: "Assign Agent", icon: User },
  { type: "webhook", label: "Webhook", icon: Globe },
  { type: "create_task", label: "Create Task", icon: ListChecks, comingSoon: true },
  { type: "assign_ai_agent", label: "AI Agent", icon: Bot, comingSoon: true },
];

export const LOGIC_METAS = [
  { kind: "condition" as NodeKind, label: "Condition (If/Else)", icon: GitBranch },
  { kind: "wait" as NodeKind, label: "Wait (Delay)", icon: Clock },
];

export const STATUS_BADGE: Record<WorkflowStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  active: { label: "Active", className: "bg-emerald-500/15 text-emerald-500" },
  paused: { label: "Paused", className: "bg-yellow-500/15 text-yellow-500" },
  archived: { label: "Archived", className: "bg-muted/50 text-muted-foreground/60" },
};

export function actionMeta(type: ActionType | null | undefined): ActionMeta | undefined {
  if (!type) return undefined;
  return ACTION_METAS.find((a) => a.type === type);
}

export function triggerIcon(): LucideIcon {
  return Zap;
}

const TRACKED_FIELD_LABELS: Record<string, string> = {
  first_name: "First Name",
  last_name: "Last Name",
  email: "Email",
  phone: "Phone",
  state: "State",
  lead_source: "Source",
  assigned_agent_id: "Assigned Agent",
};

/**
 * Best-effort human-readable label from trigger type + config alone (no DB
 * lookups). The trigger panel's <TriggerSummary> upgrades this with real
 * disposition/stage/source names where possible.
 */
export function formatTriggerLabelSync(
  triggerType: TriggerType,
  config: Record<string, unknown> | null,
): string {
  const c = config ?? {};
  switch (triggerType) {
    case "time_based": {
      const days = Number(c.days ?? 7);
      return `No contact in ${days} day${days === 1 ? "" : "s"}`;
    }
    case "birthday_approaching": {
      const days = Number(c.days_before ?? 7);
      return `Birthday in ${days} day${days === 1 ? "" : "s"}`;
    }
    case "stale_lead": {
      const days = Number(c.days ?? 14);
      return `Stale lead (${days}+ days inactive)`;
    }
    case "custom_date_approaching": {
      const field = String(c.field_name ?? "custom date");
      const days = Number(c.days_before ?? 30);
      return `${field} in ${days} day${days === 1 ? "" : "s"}`;
    }
    case "tag_added":
      return `Tag Added: "${String(c.tag ?? "")}"`;
    case "tag_removed":
      return `Tag Removed: "${String(c.tag ?? "")}"`;
    case "sms_received": {
      const k = String(c.keyword_filter ?? "");
      return k ? `SMS received containing "${k}"` : "SMS received";
    }
    case "contact_field_changed": {
      const f = String(c.field_name ?? "");
      const label = TRACKED_FIELD_LABELS[f] ?? f;
      return label ? `Field changed: ${label}` : "Any field changed";
    }
    case "appointment_booked":
    case "appointment_cancelled":
    case "appointment_no_show": {
      const t = String(c.appointment_type ?? "");
      return t ? `${TRIGGER_LABELS[triggerType]} (${t})` : TRIGGER_LABELS[triggerType];
    }
    default:
      return TRIGGER_LABELS[triggerType];
  }
}

export const TRACKED_FIELDS = Object.entries(TRACKED_FIELD_LABELS).map(([value, label]) => ({
  value,
  label,
}));

// ─────────────────── Zod Schemas ───────────────────

const TRIGGER_VALUES: [TriggerType, ...TriggerType[]] = [
  "disposition", "stage_change", "lead_created", "time_based",
  "tag_added", "tag_removed", "manual",
  "call_completed", "call_missed",
  "appointment_booked", "appointment_cancelled", "appointment_no_show",
  "sms_received", "email_replied",
  "lead_converted", "contact_field_changed", "contact_dnc",
  "birthday_approaching", "custom_date_approaching", "stale_lead",
  "task_completed", "task_overdue",
];

export const newWorkflowSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  trigger_type: z.enum(TRIGGER_VALUES),
  trigger_config: z.record(z.unknown()).default({}),
});

export type NewWorkflowInput = z.infer<typeof newWorkflowSchema>;

const noConfigSchema = z.object({}).default({});
const appointmentTypeSchema = z.object({
  appointment_type: z.string().trim().max(100).optional().nullable(),
});

export const triggerConfigSchemas: Record<TriggerType, z.ZodTypeAny> = {
  disposition: z.object({ disposition_id: z.string().uuid("Select a disposition") }),
  stage_change: z.object({
    pipeline_type: z.enum(["lead", "recruit"]).default("lead"),
    from_stage_id: z.string().optional().nullable(),
    to_stage_id: z.string().uuid("Select a target stage"),
  }),
  lead_created: z.object({ source_id: z.string().optional().nullable() }),
  time_based: z.object({
    days: z.coerce.number().int().min(1).max(365),
    applies_to: z.enum(["leads", "clients", "recruits"]).default("leads"),
    condition: z.literal("no_contact").default("no_contact"),
  }),
  tag_added: z.object({ tag: z.string().trim().min(1, "Enter a tag name").max(50) }),
  tag_removed: z.object({ tag: z.string().trim().min(1, "Enter a tag name").max(50) }),
  manual: noConfigSchema,
  call_completed: noConfigSchema,
  call_missed: noConfigSchema,
  appointment_booked: appointmentTypeSchema,
  appointment_cancelled: appointmentTypeSchema,
  appointment_no_show: appointmentTypeSchema,
  sms_received: z.object({
    keyword_filter: z.string().trim().max(100).optional().nullable(),
  }),
  email_replied: noConfigSchema,
  lead_converted: noConfigSchema,
  contact_field_changed: z.object({
    field_name: z.string().trim().min(1, "Select a field"),
  }),
  contact_dnc: noConfigSchema,
  birthday_approaching: z.object({
    days_before: z.coerce.number().int().min(0).max(365).default(7),
    applies_to: z.enum(["leads", "clients"]).default("leads"),
  }),
  custom_date_approaching: z.object({
    field_name: z.string().trim().min(1, "Select a custom date field"),
    days_before: z.coerce.number().int().min(0).max(365).default(30),
  }),
  stale_lead: z.object({
    days: z.coerce.number().int().min(1).max(365).default(14),
  }),
  task_completed: noConfigSchema,
  task_overdue: noConfigSchema,
};

export const sendSmsSchema = z.object({
  template_id: z.string().optional().nullable(),
  body: z.string().trim().min(1).max(1600),
});

export const sendEmailSchema = z.object({
  template_id: z.string().optional().nullable(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
});

export const updateStageSchema = z.object({
  pipeline_type: z.enum(["lead", "recruit"]).default("lead"),
  stage_id: z.string().uuid(),
});

export const tagSchema = z.object({ tag: z.string().trim().min(1).max(50) });

export const assignAgentSchema = z.object({
  agent_id: z.string().uuid().optional().nullable(),
  round_robin: z.boolean().default(false),
});

export const webhookSchema = z.object({
  url: z.string().url("Enter a valid URL"),
  method: z.enum(["POST", "PUT"]).default("POST"),
  headers: z.string().optional(),
});

export const conditionSchema = z.object({
  field: z.enum([
    "email", "phone", "tag", "state", "pipeline_stage",
    "lead_source", "assigned_agent", "custom_field",
  ]),
  operator: z.enum([
    "is_empty", "is_not_empty", "equals", "not_equals",
    "contains", "greater_than", "less_than",
  ]),
  value: z.string().optional().nullable(),
  custom_field_key: z.string().optional().nullable(),
});

const WAIT_UNIT_MINUTES: Record<string, number> = { minutes: 1, hours: 60, days: 1440 };

export const waitEditorSchema = z.object({
  duration: z.coerce.number().int().min(1).max(10000),
  unit: z.enum(["minutes", "hours", "days"]).default("hours"),
});

/** Persisted shape — the executor reads `duration_minutes`. */
export const waitSchema = z.object({
  duration_minutes: z.coerce.number().int().min(1).max(60 * 24 * 365),
  duration: z.coerce.number().int().min(1).max(10000).optional(),
  unit: z.enum(["minutes", "hours", "days"]).optional(),
});

export function waitConfigToMinutes(duration: number, unit: string): number {
  const m = WAIT_UNIT_MINUTES[unit] ?? 60;
  const out = Math.round(duration * m);
  return Number.isFinite(out) && out > 0 ? out : 1440;
}

export const folderSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a color").default("#6366f1"),
});

export type FolderInput = z.infer<typeof folderSchema>;

export const MERGE_FIELDS = [
  "{{first_name}}",
  "{{last_name}}",
  "{{phone}}",
  "{{email}}",
  "{{agent_name}}",
];
