import React, { useState, useEffect } from "react";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface AnniversariesWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
}

interface AnniversaryItem {
  id: string;
  firstName: string;
  lastName: string;
  policyType: string;
  daysUntil: number;
}

const AnniversariesWidget: React.FC<AnniversariesWidgetProps> = ({
  userId,
  role,
  adminToggle,
}) => {
  const [items, setItems] = useState<AnniversaryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const isFiltered = role !== "Admin" || adminToggle === "my";

  useEffect(() => {
    const fetchAnniversaries = async () => {
      try {
        let q = supabase
          .from("clients")
          .select(
            "id, first_name, last_name, effective_date, policy_type, assigned_agent_id"
          )
          .not("effective_date", "is", null);

        if (isFiltered) q = q.eq("assigned_agent_id", userId);

        const { data: clients } = await q;
        if (!clients || clients.length === 0) {
          setLoading(false);
          return;
        }

        const now = new Date();
        const withAnniversary = clients
          .map((c) => {
            const eff = new Date(c.effective_date!);
            let anniversaryThisYear = new Date(
              now.getFullYear(),
              eff.getMonth(),
              eff.getDate()
            );
            if (anniversaryThisYear < now) {
              anniversaryThisYear = new Date(
                now.getFullYear() + 1,
                eff.getMonth(),
                eff.getDate()
              );
            }
            const daysUntil = Math.ceil(
              (anniversaryThisYear.getTime() - now.getTime()) /
                (1000 * 60 * 60 * 24)
            );
            return {
              id: c.id,
              firstName: c.first_name,
              lastName: c.last_name,
              policyType: c.policy_type,
              daysUntil,
            };
          })
          .filter((c) => c.daysUntil >= 0 && c.daysUntil <= 30)
          .sort((a, b) => a.daysUntil - b.daysUntil)
          .slice(0, 8);

        setItems(withAnniversary);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    fetchAnniversaries();
  }, [userId, isFiltered]);

  const handleContact = (item: AnniversaryItem) => {
    window.dispatchEvent(
      new CustomEvent("agentflow:open-dialer", {
        detail: {
          contactName: `${item.firstName} ${item.lastName}`,
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

  if (items.length === 0) {
    return (
      <div className="text-center py-6">
        <Gift className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          No upcoming policy anniversaries
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {items.map((item) => {
        const daysColor = item.daysUntil <= 7 ? "#F97316" : "#3B82F6";
        const daysLabel =
          item.daysUntil === 0
            ? "Today!"
            : item.daysUntil === 1
              ? "Tomorrow"
              : `in ${item.daysUntil} days`;

        return (
          <div
            key={item.id}
            className="flex items-center justify-between py-2 border-b border-border last:border-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {item.firstName} {item.lastName}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: "#8B5CF6", color: "white" }}
                >
                  {item.policyType}
                </span>
                <span
                  className="text-xs font-medium"
                  style={{ color: daysColor }}
                >
                  {daysLabel}
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleContact(item)}
            >
              Contact
            </Button>
          </div>
        );
      })}
    </div>
  );
};

export default AnniversariesWidget;
