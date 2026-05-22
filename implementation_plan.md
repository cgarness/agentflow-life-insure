# AgentFlow Control Center v1 — Implementation Plan

**Branch:** `claude/control-center-v1-jQfHc`
**Owner:** Chris Garness | Drafted: 2026-05-22
**Status:** [DRAFT — awaiting Chris approval before any file/DB changes]

---

## 1. Goal & Scope

Build a separate, platform-admin-only "Control Center" experience for monitoring AgentFlow itself — feature/build status, known issues, and health checks. **Not** an agency CRM surface.

**Scope IN (v1):**
- New platform-level role `platform_admin` on `profiles.platform_role`.
- New route group `/control-center/...` with its own shell, sidebar, and routing guard.
- Four pages: Overview, Feature Tracker, Issue Tracker, Health Checks.
- 4 new tables + 1 column on `profiles`. All RLS-restricted to `platform_admin`.
- Empty-state UX only (no seeded mock data in production paths).
- Manual "Run Checks" is **stubbed** in v1 (UI + status persistence only — no live probes).

**Scope OUT (v1):**
- No live probes against Twilio / Supabase / Vercel / dialer / workflows.
- No cross-org analytics, no telemetry rewrites.
- No changes to the dialer, `TwilioContext`, calls, dispositions, or webhook flow.
- No edits to agent/agency role strings or RLS for existing tables.
- No CRM/agency surfaces touched.

---

## 2. Conflict Check (WORK_LOG)

| Recent entry | Conflict? | Decision |
|---|---|---|
| 2026-05-20 [DONE] Remove Project Status super-admin tab | High awareness — must NOT resurrect the old `project_status_overlays` / sidebar pattern | We build under a **new** namespace `control_center_*` with its own route group, own shell, own UI. Zero reuse of `project_status` names, routes, or components. |
| 2026-05-21 system_status table (`20260521000000_create_system_status.sql`) | Overlaps partly with "Health Checks" concept | Leave `system_status` untouched in v1. It is read-by-all and edited only by super admin. v1 Control Center has its own richer registry; we can consolidate later if Chris wants. Will note in WORK_LOG as future cleanup. |
| Phase 4a get-active-calls (2026-05-21) | None — different problem space | n/a |
| Workflow + cron tech debt (AGENT_RULES §11) | None | n/a |

No `[IN PROGRESS]` items conflict.

---

## 3. Product Decisions

### 3.1 Role model — least invasive

Add nullable `profiles.platform_role text` with CHECK `(platform_role IS NULL OR platform_role IN ('platform_admin'))`. Future values (`platform_manager`, `platform_viewer`) can extend the CHECK in a follow-up migration.

**Bridging existing `is_super_admin`:** v1 will NOT auto-promote super admins to `platform_admin`. They are conceptually different (super admin = AgentFlow staff with cross-org tenant power; platform_admin = AgentFlow staff with internal ops visibility). Chris will set `platform_role='platform_admin'` on the one or two profiles that need it. Migration is read-only for existing profiles.

Decision documented inline in the migration header and added to a future `AGENT_RULES.md` Section 3 note (proposed in this plan, applied only after approval).

### 3.2 Route + guard

- Add `/control-center`, `/control-center/features`, `/control-center/issues`, `/control-center/health`.
- Routes live **outside** the existing `<AppLayout />` route element — they use a fresh `<ControlCenterLayout />` so the CRM sidebar/TopBar/FloatingDialer do NOT mount.
- New `<PlatformAdminRoute />` guard:
  - Loading state same pattern as `SuperAdminRoute`.
  - Unauthenticated → `/login`.
  - Authenticated but not `platform_admin` → `/dashboard` (preserves existing CRM behavior for regular users).
  - `platform_admin` → render children.
- **Default landing for platform_admins:** we do NOT redirect them away from CRM if they navigate to `/dashboard` (this would break super-admins who also happen to be platform_admins). They simply get the Control Center as a separate first-class app at `/control-center`. They can bookmark/open it directly.
  - We do NOT add a Control Center link to the regular CRM sidebar (per requirements). Access is via direct URL for v1.

### 3.3 JWT claim

`platform_role` does **not** need to be in the JWT for v1. RLS will check `profiles.platform_role` via a new SQL helper `public.is_platform_admin()` that selects on `auth.uid()`. This avoids touching `custom_access_token_hook` (which would require reissuing every active session). Frontend reads `profile.platform_role` directly.

### 3.4 Empty states & data

No seed rows. Both lists render empty-state cards with explanatory copy. Create/edit forms are wired with Zod, but Chris adds records as he likes.

