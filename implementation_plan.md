# Implementation Plan — ContactDeepLinkPage save/update lifecycle: full integrity audit + fix (rev 2 — APPROVED, IN IMPLEMENTATION)

> **STATUS (rev 2, 2026-09-20): IMPLEMENTED AND VERIFIED on `claude/contact-deeplink-save-audit-5czfmi`.
> NOT MERGED; NOT DEPLOYED.**
>
> Rev 1 was the audit + proposal. Chris approved it with **D-1**, **D-2b**, **D-3**, **D-4**,
> **D-5 (revised wording)** and **D-6**, plus one **added** in-scope fix (`handleStatusChange`) and
> an explicit exclusion list. §0 records the approved scope; §E and §F are the as-built record;
> rev 1's audit findings (§C, §D) stand unchanged as the evidence base.
>
> **Repository:** `cgarness/agentflow-life-insure` · branch `claude/contact-deeplink-save-audit-5czfmi`
> · base `main` @ **`2cdc5b8`**.
>
> **NO migration, NO RLS change, NO RPC, NO Edge Function, NO schema change, NO Supabase MCP call of
> any kind, NO production data read or mutation, NO deployment.** Nothing under `supabase/` changed;
> `package.json` and `tsconfig*` are untouched.
>
> **Gates (baseline captured on the clean tree at `2cdc5b8` first, then re-run and diffed):**
> `npx tsc --noEmit` **exit 0** (vacuous — reported, never credited) · `npx tsc -p tsconfig.app.json
> --noEmit` **91 errors, error set byte-identical to baseline** · `npm run lint` **216 problems
> (15 errors, 201 warnings)** — identical · contact + pages + lib suites **48 files / 618 tests, all
> green** · full suite **3,150 passed / 1 failed / 14 skipped in 207 files** vs baseline **3,014 / 1
> / 14 in 201 files** — **+136 passing, ZERO new failures**, the one failure being the known
> pre-existing `recordingRetentionVoicemail.test.ts` v29 byte-identity check · `npm run build`
> **succeeded (15.9 s)**.
>
> **NEGATIVE CONTROL PASSED, in two parts.** The three modified source files were stashed and the new
> suites re-run against the unfixed tree: **47 of the new tests failed**. Two later correction passes were proven the same way: stashing the fail-closed organization guard alone failed exactly its one new test, and reverting the client/recruit post-save install alone failed 10 of the 16 tests in `contactsFullScreenSaveIntegrity.test.tsx` — exactly the stale-parent assertions. The route-race guard cannot
> be reproduced by the old code (which never installed a post-save row at all), so it was proven
> separately by deleting the four guard lines from the fixed handler — that failed **exactly** the two
> race tests and nothing else. Both controls were restored and re-run green. **The `mountedRef` check
> is defence-in-depth and is NOT independently proven by a failing test** (React 18 no longer warns on
> a setState after unmount).
>
> **BROWSER VERIFICATION WAS NOT PERFORMED AND IS NOT CLAIMED** — this session cannot load a Vercel
> preview. A human pass over `/leads/:id`, `/clients/:id`, `/recruits/:id` and the Contacts
> full-screen view is still owed.
>
> **This closes AGENT_RULES invariant #35 open follow-up (3)**, and records the resulting contract as
> **invariant #36**.

---

## §0. Approved scope (rev 2)

