import React, { useState, useEffect, useCallback } from "react";
import { Phone, ShieldCheck, Calendar, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";

interface StatCardsProps {
  role: string;
  userId: string;
  adminToggle: "team" | "my";
  onCardClick?: (type: string) => void;
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
}

const StatCards: React.FC<StatCardsProps> = ({ role, userId, adminToggle, onCardClick }) => {
  const [data, setData] = useState<StatData | null>(null);
  const [loading, setLoading] = useState(true);

  const isFiltered = role !== "Admin" || adminToggle === "my";

  const fetchStats = useCallback(async () => {
    try {
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

      const buildCallQuery = (dateStr: string) => {
        let q = supabase
          .from("calls")
          .select("id", { count: "exact", head: true })
          .gte("created_at", `${dateStr}T00:00:00`)
          .lt("created_at", `${dateStr}T23:59:59.999`);
        if (isFiltered) q = q.eq("agent_id", userId);
        return q;
      };

      const buildWinsQuery = (start: string, end?: string) => {
        let q = supabase
          .from("wins")
          .select("id, premium_amount", { count: "exact" })
          .gte("created_at", start);
        if (end) q = q.lte("created_at", end);
        if (isFiltered) q = q.eq("agent_id", userId);
        return q;
      };

      const buildApptQuery = (dateStr: string) => {
        let q = supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .gte("start_time", `${dateStr}T00:00:00`)
          .lt("start_time", `${dateStr}T23:59:59.999`)
          .eq("status", "Scheduled");
        if (isFiltered) q = q.eq("user_id", userId);
        return q;
      };

      const buildCallsMonthQuery = (start: string, end?: string) => {
        let q = supabase
          .from("calls")
          .select("id", { count: "exact", head: true })
          .gte("created_at", start);
        if (end) q = q.lte("created_at", end);
        if (isFiltered) q = q.eq("agent_id", userId);
        return q;
      };

      const [
        callsTodayRes,
        callsYesterdayRes,
        winsThisMonthRes,
        winsLastMonthRes,
        apptsToday,
        apptsYesterday,
        callsThisMonthRes,
      ] = await Promise.all([
        buildCallQuery(todayStr),
        buildCallQuery(yesterdayStr),
        buildWinsQuery(startOfMonth),
        buildWinsQuery(startOfLastMonth, endOfLastMonth),
        buildApptQuery(todayStr),
        buildApptQuery(yesterdayStr),
        buildCallsMonthQuery(startOfMonth),
      ]);

      setData({
        callsToday: callsTodayRes.count ?? 0,
        callsYesterday: callsYesterdayRes.count ?? 0,
        policiesThisMonth: winsThisMonthRes.count ?? 0,
        policiesLastMonth: winsLastMonthRes.count ?? 0,
        appointmentsToday: apptsToday.count ?? 0,
        appointmentsYesterday: apptsYesterday.count ?? 0,
        callsThisMonth: callsThisMonthRes.count ?? 0,
        winsThisMonth: winsThisMonthRes.count ?? 0,
        premiumThisMonth: (winsThisMonthRes.data as any[])?.reduce((sum, w) => sum + (Number(w.premium_amount) || 0), 0) ?? 0,
        premiumLastMonth: (winsLastMonthRes.data as any[])?.reduce((sum, w) => sum + (Number(w.premium_amount) || 0), 0) ?? 0,
      });
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userId, isFiltered]);

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
      label: "Calls Made Today",
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
      label: "Policies Sold This Month",
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
      label: "Appointments Today",
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
      label: "Premium Sold",
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
          key={card.label}
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
                    vs yesterday
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
