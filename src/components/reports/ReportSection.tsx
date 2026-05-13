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
  hasData?: boolean;
}

const ReportSection: React.FC<Props> = ({ title, defaultOpen = true, onExport, children, badge, hasData }) => {
  const [open, setOpen] = React.useState(hasData === false ? false : defaultOpen);

  React.useEffect(() => {
    if (hasData === false) {
      setOpen(false);
    } else if (hasData === true) {
      setOpen(true);
    }
  }, [hasData]);

  return (
    <div className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200/70 dark:border-slate-800/80 overflow-hidden shadow-sm hover:shadow-xl hover:shadow-slate-200/40 dark:hover:shadow-none transition-all duration-300">
      <div
        className="w-full flex items-center justify-between px-6 py-4 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <div className={cn("p-1.5 rounded-lg transition-colors", open ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-400")}>
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-200 text-base tracking-tight">{title}</h3>
          {badge && <span className="text-[10px] uppercase font-black tracking-widest bg-primary/5 text-primary px-2.5 py-1 rounded-lg border border-primary/10">{badge}</span>}
          {hasData === false && <span className="text-[10px] uppercase font-black tracking-widest bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 ml-2">No data</span>}
        </div>
        {onExport && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-9 px-3 rounded-xl hover:bg-primary/5 hover:text-primary text-slate-400 font-bold text-xs" 
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
