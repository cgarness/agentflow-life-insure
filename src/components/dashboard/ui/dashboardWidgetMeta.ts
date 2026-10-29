import { Calendar, Gift, Phone, PhoneMissed, Target, Trophy } from "lucide-react";
import type { DashboardWidgetKey } from "@/lib/dashboard-widget-prefs";
import type { DashboardTone } from "@/components/dashboard/ui/dashboardTones";

/** Detail-modal types a widget can open (the `ModalType` subset). */
export type WidgetModalType = "callbacks" | "appointments" | "missed_calls" | "anniversaries";

export interface WidgetMeta {
  label: string;
  icon: React.ElementType;
  tone: DashboardTone;
  /** The detail view the header opens, if any. */
  modalType: WidgetModalType | null;
}

/**
 * Labels, icons and category tones of the Dashboard widgets. Persisted keys are
 * unchanged: `appointments` is labelled "Schedule" (earlier decision D6) and
 * `anniversaries` is labelled "Client Milestones" (this build).
 */
export const DASHBOARD_WIDGET_META: Record<DashboardWidgetKey, WidgetMeta> = {
  callbacks: { label: "Callbacks", icon: Phone, tone: "blue", modalType: "callbacks" },
  appointments: { label: "Schedule", icon: Calendar, tone: "purple", modalType: "appointments" },
  goal_progress: { label: "Goal Progress", icon: Target, tone: "green", modalType: null },
  leaderboard: { label: "Leaderboard", icon: Trophy, tone: "gold", modalType: null },
  missed_calls: { label: "Missed Calls", icon: PhoneMissed, tone: "red", modalType: "missed_calls" },
  anniversaries: { label: "Client Milestones", icon: Gift, tone: "pink", modalType: "anniversaries" },
};
