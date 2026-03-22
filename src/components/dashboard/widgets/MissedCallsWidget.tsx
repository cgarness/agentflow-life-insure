import React, { useState, useEffect } from "react";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

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
          .limit(8);

        if (isFiltered) q = q.eq("agent_id", userId);

        const { data } = await q;
        if (!data || data.length === 0) {
          setLoading(false);
          return;
        }

        // Fetch phones from leads
        const contactIds = data
          .map((c) => c.contact_id)
          .filter(Boolean) as string[];
        let phoneMap: Record<string, string> = {};
        if (contactIds.length > 0) {
          const { data: leads } = await supabase
            .from("leads")
            .select("id, phone, first_name, last_name")
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
          <div key={i} className="h-10 bg-muted rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="text-center py-6">
        <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          No missed calls in the last 24 hours
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {calls.map((call) => (
        <div
          key={call.id}
          className="flex items-center justify-between py-2 border-b border-border last:border-0"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {call.contactName}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{timeAgo(call.createdAt)}</span>
              {call.phone && <span>{call.phone}</span>}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleCallBack(call)}
          >
            Call Back
          </Button>
        </div>
      ))}
    </div>
  );
};

export default MissedCallsWidget;
