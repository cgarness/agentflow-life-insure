# Implementation Plan | P1 Build 3 — Trusted Dialer Stats from `calls`, `wins`, `dialer_sessions`

**Status:** PLAN — awaiting Chris's explicit approval before editing files
**Prerequisites:** P1 Build 1 (`20260529003210`) applied; P1 Build 2 merged (`2137da8`)

---

## 1. Goal

Rewire the Dialer's trusted daily/session stats to derive from the canonical sources:

| Stat | Trusted source |
|------|----------------|
| Calls made | count of outbound `calls` rows (agent + org + today) |
| Talk time | `SUM(calls.duration)` — Twilio-backed only |
| Contacted | `duration > 45 OR DNC disposition` (existing `report-utils.isContactedCall`) |
| Policies sold | count of `wins` rows (agent + org + today) |
| Session duration | `dialer_sessions` (ended/abandoned: `ended_at − started_at`; active: live `now − started_at`) |

`dialer_daily_stats` stays for legacy/display compatibility **only** — never the trusted source for talk time, contacted count, session duration, billing, or manager reporting.

---

## 2. Findings (read-only inspection)

- **`src/lib/supabase-dialer-stats.ts`** — `getTodayStats` / `upsertDialerStats` / `deleteTodayStats` all hit `dialer_daily_stats` via `increment_dialer_stats`. `upsertDialerStats` already always passes `p_session_duration_seconds: 0` (Build 2).
- **`src/pages/DialerPage.tsx`**:
  - L711 mount: `getTodayStats(user.id)` → `dialerStats` (drives `session_started_at` fallback + skeleton).
  - L728 `getTodayCallCount` already grounds `calls_made` from the `calls` table.
  - **L1820–1844 `handleHangUp`** — the forbidden pattern: `twilioCallDuration >= 7` counts the call as connected and feeds `calls_connected` + `total_talk_seconds` from the **browser timer**, then `upsertDialerStats({ calls_connected, total_talk_seconds })`.
  - L1808 `handleCall` — `upsertDialerStats({ calls_made, session_started_at })` (legacy display).
  - L2779 / L2806 — `upsertDialerStats({ policies_sold: 1 })` on converting dispositions (legacy display).
  - `sessionStats` (from `useDialerSession`) drives `DialerHeaderStats`; `dialerStats` only feeds `session_started_at` + `statsLoading`.
- **`src/components/dialer/DialerHeaderStats.tsx`** — labels: "Connected", "Answer Rate", "Avg Talk Time" all derive from `calls_connected`.
- **`src/hooks/useDialerSession.ts`** — owns `sessionStats` (`calls_made, calls_connected, total_talk_seconds, policies_sold`), server session id/started_at, live `sessionElapsedDisplay`.
- **`src/lib/report-utils.ts`** — `isContactedCall(duration, dispositionName, dncSet)` (>45s OR DNC) and `buildDNCDispositionSet(dispositions)` already exist and are reusable.
- **`calls`** has `agent_id, organization_id, direction, duration, disposition_name, created_at`. **`wins`** has `agent_id, organization_id, created_at`. **`dialer_sessions`** has `started_at, ended_at, last_heartbeat_at, status` (last two added in Build 1; **`types.ts` is stale** — needs `(supabase as any)` cast, no regen required).
- `DialerPage` already loads `dispositions` (with `dnc_auto_add`) → can build the DNC set client-side and pass it in.

**Conclusion: NO migration / RPC needed.** Three direct `select` queries (`calls`, `wins`, `dialer_sessions`) are sufficient and respect RLS + explicit `organization_id` filters.

---

## 3. Changes

### 3.1 `src/lib/supabase-dialer-stats.ts` (add helper; keep legacy fns)
Add:
```ts
export interface TrustedDialerStats {
  calls_made: number;
  contacted_calls: number;
  total_talk_seconds: number;
  policies_sold: number;
  session_duration_seconds: number;       // trusted: sum of completed sessions + live active delta
  active_session_id: string | null;
  active_session_started_at: string | null;
}

export async function getTrustedTodayDialerStats(args: {
  agentId: string;
  organizationId: string;
  date?: Date;                              // defaults to now; UTC calendar day to match getTodayCallCount
  dncDispositionNames?: Set<string>;        // lowercased DNC names from buildDNCDispositionSet
}): Promise<TrustedDialerStats>
```
- **calls** query: `.from("calls").select("duration, disposition_name, direction").eq("agent_id").eq("organization_id").gte/lt("created_at", dayBounds)`; filter outbound via `isCallsRowOutboundDirection`; `calls_made = rows.length`, `total_talk_seconds = Σ(duration ?? 0)`, `contacted_calls = rows.filter(r => isContactedCall(r.duration, r.disposition_name, dncSet)).length`.
- **wins** query: `count: "exact", head: true` with same agent/org/day → `policies_sold`.
- **dialer_sessions** query (`(supabase as any)`): rows for agent/org with `started_at` in day; for each completed (`ended_at` set) add `ended_at − started_at`; for the one `status='active'`/`ended_at IS NULL` row, record `active_session_id`/`active_session_started_at` and add live `now − started_at`. Clamp negatives to 0.
- Mark `upsertDialerStats` / `getTodayStats` / `deleteTodayStats` JSDoc as **legacy/display-only (`dialer_daily_stats`); not trusted**.

