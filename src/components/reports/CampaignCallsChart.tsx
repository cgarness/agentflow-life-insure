import React from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount } from "@/lib/reports-format";
import type { ReportCampaigns } from "@/lib/reports-schemas";
import { SERIES_COLOR } from "./reportChartTheme";

type CampaignRow = ReportCampaigns["campaigns"][number];

const tick = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
};
const textStyle = { color: "hsl(var(--foreground))" };
/** Axis labels are cut at 24 characters; the tooltip names the campaign in full. */
const truncate = (s: string) => (s.length > 24 ? `${s.slice(0, 24)}…` : s);

/**
 * The busiest campaigns by calls made (server order), shown from sm up. Below sm it is hidden and the
 * table is the view.
 */
const CampaignCallsChart: React.FC<{ data: CampaignRow[] }> = ({ data }) => (
  <div className="mb-5 hidden sm:block">
    <p className="mb-2 text-xs font-medium text-muted-foreground">Top {formatCount(data.length)} by calls made</p>
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 40 + 48)}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
        <CartesianGrid stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" tick={tick} allowDecimals={false} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }}
          tickFormatter={(v: number) => formatCount(v)} />
        <YAxis type="category" dataKey="name" width={168} tick={tick} tickFormatter={truncate} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={textStyle} itemStyle={textStyle} cursor={{ fill: "hsl(var(--muted))" }}
          isAnimationActive={false} formatter={(v: number, name: string) => [formatCount(v), name]} />
        <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8}
          formatter={(value: string) => <span className="text-xs text-muted-foreground">{value}</span>} />
        <Bar dataKey="calls_made" name="Calls made" fill="hsl(var(--primary) / 0.3)" radius={[0, 4, 4, 0]} barSize={10} />
        <Bar dataKey="contacted_calls" name="Contacted calls" fill={SERIES_COLOR} radius={[0, 4, 4, 0]} barSize={10} />
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export default CampaignCallsChart;
