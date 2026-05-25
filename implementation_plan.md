# Contact Flow Build 3 — Lead sources hardening + real reassignment + default seeding

**Branch:** `claude/determined-goldberg-76meW`
**Status:** AWAITING APPROVAL (no files modified, no migrations applied, no Edge deploys)
**Owner:** Chris Garness

---

## A. Live inspection findings (pre-implementation)

### `public.lead_sources` schema
- Columns: `id uuid PK`, `organization_id uuid NULL` (FK → organizations ON DELETE CASCADE), `name text NOT NULL`, `color text NOT NULL default '#3B82F6'`, `active bool NULL default true`, `usage_count int NULL default 0`, `sort_order int NULL default 0`, `created_at timestamptz NULL default now()`, `updated_at timestamptz NULL default now()`.
- **Indexes/Constraints:** only PK + FK. No unique-name index. No updated_at trigger.
- **Row count:** **1 row total** — single org `a0000000-…0001` with one source: `Goat Leads - FEX` (#3B82F6, active=true, usage_count=0, sort_order=0).
- **NULL organization_id rows:** **0** → safe to `SET NOT NULL`.
- **Duplicates by `lower(btrim(name))` per org:** none.

### `public.leads`
- `lead_source` is `text NOT NULL`. `organization_id` is `uuid NULL` (legacy nullable, but in practice every live row is org-scoped).
- **Real usage by org:** org `a0000000-…0001`, `lead_source = 'Goat Leads - FEX'` → **8 leads**.
- `lead_sources.usage_count` (0) is stale vs real (8) → must not be trusted.

### RLS policies on `lead_sources` (current)
- SELECT: `Users can view their organization's lead sources` — `(organization_id IS NULL OR EXISTS … profiles.org match)`. **Has the legacy null-org branch to drop.**
- ALL: `Admins can manage their organization's lead sources` — uses `profiles.role` (lowercased) IN (`admin`, `super admin`, `superadmin`, `team leader`, `team lead`). **Team Leader currently has DB writes — must be removed.**

### Organization triggers (current)
- `on_organization_created_provision_twilio` → `handle_new_organization_provisioning()`
- `on_organization_created_seed_appointment_types` → `handle_new_organization_seed_appointment_types()`
- `on_organization_created_seed_pipeline_stages` → `handle_new_organization_seed_pipeline_stages()` (Build 2)
- **No** lead-sources seed trigger yet.

### Helper functions present
`get_org_id`, `get_user_role`, `is_super_admin`, `update_updated_at` — all live. Pre-flight will gate on these.

### `create-organization` Edge Function v38 (live)
- After Build 2 it only inserts the organization row + seeds dispositions. **It does NOT insert lead sources directly.** No change required to this function.

### Frontend callers of `leadSourcesSupabaseApi`
- `src/lib/supabase-settings.ts` (definition)
- `src/components/settings/ContactManagement.tsx` → `LeadSourcesTab`
- No other call sites. (Many files reference `leads.lead_source` — unrelated; this build does not change `leads.lead_source` consumers' semantics.)

### Stop conditions — all green
- ✅ No name conflicts on canonical defaults (existing `Goat Leads - FEX` does not collide with any of the 8 canonical names).
- ✅ 0 NULL-org rows on `lead_sources`.
- ✅ `leads.lead_source` is `text NOT NULL`.
- ✅ No duplicate source names per org.
- ✅ Real usage countable via `leads.organization_id + leads.lead_source` exact-text match.
- ✅ Reassignment safe via string match scoped by org.
- ✅ All required helpers present.
- ✅ No destructive data changes required.
- ✅ `create-organization` already free of direct lead-source inserts — no Edge redeploy needed.

---

## B. Selected seeding strategy

- **Idempotent seed function** keyed on `lower(btrim(name))` per org (mirrors Build 2 pipeline-stages pattern). `INSERT … SELECT … WHERE NOT EXISTS`. `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL … FROM PUBLIC`.
- **One-shot backfill loop** over `public.organizations` to seed every existing org. Will insert the 8 canonical defaults for org `a0000000-…0001` while preserving `Goat Leads - FEX` exactly (different lowercased name → no collision).
- **New-org trigger** `on_organization_created_seed_lead_sources` mirrors the Build 2 pipeline-stage trigger pattern: EXCEPTION block → `RAISE WARNING` + `RETURN NEW` so seeding failures never block org creation.
- **`create-organization` Edge Function: NOT touched** — already has no direct lead-source inserts after Build 2.

---

## C. Files / functions / migrations to touch

### New migration (single file)
- `supabase/migrations/<fresh_ts>_lead_sources_hardening.sql`
  1. Pre-flight `DO` block — verify required helpers exist.
  2. Re-assert 0 NULL `organization_id` rows, then `ALTER … SET NOT NULL`.
  3. Backfill `active`/`sort_order` NULLs (none today, but safety) → `SET NOT NULL` on both.
  4. Indexes:
     - `lead_sources_org_sort_idx (organization_id, sort_order)`
     - `lead_sources_org_idx (organization_id)`
     - `lead_sources_org_lower_name_active_unique (organization_id, lower(btrim(name))) WHERE active = true` (partial unique)
     - `leads_org_lead_source_idx (organization_id, lead_source)` on `leads` (supports usage/rename/reassign).
  5. `BEFORE UPDATE` trigger `lead_sources_updated_at` → `public.update_updated_at()`.
  6. Replace RLS:
     - Drop legacy `Admins can manage…` and `Users can view…`.
     - SELECT: `organization_id = public.get_org_id()` (no NULL branch).
     - INSERT: org-scoped AND (`get_user_role() = 'Admin'` OR `is_super_admin()`).
     - UPDATE: same gate USING + WITH CHECK; pins `organization_id = public.get_org_id()`.
     - DELETE: same gate. (Usage-aware delete handled by `reassign_and_delete_lead_source` RPC; direct DELETE remains permitted for zero-usage sources — UI gates this and the RPC handles the in-use path.)
  7. `public.seed_default_lead_sources(p_organization_id uuid)` — SECURITY DEFINER, search_path = public, idempotent insert of the 8 canonical defaults. `REVOKE ALL … FROM PUBLIC`.
  8. `public.handle_new_organization_seed_lead_sources()` + `AFTER INSERT` trigger `on_organization_created_seed_lead_sources` on `public.organizations`. EXCEPTION block → `RAISE WARNING` → `RETURN NEW`.
  9. Backfill loop: `PERFORM public.seed_default_lead_sources(id)` for each org.
  10. `public.get_lead_sources_with_usage()` RPC — returns lead_source rows for `public.get_org_id()` plus `real_usage_count bigint` (LEFT JOIN to `leads` on `(organization_id, name = lead_source)`, GROUP BY). Stable SQL invoker-mode; RLS scopes both sides.
  11. `public.rename_lead_source(p_source_id uuid, p_new_name text, p_color text default null)` — SECURITY DEFINER, single transaction:
      - Verify caller is Admin or Super Admin in the source's org.
      - Verify source belongs to caller's org (`get_org_id()`).
      - Validate name 1–30 chars (trimmed); reject duplicate (case-insensitive, active) within org.
      - Capture `old_name`. Update `lead_sources` row (name + optional color).
      - `UPDATE leads SET lead_source = p_new_name WHERE organization_id = source.organization_id AND lead_source = old_name` → `GET DIAGNOSTICS reassigned_count`.
      - Return `(source_id, new_name, color, reassigned_count)`.
  12. `public.reassign_and_delete_lead_source(p_source_id uuid, p_new_source_id uuid)` — SECURITY DEFINER, single transaction:
      - Caller Admin/Super Admin in source's org. Both source IDs in caller's org. IDs differ. New source `active = true`.
      - Capture `old_name`, `new_name`.
      - `UPDATE leads SET lead_source = new_name WHERE organization_id = org AND lead_source = old_name` → `GET DIAGNOSTICS reassigned_count`.
      - `DELETE FROM lead_sources WHERE id = p_source_id`. (Hard delete — leads moved; no FK on `leads.lead_source`.)
      - Return `reassigned_count bigint`.
  13. `REVOKE ALL … FROM PUBLIC` on all three RPCs; `GRANT EXECUTE` to `authenticated`.

### Canonical defaults to seed
| # | Name | Color | sort_order |
|---|------|-------|------------|
| 1 | Final Expense (Direct Mail) | #3B82F6 | 0 |
| 2 | Mortgage Protection | #10B981 | 1 |
| 3 | Aged Leads | #F59E0B | 2 |
| 4 | Live Transfer | #8B5CF6 | 3 |
| 5 | Referral | #22C55E | 4 |
| 6 | Facebook / Social | #EC4899 | 5 |
| 7 | Existing Client | #14B8A6 | 6 |
| 8 | Other | #64748B | 7 |

For Chris's home org: existing `Goat Leads - FEX` (sort_order 0) preserved. Canonical defaults inserted at canonical sort_orders 0–7. Result: 9 sources total, with two sharing sort_order 0 (`Goat Leads - FEX` and `Final Expense (Direct Mail)`); UI sorts by `sort_order ASC` and tie-breaks by insert order — not a functional issue. See §F open questions for alternative.

### Frontend
- `src/lib/supabase-settings.ts` (`leadSourcesSupabaseApi`):
  - `getAll`: call `get_lead_sources_with_usage` RPC; map `real_usage_count` → `usageCount`.
  - `create`: unchanged shape; catch duplicate-name → friendly error.
  - `update`: if `name` changes → call `rename_lead_source` RPC; otherwise direct UPDATE for color/active/order.
  - `delete`: direct DELETE (zero-usage path).
  - `reassignAndDelete`: real RPC call; return `{ reassigned }`.
  - `reorder`: unchanged.
- `src/components/settings/ContactManagement.tsx` (`LeadSourcesTab`):
  - Edit modal: if `usageCount > 0`, show warning "Renaming this source will update N existing leads."
  - Delete dialog: zero-usage → "Delete"; in-use → require selecting another active source (`Select` dropdown of other active sources) → button "Reassign and Delete" → calls real RPC → toast "Reassigned N leads".
  - Friendly duplicate-name toasts.
  - Keep Admin/Super Admin gate + Zod (Build 1).
- `src/integrations/supabase/types.ts`: narrow `lead_sources.organization_id`, `active`, `sort_order` to non-null on Row; required on Insert. Surgical patch only.

### Docs
- `WORK_LOG.md`: newest-first entry.
- `AGENT_RULES.md`: propose adding under §5 Schema Gotchas a one-line invariant:
  > **Lead sources are denormalized as text on `leads.lead_source`.** Rename / reassign must update `leads` by string match scoped to `organization_id`. Normalization to `lead_source_id` is deferred.
  Will add inline in this build (single line, low blast radius) unless Chris prefers it stay only in WORK_LOG.

---

## D. Out of scope (deferred / unchanged)
- Pipeline stages (Build 2 complete).
- Custom fields / null-org templates (Build 4).
- Duplicate detection / required fields / field layout persistence (Build 5).
- `leads.lead_source_id` normalization / FK.
- Calendar, Twilio/dialer, workflows, dispositions, appointment_types.
- `create-organization` Edge Function (already correct after Build 2).

---

## E. Verification plan
- `npx tsc --noEmit` → 0 errors.
- `npm test -- --run` if available (likely `vitest: not found` on this remote env; consistent with Builds 1–2).
- Live MCP post-migration:
  1. `organization_id` NOT NULL on `lead_sources`.
  2. 9 rows for Chris org (1 custom + 8 canonical).
  3. `get_lead_sources_with_usage` returns `real_usage_count = 8` for `Goat Leads - FEX`.
  4. Helper-based RLS (4 policies), Team Leader removed.
  5. `on_organization_created_seed_lead_sources` trigger exists.
  6. Seed function + rename + reassign RPCs exist (SECURITY DEFINER, search_path public, EXECUTE granted to authenticated, revoked from PUBLIC).
  7. Unique active-name partial index + `leads(org, lead_source)` index exist.
  8. `lead_sources_updated_at` trigger exists.
- Manual smoke checklist (per task spec) will be in WORK_LOG entry for Chris to walk through.

---

## F. Open questions for Chris (would like guidance before applying)
1. **Seed sort_order conflict.** For Chris's home org, `Goat Leads - FEX` already occupies sort_order 0. Two options:
   - (A) Seed at canonical sort_orders 0–7 (default in this plan). UI sort ties at 0 will tie-break by insert/uuid order.
   - (B) For orgs that already have rows, seed at `max(sort_order)+1 … max+8` so existing customs stay on top.
   - Lean: **(A)** — gives every org the same canonical default ordering; Chris can drag-reorder once.
2. **AGENT_RULES inline edit.** OK to add one-line invariant to §5 Schema Gotchas? If not, I'll keep it only in WORK_LOG.
3. **`reassign_and_delete` behavior.** Plan = hard-delete old source after reassignment. Alternative = deactivate (`active = false`). Lean: **hard delete** (matches task "Recommended for this build").

---

## G. Approval status
**NOT YET APPROVED.** Stopping here per AGENT_RULES §8 / task instruction #4. No files modified, no migrations applied, no Edge Functions deployed. Awaiting Chris's explicit go-ahead (and answers to §F if he wants to redirect any of them).

---

## H. Context snapshot (will be filled on completion)
- Changes:
- Decisions:
- Files touched:
- Migrations / deploys:
- Verification:
- Manual check status:
- Blockers / next steps:
