import React, { useState, useEffect } from "react";
import { Gift, Calendar, User, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";

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
          .slice(0, 5);

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
          <div key={i} className="h-12 bg-muted/20 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-10 flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-pink-500/10 flex items-center justify-center mb-4">
          <Gift className="w-8 h-8 text-pink-500 opacity-50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">No policy anniversaries soon</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, idx) => {
        const isUrgent = item.daysUntil <= 7;
        const daysLabel =
          item.daysUntil === 0
            ? "Today!"
            : item.daysUntil === 1
              ? "Tomorrow"
              : `in ${item.daysUntil} days`;

        return (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="group relative flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-transparent hover:border-pink-500/20 hover:bg-pink-500/5 transition-all"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-pink-500/50" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm text-foreground truncate group-hover:text-pink-500 transition-colors">
                  {item.firstName} {item.lastName}
                </p>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${isUrgent ? "text-orange-500" : "text-muted-foreground"}`}>
                    Anniversary {daysLabel}
                  </span>
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleContact(item)}
              className="rounded-lg shadow-sm hover:bg-pink-500 hover:text-white hover:border-pink-500 transition-all px-4 h-9"
            >
              Wish
            </Button>
          </motion.div>
        );
      })}
    </div>
  );
};

export default AnniversariesWidget;
