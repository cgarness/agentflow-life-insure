# Implementation Plan — Floating Dialer: Create Lead from an unmatched phone number (rev 0 — DRAFT, under review)

> **STATUS: PLAN ONLY — awaiting Chris's explicit approval (AGENT_RULES §8).**
> No application file has been edited and no backend command has been run. The only
> changes on the branch are this plan document and its pointer in the root `implementation_plan.md`.
>
> **Repository:** `cgarness/agentflow-life-insure` · branch `claude/floating-dialer-create-lead`
> · base `main` @ `d05f475`.
> **Scope:** frontend only. **No migration, RPC, RLS, grant, Edge Function or production action.**
> No deploy, no merge, no push to `main`, no production test calls.

---

## §0. TL;DR

When an agent enters a complete number in the floating dialer, it runs a scoped exact lookup on
leads, clients and recruits. The number can be typed, pasted, keyed on the keypad, or reached by
backspacing. The lookup respects the organization and RLS and does not download the contact book.

| Lookup result | What the agent sees |
| --- | --- |
| Succeeded, no visible match, US number | **"No matching contact found"** and **"+ Create Lead"**, directly under the number |
| One exact match | That contact, with its real type |
| Several or ambiguous matches | A pick-list; nothing is chosen for the agent |
| Loading, error, denied, truncated or incomplete | Never shown as "no contact" |

- **Create Lead** opens the existing Add Lead modal in create mode, with the number prefilled. It
  uses the existing required-field, duplicate-policy, ownership and assignment rules.
- **After a DB-confirmed save,** the dialer selects the returned lead and Contacts refreshes. The
  dialer does not navigate and does not dial.
- **Call** stays available throughout.
- **During a call,** a save never changes the call's contact.

The inspection also found and confirmed several defects on the way. The plan fixes only those the
feature needs:

- a refused save closes the form;
- loading lead sources wipes the form;
- lookup errors are shown as "no results";
- a leads-only, last-10-digit auto-select that can mis-select international numbers and land after
  a call has started;
- no guard during the call-start window.

---

## §1. Inputs read and overlapping work

