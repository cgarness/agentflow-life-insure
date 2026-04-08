import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDialer, DialerProvider } from "@/contexts/DialerContext";
import CampaignSelection from "@/components/dialer/CampaignSelection";
import { DialerLayout } from "@/components/dialer/DialerLayout";
import { Loader2, Users } from "lucide-react";

/**
 * DialerContent handles the high-level conditional rendering
 * between Campaign Selection and the Active Dialer Layout.
 */
const DialerContent: React.FC = () => {
  const {
    selectedCampaignId,
    setSelectedCampaignId,
    campaigns, campaignsLoading, campaignStats, loadingLeads, leadQueue, setLeadQueue, handleToggleLocalPresence
  } = useDialer() as any;

  // ─── 0. SELECTION SCREEN ───
  if (!selectedCampaignId) {
    return (
      <CampaignSelection
        campaigns={campaigns}
        campaignsLoading={campaignsLoading}
        campaignStateStats={campaignStats || {}}
        onSelectCampaign={setSelectedCampaignId}
        onOpenSettings={() => {}} 
        onToggleLocalPresence={handleToggleLocalPresence}
      />
    );
  }

  // ─── 1. LOADING STATE ───
  if (loadingLeads && leadQueue.length === 0) {
    return (
      <div className="flex flex-col h-full bg-background text-foreground items-center justify-center p-6">
        <Loader2 className="w-6 h-6 animate-spin text-primary mb-3" />
        <p className="text-sm text-muted-foreground">Loading lead queue…</p>
      </div>
    );
  }

  // ─── 2. EMPTY STATE ───
  if (leadQueue.length === 0) {
    return (
      <div className="flex flex-col h-full bg-background text-foreground items-center justify-center p-6 text-center">
        <div className="bg-accent/30 p-8 rounded-full mb-6 text-muted-foreground">
          <Users className="w-12 h-12 opacity-40" />
        </div>
        <h2 className="text-xl font-bold mb-2 text-foreground">Campaign Queue Empty</h2>
        <p className="text-sm text-muted-foreground max-w-md mb-8">
          There are no remaining leads to dial in this campaign that haven't already been called or marked as DNC.
        </p>
        <button
          onClick={() => {
            setSelectedCampaignId(null);
            setLeadQueue([]);
          }}
          className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-semibold hover:bg-primary/90 transition-colors"
        >
          Return to Campaigns
        </button>
      </div>
    );
  }

  // ─── 3. ACTIVE DIALER ───
  return <DialerLayout />;
};

const DialerPage: React.FC = () => {
  return (
    <DialerProvider>
      <DialerContent />
    </DialerProvider>
  );
};

export default DialerPage;
