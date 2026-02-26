import React, { useState } from "react";
import { Search, Plus, Pause, Play, Settings, Users, Phone, BarChart3 } from "lucide-react";

const campaigns = [
  {
    title: "Q1 Facebook Leads",
    type: "Open Pool",
    typeColor: "bg-primary/10 text-primary",
    status: "Active",
    statusColor: "bg-success/10 text-success",
    total: 200,
    available: 153,
    claimed: 47,
    called: 89,
    agents: ["CG", "SJ", "MT", "LR"],
  },
  {
    title: "My Direct Mail Leads",
    type: "Personal",
    typeColor: "bg-success/10 text-success",
    status: "Active",
    statusColor: "bg-success/10 text-success",
    total: 50,
    available: 38,
    claimed: 12,
    called: 12,
    agents: ["CG"],
  },
  {
    title: "Medicare Supplement Push",
    type: "Team",
    typeColor: "bg-info/10 text-info",
    status: "Paused",
    statusColor: "bg-warning/10 text-warning",
    total: 120,
    available: 72,
    claimed: 48,
    called: 35,
    agents: ["SJ", "MT"],
  },
  {
    title: "Referral Follow-ups",
    type: "Personal",
    typeColor: "bg-success/10 text-success",
    status: "Active",
    statusColor: "bg-success/10 text-success",
    total: 30,
    available: 18,
    claimed: 12,
    called: 8,
    agents: ["CG"],
  },
  {
    title: "Google Ads Q1",
    type: "Open Pool",
    typeColor: "bg-primary/10 text-primary",
    status: "Draft",
    statusColor: "bg-muted text-muted-foreground",
    total: 150,
    available: 150,
    claimed: 0,
    called: 0,
    agents: [],
  },
];

const filterTabs = ["All", "Active", "Paused", "Draft"];

const detailLeads = [
  { name: "John D.", state: "FL", age: 34, source: "Facebook", attempts: 0 },
  { name: "Sarah W.", state: "TX", age: 45, source: "Facebook", attempts: 1 },
  { name: "Mike P.", state: "CA", age: 52, source: "Facebook", attempts: 0 },
  { name: "Lisa K.", state: "NY", age: 38, source: "Facebook", attempts: 2 },
  { name: "Tom H.", state: "OH", age: 41, source: "Facebook", attempts: 0 },
  { name: "Amy Z.", state: "WA", age: 29, source: "Facebook", attempts: 1 },
  { name: "David B.", state: "FL", age: 55, source: "Facebook", attempts: 3 },
  { name: "Maria L.", state: "AZ", age: 33, source: "Facebook", attempts: 0 },
];

