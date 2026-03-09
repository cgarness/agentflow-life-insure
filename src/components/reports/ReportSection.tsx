import React from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  defaultOpen?: boolean;
  onExport?: () => void;
  children: React.ReactNode;
  badge?: string;
}

const ReportSection: React.FC<Props> = ({ title, defaultOpen = true, onExport, children, badge }) => {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="bg-card rounded-xl border overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-accent/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          <h3 className="font-semibold text-foreground text-sm">{title}</h3>
          {badge && <span className="text-xs bg-accent text-muted-foreground px-2 py-0.5 rounded-full">{badge}</span>}
        </div>
        {onExport && open && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); onExport(); }}>
            <Download className="w-3.5 h-3.5" />
          </Button>
        )}
      </button>
      <div className={cn("transition-all duration-200 overflow-hidden", open ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0")}>
        <div className="px-5 pb-5">
          {children}
        </div>
      </div>
    </div>
  );
};

export default ReportSection;
