import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Trend {
  value: number;
  label: string;
  isGoodUp?: boolean;
}

interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  trend?: Trend;
  comingSoon?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, subtitle, trend, comingSoon }) => {
  return (
    <div className="group relative overflow-hidden bg-card border border-border/50 rounded-[1.5rem] p-5 flex flex-col justify-between shadow-sm hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1 min-h-[120px]">
      {/* Background accent */}
      <div className={cn(
        "absolute top-0 right-0 w-24 h-24 -mr-12 -mt-12 rounded-full blur-2xl transition-opacity opacity-0 group-hover:opacity-100",
        trend ? (
          ((trend.value > 0 && trend.isGoodUp !== false) || (trend.value < 0 && trend.isGoodUp === false))
            ? "bg-emerald-500/10"
            : "bg-rose-500/10"
        ) : "bg-primary/5"
      )} />
      
      <div className="relative z-10">
        <p className="text-[10px] text-muted-foreground font-black uppercase tracking-[0.1em] mb-2">{label}</p>
        <p className={cn("text-3xl font-black tracking-tighter leading-none", comingSoon ? "text-muted-foreground/40" : "text-foreground")}>
          {value}
        </p>
      </div>

      <div className="relative z-10 flex items-center justify-between mt-4">
        <div className="flex-1 min-w-0">
          {subtitle && <p className="text-[11px] text-muted-foreground font-semibold truncate pr-2">{subtitle}</p>}
        </div>
        {trend && trend.value !== 0 && (
          <div className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black",
            ((trend.value > 0 && trend.isGoodUp !== false) || (trend.value < 0 && trend.isGoodUp === false)) 
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" 
              : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
          )}>
            {trend.value > 0 ? <TrendingUp className="w-3 h-3 stroke-[3]" /> : <TrendingDown className="w-3 h-3 stroke-[3]" />}
            <span>{Math.abs(trend.value).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatCard;
