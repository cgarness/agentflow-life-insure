import React from "react";
import { useDialer } from "@/contexts/DialerContext";
import { DialerActions } from "./DialerActions";
import { fmtDuration } from "@/utils/dialerUtils";

export const DialerOutcomePanel: React.FC = () => {
  const {
    telnyxCallState, telnyxCallDuration, amdEnabled, amdStatus,
    campaignType, selectedCampaignId, organizationId, profile,
    lockMode, currentLead, leftTab, setLeftTab,
    dispositions, selectedDisp, handleHangUp, handleCall, handleSkip,
    handleLeadSelect, leadQueue, currentLeadIndex, loadingLeads,
    hasMoreLeads, currentOffset, fetchLeadsBatch
  } = useDialer() as any;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <DialerActions
        telnyxCallState={telnyxCallState}
        telnyxCallDuration={telnyxCallDuration}
        amdEnabled={amdEnabled}
        amdStatus={amdStatus}
        claimRingActive={false} // logic for claim ring can be added back
        campaignType={campaignType}
        campaignId={selectedCampaignId || ""}
        organizationId={organizationId}
        userRole={profile?.role || "agent"}
        lockMode={lockMode}
        currentLead={currentLead}
        leftTab={leftTab}
        dispositions={dispositions}
        selectedDisp={selectedDisp}
        fmtDuration={fmtDuration}
        onHangUp={handleHangUp}
        onCall={handleCall}
        onSkip={handleSkip}
        onSelectTab={setLeftTab}
        onSelectDisposition={() => {}} // This should be handled by logic moved to context
        queuePanelProps={{
          campaignType,
          campaignId: selectedCampaignId!,
          organizationId,
          userRole: profile?.role || "Agent",
          displayQueue: leadQueue.map((l: any, i: number) => ({ lead: l, originalIndex: i })),
          leadQueue: leadQueue,
          currentLeadIndex,
          onSelectLead: handleLeadSelect,
          queueSort: 'default',
          setQueueSort: () => {},
          showQueueFilters: false,
          setShowQueueFilters: () => {},
          showQueueFieldPicker: false,
          setShowQueueFieldPicker: () => {},
          queuePreviewFields: ['state', 'attempts'],
          setQueuePreviewFields: () => {},
          loadingLeads,
          hasMoreLeads,
          currentOffset,
          fetchLeadsBatch,
          renderQueuePreviewValue: (lead: any, field: string) => String(lead[field] || "—"),
          PREVIEW_FIELD_LABELS: { state: "State", attempts: "Calls", age: "Age", score: "Score" },
          onClearFilters: () => {},
          filterSummary: "",
        }}
        availableScripts={[]} // logic for scripts can be added back
        activeScriptId={null}
        onOpenScript={() => {}}
      />
    </div>
  );
};
