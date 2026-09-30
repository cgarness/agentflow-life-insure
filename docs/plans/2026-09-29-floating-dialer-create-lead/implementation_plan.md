# Implementation Plan — Floating Dialer: Create Lead from an unmatched phone number (rev 1 — awaiting approval)

> **STATUS: PLAN ONLY. This needs Chris's explicit approval (AGENT_RULES §8) before any application edit.**
>
> - **Done so far:** no application file has been edited and no backend command has been run. The branch holds only this
>   plan and its pointer in the root `implementation_plan.md` (commit `b9b16ee`, pushed to the feature branch, never to
>   `main`).
> - **Rev 1:** this revision folds in an adversarial review of rev 0 (§12). Seven lens reviewers produced 45 findings,
>   and each reviewer's findings were re-checked against the code by an independent skeptic. 41 were upheld (fully or
>   partly) and 4 were refuted.
> - **Repository:** `cgarness/agentflow-life-insure`, branch `claude/floating-dialer-create-lead`, base `main` @
>   `d05f475`.
> - **Scope:** frontend only. There is **no migration, RPC, RLS, grant, Edge Function or production action**, no deploy,
>   no merge, no push to `main`, and no production test call.

---

## §0. TL;DR

When the agent enters a complete number in the floating dialer, the dialer runs a scoped **exact** lookup over
leads, clients and recruits. It fires however the number is entered: typed, pasted, keyed on the keypad, or finished
with backspace. The lookup respects the organization and RLS and never downloads the contact book.

| Lookup outcome | What the dialer shows, right under the number |
| --- | --- |
| Succeeds, no visible match, number is a creatable US number | **"No matching contact found"** and **"+ Create Lead"** |
| One exact match | That contact is selected, with its real type |
| Several exact or near matches | A pick-list; nothing is chosen for the agent |
| Loading, error, denied, truncated or incomplete input | Never shown as "no contact" |

**Create Lead** opens the existing Add Lead modal in create mode with the number prefilled. It goes through the
**same** ownership, assignment, required-field and duplicate-policy code as Contacts, which is now shared rather than
copied.

After a DB-confirmed save, the dialer selects the returned lead (guarded) and Contacts refreshes. It does not
navigate and does not dial.

**Call** stays available throughout. A save never changes the contact of a call that is starting or in progress.

**TwilioContext is not edited.** The floating dialer gains a call-start guard that closes a live double-dial window it
has today (D-12).

---

## §1. Inputs read and overlapping work

**Documents read.**
- `AGENT_RULES.md`: §1–§11 and the relevant invariants (#8, #9, #13, #14, #18, #22, #30, #31, #32, #34, #36, #37,
  and the Schema Gotchas).
- `VISION.md`.
- The newest `WORK_LOG.md` entries: the 2026-09-29 Reports release, and the Reports and Contact Follow-ups work of
  2026-09-28/29.

**Overlapping work.**
- **Open PR #395** (Contact Follow-ups / appointment ownership) touches none of the code files in §5.
  - It does share `WORK_LOG.md`, `implementation_plan.md` and `AGENT_RULES.md`.
  - It already claims root plan **§17**, so this plan's pointer is **§18**.
  - Whichever PR merges second resolves the doc-only merge conflict.
- **PRs #382, #383, #378 and #294** do not overlap: they cover leaderboard, OAuth and realtime work.

**Baselines on untouched `main` (measured 2026-09-29).**

| Check | Result |
| --- | --- |
| `npx tsc -p tsconfig.app.json --noEmit` | **90 errors**. 6 are in `TwilioContext.tsx`; none are in the other target files. |
| `npx tsc --noEmit` | Exit 0, but it checks nothing: the root tsconfig has `files: []` and only references other projects. |
| `npx vitest run`, tests | **3,516 passed / 1 failed / 14 skipped** |
| `npx vitest run`, files | 12 failing files, the same set as before: 11 on `supabaseUrl is required`, including `addLeadAssignmentGate.test.ts`, plus the voicemail v29 pin |
| `npx vitest run`, errors | 1 existing unhandled rejection, from `teamOpenRevealIntegration` |
| `npx eslint .` | 212 problems (15 errors) |

---

## §2. Current behaviour on `main` (evidence)

### 2.1 Floating-dialer lookup

`doSearch` is at `FloatingDialer.tsx:423-481`.

- **It only searches `leads`**, with no `organization_id` filter.
- **For 10 or more digits it matches a contiguous substring**, `ilike '%<10 digits>%'` (`:433-442`). That misses
  punctuated stored values: CSV imports store `(555) 234-5678` verbatim (`import-contacts/index.ts:255`).
- **It compares by the last 10 digits** (`:84-95`), so `+44 20 7946 0958` equals the US number `(207) 946-0958`.
- **On a unique match it auto-selects and rewrites `dialedNumber`** to the stored value (`:446-453`).
- **It ignores `error`, so a failure reads as "No contacts".** It destructures only `data`, and the catch returns `[]`
  (`:438`, `:466`, `:476-477`, `:1222`).
- **It has no stale guard**: no generation counter and no abort. Its timer is cleared only by the two text handlers,
  so a late result can land after quick-call, a Recent click, a selection, clear, or even after Call.
- **The keypad and backspace never search** (`:545-566`).
- **The dropdown can cover the area below it.** It is `absolute top-full … z-10 max-h-60` (`:1219-1220`), so it
  overlays everything under the search box. There is no outside-click close.

### 2.2 Add Lead

**Refusals close the form.** `AddLeadModal` closes whenever `onSave` resolves (`AddLeadModal.tsx:124-125`), and
`Contacts.handleAddLead` resolves when it refuses a save:
- when no owner can be determined (`Contacts.tsx:1586-1589`);
- when a required field is missing, a duplicate block applies, or the user cancels a duplicate warning (`:1596`).

The typed values are lost in every one of those cases.

**Lead sources arriving wipes the form.** The reset effect in `useAddLeadModalForm` depends on `leadSources`
(`useAddLeadModalForm.ts:35-67`), so typed or prefilled values are wiped when the org's lead sources load.

Other gaps on the Add Lead path:
- `initial` is the only mode switch, and a truthy value means edit mode. There is no create-prefill.
- There is no synchronous double-submit guard.
- `handleAddLead` never returns the created row.
- The pre-save orchestration, `enforceContactPreSave` (`Contacts.tsx:1495-1564`), is local to Contacts, and its
  settings load fire-and-forget (`:1108-1114`).
- `PhoneInput` keeps only the first 10 digits (`PhoneInput.tsx:24-27`). Pasting `+1 555 234 5678` stores
  `11555234567`. This plan does not fix that; see §10.

**The duplicate warning is hidden.** Contacts renders its duplicate `ConfirmDialog` with Radix at `z-50`
(`Contacts.tsx:3518-3537`, `ui/dialog.tsx:22,39`), and it **paints underneath** the `z-[200]` AddLeadModal. No
ancestor creates a stacking context, and Radix sets `body{pointer-events:none}`. So any click cancels the invisible
prompt. The **agency "warn" duplicate setting is effectively unusable on Contacts today**; D-19 fixes it.

### 2.3 Duplicate policy (semantics unchanged by this plan)

**`evaluateContactDuplicatePreSave` → `findDuplicates`** (`contactSavePolicy.ts:154-193`,
`contactDuplicateDetection.ts:55-89`):
- It reads **every RLS-visible row of one table** for the org, with no phone filter and no limit.
- It compares phone numbers digit for digit, so `5552345678` ≠ `15552345678`.
- It checks only the table for the type being saved.
- It fails **open** when the lookup errors.

**`leadsSupabaseApi.create`** also runs a legacy exact-string check (`supabase-contacts.ts:106-150`):
- It has no org filter.
- It builds an unescaped `.or()`.
- It ignores errors from `.maybeSingle()`.
- It makes two awaited reads before the INSERT.
- The INSERT then returns the DB row via `.select().single()`.

### 2.4 Visibility (RLS: `baseline:11304/11312/11338/12302/12306`)