---

## 4. Database Migrations (NEW)

Single migration file, applied in one transaction after Chris approves:

**`supabase/migrations/20260522120000_control_center_v1.sql`**

Contents (in order):

1. `ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS platform_role text NULL;`
2. `ALTER TABLE public.profiles ADD CONSTRAINT profiles_platform_role_check CHECK (platform_role IS NULL OR platform_role IN ('platform_admin'));`
3. `CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND platform_role = 'platform_admin'); $$;`
4. `CREATE TABLE public.control_center_features (...)` — fields/statuses/priorities per spec.
5. `CREATE TABLE public.control_center_issues (...)` — fields/severities/statuses/sources per spec; FK to features on `ON DELETE SET NULL`.
6. `CREATE TABLE public.control_center_health_checks (...)` per spec.
7. `CREATE TABLE public.control_center_health_check_runs (...)` per spec; FK to health checks on `ON DELETE CASCADE`.
8. CHECK constraints for status/priority/severity/source/check_type enums on each table.
9. Indexes: `(organization_id)`, `(status)`, `(severity)` on features/issues; `(check_key)`, `(status)`, `(is_enabled)` on health checks; `(health_check_id, started_at DESC)` on runs.
10. Triggers: `updated_at` auto-bump using existing `public.set_updated_at()` if it exists in the repo, otherwise inline.
11. `ENABLE ROW LEVEL SECURITY` on all four new tables.
12. Policies — single policy per table per command (`USING (public.is_platform_admin())`, `WITH CHECK (public.is_platform_admin())` for write). No other roles get access.
13. `NOTIFY pgrst, 'reload schema';`

**Type regeneration:** after migration is applied, regenerate `src/integrations/supabase/types.ts` via Supabase MCP `generate_typescript_types` so Control Center hooks/components are typed end-to-end.

---

## 5. Files to be Created / Modified

### Created

**Backend / DB**
- `supabase/migrations/20260522120000_control_center_v1.sql`

**Routing & guard**
- `src/components/auth/PlatformAdminRoute.tsx` — guard component (mirrors `SuperAdminRoute.tsx`).

**Layout shell**
- `src/components/control-center/ControlCenterLayout.tsx` — page shell with own sidebar; no FloatingDialer, no CRM TopBar.
- `src/components/control-center/ControlCenterSidebar.tsx` — separate top-level nav (Overview / Features / Issues / Health).

**Pages (each < 200 LOC, lean on subcomponents)**
- `src/pages/control-center/ControlCenterOverviewPage.tsx`
- `src/pages/control-center/ControlCenterFeaturesPage.tsx`
- `src/pages/control-center/ControlCenterIssuesPage.tsx`
- `src/pages/control-center/ControlCenterHealthPage.tsx`

**Reusable Control Center components**
- `src/components/control-center/StatusBadge.tsx` — feature/issue/health badge variants.
- `src/components/control-center/SeverityBadge.tsx`
- `src/components/control-center/SummaryCard.tsx` — stat card for Overview.
- `src/components/control-center/EmptyState.tsx` — shared empty-state card.
- `src/components/control-center/features/FeatureTable.tsx`
- `src/components/control-center/features/FeatureFormModal.tsx` (Zod)
- `src/components/control-center/issues/IssueTable.tsx`
- `src/components/control-center/issues/IssueFormModal.tsx` (Zod)
- `src/components/control-center/health/HealthChecksTable.tsx`
- `src/components/control-center/health/HealthCheckFormModal.tsx` (Zod)
- `src/components/control-center/health/RunChecksButton.tsx` — v1 stub (sets `status='unknown'`, `last_run_at=now()`, inserts a run row with `status='unknown'`, `result_summary='Manual run (stub — no probes wired in v1)'`).

**Data hooks**
- `src/hooks/useControlCenterFeatures.ts`
- `src/hooks/useControlCenterIssues.ts`
- `src/hooks/useControlCenterHealthChecks.ts`
- `src/hooks/useIsPlatformAdmin.ts` — reads `profile.platform_role`.

**Schemas (Zod)**
- `src/lib/control-center/featureSchema.ts`
- `src/lib/control-center/issueSchema.ts`
- `src/lib/control-center/healthCheckSchema.ts`
- `src/lib/control-center/constants.ts` — enum lists shared with badges/forms.

### Modified

