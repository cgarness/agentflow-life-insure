import React from "react";
import { ChevronLeft, ChevronRight, Eye, Pencil, Check, X, ChevronDown, Clock } from "lucide-react";
import { useDialer } from "@/contexts/DialerContext";
import LeadCard from "./LeadCard";
import { ConversationHistory } from "./ConversationHistory";
import { getStatusColorStyle, normalizeStatusDisplay } from "@/utils/dialerUtils";
import { supabase } from "@/integrations/supabase/client";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import { toast } from "sonner";

export const DialerContactSidebar: React.FC = () => {
  const {
    currentLead, currentLeadIndex, setCurrentLeadIndex, leadQueue,
    isEditingContact, setIsEditingContact, editForm, setEditForm,
    setShowFullViewDrawer, setShowWrapUp, setNoteText, setNoteError,
    smsTab, setSmsTab, messageText, setMessageText, subjectText, setSubjectText, selectedCallerNumber, setSelectedCallerNumber, availableNumbers, setAvailableNumbers,
    history, historyLeadId, loadingHistory,
    contactLocalTimeDisplay, leadStages, handleStatusChange,
    callStatus, selectedCampaign, isAdvancing
  } = useDialer() as any;

  const saveInlineEdit = async () => {
    if (!currentLead) return;
    try {
      const masterId = currentLead.lead_id || currentLead.id;
      const { first_name, last_name, phone, email, state, ...customFields } = editForm;
      await leadsSupabaseApi.update(masterId, { firstName: first_name, lastName: last_name, phone, email, state, customFields });
      if (currentLead.id && currentLead.id !== masterId) {
        await supabase.from('campaign_leads').update({ first_name, last_name, phone, email, state }).eq('id', currentLead.id);
      }
      setIsEditingContact(false);
      toast.success("Contact updated");
    } catch (err: any) {
      toast.error("Update failed: " + err.message);
    }
  };

  const currentStatusColor = "#6B7280"; // Placeholder, logic can be moved here if needed

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="bg-card border-b p-3 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between gap-2 overflow-hidden">
          {currentLead && (
            <div className="flex-1 min-w-0">
              {isEditingContact ? (
                <div className="flex gap-1">
                  <input value={editForm.first_name || ""} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} className="bg-accent/50 border rounded px-1.5 py-1 text-xs font-bold w-full focus:ring-1 focus:ring-primary outline-none" />
                  <input value={editForm.last_name || ""} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} className="bg-accent/50 border rounded px-1.5 py-1 text-xs font-bold w-full focus:ring-1 focus:ring-primary outline-none" />
                </div>
              ) : (
                <h2 className="text-sm font-bold text-foreground truncate">
                  {`${currentLead?.first_name ?? ""} ${currentLead?.last_name ?? ""}`.trim()}
                </h2>
              )}
            </div>
          )}

          <div className="flex items-center gap-0.5 shrink-0">
            <div className="flex items-center">
              <button onClick={() => { if (currentLeadIndex > 0) setCurrentLeadIndex(currentLeadIndex - 1); }} disabled={currentLeadIndex === 0} className="p-1 text-muted-foreground hover:text-primary rounded disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => { if (currentLeadIndex < leadQueue.length - 1) setCurrentLeadIndex(currentLeadIndex + 1); }} disabled={currentLeadIndex >= leadQueue.length - 1} className="p-1 text-muted-foreground hover:text-primary rounded disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="w-px h-4 bg-border mx-0.5" />
            <button onClick={() => setShowFullViewDrawer(true)} className="p-1 text-primary hover:bg-primary/10 rounded"><Eye className="w-4 h-4" /></button>
            {isEditingContact ? (
              <>
                <button onClick={saveInlineEdit} className="p-1 text-success hover:bg-success/10 rounded"><Check className="w-4 h-4" /></button>
                <button onClick={() => setIsEditingContact(false)} className="p-1 text-destructive hover:bg-destructive/10 rounded"><X className="w-4 h-4" /></button>
              </>
            ) : (
              <button onClick={() => setIsEditingContact(true)} className="p-1 text-primary hover:bg-primary/10 rounded"><Pencil className="w-4 h-4" /></button>
            )}
          </div>
        </div>

        {currentLead && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <select
                value={currentLead?.status || ""}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="w-full text-[10px] text-center uppercase font-bold rounded-md px-6 py-1 border border-transparent appearance-none cursor-pointer"
                style={getStatusColorStyle(currentStatusColor)}
              >
                {leadStages.map((s: any) => (
                  <option key={s.id} value={s.name} style={{ color: s.color }}>{normalizeStatusDisplay(s.name)}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
            </div>
            {contactLocalTimeDisplay && (
              <div className="shrink-0 inline-flex items-center text-green-500 text-[10px] font-bold">
                <Clock className="w-2.5 h-2.5 mr-1" />
                {contactLocalTimeDisplay}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <LeadCard
            lead={currentLead}
            callStatus={callStatus}
            callAttempts={currentLead?.call_attempts ?? 0}
            maxAttempts={selectedCampaign?.max_attempts ?? null}
            lastDisposition={history.find((h: any) => h.type === "call")?.disposition ?? null}
            isClaimed={false} // logic for claimed leads can be added back
            isEditing={isEditingContact}
            editForm={editForm}
            onEditChange={(key: string, val: any) => setEditForm((prev: any) => ({ ...prev, [key]: val }))}
            isAdvancing={isAdvancing}
          />
        </div>
        <div className="h-64 border-t bg-card/50">
          <ConversationHistory
            history={historyLeadId === (currentLead?.lead_id || currentLead?.id) ? history : []}
            loadingHistory={loadingHistory || historyLeadId !== (currentLead?.lead_id || currentLead?.id)}
            formatDateTime={(d: Date) => d.toISOString()} 
            smsTab={smsTab}
            messageText={messageText}
            subjectText={subjectText}
            selectedCallerNumber={selectedCallerNumber}
            availableNumbers={availableNumbers}
            onSmsTabChange={setSmsTab}
            onOpenTemplates={() => {}}
            onSendMessage={() => {}}
            onMessageChange={setMessageText}
            onSubjectChange={setSubjectText}
            onCallerNumberChange={setSelectedCallerNumber}
          />
        </div>
      </div>
    </div>
  );
};
