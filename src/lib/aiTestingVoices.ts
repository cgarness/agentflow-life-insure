/**
 * Voice catalog for AI Testing lab. Per-stack lists with provider-specific IDs.
 *
 * Stack A (twilio_cr): id is the ElevenLabs voice name passed as the `voice`
 *   attribute on the <ConversationRelay> TwiML element.
 * Stack B (xai_s2s):   id is the xAI Grok voice name (limited / experimental — xAI
 *   has not publicly enumerated voices; entries below are a best-effort short
 *   list and degrade gracefully if the upstream rejects the value).
 * Stack C (openai_realtime): id is the OpenAI Realtime voice name.
 */
export type VoiceGender = "male" | "female" | "neutral";

export type VoiceEntry = {
  id: string;
  label: string;
  gender: VoiceGender;
  accent: string;
  preview_url?: string;
};

export type VoiceStack =
  | "twilio_cr"
  | "xai_s2s"
  | "openai_realtime"
  | "openai_sip"
  | "deepgram_voice_agent"
  | "hypercheap_voice_agent"
  | "pipeline_voice_agent";

export const VOICE_CATALOG: Record<VoiceStack, VoiceEntry[]> = {
  // ConversationRelay + ElevenLabs voices. IDs are the ElevenLabs voice
  // names ConversationRelay accepts in the `voice` attribute.
  twilio_cr: [
    { id: "Rachel", label: "Rachel", gender: "female", accent: "American" },
    { id: "Bella", label: "Bella", gender: "female", accent: "American" },
    { id: "Elli", label: "Elli", gender: "female", accent: "American" },
    { id: "Adam", label: "Adam", gender: "male", accent: "American" },
    { id: "Antoni", label: "Antoni", gender: "male", accent: "American" },
    { id: "Josh", label: "Josh", gender: "male", accent: "American" },
    { id: "Sam", label: "Sam", gender: "male", accent: "American" },
    { id: "Domi", label: "Domi", gender: "female", accent: "American" },
  ],
  // xAI Grok Voice — experimental. Names follow xAI's documented voice slugs
  // at time of writing; if the API rejects a value the bridge will surface
  // the upstream error in debug_log without crashing.
  xai_s2s: [
    { id: "eve", label: "Eve", gender: "female", accent: "American" },
    { id: "ara", label: "Ara", gender: "female", accent: "American" },
    { id: "alec", label: "Alec", gender: "male", accent: "American" },
    { id: "ben", label: "Ben", gender: "male", accent: "American" },
  ],
  // OpenAI Realtime (Media Streams or SIP) — built-in voices per OpenAI docs.
  openai_realtime: [
    { id: "alloy", label: "Alloy", gender: "neutral", accent: "American" },
    { id: "ash", label: "Ash", gender: "male", accent: "American" },
    { id: "ballad", label: "Ballad", gender: "male", accent: "British" },
    { id: "coral", label: "Coral", gender: "female", accent: "American" },
    { id: "echo", label: "Echo", gender: "male", accent: "American" },
    { id: "sage", label: "Sage", gender: "female", accent: "American" },
    { id: "shimmer", label: "Shimmer", gender: "female", accent: "American" },
    { id: "verse", label: "Verse", gender: "male", accent: "American" },
  ],
  deepgram_voice_agent: [
    { id: "aura-2-thalia-en", label: "Thalia (Aura 2)", gender: "female", accent: "American" },
    { id: "aura-2-andromeda-en", label: "Andromeda (Aura 2)", gender: "female", accent: "American" },
    { id: "aura-2-helios-en", label: "Helios (Aura 2)", gender: "male", accent: "American" },
    { id: "aura-2-orion-en", label: "Orion (Aura 2)", gender: "male", accent: "American" },
    { id: "aura-2-luna-en", label: "Luna (Aura 2)", gender: "female", accent: "American" },
    { id: "aura-2-stella-en", label: "Stella (Aura 2)", gender: "female", accent: "American" },
    { id: "aura-2-arcas-en", label: "Arcas (Aura 2)", gender: "male", accent: "American" },
  ],
  openai_sip: [
    { id: "alloy", label: "Alloy", gender: "neutral", accent: "American" },
    { id: "ash", label: "Ash", gender: "male", accent: "American" },
    { id: "ballad", label: "Ballad", gender: "male", accent: "British" },
    { id: "coral", label: "Coral", gender: "female", accent: "American" },
    { id: "echo", label: "Echo", gender: "male", accent: "American" },
    { id: "sage", label: "Sage", gender: "female", accent: "American" },
    { id: "shimmer", label: "Shimmer", gender: "female", accent: "American" },
    { id: "verse", label: "Verse", gender: "male", accent: "American" },
  ],
  // Inworld TTS (inworld-tts-1) voice ids. The bridge default (INWORLD_VOICE_ID on
  // Render) is authoritative when the UI sends an empty voice; otherwise the
  // selected id is passed straight through. Full selectable catalog per Chris.
  pipeline_voice_agent: [
    { id: "Ashley", label: "Ashley (Inworld)", gender: "female", accent: "American" },
    { id: "Olivia", label: "Olivia (Inworld)", gender: "female", accent: "American" },
    { id: "Elizabeth", label: "Elizabeth (Inworld)", gender: "female", accent: "American" },
    { id: "Sarah", label: "Sarah (Inworld)", gender: "female", accent: "American" },
    { id: "Julia", label: "Julia (Inworld)", gender: "female", accent: "American" },
    { id: "Deborah", label: "Deborah (Inworld)", gender: "female", accent: "American" },
    { id: "Wendy", label: "Wendy (Inworld)", gender: "female", accent: "American" },
    { id: "Pixie", label: "Pixie (Inworld)", gender: "female", accent: "American" },
    { id: "Mark", label: "Mark (Inworld)", gender: "male", accent: "American" },
    { id: "Hades", label: "Hades (Inworld)", gender: "male", accent: "American" },
    { id: "Dennis", label: "Dennis (Inworld)", gender: "male", accent: "American" },
    { id: "Ronald", label: "Ronald (Inworld)", gender: "male", accent: "American" },
    { id: "Theodore", label: "Theodore (Inworld)", gender: "male", accent: "American" },
    { id: "Timothy", label: "Timothy (Inworld)", gender: "male", accent: "American" },
    { id: "Craig", label: "Craig (Inworld)", gender: "male", accent: "American" },
    { id: "Edward", label: "Edward (Inworld)", gender: "male", accent: "American" },
  ],
  hypercheap_voice_agent: [
    { id: "Ashley", label: "Ashley (Inworld)", gender: "female", accent: "American" },
    { id: "Olivia", label: "Olivia (Inworld)", gender: "female", accent: "American" },
    { id: "Elizabeth", label: "Elizabeth (Inworld)", gender: "female", accent: "American" },
    { id: "Sarah", label: "Sarah (Inworld)", gender: "female", accent: "American" },
    { id: "Julia", label: "Julia (Inworld)", gender: "female", accent: "American" },
    { id: "Deborah", label: "Deborah (Inworld)", gender: "female", accent: "American" },
    { id: "Wendy", label: "Wendy (Inworld)", gender: "female", accent: "American" },
    { id: "Pixie", label: "Pixie (Inworld)", gender: "female", accent: "American" },
    { id: "Mark", label: "Mark (Inworld)", gender: "male", accent: "American" },
    { id: "Hades", label: "Hades (Inworld)", gender: "male", accent: "American" },
    { id: "Dennis", label: "Dennis (Inworld)", gender: "male", accent: "American" },
    { id: "Ronald", label: "Ronald (Inworld)", gender: "male", accent: "American" },
    { id: "Theodore", label: "Theodore (Inworld)", gender: "male", accent: "American" },
    { id: "Timothy", label: "Timothy (Inworld)", gender: "male", accent: "American" },
    { id: "Craig", label: "Craig (Inworld)", gender: "male", accent: "American" },
    { id: "Edward", label: "Edward (Inworld)", gender: "male", accent: "American" },
  ],
};

export function defaultVoiceFor(stack: VoiceStack): string {
  return VOICE_CATALOG[stack][0]?.id ?? "";
}

export function findVoice(stack: VoiceStack, id: string | null | undefined): VoiceEntry | null {
  if (!id) return null;
  return VOICE_CATALOG[stack].find((v) => v.id === id) ?? null;
}
