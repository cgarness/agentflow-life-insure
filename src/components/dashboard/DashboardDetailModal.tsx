import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { useTwilio } from "@/contexts/TwilioContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { OUTBOUND_CALL_DIRECTIONS } from "@/lib/telnyxInboundCaller";

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

const BATCH_SIZE = 20;

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
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { makeCall, isReady } = useTwilio();
  const { profile, user } = useAuth();

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

  const fetchData = useCallback(async (pageNum: number, isInitial: boolean = false) => {
    if (!type || !userId || userId === "") return;
    
    if (isInitial) {
      setLoading(true);
      setData([]);
    } else {
      setIsFetchingNextPage(true);
    }

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
      const from = pageNum * BATCH_SIZE;
      const to = (pageNum + 1) * BATCH_SIZE - 1;

      let resultData: any[] = [];

      // Strategic Anniversary Logic: 90-day Policies / 14-day Birthdays
      if (type === "anniversaries") {
        if (pageNum > 0) {
          setHasMore(false);
          setIsFetchingNextPage(false);
          return;
        }

        // Fetch Both Birthdays and Renewals independently of dashboard perspective
        // Respect adminToggle for team viewing, while RLS remains the primary security layer
        let leadsQ = supabase
          .from("leads")
          .select("id, first_name, last_name, date_of_birth, phone")
          .not("date_of_birth", "is", null);
        
        let clientsQ = supabase
          .from("clients")
          .select("id, first_name, last_name, effective_date, policy_type, phone, assigned_agent_id")
          .not("effective_date", "is", null);

        if (isFiltered) {
          leadsQ = leadsQ.eq("assigned_agent_id", userId);
          clientsQ = clientsQ.eq("assigned_agent_id", userId);
        }

        const [birthdaysRes, policiesRes] = await Promise.all([leadsQ, clientsQ]);

        const birthdays: any[] = [];
        const renewals: any[] = [];
        const todayNow = new Date();
        todayNow.setHours(0, 0, 0, 0);
        
        (birthdaysRes.data || []).forEach(l => {
          const dob = new Date(l.date_of_birth);
          let nextBday = new Date(todayNow.getFullYear(), dob.getMonth(), dob.getDate());
          if (nextBday < todayNow) nextBday.setFullYear(todayNow.getFullYear() + 1);
          
          const diffTime = nextBday.getTime() - todayNow.getTime();
          const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          // Strategic Window: 14 Days for Birthdays
          if (days >= 0 && days <= 14) {
            birthdays.push({ 
              id: l.id, 
              contact_name: `${l.first_name} ${l.last_name}`, 
              phone: l.phone,
              type: 'Birthday', 
              date: l.date_of_birth, 
              daysUntil: days,
              isBirthday: true
            });
          }
        });

        (policiesRes.data || []).forEach(c => {
          const eff = new Date(c.effective_date);
          let nextAnniv = new Date(todayNow.getFullYear(), eff.getMonth(), eff.getDate());
          if (nextAnniv < todayNow) nextAnniv.setFullYear(todayNow.getFullYear() + 1);
          
          const diffTime = nextAnniv.getTime() - todayNow.getTime();
          const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          // Strategic Window: 90 Days for Policy Renewals
          if (days >= 0 && days <= 90) {
            renewals.push({ 
              id: c.id, 
              contact_name: `${c.first_name} ${c.last_name}`, 
              phone: c.phone,
              type: 'Policy Anniversary', 
              date: c.effective_date, 
              policy_type: c.policy_type, 
              daysUntil: days,
              isRenewal: true
            });
          }
        });

        // Grouping: Renewals first, then Birthdays, then sorted within groups
        const sortedRenewals = renewals.sort((a, b) => a.daysUntil - b.daysUntil);
        const sortedBirthdays = birthdays.sort((a, b) => a.daysUntil - b.daysUntil);
        
        // We add a 'sectionHeader' property to the first item of each group for rendering
        if (sortedRenewals.length > 0) sortedRenewals[0].sectionHeader = "Upcoming Renewals (90 Days)";
        if (sortedBirthdays.length > 0) sortedBirthdays[0].sectionHeader = "Upcoming Birthdays (14 Days)";

        resultData = [...sortedRenewals, ...sortedBirthdays];
        setHasMore(false);
      } else {
        let query: any;
        switch (type) {
          case "callbacks":
            query = supabase.from("appointments").select("id, contact_name, contact_id, start_time, status, type, title").in("type", ["Follow Up", "Call Back"]).eq("status", "Scheduled").order("start_time", { ascending: true });
            if (isFiltered) query = query.eq("user_id", userId);
            break;
          case "appointments":
            query = supabase.from("appointments").select("id, contact_name, contact_id, start_time, status, type, title").gte("start_time", startStr).lte("start_time", endStr).order("start_time", { ascending: true });
            if (isFiltered) query = query.eq("user_id", userId);
            break;
          case "calls_today":
            query = supabase
              .from("calls")
              .select("id, contact_name, contact_id, contact_phone, created_at, disposition_name, duration, status, direction")
              .in("direction", [...OUTBOUND_CALL_DIRECTIONS])
              .gte("created_at", startStr)
              .lte("created_at", endStr)
              .order("created_at", { ascending: false });
            if (isFiltered) query = query.eq("agent_id", userId);
            break;
          case "policies_sold":
            query = supabase.from("clients").select("id, first_name, last_name, created_at, policy_type, premium").gte("created_at", startStr).lte("created_at", endStr).order("created_at", { ascending: false });
            if (isFiltered) query = query.eq("assigned_agent_id", userId);
            break;
          case "missed_calls":
            const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            query = supabase.from("calls").select("id, contact_name, contact_id, contact_phone, created_at, disposition_name, contact_phone").eq("direction", "inbound").eq("is_missed", true).gte("created_at", since24h).order("created_at", { ascending: false });
            if (isFiltered) query = query.eq("agent_id", userId);
            break;
          case "premium_sold":
            query = supabase.from("clients").select("id, first_name, last_name, created_at, policy_type, premium").gte("created_at", startStr).lte("created_at", endStr).order("created_at", { ascending: false });
            if (isFiltered) query = query.eq("assigned_agent_id", userId);
            break;
        }

        if (query) {
          const { data: result, error } = await query.range(from, to);
          if (error) throw error;
          
          if (type === "premium_sold") {
            resultData = (result || []).map(s => ({ ...s, contact_name: `${s.first_name} ${s.last_name}`, premium_amount: s.premium }));
          } else {
            resultData = result || [];
          }
          
          if (resultData.length < BATCH_SIZE) setHasMore(false);
        }
      }

      if (isInitial) {
        setData(resultData);
      } else {
        setData(prev => [...prev, ...resultData]);
      }
    } catch (err) {
      console.error("Error upgrading detail modal feed:", err);
    } finally {
      if (isInitial) setLoading(false);
      setIsFetchingNextPage(false);
    }
  }, [type, userId, isFiltered, timeRange]);

  useEffect(() => {
    if (isOpen) {
      setPage(0);
      setHasMore(true);
      fetchData(0, true);
    }
  }, [isOpen, type, timeRange, adminToggle, fetchData]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight * 1.5 && hasMore && !isFetchingNextPage && !loading) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchData(nextPage);
    }
  };

  const handleRowClick = (item: any) => {
    // If it's the anniversaries type, we only navigate if they click the profile part
    // but the whole row was clickable before. We'll keep it clickable but ensure the call button 
    // doesn't trigger navigation.
    onClose();
    if (item.id) {
      const id = item.id;
      if (type === "anniversaries") {
        // Birthdays are usually Leads, Renewals are usually Clients
        const tab = item.isBirthday ? "Leads" : "Clients";
        navigate(`/contacts?contact=${id}&tab=${tab}`);
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

  const handleStartCall = (e: React.MouseEvent, item: any) => {
    e.stopPropagation(); // Prevent row click navigation
    
    if (!user) {
      toast.error("You must be logged in to make calls.");
      return;
    }

    if (!isReady) {
      toast.error("Dialer is not ready. Please wait or check your settings.");
      return;
    }

    if (!item.phone || item.phone.trim() === "") {
      toast.error("No valid phone number available for this contact.");
      return;
    }

    // Telephony Integration
    makeCall(item.phone, undefined, item.id);
    toast.success(`Dialing ${item.contact_name}...`);
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
        const phoneLabel = item.contact_name || item.contact_phone || "Caller";
        return (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{phoneLabel}</span>
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
            {/* Header */}
            <div className="relative p-8 border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
              <div className="absolute top-6 right-6">
                <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-muted text-muted-foreground hover:text-foreground h-10 w-10 transition-all">
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

            {/* Content Area with Scroll Handler */}
            <div 
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-gradient-to-b from-transparent to-muted/20"
            >
              <div className="mb-6 flex items-center justify-between">
                <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] opacity-50">Activity Feed</span>
                {data.length > 0 && (
                  <span className="text-[9px] font-black text-primary px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 tracking-wider">
                    {data.length} RECORDS LOADED {hasMore && "• SCROLL FOR MORE"}
                  </span>
                )}
              </div>
              
              {loading && page === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
                  <p className="text-sm font-medium text-muted-foreground animate-pulse uppercase tracking-[0.2em]">Synchronizing Intelligence...</p>
                </div>
              ) : data.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center px-10 text-muted-foreground">
                  <Loader2 className="w-10 h-10 mb-4 opacity-20" />
                  <p className="text-lg font-bold opacity-80">No intelligence found in this range</p>
                  <p className="text-sm mt-2">Activity will appear here as records are processed.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 py-2">
                  {data.map((item, idx) => (
                    <React.Fragment key={item.id || idx}>
                      {item.sectionHeader && (
                        <div className="mt-4 mb-2 first:mt-0">
                          <h4 className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-[0.2em] ml-2">
                            {item.sectionHeader}
                          </h4>
                        </div>
                      )}
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: Math.min(idx, 8) * 0.03 }}
                        whileHover={{ x: 3 }}
                        onClick={() => handleRowClick(item)}
                        className="group relative flex items-center justify-between p-4 rounded-2xl border border-border bg-card/50 transition-colors hover:bg-accent cursor-pointer overflow-hidden"
                      >
                        <div className={`absolute left-0 top-0 bottom-0 w-1.5 opacity-0 group-hover:opacity-100 transition-all duration-300 bg-gradient-to-b ${
                          type === 'calls_today' || type === 'callbacks' ? 'from-blue-400 to-indigo-500' :
                          type === 'policies_sold' ? 'from-emerald-400 to-teal-500' :
                          type === 'appointments' ? 'from-violet-400 to-purple-500' :
                          'from-primary to-primary/50'
                        }`} />

                        <div className="flex items-center gap-4 flex-1">
                          <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-muted border border-border group-hover:scale-110 transition-all duration-300">
                            {item.isBirthday ? (
                              <Gift className="w-5 h-5 text-pink-500" />
                            ) : item.isRenewal ? (
                              <ShieldCheck className="w-5 h-5 text-emerald-500" />
                            ) : (
                              getIcon()
                            )}
                          </div>
                          {renderItemDetails(item)}
                        </div>

                        <div className="flex items-center gap-4">
                          {type === "anniversaries" && (
                            <Button
                              size="sm"
                              onClick={(e) => handleStartCall(e, item)}
                              className="bg-primary hover:bg-primary/90 text-white rounded-xl h-9 px-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Phone className="w-3 h-3" />
                              <span className="text-[10px] font-bold uppercase tracking-wider">Start Call</span>
                            </Button>
                          )}
                          {item.status && type !== "calls_today" && type !== "missed_calls" && (
                            <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                              item.status === 'Scheduled' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                              item.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                              'bg-muted text-muted-foreground border border-border'
                            }`}>
                              {item.status}
                            </span>
                          )}
                          <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                        </div>
                      </motion.div>
                    </React.Fragment>
                  ))}
                  
                  {isFetchingNextPage && (
                    <div className="flex items-center justify-center py-6 gap-3">
                      <Loader2 className="w-5 h-5 text-primary animate-spin" />
                      <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest animate-pulse">Loading next batch...</span>
                    </div>
                  )}
                  
                  {!hasMore && data.length > BATCH_SIZE && (
                    <div className="text-center py-8 opacity-40">
                      <div className="w-8 h-1 bg-border mx-auto mb-3 rounded-full" />
                      <p className="text-[10px] font-black uppercase tracking-widest">End of intelligence feed</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-8 py-5 border-t border-border bg-muted/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-black opacity-60">
                  AgentFlow Analytics Engine • Batch Size: {BATCH_SIZE}
                </span>
              </div>
              <button onClick={onClose} className="text-[10px] font-black text-foreground/50 hover:text-foreground transition-all uppercase tracking-[0.2em] border border-border px-4 py-2 rounded-xl hover:bg-muted bg-card/50">
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
