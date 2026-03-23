import React, { useState, useEffect } from "react";
import { CheckCircle, PhoneForwarded, User, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";

interface MissedCallsWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
}

interface MissedCallItem {
  id: string;
  contactId: string | null;
  contactName: string;
  createdAt: string;
  phone: string;
}

const timeAgo = (dateStr: string) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const MissedCallsWidget: React.FC<MissedCallsWidgetProps> = ({
  userId,
  role,
  adminToggle,
}) => {
  const [calls, setCalls] = useState<MissedCallItem[]>([]);
  const [loading, setLoading] = useState(true);

  const isFiltered = role !== "Admin" || adminToggle === "my";

  useEffect(() => {
    const fetchMissedCalls = async () => {
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        let q = supabase
          .from("calls")
          .select("id, contact_id, contact_name, created_at, disposition_name")
          .in("disposition_name", ["No Answer", "Missed", "No Answer / Voicemail"])
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(5);

        if (isFiltered) q = q.eq("agent_id", userId);

        const { data } = await q;
        if (!data || data.length === 0) {
          setLoading(false);
          return;
        }

        const contactIds = data
          .map((c) => c.contact_id)
          .filter(Boolean) as string[];
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

        setCalls(
          data.map((c) => ({
            id: c.id,
            contactId: c.contact_id,
            contactName: c.contact_name || "Unknown",
            createdAt: c.created_at || "",
            phone: c.contact_id ? phoneMap[c.contact_id] || "" : "",
          }))
        );
      } catch {
        setCalls([]);
      } finally {
        setLoading(false);
      }
    };
    fetchMissedCalls();
  }, [userId, isFiltered]);

  const handleCallBack = (item: MissedCallItem) => {
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

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-muted/20 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="text-center py-10 flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
          <CheckCircle className="w-8 h-8 text-emerald-500 opacity-50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">All caught up!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {calls.map((call, idx) => (
        <motion.div
          key={call.id}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: idx * 0.05 }}
          className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-transparent hover:border-red-500/20 hover:bg-red-500/5 transition-all group"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center shrink-0">
              <PhoneForwarded className="w-5 h-5 text-red-500/50" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm text-foreground truncate group-hover:text-red-500 transition-colors">
                {call.contactName}
              </p>
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-muted-foreground" />
                <p className="text-[10px] font-medium text-muted-foreground">
                  {timeAgo(call.createdAt)}
                </p>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleCallBack(call)}
            className="rounded-lg shadow-sm hover:bg-red-500 hover:text-white hover:border-red-500 transition-all px-4 h-9"
          >
            Call Back
          </Button>
        </motion.div>
      ))}
    </div>
  );
};

export default MissedCallsWidget;
