import React, { useState } from "react";
import {
  Building2, Users, Phone, FileText, List, Zap, Mail, Shield, Voicemail,
  Mic, Headphones, Target, PhoneIncoming, Settings, Bot, Ban, Webhook,
  Link, Clock, Upload, Plus, Search, GripVertical, Play, Pause,
} from "lucide-react";

const sections = [
  { icon: Building2, label: "Company Branding" },
  { icon: Users, label: "User Management" },
  { icon: Phone, label: "Twilio & Phone Numbers" },
  { icon: FileText, label: "Call Scripts" },
  { icon: List, label: "Dispositions Manager" },
  { icon: Zap, label: "Automation Builder" },
  { icon: Mail, label: "Email & SMS Templates" },
  { icon: Shield, label: "Carriers" },
  { icon: Voicemail, label: "Voicemail Drop Manager" },
  { icon: Mic, label: "Call Recording Library" },
  { icon: Headphones, label: "Call Monitoring" },
  { icon: Target, label: "Goal Setting" },
  { icon: PhoneIncoming, label: "Inbound Call Routing" },
  { icon: Settings, label: "Predictive Dialer" },
  { icon: Bot, label: "AI Settings" },
  { icon: Ban, label: "DNC List Manager" },
  { icon: Webhook, label: "Zapier & Webhooks" },
  { icon: Link, label: "Custom Menu Links" },
  { icon: Clock, label: "Activity Log" },
];

const users = [
  { name: "Chris Garcia", email: "chris@agentflow.com", role: "Admin", roleBadge: "bg-primary/10 text-primary", status: "Active", avail: "bg-success" },
  { name: "Sarah Johnson", email: "sarah@agentflow.com", role: "Agent", roleBadge: "bg-success/10 text-success", status: "Active", avail: "bg-success" },
  { name: "Mike Thompson", email: "mike@agentflow.com", role: "Agent", roleBadge: "bg-success/10 text-success", status: "Active", avail: "bg-warning" },
  { name: "Lisa Roberts", email: "lisa@agentflow.com", role: "Team Leader", roleBadge: "bg-info/10 text-info", status: "Active", avail: "bg-success" },
  { name: "James Wilson", email: "james@agentflow.com", role: "Agent", roleBadge: "bg-success/10 text-success", status: "Inactive", avail: "bg-muted-foreground/50" },
];

const carriers = [
  "Mutual of Omaha", "Transamerica", "Prudential", "John Hancock", "MetLife",
  "AIG", "Lincoln Financial", "Nationwide", "Pacific Life", "Protective",
];

const dispositions = [
  { name: "Not Available", color: "bg-muted", auto: false },
  { name: "Left Voicemail", color: "bg-primary", auto: true },
  { name: "Not Interested", color: "bg-destructive", auto: false },
  { name: "Call Back Later", color: "bg-warning", auto: true },
  { name: "Interested", color: "bg-success", auto: false },
  { name: "Appointment Set", color: "bg-info", auto: true },
];

const activityLog = [
  { action: "Updated campaign 'Q1 Facebook Leads'", user: "Chris G.", time: "10 min ago" },
  { action: "Added new user: James Wilson", user: "Chris G.", time: "1 hr ago" },
  { action: "Changed disposition 'Hot Lead' color", user: "Chris G.", time: "2 hrs ago" },
  { action: "Uploaded voicemail drop 'Term Life Intro'", user: "Sarah J.", time: "3 hrs ago" },
  { action: "Modified call script 'Whole Life Script'", user: "Chris G.", time: "5 hrs ago" },
  { action: "Purchased phone number (555) 999-0001", user: "Chris G.", time: "Yesterday" },
  { action: "Updated business hours", user: "Chris G.", time: "Yesterday" },
  { action: "Created automation 'New Lead SMS'", user: "Lisa R.", time: "2 days ago" },
  { action: "Added carrier: Pacific Life", user: "Chris G.", time: "3 days ago" },
  { action: "Updated AI agent 'Sarah' instructions", user: "Chris G.", time: "4 days ago" },
];

