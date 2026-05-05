import React from "react";
import { MessageSquare, Mail, PhoneOutgoing, PhoneIncoming } from "lucide-react";

export interface MockAgent {
  name: string;
  type: "SMS agent" | "Email agent" | "Voice outbound" | "Voice inbound" | "Voice inbound — receptionist";
  status: "Active" | "Draft" | "Paused";
  description: string;
  campaigns: number;
  sentToday?: number;
  lastTriggered: string;
  phone?: string;
}

export const AgentCard: React.FC<{ agent: MockAgent }> = ({ agent }) => {
  // Determine icon and color
  let Icon = MessageSquare;
  let bgClass = "bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400";
  
  if (agent.type === "Email agent") {
    Icon = Mail;
    bgClass = "bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400";
  } else if (agent.type === "Voice outbound") {
    Icon = PhoneOutgoing;
    bgClass = "bg-violet-50 dark:bg-violet-950 text-violet-600 dark:text-violet-400";
  } else if (agent.type.startsWith("Voice inbound")) {
    Icon = PhoneIncoming;
    bgClass = "bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400";
  }

  const isVoice = agent.type.includes("Voice");

  const statusTint = 
    agent.status === "Active" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" :
    agent.status === "Draft" ? "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300" :
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300";

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full gap-4 hover:border-primary/30 transition-colors">
      <div className="flex justify-between items-start">
        <div className={`p-2 rounded-md ${bgClass}`}>
          <Icon className="w-5 h-5" />
        </div>
        <span className={`px-2 py-1 rounded-full text-[10px] font-medium uppercase tracking-wider ${statusTint}`}>
          {agent.status}
        </span>
      </div>
      
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-medium text-foreground">{agent.name}</h3>
          <span className="text-xs text-muted-foreground">{agent.type}</span>
        </div>
        {isVoice && (
          <div className="mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium uppercase tracking-wider">
              Coming soon
            </span>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed flex-grow">
        {agent.description}
      </p>

      <div className="flex items-center gap-3 text-xs text-muted-foreground font-medium flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-border" />
          <span>{agent.campaigns} campaigns</span>
        </div>
        {agent.sentToday !== undefined && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-border" />
            <span>Sent today: {agent.sentToday}</span>
          </div>
        )}
        {agent.phone && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-border" />
            <span>{agent.phone}</span>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-4 mt-auto flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Last triggered:</span> {agent.lastTriggered}
        </div>
        <div className="flex gap-2">
          <button className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted">
            View logs
          </button>
          <button className="text-xs font-medium text-foreground hover:bg-muted transition-colors px-2 py-1 rounded-md">
            Edit
          </button>
        </div>
      </div>
    </div>
  );
};
