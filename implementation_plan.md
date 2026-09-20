# Implementation Plan — ContactDeepLinkPage save/update lifecycle: full integrity audit + fix (rev 1)

> **STATUS (rev 1, 2026-09-20): PLAN ONLY. AWAITING CHRIS'S EXPLICIT APPROVAL.**
>
> Nothing outside this document has been modified. **No source file, no test file, no migration, no
> Edge Function, no Supabase MCP call of any kind (not even a read-only `SELECT`), no deploy.**
> The only commands run so far were local: `git`, `grep`/`sed`, `npm ci`, and the four verification
> gates captured as baselines in §J.
>
> **Repository:** `cgarness/agentflow-life-insure` · branch `claude/contact-deeplink-save-audit-5czfmi`
> · base `main` @ **`2cdc5b8`** (`fix(contacts): stop FullScreenContactView corrupting
> clients.custom_fields.additional_policies (#376)`) — confirmed as the current head of `main`.
>
> **Backend verdict, stated up front: NO migration, NO RLS change, NO RPC, NO Edge Function, NO
> schema change, NO production data mutation is required by any part of this build.** Every fix is
> frontend-only and uses APIs and helpers that already exist.

---

## §A. What this build is

`/leads/:id`, `/clients/:id` and `/recruits/:id` render `FullScreenContactView` through
`ContactDeepLinkPage`. The page's `handleUpdate` re-fetches the row **before** it updates it and
then discards the authoritative row the update returns. The parent `contact` state therefore holds
**pre-update values** after every successful save, while the view's internal `editForm` displays the
new ones — so the record *looks* saved while Call, SMS, Email, the header, appointment prefill and
template merge all still use the old values, and a subsequent Cancel can write the old values back
over the new ones.

This build fixes the whole save lifecycle of that page in one pass: the ordering, the authoritative
post-save state, the late-response/route-change race, the failed-save posture, and the one real
duplicate-detection parity gap against the Contacts surface.

**This is the follow-up that AGENT_RULES invariant #35 already has on the record** as open item (3):
*"`ContactDeepLinkPage.handleUpdate` re-fetches BEFORE it updates (`:89-99`), reseeding the form
with the pre-update row."* It was also raised and **explicitly declined** once before, as **R4** of
the 2026-08-11 contact-name boundary fix (`WORK_LOG.md:2331`) — that entry records
*"`handleUpdate`'s existing refetch-then-save ordering preserved verbatim per the R4 exclusion."*
Nothing since has reversed that; this task is the reversal, and it is now in scope by Chris's
direction.

---

## §B. Method — what was read before planning

Per AGENT_RULES §8, in full and before any planning: **`AGENT_RULES.md`**, **`VISION.md`**, and the
newest **`WORK_LOG.md`** entries (plus a targeted sweep of every historical entry mentioning the
deep-link page, duplicate detection, or `enforceContactPreSave`). `main` was confirmed at `2cdc5b8`.

Source read line-by-line: `src/pages/ContactDeepLinkPage.tsx` · `src/components/contacts/FullScreenContactView.tsx`
(1,489 lines) · `src/pages/Contacts.tsx` (3,500+ lines, every contact save path) ·
`src/lib/supabase-contacts.ts` · `src/lib/supabase-clients.ts` · `src/lib/supabase-recruits.ts` ·
`src/lib/contactDuplicateDetection.ts` · `src/lib/contactRequiredFields.ts` ·
`src/lib/supabase-settings.ts` (contact-management settings) · `src/lib/reservedCustomFields.ts` ·
`src/App.tsx` · `src/components/PageGuard.tsx` · `src/components/layout/AppLayout.tsx` ·
`src/lib/viewAsSurfaces.ts` · `src/hooks/useOrganization.ts` · `src/components/search/GlobalSearch.tsx` ·
`src/pages/__tests__/contactDeepLinkQuickCall.test.tsx` ·
`src/components/contacts/__tests__/fullScreenContactViewSaveFailure.test.tsx` and the rest of the
contact test suites · `src/main.tsx` · `vitest.config.ts` · `src/test/setup.ts`.

