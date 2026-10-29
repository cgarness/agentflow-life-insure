/**
 * Dashboard category tones (plan §4.1) — the ONE place widget and modal colors live.
 *
 * Blue: Calls and Callbacks · Purple: Appointments and Schedule · Green: Policies and
 * Goal Progress · Gold: Premium and Leaderboard · Red: Missed Calls · Pink: Client
 * Milestones.
 *
 * Every value is a complete literal class string so Tailwind's JIT keeps it. Text
 * tones use 600 in light and 400 in dark for readable contrast on cards.
 */
export type DashboardTone = "blue" | "purple" | "green" | "gold" | "red" | "pink";

export interface ToneClasses {
  /** Solid gradient behind a white icon. */
  chip: string;
  /** Soft tinted surface (header band, icon wells). */
  soft: string;
  border: string;
  /** Accessible accent text. */
  text: string;
  /** Status pill (soft surface + accent text + border). */
  pill: string;
  /** Keyboard focus ring for buttons inside this category. */
  ring: string;
  /** The same ring on a row while a control inside it has keyboard focus (not on mouse clicks). */
  rowRing: string;
  /** Header band gradient. */
  band: string;
}

export const DASHBOARD_TONES: Record<DashboardTone, ToneClasses> = {
  blue: {
    chip: "bg-gradient-to-br from-blue-500 to-blue-600",
    soft: "bg-blue-500/10",
    border: "border-blue-500/20",
    text: "text-blue-600 dark:text-blue-400",
    pill: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    ring: "focus-visible:ring-blue-500/60",
    rowRing: "has-[:focus-visible]:ring-blue-500/50",
    band: "bg-gradient-to-r from-blue-500/10 to-transparent",
  },
  purple: {
    chip: "bg-gradient-to-br from-violet-500 to-violet-600",
    soft: "bg-violet-500/10",
    border: "border-violet-500/20",
    text: "text-violet-600 dark:text-violet-400",
    pill: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    ring: "focus-visible:ring-violet-500/60",
    rowRing: "has-[:focus-visible]:ring-violet-500/50",
    band: "bg-gradient-to-r from-violet-500/10 to-transparent",
  },
  green: {
    chip: "bg-gradient-to-br from-emerald-500 to-emerald-600",
    soft: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    text: "text-emerald-600 dark:text-emerald-400",
    pill: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    ring: "focus-visible:ring-emerald-500/60",
    rowRing: "has-[:focus-visible]:ring-emerald-500/50",
    band: "bg-gradient-to-r from-emerald-500/10 to-transparent",
  },
  gold: {
    chip: "bg-gradient-to-br from-amber-500 to-amber-600",
    soft: "bg-amber-500/10",
    border: "border-amber-500/20",
    text: "text-amber-700 dark:text-amber-400",
    pill: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    ring: "focus-visible:ring-amber-500/60",
    rowRing: "has-[:focus-visible]:ring-amber-500/50",
    band: "bg-gradient-to-r from-amber-500/10 to-transparent",
  },
  red: {
    chip: "bg-gradient-to-br from-red-500 to-rose-600",
    soft: "bg-red-500/10",
    border: "border-red-500/20",
    text: "text-red-600 dark:text-red-400",
    pill: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
    ring: "focus-visible:ring-red-500/60",
    rowRing: "has-[:focus-visible]:ring-red-500/50",
    band: "bg-gradient-to-r from-red-500/10 to-transparent",
  },
  pink: {
    chip: "bg-gradient-to-br from-pink-500 to-rose-500",
    soft: "bg-pink-500/10",
    border: "border-pink-500/20",
    text: "text-pink-600 dark:text-pink-400",
    pill: "border-pink-500/25 bg-pink-500/10 text-pink-700 dark:text-pink-300",
    ring: "focus-visible:ring-pink-500/60",
    rowRing: "has-[:focus-visible]:ring-pink-500/50",
    band: "bg-gradient-to-r from-pink-500/10 to-transparent",
  },
};

/** Neutral pill for statuses that are not the category's own (e.g. "Snoozed"). */
export const NEUTRAL_PILL = "border-border bg-muted text-muted-foreground";
/** Attention pill (overdue callbacks, past Draft Dates). Never used to imply a payment outcome. */
export const ATTENTION_PILL = "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300";
