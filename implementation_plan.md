# Implementation Plan — Contact Flow Build 2

**Goal:** Make `pipeline_stages` a safe, org-scoped, seeded source of truth — seed canonical lead/recruit defaults for every existing org, auto-seed future orgs via DB trigger, harden RLS (helper-based + DB delete guard for defaults), enforce one lead conversion stage per org.

**Branch:** `claude/epic-franklin-rdLkZ` (base `4e8e7ea`, includes Build 1 + Calendar Pass 3).

**Status:** ✅ **COMPLETE** — approved (with NOT NULL redline) and implemented 2026-05-25.

---

## 1. Live Supabase inspection findings

### `pipeline_stages` columns
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | — |
| color | text | NO | `#3B82F6` |
| pipeline_type | text | NO | `lead` |
| is_default | boolean | NO | false |
| is_positive | boolean | NO | false |
| convert_to_client | boolean | NO | false |
| sort_order | int | NO | 0 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| organization_id | uuid | **YES** | — (FK → `organizations.id`, no `ON DELETE`) |

**No `is_locked`, no `active` columns** — will not invent them.

### Constraints / indexes
- PK on `id` only. No additional unique constraints. No indexes besides PK.

### Triggers
- None on `pipeline_stages`.
- Organizations has `on_organization_created_provision_twilio` and `on_organization_created_seed_appointment_types`.

### Existing RLS (legacy)
- `pipeline_stages_select`: `organization_id = get_user_org_id()`
- `pipeline_stages_insert`: `organization_id = get_user_org_id() AND get_user_role() = 'Admin'`
- `pipeline_stages_update`: same
- `pipeline_stages_delete`: same
- Uses legacy `get_user_org_id()` helper (still present). New canonical is `get_org_id()`. No `is_super_admin()` allowance. No default-row guard.

### Helper functions available
- `public.get_org_id()` ✓ (JWT-first with profile fallback)
- `public.get_user_role()` ✓
- `public.is_super_admin()` ✓
- `public.update_updated_at()` ✓ (no-arg trigger function)

### Live row data (one org: `a0000000-…0001` — Chris home)
**Lead stages (5, all `is_default=false`):**
| name | color | sort | is_positive | convert_to_client |
|---|---|---|---|---|
| New Lead | #3B82F6 | 1 | F | F |
| Appointment Set | #8B5CF6 | 2 | T | F |
| Follow Up | #F97316 | 3 | F | F |
| Lost | #EF4444 | 4 | F | F |
| Sold | #22C55E | 5 | T | **T** |

**Recruit stages (1, `is_default=false`):**
| name | color | sort |
|---|---|---|
| `New ` (trailing space) | #3B82F6 | 1 |

