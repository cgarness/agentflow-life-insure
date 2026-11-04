import React, { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { US_STATE_GEOMETRY } from "./usStatePaths";
import { SCALE_FILL, NO_ACTIVITY_FILL } from "@/lib/reports-scale";
import { stateName } from "@/lib/reports-regional";

interface Props {
  /** Sorted by state name; each has its level (null = no activity) and its spoken label. */
  states: { code: string; level: number | null; label: string }[];
  selected: string | null;
  onSelect: (code: string | null) => void;
}

/** 51 state paths as toggle buttons with a roving tab stop: arrows and Home/End move by name, Enter/Space selects,
 * Escape clears. Geometry: us-atlas 3.0.1 (ISC), Census 2017 cartographic boundaries; see THIRD_PARTY_NOTICES.md. */
const StateMap: React.FC<Props> = ({ states, selected, onSelect }) => {
  const [focus, setFocus] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const refs = useRef<(SVGPathElement | null)[]>([]);
  const move = (i: number) => { const n = (i + states.length) % states.length; setFocus(n); refs.current[n]?.focus(); };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(i + 1), ArrowDown: () => move(i + 1), ArrowLeft: () => move(i - 1), ArrowUp: () => move(i - 1),
      Home: () => move(0), End: () => move(states.length - 1), Escape: () => onSelect(null),
      Enter: () => onSelect(states[i].code === selected ? null : states[i].code), " ": () => onSelect(states[i].code === selected ? null : states[i].code),
    };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
  };
  const ordered = [...states.map((s, i) => ({ ...s, i }))].sort((a, b) => Number(a.code === selected) - Number(b.code === selected));
  const summary = states.find(s => s.code === (hover ?? states[focus]?.code));
  return (
    <div>
      <svg viewBox={US_STATE_GEOMETRY.viewBox} className="h-auto w-full" role="group" aria-label="Map of states">
        {ordered.map(s => (
          <path key={s.code} ref={el => { refs.current[s.i] = el; }} d={US_STATE_GEOMETRY.paths[s.code]} role="button" tabIndex={s.i === focus ? 0 : -1}
            aria-pressed={s.code === selected} aria-label={s.label} vectorEffect="non-scaling-stroke"
            onClick={() => onSelect(s.code === selected ? null : s.code)} onKeyDown={e => onKey(e, s.i)}
            onFocus={() => setFocus(s.i)} onMouseEnter={() => setHover(s.code)} onMouseLeave={() => setHover(null)}
            className={cn("cursor-pointer stroke-card outline-none transition-colors motion-reduce:transition-none focus-visible:stroke-ring",
              s.level === null ? NO_ACTIVITY_FILL : SCALE_FILL[s.level], s.code === selected ? "stroke-foreground [stroke-width:2]" : "[stroke-width:0.75]")} />
        ))}
      </svg>
      <p className="mt-1 min-h-4 text-xs text-muted-foreground" aria-hidden="true">{summary ? `${stateName(summary.code)} · ${summary.label.split(", ").slice(1).join(", ")}` : ""}</p>
    </div>
  );
};

export default StateMap;
