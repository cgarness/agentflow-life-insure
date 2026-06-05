# Implementation Plan — Control Center → Tracker (full build)

**Owner:** Chris Garness · **Branch:** `claude/control-center-tracker-build-6WzAF` · **Date:** 2026-06-05
**Status:** ⛔ AWAITING APPROVAL — no files will be created/edited and NO migration will be applied until Chris explicitly approves this plan.

---

## 0. Pre-work findings (done)

Read `AGENT_RULES.md`, `VISION.md`, and the newest `WORK_LOG.md` entries in full. Inspected the live Control Center to copy patterns exactly. Key facts that shape this build:

- **Route guard:** `PlatformAdminRoute` (uses `useIsPlatformAdmin()` → `realProfile.platform_role === 'platform_admin'`). All `/control-center/*` routes mount inside it, **outside** the CRM `AppLayout` (`src/App.tsx` ~line 182). Tracker mounts the same way.
- **Layout/sidebar:** `ControlCenterLayout` renders `ControlCenterSidebar` (static `NAV` array). I add one `{ label: "Tracker", icon: ClipboardList, to: "/control-center/tracker" }` entry **after** Runtime. Visibility is already gated because the whole sidebar only renders behind `PlatformAdminRoute`.
- **RLS pattern (MUST mirror):** `control_center_v1.sql` enables RLS and creates 4 policies per table (`select/insert/update/delete TO authenticated USING/ WITH CHECK (public.is_platform_admin())`), with `DROP POLICY IF EXISTS` guards. `is_platform_admin()` reads `profiles` directly (not JWT). `organization_id` is nullable, FK → `organizations(id) ON DELETE CASCADE`, records are platform-global. **This is the exact shape I copy** — NOT `get_org_id()`.
- **updated_at trigger:** existing CC tables use `extensions.moddatetime(updated_at)` (a `BEFORE UPDATE` trigger). I reuse this same function — no new `set_updated_at()` needed (satisfies the "reuse if it exists" instruction).
- **Hooks pattern:** TanStack Query, `enabled: isPlatformAdmin`, `supabase.from(TABLE as never)`, `.maybeSingle()` on insert/update returns, `invalidateQueries` on success. (`useControlCenterFeatures.ts`.)
- **UI primitives available:** `SummaryCard`, `StatusBadge`, `SeverityBadge`, `EmptyState`, shadcn `Tabs` (`src/components/ui/tabs.tsx` exists), `Dialog`, `Select`, `Switch`, `Table`, `Input`, `Textarea`, `Button`, `AlertDialog`, `sonner` toast. Dark styling: `bg-slate-950/900`, `text-slate-100`, `ring-slate-800`, accent `sky/indigo`.
- **Types pattern:** hand-typed row interfaces in `src/lib/control-center/types.ts` + vocab constants in `constants.ts`. I create **separate** `trackerTypes.ts` (constants + labels + tones + row types) and `trackerSchema.ts` (Zod) so I do **not** touch existing CC constants/types behavior.
- **Latest migration on disk:** `20260604190000_advance_campaign_lead_rpc.sql`. So my schema timestamp is free to be `20260605120000`.

---

## 1. Migration (schema only — I do NOT write the seed)

**File:** `supabase/migrations/20260605120000_control_center_tracker_schema.sql`

> Chris commits the seed **after** this, e.g. `20260605130000_control_center_tracker_seed.sql` (any timestamp **> 20260605120000** so schema runs first). My column / constraint / check-value names below are authored to match the seed's `ON CONFLICT` unique keys exactly. If Chris's seed already has a fixed filename/timestamp, I will only ensure mine sorts earlier.

Creates the 5 tables EXACTLY as specified in the task (names, types, nullability, CHECKs, FKs, defaults, unique keys):

