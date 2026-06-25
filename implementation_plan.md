# Implementation Plan — Contacts Build 6: UI Closeout + Refactor

**Owner:** Chris Garness · **Date:** 2026-06-25
**Branch (proposed):** `claude/contacts-build6-ui-closeout` (off `origin/main`)
**Status:** **SHIPPED (2026-06-25).** Implemented scope = Tier 1 + safe refactor. Merged via PR [#325](https://github.com/cgarness/agentflow-life-insure/pull/325) (feature commit `a60062a`) → merge commit `8340e2f`; Vercel production deploy `dpl_4aWSUaxA2c7kf4ZSteVCWNp8Kctm` READY; prod aliases `agentflow-life-insure.vercel.app` + `www.fflagent.com` HTTP 200. Supabase untouched; no migration/edge. See `WORK_LOG.md` for the shipped record.

> Build sequence: B1 Data Integrity + Assignment ✓ · B2 Scope/Filters/Bulk/Sort ✓ · B3 Import Undo + Lifecycle ✓ · B4 Kanban + List Consistency ✓ · B5 Permissions Framework + Contacts Wiring ✓ (shipped, PR #321) · **B6 UI Closeout + Refactor (THIS BUILD).**

> Prior `implementation_plan.md` content (the full Build 5 CP1→CP3C record) is preserved in `WORK_LOG.md` (newest-first shipped entries) and git history. This file now tracks the **current** build per the AGENT_RULES §8 workflow protocol.

---

## 1. Build 6 objective

Make Contacts feel **production-polished** and **easier to maintain** **without changing core behavior**. Two tracks:

- **UI Closeout** — fill the empty/loading/error/permission-state gaps, make destructive + toast copy consistent, and remove fragile/dead UI affordances. Preserve the premium dark command-center aesthetic.
- **Behavior-preserving refactor** — carve the most stable, low-risk pieces out of the 2,977-line `src/pages/Contacts.tsx` (pure constants, one display helper, two self-contained components) and delete confirmed dead code. **No large rewrite. No query-contract change.**

This is a **frontend-only, presentational** build. No SQL, no migration, no RPC, no Supabase mutation, no edge function, no deploy as part of the coding work.

---

## 2. Exact non-goals (do NOT touch)

**Invariants to preserve (from the Build 6 charter):**
- AgentFlow stays a **life-insurance CRM** (not a generic CRM).
- Tenant data stays scoped by `organization_id`; **RLS untouched**.
- **Build 5 Contacts permissions stay intact**; the 25-key `CONTACTS_PERMISSIONS` catalog remains the single source of truth for Contacts gates.
- **Lead → Client conversion stays universal/ungated** (no key, never a toggle, RPC unchanged).
- No change to **Twilio/Dialer, queue claim/advance, campaign queue behavior, import-undo backend logic, or conversion RPC behavior**.
- No **service-role** usage on the frontend. No **mock data** in production paths.

**Explicitly out of scope (deferred items — do NOT pull in without Chris's explicit inclusion):**
- Add-to-Campaign **backend** parity (Campaigns/backend work).
- Dedicated import **RPC** / import closeout (the `/contacts/import` page + `ImportLeadsModal.tsx` internals).
- Least-privilege security hardening (lead-source anon-revoke, `search_path`).
- Supabase advisor items `app_config` / `webhook_debug_log`.
- No DB schema change (no migration authored or applied).

**Code areas left alone this build:** `useContactScope` scope model, `contactsFilters.ts` filter/sort contract (Build 2), `contactsKanban.ts` + the Kanban RPC contract (Build 4), `usePermissions` / `permissionDefaults` catalog (Build 5), `ConvertLeadModal`, `FullScreenContactView.tsx` internals (review-only — see §5), Dialer/Twilio, `ImportLeadsModal.tsx` internals.

---

## 3. Findings from the current Contacts UI (audit)

Audited: `Contacts.tsx` (full, 2,977 lines), `FullScreenContactView.tsx` (gating/states), `ContactKanbanBoard/KanbanColumn/KanbanCard`, `ContactScopeSelector`, `AddLead/Client/Recruit/AddToCampaign` modals, `useContactScope`, `usePermissions`, `contactsFilters.ts`, existing tests.

### 3a. Already in good shape (leave alone)
- **Kanban** (Build 4): `ContactKanbanBoard` has dedicated **error**, **loading**, empty-column ("No contacts"), Unmapped ("Status not in your pipeline configuration"), and truncation ("Showing X of N") states. Solid.
- **Modal save states**: `AddClientModal`, `AddRecruitModal`, `AddLeadModal` (via `AddLeadFormFooter`), and `AddToCampaignModal` all have `saving`/`loading` spinner + disabled-button states. **Phase-2 "modal saves" and "add-to-campaign actions" loading are effectively DONE.**
- **Build 5 gating**: per-control permission gates are wired (import, bulk delete/assign/status, add-to-campaign, row edit/delete, inline status selects, Kanban `canDrag`). Conversion is correctly ungated.
- **Verified NOT a bug:** `renderClientCell` premium reads `c.premiumAmount`, which `supabase-clients.ts:214` maps from the canonical `clients.premium` via `formatCurrencyValue` (0/blank → "—"). Consistent with AGENT_RULES §5. **No change needed.**

### 3b. Real gaps / fragility (UI Closeout candidates)
1. **Agents tab has NO empty state** (`Contacts.tsx` ~2641) — renders a header-only table when `sortedAgents` is empty. Every other tab has an empty state.
2. **Table error == empty state** — a failed `fetchData` shows a toast, then the list renders the **"No leads found / add your first lead"** empty state, which misleads (looks like "no data," not "load failed"). Table view has no error/retry surface (Kanban does).
3. **Empty-state copy doesn't distinguish "no records" vs "filtered to zero"** — with active filters/search returning 0, the Leads empty state still says "add your first lead" with an Add button, instead of "No leads match your filters" + a **Clear filters** action.
4. **Destructive-confirm copy inconsistency** — the import-undo dialog crams a full explanatory paragraph into the `DeleteConfirmModal` **`title`** prop (`Contacts.tsx` ~2887). `DeleteConfirmModal` has no body/description slot, so long explanations have nowhere clean to go.
5. **Dead/empty action affordances:**
   - Row action menu (`renderActionMenu`) renders an **empty dropdown** for Clients/Recruits when the user has neither edit nor delete permission.
   - Agents-tab row "⋯" button (`Contacts.tsx` ~2660) is a **no-op** dead control.
6. **Toast inconsistency** — 61 `toast.*` calls in `Contacts.tsx`; only 15 set `{ position: "bottom-right" }`/duration. Mixed placement/duration; some success copy lacks the singular/plural guard others have (e.g. "Updated status for N leads." at ~1648).
7. **Column-visibility persistence is fragile/split** — toggles write **localStorage only**; `loadSettings` reads `s.visibleCols` from **Supabase** `user_preferences` but **nothing writes it** there (the intended writer `updateVisibleCols` is dead — see 3c). So visibility doesn't sync across devices and the Supabase read is effectively inert.
8. **Per-tab td width inconsistency** — Recruits table sets `td` width from `columnWidths` (~2614); Leads/Clients tables don't (~2420/2519). Resize feels inconsistent across tabs.
9. **Responsive**: tables horizontal-scroll and the controls row `flex-wrap`s (acceptable), but the controls row gets crowded on narrow widths; minor polish only.
10. **Raw `<input type="checkbox">`** for table selection vs the `Checkbox` component used elsewhere — cosmetic inconsistency (higher churn to change).

### 3c. Confirmed dead code (delete in the refactor)
- `CopyField` (`Contacts.tsx:210`) — **defined, never used**.
- `updateColumnWidths` (`:821`) — defined, never called.
- `updateVisibleCols` (`:826`) — defined, never called (the intended Supabase visibility writer).
- `pendingVisible` / `setPendingVisible` / `displaySet` (`:2064/:2107/:2110`) — vestigial: `displaySet` is computed but never read (the dropdown uses `visible.has(...)` directly).

### 3d. Refactor surface
`Contacts.tsx` is one ~2,700-line component (far over the AGENT_RULES §7 200-line standard; not currently on the documented-exception list). Lowest-risk extractables: the **pure constants block** (column defs, starter layout, color maps, status lists — lines ~101–205), the pure **`normalizeStatusDisplay`** helper, and two **self-contained components** (`DeleteConfirmModal`; `CopyField` is dead → delete). The cell renderers and table bodies close over component state/handlers → **higher risk, deferred**.

---

## 4. Proposed file-touch list

### Refactor (Tier R — recommended, lowest risk)
| File | New/Edit | Why |
|---|---|---|
| `src/components/contacts/contactsTableConfig.ts` | **New** | Move pure constants/types out of `Contacts.tsx`: `ColumnKey`/`ColDef`/`ALL_COLUMNS`/`DEFAULT_VISIBLE` and the Client/Recruit/Agent equivalents, `STARTER_LAYOUT`, `fallbackStatusColors`, `fallbackRecruitColors`, `policyTypeColors`, `allStatuses`, `recruitStatuses`. Pure data move (identity behavior). |
| `src/lib/contactsDisplay.ts` | **New** | Move pure `normalizeStatusDisplay`; unit-testable. |
| `src/components/contacts/DeleteConfirmModal.tsx` | **New** | Extract the inline modal; add an optional `description` slot (powers UI-fix #4). |
| `src/pages/Contacts.tsx` | **Edit** | Import the above; **delete** `CopyField`, `updateColumnWidths`, `updateVisibleCols`, `pendingVisible`/`displaySet`; apply the Tier-1 UI fixes. |

### UI Closeout — Tier 1 (recommended this build; all in `Contacts.tsx` + the new `DeleteConfirmModal`)
| Item | Where | Risk |
|---|---|---|
| UI-1 Agents-tab empty state | `Contacts.tsx` Agents block | Low |
| UI-2 Table **error** state (vs misleading empty) + retry | `Contacts.tsx` (small `loadError` state set in `fetchData` catch) | Low–Med |
| UI-3 Empty copy distinguishes filtered-zero vs no-data + "Clear filters" | `Contacts.tsx` empty blocks (Leads/Clients/Recruits) | Low |
| UI-4 Destructive-confirm copy: move undo paragraph into `DeleteConfirmModal` `description`; keep titles short + consistent | `DeleteConfirmModal.tsx` + `Contacts.tsx` | Low |
| UI-5 Remove dead Agents "⋯" no-op; action menu "No actions" fallback when fully ungated | `Contacts.tsx` `renderActionMenu` / Agents row | Low |

### UI Closeout — Tier 2 (optional; Chris's call — more churn or cross-device behavior nuance)
| Item | Note |
|---|---|
| UI-6 Bulk-bar in-progress spinner (assign/status/delete) | adds a transient `bulkBusy` state |
| UI-7 Toast standardization (position/duration + plural guards) | touches up to ~46 call sites; could use a tiny local `notify` helper |
| UI-8 Column-visibility → persist to Supabase via the (revived) `updateVisibleCols` path | makes visibility sync cross-device (behavior nuance) |
| UI-9 Per-tab td width consistency (apply Recruits' width pattern to Leads/Clients, or drop it everywhere) | small but touches 3 table bodies |
| UI-10 Light mobile pass on the controls row | minor |
| R5 Extract Import History tab → `ImportHistoryPanel.tsx` | medium; must stay SSR-safe (see §6) |

### Tests (Phase 4)
| File | New/Edit | Why |
|---|---|---|
| `src/lib/__tests__/contactsDisplay.test.ts` | **New** | `normalizeStatusDisplay` behavior |
| `src/components/contacts/__tests__/DeleteConfirmModal.test.tsx` | **New** | open/close, confirm spinner, description slot |
| `src/lib/__tests__/contactsGatingRender.test.tsx` | **Edit (if needed)** | keep Build 5 gates green after edits; assert new empty/error copy where feasible |
| `src/lib/__tests__/contactsRender.test.tsx` | **Edit only if required** | add mocks **only** if a newly-extracted child isn't SSR-safe (see §6) |

### Docs
- `WORK_LOG.md` — newest-first Build 6 entry (only after implementation + verification).
- `AGENT_RULES.md` — only if a new invariant is discovered (not expected for a presentational build).

---

## 5. Proposed refactor slices (ordered; each independently revertable)

1. **R1 — Constants** → `contactsTableConfig.ts`, import into `Contacts.tsx`. Pure move. Verify with `tsc` + full vitest + the `contactsRender` SSR guard.
2. **R2 — Display helper** → `contactsDisplay.ts` (`normalizeStatusDisplay`) + new unit test.
3. **R3 — Dead-code deletion** → remove `CopyField`, `updateColumnWidths`, `updateVisibleCols`, `pendingVisible`/`displaySet` (rewire the columns-dropdown open/close to not track pending state — it already persists immediately, so behavior is identical).
4. **R4 — `DeleteConfirmModal`** extraction with an added optional `description` slot; rewire all four call sites (bulk delete, row delete, undo, and the undo-copy fix UI-4).

Then the Tier-1 UI fixes (UI-1…UI-5), which mostly live in the same blocks R3/R4 touch.

**Deferred by design (not this build):** extracting cell renderers (`renderCell`/`renderClientCell`/`renderRecruitCell`/`renderAgentCell`), the table bodies, the toolbar/bulk bar, and modal-orchestration hooks — they close over state/handlers and would force risky churn. Revisit in a later, dedicated refactor slice if Chris wants. `Contacts.tsx` will get meaningfully smaller (constants ~100 lines + dead code + the modal), but **will not** reach <200 lines this build, consistent with "do not force risky churn."

---

## 6. Risk areas

- **SSR render guard (`contactsRender.test.tsx`)** mocks every current child by path and runs `renderToString`. Any **newly-imported child** in `Contacts.tsx` is **not** mocked → it will actually render server-side. Mitigation: extracted pieces are SSR-safe — `contactsTableConfig`/`contactsDisplay` export no JSX; `DeleteConfirmModal` returns `null` when `open=false` (its default in render). If a Tier-2 extraction (R5 `ImportHistoryPanel`, which uses Radix Tooltip) isn't SSR-clean, **add a mock** to the test rather than weakening it. **Run this test after every slice.**
- **Behavior preservation** — constants/dead-code/component extraction must be identity transforms. Guard: full `vitest` (Build 2 sort/bulk/filter-contract, Build 4 Kanban, Build 5 gating/scope suites all stay green) + `tsc`.
- **Gating regressions** — keep every `hasContactsPermission(...)` call exactly as-is when moving surrounding code; `contactsPermissions` / `contactsGatingRender` / `pageGuardContacts` / `permissionsSettingsContacts` suites must stay green.
- **Contract boundaries** — do not alter `buildLeadFilterPayload` inputs, `resolveOwnerAgentIds`, the Kanban payload, or any `*SupabaseApi` call shape.
- **Tier-2 UI-8 (visibility → Supabase)** changes persistence to cross-device; flagged optional so Chris can opt in knowingly.
- **`fetchData` edit (UI-2 error state)** is the one change inside the data path — kept to adding a `loadError` state set in existing `catch` blocks and reset on success; no query/contract change.

---

## 7. Verification plan (no backend commands)

Run before declaring completion (AGENT_RULES §8):
1. `npx tsc --noEmit` — clean.
2. `npx vitest run` — full suite; **expect the current baseline (331 per Build 5 WORK_LOG) + new tests, 0 regressions.** (Re-confirm the exact baseline at implementation start.)
3. Targeted vitest: `contactsDisplay`, `DeleteConfirmModal`, `contactsRender` (SSR guard), `contactsGatingRender`, `contactsPermissions`, `contactScope`, `contactsKanban`, `contactsSort`, `contactsBulkSafety`, `contactsFilterContract`.
4. Targeted **ESLint** on touched files — 0 new errors (pre-existing benign warnings tolerated).
5. `git diff --check` — clean (no whitespace/conflict markers).
6. Manual smoke (describe in handoff; agent has no prod CRM login): table list, Kanban, each empty state (incl. Agents + filtered-zero), a simulated load error, delete/undo confirm copy, permission-gated controls still hidden/shown correctly.

No `apply_migration`, no `execute_sql`, no deploy, no Supabase/Vercel mutation during the build.

---

## 8. Rollback plan

- Pure frontend, no backend/migration/deploy → rollback = `git revert` (or drop the branch / reset the working tree).
- Each slice (R1–R4, each UI-x) is an independent edit and can be dropped without affecting the others.
- No data, schema, RLS, RPC, or deploy state is created → nothing to undo server-side.

---

## 9. Process gate

**Shipped.** Plan approved (Tier 1 + safe refactor), implemented, merged via PR #325 (merge commit `8340e2f`), and deployed to Vercel production (`dpl_4aWSUaxA2c7kf4ZSteVCWNp8Kctm`, READY). No SQL/migration/Supabase mutation; no edge/Twilio/queue/conversion/import-undo-backend change. Tier 2 + the other deferred items (Add-to-Campaign backend parity, import RPC/closeout, security hardening) remain for follow-up builds.

### Decisions (resolved)
1. **Scope:** Tier 1 + safe refactor; Tier 2 deferred. ✓
2. **Toast standardization (UI-7):** deferred to a follow-up. ✓
3. **Column-visibility persistence (UI-8):** left as localStorage; Supabase sync deferred. ✓
4. **Branch name:** `claude/contacts-build6-ui-closeout` (used; merged via PR #325). ✓
