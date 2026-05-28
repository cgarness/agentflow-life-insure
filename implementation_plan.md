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

---

# Dialer Disposition System Audit Plan

**Goal:** Run a full read-only audit of the Dialer disposition system to identify which dispositions are working, partially working, or broken, and trace the root causes of callback-disposition save failures.

## Scope of Inspection

### Files to Inspect
- [DialerPage.tsx](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/pages/DialerPage.tsx)
- [DialerActions.tsx](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/components/dialer/DialerActions.tsx)
- [FloatingDialer.tsx](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/components/layout/FloatingDialer.tsx)
- [dialer-api.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/lib/dialer-api.ts)
- [queue-manager.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/lib/queue-manager.ts)
- `supabase/migrations/` (specifically migrations introducing dispositions, calls, appointments, campaign_leads, dnc_list, workflows, triggers, workflow_dispatch_event, and lead triggers)

### Database Objects to Inspect
1. **Tables & Schemas:**
   - `public.dispositions` (columns, types, constraints, row count)
   - `public.campaign_leads` (columns, constraints, status values)
   - `public.calls` (columns, constraints, status values)
   - `public.appointments` (columns, constraints, status values)
   - `public.leads` (columns, checking for `pipeline_stage_id` or similar)
   - `public.dnc_list` (columns, duplicate handling constraints)
2. **Functions & Triggers:**
   - `public.workflow_dispatch_event`
   - `private.workflow_dispatch_event`
   - Trigger functions calling `workflow_dispatch_event`
   - Trigger configurations on `appointments`, `calls`, `leads`, `clients`, `dnc_list`, `campaign_leads`
   - Exception handling blocks within trigger functions

## Steps to Perform
1. Read relevant database schema details by running a read-only script using database environment variables.
2. Search and analyze frontend save flow implementation for standard, callback, appointment, DNC, remove from queue/campaign, convert, required notes, and save only vs save & next logic.
3. Compare the production schema against migrations.
4. Classify each of the 11 disposition categories as PASS, PARTIAL, FAIL, or UNKNOWN with severity assessment.
5. Identify root causes and list files to touch in a future fix.
6. Provide recommended fix strategy and verification plan.

---

# HOTFIX — Dialer Disposition Reliability + Full Disposition Settings Contract

