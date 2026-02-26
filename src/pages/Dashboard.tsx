import React from "react";
import {
  Phone, ShieldCheck, Calendar, Megaphone, TrendingUp, TrendingDown,
  Clock, ArrowRight, PhoneCall, Users, Star, Trophy,
} from "lucide-react";

const stats = [
  { label: "Total Calls Today", value: "47", trend: "+12% vs yesterday", icon: Phone, positive: true },
  { label: "Policies Sold This Month", value: "23", trend: "+8% vs last month", icon: ShieldCheck, positive: true },
  { label: "Appointments Scheduled", value: "8", trend: "Same as last week", icon: Calendar, positive: null },
  { label: "Active Campaigns", value: "4", trend: "", icon: Megaphone, positive: null },
];

const appointments = [
  { time: "10:00 AM", name: "John Martinez", type: "Sales Call" },
  { time: "1:30 PM", name: "Sarah Williams", type: "Follow Up" },
  { time: "3:00 PM", name: "Robert Chen", type: "Policy Review" },
];

const followUps = [
  { name: "Lisa Park", days: 3, source: "Facebook Ads" },
  { name: "Tom Harris", days: 5, source: "Direct Mail" },
  { name: "Amy Zhang", days: 2, source: "Referral" },
  { name: "David Brown", days: 7, source: "Google Ads" },
  { name: "Maria Lopez", days: 1, source: "Webinar" },
];

const wins = [
  { agent: "Chris G.", contact: "John M.", policy: "Term Life", time: "2 hrs ago" },
  { agent: "Sarah J.", contact: "Amy L.", policy: "Whole Life", time: "4 hrs ago" },
  { agent: "Mike T.", contact: "Robert C.", policy: "IUL", time: "Yesterday" },
  { agent: "Lisa R.", contact: "David B.", policy: "Term Life", time: "Yesterday" },
  { agent: "James W.", contact: "Maria G.", policy: "Term Life", time: "2 days ago" },
];

const activities = [
  { type: "call", desc: "Called John Martinez", agent: "Chris G.", time: "10 min ago" },
  { type: "policy", desc: "Sold Term Life to Amy L.", agent: "Sarah J.", time: "2 hrs ago" },
  { type: "lead", desc: "New lead assigned: Tom Harris", agent: "Mike T.", time: "3 hrs ago" },
  { type: "appt", desc: "Appointment set with Lisa Park", agent: "Chris G.", time: "4 hrs ago" },
  { type: "call", desc: "Left voicemail for David Brown", agent: "James W.", time: "5 hrs ago" },
  { type: "sms", desc: "SMS sent to Maria Lopez", agent: "Lisa R.", time: "6 hrs ago" },
];

const leaderboard = [
  { rank: 1, name: "Chris G.", avatar: "CG", calls: 47, policies: 5, appts: 8, goal: 95 },
  { rank: 2, name: "Sarah J.", avatar: "SJ", calls: 42, policies: 4, appts: 6, goal: 88 },
  { rank: 3, name: "Mike T.", avatar: "MT", calls: 38, policies: 3, appts: 5, goal: 75 },
  { rank: 4, name: "Lisa R.", avatar: "LR", calls: 35, policies: 3, appts: 4, goal: 70 },
  { rank: 5, name: "James W.", avatar: "JW", calls: 29, policies: 2, appts: 3, goal: 58 },
];

const missedCalls = [
  { name: "Unknown (555) 987-6543", time: "9:15 AM" },
  { name: "Sarah Williams", time: "8:42 AM" },
];

const anniversaries = [
  { name: "Robert Chen", policy: "Term Life", days: 3 },
  { name: "Jennifer Wu", policy: "Whole Life", days: 7 },
  { name: "Mark Stevens", policy: "IUL", days: 12 },
];