const SettingsPage: React.FC = () => {
  const [active, setActive] = useState(0);

  const renderContent = () => {
    switch (active) {
      case 0: // Company Branding
        return (
          <div className="space-y-6">
            <div><h3 className="text-lg font-semibold text-foreground">Company Branding</h3><p className="text-sm text-muted-foreground">Customize your company's appearance and settings.</p></div>
            <div className="border-2 border-dashed rounded-xl p-8 text-center hover:bg-accent/50 sidebar-transition cursor-pointer">
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">Upload Logo</p>
              <p className="text-xs text-muted-foreground">PNG, JPG up to 2MB</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                ["Company Name", "AgentFlow", "text"],
                ["Timezone", "America/New_York (Eastern)", "text"],
                ["Primary Color", "#3B82F6", "color"],
                ["Company Phone", "(555) 000-0000", "text"],
              ].map(([label, value, type]) => (
                <div key={label}>
                  <label className="text-sm font-medium text-foreground block mb-1.5">{label}</label>
                  {type === "color" ? (
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-lg bg-primary border" />
                      <input type="text" defaultValue={value} className="flex-1 h-9 px-3 rounded-lg bg-accent text-sm text-foreground border-0 focus:ring-2 focus:ring-primary/50" />
                    </div>
                  ) : (
                    <input type="text" defaultValue={value} className="w-full h-9 px-3 rounded-lg bg-accent text-sm text-foreground border-0 focus:ring-2 focus:ring-primary/50" />
                  )}
                </div>
              ))}
            </div>
            <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition">Save Changes</button>
          </div>
        );

      case 1: // User Management
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">User Management</h3>
              <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90"><Plus className="w-4 h-4" /> Invite User</button>
            </div>
            <div className="bg-card rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="text-muted-foreground border-b bg-accent/50">
                  <th className="text-left py-3 px-4 font-medium">User</th>
                  <th className="text-left py-3 font-medium">Email</th>
                  <th className="text-left py-3 font-medium">Role</th>
                  <th className="text-left py-3 font-medium">Status</th>
                  <th className="text-left py-3 font-medium">Availability</th>
                </tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.email} className="border-b last:border-0 hover:bg-accent/30 sidebar-transition">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{u.name.split(" ").map(w => w[0]).join("")}</div>
                          <span className="font-medium text-foreground">{u.name}</span>
                        </div>
                      </td>
                      <td className="py-3 text-muted-foreground">{u.email}</td>
                      <td className="py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.roleBadge}`}>{u.role}</span></td>
                      <td className="py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.status === "Active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{u.status}</span></td>
                      <td className="py-3"><span className={`w-2.5 h-2.5 rounded-full inline-block ${u.avail}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 2: // Twilio
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-foreground">Twilio & Phone Numbers</h3>
            <div className="bg-accent/50 rounded-xl p-5 space-y-4">
              <h4 className="font-medium text-foreground">Credentials</h4>
              {[["Account SID", "AC•••••••••••••••"], ["Auth Token", "•••••••••••••••••"], ["API Key", "SK•••••••••••••••••"], ["API Secret", "•••••••••••••••••"]].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{k}</span><span className="text-sm font-mono text-foreground">{v}</span></div>
              ))}
              <button className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">Test Connection</button>
            </div>
            <div className="bg-card rounded-xl border p-5 space-y-3">
              <h4 className="font-medium text-foreground">Owned Numbers</h4>
              {["(555) 100-0001", "(555) 100-0002"].map((n) => (
                <div key={n} className="flex items-center justify-between py-2 border-b last:border-0">
                  <span className="text-sm font-mono text-foreground">{n}</span>
                  <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">Clean</span>
                </div>
              ))}
            </div>
          </div>
        );

      case 4: // Dispositions
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Dispositions Manager</h3>
              <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90"><Plus className="w-4 h-4" /> Add</button>
            </div>
            <div className="bg-card rounded-xl border divide-y">
              {dispositions.map((d) => (
                <div key={d.name} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 sidebar-transition">
                  <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                  <span className={`w-3 h-3 rounded-full ${d.color}`} />
                  <span className="flex-1 text-sm font-medium text-foreground">{d.name}</span>
                  <span className="text-xs text-muted-foreground">{d.auto ? "Auto-advance" : ""}</span>
                  <div className={`w-8 h-4 rounded-full ${d.auto ? "bg-primary" : "bg-muted"} relative cursor-pointer`}>
                    <div className={`absolute top-0.5 ${d.auto ? "right-0.5" : "left-0.5"} w-3 h-3 rounded-full bg-card`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 7: // Carriers
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Carriers</h3>
              <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90"><Plus className="w-4 h-4" /> Add Carrier</button>
            </div>
            <div className="bg-card rounded-xl border divide-y">
              {carriers.map((c) => (
                <div key={c} className="flex items-center justify-between px-4 py-3 hover:bg-accent/30 sidebar-transition">
                  <span className="text-sm font-medium text-foreground">{c}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full font-medium">Appointed</span>
                    <input type="text" placeholder="Portal URL" className="h-7 px-2 rounded bg-accent text-xs text-foreground w-40 focus:ring-1 focus:ring-primary/50" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 10: // Call Monitoring
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">Call Monitoring <span className="w-2.5 h-2.5 rounded-full bg-success animate-pulse" /></h3>
            <div className="space-y-3">
              {[
                { agent: "Sarah J.", contact: "John Martinez", duration: "3:24" },
                { agent: "Mike T.", contact: "Lisa Park", duration: "1:12" },
              ].map((c) => (
                <div key={c.agent} className="bg-card rounded-xl border p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{c.agent.split(" ").map(w => w[0]).join("")}</div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.agent} → {c.contact}</p>
                      <p className="text-xs text-muted-foreground font-mono">{c.duration}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {["Listen", "Whisper", "Barge"].map((a) => (
                      <button key={a} className="px-3 py-1.5 rounded-lg bg-accent text-foreground text-xs font-medium hover:bg-accent/80 sidebar-transition">{a}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 14: // AI Settings
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">AI Settings</h3>
            <div className="space-y-4">
              {[["AI Provider", "Anthropic"], ["Model", "claude-sonnet-4-20250514"]].map(([k, v]) => (
                <div key={k}><label className="text-sm font-medium text-foreground block mb-1.5">{k}</label><input type="text" defaultValue={v} className="w-full h-9 px-3 rounded-lg bg-accent text-sm text-foreground border-0 focus:ring-2 focus:ring-primary/50" /></div>
              ))}
              <div className="grid grid-cols-2 gap-4">
                {[{ label: "API Calls This Month", value: "1,247" }, { label: "Estimated Cost", value: "$34.20" }].map((s) => (
                  <div key={s.label} className="bg-accent/50 rounded-lg p-4 text-center"><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-xl font-bold text-foreground mt-1">{s.value}</p></div>
                ))}
              </div>
            </div>
          </div>
        );

      case 15: // DNC List
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">DNC List Manager <span className="text-sm font-normal text-muted-foreground ml-2">47 numbers</span></h3>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded-lg bg-accent text-foreground text-sm flex items-center gap-2 hover:bg-accent/80"><Upload className="w-4 h-4" /> Import CSV</button>
                <button className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90"><Plus className="w-4 h-4" /> Add Number</button>
              </div>
            </div>
            <div className="relative max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input type="text" placeholder="Search numbers..." className="w-full h-9 pl-9 pr-4 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" /></div>
            <div className="bg-card rounded-xl border divide-y">
              {["(555) 111-0001", "(555) 222-0002", "(555) 333-0003", "(555) 444-0004", "(555) 555-0005"].map((n) => (
                <div key={n} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm font-mono text-foreground">{n}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">Added Jan 15, 2025</span>
                    <button className="text-xs text-destructive hover:underline">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 18: // Activity Log
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Activity Log</h3>
              <button className="px-3 py-1.5 rounded-lg bg-accent text-foreground text-sm flex items-center gap-2 hover:bg-accent/80">Export CSV</button>
            </div>
            <div className="bg-card rounded-xl border divide-y">
              {activityLog.map((a, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3 hover:bg-accent/30 sidebar-transition">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{a.user.split(" ").map(w => w[0]).join("")}</div>
                    <div><p className="text-sm text-foreground">{a.action}</p><p className="text-xs text-muted-foreground">{a.user}</p></div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{a.time}</span>
                </div>
              ))}
            </div>
          </div>
        );

      default:
        return (
          <div className="bg-accent/50 rounded-xl p-8 text-center">
            <sections[active].icon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">{sections[active].label}</h3>
            <p className="text-sm text-muted-foreground">This settings section is ready for configuration.</p>
          </div>
        );
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sub-nav */}
        <div className="lg:col-span-1">
          <nav className="bg-card rounded-xl border p-2 space-y-0.5 sticky top-20">
            {sections.map((s, i) => (
              <button
                key={s.label}
                onClick={() => setActive(i)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm sidebar-transition text-left ${
                  active === i ? "bg-primary text-primary-foreground font-medium" : "text-foreground hover:bg-accent"
                }`}
              >
                <s.icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{s.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
