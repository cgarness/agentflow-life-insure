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
import { AITestingStackSelector } from "@/components/ai-testing/AITestingStackSelector";
import { AITestingLiveStatus } from "@/components/ai-testing/AITestingLiveStatus";
import { AITestingPromptEditor } from "@/components/ai-testing/AITestingPromptEditor";
import { AITestingPhoneInputs } from "@/components/ai-testing/AITestingPhoneInputs";
import { AITestingCallButtons } from "@/components/ai-testing/AITestingCallButtons";
import {
  APPOINTMENT_SETTING_PROMPT,
  buildLeadContextPayload,
  DEFAULT_TEST_LEAD,
  type LeadContext,
} from "@/lib/aiTestingPrompt";
import { defaultVoiceFor, type VoiceStack } from "@/lib/aiTestingVoices";
import { DEFAULT_TUNING, PlaceCallFormSchema, type Tuning } from "@/lib/aiTestingFormSchema";

const AITestingPage: React.FC = () => {
  const { organizationId } = useOrganization();
  const [stack, setStack] = useState<VoiceStack>("twilio_cr");
  const [prompt, setPrompt] = useState(APPOINTMENT_SETTING_PROMPT);
  const [lead, setLead] = useState<LeadContext>({ ...DEFAULT_TEST_LEAD });
  const [tuning, setTuning] = useState<Tuning>({ ...DEFAULT_TUNING, voice_id: defaultVoiceFor("twilio_cr") });
  const [toNumber, setToNumber] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [phoneOptions, setPhoneOptions] = useState<string[]>([]);
  const { session, placing, ending, canEndCall, placeCall, endCall } = useAITestingSession();

  useEffect(() => {
    setTuning((t) => ({ ...t, voice_id: defaultVoiceFor(stack) }));
  }, [stack]);

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

  const handlePlaceCall = () => {
    const parsed = PlaceCallFormSchema.safeParse({
      stack, prompt: prompt.trim(), to: toNumber.trim(), from: fromNumber.trim(), tuning,
    });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? "Invalid form");
      return;
    }
    void placeCall({
      to: parsed.data.to,
      from: parsed.data.from,
      stack: parsed.data.stack,
      prompt: parsed.data.prompt,
      lead_context: buildLeadContextPayload(lead),
      voice_id: parsed.data.tuning.voice_id,
      temperature: parsed.data.tuning.temperature,
      speaking_rate: parsed.data.tuning.speaking_rate,
      interruption_sensitivity: parsed.data.tuning.interruption_sensitivity,
    });
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
        <AITestingStackSelector value={stack} onChange={setStack} />
        <AITestingVoicePicker stack={stack} value={tuning.voice_id} onChange={(id) => setTuning({ ...tuning, voice_id: id })} />
        <AITestingTunables stack={stack} value={tuning} onChange={setTuning} />
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
          ending={ending}
          canEndCall={canEndCall}
          onPlace={handlePlaceCall}
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
          />
        )}
      </div>
    </div>
  );
};

export default AITestingPage;
