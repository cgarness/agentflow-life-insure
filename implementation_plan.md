# Implementation Plan — HOTFIX: Onboarding crashes on object-shaped licensed states

**Status:** **IMPLEMENTED on branch `hotfix/onboarding-licensed-states-object-crash`** — Chris approved the plan and decisions D1–D4 on 2026-08-03; the fix is implemented, verified, and pushed. NOT merged, NOT deployed. See the matching `WORK_LOG.md` entry for as-built verification figures.
**Date:** 2026-08-03 (plan approved and implemented same day)
**Severity:** Production incident — invited users cannot complete `/onboarding` (React error #31 on the Licensing step; 7 crashes recorded by AppErrorBoundary).
**Baseline:** `origin/main` = **`1cb178fd811917a362f994f0742ca81a0605c1a4`** (merge of PR #343, Dashboard Build 1). Verified `git diff --stat 09976ac..1cb178f` touches **zero onboarding files**, so the crash surface is byte-identical to the deployed `09976ac` (PR #342).
**Branch plan:** cut **`claude/hotfix-onboarding-licensed-states`** from `origin/main` (`1cb178f`). The current checkout (`claude/dashboard-build1`) is fully contained in main — no unmerged work is at risk. Pre-existing dirty files excluded from every commit, as in prior tasks: `deno.lock`, `.claude/`, `.cursor/`, `tsconfig*.tsbuildinfo`.

> Supersedes the Dashboard Closeout plan, which shipped through PR #343 (merged to main as `1cb178f`) and whose durable record lives in the 2026-08-03 `WORK_LOG.md` entries and in git history. Its open blockers (D1 hard block on Build 2, A20/A21/A23/A24, D3/D4, agency-timezone reporting, DST-suite follow-up) remain open and are **not** affected by this hotfix.

> ⚠️ **Baseline discrepancy worth noting:** the incident brief states production = PR #342 / `09976ac`, but PR #343 has since been merged to main. If Vercel auto-deploys main, production may already be `1cb178f`. Either way the onboarding code is identical in both commits; the hotfix applies cleanly on top of main. Chris should confirm the deployed commit at release time.

---

## 1. Root cause (confirmed in code)

**Writer side — invitations store objects.** `InviteUserModal` collects `LicensedStateEntry[]` (`{ state: "CA", licenseNumber: "" }` — `userManagementTypes.ts:5`, built by `StateMultiSelect.tsx:83`), sends it through `usersSupabaseApi.invite` (`supabase-users.ts:268`), `invite-user/index.ts:117` stores it on `invitations.licensed_states`, and `accept-invite/index.ts:85` copies it into the new user's metadata → `profiles.licensed_states` (jsonb). Live production evidence: `licensed_states: [{"state":"CA","licenseNumber":""}]`.

**Reader side — onboarding assumes `string[]`.** `useOnboardingPageFlow.ts:99-100`:

```ts
const ls = profile.licensed_states;
setLicensedStates(Array.isArray(ls) ? (ls as string[]) : []);
```

`Array.isArray` passes for the object array, the `as string[]` cast lies, and `LicensedStatesMultiSelect.tsx:149` renders each entry as a React child (`{state}` inside a chip `<li>`) → **React error #31** the moment the invited user reaches Step 2. The trigger summary (`summarizeLicensedStates`) merely counts, so the crash fires on the chip list; `value.includes(state)` also silently fails for option marking.

**Second defect (data loss, latent):** completion writes the UI selection straight back — `useOnboardingPageFlow.ts:182` `licensed_states: licensedStates as unknown as Profile["licensed_states"]`. Even after making the read safe, an unconditional write would replace `[{ state: "CA", licenseNumber: "12345" }]` with `["California"]`, destroying the license number. The fix must address both.

**Why history has three shapes.** The onboarding flow has always saved full-name strings (`licensedStates.ts:10-11`, locked by `licensedStatesMultiSelect.test.tsx:104-127`); the invitation flow saves `{state: <code>, licenseNumber}` objects; migration `20260522212000_backfill_legacy_licenses.sql` proves both string and object shapes (and abbreviations, and DC) already existed in production in 2026-05. This is a data-contract bug — **the data is valid; the onboarding reader is wrong.**

---

## 2. Design

### 2.1 New shared constants — `src/constants/us-geo.ts`

Add a code↔name mapping derived from the existing `US_STATE_NAMES` (single source of truth, no drift):

```ts
export const US_STATE_CODES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"] as const;
export const US_STATE_NAME_BY_CODE: Readonly<Record<string, string>>; // CA -> California (zip of the two arrays; a unit test asserts 50/50 pairing)
export const US_STATE_CODE_BY_NAME: Readonly<Record<string, string>>; // California -> CA
```

This satisfies "shared and tested abbreviation-to-full-name mapping" without importing the settings feature (`userManagementUtils.ts` keeps its own copy — deduplicating settings is out of hotfix scope). No package added.

### 2.2 Adapter — `src/components/onboarding/licensedStates.ts`

All parsing starts from `unknown`. New exported types and pure functions (co-located with the existing tested helpers; imported by the hook):

```ts
export type LicensedStateObjectEntry = { state: string; licenseNumber: string };
export type LicensedStateProfileEntry = string | { state?: unknown; licenseNumber?: unknown };

/** Trimmed, case-insensitive match on full name or 2-letter code → canonical full name, else null. */
export function normalizeLicensedStateName(value: unknown): string | null;

/** unknown → safe string[] of full names for the UI: recognizes strings and {state} objects,
 *  trims, normalizes codes, dedupes (first occurrence wins), preserves order, drops everything else. */
export function licensedStatesToUiSelection(raw: unknown): string[];

/** True when the UI selection is the same SET of states the raw payload already represents. */
export function isLicensedStatesSelectionUnchanged(raw: unknown, selection: string[]): boolean;

/** Rebuilds the persistence payload for a MODIFIED selection, preserving richer data. */
export function rebuildLicensedStatesPayload(raw: unknown, selection: string[]): LicensedStateProfileEntry[];
```

**Parse classification (per entry):**
- *Recognized:* a string whose trimmed value matches a full name (case-insensitive) or 2-letter code; or an object whose `state` property is such a string. Carries `fullName` + the original raw entry + trimmed `licenseNumber` (when a string).
- *Opaque:* a non-empty string, or an object with a non-empty string `state`, that matches no known state (e.g. `"DC"`, `"District of Columbia"`, typos). Not shown in the UI, but **never silently destroyed** (see rebuild).
- *Dropped:* `null`, `undefined`, numbers, booleans, nested arrays, objects without a usable string `state` — ignored everywhere.

**Rebuild rules (only runs when the selection was modified):**
1. Iterate the final UI selection in order. For each full name:
   - If ≥1 original entry normalizes to it → re-emit **one** entry: prefer the one with a non-empty `licenseNumber`; object entries are re-emitted **verbatim** (license number and any extra keys intact); string entries are re-emitted as the **canonical full name** (see D3).
   - Else (newly added state) → `{ state: <2-letter code>, licenseNumber: "" }` when the original payload contained any object entry; otherwise the full-name string (matching the flow's established save shape).
2. Deselected states are simply not re-emitted.
3. *Opaque* entries are appended verbatim at the end — the user never saw them, so they cannot have deselected them, and dropping them could discard a real license number (e.g. a DC license).
4. Duplicates in the source collapse to one emitted entry (the license-number-bearing one wins).

This satisfies every DATA-PRESERVATION requirement: non-empty license numbers survive no-change completion (§2.3), survive additions, removal removes only the removed state, object-sourced profiles gain objects, string-sourced profiles stay string arrays, mixed arrays keep richer data.

### 2.3 Hook — `src/hooks/useOnboardingPageFlow.ts`

Three surgical edits:

1. **Load (lines 99-100):** keep the raw payload and normalize for the UI — the `as string[]` cast is deleted:
   ```ts
   const originalLicensedStatesRef = useRef<unknown>([]);
   // in the profile effect:
   originalLicensedStatesRef.current = profile.licensed_states ?? [];
   setLicensedStates(licensedStatesToUiSelection(profile.licensed_states));
   ```
2. **Completion (line 182):** the patch is built **without** `licensed_states`; it is added only when the selection actually changed:
   ```ts
   if (!isLicensedStatesSelectionUnchanged(originalLicensedStatesRef.current, licensedStates)) {
     patch.licensed_states = rebuildLicensedStatesPayload(originalLicensedStatesRef.current, licensedStates);
   }
   ```
   Unchanged selection ⇒ the key is **omitted from the profile patch entirely**, so `profiles.licensed_states` is never rewritten (`updateProfile` is a plain `.update(data)` — omitted columns are untouched; verified at `AuthContext.tsx:249-260`). This is the brief's "alternatively omit" option — chosen because it is provably lossless (D1).
3. Everything else in the hook — timezone branching, founder/invite branching, `savingRef` duplicate-submit guard, `refreshSessionUntilClaimsReady`, org/branding writes, auth-metadata update, redirect — **unchanged**.

"Changed" is detected by **set equality** between `licensedStatesToUiSelection(original)` and the current selection (not a dirty flag): a user who removes California and re-adds it lands back on "unchanged", so the original object payload — license number included — is preserved rather than rebuilt. Strictly safer than tracking clicks.

### 2.4 Deliberately NOT changed

- **`LicensedStatesMultiSelect.tsx` / `OnboardingStepCredentials.tsx`** — inspected; no edit. The component's `value: string[]` contract is now enforced at the data boundary (the hook). Adding a defensive `typeof v === "string"` filter inside the component would be exactly the UI-only suppression the brief forbids as a fix, and would mask future contract violations from tests.
- **Settings side** (`InviteUserModal`, `StateMultiSelect`, `userManagementTypes/Utils`, `supabase-users.ts`), **`AuthContext.tsx`** (`Profile.licensed_states` stays `any[]` — no broad Profile refactor), **both Edge Functions**, **all migrations**, **`agent_state_licenses`** (no sync behavior), **`src/components/auth/**`**, route gating, auth metadata. Invitation production contract untouched.
- **Known pre-existing, documented, not fixed here:** the Settings user-management editor assumes object entries and renders string-sourced profiles as empty badges (`StateMultiSelect.tsx:37` reads `.state` of a string). Same class of contract bug on the other side of the fence — needs its own pass, not this hotfix.

### 2.5 Decision points (approve or override)

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Unchanged selection: omit `licensed_states` from the patch vs. re-writing the original payload verbatim | **Omit** — zero-risk, byte-identical DB state, supported by existing `updateProfile` |
| D2 | Unrecognized-but-real entries (DC, typos) on a modified save | **Preserve verbatim, appended at end** — never discard possible license data; UI simply doesn't offer them (onboarding list is 50 states, no DC) |
| D3 | Retained legacy string entries (`"CA"`, `"california"`) on a modified save | **Canonical full name** (`"California"`) — matches the flow's established string shape; no richer data exists to lose |
| D4 | Invited-agent shared fixture | Switch the invite-flow suite's profile to the real production object payload (brief requires ≥1; this makes the whole suite a regression net) |

---

## 3. Files to touch (complete list)

| File | Action |
|------|--------|
| `src/constants/us-geo.ts` | EDIT — add `US_STATE_CODES`, `US_STATE_NAME_BY_CODE`, `US_STATE_CODE_BY_NAME` |
| `src/components/onboarding/licensedStates.ts` | EDIT — add types + 4 pure adapter functions (§2.2) |
| `src/hooks/useOnboardingPageFlow.ts` | EDIT — safe load, original-payload ref, conditional patch (§2.3) |
| `src/components/onboarding/__tests__/licensedStatesAdapter.test.ts` | NEW — unit tests for the adapter + mapping |
| `src/pages/__tests__/onboardingLicensedStates.test.tsx` | NEW — wizard-level regression suite (§4) |
| `src/pages/__tests__/onboardingTestUtils.tsx` | EDIT — export object-shaped fixture (production payload) |
| `src/pages/__tests__/onboardingInviteFlow.test.tsx` | EDIT — invited-agent profile uses the object payload (D4) |
| `implementation_plan.md`, `WORK_LOG.md` | EDIT — this plan; newest-first log entry |

No other file. No migration, no Edge Function, no RLS, no dependency, no Vercel/Supabase config, no production data.

---

## 4. Test plan (maps 1:1 to the brief's 14 requirements)

**Unit (`licensedStatesAdapter.test.ts`):** normalization of full names / codes / case / whitespace (req 9); dedupe (req 12); order stability; null/malformed entries dropped (req 11); mixed arrays (req 10); mapping completeness (50↔50); rebuild — retention verbatim, add-as-object vs add-as-string by source shape (req 7, 8), removal (req 6), duplicate-with-license-number preference, opaque preservation, license number never lost (req 5, 6).

**Wizard-level (`onboardingLicensedStates.test.tsx`)** — renders the real `OnboardingPage` with the mocked auth/supabase harness already used by the invite suite:
1. **Exact production payload** `[{ state: "CA", licenseNumber: "" }]`: Step 1 renders → Continue → Licensing step renders **without crash** (req 1).
2. Trigger reads **"1 state selected"**, a **"California"** chip is in the DOM (desktop chip list), and `[object Object]` appears nowhere (req 2).
3. Popover open → the **California option is `aria-selected`** (req 3).
4. Payload `[{ state: "CA", licenseNumber: "12345" }]`, complete with **no selection change** → `updateProfile` patch **has no `licensed_states` key** (req 4).
5. Same payload, **add Texas** → patch equals `[{ state: "CA", licenseNumber: "12345" }, { state: "TX", licenseNumber: "" }]` (req 5, 7).
6. Start `CA + TX` objects, **deselect Texas** → patch retains only the CA object (req 6).
7. String profile `["California"]` + add Texas → `["California", "Texas"]` (req 8).
8. Abbreviation strings `["CA","TX"]` → "2 states selected", both options selected (req 9).
9. Mixed + duplicates + malformed (`["California", {state:"CA",licenseNumber:"999"}, null, 42, {}]`) → renders 1 selection, no crash; unchanged completion omits the key (req 10, 11, 12).
10. Back → Continue keeps the selection (harness step of the brief).
11. Invited-agent timezone still lands in the patch alongside the object payload (req 13).

**Req 13/14 (existing behavior unchanged)** is additionally locked by the two existing suites (`onboardingInviteFlow`, `onboardingWizardBehavior`) — completion payload, founder/invite branching, route gating, duplicate-submit guard, dashboard redirect — which must stay green; the invite suite now runs on the object payload (D4), so its `goToFinalStep` walk through Step 2 is itself a regression test of the crash.

---

## 5. Local reproduction & browser harness

1. **Fail-first:** run the new wizard-level test with the production payload against the **unmodified baseline** and record the React #31 failure before applying the source fix (same fail-first discipline as the Dashboard corrections).
2. **Browser at 1440×900 / 390×844 / 320×568:** the local `.env.local` points at the live Supabase project, and a real authenticated invited session cannot be created without **mutating production data — which this plan forbids**. So: a throwaway Vite harness in the session scratchpad (aliasing `@` → repo `src`, mocking only `AuthContext`/supabase client — nothing added to the repo) mounts `OnboardingPage` with `licensed_states = [{"state":"CA","licenseNumber":""}]` and walks Step 1 → Step 2 → summary → Back/Continue at all three viewports, verifying chips on desktop and the hidden-chip/summary-only presentation at 320px. Screenshots included in the handoff.
   *If Chris prefers a true end-to-end and supplies (or approves creating) a disposable invited test account, I'll run the real flow instead — but that is a production write and needs his explicit OK.*

---

## 6. Verification gate (after approved implementation)

- `npx tsc --noEmit` → exit 0
- Targeted: the 2 new files + `licensedStatesMultiSelect` + `onboardingInviteFlow` + `onboardingWizardBehavior`
- Full `npx vitest run` (with throwaway inline `VITE_SUPABASE_*` placeholders only if this shell lacks them — never written to a file; note `.env.local` already exists locally)
- `npx eslint` on every touched source/test file
- `git diff --check`
- Scope audit: zero diffs under `supabase/**`, `src/components/auth/**`, settings user-management, `AuthContext.tsx`, `package.json`

---

## 7. Work log & release

- Append newest-first `WORK_LOG.md` entry: HOTFIX status, symptom, root cause, files, shape compatibility, license-number preservation, tests, verification figures, and the explicit "Migrations: none · Supabase changes: none · Edge deployments: none · Vercel deployments: none" block.
- Open a PR from `claude/hotfix-onboarding-licensed-states` → `main` (never pushing to main directly). Merge + deploy are **Chris's calls**; recommend verifying on the Vercel preview URL first, then merging and confirming the production deployment picks up `main` (note the §baseline discrepancy — main already contains PR #343).

---

**Approval record:** Chris explicitly approved this plan, decisions D1–D4, and the §3 file list on 2026-08-03. As-built notes: the adapter unit tests live at `src/pages/__tests__/licensedStatesAdapter.test.ts` (the location in Chris's approval, superseding §3's `src/components/onboarding/__tests__/` placement); everything else shipped exactly as planned. Implementation, verification, and browser-harness results are recorded in `WORK_LOG.md` (2026-08-03 HOTFIX entry).
