import React, { useState, useEffect } from "react";
import { Phone, Clock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { dispatchQuickCall, type QuickCallContactType } from "@/lib/quick-call";

interface CallbacksWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
}

/** Rows fetched per render. The displayed total comes from an exact count, not this. */
const PAGE_SIZE = 15;
/** Bounded overdue window — replaces the previously unbounded historical query. */
const OVERDUE_LOOKBACK_DAYS = 30;

interface CallbackItem {
  id: string;
  contactName: string;
  contactId: string | null;
  startTime: string;
  phone: string;
  /** Real contact kind, resolved from the contact tables — never assumed. */
  contactType: QuickCallContactType | null;
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
        // Half-open upper bound: strictly BEFORE the start of the 4th day out, so a
        // callback sitting exactly on the boundary instant belongs to one window only.
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const windowEndExclusive = new Date(
          todayStart.getTime() + 4 * 24 * 60 * 60 * 1000,
        ).toISOString();

        // Lower bound: overdue callbacks matter, but "every callback ever" does not.
        // Look back a bounded window instead of the previously unbounded query.
        const overdueLookback = new Date(
          todayStart.getTime() - OVERDUE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();

        const applyScope = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
          isFiltered ? q.eq("user_id", userId) : q;

        // Ordering is deterministic and action-appropriate: oldest-due first, so the
        // most overdue callback is the first thing an agent sees. `id` is the tiebreak
        // so two callbacks on the same timestamp never swap between renders.
        const rowsQuery = applyScope(
          supabase
            .from("appointments")
            .select("id, contact_name, contact_id, start_time, type")
            .in("type", ["Follow Up", "Call Back"])
            .eq("status", "Scheduled")
            .gte("start_time", overdueLookback)
            .lt("start_time", windowEndExclusive)
            .order("start_time", { ascending: true })
            .order("id", { ascending: true })
            .limit(PAGE_SIZE) as any,
        );

        // The real total comes from an exact count over the SAME predicate — never
        // from the truncated page length, which capped the "View All N" label at 15.
        const countQuery = applyScope(
          supabase
            .from("appointments")
            .select("id", { count: "exact", head: true })
            .in("type", ["Follow Up", "Call Back"])
            .eq("status", "Scheduled")
            .gte("start_time", overdueLookback)
            .lt("start_time", windowEndExclusive) as any,
        );

        const [{ data }, { count }] = await Promise.all([rowsQuery, countQuery]);
        if (!data || data.length === 0) {
          setTotalCount(count ?? 0);
          setLoading(false);
          return;
        }

        setTotalCount(count ?? data.length);

        // `appointments` has a polymorphic `contact_id` and NO `contact_type` column,
        // so the real kind has to be resolved from the contact tables. Resolving both
        // is what lets a client callback dial at all (the old lead-only lookup left
        // every client contact with an empty phone) and is what keeps a client from
        // being handed to the dialer labelled "lead".
        const contactIds = data.map((d) => d.contact_id).filter(Boolean) as string[];
        const contactMap: Record<string, { phone: string; type: QuickCallContactType }> = {};
        if (contactIds.length > 0) {
          const [{ data: leads }, { data: clients }] = await Promise.all([
            supabase.from("leads").select("id, phone").in("id", contactIds),
            supabase.from("clients").select("id, phone").in("id", contactIds),
          ]);
          for (const lead of leads ?? []) {
            contactMap[lead.id] = { phone: lead.phone ?? "", type: "lead" };
          }
          // Clients win a collision: an id present in both means the lead was
          // converted, and the client row is the live contact.
          for (const client of clients ?? []) {
            contactMap[client.id] = { phone: client.phone ?? "", type: "client" };
          }
        }

        const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
        const tomorrowEnd = new Date(todayEnd.getTime() + 2 * 24 * 60 * 60 * 1000);

        const overdueItems: CallbackItem[] = [];
        const todayItems: CallbackItem[] = [];
        const soonItems: CallbackItem[] = [];

        for (const item of data) {
          const st = new Date(item.start_time);
          const resolved = item.contact_id ? contactMap[item.contact_id] : undefined;
          const cb: CallbackItem = {
            id: item.id,
            contactName: item.contact_name || "Unknown",
            contactId: item.contact_id,
            startTime: item.start_time,
            phone: resolved?.phone ?? "",
            contactType: resolved?.type ?? null,
          };

          // Today = overdue PLUS due-today, the deliberate exception in the date rule.
          // Half-open comparisons throughout: `< todayEnd`, never `<=`.
          if (st < now) {
            overdueItems.push(cb);
          } else if (st < todayEnd) {
            todayItems.push(cb);
          } else if (st < tomorrowEnd) {
            soonItems.push(cb);
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

  const handleCall = (e: React.MouseEvent, item: CallbackItem) => {
    // Keep the action inside the button: the widget card and the detail-card rows
    // both carry their own click handlers, and this must not open either.
    e.stopPropagation();

    if (!item.contactId || !item.contactType) {
      toast.error("This callback has no linked contact record — open it in Contacts to call.");
      return;
    }
    const started = dispatchQuickCall({
      contactId: item.contactId,
      name: item.contactName,
      phone: item.phone,
      type: item.contactType,
    });
    // Never report a call that did not start.
    if (!started) toast.error(`No phone number on file for ${item.contactName}.`);
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
                onClick={(e) => handleCall(e, item)}
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
          onClick={(e) => {
            e.stopPropagation();
            navigate("/contacts");
          }}
          className="w-full mt-4 text-primary hover:text-primary/80 hover:bg-primary/5 rounded-xl text-xs font-bold uppercase tracking-widest"
        >
          View All {totalCount} Callbacks
        </Button>
      )}
    </div>
  );
};

export default CallbacksWidget;
