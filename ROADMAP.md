# AgentFlow | Living Roadmap 🚀

**Owner:** Chris Garness | **Last Updated:** April 6, 2026
**Niche Focus:** Life Insurance Agencies (High-Velocity CRM & Power Dialer)

---

## 1. System Status & Module Health

### 🔐 Authentication & Tenant Isolation `[STABLE]`
- **State**: Supabase Auth triggers `profiles` mirroring. Multi-tenant isolation is enforced via custom JWT claims (`organization_id`, `role`) and hierarchical `ltree` logic for downline management.
- **Recent Update**: Standardized `leads.user_id` and implemented `standardize_leads_user_id.sql` to ensure perfect ownership tracking.
- **Next Up**: Finalize invitation logic for Managers to invite downline Agents with auto-assigned `upline_path`.

### 🏗️ Database Infrastructure `[AUDITED — REWORKING]`
- **State**: The core table audit (Step 2) identified critical missing root objects.
- **Gaps**: Missing physical `organizations` table, `tasks` (follow-ups), and `dial_sessions` (metrics blocks).
- **Next Up**: Execute **SaaS Core Migration Block** to create `organizations` (multi-tenancy root), `tasks`, and `dial_sessions`.

### 📞 Power Dialer & Telephony `[PRODUCTION-READY]`
- **State**: 1-Line WebRTC Dialer (Telnyx) with Auto-Dial support. State management is decentralized via Supabase Edge functions and real-time triggers.
- **Features**: Smart Caller ID (Local Presence), Answering Machine Detection (AMD), Ring Timeout, and mandatory dispositions.
- **Next Up**: Optimize campaign refresh logic and integrate `dial_sessions` to track agent efficiency in real-time.

### 💼 SaaS & Infrastructure `[PLANNED — CRITICAL]`
- **State**: Entirely missing billing and SaaS partitioning layer.
- **Features Required**: Stripe integration, subscription tiers (Starter, Pro, Agency), and plan-based limiting (User caps, Dialing limits).
- **Next Up**: Initialize Stripe SDK and construct the `billing` Edge Function for subscription lifecycle management.

---

## 2. Recent Database Migration History (April 2026)

| Migration ID | Topic | Outcome |
| :--- | :--- | :--- |
| `20260404000000` | `standardize_leads_user_id.sql` | Aligned all lead ownership to unified `user_id` field for RLS performance. |
| `20260404000001` | `fix_leads_user_id_drift.sql` | Repaired historical lead data drift where ownership mapping was disconnected. |
| `20260404100000` | `dialer_rls_audit.sql` | Hardened Row-Level Security for campaigns and dialer state components. |
| `20260405000000` | `sync_leads_user_id_trigger.sql` | Added real-time trigger to sync master lead ownership with campaign states. |
| `20260405100000` | `smart_queue_lock_system.sql` | Atomic fetch-and-lock for Team/Open Pool campaigns. `dialer_lead_locks` table + 3 RPCs. |
| `20260406000000` | `hard_claim_engine.sql` | `claim_lead` RPC (SECURITY DEFINER) for permanent ownership transfer via `leads.assigned_agent_id`. Added `queue_filters` JSONB column to `campaigns`. |

---

## 3. Work Log (Recent History)

- **2026-04-06 | [DONE] Total Leads Auto-Trigger**
  *Migration:* `20260406100000_campaign_leads_count_trigger.sql`
  *Files Modified:* `src/pages/CampaignDetail.tsx`, `src/components/contacts/AddToCampaignModal.tsx`, `ROADMAP.md`
  *Developer Note:* Replaced 6 manual `total_leads` count-and-update calls with a single Postgres trigger (`trg_sync_campaign_total_leads`) that fires AFTER INSERT/DELETE/UPDATE on `campaign_leads`. Returns `NEW` for INSERT/UPDATE, `OLD` for DELETE — per Postgres AFTER trigger contract. Trigger function uses `GREATEST(..., 0)` on decrements to prevent negative counts. One-time backfill `UPDATE` syncs all existing campaigns from live row counts. Also fixed `.single()` → `.maybeSingle()` on the campaign INSERT fetch in `AddToCampaignModal`. All `organization_id` scoping on `campaign_leads` rows is unchanged — trigger is count-only and does not touch org fields.

