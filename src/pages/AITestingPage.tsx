import React, { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAITestingSession } from "@/hooks/useAITestingSession";
import { toast } from "sonner";
import { AITestingLeadForm } from "@/components/ai-testing/AITestingLeadForm";
import { AITestingDebugPanel } from "@/components/ai-testing/AITestingDebugPanel";
import { AITestingVoicePicker } from "@/components/ai-testing/AITestingVoicePicker";
import { AITestingTunables } from "@/components/ai-testing/AITestingTunables";
import { AITestingLiveStatus } from "@/components/ai-testing/AITestingLiveStatus";
import { AITestingPromptEditor } from "@/components/ai-testing/AITestingPromptEditor";
import { AITestingPhoneInputs } from "@/components/ai-testing/AITestingPhoneInputs";
import { AITestingCallButtons } from "@/components/ai-testing/AITestingCallButtons";
import { AITestingBillingPanel } from "@/components/ai-testing/AITestingBillingPanel";
import { AITestingDeepgramLlmPicker } from "@/components/ai-testing/AITestingDeepgramLlmPicker";
import { AITestingInworldSettings } from "@/components/ai-testing/AITestingInworldSettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  APPOINTMENT_SETTING_PROMPT,
  buildLeadContextPayload,
  DEFAULT_TEST_LEAD,
  type LeadContext,
} from "@/lib/aiTestingPrompt";
import { DEFAULT_DEEPGRAM_LLM } from "@/lib/aiTestingDeepgramModels";
import { DEFAULT_INWORLD_TUNING } from "@/lib/aiTestingInworld";
import { defaultVoiceFor } from "@/lib/aiTestingVoices";
import {
  DEFAULT_TUNING,
  PlaceDeepgramCallSchema,
  PlaceInworldCallSchema,
  type Tuning,
} from "@/lib/aiTestingFormSchema";

