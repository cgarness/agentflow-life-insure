# Implementation Plan — Dialer QA Polish Pass (5 surgical bugfixes)

**Owner:** Chris Garness · **Date:** 2026-06-05
**Branch:** `claude/dialer-qa-polish-944c9d` (off `fix/dialer-redial-loop-campaign-leads-advancement`, which carries the campaign-card + redial fixes Issue 4 depends on)
**Status:** PLAN — awaiting Chris approval. No source files modified yet.

---

## 0. Pre-flight

| Check | Result |
|-------|--------|
| Read `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md` | Done (in full / newest-first) |
| `[IN PROGRESS]` conflicts? | **None blocking.** Only `[IN PROGRESS]` markers in WORK_LOG are old "Permissions System" phased entries (lines ~4500–4682). **No open Phone Number Assignment Pass 1/2/3, no Queue Build 1–4, no DialerPage refactor.** Newest entries (2026-06-04) are all `[DONE]` dialer work on the parent branch. |
| Invariants confirmed | Twilio single-leg WebRTC only; `calls.duration` sourced only from Twilio `CallDuration` (sole writer `twilio-voice-status`); P1 trusted stats/session duration from `calls`/`wins`/`dialer_sessions`; contacted = `duration > 45` OR `counts_as_contacted`/DNC; atomic `SELECT…FOR UPDATE SKIP LOCKED` claim via `get_next_queue_lead`. **None will be touched.** |
| Migration expected | **None.** If any issue turns out to need one I will STOP and ask first. |
| Scope | Frontend-only, surgical. No DialerPage rewrite. No Twilio Edge / queue RPC / Reports / campaign-stats source-of-truth changes. |

---

## 1. Diagnosis (root cause confirmed in live code)

### Issue 1 — Header stat cards (zero-flash + missing refetch triggers)

**Files:** [DialerPage.tsx](src/pages/DialerPage.tsx) `reconcileTrustedStats` (~796), mount effect (~832), `statsLoading` (500); [DialerHeaderStats.tsx](src/components/dialer/DialerHeaderStats.tsx); [useDialerSession.ts](src/hooks/useDialerSession.ts) `sessionStats` init (118).

- **Zero-flash root cause:** the skeleton gate `statsLoading` is wired to the **legacy** `getTodayStats()` call (set `false` in its `.finally`, line 842), which resolves fast. The **trusted** numbers come from a *separate* async `reconcileTrustedStats()` (queries `calls`/`wins`/`dialer_sessions`). So the sequence on mount / return-to-dialer is: skeleton → `getTodayStats` resolves → `statsLoading=false` → header renders the **initial `{0,0,0,0}`** `sessionStats` → `reconcileTrustedStats` resolves → real numbers pop in. The window between the two is the misleading zero-flash.
- **Refetch coverage today:** mount (844) ✓, campaign change (851) ✓, after hangup 4s (2075) ✓, Save Only 3s (3099) ✓, Save & Next 3s (3129) ✓, session end (1938) ✓.
- **Gaps vs Phase B:** **(a)** No explicit reconcile after **session start** — `handleSelectCampaign` (1928) calls `startServerSession` then sets `selectedCampaignId`; the campaign-change reconcile (851) can fire **before** the `dialer_sessions` row is inserted, so session-duration base may read stale until the next trigger. **(b)** No explicit reconcile after **No-Answer auto-save** — `autoSaveNoAnswer` (2732) and `handleAutoDispose` (2078) do not call `reconcileTrustedStats`; they rely on the hangup effect (2075) firing, which is not guaranteed for a ring-timeout no-answer (duration stays 0).
- The deliberate 3–4s post-call reconcile delay is intentional (waits for the Twilio status callback + win insert to land) — **keep it.**

### Issue 2 — Appointment / callback time = manual entry

**Files:** [DialerActions.tsx](src/components/dialer/DialerActions.tsx) lines 243–248 (callback time), 272–283 (appt start/end); state in [DialerPage.tsx](src/pages/DialerPage.tsx) 438/449/450.

