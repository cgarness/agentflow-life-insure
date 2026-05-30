# Implementation Plan | Queue / Campaign Behavior — Build 2: Frontend Queue Lifecycle Wiring

**Status:** PLAN — awaiting Chris approval before modifying any source files
**Date:** 2026-05-29
**Production project:** `jncvvsvckxhqgqvkppmj`
**Production changes this session:** NONE (read-only audit done; no migration intended)
**Scope:** Frontend Team/Open queue lifecycle only. No migrations (Build 1 schema already applied). No Twilio. No P0/P1 stat logic. No disposition-save behavior except where the hard-claim decision *reads* existing disposition flags. No Sold/Convert gating change. No Reports. No campaign-card stats. No broad `DialerPage` rewrite.

---

## 0. Build 2 goal

Wire the live frontend Team/Open lifecycle to the Build 1 backend that already shipped: fix the lock RPC arg names, make the 30s heartbeat real, make Save Only keep the lock, make Save & Next release it, make Skip write a per-agent suppression instead of a global retry write, set `retry_eligible_at` for genuinely retryable actual calls, and align hard claim to `duration > 45 OR counts_as_contacted` (excluding system No Answer) via `claim_lead`. Personal campaigns stay no-lock/private.

**Production safety:** 4 Personal campaigns, **0 Team/Open**, 0 active locks today — so the broken lifecycle is unexercised. Changes are safe to land before any Team/Open campaign exists.

---

## 1. Phase A — Read-only frontend audit (COMPLETE)

### Real file structure (verified, not assumed)

| File | Role today |
|------|-----------|
| `src/hooks/useLeadLock.ts` | **LIVE.** `getNextLead` → `get_next_queue_lead` (Personal → direct query). `releaseLock`/`startHeartbeat` pass **`p_lead_id`** (wrong arg name). `stopHeartbeat`. `HEARTBEAT_INTERVAL_MS = 30_000`, `LOCK_TTL_MINUTES = 5`. |
| `src/hooks/useHardClaim.ts` | **LIVE.** `startClaimTimer` (30s timer → `claim_lead`), `cancelClaimTimer`, `claimOnDisposition` (claims if `durationSeconds > 0`). Uses `claim_lead(p_campaign_lead_id, p_lead_id, p_campaign_id)`. |
| `src/pages/DialerPage.tsx` (~3,800 lines) | **LIVE orchestrator.** `loadLockModeLead` (911), `handleAdvance` (1589), `handleSkip` (1636), `handleEndDialerSession` (1730), `beforeunload` effect (2382), inbound-answer claim-timer effect (2401), `saveCallData` (2511), `proceedSaveOnly` (2786), `proceedSaveAndNext` (2819). |
| `src/lib/dialer-queue.ts` | `releaseAllAgentLocks` / `releaseAllAgentLocksBeacon` (**LIVE**, used by DialerPage). `fetchNextQueuedLead` → `fetch_and_lock_next_lead` + `buildFiltersFromQueueState` = **DEAD** (imported nowhere). Header comment still says "90-second TTL" (stale). |
| `src/lib/dialer-api.ts` | `saveCall` (359) — on every actual-call save **increments `call_attempts` + sets `last_called_at`** when `campaign_lead_id` present; persists `disposition_id`. `updateLeadStatus` (520). Does **not** set `retry_eligible_at`. |
| `src/lib/queue-manager.ts` | `applyDispositionToQueue` / `getLeadTier` — **in-memory** queue reorder + local `retry_eligible_at` (Personal). No DB write. |
| `src/integrations/supabase/types.ts` | Generated types (see §1, point 12 below). |

### Phase A confirmation checklist (the 14 required points)

