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
import { AITestingHypercheapSettings } from "@/components/ai-testing/AITestingHypercheapSettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  APPOINTMENT_SETTING_PROMPT,
  buildLeadContextPayload,
  DEFAULT_TEST_LEAD,
  type LeadContext,
} from "@/lib/aiTestingPrompt";
import { DEFAULT_DEEPGRAM_LLM } from "@/lib/aiTestingDeepgramModels";
import { defaultVoiceFor } from "@/lib/aiTestingVoices";
import {
  DEFAULT_TUNING,
  PlaceDeepgramCallSchema,
  PlaceHypercheapCallSchema,
  PlaceOpenAICallSchema,
  type Tuning,
} from "@/lib/aiTestingFormSchema";
import {
  DEFAULT_HYPERCHEAP_TUNING,
  type HypercheapTuning,
} from "@/lib/aiTestingHypercheap";

const AITestingPage: React.FC = () => {
  const { organizationId } = useOrganization();
  const [prompt, setPrompt] = useState(APPOINTMENT_SETTING_PROMPT);
  const [lead, setLead] = useState<LeadContext>({ ...DEFAULT_TEST_LEAD });
  const [openAiTuning, setOpenAiTuning] = useState<Tuning>({
    ...DEFAULT_TUNING,
    voice_id: defaultVoiceFor("openai_realtime"),
  });
  const [deepgramTuning, setDeepgramTuning] = useState<Tuning>({
    ...DEFAULT_TUNING,
    voice_id: defaultVoiceFor("deepgram_voice_agent"),
  });
  const [deepgramModelId, setDeepgramModelId] = useState(DEFAULT_DEEPGRAM_LLM);
  const [hypercheapTuning, setHypercheapTuning] = useState<HypercheapTuning>({
    ...DEFAULT_HYPERCHEAP_TUNING,
    voice_id: defaultVoiceFor("hypercheap_voice_agent"),
  });
  const [toNumber, setToNumber] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [phoneOptions, setPhoneOptions] = useState<string[]>([]);
  const {
    session,
    placing,
    placingStack,
    ending,
    canEndCall,
    placeOpenAICall,
    placeDeepgramCall,
    placeHypercheapCall,
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

  const sharedCallFields = () => ({
    prompt: prompt.trim(),
    to: toNumber.trim(),
    from: fromNumber.trim(),
    lead_context: buildLeadContextPayload(lead),
  });

  const handlePlaceOpenAI = () => {
    const parsed = PlaceOpenAICallSchema.safeParse({
      stack: "openai_realtime" as const,
      ...sharedCallFields(),
      tuning: openAiTuning,
    });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? "Invalid form");
      return;
    }
    void placeOpenAICall({
      stack: parsed.data.stack,
      prompt: parsed.data.prompt,
      to: parsed.data.to,
      from: parsed.data.from,
      lead_context: buildLeadContextPayload(lead),
      voice_id: parsed.data.tuning.voice_id,
      temperature: parsed.data.tuning.temperature,
      speaking_rate: parsed.data.tuning.speaking_rate,
      interruption_sensitivity: parsed.data.tuning.interruption_sensitivity,
    });
  };

  const handlePlaceDeepgram = () => {
    const parsed = PlaceDeepgramCallSchema.safeParse({
      stack: "deepgram_voice_agent" as const,
      ...sharedCallFields(),
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

  const handlePlaceHypercheap = () => {
    const parsed = PlaceHypercheapCallSchema.safeParse({
      stack: "hypercheap_voice_agent" as const,
      ...sharedCallFields(),
      voice_id: hypercheapTuning.voice_id,
      model_id: hypercheapTuning.model_id,
      temperature: hypercheapTuning.temperature,
      max_response_tokens: hypercheapTuning.max_response_tokens,
      vad_aggressiveness: hypercheapTuning.vad_aggressiveness,
    });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? "Invalid form");
      return;
    }
    void placeHypercheapCall({
      stack: parsed.data.stack,
      prompt: parsed.data.prompt,
      to: parsed.data.to,
      from: parsed.data.from,
      lead_context: buildLeadContextPayload(lead),
      voice_id: parsed.data.voice_id,
      model_id: parsed.data.model_id,
      temperature: parsed.data.temperature,
      max_response_tokens: parsed.data.max_response_tokens,
      vad_aggressiveness: parsed.data.vad_aggressiveness,
    });
  };

  const statusLabel = session?.status ?? (placing ? "placing" : "idle");
  const stackBadge =
    session?.stack === "deepgram_voice_agent"
      ? "Deepgram Voice Agent"
      : session?.stack === "hypercheap_voice_agent"
        ? "Hypercheap (Fennec → OpenRouter → Inworld)"
        : session?.stack === "openai_realtime"
          ? "OpenAI Realtime (Render)"
          : session?.stack ?? null;

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
              Standalone voice lab — compare OpenAI Realtime, Deepgram Voice Agent, and the
              Hypercheap stack (Fennec → OpenRouter → Inworld). Not connected to contacts,
              campaigns, or the dialer.
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
        <section className="rounded-xl border border-border bg-card/50 p-4 space-y-2">
          <h2 className="text-sm font-medium text-foreground">Voice stacks</h2>
          <p className="text-xs text-muted-foreground">
            <strong>OpenAI</strong> — Twilio Media Streams → Render <code className="text-[11px]">/twilio</code> →
            OpenAI Realtime (µ-law). <strong>Deepgram</strong> — same Twilio path → Render{" "}
            <code className="text-[11px]">/twilio/deepgram</code> → Deepgram Voice Agent (STT + LLM + TTS).{" "}
            <strong>Hypercheap</strong> — Twilio path → Python Render bridge{" "}
            <code className="text-[11px]">/twilio/hypercheap</code> → Fennec ASR → OpenRouter LLM →
            Inworld TTS.
          </p>
        </section>

        <div className="space-y-3">
          <h2 className="text-sm font-medium text-foreground">OpenAI call settings</h2>
          <AITestingVoicePicker
            stack="openai_realtime"
            value={openAiTuning.voice_id}
            onChange={(id) => setOpenAiTuning({ ...openAiTuning, voice_id: id })}
          />
          <AITestingTunables
            stack="openai_realtime"
            value={openAiTuning}
            onChange={setOpenAiTuning}
          />
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-medium text-foreground">Deepgram call settings</h2>
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

        <AITestingHypercheapSettings
          value={hypercheapTuning}
          onChange={setHypercheapTuning}
        />

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
          placingStack={placingStack}
          ending={ending}
          canEndCall={canEndCall}
          onPlaceOpenAI={handlePlaceOpenAI}
          onPlaceDeepgram={handlePlaceDeepgram}
          onPlaceHypercheap={handlePlaceHypercheap}
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
            stackLabel={stackBadge}
          />
        )}
          </TabsContent>

          <TabsContent value="billing" className="mt-0">
            <section className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
              <h2 className="text-sm font-medium text-foreground">Per-call cost estimate</h2>
              <AITestingBillingPanel
                session={session}
                prompt={prompt}
                activeCall={canEndCall}
              />
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AITestingPage;