**Owner:** Chris Garness
**Status:** FILES WRITTEN (Gate #2 approved) — migration + `DialerPage.tsx` + docs written.
NOT applied to prod, NOT deployed, NOT pushed. Awaiting Gate #3.
Migration file: `supabase/migrations/20260528220000_fix_dialer_dispositions_workflow_triggers.sql`.
**Date:** 2026-05-28

## 0) Invariant being established

> **Workflow automation must never block core CRM writes.** Workflow trigger errors are
> logged as `RAISE WARNING` and swallowed. Appointments, calls, leads, clients, DNC, notes,
> and campaign-lead saves must still commit even when workflow dispatch fails. (To be added
> to `AGENT_RULES.md` §4.)

## 0.1) P0 telemetry guardrails (DO NOT TOUCH)

- `twilio-voice-status` remains the **sole writer** of `calls.duration`.
- No edits to `twilio-voice-status`, `twilio-voice-webhook`, `answerOnBridge`, or Twilio
  architecture. No two-legged / SIP / Telnyx / `dialer-start-call`.
- Browser timers stay UI-only. `saveCall()` already does not write `calls.duration`.

## 1) Root-cause synthesis (from completed audit + code/migration read)

The single dominant root cause is **DB-side**: workflow trigger functions raise an exception
inside the same transaction as the core CRM write, so when dispatch fails the whole insert/
update is rolled back.

| # | Symptom | Root cause |
|---|---------|-----------|
| A | Callback + Appointment fully fail; call/disposition/notes/scheduler lost; Team/Open lock stuck | `saveAppointment()` runs **first** in `saveCallData()`. The `appointments` INSERT fires `handle_appointment_workflow_events` → `public.workflow_dispatch_event(...)`. If that function/path errors (missing in prod or raises), the INSERT rolls back, `saveCallData()` throws **before** `saveCall`/`saveNote`/`updateLeadStatus`/`releaseLock` → data loss + stuck lock. |
| B | Workflow triggers call `public.workflow_dispatch_event(...)` but prod only has `private.workflow_dispatch_event(...)` | Schema drift: on-disk migrations define `public.workflow_dispatch_event`, but live attached triggers (`workflow_on_lead_created`/`workflow_on_lead_updated`) call `private.*`. Must confirm live in Phase A. |
| C | `workflow_on_lead_updated()` references missing `pipeline_stage_id` | Function compares `NEW.pipeline_stage_id`/`OLD.pipeline_stage_id`; `leads` may not have that column (frontend uses `leads.status` for pipeline). Any `leads` UPDATE then errors → aborts master-record updates from the dialer. Confirm column existence in Phase A. |
| D | DNC auto-add fails silently | `dnc_list` INSERT fires `handle_dnc_workflow_events` → dispatch error rolls back the insert; frontend wraps it in try/catch so it's swallowed (no DNC row persisted). |
| E | Remove-from-Campaign fails | Frontend writes `campaign_leads.status = 'Removed'`; live `campaign_leads_status_check` does not allow `Removed` → update rejected (try/catch swallows) → lead reappears on refresh. |
| F | DNC campaign status violates constraint | `updateLeadStatus` may write `status = 'DNC'`; constraint likely disallows `DNC`. |
| G | Convert/Sold partial | `clients` INSERT fires `handle_client_workflow_events`; `leads` UPDATE fires lead trigger (C) → master record update / conversion aborts on dispatch error. |
| H | Team/Open hard claim fails | `public.claim_lead(...)` missing in prod. Frontend (`useHardClaim.callClaimRpc`) already swallows the RPC error, so it does **not** block save/lock release — but ownership transfer silently never happens. Recreating it restores claims. |

## 2) Phase A — Read-only live confirmation (COMPLETED 2026-05-28 via Supabase MCP)

Confirmed live state on prod `jncvvsvckxhqgqvkppmj` (read-only `execute_sql` + `list_migrations`):

- **`public.workflow_dispatch_event` does NOT exist.** Only
  `private.workflow_dispatch_event(p_org_id uuid, p_trigger_type text, p_trigger_key text, p_contact_id uuid, p_contact_type text, p_metadata jsonb)` (SECURITY DEFINER).
- **`public.claim_lead` does NOT exist.**
- Live triggers (attached functions):
  - `appointments` → `handle_appointment_workflow_events` (INSERT+UPDATE) → calls **`public.workflow_dispatch_event` (missing)** → **ABORTS appointment/callback save**.
  - `dnc_list` → `handle_dnc_workflow_events` (INSERT) → calls **`public.*` (missing)** → ABORTS dnc insert.
  - `clients` → `handle_client_workflow_events` (INSERT) → calls **`public.*` (missing)** → ABORTS client/convert.
  - `messages` → `handle_message_workflow_events` (INSERT) → calls **`public.*` (missing)**.
  - `calls` → `workflow_on_call_created` (INSERT) → calls `private.*` (works).
  - `leads` → `workflow_on_lead_created` (INSERT) → calls `private.*` (works);
    `workflow_on_lead_updated` (UPDATE) → references **`OLD/NEW.pipeline_stage_id` and `OLD/NEW.tags`**.
- **`leads` has NO `pipeline_stage_id` and NO `tags` columns** (only `status`, `lead_source`,
  `assigned_agent_id`, `organization_id`). → `workflow_on_lead_updated` **errors on EVERY
  `leads` UPDATE**; currently only survives because the dialer wraps master-record updates in
  try/catch (silently failing → master `leads.status` never updates from the dialer).
- `campaign_leads_status_check` allows exactly:
  `Queued, Locked, Claimed, Called, Skipped, Completed, Failed` — **no `Removed`, no `DNC`**.
- `dnc_list` has `UNIQUE (organization_id, phone_number)` → safe upsert target.
- `dispositions` canonical fields confirmed: `campaign_action` (text), `dnc_auto_add` (bool),
  `require_notes` (bool), `min_note_chars` (int), `callback_scheduler`, `appointment_scheduler`,
  `pipeline_stage_id` (uuid, on dispositions), `color` (text). Sample rows: `Not Interested`
  + `DNC` use `campaign_action='remove_from_campaign'` (writes `Removed`); `DNC` also
  `dnc_auto_add=true`; `Sold` uses `remove_from_queue` + `require_notes`.
- Latest applied migration: `20260527231858_fix_agency_group_members_rls_recursion`. New
  migration will be named `20260528xxxxxx_fix_dialer_dispositions_workflow_triggers.sql`.

**Conclusion:** Audit findings confirmed and refined. The on-disk `handle_*` functions (which
call `public.*`) ARE the live attached functions for appointments/dnc/clients/messages — and
that `public.*` target is missing, which is the dominant abort. Plan is unchanged except the
lead-trigger fix must also drop the `tags` reference (column also absent).

## 3) Phase B — One new migration (smallest safe change set)

`supabase/migrations/<ts>_fix_dialer_dispositions_workflow_triggers.sql`:

1. **`public.workflow_dispatch_event` compatibility wrapper** — `CREATE OR REPLACE` with the
   signature live triggers call (confirmed in Phase A), delegating to
   `private.workflow_dispatch_event(...)` inside `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE
   WARNING ...`. `SECURITY DEFINER`, `SET search_path = public, private, pg_temp`. No
   sensitive data returned. Only create the signature(s) actually needed.
2. **Trigger exception hardening** — `CREATE OR REPLACE` each live workflow trigger function
   so every dispatch call is wrapped to swallow errors as warnings:
   `handle_appointment_workflow_events`, `handle_dnc_workflow_events`,
   `handle_message_workflow_events`, `handle_client_workflow_events`,
   `handle_call_workflow_events`, `workflow_on_lead_created`, `workflow_on_lead_updated`
   (and/or `handle_lead_workflow_events`, whichever is attached). Bodies preserved verbatim
   except the dispatch is wrapped. This is the primary fix for A/D/G.
3. **Lead trigger schema mismatch (C)** — In `workflow_on_lead_updated`/lead trigger, guard
   or remove the `pipeline_stage_id` comparison if the column doesn't exist on `leads`
   (prefer guarding via `to_jsonb(NEW) ? 'pipeline_stage_id'` or removing the block — **not**
   adding a column). Preserve other valid dispatches.
4. **`public.claim_lead(uuid, uuid, uuid)`** — recreate matching the frontend call
   (`p_campaign_lead_id`, `p_lead_id`, `p_campaign_id`) and the on-disk definition: org-scoped
   via `public.get_org_id()`, writes `leads.assigned_agent_id` only, `SECURITY DEFINER`,
   `GRANT EXECUTE ... TO authenticated`. Surgical — no queue-architecture changes.
5. **`campaign_leads_status_check`** — `DROP` + re-`ADD` to allow existing values **plus**
   `Removed` and `DNC` (exact existing list confirmed in Phase A). Do not loosen further.

## 4) Phase C — Minimal frontend safety (`src/pages/DialerPage.tsx` only, if needed)

Defense-in-depth even after DB hardening (keep surgical, no refactor):
- Wrap `saveAppointment()` (appointment + callback paths) so its failure **cannot** abort
  `saveCall`/`saveNote`/`updateLeadStatus`; surface a clear toast warning, continue core save.
- Ensure Team/Open **lock release** runs even if a later step fails (try/finally around the
  claim + `releaseLock` so a stuck lock cannot occur).
- Keep Disposition Settings as the source of truth (no behavior changes to which settings drive what).
- **No** changes to duration logic, UI timers, or queue architecture.

## 5) Disposition Settings contract — disposition-by-disposition

| Setting | Status after fix | Note |
|---|---|---|
| Required Notes + min length | Already enforced pre-mutation in `saveCallData` (lines ~2502). Verify only. | No partial save on validation fail. |
| Callback Scheduler | Fixed by B-2 (appointment insert no longer aborts) + existing `scheduled_callback_at` sync. | Lock release hardened in C. |
| Appointment Scheduler | Fixed by B-2. Confirmation email/SMS = **deferred** (not built). | Save itself works. |
| Automation Trigger | Fixed by B-1/B-2 (dispatch failures warn, never block). | |
| Pipeline Stage | Frontend uses `leads.status` (name string) via `saveCall` pipeline block (already try/caught). Lead-trigger `pipeline_stage_id` guarded in B-3. **Classify: partial** — dispositions move `leads.status`, not a true `pipeline_stage_id` FK on leads. | Will document as partial/deferred. |
| Campaign Action (No Action / Remove Queue / Remove Campaign) | `Remove Campaign` fixed by B-5 (`Removed` allowed). `Remove Queue` is in-memory only (no DB write) — confirm intended. | |
| Auto-Add to DNC | Fixed by B-2 (dnc trigger) + B-5 (`DNC` status allowed). Existing dup-guard via `.maybeSingle()` + insert. | DNC contacted/reporting logic unchanged (`report-utils.ts`). |
| Sold/Convert | Master lead/client update no longer aborts (B-2/B-3). Full client conversion may be **partial** — classify. | |
| Color/label | Read from Disposition Settings (runtime DB colors) — **untouched**. | No Tailwind conversion. |

## 6) Files & DB objects to touch (after approval)

**Files:**
- `supabase/migrations/<ts>_fix_dialer_dispositions_workflow_triggers.sql` (new)
- `src/pages/DialerPage.tsx` (only if Phase C needed — minimal try/catch + lock finally)
- `AGENT_RULES.md` (add "workflow automation never blocks core CRM writes" invariant)
- `WORK_LOG.md` (newest-first entry)
- `implementation_plan.md` (status updates)

**DB objects (in the one migration):**
- `public.workflow_dispatch_event(...)` (wrapper, create/replace)
- `public.claim_lead(uuid, uuid, uuid)` (recreate)
- `campaign_leads_status_check` (drop + re-add with `Removed`, `DNC`)
- Trigger functions: `handle_appointment_workflow_events`, `handle_dnc_workflow_events`,
  `handle_message_workflow_events`, `handle_client_workflow_events`,
  `handle_call_workflow_events`, `workflow_on_lead_created`, `workflow_on_lead_updated`
  (and/or `handle_lead_workflow_events`) — exception-hardened, exact set confirmed in Phase A.

**Will NOT touch:** `twilio-voice-status`, `twilio-voice-webhook`, `answerOnBridge`, Twilio
architecture, `calls.duration`, `TwilioContext` re-entrancy guards, queue SKIP-LOCKED RPCs,
Workflow Builder. No new Telnyx/SIP/two-legged paths.

## 7) Verification (pre-handoff)

- `npx tsc --noEmit`; `npm test -- --run`.
- Migration applies cleanly (test in branch/local DB if possible before prod).
- Confirm no P0 duration code changed; no Twilio architecture changed.
- Confirm Disposition Settings still drive Dialer behavior.

## 8) Approval gates (HARD STOP)

1. **Approval #1** — to run Phase A read-only live inspection (Supabase MCP `execute_sql`,
   read-only). No mutations.
2. **Approval #2** — to modify files (migration + optional `DialerPage.tsx` + docs).
3. **Approval #3** — to apply the migration to production (`apply_migration`) and/or deploy frontend.

No file edits, no backend commands, and no production changes will occur before the
corresponding approval.

