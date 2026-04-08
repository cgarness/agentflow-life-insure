import React from "react";
import { useDialer } from "@/contexts/DialerContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { AlertTriangle, BarChart3 } from "lucide-react";

export const DialerModalsContainer: React.FC = () => {
  const {
    showCallbackModal, setShowCallbackModal, callbackDate, setCallbackDate, callbackTime, setCallbackTime,
    showAppointmentModal, setShowAppointmentModal,
    showDncWarning, setShowDncWarning, dncReason,
    showSessionEnd, setShowSessionEnd, autoDialSessionStats,
    handleAdvance, handleSkip, telnyxMakeCall
  } = useDialer() as any;

  return (
    <>
      {/* CALLBACK MODAL */}
      <Dialog open={showCallbackModal} onOpenChange={setShowCallbackModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule Callback</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Calendar mode="single" selected={callbackDate} onSelect={setCallbackDate} />
            <input value={callbackTime} onChange={(e) => setCallbackTime(e.target.value)} placeholder="e.g. 2:30 PM" className="bg-accent border rounded-lg px-3 py-2 text-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCallbackModal(false)}>Cancel</Button>
            <Button onClick={() => setShowCallbackModal(false)} disabled={!callbackDate || !callbackTime}>Save Callback</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DNC WARNING */}
      <Dialog open={showDncWarning} onOpenChange={setShowDncWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Do Not Call Warning
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-slate-300">This number is on the DNC list.</p>
            {dncReason && (
              <div className="bg-slate-800 rounded p-3">
                <p className="text-sm text-slate-400">Reason:</p>
                <p className="text-sm text-slate-200">{dncReason}</p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDncWarning(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => { handleSkip(); setShowDncWarning(false); }}>Skip to Next</Button>
            <Button variant="default" onClick={() => { setShowDncWarning(false); }}>Dial Anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SESSION END */}
      <Dialog open={showSessionEnd} onOpenChange={setShowSessionEnd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-500" />
              Session Complete
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-center">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800 rounded p-4">
                <p className="text-sm text-slate-400">Total Leads</p>
                <p className="text-2xl font-bold">{autoDialSessionStats?.totalLeads || 0}</p>
              </div>
              <div className="bg-slate-800 rounded p-4">
                <p className="text-sm text-slate-400">Leads Dialed</p>
                <p className="text-2xl font-bold text-blue-400">{autoDialSessionStats?.leadsDialed || 0}</p>
              </div>
            </div>
            <p className="text-sm text-slate-400">Queue is now empty. Great work!</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowSessionEnd(false)}>End Session</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
