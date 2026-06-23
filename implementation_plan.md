# Implementation Plan — Contacts Build 4: Kanban + List Consistency

**Owner:** Chris Garness · **Date:** 2026-06-22
**Branch:** `claude/contacts-build4-kanban-consistency` (off `origin/main` `3db777f`) — **created.**
**Status:** **CHECKPOINT 3B — MIGRATION APPLIED TO PRODUCTION; frontend NOT yet deployed. Prod MCP version `20260623164242` (`contacts_kanban_aggregates`, file SHA-256 `5dd8b5e3…`). Both RPCs live + verified INVOKER/STABLE/fixed-search_path, anon/PUBLIC denied, authenticated+service_role granted; prod parity proven (lead 517==517, recruit 0==0); zero migration-attributable advisor findings; EXPLAIN ~31 ms at 517. `types.ts` regenerated (+8 lines, my 2 RPCs) + casts narrowed to typed `supabase.rpc`. `tsc` clean · `vitest` 302/302 · ESLint 0 errors · `git diff --check` clean. Nothing committed/pushed/PR'd/merged/deployed. HOLD for CP4 approval.** *(CP1 + CP2 + CP3A retained below.)*

> Build sequence (confirmed against WORK_LOG / Build 3 plan):
> B1 Data Integrity + Assignment ✓ · B2 Scope/Filters/Bulk/Sort ✓ · B3 Import Undo + Lifecycle ✓ (merged #317, deployed) · **B4 Kanban + List Consistency (THIS BUILD)** · B5 Permissions + Ownership QA · B6 UI Closeout + Refactor.

---

## 1. Current behavior summary (audited from code + live prod, read-only)

### Data path (table view — canonical, from Build 2)
- `Contacts.tsx#fetchData` builds ONE canonical `LeadFilterPayload` via `buildLeadFilterPayload` (`src/lib/contactsFilters.ts`) and calls `leadsSupabaseApi.getAll(payload)` → RPC **`search_contacts_leads(p_filters)`**.
- That RPC wraps **`public._contacts_filtered_leads(p_filters)`** which returns the full filtered `(id, ord)` set (scope resolved server-side, RLS-enforced, NOT security definer). The wrapper returns `total_count = count(*)` of the full set + a **page slice** (`LIMIT page_size OFFSET page*page_size`, default 50) hydrated with `attempt_count` / `last_disposition` aggregates.
- Recruits mirror this: `recruitsSupabaseApi.getAll` → `search_contacts_recruits` → `_contacts_filtered_recruits(p_filters)` (same `(id, ord)` + page-slice shape; recruit payload has **no status filter**).
- The page stores only the **current 50-row page** in `leads` / `recruits` state. `leadsTotalCount` / `recruitsTotalCount` hold the true filtered totals.

### Kanban path (the problem)
- Both Kanban blocks pass the **same page-sliced array** to the board: `<ContactKanbanBoard contacts={leads} …>` (Contacts.tsx:2343) and `contacts={recruits}` (:2507).
- `ContactKanbanBoard` builds columns from `Object.keys(statusColors)` and renders `contacts.filter(c => c.status === status)` — so **every column and every count is computed over the ≤50-row page only**, never the full filtered pipeline.
- Column count badge (`{contacts.length}`) is page-local. A status with 0 rows on the current page shows an empty column even when the pipeline holds hundreds in that stage.

### Status / stage color source
- `leadStageColors` / `recruitStageColors` are `name → color` maps built in the `organizationId` effect from `pipelineSupabaseApi.getLeadStages` / `getRecruitStages` (`pipeline_stages`, ordered by `sort_order`). Kanban columns = keys of that map. Table badges use `getLeadStatusColor` which falls back to `fallbackStatusColors` then `#6B7280`; **Kanban has no fallback** (only the map).

### Drag / drop
- `handleDragEnd` → `onStatusChange(id, newStatus)` → `handleKanbanStatusChange`:
  - Leads → `handleUpdateLead(id,{status})` → `leadsSupabaseApi.update`; updates the local array in place (and, if a status filter is active, drops the card + decrements the page count). **No Kanban refetch.**
  - Recruits → `recruitsSupabaseApi.update`; updates local array in place. **No refetch.**
- Selected-contact detail is kept in sync via `setSelectedLead/Recruit` on the updated row.

### Live production snapshot (org `a0000000-…0001`, read-only)
- **Leads: 517 total** — `New` 515, `Lost` 2. Both statuses map to a configured lead stage by name.
- **Lead stages (8):** `New`(0), `Attempting Contact`(1), **`New Lead`(1)**, `Appointment Set`(2), `Quoted`(3), **`Follow Up`(3)**, `Lost`(4), `Sold`(5, convert_to_client). **Two pairs share `sort_order`** (1 and 3) → non-deterministic column order today.
- **Recruits: 0 rows.** Recruit stages: `New `(1, **trailing space**), `Interview Scheduled`(1), `Offer Made`(2), `Hired`(3), `Not a Fit`(4). `recruitsSupabaseApi` defaults new recruit `status` to `"New"` (no trailing space) → would **not** match the `"New "` column.
- **Net:** with 517 leads, agency-scope table shows "517" while Kanban renders at most 50 cards spread across columns — the pipeline looks ~10× smaller in Kanban. This is the headline defect.

---

## 2. Exact inconsistencies found (answers to the 17 audit questions)

| # | Question | Finding |
|---|---|---|
| 1 | Leads table rows/counts | Canonical: server-filtered, exact `total_count`, page slice of 50. **Correct.** |
| 2 | Leads Kanban columns/counts | **Page-local.** Columns + counts computed over ≤50 rows. **Wrong** (understates pipeline). |
| 3 | Recruits table rows/counts | Canonical, same as leads. **Correct** (0 rows in prod). |
| 4 | Recruits Kanban columns/counts | **Page-local.** Same defect. |
| 5 | Scope (mine/team/agency) | Table: resolved server-side in `_contacts_filtered_*`. Kanban: inherits whatever page is loaded → scope is technically applied (same array) but **counts are still page-truncated**. |
| 6 | Filters | Table: full canonical payload. Kanban: same truncated page; **a `status` filter is contradictory in Kanban** (collapses to one column). |
| 7 | Sort | Table: full-dataset server sort before LIMIT. Kanban: cards appear in the page's sort order, but only the 50 that happen to be on the page; column membership is arbitrary w.r.t. the full set. |
| 8 | Pagination | Table: real pager. **Kanban has no pager and no full fetch → it silently shows only page 1.** |
| 9 | Status/stage color source | `pipeline_stages.color` via name map. Kanban has **no fallback** for unmapped statuses. |
| 10 | Drag/drop update | Persists via `update`; updates local array; **no server refetch** → counts/aggregates can drift from truth after a move. |
| 11 | Status not matching any stage | **Record disappears** from Kanban entirely (no column, no fallback). Today no live lead hits this, but it is reachable (Dialer dispositions / imports can set arbitrary `status`). |
| 12 | Status change while a status filter is active | Leads: card removed from view + page count decremented (table-correct), but in Kanban this is confusing — the column it moved to may not be visible. |
| 13 | Can Kanban show more than the page slice? | **No.** Hard-capped at the current page (≤50). |
| 14 | Do Kanban counts match filtered totals? | **No.** They equal page-local per-status counts. |
| 15 | Stale selected-contact after status update | Selected detail is re-synced on update (leads + recruits). **OK**, but full Kanban aggregates are not refreshed. |
| 16 | Recruits vs Leads same rules? | Same page-local defect. Recruits lack a status filter and have a `"New "` trailing-space stage hazard. |
| 17 | Clients list-only? | **Yes — keep.** No Clients Kanban exists; the view toggle is ignored on the Clients tab. No partial/broken Clients Kanban to fix. |

**Root cause (single):** Kanban consumes the table's paginated `leads`/`recruits` state instead of a full-pipeline, filter-/scope-consistent aggregate. Confirmed in both code (`contacts={leads}` / `contacts={recruits}`) and live data (517 leads vs 50-row page).

---

## 3. Proposed data contract (Kanban-specific, surgical)

Keep Build 2 table behavior **100% untouched** (pagination, sort, bulk safety, matching-IDs). Add a **Kanban-specific read path** that reuses the SAME canonical filter helper (`_contacts_filtered_*`) so Kanban and table share one WHERE/scope and can never contradict.

**Per board, one fetch returns:**
```ts
interface KanbanStageData {
  status: string;        // raw status string from the row
  total: number;         // FULL filtered count for this status (not page-local)
  cards: Lead[] | Recruit[]; // bounded slice (first N by canonical ord)
}
interface KanbanResult {
  stages: KanbanStageData[]; // every status PRESENT in the filtered set
  perColumnLimit: number;    // echo of N applied
  grandTotal: number;        // sum(total) == table total_count for the same filters
}
```

- **Filters/scope:** Kanban uses the exact same payload as the table **except** `status` is forced to `null` (Kanban's columns *are* the statuses — applying a single-status filter is contradictory) and `page`/`page_size` are irrelevant (no pagination). All other filters (search, source, state, timezone, callable-now, attempt buckets, last-disposition, date range, scope, agent_ids) apply identically. **Decision D1 below.**
- **Counts are exact and full** (`total` per status), so `grandTotal` equals the table's `total_count` for the same filters → no contradiction.
- **Cards are a bounded per-column slice** (default N=50, by canonical `ord`) for performance. The UI shows the exact `total` and indicates when `total > cards.length` ("showing 50 of 312").
- **Unmapped statuses are preserved:** the RPC returns every status string present in the filtered set; the UI renders configured `pipeline_stages` columns (by `sort_order`) **plus an explicit "Unmapped" column** for any status not matching a stage name. Records never disappear.
- **Stage/column order** follows `pipeline_stages.sort_order` with a deterministic tiebreak (`sort_order, name, id`) since prod has duplicate `sort_order` values. (We do **not** mutate the duplicate `sort_order` settings data — out of scope; the UI just orders deterministically.)

---

## 4. Migration / RPC needed?

**Yes — two read-only SQL functions (one migration file).** Pure aggregation over the existing canonical helpers; no schema change, no data mutation, no RLS change.

`_contacts_filtered_leads` / `_contacts_filtered_recruits` already exist, return `(id, ord)`, are RLS-respecting (NOT security definer), and are the same set the table uses. The Kanban RPCs reuse them so there is exactly one filter/scope definition.

---

## 5. Proposed RPC name / signature / security model

```sql
-- Leads
public.get_contacts_lead_kanban(p_filters jsonb, p_per_column int DEFAULT 50)
  RETURNS jsonb
  -- LANGUAGE sql STABLE, SET search_path = public, pg_temp
  -- SECURITY INVOKER (default) — mirrors search_contacts_leads; RLS applies to the caller.
  -- Internally: WITH f AS (SELECT * FROM public._contacts_filtered_leads(
  --   p_filters || '{"status":null}'::jsonb)),  -- ignore single-status filter
  --   counts AS (SELECT l.status, count(*) FROM f JOIN leads l USING(id) GROUP BY l.status),
  --   ranked AS (row_number() OVER (PARTITION BY l.status ORDER BY f.ord)) ... WHERE rn <= p_per_column
  --   (cards hydrated with attempt_count/last_disposition exactly like search_contacts_leads)
  -- Returns { grand_total, per_column_limit, stages:[{status,total,cards:[…]}] }

-- Recruits
public.get_contacts_recruit_kanban(p_filters jsonb, p_per_column int DEFAULT 50)
  RETURNS jsonb  -- same shape; recruits have no status filter and no call aggregates
```

- **Security:** `SECURITY INVOKER` (the Build 2 default for `search_contacts_*`) — RLS scopes the caller exactly as the table path. No `SECURITY DEFINER`, no new privilege surface.
- **Grants:** `REVOKE … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated` (+ `service_role` only if pattern parity requires).
- `p_per_column` clamped server-side (e.g. `LEAST(GREATEST(p_per_column,1),200)`) to bound payload size.
- Called via narrow `(supabase as any).rpc(...)` until `types.ts` is regenerated post-apply (Build 2/3 precedent).

---

## 6. Exact files intended to touch (CP2)

**Frontend**
- `src/lib/supabase-contacts.ts` — add `leadsSupabaseApi.getKanban(payload, perColumn?)` wrapper.
- `src/lib/supabase-recruits.ts` — add `recruitsSupabaseApi.getKanban(filters, perColumn?)` wrapper.
- `src/lib/contactsFilters.ts` — small helper to derive the Kanban payload (status nulled) from the table payload; keep ONE source of truth.
- `src/components/contacts/ContactKanbanBoard.tsx` — accept stage data (`{status,total,cards}[]`) + `pipelineStages` (ordered, for column order/color) instead of a flat `contacts` array + `statusColors` map; render full `total` counts, the bounded-slice "showing X of N" note, and an explicit **Unmapped** column. (Watch the <200-line component rule — may extract `KanbanColumn` to its own file.)
- `src/pages/Contacts.tsx` — add a Kanban fetch (triggered when `view==='kanban'` for Leads/Recruits) into new `leadKanban`/`recruitKanban` state; pass stages + ordered `pipeline_stages` to the board; refetch Kanban after a drag/drop status change (replace the page-local in-place mutation for the Kanban path); keep table path unchanged.
- `src/integrations/supabase/types.ts` — regenerated post-apply (CP that applies the migration), temp casts removed.

**Backend**
- `supabase/migrations/<ts>_contacts_kanban_aggregates.sql` — the two RPCs above (authored as a FILE at CP2; applied only after review).

**Explicitly NOT touched:** all Build 2 table/sort/bulk/matching-IDs code paths, `search_contacts_*` / `_contacts_filtered_*` (reused, not modified), Clients (stay list-only), Dialer/Twilio, queue claim/advance, import-undo/conversion RPCs, permissions/RLS, `pipeline_stages` data (duplicate `sort_order` / `"New "` trailing space left as-is, handled in UI).

---

## 7. Tests to add/update

- **`src/lib/__tests__/contactsKanban.test.ts` (new):** Kanban payload derivation (status forced null, scope/filters preserved); wrapper parses `{stages,total,cards}` shape; grand-total equals sum of stage totals; unmapped status surfaced; per-column slice respected.
- **`ContactKanbanBoard` render test (extend `contactsRender.test.tsx` or new):** renders a column per configured stage in `sort_order` (deterministic tiebreak), shows full `total` (not card count), renders the Unmapped column for an off-stage status, "showing X of N" when truncated.
- **SQL integration test** (run on a local stack / approved dev branch, transactional `ROLLBACK`): for a fixture set, `get_contacts_lead_kanban` per-status `total`s sum to `search_contacts_leads` `total_count` under the same filters; per-column slice ≤ N; unmapped status returned; RLS scoping (an out-of-scope lead excluded); ACLs (anon denied, authenticated allowed).
- Keep `vitest` green (currently 279/279) and `npx tsc --noEmit` clean.

---

## 8. Production safety notes

- Both RPCs are **read-only `STABLE` `SECURITY INVOKER`** — no data mutation, no schema change, no RLS change, no new tenant-exposure surface (same trust model as `search_contacts_*`).
- Reuses the canonical filtered set → cannot diverge from table scoping/RLS.
- Payload bounded by `p_per_column` clamp; counts are cheap `count(*)`/`group by` over the already-filtered id set.
- Drag/drop continues to persist exactly as today (`leadsSupabaseApi.update` / `recruitsSupabaseApi.update`); the only change is a Kanban **refetch** after the write so counts stay truthful (no new write path, Dialer/queue untouched).
- Apply on a dev branch first if the full-history replay allows; otherwise validate on a local stack / faithful harness (the project's known branch-replay debt — Build 3 precedent). Prod is never the first DB to run the new SQL.

---

## 9. Rollout checkpoints

- **CP1 (this) — DONE:** audit + plan. No code, no SQL, no branch, no commit. **HOLD for approval.**
- **CP2:** create Build 4 branch off latest `main`; implement §6 frontend; author the §5 migration as a FILE; add §7 tests; `tsc` + `vitest` + targeted ESLint + `git diff --check`. **Stop for migration review.**
- **CP3:** validate SQL on local/dev → apply migration to prod → advisors + function/ACL/plan inspection + read-only count parity (Kanban grand-total == table total) → regenerate `types.ts` + drop casts → re-typecheck/test. **Hold.**
- **CP4:** commit (Build-4 files only) → PR → merge → Vercel deploy → non-destructive smoke → newest-first `WORK_LOG.md` entry + context snapshot.

---

## 10. Risks & fallback plan

| Risk | Mitigation / fallback |
|---|---|
| Hydrating cards for every stage too heavy at volume | Bounded per-column slice (`p_per_column`, clamped) + exact counts; UI shows "X of N". |
| Duplicate `pipeline_stages.sort_order` (prod has 2 pairs) → unstable column order | Deterministic UI tiebreak (`sort_order, name, id`); do **not** mutate settings data (out of scope; flag to Chris separately). |
| `"New "` trailing-space recruit stage won't match `"New"` recruits | Unmapped column catches it; flag as a settings data-hygiene item (out of scope to auto-edit). |
| Status filter + Kanban contradiction | Kanban ignores single-status filter (D1); consider disabling/relabeling the status filter while in Kanban (UI nicety, decide at CP2). |
| Branch replay can't validate SQL | Local stack / faithful harness (Build 3 precedent); prod never first. |
| Component exceeds 200-line rule | Extract `KanbanColumn` (and card list) into its own file. |
| Rollback | Frontend `git revert`; `REVOKE`+`DROP` the two additive RPCs (no schema/data to unwind). |

---

## 11. Decisions — LOCKED by Chris (2026-06-22)

- **D1 — Status filter in Kanban:** Kanban **ignores** the single-status filter (forces `status=null`) **and greys-out / disables** the status-filter control while in Kanban view. ✅
- **D2 — Per-column card limit:** default **N=50** with exact counts + "showing 50 of N". ✅
- **D3 — Unmapped statuses:** render an **explicit "Unmapped" column** at the end with its own count; records never disappear. ✅
- **D4 — Drag targets:** drag updates `leads.status`/`recruits.status` to the target stage **name**; dragging *into* Unmapped is **disabled** (no canonical target name). ✅ (Implied by D3; confirm only if you want drag-into-Unmapped allowed.)
- **D5 — Settings data hygiene:** **leave the data** (duplicate `sort_order` pairs; recruit `"New "` trailing space); UI orders deterministically (`sort_order, name, id`) and the Unmapped column catches the trailing-space mismatch. Both flagged to Chris separately, **not** auto-edited this build. ✅

---

## 12. Process gate

CP1 produced this plan and a read-only audit only. **No implementation file edited, no migration authored or applied, no branch/commit/PR/deploy, no Supabase mutation.** Approved by Chris (D1–D5 locked).

---

# CHECKPOINT 2 — Implementation summary (2026-06-22)

## 13. What shipped on-branch (nothing applied/committed)

### Data contract (final)
- One Kanban fetch per board returns jsonb `{ grand_total, per_column_limit, stages: [{ status, total, cards }] }`.
- `total` per status = **exact full filtered count** (not the page slice). `cards` = bounded slice (≤ `per_column_limit`, default 50). `grand_total = Σ total` = the table's `total_count` for the same filters (status ignored).
- Frontend types/helpers in `contactsFilters.ts`: `KanbanStageData<T>`, `KanbanResult<T>`, `toLeadKanbanPayload` (drops `status` → null + drops pagination), `parseKanbanResult`.
- Column assembly + drag rules are pure + unit-tested in **`src/lib/contactsKanban.ts`** (`buildKanbanColumns`, `resolveDragTarget`, `orderPipelineStages`, `COLUMN_DROP_PREFIX`, `UNMAPPED_KEY`).

### Migration SQL summary — `supabase/migrations/20260622120000_contacts_kanban_aggregates.sql` (FILE ONLY, NOT applied)
- `public.get_contacts_lead_kanban(p_filters jsonb, p_per_column int DEFAULT 50)` and `public.get_contacts_recruit_kanban(...)`.
- `LANGUAGE sql STABLE` **`SECURITY INVOKER`**, `SET search_path = public, pg_temp`.
- Reuse the canonical `_contacts_filtered_leads` / `_contacts_filtered_recruits` after **stripping the `status` key** (`COALESCE(p_filters,'{}'::jsonb) - 'status'`) so Kanban ignores the single-status filter (D1) and keeps every other filter/scope identical to the table (RLS applies to the caller).
- `p_per_column` clamped `LEAST(GREATEST(n,1),200)`. Per-status `count(*)` (exact) + `row_number()` per-status slice (bounded). Lead cards hydrate `attempt_count`/`last_disposition` exactly like `search_contacts_leads`. Statuses are returned verbatim (null/off-stage included → UI Unmapped column).
- **Grants:** `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated, service_role` — mirrors the existing `search_contacts_*` posture (owner postgres). `NOTIFY pgrst`.

### Drag/drop behavior (D4)
- Every column is an explicit `useDroppable` (empty / zero-card / truncated columns are real targets — fixes the old "drop only over a card" bug).
- Drop on a column → set status to that stage name; drop over a card → that card's column status. Dropping **into Unmapped is disabled**; dragging **out of Unmapped into a real stage is allowed**. Unchanged status / unknown target → no-op.
- After any move: `leadsSupabaseApi.update` / `recruitsSupabaseApi.update`, then **refetch the board** (success or failure) so counts/slices are truthful and a failed move snaps the card back. No optimistic Kanban mutation (no stale illusion). Table page array + selected-contact detail kept in sync.

### Recruit status-filter decision (CP2 item 6)
- **The UI does NOT currently expose recruit status filtering** — the filter modal's Status section is gated `activeTab === "Leads"`, and `_contacts_filtered_recruits` has no status filter (it only sorts by status). So there is **no table-vs-Kanban inconsistency to fix**. Per the CP2 guidance ("wire it *if the UI currently exposes it*"), recruit status filtering is **intentionally left unexposed** (adding a net-new filter is out of Build 4's list/Kanban-consistency scope). Recruit Kanban is still correct: columns = statuses, exact full counts. Documented as a deferred enhancement.

### D1 status-filter UX
- `ContactsFilterModal` gains `disableStatus`; Contacts passes `disableStatus={view === "kanban"}` → the Status select is greyed/disabled with a hint while in Kanban.

## 14. Files touched (CP2)
**New:** `supabase/migrations/20260622120000_contacts_kanban_aggregates.sql`, `src/lib/contactsKanban.ts`, `src/components/contacts/KanbanColumn.tsx`, `src/lib/__tests__/contactsKanban.test.ts`, `src/components/contacts/__tests__/ContactKanbanBoard.test.tsx`, `supabase/tests/contacts_kanban_integration.sql`.
**Edited:** `src/lib/contactsFilters.ts`, `src/lib/supabase-contacts.ts`, `src/lib/supabase-recruits.ts`, `src/components/contacts/ContactKanbanBoard.tsx` (rewritten to new contract), `src/components/contacts/ContactsFilterModal.tsx`, `src/pages/Contacts.tsx`, `implementation_plan.md`.
**Untouched (preserved):** all Build 2 table/sort/bulk/matching-IDs paths, `search_contacts_*` / `_contacts_filtered_*` (reused), Clients (list-only), Dialer/Twilio/queue, import-undo/conversion. `types.ts` regen deferred to post-apply (narrow casts used now).

## 15. Tests added
- `contactsKanban.test.ts` (19): payload derivation (status/pagination dropped, filters/scope/sort preserved), `parseKanbanResult` shape/coercion/null-status, deterministic order, `buildKanbanColumns` (exact totals vs card count, Unmapped append, no-Unmapped case), `resolveDragTarget` (empty/truncated drop, over-card, Unmapped no-op, drag-out-of-Unmapped, unchanged/unknown no-op).
- `ContactKanbanBoard.test.tsx` (4): column order, exact full count vs visible cards + "Showing X of N", off-stage records kept in Unmapped, error panel.
- `contacts_kanban_integration.sql` (PENDING-EXECUTION on harness/branch): grand_total parity with `search_contacts_leads`, Σ totals, status-ignored, unmapped returned, bounded slice vs exact total, org scoping, recruit parity, anon/authenticated ACLs.

## 16. Verification results
- `npx tsc --noEmit` clean · `npx vitest run` **302/302** · targeted ESLint **0 errors / 30 benign warnings** (pre-existing unused-disable + pre-existing exhaustive-deps) · `git diff --check` clean.
- **Read-only prod smoke (no mutation, no function created):** acting as a real org Admin over the existing `_contacts_filtered_leads`, the CP2 aggregation returns `grand_total = 517` == `search_contacts_leads.total_count = 517` (New 515 / Lost 2, no unmapped); with `p_per_column=1` each column hydrates 1 card while totals stay exact. Headline page-local defect proven fixed.

## 17. SQL validation needs
- The two RPCs are NOT applied. Per the project's known branch-replay debt (`main` reports `MIGRATIONS_FAILED`), CP3 validation runs `contacts_kanban_integration.sql` on a **local stack or a faithful harness branch** (Build 3 precedent) before applying to prod — prod is never the first DB. The read-only prod smoke above already de-risks the core aggregation.

## 18. Next checkpoint (CP3 — only on approval)
Validate SQL on local/dev → apply `20260622120000` to prod → advisors + function/ACL/plan inspection + read-only count parity → regenerate `types.ts` + drop casts → re-typecheck/test → hold. Then CP4: commit (Build-4 files only) → PR → merge → Vercel deploy → smoke → newest-first `WORK_LOG.md` shipped entry.

## 19. CP2 process gate
Implemented on-branch only. **Migration NOT applied, no production mutation, nothing committed/pushed/PR'd/merged/deployed.** Awaiting migration review before CP3.

---

# CHECKPOINT 3A — Non-production validation (2026-06-23)

**Migration SHA-256:** `5dd8b5e30817ba8da55d675a9143ca6a82a2a97cfd3c486f7b371690714267c2` (unchanged from CP2 — no migration edit was needed).

**Harness branch:** temporary Supabase dev branch `contacts-build4-kanban-test` (id `c7d0a837-9e69-414c-92ff-858e74f54128`, ref `cnvrmucqzqboitizlwtc`), `with_data:false`, **created → validated → deleted (billing stopped)**. Replay debt confirmed (`main` + all branches `MIGRATIONS_FAILED`), so — Build 3 precedent — a faithful minimal harness was built: real `get_org_id`/`is_ancestor_of` + the four canonical contacts helpers (`_contacts_filtered_*` / `search_contacts_*`) **verbatim from prod**, plus prod-typed `leads`/`recruits`/`pipeline_stages`/`calls`/`profiles`/`organizations`. Then the exact migration was applied via `apply_migration` (result `{success:true}`).

**SQL integration suite — ALL PASSED** (`contacts_kanban_integration.sql`, MCP-executable form, assertions unchanged):
- T1 lead `grand_total` == `search_contacts_leads.total_count` (6 == 6, status-less).
- T2 Σ stage totals == grand_total.
- T3 single-status filter ignored (adding `status:"Quoted"` left grand_total unchanged).
- T4 unmapped `Legacy` status returned with exact count (1).
- T5 `p_per_column=1` → New column hydrates 1 card while total stays exact (3).
- T6 org/scope: org-B lead excluded (grand_total stayed 6).
- T7 recruit `grand_total` == `search_contacts_recruits.total_count` (3 == 3).
- T8 ACLs: authenticated ✓ both; anon ✗ both.

**RPC inventory (branch):** both functions `security_definer=false` (**INVOKER**), `provolatile='s'` (**STABLE**), `proconfig=search_path=public, pg_temp`; `has_function_privilege` → PUBLIC ✗ / anon ✗ / authenticated ✓ / service_role ✓ (mirrors `search_contacts_*`).

**No mutation:** leads/recruits/calls counts identical before/after 4 RPC calls.

**EXPLAIN (ANALYZE):** branch full-function call at 517 leads (index-less, worst case) = **25.8 ms**. Prod read-only EXPLAIN of the inner aggregation shape over the real `_contacts_filtered_leads` at the real 517 leads = **~181 ms**, dominated by the pre-existing helper's per-lead `calls` subqueries (the table view pays the same); the added `GROUP BY status` (HashAggregate, 2 groups) + windowed slice (`Run Condition rn<=50`) are <1 ms each; all buffers cached; no pathological scan; no new index needed.

**Advisor delta — migration-attributable: NONE.** Both new functions produce **zero** findings (INVOKER + anon revoked → not flagged). Security: 6× `rls_disabled_in_public` (harness tables created without policies — prod has RLS), `extension_in_public`(ltree, harness), `anon/authenticated_security_definer_function_executable` on `is_ancestor_of` (a prod helper recreated in the harness) — all **harness artifacts**. Performance: 1 INFO `auth_db_connections_absolute` (branch infra default).

**Repo (post-validation):** `tsc` clean · `vitest` **302/302** · targeted ESLint **0 errors / 30 benign warnings** · `git diff --check` clean.

**CP3A gate:** Migration **NOT applied to production**; branch deleted; nothing committed/pushed/PR'd/merged/deployed. Awaiting **CP3B** production-apply approval → apply to prod → advisors/ACL/EXPLAIN inspection + read-only parity → regenerate `types.ts` + drop casts → re-typecheck/test → hold; then CP4 commit/PR/merge/deploy + WORK_LOG shipped entry.

---

# CHECKPOINT 3B — Production apply (2026-06-23)

**Pre-apply guard (all passed):** on branch `claude/contacts-build4-kanban-consistency`; file `supabase/migrations/20260622120000_contacts_kanban_aggregates.sql` SHA-256 `5dd8b5e30817ba8da55d675a9143ca6a82a2a97cfd3c486f7b371690714267c2` (exact); migration not previously recorded (`migration_recorded=0`); neither RPC pre-existed (0/0); only Build 4 source + checkpoint docs modified since CP3A (the `seed-test-leads.mjs`/voice-bridge files are pre-existing/unrelated). Migration body = the two read-only RPCs + REVOKE/GRANT + NOTIFY only (no table/data/RLS/edge/Twilio/Clients).

**Applied to prod** (`jncvvsvckxhqgqvkppmj`) via `apply_migration` name `contacts_kanban_aggregates` → `{success:true}`. **Recorded MCP version `20260623164242`** (the MCP assigns its own timestamp version; the on-disk filename stays `20260622120000` — same dual-version pattern as Build 3).

**Post-apply schema/RPC verification (read-only):**
- Both RPCs live, signature `(p_filters jsonb, p_per_column integer DEFAULT 50) → jsonb`; `prosecdef=false` (**INVOKER**), `provolatile='s'` (**STABLE**), `proconfig=search_path=public, pg_temp`; PUBLIC ✗ / anon ✗ / authenticated ✓ / service_role ✓ (matches `search_contacts_*`).
- **No data/schema change:** leads 517, recruits 0, calls 85, clients 0, wins 0, pipeline_stages 13 — all unchanged vs pre-apply baseline; public tables 92 / indexes 338 / policies 292 — unchanged (no new tables/indexes, no RLS changes); functions 224 → **226** (exactly the +2 RPCs).

**Read-only production parity (acting as a real org Admin; GUC reset after):**
- Lead Kanban `grand_total` **517 == 517** `search_contacts_leads.total_count`; Σ stage totals **517**; breakdown **New {total 515, cards 50}** + **Lost {total 2, cards 2}** (full count with bounded slice — the page-local defect, fixed); `p_per_column=1` → max **1** card/column, totals still **517**; **unmapped = 0** (honest — current New+Lost both map). Recruit Kanban **0 == 0**. Leads **517**, recruits **0** unchanged.

**EXPLAIN (prod, ANALYZE):** deployed `get_contacts_lead_kanban` at 517 leads = **~31 ms**, all buffers cached, no pathological scan, no new index needed (cost dominated by the shared `_contacts_filtered_leads` helper the table view also uses).

**Advisor delta — migration-attributable: NONE.** Both new functions are **absent** from every security and performance finding (grep-confirmed). Security: 2 ERROR (pre-existing `app_config` + `webhook_debug_log` `rls_disabled_in_public`) + 189 WARN (pre-existing DEFINER-executable / search-path-mutable on other functions; mine in neither, being INVOKER + search_path-set). Performance: 416 lints, all pre-existing categories (unused_index/unindexed_fk/rls_initplan/permissive_policies/duplicate_index/auth-conn) — my migration adds no index/table/policy.

**Generated types:** `src/integrations/supabase/types.ts` regenerated from prod — diff is **+8 lines, 0 removed**, exactly `get_contacts_lead_kanban` + `get_contacts_recruit_kanban` (`Args: { p_filters: Json; p_per_column?: number }`, `Returns: Json`); no unrelated drift. Removed the broad `(supabase as any)` cast from both `getKanban` wrappers → typed `supabase.rpc(...)`; kept a narrow `p_filters … as unknown as Json` (required — the filter payload interfaces aren't structurally `Json`; Build 3 precedent) + added `import type { Json }`. Pre-existing Build 2 `search_contacts_*` casts left untouched (out of scope).

**Repo (post-CP3B):** `tsc` clean · `vitest` **302/302** · targeted ESLint **0 errors / 28 benign warnings** (2 fewer — the removed casts) · `git diff --check` clean.

**CP3B gate:** Migration **live in prod**; **frontend NOT deployed** (new RPCs reachable only from the un-deployed Build 4 frontend; existing paths unaffected); nothing committed/pushed/PR'd/merged/deployed; Build 5/6 not started. Awaiting **CP4** approval → commit (Build-4 files only) → PR → merge → Vercel deploy → non-destructive smoke → WORK_LOG shipped entry.
