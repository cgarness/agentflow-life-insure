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
  | "manual";

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
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
};

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

// ─────────────────── Zod Schemas ───────────────────

export const newWorkflowSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  trigger_type: z.enum([
    "disposition",
    "stage_change",
    "lead_created",
    "time_based",
    "tag_added",
    "tag_removed",
    "manual",
  ]),
  trigger_config: z.record(z.unknown()).default({}),
});

export type NewWorkflowInput = z.infer<typeof newWorkflowSchema>;

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
  manual: z.object({}).default({}),
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

export const waitSchema = z.object({
  duration: z.coerce.number().int().min(1).max(10000),
  unit: z.enum(["minutes", "hours", "days"]).default("hours"),
});

export const MERGE_FIELDS = [
  "{{first_name}}",
  "{{last_name}}",
  "{{phone}}",
  "{{email}}",
  "{{agent_name}}",
];