A six-dimension parallel audit (deep-link lifecycle · canonical APIs · duplicate parity ·
routing/security · test inventory · race & downstream consumers) was run with per-finding
adversarial verification against the real tree. Every claim below is cited to a line I read.

**No newly-established invariant in the recent `WORK_LOG` conflicts with this work.** The two
constraints that *do* bind it are honoured throughout: invariant #35's reserved-key write boundary
(`assertCustomFieldsWriteSafe`, untouched here) and PR #376's failed-save posture
(`FullScreenContactView.handleSave`'s `try/catch`, which this build strengthens rather than
regresses).

---

## §C. Verified defects

### D1 — Fetch-before-update; the authoritative row is discarded (CONFIRMED, blocker)

`src/pages/ContactDeepLinkPage.tsx:85-100`:

```tsx
const handleUpdate = async (_id: string, _data: any) => {
  // Re-fetch after update so FullScreenContactView reflects the saved state.   ← the comment is false
  const table = …;
  const { data } = await (supabase as any)
    .from(table).select("*").eq("id", _id).eq("organization_id", organizationId).maybeSingle();   // :89-94
  if (data) setContact(toCanonicalContact(contactType, data));                                    // :95  ← PRE-update row
  if (contactType === "lead") await leadsSupabaseApi.update(_id, _data);                          // :97
  else if (contactType === "client") await clientsSupabaseApi.update(_id, _data);                 // :98
  else await recruitsSupabaseApi.update(_id, _data);                                              // :99
};                                                                                                 // return value DISCARDED
```

Three separate faults in five lines: the `SELECT` is **before** the `UPDATE`; its result is
installed as the parent `contact`; and the canonical row each `update()` returns is thrown away.

### D2 — The stale parent is not cosmetic: it drives real actions (CONFIRMED, blocker)

`renderField` reads **`editForm`** in *both* edit and read mode
(`FullScreenContactView.tsx:819-826`), which is why the field grid appears correct after a save. But
every action and every header element reads the **parent `contact` prop**:

| Consumer | Line | Reads |
|---|---|---|
| Quick Call (`dispatchQuickCall`) | `:966-969` | `contact.id`, `contactDisplayName(contact)`, `contact.phone` |
| SMS send | `:770`, `:783`, `:791`, `:793` | `contact.phone`, `contact.id` |
| Email send | `:727`, `:744`, `:765` | `contact.email`, `contact.id` |
| Compose enable/disable gate | `:1210-1211` | `contact.phone`, `contact.email` |
| Record header name + avatar initials | `:1023`, `:1025` | `contact.firstName`, `contact.lastName` |
| Template merge input | `:250-258` → `:1412` | whole `contact` object |
| Appointment prefill (`appointments.contact_name`) | `:1455` | `contactDisplayName(contact)` |
| Assigned-agent pill + dependent roster load | `:1125-1126`, `:308`, dep at `:565` | `contact.assignedAgentId` |
| Local-time chip | `:890-893` | `contact.state` |
| Client policy-type badge | `:923` | `contact.policyType` |
| Delete confirmation copy | `:1373` | `contact.firstName`, `contact.lastName` |
| Notes / activities / tasks / campaigns scoping | `:606`, `:616`, `:694`, `:1323` | `contact.id` |

So after changing phone `1111` → `2222` and saving, the screen shows `2222` and the Call and SMS
buttons dial `1111`. The same divergence puts the **old** name into `calls.contact_name` and
`appointments.contact_name` — the exact write targets the 2026-08-11 contact-name boundary fix was
built to protect (`WORK_LOG.md:2335`).

### D3 — Reachable lost update: a successful save can be overwritten (CONFIRMED, blocker)

Proven against the real code, not inferred:

1. Contact phone = `1111`. Enter edit, change to `2222`, Save.
2. `handleSave` (`:640`) awaits `onUpdate` → `handleUpdate` installs the **pre-update** row
   (`1111`) and then performs the UPDATE. DB is now `2222`; parent `contact` is `1111`.
3. The re-sync effect (`:288-302`) cannot correct it: it bails while `editMode || hasUnsavedChanges`
   is true, and by the time `handleSave` clears both (`:677`) the parent object is **byte-identical
   to the row already snapshotted** (the `SELECT` ran before the UPDATE), so
   `prevContactSnapshotRef` matches and it returns early at `:297`. `editForm` keeps showing `2222`.
