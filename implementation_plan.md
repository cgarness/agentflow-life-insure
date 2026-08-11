# Implementation Plan — `calls.contact_name = "undefined undefined"` from the non-campaign contact quick-call path

**Status:** **APPROVED BY CHRIS 2026-08-11 — F1–F5 + R1 + R2 only. R3 and R4 are explicitly EXCLUDED. No production data repair, no backfill of existing `"undefined undefined"` rows, no migration, no deploy, no Supabase mutation.**
**Date:** 2026-08-11
**Branch:** `claude/agentflow-contact-name-fix-46abvk` (cut from `main` = `ef2ff8a`, PR #352 merged)
**Type:** Frontend only — contact-model boundary repair + one defensive write guard + regression tests.
**Migrations / Edge deploys / RLS / production writes:** **NONE.**

---

## 1. Confirmed root cause (verified by direct read, not assumed)

The reported chain is correct, and I confirmed every link at the exact source line:

| # | File:line | Evidence |
|---|-----------|----------|
| 1 | `src/pages/ContactDeepLinkPage.tsx:45-50` | `.from(table).select("*")…maybeSingle()` — returns the **raw database row** (`first_name`, `last_name`, `assigned_agent_id`, `lead_source`, …). |
| 2 | `src/pages/ContactDeepLinkPage.tsx:129-136` | That raw row is passed **unmapped** as `contact` to `FullScreenContactView`. |
| 3 | `src/components/contacts/FullScreenContactView.tsx:914-922` | The Call button hand-builds a `quick-call` `CustomEvent` with ``name: `${contact.firstName} ${contact.lastName}` `` → **`"undefined undefined"`** for a raw row. |
| 4 | `src/components/layout/FloatingDialer.tsx:258-277` | Listener splits `detail.name` on `" "` → `first_name = "undefined"`, `last_name = "undefined"`. |
| 5 | `src/components/layout/FloatingDialer.tsx:625` | ``contactName: selectedContact ? `${selectedContact.first_name} ${selectedContact.last_name}` : null`` — recombines the placeholder. |
| 6 | `src/contexts/TwilioContext.tsx:2187` | `contact_name: opts?.contactName \|\| null` — snapshots the literal string into `calls.contact_name`. |

**The Twilio path is healthy.** Steps 4–6 faithfully transport whatever step 3 hands them; the defect is entirely the step 1→3 model-shape mismatch. Nothing in the single-leg `device.connect()` architecture is implicated.

### Blast radius is wider than the call name (same single root cause)

Because `FullScreenContactView` reads **camelCase throughout**, a deep-linked contact currently also mis-renders/mis-behaves:

- `FullScreenContactView.tsx:974,976,1554` — avatar initials and the header/delete-dialog name render blank.
- `FullScreenContactView.tsx:1636` — `prefillContactName` sends **`"undefined undefined"`** into `AppointmentModal`, which `:1618` writes to **`appointments.contact_name`**. A second wrong-name *write*, from the same cause.
- `FullScreenContactView.tsx:643-645` — Save validates `editForm.firstName/lastName/phone`, all `undefined` on a raw row ⇒ **editing a deep-linked contact always fails** with "First name is required".
- `FullScreenContactView.tsx:313,558` — `contact.assignedAgentId` is `undefined` on a raw row, so the assigned-agent lookup never runs.

Fixing the boundary (step 1→2) repairs all of these at once. That is why the recommended fix is the mapping, not a string patch at the Call button.

### A second, independent instance of the identical defect

`src/pages/CalendarPage.tsx:371-381` fetches `leads` with `select('*')` and stores it as `setContactModalLead(data as unknown as Lead)` — a **cast that is not true** — then renders `FullScreenContactView` at `:748-751`. Opening a contact from the Calendar and clicking **Call** produces the same `"undefined undefined"`. This is the same bug, one file over, and I am proposing the same one-line canonical-mapper fix (§4, item R1).

### Two adjacent contract defects found while tracing (listed, not silently fixed)

- `src/pages/Contacts.tsx:2484` and `:2608` dispatch a raw `quick-call` event with **no `type`**. `FloatingDialer` defaults to `"lead"` — so **the Recruits Kanban call button labels every recruit call as a lead** in `calls.contact_type`. Names are correct on this path (canonical objects); only the type is wrong.
- `src/pages/CampaignDetail.tsx:680` dispatches a raw event with no `type` (defaulting to `"lead"` is *correct* for campaign leads, but implicit).
- `src/components/layout/ReminderPopup.tsx:172,184` dispatches raw events, including a **`"0000000000"` placeholder phone** on the error branch. Out of scope — flagged only.

---

## 2. Existing canonical mapping I intend to reuse (no new contact shape)

Inspected as instructed; all three already exist and are the canonical row→domain mappers:

| Mapper | File | Exported today? |
|--------|------|-----------------|
| `rowToLead(row): Lead` | `src/lib/supabase-contacts.ts:385` | ✅ exported |
| `rowToClient(row): Client` | `src/lib/supabase-clients.ts:201` | ✅ exported |
| `rowToRecruit(row): Recruit` | `src/lib/supabase-recruits.ts:186` | ❌ **module-private** — needs `export` added (one keyword) |

**No competing contact shape will be invented.** `ContactDeepLinkPage` will keep its own org-scoped `select("*")` query (it is defence-in-depth on top of RLS, per AGENT_RULES §3, and `clientsSupabaseApi.getById` / `recruitsSupabaseApi.getById` do **not** carry the explicit `organization_id` filter) and will pipe the returned row through the mapper above. `.maybeSingle()` is already used and stays.

---

## 3. Design decisions

**D1 — Fix the identity before `makeCall`, not inside it.** The primary repair is the mapping at `ContactDeepLinkPage`. No database lookup is added to the dial path. `TwilioContext.makeCall` gains exactly **one pure, synchronous string call** — no query, no await, no measurable cost on the 300+ dials/day path.

**D2 — Defensive sanitisation at the write is appropriate, and narrow.** `calls.contact_name` is a *snapshot*, so a bad value is permanent. The guard rejects only strings that are provably placeholder debris; it never rewrites a real name.

**D3 — Placeholder matching is case-sensitive on purpose.** Only the exact lowercase tokens `undefined` and `null` are dropped — those are what a JS template literal emits. `"Null"` is a real surname; capitalised forms are preserved untouched.

**D4 — Per-token, not whole-string.** `"Charlotte undefined"` → `"Charlotte"` (keeps the real half) rather than being discarded entirely. `"undefined undefined"`, `"null null"`, `""`, `"   "` → `""` → written as **`NULL`**, never a literal.

**D5 — A missing name must never block a dial.** If a name cannot be resolved, the quick-call still dispatches with `name: ""`; `FloatingDialer` already falls back to the phone number for display, and `calls.contact_name` is `NULL`. Velocity is preserved (VISION §2/§3).

**D6 — `dispatchQuickCall` replaces the hand-rolled event** in `FullScreenContactView`, and its `false` return (undialable phone) is surfaced as a toast instead of a silent no-op. All five fields are preserved: `contactId`, `type`, `phone`, optional `fromNumber`, `name`.

---

## 4. Every file I intend to touch

### Required — the fix

| # | File | Change | Size |
|---|------|--------|------|
| **F1** | `src/lib/contact-name.ts` **(NEW)** | Pure, dependency-free module: `sanitizeContactName(raw: unknown): string` and `contactDisplayName(contact: unknown): string` (camelCase first, snake_case fallback, sanitised). No React, no Supabase — matches the `twilio-voice-status/duration.ts` "pure helper + unit test" precedent. | ~35 lines |
| **F2** | `src/pages/ContactDeepLinkPage.tsx` | Map the fetched row through `rowToLead` / `rowToClient` / `rowToRecruit` in **both** `fetchContact` and `handleUpdate`. Query, org scope, `.maybeSingle()`, not-found handling all unchanged. | ~10 lines |
| **F3** | `src/lib/supabase-recruits.ts` | Add `export` to `rowToRecruit`. Body untouched. | 1 word |
| **F4** | `src/components/contacts/FullScreenContactView.tsx` | (a) Call button → `dispatchQuickCall({ contactId, name: contactDisplayName(contact), phone, type, fromNumber })` + error toast on `false`; (b) `prefillContactName` → `contactDisplayName(contact)`. `logActivity` ordering unchanged. | ~15 lines |
| **F5** | `src/contexts/TwilioContext.tsx` | Line 2187 only: `contact_name: sanitizeContactName(opts?.contactName) \|\| null`. **Nothing else in the file changes.** | 1 line + import |

### Approved — same defect class, surgical

| # | File | Change | Rationale |
|---|------|--------|-----------|
| **R1** | `src/pages/CalendarPage.tsx:381` | `setContactModalLead(rowToLead(data))` replacing the untrue `as unknown as Lead` cast. | Confirmed second instance of the *identical* bug (§1). |
| **R2** | `src/pages/Contacts.tsx:2484,2608` | Convert both Kanban `onCall` handlers to `dispatchQuickCall` with an explicit `type: "lead"` / `type: "recruit"`. | Fixes recruit calls being written as `contact_type = 'lead'`. |

### DECLINED by Chris — must NOT be implemented

| # | File | Why excluded |
|---|------|--------------|
| **R3** | `src/pages/CampaignDetail.tsx:680` | Out of approved scope. The raw `CustomEvent` and its implicit `"lead"` default stay exactly as they are. |
| **R4** | `src/pages/ContactDeepLinkPage.tsx:70-85` | Out of approved scope. `handleUpdate`'s existing refetch-then-save ordering is preserved verbatim; only the mapping of the fetched row changes. |

### Explicitly NOT touched

Existing production `calls` / `appointments` rows carrying `"undefined undefined"` — **no repair, no backfill, no migration; the goal is forward-only correctness** · `src/contexts/TwilioContext.tsx` architecture (re-entrancy refs, `device.connect()`, CallSid handling, caller-ID selection/validation, duration, recording, orphan handling, telemetry) · `src/components/layout/FloatingDialer.tsx` · `src/lib/quick-call.ts` contract · `src/pages/DialerPage.tsx` · campaign queue / locks / `advance_campaign_lead` · dispositions · `src/components/layout/ReminderPopup.tsx` · `src/pages/CampaignDetail.tsx` · any migration, RLS policy, Edge Function, or generated type · `package.json` / `tsconfig*`.

---

## 5. Test plan (all five required cases, plus the write guard)

### New: `src/lib/__tests__/contactName.test.ts`
- Canonical camelCase lead/client/recruit → `"Charlotte Kearney"`.
- **A/B/C at the unit level:** raw snake_case row (`first_name: "Charlotte"`, `last_name: "Kearney"`) → `"Charlotte Kearney"`.
- **D:** `"undefined undefined"`, `"null null"`, `"undefined"`, `""`, `"   "`, `"\t\n"` → `""` ⇒ `|| null` ⇒ **`NULL`**.
- Partial: `"Charlotte undefined"` → `"Charlotte"`; single-token `"Cher"` → `"Cher"`.
- Non-regression: `"Null"`, `"Undefined Jones"`, `"Mary Jo Van Der Berg"` pass through unchanged (D3).
- Non-string / null / undefined input → `""` without throwing.

### New: `src/pages/__tests__/contactDeepLinkQuickCall.test.tsx`
Renders the **real** `ContactDeepLinkPage` → **real** `FullScreenContactView` over a projection-style Supabase stub (same pattern as `fullScreenContactViewScore.test.tsx`), captures the `quick-call` event, clicks the real Call button:

- **A.** `leads` row `{ first_name: "Charlotte", last_name: "Kearney" }` → `detail.name === "Charlotte Kearney"`, `type === "lead"`, `contactId === row.id`, `phone === row.phone`.
- **B.** `clients` row equivalent → correct name, `type === "client"`.
- **C.** `recruits` row equivalent → correct name, `type === "recruit"`.
- **D.** Explicit assertion that `detail.name` is **never** `"undefined undefined"` and contains no `undefined`/`null` token — including a row with `last_name: null`.
- `fromNumber` preserved when a `phone_numbers` row exists; omitted when none.
- Fail-first proof: every one of A–D is run against the **unmodified** head first and recorded as FAILING before the fix lands.

### New: `src/components/contacts/__tests__/fullScreenContactViewQuickCall.test.tsx`
- **F.** `FullScreenContactView` rendered with a **canonical camelCase** contact exactly as `Contacts.tsx` passes it → name still correct, contract unchanged (proves the fix does not regress the working surface).
- Undialable phone (`""`) → **no** event dispatched, error toast shown.

### New: `src/pages/__tests__/calendarContactIdentity.test.tsx`
- **E.** Real `CalendarPage` mounted at `?contact=<id>` with the `leads` query returning a **raw snake_case row** → the `contact` prop handed to `FullScreenContactView` carries canonical `firstName` / `lastName` / `phone` / `id`, and its display name is `"Charlotte Kearney"`.

### New: `src/pages/__tests__/contactsQuickCallType.test.tsx`
- **G.** Real `Contacts` page, Recruits tab + Kanban view, `ContactKanbanBoard`'s `onCall` invoked → dispatched detail carries `type: "recruit"` (not the `FloatingDialer` `"lead"` default) with the correct name/phone/contactId. Leads Kanban asserted to carry `type: "lead"`.

### Extended: `src/lib/__tests__/quickCall.test.ts`
Untouched assertions must stay green (canonical event/field contract). Campaign quick-call naming is exercised through this contract test.

### Write-path guard
`TwilioContext`'s insert expression is asserted to route through `sanitizeContactName` (a literal-source assertion, the precedent set by `campaignDetailImportRetry.test.tsx`'s select-projection assertion), so a future edit cannot silently drop the guard.