### 3.2 `src/hooks/useDialerSession.ts` (rename field)
- `SessionStats`: `calls_connected` → `contacted_calls`. Update initial state + reset. (No logic change to session lifecycle.)

### 3.3 `src/components/dialer/DialerHeaderStats.tsx` (labels)
- `sessionStats.calls_connected` → `contacted_calls`. Relabel "Connected" → **"Contacted"**, "Answer Rate" → **"Contact Rate"**, keep "Avg Talk Time" but divide by `contacted_calls`.

### 3.4 `src/pages/DialerPage.tsx` (reconcile from trusted; stop browser trusted feeds)
- Add `reconcileTrustedStats()` (useCallback): builds `dncSet = buildDNCDispositionSet(dispositions)`, calls `getTrustedTodayDialerStats({ agentId: user.id, organizationId, dncDispositionNames: dncSet })`, then `setSessionStats({ calls_made, contacted_calls, total_talk_seconds, policies_sold })`. (Session-duration display stays on live `sessionElapsedDisplay`.)
- Call `reconcileTrustedStats()`:
  1. on mount / when `user.id` + `organizationId` ready (replaces the trusted role of `getTodayStats`),
  2. on `selectedCampaignId` change,
  3. after a call ends (in `handleHangUp`, after `twilioHangUp()`),
  4. after `proceedSaveOnly` / `proceedSaveAndNext` success,
  5. after `endServerSession`.
- **`handleHangUp`**: delete the `twilioCallDuration >= 7` block (no more browser `calls_connected`/`total_talk_seconds` optimistic writes, no `upsertDialerStats({ calls_connected, total_talk_seconds })`). Keep `twilioHangUp()`; trigger reconcile (Twilio `calls.duration` lands via status callback, so reconcile slightly after / on next save is the source of truth).
- **`handleCall`**: keep optimistic local `calls_made + 1`; `upsertDialerStats({ calls_made, session_started_at })` retained **legacy display-only** (does not feed trusted talk/connected/session).
- **Converting dispositions (L2779/2806)**: keep optimistic local `policies_sold + 1`; `upsertDialerStats({ policies_sold: 1 })` retained legacy display-only; trusted total reconciles from `wins`.
- `getTodayStats` mount load (L711): keep only for `statsLoading` skeleton + `session_started_at` fallback, OR fold into reconcile. Will keep `dialerStats` for `session_started_at` display fallback to minimize churn.

### 3.5 Docs
- `AGENT_RULES.md` — extend invariant #12 with the Build 3 decision (trusted stats now read from `calls`/`wins`/`dialer_sessions`; browser no longer feeds contacted/talk/session-duration; `dialer_daily_stats` legacy-only).
- `WORK_LOG.md` — newest-first entry.

---

## 4. Files to touch

| File | Change |
|------|--------|
| `src/lib/supabase-dialer-stats.ts` | add `getTrustedTodayDialerStats` + `TrustedDialerStats`; legacy JSDoc |
| `src/hooks/useDialerSession.ts` | `calls_connected` → `contacted_calls` |
| `src/components/dialer/DialerHeaderStats.tsx` | field rename + labels |
| `src/pages/DialerPage.tsx` | reconcile helper + call sites; remove browser connected/talk feeds |
| `AGENT_RULES.md` | invariant #12 update |
| `WORK_LOG.md` | new entry |
| `implementation_plan.md` | this file |

**NOT touched:** migrations, Twilio files (`twilio-voice-status`/`-webhook`), `TwilioContext.tsx`, `calls.duration` writes, queue RPCs, disposition behavior, `answerOnBridge`, Reports surfaces (Build 4).

---

## 5. Verification

1. `npx tsc --noEmit` → exit 0.
2. `npm test -- --run`.
3. Static: no `calls.duration` write added; no Twilio file changed; no migration; no trusted read from `dialer_daily_stats`; no browser `>= 7s` connected logic; browser no longer feeds trusted connected/talk/session.
4. Runtime (after deploy approval): start session → answered call → talk time = Twilio `calls.duration`; no-answer → no talk/contacted bump; Save & Next → stats reconcile; end session → duration from `dialer_sessions`; policies sold from `wins`.

---

## 6. Open question for Chris

- OK to **rename the header stat "Connected" → "Contacted"** (and "Answer Rate" → "Contact Rate")? This aligns the UI with the trusted `report-utils` definition (>45s OR DNC). If you'd rather keep the "Connected" label, I'll keep the label text and just back it with the trusted contacted value.