4. Press **Edit** again — `setEditMode(true)` only (`:1028`); `editForm` is *not* reseeded, so `2222`
   is still on screen.
5. Press **Cancel** — `handleCancel` (`:682`) runs `setEditForm({ ...contact })`, reseeding the form
   from the **stale parent**: `1111`.
6. Edit an unrelated field (Notes). Save. `handleSave` sends the **whole `editForm`** (`:670`), so
   `phone: "1111"` goes with it and `leadsSupabaseApi.update` writes it.

**`2222` is gone.** A successful save is silently reverted by a Cancel plus an unrelated edit.

### D4 — Late save response / route-change race (CONFIRMED, high)

`src/App.tsx:134-136` mounts three separate `<Route>` elements, each rendering
`<PageGuard pageName="Contacts"><ContactDeepLinkPage contactType="…" /></PageGuard>`. Navigating
`/leads/A → /leads/B` matches the **same** route, so React reconciles the **same component
instance**: `useParams().id` changes and the fetch effect re-runs, but the instance — and its
`setContact` — persist. `GlobalSearch` (`src/components/search/GlobalSearch.tsx:20-25, 69`) makes
exactly this navigation one keystroke away.

`handleUpdate` has **no staleness guard at all**, so a save for contact A that resolves after the
user has navigated to contact B calls `setContact(A)` and replaces B's record on screen — with a
different `contact.id`, which also remounts `FullScreenContactView` (`:145` `key={contact.id}`) and
re-points its notes, activities, tasks and campaign panels at the wrong contact.

The initial-fetch effect **is** guarded (`:44`, `:67`, `:75`, `:77`, `:82` — a `cancelled` flag set
by the effect cleanup). `handleUpdate` is not, because it lives outside any effect.

### D5 — Failed-save posture is currently correct, and must stay correct (CONFIRMED, high)

Today `handleUpdate` does not catch, so a rejected `update()` propagates to
`FullScreenContactView.handleSave`'s `try/catch` (`:668-675`, added in PR #376) which toasts the
message, keeps edit mode open, keeps the typed values and the dirty flags, writes no activity and
shows no success toast. That contract is correct **and this build must not regress it**.

But the current ordering already violates the stated requirement *"must NOT update its parent
contact state before a successful save"*: `setContact(pre-update row)` at `:95` happens
**unconditionally, before** the UPDATE is even attempted. On a failing save the page therefore
installs a fresh (if equal-valued) parent object for a save that never happened. The fix removes
that write entirely.

### D6 — Duplicate-detection parity gap, leads only (CONFIRMED, high)

This was audited rather than guessed. The canonical helper is **`enforceContactPreSave`**, a
component-local `useCallback` at `src/pages/Contacts.tsx:1497-1574`. It does two things: a
required-field check (`computeMissingRequired`, `enforceCustomFields: false`) and a duplicate lookup
(`findDuplicates` from `src/lib/contactDuplicateDetection.ts:55-89`), applying the agency's
`manualAction` setting — `block` → toast + refuse, `warn` → a real confirm dialog
(`Contacts.tsx:3465-3482`), `allow` → silent pass. A lookup **failure** deliberately does not block
the save (`:1543-1546`).

Where it is and is not applied today:

| Surface | Lead | Client | Recruit |
|---|---|---|---|
| Add modals (`handleAddLead` / `handleAddClient` / `handleAddRecruit`) | ✅ `:1602` | ✅ `:1925` | ✅ `:2005` |
| Edit modals (`AddClientModal` / `AddRecruitModal` edit) | — (routes to `handleUpdateLead`) | ✅ `:3211` | ✅ `:3225` |
| **Contacts page `FullScreenContactView`** | ✅ via `handleUpdateLead` `:1639-1650` | ❌ raw `clientsSupabaseApi.update` `:3253` | ❌ raw `recruitsSupabaseApi.update` `:3265` |
| **`ContactDeepLinkPage`** | ❌ **none** | ❌ none | ❌ none |

