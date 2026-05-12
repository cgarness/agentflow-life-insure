import React from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ErrorBoundary from "@/components/ErrorBoundary";

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
    <div className="bg-white dark:bg-slate-950 rounded-[2rem] border border-slate-200/50 dark:border-slate-800/50 overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-slate-200/20 dark:hover:shadow-none transition-all duration-500 group/section">
      <div
        className="w-full flex items-center justify-between px-7 py-5 cursor-pointer select-none relative overflow-hidden"
        onClick={() => setOpen(o => !o)}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent opacity-0 group-hover/section:opacity-100 transition-opacity duration-500 pointer-events-none" />

        <div className="flex items-center gap-4 relative z-10">
          <div className={cn(
            "p-2 rounded-xl transition-all duration-300", 
            open ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-110" : "bg-slate-100 dark:bg-slate-800 text-slate-400 group-hover/section:bg-slate-200 dark:group-hover/section:bg-slate-700"
          )}>
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
          <h3 className="font-extrabold text-slate-900 dark:text-slate-100 text-lg tracking-tight group-hover/section:translate-x-0.5 transition-transform duration-300">{title}</h3>
          {badge && <span className="text-[10px] uppercase font-black tracking-widest bg-primary/10 text-primary px-3 py-1.5 rounded-xl border border-primary/20 shadow-sm">{badge}</span>}
        </div>

        {onExport && (
          <Button 
            variant="outline" 
            size="sm" 
            className="h-9 px-4 rounded-xl border-slate-200 dark:border-slate-800 hover:border-primary/50 hover:bg-primary/5 hover:text-primary text-slate-500 dark:text-slate-400 font-bold text-xs transition-all duration-300 relative z-10 shadow-sm" 
            onClick={e => { e.stopPropagation(); onExport(); }}
          >
            <Download className="w-3.5 h-3.5 mr-2" />
            Export Data
          </Button>
        )}
      </div>
      <div className={cn("transition-all duration-500 ease-in-out", open ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0")}>
        <div className="px-7 pb-7 pt-2">
          {children}
        </div>
      </div>

    </div>
  );
};

export default ReportSection;
