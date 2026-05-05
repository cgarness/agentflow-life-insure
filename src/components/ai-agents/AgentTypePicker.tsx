import React from "react";
import { ChevronLeft, MessageSquare, Mail, PhoneOutgoing, PhoneIncoming } from "lucide-react";
import { useNavigate } from "react-router-dom";

export type AgentType = "SMS agent" | "Email agent" | "Voice outbound" | "Voice inbound";

interface AgentTypePickerProps {
  selectedType: AgentType;
  onSelectType: (type: AgentType) => void;
}

const TYPE_OPTIONS = [
  {
    id: "SMS agent" as AgentType,
    label: "SMS agent",
    icon: MessageSquare,
    description: "Send automated text messages and follow-ups.",
    badge: "Available",
    badgeColor: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    iconBg: "bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400"
  },
  {
    id: "Email agent" as AgentType,
    label: "Email agent",
    icon: Mail,
    description: "Send personalized emails with scheduling links.",
    badge: "Available",
    badgeColor: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    iconBg: "bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400"
  },
  {
    id: "Voice outbound" as AgentType,
    label: "Voice outbound",
    icon: PhoneOutgoing,
    description: "Make outbound calls and transfer warm leads.",
    badge: "Coming soon",
    badgeColor: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
    iconBg: "bg-violet-50 dark:bg-violet-950 text-violet-600 dark:text-violet-400"
  },
  {
    id: "Voice inbound" as AgentType,
    label: "Voice inbound",
    icon: PhoneIncoming,
    description: "Answer incoming calls 24/7 like a receptionist.",
    badge: "Coming soon",
    badgeColor: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
    iconBg: "bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400"
  }
];

export const AgentTypePicker: React.FC<AgentTypePickerProps> = ({ selectedType, onSelectType }) => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <button 
          onClick={() => navigate("/ai-agents")}
          className="p-2 -ml-2 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Create an AI agent</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Choose a type to get started.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {TYPE_OPTIONS.map((option) => {
          const isSelected = selectedType === option.id;
          const Icon = option.icon;

          return (
            <button
              key={option.id}
              onClick={() => onSelectType(option.id)}
              className={`text-left flex items-start gap-4 p-4 rounded-xl border transition-all ${
                isSelected 
                  ? "border-foreground ring-1 ring-foreground bg-accent/50" 
                  : "border-border bg-card hover:border-primary/30"
              }`}
            >
              <div className={`p-2 rounded-md shrink-0 ${option.iconBg}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-grow pt-0.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-medium text-foreground">{option.label}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${option.badgeColor}`}>
                    {option.badge}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
