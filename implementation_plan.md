# HOTFIX P0A — Harden `twilio-voice-status` duration handling

**Owner:** Chris Garness
**Status:** DEPLOYED — `twilio-voice-status` v21 → v22 ACTIVE (`verify_jwt: false` preserved). Verified (tsc + 85 tests + clean edge logs). Live test-call confirmation pending Chris.
**Date:** 2026-05-28

---

## 0) Scope & invariants

P0A only. Harden `supabase/functions/twilio-voice-status/index.ts` so Twilio-reported
duration is the canonical persisted `calls.duration`. This is a telemetry fix, **not** a
dialer refactor.

Critical invariant being enforced:
> Twilio status callback duration is the canonical source of truth for persisted call
> duration. Browser timers are UI-only and must not become the billing/reporting source.

Preserved / untouched:
- No edits to `DialerPage.tsx`, `TwilioContext.tsx`, `FloatingDialer.tsx`.
- Browser duration writes NOT removed yet (that is P0B).
- UI timer behavior unchanged.
- `twilio-voice-webhook` / `answerOnBridge` unchanged (confirmed `answerOnBridge="true"`
  at `twilio-voice-webhook/index.ts:133`).
- Single-leg WebRTC architecture unchanged. No two-legged REST / SIP / Telnyx /
  `dialer-start-call`.
- `verify_jwt` behavior preserved (this function uses signature validation + service role;
  no gateway JWT change).
- No schema changes. If one is discovered necessary → STOP and ask Chris.
- No production data mutation. No deploy until Chris explicitly approves.

---

## 1) Read-only inspection (completed)

- Read `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md`.
- Read full `supabase/functions/twilio-voice-status/index.ts`.
- Confirmed `answerOnBridge="true"` unchanged in `twilio-voice-webhook/index.ts`.
- WORK_LOG newest-first scan: most recent work is browser-recording / call-recordings
  Storage RLS (2026-05-27). **No conflicting in-flight dialer/telemetry/status-callback
  work.** No prior P0A duration-audit notes exist in WORK_LOG.
- Existing edge-style tests: `src/lib/__tests__/spamStatusDb.test.ts`,
  `src/lib/voiceSdkNotificationBranch.test.ts`. No dedicated test for status-callback
  duration parsing yet. Test runner = vitest (`npm test -- --run`).

---

## 2) Gap analysis (current behavior → required behavior)

| # | Requirement | Current code | Action |
|---|-------------|--------------|--------|
| 1 | Duration prefers `CallDuration`, falls back to `DialCallDuration`, parsed as non-negative int | `parseDurationSeconds(params["CallDuration"] ?? params["DialCallDuration"])` — already correct | none |
| 2 | Terminal non-answer (`no-answer`/`busy`/`canceled`/`failed`) with missing duration → write `duration = 0` | These cases never set `patch.duration` → row may stay NULL | add candidate `= callDuration ?? 0` |
| 3 | Idempotency: don't regress a good existing duration with `0`/`NULL` on late/out-of-order callback | `completed` writes `patch.duration` unconditionally; terminal paths would write 0 unconditionally | add monotonic guard |
| 4 | Org scoping / target correct row / `.maybeSingle()` | Already uses `.maybeSingle()` lookup by unique `twilio_call_sid`; update keyed by same SID | none (already targets the matched row) |

---

## 3) Design (surgical)

### 3.1 Add a single pure helper

```ts
/**
 * Monotonic duration guard. Returns the value to persist, or null to leave existing.
 * - write when no existing value
 * - write when the incoming candidate is strictly greater
 * - never regress an existing positive duration (protects against late/out-of-order
 *   non-answer/busy/canceled/failed callbacks reporting 0)
 */
function chooseDurationToWrite(
  existing: number | null,
  candidate: number | null,
): number | null {
  if (candidate === null) return null;
  if (existing === null) return candidate;
  return candidate > existing ? candidate : null;
}
```

### 3.2 Compute a `durationCandidate` per status, apply the guard once after the switch

- `completed`: `candidate = callDuration` if present; else if `started_at` exists, the
  existing computed-from-`started_at` value; else `null` (unchanged edge behavior).
- `no-answer` / `busy` / `canceled` / `failed`: `candidate = callDuration ?? 0`.
- `ringing` / `in-progress`: no duration candidate (unchanged).

After the switch, before the DB update:
```ts
const durToWrite = chooseDurationToWrite(existing.duration, durationCandidate);
if (durToWrite !== null) patch.duration = durToWrite;
```

This removes the direct `patch.duration = ...` assignments inside the switch in favor of
setting `durationCandidate`, keeping all other patch fields (status, ended_at,
shaken_stir, outcome, is_missed, provider_error_code) exactly as-is.