- Live wrap-up uses native `<input type="time">` for callback + appt start/end. Two problems: (1) native time input still allows free keyboard entry and has inconsistent UX; (2) **format mismatch** — defaults are 12-hour (`aptStartTime="10:00 AM"`, `aptEndTime="10:30 AM"`) but `type="time"` expects 24-hour `HH:MM`, so the defaults never display and saved values are inconsistent.
- The save paths accept **both** formats: appointment via `convertTo24h()` ([dialer-api.ts:622](src/lib/dialer-api.ts)) handles `"2:30 PM"` and `"14:30"`; callback parser in DialerPage (2905–2916, 3152–3163) handles `"H:MM AM/PM"` and `"HH:MM"`. So emitting **12-hour `"h:mm AM/PM"`** strings is safe for every consumer and matches the existing defaults.
- The "CALLBACK MODAL" at DialerPage 4051–4094 (free-text `placeholder="e.g. 2:30 PM"`) is **dead code** — `setShowCallbackModal(true)` is never called. Left untouched (out of scope; flag for separate cleanup).

### Issue 3 — "Persistent" save toast

**Files:** [DialerPage.tsx](src/pages/DialerPage.tsx) `proceedSaveOnly` (3082), `proceedSaveAndNext` (3115), `saveCallData` catch (3076), appt/callback sub-save catches (2871/2934); [sonner.tsx](src/components/ui/sonner.tsx).

- **Verified against sonner 1.7.4 source:** a loading toast promoted via `toast.success(msg,{id})` / `toast.error(msg,{id})` recomputes `Tt = t.duration || toasterDuration || 4000` and refreshes `remainingTime` via `useEffect([Tt])`, then the timer effect (skipped only when `type==="loading"` or `duration===Infinity`) re-arms at 4000 ms. So the existing save-loading toasts **do auto-dismiss** — they are **not** structurally stuck, and failed saves already do **not** advance the queue or release the Team/Open lock (`saveCallData` no longer releases the lock; Save & Next releases only after `success`).
- **Real residual defects (Phase D hardening):**
  1. No `finally` guarantees the loading id is dismissed — if `saveCallData`'s promise ever hangs (network stall) or throws after the `success` branch partially ran, the loading toast can linger. Add a `finally` that dismisses idempotently.
  2. **Double toast:** when an appt/callback **sub-save** fails (2871/2934) it shows an error toast *and* the call save still succeeds → user sees both `"… may not have saved"` and `"Call saved successfully"`. Confusing. Will collapse to a single, bounded informative toast.
  3. Success/error promotions don't set an explicit bounded `duration` — make them explicit (e.g. 3000 ms success / 5000 ms error) so behavior is version-independent of sonner's default.
- **Honest note:** I could not reproduce a *guaranteed* never-dismissing toast in the current code. If you have a concrete repro (which disposition/path), share it; otherwise the hardening below makes dismissal deterministic and bounded in every path.

### Issue 4 — Campaign selector cards flash 0

**Files:** [DialerPage.tsx](src/pages/DialerPage.tsx) stats `useQuery` (876–942), [CampaignSelection.tsx](src/components/dialer/CampaignSelection.tsx), [useDialerSession.ts](src/hooks/useDialerSession.ts).

