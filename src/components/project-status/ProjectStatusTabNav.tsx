import React from "react";
import { cn } from "@/lib/utils";
import { BookOpen } from "lucide-react";

export type ProjectStatusTabId = "overview" | "reference" | string;

export interface ProjectStatusTabItem {
  id: ProjectStatusTabId;
  label: string;
}

interface ProjectStatusTabNavProps {
  tabs: ProjectStatusTabItem[];
  activeId: ProjectStatusTabId;
  onSelect: (id: ProjectStatusTabId) => void;
}

const ProjectStatusTabNav: React.FC<ProjectStatusTabNavProps> = ({ tabs, activeId, onSelect }) => (
  <nav className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible lg:overflow-y-auto lg:max-h-[calc(100vh-12rem)] pb-2 lg:pb-0 lg:pr-2 shrink-0 lg:sticky lg:top-20 lg:self-start lg:w-44">
    {tabs.map((tab) => {
      const isActive = activeId === tab.id;
      const Icon = tab.id === "reference" ? BookOpen : null;
      return (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          className={cn(
            "text-left px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors shrink-0 lg:shrink",
            "lg:w-full",
            isActive
              ? "bg-primary/15 text-primary border border-primary/30"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
          )}
        >
          <span className="flex items-center gap-2">
            {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
            {tab.label}
          </span>
        </button>
      );
    })}
  </nav>
);

export default ProjectStatusTabNav;
