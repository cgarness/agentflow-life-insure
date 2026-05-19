import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { edgeFunctionErrorMessage } from "@/lib/edgeFunctionError";
import type { DebugLogEntry } from "@/components/ai-testing/AITestingDebugPanel";
import type { TranscriptEntry } from "@/components/ai-testing/AITestingLiveStatus";
import type { VoiceStack } from "@/lib/aiTestingVoices";

export type TestSession = {
  id: string;
  stack: VoiceStack;
  status: string;
  transcript: TranscriptEntry[];
  error_message: string | null;
  twilio_call_sid: string | null;
  debug_log: DebugLogEntry[];
  created_at: string | null;
};

const ACTIVE_CALL_STATUSES = ["queued", "placing", "ringing", "in-progress"];
const TERMINAL_STATUSES = ["completed", "failed", "busy", "no-answer", "canceled"];

export function useAITestingSession() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<TestSession | null>(null);
  const [placing, setPlacing] = useState(false);
  const [ending, setEnding] = useState(false);

  const poll = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("ai_test_sessions")
      .select("id, stack, status, transcript, error_message, twilio_call_sid, debug_log, created_at")
      .eq("id", id)
      .maybeSingle();
    if (data) {
      setSession({
        id: data.id,
        stack: data.stack as VoiceStack,
        status: data.status,
        transcript: Array.isArray(data.transcript) ? (data.transcript as TranscriptEntry[]) : [],
        error_message: data.error_message,
        twilio_call_sid: data.twilio_call_sid,
        debug_log: Array.isArray(data.debug_log) ? (data.debug_log as DebugLogEntry[]) : [],
        created_at: data.created_at,
      });
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void poll(sessionId);
    const interval = setInterval(() => void poll(sessionId), 2000);
    return () => clearInterval(interval);
  }, [sessionId, poll]);

  useEffect(() => {
    if (session && TERMINAL_STATUSES.includes(session.status)) setPlacing(false);
  }, [session?.status]);

  const placeCall = useCallback(async (body: Record<string, unknown>) => {
    setPlacing(true);
    setSession(null);
    setSessionId(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-testing-place-call", { body });
      if (error) throw error;
      if (!data?.success) throw new Error((data?.error as string) ?? "Call failed");
      setSessionId(data.sessionId as string);
      toast.success("Test call placed — answer your phone");
      await poll(data.sessionId as string);
    } catch (err) {
      toast.error(await edgeFunctionErrorMessage(err, "Failed to place call"));
      setPlacing(false);
    }
  }, [poll]);

  const endCall = useCallback(async () => {
    if (!sessionId) return;
    setEnding(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-testing-end-call", { body: { sessionId } });
      if (error) throw error;
      if (!data?.success) throw new Error((data?.error as string) ?? "Could not end call");
      toast.success("Call ended");
      setPlacing(false);
      await poll(sessionId);
    } catch (err) {
      toast.error(await edgeFunctionErrorMessage(err, "Failed to end call"));
    } finally {
      setEnding(false);
    }
  }, [sessionId, poll]);

  const canEndCall =
    Boolean(sessionId) &&
    (placing || (session != null && ACTIVE_CALL_STATUSES.includes(session.status)));

  return { sessionId, session, placing, ending, canEndCall, placeCall, endCall };
}
