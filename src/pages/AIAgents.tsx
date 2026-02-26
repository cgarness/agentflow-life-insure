import React, { useState } from "react";
import { Bot, Plus, Pause, Play, MessageSquare, Phone, Mail, Settings, ArrowRight } from "lucide-react";

const agents = [
  {
    name: "Sarah",
    role: "Appointment Setter",
    avatar: "bg-primary/10 text-primary",
    type: "Voice",
    typeBadge: "bg-primary/10 text-primary",
    status: "Active",
    statusBadge: "bg-success/10 text-success",
    conversations: 47,
    booked: 12,
    transferRate: "23%",
    campaigns: 3,
  },
  {
    name: "Mike",
    role: "Lead Qualifier",
    avatar: "bg-info/10 text-info",
    type: "SMS",
    typeBadge: "bg-info/10 text-info",
    status: "Active",
    statusBadge: "bg-success/10 text-success",
    conversations: 32,
    booked: 8,
    transferRate: "18%",
    campaigns: 2,
  },
  {
    name: "Follow Up Bot",
    role: "Re-engagement",
    avatar: "bg-muted text-muted-foreground",
    type: "Multi-channel",
    typeBadge: "bg-warning/10 text-warning",
    status: "Paused",
    statusBadge: "bg-warning/10 text-warning",
    conversations: 15,
    booked: 3,
    transferRate: "12%",
    campaigns: 1,
  },
];

const detailTabs = ["Identity", "Instructions", "Workflows", "Campaigns", "Performance"];

const workflowBlocks = [
  { label: "New Lead Added", type: "trigger" },
  { label: "Send SMS", type: "action" },
  { label: "Wait 1 hour", type: "delay" },
  { label: "Responded?", type: "condition" },
  { label: "Book Appointment", type: "action" },
  { label: "Make Call", type: "action" },
];

