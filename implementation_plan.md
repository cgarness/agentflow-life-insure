# Implementation Plan — Contacts Unassigned Visibility Hardening + Add Lead Assignment Gate

**Label:** SECURITY (RLS + frontend gate)
**Status:** PLAN — awaiting Chris approval. **No app-file or Supabase mutation performed.** This is the plan-and-stop artifact required by AGENT_RULES §8 before any code/migration.
**Date:** 2026-06-29
**Branch:** `claude/contacts-unassigned-visibility-harden` (fresh off `main`@`67a9832` = PR #333 merge).
**Preflight:** Read AGENT_RULES.md, VISION.md, WORK_LOG.md, prior implementation_plan.md. Confirmed `origin/main` HEAD = `67a983211b91d2d510d56e9a82bb2dac73ac0f94` (PR #333 **MERGED** 2026-06-29T19:21:35Z; local `main` was stale). WORK_LOG still labelled #333 "PR open / awaiting review" → corrected in this branch (docs-only).
**Approval gate:** Backend change touches RLS → requires Chris `#APPROVE_RLS_CHANGE`. **No Supabase mutation until Chris approves the exact SQL.**

---

## 0. Goal (restated)

1. **Add Lead assignment selector** appears only for users who actually have an assignable agent **other than themselves** — not by role alone.
2. **Unassigned lead visibility:**
   - Admin / Super Admin → **all** org unassigned leads.
   - Team Leader → **only** unassigned leads they **personally imported/loaded**.
   - Agent → **none**.
3. Preserve all shipped Contacts Build 6 + QA Fix Pass 1 behavior. Enforce visibility in **backend/RLS**, not just frontend.

Unassigned = `leads.user_id IS NULL AND leads.assigned_agent_id IS NULL` (both null), org-scoped.

---

## 1. Diagnosis of current behavior (verified against live prod `jncvvsvckxhqgqvkppmj` + source)

### 1A. Add Lead assignment selector — gated by ROLE, not by assignable count
- The "Assign To" section mounts whenever the modal is in Add mode (`AddLeadModal.tsx:150-165`, `{!initial && (<AddLeadAssignmentSection .../>)}`), then self-gates on a **role-only** predicate:
  - `AddLeadAssignmentSection.tsx:33-36` `canPickOtherAgents(role, isSuperAdmin) → isSuperAdmin || role === "Admin" || role === "Team Leader"`; early return `if (!elevate) return null;` at `:93`.
  - Same predicate duplicated in `useAddLeadAssignableState.ts:24-25` (`canElevateLeadAssignment`).
- ⇒ **A Team Leader (or Admin) with zero downline still sees "Assign To" + a useless "Specific Agent" option** (`AddLeadAssignmentSection.tsx:98-105` renders static `Myself`/`Specific Agent`; picking Specific with a self-only list dead-ends at `validateAssignment` "Select an agent to assign." `useAddLeadAssignableState.ts:36-37`).
- The assignable set is **already computed** and already self-aware:
  - `Contacts.tsx:940-946` `assignableAgentsForAddLead` → Team Leader = `teamAgents` (RPC `get_contact_scope_agents`, self + downline), Admin/Super = `agentProfiles` (all active org profiles, incl. self, `Contacts.tsx:917`).
  - `useContactScope.ts:99` already computes `hasDownline = teamAgents.length > 1` (self + ≥1 descendant) — **returned but not consumed**.
  - The section already self-excludes when rendering the dropdown: `AddLeadAssignmentSection.tsx:116-117` `assignableAgents.filter(a => a.id !== currentUserId)`.
- **Save behavior (must preserve): manual Add Lead can NEVER create an unassigned lead.** `AddLeadModal.tsx:95-117` resolves `assignToAgentId` defaulting to `currentUserId`; only elevated + "Specific Agent" overrides; both `userId` and `assignedAgentId` are written to the same non-null id. Page save re-defaults to `user?.id` (`Contacts.tsx:1299-1322`) and errors out on an empty owner before any insert. "Unassigned" exists only as a **read-time view scope**, never a write state.

### 1B. Unassigned visibility — backend is the gate, and the unassigned pool is org-wide (the hole)
- **List path is RLS-authoritative.** `leadsSupabaseApi.getAll` → `rpc("search_contacts_leads")` → `_contacts_filtered_leads(p_filters)`. **Both functions are `SECURITY INVOKER`** (verified live) → RLS on `public.leads` is enforced for the caller; no SECURITY-DEFINER bypass. Kanban (`get_contacts_lead_kanban`) and select-all (`contacts_lead_ids_matching`) share the same helper, so list/count/Kanban/select-all cannot diverge.
- **The RPC `unassigned` branch** (`_contacts_filtered_leads`, migration `20260624120000…:272-274`): `scope='unassigned' AND org=get_org_id() AND user_id IS NULL AND assigned_agent_id IS NULL` — **no importer dimension.**
- **The authoritative RLS grant** — applied policy `leads_select_unassigned_pool` (live `pg_policies`, source `20260624120000…:203-210`):
  ```sql
  USING (
    organization_id = public.get_org_id()
    AND user_id IS NULL
    AND assigned_agent_id IS NULL
    AND public.has_contacts_permission('contacts.leads.view_unassigned')
  )
  ```
  **No importer predicate** → any role holding `view_unassigned` sees the **entire** org unassigned pool. **This is the hole.**
- **Permission defaults** (`_contacts_permission_default`, live; mirrors `permissionDefaults.ts:279-280`), `(key, agent, team_leader)`; Admin/Super short-circuit `true`:
  - `contacts.leads.view_unassigned` → Agent **false**, Team Leader **true**.
  - `contacts.leads.view_all` → Agent **false**, Team Leader **false**.
  - `role_permissions` has **no contacts overrides** in prod (all NULL) → live behavior = defaults exactly.
  - ⇒ **Agent already sees no unassigned** (✓ requirement already met); **Team Leader sees all org unassigned** (✗ — must restrict to self-imported); **Admin/Super see all unassigned** via the `view_all` short-circuit through `leads_select_view_all_pool` (`…:213-218`, all org rows) (✓ keep).
- **`is_ancestor_of(uid, NULL) = false`** → the hierarchical policy `Leads Hierarchical Access` never grants unassigned; the **only** unassigned grant is the pool policy. Tightening that one policy is sufficient and authoritative.
- **Second exposure to watch:** the **Agency** scope + `view_all` also surfaces unassigned (whole-org rows). Team Leaders don't have `view_all` by default, and we are **not** widening it, so no regression — but the design must not accidentally hand Team Leaders `view_all`.

### 1C. Provenance reality — `leads` has NO importer column; `import_history` is not RLS-grade
- **`public.leads` has zero provenance/creator columns** (verified): only `user_id`, `assigned_agent_id`, `organization_id`. No `imported_by_user_id`, `import_history_id`, `created_by`, or `source`. (`import_history_id`/`created_by` exist only on `campaign_leads`/`message_templates`.)
- The only importer signal is `import_history.agent_id` (importer) + `import_history.imported_lead_ids` (jsonb UUID-string array).
- **`import_history` is unreliable as the sole provenance source:**
  - `imported_lead_ids` is written **only by the frontend CSV path** (`ImportLeadsPage.tsx:100-101`), gated on `inserted_lead_ids.length > 0` and a recoverable history-insert; the **edge function `import-contacts` never touches `import_history`**, and `scripts/seed-test-leads.mjs` writes unassigned leads with no history row.
  - **Live data:** 517 leads / **507 unassigned** / 2 `import_history` rows — and both rows have `imported_lead_ids = []` (they're 2026-05-17 test imports predating the `import_undo_provenance` migration `20260620184619`). So the 507 unassigned came from the seed script; **none are recoverable** from `import_history`.
  - No GIN index on `imported_lead_ids`. A per-row RLS `EXISTS … jsonb_array_elements` predicate is O(leads × history) inside the hottest Contacts query path — wrong place for jsonb containment.
- ⇒ Importer-scoped RLS needs a **real, indexed importer column on `leads`** (see §3).

---

## 2. Exact proposed access rule

**Unassigned-pool SELECT (the single security boundary), for `user_id IS NULL AND assigned_agent_id IS NULL` org rows:**

| Role | Rule | Mechanism |
|------|------|-----------|
| **Super Admin** | all org unassigned | `has_contacts_permission` short-circuits `true` → `view_all` branch |
| **Admin** | all org unassigned | same (`view_all` true) |
| **Team Leader** | **only `leads.imported_by_user_id = auth.uid()`** | `view_unassigned` true **AND** importer = self |
| **Agent** | none | `view_unassigned` default false → policy fails |
| Any role w/ explicit `view_all=true` override | all org unassigned | `view_all` branch (unchanged escape hatch) |

- **"Personally imported/loaded" = `imported_by_user_id = auth.uid()` (strict self).** *(Open decision D2: optionally widen to downline-imported via `is_ancestor_of(auth.uid(), imported_by_user_id)`. Default = strict self, matching the literal requirement.)*
- **Add Lead selector** shows iff `elevate (role) AND ≥1 assignable agent other than self`. Save still always assigns (default self) — never unassigned.
- **No permission-default flip needed.** Agent already false; Team Leader stays true (pill stays) but is now row-filtered to self-imported by RLS. Admin/Super unchanged.
- **Existing 507 seeded-unassigned leads become Admin/Super-only** for Team Leaders (no recoverable importer) — this is the **correct secure posture** (no Team Leader imported them). Flagged for Chris (decision D3).

---

## 3. Existing provenance vs new schema — **NEW SCHEMA (smallest correct)**

**Decision: existing `import_history.imported_lead_ids` + `agent_id` is NOT safe/performant for a per-row RLS predicate.** Reasons: (a) population gaps — edge function + seed script don't write it, and all current rows are empty; (b) jsonb containment with no GIN index, evaluated per-row in the hottest list query; (c) append-only audit semantics (undo doesn't clear ids; nullable `agent_id`) → mis-attribution.

**Smallest correct fix — one explicit, indexed importer column on `leads`:**
- `ALTER TABLE public.leads ADD COLUMN imported_by_user_id uuid` (nullable, FK → `profiles(id) ON DELETE SET NULL`).
- Partial index `WHERE imported_by_user_id IS NOT NULL`.
- One-time backfill from `import_history.imported_lead_ids → agent_id` (recovers real post-2026-06-20 imports; recovers ~0 in the test org by design).
- Forward population: stamp `imported_by_user_id = user.id` in the import write path (`import-contacts` edge function — covers assigned **and** unassigned strategies).
- RLS predicate becomes a cheap indexed equality `imported_by_user_id = auth.uid()`.

*(`leads.import_history_id` is intentionally NOT added — not needed for the security rule; per-import grouping is out of scope. Can be added later if Chris wants it.)*

---

## 4. Exact files to touch

### Backend (needs `#APPROVE_RLS_CHANGE` + edge-deploy approval)
| # | File | Change |
|---|------|--------|
| B1 | `supabase/migrations/20260629XXXXXX_contacts_unassigned_importer_provenance.sql` *(new)* | add `leads.imported_by_user_id` + partial index + backfill; **redefine `leads_select_unassigned_pool`** (importer-scoped) `[#APPROVE_RLS_CHANGE]`; **`CREATE OR REPLACE FUNCTION _contacts_filtered_leads`** mirroring the predicate in the `unassigned` branch (keeps INVOKER RPC + RLS identical / defense-in-depth). Full SQL in §5. |
| B2 | `supabase/functions/import-contacts/index.ts` | stamp `imported_by_user_id: user.id` on every inserted lead row (esp. the unassigned strategy, `:208-291`). **Edge deploy** (run `get_edge_function` first; ship full `index.ts`). |
| B3 | `src/integrations/supabase/types.ts` | add `imported_by_user_id: string \| null` to `leads` Row/Insert/Update (regenerate types post-migration, or surgical add). |
| B4 | `supabase/tests/contacts_permissions_integration.sql` | extend T3/T4: TL sees only self-imported unassigned; TL does NOT see other-importer unassigned; Admin sees all; Agent none; backfill correctness. (Manual `psql` against LOCAL/approved BRANCH only — no automated runner; never prod.) |

### Frontend (no RLS; safe to ship independently)
| # | File | Change |
|---|------|--------|
| F1 | `src/components/contacts/AddLeadAssignmentSection.tsx` | tighten early return: `const hasOtherAssignable = assignableAgents.some(a => a.id !== currentUserId); if (!elevate || !hasOtherAssignable) return null;` (props already carry `assignableAgents` + `currentUserId`; no new data). |
| F2 | `src/components/contacts/__tests__/…` *(new/extend)* | unit/render test for the assignment-gate predicate (Agent / no-downline TL → hidden; downline TL / Admin-with-others → shown); assert hidden-section save still assigns to self. |
| F3 | *(verify-only)* `src/lib/__tests__/contactScope.test.ts` | confirm `computeAvailableScopes` still keys off `view_unassigned` (Agent → no pill) — **no code change** expected; pill stays for TL, now row-filtered by backend. |

**Explicitly NOT touched:** `DialerPage.tsx`, `TwilioContext.tsx`, queue/lock/`advance_campaign_lead`, call telemetry, conversion RPC (`convert_lead_to_client_atomic`) / Lead→Client behavior, Twilio/Dialer, AI Testing, `permissionDefaults.ts` (no default flip), Import History drill-in / Undo / Add-to-Campaign / Kanban paths (verified independent — see §6). **Dirty working-tree files** (`scripts/seed-test-leads.mjs`, `services/hypercheap-voice-bridge/*`, `.cursor/`, `tsconfig*.tsbuildinfo`) excluded from every commit.

---

## 5. Exact migration / RLS plan (proposed SQL — NOT YET APPLIED)

```sql
-- 20260629XXXXXX_contacts_unassigned_importer_provenance.sql
-- [#APPROVE_RLS_CHANGE] Tightens leads_select_unassigned_pool: Team Leaders see ONLY
-- unassigned leads they personally imported; Admin/Super-Admin keep all; Agents none.
-- Adds explicit importer provenance on leads (import_history.imported_lead_ids is not RLS-grade).

BEGIN;

-- 1. Provenance column (additive, nullable) ------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS imported_by_user_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_imported_by_user_id
  ON public.leads (imported_by_user_id)
  WHERE imported_by_user_id IS NOT NULL;

-- 2. One-time backfill from recorded import provenance -------------------------
UPDATE public.leads l
   SET imported_by_user_id = ih.agent_id
  FROM public.import_history ih,
       LATERAL jsonb_array_elements_text(ih.imported_lead_ids) AS e(lead_id)
 WHERE l.id = e.lead_id::uuid
   AND l.organization_id = ih.organization_id
   AND ih.agent_id IS NOT NULL
   AND ih.imported_lead_ids IS NOT NULL
   AND jsonb_typeof(ih.imported_lead_ids) = 'array'
   AND l.imported_by_user_id IS NULL;

-- 3. Tighten the unassigned-pool SELECT policy [#APPROVE_RLS_CHANGE] -----------
DROP POLICY IF EXISTS leads_select_unassigned_pool ON public.leads;
CREATE POLICY leads_select_unassigned_pool ON public.leads
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND user_id IS NULL
    AND assigned_agent_id IS NULL
    AND public.has_contacts_permission('contacts.leads.view_unassigned')
    AND (
      public.has_contacts_permission('contacts.leads.view_all')  -- Admin/Super/explicit view_all → ALL unassigned
      OR imported_by_user_id = auth.uid()                        -- Team Leaders → only self-imported
    )
  );

-- 4. Mirror the predicate in the canonical INVOKER list helper -----------------
--    (RLS already gates rows; mirroring keeps RPC + RLS identical and prevents
--     divergence if the helper is ever switched to SECURITY DEFINER.)
--    Full body reproduced verbatim from the applied 20260624120000 definition,
--    changing ONLY the `unassigned` branch.
CREATE OR REPLACE FUNCTION public._contacts_filtered_leads(p_filters jsonb)
RETURNS TABLE(id uuid, ord bigint)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT
      l.id, l.created_at,
      l.first_name, l.last_name, l.status, l.lead_source, l.state, l.phone, l.email,
      l.date_of_birth, l.best_time_to_call, l.last_contacted_at,
      CASE WHEN pa.id IS NULL THEN NULL
           ELSE lower(btrim(coalesce(pa.first_name,'') || ' ' || coalesce(pa.last_name,''))) END AS agent_sort,
      ( SELECT count(DISTINCT c.id) FROM public.calls c
        WHERE c.direction = 'outbound'
          AND ( c.lead_id = l.id
                OR (c.lead_id IS NULL AND c.contact_id = l.id AND (c.contact_type = 'lead' OR c.contact_type IS NULL)) )
      ) AS attempt_count,
      ( SELECT NULLIF(btrim(c.disposition_name), '') FROM public.calls c
        WHERE ( c.lead_id = l.id
                OR (c.lead_id IS NULL AND c.contact_id = l.id AND (c.contact_type = 'lead' OR c.contact_type IS NULL)) )
          AND (c.disposition_id IS NOT NULL OR btrim(coalesce(c.disposition_name,'')) <> '')
        ORDER BY c.created_at DESC NULLS LAST, c.id DESC LIMIT 1
      ) AS last_disposition
    FROM public.leads l
    LEFT JOIN public.profiles pa ON pa.id = l.assigned_agent_id
    WHERE
      (
        (coalesce(p_filters->>'scope','mine') = 'mine'   AND l.user_id = auth.uid())
        OR (p_filters->>'scope' = 'team'   AND (l.user_id = auth.uid() OR public.is_ancestor_of(auth.uid(), l.user_id)))
        OR (p_filters->>'scope' = 'agency' AND l.organization_id = public.get_org_id())
        -- CHANGED: importer-scoped unassigned (mirrors leads_select_unassigned_pool)
        OR (p_filters->>'scope' = 'unassigned'
            AND l.organization_id = public.get_org_id()
            AND l.user_id IS NULL AND l.assigned_agent_id IS NULL
            AND (
              public.has_contacts_permission('contacts.leads.view_all')
              OR l.imported_by_user_id = auth.uid()
            ))
      )
      AND ( p_filters->'agent_ids' IS NULL OR jsonb_typeof(p_filters->'agent_ids') <> 'array'
            OR l.user_id = ANY (ARRAY(SELECT (jsonb_array_elements_text(p_filters->'agent_ids'))::uuid)) )
      AND (p_filters->>'status' IS NULL OR l.status = p_filters->>'status')
      AND (p_filters->>'source' IS NULL OR l.lead_source = p_filters->>'source')
      AND (p_filters->>'state'  IS NULL OR l.state = p_filters->>'state')
      AND (p_filters->>'created_start' IS NULL OR l.created_at >= (p_filters->>'created_start')::timestamptz)
      AND (p_filters->>'created_end'   IS NULL OR l.created_at <= (p_filters->>'created_end')::timestamptz)
      AND ( p_filters->'timezone_states' IS NULL OR jsonb_typeof(p_filters->'timezone_states') <> 'array'
            OR l.state = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'timezone_states'))) )
      AND ( p_filters->'callable_states' IS NULL OR jsonb_typeof(p_filters->'callable_states') <> 'array'
            OR l.state = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'callable_states'))) )
      AND ( p_filters->>'search' IS NULL
            OR l.first_name ILIKE '%' || (p_filters->>'search') || '%'
            OR l.last_name  ILIKE '%' || (p_filters->>'search') || '%'
            OR l.phone      ILIKE '%' || (p_filters->>'search') || '%'
            OR l.email      ILIKE '%' || (p_filters->>'search') || '%' )
  ),
  filtered AS (
    SELECT * FROM base b
    WHERE
      ( p_filters->'attempt_buckets' IS NULL OR jsonb_typeof(p_filters->'attempt_buckets') <> 'array'
        OR ( ('0'   = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'attempt_buckets'))) AND b.attempt_count = 0)
          OR ('1-3' = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'attempt_buckets'))) AND b.attempt_count BETWEEN 1 AND 3)
          OR ('4+'  = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'attempt_buckets'))) AND b.attempt_count >= 4) ) )
      AND ( p_filters->>'last_disposition' IS NULL
        OR (p_filters->>'last_disposition' = '__none__' AND b.last_disposition IS NULL)
        OR ( p_filters->>'last_disposition' <> '__none__'
             AND lower(btrim(coalesce(b.last_disposition,''))) = lower(btrim(p_filters->>'last_disposition')) ) )
  ),
  keyed AS (
    SELECT f.id, f.created_at,
      (lower(coalesce(p_filters->>'sort_direction','desc')) IN ('asc','desc')) AS dir_ok,
      (lower(coalesce(p_filters->>'sort_direction','desc')) = 'asc')           AS asc_dir,
      CASE lower(coalesce(p_filters->>'sort_column',''))
        WHEN 'name'             THEN lower(btrim(coalesce(f.last_name,''))) || ' ' || lower(btrim(coalesce(f.first_name,'')))
        WHEN 'status'           THEN f.status
        WHEN 'lead_source'      THEN lower(btrim(coalesce(f.lead_source,'')))
        WHEN 'state'            THEN f.state
        WHEN 'phone'            THEN f.phone
        WHEN 'email'            THEN lower(btrim(coalesce(f.email,'')))
        WHEN 'dob'              THEN f.date_of_birth::text
        WHEN 'best_time'        THEN f.best_time_to_call
        WHEN 'last_contacted'   THEN f.last_contacted_at::text
        WHEN 'assigned_agent'   THEN f.agent_sort
        WHEN 'last_disposition' THEN lower(btrim(f.last_disposition))
        ELSE NULL END AS text_key,
      CASE WHEN lower(coalesce(p_filters->>'sort_column','')) = 'attempt_count' THEN f.attempt_count ELSE NULL END AS num_key,
      CASE WHEN lower(coalesce(p_filters->>'sort_column','')) = 'created_at'     THEN f.created_at     ELSE NULL END AS ts_key
    FROM filtered f
  )
  SELECT k.id,
    row_number() OVER (
      ORDER BY
        CASE WHEN k.dir_ok AND k.asc_dir     THEN k.text_key END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir THEN k.text_key END DESC NULLS LAST,
        CASE WHEN k.dir_ok AND k.asc_dir     THEN k.num_key  END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir THEN k.num_key  END DESC NULLS LAST,
        CASE WHEN k.dir_ok AND k.asc_dir     THEN k.ts_key   END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir THEN k.ts_key   END DESC NULLS LAST,
        k.created_at DESC, k.id DESC
    ) AS ord
  FROM keyed k;
$function$;

COMMIT;
```

**Application procedure (after approval, against an approved Supabase dev BRANCH first — NOT prod):**
1. `list_migrations` to reconfirm baseline (latest applied = `20260625184050`).
2. `apply_migration` on a **dev branch**; run §4 SQL tests via `psql`; `get_advisors(security)`.
3. Deploy `import-contacts` to the branch (`get_edge_function` first; full `index.ts`).
4. Manual verify: TL sees only self-imported unassigned; Admin all; Agent none; Add Lead gate; Import History / bulk-assign / Add-to-Campaign / Kanban unaffected.
5. Only on Chris's separate explicit go: promote to prod (`apply_migration` + edge deploy on `jncvvsvckxhqgqvkppmj`).

**Rollback:** `DROP POLICY` + recreate the original org-wide `leads_select_unassigned_pool`; revert `_contacts_filtered_leads` to the `20260624120000` body; `DROP COLUMN imported_by_user_id`. The column is additive/nullable so it is safe to leave if only the policy is reverted.

---

## 6. Test plan

- **`npx tsc --noEmit`** clean; **`git diff --check`** clean.
- **Targeted vitest** (frontend, no DB):
  - Add Lead gate (F2): Agent → section hidden; Team Leader with no downline → hidden; Team Leader with ≥1 downline / Admin-with-others → shown; hidden-section save still resolves owner = self (no unassigned write).
  - `contactScope.test.ts` (F3): `computeAvailableScopes` unchanged — Agent no `unassigned` pill; TL keeps pill; `resolveInitialScope` strict-landing intact.
  - Regression: `contactsPermissions`, `contactsGatingRender`, `pageGuardContacts`, `importUndo`, `contactsBulkSafety`, `contactsFilterContract`, `contactsKanban`, `conversionContract` stay green.
  - Run: `npx vitest run src/components/contacts/__tests__/… src/lib/__tests__/contactScope.test.ts src/lib/__tests__/contactsPermissions.test.ts` (no per-suite npm script; use `vitest run <file>`).
- **Supabase SQL tests** (only if migration created; manual `psql` on LOCAL/approved BRANCH, never prod): extend `supabase/tests/contacts_permissions_integration.sql` T3/T4 — importer-scoped unassigned matrix (TL self-imported only / not-other-importer / Admin all / Agent none), plus backfill correctness; one `BEGIN…ROLLBACK`, simulated `request.jwt.claims` + `SET LOCAL ROLE authenticated`.
- **Preserve / regression-verify (no break):** Import History drill-in (`getByIds` → `.in("id",…)` under base `leads_select_org_scoped`, **independent of scope** — unaffected), Import Undo, Add to Campaign (`getAllLeadIdsMatching(activeLeadSelectAllPayload())` shares the scoped payload), Kanban/list consistency (shared `_contacts_filtered_leads`), bulk assign (`bulkAssign` writes `assigned_agent_id` + `user_id`; assigned rows leave the unassigned set), Contacts scope controls, Lead→Client conversion (universal/ungated/org-scoped).

---

## 7. Supabase statement

**No Supabase mutation will be performed until Chris approves the exact SQL/migration plan in §5.** The backend change modifies RLS (`leads_select_unassigned_pool`) and therefore requires Chris's `#APPROVE_RLS_CHANGE`. After approval, the migration + `import-contacts` edge deploy are applied to an **approved Supabase dev branch first** and only promoted to production (`jncvvsvckxhqgqvkppmj`) on a **separate explicit** Chris go-ahead. Frontend-only items (F1–F3) carry no Supabase change and can ship independently.

---

## 8. Open decisions for Chris (defaults in **bold**)

- **D1 — Provenance:** **New `leads.imported_by_user_id` column (recommended)** vs. import_history-only RLS predicate (rejected: unreliable + non-performant, see §1C/§3).
- **D2 — Team Leader scope:** **Strict self-imported (`imported_by_user_id = auth.uid()`)** vs. also-downline-imported (`is_ancestor_of(auth.uid(), imported_by_user_id)`). Default = strict, per literal requirement.
- **D3 — Existing pool:** **Accept** that the 507 existing seeded-unassigned leads (no recoverable importer) become Admin/Super-only for Team Leaders (correct secure posture) vs. a special backfill rule (none recommended — they weren't imported by a Team Leader).
- **D4 — RPC mirror:** **Include** the importer predicate in `_contacts_filtered_leads` too (defense-in-depth) vs. RLS-only (sufficient, since the helper is INVOKER). Default = include.
- **D5 — Delivery:** **Frontend gate (F1–F3) ships in one PR; backend (B1–B4) ships in a second PR after `#APPROVE_RLS_CHANGE` + dev-branch verification** vs. single combined PR.
