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
  | "premium_sold";

interface DashboardDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: ModalType | null;
  userId: string;
  role: string;
  adminToggle: "team" | "my";
  timeRange?: "day" | "week" | "month" | "year";
}

const DashboardDetailModal: React.FC<DashboardDetailModalProps> = ({
  isOpen,
  onClose,
  type,
  userId,
  role,
  adminToggle,
  timeRange,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any[]>([]);
  const isFiltered = role !== "Admin" || adminToggle === "my";

  const getTitle = () => {
    const rangeSuffix = timeRange ? ` (${timeRange})` : "";
    switch (type) {
      case "callbacks":
        return "Callbacks Detail";
      case "appointments":
        return `Appointments Detail${rangeSuffix}`;
      case "calls_today":
        return `Calls Made${rangeSuffix}`;
      case "policies_sold":
        return `Policies Sold${rangeSuffix}`;
      case "missed_calls":
        return "Missed Calls (Recent)";
      case "anniversaries":
        return "Upcoming Anniversaries & Birthdays";
      case "premium_sold":
        return `Annual Premium Sold Analysis${rangeSuffix}`;
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
      case "premium_sold":
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
        const range = timeRange || "month";
        
        let startOfPeriod = new Date();
        let endOfPeriod = new Date();

        if (range === "day") {
          startOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          endOfPeriod = new Date(startOfPeriod);
          endOfPeriod.setHours(23, 59, 59, 999);
        } else if (range === "week") {
          const day = now.getDay();
          const diff = now.getDate() - day + (day === 0 ? -6 : 1);
          startOfPeriod = new Date(now.setDate(diff));
          startOfPeriod.setHours(0, 0, 0, 0);
          endOfPeriod = new Date(startOfPeriod);
          endOfPeriod.setDate(endOfPeriod.getDate() + 7);
          endOfPeriod.setMilliseconds(-1);
        } else if (range === "month") {
          startOfPeriod = new Date(now.getFullYear(), now.getMonth(), 1);
          endOfPeriod = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        } else if (range === "year") {
          startOfPeriod = new Date(now.getFullYear(), 0, 1);
          endOfPeriod = new Date(now.getFullYear(), 12, 0, 23, 59, 59);
        }

        const startStr = startOfPeriod.toISOString();
        const endStr = endOfPeriod.toISOString();

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
              .gte("start_time", startStr)
              .lte("start_time", endStr)
              .order("start_time", { ascending: true });
            if (isFiltered) query = query.eq("user_id", userId);
            break;

          case "calls_today":
            query = supabase
              .from("calls")
              .select("id, contact_name, contact_id, created_at, disposition_name, duration, status, direction")
              .gte("created_at", startStr)
              .lte("created_at", endStr)
              .order("created_at", { ascending: false });
            // Digital Privacy Partition: Strictly filter by authenticated agent's ID
            query = query.eq("agent_id", userId);
            break;

          case "policies_sold":
            // Use clients table instead of wins
            query = supabase
              .from("clients")
              .select("id, first_name, last_name, created_at, policy_type, premium")
              .gte("created_at", startStr)
              .lte("created_at", endStr)
              .order("created_at", { ascending: false });
            if (isFiltered) query = query.eq("assigned_agent_id", userId);
            break;

          case "missed_calls":
            const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            query = supabase
              .from("calls")
              .select("id, contact_name, contact_id, created_at, disposition_name, contact_phone")
              .eq("direction", "inbound")
              .eq("is_missed", true)
              .gte("created_at", since24h)
              .order("created_at", { ascending: false });
            if (isFiltered) query = query.eq("agent_id", userId);
            break;

          case "anniversaries":
            // Fetch both birthdays (from leads) and policy anniversaries (from clients)
            const [birthdaysRes, policiesRes] = await Promise.all([
              supabase
                .from("leads")
                .select("id, first_name, last_name, date_of_birth, email")
                .not("date_of_birth", "is", null)
                .limit(50),
              supabase
                .from("clients")
                .select("id, first_name, last_name, effective_date, policy_type, assigned_agent_id")
                .not("effective_date", "is", null)
                .eq(isFiltered ? "assigned_agent_id" : "", isFiltered ? userId : "")
                .limit(50)
            ]);

            const now = new Date();
            const combined: any[] = [];

            // Process Birthdays
            (birthdaysRes.data || []).forEach(l => {
              const dob = new Date(l.date_of_birth);
              let nextBday = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
              if (nextBday < now) nextBday.setFullYear(now.getFullYear() + 1);
              const days = Math.ceil((nextBday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              if (days <= 30) {
                combined.push({
                  id: l.id,
                  contact_name: `${l.first_name} ${l.last_name}`,
                  type: 'Birthday',
                  date: l.date_of_birth,
                  daysUntil: days
                });
              }
            });

            // Process Policy Anniversaries
            (policiesRes.data || []).forEach(c => {
              const eff = new Date(c.effective_date);
              let nextAnniv = new Date(now.getFullYear(), eff.getMonth(), eff.getDate());
              if (nextAnniv < now) nextAnniv.setFullYear(now.getFullYear() + 1);
              const days = Math.ceil((nextAnniv.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              if (days <= 30) {
                combined.push({
                  id: c.id,
                  contact_name: `${c.first_name} ${c.last_name}`,
                  type: 'Policy Anniversary',
                  date: c.effective_date,
                  policy_type: c.policy_type,
                  daysUntil: days
                });
              }
            });

            setData(combined.sort((a, b) => a.daysUntil - b.daysUntil));
            setLoading(false);
            return;

          case "premium_sold":
            const { data: salesResult, error: salesError } = await supabase
              .from("clients")
              .select("id, first_name, last_name, created_at, policy_type, premium")
              .gte("created_at", startStr)
              .lte("created_at", endStr)
              .order("created_at", { ascending: false });
            
            if (salesError) throw salesError;

            // Format data for combined view
            const formatted = (salesResult || []).map(s => ({
              ...s,
              contact_name: `${s.first_name} ${s.last_name}`,
              premium_amount: s.premium
            }));
            
            setData(formatted);
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
  }, [isOpen, type, userId, isFiltered, timeRange]);

  const handleRowClick = (item: any) => {
    onClose();
    if (item.contact_id || item.id) {
      const id = item.contact_id || item.id;
      if (type === "anniversaries") {
        navigate(`/contacts?contact=${id}&tab=Leads`);
      } else if (type === "callbacks" || type === "appointments") {
        navigate(`/calendar`);
      } else if (type === "calls_today" || type === "missed_calls") {
        navigate(`/contacts?contact=${id}&tab=Leads`);
      } else if (type === "policies_sold" || type === "premium_sold") {
        navigate(`/contacts?contact=${id}&tab=Clients`);
      } else {
        navigate(`/contacts?contact=${id}`);
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
        const direction = item.direction === 'inbound' ? 'Inbound' : 'Outbound';
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.contact_name || item.contact_phone || "Unknown Caller"}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Phone className="w-3 h-3" />
              <span className={`font-bold ${item.direction === 'inbound' ? 'text-blue-500' : 'text-indigo-500'}`}>{direction}</span>
              {` • `}{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {item.duration ? ` • ${Math.floor(item.duration / 60)}m ${item.duration % 60}s` : ""}
              {item.disposition_name && ` • ${item.disposition_name}`}
            </span>
          </div>
        );
      case "policies_sold":
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.contact_name || `${item.first_name} ${item.last_name}`}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              {item.policy_type || "Life Insurance"}
              {item.premium && ` • $${item.premium.toLocaleString()} (Mo)`}
            </span>
          </div>
        );
      case "anniversaries":
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.contact_name}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Gift className="w-3 h-3 text-pink-500" />
              {item.type}: {new Date(item.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
              {item.policy_type && ` (${item.policy_type})`}
              <span className="ml-2 font-bold text-pink-500">
                {item.daysUntil === 0 ? "Today!" : `in ${item.daysUntil} days`}
              </span>
            </span>
          </div>
        );
      case "premium_sold":
        const isWin = !!item.policy_type;
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{item.contact_name || "Activity"}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              {isWin ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : <Phone className="w-3 h-3" />}
              {isWin ? `Closed: ${item.policy_type} • $${((item.premium_amount || 0) * 12).toLocaleString()} (Annual)` : `Call: ${item.disposition_name || 'Completed'}`}
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
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: Math.min(idx, 8) * 0.03 }}
            whileHover={{ x: 3 }}
            onClick={() => handleRowClick(item)}
            className="group relative flex items-center justify-between p-4 rounded-2xl border border-border bg-card/50 transition-colors hover:bg-accent cursor-pointer overflow-hidden"
          >
            {/* Left Accent Bar */}
            <div className={`absolute left-0 top-0 bottom-0 w-1.5 opacity-0 group-hover:opacity-100 transition-all duration-300 bg-gradient-to-b ${
              type === 'calls_today' || type === 'callbacks' ? 'from-blue-400 to-indigo-500' :
              type === 'policies_sold' ? 'from-emerald-400 to-teal-500' :
              type === 'appointments' ? 'from-violet-400 to-purple-500' :
              'from-primary to-primary/50'
            }`} />

            <div className="flex items-center gap-4 flex-1">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center bg-muted border border-border group-hover:scale-110 transition-all duration-300`}>
                {getIcon()}
              </div>
              {renderItemDetails(item)}
            </div>

            <div className="flex items-center gap-4">
              {item.status && type !== "calls_today" && type !== "missed_calls" && (
                <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                  item.status === 'Scheduled' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                  item.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                  'bg-muted text-muted-foreground border border-border'
                }`}>
                  {item.status}
                </span>
              )}
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-transparent group-hover:bg-muted transition-all duration-300">
                <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
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
            className="absolute inset-0 bg-black/75"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ type: "tween", duration: 0.18, ease: "easeOut" }}
            className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col bg-card border border-border rounded-[2rem] shadow-[0_0_60px_-15px_rgba(0,0,0,0.4)] dark:shadow-[0_0_60px_-15px_rgba(0,0,0,0.7)]"
          >
            {/* Header with Visual Polish */}
            <div className="relative p-8 border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
              <div className="absolute top-6 right-6">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="rounded-full hover:bg-muted text-muted-foreground hover:text-foreground h-10 w-10 transition-all"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>

              <div className="flex items-center gap-6">
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br flex items-center justify-center shadow-2xl border border-white/10 ${
                  type === 'calls_today' || type === 'callbacks' ? 'from-blue-500 to-indigo-600' :
                  type === 'policies_sold' ? 'from-emerald-500 to-teal-600' :
                  type === 'appointments' ? 'from-violet-500 to-purple-600' :
                  'from-primary to-primary/80'
                }`}>
                  <div className="text-white scale-110 drop-shadow-lg">
                    {getIcon()}
                  </div>
                </div>
                <div>
                  <h3 className="text-2xl font-black text-foreground tracking-tight uppercase">{getTitle()}</h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                    <p className="text-xs font-bold text-muted-foreground tracking-[0.15em] uppercase opacity-80">Real-time Intelligence Feed</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-gradient-to-b from-transparent to-muted/20">
              <div className="mb-6 flex items-center justify-between">
                <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] opacity-50">Activity Feed</span>
                {data.length > 0 && (
                  <span className="text-[9px] font-black text-primary px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 tracking-wider">
                    {data.length} RECORDS DETECTED
                  </span>
                )}
              </div>
              {renderContent()}
            </div>

            {/* Footer */}
            <div className="px-8 py-5 border-t border-border bg-muted/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-black opacity-60">
                  AgentFlow Analytics Engine
                </span>
              </div>
              <button 
                onClick={onClose}
                className="text-[10px] font-black text-foreground/50 hover:text-foreground transition-all uppercase tracking-[0.2em] border border-border px-4 py-2 rounded-xl hover:bg-muted bg-card/50"
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