const AIAgents: React.FC = () => {
  const [detail, setDetail] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState("Identity");

  if (detail) {
    const agent = agents.find((a) => a.name === detail)!;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setDetail(null)} className="text-muted-foreground hover:text-foreground">AI Agents</button>
          <span className="text-muted-foreground">/</span>
          <span className="text-foreground font-medium">{agent.name}</span>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl ${agent.avatar} flex items-center justify-center`}><Bot className="w-6 h-6" /></div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{agent.name}</h1>
              <p className="text-sm text-muted-foreground">{agent.role}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${agent.typeBadge}`}>{agent.type}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${agent.statusBadge}`}>{agent.status}</span>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded-lg bg-accent text-foreground text-sm flex items-center gap-2 hover:bg-accent/80 sidebar-transition"><Settings className="w-4 h-4" /> Edit</button>
            <button className="px-3 py-2 rounded-lg bg-warning/10 text-warning text-sm font-medium flex items-center gap-2 hover:bg-warning/20 sidebar-transition"><Pause className="w-4 h-4" /> Pause</button>
          </div>
        </div>

        <div className="flex border-b">
          {detailTabs.map((t) => (
            <button key={t} onClick={() => setDetailTab(t)} className={`px-4 py-2.5 text-sm font-medium sidebar-transition ${detailTab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
          ))}
        </div>

        {detailTab === "Identity" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card rounded-xl border p-6 text-center space-y-4">
              <div className={`w-20 h-20 rounded-2xl ${agent.avatar} flex items-center justify-center mx-auto`}><Bot className="w-10 h-10" /></div>
              <div><h3 className="font-bold text-foreground text-lg">{agent.name}</h3><p className="text-sm text-muted-foreground">{agent.role}</p></div>
              {[["Type", agent.type], ["Personality", "Friendly, Professional"], ["Voice", "Female (US English)"]].map(([k, v]) => (
                <div key={k}><span className="text-xs text-muted-foreground">{k}</span><p className="text-sm font-medium text-foreground">{v}</p></div>
              ))}
            </div>
            <div className="bg-card rounded-xl border p-6 space-y-4">
              <h3 className="font-semibold text-foreground">Status & Metrics</h3>
              {[["Status", agent.status], ["Created", "Jan 10, 2025"], ["Last Active", "2 min ago"], ["Total Conversations", String(agent.conversations)]].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2 border-b last:border-0">
                  <span className="text-sm text-muted-foreground">{k}</span>
                  <span className="text-sm font-medium text-foreground">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {detailTab === "Instructions" && (
          <div className="space-y-4">
            <div className="bg-card rounded-xl border p-5">
              <h3 className="font-semibold text-foreground mb-3">System Prompt</h3>
              <div className="bg-accent/50 rounded-lg p-4 text-sm text-muted-foreground font-mono">
                You are Sarah, a friendly and professional appointment setter for a life insurance agency. Your goal is to qualify leads and book appointments with our agents. Always be warm, empathetic, and never pushy.
              </div>
            </div>
            <div className="bg-card rounded-xl border p-5">
              <h3 className="font-semibold text-foreground mb-3">Goal</h3>
              <span className="text-sm bg-primary/10 text-primary px-3 py-1 rounded-full font-medium">Book Appointment</span>
            </div>
            <div className="bg-card rounded-xl border p-5">
              <h3 className="font-semibold text-foreground mb-3">Objection Handling</h3>
              <div className="space-y-3">
                {[
                  ["I'm not interested", "I completely understand. Would it be okay if I just shared some quick information about..."],
                  ["I already have insurance", "That's great that you're already covered! Many of our clients find that reviewing their coverage..."],
                  ["I can't afford it", "I hear you. What many people don't realize is that term life insurance can be as low as..."],
                ].map(([obj, resp]) => (
                  <div key={obj} className="bg-accent/50 rounded-lg p-3">
                    <p className="text-sm font-medium text-foreground">"{obj}"</p>
                    <p className="text-xs text-muted-foreground mt-1">{resp}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {detailTab === "Workflows" && (
          <div className="space-y-4">
            <div className="flex justify-between">
              <h3 className="font-semibold text-foreground">Active Workflows</h3>
              <button className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition"><Plus className="w-4 h-4 inline mr-1" /> Create</button>
            </div>
            {["New Lead Follow Up", "No Answer Retry"].map((w) => (
              <div key={w} className="bg-card rounded-xl border p-4 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{w}</span>
                <div className="w-10 h-5 rounded-full bg-success relative cursor-pointer"><div className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-success-foreground" /></div>
              </div>
            ))}
            <div className="bg-card rounded-xl border p-5">
              <h3 className="font-semibold text-foreground mb-4">Workflow: New Lead Follow Up</h3>
              <div className="flex flex-col items-center gap-2">
                {workflowBlocks.map((b, i) => (
                  <React.Fragment key={b.label}>
                    <div className={`px-4 py-3 rounded-lg text-sm font-medium w-48 text-center sidebar-transition ${
                      b.type === "trigger" ? "bg-success/10 text-success border border-success/30" :
                      b.type === "condition" ? "bg-warning/10 text-warning border border-warning/30 rotate-0" :
                      b.type === "delay" ? "bg-accent text-muted-foreground border" :
                      "bg-primary/10 text-primary border border-primary/30"
                    }`}>{b.label}</div>
                    {i < workflowBlocks.length - 1 && <ArrowRight className="w-4 h-4 text-muted-foreground rotate-90" />}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        )}

        {detailTab === "Campaigns" && (
          <div className="bg-card rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="text-muted-foreground border-b bg-accent/50">
                <th className="text-left py-3 px-4 font-medium">Campaign</th>
                <th className="text-right py-3 font-medium">Conversations</th>
                <th className="text-right py-3 font-medium">Booked</th>
                <th className="text-right py-3 px-4 font-medium">Rate</th>
              </tr></thead>
              <tbody>
                {[
                  { name: "Q1 Facebook Leads", conv: 28, booked: 7, rate: "25%" },
                  { name: "Direct Mail Campaign", conv: 12, booked: 3, rate: "25%" },
                  { name: "Google Ads Q1", conv: 7, booked: 2, rate: "29%" },
                ].map((c) => (
                  <tr key={c.name} className="border-b last:border-0">
                    <td className="py-3 px-4 font-medium text-foreground">{c.name}</td>
                    <td className="py-3 text-right text-foreground">{c.conv}</td>
                    <td className="py-3 text-right text-foreground">{c.booked}</td>
                    <td className="py-3 text-right px-4 text-success font-medium">{c.rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detailTab === "Performance" && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Total Conversations", value: "47" },
              { label: "Appointments Booked", value: "12" },
              { label: "Transfer Rate", value: "23%" },
              { label: "Avg Response Time", value: "1.2s" },
            ].map((s) => (
              <div key={s.label} className="bg-card rounded-xl border p-4 text-center">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1">{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">AI Agents</h1>
        <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 sidebar-transition"><Plus className="w-4 h-4" /> Create AI Agent</button>
      </div>

      <div className="flex gap-2">
        {["All", "Voice", "SMS", "Email", "Multi-channel"].map((f) => (
          <button key={f} className={`px-3 py-1.5 rounded-lg text-xs font-medium sidebar-transition ${f === "All" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>{f}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {agents.map((a) => (
          <div key={a.name} className="bg-card rounded-xl border p-5 hover:shadow-md sidebar-transition cursor-pointer" onClick={() => { setDetail(a.name); setDetailTab("Identity"); }}>
            <div className="flex items-start gap-4 mb-4">
              <div className={`w-12 h-12 rounded-xl ${a.avatar} flex items-center justify-center shrink-0`}><Bot className="w-6 h-6" /></div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-foreground">{a.name}</h3>
                <p className="text-sm text-muted-foreground">{a.role}</p>
              </div>
            </div>
            <div className="flex gap-2 mb-4">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.typeBadge}`}>{a.type}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.statusBadge}`}>{a.status}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center mb-4">
              <div><p className="text-lg font-bold text-foreground">{a.conversations}</p><p className="text-[10px] text-muted-foreground">Conversations</p></div>
              <div><p className="text-lg font-bold text-foreground">{a.booked}</p><p className="text-[10px] text-muted-foreground">Booked</p></div>
              <div><p className="text-lg font-bold text-foreground">{a.transferRate}</p><p className="text-[10px] text-muted-foreground">Transfer</p></div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{a.campaigns} campaigns</span>
              <button onClick={(e) => e.stopPropagation()} className="text-xs text-warning hover:underline flex items-center gap-1">
                {a.status === "Active" ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Resume</>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AIAgents;
