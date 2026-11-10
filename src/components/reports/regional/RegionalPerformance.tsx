import React, { Suspense, useMemo, useState } from "react";
import type { ReportStateBreakdownV3 } from "@/lib/reports-v3-schemas";
import { formatModeValue, modeUnit, modeValue, REGIONAL_MODES, REGIONAL_MODE_LABELS, stateName, type RegionalMode } from "@/lib/reports-regional";
import { buildStateScale } from "@/lib/reports-scale";
import { CUE_NOT_ENOUGH_DATA, SHORT_CUES } from "@/lib/reports-v3-text";
import { REASON_KIND } from "@/lib/reports-v3-schemas";
import ReportSection from "../ReportSection";
import ReportSegmented from "../ReportSegmented";
import ScaleLegend from "../ScaleLegend";
import StateMapSmallStates from "./StateMapSmallStates";
import StateDetails from "./StateDetails";
import StateTable from "./StateTable";
import UnmappedNotice from "./UnmappedNotice";

const StateMap = React.lazy(() => import("./StateMap"));
class MapBoundary extends React.Component<{ onError: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? <p className="py-6 text-center text-sm text-muted-foreground">Map couldn't load.</p> : this.props.children; }
}

/** Section 5: Regional performance (D5). Default metric Calls; map or table; status cue and disclosure. */
const RegionalPerformance: React.FC<{ data: ReportStateBreakdownV3; onExport?: () => void }> = ({ data, onExport }) => {
  const [mode, setMode] = useState<RegionalMode>("calls_made");
  const [view, setView] = useState<"map" | "table">("map");
  const [selected, setSelected] = useState<string | null>(null);
  const status = data.modes[mode];
  const values = data.jurisdictions.map(j => modeValue(j, mode));
  const scale = useMemo(() => buildStateScale(values), [values]);
  const unavailable = status.status === "unavailable";
  const states = [...data.jurisdictions].sort((a, b) => stateName(a.state).localeCompare(stateName(b.state))).map(j => {
    const v = modeValue(j, mode);
    return { code: j.state, level: unavailable ? null : scale.levelOf(v), label: `${stateName(j.state)}, ${formatModeValue(v, mode)} ${mode === "ap" ? "AP" : modeUnit(mode, v ?? 0)}` };
  });
  const cue = unavailable && status.reason ? (REASON_KIND[status.reason] === "coverage" ? CUE_NOT_ENOUGH_DATA : SHORT_CUES[status.reason]) : null;
  const fmt = (v: number) => (mode === "ap" ? formatModeValue(v * 100 / 100, mode) : v.toLocaleString("en-US"));
  return (
    <ReportSection title="Regional performance" onExport={onExport}>
      <div className="space-y-3" data-report-section="regional_performance">
        <div className="flex flex-wrap items-center gap-2">
          <ReportSegmented className="max-w-full overflow-x-auto" ariaLabel="Map metric" value={mode} onChange={v => setMode(v as RegionalMode)} options={REGIONAL_MODES.map(m => [m, REGIONAL_MODE_LABELS[m]] as const)} />
          <ReportSegmented ariaLabel="View" value={view} onChange={v => setView(v as "map" | "table")} options={[["map", "Map"], ["table", "Table"]] as const} />
          {cue && <span className="text-xs text-muted-foreground">{cue}</span>}
        </div>
        <UnmappedNotice data={data} mode={mode} />
        {view === "map" ? (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <MapBoundary onError={() => setView("table")}>
              <Suspense fallback={<div className="aspect-[1016/596] w-full animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />}>
                <StateMap states={states} selected={selected} onSelect={setSelected} />
              </Suspense>
            </MapBoundary>
            <div className="space-y-3">
              <StateMapSmallStates labels={Object.fromEntries(states.map(s => [s.code, s.label]))} selected={selected} onSelect={setSelected} />
              <StateDetails row={data.jurisdictions.find(j => j.state === selected) ?? null} onClear={() => setSelected(null)} />
              {!unavailable && scale.max > 0 && (
                <ScaleLegend noActivityLabel="No activity" ranges={scale.breaks.map(([a, b]) => (mode === "ap" ? `${formatModeValue(a, mode)}–${formatModeValue(b, mode)}` : `${fmt(a)}–${fmt(b)}`))} />
              )}
            </div>
          </div>
        ) : <StateTable data={data} />}
      </div>
    </ReportSection>
  );
};

export default RegionalPerformance;
