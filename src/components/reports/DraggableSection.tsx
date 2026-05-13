import React from "react";
import { GripVertical, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

const SECTION_NAMES: Record<string, string> = {
  kpi_cards: "Key Performance Indicators",
  call_volume: "Call Volume Trends",
  conversion_funnel: "Conversion Funnel",
  communications_stats: "Communications Stats",
  calling_heatmap: "Calling Heatmap",
  call_flow_analysis: "Call Flow Analysis",
  call_duration_analysis: "Call Duration Analysis",
  disposition_deep_dive: "Disposition Deep Dive",
  policies_sold: "Policies Sold",
  campaign_performance: "Campaign Performance",
  lead_source_roi: "Lead Source Table",
  agent_performance_cards: "Agent Performance Cards",
  agent_efficiency: "Agent Efficiency",
  goal_tracking: "Goal Tracking",
};

interface Props {
  id: string;
  visible: boolean;
  editMode: boolean;
  children: React.ReactNode;
  onToggleVisibility: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDrop: (id: string) => void;
  isDragging: boolean;
  dragOverId: string | null;
}

const DraggableSection: React.FC<Props> = ({
  id, visible, editMode, children,
  onToggleVisibility, onDragStart, onDragOver, onDrop,
  isDragging, dragOverId
}) => {
  const isKpi = id === "kpi_cards";
  const isTarget = dragOverId === id;

  if (!editMode) {
    return visible ? <>{children}</> : null;
  }

  return (
    <div 
      className={cn(
        "relative transition-all duration-200 border-2 rounded-xl group/section",
        !visible && "opacity-60 grayscale-[0.5]",
        isTarget && !isKpi ? "border-primary border-t-[4px] shadow-lg scale-[1.01]" : "border-transparent",
        isDragging && "opacity-30"
      )}
      draggable={!isKpi}
      onDragStart={(e) => {
        if (isKpi) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        onDragStart(id);
      }}
      onDragOver={(e) => {
        if (isKpi) return;
        e.preventDefault();
        onDragOver(id);
      }}
      onDrop={(e) => {
        if (isKpi) return;
        e.preventDefault();
        onDrop(id);
      }}
    >
      <div className="absolute -left-3 top-0 bottom-0 flex items-center justify-center w-8 z-20 group/handle">
        {!isKpi && (
          <div className="p-1 rounded-md bg-white border border-slate-200 shadow-sm text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing dark:bg-slate-800 dark:border-slate-700 dark:hover:text-slate-200 opacity-0 group-hover/section:opacity-100 transition-opacity">
            <GripVertical className="w-4 h-4" />
          </div>
        )}
      </div>

      <div className="absolute right-4 top-4 flex items-center justify-center z-20 group/toggle">
        {!isKpi && (
          <button 
            onClick={() => onToggleVisibility(id)}
            className="p-1.5 rounded-full bg-white border border-slate-200 shadow-sm text-slate-400 hover:text-primary hover:border-primary/30 transition-all dark:bg-slate-800 dark:border-slate-700 opacity-0 group-hover/section:opacity-100"
          >
            {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        )}
      </div>

      {visible ? (
        <div className="pointer-events-auto">
          {children}
        </div>
      ) : (
        <div className="h-16 bg-card border rounded-xl flex items-center px-6 shadow-sm">
          <p className="text-sm font-bold text-muted-foreground line-through">{SECTION_NAMES[id] || id}</p>
        </div>
      )}
    </div>
  );
};

export default DraggableSection;
