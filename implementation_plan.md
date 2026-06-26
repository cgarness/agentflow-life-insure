# Implementation Plan — Add OpenAI Realtime (`openai_realtime`) to AI Testing (phone + browser)

**Label:** FEATURE  
**Status:** IMPLEMENTED on branch `claude/ai-testing-openai-realtime` (clean worktree from `origin/main`) — awaiting commit/PR/deploy approval.  
**Date:** 2026-06-25

---

## Summary

Surfaced OpenAI Realtime in the AI Testing tab for phone and browser mic/speaker testing. Phone path reuses existing `ai-testing-place-call` + Render `/twilio` bridge. Browser path adds edge `openai_realtime` support + Render `/browser/openai`.

**No DB migration. No `config.toml` change. No new secrets. No production Dialer changes.**

---

## Files touched

### Frontend
- `src/hooks/useAITestingSession.ts` — `placeOpenAICall`
- `src/pages/AITestingPage.tsx` — OpenAI tuning, handlers, `renderStackSettings()`, copy
- `src/components/ai-testing/AITestingPhoneSection.tsx` — `onPlaceOpenAI`
- `src/components/ai-testing/AITestingCallButtons.tsx` — OpenAI phone button
- `src/components/ai-testing/AITestingStackPicker.tsx` — third stack card
- `src/lib/aiTestingFormSchema.ts` — `StartBrowserOpenAISchema`

### Supabase Edge
- `supabase/functions/_shared/aiTestingBridgeToken.ts` — `buildBrowserOpenAIStreamUrl`
- `supabase/functions/ai-testing-start-browser-session/index.ts` — `openai_realtime` stack

### Render ai-voice-bridge
- `services/ai-voice-bridge/src/bridge.ts` — export OpenAI helpers (behavior-preserving)
- `services/ai-voice-bridge/src/browserOpenAIBridge.ts` — **NEW**
- `services/ai-voice-bridge/src/index.ts` — `/browser/openai` route
- `services/ai-voice-bridge/src/config.ts` — `requireOpenAiKey`

### Confirmed unchanged
- `src/lib/aiTestingVoices.ts` — `openai_realtime` catalog already present

---

## Verification (local)

- `./node_modules/.bin/tsc --noEmit` (repo root) — clean
- `services/ai-voice-bridge` `./node_modules/.bin/tsc --noEmit` — clean
- ESLint on touched frontend files — 0 errors (1 pre-existing exhaustive-deps warning in hook)

---

## Deployment (NOT executed — Chris approval required)

### Render `ai-voice-bridge`
Merge + deploy the branch (Render auto-deploy from `main`, or manual deploy of `ai-voice-bridge` service). After deploy, verify:
```bash
curl -s https://ai-voice-bridge-ouez.onrender.com/ready | jq '.paths'
```
Expect `/browser/openai` in `paths`.

### Supabase Edge
```bash
cd /path/to/agentflow-openai-realtime
npx supabase functions deploy ai-testing-start-browser-session --project-ref jncvvsvckxhqgqvkppmj
```
(`verify_jwt=false` already set in `config.toml`; Super Admin auth in-function unchanged.)

### Vercel
Auto-deploy from merge to `main` (frontend changes only).

---

## Human smoke-test checklist

- Super Admin → AI Testing → select OpenAI Realtime → Start browser test → mic → greeting → barge-in clears playback → transcript/debug updates → Stop → session completes
- Place OpenAI phone test → phone rings → bridge connects → greeting → End call
- Regression: Deepgram + Inworld browser and phone buttons still work
