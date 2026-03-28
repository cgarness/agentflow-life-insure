import React, { useState, useEffect, useCallback } from "react";
import { Phone, ShieldCheck, Calendar, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";

interface StatCardsProps {
  role: string;
  userId: string;
  adminToggle: "team" | "my";
  onCardClick?: (type: string) => void;
  timeRange?: "day" | "week" | "month" | "year";
}

interface StatData {
  callsToday: number;
  callsYesterday: number;
  policiesThisMonth: number;
  policiesLastMonth: number;
  appointmentsToday: number;
  appointmentsYesterday: number;
  callsThisMonth: number;
  winsThisMonth: number;
  premiumThisMonth: number;
  premiumLastMonth: number;
  prevLabel: string;
}

const StatCards: React.FC<StatCardsProps> = ({ role, userId, adminToggle, onCardClick, timeRange }) => {
  const [data, setData] = useState<StatData | null>(null);
  const [loading, setLoading] = useState(true);

  const isFiltered = role !== "Admin" || adminToggle === "my";

  const fetchStats = useCallback(async () => {
    try {
      const now = new Date();
      const range = timeRange || "month";
      
      let startOfPeriod = new Date();
      let startOfPrevPeriod = new Date();
      let endOfPrevPeriod = new Date();
      
      let prevLabel = "yesterday";

      if (range === "day") {
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startOfPrevPeriod = new Date(startOfPeriod);
        startOfPrevPeriod.setDate(startOfPrevPeriod.getDate() - 1);
        endOfPrevPeriod = new Date(startOfPeriod);
        endOfPrevPeriod.setMilliseconds(-1);
        prevLabel = "yesterday";
      } else if (range === "week") {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
        startOfPeriod = new Date(now.setDate(diff));
        startOfPeriod.setHours(0, 0, 0, 0);
        
        startOfPrevPeriod = new Date(startOfPeriod);
        startOfPrevPeriod.setDate(startOfPrevPeriod.getDate() - 7);
        endOfPrevPeriod = new Date(startOfPeriod);
        endOfPrevPeriod.setMilliseconds(-1);
        prevLabel = "last week";
      } else if (range === "month") {
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfPrevPeriod = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endOfPrevPeriod = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        prevLabel = "last month";
      } else if (range === "year") {
        startOfPeriod = new Date(now.getFullYear(), 0, 1);
        startOfPrevPeriod = new Date(now.getFullYear() - 1, 0, 1);
        endOfPrevPeriod = new Date(now.getFullYear(), 0, 0, 23, 59, 59);
        prevLabel = "last year";
      }

      const startStr = startOfPeriod.toISOString();
      const startPrevStr = startOfPrevPeriod.toISOString();
      const endPrevStr = endOfPrevPeriod.toISOString();

      const buildCallQuery = (start: string, end?: string) => {
        let q = supabase
          .from("calls")
          .select("id", { count: "exact", head: true })
          .gte("created_at", start);
        if (end) q = q.lte("created_at", end);
        if (isFiltered) q = q.eq("agent_id", userId);
        return q;
      };

      const buildSalesQuery = (start: string, end?: string) => {
        let q = supabase
          .from("clients")
          .select("id, premium", { count: "exact" })
          .gte("created_at", start);
        if (end) q = q.lte("created_at", end);
        if (isFiltered) q = q.eq("assigned_agent_id", userId);
        return q;
      };

      const buildApptQuery = (start: string, end?: string) => {
        let q = supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .gte("start_time", start)
          .eq("status", "Scheduled");
        if (end) q = q.lte("start_time", end);
        if (isFiltered) q = q.eq("user_id", userId);
        return q;
      };

      const [
        callsNow,
        callsPrev,
        salesNow,
        salesPrev,
        apptsNow,
        apptsPrev,
      ] = await Promise.all([
        buildCallQuery(startStr),
        buildCallQuery(startPrevStr, endPrevStr),
        buildSalesQuery(startStr),
        buildSalesQuery(startPrevStr, endPrevStr),
        buildApptQuery(startStr),
        buildApptQuery(startPrevStr, endPrevStr),
      ]);

      const premiumNow = (salesNow.data as any[])?.reduce((sum, s) => sum + (Number(s.premium) || 0), 0) ?? 0;
      const premiumPrev = (salesPrev.data as any[])?.reduce((sum, s) => sum + (Number(s.premium) || 0), 0) ?? 0;

      setData({
        callsToday: callsNow.count ?? 0,
        callsYesterday: callsPrev.count ?? 0,
        policiesThisMonth: salesNow.count ?? 0,
        policiesLastMonth: salesPrev.count ?? 0,
        appointmentsToday: apptsNow.count ?? 0,
        appointmentsYesterday: apptsPrev.count ?? 0,
        callsThisMonth: callsNow.count ?? 0, // Placeholder or remove if unused
        winsThisMonth: salesNow.count ?? 0,
        premiumThisMonth: premiumNow * 12, // Annual Premium
        premiumLastMonth: premiumPrev * 12,
        prevLabel, // Add this to the state if needed, or handle locally
      } as any);
    } catch (err) {
      console.error("Error fetching stats:", err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userId, isFiltered, timeRange]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const conversionRate =
    data && data.callsThisMonth > 0
      ? ((data.winsThisMonth / data.callsThisMonth) * 100).toFixed(1)
      : "0.0";

  const cards = [
    {
      id: "calls_today",
      label: timeRange === "day" ? "Calls Made Today" : `Calls Made (${timeRange})`,
      value: data?.callsToday ?? null,
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
      value: data?.policiesThisMonth ?? null,
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
      value: data?.appointmentsToday ?? null,
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
      value: data ? `$${data.premiumThisMonth.toLocaleString()}` : null,
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
        <motion.div
          key={`${card.id}-${timeRange}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: index * 0.1 }}
          whileHover={{ y: -5, transition: { duration: 0.2 } }}
          onClick={() => onCardClick?.(card.id)}
          className={`relative overflow-hidden bg-card rounded-2xl border border-white/10 shadow-lg ${card.shadow} p-5 group transition-all duration-300 cursor-pointer`}
        >
          {/* Background Glow */}
          <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-10 blur-2xl ${card.gradient}`} />
          
          <div className="flex items-start justify-between relative z-10">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">
                {card.label}
              </p>
              {loading ? (
                <div className="h-9 w-20 bg-muted rounded-lg animate-pulse" />
              ) : (
                <p className="text-3xl font-bold tracking-tight text-foreground">
                  {card.value ?? "—"}
                </p>
              )}
              
              {!loading && (
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
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    vs {data?.prevLabel || "yesterday"}
                  </span>
                </div>
              )}
            </div>
            
            <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${card.gradient} shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}>
              <card.icon className="h-6 w-6 text-white" />
            </div>
          </div>
          
          {/* Subtle bottom line */}
          <div className={`absolute bottom-0 left-0 h-1 w-full opacity-30 ${card.gradient}`} />
        </motion.div>
      ))}
    </div>
  );
};

export default StatCards;
