-- AI Testing: Inworld Realtime speech-to-speech stack (Twilio Media Streams → ai-voice-bridge /twilio/inworld).

ALTER TABLE public.ai_test_sessions
  DROP CONSTRAINT IF EXISTS ai_test_sessions_stack_check;

ALTER TABLE public.ai_test_sessions
  ADD CONSTRAINT ai_test_sessions_stack_check
  CHECK (stack IN (
    'twilio_cr',
    'xai_s2s',
    'openai_realtime',
    'openai_sip',
    'deepgram_voice_agent',
    'hypercheap_voice_agent',
    'pipeline_voice_agent',
    'inworld_realtime_agent'
  ));

COMMENT ON COLUMN public.ai_test_sessions.stack IS
  'Voice stack: twilio_cr | xai_s2s | openai_realtime | openai_sip | deepgram_voice_agent | hypercheap_voice_agent | pipeline_voice_agent | inworld_realtime_agent';

COMMENT ON COLUMN public.ai_test_sessions.tunables IS
  'Per-stack extra tunables (jsonb). hypercheap: max_response_tokens, vad_aggressiveness. pipeline: max_response_tokens. inworld_realtime_agent: tts_model, max_response_tokens, turn_detection_type.';
