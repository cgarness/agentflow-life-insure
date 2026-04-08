import React, { useState, useEffect } from "react";
import { Phone, Clock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

interface CallbacksWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
}

interface CallbackItem {
  id: string;
  contactName: string;
  contactId: string | null;
  startTime: string;
  phone: string;
}

const CallbacksWidget: React.FC<CallbacksWidgetProps> = ({ userId, role, adminToggle }) => {
  const navigate = useNavigate();
  const [overdue, setOverdue] = useState<CallbackItem[]>([]);
  const [dueToday, setDueToday] = useState<CallbackItem[]>([]);
  const [dueSoon, setDueSoon] = useState<CallbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  const isFiltered = role !== "Admin" || adminToggle === "my";

  useEffect(() => {
    const fetchCallbacks = async () => {
      try {
        const threeDaysOut = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

        let q = supabase
          .from("appointments")
          .select("id, contact_name, contact_id, start_time, type")
          .in("type", ["Follow Up", "Call Back"])
          .eq("status", "Scheduled")
          .lte("start_time", threeDaysOut)
          .order("start_time", { ascending: true })
          .limit(15);

        if (isFiltered) q = q.eq("user_id", userId);

        const { data } = await q;
        if (!data || data.length === 0) {
          setLoading(false);
          return;
        }

        setTotalCount(data.length);

        // Fetch phones from leads
        const contactIds = data.map((d) => d.contact_id).filter(Boolean) as string[];
        let phoneMap: Record<string, string> = {};
        if (contactIds.length > 0) {
          const { data: leads } = await supabase
            .from("leads")
            .select("id, phone")
            .in("id", contactIds);
          if (leads) {
            for (const lead of leads) {
              phoneMap[lead.id] = lead.phone;
            }
          }
        }

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
        const tomorrowEnd = new Date(todayEnd.getTime() + 2 * 24 * 60 * 60 * 1000);

        const overdueItems: CallbackItem[] = [];
        const todayItems: CallbackItem[] = [];
        const soonItems: CallbackItem[] = [];

        for (const item of data) {
          const st = new Date(item.start_time);
          const cb: CallbackItem = {
            id: item.id,
            contactName: item.contact_name || "Unknown",
            contactId: item.contact_id,
            startTime: item.start_time,
            phone: item.contact_id ? phoneMap[item.contact_id] || "" : "",
          };

          if (st < now && st >= todayStart) {
            overdueItems.push(cb);
          } else if (st >= now && st < todayEnd) {
            todayItems.push(cb);
          } else if (st >= todayEnd && st < tomorrowEnd) {
            soonItems.push(cb);
          } else if (st < todayStart) {
            overdueItems.push(cb);
          } else {
            soonItems.push(cb);
          }
        }

        setOverdue(overdueItems);
        setDueToday(todayItems);
        setDueSoon(soonItems);
      } catch {
        // empty state on error
      } finally {
        setLoading(false);
      }
    };

    fetchCallbacks();
  }, [userId, isFiltered]);

  const handleCall = (item: CallbackItem) => {
    window.dispatchEvent(
      new CustomEvent("agentflow:open-dialer", {
        detail: {
          contactId: item.contactId,
          contactName: item.contactName,
          phone: item.phone,
        },
      })
    );
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-muted/20 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const allEmpty = overdue.length === 0 && dueToday.length === 0 && dueSoon.length === 0;

  if (allEmpty) {
    return (
      <div className="text-center py-10 flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
          <Phone className="w-8 h-8 text-muted-foreground opacity-50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">No pending callbacks</p>
      </div>
    );
  }

  const renderSection = (
    title: string,
    dotColor: string,
    items: CallbackItem[]
  ) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-4 last:mb-0">
        <div className="flex items-center gap-2 mb-3">
          <span
            className="w-2 h-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.1)]"
            style={{ backgroundColor: dotColor }}
          />
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
            {title} ({items.length})
          </span>
        </div>
        <div className="space-y-2">
          {items.slice(0, 5).map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-transparent hover:border-primary/20 hover:bg-muted/50 transition-all group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center shrink-0">
                  <User className="w-5 h-5 text-muted-foreground/50" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm text-foreground truncate group-hover:text-primary transition-colors">
                    {item.contactName}
                  </p>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    <p className="text-[10px] font-medium text-muted-foreground">
                      {formatTime(item.startTime)}
                    </p>
                  </div>
                </div>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handleCall(item)}
                className="rounded-lg shadow-sm hover:bg-primary hover:text-white hover:border-primary transition-all px-4"
              >
                Call
              </Button>
            </motion.div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      {renderSection("Overdue", "#EF4444", overdue)}
      {renderSection("Due Today", "#22C55E", dueToday)}
      {renderSection("Due Soon", "#3B82F6", dueSoon)}
      {totalCount > 5 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/contacts")}
          className="w-full mt-4 text-primary hover:text-primary/80 hover:bg-primary/5 rounded-xl text-xs font-bold uppercase tracking-widest"
        >
          View All {totalCount} Callbacks
        </Button>
      )}
    </div>
  );
};

export default CallbacksWidget;
