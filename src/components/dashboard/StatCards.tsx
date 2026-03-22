import React, { useState, useEffect, useCallback } from "react";
import { Phone, ShieldCheck, Calendar, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface StatCardsProps {
  role: string;
  userId: string;
  adminToggle: "team" | "my";
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
}

const StatCards: React.FC<StatCardsProps> = ({ role, userId, adminToggle }) => {
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
          .select("id", { count: "exact", head: true })
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
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
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
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
    {
      label: "Appointments Today",
      value: data?.appointmentsToday ?? null,
      trend:
        data != null
          ? data.appointmentsToday >= data.appointmentsYesterday
            ? "up"
            : "down"
          : null,
      icon: Calendar,
      color: "text-violet-500",
      bgColor: "bg-violet-500/10",
    },
    {
      label: "Conversion Rate",
      value: data ? `${conversionRate}%` : null,
      trend: data && data.callsThisMonth === 0 ? null : null,
      icon: TrendingUp,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-card rounded-xl border border-border shadow-sm p-5 transition-all duration-200 hover:shadow-md hover:-translate-y-1 hover:border-primary/20"
        >
          <div className="flex items-start justify-between">
            <div>
              {loading ? (
                <div className="h-8 w-20 bg-muted rounded animate-pulse" />
              ) : (
                <p className="text-3xl font-bold text-foreground">
                  {card.value ?? "—"}
                </p>
              )}
              <p className="text-sm text-muted-foreground mt-1">{card.label}</p>
              {!loading && card.trend && (
                <p
                  className={`text-xs mt-1 ${
                    card.trend === "up"
                      ? "text-green-600"
                      : card.trend === "down"
                        ? "text-red-500"
                        : "text-muted-foreground"
                  }`}
                >
                  {card.trend === "up" ? "↑" : card.trend === "down" ? "↓" : "—"}
                </p>
              )}
              {!loading && !card.trend && (
                <p className="text-xs mt-1 text-muted-foreground">—</p>
              )}
            </div>
            <div className={`p-2 rounded-lg ${card.bgColor}`}>
              <card.icon className={`h-5 w-5 ${card.color}`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default StatCards;
