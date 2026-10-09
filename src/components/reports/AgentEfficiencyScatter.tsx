import React from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { formatRate } from "@/lib/reports-format";
import { SERIES_COLOR, TOOLTIP_FRAME } from "./reportChartTheme";

export interface EfficiencyPoint {
  name: string;
  /** Calls per session hour (session-matched calls ÷ session hours). */
  x: number;
  /** Call contact rate, %. */
  y: number;
}

const tick = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const axisLabel = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

const PointTooltip: React.FC<{ active?: boolean; payload?: Array<{ payload?: EfficiencyPoint }> }> = ({ active, payload }) => {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className={TOOLTIP_FRAME}>
      <p className="mb-1 font-semibold">{p.name}</p>
      <p className="text-muted-foreground">Calls per session hour: {p.x.toFixed(1)}</p>
      <p className="text-muted-foreground">Call contact rate: {formatRate(p.y)}</p>
    </div>
  );
};

/** Agents with both a session rate and a call contact rate; an undefined rate is never plotted as 0. */
const AgentEfficiencyScatter: React.FC<{ points: EfficiencyPoint[] }> = ({ points }) => (
  <div className="mt-5">
    <h4 className="mb-2 text-xs font-medium text-muted-foreground">Calls per session hour vs call contact rate</h4>
    {points.length === 0 ? (
      <p className="py-8 text-center text-sm text-muted-foreground">No agents with both session time and calls made in this period.</p>
    ) : (
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 16, right: 16, bottom: 20, left: 8 }}>
          <CartesianGrid stroke="hsl(var(--border))" />
          <XAxis type="number" dataKey="x" name="Calls per session hour" tick={tick} tickLine={false}
            axisLine={{ stroke: "hsl(var(--border))" }}
            label={{ value: "Calls per session hour", position: "bottom", offset: 0, style: axisLabel }} />
          <YAxis type="number" dataKey="y" name="Call contact rate" unit="%" domain={[0, 100]} tick={tick} tickLine={false} axisLine={false}
            label={{ value: "Call contact rate %", angle: -90, position: "insideLeft", style: axisLabel }} />
          <Tooltip cursor={{ stroke: "hsl(var(--border))" }} content={<PointTooltip />} isAnimationActive={false} />
          <Scatter data={points} fill={SERIES_COLOR} />
        </ScatterChart>
      </ResponsiveContainer>
    )}
  </div>
);

export default AgentEfficiencyScatter;