| Role | Leads | Clients / recruits |
| --- | --- | --- |
| Agent | Own leads (`user_id = auth.uid()`), plus the permission pools `view_unassigned` and `view_all` | Own (`assigned_agent_id`) |
| Team Leader | Own plus downline; effectively self-only in production (#26) | Own plus downline |
| Admin / Super Admin (home org) | Whole org | Whole org |

"No visible match" is **never** proof that the agency has no such contact.

### 2.5 Telephony

- `proceedWithCall` builds `MakeCallOptions` from the `selectedContact` in scope at click time
  (`FloatingDialer.tsx:575-590`).
- `TwilioContext.makeCall` does exactly **one** `calls` INSERT and then single-leg `device.connect`.
- `finalizeCallRecord` writes `status:'completed', ended_at` and a `call_logs` row whose `lead_id` is the dial-time
  `contactId` (`TwilioContext.tsx:1262-1336`). There is no browser `duration` write.
- **There is no DNC check anywhere on the floating-dialer or quick-call path.** `checkDNC` runs only in
  `DialerPage.tsx:2523-2528`.
- **Nothing marks a call as "starting".** `isDialingRef` is set only after three awaits (`TwilioContext.tsx:2226,
  2236, 2263 → 2272`), so a double-click can reach `makeCall` twice. This was reproduced in jsdom.
- **The "Call Anyway" path reads identity from two places.** It takes `contactId` from `pendingCall`, but name and type
  from `selectedContact` at confirm time (`:813-823` with `:579-582`). It also has no guard against a second start.
- **The post-call disposition panel is unreachable at runtime.** `hangUp` sets `'ended'` synchronously
  (`TwilioContext.tsx:1372-1377`). The `ended` effect (`:680-689`) then hides the panel in the same commit that
  `handleHangUp` shows it. So `handleSaveDisposition` (`saveCall`, the callback appointment, the win) never runs from
  the floating dialer. **This plan does not change it**; see D-18.

### 2.6 View As

`AppLayout.tsx:64` renders `{!isImpersonating && <FloatingDialer />}`, pinned by `viewAsRouteAllowlist.test.tsx:204-218`.
Everything added here lives inside `FloatingDialer`'s tree, so none of it is **ever mounted** under View As.
`TwilioProvider` stays pinned to `realProfile`.

---

## §3. Scope

**In scope.**
1. A pure phone classifier and key. US variants compare equal; there is no last-10-digit equality. Lookup eligibility
   is separate from create eligibility.
2. A scoped exact lookup (§4.2–§4.3).
3. The match row under the number, and a fixed typeahead (§4.4–§4.5).
4. Create Lead through the existing `AddLeadModal`, with create-prefill, the outcome contract, a double-submit guard and
   the form-wipe fix (§4.6, §4.10).
5. Shared create orchestration extracted from Contacts: **one** implementation of ownership, required fields, the
   duplicate policy and create (§4.9).
6. A guarded selection of the DB-returned lead, plus a Contacts refresh event (§4.6, §4.11).
7. A call-busy predicate and a call-start guard (§4.7).
8. D-19: the one-line z-index fix that makes Contacts' duplicate prompt visible.

**Out of scope** (tracked as follow-ups in §10): any schema, RPC or RLS change; the semantics of `findDuplicates` or of
the legacy check in `leadsSupabaseApi.create`; `PhoneInput`; the disposition panel; DNC on quick calls;
`global_search`; the Edit-Lead reassignment defect; ReminderPopup placeholders; caller-ID `displayedFromNumber` churn.

---

## §4. Design

### 4.1 Phone classification and key (new pure module `src/lib/dialerPhoneKey.ts`)

This module has no Supabase import.

**Input normalization: `normalizePhoneText(s)`.** Used by the stored-side key and by the search-box phone-mode test.
1. Apply NFKC.
2. Strip `\p{Cf}` (bidi and format marks).
3. Map Unicode dashes (`‐ ‑ ‒ – — ― − ﹣ －`) to `-`.
4. Map any whitespace, including NBSP and tabs, to a space.
5. Drop a leading `tel:` label (case-insensitive).
6. Trim.

**Typed side: `classifyDialedNumber(dialString)`.** The input is `dialedNumber`, which `dialStringFromRaw` has already
reduced to `[\d*#+]`. In the table below, "national" means the 10-digit number and "NPA" is its area code.

| Kind | Rule | Lookup | Create Lead |
|---|---|---|---|
| `empty` | no characters | – | – |
| `incomplete` | Any of: fewer than 10 digits (no `+`); **10 digits starting with `1`** (a prefix of `1`+10); `+1` with fewer than 11 digits; `+` followed by another country code with fewer than 10 digits | – | – |
| `unsupported` | Any of: contains `*` or `#`; a misplaced or repeated `+`; `+0…`; more than 15 digits; 11 digits without `+` that do not start with `1`; 12 or more digits without `+` (including `00…` and `011…`); 10 digits starting with `0` | no (neutral line, §4.5) | – |
| `nanp` | 10 digits, `1`+10, or `+1`+10, with the national number's first digit `[2-9]` → `key = '1'+national`. Also carries `creatable` (next row) | **yes** | only if `creatable` |
| `nanp` + `creatable` | NPA `[2-9]XX`, not N11 (211…911); exchange `[2-9]XX` | yes | **yes** |
| `international` | `+` followed by 10–15 digits, not starting with `0` or `1` → `key = digits` | yes (positive outcomes only, §4.5) | no (D-4) |

Two consequences of this split:
- `555-123-4567` (exchange starts with 1) and fake test numbers are still **looked up**, so existing contacts stored
  with such numbers are found, but Create Lead is not offered for them.
- `0000000000`, the ReminderPopup placeholder, is `unsupported`.

**Stored side: `storedPhoneKey(value)`.**
- It runs on `normalizePhoneText(value)`.
- It returns a key only when the value is cleanly parseable:
  - The value may contain only digits, spaces, `( ) . -` and a single leading `+`.
  - A `+` value containing a `(0)` group returns `null` (trunk notation is ambiguous).
  - With `+`: 8–15 digits, and exactly 11 if the digits start with `1`. The key is the digits.
  - Without `+`: 10 digits give `'1'+d`, and 11 digits starting with `1` give `d`.
- Anything else returns `null`.
- Equality is `typed.key === storedPhoneKey(row.phone)`. This mirrors `private.phone_digits_e164ish`
  (`20260915035141:611-621`) and the dial target (`TwilioContext.toE164`, `:83-95`) for every accepted form.
- **It never uses last-10-digit equality**: `+44 20 7946 0958` ≠ `(207) 946-0958`.

**Near-match rule: `isPossibleMatch(value, cls)`, for rows whose `storedPhoneKey` is `null`.**
1. Split the normalized value on letters and on `/ , ; |`.
2. For each token:
   1. Take its digits.
   2. Strip a leading `011`, `001` or `00`.
   3. For `nanp`, also strip a leading `1` when more than 10 digits remain.
3. The row is **possible** only if some token's digits **start with** the typed national digits (`nanp`) or the typed
   key (`international`). An extension is always a suffix.
4. Every other row is dropped.

What this rule keeps and drops:
- **Kept:** `555-234-5678 x12`, `ext. 12`, `Home 555-234-5678`, `5552345678.0`, `001 555 234 5678`.
- **Dropped** (a scratch simulation of rev 0's looser rule marked all of these possible):
  - `555-234-5678 x9876` for a typed `555-234-9876`;
  - two-number rows such as `555-234-5678 / 555-987-6543`;
  - `Cell … Work …` rows;
  - `442079460958` for a typed `207-946-0958`.

**Candidate pattern: `candidatePattern(cls)`.**
- It places `%` around and between every digit: the 10-digit national number for `nanp`
  (`%5%5%5%2%3%4%5%6%7%8%`), or every key digit for `international`.
- **It is a superset:** every stored value that is exact or possible contains those digits in order.
- It contains only digits and `%`, so there is nothing to escape.

### 4.2 Scoped lookup (new `src/lib/dialerContactLookup.ts`)

`findVisibleContactsByPhone({ organizationId, cls, signal })` runs three list queries in parallel, one per table:

```ts
supabase.from(table)                       // leads | clients | recruits
  .select("id, first_name, last_name, phone")
  .eq("organization_id", organizationId)
  .ilike("phone", candidatePattern(cls))
  .limit(LIMIT + 1)                        // LIMIT = 10 → truncation is detectable
  .abortSignal(signal)
```

- **There is no `ORDER BY`.** In a local PostgreSQL 16 experiment under RLS, `ORDER BY id LIMIT` pushed the planner
  into a full primary-key walk. The measured timings are in §4.2.1.
- **No owner columns are selected.** Only rows that RLS already lets the user read are shown, and the lookup never says
  who owns them.
- **Each row is classified** using `storedPhoneKey` and `isPossibleMatch`:
  - **exact** — the row's key equals the typed key;
  - **possible** — the row passes the near-match rule;
  - dropped — any other row.
- **Names** are sanitized the way `resolve_inbound_contact` does it: `'undefined'` and `'null'` become `''`.
- **Type** is always the table's type, per R8.
- **An error fails the whole lookup; there are never partial results.**

| Condition | Result |
| --- | --- |
| `signal.aborted` (checked **first**). supabase-js 2.98 *resolves* an abort as `{data:null, status:0, error}`; it does not throw. | `aborted` |
| `42501`, or HTTP 403 | `denied` |
| HTTP 401, `PGRST301`/`PGRST303` (an expired JWT), or any other error, including `data:null` | `failed` (retryable) |
| Any table returns `LIMIT+1` rows | `truncated` |

#### 4.2.1 Why this backend (D-1)

No existing browser-callable path does an exact, visibility-scoped lookup:

| Existing path | Why it does not work here |
| --- | --- |
| `resolve_inbound_contact` | `service_role`-only, org-wide, last-10 matching |
| `global_search` | SECURITY DEFINER, org-wide, substring match, granted to `anon` |
| `resolve_inbound_caller_display_name` | Deprecated; works as a phone-to-name oracle |
| `search_contacts_*` | Substring match plus per-row call aggregates |

**A new SECURITY INVOKER RPC gains nothing.** It would see the same RLS rows and, as verified locally, get **the same
plan**:
- Under RLS, PostgreSQL will not use a non-leakproof qual as an index condition. `texticlike`, `textregexeq` and
  `phone_last10` all have `proleakproof = f`.
- Neither the trigram index nor the `(organization_id, phone_last10(phone))` expression index is usable, so both
  designs run an org-bounded scan.
- In the experiment, with 100k rows per org, that scan took about 100–250 ms per table. Real org sizes are expected to
  be far smaller.

The RPC would therefore add a migration and an approval for no performance gain. Only a SECURITY DEFINER function that
re-implements RLS could use the indexes, and this plan does **not** propose one. The experiment SQL is in the session
scratchpad.

#### 4.2.2 AGENT_RULES #30, "no frontend phone-probe resolvers"

That rule governs **inbound call-row identity**. This lookup is a user-facing outbound search:
- It never writes a `calls` row.
- Its only effects are the offer and a selection the agent can see.

**A ruling is requested: D-2.**

### 4.3 Lookup hook (new `src/hooks/useDialerPhoneLookup.ts`)

```ts
useDialerPhoneLookup({ dialString, active, organizationId, viewerId })
  → { cls, status, exact, possible, retry, invalidate }
status: 'idle'|'incomplete'|'unsupported'|'checking'|'none'|'match'|'multiple'|'possible'
      |'too_many'|'error'|'denied'
```

**Request key.**
- `requestKey` is `org|viewer|cls.key|nonce`.
- It is set only when `active` is true, `org` and `viewer` are present, and `cls.kind` is `nanp` or `international`.
  Otherwise it is `null`.

**No stale result can ever render.**
- The hook stores the committed result together with the `requestKey` it answered.
- **Whenever `requestKey` changes, including to `null`, the stored result is cleared during render**, using React's
  "store information from previous renders" pattern. So the sequence K → null → K always shows `checking` again and
  never the old answer, and the first frame for any new key is `checking`.
  This sequence happens after a selection, a call, closing the panel, switching tabs, or making an incomplete edit.
- `invalidate()` bumps `nonce`. It is called on every `created` outcome (§4.6) and on every
  `agentflow:contacts-changed` event (§4.11).
- `retry()` also bumps `nonce`; it backs the Retry button.

**Effect.**
- A 350 ms debounce, then a new `AbortController` and a generation bump, then the query.
- The result is committed only if the generation still matches and the hook is mounted.
- Cleanup clears the timer, aborts the request and bumps the generation.
- A superseded request commits nothing: no rows, no error, no loading flag.

**Status from result.**

| Result | Status |
| --- | --- |
| `truncated` | `too_many` |
| exactly 1 exact match and no possible matches | `match` |
| 2 or more exact matches, or exact plus possible | `multiple` |
| only possible matches | `possible` |
| no candidates | `none` |

**`active` means all of the following:**
- the panel is open on the Dial tab;
- **`selectedContact === null`** — any selection, including an unlinked pseudo-contact with `id:""`, suppresses the
  lookup until the user edits the number;
- the call is **not busy** (§4.7).

Rev 0 had a separate `userEntry` flag. It was redundant and has been removed.

**Coverage.** Because the key comes from `dialString`, the lookup runs for every way the number can change:
- the search box in phone mode;
- the manual input;
- the keypad;
- backspace;
- a paste into either input.

### 4.4 FloatingDialer wiring (modified; net growth budget ≤ +50 lines, pinned)

**Call guards move to a new hook, `src/components/layout/floating-dialer/useDialerCallGuard.ts`.** It owns:
- `callStarting` (state plus a synchronous ref), with `beginCallStart` and `endCallStart`;
- `busy` and `busyRef`, where `busyRef` is written every render;
- `selectionGenRef`.

**Selection generation is derived, not hand-maintained.** A `useLayoutEffect` keyed on
`[dialedNumber, searchTerm, selectedContact]` increments `selectionGenRef`. So **every** writer bumps it automatically:
- name-mode search;
- quick-call;
- a Recent-row click;
- clear, reset, a selection, the keypad and backspace.

This fixes rev 0's missed name-mode path, and no call site has to remember to bump it.

**Search-box phone mode.** `handleSearchChange` tests `PHONE_ENTRY_LIKE_RE` against `normalizePhoneText(val)`. Pasted
numbers with Unicode dashes, bidi marks or a `Tel:` prefix therefore enter phone mode.

**Keypad and backspace** compute the next value from the committed `dialedNumber`. They no longer call `setSearchTerm`
inside a `setDialedNumber` updater. Visible behaviour is unchanged, including that a key pressed after a selection
starts a fresh number.

**Typeahead (`doSearch`).**
- **One `closeTypeahead()` helper** clears `searchTimerRef`, bumps the typeahead sequence, `setShowDropdown(false)` and
  `setSearchResults([])`. It is called:
  - by all four entry handlers (including keypad and backspace) whenever the next value has **10 or more digits** in
    phone mode, i.e. classifies as `nanp`, `international`, `unsupported`, or a 10-digit `1…` prefix;
  - by quick-call, a Recent-row click, `handleSelectContact`, clear, reset, and the lookup and post-save selections.
- **The sequence is bumped on every input change**, so an in-flight partial response can never reopen the dropdown
  over the match row. Rev 0's claim that the dropdown "cannot cover" the row was wrong.
- **The ≥10-digit phone branch is deleted** (`:433-463`), along with `corePhoneDigitsForMatch` and `phonesMatch`.
  That removes the last-10 auto-select.
- The remaining name/partial typeahead gains:
  - `.eq("organization_id", organizationId)`, and it is skipped when the org is missing;
  - reading `error`: on failure the dropdown shows **"Search unavailable"**, never "No contacts";
  - "No contacts" only after a **successful** query.

**Selecting from the lookup (D-3).** `selectFromLookup(row, cls)` sets:
- `selectedContact = { id, first_name, last_name, phone: '+' + cls.key, type }` — **the number the agent entered,
  which the lookup matched**. The stored value is used for display only.
- `searchTerm` to the name;
- `closeTypeahead()`.

It **does not rewrite `dialedNumber`**. This prevents a "possible" row such as `555-234-5678 x12` from turning the dial
target into `+555234567812`.

The **unique exact match** (`match`) is applied through `selectFromLookup` by an effect. It runs only when:
- the lookup's `requestKey` is current;
- `selectedContact` is null;
- the call is not busy.

**Match row.** `DialerNumberMatchPanel` renders **directly under the manual number input row**, after `:1278` and
before the keypad grid.
- The Call buttons keep their current conditions: 10 or more digits and `canPlaceCall`.
- The only addition is `disabled` while `callStarting` (§4.7).

**Type badge.** A new `ContactTypeBadge` component replaces the two existing inline badge copies (`:1013-1018`,
`:1228-1233`). It is also added to the selected-contact card, but **only when `selectedContact.id` is non-empty**, so an
unlinked pseudo-contact is never labelled "Lead".

### 4.5 Match row UI (new `src/components/layout/floating-dialer/DialerNumberMatchPanel.tsx`, < 150 lines)

The row is Tailwind-only and compact (`text-[11px]`). It is **hidden while the call is busy**.

| Status | What the row shows |
| --- | --- |
| idle, incomplete, match | nothing (for `match`, the card shows the selected contact) |
| unsupported | muted "This number format can't be checked for contacts." (Call is unaffected) |
| checking | spinner and "Checking contacts…" |
| error | "Couldn't check contacts." with **Retry** |
| denied | "You don't have access to check contacts." |
| too_many | "Many similar numbers — search by name to pick one." |
| none, `nanp` + creatable, may create, no session | **"No matching contact found"** and **"+ Create Lead"**. Tooltip: "Only contacts you can access were checked." |
| none, `nanp` + creatable, create session already open | "No matching contact found" and a muted "Add Lead form is open" (no second session) |
| none, `nanp`, not creatable or no permission | "No matching contact found" |
| none, `international` | **nothing**. International numbers have no knowable "complete" length, so "none" is never shown for them |
| multiple, possible | "N matching contacts — pick one" or "Similar number on file — pick if it's the same person". **All** returned candidates are listed, up to 30, in a scrollable `max-h` list. Each row shows the name, the phone as stored and a type badge, and calls `selectFromLookup` |

### 4.6 Create Lead flow

**New files.**
- `src/components/layout/floating-dialer/useDialerLeadCreate.ts`: the hook.
- `DialerCreateLeadHost.tsx`: renders the modal and the confirm card.
- `DialerDuplicateConfirm.tsx`: the non-Radix confirm card.

**Availability (D-5).** Create Lead is offered only when all of these hold:
- `usePermissions()` has `!isLoading`, `!error`, `hasContactsPermission("contacts.leads.create")` and
  `hasPageAccess("Contacts")`. The hook returns the catalogue defaults while loading or on error, so this gate
  deliberately fails closed.
- the effective viewer (`useEffectiveViewer().viewer.viewerId`) and org are present;
- the number is `nanp` + creatable;
- the call is not busy;
- no create session is already open.

**Session.**
- `start()` is a **no-op while a session exists**.
- It records:
  - a `sessionId`;
  - `viewerKey` and org;
  - the prefill phone `'1'+national`, which is the `normalizePhoneNumber` storage format;
  - `originGen = selectionGenRef.current`;
  - `originKey`.
- **`sessionActive`** is derived during render. The session is active only while it exists and its `viewerKey` and org
  equal the current effective viewer and org.
- The modal and confirm card render **only when `sessionActive`**. If the viewer changes to null or another id, they
  are removed in the same commit (AGENT_RULES #31, "clear at render time"). Any pending confirm resolves `false`.

**Settings and assignee list.**
- Settings: `contactManagementSettingsSupabaseApi.getSettings(org)` loads with an explicit status: loading, ready or
  error. It is keyed by `viewerKey` and org, awaited at save time, and failures are **not cached**. This follows the
  `ContactDeepLinkPage` loader pattern.
- The assignee list loads **lazily**, only while the session is active (§4.8).

**Modal.** `DialerCreateLeadHost` renders
`<AddLeadModal key={sessionId} open createPrefill={{ phone }} …/>`. The edit-mode prop `initial` is **never** used.

Layering:
- It is a **fragment sibling of the panel**, like the caller-ID warning at `:788`.
- It keeps AddLeadModal's own `z-[200]`, so the panel (`z-[1000]`) stays **above** the backdrop and its Call, Answer,
  Decline and Hang Up remain clickable.
- The State and DOB popovers (`z-[300]`) stay above the card.
- Nesting the modal inside the panel would clip it: the panel's inline `transform` together with `overflow-hidden`
  would make the panel its containing block. Raising the modal above 1000 would cover the call controls.

**Panel overlap (D-13).** When a session opens while the call is idle and the panel's rectangle would intersect the
modal card, the host collapses the panel so it does not cover the form:
- widths ≥ 768 px: **minimize** the panel;
- narrower widths: **close** it.

It records the prior `open` and `minimized` values. When the session ends, it restores them **only if** the panel is
still in the collapsed state the host set. The panel is never moved or resized. An incoming call still opens the panel
through the existing effect. The rev 0 "un-minimize on call start" idea has been **dropped**, for two reasons:
- it was unnecessary, because the panel already sits above the backdrop;
- it could present a DialerPage call under the dialer's typed number.

**Duplicate confirmation.** A **non-Radix** inline card, fixed and centred at `z-[210]`, with **"Save anyway"** and
**"Back"**.
- A modal Radix Dialog would set `body{pointer-events:none}` and turn a click on Hang Up into a dismissal.
- The resolver lives in a ref. It resolves `false` **synchronously** if the host is unmounted, the session is closed or
  inactive, or the viewer or org changed. It is also settled `false` on each of those transitions.

**Save (`onSave` → `Promise<AddLeadSaveOutcome>`).** Every refusal keeps the form open with the typed values.
1. **A synchronous in-flight ref** makes a second submit a no-op. AddLeadModal also has its own guard (§4.10).
2. **Capture** `sessionId`, `originGen` and `originKey` into this pipeline's closure.
3. **Settings must be `ready`**, awaited through the loader. If they cannot load, refuse with a toast: "Couldn't load
   your agency's lead settings — try again." (D-7, fail closed).
4. **Check the final number.** `classifyDialedNumber(form.phone)` must be `nanp` + creatable; otherwise refuse with
   "Enter a complete US phone number." This also catches `PhoneInput` corruption such as `11555234567`.
5. **Recheck the final number (D-6)** with `findVisibleContactsByPhone`.
   - An error → refuse: "Couldn't confirm this number is new — try again." (fail **closed**).
   - Any visible exact or possible match, or a truncated result → refuse: "This number already matches Jane Doe
     (Client)" or "… N contacts". Then call `invalidate()` on the dialer lookup, so after the agent cancels, the
     dialer shows the existing contact(s).
   - **Stated deviation:** this refusal applies whatever the agency's `manual_action` (`allow`, `warn`) or rule
     (`email_only`) says. The reason is that Create Lead is offered only for an unmatched number, and a visible
     existing contact must be offered as existing rather than re-created. Agents can still create deliberate
     duplicates from Contacts under the agency policy. The policy itself then runs unchanged in step 6.
6. **Run `createLeadWithPolicy`** (§4.9) with:
   - `preSave`: the shared `evaluateContactPreSave`, using the loaded settings and the inline confirm, with toasts
     identical to Contacts;
   - **`isStillCurrent()`**, read through refs. It checks that the host is mounted, the session (by `sessionId`) is
     current and active, and the effective `viewerKey` and org are unchanged. `createLeadWithPolicy` calls it
     **after `preSave`, immediately before `leadsSupabaseApi.create`**, and again **before the campaign attach**.
     - If the pre-insert check fails, the result is `refused` with no write.
     - If the pre-attach check fails, the attach is skipped with a notice.

   `!isImpersonating` is also checked, as defence in depth. It cannot actually become true while the dialer is
   mounted, because AppLayout unmounts it in the same commit.
7. **Refused** → `{kind:'refused'}`.
   **Failed** → the error propagates and AddLeadModal toasts it and stays open. Failures include a thrown insert, and
   the legacy check's `block` throw from inside `leadsSupabaseApi.create`.
8. **Created**, carrying the **DB-returned `lead`**:
   - toast "Lead added";
   - `dispatchContactsChanged({type:'lead', id})`;
   - `lookup.invalidate()`;
   - close the session.

   Then **select the lead only if** all of these hold:
   - the host is still mounted and the session is still the captured `sessionId`;
   - the viewer and org are unchanged;
   - `!busyRef.current`;
   - `selectionGenRef.current === originGen` — the agent has not changed the number, the search or the selection
     since opening the form.

   The selection is `handleSelectContact({ id, first_name, last_name, phone: lead.phone, type:'lead' })`, a single
   batched write that costs one caller-ID LRU stamp, the same as today's selection. `lead.phone` is the clean
   normalized value the form stored.

   Otherwise nothing in the dialer changes, and the toast adds either "It wasn't selected because a call is in
   progress" or "…because the dialer changed". Once the dialer is idle and back on that number, the invalidated lookup
   finds the lead on its own. There is **no navigation and no `makeCall`**.

**Cancel and close.**
- The dialer's number, search and selection are untouched, because the modal never wrote them.
- While saving, Cancel (in `AddLeadFormFooter`), X and the backdrop are disabled (D-14). This stops a
  "cancel-then-created" race: today on Contacts a lead can still be created after the agent clicks Cancel.

### 4.7 Call-busy predicate and call-start guard (in `useDialerCallGuard`, D-12)

`busy = onCall || showDisposition || twilioCallState !== 'idle' || showCallerIdWarning || callStarting`

The 200 ms `ended`→`idle` tail counts as busy. `busyRef` is written every render and read at every async completion.

**Who owns `callStarting`.** Ownership is a single rule, so the flag cannot get stuck:
1. `initiateCall` first returns **without** taking ownership if `callStartingRef.current` is already set (so a
   double-click is a **no-op**) or if `leadPhone` is blank.
2. It then calls `beginCallStart()` and wraps the rest in `try/finally`. It **`await`s** `proceedWithCall`, where today
   the call is `void`.
3. The `finally` calls `endCallStart()`, **unless** ownership was handed to the caller-ID warning. That hand-off is
   marked by a local `handedToWarning` flag.
4. **Warning Cancel** calls `endCallStart()`.
5. **Call Anyway** does the following:
   - returns if `pendingCall` is no longer set, so a stale click cannot fire twice;
   - otherwise hides the warning and runs `try { await proceedWithCall(pendingCall…) } finally { endCallStart() }`.

   So `busy` stays true from the first click until `makeCall` settles.
6. Every exit path releases the flag: a blank phone, `!twilioIsReady`, `makeCall` returning `undefined`, and `makeCall`
   throwing. Tests pin each one.
7. The Call buttons are `disabled` while `callStarting`.

**What the Call buttons pass to `makeCall`.** No behaviour changes:
- **Card Call:** `initiateCall(selectedContact.phone, selectedContact.id || null)`.
- **Keypad Call:** `initiateCall(dialedNumber, null)`. The explicit `contactId` argument alone drives
  `getSmartCallerId` and the flagged-caller check.
- **`MakeCallOptions`** still come from the click-time `selectedContact`:
  - `contactId = explicitId || selectedContact?.id`;
  - `contactPhone = destinationNumber`;
  - `applyOutboundRingTimeout: false`;
  - no campaign fields.

**Optional hardening (D-12b, off unless chosen).**
- `pendingCall` would also carry the click-time contact snapshot, so Call Anyway builds `MakeCallOptions` from one
  source.
- The feature **does not depend on this**: `busy` includes `showCallerIdWarning` and `callStarting`, so the new
  automatic selections cannot run while the warning is open.

**Unchanged by this plan.**
- `TwilioContext.tsx` (no edits).
- The caller-ID selection and its final validation.
- Exactly one `calls` INSERT per call, with no duration write.
- Non-campaign quick calls.
- The disposition panel.

### 4.8 Assignment (D-10)

**Pure helper** in a new, client-free module `src/lib/leadAssignment.ts`:

`resolveAssignableLeadAgents({ viewerId, role, isEffectiveSuperAdmin, teamAgents, orgProfiles })`

| Viewer | Returned list |
| --- | --- |
| `!viewerId` | `[]` — keeps Contacts' guard |
| Team Leader | `teamAgents` |
| Admin / effective Super Admin | `orgProfiles` |
| anyone else | `[]` |

Contacts' `assignableAgentsForAddLead` memo delegates to this helper.

**New lazy hook `src/hooks/useAssignableLeadAgents.ts`.** It queries only while the create session is active.
- **Team Leader:** `rpc("get_contact_scope_agents")`, the same RPC `useContactScope` uses. It does not mount
  `useContactScope`, which reads and writes `user_preferences`.
- **Admin / Super Admin:** `profiles` with `.eq("organization_id", org).eq("status","Active")`.
- **Loading or error:** `[]`, so only "Myself" is offered — fail closed.

What stays the same:
- The default assignee is **self**.
- `validateAssignment` and the RLS WITH CHECK are unchanged.
- The campaign-attach picker appears only when assigning to another agent, as in Contacts. The quick call itself stays
  non-campaign.

### 4.9 Shared create orchestration (D-8, D-9)

**`evaluateContactPreSave`** is added to `src/lib/contactSavePolicy.ts`. It is pure orchestration, run in this order:
1. The organization check, which fails closed.
2. `computeMissingRequired` with `enforceCustomFields:false`, as Add does today.
3. `evaluateContactDuplicatePreSave`.

It returns `{ok:true}` or `{ok:false, message?}`, and asks for duplicate confirmation through an injected
`confirmDuplicate(label, description)`.

`Contacts.enforceContactPreSave` becomes a thin wrapper around it. Its messages, toast counts, order and Radix dialog
stay the same, and its update, client and recruit callers are unchanged.

**`createLeadWithPolicy`** is added in the new file `src/lib/leadCreatePolicy.ts`, extracted from `handleAddLead`. It
takes `isStillCurrent` as an optional parameter and does the following:
1. Applies the lead-source fallback.
2. Resolves the owner: the explicit assignee, else the effective viewer, else a refusal with the existing message.
3. Runs `preSave`.
4. Runs `isStillCurrent`.
5. Calls `leadsSupabaseApi.create`, with the payload shaped as today: `leadScore ?? 5`, `status || "New"`,
   `userId = owner`.
6. Runs `isStillCurrent` again.
7. Attaches the lead to a campaign if one was chosen, returning notices.

It returns `{kind:'created', lead, notices}` or `{kind:'refused', message?}`.

`Contacts.handleAddLead` calls it and returns `AddLeadSaveOutcome`. Its toasts, notice order and `fetchData()` are
unchanged. A **characterization test**, written first and passing on unmodified `main`, pins that contract.

**Effect on Contacts:** a refused Add now **keeps the modal open with the typed values** instead of closing. This is a
bug fix, and it is consistent with invariant #36.

**`AddLeadModal` contract.**
- `onSave: (...) => Promise<AddLeadSaveOutcome | void>`, where
  `AddLeadSaveOutcome = {kind:'created', leadId} | {kind:'refused'}`.
- The modal closes with `if (!outcome || outcome.kind === "created") onClose();`. It uses truthiness narrowing because
  `strict:false` does not narrow `void` out of the union through `=== undefined` (TS2339).
- A `void` result keeps the legacy close, so the Edit instance is unchanged.
- The create path never rejects with `ContactSaveRefusedError`, so #36's "boolean create contract" is kept as a typed
  result.
- `contactsViewAsFailClosed.test.tsx:552-573`, which awaits `handleAddLead` and expects it to resolve, still holds.

**D-19.** `<ConfirmDialogContent className="z-[210]">` at `Contacts.tsx:3522`. With this one line, the Contacts duplicate
prompt paints above the Add or Edit Lead, Add Client and Add Recruit modals that share it. The overlay stays at z-50.
A source pin asserts the class.

### 4.10 Form fixes (`useAddLeadModalForm`, `AddLeadModal`, `AddLeadFormFooter`)

**Reset trigger.** The form resets when the modal *becomes open*, **including the first render with `open=true`**. A
prev-open ref starts at `false` to detect this. It also resets when `initial` changes identity. It **no longer resets
when `leadSources` arrives**.

**Prefill.** `createPrefill.phone` is merged in at reset, in create mode only.
- It is read as a primitive string (through a ref), never as the object in effect deps.
- A parent re-render with a new `createPrefill` object therefore cannot reset the form.

**Lead source.** The reset default is marked "auto".
- When the org's sources arrive, an untouched auto default becomes `leadSources[0]`, as today.
- A value the user picked is kept if it is valid.

**Edit mode** stops reverting typed edits when sources load. This is the same bug as the create-mode wipe.

**`AddLeadModal` additions.**
- A synchronous `submittingRef` guard.
- X and the backdrop are disabled while `saving`.
- The `createPrefill` prop, ignored when `initial` is set.
- The outcome-based close.

`AddLeadFormFooter` disables Cancel while `saving`.

**Budget and compatibility.** `AddLeadModal` stays under 200 lines (173 today), and a pin checks this. The default
export and prop names are unchanged. The Contacts create instance still omits `initial`.

### 4.11 Contacts refresh

The new file `src/lib/contactsChangedEvent.ts` follows the typed `quick-call.ts` pattern:

```ts
CONTACTS_CHANGED_EVENT = "agentflow:contacts-changed"
dispatchContactsChanged({ type, id })
onContactsChanged(handler)
```

**`Contacts.tsx`.** An effect keyed on `[fetchData, fetchKanban, view, tab, isImpersonating]` subscribes to the event.
It returns early while impersonating or when `tab !== "Leads"`. Otherwise it calls:
- `fetchData({ silent: true })`;
- `fetchKanban({ silent: true })`, when `view === "kanban"`.

**`useDialerPhoneLookup`** also subscribes and calls `invalidate()`.

No other surface listens. The Dashboard keeps its "no automatic refresh" rule.

---

## §5. Exact files to touch

**New (application).**

| File | Purpose |
| --- | --- |
| `src/lib/dialerPhoneKey.ts` | Pure: normalize, classify, stored key, near-match, pattern |
| `src/lib/dialerContactLookup.ts` | The scoped three-table lookup |
| `src/lib/leadAssignment.ts` | Pure `resolveAssignableLeadAgents` |
| `src/lib/leadCreatePolicy.ts` | `createLeadWithPolicy` |
| `src/lib/contactsChangedEvent.ts` | The typed event |
| `src/hooks/useDialerPhoneLookup.ts` | The lookup hook |
| `src/hooks/useAssignableLeadAgents.ts` | The lazy assignee-list hook |
| `src/components/layout/floating-dialer/useDialerCallGuard.ts` | `busy`, `callStarting`, `selectionGenRef` |
| `src/components/layout/floating-dialer/useDialerLeadCreate.ts` | Session, settings, save pipeline and guards |
| `src/components/layout/floating-dialer/DialerNumberMatchPanel.tsx` | The match row |
| `src/components/layout/floating-dialer/DialerCreateLeadHost.tsx` | Hosts AddLeadModal and the confirm card; handles panel collapse and restore |
| `src/components/layout/floating-dialer/DialerDuplicateConfirm.tsx` | The inline non-Radix confirm |
| `src/components/shared/ContactTypeBadge.tsx` | The shared type badge |

**Modified (application).**

| File | Change |
| --- | --- |
| `src/components/layout/FloatingDialer.tsx` | Wiring, typeahead fixes, `selectFromLookup`, call-start ownership, badge reuse. **Net ≤ +50 lines**, pinned |
| `src/components/contacts/AddLeadModal.tsx` | Outcome contract, `createPrefill`, submit guard, close disabled while saving; stays under 200 lines |
| `src/components/contacts/AddLeadFormFooter.tsx` | Cancel disabled while saving |
| `src/components/contacts/useAddLeadModalForm.ts` | Reset trigger, prefill merge, lead-source default |
| `src/lib/contactSavePolicy.ts` | Adds `evaluateContactPreSave` |
| `src/pages/Contacts.tsx` | `enforceContactPreSave` delegates; `handleAddLead` uses `createLeadWithPolicy` and returns an outcome; the memo uses `resolveAssignableLeadAgents`; contacts-changed listener; D-19 one line |

**New tests.** Every suite mocks `@/integrations/supabase/client`, and `@/hooks/usePermissions` where needed, following
`contactsViewAsFailClosed.test.tsx:62-130`. None may join the "supabaseUrl is required" failure set.

| Test file | What it covers |
| --- | --- |
| `src/lib/__tests__/dialerPhoneKey.test.ts` | Table-driven: normalize, classify, stored key, near-match, pattern superset |
| `src/lib/__tests__/dialerContactLookup.test.ts` | The query shape; exact, possible and dropped rows; the abort, denied, failed and truncated shapes |
| `src/hooks/__tests__/useDialerPhoneLookup.test.tsx` | Debounce; `checking` on every key change, including K→null→K; stale results; `invalidate`; unmount |
| `src/hooks/__tests__/useAssignableLeadAgents.test.tsx` | Per-role queries; lazy loading; fail-closed; no `user_preferences` |
| `src/lib/__tests__/leadAssignment.test.ts` | A parity table against the current Contacts memo, including a null viewer with role Admin |
| `src/lib/__tests__/leadCreatePolicy.test.ts` | Owner; order; DB row; notices; `isStillCurrent` before the insert and before the attach |
| `src/lib/__tests__/contactPreSaveOrchestration.test.ts` | `evaluateContactPreSave` parity |
| `src/components/contacts/__tests__/addLeadModalCreatePrefill.test.tsx` | Mount with `open` plus a prefill; a new prefill identity keeps values; late sources keep values; `initial` = edit; refused keeps the form open; `void` closes; double submit; close disabled while saving |
| `src/components/layout/__tests__/floatingDialerCreateLead.test.tsx` | The real FloatingDialer: the §7 scenario rows |
| `src/pages/__tests__/contactsAddLeadOutcome.test.tsx` | Characterization first, then outcome, refusal and listener |
| `src/contexts/__tests__/twilioManualCallIdentity.test.tsx` | The real TwilioProvider (§7) |
| `src/lib/__tests__/floatingDialerCreateLeadPinned.test.ts` | Source pins: line budgets, no `service_role`, old probe gone, the D-19 class, existing pins intact |

**Docs, in the same commit as the code (AGENT_RULES §9).**
- `WORK_LOG.md`: a newest-first entry.
- `AGENT_RULES.md`: see D-18.
- The root `implementation_plan.md`: the §18 pointer status.
- This plan: an as-built appendix.

**Not touched.**
- `TwilioContext.tsx`, `dialer-api.ts`, `supabase-contacts.ts`, `contactDuplicateDetection.ts`, `PhoneInput.tsx`.
- Anything under `supabase/`, and any Edge Function.

---

## §6. Decisions for Chris (recommendation first)

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Lookup backend | **Browser: RLS- and org-scoped per-table list queries, no migration.** Alternative: a SECURITY INVOKER RPC. It needs a migration and an approval, and it produces the *same* query plan (§4.2.1). |
| D-2 | AGENT_RULES #30, "no frontend phone-probe resolvers" | Rule that #30 covers inbound call-row identity only. The outbound dialer search is allowed: it never writes `calls` identity, and its only selections are ones the agent can see. |
| D-3 | One exact visible match | **Auto-select, as today**, with guards, and with the dial target kept as the typed number. Alternative: show "Existing Lead · Jane Doe · Select", which costs one extra click. |
| D-4 | International (`+44…`) | Run the lookup and show only positive outcomes. **No Create Lead**, because the Add Lead phone field is US-only (10 digits). |
| D-5 | Who sees Create Lead | Users with `contacts.leads.create` **and** Contacts page access, with permissions loaded and error-free (fail closed). |
| D-6 | Final recheck | **Fail closed** on a lookup error. **Refuse on any visible exact or possible match in all three tables, regardless of `manual_action` or rule** (the deviation is stated in §4.6 step 5). Alternative: on a match, return to the dialer and let only the agency policy decide. |
| D-7 | Settings load failure | **Fail closed** (refuse with a retry toast). Contacts keeps its current behaviour. |
| D-8 | Refusal contract | A resolved `{kind}` result. The modal closes only on `created` or on legacy `void`. Contacts adopts it, so a refused Add keeps the form open there too. |
| D-9 | One implementation | Extract `evaluateContactPreSave` and `createLeadWithPolicy`, shared by Contacts and the dialer. |
| D-10 | Assignment from the dialer | Parity with Contacts: a lazy list, defaulting to self. Alternative: self only. |
| D-11 | Save finishes during a call | Never select. Toast, refresh and invalidate; the post-call lookup finds the lead. |
| D-12 | Call-start guard | **Yes**: ownership rule, double-click no-op, and the Call Anyway guard. **D-12b** (Call Anyway identity snapshot): optional, off by default. |
| D-13 | Panel and modal overlap | On session open while idle, **minimize** the panel (close it below 768 px) if it overlaps the form, and restore it afterwards. Alternative: leave it; the agent drags or minimizes it manually. |
| D-14 | Closing during a save | Disable Cancel, X and the backdrop while saving, on both hosts. |
| D-15 | Required custom fields on Add | Keep parity (`enforceCustomFields:false`). Correct the AGENT_RULES "Required-field enforcement" row, which claims Add enforces them. |
| D-16 | DNC on quick calls | None exists today. **Do not add it** under this task; it is a separate decision. |
| D-17 | Name/partial typeahead | Stays leads-only. Add the org filter; never show "No contacts" on an error or for a number of 10 or more digits. |
| D-18 | AGENT_RULES updates (same commit) | (a) #36: the create `{kind}` contract. (b) A new invariant for the dialer lookup: strict key, no last-10, RLS plus org, errors are not absence, the stale-result rule, the recheck deviation. (c) A **Known Tech Debt** note, *not* a rewrite of #22 or #34, that the floating-dialer disposition panel is unreachable; #22's dual-source "not dead data" rule stays. (d) The D-15 row correction. |
| D-19 | Contacts duplicate prompt hidden under the modal | **Fix it**: one line, `z-[210]` on `ConfirmDialogContent`. |

---

## §7. Verification plan

**Automated tests: local, mocked, no live services.** Each defect-pinning suite is run **fail-first** against the
unmodified source, then against the change. The Contacts characterization block must pass on `main` *before* any edit.

| Scenario | Suite |
|---|---|
| New number → create → the returned lead is selected; `navigate` not called; `makeCall` not called; the contacts-changed event fires | integration |
| Cancel keeps the number; a failed or refused save keeps the form and its values | modal, integration |
| An existing lead, client or recruit is shown with its type; multiple matches → a list and no auto-select; a possible row → a list, and picking it dials the **typed** number | lookup, integration |
| Formatted, `+1`, punctuated and Unicode-dash variants; international numbers are not equated by the last 10 digits; `555-123-4567` is looked up but not creatable; `0000000000` is unsupported | pure |
| Typing, a paste (including en-dash, bidi and `Tel:`), the keypad and backspace each trigger the lookup; a stale partial typeahead dropdown closes and never covers the row | integration |
| A stale result is discarded on A→B, K→null→K, an org or viewer change, a selection, or a call-state change; a result arriving after unmount is dropped | hook, integration |
| Missing permission, permissions still loading, or a permissions error → no offer | integration |
| A double submit → one create; a second Create Lead click while a session is open → no new session | modal, integration |
| A save while `dialing` or `active` does not change the selection; after the call, the lookup shows `checking` and then the lead, **never** "No matching contact found" | integration |
| An unmount or a viewer change during a deferred `findDuplicates` → no `leads` insert and no attach; deleting `isStillCurrent` makes this test fail | policy, integration |
| A default submit assigns to the effective viewer (mocked different from `useAuth().user`); the assignee list per role, fail-closed | hook, integration |
| Call-start: a double-click → one `makeCall`; a blank-phone Recent row, then a valid Call, works; `makeCall` returning `undefined` or throwing releases the flag; Call Anyway keeps `busy` until settled; warning Cancel releases the flag | integration |
| After the post-save select, **both** the card Call and the keypad Call → `makeCall` **once** with `{contactId:<DB id>, contactName, contactPhone, contactType:'lead', applyOutboundRingTimeout:false}` and no campaign keys | integration |
| Real `TwilioProvider` | provider |
| Contacts: outcome, refusal kept open, listener only on the Leads tab and not while impersonating | page |
| Source pins | pin |

**Provider test in detail.** It copies the `teamOpenRevealIntegration` harness: a session with
`app_metadata.organization_id`, an allowed Agency `phone_numbers` row, and `maybeSingle` returning an id. It is
extended with a builder that records insert and update payloads per table, and it adds
`findTwilioRemoteAudioElement: vi.fn(() => null)`, so the new suite does not inherit the harness's unhandled rejection.
With a UUID lead, it asserts:
- exactly one `calls` insert, with `contact_id`, `contact_type:'lead'`, `contact_name`, `contact_phone`,
  `direction:'outbound'` and `campaign_id: null, campaign_lead_id: null`, and **no `duration` key**;
- `twilioMakeCall` called once;
- after the fake call disconnects:
  - one `calls` update on that row, with `status:'completed'` and `ended_at` and no `duration`;
  - **one `call_logs` insert with `lead_id` equal to the saved lead's UUID** and `direction:'outbound'`.

**Source pins.**
- New components and hooks are under 200 lines.
- FloatingDialer's net growth is ≤ +50 lines, and AddLeadModal is under 200 lines.
- No new file contains `service_role`.
- The leads-only `%probe%` query is gone, and the typeahead query carries an org filter.
- The Contacts `ConfirmDialogContent` has a z-index class above 200.

**Existing suites that must stay green.**
- `outboundPathPinned`, `inboundBrowserLifecycleWrites` (6 `calls` mutation sites, no duration), `twilioVoiceLifecycle`,
  `voiceStatusConvergence`, `twilioStatusDuration`, `twilioStatusTerminalGuard`, `twilioProviderLifecycle`,
  `teamOpenRevealIntegration`.
- `floatingDialerRecent`, `inboundDeviceLifetime`, `viewAsRouteAllowlist`, `quickCall`, `dialerRecentCalls`.
- `contactsViewAsFailClosed`, `contactsFullScreenDuplicateParity`, `contactsFullScreenSaveIntegrity`,
  `contactDeepLinkDuplicateParity`, `contactSavePolicy`.

**Status updates, history and logs.** These are covered by the provider test above. History (the Recent tab) resolves
by `contact_id` and `contact_type`, so it shows the new lead by id; the `dialerRecentCalls` suite covers this.
Disposition is documented as unreachable today (§2.5) and is unchanged.

**Commands.**
1. Run the new suites, then the must-stay-green suites.
2. Run the full `npx vitest run`. Expect 3,516 + N passed; the same 12 failing files; 1 failed test (v29); the one
   existing unhandled rejection; and **no new failing file**.
3. Run `npx tsc -p tsconfig.app.json --noEmit`, normalize the error list and diff it against the baseline. The result
   must be **90 errors and an empty diff**. `npx tsc --noEmit` is reported but is not counted as a check, because it
   checks nothing.
4. Run `npx eslint` on the new and changed files, with no new problems. `npx eslint .` must stay ≤ 212.
5. Run `npm run build` and `git diff --check`.
6. **Mutation controls.** On a scratch copy, revert each fix and confirm that its test fails. Restore by sha256.

**Manual browser checklist.** jsdom cannot see z-order. This runs locally or is done by Chris, with **no live calls**:
- widths 1440, 1024×768 and 390×844;
- the panel collapses when the form opens and is restored afterwards;
- every field, X, Cancel and Add Lead are reachable;
- the State and DOB popovers appear above the card;
- the inline duplicate confirm is clickable;
- a simulated incoming ring while the form is open opens the panel;
- the Contacts Add Lead duplicate "warn" prompt is visible, Save Anyway creates exactly one lead, and Cancel keeps the
  form.

The local Team/Open Playwright harness (Docker, local Supabase, fake Voice.js) is used only if it is available in the
container.

**Handoff.** The final response and the as-built appendix end with a **context snapshot**:
- changes and decisions as ruled;
- files touched;
- verification numbers against the baseline;
- migrations and deploys (none);
- blockers;
- next steps (§10).

---

## §8. Explicit non-actions

- No migration, RPC, RLS, grant or Edge Function change.
- No Supabase MCP call, whether read or write.
- No Vercel action, deploy, merge or push to `main`.
- No production test calls.
- No edits to `TwilioContext.tsx`, `dialer-api.ts`, `supabase-contacts.ts`, `contactDuplicateDetection.ts` or
  `PhoneInput.tsx`.
- No change to the duplicate-policy semantics, caller-ID selection, DNC behaviour, the disposition panel, or the
  quick-call event contract.

---

## §9. Risks, limitations and rollback

**Concurrent creates.**
- **The race.** Looking up and then inserting is check-then-act, and `leads.phone` has no uniqueness constraint. Two
  agents, two tabs, or an agent racing an inbound auto-create can all create the same number. The inbound auto-create
  takes a per-(org, last10) advisory lock that the browser cannot take. The final recheck narrows this window but
  cannot close it.
- **Invisible duplicates.** An Agent can create a lead for a number that another agent's record already holds, because
  RLS hides it. Contacts Add Lead has the same behaviour today.
- **The consequence.** Either kind of duplicate makes future inbound calls from that number resolve as `ambiguous`,
  i.e. unlinked.
- **Closing the gap** needs a server-side create RPC (an advisory lock plus an org-wide existence check) and a decision
  about disclosing existence. That is a follow-up requiring approval.

**Residual write window.** `leadsSupabaseApi.create` still makes two awaited reads, the settings and the legacy check,
between `isStillCurrent()` and its INSERT. Closing that needs an edit to `supabase-contacts.ts`, which is out of scope.

**Performance.**
- Each lookup for a complete number runs three org-bounded scans. RLS prevents index use for either option (§4.2.1).
  Each scan returns at most 11 rows.
- The lookup runs once per number after the 350 ms debounce and is aborted if superseded.
- The recheck at save time costs one more lookup.

**Dialer-specific recheck rules.** The dialer is **stricter than the agency duplicate settings** for visible phone
matches (D-6). A near-match (an unparseable stored value beginning with the typed number) suppresses Create Lead. That
errs on the conservative side.

**Unchanged duplicate-policy gaps.**
- Matching is digits-exact.
- Only the saved type's table is checked.
- The check is RLS-limited and fails open.
- It reads the whole visible table at save time.
- `leadsSupabaseApi.create` still carries its legacy check.

The dialer's own recheck covers US variants and all three tables, among visible rows.

**Intended Contacts changes.**
- A refused Add keeps the form open (D-8).
- Close is disabled while saving (D-14).
- The duplicate prompt is visible (D-19).

**Rollback.** Revert the branch commits. There is no data, schema or configuration to undo.

---

## §10. Follow-ups discovered (not in this plan; each needs its own approval)

1. **Server-side lead-create RPC**: an advisory lock plus an org-wide existence check, with a decision on how existence
   is disclosed.
2. **Bound `findDuplicates`**: add a server-side digit prefilter while keeping the same digits-exact semantics.
3. **Legacy duplicate check in `leadsSupabaseApi.create`** has several problems:
   - the `.or()` filter is not escaped;
   - it has no org filter;
   - it ignores the multi-row error;
   - `email.eq.` matches blank emails.
4. **Security review of `global_search`.** It is SECURITY DEFINER, org-wide and granted to `anon`. The docs describe
   it as `auth.uid()`-scoped, which is wrong.
5. **`PhoneInput` keeps the first 10 digits**, which corrupts pasted `+1` numbers.
6. **Editing a lead through `AddLeadModal` reassigns it to the editor.** The Edit wrapper's catch-and-return also
   closes the modal, despite its comment.
7. **The floating-dialer disposition panel is unreachable.** Decide whether to revive it (with a snapshot identity and
   the `currentCallId` fix) or delete it.
8. **Pseudo-identities**: the ReminderPopup `'0000000000'` placeholder and the CampaignDetail `campaign_leads.id`
   fallback.
9. **The quick-call listener has no `onCall` guard.** Also, a `fromNumber` in the event becomes the persisted caller
   ID.
10. **`displayedFromNumber`'s effect stamps the caller-ID LRU on every keystroke.** Its result is never rendered.
11. **Answer and Decline are hidden while the panel is minimized**, because the incoming effect does not un-minimize
    the panel.
12. **Contacts `fetchData` has no generation guard** for its grids.
13. **Consider a server-side check of `contacts.leads.create` on INSERT.** Today it is enforced only in the UI.

---

## §11. Plan history

- **rev 0** (2026-09-29): first draft. Committed as `b9b16ee` and pushed to the feature branch only, not to `main`.
- **rev 1** (2026-09-29): folds in the adversarial review of rev 0 (§12).

---

## §12. Adversarial review of rev 0 (2026-09-29)

**How the review ran.** Seven reviewers each took one lens:
- security and scope;
- telephony;
- React races;
- requirement compliance;
- phone-key correctness, with node simulations;
- Contacts regression;
- scope and executability.

Each reviewer's findings then went to an independent skeptic who tried to refute them against the code.

**Totals.** 45 findings: 41 upheld (fully or partly) and 4 refuted.

**What changed in rev 1:**
- **Stale same-key replay.** A K→null→K sequence re-showed an old "none" result, for example after a call. It was
  found by three reviewers. The stored result is now cleared on every key change, and the lookup is invalidated after
  a create or a contacts-changed event. (§4.3)
- **Dropdown overlap.** The typeahead dropdown can cover the match row, and a late partial response can reopen it.
  Rev 1 adds `closeTypeahead` and bumps the sequence on every input. (§4.4)
- **NANP rule too strict.** Rev 0's rule rejected its own examples, such as `555-123-4567`. Lookup eligibility is now
  split from create eligibility. (§4.1)
- **Possible rows misdialled.** Selecting a possible row could dial the stored garbage value. Every lookup selection
  now dials the typed number. (§4.4)
- **Possible tier too broad.** It matched rows with extensions or several numbers. It is now a token-prefix rule. (§4.1)
- **`callStarting` could stick**, and the Call Anyway path was unguarded. Replaced by the ownership rule, with tests.
  (§4.7)
- **Create re-entry.** A second Create Lead could start while a session was open. `start()` is now a no-op, and the
  modal is keyed by session. (§4.6)
- **Fire-time checks.** They ran before the insert rather than at it. `isStillCurrent` now runs before the insert and
  before the attach, and the session is cleared at render time. (§4.6, §4.9)
- **Name-mode generation bump missed.** The generation is now derived from state. (§4.4)
- **International numbers.** A "none" result on a partial international number is no longer shown. (§4.5)
- **Unicode input.** Stored-value and search-box paste normalization added. (§4.1, §4.4)
- **Assignment tests** added, and the `viewerId` guard is kept. (§4.8)
- **Provider test.** Now copies the working harness and asserts the status update and `call_logs`. (§7)
- **Contacts duplicate prompt** was hidden under the modal. Fixed with a z-index class (D-19).
- **The recheck's deviation from the agency duplicate settings** is now stated explicitly (D-6).
- **D-13 un-minimize-on-call dropped.** Replaced by collapsing the panel when it overlaps the form.
- **Snapshot hardening** made optional (D-12b).
- **FloatingDialer growth budget** added, plus `useDialerCallGuard` and `ContactTypeBadge`.
- **Reset-on-mount and prefill identity** specified. (§4.10)
- **Abort shape and 401 mapping** corrected. (§4.2)
- **Context snapshot and same-commit docs** added. (§5, §7)
- **D-18(c) moved to Known Tech Debt.**

**Refuted, and why:**
- **Contacts listener stale closure:** a normal dependency-keyed effect is correct.
- **The recheck should honour `manual_action`:** the stricter recheck is the feature's premise; it is now disclosed
  as D-6 instead.
- **D-14 should not disable close:** today's live Cancel allows a cancel-then-create race.
- **Supabase env trap in the tests:** the "same 12 failing files" acceptance check already catches it. Mocking is now
  stated explicitly anyway.
