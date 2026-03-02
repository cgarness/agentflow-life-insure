import React, { useState } from "react";
import UserManagement from "@/components/settings/UserManagement";
import DispositionsManager from "@/components/settings/DispositionsManager";
import ContactManagement from "@/components/settings/ContactManagement";
import Permissions from "@/components/settings/Permissions";
import CompanyBranding from "@/components/settings/CompanyBranding";
import CallScripts from "@/components/settings/CallScripts";
import CalendarSettings from "@/components/settings/CalendarSettings";
import {
  Building2, Users, Phone, FileText, List, Zap, Mail, Shield, Voicemail,
  Mic, Headphones, Target, PhoneIncoming, Settings, Bot, Ban, Webhook,
  Link, Clock, Upload, Plus, Search, GripVertical, Play, Pause, SlidersHorizontal,
  Lock, CalendarDays,
} from "lucide-react";

const sections = [
  { icon: Building2, label: "Company Branding" },
  { icon: Users, label: "User Management" },
  { icon: Phone, label: "Twilio & Phone Numbers" },
  { icon: FileText, label: "Call Scripts" },
  { icon: List, label: "Dispositions Manager" },
  { icon: SlidersHorizontal, label: "Contact Management" },
  { icon: CalendarDays, label: "Calendar Settings" },
  { icon: Lock, label: "Permissions" },
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
        return <CompanyBranding />;

      case 1: // User Management
        return <UserManagement />;
      case 3: // Call Scripts
        return <CallScripts />;
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
        return <DispositionsManager />;
      case 5: // Contact Management
        return <ContactManagement />;
      case 6: // Calendar Settings
        return <CalendarSettings />;
      case 7: // Permissions
        return <Permissions />;

      case 10: // Carriers
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

      case 13: // Call Monitoring
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

      case 17: // AI Settings
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

      case 18: // DNC List
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

      case 21: // Activity Log
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

      default: {
        const Icon = sections[active].icon;
        return (
          <div className="bg-accent/50 rounded-xl p-8 text-center">
            <Icon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">{sections[active].label}</h3>
            <p className="text-sm text-muted-foreground">This settings section is ready for configuration.</p>
          </div>
        );
      }
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