1. `control_center_tracker_systems` — unique `system_key`; status/priority/marketable CHECKs.
2. `control_center_tracker_items` — FK `system_id` → systems `ON DELETE CASCADE`; `unique (system_id, item_key)`.
3. `control_center_tracker_issues` — unique `issue_key`; FK system `ON DELETE SET NULL`, FK item `ON DELETE SET NULL`; severity/status CHECKs.
4. `control_center_tracker_marketing_claims` — unique `claim_key`; reality_status/action_needed/priority CHECKs; FK system `ON DELETE SET NULL`.
5. `control_center_tracker_references` — unique `ref_key`; kind CHECK; FK system + item `ON DELETE SET NULL`. (No `updated_at` → no moddatetime trigger.)

CHECK vocab (verbatim from task):
- status: `not_started|in_progress|needs_work|broken|complete|deferred`
- priority: `critical|high|medium|low`
- marketable: `yes|partial|no|unknown`
- issue_severity: `critical|high|medium|low|info`
- issue_status: `open|investigating|fix_in_progress|resolved|ignored`
- reality_status: `accurate|partial|inaccurate|not_marketed`
- action_needed: `keep|update_copy|remove_claim|build_feature|hide_until_ready|defer`
- reference_kind: `doc|migration|file|rpc|edge_function|deploy|url`

Plus: indexes on FKs + common filter columns; `extensions.moddatetime(updated_at)` `BEFORE UPDATE` trigger on the 4 tables that have `updated_at`; `ENABLE ROW LEVEL SECURITY` + the 4-policy super-admin pattern per table (copying `cc_features_*` shape, `DROP POLICY IF EXISTS` guards, `public.is_platform_admin()`); final line `NOTIFY pgrst, 'reload schema';`.

`completion_percent` is **NOT** stored anywhere (derived in UI). `organization_id` nullable on all (platform-global).

**Apply:** only after approval, via Supabase MCP `apply_migration`, then verify Chris's seed applies cleanly on top (17 systems / 154 items / 9 claims / 7 issues / 6 refs). I will NOT hand-edit the seed.

---

## 2. Frontend files

### New — lib
- `src/lib/control-center/trackerTypes.ts` — vocab arrays + `*_LABELS` + tone maps (status/priority/marketable/issue_severity/issue_status/reality_status/action_needed/reference_kind) and row interfaces (`TrackerSystem`, `TrackerItem`, `TrackerIssue`, `TrackerMarketingClaim`, `TrackerReference`).
- `src/lib/control-center/trackerSchema.ts` — Zod schemas: `systemFormSchema`, `itemFormSchema` (system_id required), `issueFormSchema`, `marketingClaimFormSchema`.

### New — hook
- `src/hooks/useControlCenterTracker.ts` — queries (`useTrackerSystems/Items/Issues/Claims/References`) + create/update/delete mutations per entity, mirroring `useControlCenterFeatures.ts`. Exposes derived helpers: `deriveSystemCompletion(items)` and `openIssueCountBySystem`. `enabled: isPlatformAdmin`, `.maybeSingle()` on writes.

### New — page
- `src/pages/control-center/ControlCenterTrackerPage.tsx` — `Tabs` shell: Dashboard · Systems · Items · Issues · Marketing Reality · Technical Truth. Loading/empty/error handled per tab. < 200 lines (delegates to tab components).

### New — tab components (`src/components/control-center/tracker/`)
- `TrackerDashboard.tsx` — stat cards (overall completion %, systems needing attention, open critical+high issues, marketable yes/partial/no, recently reviewed 7d) + sections (launch blockers, marketing reality warnings, systems by status, recently updated).
- `TrackerSystemsTab.tsx` — search + status/priority/marketable filters; desktop `TrackerSystemsTable` + mobile cards; derived Completion% & Open Issues columns.
- `TrackerItemsTab.tsx` — search + system/status/priority/marketable + production_critical toggle; table + cards.
- `TrackerIssuesTab.tsx` — search + system/severity/status; table + cards; resolved/ignored quieter.
- `TrackerMarketingRealityTab.tsx` — search + reality_status/action_needed/priority; table + cards; non-accurate rows highlighted.
- `TrackerTechnicalTruthTab.tsx` — read-only; links to `AGENT_RULES.md`; lists references; "Copy context for Claude / Cursor" button (builds plain-text snapshot from live data → clipboard); labeled "Internal — sensitive architecture."

