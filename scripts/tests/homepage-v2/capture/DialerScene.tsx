import React, { useEffect, useState } from "react";
import LeadCard from "@/components/dialer/LeadCard";
import { DialerActions } from "@/components/dialer/DialerActions";
import { ConversationHistory } from "@/components/dialer/ConversationHistory";

const LEADS = ["Casey", "Morgan"].map((name, index) => ({ id: `demo-lead-${index}`, first_name: name, last_name: "Demo",
  phone: "2025550142", state: "Nevada", age: "64", source: "Sample Final Expense", best_time_to_call: "Morning" }));
const DISPOSITIONS = ["No Answer", "Interested", "Call Back", "Not Interested", "Appointment Set", "DNC"].map((name, index) => ({
  id: `demo-outcome-${index}`, name, color: ["#94a3b8", "#22c55e", "#38bdf8", "#f97316", "#a78bfa", "#f87171"][index],
  requireNotes: false, minNoteChars: 0, callbackScheduler: false, appointmentScheduler: false,
}));

export default function DialerScene({ epoch }: { epoch: number }) {
  const [index, setIndex] = useState(0), [active, setActive] = useState(false), [wrap, setWrap] = useState(false);
  const [selected, setSelected] = useState<typeof DISPOSITIONS[number] | null>(null);
  const [tab, setTab] = useState<"dispositions" | "queue" | "scripts">("dispositions");
  const [note, setNote] = useState("");
  useEffect(() => {
    setIndex(0); setActive(false); setWrap(false); setSelected(null); setNote(""); if (!epoch) return;
    const a = setTimeout(() => setActive(true), 850);
    const b = setTimeout(() => { setActive(false); setWrap(true); setSelected(DISPOSITIONS[1]); setNote("Requested a coverage review."); }, 2450);
    const c = setTimeout(() => { setIndex(1); setWrap(false); setSelected(null); setNote(""); }, 4400);
    return () => { clearTimeout(a); clearTimeout(b); clearTimeout(c); };
  }, [epoch]);
  const next = () => { setIndex(previous => previous === 0 ? 1 : 0); setWrap(false); setSelected(null); };
  return <div className="flex h-full gap-3 p-4">
    <div className="flex w-[210px] shrink-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="border-b p-4"><h2 className="text-sm font-bold">{LEADS[index].first_name} Demo</h2><p className="mt-1 text-xs text-muted-foreground">Sample final expense lead</p></div>
      <LeadCard lead={LEADS[index]} callStatus="connected" callAttempts={1} maxAttempts={null} lastDisposition={null} isClaimed={false}
        isEditing={false} editForm={{}} onEditChange={() => {}} fieldDescriptors={[
          { label: "Phone", key: "phone", kind: "standard" }, { label: "State", key: "state", kind: "standard" },
          { label: "Age", key: "age", kind: "standard" }, { label: "Best Time", key: "best_time_to_call", kind: "standard" },
          { label: "Source", key: "source", kind: "standard" },
        ]} />
    </div>
    <ConversationHistory history={[{ id: "demo-note", type: "note", description: "Requested information about final expense coverage.", created_at: "2026-10-29T21:00:00Z" }]}
      loadingHistory={false} formatDateTime={() => "2:00 PM"} smsTab="sms" messageText="" subjectText=""
      selectedCallerNumber="" availableNumbers={[]} currentUserId="demo-agent" onSmsTabChange={() => {}} onOpenTemplates={() => {}}
      onSendMessage={() => {}} onMessageChange={() => {}} onSubjectChange={() => {}} onCallerNumberChange={() => {}}
      emailConnections={[]} selectedEmailConnectionId="" onEmailConnectionChange={() => {}} />
    <DialerActions voiceCallState={active ? "active" : "idle"} voiceCallDuration={2} claimRingActive={false}
      campaignType="Personal" campaignId="demo-campaign" organizationId="demo-org" userRole="Agent" lockMode={false}
      currentLead={LEADS[index]} leftTab={tab} dispositions={DISPOSITIONS} selectedDisp={selected} fmtDuration={() => "00:02"}
      onHangUp={() => { setActive(false); setWrap(true); }} onCall={() => setActive(true)} onSkip={next} onSelectTab={setTab}
      onSelectDisposition={setSelected} availableScripts={[]} activeScriptId={null} onOpenScript={() => {}}
      showWrapUp={wrap} noteText={note} noteError={false} onNoteChange={setNote} onSaveOnly={() => setWrap(false)} onSaveAndNext={next}
      queuePanelProps={{ campaignType: "Personal", campaignId: "demo-campaign", organizationId: "demo-org", userRole: "Agent",
        displayQueue: LEADS.map((lead, originalIndex) => ({ lead, originalIndex })), leadQueue: LEADS, currentLeadIndex: index,
        onSelectLead: setIndex, queueSort: "default", setQueueSort: () => {}, showQueueFilters: false, setShowQueueFilters: () => {},
        loadingLeads: false, hasMoreLeads: false, currentOffset: 0, fetchLeadsBatch: () => {}, onClearFilters: () => {}, filterSummary: "", leadCallStats: {} }} />
  </div>;
}