- Read: `AGENT_RULES.md` (§1–§11 and the invariants relevant here: #8, #9, #13, #14, #18, #22, #30,
  #31, #32, #34, #36, #37 and the Schema Gotchas), `VISION.md`, and the newest `WORK_LOG.md` entries
  (2026-09-29 Reports release; 2026-09-28/29 Reports and Contact Follow-ups).
- **Overlap check.** Open PR #395 (Contact Follow-ups / appointment ownership) touches none of the
  code files in §5. It shares only `WORK_LOG.md`, `implementation_plan.md` and `AGENT_RULES.md`, and
  it has claimed root plan **§17**, so this plan's pointer is **§18**. PRs #382 and #383 are
  leaderboard work and #378 is Google OAuth, so none of them overlaps.
- **Baselines measured on untouched `main` (2026-09-29).**
  - `npx tsc -p tsconfig.app.json --noEmit` reports **90 errors**. Six are in `TwilioContext.tsx`
    and none are in the other target files.
  - `npx tsc --noEmit` exits 0 but checks nothing, because the root config is solution-style with
    `files: []`.
  - `npx vitest run`: **3,516 passed / 1 failed / 14 skipped**. The same 12 files fail as before:
    11 on `supabaseUrl is required`, including `addLeadAssignmentGate.test.ts`, which this feature
    touches, plus the voicemail v29 pin. There is also 1 existing unhandled rejection from
    `teamOpenRevealIntegration`.

---

## §2. Current behaviour on `main` (evidence)

### 2.1 Lookup

`FloatingDialer.doSearch` (`FloatingDialer.tsx:423-481`) queries **`leads` only** and has **no
`organization_id` filter**.

For ≥ 10 digits it probes with a contiguous `ilike '%<10 digits>%'` (`:433-442`). That misses stored
values with punctuation, such as CSV-imported `(555) 123-4567`, which `import-contacts/index.ts:255`
stores verbatim.

It compares numbers by their **last 10 digits** (`corePhoneDigitsForMatch`/`phonesMatch`,
`:84-95`), so `+44 20 7946 0958` equals a US lead `(207) 946-0958`. On a unique match it then
**auto-selects** the lead and rewrites `dialedNumber` to the stored phone (`:446-453`).

It **ignores `error`**: only `data` is destructured, and the catch sets `[]`. That turns failures
into "No contacts" (`:438, :466, :476-477, :1222`).

It has **no stale guard**: no generation, no abort, and the timer is not cleared by quick-call,
recent-row clicks, selection, clearSearch or resetAll. A late auto-select can therefore replace a
contact after a call has started.

**The keypad and backspace never search** (`:545-566`). Only the two text handlers schedule
`doSearch` (`:509, :526`).

### 2.2 Add Lead

- `AddLeadModal` closes on any resolved `onSave` (`AddLeadModal.tsx:124-125`).
  `Contacts.handleAddLead` resolves on refusal: on a missing owner (`Contacts.tsx:1586-1589`) and on
  a required-field, duplicate-block or duplicate-cancel refusal (`:1596`). **A refused Add therefore
  closes the form and discards the typed values.**
- `useAddLeadModalForm`'s reset effect depends on `leadSources` (`useAddLeadModalForm.ts:35-67`), so
  **typed or prefilled values are wiped when the org's lead sources arrive**.
- `initial` is the only mode switch (edit mode when truthy). There is no create-prefill.
- There is no synchronous double-submit guard. `disabled={saving}` only takes effect after a
  re-render. Cancel, X and the backdrop stay live mid-save.
- `handleAddLead` never returns the created row.
- The pre-save orchestration (`enforceContactPreSave`, `Contacts.tsx:1495-1564`) is local to
  Contacts. Its settings load fire-and-forget, with no status (`:1108-1114`).
- `PhoneInput` keeps the **first 10 digits** (`PhoneInput.tsx:24-27`), so pasting
  `+1 555 123 4567` stores `11555123456`. This is not fixed here; see §4.6 and §10.

### 2.3 Duplicate policy (unchanged by this plan)

`evaluateContactDuplicatePreSave` → `findDuplicates` (`contactSavePolicy.ts:154-193`,
`contactDuplicateDetection.ts:55-89`):

- It reads **every RLS-visible row of one table** for the org, with no phone filter and no limit.
- It compares **digits exactly**, so `5551234567` ≠ `15551234567`.
- It checks only the saved type's table.
- It fails **open** on a lookup error.

`leadsSupabaseApi.create` also runs a legacy exact-string check, which has these problems:

- no org filter;
- `.or()` values are not escaped;
- `.maybeSingle()` errors are ignored (`supabase-contacts.ts:106-150`).

The insert itself returns the DB row (`.select().single()`).

### 2.4 Visibility (RLS, `baseline:11304/11312/11338/12302/12306`)

| Role | Leads visible | Clients and recruits visible |
| --- | --- | --- |
| Agent | Own leads, plus the unassigned or `view_all` permission pools | `assigned_agent_id` own |
| Team Leader | Own plus downline, which is effectively self-only in production (#26) | Same rule |
| Admin / Super Admin | Whole org | Whole org |

So "no visible match" is **never** proof of agency-wide absence.

### 2.5 Telephony

- `proceedWithCall` builds `MakeCallOptions` from the click-time `selectedContact`
  (`FloatingDialer.tsx:575-590`).
- `TwilioContext.makeCall` does one `calls` INSERT and then `device.connect` (single-leg).
- **There is no DNC check on the floating-dialer or quick-call path.** `checkDNC` exists only on
  `DialerPage.tsx:2523-2528`.
- **Nothing marks a call as "starting".** `isDialingRef` is set only after three awaits
  (`TwilioContext.tsx:2226, 2236, 2263 → 2272`). A double-click can reach `makeCall` twice, which
  was reproduced in jsdom.
- The "Call Anyway" path (caller-ID warning) mixes `contactId` from the click with name and type
  read at confirm time (`:813-823` + `:579-582`).
- **The post-call disposition panel is unreachable at runtime.** The `ended` effect (`:680-689`)
  hides it in the same commit that `handleHangUp` shows it, because `hangUp` sets `'ended'`
  synchronously (`TwilioContext.tsx:1372-1377`). So `handleSaveDisposition` (`saveCall`, callback
  appointment, win) never runs from the floating dialer. This contradicts AGENT_RULES #22 and #34,
  which describe those writes as live. **This plan does not revive or change it**; see D-18.

### 2.6 View As

`AppLayout.tsx:64` renders `{!isImpersonating && <FloatingDialer />}`, pinned by
`viewAsRouteAllowlist.test.tsx:204-218`. Everything added here lives inside `FloatingDialer`'s tree,
so it is **never mounted** under View As. `TwilioProvider` stays pinned to `realProfile`.

---

## §3. Scope

**In scope**

1. A pure phone classifier and matcher with a strict key: US variants are equal; there is no
   last-10 equality.
2. A scoped exact lookup (`leads` ∪ `clients` ∪ `recruits`, RLS plus an explicit
   `organization_id`), with debounce, abort, generation and status.
3. The number-match row under the dialer's number: checking, error, none + Create Lead, a list for
   several matches, and too many.
4. Create Lead through the existing `AddLeadModal`, with a new create-prefill, an outcome contract,
   a double-submit guard, and a fix for the form wipe.
5. Shared create orchestration, extracted from Contacts so the dialer and Contacts use **one**
   implementation of ownership, required fields, the duplicate policy and create.
6. Post-save: select the DB-confirmed lead (guarded) and send a Contacts refresh signal.
7. Call-state safety: a busy predicate, a call-start guard, and the identity snapshot (D-12).

**Out of scope** (recorded in §10 as follow-ups)

- Any schema, RPC or RLS change.
- Changing `findDuplicates` or the legacy check in `leadsSupabaseApi.create`.
- Fixing `PhoneInput`.
- Reviving the disposition panel.
- Adding DNC to quick calls.
- `global_search`'s SECURITY DEFINER org-wide scope.
- The Edit-Lead reassign-to-editor defect.
- The ReminderPopup `'0000000000'` placeholder.
- The caller-ID `displayedFromNumber` churn.

---

## §4. Design

### 4.1 Phone classification and key (new pure module `src/lib/dialerPhoneKey.ts`)

**`classifyDialedNumber(dialString)`** takes the typed side, which is already reduced to `[\d*#+]`
by `dialStringFromRaw`, and returns one of:

| Kind | Rule | Lookup | Create Lead |
|---|---|---|---|
| `empty` | no characters | no | no |
| `incomplete` | < 10 digits (no `+`); `+1` with < 11 digits; `+` other with < 8 digits; **10 digits starting with `1`** (a prefix of `1`+10) | no | no |
| `unsupported` | contains `*`/`#`; misplaced or duplicate `+`; 11 digits not starting `1` (no `+`); ≥ 12 digits without `+` (incl. `00…`/`011…`); `+0…`; `+` with > 15 digits; `+1` with > 11 digits; **NANP-invalid** (area code or exchange starting 0/1, N11 area codes, e.g. `0000000000`) | no | no |
| `nanp` | 10 digits, or `1`+10, or `+1`+10, NANP-valid → `key = '1'+national` | yes | **yes** |
| `international` | `+` followed by 8–15 digits, not starting `0` or `1` → `key = digits` | yes | no (D-4) |

**`storedPhoneKey(value)`** handles the stored side and **returns `null` for anything not cleanly
parseable**:

- Only digits, spaces, `( ) . -` and one leading `+` are allowed. Letters, `x`/`ext`, `*`, `#`, `/`
  and `,` give `null`.
- With `+`: 8–15 digits, and exactly 11 if the digits start with `1` → the digits.
- Without `+`: 10 digits → `'1'+d`; 11 digits starting with `1` → `d`; anything else → `null`.

**Equality** is `typed.key === storedPhoneKey(row.phone)`. This mirrors
`private.phone_digits_e164ish` (`20260915035141:611-621`) and the dial target
(`TwilioContext.toE164`) for every accepted form. **It never compares the last 10 digits**, so
`+44 20 7946 0958` ≠ `(207) 946-0958`.

**`candidatePattern(cls)`** puts a `%` around and between every digit. For `nanp` it uses the
10-digit national number (`%5%5%5%1%2%3%4%5%6%7%`); for `international` it uses all key digits.

- **Superset proof:** any stored value whose key equals the typed key contains those digits in
  order, so it is always a candidate.
- The pattern contains only digits and `%`, so there is nothing to escape.

### 4.2 Scoped lookup (new `src/lib/dialerContactLookup.ts`)

`findVisibleContactsByPhone({ organizationId, cls, signal })` runs three parallel list queries, one
per table:

```ts
supabase.from(table)
  .select("id, first_name, last_name, phone")
  .eq("organization_id", organizationId)
  .ilike("phone", candidatePattern(cls))
  .limit(LIMIT + 1)            // LIMIT = 10 → truncation detectable
  .abortSignal(signal)
```

- **No `ORDER BY`.** In a local PostgreSQL 16 experiment under RLS, `ORDER BY id LIMIT` pushed the
  planner into a full primary-key walk (400 ms vs 225 ms at 100k rows per org).
- **No owner columns are selected.** The lookup shows only rows RLS already lets the user read, and
  never shows who owns them.
- Each row is classified by `storedPhoneKey`:
  - key equal → **exact**;
  - key `null` → **possible** (it cannot be proven different, e.g. `555-123-4567 x12`);
  - a different valid key → dropped.
- Names are sanitized like `resolve_inbound_contact` does (`'undefined'`/`'null'` → `''`).
- The type is always the table's type (R8): leads → `lead`, clients → `client`, recruits →
  `recruit`.
- **Any error fails the whole lookup and never returns a partial result.** `42501` or 401/403 is
  `denied`; anything else, including `data: null`, is `failed`; `AbortError` is `aborted`. A table
  that returns `LIMIT+1` rows makes the result `truncated`.

**Why this backend (D-1).** No existing browser-callable path does an exact, visibility-scoped
lookup. The alternatives each fail:

| Alternative | Why it was rejected |
| --- | --- |
| `resolve_inbound_contact` | service_role-only, org-wide, last-10 |
| `global_search` | SECURITY DEFINER, org-wide, substring, granted to anon |
| `resolve_inbound_caller_display_name` | deprecated, and a phone-to-name oracle |
| `search_contacts_*` | substring matching, plus per-row call aggregates |

A new **SECURITY INVOKER** RPC would get the **same** RLS visibility and, as verified locally, the
**same plan**. PostgreSQL will not use a non-leakproof qual as an index condition under RLS, and
`texticlike`, `textregexeq` and `phone_last10` all have `proleakproof = f`. So both options become
an `organization_id`-bounded scan: about 100–250 ms per table at 100k rows per org in the
experiment, and much smaller at real org sizes. The RPC would add a migration and an approval for
no performance gain. Only a SECURITY DEFINER function that re-implements RLS could use the indexes,
and that is explicitly **not** proposed.

The experiment's SQL is kept in the session scratchpad and can be re-run on request.

**AGENT_RULES #30 ("no frontend phone-probe resolvers").** That rule governs **inbound call-row
identity**. This lookup is a user-facing outbound search: its only effects are the UI offer and an
explicit or unique-match selection (D-3). It never writes a `calls` row. **Ruling requested: D-2.**

### 4.3 Lookup hook (new `src/hooks/useDialerPhoneLookup.ts`)

```ts
useDialerPhoneLookup({ dialString, active, organizationId, viewerId })
  → { cls, status, exact, possible, retry }
status: 'idle'|'incomplete'|'unsupported'|'checking'|'none'|'match'|'multiple'|'possible'
      |'too_many'|'error'|'denied'
```

- `cls = classifyDialedNumber(dialString)`.
- `requestKey` is `org|viewer|cls.key|retryNonce` only when `active` is true, `org` and `viewer` are
  present, and `cls` is `nanp` or `international`. Otherwise it is `null`.
- **Status is derived synchronously.** If the stored result's `forKey !== requestKey`, the status is
  `checking`, so no frame can show a previous number's "none" for the current number.
- The effect on `requestKey` runs a 350 ms debounce, then a new `AbortController` and a generation
  bump, then `findVisibleContactsByPhone`. The result is committed only if the generation still
  matches and the hook is mounted. Cleanup clears the timer, aborts, and bumps the generation.
  A superseded request commits nothing: no rows, no error and no loading flag.
- The status comes from the result:
  - `truncated` → `too_many`;
  - an exact match with no possible matches → `match`;
  - more than one exact match, or any exact match plus possible matches → `multiple`;
  - only possible matches → `possible`;
  - no candidates → `none`.
- `active` (supplied by `FloatingDialer`) is true only when all of these hold: the panel is open on
  the Dial tab; the current number came from user entry (§4.4); no contact is selected; and the
  call is **not busy** (§4.7).
- Because the lookup is keyed on `dialString`, it covers the search box (phone mode), the manual
  input, the keypad, backspace, and paste into either input.

### 4.4 `FloatingDialer` wiring (modified; lookup, render and guards only)

- **Entry source.** A `userEntry` state is set to **true** by the four user-entry handlers:
  `handleSearchChange` in phone mode, `handleManualDialChange`, `handleKeyPress` and
  `handleBackspace`. It is set to **false** by the programmatic paths: quick-call, a recent-row
  click, `handleSelectContact`, `clearSearch`, `resetAll`, the auto-select, and the post-save
  select. A programmatic prefill, such as an unlinked recent row, never runs the lookup until the
  user edits the number.
- **Selection generation.** `selectionGenRef` is bumped on every one of those ten paths. The
  create flow captures it when the modal opens.
- **Keypad and backspace** compute the next value from the committed `dialedNumber` and no longer
  call `setSearchTerm` inside a `setDialedNumber` updater. The visible behaviour is unchanged,
  including a key press after a selected contact starting a fresh number.
- **`doSearch`:**
  - The ≥ 10-digit phone branch is deleted (`:433-463`), and with it the last-10 auto-select and the
    `corePhoneDigitsForMatch`/`phonesMatch` helpers.
  - Scheduling is skipped when the number classifies as `nanp` or `international`; the match row
    handles those.
  - A sequence guard drops stale responses.
  - `error` is read, and on failure the dropdown shows **"Search unavailable"**, never
    "No contacts".
  - The name and partial-number typeahead is otherwise unchanged: leads-only substring, 5 rows
    (D-17).
- **Unique exact match (D-3).** An effect applies the one-row selection when all of these hold:
  `status === 'match'`, the lookup's generation is current, the call is not busy, and the entry is
  still `userEntry`. It uses the single batched `handleSelectContact` shape: one caller-ID LRU
  stamp, as today. **It does not rewrite `dialedNumber`** to a differently-formatted number.
- **Match row placement.** A new `DialerNumberMatchPanel` renders **directly under the manual
  number input row** (after `:1278`, before the keypad). There the search-box dropdown overlay
  cannot cover it. The Call buttons keep their current conditions (the digit count of 10 or more is
  unchanged).
- **Type badge.** The selected-contact card gains a Lead, Client or Recruit badge, so an existing
  contact is visibly *existing*, with its type.

### 4.5 Match row UI (new `src/components/layout/floating-dialer/DialerNumberMatchPanel.tsx`, < 120 lines)

The row is Tailwind only and compact (`text-[11px]`). It is hidden whenever the call is busy.

| status | UI |
|---|---|
| idle / incomplete / unsupported / match | nothing |
| checking | spinner + "Checking contacts…" |
| error | "Couldn't check contacts." + **Retry** |
| denied | "You don't have access to check contacts." |
| too_many | "Many similar numbers — search by name to pick one." |
| none, `nanp`, may create | **"No matching contact found"** + **"+ Create Lead"**. Its `title` tooltip reads "Only contacts you can access were checked." |
| none, `nanp`, may not create | "No matching contact found" |
| none, `international` | "No matching contact found" |
| multiple / possible | "N matching contacts — pick one" / "Similar number on file — pick if it's the same person". Up to 5 rows (name, phone as stored, type badge), each → `handleSelectContact` |

### 4.6 Create Lead flow

The flow is split across these new files:

- `src/components/layout/floating-dialer/useDialerLeadCreate.ts` — the hook;
- `src/components/layout/floating-dialer/DialerCreateLeadHost.tsx` — the host;
- `src/components/layout/floating-dialer/DialerDuplicateConfirm.tsx` — the duplicate confirmation.

**Availability (D-5).** The offer requires all of these:

- `usePermissions()` has finished loading (`!isLoading`), has no `error`, and
  `hasContactsPermission("contacts.leads.create")` and `hasPageAccess("Contacts")` are both true.
- The org and the effective viewer are present.
- The call is not busy.

The permissions hook returns catalog defaults while loading or on error, so this gate is deliberately
fail-closed.

**Start.**

- The session records: the prefill phone (`'1'+national`, the same format `normalizePhoneNumber`
  stores), `originGen = selectionGenRef.current`, and `originKey`.
- It then loads `contact_management_settings` with an explicit status of `loading`, `ready` or
  `error`, keyed by org, with a generation guard. It reuses `ContactDeepLinkPage`'s pattern of a
  loader that is awaited at save time and does not cache failures.
- If the settings fail to load, **Save is refused** and the form shows "Couldn't load your agency's
  lead settings — Retry" (D-7).
- The assignee list loads **lazily, only while the modal is open** (§4.8).

**Modal.** The existing `AddLeadModal` is rendered with the new `createPrefill={{ phone }}`. The
edit-mode prop `initial` is **not** used.

- The host is a **fragment sibling of the panel**, like the caller-ID warning at `:788`, and keeps
  AddLeadModal's own `z-[200]`. The dialer panel (`z-[1000]`) therefore stays **above** the backdrop,
  and its Call, Answer, Decline and Hang Up controls remain clickable.
- The State and DOB popovers (`z-[300]`) stay above the card.
- Nesting the modal inside the panel would clip it: the panel's inline `transform` plus
  `overflow-hidden` make it the containing block. Raising the modal above 1000 would cover the call
  controls. Both are avoided.
- The modal's lifetime belongs to the create session, not to the panel's `open` or `minimized`
  state, so closing or minimizing the panel does not reset the form.

**Duplicate confirmation.** This is a **non-Radix** inline card, a fixed centred panel at `z-[210]`
over the modal. A modal Radix Dialog would set `body { pointer-events: none }` and turn the first
click on Hang Up into a dismissal.

- Its resolver lives in a ref and is settled with `false` on unmount, on an identity change, and
  when the session closes.
- The buttons read "Save anyway" and "Back".

**Save (`onSave` → `Promise<AddLeadSaveOutcome>`).** Every step below that refuses returns
`{kind:'refused'}`; the form stays open and the typed values are kept.

1. **Synchronous in-flight ref.** A second submit is a no-op.
2. **Settings must be `ready`** (awaited). Otherwise refuse with a message.
3. **Final number check.** `classifyDialedNumber(form.phone)` must be `nanp`. Otherwise refuse with
   "Enter a complete US phone number." This also catches the `PhoneInput` corruption
   (`11555123456`, whose area code starts with 1).
4. **Recheck the final number** with `findVisibleContactsByPhone`.
   - An error → refuse with "Couldn't confirm this number is new — try again". This fails
     **closed** (D-6).
   - Any exact or possible match, or a truncated result → refuse with "This number already matches
     Jane Doe (Client)" or "… N contacts". The dialer's lookup is also re-run, so after Cancel the
     dialer shows the existing contact or contacts.
5. **Fire-time identity check.** The component must still be mounted, `!isImpersonating` (read
   through a ref written every render), and the viewer and org must be unchanged. Otherwise refuse
   silently.
6. **`createLeadWithPolicy`** (§4.9) runs with the dialer's `preSave`. That is the shared
   `evaluateContactPreSave`, run with the loaded settings, the inline confirm, and the same toasts
   as Contacts.
7. **Refused** → `{kind:'refused'}`. **Failed**, meaning a thrown insert or the legacy check's
   `block` throw → the error propagates, and AddLeadModal toasts it and stays open.
8. **Created** with the **DB-returned `lead`**:
   - toast "Lead added";
   - `dispatchContactsChanged({ type: 'lead', id })`;
   - **select the lead only if** it is still mounted, `!isImpersonating`, the viewer and org are
     the same, **the call is not busy** (read from the ref), and `selectionGenRef.current ===
     originGen`, meaning the agent has not edited the number or selected anything since opening the
     form. The selection is `{ id, first_name, last_name, phone: lead.phone, type: 'lead' }`, set
     through the single batched `handleSelectContact`.
   - If any of those checks fails, the dialer is not touched and the toast adds "It wasn't selected
     because a call is in progress" or "…because the dialer changed".
   - **No navigation and no `makeCall`.**

**Cancel and close.** The dialer's number, search text and selection are untouched, because the
dialer never wrote them for the modal. While saving, Cancel, X and the backdrop are disabled (D-14).

**Busy while the form is open (D-13).** If a call starts or rings while the form is open, the panel
is opened and un-minimized (`setOpen(true)`, `setMinimized(false)`), so the live-call controls are
reachable above the form's backdrop. The form stays open. A save completing during the call is
**not selected** (step 8). When the call ends and the dialer is idle again, the lookup re-runs for
the same number, finds the new lead through the normal path, and selects it through the unique-match
rule. Nothing is queued and nothing is changed mid-call.

### 4.7 Call-state busy predicate and call-start guard (`FloatingDialer`, D-12)

`busy = onCall || showDisposition || twilioCallState !== 'idle' || showCallerIdWarning || callStarting`

- It is mirrored into `busyRef`, which is written every render and read at every async completion.
- `callStarting` is new: state plus a synchronous ref. It is set at the start of `initiateCall` and
  cleared when `makeCall` resolves or rejects, or when `initiateCall` stops at the caller-ID warning,
  which is then covered by `showCallerIdWarning`.
- **Recommended hardening, same ref:** a second Call click while `callStartingRef.current` is set is
  a **no-op**. This closes the live double-`makeCall` window.
- **Recommended identity snapshot:**
  - `initiateCall` and `proceedWithCall` receive the contact snapshot (`ContactResult | null`) taken
    at click time.
  - `pendingCall` carries that snapshot, so "Call Anyway" builds `MakeCallOptions` from one source.
  - `contactId`, `contactName` and `contactType` can never mix.

**Unchanged:** `TwilioContext.tsx` (no edits), the caller-ID selection (`getSmartCallerId`, the
flagged-number check, final validation), `applyOutboundRingTimeout:false`, no campaign fields, one
`calls` INSERT, and no duration write.

### 4.8 Assignment (D-10)

The dialer follows the same rule as Contacts, extracted as a pure helper that Contacts also uses
(`resolveAssignableLeadAgents(role, isEffectiveSuperAdmin, teamAgents, orgProfiles)`):

| Viewer | Assignable agents |
| --- | --- |
| Team Leader | `get_contact_scope_agents` (the same RPC `useContactScope` uses) |
| Admin / effective Super Admin | Active org profiles, with an **explicit `organization_id` filter** |
| Everyone else | `[]` (self only) |

- New lazy hook `src/hooks/useAssignableLeadAgents.ts`. It does not mount `useContactScope`, whose
  side effects include preference writes.
- **The default is self.** Until the list loads, or if it fails, the list is `[]`, which leaves only
  "Myself" available: fail closed.
- `validateAssignment` and the RLS WITH CHECK are unchanged.
- The campaign-attach option appears, as in Contacts, only when assigning to another agent. The
  quick call itself stays non-campaign.

### 4.9 Shared create orchestration (D-8, D-9)

`src/lib/contactSavePolicy.ts` adds **`evaluateContactPreSave`**, a pure orchestration. It performs,
in order:

- the fail-closed org check;
- `computeMissingRequired` with `enforceCustomFields:false`, as on Add today;
- `evaluateContactDuplicatePreSave`.

It returns `{ ok: true }` or `{ ok: false, message? }`, and asks for confirmation through an injected
`confirmDuplicate(label, description)`. `Contacts.enforceContactPreSave` becomes a thin wrapper that
keeps its toasts, messages and Radix dialog exactly as they are. Its update, client and recruit
callers are unchanged.

New `src/lib/leadCreatePolicy.ts` adds **`createLeadWithPolicy`**. It is extracted from
`handleAddLead` and does the following:

- Lead-source fallback.
- Owner resolution: explicit assignee, else the effective viewer, else refuse with the existing
  message.
- `preSave`.
- `leadsSupabaseApi.create`.
- The optional campaign attach, returning notices for the caller to toast.

It returns `{kind:'created', lead}` or `{kind:'refused', message?}`.

- `Contacts.handleAddLead` calls it and returns an `AddLeadSaveOutcome`. Its toasts and its
  `fetchData()` stay as they are.
- **Effect on Contacts:** a refused Add now **keeps the modal open with the typed values** instead
  of closing. This is a bug fix and consistent with #36.

**`AddLeadModal` contract.**

- `onSave: (...) => Promise<AddLeadSaveOutcome | void>`, where
  `AddLeadSaveOutcome = {kind:'created', leadId} | {kind:'refused'}`.
- It closes only on `created`, or on `void`. `void` keeps the legacy close, so the Edit instance is
  unchanged.
- It never rejects with `ContactSaveRefusedError` for create, which keeps #36's boolean create
  contract as a typed result.
- `contactsViewAsFailClosed.test.tsx:552-573`, which awaits `handleAddLead` resolving, still holds.

### 4.10 Form fixes (`useAddLeadModalForm`, `AddLeadModal`)

- **Reset** only when `open` goes false→true, or when `initial` changes identity. It no longer resets
  when `leadSources` arrives. `createPrefill.phone` is merged in at reset, in create mode only.
- **Lead source.** The reset default is marked "auto". When the org's sources arrive, an untouched
  auto default becomes `leadSources[0]`, as today; a value the user picked is kept if it is valid.
- **The Edit instance** stops reverting typed edits when the sources load, which is the same bug.
- **`AddLeadModal`** gains:
  - a synchronous `submittingRef` guard;
  - Cancel, X and the backdrop disabled while `saving`;
  - a `createPrefill` prop, ignored when `initial` is set.
- The default export and prop names are unchanged, and the Contacts create instance still omits
  `initial`.

### 4.11 Contacts refresh

New `src/lib/contactsChangedEvent.ts` follows the `quick-call.ts` typed-event pattern:
`CONTACTS_CHANGED_EVENT = "agentflow:contacts-changed"`, `dispatchContactsChanged({type, id})` and
`onContactsChanged(handler)`.

- `Contacts.tsx` listens and calls `fetchData({ silent: true })`, plus `fetchKanban({ silent: true })`
  when `view === "kanban"`.
- Both already fail closed under View As, and the listener is also skipped while impersonating.
- There is no other listener. The Dashboard keeps its "no automatic refresh" rule.

---

## §5. Exact files to touch

**New**

| File | Purpose |
| --- | --- |
| `src/lib/dialerPhoneKey.ts` | Pure classifier, stored key and candidate pattern |
| `src/lib/dialerContactLookup.ts` | Scoped three-table lookup |
| `src/hooks/useDialerPhoneLookup.ts` | Debounce, abort, generation and status |
| `src/hooks/useAssignableLeadAgents.ts` | Lazy assignable-agents loader |
| `src/lib/leadCreatePolicy.ts` | `createLeadWithPolicy` plus `resolveAssignableLeadAgents` |
| `src/lib/contactsChangedEvent.ts` | Typed refresh event |
| `src/components/layout/floating-dialer/DialerNumberMatchPanel.tsx` | Match row UI |
| `src/components/layout/floating-dialer/useDialerLeadCreate.ts` | Create session, settings, save pipeline and guards |
| `src/components/layout/floating-dialer/DialerCreateLeadHost.tsx` | AddLeadModal plus duplicate-confirm host |
| `src/components/layout/floating-dialer/DialerDuplicateConfirm.tsx` | Inline confirm (non-Radix) |

**Modified**

| File | Change |
| --- | --- |
| `src/components/layout/FloatingDialer.tsx` | Entry source, selection generation, lookup and match row, busy predicate, call-start guard, snapshot, create host, type badge, doSearch fixes |
| `src/components/contacts/AddLeadModal.tsx` | Outcome contract, `createPrefill`, submit guard, close disabled while saving |
| `src/components/contacts/useAddLeadModalForm.ts` | Reset semantics, prefill merge, lead-source default |
| `src/lib/contactSavePolicy.ts` | Adds `evaluateContactPreSave` |
| `src/pages/Contacts.tsx` | `enforceContactPreSave` delegates; `handleAddLead` uses `createLeadWithPolicy` and returns an outcome; `resolveAssignableLeadAgents`; contacts-changed listener |

**Tests (new)**

- `src/lib/__tests__/dialerPhoneKey.test.ts`
- `src/lib/__tests__/dialerContactLookup.test.ts`
- `src/hooks/__tests__/useDialerPhoneLookup.test.tsx`
- `src/components/contacts/__tests__/addLeadModalCreatePrefill.test.tsx`
- `src/lib/__tests__/leadCreatePolicy.test.ts`
- `src/lib/__tests__/contactPreSaveOrchestration.test.ts`
- `src/components/layout/__tests__/floatingDialerCreateLead.test.tsx`
- `src/pages/__tests__/contactsAddLeadOutcome.test.tsx`
- `src/contexts/__tests__/twilioManualCallIdentity.test.tsx`
- `src/lib/__tests__/floatingDialerCreateLeadPinned.test.ts`

**Docs:** `WORK_LOG.md` (newest-first entry), `AGENT_RULES.md` (see D-18), root
`implementation_plan.md` (§18 pointer), and this plan (as-built appendix).

**Not touched:** `TwilioContext.tsx`, `dialer-api.ts`, `supabase-contacts.ts`,
`contactDuplicateDetection.ts`, `PhoneInput.tsx`, any `supabase/` file, and any Edge Function.

---

## §6. Decisions for Chris (recommendation first)

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Lookup backend | **Browser, RLS-scoped per-table list queries (no migration).** Alt: a SECURITY INVOKER RPC (a migration and approval for the same plan; see §4.2) |
| D-2 | AGENT_RULES #30 "no frontend phone-probe resolvers" | Rule that it covers inbound call-row identity only; the outbound dialer search is allowed because it never writes `calls` identity |
| D-3 | One exact visible match | **Auto-select**, as the dialer already does for leads, guarded. Alt: show "Existing Lead · Jane Doe · Select", one extra click |
| D-4 | International (`+44…`) | Look up and offer existing contacts; **no Create Lead** (the Add Lead phone field is US-only) |
| D-5 | Who sees Create Lead | `contacts.leads.create` **and** Contacts page access, with permissions loaded and error-free (fail closed) |
| D-6 | Final recheck posture | **Fail closed** on a lookup error; refuse on any visible exact or possible match |
| D-7 | Settings load failure | **Fail closed** (Save refused, with Retry). Contacts keeps its existing behaviour |
| D-8 | Refusal contract | Resolved `{kind}` outcome; the modal closes only on `created` or legacy `void`; Contacts adopts it, so a refused Add keeps the form open there too |
| D-9 | One implementation | Extract `evaluateContactPreSave` and `createLeadWithPolicy`, used by both Contacts and the dialer |
| D-10 | Assignment in the dialer | Parity with Contacts (lazy list, default self). Alt: self-only |
| D-11 | Save finishing during a call | Never select; toast and refresh; the post-call lookup finds the lead |
| D-12 | Call-start guard and identity snapshot | **Yes, both**: FloatingDialer-only changes that close a live double-dial window and the Call-Anyway identity mix |
| D-13 | Layering | Host as a panel sibling at `z-[200]`; inline non-Radix duplicate confirm; open and expand the panel when a call starts or rings with the form open |
| D-14 | Close during save | Disable Cancel, X and the backdrop while saving (both hosts) |
| D-15 | Required custom fields on Add | Keep parity (`enforceCustomFields:false`) and correct the AGENT_RULES "Required-field enforcement" row, which currently claims Add enforces them |
| D-16 | DNC on quick calls | None exists today; **do not add** under this task (separate decision) |
| D-17 | Name and partial typeahead | Keep it leads-only, but never show "No contacts" on error |
| D-18 | AGENT_RULES updates at implementation | (a) #36: the create outcome contract; (b) a new invariant for the dialer lookup (strict key, no last-10, RLS and org, errors ≠ absence); (c) record that the floating-dialer disposition panel is unreachable, so the #22/#34 quick-call writes are not live |

---

## §7. Verification plan

**Automated (local, mocked; no live services).**

- Each new suite is run **fail-first** against unmodified source wherever it pins a defect, then
  against the change:
  - keypad and backspace lookup;
  - errors shown as absence;
  - international last-10 matching;
  - the form wipe;
  - refusal closing the form;
  - double submit;
  - a late auto-select after Call.
- The scenarios required by the request map to tests as follows:

| Scenario | Test |
| --- | --- |
| New number → create → selected lead; no navigate; no `makeCall` | integration |
| Cancel keeps the number | integration |
| Failed and refused saves keep the form | modal + integration |
| Existing lead, client or recruit shown with its type; multiple → list, no auto-select | lookup + integration |
| Formatted, `+1` and punctuation variants; international not equated by last 10 | pure |
| Keypad, backspace, paste and typing all trigger the lookup | integration |
| Stale A→B, org, viewer, selection and call-state changes discard results | hook + integration |
| Missing permission, still loading, or errored → no offer | integration |
| Double submission → one create | modal + hook |
| Save while `dialing`/`active` does not change the selection | integration |
| The next Call → `makeCall` **once** with `{contactId: <DB id>, contactName, contactPhone, contactType:'lead', applyOutboundRingTimeout:false}` and no campaign keys | integration |
| Real `TwilioProvider`: those options → exactly one `calls` INSERT with that identity, `direction:'outbound'`, no `campaign_id`, no `duration`; `twilioMakeCall` once | provider |
| New files < 200 lines; no `service_role`; the old leads-only `%probe%` gone; existing pins intact | source pins |

- **Existing pins that must stay green:**
  - `outboundPathPinned` and `inboundBrowserLifecycleWrites` (6 `calls` mutation sites, no
    duration);
  - `floatingDialerRecent` (fetchRecentCalls ordering, no `Closed Won`, no `.ilike` in that slice);
  - `inboundDeviceLifetime` (no destroy on close);
  - `viewAsRouteAllowlist` (FloatingDialer unmounted under View As);
  - `contactsViewAsFailClosed`, `contactsFullScreenDuplicateParity`,
    `contactDeepLinkDuplicateParity` and `contactSavePolicy` (duplicate-policy parity).
- **Status updates, disposition, history and logs.**
  - Status updates stay owned by the webhooks. The TwilioContext pins prove that no new browser
    `calls` writes exist.
  - Recent-calls history resolves by `contact_id` and `contact_type`, so it will show the new lead by
    ID (the `dialerRecentCalls` tests).
  - `call_logs.lead_id` comes from the dial-time `contactId`; the provider test asserts that where
    the harness allows.
  - Disposition is documented as unreachable today (§2.5) and is unchanged.

**Commands.**

1. `npx vitest run <new suites>` and the adjacent suites listed in §7.
2. The full `npx vitest run`: expect 3,516 + N passed, the same 12 failing files, 1 failed test
   (v29) and the existing unhandled rejection.
3. `npx tsc -p tsconfig.app.json --noEmit` with the normalized error list diffed against the
   baseline: expect **90 errors and an empty diff**. `npx tsc --noEmit` is reported, but it checks
   nothing.
4. `npx eslint` on the new and modified files: no new problems.
5. `npm run build` and `git diff --check`.
6. Mutation controls: revert each fix on a scratch copy and confirm that its test fails.

**Manual browser checklist.** jsdom cannot see z-order, so this is for Chris or a local run and has
**no live calls**:

- widths 1440, 1024 and 390;
- the modal below the panel, with the panel's Call and Hang Up clickable;
- the State and DOB popovers above the card;
- the duplicate confirm clickable;
- an incoming ring while the form is open (the panel opens and expands);
- the panel closed or minimized with the form preserved.

The local Team/Open Playwright harness (Docker plus a local Supabase and a fake Voice.js) is used
only if it is available in this container.

---

## §8. Explicit non-actions

- No migration, RPC, RLS, grant or Edge Function change.
- No Supabase MCP call (no read and no write).
- No Vercel action, deploy, merge or push to `main`.
- No production test calls.
- No edit to `TwilioContext.tsx`, `dialer-api.ts`, `supabase-contacts.ts`,
  `contactDuplicateDetection.ts` or `PhoneInput.tsx`.
- No change to the duplicate-policy semantics, the caller-ID selection, the DNC behaviour, the
  disposition panel, or the quick-call event contract.

---

## §9. Risks, limitations and rollback

- **Concurrent-create limitation.**
  - The lookup-then-insert sequence is check-then-act, and `leads.phone` has no uniqueness in the
    DB. Two agents or tabs, or an agent racing an inbound auto-create (which takes a
    per-(org, last10) advisory lock the browser cannot take), can both create.
  - The final recheck narrows the window but cannot close it.
  - **RLS-invisible duplicates:** an Agent can create a lead for a number that another agent's
    record already uses. This is the same as Contacts Add Lead today.
  - Either kind of duplicate turns future inbound calls from that number into `ambiguous`
    (unlinked).
  - Closing these gaps needs a server-side create RPC (advisory lock plus an org-wide existence
    check) and a decision on existence disclosure. That is a follow-up requiring approval.
- **Performance.** Each complete-number lookup runs three org-bounded scans (RLS prevents index use
  for any option; see §4.2), each with `LIMIT 11`. Only matches cross the network. It runs once per
  complete number after the debounce, and it is aborted when superseded.
- **Possible-match false positives.** A stored value that can't be parsed but contains the digits
  suppresses Create Lead. This is the conservative direction.
- **Duplicate-policy gaps are unchanged:**
  - digits-exact matching;
  - the saved type's table only;
  - RLS-limited, fail-open;
  - a whole-visible-table read at save time;
  - `leadsSupabaseApi.create`'s legacy check.

  The dialer's own recheck covers US variants and all three tables, among visible rows.
- **The Contacts behaviour change** (a refused Add keeps the form open) is intended.
- **Rollback:** revert the branch commit or commits. There is no data, schema or configuration to
  undo.

---

## §10. Follow-ups discovered (not in this plan; each needs its own approval)

1. A server-side lead-create RPC: an advisory lock, an org-wide existence check, and a decision on
   what is disclosed about records the caller cannot see.
2. Bound `findDuplicates`: a server-side digit prefilter, with the same digits-exact semantics.
3. The legacy duplicate check in `leadsSupabaseApi.create`: unescaped `.or()`, no org filter,
   ignored multi-row errors, and `email.eq.` with blank emails.
4. **Security review:** `global_search` is SECURITY DEFINER, org-wide, and granted to `anon`. The
   docs misdescribe it as scoped by `auth.uid()`.
5. `PhoneInput` keeps the first 10 digits, which corrupts pasted `+1` numbers.
6. Editing a lead through `AddLeadModal` reassigns it to the editor. The Edit wrapper also closes
   on failure, despite its comment.
7. The floating-dialer disposition panel is unreachable; decide whether to revive it (with snapshot
   identity and the currentCallId fix) or delete it.
8. The ReminderPopup `'0000000000'` placeholder and the CampaignDetail `campaign_leads.id`
   fallback, both pseudo-identities.
9. The quick-call listener has no `onCall` guard, and a `fromNumber` in the event becomes the
   persisted caller ID.
10. `displayedFromNumber`'s effect stamps the caller-ID LRU on every keystroke, but its result is
    never rendered.
11. Answer and Decline are hidden while the panel is minimized, because the incoming effect does
    not un-minimize it.
12. Contacts `fetchData` has no generation guard for its grids.
13. The Contacts duplicate ConfirmDialog (Radix `z-50`) likely paints beneath AddLeadModal
    (`z-[200]`).
