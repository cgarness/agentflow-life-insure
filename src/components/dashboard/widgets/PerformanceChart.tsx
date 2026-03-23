import React, { useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";

interface PerformanceChartProps {
  userId: string;
}

const PerformanceChart: React.FC<PerformanceChartProps> = ({ userId }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const days = 7;
        const chartData = [];
        const now = new Date();

        for (let i = days - 1; i >= 0; i--) {
          const date = new Date(now);
          date.setDate(date.getDate() - i);
          const dateStr = date.toISOString().split("T")[0];
          const label = date.toLocaleDateString("en-US", { weekday: "short" });

          const start = `${dateStr}T00:00:00`;
          const end = `${dateStr}T23:59:59.999`;

          const { count: calls } = await supabase
            .from("calls")
            .select("id", { count: "exact", head: true })
            .eq("agent_id", userId)
            .gte("created_at", start)
            .lte("created_at", end);

          const { count: wins } = await supabase
            .from("wins")
            .select("id", { count: "exact", head: true })
            .eq("agent_id", userId)
            .gte("created_at", start)
            .lte("created_at", end);

          chartData.push({
            name: label,
            calls: calls || 0,
            wins: wins || 0,
          });
        }

        setData(chartData);
      } catch (error) {
        console.error("Error fetching chart data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userId]);

  if (loading) {
    return <div className="h-[200px] w-full flex items-center justify-center bg-muted/20 rounded animate-pulse">Loading Chart...</div>;
  }

  return (
    <div className="h-[240px] w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorWins" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: "#888888" }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: "#888888" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(255, 255, 255, 0.8)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: "12px",
              boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
            }}
          />
          <Area
            type="monotone"
            dataKey="calls"
            stroke="#3b82f6"
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#colorCalls)"
          />
          <Area
            type="monotone"
            dataKey="wins"
            stroke="#10b981"
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#colorWins)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PerformanceChart;