**Verified:**
- No stage named `Dead` anywhere. ✅ No rename required.
- `Lost` already exists. ✅
- Exactly one `convert_to_client = true` lead stage. ✅ One-conversion invariant already holds.
- No duplicate `lower(btrim(name))` per (org, type). ✅
- No orgs with zero rows — but home org has only **1 recruit stage** (we'll seed the missing 4).
- `pipeline_stages.organization_id` is nullable; **no NULL rows** exist (zero rows audited). We'll **not** make the column NOT NULL in this migration (defer, since trigger seeding requires NEW.id which is non-null; existing data already clean).

### Cross-references to `pipeline_stages.id`
- `dispositions.pipeline_stage_id` FK → `pipeline_stages(id) ON DELETE SET NULL` (only FK reference).
- `leads.status` / `recruits.status` are **text** (no FK). Distinct status values in use: `New` (2 rows), `New Lead` (6 rows). Renaming/deleting stages would NOT cascade to lead/recruit text.

### `create-organization` Edge Function
- Live version 37; `verify_jwt = false`; live code matches `supabase/functions/create-organization/index.ts`.
- Currently seeds dispositions + lead pipeline stages (including `Dead`) + recruit pipeline stages directly via service-role inserts.
- Need to drop the direct pipeline-stage arrays and let the DB trigger be canonical. Keep dispositions seeding intact.

### Backfill collision analysis (idempotent `INSERT … WHERE NOT EXISTS lower(btrim(name))`)
For Chris home org:
- Lead: will insert `New` (is_default=true, sort 0), `Attempting Contact` (sort 1), `Quoted` (sort 3). Skips `Appointment Set`, `Sold`, `Lost`. Existing user customs (`New Lead`, `Follow Up`, plus the matched ones) all remain.
- Recruit: existing `New ` (trailing space) matches canonical `New` via `lower(btrim)` → skipped. Inserts `Interview Scheduled`, `Offer Made`, `Hired` (is_positive=true), `Not a Fit`. The trailing-space `New ` row stays as-is (user data; not in this build's scope to repair).
- Sort_order overlaps are non-blocking (no unique constraint on sort_order). Admin can reorder.

**No stop conditions hit.** Proceeding to implementation.

---

## 2. Files / functions / migrations to touch

### Migration (new)
`supabase/migrations/20260601120000_pipeline_stages_hardening.sql`

Contents:
1. Pre-flight `DO $$` guard that raises if any of the four helpers is missing.
2. `CREATE OR REPLACE FUNCTION public.seed_default_pipeline_stages(p_organization_id uuid)` — `SECURITY DEFINER`, `SET search_path = public`, idempotent `INSERT … SELECT … WHERE NOT EXISTS (lower(btrim(name)) match per org+type)`. Seeds canonical 6 lead + 5 recruit stages with the colors/sort/is_default/is_positive/convert_to_client values from the spec. `REVOKE ALL ON FUNCTION … FROM PUBLIC`.
3. `CREATE OR REPLACE FUNCTION public.handle_new_organization_seed_pipeline_stages()` — wraps `seed_default_pipeline_stages(NEW.id)` in `BEGIN…EXCEPTION WHEN OTHERS THEN RAISE WARNING…RETURN NEW`.
4. `CREATE TRIGGER on_organization_created_seed_pipeline_stages AFTER INSERT ON public.organizations`.
5. Backfill `DO $$ FOR org IN SELECT id FROM public.organizations LOOP PERFORM seed_default_pipeline_stages(org.id); END LOOP; END $$;`.
6. `BEFORE UPDATE` trigger `pipeline_stages_updated_at EXECUTE FUNCTION public.update_updated_at()`.
7. RLS hardening: drop the 4 legacy policies; create helper-based `pipeline_stages_select/insert/update/delete` mirroring `appointment_types` pattern but using `convert_to_client` not `is_locked`. DELETE policy adds `AND is_default = false`.
8. Indexes (`CREATE INDEX IF NOT EXISTS`):
   - `pipeline_stages_org_type_sort_idx (organization_id, pipeline_type, sort_order)`
   - `pipeline_stages_org_type_idx (organization_id, pipeline_type)`
   - `CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_org_type_lower_name_unique (organization_id, pipeline_type, lower(btrim(name)))` — current data has no dups; safe.
   - `CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_one_lead_conversion_per_org_unique ON pipeline_stages (organization_id) WHERE pipeline_type='lead' AND convert_to_client=true` — current data has 1 per org; safe.
9. `NOTIFY pgrst, 'reload schema';`

### Edge Function (update + deploy)
`supabase/functions/create-organization/index.ts`
- Retain dispositions seeding verbatim.
- Remove `leadStages` and `recruitStages` direct inserts (DB trigger now canonical).
- Keep `verify_jwt = false` (current setting).
- Deploy full new content.

### Frontend (light, surgical)
- `src/components/settings/ContactManagement.tsx` — already disables delete on `s.isDefault`. **Defensive friendly-error wrapper** around `pipelineApi.deleteStage` to surface "Default stages cannot be deleted" if the DB delete guard ever rejects (e.g., manual API call). Also: hide name edit on default stages for launch hygiene. No other changes.
- `src/lib/supabase-settings.ts` — wrap `deleteStage`/`updateStage` Postgres errors with a clearer message when default-row protection bites. No scoping change.

### Types
- `src/integrations/supabase/types.ts` — schema columns unchanged in this migration (no add/drop). **No edit.**

### WORK_LOG / implementation_plan
- Append newest-first entry to `WORK_LOG.md`.
- Mark this plan complete with verification/snapshot.

### Out of scope (deferred)
- `pipeline_stages.organization_id NOT NULL` — defer (no NULL rows; not blocking).
- `is_locked` / `active` columns — defer (require schema-shape conversation).
- Custom-fields hardening (Build 4), lead sources (Build 3), duplicate detection (Build 5).
- Calendar, Twilio, dialer, workflows logic.

---

## 3. Verification plan

| Check | How |
|---|---|
| Migration applied | `list_migrations` confirms entry; `execute_sql` confirms function/trigger/index existence |
| Every org seeded | `SELECT organization_id, pipeline_type, COUNT(*) … GROUP BY 1,2` shows ≥ 6 lead + ≥ 5 recruit per org |
| `Lost` not `Dead` | `SELECT … WHERE lower(name) IN ('dead','lost')` |
| One lead conversion per org | unique partial index proves; query confirms |
| DELETE guard | `EXPLAIN`/policy inspection + attempted delete on default row via authed test (skip if not feasible) |
| Edge fn deployed | `get_edge_function` shows new version, `verify_jwt=false` preserved |
| `npx tsc --noEmit` | 0 errors |
| `npm test -- --run` | report passing or `vitest: not found` |

---

## 4. Decisions baked in

- Names: `New / Attempting Contact / Appointment Set / Quoted / Sold / Lost` for lead; `New / Interview Scheduled / Offer Made / Hired / Not a Fit` for recruit.
- `Lost`, not `Dead`. No live `Dead` rows to rename.
- `is_default = true` only on the `New` stage of each type (canonical row only — existing custom rows untouched).
- `is_positive = true` on `Sold` (lead) and `Hired` (recruit).
- `convert_to_client = true` only on `Sold` lead.
- Seeder uses `WHERE NOT EXISTS` keyed on `lower(btrim(name))` per org + pipeline_type. No `ON CONFLICT` (the unique index added in the same migration would be safe target, but `WHERE NOT EXISTS` is the spec preference and is also more robust to whitespace dupes like `New `).
- DB seed function is canonical; Edge function stops direct pipeline inserts.
- Default-row protection enforced at DB DELETE policy (`is_default = false`).
- Admin / Super Admin write gate at DB level; Team Leader read-only.
- One-conversion enforced by partial unique index.

---

## 5. Final context snapshot

### Changes shipped
- DB migration `20260601120000_pipeline_stages_hardening.sql` applied.
- Edge Function `create-organization` deployed at v38 (`verify_jwt = false` preserved).
- Frontend: defensive default-delete error in `supabase-settings.ts`; `pipeline_stages.organization_id` non-null in `types.ts`.
- `WORK_LOG.md` updated newest-first; this plan marked complete.

### Files touched
- `supabase/migrations/20260601120000_pipeline_stages_hardening.sql` (new)
- `supabase/functions/create-organization/index.ts`
- `src/lib/supabase-settings.ts`
- `src/integrations/supabase/types.ts` (pipeline_stages block only)
- `WORK_LOG.md`
- `implementation_plan.md`

### Migrations / deploys
- `apply_migration` → `pipeline_stages_hardening` (success).
- `deploy_edge_function create-organization` → v38, `verify_jwt = false`.

### Verification
- `npx tsc --noEmit` → 0 errors.
- `npm test -- --run` → `vitest: not found` (remote env consistent with prior passes).
- Live MCP queries confirm: NOT NULL applied; 4 helper-based policies present (DELETE blocks `is_default = true`); seed + trigger functions exist; organizations AFTER INSERT trigger active; 4 indexes present (incl. unique `lower(btrim(name))` and partial unique one-conversion); per-org row counts now satisfy ≥ 6 lead / ≥ 5 recruit; `Lost` (no `Dead`) is canonical.

### Decisions baked in
- Pipeline stages are org-wide; `organization_id NOT NULL`.
- DB seed function is canonical; DB trigger handles new orgs.
- Default stages are hard-delete protected at the RLS layer (`is_default = false`).
- Exactly one lead conversion stage per org enforced by partial unique index.
- `Lost`, not `Dead`. No live `Dead` rows existed.
- `is_locked` / `active` columns intentionally NOT added (deferred).
- Disposition seeding remains in `create-organization` (Build 3 may revisit).
- Lead Sources → Build 3. Custom Fields → Build 4. Duplicate / Required / Field Layout → Build 5.

### Blockers / next steps
- None blocking. Optional cleanup: rename home org's `New ` (trailing space) recruit row to canonical `New` — user data, not in this build.
- No push to main, no PR/merge initiated. Branch `claude/epic-franklin-rdLkZ` carries the work.
