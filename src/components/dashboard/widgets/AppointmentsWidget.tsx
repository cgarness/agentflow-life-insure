import React, { useState, useEffect } from "react";
import { Calendar, Clock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

interface AppointmentsWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
}

const TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  "Sales Call": { bg: "bg-blue-500/10", text: "text-blue-500" },
  "Follow Up": { bg: "bg-amber-500/10", text: "text-amber-500" },
  "Policy Review": { bg: "bg-violet-500/10", text: "text-violet-500" },
  "Recruit Interview": { bg: "bg-emerald-500/10", text: "text-emerald-500" },
  Other: { bg: "bg-muted", text: "text-muted-foreground" },
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  Scheduled: { bg: "bg-muted", text: "text-muted-foreground" },
  Confirmed: { bg: "bg-emerald-500/10", text: "text-emerald-500" },
  Completed: { bg: "bg-blue-500/10", text: "text-blue-500" },
  "No Show": { bg: "bg-red-500/10", text: "text-red-500" },
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
          <div key={i} className="h-12 bg-muted/20 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (appointments.length === 0) {
    return (
      <div className="text-center py-10 flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
          <Calendar className="w-8 h-8 text-muted-foreground opacity-50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium mb-4">
          Your schedule is clear for today
        </p>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => navigate("/calendar")}
          className="rounded-xl border-dashed hover:border-solid transition-all"
        >
          Schedule Appointment
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
    <div className="space-y-3">
      {appointments.map((appt, idx) => {
        const typeStyle = TYPE_STYLES[appt.type] || TYPE_STYLES.Other;
        const statusStyle = STATUS_STYLES[appt.status] || STATUS_STYLES.Scheduled;
        
        return (
          <motion.div
            key={appt.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="group relative flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-transparent hover:border-primary/20 hover:bg-muted/50 transition-all cursor-pointer"
            onClick={() => navigate("/calendar")}
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex flex-col items-center justify-center w-12 h-12 rounded-lg bg-background border border-border shadow-sm shrink-0">
                <Clock className="w-3.5 h-3.5 text-muted-foreground mb-1" />
                <span className="text-[10px] font-bold text-foreground uppercase tracking-tighter">
                  {formatTime(appt.start_time)}
                </span>
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors">
                  {appt.contact_name || appt.title}
                </h4>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${typeStyle.bg} ${typeStyle.text}`}>
                    {appt.type}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col items-end gap-2 shrink-0">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${statusStyle.bg} ${statusStyle.text}`}>
                {appt.status}
              </span>
            </div>
          </motion.div>
        );
      })}
      
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => navigate("/calendar")}
        className="w-full mt-2 text-primary hover:text-primary/80 hover:bg-primary/5 rounded-xl text-xs font-bold uppercase tracking-widest"
      >
        View Full Calendar
      </Button>
    </div>
  );
};

export default AppointmentsWidget;