| # | Decision | Approved outcome |
|---|---|---|
| **D-1** | Lead deep-link duplicate parity | **APPROVED.** Same agency settings, same canonical policy, one implementation. |
| **D-2** | Client/recruit | **D-2b CHOSEN.** Duplicate checking for **lead, client AND recruit** on **both** `FullScreenContactView` surfaces — Contacts page *and* deep link. The existing full-screen hole is not a product rule to preserve. |
| **D-3** | Contacts-internal modal-vs-full-screen gap | **INCLUDE IT** — close it in this build, do not defer. |
| **D-4** | False success on a refused pre-save | **APPROVED, both places.** Shared refusal contract. `ContactSaveRefusedError` **does not exist on `main`** — it is **created deliberately** in this build, in the shared helper, and documented there. Add-modal boolean allow/refuse contract must **not** start throwing. |
| **+** | `handleStatusChange` save failure | **ADDED TO SCOPE by Chris.** Commit local status only after a successful update; on failure keep the old status, no activity, no success toast, a concise error toast, no unhandled rejection. No redesign of status/disposition behaviour. |
| **D-5** | AGENT_RULES invariant #36 | **APPROVED with Chris's revised, non-absolute wording** (reproduced in §I). Retire invariant #35 follow-up (3). |
| **D-6** | Branch + PR | Continue on `claude/contact-deeplink-save-audit-5czfmi`; push; **open a PR against `main`; DO NOT merge; DO NOT deploy.** Report PR number and exact head SHA. |

**Explicitly OUT of scope (Chris):** the unresolved-organization permanent spinner (log as a
follow-up only) · generalized optimistic locking / version predicates · whole-column `custom_fields`
architecture · reserved custom-field naming · the Additional Policies UI · the vacuous
typecheck-script repair · View As expansion · any telephony change · CSV/import duplicate behaviour
(**unchanged**).

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

## §E. Files to touch (rev 2 — approved scope)

### Source (4 files)

1. **`src/lib/contactSavePolicy.ts`** *(NEW — the one shared contact-save/duplicate helper)*
   - **`ContactSaveRefusedError`** — **created in this build. It does NOT exist on `main`.** It marks
     a save that was **refused before any database write** (agency policy blocked it, or the user
     cancelled the duplicate warning) as distinct from a save that **failed**. It carries
     `reported: boolean` (default `true`) meaning *"the refusing surface has already told the user
     why"*, so the catching UI does not report it a second time. Both meanings are documented on the
     class itself. `isContactSaveRefusedError()` is exported alongside it and matches by
     `instanceof` **or** `name`, so it survives module duplication in a bundle.
   - **`evaluateContactDuplicatePreSave()`** — the one duplicate **policy**: reuses `findDuplicates`
     and `describeDuplicate`, scopes by `organization_id`, honours `DuplicateRule`,
     `DuplicateScope`, `ManualAction` and `excludeId`, and **returns a decision**
     (`allow` | `block` | `confirm`) — it renders nothing and toasts nothing. A lookup failure keeps
     the **existing documented fail-open posture** (`{ kind: "allow" }`, `Contacts.tsx:1543-1546`).
   - **`payloadTouchesPhoneOrEmail()`** — the shared gate, byte-equivalent to
     `Contacts.tsx:1639`'s `data.phone !== undefined || data.email !== undefined`.
   - `src/lib/contactDuplicateDetection.ts` is **not modified** — it is reused, not replaced, and no
     second duplicate query or policy is written anywhere.

