import React from "react";
import StatCard from "./StatCard";
import { computeAllStats, type StatInputs } from "@/lib/stat-computations";

/** Map every stat id to its card. Loading / failed / unavailable stats render as such — never as 0. */
export function buildStatComponents(inputs: StatInputs): Record<string, React.ReactNode> {
  const components: Record<string, React.ReactNode> = {};
  computeAllStats(inputs).forEach((r, id) => {
    components[id] = (
      <StatCard label={r.label} value={r.value} subtitle={r.subtitle} category={r.category} state={r.state} smallValue={r.smallValue} noteTone={r.noteTone} />
    );
  });
  return components;
}
