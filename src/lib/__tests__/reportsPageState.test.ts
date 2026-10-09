/**
 * U-6: where the Reports layout editor may appear and when Customize is enabled (plan §5.10).
 */
import { describe, expect, it } from "vitest";
import { customizerState, type CustomizerInput } from "@/lib/reports-page-state";
import type { RangeProblem, ReportPreset } from "@/lib/reports-format";

const base: CustomizerInput = {
  scopeReady: true, withheld: false, preset: "30d", rangeSet: true, rangeProblem: null,
  sectionsReady: true, editMode: false, layoutReady: true, busy: false,
};
const state = (overrides: Partial<CustomizerInput>) => customizerState({ ...base, ...overrides });
/** The page builds sections only for a ready, current scope with a runnable range. */
const pageSections = (i: Partial<CustomizerInput>) => {
  const v = { ...base, ...i };
  return v.scopeReady && v.rangeSet && v.rangeProblem === null && !v.withheld;
};

describe("customizerState", () => {
  it("keeps the normal case unchanged: the editor lives inside the tabpanel", () => {
    expect(state({})).toEqual({ customRangePending: false, customizationReady: true, placement: null });
    expect(state({ editMode: true })).toEqual({ customRangePending: false, customizationReady: true, placement: "panel" });
  });

  const pending: [string, { rangeSet: boolean; rangeProblem: RangeProblem }][] = [
    ["no dates yet", { rangeSet: false, rangeProblem: null }],
    ["end before start", { rangeSet: true, rangeProblem: "order" }],
    ["longer than the scope allows", { rangeSet: true, rangeProblem: "too_long" }],
  ];

  it.each(pending)("a Custom range with %s disables entry but keeps an open session visible on its own", (_label, range) => {
    const input = { preset: "custom" as const, ...range, sectionsReady: false };
    expect(pageSections(input)).toBe(false);
    expect(state(input)).toEqual({ customRangePending: true, customizationReady: false, placement: null });
    // Already editing: the editor renders outside the (missing) tabpanel and Customize stays enabled to cancel.
    expect(state({ ...input, editMode: true })).toEqual({ customRangePending: true, customizationReady: true, placement: "standalone" });
    expect(state({ ...input, editMode: true, busy: true }).customizationReady).toBe(false);
  });

  it("never shows the editor while the report is withheld, or before the scope resolves", () => {
    for (const preset of ["30d", "custom"] as ReportPreset[]) {
      for (const rangeSet of [true, false]) {
        const withheld = state({ preset, rangeSet, withheld: true, sectionsReady: false, editMode: true });
        expect(withheld).toEqual({ customRangePending: false, customizationReady: false, placement: null });
        const unresolved = state({ preset, rangeSet, scopeReady: false, sectionsReady: false, editMode: true });
        expect(unresolved.customRangePending).toBe(false);
        expect(unresolved.placement).toBeNull();
      }
    }
  });

  it("keeps Customize disabled until the viewer's own layout is ready (View As stays idle) and while saving", () => {
    for (const editMode of [false, true]) {
      expect(state({ editMode, layoutReady: false }).customizationReady).toBe(false);
      expect(state({ editMode, busy: true }).customizationReady).toBe(false);
    }
    // A pending Custom range never opens the editor for a viewer whose layout is not ready.
    expect(state({ preset: "custom", rangeSet: false, sectionsReady: false, layoutReady: false })).toMatchObject({ customizationReady: false, placement: null });
  });

  it("needs sections to enter edit mode, but an open session can always be left", () => {
    expect(state({ sectionsReady: false }).customizationReady).toBe(false);
    expect(state({ sectionsReady: false, editMode: true }).customizationReady).toBe(true);
    // A preset that cannot run (longer than the scope allows) has no editor to show; Customize still cancels.
    expect(state({ rangeProblem: "too_long", sectionsReady: false, editMode: true })).toEqual({ customRangePending: false, customizationReady: true, placement: null });
  });

  it("covers every combination consistently", () => {
    const bools = [false, true];
    for (const scopeReady of bools) for (const withheld of bools) for (const preset of ["7d", "custom"] as ReportPreset[])
      for (const rangeSet of bools) for (const rangeProblem of [null, "order", "too_long"] as RangeProblem[])
        for (const editMode of bools) for (const layoutReady of bools) for (const busy of bools) {
          const input = { scopeReady, withheld, preset, rangeSet, rangeProblem, editMode, layoutReady, busy };
          const sectionsReady = pageSections(input);
          const s = state({ ...input, sectionsReady });
          if (s.placement === "panel") expect(sectionsReady && editMode).toBe(true);
          if (s.placement === "standalone") expect(!sectionsReady && editMode && s.customRangePending).toBe(true);
          if (s.customRangePending) expect(sectionsReady).toBe(false);
          if (withheld || !layoutReady || busy) expect(s.customizationReady).toBe(false);
          if (!editMode) expect(s.placement).toBeNull();
        }
  });
});