`handleUpdateLead` (`:1637-1664`) runs the check **only when phone or email is part of the payload**:

```tsx
const changesPhoneOrEmail = data.phone !== undefined || data.email !== undefined;   // :1639
```

(`FullScreenContactView` always sends the whole `editForm`, so this is true for a normal save and
false for the partial `{ status }` payload `handleStatusChange` sends at `:605`.)

**Therefore the one real divergence is the lead path**: the same edit is duplicate-checked from
`/contacts` and not checked at all from `/leads/:id`. Client and recruit are **already at parity**
with their directly comparable surface (neither `FullScreenContactView` mount runs the check) —
the client/recruit gap that does exist is *internal to `Contacts.tsx`* (modal ✅ vs. full-screen ❌)
and predates this page. See **decision D-3**.

**Required-field parity already holds and needs nothing.** `FullScreenContactView.handleSave`
(`:640-666`) independently runs locked-core validation **and** `computeMissingRequired` against the
org's `required_fields_<type>` setting with `enforceCustomFields: **true**` — strictly stronger than
`enforceContactPreSave`'s check, on both surfaces, because it lives in the shared component and
loads `contact_management_settings` itself (`:331-345`). Only the duplicate lookup is missing.

### D7 — A refused pre-save is reported as a successful save (CONFIRMED, high — pre-existing on `Contacts.tsx`)

`handleUpdateLead` turns a refusal into a plain `return` (`Contacts.tsx:1650`), not a rejection. So
when a duplicate is **blocked**, or the **warn** prompt is **cancelled**, `await onUpdate(...)` in
`FullScreenContactView.handleSave` **resolves normally** — and the component then exits edit mode,
clears `hasChanges`/`hasUnsavedChanges`, writes a *"details updated"* activity row and toasts
*"Lead updated successfully"* (`:677-679`) **with nothing written**. Same class of defect as the one
PR #376 fixed, on the path immediately next to it.

This matters here because the deep-link page must implement the same rule, and the refusal contract
has to be defined once. See **decision D-4**.

### D8 — Other observations in the lifecycle (documented; fixing them is **not** proposed in this build)

- **`handleStatusChange` (`:599-608`) has no error handling** and mutates `localStatus` + `editForm`
  *before* the save. A rejected status change escapes as an unhandled rejection and leaves the new
  status on screen unsaved. Shared with the Contacts surface. **Out of scope** — see §K.
- **`ContactDeepLinkPage` never clears `loading` when `id` or `organizationId` is falsy** (`:42`),
  so an unresolved organization leaves a permanent spinner. Not a save-integrity defect; no save is
  reachable in that state. **Out of scope.**
- **`update()` uses `.single()`, not `.maybeSingle()`** in all three APIs. Here that is *fail-closed*
  and desirable: zero rows (deleted row, RLS refusal) raises and the save is reported as failed.
  Changing it would weaken failure detection. **Leave as-is.**

---

## §D. The canonical save contract (verified per type)

All three canonical updates already perform `UPDATE … RETURNING` and map the row:

| API | Line | Chain | Returns |
|---|---|---|---|
| `leadsSupabaseApi.update` | `supabase-contacts.ts:176-183` | `.update(updateData).eq("id", id).select().single()` | `rowToLead(row)` → `Lead` |
| `clientsSupabaseApi.update` | `supabase-clients.ts:149-156` | `.update(updateData).eq("id", id).select().single()` | `rowToClient(row)` → `Client` |
| `recruitsSupabaseApi.update` | `supabase-recruits.ts:149-157` | `.update(updateData).eq("id", id).select().single()` | `rowToRecruit(row)` → `Recruit` |

**Completeness — decisive:** `.select()` with no argument is `select("*")`, the *identical*
projection the deep-link page's own initial fetch uses (`ContactDeepLinkPage.tsx:62`), fed through
the *identical* mapper (`toCanonicalContact`, `:25-29`). There is **no field** the initial fetch
produces that the update return does not. (`rowToLead`'s two call-derived fields, `attemptCount` and
`lastDisposition` (`supabase-contacts.ts:407-409`), read `row.calls`, which neither query embeds —
both paths yield `0` / `undefined` identically, so there is no regression either.)