- **Largely already fixed on the parent branch** (commits `162a56a`, `dd54607`, `b6d3730`, `342320a`): permissions-gated campaign fetch, single `.in("campaign_id", visibleCampaignIds)` aggregate (no N+1), `localStorage` hydration → React Query `initialData` for instant correct counts on refresh, `campaignCardsLoading` keeps the skeleton until `campaignStatsReady` (entry present for every visible campaign), per-card "Loading counts…", and "No leads" only after stats load empty.
- Dialer selector intentionally shows **state/contact chips**, not the Campaigns-page 4-stat grid, so `get_campaign_card_stats` is correctly **not** used here (invariant #17) and will not be touched.
- **Plan:** verify only; no code change expected unless QA still shows a residual flash. If a residual is found it will be a minimal loading-gate tweak — no RPC/source-of-truth change.

### Issue 5 — Team/Open assigned-lead reveal (SEPARATE COMMIT)

**Files:** [DialerPage.tsx](src/pages/DialerPage.tsx) `callStatus` (781), `loadLockModeLead` (1044), heartbeat `onLockLost` (1109); [useLeadLock.ts](src/hooks/useLeadLock.ts); [LeadCard.tsx](src/components/dialer/LeadCard.tsx).

- **Today the reveal is *implicitly* gated:** in lock mode `currentLead` is only ever set inside `loadLockModeLead` **after** `getNextLead()` → `get_next_queue_lead` (atomic `FOR UPDATE SKIP LOCKED` claim) returns a row, i.e. the lock is server-confirmed for this user. `callStatus` then stages reveal off `currentLead` + `twilioCallState` (`idle`→skeleton, `ringing`→`LeadCardBlurred`, `connected`→full). No code path populates the Team/Open `leadQueue` without the claim RPC (the unlocked `getCampaignLeads` `loadWithResume` path runs **only** for Personal).
- **Gap vs Phase F (the bug to fix):** the gate is *implicit* (relies on "currentLead ⇒ locked"), not **strict/explicit** on the claim-ownership result, and the **lost-claim race flashes stale data**: when the heartbeat reports the lock lost, `onLockLost` (1109) calls `loadLockModeLead` to fetch a new lead but does **not** mask first — so the previous lead's fully-revealed card stays on screen during the async re-claim (checklist #10: "a lost claim race never flashes another agent's contact data").
- **Fix (read-only against confirmed ownership; no claim RPC change):** add an explicit `confirmedLockLeadId` state set **only** to `lock.id` right after a successful `getNextLead` claim, and required by `callStatus` before any reveal (`lockMode && confirmedLockLeadId !== currentLead?.id → "idle"/masked`). Clear it the instant a lock is released / lost / advanced (`onLockLost`, Save & Next release, Skip, session end). This makes reveal strictly contingent on the server-confirmed claim and eliminates the lost-claim flash. Save Only keeps the lock → id unchanged → card stays revealed. Save & Next → cleared → next lead masked until its claim confirms.

---

## 2. Fix design (per issue)

### Issue 1 (commit group A)
1. Add a `trustedStatsLoaded` boolean (state). Set `true` in `reconcileTrustedStats`'s `finally` (success or error). Reset to `false` when `selectedCampaignId` changes (so a campaign switch re-skeletons rather than showing the prior campaign's numbers as if final — or, per Phase B option, **hold prior known stats**; I will hold the skeleton only on first load and otherwise keep prior values to avoid flicker — see note).
2. Header skeleton gate: `statsLoading` passed to `DialerHeaderStats` becomes `statsLoading || (!!selectedCampaignId && !trustedStatsLoaded)` so the header never renders `{0,0,0,0}` before the first trusted reconcile. (When no campaign is selected the selection screen is shown, so the header isn't the concern.)
3. Add explicit `void reconcileTrustedStats()` after **session start** (in `handleSelectCampaign`, after `startServerSession` resolves — small delay/`await` so the `dialer_sessions` row exists) and after **No-Answer auto-save** (end of `autoSaveNoAnswer`, and `handleAutoDispose`). Keep the existing 3–4s post-call delays.
4. No change to trusted sources, scoping (campaign + user-local-day), or browser-timer rules.

### Issue 2 (commit group A)
1. New small reusable control `src/components/dialer/TimeSelect.tsx` (< 200 lines, Tailwind-only) built on the design-system `@/components/ui/select`. Emits 12-hour `"h:mm AM/PM"` strings, **15-minute increments, full-day coverage** (00:00–23:45 → "12:00 AM" … "11:45 PM"). Props: `value`, `onChange`, optional `minTime` (to keep appt end ≥ start).
2. Replace the three native `type="time"` inputs in `DialerActions.tsx` (callback time, appt start, appt end) with `TimeSelect`. Preserve existing prop names (`callbackTime/setCallbackTime`, `aptStartTime/setAptStartTime`, `aptEndTime/setAptEndTime`) and state names.
3. End-time validity: filter appt end options to ≥ start (current logic has no hard validation; preserve "no worse than today" — keep end selectable but default/cap relative to start). **No** change to save payloads, email/SMS, or conversion gating.
4. Leave the dead callback modal (4051–4094) untouched.

### Issue 3 (commit group A)
1. Wrap `proceedSaveOnly` / `proceedSaveAndNext` loading toast in `try/finally`; in `finally` dismiss the loading id idempotently (after success/error promotion this is a no-op, but it guarantees no orphan on a hang/early-return).
2. Give success/error promotions explicit bounded `duration` (success 3000, error 5000).
3. Collapse appt/callback sub-save failure to one bounded toast; do not also imply full success when a sub-save failed (single clear message).
4. Confirm (no change needed) failed save does not advance / release lock / duplicate.

### Issue 4 (verify-only)
- Run the runtime checklist; only touch code if a residual 0-flash is observed. Expected: no change.

### Issue 5 (commit group B — SEPARATE, independently revertible)
1. `const [confirmedLockLeadId, setConfirmedLockLeadId] = useState<string|null>(null)`.
2. In `loadLockModeLead`: after `getNextLead` returns `lock` and `setLeadQueue([merged])`, `setConfirmedLockLeadId(lock.id)`. On empty/`!lock` and in `catch`, `setConfirmedLockLeadId(null)`.
3. In `onLockLost` (heartbeat callback): `setConfirmedLockLeadId(null)` **before** the re-fetch (mask immediately).
4. On `releaseLock` sites that advance away (Save & Next lock release, Skip, session end): clear `confirmedLockLeadId`.
5. `callStatus` memo: for `lockMode`, if `confirmedLockLeadId !== (currentLead?.id ?? null)` return `"idle"` (masked) before the existing staged logic. Add `confirmedLockLeadId` to deps.
6. Personal unaffected (`!lockMode → "connected"`). No claim/lock RPC change; manager/agent visibility unchanged.

---

## 3. Files to touch

| File | Issues | Change |
|------|--------|--------|
| `src/pages/DialerPage.tsx` | 1,3,5 | `trustedStatsLoaded` gate + extra reconcile triggers; toast `finally`/bounded durations/dedupe; `confirmedLockLeadId` reveal gate |
| `src/components/dialer/DialerHeaderStats.tsx` | 1 | (only if skeleton gate needs a prop) — likely none; gate computed in DialerPage |
| `src/components/dialer/DialerActions.tsx` | 2 | swap 3 native time inputs → `TimeSelect` |
| `src/components/dialer/TimeSelect.tsx` | 2 | NEW reusable select control |
| `src/components/dialer/CampaignSelection.tsx` | 4 | none expected (verify) |
| `implementation_plan.md` | — | this plan |
| `WORK_LOG.md` | — | newest-first `[DONE]` entry on completion |

**Will NOT touch:** `TwilioContext.tsx`, any `twilio-voice-*` Edge Function, `get_next_queue_lead` / `advance_campaign_lead` / lock RPCs, `calls.duration` writes, Reports, `get_campaign_card_stats` / campaign-stats source-of-truth, disposition/contacted/Sold-Convert gating, caller-ID/phone-number assignment, any migration.

---

## 4. Commit structure
- **Commit A** (Issues 1–4): stat cards + time selectors + toast cleanup + (any) campaign-card residual. May be one or more cosmetic commits.
- **Commit B** (Issue 5): Team/Open reveal gate **only** — independently revertible, no cosmetic changes mixed in.

---

## 5. Verification (Phase G)
1. `npx tsc --noEmit`
2. `npm test -- --run` (if it fails only on missing Vite env vars, rerun with dummy env and document both).
3. Static checks + runtime checklist (1–11) documented in the WORK_LOG entry.

---

## 6. Approval gate
**Chris:** reply **approve** (or edits) before I modify any source file. I will not push or deploy until you explicitly approve.

### Open question for Chris
- **Issue 3:** Do you have a concrete repro of the stuck toast (which disposition / Save Only vs Save & Next / Team vs Personal)? My read of sonner 1.7.4 is that the current loading→success/error promotion already auto-dismisses at 4s; I'll harden dismissal regardless, but a repro would let me target the exact path.