### New — modals / shared / cards
- `TrackerSystemFormModal.tsx`, `TrackerItemFormModal.tsx`, `TrackerIssueFormModal.tsx`, `TrackerMarketingClaimFormModal.tsx` — Zod + RHF, selects for vocab, textarea for notes, toast, `.maybeSingle()`, query invalidation. (Technical Truth has no editing.)
- `TrackerStatCard.tsx` — thin dashboard stat wrapper (keeps the named file; reuses `SummaryCard` styling underneath).
- `TrackerStatusBadge.tsx` — status/priority/marketable pills (tracker vocab; separate from CC `StatusBadge` which has different vocab).
- `cards/SystemCard.tsx`, `cards/ItemCard.tsx`, `cards/IssueCard.tsx`, `cards/MarketingClaimCard.tsx` — mobile cards (key fields, no h-scroll, thumb actions Edit / Add Issue / View Details).
- Small table components colocated: `TrackerSystemsTable.tsx`, `TrackerItemsTable.tsx`, `TrackerIssuesTable.tsx`, `TrackerMarketingTable.tsx` (keeps each tab < 200 lines). Responsive rule: tables `hidden md:block`, cards `md:hidden`.

### Updated
- `src/components/control-center/ControlCenterSidebar.tsx` — add `ClipboardList` import + NAV entry after Runtime.
- `src/App.tsx` — add import + `<Route path="/control-center/tracker" element={<ControlCenterTrackerPage />} />` inside the existing `PlatformAdminRoute`/`ControlCenterLayout` block.
- `AGENT_RULES.md` — one-line note under §3 Control Center documenting the **intentional `organization_id`-nullable / platform-global RLS exception** for `control_center_tracker_*` (so it's not "fixed" later).
- `WORK_LOG.md` — newest-first entry + Context Snapshot.
- `implementation_plan.md` — this file.

---

## 3. Derived completion (not stored)
`systemCompletion = round(100 * count(items where status='complete') / count(items))` (0 when no items). Overall completion = same formula across all items globally. Computed in the hook/UI only.

---

## 4. Out of scope (will NOT build)
No file upload / Excel import; no GitHub/Supabase/Vercel/AI auto-sync; Technical Truth read-only (links only); no agency/user-facing access. No edits to Dialer, TwilioContext, Campaigns, Settings, telephony, or existing `control_center_features/issues` behavior — tracker uses its own constants/types.

---

## 5. Verification
- `npx tsc --noEmit` → 0 errors.
- Schema migration applies; then Chris's seed applies with no errors (17/154/9/7/6).
- Manual: `/control-center/tracker` loads for platform admin, blocked for others; sidebar item gated; Dashboard derived %/blockers/warnings; Systems completion% + open-issue counts derive; Items 154 visible + filters; Issues 7 + quieter resolved; Marketing 9 + non-accurate highlighted; Technical Truth links + references + Copy context; mobile ≈390px all-cards no h-scroll; RLS on all 5 tables matches CC pattern; no service_role/secrets on frontend; existing CC pages unchanged.

---

## 6. Open questions for Chris (please confirm before I start)
1. **Seed filename/timestamp:** OK to use schema `20260605120000_control_center_tracker_schema.sql` and have your seed sort after it (e.g. `20260605130000_…`)? Or do you already have a fixed seed filename I should sort before?
2. **Apply path:** Apply the schema migration to prod via Supabase MCP `apply_migration` as part of this task, or will you `supabase db push` it yourself alongside your seed?
3. Anything else in-flight touching Control Center I should rebase on first? (Newest WORK_LOG shows none — confirming.)

⛔ **I will not create/edit any file or run any migration until you reply "approved" (or with changes).**
