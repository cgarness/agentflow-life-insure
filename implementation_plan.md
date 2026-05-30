# Implementation Plan | Queue / Campaign Behavior — Build 3: Queue Metrics, Callback/Retry States, No-Eligible Messaging

**Status:** PLAN — awaiting Chris approval before modifying any source files or applying any migration
**Date:** 2026-05-29
**Production project:** `jncvvsvckxhqgqvkppmj`
**Production changes this session:** NONE (read-only audit only)
**Scope:** Team/Open queue metrics, callback ownership/due-time writes, retry-eligibility verification, no-eligible/exhausted messaging, auto-dial guardrails, Personal regression protection. NOT a Twilio build, NOT a stats build, NOT a Reports build, NOT a campaign-card stats build.

---

## 0. Build 3 goal

Make Team/Open and Personal queue behavior understandable and reliable around: live queue metrics, callback ownership/due-time, retry eligibility, no-eligible/next-eligible messaging, auto-dial guardrails, and Personal regression protection. One backend object (a read-only metrics RPC) is required because RLS blocks accurate client-side metrics; everything else is frontend.

---

## 1. Phase A — Read-only audit (COMPLETE)

### 1.1 Live schema confirmed (read-only, prod `jncvvsvckxhqgqvkppmj`)

| Object | Finding |
|--------|---------|
| `dialer_lead_locks` | Columns: `id, campaign_lead_id, campaign_id, locked_by, organization_id, locked_at, expires_at`. **There is NO `agent_id` column** (canonical is `locked_by`). |
| `dialer_lead_locks` RLS (SELECT) | `locked_by = auth.uid() OR (get_user_role() IN ('Admin','Team Leader','Team Lead') AND organization_id = get_org_id())`. **A regular Agent can only SELECT their OWN locks.** |
| `campaign_leads` | Has `scheduled_callback_at`, `callback_due_at`, `retry_eligible_at`, `callback_agent_id`, `callback_note` — all present (Build 1). |
| `appointments` | Among campaign/lead-ish columns only `contact_id` (polymorphic), `contact_name`, `status`. **No `campaign_id`, `campaign_lead_id`, or `lead_id`.** Linkage is `contact_id` + `user_id` only → appointment→campaign-lead priority cannot be built reliably. |
| `leads` | Time-ish columns: `phone`, `state`, `best_time_to_call` (free text). **No timezone column.** Lead-local calling-hour enforcement cannot be done safely. |
| `get_next_queue_lead` | Canonical claim RPC (confirmed live body). Eligibility predicate captured in §2.2 below — the metrics RPC will mirror it. Waterfall: owned callback (due ≤ now+5m) → new → retry. Uses `COALESCE(callback_due_at, scheduled_callback_at)`. |
| `renew_lead_lock` / `release_lead_lock` / `release_all_agent_locks` | Present, own-agent + org scoped, correct. |
| `get_queue_metrics` | **Does NOT exist** → Phase B needs a new migration. |

