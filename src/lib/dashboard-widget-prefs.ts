/**
 * dashboard-widget-prefs — pure normalization for the personal Dashboard layout.
 *
 * Preferences live in `user_preferences.settings` as a free-form JSON blob with no
 * schema and no version, so anything can be in there: keys for widgets that were
 * renamed or removed, duplicates, non-strings, or nothing at all. `Dashboard.tsx`
 * previously accepted whatever it found after a bare `Array.isArray` check, which
 * meant an unknown key rendered a card with an `undefined` title and an empty body,
 * a newly added widget never appeared for existing users, and a widget hidden under
 * a stale key could never be restored through the UI.
 *
 * Everything here is pure and synchronous so it can be unit-tested without a DOM
 * or a Supabase client. Preferences are personal to the logged-in user; this module
 * never reads or writes anything itself.
 */

/** Canonical widget keys, in default display order. */
export const DASHBOARD_WIDGET_KEYS = [
  "callbacks",
  "appointments",
  "goal_progress",
  "leaderboard",
  "missed_calls",
  "anniversaries",
] as const;

export type DashboardWidgetKey = (typeof DASHBOARD_WIDGET_KEYS)[number];

/**
 * Legacy / alternate keys mapped onto their canonical key.
 *
 * `schedule` is accepted because the widget's user-facing label is "Schedule"
 * (approved decision D6) while its persisted key stays `appointments`. Accepting
 * the alias now means a future key rename cannot orphan a saved layout.
 */
const WIDGET_KEY_ALIASES: Record<string, DashboardWidgetKey> = {
  schedule: "appointments",
  goals: "goal_progress",
  goalprogress: "goal_progress",
  missedcalls: "missed_calls",
};

const CANONICAL = new Set<string>(DASHBOARD_WIDGET_KEYS);

export interface DashboardWidgetPreferences {
  /** Every canonical key exactly once, in display order. */
  order: DashboardWidgetKey[];
  /** Subset of `order` that is hidden; every entry canonical and unique. */
  hidden: DashboardWidgetKey[];
}

/** The layout used when nothing is saved, or when what is saved is unusable. */
export function defaultWidgetPreferences(): DashboardWidgetPreferences {
  return { order: [...DASHBOARD_WIDGET_KEYS], hidden: [] };
}

/** Resolve one raw value to a canonical key, or `null` if it is not a widget. */
export function canonicalizeWidgetKey(raw: unknown): DashboardWidgetKey | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (CANONICAL.has(key)) return key as DashboardWidgetKey;
  return WIDGET_KEY_ALIASES[key] ?? null;
}

/** Canonicalize a raw list, dropping unknowns and de-duplicating, order preserved. */
function canonicalizeList(raw: unknown): DashboardWidgetKey[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<DashboardWidgetKey>();
  const out: DashboardWidgetKey[] = [];
  for (const entry of raw) {
    const key = canonicalizeWidgetKey(entry);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Normalize whatever is stored into a usable layout.
 *
 * Guarantees, in order of importance:
 *  - the result always contains **every** canonical key exactly once, so a newly
 *    added widget appears for users with an older saved order (appended at the end);
 *  - unknown, removed, duplicated and non-string keys are dropped;
 *  - legacy aliases resolve to their canonical key without duplicating the widget;
 *  - `hidden` is always a subset of the canonical keys;
 *  - a completely absent or unusable blob yields the safe default.
 */
export function normalizeWidgetPreferences(
  rawOrder: unknown,
  rawHidden: unknown,
): DashboardWidgetPreferences {
  const savedOrder = canonicalizeList(rawOrder);
  // Append any canonical key the saved order does not mention, in default order.
  const order = savedOrder.length > 0
    ? [...savedOrder, ...DASHBOARD_WIDGET_KEYS.filter((k) => !savedOrder.includes(k))]
    : [...DASHBOARD_WIDGET_KEYS];

  const hidden = canonicalizeList(rawHidden);

  return { order, hidden };
}

/** Visible keys, in order — the list the grid renders. */
export function visibleWidgetKeys(prefs: DashboardWidgetPreferences): DashboardWidgetKey[] {
  return prefs.order.filter((k) => !prefs.hidden.includes(k));
}

/**
 * Hidden keys the UI should offer to restore.
 *
 * Derived from `order` rather than from `hidden` directly so the list can never
 * contain a key the grid does not know how to render — the old bug where a widget
 * hidden under a stale key became permanently unrestorable.
 */
export function restorableWidgetKeys(prefs: DashboardWidgetPreferences): DashboardWidgetKey[] {
  return prefs.order.filter((k) => prefs.hidden.includes(k));
}

/** The shape persisted back into `user_preferences.settings`. */
export function serializeWidgetPreferences(prefs: DashboardWidgetPreferences): {
  dashboard_widget_order: DashboardWidgetKey[];
  dashboard_hidden_widgets: DashboardWidgetKey[];
} {
  return {
    dashboard_widget_order: prefs.order,
    dashboard_hidden_widgets: prefs.hidden,
  };
}
