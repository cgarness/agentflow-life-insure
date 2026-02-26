import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, X, Mic, MicOff, Pause, Play, Voicemail,
  PhoneOff, MessageSquare, Clock, User, Save,
} from "lucide-react";

const dispositions = [
  "1. Not Available", "2. Left Voicemail", "3. Not Interested",
  "4. Call Back Later", "5. Interested - Follow Up", "6. Appointment Set",
  "7. Policy Sold", "8. Wrong Number", "9. DNC Request",
];

const FloatingDialer: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [onCall, setOnCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [mode, setMode] = useState<"Power" | "Predictive" | "Preview">("Power");
  const [showDisposition, setShowDisposition] = useState(false);

  return (
    <>
      {/* FAB Button */}
      <button
        onClick={() => setOpen(true)}
        className={`fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center z-40 hover:scale-105 sidebar-transition ${onCall ? "animate-pulse-ring" : ""}`}
      >
        <Phone className="w-6 h-6" />
      </button>

      {/* Slide-out Panel */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.3 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-foreground z-40"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ x: 380 }}
              animate={{ x: 0 }}
              exit={{ x: 380 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 w-[380px] max-w-full h-screen bg-card border-l shadow-2xl z-50 flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 h-14 border-b shrink-0">
                <h2 className="font-semibold text-foreground">Dialer</h2>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
              </div>

              {/* Mode Tabs */}
              <div className="flex border-b shrink-0">
                {(["Power", "Predictive", "Preview"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 py-2.5 text-sm font-medium sidebar-transition ${mode === m ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Status Pill */}
                <div className="flex justify-center">
                  <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                    onCall ? "bg-primary/10 text-primary" : "bg-success/10 text-success"
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${onCall ? "bg-primary animate-pulse" : "bg-success"}`} />
                    {onCall ? "On Call" : "Ready"}
                  </span>
                </div>

                {/* Contact Info */}
                <div className="bg-accent/50 rounded-lg p-4 text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold mx-auto">JM</div>
                  <p className="font-semibold text-foreground">John Martinez</p>
                  <p className="text-sm text-muted-foreground">(555) 123-4567</p>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Florida</span>
                    <span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">Facebook Ads</span>
                  </div>
                </div>

                {/* Call Controls */}
                {!onCall ? (
                  <button
                    onClick={() => setOnCall(true)}
                    className="w-full py-3 rounded-lg bg-success text-success-foreground font-semibold flex items-center justify-center gap-2 hover:bg-success/90 sidebar-transition"
                  >
                    <Phone className="w-5 h-5" /> Call
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Clock className="w-4 h-4" />
                        <span className="text-lg font-mono font-semibold text-foreground">2:34</span>
                      </div>
                    </div>
                    <button
                      onClick={() => { setOnCall(false); setShowDisposition(true); }}
                      className="w-full py-3 rounded-lg bg-destructive text-destructive-foreground font-semibold flex items-center justify-center gap-2 hover:bg-destructive/90 sidebar-transition"
                    >
                      <PhoneOff className="w-5 h-5" /> Hang Up
                    </button>
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => setMuted(!muted)} className={`w-10 h-10 rounded-lg flex items-center justify-center sidebar-transition ${muted ? "bg-destructive/10 text-destructive" : "bg-accent text-foreground hover:bg-accent/80"}`}>
                        {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      </button>
                      <button onClick={() => setHeld(!held)} className={`w-10 h-10 rounded-lg flex items-center justify-center sidebar-transition ${held ? "bg-warning/10 text-warning" : "bg-accent text-foreground hover:bg-accent/80"}`}>
                        {held ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                      </button>
                      <button className="w-10 h-10 rounded-lg bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition">
                        <Voicemail className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Pinned Notes</h3>
                  <div className="bg-accent/50 rounded-lg p-3 text-sm text-muted-foreground">
                    Interested in Term Life, has 2 kids. Follow up about premium options.
                  </div>
                  <input
                    type="text"
                    placeholder="Add a quick note..."
                    className="w-full px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>

                {/* Disposition Panel */}
                {showDisposition && (
                  <div className="bg-accent/50 rounded-lg p-4 space-y-3">
                    <h3 className="font-semibold text-foreground text-sm">How did the call go?</h3>
                    <div className="space-y-1">
                      {dispositions.map((d) => (
                        <button key={d} className="w-full text-left px-3 py-2 rounded-lg text-sm text-foreground hover:bg-primary hover:text-primary-foreground sidebar-transition">{d}</button>
                      ))}
                    </div>
                    <textarea placeholder="Add notes about this call..." className="w-full px-3 py-2 rounded-lg bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" rows={3} />
                    <button onClick={() => setShowDisposition(false)} className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 sidebar-transition">Save & Next</button>
                  </div>
                )}

                {/* AI Summary */}
                {showDisposition && (
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-2">
                    <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-primary" /> AI Call Summary
                    </h3>
                    <p className="text-sm text-muted-foreground">Client expressed interest in Term Life policy for family coverage. Discussed premium options and requested a follow-up call next Tuesday.</p>
                    <p className="text-xs text-primary font-medium">Suggested: Schedule follow-up appointment for Tuesday</p>
                    <button className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-lg font-medium hover:bg-primary/20 sidebar-transition">
                      <Save className="w-3 h-3 inline mr-1" /> Save to Contact
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default FloatingDialer;
