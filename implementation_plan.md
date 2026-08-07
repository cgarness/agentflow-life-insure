# Implementation Plan — Emergency repair for newly purchased outbound numbers

**Status:** **INCIDENT CLOSED — deployed to production, six numbers repaired, and live outbound test passed on `hotfix/new-number-outbound-account-owner`. Not committed, pushed, or opened as a PR.**
**Date:** 2026-08-06
**Type:** Production telephony incident. Surgical Edge Function + Twilio account-ownership repair; no frontend change, no dialer state-machine change, no queue/telemetry change, no RLS change, and no database migration planned.

> This plan supersedes the completed lead-score plan below for the current task. The lead-score work is already merged to `main` as `ec80150` (#350).

## As-built result

- `twilio-buy-number` now keeps the existing authenticated user, organization, and active-subaccount gates but purchases/configures new caller IDs with `loadOutboundTwilioCreds()` so Twilio ownership matches the master Voice JWT/TwiML App. AgentFlow tenant ownership remains the inserted `phone_numbers.organization_id`.
- Callback URLs moved to one shared `canonicalNumberConfig(SUPABASE_URL)` helper used by both purchase and repair; no hardcoded production callback base remains in the purchase path.
- The old automatic Trust Hub call was removed from purchase because it is subaccount-scoped and cannot truthfully approve a master-owned number. New/repaired rows remain `pending` until an owning-account registration path exists.
- The new internal repair function implements the approved exact-target/incident-window gates and accepts either an exact service-role bearer or AgentFlow's existing exact `X-Workflow-Secret` internal credential. The deployed operation used the workflow secret because both legacy service-role copies stored in Postgres are stale and were correctly rejected with 401. Its idempotent sequence is: master lookup → losing-subaccount ownership proof (when needed) → transfer → canonical callback configuration → master ownership/config verification → database Trust Hub reset. It stops on first failure and reports prior successes without exposing phone numbers, account credentials, or raw Twilio bodies.
- The repair orchestration was extracted into a pure module so failure ordering is executable rather than inspection-only. `repair.test.ts` proves fresh transfer, already-master idempotency, transfer/configuration/verification aborts, and database update ordering.
- Durable invariant #24 and the Edge config registration were added. No migration, RLS/RPC/grant, frontend, DialerPage/TwilioContext, queue, disposition, or telemetry file changed.

**Final local gates:** Deno check clean on both Edge entrypoints + two test modules; focused Deno tests **14/14** (including exact workflow-secret acceptance/rejection); `npx tsc --noEmit` exit 0; full Vitest **991/991 in 76 files** (the first environment-only run lacked Vite Supabase vars and had 9 collection failures; rerun with non-secret test values was fully green); targeted ESLint clean; Vite production build succeeds; `git diff --check` clean. The Edge check used an uncommitted `/tmp` import map pointing the remote Supabase import at the installed package because direct Deno registry access was blocked.

---

## 0. Incident outcome and read-only evidence

The dialer itself is healthy. The new caller IDs are unusable because they were purchased in the agency's Twilio **subaccount**, while AgentFlow's browser Voice JWT has `sub = master account SID` and its TwiML App also lives on the **master** account. `<Dial callerId="...">` therefore receives a number that is not owned or validated by the account executing the call.

Production evidence (numbers masked):

| Time (UTC) | Caller ID | Destination | Result |
|---|---:|---:|---|
| 22:31:26 | old `***-8403` | `***-6963` | connected/completed; 10s canonical duration |
| 22:31:50 | new `***-5532` | same `***-6963` | busy; 0s; ended in 1s |
| 22:32:38 | new `***-9460` | same `***-6963` | busy; 0s; ended in 3s |

Additional evidence:

- Six `phone_numbers` rows were purchased today at 22:17–22:19 UTC through `twilio-buy-number` v39. All are active Agency numbers and all have PN SIDs.
- Five attempts through `***-9460` and two through `***-5532` terminate in 1–3 seconds; older master-owned numbers continue to complete calls.
- Deployed `twilio-token` v33 is ACTIVE and matches source: it intentionally mints the Voice JWT with the master Account SID because the TwiML App `AP6ac...` is master-owned. This is the May 5 ConnectionError 53000 hotfix and must not be reverted.
- `twilio-buy-number` intentionally loads `loadSubaccountCreds(...)` and purchases under the organization subaccount. This is incompatible with the May 5 master-Voice hotfix unless per-subaccount TwiML Apps are added.
- Twilio's official `<Dial>` contract requires a caller ID purchased by or verified in the account executing the call; invalid values produce Twilio error 13214. Twilio officially supports transferring numbers between a parent and its subaccounts with `POST IncomingPhoneNumbers/{PN}.json` and `AccountSid=<target>`.

## 1. Emergency decision

**Recommended:** restore compatibility with the existing, proven master-account Voice path now. Do **not** attempt the larger per-subaccount TwiML App redesign during an active production incident.

1. Transfer only the six numbers purchased today from Chris's agency subaccount to the Twilio master account.
2. Immediately reapply each number's Voice URL, SMS URL, methods, and status callback after transfer because Twilio does not guarantee number configuration survives an account transfer.
3. Mark the six AgentFlow rows' `trust_hub_status` as `pending` after transfer; the existing `approved` value belongs to the losing subaccount and must not remain as a false success signal.
4. Change future number purchase to purchase on the master account—the same account that executes outbound Voice—while preserving AgentFlow `organization_id` ownership in Postgres.
5. Keep per-org subaccounts provisioned for now; do not delete or suspend them. A proper per-subaccount Voice/TwiML design is a separate architecture project.

This is the smallest repair that makes the bought numbers usable without touching `TwilioContext`, `DialerPage`, Voice.js, caller-ID selection, call telemetry, or queue behavior.

## 2. Implemented code changes

### 2.1 `supabase/functions/twilio-buy-number/index.ts`

- Keep existing authenticated-user and organization resolution.
- Keep organization telephony status gating; an inactive/suspended org still cannot purchase.
- Use `loadOutboundTwilioCreds()` for the Twilio Available/Incoming Phone Number purchase account so ownership matches the master Voice JWT/TwiML App.
- Continue inserting the AgentFlow row with the authenticated user's `organization_id`—Twilio account ownership and AgentFlow tenant ownership remain distinct.
- Preserve Voice/SMS/status webhook URLs and `verify_jwt: false` + in-code JWT validation.
- Do not report Trust Hub approval unless the assignment truly succeeds in the account that now owns the number; otherwise retain `pending`.

### 2.2 New `supabase/functions/repair-twilio-number-ownership/index.ts`

One narrowly scoped, idempotent internal repair function:

- `POST` only; `verify_jwt: false` because the caller is internal and authenticates in code.
- Require either the bearer token to exactly equal `SUPABASE_SERVICE_ROLE_KEY` or `X-Workflow-Secret` to exactly equal the existing `WORKFLOW_INTERNAL_SECRET`; reject every other caller.
- Accept `organization_id` plus an explicit array of `phone_number` row UUIDs. Never accept arbitrary PN SIDs or an unbounded "all numbers" action.
- Load and verify every row belongs to the supplied organization, is active, has a PN SID, and was created in the incident window. Fail closed before contacting Twilio if any target is invalid.
- Load master credentials and the organization's subaccount SID; never return or log credentials.
- For each PN SID, use the master credentials to transfer from the losing subaccount to the master account, then update the number resource under master with the canonical Voice/SMS/status webhook configuration.
- Idempotency: if Twilio reports the number is already master-owned, verify/reapply webhook configuration and treat it as repaired.
- Return one sanitized per-number result keyed by AgentFlow row id; do not return full phone numbers, credentials, or raw Twilio bodies.
- Update `phone_numbers.trust_hub_status = 'pending'` only after that number's ownership and webhooks verify successfully. Do not change `status`, `assignment_type`, `assigned_to`, `is_default`, number-group memberships, or daily usage.
- Stop on the first failure; successful earlier transfers remain explicitly reported (Twilio account transfers cannot be transactionally rolled back with Postgres).

### 2.3 Configuration and durable documentation

- Add `[functions.repair-twilio-number-ownership] verify_jwt = false` to `supabase/config.toml`.
- Correct `AGENT_RULES.md`: the master Voice JWT/TwiML App requires outbound caller IDs to be master-owned or master-verified; per-org database ownership is still mandatory.
- Add a newest-first `WORK_LOG.md` incident entry with masked evidence, exact targets/count, verification, deploy version, and any partial failure.
- Update this plan with the as-built result.

## 3. Production operation result

Chris explicitly approved the live emergency fix. Result:

1. Re-fetched production `twilio-buy-number` v39: ACTIVE, `verify_jwt=false`, and both deployed files matched `HEAD` byte-for-byte. The repair slug did not exist.
2. Revalidated exactly six target rows: correct org, active Agency, valid PN SIDs, and inside the approved incident window.
3. Deployed corrected `twilio-buy-number` **v40** and repair **v1**, then re-fetched every deployed file and confirmed byte-for-byte local equality.
4. Two service-role invocations were rejected 401 before parsing because the two private Postgres service-key copies are stale. No Twilio/DB mutation occurred. Added the already-established exact workflow-secret internal auth path, proved it with a side-effect-free invalid-body request (authorized 400), reran 14/14 focused tests + Deno check + ESLint, and deployed repair **v2**.
5. Invoked v2 once with only the six approved UUIDs. Request `39160` returned HTTP 200 in 8.236s: **6/6 `repaired`**, ownership verified, webhooks verified, Trust Hub pending.
6. Independent DB readback: all six remain active Agency numbers; `assigned_to` and `is_default` match preflight; all six are now honestly `trust_hub_status='pending'`.
7. Edge log shows the canonical v2 operation as `POST | 200`; both deployed functions remain ACTIVE (`repair` v2, `twilio-buy-number` v40).
8. Chris confirmed the live call was working. Independent row verification: repaired `***-9460` → masked destination `***-6963` created a real outbound call with Twilio CallSid, started/ended timestamps, no provider/SIP error, and a normal terminal `no-answer` / canonical duration 0 after a 4.9s short test. Edge logs show `twilio-voice-webhook` v35 POST 200 plus two `twilio-voice-status` v38 POST 200 callbacks. The former invalid-caller-ID false `busy` is gone.
9. Commit/push/PR still require separate authorization; no frontend/Vercel deploy is involved.

## 4. Local verification gates

1. `deno check` on `twilio-buy-number`, the new repair function, and all shared imports.
2. Focused unit tests for target validation, service-role authorization, sanitized results, idempotent already-master handling, transfer failure, webhook reconfiguration failure, and "DB status changes only after full Twilio success."
3. `npx tsc --noEmit`.
4. Relevant Vitest suite, then full `npx vitest run` with zero regressions.
5. Targeted ESLint, `npm run build`, `git diff --check`, secret scan, and scope audit.
6. Confirm zero diffs to `TwilioContext.tsx`, `DialerPage.tsx`, `FloatingDialer.tsx`, queue RPCs, `calls.duration`, `twilio-voice-status`, caller-ID eligibility, or RLS.

## 5. Files intended to change

| File | Change |
|---|---|
| `supabase/functions/twilio-buy-number/index.ts` | Purchase future outbound caller IDs under the master Voice account |
| `supabase/functions/_shared/twilioNumberConfig.ts` | Canonical Voice/SMS/status callback configuration shared by purchase and repair |
| `supabase/functions/_shared/twilioSubaccountCreds.ts` | Correct stale usage comment; no behavior change |
| `supabase/functions/repair-twilio-number-ownership/index.ts` | New internal, target-bounded repair function |
| `supabase/functions/repair-twilio-number-ownership/ownership.ts` | Pure validation/result helpers for tests |
| `supabase/functions/repair-twilio-number-ownership/ownership.test.ts` | Focused fail-first tests |
| `supabase/functions/repair-twilio-number-ownership/repair.ts` | Testable per-number transfer/configure/verify/update ordering |
| `supabase/functions/repair-twilio-number-ownership/repair.test.ts` | Transfer, idempotency, and failure-ordering tests |
| `supabase/config.toml` | Function registration; `verify_jwt = false` |
| `AGENT_RULES.md` | New outbound-number account-ownership invariant |
| `implementation_plan.md` | This plan + as-built delta |
| `WORK_LOG.md` | Newest-first incident record after implementation |

No migration, RLS/RPC/grant change, frontend file, package/dependency, or Vercel change is planned.

## 6. Rollback and limitations

- Function rollback: redeploy the pre-change `twilio-buy-number` bundle if purchase behavior regresses.
- Twilio number transfers are reversible only through a second Twilio API transfer; they are not part of a database transaction. Exact PN targets and before/after ownership must therefore be verified before and after each call.
- Number configuration and Trust Hub/registration state may not carry across account transfer. Webhooks are reapplied automatically; Trust Hub is set to `pending` rather than falsely claiming approval. Re-registration is a separate follow-up unless it can be completed safely against the master profile during this incident.
- The long-term alternative—per-subaccount TwiML Apps, subaccount-scoped Voice JWTs, and subaccount-aware signature validation across Voice/SMS callbacks—is deliberately deferred. It is the cleaner multi-tenant architecture but is too broad for this emergency.

## Production result

The emergency backend repair is live and independently verified, including the successful user test and its production call telemetry. This production approval did not include commit, push, PR, merge, or a frontend/Vercel deploy.

---

# Implementation Plan — Remove individual lead raw-Score exposure from user-facing surfaces

**Status:** **IMPLEMENTED LOCALLY on branch `bugfix/hide-lead-score-ui`** (cut from `origin/main` = `2ca129b`, re-verified at cut time). Chris approved this plan on 2026-08-06 with decisions (1) branch from `origin/main`, (2) remove the whole dead `QueuePreviewField` type from `QueuePanel.tsx`, (3) leave the `KanbanCard` `"leadScore" in c` discriminator. NOT committed, NOT pushed, NOT merged, NOT deployed. Fail-first proven; final gates: `tsc` 0 · full vitest **991/991 in 76 files** (959 baseline + 32 new, zero regressions) · TZ=UTC **979 passed / 12 known skips** · TZ=America/Los_Angeles **991/991** · ESLint clean (no new findings) · build OK · `git diff --check` clean.
**Date:** 2026-08-06
**Type:** Frontend-only bugfix (data exposure). **No migration. No Supabase / RLS / Edge Function / Vercel / production-data change.**

### As-built delta from plan

1. **One test file added beyond the planned three** — `src/components/contacts/__tests__/fullScreenContactViewScore.test.tsx` (3 tests). Lead Details is the primary surface in the requirement and the environment has no authenticated session, so a mocked render of the real component proves "no Score in read mode **and** edit mode" with the verbatim migration-default agency layout as the fixture. Fail-first: **2/3 failed** against unmodified source (a `<label>Score</label>` rendered in both modes); the third is a preservation pin that passed pre-fix. No new dependency (`fireEvent`, not `user-event`, which is not installed).
2. Everything else shipped exactly as planned.

> Supersedes the leaderboard metric-switch plan (shipped as PR #348, squash-merged to `origin/main` as `4d54d01`; durable record in the 2026-08-06 `WORK_LOG.md` entry and git history).

---

## 0. Baseline, branch, and conflict check (done first, per AGENT_RULES §8)

| Item | Finding |
|---|---|
| `origin/main` | **`2ca129b`** — `fix(calendar): exclude dialer callbacks from list view (#349)`, on top of `4d54d01` (#348) and `a411892` (#347) |
| Current local branch | `bugfix/leaderboard-metric-switch-rerank` @ `99b2a0f` — **already merged upstream as #348**; the branch is now **stale/behind** `origin/main` by 2 commits |
| Working tree | Clean except pre-existing noise: `deno.lock` (M), `.claude/`, `.cursor/settings.json`, `tsconfig*.tsbuildinfo` (untracked) — excluded from commits as always |
| **Branch plan (needs approval)** | Cut **`bugfix/hide-lead-score-ui`** from **`origin/main` (`2ca129b`)**. Do **not** build on the stale merged branch. |
| WORK_LOG conflict scan (newest 5 entries: 2026-08-06 leaderboard metric switch, 2026-08-05 ×3 leaderboard RPC, 2026-08-04 onboarding) | **No conflict.** Those touch `useLeaderboardData.ts`, `Leaderboard.tsx`, `LeaderboardWidget.tsx`, onboarding hooks/wizard, and `supabase/**`. **Zero** overlap with the contacts/dialer files below. Only shared files are `implementation_plan.md` (superseded, above) and `WORK_LOG.md` (append-only, newest-first). |
| `docs/plan-remove-score-aging-ui.md` (2026-05-16, prior partial cleanup) | Removed Score/Aging from **`Contacts.tsx`** (table columns/sort/cells) and Score+Age from **`ContactManagement.tsx` `STANDARD_FIELDS_LEAD`** — both verified still clean today. It **explicitly deferred** `FullScreenContactView.tsx`, `KanbanCard.tsx`, `contactFieldLayout.ts` as "not in scope", and explicitly left the stale `fieldOrderLead` default keys in place ("harmless stale keys"). **That deferral is exactly the remaining exposure this task closes** — and those stale keys are *not* harmless: they are what still re-exposes Score. |

**Why saved layouts must be sanitized (evidence).** Migration `supabase/migrations/20260326220000_add_field_order_to_settings.sql` sets the column default:
`field_order_lead JSONB DEFAULT '["firstName","lastName","phone","email","state","leadSource","leadScore","age","dateOfBirth","spouseInfo","assignedAgentId","notes"]'`
so **live agency rows and any user layout cloned from them contain `"leadScore"`**. Removing the constant from source is not enough — a stale saved layout would re-render the Score field in Lead Details and in the Dialer lead card. **No migration is permitted here (and none is wanted)**, so the sanitization is a frontend read-path filter.

---

## 1. Full audit of `leadScore` / `lead_score` / raw "Score" in the frontend

### 1a. PRESERVE — data layer, types, imports, queue controls (touch nothing)

| Ref | Why preserved |
|---|---|
| `src/lib/types.ts:92` `Lead.leadScore: number` | Type/data contract |
| `src/lib/supabase-contacts.ts:162,283,395,448` | Row↔model mapping, create/update payloads |
| `src/lib/supabase-leads.ts:42` | Insert default `lead_score: row.leadScore ?? 5` |
| `src/pages/Contacts.tsx:1315` | Create-lead default `?? 5` |
| `src/components/contacts/ImportLeadsModal.tsx:834` | Import default `leadScore: 5` |
| `src/integrations/supabase/types.ts:3507,3531,3555` | Generated DB types |
| `src/hooks/useLeadLock.ts:18-19` `min_score`/`max_score` | Manager queue filters → canonical `get_next_queue_lead` claim RPC (invariant #15) |
| `src/lib/dialer-queue.ts:96,106-107` | Queue filter shape (dead code, deprecation-commented — left alone) |
| `src/components/dialer/QueuePanelLocked.tsx:38-48,100-101,171-172,290-291` | **Manager queue config "Min Score" / "Max Score"** — explicitly out of scope, untouched (incl. its Zod schema) |
| `src/components/dialer/QueuePanel.tsx:15,120` `score_high` / **"Highest Score"** sort option | **Operational queue sort** — explicitly out of scope, untouched |
| `src/pages/DialerPage.tsx:209` `leadScore: row.lead_score ?? 5` | Lead mapping |
| `src/pages/DialerPage.tsx:817,825-826,839-840,1654-1656,1693-1694,4584-4585` | `QueueSortKey.score_high` + the whole `minScore`/`maxScore` **queue filtering**, the `score_high` **sort**, its localStorage persistence, clear-filters, and filter summary |
| `NumberReputation.tsx`, `CarrierReputationPanel.tsx`, `NumberManagementSection.tsx` (`spam_score`, "Score factors") | **Phone/carrier reputation — unrelated system** |
| Leaderboard / `AgentScorecardModal` / `agent_scorecards` | **Agent scorecards — unrelated system** |

Also untouched by design: `FullScreenContactView.handleSave` still round-trips the whole `editForm` (seeded from the contact) to `onUpdate`, so the **existing `lead_score` value is preserved unchanged** on save — the user simply has no control to change it. No queue/telemetry impact.

### 1b. REMOVE — individual raw-score presentation / edit controls

| # | Location | Removal |
|---|---|---|
| 1 | `FullScreenContactView.tsx:1029` | `case 'leadScore': … renderField("Score","leadScore","number")` — the single render/edit site (one `renderField` serves both read and edit mode, so deleting the case removes Score from **both**) |
| 2 | `contactFieldLayout.ts:35` | `"leadScore"` in `getDefaultFieldOrder("lead")` |
| 3 | `contactFieldLayout.ts:89` | `leadScore: { label:"Score", key:"lead_score" }` in the dialer descriptor registry `LEAD_STANDARD` |
| 4 | `contactFieldLayout.ts` `resolveFieldOrder` | **NEW** sanitization of saved user/agency layouts |
| 5 | `KanbanCard.tsx:68-77` | The `Score: {contact.leadScore}` badge |
| 6 | `LeadCardBlurred.tsx:123` (+ doc comment :39) | `<BlurField label="Score" />` placeholder |
| 7 | `DialerPage.tsx:818` | `'score'` in the `QueuePreviewField` union (individual queue-preview field option) |
| 8 | `DialerPage.tsx:1721` | `case 'score': … \`Score ${lead.lead_score}\`` raw formatting |
| 9 | `DialerPage.tsx:1731` | `score: 'Score'` preview label |
| 10 | `DialerPage.tsx:842-847` | Persisted preview prefs read raw from `localStorage` with `JSON.parse` and **no validation** — normalize so a stored `"score"` (or any junk) falls back safely |
| 11 | `QueuePanel.tsx:18-25` | Local `QueuePreviewField` union containing `"score"` — see §2.6 |

---

## 2. Detailed changes

### 2.1 `src/lib/contactFieldLayout.ts` — the single sanitization point

Every layout consumer funnels through this module (`FullScreenContactView` :228/:287/:441, `ContactManagement` FieldLayoutTab :1610-1611, `DialerPage` :700-701), so one filter here covers all three surfaces.

- Delete `"leadScore"` from the `t === "lead"` array in `getDefaultFieldOrder`. **`"age"` and every other lead field stay exactly as-is** (order otherwise byte-identical).
- Delete the `leadScore` entry from `LEAD_STANDARD`. `leadLayoutIdsToDialerDescriptors` already skips ids absent from the registry, so a stale `"leadScore"` id can no longer produce a descriptor — the Dialer lead card cannot render Score. (`LeadCard.fallbackConnectedFields` has no Score either — verified.)
- Add an exported, documented constant and filter:
  ```ts
  /** Internal queue metadata — never rendered as an individual contact field. */
  export const HIDDEN_CONTACT_FIELD_IDS: readonly string[] = ["leadScore"];
  ```
  `resolveFieldOrder` sanitizes **both** the user layout and the agency layout before returning, and a layout that sanitizes to empty falls through to the next source (user → agency → system default) instead of rendering an empty field list. Relative order of surviving ids is preserved. No other behavior changes.

**Not needed (verified):** `ContactManagement.tsx` needs no edit — its `STANDARD_FIELDS_LEAD` already has no `leadScore` (2026-05-16 cleanup) and `FieldLayoutTab` intersects the resolved order with that list, so the Field Layout tab already cannot list or re-save Score; with §2.1 it also stops receiving it. `ContactFieldLayoutSchema` (Zod) is unchanged — it validates shape, and sanitization is a read-path concern.

### 2.2 `src/components/contacts/FullScreenContactView.tsx`

Delete the one `case 'leadScore'` line. Nothing else: no import becomes unused (`renderField` and every other case remain). Read mode and edit mode both lose Score because both are rendered by `renderField`.

### 2.3 `src/components/contacts/KanbanCard.tsx`

Delete the `isLead(contact) && (<span … >Score: {contact.leadScore}</span>)` block (lines 68-77).
Cleanup audit: `cn` stays used (line 204), `isLead` stays used (line 129, lead-source footer branch). **Decision:** keep the `isLead` guard's structural discriminator `"leadScore" in c` unchanged — it is a type-narrowing shape check, not a score display, and swapping the discriminator would be a gratuitous behavior risk on the kanban's lead/recruit branch. Documented so a future audit doesn't read it as leftover exposure.

### 2.4 `src/components/dialer/LeadCardBlurred.tsx`

Delete `<BlurField label="Score" />` and drop "score" from the component doc comment's sensitive-field list. The remaining six blur placeholders and every visible field are unchanged.

### 2.5 `src/pages/DialerPage.tsx` + NEW `src/lib/dialer-queue-preview.ts`

`DialerPage.tsx` is a documented >200-line exception (AGENT_RULES §7: "Do not add features inline"), and the persisted-preference normalizer must be unit-testable, so the preview-field vocabulary moves to a tiny pure module:

**NEW `src/lib/dialer-queue-preview.ts`** (no `any`, no React, no I/O):
- `export type QueuePreviewField = 'age' | 'state' | 'source' | 'attempts' | 'status' | 'best_time'` — **`'score'` removed**
- `QUEUE_PREVIEW_FIELDS` (allowed list), `DEFAULT_QUEUE_PREVIEW_FIELDS = ['state','attempts']`, `QUEUE_PREVIEW_FIELD_LABELS` (no `score` entry)
- `normalizeQueuePreviewFields(raw: unknown): [QueuePreviewField, QueuePreviewField]` — **per-slot** validation: a slot holding `"score"`, an unknown string, a non-string, or a missing entry falls back to that slot's default; a non-array input returns the default pair. So `["score","status"] → ["state","status"]` (the user's other choice is kept) and `["score","score"] → ["state","attempts"]`.

**`DialerPage.tsx`:**
- import the type + `normalizeQueuePreviewFields`; delete the local `QueuePreviewField` alias (line 818) and the local `PREVIEW_FIELD_LABELS` const (1730-1733), importing `QUEUE_PREVIEW_FIELD_LABELS` instead.
- the `queuePreviewFields` initializer runs the parsed value through `normalizeQueuePreviewFields` inside the existing try/catch (a corrupt/absent key still yields the default).
- delete `case 'score'` from `renderQueuePreviewValue` (its `default: return '—'` already covers any unknown key belt-and-braces).
- **`QueueSortKey` keeps `score_high`; the `score_high` sort branch, the `minScore`/`maxScore` filter, its persistence, clear-filters and filter summary are untouched.**

Honest note carried into the WORK_LOG: `renderQueuePreviewValue`, `PREVIEW_FIELD_LABELS`, `setQueuePreviewFields` and `showQueueFieldPicker` are **currently unreferenced by the rendered `queuePanelProps`** (the field-picker UI is not wired up today). The removals above are still required — the persisted preference and the option vocabulary are live — but no visible Dialer control changes. This is reported, not silently assumed.

### 2.6 `src/components/dialer/QueuePanel.tsx`

Its local `QueuePreviewField` union (lines 18-25) lists `"score"` and is **confirmed dead** (not exported, zero references — grep-verified). Removing the dead declaration eliminates the last stale "score" preview-option reference. **`QueueSortKey.score_high` and the `{ value: "score_high", label: "Highest Score" }` sort option are explicitly preserved.**
*If you prefer zero dead-code churn, say so and I will instead delete only the `"score"` member and leave the dead type in place.*

---

## 3. Tests (targeted, added/updated)

| File | Pins |
|---|---|
| **NEW** `src/lib/__tests__/contactFieldLayout.test.ts` | (a) `getDefaultFieldOrder("lead")` **excludes** `leadScore` and **still includes** `age` + all other lead fields in order; client/recruit defaults unchanged. (b) **Saved-layout sanitization**: a user layout and an agency layout containing `leadScore` — including the **verbatim `20260326220000` JSONB default array** — resolve without it, with the remaining order preserved. (c) A layout that is only `["leadScore"]` falls through user → agency → system default (never an empty field list). (d) **Dialer descriptors cannot expose leadScore**: `leadLayoutIdsToDialerDescriptors` given ids containing `leadScore` (and the raw migration default) emits **no** descriptor with label `"Score"` or key `"lead_score"`, while `age`/`firstName`/`custom:` ids still map. |
| **NEW** `src/lib/__tests__/dialerQueuePreview.test.ts` | `'score'` is absent from `QUEUE_PREVIEW_FIELDS` and the label map; `normalizeQueuePreviewFields` maps `["score","attempts"] → ["state","attempts"]`, `["state","score"] → ["state","attempts"]`, `["score","score"] → ["state","attempts"]`, `["score","status"] → ["state","status"]`; valid pairs pass through unchanged; `null` / `undefined` / `{}` / `[]` / `["bogus",42]` → the default pair. |
| **NEW** `src/components/contacts/__tests__/kanbanCardScore.test.tsx` | Renders `KanbanCardBody` (the sortable-free presentational export — no DnD context needed) with a lead whose `leadScore` is `9`: **no `/score/i` text and no `9` badge**, while name, state, email, phone, lead-source and the assigned-agent initials still render. Also asserts a recruit renders unchanged. |
| Existing suites | `ContactKanbanBoard.test.tsx`, `ContactKanbanBoardConvert.test.tsx`, `contactsKanban`, `contactsRender`, `contactsDisplay`, `contactsFilterContract`, `contactsSort` must stay green **unchanged**. Grep confirms **no existing test asserts a visible Score**, so nothing needs weakening. |

Fail-first discipline: each new assertion is run against unmodified source first and the failures recorded in the WORK_LOG.

---

## 4. Complete list of files I intend to modify

| # | File | Action |
|---|---|---|
| 1 | `src/lib/contactFieldLayout.ts` | EDIT — drop `leadScore` from default lead order + `LEAD_STANDARD`; add `HIDDEN_CONTACT_FIELD_IDS` + sanitization in `resolveFieldOrder` |
| 2 | `src/components/contacts/FullScreenContactView.tsx` | EDIT — delete `case 'leadScore'` (read **and** edit mode) |
| 3 | `src/components/contacts/KanbanCard.tsx` | EDIT — delete the `Score: N` badge |
| 4 | `src/components/dialer/LeadCardBlurred.tsx` | EDIT — delete the Score blur placeholder + doc-comment mention |
| 5 | `src/pages/DialerPage.tsx` | EDIT — drop `'score'` preview option / `case 'score'` formatter / `score` label; normalize persisted preview prefs |
| 6 | `src/lib/dialer-queue-preview.ts` | **NEW** — preview-field vocabulary + `normalizeQueuePreviewFields` |
| 7 | `src/components/dialer/QueuePanel.tsx` | EDIT — remove the dead `QueuePreviewField` union (`score_high` / "Highest Score" preserved) |
| 8 | `src/lib/__tests__/contactFieldLayout.test.ts` | **NEW** |
| 9 | `src/lib/__tests__/dialerQueuePreview.test.ts` | **NEW** |
| 10 | `src/components/contacts/__tests__/kanbanCardScore.test.tsx` | **NEW** |
| 11 | `implementation_plan.md` | EDIT — this plan (+ as-built delta at handoff) |
| 12 | `WORK_LOG.md` | EDIT — newest-first entry |

**Nothing else.** No `supabase/**` file, **no migration**, no RPC/RLS/grant, no Edge Function, no `types.ts`, no `AGENT_RULES.md` change (no new invariant discovered), no dependency, no telephony/telemetry/queue-claim code, no mock data, Tailwind only, no new `any`.

---

## 5. Verification gates

1. `npx tsc --noEmit` (exit 0).
2. Targeted: `npx vitest run` on the 3 new suites + the contacts kanban/render/display/filter/sort suites.
3. Full `npx vitest run` (host TZ) — expect the current baseline **944** + the new tests, **zero regressions**; plus `TZ=UTC` (known `laOnly` DST skips) and `TZ=America/Los_Angeles`.
4. ESLint `--max-warnings 0` on every touched file; `npm run build`; `git diff --check`; scope audit vs `origin/main`.
5. **Manual UI:** Lead Details **read** mode and **edit** mode (no Score anywhere), Contacts **Kanban** cards, Dialer lead display (ringing blurred view + connected view), and — as the preservation check — **QueuePanelLocked Min/Max Score**, the **"Highest Score"** sort, queue claiming, and queue ordering all still present and functional. *Known standing limitation (recorded in prior entries): this environment has no authenticated production session (placeholder credentials land on `/login`). I will drive what I can via the local dev server and, where auth blocks a surface, use a scratchpad-only render harness (deleted before handoff) exactly as in the 2026-08-03/04 builds — and I will state plainly which surfaces were verified live vs. by harness vs. by test/code only.*
6. `WORK_LOG.md` entry (changes, files, verification, migrations/deploys, blockers, next steps) + a closing context snapshot.

**Not doing without separate approval:** commit, push, PR, merge, deploy, any Supabase/MCP write, any `main` push.

---

## 6. Risks / decisions for Chris

1. **Branch:** current branch is stale (its commit is already merged as #348). I plan to cut `bugfix/hide-lead-score-ui` from `origin/main` (`2ca129b`). Confirm.
2. **Sanitization is read-path only** (no migration). The DB default and existing rows keep the stale `"leadScore"` key; it is filtered on read everywhere. A future cleanup migration would be a separate, approved task.
3. **`QueuePanel.tsx` dead-type removal** (§2.6) is the only change slightly beyond the five named files — say the word and I will trim it to the `"score"` member only, or skip it.
4. **`"leadScore" in c`** stays as KanbanCard's structural type guard (§2.3) — intentional, documented.