1. **`DialerPage` claims through `get_next_queue_lead`** — ✅ via `loadLockModeLead` → `useLeadLock.getNextLead`.
2. **`fetchNextQueuedLead` / `fetch_and_lock_next_lead` dead/non-canonical** — ✅ DEAD. `DialerPage` imports only `releaseAllAgentLocks` + `releaseAllAgentLocksBeacon` from `dialer-queue.ts`. `fetchNextQueuedLead` imported nowhere.
3. **`release_lead_lock` passes wrong arg name** — ✅ TRUE. `useLeadLock.releaseLock` sends `{ p_lead_id: leadId }`; canonical RPC arg is `p_campaign_lead_id`. **The value passed is already `campaign_leads.id`** (callers pass `currentLead.id`), so only the key name is wrong.
4. **`renew_lead_lock` wrong arg / no-op** — ✅ TRUE. Heartbeat sends `{ p_lead_id: leadId }`; canonical arg `p_campaign_lead_id`. Until renamed, renewal is a server no-op (every heartbeat silently fails to match → lock would expire at 5min TTL).
5. **Lock object knows `campaign_lead_id`** — ✅. `getNextLead` returns the `campaign_leads` row; `lock.id` **is** `campaign_leads.id`. `loadLockModeLead` passes `lock.id` to `startHeartbeat` and re-queries `campaign_leads … eq("id", lock.id)`. `currentLead.id` = `campaign_leads.id` throughout.
6. **Save Only — releases or keeps lock?** — ❌ **BUG: Save Only RELEASES the lock.** Both Save Only and Save & Next call `saveCallData`, which (lines 2693-2712) for `lockMode` runs `claimOnDisposition` → `stopHeartbeat()` → `releaseLock()` → `lockReleased = true`. So Save Only wrongly drops the lock and stops the heartbeat. **Must fix (Phase D).**
7. **Save & Next release** — ✅ releases (via the same `saveCallData` block) then `proceedSaveAndNext` lock-mode branch (2835-2849) `stopHeartbeat` + `releaseLock` + `loadLockModeLead`. Net behavior correct, but the release currently lives in `saveCallData` (shared with Save Only) — needs to move so it is Save & Next-only.
8. **Skip behavior** — ❌ Partially wrong. `handleSkip` (1636): cancels claim timer; **writes `campaign_leads.retry_eligible_at = now + retryIntervalHours` and `status='Called'` globally** (rule-7 violation — that hides the lead from *everyone* and looks like a real attempt); then `stopHeartbeat` + `releaseLock` + `loadLockModeLead`. It does **not** write a per-agent suppression and does **not** increment `call_attempts` (no `saveCall`). **Must fix (Phase E).**
9. **End Session / beforeunload / queue exhausted release** — ✅ present. `handleEndDialerSession` (1730) → `releaseAllAgentLocks(campaignId)` + `stopHeartbeat` + `cancelClaimTimer`. `beforeunload` (2382) → `releaseAllAgentLocksBeacon` (keepalive fetch) + `stopHeartbeat`. Queue-exhausted: `loadLockModeLead` returns false and sets empty queue (lock already released before re-fetch). No cross-agent release (server RPCs scope to `locked_by = auth.uid()`). No Personal lock behavior.
10. **Hard-claim threshold / disposition path** — ❌ Wrong threshold. Auto-claim timer = **30s** (`CLAIM_TIMER_MS`); `claimOnDisposition` claims when `durationSeconds > 0` (any connected time). Product rule = `> 45s` OR `counts_as_contacted`, excluding system No Answer. **Must fix (Phase H).**
11. **`claim_lead` called after meaningful Team/Open contact** — ✅ `useHardClaim` calls `claim_lead(p_campaign_lead_id, p_lead_id, p_campaign_id)` (correct signature). No direct client write to `leads.assigned_agent_id` anywhere. Only the *trigger condition* is wrong (see #10).
12. **Generated types include Build 1 schema/RPCs?** — Partially:
    - `get_next_queue_lead` ✅ (`p_campaign_id`, `p_filters?`).
    - `release_lead_lock` ✅ typed with **`p_campaign_lead_id`** (canonical) — so the rename in Phase B aligns *toward* the types, not away.
    - `release_all_agent_locks` ✅.
    - `fetch_and_lock_next_lead` ✅ (dead path).
    - **MISSING:** `renew_lead_lock`, `claim_lead`, table `campaign_lead_agent_suppressions`, `campaigns.retry_interval_minutes`, `campaigns.queue_filters`, `campaign_leads.callback_agent_id`, `campaign_leads.callback_note`.
    - **Empirical fact:** `npx tsc --noEmit` currently exits **0** even though `claim_lead`/`renew_lead_lock` are absent and `release_lead_lock` is called with the *wrong* key `p_lead_id`. ⇒ This project's `supabase.rpc(...)` calls are **not** strictly arg-checked against generated types in practice, so renaming the keys and calling `renew_lead_lock` will not break tsc. **Tables absent from generated types DO error** on `.from(...)` (strongly typed) — the codebase already uses the `(supabase as any).from("dialer_queue_state")` pattern (DialerPage 1090, 1740) for exactly this. **Decision (Phase E): write suppressions via the same narrow `(supabase as any)` cast** with an inline comment, rather than regenerating `types.ts`, to keep the diff surgical and avoid a full types churn. (If Chris prefers, I can regenerate `types.ts` instead — flag below.)
13. **`campaigns.retry_interval_minutes` selected where campaign config loads?** — ❌ No. DialerPage reads only `retry_interval_hours` in three places (syncSettings 2133/2174, 2248/2255, and `loadWithResume` 1054). `retryIntervalHours` state drives skip/retry math. **Phase F adds a `retry_interval_minutes` read** (preferred, fall back to `hours*60`).
14. **Can the frontend upsert suppression rows under RLS?** — Yes. Build 1 created `campaign_lead_agent_suppressions` with RLS: own-row INSERT/UPDATE/DELETE require `agent_id = auth.uid() AND organization_id = public.get_org_id()`. The unique constraint is **`(organization_id, campaign_lead_id, agent_id, reason)`** (Build 1 §4.7) ⇒ `onConflict: "organization_id,campaign_lead_id,agent_id,reason"` is valid for `.upsert()`.

---

## 2. Phase B — Fix lock RPC argument names (`useLeadLock.ts`)

- `releaseLock`: rename the param to `campaignLeadId` and call `release_lead_lock({ p_campaign_lead_id: campaignLeadId })`. **Do not pass `p_lead_id`.**
- heartbeat (inside `startHeartbeat`): call `renew_lead_lock({ p_campaign_lead_id: campaignLeadId })`.
- Rename the `startHeartbeat(leadId, …)` param to `campaignLeadId` for clarity; **value is unchanged** (callers already pass `lock.id` / `currentLead.id` = `campaign_leads.id`).
- Update the JSDoc to state `campaign_lead_id` is `campaign_leads.id`.
- DialerPage call sites already pass `currentLead.id` (= `campaign_leads.id`) — **no DialerPage change needed for the rename itself.**

---

## 3. Phase C — Heartbeat (`useLeadLock.ts` + `DialerPage.tsx`)

- Mechanism already exists (`startHeartbeat` 30s interval, `stopHeartbeat`, `onLockLost`). Phase B makes the renew call actually hit the lock.
- On renew failure (network error): `console.error`, **do not** crash, **do not** advance.
- On `data === false` (lock lost): keep existing `onLockLost` callback in `loadLockModeLead` (975) which silently re-fetches the next lead. Add a low-noise user-safe toast only if it proves necessary in runtime QA (default: no toast, to avoid false alarms — log only). **No silent advance.**
- Stop conditions already wired: release (Save & Next / Skip / advance), End Session, campaign change (effect re-run), unmount, queue exhausted. **Verify** Personal never starts a heartbeat — confirmed: `startHeartbeat` is only called inside `loadLockModeLead`, which only runs for `lockMode` campaigns. No change needed for Personal.

---

## 4. Phase D — Save Only / Save & Next (`DialerPage.tsx`)

**Root issue:** lock release + `stopHeartbeat` currently live inside `saveCallData` (shared by both buttons), so **Save Only wrongly releases**.

**Fix (surgical):**
- **Remove** the `stopHeartbeat()` + `releaseLock()` + `lockReleased = true` block from `saveCallData`'s success path (lines 2708-2711) — but **keep the hard-claim call** (`claimOnDisposition`) there (claim should happen on any qualifying save, Save Only included).
- **Keep** the `finally` safety-release **only for the failure case is wrong** — re-scope it: the `finally` net must **not** release on a successful Save Only. Replace the blanket `finally` release with: release only happens in the Save & Next path (below). For Save Only the lock is retained. (The `finally` block's original intent — "don't leak a lock if a step threw" — is preserved by keeping release in the explicit Save & Next branch + the existing End Session/beforeunload paths; a thrown Save Only leaves the lead on screen with its lock, which is the desired "stay on lead" behavior.)
- **`proceedSaveOnly`:** after a successful save — keep lead on screen, **do not** release lock, **do not** stop heartbeat, **do not** fetch next. (Today it already doesn't advance; the only change is that the lock/heartbeat are no longer killed by `saveCallData`.)
- **`proceedSaveAndNext` (lockMode branch, 2835-2849):** keep as the **only** place that, on success, `stopHeartbeat()` → `releaseLock(currentLead.id)` → `loadLockModeLead()`. This already exists; it becomes the sole release site once `saveCallData` no longer releases.
- **Save failure does not advance** — already guaranteed by `if (success)` gating in both `proceed*` handlers. No change needed (rule 14 already holds); will re-verify.

---

## 5. Phase E — Skip suppression (`DialerPage.tsx`, optionally a small `useLeadLock`/`dialer-queue` helper)

Rewrite the Team/Open branch of `handleSkip`:
- **Remove** the global `campaign_leads.update({ retry_eligible_at, status:'Called' })` write (rule-7 violation).
- **Do not** increment `call_attempts` (already not done — no `saveCall`).
- **Upsert** a per-agent suppression row into `campaign_lead_agent_suppressions` with all RLS-required fields:
  - `organization_id` (from `organizationId`), `campaign_id` (`selectedCampaignId`), `campaign_lead_id` (`currentLead.id`), `agent_id` (`user.id` — must equal `auth.uid()`), `suppressed_until = now + retry_interval_minutes`, `reason: 'skip'`.
  - `.upsert(row, { onConflict: "organization_id,campaign_lead_id,agent_id,reason" })`.
  - **Fallback** if the conflict target proves unreliable at runtime: update-then-insert (documented). Default attempt = upsert.
  - Written via `(supabase as any).from("campaign_lead_agent_suppressions")` (table absent from generated types — same pattern as `dialer_queue_state`), with an inline comment.
- Then `stopHeartbeat()` → `releaseLock(currentLead.id)` → `loadLockModeLead()` (return lead to pool for *other* agents; suppressed only for the skipping agent — server `get_next_queue_lead` already excludes the current agent's active suppressions).
- **Personal skip path unchanged** (local `_skipped` marker; no suppression, no lock).
- `retry_interval_minutes` value: read from the loaded campaign config (Phase F adds the field). If unavailable, fall back to `retryIntervalHours * 60`, else 1440.

---

## 6. Phase F — Retry eligibility for actual retryable calls (`DialerPage.tsx` + campaign config read)

**Add a `retry_interval_minutes` read** alongside the existing `retry_interval_hours` selects (syncSettings + `loadWithResume`). Prefer minutes; fall back to `hours*60`. Store in a `retryIntervalMinutes` state (or derive from existing `retryIntervalHours` when minutes absent). Keep `retryIntervalHours` for the existing local-queue math to avoid a broad refactor.

**Set `retry_eligible_at` on genuine retryable actual calls** (an actual call was placed → `saveCall` already incremented attempts). In `saveCallData`, after the call save, compute retryability from the selected disposition + outcome and **update `campaign_leads.retry_eligible_at = now + retry_interval_minutes`** when retryable:
- **Retryable:** no-answer / busy / failed-or-canceled-after-dial / other non-terminal outcomes. (System `No Answer` IS retryable for *re-dialing* — it just never *contacts/claims*; setting its `retry_eligible_at` is correct and matches existing `autoSaveNoAnswer` intent.)
- **NOT retryable (leave `retry_eligible_at` null / let terminal status exclude it):** DNC, Removed, Sold/Converted, Appointment/Callback that is now scheduled/owned, terminal campaign actions. Detect via existing flags already in scope: `selectedDisp.campaignAction === 'remove_from_campaign'`, `selectedDisp.dncAutoAdd`, `isConvertedDisposition(...)`, `selectedDisp.callbackScheduler`, `selectedDisp.appointmentScheduler`.
- This is a **targeted `campaign_leads.update`** in the save path — does not change disposition-save semantics, P0/P1 stats, or queue architecture.
- **`autoSaveNoAnswer`** (No Answer auto-path) should also get `retry_eligible_at` set so re-dial timing isn't broken (currently it only saves the call + advances). Surgical add of the same update.
- **Skip stays suppression-only** (Phase E) — no `retry_eligible_at`, no attempt increment, no global write.

Keep this minimal — **no** full callback/retry/exhausted UI (Build 3).

---

## 7. Phase G — End Session / browser close / queue exhausted (verify; minimal change)

- `release_all_agent_locks` on End Session — ✅ present (`handleEndDialerSession`). No change.
- beacon/`beforeunload` release — ✅ present (`releaseAllAgentLocksBeacon`, keepalive fetch). No change.
- Queue exhausted releases current lock — current order in advance/skip/save is **release → re-fetch**, so the lock is already gone before exhaustion is detected. ✅. No cross-agent release (server scopes to `auth.uid()`). ✅. No Personal lock behavior. ✅.
- **Net: Phase G is verify-only**; no edits expected unless runtime QA reveals a gap.

---

## 8. Phase H — Hard claim (`useHardClaim.ts` + `DialerPage.tsx` inbound-answer effect + save path)

**Rule:** Hard claim = `duration > 45` OR `counts_as_contacted` OR `callbackScheduler`, **excluding system No Answer AND DNC**.

- **`claimOnDisposition`**: pass the selected `Disposition` object (carries `countsAsContacted`, `dncAutoAdd`, `callbackScheduler`, `name` — all on the model) instead of only the name string, so the hook can evaluate the ordered rule below. The only allowed disposition-name check remains the canonical system `No Answer` (`name === 'No Answer'`, via the existing `isSystemNoAnswerName` rule); no other label matching.
- **Ordered claim decision (short-circuit, in order):**
  1. System `No Answer` → **do not claim**.
  2. DNC / `disposition.dncAutoAdd === true` → **do not claim**.
  3. Else `durationSeconds > 45` → claim via `claim_lead`.
  4. Else `countsAsContacted === true` → claim via `claim_lead`.
  5. Else `callbackScheduler === true` → claim via `claim_lead`.
  6. Else → no claim.
- DNC must be excluded **before** the `countsAsContacted` check (DNC schedulers may be backfilled `counts_as_contacted = true` — we must not claim a number we're suppressing).
- **DNC still:** saves the call/disposition (unchanged save path), adds to `dnc_list`, terminally excludes from the queue (`status='Removed'`/DNC handling unchanged), and stays attributable to the agent via `calls.agent_id` / `calls.disposition_id` / `calls.disposition_name` + activity/DNC records. Only the **ownership `claim_lead` call** is skipped for DNC. (DNC reporting/analytics = deferred to Reports/Campaign Stats build.)
- **Auto-claim timer** (`CLAIM_TIMER_MS`): set to **46s / 46_000ms** so a still-connected live call auto-claims just past the `> 45s` threshold (avoids 45.0 boundary ambiguity). Keeps the "claim while talking" UX without waiting for disposition.
- **Callback disposition** → hard-claims via the `callbackScheduler` branch (ownership-critical — callbacks must return to the owning agent), even if `counts_as_contacted` is mis-toggled off.
- **Not Interested** hard-claims only if its `counts_as_contacted` is on — automatic, no special case.
- **No write to `calls.duration`.** **No contacted-stats logic change.** **`claim_lead` stays the sole ownership writer.**
- Inbound-direction calls already skip the claim ring (effect 2405) — unchanged.

---

## 9. Phase I — Dead/dual path cleanup (`dialer-queue.ts`, comments only)

- **Do not delete** `fetchNextQueuedLead` / `fetch_and_lock_next_lead`.
- Add a header comment in `dialer-queue.ts` that **`get_next_queue_lead` (via `useLeadLock`) is the canonical claim path** and `fetchNextQueuedLead` is dead/deprecated; fix the stale "90-second TTL" comment (Build 1 made it a 5-min wrapper). Confirm the active Dialer path never imports `fetchNextQueuedLead` (it doesn't). No behavior change.

---

## 10. Phase J — Docs

- **`implementation_plan.md`** — this file.
- **`AGENT_RULES.md`** — extend invariant #15 (or add #16) with the Build 2 frontend lifecycle invariants:
  - Lock renew/release use **`p_campaign_lead_id`** (= `campaign_leads.id`).
  - Save Only **keeps** the Team/Open lock + heartbeat; Save & Next **releases** + advances.
  - Skip writes a per-agent `campaign_lead_agent_suppressions` row (`reason='skip'`, `suppressed_until = now + retry_interval_minutes`) then releases — never a global `retry_eligible_at`/attempt write.
  - Retryable **actual** calls set `campaign_leads.retry_eligible_at = now + retry_interval_minutes`; attempts increment only when an actual call was placed (via `saveCall`).
  - Hard claim = `duration > 45` OR `counts_as_contacted`, excluding system `No Answer`, via `claim_lead`; never a direct `leads.assigned_agent_id` client write.
  - Personal campaigns remain no-lock/private.
  - `(supabase as any).from("campaign_lead_agent_suppressions")` is the sanctioned access pattern until `types.ts` is regenerated (same precedent as `dialer_queue_state`).
- **`WORK_LOG.md`** — newest-first Build 2 entry.

---

## 11. Files intended to touch (Build 2)

| File | Why |
|------|-----|
| `src/hooks/useLeadLock.ts` | Phase B (arg rename `p_campaign_lead_id`), Phase C (heartbeat JSDoc). |
| `src/hooks/useHardClaim.ts` | Phase H (`>45 OR counts_as_contacted` excl. No Answer; timer 30→45s; accept Disposition flag). |
| `src/pages/DialerPage.tsx` | Phase D (Save Only keeps lock / move release to Save & Next), Phase E (skip→suppression upsert), Phase F (`retry_interval_minutes` read + `retry_eligible_at` write on retryable saves incl. `autoSaveNoAnswer`), Phase H (pass disposition to `claimOnDisposition`, claim-timer wiring). |
| `src/lib/dialer-queue.ts` | Phase I (canonical-path comments; fix stale "90s TTL"). Comments only. |
| `AGENT_RULES.md` | Phase J invariants. |
| `WORK_LOG.md` | Phase J entry. |
| `implementation_plan.md` | This plan. |

**Explicitly NOT touched:** `src/integrations/supabase/types.ts` (using `(supabase as any)` cast for suppressions — unless Chris prefers a regen), `src/lib/dialer-api.ts` (saveCall already increments attempts; retry write lives in DialerPage to keep the API stable), Twilio files, `TwilioContext.tsx` guards, Supabase migrations, Edge Functions, Reports, campaign-card stats, disposition settings, `ConvertLeadModal` / Sold gating, P0/P1 stat logic, `calls.duration`, `answerOnBridge`.

---

## 12. Decisions (RESOLVED 2026-05-29 by Chris)

1. **Suppression table access:** ✅ Use the **`(supabase as any).from("campaign_lead_agent_suppressions")`** cast (matches `dialer_queue_state` precedent). `types.ts` left untouched.
2. **Heartbeat lock-lost UX:** ✅ **Log-only + silent re-fetch** (no toast). Revisit in runtime QA.
3. **Hard-claim trigger source:** ✅ Claim on `duration > 45` OR `counts_as_contacted` **OR `callbackScheduler`**, excluding system `No Answer` **AND DNC/`dncAutoAdd`** (DNC excluded *before* the `counts_as_contacted` check). Ordered short-circuit per Phase H. Auto-claim timer = **46_000ms**. DNC still saves call/disposition, adds to DNC list, terminally excludes from queue, and stays agent-attributable via `calls.*` — only the `claim_lead` ownership call is skipped. DNC reporting/analytics deferred to Reports/Campaign Stats.

---

## 13. Verification before push/deploy

1. `npx tsc --noEmit` → expect exit 0.
2. `npm test -- --run` → expect prior 90/90 (no test files changed; add none unless a pure helper is extracted).
3. Static checks: no Twilio files in diff; no `calls.duration` write; no migration; no P1 stats files; no Reports files; no broad `DialerPage` rewrite (surgical diffs only); no direct `leads.assigned_agent_id` client write.
4. Show diff summary.
5. **STOP** before commit/push/deploy — separate explicit approval.

## 14. Runtime verification after deploy (Chris-driven, needs a Team/Open campaign)

Personal still works; first agent gets one locked lead; heartbeat renews (lock survives past 5min while viewing); second agent can't get the same active lead; Save Only keeps lock + stays on lead; Save & Next releases + advances; Skip suppresses only for the skipper and frees it for others; Open Pool contention same; browser close releases (beacon) or expires at TTL; no-answer increments attempts only on an actual call; retryable actual call sets `retry_eligible_at`; save failure does not advance; hard claim only on `>45s` or `counts_as_contacted`; hard claim uses `claim_lead`; No Answer never hard-claims; DNC excluded from future dialing; P0 duration stays Twilio-backed.

---

## 15. Context snapshot
| Item | Detail |
|------|--------|
| **Canonical claim** | `get_next_queue_lead` via `useLeadLock.getNextLead` (live). `fetch_and_lock_next_lead`/`fetchNextQueuedLead` dead. |
| **Key bugs found** | Save Only releases the lock (shared `saveCallData` release); heartbeat + release pass `p_lead_id` (no-op renew); skip writes global `retry_eligible_at`+`status='Called'` instead of per-agent suppression; hard claim at 30s / `>0s` instead of `>45s OR counts_as_contacted`; `retry_eligible_at` never written on retryable actual calls (DB); `retry_interval_minutes` not read by frontend. |
| **No migration** | Build 1 schema already applied; suppressions written via `(supabase as any)` cast. |
| **Left unchanged** | Twilio/P0/P1 stats, disposition-save semantics (beyond reading flags for claim + retry), Sold/Convert gating, Reports, campaign-card stats, `calls.duration`. |
| **Production changes** | NONE this session. |

**Next step for Chris:** approve §12 decisions + §2-§10 plan → then I make the surgical edits (no commit/push). Separate approval gates for commit/push and any future migration. **Next build:** Queue Build 3 — callback / retry / exhausted-state behavior UI + appointment priority + lead-local calling window.
