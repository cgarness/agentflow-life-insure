/**
 * reports-page-state.ts — where the Reports layout editor may appear (plan §5.10, U-6).
 *
 * Pure, so every combination can be tested. The editor normally lives inside the scope tabpanel. The one
 * exception is an edit session that is still open when the user picks an incomplete or invalid Custom
 * range: the tabpanel is gone then, so the editor renders on its own instead of becoming invisible.
 */
import type { RangeProblem, ReportPreset } from "@/lib/reports-format";

export interface CustomizerInput {
  /** `get_report_scope()` resolved for the current viewer. */
  scopeReady: boolean;
  /** Scope drift or a missing agency time zone: nothing may render under stale labels. */
  withheld: boolean;
  preset: ReportPreset;
  /** Both Custom range dates are set (always true for a preset once the scope resolved). */
  rangeSet: boolean;
  rangeProblem: RangeProblem;
  /** The report sections (and with them the tabpanel) render. */
  sectionsReady: boolean;
  editMode: boolean;
  /** The viewer's own layout has loaded (never another owner's; View As stays idle). */
  layoutReady: boolean;
  busy: boolean;
}

export interface CustomizerState {
  /** A Custom range that cannot run yet, on a ready, current, non-withheld scope. */
  customRangePending: boolean;
  /** The toolbar Customize button is enabled. In edit mode it cancels, so it stays enabled to leave. */
  customizationReady: boolean;
  /** Inside the tabpanel, on its own (only for a pending Custom range), or not rendered. */
  placement: "panel" | "standalone" | null;
}

export function customizerState(input: CustomizerInput): CustomizerState {
  const customRangePending = input.scopeReady && !input.withheld && input.preset === "custom"
    && (!input.rangeSet || input.rangeProblem !== null);
  const layoutUsable = input.layoutReady && !input.busy && !input.withheld;
  // Entering edit mode needs sections to edit; an open session can always be left (Customize cancels).
  const customizationReady = input.editMode ? layoutUsable : layoutUsable && input.sectionsReady;
  const placement = !input.editMode ? null
    : input.sectionsReady ? "panel"
    : customRangePending ? "standalone"
    : null;
  return { customRangePending, customizationReady, placement };
}
