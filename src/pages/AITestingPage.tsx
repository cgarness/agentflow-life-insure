import React, { useCallback, useEffect, useState } from "react";
import { FlaskConical, Phone, PhoneOff, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { AITestingLeadForm } from "@/components/ai-testing/AITestingLeadForm";
import { AITestingDebugPanel, type DebugLogEntry } from "@/components/ai-testing/AITestingDebugPanel";
import {
  APPOINTMENT_SETTING_PROMPT,
  buildLeadContextPayload,
  DEFAULT_TEST_LEAD,
  type LeadContext,
} from "@/lib/aiTestingPrompt";
import { edgeFunctionErrorMessage } from "@/lib/edgeFunctionError";

type VoiceStack = "twilio_cr" | "xai_s2s" | "openai_realtime";

type TranscriptEntry = {
  role: string;
  text: string;
  at: string;
};

type TestSession = {
  id: string;
  stack: VoiceStack;
  status: string;
  transcript: TranscriptEntry[];
  error_message: string | null;
  twilio_call_sid: string | null;
  debug_log: DebugLogEntry[];
  created_at: string | null;
};

const ACTIVE_CALL_STATUSES = ["queued", "placing", "ringing", "in-progress"] as const;

const STACK_OPTIONS: {
  id: VoiceStack;
  label: string;
  description: string;
  recommended?: boolean;
}[] = [
  {
    id: "twilio_cr",
    label: "Twilio + Deepgram + ElevenLabs + OpenAI",
    description:
      "ConversationRelay pipeline — Twilio handles STT/TTS; OpenAI drives the conversation. Best Twilio-native quality.",
    recommended: true,
  },
  {
    id: "xai_s2s",
    label: "xAI Grok Voice",
    description:
      "Speech-to-speech via Media Streams. Most expressive delivery; requires XAI_API_KEY on server.",
  },
  {
    id: "openai_realtime",
    label: "OpenAI Realtime",
    description:
      "Speech-to-speech via Media Streams. Compare OpenAI end-to-end voice against xAI.",
  },
];

const AITestingPage: React.FC = () => {
  const { organizationId } = useOrganization();
  const [stack, setStack] = useState<VoiceStack>("twilio_cr");
  const [prompt, setPrompt] = useState(APPOINTMENT_SETTING_PROMPT);
  const [lead, setLead] = useState<LeadContext>({ ...DEFAULT_TEST_LEAD });
  const [toNumber, setToNumber] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [phoneOptions, setPhoneOptions] = useState<string[]>([]);
  const [placing, setPlacing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<TestSession | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    void (async () => {
      const { data } = await supabase
        .from("phone_numbers")
        .select("phone_number, is_default, status")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .order("is_default", { ascending: false });
      const nums = (data ?? []).map((r) => r.phone_number as string).filter(Boolean);
      setPhoneOptions(nums);
      if (nums.length) setFromNumber((prev) => prev || nums[0]);
    })();
  }, [organizationId]);

  const pollSession = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from("ai_test_sessions")
      .select("id, stack, status, transcript, error_message, twilio_call_sid, debug_log, created_at")
      .eq("id", id)
      .maybeSingle();
    if (!error && data) {
      const row = data as unknown as {
        id: string;
        stack: VoiceStack;
        status: string;
        transcript: TranscriptEntry[] | null;
        error_message: string | null;
        twilio_call_sid: string | null;
        debug_log: DebugLogEntry[] | null;
        created_at: string | null;
      };
      setSession({
        id: row.id,
        stack: row.stack,
        status: row.status,
        transcript: Array.isArray(row.transcript) ? row.transcript : [],
        error_message: row.error_message,
        twilio_call_sid: row.twilio_call_sid,
        debug_log: Array.isArray(row.debug_log) ? row.debug_log : [],
        created_at: row.created_at,
      });
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void pollSession(sessionId);
    const interval = setInterval(() => void pollSession(sessionId), 2000);
    return () => clearInterval(interval);
  }, [sessionId, pollSession]);

  useEffect(() => {
    if (!session) return;
    if (["completed", "failed", "busy", "no-answer", "canceled"].includes(session.status)) {
      setPlacing(false);
    }
  }, [session?.status]);

  const canEndCall =
    Boolean(sessionId) &&
    (placing || (session != null && ACTIVE_CALL_STATUSES.includes(session.status as typeof ACTIVE_CALL_STATUSES[number])));

  const handleEndCall = async () => {
    if (!sessionId) return;
    setEnding(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-testing-end-call", {
        body: { sessionId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error((data?.error as string) ?? "Could not end call");
      toast.success("Call ended");
      setPlacing(false);
      await pollSession(sessionId);
    } catch (err) {
      const msg = await edgeFunctionErrorMessage(err, "Failed to end call");
      toast.error(msg);
    } finally {
      setEnding(false);
    }
  };

  const handlePlaceCall = async () => {
    if (!toNumber.trim() || !fromNumber.trim()) {
      toast.error("Enter both To and From numbers");
      return;
    }
    if (prompt.trim().length < 10) {
      toast.error("Prompt must be at least 10 characters");
      return;
    }

    setPlacing(true);
    setSession(null);
    setSessionId(null);

    try {
      const { data, error } = await supabase.functions.invoke("ai-testing-place-call", {
        body: {
          to: toNumber.trim(),
          from: fromNumber.trim(),
          stack,
          prompt: prompt.trim(),
          lead_context: buildLeadContextPayload(lead),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error((data?.error as string) ?? "Call failed");

      setSessionId(data.sessionId as string);
      toast.success("Test call placed — answer your phone");
      await pollSession(data.sessionId as string);
    } catch (err) {
      const msg = await edgeFunctionErrorMessage(err, "Failed to place call");
      toast.error(msg);
      setPlacing(false);
    }
  };

  const statusLabel = session?.status ?? (placing ? "placing" : "idle");

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex-shrink-0 border-b border-border bg-background px-6 lg:px-8 py-6">
        <div className="max-w-3xl mx-auto flex items-start gap-3">
          <div className="p-2 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <FlaskConical className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI Testing</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Standalone voice lab — place a real outbound call to your phone and compare AI stacks.
              Not connected to contacts, campaigns, or the dialer.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 lg:px-8 py-8 max-w-3xl mx-auto w-full space-y-8">
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-foreground">Voice stack</h2>
          <div className="grid gap-3">
            {STACK_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setStack(opt.id)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  stack === opt.id
                    ? "border-foreground ring-1 ring-foreground bg-accent/40"
                    : "border-border bg-card hover:border-primary/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{opt.label}</span>
                  {opt.recommended && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{opt.description}</p>
              </button>
            ))}
          </div>
        </section>

        <AITestingLeadForm lead={lead} onChange={setLead} />

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium text-foreground">Agent instructions</label>
            <button
              type="button"
              onClick={() => setPrompt(APPOINTMENT_SETTING_PROMPT)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Load appointment-setting prompt
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={14}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono text-[13px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Lead details above are appended automatically — the agent uses them but should not read the list aloud.
          </p>
        </section>

        <section className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Call your number (To)</label>
            <input
              type="tel"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
              placeholder="+1 555 123 4567"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">From (caller ID)</label>
            {phoneOptions.length > 0 ? (
              <select
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {phoneOptions.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            ) : (
              <input
                type="tel"
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                placeholder="+1 agency number"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            )}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handlePlaceCall()}
            disabled={placing || ending}
            className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-6 disabled:opacity-50"
          >
            {placing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
            {placing ? "Calling…" : "Place test call"}
          </button>
          {canEndCall && (
            <button
              type="button"
              onClick={() => void handleEndCall()}
              disabled={ending}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium border border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10 h-10 px-6 disabled:opacity-50"
            >
              {ending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOff className="w-4 h-4" />}
              {ending ? "Ending…" : "End call"}
            </button>
          )}
        </div>

        {session && (
          <AITestingDebugPanel
            entries={session.debug_log ?? []}
            callStartIso={session.created_at}
          />
        )}

        {(session || placing) && (
          <section className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-foreground">Live status</h2>
              <span className="text-xs font-mono uppercase text-muted-foreground">{statusLabel}</span>
            </div>
            {session?.twilio_call_sid && (
              <p className="text-xs text-muted-foreground font-mono">Call SID: {session.twilio_call_sid}</p>
            )}
            {session?.error_message && (
              <p className="text-sm text-destructive">{session.error_message}</p>
            )}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Transcript</h3>
              {session?.transcript?.length ? (
                session.transcript.map((entry, i) => (
                  <div
                    key={`${entry.at}-${i}`}
                    className={`text-sm rounded-md px-3 py-2 ${
                      entry.role === "user" ? "bg-muted" : "bg-primary/10"
                    }`}
                  >
                    <span className="text-[10px] uppercase font-medium text-muted-foreground mr-2">
                      {entry.role}
                    </span>
                    {entry.text}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Answer your phone and start talking — transcript will appear here.
                </p>
              )}
            </div>
          </section>
        )}

        <section className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground space-y-2">
          <p className="font-medium text-foreground">Comparison tips</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Use the same prompt and your cell as To for each stack.</li>
            <li>Note time to first spoken word and how natural interruptions feel.</li>
            <li>Stack A needs Twilio ConversationRelay + ElevenLabs enabled on your account.</li>
            <li>Stacks B/C need XAI_API_KEY and OPENAI_API_KEY set as Edge Function secrets.</li>
          </ul>
        </section>
      </div>
    </div>
  );
};

export default AITestingPage;
