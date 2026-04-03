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
          className={`relative overflow-hidden bg-white rounded-2xl shadow-xl ${
            adminToggle === "team" ? "shadow-emerald-500/10" : "shadow-blue-500/10"
          } transition-all duration-300 cursor-pointer hover:-translate-y-1 h-[140px] group border border-transparent hover:border-border/50`}
        >
          {/* Accent Glow */}
          <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-[0.05] blur-2xl group-hover:opacity-[0.1] transition-opacity duration-500 ${
            adminToggle === "team" ? "bg-emerald-500" : "bg-blue-500"
          }`} />
          
          <div className="flex items-start justify-between relative z-10 h-full p-5">
            <div className="flex flex-col h-full w-full">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 mb-2">
                {card.label}
              </p>
              
              <div className="flex-1 flex flex-col justify-center min-h-[60px]">
                {loading ? (
                  <div className="space-y-3">
                    <div className="h-8 w-24 bg-muted/20 rounded-lg animate-pulse" />
                    <div className="h-4 w-32 bg-muted/10 rounded-md animate-pulse" />
                  </div>
                ) : (
                  <div>
                    <p className={`text-3xl font-extrabold tracking-tight transition-all duration-300 ${
                      adminToggle === "team" ? "text-emerald-700" : "text-blue-700"
                    }`}>
                      {formatValue(card.value)}
                    </p>
                    
                    <div className="flex items-center gap-1.5 mt-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-lg whitespace-nowrap ${
                          card.trend === "up"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : card.trend === "down"
                              ? "bg-red-500/10 text-red-600"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {card.trend === "up" ? "↑" : card.trend === "down" ? "↓" : "—"}
                      </span>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-bold whitespace-nowrap">
                        vs {data?.prevLabel || "yesterday"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <div className={`flex items-center justify-center w-12 h-12 rounded-2xl transition-all duration-500 shrink-0 ml-2 ${
               adminToggle === "team" 
                ? "bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white" 
                : "bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white"
            } shadow-sm group-hover:shadow-lg ${
               adminToggle === "team" ? "group-hover:shadow-emerald-600/20" : "group-hover:shadow-blue-600/20"
            }`}>
              <card.icon className="h-5 w-5 transition-colors duration-500" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default StatCards;
