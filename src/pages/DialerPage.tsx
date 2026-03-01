import React, { useState, useEffect } from "react";
import {
  Phone, PhoneOff, Mic, MicOff, Pause, Play, Voicemail,
  Clock, ChevronDown, Pin, Plus, Calendar, Eye,
  FileText, AlertCircle, CheckCircle, SkipForward,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { dispositionsApi } from "@/lib/mock-api";
import { Disposition } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const sessionStats = [
  { label: "Session Duration", value: "01:23:45" },
  { label: "Calls Made", value: "12" },
  { label: "Connected", value: "5" },
  { label: "Answer Rate", value: "42%" },
  { label: "Policies Sold", value: "1" },
  { label: "Avg Duration", value: "3:24" },
];

const leadQueue = [
  { name: "John D.", state: "FL", age: 34, source: "Facebook Ads", attempts: 0, active: true },
  { name: "Sarah W.", state: "TX", age: 45, source: "Direct Mail", attempts: 1, active: false },
  { name: "Mike P.", state: "CA", age: 52, source: "Google Ads", attempts: 0, active: false },
  { name: "Lisa K.", state: "NY", age: 38, source: "Referral", attempts: 2, active: false },
  { name: "Tom H.", state: "OH", age: 41, source: "Webinar", attempts: 0, active: false },
];

const scriptSections = ["Introduction", "Needs Analysis", "Presentation", "Close"];

const callHistory = [
  { date: "Yesterday", disposition: "Interested", duration: "4:12", notes: "Wants info on Term Life" },
  { date: "3 days ago", disposition: "Left Voicemail", duration: "0:32", notes: "" },
];

const DialerPage: React.FC = () => {
  const [onCall, setOnCall] = useState(false);
  const [showDisposition, setShowDisposition] = useState(false);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [selectedDisp, setSelectedDisp] = useState<Disposition | null>(null);
  const [callNotes, setCallNotes] = useState("");
  const [noteError, setNoteError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCallback, setShowCallback] = useState(false);
  const [callbackDate, setCallbackDate] = useState<Date | undefined>(undefined);
  const [callbackTime, setCallbackTime] = useState("10:00");
  const [callSeconds, setCallSeconds] = useState(0);

  useEffect(() => {
    dispositionsApi.getAll().then(setDispositions).catch(() => {});
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (onCall) {
      timer = setInterval(() => setCallSeconds(s => s + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [onCall]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

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
    if (!selectedDisp) return;
    if (selectedDisp.requireNotes && callNotes.length < selectedDisp.minNoteChars) {
      setNoteError(true);
      return;
    }
    setSaving(true);
    await new Promise(r => setTimeout(r, 400));

    if (selectedDisp.callbackScheduler && callbackDate) {
      toast({ title: "Callback scheduled", description: `${format(callbackDate, "MMM d, yyyy")} at ${callbackTime}` });
    }
    toast({ title: `Disposition saved: ${selectedDisp.name}` });

    setShowDisposition(false);
    setSelectedDisp(null);
    setCallNotes("");
    setCallSeconds(0);
    setSaving(false);
  };

  const handleSkipCallback = () => {
    toast({ title: "No callback scheduled", description: "No callback scheduled for John D.", variant: "destructive" });
    setShowCallback(false);
  };

  // Keyboard shortcuts for dispositions
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
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Dialer</h1>

      {/* Session Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {sessionStats.map((s) => (
          <div key={s.label} className="bg-card rounded-lg border p-3 text-center">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-lg font-bold font-mono text-foreground mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Three Panel Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left Panel - Queue */}
        <div className="bg-card rounded-xl border p-4 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Campaign</label>
            <button className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-accent text-sm text-foreground">
              Q1 Facebook Leads <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Power Dialer</span>
            <span className="text-xs text-muted-foreground">47 remaining</span>
          </div>
          <div className="space-y-2">
            {leadQueue.map((l, i) => (
              <div key={i} className={`rounded-lg p-3 sidebar-transition ${l.active ? "bg-primary/10 border border-primary/30" : "bg-accent/50 hover:bg-accent"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-foreground">{l.name}</span>
                  <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded">{l.state}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">Age {l.age}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">{l.source}</span>
                </div>
                <div className="flex items-center gap-1 mt-1.5">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className={`w-1.5 h-1.5 rounded-full ${j < l.attempts ? "bg-primary" : "bg-muted"}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="flex-1 py-2 rounded-lg bg-warning/10 text-warning text-sm font-medium hover:bg-warning/20 sidebar-transition">Pause</button>
            <button className="flex-1 py-2 rounded-lg bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 sidebar-transition">End</button>
          </div>
        </div>

        {/* Center Panel - Call */}
        <div className="lg:col-span-2 bg-card rounded-xl border p-6 space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-foreground">John D.</h2>
            <p className="text-muted-foreground font-mono">(555) 123-4567</p>
            <div className="flex items-center justify-center gap-2">
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Florida</span>
              <span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">Age 34</span>
            </div>
            <div className="flex justify-center">
              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${onCall ? "bg-primary/10 text-primary" : showDisposition ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                <span className={`w-2 h-2 rounded-full ${onCall ? "bg-primary animate-pulse" : showDisposition ? "bg-warning" : "bg-success"}`} />
                {onCall ? "On Call" : showDisposition ? "Wrap Up" : "Ready"}
              </span>
            </div>
          </div>

          {/* Call Controls */}
          {!onCall && !showDisposition ? (
            <button onClick={() => { setOnCall(true); setCallSeconds(0); }} className="w-full py-4 rounded-xl bg-success text-success-foreground font-bold text-lg flex items-center justify-center gap-2 hover:bg-success/90 sidebar-transition">
              <Phone className="w-6 h-6" /> Call
            </button>
          ) : onCall ? (
            <div className="space-y-4">
              <div className="text-center">
                <span className="text-3xl font-mono font-bold text-foreground">{formatTime(callSeconds)}</span>
              </div>
              <button onClick={handleHangUp} className="w-full py-4 rounded-xl bg-destructive text-destructive-foreground font-bold text-lg flex items-center justify-center gap-2 hover:bg-destructive/90 sidebar-transition">
                <PhoneOff className="w-6 h-6" /> Hang Up
              </button>
              <div className="flex items-center justify-center gap-3">
                <button className="w-12 h-12 rounded-xl bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition"><Mic className="w-5 h-5" /></button>
                <button className="w-12 h-12 rounded-xl bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition"><Pause className="w-5 h-5" /></button>
                <button className="w-12 h-12 rounded-xl bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition"><Voicemail className="w-5 h-5" /></button>
              </div>
            </div>
          ) : null}

          {/* Disposition Panel — in center panel */}
          <AnimatePresence>
            {showDisposition && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="bg-accent/50 rounded-xl p-5 space-y-4"
              >
                <h3 className="font-semibold text-foreground">How did the call go?</h3>
                <p className="text-xs text-muted-foreground">Select a disposition or press 1–9</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {dispositions.slice(0, 9).map((d, idx) => (
                    <button
                      key={d.id}
                      onClick={() => handleSelectDisposition(d)}
                      className={`text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 sidebar-transition ${
                        selectedDisp?.id === d.id
                          ? "ring-2 ring-primary bg-primary/10 text-foreground"
                          : "text-foreground hover:bg-accent bg-card"
                      }`}
                    >
                      <span className="w-5 h-5 rounded bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="w-3 h-3 rounded-full shrink-0 border border-black/10" style={{ backgroundColor: d.color }} />
                      <span className="flex-1 truncate">{d.name}</span>
                      {d.requireNotes && <FileText className="w-3 h-3 text-muted-foreground shrink-0" />}
                      {d.callbackScheduler && <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />}
                      {selectedDisp?.id === d.id && <CheckCircle className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>

                {selectedDisp && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                    {/* Required notes */}
                    {selectedDisp.requireNotes ? (
                      <div className={`rounded-lg border-2 transition-colors ${noteError ? "border-destructive animate-shake" : "border-primary/40"}`}>
                        <div className="flex items-center gap-1.5 px-3 pt-2.5">
                          <FileText className="w-3.5 h-3.5 text-primary" />
                          <span className="text-xs font-medium text-primary">Note required for this disposition</span>
                        </div>
                        <textarea
                          value={callNotes}
                          onChange={e => { setCallNotes(e.target.value); setNoteError(false); }}
                          placeholder="Add notes about this call..."
                          className="w-full px-3 py-2 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
                          rows={3}
                        />
                        <div className="flex items-center justify-between px-3 pb-2.5">
                          <span className={`text-xs ${callNotes.length >= selectedDisp.minNoteChars ? "text-success" : "text-muted-foreground"}`}>
                            {callNotes.length} / {selectedDisp.minNoteChars} minimum characters
                          </span>
                          {noteError && (
                            <span className="text-xs text-destructive flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> Please add at least {selectedDisp.minNoteChars} characters
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
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
                        className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3"
                      >
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium text-foreground">Schedule Callback</span>
                        </div>
                        <p className="text-xs text-muted-foreground">John D. · {callNotes ? `"${callNotes.slice(0, 50)}..."` : "No notes"}</p>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Date</label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className={cn("w-full justify-start text-left font-normal", !callbackDate && "text-muted-foreground")}>
                                  <Calendar className="mr-1.5 h-3.5 w-3.5" />
                                  {callbackDate ? format(callbackDate, "MMM d") : "Pick date"}
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
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Time</label>
                            <select
                              value={callbackTime}
                              onChange={e => setCallbackTime(e.target.value)}
                              className="w-full h-9 px-2 rounded-lg bg-accent text-sm text-foreground border focus:ring-2 focus:ring-primary/50"
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
                          className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                        >
                          <SkipForward className="w-3 h-3 inline mr-1" /> Skip for Now
                        </button>
                      </motion.div>
                    )}

                    {/* Save & Next */}
                    {(!selectedDisp.callbackScheduler || !showCallback) && (
                      <button
                        onClick={handleSaveAndNext}
                        disabled={saving || (selectedDisp.requireNotes && callNotes.length < selectedDisp.minNoteChars)}
                        className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 sidebar-transition disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Save & Next Contact"}
                      </button>
                    )}
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Script (when not in disposition) */}
          {!showDisposition && (
            <>
              <div className="bg-accent/50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-foreground text-sm">Call Script</h3>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Term Life</span>
                </div>
                <div className="flex gap-1 border-b pb-2">
                  {scriptSections.map((s, i) => (
                    <button key={s} className={`px-3 py-1 rounded-md text-xs font-medium sidebar-transition ${i === 0 ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{s}</button>
                  ))}
                </div>
                <div className="text-sm text-muted-foreground space-y-2 max-h-40 overflow-y-auto">
                  <p>"Hi, this is [Your Name] from AgentFlow Insurance. I'm reaching out because you recently expressed interest in learning more about life insurance options. Is this a good time to chat for a few minutes?"</p>
                  <p className="text-xs text-primary font-medium italic">If yes, continue. If no, schedule callback.</p>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Pin className="w-4 h-4 text-primary" /> Pinned Notes</h3>
                <div className="bg-accent/50 rounded-lg p-3 text-sm text-muted-foreground">Has 2 kids, wife is a teacher. Interested in 20-year term policy.</div>
                <div className="flex gap-2">
                  <input type="text" placeholder="Add a quick note..." className="flex-1 px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  <button className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"><Plus className="w-4 h-4" /></button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right Panel - Details */}
        <div className="space-y-4">
          <div className="bg-card rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold text-foreground text-sm">Contact Details</h3>
            {[
              ["Full Name", "John Doe Martinez"],
              ["Phone", "(555) 123-4567"],
              ["Email", "john.m@email.com"],
              ["State", "Florida"],
              ["Age", "34"],
              ["Lead Source", "Facebook Ads"],
              ["Status", "Interested"],
              ["Assigned", "Chris G."],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{k}</span>
                <span className="text-foreground font-medium">{v}</span>
              </div>
            ))}
          </div>

          <div className="bg-card rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold text-foreground text-sm">Disposition History</h3>
            {callHistory.map((c, i) => (
              <div key={i} className="text-sm border-b last:border-0 pb-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{c.date}</span>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{c.disposition}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{c.duration} · {c.notes || "No notes"}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button className="flex-1 py-2 rounded-lg bg-accent text-foreground text-sm font-medium hover:bg-accent/80 sidebar-transition flex items-center justify-center gap-1"><Calendar className="w-4 h-4" /> Schedule</button>
            <button className="flex-1 py-2 rounded-lg bg-accent text-foreground text-sm font-medium hover:bg-accent/80 sidebar-transition flex items-center justify-center gap-1"><Eye className="w-4 h-4" /> Full View</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DialerPage;
