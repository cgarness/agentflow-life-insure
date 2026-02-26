import React, { useState } from "react";
import {
  Phone, PhoneOff, Mic, MicOff, Pause, Play, Voicemail,
  Clock, ChevronDown, User, Pin, Plus, Calendar, Eye,
} from "lucide-react";

const sessionStats = [
  { label: "Session Duration", value: "01:23:45" },
  { label: "Calls Made", value: "12" },
  { label: "Connected", value: "5" },
  { label: "Answer Rate", value: "42%" },
  { label: "Policies Sold", value: "1" },
  { label: "Avg Duration", value: "3:24" },
];

const leadQueue = [
  { name: "John D.", state: "FL", age: 34, source: "Facebook Ads", attempts: 0, active: true },
  { name: "Sarah W.", state: "TX", age: 45, source: "Direct Mail", attempts: 1, active: false },
  { name: "Mike P.", state: "CA", age: 52, source: "Google Ads", attempts: 0, active: false },
  { name: "Lisa K.", state: "NY", age: 38, source: "Referral", attempts: 2, active: false },
  { name: "Tom H.", state: "OH", age: 41, source: "Webinar", attempts: 0, active: false },
];

const scriptSections = ["Introduction", "Needs Analysis", "Presentation", "Close"];

const dispositions = [
  "1. Not Available", "2. Left Voicemail", "3. Not Interested",
  "4. Call Back Later", "5. Interested - Follow Up", "6. Appointment Set",
  "7. Policy Sold", "8. Wrong Number", "9. DNC Request",
];

const callHistory = [
  { date: "Yesterday", disposition: "Interested", duration: "4:12", notes: "Wants info on Term Life" },
  { date: "3 days ago", disposition: "Left Voicemail", duration: "0:32", notes: "" },
];

