import React, { useState, useEffect } from "react";
import {
  Phone,
  Calendar,
  PhoneMissed,
  Megaphone,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";

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
  const [aiTip, setAiTip] = useState<string | null>(null);
  const [tipLoading, setTipLoading] = useState(true);

  const isFiltered = role !== "Admin";
  const todayStr = new Date().toISOString().split("T")[0];

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

  // Fetch AI tip
  useEffect(() => {
    const fetchTip = async () => {
      setTipLoading(true);
      try {
        // Check cache first
        const cacheKey = `agentflow_tip_${todayStr}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          setAiTip(cached);
          setTipLoading(false);
          return;
        }

        const { data, error } = await supabase.functions.invoke("daily-tip", {
          body: { firstName },
        });

        if (error) throw error;
        const tip = data?.tip || "Make every call count today! 💪";
        setAiTip(tip);
        localStorage.setItem(cacheKey, tip);
      } catch (e) {
        console.error("Failed to fetch AI tip:", e);
        setAiTip("Stay focused and make every conversation count today! 🎯");
      } finally {
        setTipLoading(false);
      }
    };
    fetchTip();
  }, [firstName, todayStr]);

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
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-card rounded-xl border border-border shadow-xl p-6 max-w-[560px] w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Greeting */}
        <h2 className="text-2xl font-bold text-foreground">
          {greeting}, {firstName} 👋
        </h2>
        <p className="text-muted-foreground mt-1">{dateFormatted}</p>

        {/* AI Tip of the Day */}
        <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">AI Tip of the Day</span>
          </div>
          {tipLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Generating your daily tip...
            </div>
          ) : (
            <div className="text-sm text-foreground leading-relaxed prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{aiTip || ""}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Data rows */}
        <div className="mt-5">
          {rows.map((row, idx) => (
            <div
              key={idx}
              className={`flex items-center justify-between py-3 ${
                idx < rows.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <row.icon
                  className="w-5 h-5"
                  style={{ color: row.iconColor }}
                />
                <span className="text-sm text-foreground">{row.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-foreground">
                  {row.count ?? "—"}
                </span>
                <button
                  onClick={() => handleView(row.target)}
                  className="text-sm text-primary hover:underline"
                >
                  View →
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            onClick={onDismiss}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
          >
            Let's Go →
          </button>
        </div>
      </div>
    </div>
  );
};

export default DailyBriefingModal;
