# Implementation Plan — HOTFIX: OpenAI Realtime `speaking_rate` → `audio.output.speed`

**Label:** HOTFIX  
**Status:** IMPLEMENTED — branch pending commit/PR; awaiting merge/deploy approval.  
**Date:** 2026-06-26  
**Context:** PR #327 merged (`16ab116`); Render `ai-voice-bridge` + edge `ai-testing-start-browser-session` deployed. OpenAI voice quality good; speaking-rate slider has no audible effect.

---

## 1. Root cause

**Backend (primary):** `buildRealtimeAudioConfig()` in `services/ai-voice-bridge/src/bridge.ts` sets `audio.output.format` and `audio.output.voice` only — it never sends `audio.output.speed`. `connectOpenAiUpstream()` calls it without passing `cfg.speed`, even though both phone (`attachTwilioBridge`) and browser (`browserOpenAIBridge`) already populate `UpstreamConfig.speed` from `session.speaking_rate`.

**Greeting (secondary):** Phone `fireInitialGreetingIfReady()` and browser `fireGreeting()` send `response.create` with a hand-built `audio.output` block (format + voice only, no `speed`). The first utterance may ignore session speed until a follow-up turn. Plan includes `speed` on greeting output for consistency with the smoke test (greeting is what Chris hears first).

**Frontend UX (discovered in inspection):** `AITestingTunables.tsx` disables the speaking-rate slider for `openai_realtime`:

```ts
const speakingRateDisabled = stack !== "twilio_cr" && stack !== "deepgram_voice_agent";
```

For OpenAI Realtime the slider is greyed out with “(Controlled by AI provider)”. Backend-only fix would still leave the UI non-interactive. **Recommend a one-line enable** for `openai_realtime` so the existing slider actually sends different values. No new controls, copy, or layout changes.

---

## 2. Scope

**In scope**
- AI Testing OpenAI Realtime only (`openai_realtime` stack)
- Render `ai-voice-bridge`: pass `speaking_rate` → OpenAI `audio.output.speed` (browser + phone via shared helpers)
- Optional 1-line UI enable in `AITestingTunables.tsx` (recommended — see above)
- `implementation_plan.md`, `WORK_LOG.md` (after implementation)

**Out of scope**
- Production Dialer, `TwilioContext`, queue, campaigns, Contacts, conversion
- `openai_sip`, Deepgram, Inworld
- Phone lifecycle, Twilio media, barge-in, transcript, usage metrics, status writes (except adding `speed` to existing OpenAI audio config payloads)
- DB migration, RLS, secrets, `config.toml`, Edge functions (data path already persists `speaking_rate`)

---

## 3. Files to touch

| File | Change |
|---|---|
| `services/ai-voice-bridge/src/bridge.ts` | **Primary.** Add `clampRealtimeSpeed()`, extend `buildRealtimeAudioConfig(voice, interruption, speed)`, wire `connectOpenAiUpstream` + phone greeting `response.create` |
| `services/ai-voice-bridge/src/browserOpenAIBridge.ts` | Import `clampRealtimeSpeed` (or shared output helper); add `speed` to greeting `response.create` only |
| `src/components/ai-testing/AITestingTunables.tsx` | **Recommended.** Enable speaking-rate slider for `openai_realtime` (1-line condition change) |
| `implementation_plan.md` | This file → mark implemented after approval |
| `WORK_LOG.md` | Newest-first hotfix entry after implementation |

**Inspection only (no change expected unless you reject UI enable):**
- `src/lib/aiTestingFormSchema.ts` — already `speaking_rate` 0.5–1.5 ✓
- `src/pages/AITestingPage.tsx` — already sends `speaking_rate` for OpenAI browser + phone ✓

**Total code files:** 2 required (bridge + browserOpenAI greeting), 1 recommended (Tunables).

---

## 4. Implementation detail

### 4.1 `bridge.ts`

```ts
export function clampRealtimeSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1.0;
  return Math.min(1.5, Math.max(0.25, value));
}
```

Update signature:

```ts
export function buildRealtimeAudioConfig(
  voice: string,
  interruption: InterruptionSensitivity,
  speed: number,
) {
  return {
    input: { /* unchanged */ },
    output: {
      format: { type: "audio/pcmu" as const },
      voice: voice || "alloy",
      speed: clampRealtimeSpeed(speed),
    },
  };
}
```