**→ A post-update re-`SELECT` is provably unnecessary and will not be added.** The fix is a net
**removal** of one database round trip per save.

**Server-side normalization the returned row carries and the submitted `_data` does not** — the
concrete reason the returned row must win:

- `normalizeUsState(data.state)` — leads `:159`, clients `:125`, recruits `:142`
- `parseCurrencyToNumberOrNull` for `premium` / `face_amount` — clients `:131-132`
- `normalizeDateOrNull` for `issue_date` / `effective_date` / `sold_date` / `draft_date` — clients `:134-135`, `:137-138`
- `normalizePaymentFrequencyOrNull` — clients `:140`
- `updated_at` — all three
- plus anything a database default or trigger writes

Neither `update()` performs duplicate detection or pre-save validation of any kind; both are the
caller's responsibility (duplicate detection lives only in `create`/`import`,
`supabase-contacts.ts:107-119` and `:230-246`). All three **throw** on error
(`throw new Error(error.message)`), which is what makes `FullScreenContactView`'s `try/catch` work.

**The pattern the Contacts surface already uses, and which this build adopts verbatim:**
`handleUpdateLead` does `const updated = await leadsSupabaseApi.update(id, data)` and then
`setSelectedLead(prev => (prev?.id === id ? updated : prev))` (`Contacts.tsx:1650`, `:1659`) — the
authoritative returned row, installed under an **id guard**. The client and recruit mounts reach the
same end state the expensive way, through `fetchData()`'s re-sync of `selectedClient` /
`selectedRecruit` (`:496-500`, `:512-516`). Every Contacts surface installs the authoritative row
after a successful save. **`ContactDeepLinkPage` is the only one that does not.**

---

## §E. Files to touch

### Source (3 files)

1. **`src/pages/ContactDeepLinkPage.tsx`** — the substantive change.
   - Delete the pre-update `SELECT` (`:87-95`) entirely.
   - `await` the canonical `update()` and **capture** the returned row.
   - Install it with a fail-closed staleness guard: still mounted **and** the route `id` still equals
     the saved id **and** `contactType` still matches **and** this is still the newest save
     (monotonic request token). Any check failing → **return without touching state**; the save is
     already durably committed, only the local echo is dropped.
   - Never `catch` — the rejection must keep reaching `FullScreenContactView.handleSave` (§C D5).
   - Lead duplicate pre-save (§C D6), gated exactly as `handleUpdateLead` gates it
     (`data.phone !== undefined || data.email !== undefined`), plus the confirm dialog for `warn`.
   - Refs are assigned during render (`currentIdRef.current = id`), the pattern this component tree
     already uses — `FullScreenContactView.tsx:245-246` does exactly that with
     `latestContactIdRef`. No `StrictMode` in this app (`src/main.tsx`), so no double-invoke hazard.

2. **`src/lib/contactDuplicatePreSave.ts`** *(new, small, pure)* — the shared duplicate **policy**,
   extracted so it is stated once:

   ```ts
   export type DuplicatePreSaveDecision =
     | { kind: "allow" }
     | { kind: "block"; message: string }
     | { kind: "confirm"; label: string; description: string };

   /** Canonical lookup + agency manualAction policy. Renders nothing, toasts nothing.
    *  A lookup failure resolves to { kind: "allow" } — unchanged from Contacts.tsx:1543-1546. */
   export async function evaluateContactDuplicatePreSave(opts): Promise<DuplicatePreSaveDecision>
   ```

   It **calls the existing `findDuplicates` / `describeDuplicate`** (`contactDuplicateDetection.ts`)
   — no second duplicate-detection implementation is written, and none of that file changes.

3. **`src/pages/Contacts.tsx`** — `enforceContactPreSave`'s duplicate half is re-pointed at
   `evaluateContactDuplicatePreSave` and maps the returned decision to the *same* toast and the
   *same* dialog it uses today. Required-field half, dialog markup, copy, call sites and every other
   line are untouched. This is what proves the logic is shared rather than duplicated.
   *(Plus the D-4 change, if approved.)*

