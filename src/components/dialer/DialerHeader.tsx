import React from "react";
import { Play, Pause } from "lucide-react";
import { useDialer } from "@/contexts/DialerContext";
import { DialerHeaderStats } from "./DialerHeaderStats";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { fmtDuration, fmtSessionDuration } from "@/utils/dialerUtils";
import { supabase } from "@/integrations/supabase/client";
import { releaseAllAgentLocks } from "@/lib/dialer-queue";

export const DialerHeader: React.FC = () => {
  const {
    lockMode, campaignType, selectedCampaignId, selectedCampaign,
    autoDialEnabled, setAutoDialEnabled, isPaused, setIsPaused,
    sessionStats, sessionElapsed, dialerStats,
    user, setSelectedCampaignId, setLeadQueue, setCurrentLeadIndex,
    telnyxDestroy, stopHeartbeat, cancelClaimTimer, sessionTimerRef,
    setSessionElapsed
  } = useDialer() as any;

  return (
    <div className="flex items-center border-b px-4 py-1 gap-4 bg-background">
      {/* LEFT */}
      <button
        onClick={() => {
          if (lockMode && selectedCampaignId) {
            releaseAllAgentLocks(selectedCampaignId);
          }
          stopHeartbeat();
          cancelClaimTimer();
          if (sessionTimerRef.current) {
            clearInterval(sessionTimerRef.current);
            sessionTimerRef.current = null;
          }
          setSessionElapsed(0);
          if (user?.id && selectedCampaignId) {
            supabase.from('dialer_queue_state').delete().eq('user_id', user.id).eq('campaign_id', selectedCampaignId).then(() => {});
          }
          telnyxDestroy();
          setSelectedCampaignId(null);
          setLeadQueue([]);
          setCurrentLeadIndex(0);
        }}
        className="border border-destructive text-destructive text-xs rounded-lg px-3 py-1 font-semibold shrink-0 hover:bg-destructive hover:text-destructive-foreground transition-colors"
      >
        ← End Session
      </button>

      {/* CENTER */}
      <DialerHeaderStats 
        statsLoading={!dialerStats}
        sessionStartedAt={dialerStats?.session_started_at}
        sessionElapsed={sessionElapsed}
        sessionStats={sessionStats}
        fmtSessionDuration={fmtSessionDuration}
        fmtDuration={fmtDuration}
      />

      {/* RIGHT */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground font-medium">Auto-Dial</label>
          <Switch
            checked={autoDialEnabled}
            onCheckedChange={(checked) => {
              setAutoDialEnabled(checked);
              if (!checked) setIsPaused(false);
            }}
          />
        </div>

        {autoDialEnabled && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2 gap-1"
            onClick={() => setIsPaused(!isPaused)}
          >
            {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {isPaused ? "Resume" : "Pause"}
          </Button>
        )}

        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-success inline-block" />
          <span className="text-success text-xs font-semibold">Dialer Ready</span>
        </div>

        {(() => {
          const t = campaignType.toUpperCase();
          const isTeam = t === "TEAM";
          const isOpen = t.includes("OPEN");
          const dotColor = isTeam ? "#8b5cf6" : isOpen ? "#f59e0b" : "#22c55e";
          const typeLabel = isTeam ? "TEAM" : isOpen ? "OPEN" : "PERSONAL";
          return (
            <div className="flex items-center gap-1.5 bg-accent/30 border border-border px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
              <span className="text-[10px] font-bold font-mono text-foreground uppercase tracking-widest">
                {typeLabel} · {selectedCampaign?.name ?? "No Campaign"}
              </span>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