- **2026-04-06 | [DONE] Intelligent Queue Lifecycle Management**
  *Files Created:* `src/lib/queue-manager.ts`
  *Files Modified:* `src/pages/DialerPage.tsx`, `src/components/dialer/QueuePanel.tsx`, `ROADMAP.md`
  *No migrations required — all queue state is in-memory only.*
  *Developer Note:* Implemented fully managed queue lifecycle with priority-tiered ordering. Foundational to 300+ dials/day with zero manual queue management.
  **queue-manager.ts** — New library containing all queue logic: `CampaignLead` interface with in-memory `retry_eligible_at` / `callback_due_at` fields; `DISPOSITION_QUEUE_BEHAVIOR` map (No Answer/Not Available/Left Voicemail/Interested → retry, DNC/Not Interested/Appointment Set → permanent remove, Call Back → callback hold); `sortQueue()` (4 tiers: Callback Due Now → New Leads → Retry Eligible → Pending); `applyDispositionToQueue()` (removes + re-inserts + re-sorts after every save); `queueOrderChanged()` (position-by-position ID comparison); `formatTimeUntil()` (human countdown); `getLeadTier()` (tier 1–4 classifier for UI badges).
  **DialerPage.tsx** — `loadWithResume` now fetches `retry_interval_hours` from campaigns, pre-populates `retry_eligible_at` for any previously-called leads whose interval hasn't expired, then runs `sortQueue()` before `setLeadQueue`. `applyQueueLifecycle` callback centralizes disposition → queue change wiring. `handleAutoDispose` now calls `applyQueueLifecycle` instead of incrementing index. `handleSaveAndNext` (Personal/non-lock path) calls `applyQueueLifecycle` + resets to index 0 instead of calling `handleAdvance`; lock-mode path is unchanged. 60-second `setInterval` effect re-sorts the queue and toasts if order changed (clears on unmount and `selectedCampaignId → null`).
  **QueuePanel.tsx** — Lead rows now compute tier via `getLeadTier`. Tier 1 rows show amber "Callback Due" badge; Tier 3 rows show green "Ready" badge; Tier 4 rows show muted countdown ("Retry in Xh Ym" / "Callback in Xd Yh") and apply `opacity-50` to signal not-yet-callable status.

