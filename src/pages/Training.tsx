import React, { useState } from "react";
import { Search, Play, FileText, ExternalLink, Check, ChevronDown, Plus } from "lucide-react";

const categories = [
  {
    name: "Product Training",
    resources: [
      { title: "Term Life Basics", type: "Video", duration: "12 min", completed: true },
      { title: "Whole Life Deep Dive", type: "Video", duration: "18 min", completed: true },
      { title: "IUL Explained", type: "PDF", duration: "", completed: false },
      { title: "Final Expense Guide", type: "Video", duration: "8 min", completed: false },
    ],
  },
  {
    name: "Sales Scripts & Objections",
    resources: [
      { title: "Overcoming Price Objections", type: "Video", duration: "15 min", completed: false },
      { title: "Cold Call Opening Scripts", type: "PDF", duration: "", completed: false },
      { title: "Objection Handling Masterclass", type: "Video", duration: "25 min", completed: false },
    ],
  },
  {
    name: "Compliance & Regulations",
    resources: [
      { title: "TCPA Compliance Guide", type: "PDF", duration: "", completed: false },
      { title: "State Licensing Requirements", type: "Link", duration: "", completed: false },
    ],
  },
  {
    name: "Carrier Specific Training",
    resources: [
      { title: "Mutual of Omaha Products", type: "Video", duration: "20 min", completed: false },
      { title: "Transamerica Portal Tutorial", type: "Video", duration: "10 min", completed: false },
      { title: "Prudential Underwriting Guide", type: "PDF", duration: "", completed: false },
    ],
  },
  {
    name: "Technology & Tools",
    resources: [
      { title: "AgentFlow Getting Started", type: "Video", duration: "15 min", completed: true },
      { title: "Dialer Best Practices", type: "PDF", duration: "", completed: false },
    ],
  },
  {
    name: "Onboarding",
    resources: [
      { title: "Welcome to the Team", type: "Video", duration: "5 min", completed: true, required: true },
      { title: "Setting Up Your Profile", type: "Video", duration: "8 min", completed: true, required: true },
      { title: "First Day Checklist", type: "PDF", duration: "", completed: true },
      { title: "Meet the Team", type: "Link", duration: "", completed: true },
    ],
  },
];

const totalResources = categories.reduce((acc, c) => acc + c.resources.length, 0);
const completedResources = categories.reduce((acc, c) => acc + c.resources.filter((r) => r.completed).length, 0);

const typeIcon = (type: string) => {
  if (type === "Video") return <Play className="w-4 h-4" />;
  if (type === "PDF") return <FileText className="w-4 h-4" />;
  return <ExternalLink className="w-4 h-4" />;
};

const typeColor = (type: string) => {
  if (type === "Video") return "bg-primary/10 text-primary";
  if (type === "PDF") return "bg-warning/10 text-warning";
  return "bg-info/10 text-info";
};

const Training: React.FC = () => {
  const [viewResource, setViewResource] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Training</h1>
        <button className="px-4 py-2 rounded-lg bg-accent text-foreground text-sm flex items-center gap-2 hover:bg-accent/80 sidebar-transition"><Plus className="w-4 h-4" /> Add Category</button>
      </div>

      {/* Progress */}
      <div className="bg-card rounded-xl border p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">My Progress</span>
          <span className="text-sm text-muted-foreground">{completedResources} of {totalResources} completed</span>
        </div>
        <div className="w-full h-3 rounded-full bg-accent overflow-hidden">
          <div className="h-full rounded-full bg-primary sidebar-transition" style={{ width: `${(completedResources / totalResources) * 100}%` }} />
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" placeholder="Search training resources..." className="w-full h-9 pl-9 pr-4 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>

      {/* Categories */}
      {categories.map((cat) => (
        <div key={cat.name}>
          <h2 className="text-lg font-semibold text-foreground mb-3">{cat.name} <span className="text-sm font-normal text-muted-foreground">({cat.resources.length} resources)</span></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {cat.resources.map((r) => (
              <div
                key={r.title}
                onClick={() => setViewResource(r.title)}
                className="bg-card rounded-xl border p-4 hover:shadow-md sidebar-transition cursor-pointer group relative"
              >
                {r.completed && (
                  <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-success flex items-center justify-center">
                    <Check className="w-3.5 h-3.5 text-success-foreground" />
                  </div>
                )}
                <div className={`w-full h-24 rounded-lg ${r.type === "Video" ? "bg-primary/5" : "bg-accent"} flex items-center justify-center mb-3 group-hover:scale-[1.02] sidebar-transition`}>
                  <div className={`w-10 h-10 rounded-full ${typeColor(r.type)} flex items-center justify-center`}>
                    {typeIcon(r.type)}
                  </div>
                </div>
                <h3 className="text-sm font-medium text-foreground mb-1">{r.title}</h3>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColor(r.type)}`}>{r.type}</span>
                  {r.duration && <span className="text-xs text-muted-foreground">{r.duration}</span>}
                  {(r as any).required && <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded-full font-medium">Required</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Resource Viewer Modal */}
      {viewResource && (
        <>
          <div className="fixed inset-0 bg-foreground/30 z-50" onClick={() => setViewResource(null)} />
          <div className="fixed inset-4 md:inset-x-[15%] md:inset-y-[10%] bg-card rounded-2xl border shadow-2xl z-50 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-semibold text-foreground">{viewResource}</h2>
              <button onClick={() => setViewResource(null)} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="w-full aspect-video bg-accent rounded-xl flex items-center justify-center">
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto"><Play className="w-8 h-8" /></div>
                  <p className="text-sm text-muted-foreground">Video player placeholder</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Video</span>
                <span className="text-xs text-muted-foreground">12 min</span>
              </div>
              <p className="text-sm text-muted-foreground">This training covers the fundamentals and best practices. Complete this module to advance your progress.</p>
              <button className="px-4 py-2 rounded-lg bg-success text-success-foreground text-sm font-medium hover:bg-success/90 sidebar-transition flex items-center gap-2"><Check className="w-4 h-4" /> Mark as Complete</button>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Personal Notes</h3>
                <textarea placeholder="Add your notes about this resource..." className="w-full px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" rows={4} />
              </div>
            </div>
            <div className="flex items-center justify-between px-6 py-3 border-t">
              <button className="text-sm text-muted-foreground hover:text-foreground sidebar-transition">← Previous</button>
              <button className="text-sm text-primary font-medium hover:underline sidebar-transition">Next →</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Training;
