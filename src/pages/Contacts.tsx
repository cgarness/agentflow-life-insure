import React, { useState } from "react";
import {
  Search, Filter, LayoutGrid, List, Upload, Plus, MoreHorizontal,
  Phone, Eye, Pencil, Trash2, X, ShieldCheck, Calendar, Mail,
} from "lucide-react";

const statusColors: Record<string, string> = {
  "New": "bg-muted text-muted-foreground",
  "Contacted": "bg-primary/10 text-primary",
  "Interested": "bg-warning/10 text-warning",
  "Follow Up": "bg-info/10 text-info",
  "Hot": "bg-warning/20 text-warning",
  "Not Interested": "bg-destructive/10 text-destructive",
  "Closed Won": "bg-success/10 text-success",
  "Closed Lost": "bg-destructive/20 text-destructive",
};

const leads = [
  { name: "John Martinez", phone: "(555) 123-4567", email: "john.m@email.com", state: "FL", status: "Hot", source: "Facebook Ads", score: 9, aging: 2, agent: "Chris G.", lastContact: "Today" },
  { name: "Sarah Williams", phone: "(555) 234-5678", email: "sarah.w@email.com", state: "TX", status: "Interested", source: "Google Ads", score: 7, aging: 3, agent: "Sarah J.", lastContact: "Yesterday" },
  { name: "Mike Johnson", phone: "(555) 345-6789", email: "mike.j@email.com", state: "CA", status: "New", source: "Direct Mail", score: 5, aging: 1, agent: "Mike T.", lastContact: "Today" },
  { name: "Lisa Park", phone: "(555) 456-7890", email: "lisa.p@email.com", state: "NY", status: "Follow Up", source: "Referral", score: 8, aging: 5, agent: "Chris G.", lastContact: "3 days ago" },
  { name: "Tom Harris", phone: "(555) 567-8901", email: "tom.h@email.com", state: "OH", status: "Contacted", source: "Webinar", score: 6, aging: 4, agent: "Lisa R.", lastContact: "2 days ago" },
  { name: "Amy Zhang", phone: "(555) 678-9012", email: "amy.z@email.com", state: "WA", status: "Closed Won", source: "Facebook Ads", score: 10, aging: 0, agent: "James W.", lastContact: "Today" },
  { name: "David Brown", phone: "(555) 789-0123", email: "david.b@email.com", state: "FL", status: "Not Interested", source: "Google Ads", score: 3, aging: 7, agent: "Sarah J.", lastContact: "1 week ago" },
  { name: "Maria Lopez", phone: "(555) 890-1234", email: "maria.l@email.com", state: "AZ", status: "Hot", source: "Referral", score: 9, aging: 1, agent: "Mike T.", lastContact: "Today" },
];

const sourcePerf = [
  { source: "Facebook Ads", leads: 85, contacted: "72%", conversion: "12%", sold: 10 },
  { source: "Google Ads", leads: 62, contacted: "68%", conversion: "9%", sold: 6 },
  { source: "Direct Mail", leads: 45, contacted: "56%", conversion: "15%", sold: 7 },
  { source: "Referral", leads: 28, contacted: "89%", conversion: "25%", sold: 7 },
  { source: "Webinar", leads: 20, contacted: "80%", conversion: "18%", sold: 4 },
];

const clients = [
  { name: "Robert Chen", phone: "(555) 111-2222", policy: "Term", carrier: "Mutual of Omaha", premium: "$42/mo", face: "$500K", issued: "2024-01-15", status: "Active" },
  { name: "Jennifer Wu", phone: "(555) 222-3333", policy: "Whole Life", carrier: "Transamerica", premium: "$125/mo", face: "$250K", issued: "2023-08-20", status: "Active" },
  { name: "Mark Stevens", phone: "(555) 333-4444", policy: "IUL", carrier: "Prudential", premium: "$200/mo", face: "$750K", issued: "2024-03-10", status: "Active" },
  { name: "Karen White", phone: "(555) 444-5555", policy: "Term", carrier: "John Hancock", premium: "$35/mo", face: "$400K", issued: "2023-11-05", status: "Active" },
  { name: "James Rodriguez", phone: "(555) 555-6666", policy: "Whole Life", carrier: "Mutual of Omaha", premium: "$95/mo", face: "$300K", issued: "2024-05-22", status: "Pending" },
];

