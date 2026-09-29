import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { formatCount, formatRate } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { ReportCampaigns } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import ReportSection from "./ReportSection";

type CampaignRow = ReportCampaigns["campaigns"][number];

const CHART_TOP_N = 10;

const COLUMNS: { label: string; numeric: boolean }[] = [
  { label: "Campaign", numeric: false },
  { label: "Type", numeric: false },
  { label: "Calls made", numeric: true },
  { label: "Contacted calls", numeric: true },
  { label: "Call contact rate", numeric: true },
  { label: "Leads dialed", numeric: true },
  { label: "Contacted leads", numeric: true },
  { label: "Converted leads", numeric: true },
  { label: "Policies sold", numeric: true },
];

interface Props {
  campaigns: ReportCampaigns;
  onExport?: ReportExportFn;
}

const tick = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
};
const textStyle = { color: "hsl(var(--foreground))" };
const truncate = (s: string) => (s.length > 18 ? `${s.slice(0, 18)}…` : s);

const cellClass = "py-3 px-4 text-right tabular-nums text-muted-foreground font-medium";

const CampaignPerformance: React.FC<Props> = ({ campaigns, onExport }) => {
  const navigate = useNavigate();
  const rows = campaigns.campaigns;

  // Server order is calls_made DESC; the chart shows the busiest campaigns that placed calls.
  const chartData = useMemo(() => rows.filter((c) => c.calls_made > 0).slice(0, CHART_TOP_N), [rows]);

  const handleExport = onExport
    ? () =>
        onExport(
          "Campaign Performance",
          COLUMNS.map((c) => (c.label === "Call contact rate" ? "Call contact rate %" : c.label)),
          rows.map((c) => [
            c.name,
            c.type,
            c.calls_made,
            c.contacted_calls,
            c.contact_rate_pct,
            c.leads_dialed,
            c.contacted_leads,
            c.converted_leads,
            c.policies_sold,
          ]),
        )
    : undefined;

  const open = (c: CampaignRow) => navigate(`/campaigns/${c.campaign_id}`);

  return (
    <ReportSection title="Campaign Performance" onExport={handleExport}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No campaign activity in this period.</p>
      ) : (
        <>
          {chartData.length > 0 && (
            <>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">
                Calls made vs contacted calls{rows.length > chartData.length ? ` · top ${chartData.length} by calls` : ""}
              </p>
              <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 48 + 40)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={tick} allowDecimals={false} tickFormatter={(v: number) => formatCount(v)} />
                  <YAxis type="category" dataKey="name" width={140} tick={tick} tickFormatter={truncate} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={textStyle}
                    itemStyle={textStyle}
                    cursor={{ fill: "hsl(var(--muted))" }}
                    formatter={(v: number, name: string) => [formatCount(v), name]}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="circle"
                    iconSize={8}
                    formatter={(value: string) => <span className="text-[11px] text-muted-foreground">{value}</span>}
                  />
                  <Bar dataKey="calls_made" name="Calls made" fill="hsl(var(--primary) / 0.35)" radius={[0, 4, 4, 0]} barSize={12} />
                  <Bar dataKey="contacted_calls" name="Contacted calls" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}

          <div className={cn("overflow-x-auto rounded-xl border border-border", chartData.length > 0 && "mt-6")}>
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="border-b border-border">
                  {COLUMNS.map((c) => (
                    <th
                      key={c.label}
                      className={cn(
                        "py-3 px-4 text-muted-foreground font-bold uppercase tracking-wider text-[10px] whitespace-nowrap",
                        c.numeric ? "text-right" : "text-left",
                      )}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((c) => (
                  <tr
                    key={c.campaign_id}
                    className="group hover:bg-muted/40 cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-muted/40"
                    onClick={() => open(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        open(c);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                  >
                    <td className="py-3 px-4 font-bold text-foreground group-hover:text-primary transition-colors">{c.name}</td>
                    <td className="py-3 px-4">
                      <Badge variant="secondary" className="bg-muted text-muted-foreground font-bold text-[10px] px-2 py-0.5 rounded-md border-none">
                        {c.type}
                      </Badge>
                    </td>
                    <td className={cellClass}>{formatCount(c.calls_made)}</td>
                    <td className={cellClass}>{formatCount(c.contacted_calls)}</td>
                    <td className="py-3 px-4 text-right tabular-nums font-bold text-foreground">{formatRate(c.contact_rate_pct)}</td>
                    <td className={cellClass}>{formatCount(c.leads_dialed)}</td>
                    <td className={cellClass}>{formatCount(c.contacted_leads)}</td>
                    <td className={cellClass}>{formatCount(c.converted_leads)}</td>
                    <td className="py-3 px-4 text-right tabular-nums font-bold text-foreground">{formatCount(c.policies_sold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {rows.length > 0 && (
        <p className="text-[11px] text-muted-foreground mt-3">
          Outbound calls. Converted leads are unique campaign leads given a converting disposition; policies sold are recorded wins.
        </p>
      )}
      {campaigns.unattributed_calls > 0 && (
        <p className="text-[11px] text-muted-foreground mt-1">
          {formatCount(campaigns.unattributed_calls)} outbound calls in this period have no campaign.
        </p>
      )}
    </ReportSection>
  );
};

export default CampaignPerformance;
