# Implementation Plan — AgentFlow Contacts QA Fix Pass 1

**Label:** QA-FIX (frontend-only)
**Status:** P1 (Fixes 1–4) **IMPLEMENTED + verified** (tsc clean · vitest 361/361 · eslint 0 errors · git diff --check clean) — awaiting PR + Vercel deploy + Chris manual smoke; then P2 (Fixes 5–9). Locked decisions (2026-06-29): A=**Strict** (always My Contacts), F=**Accept RLS default** (no backend); minor defaults B/C/D/E/G as bolded. No Supabase mutation this pass.
**Date:** 2026-06-29
**Branch (current):** `claude/contacts-build6-shipped-worklog`
**Basis:** Chris's production manual test of Contacts Build 6 (9 confirmed findings).

---

## 0. Headline conclusions

- **NO Supabase mutation needed for ANY of the 9 fixes.** No migration, RPC, schema, RLS, or service-role change. Every fix is frontend/presentational or reuses data + RPCs that already exist in prod. This includes Fix 8 (Import History drill-in) — see §8.
- **All Build 5 permission gates preserved.** Every `hasContactsPermission(...)` call is left intact; Lead→Client conversion stays **universal/ungated but org-scoped** (Build 5 rule, AGENT_RULES invariant #11).
- **DO-NOT-TOUCH respected:** no Twilio/Dialer, campaign-queue, call-telemetry, conversion-RPC, schema/RLS, or service-role changes.
- **No working-tree conflicts:** the dirty files (`scripts/seed-test-leads.mjs`, `services/hypercheap-voice-bridge/*`, `tsconfig*.tsbuildinfo`) are unrelated and stay untouched.

---

## 1. Diagnosis summary (per finding)

### FIX 1 — Contacts default scope must be My Contacts (P1)
**Root cause:** `useContactScope` already defaults `useState("mine")`, but the pref-load effect (`useContactScope.ts:137-164`) restores the persisted `user_preferences.settings.contactsScope` **verbatim** for any permitted value — so a prior **Agency** selection becomes the landing scope. Also, there is **no `?scope=` URL parsing anywhere** (grep: 0 matches), so a valid+permitted `?scope=` cannot be honored.
**Fix (no backend):**
- Add a pure, exported `resolveInitialScope({ requested, availableScopes })` helper (mirrors existing `computeAvailableScopes`) → returns `requested` only if it is a valid `ContactScope` **and** in `availableScopes`; otherwise `"mine"`. Never lands on `agency` unless explicitly requested **and** permitted.
- Stop using persisted `contactsScope` as the **landing** scope (see Decision A). `setScope` still persists selections for within-session responsiveness.
- Parse `searchParams.get("scope")` in `Contacts.tsx` (next to the existing `tab` parse at L141-156) and feed it as the requested initial scope; honor once via a ref-guard after `ready`. Do **not** write `scope` back to the URL on selection (keeps Agency from becoming sticky).
- Keep the existing trailing permission-fallback (`useContactScope.ts:169-178`) as a safety net.

### FIX 2 — No flash of My Contacts before Agency Contacts (P1)
**Root cause:** Render-before-effect race. `setLoading(true)` runs **inside** `fetchData` (`Contacts.tsx:227`), which is an effect that fires *after* the render that first sees the new `scope`. For one frame: new `scope` + stale `leads` + `loading=false` → the table paints prior-scope rows under the new scope label (`scopeLabel(scope)`, L2333). Data is already scoped server-side (scope is in the RPC payload) — this is purely client render timing.
**Fix (no backend):**
- In the existing scope-change reset effect (`Contacts.tsx:1019-1038`, deps `[scope]`), set `setLoading(true)` **synchronously** (mount-guarded with a ref so it doesn't double-toggle on first load). This closes the one-frame window — the first render that sees the new scope also sees `loading=true` → spinner instead of stale rows.
- Defensive hardening: track `loadedScopeRef` (the scope the current `leads` snapshot was fetched for) and treat a mismatch as loading in the render gate (`L2258`).
- Apply the same pattern to Clients (`setClients`, L337) and Recruits (`setRecruits`, L353).
- **Preserve the `silent` fetch path** (post-action background refreshes at L1051, L1338, etc. must not trip the new loading gate).
- Reuse the existing centered `Loader2` spinner (minimal change) — skeleton is optional (Decision B).

### FIX 3 — Inline status convert guard (table/list view) (P1)
**Root cause:** new guard. The Leads inline status `<select>` (`Contacts.tsx:1746-1764`, `renderCell` case `"status"`) persists immediately via `handleUpdateLead` with no awareness of convert-to-client stages — selecting a convert stage writes the status with **no conversion** (the orphaned-update the spec forbids).
**Key fact:** convert flag is **already loaded** — `leadStages` (state L469, loaded L839 via `getLeadStages(organizationId)`) carries `convertToClient` (`PipelineStage.convertToClient`, `supabase-settings.ts:13`). No data gap.
**Fix (no backend):**
- Add memo `convertStageNames = new Set(leadStages.filter(s => s.convertToClient).map(s => s.name))`.
- In the inline select `onChange`: if `convertStageNames.has(next)` → `setConvertLead(lead)` (opens the **existing** `ConvertLeadModal` at L2807-2814), **do not** call `handleUpdateLead`, **do not** toast "Status changed". Else keep current behavior.
- Revert-on-cancel is free: `<select value={l.status}>` stays bound to lead state, so cancel (`onClose` → `setConvertLead(null)`) snaps the option back. Success (`onSuccess` → `fetchData` + `openClientById`) removes the converted lead from the Leads list.
- Conversion stays ungated + org-scoped (ConvertLeadModal already enforces `organizationId`). Mirrors Dialer invariant #11.
- Recruits inline select (L1803-1827) intentionally untouched (recruits don't convert).

### FIX 4 — Kanban drag-and-drop + convert guard (P1)
**Root cause:** partial feature. DnD **already works** via `@dnd-kit` (`ContactKanbanBoard.tsx`, sensors + `onDragEnd` + permission gate `canDrag`). But there's **no convert branch** — dragging onto a `convert_to_client` stage calls `leadsSupabaseApi.update({status})`, bypassing the conversion guard. `KanbanColumnModel` doesn't carry `convertToClient` (though `PipelineStage` does).
**Fix (no backend):**
- `contactsKanban.ts`: add `convertToClient` to `KanbanColumnModel`; copy it in `buildKanbanColumns`; add a pure resolver returning `{kind:'status'|'convert'}` (unit-testable, mirrors `resolveDragTarget`).
- `ContactKanbanBoard.tsx`: in `handleDragEnd`, after the existing `canDrag` gate + `resolveDragTarget`, branch — convert stage (Leads only) → call new optional `onConvertRequest(contactId)` and **persist nothing**; else → `onStatusChange` as today. Add the prop to the interface.
- `Contacts.tsx`: pass `onConvertRequest` to the **Leads** board only → `setConvertLead(leads.find(...))` (same lookup as row Convert). Add `void fetchKanban({silent:true})` to `ConvertLeadModal.onSuccess` so the board refreshes after conversion.
- No optimistic move (board is server-truth) → cancel naturally leaves the card in place; no flash/duplicate. Recruits board passes no `onConvertRequest` → convert stages fall back to status move.

### FIX 5 — Filter popup → right-side slide-in drawer (P2)
**Root cause:** new presentation requirement. `ContactsFilterModal.tsx` is a centered Radix `Dialog` (`sm:max-w-md`, L131-132).
**Fix (no backend):** Reuse the **existing** `src/components/ui/sheet.tsx` (`side="right"` — a Radix Dialog variant already used in `ui/sidebar.tsx` + `ControlCenterRuntimePage.tsx`). Swap `Dialog*` → `Sheet*` primitives; `SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col"`; pinned header (`shrink-0`), `flex-1 overflow-y-auto` body, pinned footer (`border-t shrink-0`). **Keep all field JSX byte-identical**, the local draft buffer, `handleApply` (closes), `handleClearAll` (does **not** close), all per-tab/scope/`disableStatus` gating. **Keep the filename** `ContactsFilterModal.tsx` (avoids touching the import + two test mocks). Do **not** use `drawer.tsx` (vaul/bottom-axis). Same `open`/`onOpenChange` contract → `Contacts.tsx` call site unchanged.

### FIX 6 — Stronger, consistent selected-state visual system (P2)
**Root cause:** UI drift. Three controls use two ad-hoc weak recipes — tabs: `text-primary border-b-2` (thin underline only); scope pills + view toggle: `bg-card text-foreground shadow-sm` which in dark mode is **darker than its track** so the active item recedes.
**Fix (no backend):** One shared vocabulary built on existing `--primary`/`--primary-foreground` tokens (identical in light + dark). App is **not** dark-only (next-themes; light default) → must use tokens, not hex.
- Segmented controls (scope pills + view toggle): **active** `bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/60`; **inactive** `text-muted-foreground hover:text-foreground hover:bg-foreground/5`.
- Main tabs: keep the conventional underline but strengthen — `text-primary border-b-2 border-primary font-semibold` active (Decision C).
- Expose via a tiny helper/consts (new `src/lib/contactsTheme.ts`) imported by `Contacts.tsx` + `ContactScopeSelector.tsx`. Preserve `aria-pressed` and all onClick/reset logic.

### FIX 7 — Agents tab licensed states as abbreviations (P2)
**Root cause:** `renderAgentCell` case `"licensedStates"` (`Contacts.tsx:1850-1860`) renders the raw value with CSS `uppercase` only — full-name records ("California") show as "CALIFORNIA". Mixed data shapes exist (onboarding stores full names `string[]`; user-management stores `{state:"CA"}` codes).
**Key fact:** `formatStateToAbbreviation` (from `src/utils/stateUtils.ts`) is **already imported** at `Contacts.tsx:69` and already used for Leads/Clients state cells (L1745, L1784).
**Fix (no backend):** Wrap each licensed-state value in `formatStateToAbbreviation(...)` in the Agents cell (full name → code; existing code → uppercased; unknown/territory → graceful pass-through). Multi-state already renders as `flex flex-wrap` chips. Optional adjacent: `AgentModal.tsx:149` detail field (Decision D). Do **not** touch the raw-value filter/sort comparisons (pre-existing, out of scope).

### FIX 8 — Import History drill-in (P2) — **NO BACKEND BLOCKER**
**Root cause:** new feature. Import rows are non-interactive; no query lists an import's contacts.
**Backend assessment (definitive):** The linkage **already exists** — `public.import_history.imported_lead_ids` (jsonb array of created lead UUIDs), populated at insert (`ImportLeadsPage.tsx:101`, validated by `_import_undo_context` in migration `20260620000100_import_undo_provenance_and_rpcs.sql`). The frontend already reads it into `ImportHistoryEntry.importedLeadIds` (`Contacts.tsx:959`). Listing the contacts needs only a **plain read on existing columns**: `from("leads").select("id, first_name, last_name, phone, email, status, lead_source, assigned_agent_id, created_at").in("id", importedLeadIds)`. **Org-scoping is enforced by existing RLS** `leads_select_org_scoped` (migration `20260331200400_rls_lockdown.sql`) — no cross-org leakage even with a tampered id list; no service-role, no SECURITY DEFINER. **⇒ NO Supabase change.**
**Fix (no backend):**
- Add row `onClick` (+ `cursor-pointer`) on the import row (`Contacts.tsx:2617`); add `e.stopPropagation()` to the existing Undo button so it doesn't also open the drawer.
- New state (selected import + fetched leads + loading/error); new fetch callback (chunk `.in()` at ~200 ids, de-dupe via existing `dedupeValidImportIds`).
- Right-side `Sheet` drawer (Decision E) showing name / phone / email / status+source / owner (`getAgentName(assigned_agent_id, agentProfiles)` — already loaded). Loading (spinner), error (retry), empty states. **Undone imports** return 0 rows (leads deleted) → distinct "this import was undone" empty copy. Copy says "contacts you can access from this import" (RLS may hide leads reassigned outside a non-admin's hierarchy — see Decision F).
- Optional: factor a `leadsSupabaseApi.getByIds(ids)` helper for testability.

### FIX 9 — Move scope controls into the tab row (P2)
**Root cause:** layout relocation. `ContactScopeSelector` currently lives in the controls row (`Contacts.tsx:2183-2190`); spec wants it in the main tab row, right-aligned, Leads-only.
**Fix (no backend):** Pure JSX move.
- **Edit 1:** insert into the tab row (`L2162-2175`) after Import History: `<div className="flex-1" />` spacer + `{tab === "Leads" && (<ContactScopeSelector scope availableScopes onScopeChange />)}` (full `availableScopes` incl. unassigned — valid on Leads).
- **Edit 2:** narrow the controls-row instance to `{(tab === "Clients" || tab === "Recruits") && ...}` (keeps their current behavior, removes the Leads duplicate). Add Lead button stays in the action row (L2246).
- `ContactScopeSelector` self-hides at `availableScopes.length <= 1` → "My always default" preserved automatically; permissions unchanged. Composes cleanly with Fix 1 (hook) and Fix 6 (internal styling).
- Note: the live control also shows **Team** when the user has a downline (spec lists only My/Unassigned/Agency) — keep Team (Decision G).

---

## 2. Files to touch (all frontend)

| # | File | Fix(es) | Why |
|---|------|---------|-----|
| 1 | `src/hooks/useContactScope.ts` | 1 | `resolveInitialScope` helper; stop landing on persisted Agency; accept requested `?scope=`. |
| 2 | `src/pages/Contacts.tsx` | 1,2,3,4,6,7,8,9 | scope param parse; sync loading gate on scope change; inline convert guard; Kanban `onConvertRequest`; shared selected-state classes; Agents abbrev; Import History drill-in + drawer; relocate scope selector. |
| 3 | `src/components/contacts/ContactScopeSelector.tsx` | 6 | shared segmented active/inactive classes. |
| 4 | `src/lib/contactsKanban.ts` | 4 | `convertToClient` on `KanbanColumnModel` + pure convert/status resolver. |
| 5 | `src/components/contacts/ContactKanbanBoard.tsx` | 4 | convert-stage branch in `handleDragEnd` + `onConvertRequest` prop. |
| 6 | `src/components/contacts/ContactsFilterModal.tsx` | 5 | Dialog → Sheet (right drawer); keep fields/behavior/filename. |
| 7 | `src/lib/contactsTheme.ts` *(new)* | 6 | shared selected-state class vocabulary. |
| 8 | `src/lib/supabase-contacts.ts` | 8 | *(optional)* `leadsSupabaseApi.getByIds(ids)` read helper for the drill-in. |
| 9 | `src/components/contacts/AgentModal.tsx` | 7 | *(optional, Decision D)* abbreviate licensed states in detail panel. |

**New test files (10–14):** `src/lib/__tests__/contactScope.test.ts` (extend) · `src/lib/__tests__/contactsKanban.test.ts` (extend) · `src/components/contacts/__tests__/ContactKanbanBoard.test.tsx` (extend) · targeted render tests for inline convert guard, filter drawer, selected states, Agents abbrev, and Import History drawer (added where harness exists).

**Explicitly NOT touched:** `DialerPage.tsx`, `TwilioContext.tsx`, conversion RPC / `supabase-conversion.ts`, `supabase-import-undo.ts` backend RPCs, any `supabase/migrations/*`, queue/campaign/telemetry code.

---

## 3. Import-history backend blocker statement

**No blocker.** The smallest viable drill-in uses only the existing `import_history.imported_lead_ids` column + a plain RLS-scoped `leads` read. **No new RPC / index / column / migration.** A backend change would be warranted **only** if product wants a non-Admin importer to always see the *full* imported set even after some leads were reassigned outside their hierarchy (RLS hides those) — that is a deliberate scoping choice (Decision F), not a missing capability, and would be a separate approved item.

**⇒ No Supabase mutation needed.** (If Decision F selects the full-set-regardless-of-reassignment behavior, that flips to "Supabase change needed; waiting for approval" for Fix 8 only.)

---

## 4. Proposed implementation sequence

Single frontend branch off the current branch; commit per fix for reviewable history.

1. **P1 data-safety first:** Fix 1 (default scope) → Fix 2 (no flash) → Fix 3 (inline convert guard) → Fix 4 (Kanban convert guard). These are the behavior/data-safety items; the convert guard helper from Fix 3 is reused by Fix 4.
2. **P2 UX closeout:** Fix 6 (selected states — shared `contactsTheme.ts` first) → Fix 9 (move scope controls, depends on Fix 6 styling existing) → Fix 5 (filter drawer) → Fix 7 (Agents abbrev) → Fix 8 (Import History drill-in).
3. Tests added alongside each fix.

Delivery: see Decision H (one PR for all 9 vs. P1 PR then P2 PR).

---

## 5. Test plan

- **`npx tsc --noEmit`** (clean) after each milestone and before handoff.
- **Targeted vitest (new + extend):**
  - Fix 1: `resolveInitialScope` cases (agency+permitted→agency; agency w/o `view_all`→mine; undefined→mine; garbage→mine; team w/o downline→mine).
  - Fix 3: inline select — non-convert stage persists + toasts; convert stage opens modal, no persist, select keeps original; cancel→no write; success→`fetchData`.
  - Fix 4: `buildKanbanColumns` copies `convertToClient`; resolver returns `convert` vs `status`; board fires `onConvertRequest` (not `onStatusChange`) on a convert drop.
  - Fix 7: `formatStateToAbbreviation` — "California"→"CA", "ca"→"CA", `{state:"NY"}`→"NY", unknown→pass-through, empty→em-dash.
  - Fix 8: `getByIds`/chunking calls `.in('id', ids)` chunked >200 + merges; drawer loading/error/empty/populated render.
  - Render: Fix 2 (no stale rows during scope transition), Fix 5 (drawer fields + apply closes / clear doesn't), Fix 6 (active classes + `aria-pressed`), Fix 9 (single selector instance, tab-row placement).
- **Existing Contacts suites (regression):** `contactsFilterContract`, `contactsRender`, `pageGuardContacts`, `contactsGatingRender`, `contactsDisplay`, `DeleteConfirmModal`, kanban/sort/bulk-safety/permissions — all must stay green (Build 6 baseline: 342/342).
- **`git diff --check`** clean.
- **Manual checklist for Chris** — see §7.

---

## 6. Invariants & risks watch

- Build 5 permission catalog shape + every `hasContactsPermission(...)` gate unchanged; conversion stays ungated + org-scoped.
- Scope only **narrows** within RLS — never widen access; `?scope=` always validated against `availableScopes`.
- `.maybeSingle()` usage unchanged; no new zero-row lookups introduced that bypass it.
- Zod: filter modal validation untouched (presentational refactor only); no form schema changes.
- Tailwind-only; tokens (not hex) for theme-safe selected states.
- No mock/seed data in prod paths; no service-role/secrets on the frontend.
- Preserve `silent` refetch path (Fix 2) and no-optimistic-move Kanban contract (Fix 4).

---

## 7. Manual smoke checklist for Chris (post-implementation)

1. Fresh `/contacts` → Leads + **My Contacts** active. Refresh `/contacts?tab=Leads` → still My Contacts. `/contacts?scope=agency` (with permission) → Agency; without permission → My Contacts.
2. Switch My → Agency → Unassigned rapidly → no flash of prior-scope rows; correct loading state; footer label matches rows.
3. Table: change a lead status to a non-convert stage → updates inline. To a convert stage → ConvertLeadModal opens, original status retained; Cancel → unchanged; Convert → lead leaves Leads list.
4. Kanban: drag New → Follow Up updates; drag to a convert stage → modal; Cancel → card returns; Convert → board refreshes, no duplicate.
5. Filter → right-side drawer slides in, scrolls, Apply/Clear/Close work, popovers open above it, usable at ~375px.
6. Active scope pill / Kanban-List toggle / top tab are each immediately obvious in **light and dark**.
7. Agents tab → licensed states show as `CA`, `NY` chips (never "CALIFORNIA").
8. Import History → click a row → drawer lists that import's contacts (name/phone/email/status+source/owner); undone import shows the undone empty copy; no cross-org leakage.
9. Scope controls sit right-aligned in the tab row on Leads; absent on Agents/Import History; Add Lead stays in the action row.

---

## 8. Decisions needed from Chris (defaults in **bold**)

- **A. Fix 1 persistence reading:** **Strict** (never auto-land on persisted scope; always `mine` unless valid `?scope=`) vs. Lenient (restore persisted My/Team/Unassigned, never Agency). *Strict is the literal requirement reading.*
- **B. Fix 2 loading visual:** **Existing spinner** (smallest diff) vs. table skeleton.
- **C. Fix 6 tab style:** **Keep underline (strengthened)** vs. full brand-fill pills for tabs too.
- **D. Fix 7 scope:** **Include `AgentModal` detail-panel abbreviation** vs. Agents-tab table only.
- **E. Fix 8 surface:** **Right-side Sheet drawer** vs. centered modal.
- **F. Fix 8 scoping:** **Accept RLS default** (non-admin may see fewer than "Imported" if leads were reassigned; label "contacts you can access") vs. new SECURITY DEFINER RPC for full imported set → *this is the only path that needs Supabase approval.*
- **G. Fix 9:** **Keep Team scope pill on Leads** (real permission-gated scope) vs. suppress to match the literal My/Unassigned/Agency wording.
- **H. Delivery:** **One PR for all 9** vs. P1 PR (1–4) then P2 PR (5–9).

---

## 9. Supabase statement

**No Supabase mutation needed** for the recommended plan (Decisions A–E, G as defaulted; F = "Accept RLS default"). If Chris selects Decision F = full-imported-set RPC, that single item becomes **"Supabase change needed — stop for approval before creating/applying any migration."**