const AITestingPage: React.FC = () => {
  const { organizationId } = useOrganization();
  const [prompt, setPrompt] = useState(APPOINTMENT_SETTING_PROMPT);
  const [lead, setLead] = useState<LeadContext>({ ...DEFAULT_TEST_LEAD });
  const [deepgramTuning, setDeepgramTuning] = useState<Tuning>({
    ...DEFAULT_TUNING,
    voice_id: defaultVoiceFor("deepgram_voice_agent"),
  });
  const [deepgramModelId, setDeepgramModelId] = useState(DEFAULT_DEEPGRAM_LLM);
  const [inworldTuning, setInworldTuning] = useState(DEFAULT_INWORLD_TUNING);
  const [toNumber, setToNumber] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [phoneOptions, setPhoneOptions] = useState<string[]>([]);
  const {
    session,
    placing,
    placingStack,
    ending,
    canEndCall,
    placeDeepgramCall,
    placeInworldCall,
    endCall,
  } = useAITestingSession();

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

  const handlePlaceDeepgram = () => {
    const parsed = PlaceDeepgramCallSchema.safeParse({
      stack: "deepgram_voice_agent" as const,
      prompt: prompt.trim(),
      to: toNumber.trim(),
      from: fromNumber.trim(),
      tuning: deepgramTuning,
      model_id: deepgramModelId,
    });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? "Invalid form");
      return;
    }
    void placeDeepgramCall({
      stack: parsed.data.stack,
      prompt: parsed.data.prompt,
      to: parsed.data.to,
      from: parsed.data.from,
      lead_context: buildLeadContextPayload(lead),
      voice_id: parsed.data.tuning.voice_id,
      temperature: parsed.data.tuning.temperature,
      speaking_rate: parsed.data.tuning.speaking_rate,
      interruption_sensitivity: parsed.data.tuning.interruption_sensitivity,
      model_id: parsed.data.model_id,
    });
  };

  const handlePlaceInworld = () => {
    const parsed = PlaceInworldCallSchema.safeParse({
      stack: "inworld_realtime_agent" as const,
      prompt: prompt.trim(),
      to: toNumber.trim(),
      from: fromNumber.trim(),
      voice_id: inworldTuning.voice_id,
      model_id: inworldTuning.model_id,
      tts_model: inworldTuning.tts_model,
      temperature: inworldTuning.temperature,
      max_response_tokens: inworldTuning.max_response_tokens,
      interruption_sensitivity: inworldTuning.interruption_sensitivity,
    });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? "Invalid form");
      return;
    }
    void placeInworldCall({
      stack: parsed.data.stack,
      prompt: parsed.data.prompt,
      to: parsed.data.to,
      from: parsed.data.from,
      lead_context: buildLeadContextPayload(lead),
      voice_id: parsed.data.voice_id,
      model_id: parsed.data.model_id,
      tts_model: parsed.data.tts_model,
      temperature: parsed.data.temperature,
      max_response_tokens: parsed.data.max_response_tokens,
      interruption_sensitivity: parsed.data.interruption_sensitivity,
    });
  };

  const statusLabel = session?.status ?? (placing ? "placing" : "idle");
  const stackLabel =
    session?.stack === "inworld_realtime_agent"
      ? "Inworld Realtime Voice Agent"
      : session?.stack === "deepgram_voice_agent"
        ? "Deepgram Voice Agent"
        : session?.stack ?? (placingStack ?? "idle");

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
              Compare Deepgram Voice Agent vs Inworld Realtime on Twilio Media
              Streams (Render <code className="text-[11px]">ai-voice-bridge</code>). Not connected to
              campaigns or the production dialer.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 lg:px-8 py-8 max-w-3xl mx-auto w-full">
        <Tabs defaultValue="test" className="space-y-8">
          <TabsList>
            <TabsTrigger value="test">Test</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
          </TabsList>

          <TabsContent value="test" className="space-y-8 mt-0">
            <section className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-2">
              <h2 className="text-sm font-medium text-foreground">Deepgram Voice Agent</h2>
              <p className="text-xs text-muted-foreground">
                One managed WebSocket to Deepgram (Flux STT + LLM + Aura TTS). Path{" "}
                <code className="text-[10px]">/twilio/deepgram</code>.
              </p>
            </section>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-foreground">Deepgram call settings</h3>
              <AITestingVoicePicker
                stack="deepgram_voice_agent"
                value={deepgramTuning.voice_id}
                onChange={(id) => setDeepgramTuning({ ...deepgramTuning, voice_id: id })}
              />
              <AITestingDeepgramLlmPicker value={deepgramModelId} onChange={setDeepgramModelId} />
              <AITestingTunables
                stack="deepgram_voice_agent"
                value={deepgramTuning}
                onChange={setDeepgramTuning}
              />
            </div>

            <AITestingInworldSettings value={inworldTuning} onChange={setInworldTuning} />

            <AITestingLeadForm lead={lead} onChange={setLead} />
            <AITestingPromptEditor
              value={prompt}
              onChange={setPrompt}
              onLoadDefault={() => setPrompt(APPOINTMENT_SETTING_PROMPT)}
            />
            <AITestingPhoneInputs
              to={toNumber}
              from={fromNumber}
              phoneOptions={phoneOptions}
              onChangeTo={setToNumber}
              onChangeFrom={setFromNumber}
            />
            <AITestingCallButtons
              placing={placing}
              placingStack={placingStack}
              ending={ending}
              canEndCall={canEndCall}
              onPlaceDeepgram={handlePlaceDeepgram}
              onPlaceInworld={handlePlaceInworld}
              onEnd={() => void endCall()}
            />

            <AITestingDebugPanel
              entries={session?.debug_log ?? []}
              callStartIso={session?.created_at ?? null}
            />
            {(session || placing) && (
              <AITestingLiveStatus
                status={statusLabel}
                callSid={session?.twilio_call_sid}
                errorMessage={session?.error_message}
                transcript={session?.transcript ?? []}
                stackLabel={stackLabel}
              />
            )}
          </TabsContent>

          <TabsContent value="billing" className="mt-0">
            <section className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
              <h2 className="text-sm font-medium text-foreground">Per-call cost estimate</h2>
              <AITestingBillingPanel session={session} prompt={prompt} activeCall={canEndCall} />
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AITestingPage;