2. **`src/pages/ContactDeepLinkPage.tsx`** — the primary fix.
   - Delete the pre-update `SELECT` (`:87-95`) entirely. **No pre-update SELECT, no redundant
     post-update SELECT.**
   - `await` the canonical `update()` and **capture** the returned row.
   - Install it **only when the request is still current**: still mounted **and** route `id` still
     equals the saved id **and** `contactType` still matches **and** this is still the newest save
     (monotonic token). Any check failing → return without touching state. The save is already
     durably committed; only the local echo is dropped. **A committed save for contact A can finish
     after navigation, but it can never repaint contact B as A.**
   - Never `catch` the update — the rejection must keep reaching
     `FullScreenContactView.handleSave` (PR #376 posture preserved).
   - Duplicate pre-save for **all three** types (D-2b), gated by `payloadTouchesPhoneOrEmail`, with
     agency settings lazily loaded at save time and memoised per organization — so a deep link that
     is only **read** costs **zero** extra queries.
   - A `block` decision toasts the same message the Contacts surface toasts, then throws a
     `reported` `ContactSaveRefusedError`; a cancelled `confirm` throws the same sentinel with no
     extra toast (the dialog the user just cancelled *was* the message). Identical UX to Contacts.
   - Refs are assigned during render (`currentIdRef.current = id`) — the pattern this component tree
     already uses (`FullScreenContactView.tsx:245-246`). No `StrictMode` in this app
     (`src/main.tsx`), and the mounted ref is additionally re-armed in an effect so it is
     StrictMode-safe anyway.

3. **`src/pages/Contacts.tsx`**
   - `enforceContactPreSave` keeps its **boolean** allow/refuse contract and its existing toast +
     dialog exactly as today (**add-modal flows are unchanged and must not start throwing** — D-4),
     but its duplicate half now delegates to `evaluateContactDuplicatePreSave`, so the policy is
     stated once.
   - `handleUpdateLead`: the refusal becomes a **rejection** (`ContactSaveRefusedError`, `reported`),
     raised **before** the try block so the existing catch cannot swallow it. Gate switched to the
     shared `payloadTouchesPhoneOrEmail`.
   - **`handleUpdateLead` no longer swallows a genuine update failure either.** Independently
     confirmed in the audit: `Contacts.tsx:1661-1664` catches, toasts and **resolves**, so
     `FullScreenContactView` exits edit mode, clears the dirty flags, writes a *"details updated"*
     activity and toasts *"Lead updated successfully"* **for a write that failed**. That is the exact
     violation D-5's new invariant forbids, on a surface this build is editing, so it is fixed here:
     the handler rejects and each caller reports once. Its three call sites are updated accordingly
     (`:2132` fire-and-forget gets a `.catch` that toasts; `:3198` edit modal gets a `try/catch` that
     toasts and **keeps the modal open** instead of closing it and discarding the user's edits;
     `:3243` `FullScreenContactView` already handles rejections). *Reported explicitly in the
     handoff as the one behavioural change beyond the literal decision list.*
   - **NEW `handleUpdateClient` / `handleUpdateRecruit`** replace the two inline arrow `onUpdate`
     props at `:3253` and `:3265`, adding the duplicate pre-save (**D-2b**) and the same refusal
     contract. This is also what closes **D-3**: after this build the agency's duplicate settings
     apply to an ordinary full-record client/recruit edit from the full-screen view exactly as they
     already do from the Add/Edit modals.

4. **`src/components/contacts/FullScreenContactView.tsx`**
   - `handleSave`'s catch (`:668-675`) recognises `ContactSaveRefusedError`: no second toast when
     `reported`, and in every case edit mode stays open, the typed values and the dirty flags
     survive, **no** activity row is written and **no** success toast fires. Non-refusal errors keep
     PR #376's behaviour byte-for-byte.
   - **`handleStatusChange` (`:599-608`) — the added in-scope fix.** Close the dropdown, attempt the
     authoritative `onUpdate`, and commit `localStatus` / `editForm.status` **only after it
     succeeds**. On failure: the old status stays on screen and in the form, no activity row, no
     success toast, one concise error toast, and no unhandled rejection. (The status dropdown renders
     only for `type !== "client"` — `:898` — so this is the lead and recruit path; both map `status`
     in their canonical `update()`.) No other status/disposition behaviour changes.

### Docs (3 files)

5. **`AGENT_RULES.md`** — new invariant **#36** in Chris's approved wording (§I), and invariant #35's
   open follow-up **(3)** marked retired.
6. **`implementation_plan.md`** — this document.
7. **`WORK_LOG.md`** — one new entry, newest first (AGENT_RULES §9).

**Nothing under `supabase/` is touched. `package.json` and `tsconfig*` are not touched.**

---

## §F. Tests (rev 2 — approved scope)

Every new test is **fail-first proven** against the unmodified tree, and the negative-control result
is recorded. Harness conventions are copied from
`src/pages/__tests__/contactDeepLinkQuickCall.test.tsx` (chainable Supabase stub, hoisted
`h.routeId` for `useParams`, the context mocks) and
`src/components/contacts/__tests__/fullScreenContactViewSaveFailure.test.tsx`.

**1. `src/lib/__tests__/contactSavePolicy.test.ts`** *(pure)* — every `DuplicateRule`, both
`DuplicateScope`s, all three `ManualAction`s, `excludeId`, the lookup-failure fail-open posture, the
phone/email gate, and the `ContactSaveRefusedError` / `isContactSaveRefusedError` contract including
the `reported` flag.

**2. `src/pages/__tests__/contactDeepLinkSaveIntegrity.test.tsx`** *(real page + real
`FullScreenContactView`)* — ordering (no pre-update SELECT) · the returned row becomes the parent so
Quick Call dials the **new** phone and the header shows the **new** name · SMS/email target the new
values · **the full lost-update sequence** (save `2222`, Edit, **Cancel**, edit Notes, Save → the
second UPDATE carries `2222`) · server-normalized values win · assigned-agent change · **late
response for A does not repaint B** · unmount mid-save · superseded save ignored · rejected update
leaves the parent unchanged with edit mode open, no success toast and no activity · exactly one
write and zero extra reads per save · all three contact types.

**3. `src/pages/__tests__/contactDeepLinkDuplicateParity.test.tsx`** *(real page + real
`FullScreenContactView`)* — for **lead, client and recruit**: `block` → zero UPDATEs, still editing,
no success toast, no activity, the block reason shown · `warn` + **cancel** → zero UPDATEs, still
editing, no success toast, no activity · `warn` + **confirm** → exactly one canonical UPDATE ·
`allow` → one UPDATE, no prompt · no match → one UPDATE, no prompt · lookup failure → save proceeds
(documented fail-open) · `excludeId` is the contact's own id so a contact never flags itself · a
`{ status }`-only update runs **no** duplicate lookup.

**4. `src/pages/__tests__/contactsFullScreenDuplicateParity.test.tsx`** *(real `Contacts` page,
`FullScreenContactView` stubbed to a recorder that invokes the captured `onUpdate`)* — the same
matrix for **lead, client and recruit** on the Contacts surface, asserting the duplicate query args
(table, `excludeId`, rule/scope), that a refusal **rejects** with `ContactSaveRefusedError` rather
than resolving, and that `block` / `warn`+cancel issue **zero** canonical UPDATEs while
`warn`+confirm / `allow` issue exactly one. Plus: the **Add** and **Edit modal** flows still use the
boolean contract and are not regressed.

**5. `src/components/contacts/__tests__/fullScreenContactViewStatusSave.test.tsx`** *(real
component)* — **rejected** status change: old status still displayed, form status unchanged, no
activity written, no success toast, one error toast, no unhandled rejection. **Successful** status
change: the new status is displayed, the activity is written **once**, success toasted **once**.

**6. `src/components/contacts/__tests__/fullScreenContactViewSaveFailure.test.tsx`** *(existing,
extended)* — a `ContactSaveRefusedError` from `onUpdate` keeps edit mode open, keeps the typed
values and the dirty state, writes no activity, shows no success toast, and shows **no second toast**
when `reported`. The existing seven tests stay green unchanged.

**Non-regression:** the existing PR #376 save-error suite and
`fullScreenContactViewAdditionalPolicies.test.tsx` must stay green, and the full suite must show
**zero new failures** against the §J baseline.

---

## §G. Migrations / backend

**NONE.** No migration file, no `apply_migration`, no RPC, no RLS policy, no Edge Function, no
`execute_sql`, no Supabase MCP call of any kind, no production read and no production write. Every
API, helper and settings row this build uses is already live. CSV/import duplicate behaviour is
**unchanged**.

---

## §H. Security and scope posture

- **The initial deep-link fetch is unchanged**: `select("*")` · `.eq("id", id)` ·
  `.eq("organization_id", organizationId)` · `.maybeSingle()` · RLS
  (`ContactDeepLinkPage.tsx:60-65`). The explicit org filter stays as defence-in-depth.
- **View As stays fail-closed and is not touched.** `AppLayout.tsx:34` blocks any path not in
  `viewAsSurfaces.ts`'s exact-match allow-list (`:57` — only `/conversations` and `/contacts`), so
  the deep-link routes never mount while impersonating. No line of `viewAsSurfaces.ts`,
  `AppLayout.tsx` or the allow-list changes.
- **Permissions are unchanged.** `PageGuard pageName="Contacts"` on all three routes
  (`App.tsx:134-136`); `FullScreenContactView` independently gates Edit/Delete on
  `contacts.<type>.edit` / `.delete` (`:186-189`). No new capability is added.
- **Cross-contact contamination is closed, not opened** — the new guard is what stops a late
  response for contact A writing into contact B.
- **Round-trip budget improves.** Per save: today `1 SELECT + 1 UPDATE`; after, `1 UPDATE` (plus,
  only when phone/email is in the payload, the duplicate lookup and a per-organization-memoised
  settings read). A deep link that is only **read** costs **zero** extra queries.
- The duplicate lookup is org-scoped by construction (`contactDuplicateDetection.ts:63`) and
  RLS-governed; it is the same query `Contacts.tsx` already runs.

---

## §I. Approved decisions (recorded verbatim in effect)

**D-1 — APPROVED.** Duplicate-detection parity on the lead deep-link path, using the same agency
settings and the same canonical policy. No second implementation.

**D-2 — D-2b CHOSEN.** Duplicate checking for **lead, client and recruit** on **both** comparable
`FullScreenContactView` surfaces (Contacts page and deep link). The existing full-screen hole is an
enforcement gap, not a product rule. The "only when phone/email is being saved/changed" gate is
kept. **CSV duplicate behaviour is not altered.**

**D-3 — INCLUDED.** The Contacts-internal modal-vs-full-screen gap for clients/recruits is closed in
this build, not deferred. End state: one consistent manual-edit duplicate policy across the relevant
Contacts editing surfaces.

**D-4 — APPROVED, both places.** A blocked duplicate, or a user cancelling the duplicate warning,
must never resolve to `FullScreenContactView` as a success. Required result: edit mode open · typed
values intact · dirty state intact · no success toast · no *"details updated"* activity · no database
UPDATE · the user sees the block/warning outcome. Shared refusal contract.
**`ContactSaveRefusedError` does not exist on `main` and is created deliberately in this build**, in
`src/lib/contactSavePolicy.ts`, with its purpose documented on the class. The shared evaluator
returns a **decision**; update surfaces translate a refusal into the sentinel. **Add-modal flows keep
their boolean allow/refuse contract and do not throw.**

**Added to scope — `handleStatusChange`.** As specified in §E item 4.

**D-5 — APPROVED, revised wording.** AGENT_RULES invariant **#36**:

> *A contact save surface must treat the canonical update API's returned row as the authoritative
> post-save contact whenever that API returns the complete saved record. Do not install pre-save
> state or issue redundant re-reads when the canonical update already returns the complete row.
> Async save results may update local contact state only when the component is still mounted, the
> route/contact identity still matches, and the result is from the newest applicable request. A
> failed or user-refused save must never resolve to the calling UI as a successful save.*

> *Manual duplicate-detection settings apply consistently to ordinary Lead, Client, and Recruit
> full-record edits across the Contacts `FullScreenContactView` and direct deep-link surfaces.*

Invariant #35 follow-up **(3)** is retired once this ships.

**D-6 — Branch + PR.** Continue on `claude/contact-deeplink-save-audit-5czfmi`; push; open a PR
against `main`; **do not merge**; **do not deploy**. Report the PR number and the exact head SHA.

---

## §J. Verification plan

Baselines captured on the **clean tree at `2cdc5b8`** before any edit; each gate is re-run and
**diffed**, not merely re-reported.

| Gate | Baseline at `2cdc5b8` |
|---|---|
| `npx tsc --noEmit` (the AGENT_RULES §8 gate) | **exit 0** — and **vacuous**: root `tsconfig.json` is solution-style (`"files": []`), so it checks zero files. Reported, never credited (invariant #35). |
| `npx tsc -p tsconfig.app.json --noEmit` (the meaningful one) | **91 errors**. The error **set** is diffed, not just the count. |
| `npm run lint` | **216 problems (15 errors, 201 warnings)**. |
| `npm run test` | **3,014 passed / 1 failed / 14 skipped** across **201 files**. The one failure is the known pre-existing `recordingRetentionVoicemail.test.ts` v29 byte-identity check. |
| `npm run build` | **succeeded (16.7 s)**. |

*(This container had no `node_modules` and no `VITE_SUPABASE_*` env, which made 11 test files fail to
**collect** with `supabaseUrl is required`. After `npm ci` and a **gitignored** local `.env.local`
carrying the public project URL from AGENT_RULES §2 and a dummy anon key, the suite reproduces the
documented baseline exactly. No real credential is involved; `.gitignore:30` covers the file.)*

**Negative control (required).** The changed source files are stashed and the new suites re-run
against the unfixed tree, proving failure for at least: pre-update stale parent · Quick Call using
the old phone/name · second-save stale-value reversion · late A response replacing B ·
client/recruit duplicate enforcement gap · false success after a duplicate refusal · rejected status
change leaving an unsaved status visible. The implementation is then restored and the suites re-run
green.

Also before handoff: a diff scan for `service_role`, secrets, Telnyx, `.single()` regressions, mock
data, and any change under `supabase/` or to `package.json` / `tsconfig*`; and `git diff --check`.

**Browser verification is NOT claimed** — this session cannot load a Vercel preview, so a human pass
over `/leads/:id`, `/clients/:id`, `/recruits/:id` and the Contacts full-screen view remains owed.

---

## §K. Out of scope — logged as separate follow-ups

Per Chris's exclusion list, plus findings the audit confirmed that are **not** save-integrity
defects and are **not** fixed here:

1. **Unresolved-organization permanent spinner** (`ContactDeepLinkPage.tsx:42`) — real, logged only.
2. **Unsaved-edit loss on same-route navigation** (`/leads/A → /leads/B` re-enters the loading
   early-return and unmounts `FullScreenContactView`, destroying typed input; the only guard,
   `tryClose` at `:684-687`, is bound solely to the header back button at `:874` — no router
   blocker, no `beforeunload`). Confirmed; needs a router-blocker design of its own.
3. **Double `navigate(-1)` on delete** — `handleDelete` (`:106`) pops history and
   `FullScreenContactView:1377` then calls `onClose()` (`:148`), which pops again. Confirmed;
   one-line fix, but an unrequested behaviour change, so reported rather than shipped.
4. **`activitiesSupabaseApi.add` at `FullScreenContactView.tsx:678` sits outside the save
   `try/catch`** — a throw there happens after edit mode has already closed and escapes unobserved.
5. **`onConvert` is not passed on the deep-link mount** (`:144-151`), so the Convert button never
   renders on `/leads/:id` and `ConvertLeadModal` is mounted permanently closed.
6. **`.single()` vs `.maybeSingle()`** in the three canonical `update()` methods — here `.single()`
   is fail-closed and desirable; deliberately left alone.
7. Chris's standing exclusions: generalized optimistic locking / version predicates · whole-column
   `custom_fields` architecture · reserved custom-field naming · Additional Policies UI · the
   vacuous typecheck script · View As expansion · telephony.

**Invariant #35 follow-up (3) is what this build closes.**