const agents = [
  { name: "Chris Garcia", email: "chris@agentflow.com", states: "FL, TX, CA", commission: "80%", status: "Active", avail: "bg-success", progress: 90 },
  { name: "Sarah Johnson", email: "sarah@agentflow.com", states: "TX, NY", commission: "75%", status: "Active", avail: "bg-success", progress: 85 },
  { name: "Mike Thompson", email: "mike@agentflow.com", states: "CA, WA, OR", commission: "70%", status: "Active", avail: "bg-warning", progress: 70 },
  { name: "Lisa Roberts", email: "lisa@agentflow.com", states: "NY, NJ, CT", commission: "65%", status: "Active", avail: "bg-success", progress: 60 },
];

const policyTypeColors: Record<string, string> = {
  "Term": "bg-primary/10 text-primary",
  "Whole Life": "bg-success/10 text-success",
  "IUL": "bg-info/10 text-info",
};

const Contacts: React.FC = () => {
  const [tab, setTab] = useState<"Leads" | "Clients" | "Recruits" | "Agents">("Leads");
  const [view, setView] = useState<"table" | "kanban">("table");
  const [contactModal, setContactModal] = useState<string | null>(null);

  const tabs = ["Leads", "Clients", "Recruits", "Agents"] as const;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Contacts</h1>

      {/* Tabs */}
      <div className="flex border-b">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium sidebar-transition ${tab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search contacts..." className="w-full h-9 pl-9 pr-4 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <button className="h-9 px-3 rounded-lg bg-accent text-foreground text-sm flex items-center gap-2 hover:bg-accent/80 sidebar-transition"><Filter className="w-4 h-4" /> Filter</button>
        {(tab === "Leads" || tab === "Recruits") && (
          <div className="flex bg-accent rounded-lg p-0.5">
            <button onClick={() => setView("table")} className={`px-2.5 py-1 rounded-md sidebar-transition ${view === "table" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><List className="w-4 h-4" /></button>
            <button onClick={() => setView("kanban")} className={`px-2.5 py-1 rounded-md sidebar-transition ${view === "kanban" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><LayoutGrid className="w-4 h-4" /></button>
          </div>
        )}
        <div className="flex-1" />
        <button className="h-9 px-3 rounded-lg bg-accent text-foreground text-sm flex items-center gap-2 hover:bg-accent/80 sidebar-transition"><Upload className="w-4 h-4" /> Import CSV</button>
        <button className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 sidebar-transition"><Plus className="w-4 h-4" /> Add Contact</button>
      </div>

      {/* LEADS TAB */}
      {tab === "Leads" && view === "table" && (
        <>
          {/* Source Performance */}
          <div className="bg-card rounded-xl border p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Lead Source Performance</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-muted-foreground border-b">
                  <th className="text-left py-2 font-medium">Source</th>
                  <th className="text-right py-2 font-medium">Leads</th>
                  <th className="text-right py-2 font-medium">Contacted %</th>
                  <th className="text-right py-2 font-medium">Conversion %</th>
                  <th className="text-right py-2 font-medium">Policies Sold</th>
                </tr></thead>
                <tbody>
                  {sourcePerf.map((s) => (
                    <tr key={s.source} className="border-b last:border-0">
                      <td className="py-2 font-medium text-foreground">{s.source}</td>
                      <td className="py-2 text-right text-foreground">{s.leads}</td>
                      <td className="py-2 text-right text-foreground">{s.contacted}</td>
                      <td className="py-2 text-right text-foreground">{s.conversion}</td>
                      <td className="py-2 text-right text-foreground">{s.sold}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Leads Table */}
          <div className="bg-card rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-muted-foreground border-b bg-accent/50">
                  <th className="w-10 py-3 px-3"><input type="checkbox" className="rounded" /></th>
                  <th className="text-left py-3 font-medium">Name</th>
                  <th className="text-left py-3 font-medium">Phone</th>
                  <th className="text-left py-3 font-medium hidden lg:table-cell">Email</th>
                  <th className="text-left py-3 font-medium">State</th>
                  <th className="text-left py-3 font-medium">Status</th>
                  <th className="text-left py-3 font-medium hidden xl:table-cell">Source</th>
                  <th className="text-center py-3 font-medium">Score</th>
                  <th className="text-center py-3 font-medium hidden lg:table-cell">Aging</th>
                  <th className="text-left py-3 font-medium hidden xl:table-cell">Agent</th>
                  <th className="text-left py-3 font-medium hidden lg:table-cell">Last Contact</th>
                  <th className="w-10 py-3"></th>
                </tr></thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.name} className="border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer" onClick={() => setContactModal(l.name)}>
                      <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="rounded" /></td>
                      <td className="py-3 font-medium text-foreground">{l.name}</td>
                      <td className="py-3 text-foreground font-mono text-xs">{l.phone}</td>
                      <td className="py-3 text-muted-foreground hidden lg:table-cell">{l.email}</td>
                      <td className="py-3"><span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">{l.state}</span></td>
                      <td className="py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[l.status] || "bg-muted text-muted-foreground"}`}>{l.status}</span></td>
                      <td className="py-3 text-muted-foreground hidden xl:table-cell">{l.source}</td>
                      <td className="py-3 text-center"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${l.score >= 8 ? "bg-success/10 text-success" : l.score >= 5 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"}`}>{l.score}</span></td>
                      <td className="py-3 text-center hidden lg:table-cell"><span className={`w-2.5 h-2.5 rounded-full inline-block ${l.aging >= 5 ? "bg-destructive" : l.aging >= 3 ? "bg-warning" : "bg-success"}`} /></td>
                      <td className="py-3 text-foreground hidden xl:table-cell">{l.agent}</td>
                      <td className="py-3 text-muted-foreground hidden lg:table-cell">{l.lastContact}</td>
                      <td className="py-3" onClick={(e) => e.stopPropagation()}><button className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="w-4 h-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Kanban View */}
      {tab === "Leads" && view === "kanban" && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {Object.keys(statusColors).map((status) => {
            const items = leads.filter((l) => l.status === status);
            return (
              <div key={status} className="min-w-[250px] bg-accent/50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[status]}`}>{status}</span>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                {items.map((l) => (
                  <div key={l.name} className="bg-card rounded-lg border p-3 cursor-pointer hover:shadow-md sidebar-transition" onClick={() => setContactModal(l.name)}>
                    <p className="text-sm font-medium text-foreground">{l.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{l.state}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${l.score >= 8 ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{l.score}</span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-muted-foreground">{l.source}</span>
                      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">{l.agent.split(" ").map(w => w[0]).join("")}</div>
                    </div>
                  </div>
                ))}
                <button className="w-full py-2 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent sidebar-transition">+ Add</button>
              </div>
            );
          })}
        </div>
      )}

      {/* CLIENTS TAB */}
      {tab === "Clients" && (
        <div className="bg-card rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-muted-foreground border-b bg-accent/50">
                <th className="text-left py-3 px-4 font-medium">Name</th>
                <th className="text-left py-3 font-medium">Phone</th>
                <th className="text-left py-3 font-medium">Policy Type</th>
                <th className="text-left py-3 font-medium hidden lg:table-cell">Carrier</th>
                <th className="text-left py-3 font-medium">Premium</th>
                <th className="text-left py-3 font-medium hidden lg:table-cell">Face Amount</th>
                <th className="text-left py-3 font-medium hidden xl:table-cell">Issue Date</th>
                <th className="text-left py-3 font-medium">Status</th>
                <th className="w-10 py-3"></th>
              </tr></thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.name} className="border-b last:border-0 hover:bg-accent/30 sidebar-transition">
                    <td className="py-3 px-4 font-medium text-foreground">{c.name}</td>
                    <td className="py-3 font-mono text-xs text-foreground">{c.phone}</td>
                    <td className="py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${policyTypeColors[c.policy]}`}>{c.policy}</span></td>
                    <td className="py-3 text-muted-foreground hidden lg:table-cell">{c.carrier}</td>
                    <td className="py-3 text-foreground">{c.premium}</td>
                    <td className="py-3 text-foreground hidden lg:table-cell">{c.face}</td>
                    <td className="py-3 text-muted-foreground hidden xl:table-cell">{c.issued}</td>
                    <td className="py-3"><span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full font-medium">{c.status}</span></td>
                    <td className="py-3"><button className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* RECRUITS TAB */}
      {tab === "Recruits" && (
        <div className="bg-card rounded-xl border p-8 text-center">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold text-foreground mb-1">Recruit Pipeline</h3>
          <p className="text-sm text-muted-foreground mb-4">Track and manage your recruiting pipeline with kanban boards and status tracking.</p>
          <div className="flex gap-3 overflow-x-auto pb-4 mt-6">
            {["Prospect", "Contacted", "Interview", "Licensed", "Active"].map((s) => (
              <div key={s} className="min-w-[200px] bg-accent/50 rounded-xl p-3">
                <span className="text-xs font-semibold text-foreground">{s}</span>
                <div className="mt-2 bg-card rounded-lg border p-3">
                  <p className="text-sm text-muted-foreground">Sample recruit card</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AGENTS TAB */}
      {tab === "Agents" && (
        <div className="bg-card rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-muted-foreground border-b bg-accent/50">
                <th className="text-left py-3 px-4 font-medium">Agent</th>
                <th className="text-left py-3 font-medium">Email</th>
                <th className="text-left py-3 font-medium hidden lg:table-cell">Licensed States</th>
                <th className="text-left py-3 font-medium">Commission</th>
                <th className="text-left py-3 font-medium">Status</th>
                <th className="text-left py-3 font-medium">Onboarding</th>
                <th className="w-10 py-3"></th>
              </tr></thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.name} className="border-b last:border-0 hover:bg-accent/30 sidebar-transition">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{a.name.split(" ").map(w => w[0]).join("")}</div>
                          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${a.avail}`} />
                        </div>
                        <span className="font-medium text-foreground">{a.name}</span>
                      </div>
                    </td>
                    <td className="py-3 text-muted-foreground">{a.email}</td>
                    <td className="py-3 text-foreground hidden lg:table-cell">{a.states}</td>
                    <td className="py-3 text-foreground">{a.commission}</td>
                    <td className="py-3"><span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full font-medium">{a.status}</span></td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 rounded-full bg-accent overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${a.progress}%` }} /></div>
                        <span className="text-xs text-muted-foreground">{a.progress}%</span>
                      </div>
                    </td>
                    <td className="py-3"><button className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Contact Modal */}
      {contactModal && (
        <>
          <div className="fixed inset-0 bg-foreground/30 z-50" onClick={() => setContactModal(null)} />
          <div className="fixed inset-4 md:inset-x-[10%] md:inset-y-[5%] bg-card rounded-2xl border shadow-2xl z-50 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-primary/10 text-primary text-lg font-bold flex items-center justify-center">{contactModal.split(" ").map(w => w[0]).join("")}</div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">{contactModal}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded-full font-medium">Hot</span>
                    <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full font-bold">9</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setContactModal(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex items-center gap-2 px-6 py-3 border-b shrink-0">
              <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90"><Phone className="w-4 h-4" /> Call</button>
              <button className="px-4 py-2 rounded-lg bg-accent text-foreground text-sm font-medium flex items-center gap-2 hover:bg-accent/80"><Mail className="w-4 h-4" /> Email</button>
              <button className="px-4 py-2 rounded-lg bg-accent text-foreground text-sm font-medium flex items-center gap-2 hover:bg-accent/80"><Calendar className="w-4 h-4" /> Schedule</button>
              <button className="px-4 py-2 rounded-lg bg-success/10 text-success text-sm font-medium flex items-center gap-2 hover:bg-success/20"><ShieldCheck className="w-4 h-4" /> Convert</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  {[["Phone", "(555) 123-4567"], ["Email", "john.m@email.com"], ["State", "Florida"], ["Age", "34"], ["Lead Source", "Facebook Ads"], ["Assigned Agent", "Chris G."], ["Created", "Jan 15, 2025"]].map(([k, v]) => (
                    <div key={k}><label className="text-xs text-muted-foreground">{k}</label><p className="text-sm font-medium text-foreground">{v}</p></div>
                  ))}
                </div>
                <div className="space-y-4">
                  <h3 className="font-semibold text-foreground">Activity Timeline</h3>
                  {[
                    { action: "Call - Interested", time: "Today 10:15 AM", agent: "Chris G." },
                    { action: "SMS Sent", time: "Yesterday 3:00 PM", agent: "Chris G." },
                    { action: "Lead Assigned", time: "2 days ago", agent: "System" },
                    { action: "Lead Created", time: "3 days ago", agent: "System" },
                  ].map((a, i) => (
                    <div key={i} className="flex gap-3 pb-3 border-b last:border-0">
                      <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />
                      <div>
                        <p className="text-sm text-foreground">{a.action}</p>
                        <p className="text-xs text-muted-foreground">{a.time} · {a.agent}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between px-6 py-3 border-t shrink-0">
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded-lg text-destructive text-xs font-medium hover:bg-destructive/10 sidebar-transition">Delete Contact</button>
                <button className="px-3 py-1.5 rounded-lg text-muted-foreground text-xs font-medium hover:bg-accent sidebar-transition">Merge Contact</button>
              </div>
              <span className="text-xs text-muted-foreground">Created Jan 15, 2025</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Contacts;
