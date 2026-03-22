import React, { useState, useEffect } from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

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
          <div key={i} className="h-10 bg-muted rounded animate-pulse" />
        ))}
      </div>
    );
  }

  const allEmpty = overdue.length === 0 && dueToday.length === 0 && dueSoon.length === 0;

  if (allEmpty) {
    return (
      <div className="text-center py-6">
        <Phone className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No callbacks due</p>
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
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: dotColor }}
          />
          <span className="text-xs font-medium text-muted-foreground uppercase">
            {title} ({items.length})
          </span>
        </div>
        {items.slice(0, 10).map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between py-2 border-b border-border last:border-0"
          >
            <div>
              <p className="font-medium text-sm text-foreground">{item.contactName}</p>
              <p className="text-xs text-muted-foreground">{formatTime(item.startTime)}</p>
              {item.phone && (
                <p className="text-xs text-muted-foreground">{item.phone}</p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => handleCall(item)}>
              Call
            </Button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      {renderSection("Overdue", "#EF4444", overdue)}
      {renderSection("Due Today", "#22C55E", dueToday)}
      {renderSection("Due Soon", "#3B82F6", dueSoon)}
      {totalCount > 10 && (
        <button
          onClick={() => navigate("/contacts")}
          className="text-sm text-primary hover:underline mt-2"
        >
          View all {totalCount} →
        </button>
      )}
    </div>
  );
};

export default CallbacksWidget;