const DialerPage: React.FC = () => {
  const [onCall, setOnCall] = useState(false);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Dialer</h1>

      {/* Session Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {sessionStats.map((s) => (
          <div key={s.label} className="bg-card rounded-lg border p-3 text-center">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-lg font-bold font-mono text-foreground mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Three Panel Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left Panel - Queue */}
        <div className="bg-card rounded-xl border p-4 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Campaign</label>
            <button className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-accent text-sm text-foreground">
              Q1 Facebook Leads <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Power Dialer</span>
            <span className="text-xs text-muted-foreground">47 remaining</span>
          </div>
          <div className="space-y-2">
            {leadQueue.map((l, i) => (
              <div key={i} className={`rounded-lg p-3 sidebar-transition ${l.active ? "bg-primary/10 border border-primary/30" : "bg-accent/50 hover:bg-accent"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-foreground">{l.name}</span>
                  <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded">{l.state}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">Age {l.age}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">{l.source}</span>
                </div>
                <div className="flex items-center gap-1 mt-1.5">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className={`w-1.5 h-1.5 rounded-full ${j < l.attempts ? "bg-primary" : "bg-muted"}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="flex-1 py-2 rounded-lg bg-warning/10 text-warning text-sm font-medium hover:bg-warning/20 sidebar-transition">Pause</button>
            <button className="flex-1 py-2 rounded-lg bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 sidebar-transition">End</button>
          </div>
        </div>

        {/* Center Panel - Call */}
        <div className="lg:col-span-2 bg-card rounded-xl border p-6 space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-foreground">John D.</h2>
            <p className="text-muted-foreground font-mono">(555) 123-4567</p>
            <div className="flex items-center justify-center gap-2">
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Florida</span>
              <span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">Age 34</span>
            </div>
            <div className="flex justify-center">
              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${onCall ? "bg-primary/10 text-primary" : "bg-success/10 text-success"}`}>
                <span className={`w-2 h-2 rounded-full ${onCall ? "bg-primary animate-pulse" : "bg-success"}`} />
                {onCall ? "On Call" : "Ready"}
              </span>
            </div>
          </div>

          {/* Call Controls */}
          {!onCall ? (
            <button onClick={() => setOnCall(true)} className="w-full py-4 rounded-xl bg-success text-success-foreground font-bold text-lg flex items-center justify-center gap-2 hover:bg-success/90 sidebar-transition">
              <Phone className="w-6 h-6" /> Call
            </button>
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <span className="text-3xl font-mono font-bold text-foreground">0:47</span>
              </div>
              <button onClick={() => setOnCall(false)} className="w-full py-4 rounded-xl bg-destructive text-destructive-foreground font-bold text-lg flex items-center justify-center gap-2 hover:bg-destructive/90 sidebar-transition">
                <PhoneOff className="w-6 h-6" /> Hang Up
              </button>
              <div className="flex items-center justify-center gap-3">
                <button className="w-12 h-12 rounded-xl bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition"><Mic className="w-5 h-5" /></button>
                <button className="w-12 h-12 rounded-xl bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition"><Pause className="w-5 h-5" /></button>
                <button className="w-12 h-12 rounded-xl bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition"><Voicemail className="w-5 h-5" /></button>
              </div>
            </div>
          )}

          {/* Script */}
          <div className="bg-accent/50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground text-sm">Call Script</h3>
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Term Life</span>
            </div>
            <div className="flex gap-1 border-b pb-2">
              {scriptSections.map((s, i) => (
                <button key={s} className={`px-3 py-1 rounded-md text-xs font-medium sidebar-transition ${i === 0 ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{s}</button>
              ))}
            </div>
            <div className="text-sm text-muted-foreground space-y-2 max-h-40 overflow-y-auto">
              <p>"Hi, this is [Your Name] from AgentFlow Insurance. I'm reaching out because you recently expressed interest in learning more about life insurance options. Is this a good time to chat for a few minutes?"</p>
              <p className="text-xs text-primary font-medium italic">If yes, continue. If no, schedule callback.</p>
              <p>"Great! I'd like to ask a few quick questions to find the best option for you. First, are you currently covered by any life insurance policy?"</p>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Pin className="w-4 h-4 text-primary" /> Pinned Notes</h3>
            <div className="bg-accent/50 rounded-lg p-3 text-sm text-muted-foreground">Has 2 kids, wife is a teacher. Interested in 20-year term policy.</div>
            <div className="flex gap-2">
              <input type="text" placeholder="Add a quick note..." className="flex-1 px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
              <button className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"><Plus className="w-4 h-4" /></button>
            </div>
          </div>
        </div>

        {/* Right Panel - Details */}
        <div className="space-y-4">
          <div className="bg-card rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold text-foreground text-sm">Contact Details</h3>
            {[
              ["Full Name", "John Doe Martinez"],
              ["Phone", "(555) 123-4567"],
              ["Email", "john.m@email.com"],
              ["State", "Florida"],
              ["Age", "34"],
              ["Lead Source", "Facebook Ads"],
              ["Status", "Interested"],
              ["Assigned", "Chris G."],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{k}</span>
                <span className="text-foreground font-medium">{v}</span>
              </div>
            ))}
          </div>

          <div className="bg-card rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold text-foreground text-sm">Disposition History</h3>
            {callHistory.map((c, i) => (
              <div key={i} className="text-sm border-b last:border-0 pb-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{c.date}</span>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{c.disposition}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{c.duration} · {c.notes || "No notes"}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button className="flex-1 py-2 rounded-lg bg-accent text-foreground text-sm font-medium hover:bg-accent/80 sidebar-transition flex items-center justify-center gap-1"><Calendar className="w-4 h-4" /> Schedule</button>
            <button className="flex-1 py-2 rounded-lg bg-accent text-foreground text-sm font-medium hover:bg-accent/80 sidebar-transition flex items-center justify-center gap-1"><Eye className="w-4 h-4" /> Full View</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DialerPage;
