# Implementation Plan — Phone Number Assignment / Caller-ID Eligibility Enforcement (Pass 2 of 3)

**Owner:** Chris Garness | **Branch:** `claude/phone-assignment-pass-1-fuwef` | **Date:** 2026-06-01
**Production project:** `jncvvsvckxhqgqvkppmj`

> **STATUS: AWAITING CHRIS APPROVAL.** No files modified beyond this plan. No backend command run.
> Pass 1 confirmed present on this branch (migration `20260601193140_add_phone_numbers_assignment_type.sql`,
> `types.ts` has `phone_numbers.assignment_type`, AGENT_RULES invariant #18). Continuing on the Pass 1 branch.

---

## Goal

Make outbound caller-ID selection respect `phone_numbers.assignment_type` so **Personal** numbers can never
be used by shared local presence, campaign rotation, smart/fallback caller-ID, or stale manual overrides.
**No migration** (column exists from Pass 1). **No Twilio architecture change** (single-leg WebRTC preserved).

---

## Phase A — Audit of the current caller-ID path (findings)

1. **`availableNumbers` load** — `TwilioContext.tsx:402-420`. One-shot org SELECT: `phone_number, is_default,
   spam_status, area_code, friendly_name, daily_call_count, daily_call_limit, is_direct_line`, `status in (active,Active)`.
   **No `assignment_type`/`assigned_to`/`id`.** This is the "numbers known to app" set and is also used **raw** as
   the From-Number dropdown source in both FloatingDialer and ConversationHistory. `defaultCallerNumber` is derived
   here from `is_default` (or `data[0]`).
2. **`callerIdPool` build** — `TwilioContext.tsx:424-499`. Separate effect. Org pool = `status active + is_direct_line=false`.
   Group pool (when `callerIdCampaignGroupId` set) = members' `phone_number_id`s, active, `is_direct_line=false`.
   Columns lack `assignment_type`/`assigned_to`. **Bug vs Pass 2:** on empty/no-eligible group (and on member-fetch
   error) it **silently falls back to the full org pool** — exactly what Pass 2 forbids.
3. **Campaign group scoping** — `DialerPage.tsx:1194-1199` pushes `selectedCampaign.number_group_id` →
   `setCallerIdCampaignGroupId`, re-running the pool effect.
4. **`defaultCallerNumber`** — chosen from `availableNumbers` (`is_default` or first), **not** from the eligible pool.
5. **`selectedCallerNumber` / `voice_manual_caller_id`** — `TwilioContext.tsx:255-256,302-308`. Initialized from
   `localStorage.voice_manual_caller_id`, persisted on change. Used directly with **no eligibility validation**.
6. **`getSmartCallerId`** — `TwilioContext.tsx:1571-1618`. If `selectedCallerNumber` is set it is **returned
   immediately, unvalidated**. Otherwise `selectOutboundCallerId({ phones: callerIdPool, defaultFallback:
   defaultCallerNumber, … })` runs sticky → area-code → state → default-tier → any-strict → **hard fallback
   (ignores cap)** → `defaultFallback`.
7. **DialerPage From-Number display** — `displayedFromNumber` (`DialerPage.tsx:370,892-896`) is set from
   `getSmartCallerId`. The dropdown lives in `ConversationHistory.tsx:128-133` and maps `availableNumbers` **raw**.
8. **FloatingDialer** — "Calling From" `<select>` (`FloatingDialer.tsx:1235-1246`) maps `availableNumbers` **raw**.
   Quick-call path (`637-666`) uses `selectedCallerNumber || getSmartCallerId || availableNumbers default`, then
   `twilioMakeCall` (= `TwilioContext.makeCall`).
9. **Unfiltered dropdowns** — **both** From-Number selectors render every org number with no eligibility filter
   (today harmless: all rows are agency; unsafe once Personal numbers exist).
10. **`caller_id_used` write** — `TwilioContext.makeCall:2095,2114`. `callerIdUsed = callerNumber || defaultCallerNumber`;
    inserted into the `calls` row at 2114 **before** `twilioMakeCall` at 2147. Only guard is non-empty.

---

## Decisions (CONFIRMED by Chris)

- **D1 — CONFIRMED: drop the `is_direct_line` filter; use `assignment_type` only.**
- **D2 — CONFIRMED: campaign group with no eligible Agency number BLOCKS (including transient member-fetch errors); no org fallback.**
- **D3 — unknown/missing `assignment_type` treated as `agency` (dev/test only).**

<details><summary>Original decision notes</summary>

- **D1 — `is_direct_line` no longer gates outbound eligibility.** Per the Pass 1/Pass 2 spec, outbound role is
  governed solely by `assignment_type`. The automatic-pool fetch will filter `assignment_type='agency'` and **drop**
  the `.eq("is_direct_line", false)` clause. **Zero live impact** (all rows are `is_direct_line=false` today).
  Inbound direct-line display/routing is untouched. *(If you'd rather keep excluding direct lines from the automatic
  pool as belt-and-suspenders, say so and I'll keep both filters.)*
- **D2 — Campaign group with no eligible Agency number BLOCKS (no fallback).** When a campaign `number_group_id` is
  set and the group has no automatic-eligible Agency number (empty, all Personal/ineligible, **or** member-fetch
  error), the automatic pool becomes empty and the call is blocked with a clear toast — **never** silently falls back
  to the org pool. (Replaces the current fallback behavior.)
- **D3 — Unknown/missing `assignment_type` treated as `agency`.** Only `assignment_type === 'personal'` is Personal;
  anything else (incl. `null`/`undefined`) is Agency. Production is `NOT NULL DEFAULT 'agency'`, so this only matters
  for local/dev/test rows; documented in the helper.

</details>

---

## Phase B — Caller-ID eligibility helpers (`src/lib/caller-id-selection.ts`)

Extend `CallerIdPhoneRow` with optional `status?`, `assignment_type?`, `assigned_to?` (additive; existing callers/tests
unaffected). Add pure, unit-tested helpers:

- `isAgencyCallerIdEligible(row)` → `status active` && `assignment_type !== 'personal'`.
- `isPersonalCallerIdOwnedByUser(row, userId)` → `status active` && `assignment_type === 'personal'` && `assigned_to === userId`.
- `isAutomaticCallerIdAllowed(row)` → `isAgencyCallerIdEligible(row)` && under daily cap. **(Personal always false.)**
- `isManualCallerIdAllowed(row, userId)` → `isAgencyCallerIdEligible(row)` || `isPersonalCallerIdOwnedByUser(row,userId)`.
- `filterAutomaticCallerIdPool(rows)` → `rows.filter(isAutomaticCallerIdAllowed)`.
- `filterManualCallerIdOptions(rows, userId)` → `rows.filter(r => isManualCallerIdAllowed(r,userId))`.
- `findAllowedCallerId(rows, phoneNumber, userId)` → returns the matching row if `isManualCallerIdAllowed`, else `null`
  (final-gate primitive; automatic selection can never yield Personal because the pool is pre-filtered).

`selectOutboundCallerId` core logic is **unchanged** — it already enforces the daily cap per tier; it simply receives an
already-agency-filtered `phones` pool. `is_direct_line` is never read for eligibility.

**Tests added** to `caller-id-selection.test.ts`:
- Agency *with* `assigned_to` → automatic-eligible.
- Personal owned by current user → manual-eligible, automatic-ineligible.
- Personal owned by another user → manual- and automatic-ineligible.
- Default Agency *with* `assigned_to` → eligible.
- Over-daily-cap Agency → automatic-ineligible.
- `is_direct_line=true` alone → does not change eligibility.

## Phase C — Harden TwilioContext pools

- `availableNumbers` SELECT: add `id, assignment_type, assigned_to` (keep existing columns).
- `defaultCallerNumber`: derive from automatic-eligible Agency numbers (`filterAutomaticCallerIdPool`), not raw rows.
- `callerIdPool` fetch (org + group): add `id, status, assignment_type, assigned_to`; filter `assignment_type='agency'`
  + active (drop `is_direct_line` filter, D1). Group-empty/no-eligible/error → **empty pool, no org fallback** (D2).
- `getSmartCallerId`: if `selectedCallerNumber` set, validate via `isManualCallerIdAllowed(row, user.id)` against
  `availableNumbers`; if **not** allowed → clear React state + `localStorage.removeItem('voice_manual_caller_id')`, then
  fall through to automatic selection. When a campaign group is active, pass `defaultFallback = ""` (never leak the
  org default past a group restriction). Returns `""` when nothing is eligible.

## Phase D — Final makeCall caller-ID gate

Before inserting the `calls` row and before `twilioMakeCall`:
- Resolve `callerIdUsed = callerNumber || (group active ? "" : defaultCallerNumber)`.
- Validate: row must exist in the org allowed set (`availableNumbers`), be **active**, and:
  - **Personal** → allowed only if `assigned_to === authUserId` (own, manual).
  - **Agency** → allowed; **if a campaign group is active**, it must also be a member of the group-eligible
    `callerIdPool` (blocks an org-default leak past the group).
- If invalid: **no `calls` row insert, no Twilio call**, release `isDialingRef`, reset call state cleanly, toast:
  *"No eligible outbound caller ID is available for this campaign. Check Phone Number settings."*
- Re-entrancy guards untouched; `calls.duration` untouched; webhooks untouched.

## Phase E — DialerPage

Pass `currentUserId` to `ConversationHistory`. `displayedFromNumber` already recomputes via the `getSmartCallerId`
effect keyed on `selectedCallerNumber`, so clearing a stale manual selection auto-updates the display. No flow/
save/disposition/queue/stat changes.

## Phase F — FloatingDialer

Filter the "Calling From" `<select>` options via `filterManualCallerIdOptions(availableNumbers, user.id)`
(Agency + own Personal only). Ensure the quick-call default fallback uses an eligible number. All calls still route
through `TwilioContext.makeCall` (final gate). No disposition/conversion change.

## Phase G — ConversationHistory

Filter the From-Number `<option>` list via `filterManualCallerIdOptions(availableNumbers, currentUserId)`.

## Phase H — Settings UI

**No editable control.** Keep the Pass 1 read-only Agency/Personal badge as-is.

## Phase I — Docs

- `AGENT_RULES.md` — extend invariant #18: agency is the only automatic pool role; personal never automatic;
  `assigned_to` only meaningful for Personal ownership; agency-with-`assigned_to` stays agency; owner-only manual
  Personal; no cross-user Personal visibility; number groups can't override Personal ownership; **final makeCall
  caller-ID validation is mandatory before inserting a call row**.
- `implementation_plan.md` (this), `WORK_LOG.md` (newest-first + snapshot).

## Phase J — Verification

`npx tsc --noEmit`; `npm test -- --run` (with dummy `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` as in Pass 1, both
results documented). Static checks: no Edge/`calls.duration`/queue/Reports/campaign-stats/disposition-save changes,
no broad rewrite of TwilioContext/DialerPage/FloatingDialer, no migration, no editable Settings control.

---

## Files I intend to touch

| File | Change |
|------|--------|
| `src/lib/caller-id-selection.ts` | Extend `CallerIdPhoneRow`; add 7 eligibility helpers; no change to `selectOutboundCallerId` core |
| `src/lib/caller-id-selection.test.ts` | Add 6 eligibility test cases |
| `src/contexts/TwilioContext.tsx` | Pool/availableNumbers selects + filters (Phase C); `getSmartCallerId` manual validation (Phase C); final makeCall gate (Phase D); surgical only |
| `src/components/dialer/ConversationHistory.tsx` | Filter From-Number options; add `currentUserId` prop |
| `src/pages/DialerPage.tsx` | Pass `currentUserId` to ConversationHistory (minimal) |
| `src/components/layout/FloatingDialer.tsx` | Filter From-Number options (minimal) |
| `AGENT_RULES.md` | Extend invariant #18 with Pass 2 enforcement |
| `implementation_plan.md` | This plan |
| `WORK_LOG.md` | Newest-first entry + Context Snapshot |

## DB objects

**None.** No migration (column exists from Pass 1). `assignment_type`/`assigned_to` are read-only consumed.

---

## Stop gates

1. **(HERE)** after plan, before editing — awaiting approval.
2. after implementation, before commit/push.
3. before deploy unless Chris approves.

## Next step after Pass 2
Merge/deploy Pass 2, then resume full Dialer QA. (Pass 3 = pause/cool-off + broader Settings expansion.)