const Campaigns: React.FC = () => {
  const [filter, setFilter] = useState("All");
  const [detail, setDetail] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState("Leads");

  const filtered = filter === "All" ? campaigns : campaigns.filter((c) => c.status === filter);

  if (detail) {
    const camp = campaigns.find((c) => c.title === detail)!;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setDetail(null)} className="text-muted-foreground hover:text-foreground">Campaigns</button>
          <span className="text-muted-foreground">/</span>
          <span className="text-foreground font-medium">{camp.title}</span>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{camp.title}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${camp.typeColor}`}>{camp.type}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${camp.statusColor}`}>{camp.status}</span>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded-lg bg-warning/10 text-warning text-sm font-medium flex items-center gap-2 hover:bg-warning/20 sidebar-transition"><Pause className="w-4 h-4" /> Pause</button>
            <button className="px-3 py-2 rounded-lg bg-accent text-foreground text-sm flex items-center gap-2 hover:bg-accent/80 sidebar-transition"><Settings className="w-4 h-4" /> Settings</button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total", value: camp.total },
            { label: "Available", value: camp.available },
            { label: "Claimed", value: camp.claimed },
            { label: "Called", value: camp.called },
            { label: "Connection Rate", value: "34%" },
          ].map((s) => (
            <div key={s.label} className="bg-card rounded-lg border p-3 text-center">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold text-foreground mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          {["Leads", "Stats", "Settings"].map((t) => (
            <button key={t} onClick={() => setDetailTab(t)} className={`px-4 py-2.5 text-sm font-medium sidebar-transition ${detailTab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
          ))}
        </div>

        {detailTab === "Leads" && (
          <div className="bg-card rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-muted-foreground border-b bg-accent/50">
                  <th className="w-10 py-3 px-3"><input type="checkbox" className="rounded" /></th>
                  <th className="text-left py-3 font-medium">First Name</th>
                  <th className="text-left py-3 font-medium">State</th>
                  <th className="text-left py-3 font-medium">Age</th>
                  <th className="text-left py-3 font-medium">Source</th>
                  <th className="text-center py-3 font-medium">Attempts</th>
                  <th className="w-20 py-3"></th>
                </tr></thead>
                <tbody>
                  {detailLeads.map((l) => (
                    <tr key={l.name} className="border-b last:border-0 hover:bg-accent/30 sidebar-transition">
                      <td className="py-3 px-3"><input type="checkbox" className="rounded" /></td>
                      <td className="py-3 font-medium text-foreground">{l.name}</td>
                      <td className="py-3"><span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">{l.state}</span></td>
                      <td className="py-3 text-foreground">{l.age}</td>
                      <td className="py-3 text-muted-foreground">{l.source}</td>
                      <td className="py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {Array.from({ length: 3 }).map((_, j) => (
                            <div key={j} className={`w-1.5 h-1.5 rounded-full ${j < l.attempts ? "bg-primary" : "bg-muted"}`} />
                          ))}
                        </div>
                      </td>
                      <td className="py-3"><button className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 sidebar-transition">Dial</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {detailTab === "Stats" && (
          <div className="bg-card rounded-xl border p-6 text-center">
            <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Campaign performance charts and agent breakdown will appear here.</p>
          </div>
        )}

        {detailTab === "Settings" && (
          <div className="bg-card rounded-xl border p-6 space-y-4">
            {[["Campaign Name", camp.title], ["Type", camp.type], ["Dial Mode", "Power Dialer"], ["Calling Hours", "9:00 AM - 6:00 PM EST"], ["Max Attempts", "3"], ["Retry Interval", "24 hours"]].map(([k, v]) => (
              <div key={k} className="flex justify-between py-2 border-b last:border-0">
                <span className="text-sm text-muted-foreground">{k}</span>
                <span className="text-sm font-medium text-foreground">{v}</span>
              </div>
            ))}
            <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition">Edit Campaign</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Campaigns</h1>
        <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 sidebar-transition"><Plus className="w-4 h-4" /> Create Campaign</button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-accent rounded-lg p-0.5">
          {filterTabs.map((t) => (
            <button key={t} onClick={() => setFilter(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium sidebar-transition ${filter === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search campaigns..." className="w-full h-9 pl-9 pr-4 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((c) => (
          <div key={c.title} className="bg-card rounded-xl border p-5 hover:shadow-md sidebar-transition cursor-pointer" onClick={() => setDetail(c.title)}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-semibold text-foreground">{c.title}</h3>
              <div className="flex gap-1.5">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.typeColor}`}>{c.type}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.statusColor}`}>{c.status}</span>
              </div>
            </div>
            <div className="mb-3">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{c.claimed} claimed</span>
                <span>{c.total} total</span>
              </div>
              <div className="w-full h-2 rounded-full bg-accent overflow-hidden">
                <div className="h-full rounded-full bg-primary sidebar-transition" style={{ width: `${(c.claimed / c.total) * 100}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center mb-3">
              {[
                { label: "Total", value: c.total },
                { label: "Available", value: c.available },
                { label: "Claimed", value: c.claimed },
                { label: "Called", value: c.called },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-lg font-bold text-foreground">{s.value}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <div className="flex -space-x-2">
                {c.agents.map((a) => (
                  <div key={a} className="w-7 h-7 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center border-2 border-card">{a}</div>
                ))}
              </div>
              {c.status === "Active" && (
                <button onClick={(e) => e.stopPropagation()} className="text-xs text-warning hover:underline flex items-center gap-1"><Pause className="w-3 h-3" /> Pause</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Campaigns;