4. **`src/components/contacts/FullScreenContactView.tsx`** — **only if D-4 is approved**: ~4 lines so
   the `catch` at `:668-675` recognises an already-reported refusal and skips its own toast while
   still keeping edit mode, the typed values and the dirty flags. No other line changes.

### Docs (2 files)

5. **`implementation_plan.md`** — this document, updated with the as-built record.
6. **`WORK_LOG.md`** — one new entry, newest first (AGENT_RULES §9).

`AGENT_RULES.md` is updated **only** if Chris wants the resulting contract recorded as an invariant
— see decision **D-5**. Nothing under `supabase/` is touched.

---

## §F. Tests

Every new test is **fail-first proven**: run against the unmodified tree first, and the proof
recorded. Harness conventions are copied verbatim from
`src/pages/__tests__/contactDeepLinkQuickCall.test.tsx` (chainable Supabase stub, hoisted
`h.routeId` for `useParams`, the `react-router-dom` / `useOrganization` / `usePermissions` /
context mocks) and `fullScreenContactViewSaveFailure.test.tsx` (real-component save-failure
assertions).

**New: `src/pages/__tests__/contactDeepLinkSaveIntegrity.test.tsx`**

| # | Asserts | Reproduces on `2cdc5b8` |
|---|---|---|
| 1 | No `SELECT` is issued on the table between mount and the UPDATE (ordering, D1) | ✅ |
| 2 | On success the parent holds the **returned** row: Call button dials the **new** phone (D1+D2) | ✅ dials the old phone |
| 3 | Email/SMS compose targets the new email/phone after a save (D2) | ✅ |
| 4 | Header shows the new name after a name change (D2) | ✅ |
| 5 | **The full lost-update sequence** — save phone `2222`, Edit, **Cancel**, edit Notes, Save → the second UPDATE carries `2222`, never `1111` (D3) | ✅ carries `1111` |
| 6 | Server-normalized values win: the API returns a normalized `state`/`premium`/`sold_date` differing from the submitted value; the view and the next payload use the **server's** value (D3 requirement) | ✅ |
| 7 | Assigned-agent change → parent carries the returned `assignedAgentId` | ✅ |
| 8 | **Late response for A after navigating to B does not replace B** (D4) | ✅ replaces B |
| 9 | Unmount before the save resolves → no state update, no act() warning (D4) | ✅ |
| 10 | Superseded save (two in flight, older resolves last) is ignored (D4) | ✅ |
| 11 | Rejected `update()` → parent contact **unchanged**, no pre-update row installed, edit mode open, typed values intact, no success toast, no activity row (D5 + PR #376 non-regression) | ✅ installs a row |
| 12 | Exactly **one** database write per save and **zero** extra reads (round-trip budget) | ✅ 1 read + 1 write |
| 13 | All three contact types (`lead` / `client` / `recruit`) drive 1, 2 and 11 | ✅ |

**New: `src/pages/__tests__/contactDeepLinkDuplicateParity.test.tsx`** *(D6 / D-1 / D-2)*

- `manualAction: "block"` + a matching phone → **no UPDATE**, edit mode stays open, failure surfaced.
- `manualAction: "warn"` → dialog shown; **Save Anyway** → UPDATE proceeds; **Cancel** → no UPDATE and
  **no success toast and no activity row** (this is the D7 assertion).
- `manualAction: "allow"` → UPDATE proceeds silently.
- No match → UPDATE proceeds, no dialog.
- Duplicate-lookup **failure** does not block the save (parity with `Contacts.tsx:1543-1546`).
- The `excludeId` is the contact's own id — editing a contact never flags **itself**.
- A `{ status }`-only update (`handleStatusChange`) runs **no** duplicate lookup (gate parity).
- Source-contract assertion: `ContactDeepLinkPage` and `Contacts.tsx` both reach
  `evaluateContactDuplicatePreSave`, and **no second `findDuplicates` policy implementation** exists.

**New: `src/lib/__tests__/contactDuplicatePreSave.test.ts`** — pure unit tests of the extracted
decision function across all four `DuplicateRule`s, both `DuplicateScope`s, all three
`ManualAction`s, `excludeId`, and the lookup-failure path.

**Changed:** none expected. No existing test asserts the pre-update `SELECT`
(`contactDeepLinkQuickCall.test.tsx`'s stub returns the same row for every query and never inspects
call ordering), and `fullScreenContactViewSaveFailure.test.tsx` exercises `onUpdate` through an
injected mock, not through this page. If any existing assertion does turn out to depend on the old
ordering, it will be reported here before it is touched, never quietly rewritten.

---

## §G. Migrations / backend

**None.** No migration file, no `apply_migration`, no RPC, no RLS policy, no Edge Function, no
`execute_sql`, no production read and no production write. Every API, helper and settings row this
build uses is already live. Confirmed against §D: the duplicate lookup (`findDuplicates`) and the
settings read (`contact_management_settings`) are both existing, RLS-governed client queries already
used by `Contacts.tsx` today.

---

## §H. Security and scope posture

- **The initial deep-link fetch is unchanged**: `select("*")` · `.eq("id", id)` ·
  `.eq("organization_id", organizationId)` · `.maybeSingle()` · RLS
  (`ContactDeepLinkPage.tsx:60-65`). The explicit org filter stays as defence-in-depth.
- **View As stays fail-closed and is not touched.** `AppLayout.tsx:34` blocks any path not in
  `viewAsSurfaces.ts`'s exact-match allow-list (`:57` — only `/conversations` and `/contacts`), so
  the deep-link routes never mount while impersonating. That module's own doc comment names the
  contact deep-link pages as deliberately withheld pending a separate audit. No line of
  `viewAsSurfaces.ts`, `AppLayout.tsx` or the allow-list changes.
- **Permissions are unchanged.** `PageGuard pageName="Contacts"` on all three routes
  (`App.tsx:134-136`), and `FullScreenContactView` independently gates Edit/Delete on
  `contacts.<type>.edit` / `.delete` (`:186-189`). The deep-link page adds no new capability.
- **Cross-contact contamination is closed, not opened**: the new guard is the thing that stops a
  late response for contact A writing into contact B.
- **Round-trip budget improves.** Per save: today `1 SELECT + 1 UPDATE`; after, `1 UPDATE` (plus, on
  the lead path only and only when phone/email is in the payload, the duplicate lookup and a
  settings read — both lazily fetched at save time and memoised, so a deep link that is only *read*
  costs **zero** extra queries).
- The duplicate lookup is org-scoped by construction (`contactDuplicateDetection.ts:63`) and
  RLS-governed; it reads six non-sensitive columns and is the same query `Contacts.tsx` already runs.

---

## §I. Decisions needed before I write code

**D-1 — Duplicate parity on the lead deep-link path.** *Recommended: **yes**, mirroring
`handleUpdateLead` exactly (run only when `phone` or `email` is in the payload).* This closes the one
genuine divergence in §C D6. Alternative: leave `/leads/:id` unchecked and merely document it.

**D-2 — Client and recruit deep-link paths.** *Recommended: **exact parity — no duplicate check**,*
because the directly comparable surface (the `FullScreenContactView` mounts at `Contacts.tsx:3247`
and `:3259`) has none either. Adding it only on the deep-link page would create a **new** asymmetry
in the opposite direction. Alternative (**D-2b**): add it to all three on **both** surfaces, which
also closes the pre-existing modal-✅/full-screen-❌ gap inside `Contacts.tsx` — more consistent, but
it changes Contacts behaviour Chris has not asked to change.

**D-3 — The `Contacts.tsx`-internal modal-vs-full-screen gap for clients/recruits.** *Recommended:
**document only**, in the WORK_LOG, as a separate follow-up needing its own approval.* It predates
the deep-link page and is not a deep-link defect.

**D-4 — The false-success on a refused pre-save (§C D7).** *Recommended: **fix it, in both places**,*
via a shared sentinel: a refusal throws `ContactSaveRefusedError` (already user-reported), the ~4-line
`catch` in `FullScreenContactView` skips a duplicate toast for it but still keeps edit mode, the typed
values and the dirty flags, and writes no activity and no success toast. Without this, a blocked or
cancelled duplicate prompt reports *"updated successfully"* while nothing was written — on the deep-link
page I would be **building that defect in**, so the alternative (**D-4b**, fix it on the deep-link page
only and leave `Contacts.tsx:1650` as-is) leaves the two surfaces disagreeing about what a refusal means.

**D-5 — Record the result as an AGENT_RULES invariant (#36)?** *Recommended: **yes**.* Proposed text:
*"A contact save handler must pass the caller's payload to the canonical `update()` and install the
row it RETURNS as the new parent contact, guarded by mounted + current id + current contact type +
newest-request. Never re-`SELECT` before or after the update — `.select().single()` already returns
the full canonical row. Never install any row on a failed or refused save, and never resolve a
refused save as a success."* This would also retire open follow-up (3) of invariant #35.

**D-6 — Branch and PR.** Work lands on `claude/contact-deeplink-save-audit-5czfmi` and is pushed
there. **I will not open a PR unless you ask for one.**

---

## §J. Verification plan

Baselines below were captured on the **clean tree at `2cdc5b8`** before any edit, and each gate will
be re-run and **diffed**, not merely re-reported.

| Gate | Baseline at `2cdc5b8` |
|---|---|
| `npx tsc --noEmit` (the AGENT_RULES §8 gate) | **exit 0** — and **vacuous**: root `tsconfig.json` is solution-style (`"files": []`), so it checks zero files. Reported, never credited (invariant #35). |
| `npx tsc -p tsconfig.app.json --noEmit` (the meaningful one) | **91 errors** — matches the figure invariant #35 records. Error **set** will be diffed, not just the count. |
| `npm run lint` | **216 problems (15 errors, 201 warnings)** — matches the last WORK_LOG entry exactly. |
| `npm run test` | **3,014 passed / 1 failed / 14 skipped** across **201 files** — matches the last WORK_LOG entry exactly. The one failure is the known pre-existing `recordingRetentionVoicemail.test.ts` v29 byte-identity check. |
| `npm run build` | **succeeded (16.7 s)**. |

*(Note for the record: this container had no `node_modules` and no `VITE_SUPABASE_*` env, which made
11 test files fail to **collect** with `supabaseUrl is required`. After `npm ci` and a **gitignored**
local `.env.local` carrying the public project URL from AGENT_RULES §2 and a dummy anon key, the
suite reproduces the documented baseline exactly. No real credential is involved and the file is
covered by `.gitignore:30`.)*

Additionally, before handoff: a **negative control** — the changed source files stashed and the new
suites re-run against the unfixed tree, with the failure count recorded (the tests must reproduce the
defects, not merely agree with the fix); a diff scan for `service_role`, secrets, Telnyx, `.single()`
regressions, mock data, and any change under `supabase/` or to `package.json` / `tsconfig*`; and
`git diff --check`.

**Browser verification is NOT claimed.** This session cannot load a Vercel preview, so a human pass
over `/leads/:id`, `/clients/:id` and `/recruits/:id` remains owed and will be stated as owed.

---

## §K. Explicitly out of scope (documented, not fixed)

1. `handleStatusChange`'s missing error handling and optimistic pre-save mutation (§C D8) — shared
   with the Contacts surface; its own change with its own tests.
2. The permanent spinner when `organizationId` is unresolved (§C D8).
3. The `Contacts.tsx` modal-vs-full-screen duplicate gap for clients/recruits (**D-3**).
4. Invariant #35's other open follow-ups: the read-only "Additional Policies" panel, the
   `editForm`-frozen stale-snapshot case **inside** `FullScreenContactView` (`:290`), the
   `!== undefined` whole-column-wipe gate on the leads path, and the reserved-name check at
   custom-field creation. **Follow-up (3) of that list is exactly what this build closes.**
5. The vacuous `npx tsc --noEmit` script (adding a real `typecheck` npm script) — invariant #35's
   open follow-up; reported at every gate but not changed here.
6. Widening the View As allow-list to the deep-link routes — a deliberate product decision with its
   own audit requirement (`viewAsSurfaces.ts:21-30`).

---

**Awaiting approval of §E–§F and decisions D-1…D-6. No file outside this document will be modified
until you approve.**
