import { Phone, ShieldCheck, Calendar, TrendingUp } from "lucide-react";
import { StatData } from "@/hooks/useDashboardStats";

interface StatCardsProps {
  role: string;
  userId: string;
  adminToggle: "team" | "my";
  onCardClick?: (type: string) => void;
  timeRange?: "day" | "week" | "month" | "year";
  stats?: StatData | null;
  loading?: boolean;
}

const StatCards: React.FC<StatCardsProps> = ({ 
  role, 
  userId, 
  adminToggle, 
  onCardClick, 
  timeRange,
  stats,
  loading = false
}) => {
  const data = stats;

  const formatValue = (val: number | string) => {
    if (typeof val === "string") return val;
    return val.toLocaleString();
  };

  const cards = [
    {
      id: "calls_today",
      label: timeRange === "day" ? "Calls Made Today" : `Calls Made (${timeRange})`,
      value: data?.callsToday ?? 0,
      trend:
        data != null
          ? data.callsToday > data.callsYesterday
            ? "up"
            : data.callsToday < data.callsYesterday
              ? "down"
              : "neutral"
          : null,
      icon: Phone,
      gradient: "premium-gradient-blue",
      shadow: "shadow-blue-500/20",
    },
    {
      id: "policies_sold",
      label: timeRange === "day" ? "Policies Sold Today" : `Policies Sold (${timeRange})`,
      value: data?.policiesThisMonth ?? 0,
      trend:
        data != null
          ? data.policiesThisMonth > data.policiesLastMonth
            ? "up"
            : data.policiesThisMonth < data.policiesLastMonth
              ? "down"
              : "neutral"
          : null,
      icon: ShieldCheck,
      gradient: "premium-gradient-emerald",
      shadow: "shadow-emerald-500/20",
    },
    {
      id: "appointments",
      label: timeRange === "day" ? "Appointments Today" : `Appointments (${timeRange})`,
      value: data?.appointmentsToday ?? 0,
      trend:
        data != null
          ? data.appointmentsToday >= data.appointmentsYesterday
            ? "up"
            : "down"
          : null,
      icon: Calendar,
      gradient: "premium-gradient-violet",
      shadow: "shadow-violet-500/20",
    },
    {
      id: "premium_sold",
      label: "Annual Premium Sold",
      value: data ? `$${data.premiumThisMonth.toLocaleString()}` : "$0",
      trend:
        data != null
          ? data.premiumThisMonth > data.premiumLastMonth
            ? "up"
            : data.premiumThisMonth < data.premiumLastMonth
              ? "down"
              : "neutral"
          : null,
      icon: TrendingUp,
      gradient: "premium-gradient-amber",
      shadow: "shadow-amber-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, index) => (
        <div
          key={card.id}
          onClick={() => onCardClick?.(card.id)}
          className={`relative overflow-hidden bg-card rounded-2xl border border-white/10 shadow-lg ${card.shadow} p-5 group transition-all duration-200 cursor-pointer hover:-translate-y-1 h-[140px]`}
        >
          {/* Background Glow */}
          <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-10 blur-2xl ${card.gradient}`} />
          
          <div className="flex items-start justify-between relative z-10 h-full">
            <div className="flex flex-col h-full w-full">
              <p className="text-sm font-medium text-muted-foreground mb-1">
                {card.label}
              </p>
              
              <div className="flex-1 flex flex-col justify-center min-h-[60px]">
                {loading ? (
                  <div className="space-y-3">
                    <div className="h-8 w-24 bg-muted/50 rounded-lg animate-pulse" />
                    <div className="h-4 w-32 bg-muted/30 rounded-md animate-pulse" />
                  </div>
                ) : (
                  <div>
                    <p className="text-3xl font-bold tracking-tight text-foreground">
                      {formatValue(card.value)}
                    </p>
                    
                    <div className="flex items-center gap-1.5 mt-2">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          card.trend === "up"
                            ? "bg-emerald-500/10 text-emerald-500"
                            : card.trend === "down"
                              ? "bg-red-500/10 text-red-500"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {card.trend === "up" ? "↑" : card.trend === "down" ? "↓" : "—"}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium whitespace-nowrap">
                        vs {data?.prevLabel || "yesterday"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${card.gradient} shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3 shrink-0 ml-2`}>
              <card.icon className="h-6 w-6 text-white" />
            </div>
          </div>
          
          {/* Subtle bottom line */}
          <div className={`absolute bottom-0 left-0 h-1 w-full opacity-30 ${card.gradient}`} />
        </div>
      ))}
    </div>
  );
};

export default StatCards;
