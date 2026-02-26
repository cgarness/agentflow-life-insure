import React, { useState } from "react";
import { Trophy, Download, ArrowUp, ArrowDown } from "lucide-react";

const topAgents = [
  { rank: 2, name: "Sarah J.", avatar: "SJ", policies: 18, calls: 142, appts: 24, goal: 90, metal: "Silver", color: "from-gray-200 to-gray-400", trophyColor: "text-gray-400" },
  { rank: 1, name: "Chris G.", avatar: "CG", policies: 23, calls: 187, appts: 31, goal: 115, metal: "Gold", color: "from-yellow-300 to-yellow-500", trophyColor: "text-yellow-500" },
  { rank: 3, name: "Mike T.", avatar: "MT", policies: 15, calls: 128, appts: 19, goal: 75, metal: "Bronze", color: "from-orange-300 to-orange-500", trophyColor: "text-orange-400" },
];

const rankings = [
  { rank: 4, name: "Lisa R.", avatar: "LR", calls: 112, policies: 12, appts: 15, talkTime: "9.2 hrs", conversion: "11%", goal: 60, change: "up" },
  { rank: 5, name: "James W.", avatar: "JW", calls: 98, policies: 10, appts: 12, talkTime: "8.1 hrs", conversion: "10%", goal: 50, change: "down" },
  { rank: 6, name: "Karen P.", avatar: "KP", calls: 87, policies: 8, appts: 10, talkTime: "7.4 hrs", conversion: "9%", goal: 40, change: "up" },
  { rank: 7, name: "Tom B.", avatar: "TB", calls: 76, policies: 7, appts: 8, talkTime: "6.2 hrs", conversion: "9%", goal: 35, change: null },
  { rank: 8, name: "Emily S.", avatar: "ES", calls: 65, policies: 5, appts: 6, talkTime: "5.1 hrs", conversion: "8%", goal: 25, change: "down" },
  { rank: 9, name: "Ryan M.", avatar: "RM", calls: 54, policies: 4, appts: 5, talkTime: "4.3 hrs", conversion: "7%", goal: 20, change: "up" },
];

const wins = [
  { agent: "Chris G.", contact: "John M.", state: "FL", policy: "Term Life", time: "2 hrs ago" },
  { agent: "Sarah J.", contact: "Amy L.", state: "TX", policy: "Whole Life", time: "4 hrs ago" },
  { agent: "Mike T.", contact: "Robert C.", state: "CA", policy: "IUL", time: "Yesterday" },
  { agent: "Lisa R.", contact: "David B.", state: "NY", policy: "Term Life", time: "Yesterday" },
  { agent: "James W.", contact: "Maria G.", state: "OH", policy: "Term Life", time: "2 days ago" },
];

const policyColors: Record<string, string> = {
  "Term Life": "bg-primary/10 text-primary",
  "Whole Life": "bg-success/10 text-success",
  "IUL": "bg-info/10 text-info",
};

