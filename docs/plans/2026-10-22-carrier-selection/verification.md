# Verification — carrier selection in Record Policy and Add/Edit Client

**Branch:** `claude/carrier-selection-standardize-emoz7q`. **Code commit:** `2bd6404`. **Base:** `main` `1a7ea7a`,
merged in by `f871409`.
**Scope:** branch only. No Supabase command or query, no migration, RLS, Edge Function or Vercel action, no merge
or release.

## 1. Automated checks

Baselines were taken on `main` `1a7ea7a`, in a separate worktree, before any app file changed.

| Check | `main` `1a7ea7a` | Branch | Result |
|---|---|---|---|
| Root `npx tsc --noEmit` | exit 0 | exit 0 | same |
| App `npx tsc --noEmit -p tsconfig.app.json` | 84 errors | 84 errors, identical lines | none in touched files |
| Full Vitest | 10 failing files, 1 failing test | the same 10 files and the same test | see §1.1 |
| ESLint on the 13 touched code and test files | — | exit 0 | clean |
| `npm run build` | — | exit 0 | pass |
| `git diff --check` | — | clean | pass |

### 1.1 Full Vitest: pre-existing failures

The failing set on this branch is byte-identical to `main`'s. None of the files is touched or imported by this
change:
- `addLeadAssignmentGate`
- `dialerCampaignPresenceHook`
- `contactName`
- `contactScope`
- `leadDisposition`
- `recordingRetentionVoicemail` (the one failing test: "byte-identical to deployed v29")
- `userLocalDayBounds`
- `caller-id-selection`
- `runtimeEventLogger`
- `custom-fields-settings`

The final run on `2bd6404` is recorded in the work log entry.

### 1.2 Focused suites

| Suite | What it covers |
|---|---|
| `src/lib/__tests__/carrierSelection.test.ts` (new) | Sort and case-insensitive de-duplication. Preserved option: removed carrier flagged; case/whitespace variant kept exactly and unflagged; unflagged while the list is unavailable. Zod check: exact names only; exact preserved value only; loaded list required for any new or changed carrier. |
| `src/hooks/__tests__/useOrganizationCarriers.test.tsx` (new) | Idle without a user or agency. An organization-scoped `carriers` read. Error and Retry. Previous agency never shown, including on the render before effects run. Late responses discarded in either order. A superseded retry ignored. A user switch is a new scope. Every reopen reloads. |
| `src/components/shared/__tests__/carrierCombobox.test.tsx` (new) | Placeholder with no auto-select (single carrier too). Trigger and Retry are `type="button"` and never submit the form. Alphabetical list. Typed search; Enter and arrow-key selection; focus on open. No create option: an unmatched search plus Enter changes nothing. Saved option scoped to `preserved` only. Loading, empty (link plus refresh) and error-with-Retry states. Disabled closes, ignores selection and stays closed when re-enabled. Clear only where allowed. |
| `recordPolicyModal.test.tsx` | The 4 existing tests, plus 6 new ones (below). |
| `addClientSale.test.tsx` | The 3 existing tests, plus 7 new ones (below). |
| `policyCommissionHandoffModals` / `policyCommissionPreviewModals` | Every existing assertion unchanged; only the carrier fill now picks from the combobox. New: changing North → South switches the estimate's product list, clears the stale estimate and saves South. |
| `convertLeadModalPolicyFields`, `contactsClientSaleHandoff`, `redundantDialogDescriptions`, `fullScreenContactView{SaveFailure,AdditionalPolicies}` | Regression only, unchanged. |

New Record Policy tests:
- No auto-select, a carrier is required, and the saved payload has the exact picked carrier.
- A save is rejected when the list is not loaded for the current agency.
- **Frozen retry** (×3: list failed / loading / carrier removed): the retry replays the same frozen object with the
  same request id and identical arguments.
- Locking closes an open dropdown and disables the picker.

New Add/Edit Client tests:
- **Frozen retry** across a carrier removal and then a failed list: the same frozen object, request id, commission
  payload and form, with no validation toast.
- Edit pre-selects the stored carrier.
- A removed carrier is kept byte-for-byte (trailing space) and tagged.
- A case/whitespace variant is kept exactly, with no tag.
- An unrelated edit saves while the list fails.
- A changed carrier is rejected once the list is not loaded.
- Replace, clear and restore a saved carrier.

### 1.3 Mutation checks

Each guard was removed in turn and the relevant suite re-run.

