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
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between shadow-sm min-h-[110px]">
      <div>
        <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider">{label}</p>
        <p className={cn("text-2xl font-bold leading-tight mt-1", comingSoon ? "text-muted-foreground" : "text-foreground")}>
          {value}
        </p>
      </div>
      <div>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-1 truncate">{subtitle}</p>}
        {trend && trend.value !== 0 && (
          <div className={cn(
            "flex items-center gap-1 text-[11px] font-medium mt-1",
            ((trend.value > 0 && trend.isGoodUp !== false) || (trend.value < 0 && trend.isGoodUp === false)) 
              ? "text-emerald-500" 
              : "text-rose-500"
          )}>
            {trend.value > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{Math.abs(trend.value).toFixed(1)}% {trend.label}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatCard;
