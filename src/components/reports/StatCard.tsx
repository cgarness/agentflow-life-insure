import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAT_CATEGORIES, StatCategory } from "@/lib/stat-computations";

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
  category?: StatCategory;
  comingSoon?: boolean;
  noData?: boolean;
  smallValue?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({
  label, value, subtitle, trend, category, comingSoon, noData, smallValue,
}) => {
  const accent = comingSoon
    ? "var(--color-border-tertiary, hsl(var(--border)))"
    : category ? STAT_CATEGORIES[category].color : "hsl(var(--border))";

  const muted = comingSoon || noData;
  const trendGood = trend
    ? (trend.value > 0 && trend.isGoodUp !== false) || (trend.value < 0 && trend.isGoodUp === false)
    : false;

  return (
    <div
      className={cn(
        "group relative bg-card border border-border/50 flex flex-col justify-between transition-all",
        comingSoon && "opacity-50",
      )}
      style={{
        borderLeft: `3px solid ${accent}`,
        borderRadius: 0,
        padding: "12px 14px",
        minHeight: 88,
      }}
    >
      <div>
        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.08em] mb-1 truncate">{label}</p>
        <p
          className={cn(
            "font-medium tracking-tight leading-tight truncate",
            muted ? "text-muted-foreground" : "text-foreground",
          )}
          style={{ fontSize: smallValue ? 16 : 22 }}
          title={value}
        >
          {value}
        </p>
        {comingSoon && (
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">Coming soon</p>
        )}
      </div>

      <div className="flex items-center justify-between mt-2 gap-2">
        <div className="flex-1 min-w-0">
          {subtitle && !comingSoon && (
            <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
        {trend && trend.value !== 0 && (
          <div
            className={cn(
              "flex items-center gap-0.5 text-[10px] font-semibold",
              trendGood ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
            )}
          >
            {trend.value > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{Math.abs(trend.value).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatCard;
