import React from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  defaultOpen?: boolean;
  /** Present only when the viewer may export (server `can_export`); omitted otherwise. */
  onExport?: () => void;
  children: React.ReactNode;
  badge?: string;
}

const ReportSection: React.FC<Props> = ({ title, defaultOpen = true, onExport, children, badge }) => {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="bg-card rounded-xl border border-border/60 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300">
      <div
        className="w-full flex items-center justify-between px-6 py-4 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <div className={cn("p-1.5 rounded-lg transition-colors", open ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
          <h3 className="font-bold text-foreground text-base tracking-tight">{title}</h3>
          {badge && <span className="text-[10px] uppercase font-black tracking-widest bg-primary/5 text-primary px-2.5 py-1 rounded-lg border border-primary/10">{badge}</span>}
        </div>
        {onExport && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 rounded-xl hover:bg-primary/5 hover:text-primary text-muted-foreground font-bold text-xs"
            onClick={e => { e.stopPropagation(); onExport(); }}
          >
            <Download className="w-3.5 h-3.5 mr-2" />
            CSV
          </Button>
        )}
      </div>
      <div className={cn("transition-all duration-300 ease-in-out overflow-hidden", open ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0")}>
        <div className="px-6 pb-6">
          {children}
        </div>
      </div>
    </div>
  );
};

export default ReportSection;