### 3.3 STIR/SHAKEN fetch on `completed`

Unchanged — still gated behind `!patch.shaken_stir && accountSid`.

---

## 4) Expected outcomes (matches brief verification matrix)

| Case | Input | existing.duration | Result |
|------|-------|-------------------|--------|
| 1 | completed, `CallDuration=62` | null | `duration = 62` |
| 2 | completed, only `DialCallDuration=58` | null | `duration = 58` |
| 3 | `no-answer`, no duration | null | `duration = 0` |
| 4 | `busy`/`canceled`/`failed`, no duration | null | `duration = 0` |
| 5 | late `no-answer`, no duration | 62 | stays `62` (guard blocks regress) |
| 6 | terminal `no-answer`, no duration | null | `duration = 0` |

Bonus covered by guard: late `completed` reporting smaller `CallDuration` than an existing
larger value will not regress it.

---

## 5) Files to touch (after approval)

- `supabase/functions/twilio-voice-status/index.ts` — add helper + restructure duration
  assignment (surgical; ~25 lines net).
- `supabase/functions/twilio-voice-status/duration.test.ts` *(proposed, optional)* — minimal
  vitest unit test for `chooseDurationToWrite` + duration-candidate logic, only if it can be
  added without broad scaffolding. **Will confirm with Chris** whether to add, since the
  helper currently lives inside the Deno function file (would need a small export).
- `WORK_LOG.md` — newest-first entry.
- `implementation_plan.md` — final status update.
- `AGENT_RULES.md` — add canonical-duration invariant (per brief).

**Will NOT touch:** `DialerPage.tsx`, `TwilioContext.tsx`, `FloatingDialer.tsx`,
`twilio-voice-webhook`, any migration, schema, or RLS.

---

## 6) Verification plan

- `npx tsc --noEmit`.
- `npm test -- --run` (and the new duration test if added).
- Document the 6 expected-outcome cases above.

---

## 7) Deploy

- **No deploy** in this build unless Chris explicitly approves the exact deployment.
- If approved later: `get_edge_function` (MCP) first, ship full `index.ts`, preserve
  `verify_jwt` behavior.

---

## 8) Stop-and-report conditions

- Any schema/RLS change appears necessary.
- Duration source ambiguity (e.g. Twilio sends both with conflicting values in a way the
  guard would mishandle).
- Org-scoping mismatch discovered on the live `calls` row lookup.

---

# P0B — Remove browser duration writes to `calls.duration`

**Status:** IMPLEMENTED (strict A+B+C) — verified (tsc + 85 tests). Frontend only; no deploy, no DB mutation.
**Date:** 2026-05-28

## P0B.1) Goal

Now that `twilio-voice-status` is the hardened canonical writer (P0A), make the browser
stop writing `calls.duration`, enforcing the invariant: *Twilio status callback duration is
the canonical source of truth; browser timers are UI-only.*

## P0B.2) Complete inventory of frontend `calls.duration` writes

Repo-wide grep (`duration:` as an update key on a `.from("calls")` payload) yields exactly
**three** sites — all in `src/contexts/TwilioContext.tsx`. Nothing in `DialerPage.tsx`,
`FloatingDialer.tsx`, or elsewhere writes `calls.duration`.

| # | Function | Line | Context | Value written |
|---|----------|------|---------|---------------|
| A | `finalizeCallRecord` | `TwilioContext.tsx:1256` | **Normal call-end path** (called from `finalizeEnded` at line 1678 with `callDurationRef.current`) | browser timer |
| B | `checkOrphanedCalls` | `TwilioContext.tsx:1150` | Silent refresh recovery — finalizes a row stranded after a page refresh | browser timer `Math.round((Date.now()-startedMs)/1000)` |
| C | `hangUpOrphan` | `TwilioContext.tsx:1187` | User taps "terminate" on the orphan-recovery UI | browser timer |

**Out of scope (NOT `calls.duration`):**
- `call_logs.duration` (`TwilioContext.tsx:1220`, via `insertCallLog`) — separate telemetry table.
- `dialer_daily_stats` / sessionStats `duration_seconds` (`DialerPage.tsx:2455,2621`, `FloatingDialer.tsx:754`) — agent-productivity totals, not per-call duration.
- `dialer-api.ts` and all reporting/leaderboard code — **read** `calls.duration`, never write it.

## P0B.3) Smallest safe change

Remove only the `duration:` key from each of the three `calls` update payloads. **Keep
`status` and `ended_at`** — those are call-lifecycle fields, not the canonical-duration
concern, and removing them risks ghost-row / UI regressions. After this, the Twilio status
callback is the sole writer of `calls.duration`.