In `connectOpenAiUpstream`:

```ts
audio: buildRealtimeAudioConfig(cfg.voice, cfg.interruption, cfg.speed),
```

In `fireInitialGreetingIfReady` (phone `/twilio` only — inside `attachTwilioBridge`):

```ts
const speed = clampRealtimeSpeed(
  typeof session.speaking_rate === "number" && session.speaking_rate > 0
    ? session.speaking_rate
    : 1.0,
);
// audio.output: { format, voice, speed }
```

Optional DRY: export a tiny `buildRealtimeOutputAudio(voice, speed)` used by `buildRealtimeAudioConfig` and both greeting paths — only if it keeps the diff smaller than duplicating 3 lines twice.

### 4.2 `browserOpenAIBridge.ts`

- No change to `upstreamConfigFromSession` (already sets `cfg.speed` from `speaking_rate`).
- In `fireGreeting()`, add `speed: clampRealtimeSpeed(...)` to `response.create` → `audio.output` (import from `./bridge.js`).

### 4.3 `AITestingTunables.tsx` (recommended)

Change disable logic so OpenAI Realtime can use the slider:

```ts
const speakingRateDisabled =
  stack !== "twilio_cr" &&
  stack !== "deepgram_voice_agent" &&
  stack !== "openai_realtime";
```

Remove or keep the “Controlled by AI provider” italic for other stacks only — no copy redesign.

### 4.4 Phone path auto-fix

`attachTwilioBridge` already builds `upstreamCfg.speed` from `session.speaking_rate` and calls `connectOpenAiUpstream(env, instructions, upstreamCfg)`. No phone lifecycle changes — speed flows through the shared `session.update` once `buildRealtimeAudioConfig` accepts it.

---

## 5. Verification (before handoff)

```bash
# repo root
npx tsc --noEmit

# bridge only
cd services/ai-voice-bridge && npm run build   # or ./node_modules/.bin/tsc --noEmit
```

Manual code review:
- `buildRealtimeAudioConfig` output includes `speed` under `audio.output`
- `connectOpenAiUpstream` passes `cfg.speed`
- Greeting payloads include `speed` (phone + browser)
- No Deepgram/Inworld files touched
- No migration / config.toml / secrets

---

## 6. Deployment (NOT automatic — after your approval)

| Target | Needed? | Action |
|---|---|---|
| **Render `ai-voice-bridge`** | **Yes** | Redeploy from `main` after merge (auto-deploy on push, or manual). Verify unchanged env. |
| **Supabase Edge** | **No** | `speaking_rate` already persisted; no Edge code change |
| **Vercel** | **Only if UI enable merged** | Auto-deploy if `AITestingTunables.tsx` changed; skip if backend-only |

Post-deploy smoke:

```bash
curl -s https://ai-voice-bridge-ouez.onrender.com/ready | jq '.paths'
```

---

## 7. Human smoke-test checklist

- Super Admin → AI Testing → OpenAI Realtime
- Speaking rate **1.0** → browser test → baseline pace
- Speaking rate **1.2** → browser test → audibly faster
- Speaking rate **1.3** → check if too rushed
- Phone test at **1.2** → speed change applies on call
- Regression: Deepgram + Inworld browser/phone unchanged

---

## 8. Decision for Chris

**Approved:** Option 2 — backend + enable slider (3 files).

**Implemented:**
- `bridge.ts` — `clampRealtimeSpeed`, `buildRealtimeOutputAudio`, `buildRealtimeAudioConfig(..., speed)`, phone greeting speed
- `browserOpenAIBridge.ts` — greeting uses `buildRealtimeOutputAudio` (stop lifecycle from #327 preserved)
- `AITestingTunables.tsx` — speaking-rate slider enabled for `openai_realtime`

**Verification:** repo root + `services/ai-voice-bridge` `tsc --noEmit` clean.

**Deploy after merge:** Render `ai-voice-bridge` yes · Vercel yes (Tunables) · Supabase Edge yes (`ai-testing-start-browser-session`, `ai-testing-place-call`).

**Also in scope (added):** AI Testing prompt limit 12,000 → 24,000 characters in `ai-testing-start-browser-session` and `ai-testing-place-call` (no frontend “12,000” copy found).
