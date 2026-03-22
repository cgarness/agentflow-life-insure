import React, { useState, useEffect } from "react";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

interface AppointmentsWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
}

const TYPE_COLORS: Record<string, string> = {
  "Sales Call": "#3B82F6",
  "Follow Up": "#EAB308",
  "Policy Review": "#8B5CF6",
  "Recruit Interview": "#14B8A6",
  Other: "#6B7280",
};

const STATUS_COLORS: Record<string, string> = {
  Scheduled: "#6B7280",
  Confirmed: "#22C55E",
  Completed: "#3B82F6",
  "No Show": "#EF4444",
};

interface Appointment {
  id: string;
  title: string;
  contact_name: string | null;
  start_time: string;
  type: string;
  status: string;
}

const AppointmentsWidget: React.FC<AppointmentsWidgetProps> = ({
  userId,
  role,
  adminToggle,
}) => {
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  const isFiltered = role !== "Admin" || adminToggle === "my";

  useEffect(() => {
    const fetch = async () => {
      try {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const endOfDay = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          23,
          59,
          59,
          999
        ).toISOString();

        let q = supabase
          .from("appointments")
          .select("id, title, contact_name, start_time, type, status")
          .gte("start_time", startOfDay)
          .lte("start_time", endOfDay)
          .order("start_time", { ascending: true })
          .limit(8);

        if (isFiltered) q = q.eq("user_id", userId);

        const { data } = await q;
        setAppointments(data ?? []);
      } catch {
        setAppointments([]);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [userId, isFiltered]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-muted rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (appointments.length === 0) {
    return (
      <div className="text-center py-6">
        <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground mb-3">No appointments today</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/calendar")}>
          Schedule One →
        </Button>
      </div>
    );
  }

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-2">
      {appointments.map((appt) => {
        const typeColor = TYPE_COLORS[appt.type] || TYPE_COLORS.Other;
        const statusColor = STATUS_COLORS[appt.status] || STATUS_COLORS.Scheduled;
        return (
          <div
            key={appt.id}
            className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-mono text-foreground w-16 shrink-0">
                {formatTime(appt.start_time)}
              </span>
              <span className="text-sm text-foreground truncate">
                {appt.contact_name || appt.title}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: typeColor, color: "white" }}
              >
                {appt.type}
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: statusColor, color: "white" }}
              >
                {appt.status}
              </span>
            </div>
          </div>
        );
      })}
      <button
        onClick={() => navigate("/calendar")}
        className="text-sm text-primary hover:underline mt-2 block"
      >
        View Calendar →
      </button>
    </div>
  );
};

export default AppointmentsWidget;
