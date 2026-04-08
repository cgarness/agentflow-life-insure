import React from "react";
import { 
  Plus, 
  UserPlus, 
  Calendar, 
  RotateCcw, 
  PhoneCall 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const QuickActions: React.FC = () => {
  const navigate = useNavigate();

  const actions = [
    {
      label: "New Lead",
      icon: UserPlus,
      onClick: () => navigate("/contacts"),
      gradient: "premium-gradient-blue",
    },
    {
      label: "Schedule",
      icon: Calendar,
      onClick: () => navigate("/calendar"),
      gradient: "premium-gradient-violet",
    },
    {
      label: "Log Call",
      icon: PhoneCall,
      onClick: () => {
        window.dispatchEvent(new CustomEvent("agentflow:open-dialer"));
      },
      gradient: "premium-gradient-emerald",
    },
    {
      label: "Refresh",
      icon: RotateCcw,
      onClick: () => window.location.reload(),
      gradient: "premium-gradient-amber",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          className="group relative flex flex-col items-center justify-center p-4 rounded-xl border border-white/10 glass-card transition-all duration-300 hover:scale-[1.02] active:scale-95"
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 ${action.gradient} shadow-lg transition-transform group-hover:rotate-6`}>
            <action.icon className="w-6 h-6 text-white" />
          </div>
          <span className="text-sm font-semibold text-foreground">{action.label}</span>
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Plus className="w-3 h-3 text-muted-foreground" />
          </div>
        </button>
      ))}
    </div>
  );
};

export default QuickActions;
