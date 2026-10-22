# BUGFIX — Standardize carrier selection in Record Policy and Add/Edit Client

**Status:** APPROVED by Chris on 2026-10-22 for branch-only implementation (§8). IMPLEMENTED in `2bd6404` and verified
(`verification.md`). Draft PR for review. Not approved for merge or release.

**Implementation notes beyond §8.**
- **Reload on every open.** The hook clears its result on each open or retry, so a carrier removed between two opens
  can't be picked from the earlier list.
- **"No carrier" option, Add/Edit Client only.** This keeps the old ability to clear a carrier where blank is
  already allowed.
- **Saved-value tag on its own line.** The "(not in Settings)" tag sits on a helper line under the trigger, linked
  by `aria-describedby`. The half-width column truncated it out of view inside the trigger.
- **Settings link opens a new tab.** An in-progress sale or dialer disposition is never lost.
**Branch:** `claude/carrier-selection-standardize-emoz7q`. Refreshed against `main` `1a7ea7a` (PR #477) by merge
`f871409`; both sets of document entries kept.

---

## 1. Pre-flight

- Read `AGENT_RULES.md` (§3 multi-tenancy, §7 component standards, §8 workflow, §10 forbidden patterns, the Phase 1
  commission-preview paragraph and the Phase 2A saved-commission section), `VISION.md` and the latest `WORK_LOG.md`.
- **Main:** the branch is level with `origin/main` `c3f4a27` (PR #475).
- **Work log:** the newest entries cover PR #475 (Leaderboard layout) and Lead → Client preservation (PR #476, merged;
  migration `20261021200000` not applied). Neither touches the carrier inputs in either modal.
- **Open PRs:** none of the 15 open PRs touches `RecordPolicyModal.tsx`, `AddClientModal.tsx` or the carrier
  queries. #477 and #473 are Commissions navigation and icon changes only. No conflict expected.

## 2. Current behavior (the bug)

| Surface | Carrier control today |
|---|---|
| `ConvertLeadModal.tsx:117-147, 326-342` | Native `<select>` from `public.carriers` (`organization_id = useOrganization().organizationId`, ordered by name). "Select carrier…" placeholder, a "Loading carriers…" state, a toast on error, and a hint when empty. No retry. |
| `RecordPolicyModal.tsx:74-78` | Free-text `<input>`. Zod only checks that it is non-blank. |
| `AddClientModal.tsx:142-145` (create **and** edit; also opened from `FloatingDialer`) | Free-text `<input>`. `clientSaleFormSchema` requires a carrier only when the save records a new sale. |

So a typo or a variant name ("Mutual of Omaha " / "MOO") is saved as the policy carrier. The commission estimate
matches carriers by exact trimmed, case-insensitive name, so a variant name also quietly produces no estimate.

`public.carriers` RLS (`carriers_select`) already limits reads to `organization_id = get_org_id()` or Super Admin.
`carriers_org_lower_name_unique` guarantees one name per organization, case-insensitively. **No schema change is
needed.**

## 3. Proposed design

### 3.1 Shared data hook: `src/hooks/useOrganizationCarriers.ts` (new, about 60 lines)

- Reads `supabase.from("carriers").select("name").eq("organization_id", organizationId)`. The explicit org filter is
  the same one ConvertLeadModal uses; RLS still applies. For a Super Admin it keeps the list on the home or resolved
  organization rather than every organization's carriers.
- Names are trimmed, blanks dropped, de-duplicated case-insensitively, and sorted with
  `localeCompare(…, { sensitivity: "base" })`. Server `ORDER BY name` is case-sensitive, so the client sort is
  authoritative.
- Returns `{ status: "idle" | "loading" | "ready" | "error", carriers: string[], retry() }`.
- Fetches only while `enabled` (the modal is open) and an `organizationId` exists. A request token discards stale
  responses, so a previous organization's list can never show after the organization changes, and nothing is
  cached across organizations.
- No TanStack Query. Neither modal's existing tests mount a `QueryClientProvider`. This matches the current
  ConvertLeadModal pattern.

### 3.2 Pure helpers: `src/lib/carrierSelection.ts` (new, about 40 lines)

- `carrierOptions(configured, current)` returns the configured list, plus the current value as a **preserved
  historical option** when it is non-blank and has no case-insensitive trimmed match in the list.
- `carrierSelectionSchema(allowed, preserved?)` is a Zod schema. The value must be blank (the caller decides whether
  blank is allowed) or **exactly** one of `allowed`, or the exact `preserved` value. Anything else fails with
  "Choose a carrier from Settings → Carriers". This is the guard against arbitrary names, so the server payload can
  never carry a typed name from these controls.

### 3.3 UI: `src/components/shared/CarrierCombobox.tsx` (new, under 150 lines)

Popover plus cmdk `Command`, following the existing `StateSelector.tsx` pattern. Tailwind only.

- **Trigger:** `role="combobox"` button, labelled by the field label. With no value it shows **"Select carrier…"**.
  It never auto-selects, even when only one carrier exists.
- **Search:** `CommandInput` ("Search carriers…"). Arrow keys, Enter and Escape come from cmdk, and filtering is
  case-insensitive. Items appear alphabetically.
- **No free entry:** there is no "create" item. A search with no match shows "No matching carrier."
- **Historical value:** a value not in Settings shows in the trigger as `<name> (not in Settings)`. It also appears
  as the first list item, in its own group "Saved carrier", so it stays selected and is saved unchanged unless the
  user picks another carrier. It is never replaced silently. A case-variant match ("aetna" stored, "Aetna"
  configured) also stays exactly as stored until the user picks.
- **States:**
  - **Loading:** a disabled trigger reading "Loading carriers…" with a spinner. A preserved value still displays.
  - **Empty:** a disabled trigger plus "No carriers are set up yet. Add them in **Settings → Carriers**", with a
    link to `/settings?section=carriers` (the link closes the modal first). Users without access see the existing
    Settings access screen.
  - **Error:** "Couldn't load carriers." with a **Retry** button that calls `retry()`. If the client already has a
    carrier, it is shown and kept, so an edit unrelated to the policy can still be saved.
- The control is a button, not an `<input>`, so form `required` does not apply. Validation stays in Zod.

### 3.4 `RecordPolicyModal.tsx` (96 → about 105 lines)

- Remove `carrier` from the generic text-input loop and render `CarrierCombobox` in its place, with the same label
  and position.
- `policySchema` keeps `carrier: min(1, "Choose a carrier")`. Before parsing, `submit` also checks
  `carrierSelectionSchema(carriers)` with no preserved value, because this modal always records a new policy.
- The form still resets carrier to `""` on every open. `PolicyCommissionEstimate` still receives `form.carrier`, so
  the estimate recalculates on every change exactly as it does today.
- Submit is disabled while carriers are loading. The payload shape to `recordClientPolicyHandoff` is unchanged.

### 3.5 `AddClientModal.tsx` (226 lines, already over the limit; net change about 0)

- Replace the carrier `<input>` with `CarrierCombobox`, using `preserved = initial?.carrier`.
- **Edit:** `form.carrier` starts from `initial.carrier` exactly as now, so the stored value is pre-selected (or shown
  as historical).
- **Validation:** `handleSubmit` runs `carrierSelectionSchema(carriers, initial?.carrier)` alongside the unchanged
  `clientSaleFormSchema`. The existing "A new sale requires a Sold Date and carrier" rule is untouched. A blank
  carrier on a non-sale edit stays allowed, as today.
- **Load failure on edit:** if carriers fail to load and the carrier is unchanged, the save is allowed. Only a
  changed carrier needs a loaded list. This keeps unrelated edits (phone, email) working during an outage.
- `ClientSaleCommissionPanel` keeps reading `form.carrier`. `clientSaleRecordsPolicy`, `onSave` and the
  sale/commission payloads are unchanged.
- To avoid growing the file, the carrier block becomes one JSX element. No other refactor.

### 3.6 Out of scope (unchanged)

- Commission formulas, the calculator engine, grid matching, `PolicyCommissionEstimate` and
  `ClientSaleCommissionPanel` internals.
- Sale RPCs, payloads, receipts, wins, reporting, and existing client, policy or commission records.
- No backfill or normalization of stored carrier names.
- `ConvertLeadModal.tsx` (see decision D1). The Full-Screen Contact View additional-policy editors and CSV import.
- No migration, RLS, Edge Function or deployment.

## 4. Files

**New**
- `src/hooks/useOrganizationCarriers.ts`
- `src/lib/carrierSelection.ts`
- `src/components/shared/CarrierCombobox.tsx`
- `src/lib/__tests__/carrierSelection.test.ts`
- `src/components/shared/__tests__/carrierCombobox.test.tsx`

**Modified (app)**
- `src/components/contacts/RecordPolicyModal.tsx`
- `src/components/contacts/AddClientModal.tsx`

**Modified (tests; carrier is no longer a text input, so the `fireEvent.change(getByLabelText("Carrier"))` fills
become a combobox pick)**
- `src/components/contacts/__tests__/recordPolicyModal.test.tsx`
- `src/components/contacts/__tests__/addClientSale.test.tsx`
- `src/components/contacts/__tests__/policyCommissionHandoffModals.test.tsx` (Add Client / Record Policy parts only)
- `src/components/contacts/__tests__/policyCommissionPreviewModals.test.tsx` (Add Client / Record Policy parts only)
- Any `src/pages/__tests__/contacts*.test.tsx` that types into the client carrier field, found by running the suite.
  The fills change; the assertions do not.

**Docs**
- `WORK_LOG.md` (newest-first entry), `implementation_plan.md` (root entry), this plan.
- `AGENT_RULES.md`: one invariant line. These two modals take carriers only from `public.carriers`; historical
  values are preserved, never rewritten.

## 5. Verification plan

- **Unit (`carrierSelection`):** sort and de-duplication; historical option shown or hidden, with case-variant
  matches; the schema rejects free text and accepts a configured name or the exact preserved value.
- **Component (`CarrierCombobox`):**
  - The placeholder shows and nothing is auto-selected, including with a single carrier.
  - Typing filters, Arrow/Enter selects and Escape closes.
  - There is no create option.
  - Loading, empty (with a Settings link) and error-with-Retry states (Retry refetches).
  - The historical label is shown.
  - Organization A → B changes the list and drops a stale A response.
- **Modals:**
  - Record Policy: blocks submit with no carrier; saves the picked carrier; payload identical to today's shape;
    the estimate updates when the carrier changes (North → South product list).
  - Add Client:
    - Create requires a carrier for a sale.
    - Edit pre-selects the stored carrier.
    - Edit with a removed carrier shows "(not in Settings)" and saves the stored value byte-for-byte.
    - An unrelated edit saves while the carrier request fails.
    - The commission panel is unaffected.
- **Regression:** existing sale, commission-capture and handoff suites pass with only the carrier-fill helper
  changed (receipt, request id and payload assertions untouched).
- `npx tsc --noEmit` (root and app configs, compared against the `main` baseline of 84 app errors), targeted Vitest,
  ESLint on touched files, `npm run build`.
- **Browser:** a Vite preview check of keyboard search and the three states on mocked responses, with screenshots.
  No production writes. A signed-in multi-organization smoke test needs a real account and is reported as not done
  unless Chris provides one.

## 6. Decisions for Chris

- **D1 — ConvertLeadModal.** Recommended **(A)**: leave it on its working native `<select>` for this fix. (B) would
  switch it to `CarrierCombobox` too, for full consistency. That touches a 518-line modal and the multi-row
  commission tests.
- **D2 — Historical values.** Recommended: keep the stored name exactly and label it "(not in Settings)". The
  alternative is to require re-selection on save, which would block unrelated edits.
- **D3 — Edits while carriers fail to load.** Recommended: allow the save when the carrier is unchanged, and require
  a loaded list only when the carrier changes.

## 8. Approval (2026-10-22) and amendments

**Decisions.**
- **D1:** ConvertLeadModal is unchanged.
- **D2:** the client's exact stored carrier, including case and whitespace, stays until the user explicitly selects a
  replacement. "(not in Settings)" shows only when no configured carrier matches it trimmed and case-insensitively.
  A case or whitespace variant of a configured carrier displays exactly as stored, with no tag.
- **D3:** an unrelated edit saves while the carrier list is loading or failed, as long as the carrier is unchanged.
  A new or changed nonblank carrier must come from the list loaded successfully for the current user and agency.

**Requirements and how they are met.**
1. **Frozen retry.** On a frozen submission, both modals skip the carrier-list check and the Submit button never
   waits on the list. The frozen request is replayed by `usePolicySaleSubmission`, reusing the request id and the
   frozen payload unchanged. This is the same rule `Contacts.tsx:1974` already applies to its pre-save checks.
   Regression tests cover a carrier list that fails, and a carrier that is removed, between the unknown-outcome
   attempt and the retry.
2. **Isolation.**
   - The hook stores the scope key (`user|organization`) each result belongs to. A result for any other key reads
     as `loading`, so a previous scope's list can neither display nor validate.
   - Late responses are discarded with a request counter.
   - The historical exception is the `preserved` prop: `initial.carrier` of the client being edited, compared
     exactly. It is never derived from search text or the current selection.
   - Items use opaque cmdk values plus a keyword filter, so a case-variant saved value and its configured
     counterpart never collide.
3. **Locking.** `disabled` (form locked or saving) disables the trigger, closes an open dropdown and makes
   `onSelect` a no-op. The trigger and Retry are `type="button"`. The popover is `modal`, so wheel scrolling works
   inside the Radix Dialog. Its layer is `z-[1100]`, above the floating dialer (`z-[1000]`/`z-[1001]`) and the Add
   Client overlay (`z-[200]`).
   **Correction:** the floating dialer mounts **Record Policy** (`FloatingDialer.tsx:780`), not Add Client. Add Client
   is mounted only by `Contacts.tsx` (add and edit). Both paths are checked in the browser. No telephony code
   changes.
4. **Form semantics.** Carrier stays optional except where `clientSaleFormSchema` (a new sale) or Record Policy (always
   a sale) already requires it. Nothing is auto-selected and no typed carrier can be created.

**Exact files.**
- New:
  - `src/hooks/useOrganizationCarriers.ts`
  - `src/lib/carrierSelection.ts`
  - `src/components/shared/CarrierCombobox.tsx`
  - `src/lib/__tests__/carrierSelection.test.ts`
  - `src/hooks/__tests__/useOrganizationCarriers.test.tsx`
  - `src/components/shared/__tests__/carrierCombobox.test.tsx`
  - `src/test/carrierComboboxTestUtils.ts` (pick helper and jsdom stubs for cmdk)
- Modified, app: `src/components/contacts/RecordPolicyModal.tsx`, `src/components/contacts/AddClientModal.tsx`.
- Modified, tests (only the carrier fills change, plus new cases):
  - `src/components/contacts/__tests__/recordPolicyModal.test.tsx`
  - `src/components/contacts/__tests__/addClientSale.test.tsx`
  - `src/components/contacts/__tests__/policyCommissionHandoffModals.test.tsx`
  - `src/components/contacts/__tests__/policyCommissionPreviewModals.test.tsx`
- Docs: `WORK_LOG.md`, `AGENT_RULES.md`, root `implementation_plan.md`, this plan, and a new `verification.md` beside it.
- Not touched: `ConvertLeadModal.tsx`, `FloatingDialer.tsx`, `Contacts.tsx`, commission and sale libraries, and
  Supabase.

## 7. Migrations / deploys

None proposed. If one became necessary, I would stop and propose it separately.