**Caught (11):**
- the frozen-retry skip in Record Policy;
- the frozen-retry skip in Add Client;
- the D3 preserved exception;
- the scope tag;
- the stale-request discard;
- reload on every open;
- close-on-disable;
- the Record Policy list check;
- the Add Client list check;
- the trimmed, case-insensitive "not in Settings" match.

**Not caught (1):** the `if (disabled) return` guard in `select`. It cannot be reached: a disabled picker's dropdown
unmounts before a click can land, and its items are also disabled. It is kept as the explicit "selection handlers
disabled" safeguard the approval asked for.

## 2. Browser checks (synthetic fixtures)

**Setup.** A throwaway Vite harness lived only in the session scratchpad, never under `src/`.
- It mounts the real `RecordPolicyModal`, `AddClientModal` and `CarrierCombobox`, with the app's Tailwind and
  components.
- It uses a fake Supabase client: synthetic carriers for `org-synthetic-a` (27 names, mixed case) and
  `org-synthetic-b` (1 name); every other read is empty and every RPC fails closed.
- The floating-dialer layer was **simulated**: a fixed panel with the floating dialer's exact position and
  `z-[1000]` classes, mounted beside Record Policy as `FloatingDialer.tsx:780` does. The real `FloatingDialer` was
  not mounted (it needs telephony). No telephony code was changed.
- Run with Playwright and Chromium (headless shell 1194): 1280×800 and 390×800, dark theme.

**Results: 30/30 PASS, no page errors.**

| # | Check |
|---|---|
| A1–A3 | Record Policy shows "Select carrier…" and nothing is auto-selected. The trigger is `type="button"`. Submit without a carrier → "Carrier is required". |
| A4–A5 | The search input is focused on open. The dropdown is the top element at its own center over both the dialog and the simulated dialer (wrapper `z-index: 1100`). |
| A6 | Order: `synthetic alpha mutual`, `Synthetic Beacon Assurance`, `Synthetic Carrier 01`, … (case-insensitive). |
| A7 | Mouse wheel scrolls the list inside the Radix Dialog (`scrollTop` 500). |
| A8–A10 | Typing "beacon" filters to one item. Enter selects and closes. Focus returns to the trigger. |
| A11 | Arrow keys move the active option and keep it scrolled into view. |
| A12–A13 | An unmatched search plus Enter creates nothing. Escape keeps the prior pick and leaves the dialog open. |
| G1–G3 | Switching agency while Record Policy is open resets the form and lists only `org-synthetic-b`'s carrier. That carrier is not auto-selected. Reads were scoped `org-synthetic-a` then `org-synthetic-b`. |
| B1–B3 | Add Client: the dropdown sits above the `z-[200]` overlay, wheel scrolling works, and keyboard selection works. |
| C1–C2 | Edit Client with `"Retired Synthetic Carrier "`: the trigger shows the exact value (trailing space, full value in `title`). A visible "(not in Settings) Kept as saved…" line is linked by `aria-describedby`. An unrelated save sends the value byte-for-byte. |
| D1 | `" synthetic zephyr LIFE"` (a variant of a configured name) shows exactly as stored, with no tag. |
| E1 | Empty list: the message links to `/settings?section=carriers` (new tab, so a sale or dialer flow in progress is not lost). |
| F1–F3 | Failed load: inline "Couldn't load carriers." with a `type="button"` Retry. Retry recovers in place. An unrelated edit saves with the stored carrier while the load fails. |
| H1 | Slow load: a disabled "Loading carriers…" trigger with a spinner. |
| I1–I2 | At 390 px the dropdown fits the viewport (32–357 px) and the page has no horizontal scroll. |

**Fixed during verification.** In Add/Edit Client's half-width column the first build truncated "(not in Settings)"
out of view. The tag moved to its own helper line under the trigger.

Screenshots (synthetic data only) are in `screenshots/`:
- `record-policy-open-dialer.png`
- `add-client-open.png`
- `edit-client-removed-carrier.png`
- `edit-client-error.png`
- `record-policy-empty.png`
- `record-policy-390.png`

**Observation (pre-existing, not changed).** At 390 px the simulated dialer panel (`z-[1000]`) overlaps the top of
the Record Policy dialog (`z-50`). That is the existing dialog/dialer stacking. The carrier dropdown itself sits above
both.

## 3. Not performed

- Signed-in testing against real agencies (two organizations, real RLS) — no test accounts in this session.
  Organization scoping is covered by the query filter, the scope tag (unit tests) and the harness's per-agency fake.
  `carriers_select` RLS is unchanged.
- The real `FloatingDialer` in a live call (simulated layer only, above).
- Any production read or write.
