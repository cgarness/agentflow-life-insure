import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone,
  Calendar,
  PhoneMissed,
  Megaphone,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

interface DailyBriefingModalProps {
  userId: string;
  firstName: string;
  role: string;
  onClose: () => void;
  onDismiss: () => void;
  onScrollTo: (widgetId: string) => void;
}

const DailyBriefingModal: React.FC<DailyBriefingModalProps> = ({
  userId,
  firstName,
  role,
  onClose,
  onDismiss,
  onScrollTo,
}) => {
  const navigate = useNavigate();
  const [callbackCount, setCallbackCount] = useState<number | null>(null);
  const [appointmentCount, setAppointmentCount] = useState<number | null>(null);
  const [missedCallCount, setMissedCallCount] = useState<number | null>(null);
  const [campaignCount, setCampaignCount] = useState<number | null>(null);

  const isFiltered = role !== "Admin";
  const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local

  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? "Good morning"
      : hour < 17
        ? "Good afternoon"
        : "Good evening";

  const dateFormatted = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const startOfDay = `${todayStr}T00:00:00`;
        const endOfDay = `${todayStr}T23:59:59.999`;
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        let callbackQ = supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .gte("start_time", startOfDay)
          .lte("start_time", endOfDay)
          .in("type", ["Follow Up", "Call Back"])
          .eq("status", "Scheduled");
        if (isFiltered) callbackQ = callbackQ.eq("user_id", userId);

        let apptQ = supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .gte("start_time", startOfDay)
          .lte("start_time", endOfDay);
        if (isFiltered) apptQ = apptQ.eq("user_id", userId);

        let missedQ = supabase
          .from("calls")
          .select("id", { count: "exact", head: true })
          .gte("created_at", since24h)
          .in("disposition_name", [
            "No Answer",
            "Missed",
            "No Answer / Voicemail",
          ]);
        if (isFiltered) missedQ = missedQ.eq("agent_id", userId);

        const campaignQ = supabase
          .from("campaigns")
          .select("id", { count: "exact", head: true })
          .eq("status", "Active");

        const [cbRes, apptRes, missedRes, campRes] = await Promise.all([
          callbackQ,
          apptQ,
          missedQ,
          campaignQ,
        ]);

        setCallbackCount(cbRes.count ?? 0);
        setAppointmentCount(apptRes.count ?? 0);
        setMissedCallCount(missedRes.count ?? 0);
        setCampaignCount(campRes.count ?? 0);
      } catch {
        setCallbackCount(0);
        setAppointmentCount(0);
        setMissedCallCount(0);
        setCampaignCount(0);
      }
    };
    fetchData();
  }, [userId, isFiltered, todayStr]);

  const handleView = (target: string) => {
    if (target === "campaigns") {
      onDismiss();
      navigate("/campaigns");
    } else {
      onDismiss();
      onScrollTo(target);
    }
  };

  const rows = [
    {
      icon: Phone,
      iconColor: "#3B82F6",
      label: "Callbacks Due Today",
      count: callbackCount,
      target: "callbacks",
    },
    {
      icon: Calendar,
      iconColor: "#22C55E",
      label: "Today's Appointments",
      count: appointmentCount,
      target: "appointments",
    },
    {
      icon: PhoneMissed,
      iconColor: "#EF4444",
      label: "Missed Calls (24h)",
      count: missedCallCount,
      target: "missed_calls",
    },
    {
      icon: Megaphone,
      iconColor: "#A855F7",
      label: "Active Campaigns",
      count: campaignCount,
      target: "campaigns",
    },
  ];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="bg-card rounded-2xl border border-border shadow-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto"
        >
          {/* Greeting */}
          <div className="mb-4">
            <h2 className="text-xl font-bold text-foreground">
              {greeting}, {firstName} 👋
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">{dateFormatted}</p>
          </div>

          {/* Data rows */}
          <div className="space-y-1">
            {rows.map((row, idx) => (
              <div
                key={idx}
                className={`flex items-center justify-between py-2.5 ${
                  idx < rows.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-muted/50">
                    <row.icon
                      className="w-4 h-4"
                      style={{ color: row.iconColor }}
                    />
                  </div>
                  <span className="text-sm font-medium text-foreground">{row.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold text-foreground">
                    {row.count ?? "—"}
                  </span>
                  <button
                    onClick={() => handleView(row.target)}
                    className="px-2 py-1 rounded-md text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                  >
                    View →
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-6">
            <button
              onClick={onDismiss}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30"
            >
              Let's Go →
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default DailyBriefingModal;
