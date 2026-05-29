# Implementation Plan | P1 Build 3B — Campaign-Scoped Daily Header Stats + User-Timezone Reset

**Status:** IMPLEMENTED (local) — tsc exit 0, 15 files / 90 tests pass; NOT pushed/deployed (awaiting Chris). Decisions A1 + B1 applied.
**Prerequisites:** Build 1 migration `20260529003210` applied; Build 2 merged `2137da8`; Build 3 + Build 3A merged/deployed (`1eb92f9`, `ae4fe67`)

---

## 1. Goal

Make Dialer header stat cards **trusted, selected-campaign-scoped, user-timezone-daily, and persistent** across leaving/re-entering the Dialer. Today they reset because trusted stats are agent+org+day (no campaign) and Session Duration is an in-memory live timer for the *current* active session only.

---

## 2. Phase A findings (read-only, verified live on `jncvvsvckxhqgqvkppmj`)

| # | Question | Finding |
|---|----------|---------|
| 1 | `calls.campaign_id` reliable? | **Yes for new rows.** Today 12/12 outbound carry it; legacy NULLs (2026-05-27 and earlier) predate wiring. `dialer-api.saveCall` writes `campaign_id`; DialerPage passes `selectedCampaignId`. ✅ usable. |
| 2 | `wins.campaign_id` reliable? | **NO — BLOCKER.** `convertLeadToClient` (main Dialer Sold path) calls `triggerWin` with **neither `campaignId` nor `organizationId`** (`src/lib/supabase-conversion.ts:87`). `FloatingDialer` passes `organizationId` but not `campaignId`. `wins` table is currently empty (0 rows). New Dialer-Sold wins would land with `campaign_id = NULL` **and** `organization_id = NULL`. |
| 3 | `dialer_sessions.campaign_id` reliable? | **Yes.** 15/15 recent rows carry it. ✅ |
| 4 | Profile timezone field? | **Yes — `profiles.timezone` (text), populated.** BUT values are Rails/ActiveSupport labels (`"Eastern Time (US & Canada)"`, `"Pacific Time (US & Canada)"`) — **NOT IANA**, so they cannot be passed to `Intl.DateTimeFormat({ timeZone })` directly. |
| 5 | Derive user-local day boundary? | Need a helper that computes `[startIso, endIso)` for the user's local midnight→midnight, converted to UTC ISO for Supabase `gte/lt`. Requires an IANA zone (see decision B). |
| 6 | Why header resets on leave/re-enter? | (a) `getTrustedTodayDialerStats` / `reconcileTrustedStats` are **agent+org+day only — no `campaignId`**; (b) Session Duration card shows `sessionElapsedDisplay`, an **in-memory live timer** of the *current* active session (`now − started_at`), reset to 0 on leave; the trusted helper's `session_duration_seconds` is computed but **ignored** by `reconcileTrustedStats`. |
| 7 | Is trusted helper agent/org/day only? | **Yes** — `getTrustedTodayDialerStats` has no `campaignId` param; bounds are `utcDayBounds` (UTC, not user-local). |
| 8 | Session duration from in-memory not trusted? | **Yes** — header reads `sessionElapsedDisplay` from `useDialerSession`, not accumulated `dialer_sessions`. |

**Files inspected:** `src/lib/supabase-dialer-stats.ts`, `src/hooks/useDialerSession.ts`, `src/pages/DialerPage.tsx`, `src/components/dialer/DialerHeaderStats.tsx`, `src/lib/report-utils.ts`, `src/lib/supabase-dialer-sessions.ts`, `src/lib/dialer-api.ts` (saveCall writes `campaign_id`), `src/lib/win-trigger.ts`, `src/lib/supabase-conversion.ts`, `src/components/layout/FloatingDialer.tsx`, generated `types.ts` (FKs `calls_campaign_id_fkey`, `wins_campaign_id_fkey`, `dialer_sessions_campaign_id_fkey` all present).

---

## 3. Decisions (RESOLVED by Chris — 2026-05-29)

### Decision A — Policies Sold campaign-linkage → **A1 CHOSEN**
Thread `campaignId` (+ `organizationId`) through `convertLeadToClient` → `triggerWin`, passed from DialerPage's conversion gate; also add `campaignId` to FloatingDialer's `triggerWin`. Optional params only, no behavior change to the convert/save flow itself, no migration (columns exist). Makes Policies Sold trusted + campaign-scoped going forward. Trusted `wins` query gets `.eq("campaign_id", campaignId)`.

