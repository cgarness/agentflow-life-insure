import {
  BadgeDollarSign, CalendarCheck, CalendarClock, CalendarPlus, CircleHelp, Clock, FileCheck2, GitBranch, ListChecks, Mail,
  Megaphone, MessageSquareText, PhoneMissed, PhoneOutgoing, Play, UserPlus, Zap, type LucideIcon,
} from "lucide-react";
import { graphBlock, type AutomationNode, type BlockGroup } from "../../../../supabase/functions/_shared/automations/graph";

// Browser-only presentation for registered blocks. The shared registry stays free of React and icons
// because the worker imports it too.
export type StepTone = "trigger" | "action" | "wait" | "condition" | "unknown";

/** Picker sections, in display order. */
export const GROUP_ORDER: readonly BlockGroup[] = ["Triggers", "Actions", "Timing", "Conditions"];

const TYPE_ICONS: Record<string, LucideIcon> = {
  lead_created: UserPlus,
  campaign_membership_created: Megaphone,
  disposition_recorded: PhoneOutgoing,
  appointment_booked: CalendarPlus,
  appointment_outcome_recorded: CalendarCheck,
  inbound_call_missed: PhoneMissed,
  sale_recorded: BadgeDollarSign,
  policy_issuance_confirmed: FileCheck2,
  send_sms: MessageSquareText,
  send_email: Mail,
  create_task: ListChecks,
  wait: Clock,
  wait_until_before_appointment: CalendarClock,
  contact_has_email: GitBranch,
};

const TONE_ICONS: Record<StepTone, LucideIcon> = {
  trigger: Zap, action: Play, wait: Clock, condition: GitBranch, unknown: CircleHelp,
};

// Category chips use action and neutral roles. Status colours stay reserved for statuses.
const TONE_CHIPS: Record<StepTone, string> = {
  trigger: "bg-primary text-primary-foreground",
  action: "bg-badge-info-surface text-badge-info-text",
  wait: "bg-badge-neutral-surface text-badge-neutral-text",
  condition: "bg-secondary text-secondary-foreground",
  unknown: "border border-dashed border-border bg-muted text-muted-foreground",
};

const TONE_LABELS: Record<StepTone, string> = {
  trigger: "Trigger", action: "Action", wait: "Timing", condition: "Condition", unknown: "Unsupported step",
};

export interface BlockVisual {
  icon: LucideIcon;
  tone: StepTone;
  /** Tailwind classes for the small icon chip. */
  chip: string;
  /** Category name in words, for places that cannot rely on the icon. */
  category: string;
}

export function blockVisual(type: string, category?: string): BlockVisual {
  const tone: StepTone = category === "trigger" || category === "action" || category === "wait" || category === "condition"
    ? category : "unknown";
  return {icon: TYPE_ICONS[type] ?? TONE_ICONS[tone], tone, chip: TONE_CHIPS[tone], category: TONE_LABELS[tone]};
}

export function stepVisual(node: AutomationNode): BlockVisual {
  return blockVisual(node.type, graphBlock(node)?.category);
}