const Leaderboard: React.FC = () => {
  const [period, setPeriod] = useState("This Month");
  const [metric, setMetric] = useState("Policies Sold");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Leaderboard</h1>
        <div className="flex items-center gap-3">
          <div className="flex bg-accent rounded-lg p-0.5">
            {["Today", "This Week", "This Month"].map((t) => (
              <button key={t} onClick={() => setPeriod(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium sidebar-transition ${period === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
            ))}
          </div>
          <select value={metric} onChange={(e) => setMetric(e.target.value)} className="h-9 px-3 rounded-lg bg-accent text-sm text-foreground border-0 focus:ring-2 focus:ring-primary/50">
            <option>Policies Sold</option>
            <option>Calls Made</option>
            <option>Appointments</option>
            <option>Talk Time</option>
          </select>
        </div>
      </div>

      {/* Top 3 Podium */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        {[topAgents[0], topAgents[1], topAgents[2]].map((a) => (
          <div key={a.rank} className={`bg-card rounded-xl border p-6 text-center hover:shadow-lg sidebar-transition ${a.rank === 1 ? "md:order-2 md:-mb-4 md:pb-10" : a.rank === 2 ? "md:order-1" : "md:order-3"} ${a.name === "Chris G." ? "ring-2 ring-primary/30" : ""}`}>
            <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full mb-3 ${a.rank === 1 ? "animate-trophy-shine" : ""}`}>
              <Trophy className={`w-8 h-8 ${a.trophyColor}`} />
            </div>
            <div className="w-16 h-16 rounded-full bg-primary/10 text-primary text-xl font-bold flex items-center justify-center mx-auto mb-3">{a.avatar}</div>
            <h3 className="font-bold text-foreground text-lg">{a.name}</h3>
            <span className={`inline-block text-xs px-3 py-0.5 rounded-full font-medium mt-1 bg-gradient-to-r ${a.color} text-foreground`}>#{a.rank} {a.metal}</span>
            <p className="text-3xl font-bold text-foreground mt-3">{a.policies}</p>
            <p className="text-xs text-muted-foreground">policies sold</p>
            <div className="flex justify-center gap-4 mt-3 text-xs text-muted-foreground">
              <span>{a.calls} calls</span>
              <span>{a.appts} appts</span>
            </div>
            <div className="mt-3">
              <div className="w-full h-2 rounded-full bg-accent overflow-hidden">
                <div className={`h-full rounded-full ${a.goal >= 100 ? "bg-success" : a.goal >= 70 ? "bg-primary" : "bg-warning"}`} style={{ width: `${Math.min(a.goal, 100)}%` }} />
              </div>
              <span className="text-xs text-muted-foreground mt-1">{a.goal}% of goal</span>
            </div>
          </div>
        ))}
      </div>

      {/* Rankings Table + Win Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card rounded-xl border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="font-semibold text-foreground">Full Rankings</h3>
            <button className="text-xs text-primary flex items-center gap-1 hover:underline"><Download className="w-3 h-3" /> Export CSV</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-muted-foreground border-b bg-accent/50">
                <th className="text-left py-3 px-4 font-medium w-16">Rank</th>
                <th className="text-left py-3 font-medium">Agent</th>
                <th className="text-right py-3 font-medium">Calls</th>
                <th className="text-right py-3 font-medium">Policies</th>
                <th className="text-right py-3 font-medium hidden lg:table-cell">Appts</th>
                <th className="text-right py-3 font-medium hidden xl:table-cell">Talk Time</th>
                <th className="text-right py-3 font-medium hidden lg:table-cell">Conv %</th>
                <th className="text-right py-3 font-medium">Goal</th>
              </tr></thead>
              <tbody>
                {rankings.map((a) => (
                  <tr key={a.rank} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition ${a.name === "Chris G." ? "bg-primary/5" : ""}`}>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-foreground">{a.rank}</span>
                        {a.change === "up" && <ArrowUp className="w-3 h-3 text-success" />}
                        {a.change === "down" && <ArrowDown className="w-3 h-3 text-destructive" />}
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{a.avatar}</div>
                        <span className="font-medium text-foreground">{a.name}</span>
                      </div>
                    </td>
                    <td className="py-3 text-right text-foreground">{a.calls}</td>
                    <td className="py-3 text-right text-foreground font-medium">{a.policies}</td>
                    <td className="py-3 text-right text-foreground hidden lg:table-cell">{a.appts}</td>
                    <td className="py-3 text-right text-foreground hidden xl:table-cell">{a.talkTime}</td>
                    <td className="py-3 text-right text-foreground hidden lg:table-cell">{a.conversion}</td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-accent overflow-hidden">
                          <div className={`h-full rounded-full ${a.goal >= 50 ? "bg-success" : a.goal >= 30 ? "bg-warning" : "bg-destructive"}`} style={{ width: `${Math.min(a.goal, 100)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{a.goal}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Win Feed */}
        <div className="bg-card rounded-xl border p-5">
          <h3 className="font-semibold text-foreground mb-4">🏆 Recent Wins</h3>
          <div className="space-y-3">
            {wins.map((w, i) => (
              <div key={i} className="flex items-start gap-3 pb-3 border-b last:border-0">
                <div className="w-8 h-8 rounded-full bg-success/10 text-success text-xs font-bold flex items-center justify-center shrink-0">{w.agent.split(" ").map(c => c[0]).join("")}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground"><span className="font-medium">{w.agent}</span> closed {w.contact}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded">{w.state}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${policyColors[w.policy]}`}>{w.policy}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{w.time}</p>
                </div>
                <span className="text-lg shrink-0">🎉</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Leaderboard;
