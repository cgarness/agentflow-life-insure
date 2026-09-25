import React, { useState, useEffect, useRef } from "react";
import { Gift, Calendar, User, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { dispatchQuickCall } from "@/lib/quick-call";

interface AnniversariesWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
  /** Incremented by the Dashboard's Refresh control. */
  refreshSignal?: number;
}

interface AnniversaryItem {
  id: string;
  firstName: string;
  lastName: string;
  policyType: string;
  daysUntil: number;
  phone: string;
}

const AnniversariesWidget: React.FC<AnniversariesWidgetProps> = ({
  userId,
  role,
  adminToggle,
  refreshSignal,
}) => {
  const [items, setItems] = useState<AnniversaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  /** The user/perspective whose anniversaries are on screen. */
  const loadedScopeRef = useRef<string | null>(null);

  const isFiltered = role !== "Admin" || adminToggle === "my";

  useEffect(() => {
    let cancelled = false;
    const scope = `${userId}|${isFiltered}`;
    const fetchAnniversaries = async () => {
      try {
        let q = supabase
          .from("clients")
          .select(
            "id, first_name, last_name, phone, effective_date, policy_type, assigned_agent_id"
          )
          .not("effective_date", "is", null);

        if (isFiltered) q = q.eq("assigned_agent_id", userId);

        const { data: clients, error } = await q;
        if (cancelled) return;
        // A failed refresh keeps the list on screen for this scope; an empty
        // result clears it (a refresh must not leave anniversaries that are gone).
        if (error && loadedScopeRef.current === scope) {
          setLoading(false);
          return;
        }
        loadedScopeRef.current = scope;
        if (!clients || clients.length === 0) {
          setItems([]);
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
              phone: c.phone ?? "",
            };
          })
          .filter((c) => c.daysUntil >= 0 && c.daysUntil <= 30)
          .sort((a, b) => a.daysUntil - b.daysUntil)
          .slice(0, 5);

        setItems(withAnniversary);
      } catch {
        if (!cancelled && loadedScopeRef.current !== scope) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAnniversaries();
    return () => {
      cancelled = true;
    };
  }, [userId, isFiltered, refreshSignal]);

  const handleContact = (e: React.MouseEvent, item: AnniversaryItem) => {
    // This row is itself the action; stop it reaching the parent widget card, which
    // has its own click handler that opens the detail modal.
    e.stopPropagation();

    // These rows come from `clients`, so the contact type is "client" — never "lead",
    // which is what the dialer would have assumed from an omitted `type`.
    const started = dispatchQuickCall({
      contactId: item.id,
      name: `${item.firstName} ${item.lastName}`.trim(),
      phone: item.phone,
      type: "client",
    });
    // Never report a call that did not start.
    if (!started) {
      toast.error(`No phone number on file for ${item.firstName} ${item.lastName}.`);
    }
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
            onClick={(e) => handleContact(e, item)}
            className="group relative flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-transparent hover:border-pink-500/20 hover:bg-pink-500/5 transition-all cursor-pointer"
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
          </motion.div>
        );
      })}
    </div>
  );
};

export default AnniversariesWidget;
