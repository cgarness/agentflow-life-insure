import React, { useState } from "react";
import { Download, Filter } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";

const COLORS = ["hsl(217,91%,60%)", "hsl(142,76%,36%)", "hsl(38,92%,50%)", "hsl(0,84%,60%)", "hsl(270,60%,50%)"];

const callVolume = [
  { name: "Chris G.", calls: 47, duration: 3.2 },
  { name: "Sarah J.", calls: 42, duration: 3.8 },
  { name: "Mike T.", calls: 38, duration: 2.9 },
  { name: "Lisa R.", calls: 35, duration: 3.5 },
  { name: "James W.", calls: 29, duration: 4.1 },
];

const outcomes = [
  { name: "Answered", value: 198, pct: "58%" },
  { name: "No Answer", value: 97, pct: "28%" },
  { name: "Voicemail", value: 47, pct: "14%" },
];

const dispositions = [
  { name: "Interested", value: 89, color: "bg-success" },
  { name: "Not Interested", value: 45, color: "bg-destructive" },
  { name: "Call Back", value: 32, color: "bg-warning" },
  { name: "Left Voicemail", value: 47, color: "bg-primary" },
  { name: "Appointment Set", value: 34, color: "bg-info" },
  { name: "Policy Sold", value: 23, color: "bg-success" },
];

const funnel = [
  { stage: "Total Calls", value: 342, pct: "100%" },
  { stage: "Answered", value: 198, pct: "58%" },
  { stage: "Interested", value: 89, pct: "45%" },
  { stage: "Appointment Set", value: 34, pct: "38%" },
  { stage: "Policy Sold", value: 23, pct: "68%" },
];

const policiesTrend = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  Chris: Math.floor(Math.random() * 3),
  Sarah: Math.floor(Math.random() * 2),
  Mike: Math.floor(Math.random() * 2),
}));

const Reports: React.FC = () => {
  const [dateRange] = useState("Last 30 Days");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Reports</h1>
        <div className="flex items-center gap-3">
          <button className="h-9 px-3 rounded-lg bg-accent text-foreground text-sm flex items-center gap-2 hover:bg-accent/80 sidebar-transition">{dateRange}</button>
          <button className="h-9 px-3 rounded-lg bg-accent text-foreground text-sm flex items-center gap-2 hover:bg-accent/80 sidebar-transition"><Filter className="w-4 h-4" /> Filters</button>
          <button className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 sidebar-transition"><Download className="w-4 h-4" /> Export All</button>
        </div>
      </div>

      {/* Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-foreground mb-4">Call Volume by Agent</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={callVolume}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="name" className="text-xs" tick={{ fill: 'hsl(215,16%,47%)' }} />
              <YAxis className="text-xs" tick={{ fill: 'hsl(215,16%,47%)' }} />
              <ReTooltip />
              <Bar dataKey="calls" fill="hsl(217,91%,60%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-foreground mb-4">Call Outcomes</h3>
          <div className="flex gap-3 mb-4">
            <div className="px-3 py-1.5 rounded-lg bg-accent text-foreground text-sm font-medium">Total: <span className="font-bold">342</span></div>
            {outcomes.map((o) => (
              <div key={o.name} className="px-3 py-1.5 rounded-lg bg-accent text-muted-foreground text-sm">{o.name}: <span className="font-medium text-foreground">{o.value}</span> ({o.pct})</div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={outcomes} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, pct }) => `${name} ${pct}`}>
                {outcomes.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <ReTooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-foreground mb-4">Disposition Breakdown</h3>
          <div className="space-y-3">
            {dispositions.map((d) => (
              <div key={d.name} className="flex items-center gap-3">
                <span className="text-sm text-foreground w-32 shrink-0">{d.name}</span>
                <div className="flex-1 h-4 rounded-full bg-accent overflow-hidden">
                  <div className={`h-full rounded-full ${d.color}`} style={{ width: `${(d.value / 342) * 100}%` }} />
                </div>
                <span className="text-sm font-medium text-foreground w-10 text-right">{d.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-foreground mb-4">Conversion Funnel</h3>
          <div className="space-y-2">
            {funnel.map((f, i) => (
              <div key={f.stage} className="relative">
                <div
                  className="rounded-lg bg-primary/10 py-3 px-4 flex items-center justify-between sidebar-transition"
                  style={{ width: `${Math.max(20, 100 - i * 18)}%`, marginLeft: `${i * 9}%` }}
                >
                  <span className="text-sm font-medium text-foreground">{f.stage}</span>
                  <div className="text-right">
                    <span className="text-sm font-bold text-foreground">{f.value}</span>
                    {i > 0 && <span className="text-xs text-primary ml-1">({f.pct})</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-foreground mb-2">Policies Sold (30 Days)</h3>
          <p className="text-sm text-muted-foreground mb-4">23 policies · $8,450 total premium</p>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={policiesTrend}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="day" tick={{ fill: 'hsl(215,16%,47%)' }} />
              <YAxis tick={{ fill: 'hsl(215,16%,47%)' }} />
              <ReTooltip />
              <Legend />
              <Line type="monotone" dataKey="Chris" stroke="hsl(217,91%,60%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Sarah" stroke="hsl(142,76%,36%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Mike" stroke="hsl(38,92%,50%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-foreground mb-4">Lead Source Performance</h3>
          <div className="space-y-3">
            {[
              { source: "Facebook Ads", leads: 85, conversion: "12%", roi: "$4.20" },
              { source: "Referral", leads: 28, conversion: "25%", roi: "$8.50" },
              { source: "Direct Mail", leads: 45, conversion: "15%", roi: "$3.10" },
              { source: "Google Ads", leads: 62, conversion: "9%", roi: "$2.80" },
              { source: "Webinar", leads: 20, conversion: "18%", roi: "$5.60" },
            ].map((s) => (
              <div key={s.source} className="flex items-center gap-3">
                <span className="text-sm text-foreground w-28 shrink-0">{s.source}</span>
                <div className="flex-1 h-4 rounded-full bg-accent overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(s.leads / 85) * 100}%` }} />
                </div>
                <span className="text-xs text-muted-foreground w-16 text-right">{s.leads} leads</span>
                <span className="text-xs font-medium text-success w-12 text-right">{s.conversion}</span>
              </div>
            ))}
            <div className="pt-2 border-t">
              <span className="text-xs text-primary font-medium">🏆 Best Source: Referral (25% conversion)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 4 - Communications */}
      <div className="bg-card rounded-xl border p-5">
        <h3 className="font-semibold text-foreground mb-4">Communications Stats</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Calls", value: "342" },
            { label: "Total Talk Time", value: "48.2 hrs" },
            { label: "Avg Duration", value: "3:24" },
            { label: "Best Day", value: "Tuesday" },
          ].map((s) => (
            <div key={s.label} className="bg-accent/50 rounded-lg p-4 text-center">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold text-foreground mt-1">{s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Reports;