UI is unaffected: the live talk-timer, hard-claim (≥30s), and contacted (>45s) logic read
the in-memory browser `twilioCallDuration` (UI-only), not a round-trip of `calls.duration`.
Reporting/leaderboard read `calls.duration` post-hoc and will now reflect the canonical
Twilio value.

## P0B.4) Decision (LOCKED by Chris, 2026-05-28)

**Option 1 (strict) chosen — remove duration from all three sites (A, B, C).**
`twilio-voice-status` becomes the sole writer of `calls.duration`. Accepted trade-off: a
genuinely orphaned row whose Twilio callback never fired could remain `duration = NULL`
until/unless a callback arrives. `status` + `ended_at` are still written by the recovery
paths, so lifecycle correctness is preserved.

## P0B.5) Files to touch (after approval)

- `src/contexts/TwilioContext.tsx` — remove the `duration` field from the approved site(s).
- `AGENT_RULES.md` — note that `calls.duration` is written only by `twilio-voice-status`
  (+ the recovery-fallback exception if Option 2).
- `WORK_LOG.md` — newest-first entry.
- `implementation_plan.md` — final status.

**Will NOT touch:** `DialerPage.tsx`, `FloatingDialer.tsx`, Edge Functions, migrations,
schema, RLS. No deploy. No DB mutation.

## P0B.6) Verification

- `npx tsc --noEmit`; `npm test -- --run`.
- Static confirmation that no other frontend path writes `calls.duration`.
- **Runtime (requires Chris / a live call):** place an outbound call, hang up, confirm
  `calls.duration` is populated by the status callback (not the browser). This is the core
  P0A+P0B assumption and can only be fully confirmed live.

## P0B.7) Stop-and-report conditions

- Removing site A breaks any synchronous UI read of `calls.duration` (none found, but will
  re-verify in the diff).
- Any reporting path turns out to depend on the browser write landing before the callback.

---

# P0B FOLLOW-UP (HOTFIX) — Remove remaining `saveCall` browser write to `calls.duration`

**Status:** IMPLEMENTED — verified (tsc + 85 tests + static greps). Commit + push pending Chris's go on the diff.
**Date:** 2026-05-28

## FU.1) Why this exists

P0B.2's original inventory was **incomplete**. It scanned `TwilioContext.tsx`,
`DialerPage.tsx`, `FloatingDialer.tsx` but missed `src/lib/dialer-api.ts`. External
verification found a 4th browser write path: `saveCall()` (the wrap-up "Save & Next"
path) still persists `duration: data.duration_seconds` to `calls`, and all three
`saveCall` callers pass browser-timer values:
- `src/pages/DialerPage.tsx:2455` → `duration_seconds: twilioCallDuration`
- `src/pages/DialerPage.tsx:2621` → `duration_seconds: twilioCallDuration`
- `src/components/layout/FloatingDialer.tsx:754` → `duration_seconds: twilioCallDuration || callSeconds`

So a wrap-up save can still overwrite the canonical Twilio duration. This violates the
AGENT_RULES §4 #8 "sole writer" invariant.

## FU.2) The single offending line

`src/lib/dialer-api.ts:378` inside `sharedCallFields` (used by both the update branch at
:393 and the insert branch at :401):
```ts
duration: data.duration_seconds,
```

## FU.3) Surgical fix

- Remove **only** line 378 from `sharedCallFields`. Keep all other fields (contact_id,
  campaign_lead_id, agent_id, campaign_id, disposition_name, notes, outcome,
  caller_id_used, status, ended_at, contact_type, organization_id).
- **Keep** `duration_seconds` in the `saveCall` argument type — it is still consumed for
  the `contact_activities` description at :494 (`formatDuration(data.duration_seconds)`),
  which is NOT `calls.duration`. All three callers continue to pass it; no caller changes.

## FU.4) Files to touch (after approval)

- `src/lib/dialer-api.ts` — delete one line (378).
- `AGENT_RULES.md` — §4 #8: note `saveCall` was the remaining write, now removed (accuracy).
- `WORK_LOG.md` — newest-first hotfix entry.
- `implementation_plan.md` — flip this section's status.

**Will NOT touch:** `twilio-voice-status`, `twilio-voice-webhook`, `answerOnBridge`, Twilio
architecture, TwilioContext re-entrancy guards, queue logic, disposition behavior, recording
behavior, UI timer behavior, `dialer_daily_stats`. No migrations.

## FU.5) Verification

- `npx tsc --noEmit`; `npm test -- --run`.
- Static: `grep "duration: data.duration_seconds"` → 0 hits; confirm no frontend
  `.from("calls")` write payload contains `duration`; confirm only
  `twilio-voice-status/index.ts` sets `patch.duration`; confirm `call_logs.duration`
  (TwilioContext insertCallLog) is untouched and distinct.