**Current data state:** 5 campaigns (4 PERSONAL, **1 TEAM**), **1 active lock** right now (Chris's live test). Callback data: 1 row has `scheduled_callback_at`, **0** rows have `callback_due_at`, **0** rows have `callback_agent_id`, 0 rows have `retry_eligible_at`. ⇒ existing callbacks were written to `scheduled_callback_at` with **no owner**, and Build 2's `retry_eligible_at` writes are not yet exercised in prod (Build 2 is local/not-deployed).

### 1.2 Frontend findings (the 18 required points)

1. **Where Queue tab counts come from today:** `QueuePanel` → `QueuePanelLocked` (Team/Open) computes counts via **direct client Supabase queries** in `fetchCounts()`.
2. **Cause of `0 locked / 0 active agents`:** TWO bugs. (a) `QueuePanelLocked` queries `dialer_lead_locks.select("agent_id")` — **`agent_id` does not exist** (canonical is `locked_by`), so that query errors → 0 rows. (b) Even with the right column, **RLS hides other agents' locks** from a regular Agent (and from the agent's own dialer if the lock row is filtered) → org-wide counts are impossible client-side. Confirmed it is a metrics/visibility issue, not a lock-serving issue.
3. **Queue tab reads `dialer_lead_locks` directly:** YES (the broken path).
4. **Queue tab counts all campaign leads, not callable ones:** YES. `total` = all non-`('DNC','Completed','Removed')` campaign_leads; `available = total − locked`. Ignores retry timing, suppressions, max attempts, callback timing/ownership, hard-claim ownership, other-agent locks.
5. **Queue tab polling:** YES — `setInterval(fetchCounts, 15000)`. No event-driven refetch after claim/save/skip/release.
6. **Callback due fields written today:** `scheduled_callback_at` only (DialerPage `saveCallData`, line ~2712). `callback_due_at` — not written. `callback_agent_id` — **not written**.
7. **Which due column new saves write:** `scheduled_callback_at`.
8. **Callback owner written:** NO (`callback_agent_id` never set) → callbacks are **not** user-owned today (rule-6 violation).
9. **`retry_eligible_at` written by Build 2 for retryable actual calls:** YES in code (`saveCallData` ~2851-2858) — but Build 2 is **not deployed**, so 0 rows in prod. Logic is present and correct (sets `now + retry_interval_minutes` for retryable; clears for terminal/owned).
10. **No-answer path writes `retry_eligible_at`:** YES in code (`autoSaveNoAnswer` ~2542). Present, not yet deployed.
11. **Appointment ↔ campaign-lead link:** NO reliable link (see §1.1). Document + defer.
12. **Lead timezone data:** NONE (see §1.1). Document + defer.
13. **Campaign calling-hour fields loaded in Dialer:** YES — `calling_hours_start/end` loaded in two config sites; fed to `checkCallingHours`.
14. **No-eligible/exhausted detection today:** `isQueueExhausted = !loadingLeads && !currentLead && !!selectedCampaignId`. UI shows generic "No Available Contacts In Queue." `nextAvailableTime` is derived from the **in-memory `leadQueue`** — but in lock mode `leadQueue` holds only the single current lead (or none), so next-eligible time is effectively never derivable in Team/Open.
15. **Next-eligible derivable from retry/suppression/callback/locks:** Only via a backend aggregate (client can't see the campaign-wide rows or other-agent locks under RLS). → fold `next_eligible_at` into the metrics RPC.
16. **Auto-dial loops when no eligible leads:** Guarded in Personal (`handleAdvance`/`handleSkip` Tier-4 check disables `autoDialEnabled`). In Team/Open, `loadLockModeLead` returning false sets empty queue → exhausted UI; the state machine won't arm without a `currentLead`. Acceptable; will verify no tight loop.
17. **Personal affected by Team/Open code:** Personal path is separate (`getNextLead` PERSONAL branch, no lock/heartbeat/suppression). Must keep it that way.
18. **Generated types stale for Build 1/2 fields:** YES — `renew_lead_lock`, `claim_lead`, `campaign_lead_agent_suppressions`, `campaigns.queue_filters`, `campaign_leads.callback_agent_id/callback_note` are absent or partial. Existing sanctioned pattern is the narrow `(supabase as any)` cast. The new `get_queue_metrics` RPC will likewise be called via a narrow cast (no full types regen) unless Chris prefers a regen.

### 1.3 Extra finding — pre-existing state→timezone approximation (calling hours)

`src/utils/dialerUtils.ts` `checkCallingHours(state, …)` **already approximates timezone from `lead.state`** via a `STATE_TO_TZ` map (defaulting unknown states to Eastern), and `useDialerStateMachine` uses it to **auto-skip** leads deemed outside calling hours during auto-dial. This is exactly the "approximate timezone from state" pattern Build 3 forbids introducing — but it **pre-dates** this build. **Decision needed (D3 below):** leave as-is (out of scope, pre-existing) vs. neutralize. Recommendation: document as a known divergence + defer removal to a dedicated calling-hours build (do not rip out auto-dial behavior in a metrics-focused build).

### 1.4 Audit verdict — what's fixable where

- **Needs migration (1):** `get_queue_metrics(p_campaign_id uuid)` SECURITY DEFINER read-only RPC (Phase B). RLS makes accurate client metrics impossible.
- **Frontend-only (no migration):** QueuePanelLocked rewired to the RPC + event refetch (Phase B); callback canonical write incl. owner (Phase C); retry verification (Phase E, mostly confirm); no-eligible messaging using RPC `next_eligible_at` (Phase F); auto-dial guardrail verification (Phase H); Personal regression checks (Phase I).
- **Defer (document, do not fake):** appointment queue priority (Phase D), lead-local calling-hour enforcement (Phase G).

---

## 2. Phase B — Queue tab live metrics RPC (REQUIRES MIGRATION)

### 2.1 New RPC: `public.get_queue_metrics(p_campaign_id uuid)`

- `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `STABLE`.
- Org via `get_org_id()`; `auth.uid()` for current-agent fields.
- Campaign access: org match; for TEAM, current agent must be in `assigned_agent_ids` (mirror `get_next_queue_lead` gate) — else return zeros.
- Returns **aggregate counts only** (no lead PII), one row:
  - `total_leads` — all `campaign_leads` in campaign/org.
  - `eligible_leads` — non-terminal (`status NOT IN ('DNC','Completed','Removed','Failed')`) AND under `max_attempts` (the "callable universe", ignoring time/lock/suppression).
  - `locked_leads` — active non-expired locks for the campaign.
  - `active_agents` — distinct `locked_by` among active locks.
  - `available_leads` — leads available to the **current agent right now** (full `get_next_queue_lead` predicate: non-terminal, under max attempts, `retry_eligible_at` null/≤now, callback ownership ok, `leads.assigned_agent_id` null/=me, not locked by another agent, not suppressed-for-me).
  - `suppressed_for_current_agent` — my active suppressions in this campaign.
  - `retry_blocked_leads` — otherwise-eligible leads with `retry_eligible_at > now()`.
  - `callback_waiting_leads` — owned upcoming callbacks (`callback_agent_id = me` AND `COALESCE(callback_due_at, scheduled_callback_at) > now()`).
  - `next_eligible_at` — MIN future timestamp across `retry_eligible_at`, owned `COALESCE(callback_due_at, scheduled_callback_at)`, my `suppressed_until`, and (for other-agent-locked otherwise-eligible leads) lock `expires_at`, that would make a lead available to me. NULL when something is available now or nothing will become available.
- Grants: `REVOKE … FROM PUBLIC`, `GRANT EXECUTE … TO authenticated`. Ends with `NOTIFY pgrst, 'reload schema';`.

### 2.2 Eligibility predicate to mirror (from live `get_next_queue_lead`)

```
status NOT IN ('DNC','Completed','Removed','Failed')
AND (max_attempts IS NULL OR COALESCE(call_attempts,0) < max_attempts)
AND (retry_eligible_at IS NULL OR retry_eligible_at <= now())          -- time gate
AND (callback_agent_id IS NULL OR callback_agent_id = auth.uid())       -- callback ownership
AND (leads.assigned_agent_id IS NULL OR leads.assigned_agent_id = auth.uid())  -- hard-claim ownership
AND NOT EXISTS(active lock by another agent)
AND NOT EXISTS(active suppression for me)
```
(Manager `queue_filters` are intentionally NOT applied to metrics in v1 to keep the RPC cheap and predictable; flag if Chris wants them applied — see D4.)

### 2.3 Frontend rewire (`QueuePanelLocked.tsx`)

- Replace `fetchCounts` direct queries with `supabase.rpc("get_queue_metrics", { p_campaign_id })` (narrow cast; RPC absent from generated types).
- Display:
  - Big number = `available_leads` (relabel sub-text to make it clearly "available to you now").
  - Pills: `Locked` = `locked_leads`, `Active Agents` = `active_agents`, `Available` = `available_leads`.
  - Add a clearly-labeled `Total` / `Eligible` line (distinguish total campaign leads from currently-callable) — addresses rule 11.
  - When `available_leads = 0` and `next_eligible_at` present, show "Next eligible in …".
- Keep 15s poll; **also** refetch on a lightweight event (see §2.4). **Do not** show `0 locked` while the current agent holds a lock (the RPC counts the agent's own lock via SECURITY DEFINER, so this is fixed by construction).
- Manager `queue_filters` editor section unchanged.

### 2.4 Event-driven refetch (small, surgical)

- Emit a `window` CustomEvent (e.g. `queue-metrics-refresh`) from DialerPage after: lead claim (`loadLockModeLead`), Save Only, Save & Next, Skip, End Session, lock release, and heartbeat-lock-lost. `QueuePanelLocked` listens and calls the RPC (debounced). Avoids prop-drilling into the ~3,800-line DialerPage and avoids over-polling.

---

## 3. Phase C — Callback canonicalization (frontend only)

**Decision (D1):** canonical write column = **`callback_due_at`** (matches `get_next_queue_lead`'s `COALESCE(callback_due_at, …)` first position). Keep writing `scheduled_callback_at` in sync for backward-compat (1 existing row + any other readers). Do not delete/rename either column.

In `saveCallData` callback branch:
- Write **all** of: `callback_due_at = callbackISO`, `scheduled_callback_at = callbackISO` (compat), `callback_agent_id = user.id`, `callback_note = noteText` (if non-empty).
- On **non-callback** dispositions, the existing "clear" branch must also clear `callback_due_at`, `callback_agent_id`, `callback_note` (today it only clears `scheduled_callback_at`) — otherwise a lead stays owned/queued forever.
- This makes callbacks **user-owned** (rule 6) and **5-min-early** surfacing already handled by the RPC's tier-0 (`≤ now + 5min`).
- Manual dial inside the 5-min-early window is allowed (today's behavior); auto-dial must not fire a callback before due time unless confirmed (verify in Phase H — the RPC already only surfaces owned callbacks within 5 min; an explicit not-due guard for auto-dial is added if QA shows early auto-calls).
- **Do not** build a full callback-management UI. **Do not** touch the appointment scheduler.

---

## 4. Phase D — Appointment behavior (DEFERRED, documented)

Confirmed: `appointments` has no reliable `campaign_id`/`campaign_lead_id`/`lead_id`. Document appointment queue priority as deferred; do not fake it; do not add appointment schema; leave the appointment scheduler intact. Record the future dependency (appointment↔campaign-lead link) in AGENT_RULES.

---

## 5. Phase E — Retry eligibility verification/fix (frontend, mostly confirm)

- Verified in code: retryable actual calls set `retry_eligible_at = now + retry_interval_minutes`; `autoSaveNoAnswer` sets it; skip uses suppression (no global retry write). Terminal/owned clear it. **Logic is correct and present** (Build 2, not yet deployed).
- **Only fix if a gap surfaces.** No change planned beyond confirming the path ships with Build 3 if Build 2 hasn't deployed separately. The metrics RPC then consumes `retry_eligible_at` for `retry_blocked_leads` / `next_eligible_at`.

---

## 6. Phase F — No eligible / exhausted states (frontend)

- Use `get_queue_metrics` to distinguish states in the Team/Open exhausted view:
  - `total_leads = 0` → "This campaign has no leads."
  - `eligible_leads = 0` (all terminal) → "Campaign complete — all leads processed."
  - `available_leads = 0` but `eligible_leads > 0` → "No eligible leads right now" + `next_eligible_at` ("Next eligible in …") when present.
  - `locked_leads > 0` with `available_leads = 0` → "All available leads are being dialed by other agents."
- Personal exhausted messaging stays as-is (uses in-memory queue; cheap).
- No expensive all-row browser scans; rely on the RPC. No full analytics panel.

---

## 7. Phase G — Calling-hour behavior (DEFERRED, documented)

- Keep campaign calling-hour fields loaded. Do not claim legal local-time enforcement. Document future dependency: lead timezone column/model or reliable resolver, with enforcement in the canonical claim RPC / metrics RPC.
- **D3 (decision):** the pre-existing `STATE_TO_TZ` approximation in `checkCallingHours` + auto-skip in the state machine. Recommendation: leave untouched this build (out of scope; removing it changes auto-dial), document as a known divergence to retire when a real timezone model lands. Alternative (if Chris wants): neutralize the state approximation now.

---

## 8. Phase H — Auto-dial guardrails (verify; repair only if needed)

- Verify: auto-dial stops on no eligible leads; no rapid polling loop; no double loop; no dial during wrap-up; no auto-dial before callback due time unless confirmed; no advance on save failure (already guaranteed by `if (success)` gating). Do not rebuild auto-dial. Add the smallest guard only if QA shows early callback auto-dial.

---

## 9. Phase I — Personal regression protection (verify)

- Confirm Personal still: no-lock flow, batch load, skip/save/save-next, no suppressions, no heartbeat, retry timing intact. No edits expected; verify only.

---

## 10. Phase J — Docs

- `implementation_plan.md` (this file).
- `AGENT_RULES.md` new invariants: Team/Open queue metrics come from `get_queue_metrics` (org-scoped SECURITY DEFINER), not direct client lock queries; metrics mirror canonical claim eligibility; "no leads" messaging distinguishes empty/exhausted from temporarily ineligible; callback ownership via `callback_agent_id`; new callback saves write canonical `callback_due_at` (+ `scheduled_callback_at` compat) + owner; appointment priority deferred (no link); lead-local calling-hour enforcement deferred (no timezone).
- `WORK_LOG.md` newest-first entry.

---

## 11. Files & DB objects intended to touch (AFTER approval)

| Object | Why | Migration? |
|--------|-----|-----------|
| `supabase/migrations/<ts>_get_queue_metrics_rpc.sql` (NEW) | Phase B metrics RPC | **YES — separate approval gate** |
| `src/components/dialer/QueuePanelLocked.tsx` | Phase B (RPC + display + event refetch), Phase F (state messaging) | No |
| `src/components/dialer/QueuePanel.tsx` | Pass-through props if needed for event refetch | No |
| `src/pages/DialerPage.tsx` | Phase C (callback owner/canonical column + clear), Phase F (Team/Open exhausted messaging via RPC), Phase B (emit refresh events). Surgical only. | No |
| `src/hooks/useLeadLock.ts` | Only if an event emit is cleaner here (TBD; likely DialerPage) | No |
| `src/integrations/supabase/types.ts` | Only if Chris prefers a types regen over `(supabase as any)` cast | No |
| `AGENT_RULES.md`, `WORK_LOG.md`, `implementation_plan.md` | Phase J docs | No |

**Explicitly NOT touched:** Twilio files, `twilio-voice-status`/`-webhook`, `answerOnBridge`, `TwilioContext.tsx` guards, Edge Functions, Reports, campaign-card stats, disposition settings, Sold/Convert gating, P0/P1 stats files, `calls.duration`, `claim_lead`/lock RPCs (unchanged), direct `leads.assigned_agent_id` client writes, broad DialerPage rewrite.

---

## 12. Decisions (RESOLVED 2026-05-29 by Chris)

- **D1 — Callback canonical column:** ✅ write `callback_due_at` as canonical + keep `scheduled_callback_at` in sync + write `callback_agent_id` + `callback_note`; clear all on non-callback dispositions. Neither column dropped/renamed.
- **D2 — Metrics RPC:** ✅ build `get_queue_metrics` as a new migration (RLS blocks client-side accuracy). Migration file written; apply gated separately.
- **D3 — Pre-existing state→TZ calling-hours approximation:** ✅ leave untouched + document as a known divergence to retire with a real timezone model.
- **D4 — Manager `queue_filters` in metrics:** ✅ NO in v1 (cheaper, predictable).
- **D5 — types.ts:** ✅ use narrow `(supabase as any)` cast for the new RPC; no full regen.

---

## 13. Verification before commit/push/deploy

1. `npx tsc --noEmit` → exit 0.
2. `npm test -- --run` → expect prior 90/90 (no test files changed unless a pure helper extracted).
3. Static: no Twilio files; no `calls.duration` write; no Reports/campaign-card-stats changes; no broad DialerPage rewrite; no unapproved migration applied.
4. Show diff summary. **STOP** before commit/push/deploy (separate approval). Migration apply is its own separate approval gate.

---

## 14. Context snapshot

| Item | Detail |
|------|--------|
| **Root cause (metrics)** | `QueuePanelLocked` queries nonexistent `dialer_lead_locks.agent_id` AND RLS hides other agents' locks from regular agents → `0 locked / 0 active`. |
| **Fix** | New `get_queue_metrics` SECURITY DEFINER RPC mirroring `get_next_queue_lead` eligibility; rewire panel + event refetch. |
| **Callbacks** | Today write `scheduled_callback_at`, no owner. Build 3 writes canonical `callback_due_at` + `callback_agent_id` (owner) + `callback_note`; clears all on non-callback. |
| **Retry** | Build 2 logic present + correct (not yet deployed); metrics RPC consumes `retry_eligible_at`. |
| **Deferred** | Appointment priority (no link), lead-local calling hours (no timezone). |
| **Migration** | ONE: `get_queue_metrics`. Separate apply approval. |
| **Production changes** | NONE this session. |

**Next step for Chris:** approve §12 decisions + §2-§10 plan → then I make surgical edits + write the migration file (no apply, no commit/push). Separate gates for migration apply and for commit/push/deploy. **Next build:** Queue Build 4 — campaign stats / cards.
