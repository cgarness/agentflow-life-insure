import React from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/commission/ui/CommissionSurface";

interface EditorHeaderProps {
  title: string;
  /** Shown under the title (effective date, levels, last edited). */
  meta: React.ReactNode;
  backLabel: string;
  onBack: () => void;
  calculator?: boolean;
  active?: boolean;
  /** Right-aligned actions (the viewer's Duplicate). */
  action?: React.ReactNode;
}

/** Workspace header shared by the grid editor and the read-only grid viewer. */
const EditorHeader: React.FC<EditorHeaderProps> = ({ title, meta, backLabel, onBack, calculator, active, action }) => (
  <div className="space-y-3">
    <Button variant="ghost" size="sm" className="-ml-2 h-8 text-muted-foreground hover:text-foreground" onClick={onBack}>
      <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> {backLabel}
    </Button>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h2>
          {calculator && <StatusPill tone="primary">Calculator</StatusPill>}
          {active === false && <StatusPill tone="muted">Inactive</StatusPill>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
      </div>
      {action}
    </div>
  </div>
);

export default EditorHeader;
