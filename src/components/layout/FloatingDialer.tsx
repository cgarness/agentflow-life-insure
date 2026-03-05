import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, X, Mic, MicOff, Pause, Play, Voicemail,
  PhoneOff, MessageSquare, Clock, Save, Calendar,
  FileText, AlertCircle, CheckCircle, SkipForward,
} from "lucide-react";
import { dispositionsApi } from "@/lib/mock-api";
import { Disposition } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

const FloatingDialer: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [onCall, setOnCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [mode, setMode] = useState<"Power" | "Predictive" | "Preview">("Power");
  const [showDisposition, setShowDisposition] = useState(false);

  // Disposition state
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [selectedDisp, setSelectedDisp] = useState<Disposition | null>(null);
  const [callNotes, setCallNotes] = useState("");
  const [noteError, setNoteError] = useState(false);
  const [saving, setSaving] = useState(false);

  // Callback scheduler
  const [showCallback, setShowCallback] = useState(false);
  const [callbackDate, setCallbackDate] = useState<Date | undefined>(undefined);
  const [callbackTime, setCallbackTime] = useState("10:00");

  // Call timer
  const [callSeconds, setCallSeconds] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (onCall) {
      timer = setInterval(() => setCallSeconds(s => s + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [onCall]);

  useEffect(() => {
    dispositionsApi.getAll().then(setDispositions).catch(() => {});
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const handleHangUp = () => {
    setOnCall(false);
    setShowDisposition(true);
    setSelectedDisp(null);
    setCallNotes("");
    setNoteError(false);
    setShowCallback(false);
    setCallbackDate(undefined);
    setCallbackTime("10:00");
  };

  const handleSelectDisposition = (d: Disposition) => {
    setSelectedDisp(d);
    setNoteError(false);
    if (d.callbackScheduler) {
      setShowCallback(true);
      setCallbackDate(new Date(Date.now() + 86400000));
    } else {
      setShowCallback(false);
    }
  };

  const handleSaveAndNext = async () => {
    if (!selectedDisp) {
      toast({ title: "Please select a disposition", variant: "destructive" });
      return;
    }
    if (selectedDisp.requireNotes && callNotes.length < selectedDisp.minNoteChars) {
      setNoteError(true);
      return;
    }

    setSaving(true);
    await new Promise(r => setTimeout(r, 400));

    if (selectedDisp.callbackScheduler && callbackDate) {
      const startTime = new Date(callbackDate);
      const [hours, minutes] = callbackTime.split(":").map(Number);
      startTime.setHours(hours, minutes, 0, 0);
      await supabase.from('appointments').insert([{
        title: `Callback — ${selectedDisp.name}`,
        contact_name: "John D.",
        type: "Sales Call",
        start_time: startTime.toISOString(),
      }]);
      toast({
        title: "Callback scheduled",
        description: `${format(callbackDate, "MMM d, yyyy")} at ${callbackTime}`,
      });
    }

    toast({ title: `Disposition saved: ${selectedDisp.name}` });
    setShowDisposition(false);
    setSelectedDisp(null);
    setCallNotes("");
    setCallSeconds(0);
    setSaving(false);
  };

  const handleSkipCallback = async () => {
    toast({
      title: "No callback scheduled",
      description: "No callback scheduled for John Martinez",
      variant: "destructive",
    });
    setShowCallback(false);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;

      if (showDisposition && !showCallback) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9 && num <= dispositions.length) {
          e.preventDefault();
          handleSelectDisposition(dispositions[num - 1]);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showDisposition, showCallback, dispositions]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center z-40 hover:scale-105 sidebar-transition ${onCall ? "animate-pulse-ring" : ""}`}
      >
        <Phone className="w-6 h-6" />
      </button>

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
                {/* Status */}
                <div className="flex justify-center">
                  <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                    onCall ? "bg-primary/10 text-primary" : "bg-success/10 text-success"
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${onCall ? "bg-primary animate-pulse" : "bg-success"}`} />
                    {onCall ? "On Call" : "Ready"}
                  </span>
                </div>

                {/* Contact */}
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
                {!onCall && !showDisposition ? (
                  <button
                    onClick={() => { setOnCall(true); setCallSeconds(0); }}
                    className="w-full py-3 rounded-lg bg-success text-success-foreground font-semibold flex items-center justify-center gap-2 hover:bg-success/90 sidebar-transition"
                  >
                    <Phone className="w-5 h-5" /> Call
                  </button>
                ) : onCall ? (
                  <div className="space-y-3">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Clock className="w-4 h-4" />
                        <span className="text-lg font-mono font-semibold text-foreground">{formatTime(callSeconds)}</span>
                      </div>
                    </div>
                    <button
                      onClick={handleHangUp}
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
                ) : null}

                {/* Notes (when not in disposition) */}
                {!showDisposition && (
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
                )}

                {/* Disposition Panel */}
                {showDisposition && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-accent/50 rounded-lg p-4 space-y-3"
                  >
                    <h3 className="font-semibold text-foreground text-sm">How did the call go?</h3>

                    {/* Disposition buttons */}
                    <div className="space-y-1">
                      {dispositions.slice(0, 9).map((d, idx) => (
                        <button
                          key={d.id}
                          onClick={() => handleSelectDisposition(d)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 sidebar-transition ${
                            selectedDisp?.id === d.id
                              ? "ring-2 ring-primary bg-primary/10 text-foreground"
                              : "text-foreground hover:bg-accent"
                          }`}
                        >
                          <span className="w-5 h-5 rounded bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: d.color }}
                          />
                          <span className="flex-1">{d.name}</span>
                          {d.requireNotes && <FileText className="w-3 h-3 text-muted-foreground" />}
                          {d.callbackScheduler && <Calendar className="w-3 h-3 text-muted-foreground" />}
                          {selectedDisp?.id === d.id && <CheckCircle className="w-4 h-4 text-primary" />}
                        </button>
                      ))}
                    </div>

                    {/* Required Notes */}
                    {selectedDisp && (
                      <div className="space-y-2">
                        {selectedDisp.requireNotes && (
                          <div className={`rounded-lg border-2 p-0.5 transition-colors ${
                            noteError ? "border-destructive" : "border-primary/40"
                          }`}>
                            <div className="flex items-center gap-1.5 px-2.5 pt-2">
                              <FileText className="w-3 h-3 text-primary" />
                              <span className="text-xs font-medium text-primary">Note required for this disposition</span>
                            </div>
                            <textarea
                              value={callNotes}
                              onChange={e => { setCallNotes(e.target.value); setNoteError(false); }}
                              placeholder="Add notes about this call..."
                              className="w-full px-3 py-2 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
                              rows={3}
                            />
                            <div className="flex items-center justify-between px-3 pb-2">
                              <span className={`text-xs ${
                                callNotes.length >= selectedDisp.minNoteChars ? "text-success" : "text-muted-foreground"
                              }`}>
                                {callNotes.length} / {selectedDisp.minNoteChars} minimum characters
                              </span>
                              {noteError && (
                                <span className="text-xs text-destructive flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" /> Required
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {!selectedDisp.requireNotes && (
                          <textarea
                            value={callNotes}
                            onChange={e => setCallNotes(e.target.value)}
                            placeholder="Add notes about this call (optional)..."
                            className="w-full px-3 py-2 rounded-lg bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                            rows={3}
                          />
                        )}

                        {/* Callback Scheduler */}
                        {showCallback && selectedDisp.callbackScheduler && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3"
                          >
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-primary" />
                              <span className="text-sm font-medium text-foreground">Schedule Callback</span>
                            </div>
                            <p className="text-xs text-muted-foreground">John Martinez</p>

                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !callbackDate && "text-muted-foreground")}>
                                  <Calendar className="mr-2 h-4 w-4" />
                                  {callbackDate ? format(callbackDate, "PPP") : "Pick a date"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0 z-[60]" align="start">
                                <CalendarUI
                                  mode="single"
                                  selected={callbackDate}
                                  onSelect={setCallbackDate}
                                  disabled={(date) => date < new Date()}
                                  initialFocus
                                  className={cn("p-3 pointer-events-auto")}
                                />
                              </PopoverContent>
                            </Popover>

                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Time</label>
                              <select
                                value={callbackTime}
                                onChange={e => setCallbackTime(e.target.value)}
                                className="w-full h-9 px-3 rounded-lg bg-accent text-sm text-foreground border-0 focus:ring-2 focus:ring-primary/50"
                              >
                                {Array.from({ length: 24 }, (_, h) =>
                                  ["00", "30"].map(m => {
                                    const t = `${h.toString().padStart(2, "0")}:${m}`;
                                    const label = `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${m} ${h < 12 ? "AM" : "PM"}`;
                                    return <option key={t} value={t}>{label}</option>;
                                  })
                                )}
                              </select>
                            </div>

                            <button
                              onClick={handleSaveAndNext}
                              disabled={saving || !callbackDate}
                              className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 sidebar-transition disabled:opacity-50"
                            >
                              {saving ? "Saving..." : "Schedule Callback"}
                            </button>
                            <button
                              onClick={handleSkipCallback}
                              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <SkipForward className="w-3 h-3 inline mr-1" /> Skip for Now
                            </button>
                          </motion.div>
                        )}

                        {/* Save & Next (when no callback scheduler or after skip) */}
                        {(!selectedDisp.callbackScheduler || !showCallback) && (
                          <button
                            onClick={handleSaveAndNext}
                            disabled={saving || (selectedDisp.requireNotes && callNotes.length < selectedDisp.minNoteChars)}
                            className={`w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 sidebar-transition disabled:opacity-50 ${
                              noteError ? "animate-shake" : ""
                            }`}
                          >
                            {saving ? "Saving..." : "Save & Next"}
                          </button>
                        )}
                      </div>
                    )}

                    {/* No disposition selected yet */}
                    {!selectedDisp && (
                      <p className="text-xs text-muted-foreground text-center py-1">
                        Select a disposition above or press 1-9
                      </p>
                    )}
                  </motion.div>
                )}

                {/* AI Summary */}
                {showDisposition && (
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-2">
                    <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-primary" /> AI Call Summary
                    </h3>
                    <p className="text-sm text-muted-foreground">Client expressed interest in Term Life policy for family coverage. Discussed premium options and requested a follow-up call next Tuesday.</p>
                    <p className="text-xs text-primary font-medium italic">Suggested: Schedule follow-up appointment for Tuesday</p>
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