### Decision B — Timezone source → **B1 CHOSEN**
Use browser IANA (`Intl.DateTimeFormat().resolvedOptions().timeZone`) as the day-boundary source. `profiles.timezone` (Rails label) is a deferred future enhancement. Last-resort UTC only if `Intl` yields nothing.

---

## 4. Planned changes (pending approval — NOT yet applied)

### Phase B — Day-bound helper (`src/lib/supabase-dialer-stats.ts` or a small isolated util)
- Add `userLocalDayBounds(timeZone: string, date?: Date): { startIso, endIso }` returning the user's local midnight→next-midnight as UTC ISO. Testable/isolated (unit test in `src/lib/__tests__`).
- Replace `utcDayBounds` usage inside `getTrustedTodayDialerStats` with the user-local bounds.

### Phase C — Campaign-scoped trusted stats (`getTrustedTodayDialerStats`)
- Add params: `campaignId: string`, `timeZone: string`. Require `campaignId` (return empty if absent).
- Add `.eq("campaign_id", campaignId)` to the `calls` query, the `dialer_sessions` query, and the `wins` query (wins only if Decision A1/A3).
- Contacted logic unchanged (Build 3A `isContactedCallRow`).
- Return `session_duration_seconds` already computed; ensure caller consumes it.

### Phase D — DialerPage / header
- `reconcileTrustedStats`: pass `campaignId: selectedCampaignId`, `timeZone`; gate on `selectedCampaignId`; set a new `sessionStats.session_duration_seconds` (or separate state) from trusted total.
- Session Duration card: show **accumulated trusted daily total**, and when a session is active, display `trustedAccumulated (minus live active span already counted) + live elapsed` so the timer resumes from the daily total and ticks live. Browser timer stays display-only; on no active session it shows the frozen accumulated total.
- Reconcile triggers already exist (mount, campaign change, ~4s post-hangup, ~3s post-save, post-session-end) — keep; ensure they all pass campaign + tz.

### Phase E — Cache/stale state
- Confirm reconcile is parameterized by `organizationId`, `agentId`, `selectedCampaignId`, `timeZone`, local date. (Current reconcile is a `useCallback`, not React Query — keep, just add deps.) Disposition `countsAsContacted` already flows from loaded `dispositions`.

### Phase F — Docs
- `AGENT_RULES.md` invariant #12/#14: header stats are selected-campaign scoped; daily reset uses user timezone; session duration cumulative per campaign/user-local-day; browser timers display-only; `dialer_daily_stats` legacy.
- `WORK_LOG.md` newest-first entry. This plan updated.

---

## 5. Files intended to touch (pending approval)
- `src/lib/supabase-dialer-stats.ts` (day-bound helper + `campaignId`/`timeZone` params + campaign filters)
- `src/pages/DialerPage.tsx` (reconcile passes campaign + tz; session-duration display from trusted total)
- `src/hooks/useDialerSession.ts` (session-duration display resume from trusted accumulated; `SessionStats` shape)
- `src/components/dialer/DialerHeaderStats.tsx` (only if label/help text changes)
- `src/lib/supabase-conversion.ts` + `src/lib/win-trigger.ts` + `src/components/layout/FloatingDialer.tsx` — **only if Decision A1** (thread `campaignId`/`organizationId`)
- A small day-bounds util + unit test (if extracted)
- `AGENT_RULES.md`, `WORK_LOG.md`, `implementation_plan.md`

## 6. Hard constraints honored
No `calls.duration` writes; no Twilio file/`answerOnBridge`/`TwilioContext` guard/queue changes; no disposition save-behavior change except the wins-linkage params (Decision A, approval required); no migration (all columns exist); RLS respected via explicit `.eq("organization_id", …)`; `.maybeSingle()` where zero rows possible; no mock data; Tailwind only if UI touched.

## 7. Verification plan
`npx tsc --noEmit`; `npm test -- --run`; static checks (no `calls.duration`/Twilio/migration; trusted stats require `campaignId`, use user-local bounds, never read `dialer_daily_stats`); runtime matrix per task spec after deploy.
