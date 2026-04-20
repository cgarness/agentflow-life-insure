import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Headphones, Mic, PhoneIncoming, RefreshCw, Info } from "lucide-react";
import { toast } from "sonner";

interface ActiveCall {
  id: string;
  agent_name: string;
  contact_name: string;
  contact_phone: string;
  created_at: string;
}

const SUPABASE_URL = "https://jncvvsvckxhqgqvkppmj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpuY3Z2c3Zja3hocWdxdmtwcG1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1Njc4ODYsImV4cCI6MjA4ODE0Mzg4Nn0.wlLRugR92OUUpV7_vl8T8EnfPqrAosJ-CfNpKmw0IPE";

const CallMonitoring: React.FC = () => {
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date>(new Date());
  const [secondsAgo, setSecondsAgo] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  const fetchActiveCalls = useCallback(async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-active-calls`, {
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCalls(Array.isArray(data) ? data : []);
      } else {
        setCalls([]);
      }
    } catch {
      setCalls([]);
    }
    setLastFetched(new Date());
    setSecondsAgo(0);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchActiveCalls();
    intervalRef.current = setInterval(fetchActiveCalls, 5000);
    tickRef.current = setInterval(() => setSecondsAgo((s) => s + 1), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [fetchActiveCalls]);

  const handleAction = (action: string) => {
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
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          </h4>
          <span className="text-xs text-muted-foreground">Last updated {secondsAgo}s ago</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchActiveCalls(); }}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Table */}
      {loading ? (
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
    const start = new Date(call.created_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [call.created_at]);

  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3 font-medium text-foreground">{call.agent_name}</td>
      <td className="px-4 py-3 text-foreground">{call.contact_name}</td>
      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{call.contact_phone}</td>
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