- `src/App.tsx` — register `/control-center/*` routes under a new `<PlatformAdminRoute><ControlCenterLayout /></PlatformAdminRoute>` route element. **No changes** to existing CRM routes.
- `src/contexts/AuthContext.tsx` — add `platform_role: string | null` to the `Profile` interface (typing only, no behavior change).
- `src/lib/profile-fetch-columns.ts` — append `"platform_role"` to `PROFILE_FETCH_FALLBACK_SELECT`.
- `src/integrations/supabase/types.ts` — regenerated after migration; do not hand-edit.
- `WORK_LOG.md` — newest-first entry.
- `implementation_plan.md` — this document.

### NOT touched

- `src/contexts/TwilioContext.tsx`, `DialerPage.tsx`, dialer hooks/components, calls/webhooks edge functions.
- `src/components/layout/Sidebar.tsx`, `TopBar.tsx`, `AppLayout.tsx`, `Navigation`, `usePermissions.ts`, `permissionDefaults.ts`.
- Any existing role string / RLS policy on agency tables.
- `system_status` table (untouched in v1).
- `is_super_admin` behavior.

---

## 6. UI Style Notes

- Reuse shadcn primitives already in repo: `Card`, `Badge`, `Button`, `Table`, `Tabs`, `Dialog`, `Input`, `Select`, `Switch`, `Tooltip`, `AlertDialog`. No new dep.
- Dark "command-center" palette (slate-900 sidebar matching existing CRM aesthetic), but **structurally separate** from CRM nav.
- Badge color mapping (Tailwind tokens only): live=emerald, in_progress=sky, testing=violet, blocked/broken=rose, live_with_issues=amber, deprecated=zinc, planned/not_started=slate; severity: critical=rose-600, high=amber-500, medium=sky-500, low=slate-400, info=zinc-300; health: healthy=emerald, degraded=amber, failing=rose, unknown=slate, disabled=zinc.
- Every list uses a clear empty-state copy ("No features tracked yet. Click 'Add feature' to get started.") — NO mock data.

---

## 7. Verification Plan

After implementation:

1. `npx tsc --noEmit` — must be clean.
2. Manual checklist (run locally in browser after dev server up):
   - a. Visit `/control-center` as a non-platform user → redirected to `/dashboard`.
   - b. Set `profiles.platform_role='platform_admin'` on Chris's profile, refresh, visit `/control-center` → renders.
   - c. `/dashboard`, `/dialer`, `/calendar`, `/campaigns` still load and behave normally for a regular agent (no Control Center link in sidebar, no layout regression).
   - d. Features / Issues / Health Checks pages render empty state, "Add" modals open, Zod validation errors surface.
   - e. Create one feature → appears in table; edit + status change persists.
   - f. Create one issue with linked feature → renders.
   - g. Create one health check; "Run Checks" stub creates a run row with `result_summary='Manual run …'`.
   - h. SQL spot-check (Supabase MCP `execute_sql`, read-only): as a non-platform user (via test profile flag), `SELECT * FROM public.control_center_features` returns 0 rows / permission denied — RLS enforced.
3. Existing test suite: `npm test -- --run` to confirm no regression in tested modules.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Breaking CRM/dialer by accident | Zero edits to existing route elements, sidebar, or `TwilioContext`. New route group is mounted as a sibling. |
| Re-introducing the removed Project Status pattern | Different namespace (`control-center` vs `project-status`), different table names, different sidebar, new guard. WORK_LOG audit confirmed. |
| `is_platform_admin()` race for new platform_admins on first login | Function reads `profiles` directly, not JWT. No token refresh needed. |
| Migration applied without Chris approval | This plan blocks on approval per AGENT_RULES §8. `apply_migration` is only called after Chris says "go". |
| Health check stub being mistaken for live probes | UI button label = "Run checks (stub)" + tooltip; run rows carry explicit `result_summary` text. |

---

## 9. Order of Operations (after approval)

1. Write migration file.
2. **Pause** for Chris to say "apply migration" (or for me to apply via MCP).
3. Regenerate `supabase/types.ts` after migration succeeds.
4. Implement guard + layout + sidebar.
5. Implement hooks + Zod schemas.
6. Implement pages + form modals + tables.
7. Wire `/control-center/*` routes in `App.tsx`.
8. `npx tsc --noEmit`.
9. Manual browser verification.
10. Update `WORK_LOG.md`.
11. Propose `AGENT_RULES.md` update (Section 3 — multi-tenancy) to document `platform_role` as a platform-scope role (not agency).
12. Commit + push to `claude/control-center-v1-jQfHc`.

---

## 10. Approval Gate

**I will not write any files (other than this plan), apply any migration, or run any backend command until Chris approves.**

Ready for review.
