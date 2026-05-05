import React, { useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AgentCard, MockAgent } from "@/components/ai-agents/AgentCard";

const MOCK_AGENTS: MockAgent[] = [
  {
    name: "Maya",
    type: "SMS agent",
    status: "Active",
    description: "Sends personalized follow-up texts after missed calls. Qualifies interest and books appointments.",
    campaigns: 3,
    sentToday: 247,
    lastTriggered: "4 minutes ago"
  },
  {
    name: "Dani",
    type: "Email agent",
    status: "Active",
    description: "Sends tailored follow-up emails with policy info after initial contact. Includes calendar link.",
    campaigns: 1,
    sentToday: 89,
    lastTriggered: "22 minutes ago"
  },
  {
    name: "Alex",
    type: "Voice outbound",
    status: "Draft",
    description: "Calls cold leads from a campaign, delivers an intro script, and transfers warm leads to a live agent.",
    campaigns: 0,
    lastTriggered: "Not deployed"
  },
  {
    name: "Jordan",
    type: "Voice inbound — receptionist",
    status: "Paused",
    description: "Answers inbound calls after hours. Greets callers, captures intent, routes urgent calls to an on-call agent.",
    campaigns: 0,
    phone: "(909) 555-0143",
    lastTriggered: "—"
  }
];

const FILTER_PILLS = ["All agents", "SMS", "Email", "Voice outbound", "Voice inbound", "Active", "Draft"];

const AIAgentsPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState("All agents");

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-background">
        <div className="px-6 lg:px-8 py-6 max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI Agents</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Deploy automated agents that work your leads via SMS, email, and voice — 24/7.
            </p>
          </div>
          <button 
            onClick={() => navigate("/ai-agents/new")}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
          >
            New Agent
          </button>
        </div>

        {/* Plan usage bar */}
        <div className="px-6 lg:px-8 py-3 bg-muted/50 border-t border-border flex items-center text-sm">
          <div className="max-w-7xl mx-auto w-full flex items-center gap-4">
            <span className="text-muted-foreground font-medium whitespace-nowrap">Agent slots used</span>
            <div className="flex-grow max-w-md h-1.5 bg-border rounded-full overflow-hidden">
              <div className="h-full bg-primary w-[40%] rounded-full" />
            </div>
            <div className="flex items-center gap-4 whitespace-nowrap">
              <span className="font-medium text-foreground">2 / 5 <span className="text-muted-foreground font-normal">on Pro plan</span></span>
              <button className="text-primary hover:text-primary/80 font-medium hover:underline transition-colors">
                Upgrade
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 lg:p-8 max-w-7xl mx-auto w-full flex-grow">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          {FILTER_PILLS.map(pill => (
            <button
              key={pill}
              onClick={() => setActiveFilter(pill)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                activeFilter === pill 
                  ? "bg-foreground text-background shadow-sm" 
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              {pill}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-fr">
          {MOCK_AGENTS.map((agent, idx) => (
            <AgentCard key={idx} agent={agent} />
          ))}

          {/* Empty Add Card */}
          <button 
            onClick={() => navigate("/ai-agents/new")}
            className="min-h-[160px] border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-3 text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors p-6"
          >
            <div className="p-3 bg-muted rounded-full">
              <Plus className="w-6 h-6" />
            </div>
            <span className="font-medium">Add a new agent</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIAgentsPage;
