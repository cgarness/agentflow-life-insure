import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Headphones, Mic, PhoneIncoming, RefreshCw, Info } from "lucide-react";
import { toast } from "sonner";

interface ActiveCall {
  id: string;
  agent_name: string;
  contact_name: string;
  contact_phone: string;
  direction: string;
  status: string;
  created_at: string;
  started_at: string | null;
  duration: number;
}

const ACTIVE_STATUSES = new Set(["ringing", "connected", "in-progress"]);

const CallMonitoring: React.FC = () => {
  const { organizationId } = useOrganization();
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [functionUnavailable, setFunctionUnavailable] = useState(false);
  const [, setTick] = useState(0);
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  const fetchActiveCalls = useCallback(async (): Promise<boolean> => {
    if (!organizationId) {
      setCalls([]);
      setLoading(false);
      return false;
    }
    const { data, error } = await supabase.functions.invoke("get-active-calls", {
      body: { organization_id: organizationId },
    });
    if (error) {
      setFunctionUnavailable(true);
      setCalls([]);
      setLoading(false);
      return false;
    }
    setFunctionUnavailable(false);
    setCalls(Array.isArray(data) ? data : []);
    setLoading(false);
    return true;
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const ok = await fetchActiveCalls();
      if (cancelled || !ok) return;

      channel = supabase
        .channel(`active-calls-${organizationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "calls",
            filter: `organization_id=eq.${organizationId}`,
          },
          (payload) => {
            const newRow = (payload.new ?? null) as Partial<ActiveCall> & { id?: string; status?: string | null } | null;
            const oldRow = (payload.old ?? null) as { id?: string } | null;

            if (payload.eventType === "DELETE") {
              const id = oldRow?.id;
              if (id) setCalls((prev) => prev.filter((c) => c.id !== id));
              return;
            }

            if (!newRow?.id) return;
            const isActive = newRow.status ? ACTIVE_STATUSES.has(newRow.status) : false;

            if (!isActive) {
              setCalls((prev) => prev.filter((c) => c.id !== newRow.id));
              return;
            }

            // Active row INSERT or UPDATE: refresh via Edge Function to enrich agent/contact fields.
            void fetchActiveCalls();
          },
        )
        .subscribe();
    })();

    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [organizationId, fetchActiveCalls]);

  const handleRetry = useCallback(async () => {
    setLoading(true);
    await fetchActiveCalls();
  }, [fetchActiveCalls]);

  const handleAction = (_action: string) => {
    toast.info("Call monitoring requires Twilio Call Control — coming in a future update.");
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">Call Monitoring</h3>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-primary/5 border border-primary/20 rounded-xl p-4">
        <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <p className="text-sm text-foreground">
          Listen, Whisper, and Barge require Twilio Call Control integration. Full functionality coming soon.
        </p>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h4 className="font-semibold text-foreground flex items-center gap-2">
            Live Calls
            {!functionUnavailable && (
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </h4>
          {!functionUnavailable && (
            <span className="text-xs text-muted-foreground">Live via Realtime</span>
          )}
        </div>
        {!functionUnavailable && (
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchActiveCalls(); }}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        )}
      </div>

      {/* Table / states */}
      {functionUnavailable ? (
        <div className="flex items-start gap-3 bg-muted/40 border border-border rounded-xl p-4">
          <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-foreground">
              Call monitoring is being set up. Live call tracking will be available soon.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRetry}>
            <RefreshCw className="w-4 h-4 mr-1" /> Retry
          </Button>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <div className="bg-accent/50 rounded-xl p-12 text-center">
          <Headphones className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h4 className="font-semibold text-foreground mb-1">No active calls right now</h4>
          <p className="text-sm text-muted-foreground">Live calls will appear here automatically.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Agent</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contact</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Direction</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Duration</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <LiveCallRow key={c.id} call={c} onAction={handleAction} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const LiveCallRow: React.FC<{ call: ActiveCall; onAction: (a: string) => void }> = ({ call, onAction }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startIso = call.started_at ?? call.created_at;
    const start = new Date(startIso).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [call.started_at, call.created_at]);

  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3 font-medium text-foreground">{call.agent_name}</td>
      <td className="px-4 py-3 text-foreground">{call.contact_name}</td>
      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{call.contact_phone}</td>
      <td className="px-4 py-3 text-muted-foreground capitalize text-xs">{call.direction}</td>
      <td className="px-4 py-3 font-mono text-xs">{m}m {s}s</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onAction("listen")} className="text-foreground">
            <Headphones className="w-3.5 h-3.5 mr-1" /> Listen
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAction("whisper")} className="text-primary">
            <Mic className="w-3.5 h-3.5 mr-1" /> Whisper
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAction("barge")} className="text-warning">
            <PhoneIncoming className="w-3.5 h-3.5 mr-1" /> Barge
          </Button>
        </div>
      </td>
    </tr>
  );
};

export default CallMonitoring;
