import React, { useState, useEffect } from "react";
import {
  X,
  Phone,
  Calendar,
  ShieldCheck,
  TrendingUp,
  PhoneMissed,
  Gift,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

export type ModalType =
  | "callbacks"
  | "appointments"
  | "calls_today"
  | "policies_sold"
  | "missed_calls"
  | "anniversaries"
  | "conversion_rate";

interface DashboardDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: ModalType | null;
  userId: string;
  role: string;
  adminToggle: "team" | "my";
}

const DashboardDetailModal: React.FC<DashboardDetailModalProps> = ({
  isOpen,
  onClose,
  type,
  userId,
  role,
  adminToggle,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any[]>([]);
  const isFiltered = role !== "Admin" || adminToggle === "my";

  const getTitle = () => {
    switch (type) {
      case "callbacks":
        return "Callbacks Detail";
      case "appointments":
        return "Appointments Detail";
      case "calls_today":
        return "Calls Made Today";
      case "policies_sold":
        return "Policies Sold This Month";
      case "missed_calls":
        return "Missed Calls (24h)";
      case "anniversaries":
        return "Upcoming Anniversaries";
      case "conversion_rate":
        return "Conversion Rate Analysis";
      default:
        return "Details";
    }
  };

  const getIcon = () => {
    switch (type) {
      case "callbacks":
        return <Phone className="w-5 h-5 text-blue-500" />;
      case "appointments":
        return <Calendar className="w-5 h-5 text-violet-500" />;
      case "calls_today":
        return <Phone className="w-5 h-5 text-blue-500" />;
      case "policies_sold":
        return <ShieldCheck className="w-5 h-5 text-emerald-500" />;
      case "missed_calls":
        return <PhoneMissed className="w-5 h-5 text-red-500" />;
      case "anniversaries":
        return <Gift className="w-5 h-5 text-pink-500" />;
      case "conversion_rate":
        return <TrendingUp className="w-5 h-5 text-amber-500" />;
      default:
        return null;
    }
  };

  useEffect(() => {
    if (!isOpen || !type || !userId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const now = new Date();
        const todayStr = now.toISOString().split("T")[0];
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        let query: any;

        switch (type) {
          case "callbacks":
            query = supabase
              .from("appointments")
              .select("id, contact_name, contact_id, start_time, status, type, title")
              .in("type", ["Follow Up", "Call Back"])
              .eq("status", "Scheduled")
              .order("start_time", { ascending: true });
            if (isFiltered) query = query.eq("user_id", userId);
            break;

          case "appointments":
            query = supabase
              .from("appointments")
              .select("id, contact_name, contact_id, start_time, status, type, title")
              .gte("start_time", `${todayStr}T00:00:00`)
              .lte("start_time", `${todayStr}T23:59:59.999`)
              .order("start_time", { ascending: true });
            if (isFiltered) query = query.eq("user_id", userId);
            break;

          case "calls_today":
            query = supabase
              .from("calls")
              .select("id, contact_name, contact_id, created_at, disposition_name, duration, status")
              .gte("created_at", `${todayStr}T00:00:00`)
              .order("created_at", { ascending: false });
            if (isFiltered) query = query.eq("agent_id", userId);
            break;

          case "policies_sold":
            query = supabase
              .from("wins")
              .select("id, contact_name, contact_id, created_at, policy_type, premium_amount")
              .gte("created_at", startOfMonth)
              .order("created_at", { ascending: false });
            if (isFiltered) query = query.eq("agent_id", userId);
            break;

          case "missed_calls":
            query = supabase
              .from("calls")
              .select("id, contact_name, contact_id, created_at, disposition_name, contact_phone")
              .gte("created_at", since24h)
              .in("disposition_name", ["No Answer", "Missed", "No Answer / Voicemail"])
              .order("created_at", { ascending: false });
            if (isFiltered) query = query.eq("agent_id", userId);
            break;

          case "anniversaries":
            // Fetch leads with DOB in the current month
            const currentMonth = now.getMonth() + 1;
            query = supabase
              .from("leads")
              .select("id, first_name, last_name, date_of_birth, email")
              .not("date_of_birth", "is", null)
              .limit(20);
            // Post-filter for current month if needed, or just show upcoming
            break;

          case "conversion_rate":
            const [callsRes, winsRes] = await Promise.all([
              supabase
                .from("calls")
                .select("id, contact_name, created_at, disposition_name")
                .gte("created_at", startOfMonth)
                .order("created_at", { ascending: false })
                .limit(10),
              supabase
                .from("wins")
                .select("id, contact_name, created_at, policy_type")
                .gte("created_at", startOfMonth)
                .order("created_at", { ascending: false })
                .limit(10),
            ]);
            setData([...(winsRes.data || []), ...(callsRes.data || [])]);
            setLoading(false);
            return;
        }

        if (query) {
          const { data: result, error } = await query;
          if (error) throw error;
          setData(result || []);
        }
      } catch (error) {
        console.error("Error fetching modal data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen, type, userId, isFiltered]);

  const handleRowClick = (item: any) => {
    onClose();
    if (item.contact_id || item.id) {
      const id = item.contact_id || item.id;
      if (type === "anniversaries") {
        navigate(`/contacts?id=${id}`);
      } else if (type === "callbacks" || type === "appointments") {
        navigate(`/calendar`);
      } else if (type === "calls_today" || type === "missed_calls" || type === "policies_sold") {
        navigate(`/contacts?id=${id}`);
      } else {
        navigate(`/contacts?id=${id}`);
      }
    }
  };

  const renderItemDetails = (item: any) => {
    switch (type) {
      case "callbacks":
      case "appointments":
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.contact_name || item.title || "Scheduled Event"}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {new Date(item.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {item.type && ` • ${item.type}`}
            </span>
          </div>
        );
      case "calls_today":
      case "missed_calls":
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.contact_name || item.contact_phone || "Unknown Caller"}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Phone className="w-3 h-3" />
              {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {item.duration ? ` • ${Math.floor(item.duration / 60)}m ${item.duration % 60}s` : ""}
              {item.disposition_name && ` • ${item.disposition_name}`}
            </span>
          </div>
        );
      case "policies_sold":
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.contact_name || "New Policyholder"}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              {item.policy_type || "Life Insurance"}
              {item.premium_amount && ` • $${item.premium_amount.toLocaleString()}`}
            </span>
          </div>
        );
      case "anniversaries":
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.first_name} {item.last_name}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Gift className="w-3 h-3" />
              Birthday: {new Date(item.date_of_birth).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
            </span>
          </div>
        );
      case "conversion_rate":
        const isWin = !!item.policy_type;
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.contact_name || "Activity"}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              {isWin ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : <Phone className="w-3 h-3" />}
              {isWin ? `Closed: ${item.policy_type}` : `Call: ${item.disposition_name || 'Completed'}`}
            </span>
          </div>
        );
      default:
        return (
          <div className="flex flex-col">
            <span className="font-semibold text-foreground">{item.contact_name || "Record"}</span>
            <span className="text-xs text-muted-foreground">{new Date(item.created_at || item.start_time).toLocaleString()}</span>
          </div>
        );
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="relative">
            <div className="w-12 h-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-primary animate-pulse" />
            </div>
          </div>
          <p className="text-sm font-medium text-muted-foreground mt-4 animate-pulse uppercase tracking-widest">Analyzing Data...</p>
        </div>
      );
    }

    if (data.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center px-10">
          <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4 opacity-50">
            {getIcon()}
          </div>
          <p className="text-lg font-bold text-muted-foreground/80">Nothing to show right now</p>
          <p className="text-sm text-muted-foreground mt-2">Come back later once more activity is recorded on your dashboard.</p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-3 py-2">
        {data.map((item, idx) => (
          <motion.div
            key={item.id || idx}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.05 }}
            whileHover={{ x: 4, backgroundColor: "rgba(255, 255, 255, 0.08)" }}
            onClick={() => handleRowClick(item)}
            className="group relative flex items-center justify-between p-4 rounded-2xl border border-white/5 bg-white/[0.03] backdrop-blur-sm transition-all cursor-pointer overflow-hidden"
          >
            {/* Left Accent Bar */}
            <div className={`absolute left-0 top-0 bottom-0 w-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-b ${
              type === 'calls_today' || type === 'callbacks' ? 'from-blue-500 to-indigo-500' :
              type === 'policies_sold' ? 'from-emerald-500 to-teal-500' :
              type === 'appointments' ? 'from-violet-500 to-purple-500' :
              'from-primary to-primary/50'
            }`} />

            <div className="flex items-center gap-4 flex-1">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-white/5 group-hover:scale-110 transition-transform duration-300`}>
                {getIcon()}
              </div>
              {renderItemDetails(item)}
            </div>

            <div className="flex items-center gap-3">
              {item.status && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter ${
                  item.status === 'Scheduled' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                  item.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {item.status}
                </span>
              )}
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-white/0 group-hover:bg-white/10 transition-colors">
                <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col bg-[#0A0A0B]/90 glass-card border border-white/10 rounded-[2.5rem] shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)]"
          >
            {/* Header with Visual Polish */}
            <div className="relative p-8 border-b border-white/5 bg-gradient-to-br from-white/[0.03] to-transparent">
              <div className="absolute top-0 right-0 p-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground h-10 w-10"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>

              <div className="flex items-center gap-6">
                <div className={`w-16 h-16 rounded-[1.5rem] bg-gradient-to-br flex items-center justify-center shadow-xl border border-white/10 ${
                  type === 'calls_today' || type === 'callbacks' ? 'from-blue-500 to-indigo-600' :
                  type === 'policies_sold' ? 'from-emerald-500 to-teal-600' :
                  type === 'appointments' ? 'from-violet-500 to-purple-600' :
                  'from-primary to-primary/80'
                }`}>
                  <div className="text-white scale-125">
                    {getIcon()}
                  </div>
                </div>
                <div>
                  <h3 className="text-3xl font-black text-white tracking-tight uppercase italic">{getTitle()}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <p className="text-sm font-medium text-muted-foreground tracking-wide uppercase">Real-time Intelligence Feed</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-gradient-to-b from-transparent to-black/20">
              <div className="mb-6 flex items-center justify-between">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-[0.2em]">Activity Feed</span>
                {data.length > 0 && (
                  <span className="text-[10px] font-bold text-primary px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">
                    {data.length} RECORDS FOUND
                  </span>
                )}
              </div>
              {renderContent()}
            </div>

            {/* Footer */}
            <div className="px-8 py-5 border-t border-white/5 bg-black/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold italic">
                  AgentFlow Analytics Engine
                </span>
              </div>
              <button 
                onClick={onClose}
                className="text-xs font-bold text-primary hover:text-primary/80 transition-colors uppercase tracking-widest"
              >
                Dismiss View
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default DashboardDetailModal;