**No mock data ships in any production path** — all fixtures are test-local. No service-role key, no secrets, no Zod change (no form/modal work is required), Tailwind-only (no styling change at all).

---

## 6. Verification I will run

1. `npx tsc --noEmit` (repo-required gate; note it compiles nothing because the root tsconfig has `"files": []`).
2. `npx tsc -p tsconfig.app.json --noEmit` — the **meaningful** check. Report the error count against the `main` baseline and prove `set(branch) − set(main) = ∅`.
3. Focused suites: the three new files + `quickCall.test.ts` + `fullScreenContactViewScore.test.tsx` + `contactsRender` / `contactsGatingRender` / `calendarPageListFilter` (the FullScreenContactView consumers).
4. Full `npx vitest run` — no regressions against the current 1217-test baseline.
5. `npx eslint` on every touched file — line-insensitive multiset compared to `main` (zero new problems).
6. `npm run build`.
7. `git diff --check`.

**Not run, by rule (AGENT_RULES §28):** any production query, mutation, migration, `db push`, `migration repair`, or Edge deploy. No Supabase MCP write of any kind.

---

## 7. Invariants respected

| Rule | How |
|------|-----|
| §6 Dialer Model / invariant #1, #9 | `TwilioContext` gains one pure string call; no dial-path, JWT, device, or re-entrancy-ref change. |
| Invariant #8, #12, #13 | No `calls.duration`, contacted, or telemetry logic touched. |
| Invariant #15, #16, #19 | No queue, lock, suppression, or `advance_campaign_lead` change. |
| Invariant #18, #24 | Caller-ID selection and the mandatory pre-insert validation are untouched; `fromNumber` is passed through exactly as today. |
| Invariant #22 | The `FloatingDialer` quick-call → `appointments` callback writer is **not** changed. |
| Invariant #28 | Read-only; zero production access. |
| §3 Multi-tenancy | `organization_id` filter and `.maybeSingle()` kept on every deep-link query. |
| §7 Component Standards | Tailwind only, no inline styles, no new inline feature in `DialerPage`/`TwilioContext`. |
| §10 Forbidden Patterns | No mock data, no service role, no hardcoded keys, no ad-hoc SQL, no Telnyx. |

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| `rowToLead` sets `attemptCount: 0` / `lastDisposition: undefined` for a plain row. | `FullScreenContactView` reads neither field (verified by grep of every `contact.*` access). No display change. |
| Deep-link edit behaviour changes (it starts working). | That is the correct behaviour and is currently broken. Called out here so it is an approved change, not a surprise. |
| `contactDisplayName` returns `""` for a nameless contact. | D5: the dial proceeds; `FloatingDialer` shows the phone; `contact_name` is `NULL` — honest, not fabricated. |
| Historical `"undefined undefined"` rows already in production `calls`. | **Not repaired.** Any data repair needs its own approval, bounded targets, and a recovery plan (AGENT_RULES §28). Listed as a next step only. |

---

## 9. Approval record

**Approved by Chris, 2026-08-11:** F1–F5 required set, **plus R1** (CalendarPage) and **plus R2** (Contacts Kanban contact type).

**Explicitly declined / forbidden in this pass:** R3 (CampaignDetail), R4 (deep-link save/refetch reorder), any repair or backfill of existing `"undefined undefined"` rows, any production data mutation, any deploy or merge, any unrelated cleanup or refactor, any Twilio architecture change.

**Stated goal, verbatim:** existing stored labels are not to be fixed — the objective is only that this stops happening on **new** calls going forward.

Implementation proceeds on `claude/agentflow-contact-name-fix-46abvk`. **No PR will be opened unless asked.**
