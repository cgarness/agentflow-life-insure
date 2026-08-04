import React, { useState, useEffect } from "react";
import { Phone, Clock, User, AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { dispatchQuickCall } from "@/lib/quick-call";
import {
  type CallbackBucket,
  type NormalizedCallbackRow,
  bucketCallback,
  fetchCallbackPage,
  fetchCallbackTotal,
} from "@/lib/dashboard-callbacks";
import { startOfLocalDayPlus } from "@/lib/local-calendar";

interface CallbacksWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
}

/** Rows fetched per render. The displayed total comes from an exact count, not this. */
const PAGE_SIZE = 15;

const CallbacksWidget: React.FC<CallbacksWidgetProps> = ({ userId, role, adminToggle }) => {
  const navigate = useNavigate();
  const [overdue, setOverdue] = useState<NormalizedCallbackRow[]>([]);
  const [dueToday, setDueToday] = useState<NormalizedCallbackRow[]>([]);
  const [dueSoon, setDueSoon] = useState<NormalizedCallbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  /** Explicit load failure — kept distinct from a successful empty result. */
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Existing Personal/Team gate, preserved verbatim. No hierarchy expansion here —
  // Team/Agency scope resolution is Build 2 (decisions D3/D4).
  const isFiltered = role !== "Admin" || adminToggle === "my";

  useEffect(() => {
    let cancelled = false;

    const fetchCallbacks = async () => {
      // Reset the previous error and re-enter loading at the START of every request, so a
      // stale failure (or stale data from a previous user/scope) can never linger.
      setLoadError(false);
      setLoading(true);
      try {
        // Rows and total come from the SAME shared contract, so the "View All N" label
        // can never describe a different set from the rows on screen.
        const scope = { isFiltered, userId };
        const [rows, total] = await Promise.all([
          fetchCallbackPage({ ...scope, pageSize: PAGE_SIZE }),
          fetchCallbackTotal(scope),
        ]);
        if (cancelled) return;

        setTotalCount(total);

        // Calendar-constructed local midnight — DST-safe across 2026-03-08 / 2026-11-01.
        const now = new Date();
        const todayEndExclusive = startOfLocalDayPlus(now, 1);

        const buckets: Record<CallbackBucket, NormalizedCallbackRow[]> = {
          overdue: [],
          dueToday: [],
          dueSoon: [],
        };
        for (const row of rows) buckets[bucketCallback(row, now, todayEndExclusive)].push(row);

        setOverdue(buckets.overdue);
        setDueToday(buckets.dueToday);
        setDueSoon(buckets.dueSoon);
      } catch (err) {
        // A returned query error is a FAILURE, not "no callbacks". Clear the rows and the
        // total so data from a previous user/scope cannot remain on screen behind a
        // failure, and surface an explicit error state.
        //
        // Note the deliberate asymmetry: a SUCCESSFUL empty result never reaches here, so
        // a stale JWT role claim that makes campaign_leads RLS return zero rows still
        // reports "none found" (AGENT_RULES #19/#22), not an error.
        console.error("[CallbacksWidget] Failed to load callbacks:", err);
        if (cancelled) return;
        setOverdue([]);
        setDueToday([]);
        setDueSoon([]);
        setTotalCount(0);
        setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchCallbacks();
    return () => {
      cancelled = true;
    };
  }, [userId, isFiltered, reloadKey]);

  const handleCall = (e: React.MouseEvent, item: NormalizedCallbackRow) => {
    // Keep the action inside the button — it must not open the parent widget card.
    e.stopPropagation();

    if (!item.canAct || !item.contactId || !item.contactType) {
      toast.error(item.blockedReason ?? "This callback cannot be dialed.");
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

  // Rendered before the empty state on purpose: after a failed request the widget must
  // never claim "No pending callbacks".
  if (loadError) {
    return (
      <div className="text-center py-10 flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
          <AlertTriangle className="w-8 h-8 text-amber-500" />
        </div>
        <p className="text-sm text-foreground font-semibold">Couldn't load callbacks</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Something went wrong. Your callbacks may still be there.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setReloadKey((k) => k + 1);
          }}
          className="rounded-xl"
        >
          <RotateCw className="w-3.5 h-3.5 mr-2" />
          Try again
        </Button>
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
    items: NormalizedCallbackRow[]
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
              key={item.key}
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
                      {formatTime(item.dueAt)}
                    </p>
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => handleCall(e, item)}
                disabled={!item.canAct}
                title={item.blockedReason ?? undefined}
                className="rounded-lg shadow-sm hover:bg-primary hover:text-white hover:border-primary transition-all px-4 disabled:opacity-50"
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