const Dashboard: React.FC = () => {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">{greeting}, Chris! Here's your overview.</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-card rounded-xl border p-5 hover:shadow-md sidebar-transition">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="text-3xl font-bold text-foreground mt-1">{s.value}</p>
                {s.trend && (
                  <div className="flex items-center gap-1 mt-2">
                    {s.positive === true && <TrendingUp className="w-3.5 h-3.5 text-success" />}
                    {s.positive === false && <TrendingDown className="w-3.5 h-3.5 text-destructive" />}
                    <span className={`text-xs ${s.positive === true ? "text-success" : s.positive === false ? "text-destructive" : "text-muted-foreground"}`}>{s.trend}</span>
                  </div>
                )}
              </div>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <s.icon className="w-5 h-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-3 space-y-6">
          {/* Daily Briefing */}
          <div className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold text-foreground mb-4">📋 Daily Briefing</h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">3 Appointments Today</h3>
                {appointments.map((a) => (
                  <div key={a.time} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono text-primary font-medium">{a.time}</span>
                      <span className="text-sm text-foreground">{a.name}</span>
                    </div>
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{a.type}</span>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">5 Follow-ups Due</h3>
                {followUps.slice(0, 3).map((f) => (
                  <div key={f.name} className="flex items-center justify-between py-2 border-b last:border-0">
                    <span className="text-sm text-foreground">{f.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${f.days >= 5 ? "bg-destructive/10 text-destructive" : f.days >= 3 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>{f.days}d ago</span>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">2 Policy Anniversaries</h3>
                {anniversaries.slice(0, 2).map((a) => (
                  <div key={a.name} className="flex items-center justify-between py-2 border-b last:border-0">
                    <span className="text-sm text-foreground">{a.name} — {a.policy}</span>
                    <span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">In {a.days}d</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Win Feed */}
          <div className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold text-foreground mb-4">🎉 Win Feed</h2>
            <div className="space-y-3">
              {wins.map((w, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center text-success text-xs font-bold">{w.agent.split(" ").map(c => c[0]).join("")}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground"><span className="font-medium">{w.agent}</span> sold <span className="text-primary font-medium">{w.policy}</span> to {w.contact}</p>
                    <p className="text-xs text-muted-foreground">{w.time}</p>
                  </div>
                  <span className="text-lg">🎉</span>
                </div>
              ))}
            </div>
          </div>

          {/* Activity Feed */}
          <div className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold text-foreground mb-4">Recent Activity</h2>
            <div className="space-y-3">
              {activities.map((a, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    a.type === "call" ? "bg-primary/10 text-primary" : a.type === "policy" ? "bg-success/10 text-success" : a.type === "lead" ? "bg-warning/10 text-warning" : "bg-accent text-accent-foreground"
                  }`}>
                    {a.type === "call" ? <Phone className="w-4 h-4" /> : a.type === "policy" ? <ShieldCheck className="w-4 h-4" /> : a.type === "lead" ? <Users className="w-4 h-4" /> : <Calendar className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{a.desc}</p>
                    <p className="text-xs text-muted-foreground">{a.agent} · {a.time}</p>
                  </div>
                </div>
              ))}
              <button className="w-full py-2 text-sm text-primary font-medium hover:underline">Load more</button>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Follow Up Queue */}
          <div className="bg-card rounded-xl border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-foreground">Follow Up Queue</h2>
              <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium">{followUps.length}</span>
            </div>
            {followUps.map((f) => (
              <div key={f.name} className="flex items-center justify-between py-2.5 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium text-foreground">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{f.source}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${f.days >= 5 ? "bg-destructive/10 text-destructive" : f.days >= 3 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>{f.days}d</span>
                  <button className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 sidebar-transition">
                    <Phone className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Missed Calls */}
          <div className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold text-foreground mb-4">📞 Missed Calls</h2>
            {missedCalls.map((m) => (
              <div key={m.name} className="flex items-center justify-between py-2.5 border-b last:border-0">
                <div>
                  <p className="text-sm text-foreground">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.time}</p>
                </div>
                <button className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-lg font-medium hover:bg-primary/20 sidebar-transition">Call Back</button>
              </div>
            ))}
          </div>

          {/* Anniversaries */}
          <div className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold text-foreground mb-4">🎂 Policy Anniversaries</h2>
            {anniversaries.map((a) => (
              <div key={a.name} className="flex items-center justify-between py-2.5 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium text-foreground">{a.name}</p>
                  <p className="text-xs text-muted-foreground">{a.policy}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">In {a.days}d</span>
                  <button className="w-7 h-7 rounded-lg bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition">
                    <Phone className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Team Leaderboard Snapshot */}
      <div className="bg-card rounded-xl border p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-foreground flex items-center gap-2"><Trophy className="w-5 h-5 text-warning" /> Team Leaderboard</h2>
          <div className="flex bg-accent rounded-lg p-0.5">
            {["Today", "Week", "Month"].map((t) => (
              <button key={t} className={`px-3 py-1.5 rounded-md text-xs font-medium sidebar-transition ${t === "Today" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left py-2 font-medium">#</th>
                <th className="text-left py-2 font-medium">Agent</th>
                <th className="text-right py-2 font-medium">Calls</th>
                <th className="text-right py-2 font-medium">Policies</th>
                <th className="text-right py-2 font-medium">Appts</th>
                <th className="text-right py-2 font-medium">Goal</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((a) => (
                <tr key={a.rank} className={`border-b last:border-0 ${a.name === "Chris G." ? "bg-primary/5" : ""}`}>
                  <td className="py-2.5 font-bold text-foreground">{a.rank}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{a.avatar}</div>
                      <span className="font-medium text-foreground">{a.name}</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right text-foreground">{a.calls}</td>
                  <td className="py-2.5 text-right text-foreground">{a.policies}</td>
                  <td className="py-2.5 text-right text-foreground">{a.appts}</td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-accent overflow-hidden">
                        <div className={`h-full rounded-full ${a.goal >= 80 ? "bg-success" : a.goal >= 60 ? "bg-warning" : "bg-destructive"}`} style={{ width: `${Math.min(a.goal, 100)}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{a.goal}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
