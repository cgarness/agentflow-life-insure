import React from "react";
import { cn } from "@/lib/utils";
import { STAT_CATEGORIES, StatCategory } from "@/lib/stat-computations";

interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  category?: StatCategory;
  comingSoon?: boolean;
  noData?: boolean;
  smallValue?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({
  label, value, subtitle, category, comingSoon, noData, smallValue,
}) => {
  const accent = comingSoon
    ? "var(--color-border-tertiary, hsl(var(--border)))"
    : category ? STAT_CATEGORIES[category].color : "hsl(var(--border))";

  const muted = comingSoon || noData;

  return (
    <div
      className={cn(
        "group relative bg-card border border-border/50 flex flex-col justify-between transition-all",
        comingSoon && "opacity-50",
      )}
      style={{
        borderLeft: `3px solid ${accent}`,
        borderRadius: 0,
        padding: "10px 12px",
        minHeight: 80,
      }}
    >
      <div>
        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.4px] mb-1 truncate">
          {label}
        </p>
        <p
          className={cn(
            "font-medium tracking-tight leading-tight truncate",
            muted ? "text-muted-foreground" : "text-foreground",
          )}
          style={{ fontSize: smallValue ? 16 : 20 }}
          title={value}
        >
          {value}
        </p>
        {comingSoon && (
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">Coming soon</p>
        )}
      </div>

      {subtitle && !comingSoon && (
        <p className="text-[11px] text-muted-foreground truncate mt-1">{subtitle}</p>
      )}
    </div>
  );
};

export default StatCard;