- **2026-04-06 | [DONE] Dialer Behavioral Bugfixes (Three-Fix Block)**
  *Files Modified:* `src/lib/auto-dialer.ts`, `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Three targeted fixes applied to the power dialer.
  **Fix 1 — Campaign Settings Enforcement**: `AutoDialer.startSession()` now fetches `calling_hours_start`/`calling_hours_end` from the `campaigns` table and `ring_timeout`/`amd_enabled` from `phone_settings`. Added `checkCallingHours(state)` public method with a full 50-state `STATE_TO_TZ` map using `Intl.DateTimeFormat` for timezone-aware comparison. Added `getRingTimeout()` getter. In `DialerPage`, `triggerAutoCall` (auto-dial path only) calls `checkCallingHours` before dialing; if outside hours it toasts a warning, calls `handleSkip()`, and returns. Ring timeout stored in `ringTimeoutRef` after async `startSession` resolves. Manual Call button is unaffected.
  **Fix 2 — No Auto-Dial on First Entry**: Added `hasDialedOnce` ref. `triggerAutoCall` returns immediately unless `hasDialedOnce.current === true`. `handleCall` (manual press) sets it to `true`. Ref resets to `false` in a `useEffect` that watches `selectedCampaignId`, so switching campaigns restores the guard.
  **Fix 3 — Session Timer + Session-Scoped Stats**: Session timer interval stored in `sessionTimerRef` so all three exit paths (unmount, `selectedCampaignId → null`, End Session button) reliably clear it and reset `sessionElapsed` to 0. Added `sessionStats` local state (`calls_made`, `calls_connected`, `total_talk_seconds`, `policies_sold`) reset on campaign entry. Incremented in `handleCall`, `handleHangUp` (≥7s), and both save handlers when disposition contains "sold". Stat cards in the header now read from `sessionStats` (session-scoped) instead of `dialerStats` (all-day cumulative). `dialer_daily_stats` persistence is unchanged — daily table remains the source of truth for reports.

- **2026-04-06 | [DONE] Campaign-Aware Dialer UI + Hard Claim Engine**
  *Migration:* `20260406000000_hard_claim_engine.sql`
  *Files Created:*
  - `src/hooks/useHardClaim.ts`
  - `src/components/dialer/LeadCard.tsx`
  - `src/components/dialer/LeadCardBlurred.tsx`
  - `src/components/dialer/QueuePanel.tsx`
  - `src/components/dialer/QueuePanelLocked.tsx`
  - `src/components/dialer/ClaimRing.tsx`
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Built the campaign-aware dialer UI with full staged lead reveal, hidden queue for Team/Open, 30s claim ring animation, and campaign type visual identity stripe + badge. Also built the missing Hard Claim Engine (useHardClaim) that was a blocker for this task — the previous task left it incomplete. Schema gaps discovered and resolved: `claim_lead` RPC (SECURITY DEFINER, updates `leads.assigned_agent_id` ONLY — never `campaign_leads`) and `queue_filters` JSONB column on campaigns for manager-set filters. Lock-mode lead loading (Team/Open) uses atomic `getNextLead()` one lead at a time; Personal still uses batch queue. beforeunload listener cleans up lock + heartbeat + claim timer.

- **2026-04-05 | [DONE] Smart Queue Lock System**
  *Migration:* `20260405100000_smart_queue_lock_system.sql`
  *Files Created:* `src/hooks/useLeadLock.ts`
  *Developer Note:* Implemented atomic fetch-and-lock queue system for Team and Open Pool campaigns. Created `dialer_lead_locks` table with a unique partial index on `(lead_id) WHERE expires_at > now()` to enforce single active lock per lead. Three RPCs: `get_next_queue_lead` (SECURITY DEFINER, SELECT FOR UPDATE SKIP LOCKED — zero dead air), `renew_lead_lock` (30s heartbeat), `release_lead_lock` (called on skip/disposition/unload). Personal campaigns bypass the lock entirely via a direct `campaign_leads` query. Schema note: "contacts" in the task spec maps to `campaign_leads` in this codebase. Team pool scoped via `campaigns.assigned_agent_ids` (no `team_members` table exists). Filters (`status`, `state`, `lead_source`, `max_attempts`, `min_score`, `max_score`) designed as a flat key-value JSONB payload to support future plan-based filter limits.

- **2026-04-05 | [DONE] Permanent Dark Sidebar (Command Center)**  
  *Developer Note:* Enforced a constant dark theme for the Sidebar (Slate-900) to maintain a premium "Command Center" aesthetic across all global themes. Decoupled navigation elements from Light Mode styles to ensure 100% mission-critical visibility and consistency.
  
- **2026-04-04 | [DONE] Lead Ownership Standardization**  
  *Developer Note:* Massive schema refactor to ensure every lead record across all states (Master, Campaign, Dialer) is pinned to a correct, RLS-checked `user_id`. Optimized hierarchical reporting for agency managers.

- **2026-04-04 | [DONE] Agent Rule & Documentation Generalization**  
  *Developer Note:* Decoupled codebase from Lovable/Notion. Established **VISION.md** and **ROADMAP.md** as repository-native sources of truth. Updated **AGENT_RULES.md (v2.3.0)** to focus on the Antigravity (AI Orchestrator) workflow.

- **2026-04-02 | [DONE] Production Readiness Audit**  
  *Developer Note:* Verified security boundaries. Confirmed absolute RLS isolation for Leads, Clients, and Appointments. Verified Telnyx WebRTC stability for agent "Power Hours."

---

## 4. Phase 4 Deployment Strategy (Q2 2026)
1.  **SaaS Infrastructure**: Deploy `organizations` table and Stripe billing loops.
2.  **Follow-up Engine**: Deploy `tasks` and unified `notifications` for agent follow-ups.
3.  **Real-Time Metrics**: Connect `dial_sessions` to custom agent leaderboards based on live telnyx connects.
4.  **GO-LIVE**: Final production rollout for agency trial users.

---

## 5. Context Snapshot — Smart Queue Lock System (2026-04-05)

### What Was Built
A zero-race-condition queue system for Team and Open Pool campaigns. Two agents can never be served the same lead simultaneously because fetching and locking happens in a single Postgres transaction using `SELECT … FOR UPDATE SKIP LOCKED`.

**Database layer:**
- `public.dialer_lead_locks` — lock registry with 5-minute TTL per lock
  - Unique partial index `(lead_id) WHERE expires_at > now()` → one active lock per lead, enforced at the DB constraint level
  - RLS: org-scoped; agents see/modify only their own locks; Admins/TLs see all org locks
- `public.get_next_queue_lead(p_campaign_id, p_filters)` — SECURITY DEFINER RPC
  - Deletes stale locks → reads campaign type → filters eligible pool → `SELECT … FOR UPDATE OF cl SKIP LOCKED` → inserts lock → returns `campaign_leads` row
- `public.renew_lead_lock(p_lead_id)` — heartbeat extension, returns boolean
- `public.release_lead_lock(p_lead_id)` — immediate lock release

**Frontend layer (`src/hooks/useLeadLock.ts`):**
- `getNextLead(campaignId, campaignType, filters)` — branches on campaign type; Personal = direct query, Team/Open Pool = RPC
- `releaseLock(leadId)` — call on skip, disposition save, session end, beforeunload
- `startHeartbeat(leadId, onLockLost?)` — setInterval at 30s, warns if lock is lost
- `stopHeartbeat()` — clears interval

### Schema Decisions Made
| Decision | Rationale |
|---|---|
| `lead_id` references `campaign_leads(id)` | No `contacts` table exists; `campaign_leads` is the dialer's queue entity |
| Team pool via `campaigns.assigned_agent_ids` | No `team_members` table; agent membership stored as JSONB array on the campaign |
| `SECURITY DEFINER` on `get_next_queue_lead` | Required to read the full campaign pool across all agents (RLS would block cross-agent reads) |
| Filters as flat JSONB object | Enables future plan-based count limiting (e.g. "Starter = 2 filters max") without changing the function signature |
| `FOR UPDATE OF cl SKIP LOCKED` with JOIN | Locks only the `campaign_leads` row; leaves `leads` row unlocked (not needed) |

### What Prompts 2 and 3 Depend On
- **Prompt 2 (Dialer Integration)**: Call `useLeadLock.getNextLead()` on campaign start and after each disposition. Wire `startHeartbeat` / `stopHeartbeat` around the active lead. Add `beforeunload` listener calling `releaseLock` on `DialerPage`.
- **Prompt 3 (Campaign Settings — Queue Filters UI)**: Managers need a filter editor on the Campaign Settings modal that saves `queue_filters` JSONB onto the `campaigns` table. The hook reads this from the campaign record and passes it to `getNextLead`. Fields: `status`, `state`, `lead_source`, `max_attempts`, `min_score`, `max_score`. Plan-tier enforcement hooks here (count active filter keys before calling RPC).

---

## 6. Context Snapshot — Campaign-Aware Dialer UI (2026-04-06)

### What Was Built

Full campaign-type-aware dialer UI with staged lead reveal, claim ring, queue visual identity, and hard claim ownership engine.

### Components Built

| Component | File | Props Contract |
|---|---|---|
| `LeadCard` | `src/components/dialer/LeadCard.tsx` | `lead, callStatus, callAttempts, maxAttempts, lastDisposition, isClaimed, isEditing, editForm, onEditChange` |
| `LeadCardBlurred` | `src/components/dialer/LeadCardBlurred.tsx` | `firstName, state, age, callAttempts, maxAttempts, lastDisposition` (internal, used by LeadCard) |
| `QueuePanel` | `src/components/dialer/QueuePanel.tsx` | `campaignType, campaignId, organizationId, userRole` + all Personal queue props |
| `QueuePanelLocked` | `src/components/dialer/QueuePanelLocked.tsx` | `campaignId, organizationId, userRole` (fetches its own counts, polls every 15s) |
| `ClaimRing` | `src/components/dialer/ClaimRing.tsx` | `active, onClaim, campaignType` |

### Hooks Built

| Hook | File | Exports |
|---|---|---|
| `useHardClaim` | `src/hooks/useHardClaim.ts` | `startClaimTimer, cancelClaimTimer, claimOnDisposition, claimedLeadIds` |

### Schema Decisions Made

| Decision | Rationale |
|---|---|
| `claim_lead` RPC — SECURITY DEFINER | Must write `leads.assigned_agent_id` across agent boundaries; agent-level RLS would block cross-agent writes |
| Writes to `leads.assigned_agent_id` ONLY | Per codebase invariant — `campaign_leads.assigned_agent_id` is read-only from dialer layer |
| `queue_filters` JSONB on `campaigns` | Manager-set filters persist per campaign, all agents share them; agents cannot see/override |
| `callStatus` derived from `telnyxCallState` + `showWrapUp` | Keeps wrap-up card fully revealed after call ends; no separate state needed |
| Lock-mode = one-lead-at-a-time queue | Team/Open campaigns serve one locked lead per agent; `leadQueue` is always a 1-element array in lock mode |
| `QueuePanelLocked` polls every 15s via `setInterval` | Counts are informational; no Realtime socket needed, avoids unnecessary connections |
| `ClaimRing.onClaim` is UI-only | The actual DB claim is handled by `useHardClaim.startClaimTimer` running in parallel; the ring fires a visual signal only |

### State Management Decisions

- `claimRingActive: boolean` — owned by DialerPage, driven by Telnyx `active` state for Team/Open only
- `lockMode: boolean` — derived from `campaignType`, memoized
- `callStatus: 'idle' | 'ringing' | 'connected'` — memoized from `telnyxCallState` + `lockMode` + `showWrapUp`
- `campaign stripe` — rendered via inline IIFE in JSX, no additional state needed
- `campaign badge` — replaces old static badge, type-aware with colored dot

### What the Next Developer Needs to Know

1. **Lock mode lead loading** (`loadLockModeLead`) fetches the campaign's `queue_filters` from DB on each call — this is intentional so manager filter changes take effect immediately without session restart.
2. **`handleAdvance` and `handleSkip`** both branch on `lockMode` — if lockMode, they call `releaseLock` + `loadLockModeLead` instead of incrementing `currentLeadIndex`.
3. **`claimedLeadIds`** is a session-scoped `Set<string>` of master `leads.id` values. It resets on page reload — this is intentional; the DB is the source of truth for permanent ownership.
4. **Campaign type string matching**: always `.toUpperCase()` before comparison. Values in DB: `'Personal'`, `'Team'`, `'Open Pool'`. Lock mode = `type === 'TEAM' || type.includes('OPEN')`.
5. **QueuePanelLocked** manager filter panel saves `queue_filters` JSONB to `campaigns` table. The dialer reads this on `loadLockModeLead`. No real-time sync — filters apply on the next lead load.
6. **`beforeunload` listener** only calls `releaseLock` if `lockMode && currentLead?.id`. Safe for Personal campaigns (no lock to release).

---

## 7. Context Snapshot — Dialer Behavioral Bugfixes (2026-04-06)

### What Was Changed

Three focused behavioral fixes applied to `src/lib/auto-dialer.ts` and `src/pages/DialerPage.tsx`. No new components, no schema migrations.

**Fix 1 — Campaign Settings Enforcement:**
- `AutoDialer` now stores `callingHoursStart`, `callingHoursEnd` (from `campaigns`), `ringTimeout`, `amdEnabled` (from `phone_settings`).
- `checkCallingHours(state)` uses a hardcoded `STATE_TO_TZ` record (all 50 states) + `Intl.DateTimeFormat.formatToParts` to determine local time. Returns `true` if within window.
- `getRingTimeout()` exposes the stored value; `ringTimeoutRef` in DialerPage caches it post-`startSession`.
- `triggerAutoCall` in DialerPage calls `checkCallingHours` on the auto-dial path only. Outside hours → toast + `handleSkip()` + early return. Manual Call button is unaffected.

**Fix 2 — No Auto-Fire on Entry:**
- `hasDialedOnce` ref starts `false` per campaign.
- `triggerAutoCall` returns immediately if `hasDialedOnce.current === false`.
- `handleCall` sets it `true` (manual press is the gate).
- A dedicated `useEffect` on `selectedCampaignId` resets the ref in its setup AND cleanup so campaign switches always re-engage the gate.

**Fix 3 — Session Timer + Stat Cards:**
- `sessionTimerRef` holds the interval ID, cleared in all three exit paths (unmount, `selectedCampaignId → null`, End Session click).
- `sessionStats` local state (calls_made, calls_connected, total_talk_seconds, policies_sold) is the source of truth for the header stat cards. Reset to zeros on campaign entry.
- `dialer_daily_stats` (Supabase) is still persisted unchanged for reports and dashboard.

### What's Next
- Consider wiring `ringTimeoutRef.current` into a setRingTimeout API on TelnyxContext if per-campaign ring timeout overrides are needed (currently TelnyxContext reads global `phone_settings` itself).
- Session stats are in-memory only; if `dial_sessions` table is implemented (see Roadmap Phase 4), `sessionStats` should persist there on `endSession`.

---

## 8. Context Snapshot — Intelligent Queue Lifecycle Management (2026-04-06)

### What Was Built

A fully managed in-memory queue lifecycle system that dynamically re-positions leads after every disposition. All logic is isolated in `src/lib/queue-manager.ts`.

### Architecture

| Function | Behavior |
|---|---|
| `sortQueue(leads, now)` | 4-tier priority sort: Callback Due → New → Retry Eligible → Pending |
| `applyDispositionToQueue(...)` | Removes disposed lead, applies behavior from `DISPOSITION_QUEUE_BEHAVIOR`, re-inserts with timestamps, re-sorts |
| `queueOrderChanged(a, b)` | Position-by-position ID comparison — drives 60s poll toast |
| `formatTimeUntil(ts, now)` | "Xh Ym" / "Xd Yh" / "Due now" countdown strings |
| `getLeadTier(lead, now)` | Returns 1–4 for QueuePanel badge rendering |

### Disposition Routing

| Disposition | Queue Action |
|---|---|
| No Answer, Not Available, Left Voicemail, Interested | `remove_until_retry` — re-enters after `retry_interval_hours` |
| Not Interested, DNC, Appointment Set, Appt Set | `remove_permanent` — gone from session queue |
| Call Back, Call Back Later | `remove_until_callback` — re-enters at scheduled callback time |
| (anything else) | `keep_at_bottom` — pushed to end of sorted queue |

### Advance Model Change

Previous model: `currentLeadIndex++` after every disposition.
New model: disposed lead is removed → queue re-sorted → `currentLeadIndex` reset to 0 (head of sorted queue is always the next-to-dial). The auto-dial reactive `useEffect` on `currentLead?.id` naturally fires on the new head.

Lock-mode (Team / Open Pool) is **unchanged** — these campaigns use atomic DB locks via `useLeadLock` and bypass all in-memory queue lifecycle.

### Deferred Edge Cases

- `callback_at` / `scheduled_callback_at` columns not confirmed present on `campaign_leads`; `callbackDueAt` is derived from the inline callback scheduler UI (`callbackDate` + `callbackTime` state) and falls back to 48h if null.
- `handleSaveOnly` (save without advance) intentionally does NOT apply queue lifecycle — the agent may save and continue reviewing the lead.
- `autoSaveNoAnswer` (rapid no-answer path) uses `handleAdvance` — consider migrating to `applyQueueLifecycle` in a future pass if you want no-answer leads to re-sort immediately.

### What's Next

- Connect `dial_sessions` persistence so re-insertion timing is visible in agency reports.
- Expose retry interval in the queue UI so agents can see "when this lead re-enters" at a glance from the Queue tab.
- Consider persisting `retry_eligible_at` / `callback_due_at` as actual DB columns if multi-session lifecycle continuity is required (currently in-memory only, resets on page reload).

---

## 9. Context Snapshot — Total Leads Auto-Trigger (2026-04-06)

### What Was Built

A Postgres trigger that makes `campaigns.total_leads` a fully DB-managed counter. No frontend code is responsible for maintaining this value.

### Database Layer

| Object | Type | Behavior |
|---|---|---|
| `sync_campaign_total_leads()` | Trigger function | INSERT → +1; DELETE → GREATEST(-1, 0); UPDATE w/ campaign_id change → decrement old, increment new |
| `trg_sync_campaign_total_leads` | AFTER trigger | Fires FOR EACH ROW on INSERT OR DELETE OR UPDATE of `campaign_leads` |
| Backfill `UPDATE` | One-time | Sets `total_leads` from live `campaign_leads` row counts for all existing campaigns |

**Return contract (per Postgres AFTER trigger spec):**
- `INSERT` → returns `NEW`
- `DELETE` → returns `OLD`
- `UPDATE` → returns `NEW`

### Frontend Changes

6 manual update calls removed across 2 files:

| File | Removed |
|---|---|
| `src/pages/CampaignDetail.tsx` | 4 blocks — `handleAdd` (post-INSERT), CSV import (post-INSERT), `handleRemoveLead` (post-DELETE), `handleBulkRemove` (post-DELETE) |
| `src/components/contacts/AddToCampaignModal.tsx` | 2 blocks — `handleAddToExisting` (post-INSERT), `handleCreateAndAdd` (post-INSERT) |

**Also fixed:** `AddToCampaignModal.tsx` campaign INSERT `.single()` → `.maybeSingle()` per AGENT_RULES null-safety standard.

**Left intact:** `total_leads: 0` initial value on new campaign INSERT rows — this is a valid seed value on the `campaigns` record, not a `campaign_leads` mutation.

### What Prompt 2 Depends On

- `campaigns.total_leads` is now always accurate; any future UI that displays this count can trust it directly without a re-count query.
- If a future migration adds bulk-delete or TRUNCATE paths on `campaign_leads`, those paths will bypass the FOR EACH ROW trigger. Add a statement-level trigger or re-run the backfill UPDATE in that migration.
- `organization_id` scoping is untouched — trigger is count-only and never reads or writes org fields.
